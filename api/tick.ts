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

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const envCheck = Boolean(supabaseUrl) && Boolean(serviceRoleKey);
  console.log("tick env check", {
    supabase_url_exists: Boolean(supabaseUrl),
    supabase_service_role_key_exists: Boolean(serviceRoleKey),
  });

  if (!envCheck) {
    return sendJson(res, 500, {
      ok: false,
      env_check: envCheck,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: "Missing required environment variables",
    });
  }

  const supabase = createClient(supabaseUrl!, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const connectionTest = await supabase.from("rounds").select("id", { head: true }).limit(1);
    const dbConnectionCheck = !connectionTest.error;

    if (!dbConnectionCheck) {
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

    return sendJson(res, 200, {
      ok: true,
      env_check: envCheck,
      db_connection_check: dbConnectionCheck,
      round_count: countResult.count ?? 0,
      timestamp,
      duration_ms: Date.now() - started,
    });
  } catch (error: any) {
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
