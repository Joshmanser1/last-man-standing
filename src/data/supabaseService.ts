// src/data/supabaseService.ts
import { supa } from "../lib/supabaseClient";
import type { League, Round, Team, Player, Membership, Pick, Fixture, ID } from "./types";
import type { IDataService } from "./service";
import { fetchFplFixturesForEvent, getEventForDate, getSmartCurrentEvent } from "../lib/fpl";

/** Helpers */
function must<T>(val: T | null | undefined, msg = "Not found"): T {
  if (val == null) throw new Error(msg);
  return val;
}
async function currentUserId(): Promise<string> {
  const { data, error } = await supa.auth.getUser();
  if (error || !data?.user?.id) throw new Error("You must be logged in.");
  return data.user.id;
}

/** Supabase-backed data service */
const supabaseService: IDataService = {
  async seed() {/* no-op */},

  // Lookups
  async listLeagues(): Promise<League[]> {
    const { data, error } = await supa.from("leagues").select("*").order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []) as League[];
  },

  async getLeagueByName(name: string): Promise<League> {
    const { data, error } = await supa.from("leagues").select("*").eq("name", name).limit(1).maybeSingle();
    if (error) throw error;
    return must(data as League, `League '${name}' not found`);
  },

  async getCurrentRound(leagueId: ID): Promise<Round> {
    const { data: league, error: e1 } = await supa.from("leagues").select("*").eq("id", leagueId).maybeSingle();
    if (e1) throw e1;
    const num = must(league as League, "League not found").current_round;

    const { data: round, error: e2 } = await supa
      .from("rounds").select("*")
      .eq("league_id", leagueId)
      .eq("round_number", num)
      .maybeSingle();
    if (e2) throw e2;
    return must(round as Round, "Current round not found");
  },

  async listTeams(leagueId: ID): Promise<Team[]> {
    const { data, error } = await supa.from("teams").select("*").eq("league_id", leagueId).order("name");
    if (error) throw error;
    return (data ?? []) as Team[];
  },

  async listPicks(roundId: ID): Promise<Pick[]> {
    const { data, error } = await supa.from("picks").select("*").eq("round_id", roundId);
    if (error) throw error;
    return (data ?? []) as Pick[];
  },

  async listUsedTeamIds(leagueId: ID, playerId: ID): Promise<Set<ID>> {
    const { data, error } = await supa
      .from("picks")
      .select("team_id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId);
    if (error) throw error;
    return new Set((data ?? []).map((r: any) => r.team_id as ID));
  },

  // Players & membership
  async upsertPlayer(display_name: string): Promise<Player> {
    const uid = await currentUserId();
    const { data, error } = await supa
      .from("players")
      .upsert({ id: uid, display_name }, { onConflict: "id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return must(data as Player, "Failed to upsert player");
  },

  async ensureMembership(leagueId: ID, playerId: ID): Promise<Membership> {
    const { data, error } = await supa
      .from("memberships")
      .upsert({ league_id: leagueId, player_id: playerId, is_active: true }, { onConflict: "league_id,player_id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return must(data as Membership, "Failed to ensure membership");
  },

  // Picks
  async upsertPick(round: Round, leagueId: ID, playerId: ID, teamId: ID): Promise<Pick> {
    if (new Date(round.pick_deadline_utc).getTime() <= Date.now()) throw new Error("Deadline passed");

    // replace existing pick for this (round, player)
    const del = await supa.from("picks").delete().eq("round_id", round.id).eq("player_id", playerId);
    if (del.error) throw del.error;

    const { data, error } = await supa
      .from("picks")
      .insert({ league_id: leagueId, round_id: round.id, player_id: playerId, team_id: teamId, status: "pending" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return must(data as Pick, "Failed to save pick");
  },

  // Rounds (admin)
  async createNextRound(leagueId: ID, nextDeadlineISO?: string): Promise<Round> {
    const { data: league, error: e1 } = await supa.from("leagues").select("*").eq("id", leagueId).maybeSingle();
    if (e1) throw e1;

    const nextNum = (must(league as League).current_round as number) + 1;
    const deadline = nextDeadlineISO ?? new Date(Date.now() + 7 * 864e5).toISOString();

    const { data: round, error } = await supa
      .from("rounds")
      .insert({ league_id: leagueId, round_number: nextNum, name: `Round ${nextNum}`, pick_deadline_utc: deadline, status: "upcoming" })
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const u = await supa.from("leagues").update({ current_round: nextNum, status: "active" }).eq("id", leagueId);
    if (u.error) throw u.error;

    return must(round as Round);
  },

  async lockRound(roundId: ID): Promise<void> {
    const { error } = await supa.from("rounds").update({ status: "locked" }).eq("id", roundId);
    if (error) throw error;
  },

  async evaluateRound(_roundId: ID): Promise<void> {
    // No-op here; Admin page has Auto-Evaluate via fixtures
    return;
  },

  async advanceRound(leagueId: ID): Promise<void> {
    const r = await this.getCurrentRound(leagueId);
    const { data: survivors, error: e1 } = await supa
      .from("picks")
      .select("player_id")
      .eq("round_id", r.id)
      .eq("status", "through");
    if (e1) throw e1;

    if ((survivors ?? []).length <= 1) {
      const { error } = await supa.from("leagues").update({ status: "completed" }).eq("id", leagueId);
      if (error) throw error;
      return;
    }
    await this.createNextRound(leagueId);
  },

  // Admin convenience
  async createGame(name: string, startISO: string): Promise<League> {
    const { data: league, error } = await supa
      .from("leagues")
      .insert({
        name,
        status: "upcoming",
        current_round: 1,
        // optional visibility flags; if your TS type doesn't have them, cast is fine
        is_public: false as any,
        join_open: true as any,
      })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const lg = must(league as League, "Failed to create league");

    const fpl_start_event = await getEventForDate(startISO);
    await supa.from("leagues").update({ fpl_start_event } as any).eq("id", lg.id).maybeSingle();

    const d = new Date(startISO);
    d.setHours(17, 0, 0, 0);
    const r1Deadline = d.toISOString();
    const { error: e2 } = await supa
      .from("rounds")
      .insert({ league_id: lg.id, round_number: 1, name: "Round 1", pick_deadline_utc: r1Deadline, status: "upcoming" });
    if (e2) throw e2;

    return lg;
  },

  async importFixturesForCurrentRound(leagueId: ID): Promise<{ event: number }> {
    const { data: league, error: e0 } = await supa.from("leagues").select("*").eq("id", leagueId).maybeSingle();
    if (e0) throw e0;

    const baseEvent: number =
      typeof (league as any)?.fpl_start_event === "number"
        ? (league as any).fpl_start_event
        : await getSmartCurrentEvent();
    const event = baseEvent + (must(league as League).current_round as number) - 1;

    const { data: teams, error: e1 } = await supa.from("teams").select("*").eq("league_id", leagueId);
    if (e1) throw e1;
    const byCode = new Map<string, Team>(
      (teams ?? []).map((t: any) => [String((t as Team).code).toUpperCase(), t as Team])
    );

    const r = await this.getCurrentRound(leagueId);
    const fpl = await fetchFplFixturesForEvent(event);

    const rows: Partial<Fixture>[] = [];
    for (const fx of fpl) {
      const home = byCode.get((fx.home?.short_name ?? "").toUpperCase());
      const away = byCode.get((fx.away?.short_name ?? "").toUpperCase());
      if (!home || !away) continue;

      const result: Fixture["result"] =
        fx.finished && fx.homeScore != null && fx.awayScore != null
          ? fx.homeScore > fx.awayScore
            ? "home_win"
            : fx.awayScore > fx.homeScore
            ? "away_win"
            : "draw"
          : "not_set";

      rows.push({
        round_id: r.id,
        home_team_id: home.id,
        away_team_id: away.id,
        kickoff_utc: fx.kickoff ?? undefined,
        result,
        winning_team_id: result === "home_win" ? home.id : result === "away_win" ? away.id : undefined,
      });
    }

    if (rows.length) {
      const { error } = await supa.from("fixtures").upsert(rows as any, {
        ignoreDuplicates: true,
        onConflict: "round_id,home_team_id,away_team_id",
      });
      if (error) throw error;
    }

    return { event };
  },

  async evaluateFromFixtures(roundId: ID): Promise<void> {
    const { data: fixtures, error: e1 } = await supa.from("fixtures").select("*").eq("round_id", roundId);
    if (e1) throw e1;

    const outcome = new Map<ID, "win" | "loss" | "draw">();
    for (const F of (fixtures ?? []) as Fixture[]) {
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

    const { data: pending, error: e2 } = await supa
      .from("picks")
      .select("*")
      .eq("round_id", roundId)
      .eq("status", "pending");
    if (e2) throw e2;

    const updates = (pending ?? [])
      .map((p: any) => {
        const o = outcome.get(p.team_id as ID);
        if (!o) return null;
        return {
          id: p.id as string,
          status: o === "win" ? "through" : "eliminated",
          reason: o === "draw" ? "draw" : o === "loss" ? "loss" : null,
        };
      })
      .filter(Boolean) as Array<{ id: string; status: Pick["status"]; reason: Pick["reason"] }>;

    for (const u of updates) {
      const { error } = await supa.from("picks").update({ status: u.status, reason: u.reason }).eq("id", u.id);
      if (error) throw error;
    }

    const { count, error: e3 } = await supa
      .from("picks")
      .select("*", { count: "exact", head: true })
      .eq("round_id", roundId)
      .eq("status", "pending");
    if (e3) throw e3;

    if ((count ?? 0) === 0) {
      const { error } = await supa.from("rounds").update({ status: "completed" }).eq("id", roundId);
      if (error) throw error;
    }
  },
};

export { supabaseService };
