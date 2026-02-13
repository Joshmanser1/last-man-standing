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

  test("Create Game button exists on Admin page", async ({ page }) => {
    await setUser(page, "admin_smoke", true);
    await goto(page, "/admin");

    await expect(page.getByTestId("admin-create-game-btn")).toBeVisible();
  });
});
