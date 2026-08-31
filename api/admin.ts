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

type FixtureInsertRow = {
  round_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_utc?: string;
  result: "home_win" | "away_win" | "draw" | "not_set";
  winning_team_id: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOUR_RE = /^#[0-9a-f]{6}$/i;
const FPL_BASE = "https://fantasy.premierleague.com/api";
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 6;

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

function generateInviteCode() {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

async function findLeagueByJoinCode(
  supabase: AuthedContext["supabase"],
  joinCode: string
) {
  return await supabase
    .from("leagues")
    .select("id")
    .eq("join_code", joinCode)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
}

async function resolveFounderJoinCode(
  supabase: AuthedContext["supabase"],
  isPublic: boolean,
  rawJoinCode: unknown
) {
  const normalizedJoinCode =
    typeof rawJoinCode === "string" ? rawJoinCode.trim().toUpperCase() : "";
  if (isPublic) {
    return { ok: true as const, joinCode: null };
  }

  if (normalizedJoinCode) {
    const { data: existingLeague, error } = await findLeagueByJoinCode(supabase, normalizedJoinCode);
    if (error) {
      return {
        ok: false as const,
        status: 502,
        body: {
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      };
    }
    if (existingLeague) {
      return {
        ok: false as const,
        status: 409,
        body: { error: "Invite code already exists" },
      };
    }
    return { ok: true as const, joinCode: normalizedJoinCode };
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const generatedJoinCode = generateInviteCode();
    const { data: existingLeague, error } = await findLeagueByJoinCode(supabase, generatedJoinCode);
    if (error) {
      return {
        ok: false as const,
        status: 502,
        body: {
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      };
    }
    if (!existingLeague) {
      return { ok: true as const, joinCode: generatedJoinCode };
    }
  }

  return {
    ok: false as const,
    status: 500,
    body: { error: "Failed to generate a unique invite code" },
  };
}

async function fetchFplJson<T>(path: string): Promise<T> {
  const response = await fetch(`${FPL_BASE}${path}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome Safari",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://fantasy.premierleague.com/",
      Origin: "https://fantasy.premierleague.com",
    },
  });
  if (!response.ok) {
    throw new Error(`FPL request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function getRoundDeadline(startDateUtc: string) {
  const roundDeadline = new Date(startDateUtc);
  if (Number.isNaN(roundDeadline.getTime())) {
    throw new Error("start_date_utc must be a valid ISO date");
  }
  roundDeadline.setHours(17, 0, 0, 0);
  return roundDeadline.toISOString();
}

async function createFounderLeague(ctx: AuthedContext, payload: any, res: Res) {
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const startDateUtc =
    typeof payload?.start_date_utc === "string" ? payload.start_date_utc.trim() : "";
  const fplStartEvent = payload?.fpl_start_event;
  const isPublic = payload?.is_public === true;

  if (!name || !startDateUtc || typeof fplStartEvent !== "number") {
    return sendJson(res, 400, {
      error: "Missing required fields: name, start_date_utc, fpl_start_event",
    });
  }

  const joinCodeResult = await resolveFounderJoinCode(ctx.supabase, isPublic, payload?.join_code);
  if (!joinCodeResult.ok) {
    return sendJson(res, joinCodeResult.status, joinCodeResult.body);
  }
  const joinCode = joinCodeResult.joinCode;

  const leagueId = crypto.randomUUID();
  const round1Id = crypto.randomUUID();

  const { error: leagueInsertError } = await ctx.supabase
    .from("leagues")
    .insert({
      id: leagueId,
      name,
      status: "upcoming",
      current_round: 1,
      start_date_utc: startDateUtc,
      fpl_start_event: fplStartEvent,
      is_public: isPublic,
      is_test: false,
      join_code: joinCode,
      created_by: ctx.userId,
      managed_theme: null,
    })
  if (leagueInsertError) {
    return sendJson(res, 502, {
      error: leagueInsertError.message,
      code: leagueInsertError.code,
      details: leagueInsertError.details,
      hint: leagueInsertError.hint,
    });
  }

  const { error: membershipError } = await ctx.supabase.from("memberships").insert({
    league_id: leagueId,
    player_id: ctx.userId,
    role: "owner",
    is_active: true,
  });
  if (membershipError) {
    return sendJson(res, 502, {
      error: membershipError.message,
      code: membershipError.code,
      details: membershipError.details,
      hint: membershipError.hint,
    });
  }

  const roundDeadlineIso = getRoundDeadline(startDateUtc);
  const { data: round, error: roundError } = await ctx.supabase
    .from("rounds")
    .insert({
      id: round1Id,
      league_id: leagueId,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: roundDeadlineIso,
      status: "upcoming",
    })
    .select("*")
    .maybeSingle();
  if (roundError) {
    return sendJson(res, 502, {
      error: roundError.message,
      code: roundError.code,
      details: roundError.details,
      hint: roundError.hint,
    });
  }

  const bootstrap = await fetchFplJson<{
    teams?: Array<{ id: number; name: string; short_name: string }>;
  }>("/bootstrap-static/");
  const fplTeams = bootstrap.teams ?? [];
  const teamRows = fplTeams.map((team) => {
    const code = String(team.short_name ?? "").toUpperCase();
    return {
      id: crypto.randomUUID(),
      league_id: leagueId,
      name: team.name,
      code,
      logo_url: code ? `https://via.placeholder.com/96?text=${code}` : undefined,
      fpl_team_id: team.id,
    };
  });

  if (teamRows.length) {
    const { error: teamError } = await ctx.supabase.from("teams").insert(
      teamRows.map(({ fpl_team_id: _fplTeamId, ...row }) => row)
    );
    if (teamError) {
      return sendJson(res, 502, {
        error: teamError.message,
        code: teamError.code,
        details: teamError.details,
        hint: teamError.hint,
      });
    }
  }

  const teamByFplId = new Map<number, { id: string }>(
    teamRows.map((row) => [row.fpl_team_id, { id: row.id }])
  );

  const fixtures = await fetchFplJson<
    Array<{
      team_h: number;
      team_a: number;
      kickoff_time?: string | null;
      finished?: boolean;
      team_h_score?: number | null;
      team_a_score?: number | null;
    }>
  >(`/fixtures/?event=${fplStartEvent}`);

  const fixtureRows: FixtureInsertRow[] = [];
  for (const fixture of fixtures) {
    const home = teamByFplId.get(fixture.team_h);
    const away = teamByFplId.get(fixture.team_a);
    if (!home || !away) continue;

    const result =
      fixture.finished &&
      fixture.team_h_score != null &&
      fixture.team_a_score != null
        ? fixture.team_h_score > fixture.team_a_score
          ? "home_win"
          : fixture.team_a_score > fixture.team_h_score
          ? "away_win"
          : "draw"
        : "not_set";

    fixtureRows.push({
      round_id: round1Id,
      home_team_id: home.id,
      away_team_id: away.id,
      kickoff_utc: fixture.kickoff_time ?? undefined,
      result,
      winning_team_id:
        result === "home_win" ? home.id : result === "away_win" ? away.id : null,
    });
  }

  if (fixtureRows.length) {
    const { error: fixtureError } = await ctx.supabase.from("fixtures").upsert(fixtureRows, {
      ignoreDuplicates: true,
      onConflict: "round_id,home_team_id,away_team_id",
    });
    if (fixtureError) {
      return sendJson(res, 502, {
        error: fixtureError.message,
        code: fixtureError.code,
        details: fixtureError.details,
        hint: fixtureError.hint,
      });
    }
  }

  const { data: league, error: createdLeagueError } = await ctx.supabase
    .from("leagues")
    .select(
      "id, name, created_by, created_at, is_public, is_test, join_code, fpl_start_event, start_date_utc, current_round, status, managed_theme, deleted_at"
    )
    .eq("id", leagueId)
    .maybeSingle();
  if (createdLeagueError) {
    return sendJson(res, 502, {
      error: createdLeagueError.message,
      code: createdLeagueError.code,
      details: createdLeagueError.details,
      hint: createdLeagueError.hint,
    });
  }

  return sendJson(res, 200, {
    league,
    round,
  });
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

    if (action === "create-founder-league") {
      return await createFounderLeague(ctx, payload, res);
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
