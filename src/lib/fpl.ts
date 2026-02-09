// src/lib/fpl.ts
// Client-side FPL helpers (MUST use same-origin proxy to avoid CORS blocks)

type FplTeam = { id: number; name: string; short_name: string };
type FplFixture = {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  kickoff_time: string | null;
  finished: boolean;
  finished_provisional: boolean;
};

// Same-origin Vercel function (created at /api/fpl.ts in project root)
const FPL_PROXY = "/api/fpl";

/**
 * Fetch JSON from the FPL proxy.
 * `path` must be an FPL API path like "/bootstrap-static/" or "/fixtures/?event=26".
 */
async function getJSON<T = any>(path: string): Promise<T> {
  const url = `${FPL_PROXY}?path=${encodeURIComponent(path)}`;

  const res = await fetch(url, { cache: "no-store" });

  if (!res.ok) {
    // Capture some response text for debugging (often useful if upstream returns HTML block page)
    const body = await res.text().catch(() => "");
    throw new Error(
      `Failed to fetch FPL data via proxy: ${res.status} ${res.statusText}${
        body ? ` :: ${body.slice(0, 200)}` : ""
      }`
    );
  }

  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Fetch all FPL teams
// ---------------------------------------------------------------------------
export async function fetchFplTeams(): Promise<FplTeam[]> {
  const data = await getJSON<{ teams: FplTeam[] }>("/bootstrap-static/");
  return data.teams;
}

// ---------------------------------------------------------------------------
// Fetch all fixtures (for every gameweek)
// ---------------------------------------------------------------------------
export async function fetchFplFixtures(): Promise<FplFixture[]> {
  return getJSON<FplFixture[]>("/fixtures/");
}

// ---------------------------------------------------------------------------
// Fetch fixtures for a specific Gameweek (event)
// Keeps keys used by supabaseService: kickoff, finished, home/away.short_name,
// homeScore, awayScore.
// ---------------------------------------------------------------------------
export async function fetchFplFixturesForEvent(eventNumber: number) {
  const [teamsData, fixturesData] = await Promise.all([
    getJSON<{ teams: FplTeam[] }>("/bootstrap-static/"),
    getJSON<FplFixture[]>(`/fixtures/?event=${eventNumber}`),
  ]);

  const teamById = new Map<number, FplTeam>(teamsData.teams.map((t) => [t.id, t]));
  const gw = fixturesData; // endpoint is already filtered by event

  return gw.map((f) => {
    const homeTeam = teamById.get(f.team_h);
    const awayTeam = teamById.get(f.team_a);

    return {
      fplId: f.id,
      kickoff: f.kickoff_time ?? undefined,
      finished: !!(f.finished || f.finished_provisional),
      home: {
        id: f.team_h,
        short_name: homeTeam?.short_name ?? `H${f.team_h}`,
        name: homeTeam?.name ?? `Team ${f.team_h}`,
        score: f.team_h_score,
      },
      away: {
        id: f.team_a,
        short_name: awayTeam?.short_name ?? `A${f.team_a}`,
        name: awayTeam?.name ?? `Team ${f.team_a}`,
        score: f.team_a_score,
      },
      homeScore: f.team_h_score,
      awayScore: f.team_a_score,
    };
  });
}

// ---------------------------------------------------------------------------
// Bootstrap + Smart Event (current → next → last finished)
// ---------------------------------------------------------------------------
export async function fetchBootstrap(): Promise<any> {
  return getJSON("/bootstrap-static/");
}

/** Choose the most relevant GW: current → next → last finished. */
export async function getSmartCurrentEvent(): Promise<number> {
  const data = await fetchBootstrap();
  const events = data.events as Array<{
    id: number;
    is_current: boolean;
    is_next: boolean;
    finished: boolean;
  }>;

  const current = events.find((e) => e.is_current);
  if (current) return current.id;

  const next = events.find((e) => e.is_next);
  if (next) return next.id;

  const finished = [...events].filter((e) => e.finished).sort((a, b) => b.id - a.id);
  if (finished.length) return finished[0].id;

  return events[0]?.id ?? 1;
}

/** First event whose deadline is on/after the given date, else the last one. */
export async function getEventForDate(dateISO: string): Promise<number> {
  const data = await fetchBootstrap();
  const events = data.events as Array<{ id: number; deadline_time: string }>;
  const ts = new Date(dateISO).getTime();

  const next = events
    .filter((e) => new Date(e.deadline_time).getTime() >= ts)
    .sort(
      (a, b) =>
        new Date(a.deadline_time).getTime() - new Date(b.deadline_time).getTime()
    )[0];

  return next ? next.id : events[events.length - 1].id;
}
