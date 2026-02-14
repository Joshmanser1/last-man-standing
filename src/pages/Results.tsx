// src/pages/Results.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";
import { useNotifications } from "../components/Notifications";
import { computeOutcome } from "../lib/outcome";

const STORE_KEY = "lms_store_v1";

type Row = {
  player: string;
  team: string;
  status: "pending" | "through" | "eliminated" | "no-pick";
  reason: string;
};

type FilterKey = "all" | "pending" | "through" | "eliminated" | "no-pick";

export function Results() {
  const { showOutcome } = useNotifications();
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState<FilterKey>("all");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!leagueId) return;

    (async () => {
      const r = await dataService.getCurrentRound(leagueId);
      setRound(r);

      const ts = await dataService.listTeams(leagueId);
      setTeams(ts || []);

      // load players (mock store)
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const pb: Record<string, any> = {};
        (s.players || []).forEach((p: any) => (pb[p.id] = p));
        setPlayersById(pb);
      }
    })();
  }, [leagueId, reloadTick]);

  useEffect(() => {
    if (!leagueId || !round) return;
    const playerId = localStorage.getItem("player_id");
    if (!playerId) return;

    const outcome = computeOutcome(leagueId, playerId);
    if (outcome) showOutcome(outcome);
  }, [leagueId, round, showOutcome]);

  const rows: Row[] = useMemo(() => {
    if (!round) return [];
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const picks = (raw.picks || []).filter((p: any) => p.round_id === round.id);
    const teamName = (id: string) => teams.find((t: any) => t.id === id)?.name ?? "—";
    return picks.map((p: any) => ({
      player: playersById[p.player_id]?.display_name ?? p.player_id.slice(0, 6),
      team: teamName(p.team_id),
      status: (p.status ?? "pending") as Row["status"],
      reason: p.reason ?? "",
    }));
  }, [round, teams, playersById]);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const base = { pending: 0, through: 0, eliminated: 0, "no-pick": 0 };
    for (const r of rows) (base as any)[r.status] += 1;
    return base;
  }, [rows]);

  function statusPill(s: Row["status"]) {
    const cls =
      s === "through"
        ? "bg-green-100 text-green-700"
        : s === "eliminated"
        ? "bg-red-100 text-red-700"
        : s === "no-pick"
        ? "bg-orange-100 text-orange-700"
        : "bg-slate-200 text-slate-700";
    return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{s}</span>;
  }

  if (!leagueId) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Results</h2>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <p className="text-slate-600 text-sm">
          Pick a game from the selector above or in the header to view results.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">
          Results — Round {round?.round_number ?? "—"}
        </h2>
        <div className="flex flex-col items-end gap-1">
          <div className="text-sm text-slate-600">
            <span className="mr-3">
              Pending: <b>{counts.pending}</b>
            </span>
            <span className="mr-3">
              Through: <b>{counts.through}</b>
            </span>
            <span className="mr-3">
              Eliminated: <b>{counts.eliminated}</b>
            </span>
            <span>
              No-pick: <b>{counts["no-pick"]}</b>
            </span>
          </div>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
      </div>

      {/* Quick filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          ["all", "pending", "through", "eliminated", "no-pick"] as FilterKey[]
        ).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={[
              "text-xs px-2 py-1 rounded border",
              filter === k
                ? "bg-teal-600 text-white border-teal-600"
                : "hover:bg-slate-50",
            ].join(" ")}
          >
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <table className="min-w-full text-sm border">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left">Pick</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i: number) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{r.player}</td>
                <td className="px-3 py-2">{r.team}</td>
                <td className="px-3 py-2">{statusPill(r.status)}</td>
                <td className="px-3 py-2">{r.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="text-slate-500">No picks yet.</div>
      )}
    </div>
  );
}
