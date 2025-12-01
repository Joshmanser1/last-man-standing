// src/App.tsx
import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Header } from "./components/Header";
import { supa } from "./lib/supabaseClient";
import { ToastProvider } from "./components/Toast";

// Pages
import LandingPage from "./pages/LandingPage"; // marketing landing at "/"
import { Home } from "./pages/Home";           // LMS main at "/lms"
import { Login } from "./pages/Login";
import { MakePick } from "./pages/MakePick";
import { LiveGames } from "./pages/LiveGames";
import { Results } from "./pages/Results";
import { Stats } from "./pages/Stats";
import { Admin } from "./pages/Admin";
import { MyGames } from "./pages/MyGames";
import { Leaderboard } from "./pages/Leaderboard";
import { EliminationHistory } from "./pages/EliminationHistory";
import { LeagueSummary } from "./pages/LeagueSummary";
import { PrivateLeagueCreate } from "./pages/PrivateLeagueCreate";
import { PrivateLeagueJoin } from "./pages/PrivateLeagueJoin";

const IS_DEV = import.meta.env.DEV === true;

/* ------------------------- Auth gates ------------------------- */
function useIsAuthed() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const playerId = localStorage.getItem("player_id");
      if (playerId) {
        if (!cancelled) {
          setAuthed(true);
          setReady(true);
        }
        return;
      }

      const { data } = await supa.auth.getSession();
      if (!cancelled) {
        setAuthed(!!data.session?.user?.id);
        setReady(true);
      }
    }

    check();

    const { data: sub } = supa.auth.onAuthStateChange((_event, session) => {
      setAuthed(!!session?.user?.id || !!localStorage.getItem("player_id"));
      setReady(true);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { ready, authed };
}

function Protected({ children }: { children: React.ReactNode }) {
  const { ready, authed } = useIsAuthed();
  if (!ready) return null;
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { ready, authed } = useIsAuthed();
  const isAdmin = localStorage.getItem("is_admin") === "1";
  if (!ready) return null;
  if (!authed) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/* --------------------------- App --------------------------- */
function AppInner() {
  const location = useLocation();
  const onLanding = location.pathname === "/";

  return (
    <>
      {/* Hide global header/footer on landing to avoid double bars */}
      {!onLanding && <Header />}

      <main className={onLanding ? "" : "container-page py-6"}>
        <Routes>
          {/* Public marketing landing */}
          <Route path="/" element={<LandingPage />} />

          {/* Auth */}
          <Route path="/login" element={<Login />} />

          {/* LMS main (moved from "/") */}
          <Route path="/lms" element={<Home />} />

          {/* Private leagues */}
          <Route path="/private/create" element={<Protected><PrivateLeagueCreate /></Protected>} />
          <Route path="/private/join" element={<Protected><PrivateLeagueJoin /></Protected>} />

          {/* Core LMS */}
          <Route path="/make-pick" element={<Protected><MakePick /></Protected>} />
          <Route path="/live" element={<Protected><LiveGames /></Protected>} />
          <Route path="/results" element={<Protected><Results /></Protected>} />
          <Route path="/league" element={<Protected><LeagueSummary /></Protected>} />
          <Route path="/leaderboard" element={<Protected><Leaderboard /></Protected>} />
          <Route path="/eliminations" element={<Protected><EliminationHistory /></Protected>} />
          <Route path="/my-games" element={<Protected><MyGames /></Protected>} />
          <Route path="/stats" element={<Protected><Stats /></Protected>} />
          <Route path="/admin" element={<AdminOnly><Admin /></AdminOnly>} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!onLanding && (
        <footer className="border-t bg-white/80">
          <div className="container-page py-3 text-xs text-slate-500 flex items-center justify-between">
            <span>© {new Date().getFullYear()} Fantasy Command Centre</span>
            {IS_DEV && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                Dev mode
              </span>
            )}
          </div>
        </footer>
      )}
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </BrowserRouter>
  );
}
