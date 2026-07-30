import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getEffectiveUserId } from "../lib/auth";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import { useNotifications } from "./Notifications";
import { buildOutcomePayload } from "./LeagueStatusBanner";

export function LeagueOutcomeWatcher() {
  const location = useLocation();
  const { showOutcome } = useNotifications();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const viewerId = (await getEffectiveUserId()) ?? "";
      if (!viewerId || cancelled) return;

      const visibleResp = await fetch("/api/user-leagues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: viewerId }),
      });
      if (!visibleResp.ok || cancelled) return;

      const visibleLeagues = (await visibleResp.json()) as Array<any>;
      const activeLeagueId = localStorage.getItem("active_league_id") || "";
      const sortedLeagues = [...(visibleLeagues ?? [])].sort((a: any, b: any) => {
        if (a?.id === activeLeagueId) return -1;
        if (b?.id === activeLeagueId) return 1;
        return 0;
      });

      for (const league of sortedLeagues) {
        if (!league?.id || cancelled) continue;
        const nextState = await loadLeagueRoundState(String(league.id));
        if (cancelled) return;
        const viewerMembership =
          nextState.memberships.find((member: any) => String(member.player_id) === String(viewerId)) ?? null;
        const payload = buildOutcomePayload(
          {
            ...nextState,
            viewerId,
            viewerMembership,
          },
          String(league.id)
        );
        if (payload && !localStorage.getItem(payload.key)) {
          showOutcome(payload);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, location.search, showOutcome]);

  return null;
}
