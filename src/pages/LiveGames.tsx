// src/pages/LiveGames.tsx
import { useEffect, useMemo, useState } from "react";
import { dataService } from "../data/service";
import { useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";

const STORE_KEY = "lms_store_v1";

type LeagueLite = {
  id: string;
  name: string;
  current_round: number;
  status: "upcoming" | "active" | "locked" | "completed" | string;
  start_date_utc?: string;
  fpl_start_event?: number;
  is_public?: boolean;
  join_code?: string | null;
};

type Store = {
  memberships?: any[];
  rounds?: any[];
  picks?: any[];
};

type Filter = "all" | "upcoming" | "active" | "completed";

// --- Dev auth helpers (allow join without Supabase when dev switcher is on)
const devOn = () =>
  typeof window !== "undefined" && localStorage.getItem("dev_switcher") === "1";
const devAuthed = () =>
  typeof window !== "undefined" &&
  devOn() &&
  !!localStorage.getItem("player_id");

function statusPill(status: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold";
  if (status === "active")
    return <span className={`${base} bg-emerald-100 text-emerald-700`}>Active</span>;
  if (status === "upcoming")
    return <span className={`${base} bg-indigo-100 text-indigo-700`}>Upcoming</span>;
  if (status === "locked")
    return <span className={`${base} bg-amber-100 text-amber-800`}>Locked</span>;
  if (status === "completed")
    return <span className={`${base} bg-slate-200 text-slate-700`}>Completed</span>;
  return <span className={`${base} bg-slate-100 text-slate-700`}>{status.toUpperCase()}</span>;
}

export function LiveGames() {
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const navigate = useNavigate();
  const playerId = localStorage.getItem("player_id") || null;
  const activeLeagueId = localStorage.getItem("active_league_id") || null;

  // Load leagues + local store
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await (dataService as any).seed?.();
        const ls = ((await (dataService as any).listLeagues?.()) || []) as LeagueLite[];
        setLeagues(ls);

        const raw = localStorage.getItem(STORE_KEY);
        const s = raw ? (JSON.parse(raw) as Store) : {};
        setStore(s);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Membership / entrants maps
  const memberships = useMemo(() => store?.memberships || [], [store]);

  const entrantsByLeague = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of memberships) {
      if (!m.is_active) continue;
      map.set(m.league_id, (map.get(m.league_id) || 0) + 1);
    }
    return map;
  }, [memberships]);

  const myLeagueIds = useMemo(() => {
    if (!playerId) return new Set<string>();
    const ids = new Set<string>();
    for (const m of memberships) {
      if (m.player_id === playerId) ids.add(m.league_id);
    }
    return ids;
  }, [memberships, playerId]);

  const filteredLeagues = useMemo(() => {
    if (filter === "all") return leagues;
    if (filter === "upcoming") return leagues.filter((l) => l.status === "upcoming");
    if (filter === "active") return leagues.filter((l) => l.status === "active" || l.status === "locked");
    if (filter === "completed") return leagues.filter((l) => l.status === "completed");
    return leagues;
  }, [leagues, filter]);

  function makeActiveAndGo(leagueId: string, path: string) {
    localStorage.setItem("active_league_id", leagueId);
    navigate(path);
  }

  // ---- Real join flow (now accepts dev auth)
  async function joinLeague(l: LeagueLite) {
    if (joiningId) return;
    setJoiningId(l.id);
    try {
      // Accept either a Supabase session OR dev local auth
      const { data } = await supa.auth.getSession();
      const supaAuthed = !!data.session?.user?.id;
      const authed = supaAuthed || devAuthed();

      if (!authed) {
        localStorage.setItem("active_league_id", l.id);
        navigate("/login");
        return;
      }

      // Private? ask for code (client-side hint; server should still validate)
      if (l.is_public === false) {
        const input = window.prompt("Enter the private join code to join this league:");
        if (!input) return; // cancelled
        if (l.join_code && input.trim() !== l.join_code.trim()) {
          alert("That join code is not correct.");
          return;
        }
      }

      // Ensure we have a player record (works in dev or real auth)
      const displayName = localStorage.getItem("player_name") || "Manager";
      const player = await dataService.upsertPlayer(displayName);

      // Ensure membership
      await dataService.ensureMembership(l.id, player.id);

      // Set active and go to My Games
      localStorage.setItem("active_league_id", l.id);
      navigate("/my-games");
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to join this game.");
    } finally {
      setJoiningId(null);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="text-slate-500 animate-pulse">Loading live games…</div>
      </div>
    );
  }

  return (
    <div className="container-page py-6 space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border shadow-sm bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 text-white">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top,_#ffffff33,_transparent_55%)]" />
        <div className="relative p-5 md:p-7 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="inline-flex items-center rounded-full bg-black/20 px-3 py-1 text-xs font-semibold tracking-wide">
              Live Games Hub
            </div>
            <h1 className="mt-3 text-2xl md:text-3xl font-bold leading-tight">
              See every Last Man Standing game at a glance
            </h1>
            <p className="mt-2 text-sm md:text-base text-white/85 max-w-xl">
              Browse public LMS games, jump into your active leagues, and track
              which gameweek each competition is synced to.
            </p>
          </div>
          <div className="flex flex-col items-start md:items-end gap-2 text-sm">
            <div className="rounded-2xl bg-black/15 px-4 py-3 border border-white/10">
              <div className="text-xs uppercase tracking-wide text-white/80">
                Snapshot
              </div>
              <div className="mt-1 text-lg font-semibold">
                {leagues.length} game{leagues.length === 1 ? "" : "s"} total
              </div>
              <div className="mt-1 text-xs text-white/80">
                {Array.from(entrantsByLeague.values()).reduce((sum, v) => sum + v, 0)}{" "}
                total entrants across all games
              </div>
            </div>
            <button className="btn btn-ghost text-xs mt-1" onClick={() => navigate("/my-games")}>
              View My Games
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-white border px-1 py-1 shadow-sm">
          {([
            { key: "all", label: "All" },
            { key: "upcoming", label: "Upcoming" },
            { key: "active", label: "Active / Locked" },
            { key: "completed", label: "Completed" },
          ] as { key: Filter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "px-3 py-1.5 text-xs md:text-sm rounded-lg font-medium",
                filter === f.key ? "bg-teal-600 text-white" : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-500">
          Active league:{" "}
          {activeLeagueId
            ? leagues.find((l) => l.id === activeLeagueId)?.name || "Unknown"
            : "None selected"}
        </div>
      </div>

      {/* League grid */}
      {filteredLeagues.length === 0 ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600 text-center">
          No games match this filter yet. Try switching to a different tab or
          create a new game from{" "}
          <button className="underline" onClick={() => navigate("/admin")}>
            Admin
          </button>
          .
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredLeagues.map((l) => {
            const entrants = entrantsByLeague.get(l.id) ?? 0;
            const mine = myLeagueIds.has(l.id);
            const isActive = activeLeagueId === l.id;

            const roundLabel = `Round ${l.current_round}`;
            const fplLabel =
              typeof l.fpl_start_event === "number" ? `Start GW ${l.fpl_start_event}` : undefined;

            return (
              <div key={l.id} className="card p-4 flex flex-col justify-between gap-3 border border-slate-200/80">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold truncate">{l.name}</h2>
                      {statusPill(l.status)}
                      {mine && (
                        <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                          You’re in
                        </span>
                      )}
                      {l.is_public === false && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          Private
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-600 space-x-2">
                      <span>{roundLabel}</span>
                      {fplLabel && <span className="text-slate-500">• {fplLabel}</span>}
                      {l.start_date_utc && (
                        <span className="text-slate-500">• Starts {new Date(l.start_date_utc).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                  {isActive && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                      Active game
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-600">
                  <div>
                    <span className="font-semibold text-slate-900">{entrants}</span>{" "}
                    entrant{entrants === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {mine ? (
                    <>
                      <button
                        className="btn btn-primary text-xs"
                        onClick={() => makeActiveAndGo(l.id, "/make-pick")}
                      >
                        Go to Picks
                      </button>
                      <button
                        className="btn btn-ghost text-xs"
                        onClick={() => makeActiveAndGo(l.id, "/league")}
                      >
                        League Summary
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-primary text-xs"
                      onClick={() => joinLeague(l)}
                      disabled={joiningId === l.id}
                    >
                      {joiningId === l.id ? "Joining…" : "Join this game"}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost text-xs"
                    onClick={() => makeActiveAndGo(l.id, "/results")}
                  >
                    View Results
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LiveGames;
