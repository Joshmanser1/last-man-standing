import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveUserId } from "../lib/auth";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import { useNotifications } from "./Notifications";

function buildOutcomePayload(state: any, leagueId: string) {
  const league = state.league;
  const round = state.round;
  const viewerId = state.viewerId;
  const viewerPick = state.viewerPick;
  if (!league || !round || !viewerId || league.status !== "completed" || round.status !== "completed") {
    return null;
  }

  const keyBase = `lms_outcome_shown_v2:${leagueId}:${round.round_number}:${viewerId}`;
  if (state.winnerPlayerId && String(state.winnerPlayerId) === String(viewerId)) {
    return {
      type: "winner" as const,
      title: "You won!",
      body: `${league.name}. You were the last player standing.`,
      emoji: "🏆",
      key: `${keyBase}:winner`,
      stats: [
        { label: "League", value: league.name },
        { label: "Round", value: String(round.round_number) },
      ],
      ctas: [
        { label: "View final standings", to: "/leaderboard" },
        { label: "Dismiss", action: "close" as const },
      ],
    };
  }

  if (!viewerPick) return null;
  if (viewerPick.status === "eliminated" || viewerPick.status === "no-pick") {
    const teamName =
      viewerPick.status === "no-pick"
        ? "No pick"
        : state.teams.find((team: any) => String(team.id) === String(viewerPick.team_id))?.name ?? "Your pick";
    const body =
      viewerPick.status === "no-pick"
        ? `No pick was submitted before the Round ${round.round_number} deadline.`
        : `${teamName} did not win in Round ${round.round_number}.`;
    return {
      type: "eliminated" as const,
      title: "You're out",
      body,
      emoji: "❌",
      key: `${keyBase}:eliminated`,
      stats: [
        { label: "League", value: league.name },
        { label: "Round", value: String(round.round_number) },
      ],
      ctas: [
        { label: "View results", to: "/results" },
        { label: "Dismiss", action: "close" as const },
      ],
    };
  }

  return null;
}

export function LeagueStatusBanner({ leagueId: leagueIdProp }: { leagueId?: string }) {
  const navigate = useNavigate();
  const { showOutcome } = useNotifications();
  const [state, setState] = useState<any>(null);

  const leagueId = leagueIdProp || localStorage.getItem("active_league_id") || "";

  useEffect(() => {
    if (!leagueId) {
      setState(null);
      return;
    }

    (async () => {
      const nextState = await loadLeagueRoundState(leagueId);
      const uid = await getEffectiveUserId();
      const currentRound = nextState.round;
      const previousRound =
        currentRound && currentRound.round_number > 1
          ? nextState.rounds.find((round: any) => round.round_number === currentRound.round_number - 1) ?? null
          : null;
      const viewerMembership =
        uid
          ? nextState.memberships.find((member: any) => String(member.player_id) === String(uid)) ?? null
          : null;
      setState({
        ...nextState,
        viewerId: uid ?? "",
        viewerMembership,
        previousRound,
      });
    })();
  }, [leagueId]);

  useEffect(() => {
    if (!state) return;
    const payload = buildOutcomePayload(state, leagueId);
    if (payload) showOutcome(payload);
  }, [leagueId, showOutcome, state]);

  const pickOpen = useMemo(() => {
    if (!state?.round) return false;
    if (state.round.status === "locked" || state.round.status === "completed") return false;
    if (state.league?.is_test) return true;
    if (!state.round.pick_deadline_utc) return true;
    return Date.parse(state.round.pick_deadline_utc) > Date.now();
  }, [state]);

  if (!leagueId || !state?.round || !state?.league) return null;

  const viewerActive = state.viewerMembership?.is_active !== false;
  const winnerLabel = state.winnerName ? `Winner: ${state.winnerName}` : "Results available";

  return (
    <div className="space-y-3">
      {state.league.status === "completed" ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-700">
            League Complete
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Round {state.round.round_number} complete.
          </div>
          <div className="mt-1 text-sm text-slate-700">{winnerLabel}</div>
        </div>
      ) : pickOpen && !state.viewerPick ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-emerald-700">
            Round {state.round.round_number} Open
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Deadline:{" "}
            {state.round.pick_deadline_utc
              ? new Date(state.round.pick_deadline_utc).toLocaleString()
              : "\u2014"}
          </div>
          <div className="mt-1 text-sm text-slate-700">You have not picked yet</div>
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                localStorage.setItem("active_league_id", leagueId);
                navigate("/make-pick");
              }}
            >
              Make Pick
            </button>
          </div>
        </div>
      ) : pickOpen && state.viewerPick ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-emerald-700">Pick Submitted</div>
          <div className="mt-1 text-sm text-slate-700">
            {`Selected team: ${
              state.teams.find((team: any) => String(team.id) === String(state.viewerPick?.team_id))?.name ??
              "Team selected"
            }`}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-700">
            Round {state.round.round_number} Complete
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {viewerActive ? "Results available" : "Your run has ended. Historical results remain available."}
          </div>
        </div>
      )}
    </div>
  );
}
