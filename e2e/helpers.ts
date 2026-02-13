import { Page } from "@playwright/test";

/**
 * Sets LMS auth + admin flags BEFORE the app loads (important).
 * Your app rules:
 * - authed if Supabase session exists OR localStorage.player_id exists
 * - admin if localStorage.is_admin === "1"
 */
export async function setUser(page: Page, playerId: string, isAdmin = false) {
  await page.addInitScript(
    ({ playerId, isAdmin }) => {
      localStorage.setItem("dev_switcher", "1");
      localStorage.setItem("player_id", playerId);
      if (isAdmin) localStorage.setItem("is_admin", "1");
      else localStorage.removeItem("is_admin");
    },
    { playerId, isAdmin }
  );
}

export async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}
