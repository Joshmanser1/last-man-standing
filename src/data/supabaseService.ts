import { validDisplayName } from "../lib/displayName";
// src/data/supabaseService.ts
import { supa } from "../lib/supabaseClient";
import type { League, Round, Team, Player, Membership, Pick, Fixture, ID } from "./types";
import type { IDataService } from "./service";
import { fetchFplFixturesForEvent, getEventForDate, getSmartCurrentEvent } from "../lib/fpl";
import { getEffectiveUserId } from "../lib/auth";
import { getApiHeaders } from "../lib/apiAuth";
import { postJsonWithAuth } from "../lib/apiAuth";
import type { UpsertPlayerOptions } from "./service";

/** Helpers */
function must<T>(val: T | null | undefined, msg = "Not found"): T {
  if (val == null) throw new Error(msg);
  return val;
}
async function currentUserId(): Promise<string> {
  const uid = await getEffectiveUserId();
  if (!uid) throw new Error("You must be logged in.");
  return uid;
}

async function finalizeAdminRound(roundId: ID, lockOnly = false) {
  const { data, error } = await supa.from("rounds").select("league_id").eq("id", roundId).single();
  if (error) throw error;
  const response = await postJsonWithAuth("/api/admin", {
    action: lockOnly ? "lock-round" : "finalize-round", league_id: data.league_id, round_id: roundId,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Round finalisation failed");
  return result as { survivors: number };
}

/** Supabase-backed data service */
const supabaseService: IDataService = {
  async seed() {/* no-op */},

  // Lookups
  async listLeagues(): Promise<League[]> {
    const { data: publicLeagues, error: publicError } = await supa
      .from("leagues")
      .select("*")
      .eq("is_public", true)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    if (publicError) throw publicError;

    const uid = await getEffectiveUserId();
    if (!uid) return (publicLeagues ?? []) as League[];
    const visibleResp = await postJsonWithAuth("/api/user-leagues", { user_id: uid });
    if (!visibleResp.ok) throw new Error("Failed to load visible leagues");
    const myLeagues = (await visibleResp.json()) as League[];

    const merged = new Map<string, League>();
    (publicLeagues ?? []).forEach((l: any) => merged.set(l.id as string, l as League));
    (myLeagues ?? []).forEach((l: any) => merged.set(l.id as string, l as League));
    return Array.from(merged.values()).sort(
      (a: any, b: any) =>
        new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime()
    );
  },

  async getLeagueByName(name: string): Promise<League> {
    const { data, error } = await supa
      .from("leagues")
      .select("*")
      .eq("name", name)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return must(data as League, `League '${name}' not found`);
  },

  async getCurrentRound(leagueId: ID): Promise<Round> {
    const { data: league, error: e1 } = await supa
      .from("leagues")
      .select("*")
      .eq("id", leagueId)
      .is("deleted_at", null)
      .maybeSingle();
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
  async upsertPlayer(display_name: string, options?: UpsertPlayerOptions): Promise<Player> {
    const { data: authData, error: authErr } = await supa.auth.getUser();
    if (authErr || !authData?.user?.id) throw new Error("You must be logged in.");
    const uid = authData.user.id;
    const email = authData.user.email ?? null;

    const { data: existing, error: existingErr } = await supa
      .from("profiles")
      .select("email, display_name")
      .eq("id", uid)
      .maybeSingle();
    if (existingErr) throw existingErr;
    const existingDisplayName = validDisplayName(existing?.display_name);
    if (existingDisplayName && options?.allowNameOverwrite !== true) {
      return { id: uid, display_name: existingDisplayName } as Player;
    }

    const normalizedDisplayName = validDisplayName(display_name);
    if (!normalizedDisplayName) throw new Error("Choose a valid display name.");
    const payload: Record<string, unknown> = { id: uid, display_name: normalizedDisplayName };
    if (!existing?.email && email) payload.email = email;

    const { data, error } = await supa
      .from("profiles")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const player = must(data as Player, "Failed to upsert player");
    if (!validDisplayName(player.display_name)) throw new Error("Failed to save a valid display name.");
    return player;
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
    const current = await this.getCurrentRound(leagueId);
    const final = await finalizeAdminRound(current.id);
    if (final.survivors <= 1) throw new Error("No next round: competition has a winner or awaits zero-survivor rollover.");
    const { data: league, error: e1 } = await supa
      .from("leagues")
      .select("*")
      .eq("id", leagueId)
      .is("deleted_at", null)
      .maybeSingle();
    if (e1) throw e1;

    if (league?.current_round !== current.round_number) throw new Error("Round changed; refresh before advancing.");
    const nextNum = (must(league as League).current_round as number) + 1;
    const deadline = nextDeadlineISO ?? new Date(Date.now() + 7 * 864e5).toISOString();

    const { data: round, error } = await supa
      .from("rounds")
      .insert({ league_id: leagueId, round_number: nextNum, name: `Round ${nextNum}`, pick_deadline_utc: deadline, status: "upcoming" })
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const u = await supa.from("leagues").update({ current_round: nextNum, status: "active" })
      .eq("id", leagueId).eq("current_round", current.round_number).select("id").single();
    if (u.error) throw u.error;

    return must(round as Round);
  },

  async lockRound(roundId: ID): Promise<void> {
    await finalizeAdminRound(roundId, true);
  },

  async evaluateRound(roundId: ID): Promise<void> {
    await finalizeAdminRound(roundId);
  },

  async advanceRound(leagueId: ID): Promise<void> {
    const r = await this.getCurrentRound(leagueId);
    const { survivors } = await finalizeAdminRound(r.id);
    // Zero survivors remains a rollover hold, never a normal winner/completion.
    if (survivors <= 1) return;
    await this.createNextRound(leagueId);
  },

  // Admin convenience
  async createGame(
    name: string,
    startISO: string,
    options?: { fplStartEvent?: number; joinCode?: string; isTest?: boolean }
  ): Promise<League> {
    const fpl_start_event =
      typeof options?.fplStartEvent === "number"
        ? options.fplStartEvent
        : await getEventForDate(startISO);
    const res = await fetch("/api/create-league", {
      method: "POST",
      headers: await getApiHeaders(),
      body: JSON.stringify({
        name,
        start_date_utc: startISO,
        fpl_start_event,
        join_code: options?.joinCode ?? null,
        is_public: false,
        is_test: options?.isTest === true,
      }),
    });
    if (!res.ok) {
      let msg = "Failed to create league";
      try {
        const err = await res.json();
        msg = err?.error ?? msg;
      } catch {}
      throw new Error(msg);
    }
    return must((await res.json()) as League, "Failed to create league");
  },

  async importFixturesForCurrentRound(leagueId: ID): Promise<{ event: number }> {
    const { data: league, error: e0 } = await supa
      .from("leagues")
      .select("*")
      .eq("id", leagueId)
      .is("deleted_at", null)
      .maybeSingle();
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
        winning_team_id: result === "home_win" ? home.id : result === "away_win" ? away.id : null,
      });
    }

    if (rows.length) {
      const { error } = await supa.from("fixtures").upsert(rows as any, {
        ignoreDuplicates: false,
        onConflict: "round_id,home_team_id,away_team_id",
      });
      if (error) throw error;
    }

    return { event };
  },

  async evaluateFromFixtures(roundId: ID): Promise<void> {
    await finalizeAdminRound(roundId);
  },
};

export { supabaseService };
