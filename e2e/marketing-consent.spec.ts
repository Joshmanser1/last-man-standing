import { test, expect, type Page } from "@playwright/test";
import { MARKETING_CONSENT_WORDING, MARKETING_CONSENT_VERSION, type MarketingPreference } from "../src/lib/marketingConsent";

const none: MarketingPreference = { has_preference: false, marketing_opt_in: false, eligible: false, email_changed: false, updated_at: null };
async function setup(page: Page, initial = none, failMarketing = false, recording = false) {
  const league = { id: 'consent-test-league', name: 'Consent Test Club', current_round: 1, status: 'active', is_public: false, managed_theme: null };
  const round = { id: 'round-1', league_id: league.id, round_number: 1, status: 'upcoming', pick_deadline_utc: new Date(Date.now() + 86400000).toISOString() };
  const teams = [{ id: 'arsenal', name: 'Arsenal', code: 'ARS', league_id: league.id }, { id: 'everton', name: 'Everton', code: 'EVE', league_id: league.id }];
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test', email_confirmed_at: new Date().toISOString(), aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const members = [{ player_id: user.id, league_id: league.id, is_active: true, display_name: 'Test Person', joined_at: new Date().toISOString() }];
  let preference = { ...initial };
  const calls = { picks: 0, marketingReads: 0, updates: [] as any[] };
  await page.addInitScript(({ leagueId, recordingMode }) => {
    localStorage.setItem('active_league_id', leagueId);
    if (recordingMode) sessionStorage.setItem('fcc_current_recording_v1', '{}');
  }, { leagueId: league.id, recordingMode: recording });
  await page.route('**/auth/v1/**', route => route.fulfill({ json: route.request().url().includes('/verify')
    ? { access_token: 'mock-token', refresh_token: 'mock-refresh', expires_in: 3600, token_type: 'bearer', user }
    : route.request().url().includes('/user') ? user : {} }));
  await page.route('**/rest/v1/**', route => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({ json: table === 'profiles' ? { id: user.id, display_name: 'Test Person', email: user.email }
      : table === 'rounds' ? [round] : table === 'leagues' ? [league] : table === 'memberships' ? members
      : table === 'fixtures' ? [{ id: 'fixture', round_id: round.id, home_team_id: 'arsenal', away_team_id: 'everton', kickoff_utc: round.pick_deadline_utc }] : [] });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/marketing-preferences') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); calls.updates.push(body);
        if (failMarketing) return route.fulfill({ status: 503, json: { error: 'Marketing temporarily unavailable.' } });
        preference = { has_preference: true, marketing_opt_in: body.marketing_opt_in, eligible: body.marketing_opt_in, email_changed: false, updated_at: new Date().toISOString() };
      } else calls.marketingReads++;
      return route.fulfill({ json: preference });
    }
    if (path === '/api/submit-pick') { calls.picks++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: path === '/api/league-state' ? { league, rounds: [round], teams }
      : path === '/api/league-members' ? members : path === '/api/user-leagues' ? [league]
      : path === '/api/admin' ? { is_site_admin: false }
      : path.includes('/fpl') ? { teams: [{ id: 1, short_name: 'ARS', code: 3, name: 'Arsenal' }, { id: 2, short_name: 'EVE', code: 11, name: 'Everton' }], events: [] } : [] });
  });
  await page.goto('/login?next=%2Fmake-pick');
  await page.getByPlaceholder('Your name', { exact: true }).fill('Test Person');
  await page.getByPlaceholder('you@email.com').fill(user.email);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await page.getByPlaceholder('123456', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await page.waitForURL('**/make-pick');
  await page.getByTestId('team-select-btn').filter({ has: page.getByText('Arsenal', { exact: true }) }).click();
  await page.getByRole('button', { name: 'Submit pick: Arsenal', exact: true }).click();
  await expect(page.locator('.pick-success-card')).toContainText('Pick locked in!');
  expect(calls.picks).toBe(1);
  return calls;
}

test('optional post-pick consent, exact contract, withdrawal and deliberate resubscription', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await setup(page);
  const consent = page.getByRole('region', { name: 'Competition email preferences' });
  const checkbox = page.getByRole('checkbox', { name: MARKETING_CONSENT_WORDING });
  await expect(checkbox).not.toBeChecked();
  await expect(consent.getByRole('button', { name: 'Subscribe', exact: true })).toBeDisabled();
  expect(calls.updates).toHaveLength(0);
  await checkbox.check();
  await consent.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(consent).toContainText('Competition emails: On');
  expect(calls.updates).toEqual([{ marketing_opt_in: true, capture_source: 'pick_confirmation', consent_version: MARKETING_CONSENT_VERSION }]);
  await expect(checkbox).toHaveCount(0);
  await consent.getByRole('link', { name: 'Manage' }).click();
  await page.waitForURL('**/email-preferences');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.getByRole('button', { name: 'Save email preference' }).click();
  await expect(page.getByRole('status')).toContainText('Competition emails are off.');
  expect(calls.updates[1]).toEqual({ marketing_opt_in: false, capture_source: 'email_preferences', consent_version: MARKETING_CONSENT_VERSION });
  await checkbox.check();
  await page.getByRole('button', { name: 'Save email preference' }).click();
  await expect(page.getByRole('status')).toContainText('Competition emails are on.');
  expect(calls.updates[2].marketing_opt_in).toBe(true);
  expect(calls.picks).toBe(1);
});

test('marketing save failure never undoes the successful pick or blocks its actions', async ({ page }) => {
  const calls = await setup(page, none, true);
  await page.getByRole('checkbox', { name: MARKETING_CONSENT_WORDING }).check();
  await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Marketing temporarily unavailable.');
  await expect(page.locator('.pick-success-card')).toContainText('Pick locked in!');
  await expect(page.getByRole('button', { name: 'View My Games', exact: true })).toBeEnabled();
  expect(calls.picks).toBe(1);
});

for (const optedIn of [true, false]) {
  test(`existing ${optedIn ? 'subscriber' : 'withdrawal'} is not prompted again`, async ({ page }) => {
    const calls = await setup(page, { ...none, has_preference: true, marketing_opt_in: optedIn, eligible: optedIn });
    const consent = page.getByRole('region', { name: 'Competition email preferences' });
    await expect(consent).toContainText(`Competition emails: ${optedIn ? 'On' : 'Off'}`);
    await expect(consent.getByRole('checkbox')).toHaveCount(0);
    await expect(consent.getByRole('link', { name: 'Manage' })).toBeVisible();
    expect(calls.updates).toHaveLength(0);
  });
}

test('recording context suppresses capture and preferences requests even with an authenticated session', async ({ page }) => {
  const calls = await setup(page, none, false, true);
  await expect(page.getByRole('checkbox', { name: MARKETING_CONSENT_WORDING })).toHaveCount(0);
  await page.goto('/email-preferences');
  await expect(page.getByText('Email preferences are disabled in demo and test mode.')).toBeVisible();
  expect(calls.marketingReads).toBe(0); expect(calls.updates).toHaveLength(0);
});
