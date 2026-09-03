-- =====================================================================
-- REVIVE AI — Step 1 reporting projections
--
-- The browser never touches public.transactions. The backend materialises
-- two read-only projections whenever detection runs:
--   public.dashboard_snapshot  singleton overview payload
--   public.incident_reports    one investigation payload per incident
-- Both are plain tables with public SELECT policies, so no SECURITY DEFINER
-- function is exposed to the Data API.
-- =====================================================================

CREATE TABLE public.dashboard_snapshot (
  id           smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  payload      jsonb       NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.dashboard_snapshot IS
  'Materialised overview payload (KPIs, trends, breakdowns) recomputed by revive_refresh_projections().';

GRANT SELECT ON public.dashboard_snapshot TO anon, authenticated;
GRANT ALL    ON public.dashboard_snapshot TO service_role;
ALTER TABLE public.dashboard_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dashboard snapshot is publicly readable"
  ON public.dashboard_snapshot FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.incident_reports (
  incident_code text        PRIMARY KEY,
  payload       jsonb       NOT NULL,
  refreshed_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.incident_reports IS
  'Materialised per-incident investigation payload (evidence, segments, sparkline, failure mix, observed recovery).';

GRANT SELECT ON public.incident_reports TO anon, authenticated;
GRANT ALL    ON public.incident_reports TO service_role;
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Incident reports are publicly readable"
  ON public.incident_reports FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------
-- Severity classification. Money at risk AND depth of the drop both matter.
-- ₹1 = 100 paise, ₹1 lakh = 10,000,000 paise.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_severity(p_at_risk_paise bigint, p_drop_pp numeric)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE
    WHEN p_at_risk_paise >= 70000000 AND p_drop_pp >= 20 THEN 'critical'   -- >= Rs 7.0 L
    WHEN p_at_risk_paise >= 15000000 AND p_drop_pp >= 15 THEN 'high'       -- >= Rs 1.5 L
    WHEN p_at_risk_paise >=  4000000 OR  p_drop_pp >= 20 THEN 'medium'     -- >= Rs 0.4 L
    ELSE 'low' END
$$;

-- ---------------------------------------------------------------------
-- Per-incident investigation payload
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_build_incident_report(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i           record;
  v_as_of     timestamptz;
  v_bstart    timestamptz;
  v_bend      timestamptz;
  v_obs       record;
  v_base      record;
  v_ctl_obs   record;
  v_ctl_base  record;
  v_after     record;
  v_evidence  jsonb;
  v_segments  jsonb;
  v_spark     jsonb;
  v_mix       jsonb;
  v_verif     jsonb := '[]'::jsonb;
  v_lost_tot  numeric;
  v_after_end timestamptz;
BEGIN
  SELECT as_of INTO v_as_of FROM public.dataset_meta WHERE id = 1;
  SELECT * INTO i FROM public.incidents WHERE incident_code = p_code;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_bstart := i.window_start - interval '7 days';
  v_bend   := i.window_start - interval '2 hours';

  -- in-scope, during the incident
  SELECT count(*)::int AS att,
         count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ,
         count(*) FILTER (WHERE t.payment_status = 'failed')::int AS fails,
         count(*) FILTER (WHERE t.failure_reason = i.dominant_failure_reason)::int AS domfails,
         coalesce(sum(t.amount_paise), 0)::bigint AS amt,
         coalesce(sum(t.amount_paise) FILTER (WHERE t.payment_status = 'captured'), 0)::bigint AS cap,
         coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY t.auth_latency_ms), 0)::int AS p95
    INTO v_obs
  FROM public.transactions t
  WHERE t.occurred_at >= i.window_start AND t.occurred_at < i.window_end
    AND t.payment_method = i.scope_method
    AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer);

  -- in-scope, rolling baseline
  SELECT count(*)::int AS att,
         count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ,
         count(*) FILTER (WHERE t.payment_status = 'failed')::int AS fails,
         count(*) FILTER (WHERE t.failure_reason = i.dominant_failure_reason)::int AS domfails,
         coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY t.auth_latency_ms), 0)::int AS p95
    INTO v_base
  FROM public.transactions t
  WHERE t.occurred_at >= v_bstart AND t.occurred_at < v_bend
    AND t.payment_method = i.scope_method
    AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer);

  -- control group: everything outside the scope, same clock
  SELECT count(*)::int AS att, count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    INTO v_ctl_obs
  FROM public.transactions t
  WHERE t.occurred_at >= i.window_start AND t.occurred_at < i.window_end
    AND NOT (t.payment_method = i.scope_method AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer));

  SELECT count(*)::int AS att, count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    INTO v_ctl_base
  FROM public.transactions t
  WHERE t.occurred_at >= v_bstart AND t.occurred_at < v_bend
    AND NOT (t.payment_method = i.scope_method AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer));

  v_evidence := jsonb_build_array(
    jsonb_build_object(
      'signal',  i.scope_label || ' success rate',
      'unit',    'pct',
      'observed', CASE WHEN v_obs.att > 0 THEN round(100.0 * v_obs.succ / v_obs.att, 2) ELSE NULL END,
      'baseline', CASE WHEN v_base.att > 0 THEN round(100.0 * v_base.succ / v_base.att, 2) ELSE NULL END,
      'worseWhen', 'lower'),
    jsonb_build_object(
      'signal',  coalesce(public.revive_reason_label(i.dominant_failure_reason), 'Dominant failure') || ' — share of attempts',
      'unit',    'pct',
      'observed', CASE WHEN v_obs.att > 0 THEN round(100.0 * v_obs.domfails / v_obs.att, 2) ELSE NULL END,
      'baseline', CASE WHEN v_base.att > 0 THEN round(100.0 * v_base.domfails / v_base.att, 2) ELSE NULL END,
      'worseWhen', 'higher'),
    jsonb_build_object(
      'signal',  'Authorisation latency p95',
      'unit',    'ms',
      'observed', v_obs.p95,
      'baseline', v_base.p95,
      'worseWhen', 'higher'),
    jsonb_build_object(
      'signal',  'Attempt volume in scope',
      'unit',    'count',
      'observed', v_obs.att,
      'baseline', CASE WHEN v_base.att > 0
                       THEN round(v_base.att::numeric
                            * (EXTRACT(epoch FROM (i.window_end - i.window_start))
                               / NULLIF(EXTRACT(epoch FROM (v_bend - v_bstart)), 0)))
                       ELSE NULL END,
      'worseWhen', 'lower'),
    jsonb_build_object(
      'signal',  'Control — all traffic outside scope',
      'unit',    'pct',
      'observed', CASE WHEN v_ctl_obs.att > 0 THEN round(100.0 * v_ctl_obs.succ / v_ctl_obs.att, 2) ELSE NULL END,
      'baseline', CASE WHEN v_ctl_base.att > 0 THEN round(100.0 * v_ctl_base.succ / v_ctl_base.att, 2) ELSE NULL END,
      'worseWhen', 'lower')
  );

  -- ---- affected sub-segments (route-level drill-down) -----------------
  WITH seg_obs AS (
    SELECT t.method_detail || ' · ' || t.psp AS segment,
           count(*)::int AS att,
           count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ,
           coalesce(sum(t.amount_paise) FILTER (WHERE t.payment_status = 'captured'), 0)::bigint AS cap,
           coalesce(sum(t.amount_paise), 0)::bigint AS amt
    FROM public.transactions t
    WHERE t.occurred_at >= i.window_start AND t.occurred_at < i.window_end
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer)
    GROUP BY 1
  ),
  seg_base AS (
    SELECT t.method_detail || ' · ' || t.psp AS segment,
           count(*)::int AS att,
           count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    FROM public.transactions t
    WHERE t.occurred_at >= v_bstart AND t.occurred_at < v_bend
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer)
    GROUP BY 1
  ),
  joined AS (
    SELECT o.segment, o.att, o.succ, o.amt, o.cap,
           CASE WHEN b.att >= 30 THEN b.succ::numeric / b.att ELSE NULL END AS b_sr
    FROM seg_obs o LEFT JOIN seg_base b USING (segment)
  ),
  lost AS (
    SELECT j.*,
           GREATEST(0, round(coalesce(j.b_sr, 0) * j.att - j.succ))::int AS lost_txns,
           GREATEST(0, round(coalesce(j.b_sr, 0) * j.amt - j.cap))::bigint AS lost_paise
    FROM joined j
  )
  SELECT coalesce(sum(lost_txns), 0), jsonb_agg(x ORDER BY x_lost DESC)
    INTO v_lost_tot, v_segments
  FROM (
    SELECT lost_txns AS x_lost,
           jsonb_build_object('segment', segment, 'attempts', att, 'lostTransactions', lost_txns,
                              'lostPaise', lost_paise) AS x,
           lost_txns
    FROM lost ORDER BY lost_txns DESC LIMIT 6
  ) s;

  -- normalise impact share against the visible segments
  IF v_segments IS NOT NULL AND v_lost_tot > 0 THEN
    SELECT jsonb_agg(e || jsonb_build_object(
             'impactPct', round(100.0 * (e->>'lostTransactions')::numeric / v_lost_tot, 1)))
      INTO v_segments
    FROM jsonb_array_elements(v_segments) e;
  END IF;

  -- ---- success-rate history (last 14 active 30-min buckets) -----------
  WITH buckets AS (
    SELECT to_timestamp(floor(extract(epoch FROM t.occurred_at) / 1800) * 1800) AS w,
           count(*)::int AS att,
           count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    FROM public.transactions t
    WHERE t.occurred_at >= i.window_start - interval '7 days'
      AND t.occurred_at <  LEAST(v_as_of, i.window_end + interval '2 hours')
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer)
    GROUP BY 1
    HAVING count(*) >= 5
  ),
  tail AS (SELECT * FROM buckets ORDER BY w DESC LIMIT 14)
  SELECT jsonb_agg(jsonb_build_object(
           'ts', w,
           'sr', round(100.0 * succ / att, 2),
           'attempts', att,
           'inIncident', (w >= i.window_start AND w < i.window_end)) ORDER BY w)
    INTO v_spark
  FROM tail;

  -- ---- failure signature mix -----------------------------------------
  WITH obs AS (
    SELECT t.failure_reason, count(*)::int AS n
    FROM public.transactions t
    WHERE t.occurred_at >= i.window_start AND t.occurred_at < i.window_end
      AND t.payment_status = 'failed'
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer)
    GROUP BY 1
  ),
  base AS (
    SELECT t.failure_reason, count(*)::int AS n
    FROM public.transactions t
    WHERE t.occurred_at >= v_bstart AND t.occurred_at < v_bend
      AND t.payment_status = 'failed'
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer)
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
           'reason', o.failure_reason,
           'label', public.revive_reason_label(o.failure_reason),
           'category', public.revive_failure_category(o.failure_reason),
           'count', o.n,
           'sharePct', round(100.0 * o.n / NULLIF(v_obs.fails, 0), 1),
           'baselineSharePct', round(100.0 * coalesce(b.n, 0) / NULLIF(v_base.fails, 0), 1)
         ) ORDER BY o.n DESC)
    INTO v_mix
  FROM obs o LEFT JOIN base b USING (failure_reason);

  -- ---- observed metric recovery (NOT an executed recovery) -------------
  IF i.resolved_at IS NOT NULL THEN
    v_after_end := LEAST(v_as_of, i.window_end + interval '90 minutes');
    SELECT count(*)::int AS att,
           count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ,
           count(*) FILTER (WHERE t.failure_reason = i.dominant_failure_reason)::int AS domfails,
           coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY t.auth_latency_ms), 0)::int AS p95
      INTO v_after
    FROM public.transactions t
    WHERE t.occurred_at >= i.window_end AND t.occurred_at < v_after_end
      AND t.payment_method = i.scope_method
      AND (i.scope_issuer IS NULL OR t.issuer = i.scope_issuer);

    IF v_after.att > 0 THEN
      v_verif := jsonb_build_array(
        jsonb_build_object('metric', i.scope_label || ' success rate', 'unit', 'pct',
          'before', round(100.0 * v_obs.succ / NULLIF(v_obs.att, 0), 2),
          'after',  round(100.0 * v_after.succ / v_after.att, 2)),
        jsonb_build_object('metric', coalesce(public.revive_reason_label(i.dominant_failure_reason), 'Dominant failure') || ' share', 'unit', 'pct',
          'before', round(100.0 * v_obs.domfails / NULLIF(v_obs.att, 0), 2),
          'after',  round(100.0 * v_after.domfails / v_after.att, 2)),
        jsonb_build_object('metric', 'Authorisation latency p95', 'unit', 'ms',
          'before', v_obs.p95, 'after', v_after.p95)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'incidentCode', i.incident_code,
    'scopeLabel',   i.scope_label,
    'baselineWindow', jsonb_build_object('start', v_bstart, 'end', v_bend),
    'evidence',     v_evidence,
    'segments',     coalesce(v_segments, '[]'::jsonb),
    'sparkline',    coalesce(v_spark, '[]'::jsonb),
    'failureMix',   coalesce(v_mix, '[]'::jsonb),
    'verification', v_verif,
    'observed', jsonb_build_object(
      'attempts', v_obs.att, 'successes', v_obs.succ,
      'attemptedPaise', v_obs.amt, 'capturedPaise', v_obs.cap)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revive_build_incident_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revive_build_incident_report(text) TO service_role;

-- ---------------------------------------------------------------------
-- Overview snapshot + all incident reports
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_refresh_projections()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta        record;
  v_as_of       timestamptz;
  v_day_start   timestamptz;
  v_elapsed     interval;
  v_today       record;
  v_prior       record;
  v_risk_today  bigint;
  v_risk_prev   bigint;
  v_recovered   bigint;
  v_active      int;
  v_active_prev int;
  v_rev_trend   jsonb;
  v_sr_trend    jsonb;
  v_methods     jsonb;
  v_risk_rank   jsonb;
  v_payload     jsonb;
BEGIN
  SELECT * INTO v_meta FROM public.dataset_meta WHERE id = 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'dataset_meta missing'); END IF;

  v_as_of     := v_meta.as_of;
  v_day_start := date_trunc('day', v_as_of AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  v_elapsed   := v_as_of - v_day_start;

  SELECT count(*)::int AS att,
         count(*) FILTER (WHERE payment_status = 'captured')::int AS succ,
         coalesce(sum(amount_paise) FILTER (WHERE payment_status = 'captured'), 0)::bigint AS rev
    INTO v_today
  FROM public.transactions
  WHERE occurred_at >= v_day_start AND occurred_at < v_as_of;

  SELECT coalesce(avg(x.rev), 0)::bigint AS rev,
         coalesce(avg(x.att), 0)::numeric AS att,
         coalesce(avg(x.succ), 0)::numeric AS succ
    INTO v_prior
  FROM generate_series(1, 7) g
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(t.amount_paise) FILTER (WHERE t.payment_status = 'captured'), 0)::bigint AS rev,
           count(*)::int AS att,
           count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    FROM public.transactions t
    WHERE t.occurred_at >= v_day_start - make_interval(days => g)
      AND t.occurred_at <  v_day_start - make_interval(days => g) + v_elapsed
  ) x;

  SELECT coalesce(sum(revenue_at_risk_paise), 0)::bigint INTO v_risk_today
  FROM public.incidents WHERE detected_at >= v_day_start;

  SELECT coalesce(sum(revenue_at_risk_paise), 0)::bigint INTO v_risk_prev
  FROM public.incidents
  WHERE detected_at >= v_day_start - interval '1 day' AND detected_at < v_day_start;

  SELECT coalesce(sum(revenue_recovered_paise), 0)::bigint INTO v_recovered FROM public.incidents;

  SELECT count(*)::int INTO v_active FROM public.incidents WHERE status <> 'recovered';
  SELECT count(*)::int INTO v_active_prev
  FROM public.incidents
  WHERE detected_at < v_as_of - interval '24 hours'
    AND (resolved_at IS NULL OR resolved_at > v_as_of - interval '24 hours');

  -- hourly revenue + success-rate trend for the current IST day, each hour
  -- compared with the mean of the same clock hour over the prior 7 days.
  WITH slots AS (
    SELECT h AS slot_start,
           LEAST(h + interval '1 hour', v_as_of) - h AS slot_len
    FROM generate_series(v_day_start, v_as_of - interval '1 second', interval '1 hour') h
  ),
  cur AS (
    SELECT s.slot_start, s.slot_len,
           coalesce(sum(t.amount_paise) FILTER (WHERE t.payment_status = 'captured'), 0)::bigint AS rev,
           count(t.id)::int AS att,
           count(t.id) FILTER (WHERE t.payment_status = 'captured')::int AS succ
    FROM slots s
    LEFT JOIN public.transactions t
      ON t.occurred_at >= s.slot_start AND t.occurred_at < s.slot_start + s.slot_len
    GROUP BY s.slot_start, s.slot_len
  ),
  base AS (
    SELECT c.slot_start,
           coalesce(avg(b.rev), 0)::bigint AS rev,
           coalesce(sum(b.succ), 0)::numeric AS succ,
           coalesce(sum(b.att), 0)::numeric AS att
    FROM cur c
    CROSS JOIN generate_series(1, 7) g
    CROSS JOIN LATERAL (
      SELECT coalesce(sum(t.amount_paise) FILTER (WHERE t.payment_status = 'captured'), 0)::bigint AS rev,
             count(*)::int AS att,
             count(*) FILTER (WHERE t.payment_status = 'captured')::int AS succ
      FROM public.transactions t
      WHERE t.occurred_at >= c.slot_start - make_interval(days => g)
        AND t.occurred_at <  c.slot_start - make_interval(days => g) + c.slot_len
    ) b
    GROUP BY c.slot_start
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'ts', c.slot_start,
      'time', to_char(c.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
      'revenuePaise', c.rev,
      'baselinePaise', b.rev) ORDER BY c.slot_start),
    jsonb_agg(jsonb_build_object(
      'ts', c.slot_start,
      'time', to_char(c.slot_start AT TIME ZONE 'Asia/Kolkata', 'HH24:MI'),
      'sr', CASE WHEN c.att > 0 THEN round(100.0 * c.succ / c.att, 2) ELSE NULL END,
      'baseline', CASE WHEN b.att > 0 THEN round(100.0 * b.succ / b.att, 2) ELSE NULL END,
      'attempts', c.att) ORDER BY c.slot_start)
    INTO v_rev_trend, v_sr_trend
  FROM cur c JOIN base b ON b.slot_start = c.slot_start;

  -- payment-method breakdown: today vs 7-day baseline
  WITH today AS (
    SELECT payment_method AS m, count(*)::int AS att,
           count(*) FILTER (WHERE payment_status = 'captured')::int AS succ,
           coalesce(sum(amount_paise) FILTER (WHERE payment_status = 'captured'), 0)::bigint AS rev
    FROM public.transactions
    WHERE occurred_at >= v_day_start AND occurred_at < v_as_of
    GROUP BY 1
  ),
  base AS (
    SELECT payment_method AS m, count(*)::int AS att,
           count(*) FILTER (WHERE payment_status = 'captured')::int AS succ
    FROM public.transactions
    WHERE occurred_at >= v_day_start - interval '7 days' AND occurred_at < v_day_start
    GROUP BY 1
  ),
  tot AS (SELECT sum(att)::numeric AS att FROM today)
  SELECT jsonb_agg(jsonb_build_object(
           'method', t.m,
           'label', public.revive_method_label(t.m),
           'sharePct', round(100.0 * t.att / NULLIF((SELECT att FROM tot), 0), 1),
           'attempts', t.att,
           'revenuePaise', t.rev,
           'srPct', round(100.0 * t.succ / NULLIF(t.att, 0), 2),
           'baselineSrPct', round(100.0 * b.succ / NULLIF(b.att, 0), 2),
           'status', CASE
             WHEN b.att IS NULL OR b.att = 0 THEN 'healthy'
             WHEN (b.succ::numeric / b.att - t.succ::numeric / NULLIF(t.att, 0)) * 100 >= 6 THEN 'degraded'
             WHEN (b.succ::numeric / b.att - t.succ::numeric / NULLIF(t.att, 0)) * 100 >= 2 THEN 'watch'
             ELSE 'healthy' END
         ) ORDER BY t.att DESC)
    INTO v_methods
  FROM today t LEFT JOIN base b ON b.m = t.m;

  SELECT jsonb_agg(jsonb_build_object(
           'code', incident_code, 'severity', severity, 'status', status,
           'scopeLabel', scope_label, 'atRiskPaise', revenue_at_risk_paise) ORDER BY revenue_at_risk_paise DESC)
    INTO v_risk_rank
  FROM (SELECT * FROM public.incidents ORDER BY revenue_at_risk_paise DESC LIMIT 6) r;

  v_payload := jsonb_build_object(
    'asOf', v_as_of,
    'dayStart', v_day_start,
    'kpis', jsonb_build_object(
      'revenueTodayPaise', v_today.rev,
      'revenueTodayDeltaPct', CASE WHEN v_prior.rev > 0
        THEN round(100.0 * (v_today.rev - v_prior.rev) / v_prior.rev, 1) ELSE NULL END,
      'revenueAtRiskPaise', v_risk_today,
      'revenueAtRiskDeltaPct', CASE WHEN v_risk_prev > 0
        THEN round(100.0 * (v_risk_today - v_risk_prev) / v_risk_prev, 1) ELSE NULL END,
      'revenueRecoveredPaise', v_recovered,
      'recoveryRatePct', CASE WHEN v_risk_today > 0
        THEN round(100.0 * v_recovered / v_risk_today, 1) ELSE 0 END,
      'activeIncidents', v_active,
      'activeIncidentsDelta', v_active - v_active_prev,
      'attemptsToday', v_today.att,
      'successRatePct', CASE WHEN v_today.att > 0
        THEN round(100.0 * v_today.succ / v_today.att, 2) ELSE NULL END,
      'successRateBaselinePct', CASE WHEN v_prior.att > 0
        THEN round(100.0 * v_prior.succ / v_prior.att, 2) ELSE NULL END),
    'revenueTrend', coalesce(v_rev_trend, '[]'::jsonb),
    'successRateTrend', coalesce(v_sr_trend, '[]'::jsonb),
    'methodBreakdown', coalesce(v_methods, '[]'::jsonb),
    'riskByIncident', coalesce(v_risk_rank, '[]'::jsonb),
    'system', jsonb_build_object(
      'seed', v_meta.seed,
      'generatorVersion', v_meta.generator_version,
      'merchantName', v_meta.merchant_name,
      'merchantId', v_meta.merchant_id,
      'windowStart', v_meta.window_start,
      'transactionCount', v_meta.transaction_count,
      'detectionRule', 'rolling-baseline-z-v1',
      'autonomousExecution', false));

  INSERT INTO public.dashboard_snapshot (id, payload, refreshed_at)
  VALUES (1, v_payload, now())
  ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = now();

  DELETE FROM public.incident_reports r
  WHERE NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.incident_code = r.incident_code);

  INSERT INTO public.incident_reports (incident_code, payload, refreshed_at)
  SELECT i.incident_code, public.revive_build_incident_report(i.incident_code), now()
  FROM public.incidents i
  ON CONFLICT (incident_code) DO UPDATE SET payload = EXCLUDED.payload, refreshed_at = now();

  RETURN jsonb_build_object('snapshot', true,
                            'reports', (SELECT count(*) FROM public.incident_reports));
END;
$$;

REVOKE ALL ON FUNCTION public.revive_refresh_projections() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revive_refresh_projections() TO service_role;

-- ---------------------------------------------------------------------
-- Detection now uses revive_severity() and refreshes the projections.
-- (Body is otherwise identical to the previous revision.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_detect_incidents()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_win            int      := 1800;
  v_horizon        interval := interval '48 hours';
  v_lookback       interval := interval '7 days';
  v_guard          interval := interval '2 hours';
  v_min_attempts   int      := 20;
  v_min_base_att   int      := 300;
  v_min_drop_pp    numeric  := 8.0;
  v_min_drop_rel   numeric  := 0.15;
  v_min_z          numeric  := 3.0;
  v_min_windows    int      := 2;
  v_gap            interval := interval '60 minutes';
  v_as_of          timestamptz;
  v_params         jsonb;
  v_opened         int := 0;
  v_total          int := 0;
BEGIN
  SELECT as_of INTO v_as_of FROM public.dataset_meta WHERE id = 1;
  IF v_as_of IS NULL THEN RETURN jsonb_build_object('error', 'dataset_meta missing'); END IF;

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
           payment_method || '|' || issuer, occurred_at, payment_status, amount_paise
    FROM public.transactions
  ),
  allwin AS (
    SELECT scope_key, scope_type, scope_method, scope_issuer,
           to_timestamp(floor(extract(epoch FROM occurred_at) / v_win) * v_win) AS w_start,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE payment_status = 'captured')::int AS successes,
           sum(amount_paise)::bigint AS attempted_paise,
           coalesce(sum(amount_paise) FILTER (WHERE payment_status = 'captured'), 0)::bigint AS captured_paise
    FROM scoped GROUP BY 1,2,3,4,5
  ),
  evalwin AS (
    SELECT * FROM allwin WHERE w_start >= v_as_of - v_horizon AND w_start < v_as_of
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
    SELECT w.*, (w.successes::numeric / w.attempts) AS obs_sr,
           (w.b_successes::numeric / NULLIF(w.b_attempts, 0)) AS b_sr
    FROM withbase w
    WHERE w.attempts >= v_min_attempts AND w.b_attempts >= v_min_base_att
  ),
  scored AS (
    SELECT m.*, (m.b_sr - m.obs_sr) * 100 AS drop_pp,
      CASE WHEN m.b_sr > 0 THEN (m.b_sr - m.obs_sr) / m.b_sr ELSE 0 END AS drop_rel,
      CASE WHEN m.b_sr > 0 AND m.b_sr < 1
           THEN (m.b_sr - m.obs_sr) / sqrt(m.b_sr * (1 - m.b_sr) / m.attempts) ELSE 0 END AS z
    FROM metrics m
  ),
  flagged AS (
    SELECT * FROM scored
    WHERE drop_pp >= v_min_drop_pp AND drop_rel >= v_min_drop_rel AND z >= v_min_z
  ),
  marked AS (
    SELECT f.*, CASE WHEN lag(f.w_start) OVER (PARTITION BY f.scope_key ORDER BY f.w_start)
                          >= f.w_start - v_gap THEN 0 ELSE 1 END AS is_new
    FROM flagged f
  ),
  islands AS (
    SELECT m.*, sum(m.is_new) OVER (PARTITION BY m.scope_key ORDER BY m.w_start
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS island
    FROM marked m
  )
  SELECT i.scope_key, i.scope_type, i.scope_method, i.scope_issuer,
    min(i.w_start) AS started_at,
    max(i.w_start) + make_interval(secs => v_win) AS ended_at,
    count(*)::int AS window_count,
    sum(i.attempts)::int AS attempts,
    sum(i.successes)::int AS successes,
    sum(i.attempted_paise)::bigint AS attempted_paise,
    sum(i.captured_paise)::bigint AS captured_paise,
    (sum(i.attempts * i.b_sr) / sum(i.attempts))::numeric AS baseline_sr,
    (sum(i.successes)::numeric / sum(i.attempts)) AS observed_sr,
    GREATEST(0, round(sum(i.attempts * i.b_sr) - sum(i.successes)))::int AS affected,
    GREATEST(0, round(sum(i.attempted_paise * i.b_sr) - sum(i.captured_paise)))::bigint AS at_risk_paise,
    max(i.z)::numeric AS z_max,
    false AS suppressed,
    NULL::text AS dominant_reason,
    NULL::numeric AS dominant_share
  FROM islands i
  GROUP BY 1,2,3,4, i.island
  HAVING count(*) >= v_min_windows;

  UPDATE _revive_runs m SET suppressed = true
  WHERE m.scope_type = 'payment_method'
    AND EXISTS (SELECT 1 FROM _revive_runs i
                WHERE i.scope_type = 'payment_method_issuer'
                  AND i.scope_method = m.scope_method
                  AND i.started_at < m.ended_at AND i.ended_at > m.started_at
                  AND i.affected >= 0.60 * GREATEST(m.affected, 1));

  UPDATE _revive_runs i SET suppressed = true
  WHERE i.scope_type = 'payment_method_issuer'
    AND EXISTS (SELECT 1 FROM _revive_runs m
                WHERE m.scope_type = 'payment_method' AND m.suppressed = false
                  AND m.scope_method = i.scope_method
                  AND m.started_at < i.ended_at AND m.ended_at > i.started_at);

  DELETE FROM _revive_runs WHERE suppressed;

  UPDATE _revive_runs r
  SET dominant_reason = d.failure_reason, dominant_share = d.share
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
      GROUP BY t.failure_reason ORDER BY count(*) DESC LIMIT 1
    ) f
  ) d
  WHERE r.scope_key = d.scope_key AND r.started_at = d.started_at;

  DROP TABLE IF EXISTS _revive_incidents;
  CREATE TEMP TABLE _revive_incidents AS
  SELECT
    r.scope_key || '@' || to_char(r.started_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MI') AS natural_key,
    'INC-' || (2400 + row_number() OVER (ORDER BY r.started_at, r.scope_key))::text AS incident_code,
    public.revive_method_label(r.scope_method) || ' success rate '
      || CASE WHEN (r.baseline_sr - r.observed_sr) * 100 >= 40 THEN 'collapse'
              WHEN (r.baseline_sr - r.observed_sr) * 100 >= 20 THEN 'degradation'
              ELSE 'dip' END
      || ' — ' || public.revive_reason_label(r.dominant_reason)
      || CASE WHEN r.scope_issuer IS NOT NULL THEN ' · ' || r.scope_issuer ELSE '' END AS title,
    public.revive_severity(r.at_risk_paise, (r.baseline_sr - r.observed_sr) * 100) AS severity,
    CASE WHEN r.ended_at >= v_as_of - interval '60 minutes' THEN 'detected'
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
    round(CASE WHEN r.baseline_sr > 0 THEN (r.baseline_sr - r.observed_sr) / r.baseline_sr * 100 ELSE 0 END, 3) AS drop_pct,
    round(r.z_max, 3) AS z_score,
    r.attempts, r.affected, r.at_risk_paise,
    r.dominant_reason, round(coalesce(r.dominant_share, 0) * 100, 3) AS dominant_share_pct
  FROM _revive_runs r;

  DELETE FROM public.incidents i
  WHERE NOT EXISTS (SELECT 1 FROM _revive_incidents n WHERE n.natural_key = i.natural_key);

  UPDATE public.incidents i SET
    incident_code = n.incident_code, title = n.title, severity = n.severity, status = n.status,
    scope_type = n.scope_type, scope_label = n.scope_label,
    scope_method = n.scope_method, scope_issuer = n.scope_issuer,
    detected_at = n.detected_at, window_start = n.started_at, window_end = n.ended_at,
    resolved_at = n.resolved_at,
    observed_success_rate = n.observed_success_rate,
    baseline_success_rate = n.baseline_success_rate,
    drop_pp = n.drop_pp, drop_pct = n.drop_pct, z_score = n.z_score,
    attempted_transactions = n.attempts, affected_transactions = n.affected,
    revenue_at_risk_paise = n.at_risk_paise,
    dominant_failure_reason = n.dominant_reason, dominant_failure_share = n.dominant_share_pct,
    detection_rule = 'rolling-baseline-z-v1', detection_params = v_params
  FROM _revive_incidents n
  WHERE i.natural_key = n.natural_key;

  INSERT INTO public.incidents (
    incident_code, natural_key, title, severity, status, metric,
    scope_type, scope_label, scope_method, scope_issuer,
    detected_at, window_start, window_end, resolved_at,
    observed_success_rate, baseline_success_rate, drop_pp, drop_pct, z_score,
    attempted_transactions, affected_transactions, revenue_at_risk_paise,
    dominant_failure_reason, dominant_failure_share, detection_rule, detection_params)
  SELECT n.incident_code, n.natural_key, n.title, n.severity, n.status, 'payment_success_rate',
    n.scope_type, n.scope_label, n.scope_method, n.scope_issuer,
    n.detected_at, n.started_at, n.ended_at, n.resolved_at,
    n.observed_success_rate, n.baseline_success_rate, n.drop_pp, n.drop_pct, n.z_score,
    n.attempts, n.affected, n.at_risk_paise,
    n.dominant_reason, n.dominant_share_pct, 'rolling-baseline-z-v1', v_params
  FROM _revive_incidents n
  WHERE NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.natural_key = n.natural_key);

  GET DIAGNOSTICS v_opened = ROW_COUNT;
  SELECT count(*) INTO v_total FROM public.incidents;

  DELETE FROM public.audit_events WHERE stage IN ('dataset','detection','policy');

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         d.generated_at, 'System', 'dataset', 'Synthetic dataset generated',
         format('%s payment attempts generated from seed %s covering %s to %s IST.',
                to_char(d.transaction_count, 'FM999,999,999'), d.seed,
                to_char(d.window_start AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'),
                to_char(d.as_of AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI')),
         'info', NULL, jsonb_build_object('seed', d.seed, 'rows', d.transaction_count)
  FROM public.dataset_meta d WHERE d.id = 1;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         n.detected_at, 'Detection Engine', 'detection', 'Anomaly detected',
         format('%s success rate %s%% vs %s%% rolling baseline (%s pp drop, z=%s) across %s attempts. Dominant failure signature: %s.',
                n.scope_label, n.observed_success_rate, n.baseline_success_rate,
                n.drop_pp, n.z_score, n.attempts, coalesce(n.dominant_reason, 'n/a')),
         CASE WHEN n.severity IN ('critical','high') THEN 'critical' ELSE 'info' END,
         n.incident_code,
         jsonb_build_object('rule', 'rolling-baseline-z-v1', 'z', n.z_score, 'drop_pp', n.drop_pp)
  FROM _revive_incidents n;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  SELECT 'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
         n.resolved_at, 'Detection Engine', 'detection', 'Metric returned to baseline',
         format('%s recovered to within tolerance of its rolling baseline at %s IST. No recovery action was executed — this build observes recovery, it does not perform it.',
                n.scope_label, to_char(n.resolved_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI')),
         'success', n.incident_code, '{}'::jsonb
  FROM _revive_incidents n WHERE n.resolved_at IS NOT NULL;

  INSERT INTO public.audit_events (event_code, occurred_at, actor, stage, event, detail, outcome, incident_code, metadata)
  VALUES (
    'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
    v_as_of, 'Detection Engine', 'detection', 'Detection sweep completed',
    format('Swept 96 thirty-minute windows across %s scopes over the trailing 48 hours under rule rolling-baseline-z-v1. %s incident(s) on the board.',
           (SELECT count(DISTINCT scope_key) FROM _revive_runs), v_total),
    'info', NULL, v_params),
  (
    'AUD-' || lpad(nextval('public.audit_event_seq')::text, 5, '0'),
    v_as_of, 'Policy Engine', 'policy', 'Autonomous execution disabled',
    'No recovery action can be proposed or executed in this build. The recovery playbook engine and the policy engine are not enabled yet — REVIVE is running in detect-and-report mode only.',
    'info', NULL, '{}'::jsonb);

  DROP TABLE IF EXISTS _revive_runs;
  DROP TABLE IF EXISTS _revive_incidents;

  PERFORM public.revive_refresh_projections();

  RETURN jsonb_build_object('incidents', v_total, 'inserted', v_opened,
                            'as_of', v_as_of, 'rule', 'rolling-baseline-z-v1');
END;
$$;

REVOKE ALL ON FUNCTION public.revive_detect_incidents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revive_detect_incidents() TO service_role;

SELECT public.revive_detect_incidents();
