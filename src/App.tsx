// src/App.tsx
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { Header } from "./components/Header";
import { ToastProvider } from "./components/Toast";

// Pages
import LandingPage from "./pages/LandingPage";
import { Home } from "./pages/Home";
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

// Dev-only switcher
import { DevUserSwitcher } from "./components/DevUserSwitcher";

// Env flag still supported
const DEV_FLAG =
  import.meta.env.VITE_DEV_SWITCHER_ENABLED === "true" || import.meta.env.DEV;

function AppInner() {
  const location = useLocation();

  // One-time: allow ?dev=1 to enable switcher for this browser and clean URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(location.search);
    if (search.get("dev") === "1") {
      try {
        localStorage.setItem("dev_switcher", "1");
        search.delete("dev");
        const qs = search.toString();
        const url = `${location.pathname}${qs ? `?${qs}` : ""}`;
        window.history.replaceState({}, "", url);
      } catch {
        /* noop */
      }
    }
  }, [location.pathname, location.search]);

  // Switcher is enabled if env OR local toggle is set
  const SWITCHER_ENABLED = useMemo(() => {
    if (DEV_FLAG) return true;
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dev_switcher") === "1";
  }, []);

  // Routes that hide header/footer
  const noChromeRoutes = ["/login"];
  const isNoChrome = noChromeRoutes.includes(location.pathname);

  // Routes that are full-bleed (no container wrapper)
  const fullBleedRoutes = ["/", "/login"];
  const isFullBleed = fullBleedRoutes.includes(location.pathname);

  return (
    <>
      {/* Header everywhere except no-chrome routes */}
      {!isNoChrome && <Header />}

      <main className={isFullBleed ? "" : "container-page py-4"}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/home" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/live" element={<LiveGames />} />
          <Route path="/make-pick" element={<MakePick />} />
          <Route path="/results" element={<Results />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/my-games" element={<MyGames />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/eliminations" element={<EliminationHistory />} />
          <Route path="/league/:leagueId" element={<LeagueSummary />} />
          <Route path="/private" element={<PrivateLeagueCreate />} />
        </Routes>
      </main>

      {/* Footer hidden on landing & /login */}
      {!isFullBleed && !isNoChrome && (
        <footer className="border-t bg-white/80">
          <div className="container-page py-3 text-xs text-slate-500 flex items-center justify-between">
            <span>© {new Date().getFullYear()} Fantasy Command Centre</span>
            {SWITCHER_ENABLED && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                Dev mode
              </span>
            )}
          </div>
        </footer>
      )}

      {/* Render the switcher OVER every route (incl. /login) */}
      {SWITCHER_ENABLED && <DevUserSwitcher />}
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
