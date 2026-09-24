-- Apply through Supabase SQL Editor before deploying the consent UI/API.
-- No backfill; existing accounts remain unsubscribed. This is a one-time migration.
begin;

create table public.marketing_consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('opt_in', 'opt_out')),
  authenticated_email text,
  capture_source text not null check (capture_source in ('pick_confirmation', 'email_preferences')),
  consent_version text not null check (consent_version = 'fcc_marketing_v1'),
  consent_wording text not null check (consent_wording = 'Email me about new FCC competitions, creator leagues and prize competitions.'),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  check (action <> 'opt_in' or nullif(btrim(authenticated_email), '') is not null)
);
create index marketing_consent_events_user_time on public.marketing_consent_events (user_id, created_at, id);

create table public.marketing_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  marketing_opt_in boolean not null default false,
  consented_email text,
  updated_at timestamptz not null default now(),
  latest_event_id uuid not null,
  foreign key (user_id, latest_event_id) references public.marketing_consent_events(user_id, id),
  check (not marketing_opt_in or nullif(btrim(consented_email), '') is not null)
);
create index marketing_preferences_subscribed on public.marketing_preferences (user_id) where marketing_opt_in;

alter table public.marketing_preferences enable row level security;
alter table public.marketing_consent_events enable row level security;
revoke all on public.marketing_preferences, public.marketing_consent_events from public, anon, authenticated, service_role;
grant select on public.marketing_preferences to authenticated, service_role;
grant select on public.marketing_consent_events to service_role;
create policy marketing_preferences_read_own on public.marketing_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
-- No client history policy and no direct DML grants (including for service_role).
-- Only the function owner can append history/update preferences. Account deletion
-- cascades both tables; ordinary preference changes never delete consent evidence.

create function public.set_marketing_preference(
  p_user_id uuid, p_opt_in boolean, p_capture_source text, p_consent_version text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_row public.marketing_preferences%rowtype;
  current_email text;
  verified_at timestamptz;
  event_id uuid;
  event_time timestamptz;
begin
  if p_user_id is null or p_opt_in is null
     or p_capture_source is null or p_capture_source not in ('pick_confirmation', 'email_preferences')
     or p_consent_version is distinct from 'fcc_marketing_v1' then
    raise exception 'Invalid marketing consent request' using errcode = '22023';
  end if;
  -- Serializes first-time inserts as well as later changes for this user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  select email, email_confirmed_at into current_email, verified_at
    from auth.users where id = p_user_id;
  if not found then
    raise exception 'Authenticated user not found' using errcode = '22023';
  end if;
  if p_opt_in and (verified_at is null or nullif(btrim(current_email), '') is null) then
    raise exception 'A verified email is required' using errcode = '22023';
  end if;
  select * into current_row from public.marketing_preferences where user_id = p_user_id;
  if found and current_row.marketing_opt_in = p_opt_in
     and (not p_opt_in or current_row.consented_email = current_email) then
    return to_jsonb(current_row);
  end if;

  event_time := clock_timestamp();
  insert into public.marketing_consent_events
    (user_id, action, authenticated_email, capture_source, consent_version, consent_wording, created_at)
  values (p_user_id, case when p_opt_in then 'opt_in' else 'opt_out' end,
    current_email, p_capture_source, p_consent_version,
    'Email me about new FCC competitions, creator leagues and prize competitions.', event_time)
  returning id into event_id;

  insert into public.marketing_preferences (user_id, marketing_opt_in, consented_email, updated_at, latest_event_id)
  values (p_user_id, p_opt_in, case when p_opt_in then current_email else current_row.consented_email end, event_time, event_id)
  on conflict (user_id) do update set
    marketing_opt_in = excluded.marketing_opt_in,
    consented_email = excluded.consented_email,
    updated_at = excluded.updated_at,
    latest_event_id = excluded.latest_event_id
  returning * into current_row;
  return to_jsonb(current_row);
end;
$$;
revoke all on function public.set_marketing_preference(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.set_marketing_preference(uuid, boolean, text, text) to service_role;

comment on table public.marketing_preferences is 'FCC promotional email only. No row means no consent. Sending also requires a matching current verified Auth email.';
comment on table public.marketing_consent_events is 'Append-only consent evidence; no direct DML grants. No creator access. Account deletion removes associated personal data.';
commit;
