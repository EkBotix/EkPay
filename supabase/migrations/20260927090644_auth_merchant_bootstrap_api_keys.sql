BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^ek_(test|live)_[a-f0-9]{16}$'),
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  hash_version integer NOT NULL DEFAULT 1 CHECK (hash_version = 1),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  abilities text[] NOT NULL CHECK (cardinality(abilities) BETWEEN 1 AND 5 AND array_position(abilities,NULL) IS NULL
    AND abilities <@ ARRAY['payment_intents:create','payment_intents:read','transactions:read','webhooks:read','webhooks:manage']::text[]),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  last_used_at timestamptz,
  expires_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  rotated_from_id uuid,
  UNIQUE (merchant_id,id),
  FOREIGN KEY (merchant_id,rotated_from_id) REFERENCES public.api_keys(merchant_id,id) ON DELETE RESTRICT,
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (prefix LIKE 'ek_' || environment || '_%')
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,merchant_id,name,prefix,environment,abilities,status,last_used_at,expires_at,created_by,created_at,revoked_at,rotated_from_id)
ON public.api_keys TO authenticated;
GRANT SELECT ON public.api_keys TO service_role;
CREATE POLICY api_keys_config_read ON public.api_keys FOR SELECT TO authenticated
USING (public.is_merchant_member(merchant_id,ARRAY['owner','admin','developer']::text[]));
CREATE INDEX api_keys_merchant_status_time_idx ON public.api_keys(merchant_id,status,created_at DESC);

-- Auth UID is authoritative; no user ID parameter. One bootstrap per user.
CREATE FUNCTION public.bootstrap_merchant(p_name text,p_slug text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user uuid := auth.uid(); v_merchant uuid;
BEGIN
  IF v_user IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_user
    AND email_confirmed_at IS NOT NULL AND NOT coalesce(is_anonymous,false)) THEN
    RAISE EXCEPTION 'verified account required' USING ERRCODE='42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 80
    OR p_name ~ '[[:cntrl:]]' OR p_slug IS NULL OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$' THEN
    RAISE EXCEPTION 'invalid merchant details' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text,0));
  SELECT merchant_id INTO v_merchant FROM public.merchant_members WHERE user_id=v_user ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.merchant_members mm JOIN public.merchants m ON m.id=mm.merchant_id
      WHERE mm.user_id=v_user AND mm.role='owner' AND m.name=btrim(p_name) AND m.slug=p_slug) THEN
      SELECT m.id INTO v_merchant FROM public.merchants m JOIN public.merchant_members mm ON mm.merchant_id=m.id
        WHERE mm.user_id=v_user AND mm.role='owner' AND m.name=btrim(p_name) AND m.slug=p_slug;
      RETURN v_merchant;
    END IF;
    RAISE EXCEPTION 'merchant membership already exists' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.merchants(name,slug) VALUES (btrim(p_name),p_slug) RETURNING id INTO v_merchant;
  INSERT INTO public.merchant_members(merchant_id,user_id,role) VALUES(v_merchant,v_user,'owner');
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
    VALUES(v_merchant,'user',v_user,'merchant.created','merchant',v_merchant);
  RETURN v_merchant;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_merchant(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_merchant(text,text) TO authenticated;

CREATE FUNCTION public.ekpay_guard_last_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.merchant_id<>OLD.merchant_id OR NEW.user_id<>OLD.user_id) THEN
    RAISE EXCEPTION 'membership identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.role='owner' AND (TG_OP='DELETE' OR NEW.role<>'owner') THEN
    -- A real tuple write serializes owner removals per tenant. Lock-only is
    -- insufficient with REPEATABLE READ snapshots. The existing merchant
    -- timestamp trigger records this owner-configuration change in updated_at;
    -- no identity, name, status or other business value is changed.
    -- That trigger never writes memberships, so this cannot recurse.
    UPDATE public.merchants SET updated_at=updated_at WHERE id=OLD.merchant_id;
    IF FOUND AND NOT EXISTS (SELECT 1 FROM public.merchant_members
      WHERE merchant_id=OLD.merchant_id AND role='owner' AND id<>OLD.id) THEN
      RAISE EXCEPTION 'last owner cannot be removed' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER membership_last_owner BEFORE UPDATE OR DELETE ON public.merchant_members
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_last_owner();

CREATE FUNCTION public.create_merchant_api_key(p_actor_id uuid,p_merchant_id uuid,p_id uuid,p_name text,
  p_prefix text,p_secret_hash text,p_environment text,p_abilities text[],p_expires_at timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM 1 FROM public.merchants m JOIN public.merchant_members mm ON mm.merchant_id=m.id
    WHERE m.id=p_merchant_id AND m.status='active' AND mm.user_id=p_actor_id AND mm.role IN ('owner','admin') FOR SHARE OF m,mm;
  IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
  INSERT INTO public.api_keys(id,merchant_id,name,prefix,secret_hash,environment,abilities,created_by,expires_at)
    VALUES(p_id,p_merchant_id,btrim(p_name),p_prefix,p_secret_hash,p_environment,p_abilities,p_actor_id,p_expires_at);
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id,metadata)
    VALUES(p_merchant_id,'user',p_actor_id,'api_key.created','api_key',p_id,jsonb_build_object('environment',p_environment,'abilities',p_abilities));
  RETURN p_id;
END;
$$;
CREATE FUNCTION public.revoke_merchant_api_key(p_actor_id uuid,p_merchant_id uuid,p_key_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_status text;
BEGIN
  PERFORM 1 FROM public.merchants m JOIN public.merchant_members mm ON mm.merchant_id=m.id
    WHERE m.id=p_merchant_id AND m.status='active' AND mm.user_id=p_actor_id AND mm.role IN ('owner','admin') FOR SHARE OF m,mm;
  IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
  SELECT status INTO v_status FROM public.api_keys WHERE merchant_id=p_merchant_id AND id=p_key_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not permitted' USING ERRCODE='42501'; END IF;
  IF v_status='revoked' THEN RETURN; END IF;
  UPDATE public.api_keys SET status='revoked',revoked_at=clock_timestamp() WHERE merchant_id=p_merchant_id AND id=p_key_id;
  INSERT INTO public.audit_logs(merchant_id,actor_type,actor_id,action,target_type,target_id)
    VALUES(p_merchant_id,'user',p_actor_id,'api_key.revoked','api_key',p_key_id);
END;
$$;
REVOKE ALL ON FUNCTION public.create_merchant_api_key(uuid,uuid,uuid,text,text,text,text,text[],timestamptz),
  public.revoke_merchant_api_key(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_merchant_api_key(uuid,uuid,uuid,text,text,text,text,text[],timestamptz),
  public.revoke_merchant_api_key(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.ekpay_guard_api_key() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'API key history is retained' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','revoked_at','last_used_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','revoked_at','last_used_at']) OR (OLD.status='revoked' AND NEW.status<>'revoked') THEN
    RAISE EXCEPTION 'key identity and revoked state are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER api_key_guard BEFORE UPDATE OR DELETE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.ekpay_guard_api_key();
REVOKE ALL ON FUNCTION public.ekpay_guard_api_key(),public.ekpay_guard_last_owner() FROM PUBLIC,anon,authenticated,service_role;

-- Extend the existing audit validator without changing applied migration files.
CREATE OR REPLACE FUNCTION public.ekpay_validate_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target_table text; target_exists boolean;
BEGIN
  target_table := CASE NEW.target_type
    WHEN 'merchant_member' THEN 'merchant_members' WHEN 'brand' THEN 'merchant_brands'
    WHEN 'provider_account' THEN 'provider_accounts' WHEN 'payment_intent' THEN 'payment_intents'
    WHEN 'payment_evidence' THEN 'payment_evidence' WHEN 'payment_match' THEN 'payment_matches'
    WHEN 'transaction' THEN 'transactions' WHEN 'event' THEN 'events'
    WHEN 'webhook_endpoint' THEN 'webhook_endpoints' WHEN 'webhook_delivery' THEN 'webhook_deliveries'
    WHEN 'parser_device' THEN 'parser_devices' WHEN 'parser_request' THEN 'parser_requests'
    WHEN 'api_key' THEN 'api_keys' END;
  IF NEW.target_type='merchant' THEN target_exists:=NEW.target_id=NEW.merchant_id;
  ELSIF target_table IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE merchant_id=$1 AND id=$2)',target_table)
      INTO target_exists USING NEW.merchant_id,NEW.target_id;
  ELSE RAISE EXCEPTION 'unsupported audit target' USING ERRCODE='23514'; END IF;
  IF NOT target_exists THEN RAISE EXCEPTION 'audit target must belong to merchant' USING ERRCODE='23514'; END IF;
  IF NEW.actor_type='user' AND NOT EXISTS (SELECT 1 FROM public.merchant_members WHERE merchant_id=NEW.merchant_id AND user_id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit user' USING ERRCODE='23514';
  ELSIF NEW.actor_type='parser_device' AND NOT EXISTS (SELECT 1 FROM public.parser_devices WHERE merchant_id=NEW.merchant_id AND id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit device' USING ERRCODE='23514';
  ELSIF NEW.actor_type='api_key' AND NOT EXISTS (SELECT 1 FROM public.api_keys WHERE merchant_id=NEW.merchant_id AND id=NEW.actor_id) THEN
    RAISE EXCEPTION 'invalid audit key' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ekpay_validate_audit() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
