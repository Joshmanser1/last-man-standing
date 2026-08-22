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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const leagueId = typeof payload?.league_id === "string" ? payload.league_id.trim() : "";
  if (!leagueId || !UUID_RE.test(leagueId)) {
    return sendJson(res, 400, { error: "league_id must be a valid UUID" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey =
    (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return sendJson(res, 500, {
      error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY",
    });
  }

  try {
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

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: siteAdmin, error: siteAdminError } = await supabase
      .from("site_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (siteAdminError) {
      return sendJson(res, 502, {
        error: siteAdminError.message,
        code: siteAdminError.code,
        details: siteAdminError.details,
        hint: siteAdminError.hint,
      });
    }
    if (!siteAdmin?.user_id) {
      return sendJson(res, 403, { error: "Forbidden" });
    }

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select(
        "id, name, created_by, created_at, is_public, is_test, join_code, fpl_start_event, start_date_utc, current_round, status, managed_theme, deleted_at"
      )
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

    const currentRoundNumber =
      typeof league.current_round === "number" ? (league.current_round as number) : null;

    const [{ data: currentRound, error: roundError }, { data: teams, error: teamsError }] =
      await Promise.all([
        currentRoundNumber == null
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from("rounds")
              .select("*")
              .eq("league_id", leagueId)
              .eq("round_number", currentRoundNumber)
              .maybeSingle(),
        supabase.from("teams").select("*").eq("league_id", leagueId).order("name"),
      ]);

    if (roundError) {
      return sendJson(res, 502, {
        error: roundError.message,
        code: roundError.code,
        details: roundError.details,
        hint: roundError.hint,
      });
    }
    if (teamsError) {
      return sendJson(res, 502, {
        error: teamsError.message,
        code: teamsError.code,
        details: teamsError.details,
        hint: teamsError.hint,
      });
    }

    let currentRoundPicks: any[] = [];
    if (currentRound?.id) {
      const { data: picks, error: picksError } = await supabase
        .from("picks")
        .select("*")
        .eq("round_id", currentRound.id);
      if (picksError) {
        return sendJson(res, 502, {
          error: picksError.message,
          code: picksError.code,
          details: picksError.details,
          hint: picksError.hint,
        });
      }
      currentRoundPicks = picks ?? [];
    }

    return sendJson(res, 200, {
      league,
      current_round: currentRound ?? null,
      teams: teams ?? [],
      current_round_picks: currentRoundPicks,
    });
  } catch (err: any) {
    return sendJson(res, 502, {
      error: err?.message ?? "Failed to load admin league state",
    });
  }
}
