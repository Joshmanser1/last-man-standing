// src/pages/MakePick.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { useCountdown } from "../hooks/useCountdown";
import { GameSelector } from "../components/GameSelector";
import { useToast } from "../components/Toast";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";
import { getMemberElimination, loadLeagueRoundState } from "../lib/leagueRoundState";
import {
  getMarketingDemoFixtures,
  getMarketingDemoRoundRows,
  getMarketingDemoSnapshot,
  isMarketingDemoActive,
  isMarketingDemoRecordingMode,
} from "../demo/runtime";

type OpponentMap = Record<string, string>;

export function MakePick() {
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [usedTeamIds, setUsedTeamIds] = useState<Set<string>>(new Set());
  const [usedByRound, setUsedByRound] = useState<Record<string, number>>({});
  const [currentPick, setCurrentPick] = useState<any>(null);
  const [opponentByTeamId, setOpponentByTeamId] = useState<OpponentMap>({});
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [authUserId, setAuthUserId] = useState<string>("");
  const [viewerMembership, setViewerMembership] = useState<any>(null);
  const [winnerName, setWinnerName] = useState<string>("");
  const [inactiveMessage, setInactiveMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

  const navigate = useNavigate();
  const toast = useToast();
  const hideAdminUi = isMarketingDemoActive() && isMarketingDemoRecordingMode();

  const playerId = authUserId;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const uid = (await getEffectiveUserId()) ?? "";
      if (mounted) setAuthUserId(uid);
      if (!uid) navigate("/login");
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!leagueId || !playerId) {
      setLeague(null);
      setRound(null);
      setTeams([]);
      setUsedTeamIds(new Set());
      setUsedByRound({});
      setCurrentPick(null);
      setOpponentByTeamId({});
      setViewerMembership(null);
      setWinnerName("");
      setInactiveMessage("");
      setLoadError("");
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        setLoadError("");
        const roundState = await loadLeagueRoundState(leagueId);
        const activeLeague = roundState.league ?? null;
        setLeague(activeLeague);

        if (!activeLeague) {
          setRound(null);
          setTeams([]);
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setCurrentPick(null);
          setOpponentByTeamId({});
          setViewerMembership(null);
          setWinnerName("");
          setInactiveMessage("");
          setLoadError("League not found");
          return;
        }

        const myMembership =
          (roundState.memberships ?? []).find((member: any) => String(member.player_id) === String(playerId)) ??
          null;
        setViewerMembership(myMembership);
        setWinnerName(roundState.winnerName ?? "");
        setLeague(roundState.league ?? activeLeague);
        setRound(roundState.round);
        setTeams(roundState.teams ?? []);
        setCurrentPick(roundState.viewerPick ?? null);
        const elimination = myMembership
          ? getMemberElimination(myMembership, roundState.rounds, roundState.allLeaguePicks, leagueId)
          : null;
        if (activeLeague.status === "completed") {
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setOpponentByTeamId({});
          setInactiveMessage("");
          return;
        }
        if (myMembership?.is_active === false) {
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setOpponentByTeamId({});
          setInactiveMessage(
            elimination?.pick?.status === "no-pick"
              ? `No pick was submitted before the Round ${elimination.round.round_number} deadline.`
              : elimination?.pick?.team_id
              ? `${
                  roundState.teams.find((team: any) => String(team.id) === String(elimination.pick.team_id))?.name ??
                  "Your team"
                } did not win in Round ${elimination?.round?.round_number ?? roundState.round?.round_number}.`
              : "You can still follow the remaining rounds and view the league history."
          );
          return;
        }

        const currentRound = roundState.round;
        if (!currentRound) {
          setLoadError("Failed to load the current round");
          return;
        }
        setRound(currentRound);

        const leagueTeams = roundState.teams ?? [];
        setTeams(leagueTeams ?? []);

        const used = await dataService.listUsedTeamIds(leagueId, playerId);
        setUsedTeamIds(used);

        setCurrentPick(roundState.viewerPick ?? null);

        try {
          const [myPicks, roundRows] = isMarketingDemoActive()
            ? [
                getMarketingDemoSnapshot().picks.filter(
                  (entry) => entry.league_id === leagueId && entry.player_id === playerId
                ),
                getMarketingDemoRoundRows(leagueId),
              ]
            : await Promise.all([
                supa
                  .from("picks")
                  .select("team_id, round_id")
                  .eq("league_id", leagueId)
                  .eq("player_id", playerId)
                  .then((result) => result.data ?? []),
                supa
                  .from("rounds")
                  .select("id, round_number")
                  .eq("league_id", leagueId)
                  .then((result) => result.data ?? []),
              ]);

          const roundById = new Map<string, number>(
            (roundRows ?? []).map((rr: any) => [String(rr.id), rr.round_number as number])
          );
          const byTeam: Record<string, number> = {};
          for (const p of myPicks ?? []) {
            const roundNumber = roundById.get(String(p.round_id));
            if (p.team_id && roundNumber != null) {
              byTeam[String(p.team_id)] = roundNumber;
            }
          }
          setUsedByRound(byTeam);
        } catch {
          setUsedByRound({});
        }

        try {
          const byTeamId = new Map<string, any>(
            (leagueTeams ?? []).map((team: any) => [String(team.id), team])
          );
          const roundFixtures = isMarketingDemoActive()
            ? getMarketingDemoFixtures(currentRound.id)
            : (
                await supa
                  .from("fixtures")
                  .select("*")
                  .eq("round_id", currentRound.id)
              ).data ?? [];
          const opp: OpponentMap = {};
          for (const f of roundFixtures ?? []) {
            const homeTeam = byTeamId.get(String(f.home_team_id));
            const awayTeam = byTeamId.get(String(f.away_team_id));

            const home = homeTeam?.name ?? "";
            const away = awayTeam?.name ?? "";

            if (home && away) {
              opp[String(f.home_team_id)] = `vs ${away} (H)`;
              opp[String(f.away_team_id)] = `vs ${home} (A)`;
            }
          }
          if ((roundFixtures?.length ?? 0) > 0 && Object.keys(opp).length === 0) {
            console.warn("[MakePick] Fixtures loaded but no team-opponent mappings were built", {
              leagueId,
              roundId: currentRound.id,
              fixtureCount: roundFixtures?.length ?? 0,
              teamCount: leagueTeams?.length ?? 0,
            });
          }
          setOpponentByTeamId(opp);
        } catch {
          setOpponentByTeamId({});
        }
      } catch (err: any) {
        setLoadError(err?.message ?? "Failed to load picks");
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId, playerId, reloadTick]);

  const timeLeft = useCountdown(round?.pick_deadline_utc);
  const isTestMode = !!league?.is_test;

  const hardLocked =
    !!round && (round?.status === "locked" || round?.status === "completed");
  const locked = hardLocked || (!isTestMode && timeLeft === "Locked");
  const countdownLabel =
    round?.status === "completed"
      ? "Round Complete"
      : hardLocked
      ? "Locked"
      : timeLeft;

  const teamsAZ = useMemo(() => {
    const uniq = new Map<string, any>();
    for (const t of teams) if (!uniq.has(t.id)) uniq.set(t.id, t);
    return Array.from(uniq.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
  }, [teams]);

  async function pick(teamId: string) {
    try {
      if (!league || !round || !playerId) return;
      if (locked) return;
      const isUpdatingPick = !!currentPick && currentPick.team_id !== teamId;

      if (currentPick && currentPick.team_id !== teamId) {
        const ok = confirm("Replace your existing pick with this team?");
        if (!ok) return;
      }
      const res = await fetch("/api/submit-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: league.id,
          round_id: round.id,
          player_id: playerId,
          team_id: teamId,
        }),
      });
      if (!res.ok) {
        let msg = "Could not save pick.";
        try {
          const err = await res.json();
          msg = err?.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      toast(isUpdatingPick ? "Pick updated" : "Pick submitted", { variant: "success" });
      navigate("/leaderboard");
    } catch (e: any) {
      toast(e?.message ?? "Could not save pick.", { variant: "error" });
    }
  }

  if (!leagueId) {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <div className="max-w-xl mx-auto card p-6 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <h1 className="text-2xl font-bold">Make your pick</h1>
            <GameSelector
              value={leagueId}
              label="Select game"
              onChange={(id) => {
                setLeagueId(id);
                setReloadTick((x) => x + 1);
              }}
            />
          </div>
          <p className="text-sm text-slate-600">
            Choose a Last Man Standing game to start making your pick. You can
            switch between games at any time from the selector.
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate("/my-games")}
            >
              My Games
            </button>
            {!hideAdminUi && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => navigate("/admin")}
              >
                Admin
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (loading || !league || !round) {
    const message = loadError || "Loading picks...";
    return (
      <div
        data-testid="make-pick-page"
        className="min-h-[calc(100vh-4rem)] grid place-items-center"
      >
        <div className="flex flex-col items-center gap-3">
          <GameSelector
            value={leagueId}
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
          <div className="text-slate-500 text-sm">{message}</div>
        </div>
      </div>
    );
  }

  if (league.status === "completed") {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <div className="mb-4 flex justify-end">
          <GameSelector
            value={leagueId}
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <div className="mx-auto max-w-xl card p-6 space-y-4">
          <h1 className="text-2xl font-bold">This league is complete</h1>
          <p className="text-sm text-slate-600">
            {winnerName ? `Winner: ${winnerName}.` : "Final results are available."}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewerMembership?.is_active === false) {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <div className="mb-4 flex justify-end">
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <div className="mx-auto max-w-xl card p-6 space-y-4">
          <h1 className="text-2xl font-bold">You've been eliminated</h1>
          <p className="text-sm text-slate-600">
            {inactiveMessage || "You can still follow the remaining rounds and view the league history."}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="make-pick-page" className="container-page py-6">
      <div className="mb-4 flex justify-end">
        <GameSelector
          value={leagueId}
          label="Viewing game"
          onChange={(id) => {
            setLeagueId(id);
            setReloadTick((x) => x + 1);
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="card p-6 sm:p-7">
          <div className="mb-4">
            <h1 className="text-2xl font-bold">
              Round {round.round_number} - Make your pick
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Locks{" "}
              {round.pick_deadline_utc
                ? new Date(round.pick_deadline_utc).toLocaleString()
                : "—"}{" "}
              • <span className="font-mono">{countdownLabel}</span>
            </p>
            {isTestMode && !hideAdminUi && (
              <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                TEST MODE - deadline bypass active
              </p>
            )}
            {hardLocked && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                {round?.status === "completed"
                  ? "This round is complete."
                  : "This round is locked. Picks are closed."}
              </p>
            )}
          </div>

          {currentPick && (
            <div className="mb-5 rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 text-sm text-teal-900 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">Current pick</div>
                <div className="text-sm">
                  {teamsAZ.find((t) => t.id === currentPick.team_id)?.name ?? "—"}
                </div>
                <div className="text-[11px] text-teal-800 mt-0.5">
                  You can change it any time before the deadline.
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {teamsAZ.map((t) => {
              const alreadyUsed = usedTeamIds.has(t.id);
              const disabled = alreadyUsed || locked;
              const usedRound = usedByRound[String(t.id)];
              const opp = opponentByTeamId[String(t.id)];

              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 sm:gap-3"
                >
                  <button
                    data-testid="save-pick-btn"
                    type="button"
                    onClick={() => pick(t.id)}
                    disabled={disabled}
                    className={[
                      "btn flex-1 justify-between sm:flex-none sm:min-w-[210px]",
                      disabled
                        ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                        : "btn-ghost",
                    ].join(" ")}
                  >
                    <span className="font-medium">{t.name}</span>
                  </button>

                  {(opp || !hideAdminUi) && (
                    <span className="text-xs px-3 py-1 rounded-full border bg-slate-50 text-slate-700">
                      {opp ?? `Fixture unavailable for Round ${round.round_number}`}
                    </span>
                  )}

                  {alreadyUsed && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                      {usedRound != null ? `Used R${usedRound}` : "Used"}
                    </span>
                  )}
                  {locked && !alreadyUsed && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                      Locked
                    </span>
                  )}
                </div>
              );
            })}
          </div>

        </div>

        <aside className="card p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Game
            </div>
            <div className="mt-1 font-semibold">{league.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              Round {round.round_number} •{" "}
              <span className="uppercase">{round?.status}</span>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Deadline
            </div>
            <div className="text-sm">
              {round.pick_deadline_utc
                ? new Date(round.pick_deadline_utc).toLocaleString()
                : "—"}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Time left: <span className="font-mono">{countdownLabel}</span>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2 text-xs text-slate-600">
            <div className="font-semibold text-slate-700 text-sm">
              Pick rules
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>You can only use each team once per game.</li>
              <li>You may change your pick any time before the deadline.</li>
              <li>
                If your team loses or draws, you&apos;re out. Last manager
                standing wins.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
