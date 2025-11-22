// src/data/service.ts
import type {
  League,
  Round,
  Team,
  Player,
  Membership,
  Pick,
  ID,
} from "./types";
import mockService from "./mock";
import { supabaseService } from "./supabaseService";

export interface IDataService {
  // seed + lookups
  seed(): Promise<void>;
  listLeagues(): Promise<League[]>;
  getLeagueByName(name: string): Promise<League>;
  getCurrentRound(leagueId: ID): Promise<Round>;
  listTeams(leagueId: ID): Promise<Team[]>;
  listPicks(roundId: ID): Promise<Pick[]>;
  listUsedTeamIds(leagueId: ID, playerId: ID): Promise<Set<ID>>;

  // players & membership
  upsertPlayer(display_name: string): Promise<Player>;
  ensureMembership(leagueId: ID, playerId: ID): Promise<Membership>;

  // picks
  upsertPick(
    round: Round,
    leagueId: ID,
    playerId: ID,
    teamId: ID
  ): Promise<Pick>;

  // rounds (admin)
  createNextRound(leagueId: ID, nextDeadlineISO?: string): Promise<Round>;
  lockRound(roundId: ID): Promise<void>;
  evaluateRound(roundId: ID): Promise<void>;
  advanceRound(leagueId: ID): Promise<void>;

  // admin convenience
  createGame(name: string, startISO: string): Promise<League>;
  importFixturesForCurrentRound(leagueId: ID): Promise<{ event: number }>;
  evaluateFromFixtures(roundId: ID): Promise<void>;
}

// TEMP: while Supabase backend isn't wired up for LMS,
// always use the local mock service for league/picks/fixtures.
const USE_SUPABASE_BACKEND = false;

export const dataService: IDataService = USE_SUPABASE_BACKEND
  ? supabaseService
  : (mockService as unknown as IDataService);
