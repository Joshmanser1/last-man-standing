import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supa } from "../lib/supabaseClient";
import { useToast } from "../components/Toast";
import { getEffectiveUserId } from "../lib/auth";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import { getLeagueOutcomeForPlayer } from "../lib/leagueOutcome";
import { postJsonWithAuth } from "../lib/apiAuth";
import { TeamBadge } from "../components/TeamBadge";
import { fetchFplTeams } from "../lib/fpl";

const STORE_KEY = "lms_store_v1";

type DashboardLeague = {
  id: string;
  name: string;
  isPublic: boolean;
  status: string;
  roundNumber: number;
  roundStatus: string;
  deadlineUtc?: string;
  hasViewerPick: boolean;
  viewerActive: boolean;
  eliminationRound?: number;
  pickedTeamName?: string;
  pickedTeamFplCode?: number;
  winnerName?: string;
};

type DashboardSection = "action" | "picked" | "waiting" | "following" | "completed";

function previewDeadline(hoursFromNow: number) {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

const DEV_PREVIEW_LEAGUES: DashboardLeague[] = [
  {
    id: "dev-my-games-action-required",
    name: "The 44 Last Man Standing",
    isPublic: true,
    status: "active",
    roundNumber: 6,
    roundStatus: "upcoming",
    deadlineUtc: previewDeadline(18),
    hasViewerPick: false,
    viewerActive: true,
  },
  {
    id: "dev-my-games-pick-submitted",
    name: "Mark FPL Last Man Standing",
    isPublic: false,
    status: "active",
    roundNumber: 2,
    roundStatus: "upcoming",
    deadlineUtc: previewDeadline(27),
    hasViewerPick: true,
    viewerActive: true,
    pickedTeamName: "Arsenal",
    pickedTeamFplCode: 3,
  },
  {
    id: "dev-my-games-waiting",
    name: "FCC £100 Last Man Standing",
    isPublic: true,
    status: "active",
    roundNumber: 4,
    roundStatus: "locked",
    deadlineUtc: previewDeadline(-3),
    hasViewerPick: true,
    viewerActive: true,
    pickedTeamName: "Chelsea",
    pickedTeamFplCode: 8,
  },
  {
    id: "dev-my-games-following",
    name: "North Stand Survival League",
    isPublic: false,
    status: "active",
    roundNumber: 6,
    roundStatus: "upcoming",
    deadlineUtc: previewDeadline(42),
    hasViewerPick: false,
    viewerActive: false,
    eliminationRound: 3,
  },
  {
    id: "dev-my-games-completed",
    name: "FCC Opening Weekend LMS",
    isPublic: true,
    status: "completed",
    roundNumber: 8,
    roundStatus: "completed",
    hasViewerPick: true,
    viewerActive: true,
    winnerName: "Ava",
  },
];

function formatDeadline(deadlineUtc?: string) {
  if (!deadlineUtc || Number.isNaN(Date.parse(deadlineUtc))) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(deadlineUtc));
}

function getDeadlineLabel(deadlineUtc?: string) {
  if (!deadlineUtc) return null;
  const milliseconds = Date.parse(deadlineUtc) - Date.now();
  if (milliseconds <= 0) return "Deadline passed";

  const hours = Math.ceil(milliseconds / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

export function MyGames() {
  const navigate = useNavigate();
  const toast = useToast();
  const isDevPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("devPreview") === "1";

  const [hydrated, setHydrated] = useState(isDevPreview);
  const [loading, setLoading] = useState(!isDevPreview);
  const [leagues, setLeagues] = useState<DashboardLeague[]>(() =>
    isDevPreview ? DEV_PREVIEW_LEAGUES : []
  );
  const [fplTeamCodeByName, setFplTeamCodeByName] = useState<Record<string, number>>({});
  const [activeLeagueId, setActiveLeagueId] = useState<string>(
    () => (isDevPreview ? DEV_PREVIEW_LEAGUES[0].id : localStorage.getItem("active_league_id") || "")
  );

  useEffect(() => {
    if (isDevPreview) return;

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

        // Profile names must come from an explicit user choice, never an email fallback.
        localStorage.setItem("player_id", user.id);
        if (!localStorage.getItem(STORE_KEY)) {
          localStorage.setItem(STORE_KEY, "{}");
        }
      } catch (e) {
        console.error("Failed to hydrate local player from Supabase session:", e);
      } finally {
        setHydrated(true);
      }
    })();
  }, [isDevPreview]);

  useEffect(() => {
    if (isDevPreview) return;
    if (!hydrated) return;

    (async () => {
      setLoading(true);
      try {
        const pid = (await getEffectiveUserId()) ?? "";
        if (!pid) {
          setLeagues([]);
          return;
        }

        const visibleResp = await postJsonWithAuth("/api/user-leagues", { user_id: pid });
        if (!visibleResp.ok) throw new Error("Failed to load visible leagues");
        const visibleLeagues = (await visibleResp.json()) as Array<any>;

        const rows = await Promise.all(
          (visibleLeagues ?? []).map(async (league: any) => {
            const state = await loadLeagueRoundState(league.id);
            const hasViewerPick = !!state.viewerPick;
            const viewerMembership =
              (state.memberships ?? []).find((member: any) => String(member.player_id) === String(state.viewerId)) ??
              null;
            const viewerOutcome = getLeagueOutcomeForPlayer(state.viewerId, String(league.id), state);
            const pickedTeamName =
              state.viewerPick?.team_id && Array.isArray(state.teams)
                ? (state.teams.find((team: any) => String(team.id) === String(state.viewerPick.team_id))?.name as string | undefined)
                : undefined;

            return {
              id: league.id as string,
              name: league.name as string,
              isPublic: league.is_public === true,
              status: (league.status as string) ?? "upcoming",
              roundNumber: (state.round?.round_number as number) ?? (league.current_round as number) ?? 1,
              roundStatus: (state.round?.status as string) ?? "upcoming",
              deadlineUtc: (state.round?.pick_deadline_utc as string) ?? undefined,
              hasViewerPick,
              viewerActive: viewerMembership?.is_active !== false,
              eliminationRound: viewerOutcome?.eliminationRound ?? undefined,
              pickedTeamName,
              winnerName: state.winnerName ?? undefined,
            } as DashboardLeague;
          })
        );
        setLeagues(rows);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeLeagueId, hydrated, isDevPreview]);

  useEffect(() => {
    if (isDevPreview) return;

    void fetchFplTeams()
      .then((teams) => {
        const teamCodes = Object.fromEntries(
          teams
            .filter((team) => Number.isInteger(team.code) && team.code > 0)
            .flatMap((team) => [
              [team.name.trim().toLowerCase(), team.code],
              [team.short_name.trim().toLowerCase(), team.code],
            ])
        );
        setFplTeamCodeByName(teamCodes);
      })
      .catch(() => {
        // Team crests are decorative; TeamBadge retains its initials fallback.
        setFplTeamCodeByName({});
      });
  }, [isDevPreview]);

  function setActive(id: string) {
    if (isDevPreview) {
      setActiveLeagueId(id);
      return;
    }

    localStorage.setItem("active_league_id", id);
    setActiveLeagueId(id);
    toast("Active game set.", { variant: "success" });
  }

  function goToPick(id: string) {
    setActive(id);
    if (isDevPreview) return;
    navigate("/make-pick");
  }

  function goToLeaderboard(id: string) {
    setActive(id);
    if (isDevPreview) return;
    navigate("/leaderboard");
  }

  const sections = useMemo(() => {
    const now = Date.now();
    const open = leagues.filter((league) => {
      if (!league.viewerActive) return false;
      const deadlineOpen =
        !league.deadlineUtc || Date.parse(league.deadlineUtc) > now;
      return (
        league.status !== "completed" &&
        league.roundStatus !== "locked" &&
        league.roundStatus !== "completed" &&
        deadlineOpen &&
        !league.hasViewerPick
      );
    });

    const picked = leagues.filter((league) => {
      if (!league.viewerActive) return false;
      return (
        league.status !== "completed" &&
        league.roundStatus !== "locked" &&
        league.roundStatus !== "completed" &&
        league.hasViewerPick
      );
    });

    const waiting = leagues.filter((league) => {
      if (!league.viewerActive) return false;
      if (league.status === "completed") return false;
      if (open.some((x) => x.id === league.id) || picked.some((x) => x.id === league.id)) {
        return false;
      }
      return league.roundStatus === "locked" || league.roundStatus === "completed";
    });

    const following = leagues.filter((league) => {
      if (league.viewerActive) return false;
      return league.status !== "completed";
    });

    const completed = leagues.filter((league) => league.status === "completed");

    return { open, picked, waiting, following, completed };
  }, [leagues]);

  if (!hydrated) {
    return (
      <div className="min-h-[calc(100vh-5rem)] grid place-items-center">
        <div className="text-sm text-slate-500">Loading your games...</div>
      </div>
    );
  }

  if (!isDevPreview && !localStorage.getItem("player_id")) {
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
    kind: DashboardSection,
    title: string,
    rows: DashboardLeague[],
    empty: string,
    actions: (league: DashboardLeague) => ReactNode
  ) {
    return (
      <section className={`my-games-section my-games-section-${kind} space-y-3`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <span className="text-[11px] text-slate-500">{rows.length} total</span>
        </div>

        {rows.length === 0 ? (
          <div className="my-games-empty rounded-2xl border p-4 text-sm text-slate-600">{empty}</div>
        ) : (
          <div className="space-y-3">
            {rows.map((league) => {
              const statusLabel =
                kind === "action"
                  ? "Pick required"
                  : kind === "picked"
                  ? "Pick submitted"
                  : kind === "waiting"
                  ? "Pick locked"
                  : kind === "following"
                  ? `Eliminated · Round ${league.eliminationRound ?? league.roundNumber}`
                  : "Completed";
              const pickedTeamName = league.pickedTeamName ?? "";
              const fplTeamCode =
                league.pickedTeamFplCode ?? fplTeamCodeByName[pickedTeamName.trim().toLowerCase()];
              const showTeam = (kind === "picked" || kind === "waiting") && !!pickedTeamName;
              const deadline = formatDeadline(league.deadlineUtc);
              const deadlineLabel = getDeadlineLabel(league.deadlineUtc);

              return (
                <div
                  key={league.id}
                  className={[
                    "my-games-card my-games-card-" + kind,
                    activeLeagueId === league.id ? "my-games-card-active" : "",
                  ].join(" ")}
                >
                  <div className="my-games-card-main min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 text-base font-bold leading-tight text-white">{league.name}</h3>
                      <span className="my-games-visibility">
                        {league.isPublic ? "Public" : "Private"}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="my-games-status-chip">{statusLabel}</span>
                      <span className="my-games-round">Round {league.roundNumber}</span>
                    </div>

                    {showTeam && (
                      <div className="my-games-picked-team mt-3">
                        <TeamBadge
                          code={pickedTeamName}
                          fplTeamCode={fplTeamCode}
                          name={pickedTeamName}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                            {kind === "waiting" ? "Locked selection" : "Your selection"}
                          </div>
                          <div className="truncate text-sm font-extrabold uppercase tracking-[0.08em] text-emerald-100">
                            {pickedTeamName}
                          </div>
                        </div>
                      </div>
                    )}

                    {kind === "action" && deadline && (
                      <div className="my-games-deadline mt-3">
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-200/75">Pick deadline</div>
                          <div className="mt-0.5 text-sm font-semibold text-white">{deadline}</div>
                        </div>
                        {deadlineLabel && <span className="my-games-deadline-label">{deadlineLabel}</span>}
                      </div>
                    )}

                    {kind !== "action" && deadline && (
                      <div className="mt-3 text-xs text-slate-400">
                        {kind === "waiting" ? "Locked at" : "Deadline"}: {deadline}
                      </div>
                    )}

                    {kind === "completed" && league.winnerName && (
                      <div className="mt-3 text-xs text-slate-400">
                        Winner: <span className="font-semibold text-slate-200">{league.winnerName}</span>
                      </div>
                    )}
                  </div>

                  <div className="my-games-card-actions flex shrink-0 flex-wrap gap-2 text-xs">{actions(league)}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="my-games-shell mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      {isDevPreview && (
        <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          DEVELOPMENT PREVIEW: in-memory game states only. Actions are disabled from navigating or writing data.
        </div>
      )}
      <header className="my-games-header flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Games</h1>
          <p className="text-sm text-slate-600">
            What you're currently playing and what you need to do next across{" "}
            <b>{totalGames}</b> game{totalGames === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="my-games-counts space-x-2 text-xs text-slate-500">
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
        "action",
        "Action Required",
        sections.open,
        "No leagues need action right now. We'll show games here when a new pick is required.",
        (league) => (
          <button className="btn btn-primary text-xs" onClick={() => goToPick(league.id)}>
            Make Pick
          </button>
        )
      )}

      {renderSection(
        "picked",
        "Pick Submitted",
        sections.picked,
        "No picks submitted for this round yet.",
        (league) => (
          <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
            Leaderboard
          </button>
        )
      )}

      {renderSection(
        "waiting",
        "Waiting / Locked",
        sections.waiting,
        "No leagues are waiting right now. We'll show them here once picks are locked or results are pending.",
        (league) => (
          <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
            Leaderboard
          </button>
        )
      )}

      {renderSection(
        "following",
        "Eliminated / Following",
        sections.following,
        "No eliminated leagues to follow right now.",
        (league) => (
          <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
            Leaderboard
          </button>
        )
      )}

      {renderSection(
        "completed",
        "Completed Games",
        sections.completed,
        "No completed games yet. Finished leagues will appear here.",
        (league) => (
          <button className="btn btn-ghost text-xs" onClick={() => goToLeaderboard(league.id)}>
            Leaderboard
          </button>
        )
      )}
    </div>
  );
}




