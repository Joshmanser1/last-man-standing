# FCC advertising consent and X Pixel rhi65 release guide

## Current release behaviour

Controller: Josh Manser, operating Fantasy Command Centre personally.
Privacy contact: josh@fantasycommandcentre.co.uk.

## Release files

- `src/lib/xPixel.ts`, `src/env.d.ts`: once-per-document consent-gated Pixel and
  configurable first-pick event, with fail-closed configuration and deduplication.
- `api/submit-pick.ts`, `src/pages/MakePick.tsx`: reporting-only first-pick response
  flag and successful-response hook; no pick-rule/authentication changes.
- `src/components/AdvertisingConsent.tsx`, `src/lib/advertisingConsent.ts`,
  `src/pages/Privacy.tsx`: existing advertising choice, withdrawal and notice work,
  updated to describe successful first-pick measurement.
- `src/lib/umamiTracking.ts`, `src/lib/analytics.ts`, `src/lib/attribution.ts`,
  `index.html`, `src/App.tsx`, `src/pages/PrivateLeagueJoin.tsx`, `vercel.json`:
  preserved consent, analytics gating, public privacy route and narrow X CSP work.
- `e2e/advertising-consent.spec.ts`, `e2e/fcclms-acquisition.spec.ts`,
  `scripts/test-x-first-pick.mjs`, `scripts/test-attribution.mjs`: consent and
  conversion regressions; corrected session-refresh and consent test fixtures.
- This guide: configuration, verification and existing owner/account checks.

The pre-existing send scripts and paid-link SQL are unrelated to this release.
Generated tsconfig.tsbuildinfo and test artifacts are excluded from release work.

The optional tracking purpose includes X advertising measurement, campaign
optimisation and possible retargeting/Custom Audiences, and FCC's Umami visitor
and acquisition analytics. X's terms also describe advertising-model/product
improvement. The panel and notice disclose these uses. The code does not claim
measurement-only restrictions or implement Restricted Data Use.

The localStorage key remains fcc_advertising_consent_v1, but the required notice
version is fcc-advertising-v2. Old x-measurement-v1 receipts cannot load either
tracker. Explicit Accept is required. Missing, rejected, malformed, old-version,
expired or unreadable consent blocks tracking. Repeated acceptance of the same
valid grant preserves its timestamp and event deduplication. Choice validity is
180 days; the receipt is not physically deleted by an automatic timer.

The controls are equally prominent, in normal document flow below the application.
They do not overlay the mobile Join CTA. Privacy settings is available on every
route, including login. Email subscription consent is never used for tracking.

## Processing audit and separation

| Category | Implementation and consent |
| --- | --- |
| Essential invitation/navigation | Existing invite code, current URL/next URL, auth/profile state and 15-minute pending join intent remain unchanged. An opaque return URL can contain UTMs; it is used to finish navigation, not read into advertising records before consent. |
| Aggregate-only site improvement | No independent qualifying aggregate-only pipeline was found. Existing operational hosting/logging is untouched. A future verified aggregate-only pipeline can be assessed independently; it should not be conflated with the current visitor/session tracker. No legitimate-interest assessment or statistical exemption has been invented. |
| Umami visitor/acquisition tracking | The existing Cloud tracker keeps individual page/session/funnel events and campaign data. Its unconditional index.html loader is removed. The same tracker and website ID load only with advertising consent. Existing automatic pageviews continue only after loading; no extra manual pageviews or identify calls are added. |
| Browser campaign attribution | First/join-touch localStorage and invitation-funnel sessionStorage are gated before read/write and associated with the exact current consent timestamp. Older data cannot be revived by later consent. |
| Membership campaign metadata | getAttributionForJoin returns null attribution without valid consent. The existing join API, rules and membership restrictions are unchanged. Existing server-side campaign metadata is not erased by browser withdrawal. |

No pre-consent events are queued. An invitation still visible when consent is
granted can produce its first current-view landing event; previously completed
clicks/auth/actions are never replayed. Only consented custom events can wait in
a bounded memory queue for the SDK; rejection/withdrawal clears that queue.
The existing event names and new-membership/first-pick definitions remain intact.

## One first-pick X conversion

The only explicit X conversion is `first_pick_submitted`, meaning the first saved
pick record for this authenticated player in this league, not every round or an
account-global first pick. The submit API preserves its validation and upsert,
and adds `first_pick_submitted` response metadata after a successful save. It
checks existing player/league pick records, including no-picks, before saving.
Reporting lookup errors fail closed for X and do not prevent the pick saving.
Normal duplicate submissions, replacements and later picks return false.

MakePick passes that response to an independent consent-gated helper. Umami's
existing first-pick reporting remains unchanged; unavailable Umami or invitation
attribution cannot prevent the X conversion. No conversion is sent for a failed
HTTP submission, an absent/false flag, missing ID/configuration or invalid consent.
No historical conversions are replayed after later acceptance.

The helper calls `twq('event', configuredEventId, { conversion_id })`. The sole
parameter is a SHA-256 opaque key derived from the saved pick ID, not the player
ID. No names, emails, selected team, revenue or campaign fields are added. This
is still a pseudonymous event identifier, not a claim of anonymous processing.
An in-memory guard and same-tab sessionStorage marker suppress duplicate calls
and reload replays. Concurrent cross-tab/server requests may both observe no
prior pick: the unique saved pick ID yields the same conversion_id, allowing X's
documented deduplication to count one conversion. Exactly-once network delivery
cannot be guaranteed; blocked/lost requests are not retried. No CAPI is added.

### Events Manager configuration and deployment preparation

1. Sign in to the correct X Ads account. Open Tools > Events Manager and select
   existing Pixel **rhi65**. Do not create another pixel.
2. Add events; name the event **first_pick_submitted**. Choose the **Custom**
   event type (or the available equivalent for this competition action), not
   Purchase. Use code-based event definition, not URL matching or a button rule.
   Review the displayed attribution windows; an audience is optional, not needed
   to implement this event. Do not enable automatic matching or add user fields.
3. Create Event and open its installation code. Copy the complete event identifier
   from `twq('event', 'tw-rhi65-…', ...)`, not the display name or base Pixel ID.
4. Set **VITE_X_FIRST_PICK_EVENT_ID** to that actual ID in Vercel for the intended
   environment. It must match `tw-rhi65-` followed by alphanumeric characters.
   This is public build-time configuration; rebuild after setting/changing it.
   No real ID is currently available or hardcoded. Missing/invalid configuration
   disables only this conversion; consented base tracking still works.
5. Run the checks below on an approved preview with that configuration. Once
   release checks and account/retention checks are satisfied, an authorised person
   can deploy the same source/configuration to Production. This work does not
   authorise or perform deployment. Check the produced deployment, then complete
   live verification before starting Sales > Website Conversions spend.
6. In the ad group's conversion-event selector choose this event after X shows
   it receiving activity. If it is unavailable, check X's event status/account
   eligibility rather than mapping visits or button clicks as first picks.

Use a direct invitation URL for these conversion ads, for example:
`https://lms.fantasycommandcentre.co.uk/private/join?code=FCCLMS&utm_source=twitter&utm_medium=paid&utm_campaign=fcc_100_oct26&utm_content=whiteboard`.
The existing `/j/` handler reconstructs only the stored code/UTMs and does not
forward an incoming `twclid` (`api/join-league.ts`, redirect handler). X documents
that losing this click ID through redirects affects attribution/results. Redirects
are unchanged in this scope; selecting the direct destination avoids that issue
without modifying navigation or storing an advertising identifier before consent.
Confirm an actual X click retains its appended click ID on the landing URL and
inspect consented SDK attribution. Change only the creative's utm_content as needed.

Reporting is now consent-filtered. Total visits, paid funnels and membership UTMs
will be lower/incomplete compared with the old ungated implementation. Missing
attribution does not mean organic traffic or a failed join. Late consent can
produce a partial funnel. Existing historical Umami and database data is unchanged.

## Loading, withdrawal and data minimisation

X uses the supplied base loader and one config for rhi65 per eligible document,
guarded across StrictMode and repeated effects. Four SDK features are disabled
before config: autoConfig, autoAdvancedMatching, dataLayerTracking and
autoDwellTracking (string false for rhi65). These suppress extra events and form
matching; they do not restrict X's downstream advertising uses.

The current official SDK inspected on 22 October 2026 has no pushState,
replaceState, popstate or hashchange hooks. We add no X route/pageview events.
Both loaders defer on recognised credential-bearing URLs/referrers. Umami's
documented before-send hook also rechecks consent on every payload and removes
arbitrary query/hash/next values; consented URL UTMs and explicit campaign event
properties are retained. No player identity is supplied through identify or Pixel
parameters. This is not a guarantee that every possible private value in a URL
can be detected; actual SDK payload inspection remains a release check.

Withdrawal saves rejection, clears queued events and optional browser attribution,
attempts removal of accessible _twclid/_twpid/_twsid cookies, stops unfinished
document downloads and reloads to unload either running SDK. The user is warned
about losing unfinished form entries. Auth/navigation storage and the current URL
are retained. Cross-tab rejection unloads running trackers when the storage event
is delivered; suspended tabs recheck on resume/pageshow. Expiry is also checked
while the app is open. It cannot erase already-collected provider/server data,
recall in-flight requests or delete X-domain cookies.

If saving withdrawal fails, a sessionStorage/in-memory denial latch and fcc_ads=off
on reload protect the browser flow despite an older readable grant. Navigating to
a clean route or returning from authentication in the same tab cannot reactivate
it. A fresh, successfully saved explicit acceptance can remove the guards. If
browser storage is completely unavailable, optional tracking fails closed; the
app does not promise cross-device or cross-tab synchronisation of a failed write.

## Approved account/competition/email policy and manual procedure

The owner approved contractual necessity (UK GDPR Article 6(1)(b)) where needed
for requested accounts and competition services. Advertising/Umami and promotional
email each rely on their separate consent (Article 6(1)(a)); no assessment is
claimed for a new legitimate-interest purpose.

Approved retention criteria:
- On account closure, delete/anonymise identifiers when no longer needed, taking
  account of active competitions, prizes, disputes, security and applicable law.
- Preserve identifiable history while needed for account functionality,
  competition records and results; delete/anonymise once identification is no
  longer necessary. Do not promise immediate deletion after every competition.
- Stop promotional sending after withdrawal. Retain only necessary consent and
  suppression evidence, with annual review of continued necessity.
- These are principles, not existing automatic deletion jobs or fixed deadlines.

Minimum manual procedure for the operator:
1. Receive privacy/closure requests at the confirmed email and verify identity
   before releasing or deleting personal information.
2. Review the account's memberships, picks, prize obligations, disputes and any
   justified security/legal retention; record what must be kept and why.
3. Use authorised provider/admin tools to delete or anonymise information no
   longer needed. Check foreign-key/cascade effects first so action does not
   corrupt active competitions or other players' records. Do not claim completion
   unless the affected account, database, email and relevant provider records have
   actually been checked. Document any retained subset and review trigger.
4. Review identifiable historical records when their account/competition purpose
   ends or a request exposes unnecessary retention; no automatic schedule exists.
5. Review email consent/suppression evidence annually; retain only what is still
   needed to substantiate sending or prevent unwanted contact. Record the review.

The owner also approved retaining identifiable campaign/visitor records only while
necessary to analyse campaign performance, investigate conversion problems and
verify acquisition results, with monthly manual review and deletion/anonymisation
when identification is no longer necessary. Review raw events, membership campaign
metadata and any exports during that review and record the decision. The actual
Umami Cloud retention setting still needs checking in the account. No provider
setting was accessed or changed, and no fixed deletion period is invented.

## X data terms and remaining account checks

Confirmed in the published International MSA / Conversion Tracking Program:
- Match Data is covered by processor terms; ordinary Conversion Data (including
  visits) by controller-to-controller terms. Website visits can support ad
  measurement, Custom Audiences, optimisation and product/system improvement.
- The controller and processor addenda provide UK SCC Addendum provisions where
  applicable. X's privacy policy also describes DPF/UK Extension participation.
  A bespoke DPA is not automatically required, nor is blanket UK hosting promised.
- Non-aggregated reports have contractual retention/use restrictions; do not
  export/re-identify/report-repurpose beyond the permitted terms.

Not verified from the repository:
- FCC's actual advertising-account terms/recipient coverage, transfer route,
  relevant subprocessors and any assessment needed for that route.
- Pixel/account audience and data-use settings. No retargeting audience or event
  definition has been created in X Events Manager by this code.
- Actual production SDK payloads, CSP delivery and Events Manager activity.
- Supabase/hosting/email/diagnostic provider retention/regions and any required
  existing operational-processing basis assessment; this release does not claim
  a completed platform-wide privacy audit.

Owner verification of applicable standard terms and transfer coverage can satisfy
the account check; full bespoke contract negotiations or arbitrary deletion
periods are not prerequisites. Do not enable the release if the required account
coverage or consent scope cannot be confirmed. Technical tests cannot certify
these legal/account facts.

## Exact release verification (before any approved production release)

### Local validation completed 22 October 2026

- Production build passed. Existing environment/Browserslist/chunk-size warnings
  remain; no dependencies were changed to address unrelated warnings.
- 60 Chromium browser tests passed (advertising consent, acquisition and marketing
  consent suites; 2 workers, 180-second test timeout). Advertising endpoints were
  mocked and VITE_X_FIRST_PICK_EVENT_ID was explicitly set to **tw-rhi65-testonly**
  for this isolated test run. That test value must never be deployed.
- `node scripts/test-x-first-pick.mjs` passed: authenticated first/duplicate/later/
  failed picks, unknown reporting state, missing configuration, consent, withdrawal,
  deduplication and minimal X parameters.
- `node scripts/test-attribution.mjs` passed with consent-aware fixtures.
- Standalone strict TypeScript checking of api/submit-pick.ts and targeted ESLint
  on the consent/analytics/privacy modules passed; git diff --check passed.
- The logged-in withdrawal failure was a test fixture defect: the mocked refresh
  token endpoint returned an incomplete response after reload. The corrected mock
  returns the normal token/session shape. Authentication production code is unchanged.

**Technical code is ready for configuration; conversion-ad launch remains NO-GO
until the actual event ID is configured in a new build and controlled live checks
pass.** Complete the previously documented X-account/transfer and actual Umami
retention checks as well. No real Events Manager event, deployment or production
conversion was created by local mocked tests.

### Preview and production checklist

1. Use a controlled preview with Chrome, X Pixel Helper, tracking allowed, other
   ad blockers off, DevTools Preserve log enabled. Filter Network for uwt.js,
   cloud.umami.is, api-gateway.umami.dev, gateway.umami.is, ads-twitter.com,
   analytics.twitter.com, ads-api.twitter.com and t.co.
2. In a fresh browser open a paid invitation with UTMs. Before consent, neither
   SDK nor collector may be requested. Join code, CTA, OTP, join and pick must work.
   Repeat with Reject and on reload. Check optional attribution keys are absent.
3. Accept while the invitation is still open. Expect one X SDK/config, one Umami
   script and a consented current landing view, without replay of earlier actions.
   Complete OTP/join/first pick. Check matching campaign fields only on consented
   events and new membership payload. Keep the same tab.
4. Navigate/back/reopen and repeat Accept. X must not configure again in the same
   document. Umami's ordinary consented pageviews may continue; no extra manual
   pageview calls were added. Full reload is a new eligible document.
5. Inspect real payloads for unexpected auth credentials, emails, player names,
   automatic extra X events or unexpected URLs. Check production CSP violations.
6. Withdraw before a pick. Confirm the disclosed reload, preserved route/auth and
   active league, no SDK reload or later acquisition event, and functional picking.
   Repeat across tabs, with a delayed SDK and with preference writes blocked.
7. In X Pixel Helper expect base Pixel rhi65 and exactly one configured first-pick
   event after a genuinely new first pick. No conversion on landing, Join, OTP,
   selecting a team, a failed save, updating or submitting a later pick. Reload,
   back and repeated completion must not count another conversion. In Events
   Manager inspect this event's activity/diagnostics as well as base Site Visit/
   Landing Page View activity. Allow for X reporting delay; a local SDK spy is
   not proof of live delivery. Verify rejected and withdrawn users produce no
   X requests, while their first pick still succeeds. Use an eligible controlled
   account/league; do not change deadlines or competition rules for verification.
8. Check mobile 375x600 and keyboard access. The first Join CTA must stay visible
   and unobscured; controls remain accessible by scrolling, with equal choices.
9. Review only this release's privacy/consent/analytics/CSP/test/doc files. Exclude
   generated tsconfig.tsbuildinfo and unrelated send scripts / tracking SQL.
   No commit, push or deployment is authorised by these instructions.

Official sources (reviewed 22 October 2026):
- https://legal.x.com/ads-terms/international.html
- https://gdpr.x.com/en/inbound-controller-dpa.html
- https://privacy.x.com/en/for-our-partners/global-dpa
- https://x.com/en/privacy
- https://help.x.com/en/business-and-advertising/conversion-tracking-for-websites
- https://docs.umami.is/docs/tracker-configuration
- https://docs.umami.is/docs/tracker-functions
- https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/
