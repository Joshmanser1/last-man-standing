import { createClient } from "@supabase/supabase-js";

type TickResponse = {
  ok: boolean;
  env_check: boolean;
  db_connection_check: boolean;
  round_count: number | null;
  timestamp: string;
  duration_ms: number;
  actions: Array<Record<string, unknown>>;
  processed_leagues: number;
  error?: string;
};

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
};

type Res = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

function sendJson(res: Res, status: number, body: TickResponse): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function getBearerToken(req: Req): string | null {
  const authHeader =
    req.headers.authorization ??
    (req.headers as Record<string, string | string[] | undefined>).Authorization;
  if (!authHeader || Array.isArray(authHeader)) return null;
  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export default async function handler(req: Req, res: Res) {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  const now = new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      actions: [],
      processed_leagues: 0,
      error: "Method Not Allowed",
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  const bearerToken = getBearerToken(req);
  const queryKey = typeof req.query.key === "string" ? req.query.key : null;

  if (!cronSecret || (bearerToken !== cronSecret && queryKey !== cronSecret)) {
    return sendJson(res, 401, {
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      actions: [],
      processed_leagues: 0,
      error: "Unauthorized",
    });
  }

  const supabaseUrl = (process.env.SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const envCheck = supabaseUrl.startsWith("https://") && serviceRoleKey.length > 20;
  console.log("tick env check", {
    supabase_url_exists: Boolean(supabaseUrl),
    supabase_service_role_key_exists: Boolean(serviceRoleKey),
  });

  if (!envCheck) {
    return sendJson(res, 500, {
      ok: false,
      env_check: false,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      actions: [],
      processed_leagues: 0,
      error: "Invalid SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let tickRunId: string | null = null;

  try {
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const bucketMs = 5 * 60 * 1000;
    const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
    const runKey = bucketStart.toISOString().slice(0, 16) + "Z";

    const insertResult = await supabase
      .from("tick_runs")
      .insert({ run_key: runKey })
      .select("id")
      .single();

    if (insertResult.error) {
      const message = insertResult.error.message ?? "Failed to insert tick run";
      if (insertResult.error.code === "23505") {
        return sendJson(res, 200, {
          ok: true,
          env_check: envCheck,
          db_connection_check: true,
          round_count: null,
          timestamp,
          duration_ms: Date.now() - started,
          actions: [],
          processed_leagues: 0,
          error: `Already ran for run_key=${runKey}`,
        });
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: false,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        actions: [],
        processed_leagues: 0,
        error: message,
      });
    }

    tickRunId = insertResult.data.id;
    const connectionTest = await supabase.from("rounds").select("id", { head: true }).limit(1);
    const dbConnectionCheck = !connectionTest.error;

    if (!dbConnectionCheck) {
      if (tickRunId) {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: connectionTest.error?.message ?? "DB connectivity check failed" })
          .eq("id", tickRunId);
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: dbConnectionCheck,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        actions: [],
        processed_leagues: 0,
        error: connectionTest.error?.message ?? "DB connectivity check failed",
      });
    }

    const countResult = await supabase.from("rounds").select("id", { head: true, count: "exact" });
    if (countResult.error) {
      if (tickRunId) {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: countResult.error.message })
          .eq("id", tickRunId);
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: dbConnectionCheck,
        round_count: null,
        timestamp,
        duration_ms: Date.now() - started,
        actions: [],
        processed_leagues: 0,
        error: countResult.error.message,
      });
    }

    const actions: Array<Record<string, unknown>> = [];
    let processedLeagues = 0;
    const leaguesResult = await supabase
      .from("leagues")
      .select("id, status, current_round")
      .is("deleted_at", null);

    if (leaguesResult.error) {
      if (tickRunId) {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: leaguesResult.error.message })
          .eq("id", tickRunId);
      }
      return sendJson(res, 502, {
        ok: false,
        env_check: envCheck,
        db_connection_check: dbConnectionCheck,
        round_count: countResult.count ?? 0,
        timestamp,
        duration_ms: Date.now() - started,
        actions,
        processed_leagues: processedLeagues,
        error: leaguesResult.error.message,
      });
    }

    const activeLeagues = (leaguesResult.data ?? []).filter((league) => {
      const status = league.status as string | null;
      return status == null || status === "active" || status === "running";
    });

    for (const league of activeLeagues) {
      processedLeagues += 1;
      try {
        const leagueId = league.id as string;
        const currentRoundNumber = league.current_round as number | null;
        if (currentRoundNumber == null) {
          actions.push({ league_id: leagueId, step: "skip_no_current_round" });
          continue;
        }

        const roundResult = await supabase
          .from("rounds")
          .select("id, status, pick_deadline_utc, round_number")
          .eq("league_id", leagueId)
          .eq("round_number", currentRoundNumber)
          .maybeSingle();

        if (roundResult.error) {
          actions.push({ league_id: leagueId, step: "round_lookup_error", error: roundResult.error.message });
          continue;
        }

        if (!roundResult.data) {
          actions.push({ league_id: leagueId, step: "round_missing", round_number: currentRoundNumber });
          continue;
        }

        const roundId = roundResult.data.id as string;
        let roundStatus = (roundResult.data.status as string | null) ?? "upcoming";
        const pickDeadline = roundResult.data.pick_deadline_utc ? new Date(roundResult.data.pick_deadline_utc) : null;

        if (roundStatus === "upcoming" && pickDeadline && pickDeadline.getTime() <= now.getTime()) {
          const lockRound = await supabase
            .from("rounds")
            .update({ status: "locked" })
            .eq("id", roundId)
            .eq("status", "upcoming");

          if (lockRound.error) {
            actions.push({ league_id: leagueId, round_id: roundId, step: "lock_failed", error: lockRound.error.message });
          } else {
            roundStatus = "locked";
            await supabase
              .from("picks")
              .update({ status: "no-pick", reason: "missed" })
              .eq("round_id", roundId)
              .is("team_id", null)
              .or("status.is.null,status.eq.pending");
            actions.push({ league_id: leagueId, round_id: roundId, step: "lock" });
          }
        }

        if (roundStatus === "locked") {
          const fixturesResult = await supabase
            .from("fixtures")
            .select("id, result, winning_team_id")
            .eq("round_id", roundId);

          if (fixturesResult.error) {
            actions.push({ league_id: leagueId, round_id: roundId, step: "fixtures_error", error: fixturesResult.error.message });
            continue;
          }

          const fixtures = fixturesResult.data ?? [];
          if (fixtures.length === 0) {
            actions.push({ league_id: leagueId, round_id: roundId, step: "fixtures_missing" });
          } else {
            const unresolved = fixtures.some((fixture) => {
              const result = fixture.result as string | null;
              const winningTeamId = fixture.winning_team_id as string | null;
              return !winningTeamId || !result || result === "not_set" || result === "pending";
            });

            if (!unresolved) {
              const winners = new Set<string>();
              for (const fixture of fixtures) {
                if (fixture.winning_team_id) winners.add(fixture.winning_team_id as string);
              }

              const picksResult = await supabase
                .from("picks")
                .select("id, team_id, status")
                .eq("round_id", roundId);

              if (picksResult.error) {
                actions.push({ league_id: leagueId, round_id: roundId, step: "picks_error", error: picksResult.error.message });
                continue;
              }

              let survivors = 0;
              for (const pick of picksResult.data ?? []) {
                if (pick.status === "no-pick") continue;
                const teamId = pick.team_id as string | null;
                if (teamId && winners.has(teamId)) {
                  await supabase
                    .from("picks")
                    .update({ status: "through", reason: null })
                    .eq("id", pick.id);
                  survivors += 1;
                } else {
                  await supabase
                    .from("picks")
                    .update({ status: "eliminated", reason: "loss" })
                    .eq("id", pick.id);
                }
              }

              await supabase
                .from("rounds")
                .update({ status: "completed" })
                .eq("id", roundId)
                .eq("status", "locked");

              roundStatus = "completed";
              actions.push({ league_id: leagueId, round_id: roundId, step: "evaluate_complete", survivors });
            }
          }
        }

        if (roundStatus === "completed") {
          const survivorsResult = await supabase
            .from("picks")
            .select("id", { count: "exact", head: true })
            .eq("round_id", roundId)
            .eq("status", "through");

          if (survivorsResult.error) {
            actions.push({ league_id: leagueId, round_id: roundId, step: "survivor_count_error", error: survivorsResult.error.message });
            continue;
          }

          const survivors = survivorsResult.count ?? 0;
          if (survivors === 1) {
            const winnerResult = await supabase
              .from("picks")
              .select("player_id")
              .eq("round_id", roundId)
              .eq("status", "through")
              .limit(1)
              .maybeSingle();
            const winnerPlayerId = winnerResult.data?.player_id ?? null;
            await supabase
              .from("leagues")
              .update({ status: "finished" })
              .eq("id", leagueId);
            actions.push({ league_id: leagueId, step: "winner", winner_player_id: winnerPlayerId });
          } else if (survivors === 0) {
            actions.push({ league_id: leagueId, step: "rollover_zero_survivors" });
          } else {
            const nextRoundNumber = currentRoundNumber + 1;
            const nextRoundCheck = await supabase
              .from("rounds")
              .select("id")
              .eq("league_id", leagueId)
              .eq("round_number", nextRoundNumber)
              .maybeSingle();

            if (!nextRoundCheck.data) {
              await supabase
                .from("rounds")
                .insert({
                  id: crypto.randomUUID(),
                  league_id: leagueId,
                  round_number: nextRoundNumber,
                  status: "upcoming",
                  pick_deadline_utc: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                });
            }

            await supabase
              .from("leagues")
              .update({ current_round: nextRoundNumber })
              .eq("id", leagueId);
            actions.push({ league_id: leagueId, step: "advance", next_round: nextRoundNumber });
          }
        }
      } catch (leagueError: any) {
        actions.push({ league_id: league.id, step: "league_error", error: leagueError?.message ?? "League tick failed" });
      }
    }

    if (tickRunId) {
      await supabase
        .from("tick_runs")
        .update({ status: "ok", completed_at: new Date().toISOString() })
        .eq("id", tickRunId);
    }

    return sendJson(res, 200, {
      ok: true,
      env_check: envCheck,
      db_connection_check: dbConnectionCheck,
      round_count: countResult.count ?? 0,
      timestamp,
      duration_ms: Date.now() - started,
      actions,
      processed_leagues: processedLeagues,
    });
  } catch (error: any) {
    if (supabase && tickRunId) {
      try {
        await supabase
          .from("tick_runs")
          .update({ status: "error", completed_at: new Date().toISOString(), error: error?.message ?? "DB check failed" })
          .eq("id", tickRunId);
      } catch {}
    }
    return sendJson(res, 502, {
      ok: false,
      env_check: envCheck,
      db_connection_check: false,
      round_count: null,
      timestamp,
      duration_ms: Date.now() - started,
      actions: [],
      processed_leagues: 0,
      error: error?.message ?? "DB check failed",
    });
  }
}
