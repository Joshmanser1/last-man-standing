// src/pages/Results.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { GameSelector } from "../components/GameSelector";
import { useNotifications } from "../components/Notifications";
import { computeOutcome } from "../lib/outcome";
import { supa } from "../lib/supabaseClient";

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
  const [leagueOwnerId, setLeagueOwnerId] = useState<string>("");
  const [viewerId, setViewerId] = useState<string>("");
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, any>>({});
  const [filter, setFilter] = useState<FilterKey>("all");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (!leagueId) {
      setLeagueOwnerId("");
      setViewerId("");
      setRound(null);
      setTeams([]);
      setPicks([]);
      setMemberships([]);
      setPlayersById({});
      return;
    }

    (async () => {
      const [{ data: authData }, { data: leagueRow }] = await Promise.all([
        supa.auth.getUser(),
        supa
          .from("leagues")
          .select("id, created_by")
          .eq("id", leagueId)
          .is("deleted_at", null)
          .maybeSingle(),
      ]);
      const authUid = authData?.user?.id ?? "";
      setViewerId(authUid);
      setLeagueOwnerId((leagueRow as any)?.created_by ?? "");

      const r = await dataService.getCurrentRound(leagueId);
      setRound(r);

      const ts = await dataService.listTeams(leagueId);
      setTeams(ts || []);

      let pickRows: any[] = [];
      if (r?.id) {
        const { data } = await supa
          .from("picks")
          .select("*")
          .eq("league_id", leagueId)
          .eq("round_id", r.id);
        pickRows = data ?? [];
      }
      setPicks(pickRows);

      const memberResp = await fetch("/api/league-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_id: leagueId }),
      });
      if (!memberResp.ok) throw new Error("Failed to load league members");
      const memberRows = (await memberResp.json()) as Array<any>;
      setMemberships(memberRows || []);
      const pb: Record<string, any> = {};
      (memberRows || []).forEach((m: any) => {
        if (typeof m.player_id === "string") {
          pb[m.player_id] = { id: m.player_id, display_name: m.display_name ?? null };
        }
      });
      setPlayersById(pb);
    })();
  }, [leagueId, reloadTick]);

  useEffect(() => {
    if (!leagueId || !round) return;
    const playerId = localStorage.getItem("player_id");
    if (!playerId) return;

    const outcome = computeOutcome(leagueId, playerId);
    if (outcome) showOutcome(outcome);
  }, [leagueId, round, showOutcome]);

  const isHost = useMemo(() => {
    if (!viewerId) return false;
    if (leagueOwnerId && leagueOwnerId === viewerId) return true;
    return memberships.some(
      (m: any) =>
        m.player_id === viewerId && (m.role === "owner" || m.role === "admin")
    );
  }, [viewerId, leagueOwnerId, memberships]);

  const afterDeadline = useMemo(() => {
    if (!round?.pick_deadline_utc) return true;
    return new Date(round.pick_deadline_utc).getTime() <= Date.now();
  }, [round]);

  const visiblePicks = useMemo(() => {
    if (afterDeadline || isHost) return picks || [];
    if (!viewerId) return [];
    return (picks || []).filter((p: any) => p.player_id === viewerId);
  }, [picks, afterDeadline, isHost, viewerId]);

  const rows: Row[] = useMemo(() => {
    if (!round) return [];
    const teamName = (id: string) => teams.find((t: any) => t.id === id)?.name ?? "—";
    return (visiblePicks || []).map((p: any) => ({
      player: playersById[p.player_id]?.display_name ?? p.player_id.slice(0, 6),
      team: teamName(p.team_id),
      status: (p.status ?? "pending") as Row["status"],
      reason: p.reason ?? "",
    }));
  }, [round, teams, playersById, visiblePicks]);

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

      <div className="mb-3 text-xs text-slate-600">
        {!afterDeadline && !isHost && "Only your pick is visible until the deadline."}
        {!afterDeadline && isHost && "As host, you can view all submitted picks before deadline."}
        {afterDeadline && "All picks are visible after the deadline."}
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
