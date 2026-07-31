import type { OutcomePayload } from "../components/Notifications";
import { getMemberElimination } from "./leagueRoundState";

export type LeagueOutcomeSource = {
  league: any | null;
  rounds: any[];
  teams: any[];
  memberships: any[];
  allLeaguePicks: any[];
  winnerPlayerId?: string | null;
};

export type CanonicalLeagueOutcome = {
  leagueId: string;
  leagueName: string;
  status: "alive" | "eliminated" | "winner";
  eliminationRound: number | null;
  eliminatedByTeam: { id: string; name: string } | null;
  winningPlayerId: string | null;
};

export function getLeagueOutcomeForPlayer(
  playerId: string,
  leagueId: string,
  source: LeagueOutcomeSource
): CanonicalLeagueOutcome | null {
  const league = source.league;
  if (!playerId || !leagueId || !league) return null;

  const memberships = source.memberships ?? [];
  const rounds = source.rounds ?? [];
  const teams = source.teams ?? [];
  const allLeaguePicks = source.allLeaguePicks ?? [];
  const viewerMembership =
    memberships.find((member: any) => String(member.player_id) === String(playerId)) ?? null;
  if (!viewerMembership) return null;

  if (
    source.winnerPlayerId &&
    String(source.winnerPlayerId) === String(playerId)
  ) {
    return {
      leagueId,
      leagueName: league.name,
      status: "winner",
      eliminationRound: null,
      eliminatedByTeam: null,
      winningPlayerId: String(source.winnerPlayerId),
    };
  }

  const elimination = getMemberElimination(viewerMembership, rounds, allLeaguePicks, leagueId);
  if (elimination?.round && elimination?.pick) {
    const eliminatedByTeam =
      elimination.pick.status === "no-pick"
        ? null
        : (() => {
            const team =
              teams.find((entry: any) => String(entry.id) === String(elimination.pick.team_id)) ?? null;
            return team ? { id: String(team.id), name: String(team.name ?? "") } : null;
          })();
    return {
      leagueId,
      leagueName: league.name,
      status: "eliminated",
      eliminationRound: elimination.round.round_number ?? null,
      eliminatedByTeam,
      winningPlayerId: source.winnerPlayerId ? String(source.winnerPlayerId) : null,
    };
  }

  return {
    leagueId,
    leagueName: league.name,
    status: "alive",
    eliminationRound: null,
    eliminatedByTeam: null,
    winningPlayerId: source.winnerPlayerId ? String(source.winnerPlayerId) : null,
  };
}

export function buildOutcomePayloadFromLeagueOutcome(
  playerId: string,
  outcome: CanonicalLeagueOutcome | null
): OutcomePayload | null {
  if (!playerId || !outcome) return null;

  if (outcome.status === "winner") {
    return {
      type: "winner",
      title: "You won!",
      body: `${outcome.leagueName}. You were the last player standing.`,
      emoji: "\uD83C\uDFC6",
      key: `league_outcome:${playerId}:${outcome.leagueId}:winner`,
      stats: [
        { label: "League", value: outcome.leagueName },
        { label: "Winner", value: "Final standings" },
      ],
      ctas: [
        { label: "View final standings", to: "/leaderboard" },
        { label: "Dismiss", action: "close" },
      ],
    };
  }

  if (outcome.status !== "eliminated" || !outcome.eliminationRound) return null;

  const body =
    outcome.eliminatedByTeam?.name
      ? `Your ${outcome.eliminatedByTeam.name} pick did not win in Round ${outcome.eliminationRound}. Your run in ${outcome.leagueName} is over.`
      : `You were eliminated in Round ${outcome.eliminationRound}. Your run in ${outcome.leagueName} is over.`;

  return {
    type: "eliminated",
    title: "You've been eliminated",
    body,
    emoji: "\u274C",
    key: `league_outcome:${playerId}:${outcome.leagueId}:eliminated:${outcome.eliminationRound}`,
    stats: [
      { label: "League", value: outcome.leagueName },
      { label: "Eliminated in", value: `Round ${outcome.eliminationRound}` },
    ],
    ctas: [
      { label: "View standings", to: "/leaderboard" },
      { label: "Dismiss", action: "close" },
    ],
  };
}
