// src/components/Header.tsx
import React, { useCallback, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { GameSelector } from "./GameSelector";
import { subscribeStore } from "../data/service";
import { getEffectiveUserId, isAdminNow } from "../lib/auth";
import { NotificationBell } from "./NotificationBell";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? "nav-link-active" : ""}`;

export function Header() {
  const location = useLocation();
  // Dev switcher is enabled when this flag is set (via ?dev=1 or env in App.tsx)
  const devOn =
    typeof window !== "undefined" && localStorage.getItem("dev_switcher") === "1";

  const [authed, setAuthed] = useState<boolean>(() => {
    const supaAuthed = false; // will be set in effect
    const localAuthed = devOn && !!localStorage.getItem("player_id");
    return supaAuthed || localAuthed;
  });

  const [hasLeague, setHasLeague] = useState<boolean>(
    !!localStorage.getItem("active_league_id")
  );
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(
    localStorage.getItem("active_league_id")
  );

  const [admin, setAdmin] = useState<boolean>(isAdminNow());
  const playerName = localStorage.getItem("player_name") || "";
  const navigate = useNavigate();

  const syncLeagueAccess = useCallback(async (isAuthed: boolean) => {
    const storedId = localStorage.getItem("active_league_id");

    if (!isAuthed) {
      setHasLeague(false);
      setActiveLeagueId(null);
      return;
    }

    const uid = await getEffectiveUserId();
    if (!uid) {
      setHasLeague(false);
      setActiveLeagueId(null);
      return;
    }

    try {
      const resp = await fetch("/api/user-leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid }),
      });
      if (!resp.ok) throw new Error("Failed to load user leagues");

      const visibleLeagues = (await resp.json()) as Array<any>;
      const visibleIds = (visibleLeagues ?? [])
        .map((league: any) => (typeof league?.id === "string" ? league.id : ""))
        .filter(Boolean);

      if (visibleIds.length === 0) {
        localStorage.removeItem("active_league_id");
        setHasLeague(false);
        setActiveLeagueId(null);
        return;
      }

      const nextActiveId =
        storedId && visibleIds.includes(storedId) ? storedId : visibleIds[0];

      if (nextActiveId && nextActiveId !== storedId) {
        localStorage.setItem("active_league_id", nextActiveId);
      }

      setActiveLeagueId(nextActiveId ?? null);
      setHasLeague(!!nextActiveId);
    } catch {
      setActiveLeagueId(storedId);
      setHasLeague(false);
    }
  }, []);

  const recomputeAuth = useCallback(async () => {
    const { data } = await supa.auth.getSession();
    const supaAuthed = !!data.session?.user?.id;
    const localAuthed = devOn && !!localStorage.getItem("player_id");
    const isAuthed = supaAuthed || localAuthed;
    setAuthed(isAuthed);
    setAdmin(isAdminNow());
    await syncLeagueAccess(isAuthed);
  }, [devOn, syncLeagueAccess]);

  useEffect(() => {
    // initial
    void recomputeAuth();

    // keep in sync with Supabase login state
    const { data: sub } = supa.auth.onAuthStateChange((_e, session) => {
      const supaAuthed = !!session?.user?.id;
      const localAuthed = devOn && !!localStorage.getItem("player_id");
      const isAuthed = supaAuthed || localAuthed;
      setAuthed(isAuthed);
      setAdmin(isAdminNow());
      void syncLeagueAccess(isAuthed);
    });

    // react to our store changes (DevUserSwitcher fires this)
    const onStore = () => {
      setAdmin(isAdminNow());
      void recomputeAuth();
    };

    // also catch cross-tab changes and focus
    const onStorage = () => onStore();
    const onFocus = () => onStore();

    const unsub = subscribeStore(onStore);
    window.addEventListener("lms:store-updated", onStore as EventListener);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);

    return () => {
      sub.subscription.unsubscribe();
      unsub();
      window.removeEventListener("lms:store-updated", onStore as EventListener);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
    };
  }, [devOn, recomputeAuth, syncLeagueAccess]);

  useEffect(() => {
    void syncLeagueAccess(authed);
  }, [authed, location.pathname, location.search, syncLeagueAccess]);

  async function logout() {
    try {
      await supa.auth.signOut();
    } finally {
      localStorage.removeItem("player_id");
      localStorage.removeItem("player_name");
      localStorage.removeItem("active_league_id");
      localStorage.removeItem("is_admin");
      setHasLeague(false);
      setActiveLeagueId(null);
      setAdmin(false);
      setAuthed(false);
      navigate("/login");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-500/10 bg-[radial-gradient(120%_120%_at_50%_-10%,#0e1b1a,#0b1413_35%,#0a0e12_85%)] text-white/90 backdrop-blur">
      <div className="container-page py-3 flex min-w-0 items-center gap-3 flex-nowrap">
        {/* Brand */}
        <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2">
          <img
            src="/fcc-shield.png?v=1"
            alt="Fantasy Command Centre"
            width={28}
            height={28}
            className="rounded-lg block"
          />
          <span className="text-emerald-300 font-semibold tracking-tight whitespace-nowrap">
            Fantasy Command Centre
          </span>
        </NavLink>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-0.5 md:flex">
          {authed && (
            <>
              <NavLink to="/my-games" className={linkCls}>
                My Games
              </NavLink>
              {hasLeague && (
                <>
                  <NavLink to="/make-pick" className={linkCls}>
                    Picks
                  </NavLink>
                  <NavLink to="/results" className={linkCls}>
                    Results
                  </NavLink>
                  <NavLink to="/leaderboard" className={linkCls}>
                    Leaderboard
                  </NavLink>
                  <NavLink to="/league" className={linkCls}>
                    League
                  </NavLink>
                  <NavLink to="/stats" className={linkCls}>
                    Stats
                  </NavLink>
                </>
              )}
              <NavLink to="/public" className={linkCls}>
                Public
              </NavLink>
              <NavLink to="/private" className={linkCls}>
                Private
              </NavLink>
              {admin && (
                <NavLink to="/admin" className={linkCls}>
                  Admin
                </NavLink>
              )}
            </>
          )}
        </nav>




        <div className="min-w-0 flex-1" />

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-2">
          {authed && <NotificationBell />}
          {/* Game selector */}
          {authed && hasLeague && (
            <div className="hidden items-center gap-2 sm:flex">
              <GameSelector
                variant="header"
                value={activeLeagueId ?? undefined}
                onChange={(id) => {
                  setHasLeague(!!id);
                  setActiveLeagueId(id);
                }}
              />
            </div>
          )}

          {/* Auth */}
          {authed ? (
            <>
              {playerName ? (
                <span className="hidden max-w-[120px] truncate text-xs text-white/70 xl:inline">
                  Hi, {playerName}
                </span>
              ) : null}
              <button
                className="btn btn-ghost text-white/90 border-white/15 hover:bg-white/10 shrink-0"
                onClick={logout}
                title="Logout"
              >
                Logout
              </button>
            </>
          ) : (
            <NavLink
              to="/login"
              className="btn btn-ghost text-white/90 border-white/15 hover:bg-white/10 shrink-0"
            >
              Login
            </NavLink>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      {authed && (
        <div className="md:hidden border-t border-white/10 px-3 py-2 flex gap-1 overflow-x-auto">
          <NavLink to="/my-games" className={linkCls}>
            My Games
          </NavLink>
          {hasLeague && (
            <>
              <NavLink to="/make-pick" className={linkCls}>
                Picks
              </NavLink>
              <NavLink to="/results" className={linkCls}>
                Results
              </NavLink>
              <NavLink to="/leaderboard" className={linkCls}>
                Leaderboard
              </NavLink>
              <NavLink to="/league" className={linkCls}>
                League
              </NavLink>
              <NavLink to="/stats" className={linkCls}>
                Stats
              </NavLink>
            </>
          )}
          <NavLink to="/public" className={linkCls}>
            Public
          </NavLink>
          <NavLink to="/private" className={linkCls}>
            Private
          </NavLink>
          {admin && (
            <NavLink to="/admin" className={linkCls}>
              Admin
            </NavLink>
          )}
        </div>
      )}
    </header>
  );
}
