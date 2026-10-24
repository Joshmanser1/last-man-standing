-- READ ONLY: no tick, delivery claims, writes or email sends.
-- Run in the production SQL Editor. Keep this timestamp identical to the
-- proposed SERVICE_EMAIL_RESULTS_START_AT value; confirm it before activation.
-- Counts are before the pilot allowlist, matching a rollout to all players.
with config as (
  select timestamptz '2026-10-25T00:00:00Z' as results_start_at
), candidates as (
  select l.join_code, r.id as round_id, r.round_number, r.pick_deadline_utc,
    d.status as delivery_status, d.attempt_count, d.claimed_at,
    case when r.pick_deadline_utc >= c.results_start_at
      then 'POST_CUTOFF' else 'BLOCKED_HISTORICAL' end as rollout_scope
  from public.leagues l
  join public.rounds r on r.league_id = l.id
  join public.memberships m on m.league_id = l.id
  join public.picks p on p.round_id = r.id and p.player_id = m.player_id
  join auth.users u on u.id = m.player_id
  cross join config c
  left join public.service_email_deliveries d
    on d.league_id = l.id and d.round_id = r.id
    and d.player_id = m.player_id and d.event_type = 'round_result'
  where l.deleted_at is null and l.is_test is not true and r.status = 'completed'
    and r.finalized_at is not null
    and u.email_confirmed_at is not null
    and btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    and exists (select 1 from public.picks survivor
      where survivor.round_id = r.id and survivor.status = 'through')
    and (p.status in ('through', 'eliminated')
      or (p.status = 'no-pick' and p.reason = 'no-pick'))
    and (
      (p.status = 'no-pick' and p.reason = 'no-pick')
      or not exists (
        select 1 from public.rounds prior
        where prior.league_id = l.id and prior.round_number < r.round_number
          and prior.status in ('locked', 'completed')
          and (m.joined_at is null or m.joined_at <= prior.pick_deadline_utc)
          and not exists (select 1 from public.picks previous_pick
            where previous_pick.round_id = prior.id
              and previous_pick.player_id = m.player_id
              and previous_pick.status = 'through')
      )
    )
)
select join_code, round_id, round_number, pick_deadline_utc, rollout_scope,
  count(*) as eligible_result_recipients_before_deduplication,
  count(*) filter (where delivery_status = 'sent') as already_sent,
  count(*) filter (where delivery_status is null
    or (attempt_count < 5 and (delivery_status = 'failed'
      or (delivery_status = 'processing'
        and claimed_at < now() - interval '15 minutes')))) as claimable_without_cutoff
from candidates
group by join_code, round_id, round_number, pick_deadline_utc, rollout_scope
order by pick_deadline_utc desc, join_code;
