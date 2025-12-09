// src/App.tsx
import React from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";

import { Header } from "./components/Header";
import { ToastProvider } from "./components/Toast";
import { DevUserSwitcher } from "./components/DevUserSwitcher";

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

const IS_DEV = import.meta.env.DEV || !import.meta.env.PROD;

function AppInner() {
  const location = useLocation();

  // Full-bleed routes: these pages render their own top bar/hero
  const FULL_BLEED = new Set<string>(["/", "/login"]);
  const isFullBleed = FULL_BLEED.has(location.pathname);

  return (
    <>
      {/* Header hidden on full-bleed pages (Landing/Login) to avoid duplication */}
      {!isFullBleed && <Header />}

      <main className={isFullBleed ? "" : "min-h-[calc(100vh-5rem)] bg-slate-50"}>
        <Routes>
          {/* Marketing / Landing (full-bleed) */}
          <Route path="/" element={<LandingPage />} />

          {/* Auth (full-bleed) */}
          <Route path="/login" element={<Login />} />

          {/* App pages */}
          <Route path="/home" element={<Home />} />
          <Route path="/live" element={<LiveGames />} />
          <Route path="/make-pick" element={<MakePick />} />
          <Route path="/results" element={<Results />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/my-games" element={<MyGames />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/eliminations" element={<EliminationHistory />} />
          <Route path="/league" element={<LeagueSummary />} />
          <Route path="/private/create" element={<PrivateLeagueCreate />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Footer hidden on full-bleed pages */}
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

      {/* Dev-only floating user switcher (safe in prod due to component guard) */}
      <DevUserSwitcher />
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
