-- Apply before deploying the finalisation API. No historical backfill.
begin;
alter table public.rounds add column if not exists finalized_at timestamptz;

-- Only the server (cron or authenticated site-admin API) can call this function.
-- A failure anywhere rolls back picks, memberships, round and winner state together.
create function public.finalize_fcc_round(
  p_league_id uuid, p_round_id uuid, p_finalize boolean default true,
  p_winners uuid[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.leagues%rowtype;
  r public.rounds%rowtype;
  f public.fixtures%rowtype;
  picked public.picks%rowtype;
  survivors integer;
  winner uuid;
begin
  select * into l from public.leagues where id = p_league_id and deleted_at is null for update;
  if not found then raise exception 'League not found'; end if;
  select * into r from public.rounds where id = p_round_id and league_id = p_league_id for update;
  if not found then raise exception 'Round not found in league'; end if;
  if r.finalized_at is not null then
    select count(*), min(player_id::text)::uuid into survivors, winner
      from public.picks where round_id = r.id and status = 'through';
    return jsonb_build_object('survivors', survivors, 'winner_player_id', case when survivors = 1 then winner end,
      'already_finalized', true);
  end if;
  if r.round_number is distinct from l.current_round then raise exception 'Not the current round'; end if;
  if p_finalize is null then raise exception 'Missing finalisation mode'; end if;
  if not p_finalize and r.status not in ('upcoming', 'locked') then raise exception 'Round cannot be locked'; end if;
  if p_finalize and r.status not in ('locked', 'completed') then raise exception 'Lock the round before evaluation'; end if;

  -- Locking also persists missed-pick elimination; safe to retry after an old partial lock.
  perform 1 from public.memberships where league_id = l.id for update;
  perform 1 from public.picks where round_id = r.id for update;
  if exists (select 1 from public.picks where round_id = r.id group by player_id having count(*) > 1) then
    raise exception 'Duplicate player picks require review';
  end if;
  if exists (select 1 from public.picks p where p.round_id = r.id and
    (p.league_id <> l.id or not exists (select 1 from public.memberships m where m.league_id = l.id and m.player_id = p.player_id))) then
    raise exception 'Pick does not belong to a league member';
  end if;
  update public.memberships m set is_active = false where m.league_id = l.id and m.is_active
    and not exists (select 1 from public.picks p where p.round_id = r.id and p.player_id = m.player_id
      and p.status <> 'no-pick' and p.team_id is not null);
  if not p_finalize then
    update public.rounds set status = 'locked' where id = r.id and status = 'upcoming';
    update public.leagues set status = 'active' where id = l.id and status = 'upcoming';
    return jsonb_build_object('locked', true);
  end if;

  perform 1 from public.fixtures where round_id = r.id for update;
  if not exists (select 1 from public.fixtures where round_id = r.id) then raise exception 'Round has no fixtures'; end if;
  -- Legacy manual winner selection is translated into fixture results in this same transaction.
  -- A team appearing twice is ambiguous in that UI: use fixture results for such rounds.
  if p_winners is not null then
    if exists (select team_id from (
      select home_team_id team_id from public.fixtures where round_id = r.id union all
      select away_team_id from public.fixtures where round_id = r.id
    ) t group by team_id having count(*) > 1) then raise exception 'Use fixture evaluation for multi-fixture teams'; end if;
    if exists (select 1 from unnest(p_winners) w where w is null or not exists (
      select 1 from public.fixtures where round_id = r.id and w in (home_team_id, away_team_id))) then
      raise exception 'Selected winner is not in this round';
    end if;
    for f in select * from public.fixtures where round_id = r.id loop
      if f.home_team_id = any(p_winners) and f.away_team_id = any(p_winners) then raise exception 'Both opponents cannot win'; end if;
      if f.home_team_id = any(p_winners) then f.result := 'home_win'; f.winning_team_id := f.home_team_id;
      elsif f.away_team_id = any(p_winners) then f.result := 'away_win'; f.winning_team_id := f.away_team_id;
      else f.result := 'draw'; f.winning_team_id := null; end if;
      update public.fixtures set result = f.result, winning_team_id = f.winning_team_id where id = f.id;
    end loop;
  end if;
  if exists (select 1 from public.fixtures where round_id = r.id and (
    result is null or result not in ('home_win', 'away_win', 'draw') or
    (result = 'home_win' and winning_team_id is distinct from home_team_id) or
    (result = 'away_win' and winning_team_id is distinct from away_team_id) or
    (result = 'draw' and winning_team_id is not null))) then raise exception 'Fixture results are incomplete or inconsistent'; end if;

  for picked in select * from public.picks where round_id = r.id loop
    if picked.status = 'no-pick' or picked.team_id is null then picked.status := 'no-pick'; picked.reason := 'no-pick';
    else
      if not exists (select 1 from public.fixtures where round_id = r.id and picked.team_id in (home_team_id, away_team_id)) then
        raise exception 'Picked team has no fixture';
      end if;
      -- Retain automatic evaluation's any-win rule for teams with multiple fixtures.
      if exists (select 1 from public.fixtures where round_id = r.id and winning_team_id = picked.team_id) then
        picked.status := 'through'; picked.reason := null;
      else
        picked.status := 'eliminated'; picked.reason := 'loss';
        if exists (select 1 from public.fixtures where round_id = r.id and result = 'draw'
          and picked.team_id in (home_team_id, away_team_id)) then picked.reason := 'draw'; end if;
      end if;
    end if;
    -- Do not silently resurrect an already-eliminated player with a stray winning pick.
    if picked.status = 'through' and not exists (select 1 from public.memberships
      where league_id = l.id and player_id = picked.player_id and is_active) then
      raise exception 'Winning pick belongs to an inactive member; review required';
    end if;
    update public.picks set status = picked.status, reason = picked.reason where id = picked.id;
  end loop;
  update public.memberships m set is_active = false where m.league_id = l.id and m.is_active
    and not exists (select 1 from public.picks p where p.round_id = r.id and p.player_id = m.player_id and p.status = 'through');
  select count(*), min(player_id::text)::uuid into survivors, winner from public.picks where round_id = r.id and status = 'through';
  update public.rounds set status = 'completed', finalized_at = clock_timestamp() where id = r.id;
  if survivors = 1 then update public.leagues set status = 'completed' where id = l.id;
  else update public.leagues set status = 'active' where id = l.id; end if;
  return jsonb_build_object('survivors', survivors, 'winner_player_id', case when survivors = 1 then winner end,
    'already_finalized', false);
end;
$$;
revoke all on function public.finalize_fcc_round(uuid, uuid, boolean, uuid[]) from public, anon, authenticated;
grant execute on function public.finalize_fcc_round(uuid, uuid, boolean, uuid[]) to service_role;

-- Close the check-then-submit race: a request that checked an open round before
-- the lock must not insert/change a selection after locking/finalisation.
create function public.guard_round_pick() returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.rounds%rowtype;
begin
  if tg_op = 'DELETE' then
    select * into r from public.rounds where id = old.round_id for update;
    if not found then raise exception 'Round not found'; end if;
    if r.status <> 'upcoming' then raise exception 'Round is locked'; end if;
    return old;
  end if;
  select * into r from public.rounds where id = new.round_id for update;
  if not found then raise exception 'Round not found'; end if;
  if r.finalized_at is not null then raise exception 'Round already finalised'; end if;
  if tg_op = 'INSERT' then
    if r.status <> 'upcoming' then raise exception 'Round is locked'; end if;
  elsif (new.round_id, new.league_id, new.player_id, new.team_id) is distinct from
        (old.round_id, old.league_id, old.player_id, old.team_id) then
    if r.status <> 'upcoming' or new.round_id <> old.round_id then raise exception 'Round is locked'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_round_pick on public.picks;
create trigger guard_round_pick before insert or update or delete on public.picks for each row execute function public.guard_round_pick();

-- A fixture correction after finalisation needs an explicit reconciliation policy;
-- it must not silently disagree with the already-persisted player outcomes.
create function public.guard_finalized_fixture() returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.rounds%rowtype;
begin
  select * into r from public.rounds where id = case when tg_op = 'DELETE' then old.round_id else new.round_id end for update;
  if not found then raise exception 'Round not found'; end if;
  if r.finalized_at is not null then raise exception 'Round already finalised'; end if;
  if tg_op = 'UPDATE' and new.round_id <> old.round_id then raise exception 'Cannot move a fixture between rounds'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists guard_finalized_fixture on public.fixtures;
create trigger guard_finalized_fixture before insert or update or delete on public.fixtures
  for each row execute function public.guard_finalized_fixture();
commit;
