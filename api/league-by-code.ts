import { createClient } from "@supabase/supabase-js";

type Req = {
  method?: string;
  body?: unknown;
};

type Res = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

type ManagedThemePreview = {
  hostName: string;
  displayName?: string;
  hostLogoUrl?: string;
  primaryColour?: string;
  secondaryColour?: string;
  eyebrow?: string;
  tagline?: string;
};

function sendJson(res: Res, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Managed branding is presentation-only. Keep the public response independent
// of the unrestricted JSON object stored on the league.
function toManagedThemePreview(value: unknown): ManagedThemePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const theme = value as Record<string, unknown>;
  const hostName = cleanString(theme.hostName);
  if (theme.enabled !== true || !hostName) return null;

  return {
    hostName,
    displayName: cleanString(theme.displayName),
    hostLogoUrl: cleanString(theme.hostLogoUrl),
    primaryColour: cleanString(theme.primaryColour),
    secondaryColour: cleanString(theme.secondaryColour),
    eyebrow: cleanString(theme.eyebrow),
    tagline: cleanString(theme.tagline),
  };
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

  const joinCode = typeof payload?.join_code === "string" ? payload.join_code.trim() : "";
  if (!joinCode) return sendJson(res, 400, { error: "Missing required field: join_code" });

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: league, error } = await supabase
      .from("leagues")
      .select("id, name, current_round, managed_theme")
      .eq("join_code", joinCode)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      return sendJson(res, 502, {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    }

    if (!league?.id) {
      return sendJson(res, 404, { error: "League not found for join_code" });
    }

    const currentRoundNumber =
      typeof league.current_round === "number" && Number.isFinite(league.current_round)
        ? league.current_round
        : 1;
    const { data: round, error: roundError } = await supabase
      .from("rounds")
      .select("round_number, pick_deadline_utc")
      .eq("league_id", league.id)
      .eq("round_number", currentRoundNumber)
      .maybeSingle();

    if (roundError) {
      return sendJson(res, 502, { error: "Failed to load league preview" });
    }

    // This is deliberately the complete public contract for an invite landing page.
    return sendJson(res, 200, {
      league: {
        name: league.name,
        current_round: round?.round_number ?? currentRoundNumber,
        pick_deadline_utc: round?.pick_deadline_utc ?? null,
        managed_theme: toManagedThemePreview(league.managed_theme),
      },
    });
  } catch (err: any) {
    return sendJson(res, 502, { error: "Failed to load league preview" });
  }
}
