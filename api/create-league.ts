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
  const createdBy = typeof payload?.created_by === "string" ? payload.created_by : null;

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

    if (createdBy && !isPublic) {
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

    return sendJson(res, 200, league);
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to create league" });
  }
}
