// src/pages/MyGames.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { useToast } from "../components/Toast";

const STORE_KEY = "lms_store_v1";
const PRIVATE_STORE_KEY = "lms_private_leagues_v1";

type LeagueLite = {
  id: string;
  name: string;
  current_round: number;
  status: string;
};

type PrivateLeague = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  inviteCode: string;
  fplStartEvent?: number;
  startDateUtc?: string;
};

type PrivateStore = {
  leagues: PrivateLeague[];
  memberships: { leagueId: string; playerId: string; joinedAt: string }[];
};

export function MyGames() {
  const navigate = useNavigate();
  const toast = useToast();

  const [hydrated, setHydrated] = useState(false); // ensures local player exists (if Supabase session is present)
  const [loading, setLoading] = useState(true);

  const [publicJoined, setPublicJoined] = useState<LeagueLite[]>([]);
  const [allPublic, setAllPublic] = useState<LeagueLite[]>([]);
  const [privateJoined, setPrivateJoined] = useState<PrivateLeague[]>([]);

  const [activeLeagueId, setActiveLeagueId] = useState<string>(
    localStorage.getItem("active_league_id") || ""
  );

  // 1) Hydrate local "player" from Supabase session if missing
  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem("player_id")) {
          setHydrated(true);
          return;
        }

        const { data } = await supa.auth.getSession();
        const user = data.session?.user;
        if (!user) {
          setHydrated(true); // not logged in with Supabase either
          return;
        }

        // Guess a display name
        const guessedName =
          localStorage.getItem("player_name") ||
          (user.user_metadata?.full_name as string | undefined) ||
          (user.email ? user.email.split("@")[0] : undefined) ||
          "Manager";

        // Create/ensure LMS player + store locally
        const p = await dataService.upsertPlayer(guessedName);
        localStorage.setItem("player_id", p.id);
        localStorage.setItem("player_name", p.display_name ?? guessedName);
        if (!localStorage.getItem(STORE_KEY)) {
          localStorage.setItem(STORE_KEY, "{}");
        }
      } catch (e) {
        console.error("Failed to hydrate local player from Supabase session:", e);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // 2) Load games once hydrated
  useEffect(() => {
    if (!hydrated) return;

    const pid = localStorage.getItem("player_id") || "";
    if (!pid) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        // ---- Public LMS games the user is in ----
        let leagues: LeagueLite[] = [];
        let myLeagues: LeagueLite[] = [];

        if ((dataService as any).listMyLeagues) {
          myLeagues = await (dataService as any).listMyLeagues(pid);
          leagues = myLeagues;
        } else {
          leagues = ((await (dataService as any).listLeagues?.()) ||
            []) as LeagueLite[];

          try {
            const raw = localStorage.getItem(STORE_KEY);
            if (raw) {
              const store = JSON.parse(raw);
              const activeIds = new Set(
                (store.memberships || [])
                  .filter((m: any) => m.player_id === pid && m.is_active !== false)
                  .map((m: any) => m.league_id)
              );
              myLeagues = leagues.filter((l) => activeIds.has(l.id));
            } else {
              myLeagues = [];
            }
          } catch {
            myLeagues = [];
          }
        }

        setAllPublic(leagues);
        setPublicJoined(myLeagues);

        // ---- Private leagues from browser-local store ----
        try {
          const rawPriv = localStorage.getItem(PRIVATE_STORE_KEY);
          if (rawPriv) {
            const store: PrivateStore = JSON.parse(rawPriv);
            const ids = new Set(
              store.memberships
                .filter((m) => m.playerId === pid)
                .map((m) => m.leagueId)
            );
            setPrivateJoined(store.leagues.filter((l) => ids.has(l.id)));
          } else {
            setPrivateJoined([]);
          }
        } catch {
          setPrivateJoined([]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [hydrated]);

  function setActive(id: string) {
    localStorage.setItem("active_league_id", id);
    setActiveLeagueId(id);
    toast("Active game set.", { variant: "success" });
  }

  const activePublic = useMemo(
    () => publicJoined.find((l) => l.id === activeLeagueId) || null,
    [publicJoined, activeLeagueId]
  );

  if (!hydrated) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="text-sm text-slate-500">Loading your games…</div>
      </div>
    );
  }

  if (!localStorage.getItem("player_id")) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center p-4">
        <div className="max-w-md text-center space-y-3">
          <h2 className="text-xl font-semibold">You’re not signed in</h2>
          <p className="text-sm text-slate-600">
            Log in first so we can load your games.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/login")}>
            Go to login
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="text-sm text-slate-500 animate-pulse">
          Loading your games…
        </div>
      </div>
    );
  }

  const totalGames = publicJoined.length + privateJoined.length;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">My Games</h1>
          <p className="text-sm text-slate-600">
            Snapshot of your Last Man Standing action across <b>{totalGames}</b>{" "}
            game{totalGames === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="text-xs text-slate-500 space-x-2">
          <span>
            Public: <b>{publicJoined.length}</b>
          </span>
          <span>•</span>
          <span>
            Private: <b>{privateJoined.length}</b>
          </span>
        </div>
      </header>

      {/* Grid layout */}
      <div className="grid gap-6 md:grid-cols-[1.4fr,1.6fr]">
        {/* Active game snapshot */}
        <section className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Active public game</h2>
              <p className="text-xs text-slate-600">
                This is the game your header & links currently point at.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => navigate("/")}
            >
              Join another game
            </button>
          </div>

          {activePublic ? (
            <div className="rounded-2xl border bg-slate-50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{activePublic.name}</div>
                  <div className="text-xs text-slate-600">
                    Round {activePublic.current_round} •{" "}
                    <span className="uppercase">{activePublic.status}</span>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                  Active
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/make-pick")}
                >
                  Make / change pick
                </button>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/live")}
                >
                  Live
                </button>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/results")}
                >
                  Results
                </button>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/leaderboard")}
                >
                  Leaderboard
                </button>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/league")}
                >
                  League summary
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed px-4 py-4 text-sm text-slate-600 space-y-2">
              <p>No active game selected yet.</p>
              {publicJoined.length ? (
                <p>
                  Pick one from the list on the right and hit <b>Set active</b>.
                </p>
              ) : (
                <p>
                  You haven’t joined any public LMS games yet.{" "}
                  <button className="underline" onClick={() => navigate("/")}>
                    Join a game from the home page
                  </button>
                  .
                </p>
              )}
            </div>
          )}

          {/* Private leagues quick link */}
          <div className="border-t pt-4 mt-3">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Private leagues
            </div>
            {privateJoined.length ? (
              <div className="space-y-1 text-xs text-slate-600">
                <p>
                  You’re in <b>{privateJoined.length}</b> private league
                  {privateJoined.length === 1 ? "" : "s"}.
                </p>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/private/create")}
                >
                  Manage private leagues
                </button>
              </div>
            ) : (
              <div className="space-y-1 text-xs text-slate-600">
                <p>You’re not in any private leagues yet.</p>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  onClick={() => navigate("/private/create")}
                >
                  Create or join a private league
                </button>
              </div>
            )}
          </div>
        </section>

        {/* List of all public games this user is in */}
        <section className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Public games I’m in</h2>
            {publicJoined.length > 0 && (
              <span className="text-xs text-slate-500">{publicJoined.length} total</span>
            )}
          </div>

          {publicJoined.length === 0 ? (
            <div className="text-sm text-slate-600 space-y-2">
              <p>You haven’t joined any public LMS games on this account yet.</p>
              <p>
                Head back to the{" "}
                <Link to="/" className="underline">
                  home page
                </Link>{" "}
                to join a game.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {publicJoined.map((lg) => {
                const isActive = lg.id === activeLeagueId;
                return (
                  <div
                    key={lg.id}
                    className={[
                      "flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm",
                      isActive
                        ? "border-emerald-500/70 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div>
                      <div className="font-medium truncate">{lg.name}</div>
                      <div className="text-xs text-slate-600">
                        Round {lg.current_round} •{" "}
                        <span className="uppercase">{lg.status}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {!isActive && (
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          onClick={() => setActive(lg.id)}
                        >
                          Set active
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => {
                          setActive(lg.id);
                          navigate("/league");
                        }}
                      >
                        Open league
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Optional: show public leagues available but not joined yet */}
          {allPublic.length > publicJoined.length && (
            <div className="border-t pt-4 mt-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Other public games available
              </div>
              <p className="text-xs text-slate-600">
                You can join more games from the{" "}
                <Link to="/" className="underline">
                  home page
                </Link>
                .
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
