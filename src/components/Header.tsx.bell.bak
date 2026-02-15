// src/components/Header.tsx
import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { GameSelector } from "./GameSelector";
import { subscribeStore } from "../data/service";
import { isAdminNow } from "../lib/auth";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? "nav-link-active" : ""}`;

export function Header() {
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

  useEffect(() => {
    const recomputeAuth = async () => {
      const { data } = await supa.auth.getSession();
      const supaAuthed = !!data.session?.user?.id;
      const localAuthed = devOn && !!localStorage.getItem("player_id");
      setAuthed(supaAuthed || localAuthed);
      setAdmin(isAdminNow());
    };

    // initial
    recomputeAuth();

    // keep in sync with Supabase login state
    const { data: sub } = supa.auth.onAuthStateChange((_e, session) => {
      const supaAuthed = !!session?.user?.id;
      const localAuthed = devOn && !!localStorage.getItem("player_id");
      setAuthed(supaAuthed || localAuthed);
      setAdmin(isAdminNow());
    });

    // react to our store changes (DevUserSwitcher fires this)
    const onStore = () => {
      const id = localStorage.getItem("active_league_id");
      setActiveLeagueId(id);
      setHasLeague(!!id);
      setAdmin(isAdminNow());

      const localAuthed = devOn && !!localStorage.getItem("player_id");
      setAuthed((prev) => prev || localAuthed);
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
  }, [devOn]);

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
      <div className="container-page py-3 flex items-center gap-3 flex-wrap md:flex-nowrap">
        {/* Brand */}
        <NavLink to="/" className="mr-2 flex items-center gap-2 shrink-0 min-w-[220px]">
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
        <nav className="hidden md:flex items-center gap-1">
          {authed && (
            <>
              {hasLeague && (
                <>
                  <NavLink to="/live" className={linkCls}>
                    Live
                  </NavLink>
                  <NavLink to="/make-pick" className={linkCls}>
                    Make Pick
                  </NavLink>
                  <NavLink to="/results" className={linkCls}>
                    Results
                  </NavLink>
                  <NavLink to="/leaderboard" className={linkCls}>
                    Leaderboard
                  </NavLink>
                  <NavLink to="/eliminations" className={linkCls}>
                    Eliminations
                  </NavLink>
                  <NavLink to="/stats" className={linkCls}>
                    Stats
                  </NavLink>
                  <NavLink to="/league" className={linkCls}>
                    League
                  </NavLink>
                </>
              )}
              <NavLink to="/my-games" className={linkCls}>
                My Games
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

        {/* Spacer */}
        <div className="flex-1 basis-full md:basis-auto" />

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Game selector — ONLY when authed */}
          {authed && (
            <div className="hidden sm:flex items-center gap-2">
              <span className="hidden lg:inline text-sm text-white/70">Game</span>
              <GameSelector
                variant="header"
                value={activeLeagueId ?? undefined}
                onChange={(_id) => {
                  setHasLeague(!!_id);
                  setActiveLeagueId(_id);
                }}
              />
            </div>
          )}

          {/* Auth */}
          {authed ? (
            <>
              {playerName ? (
                <span className="hidden sm:inline text-xs text-white/70 truncate max-w-[120px]">
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
          {hasLeague && (
            <>
              <NavLink to="/live" className={linkCls}>
                Live
              </NavLink>
              <NavLink to="/make-pick" className={linkCls}>
                Pick
              </NavLink>
              <NavLink to="/results" className={linkCls}>
                Results
              </NavLink>
              <NavLink to="/leaderboard" className={linkCls}>
                Leaderboard
              </NavLink>
              <NavLink to="/eliminations" className={linkCls}>
                Elims
              </NavLink>
              <NavLink to="/stats" className={linkCls}>
                Stats
              </NavLink>
              <NavLink to="/league" className={linkCls}>
                League
              </NavLink>
            </>
          )}
          <NavLink to="/my-games" className={linkCls}>
            My Games
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
