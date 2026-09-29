import type { ServiceEmailCandidate, ServiceEmailOutcome } from "./types.js";

export type LeagueEmailSnapshot = {
  league: { id: string; name: string; current_round: number };
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

export function resultCandidates(snapshot: LeagueEmailSnapshot, roundId: string) {
  const round = snapshot.rounds.find(entry => entry.id === roundId);
  if (!round?.finalized_at || round.status !== "completed") return { candidates: [], zeroSurvivors: false, ambiguousMissedPicks: 0 };
  const roundPicks = snapshot.picks.filter(pick => pick.round_id === round.id);
  const survivors = roundPicks.filter(pick => pick.status === "through").length;
  if (survivors === 0) return { candidates: [], zeroSurvivors: true, ambiguousMissedPicks: 0 };
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
    });
  }
  return { candidates, zeroSurvivors: false, ambiguousMissedPicks };
}
