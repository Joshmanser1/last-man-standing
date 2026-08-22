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

type AuthedContext = {
  supabase: ReturnType<typeof createClient>;
  userId: string;
};

type ValidationResult =
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOUR_RE = /^#[0-9a-f]{6}$/i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanOptionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function validateLeagueId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

function validateManagedTheme(value: unknown): ValidationResult {
  if (value === null) return { ok: true, value: null };
  if (!isRecord(value)) {
    return { ok: false, error: "managed_theme must be an object or null" };
  }

  if (typeof value.enabled !== "boolean") {
    return { ok: false, error: "managed_theme.enabled must be a boolean" };
  }

  if (value.managed !== undefined && typeof value.managed !== "boolean") {
    return { ok: false, error: "managed_theme.managed must be a boolean when provided" };
  }

  const hostName = cleanOptionalString(value.hostName, 80);
  const hostLogoUrl = cleanOptionalString(value.hostLogoUrl, 500);
  const displayName = cleanOptionalString(value.displayName, 120);
  const primaryColour = cleanOptionalString(value.primaryColour, 7);
  const secondaryColour = cleanOptionalString(value.secondaryColour, 7);
  const eyebrow = cleanOptionalString(value.eyebrow, 80);
  const tagline = cleanOptionalString(value.tagline, 200);

  if (value.enabled === true && !hostName) {
    return { ok: false, error: "managed_theme.hostName is required when branding is enabled" };
  }

  if (hostLogoUrl) {
    try {
      const url = new URL(hostLogoUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, error: "managed_theme.hostLogoUrl must use http or https" };
      }
    } catch {
      return { ok: false, error: "managed_theme.hostLogoUrl must be a valid URL" };
    }
  }

  if (primaryColour && !HEX_COLOUR_RE.test(primaryColour)) {
    return { ok: false, error: "managed_theme.primaryColour must be a valid hex colour" };
  }

  if (secondaryColour && !HEX_COLOUR_RE.test(secondaryColour)) {
    return { ok: false, error: "managed_theme.secondaryColour must be a valid hex colour" };
  }

  const next: Record<string, unknown> = {
    enabled: value.enabled,
  };

  if (value.managed !== undefined) next.managed = value.managed;
  if (hostName) next.hostName = hostName;
  if (hostLogoUrl) next.hostLogoUrl = hostLogoUrl;
  if (displayName) next.displayName = displayName;
  if (primaryColour) next.primaryColour = primaryColour;
  if (secondaryColour) next.secondaryColour = secondaryColour;
  if (eyebrow) next.eyebrow = eyebrow;
  if (tagline) next.tagline = tagline;

  return { ok: true, value: next };
}

async function authenticateUser(req: Req, res: Res): Promise<AuthedContext | null> {
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey =
    (process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    sendJson(res, 500, {
      error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY",
    });
    return null;
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(bearerToken);
  if (authError || !user?.id) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    supabase,
    userId: user.id,
  };
}

async function requireSiteAdmin(
  ctx: AuthedContext,
  res: Res
): Promise<{ ok: true; isSiteAdmin: boolean } | { ok: false }> {
  const { data: siteAdmin, error: siteAdminError } = await ctx.supabase
    .from("site_admins")
    .select("user_id")
    .eq("user_id", ctx.userId)
    .limit(1)
    .maybeSingle();

  if (siteAdminError) {
    sendJson(res, 502, {
      error: siteAdminError.message,
      code: siteAdminError.code,
      details: siteAdminError.details,
      hint: siteAdminError.hint,
    });
    return { ok: false };
  }

  return { ok: true, isSiteAdmin: !!siteAdmin?.user_id };
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

  const action = typeof payload?.action === "string" ? payload.action.trim() : "";
  if (!action) {
    return sendJson(res, 400, { error: "Missing required field: action" });
  }

  const ctx = await authenticateUser(req, res);
  if (!ctx) return;

  try {
    if (action === "site-admin-status") {
      const adminResult = await requireSiteAdmin(ctx, res);
      if (!adminResult.ok) return;
      return sendJson(res, 200, { is_site_admin: adminResult.isSiteAdmin });
    }

    const adminResult = await requireSiteAdmin(ctx, res);
    if (!adminResult.ok) return;
    if (!adminResult.isSiteAdmin) {
      return sendJson(res, 403, { error: "Forbidden" });
    }

    if (action === "list-leagues") {
      const { data: leagues, error: leaguesError } = await ctx.supabase
        .from("leagues")
        .select(
          "id, name, created_by, created_at, is_public, is_test, join_code, fpl_start_event, start_date_utc, current_round, status, managed_theme, deleted_at"
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: true });
      if (leaguesError) {
        return sendJson(res, 502, {
          error: leaguesError.message,
          code: leaguesError.code,
          details: leaguesError.details,
          hint: leaguesError.hint,
        });
      }
      return sendJson(res, 200, leagues ?? []);
    }

    const leagueId = validateLeagueId(payload?.league_id);
    if (!leagueId) {
      return sendJson(res, 400, { error: "league_id must be a valid UUID" });
    }

    const { data: league, error: leagueError } = await ctx.supabase
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

    if (action === "get-managed-theme") {
      return sendJson(res, 200, {
        league_id: league.id,
        managed_theme: league.managed_theme ?? null,
      });
    }

    if (action === "save-managed-theme") {
      const validation = validateManagedTheme(payload?.managed_theme);
      if (!validation.ok) {
        return sendJson(res, 400, { error: validation.error });
      }

      const { data: updatedLeague, error: updateError } = await ctx.supabase
        .from("leagues")
        .update({ managed_theme: validation.value })
        .eq("id", leagueId)
        .select("id, managed_theme")
        .maybeSingle();
      if (updateError) {
        return sendJson(res, 502, {
          error: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
        });
      }

      return sendJson(res, 200, {
        league_id: updatedLeague?.id ?? leagueId,
        managed_theme: updatedLeague?.managed_theme ?? null,
      });
    }

    if (action === "league-state") {
      const currentRoundNumber =
        typeof league.current_round === "number" ? (league.current_round as number) : null;

      const [{ data: currentRound, error: roundError }, { data: teams, error: teamsError }] =
        await Promise.all([
          currentRoundNumber == null
            ? Promise.resolve({ data: null, error: null })
            : ctx.supabase
                .from("rounds")
                .select("*")
                .eq("league_id", leagueId)
                .eq("round_number", currentRoundNumber)
                .maybeSingle(),
          ctx.supabase.from("teams").select("*").eq("league_id", leagueId).order("name"),
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
        const { data: picks, error: picksError } = await ctx.supabase
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
    }

    return sendJson(res, 400, { error: `Unsupported action: ${action}` });
  } catch (err: any) {
    return sendJson(res, 502, {
      error: err?.message ?? "Admin action failed",
    });
  }
}
