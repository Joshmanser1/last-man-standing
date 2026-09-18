// src/pages/MakePick.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { useCountdown } from "../hooks/useCountdown";
import { GameSelector } from "../components/GameSelector";
import { useToast } from "../components/Toast";
import ManagedLeagueHero from "../components/ManagedLeagueHero";
import { resolveManagedLeagueTheme } from "../lib/leagueTheme";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";
import { getMemberElimination, loadLeagueRoundState } from "../lib/leagueRoundState";
import { postJsonWithAuth } from "../lib/apiAuth";
import { fetchFplTeams } from "../lib/fpl";
import { Spinner } from "../components/ui/Spinner";
import { TeamBadge } from "../components/TeamBadge";
import {
  getInviteAttributionForLeague,
  trackInviteEventOnce,
} from "../lib/analytics";

type FixtureInfo = {
  opponent: string;
  venue: "Home" | "Away";
  kickoffUtc?: string | null;
};

type FixtureMap = Record<string, FixtureInfo>;

function normaliseFplTeamKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

const DEV_PREVIEW_LEAGUE = {
  id: "dev-make-pick-preview",
  name: "FCC Matchday Preview",
  status: "active",
  current_round: 4,
  is_test: false,
};

const DEV_PREVIEW_ROUND = {
  id: "dev-make-pick-preview-round",
  league_id: DEV_PREVIEW_LEAGUE.id,
  round_number: 4,
  status: "upcoming",
  pick_deadline_utc: "2099-08-23T14:00:00Z",
};

const DEV_PREVIEW_TEAMS = [
  ["arsenal", "Arsenal", "ARS", 3],
  ["aston-villa", "Aston Villa", "AVL", 7],
  ["bournemouth", "Bournemouth", "BOU", 91],
  ["brentford", "Brentford", "BRE", 94],
  ["brighton", "Brighton", "BHA", 36],
  ["chelsea", "Chelsea", "CHE", 8],
  ["crystal-palace", "Crystal Palace", "CRY", 31],
  ["everton", "Everton", "EVE", 11],
  ["fulham", "Fulham", "FUL", 54],
  ["liverpool", "Liverpool", "LIV", 14],
  ["man-city", "Man City", "MCI", 43],
  ["newcastle", "Newcastle", "NEW", 4],
].map(([id, name, code, fplTeamCode]) => ({ id, name, code, fplTeamCode: Number(fplTeamCode) }));

const DEV_PREVIEW_FIXTURES: FixtureMap = {
  arsenal: { opponent: "Brighton", venue: "Home", kickoffUtc: "2099-08-23T12:30:00Z" },
  brighton: { opponent: "Arsenal", venue: "Away", kickoffUtc: "2099-08-23T12:30:00Z" },
  "aston-villa": { opponent: "Newcastle", venue: "Home", kickoffUtc: "2099-08-23T15:00:00Z" },
  newcastle: { opponent: "Aston Villa", venue: "Away", kickoffUtc: "2099-08-23T15:00:00Z" },
  bournemouth: { opponent: "Everton", venue: "Home", kickoffUtc: "2099-08-23T15:00:00Z" },
  everton: { opponent: "Bournemouth", venue: "Away", kickoffUtc: "2099-08-23T15:00:00Z" },
  brentford: { opponent: "Fulham", venue: "Home", kickoffUtc: "2099-08-23T17:30:00Z" },
  fulham: { opponent: "Brentford", venue: "Away", kickoffUtc: "2099-08-23T17:30:00Z" },
  chelsea: { opponent: "Liverpool", venue: "Home", kickoffUtc: "2099-08-24T14:00:00Z" },
  liverpool: { opponent: "Chelsea", venue: "Away", kickoffUtc: "2099-08-24T14:00:00Z" },
  "crystal-palace": { opponent: "Man City", venue: "Home", kickoffUtc: "2099-08-24T16:30:00Z" },
  "man-city": { opponent: "Crystal Palace", venue: "Away", kickoffUtc: "2099-08-24T16:30:00Z" },
};

function formatKickoff(kickoffUtc?: string | null) {
  if (!kickoffUtc || Number.isNaN(Date.parse(kickoffUtc))) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(kickoffUtc));
}

export function MakePick() {
  const isDevPreview =
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("devPreview") === "1";
  const [leagueId, setLeagueId] = useState<string>(
    () => (isDevPreview ? DEV_PREVIEW_LEAGUE.id : localStorage.getItem("active_league_id") || "")
  );
  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [usedTeamIds, setUsedTeamIds] = useState<Set<string>>(new Set());
  const [usedByRound, setUsedByRound] = useState<Record<string, number>>({});
  const [currentPick, setCurrentPick] = useState<any>(null);
  const [fixtureByTeamId, setFixtureByTeamId] = useState<FixtureMap>({});
  const [fplTeamCodeByShortName, setFplTeamCodeByShortName] = useState<Record<string, number>>({});
  const [fplTeamCodeByLeagueTeamId, setFplTeamCodeByLeagueTeamId] = useState<Record<string, number>>({});
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickLocked, setPickLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [authUserId, setAuthUserId] = useState<string>("");
  const [viewerMembership, setViewerMembership] = useState<any>(null);
  const [winnerName, setWinnerName] = useState<string>("");
  const [inactiveMessage, setInactiveMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

  const navigate = useNavigate();
  const toast = useToast();
  const postSubmitNavigation = useRef<number | null>(null);

  const playerId = authUserId;

  useEffect(() => () => {
    if (postSubmitNavigation.current != null) window.clearTimeout(postSubmitNavigation.current);
  }, []);

  useEffect(() => {
    if (isDevPreview) {
      setAuthUserId("dev-preview-player");
      return;
    }

    let mounted = true;
    const load = async () => {
      const uid = (await getEffectiveUserId()) ?? "";
      if (mounted) setAuthUserId(uid);
      if (!uid) navigate("/login");
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [isDevPreview, navigate]);

  useEffect(() => {
    if (isDevPreview) {
      setLeague(DEV_PREVIEW_LEAGUE);
      setRound(DEV_PREVIEW_ROUND);
      setTeams(DEV_PREVIEW_TEAMS);
      setUsedTeamIds(new Set(["liverpool"]));
      setUsedByRound({ liverpool: 2 });
      setCurrentPick(null);
      setFixtureByTeamId(DEV_PREVIEW_FIXTURES);
      setSelectedTeamId("arsenal");
      setPickLocked(false);
      setViewerMembership({ player_id: "dev-preview-player", is_active: true });
      setWinnerName("");
      setInactiveMessage("");
      setLoadError("");
      setLoading(false);
      return;
    }

    if (!leagueId || !playerId) {
      setLeague(null);
      setRound(null);
      setTeams([]);
      setUsedTeamIds(new Set());
      setUsedByRound({});
      setCurrentPick(null);
      setFixtureByTeamId({});
      setFplTeamCodeByShortName({});
      setFplTeamCodeByLeagueTeamId({});
      setSelectedTeamId(null);
      setPickLocked(false);
      setViewerMembership(null);
      setWinnerName("");
      setInactiveMessage("");
      setLoadError("");
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      try {
        setLoadError("");
        const roundState = await loadLeagueRoundState(leagueId);
        const activeLeague = roundState.league ?? null;
        setLeague(activeLeague);

        if (!activeLeague) {
          setRound(null);
          setTeams([]);
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setCurrentPick(null);
          setFixtureByTeamId({});
          setFplTeamCodeByShortName({});
          setFplTeamCodeByLeagueTeamId({});
          setSelectedTeamId(null);
          setPickLocked(false);
          setViewerMembership(null);
          setWinnerName("");
          setInactiveMessage("");
          setLoadError("League not found");
          return;
        }

        const myMembership =
          (roundState.memberships ?? []).find((member: any) => String(member.player_id) === String(playerId)) ??
          null;
        setViewerMembership(myMembership);
        setWinnerName(roundState.winnerName ?? "");
        setLeague(roundState.league ?? activeLeague);
        setRound(roundState.round);
        setTeams(roundState.teams ?? []);
        setCurrentPick(roundState.viewerPick ?? null);
        setSelectedTeamId(null);
        setPickLocked(false);
        const elimination = myMembership
          ? getMemberElimination(myMembership, roundState.rounds, roundState.allLeaguePicks, leagueId)
          : null;
        if (activeLeague.status === "completed") {
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setFixtureByTeamId({});
          setInactiveMessage("");
          return;
        }
        if (myMembership?.is_active === false) {
          setUsedTeamIds(new Set());
          setUsedByRound({});
          setFixtureByTeamId({});
          setInactiveMessage(
            elimination?.pick?.status === "no-pick"
              ? `No pick was submitted before the Round ${elimination.round.round_number} deadline.`
              : elimination?.pick?.team_id
              ? `${
                  roundState.teams.find((team: any) => String(team.id) === String(elimination.pick.team_id))?.name ??
                  "Your team"
                } did not win in Round ${elimination?.round?.round_number ?? roundState.round?.round_number}.`
              : "You can still follow the remaining rounds and view the league history."
          );
          return;
        }

        const currentRound = roundState.round;
        if (!currentRound) {
          setLoadError("Failed to load the current round");
          return;
        }
        setRound(currentRound);

        const leagueTeams = roundState.teams ?? [];
        setTeams(leagueTeams ?? []);

        void fetchFplTeams()
          .then((fplTeams) => {
            const fplCodes = Object.fromEntries(
              fplTeams
                .filter((team) => Number.isInteger(team.code) && team.code > 0)
                .map((team) => [team.short_name.trim().toUpperCase(), team.code])
            );
            setFplTeamCodeByShortName(fplCodes);

            const fplCodeByKey = new Map<string, number>();
            for (const team of fplTeams) {
              if (!Number.isInteger(team.code) || team.code <= 0) continue;
              fplCodeByKey.set(normaliseFplTeamKey(team.short_name), team.code);
              fplCodeByKey.set(normaliseFplTeamKey(team.name), team.code);
            }
            setFplTeamCodeByLeagueTeamId(
              Object.fromEntries(
                leagueTeams.flatMap((team: any) => {
                  const fplTeamCode =
                    fplCodeByKey.get(normaliseFplTeamKey(team.code)) ??
                    fplCodeByKey.get(normaliseFplTeamKey(team.name));
                  return fplTeamCode ? [[String(team.id), fplTeamCode]] : [];
                })
              )
            );
          })
          .catch(() => {
            // Crests are decorative; retain initials/local fallback if FPL is unavailable.
            setFplTeamCodeByShortName({});
            setFplTeamCodeByLeagueTeamId({});
          });

        const used = await dataService.listUsedTeamIds(leagueId, playerId);
        setUsedTeamIds(used);

        setCurrentPick(roundState.viewerPick ?? null);

        try {
          const [{ data: myPicks }, { data: roundRows }] = await Promise.all([
            supa
              .from("picks")
              .select("team_id, round_id")
              .eq("league_id", leagueId)
              .eq("player_id", playerId),
            supa.from("rounds").select("id, round_number").eq("league_id", leagueId),
          ]);

          const roundById = new Map<string, number>(
            (roundRows ?? []).map((rr: any) => [String(rr.id), rr.round_number as number])
          );
          const byTeam: Record<string, number> = {};
          for (const p of myPicks ?? []) {
            const roundNumber = roundById.get(String(p.round_id));
            if (p.team_id && roundNumber != null) {
              byTeam[String(p.team_id)] = roundNumber;
            }
          }
          setUsedByRound(byTeam);
        } catch {
          setUsedByRound({});
        }

        try {
          const byTeamId = new Map<string, any>(
            (leagueTeams ?? []).map((team: any) => [String(team.id), team])
          );
          const { data: roundFixtures } = await supa
            .from("fixtures")
            .select("*")
            .eq("round_id", currentRound.id);
          const fixturesByTeam: FixtureMap = {};
          for (const f of roundFixtures ?? []) {
            const homeTeam = byTeamId.get(String(f.home_team_id));
            const awayTeam = byTeamId.get(String(f.away_team_id));

            const home = homeTeam?.name ?? "";
            const away = awayTeam?.name ?? "";

            if (home && away) {
              fixturesByTeam[String(f.home_team_id)] = {
                opponent: away,
                venue: "Home",
                kickoffUtc: f.kickoff_utc,
              };
              fixturesByTeam[String(f.away_team_id)] = {
                opponent: home,
                venue: "Away",
                kickoffUtc: f.kickoff_utc,
              };
            }
          }
          if ((roundFixtures?.length ?? 0) > 0 && Object.keys(fixturesByTeam).length === 0) {
            console.warn("[MakePick] Fixtures loaded but no team-opponent mappings were built", {
              leagueId,
              roundId: currentRound.id,
              fixtureCount: roundFixtures?.length ?? 0,
              teamCount: leagueTeams?.length ?? 0,
            });
          }
          setFixtureByTeamId(fixturesByTeam);
        } catch {
          setFixtureByTeamId({});
        }
      } catch (err: any) {
        setLoadError(err?.message ?? "Failed to load picks");
      } finally {
        setLoading(false);
      }
    })();
  }, [isDevPreview, leagueId, playerId, reloadTick]);

  const timeLeft = useCountdown(round?.pick_deadline_utc);
  const isTestMode = !!league?.is_test;

  const hardLocked =
    !!round && (round?.status === "locked" || round?.status === "completed");
  const locked = hardLocked || (!isTestMode && timeLeft === "Locked");
  const countdownLabel =
    round?.status === "completed"
      ? "Round Complete"
      : hardLocked
      ? "Locked"
      : timeLeft;
  const managedTheme = useMemo(() => resolveManagedLeagueTheme(league), [league]);

  const teamsAZ = useMemo(() => {
    const uniq = new Map<string, any>();
    for (const t of teams) if (!uniq.has(t.id)) uniq.set(t.id, t);
    return Array.from(uniq.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" })
    );
  }, [teams]);
  const selectedTeam = teamsAZ.find((team) => String(team.id) === String(selectedTeamId)) ?? null;
  const currentPickTeam = teamsAZ.find((team) => String(team.id) === String(currentPick?.team_id)) ?? null;

  function getFplTeamCode(team?: { id?: string; code?: string; fplTeamCode?: number }) {
    if (!team) return undefined;
    if (Number.isInteger(team.fplTeamCode) && Number(team.fplTeamCode) > 0) return team.fplTeamCode;
    return (
      fplTeamCodeByLeagueTeamId[String(team.id ?? "")] ??
      fplTeamCodeByShortName[String(team.code ?? "").trim().toUpperCase()]
    );
  }

  function selectTeam(teamId: string) {
    if (locked || submitting || usedTeamIds.has(teamId)) return;
    setSelectedTeamId(teamId);
  }

  async function submitPick() {
    try {
      if (!league || !round || !playerId || !selectedTeamId || submitting || pickLocked) return;
      if (locked || usedTeamIds.has(selectedTeamId)) return;

      if (isDevPreview) {
        setSubmitting(true);
        postSubmitNavigation.current = window.setTimeout(() => {
          setSubmitting(false);
          setCurrentPick({ team_id: selectedTeamId });
          setPickLocked(true);
          postSubmitNavigation.current = null;
        }, 500);
        return;
      }

      const teamId = selectedTeamId;
      const isUpdatingPick = !!currentPick && currentPick.team_id !== teamId;
      const isFirstPickForLeague = !currentPick && usedTeamIds.size === 0;

      if (currentPick && currentPick.team_id !== teamId) {
        const ok = confirm("Replace your existing pick with this team?");
        if (!ok) return;
      }
      setSubmitting(true);
      const res = await postJsonWithAuth("/api/submit-pick", {
        league_id: league.id,
        round_id: round.id,
        team_id: teamId,
      });
      if (!res.ok) {
        let msg = "Could not save pick.";
        try {
          const err = await res.json();
          msg = err?.error ?? msg;
        } catch {}
        throw new Error(msg);
      }
      if (isFirstPickForLeague) {
        trackInviteEventOnce(
          "first_pick_submitted",
          getInviteAttributionForLeague(String(league.id)),
          { current_round: round.round_number }
        );
      }
      toast(isUpdatingPick ? "Pick updated" : "Pick submitted", { variant: "success" });
      setCurrentPick({ team_id: teamId });
      setPickLocked(true);
    } catch (e: any) {
      toast(e?.message ?? "Could not save pick.", { variant: "error" });
    } finally {
      if (!isDevPreview) setSubmitting(false);
    }
  }

  if (!leagueId) {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <div className="max-w-xl mx-auto card p-6 space-y-4">
          <div className="flex justify-between items-center gap-3">
            <h1 className="text-2xl font-bold">Make your pick</h1>
            <GameSelector
              value={leagueId}
              label="Select game"
              onChange={(id) => {
                setLeagueId(id);
                setReloadTick((x) => x + 1);
              }}
            />
          </div>
          <p className="text-sm text-slate-600">
            Choose a Last Man Standing game to start making your pick. You can
            switch between games at any time from the selector.
          </p>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate("/my-games")}
            >
              My Games
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => navigate("/admin")}
            >
              Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !league || !round) {
    const message = loadError || "Loading picks...";
    return (
      <div
        data-testid="make-pick-page"
        className="min-h-[calc(100vh-4rem)] grid place-items-center"
      >
        <div className="flex flex-col items-center gap-3">
          {!isDevPreview && (
            <GameSelector
              value={leagueId}
              label="Viewing game"
              onChange={(id) => {
                setLeagueId(id);
                setReloadTick((x) => x + 1);
              }}
            />
          )}
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {!loadError && <Spinner size={18} />}
            <span>{message}</span>
          </div>
        </div>
      </div>
    );
  }

  if (league.status === "completed") {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <ManagedLeagueHero league={league} theme={managedTheme} />
        <div className="mb-4 flex justify-end">
          <GameSelector
            value={leagueId}
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <div className="mx-auto max-w-xl card p-6 space-y-4">
          <h1 className="text-2xl font-bold">This league is complete</h1>
          <p className="text-sm text-slate-600">
            {winnerName ? `Winner: ${winnerName}.` : "Final results are available."}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (viewerMembership?.is_active === false) {
    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <ManagedLeagueHero league={league} theme={managedTheme} />
        <div className="mb-4 flex justify-end">
          <GameSelector
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
        <div className="mx-auto max-w-xl card p-6 space-y-4">
          <h1 className="text-2xl font-bold">You've been eliminated</h1>
          <p className="text-sm text-slate-600">
            {inactiveMessage || "You can still follow the remaining rounds and view the league history."}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-primary" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => navigate("/leaderboard")}>
              View Leaderboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pickLocked && selectedTeam) {
    const fixture = fixtureByTeamId[String(selectedTeam.id)];
    const venue = fixture?.venue === "Home" ? "H" : fixture?.venue === "Away" ? "A" : null;

    return (
      <div data-testid="make-pick-page" className="container-page py-6">
        <ManagedLeagueHero league={league} theme={managedTheme} />
        <section className="pick-success-card mx-auto max-w-xl" role="status" aria-live="polite">
          <div className="pick-success-confetti" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
          </div>
          <div className="pick-success-check" aria-hidden="true">✓</div>
          <p className="pick-success-eyebrow">Pick locked in!</p>
          <div className="pick-success-team">
            <TeamBadge
              code={selectedTeam.code}
              logoUrl={selectedTeam.logo_url}
              fplTeamCode={getFplTeamCode(selectedTeam)}
              name={selectedTeam.name}
            />
            <div>
              <h1>{selectedTeam.name}</h1>
              {fixture && <p>vs {fixture.opponent} ({venue})</p>}
            </div>
          </div>
          <p className="pick-success-round">Round {round.round_number}</p>
          <p className="pick-success-copy">Good luck this round.</p>
          <p className="pick-success-rule">
            You can&apos;t change your pick after the deadline, and you can&apos;t use {selectedTeam.name} again this season.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button className="btn btn-primary px-6 py-3" type="button" onClick={() => navigate("/my-games")}>
              View My Games
            </button>
            <button
              className="btn btn-ghost px-6 py-3"
              type="button"
              onClick={() => {
                setPickLocked(false);
                setSelectedTeamId(null);
              }}
            >
              Back to Picks
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div data-testid="make-pick-page" className="container-page py-6">
      <ManagedLeagueHero league={league} theme={managedTheme} />
      {isDevPreview ? (
        <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100">
          DEVELOPMENT PREVIEW: in-memory sample data only. Submission is simulated and never calls the pick API.
        </div>
      ) : (
        <div className="mb-4 flex justify-end">
          <GameSelector
            value={leagueId}
            label="Viewing game"
            onChange={(id) => {
              setLeagueId(id);
              setReloadTick((x) => x + 1);
            }}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="card min-w-0 p-6 sm:p-7">
          <div className="mb-4">
            <h1 className="text-2xl font-bold">
              Round {round.round_number} - Make your pick
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Locks{" "}
              {round.pick_deadline_utc
                ? new Date(round.pick_deadline_utc).toLocaleString()
                : "—"}{" "}
              • <span className="font-mono">{countdownLabel}</span>
            </p>
            {isTestMode && (
              <p className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                TEST MODE - deadline bypass active
              </p>
            )}
            {hardLocked && (
              <p className="mt-1 text-xs font-medium text-rose-600">
                {round?.status === "completed"
                  ? "This round is complete."
                  : "This round is locked. Picks are closed."}
              </p>
            )}
          </div>

          {currentPick && (
            <div className="pick-current-card mb-5 flex items-center gap-3 px-4 py-3 text-sm">
              <TeamBadge
                code={currentPickTeam?.code}
                logoUrl={currentPickTeam?.logo_url}
                fplTeamCode={getFplTeamCode(currentPickTeam)}
                name={currentPickTeam?.name ?? "Current pick"}
                size="sm"
              />
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Current pick</div>
                <div className="truncate text-sm font-semibold text-white">
                  {currentPickTeam?.name ?? "—"}
                </div>
                <div className="mt-0.5 text-[11px] text-emerald-100/65">
                  You can change it any time before the deadline.
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2.5" aria-label="Choose a team">
            {teamsAZ.map((t) => {
              const alreadyUsed = usedTeamIds.has(t.id);
              const unavailable = alreadyUsed || locked;
              const disabled = unavailable || submitting || pickLocked;
              const usedRound = usedByRound[String(t.id)];
              const fixture = fixtureByTeamId[String(t.id)];
              const isSelected = String(selectedTeamId) === String(t.id);
              const isCurrentPick = String(currentPick?.team_id) === String(t.id);
              const kickoff = formatKickoff(fixture?.kickoffUtc);

              return (
                <button
                  key={t.id}
                  data-testid="team-select-btn"
                  type="button"
                  onClick={() => selectTeam(t.id)}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  className={[
                    "pick-team-row w-full text-left",
                    isSelected ? "pick-team-row-selected" : "",
                    unavailable ? "pick-team-row-unavailable" : "",
                  ].join(" ")}
                >
                  <TeamBadge
                    code={t.code}
                    logoUrl={t.logo_url}
                    fplTeamCode={getFplTeamCode(t)}
                    name={t.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-white">{t.name}</span>
                      {isCurrentPick && (
                        <span className="pick-row-status bg-emerald-300/10 text-emerald-200">Current</span>
                      )}
                    </span>
                    {fixture ? (
                      <span className="pick-fixture-info mt-1 text-xs text-slate-300">
                        <span className="pick-fixture-opponent">vs {fixture.opponent}</span>
                        <span className="pick-venue">{fixture.venue === "Home" ? "H" : "A"}</span>
                        {kickoff && <span className="pick-fixture-kickoff text-slate-400">{kickoff}</span>}
                      </span>
                    ) : (
                      <span className="mt-1 block text-xs text-slate-400">Fixture unavailable for Round {round.round_number}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {alreadyUsed && (
                      <span className="pick-row-status bg-rose-400/10 text-rose-200">
                        {usedRound != null ? `Used R${usedRound}` : "Used"}
                      </span>
                    )}
                    {locked && !alreadyUsed && <span className="pick-row-status bg-white/10 text-slate-300">Locked</span>}
                    {!unavailable && (
                      <span className={`pick-select-mark ${isSelected ? "pick-select-mark-selected" : ""}`} aria-hidden="true">
                        {isSelected ? "✓" : ""}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pick-submit-panel mt-5">
            <button
              data-testid="save-pick-btn"
              type="button"
              className="btn btn-primary w-full py-3"
              onClick={() => void submitPick()}
              disabled={!selectedTeam || locked || submitting}
            >
              {submitting ? (
                <><Spinner size={16} /> Saving pick...</>
              ) : selectedTeam ? (
                <>Submit pick: {selectedTeam.name}</>
              ) : (
                "Select a team to continue"
              )}
            </button>
          </div>

        </div>

        <aside className="card min-w-0 p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Game
            </div>
            <div className="mt-1 font-semibold">{league.name}</div>
            <div className="mt-1 text-xs text-slate-500">
              Round {round.round_number} •{" "}
              <span className="uppercase">{round?.status}</span>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
              Deadline
            </div>
            <div className="text-sm">
              {round.pick_deadline_utc
                ? new Date(round.pick_deadline_utc).toLocaleString()
                : "—"}
            </div>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              Time left: <span className="font-mono">{countdownLabel}</span>
            </div>
          </div>

          <div className="border-t pt-4 space-y-2 text-xs text-slate-600">
            <div className="font-semibold text-slate-700 text-sm">
              Pick rules
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>You can only use each team once per game.</li>
              <li>You may change your pick any time before the deadline.</li>
              <li>
                If your team loses or draws, you&apos;re out. Last manager
                standing wins.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
