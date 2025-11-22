// src/pages/Leaderboard.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";

const STORE_KEY = "lms_store_v1";

type Row = {
  playerId: string;
  name: string;
  state: "Alive" | "Eliminated" | "No Pick";
  throughCount: number;
  eliminatedIn?: number;
  lastPickTeam?: string;
  usedTeamsCount: number;
};

export function Leaderboard() {
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [sortKey, setSortKey] = useState<keyof Row>("state");
  const [asc, setAsc] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!leagueId) return;

    (async () => {
      const r = await dataService.getCurrentRound(leagueId);
      setRound(r);
      const ts = await dataService.listTeams(leagueId);
      setTeams(ts || []);
    })();
  }, [leagueId, reloadTick]);

  useEffect(() => {
    if (!leagueId) {
      setRows([]);
      return;
    }

    // Build table from store
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const players: any[] = raw.players || [];
    const rounds: any[] = (raw.rounds || []).filter(
      (rr: any) => rr.league_id === leagueId
    );
    const picks: any[] = (raw.picks || []).filter(
      (p: any) => p.league_id === leagueId
    );
    const memberships: any[] = (raw.memberships || []).filter(
      (m: any) => m.league_id === leagueId && m.is_active
    );

    const roundsById = new Map(rounds.map((r) => [r.id, r]));
    const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "—";

    const out: Row[] = memberships.map((m) => {
      const player = players.find((p) => p.id === m.player_id);
      const playerPicks = picks.filter((p) => p.player_id === m.player_id);
      const usedTeams = new Set(playerPicks.map((p) => p.team_id));

      // Compute through count and elimination round
      let throughCount = 0;
      let eliminatedIn: number | undefined;
      let lastPickTeam: string | undefined;
      let state: Row["state"] = "Alive";

      // order picks by round_number
      const ordered = [...playerPicks].sort((a, b) => {
        const ra = roundsById.get(a.round_id)?.round_number ?? 0;
        const rb = roundsById.get(b.round_id)?.round_number ?? 0;
        return ra - rb;
      });

      for (const p of ordered) {
        const rr = roundsById.get(p.round_id);
        lastPickTeam = teamName(p.team_id);
        if (!rr) continue;
        if (p.status === "through") throughCount++;
        if (p.status === "eliminated") {
          eliminatedIn = rr.round_number;
          state = "Eliminated";
          break;
        }
        if (p.status === "no-pick") {
          eliminatedIn = rr.round_number;
          state = "No Pick";
          break;
        }
      }

      // If never picked yet and round is ongoing, they’re Alive with 0 through
      const name = player?.display_name ?? m.player_id.slice(0, 6);

      return {
        playerId: m.player_id,
        name,
        state,
        throughCount,
        eliminatedIn,
        lastPickTeam,
        usedTeamsCount: usedTeams.size,
      };
    });

    setRows(out);
  }, [leagueId, teams, reloadTick]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const dir = asc ? 1 : -1;
      if (sortKey === "state") {
        // Alive > No Pick > Eliminated
        const rank = (s: Row["state"]) =>
          s === "Alive" ? 2 : s === "No Pick" ? 1 : 0;
        return (rank(a.state) - rank(b.state)) * dir;
      }
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return 0;
    });
    return copy;
  }, [rows, sortKey, asc]);

  function th(key: keyof Row, label: string, className = "") {
    const active = sortKey === key;
    return (
      <th className={"px-3 py-2 text-left " + className}>
        <button
          className={
            "w-full text-left " + (active ? "underline font-semibold" : "")
          }
          onClick={() => {
            if (active) setAsc((x) => !x);
            else {
              setSortKey(key);
              setAsc(false);
            }
          }}
        >
          {label} {active ? (asc ? "▲" : "▼") : ""}
        </button>
      </th>
    );
  }

  if (!leagueId) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">League Leaderboard</h2>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <p className="text-slate-600 text-sm">
          Pick a game from the selector above or in the header to view the
          leaderboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h2 className="text-2xl font-bold mb-1">League Leaderboard</h2>
          <p className="text-slate-600">
            Round {round?.round_number ?? "—"}
          </p>
        </div>
        <GameSelector
          label="Viewing game"
          onChange={(id) => {
            setLeagueId(id);
            setReloadTick((x) => x + 1);
          }}
        />
      </div>

      {sorted.length ? (
        <div className="overflow-x-auto mt-3">
          <table className="min-w-full text-sm border border-slate-200">
            <thead className="bg-slate-100">
              <tr>
                {th("name", "Player")}
                {th("state", "State")}
                {th("throughCount", "Rounds Survived")}
                {th("usedTeamsCount", "Teams Used")}
                {th("lastPickTeam", "Last Pick")}
                {th("eliminatedIn", "Eliminated In")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.playerId} className="border-t">
                  <td className="px-3 py-2">{r.name}</td>
                  <td
                    className={
                      "px-3 py-2 " +
                      (r.state === "Alive"
                        ? "text-green-700"
                        : r.state === "No Pick"
                        ? "text-amber-700"
                        : "text-red-700")
                    }
                  >
                    {r.state}
                  </td>
                  <td className="px-3 py-2">{r.throughCount}</td>
                  <td className="px-3 py-2">{r.usedTeamsCount}</td>
                  <td className="px-3 py-2">{r.lastPickTeam ?? "—"}</td>
                  <td className="px-3 py-2">{r.eliminatedIn ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 text-slate-500">No members yet.</div>
      )}
    </div>
  );
}
