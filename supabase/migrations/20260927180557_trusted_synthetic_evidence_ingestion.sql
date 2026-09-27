BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
-- Empty live registry verified before review; do not guess legacy source identity.
ALTER TABLE public.parser_devices
  ADD COLUMN environment text NOT NULL CHECK(environment IN ('test','live')),
  ADD COLUMN provider text NOT NULL CHECK(provider IN ('bkash','nagad','rocket','upay')),
  ADD COLUMN provider_account_id uuid NOT NULL,
  ADD COLUMN source_type text NOT NULL DEFAULT 'parser_device' CHECK(source_type IN ('parser_device','provider_api','manual_admin')),
  ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false,
  ADD COLUMN ingestion_revision bigint NOT NULL DEFAULT 0,
  ADD UNIQUE(merchant_id,environment,id),
  ADD FOREIGN KEY(merchant_id,environment,provider_account_id,provider)
    REFERENCES public.provider_accounts(merchant_id,environment,id,provider) ON DELETE RESTRICT;
ALTER TABLE public.parser_requests
  ADD COLUMN environment text NOT NULL CHECK(environment IN ('test','live')),
  ADD COLUMN body_digest text CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN semantic_fingerprint text CHECK(semantic_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD COLUMN evidence_id uuid,
  ADD COLUMN retry_of uuid,
  ADD COLUMN processing_state text CHECK(processing_state IN ('accepted','duplicate')),
  ADD FOREIGN KEY(merchant_id,environment,device_id) REFERENCES public.parser_devices(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD UNIQUE(device_id,ingestion_id,id),
  ADD FOREIGN KEY(device_id,ingestion_id,retry_of) REFERENCES public.parser_requests(device_id,ingestion_id,id),
  ADD FOREIGN KEY(merchant_id,evidence_id) REFERENCES public.payment_evidence(merchant_id,id) DEFERRABLE INITIALLY DEFERRED,
  DROP CONSTRAINT parser_requests_ingestion_id_key,
  DROP CONSTRAINT parser_requests_merchant_id_device_id_message_hash_key;
-- One primary receipt per global ingestion identity; new nonce retries reference it.
CREATE UNIQUE INDEX parser_primary_ingestion_identity ON public.parser_requests(ingestion_id) WHERE retry_of IS NULL;
CREATE INDEX parser_message_lookup ON public.parser_requests(merchant_id,device_id,message_hash);
ALTER TABLE public.payment_evidence
  ADD COLUMN source_device_id uuid,
  ADD COLUMN source_key_version integer CHECK(source_key_version>0),
  ADD COLUMN source_timestamp timestamptz,
  ADD COLUMN authentication_method text CHECK(authentication_method='ed25519-synthetic-v1'),
  ADD COLUMN normalization_version text CHECK(normalization_version='ekpay-evidence-normalization-synthetic-v1'),
  ADD FOREIGN KEY(merchant_id,environment,source_device_id) REFERENCES public.parser_devices(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD CHECK((source_device_id IS NULL AND source_key_version IS NULL AND source_timestamp IS NULL AND authentication_method IS NULL AND normalization_version IS NULL)
    OR (source_device_id IS NOT NULL AND source_key_version IS NOT NULL AND source_timestamp IS NOT NULL AND authentication_method IS NOT NULL
      AND normalization_version IS NOT NULL AND environment='test' AND trust_state='synthetic' AND source='provider_api'));
GRANT SELECT(source_device_id,source_key_version,source_timestamp,authentication_method,normalization_version) ON public.payment_evidence TO authenticated;
GRANT SELECT(environment,provider,source_type,is_synthetic) ON public.parser_devices TO authenticated;
REVOKE INSERT ON public.payment_evidence,public.parser_requests FROM service_role;

CREATE TABLE ekpay_private.ingestion_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
INSERT INTO ekpay_private.ingestion_policy(singleton) VALUES(true);
ALTER TABLE ekpay_private.ingestion_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.ingestion_policy FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.ekpay_guard_device() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.merchant_id<>OLD.merchant_id OR NEW.public_id<>OLD.public_id
    OR NEW.environment<>OLD.environment OR NEW.provider<>OLD.provider OR NEW.provider_account_id<>OLD.provider_account_id
    OR NEW.source_type<>OLD.source_type OR NEW.is_synthetic<>OLD.is_synthetic
    OR NEW.secret_key_version<OLD.secret_key_version OR (OLD.status='revoked' AND NEW.status<>'revoked') THEN
    RAISE EXCEPTION 'source identity or key/state rollback forbidden' USING ERRCODE='23514';
  END IF;
  IF (NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash)
    AND NEW.secret_key_version<=OLD.secret_key_version THEN
    RAISE EXCEPTION 'rotation requires a new version' USING ERRCODE='23514';
  END IF;
  IF NEW.secret_key_version>OLD.secret_key_version THEN NEW.rotated_at:=clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.ekpay_audit_source_configuration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status=OLD.status AND NEW.secret_key_version=OLD.secret_key_version THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.audit_logs(merchant_id,actor_type,action,target_type,target_id,metadata)
    VALUES(NEW.merchant_id,'system','evidence.source_configured','parser_device',NEW.id,
      jsonb_build_object('environment',NEW.environment,'source_type',NEW.source_type,'synthetic',NEW.is_synthetic,'status',NEW.status,'key_version',NEW.secret_key_version));
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_configuration_audit AFTER INSERT OR UPDATE ON public.parser_devices
FOR EACH ROW EXECUTE FUNCTION public.ekpay_audit_source_configuration();

ALTER TABLE public.events DROP CONSTRAINT events_event_type_check,
  ADD CHECK(event_type IN ('payment_intent.created','payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test',
    'payment.evidence_received','payment.match_evaluated','payment.manual_review_required','payment.verification_failed',
    'evidence.ingestion_accepted','evidence.duplicate_detected','evidence.conflict_detected'));

CREATE FUNCTION public.ingest_synthetic_evidence(p_source_public_id uuid,p_key_version integer,p_verified_key_hash text,
  p_timestamp timestamptz,p_nonce text,p_ingestion_id uuid,p_message_hash text,p_body_digest text,p_fields jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; r public.parser_requests%ROWTYPE; old public.parser_requests%ROWTYPE;
  e public.payment_evidence%ROWTYPE; fingerprint text; result_state text; reference text; provider_time timestamptz;
  version constant text:='ekpay-evidence-normalization-synthetic-v1';
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.ingestion_policy WHERE singleton AND enabled) THEN
    RAISE EXCEPTION 'synthetic ingestion disabled' USING ERRCODE='42501';
  END IF;
  IF p_key_version IS NULL OR p_verified_key_hash IS NULL OR p_timestamp IS NULL OR p_nonce IS NULL
    OR p_ingestion_id IS NULL OR p_message_hash IS NULL OR p_body_digest IS NULL OR p_fields IS NULL
    OR p_verified_key_hash !~ '^[a-f0-9]{64}$' OR p_message_hash !~ '^[a-f0-9]{64}$' OR p_body_digest !~ '^[a-f0-9]{64}$'
    OR p_nonce !~ '^[A-Za-z0-9_-]{16,128}$' OR jsonb_typeof(p_fields)<>'object' OR octet_length(p_fields::text)>4096
    OR NOT p_fields ?& ARRAY['provider','provider_transaction_id','amount_minor','currency','receiver_identity_hash','sender_identity_hash','provider_timestamp']
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN ('provider','provider_transaction_id','amount_minor','currency','receiver_identity_hash','sender_identity_hash','provider_timestamp'))
    OR jsonb_typeof(p_fields->'amount_minor')<>'number' OR (p_fields->>'amount_minor') !~ '^[1-9][0-9]{0,15}$'
    OR (p_fields->>'amount_minor')::numeric>9007199254740991 OR p_fields->>'currency' IS DISTINCT FROM 'BDT'
    OR coalesce(p_fields->>'receiver_identity_hash','') !~ '^[a-f0-9]{64}$'
    OR (p_fields->>'sender_identity_hash' IS NOT NULL AND (p_fields->>'sender_identity_hash') !~ '^[a-f0-9]{64}$')
    OR coalesce(p_fields->>'provider_transaction_id','') !~ '^[A-Z0-9][A-Z0-9._-]{0,127}$'
    OR jsonb_typeof(p_fields->'provider_timestamp')<>'string' THEN
    RAISE EXCEPTION 'invalid normalized synthetic evidence' USING ERRCODE='22023';
  END IF;
  provider_time:=(p_fields->>'provider_timestamp')::timestamptz;
  reference:=p_fields->>'provider_transaction_id';
  fingerprint:=encode(sha256(convert_to(p_fields::text,'UTF8')),'hex');
  -- Actual writes, not lock-only reads: stale higher-isolation snapshots must abort.
  PERFORM ekpay_private.touch_verification_scope('ingestion:'||p_ingestion_id::text);
  PERFORM ekpay_private.touch_verification_scope('message:'||p_message_hash);
  UPDATE public.parser_devices SET ingestion_revision=ingestion_revision+1
    WHERE public_id=p_source_public_id AND status='active' AND is_synthetic AND environment='test' AND source_type='provider_api'
      AND secret_key_version=p_key_version AND encode(sha256(signing_public_key),'hex')=p_verified_key_hash RETURNING * INTO d;
  IF NOT FOUND OR abs(extract(epoch FROM(clock_timestamp()-p_timestamp)))>300 THEN
    RAISE EXCEPTION 'source authentication unavailable' USING ERRCODE='42501';
  END IF;
  IF p_fields->>'provider' IS DISTINCT FROM d.provider THEN RAISE EXCEPTION 'provider source mismatch' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.merchants WHERE id=d.merchant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merchant unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.provider_accounts WHERE id=d.provider_account_id AND merchant_id=d.merchant_id AND environment=d.environment AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'source account unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.parser_requests WHERE device_id=d.id AND nonce=p_nonce;
  IF FOUND THEN
    IF r.ingestion_id<>p_ingestion_id OR r.semantic_fingerprint IS DISTINCT FROM fingerprint OR r.message_hash<>p_message_hash THEN
      RAISE EXCEPTION 'nonce replay conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('state','duplicate','evidence_id',r.evidence_id,'request_id',r.id,'reused',true);
  END IF;
  SELECT * INTO old FROM public.parser_requests WHERE ingestion_id=p_ingestion_id AND retry_of IS NULL;
  IF FOUND THEN
    IF old.device_id<>d.id OR old.semantic_fingerprint IS DISTINCT FROM fingerprint OR old.message_hash<>p_message_hash THEN
      RAISE EXCEPTION 'ingestion identity conflict' USING ERRCODE='23505';
    END IF;
    SELECT * INTO STRICT e FROM public.payment_evidence WHERE id=old.evidence_id;
    result_state:='duplicate';
  ELSE
    SELECT * INTO e FROM public.payment_evidence WHERE merchant_id=d.merchant_id AND provider_account_id=d.provider_account_id AND source='provider_api' AND message_hash=p_message_hash;
    IF FOUND THEN
      IF NOT EXISTS(SELECT 1 FROM public.parser_requests WHERE evidence_id=e.id AND semantic_fingerprint=fingerprint) THEN
        RAISE EXCEPTION 'message content conflict' USING ERRCODE='23505';
      END IF;
      result_state:='duplicate';
    ELSE
      e.id:=gen_random_uuid(); result_state:='accepted';
    END IF;
  END IF;
  INSERT INTO public.parser_requests(merchant_id,environment,device_id,key_version,nonce,ingestion_id,message_hash,request_timestamp,
    body_digest,semantic_fingerprint,evidence_id,retry_of,processing_state)
    VALUES(d.merchant_id,d.environment,d.id,p_key_version,p_nonce,p_ingestion_id,p_message_hash,p_timestamp,
      p_body_digest,fingerprint,e.id,old.id,result_state) RETURNING * INTO r;
  IF result_state='accepted' THEN
    INSERT INTO public.payment_evidence(id,merchant_id,environment,provider_account_id,provider,source,provider_transaction_id,amount_minor,currency,
      receiver_identity_hash,sender_identity_hash,provider_timestamp,ingestion_id,message_hash,trust_state,
      source_device_id,source_key_version,source_timestamp,authentication_method,normalization_version)
    VALUES(e.id,d.merchant_id,d.environment,d.provider_account_id,d.provider,'provider_api',reference,(p_fields->>'amount_minor')::bigint,'BDT',
      p_fields->>'receiver_identity_hash',p_fields->>'sender_identity_hash',provider_time,p_ingestion_id,p_message_hash,'synthetic',
      d.id,p_key_version,p_timestamp,'ed25519-synthetic-v1',version);
  END IF;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(d.merchant_id,CASE result_state WHEN 'accepted' THEN 'evidence.ingestion_accepted' ELSE 'evidence.duplicate_detected' END,'payment_evidence',e.id,r.id,
      jsonb_build_object('environment','test','request_id',r.id,'source_id',d.public_id,'state',result_state,'normalization_version',version));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(d.merchant_id,'parser_device',d.id,'evidence.ingested','payment_evidence',e.id,
      jsonb_build_object('environment','test','request_id',r.id,'state',result_state,'source_type',d.source_type,'key_version',p_key_version,'normalization_version',version));
  RETURN jsonb_build_object('state',result_state,'evidence_id',e.id,'request_id',r.id,'reused',false);
END;
$$;
REVOKE ALL ON FUNCTION public.ekpay_guard_device(),public.ekpay_audit_source_configuration(),
  public.ingest_synthetic_evidence(uuid,integer,text,timestamptz,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ingest_synthetic_evidence(uuid,integer,text,timestamptz,text,uuid,text,text,jsonb) TO service_role;
COMMIT;
