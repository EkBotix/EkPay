BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- TEST-only transaction verification reservations. Merchant callers never write
-- evidence or these tables directly; the two narrowly granted RPCs below are the
-- only service-role mutation path.
ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_abilities_check,
  ADD CONSTRAINT api_keys_abilities_check CHECK (
    cardinality(abilities) BETWEEN 1 AND 7
    AND array_position(abilities,NULL) IS NULL
    AND abilities <@ ARRAY[
      'payment_intents:create','payment_intents:read','transactions:read',
      'webhooks:read','webhooks:manage','trx:verify','trx:confirm'
    ]::text[]
  );

CREATE TABLE public.transaction_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE CHECK(public_id ~ '^vr_[a-f0-9]{32}$'),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK(environment='test'),
  payment_evidence_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('bkash','nagad')),
  provider_transaction_id text NOT NULL CHECK(provider_transaction_id ~ '^[A-Z0-9][A-Z0-9._-]{0,127}$'),
  amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
  currency text NOT NULL CHECK(currency='BDT'),
  provider_timestamp timestamptz NOT NULL,
  rule_version text NOT NULL CHECK(rule_version='ekpay-trx-api-synthetic-v1'),
  status text NOT NULL CHECK(status IN ('reserved','consumed','expired','invalidated')),
  created_by_api_key_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  transaction_id uuid,
  UNIQUE(merchant_id,environment,id),
  UNIQUE(merchant_id,environment,id,payment_evidence_id),
  FOREIGN KEY(merchant_id,environment,payment_evidence_id)
    REFERENCES public.payment_evidence(merchant_id,environment,id) ON DELETE RESTRICT,
  FOREIGN KEY(merchant_id,environment,provider_account_id,provider)
    REFERENCES public.provider_accounts(merchant_id,environment,id,provider) ON DELETE RESTRICT,
  FOREIGN KEY(merchant_id,created_by_api_key_id)
    REFERENCES public.api_keys(merchant_id,id) ON DELETE RESTRICT,
  CHECK(expires_at=created_at+interval '5 minutes'),
  CHECK(
    (status='reserved' AND consumed_at IS NULL AND transaction_id IS NULL)
    OR (status='consumed' AND consumed_at IS NOT NULL AND transaction_id IS NOT NULL)
    OR (status IN ('expired','invalidated') AND consumed_at IS NULL AND transaction_id IS NULL)
  )
);
ALTER TABLE public.transaction_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transaction_verifications FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX transaction_verifications_active_evidence
  ON public.transaction_verifications(payment_evidence_id) WHERE status='reserved';
CREATE UNIQUE INDEX transaction_verifications_active_reference
  ON public.transaction_verifications(environment,provider,provider_transaction_id) WHERE status='reserved';
CREATE INDEX transaction_verifications_lookup
  ON public.transaction_verifications(merchant_id,environment,provider_transaction_id,status,expires_at);
CREATE INDEX transaction_verifications_expiry
  ON public.transaction_verifications(expires_at) WHERE status='reserved';

CREATE FUNCTION public.ekpay_guard_transaction_verification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'verification history is retained' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','consumed_at','transaction_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','consumed_at','transaction_id']) THEN
    RAISE EXCEPTION 'verification identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status=OLD.status AND (NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
      OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id) THEN
    RAISE EXCEPTION 'verification result is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status='reserved' AND NEW.status IN ('consumed','expired','invalidated')) THEN
    RAISE EXCEPTION 'invalid verification transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER transaction_verifications_guard BEFORE UPDATE OR DELETE ON public.transaction_verifications
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_transaction_verification();

-- Generalize the existing durable idempotency receipt without changing the
-- payment-intent API's default behavior.
ALTER TABLE public.api_idempotency_keys
  DROP CONSTRAINT api_idempotency_keys_merchant_id_environment_key_hash_key,
  ALTER COLUMN payment_intent_id DROP NOT NULL,
  ADD COLUMN operation text NOT NULL DEFAULT 'payment_intent.create'
    CHECK(operation IN ('payment_intent.create','trx.verify','trx.confirm')),
  ADD COLUMN transaction_verification_id uuid,
  ADD CONSTRAINT api_idempotency_operation_key_unique
    UNIQUE(merchant_id,environment,operation,key_hash),
  ADD CONSTRAINT api_idempotency_verification_fk
    FOREIGN KEY(merchant_id,environment,transaction_verification_id)
    REFERENCES public.transaction_verifications(merchant_id,environment,id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT api_idempotency_target_check CHECK(
    (operation='payment_intent.create' AND payment_intent_id IS NOT NULL AND transaction_verification_id IS NULL)
    OR (operation IN ('trx.verify','trx.confirm') AND payment_intent_id IS NULL AND transaction_verification_id IS NOT NULL)
  );

-- Preserve payment-intent behavior while moving its receipts onto the new
-- operation-scoped uniqueness key.
CREATE OR REPLACE FUNCTION public.api_create_payment_intent(p_key_id uuid,p_idempotency_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE; i public.payment_intents%ROWTYPE; r public.api_idempotency_keys%ROWTYPE;
  account_id uuid; account public.provider_accounts%ROWTYPE; fingerprint text; normalized jsonb;
  intent_id uuid:=gen_random_uuid(); receipt_id uuid; expiry timestamptz; amount bigint;
BEGIN
  k:=ekpay_private.require_api_key(p_key_id,'payment_intents:create');
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>8192 THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) AS t(key) WHERE key NOT IN
    ('amount','currency','reference','provider','provider_account_id','customer_reference','expires_at','metadata'))
    OR NOT (p_payload ?& ARRAY['amount','currency','reference','provider','provider_account_id'])
    OR jsonb_typeof(p_payload->'amount')<>'number' OR (p_payload->>'amount') !~ '^[0-9]+$'
    OR (p_payload->>'amount')::numeric NOT BETWEEN 1 AND 100000000
    OR jsonb_typeof(p_payload->'currency')<>'string' OR p_payload->>'currency'<>'BDT'
    OR jsonb_typeof(p_payload->'provider')<>'string' OR p_payload->>'provider' NOT IN ('bkash','nagad','rocket','upay')
    OR jsonb_typeof(p_payload->'reference')<>'string' OR length(btrim(p_payload->>'reference')) NOT BETWEEN 1 AND 128
    OR p_payload->>'reference' ~ '[[:cntrl:]]' OR jsonb_typeof(p_payload->'provider_account_id')<>'string'
    OR (p_payload ? 'customer_reference' AND (jsonb_typeof(p_payload->'customer_reference')<>'string'
      OR length(btrim(p_payload->>'customer_reference')) NOT BETWEEN 1 AND 128 OR p_payload->>'customer_reference' ~ '[[:cntrl:]]'))
    OR (p_payload ? 'expires_at' AND jsonb_typeof(p_payload->'expires_at')<>'string')
    OR (p_payload ? 'metadata' AND jsonb_typeof(p_payload->'metadata')<>'object') THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  IF octet_length(coalesce(p_payload->'metadata','{}'::jsonb)::text)>4096
    OR (SELECT count(*) FROM jsonb_object_keys(coalesce(p_payload->'metadata','{}'::jsonb)))>20
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(p_payload->'metadata','{}'::jsonb)) AS t(key) WHERE length(key)>64) THEN
    RAISE EXCEPTION 'invalid metadata' USING ERRCODE='22023';
  END IF;
  BEGIN
    account_id:=(p_payload->>'provider_account_id')::uuid;
    expiry:=(p_payload->>'expires_at')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END;
  amount:=(p_payload->>'amount')::bigint;
  normalized:=jsonb_build_object('amount',amount,'currency','BDT','reference',btrim(p_payload->>'reference'),
    'provider',p_payload->>'provider','provider_account_id',account_id,
    'customer_reference',btrim(p_payload->>'customer_reference'),'expires_at',to_char(expiry AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'metadata',coalesce(p_payload->'metadata','{}'::jsonb));
  fingerprint:=encode(sha256(convert_to(normalized::text,'UTF8')),'hex');
  INSERT INTO public.api_idempotency_keys(merchant_id,environment,operation,key_hash,request_fingerprint,payment_intent_id)
    VALUES(k.merchant_id,k.environment,'payment_intent.create',encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex'),fingerprint,intent_id)
    ON CONFLICT(merchant_id,environment,operation,key_hash) DO NOTHING RETURNING id INTO receipt_id;
  IF receipt_id IS NULL THEN
    SELECT * INTO STRICT r FROM public.api_idempotency_keys WHERE merchant_id=k.merchant_id AND environment=k.environment
      AND operation='payment_intent.create' AND key_hash=encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
    IF r.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='EK409'; END IF;
    SELECT * INTO STRICT i FROM public.payment_intents WHERE merchant_id=k.merchant_id AND environment=k.environment AND id=r.payment_intent_id;
    RETURN jsonb_build_object('intent',ekpay_private.intent_api_json(i),'reused',true);
  END IF;
  expiry:=coalesce(expiry,clock_timestamp()+interval '30 minutes');
  IF expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '24 hours' THEN
    RAISE EXCEPTION 'invalid expiry' USING ERRCODE='22023';
  END IF;
  SELECT * INTO account FROM public.provider_accounts WHERE merchant_id=k.merchant_id AND environment=k.environment
    AND id=account_id AND provider=p_payload->>'provider' AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'provider account unavailable' USING ERRCODE='EK422'; END IF;
  INSERT INTO public.payment_intents(id,merchant_id,environment,provider_account_id,public_id,merchant_reference,
    amount_minor,currency,provider,status,customer_reference,metadata,expires_at)
    VALUES(intent_id,k.merchant_id,k.environment,account_id,'pi_'||replace(intent_id::text,'-',''),btrim(p_payload->>'reference'),
      amount,'BDT',p_payload->>'provider','created',btrim(p_payload->>'customer_reference'),coalesce(p_payload->'metadata','{}'::jsonb),expiry)
    RETURNING * INTO i;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(k.merchant_id,'payment_intent.created','payment_intent',i.id,i.id,
      jsonb_build_object('payment_intent_id',i.public_id,'environment',k.environment,'api_key_id',k.id));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(k.merchant_id,'api_key',k.id,'payment_intent.created','payment_intent',i.id,
      jsonb_build_object('environment',k.environment,'api_key_prefix',k.prefix));
  RETURN jsonb_build_object('intent',ekpay_private.intent_api_json(i),'reused',false);
END;
$$;

-- Keep one authoritative transaction table. Existing intent verification rows
-- remain the default branch; the new branch is reservation-backed.
ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_provider_provider_transaction_id_key,
  DROP CONSTRAINT transactions_rule_version_check,
  ALTER COLUMN payment_intent_id DROP NOT NULL,
  ALTER COLUMN payment_match_id DROP NOT NULL,
  ADD COLUMN transaction_kind text NOT NULL DEFAULT 'intent_verification'
    CHECK(transaction_kind IN ('intent_verification','trx_api')),
  ADD COLUMN transaction_verification_id uuid UNIQUE,
  ADD CONSTRAINT transactions_environment_provider_reference_unique
    UNIQUE(environment,provider,provider_transaction_id),
  ADD CONSTRAINT transactions_rule_version_check CHECK(
    (transaction_kind='intent_verification' AND rule_version='ekpay-verification-synthetic-v1')
    OR (transaction_kind='trx_api' AND rule_version='ekpay-trx-api-synthetic-v1')
  ),
  ADD CONSTRAINT transactions_kind_target_check CHECK(
    (transaction_kind='intent_verification' AND payment_intent_id IS NOT NULL AND payment_match_id IS NOT NULL AND transaction_verification_id IS NULL)
    OR (transaction_kind='trx_api' AND payment_intent_id IS NULL AND payment_match_id IS NULL AND transaction_verification_id IS NOT NULL)
  ),
  ADD CONSTRAINT transaction_verification_evidence_fk
    FOREIGN KEY(merchant_id,environment,transaction_verification_id,payment_evidence_id)
    REFERENCES public.transaction_verifications(merchant_id,environment,id,payment_evidence_id) ON DELETE RESTRICT;
ALTER TABLE public.transaction_verifications
  ADD CONSTRAINT verification_transaction_fk FOREIGN KEY(transaction_id)
    REFERENCES public.transactions(id) ON DELETE RESTRICT;

ALTER TABLE public.events DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK(event_type IN (
    'payment_intent.created','payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test',
    'payment.evidence_received','payment.match_evaluated','payment.manual_review_required','payment.verification_failed',
    'evidence.ingestion_accepted','evidence.duplicate_detected','evidence.conflict_detected',
    'parser.device_created','parser.pairing_issued','parser.device_paired','parser.key_rotated','parser.device_revoked','parser.heartbeat_received',
    'transaction.verification_reserved','transaction.verification_expired','transaction.consumed'
  )),
  DROP CONSTRAINT events_object_type_check,
  ADD CONSTRAINT events_object_type_check CHECK(object_type IN (
    'payment_intent','transaction','webhook_endpoint','payment_evidence','payment_match','parser_device','transaction_verification'
  ));

CREATE OR REPLACE FUNCTION public.ekpay_validate_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF (NEW.object_type='payment_intent' AND EXISTS(SELECT 1 FROM public.payment_intents WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='transaction' AND EXISTS(SELECT 1 FROM public.transactions WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='webhook_endpoint' AND EXISTS(SELECT 1 FROM public.webhook_endpoints WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_evidence' AND EXISTS(SELECT 1 FROM public.payment_evidence WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_match' AND EXISTS(SELECT 1 FROM public.payment_matches WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='parser_device' AND EXISTS(SELECT 1 FROM public.parser_devices WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='transaction_verification' AND EXISTS(SELECT 1 FROM public.transaction_verifications WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'event object must belong to merchant' USING ERRCODE='23514';
END;
$$;

CREATE OR REPLACE FUNCTION public.ekpay_validate_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target_table text; target_exists boolean;
BEGIN
  target_table:=CASE NEW.target_type
    WHEN 'merchant_member' THEN 'merchant_members' WHEN 'brand' THEN 'merchant_brands'
    WHEN 'provider_account' THEN 'provider_accounts' WHEN 'payment_intent' THEN 'payment_intents'
    WHEN 'payment_evidence' THEN 'payment_evidence' WHEN 'payment_match' THEN 'payment_matches'
    WHEN 'transaction' THEN 'transactions' WHEN 'transaction_verification' THEN 'transaction_verifications'
    WHEN 'event' THEN 'events' WHEN 'webhook_endpoint' THEN 'webhook_endpoints'
    WHEN 'webhook_delivery' THEN 'webhook_deliveries' WHEN 'parser_device' THEN 'parser_devices'
    WHEN 'parser_request' THEN 'parser_requests' WHEN 'api_key' THEN 'api_keys' END;
  IF NEW.target_type='merchant' THEN target_exists:=NEW.target_id=NEW.merchant_id;
  ELSIF target_table IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE merchant_id=$1 AND id=$2)',target_table)
      INTO target_exists USING NEW.merchant_id,NEW.target_id;
  ELSE RAISE EXCEPTION 'unsupported audit target' USING ERRCODE='23514'; END IF;
  IF NOT target_exists THEN RAISE EXCEPTION 'audit target must belong to merchant' USING ERRCODE='23514'; END IF;
  IF NEW.actor_type='user' AND NOT EXISTS(SELECT 1 FROM public.merchant_members WHERE merchant_id=NEW.merchant_id AND user_id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit user' USING ERRCODE='23514';
  ELSIF NEW.actor_type='parser_device' AND NOT EXISTS(SELECT 1 FROM public.parser_devices WHERE merchant_id=NEW.merchant_id AND id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit device' USING ERRCODE='23514';
  ELSIF NEW.actor_type='api_key' AND NOT EXISTS(SELECT 1 FROM public.api_keys WHERE merchant_id=NEW.merchant_id AND id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit key' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Evidence ingestion now participates in the API's cross-provider lookup scope.
-- The old scopes remain for the intent verifier's established lock order.
CREATE OR REPLACE FUNCTION public.ekpay_serialize_verification_inputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='payment_evidence' THEN
    IF NEW.provider_transaction_id IS NOT NULL THEN
      PERFORM ekpay_private.touch_verification_scope('trx:'||encode(sha256(convert_to(NEW.provider||':'||NEW.provider_transaction_id,'UTF8')),'hex'));
      PERFORM ekpay_private.touch_verification_scope('trx-api:'||NEW.environment||':'||encode(sha256(convert_to(NEW.provider_transaction_id,'UTF8')),'hex'));
    END IF;
  END IF;
  PERFORM ekpay_private.touch_verification_scope('merchant:'||NEW.merchant_id::text);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ekpay_sync_verified_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.transaction_kind='trx_api' THEN RETURN NEW; END IF;
  UPDATE public.payment_intents SET status='verified',verified_at=NEW.verified_at
    WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_intent_id;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(NEW.merchant_id,'payment.verified','transaction',NEW.id,NEW.id,
      jsonb_build_object('transaction_id',NEW.id,'payment_intent_id',NEW.payment_intent_id,
        'amount_minor',NEW.amount_minor,'currency',NEW.currency,'environment',NEW.environment,
        'evidence_id',NEW.payment_evidence_id,'rule_version',NEW.rule_version));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ekpay_validate_transaction() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.payment_intents%ROWTYPE; e public.payment_evidence%ROWTYPE; m public.payment_matches%ROWTYPE;
  a public.provider_accounts%ROWTYPE; v public.transaction_verifications%ROWTYPE;
BEGIN
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_evidence_id;
  SELECT * INTO STRICT a FROM public.provider_accounts WHERE merchant_id=NEW.merchant_id AND id=NEW.provider_account_id FOR SHARE;
  IF NEW.transaction_kind='intent_verification' THEN
    SELECT * INTO STRICT i FROM public.payment_intents WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_intent_id FOR UPDATE;
    SELECT * INTO STRICT m FROM public.payment_matches WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_match_id;
    IF NOT EXISTS(SELECT 1 FROM ekpay_private.verification_policy WHERE singleton AND enabled)
      OR NEW.environment<>'test' OR i.environment<>NEW.environment OR e.environment<>NEW.environment OR m.environment<>NEW.environment
      OR a.environment<>NEW.environment OR e.trust_state<>'synthetic' OR e.source<>'provider_api'
      OR NEW.rule_version<>'ekpay-verification-synthetic-v1' OR m.algorithm_version<>NEW.rule_version
      OR NOT(m.merchant_match AND m.environment_match AND m.source_trusted AND m.intent_eligible) OR m.decision_outcome<>'verified'
      OR i.status NOT IN ('created','pending') OR i.expires_at IS NULL OR i.expires_at<=clock_timestamp()
      OR m.status<>'matched' OR m.payment_intent_id<>i.id OR m.payment_evidence_id<>e.id
      OR NOT(m.provider_match AND m.amount_match AND m.receiver_match AND m.transaction_id_match AND m.time_match)
      OR i.provider IS DISTINCT FROM NEW.provider OR e.provider<>NEW.provider
      OR i.provider_account_id IS DISTINCT FROM NEW.provider_account_id OR e.provider_account_id<>NEW.provider_account_id
      OR i.amount_minor<>NEW.amount_minor OR e.amount_minor<>NEW.amount_minor OR i.currency<>NEW.currency OR e.currency<>NEW.currency
      OR e.provider_transaction_id IS DISTINCT FROM NEW.provider_transaction_id OR e.source<>NEW.verification_source OR e.provider_timestamp IS NULL
      OR NOT a.is_active OR e.receiver_identity_hash<>a.receiver_identity_hash
      OR (e.source='manual' AND m.reviewed_by IS NULL)
      OR (m.reviewed_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.merchant_members mm WHERE mm.merchant_id=NEW.merchant_id AND mm.user_id=m.reviewed_by AND mm.role IN ('owner','admin')))
      OR e.provider_timestamp<i.created_at OR e.provider_timestamp>i.expires_at OR e.provider_timestamp>clock_timestamp()
      OR NEW.verified_at<e.created_at OR NEW.verified_at<e.provider_timestamp OR NEW.verified_at>clock_timestamp()+interval '5 minutes' THEN
      RAISE EXCEPTION 'transaction does not satisfy deterministic verification' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO STRICT v FROM public.transaction_verifications
    WHERE merchant_id=NEW.merchant_id AND environment=NEW.environment AND id=NEW.transaction_verification_id
      AND payment_evidence_id=NEW.payment_evidence_id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.verification_policy WHERE singleton AND enabled)
    OR NEW.environment<>'test' OR v.status<>'reserved' OR v.expires_at<=clock_timestamp()
    OR NEW.rule_version<>'ekpay-trx-api-synthetic-v1' OR v.rule_version<>NEW.rule_version
    OR e.environment<>NEW.environment OR a.environment<>NEW.environment
    OR e.trust_state<>'synthetic' OR e.source<>'provider_api' OR NEW.verification_source<>'provider_api'
    OR e.source_device_id IS NULL OR e.source_key_version IS NULL OR e.source_timestamp IS NULL
    OR e.authentication_method<>'ed25519-synthetic-v1'
    OR e.normalization_version<>'ekpay-evidence-normalization-synthetic-v1'
    OR NEW.provider NOT IN ('bkash','nagad') OR e.provider<>NEW.provider OR v.provider<>NEW.provider
    OR e.provider_account_id<>NEW.provider_account_id OR v.provider_account_id<>NEW.provider_account_id
    OR e.amount_minor<>NEW.amount_minor OR v.amount_minor<>NEW.amount_minor OR e.currency<>NEW.currency OR v.currency<>NEW.currency
    OR e.provider_transaction_id IS DISTINCT FROM NEW.provider_transaction_id OR v.provider_transaction_id<>NEW.provider_transaction_id
    OR e.provider_timestamp IS NULL OR v.provider_timestamp<>e.provider_timestamp
    OR NOT a.is_active OR e.receiver_identity_hash<>a.receiver_identity_hash
    OR NEW.verified_at<e.created_at OR NEW.verified_at<e.provider_timestamp OR NEW.verified_at>clock_timestamp()+interval '5 minutes'
    OR NOT EXISTS(SELECT 1 FROM public.parser_devices d WHERE d.id=e.source_device_id AND d.merchant_id=e.merchant_id
      AND d.environment=e.environment AND d.provider=e.provider AND d.provider_account_id=e.provider_account_id
      AND d.status='active' AND d.is_synthetic AND d.source_type='provider_api')
    OR NOT EXISTS(SELECT 1 FROM ekpay_private.parser_key_history h WHERE h.device_id=e.source_device_id AND h.key_version=e.source_key_version)
    OR NOT EXISTS(SELECT 1 FROM public.parser_requests r WHERE r.evidence_id=e.id AND r.device_id=e.source_device_id
      AND r.merchant_id=e.merchant_id AND r.environment=e.environment AND r.request_kind='evidence') THEN
    RAISE EXCEPTION 'transaction does not satisfy trx API verification' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION ekpay_private.trx_verification_json(v public.transaction_verifications) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'verification_id',v.public_id,'transaction_id',v.provider_transaction_id,
    'provider',v.provider,'amount',v.amount_minor,'currency',v.currency,
    'provider_timestamp',v.provider_timestamp,
    'status',CASE WHEN v.status='consumed' THEN 'CONSUMED' ELSE 'UNUSED' END,
    'expires_at',v.expires_at,'consumed_at',v.consumed_at
  ) - CASE WHEN v.status='consumed' THEN 'expires_at' ELSE 'consumed_at' END;
$$;

CREATE FUNCTION public.api_verify_transaction(p_key_id uuid,p_idempotency_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE; r public.api_idempotency_keys%ROWTYPE; v public.transaction_verifications%ROWTYPE;
  e public.payment_evidence%ROWTYPE; v_now timestamptz:=clock_timestamp(); v_id uuid:=gen_random_uuid();
  reference text; requested_provider text; amount bigint; fingerprint text; candidates integer; conflicts integer;
BEGIN
  k:=ekpay_private.require_api_key(p_key_id,'trx:verify');
  IF k.environment<>'test' THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>1024
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_payload) x WHERE x NOT IN ('transaction_id','amount','provider'))
    OR NOT (p_payload ?& ARRAY['transaction_id','amount'])
    OR jsonb_typeof(p_payload->'transaction_id')<>'string'
    OR jsonb_typeof(p_payload->'amount')<>'number' OR (p_payload->>'amount') !~ '^[0-9]+$'
    OR (p_payload->>'amount')::numeric NOT BETWEEN 1 AND 100000000
    OR (p_payload ? 'provider' AND jsonb_typeof(p_payload->'provider')<>'string') THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  reference:=upper(btrim(p_payload->>'transaction_id'));
  IF reference !~ '^[A-Z0-9][A-Z0-9._-]{0,127}$' THEN RAISE EXCEPTION 'invalid request' USING ERRCODE='22023'; END IF;
  amount:=(p_payload->>'amount')::bigint;
  requested_provider:=p_payload->>'provider';
  IF requested_provider IS NOT NULL AND requested_provider NOT IN ('bkash','nagad') THEN
    RAISE EXCEPTION 'provider unavailable' USING ERRCODE='EKV04';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.verification_policy WHERE singleton AND enabled) THEN
    RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01';
  END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('amount',amount,'provider',requested_provider,'transaction_id',reference)::text,'UTF8')),'hex');
  PERFORM ekpay_private.touch_verification_scope('trx-api:test:'||encode(sha256(convert_to(reference,'UTF8')),'hex'));
  PERFORM ekpay_private.touch_verification_scope('trx-api:merchant:'||k.merchant_id::text||':test');

  SELECT * INTO r FROM public.api_idempotency_keys WHERE merchant_id=k.merchant_id AND environment='test'
    AND operation='trx.verify' AND key_hash=encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
  IF FOUND THEN
    IF r.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='EK409'; END IF;
    SELECT * INTO STRICT v FROM public.transaction_verifications WHERE id=r.transaction_verification_id;
    IF v.status='consumed' THEN RETURN jsonb_build_object('verification',ekpay_private.trx_verification_json(v),'reused',true); END IF;
    IF v.status<>'reserved' OR v.expires_at<=v_now THEN RAISE EXCEPTION 'verification expired' USING ERRCODE='EKV02'; END IF;
    RETURN jsonb_build_object('verification',ekpay_private.trx_verification_json(v),'reused',true);
  END IF;

  FOR v IN UPDATE public.transaction_verifications SET status='expired'
    WHERE merchant_id=k.merchant_id AND environment='test' AND provider_transaction_id=reference
      AND status='reserved' AND expires_at<=v_now
      AND (requested_provider IS NULL OR provider=requested_provider) RETURNING * LOOP
    INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
      VALUES(k.merchant_id,'transaction.verification_expired','transaction_verification',v.id,gen_random_uuid(),
        jsonb_build_object('environment','test','verification_id',v.public_id,'provider',v.provider,
          'amount_minor',v.amount_minor,'currency','BDT','rule_version',v.rule_version));
    INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
      VALUES(k.merchant_id,'api_key',k.id,'transaction.verification_expired','transaction_verification',v.id,
        jsonb_build_object('environment','test','provider',v.provider,'rule_version',v.rule_version));
  END LOOP;

  SELECT count(*),min(e0.id::text)::uuid INTO candidates,v_id
  FROM public.payment_evidence e0
  JOIN public.provider_accounts a ON a.id=e0.provider_account_id AND a.merchant_id=e0.merchant_id
    AND a.environment=e0.environment AND a.provider=e0.provider
  WHERE e0.merchant_id=k.merchant_id AND e0.environment='test'
    AND e0.provider_transaction_id=reference AND e0.amount_minor=amount AND e0.currency='BDT'
    AND e0.provider IN ('bkash','nagad') AND (requested_provider IS NULL OR e0.provider=requested_provider)
    AND e0.trust_state='synthetic' AND e0.source='provider_api'
    AND e0.provider_timestamp IS NOT NULL AND e0.provider_timestamp<=v_now
    AND e0.source_device_id IS NOT NULL AND e0.source_key_version IS NOT NULL AND e0.source_timestamp IS NOT NULL
    AND e0.authentication_method='ed25519-synthetic-v1'
    AND e0.normalization_version='ekpay-evidence-normalization-synthetic-v1'
    AND a.is_active AND a.receiver_identity_hash=e0.receiver_identity_hash
    AND EXISTS(SELECT 1 FROM public.parser_devices d WHERE d.id=e0.source_device_id AND d.merchant_id=e0.merchant_id
      AND d.environment=e0.environment AND d.provider=e0.provider AND d.provider_account_id=e0.provider_account_id
      AND d.status='active' AND d.is_synthetic AND d.source_type='provider_api')
    AND EXISTS(SELECT 1 FROM ekpay_private.parser_key_history h WHERE h.device_id=e0.source_device_id AND h.key_version=e0.source_key_version)
    AND EXISTS(SELECT 1 FROM public.parser_requests pr WHERE pr.evidence_id=e0.id AND pr.device_id=e0.source_device_id
      AND pr.merchant_id=e0.merchant_id AND pr.environment=e0.environment AND pr.request_kind='evidence')
    AND NOT EXISTS(SELECT 1 FROM public.transactions t WHERE t.payment_evidence_id=e0.id
      OR (t.environment=e0.environment AND t.provider=e0.provider AND t.provider_transaction_id=e0.provider_transaction_id))
    AND NOT EXISTS(SELECT 1 FROM public.transaction_verifications av WHERE av.status='reserved'
      AND (av.payment_evidence_id=e0.id OR (av.environment=e0.environment AND av.provider=e0.provider
        AND av.provider_transaction_id=e0.provider_transaction_id)));
  IF candidates<>1 THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE id=v_id FOR SHARE;
  PERFORM 1 FROM public.provider_accounts a WHERE a.id=e.provider_account_id AND a.merchant_id=e.merchant_id
    AND a.environment=e.environment AND a.provider=e.provider AND a.is_active
    AND a.receiver_identity_hash=e.receiver_identity_hash FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;
  PERFORM 1 FROM public.parser_devices d WHERE d.id=e.source_device_id AND d.merchant_id=e.merchant_id
    AND d.environment=e.environment AND d.provider=e.provider AND d.provider_account_id=e.provider_account_id
    AND d.status='active' AND d.is_synthetic AND d.source_type='provider_api' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;
  SELECT count(*) INTO conflicts FROM public.payment_evidence x
    WHERE x.environment=e.environment AND x.provider=e.provider
      AND x.provider_transaction_id=e.provider_transaction_id AND x.id<>e.id;
  IF conflicts<>0 THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;

  v_id:=gen_random_uuid();
  INSERT INTO public.transaction_verifications(id,public_id,merchant_id,environment,payment_evidence_id,provider_account_id,
    provider,provider_transaction_id,amount_minor,currency,provider_timestamp,rule_version,status,created_by_api_key_id,created_at,expires_at)
  VALUES(v_id,'vr_'||replace(v_id::text,'-',''),k.merchant_id,'test',e.id,e.provider_account_id,e.provider,e.provider_transaction_id,
    e.amount_minor,e.currency,e.provider_timestamp,'ekpay-trx-api-synthetic-v1','reserved',k.id,v_now,v_now+interval '5 minutes') RETURNING * INTO v;
  INSERT INTO public.api_idempotency_keys(merchant_id,environment,operation,key_hash,request_fingerprint,transaction_verification_id)
    VALUES(k.merchant_id,'test','trx.verify',encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex'),fingerprint,v.id);
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(k.merchant_id,'transaction.verification_reserved','transaction_verification',v.id,v.id,
      jsonb_build_object('environment','test','verification_id',v.public_id,'provider',v.provider,'amount_minor',v.amount_minor,
        'currency','BDT','expires_at',v.expires_at,'rule_version',v.rule_version));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(k.merchant_id,'api_key',k.id,'transaction.verification_reserved','transaction_verification',v.id,
      jsonb_build_object('environment','test','provider',v.provider,'amount_minor',v.amount_minor,'currency','BDT','rule_version',v.rule_version));
  RETURN jsonb_build_object('verification',ekpay_private.trx_verification_json(v),'reused',false);
END;
$$;

CREATE FUNCTION public.api_confirm_transaction(p_key_id uuid,p_idempotency_key text,p_verification_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE; r public.api_idempotency_keys%ROWTYPE; v public.transaction_verifications%ROWTYPE;
  e public.payment_evidence%ROWTYPE; t public.transactions%ROWTYPE; v_now timestamptz:=clock_timestamp(); fingerprint text;
  receipt_exists boolean;
BEGIN
  k:=ekpay_private.require_api_key(p_key_id,'trx:confirm');
  IF k.environment<>'test' THEN RAISE EXCEPTION 'transaction not verifiable' USING ERRCODE='EKV01'; END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_verification_id IS NULL OR p_verification_id !~ '^vr_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'invalid request' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.transaction_verifications
    WHERE merchant_id=k.merchant_id AND environment='test' AND public_id=p_verification_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'verification not found' USING ERRCODE='EKV03'; END IF;
  PERFORM ekpay_private.touch_verification_scope('trx-api:test:'||encode(sha256(convert_to(v.provider_transaction_id,'UTF8')),'hex'));
  PERFORM ekpay_private.touch_verification_scope('trx-api:verification:'||v.id::text);
  SELECT * INTO STRICT v FROM public.transaction_verifications WHERE id=v.id FOR UPDATE;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('verification_id',v.public_id)::text,'UTF8')),'hex');
  SELECT * INTO r FROM public.api_idempotency_keys WHERE merchant_id=k.merchant_id AND environment='test'
    AND operation='trx.confirm' AND key_hash=encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
  receipt_exists:=FOUND;
  IF receipt_exists AND r.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='EK409'; END IF;
  IF v.status='consumed' THEN
    IF NOT receipt_exists THEN
      INSERT INTO public.api_idempotency_keys(merchant_id,environment,operation,key_hash,request_fingerprint,transaction_verification_id)
        VALUES(k.merchant_id,'test','trx.confirm',encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex'),fingerprint,v.id);
    END IF;
    RETURN jsonb_build_object('verification',ekpay_private.trx_verification_json(v),'reused',true);
  END IF;
  IF v.status<>'reserved' OR v.expires_at<=v_now THEN RAISE EXCEPTION 'verification expired' USING ERRCODE='EKV02'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.verification_policy WHERE singleton AND enabled) THEN
    RAISE EXCEPTION 'transaction unavailable' USING ERRCODE='EKV05';
  END IF;
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE id=v.payment_evidence_id FOR SHARE;
  PERFORM 1 FROM public.provider_accounts a WHERE a.id=v.provider_account_id AND a.merchant_id=v.merchant_id
    AND a.environment='test' AND a.provider=v.provider AND a.is_active
    AND a.receiver_identity_hash=e.receiver_identity_hash FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction unavailable' USING ERRCODE='EKV05'; END IF;
  PERFORM 1 FROM public.parser_devices d WHERE d.id=e.source_device_id AND d.merchant_id=e.merchant_id
    AND d.environment=e.environment AND d.provider=e.provider AND d.provider_account_id=e.provider_account_id
    AND d.status='active' AND d.is_synthetic AND d.source_type='provider_api' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transaction unavailable' USING ERRCODE='EKV05'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.provider_accounts a
    WHERE a.id=v.provider_account_id AND a.merchant_id=v.merchant_id AND a.environment='test'
      AND a.provider=v.provider AND a.is_active AND a.receiver_identity_hash=e.receiver_identity_hash
  ) OR e.merchant_id<>v.merchant_id OR e.environment<>'test' OR e.provider<>v.provider
    OR e.provider_account_id<>v.provider_account_id OR e.provider_transaction_id<>v.provider_transaction_id
    OR e.amount_minor<>v.amount_minor OR e.currency<>v.currency OR e.provider_timestamp<>v.provider_timestamp
    OR e.provider_timestamp>v_now OR e.trust_state<>'synthetic' OR e.source<>'provider_api'
    OR e.source_device_id IS NULL OR e.source_key_version IS NULL OR e.source_timestamp IS NULL
    OR e.authentication_method<>'ed25519-synthetic-v1'
    OR e.normalization_version<>'ekpay-evidence-normalization-synthetic-v1'
    OR NOT EXISTS(SELECT 1 FROM public.parser_devices d WHERE d.id=e.source_device_id AND d.merchant_id=e.merchant_id
      AND d.environment=e.environment AND d.provider=e.provider AND d.provider_account_id=e.provider_account_id
      AND d.status='active' AND d.is_synthetic AND d.source_type='provider_api')
    OR NOT EXISTS(SELECT 1 FROM ekpay_private.parser_key_history h WHERE h.device_id=e.source_device_id AND h.key_version=e.source_key_version)
    OR NOT EXISTS(SELECT 1 FROM public.parser_requests pr WHERE pr.evidence_id=e.id AND pr.device_id=e.source_device_id
      AND pr.merchant_id=e.merchant_id AND pr.environment=e.environment AND pr.request_kind='evidence') THEN
    RAISE EXCEPTION 'transaction unavailable' USING ERRCODE='EKV05';
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions x WHERE x.payment_evidence_id=e.id
      OR (x.environment=e.environment AND x.provider=e.provider AND x.provider_transaction_id=e.provider_transaction_id)) THEN
    RAISE EXCEPTION 'transaction unavailable' USING ERRCODE='EKV05';
  END IF;
  IF NOT receipt_exists THEN
    INSERT INTO public.api_idempotency_keys(merchant_id,environment,operation,key_hash,request_fingerprint,transaction_verification_id)
      VALUES(k.merchant_id,'test','trx.confirm',encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex'),fingerprint,v.id);
  END IF;
  INSERT INTO public.transactions(merchant_id,environment,payment_evidence_id,provider_account_id,provider,provider_transaction_id,
    amount_minor,currency,verification_source,verified_at,rule_version,transaction_kind,transaction_verification_id)
  VALUES(v.merchant_id,'test',v.payment_evidence_id,v.provider_account_id,v.provider,v.provider_transaction_id,
    v.amount_minor,v.currency,e.source,v_now,v.rule_version,'trx_api',v.id) RETURNING * INTO t;
  UPDATE public.transaction_verifications SET status='consumed',consumed_at=v_now,transaction_id=t.id WHERE id=v.id RETURNING * INTO v;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(k.merchant_id,'transaction.consumed','transaction',t.id,t.id,
      jsonb_build_object('environment','test','verification_id',v.public_id,'provider',v.provider,
        'amount_minor',v.amount_minor,'currency','BDT','rule_version',v.rule_version));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(k.merchant_id,'api_key',k.id,'transaction.consumed','transaction_verification',v.id,
      jsonb_build_object('environment','test','transaction_id',t.id,'provider',v.provider,
        'amount_minor',v.amount_minor,'currency','BDT','rule_version',v.rule_version));
  RETURN jsonb_build_object('verification',ekpay_private.trx_verification_json(v),'reused',false);
END;
$$;

REVOKE ALL ON FUNCTION public.ekpay_guard_transaction_verification(),public.ekpay_validate_event(),
  public.ekpay_validate_audit(),public.ekpay_serialize_verification_inputs(),public.ekpay_sync_verified_intent(),
  public.ekpay_validate_transaction(),ekpay_private.trx_verification_json(public.transaction_verifications),
  public.api_verify_transaction(uuid,text,jsonb),public.api_confirm_transaction(uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.api_verify_transaction(uuid,text,jsonb),public.api_confirm_transaction(uuid,text,text) TO service_role;

COMMIT;
