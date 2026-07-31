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

export type LeaguePlayerOutcome =
  | {
      type: "winner";
      leagueId: string;
      leagueName: string;
      roundNumber: number;
      roundId: string;
    }
  | {
      type: "eliminated" | "no-pick";
      leagueId: string;
      leagueName: string;
      roundNumber: number;
      roundId: string;
      teamName: string | null;
    };

export function getLeagueOutcomeForPlayer(
  playerId: string,
  leagueId: string,
  source: LeagueOutcomeSource
): LeaguePlayerOutcome | null {
  const league = source.league;
  if (!playerId || !leagueId || !league) return null;

  const memberships = source.memberships ?? [];
  const rounds = source.rounds ?? [];
  const teams = source.teams ?? [];
  const allLeaguePicks = source.allLeaguePicks ?? [];
  const viewerMembership =
    memberships.find((member: any) => String(member.player_id) === String(playerId)) ?? null;
  if (!viewerMembership) return null;

  const completedRound =
    [...rounds]
      .filter((entry: any) => entry?.status === "completed")
      .sort((a: any, b: any) => (b.round_number ?? 0) - (a.round_number ?? 0))[0] ?? null;

  if (
    league.status === "completed" &&
    completedRound &&
    source.winnerPlayerId &&
    String(source.winnerPlayerId) === String(playerId)
  ) {
    return {
      type: "winner",
      leagueId,
      leagueName: league.name,
      roundNumber: completedRound.round_number,
      roundId: String(completedRound.id),
    };
  }

  const elimination = getMemberElimination(viewerMembership, rounds, allLeaguePicks, leagueId);
  if (!elimination?.round || !elimination?.pick) return null;

  if (elimination.pick.status === "eliminated" || elimination.pick.status === "no-pick") {
    const teamName =
      elimination.pick.status === "no-pick"
        ? null
        : teams.find((team: any) => String(team.id) === String(elimination.pick.team_id))?.name ?? null;
    return {
      type: elimination.pick.status,
      leagueId,
      leagueName: league.name,
      roundNumber: elimination.round.round_number,
      roundId: String(elimination.round.id),
      teamName,
    };
  }

  return null;
}

export function buildOutcomePayloadFromLeagueOutcome(
  playerId: string,
  outcome: LeaguePlayerOutcome | null
): OutcomePayload | null {
  if (!playerId || !outcome) return null;

  if (outcome.type === "winner") {
    return {
      type: "winner",
      title: "You won!",
      body: `${outcome.leagueName}. You were the last player standing.`,
      emoji: "\uD83C\uDFC6",
      key: `league_outcome:${playerId}:${outcome.leagueId}:winner:${outcome.roundNumber}`,
      stats: [
        { label: "League", value: outcome.leagueName },
        { label: "Round", value: String(outcome.roundNumber) },
      ],
      ctas: [
        { label: "View final standings", to: "/leaderboard" },
        { label: "Dismiss", action: "close" },
      ],
    };
  }

  const body =
    outcome.type === "no-pick"
      ? `You were eliminated in Round ${outcome.roundNumber}. Your run in ${outcome.leagueName} is over.`
      : outcome.teamName
      ? `Your ${outcome.teamName} pick did not win in Round ${outcome.roundNumber}. Your run in ${outcome.leagueName} is over.`
      : `You were eliminated in Round ${outcome.roundNumber}. Your run in ${outcome.leagueName} is over.`;

  return {
    type: "eliminated",
    title: "You've been eliminated",
    body,
    emoji: "\u274C",
    key: `league_outcome:${playerId}:${outcome.leagueId}:eliminated:${outcome.roundNumber}`,
    stats: [
      { label: "League", value: outcome.leagueName },
      { label: "Eliminated in", value: `Round ${outcome.roundNumber}` },
    ],
    ctas: [
      { label: "View standings", to: "/leaderboard" },
      { label: "Dismiss", action: "close" },
    ],
  };
}
