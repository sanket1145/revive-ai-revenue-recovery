-- =====================================================================
-- REVIVE AI — Step 1 schema
-- Track 03 (AI Revenue Recovery)
--
-- Data model overview
-- -------------------
-- public.transactions   Immutable payment-attempt ledger. One row per
--                       authorisation attempt (retries are their own row and
--                       point at the parent attempt). All money is stored in
--                       paise (integer minor units) to avoid float drift.
-- public.incidents      Revenue-degradation events produced by the
--                       deterministic detection service. One row per
--                       (scope, outbreak) pair, upserted by natural_key so
--                       re-running detection is idempotent.
-- public.audit_events   Append-only ledger of every system/AI/human action.
-- public.dataset_meta   Singleton describing the generated synthetic dataset
--                       (seed, window, as-of clock, row count).
--
-- The dashboard clock is dataset-derived (dataset_meta.as_of), not wall clock,
-- so the demo is reproducible forever.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Deterministic PRNG helpers.
-- revive_rand() maps an arbitrary string key to a stable value in [0,1)
-- via md5. Same key => same value, on every machine, forever. This is what
-- makes the synthetic dataset seedable and reproducible.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revive_rand(p_key text)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT (('x' || substr(md5('REVIVE-SEED-V1|' || p_key), 1, 7))::bit(28)::int)::double precision
         / 268435456.0
$$;

COMMENT ON FUNCTION public.revive_rand(text) IS
  'Deterministic uniform [0,1) pseudo-random value derived from a string key (md5-based). Seed is baked in so the synthetic dataset is reproducible.';

-- Weighted categorical draw: deterministic given the same key.
CREATE OR REPLACE FUNCTION public.revive_pick(p_key text, p_values text[], p_weights numeric[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
DECLARE
  v_total numeric := 0;
  v_acc   numeric := 0;
  v_r     numeric;
  i       int;
BEGIN
  FOR i IN 1 .. array_length(p_weights, 1) LOOP
    v_total := v_total + p_weights[i];
  END LOOP;

  v_r := public.revive_rand(p_key)::numeric * v_total;

  FOR i IN 1 .. array_length(p_values, 1) LOOP
    v_acc := v_acc + p_weights[i];
    IF v_r < v_acc THEN
      RETURN p_values[i];
    END IF;
  END LOOP;

  RETURN p_values[array_length(p_values, 1)];
END;
$$;

COMMENT ON FUNCTION public.revive_pick(text, text[], numeric[]) IS
  'Deterministic weighted categorical draw used by the synthetic data generator.';

-- Deterministic uniform draw inside a numeric range.
CREATE OR REPLACE FUNCTION public.revive_between(p_key text, p_lo numeric, p_hi numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT p_lo + (p_hi - p_lo) * public.revive_rand(p_key)::numeric
$$;

-- Keeps updated_at honest on mutable rows.
CREATE OR REPLACE FUNCTION public.revive_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------
CREATE TABLE public.transactions (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id        text        NOT NULL UNIQUE,
  occurred_at           timestamptz NOT NULL,
  amount_paise          bigint      NOT NULL CHECK (amount_paise > 0),
  currency              text        NOT NULL DEFAULT 'INR',

  -- instrument
  payment_method        text        NOT NULL
                          CHECK (payment_method IN ('upi','card','netbanking','wallet','emandate')),
  method_detail         text        NOT NULL,   -- upi_collect | upi_intent | card_credit | card_debit | netbanking | wallet | emandate_presentment
  issuer                text        NOT NULL,   -- issuing bank / wallet provider
  psp                   text        NOT NULL,   -- acquiring / PSP route the attempt was sent on

  -- outcome
  payment_status        text        NOT NULL CHECK (payment_status IN ('captured','failed')),
  failure_reason        text,                   -- NULL when captured
  failure_category      text,                   -- issuer | psp | network | customer | risk | mandate
  gateway_response_code text,
  auth_latency_ms       integer     NOT NULL CHECK (auth_latency_ms >= 0),

  -- context used for segmentation during investigation
  device_type           text        NOT NULL,   -- android | ios | web_desktop | web_mobile
  city                  text        NOT NULL,
  region                text        NOT NULL,   -- north | south | east | west
  customer_type         text        NOT NULL,   -- new | returning | subscriber
  customer_ref          text        NOT NULL,

  -- retry chain
  is_retry              boolean     NOT NULL DEFAULT false,
  retry_count           smallint    NOT NULL DEFAULT 0,
  parent_transaction_id text,

  -- ground-truth label for the injected synthetic scenarios.
  -- Written by the generator, deliberately NEVER read by the detection
  -- service; it exists so a human can grade detection output honestly.
  scenario_tag          text        NOT NULL DEFAULT 'baseline',

  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transactions IS
  'Synthetic merchant payment-attempt ledger. Money in paise. One row per authorisation attempt.';
COMMENT ON COLUMN public.transactions.scenario_tag IS
  'Ground-truth label of the injected synthetic scenario. Never used by the detection rule — evaluation only.';

CREATE INDEX transactions_occurred_at_idx     ON public.transactions (occurred_at);
CREATE INDEX transactions_method_time_idx     ON public.transactions (payment_method, occurred_at);
CREATE INDEX transactions_method_issuer_time_idx ON public.transactions (payment_method, issuer, occurred_at);
CREATE INDEX transactions_status_time_idx     ON public.transactions (payment_status, occurred_at);

GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policy on purpose: raw payment records are only
-- reachable through the SECURITY DEFINER aggregate functions.

-- ---------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------
CREATE SEQUENCE public.incident_code_seq START WITH 2401;

CREATE TABLE public.incidents (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_code           text        NOT NULL UNIQUE,          -- INC-2401
  natural_key             text        NOT NULL UNIQUE,          -- scope + outbreak start; makes detection idempotent
  title                   text        NOT NULL,
  severity                text        NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status                  text        NOT NULL CHECK (status IN ('detected','investigating','recovering','monitoring','recovered')),

  -- what degraded
  metric                  text        NOT NULL DEFAULT 'payment_success_rate',
  scope_type              text        NOT NULL CHECK (scope_type IN ('global','payment_method','payment_method_issuer')),
  scope_label             text        NOT NULL,
  scope_method            text,
  scope_issuer            text,

  -- when
  detected_at             timestamptz NOT NULL,
  window_start            timestamptz NOT NULL,
  window_end              timestamptz NOT NULL,
  resolved_at             timestamptz,

  -- signal
  observed_success_rate   numeric(7,3) NOT NULL,
  baseline_success_rate   numeric(7,3) NOT NULL,
  drop_pp                 numeric(7,3) NOT NULL,
  drop_pct                numeric(7,3) NOT NULL,
  z_score                 numeric(8,3) NOT NULL,
  attempted_transactions  integer      NOT NULL DEFAULT 0,
  affected_transactions   integer      NOT NULL DEFAULT 0,
  dominant_failure_reason text,
  dominant_failure_share  numeric(7,3),

  -- money
  revenue_at_risk_paise   bigint       NOT NULL DEFAULT 0,
  revenue_recovered_paise bigint       NOT NULL DEFAULT 0,

  -- provenance
  detection_rule          text         NOT NULL,
  detection_params        jsonb        NOT NULL DEFAULT '{}'::jsonb,

  -- Step 2 (AI investigation) — intentionally empty in Step 1
  root_cause              text,
  diagnosis               text,
  confidence              numeric(5,2),

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.incidents IS
  'Revenue-degradation incidents produced by the deterministic detection service. Upserted by natural_key so detection re-runs are idempotent.';
COMMENT ON COLUMN public.incidents.root_cause IS 'Populated in Step 2 by the AI investigation service. NULL until then.';

CREATE INDEX incidents_detected_at_idx ON public.incidents (detected_at DESC);
CREATE INDEX incidents_status_idx      ON public.incidents (status);

CREATE TRIGGER incidents_touch_updated_at
  BEFORE UPDATE ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.revive_touch_updated_at();

GRANT SELECT ON public.incidents TO anon, authenticated;
GRANT ALL    ON public.incidents TO service_role;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Incidents are publicly readable"
  ON public.incidents FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------
CREATE SEQUENCE public.audit_event_seq START WITH 1001;

CREATE TABLE public.audit_events (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_code    text        NOT NULL UNIQUE,
  occurred_at   timestamptz NOT NULL,
  actor         text        NOT NULL,   -- Detection Engine | REVIVE AI | Policy Engine | Ops Engineer | System
  stage         text        NOT NULL CHECK (stage IN ('dataset','detection','investigation','policy','execution','verification')),
  event         text        NOT NULL,
  detail        text        NOT NULL,
  outcome       text        NOT NULL CHECK (outcome IN ('info','success','blocked','critical')),
  incident_code text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_events IS
  'Append-only audit ledger. Every detection, AI recommendation, policy verdict, approval and verification lands here.';

CREATE INDEX audit_events_occurred_at_idx ON public.audit_events (occurred_at DESC);
CREATE INDEX audit_events_incident_idx    ON public.audit_events (incident_code);

GRANT SELECT ON public.audit_events TO anon, authenticated;
GRANT ALL    ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Audit events are publicly readable"
  ON public.audit_events FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------------
-- dataset_meta (singleton)
-- ---------------------------------------------------------------------
CREATE TABLE public.dataset_meta (
  id                smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seed              text        NOT NULL,
  generator_version text        NOT NULL,
  merchant_name     text        NOT NULL,
  merchant_id       text        NOT NULL,
  window_start      timestamptz NOT NULL,
  as_of             timestamptz NOT NULL,
  transaction_count integer     NOT NULL DEFAULT 0,
  generated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dataset_meta IS
  'Describes the generated synthetic dataset. as_of is the dashboard clock — the app reads "now" from here, not from wall time.';

GRANT SELECT ON public.dataset_meta TO anon, authenticated;
GRANT ALL    ON public.dataset_meta TO service_role;
ALTER TABLE public.dataset_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dataset meta is publicly readable"
  ON public.dataset_meta FOR SELECT TO anon, authenticated USING (true);
