import { createClient } from "@supabase/supabase-js";

type Req = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type Res = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function sendJson(res: Res, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function getBearerToken(req: Req): string | null {
  const authHeader =
    req.headers?.authorization ??
    (req.headers as Record<string, string | string[] | undefined> | undefined)?.Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export default async function handler(req: Req, res: Res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  let payload: any = req.body ?? null;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return sendJson(res, 400, { error: "Invalid JSON body" });
    }
  }

  const leagueId = typeof payload?.league_id === "string" ? payload.league_id : "";
  if (!leagueId) return sendJson(res, 400, { error: "Missing required field: league_id" });

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY" });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bearerToken = getBearerToken(req);
    if (!bearerToken) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(bearerToken);
    if (authError || !user?.id) {
      return sendJson(res, 401, { error: "Unauthorized" });
    }

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, created_by")
      .eq("id", leagueId)
      .is("deleted_at", null)
      .maybeSingle();
    if (leagueError) {
      return sendJson(res, 502, {
        error: leagueError.message,
        code: leagueError.code,
        details: leagueError.details,
        hint: leagueError.hint,
      });
    }
    if (!league?.id) {
      return sendJson(res, 404, { error: "League not found" });
    }

    const isOwner = league.created_by === user.id;
    if (!isOwner) {
      const { data: membership, error: membershipError } = await supabase
        .from("memberships")
        .select("league_id")
        .eq("league_id", leagueId)
        .eq("player_id", user.id)
        .maybeSingle();
      if (membershipError) {
        return sendJson(res, 502, {
          error: membershipError.message,
          code: membershipError.code,
          details: membershipError.details,
          hint: membershipError.hint,
        });
      }
      if (!membership?.league_id) {
        return sendJson(res, 403, { error: "Forbidden" });
      }
    }

    const { data, error } = await supabase
      .from("picks")
      .select("id, league_id, round_id, player_id, team_id, status, reason")
      .eq("league_id", leagueId);

    if (error) {
      return sendJson(res, 502, {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }

    return sendJson(res, 200, data ?? []);
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to load league picks" });
  }
}
