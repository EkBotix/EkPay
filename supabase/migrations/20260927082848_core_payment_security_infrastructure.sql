BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail closed on inconsistent existing rows; never silently repair payment history.
ALTER TABLE public.merchant_brands ADD UNIQUE (merchant_id, id);
ALTER TABLE public.provider_accounts ADD UNIQUE (merchant_id, id),
  ADD UNIQUE (merchant_id, id, provider),
  ADD COLUMN receiver_identity_hash text NOT NULL CHECK (receiver_identity_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN account_encryption_key_reference text NOT NULL CHECK (length(account_encryption_key_reference) BETWEEN 1 AND 128);
ALTER TABLE public.payment_intents ADD UNIQUE (merchant_id, id);
ALTER TABLE public.provider_accounts
  DROP CONSTRAINT provider_accounts_brand_id_fkey,
  ADD CONSTRAINT provider_accounts_brand_tenant_fk FOREIGN KEY (merchant_id, brand_id)
    REFERENCES public.merchant_brands(merchant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.payment_intents
  DROP CONSTRAINT payment_intents_brand_id_fkey,
  DROP CONSTRAINT payment_intents_provider_account_id_fkey,
  ADD CONSTRAINT payment_intents_brand_tenant_fk FOREIGN KEY (merchant_id, brand_id)
    REFERENCES public.merchant_brands(merchant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_intents_account_tenant_fk FOREIGN KEY (merchant_id, provider_account_id)
    REFERENCES public.provider_accounts(merchant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_intents_account_provider_fk FOREIGN KEY (merchant_id, provider_account_id, provider)
    REFERENCES public.provider_accounts(merchant_id, id, provider) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_intents_account_provider_required CHECK (provider_account_id IS NULL OR provider IS NOT NULL),
  ADD CONSTRAINT payment_intents_verified_timestamp CHECK ((status = 'verified') = (verified_at IS NOT NULL)),
  ADD CONSTRAINT payment_intents_expiry CHECK (expires_at IS NULL OR expires_at > created_at);
CREATE INDEX payment_intents_merchant_status_time_idx ON public.payment_intents(merchant_id, status, created_at DESC);
CREATE INDEX payment_intents_account_tenant_idx ON public.payment_intents(merchant_id, provider_account_id);

-- Table privileges are separate from RLS; TRUNCATE bypasses row policies.
REVOKE ALL ON public.merchants, public.merchant_members, public.merchant_brands,
  public.provider_accounts, public.payment_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.merchants, public.merchant_members, public.merchant_brands,
  public.payment_intents TO authenticated;
GRANT SELECT (id, merchant_id, brand_id, provider, account_type, account_number_masked,
  display_name, verification_mode, is_active, created_at, updated_at)
  ON public.provider_accounts TO authenticated;
-- Configuration involving encrypted accounts goes through an authorized server.
DROP POLICY provider_accounts_manage_for_admins ON public.provider_accounts;
DROP POLICY payment_intents_insert_for_developers ON public.payment_intents;
DROP POLICY payment_intents_update_for_admins ON public.payment_intents;
GRANT INSERT (merchant_id, name, domain, logo_url, status),
  UPDATE (name, domain, logo_url, status) ON public.merchant_brands TO authenticated;
REVOKE ALL ON public.merchants, public.merchant_members, public.merchant_brands,
  public.provider_accounts, public.payment_intents FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchants, public.merchant_members,
  public.merchant_brands, public.provider_accounts TO service_role;
-- No client membership writes: an admin cannot promote itself to owner.
REVOKE ALL ON FUNCTION public.is_merchant_member(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_merchant_member(uuid, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
-- Platform event trigger is not an RPC; preserve its managed definition.
DO $$ BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $$;

CREATE TABLE public.parser_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  signing_public_key bytea NOT NULL CHECK (octet_length(signing_public_key) = 32),
  secret_key_version integer NOT NULL DEFAULT 1 CHECK (secret_key_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','revoked')),
  last_seen_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- Durable replay receipts: nonce reservation and evidence insertion must be atomic.
CREATE TABLE public.parser_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  nonce text NOT NULL CHECK (length(nonce) BETWEEN 16 AND 128),
  ingestion_id uuid NOT NULL UNIQUE,
  message_hash text NOT NULL CHECK (message_hash ~ '^[0-9a-f]{64}$'),
  request_timestamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, device_id) REFERENCES public.parser_devices(merchant_id, id) ON DELETE RESTRICT,
  UNIQUE (device_id, nonce),
  UNIQUE (merchant_id, device_id, message_hash),
  UNIQUE (merchant_id, id, device_id, ingestion_id, message_hash)
);

CREATE TABLE public.payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  provider_account_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('bkash','nagad','rocket','upay')),
  source text NOT NULL CHECK (source IN ('sms_parser','provider_api','manual')),
  provider_transaction_id text CHECK (provider_transaction_id ~ '^[A-Z0-9][A-Z0-9._-]{0,127}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  receiver_identity_hash text NOT NULL CHECK (receiver_identity_hash ~ '^[0-9a-f]{64}$'),
  sender_identity_hash text CHECK (sender_identity_hash ~ '^[0-9a-f]{64}$'),
  provider_timestamp timestamptz,
  ingestion_id uuid NOT NULL UNIQUE,
  message_hash text NOT NULL CHECK (message_hash ~ '^[0-9a-f]{64}$'),
  device_id uuid,
  parser_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id),
  UNIQUE (merchant_id, provider_account_id, source, message_hash),
  FOREIGN KEY (merchant_id, provider_account_id, provider)
    REFERENCES public.provider_accounts(merchant_id, id, provider) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, parser_request_id, device_id, ingestion_id, message_hash)
    REFERENCES public.parser_requests(merchant_id, id, device_id, ingestion_id, message_hash) ON DELETE RESTRICT,
  CHECK ((source = 'sms_parser' AND device_id IS NOT NULL AND parser_request_id IS NOT NULL)
    OR (source <> 'sms_parser' AND device_id IS NULL AND parser_request_id IS NULL))
);

-- Separate restricted ciphertext from dashboard-readable metadata. Keys stay outside DB.
CREATE SCHEMA IF NOT EXISTS ekpay_private;
REVOKE ALL ON SCHEMA ekpay_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA ekpay_private TO service_role;
CREATE TABLE ekpay_private.evidence_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL UNIQUE,
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
  key_reference text NOT NULL CHECK (length(key_reference) BETWEEN 1 AND 128),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (merchant_id, evidence_id) REFERENCES public.payment_evidence(merchant_id, id) ON DELETE RESTRICT
);
ALTER TABLE ekpay_private.evidence_payloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.evidence_payloads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON ekpay_private.evidence_payloads TO service_role;

CREATE TABLE public.payment_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL,
  payment_evidence_id uuid NOT NULL,
  algorithm_version text NOT NULL CHECK (length(algorithm_version) BETWEEN 1 AND 64),
  provider_match boolean NOT NULL,
  amount_match boolean NOT NULL,
  receiver_match boolean NOT NULL,
  transaction_id_match boolean NOT NULL,
  time_match boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('matched','rejected','manual_review')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  review_reason text CHECK (length(review_reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id, payment_intent_id, payment_evidence_id),
  FOREIGN KEY (merchant_id, payment_intent_id) REFERENCES public.payment_intents(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, payment_evidence_id) REFERENCES public.payment_evidence(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, reviewed_by) REFERENCES public.merchant_members(merchant_id, user_id) ON DELETE RESTRICT,
  CHECK (status <> 'matched' OR (provider_match AND amount_match AND receiver_match AND transaction_id_match AND time_match)),
  CHECK ((reviewed_by IS NULL) = (review_reason IS NULL))
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  payment_intent_id uuid NOT NULL UNIQUE,
  payment_evidence_id uuid NOT NULL UNIQUE,
  payment_match_id uuid NOT NULL UNIQUE,
  provider_account_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('bkash','nagad','rocket','upay')),
  provider_transaction_id text NOT NULL CHECK (provider_transaction_id ~ '^[A-Z0-9][A-Z0-9._-]{0,127}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL DEFAULT 'BDT' CHECK (currency = 'BDT'),
  verification_source text NOT NULL CHECK (verification_source IN ('sms_parser','provider_api','manual')),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id),
  UNIQUE (provider, provider_transaction_id),
  FOREIGN KEY (merchant_id, payment_intent_id) REFERENCES public.payment_intents(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, payment_evidence_id) REFERENCES public.payment_evidence(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, payment_match_id, payment_intent_id, payment_evidence_id)
    REFERENCES public.payment_matches(merchant_id, id, payment_intent_id, payment_evidence_id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, provider_account_id, provider)
    REFERENCES public.provider_accounts(merchant_id, id, provider) ON DELETE RESTRICT
);

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test')),
  object_type text NOT NULL CHECK (object_type IN ('payment_intent','transaction','webhook_endpoint')),
  object_id uuid NOT NULL,
  idempotency_key uuid NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id)
);

CREATE TABLE public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  url text NOT NULL CHECK (url ~ '^https://[^/@[:space:]?#]+([/?][^[:space:]]*)?$' AND length(url) <= 2048),
  enabled boolean NOT NULL DEFAULT false,
  event_subscriptions text[] NOT NULL CHECK (cardinality(event_subscriptions) > 0 AND array_position(event_subscriptions, NULL) IS NULL
    AND event_subscriptions <@ ARRAY['payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test']::text[]),
  secret_version integer NOT NULL DEFAULT 1 CHECK (secret_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, id)
);
CREATE TABLE ekpay_private.webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  endpoint_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
  key_reference text NOT NULL CHECK (length(key_reference) BETWEEN 1 AND 128),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, version),
  FOREIGN KEY (merchant_id, endpoint_id) REFERENCES public.webhook_endpoints(merchant_id, id) ON DELETE RESTRICT
);
ALTER TABLE ekpay_private.webhook_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.webhook_secrets FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE (retired_at) ON ekpay_private.webhook_secrets TO service_role;

CREATE TABLE public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  endpoint_id uuid NOT NULL,
  event_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  secret_version integer NOT NULL CHECK (secret_version > 0),
  endpoint_url text NOT NULL CHECK (endpoint_url LIKE 'https://%' AND length(endpoint_url) <= 2048),
  status text NOT NULL CHECK (status IN ('delivered','retryable_failure','permanent_failure')),
  http_response_code integer CHECK (http_response_code BETWEEN 100 AND 599),
  response_excerpt text CHECK (octet_length(response_excerpt) <= 1024),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (endpoint_id, event_id, attempt_number),
  FOREIGN KEY (merchant_id, endpoint_id) REFERENCES public.webhook_endpoints(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (merchant_id, event_id) REFERENCES public.events(merchant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (endpoint_id, secret_version) REFERENCES ekpay_private.webhook_secrets(endpoint_id, version) ON DELETE RESTRICT,
  CHECK ((status = 'delivered') = (delivered_at IS NOT NULL)),
  CHECK (status <> 'delivered' OR (http_response_code IS NOT NULL AND http_response_code BETWEEN 200 AND 299)),
  CHECK (status = 'retryable_failure' OR next_retry_at IS NULL)
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('user','api_key','parser_device','system')),
  actor_id uuid,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 64),
  target_id uuid NOT NULL,
  ip_address inet,
  user_agent text CHECK (octet_length(user_agent) <= 1024),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type = 'system' OR actor_id IS NOT NULL)
);

-- All trigger functions run as the caller; no new SECURITY DEFINER surfaces.
CREATE FUNCTION public.ekpay_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'append-only record' USING ERRCODE = '23514';
END;
$$;

CREATE FUNCTION public.ekpay_validate_parser_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.parser_devices%ROWTYPE;
BEGIN
  SELECT * INTO STRICT d FROM public.parser_devices
    WHERE merchant_id = NEW.merchant_id AND id = NEW.device_id FOR SHARE;
  IF d.status <> 'active' OR d.secret_key_version <> NEW.key_version
    OR abs(extract(epoch FROM (clock_timestamp() - NEW.request_timestamp))) > 300 THEN
    RAISE EXCEPTION 'revoked, disabled, stale key or stale request' USING ERRCODE = '23514';
  END IF;
  -- Signature verification happens in trusted ingress before this INSERT.
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER parser_request_validate BEFORE INSERT ON public.parser_requests
FOR EACH ROW EXECUTE FUNCTION public.ekpay_validate_parser_request();

CREATE FUNCTION public.ekpay_guard_device() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.merchant_id <> OLD.merchant_id OR NEW.public_id <> OLD.public_id
    OR NEW.secret_key_version < OLD.secret_key_version
    OR (OLD.status = 'revoked' AND NEW.status <> 'revoked') THEN
    RAISE EXCEPTION 'device identity, revoked state or key version cannot roll back' USING ERRCODE = '23514';
  END IF;
  IF (NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash)
    AND NEW.secret_key_version <= OLD.secret_key_version THEN
    RAISE EXCEPTION 'key rotation requires a new version' USING ERRCODE = '23514';
  END IF;
  IF NEW.secret_key_version > OLD.secret_key_version THEN NEW.rotated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER device_guard BEFORE UPDATE ON public.parser_devices
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_device();

CREATE FUNCTION public.ekpay_validate_parser_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.source = 'sms_parser' THEN
    PERFORM 1 FROM public.parser_devices d JOIN public.parser_requests r
      ON r.device_id = d.id AND r.merchant_id = d.merchant_id
      WHERE d.id = NEW.device_id AND d.merchant_id = NEW.merchant_id
        AND r.id = NEW.parser_request_id AND d.status = 'active'
        AND r.key_version = d.secret_key_version
        AND abs(extract(epoch FROM (clock_timestamp() - r.request_timestamp))) <= 300
      FOR SHARE OF d;
    IF NOT FOUND THEN RAISE EXCEPTION 'inactive or stale parser evidence' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_parser_validate BEFORE INSERT ON public.payment_evidence
FOR EACH ROW EXECUTE FUNCTION public.ekpay_validate_parser_evidence();

CREATE FUNCTION public.ekpay_validate_transaction() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE i public.payment_intents%ROWTYPE; e public.payment_evidence%ROWTYPE; m public.payment_matches%ROWTYPE;
  a public.provider_accounts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT i FROM public.payment_intents WHERE merchant_id = NEW.merchant_id AND id = NEW.payment_intent_id FOR UPDATE;
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE merchant_id = NEW.merchant_id AND id = NEW.payment_evidence_id;
  SELECT * INTO STRICT m FROM public.payment_matches WHERE merchant_id = NEW.merchant_id AND id = NEW.payment_match_id;
  SELECT * INTO STRICT a FROM public.provider_accounts WHERE merchant_id = NEW.merchant_id AND id = NEW.provider_account_id FOR SHARE;
  IF i.status NOT IN ('created','pending','manual_review') OR m.status <> 'matched'
    OR m.payment_intent_id <> i.id OR m.payment_evidence_id <> e.id
    OR NOT (m.provider_match AND m.amount_match AND m.receiver_match AND m.transaction_id_match AND m.time_match)
    OR i.provider IS DISTINCT FROM NEW.provider OR e.provider <> NEW.provider
    OR i.provider_account_id IS DISTINCT FROM NEW.provider_account_id OR e.provider_account_id <> NEW.provider_account_id
    OR i.amount_minor <> NEW.amount_minor OR e.amount_minor <> NEW.amount_minor
    OR i.currency <> NEW.currency OR e.currency <> NEW.currency
    OR e.provider_transaction_id IS DISTINCT FROM NEW.provider_transaction_id
    OR e.source <> NEW.verification_source OR e.provider_timestamp IS NULL
    OR NOT a.is_active OR e.receiver_identity_hash <> a.receiver_identity_hash
    OR (e.source = 'manual' AND m.reviewed_by IS NULL)
    OR (m.reviewed_by IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.merchant_members mm
      WHERE mm.merchant_id = NEW.merchant_id AND mm.user_id = m.reviewed_by AND mm.role IN ('owner','admin')))
    OR e.provider_timestamp < i.created_at
    OR (i.expires_at IS NOT NULL AND e.provider_timestamp > i.expires_at)
    OR NEW.verified_at < e.created_at OR NEW.verified_at < e.provider_timestamp
    OR NEW.verified_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'transaction does not satisfy deterministic verification' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_validate BEFORE INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.ekpay_validate_transaction();

CREATE FUNCTION public.ekpay_sync_verified_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.payment_intents SET status = 'verified', verified_at = NEW.verified_at
    WHERE merchant_id = NEW.merchant_id AND id = NEW.payment_intent_id;
  INSERT INTO public.events (merchant_id, event_type, object_type, object_id, idempotency_key, payload)
    VALUES (NEW.merchant_id, 'payment.verified', 'transaction', NEW.id, NEW.id,
      jsonb_build_object('transaction_id', NEW.id, 'payment_intent_id', NEW.payment_intent_id,
        'amount_minor', NEW.amount_minor, 'currency', NEW.currency));
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_sync_intent AFTER INSERT ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.ekpay_sync_verified_intent();

CREATE FUNCTION public.ekpay_guard_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'verified' THEN RAISE EXCEPTION 'verified intent is immutable' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'verified' THEN
    RAISE EXCEPTION 'verified intent is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'verified' AND NOT EXISTS (
    SELECT 1 FROM public.transactions t WHERE t.merchant_id = NEW.merchant_id
      AND t.payment_intent_id = NEW.id AND t.verified_at = NEW.verified_at
  ) THEN RAISE EXCEPTION 'authoritative transaction required' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER intent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_intent();

CREATE FUNCTION public.ekpay_validate_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.object_type = 'payment_intent' AND EXISTS (SELECT 1 FROM public.payment_intents WHERE merchant_id = NEW.merchant_id AND id = NEW.object_id))
    OR (NEW.object_type = 'transaction' AND EXISTS (SELECT 1 FROM public.transactions WHERE merchant_id = NEW.merchant_id AND id = NEW.object_id))
    OR (NEW.object_type = 'webhook_endpoint' AND EXISTS (SELECT 1 FROM public.webhook_endpoints WHERE merchant_id = NEW.merchant_id AND id = NEW.object_id)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'event object must belong to merchant' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER event_validate BEFORE INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.ekpay_validate_event();

-- Audit UUIDs are logical historical references, validated when appended.
CREATE FUNCTION public.ekpay_validate_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE target_table text; target_exists boolean;
BEGIN
  target_table := CASE NEW.target_type
    WHEN 'merchant_member' THEN 'merchant_members' WHEN 'brand' THEN 'merchant_brands'
    WHEN 'provider_account' THEN 'provider_accounts' WHEN 'payment_intent' THEN 'payment_intents'
    WHEN 'payment_evidence' THEN 'payment_evidence' WHEN 'payment_match' THEN 'payment_matches'
    WHEN 'transaction' THEN 'transactions' WHEN 'event' THEN 'events'
    WHEN 'webhook_endpoint' THEN 'webhook_endpoints' WHEN 'webhook_delivery' THEN 'webhook_deliveries'
    WHEN 'parser_device' THEN 'parser_devices' WHEN 'parser_request' THEN 'parser_requests' END;
  IF NEW.target_type = 'merchant' THEN
    target_exists := NEW.target_id = NEW.merchant_id;
  ELSIF target_table IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE merchant_id = $1 AND id = $2)', target_table)
      INTO target_exists USING NEW.merchant_id, NEW.target_id;
  ELSE RAISE EXCEPTION 'unsupported audit target type' USING ERRCODE = '23514';
  END IF;
  IF NOT target_exists THEN RAISE EXCEPTION 'audit target must belong to merchant' USING ERRCODE = '23514'; END IF;
  IF NEW.actor_type = 'user' AND NOT EXISTS (SELECT 1 FROM public.merchant_members
    WHERE merchant_id = NEW.merchant_id AND user_id = NEW.actor_id) THEN
    RAISE EXCEPTION 'audit actor must belong to merchant' USING ERRCODE = '23514';
  ELSIF NEW.actor_type = 'parser_device' AND NOT EXISTS (SELECT 1 FROM public.parser_devices
    WHERE merchant_id = NEW.merchant_id AND id = NEW.actor_id) THEN
    RAISE EXCEPTION 'audit device must belong to merchant' USING ERRCODE = '23514';
  ELSIF NEW.actor_type = 'api_key' THEN
    RAISE EXCEPTION 'API key audit requires future tenant-scoped key registry' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_validate BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.ekpay_validate_audit();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parser_devices','parser_requests','payment_evidence','payment_matches',
    'transactions','events','webhook_endpoints','webhook_deliveries','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO service_role', t);
    EXECUTE format('CREATE INDEX %I ON public.%I (merchant_id, created_at DESC)', t || '_merchant_time_idx', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['parser_requests','payment_evidence','payment_matches','transactions','events','webhook_deliveries','audit_logs'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ekpay_reject_mutation()', t || '_immutable', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['payment_matches','transactions','events'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_merchant_member(merchant_id))', t || '_member_read', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['parser_devices','webhook_endpoints'] LOOP
    EXECUTE format('GRANT UPDATE ON public.%I TO service_role', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t || '_updated_at', t);
  END LOOP;
END;
$$;
CREATE TRIGGER evidence_payload_immutable BEFORE UPDATE OR DELETE ON ekpay_private.evidence_payloads
FOR EACH ROW EXECUTE FUNCTION public.ekpay_reject_mutation();

GRANT SELECT (id, merchant_id, provider_account_id, provider, source, provider_transaction_id,
  amount_minor, currency, provider_timestamp, created_at) ON public.payment_evidence TO authenticated;
CREATE POLICY evidence_member_read ON public.payment_evidence FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id));
GRANT SELECT (id, merchant_id, public_id, signing_public_key, secret_key_version, status, last_seen_at, rotated_at,
  revoked_at, created_at, updated_at) ON public.parser_devices TO authenticated;
CREATE POLICY devices_admin_read ON public.parser_devices FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id, ARRAY['owner','admin']::text[]));
GRANT SELECT ON public.webhook_endpoints, public.webhook_deliveries TO authenticated;
CREATE POLICY endpoints_developer_read ON public.webhook_endpoints FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id, ARRAY['owner','admin','developer']::text[]));
CREATE POLICY deliveries_developer_read ON public.webhook_deliveries FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id, ARRAY['owner','admin','developer']::text[]));
GRANT INSERT (merchant_id, url, event_subscriptions), UPDATE (url, event_subscriptions)
ON public.webhook_endpoints TO authenticated;
CREATE POLICY endpoints_admin_insert ON public.webhook_endpoints FOR INSERT TO authenticated
WITH CHECK (public.is_merchant_member(merchant_id, ARRAY['owner','admin']::text[]));
CREATE POLICY endpoints_admin_update ON public.webhook_endpoints FOR UPDATE TO authenticated
USING (public.is_merchant_member(merchant_id, ARRAY['owner','admin']::text[]))
WITH CHECK (public.is_merchant_member(merchant_id, ARRAY['owner','admin']::text[]));
GRANT SELECT ON public.audit_logs TO authenticated;
CREATE POLICY audit_admin_read ON public.audit_logs FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id, ARRAY['owner','admin']::text[]));

CREATE INDEX payment_matches_intent_idx ON public.payment_matches(merchant_id, payment_intent_id);
CREATE INDEX payment_matches_evidence_idx ON public.payment_matches(merchant_id, payment_evidence_id);
CREATE INDEX transactions_merchant_verified_idx ON public.transactions(merchant_id, verified_at DESC);
CREATE INDEX parser_devices_merchant_status_idx ON public.parser_devices(merchant_id, status);
CREATE INDEX webhook_deliveries_retry_idx ON public.webhook_deliveries(next_retry_at) WHERE status = 'retryable_failure';
CREATE INDEX webhook_deliveries_event_idx ON public.webhook_deliveries(merchant_id, event_id);
CREATE INDEX webhook_endpoints_enabled_idx ON public.webhook_endpoints(merchant_id, enabled);
CREATE INDEX payment_matches_merchant_status_idx ON public.payment_matches(merchant_id, status, created_at DESC);
CREATE INDEX webhook_deliveries_merchant_status_idx ON public.webhook_deliveries(merchant_id, status, created_at DESC);
CREATE INDEX audit_logs_merchant_action_idx ON public.audit_logs(merchant_id, action, created_at DESC);
CREATE INDEX payment_evidence_account_idx ON public.payment_evidence(merchant_id, provider_account_id);
CREATE INDEX payment_evidence_provider_tx_idx ON public.payment_evidence(provider, provider_transaction_id) WHERE provider_transaction_id IS NOT NULL;
REVOKE ALL ON FUNCTION public.ekpay_reject_mutation(), public.ekpay_validate_parser_request(),
  public.ekpay_validate_transaction(), public.ekpay_sync_verified_intent(), public.ekpay_guard_intent(),
  public.ekpay_validate_event(), public.ekpay_validate_parser_evidence(), public.ekpay_guard_device(),
  public.ekpay_validate_audit() FROM PUBLIC, anon, authenticated;
-- Trigger invoker needs these table privileges for the atomic verified transition.
GRANT SELECT, INSERT, UPDATE ON public.payment_intents TO service_role;

COMMIT;
