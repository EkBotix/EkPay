BEGIN;

create extension if not exists pgcrypto;

-- =========================================================
-- updated_at helper
-- =========================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- merchants
-- =========================================================

create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger merchants_set_updated_at
before update on public.merchants
for each row execute function public.set_updated_at();

-- =========================================================
-- merchant_members
-- =========================================================

create table public.merchant_members (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null
    check (role in ('owner', 'admin', 'developer', 'viewer')),
  created_at timestamptz not null default now(),
  unique (merchant_id, user_id)
);

create index merchant_members_user_id_idx
  on public.merchant_members(user_id);

create index merchant_members_merchant_id_idx
  on public.merchant_members(merchant_id);

-- =========================================================
-- merchant_brands
-- =========================================================

create table public.merchant_brands (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  domain text,
  logo_url text,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index merchant_brands_merchant_id_idx
  on public.merchant_brands(merchant_id);

create unique index merchant_brands_merchant_domain_unique
  on public.merchant_brands(merchant_id, lower(domain))
  where domain is not null;

create trigger merchant_brands_set_updated_at
before update on public.merchant_brands
for each row execute function public.set_updated_at();

-- =========================================================
-- provider_accounts
-- =========================================================

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  brand_id uuid references public.merchant_brands(id) on delete set null,

  provider text not null
    check (provider in ('bkash', 'nagad', 'rocket', 'upay')),

  account_type text not null
    check (account_type in ('personal', 'agent', 'merchant')),

  account_number_masked text not null,
  account_number_encrypted text not null,
  display_name text,

  verification_mode text not null default 'manual'
    check (verification_mode in ('sms', 'provider_api', 'manual', 'hybrid')),

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index provider_accounts_merchant_id_idx
  on public.provider_accounts(merchant_id);

create index provider_accounts_brand_id_idx
  on public.provider_accounts(brand_id);

create index provider_accounts_provider_idx
  on public.provider_accounts(provider);

create trigger provider_accounts_set_updated_at
before update on public.provider_accounts
for each row execute function public.set_updated_at();

-- =========================================================
-- payment_intents
-- =========================================================

create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),

  merchant_id uuid not null references public.merchants(id) on delete cascade,
  brand_id uuid references public.merchant_brands(id) on delete set null,
  provider_account_id uuid references public.provider_accounts(id) on delete set null,

  public_id text not null unique,
  merchant_reference text not null,

  amount_minor bigint not null
    check (amount_minor > 0),

  currency text not null default 'BDT'
    check (currency = 'BDT'),

  provider text
    check (
      provider is null
      or provider in ('bkash', 'nagad', 'rocket', 'upay')
    ),

  status text not null default 'pending'
    check (
      status in (
        'created',
        'pending',
        'manual_review',
        'verified',
        'failed',
        'expired'
      )
    ),

  customer_reference text,

  metadata jsonb not null default '{}'::jsonb,

  expires_at timestamptz,
  verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (merchant_id, merchant_reference)
);

create index payment_intents_merchant_id_idx
  on public.payment_intents(merchant_id);

create index payment_intents_brand_id_idx
  on public.payment_intents(brand_id);

create index payment_intents_status_idx
  on public.payment_intents(status);

create index payment_intents_provider_idx
  on public.payment_intents(provider);

create index payment_intents_created_at_idx
  on public.payment_intents(created_at desc);

create trigger payment_intents_set_updated_at
before update on public.payment_intents
for each row execute function public.set_updated_at();

-- =========================================================
-- Row Level Security
-- =========================================================

alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.merchant_brands enable row level security;
alter table public.provider_accounts enable row level security;
alter table public.payment_intents enable row level security;

-- =========================================================
-- membership helper
-- =========================================================

create or replace function public.is_merchant_member(
  p_merchant_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id = p_merchant_id
      and mm.user_id = auth.uid()
      and (
        p_roles is null
        or mm.role = any(p_roles)
      )
  );
$$;

revoke all on function public.is_merchant_member(uuid, text[]) from public;
grant execute on function public.is_merchant_member(uuid, text[]) to authenticated;

-- =========================================================
-- RLS policies
-- =========================================================

create policy merchants_select_for_members
on public.merchants
for select
to authenticated
using (
  public.is_merchant_member(id)
);

create policy merchant_members_select_for_members
on public.merchant_members
for select
to authenticated
using (
  public.is_merchant_member(merchant_id)
);

create policy merchant_brands_select_for_members
on public.merchant_brands
for select
to authenticated
using (
  public.is_merchant_member(merchant_id)
);

create policy merchant_brands_manage_for_admins
on public.merchant_brands
for all
to authenticated
using (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
)
with check (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
);

create policy provider_accounts_select_for_members
on public.provider_accounts
for select
to authenticated
using (
  public.is_merchant_member(merchant_id)
);

create policy provider_accounts_manage_for_admins
on public.provider_accounts
for all
to authenticated
using (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
)
with check (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
);

create policy payment_intents_select_for_members
on public.payment_intents
for select
to authenticated
using (
  public.is_merchant_member(merchant_id)
);

create policy payment_intents_insert_for_developers
on public.payment_intents
for insert
to authenticated
with check (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin','developer']::text[]
  )
);

create policy payment_intents_update_for_admins
on public.payment_intents
for update
to authenticated
using (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
)
with check (
  public.is_merchant_member(
    merchant_id,
    array['owner','admin']::text[]
  )
);

COMMIT;