-- =====================================================================
-- REVIVE AI — Step 1 synthetic dataset generator
--
-- Everything here is DETERMINISTIC: every random draw is md5(seed || key),
-- so the dataset is byte-identical on every run and every machine.
--
-- Dataset window : 2026-08-25 00:00 IST .. 2026-09-03 16:20 IST (~9.7 days)
-- Dashboard clock: dataset_meta.as_of = 2026-09-03 16:20 IST
-- =====================================================================

-- Explicit deny so it is obvious (and lint-clean) that raw payment rows are
-- never reachable from the browser. Aggregates go through SECURITY DEFINER fns.
CREATE POLICY "Raw transactions are not client readable"
  ON public.transactions FOR SELECT TO anon, authenticated USING (false);

-- ---------------------------------------------------------------------
-- Static lookups
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_region(p_city text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE p_city
    WHEN 'Mumbai' THEN 'west'      WHEN 'Pune' THEN 'west'
    WHEN 'Ahmedabad' THEN 'west'   WHEN 'Delhi NCR' THEN 'north'
    WHEN 'Jaipur' THEN 'north'     WHEN 'Lucknow' THEN 'north'
    WHEN 'Chandigarh' THEN 'north' WHEN 'Bengaluru' THEN 'south'
    WHEN 'Hyderabad' THEN 'south'  WHEN 'Chennai' THEN 'south'
    WHEN 'Kochi' THEN 'south'      WHEN 'Kolkata' THEN 'east'
    ELSE 'west' END
$$;

-- Failure taxonomy: who owns the failure. Used by investigation to separate
-- rail/infrastructure failures from customer-side drop-off.
CREATE OR REPLACE FUNCTION public.revive_failure_category(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE p_reason
    WHEN 'BANK_GATEWAY_TIMEOUT'  THEN 'psp'
    WHEN 'PSP_UNAVAILABLE'       THEN 'psp'
    WHEN 'GATEWAY_ERROR'         THEN 'psp'
    WHEN 'ACS_UNAVAILABLE'       THEN 'issuer'
    WHEN 'ISSUER_DECLINED'       THEN 'issuer'
    WHEN 'BANK_REJECT'           THEN 'issuer'
    WHEN 'BANK_MAINTENANCE'      THEN 'issuer'
    WHEN 'RISK_BLOCKED'          THEN 'risk'
    WHEN 'MANDATE_INACTIVE'      THEN 'mandate'
    WHEN 'INVALID_UMRN_SEQUENCE' THEN 'mandate'
    ELSE 'customer' END
$$;

CREATE OR REPLACE FUNCTION public.revive_response_code(p_reason text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE p_reason
    WHEN 'BANK_GATEWAY_TIMEOUT'  THEN 'GW-504'
    WHEN 'PSP_UNAVAILABLE'       THEN 'GW-503'
    WHEN 'GATEWAY_ERROR'         THEN 'GW-500'
    WHEN 'ACS_UNAVAILABLE'       THEN 'ISS-3DS-05'
    WHEN 'ISSUER_DECLINED'       THEN 'ISS-05'
    WHEN 'BANK_REJECT'           THEN 'ISS-14'
    WHEN 'BANK_MAINTENANCE'      THEN 'ISS-91'
    WHEN 'INSUFFICIENT_FUNDS'    THEN 'ISS-51'
    WHEN 'INSUFFICIENT_BALANCE'  THEN 'WLT-51'
    WHEN 'USER_DROPPED'          THEN 'CUS-DROP'
    WHEN 'COLLECT_EXPIRED'       THEN 'UPI-XT'
    WHEN 'SESSION_EXPIRED'       THEN 'NB-XT'
    WHEN 'INVALID_VPA'           THEN 'UPI-VPA'
    WHEN 'CARD_EXPIRED'          THEN 'ISS-54'
    WHEN 'AUTH_3DS_FAILED'       THEN 'ISS-3DS-01'
    WHEN 'WALLET_AUTH_FAILED'    THEN 'WLT-01'
    WHEN 'RISK_BLOCKED'          THEN 'RSK-01'
    WHEN 'MANDATE_INACTIVE'      THEN 'NACH-04'
    WHEN 'INVALID_UMRN_SEQUENCE' THEN 'NACH-22'
    ELSE 'GW-000' END
$$;

-- Baseline (healthy) authorisation probability for an attempt.
-- Instrument base rate, adjusted for issuer quality, customer familiarity,
-- device and ticket size. No scenario effects here — those are layered on top.
CREATE OR REPLACE FUNCTION public.revive_base_sr(
  p_detail text, p_issuer text, p_customer text, p_device text, p_amount bigint)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT GREATEST(0.05, LEAST(0.995,
      CASE p_detail
        WHEN 'upi_collect'          THEN 0.952
        WHEN 'upi_intent'           THEN 0.968
        WHEN 'card_credit'          THEN 0.958
        WHEN 'card_debit'           THEN 0.938
        WHEN 'netbanking'           THEN 0.912
        WHEN 'wallet'               THEN 0.972
        WHEN 'emandate_presentment' THEN 0.882
        ELSE 0.940 END
    + CASE p_issuer
        WHEN 'HDFC' THEN 0.004  WHEN 'ICICI' THEN 0.003 WHEN 'AXIS' THEN 0.000
        WHEN 'SBI'  THEN -0.012 WHEN 'KOTAK' THEN 0.002 WHEN 'PNB'  THEN -0.018
        WHEN 'BOB'  THEN -0.015 WHEN 'YES'   THEN -0.006 WHEN 'IDFC' THEN -0.004
        WHEN 'RBL'  THEN -0.010 WHEN 'AMEX'  THEN 0.006 WHEN 'PAYTM' THEN 0.002
        WHEN 'PHONEPE' THEN 0.004 WHEN 'AMAZONPAY' THEN 0.005 WHEN 'MOBIKWIK' THEN -0.008
        ELSE 0.0 END
    + CASE p_customer WHEN 'new' THEN -0.010 WHEN 'returning' THEN 0.004 ELSE 0.002 END
    + CASE p_device WHEN 'ios' THEN 0.003 WHEN 'web_desktop' THEN 0.002
                    WHEN 'web_mobile' THEN -0.006 ELSE 0.0 END
    + CASE WHEN p_amount > 7500000 THEN -0.012
           WHEN p_amount > 2500000 THEN -0.005 ELSE 0.0 END
  ))::numeric
$$;

-- ---------------------------------------------------------------------
-- Injected incident scenarios (ground truth)
--
-- Each scenario has a scope predicate, an active window, a severity ramp
-- and an impact factor applied multiplicatively to the baseline success
-- probability. Detection never reads these — it only sees the transactions.
-- ---------------------------------------------------------------------
CREATE TYPE public.revive_scenario_effect AS (
  tag                text,
  severity           numeric,
  impact             numeric,
  failure_reason     text,
  reason_share       numeric,
  latency_multiplier numeric
);

CREATE OR REPLACE FUNCTION public.revive_scenario(
  p_ts timestamptz, p_method text, p_detail text, p_issuer text, p_psp text)
RETURNS public.revive_scenario_effect
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
DECLARE r public.revive_scenario_effect;
BEGIN
  r := ROW('baseline', 0::numeric, 0::numeric, NULL::text, 0::numeric, 1::numeric);

  -- S1  UPI collect timeouts on the primary PSP route (live at as_of)
  IF p_method = 'upi' AND p_detail = 'upi_collect' AND p_psp = 'PSP-PRIMARY'
     AND p_ts >= '2026-09-03 14:05:00+05:30'::timestamptz THEN
    RETURN ROW('S1_UPI_PSP_COLLECT_TIMEOUT',
               CASE WHEN p_ts < '2026-09-03 14:25:00+05:30'::timestamptz THEN 0.55 ELSE 1.00 END,
               0.685, 'BANK_GATEWAY_TIMEOUT', 0.80, 7.5)::public.revive_scenario_effect;
  END IF;

  -- S2  SBI issuer 3-D Secure ACS outage on cards
  IF p_method = 'card' AND p_issuer = 'SBI'
     AND p_ts >= '2026-09-03 12:35:00+05:30'::timestamptz
     AND p_ts <  '2026-09-03 15:15:00+05:30'::timestamptz THEN
    RETURN ROW('S2_CARD_ISSUER_3DS_ACS',
               CASE WHEN p_ts < '2026-09-03 12:50:00+05:30'::timestamptz THEN 0.50
                    WHEN p_ts < '2026-09-03 14:50:00+05:30'::timestamptz THEN 1.00
                    ELSE 0.45 END,
               0.410, 'ACS_UNAVAILABLE', 0.72, 1.6)::public.revive_scenario_effect;
  END IF;

  -- S3  e-NACH presentment batch rejected by the sponsor bank
  IF p_method = 'emandate'
     AND p_ts >= '2026-09-03 09:00:00+05:30'::timestamptz
     AND p_ts <  '2026-09-03 09:45:00+05:30'::timestamptz THEN
    RETURN ROW('S3_ENACH_BATCH_REJECT', 1.00, 0.943,
               'INVALID_UMRN_SEQUENCE', 0.92, 1.1)::public.revive_scenario_effect;
  END IF;

  -- S4  Netbanking gateway degradation on the primary PSP route (resolved)
  IF p_method = 'netbanking' AND p_psp = 'PSP-PRIMARY'
     AND p_ts >= '2026-09-02 18:10:00+05:30'::timestamptz
     AND p_ts <  '2026-09-02 19:20:00+05:30'::timestamptz THEN
    RETURN ROW('S4_NETBANKING_PSP_GATEWAY',
               CASE WHEN p_ts < '2026-09-02 19:00:00+05:30'::timestamptz THEN 1.00 ELSE 0.45 END,
               0.648, 'BANK_GATEWAY_TIMEOUT', 0.78, 3.0)::public.revive_scenario_effect;
  END IF;

  RETURN r;
END;
$$;

-- ---------------------------------------------------------------------
-- Generator
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_generate_dataset()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seed    text        := 'REVIVE-SEED-V1';
  v_start   timestamptz := '2026-08-25 00:00:00+05:30';
  v_as_of   timestamptz := '2026-09-03 16:20:00+05:30';
  v_base    numeric     := 327.5;   -- attempts per "weight unit" hour
  -- Diurnal weight per IST hour-of-day (0..23) and per ISO weekday (Mon..Sun)
  v_hour_w  numeric[] := ARRAY[1.05,0.65,0.40,0.30,0.28,0.35,0.55,0.80,1.05,1.25,1.45,1.55,
                               1.60,1.55,1.50,1.45,1.40,1.35,1.40,1.50,1.60,1.65,1.50,1.30];
  v_dow_w   numeric[] := ARRAY[1.00,1.02,1.05,1.08,1.18,1.12,0.95];
  v_cities  text[]    := ARRAY['Mumbai','Delhi NCR','Bengaluru','Hyderabad','Chennai','Pune',
                               'Kolkata','Ahmedabad','Jaipur','Lucknow','Chandigarh','Kochi'];
  v_cityw   numeric[] := ARRAY[17,16,15,9,8,8,7,6,4,4,3,3];
  v_count   integer;
BEGIN
  DELETE FROM public.transactions;

  -- ---- 1. Interactive checkout attempts (UPI / cards / netbanking / wallets)
  WITH hours AS MATERIALIZED (
    SELECT
      h AS hour_start,
      LEAST(1.0, EXTRACT(epoch FROM (v_as_of - h)) / 3600.0)::numeric AS frac,
      GREATEST(0, round(
        v_base
        * v_hour_w[EXTRACT(hour FROM timezone('Asia/Kolkata', h))::int + 1]
        * v_dow_w[EXTRACT(isodow FROM timezone('Asia/Kolkata', h))::int]
        * (0.92 + 0.16 * public.revive_rand('vol:' || to_char(h AT TIME ZONE 'UTC','YYYYMMDDHH24'))::numeric)
        * LEAST(1.0, EXTRACT(epoch FROM (v_as_of - h)) / 3600.0)::numeric
      ))::int AS volume
    FROM generate_series(v_start, v_as_of - interval '1 second', interval '1 hour') h
  ),
  r0 AS MATERIALIZED (
    SELECT h.hour_start, h.frac, k,
           'H' || to_char(h.hour_start AT TIME ZONE 'UTC','YYYYMMDDHH24') || ':' || k AS key
    FROM hours h, generate_series(1, h.volume) k
  ),
  r1 AS MATERIALIZED (
    SELECT r.*,
      r.hour_start + (interval '1 hour' * r.frac * public.revive_rand(r.key || ':t')) AS occurred_at,
      public.revive_pick(r.key || ':m',
        ARRAY['upi','card','netbanking','wallet'], ARRAY[45,32,12,11]::numeric[]) AS method
    FROM r0 r
  ),
  r2 AS MATERIALIZED (
    SELECT r.*,
      CASE r.method
        WHEN 'upi'  THEN public.revive_pick(r.key||':d', ARRAY['upi_collect','upi_intent'], ARRAY[55,45]::numeric[])
        WHEN 'card' THEN public.revive_pick(r.key||':d', ARRAY['card_credit','card_debit'], ARRAY[44,56]::numeric[])
        ELSE r.method
      END AS detail,
      CASE r.method
        WHEN 'upi'  THEN public.revive_pick(r.key||':i',
              ARRAY['HDFC','SBI','ICICI','AXIS','KOTAK','PAYTM','YES','IDFC'], ARRAY[24,19,16,12,9,8,6,6]::numeric[])
        WHEN 'card' THEN public.revive_pick(r.key||':i',
              ARRAY['HDFC','SBI','ICICI','AXIS','KOTAK','RBL','AMEX'], ARRAY[25,26,17,14,9,6,3]::numeric[])
        WHEN 'netbanking' THEN public.revive_pick(r.key||':i',
              ARRAY['HDFC','SBI','ICICI','AXIS','PNB','BOB','KOTAK'], ARRAY[23,24,16,14,10,8,5]::numeric[])
        ELSE public.revive_pick(r.key||':i',
              ARRAY['PAYTM','PHONEPE','AMAZONPAY','MOBIKWIK'], ARRAY[38,34,17,11]::numeric[])
      END AS issuer,
      public.revive_pick(r.key||':p', ARRAY['PSP-PRIMARY','PSP-SECONDARY'], ARRAY[72,28]::numeric[]) AS psp,
      public.revive_pick(r.key||':dev', ARRAY['android','ios','web_desktop','web_mobile'], ARRAY[52,21,17,10]::numeric[]) AS device,
      public.revive_pick(r.key||':c', v_cities, v_cityw) AS city,
      public.revive_pick(r.key||':ct', ARRAY['new','returning','subscriber'], ARRAY[28,57,15]::numeric[]) AS customer_type,
      (CASE public.revive_pick(r.key||':tier', ARRAY['t1','t2','t3','t4','t5'], ARRAY[32,34,22,9,3]::numeric[])
         WHEN 't1' THEN round(public.revive_between(r.key||':amt',    9900,    49900) / 100) * 100
         WHEN 't2' THEN round(public.revive_between(r.key||':amt',   50000,   199900) / 100) * 100
         WHEN 't3' THEN round(public.revive_between(r.key||':amt',  200000,   799900) / 100) * 100
         WHEN 't4' THEN round(public.revive_between(r.key||':amt',  800000,  2499900) / 100) * 100
         ELSE           round(public.revive_between(r.key||':amt', 2500000, 12000000) / 100) * 100
       END)::bigint AS amount_paise
    FROM r1 r
  ),
  r3 AS MATERIALIZED (
    SELECT r.*, sc.tag, sc.severity, sc.impact, sc.failure_reason AS sc_reason,
           sc.reason_share, sc.latency_multiplier,
           public.revive_base_sr(r.detail, r.issuer, r.customer_type, r.device, r.amount_paise) AS base_sr
    FROM r2 r
    CROSS JOIN LATERAL public.revive_scenario(r.occurred_at, r.method, r.detail, r.issuer, r.psp) sc
  ),
  r4 AS MATERIALIZED (
    SELECT r.*,
      (public.revive_rand(r.key||':s')::numeric
         < GREATEST(0.02, r.base_sr * (1 - r.impact * r.severity))) AS success,
      CASE
        WHEN r.sc_reason IS NOT NULL AND public.revive_rand(r.key||':fr')::numeric < r.reason_share
          THEN r.sc_reason
        ELSE CASE r.method
          WHEN 'upi' THEN public.revive_pick(r.key||':fx',
                ARRAY['USER_DROPPED','INSUFFICIENT_FUNDS','INVALID_VPA','COLLECT_EXPIRED','BANK_GATEWAY_TIMEOUT','PSP_UNAVAILABLE','RISK_BLOCKED'],
                ARRAY[30,19,14,11,12,8,6]::numeric[])
          WHEN 'card' THEN public.revive_pick(r.key||':fx',
                ARRAY['ISSUER_DECLINED','INSUFFICIENT_FUNDS','AUTH_3DS_FAILED','RISK_BLOCKED','CARD_EXPIRED','ACS_UNAVAILABLE','GATEWAY_ERROR'],
                ARRAY[28,19,18,11,9,8,7]::numeric[])
          WHEN 'netbanking' THEN public.revive_pick(r.key||':fx',
                ARRAY['USER_DROPPED','BANK_GATEWAY_TIMEOUT','SESSION_EXPIRED','INSUFFICIENT_FUNDS','BANK_MAINTENANCE'],
                ARRAY[34,22,19,17,8]::numeric[])
          ELSE public.revive_pick(r.key||':fx',
                ARRAY['INSUFFICIENT_BALANCE','USER_DROPPED','WALLET_AUTH_FAILED','RISK_BLOCKED'],
                ARRAY[42,31,19,8]::numeric[])
        END
      END AS reason,
      (CASE r.method
         WHEN 'upi'        THEN public.revive_between(r.key||':lat',  900, 3200)
         WHEN 'card'       THEN public.revive_between(r.key||':lat', 1400, 4200)
         WHEN 'netbanking' THEN public.revive_between(r.key||':lat', 2200, 6500)
         ELSE                   public.revive_between(r.key||':lat',  700, 2200)
       END) AS lat_base
    FROM r3 r
  )
  INSERT INTO public.transactions (
    transaction_id, occurred_at, amount_paise, payment_method, method_detail,
    issuer, psp, payment_status, failure_reason, failure_category,
    gateway_response_code, auth_latency_ms, device_type, city, region,
    customer_type, customer_ref, is_retry, retry_count, scenario_tag)
  SELECT
    'TXN-' || to_char(r.hour_start AT TIME ZONE 'UTC','YYYYMMDDHH24') || '-' || lpad(r.k::text, 5, '0'),
    r.occurred_at,
    r.amount_paise,
    r.method,
    r.detail,
    r.issuer,
    r.psp,
    CASE WHEN r.success THEN 'captured' ELSE 'failed' END,
    CASE WHEN r.success THEN NULL ELSE r.reason END,
    CASE WHEN r.success THEN NULL ELSE public.revive_failure_category(r.reason) END,
    CASE WHEN r.success THEN '00'  ELSE public.revive_response_code(r.reason) END,
    LEAST(30000, GREATEST(120, round(r.lat_base * r.latency_multiplier
        * CASE WHEN r.success THEN 1.0 ELSE 1.35 END)))::int,
    r.device,
    r.city,
    public.revive_region(r.city),
    r.customer_type,
    'CUS-' || lpad((floor(public.revive_rand(r.key||':cu') * 48000)::int + 1)::text, 6, '0'),
    false, 0,
    r.tag
  FROM r4 r;

  -- ---- 2. Daily e-NACH / e-mandate subscription presentment batch (09:00 IST)
  WITH days AS MATERIALIZED (
    SELECT b.batch_start,
           GREATEST(0, round(public.revive_between('mnd:' || to_char(b.batch_start AT TIME ZONE 'UTC','YYYYMMDD'), 440, 560)))::int AS n
    FROM (
      SELECT ((d::date) + time '09:00') AT TIME ZONE 'Asia/Kolkata' AS batch_start
      FROM generate_series(timezone('Asia/Kolkata', v_start)::date,
                           timezone('Asia/Kolkata', v_as_of)::date,
                           interval '1 day') d
    ) b
    WHERE b.batch_start >= v_start AND b.batch_start < v_as_of
  ),
  m0 AS MATERIALIZED (
    SELECT d.batch_start, k,
           'M' || to_char(d.batch_start AT TIME ZONE 'UTC','YYYYMMDD') || ':' || k AS key
    FROM days d, generate_series(1, d.n) k
  ),
  m1 AS MATERIALIZED (
    SELECT m.*,
      m.batch_start + (interval '45 minutes' * public.revive_rand(m.key||':t')) AS occurred_at,
      public.revive_pick(m.key||':i', ARRAY['HDFC','SBI','ICICI','AXIS','KOTAK'], ARRAY[26,24,20,18,12]::numeric[]) AS issuer,
      (CASE public.revive_pick(m.key||':tier', ARRAY['s1','s2','s3'], ARRAY[46,38,16]::numeric[])
         WHEN 's1' THEN round(public.revive_between(m.key||':amt',  29900,   99900) / 100) * 100
         WHEN 's2' THEN round(public.revive_between(m.key||':amt', 100000,  299900) / 100) * 100
         ELSE           round(public.revive_between(m.key||':amt', 300000, 1199900) / 100) * 100
       END)::bigint AS amount_paise,
      public.revive_pick(m.key||':c', v_cities, v_cityw) AS city
    FROM m0 m
  ),
  m2 AS MATERIALIZED (
    SELECT m.*, sc.tag, sc.severity, sc.impact, sc.failure_reason AS sc_reason, sc.reason_share, sc.latency_multiplier,
           public.revive_base_sr('emandate_presentment', m.issuer, 'subscriber', 'server', m.amount_paise) AS base_sr
    FROM m1 m
    CROSS JOIN LATERAL public.revive_scenario(m.occurred_at, 'emandate', 'emandate_presentment', m.issuer, 'PSP-PRIMARY') sc
  ),
  m3 AS MATERIALIZED (
    SELECT m.*,
      (public.revive_rand(m.key||':s')::numeric < GREATEST(0.02, m.base_sr * (1 - m.impact * m.severity))) AS success,
      CASE
        WHEN m.sc_reason IS NOT NULL AND public.revive_rand(m.key||':fr')::numeric < m.reason_share THEN m.sc_reason
        ELSE public.revive_pick(m.key||':fx',
              ARRAY['INSUFFICIENT_FUNDS','MANDATE_INACTIVE','BANK_REJECT','INVALID_UMRN_SEQUENCE'],
              ARRAY[54,20,18,8]::numeric[])
      END AS reason
    FROM m2 m
  )
  INSERT INTO public.transactions (
    transaction_id, occurred_at, amount_paise, payment_method, method_detail,
    issuer, psp, payment_status, failure_reason, failure_category,
    gateway_response_code, auth_latency_ms, device_type, city, region,
    customer_type, customer_ref, is_retry, retry_count, scenario_tag)
  SELECT
    'MND-' || to_char(m.batch_start AT TIME ZONE 'UTC','YYYYMMDD') || '-' || lpad(m.k::text, 5, '0'),
    m.occurred_at, m.amount_paise, 'emandate', 'emandate_presentment',
    m.issuer, 'PSP-PRIMARY',
    CASE WHEN m.success THEN 'captured' ELSE 'failed' END,
    CASE WHEN m.success THEN NULL ELSE m.reason END,
    CASE WHEN m.success THEN NULL ELSE public.revive_failure_category(m.reason) END,
    CASE WHEN m.success THEN '00'  ELSE public.revive_response_code(m.reason) END,
    round(public.revive_between(m.key||':lat', 800, 2600) * m.latency_multiplier)::int,
    'server', m.city, public.revive_region(m.city), 'subscriber',
    'SUB-' || lpad((floor(public.revive_rand(m.key||':cu') * 9000)::int + 1)::text, 6, '0'),
    false, 0, m.tag
  FROM m3 m;

  -- ---- 3. Automatic retry attempts on retryable infrastructure failures
  WITH candidates AS MATERIALIZED (
    SELECT t.*
    FROM public.transactions t
    WHERE t.payment_status = 'failed'
      AND t.is_retry = false
      AND t.failure_reason IN ('BANK_GATEWAY_TIMEOUT','PSP_UNAVAILABLE','GATEWAY_ERROR',
                               'ACS_UNAVAILABLE','SESSION_EXPIRED','COLLECT_EXPIRED')
      AND public.revive_rand(t.transaction_id || ':retry')::numeric < 0.35
      AND t.occurred_at < v_as_of - interval '12 minutes'
  ),
  retried AS MATERIALIZED (
    SELECT c.*,
      c.occurred_at + (interval '1 minute' * public.revive_between(c.transaction_id||':rt', 2, 9)) AS retry_at
    FROM candidates c
  ),
  scoped AS MATERIALIZED (
    SELECT r.*, sc.tag AS r_tag, sc.severity, sc.impact, sc.failure_reason AS sc_reason,
           sc.reason_share, sc.latency_multiplier,
           public.revive_base_sr(r.method_detail, r.issuer, r.customer_type, r.device_type, r.amount_paise) AS base_sr
    FROM retried r
    CROSS JOIN LATERAL public.revive_scenario(r.retry_at, r.payment_method, r.method_detail, r.issuer, r.psp) sc
  )
  INSERT INTO public.transactions (
    transaction_id, occurred_at, amount_paise, payment_method, method_detail,
    issuer, psp, payment_status, failure_reason, failure_category,
    gateway_response_code, auth_latency_ms, device_type, city, region,
    customer_type, customer_ref, is_retry, retry_count, parent_transaction_id, scenario_tag)
  SELECT
    'RTY-' || substr(s.transaction_id, 5),
    s.retry_at, s.amount_paise, s.payment_method, s.method_detail,
    s.issuer, s.psp,
    CASE WHEN ok.success THEN 'captured' ELSE 'failed' END,
    CASE WHEN ok.success THEN NULL ELSE s.failure_reason END,
    CASE WHEN ok.success THEN NULL ELSE s.failure_category END,
    CASE WHEN ok.success THEN '00'  ELSE s.gateway_response_code END,
    LEAST(30000, GREATEST(120, round(s.auth_latency_ms * 0.85)))::int,
    s.device_type, s.city, s.region, s.customer_type, s.customer_ref,
    true, 1, s.transaction_id, s.r_tag
  FROM scoped s
  CROSS JOIN LATERAL (
    SELECT (public.revive_rand(s.transaction_id||':rs')::numeric
              < GREATEST(0.02, s.base_sr * (1 - s.impact * s.severity) * 0.72)) AS success
  ) ok
  WHERE s.retry_at < v_as_of;

  SELECT count(*) INTO v_count FROM public.transactions;

  INSERT INTO public.dataset_meta (id, seed, generator_version, merchant_name, merchant_id,
                                   window_start, as_of, transaction_count, generated_at)
  VALUES (1, v_seed, 'gen-v1', 'Zolvex Retail', 'MID 7741208',
          v_start, v_as_of, v_count, now())
  ON CONFLICT (id) DO UPDATE SET
    seed = EXCLUDED.seed,
    generator_version = EXCLUDED.generator_version,
    merchant_name = EXCLUDED.merchant_name,
    merchant_id = EXCLUDED.merchant_id,
    window_start = EXCLUDED.window_start,
    as_of = EXCLUDED.as_of,
    transaction_count = EXCLUDED.transaction_count,
    generated_at = now();

  RETURN jsonb_build_object(
    'seed', v_seed,
    'window_start', v_start,
    'as_of', v_as_of,
    'transaction_count', v_count
  );
END;
$$;

COMMENT ON FUNCTION public.revive_generate_dataset() IS
  'Deterministically (re)generates the full synthetic payments dataset from a fixed seed. Truncates and rebuilds public.transactions.';

REVOKE ALL ON FUNCTION public.revive_generate_dataset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revive_generate_dataset() TO service_role;

-- Run it once so the dataset exists immediately after migration.
SELECT public.revive_generate_dataset();
