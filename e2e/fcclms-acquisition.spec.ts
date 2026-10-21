import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

const user = {
  id: "11111111-1111-4111-8111-111111111111", email: "entrant@example.test",
  email_confirmed_at: "2026-10-01T12:00:00Z", aud: "authenticated", role: "authenticated",
  app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T12:00:00Z",
};
const theme = {
  enabled: true, hostName: "Fantasy Command Centre", displayName: "£100 Last Man Standing",
  primaryColour: "#0f766e", secondaryColour: "#0f172a", tagline: "One team. One win. Survive and go again.",
};
const paidPath = (creative: string) => `/private/join?code=FCCLMS&utm_source=twitter&utm_medium=paid&utm_campaign=fcc_100_oct26&utm_content=${creative}`;

async function setup(page: Page, code = "FCCLMS", deadline: string | null = "2026-10-23T17:30:00Z") {
  await page.clock.setFixedTime(new Date("2026-10-21T12:00:00Z"));
  let authenticated = false;
  const league = { id: "acquisition-league", name: code === "FCCLMS" ? "FCC £100 Last Man Standing" : "Other Club", join_code: code, current_round: 1, status: "active", is_public: false, managed_theme: theme };
  const round = { id: "round-1", league_id: league.id, round_number: 1, status: "upcoming", pick_deadline_utc: deadline };
  const teams = [{ id: "arsenal", name: "Arsenal", code: "ARS", league_id: league.id }, { id: "everton", name: "Everton", code: "EVE", league_id: league.id }];
  const members = [{ player_id: user.id, league_id: league.id, is_active: true, display_name: "Test Entrant", joined_at: "2026-10-01T12:00:00Z" }];
  const calls = { joins: [] as Record<string, any>[], picks: 0, previews: [] as string[] };
  const controls = { failOtp: false, joinFailure: "", previewUnavailable: false, existingActive: false };
  await page.addInitScript(() => {
    (window as any).__events = [];
    window.umami = { track: (event, properties) => { (window as any).__events.push({ event, properties }); } };
    // Vite adds this development-only toolbar; it is absent for paid visitors.
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = ".fixed.bottom-3.right-3 { display: none !important; }";
      document.head.append(style);
    });
  });
  await page.route("https://**/*", route => route.abort());
  await page.route("**/j/*", route => {
    const creative = new URL(route.request().url()).pathname.split("/").pop()!.replace("fcc-paid-", "");
    return route.fulfill({ status: 302, headers: { Location: paidPath(creative) } });
  });
  await page.route("**/auth/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/verify")) {
      if (controls.failOtp) return route.fulfill({ status: 400, json: { msg: "Token is invalid or expired", code: "otp_expired" } });
      authenticated = true;
      return route.fulfill({ json: { access_token: "mock-token", refresh_token: "mock-refresh", expires_in: 3600, token_type: "bearer", user } });
    }
    if (path.endsWith("/user")) return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? user : { message: "No session" } });
    return route.fulfill({ json: {} });
  });
  await page.route("**/rest/v1/**", route => {
    const table = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ json: table === "profiles" ? { id: user.id, display_name: "Test Entrant", email: user.email }
      : table === "rounds" ? [round] : table === "leagues" ? [league] : table === "memberships" ? members
      : table === "fixtures" ? [{ id: "fixture", round_id: round.id, home_team_id: "arsenal", away_team_id: "everton", kickoff_utc: deadline }] : [] });
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/league-by-code") {
      calls.previews.push(route.request().postDataJSON().join_code);
      if (controls.previewUnavailable) return route.fulfill({ status: 404, json: { error: "League unavailable" } });
      return route.fulfill({ json: { league: { ...league, pick_deadline_utc: deadline, player_count: 7, round_one_picked_count: 2, round_one_joining_open: true } } });
    }
    if (path === "/api/join-league") {
      calls.joins.push(route.request().postDataJSON());
      if (controls.joinFailure) return route.fulfill({ status: 409, json: { error: controls.joinFailure } });
      return route.fulfill({ json: { league_id: league.id, membership_created: !controls.existingActive } });
    }
    if (path === "/api/submit-pick") { calls.picks++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: path === "/api/league-state" ? { league, rounds: [round], teams }
      : path === "/api/league-members" ? members : path === "/api/user-leagues" ? [league]
      : path === "/api/admin" ? { is_site_admin: false }
      : path === "/api/marketing-preferences" ? { has_preference: false, marketing_opt_in: false }
      : path.includes("/fpl") ? { teams: [{ id: 1, short_name: "ARS", code: 3, name: "Arsenal" }], events: [] } : [] });
  });
  return Object.assign(calls, { controls });
}

async function signIn(page: Page) {
  await page.getByPlaceholder("Your name", { exact: true }).fill("Test Entrant");
  await page.getByPlaceholder("you@email.com").fill(user.email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByPlaceholder("123456", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
}

for (const creative of ["whiteboard", "original", "proveit", "future-creative"]) {
  test(`FCCLMS mobile paid ${creative}: OTP resumes explicit join, first pick and attribution`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 600 });
    const calls = await setup(page);
    await page.goto(`/j/fcc-paid-${creative}`);
    const cta = page.getByRole("button", { name: "PLAY FREE — MAKE YOUR PICK", exact: true });
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(600);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByText("FREE TO ENTER · NO CARD REQUIRED", { exact: true })).toBeVisible();
    await expect(page.getByText(/Friday 23 October.*6:30 pm UK time/)).toBeVisible();
    const players = page.getByText("Players:").locator("..");
    await expect(players).toContainText("7");
    expect((await players.boundingBox())!.y).toBeGreaterThan(box!.y + box!.height);
    await cta.click();
    await page.waitForURL("**/login?next=**");
    expect(new URL(page.url()).searchParams.get("next")).toBe(paidPath(creative));
    await expect(page.getByRole("heading", { name: "Join the £100 Last Man Standing" })).toBeVisible();
    await expect(page.getByText("Free entry. No card required.", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter your email and we'll send you a sign-in code. Then you can make your first pick.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    await signIn(page);
    await page.waitForURL("**/make-pick");
    expect(calls.joins).toHaveLength(1);
    expect(calls.joins[0]).toMatchObject({ join_code: "FCCLMS", preserve_existing_membership: true, joinAttribution: { source: "twitter", medium: "paid", campaign: "fcc_100_oct26", content: creative, joinCode: "FCCLMS" } });
    await page.getByTestId("team-select-btn").filter({ has: page.getByText("Arsenal", { exact: true }) }).click();
    await page.getByRole("button", { name: "Submit pick: Arsenal", exact: true }).click();
    await expect(page.locator(".pick-success-card")).toContainText("Pick locked in!");
    expect(calls.picks).toBe(1);
    const events = await page.evaluate(() => (window as any).__events as { event: string; properties: Record<string, unknown> }[]);
    expect(events.map(item => item.event)).toEqual([
      "league_landing_view", "join_clicked", "auth_started", "auth_completed", "league_landing_view", "league_joined", "first_pick_submitted",
    ]);
    for (const item of events) expect(item.properties).toMatchObject({ invite_code: "FCCLMS", utm_source: "twitter", utm_medium: "paid", utm_campaign: "fcc_100_oct26", utm_content: creative });
    expect(calls.previews.every(code => code === "FCCLMS")).toBe(true);
  });
}

test("FCCLMS direct invite uses configured UK deadline even in a different timezone", async ({ page }) => {
  await setup(page, "FCCLMS", "2027-01-08T18:30:00Z");
  await page.goto("/private/join?code=fcclms");
  await expect(page.getByRole("button", { name: "PLAY FREE — MAKE YOUR PICK" })).toBeVisible();
  await expect(page.getByText(/Friday 8 January.*6:30 pm UK time/)).toBeVisible();
});

test("FCCLMS missing deadline is not replaced with a hardcoded date", async ({ page }) => {
  await setup(page, "FCCLMS", null);
  await page.goto("/private/join?code=FCCLMS");
  await expect(page.getByText("First picks lock: To be confirmed")).toBeVisible();
});

test("existing signed-in FCCLMS visitor retains the explicit join flow", async ({ page }) => {
  const calls = await setup(page);
  await page.goto(`/login?next=${encodeURIComponent(paidPath("original"))}`);
  await signIn(page);
  await page.waitForURL(`**${paidPath("original")}`);
  expect(calls.joins).toHaveLength(0); // Login with next alone is never join consent.
  // Model an established session, without an outstanding PKCE callback verifier.
  // A new OTP session is covered separately above, through the existing SPA return.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-") && key.endsWith("-code-verifier")) localStorage.removeItem(key);
    }
  });
  await page.goto("/j/fcc-paid-original");
  await page.getByRole("button", { name: "PLAY FREE — MAKE YOUR PICK" }).click();
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
});

test("other managed league keeps its landing and login presentation", async ({ page }) => {
  await setup(page, "OTHER");
  await page.goto("/private/join?code=OTHER");
  await expect(page.getByRole("heading", { name: theme.displayName })).toBeVisible();
  await expect(page.getByText("FREE TO ENTER · NO CARD REQUIRED", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "JOIN FANTASY COMMAND CENTRE'S LEAGUE", exact: true }).click();
  await page.waitForURL("**/login?next=**");
  await expect(page.getByRole("heading", { name: "Login", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});

for (const next of ["", "/make-pick", "/private/join", "//evil.test/private/join?code=FCCLMS", "/\\evil.test/private/join?code=FCCLMS", "/j/fcc-paid-original"]) {
  test(`generic login is preserved without reliable FCCLMS context: ${next || "standalone"}`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => sessionStorage.setItem("fcc_invite_attribution_v1", JSON.stringify({ inviteCode: "FCCLMS" })));
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await expect(page.getByRole("heading", { name: "Login", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  });
}

const intentKey = "fcc_pending_private_join_v1";
const joinButton = (page: Page) => page.getByRole("button", { name: "PLAY FREE — MAKE YOUR PICK", exact: true });
async function startJoin(page: Page) {
  await page.goto(paidPath("whiteboard"));
  await joinButton(page).click();
  await page.waitForURL("**/login?next=**");
}

test("cancelled login clears intent; later standalone sign-in does not join", async ({ page }) => {
  const calls = await setup(page);
  await startJoin(page);
  await page.goBack();
  await expect(joinButton(page)).toBeVisible();
  expect(await page.evaluate(key => sessionStorage.getItem(key), intentKey)).toBeNull();
  await page.goto(`/login?next=${encodeURIComponent(paidPath("whiteboard"))}`);
  await signIn(page);
  await page.waitForURL(`**${paidPath("whiteboard")}`);
  await expect(joinButton(page)).toBeEnabled();
  expect(calls.joins).toHaveLength(0);
});

test("failed OTP never joins; successful retry resumes exactly once", async ({ page }) => {
  const calls = await setup(page);
  calls.controls.failOtp = true;
  await startJoin(page);
  await signIn(page);
  await expect(page.getByText("That code is invalid or has expired. Request a new code and try again.", { exact: true })).toBeVisible();
  expect(calls.joins).toHaveLength(0);
  calls.controls.failOtp = false;
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
});

test("login reload retains the exact intent; back/reload after completion never replays it", async ({ page }) => {
  const calls = await setup(page);
  await startJoin(page);
  await page.reload();
  await signIn(page);
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
  expect(await page.evaluate(key => sessionStorage.getItem(key), intentKey)).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("active_league_id"))).toBe("acquisition-league");
  await page.goBack();
  await expect(joinButton(page)).toBeEnabled();
  await page.reload();
  await expect(joinButton(page)).toBeEnabled();
  expect(calls.joins).toHaveLength(1);
});

test("expired intent returns to manual joining without an automatic request", async ({ page }) => {
  const calls = await setup(page);
  await startJoin(page);
  await page.evaluate(key => {
    const intent = JSON.parse(sessionStorage.getItem(key)!);
    intent.createdAt -= 16 * 60 * 1000;
    sessionStorage.setItem(key, JSON.stringify(intent));
  }, intentKey);
  await signIn(page);
  await page.waitForURL(`**${paidPath("whiteboard")}`);
  await expect(joinButton(page)).toBeEnabled();
  expect(calls.joins).toHaveLength(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), intentKey)).toBeNull();
});

for (const failure of ["Joining is closed because Round 1 has already started.", "Your membership is inactive. You cannot rejoin this league.", "Failed to join league."]) {
  test(`automatic join failure is consumed and allows manual retry: ${failure}`, async ({ page }) => {
    const calls = await setup(page);
    calls.controls.joinFailure = failure;
    await startJoin(page);
    await signIn(page);
    await expect(page.getByText(failure, { exact: true })).toBeVisible();
    expect(calls.joins).toHaveLength(1);
    expect(await page.evaluate(key => sessionStorage.getItem(key), intentKey)).toBeNull();
    calls.controls.joinFailure = "";
    await joinButton(page).click();
    await page.waitForURL("**/make-pick");
    expect(calls.joins).toHaveLength(2);
    expect(await page.evaluate(() => (window as any).__events.filter((item: any) => item.event === "join_clicked").length)).toBe(2);
    expect(await page.evaluate(() => (window as any).__events.filter((item: any) => item.event === "league_joined").length)).toBe(1);
  });
}

test("invitation becoming unavailable during OTP clears intent without joining", async ({ page }) => {
  const calls = await setup(page);
  await startJoin(page);
  calls.controls.previewUnavailable = true;
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Invite unavailable" })).toBeVisible();
  expect(calls.joins).toHaveLength(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), intentKey)).toBeNull();
});

test("existing active membership opens picks without counting a new join", async ({ page }) => {
  const calls = await setup(page);
  calls.controls.existingActive = true;
  await startJoin(page);
  await signIn(page);
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
  expect(calls.joins[0].preserve_existing_membership).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("active_league_id"))).toBe("acquisition-league");
  expect(await page.evaluate(() => (window as any).__events.filter((item: any) => item.event === "league_joined").length)).toBe(0);
});

test("ordinary private invite also resumes only its explicitly requested join", async ({ page }) => {
  const calls = await setup(page, "OTHER");
  await page.goto("/private/join?code=OTHER&utm_content=private-invite");
  await page.getByRole("button", { name: "JOIN FANTASY COMMAND CENTRE'S LEAGUE", exact: true }).click();
  await page.waitForURL("**/login?next=**");
  await signIn(page);
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
  expect(calls.joins[0].join_code).toBe("OTHER");
});

test("automatic continuation waits for successful profile resolution", async ({ page }) => {
  const calls = await setup(page);
  let failSave = true;
  let savedProfile: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/profiles**", route => {
    if (route.request().method() !== "POST") return route.fulfill({ json: savedProfile });
    if (failSave) return route.fulfill({ status: 503, json: { message: "Profile unavailable" } });
    savedProfile = { ...route.request().postDataJSON(), display_name: "Test Entrant" };
    return route.fulfill({ json: savedProfile });
  });
  await startJoin(page);
  await signIn(page);
  await expect(page.locator("#profile-name")).toBeVisible();
  expect(calls.joins).toHaveLength(0);
  failSave = false;
  await page.locator("#profile-name").fill("Test Entrant");
  await page.locator("form").getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/make-pick");
  expect(calls.joins).toHaveLength(1);
});
