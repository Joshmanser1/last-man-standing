export function isRoundRevealable(
  round?: { status?: string | null; pick_deadline_utc?: string | null } | null,
  now = Date.now()
) {
  if (!round) return false;
  if (round.status === "locked" || round.status === "completed") return true;
  if (!round.pick_deadline_utc) return true;
  const deadlineAt = Date.parse(round.pick_deadline_utc);
  if (Number.isNaN(deadlineAt)) return true;
  return deadlineAt <= now;
}

export function shouldHidePickForViewer(args: {
  round?: { status?: string | null; pick_deadline_utc?: string | null } | null;
  viewerId?: string | null;
  playerId?: string | null;
  now?: number;
}) {
  const { round, viewerId, playerId, now } = args;
  if (isRoundRevealable(round, now)) return false;
  if (!viewerId || !playerId) return true;
  return String(viewerId) !== String(playerId);
}
