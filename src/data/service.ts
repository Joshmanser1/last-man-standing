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
  deleteLeague?(leagueId: ID): Promise<void>; // soft delete
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
  window.dispatchEvent(new Event(STORE_EVENT));
}

/** Subscribe to store change events. Returns an unsubscribe function. */
export function subscribeStore(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(STORE_EVENT, handler);
  return () => window.removeEventListener(STORE_EVENT, handler);
}

/* -----------------------------------------------------------------------------
   Backend selection
----------------------------------------------------------------------------- */
const USE_SUPABASE_BACKEND = false;
const base = (USE_SUPABASE_BACKEND
  ? supabaseService
  : (mockService as unknown)) as IDataService;

/* -----------------------------------------------------------------------------
   Helpers
----------------------------------------------------------------------------- */
function withNotify<TArgs extends any[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>
) {
  return async (...args: TArgs) => {
    const result = await fn(...args);
    window.dispatchEvent(new Event(STORE_EVENT));
    return result;
  };
}

// Short code like “K7H9QX” (unambiguous chars)
function genJoinCode(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Ensure a private league has a join_code in local store (no-op if already set). */
function ensurePrivateCodeLocal(leagueId: ID): string | undefined {
  const s = readStore<any>();
  s.leagues ||= [];
  const idx = s.leagues.findIndex((l: any) => l.id === leagueId);
  if (idx === -1) return;

  const lg = s.leagues[idx];
  if (!lg.is_public && !lg.join_code) {
    lg.join_code = genJoinCode();
    writeStore(s);
    return lg.join_code as string;
  }
  return lg.join_code;
}

async function localDeleteLeague(leagueId: ID) {
  const s = readStore<any>();
  s.leagues ||= [];
  const i = s.leagues.findIndex((l: any) => l.id === leagueId);
  if (i >= 0) {
    s.leagues[i] = { ...s.leagues[i], deleted_at: new Date().toISOString() };
  }
  s.rounds = (s.rounds || []).filter((r: any) => r.league_id !== leagueId);
  s.teams = (s.teams || []).filter((t: any) => t.league_id !== leagueId);
  s.memberships = (s.memberships || []).filter((m: any) => m.league_id !== leagueId);
  s.picks = (s.picks || []).filter((p: any) => p.league_id !== leagueId);
  s.fixtures = (s.fixtures || []).filter((f: any) => f.league_id !== leagueId);
  writeStore(s);
}

async function localUpdateLeague(leagueId: ID, patch: Partial<League>) {
  const s = readStore<any>();
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
   Export proxy
----------------------------------------------------------------------------- */
export const dataService: IDataService = {
  // Reads
  listLeagues: async (...a) => {
    const rows = await base.listLeagues(...a);
    return (rows || []).filter((l: any) => !l?.deleted_at);
  },
  getLeagueByName: (...a) => base.getLeagueByName(...a),
  getCurrentRound: (...a) => base.getCurrentRound(...a),
  listTeams: (...a) => base.listTeams(...a),
  listPicks: (...a) => base.listPicks(...a),
  listUsedTeamIds: (...a) => base.listUsedTeamIds(...a),

  // Mutations (proxy + notify)
  seed: withNotify(base.seed.bind(base)),
  upsertPlayer: withNotify(base.upsertPlayer.bind(base)),
  ensureMembership: withNotify(base.ensureMembership.bind(base)),
  upsertPick: withNotify(base.upsertPick.bind(base)),
  createNextRound: withNotify(base.createNextRound.bind(base)),
  lockRound: withNotify(base.lockRound.bind(base)),
  evaluateRound: withNotify(base.evaluateRound.bind(base)),
  advanceRound: withNotify(base.advanceRound.bind(base)),

  // Create game, then (if private) guarantee a join code
  createGame: withNotify(async (name: string, startISO: string) => {
    const created = await base.createGame(name, startISO);
    // If backend didn’t set code and league is private, create a local one
    const s = readStore<any>();
    const found = (s.leagues || []).find((l: any) => l.id === created.id);
    if (found && !found.is_public && !found.join_code) {
      found.join_code = genJoinCode();
      writeStore(s);
    }
    return created;
  }),

  importFixturesForCurrentRound: withNotify(
    base.importFixturesForCurrentRound.bind(base)
  ),
  evaluateFromFixtures: withNotify(base.evaluateFromFixtures.bind(base)),

  // Visibility: when switching to private, ensure a join code exists
  setLeagueVisibility: withNotify(async (leagueId: ID, isPublic: boolean) => {
    if (base.setLeagueVisibility) {
      await base.setLeagueVisibility(leagueId, isPublic);
    } else if (base.updateLeague) {
      await base.updateLeague(leagueId, { is_public: isPublic } as Partial<League>);
    } else {
      await localUpdateLeague(leagueId, { is_public: isPublic } as Partial<League>);
    }
    if (!isPublic) ensurePrivateCodeLocal(leagueId);
  }),

  updateLeague: withNotify(async (leagueId: ID, patch: Partial<League>) => {
    if (base.updateLeague) {
      await base.updateLeague(leagueId, patch);
    } else {
      await localUpdateLeague(leagueId, patch);
    }
    // If caller flipped to private via patch, guarantee a code
    if (patch.is_public === false) ensurePrivateCodeLocal(leagueId);
  }),

  deleteLeague: withNotify(async (leagueId: ID) => {
    if (base.deleteLeague) {
      return base.deleteLeague(leagueId);
    }
    return localDeleteLeague(leagueId);
  }),
};
