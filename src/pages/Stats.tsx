// src/pages/Stats.tsx
import React, { useEffect, useMemo, useState } from "react";
import { fetchFplTeams, fetchFplFixtures } from "../lib/fpl";

type FplTeam = {
  id: number;
  name: string;
  short_name: string;
};

type FplFixture = {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  finished: boolean;
  finished_provisional: boolean;
  kickoff_time: string | null;
};

type TableRow = {
  teamId: number;
  name: string;
  shortName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  form: ("W" | "D" | "L")[];
  nextFixtures: {
    event: number;
    oppShort: string;
    home: boolean;
    kickoff: string | null;
  }[];
};

export function Stats() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TableRow[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [teams, fixtures] = await Promise.all([
        fetchFplTeams(),
        fetchFplFixtures(),
      ]);

      const table = buildTable(teams, fixtures);
      setRows(table);
      setLastUpdated(new Date().toLocaleString());
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const currentGw = useMemo(() => {
    if (!rows.length) return null;
    // Rough “current GW” = highest event seen in any fixture used
    // This is mainly for display; table itself is already calculated.
    const events: number[] = [];
    rows.forEach((r) => {
      r.nextFixtures.forEach((nf) => {
        if (nf.event) events.push(nf.event);
      });
    });
    if (!events.length) return null;
    return Math.min(...events); // next upcoming GW
  }, [rows]);

  function formDot(result: "W" | "D" | "L", i: number) {
    const base =
      "h-2.5 w-2.5 rounded-full inline-block mr-1 border border-white shadow-sm";
    if (result === "W") return <span key={i} className={base + " bg-emerald-500"} />;
    if (result === "D") return <span key={i} className={base + " bg-amber-400"} />;
    return <span key={i} className={base + " bg-rose-500"} />;
  }

  if (loading && !rows.length) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-slate-500 animate-pulse">
          Loading live Premier League table…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="card p-6">
          <h2 className="text-lg font-semibold mb-2">Stats</h2>
          <p className="text-sm text-rose-600 mb-3">{error}</p>
          <button onClick={load} className="btn btn-primary text-sm">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-3xl border shadow-sm mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-teal-600 via-emerald-600 to-cyan-500 opacity-95" />
        <div className="relative p-5 md:p-7 text-white flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-black/15 px-3 py-1 text-xs font-medium mb-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Live Premier League Stats
            </div>
            <h1 className="text-2xl md:text-3xl font-bold leading-tight drop-shadow-sm">
              Premier League Table
            </h1>
            <p className="mt-1 text-sm text-white/85">
              Auto-computed from FPL fixtures — updates as soon as results are
              final, not just when LMS rounds change.
            </p>
            {currentGw && (
              <p className="mt-1 text-xs text-white/80">
                Upcoming Gameweek focus: <b>GW {currentGw}</b>
              </p>
            )}
          </div>
          <div className="flex flex-col items-start md:items-end gap-2">
            <button onClick={load} className="btn btn-primary text-sm">
              Refresh from FPL
            </button>
            <p className="text-[11px] text-white/80">
              Last updated: {lastUpdated ?? "—"}
            </p>
            <div className="flex items-center gap-2 text-[11px] text-white/80">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                W
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                D
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-rose-500" />
                L
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b">
              <tr>
                <th className="px-2 sm:px-3 py-2 text-left">Pos</th>
                <th className="px-2 sm:px-3 py-2 text-left">Team</th>
                <th className="px-2 sm:px-3 py-2 text-center">P</th>
                <th className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                  W
                </th>
                <th className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                  D
                </th>
                <th className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                  L
                </th>
                <th className="px-2 sm:px-3 py-2 text-center hidden md:table-cell">
                  GF
                </th>
                <th className="px-2 sm:px-3 py-2 text-center hidden md:table-cell">
                  GA
                </th>
                <th className="px-2 sm:px-3 py-2 text-center">GD</th>
                <th className="px-2 sm:px-3 py-2 text-center">Pts</th>
                <th className="px-2 sm:px-3 py-2 text-left">Form (last 5)</th>
                <th className="px-2 sm:px-3 py-2 text-left hidden lg:table-cell">
                  Next 5 fixtures
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row, idx) => (
                <tr key={row.teamId} className="hover:bg-slate-50">
                  <td className="px-2 sm:px-3 py-2 text-left text-slate-500">
                    {idx + 1}
                  </td>
                  <td className="px-2 sm:px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">
                        {row.name}
                      </span>
                      <span className="text-[11px] text-slate-500 uppercase">
                        {row.shortName}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center">
                    {row.played}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                    {row.won}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                    {row.drawn}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center hidden sm:table-cell">
                    {row.lost}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center hidden md:table-cell">
                    {row.gf}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center hidden md:table-cell">
                    {row.ga}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center font-medium">
                    {row.gd}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-center font-semibold">
                    {row.points}
                  </td>
                  <td className="px-2 sm:px-3 py-2">
                    {row.form.length ? (
                      <div className="flex items-center">
                        {row.form.map((f, i) => formDot(f, i))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        No data
                      </span>
                    )}
                  </td>
                  <td className="px-2 sm:px-3 py-2 text-left align-top hidden lg:table-cell">
                    {row.nextFixtures.length ? (
                      <div className="flex flex-wrap gap-1">
                        {row.nextFixtures.map((nf, i) => (
                          <span
                            key={`${row.teamId}-${nf.event}-${i}`}
                            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                          >
                            {nf.oppShort}{" "}
                            <span className="ml-1 text-[10px] text-slate-500">
                              {nf.home ? "(H)" : "(A)"}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        No upcoming fixtures
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile-only "next fixtures" hint */}
        <div className="border-t px-4 py-3 text-[11px] text-slate-500 lg:hidden">
          Tip: Turn your phone sideways or open on desktop to see the full next-5
          fixture list per team.
        </div>
      </div>
    </div>
  );
}

export default Stats;

/* ---------------------- Helpers: league table builder ---------------------- */

function buildTable(teams: FplTeam[], fixtures: FplFixture[]): TableRow[] {
  const byId = new Map<number, FplTeam>();
  teams.forEach((t) => byId.set(t.id, t));

  // Finished fixtures only, with scores
  const finished = fixtures.filter(
    (f) =>
      f.event != null &&
      f.finished &&
      f.team_h_score != null &&
      f.team_a_score != null
  );

  // Determine "current" / next event roughly
  const maxFinishedEvent = finished.reduce(
    (max, f) => (f.event && f.event > max ? f.event : max),
    0
  );
  const currentEvent = maxFinishedEvent || 1;

  // Stats accumulator
  const acc = new Map<number, TableRow>();

  function ensureRow(teamId: number): TableRow {
    let row = acc.get(teamId);
    if (!row) {
      const t = byId.get(teamId)!;
      row = {
        teamId,
        name: t?.name ?? `Team ${teamId}`,
        shortName: t?.short_name ?? "–",
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        points: 0,
        form: [],
        nextFixtures: [],
      };
      acc.set(teamId, row);
    }
    return row;
  }

  // Build table & form from finished fixtures
  for (const f of finished) {
    const home = ensureRow(f.team_h);
    const away = ensureRow(f.team_a);

    home.played++;
    away.played++;

    home.gf += f.team_h_score!;
    home.ga += f.team_a_score!;
    away.gf += f.team_a_score!;
    away.ga += f.team_h_score!;

    if (f.team_h_score! > f.team_a_score!) {
      home.won++;
      away.lost++;
      home.points += 3;
      home.form.push("W");
      away.form.push("L");
    } else if (f.team_h_score! < f.team_a_score!) {
      away.won++;
      home.lost++;
      away.points += 3;
      away.form.push("W");
      home.form.push("L");
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
      home.form.push("D");
      away.form.push("D");
    }
  }

  // Clamp form to last 5 (most recent)
  // We don't know exact order inside FPL per team, so we approximate by trimming to 5
  acc.forEach((row) => {
    if (row.form.length > 5) {
      row.form = row.form.slice(row.form.length - 5);
    }
    row.gd = row.gf - row.ga;
  });

  // Upcoming fixtures: next 5 from currentEvent onwards
  const upcoming = fixtures.filter(
    (f) =>
      f.event != null &&
      (f.event >= currentEvent) &&
      (!f.finished || f.team_h_score == null || f.team_a_score == null)
  );

  const nextByTeam = new Map<number, TableRow["nextFixtures"]>();

  for (const f of upcoming) {
    const homeList = nextByTeam.get(f.team_h) ?? [];
    const awayList = nextByTeam.get(f.team_a) ?? [];
    const homeOpp = byId.get(f.team_a)?.short_name ?? "—";
    const awayOpp = byId.get(f.team_h)?.short_name ?? "—";

    if (homeList.length < 5) {
      homeList.push({
        event: f.event!,
        oppShort: homeOpp,
        home: true,
        kickoff: f.kickoff_time,
      });
      nextByTeam.set(f.team_h, homeList);
    }
    if (awayList.length < 5) {
      awayList.push({
        event: f.event!,
        oppShort: awayOpp,
        home: false,
        kickoff: f.kickoff_time,
      });
      nextByTeam.set(f.team_a, awayList);
    }
  }

  nextByTeam.forEach((fixtures, teamId) => {
    const row = ensureRow(teamId);
    row.nextFixtures = fixtures.sort((a, b) => a.event - b.event).slice(0, 5);
  });

  // Convert map → sorted array
  const table = Array.from(acc.values());
  table.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });

  return table;
}
