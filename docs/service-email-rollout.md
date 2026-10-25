# Safe service-email activation

No production configuration has been changed by this implementation.

## Fixed configuration

Proposed first activation boundary (UTC):

    SERVICE_EMAIL_RESULTS_START_AT=2026-10-25T00:00:00Z

This is a proposal, not an automatic default or a configured production value.
Confirm it against the actual activation date before the first broad rollout.
If activation is delayed, inspect the preview before choosing the initial value:
rounds since an old proposed cutoff could otherwise already be historical.
After activation, keep the chosen value fixed across subsequent deployments.
Only explicit UTC ISO instants with seconds and optional three-digit milliseconds
are accepted. Missing, invalid or impossible dates suppress result emails only.

The boundary compares the **round pick deadline**, inclusively, during discovery
and the pre-send snapshot recheck. Results for rounds with earlier deadlines stay
suppressed even if they are finalised or reconciled later. This intentionally skips
results for rounds already past their deadline at initial activation. Upcoming
pick reminders retain their existing 20–28-hour window and recipient checks.
No delivery ledger entries are created to pretend historical emails were sent.

The separately approved four-round weekend exception is documented in
`docs/scheduled-tick-reliability.md`. It requires explicit exception configuration,
keeps this fixed cutoff for every other round, and must remain inactive until the
finalised recipient counts have been reviewed. POF123 is excluded.

## Recipient presentation and promotion

Survivors with no next-round pick get a league-specific pick link. Survivors who
already picked still get the result, confirmation that their next pick exists,
and a league-specific competition link. The pre-send snapshot refreshes this
presentation; a pick made after that read can still race the actual email send.

Telegram appears only in the existing reminder/pick-prompt placements when a
fresh authoritative `marketing_preferences` lookup permits promotional email to
the same verified Auth email. Missing, withdrawn, changed-email or unavailable
preferences omit promotion without blocking service email. Legacy profile opt-in
is not consulted. Promotional variants link to existing email preferences.
No future-competition promotional email or new subscription is introduced.

## Read-only preview

Run `sql/2026-10-24-service-email-rollout-preview.sql` in the production SQL Editor.
Set its timestamp to the intended fixed value. This SELECT-only query mirrors
result recipient rules, verified-email eligibility and current claimability,
before the pilot restriction, across all non-deleted, non-test leagues (including
private leagues). Test leagues are excluded during discovery and pre-send recheck,
regardless of recipient or pilot settings. It does not call the tick, claim a
delivery or send email.

`BLOCKED_HISTORICAL` rows must never reach delivery after the safeguard.
`POST_CUTOFF` rows show potential eligible results, not promises of delivery;
concurrent state changes, provider failures and the pre-send recheck still apply.
Review every represented league, not only the four main competitions. An empty
result does not verify watchdog health or provider delivery. Counts are a snapshot.

## Deployment sequence — owner action after review

1. Keep `SERVICE_EMAILS_ENABLED=true` and the current owner-only pilot allowlist.
2. Review the SELECT-only preview and agree the initial fixed UTC boundary.
3. Configure `SERVICE_EMAIL_RESULTS_START_AT` in Vercel Production and deploy only
   the reviewed email safeguard changes, keeping the pilot restriction intact.
   Do not accidentally include unrelated working-tree changes. Missing cutoff
   safely blocks results; it does not disable reminders.
4. Confirm the deployed source/configuration, scheduler target and existing ledger
   and provider records. Do not manually trigger a catch-up run. Retain ledger rows.
5. STOP after the restricted deployment until broad activation is separately
   approved and the deployed cutoff is verified. The current stage-one approval
   does not authorise changing the pilot allowlist.
6. Only after that separate approval, remove the Production `SERVICE_EMAIL_PILOT_ALLOWLIST` value (or set its effective
   value empty) and redeploy the same reviewed source. Ensure no inherited/team
   value still restricts recipients. Vercel environment changes require a new
   deployment; keep the same cutoff. Do not broaden the old unguarded deployment.
7. Let the ordinary watchdog execute. Reconcile ledger `sent` records/provider IDs
   with Resend acceptance and delivery events. Check reminders only go to active,
   unpicked members. A successful game tick alone does not establish email success.

For rollback, restore the owner allowlist or disable service emails and redeploy
the guarded source; environment changes do not stop an already running invocation.
Do not roll back to unguarded source with unrestricted recipients. Do not reset the
cutoff, delete ledger rows or invoke a manual historical replay.
