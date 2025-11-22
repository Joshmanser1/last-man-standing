// src/data/mock.ts
import type { League, Round, Team, Player, Membership, Pick, Fixture, ID } from "./types";
import {
  fetchFplFixturesForEvent,
  getSmartCurrentEvent,
  getEventForDate,
  fetchFplTeams,
} from "../lib/fpl";

/* ---- Local FPL shapes to satisfy TS (what our fpl.ts returns) ---- */
type FplTeamLite = { id: number; name: string; short_name: string };
type FplFixtureLite = {
  fplId: number;
  home: FplTeamLite;
  away: FplTeamLite;
  kickoff: string | null;
  finished: boolean;
  homeScore: number | null;
  awayScore: number | null;
};

/* ------------------------------ local store ------------------------------- */

const KEY = "lms_store_v1";
type Store = {
  leagues: Array<League & Partial<{ start_date_utc: string; fpl_start_event: number }>>;
  rounds: Round[];
  teams: Team[];
  players: Player[];
  memberships: Membership[];
  picks: Pick[];
  fixtures: Fixture[];
};

const load = (): Store =>
  JSON.parse(
    localStorage.getItem(KEY) ||
      '{"leagues":[],"rounds":[],"teams":[],"players":[],"memberships":[],"picks":[],"fixtures":[]}'
  );

const save = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

const DEFAULT_LEAGUE_NAME = "English Premier League LMS";

/* --------------------------- TEAM SYNC (from FPL) --------------------------- */

async function syncTeamsFromFpl(leagueId: ID) {
  const s = load();
  const fplTeams = await fetchFplTeams(); // 20 current-season teams

  // replace teams for this league
  s.teams = s.teams.filter(t => t.league_id !== leagueId);

  const toTeam = (name: string, code: string): Team => ({
    id: uid(),
    league_id: leagueId,
    name,
    code: code.toUpperCase(),
    logo_url: `https://via.placeholder.com/96?text=${code.toUpperCase()}`,
  });

  s.teams.push(...fplTeams.map((t: FplTeamLite) => toTeam(t.name, t.short_name)));
  save(s);
  return { count: fplTeams.length };
}

async function ensureTeamsPresent(leagueId: ID) {
  const s = load();
  const count = s.teams.filter(t => t.league_id === leagueId).length;
  if (count < 20) await syncTeamsFromFpl(leagueId);
}

/* --------------------- Fixtures import & evaluation helpers ---------------- */

function upsertFixtureFromFpl(
  s: Store,
  round: Round,
  byCode: Map<string, Team>,
  fx: FplFixtureLite
) {
  const home = byCode.get(fx.home?.short_name?.toUpperCase?.() ?? "");
  const away = byCode.get(fx.away?.short_name?.toUpperCase?.() ?? "");
  if (!home || !away) return { imported: 0 };

  let existing = s.fixtures.find(
    F => F.round_id === round.id && F.home_team_id === home.id && F.away_team_id === away.id
  );

  if (!existing) {
    const newFx: Fixture = {
      id: uid(),
      round_id: round.id,
      home_team_id: home.id,
      away_team_id: away.id,
      kickoff_utc: fx.kickoff ?? undefined,
      result: "not_set",
      winning_team_id: undefined,
    };
    s.fixtures.push(newFx);
    existing = newFx;
  }

  if (fx.finished && fx.homeScore != null && fx.awayScore != null) {
    if (fx.homeScore > fx.awayScore) {
      existing.result = "home_win";
      existing.winning_team_id = home.id;
    } else if (fx.awayScore > fx.homeScore) {
      existing.result = "away_win";
      existing.winning_team_id = away.id;
    } else {
      existing.result = "draw";
      existing.winning_team_id = undefined;
    }
  }

  return { imported: 1 };
}

async function importFixturesForLeagueRound(leagueId: ID, roundNumber: number) {
  const s = load();
  const league = s.leagues.find(l => l.id === leagueId);
  if (!league) throw new Error("League not found");

  await ensureTeamsPresent(leagueId);

  const baseEvent =
    typeof league.fpl_start_event === "number"
      ? league.fpl_start_event
      : await getSmartCurrentEvent();
  const event = baseEvent + (roundNumber - 1);

  const s2 = load();
  const leagueTeams = s2.teams.filter(t => t.league_id === leagueId);
  const byCode = new Map<string, Team>(leagueTeams.map(t => [String(t.code).toUpperCase(), t]));
  const round = s2.rounds.find(r => r.league_id === leagueId && r.round_number === roundNumber);
  if (!round) throw new Error(`Round ${roundNumber} not found for league ${leagueId}`);

  const fpl = (await fetchFplFixturesForEvent(event)) as unknown as FplFixtureLite[];
  let imported = 0;
  for (const fx of fpl) {
    imported += upsertFixtureFromFpl(s2, round, byCode, fx).imported;
  }
  save(s2);
  return { imported, event };
}

function evaluatePicksFromFixtures(roundId: ID) {
  const s = load();
  const r = s.rounds.find(x => x.id === roundId)!;
  const fixtures = s.fixtures.filter(F => F.round_id === roundId);

  const outcome = new Map<ID, "win" | "loss" | "draw">();
  for (const F of fixtures) {
    if (F.result === "home_win") {
      outcome.set(F.home_team_id, "win");
      outcome.set(F.away_team_id, "loss");
    } else if (F.result === "away_win") {
      outcome.set(F.home_team_id, "loss");
      outcome.set(F.away_team_id, "win");
    } else if (F.result === "draw") {
      outcome.set(F.home_team_id, "draw");
      outcome.set(F.away_team_id, "draw");
    }
  }

  for (const p of s.picks.filter(p => p.round_id === roundId && p.status === "pending")) {
    const o = outcome.get(p.team_id);
    if (!o) continue;
    if (o === "win") {
      p.status = "through";
      p.reason = undefined;
    } else if (o === "loss") {
      p.status = "eliminated";
      p.reason = "loss";
    } else if (o === "draw") {
      p.status = "eliminated";
      p.reason = "draw";
    }
  }

  const anyPending = s.picks.some(p => p.round_id === roundId && p.status === "pending");
  if (!anyPending) r.status = "completed";
  save(s);
}

/* --------------------------------- mock service ---------------------------------- */

const mockService = {
  async seed() {
    const s = load();
    if (s.leagues.length) return;

    const league: League & { start_date_utc: string; fpl_start_event?: number } = {
      id: uid(),
      name: DEFAULT_LEAGUE_NAME,
      status: "upcoming",
      current_round: 1,
      start_date_utc: now(),
    };
    s.leagues.push(league);

    const deadline = new Date(Date.now() + 7 * 864e5);
    deadline.setHours(17, 0, 0, 0);

    const round: Round = {
      id: uid(),
      league_id: league.id,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: deadline.toISOString(),
      status: "upcoming",
    };
    s.rounds.push(round);

    save(s);
    await ensureTeamsPresent(league.id);
  },

  async listLeagues(): Promise<Store["leagues"]> {
    return load().leagues;
  },

  async createGame(name: string, startDateISO: string) {
    const s = load();
    const league: League & { start_date_utc: string; fpl_start_event: number } = {
      id: uid(),
      name,
      status: "upcoming",
      current_round: 1,
      start_date_utc: new Date(startDateISO).toISOString(),
      fpl_start_event: await getEventForDate(startDateISO),
    };
    s.leagues.push(league);

    const d = new Date(startDateISO);
    d.setHours(17, 0, 0, 0);

    const round1: Round = {
      id: uid(),
      league_id: league.id,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: d.toISOString(),
      status: "upcoming",
    };
    s.rounds.push(round1);

    save(s);
    await ensureTeamsPresent(league.id);
    return league;
  },

  async getLeagueByName(name: string) {
    return load().leagues.find(l => l.name === name)!;
  },
  async getCurrentRound(leagueId: ID) {
    const s = load();
    const league = s.leagues.find(l => l.id === leagueId)!;
    return s.rounds.find(r => r.league_id === leagueId && r.round_number === league.current_round)!;
  },
  async listTeams(leagueId: ID) {
    return load()
      .teams.filter(t => t.league_id === leagueId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  async listPicks(roundId: ID) {
    return load().picks.filter(p => p.round_id === roundId);
  },
  async listUsedTeamIds(leagueId: ID, playerId: ID) {
    return new Set(
      load()
        .picks.filter(p => p.league_id === leagueId && p.player_id === playerId)
        .map(p => p.team_id)
    );
  },

  async upsertPlayer(display_name: string) {
    const s = load();
    let p = s.players.find(x => x.display_name === display_name);
    if (!p) {
      p = { id: uid(), display_name };
      s.players.push(p);
      save(s);
    }
    return p;
  },
  async ensureMembership(leagueId: ID, playerId: ID) {
    const s = load();
    let m = s.memberships.find(x => x.league_id === leagueId && x.player_id === playerId);
    if (!m) {
      m = { id: uid(), league_id: leagueId, player_id: playerId, is_active: true, joined_at: now() };
      s.memberships.push(m);
      save(s);
    }
    return m;
  },

  async upsertPick(round: Round, leagueId: ID, playerId: ID, teamId: ID) {
    const s = load();
    if (new Date(round.pick_deadline_utc).getTime() <= Date.now()) throw new Error("Deadline passed");
    if (s.picks.some(p => p.league_id === leagueId && p.player_id === playerId && p.team_id === teamId))
      throw new Error("Team already used in this league");

    let existing = s.picks.find(p => p.round_id === round.id && p.player_id === playerId);
    if (existing) {
      existing.team_id = teamId;
      save(s);
      return existing;
    }

    const pick: Pick = {
      id: uid(),
      league_id: leagueId,
      round_id: round.id,
      player_id: playerId,
      team_id: teamId,
      created_at: now(),
      status: "pending",
    };
    s.picks.push(pick);
    save(s);
    return pick;
  },

  async importFixturesForCurrentRound(leagueId: ID) {
    const s = load();
    const league = s.leagues.find(l => l.id === leagueId)!;
    return importFixturesForLeagueRound(league.id, league.current_round);
  },
  async evaluateFromFixtures(roundId: ID) {
    evaluatePicksFromFixtures(roundId);
  },

  async lockRound(roundId: ID) {
    const s = load();
    const r = s.rounds.find(x => x.id === roundId)!;
    r.status = "locked";
    const leagueId = r.league_id;

    const active = s.memberships.filter(m => m.league_id === leagueId && m.is_active).map(m => m.player_id);
    for (const pid of active) {
      const hasPick = s.picks.some(p => p.round_id === roundId && p.player_id === pid);
      if (!hasPick) {
        s.picks.push({
          id: uid(),
          league_id: leagueId,
          round_id: roundId,
          player_id: pid,
          team_id: s.teams.find(t => t.league_id === leagueId)!.id,
          created_at: now(),
          status: "no-pick",
          reason: "no-pick",
        } as any);
      }
    }
    save(s);
  },

  async evaluateRound(roundId: ID) {
    const s = load();
    const r = s.rounds.find(x => x.id === roundId)!;
    const pending = s.picks.filter(p => p.round_id === roundId && p.status === "pending");
    pending.forEach((p, i) => {
      p.status = i % 2 === 0 ? "through" : "eliminated";
      p.reason = p.status === "eliminated" ? "loss" : undefined;
    });
    r.status = "completed";
    save(s);
  },

  async advanceRound(leagueId: ID) {
    const s = load();
    const league = s.leagues.find(l => l.id === leagueId)!;
    const last = s.rounds.find(r => r.league_id === leagueId && r.round_number === league.current_round)!;
    const survivors = new Set(
      s.picks.filter(p => p.round_id === last.id && p.status === "through").map(p => p.player_id)
    );
    if (survivors.size <= 1) {
      league.status = "completed";
      save(s);
      return;
    }
    await this.createNextRound(leagueId);
  },

  async createNextRound(leagueId: ID, nextDeadlineISO?: string) {
    const s = load();
    const league = s.leagues.find(l => l.id === leagueId)!;
    const nextNum = league.current_round + 1;
    const r: Round = {
      id: uid(),
      league_id: leagueId,
      round_number: nextNum,
      name: `Round ${nextNum}`,
      pick_deadline_utc: nextDeadlineISO ?? new Date(Date.now() + 7 * 864e5).toISOString(),
      status: "upcoming",
    };
    s.rounds.push(r);
    league.current_round = nextNum;
    league.status = "active";
    save(s);
    return r;
  },

  async syncTeams(leagueId: ID) {
    return syncTeamsFromFpl(leagueId);
  },
};

export default mockService;
