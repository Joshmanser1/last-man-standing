import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";
import { useToast } from "./Toast";

export function LeagueStatusBanner({ leagueId: leagueIdProp }: { leagueId?: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [pick, setPick] = useState<any>(null);
  const [pickTeamName, setPickTeamName] = useState<string>("");
  const [viewerActive, setViewerActive] = useState<boolean>(true);
  const [progressNotice, setProgressNotice] = useState<{
    completedRoundNumber: number;
    survivors: number;
    eliminated: number;
    newRoundNumber: number;
  } | null>(null);

  const leagueId = leagueIdProp || localStorage.getItem("active_league_id") || "";

  useEffect(() => {
    if (!leagueId) {
      setLeague(null);
      setRound(null);
      setPick(null);
      setPickTeamName("");
      setViewerActive(true);
      setProgressNotice(null);
      return;
    }

    (async () => {
      const [uid, leagues] = await Promise.all([
        getEffectiveUserId(),
        (dataService as any).listLeagues?.(),
      ]);
      const activeLeague = (leagues || []).find((l: any) => l.id === leagueId) || null;
      setLeague(activeLeague);

      if (!activeLeague) {
        setRound(null);
        setPick(null);
        setPickTeamName("");
        return;
      }

      const currentRound = await dataService.getCurrentRound(leagueId);
      setRound(currentRound);

      if (!uid || !currentRound?.id) {
        setPick(null);
        setPickTeamName("");
        setViewerActive(true);
        setProgressNotice(null);
        return;
      }

      const [{ data: pickRow }, teams, memberResp] = await Promise.all([
        supa
          .from("picks")
          .select("*")
          .eq("round_id", currentRound.id)
          .eq("player_id", uid)
          .maybeSingle(),
        dataService.listTeams(leagueId),
        fetch("/api/league-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ league_id: leagueId }),
        }),
      ]);
      setPick(pickRow ?? null);
      setPickTeamName(
        (teams || []).find((team: any) => team.id === pickRow?.team_id)?.name ?? ""
      );

      if (memberResp.ok) {
        const members = (await memberResp.json()) as Array<any>;
        const mine = members.find((member: any) => member.player_id === uid);
        setViewerActive(mine?.is_active !== false);
      } else {
        setViewerActive(true);
      }

      const seenKey = `lms_last_seen_round_v1:${leagueId}:${uid}`;
      const seenRoundNumber = Number(localStorage.getItem(seenKey) || "0");
      if (currentRound.round_number > seenRoundNumber && currentRound.round_number > 1) {
        const { data: previousRound } = await supa
          .from("rounds")
          .select("id, round_number")
          .eq("league_id", leagueId)
          .eq("round_number", currentRound.round_number - 1)
          .maybeSingle();

        if (previousRound?.id) {
          const { data: previousPicks } = await supa
            .from("picks")
            .select("status")
            .eq("round_id", previousRound.id);
          const survivors = (previousPicks || []).filter((entry: any) => entry.status === "through").length;
          const eliminated = (previousPicks || []).filter(
            (entry: any) => entry.status === "eliminated" || entry.status === "no-pick"
          ).length;
          setProgressNotice({
            completedRoundNumber: previousRound.round_number,
            survivors,
            eliminated,
            newRoundNumber: currentRound.round_number,
          });
          toast(`Round ${currentRound.round_number} opened`, { variant: "success" });
        }
        localStorage.setItem(seenKey, String(currentRound.round_number));
      } else {
        setProgressNotice(null);
        localStorage.setItem(seenKey, String(currentRound.round_number));
      }
    })();
  }, [leagueId]);

  const pickOpen = useMemo(() => {
    if (!round) return false;
    if (round.status === "locked" || round.status === "completed") return false;
    if (league?.is_test) return true;
    if (!round.pick_deadline_utc) return true;
    return Date.parse(round.pick_deadline_utc) > Date.now();
  }, [round, league]);

  if (!leagueId || !round) return null;

  return (
    <div className="space-y-3">
      {progressNotice && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-emerald-800">
            Round {progressNotice.completedRoundNumber} Complete
          </div>
          <div className="mt-1 text-sm text-emerald-900">
            Survivors: {progressNotice.survivors} • Eliminated: {progressNotice.eliminated}
          </div>
          <div className="mt-1 text-sm text-emerald-800">
            Round {progressNotice.newRoundNumber} is now open.
          </div>
          {pickOpen && !pick && viewerActive && (
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
          )}
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {pickOpen && !pick ? (
        <>
          <div className="text-sm font-semibold text-emerald-700">
            Round {round.round_number} Open
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Deadline:{" "}
            {round.pick_deadline_utc
              ? new Date(round.pick_deadline_utc).toLocaleString()
              : "—"}
          </div>
          <div className="mt-1 text-sm text-slate-700">You have NOT picked yet</div>
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
        </>
      ) : pickOpen && pick ? (
        <>
          <div className="text-sm font-semibold text-emerald-700">Pick Submitted</div>
          <div className="mt-1 text-sm text-slate-700">
            {`Selected team: ${pickTeamName || "Team selected"}`}
          </div>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold text-slate-700">
            Round {round.round_number} Complete
          </div>
          <div className="mt-1 text-sm text-slate-600">Results available</div>
        </>
      )}
      </div>
    </div>
  );
}
