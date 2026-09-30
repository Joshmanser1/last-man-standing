-- FCC Attribution Tracking V1. No historical membership backfill.
begin;

alter table public.memberships
  add column if not exists first_utm_source varchar(160),
  add column if not exists first_utm_medium varchar(160),
  add column if not exists first_utm_campaign varchar(160),
  add column if not exists first_utm_content varchar(160),
  add column if not exists first_attribution_at timestamptz,
  add column if not exists join_utm_source varchar(160),
  add column if not exists join_utm_medium varchar(160),
  add column if not exists join_utm_campaign varchar(160),
  add column if not exists join_utm_content varchar(160),
  add column if not exists join_attribution_at timestamptz;

create table public.league_tracking_links (
  id uuid primary key default gen_random_uuid(),
  slug varchar(80) not null unique
    check (slug = lower(slug) and slug ~ '^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$'),
  join_code varchar(64) not null check (nullif(btrim(join_code), '') is not null),
  utm_source varchar(160),
  utm_medium varchar(160),
  utm_campaign varchar(160),
  utm_content varchar(160),
  created_at timestamptz not null default now(),
  active boolean not null default true
);

alter table public.league_tracking_links enable row level security;
revoke all on public.league_tracking_links from public, anon, authenticated, service_role;
grant select on public.league_tracking_links to service_role;

comment on table public.league_tracking_links is
  'Server-resolved FCC short links. Normal application users have no direct access.';
comment on column public.memberships.first_utm_source is
  'Immutable browser first-touch attribution captured when this membership was created.';
comment on column public.memberships.join_utm_source is
  'Campaign attribution whose stored join code matched this membership join.';

commit;
