// src/pages/EliminationHistory.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";

const STORE_KEY = "lms_store_v1";

type Row = {
  roundNumber: number;
  playerName: string;
  teamName: string;
  reason: string;
  when: string; // ISO of round lock, for context
};

export function EliminationHistory() {
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [rounds, setRounds] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, any>>({});
  const [roundFilter, setRoundFilter] = useState<number | "all">("all");
  const [q, setQ] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!leagueId) {
      setRounds([]);
      setTeams([]);
      setPlayersById({});
      return;
    }

    (async () => {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      const rs = (raw.rounds || []).filter((r: any) => r.league_id === leagueId);
      setRounds(rs);

      const ts = await dataService.listTeams(leagueId);
      setTeams(ts || []);

      const pb: Record<string, any> = {};
      (raw.players || []).forEach((p: any) => (pb[p.id] = p));
      setPlayersById(pb);
    })();
  }, [leagueId, reloadTick]);

  const rows = useMemo(() => {
    if (!leagueId) return [];
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const picks: any[] = (raw.picks || []).filter(
      (p: any) => p.league_id === leagueId
    );
    const byRound = new Map<string, any>(rounds.map((r) => [r.id, r]));
    const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "—";

    const eliminated = picks
      .filter((p) => p.status === "eliminated" || p.status === "no-pick")
      .map((p) => {
        const r = byRound.get(p.round_id);
        return {
          roundNumber: r?.round_number ?? 0,
          playerName:
            playersById[p.player_id]?.display_name ?? p.player_id.slice(0, 6),
          teamName: teamName(p.team_id),
          reason: p.reason ?? (p.status === "no-pick" ? "no-pick" : "loss"),
          when: r?.pick_deadline_utc ?? "",
        } as Row;
      });

    return eliminated;
  }, [leagueId, rounds, teams, playersById]);

  const filtered = useMemo(() => {
    let arr = [...rows];
    if (roundFilter !== "all") {
      arr = arr.filter((r) => r.roundNumber === roundFilter);
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      arr = arr.filter(
        (r) =>
          r.playerName.toLowerCase().includes(needle) ||
          r.teamName.toLowerCase().includes(needle) ||
          r.reason.toLowerCase().includes(needle)
      );
    }
    arr.sort(
      (a, b) =>
        b.roundNumber - a.roundNumber ||
        a.playerName.localeCompare(b.playerName)
    );
    return arr;
  }, [rows, roundFilter, q]);

  if (!leagueId) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Elimination History</h2>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <p className="text-slate-600 text-sm">
          Pick a game from the selector to view elimination history.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Elimination History</h2>
        <GameSelector
          label="Viewing game"
          onChange={(id) => {
            setLeagueId(id);
            setReloadTick((x) => x + 1);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          className="border rounded px-2 py-1"
          value={String(roundFilter)}
          onChange={(e) => {
            const v = e.target.value;
            setRoundFilter(v === "all" ? "all" : Number(v));
          }}
        >
          <option value="all">All rounds</option>
          {rounds
            .slice()
            .sort((a, b) => a.round_number - b.round_number)
            .map((r) => (
              <option key={r.id} value={r.round_number}>
                Round {r.round_number}
              </option>
            ))}
        </select>

        <input
          className="border rounded px-2 py-1"
          placeholder="Search player/team/reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-slate-200">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-3 py-2 text-left w-24">Round</th>
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Locked</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">R{r.roundNumber}</td>
                  <td className="px-3 py-2">{r.playerName}</td>
                  <td className="px-3 py-2">{r.teamName}</td>
                  <td className="px-3 py-2 capitalize">
                    {r.reason === "no-pick" ? "No Pick" : r.reason}
                  </td>
                  <td className="px-3 py-2">
                    {r.when ? new Date(r.when).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-slate-500">No eliminations yet.</div>
      )}
    </div>
  );
}
