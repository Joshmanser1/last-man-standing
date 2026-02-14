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

test("notification centre logs deadline", async ({ page }) => {
  await setUser(page, "notify_admin", true);
  await goto(page, routes.ADMIN);

  page.once("dialog", async (d) => d.dismiss());
  await page.getByTestId("admin-e2e-seed-game-btn").click();

  await setUser(page, "notify_player", false);
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

  await expect(page.getByTestId("notification-centre")).toBeVisible();
  await expect(page.getByText(/Deadline approaching/i)).toBeVisible();
});
