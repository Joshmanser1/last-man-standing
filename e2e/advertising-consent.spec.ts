import { test, expect, type Page } from "@playwright/test";
import { ADVERTISING_CONSENT_KEY as KEY, ADVERTISING_CONSENT_VERSION as VERSION, CONSENT_LIFETIME_MS } from "../src/lib/advertisingConsent";

const SDK = "https://static.ads-twitter.com/uwt.js";
const path = "/login?next=%2Fprivate%2Fjoin%3Fcode%3DFCCLMS&utm_source=twitter&utm_medium=paid&utm_campaign=test#preserved";
const receipt = (choice: string, updatedAt = Date.now()) => ({ version: VERSION, choice, updatedAt });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { pixelCalls?: unknown[][] }).pixelCalls || []);

async function setup(page: Page, initial?: unknown) {
  const requests: string[] = [];
  await page.route("https://**/*", route => route.abort());
  await page.route("**/auth/v1/**", route => route.fulfill({ json: {} }));
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/api/**", route => route.fulfill({ json: [] }));
  await page.route(SDK, route => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "application/javascript", body: `
      window.pixelCalls = [];
      const queued = window.twq.queue.slice();
      window.twq.exe = function () { window.pixelCalls.push(Array.from(arguments)); };
      queued.forEach(args => window.twq.exe.apply(window.twq, args));
    ` });
  });
  if (initial !== undefined) {
    // Seed before React mounts and only once, never restoring consent on reload.
    await page.addInitScript(({ key, value }) => {
      if (!sessionStorage.getItem("advertising-test-seeded")) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem("advertising-test-seeded", "1");
      }
    }, { key: KEY, value: initial });
  }
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  return requests;
}

test("no choice or rejection never loads X; mobile login stays usable and refusal survives reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await setup(page);
  await expect(page.getByRole("heading", { name: "Your advertising privacy" })).toBeVisible();
  await page.getByPlaceholder("you@email.com").fill("entrant@example.test");
  await expect(page.getByPlaceholder("you@email.com")).toHaveValue("entrant@example.test");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Reject advertising", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your advertising privacy" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(page.locator("#fcc-x-pixel")).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  expect(new URL(page.url()).searchParams.get("utm_campaign")).toBe("test");
});

test("accept configures once despite StrictMode, repeat acceptance and client navigation; reload configures new document once", async ({ page }) => {
  const requests = await setup(page);
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await expect.poll(() => calls(page)).toEqual([
    ["set", "autoConfig", "false", "rhi65"],
    ["set", "autoAdvancedMatching", "false", "rhi65"],
    ["set", "dataLayerTracking", "false", "rhi65"],
    ["set", "autoDwellTracking", "false", "rhi65"],
    ["config", "rhi65"],
  ]);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await page.getByRole("link", { name: "Privacy notice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy at FCC", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect((await calls(page)).filter(args => args[0] === "config")).toHaveLength(1);
  expect(requests).toHaveLength(1);
  await expect(page.locator('script[src="https://static.ads-twitter.com/uwt.js"]')).toHaveCount(1);
  await page.reload();
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(async () => (await calls(page)).filter(args => args[0] === "config").length).toBe(1);
});

test("withdrawal unloads SDK, clears X cookies, preserves FCC state and does not reactivate on reload/back", async ({ page }) => {
  const requests = await setup(page, receipt("accepted"));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(() => {
    sessionStorage.setItem("pending-flow", "preserved");
    localStorage.setItem("active_league_id", "correct-league");
    document.cookie = "_twclid=test; path=/";
    document.cookie = "_twpid=test; path=/";
    document.cookie = "_twsid=test; path=/";
  });
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await expect(page.getByText("Rejecting now reloads this page", { exact: false })).toBeVisible();
  const before = page.url();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Reject advertising and reload", exact: true }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  expect(await page.evaluate(() => sessionStorage.getItem("pending-flow"))).toBe("preserved");
  expect(await page.evaluate(() => localStorage.getItem("active_league_id"))).toBe("correct-league");
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/_tw(clid|pid|sid)=/);
  await page.getByRole("link", { name: "Privacy notice", exact: true }).click();
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

for (const [name, value] of [
  ["expired", receipt("accepted", Date.now() - CONSENT_LIFETIME_MS - 1000)],
  ["future", receipt("accepted", Date.now() + 86400000)],
  ["wrong version", { ...receipt("accepted"), version: "old" }],
  ["unknown choice", receipt("yes")],
  ["email consent", { marketing_opt_in: true }],
] as const) {
  test(`${name} is not valid advertising consent`, async ({ page }) => {
    const requests = await setup(page, value);
    await expect(page.getByRole("button", { name: "Accept advertising", exact: true })).toBeVisible();
    expect(requests).toHaveLength(0);
  });
}

test("storage write failure cannot grant consent", async ({ page }) => {
  const requests = await setup(page);
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new Error("blocked"); set.call(this, name, value); };
  }, KEY);
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not save");
  expect(requests).toHaveLength(0);
});

test("withdrawal still stops tracking when storage writes fail", async ({ page }) => {
  const requests = await setup(page, receipt("accepted"));
  await expect.poll(() => requests.length).toBe(1);
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) { if (name === key) throw new Error("blocked"); set.call(this, name, value); };
  }, KEY);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await page.getByRole("button", { name: "Reject advertising and reload", exact: true }).click();
  await expect(page).toHaveURL(/fcc_ads=off/);
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  expect(requests).toHaveLength(1);
  // A failed preference write must not let an older grant reactivate on a new route.
  await page.getByRole("link", { name: "Privacy notice", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  expect(requests).toHaveLength(1);
});

test("a withdrawal received from another tab unloads an already configured document", async ({ page, context }) => {
  const requests = await setup(page, receipt("accepted"));
  await expect.poll(() => requests.length).toBe(1);
  const other = await context.newPage();
  await setup(other);
  await other.getByRole("button", { name: "Privacy settings", exact: true }).click();
  const reloaded = page.waitForEvent("load");
  await other.getByRole("button", { name: "Reject advertising and reload", exact: true }).click();
  await reloaded;
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  expect(requests).toHaveLength(1);
});

test("withdrawing during the SDK download clears queued initialization and cancels the request", async ({ page }) => {
  await setup(page);
  let requested = false;
  // Keep the SDK in flight until withdrawal unloads this document.
  await page.route(SDK, async route => {
    requested = true;
    await new Promise<void>(resolve => page.once("load", () => resolve()));
    await route.abort().catch(() => {});
  });
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await Promise.all([
    page.waitForEvent("load"),
    page.getByRole("button", { name: "Reject advertising and reload", exact: true }).click(),
  ]);
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof window.twq)).toBe("undefined");
  await expect(page.locator("#fcc-x-pixel")).toHaveCount(0);
});

test("credential-bearing URLs defer tracking until a safe route", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/privacy?access_token=private-secret");
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  expect(requests).toHaveLength(0);
  await expect(page.locator("#fcc-x-pixel")).toHaveCount(0);
  await page.getByRole("link", { name: "Privacy notice", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect((await calls(page)).filter(args => args[0] === "config")).toHaveLength(1);
});

test("Umami requires consent, uses a send-time guard and filters navigation credentials from payloads", async ({ page }) => {
  const requests = await setup(page);
  let scripts = 0;
  const payloads: Record<string, unknown>[] = [];
  await page.route("https://api-gateway.umami.dev/api/send", async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ json: {}, headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route("https://cloud.umami.is/script.js", route => {
    scripts++;
    return route.fulfill({ contentType: "application/javascript", body: `
      window.umami = { track: function () {
        const handler = window[document.currentScript ? document.currentScript.dataset.beforeSend : 'fccUmamiBeforeSend'];
        const payload = handler('event', {url: location.href, referrer: 'https://example.test/path?email=private@example.test'});
        if (payload) fetch('https://api-gateway.umami.dev/api/send', {method:'POST', body:JSON.stringify(payload)});
      }};
      window.umami.track();
    ` });
  });
  expect(scripts).toBe(0);
  expect(payloads).toHaveLength(0);
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toMatchObject({ url: "/login?utm_source=twitter&utm_medium=paid&utm_campaign=test", referrer: "https://example.test/path" });
  expect(scripts).toBe(1);
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "Privacy settings", exact: true }).click();
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Reject advertising and reload", exact: true }).click()]);
  await expect(page.getByRole("button", { name: "Privacy settings", exact: true })).toBeVisible();
  expect(scripts).toBe(1);
  expect(payloads).toHaveLength(1);
  await expect(page.locator("#fcc-umami")).toHaveCount(0);
});

test("legacy consent and campaign records cannot authorise tracking or be revived by a fresh acceptance", async ({ page }) => {
  const requests = await setup(page, { ...receipt("accepted"), version: "x-measurement-v1" });
  expect(requests).toHaveLength(0);
  await page.evaluate(() => {
    localStorage.setItem("fcc_attribution_first_touch_v1", JSON.stringify({ campaign: "before-consent", capturedAt: new Date().toISOString() }));
    sessionStorage.setItem("fcc_invite_attribution_v1", JSON.stringify({ inviteCode: "OLD", utmCampaign: "before-consent" }));
  });
  await page.getByRole("button", { name: "Accept advertising", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fcc_attribution_first_touch_v1")!).value.campaign)).toBe("test");
  expect(await page.evaluate(() => sessionStorage.getItem("fcc_invite_attribution_v1"))).toBeNull();
});
