import { createClient } from "@supabase/supabase-js";

const FPL_BASE = "https://fantasy.premierleague.com/api";

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

type FixtureInsertRow = {
  round_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_utc?: string;
  result: "home_win" | "away_win" | "draw" | "not_set";
  winning_team_id: string | null;
};

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

  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  const startDateUtc =
    typeof payload?.start_date_utc === "string" ? payload.start_date_utc : "";
  const fplStartEvent = payload?.fpl_start_event;
  const isPublic = typeof payload?.is_public === "boolean" ? payload.is_public : false;
  const isTest = typeof payload?.is_test === "boolean" ? payload.is_test : false;
  const createdBy = typeof payload?.created_by === "string" ? payload.created_by : null;
  const joinCode = typeof payload?.join_code === "string" ? payload.join_code.trim() : null;

  if (!name || !startDateUtc || typeof fplStartEvent !== "number") {
    return sendJson(res, 400, {
      error: "Missing required fields: name, start_date_utc, fpl_start_event",
    });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (!isPublic && joinCode) {
      const { data: existingJoinCodeLeague, error: existingJoinCodeLeagueError } =
        await supabase
          .from("leagues")
          .select("id")
          .eq("join_code", joinCode)
          .is("deleted_at", null)
          .limit(1)
          .maybeSingle();

      if (existingJoinCodeLeagueError) {
        return sendJson(res, 502, {
          error: existingJoinCodeLeagueError.message,
          code: existingJoinCodeLeagueError.code,
          details: existingJoinCodeLeagueError.details,
          hint: existingJoinCodeLeagueError.hint,
        });
      }

      if (existingJoinCodeLeague) {
        return sendJson(res, 409, {
          error: "Invite code already exists",
        });
      }
    }

    if (createdBy && !isPublic && !isTest) {
      const { data: existingOwnerMemberships, error: existingOwnerMembershipsError } = await supabase
        .from("memberships")
        .select("league_id, leagues!inner(id, is_public, deleted_at)")
        .eq("player_id", createdBy)
        .eq("role", "owner")
        .eq("is_active", true)
        .eq("leagues.is_public", false)
        .is("leagues.deleted_at", null)
        .limit(1);

      if (existingOwnerMembershipsError) {
        return sendJson(res, 502, {
          error: existingOwnerMembershipsError.message,
          code: existingOwnerMembershipsError.code,
          details: existingOwnerMembershipsError.details,
          hint: existingOwnerMembershipsError.hint,
        });
      }

      if ((existingOwnerMemberships ?? []).length > 0) {
        return sendJson(res, 409, {
          error: "User already owns an active private league",
        });
      }
    }

    const leagueId = crypto.randomUUID();
    const { data: league, error } = await supabase
      .from("leagues")
      .insert({
        id: leagueId,
        name,
        status: "upcoming",
        current_round: 1,
        start_date_utc: startDateUtc,
        fpl_start_event: fplStartEvent,
        is_public: isPublic,
        is_test: isTest,
        join_code: isPublic ? null : joinCode,
        ...(createdBy ? { created_by: createdBy } : {}),
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

    if (createdBy) {
      const { error: membershipError } = await supabase.from("memberships").insert({
        league_id: leagueId,
        player_id: createdBy,
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
    }

    const round1Id = crypto.randomUUID();
    const roundDeadline = new Date(startDateUtc);
    roundDeadline.setHours(17, 0, 0, 0);

    const { error: roundError } = await supabase.from("rounds").insert({
      id: round1Id,
      league_id: leagueId,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: roundDeadline.toISOString(),
      status: "upcoming",
    });
    if (roundError) {
      return sendJson(res, 502, {
        error: roundError.message,
        code: roundError.code,
        details: roundError.details,
        hint: roundError.hint,
      });
    }

    const bootstrap = await fetchFplJson<{ teams?: Array<{ id: number; name: string; short_name: string }> }>(
      "/bootstrap-static/"
    );
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
      const { error: teamError } = await supabase.from("teams").insert(
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
      const { error: fixtureError } = await supabase.from("fixtures").upsert(fixtureRows, {
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

    return sendJson(res, 200, league);
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to create league" });
  }
}
