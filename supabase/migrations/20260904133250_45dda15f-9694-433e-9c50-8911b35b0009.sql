-- ---------------------------------------------------------------------------
-- REVIVE Step 2 + 3: AI diagnosis persistence, recovery playbook, deterministic
-- policy engine, canary execution and verification.
-- ---------------------------------------------------------------------------

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recovery_score numeric,
  ADD COLUMN IF NOT EXISTS investigated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.recovery_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_code text NOT NULL,
  action_key text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  eligible_transactions int NOT NULL DEFAULT 0,
  eligible_paise bigint NOT NULL DEFAULT 0,
  expected_recovery_paise bigint NOT NULL DEFAULT 0,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_status text NOT NULL DEFAULT 'blocked',
  policy_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_status text NOT NULL DEFAULT 'pending',
  canary_limit int NOT NULL DEFAULT 50,
  attempted int NOT NULL DEFAULT 0,
  recovered int NOT NULL DEFAULT 0,
  recovered_paise bigint NOT NULL DEFAULT 0,
  executed_at timestamptz,
  verification jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (incident_code, action_key)
);

GRANT SELECT ON public.recovery_actions TO anon, authenticated;
GRANT ALL ON public.recovery_actions TO service_role;
ALTER TABLE public.recovery_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Recovery actions are publicly readable" ON public.recovery_actions;
CREATE POLICY "Recovery actions are publicly readable"
  ON public.recovery_actions FOR SELECT TO anon, authenticated USING (true);

DROP TRIGGER IF EXISTS recovery_actions_touch ON public.recovery_actions;
CREATE TRIGGER recovery_actions_touch BEFORE UPDATE ON public.recovery_actions
  FOR EACH ROW EXECUTE FUNCTION public.revive_touch_updated_at();

-- Append-only audit helper ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_audit(
  p_stage text, p_actor text, p_event text, p_detail text,
  p_outcome text, p_incident text, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next int;
BEGIN
  SELECT coalesce(max(substring(event_code from 5)::int), 1000) + 1
    INTO v_next FROM public.audit_events WHERE event_code ~ '^AUD-[0-9]+$';
  INSERT INTO public.audit_events
    (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  VALUES ('AUD-' || lpad(v_next::text, 5, '0'), now(), p_actor, p_stage, p_event,
          p_detail, p_outcome, p_incident, coalesce(p_metadata, '{}'::jsonb));
END $$;

-- Deterministic eligibility --------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_eligible_txns(p_code text, p_action text)
RETURNS TABLE(transaction_id text, amount_paise bigint, failure_reason text, propensity numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inc AS (SELECT * FROM public.incidents WHERE incident_code = p_code),
       m AS (SELECT as_of FROM public.dataset_meta WHERE id = 1)
  SELECT t.transaction_id, t.amount_paise, t.failure_reason,
    (CASE t.failure_reason
      WHEN 'BANK_GATEWAY_TIMEOUT' THEN 0.72 WHEN 'PSP_UNAVAILABLE' THEN 0.68
      WHEN 'GATEWAY_ERROR' THEN 0.65 WHEN 'ACS_UNAVAILABLE' THEN 0.58
      WHEN 'BANK_MAINTENANCE' THEN 0.55 WHEN 'INVALID_UMRN_SEQUENCE' THEN 0.62
      WHEN 'COLLECT_EXPIRED' THEN 0.41 WHEN 'SESSION_EXPIRED' THEN 0.38
      WHEN 'USER_DROPPED' THEN 0.34 WHEN 'AUTH_3DS_FAILED' THEN 0.30
      ELSE 0 END)::numeric
  FROM public.transactions t, inc, m
  WHERE t.payment_status = 'failed'
    AND t.occurred_at >= inc.window_start AND t.occurred_at < inc.window_end
    AND (nullif(inc.scope_method, '') IS NULL OR t.payment_method = inc.scope_method)
    AND (nullif(inc.scope_issuer, '') IS NULL OR t.issuer = inc.scope_issuer)
    AND t.retry_count < 2
    AND t.amount_paise BETWEEN 10000 AND 20000000
    AND t.occurred_at <= m.as_of - interval '15 minutes'
    AND t.failure_reason = ANY (
      CASE WHEN p_action = 'retry_failed'
        THEN ARRAY['BANK_GATEWAY_TIMEOUT','PSP_UNAVAILABLE','GATEWAY_ERROR',
                   'ACS_UNAVAILABLE','BANK_MAINTENANCE','INVALID_UMRN_SEQUENCE']
        ELSE ARRAY['USER_DROPPED','COLLECT_EXPIRED','SESSION_EXPIRED','AUTH_3DS_FAILED']
      END)
$$;

-- Recovery opportunity score (explainable, deterministic) --------------------
CREATE OR REPLACE FUNCTION public.revive_recovery_score(p_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inc public.incidents%ROWTYPE;
  v_elig_paise bigint; v_elig_count int; v_expected bigint;
  f_addressable numeric; f_transience numeric; f_signal numeric;
  f_freshness numeric; f_volume numeric; v_score numeric;
BEGIN
  SELECT * INTO inc FROM public.incidents WHERE incident_code = p_code;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(sum(amount_paise), 0), count(*), coalesce(sum(amount_paise * propensity), 0)::bigint
    INTO v_elig_paise, v_elig_count, v_expected
  FROM (SELECT * FROM public.revive_eligible_txns(p_code, 'retry_failed')
        UNION ALL SELECT * FROM public.revive_eligible_txns(p_code, 'recover_abandoned')) e;

  f_addressable := least(1, CASE WHEN inc.revenue_at_risk_paise > 0
    THEN v_elig_paise::numeric / inc.revenue_at_risk_paise ELSE 0 END) * 40;
  f_transience := CASE
    WHEN inc.dominant_failure_reason IN ('BANK_GATEWAY_TIMEOUT','PSP_UNAVAILABLE','GATEWAY_ERROR',
         'ACS_UNAVAILABLE','BANK_MAINTENANCE','INVALID_UMRN_SEQUENCE') THEN 25
    WHEN inc.dominant_failure_reason IN ('USER_DROPPED','COLLECT_EXPIRED','SESSION_EXPIRED','AUTH_3DS_FAILED') THEN 14
    ELSE 4 END;
  f_signal := least(1, inc.z_score / 12.0) * 15;
  f_freshness := CASE inc.status WHEN 'detected' THEN 10 WHEN 'monitoring' THEN 7 ELSE 3 END;
  f_volume := least(1, v_elig_count / 100.0) * 10;
  v_score := round(f_addressable + f_transience + f_signal + f_freshness + f_volume);

  RETURN jsonb_build_object(
    'score', v_score,
    'eligibleTransactions', v_elig_count,
    'eligiblePaise', v_elig_paise,
    'expectedRecoveryPaise', v_expected,
    'factors', jsonb_build_array(
      jsonb_build_object('label','Addressable share of revenue at risk','points',round(f_addressable,1),'max',40),
      jsonb_build_object('label','Transience of dominant failure reason','points',round(f_transience,1),'max',25),
      jsonb_build_object('label','Detection signal strength (z-score)','points',round(f_signal,1),'max',15),
      jsonb_build_object('label','Incident freshness','points',round(f_freshness,1),'max',10),
      jsonb_build_object('label','Eligible transaction volume','points',round(f_volume,1),'max',10)
    ));
END $$;

-- Playbook proposal + deterministic policy evaluation ------------------------
CREATE OR REPLACE FUNCTION public.revive_propose_recovery(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inc public.incidents%ROWTYPE;
  a record; v_count int; v_paise bigint; v_expected bigint; v_max bigint;
  v_status text; v_checks jsonb; v_exec text; v_reasons text;
  v_existing public.recovery_actions%ROWTYPE;
  MAX_TICKET  constant bigint := 20000000;
  AUTO_LIMIT  constant bigint := 50000000;
  MIN_CONF    constant numeric := 60;
BEGIN
  SELECT * INTO inc FROM public.incidents WHERE incident_code = p_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'unknown incident'); END IF;

  FOR a IN
    SELECT 'retry_failed' AS key,
           'Retry eligible failed payments' AS title,
           'Transient PSP/issuer failures in the incident window are safe to re-attempt once the upstream signal is stable.' AS reason,
           false AS customer_facing
    UNION ALL
    SELECT 'recover_abandoned',
           'Recover abandoned / interrupted checkouts',
           'Sessions that expired or were dropped mid-authentication can be re-offered a payment link; this is customer-facing.',
           true
  LOOP
    SELECT count(*), coalesce(sum(amount_paise),0), coalesce(sum(amount_paise*propensity),0)::bigint,
           coalesce(max(amount_paise),0)
      INTO v_count, v_paise, v_expected, v_max
      FROM public.revive_eligible_txns(p_code, a.key);

    SELECT * INTO v_existing FROM public.recovery_actions
      WHERE incident_code = p_code AND action_key = a.key;

    v_checks := '[]'::jsonb;
    v_status := 'approved';

    IF inc.confidence IS NULL OR inc.confidence < MIN_CONF THEN
      v_status := 'blocked';
      v_checks := v_checks || jsonb_build_object('check','AI confidence threshold','status','fail',
        'detail', coalesce(round(inc.confidence)::text || '% is below the 60% minimum',
                           'no AI diagnosis on record'));
    ELSE
      v_checks := v_checks || jsonb_build_object('check','AI confidence threshold','status','pass',
        'detail', round(inc.confidence)::text || '% is at or above the 60% minimum');
    END IF;

    IF v_count = 0 THEN
      v_status := 'blocked';
      v_checks := v_checks || jsonb_build_object('check','Failure-reason eligibility','status','fail',
        'detail','no transaction in the window matches this action''s eligibility rules');
    ELSE
      v_checks := v_checks || jsonb_build_object('check','Failure-reason eligibility','status','pass',
        'detail', v_count::text || ' transactions match the allowed failure reasons');
    END IF;

    v_checks := v_checks || jsonb_build_object('check','Per-transaction amount ceiling','status','pass',
      'detail','largest eligible ticket is within the Rs 2,00,000 per-attempt ceiling');

    v_checks := v_checks || jsonb_build_object('check','Retry limit and cooldown','status','pass',
      'detail','retry count below 2 and at least 15 minutes since the original attempt');

    IF v_existing.id IS NOT NULL AND v_existing.execution_status = 'executed' THEN
      v_status := 'blocked';
      v_checks := v_checks || jsonb_build_object('check','Duplicate / idempotency guard','status','fail',
        'detail','a canary batch has already executed for this incident and action');
    ELSE
      v_checks := v_checks || jsonb_build_object('check','Duplicate / idempotency guard','status','pass',
        'detail','no prior execution recorded for this incident and action');
    END IF;

    IF v_status = 'approved' AND (v_expected > AUTO_LIMIT OR a.customer_facing) THEN
      v_status := 'requires_approval';
      v_checks := v_checks || jsonb_build_object('check','Exposure limit / human authority','status','warn',
        'detail', CASE WHEN a.customer_facing
          THEN 'customer-facing action - a human finance owner must approve'
          ELSE 'expected exposure exceeds the Rs 5,00,000 auto-approval ceiling' END);
    ELSIF v_status = 'approved' THEN
      v_checks := v_checks || jsonb_build_object('check','Exposure limit / human authority','status','pass',
        'detail','expected exposure within the Rs 5,00,000 auto-approval ceiling and not customer-facing');
    END IF;

    v_exec := CASE
      WHEN v_existing.id IS NOT NULL AND v_existing.execution_status IN ('executed','rejected')
        THEN v_existing.execution_status
      WHEN v_status = 'blocked' THEN 'blocked'
      ELSE 'pending' END;

    INSERT INTO public.recovery_actions AS r
      (incident_code, action_key, title, reason, eligible_transactions, eligible_paise,
       expected_recovery_paise, eligibility, policy_status, policy_checks, execution_status)
    VALUES (p_code, a.key, a.title, a.reason, v_count, v_paise, v_expected,
            jsonb_build_object('maxTicketPaise', v_max), v_status, v_checks, v_exec)
    ON CONFLICT (incident_code, action_key) DO UPDATE SET
      title = excluded.title, reason = excluded.reason,
      eligible_transactions = excluded.eligible_transactions,
      eligible_paise = excluded.eligible_paise,
      expected_recovery_paise = excluded.expected_recovery_paise,
      eligibility = excluded.eligibility,
      policy_status = excluded.policy_status,
      policy_checks = excluded.policy_checks,
      execution_status = CASE WHEN r.execution_status IN ('executed','rejected')
        THEN r.execution_status ELSE excluded.execution_status END;

    SELECT string_agg(c->>'check', ', ') INTO v_reasons
      FROM jsonb_array_elements(v_checks) c WHERE c->>'status' = 'fail';

    PERFORM public.revive_audit('policy','Policy Engine','Recovery action evaluated',
      a.title || ' -> ' || upper(v_status) ||
      CASE WHEN v_reasons IS NULL THEN '' ELSE ' (failed: ' || v_reasons || ')' END,
      CASE v_status WHEN 'blocked' THEN 'blocked' WHEN 'approved' THEN 'success' ELSE 'info' END,
      p_code, jsonb_build_object('actionKey', a.key, 'policyStatus', v_status));
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END $$;

-- Human approval -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_decide_recovery(p_code text, p_action text, p_decision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.recovery_actions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.recovery_actions WHERE incident_code = p_code AND action_key = p_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no such action'); END IF;
  IF r.policy_status = 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'the policy engine blocked this action; it cannot be approved');
  END IF;
  IF r.execution_status = 'executed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already executed');
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE public.recovery_actions SET policy_status = 'approved', execution_status = 'pending'
      WHERE id = r.id;
    PERFORM public.revive_audit('policy','Merchant Operator (human)','Recovery action approved',
      r.title || ' approved for bounded canary execution.','success', p_code,
      jsonb_build_object('actionKey', p_action));
  ELSE
    UPDATE public.recovery_actions SET execution_status = 'rejected' WHERE id = r.id;
    PERFORM public.revive_audit('policy','Merchant Operator (human)','Recovery action rejected',
      r.title || ' rejected by the human approver; no execution will run.','blocked', p_code,
      jsonb_build_object('actionKey', p_action));
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Canary execution + verification -------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_execute_recovery(p_code text, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.recovery_actions%ROWTYPE;
  inc public.incidents%ROWTYPE;
  v_attempted int; v_recovered int; v_paise bigint; v_batch bigint;
  v_total bigint; v_rate numeric;
BEGIN
  SELECT * INTO r FROM public.recovery_actions WHERE incident_code = p_code AND action_key = p_action;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no such action'); END IF;
  IF r.policy_status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action is not policy-approved');
  END IF;
  IF r.execution_status = 'executed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'canary batch already executed (idempotency guard)');
  END IF;
  SELECT * INTO inc FROM public.incidents WHERE incident_code = p_code;

  WITH batch AS (
    SELECT * FROM public.revive_eligible_txns(p_code, p_action)
    ORDER BY amount_paise DESC, transaction_id
    LIMIT r.canary_limit
  ), sim AS (
    SELECT amount_paise,
           (public.revive_rand('recovery:' || p_code || ':' || p_action || ':' || transaction_id)
             < propensity) AS succeeded
    FROM batch
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE succeeded)::int,
         coalesce(sum(amount_paise) FILTER (WHERE succeeded), 0)::bigint,
         coalesce(sum(amount_paise), 0)::bigint
    INTO v_attempted, v_recovered, v_paise, v_batch
  FROM sim;

  UPDATE public.recovery_actions SET
    execution_status = 'executed', executed_at = now(),
    attempted = v_attempted, recovered = v_recovered, recovered_paise = v_paise,
    verification = jsonb_build_object(
      'attempted', v_attempted, 'succeeded', v_recovered, 'failed', v_attempted - v_recovered,
      'batchValuePaise', v_batch, 'recoveredPaise', v_paise,
      'recoveryRatePct', CASE WHEN v_attempted > 0
        THEN round(100.0 * v_recovered / v_attempted, 1) ELSE 0 END,
      'mode', 'test-mode simulation')
  WHERE id = r.id;

  SELECT coalesce(sum(recovered_paise), 0) INTO v_total
    FROM public.recovery_actions WHERE incident_code = p_code;
  UPDATE public.incidents SET revenue_recovered_paise = v_total WHERE incident_code = p_code;

  v_rate := CASE WHEN v_attempted > 0 THEN round(100.0 * v_recovered / v_attempted, 1) ELSE 0 END;

  PERFORM public.revive_audit('execution','Recovery Executor (test mode)','Canary batch executed',
    r.title || ': ' || v_attempted || ' attempted, ' || v_recovered || ' recovered, Rs ' ||
    to_char(v_paise/100.0, 'FM99,99,99,990') || ' captured in test mode.',
    'success', p_code, jsonb_build_object('actionKey', p_action, 'attempted', v_attempted,
      'recovered', v_recovered, 'recoveredPaise', v_paise));

  PERFORM public.revive_audit('verification','Verification Service','Recovery verified',
    'Recovery rate ' || v_rate || '% on the canary batch; remaining revenue at risk Rs ' ||
    to_char(greatest(0, inc.revenue_at_risk_paise - v_total)/100.0, 'FM99,99,99,990') || '.',
    'success', p_code, jsonb_build_object('actionKey', p_action, 'recoveryRatePct', v_rate));

  PERFORM public.revive_refresh_projections();

  RETURN jsonb_build_object('ok', true, 'attempted', v_attempted, 'recovered', v_recovered,
    'recoveredPaise', v_paise, 'recoveryRatePct', v_rate);
END $$;

REVOKE EXECUTE ON FUNCTION public.revive_audit(text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revive_eligible_txns(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revive_recovery_score(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revive_propose_recovery(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revive_decide_recovery(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.revive_execute_recovery(text,text) FROM PUBLIC, anon, authenticated;