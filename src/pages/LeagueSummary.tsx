// src/pages/LeagueSummary.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";

const STORE_KEY = "lms_store_v1";

type Store = {
  leagues: Array<any>;
  rounds: Array<any>;
  teams: Array<any>;
  players: Array<any>;
  memberships: Array<any>;
  picks: Array<any>;
  fixtures: Array<any>;
};

type CardProps = {
  title: string;
  value?: React.ReactNode;
  subtitle?: string;
  children?: React.ReactNode;
  glow?: boolean;
};

function StatCard({ title, value, subtitle, children, glow }: CardProps) {
  return (
    <div
      className={[
        "rounded-2xl border bg-white p-4 shadow-sm transition",
        glow ? "ring-1 ring-teal-500/10 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {value !== undefined ? (
        <div className="mt-2 text-2xl font-semibold text-slate-900">
          {value}
        </div>
      ) : null}
      {subtitle ? (
        <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
      ) : null}
      {children}
    </div>
  );
}

/** UI helpers */
function pill(cls: string, text: string) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
        cls,
      ].join(" ")}
    >
      {text}
    </span>
  );
}

function statusPill(status: string) {
  if (status === "through") return pill("bg-emerald-100 text-emerald-700", "Through");
  if (status === "eliminated")
    return pill("bg-rose-100 text-rose-700", "Eliminated");
  if (status === "no-pick")
    return pill("bg-slate-200 text-slate-700", "No pick");
  return pill("bg-amber-100 text-amber-700", "Pending");
}

function leagueStatusPill(status: string) {
  const up = status?.toUpperCase?.() ?? status;
  if (status === "active") return pill("bg-teal-100 text-teal-700", up);
  if (status === "upcoming") return pill("bg-indigo-100 text-indigo-700", up);
  if (status === "completed") return pill("bg-slate-200 text-slate-700", up);
  if (status === "locked") return pill("bg-amber-100 text-amber-700", up);
  return pill("bg-slate-100 text-slate-700", up);
}

function initials(name: string) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return (
    parts.map((p) => p[0]?.toUpperCase?.() ?? "").join("") ||
    name[0]?.toUpperCase?.() ||
    "U"
  );
}

function clamp01(n: number) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function formatCountdown(targetIso?: string): {
  label: string;
  overdue?: boolean;
} {
  if (!targetIso) return { label: "—" };
  const now = Date.now();
  const t = Date.parse(targetIso);
  if (isNaN(t)) return { label: "—" };
  const diff = t - now;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  if (diff < 0) {
    if (mins < 60) return { label: `${mins}m ago`, overdue: true };
    const h = Math.floor(mins / 60);
    const d = Math.floor(h / 24);
    if (d >= 1) return { label: `${d}d ago`, overdue: true };
    return { label: `${h}h ago`, overdue: true };
  }
  if (mins < 60) return { label: `${mins}m` };
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return { label: `${d}d` };
  return { label: `${h}h` };
}

export function LeagueSummary() {
  const navigate = useNavigate();

  const [store, setStore] = useState<Store | null>(null);
  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeLeagueId, setActiveLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [reloadTick, setReloadTick] = useState(0);

  // bootstrap from local store + dataService fallbacks
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await (dataService as any).seed?.();

        const raw = localStorage.getItem(STORE_KEY);
        const s = raw ? (JSON.parse(raw) as Store) : ({} as Store);
        setStore(s);

        const lg =
          (s?.leagues || []).find((l: any) => l.id === activeLeagueId) ||
          (await (dataService as any).listLeagues?.())?.[0] ||
          null;
        if (!lg) {
          setLeague(null);
          setRound(null);
          setTeams([]);
          setLoading(false);
          return;
        }
        setLeague(lg);

        const r =
          (s?.rounds || []).find(
            (rr: any) =>
              rr.league_id === lg.id && rr.round_number === lg.current_round
          ) || null;
        setRound(r);

        const ts = (s?.teams || []).filter((t: any) => t.league_id === lg.id);
        setTeams([...ts].sort((a, b) => a.name.localeCompare(b.name)));
      } finally {
        setLoading(false);
      }
    })();
  }, [activeLeagueId, reloadTick]);

  const byTeamId = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of teams) m.set(t.id, t);
    return m;
  }, [teams]);

  const memberships = useMemo(() => {
    if (!store || !league) return [];
    return (store.memberships || []).filter(
      (m: any) => m.league_id === league.id && m.is_active
    );
  }, [store, league]);

  const playersById = useMemo(() => {
    const map: Record<string, any> = {};
    if (!store) return map;
    for (const p of store.players || []) map[p.id] = p;
    return map;
  }, [store]);

  // Picks for this round
  const roundPicks = useMemo(() => {
    if (!store || !league || !round) return [];
    return (store.picks || []).filter(
      (p: any) => p.league_id === league.id && p.round_id === round.id
    );
  }, [store, league, round]);

  // KPIs
  const kpis = useMemo(() => {
    const entrants = memberships.length;

    const picksSubmitted = roundPicks.filter(
      (p: any) => p.status !== "no-pick"
    ).length;
    const noPick = roundPicks.filter((p: any) => p.status === "no-pick").length;

    const through = roundPicks.filter(
      (p: any) => p.status === "through"
    ).length;
    const eliminated = roundPicks.filter(
      (p: any) => p.status === "eliminated"
    ).length;
    const pending = roundPicks.filter(
      (p: any) => p.status === "pending"
    ).length;

    // unique teams picked this round
    const uniqueTeams = new Set<string>();
    for (const p of roundPicks) if (p.team_id) uniqueTeams.add(p.team_id);
    const uniqueTeamCount = uniqueTeams.size;

    // most picked team
    const pickCounts = new Map<string, number>();
    for (const p of roundPicks) {
      if (!p.team_id) continue;
      pickCounts.set(p.team_id, (pickCounts.get(p.team_id) || 0) + 1);
    }
    let mostPicked: { teamName: string; count: number } | null = null;
    for (const [tid, count] of pickCounts) {
      const name = byTeamId.get(tid)?.name ?? "—";
      if (!mostPicked || count > mostPicked.count)
        mostPicked = { teamName: name, count };
    }

    return {
      entrants,
      picksSubmitted,
      noPick,
      through,
      eliminated,
      pending,
      uniqueTeamCount,
      mostPicked,
    };
  }, [memberships, roundPicks, byTeamId]);

  // Fixture list for this round
  const fixtures = useMemo(() => {
    if (!store || !round) return [];
    return (store.fixtures || [])
      .filter((f: any) => f.round_id === round.id)
      .map((f: any) => ({
        ...f,
        homeName: byTeamId.get(f.home_team_id)?.name ?? "—",
        awayName: byTeamId.get(f.away_team_id)?.name ?? "—",
      }))
      .sort((a: any, b: any) => {
        const at = a.kickoff_utc ? Date.parse(a.kickoff_utc) : 0;
        const bt = b.kickoff_utc ? Date.parse(b.kickoff_utc) : 0;
        return at - bt;
      });
  }, [store, round, byTeamId]);

  // Per-team pick popularity (top 5)
  const popularity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of roundPicks) {
      if (!p.team_id) continue;
      counts.set(p.team_id, (counts.get(p.team_id) || 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([tid, count]) => ({
        team: byTeamId.get(tid)?.name ?? "—",
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const max = rows[0]?.count ?? 1;
    return rows.map((r) => ({ ...r, pct: clamp01(r.count / max) }));
  }, [roundPicks, byTeamId]);

  // Who picked what (sample table, top 12)
  const whoPicked = useMemo(() => {
    const rows = roundPicks
      .map((p: any) => ({
        player:
          playersById[p.player_id]?.display_name ?? p.player_id.slice(0, 6),
        team: byTeamId.get(p.team_id)?.name ?? "—",
        status: p.status as "pending" | "through" | "eliminated" | "no-pick",
        reason: p.reason ?? "",
      }))
      .sort((a, b) => a.player.localeCompare(b.player))
      .slice(0, 12);
    return rows;
  }, [roundPicks, playersById, byTeamId]);

  const deadlineInfo = formatCountdown(round?.pick_deadline_utc);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="animate-pulse text-slate-500">
          Loading league summary…
        </div>
      </div>
    );
  }

  if (!league || !round) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-lg text-center space-y-4">
          <div className="flex justify-center">
            <GameSelector
              label="Select game"
              onChange={(id) => {
                setActiveLeagueId(id);
                setReloadTick((x) => x + 1);
              }}
            />
          </div>
          <h2 className="text-xl font-semibold">No league selected</h2>
          <p className="text-slate-600">
            Pick a game from the selector or create one in Admin.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              className="rounded-lg border px-4 py-2 hover:bg-slate-50"
              onClick={() => navigate("/admin")}
            >
              Go to Admin
            </button>
            <button
              className="rounded-lg border px-4 py-2 hover:bg-slate-50"
              onClick={() => navigate("/live")}
            >
              View Live Games
            </button>
          </div>
        </div>
      </div>
    );
  }

  const pickRatio = kpis.entrants ? kpis.picksSubmitted / kpis.entrants : 0;

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Page-level game selector */}
      <div className="mb-3 flex justify-end">
        <GameSelector
          label="Viewing game"
          onChange={(id) => {
            setActiveLeagueId(id);
            setReloadTick((x) => x + 1);
          }}
        />
      </div>

      {/* Premium Hero */}
      <div className="relative overflow-hidden rounded-3xl border shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500 opacity-90" />
        <div className="relative p-5 md:p-7 text-white">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {leagueStatusPill(league.status)}
                <span className="text-xs/5 opacity-90">
                  GW {round.round_number} •{" "}
                  {round.pick_deadline_utc
                    ? new Date(
                        round.pick_deadline_utc
                      ).toLocaleString()
                    : "—"}
                </span>
              </div>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold leading-tight drop-shadow-sm">
                {league.name}
              </h1>
              <div className="mt-1 text-sm opacity-90">
                Deadline in:{" "}
                <span
                  className={[
                    "inline-block rounded-md px-2 py-0.5 font-medium",
                    deadlineInfo.overdue ? "bg-white/20" : "bg-black/20",
                  ].join(" ")}
                >
                  {deadlineInfo.label}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate("/make-pick")}
                className="rounded-lg bg-white text-slate-900 px-4 py-2 font-medium hover:bg-slate-100 transition"
              >
                Make / Change Pick
              </button>
              <button
                onClick={() => navigate("/leaderboard")}
                className="rounded-lg bg-white/10 backdrop-blur px-4 py-2 font-medium hover:bg-white/15 transition"
              >
                Leaderboard
              </button>
              <button
                onClick={() => navigate("/admin")}
                className="rounded-lg bg-white/10 backdrop-blur px-4 py-2 font-medium hover:bg-white/15 transition"
              >
                Admin
              </button>
            </div>
          </div>

          {/* Picks progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs opacity-90">
              <span>Picks submitted</span>
              <span>
                {kpis.picksSubmitted}/{kpis.entrants}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-white/30">
              <div
                className="h-2 rounded-full bg-white"
                style={{ width: `${Math.round(clamp01(pickRatio) * 100)}%` }}
              />
            </div>
            {kpis.noPick > 0 && (
              <div className="mt-1 text-[11px] opacity-80">
                {kpis.noPick} with no pick yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard title="Entrants" value={kpis.entrants} glow />
        <StatCard
          title="Picks Submitted"
          value={kpis.picksSubmitted}
          subtitle={`${kpis.noPick} no-pick`}
          glow
        />
        <StatCard title="Unique Teams" value={kpis.uniqueTeamCount} glow />
        <StatCard
          title="Most Picked"
          value={kpis.mostPicked ? kpis.mostPicked.teamName : "—"}
          subtitle={
            kpis.mostPicked ? `${kpis.mostPicked.count} picks` : ""
          }
          glow
        />
        <StatCard title="Through" value={kpis.through} />
        <StatCard title="Eliminated" value={kpis.eliminated} />
        <StatCard title="Pending" value={kpis.pending} />
        <StatCard
          title="League Status"
          value={<span className="uppercase">{league.status}</span>}
        />
      </div>

      {/* Two-column layout */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Fixtures */}
        <div className="lg:col-span-2 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Fixtures — Round {round.round_number}
            </h2>
            <button
              onClick={() => navigate("/admin")}
              className="text-xs rounded-md border px-2 py-1 hover:bg-slate-50"
              title="Fetch fixtures / auto-evaluate in Admin"
            >
              Manage in Admin
            </button>
          </div>

          {fixtures.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">Home</th>
                    <th className="px-3 py-2 text-left">Away</th>
                    <th className="px-3 py-2 text-left">Kickoff</th>
                    <th className="px-3 py-2 text-left">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fixtures.map((f: any, i: number) => {
                    let resultEl: React.ReactNode = pill(
                      "bg-slate-100 text-slate-700",
                      "Pending"
                    );
                    if (f.result === "home_win")
                      resultEl = pill(
                        "bg-emerald-100 text-emerald-700",
                        `${f.homeName} win`
                      );
                    else if (f.result === "away_win")
                      resultEl = pill(
                        "bg-blue-100 text-blue-700",
                        `${f.awayName} win`
                      );
                    else if (f.result === "draw")
                      resultEl = pill(
                        "bg-amber-100 text-amber-800",
                        "Draw"
                      );

                    return (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {f.homeName}
                        </td>
                        <td className="px-3 py-2">{f.awayName}</td>
                        <td className="px-3 py-2">
                          {f.kickoff_utc
                            ? new Date(f.kickoff_utc).toLocaleString()
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{resultEl}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              No fixtures stored for this round yet. Use{" "}
              <b>Admin → Fetch Fixtures (EPL)</b>.
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Popularity */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-base font-semibold">
              Top Picks (Round)
            </h3>
            {popularity.length ? (
              <ul className="space-y-2">
                {popularity.map((row, i) => (
                  <li key={i}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{row.team}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {row.count}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-teal-500 transition-all"
                        style={{ width: `${Math.round(row.pct * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500">No picks yet.</div>
            )}
          </div>

          {/* Who picked (sample) */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-base font-semibold">
              Who Picked (sample)
            </h3>
            {whoPicked.length ? (
              <ul className="space-y-2">
                {whoPicked.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                        {initials(r.player)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {r.player}
                        </div>
                        <div className="truncate text-xs text-slate-600">
                          {r.team}
                        </div>
                      </div>
                    </div>
                    <div title={r.reason || undefined}>
                      {statusPill(r.status)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-slate-500">
                No picks recorded.
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-base font-semibold">Quick Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => navigate("/make-pick")}
              >
                Make/Change Pick
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => navigate("/leaderboard")}
              >
                League Leaderboard
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => navigate("/eliminations")}
              >
                Elimination History
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => navigate("/results")}
              >
                Results
              </button>
              <button
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
                onClick={() => navigate("/admin")}
              >
                Admin
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LeagueSummary;
