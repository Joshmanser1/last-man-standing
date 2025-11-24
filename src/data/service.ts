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

/* -----------------------------------------------------------------------------
   Public service interface
----------------------------------------------------------------------------- */
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

/* -----------------------------------------------------------------------------
   Local store + change notifications
----------------------------------------------------------------------------- */
export const STORE_KEY = "lms_store_v1";
export const STORE_EVENT = "lms:store-updated";

function safeParse<T = any>(raw: string | null, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readStore<T = any>(): T {
  return safeParse<T>(localStorage.getItem(STORE_KEY), {} as T);
}

export function writeStore(next: any) {
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
  // Notify the app that local data changed (components re-query on this)
  window.dispatchEvent(new Event(STORE_EVENT));
}

/** Subscribe to store change events. Returns an unsubscribe function. */
export function subscribeStore(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(STORE_EVENT, handler);
  return () => window.removeEventListener(STORE_EVENT, handler);
}

/* -----------------------------------------------------------------------------
   Choose backend (mock for now) and wrap mutating calls to emit change events
----------------------------------------------------------------------------- */
const USE_SUPABASE_BACKEND = false;
const base = (USE_SUPABASE_BACKEND
  ? supabaseService
  : (mockService as unknown)) as IDataService;

// Helper to call a base fn and then emit STORE_EVENT
function withNotify<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>
) {
  return async (...args: TArgs) => {
    const result = await fn(...args);
    // The mock service writes to localStorage internally; we just broadcast.
    window.dispatchEvent(new Event(STORE_EVENT));
    return result;
  };
}

/** Export a proxy that forwards to the base service but fires change events
    after any mutating operation. */
export const dataService: IDataService = {
  // Reads (no notification needed)
  listLeagues: (...a) => base.listLeagues(...a),
  getLeagueByName: (...a) => base.getLeagueByName(...a),
  getCurrentRound: (...a) => base.getCurrentRound(...a),
  listTeams: (...a) => base.listTeams(...a),
  listPicks: (...a) => base.listPicks(...a),
  listUsedTeamIds: (...a) => base.listUsedTeamIds(...a),

  // Mutations wrapped with notify
  seed: withNotify(base.seed.bind(base)),
  upsertPlayer: withNotify(base.upsertPlayer.bind(base)),
  ensureMembership: withNotify(base.ensureMembership.bind(base)),
  upsertPick: withNotify(base.upsertPick.bind(base)),
  createNextRound: withNotify(base.createNextRound.bind(base)),
  lockRound: withNotify(base.lockRound.bind(base)),
  evaluateRound: withNotify(base.evaluateRound.bind(base)),
  advanceRound: withNotify(base.advanceRound.bind(base)),
  createGame: withNotify(base.createGame.bind(base)),
  importFixturesForCurrentRound: withNotify(
    base.importFixturesForCurrentRound.bind(base)
  ),
  evaluateFromFixtures: withNotify(base.evaluateFromFixtures.bind(base)),
};
