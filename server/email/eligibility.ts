import type { ServiceEmailCandidate, ServiceEmailOutcome } from "./types.js";
import { markRolloverLeagueId, markRolloverRoundId } from "./types.js";

export type LeagueEmailSnapshot = {
  league: { id: string; name: string; current_round: number; status?: string | null; is_test?: boolean | null };
  rounds: Array<{ id: string; league_id: string; round_number: number; status: string; pick_deadline_utc: string; finalized_at?: string | null }>;
  memberships: Array<{ player_id: string; is_active: boolean; joined_at?: string | null }>;
  picks: Array<{ round_id: string; player_id: string; team_id?: string | null; status: string; reason?: string | null }>;
  teams: Array<{ id: string; name: string }>;
};

const joinedByDeadline = (member: LeagueEmailSnapshot["memberships"][number], deadline: string) =>
  !member.joined_at || Date.parse(member.joined_at) <= Date.parse(deadline);

function enteredRound(snapshot: LeagueEmailSnapshot, playerId: string, round: LeagueEmailSnapshot["rounds"][number]) {
  const member = snapshot.memberships.find(entry => entry.player_id === playerId);
  if (!member) return false;
  const currentPick = snapshot.picks.find(pick => pick.round_id === round.id && pick.player_id === playerId);
  if (!currentPick && !joinedByDeadline(member, round.pick_deadline_utc)) return false;
  return snapshot.rounds
    .filter(prior => prior.round_number < round.round_number && ["locked", "completed"].includes(prior.status))
    .filter(prior => joinedByDeadline(member, prior.pick_deadline_utc))
    .every(prior => snapshot.picks.some(pick => pick.round_id === prior.id && pick.player_id === playerId && pick.status === "through"));
}

export function reminderCandidates(snapshot: LeagueEmailSnapshot, roundId: string): ServiceEmailCandidate[] {
  if (snapshot.league.is_test === true) return [];
  const round = snapshot.rounds.find(entry => entry.id === roundId);
  if (!round || round.round_number !== snapshot.league.current_round || round.status !== "upcoming" || round.finalized_at) return [];
  return snapshot.memberships
    .filter(member => member.is_active && joinedByDeadline(member, round.pick_deadline_utc))
    .filter(member => !snapshot.picks.some(pick => pick.round_id === round.id && pick.player_id === member.player_id))
    .map(member => ({
      leagueId: snapshot.league.id, leagueName: snapshot.league.name,
      roundId: round.id, roundNumber: round.round_number, playerId: member.player_id,
      eventType: "pick_reminder", outcome: null, deadlineUtc: round.pick_deadline_utc,
      teamName: null, survivorsRemaining: null,
    }));
}

// Require an explicit UTC instant, never a deployment-time default or a local date.
export function parseResultEmailStartAt(value?: string): string | null {
  const input = value?.trim();
  if (!input || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input)) return null;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return null;
  const canonical = new Date(timestamp).toISOString();
  return canonical === (input.includes(".") ? input : input.replace("Z", ".000Z")) ? canonical : null;
}

export const approvedResultEmailExceptionRoundIds = [
  "12bcb92e-4649-4006-9d14-489a8bf4eb10",
  "a21ee081-fe55-410a-b6f3-60b3fb234eef",
  "e9ee31fd-0135-454f-b86d-d12e59fd145f",
  "64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb",
] as const;

export function parseResultEmailExceptionRoundIds(value?: string): Set<string> {
  const approved = new Set<string>(approvedResultEmailExceptionRoundIds);
  return new Set((value ?? "").split(",").map(entry => entry.trim().toLowerCase())
    .filter(entry => approved.has(entry)));
}

export function isResultEmailRoundInScope(
  round: LeagueEmailSnapshot["rounds"][number], resultsStartAt?: string,
  exceptionRoundIds: ReadonlySet<string> = new Set()
): boolean {
  const cutoff = parseResultEmailStartAt(resultsStartAt);
  if (!cutoff) return false;
  return Date.parse(round.pick_deadline_utc) >= Date.parse(cutoff)
    || (exceptionRoundIds.has(round.id) && approvedResultEmailExceptionRoundIds.some(approved => approved === round.id));
}

export function resultCandidates(
  snapshot: LeagueEmailSnapshot, roundId: string, now: Date = new Date(), resultsStartAt?: string,
  exceptionRoundIds: ReadonlySet<string> = new Set()
) {
  if (snapshot.league.is_test === true) return { candidates: [], zeroSurvivors: false, ambiguousMissedPicks: 0 };
  const round = snapshot.rounds.find(entry => entry.id === roundId);
  if (!round?.finalized_at || round.status !== "completed") return { candidates: [], zeroSurvivors: false, ambiguousMissedPicks: 0 };
  if (!isResultEmailRoundInScope(round, resultsStartAt, exceptionRoundIds)) {
    return { candidates: [], zeroSurvivors: false, ambiguousMissedPicks: 0 };
  }
  const roundPicks = snapshot.picks.filter(pick => pick.round_id === round.id);
  const survivors = roundPicks.filter(pick => pick.status === "through").length;
  if (snapshot.league.id === markRolloverLeagueId && round.id === markRolloverRoundId
    && round.league_id === markRolloverLeagueId && round.round_number === 5 && survivors === 0) {
    return markRolloverCandidates(snapshot, round, roundPicks);
  }
  if (survivors === 0) return { candidates: [], zeroSurvivors: true, ambiguousMissedPicks: 0 };
  // Presentation data only: use the persisted next round after lifecycle advancement.
  const nextRound = survivors > 1 && snapshot.league.status !== "completed"
    ? snapshot.rounds.find(entry => entry.league_id === snapshot.league.id
      && entry.round_number === round.round_number + 1
      && entry.round_number === snapshot.league.current_round
      && entry.status === "upcoming" && !entry.finalized_at
      && Date.parse(entry.pick_deadline_utc) > now.getTime())
    : undefined;
  const teamNames = new Map(snapshot.teams.map(team => [team.id, team.name]));
  const candidates: ServiceEmailCandidate[] = [];
  let ambiguousMissedPicks = 0;
  for (const member of snapshot.memberships) {
    const pick = roundPicks.find(entry => entry.player_id === member.player_id);
    const persistedNoPick = pick?.status === "no-pick" && pick.reason === "no-pick";
    if (!persistedNoPick && !enteredRound(snapshot, member.player_id, round)) continue;
    let outcome: ServiceEmailOutcome;
    if (!pick) { ambiguousMissedPicks++; continue; }
    if (pick.status === "no-pick" && pick.reason === "no-pick") outcome = "eliminated_no_pick";
    else if (pick.status === "through") outcome = "through";
    else if (pick.status === "eliminated" && pick.reason === "draw") outcome = "eliminated_draw";
    else if (pick.status === "eliminated") outcome = "eliminated_loss";
    else continue;
    candidates.push({
      leagueId: snapshot.league.id, leagueName: snapshot.league.name,
      roundId: round.id, roundNumber: round.round_number, playerId: member.player_id,
      eventType: "round_result", outcome, deadlineUtc: round.pick_deadline_utc,
      teamName: pick?.team_id ? teamNames.get(pick.team_id) ?? "Your team" : null,
      survivorsRemaining: survivors,
      nextRound: outcome === "through" && nextRound
        ? { roundNumber: nextRound.round_number, deadlineUtc: nextRound.pick_deadline_utc,
          alreadyPicked: snapshot.picks.some(entry => entry.round_id === nextRound.id && entry.player_id === member.player_id) }
        : null,
    });
  }
  return { candidates, zeroSurvivors: false, ambiguousMissedPicks };
}

function markRolloverCandidates(
  snapshot: LeagueEmailSnapshot, round: LeagueEmailSnapshot["rounds"][number],
  roundPicks: LeagueEmailSnapshot["picks"]
) {
  const candidates: ServiceEmailCandidate[] = [];
  let ambiguousMissedPicks = 0;
  const resolvedElimination = (pick: LeagueEmailSnapshot["picks"][number]) =>
    (pick.status === "eliminated" && (pick.reason === "loss" || pick.reason === "draw"))
    || (pick.status === "no-pick" && pick.reason === "no-pick");
  if (roundPicks.length === 0 || !roundPicks.every(resolvedElimination)) {
    return { candidates, zeroSurvivors: true, ambiguousMissedPicks };
  }
  const completedRounds = snapshot.rounds.filter(entry => entry.league_id === snapshot.league.id
    && entry.status === "completed" && entry.round_number <= round.round_number)
    .sort((previous, next) => previous.round_number - next.round_number);
  const teamNames = new Map(snapshot.teams.map(team => [team.id, team.name]));
  for (const member of snapshot.memberships) {
    if (!joinedByDeadline(member, round.pick_deadline_utc)) continue;
    const elimination = completedRounds.map(entry => ({
      round: entry, picks: snapshot.picks.filter(pick => pick.round_id === entry.id && pick.player_id === member.player_id),
    })).find(entry => entry.picks.some(resolvedElimination));
    if (!elimination || elimination.picks.length !== 1) { ambiguousMissedPicks++; continue; }
    const pick = elimination.picks[0];
    const outcome = pick.status === "no-pick" ? "eliminated_no_pick"
      : pick.reason === "draw" ? "eliminated_draw" : "eliminated_loss";
    candidates.push({
      leagueId: snapshot.league.id, leagueName: snapshot.league.name,
      roundId: round.id, roundNumber: round.round_number, playerId: member.player_id,
      eventType: "round_result", outcome, deadlineUtc: round.pick_deadline_utc,
      teamName: pick.team_id ? teamNames.get(pick.team_id) ?? "Your team" : null,
      survivorsRemaining: 0, resultVariant: "mark_rollover", eliminationRoundNumber: elimination.round.round_number,
      nextRound: null,
    });
  }
  return { candidates, zeroSurvivors: false, ambiguousMissedPicks };
}
