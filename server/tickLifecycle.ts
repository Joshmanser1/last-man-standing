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

export async function runLeagueLifecycle({ supabase, league, now, actions }: RunLeagueLifecycleArgs) {
  const leagueId = league.id;
  const runKey = getLeagueRunKey(leagueId, now);
  const insertResult = await supabase.from("tick_runs").insert({ run_key: runKey }).select("id").single();

  if (insertResult.error) {
    if (insertResult.error.code === "23505") {
      return { alreadyRan: true, runKey };
    }
    throw new Error(insertResult.error.message ?? "Failed to insert league tick run");
  }

  const tickRunId = insertResult.data.id as string;
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
      actions.push({ league_id: leagueId, step: "round_lookup_error", error: roundResult.error.message });
      return { alreadyRan: false, runKey };
    }

    if (!roundResult.data) {
      actions.push({ league_id: leagueId, step: "round_missing", round_number: currentRoundNumber });
      return { alreadyRan: false, runKey };
    }

    const roundId = roundResult.data.id as string;
    let roundStatus = (roundResult.data.status as string | null) ?? "upcoming";
    const pickDeadline = roundResult.data.pick_deadline_utc ? new Date(roundResult.data.pick_deadline_utc) : null;
    if (league.status === "upcoming" && (roundStatus === "locked" || roundStatus === "completed")) {
      await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId).eq("status", "upcoming");
    }

    if (roundStatus === "upcoming" && pickDeadline && pickDeadline.getTime() <= now.getTime()) {
      const lockRound = await supabase.from("rounds").update({ status: "locked" }).eq("id", roundId).eq("status", "upcoming");

      if (lockRound.error) {
        actions.push({ league_id: leagueId, round_id: roundId, step: "lock_failed", error: lockRound.error.message });
      } else {
        roundStatus = "locked";
        await supabase.from("leagues").update({ status: "active" }).eq("id", leagueId).eq("status", "upcoming");
        const membersResult = await supabase
          .from("memberships")
          .select("player_id")
          .eq("league_id", leagueId)
          .eq("is_active", true);
        const picksForRound = await supabase.from("picks").select("player_id").eq("round_id", roundId);

        if (membersResult.error) {
          actions.push({ league_id: leagueId, round_id: roundId, step: "memberships_error", error: membersResult.error.message });
        } else if (picksForRound.error) {
          actions.push({ league_id: leagueId, round_id: roundId, step: "picks_error", error: picksForRound.error.message });
        } else {
          const pickedIds = new Set<string>((picksForRound.data ?? []).map((p: any) => p.player_id).filter((id: any) => typeof id === "string"));
          const missingPlayerIds = (membersResult.data ?? [])
            .map((m: any) => m.player_id)
            .filter((id: any) => typeof id === "string" && !pickedIds.has(id));

          if (missingPlayerIds.length > 0) {
            const { error: deactivateError } = await supabase
              .from("memberships")
              .update({ is_active: false })
              .eq("league_id", leagueId)
              .in("player_id", missingPlayerIds);
            if (deactivateError) {
              actions.push({ league_id: leagueId, round_id: roundId, step: "no_pick_deactivate_failed", error: deactivateError.message });
            } else {
              actions.push({ league_id: leagueId, round_id: roundId, step: "no_pick_members_eliminated", count: missingPlayerIds.length });
            }
          }
        }
        actions.push({ league_id: leagueId, round_id: roundId, step: "lock" });
      }
    }

    if (roundStatus === "locked") {
      if (typeof league.fpl_start_event === "number") {
        try {
          const eventNumber = league.fpl_start_event + currentRoundNumber - 1;
          const [bootstrapRes, eventFixturesRes, leagueTeamsRes] = await Promise.all([
            fetch("https://fantasy.premierleague.com/api/bootstrap-static/"),
            fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${eventNumber}`),
            supabase.from("teams").select("id, code").eq("league_id", leagueId),
          ]);

          if (bootstrapRes.ok && eventFixturesRes.ok && !leagueTeamsRes.error) {
            const bootstrap = (await bootstrapRes.json()) as any;
            const eventFixtures = (await eventFixturesRes.json()) as any[];
            const fplCodeById = new Map<number, string>(
              (bootstrap?.teams ?? [])
                .filter((t: any) => typeof t?.id === "number")
                .map((t: any) => [t.id as number, String(t.short_name ?? "").toUpperCase()])
            );
            const teamIdByCode = new Map<string, string>(
              (leagueTeamsRes.data ?? []).map((t: any) => [String(t.code ?? "").toUpperCase(), t.id as string])
            );

            const fixtureUpserts: Array<Record<string, unknown>> = [];
            for (const fx of eventFixtures ?? []) {
              const homeCode = fplCodeById.get(Number(fx?.team_h));
              const awayCode = fplCodeById.get(Number(fx?.team_a));
              const homeTeamId = homeCode ? teamIdByCode.get(homeCode) : undefined;
              const awayTeamId = awayCode ? teamIdByCode.get(awayCode) : undefined;
              if (!homeTeamId || !awayTeamId) continue;

              let result: "not_set" | "home_win" | "away_win" | "draw" = "not_set";
              if (fx?.team_h_score != null && fx?.team_a_score != null) {
                if (fx.team_h_score > fx.team_a_score) result = "home_win";
                else if (fx.team_a_score > fx.team_h_score) result = "away_win";
                else result = "draw";
              }

              fixtureUpserts.push({
                round_id: roundId,
                home_team_id: homeTeamId,
                away_team_id: awayTeamId,
                result,
                winning_team_id: result === "home_win" ? homeTeamId : result === "away_win" ? awayTeamId : null,
              });
            }

            if (fixtureUpserts.length > 0) {
              const { error: fixtureUpsertError } = await supabase
                .from("fixtures")
                .upsert(fixtureUpserts as any, { onConflict: "round_id,home_team_id,away_team_id" });
              if (fixtureUpsertError) {
                actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_error", error: fixtureUpsertError.message });
              } else {
                actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest", event: eventNumber, updated: fixtureUpserts.length });
              }
            }
          } else {
            actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_skipped", event: eventNumber });
          }
        } catch (ingestError: any) {
          actions.push({ league_id: leagueId, round_id: roundId, step: "fixture_ingest_error", error: ingestError?.message ?? "Fixture ingest failed" });
        }
      }

      const fixturesResult = await supabase.from("fixtures").select("id, result, winning_team_id").eq("round_id", roundId);
      if (fixturesResult.error) {
        actions.push({ league_id: leagueId, round_id: roundId, step: "fixtures_error", error: fixturesResult.error.message });
        return { alreadyRan: false, runKey };
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
          const winners = new Set<string>();
          for (const fixture of fixtures) {
            if (fixture.winning_team_id) winners.add(fixture.winning_team_id as string);
          }

          const picksResult = await supabase.from("picks").select("id, team_id, status, player_id").eq("round_id", roundId);
          if (picksResult.error) {
            actions.push({ league_id: leagueId, round_id: roundId, step: "picks_error", error: picksResult.error.message });
            return { alreadyRan: false, runKey };
          }

          let survivors = 0;
          const eliminatedPlayerIds = new Set<string>();
          const noPickPlayerIds = new Set<string>();
          for (const pick of picksResult.data ?? []) {
            if (pick.status === "no-pick") {
              if (pick.player_id) noPickPlayerIds.add(pick.player_id as string);
              continue;
            }
            const teamId = pick.team_id as string | null;
            if (teamId && winners.has(teamId)) {
              await supabase.from("picks").update({ status: "through", reason: null }).eq("id", pick.id);
              survivors += 1;
            } else {
              await supabase.from("picks").update({ status: "eliminated", reason: "loss" }).eq("id", pick.id);
              if (pick.player_id) eliminatedPlayerIds.add(pick.player_id as string);
            }
          }

          const deactivateIds = new Set<string>([...Array.from(eliminatedPlayerIds), ...Array.from(noPickPlayerIds)]);
          if (deactivateIds.size > 0) {
            const { error: membershipError } = await supabase
              .from("memberships")
              .update({ is_active: false })
              .eq("league_id", leagueId)
              .in("player_id", Array.from(deactivateIds));
            if (membershipError) {
              actions.push({ league_id: leagueId, round_id: roundId, step: "deactivate_failed", error: membershipError.message });
            }
          }

          await supabase.from("rounds").update({ status: "completed" }).eq("id", roundId).eq("status", "locked");
          roundStatus = "completed";
          actions.push({ league_id: leagueId, round_id: roundId, step: "evaluate_complete", survivors });
        }
      }
    }

    if (roundStatus === "completed") {
      const survivorsResult = await supabase.from("picks").select("id", { count: "exact", head: true }).eq("round_id", roundId).eq("status", "through");
      if (survivorsResult.error) {
        actions.push({ league_id: leagueId, round_id: roundId, step: "survivor_count_error", error: survivorsResult.error.message });
        return { alreadyRan: false, runKey };
      }

      const survivors = survivorsResult.count ?? 0;
      if (survivors === 1) {
        const winnerResult = await supabase.from("picks").select("player_id").eq("round_id", roundId).eq("status", "through").limit(1).maybeSingle();
        const winnerPlayerId = winnerResult.data?.player_id ?? null;
        await supabase.from("leagues").update({ status: "completed" }).eq("id", leagueId);
        actions.push({ league_id: leagueId, step: "winner", winner_player_id: winnerPlayerId });
      } else if (survivors === 0) {
        actions.push({ league_id: leagueId, step: "rollover_zero_survivors" });
      } else {
        const nextRoundNumber = currentRoundNumber + 1;
        const nextRoundCheck = await supabase.from("rounds").select("id").eq("league_id", leagueId).eq("round_number", nextRoundNumber).maybeSingle();
        let canAdvance = false;

        if (nextRoundCheck.error) {
          actions.push({ league_id: leagueId, step: "next_round_lookup_error", error: nextRoundCheck.error.message });
        } else if (!nextRoundCheck.data) {
          let nextDeadlineUtc = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
          if (league.is_test === true && typeof league.fpl_start_event === "number") {
            try {
              const nextEventNumber = league.fpl_start_event + nextRoundNumber - 1;
              const bootstrapRes = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/");
              if (bootstrapRes.ok) {
                const bootstrap = (await bootstrapRes.json()) as any;
                const nextEvent = (bootstrap?.events ?? []).find((event: any) => event?.id === nextEventNumber);
                if (nextEvent?.deadline_time) {
                  nextDeadlineUtc = String(nextEvent.deadline_time);
                } else {
                  actions.push({ league_id: leagueId, step: "test_round_deadline_missing", next_round: nextRoundNumber, event: nextEventNumber });
                }
              }
            } catch (deadlineError: any) {
              actions.push({ league_id: leagueId, step: "test_round_deadline_lookup_error", next_round: nextRoundNumber, error: deadlineError?.message ?? "Deadline lookup failed" });
            }
          }
          const { error: insertRoundError } = await supabase.from("rounds").insert({
            id: crypto.randomUUID(), league_id: leagueId, round_number: nextRoundNumber,
            name: `Round ${nextRoundNumber}`, status: "upcoming", pick_deadline_utc: nextDeadlineUtc,
          });
          if (insertRoundError) {
            actions.push({ league_id: leagueId, step: "next_round_create_failed", error: insertRoundError.message, next_round: nextRoundNumber });
          } else {
            canAdvance = true;
          }
        } else {
          canAdvance = true;
        }

        if (canAdvance) {
          await supabase.from("leagues").update({ current_round: nextRoundNumber }).eq("id", leagueId);
          actions.push({ league_id: leagueId, step: "advance", next_round: nextRoundNumber });
        }
      }
    }

    return { alreadyRan: false, runKey };
  } catch (error: any) {
    actions.push({ league_id: leagueId, step: "league_error", error: error?.message ?? "League tick failed" });
    return { alreadyRan: false, runKey };
  } finally {
    await supabase
      .from("tick_runs")
      .update({ status: "ok", completed_at: new Date().toISOString() })
      .eq("id", tickRunId);
  }
}
