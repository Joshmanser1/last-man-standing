export type DeadlineLevel = "t24h" | "t3h" | "t1h";

export function getDeadlineLevel(deadlineISO: string, nowMs: number): DeadlineLevel | null {
  const deadlineMs = Date.parse(deadlineISO);
  if (Number.isNaN(deadlineMs)) return null;

  const diff = deadlineMs - nowMs;
  if (diff <= 0) return null;

  const oneHour = 60 * 60 * 1000;
  const threeHours = 3 * oneHour;
  const twentyFour = 24 * oneHour;

  if (diff <= oneHour) return "t1h";
  if (diff <= threeHours) return "t3h";
  if (diff <= twentyFour) return "t24h";
  return null;
}

export function formatCountdown(deadlineISO: string, nowMs: number) {
  const deadlineMs = Date.parse(deadlineISO);
  const diff = Math.max(0, deadlineMs - nowMs);
  const mins = Math.floor(diff / 60000);

  const h = Math.floor(mins / 60);
  const m = mins % 60;

  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function deadlineShownKey(
  leagueId: string,
  roundId: string,
  playerId: string,
  level: DeadlineLevel
) {
  return `lms_deadline_shown_v1:${leagueId}:${roundId}:${playerId}:${level}`;
}
