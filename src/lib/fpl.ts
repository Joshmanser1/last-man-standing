// src/lib/fpl.ts
// Minimal FPL client using Vite proxy to bypass CORS during dev.
// Docs (unofficial): /api/bootstrap-static/ and /api/fixtures/

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

// ---------------------------------------------------------------------------
// Fetch all FPL teams
// ---------------------------------------------------------------------------
export async function fetchFplTeams(): Promise<FplTeam[]> {
  const res = await fetch("/fpl/api/bootstrap-static/");
  if (!res.ok) throw new Error(`Failed to fetch FPL teams: ${res.status}`);
  const data = await res.json();
  return data.teams as FplTeam[];
}

// ---------------------------------------------------------------------------
// Fetch all fixtures (for every gameweek)
// ---------------------------------------------------------------------------
export async function fetchFplFixtures(): Promise<FplFixture[]> {
  const res = await fetch("/fpl/api/fixtures/");
  if (!res.ok) throw new Error(`Failed to fetch FPL fixtures: ${res.status}`);
  return (await res.json()) as FplFixture[];
}

// ---------------------------------------------------------------------------
// Fetch fixtures for a specific Gameweek (event)
// Returns teams with BOTH short_name and full name for robust matching.
// ---------------------------------------------------------------------------
export async function fetchFplFixturesForEvent(eventNumber: number) {
  try {
    const [teams, fixtures] = await Promise.all([fetchFplTeams(), fetchFplFixtures()]);
    const teamById = new Map<number, FplTeam>(teams.map((t) => [t.id, t]));
    const gw = fixtures.filter((f) => f.event === eventNumber);

    return gw.map((f) => {
      const homeTeam = teamById.get(f.team_h);
      const awayTeam = teamById.get(f.team_a);
      return {
        fplId: f.id,
        kickoff: f.kickoff_time,
        finished: f.finished || f.finished_provisional,
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
  } catch (err) {
    console.error("Failed to fetch FPL fixtures:", err);
    throw new Error("Unable to fetch fixtures from the FPL API");
  }
}

// ---------------------------------------------------------------------------
// Bootstrap + Smart Event (current → next → last finished)
// ---------------------------------------------------------------------------
export async function fetchBootstrap(): Promise<any> {
  const res = await fetch("/fpl/api/bootstrap-static/");
  if (!res.ok) throw new Error(`Failed to fetch bootstrap: ${res.status}`);
  return res.json();
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
// Return the FPL event (gameweek id) whose deadline is the first deadline
// AFTER the chosen start date. If the date is beyond all deadlines,
// fall back to the last event.
export async function getEventForDate(dateISO: string): Promise<number> {
  const data = await fetchBootstrap();
  const events = data.events as Array<{ id: number; deadline_time: string }>;
  const ts = new Date(dateISO).getTime();

  // Find the next event whose deadline is after the chosen date
  const next = events.find(e => new Date(e.deadline_time).getTime() >= ts);
  if (next) return next.id;

  // Otherwise use the last one (late-season start)
  return events[events.length - 1].id;
}
