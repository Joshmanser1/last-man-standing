// src/lib/fplDeadlines.ts
// Helper for mapping LMS rounds -> FPL Gameweek deadlines

type FplEvent = {
  id: number;
  name: string;
  deadline_time: string; // ISO UTC
  is_current: boolean;
  is_next: boolean;
  finished: boolean;
};

let cachedEvents: FplEvent[] | null = null;

async function fetchFplEvents(): Promise<FplEvent[]> {
  if (cachedEvents) return cachedEvents;

  // Goes through your Vite proxy: /fpl/api/bootstrap-static/
  const res = await fetch("/fpl/api/bootstrap-static/");
  if (!res.ok) throw new Error(`Failed to fetch FPL events: ${res.status}`);
  const data = await res.json();
  cachedEvents = data.events as FplEvent[];
  return cachedEvents;
}

/**
 * Given a league with fpl_start_event and an LMS round number,
 * returns the FPL deadline_time ISO string, or null if we can't map it.
 */
export async function getFplDeadlineForRound(
  league: { fpl_start_event?: number | null },
  roundNumber: number
): Promise<string | null> {
  if (typeof league.fpl_start_event !== "number") return null;

  const gw = league.fpl_start_event + (roundNumber - 1); // R1 → fpl_start_event
  const events = await fetchFplEvents();
  const ev = events.find((e) => e.id === gw);
  return ev?.deadline_time ?? null;
}

/**
 * Utility to decide lock based on an ISO deadline.
 */
export function isPastDeadline(iso?: string | null): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return Date.now() >= ts;
}
