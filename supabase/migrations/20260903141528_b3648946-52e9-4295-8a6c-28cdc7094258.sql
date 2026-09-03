-- =====================================================================
-- REVIVE AI — Step 1 deterministic incident detection
--
-- DETECTION RULE (v1)
-- -------------------
-- Grain          : 30-minute windows, aligned to :00 / :30
-- Scopes         : payment_method, and payment_method + issuer
-- Horizon        : the last 48 hours before dataset_meta.as_of
-- Baseline       : same scope, trailing 7 days ending 2 hours before the
--                  window starts (guard band keeps a live outage from
--                  contaminating its own baseline)
-- Window is anomalous when ALL of:
--   attempts             >= 20      (min sample)
--   baseline attempts    >= 300     (baseline must be trustworthy)
--   baseline_sr - obs_sr >= 8.0 pp  (absolute drop)
--   relative drop        >= 15%     (scale-free drop)
--   two-proportion z     >= 3.0     (statistical significance)
-- Incident opens after 2 consecutive anomalous windows; a single clean
-- window does not close it (gap tolerance = 1 window).
-- Detected_at = first anomalous window + 60 min, i.e. the earliest moment
-- the rule could have fired. No look-ahead.
--
-- Revenue at risk = SUM over anomalous windows of
--                   (attempted_value * baseline_sr) - captured_value, floored at 0.
-- Affected txns   = SUM over anomalous windows of
--                   (attempts * baseline_sr) - successes, floored at 0.
--
-- The rule never reads transactions.scenario_tag.
-- =====================================================================

DROP SEQUENCE IF EXISTS public.incident_code_seq;

CREATE OR REPLACE FUNCTION public.revive_method_label(p_method text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE p_method
    WHEN 'upi' THEN 'UPI'
    WHEN 'card' THEN 'Card'
    WHEN 'netbanking' THEN 'Netbanking'
    WHEN 'wallet' THEN 'Wallet'
    WHEN 'emandate' THEN 'e-NACH mandate'
    ELSE initcap(p_method) END
$$;

CREATE OR REPLACE FUNCTION public.revive_reason_label(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE p_reason
    WHEN 'BANK_GATEWAY_TIMEOUT'  THEN 'bank gateway timeouts'
    WHEN 'PSP_UNAVAILABLE'       THEN 'PSP route unavailable'
    WHEN 'GATEWAY_ERROR'         THEN 'gateway errors'
    WHEN 'ACS_UNAVAILABLE'       THEN '3-D Secure ACS unavailable'
    WHEN 'ISSUER_DECLINED'       THEN 'issuer declines'
    WHEN 'BANK_REJECT'           THEN 'sponsor bank rejects'
    WHEN 'BANK_MAINTENANCE'      THEN 'bank maintenance window'
    WHEN 'INSUFFICIENT_FUNDS'    THEN 'insufficient funds'
    WHEN 'INSUFFICIENT_BALANCE'  THEN 'insufficient wallet balance'
    WHEN 'USER_DROPPED'          THEN 'customer drop-off'
    WHEN 'COLLECT_EXPIRED'       THEN 'expired collect requests'
    WHEN 'SESSION_EXPIRED'       THEN 'expired bank sessions'
    WHEN 'INVALID_VPA'           THEN 'invalid VPA handles'
    WHEN 'CARD_EXPIRED'          THEN 'expired cards'
    WHEN 'AUTH_3DS_FAILED'       THEN '3-D Secure authentication failures'
    WHEN 'WALLET_AUTH_FAILED'    THEN 'wallet authentication failures'
    WHEN 'RISK_BLOCKED'          THEN 'risk-engine blocks'
    WHEN 'MANDATE_INACTIVE'      THEN 'inactive mandates'
    WHEN 'INVALID_UMRN_SEQUENCE' THEN 'mandate presentment rejects'
    ELSE lower(replace(coalesce(p_reason,'unclassified failures'),'_',' ')) END
$$;

CREATE OR REPLACE FUNCTION public.revive_detect_incidents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Detection parameters. Change here, nowhere else.
  v_win            int     := 1800;   -- window size, seconds
  v_horizon        interval := interval '48 hours';
  v_lookback       interval := interval '7 days';
  v_guard          interval := interval '2 hours';
  v_min_attempts   int     := 20;
  v_min_base_att   int     := 300;
  v_min_drop_pp    numeric := 8.0;
  v_min_drop_rel   numeric := 0.15;
  v_min_z          numeric := 3.0;
  v_min_windows    int     := 2;
  v_gap            interval := interval '60 minutes';

  v_as_of          timestamptz;
  v_params         jsonb;
  v_opened         int := 0;
  v_total          int := 0;
BEGIN
  SELECT as_of INTO v_as_of FROM public.dataset_meta WHERE id = 1;
  IF v_as_of IS NULL THEN
    RETURN jsonb_build_object('error', 'dataset_meta missing');
  END IF;

  v_params := jsonb_build_object(
    'window_seconds', v_win, 'horizon_hours', 48, 'baseline_days', 7,
    'baseline_guard_hours', 2, 'min_window_attempts', v_min_attempts,
    'min_baseline_attempts', v_min_base_att, 'min_drop_pp', v_min_drop_pp,
    'min_relative_drop', v_min_drop_rel, 'min_z_score', v_min_z,
    'min_consecutive_windows', v_min_windows);

  DROP TABLE IF EXISTS _revive_runs;
  CREATE TEMP TABLE _revive_runs AS
  WITH scoped AS (
    SELECT 'payment_method'::text AS scope_type, payment_method AS scope_method,
           NULL::text AS scope_issuer, payment_method AS scope_key,
           occurred_at, payment_status, amount_paise
    FROM public.transactions
    UNION ALL
    SELECT 'payment_method_issuer'::text, payment_method, issuer,
           payment_method || '|' || issuer,
           occurred_at, payment_status, amount_paise
    FROM public.transactions
  ),
  allwin AS (
    SELECT scope_key, scope_type, scope_method, scope_issuer,
           to_timestamp(floor(extract(epoch FROM occurred_at) / v_win) * v_win) AS w_start,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE payment_status = 'captured')::int AS successes,
           sum(amount_paise)::bigint AS attempted_paise,
           coalesce(sum(amount_paise) FILTER (WHERE payment_status = 'captured'), 0)::bigint AS captured_paise
    FROM scoped
    GROUP BY 1,2,3,4,5
  ),
  evalwin AS (
    SELECT * FROM allwin
    WHERE w_start >= v_as_of - v_horizon AND w_start < v_as_of
  ),
  withbase AS (
    SELECT e.*, b.b_attempts, b.b_successes
    FROM evalwin e
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(a.attempts), 0)::int AS b_attempts,
             coalesce(sum(a.successes), 0)::int AS b_successes
      FROM allwin a
      WHERE a.scope_key = e.scope_key
        AND a.w_start <  e.w_start - v_guard
        AND a.w_start >= e.w_start - v_lookback
    ) b
  ),
  metrics AS (
    SELECT w.*,
      (w.successes::numeric / w.attempts)                     AS obs_sr,
      (w.b_successes::numeric / NULLIF(w.b_attempts, 0))      AS b_sr
    FROM withbase w
    WHERE w.attempts >= v_min_attempts AND w.b_attempts >= v_min_base_att
  ),
  scored AS (
    SELECT m.*,
      (m.b_sr - m.obs_sr) * 100 AS drop_pp,
      CASE WHEN m.b_sr > 0 THEN (m.b_sr - m.obs_sr) / m.b_sr ELSE 0 END AS drop_rel,
      CASE WHEN m.b_sr > 0 AND m.b_sr < 1
           THEN (m.b_sr - m.obs_sr) / sqrt(m.b_sr * (1 - m.b_sr) / m.attempts)
           ELSE 0 END AS z
    FROM metrics m
  ),
  flagged AS (
    SELECT * FROM scored
    WHERE drop_pp >= v_min_drop_pp AND drop_rel >= v_min_drop_rel AND z >= v_min_z
  ),
  marked AS (
    SELECT f.*,
      CASE WHEN lag(f.w_start) OVER (PARTITION BY f.scope_key ORDER BY f.w_start)
                >= f.w_start - v_gap THEN 0 ELSE 1 END AS is_new
    FROM flagged f
  ),
  islands AS (
    SELECT m.*,
      sum(m.is_new) OVER (PARTITION BY m.scope_key ORDER BY m.w_start
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
    FROM marked m
  )
  SELECT
    i.scope_key,
    i.scope_type,
    i.scope_method,
    i.scope_issuer,
    min(i.w_start)                                        AS started_at,
    max(i.w_start) + make_interval(secs => v_win)         AS ended_at,
    count(*)::int                                         AS window_count,
    sum(i.attempts)::int                                  AS attempts,
    sum(i.successes)::int                                 AS successes,
    sum(i.attempted_paise)::bigint                        AS attempted_paise,
    sum(i.captured_paise)::bigint                         AS captured_paise,
    (sum(i.attempts * i.b_sr) / sum(i.attempts))::numeric AS baseline_sr,
    (sum(i.successes)::numeric / sum(i.attempts))         AS observed_sr,
    GREATEST(0, round(sum(i.attempts * i.b_sr) - sum(i.successes)))::int          AS affected,
    GREATEST(0, round(sum(i.attempted_paise * i.b_sr) - sum(i.captured_paise)))::bigint AS at_risk_paise,
    max(i.z)::numeric                                     AS z_max,
    false                                                 AS suppressed,
    NULL::text                                            AS dominant_reason,
    NULL::numeric                                         AS dominant_share
  FROM islands i
  GROUP BY 1,2,3,4, i.island
  HAVING count(*) >= v_min_windows;

  -- ---- scope de-duplication -----------------------------------------
  -- If one issuer explains >= 60% of a method-wide drop, the issuer-level
  -- incident is the real one and the method-wide roll-up is suppressed.
  UPDATE _revive_runs m SET suppressed = true
  WHERE m.scope_type = 'payment_method'
    AND EXISTS (
      SELECT 1 FROM _revive_runs i
      WHERE i.scope_type = 'payment_method_issuer'
        AND i.scope_method = m.scope_method
        AND i.started_at < m.ended_at AND i.ended_at > m.started_at
        AND i.affected >= 0.60 * GREATEST(m.affected, 1));

  -- Otherwise the method-wide incident wins and the per-issuer echoes go away.
  UPDATE _revive_runs i SET suppressed = true
  WHERE i.scope_type = 'payment_method_issuer'
    AND EXISTS (
      SELECT 1 FROM _revive_runs m
      WHERE m.scope_type = 'payment_method' AND m.suppressed = false
        AND m.scope_method = i.scope_method
        AND m.started_at < i.ended_at AND m.ended_at > i.started_at);

  DELETE FROM _revive_runs WHERE suppressed;

  -- ---- dominant failure signature ------------------------------------
  UPDATE _revive_runs r
  SET dominant_reason = d.failure_reason,
      dominant_share  = d.share
  FROM (
    SELECT r2.scope_key, r2.started_at, f.failure_reason, f.share
    FROM _revive_runs r2
    CROSS JOIN LATERAL (
      SELECT t.failure_reason,
             (count(*)::numeric / NULLIF(sum(count(*)) OVER (), 0)) AS share
      FROM public.transactions t
      WHERE t.payment_status = 'failed'
        AND t.payment_method = r2.scope_method
        AND (r2.scope_issuer IS NULL OR t.issuer = r2.scope_issuer)
        AND t.occurred_at >= r2.started_at AND t.occurred_at < r2.ended_at
      GROUP BY t.failure_reason
      ORDER BY count(*) DESC
      LIMIT 1
    ) f
  ) d
  WHERE r.scope_key = d.scope_key AND r.started_at = d.started_at;

  -- ---- shape into incident rows ---------------------------------------
  DROP TABLE IF EXISTS _revive_incidents;
  CREATE TEMP TABLE _revive_incidents AS
  SELECT
    r.scope_key || '@' || to_char(r.started_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI') AS natural_key,
    'INC-' || (2400 + row_number() OVER (ORDER BY r.started_at, r.scope_key))::text  AS incident_code,
    public.revive_method_label(r.scope_method)
      || ' success rate '
      || CASE WHEN (r.baseline_sr - r.observed_sr) * 100 >= 40 THEN 'collapse'
              WHEN (r.baseline_sr - r.observed_sr) * 100 >= 20 THEN 'degradation'
              ELSE 'dip' END
      || ' — ' || public.revive_reason_label(r.dominant_reason)
      || CASE WHEN r.scope_issuer IS NOT NULL THEN ' · ' || r.scope_issuer ELSE '' END AS title,
    CASE
      WHEN r.at_risk_paise >= 800000000 AND (r.baseline_sr - r.observed_sr) * 100 >= 20 THEN 'critical'
      WHEN r.at_risk_paise >= 300000000 AND (r.baseline_sr - r.observed_sr) * 100 >= 15 THEN 'high'
      WHEN r.at_risk_paise >=  75000000 OR  (r.baseline_sr - r.observed_sr) * 100 >= 25 THEN 'medium'
      ELSE 'low' END AS severity,
    CASE
      WHEN r.ended_at >= v_as_of - interval '60 minutes' THEN 'detected'
      WHEN r.ended_at >= v_as_of - interval '2 hours'    THEN 'monitoring'
      ELSE 'recovered' END AS status,
    r.scope_type, r.scope_key, r.scope_method, r.scope_issuer,
    CASE WHEN r.scope_issuer IS NULL
         THEN public.revive_method_label(r.scope_method) || ' · all issuers'
         ELSE public.revive_method_label(r.scope_method) || ' · ' || r.scope_issuer END AS scope_label,
    LEAST(v_as_of, r.started_at + make_interval(secs => v_win * v_min_windows)) AS detected_at,
    r.started_at, r.ended_at,
    CASE WHEN r.ended_at >= v_as_of - interval '60 minutes' THEN NULL ELSE r.ended_at END AS resolved_at,
    round(r.observed_sr * 100, 3) AS observed_success_rate,
    round(r.baseline_sr * 100, 3) AS baseline_success_rate,
    round((r.baseline_sr - r.observed_sr) * 100, 3) AS drop_pp,
    round(CASE WHEN r.baseline_sr > 0
               THEN (r.baseline_sr - r.observed_sr) / r.baseline_sr * 100 ELSE 0 END, 3) AS drop_pct,
    round(r.z_max, 3) AS z_score,
    r.attempts, r.affected, r.at_risk_paise,
    r.dominant_reason, round(coalesce(r.dominant_share, 0) * 100, 3) AS dominant_share_pct
  FROM _revive_runs r;

  -- ---- persist (idempotent by natural_key) ----------------------------
  DELETE FROM public.incidents i
  WHERE NOT EXISTS (SELECT 1 FROM _revive_incidents n WHERE n.natural_key = i.natural_key);

  UPDATE public.incidents i SET
    incident_code = n.incident_code,
    title = n.title,
    severity = n.severity,
    status = n.status,
    scope_type = n.scope_type,
    scope_label = n.scope_label,
    scope_method = n.scope_method,
    scope_issuer = n.scope_issuer,
    detected_at = n.detected_at,
    window_start = n.started_at,
    window_end = n.ended_at,
    resolved_at = n.resolved_at,
    observed_success_rate = n.observed_success_rate,
    baseline_success_rate = n.baseline_success_rate,
    drop_pp = n.drop_pp,
    drop_pct = n.drop_pct,
    z_score = n.z_score,
    attempted_transactions = n.attempts,
    affected_transactions = n.affected,
    revenue_at_risk_paise = n.at_risk_paise,
    dominant_failure_reason = n.dominant_reason,
    dominant_failure_share = n.dominant_share_pct,
    detection_rule = 'rolling-baseline-z-v1',
    detection_params = v_params
  FROM _revive_incidents n
  WHERE i.natural_key = n.natural_key;

  INSERT INTO public.incidents (
    incident_code, natural_key, title, severity, status, metric,
    scope_type, scope_label, scope_method, scope_issuer,
    detected_at, window_start, window_end, resolved_at,
    observed_success_rate, baseline_success_rate, drop_pp, drop_pct, z_score,
    attempted_transactions, affected_transactions, revenue_at_risk_paise,
    dominant_failure_reason, dominant_failure_share,
    detection_rule, detection_params)
  SELECT
    n.incident_code, n.natural_key, n.title, n.severity, n.status, 'payment_success_rate',
    n.scope_type, n.scope_label, n.scope_method, n.scope_issuer,
    n.detected_at, n.started_at, n.ended_at, n.resolved_at,
    n.observed_success_rate, n.baseline_success_rate, n.drop_pp, n.drop_pct, n.z_score,
    n.attempts, n.affected, n.at_risk_paise,
    n.dominant_reason, n.dominant_share_pct,
    'rolling-baseline-z-v1', v_params
  FROM _revive_incidents n
  WHERE NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.natural_key = n.natural_key);

  GET DIAGNOSTICS v_opened = ROW_COUNT;
  SELECT count(*) INTO v_total FROM public.incidents;

  -- ---- audit ledger (detection + dataset stages are rebuilt each run) ---
  DELETE FROM public.audit_events WHERE stage IN ('dataset','detection','policy');

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         d.generated_at, 'System', 'dataset', 'Synthetic dataset generated',
         format('%s payment attempts generated from seed %s covering %s to %s IST.',
                to_char(d.transaction_count, 'FM999,999,999'), d.seed,
                to_char(d.window_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'),
                to_char(d.as_of AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI')),
         'info', NULL,
         jsonb_build_object('seed', d.seed, 'rows', d.transaction_count)
  FROM public.dataset_meta d WHERE d.id = 1;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         n.detected_at, 'Detection Engine', 'detection', 'Anomaly detected',
         format('%s success rate %s%% vs %s%% rolling baseline (%s pp drop, z=%s) over %s attempts. Dominant failure signature: %s.',
                n.scope_label, n.observed_success_rate, n.baseline_success_rate,
                n.drop_pp, n.z_score, n.attempts, coalesce(n.dominant_reason, 'n/a')),
         CASE WHEN n.severity IN ('critical','high') THEN 'critical' ELSE 'info' END,
         n.incident_code,
         jsonb_build_object('rule', 'rolling-baseline-z-v1', 'z', n.z_score, 'drop_pp', n.drop_pp)
  FROM _revive_incidents n;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         n.resolved_at, 'Detection Engine', 'detection', 'Metric returned to baseline',
         format('%s recovered to within tolerance of its rolling baseline at %s IST. No recovery action was executed — recovery is observational in this build.',
                n.scope_label, to_char(n.resolved_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI')),
         'success', n.incident_code, '{}'::jsonb
  FROM _revive_incidents n WHERE n.resolved_at IS NOT NULL;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  VALUES (
    'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
    v_as_of, 'Detection Engine', 'detection', 'Detection sweep completed',
    format('Swept %s 30-minute windows across %s scopes over the trailing 48 hours. %s incident(s) open or resolved under rule rolling-baseline-z-v1.',
           96, (SELECT count(DISTINCT scope_key) FROM _revive_runs), v_total),
    'info', NULL, v_params),
  (
    'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
    v_as_of, 'Policy Engine', 'policy', 'Autonomous execution disabled',
    'No recovery action can be proposed or executed in this build. The recovery playbook engine and the policy engine are not enabled yet — REVIVE is running in detect-and-report mode only.',
    'info', NULL, '{}'::jsonb);

  DROP TABLE IF EXISTS _revive_runs;
  DROP TABLE IF EXISTS _revive_incidents;

  RETURN jsonb_build_object('incidents', v_total, 'inserted', v_opened, 'as_of', v_as_of, 'rule', 'rolling-baseline-z-v1');
END;
$$;

COMMENT ON FUNCTION public.revive_detect_incidents() IS
  'Deterministic revenue-incident detection: 30-min windows, trailing 7-day baseline with 2h guard, two-proportion z-test. Idempotent — upserts by natural_key.';

REVOKE ALL ON FUNCTION public.revive_detect_incidents() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revive_generate_dataset() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revive_detect_incidents() TO service_role;
GRANT EXECUTE ON FUNCTION public.revive_generate_dataset() TO service_role;

SELECT public.revive_detect_incidents();
