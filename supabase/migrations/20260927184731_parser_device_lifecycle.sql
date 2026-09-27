BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.parser_devices) OR EXISTS(SELECT 1 FROM public.parser_requests) THEN
    RAISE EXCEPTION 'parser lifecycle requires separately reviewed populated-registry backfill';
  END IF;
END $$;
ALTER TABLE public.parser_devices
  ALTER COLUMN signing_public_key DROP NOT NULL, ALTER COLUMN secret_hash DROP NOT NULL,
  ALTER COLUMN secret_key_version SET DEFAULT 0, ALTER COLUMN status SET DEFAULT 'pending_pairing',
  DROP CONSTRAINT parser_devices_status_check, DROP CONSTRAINT parser_devices_secret_key_version_check,
  ADD CHECK(status IN ('pending_pairing','active','revoked')),
  ADD CHECK(secret_key_version>=0),
  ADD COLUMN display_name text NOT NULL DEFAULT 'Synthetic device' CHECK(length(display_name) BETWEEN 1 AND 64),
  ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN paired_at timestamptz,
  ADD COLUMN management_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_authenticated_at timestamptz,
  ADD COLUMN app_version text CHECK(length(app_version)<=32),
  ADD COLUMN android_version text CHECK(length(android_version)<=32),
  ADD COLUMN device_model text CHECK(length(device_model)<=64),
  ADD COLUMN locale text CHECK(length(locale)<=16),
  ADD COLUMN timezone text CHECK(length(timezone)<=40),
  ADD COLUMN protocol_version integer NOT NULL DEFAULT 1 CHECK(protocol_version=1),
  ADD CHECK((status='pending_pairing' AND signing_public_key IS NULL AND secret_key_version=0 AND paired_at IS NULL)
    OR (status='active' AND signing_public_key IS NOT NULL AND secret_key_version>0 AND paired_at IS NOT NULL)
    OR status='revoked');
ALTER TABLE public.parser_requests ADD COLUMN request_kind text NOT NULL DEFAULT 'evidence' CHECK(request_kind IN ('evidence','heartbeat'));
REVOKE ALL ON public.parser_devices,public.parser_requests FROM authenticated;
GRANT SELECT(id,merchant_id,public_id,environment,provider,provider_account_id,source_type,is_synthetic,status,secret_key_version,
  display_name,created_at,created_by,paired_at,last_seen_at,last_authenticated_at,revoked_at,rotated_at,app_version,android_version,device_model,locale,timezone,protocol_version)
  ON public.parser_devices TO authenticated;
DROP POLICY devices_admin_read ON public.parser_devices;
CREATE POLICY devices_member_read ON public.parser_devices FOR SELECT TO authenticated USING(public.is_merchant_member(merchant_id));
REVOKE INSERT,UPDATE,DELETE ON public.parser_devices FROM service_role;

CREATE TABLE ekpay_private.parser_policy(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false);
INSERT INTO ekpay_private.parser_policy(singleton) VALUES(true);
CREATE TABLE ekpay_private.parser_pairing_tokens(
  device_id uuid PRIMARY KEY REFERENCES public.parser_devices(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  expected_version integer NOT NULL CHECK(expected_version>=0),
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,consumed_at timestamptz
);
CREATE TABLE ekpay_private.parser_key_history(
  fingerprint text PRIMARY KEY CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  device_id uuid NOT NULL REFERENCES public.parser_devices(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  key_version integer NOT NULL CHECK(key_version>0),public_key bytea NOT NULL CHECK(octet_length(public_key)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),retired_at timestamptz,
  UNIQUE(device_id,key_version)
);
ALTER TABLE ekpay_private.parser_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE ekpay_private.parser_pairing_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ekpay_private.parser_key_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.parser_policy,ekpay_private.parser_pairing_tokens,ekpay_private.parser_key_history FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION ekpay_private.parser_manager(p_merchant uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid();
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN
    RAISE EXCEPTION 'parser access unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchant_members WHERE merchant_id=p_merchant AND user_id=actor AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser access unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.merchants WHERE id=p_merchant AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser access unavailable' USING ERRCODE='42501'; END IF;
  RETURN actor;
END;
$$;
CREATE FUNCTION ekpay_private.require_parser_gate() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.parser_policy WHERE singleton AND enabled) THEN
    RAISE EXCEPTION 'parser foundation disabled' USING ERRCODE='42501';
  END IF;
END;
$$;
CREATE FUNCTION ekpay_private.parser_event(p_device uuid,p_actor uuid,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE;
BEGIN
  SELECT * INTO STRICT d FROM public.parser_devices WHERE id=p_device;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(d.merchant_id,p_action,'parser_device',d.id,gen_random_uuid(),jsonb_build_object('device_id',d.public_id,'environment',d.environment,'status',d.status,'key_version',d.secret_key_version,'synthetic',d.is_synthetic));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(d.merchant_id,CASE WHEN p_actor IS NULL THEN 'parser_device' ELSE 'user' END,coalesce(p_actor,d.id),p_action,'parser_device',d.id,
      jsonb_build_object('environment',d.environment,'key_version',d.secret_key_version,'status',d.status,'synthetic',d.is_synthetic));
END;
$$;

ALTER TABLE public.events DROP CONSTRAINT events_event_type_check,
  ADD CHECK(event_type IN ('payment_intent.created','payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test',
    'payment.evidence_received','payment.match_evaluated','payment.manual_review_required','payment.verification_failed',
    'evidence.ingestion_accepted','evidence.duplicate_detected','evidence.conflict_detected',
    'parser.device_created','parser.pairing_issued','parser.device_paired','parser.key_rotated','parser.device_revoked','parser.heartbeat_received')),
  DROP CONSTRAINT events_object_type_check,
  ADD CHECK(object_type IN ('payment_intent','transaction','webhook_endpoint','payment_evidence','payment_match','parser_device'));
CREATE OR REPLACE FUNCTION public.ekpay_validate_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF (NEW.object_type='payment_intent' AND EXISTS(SELECT 1 FROM public.payment_intents WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='transaction' AND EXISTS(SELECT 1 FROM public.transactions WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='webhook_endpoint' AND EXISTS(SELECT 1 FROM public.webhook_endpoints WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_evidence' AND EXISTS(SELECT 1 FROM public.payment_evidence WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_match' AND EXISTS(SELECT 1 FROM public.payment_matches WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='parser_device' AND EXISTS(SELECT 1 FROM public.parser_devices WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'event object must belong to merchant' USING ERRCODE='23514';
END;
$$;
CREATE OR REPLACE FUNCTION public.ekpay_guard_device() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.id<>OLD.id OR NEW.merchant_id<>OLD.merchant_id OR NEW.public_id<>OLD.public_id OR NEW.environment<>OLD.environment
    OR NEW.provider<>OLD.provider OR NEW.provider_account_id<>OLD.provider_account_id OR NEW.source_type<>OLD.source_type
    OR NEW.is_synthetic<>OLD.is_synthetic OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.secret_hash IS DISTINCT FROM OLD.secret_hash THEN RAISE EXCEPTION 'source identity immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='revoked' AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
    RAISE EXCEPTION 'revoked source immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='pending_pairing' AND NEW.status IN ('active','revoked')) OR (OLD.status='active' AND NEW.status='revoked')) THEN
    RAISE EXCEPTION 'invalid source lifecycle' USING ERRCODE='23514'; END IF;
  IF NEW.signing_public_key IS DISTINCT FROM OLD.signing_public_key OR NEW.secret_key_version<>OLD.secret_key_version THEN
    IF NEW.status<>'active' OR NEW.signing_public_key IS NULL OR NEW.secret_key_version<>OLD.secret_key_version+1
      OR NEW.signing_public_key IS NOT DISTINCT FROM OLD.signing_public_key OR OLD.status='revoked' THEN
      RAISE EXCEPTION 'rotation requires exactly one new key version' USING ERRCODE='23514'; END IF;
    IF OLD.secret_key_version>0 THEN NEW.rotated_at:=clock_timestamp(); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION public.ekpay_record_parser_key() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.status='revoked' THEN UPDATE ekpay_private.parser_key_history SET retired_at=coalesce(retired_at,clock_timestamp()) WHERE device_id=NEW.id; END IF;
    IF NEW.signing_public_key IS NOT DISTINCT FROM OLD.signing_public_key THEN RETURN NEW; END IF;
    UPDATE ekpay_private.parser_key_history SET retired_at=clock_timestamp() WHERE device_id=NEW.id AND retired_at IS NULL;
  END IF;
  IF NEW.signing_public_key IS NOT NULL THEN
    INSERT INTO ekpay_private.parser_key_history(fingerprint,device_id,merchant_id,key_version,public_key)
      VALUES(encode(sha256(NEW.signing_public_key),'hex'),NEW.id,NEW.merchant_id,NEW.secret_key_version,NEW.signing_public_key);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER parser_key_history AFTER INSERT OR UPDATE ON public.parser_devices FOR EACH ROW EXECUTE FUNCTION public.ekpay_record_parser_key();

CREATE FUNCTION ekpay_private.issue_parser_token(p_device uuid,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; token text; expiry timestamptz:=clock_timestamp()+interval '10 minutes';
BEGIN
  SELECT * INTO STRICT d FROM public.parser_devices WHERE id=p_device;
  -- Two cryptographically random v4 UUIDs supply 244 random bits; no extension namespace dependency.
  token:=encode(sha256(convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')),'hex');
  INSERT INTO ekpay_private.parser_pairing_tokens(device_id,token_hash,expected_version,issued_by,expires_at)
    VALUES(d.id,encode(sha256(convert_to(token,'UTF8')),'hex'),d.secret_key_version,p_actor,expiry)
    ON CONFLICT(device_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,expected_version=EXCLUDED.expected_version,issued_by=EXCLUDED.issued_by,expires_at=EXCLUDED.expires_at,consumed_at=NULL;
  RETURN jsonb_build_object('device_id',d.public_id,'status',d.status,'key_version',d.secret_key_version,'pairing_token',token,'expires_at',expiry);
END;
$$;
CREATE FUNCTION public.register_parser_device(p_merchant_id uuid,p_account_id uuid,p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; a public.provider_accounts%ROWTYPE; d public.parser_devices%ROWTYPE; result jsonb;
BEGIN
  PERFORM ekpay_private.require_parser_gate(); actor:=ekpay_private.parser_manager(p_merchant_id);
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 64 OR p_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid device name' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.provider_accounts WHERE id=p_account_id AND merchant_id=p_merchant_id AND environment='test' AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser account unavailable' USING ERRCODE='42501'; END IF;
  INSERT INTO public.parser_devices(merchant_id,environment,provider,provider_account_id,source_type,is_synthetic,display_name,created_by)
    VALUES(p_merchant_id,'test',a.provider,a.id,'provider_api',true,btrim(p_name),actor) RETURNING * INTO d;
  result:=ekpay_private.issue_parser_token(d.id,actor);
  PERFORM ekpay_private.parser_event(d.id,actor,'parser.device_created'); RETURN result;
END;
$$;
CREATE FUNCTION public.issue_parser_pairing(p_device_public_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; actor uuid; result jsonb;
BEGIN
  PERFORM ekpay_private.require_parser_gate();
  SELECT * INTO d FROM public.parser_devices WHERE public_id=p_device_public_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser access unavailable' USING ERRCODE='42501'; END IF;
  actor:=ekpay_private.parser_manager(d.merchant_id);
  UPDATE public.parser_devices SET management_revision=management_revision+1 WHERE id=d.id AND status IN ('pending_pairing','active')
    AND environment='test' AND is_synthetic AND secret_key_version=p_expected_version RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser version unavailable' USING ERRCODE='23505'; END IF;
  result:=ekpay_private.issue_parser_token(d.id,actor);
  PERFORM ekpay_private.parser_event(d.id,actor,'parser.pairing_issued'); RETURN result;
END;
$$;
CREATE FUNCTION public.consume_parser_pairing(p_device_public_id uuid,p_token_hash text,p_public_key bytea,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; token ekpay_private.parser_pairing_tokens%ROWTYPE; action text;
BEGIN
  PERFORM ekpay_private.require_parser_gate();
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_public_key IS NULL OR octet_length(p_public_key)<>32
    OR p_public_key=decode(repeat('00',32),'hex') OR p_public_key=decode(repeat('ff',32),'hex') THEN
    RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  UPDATE public.parser_devices SET management_revision=management_revision+1 WHERE public_id=p_device_public_id AND status IN ('pending_pairing','active')
    AND environment='test' AND is_synthetic AND secret_key_version=p_expected_version RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO token FROM ekpay_private.parser_pairing_tokens WHERE device_id=d.id FOR UPDATE;
  IF NOT FOUND OR token.consumed_at IS NOT NULL OR token.expires_at<=clock_timestamp() OR token.expected_version<>d.secret_key_version
    OR token.token_hash<>p_token_hash THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM auth.users WHERE id=token.issued_by AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.merchant_members WHERE merchant_id=d.merchant_id AND user_id=token.issued_by AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.merchants WHERE id=d.merchant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.provider_accounts WHERE id=d.provider_account_id AND merchant_id=d.merchant_id AND environment=d.environment AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing unavailable' USING ERRCODE='42501'; END IF;
  action:=CASE WHEN d.secret_key_version=0 THEN 'parser.device_paired' ELSE 'parser.key_rotated' END;
  UPDATE public.parser_devices SET signing_public_key=p_public_key,secret_key_version=secret_key_version+1,status='active',paired_at=coalesce(paired_at,clock_timestamp()) WHERE id=d.id RETURNING * INTO d;
  UPDATE ekpay_private.parser_pairing_tokens SET consumed_at=clock_timestamp() WHERE device_id=d.id;
  PERFORM ekpay_private.parser_event(d.id,token.issued_by,action);
  RETURN jsonb_build_object('device_id',d.public_id,'status',d.status,'key_version',d.secret_key_version);
END;
$$;
CREATE FUNCTION public.revoke_parser_device(p_device_public_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; actor uuid;
BEGIN
  PERFORM ekpay_private.require_parser_gate(); SELECT * INTO d FROM public.parser_devices WHERE public_id=p_device_public_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'parser access unavailable' USING ERRCODE='42501'; END IF;
  actor:=ekpay_private.parser_manager(d.merchant_id);
  SELECT * INTO STRICT d FROM public.parser_devices WHERE id=d.id FOR UPDATE;
  IF d.status='revoked' THEN RETURN jsonb_build_object('device_id',d.public_id,'status','revoked','reused',true); END IF;
  UPDATE public.parser_devices SET status='revoked',revoked_at=clock_timestamp(),management_revision=management_revision+1 WHERE id=d.id;
  UPDATE ekpay_private.parser_pairing_tokens SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE device_id=d.id;
  PERFORM ekpay_private.parser_event(d.id,actor,'parser.device_revoked');
  RETURN jsonb_build_object('device_id',d.public_id,'status','revoked','reused',false);
END;
$$;
CREATE FUNCTION public.parser_heartbeat(p_device_public_id uuid,p_key_version integer,p_key_hash text,p_timestamp timestamptz,p_nonce text,p_ingestion_id uuid,p_body_digest text,p_metadata jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.parser_devices%ROWTYPE; r public.parser_requests%ROWTYPE; old public.parser_requests%ROWTYPE; fingerprint text;
BEGIN
  PERFORM ekpay_private.require_parser_gate();
  IF p_nonce IS NULL OR p_nonce !~ '^[A-Za-z0-9_-]{22}$' OR p_ingestion_id IS NULL OR p_body_digest IS NULL OR p_body_digest !~ '^[a-f0-9]{64}$'
    OR p_key_hash IS NULL OR p_timestamp IS NULL OR p_metadata IS NULL OR jsonb_typeof(p_metadata)<>'object' OR octet_length(p_metadata::text)>1024
    OR p_metadata->'protocol_version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(p_metadata->'app_version') IS DISTINCT FROM 'string'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_metadata) k WHERE k NOT IN ('app_version','android_version','device_model','locale','timezone','protocol_version'))
    OR EXISTS(SELECT 1 FROM jsonb_each(p_metadata) j WHERE j.key<>'protocol_version' AND (jsonb_typeof(j.value)<>'string' OR length(j.value#>>'{}')>64 OR (j.value#>>'{}') ~ '[[:cntrl:]]'))
    OR coalesce(length(p_metadata->>'app_version'),0)>32 OR coalesce(length(p_metadata->>'android_version'),0)>32
    OR coalesce(length(p_metadata->>'locale'),0)>16 OR coalesce(length(p_metadata->>'timezone'),0)>40 THEN
    RAISE EXCEPTION 'invalid heartbeat' USING ERRCODE='22023'; END IF;
  fingerprint:=encode(sha256(convert_to('heartbeat:'||p_metadata::text,'UTF8')),'hex');
  PERFORM ekpay_private.touch_verification_scope('ingestion:'||p_ingestion_id::text);
  UPDATE public.parser_devices SET ingestion_revision=ingestion_revision+1 WHERE public_id=p_device_public_id AND status='active' AND environment='test' AND is_synthetic AND source_type='provider_api'
    AND secret_key_version=p_key_version AND encode(sha256(signing_public_key),'hex')=p_key_hash RETURNING * INTO d;
  IF NOT FOUND OR abs(extract(epoch FROM(clock_timestamp()-p_timestamp)))>300 THEN RAISE EXCEPTION 'heartbeat unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.merchants WHERE id=d.merchant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'heartbeat unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.provider_accounts WHERE id=d.provider_account_id AND merchant_id=d.merchant_id AND environment=d.environment AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'heartbeat unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.parser_requests WHERE device_id=d.id AND nonce=p_nonce;
  IF FOUND THEN
    IF r.request_kind<>'heartbeat' OR r.ingestion_id<>p_ingestion_id OR r.semantic_fingerprint<>fingerprint THEN RAISE EXCEPTION 'request conflict' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('accepted',true,'reused',true);
  END IF;
  SELECT * INTO old FROM public.parser_requests WHERE ingestion_id=p_ingestion_id AND retry_of IS NULL;
  IF FOUND AND (old.device_id<>d.id OR old.request_kind<>'heartbeat' OR old.semantic_fingerprint<>fingerprint) THEN RAISE EXCEPTION 'request conflict' USING ERRCODE='23505'; END IF;
  INSERT INTO public.parser_requests(merchant_id,environment,device_id,key_version,nonce,ingestion_id,message_hash,request_timestamp,body_digest,semantic_fingerprint,retry_of,processing_state,request_kind)
    VALUES(d.merchant_id,d.environment,d.id,p_key_version,p_nonce,p_ingestion_id,p_body_digest,p_timestamp,p_body_digest,fingerprint,old.id,CASE WHEN old.id IS NULL THEN 'accepted' ELSE 'duplicate' END,'heartbeat') RETURNING * INTO r;
  UPDATE public.parser_devices SET last_seen_at=clock_timestamp(),last_authenticated_at=clock_timestamp(),app_version=p_metadata->>'app_version',android_version=p_metadata->>'android_version',device_model=p_metadata->>'device_model',locale=p_metadata->>'locale',timezone=p_metadata->>'timezone' WHERE id=d.id;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(d.merchant_id,'parser.heartbeat_received','parser_device',d.id,r.id,jsonb_build_object('environment','test','device_id',d.public_id,'key_version',d.secret_key_version,'protocol_version',1));
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(d.merchant_id,'parser_device',d.id,'parser.heartbeat_received','parser_device',d.id,jsonb_build_object('environment','test','protocol_version',1));
  RETURN jsonb_build_object('accepted',true,'reused',false);
END;
$$;
-- Accepted receipts update health inside the same transaction. This only touches
-- the parent device; its triggers never insert receipts, so no recursion occurs.
CREATE FUNCTION public.ekpay_parser_request_health() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.parser_devices SET last_seen_at=clock_timestamp(),last_authenticated_at=clock_timestamp()
    WHERE id=NEW.device_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'source unavailable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER parser_request_health AFTER INSERT ON public.parser_requests FOR EACH ROW EXECUTE FUNCTION public.ekpay_parser_request_health();
REVOKE ALL ON FUNCTION ekpay_private.parser_manager(uuid),ekpay_private.require_parser_gate(),ekpay_private.parser_event(uuid,uuid,text),ekpay_private.issue_parser_token(uuid,uuid),
  public.ekpay_guard_device(),public.ekpay_record_parser_key(),public.ekpay_parser_request_health(),public.ekpay_validate_event(),public.register_parser_device(uuid,uuid,text),
  public.issue_parser_pairing(uuid,integer),public.consume_parser_pairing(uuid,text,bytea,integer),public.revoke_parser_device(uuid),
  public.parser_heartbeat(uuid,integer,text,timestamptz,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_parser_device(uuid,uuid,text),public.issue_parser_pairing(uuid,integer),public.revoke_parser_device(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_parser_pairing(uuid,text,bytea,integer),public.parser_heartbeat(uuid,integer,text,timestamptz,text,uuid,text,jsonb) TO service_role;
COMMIT;
