import { finalizeRound } from "./roundFinalization.js";

export type TickAction = Record<string, unknown>;

type TickLeague = {
  id: string;
  status?: string | null;
  current_round?: number | null;
  fpl_start_event?: number | null;
  is_test?: boolean | null;
};

type RunLeagueLifecycleArgs = {
  supabase: any;
  league: TickLeague;
  now: Date;
  actions: TickAction[];
};

function getLeagueRunKey(leagueId: string, now: Date): string {
  const bucketMs = 5 * 60 * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
  return `league:${leagueId}:${bucketStart.toISOString().slice(0, 16)}Z`;
}

export function isEligibleForTick(league: TickLeague): boolean {
  const status = league.status ?? null;
  return status == null || status === "upcoming" || status === "active" || status === "running";
}

async function ingestFplRoundFixtures(args: {
  supabase: any;
  leagueId: string;
  roundId: string;
  eventNumber: number;
  includeFinalResults: boolean;
  actions: TickAction[];
}) {
  const { supabase, leagueId, roundId, eventNumber, includeFinalResults, actions } = args;
  try {
    const [bootstrapRes, eventFixturesRes, leagueTeamsRes] = await Promise.all([
      fetch("https://fantasy.premierleague.com/api/bootstrap-static/"),
      fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${eventNumber}`),
      supabase.from("teams").select("id, code").eq("league_id", leagueId),
    ]);

    if (!bootstrapRes.ok || !eventFixturesRes.ok || leagueTeamsRes.error) {
      throw new Error(leagueTeamsRes.error?.message ?? "FPL fixtures unavailable");
    }

    const bootstrap = (await bootstrapRes.json()) as any;
    const eventFixtures = (await eventFixturesRes.json()) as any[];
    if (!Array.isArray(eventFixtures) || eventFixtures.length === 0) {
      actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_skipped", event: eventNumber });
      return { readyForEvaluation: false };
    }

    const fplCodeById = new Map<number, string>(
      (bootstrap?.teams ?? [])
        .filter((team: any) => typeof team?.id === "number")
        .map((team: any) => [team.id as number, String(team.short_name ?? "").toUpperCase()])
    );
    const teamIdByCode = new Map<string, string>(
      (leagueTeamsRes.data ?? []).map((team: any) => [String(team.code ?? "").toUpperCase(), team.id as string])
    );

    const fixtureUpserts: Array<Record<string, unknown>> = [];
    for (const fixture of eventFixtures) {
      const homeCode = fplCodeById.get(Number(fixture?.team_h));
      const awayCode = fplCodeById.get(Number(fixture?.team_a));
      const homeTeamId = homeCode ? teamIdByCode.get(homeCode) : undefined;
      const awayTeamId = awayCode ? teamIdByCode.get(awayCode) : undefined;
      if (!homeTeamId || !awayTeamId) continue;

      let result: "not_set" | "home_win" | "away_win" | "draw" = "not_set";
      if (
        includeFinalResults &&
        fixture?.finished === true &&
        fixture?.team_h_score != null &&
        fixture?.team_a_score != null
      ) {
        if (fixture.team_h_score > fixture.team_a_score) result = "home_win";
        else if (fixture.team_a_score > fixture.team_h_score) result = "away_win";
        else result = "draw";
      }

      fixtureUpserts.push({
        round_id: roundId,
        home_team_id: homeTeamId,
        away_team_id: awayTeamId,
        kickoff_utc: fixture?.kickoff_time ?? null,
        result,
        winning_team_id: result === "home_win" ? homeTeamId : result === "away_win" ? awayTeamId : null,
      });
    }

    if (fixtureUpserts.length !== eventFixtures.length) {
      actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_incomplete", event: eventNumber });
      return { readyForEvaluation: false };
    }

    const { error: fixtureUpsertError } = await supabase
      .from("fixtures")
      .upsert(fixtureUpserts as any, { onConflict: "round_id,home_team_id,away_team_id" });
    if (fixtureUpsertError) {
      actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_error", error: fixtureUpsertError.message });
      throw new Error(fixtureUpsertError.message);
    }

    actions.push({
      league_id: leagueId,
      round_id: roundId,
      step: includeFinalResults ? "fixture_ingest" : "fixture_schedule_seed",
      event: eventNumber,
      updated: fixtureUpserts.length,
    });
    return {
      readyForEvaluation:
        includeFinalResults && eventFixtures.every((fixture: any) => fixture?.finished === true),
    };
  } catch (ingestError: any) {
    actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_error", error: ingestError?.message ?? "Fixture ingest failed" });
    throw ingestError;
  }
}

export async function runLeagueLifecycle({ supabase, league, now, actions }: RunLeagueLifecycleArgs) {
  const leagueId = league.id;
  const runKey = getLeagueRunKey(leagueId, now);
  const insertResult = await supabase.from("tick_runs").insert({ run_key: runKey }).select("id").single();

  if (insertResult.error) {
    if (insertResult.error.code === "23505") {
      const previous = await supabase.from("tick_runs").select("status").eq("run_key", runKey).maybeSingle();
      if (previous.error) throw new Error(previous.error.message);
      if (previous.data?.status !== "ok") throw new Error("Previous league tick failed or is still running; retry next tick window");
      return { alreadyRan: true, runKey };
    }
    throw new Error(insertResult.error.message ?? "Failed to insert league tick run");
  }

  const tickRunId = insertResult.data.id as string;
  let failure: unknown;
  try {
    const currentRoundNumber = league.current_round ?? null;
    if (currentRoundNumber == null) {
      actions.push({ league_id: leagueId, step: "skip_no_current_round" });
      return { alreadyRan: false, runKey };
    }

    const roundResult = await supabase
      .from("rounds")
      .select("id, status, pick_deadline_utc, round_number")
      .eq("league_id", leagueId)
      .eq("round_number", currentRoundNumber)
      .maybeSingle();

    if (roundResult.error) {
      throw new Error(roundResult.error.message);
    }

    if (!roundResult.data) {
      actions.push({ league_id: leagueId, step: "round_missing", round_number: currentRoundNumber });
      return { alreadyRan: false, runKey };
    }

    const roundId = roundResult.data.id as string;
    let roundStatus = (roundResult.data.status as string | null) ?? "upcoming";
    const pickDeadline = roundResult.data.pick_deadline_utc ? new Date(roundResult.data.pick_deadline_utc) : null;
    if (league.status === "upcoming" && (roundStatus === "locked" || roundStatus === "completed")) {
      const activate = await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId).eq("status", "upcoming");
      if (activate.error) throw new Error(activate.error.message);
    }

    if (
      roundStatus === "upcoming" &&
      league.is_test !== true &&
      typeof league.fpl_start_event === "number" &&
      (!pickDeadline || pickDeadline.getTime() > now.getTime())
    ) {
      const fixturesResult = await supabase
        .from("fixtures")
        .select("id", { count: "exact", head: true })
        .eq("round_id", roundId);
      if (fixturesResult.error) {
        throw new Error(fixturesResult.error.message);
      } else if ((fixturesResult.count ?? 0) === 0) {
        const eventNumber = league.fpl_start_event + currentRoundNumber - 1;
        await ingestFplRoundFixtures({
          supabase,
          leagueId,
          roundId,
          eventNumber,
          includeFinalResults: false,
          actions,
        });
      }
    }

    if (roundStatus === "upcoming" && pickDeadline && pickDeadline.getTime() <= now.getTime()) {
      await finalizeRound(supabase, leagueId, roundId, { lockOnly: true });
      roundStatus = "locked";
      actions.push({ league_id: leagueId, round_id: roundId, step: "lock" });
    }

    if (roundStatus === "locked") {
      // Retry missed-pick elimination even if a legacy tick partially locked this round.
      await finalizeRound(supabase, leagueId, roundId, { lockOnly: true });
      let fplFixturesReadyForEvaluation = typeof league.fpl_start_event !== "number";
      if (typeof league.fpl_start_event === "number") {
        const eventNumber = league.fpl_start_event + currentRoundNumber - 1;
        const ingestResult = await ingestFplRoundFixtures({
          supabase,
          leagueId,
          roundId,
          eventNumber,
          includeFinalResults: true,
          actions,
        });
        fplFixturesReadyForEvaluation = ingestResult.readyForEvaluation;
      }

      if (!fplFixturesReadyForEvaluation) {
        actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_results_pending" });
        return { alreadyRan: false, runKey };
      }

      const fixturesResult = await supabase.from("fixtures").select("id, result, winning_team_id").eq("round_id", roundId);
      if (fixturesResult.error) {
        throw new Error(fixturesResult.error.message);
      }

      const fixtures = fixturesResult.data ?? [];
      if (fixtures.length === 0) {
        actions.push({ league_id: leagueId, round_id: roundId, step: "fixtures_missing" });
      } else {
        const unresolved = fixtures.some((fixture: any) => {
          const result = fixture.result as string | null;
          const winningTeamId = fixture.winning_team_id as string | null;
          if (!result || result === "not_set" || result === "pending") return true;
          if ((result === "home_win" || result === "away_win") && !winningTeamId) return true;
          return false;
        });

        if (!unresolved) {
          const result = await finalizeRound(supabase, leagueId, roundId);
          roundStatus = "completed";
          actions.push({ league_id: leagueId, round_id: roundId, step: "evaluate_complete", survivors: result.survivors });
        }
      }
    }

    if (roundStatus === "completed") {
      // Reconcile legacy completed rounds before trusting their persisted outcome.
      const final = await finalizeRound(supabase, leagueId, roundId);
      const survivors = final.survivors;
      if (survivors === 1) {
        actions.push({ league_id: leagueId, step: "winner", winner_player_id: final.winner_player_id });
      } else if (survivors === 0) {
        actions.push({ league_id: leagueId, step: "rollover_zero_survivors" });
      } else {
        const nextRoundNumber = currentRoundNumber + 1;
        const nextRoundCheck = await supabase.from("rounds").select("id").eq("league_id", leagueId).eq("round_number", nextRoundNumber).maybeSingle();
        let canAdvance = false;

        if (nextRoundCheck.error) {
          throw new Error(nextRoundCheck.error.message);
        } else if (!nextRoundCheck.data) {
          let nextDeadlineUtc = league.is_test === true
            ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null;
          if (typeof league.fpl_start_event === "number") {
            try {
              const nextEventNumber = league.fpl_start_event + nextRoundNumber - 1;
              const bootstrapRes = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
              if (bootstrapRes.ok) {
                const bootstrap = (await bootstrapRes.json()) as any;
                const nextEvent = (bootstrap?.events ?? []).find((event: any) => event?.id === nextEventNumber);
                if (nextEvent?.deadline_time) {
                  nextDeadlineUtc = String(nextEvent.deadline_time);
                } else {
                  actions.push({
                    league_id: leagueId,
                    step: league.is_test === true ? "test_round_deadline_missing" : "round_deadline_missing",
                    next_round: nextRoundNumber,
                    event: nextEventNumber,
                  });
                }
              } else if (league.is_test !== true) {
                actions.push({ league_id: leagueId, step: "round_deadline_lookup_failed", next_round: nextRoundNumber, event: nextEventNumber });
              }
            } catch (deadlineError: any) {
              actions.push({
                league_id: leagueId,
                step: league.is_test === true ? "test_round_deadline_lookup_error" : "round_deadline_lookup_error",
                next_round: nextRoundNumber,
                error: deadlineError?.message ?? "Deadline lookup failed",
              });
            }
          }
          if (!nextDeadlineUtc) {
            actions.push({ league_id: leagueId, step: "next_round_deadline_unavailable", next_round: nextRoundNumber });
          } else {
            const { error: insertRoundError } = await supabase.from("rounds").insert({
              id: crypto.randomUUID(), league_id: leagueId, round_number: nextRoundNumber,
              name: `Round ${nextRoundNumber}`, status: "upcoming", pick_deadline_utc: nextDeadlineUtc,
            });
            if (insertRoundError) {
              throw new Error(insertRoundError.message);
            } else {
              canAdvance = true;
            }
          }
        } else {
          canAdvance = true;
        }

        if (canAdvance) {
          const advance = await supabase.from("leagues").update({ current_round: nextRoundNumber })
            .eq("id", leagueId).eq("current_round", currentRoundNumber).select("id");
          if (advance.error) throw new Error(advance.error.message);
          if (advance.data?.length) actions.push({ league_id: leagueId, step: "advance", next_round: nextRoundNumber });
        }
      }
    }

    return { alreadyRan: false, runKey };
  } catch (error: any) {
    actions.push({ league_id: leagueId, step: "league_error", error: error?.message ?? "League tick failed" });
    failure = error;
    throw error;
  } finally {
    const report = await supabase.from("tick_runs").update({
      status: failure ? "error" : "ok", completed_at: new Date().toISOString(),
      ...(failure ? { error: failure instanceof Error ? failure.message : String(failure) } : {}),
    }).eq("id", tickRunId);
    if (report.error) throw new Error("Failed to record league tick result: " + report.error.message);
  }
}
