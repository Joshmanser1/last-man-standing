import { renderServiceEmail } from "./templates.js";
import type { DeliveryClaim, ServiceEmailCandidate, ServiceEmailSummary } from "./types.js";
import type { ServiceEmailTransport } from "./resendTransport.js";

export type CandidateDiscovery = { candidates: ServiceEmailCandidate[]; zeroSurvivorRoundsSkipped: number; ambiguousMissedPickResultsSkipped: number };
export type ServiceEmailRepository = {
  discover(now: Date): Promise<CandidateDiscovery>;
  resolveAuthEmail(playerId: string): Promise<string | null>;
  claim(candidate: ServiceEmailCandidate): Promise<DeliveryClaim | null>;
  recheck(candidate: ServiceEmailCandidate, now: Date): Promise<boolean>;
  complete(claim: DeliveryClaim, providerMessageId: string): Promise<void>;
  fail(claim: DeliveryClaim, error: string): Promise<void>;
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
}): Promise<ServiceEmailSummary> {
  const summary: ServiceEmailSummary = {
    disabled: !input.enabled, remindersSent: 0, resultsSent: 0, skipped: 0, failed: 0,
    zeroSurvivorRoundsSkipped: 0, missingAuthEmail: 0, pilotBlocked: 0, ineligibleAfterClaim: 0,
    ambiguousMissedPickResultsSkipped: 0,
  };
  if (!input.enabled) return summary;
  const allowlist = parsePilotAllowlist(input.pilotAllowlist);
  const discovery = await input.repository.discover(input.now);
  summary.zeroSurvivorRoundsSkipped = discovery.zeroSurvivorRoundsSkipped;
  summary.ambiguousMissedPickResultsSkipped = discovery.ambiguousMissedPickResultsSkipped;

  for (const candidate of discovery.candidates) {
    let email: string | null;
    try { email = await input.repository.resolveAuthEmail(candidate.playerId); }
    catch { summary.failed++; continue; }
    if (!email) { summary.skipped++; summary.missingAuthEmail++; continue; }
    email = canonicalEmail(email);
    if (allowlist.size > 0 && !allowlist.has(email)) {
      summary.skipped++; summary.pilotBlocked++; continue;
    }

    let claim: DeliveryClaim | null = null;
    try {
      claim = await input.repository.claim(candidate);
      if (!claim) { summary.skipped++; continue; }
      if (!(await input.repository.recheck(candidate, input.now))) {
        await input.repository.release(claim);
        summary.skipped++; summary.ineligibleAfterClaim++;
        continue;
      }
      const rendered = renderServiceEmail(candidate, input.appOrigin);
      const sent = await input.transport.send({ to: email, ...rendered, idempotencyKey: deliveryKey(candidate) });
      await input.repository.complete(claim, sent.id);
      if (candidate.eventType === "pick_reminder") summary.remindersSent++;
      else summary.resultsSent++;
    } catch (error) {
      summary.failed++;
      if (claim) {
        try { await input.repository.fail(claim, error instanceof Error ? error.message : String(error)); }
        catch { /* A stale processing claim can be reclaimed; the provider key remains idempotent. */ }
      }
    }
  }
  return summary;
}
