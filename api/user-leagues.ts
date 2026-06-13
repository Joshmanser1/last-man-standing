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

  const userId = typeof payload?.user_id === "string" ? payload.user_id : "";
  if (!userId) return sendJson(res, 400, { error: "Missing required field: user_id" });

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: memberships, error: membershipError } = await supabase
      .from("memberships")
      .select("league_id")
      .eq("player_id", userId);
    if (membershipError) {
      return sendJson(res, 502, {
        error: membershipError.message,
        code: membershipError.code,
        details: membershipError.details,
        hint: membershipError.hint,
      });
    }

    const { data: ownedLeagues, error: ownedError } = await supabase
      .from("leagues")
      .select("id, name, created_by, created_at, is_public, join_code, fpl_start_event, start_date_utc, current_round, status")
      .eq("created_by", userId)
      .is("deleted_at", null);
    if (ownedError) {
      return sendJson(res, 502, {
        error: ownedError.message,
        code: ownedError.code,
        details: ownedError.details,
        hint: ownedError.hint,
      });
    }

    const leagueIds = Array.from(
      new Set([
        ...(memberships ?? []).map((m: any) => m.league_id).filter(Boolean),
        ...(ownedLeagues ?? []).map((l: any) => l.id).filter(Boolean),
      ])
    ) as string[];

    if (leagueIds.length === 0) {
      return sendJson(res, 200, []);
    }

    const { data: leagues, error: leaguesError } = await supabase
      .from("leagues")
      .select("id, name, created_by, created_at, is_public, join_code, fpl_start_event, start_date_utc, current_round, status")
      .in("id", leagueIds)
      .is("deleted_at", null);
    if (leaguesError) {
      return sendJson(res, 502, {
        error: leaguesError.message,
        code: leaguesError.code,
        details: leaguesError.details,
        hint: leaguesError.hint,
      });
    }

    const merged = new Map<string, any>();
    (ownedLeagues ?? []).forEach((league: any) => merged.set(league.id, league));
    (leagues ?? []).forEach((league: any) => merged.set(league.id, league));

    return sendJson(
      res,
      200,
      Array.from(merged.values()).sort(
        (a: any, b: any) =>
          new Date(a?.created_at ?? 0).getTime() - new Date(b?.created_at ?? 0).getTime()
      )
    );
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to load user leagues" });
  }
}
