// src/pages/Results.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";
import { LeagueStatusBanner } from "../components/LeagueStatusBanner";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";
import { useFirstPickGuidance } from "../hooks/useFirstPickGuidance";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import { isRoundRevealable } from "../lib/roundReveal";

const STORE_KEY = "lms_store_v1";

type Row = {
  player: string;
  team: string;
  status: "pending" | "through" | "eliminated" | "no-pick";
  reason: string;
};

type FilterKey = "all" | "pending" | "through" | "eliminated" | "no-pick";

export function Results() {
  const navigate = useNavigate();
  const [leagueId, setLeagueId] = useState<string>(
    () => localStorage.getItem("active_league_id") || ""
  );
  const [viewerId, setViewerId] = useState<string>("");
  const [rounds, setRounds] = useState<any[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState<string>("");
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, any>>({});
  const [winnerPlayerId, setWinnerPlayerId] = useState<string>("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [reloadTick, setReloadTick] = useState(0);
  const guidance = useFirstPickGuidance(leagueId);

  useEffect(() => {
    if (!leagueId) {
      setViewerId("");
      setRounds([]);
      setSelectedRoundId("");
      setRound(null);
      setTeams([]);
      setPicks([]);
      setMemberships([]);
      setPlayersById({});
      setWinnerPlayerId("");
      return;
    }

    (async () => {
      const initial = await loadLeagueRoundState(leagueId, selectedRoundId);
      const allRounds = initial.rounds ?? [];
      setRounds(allRounds);
      const nextSelectedRoundId =
        selectedRoundId && allRounds.some((rr: any) => rr.id === selectedRoundId)
          ? selectedRoundId
          : initial.round?.id ?? "";
      if (nextSelectedRoundId !== selectedRoundId) {
        setSelectedRoundId(nextSelectedRoundId);
        return;
      }
      const state =
        nextSelectedRoundId === initial.round?.id
          ? initial
          : await loadLeagueRoundState(leagueId, nextSelectedRoundId);
      setViewerId(state.viewerId);
      setRound(state.round);
      setTeams(state.teams);
      setPicks(state.selectedRoundEntries);
      setMemberships(state.memberships);
      setPlayersById(state.playersById);
      setWinnerPlayerId(state.winnerPlayerId ?? "");
    })();
  }, [leagueId, reloadTick, selectedRoundId]);

  const revealable = useMemo(() => isRoundRevealable(round), [round]);

  const visiblePicks = useMemo(() => {
    if (revealable) return picks || [];
    if (!viewerId) return [];
    return (picks || []).filter((p: any) => p.player_id === viewerId);
  }, [picks, revealable, viewerId]);

  const rows: Row[] = useMemo(() => {
    if (!round) return [];
    const teamName = (id?: string | null) =>
      id ? teams.find((t: any) => t.id === id)?.name ?? "\u2014" : "No pick";
    return (visiblePicks || []).map((p: any) => ({
      player: playersById[p.player_id]?.display_name ?? p.player_id.slice(0, 6),
      team: teamName(p.team_id),
      status: (p.status ?? "pending") as Row["status"],
      reason:
        winnerPlayerId && String(p.player_id) === String(winnerPlayerId)
          ? "Winner"
          : p.status === "no-pick"
          ? "No pick submitted"
          : p.reason ?? "",
    }));
  }, [round, teams, playersById, visiblePicks, winnerPlayerId]);

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

  const showGuidance =
    guidance.shouldGuide &&
    selectedRoundId === guidance.currentRoundId &&
    rows.length === 0;

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
      <div className="mb-4">
        <LeagueStatusBanner leagueId={leagueId} />
      </div>
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
          <select
            className="rounded border px-2 py-1 text-sm"
            value={selectedRoundId}
            onChange={(e) => setSelectedRoundId(e.target.value)}
          >
            {rounds.map((r: any) => (
              <option key={r.id} value={r.id}>
                Round {r.round_number}
              </option>
            ))}
          </select>
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setSelectedRoundId("");
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
      </div>

      <div className="mb-3 text-xs text-slate-600">
        {!revealable && "Only your pick is visible until the deadline."}
        {revealable && "All picks are visible after the deadline."}
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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <div className="font-semibold">
            {showGuidance
              ? "Results will appear once picks have been submitted."
              : "No picks submitted for this round yet."}
          </div>
          {!showGuidance && (
            <div className="mt-1 text-slate-600">
              Results will appear here once picks have been submitted and the round is processed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}



