// api/tick.ts
// Vercel Serverless Function
// Runs LMS automation: lock -> evaluate -> advance

import { createClient } from "@supabase/supabase-js";

type Json = Record<string, any>;

function json(res: any, status: number, body: Json) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req: any, res: any) {
  // --- Method guard ---
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, error: "Method Not Allowed" });
  }

  // --- Auth: cron secret ---
  const secret = process.env.CRON_SECRET;
  const headerKey = req.headers["x-cron-secret"];
  const queryKey = req.query?.key;
  if (secret && headerKey !== secret && queryKey !== secret) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SERVICE_ROLE =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    });
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date().toISOString();

  const report: any = {
    ok: true,
    now,
    processed: 0,
    actions: [] as any[],
    errors: [] as any[],
  };

  try {
    // --------- ASSUMPTION: tables are named leagues, rounds, picks, fixtures ----------
    // If your tables differ, change them here once and you�re done.
    const { data: leagues, error: leaguesErr } = await supa
      .from("leagues")
      .select("*")
      .is("deleted_at", null);

    if (leaguesErr) throw leaguesErr;
    if (!leagues?.length) return json(res, 200, { ...report, note: "No leagues found" });

    for (const league of leagues) {
      report.processed++;

      try {
        // current round by league.current_round
        const { data: round, error: roundErr } = await supa
          .from("rounds")
          .select("*")
          .eq("league_id", league.id)
          .eq("round_number", league.current_round)
          .maybeSingle();

        if (roundErr) throw roundErr;
        if (!round) continue;

        // 1) LOCK
        if (round.status === "upcoming" && round.pick_deadline_utc && round.pick_deadline_utc <= now) {
          // NOTE: ideally this is an RPC to do atomically:
          // - set round status locked
          // - mark no-pick
          const { error: lockErr } = await supa
            .from("rounds")
            .update({ status: "locked", locked_at: now })
            .eq("id", round.id)
            .eq("status", "upcoming"); // idempotent guard

          if (lockErr) throw lockErr;

          // Mark no-pick (assumes pick row exists per member; if not, you�ll do it differently)
          await supa
            .from("picks")
            .update({ status: "no-pick", reason: "missed" })
            .eq("round_id", round.id)
            .is("team_id", null)
            .in("status", ["pending", null]);

          report.actions.push({ league: league.id, round: round.id, action: "locked" });
          // reload round state
          round.status = "locked";
        }

        // 2) EVALUATE (only if locked)
        if (round.status === "locked") {
          // Determine if fixtures are resolved for this round
          const { data: fixtures, error: fxErr } = await supa
            .from("fixtures")
            .select("*")
            .eq("round_id", round.id);

          if (fxErr) throw fxErr;

          const unresolved = (fixtures || []).filter((f: any) => f.result === "not_set" || !f.result);
          if (unresolved.length === 0 && (fixtures || []).length > 0) {
            // Evaluate picks using fixture.winning_team_id
            const winners = new Set((fixtures || []).map((f: any) => f.winning_team_id).filter(Boolean));

            const { data: picks, error: pkErr } = await supa
              .from("picks")
              .select("*")
              .eq("round_id", round.id);

            if (pkErr) throw pkErr;

            for (const p of picks || []) {
              if (p.status === "no-pick") continue;
              if (p.team_id && winners.has(p.team_id)) {
                await supa.from("picks").update({ status: "through", reason: null }).eq("id", p.id);
              } else {
                await supa.from("picks").update({ status: "eliminated", reason: "loss" }).eq("id", p.id);
              }
            }

            // round complete
            await supa
              .from("rounds")
              .update({ status: "completed", completed_at: now })
              .eq("id", round.id)
              .in("status", ["locked"]); // guard

            report.actions.push({ league: league.id, round: round.id, action: "evaluated_completed" });
            round.status = "completed";
          }
        }

        // 3) ADVANCE (only if completed)
        if (round.status === "completed") {
          const { data: picks, error: pk2Err } = await supa
            .from("picks")
            .select("*")
            .eq("round_id", round.id);

          if (pk2Err) throw pk2Err;

          const survivors = (picks || []).filter((p: any) => p.status === "through");
          const survivorCount = survivors.length;

          if (survivorCount <= 1) {
            // WINNER or ROLLOVER
            if (survivorCount === 1) {
              const winner = survivors[0];
              await supa
                .from("leagues")
                .update({ status: "finished", winner_player_id: winner.player_id, finished_at: now })
                .eq("id", league.id);

              report.actions.push({ league: league.id, action: "winner", winner: winner.player_id });
            } else {
              // rollover: league stays active; you can increment a pot/rollover field if you have it
              report.actions.push({ league: league.id, action: "rollover_zero_survivors" });
            }
            continue;
          }

          // More than 1 survivor -> create next round if not exists
          const nextRoundNumber = league.current_round + 1;

          const { data: existingNext } = await supa
            .from("rounds")
            .select("id")
            .eq("league_id", league.id)
            .eq("round_number", nextRoundNumber)
            .maybeSingle();

          if (!existingNext) {
            // You probably want to map to an FPL GW deadline.
            // For now we do a simple +7 days fallback if you don�t have an FPL mapping on server.
            const fallbackDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

            const { error: createErr } = await supa.from("rounds").insert({
              id: crypto.randomUUID(),
              league_id: league.id,
              round_number: nextRoundNumber,
              status: "upcoming",
              pick_deadline_utc: fallbackDeadline,
              created_at: now,
            });

            if (createErr) throw createErr;

            await supa.from("leagues").update({ current_round: nextRoundNumber }).eq("id", league.id);

            report.actions.push({ league: league.id, action: "next_round_created", round_number: nextRoundNumber });
          } else {
            // ensure league.current_round is aligned
            if (league.current_round !== nextRoundNumber) {
              await supa.from("leagues").update({ current_round: nextRoundNumber }).eq("id", league.id);
              report.actions.push({ league: league.id, action: "current_round_synced", round_number: nextRoundNumber });
            }
          }
        }
      } catch (inner: any) {
        report.errors.push({ league: league.id, error: inner?.message ?? String(inner) });
      }
    }

    return json(res, 200, report);
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message ?? String(e), report });
  }
}
