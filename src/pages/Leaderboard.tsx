import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import * as htmlToImage from "html-to-image";
import { LeagueStatusBanner } from "../components/LeagueStatusBanner";
import { supa } from "../lib/supabaseClient";
import { useFirstPickGuidance } from "../hooks/useFirstPickGuidance";

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
type ViewMode = "leaderboard" | "matrix" | "eliminations";
type EliminationRow = {
  roundNumber: number;
  playerName: string;
  teamName: string;
  reason: string;
  when: string;
};

function teamShort(name: string) {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 4) return cleaned;
  const caps = cleaned
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (caps.length >= 3 && caps.length <= 4) return caps.slice(0, 3);
  return cleaned.slice(0, 3);
}

export function Leaderboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [view, setView] = useState<ViewMode>("leaderboard");
  const [showElims, setShowElims] = useState(true);
  const [league, setLeague] = useState<League | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [playersById, setPlayersById] = useState<Map<ID, Player>>(new Map());
  const [loading, setLoading] = useState<boolean>(true);

  const exportRef = useRef<HTMLDivElement>(null);
  const activeLeagueId = localStorage.getItem("active_league_id") || "";
  const guidance = useFirstPickGuidance(activeLeagueId);

  function changeView(next: ViewMode) {
    setView(next);
    navigate(`/leaderboard?view=${next}`, { replace: true });
  }

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("view");
    if (q === "eliminations" || q === "matrix" || q === "leaderboard") {
      setView(q);
    }
  }, [location.search]);

  useEffect(() => {
    if (!activeLeagueId) {
      setLeague(null);
      setRounds([]);
      setTeams([]);
      setMemberships([]);
      setPicks([]);
      setPlayersById(new Map());
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        const { data: lg } = await supa
          .from("leagues")
          .select("*")
          .eq("id", activeLeagueId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!lg) {
          setLeague(null);
          setRounds([]);
          setTeams([]);
          setMemberships([]);
          setPicks([]);
          setPlayersById(new Map());
          return;
        }
        setLeague(lg as League);

        const [roundsRes, teamsRes, picksResp] = await Promise.all([
          supa
            .from("rounds")
            .select("*")
            .eq("league_id", activeLeagueId)
            .order("round_number", { ascending: true }),
          supa.from("teams").select("*").eq("league_id", activeLeagueId),
          fetch("/api/league-picks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ league_id: activeLeagueId }),
          }),
        ]);

        const memberResp = await fetch("/api/league-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ league_id: activeLeagueId }),
        });
        if (!memberResp.ok) throw new Error("Failed to load league members");
        if (!picksResp.ok) throw new Error("Failed to load league picks");
        const memberRows = (await memberResp.json()) as Array<any>;
        const pickRows = (await picksResp.json()) as Pick[];

        setRounds((roundsRes.data ?? []) as Round[]);
        setTeams((teamsRes.data ?? []) as Team[]);
        setMemberships(
          (memberRows ?? []).map((m: any) => ({
            id: `${m.league_id}:${m.player_id}`,
            league_id: m.league_id,
            player_id: m.player_id,
            is_active: m.is_active,
            joined_at: m.joined_at,
          })) as Membership[]
        );
        setPicks(pickRows ?? []);

        const map = new Map<ID, Player>();
        (memberRows ?? []).forEach((m: any) => {
          if (typeof m.player_id === "string") {
            map.set(m.player_id, { id: m.player_id, display_name: m.display_name ?? "" });
          }
        });
        setPlayersById(map);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeLeagueId]);

  const teamsById = useMemo(() => {
    const map = new Map<ID, Team>();
    for (const t of teams || []) map.set(t.id, t);
    return map;
  }, [teams]);

  const picksByPlayerByRound = useMemo(() => {
    const map = new Map<ID, Map<number, Pick>>();
    if (!league) return map;
    const leaguePicks = picks.filter((p) => p.league_id === league.id);
    const roundById = new Map<ID, Round>();
    for (const r of rounds) roundById.set(r.id, r);

    for (const p of leaguePicks) {
      const r = roundById.get(p.round_id);
      if (!r) continue;
      if (!map.has(p.player_id)) map.set(p.player_id, new Map());
      map.get(p.player_id)!.set(r.round_number, p);
    }
    return map;
  }, [league, rounds, picks]);

  const rows = useMemo(() => {
    const membershipByPlayerId = new Map<ID, Membership>();
    for (const membership of memberships) {
      membershipByPlayerId.set(membership.player_id, membership);
    }
    const playerIds = Array.from(
      new Set([...memberships.map((m) => m.player_id), ...picks.map((p) => p.player_id)])
    );

    const items = playerIds.map((playerId) => {
      const membership =
        membershipByPlayerId.get(playerId) ??
        ({
          id: `${league?.id ?? activeLeagueId}:${playerId}`,
          league_id: league?.id ?? activeLeagueId,
          player_id: playerId,
          is_active: false,
          joined_at: "",
        } as Membership);
      const player = playersById.get(playerId);
      const display = player?.display_name || "Unknown";
      const alive = !!membership.is_active;
      const state = alive ? "Alive" : "Eliminated";
      const lastElimRound = (() => {
        if (alive) return undefined;
        let elim: number | undefined;
        const perRound = picksByPlayerByRound.get(playerId);
        if (perRound) {
          for (const [rd, p] of Array.from(perRound.entries()).sort((a, b) => a[0] - b[0])) {
            if (p.status === "eliminated" || p.status === "no-pick") {
              elim = rd;
              break;
            }
          }
        }
        return elim;
      })();

      return {
        membership,
        playerId,
        name: display,
        alive,
        state,
        sortKey: alive ? 1e9 : lastElimRound ?? 0,
      };
    });

    const filtered = showElims ? items : items.filter((r) => r.alive);
    filtered.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return a.name.localeCompare(b.name);
    });
    return filtered;
  }, [memberships, playersById, picksByPlayerByRound, showElims, picks, league, activeLeagueId]);

  const eliminationRows = useMemo(() => {
    const byRound = new Map<string, Round>(rounds.map((r) => [r.id, r]));
    return picks
      .filter((p) => p.status === "eliminated" || p.status === "no-pick")
      .map((p) => {
        const round = byRound.get(p.round_id);
        const team = teamsById.get(p.team_id);
        return {
          roundNumber: round?.round_number ?? 0,
          playerName: playersById.get(p.player_id)?.display_name ?? "Unknown",
          teamName: team?.name ?? "—",
          reason: p.reason ?? (p.status === "no-pick" ? "no-pick" : "loss"),
          when: round?.pick_deadline_utc ?? "",
        } as EliminationRow;
      })
      .sort((a, b) => b.roundNumber - a.roundNumber || a.playerName.localeCompare(b.playerName));
  }, [picks, rounds, teamsById, playersById]);

  const maxRound = rounds.length > 0 ? Math.max(...rounds.map((r) => r.round_number)) : 0;

  function symbolForPick(p?: Pick) {
    if (!p) return "";
    const team = teamsById.get(p.team_id);
    const code = team?.code?.trim().toUpperCase() || (team ? teamShort(team.name) : "");
    if (p.status === "through") return `${code} \u2713`;
    if (p.status === "eliminated" || p.status === "no-pick") return `${code} \u2715`;
    return `${code}`;
  }

  async function exportPNG() {
    if (!exportRef.current || !league) return;
    const source = exportRef.current;
    const clone = source.cloneNode(true) as HTMLDivElement;
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-100000px";
    wrapper.style.top = "0";
    wrapper.style.background = "#ffffff";
    wrapper.style.padding = "0";
    wrapper.style.margin = "0";
    wrapper.style.zIndex = "-1";

    clone.style.width = `${Math.max(source.scrollWidth, source.clientWidth)}px`;
    clone.style.height = "auto";
    clone.style.overflow = "visible";
    clone.style.background = "#ffffff";

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    try {
      const width = Math.max(clone.scrollWidth, clone.clientWidth);
      const height = Math.max(clone.scrollHeight, clone.clientHeight);
      const pixelRatio = width * height > 6_000_000 ? 1 : 2;

      const dataUrl = await htmlToImage.toPng(clone, {
        backgroundColor: "#ffffff",
        pixelRatio,
        width,
        height,
        style: {
          overflow: "visible",
          backgroundColor: "#ffffff",
        },
        cacheBust: true,
      });

      const a = document.createElement("a");
      a.download = `${slug(league.name)}-${view}.png`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error("PNG export failed", err);
      alert("Failed to export PNG.");
    } finally {
      wrapper.remove();
    }
  }

  if (loading && activeLeagueId) {
    return (
      <div className="container-page py-10 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="font-semibold mb-2">Loading active league...</div>
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="container-page py-10 grid place-items-center text-slate-600">
        <div className="text-center">
          <div className="font-semibold mb-2">No active game selected</div>
        </div>
        {!activeLeagueId && (
          <button className="btn btn-primary" onClick={() => navigate("/my-games")}>
            Open My Games
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="container-page py-6 space-y-4">
      <LeagueStatusBanner leagueId={activeLeagueId} />
      {guidance.shouldGuide ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          <div className="font-semibold">Leaderboard unlocks after your first pick.</div>
          <button
            type="button"
            className="btn btn-primary mt-4"
            onClick={() => navigate("/make-pick")}
          >
            Make Pick
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-lg font-semibold">{league.name} - Leaderboard</div>
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
                  onClick={() => changeView("leaderboard")}
                >
                  Standings
                </button>
                <button
                  className={
                    "px-3 py-1.5 text-xs rounded-lg " +
                    (view === "matrix"
                      ? "bg-teal-600 text-white"
                      : "text-slate-700 hover:bg-slate-100")
                  }
                  onClick={() => changeView("matrix")}
                >
                  Pick Matrix
                </button>
                <button
                  className={
                    "px-3 py-1.5 text-xs rounded-lg " +
                    (view === "eliminations"
                      ? "bg-teal-600 text-white"
                      : "text-slate-700 hover:bg-slate-100")
                  }
                  onClick={() => changeView("eliminations")}
                >
                  Eliminations
                </button>
              </div>

              <button className="btn btn-ghost text-xs" onClick={exportPNG}>
                Export PNG
              </button>
            </div>
          </div>

          <div ref={exportRef} className="rounded-2xl border bg-white overflow-x-auto p-0">
            {view === "leaderboard" ? (
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
                        No entrants yet. Share your invite code to get players into the league.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : view === "matrix" ? (
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
                        No entrants yet. Share your invite code to get players into the league.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-3 py-2 text-left w-24">Round</th>
                    <th className="px-3 py-2 text-left">Player</th>
                    <th className="px-3 py-2 text-left">Pick</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Locked</th>
                  </tr>
                </thead>
                <tbody>
                  {eliminationRows.map((row, i) => (
                    <tr key={`${row.playerName}:${row.roundNumber}:${i}`} className="border-t">
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
                  {eliminationRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-slate-500" colSpan={5}>
                        No eliminations yet. Eliminated players will appear here after a round is processed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Leaderboard;

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
