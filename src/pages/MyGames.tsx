import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { useToast } from "../components/Toast";
import { getEffectiveUserId } from "../lib/auth";

const STORE_KEY = "lms_store_v1";

type DashboardLeague = {
  id: string;
  name: string;
  isPublic: boolean;
  status: string;
  roundNumber: number;
  roundStatus: string;
  deadlineUtc?: string;
  pickedTeamName?: string;
};

export function MyGames() {
  const navigate = useNavigate();
  const toast = useToast();

  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState<DashboardLeague[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string>(
    localStorage.getItem("active_league_id") || ""
  );

  useEffect(() => {
    (async () => {
      try {
        if (localStorage.getItem("player_id")) {
          setHydrated(true);
          return;
        }

        const { data } = await supa.auth.getSession();
        const user = data.session?.user;
        if (!user) {
          setHydrated(true);
          return;
        }

        const guessedName =
          localStorage.getItem("player_name") ||
          (user.user_metadata?.full_name as string | undefined) ||
          (user.email ? user.email.split("@")[0] : undefined) ||
          "Manager";

        const p = await dataService.upsertPlayer(guessedName);
        localStorage.setItem("player_id", p.id);
        localStorage.setItem("player_name", p.display_name ?? guessedName);
        if (!localStorage.getItem(STORE_KEY)) {
          localStorage.setItem(STORE_KEY, "{}");
        }
      } catch (e) {
        console.error("Failed to hydrate local player from Supabase session:", e);
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    (async () => {
      setLoading(true);
      try {
        const pid = (await getEffectiveUserId()) ?? "";
        if (!pid) {
          setLeagues([]);
          return;
        }

        const visibleResp = await fetch("/api/user-leagues", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: pid }),
        });
        if (!visibleResp.ok) throw new Error("Failed to load visible leagues");
        const visibleLeagues = (await visibleResp.json()) as Array<any>;

        const rows = await Promise.all(
          (visibleLeagues ?? []).map(async (league: any) => {
            const round = await dataService.getCurrentRound(league.id).catch(() => null);
            const teams = round ? await dataService.listTeams(league.id).catch(() => []) : [];
            const picks = round ? await dataService.listPicks(round.id).catch(() => []) : [];
            const mine = (picks || []).find((pick: any) => pick.player_id === pid) ?? null;
            const pickedTeamName =
              mine?.team_id && Array.isArray(teams)
                ? (teams.find((team: any) => team.id === mine.team_id)?.name as string | undefined)
                : undefined;

            return {
              id: league.id as string,
              name: league.name as string,
              isPublic: league.is_public === true,
              status: (league.status as string) ?? "upcoming",
              roundNumber: (round?.round_number as number) ?? (league.current_round as number) ?? 1,
              roundStatus: (round?.status as string) ?? "upcoming",
              deadlineUtc: (round?.pick_deadline_utc as string) ?? undefined,
              pickedTeamName,
            } as DashboardLeague;
          })
        );

        setLeagues(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [hydrated]);

  function setActive(id: string) {
    localStorage.setItem("active_league_id", id);
    setActiveLeagueId(id);
    toast("Active game set.", { variant: "success" });
  }

  function goToPick(id: string) {
    setActive(id);
    navigate("/make-pick");
  }

  function goToResults(id: string) {
    setActive(id);
    navigate("/results");
  }

  function goToLeaderboard(id: string) {
    setActive(id);
    navigate("/leaderboard");
  }

  const sections = useMemo(() => {
    const now = Date.now();
    const open = leagues.filter((league) => {
      const deadlineOpen =
        !league.deadlineUtc || Date.parse(league.deadlineUtc) > now;
      return (
        league.status !== "completed" &&
        league.roundStatus !== "locked" &&
        league.roundStatus !== "completed" &&
        deadlineOpen &&
        !league.pickedTeamName
      );
    });

    const picked = leagues.filter((league) => {
      const deadlineOpen =
        !league.deadlineUtc || Date.parse(league.deadlineUtc) > now;
      return (
        league.status !== "completed" &&
        league.roundStatus !== "locked" &&
        league.roundStatus !== "completed" &&
        deadlineOpen &&
        !!league.pickedTeamName
      );
    });

    const waiting = leagues.filter((league) => {
      if (league.status === "completed") return false;
      if (open.some((x) => x.id === league.id) || picked.some((x) => x.id === league.id)) {
        return false;
      }
      return league.roundStatus === "locked" || league.roundStatus === "completed";
    });

    const completed = leagues.filter((league) => league.status === "completed");

    return { open, picked, waiting, completed };
  }, [leagues]);

  if (!hydrated) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="text-sm text-slate-500">Loading your games...</div>
      </div>
    );
  }

  if (!localStorage.getItem("player_id")) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center p-4">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-xl font-semibold">You're not signed in</h2>
          <p className="text-sm text-slate-600">Log in first so we can load your games.</p>
          <button className="btn btn-primary" onClick={() => navigate("/login")}>
            Go to login
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="animate-pulse text-sm text-slate-500">Loading your games...</div>
      </div>
    );
  }

  const totalGames = leagues.length;
  const publicCount = leagues.filter((league) => league.isPublic).length;
  const privateCount = totalGames - publicCount;

  function renderSection(
    title: string,
    rows: DashboardLeague[],
    empty: string,
    actions: (league: DashboardLeague) => JSX.Element
  ) {
    return (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="text-xs text-slate-500">{rows.length} total</span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-slate-600">{empty}</div>
        ) : (
          <div className="space-y-3">
            {rows.map((league) => (
              <div
                key={league.id}
                className={[
                  "rounded-2xl border bg-white p-4 shadow-sm",
                  activeLeagueId === league.id ? "border-emerald-400/70" : "border-slate-200",
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-semibold">{league.name}</div>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                        {league.isPublic ? "Public" : "Private"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Round {league.roundNumber} • {league.roundStatus.toUpperCase()}
                    </div>
                    {league.deadlineUtc && (
                      <div className="mt-1 text-xs text-slate-500">
                        Deadline: {new Date(league.deadlineUtc).toLocaleString()}
                      </div>
                    )}
                    {league.pickedTeamName && (
                      <div className="mt-1 text-xs text-slate-500">
                        Selected team: {league.pickedTeamName}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">{actions(league)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Games</h1>
          <p className="text-sm text-slate-600">
            What you're currently playing and what you need to do next across{" "}
            <b>{totalGames}</b> game{totalGames === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="space-x-2 text-xs text-slate-500">
          <span>
            Public: <b>{publicCount}</b>
          </span>
          <span>•</span>
          <span>
            Private: <b>{privateCount}</b>
          </span>
        </div>
      </header>

      {renderSection(
        "Action Required",
        sections.open,
        "No leagues need a pick from you right now.",
        (league) => (
          <button className="btn btn-primary text-xs" onClick={() => goToPick(league.id)}>
            Make Pick
          </button>
        )
      )}

      {renderSection(
        "Pick Submitted",
        sections.picked,
        "No current-round picks submitted yet.",
        (league) => (
          <>
            <button className="btn btn-primary text-xs" onClick={() => goToResults(league.id)}>
              View Pick / Results
            </button>
            <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
              Leaderboard
            </button>
          </>
        )
      )}

      {renderSection(
        "Waiting / Locked",
        sections.waiting,
        "No leagues are waiting on results right now.",
        (league) => (
          <>
            <button className="btn btn-primary text-xs" onClick={() => goToResults(league.id)}>
              Results
            </button>
            <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
              Leaderboard
            </button>
          </>
        )
      )}

      {renderSection(
        "Completed Games",
        sections.completed,
        "No completed leagues yet.",
        (league) => (
          <>
            <button className="btn btn-primary text-xs" onClick={() => goToLeaderboard(league.id)}>
              Leaderboard
            </button>
            <button className="btn btn-ghost text-xs" onClick={() => goToResults(league.id)}>
              Results
            </button>
          </>
        )
      )}
    </div>
  );
}
