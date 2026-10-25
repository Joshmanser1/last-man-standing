export type ServiceEmailEvent = "pick_reminder" | "round_result";
export type ServiceEmailOutcome =
  | "through"
  | "eliminated_loss"
  | "eliminated_draw"
  | "eliminated_no_pick";

export type ServiceEmailCandidate = {
  leagueId: string;
  leagueName: string;
  roundId: string;
  roundNumber: number;
  playerId: string;
  eventType: ServiceEmailEvent;
  outcome: ServiceEmailOutcome | null;
  deadlineUtc: string;
  teamName: string | null;
  survivorsRemaining: number | null;
  resultVariant?: "mark_rollover";
  eliminationRoundNumber?: number;
  nextRound?: { roundNumber: number; deadlineUtc: string; alreadyPicked?: boolean } | null;
};

export const markRolloverLeagueId = "b457c805-f460-497c-8ed5-a7864d61f822";
export const markRolloverRoundId = "12bcb92e-4649-4006-9d14-489a8bf4eb10";
export const markRolloverJoinUrl = "https://lms.fantasycommandcentre.co.uk/j/mark-fpl-rollover";

export type DeliveryClaim = { id: string; claimToken: string; attemptCount: number };
export type OutboundEmail = { to: string; subject: string; html: string; text: string; idempotencyKey: string };

export type ServiceEmailSummary = {
  disabled: boolean;
  remindersSent: number;
  resultsSent: number;
  skipped: number;
  failed: number;
  zeroSurvivorRoundsSkipped: number;
  missingAuthEmail: number;
  pilotBlocked: number;
  ineligibleAfterClaim: number;
  ambiguousMissedPickResultsSkipped: number;
};
