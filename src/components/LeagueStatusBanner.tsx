import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";

export function LeagueStatusBanner({ leagueId: leagueIdProp }: { leagueId?: string }) {
  const navigate = useNavigate();
  const [league, setLeague] = useState<any>(null);
  const [round, setRound] = useState<any>(null);
  const [pick, setPick] = useState<any>(null);
  const [pickTeamName, setPickTeamName] = useState<string>("");

  const leagueId = leagueIdProp || localStorage.getItem("active_league_id") || "";

  useEffect(() => {
    if (!leagueId) {
      setLeague(null);
      setRound(null);
      setPick(null);
      setPickTeamName("");
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
        return;
      }

      const [{ data: pickRow }, teams] = await Promise.all([
        supa
          .from("picks")
          .select("*")
          .eq("round_id", currentRound.id)
          .eq("player_id", uid)
          .maybeSingle(),
        dataService.listTeams(leagueId),
      ]);
      setPick(pickRow ?? null);
      setPickTeamName(
        (teams || []).find((team: any) => team.id === pickRow?.team_id)?.name ?? ""
      );
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
            {pickTeamName || "Team selected"}
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
  );
}
