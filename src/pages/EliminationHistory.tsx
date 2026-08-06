import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GameSelector } from "../components/GameSelector";
import { LeagueStatusBanner } from "../components/LeagueStatusBanner";
import { useFirstPickGuidance } from "../hooks/useFirstPickGuidance";
import { loadLeagueRoundState } from "../lib/leagueRoundState";

type Row = {
  roundNumber: number;
  playerName: string;
  teamName: string;
  reason: string;
  when: string;
};

export function EliminationHistory() {
  const navigate = useNavigate();
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [rounds, setRounds] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, any>>({});
  const [roundFilter, setRoundFilter] = useState<number | "all">("all");
  const [q, setQ] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const guidance = useFirstPickGuidance(leagueId);

  useEffect(() => {
    if (!leagueId) {
      setRounds([]);
      setTeams([]);
      setPicks([]);
      setPlayersById({});
      return;
    }

    (async () => {
      const state = await loadLeagueRoundState(leagueId);
      setRounds(state.rounds || []);
      setTeams(state.teams || []);
      setPicks(state.allLeaguePicks || []);
      setPlayersById(state.playersById || {});
    })();
  }, [leagueId, reloadTick]);

  const rows = useMemo(() => {
    if (!leagueId) return [];
    const byRound = new Map<string, any>(rounds.map((round) => [round.id, round]));
    const byTeam = new Map<string, string>(teams.map((team) => [team.id, team.name]));

    return (picks || [])
      .filter((pick: any) => pick.league_id === leagueId)
      .filter((pick: any) => pick.status === "eliminated" || pick.status === "no-pick")
      .map((pick: any) => {
        const round = byRound.get(pick.round_id);
        return {
          roundNumber: round?.round_number ?? 0,
          playerName: playersById[pick.player_id]?.display_name ?? pick.player_id.slice(0, 6),
          teamName: byTeam.get(pick.team_id) ?? "—",
          reason: pick.reason ?? (pick.status === "no-pick" ? "no-pick" : "loss"),
          when: round?.pick_deadline_utc ?? "",
        } as Row;
      });
  }, [leagueId, picks, playersById, rounds, teams]);

  const filtered = useMemo(() => {
    let next = [...rows];
    if (roundFilter !== "all") {
      next = next.filter((row) => row.roundNumber === roundFilter);
    }
    if (q.trim()) {
      const needle = q.toLowerCase();
      next = next.filter(
        (row) =>
          row.playerName.toLowerCase().includes(needle) ||
          row.teamName.toLowerCase().includes(needle) ||
          row.reason.toLowerCase().includes(needle)
      );
    }
    next.sort(
      (a, b) => b.roundNumber - a.roundNumber || a.playerName.localeCompare(b.playerName)
    );
    return next;
  }, [q, roundFilter, rows]);

  if (!leagueId) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">Elimination History</h2>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((value) => value + 1);
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
      <div className="mb-4">
        <LeagueStatusBanner leagueId={leagueId} />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Elimination History</h2>
        <GameSelector
          label="Viewing game"
          onChange={(id) => {
            setLeagueId(id);
            setReloadTick((value) => value + 1);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select
          className="border rounded px-2 py-1"
          value={String(roundFilter)}
          onChange={(event) => {
            const value = event.target.value;
            setRoundFilter(value === "all" ? "all" : Number(value));
          }}
        >
          <option value="all">All rounds</option>
          {rounds
            .slice()
            .sort((a, b) => a.round_number - b.round_number)
            .map((round) => (
              <option key={round.id} value={round.round_number}>
                Round {round.round_number}
              </option>
            ))}
        </select>

        <input
          className="border rounded px-2 py-1"
          placeholder="Search player/team/reason..."
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {guidance.shouldGuide && filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <div className="font-semibold">Make your pick first.</div>
          <div className="mt-1 text-slate-600">
            Eliminations appear after picks are processed.
          </div>
          <button
            type="button"
            className="btn btn-primary mt-4"
            onClick={() => navigate("/make-pick")}
          >
            Make Pick
          </button>
        </div>
      ) : filtered.length ? (
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
              {filtered.map((row, index) => (
                <tr key={`${row.playerName}-${row.roundNumber}-${index}`} className="border-t">
                  <td className="px-3 py-2">R{row.roundNumber}</td>
                  <td className="px-3 py-2">{row.playerName}</td>
                  <td className="px-3 py-2">{row.teamName}</td>
                  <td className="px-3 py-2 capitalize">
                    {row.reason === "no-pick" ? "No Pick" : row.reason}
                  </td>
                  <td className="px-3 py-2">
                    {row.when ? new Date(row.when).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <div className="font-semibold">No eliminations yet.</div>
          <div className="mt-1 text-slate-600">
            Eliminated players will appear here after a round is processed.
          </div>
        </div>
      )}
    </div>
  );
}
