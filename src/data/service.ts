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

  // NEW (admin league management)
  setLeagueVisibility?(leagueId: ID, isPublic: boolean): Promise<void>;
  updateLeague?(leagueId: ID, patch: Partial<League>): Promise<void>;
  deleteLeague?(leagueId: ID): Promise<void>; // local impl is hard-delete
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
    window.dispatchEvent(new Event(STORE_EVENT));
    return result;
  };
}

/* -----------------------------------------------------------------------------
   Local fallbacks for new admin methods (safe if base doesn't have them)
----------------------------------------------------------------------------- */
type Store = {
  leagues?: any[];
  rounds?: any[];
  teams?: any[];
  players?: any[];
  memberships?: any[];
  picks?: any[];
  fixtures?: any[];
};

const notDeleted = (l: any) => !l?.deleted_at;

/**
 * HARD DELETE + FULL CASCADE (local storage)
 * - Remove league row
 * - Remove all related rows (rounds, teams, memberships, picks, fixtures)
 * - Clear active_league_id if it pointed at the deleted league
 */
async function localDeleteLeague(leagueId: ID) {
  const s = readStore<Store>();

  // Remove the league entirely (no soft delete here)
  s.leagues = (s.leagues || []).filter((l: any) => l.id !== leagueId);

  // Cascade removal of children
  s.rounds = (s.rounds || []).filter((r: any) => r.league_id !== leagueId);
  s.teams = (s.teams || []).filter((t: any) => t.league_id !== leagueId);
  s.memberships = (s.memberships || []).filter((m: any) => m.league_id !== leagueId);
  s.picks = (s.picks || []).filter((p: any) => p.league_id !== leagueId);
  s.fixtures = (s.fixtures || []).filter((f: any) => f.league_id !== leagueId);

  // If UI was pointing to this league, clear it
  if (localStorage.getItem("active_league_id") === leagueId) {
    localStorage.removeItem("active_league_id");
  }

  writeStore(s);
}

async function localUpdateLeague(leagueId: ID, patch: Partial<League>) {
  const s = readStore<Store>();
  s.leagues ||= [];
  const i = s.leagues.findIndex((l: any) => l.id === leagueId);
  if (i >= 0) {
    s.leagues[i] = { ...s.leagues[i], ...patch };
    writeStore(s);
  } else {
    throw new Error("League not found");
  }
}

/* -----------------------------------------------------------------------------
   Export proxy: forwards to base, filters, and notifies after mutations
----------------------------------------------------------------------------- */
export const dataService: IDataService = {
  // Reads (wrap listLeagues to hide soft-deleted rows regardless of backend)
  listLeagues: async (...a) => {
    const rows = await base.listLeagues(...a);
    return (rows || []).filter(notDeleted);
  },
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

  // New admin methods with graceful fallback to local store
  setLeagueVisibility: withNotify(async (leagueId: ID, isPublic: boolean) => {
    if (base.setLeagueVisibility) {
      return base.setLeagueVisibility(leagueId, isPublic);
    }
    return localUpdateLeague(leagueId, { is_public: isPublic } as Partial<League>);
  }),

  updateLeague: withNotify(async (leagueId: ID, patch: Partial<League>) => {
    if (base.updateLeague) {
      return base.updateLeague(leagueId, patch);
    }
    return localUpdateLeague(leagueId, patch);
  }),

  deleteLeague: withNotify(async (leagueId: ID) => {
    if (base.deleteLeague) {
      return base.deleteLeague(leagueId);
    }
    return localDeleteLeague(leagueId);
  }),
};
