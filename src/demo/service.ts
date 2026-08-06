import type {
  Fixture,
  League,
  Membership,
  Pick,
  Player,
  Round,
  Team,
  ID,
} from "../data/types";
import type { IDataService } from "../data/service";
import {
  createMarketingDemoLeague,
  findMembership,
  getMarketingDemoLeague,
  getMarketingDemoRound,
  getMarketingDemoSnapshot,
  getMarketingDemoUsedTeamIds,
  getMarketingDemoUser,
  joinMarketingDemoLeague,
  submitMarketingDemoPick,
} from "./runtime";

function requireLeague(leagueId: string) {
  const league = getMarketingDemoLeague(leagueId);
  if (!league) throw new Error("League not found");
  return league;
}

const marketingDemoService: IDataService = {
  async seed() {},

  async listLeagues(): Promise<League[]> {
    return getMarketingDemoSnapshot().leagues;
  },

  async getLeagueByName(name: string): Promise<League> {
    const league = getMarketingDemoSnapshot().leagues.find((entry) => entry.name === name);
    if (!league) throw new Error(`League '${name}' not found`);
    return league;
  },

  async getCurrentRound(leagueId: ID): Promise<Round> {
    const round = getMarketingDemoRound(String(leagueId));
    if (!round) throw new Error("Current round not found");
    return round;
  },

  async listTeams(leagueId: ID): Promise<Team[]> {
    return getMarketingDemoSnapshot().teams.filter((entry) => entry.league_id === leagueId);
  },

  async listPicks(roundId: ID): Promise<Pick[]> {
    return getMarketingDemoSnapshot().picks.filter((entry) => entry.round_id === roundId);
  },

  async listUsedTeamIds(leagueId: ID, playerId: ID): Promise<Set<ID>> {
    return getMarketingDemoUsedTeamIds(String(leagueId), String(playerId));
  },

  async upsertPlayer(display_name: string): Promise<Player> {
    const user = getMarketingDemoUser();
    return { id: user.id, display_name: display_name || user.display_name };
  },

  async ensureMembership(leagueId: ID, playerId: ID): Promise<Membership> {
    return (
      findMembership(String(leagueId), String(playerId)) ??
      joinMarketingDemoLeague() ??
      ({
        id: `${leagueId}:${playerId}`,
        league_id: leagueId,
        player_id: playerId,
        is_active: true,
        joined_at: new Date().toISOString(),
      } as Membership)
    );
  },

  async upsertPick(_round: Round, _leagueId: ID, _playerId: ID, teamId: ID): Promise<Pick> {
    const pick = submitMarketingDemoPick(String(teamId));
    if (!pick) throw new Error("Could not save pick");
    return pick;
  },

  async createNextRound(): Promise<Round> {
    throw new Error("Round creation is not available in Marketing Demo mode");
  },

  async lockRound(): Promise<void> {},
  async evaluateRound(): Promise<void> {},
  async advanceRound(): Promise<void> {},

  async createGame(name: string): Promise<League> {
    return createMarketingDemoLeague(name);
  },

  async importFixturesForCurrentRound(_leagueId: ID): Promise<{ event: number }> {
    return { event: 3 };
  },

  async evaluateFromFixtures(): Promise<void> {},

  async setLeagueVisibility(): Promise<void> {},
  async updateLeague(): Promise<void> {},
  async deleteLeague(): Promise<void> {},
};

export function getMarketingDemoMembers(leagueId: string) {
  return getMarketingDemoSnapshot().memberships.filter((entry) => entry.league_id === leagueId);
}

export function getMarketingDemoPicks(leagueId: string) {
  return getMarketingDemoSnapshot().picks.filter((entry) => entry.league_id === leagueId);
}

export function getMarketingDemoState(leagueId: string) {
  const league = requireLeague(leagueId);
  const snapshot = getMarketingDemoSnapshot();
  return {
    league,
    rounds: snapshot.rounds.filter((entry) => entry.league_id === leagueId),
    teams: snapshot.teams.filter((entry) => entry.league_id === leagueId),
  };
}

export function getMarketingDemoLeaguePreview(joinCode: string) {
  const snapshot = getMarketingDemoSnapshot();
  return (
    snapshot.leagues.find((entry) => String(entry.join_code).toUpperCase() === joinCode.toUpperCase()) ??
    null
  );
}

export { getMarketingDemoSnapshot };

export function getMarketingDemoFixturesForRound(roundId: string): Array<Fixture & { league_id: string }> {
  return getMarketingDemoSnapshot().fixtures.filter((entry) => entry.round_id === roundId);
}

export default marketingDemoService;
