import type { Handler } from "@netlify/functions";
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

const json = (statusCode: number, body: TickResponse) => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const getBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
};

export const handler: Handler = async (event) => {
  const started = Date.now();
  const timestamp = new Date().toISOString();

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        Allow: "GET",
      },
      body: JSON.stringify({
        ok: false,
        env_check: false,
        db_connection_check: false,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: "Method Not Allowed",
      } satisfies TickResponse),
    };
  }

  const cronSecret = process.env.CRON_SECRET;
  const authorizationHeader =
    event.headers.authorization ??
    (event.headers as Record<string, string | undefined>).Authorization;
  const bearer = getBearerToken(authorizationHeader);
  const querySecret = event.queryStringParameters?.key ?? null;

  if (!cronSecret || (bearer !== cronSecret && querySecret !== cronSecret)) {
    return json(401, {
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
  const env_check = Boolean(supabaseUrl) && Boolean(serviceRoleKey);

  console.log("tick env check", {
    supabase_url_exists: Boolean(supabaseUrl),
    supabase_service_role_key_exists: Boolean(serviceRoleKey),
  });

  if (!env_check) {
    return json(500, {
      ok: false,
      env_check,
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
    const dbTest = await supabase.from("rounds").select("id", { head: true }).limit(1);
    const db_connection_check = !dbTest.error;

    if (!db_connection_check) {
      return json(502, {
        ok: false,
        env_check,
        db_connection_check,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: dbTest.error?.message ?? "DB connectivity check failed",
      });
    }

    const countResult = await supabase.from("rounds").select("id", { count: "exact", head: true });
    if (countResult.error) {
      return json(502, {
        ok: false,
        env_check,
        db_connection_check,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        error: countResult.error.message,
      });
    }

    return json(200, {
      ok: true,
      env_check,
      db_connection_check,
      round_count: countResult.count ?? 0,
      timestamp,
      duration_ms: Date.now() - started,
    });
  } catch (error: any) {
    return json(502, {
      ok: false,
      env_check,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      error: error?.message ?? "DB check failed",
    });
  }
};
