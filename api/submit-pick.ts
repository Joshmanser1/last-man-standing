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

  const leagueId = typeof payload?.league_id === "string" ? payload.league_id : "";
  const roundId = typeof payload?.round_id === "string" ? payload.round_id : "";
  const playerId = typeof payload?.player_id === "string" ? payload.player_id : "";
  const teamId = typeof payload?.team_id === "string" ? payload.team_id : "";

  if (!leagueId || !roundId || !playerId || !teamId) {
    return sendJson(res, 400, {
      error: "Missing required fields: league_id, round_id, player_id, team_id",
    });
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
  } catch (err: any) {
    return sendJson(res, 502, { error: err?.message ?? "Failed to save pick" });
  }
}
