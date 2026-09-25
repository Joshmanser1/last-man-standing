import { createClient } from "@supabase/supabase-js";
import { isEligibleForTick, runLeagueLifecycle, type TickAction } from "../server/tickLifecycle";

type TickResponse = {
  ok: boolean;
  env_check: boolean;
  db_connection_check: boolean;
  round_count: number | null;
  timestamp: string;
  duration_ms: number;
  actions: TickAction[];
  processed_leagues: number;
  error?: string;
};

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
};

type Res = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function sendJson(res: Res, status: number, body: TickResponse): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function getBearerToken(req: Req): string | null {
  const authHeader =
    req.headers.authorization ??
    (req.headers as Record<string, string | string[] | undefined>).Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export default async function handler(req: Req, res: Res) {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const now = new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      ok: false, env_check: false, db_connection_check: false, round_count: null, timestamp,
      duration_ms: Date.now() - started, actions: [], processed_leagues: 0, error: "Method Not Allowed",
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  const bearerToken = getBearerToken(req);
  const queryKey = typeof req.query.key === "string" ? req.query.key : null;
  if (!cronSecret || (bearerToken !== cronSecret && queryKey !== cronSecret)) {
    const authError = !cronSecret
      ? "Unauthorized: missing CRON_SECRET env configuration"
      : "Unauthorized: provide Authorization: Bearer <CRON_SECRET> or ?key=<CRON_SECRET>";
    return sendJson(res, 401, {
      ok: false, env_check: false, db_connection_check: false, round_count: null, timestamp,
      duration_ms: Date.now() - started, actions: [], processed_leagues: 0, error: authError,
    });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const envCheck = supabaseUrl.startsWith("https://") && serviceRoleKey.length > 20;
  console.log("tick env check", {
    supabase_url_exists: Boolean(supabaseUrl),
    supabase_service_role_key_exists: Boolean(serviceRoleKey),
  });

  if (!envCheck) {
    return sendJson(res, 500, {
      ok: false, env_check: false, db_connection_check: false, round_count: null, timestamp,
      duration_ms: Date.now() - started, actions: [], processed_leagues: 0,
      error: "Invalid SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  let supabase: any | null = null;
  let tickRunId: string | null = null;
  const actions: TickAction[] = [];
  let processedLeagues = 0;
  let dbConnectionCheck = false;

  try {
    supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bucketMs = 5 * 60 * 1000;
    const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
    const runKey = bucketStart.toISOString().slice(0, 16) + "Z";
    const insertResult = await supabase.from("tick_runs").insert({ run_key: runKey }).select("id").single();

    if (insertResult.error) {
      const message = insertResult.error.message ?? "Failed to insert tick run";
      if (insertResult.error.code === "23505") {
        const previous = await supabase.from("tick_runs").select("status").eq("run_key", runKey).maybeSingle();
        if (previous.error) throw new Error(previous.error.message);
        if (previous.data?.status !== "ok") throw new Error("Previous tick failed or is still running; retry next tick window");
        return sendJson(res, 200, {
          ok: true, env_check: envCheck, db_connection_check: true, round_count: null, timestamp,
          duration_ms: Date.now() - started, actions: [], processed_leagues: 0,
          error: `Already ran for run_key=${runKey}`,
        });
      }
      return sendJson(res, 502, {
        ok: false, env_check: envCheck, db_connection_check: false, round_count: null, timestamp,
        duration_ms: Date.now() - started, actions: [], processed_leagues: 0, error: message,
      });
    }

    tickRunId = insertResult.data.id;
    const connectionTest = await supabase.from("rounds").select("id", { head: true }).limit(1);
    dbConnectionCheck = !connectionTest.error;
    if (!dbConnectionCheck) throw new Error(connectionTest.error?.message ?? "DB connectivity check failed");

    const countResult = await supabase.from("rounds").select("id", { head: true, count: "exact" });
    if (countResult.error) throw new Error(countResult.error.message);

    const leaguesResult = await supabase
      .from("leagues")
      .select("id, status, current_round, fpl_start_event, is_test")
      .eq("automation_enabled", true)
      .not("is_test", "is", true)
      .is("deleted_at", null);
    if (leaguesResult.error) throw new Error(leaguesResult.error.message);

    let leagueFailed = false;
    for (const league of (leaguesResult.data ?? []).filter(isEligibleForTick)) {
      processedLeagues += 1;
      try {
        await runLeagueLifecycle({ supabase, league, now, actions });
      } catch (leagueError: any) {
        leagueFailed = true;
        actions.push({
          league_id: league.id,
          step: "league_error",
          error: leagueError?.message ?? "League tick failed",
        });
      }
    }

    if (leagueFailed) throw new Error("One or more leagues failed; see league tick runs");
    const report = await supabase.from("tick_runs").update({ status: "ok", completed_at: new Date().toISOString() }).eq("id", tickRunId);
    if (report.error) throw new Error(report.error.message);
    return sendJson(res, 200, {
      ok: true, env_check: envCheck, db_connection_check: dbConnectionCheck,
      round_count: countResult.count ?? 0, timestamp, duration_ms: Date.now() - started,
      actions, processed_leagues: processedLeagues,
    });
  } catch (error: any) {
    if (supabase && tickRunId) {
      try {
        const report = await supabase.from("tick_runs").update({
          status: "error", completed_at: new Date().toISOString(), error: error?.message ?? "DB check failed",
        }).eq("id", tickRunId);
        if (report.error) console.error("Failed to record tick failure", report.error);
      } catch (reportError) { console.error("Failed to record tick failure", reportError); }
    }
    return sendJson(res, 502, {
      ok: false, env_check: envCheck, db_connection_check: dbConnectionCheck, round_count: null, timestamp,
      duration_ms: Date.now() - started, actions, processed_leagues: processedLeagues,
      error: error?.message ?? "DB check failed",
    });
  }
}
