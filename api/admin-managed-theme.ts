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

  const hasManagedThemeKey = isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, "managed_theme");

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
      .select("id, managed_theme")
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

    if (!hasManagedThemeKey) {
      return sendJson(res, 200, {
        league_id: league.id,
        managed_theme: league.managed_theme ?? null,
      });
    }

    const validation = validateManagedTheme(payload.managed_theme);
    if (!validation.ok) {
      return sendJson(res, 400, { error: validation.error });
    }

    const { data: updatedLeague, error: updateError } = await supabase
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
  } catch (err: any) {
    return sendJson(res, 502, {
      error: err?.message ?? "Failed to manage league branding",
    });
  }
}
