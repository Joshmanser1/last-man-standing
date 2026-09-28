import { createClient } from "@supabase/supabase-js";
import { isEligibleForTick, runLeagueLifecycle, type TickAction } from "../server/tickLifecycle.js";
import { createResendTransport } from "../server/email/resendTransport.js";
import { processServiceEmails } from "../server/email/serviceEmailProcessor.js";
import { createSupabaseServiceEmailRepository } from "../server/email/supabaseServiceEmailRepository.js";
import type { ServiceEmailSummary } from "../server/email/types.js";

type ServiceEmailRun = { status: number; body: ServiceEmailSummary | { error: string } };

type TickResponse = {
  ok: boolean;
  env_check: boolean;
  db_connection_check: boolean;
  round_count: number | null;
  timestamp: string;
  duration_ms: number;
  actions: TickAction[];
  processed_leagues: number;
  service_emails?: ServiceEmailSummary | { error: string };
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

type TickDependencies = {
  createClient: typeof createClient;
  runLeagueLifecycle: typeof runLeagueLifecycle;
  runServiceEmails: (supabase: any, now: Date) => Promise<ServiceEmailRun>;
};

function sendJson(res: Res, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function disabledServiceEmailSummary(): ServiceEmailSummary {
  return {
    disabled: true, remindersSent: 0, resultsSent: 0, skipped: 0, failed: 0,
    zeroSurvivorRoundsSkipped: 0, missingAuthEmail: 0, pilotBlocked: 0, ineligibleAfterClaim: 0,
    ambiguousMissedPickResultsSkipped: 0,
  };
}

async function runConfiguredServiceEmails(supabase: any, now: Date): Promise<ServiceEmailRun> {
  const enabled = process.env.SERVICE_EMAILS_ENABLED === "true";
  if (!enabled) return { status: 200, body: disabledServiceEmailSummary() };

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SERVICE_EMAIL_FROM?.trim();
  const replyTo = process.env.SERVICE_EMAIL_REPLY_TO?.trim();
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!apiKey || !from || !replyTo || !appOrigin) {
    return { status: 503, body: { error: "Service email configuration is incomplete." } };
  }

  try {
    const summary = await processServiceEmails({
      enabled, appOrigin, pilotAllowlist: process.env.SERVICE_EMAIL_PILOT_ALLOWLIST,
      now, repository: createSupabaseServiceEmailRepository(supabase),
      transport: createResendTransport({ apiKey, from, replyTo }),
    });
    return { status: summary.failed > 0 ? 207 : 200, body: summary };
  } catch (error) {
    console.error("Service email processor failed", error);
    return { status: 502, body: { error: "Service email processing failed." } };
  }
}

const defaultDependencies: TickDependencies = {
  createClient,
  runLeagueLifecycle,
  runServiceEmails: runConfiguredServiceEmails,
};

function getBearerToken(req: Req): string | null {
  const authHeader =
    req.headers.authorization ??
    (req.headers as Record<string, string | string[] | undefined>).Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export async function tickHandler(req: Req, res: Res, dependencies: TickDependencies = defaultDependencies) {
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

  const emailOnly = req.query.mode === "service-emails";
  if (emailOnly && process.env.SERVICE_EMAILS_ENABLED !== "true") {
    return sendJson(res, 200, disabledServiceEmailSummary());
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
    supabase = dependencies.createClient<any>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (emailOnly) {
      try {
        const serviceEmails = await dependencies.runServiceEmails(supabase, now);
        return sendJson(res, serviceEmails.status, serviceEmails.body);
      } catch (error) {
        console.error("Service email processor failed", error);
        return sendJson(res, 502, { error: "Service email processing failed." });
      }
    }

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
        await dependencies.runLeagueLifecycle({ supabase, league, now, actions });
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
    let serviceEmails: ServiceEmailSummary | { error: string };
    try {
      serviceEmails = (await dependencies.runServiceEmails(supabase, now)).body;
    } catch (emailError) {
      console.error("Service email processor failed", emailError);
      serviceEmails = { error: "Service email processing failed." };
    }
    return sendJson(res, 200, {
      ok: true, env_check: envCheck, db_connection_check: dbConnectionCheck,
      round_count: countResult.count ?? 0, timestamp, duration_ms: Date.now() - started,
      actions, processed_leagues: processedLeagues, service_emails: serviceEmails,
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

export default async function handler(req: Req, res: Res) {
  return tickHandler(req, res);
}
