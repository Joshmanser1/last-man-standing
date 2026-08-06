import {
  getMarketingDemoJoinCode,
  isMarketingDemoActive,
  joinMarketingDemoLeague,
  submitMarketingDemoPick,
} from "./runtime";
import {
  getMarketingDemoLeaguePreview,
  getMarketingDemoMembers,
  getMarketingDemoPicks,
  getMarketingDemoSnapshot,
  getMarketingDemoState,
} from "./service";
import marketingDemoService from "./service";

let installed = false;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function bodyOf(init?: RequestInit) {
  const raw = init?.body;
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

async function handleDemoApi(pathname: string, init?: RequestInit) {
  const body = await bodyOf(init);

  if (pathname === "/api/user-leagues") {
    return jsonResponse(200, getMarketingDemoSnapshot().leagues);
  }

  if (pathname === "/api/league-by-code") {
    const joinCode = typeof body?.join_code === "string" ? body.join_code : "";
    const preview = getMarketingDemoLeaguePreview(joinCode);
    return preview
      ? jsonResponse(200, preview)
      : jsonResponse(404, { error: "League not found for join_code" });
  }

  if (pathname === "/api/join-league") {
    const joinCode = typeof body?.join_code === "string" ? body.join_code : "";
    if (joinCode.toUpperCase() !== getMarketingDemoJoinCode()) {
      return jsonResponse(404, { error: "League not found for join_code" });
    }
    return jsonResponse(200, joinMarketingDemoLeague());
  }

  if (pathname === "/api/league-state") {
    const leagueId = typeof body?.league_id === "string" ? body.league_id : "";
    try {
      return jsonResponse(200, getMarketingDemoState(leagueId));
    } catch {
      return jsonResponse(404, { error: "League not found" });
    }
  }

  if (pathname === "/api/league-members") {
    const leagueId = typeof body?.league_id === "string" ? body.league_id : "";
    return jsonResponse(200, getMarketingDemoMembers(leagueId));
  }

  if (pathname === "/api/league-picks") {
    const leagueId = typeof body?.league_id === "string" ? body.league_id : "";
    return jsonResponse(200, getMarketingDemoPicks(leagueId));
  }

  if (pathname === "/api/submit-pick") {
    const teamId = typeof body?.team_id === "string" ? body.team_id : "";
    const pick = submitMarketingDemoPick(teamId);
    return pick ? jsonResponse(200, pick) : jsonResponse(400, { error: "Could not save pick." });
  }

  if (pathname === "/api/create-league") {
    const name = typeof body?.name === "string" ? body.name : "Weekend Winners Demo";
    return jsonResponse(
      200,
      await marketingDemoService.createGame(name, new Date().toISOString())
    );
  }

  return null;
}

export function installMarketingDemoFetchInterceptor() {
  if (installed || typeof window === "undefined" || !window.fetch) return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isMarketingDemoActive()) {
      return originalFetch(input, init);
    }

    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const url = new URL(requestUrl, window.location.origin);
    if (!url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    const response = await handleDemoApi(url.pathname, init);
    return response ?? originalFetch(input, init);
  };

  installed = true;
}
