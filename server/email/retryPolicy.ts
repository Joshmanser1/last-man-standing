export class ResendDeliveryError extends Error {
  readonly provider = "resend";
  constructor(message: string, readonly status: number | null, readonly code: string,
    readonly retryAfter: string | null = null) {
    super(message);
    this.name = "ResendDeliveryError";
  }
}

export type DeliveryFailure = {
  status: number | null;
  code: string;
  retryAfter: string | null;
  kind: "capacity" | "transient" | "permanent" | "accepted";
  nextAttemptAt: string | null;
  providerMessageId?: string;
};

export function deliveryFailure(error: unknown, attempt: number, now: Date): DeliveryFailure {
  const provider = error as Partial<ResendDeliveryError> | null;
  const status = provider?.provider === "resend" ? provider.status ?? null : null;
  const code = provider?.provider === "resend" ? provider.code ?? "unknown" : "application_error";
  const retryAfter = provider?.provider === "resend" ? provider.retryAfter ?? null : null;
  const capacity = status === 429 || ["daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded"].includes(code);
  const temporary = status === 408 || code === "concurrent_idempotent_requests" || code === "resource_locked";
  const kind = capacity ? "capacity" : !temporary && status !== null && status >= 400 && status < 500
    ? "permanent" : "transient";
  let delay = Math.min(15 * 60_000 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60_000);
  if (capacity) {
    delay = code === "daily_quota_exceeded" || code === "monthly_quota_exceeded"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()
      : 60_000;
  }
  const retryAt = retryAfter === null ? NaN : /^\d+(\.\d+)?$/.test(retryAfter.trim())
    ? now.getTime() + Number(retryAfter) * 1000 : Date.parse(retryAfter);
  return { status, code, retryAfter, kind,
    nextAttemptAt: kind === "permanent" ? null : new Date(Math.max(now.getTime() + delay, Number.isFinite(retryAt) ? retryAt : 0)).toISOString() };
}

export function reminderInWindow(deadlineUtc: string, now: Date) {
  const remaining = Date.parse(deadlineUtc) - now.getTime();
  return remaining >= 20 * 60 * 60_000 && remaining <= 28 * 60 * 60_000;
}
