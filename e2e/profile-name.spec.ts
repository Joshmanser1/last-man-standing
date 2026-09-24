import { test, expect } from "@playwright/test";

// All auth/profile requests are intercepted: no real accounts or database writes.
for (const initialName of [null, "   ", "Manager", "No Name", "Existing Name"]) {
  test(`OTP resolves profile before invite redirect: ${JSON.stringify(initialName)}`, async ({ page }) => {
    let profile = initialName === null ? null : { id: "fresh-user", display_name: initialName, email: "fresh@example.test" };
    let writes = 0;
    let releaseSave!: () => void;
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const user = { id: "fresh-user", email: "fresh@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
    await page.route("**/auth/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      await route.fulfill({ json: path.endsWith("/verify")
        ? { access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user }
        : path.endsWith("/user") ? user : {} });
    });
    await page.route("**/rest/v1/**", async route => {
      if (!route.request().url().includes("/profiles")) return route.fulfill({ json: [] });
      if (route.request().method() === "POST") {
        writes++;
        await saveGate;
        profile = route.request().postDataJSON();
      }
      await route.fulfill({ json: profile });
    });
    await page.route("**/api/**", route => route.fulfill({ json:
      route.request().url().includes("league-by-code")
        ? { league: { name: "Test Invitation", current_round: 1, managed_theme: null, pick_deadline_utc: null } }
        : [] }));
    await page.goto("/login?next=" + encodeURIComponent("/private/join?code=CHECK"));
    await page.getByPlaceholder("Your name", { exact: true }).fill("  Renée O’Connor  ");
    await page.getByPlaceholder("you@email.com").fill("fresh@example.test");
    await page.getByRole("button", { name: "Send code", exact: true }).click();
    await page.getByPlaceholder("123456", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Verify code", exact: true }).click();
    if (initialName !== "Existing Name") {
      await expect.poll(() => writes).toBe(1);
      expect(new URL(page.url()).pathname).toBe("/login");
      releaseSave();
    }
    await page.waitForURL("**/private/join?code=CHECK");
    expect(profile?.display_name).toBe(initialName === "Existing Name" ? "Existing Name" : "Renée O’Connor");
    expect(writes).toBe(initialName === "Existing Name" ? 0 : 1);
    expect(await page.evaluate(() => sessionStorage.getItem("fcc_pending_display_name"))).toBeNull();
  });
}

test("authenticated user without a name must complete profile; failed saves stay on login", async ({ page }) => {
  const user = { id: "fresh-user", email: "fresh@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  let profile: any = null;
  let failSave = true;
  let failedSaves = 0;
  await page.route("**/auth/v1/**", route => route.fulfill({ json: user }));
  await page.route("**/rest/v1/**", async route => {
    if (!route.request().url().includes("/profiles")) return route.fulfill({ json: [] });
    if (route.request().method() === "POST") {
      if (failSave) { failedSaves++; return route.fulfill({ status: 400, json: { message: "Unavailable" } }); }
      profile = route.request().postDataJSON();
    }
    await route.fulfill({ json: profile });
  });
  await page.route("**/api/**", route => route.fulfill({ json: [] }));
  // Initialize a real OTP session, then remove the pending name before verification resolves.
  await page.route("**/auth/v1/otp", route => route.fulfill({ json: {} }));
  await page.route("**/auth/v1/verify", async route => {
    await page.evaluate(() => sessionStorage.removeItem("fcc_pending_display_name"));
    await route.fulfill({ json: { access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user } });
  });
  await page.goto("/login?next=%2Fprivate");
  await page.getByPlaceholder("Your name", { exact: true }).fill("New Player Name");
  await page.getByPlaceholder("you@email.com").fill("fresh@example.test");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByPlaceholder("123456", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
  await expect(page.locator("#profile-name")).toBeVisible();
  await page.locator("#profile-name").fill("New Player Name");
  await page.locator("form").getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("We couldn't confirm your saved display name.", { exact: false })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/login");
  await expect.poll(() => failedSaves).toBeGreaterThan(0);
  await expect(page.locator("form").getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  failSave = false;
  await page.locator("form").getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/private");
  expect(profile.display_name).toBe("New Player Name");
  profile = null;
  await page.goto("/private");
  await page.waitForURL("**/login?next=%2Fprivate");
  await expect(page.locator("#profile-name")).toBeVisible();
});
