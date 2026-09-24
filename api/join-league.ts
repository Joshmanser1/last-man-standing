import { validDisplayName } from "../src/lib/displayName";
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
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

function getSupabaseServerEnv() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Server configuration is incomplete.");
  }

  return { supabaseUrl, serviceRoleKey, anonKey };
}

function createServiceRoleClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseServerEnv();
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getAuthenticatedUser(req: Req) {
  const { supabaseUrl, anonKey } = getSupabaseServerEnv();
  if (!anonKey) return null;

  const bearerToken = getBearerToken(req);
  if (!bearerToken) return null;

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(bearerToken);

  if (error || !user?.id) return null;
  return { id: user.id, email: user.email ?? null };
}

async function isSiteAdminUser(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string
) {
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

  const leagueIdInput = typeof payload?.league_id === "string" ? payload.league_id : "";
  const joinCode = typeof payload?.join_code === "string" ? payload.join_code : "";
  if (!leagueIdInput && !joinCode) {
    return sendJson(res, 400, { error: "Missing required fields: league_id or join_code" });
  }

  try {
    const supabase = createServiceRoleClient();
    const authenticatedUser = await getAuthenticatedUser(req);
    if (!authenticatedUser) {
      return sendJson(res, 401, { error: "You must be logged in to join a private league." });
    }
    const authenticatedUserId = authenticatedUser.id;
    const submittedDisplayName =
      typeof payload?.display_name === "string" ? payload.display_name.trim() : "";
    if (submittedDisplayName && !validDisplayName(submittedDisplayName)) {
      return sendJson(res, 422, {
        error: "Choose a different display name before joining this league.",
        code: "invalid_display_name",
      });
    }

    const { data: profile, error: profileLookupError } = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .eq("id", authenticatedUserId)
      .maybeSingle();
    if (profileLookupError) {
      return sendJson(res, 502, {
        error: profileLookupError.message,
        code: profileLookupError.code,
        details: profileLookupError.details,
        hint: profileLookupError.hint,
      });
    }

    if (!validDisplayName(profile?.display_name)) {
      const displayName = submittedDisplayName;
      if (!displayName) {
        return sendJson(res, 422, {
          error: "Choose a display name before joining this league.",
          code: "profile_required",
        });
      }

      const profilePayload: Record<string, string> = {
        id: authenticatedUserId,
        display_name: displayName,
      };
      if (!profile?.email && authenticatedUser.email) {
        profilePayload.email = authenticatedUser.email;
      }

      const { error: profileUpsertError } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" });
      if (profileUpsertError) {
        return sendJson(res, 502, {
          error: profileUpsertError.message,
          code: profileUpsertError.code,
          details: profileUpsertError.details,
          hint: profileUpsertError.hint,
        });
      }
    }

    const isSiteAdmin = await isSiteAdminUser(supabase, authenticatedUserId);

    let leagueId = leagueIdInput;
    let targetLeague: any = null;
    if (!leagueId) {
      const { data: league, error: leagueErr } = await supabase
        .from("leagues")
        .select("id, is_public, is_test, status, deleted_at")
        .eq("join_code", joinCode)
        .maybeSingle();
      if (leagueErr) {
        return sendJson(res, 502, {
          error: leagueErr.message,
          code: leagueErr.code,
          details: leagueErr.details,
          hint: leagueErr.hint,
        });
      }
      if (!league?.id) {
        return sendJson(res, 404, { error: "League not found for join_code" });
      }
      leagueId = league.id as string;
      targetLeague = league;
    } else {
      const { data: league, error: leagueErr } = await supabase
        .from("leagues")
        .select("id, is_public, is_test, status, deleted_at")
        .eq("id", leagueId)
        .maybeSingle();
      if (leagueErr) {
        return sendJson(res, 502, {
          error: leagueErr.message,
          code: leagueErr.code,
          details: leagueErr.details,
          hint: leagueErr.hint,
        });
      }
      if (!league?.id) {
        return sendJson(res, 404, { error: "League not found" });
      }
      targetLeague = league;
    }

    if (!targetLeague?.is_test) {
      if (targetLeague?.deleted_at || targetLeague?.status === "completed") {
        return sendJson(res, 409, {
          error: "Joining is closed because Round 1 has already started.",
        });
      }

      const { data: round1, error: roundErr } = await supabase
        .from("rounds")
        .select("id, status, pick_deadline_utc")
        .eq("league_id", leagueId)
        .eq("round_number", 1)
        .maybeSingle();
      if (roundErr) {
        return sendJson(res, 502, {
          error: roundErr.message,
          code: roundErr.code,
          details: roundErr.details,
          hint: roundErr.hint,
        });
      }

      const round1Closed =
        round1?.status === "locked" ||
        round1?.status === "completed" ||
        (!!round1?.pick_deadline_utc && Date.parse(round1.pick_deadline_utc) <= Date.now());
      if (round1Closed) {
        return sendJson(res, 409, {
          error: "Joining is closed because Round 1 has already started.",
        });
      }
    }

    const { data: existing, error: existingErr } = await supabase
      .from("memberships")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", authenticatedUserId)
      .maybeSingle();
    if (existingErr) {
      return sendJson(res, 502, {
        error: existingErr.message,
        code: existingErr.code,
        details: existingErr.details,
        hint: existingErr.hint,
      });
    }

    if (!existing && targetLeague?.is_test !== true && !isSiteAdmin) {
      const { data: otherMemberships, error: otherErr } = await supabase
        .from("memberships")
        .select("league_id, role, leagues!inner(is_public)")
        .eq("player_id", authenticatedUserId)
        .eq("is_active", true);
      if (otherErr) {
        return sendJson(res, 502, {
          error: otherErr.message,
          code: otherErr.code,
          details: otherErr.details,
          hint: otherErr.hint,
        });
      }

      const hasOtherPrivateNonOwner = (otherMemberships ?? []).some((m: any) => {
        if (m.league_id === leagueId) return false;
        if (m.role === "owner") return false;
        return m.leagues?.is_public !== true;
      });
      if (hasOtherPrivateNonOwner) {
        return sendJson(res, 409, {
          error: "Already an active member of another private league",
        });
      }
    }

    const { data, error } = existing
      ? await supabase
          .from("memberships")
          .update({ is_active: true })
          .eq("league_id", leagueId)
          .eq("player_id", authenticatedUserId)
          .select("*")
          .maybeSingle()
      : await supabase
          .from("memberships")
          .insert({
          league_id: leagueId,
          player_id: authenticatedUserId,
          role: "player",
            is_active: true,
          })
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

    return sendJson(res, 200, { ...data, membership_created: !existing });
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to join league" });
  }
}
