import { createClient } from "@supabase/supabase-js";

type TickResponse = {
  ok: boolean;
  env_check: boolean;
  db_connection_check: boolean;
  round_count: number | null;
  timestamp: string;
  duration_ms: number;
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
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export default async function handler(req: Req, res: Res) {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const now = new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: "Method Not Allowed",
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  const bearerToken = getBearerToken(req);
  const queryKey = typeof req.query.key === "string" ? req.query.key : null;

  if (!cronSecret || (bearerToken !== cronSecret && queryKey !== cronSecret)) {
    return sendJson(res, 401, {
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: "Unauthorized",
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
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: "Invalid SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let tickRunId: string | null = null;

  try {
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bucketMs = 5 * 60 * 1000;
    const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
    const runKey = bucketStart.toISOString().slice(0, 16) + "Z";

    const insertResult = await supabase
      .from("tick_runs")
      .insert({ run_key: runKey })
      .select("id")
      .single();

    if (insertResult.error) {
      const message = insertResult.error.message ?? "Failed to insert tick run";
      if (insertResult.error.code === "23505") {
        return sendJson(res, 200, {
          ok: true,
          env_check: envCheck,
          db_connection_check: true,
          round_count: null,
          timestamp,
          duration_ms: Date.now() - started,
          error: `Already ran for run_key=${runKey}`,
        });
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: false,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: message,
      });
    }

    tickRunId = insertResult.data.id;
    const connectionTest = await supabase.from("rounds").select("id", { head: true }).limit(1);
    const dbConnectionCheck = !connectionTest.error;

    if (!dbConnectionCheck) {
      if (tickRunId) {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: connectionTest.error?.message ?? "DB connectivity check failed" })
          .eq("id", tickRunId);
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: dbConnectionCheck,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: connectionTest.error?.message ?? "DB connectivity check failed",
      });
    }

    const countResult = await supabase.from("rounds").select("id", { head: true, count: "exact" });
    if (countResult.error) {
      if (tickRunId) {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: countResult.error.message })
          .eq("id", tickRunId);
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: dbConnectionCheck,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: countResult.error.message,
      });
    }

    if (tickRunId) {
      await supabase
        .from("tick_runs")
        .update({ status: "ok", completed_at: new Date().toISOString() })
        .eq("id", tickRunId);
    }

    return sendJson(res, 200, {
      ok: true,
      env_check: envCheck,
      db_connection_check: dbConnectionCheck,
      round_count: countResult.count ?? 0,
      timestamp,
      duration_ms: Date.now() - started,
    });
  } catch (error: any) {
    if (supabase && tickRunId) {
      try {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: error?.message ?? "DB check failed" })
          .eq("id", tickRunId);
      } catch {}
    }
    return sendJson(res, 502, {
      ok: false,
      env_check: envCheck,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: error?.message ?? "DB check failed",
    });
  }
}
