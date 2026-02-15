import { test, expect } from "@playwright/test";
import { forceDeadlineSoon, goto, setUser } from "./helpers";
import fs from "node:fs";

const routes = (() => {
  try {
    const r = JSON.parse(fs.readFileSync(new URL("./routes.json", import.meta.url), "utf8"));
    return { HOME: r.HOME_PATH || "/home", ADMIN: r.ADMIN_PATH || "/admin" };
  } catch {
    return { HOME: "/home", ADMIN: "/admin" };
  }
})();

test("bell shows unread badge after deadline notification", async ({ page }) => {
  await setUser(page, "bell_admin", true);
  await goto(page, routes.ADMIN);
  page.once("dialog", async (d) => d.dismiss());
  await page.getByTestId("admin-e2e-seed-game-btn").click();

  await setUser(page, "bell_player", false);
  await goto(page, routes.HOME);
  await page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lms_deadline_shown_v1:")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  });
  await forceDeadlineSoon(page, 30);
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("notification-bell")).toBeVisible();
  await expect(page.getByTestId("notification-bell-badge")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByTestId("notification-dropdown")).toBeVisible();
});
