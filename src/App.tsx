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

// Prefer explicit flag; fallback to Vite DEV for local only
const DEV_SWITCHER_ENABLED =
  (import.meta.env.VITE_DEV_SWITCHER_ENABLED === "true") || import.meta.env.DEV;

function AppInner() {
  const location = useLocation();

  // Full-bleed routes (no header/footer and no page container)
  const noChromeRoutes = ["/login"]; // hide header + footer
  const isNoChrome = noChromeRoutes.includes(location.pathname);

  // Full-bleed content (keeps header but removes container padding)
  // Landing is designed as a full page with its own footer, so don’t wrap/duplicate
  const fullBleedRoutes = ["/", "/login"];
  const isFullBleed = fullBleedRoutes.includes(location.pathname);

  return (
    <>
      {/* Header everywhere EXCEPT on no-chrome routes like /login */}
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
          {/* Use a param route so /league/123 works */}
          <Route path="/league/:leagueId" element={<LeagueSummary />} />
          <Route path="/private" element={<PrivateLeagueCreate />} />
        </Routes>
      </main>

      {/* App footer: hide on landing (it has its own) and on no-chrome pages like /login */}
      {!isFullBleed && !isNoChrome && (
        <footer className="border-t bg-white/80">
          <div className="container-page py-3 text-xs text-slate-500 flex items-center justify-between">
            <span>© {new Date().getFullYear()} Fantasy Command Centre</span>
            {DEV_SWITCHER_ENABLED && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                Dev mode
              </span>
            )}
          </div>
        </footer>
      )}

      {/* Dev test helper: only when explicitly enabled */}
      {DEV_SWITCHER_ENABLED && <DevUserSwitcher />}
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
