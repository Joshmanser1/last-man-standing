# Service-email retry correction

## Scope and policy

This change concerns Resend service emails only. Postmark/Supabase authentication,
game lifecycle, result templates, MARKPL rollover, consent and Telegram rules are
unchanged. Existing sent deliveries cannot be reclaimed. No email is sent by the
migration or by the local tests.

A database migration is necessary: invocations do not share memory, and atomic
claims must enforce durable retry times. Apply
`sql/2026-10-26-service-email-retries.sql` **before deploying the new code**.
It adds scheduling, structured error metadata, terminal/expiry markers and an
RLS-protected Resend cooldown row. Only service-role security-definer RPCs may
mutate these records. Existing delivery keys and sent/provider IDs are unchanged.

- Delivery status remains `failed` while deferred; `retryable=true` and
  `next_attempt_at` distinguish scheduled retries from terminal failures.
- HTTP status, provider error name, raw Retry-After and classification are retained
  in `last_provider_error`; the message remains in `last_error`.
- Capacity rejections refund the claim's attempt increment. They never consume
  the five ordinary-failure attempts. They stop the current batch and persist an
  account-wide cooldown, checked both before discovery and inside atomic claims.
  Requests already in flight in another invocation cannot be cancelled.
- Daily quota exhaustion waits until midnight UTC, or longer if Retry-After says
  so. Monthly exhaustion probes once per UTC day (or later per Retry-After), not
  every scheduled tick. This deliberately does not assume a billing renewal date.
  A scheduled tick resumes eligible messages once the provider accepts them.
- Rate limits/unknown 429s defer at least one minute, respecting a longer numeric
  or HTTP-date Retry-After. Actual retry timing follows the existing tick cadence.
- Transient errors use 15, 30, 60, 120 and 240 minute backoff, with the existing
  five-attempt ceiling. Ordinary permanent 4xx errors are terminal; 408 and
  concurrent-idempotency/resource-lock conflicts are transient.
- Retries resolve the verified address and authoritative consent again, and
  recheck current eligibility. Pick reminders require the existing 20–28-hour
  window in discovery, atomic claims and pre-send checks. Deferred reminders
  outside that window, or for closed/finalised rounds, are marked `expired_at`,
  `retryable=false`, code `reminder_expired`; no late catch-up reminders are sent.
- Resend only retains idempotency keys for 24 hours. Ambiguous failures or stale
  claims are not automatically retried beyond a conservative 23-hour window.
  If the provider returns an ID but recording completion fails, the ID is retained
  in a non-retryable failure for reconciliation, not another send. A changed body
  rejected under the same idempotency key is also terminal; keys are never rotated.
  Eligibility changes preserve uncertain delivery history rather than deleting it.
  Terminal, exhausted and uncertain records require operator review, not a reset.

The installed SDK can drop the raw HTTP status on JSON error responses, so the
transport posts the same email fields and idempotency header directly to Resend's
send endpoint. There are no hidden HTTP retries. No dependency changes are needed.

Provider references: [error codes and daily reset](https://resend.com/docs/api-reference/errors),
[24-hour idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Safe rollout (requires separate production approval)

1. Run `npm.cmd run test:service-emails`, `npm.cmd run test:marketing`,
   `node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module ESNext --moduleResolution bundler --skipLibCheck --strict --types node api/tick.ts`
   and `npm.cmd run build`. Tests use synthetic providers and disposable PostgreSQL.
2. Capture read-only delivery counts, in particular the 161 approved rollout sent
   records. Confirm no outstanding processing/failed deliveries before proceeding;
   investigate any new ones rather than resetting them.
3. For a controlled rollout, hold **service emails only** with the existing
   `SERVICE_EMAILS_ENABLED=false` deployment switch, leaving cron/game lifecycle
   enabled. Wait for prior invocations to finish. Do not change cutoffs, exceptions,
   credentials, Resend settings or Postmark authentication.
4. Execute the new migration once in Supabase SQL Editor. Do not rerun the original
   ledger migration. The transaction changes schema/RPCs only; it does not update
   sent deliveries, change cron or send emails.
5. Deploy the reviewed code with service emails still held. Confirm successful
   lifecycle ticks, schema/RPC availability and the original sent counts using
   read-only queries. Do not manually invoke an email endpoint as a smoke test.
6. After explicit activation approval, restore the prior service-email enablement
   and let scheduled ticks resume. Do not change exception IDs or reset records.
   Observe structured errors, cooldowns, expiry and retry counts. Quota exhaustion
   still requires allowance renewal or an approved plan change; retries do not
   bypass provider limits.
7. If rollback is needed, hold service emails first; leave the additive schema in
   place. Do not restore the old processor with email sending enabled while quota
   is exhausted. No automatic ledger reset or manual resend is part of rollback.

## Read-only monitoring after migration

```sql
begin transaction read only;

select status, retryable, count(*) as deliveries
from public.service_email_deliveries
group by status, retryable order by status, retryable;

select provider, blocked_until, last_error
from public.service_email_provider_state;

select id, league_id, round_id, player_id, event_type, status, attempt_count,
  retryable, next_attempt_at, expired_at, uncertain_since,
  provider_message_id, last_error, last_provider_error
from public.service_email_deliveries
where status <> 'sent'
order by next_attempt_at nulls last, created_at;

rollback;
```

Legacy recipient preview SQL predates retry scheduling: its `claimable` column
is not sufficient to inspect deferred rows. Use the monitoring query above and
the scheduled processor's guarded claims; do not use a preview to reset or send.
