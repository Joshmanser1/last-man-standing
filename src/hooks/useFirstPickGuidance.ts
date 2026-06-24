import { useEffect, useState } from "react";
import { dataService } from "../data/service";
import { supa } from "../lib/supabaseClient";
import { getEffectiveUserId } from "../lib/auth";

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
        const [{ data: pickRow }, memberResp] = await Promise.all([
          supa
            .from("picks")
            .select("id")
            .eq("round_id", round.id)
            .eq("player_id", uid)
            .maybeSingle(),
          fetch("/api/league-members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ league_id: leagueId }),
          }),
        ]);

        let isPrivileged = league?.created_by === uid;
        if (memberResp.ok) {
          const members = (await memberResp.json()) as Array<any>;
          const mine = members.find((member: any) => member.player_id === uid);
          if (mine?.role === "owner" || mine?.role === "admin") {
            isPrivileged = true;
          }
        }

        setState({
          loading: false,
          shouldGuide: !isPrivileged && !pickRow,
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
