// src/pages/Home.tsx
import { useEffect, useState } from "react";
import { dataService, subscribeStore } from "../data/service";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { useNotifications } from "../components/Notifications";
import { NotificationCentre } from "../components/NotificationCentre";

const STORE_KEY = "lms_store_v1";
const DEFAULT_LEAGUE_NAME = "English Premier League LMS";

type LeagueLite = {
  id: string;
  name: string;
  current_round: number;
  status: string;
  deleted_at?: string | null; // <-- hide soft-deleted/archived leagues
};

export function Home() {
  const { showDeadlineReminder } = useNotifications();
  const [leagues, setLeagues] = useState<LeagueLite[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>("");

  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [hasGame, setHasGame] = useState<boolean>(() => {
    return (
      !!localStorage.getItem("player_id") &&
      !!localStorage.getItem("active_league_id")
    );
  });
  const [activeLeague, setActiveLeague] = useState<LeagueLite | null>(null);

  const navigate = useNavigate();
  const toast = useToast();

  async function reloadLeagues() {
    let ls: LeagueLite[] | undefined;

    if ((dataService as any).listLeagues) {
      ls = await (dataService as any).listLeagues();
    }
    if (!ls || !ls.length) {
      const l = await dataService.getLeagueByName(DEFAULT_LEAGUE_NAME);
      if (l) ls = [l as LeagueLite];
    }

    // 🔒 hide deleted/archived leagues from all pickers
    ls = (ls ?? []).filter((x) => !x.deleted_at);

    setLeagues(ls);

    const savedLeagueId = localStorage.getItem("active_league_id");
    if (savedLeagueId && ls.length) {
      const match = ls.find((x) => x.id === savedLeagueId) || null;
      setActiveLeague(match);
      setSelectedLeagueId(match ? match.id : ls[0]?.id ?? "");
      if (!match) {
        // clear ghost selection if it was deleted
        localStorage.removeItem("active_league_id");
      }
    } else if (ls.length && !selectedLeagueId) {
      setSelectedLeagueId(ls[0].id);
    }
  }

  // Initial load + subscribe to store updates + focus refresh
  useEffect(() => {
    reloadLeagues();

    const unsub = subscribeStore(() => {
      reloadLeagues();
      setHasGame(
        !!localStorage.getItem("player_id") &&
          !!localStorage.getItem("active_league_id")
      );
    });

    const onFocus = () => reloadLeagues();
    window.addEventListener("focus", onFocus);

    const storedName = localStorage.getItem("player_name");
    if (storedName) setDisplayName(storedName);

    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const leagueId = localStorage.getItem("active_league_id") || activeLeague?.id;
    const playerId = localStorage.getItem("player_id");
    if (!leagueId || !playerId) return;

    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;

    const s = JSON.parse(raw);
    const league = (s.leagues || []).find((l: any) => l.id === leagueId);
    if (!league) return;

    const round = (s.rounds || []).find(
      (r: any) => r.league_id === leagueId && r.round_number === league.current_round
    );
    if (!round?.id || !round?.pick_deadline_utc) return;

    showDeadlineReminder({
      leagueId,
      roundId: round.id,
      deadlineISO: round.pick_deadline_utc,
      playerId,
    });
  }, [activeLeague, hasGame, showDeadlineReminder]);

  async function join() {
    if (!selectedLeagueId)
      return toast("Select a game to join.", { variant: "error" });
    if (!displayName.trim())
      return toast("Enter your name.", { variant: "error" });

    setLoading(true);
    try {
      const p = await dataService.upsertPlayer(displayName.trim());
      await dataService.ensureMembership(selectedLeagueId, p.id);

      localStorage.setItem("player_id", p.id);
      localStorage.setItem("player_name", displayName.trim());
      localStorage.setItem("active_league_id", selectedLeagueId);

      localStorage.getItem(STORE_KEY) || localStorage.setItem(STORE_KEY, "{}");

      setHasGame(true);
      const joinedLeague =
        leagues.find((l) => l.id === selectedLeagueId) || null;
      setActiveLeague(joinedLeague);

      toast("Joined game. Let’s make your pick!", { variant: "success" });
      navigate("/make-pick");
    } catch (e: any) {
      toast(e?.message ?? "Could not join the game.", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      data-testid="lms-dashboard"
      className="min-h-[calc(100vh-5rem)] flex items-start sm:items-center justify-center p-4"
    >
      <div className="w-full max-w-3xl space-y-4">
        <NotificationCentre />
        <div className="grid gap-6 sm:grid-cols-[2fr,1.5fr]">
        {/* Left: join public game */}
        <div className="card p-6 sm:p-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">Last Man Standing</h1>
              <p className="text-sm text-slate-600 mt-1">
                Join an existing public game and make your pick each Gameweek.
              </p>
            </div>

            <Link
              to="/admin"
              className="text-xs rounded-lg border px-3 py-1.5 hover:bg-slate-50"
              title="Open Admin Panel"
            >
              Admin Panel
            </Link>
          </div>

          {hasGame && activeLeague && (
            <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex flex-wrap items-center gap-2">
              <span>
                You&apos;re currently playing in <b>{activeLeague.name}</b>.
              </span>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-[11px]"
                onClick={() => navigate("/make-pick")}
              >
                Go to Make Pick
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-[11px]"
                onClick={() => navigate("/my-games")}
              >
                View my games
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="label mb-1">Choose a game</label>
              <select
                className="input !w-full"
                value={selectedLeagueId}
                onChange={(e) => setSelectedLeagueId(e.target.value)}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} • R{l.current_round} • {l.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label mb-1">Your Name</label>
              <input
                className="input !w-full"
                placeholder="e.g. Alex"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                data-testid="join-game-btn"
                disabled={loading}
                onClick={join}
                className="btn btn-primary"
              >
                {loading ? "Joining…" : "Join Game"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/my-games")}
                className="btn btn-ghost text-sm"
              >
                View my games
              </button>
            </div>
          </div>
        </div>

        {/* Right: private leagues promo */}
        <div className="card p-6 sm:p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-700 text-white">
          <h2 className="text-xl font-semibold mb-1">Private leagues</h2>
          <p className="text-sm text-slate-100/90 mb-4">
            Spin up a mini Last Man Standing just for your mates, work league,
            or Telegram group. Pick an FPL Gameweek to start from and share an
            invite code.
          </p>

          <ul className="text-sm space-y-2 mb-5 text-slate-100/90">
            <li>• Start from any future FPL Gameweek</li>
            <li>• Invite friends via unique code</li>
            <li>• Track eliminations round by round</li>
          </ul>

          <button
            type="button"
            className="btn btn-accent w-full justify-center"
            onClick={() => navigate("/private/create")}
          >
            Create a private league
          </button>

          <p className="mt-2 text-[11px] text-slate-200/80">
            Already have a code?{" "}
            <span
              className="underline cursor-pointer"
              onClick={() => navigate("/private/join")}
            >
              Join a private league
            </span>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
