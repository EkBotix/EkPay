BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Explicit namespaces for every new trusted object. Existing rows are not reclassified.
-- Evidence/match/transaction NOT NULL additions deliberately fail on populated history;
-- any future backfill needs a separate reviewed provenance manifest.
ALTER TABLE public.payment_intents ALTER COLUMN environment DROP DEFAULT;
ALTER TABLE public.provider_accounts ALTER COLUMN environment DROP DEFAULT;
ALTER TABLE public.payment_evidence ADD COLUMN environment text NOT NULL CHECK(environment IN ('test','live')),
  ADD COLUMN trust_state text NOT NULL DEFAULT 'untrusted' CHECK(trust_state IN ('untrusted','synthetic')),
  ADD UNIQUE(merchant_id,environment,id),
  ADD CONSTRAINT evidence_account_environment_fk FOREIGN KEY(merchant_id,environment,provider_account_id,provider)
    REFERENCES public.provider_accounts(merchant_id,environment,id,provider) ON DELETE RESTRICT;
ALTER TABLE public.payment_matches ADD COLUMN environment text NOT NULL CHECK(environment IN ('test','live')),
  ADD COLUMN merchant_match boolean NOT NULL DEFAULT false,
  ADD COLUMN environment_match boolean NOT NULL DEFAULT false,
  ADD COLUMN source_trusted boolean NOT NULL DEFAULT false,
  ADD COLUMN intent_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN decision_outcome text NOT NULL DEFAULT 'no_match' CHECK(decision_outcome IN ('verified','manual_review','failed','no_match')),
  ADD COLUMN reason_codes text[] NOT NULL DEFAULT '{}' CHECK(cardinality(reason_codes)<=20 AND array_position(reason_codes,NULL) IS NULL),
  ADD UNIQUE(merchant_id,environment,id,payment_intent_id,payment_evidence_id),
  ADD UNIQUE(payment_intent_id,payment_evidence_id,algorithm_version),
  ADD CONSTRAINT match_intent_environment_fk FOREIGN KEY(merchant_id,environment,payment_intent_id)
    REFERENCES public.payment_intents(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD CONSTRAINT match_evidence_environment_fk FOREIGN KEY(merchant_id,environment,payment_evidence_id)
    REFERENCES public.payment_evidence(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD CHECK(status<>'matched' OR (merchant_match AND environment_match AND source_trusted AND intent_eligible AND decision_outcome='verified'));
ALTER TABLE public.transactions ADD COLUMN environment text NOT NULL CHECK(environment IN ('test','live')),
  ADD COLUMN rule_version text NOT NULL CHECK(rule_version='ekpay-verification-synthetic-v1'),
  ADD CONSTRAINT transaction_intent_environment_fk FOREIGN KEY(merchant_id,environment,payment_intent_id)
    REFERENCES public.payment_intents(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD CONSTRAINT transaction_evidence_environment_fk FOREIGN KEY(merchant_id,environment,payment_evidence_id)
    REFERENCES public.payment_evidence(merchant_id,environment,id) ON DELETE RESTRICT,
  ADD CONSTRAINT transaction_match_environment_fk FOREIGN KEY(merchant_id,environment,payment_match_id,payment_intent_id,payment_evidence_id)
    REFERENCES public.payment_matches(merchant_id,environment,id,payment_intent_id,payment_evidence_id) ON DELETE RESTRICT;
-- Bearer clients have no verification path; trusted servers cannot insert transactions
-- directly either. Only the definer operation performs an authoritative insertion.
REVOKE INSERT ON public.transactions FROM service_role;
REVOKE INSERT ON public.payment_matches FROM service_role;
GRANT SELECT(environment,trust_state) ON public.payment_evidence TO authenticated;
CREATE INDEX evidence_provider_reference_idx ON public.payment_evidence(provider,provider_transaction_id);
CREATE INDEX matches_intent_time_idx ON public.payment_matches(merchant_id,payment_intent_id,created_at DESC);

CREATE TABLE ekpay_private.verification_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  enabled boolean NOT NULL DEFAULT false,
  rule_version text NOT NULL DEFAULT 'ekpay-verification-synthetic-v1' CHECK(rule_version='ekpay-verification-synthetic-v1')
);
INSERT INTO ekpay_private.verification_policy(singleton) VALUES(true);
ALTER TABLE ekpay_private.verification_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.verification_policy FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE ekpay_private.verification_serialization(scope text PRIMARY KEY,revision bigint NOT NULL DEFAULT 0);
ALTER TABLE ekpay_private.verification_serialization ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ekpay_private.verification_serialization FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION ekpay_private.touch_verification_scope(p_scope text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO ekpay_private.verification_serialization(scope,revision) VALUES(p_scope,1)
  ON CONFLICT(scope) DO UPDATE SET revision=ekpay_private.verification_serialization.revision+1;
$$;
-- Narrow definer trigger writes only serialization metadata. No business-data change,
-- no environment/role assertion and no external configuration can activate the gate.
CREATE FUNCTION public.ekpay_serialize_verification_inputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='payment_evidence' THEN
    IF NEW.provider_transaction_id IS NOT NULL THEN
      PERFORM ekpay_private.touch_verification_scope('trx:'||encode(sha256(convert_to(NEW.provider||':'||NEW.provider_transaction_id,'UTF8')),'hex'));
    END IF;
  END IF;
  PERFORM ekpay_private.touch_verification_scope('merchant:'||NEW.merchant_id::text);
  RETURN NEW;
END;
$$;
CREATE TRIGGER evidence_serialization BEFORE INSERT ON public.payment_evidence
FOR EACH ROW EXECUTE FUNCTION public.ekpay_serialize_verification_inputs();
CREATE TRIGGER intent_serialization BEFORE INSERT OR UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.ekpay_serialize_verification_inputs();

CREATE FUNCTION public.ekpay_enforce_intent_state() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status IN ('created','pending') AND NEW.status IN ('pending','verified','manual_review','failed','expired'))
    OR (OLD.status='manual_review' AND NEW.status IN ('failed','expired')) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid intent transition' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER intent_state_machine BEFORE UPDATE ON public.payment_intents
FOR EACH ROW EXECUTE FUNCTION public.ekpay_enforce_intent_state();

ALTER TABLE public.events DROP CONSTRAINT events_event_type_check,
  ADD CHECK(event_type IN ('payment_intent.created','payment.verified','payment.failed','payment.expired','payment.manual_review','webhook.test',
    'payment.evidence_received','payment.match_evaluated','payment.manual_review_required','payment.verification_failed')),
  DROP CONSTRAINT events_object_type_check,
  ADD CHECK(object_type IN ('payment_intent','transaction','webhook_endpoint','payment_evidence','payment_match'));
CREATE OR REPLACE FUNCTION public.ekpay_validate_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF (NEW.object_type='payment_intent' AND EXISTS(SELECT 1 FROM public.payment_intents WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='transaction' AND EXISTS(SELECT 1 FROM public.transactions WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='webhook_endpoint' AND EXISTS(SELECT 1 FROM public.webhook_endpoints WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_evidence' AND EXISTS(SELECT 1 FROM public.payment_evidence WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id))
    OR (NEW.object_type='payment_match' AND EXISTS(SELECT 1 FROM public.payment_matches WHERE merchant_id=NEW.merchant_id AND id=NEW.object_id)) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'event object must belong to merchant' USING ERRCODE='23514';
END;
$$;
CREATE FUNCTION public.ekpay_record_synthetic_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.environment='test' AND NEW.trust_state='synthetic' THEN
    INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
      VALUES(NEW.merchant_id,'payment.evidence_received','payment_evidence',NEW.id,NEW.id,
        jsonb_build_object('environment','test','evidence_id',NEW.id,'source',NEW.source,'synthetic',true));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER synthetic_evidence_event AFTER INSERT ON public.payment_evidence
FOR EACH ROW EXECUTE FUNCTION public.ekpay_record_synthetic_evidence();

CREATE OR REPLACE FUNCTION public.ekpay_sync_verified_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
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

-- Preserve every applied deterministic transaction guard, adding explicit test trust,
-- environment/rule/state assertions. The original sync trigger still emits verified
-- only after authoritative insertion, in the same transaction.
CREATE OR REPLACE FUNCTION public.ekpay_validate_transaction() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE i public.payment_intents%ROWTYPE; e public.payment_evidence%ROWTYPE; m public.payment_matches%ROWTYPE; a public.provider_accounts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT i FROM public.payment_intents WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_intent_id FOR UPDATE;
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_evidence_id;
  SELECT * INTO STRICT m FROM public.payment_matches WHERE merchant_id=NEW.merchant_id AND id=NEW.payment_match_id;
  SELECT * INTO STRICT a FROM public.provider_accounts WHERE merchant_id=NEW.merchant_id AND id=NEW.provider_account_id FOR SHARE;
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
END;
$$;

CREATE FUNCTION public.verify_payment_evidence(p_intent_id uuid,p_evidence_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE i public.payment_intents%ROWTYPE; e public.payment_evidence%ROWTYPE; a public.provider_accounts%ROWTYPE;
  m public.payment_matches%ROWTYPE; t public.transactions%ROWTYPE; v_now timestamptz;
  rule constant text:='ekpay-verification-synthetic-v1'; outcome text; reasons text[]:='{}';
  provider_ok boolean; amount_ok boolean; receiver_ok boolean; trx_ok boolean; time_ok boolean; source_ok boolean; eligible boolean;
  conflicts boolean; candidates integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM ekpay_private.verification_policy WHERE singleton AND enabled) THEN
    RAISE EXCEPTION 'synthetic verification disabled' USING ERRCODE='42501';
  END IF;
  SELECT * INTO e FROM public.payment_evidence WHERE id=p_evidence_id;
  IF NOT FOUND OR e.environment<>'test' THEN RAISE EXCEPTION 'test evidence required' USING ERRCODE='42501'; END IF;
  IF e.provider_transaction_id IS NOT NULL THEN
    PERFORM ekpay_private.touch_verification_scope('trx:'||encode(sha256(convert_to(e.provider||':'||e.provider_transaction_id,'UTF8')),'hex'));
  END IF;
  PERFORM ekpay_private.touch_verification_scope('merchant:'||e.merchant_id::text);
  SELECT * INTO i FROM public.payment_intents WHERE id=p_intent_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome','no_match','reasons',ARRAY['intent_not_found'],'rule_version',rule); END IF;
  IF i.merchant_id<>e.merchant_id OR i.environment<>e.environment THEN
    RAISE EXCEPTION 'verification boundary mismatch' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.merchants WHERE id=i.merchant_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merchant unavailable' USING ERRCODE='42501'; END IF;
  SELECT * INTO STRICT e FROM public.payment_evidence WHERE id=p_evidence_id FOR SHARE;
  SELECT * INTO m FROM public.payment_matches WHERE payment_intent_id=i.id AND payment_evidence_id=e.id AND algorithm_version=rule;
  IF FOUND THEN
    SELECT * INTO t FROM public.transactions WHERE payment_match_id=m.id;
    RETURN jsonb_build_object('outcome',m.decision_outcome,'match_id',m.id,'transaction_id',t.id,'reasons',m.reason_codes,'rule_version',rule,'reused',true);
  END IF;
  SELECT * INTO a FROM public.provider_accounts WHERE merchant_id=i.merchant_id AND id=i.provider_account_id FOR SHARE;
  v_now:=clock_timestamp();
  provider_ok:=coalesce(i.provider=e.provider,false);
  amount_ok:=i.amount_minor=e.amount_minor AND i.currency=e.currency;
  receiver_ok:=coalesce(i.provider_account_id=e.provider_account_id AND a.receiver_identity_hash=e.receiver_identity_hash AND a.is_active AND a.environment=e.environment,false);
  trx_ok:=e.provider_transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.transactions WHERE provider=e.provider AND provider_transaction_id=e.provider_transaction_id);
  -- v1 strict zero-skew window: DB clock only, inclusive provider interval.
  time_ok:=coalesce(e.provider_timestamp>=i.created_at AND e.provider_timestamp<=i.expires_at AND e.provider_timestamp<=v_now,false);
  source_ok:=e.trust_state='synthetic' AND e.source='provider_api';
  eligible:=i.status IN ('created','pending') AND coalesce(i.expires_at>v_now,false);
  SELECT EXISTS(SELECT 1 FROM public.payment_evidence x WHERE x.provider=e.provider AND x.provider_transaction_id=e.provider_transaction_id AND x.id<>e.id
    AND (x.merchant_id<>e.merchant_id OR x.environment<>e.environment OR x.provider_account_id<>e.provider_account_id
      OR x.amount_minor<>e.amount_minor OR x.currency<>e.currency OR x.receiver_identity_hash<>e.receiver_identity_hash
      OR x.provider_timestamp IS DISTINCT FROM e.provider_timestamp)) INTO conflicts;
  SELECT count(*) INTO candidates FROM public.payment_intents x WHERE x.merchant_id=e.merchant_id AND x.environment=e.environment
    AND x.provider=e.provider AND x.provider_account_id=e.provider_account_id AND x.amount_minor=e.amount_minor AND x.currency=e.currency
    AND x.status IN ('created','pending','manual_review') AND x.expires_at>v_now AND e.provider_timestamp BETWEEN x.created_at AND x.expires_at;
  IF NOT provider_ok THEN reasons:=array_append(reasons,'provider_mismatch'); END IF;
  IF NOT amount_ok THEN reasons:=array_append(reasons,'amount_currency_mismatch'); END IF;
  IF NOT receiver_ok THEN reasons:=array_append(reasons,'receiver_account_mismatch'); END IF;
  IF NOT trx_ok THEN reasons:=array_append(reasons,CASE WHEN e.provider_transaction_id IS NULL THEN 'transaction_id_missing' ELSE 'transaction_id_consumed' END); END IF;
  IF NOT time_ok THEN reasons:=array_append(reasons,'time_window_mismatch'); END IF;
  IF NOT source_ok THEN reasons:=array_append(reasons,'source_not_trusted'); END IF;
  IF NOT eligible THEN reasons:=array_append(reasons,'intent_ineligible'); END IF;
  IF conflicts THEN reasons:=array_append(reasons,'transaction_reference_conflict'); END IF;
  IF candidates>1 THEN reasons:=array_append(reasons,'ambiguous_intents'); END IF;
  IF NOT provider_ok OR NOT amount_ok OR NOT receiver_ok OR e.provider_transaction_id IS NULL THEN outcome:='failed';
  ELSIF conflicts OR candidates>1 OR NOT source_ok OR NOT trx_ok OR i.status='manual_review' OR e.provider_timestamp IS NULL THEN outcome:='manual_review';
  ELSIF NOT time_ok OR NOT eligible THEN outcome:='failed';
  ELSE outcome:='verified'; END IF;
  INSERT INTO public.payment_matches(merchant_id,environment,payment_intent_id,payment_evidence_id,algorithm_version,provider_match,amount_match,receiver_match,
    transaction_id_match,time_match,merchant_match,environment_match,source_trusted,intent_eligible,status,decision_outcome,reason_codes)
    VALUES(i.merchant_id,i.environment,i.id,e.id,rule,provider_ok,amount_ok,receiver_ok,trx_ok,time_ok,true,true,source_ok,eligible,
      CASE outcome WHEN 'verified' THEN 'matched' WHEN 'manual_review' THEN 'manual_review' ELSE 'rejected' END,outcome,reasons) RETURNING * INTO m;
  INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
    VALUES(i.merchant_id,'payment.match_evaluated','payment_match',m.id,m.id,
      jsonb_build_object('environment',i.environment,'intent_id',i.public_id,'evidence_id',e.id,'outcome',outcome,'rule_version',rule,'reasons',reasons));
  IF outcome='verified' THEN
    INSERT INTO public.transactions(merchant_id,environment,payment_intent_id,payment_evidence_id,payment_match_id,provider_account_id,provider,
      provider_transaction_id,amount_minor,currency,verification_source,verified_at,rule_version)
      VALUES(i.merchant_id,i.environment,i.id,e.id,m.id,e.provider_account_id,e.provider,e.provider_transaction_id,e.amount_minor,e.currency,e.source,v_now,rule) RETURNING * INTO t;
  ELSE
    IF i.status IN ('created','pending') THEN
      IF i.expires_at<=v_now THEN UPDATE public.payment_intents SET status='expired' WHERE id=i.id;
      ELSIF outcome='manual_review' THEN UPDATE public.payment_intents SET status='manual_review' WHERE id=i.id; END IF;
    END IF;
    INSERT INTO public.events(merchant_id,event_type,object_type,object_id,idempotency_key,payload)
      VALUES(i.merchant_id,CASE outcome WHEN 'manual_review' THEN 'payment.manual_review_required' ELSE 'payment.verification_failed' END,'payment_intent',i.id,gen_random_uuid(),
        jsonb_build_object('environment',i.environment,'match_id',m.id,'outcome',outcome,'rule_version',rule,'reasons',reasons));
  END IF;
  INSERT INTO public.audit_logs(merchant_id,actor_type,action,target_type,target_id,metadata)
    VALUES(i.merchant_id,'system','payment.verification_decided','payment_match',m.id,
      jsonb_build_object('environment',i.environment,'intent_id',i.public_id,'evidence_id',e.id,'transaction_id',t.id,'source',e.source,'outcome',outcome,'rule_version',rule,'reasons',reasons));
  RETURN jsonb_build_object('outcome',outcome,'match_id',m.id,'transaction_id',t.id,'reasons',reasons,'rule_version',rule,'reused',false);
END;
$$;
REVOKE ALL ON FUNCTION ekpay_private.touch_verification_scope(text),public.ekpay_serialize_verification_inputs(),
  public.ekpay_enforce_intent_state(),public.ekpay_validate_event(),public.ekpay_record_synthetic_evidence(),
  public.ekpay_validate_transaction(),public.ekpay_sync_verified_intent(),public.verify_payment_evidence(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verify_payment_evidence(uuid,uuid) TO service_role;
COMMIT;
