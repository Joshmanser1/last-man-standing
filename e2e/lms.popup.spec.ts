import { test, expect } from "@playwright/test";
import { setUser, goto } from "./helpers";
import fs from "node:fs";

const routes = (() => {
  try {
    const r = JSON.parse(fs.readFileSync(new URL("./routes.json", import.meta.url), "utf8"));
    return {
      HOME: r.HOME_PATH || "/home",
      ADMIN: r.ADMIN_PATH || "/admin",
      PICK: r.MAKE_PICK_PATH || "/make-pick",
      RESULTS: r.RESULTS_PATH || "/results",
    };
  } catch {
    return { HOME: "/home", ADMIN: "/admin", PICK: "/make-pick", RESULTS: "/results" };
  }
})();

const STORE_KEY = "lms_store_v1";

async function clearOutcomeShownKeys(page: any) {
  await page.evaluate(() => {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("lms_outcome_shown_v1:")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  });
}

async function ensurePickOptions(page: any) {
  if ((await page.getByTestId("save-pick-btn").count().catch(() => 0)) > 0) return;
  await page.evaluate(() => {
    const raw = localStorage.getItem("lms_store_v1") || "{}";
    const s = JSON.parse(raw) as any;
    s.teams ||= [];
    const activeLeagueId = localStorage.getItem("active_league_id");
    if (!activeLeagueId) return;
    const already = s.teams.some((t: any) => t.league_id === activeLeagueId);
    if (!already) {
      s.teams.push({
        id: crypto.randomUUID(),
        league_id: activeLeagueId,
        name: "E2E FC",
        code: "E2E",
        logo_url: "",
      });
      localStorage.setItem("lms_store_v1", JSON.stringify(s));
    }
  });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function pickFirstOptionAndSave(page: any) {
  await ensurePickOptions(page);
  const inputs = page.locator('input[type="radio"], input[type="checkbox"]');
  const cnt = await inputs.count().catch(() => 0);
  if (cnt > 0) {
    await inputs.first().check().catch(async () => inputs.first().click({ force: true }));
  }
  await expect(page.getByTestId("save-pick-btn").first()).toBeVisible();
  await page.getByTestId("save-pick-btn").first().click();
}

test.describe("Outcome popup (shown once)", () => {
  test("eliminated modal appears once after resolve", async ({ page }) => {
    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN);
    await clearOutcomeShownKeys(page);

    await expect(page.getByTestId("admin-e2e-seed-game-btn")).toBeVisible();
    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-seed-game-btn").click();
    await expect(page.getByTestId("admin-e2e-seed-status")).toHaveText(/done|failed/i, {
      timeout: 60_000,
    });

    await setUser(page, "popup_p1", false);
    await goto(page, routes.HOME);
    await expect(page.getByTestId("join-game-btn")).toBeVisible();
    await page.getByTestId("join-game-btn").click();
    await goto(page, routes.PICK);
    await expect(page.getByTestId("make-pick-page")).toBeVisible();
    await pickFirstOptionAndSave(page);

    await setUser(page, "popup_p2", false);
    await goto(page, routes.HOME);
    await page.getByTestId("join-game-btn").click();
    await goto(page, routes.PICK);
    await expect(page.getByTestId("make-pick-page")).toBeVisible();

    await ensurePickOptions(page);
    const inputs2 = page.locator('input[type="radio"], input[type="checkbox"]');
    const cnt2 = await inputs2.count().catch(() => 0);
    if (cnt2 > 1) {
      await inputs2.nth(1).check().catch(async () => inputs2.nth(1).click({ force: true }));
    } else if (cnt2 > 0) {
      await inputs2.first().check().catch(async () => inputs2.first().click({ force: true }));
    }
    await page.getByTestId("save-pick-btn").first().click();

    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN);
    await expect(page.getByTestId("admin-e2e-resolve-round-btn")).toBeVisible();
    await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key) || "{}";
      const st = JSON.parse(raw) as any;
      st.leagues ||= [];
      st.rounds ||= [];
      st.teams ||= [];
      st.picks ||= [];

      const activeLeagueId = localStorage.getItem("active_league_id");
      const league =
        st.leagues.find((l: any) => l.id === activeLeagueId) || st.leagues[st.leagues.length - 1];
      if (!league) return;
      const round =
        st.rounds.find(
          (r: any) => r.league_id === league.id && r.round_number === league.current_round
        ) ||
        st.rounds
          .filter((r: any) => r.league_id === league.id)
          .sort((a: any, b: any) => b.round_number - a.round_number)[0];
      if (!round) return;

      const playable = st.picks.filter(
        (p: any) => p.round_id === round.id && p.status !== "no-pick" && p.team_id
      );
      const distinct = new Set(playable.map((p: any) => p.team_id));
      if (distinct.size >= 2) return;

      const leagueTeams = st.teams.filter((t: any) => t.league_id === league.id);
      if (leagueTeams.length < 2) {
        st.teams.push({
          id: crypto.randomUUID(),
          league_id: league.id,
          name: "E2E Alt FC",
          code: "E2A",
          logo_url: "",
        });
      }
      const teamsNow = st.teams.filter((t: any) => t.league_id === league.id);
      const firstTeamId = playable[0]?.team_id || teamsNow[0]?.id;
      const altTeam =
        teamsNow.find((t: any) => t.id !== firstTeamId) || teamsNow[teamsNow.length - 1];
      if (!altTeam?.id) return;

      const existingP2 = st.picks.find(
        (p: any) => p.round_id === round.id && p.player_id === "popup_p2"
      );
      if (existingP2) {
        existingP2.team_id = altTeam.id;
        existingP2.status = "pending";
        delete existingP2.reason;
      } else {
        st.picks.push({
          id: crypto.randomUUID(),
          league_id: league.id,
          round_id: round.id,
          player_id: "popup_p2",
          team_id: altTeam.id,
          created_at: new Date().toISOString(),
          status: "pending",
        });
      }
      localStorage.setItem(key, JSON.stringify(st));
    }, STORE_KEY);
    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-resolve-round-btn").click();
    await expect(page.getByTestId("admin-e2e-resolve-status")).toHaveText(/done/i, {
      timeout: 60_000,
    });

    const eliminatedPlayerId = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key) || "{}";
      const st = JSON.parse(raw);
      const leagueId = localStorage.getItem("active_league_id");
      const rounds = (st.rounds || []).filter(
        (r: any) => r.league_id === leagueId && r.status === "completed"
      );
      rounds.sort((a: any, b: any) => b.round_number - a.round_number);
      const round = rounds[0];
      if (!round) return null;

      const picks = (st.picks || []).filter((p: any) => p.round_id === round.id);
      const elim = picks.find((p: any) => p.status === "eliminated" || p.status === "no-pick");
      return elim?.player_id || null;
    }, STORE_KEY);

    expect(eliminatedPlayerId).toBeTruthy();

    await setUser(page, eliminatedPlayerId, false);
    await goto(page, routes.RESULTS);
    await expect(page.getByTestId("outcome-modal")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("outcome-modal-continue").click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("outcome-modal")).toHaveCount(0);
  });
});
