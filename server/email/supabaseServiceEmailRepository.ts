import { reminderCandidates, resultCandidates, type LeagueEmailSnapshot } from "./eligibility.js";
import type { CandidateDiscovery, ServiceEmailRepository } from "./serviceEmailProcessor.js";
import type { DeliveryClaim, ServiceEmailCandidate } from "./types.js";

type QueryError = { message?: string | null } | null;

async function requireData<T>(
  request: PromiseLike<{ data: T | null; error: QueryError }>,
  context: string
): Promise<T> {
  const { data, error } = await request;
  if (error) throw new Error(`${context}: ${error.message ?? "query failed"}`);
  if (data == null) throw new Error(`${context}: query returned no data`);
  return data;
}

async function loadPages<T>(
  context: string,
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>
) {
  const rows: T[] = [];
  for (let from = 0;; from += 500) {
    const page = await requireData(makeQuery(from, from + 499), context);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

export function createSupabaseServiceEmailRepository(supabase: any): ServiceEmailRepository {
  async function loadSnapshot(leagueId: string): Promise<LeagueEmailSnapshot | null> {
    const leagueResult: { data: LeagueEmailSnapshot["league"] | null; error: QueryError } = await supabase.from("leagues")
      .select("id,name,current_round").eq("id", leagueId).is("deleted_at", null)
      .maybeSingle();
    const { data: league, error: leagueError } = leagueResult;
    if (leagueError) {
      throw new Error(`League snapshot lookup failed: ${leagueError.message ?? "query failed"}`);
    }
    if (!league) return null;
    const [rounds, memberships, picks, teams] = await Promise.all([
      loadPages<LeagueEmailSnapshot["rounds"][number]>("Round snapshot lookup failed", (from, to) =>
        supabase.from("rounds").select("id,league_id,round_number,status,pick_deadline_utc,finalized_at").eq("league_id", leagueId).order("round_number").range(from, to)),
      loadPages<LeagueEmailSnapshot["memberships"][number]>("Membership snapshot lookup failed", (from, to) =>
        supabase.from("memberships").select("player_id,is_active,joined_at").eq("league_id", leagueId).order("player_id").range(from, to)),
      loadPages<LeagueEmailSnapshot["picks"][number]>("Pick snapshot lookup failed", (from, to) =>
        supabase.from("picks").select("round_id,player_id,team_id,status,reason").eq("league_id", leagueId).order("id").range(from, to)),
      loadPages<LeagueEmailSnapshot["teams"][number]>("Team snapshot lookup failed", (from, to) =>
        supabase.from("teams").select("id,name").eq("league_id", leagueId).order("id").range(from, to)),
    ]);
    return { league, rounds, memberships, picks, teams };
  }

  async function discover(now: Date): Promise<CandidateDiscovery> {
    const reminderStart = new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString();
    const reminderEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000).toISOString();
    const [reminderRounds, finalizedRounds] = await Promise.all([
      loadPages<{ id: string; league_id: string }>("Reminder round discovery failed", (from, to) => supabase.from("rounds").select("id,league_id").eq("status", "upcoming")
        .is("finalized_at", null).gte("pick_deadline_utc", reminderStart).lte("pick_deadline_utc", reminderEnd)
        .order("id").range(from, to)),
      loadPages<{ id: string; league_id: string }>("Finalized round discovery failed", (from, to) => supabase.from("rounds").select("id,league_id").eq("status", "completed")
        .not("finalized_at", "is", null).order("id").range(from, to)),
    ]);
    const snapshots = new Map<string, Promise<LeagueEmailSnapshot | null>>();
    const snapshot = (leagueId: string) => {
      if (!snapshots.has(leagueId)) snapshots.set(leagueId, loadSnapshot(leagueId));
      return snapshots.get(leagueId)!;
    };
    const candidates: ServiceEmailCandidate[] = [];
    for (const round of reminderRounds) {
      const leagueSnapshot = await snapshot(round.league_id);
      if (leagueSnapshot) candidates.push(...reminderCandidates(leagueSnapshot, round.id));
    }
    let zeroSurvivorRoundsSkipped = 0;
    let ambiguousMissedPickResultsSkipped = 0;
    for (const round of finalizedRounds) {
      const leagueSnapshot = await snapshot(round.league_id);
      if (!leagueSnapshot) continue;
      const result = resultCandidates(leagueSnapshot, round.id);
      if (result.zeroSurvivors) zeroSurvivorRoundsSkipped++;
      else {
        candidates.push(...result.candidates);
        ambiguousMissedPickResultsSkipped += result.ambiguousMissedPicks;
      }
    }
    return { candidates, zeroSurvivorRoundsSkipped, ambiguousMissedPickResultsSkipped };
  }

  return {
    discover,
    async resolveAuthEmail(playerId) {
      const { data, error } = await supabase.auth.admin.getUserById(playerId);
      if (error) throw new Error(error.message ?? "Auth user lookup failed");
      const user = data?.user;
      const email = typeof user?.email === "string" ? user.email.trim() : "";
      return user?.email_confirmed_at && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
    },
    async claim(candidate) {
      const { data, error } = await supabase.rpc("claim_service_email_delivery", {
        p_league_id: candidate.leagueId, p_round_id: candidate.roundId, p_player_id: candidate.playerId,
        p_event_type: candidate.eventType, p_outcome: candidate.outcome,
      });
      if (error) throw new Error(error.message ?? "Delivery claim failed");
      if (!data) return null;
      return { id: data.id, claimToken: data.claim_token, attemptCount: data.attempt_count } as DeliveryClaim;
    },
    async recheck(candidate, now) {
      const snapshot = await loadSnapshot(candidate.leagueId);
      if (!snapshot) return false;
      if (candidate.eventType === "pick_reminder") {
        const round = snapshot.rounds.find(entry => entry.id === candidate.roundId);
        return !!round && Date.parse(round.pick_deadline_utc) > now.getTime()
          && reminderCandidates(snapshot, candidate.roundId).some(entry => entry.playerId === candidate.playerId);
      }
      const result = resultCandidates(snapshot, candidate.roundId);
      return !result.zeroSurvivors && result.candidates.some(entry =>
        entry.playerId === candidate.playerId && entry.outcome === candidate.outcome);
    },
    async complete(claim, providerMessageId) {
      const { data, error } = await supabase.rpc("complete_service_email_delivery", {
        p_delivery_id: claim.id, p_claim_token: claim.claimToken, p_provider_message_id: providerMessageId,
      });
      if (error || data !== true) throw new Error(error?.message ?? "Delivery completion claim was lost");
    },
    async fail(claim, message) {
      const { error } = await supabase.rpc("fail_service_email_delivery", {
        p_delivery_id: claim.id, p_claim_token: claim.claimToken, p_error: message,
      });
      if (error) throw new Error(error.message);
    },
    async release(claim) {
      const { error } = await supabase.rpc("release_service_email_delivery", {
        p_delivery_id: claim.id, p_claim_token: claim.claimToken,
      });
      if (error) throw new Error(error.message);
    },
  };
}
