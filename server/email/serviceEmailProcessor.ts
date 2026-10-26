import { renderServiceEmail } from "./templates.js";
import type { DeliveryClaim, ServiceEmailCandidate, ServiceEmailSummary } from "./types.js";
import type { ServiceEmailTransport } from "./resendTransport.js";
import { deliveryFailure, reminderInWindow, type DeliveryFailure } from "./retryPolicy.js";

export type CandidateDiscovery = { candidates: ServiceEmailCandidate[]; zeroSurvivorRoundsSkipped: number; ambiguousMissedPickResultsSkipped: number };
export type ServiceEmailRepository = {
  prepareRetries(): Promise<{ blockedUntil: string | null; expired: number }>;
  discover(now: Date): Promise<CandidateDiscovery>;
  resolveAuthEmail(playerId: string): Promise<string | null>;
  allowsMarketing(playerId: string, verifiedEmail: string): Promise<boolean>;
  claim(candidate: ServiceEmailCandidate): Promise<DeliveryClaim | null>;
  recheck(candidate: ServiceEmailCandidate, now: Date): Promise<boolean>;
  complete(claim: DeliveryClaim, providerMessageId: string): Promise<void>;
  fail(claim: DeliveryClaim, error: string, failure: DeliveryFailure): Promise<void>;
  release(claim: DeliveryClaim): Promise<void>;
};

const canonicalEmail = (value: string) => value.trim().toLowerCase();
export function parsePilotAllowlist(value?: string) {
  return new Set((value ?? "").split(",").map(canonicalEmail).filter(Boolean));
}

const deliveryKey = (candidate: ServiceEmailCandidate) =>
  `fcc-${candidate.eventType}-${candidate.leagueId}-${candidate.roundId}-${candidate.playerId}`;

export async function processServiceEmails(input: {
  enabled: boolean; appOrigin: string; pilotAllowlist?: string; now: Date;
  repository: ServiceEmailRepository; transport: ServiceEmailTransport;
  clock?: () => Date;
}): Promise<ServiceEmailSummary> {
  const summary: ServiceEmailSummary = {
    disabled: !input.enabled, remindersSent: 0, resultsSent: 0, skipped: 0, failed: 0,
    zeroSurvivorRoundsSkipped: 0, missingAuthEmail: 0, pilotBlocked: 0, ineligibleAfterClaim: 0,
    ambiguousMissedPickResultsSkipped: 0,
  };
  if (!input.enabled) return summary;
  const currentTime = input.clock ?? (() => new Date());
  const retryState = await input.repository.prepareRetries();
  summary.expiredReminders = retryState.expired;
  if (retryState.blockedUntil && Date.parse(retryState.blockedUntil) > currentTime().getTime()) {
    summary.providerBlockedUntil = retryState.blockedUntil;
    return summary;
  }
  const allowlist = parsePilotAllowlist(input.pilotAllowlist);
  const discovery = await input.repository.discover(input.now);
  summary.zeroSurvivorRoundsSkipped = discovery.zeroSurvivorRoundsSkipped;
  summary.ambiguousMissedPickResultsSkipped = discovery.ambiguousMissedPickResultsSkipped;

  for (const candidate of discovery.candidates) {
    let email: string | null;
    try { email = await input.repository.resolveAuthEmail(candidate.playerId); }
    catch { summary.failed++; continue; }
    if (!email) { summary.skipped++; summary.missingAuthEmail++; continue; }
    const verifiedEmail = email;
    email = canonicalEmail(email);
    if (allowlist.size > 0 && !allowlist.has(email)) {
      summary.skipped++; summary.pilotBlocked++; continue;
    }

    let claim: DeliveryClaim | null = null;
    let providerMessageId: string | undefined;
    try {
      claim = await input.repository.claim(candidate);
      if (!claim) { summary.skipped++; continue; }
      if (!(await input.repository.recheck(candidate, currentTime()))) {
        if (candidate.eventType === "pick_reminder" && Date.parse(candidate.deadlineUtc) < currentTime().getTime() + 20 * 60 * 60_000) {
          await input.repository.fail(claim, "Pick reminder window expired", {
            status: null, code: "reminder_expired", retryAfter: null, kind: "permanent", nextAttemptAt: null,
          });
          summary.expiredReminders++;
        } else await input.repository.release(claim);
        summary.skipped++; summary.ineligibleAfterClaim++;
        continue;
      }
      // Promotional content is optional; an unavailable preference must never
      // block the essential competition notification or imply consent.
      let includeTelegram = false;
      try { includeTelegram = await input.repository.allowsMarketing(candidate.playerId, verifiedEmail); }
      catch { /* Fail closed for promotion only. */ }
      const rendered = renderServiceEmail(candidate, input.appOrigin, {
        includeTelegram, includeRolloverInvitation: includeTelegram,
      });
      if (candidate.eventType === "pick_reminder" && !reminderInWindow(candidate.deadlineUtc, currentTime())) {
        await input.repository.fail(claim, "Pick reminder window expired", {
          status: null, code: "reminder_expired", retryAfter: null, kind: "permanent", nextAttemptAt: null,
        });
        summary.expiredReminders++;
        continue;
      }
      const sent = await input.transport.send({ to: email, ...rendered, idempotencyKey: deliveryKey(candidate) });
      providerMessageId = sent.id;
      await input.repository.complete(claim, sent.id);
      if (candidate.eventType === "pick_reminder") summary.remindersSent++;
      else summary.resultsSent++;
    } catch (error) {
      summary.failed++;
      const failure = providerMessageId ? { ...deliveryFailure(error, claim?.attemptCount ?? 1, currentTime()),
        kind: "accepted" as const, nextAttemptAt: null, providerMessageId } :
        deliveryFailure(error, claim?.attemptCount ?? 1, currentTime());
      if (claim) {
        try { await input.repository.fail(claim, error instanceof Error ? error.message : String(error), failure); }
        catch { /* A stale processing claim can be reclaimed; the provider key remains idempotent. */ }
      }
      if (failure.kind === "capacity") {
        summary.deferred = (summary.deferred ?? 0) + 1;
        summary.providerBlockedUntil = failure.nextAttemptAt ?? undefined;
        break;
      }
    }
  }
  return summary;
}
