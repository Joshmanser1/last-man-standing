// src/pages/Leaderboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const STORE_KEY = "lms_store_v1";

type ID = string;

type League = {
  id: ID;
  name: string;
  current_round: number;
  fpl_start_event?: number;
};

type Round = {
  id: ID;
  league_id: ID;
  round_number: number;
  status: "upcoming" | "locked" | "completed";
  pick_deadline_utc?: string;
};

type Player = { id: ID; display_name: string };
type Membership = {
  id: ID;
  league_id: ID;
  player_id: ID;
  is_active: boolean;
  joined_at: string;
  final_position?: number;
};
type Pick = {
  id: ID;
  league_id: ID;
  round_id: ID;
  player_id: ID;
  team_id: ID;
  status: "pending" | "through" | "eliminated" | "no-pick";
  reason?: "loss" | "draw" | "no-pick";
};
type Team = { id: ID; league_id: ID; name: string; code: string };
type Store = {
  leagues?: League[];
  rounds?: Round[];
  players?: Player[];
  memberships?: Membership[];
  picks?: Pick[];
  teams?: Team[];
};

type ViewMode = "leaderboard" | "matrix";

function readStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

function teamShort(name: string) {
  // Try FPL-ish 3-letter, otherwise first 3 letters
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 4) return cleaned;
  // Prefer capital letters if it's like "Man City" -> "MCI" style
  const caps = cleaned
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (caps.length >= 3 && caps.length <= 4) return caps.slice(0, 3);
  return cleaned.slice(0, 3);
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

export function Leaderboard() {
  const navigate = useNavigate();
  const [storeTick, setStoreTick] = useState(0);
  const [view, setView] = useState<ViewMode>("leaderboard");
  const [showElims, setShowElims] = useState(true);

  // active league
  const activeLeagueId = localStorage.getItem("active_league_id") || "";

  // re-poll local store when other pages mutate it
  useEffect(() => {
    const h = () => setStoreTick((x) => x + 1);
    window.addEventListener("lms:store-updated", h);
    return () => window.removeEventListener("lms:store-updated", h);
  }, []);

  const store = useMemo(() => readStore(), [storeTick]);

  const league: League | null = useMemo(() => {
    return (store.leagues || []).find((l) => l.id === activeLeagueId) || null;
  }, [store, activeLeagueId]);

  const rounds = useMemo<Round[]>(() => {
    if (!league) return [];
    return (store.rounds || [])
      .filter((r) => r.league_id === league.id)
      .sort((a, b) => a.round_number - b.round_number);
  }, [store, league]);

  const teamsById = useMemo(() => {
    const map = new Map<ID, Team>();
    for (const t of store.teams || []) map.set(t.id, t);
    return map;
  }, [store]);

  const playersById = useMemo(() => {
    const m = new Map<ID, Player>();
    for (const p of store.players || []) m.set(p.id, p);
    return m;
  }, [store]);

  const memberships = useMemo<Membership[]>(() => {
    if (!league) return [];
    return (store.memberships || []).filter((m) => m.league_id === league.id);
  }, [store, league]);

  const picksByPlayerByRound = useMemo(() => {
    // map: player -> (round_number -> pick)
    const map = new Map<ID, Map<number, Pick>>();
    if (!league) return map;
    const picks = (store.picks || []).filter((p) => p.league_id === league.id);
    const roundById = new Map<ID, Round>();
    for (const r of rounds) roundById.set(r.id, r);

    for (const p of picks) {
      const r = roundById.get(p.round_id);
      if (!r) continue;
      if (!map.has(p.player_id)) map.set(p.player_id, new Map());
      map.get(p.player_id)!.set(r.round_number, p);
    }
    return map;
  }, [store, league, rounds]);

  const rows = useMemo(() => {
    // One row per membership (player in league)
    const items = memberships.map((m) => {
      const player = playersById.get(m.player_id);
      const display = player?.display_name || "Unknown";
      const alive = !!m.is_active;
      const state = alive ? "Alive" : "Eliminated";
      const lastElimRound = (() => {
        if (alive) return undefined;
        // find earliest pick marked eliminated/no-pick
        let elim: number | undefined = undefined;
        const perRound = picksByPlayerByRound.get(m.player_id);
        if (perRound) {
          for (const [rd, p] of Array.from(perRound.entries()).sort(
            (a, b) => a[0] - b[0]
          )) {
            if (p.status === "eliminated" || p.status === "no-pick") {
              elim = rd;
              break;
            }
          }
        }
        return elim;
      })();

      // points = survivors first; if eliminated, rank by elim round descending
      const sortKey = alive ? 1e9 : lastElimRound ?? 0;

      return {
        membership: m,
        playerId: m.player_id,
        name: display,
        alive,
        state,
        sortKey,
      };
    });

    // Hide eliminated?
    const filtered = showElims ? items : items.filter((r) => r.alive);

    // Sort: alive first (sortKey high), then alphabetically
    filtered.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return a.name.localeCompare(b.name);
    });

    return filtered;
  }, [memberships, playersById, picksByPlayerByRound, showElims]);

  const maxRound =
    rounds.length > 0
      ? Math.max(...rounds.map((r) => r.round_number))
      : 0;

  function symbolForPick(p?: Pick) {
    if (!p) return "";
    const team = teamsById.get(p.team_id);
    const code = team ? teamShort(team.name) : "";
    if (p.status === "through") return `${code} ✓`;
    if (p.status === "eliminated" || p.status === "no-pick") return `${code} ✗`;
    // pending/locked/upcoming
    return `${code}`;
  }

  function exportCurrentView() {
    if (!league) return;

    if (view === "leaderboard") {
      const headers = ["Name", "State"];
      const lines = [headers.join(",")];

      for (const r of rows) {
        lines.push(
          [csvSafe(r.name), csvSafe(r.state)].join(",")
        );
      }
      downloadCSV(
        `${slug(league.name)}-leaderboard.csv`,
        lines.join("\r\n")
      );
      return;
    }

    // Matrix export
    const headers = ["Name", "State", ...Array.from({ length: maxRound }, (_, i) => `RD${i + 1}`)];
    const lines = [headers.join(",")];

    for (const r of rows) {
      const cells: string[] = [csvSafe(r.name), csvSafe(r.state)];
      const perRound = picksByPlayerByRound.get(r.playerId);
      for (let rd = 1; rd <= maxRound; rd++) {
        const p = perRound?.get(rd);
        cells.push(csvSafe(symbolForPick(p)));
      }
      lines.push(cells.join(","));
    }

    downloadCSV(
      `${slug(league.name)}-picks-matrix.csv`,
      lines.join("\r\n")
    );
  }

  if (!league) {
    return (
      <div className="container-page py-10 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="font-semibold mb-2">No active game selected</div>
          <button className="btn btn-primary" onClick={() => navigate("/live")}>
            Pick a game from Live
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-page py-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-lg font-semibold">
          {league.name} — Leaderboard
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={showElims}
              onChange={(e) => setShowElims(e.target.checked)}
            />
            Show eliminated
          </label>

          <div className="inline-flex rounded-xl bg-white border px-1 py-1 shadow-sm">
            <button
              className={
                "px-3 py-1.5 text-xs rounded-lg " +
                (view === "leaderboard"
                  ? "bg-teal-600 text-white"
                  : "text-slate-700 hover:bg-slate-100")
              }
              onClick={() => setView("leaderboard")}
            >
              Leaderboard
            </button>
            <button
              className={
                "px-3 py-1.5 text-xs rounded-lg " +
                (view === "matrix"
                  ? "bg-teal-600 text-white"
                  : "text-slate-700 hover:bg-slate-100")
              }
              onClick={() => setView("matrix")}
            >
              Picks Matrix
            </button>
          </div>

          <button className="btn btn-ghost text-xs" onClick={exportCurrentView}>
            Export CSV
          </button>
        </div>
      </div>

      {view === "leaderboard" ? (
        <div className="rounded-2xl border bg-white overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left w-[48px]">#</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.membership.id} className="border-t">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold " +
                        (r.alive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-700")
                      }
                    >
                      {r.state}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={3}>
                    No entrants yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white overflow-x-auto">
          <table className="min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">State</th>
                {Array.from({ length: maxRound }, (_, i) => (
                  <th key={i} className="px-3 py-2 text-left">{`RD${i + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const perRound = picksByPlayerByRound.get(r.playerId);
                return (
                  <tr key={r.membership.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{r.name}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold " +
                          (r.alive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-700")
                        }
                      >
                        {r.state}
                      </span>
                    </td>
                    {Array.from({ length: maxRound }, (_, i) => {
                      const rd = i + 1;
                      const p = perRound?.get(rd);
                      return (
                        <td key={rd} className="px-3 py-2">
                          {symbolForPick(p)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={2 + maxRound}>
                    No entrants yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Leaderboard;

// ----------------- helpers -----------------
function csvSafe(s: string) {
  if (s == null) return "";
  const needs = /[",\n\r]/.test(s);
  return needs ? `"${s.replace(/"/g, '""')}"` : s;
}
function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
