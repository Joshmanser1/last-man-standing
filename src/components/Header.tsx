// src/components/Header.tsx
import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { GameSelector } from "./GameSelector";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? "nav-link-active" : ""}`;

export function Header() {
  const [authed, setAuthed] = useState<boolean>(!!localStorage.getItem("player_id"));
  const playerName = localStorage.getItem("player_name") || "";
  const navigate = useNavigate();

  useEffect(() => {
    supa.auth.getSession().then(({ data }) => setAuthed(!!data.session?.user?.id));
    const { data: sub } = supa.auth.onAuthStateChange((_e, s) =>
      setAuthed(!!s?.user?.id)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    try {
      await supa.auth.signOut();
    } finally {
      localStorage.removeItem("player_id");
      localStorage.removeItem("active_league_id");
      navigate("/login");
    }
  }

  // Derived flags from localStorage each render so they stay in sync
  const hasLeague = !!localStorage.getItem("active_league_id");
  const isAdmin = localStorage.getItem("is_admin") === "1";

  return (
    <header className="sticky top-0 z-40 border-b border-teal-800/30 bg-[linear-gradient(180deg,#176b5b,#1f8a75)] text-white/90 backdrop-blur">
      <div className="container-page py-3 flex items-center gap-3">
        {/* Brand */}
        <NavLink
          to="/"
          className="mr-2 text-lg font-bold tracking-tight text-white hover:text-white"
        >
          LMS
        </NavLink>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {authed && (
            <>
              {/* Core LMS links only if user is in a game */}
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

              {/* Always available to signed-in users */}
              <NavLink to="/my-games" className={linkCls}>
                My Games
              </NavLink>
              <NavLink to="/private/create" className={linkCls}>
                Private
              </NavLink>

              {/* Admin visible only if flagged */}
              {isAdmin && (
                <NavLink to="/admin" className={linkCls}>
                  Admin
                </NavLink>
              )}
            </>
          )}
        </nav>

        <div className="flex-1" />

        {/* Game selector (shared public + private) */}
        <div className="hidden sm:flex min-w-[190px] items-center gap-2">
          <GameSelector
            variant="header"
            onChange={(_id) => {
              // Pages listen to active_league_id via their own state/useEffect.
              // No extra logic required here for now.
            }}
          />
        </div>

        {/* Auth */}
        <div className="ml-2 flex items-center gap-2">
          {authed ? (
            <>
              {playerName ? (
                <span className="hidden sm:inline text-xs text-white/80">
                  Hi, {playerName}
                </span>
              ) : null}
              <button
                className="btn btn-ghost text-white border-white/20 hover:bg-white/10"
                onClick={logout}
              >
                Logout
              </button>
            </>
          ) : (
            <NavLink
              to="/login"
              className="btn btn-ghost text-white border-white/20 hover:bg-white/10"
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
          <NavLink to="/private/create" className={linkCls}>
            Private
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={linkCls}>
              Admin
            </NavLink>
          )}
        </div>
      )}
    </header>
  );
}
