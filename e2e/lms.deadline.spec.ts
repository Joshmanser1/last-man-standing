import { test, expect } from "@playwright/test";
import { setUser, goto, forceDeadlineSoon } from "./helpers";
import fs from "node:fs";

const routes = (() => {
  try {
    const r = JSON.parse(fs.readFileSync(new URL("./routes.json", import.meta.url), "utf8"));
    return {
      HOME: r.HOME_PATH || "/home",
      ADMIN: r.ADMIN_PATH || "/admin",
      PICK: r.MAKE_PICK_PATH || "/make-pick",
    };
  } catch {
    return { HOME: "/home", ADMIN: "/admin", PICK: "/make-pick" };
  }
})();

test.describe("Deadline banner (shown once)", () => {
  test("shows banner within 1 hour and does not repeat after dismiss+reload", async ({
    page,
  }) => {
    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN);

    await expect(page.getByTestId("admin-e2e-seed-game-btn")).toBeVisible();
    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-seed-game-btn").click();
    await expect(page.getByTestId("admin-e2e-seed-status")).toHaveText(/done|failed/i, {
      timeout: 60_000,
    });

    await setUser(page, "deadline_player_1", false);
    await goto(page, routes.HOME);
    await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("lms_deadline_shown_v1:")) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    });

    await forceDeadlineSoon(page, 45);
    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("deadline-banner")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("deadline-banner-dismiss").click();
    await expect(page.getByTestId("deadline-banner")).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("deadline-banner")).toHaveCount(0);
  });
});
