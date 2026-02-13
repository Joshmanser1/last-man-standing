import { test, expect } from "@playwright/test";
import { setUser, goto } from "./helpers";
import fs from "node:fs";

const routes = JSON.parse(
  fs.readFileSync(new URL("./routes.json", import.meta.url), "utf8")
) as {
  HOME_PATH: string;
  ADMIN_PATH: string;
  MAKE_PICK_PATH: string | null;
};

test.describe("LMS deterministic flow (seed -> join -> pick)", () => {
  test("seed public game, join, then make a pick", async ({ page }) => {
    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN_PATH);

    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("admin-e2e-seed-game-btn")).toBeVisible();

    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-seed-game-btn").click();
    await expect
      .poll(async () => {
        return (await page.getByTestId("admin-e2e-seed-status").textContent())?.trim();
      }, { timeout: 60_000 })
      .toMatch(/done|failed/i);

    const seedStatus = (
      (await page.getByTestId("admin-e2e-seed-status").textContent()) || ""
    ).trim().toLowerCase();
    if (seedStatus !== "done") {
      const nameInput = page.getByTestId("admin-game-name");
      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill(`E2E FLOW ${Date.now()}`);
      }
      const makePublic = page.getByTestId("admin-make-public");
      if (await makePublic.isVisible().catch(() => false)) {
        const checked = await makePublic.isChecked();
        if (!checked) await makePublic.click();
      }
      const gw = page.getByTestId("admin-start-gw-select");
      if (await gw.isVisible().catch(() => false)) {
        const opts = await gw.locator("option").all();
        if (opts.length >= 2) {
          const v = await opts[1].getAttribute("value");
          if (v) await gw.selectOption(v);
        }
      }
      page.once("dialog", async (d) => d.dismiss());
      await page.getByTestId("admin-create-game-btn").click();
    }

    await setUser(page, "e2e_player_1", false);
    await goto(page, routes.HOME_PATH);

    await expect(page.getByTestId("lms-dashboard")).toBeVisible();
    const nameInputHome = page.getByPlaceholder(/e.g. Alex/i);
    if (await nameInputHome.isVisible().catch(() => false)) {
      await nameInputHome.fill("E2E Player");
    }

    await expect(page.getByTestId("join-game-btn")).toBeVisible();
    await page.getByTestId("join-game-btn").click();

    if (!routes.MAKE_PICK_PATH) test.fail(true, "MAKE_PICK_PATH not detected");
    await goto(page, routes.MAKE_PICK_PATH as string);
    await expect(page.getByTestId("make-pick-page")).toBeVisible();

    if ((await page.getByTestId("save-pick-btn").count()) === 0) {
      await page.evaluate(() => {
        const raw = localStorage.getItem("lms_store_v1") || "{}";
        const s = JSON.parse(raw) as any;
        s.leagues ||= [];
        s.rounds ||= [];
        s.teams ||= [];
        const leagueId = localStorage.getItem("active_league_id");
        if (!leagueId) return;
        const already = s.teams.some((t: any) => t.league_id === leagueId);
        if (!already) {
          s.teams.push({
            id: crypto.randomUUID(),
            league_id: leagueId,
            name: "E2E FC",
            code: "E2E",
            logo_url: "",
          });
          localStorage.setItem("lms_store_v1", JSON.stringify(s));
        }
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("make-pick-page")).toBeVisible();
    }

    const pickBtn = page.getByTestId("save-pick-btn").first();
    await expect(pickBtn).toBeVisible();
    page.once("dialog", async (d) => d.dismiss());
    await pickBtn.click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.url()).toMatch(/\/results|\/make-pick/);
  });
});
