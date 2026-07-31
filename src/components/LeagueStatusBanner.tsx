import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveUserId } from "../lib/auth";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import {
  buildOutcomePayloadFromLeagueOutcome,
  getLeagueOutcomeForPlayer,
} from "../lib/leagueOutcome";

export function buildOutcomePayload(state: any, leagueId: string) {
  const viewerId = state.viewerId;
  const outcome = getLeagueOutcomeForPlayer(viewerId, leagueId, state);
  return buildOutcomePayloadFromLeagueOutcome(viewerId, outcome);
}

export function LeagueStatusBanner({ leagueId: leagueIdProp }: { leagueId?: string }) {
  const navigate = useNavigate();
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
      const currentRound = nextState.currentLeagueRound ?? nextState.round;
      const previousRound =
        currentRound && currentRound.round_number > 1
          ? nextState.rounds.find((entry: any) => entry.round_number === currentRound.round_number - 1) ?? null
          : null;
      setState({
        ...nextState,
        viewerId: uid ?? "",
        viewerMembership: nextState.viewerMembership,
        previousRound,
      });
    })();
  }, [leagueId]);

  const pickOpen = useMemo(() => {
    const activeRound = state?.currentLeagueRound ?? state?.round;
    if (!activeRound) return false;
    if (activeRound.status === "locked" || activeRound.status === "completed") return false;
    if (state.league?.is_test) return true;
    if (!activeRound.pick_deadline_utc) return true;
    return Date.parse(activeRound.pick_deadline_utc) > Date.now();
  }, [state]);

  if (!leagueId || !state?.round || !state?.league) return null;

  const viewerActive = state.viewerMembership?.is_active !== false;
  const winnerLabel = state.winnerName ? `Winner: ${state.winnerName}` : "Results available";
  const currentRound = state.currentLeagueRound ?? state.round;
  const elimination = state.viewerElimination;

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
      ) : !viewerActive && elimination ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-slate-700">
            You were eliminated in Round {elimination.round.round_number}
          </div>
          <div className="mt-1 text-sm text-slate-600">
            You can still follow the remaining rounds and view historical results.
          </div>
        </div>
      ) : pickOpen && viewerActive && !state.viewerPick ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-emerald-700">
            Round {currentRound.round_number} Open
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Deadline:{" "}
            {currentRound.pick_deadline_utc
              ? new Date(currentRound.pick_deadline_utc).toLocaleString()
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
      ) : pickOpen && viewerActive && state.viewerPick ? (
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
            Round {currentRound.round_number} Complete
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {viewerActive ? "Results available" : "Your run has ended. Historical results remain available."}
          </div>
        </div>
      )}
    </div>
  );
}
