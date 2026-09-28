-- Apply through Supabase SQL Editor before enabling the service-email endpoint.
-- This migration does not schedule jobs or send email.
begin;

create table public.service_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('pick_reminder', 'round_result')),
  outcome text check (outcome in ('through', 'eliminated_loss', 'eliminated_draw', 'eliminated_no_pick')),
  status text not null check (status in ('processing', 'sent', 'failed')),
  claim_token uuid,
  claimed_at timestamptz,
  provider_message_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (league_id, round_id, player_id, event_type),
  check ((event_type = 'pick_reminder' and outcome is null) or
         (event_type = 'round_result' and outcome is not null)),
  check ((status = 'sent' and sent_at is not null and provider_message_id is not null) or status <> 'sent')
);
create index service_email_deliveries_retryable
  on public.service_email_deliveries (status, claimed_at) where status <> 'sent';

alter table public.service_email_deliveries enable row level security;
revoke all on public.service_email_deliveries from public, anon, authenticated, service_role;
grant select on public.service_email_deliveries to service_role;

create or replace function public.claim_service_email_delivery(
  p_league_id uuid, p_round_id uuid, p_player_id uuid, p_event_type text, p_outcome text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare claimed public.service_email_deliveries%rowtype;
begin
  if p_event_type not in ('pick_reminder', 'round_result') or
     (p_event_type = 'pick_reminder' and p_outcome is not null) or
     (p_event_type = 'round_result' and p_outcome not in
       ('through', 'eliminated_loss', 'eliminated_draw', 'eliminated_no_pick')) then
    raise exception 'Invalid service email delivery';
  end if;

  insert into public.service_email_deliveries
    (league_id, round_id, player_id, event_type, outcome, status, claim_token, claimed_at, attempt_count)
  values
    (p_league_id, p_round_id, p_player_id, p_event_type, p_outcome,
     'processing', gen_random_uuid(), clock_timestamp(), 1)
  on conflict (league_id, round_id, player_id, event_type) do update set
    outcome = excluded.outcome,
    status = 'processing',
    claim_token = gen_random_uuid(),
    claimed_at = clock_timestamp(),
    attempt_count = public.service_email_deliveries.attempt_count + 1,
    last_error = null,
    updated_at = clock_timestamp()
  where (public.service_email_deliveries.status = 'failed'
     or (public.service_email_deliveries.status = 'processing'
         and public.service_email_deliveries.claimed_at < clock_timestamp() - interval '15 minutes'))
    and public.service_email_deliveries.attempt_count < 5
  returning * into claimed;

  if not found then return null; end if;
  return jsonb_build_object('id', claimed.id, 'claim_token', claimed.claim_token,
    'attempt_count', claimed.attempt_count);
end;
$$;

create or replace function public.complete_service_email_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_provider_message_id text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.service_email_deliveries set
    status = 'sent', provider_message_id = p_provider_message_id,
    sent_at = clock_timestamp(), updated_at = clock_timestamp(), last_error = null
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing'
    and nullif(btrim(p_provider_message_id), '') is not null;
  return found;
end;
$$;

create or replace function public.fail_service_email_delivery(
  p_delivery_id uuid, p_claim_token uuid, p_error text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.service_email_deliveries set
    status = 'failed', last_error = left(coalesce(p_error, 'Unknown provider failure'), 1000),
    claim_token = null, claimed_at = null, updated_at = clock_timestamp()
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing';
  return found;
end;
$$;

create or replace function public.release_service_email_delivery(
  p_delivery_id uuid, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.service_email_deliveries
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing';
  return found;
end;
$$;

revoke all on function public.claim_service_email_delivery(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_service_email_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_service_email_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_service_email_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_service_email_delivery(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.complete_service_email_delivery(uuid, uuid, text) to service_role;
grant execute on function public.fail_service_email_delivery(uuid, uuid, text) to service_role;
grant execute on function public.release_service_email_delivery(uuid, uuid) to service_role;

comment on table public.service_email_deliveries is
  'Operational FCC lifecycle-email delivery ledger; independent of marketing consent.';
commit;
