import { test, expect } from "@playwright/test";
import { setUser, goto } from "./helpers";

test.describe("LMS core UX smoke", () => {
  test("Protected LMS area is reachable with player_id", async ({ page }) => {
    await setUser(page, "smoke_a", false);
    await goto(page, "/home");
    await expect(page.getByTestId("lms-dashboard")).toBeVisible();
  });

  test("Admin page is reachable with is_admin=1", async ({ page }) => {
    await setUser(page, "admin_smoke", true);
    await goto(page, "/admin");
    await expect(page.getByTestId("admin-page")).toBeVisible();
  });

  test("Admin can create a game (happy path)", async ({ page }) => {
    await setUser(page, "admin_smoke", true);
    await goto(page, "/admin");

    await page.getByTestId("admin-game-name").fill(`E2E Smoke ${Date.now()}`);

    const gwSelect = page.getByTestId("admin-start-gw-select");
    await expect(gwSelect).toBeVisible();

    const options = await gwSelect.locator("option").all();
    if (options.length >= 2) {
      const val = await options[1].getAttribute("value");
      if (val) await gwSelect.selectOption(val);
    } else if (options.length === 1) {
      const val = await options[0].getAttribute("value");
      if (val) await gwSelect.selectOption(val);
    }

    const pub = page.getByTestId("admin-make-public");
    if (await pub.isVisible()) {
      const checked = await pub.isChecked();
      if (checked) await pub.click();
    }

    page.once("dialog", async (dialog) => {
      await dialog.dismiss();
    });
    await page.getByTestId("admin-create-game-btn").click();

    await expect(page.getByTestId("admin-page")).toBeVisible();
  });
});
