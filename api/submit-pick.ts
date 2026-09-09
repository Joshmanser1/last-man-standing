import { createClient } from "@supabase/supabase-js";

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
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
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function getSupabaseServerEnv() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    throw new Error("Server configuration is incomplete.");
  }
  return { supabaseUrl, serviceRoleKey, anonKey };
}

async function getAuthenticatedUserId(req: Req): Promise<string | null> {
  const bearerToken = getBearerToken(req);
  if (!bearerToken) return null;

  const { supabaseUrl, anonKey } = getSupabaseServerEnv();
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(bearerToken);
  return error || !user?.id ? null : user.id;
}

async function isSiteAdminUser(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await supabase
    .from("site_admins")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data?.user_id;
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
  const roundId = typeof payload?.round_id === "string" ? payload.round_id : "";
  const teamId = typeof payload?.team_id === "string" ? payload.team_id : "";

  if (!leagueId || !roundId || !teamId) {
    return sendJson(res, 400, {
      error: "Missing required fields: league_id, round_id, team_id",
    });
  }

  try {
    const { supabaseUrl, serviceRoleKey } = getSupabaseServerEnv();
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const playerId = await getAuthenticatedUserId(req);
    if (!playerId) {
      return sendJson(res, 401, { error: "You must be logged in to submit a pick." });
    }

    const { data: league, error: leagueError } = await supabase
      .from("leagues")
      .select("id, current_round, status, is_test, deleted_at")
      .eq("id", leagueId)
      .maybeSingle();
    if (leagueError) throw leagueError;
    if (!league?.id || league.deleted_at || league.status === "completed") {
      return sendJson(res, 404, { error: "League not found or unavailable." });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId)
      .eq("is_active", true)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership?.id) {
      return sendJson(res, 403, { error: "You are not an active member of this league." });
    }

    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .select("id, league_id, round_number, pick_deadline_utc, status")
      .eq("id", roundId)
      .maybeSingle();
    if (roundError) throw roundError;
    if (
      !round?.id ||
      round.league_id !== leagueId ||
      round.round_number !== league.current_round
    ) {
      return sendJson(res, 400, { error: "Picks are only available for the current league round." });
    }
    if (round.status === "locked" || round.status === "completed") {
      return sendJson(res, 409, { error: "This round is locked. Picks are closed." });
    }

    const isAuthorizedTestBypass = league.is_test === true && (await isSiteAdminUser(supabase, playerId));
    const deadline = round.pick_deadline_utc ? Date.parse(round.pick_deadline_utc) : Number.NaN;
    if (!isAuthorizedTestBypass && (Number.isNaN(deadline) || deadline <= Date.now())) {
      return sendJson(res, 409, { error: "The pick deadline has passed." });
    }

    const { data: team, error: teamError } = await supabase
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .eq("league_id", leagueId)
      .maybeSingle();
    if (teamError) throw teamError;
    if (!team?.id) {
      return sendJson(res, 400, { error: "That team is not available in this league." });
    }

    const { data: reusedPick, error: reuseError } = await supabase
      .from("picks")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId)
      .eq("team_id", teamId)
      .neq("round_id", roundId)
      .limit(1)
      .maybeSingle();
    if (reuseError) throw reuseError;
    if (reusedPick?.id) {
      return sendJson(res, 409, { error: "You have already used this team in this league." });
    }

    const { data, error } = await supabase
      .from("picks")
      .upsert(
        {
          league_id: leagueId,
          round_id: roundId,
          player_id: playerId,
          team_id: teamId,
          status: "pending",
          reason: null,
        },
        { onConflict: "round_id,player_id" }
      )
      .select("*")
      .maybeSingle();

    if (error) {
      return sendJson(res, 502, {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }

    return sendJson(res, 200, data);
  } catch {
    return sendJson(res, 502, { error: "Failed to save pick" });
  }
}
