// src/App.tsx
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
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

// Dev-only user switcher (safe if missing in prod)
import { DevUserSwitcher } from "./components/DevUserSwitcher";

const IS_DEV = import.meta.env.DEV;

function AppInner() {
  const location = useLocation();
  // We only use this to hide the FOOTER on the landing page.
  const isFullBleed = location.pathname === "/";

  return (
    <>
      {/* Keep header always visible (this restores landing page header) */}
      <Header />

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
          <Route path="/league" element={<LeagueSummary />} />
          <Route path="/private" element={<PrivateLeagueCreate />} />
        </Routes>
      </main>

      {/* Hide footer only on landing page */}
      {!isFullBleed && (
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

      {/* Dev test helper: switch between fake users without re-login */}
      {IS_DEV && <DevUserSwitcher />}
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
