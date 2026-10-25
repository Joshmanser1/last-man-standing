begin transaction read only;

with approved(competition, league_id, round_id, round_number) as (
  values
    ('MARKPL', 'b457c805-f460-497c-8ed5-a7864d61f822'::uuid, '12bcb92e-4649-4006-9d14-489a8bf4eb10'::uuid, 5),
    ('FORTY4', 'f6f3e1be-8c00-4174-8172-2d078fb09cb3'::uuid, 'a21ee081-fe55-410a-b6f3-60b3fb234eef'::uuid, 2),
    ('OOCFM1', '088ee7c0-660e-4b68-ab6f-a75032ff9cc2'::uuid, 'e9ee31fd-0135-454f-b86d-d12e59fd145f'::uuid, 3),
    ('FCCLMS', 'a0a73aa0-d9c6-43e9-bbe3-03ae90312ee2'::uuid, '64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb'::uuid, 1)
)
select a.competition, a.league_id, a.round_id, r.status, r.finalized_at,
  r.pick_deadline_utc, r.round_number = a.round_number as expected_round_number,
  l.is_test, l.deleted_at,
  (select count(*) from public.picks p where p.round_id = r.id) as persisted_picks,
  (select count(*) from public.picks p where p.round_id = r.id and p.status = 'through') as survivors,
  (select count(*) from public.picks p where p.round_id = r.id and not coalesce(
    p.status = 'through' or (p.status = 'eliminated' and p.reason in ('loss', 'draw'))
      or (p.status = 'no-pick' and p.reason = 'no-pick'), false)) as unresolved_picks,
  (select count(*) from public.memberships m where m.league_id = a.league_id) as league_memberships
from approved a
left join public.rounds r on r.id = a.round_id and r.league_id = a.league_id
left join public.leagues l on l.id = a.league_id
order by a.competition;

with approved(competition, league_id, round_id, round_number) as (
  values
    ('MARKPL', 'b457c805-f460-497c-8ed5-a7864d61f822'::uuid, '12bcb92e-4649-4006-9d14-489a8bf4eb10'::uuid, 5),
    ('FORTY4', 'f6f3e1be-8c00-4174-8172-2d078fb09cb3'::uuid, 'a21ee081-fe55-410a-b6f3-60b3fb234eef'::uuid, 2),
    ('OOCFM1', '088ee7c0-660e-4b68-ab6f-a75032ff9cc2'::uuid, 'e9ee31fd-0135-454f-b86d-d12e59fd145f'::uuid, 3),
    ('FCCLMS', 'a0a73aa0-d9c6-43e9-bbe3-03ae90312ee2'::uuid, '64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb'::uuid, 1)
), scoped as (
  select a.competition, r.*, l.status as league_status, l.current_round,
    (select count(*) from public.picks p where p.round_id = r.id and p.status = 'through') as survivors,
    (select count(*) from public.picks p where p.round_id = r.id) as pick_count,
    not exists (select 1 from public.picks p where p.round_id = r.id and not coalesce(
      (p.status = 'eliminated' and p.reason in ('loss', 'draw'))
        or (p.status = 'no-pick' and p.reason = 'no-pick'), false)) as all_picks_eliminated
  from approved a
  join public.rounds r on r.id = a.round_id and r.league_id = a.league_id and r.round_number = a.round_number
  join public.leagues l on l.id = a.league_id and l.deleted_at is null and l.is_test is not true
  where r.status = 'completed' and r.finalized_at is not null
), variants as (
  select s.*, (s.competition = 'MARKPL' and s.survivors = 0 and s.pick_count > 0
    and s.all_picks_eliminated) as mark_rollover
  from scoped s
), candidates as (
  select v.*, m.player_id, chosen.source_round_number, chosen.source_finalized_at,
    chosen.status as pick_status, chosen.reason,
    case when chosen.status = 'no-pick' and chosen.reason = 'no-pick' then 'eliminated_no_pick'
      when chosen.status = 'through' then 'through'
      when chosen.status = 'eliminated' and chosen.reason = 'draw' then 'eliminated_draw'
      when chosen.status = 'eliminated' then 'eliminated_loss' end as outcome
  from variants v
  join public.memberships m on m.league_id = v.league_id
  join lateral (
    select p.status, p.reason, source.round_number as source_round_number,
      source.finalized_at as source_finalized_at,
      count(*) over (partition by source.id) as picks_in_source_round
    from public.rounds source
    join public.picks p on p.round_id = source.id and p.player_id = m.player_id
    where source.league_id = v.league_id
      and ((not v.mark_rollover and source.id = v.id)
        or (v.mark_rollover and source.status = 'completed' and source.round_number <= v.round_number))
    order by source.round_number
  ) chosen on true
  where (v.mark_rollover and (m.joined_at is null or m.joined_at <= v.pick_deadline_utc)
      and chosen.picks_in_source_round = 1
      and ((chosen.status = 'eliminated' and chosen.reason in ('loss', 'draw'))
        or (chosen.status = 'no-pick' and chosen.reason = 'no-pick'))
      and not exists (
        select 1 from public.rounds earlier join public.picks ep on ep.round_id = earlier.id and ep.player_id = m.player_id
        where earlier.league_id = v.league_id and earlier.status = 'completed'
          and earlier.round_number < chosen.source_round_number
          and ((ep.status = 'eliminated' and ep.reason in ('loss', 'draw'))
            or (ep.status = 'no-pick' and ep.reason = 'no-pick'))))
    or (not v.mark_rollover and v.survivors > 0
      and (chosen.status in ('through', 'eliminated') or (chosen.status = 'no-pick' and chosen.reason = 'no-pick'))
      and ((chosen.status = 'no-pick' and chosen.reason = 'no-pick') or not exists (
        select 1 from public.rounds prior
        where prior.league_id = v.league_id and prior.round_number < v.round_number
          and prior.status in ('locked', 'completed')
          and (m.joined_at is null or m.joined_at <= prior.pick_deadline_utc)
          and not exists (select 1 from public.picks previous_pick where previous_pick.round_id = prior.id
            and previous_pick.player_id = m.player_id and previous_pick.status = 'through'))))
), verified as (
  select c.*, btrim(u.email) as verified_email,
    coalesce(mp.marketing_opt_in and mp.consented_email = btrim(u.email), false) as marketing_permitted,
    d.status as delivery_status, d.attempt_count,
    (d.id is null or (d.attempt_count < 5 and (d.status = 'failed'
      or (d.status = 'processing' and d.claimed_at < now() - interval '15 minutes')))) as claimable
  from candidates c
  join auth.users u on u.id = c.player_id and u.email_confirmed_at is not null
    and btrim(u.email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  left join public.marketing_preferences mp on mp.user_id = c.player_id
  left join public.service_email_deliveries d on d.league_id = c.league_id and d.round_id = c.id
    and d.player_id = c.player_id and d.event_type = 'round_result'
), presentation as (
  select v.*, next_round.id as next_round_id,
    next_round.id is not null and not exists (select 1 from public.picks np
      where np.round_id = next_round.id and np.player_id = v.player_id) as needs_next_pick
  from verified v
  left join public.rounds next_round on v.outcome = 'through' and v.survivors > 1
    and v.league_status is distinct from 'completed' and next_round.league_id = v.league_id
    and next_round.round_number = v.round_number + 1 and next_round.round_number = v.current_round
    and next_round.status = 'upcoming' and next_round.finalized_at is null and next_round.pick_deadline_utc > now()
)
select competition, id as delivery_round_id, player_id, verified_email,
  'round_result' as email_type, case when mark_rollover then 'mark_rollover' else 'standard_result' end as template,
  outcome, source_round_number as individual_outcome_round, source_finalized_at,
  marketing_permitted, delivery_status, attempt_count, claimable,
  mark_rollover and marketing_permitted as includes_mark_join_invitation,
  not mark_rollover and marketing_permitted and needs_next_pick as includes_telegram,
  case when mark_rollover and marketing_permitted then 'JOIN MARK FPL v2'
    when mark_rollover then 'VIEW ORIGINAL RESULTS'
    when outcome = 'through' and needs_next_pick then 'MAKE YOUR PICK'
    when outcome = 'through' then 'VIEW COMPETITION' else 'VIEW RESULTS' end as primary_cta,
  case when mark_rollover and marketing_permitted then 'https://lms.fantasycommandcentre.co.uk/j/mark-fpl-rollover'
    when mark_rollover or outcome <> 'through' then 'https://lms.fantasycommandcentre.co.uk/leaderboard?view=eliminations&league_id=' || league_id
    when needs_next_pick then 'https://lms.fantasycommandcentre.co.uk/make-pick?league_id=' || league_id
    else 'https://lms.fantasycommandcentre.co.uk/leaderboard?view=leaderboard&league_id=' || league_id end as primary_cta_destination,
  count(*) over (partition by competition) as eligible_verified_recipients,
  count(*) filter (where claimable) over (partition by competition) as claimable_recipients,
  count(*) filter (where claimable and marketing_permitted) over (partition by competition) as claimable_with_marketing_consent,
  count(*) over (partition by competition, outcome, source_round_number, marketing_permitted) as outcome_consent_group_count
from presentation
order by competition, source_round_number, outcome, marketing_permitted, player_id;

rollback;
