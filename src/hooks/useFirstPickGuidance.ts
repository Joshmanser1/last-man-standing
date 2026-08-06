import { useEffect, useState } from "react";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";
import { postJsonWithAuth } from "../lib/apiAuth";
import { getMarketingDemoPicks } from "../demo/service";
import { isMarketingDemoActive } from "../demo/runtime";

export function useFirstPickGuidance(leagueId?: string) {
  const [state, setState] = useState<{
    loading: boolean;
    shouldGuide: boolean;
    currentRoundId: string;
    currentRoundNumber: number | null;
    deadlineUtc: string | null;
  }>({
    loading: true,
    shouldGuide: false,
    currentRoundId: "",
    currentRoundNumber: null,
    deadlineUtc: null,
  });

  useEffect(() => {
    if (!leagueId) {
      setState({
        loading: false,
        shouldGuide: false,
        currentRoundId: "",
        currentRoundNumber: null,
        deadlineUtc: null,
      });
      return;
    }

    (async () => {
      try {
        const [uid, leagues] = await Promise.all([
          getEffectiveUserId(),
          (dataService as any).listLeagues?.(),
        ]);
        if (!uid) {
          setState((prev) => ({ ...prev, loading: false, shouldGuide: false }));
          return;
        }

        const league = (leagues || []).find((item: any) => item.id === leagueId) || null;
        const round = await dataService.getCurrentRound(leagueId);
        const [pickRowResult, memberResp] = await Promise.all([
          isMarketingDemoActive()
            ? Promise.resolve({
                data:
                  getMarketingDemoPicks(leagueId).find(
                    (pick: any) => pick.round_id === round.id && pick.player_id === uid
                  ) ?? null,
              })
            : supa
                .from("picks")
                .select("id")
                .eq("round_id", round.id)
                .eq("player_id", uid)
                .maybeSingle(),
          postJsonWithAuth("/api/league-members", { league_id: leagueId }),
        ]);
        const pickRow = pickRowResult?.data ?? null;

        let isPrivileged = league?.created_by === uid;
        let mine: any = null;
        if (memberResp.ok) {
          const members = (await memberResp.json()) as Array<any>;
          mine = members.find((member: any) => member.player_id === uid) ?? null;
          if (mine?.role === "owner" || mine?.role === "admin") {
            isPrivileged = true;
          }
        }

        const canGuide =
          !isPrivileged &&
          mine?.is_active !== false &&
          league?.status !== "completed" &&
          round?.status !== "completed" &&
          round?.status !== "locked" &&
          !pickRow;

        setState({
          loading: false,
          shouldGuide: !!canGuide,
          currentRoundId: round?.id ?? "",
          currentRoundNumber: round?.round_number ?? null,
          deadlineUtc: round?.pick_deadline_utc ?? null,
        });
      } catch {
        setState({
          loading: false,
          shouldGuide: false,
          currentRoundId: "",
          currentRoundNumber: null,
          deadlineUtc: null,
        });
      }
    })();
  }, [leagueId]);

  return state;
}
