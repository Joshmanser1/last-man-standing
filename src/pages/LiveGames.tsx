import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId, hasTestUserOverride } from "../lib/auth";

type LeagueLite = {
  id: string;
  name: string;
  current_round: number;
  status: "upcoming" | "active" | "locked" | "completed" | string;
  start_date_utc?: string;
  fpl_start_event?: number;
  is_public?: boolean;
  join_code?: string | null;
  created_by?: string | null;
};

const devOn = () =>
  typeof window !== "undefined" && localStorage.getItem("dev_switcher") === "1";
const devAuthed = () =>
  typeof window !== "undefined" &&
  devOn() &&
  !!localStorage.getItem("player_id");

function statusPill(status: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold";
  if (status === "active") {
    return <span className={`${base} bg-emerald-100 text-emerald-700`}>Active</span>;
  }
  if (status === "upcoming") {
    return <span className={`${base} bg-indigo-100 text-indigo-700`}>Upcoming</span>;
  }
  if (status === "locked") {
    return <span className={`${base} bg-amber-100 text-amber-800`}>Locked</span>;
  }
  if (status === "completed") {
    return <span className={`${base} bg-slate-200 text-slate-700`}>Completed</span>;
  }
  return <span className={`${base} bg-slate-100 text-slate-700`}>{status.toUpperCase()}</span>;
}

export function LiveGames() {
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);

  const navigate = useNavigate();
  const activeLeagueId = localStorage.getItem("active_league_id") || null;

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await (dataService as any).seed?.();
        const ls = ((await (dataService as any).listLeagues?.()) || []) as LeagueLite[];
        setLeagues(ls.filter((league) => league.is_public !== false));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let active = true;

    const loadMemberships = async () => {
      const authUid = await getEffectiveUserId();
      if (!active) return;
      setAuthUserId(authUid ?? null);

      const { data: mems } = await supa
        .from("memberships")
        .select("league_id, player_id, is_active");
      if (!active) return;
      setMemberships(mems || []);
    };

    loadMemberships();
    const { data: sub } = supa.auth.onAuthStateChange(() => {
      loadMemberships();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const entrantsByLeague = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of memberships) {
      map.set(m.league_id, (map.get(m.league_id) || 0) + 1);
    }
    return map;
  }, [memberships]);

  const myLeagueIds = useMemo(() => {
    const pid = authUserId || null;
    if (!pid) return new Set<string>();
    const ids = new Set<string>();
    for (const m of memberships) {
      if (m.player_id === pid) ids.add(m.league_id);
    }
    return ids;
  }, [memberships, authUserId]);

  const joinedPublic = useMemo(
    () => leagues.filter((l) => myLeagueIds.has(l.id) || (authUserId && l.created_by === authUserId)),
    [leagues, myLeagueIds, authUserId]
  );

  const upcomingPublic = useMemo(
    () =>
      leagues.filter(
        (l) =>
          !myLeagueIds.has(l.id) &&
          l.created_by !== authUserId &&
          (l.status === "upcoming" || l.status === "active" || l.status === "locked")
      ),
    [leagues, myLeagueIds, authUserId]
  );

  const completedPublic = useMemo(
    () => leagues.filter((l) => l.status === "completed"),
    [leagues]
  );

  function makeActiveAndGo(leagueId: string, path: string) {
    localStorage.setItem("active_league_id", leagueId);
    navigate(path);
  }

  async function joinLeague(l: LeagueLite) {
    if (joiningId) return;
    setJoiningId(l.id);
    try {
      const effectiveUserId = await getEffectiveUserId();
      const authed = !!effectiveUserId || devAuthed();

      if (!authed) {
        localStorage.setItem("active_league_id", l.id);
        navigate("/login");
        return;
      }

      if (!effectiveUserId) {
        throw new Error("No effective test user selected.");
      }

      if (!hasTestUserOverride()) {
        const displayName = localStorage.getItem("player_name") || "Manager";
        await dataService.upsertPlayer(displayName);
      }

      const joinRes = await fetch("/api/join-league", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          league_id: l.id,
          player_id: effectiveUserId,
          role: "player",
        }),
      });
      if (!joinRes.ok) {
        let msg = "Failed to join this game.";
        try {
          const err = await joinRes.json();
          msg = err?.error ?? msg;
        } catch {}
        throw new Error(msg);
      }

      localStorage.setItem("active_league_id", l.id);
      navigate("/my-games");
    } catch (err: any) {
      console.error(err);
      alert(err?.message ?? "Failed to join this game.");
    } finally {
      setJoiningId(null);
    }
  }

  function renderLeagueCard(l: LeagueLite, joined = false) {
    const entrants = entrantsByLeague.get(l.id) ?? 0;
    const mine = myLeagueIds.has(l.id) || (authUserId && l.created_by === authUserId);
    const isActive = activeLeagueId === l.id;
    const roundLabel = `Round ${l.current_round}`;
    const fplLabel =
      typeof l.fpl_start_event === "number" ? `Start GW ${l.fpl_start_event}` : undefined;

    return (
      <div key={l.id} className="card flex flex-col justify-between gap-3 border border-slate-200/80 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold">{l.name}</h3>
              {statusPill(l.status)}
              {mine && (
                <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700">
                  You're in
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
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
              Active game
            </span>
          )}
        </div>

        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{entrants}</span> entrant
          {entrants === 1 ? "" : "s"}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {joined || mine ? (
            <>
              <button
                className="btn btn-primary text-xs"
                onClick={() => makeActiveAndGo(l.id, "/make-pick")}
              >
                Make Pick
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
              {joiningId === l.id ? "Joining..." : "Join"}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderSection(title: string, rows: LeagueLite[], empty: string, joined = false) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-slate-500">{rows.length} total</span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">{empty}</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((league) => renderLeagueCard(league, joined))}
          </div>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="animate-pulse text-slate-500">Loading public games...</div>
      </div>
    );
  }

  return (
    <div className="container-page space-y-8 py-6">
      <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 text-white shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#ffffff33,_transparent_55%)] opacity-20" />
        <div className="relative flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between md:p-7">
          <div>
            <div className="inline-flex items-center rounded-full bg-black/20 px-3 py-1 text-xs font-semibold tracking-wide">
              Public Games
            </div>
            <h1 className="mt-3 text-2xl font-bold leading-tight md:text-3xl">
              Browse and join public Last Man Standing games
            </h1>
            <p className="mt-2 max-w-xl text-sm text-white/85 md:text-base">
              Public is for browsing, joining, and revisiting completed LMS games without
              changing your private league flow.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-white/80">Snapshot</div>
            <div className="mt-1 text-lg font-semibold">
              {leagues.length} public game{leagues.length === 1 ? "" : "s"}
            </div>
            <div className="mt-1 text-xs text-white/80">
              {Array.from(entrantsByLeague.values()).reduce((sum, v) => sum + v, 0)} total entrants
            </div>
          </div>
        </div>
      </div>

      {renderSection(
        "Upcoming Public Games",
        upcomingPublic,
        "No public games are open for joining right now."
      )}
      {renderSection(
        "Public Games I've Joined",
        joinedPublic,
        "You haven't joined any public games yet.",
        true
      )}
      {renderSection(
        "Completed Public Games",
        completedPublic,
        "No completed public games yet.",
        true
      )}
    </div>
  );
}

export default LiveGames;
