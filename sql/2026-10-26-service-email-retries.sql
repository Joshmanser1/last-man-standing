begin;

alter table public.service_email_deliveries
  add column next_attempt_at timestamptz,
  add column retryable boolean not null default true,
  add column last_provider_error jsonb,
  add column expired_at timestamptz,
  add column uncertain_since timestamptz;

create table public.service_email_provider_state (
  provider text primary key check (provider = 'resend'),
  blocked_until timestamptz not null,
  last_error jsonb not null
);
alter table public.service_email_provider_state enable row level security;
revoke all on public.service_email_provider_state from public, anon, authenticated, service_role;
grant select on public.service_email_provider_state to service_role;

create or replace function public.prepare_service_email_retries()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare expired_count integer;
begin
  update public.service_email_deliveries d set
    status = 'failed', retryable = false, expired_at = clock_timestamp(),
    next_attempt_at = null, claim_token = null, claimed_at = null,
    last_error = 'Pick reminder window expired', updated_at = clock_timestamp(),
    last_provider_error = jsonb_build_object('code', 'reminder_expired')
  from public.rounds r
  where d.round_id = r.id and d.event_type = 'pick_reminder' and d.expired_at is null and d.provider_message_id is null
    and (d.status = 'failed' or (d.status = 'processing' and d.claimed_at < clock_timestamp() - interval '15 minutes'))
    and (r.pick_deadline_utc < clock_timestamp() + interval '20 hours'
      or r.status <> 'upcoming' or r.finalized_at is not null);
  get diagnostics expired_count = row_count;

  update public.service_email_deliveries set
    retryable = false, updated_at = clock_timestamp(),
    last_error = 'Uncertain delivery outside safe idempotency retry window; reconcile with Resend before retrying'
  where retryable and status <> 'sent'
    and (uncertain_since < clock_timestamp() - interval '23 hours'
      or (status = 'processing' and claimed_at < clock_timestamp() - interval '23 hours'));

  return jsonb_build_object('expired', expired_count, 'blocked_until',
    (select blocked_until from public.service_email_provider_state
      where provider = 'resend' and blocked_until > clock_timestamp()));
end;
$$;

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

  if exists (select 1 from public.service_email_provider_state
    where provider = 'resend' and blocked_until > clock_timestamp()) then return null; end if;
  if p_event_type = 'pick_reminder' and not exists (
    select 1 from public.rounds where id = p_round_id and league_id = p_league_id
      and status = 'upcoming' and finalized_at is null
      and pick_deadline_utc between clock_timestamp() + interval '20 hours' and clock_timestamp() + interval '28 hours'
  ) then return null; end if;

  insert into public.service_email_deliveries
    (league_id, round_id, player_id, event_type, outcome, status, claim_token, claimed_at, attempt_count)
  values (p_league_id, p_round_id, p_player_id, p_event_type, p_outcome,
    'processing', gen_random_uuid(), clock_timestamp(), 1)
  on conflict (league_id, round_id, player_id, event_type) do update set
    outcome = excluded.outcome, status = 'processing', claim_token = gen_random_uuid(),
    uncertain_since = case when public.service_email_deliveries.status = 'processing'
      then coalesce(public.service_email_deliveries.uncertain_since, public.service_email_deliveries.claimed_at)
      else public.service_email_deliveries.uncertain_since end,
    claimed_at = clock_timestamp(), attempt_count = public.service_email_deliveries.attempt_count + 1,
    next_attempt_at = null, last_error = null, updated_at = clock_timestamp()
  where (public.service_email_deliveries.status = 'failed'
    or (public.service_email_deliveries.status = 'processing'
      and public.service_email_deliveries.claimed_at < clock_timestamp() - interval '15 minutes'
      and public.service_email_deliveries.claimed_at >= clock_timestamp() - interval '23 hours'))
    and public.service_email_deliveries.attempt_count < 5
    and public.service_email_deliveries.retryable and public.service_email_deliveries.expired_at is null
    and (public.service_email_deliveries.next_attempt_at is null or public.service_email_deliveries.next_attempt_at <= clock_timestamp())
    and (public.service_email_deliveries.uncertain_since is null or public.service_email_deliveries.uncertain_since >= clock_timestamp() - interval '23 hours')
  returning * into claimed;
  if not found then return null; end if;
  return jsonb_build_object('id', claimed.id, 'claim_token', claimed.claim_token, 'attempt_count', claimed.attempt_count);
end;
$$;

create function public.record_service_email_failure(
  p_delivery_id uuid, p_claim_token uuid, p_error text, p_failure jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare failed public.service_email_deliveries%rowtype;
  failure_kind text := p_failure->>'kind';
  retry_at timestamptz := (p_failure->>'nextAttemptAt')::timestamptz;
begin
  if failure_kind is null or failure_kind not in ('capacity', 'transient', 'permanent', 'accepted')
    or (failure_kind in ('capacity', 'transient') and retry_at is null) then
    raise exception 'Invalid service email retry policy';
  end if;
  update public.service_email_deliveries set
    status = 'failed', last_error = left(coalesce(p_error, 'Unknown provider failure'), 1000),
    last_provider_error = p_failure, next_attempt_at = retry_at,
    retryable = failure_kind in ('capacity', 'transient'),
    attempt_count = case when failure_kind = 'capacity' then greatest(0, attempt_count - 1) else attempt_count end,
    uncertain_since = case when failure_kind = 'transient' then coalesce(uncertain_since, claimed_at) else uncertain_since end,
    expired_at = case when p_failure->>'code' = 'reminder_expired' then clock_timestamp() else expired_at end,
    provider_message_id = coalesce(p_failure->>'providerMessageId', provider_message_id),
    claim_token = null, claimed_at = null, updated_at = clock_timestamp()
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing'
  returning * into failed;
  if not found then return false; end if;
  if failure_kind = 'capacity' then
    insert into public.service_email_provider_state (provider, blocked_until, last_error)
    values ('resend', retry_at, p_failure)
    on conflict (provider) do update set
      blocked_until = greatest(public.service_email_provider_state.blocked_until, excluded.blocked_until),
      last_error = excluded.last_error;
  end if;
  return true;
end;
$$;

create or replace function public.release_service_email_delivery(
  p_delivery_id uuid, p_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.service_email_deliveries set
    status = 'failed', retryable = false, next_attempt_at = null,
    last_error = 'Eligibility changed after uncertain delivery; reconcile with Resend before retrying',
    claim_token = null, claimed_at = null, updated_at = clock_timestamp()
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing'
    and uncertain_since is not null;
  if found then return true; end if;
  delete from public.service_email_deliveries
  where id = p_delivery_id and claim_token = p_claim_token and status = 'processing';
  return found;
end;
$$;

revoke all on function public.prepare_service_email_retries() from public, anon, authenticated;
revoke all on function public.record_service_email_failure(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.claim_service_email_delivery(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_service_email_delivery(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prepare_service_email_retries() to service_role;
grant execute on function public.record_service_email_failure(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.claim_service_email_delivery(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.release_service_email_delivery(uuid, uuid) to service_role;

commit;
