BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Legacy rows remain logical live data. No provider/network integration is enabled.
ALTER TABLE public.provider_accounts ADD COLUMN environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('test','live')), ADD UNIQUE(merchant_id,environment,id,provider);
ALTER TABLE public.payment_intents ADD COLUMN environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('test','live')), ADD UNIQUE(merchant_id,environment,id),
  DROP CONSTRAINT payment_intents_merchant_id_merchant_reference_key,
  ADD UNIQUE(merchant_id,environment,merchant_reference),
  ADD CONSTRAINT intent_account_environment_fk FOREIGN KEY(merchant_id,environment,provider_account_id,provider)
    REFERENCES public.provider_accounts(merchant_id,environment,id,provider) ON DELETE RESTRICT;
GRANT SELECT(environment) ON public.provider_accounts TO authenticated;
CREATE INDEX intents_tenant_environment_time_idx ON public.payment_intents(merchant_id,environment,created_at DESC);
ALTER TABLE public.events DROP CONSTRAINT events_event_type_check,
  ADD CONSTRAINT events_event_type_check CHECK(event_type IN
    ('payment_intent.created','payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test'));

CREATE TABLE public.api_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  environment text NOT NULL CHECK(environment IN ('test','live')),
  key_hash text NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  payment_intent_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(merchant_id,environment,key_hash),
  FOREIGN KEY(merchant_id,environment,payment_intent_id)
    REFERENCES public.payment_intents(merchant_id,environment,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE public.api_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_idempotency_keys FROM PUBLIC,anon,authenticated,service_role;
-- No client/table mutation path: only the narrowly authorized RPC can reserve receipts.
CREATE TRIGGER idempotency_immutable BEFORE UPDATE OR DELETE ON public.api_idempotency_keys
FOR EACH ROW EXECUTE FUNCTION public.ekpay_reject_mutation();

CREATE FUNCTION public.ekpay_guard_intent_environment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.environment<>OLD.environment OR NEW.merchant_id<>OLD.merchant_id THEN
    RAISE EXCEPTION 'intent tenant/environment is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER intent_environment_guard BEFORE UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_intent_environment();

-- Internal helper is never an exposed RPC. Key ID comes only from the server's
-- HMAC-verified lookup. The privileged operation rechecks current DB state under locks.
CREATE FUNCTION ekpay_private.require_api_key(p_key_id uuid,p_ability text) RETURNS public.api_keys
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE id=p_key_id FOR SHARE;
  IF NOT FOUND OR k.status<>'active' OR (k.expires_at IS NOT NULL AND k.expires_at<=clock_timestamp())
    OR NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=k.merchant_id AND status='active' FOR SHARE) THEN
    RAISE EXCEPTION 'invalid API credential' USING ERRCODE='EK401';
  END IF;
  IF NOT p_ability=ANY(k.abilities) THEN
    RAISE EXCEPTION 'required ability missing' USING ERRCODE='EK403';
  END IF;
  RETURN k;
END;
$$;

CREATE FUNCTION ekpay_private.intent_api_json(i public.payment_intents) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',i.public_id,'reference',i.merchant_reference,
    'amount',i.amount_minor,'currency',i.currency,'provider',i.provider,
    'status',CASE WHEN i.status IN ('created','pending','manual_review') AND i.expires_at<=clock_timestamp()
      THEN 'expired' ELSE i.status END,
    'environment',i.environment,'customer_reference',i.customer_reference,'metadata',i.metadata,
    'created_at',i.created_at,'expires_at',i.expires_at,'verified_at',i.verified_at);
$$;

CREATE FUNCTION public.api_create_payment_intent(p_key_id uuid,p_idempotency_key text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE; i public.payment_intents%ROWTYPE; r public.api_idempotency_keys%ROWTYPE;
  account_id uuid; account public.provider_accounts%ROWTYPE; fingerprint text; normalized jsonb;
  intent_id uuid:=gen_random_uuid(); receipt_id uuid; expiry timestamptz; amount bigint;
BEGIN
  k:=ekpay_private.require_api_key(p_key_id,'payment_intents:create');
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
    OR octet_length(p_payload::text)>8192 THEN
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
    OR p_payload->>'reference' ~ '[[:cntrl:]]'
    OR jsonb_typeof(p_payload->'provider_account_id')<>'string'
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
  -- The unique reservation is the concurrency barrier. The deferred FK permits
  -- reserving the generated intent UUID before insertion; no partial receipt commits.
  INSERT INTO public.api_idempotency_keys(merchant_id,environment,key_hash,request_fingerprint,payment_intent_id)
    VALUES(k.merchant_id,k.environment,encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex'),fingerprint,intent_id)
    ON CONFLICT(merchant_id,environment,key_hash) DO NOTHING RETURNING id INTO receipt_id;
  IF receipt_id IS NULL THEN
    SELECT * INTO STRICT r FROM public.api_idempotency_keys WHERE merchant_id=k.merchant_id AND environment=k.environment
      AND key_hash=encode(sha256(convert_to(p_idempotency_key,'UTF8')),'hex');
    IF r.request_fingerprint<>fingerprint THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='EK409'; END IF;
    SELECT * INTO STRICT i FROM public.payment_intents WHERE merchant_id=k.merchant_id AND environment=k.environment AND id=r.payment_intent_id;
    RETURN jsonb_build_object('intent',ekpay_private.intent_api_json(i),'reused',true);
  END IF;
  -- Validate expiry after replay lookup: omitted defaults do not change fingerprint
  -- and retry of an already-expired original request still returns its same intent.
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

CREATE FUNCTION public.api_read_payment_intent(p_key_id uuid,p_public_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.api_keys%ROWTYPE; i public.payment_intents%ROWTYPE;
BEGIN
  k:=ekpay_private.require_api_key(p_key_id,'payment_intents:read');
  SELECT * INTO i FROM public.payment_intents WHERE merchant_id=k.merchant_id AND environment=k.environment AND public_id=p_public_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN ekpay_private.intent_api_json(i);
END;
$$;
REVOKE ALL ON FUNCTION public.ekpay_guard_intent_environment(),ekpay_private.require_api_key(uuid,text),
  ekpay_private.intent_api_json(public.payment_intents),public.api_create_payment_intent(uuid,text,jsonb),
  public.api_read_payment_intent(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.api_create_payment_intent(uuid,text,jsonb),public.api_read_payment_intent(uuid,text) TO service_role;
COMMIT;
