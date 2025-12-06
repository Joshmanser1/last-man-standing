// src/components/Header.tsx
import React, { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { GameSelector } from "./GameSelector";
import { subscribeStore } from "../data/service";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? "nav-link-active" : ""}`;

export function Header() {
  const [authed, setAuthed] = useState<boolean>(!!localStorage.getItem("player_id"));
  const [hasLeague, setHasLeague] = useState<boolean>(!!localStorage.getItem("active_league_id"));
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(
    localStorage.getItem("active_league_id")
  );

  const playerName = localStorage.getItem("player_name") || "";
  const isAdmin = localStorage.getItem("is_admin") === "1";
  const navigate = useNavigate();

  useEffect(() => {
    supa.auth.getSession().then(({ data }) => setAuthed(!!data.session?.user?.id));
    const { data: sub } = supa.auth.onAuthStateChange((_e, s) => setAuthed(!!s?.user?.id));

    const unsub = subscribeStore(() => {
      const id = localStorage.getItem("active_league_id");
      setActiveLeagueId(id);
      setHasLeague(!!id);
    });

    const onFocus = () => {
      const id = localStorage.getItem("active_league_id");
      setActiveLeagueId(id);
      setHasLeague(!!id);
    };
    window.addEventListener("focus", onFocus);

    return () => {
      sub.subscription.unsubscribe();
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  async function logout() {
    try {
      await supa.auth.signOut();
    } finally {
      localStorage.removeItem("player_id");
      localStorage.removeItem("active_league_id");
      setHasLeague(false);
      setActiveLeagueId(null);
      navigate("/login");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-500/10 bg-[radial-gradient(120%_120%_at_50%_-10%,#0e1b1a,#0b1413_35%,#0a0e12_85%)] text-white/90 backdrop-blur">
      <div className="container-page py-3 flex items-center gap-3 flex-wrap md:flex-nowrap">
        {/* Brand */}
        <NavLink to="/" className="mr-2 flex items-center gap-2 shrink-0 min-w-[220px]">
  <NavLink to="/" className="mr-2 flex items-center gap-2 shrink-0 min-w-[220px]">
  // in src/components/Header.tsx
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
                  <NavLink to="/live" className={linkCls}>Live</NavLink>
                  <NavLink to="/make-pick" className={linkCls}>Make Pick</NavLink>
                  <NavLink to="/results" className={linkCls}>Results</NavLink>
                  <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
                  <NavLink to="/eliminations" className={linkCls}>Eliminations</NavLink>
                  <NavLink to="/stats" className={linkCls}>Stats</NavLink>
                  <NavLink to="/league" className={linkCls}>League</NavLink>
                </>
              )}
              <NavLink to="/my-games" className={linkCls}>My Games</NavLink>
              <NavLink to="/private/create" className={linkCls}>Private</NavLink>
              {isAdmin && <NavLink to="/admin" className={linkCls}>Admin</NavLink>}
            </>
          )}
        </nav>

        {/* Spacer */}
        <div className="flex-1 basis-full md:basis-auto" />

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Game selector */}
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
              <NavLink to="/live" className={linkCls}>Live</NavLink>
              <NavLink to="/make-pick" className={linkCls}>Pick</NavLink>
              <NavLink to="/results" className={linkCls}>Results</NavLink>
              <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
              <NavLink to="/eliminations" className={linkCls}>Elims</NavLink>
              <NavLink to="/stats" className={linkCls}>Stats</NavLink>
              <NavLink to="/league" className={linkCls}>League</NavLink>
            </>
          )}
          <NavLink to="/my-games" className={linkCls}>My Games</NavLink>
          <NavLink to="/private/create" className={linkCls}>Private</NavLink>
          {isAdmin && <NavLink to="/admin" className={linkCls}>Admin</NavLink>}
        </div>
      )}
    </header>
  );
}
