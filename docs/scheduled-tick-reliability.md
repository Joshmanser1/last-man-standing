# Scheduled tick reliability and weekend results

Implementation is local only. The reliability/template source can be deployed
with current-weekend activation held: keep the fixed 25 October cutoff and leave
`SERVICE_EMAIL_RESULTS_EXCEPTION_ROUND_IDS` absent/empty. Do not configure the
exceptions or invoke a delivery endpoint before finalised recipient review and
delivery approval. Ordinary cron execution can send emails after exception
configuration is deployed; avoiding a manual trigger is not a delivery hold.

## Timeout correction

`vercel.json` explicitly gives `api/tick.ts` 300 seconds, the Hobby Fluid Compute
maximum. `sql/2026-10-25-fcc-tick-http-timeout.sql` requires and replaces only the
existing watchdog function, preserving Vault authentication and leaving its cron
job alone. CREATE OR REPLACE preserves the existing function owner and ACL; the
migration performs no GRANT, REVOKE, cron or Vault mutation.
It sets the HTTP timeout to 310000 milliseconds so Supabase can observe the
function's response, including a Vercel timeout response. Before applying it,
inspect the installed pg_net version and any configured maximum request timeout.
Keep the 15-minute schedule. Apply this migration instead of rerunning the
original scheduler installation script.

Production reports pg_net 0.19.5. Its tagged SQL accepts an integer timeout and
queues it unchanged; its C worker passes that value directly to libcurl's
CURLOPT_TIMEOUT_MS. That version does not implement pg_net.max_timeout_ms, so the
reported NULL is consistent with the source. The 310000 value is supported by
that implementation; this conclusion does not rely on a newer version's 600000
default. Sources: https://github.com/supabase/pg_net/blob/v0.19.5/sql/pg_net.sql
and https://github.com/supabase/pg_net/blob/v0.19.5/src/core.c.

Lifecycle success continues to be recorded before emails. The response now
includes `service_email_status`; a 200 acknowledgement alone does not prove email
success. Runtime logs record lifecycle completion and email-stage start/completion,
duration, status and summary. Earlier intermittent 500s remain unexplained without
their response bodies and correlated runtime logs.

## Exact cutoff exceptions

Keep `SERVICE_EMAIL_RESULTS_START_AT=2026-10-25T00:00:00Z` fixed.
After recipient review, configure Vercel Production with:

```text
SERVICE_EMAIL_RESULTS_EXCEPTION_ROUND_IDS=12bcb92e-4649-4006-9d14-489a8bf4eb10,a21ee081-fe55-410a-b6f3-60b3fb234eef,e9ee31fd-0135-454f-b86d-d12e59fd145f,64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb
```

| Competition | Round | Approved ID |
| --- | --- | --- |
| MARKPL | 5 | `12bcb92e-4649-4006-9d14-489a8bf4eb10` |
| FORTY4 | 2 | `a21ee081-fe55-410a-b6f3-60b3fb234eef` |
| OOCFM1 | 3 | `e9ee31fd-0135-454f-b86d-d12e59fd145f` |
| FCCLMS | 1 | `64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb` |

POF123 round `ef648874-e568-4b9c-8550-0fdb4fef8252` is excluded. Unknown IDs
in configuration are ignored; only these four source-approved IDs can bypass the
cutoff. Missing/invalid cutoff blocks every result, including exceptions. Missing
exception configuration preserves the existing cutoff for every round.

Discovery and the pre-send recheck require the same scope. Normal results still
need completed status, a finalisation timestamp, survivors and the existing
recipient eligibility. MARKPL has the narrowly scoped ending variant below.
No outcomes or round state are changed. Atomic delivery claims, attempt limits,
provider idempotency and sent records remain intact. Telegram promotion in the
other three competitions retains its existing template placements and requires a
fresh authoritative marketing-consent lookup for the verified Auth email.
Reminder eligibility and the other competitions' result copy are unchanged.

## MARKPL competition-ending variant

Only the exact MARKPL league `b457c805-f460-497c-8ed5-a7864d61f822` and its
approved Round 5 can produce `mark_rollover` presentation. Round 5 must be
completed and finalised, have at least one persisted pick, zero survivors, and
only resolved loss/draw/no-pick eliminations. Pending or ambiguous terminal picks
block the variant. No database finalisation or enrolment is performed by email code.

The audience is original-league memberships joined by the Round 5 deadline,
including inactive members eliminated earlier. Each recipient needs a single
persisted elimination outcome in a completed round. The earliest such round is
used, with its actual team and loss/draw/no-pick reason. Completed legacy Round 1
outcomes remain usable even though their finalisation timestamp is absent;
the terminal Round 5 timestamp is always required. Unknown/duplicate source
outcomes are skipped, not inferred. The pre-send recheck also checks the variant
and elimination round, so a changed outcome cannot silently reuse stale content.

Every recipient gets their individual elimination, 91 entrants/five rounds,
no winner of the £50 prize, the prize rollover, and the factual explanation that
Mark FPL v2 starts GW9 on 31 October and original entries do not transfer.
Valid authoritative marketing consent adds `JOIN MARK FPL v2` linking to
`https://lms.fantasycommandcentre.co.uk/j/mark-fpl-rollover`, plus email-preference
management. Without consent, the only primary CTA is original competition results;
the join URL and invitation are omitted. Telegram is always omitted in this variant.

The event remains `round_result`, keyed to the original Round 5 for every recipient,
with their accurate individual outcome. No new ledger event, key, claim RPC or
schema migration is introduced. A previously sent Round 5 result is not resent.

## Read-only recipient review

Run `node scripts/preview-weekend-service-emails.mjs`. It reads Supabase credentials
from the environment or `.env.local`. Its database client refuses non-GET requests,
foreign origins, redirects and RPCs. It imports no transport, calls no tick or
delivery processor, and never claims or sends an email.

The preview uses the proposed four exceptions and fixed cutoff without changing
production configuration. Output identifies each round's finalisation state,
expected `round_result` email type, verified eligible and currently claimable
recipient counts by outcome, already-sent counts, missing verified emails and
marketing-consent counts. Presentation groups include template, actual elimination
round, consent, exact primary CTA destination and whether Telegram is included.
Counts are before any pilot allowlist. A locked or
unfinalised round has no sendable results; rerun after normal lifecycle finalisation
and review those counts before enabling exceptions. Do not infer future recipients
or outcomes from pending picks. The preview is a snapshot, not a reservation;
production rechecks and claims still decide delivery.

The exact SQL Editor counterpart is
`sql/2026-10-25-weekend-result-email-preview.sql`. Run the entire file: it opens a
read-only transaction, returns four-round finalisation/survivor checks, then a
per-recipient preview with count columns, outcome, source round/timestamp, verified
email, authoritative consent, delivery claimability, template and CTA destination.
It rolls back at the end and invokes no RPC, tick, provider or delivery function.
It models the proposed four exceptions and fixed valid cutoff before any pilot
allowlist. Empty recipient output while rounds are locked is expected. POF123 and
all other historical rounds are outside its scope. Rows already sent remain visible
but have `claimable = false`; only claimable rows represent potential new sends.

Before applying the timeout SQL, inspect the installed extension and schedule with
these read-only statements in production:

```sql
select extversion from pg_extension where extname = 'pg_net';
select current_setting('pg_net.max_timeout_ms', true) as configured_max_timeout_ms;
select jobid, jobname, schedule, active
from cron.job where jobname = 'fcc-global-lms-tick';
```

A null maximum setting can mean that extension version does not expose that GUC;
check its installed-version timeout support rather than assuming a limit. No cron
job recreation is required. The HTTP timeout change can be applied independently
of deployment; it does not enable an email exception. Email/template changes and
`SERVICE_EMAIL_RESULTS_EXCEPTION_ROUND_IDS` require a new Vercel deployment.
No other new environment variable or results-ledger SQL migration is required.

For the held deployment, use `docs/tick-email-deployment.md`. After a later
recipient review and explicit delivery approval, deploy the four-ID exception
configuration and observe ordinary cron runs. Confirm `service_email_status`,
stage-completion logs and wall-clock duration.
Reconcile ledger provider IDs with Resend acceptance and delivery events. A full
email batch must fit the 300-second function budget; if it does not, investigate
bounded/resumable processing rather than increasing beyond the Hobby limit.

For rollback, remove exception configuration and redeploy; leave the fixed cutoff
and delivery ledger intact. Configuration changes do not stop an invocation that
is already running. No historical replay or ledger deletion is needed.

## Validation and changed files

`npm.cmd run test:service-emails` covers 91 synthetic original participants, all
individual outcome variants, seven consenting invite recipients, no-consent and
unavailable-consent suppression, exact delivery keys, repeat sends, pending/locked/
unfinalised gates, legacy completed outcomes, exact UUID scope and POF123 exclusion.
It executes the timeout migration and the full read-only preview SQL against
disposable PostgreSQL, comparing SQL/application outcomes and testing sent records
and changed-email consent. No live batch delivery is used as a test.

Implementation files: `api/tick.ts`, `vercel.json`,
`server/email/eligibility.ts`, `server/email/supabaseServiceEmailRepository.ts`,
`server/email/types.ts`, `server/email/templates.ts`,
`server/email/serviceEmailProcessor.ts`.

Review/validation files: `scripts/test-service-emails.mjs`,
`scripts/preview-weekend-service-emails.mjs`,
`sql/2026-10-25-fcc-tick-http-timeout.sql`,
`sql/2026-10-25-weekend-result-email-preview.sql`,
`sql/2026-10-25-fcc-tick-deployment-checks.sql`,
`docs/service-email-rollout.md`, `docs/tick-email-deployment.md`, and this document.
