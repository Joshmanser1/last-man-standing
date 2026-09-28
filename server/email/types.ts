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
};

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
