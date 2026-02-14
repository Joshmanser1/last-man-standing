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

export async function forceDeadlineSoon(page: Page, minutesFromNow = 45) {
  await page.evaluate((mins: number) => {
    const STORE_KEY = "lms_store_v1";
    const raw = localStorage.getItem(STORE_KEY) || "{}";
    const st = JSON.parse(raw);

    const leagueId = localStorage.getItem("active_league_id");
    if (!leagueId) return;

    const league = (st.leagues || []).find((l: any) => l.id === leagueId);
    if (!league) return;

    const r = (st.rounds || []).find(
      (round: any) =>
        round.league_id === leagueId && round.round_number === league.current_round
    );
    if (!r) return;

    r.pick_deadline_utc = new Date(Date.now() + mins * 60_000).toISOString();
    r.status = r.status || "upcoming";

    localStorage.setItem(STORE_KEY, JSON.stringify(st));
  }, minutesFromNow);
}
