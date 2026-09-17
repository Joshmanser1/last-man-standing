// src/components/Header.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { GameSelector } from "./GameSelector";
import { subscribeStore } from "../data/service";
import { getEffectiveUserId, isAdminNow } from "../lib/auth";
import { NotificationBell } from "./NotificationBell";
import { postJsonWithAuth } from "../lib/apiAuth";

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `nav-link ${isActive ? "nav-link-active" : ""}`;

const mobileLinkCls = ({ isActive }: { isActive: boolean }) =>
  `fcc-mobile-link ${isActive ? "fcc-mobile-link-active" : ""}`;

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
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
      const resp = await postJsonWithAuth("/api/user-leagues", { user_id: uid });
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

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!drawerOpen) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => drawerCloseRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [drawerOpen]);

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
    <header className="sticky top-0 z-40 border-b border-emerald-300/15 bg-[radial-gradient(120%_120%_at_50%_-10%,#153129,#0b1715_42%,#060b0b_88%)] text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl">
      <div className="container-page flex min-w-0 items-center gap-2 py-2.5 sm:gap-3">
        {/* Brand */}
        <NavLink to="/" className="mr-1 flex shrink-0 items-center gap-2.5 sm:mr-2">
          <img
            src="/fcc-shield.png?v=1"
            alt="Fantasy Command Centre"
            width={40}
            height={40}
            className="block h-10 w-10 rounded-xl border border-emerald-200/20 bg-emerald-200/5 shadow-[0_5px_16px_rgba(57,191,135,0.16)]"
          />
          <span className="hidden whitespace-nowrap text-sm font-bold tracking-tight text-emerald-100 sm:inline">
            Fantasy Command Centre
          </span>
          <span className="text-xs font-extrabold tracking-[0.16em] text-emerald-200 sm:hidden">FCC</span>
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
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
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
                className="btn btn-ghost hidden shrink-0 border-white/15 bg-white/[0.04] px-3 text-white/90 hover:bg-white/10 sm:inline-flex"
                onClick={logout}
                title="Logout"
              >
                Logout
              </button>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-lg text-white/90 transition hover:border-emerald-300/35 hover:bg-emerald-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 md:hidden"
                aria-label="Open navigation menu"
                aria-expanded={drawerOpen}
                aria-controls="fcc-mobile-navigation"
                onClick={() => setDrawerOpen(true)}
              >
                <span aria-hidden="true">☰</span>
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

      {/* Keep core game actions immediately available without horizontal overflow. */}
      {authed && (
        <nav className="grid grid-cols-2 gap-1 border-t border-white/10 px-3 py-2 sm:px-4 md:hidden">
          <NavLink to="/my-games" className={linkCls}>
            My Games
          </NavLink>
          {hasLeague && (
            <>
              <NavLink to="/make-pick" className={linkCls}>
                Picks
              </NavLink>
              <NavLink to="/leaderboard" className={linkCls}>
                Leaderboard
              </NavLink>
              <NavLink to="/league" className={linkCls}>
                League
              </NavLink>
            </>
          )}
        </nav>
      )}

      {authed && (
        <div
          className={`fixed inset-0 z-50 transition ${drawerOpen ? "pointer-events-auto" : "pointer-events-none"}`}
          aria-hidden={!drawerOpen}
        >
          <button
            type="button"
            aria-label="Close navigation menu"
            className={`absolute inset-0 bg-black/65 transition-opacity duration-200 ${drawerOpen ? "opacity-100" : "opacity-0"}`}
            tabIndex={drawerOpen ? 0 : -1}
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            id="fcc-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            inert={!drawerOpen}
            className={`fcc-tactics-surface absolute right-0 top-0 flex h-full w-[min(22rem,calc(100vw-1.25rem))] flex-col overflow-hidden border-l border-emerald-200/15 bg-[#0b1715] p-5 shadow-[-20px_0_50px_rgba(0,0,0,0.35)] transition duration-200 ease-out ${drawerOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}`}
          >
            <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <img src="/fcc-shield.png?v=1" alt="" className="h-9 w-9 rounded-lg" />
                <div>
                  <div className="text-sm font-bold tracking-wide text-white">Fantasy Command Centre</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/75">Matchday menu</div>
                </div>
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 text-lg text-white/80 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>

            <nav className="relative z-10 mt-5 space-y-5">
              <section className="space-y-2">
                <h2 className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300/65">Your game</h2>
                <NavLink to="/my-games" className={mobileLinkCls}>My Games <span aria-hidden="true">›</span></NavLink>
                {hasLeague && (
                  <>
                    <NavLink to="/make-pick" className={mobileLinkCls}>Make a Pick <span aria-hidden="true">›</span></NavLink>
                    <NavLink to="/leaderboard" className={mobileLinkCls}>Leaderboard <span aria-hidden="true">›</span></NavLink>
                    <NavLink to="/league" className={mobileLinkCls}>League <span aria-hidden="true">›</span></NavLink>
                    <NavLink to="/stats" className={mobileLinkCls}>Stats <span aria-hidden="true">›</span></NavLink>
                  </>
                )}
              </section>

              <section className="space-y-2">
                <h2 className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300/65">Explore</h2>
                <NavLink to="/public" className={mobileLinkCls}>Public games <span aria-hidden="true">›</span></NavLink>
                <NavLink to="/private" className={mobileLinkCls}>Private leagues <span aria-hidden="true">›</span></NavLink>
              </section>

              {admin && (
                <section className="space-y-2">
                  <h2 className="px-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300/65">Operator</h2>
                  <NavLink to="/admin" className={mobileLinkCls}>Admin <span aria-hidden="true">›</span></NavLink>
                </section>
              )}
            </nav>

            <button
              type="button"
              className="relative z-10 mt-auto inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.045] px-4 py-3 text-sm font-semibold text-white/80 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              onClick={logout}
            >
              Log out
            </button>
          </aside>
        </div>
      )}
    </header>
  );
}
