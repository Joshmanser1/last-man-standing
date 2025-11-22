// src/pages/MakePick.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { useCountdown } from "../hooks/useCountdown";
import { GameSelector } from "../components/GameSelector";
import { useToast } from "../components/Toast";

const STORE_KEY = "lms_store_v1";

type OpponentMap = Record<string, string>; // teamId -> "vs Team Name (H/A)";

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

  const navigate = useNavigate();
  const toast = useToast();

  const playerId = localStorage.getItem("player_id") || "";

  // Kick to login/home if no player
  useEffect(() => {
    if (!playerId) {
      navigate("/login");
    }
  }, [playerId, navigate]);

  // Load league + round + teams + picks for current player
  useEffect(() => {
    if (!leagueId || !playerId) {
      setLeague(null);
      setRound(null);
      setTeams([]);
      setUsedTeamIds(new Set());
      setUsedByRound({});
      setCurrentPick(null);
      setOpponentByTeamId({});
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        // 1) League + round + teams
        const leagues = await (dataService as any).listLeagues();
        const l = leagues.find((x: any) => x.id === leagueId) || null;
        setLeague(l);

        if (!l) {
          setRound(null);
          setTeams([]);
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setCurrentPick(null);
          setOpponentByTeamId({});
          return;
        }

        const r = await dataService.getCurrentRound(leagueId);
        setRound(r);

        const ts = await dataService.listTeams(leagueId);
        setTeams(ts ?? []);

        // 2) Used teams for this player
        const used = await dataService.listUsedTeamIds(leagueId, playerId);
        setUsedTeamIds(used);

        // 3) Current pick for this round
        const picksThisRound = await dataService.listPicks(r.id);
        const mine = picksThisRound.find((p: any) => p.player_id === playerId);
        setCurrentPick(mine ?? null);

        // 4) Build "used by round" + opponent map from local store
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const s = JSON.parse(raw);

          // teamId -> round_number
          const byTeam: Record<string, number> = {};
          const myPicks = (s.picks as any[]).filter(
            (p) => p.league_id === leagueId && p.player_id === playerId
          );
          for (const p of myPicks) {
            const rnd = (s.rounds as any[]).find(
              (rr: any) => rr.id === p.round_id
            );
            if (rnd) byTeam[p.team_id] = rnd.round_number;
          }
          setUsedByRound(byTeam);

          // Opponent map from fixtures for THIS round
          const roundFixtures = (s.fixtures || []).filter(
            (f: any) => f.round_id === r.id
          );
          const opp: OpponentMap = {};

          for (const f of roundFixtures) {
            const homeTeam = ts.find((t: any) => t.id === f.home_team_id);
            const awayTeam = ts.find((t: any) => t.id === f.away_team_id);

            const home = homeTeam?.name ?? "";
            const away = awayTeam?.name ?? "";

            if (home && away) {
              // Home team: (H)
              opp[f.home_team_id] = `vs ${away} (H)`;
              // Away team: (A)
              opp[f.away_team_id] = `vs ${home} (A)`;
            }
          }

          setOpponentByTeamId(opp);
        } else {
          setUsedByRound({});
          setOpponentByTeamId({});
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId, playerId, reloadTick]);

  // Countdown based on the round pick deadline (which you can set from FPL’s GW deadline)
  const timeLeft = useCountdown(round?.pick_deadline_utc);

  // Hard lock if round is locked/completed OR countdown has hit zero
  const hardLocked =
    !!round && (round.status === "locked" || round.status === "completed");
  const locked = hardLocked || timeLeft === "00:00:00";

  const teamsAZ = useMemo(() => {
    // de-dupe then A→Z
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

      if (currentPick && currentPick.team_id !== teamId) {
        const ok = confirm("Replace your existing pick with this team?");
        if (!ok) return;
      }
      await dataService.upsertPick(round, league.id, playerId, teamId);
      toast("Pick saved ✅", { variant: "success" });
      navigate("/results");
    } catch (e: any) {
      toast(e?.message ?? "Could not save pick.", { variant: "error" });
    }
  }

  // If no league is selected yet, show GameSelector and a small explainer
  if (!leagueId) {
    return (
      <div className="container-page py-6">
        <div className="max-w-xl mx-auto card p-6 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <h1 className="text-2xl font-bold">Make your pick</h1>
            <GameSelector
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
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate("/admin")}
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !league || !round) {
    return (
      <div className="min-h-[calc(100vh-4rem)] grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
          <div className="text-slate-500 text-sm">Loading picks…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-6">
      <div className="mb-4 flex justify-end">
        <GameSelector
          label="Viewing game"
          onChange={(id) => {
            setLeagueId(id);
            setReloadTick((x) => x + 1);
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        {/* Left: pick list */}
        <div className="card p-6 sm:p-7">
          <div className="mb-4">
            <h1 className="text-2xl font-bold">
              Round {round.round_number} — Make your pick
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Locks{" "}
              {round.pick_deadline_utc
                ? new Date(round.pick_deadline_utc).toLocaleString()
                : "—"}{" "}
              • ⏱ <span className="font-mono">{timeLeft}</span>
            </p>
            {hardLocked && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                This round is locked. Picks are closed.
              </p>
            )}
          </div>

          {currentPick && (
            <div className="mb-5 rounded-xl bg-teal-50 border border-teal-100 px-4 py-3 text-sm text-teal-900 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-sm">Current pick</div>
                <div className="text-sm">
                  {teamsAZ.find((t) => t.id === currentPick.team_id)?.name ??
                    "—"}
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
              const usedRound = usedByRound[t.id];
              const opp = opponentByTeamId[t.id]; // e.g., "vs Man City (H)"

              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 sm:gap-3"
                >
                  {/* Team pick button */}
                  <button
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

                  {/* Opponent bubble */}
                  <span className="text-xs px-3 py-1 rounded-full border bg-slate-50 text-slate-700">
                    {opp ?? "No fixture"}
                  </span>

                  {/* Status badges */}
                  {alreadyUsed && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                      Used R{usedRound ?? "?"}
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

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => navigate("/live")}
              className="btn btn-ghost"
            >
              Live Games
            </button>
            <button
              type="button"
              onClick={() => navigate("/results")}
              className="btn btn-ghost"
            >
              Results
            </button>
          </div>
        </div>

        {/* Right: round & league summary */}
        <aside className="card p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Game
            </div>
            <div className="mt-1 font-semibold">{league.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              Round {round.round_number} •{" "}
              <span className="uppercase">{round.status}</span>
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
              ⏱ Time left: <span className="font-mono">{timeLeft}</span>
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
