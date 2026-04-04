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

  const leagueIdInput = typeof payload?.league_id === "string" ? payload.league_id : "";
  const joinCode = typeof payload?.join_code === "string" ? payload.join_code : "";
  const playerId = typeof payload?.player_id === "string" ? payload.player_id : "";
  const role = typeof payload?.role === "string" ? payload.role : "player";

  if ((!leagueIdInput && !joinCode) || !playerId) {
    return sendJson(res, 400, { error: "Missing required fields: league_id or join_code, player_id" });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return sendJson(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  try {
    const supabase = createClient<any>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let leagueId = leagueIdInput;
    if (!leagueId) {
      const { data: league, error: leagueErr } = await supabase
        .from("leagues")
        .select("id")
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
    }

    const { data: existing, error: existingErr } = await supabase
      .from("memberships")
      .select("id")
      .eq("league_id", leagueId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (existingErr) {
      return sendJson(res, 502, {
        error: existingErr.message,
        code: existingErr.code,
        details: existingErr.details,
        hint: existingErr.hint,
      });
    }

    const { data, error } = existing
      ? await supabase
          .from("memberships")
          .update({ is_active: true })
          .eq("league_id", leagueId)
          .eq("player_id", playerId)
          .select("*")
          .maybeSingle()
      : await supabase
          .from("memberships")
          .insert({
            league_id: leagueId,
            player_id: playerId,
            role,
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

    return sendJson(res, 200, data);
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to join league" });
  }
}
