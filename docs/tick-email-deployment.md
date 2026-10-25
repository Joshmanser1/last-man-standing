# Tick/email deployment with current-weekend delivery held

Do not set `SERVICE_EMAIL_RESULTS_EXCEPTION_ROUND_IDS`, change the fixed
`SERVICE_EMAIL_RESULTS_START_AT=2026-10-25T00:00:00Z`, manually invoke tick/email
endpoints, relax `finished === true`, or force finalisation. The four approved
rounds have 23 October deadlines and remain excluded with exception configuration
absent/empty, including if the ordinary scheduler finalises them after deployment.
Existing reminder processing remains as configured; this is a hold on the new
current-weekend result activation, not a global email kill switch.

## Pre-commit checks

Vercel must build this repository root, with `vercel.json` and `api/tick.ts`
relative to its configured Root Directory. The default-export Node.js handler in
`api/tick.ts` is the `/api/tick` function; the exact `functions["api/tick.ts"]`
entry sets its `maxDuration` to 300. There is no legacy `builds` override or second
duration setting in this source. The separate `netlify/functions/tick.ts` is not
the Vercel handler and is excluded from this change.

Confirm the Vercel project's Root Directory, production branch and Production
environment before committing/pushing. The git command below only targets the
current branch's same-name remote branch; use it only if that is the confirmed
Vercel production branch. Confirm no inherited exception variable enables the
four rounds. Check deployed `/api/tick` function metadata/build output reports
300 seconds after deployment; the local Vite build alone cannot establish that.

Production configuration review confirmed Root Directory `./` (repository root),
Fluid Compute enabled and pg_net 0.19.5. This confirms that the exact
`functions["api/tick.ts"].maxDuration = 300` source setting targets the production
function's entrypoint. The apparent Hobby plan supports that duration with Fluid
Compute. The current local branch is `main`; check the Vercel production-branch
mapping before using the push command. Keep the exception variable unset.

Run `sql/2026-10-25-fcc-tick-deployment-checks.sql` in the production SQL Editor
and retain the output. It is SELECT-only inside a read-only transaction and does
not expose secret values or invoke the watchdog. Confirm:

- pg_net 0.19.5, whose tagged implementation supports 310000 ms without the newer
  max-timeout GUC. No extension upgrade or GUC change is needed for that version.
- Exactly one active `fcc-global-lms-tick` job on `*/15 * * * *`.
- Both expected Vault secret names exist once each; preserve their IDs.
- Existing watchdog function exists, security_definer is true, search_path is
  empty, the two Vault-name flags are true, and timeout is currently 10000.
- anon/authenticated cannot execute it; save OID, owner and exact proacl.

The migration requires an existing watchdog and uses CREATE OR REPLACE without
GRANT/REVOKE, preserving its owner, OID and ACL. It never changes cron or Vault.
Compare production pre/post output rather than assuming the original install SQL
is still the live definition. If live metadata differs, stop before applying it.

## Exact PowerShell git commands

These are instructions, not commands already executed by the agent. No commit,
staging or push is performed during preparation. Run from this workspace after
the pre-commit production checks have passed:

```powershell
Set-Location -LiteralPath 'C:\Users\angel\last-man-standing'
git status --short
if (@(git diff --cached --name-only).Count -ne 0) {
    throw 'Existing staged changes need review before staging this deployment.'
}

$tickEmailFiles = @(
    'api/tick.ts'
    'vercel.json'
    'server/email/eligibility.ts'
    'server/email/supabaseServiceEmailRepository.ts'
    'server/email/types.ts'
    'server/email/templates.ts'
    'server/email/serviceEmailProcessor.ts'
    'scripts/test-service-emails.mjs'
    'scripts/preview-weekend-service-emails.mjs'
    'sql/2026-10-25-fcc-tick-http-timeout.sql'
    'sql/2026-10-25-fcc-tick-deployment-checks.sql'
    'sql/2026-10-25-weekend-result-email-preview.sql'
    'docs/service-email-rollout.md'
    'docs/scheduled-tick-reliability.md'
    'docs/tick-email-deployment.md'
)
git add -- $tickEmailFiles
if ($LASTEXITCODE -ne 0) { throw 'Staging failed.' }
$tickEmailStaged = @(git diff --cached --name-only)
if (@(Compare-Object ($tickEmailFiles | Sort-Object) ($tickEmailStaged | Sort-Object)).Count -ne 0) {
    throw 'The staged paths do not match the deployment allowlist.'
}
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged diff checks failed.' }
git diff --cached --stat
git diff --cached
```

After reviewing that exact staged diff:

```powershell
git commit -m "Fix scheduled tick reliability and prepare guarded weekend result emails"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed.' }
git show --stat --oneline HEAD
git status --short
```

After the SQL timeout change below and confirmation of the production branch:

```powershell
$tickEmailBranch = git branch --show-current
if ([string]::IsNullOrWhiteSpace($tickEmailBranch)) { throw 'Detached HEAD; do not push.' }
git push origin "HEAD:refs/heads/$tickEmailBranch"
if ($LASTEXITCODE -ne 0) { throw 'Push failed.' }
```

Excluded and left untouched: pre-existing `tsconfig.tsbuildinfo`,
`scripts/send-mark-survey.mjs`, `scripts/send-mark-telegram-update.mjs`,
`sql/2026-10-18-fcc-paid-x-tracking.sql`, all environment files and all other paths.
Never substitute `git add .` or `git commit -a` for the allowlist.

## Supabase SQL and deployment order

1. Run `sql/2026-10-25-fcc-tick-deployment-checks.sql`; retain pre-change metadata.
2. Confirm Vercel root/branch, Fluid Compute, and the absent/empty exception value.
   Review/stage/commit only the allowlisted files using the commands above.
3. Run `sql/2026-10-25-fcc-tick-http-timeout.sql` once in the production SQL Editor.
   It changes the HTTP timeout to 310000. Do not rerun the original scheduler
   installation migration, which recreates the cron job and sets 10000 again.
4. Rerun `sql/2026-10-25-fcc-tick-deployment-checks.sql`. Timeout must be 310000;
   function OID/owner/ACL, job ID/schedule/active/username/command hash, Vault IDs,
   security_definer/search_path and Vault-name flags must match the baseline.
5. Push the reviewed commit to the confirmed production branch and wait for its
   Vercel deployment. Keep the four-round exception value absent/empty. Verify the
   `/api/tick` function's actual maximum duration is 300 in deployment metadata.
6. Let the ordinary scheduler run. Use the checks SQL and Vercel logs to inspect
   the scheduled request's HTTP acknowledgement and stage timings. The net response
   list may contain other jobs, so correlate timestamps with this cron/tick. No
   manual tick or delivery request is required.
7. Wait for genuine FPL `finished=true` results and ordinary lifecycle finalisation.
   Run `sql/2026-10-25-weekend-result-email-preview.sql` (read-only), review exact
   claimable recipients/outcomes/consent/CTAs, and STOP for separate activation
   approval. Do not set the exception variable as part of this deployment.

The timeout SQL is independent of the new deployment; source deployment need not
precede it. No ledger schema, claims, provider keys, historical cutoff, fixture
policy, scoring, registration wording or original terms are changed.
