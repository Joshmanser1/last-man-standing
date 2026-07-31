import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getEffectiveUserId } from "../lib/auth";
import { loadLeagueRoundState } from "../lib/leagueRoundState";
import { useNotifications } from "./Notifications";
import { buildOutcomePayload } from "./LeagueStatusBanner";
import { supa } from "../lib/supabaseClient";

export function LeagueOutcomeWatcher() {
  const location = useLocation();
  const { showOutcome } = useNotifications();
  const [authTick, setAuthTick] = useState(0);

  useEffect(() => {
    const { data: sub } = supa.auth.onAuthStateChange(() => {
      setAuthTick((value) => value + 1);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

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
        const payload = buildOutcomePayload(
          {
            ...nextState,
            viewerId,
            viewerMembership: nextState.viewerMembership,
          },
          String(league.id)
        );
        if (payload) {
          showOutcome(payload);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authTick, location.pathname, location.search, showOutcome]);

  return null;
}
