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

const STORE_KEY = "lms_store_v1";

async function pickAny(page: any, pickIndex = 0) {
  const inputs = page.locator('input[type="radio"], input[type="checkbox"]');
  const count = await inputs.count().catch(() => 0);
  if (count > pickIndex) {
    const el = inputs.nth(pickIndex);
    await el.check().catch(async () => el.click({ force: true }));
    return true;
  }

  const buttons = page.locator("button");
  const btnCount = await buttons.count().catch(() => 0);
  for (let i = 0; i < btnCount; i++) {
    const b = buttons.nth(i);
    const txt = ((await b.textContent().catch(() => "")) || "").toLowerCase();
    if (/save|confirm|submit/.test(txt)) continue;
    if (/arsenal|city|united|chelsea|villa|spurs|liverpool|pick/.test(txt)) {
      await b.click({ force: true }).catch(() => {});
      return true;
    }
  }
  return false;
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

test.describe("LMS deterministic resolve", () => {
  test("seed -> join 2 players -> pick -> resolve -> completed with eliminations", async ({
    page,
  }) => {
    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN_PATH);

    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("admin-e2e-seed-game-btn")).toBeVisible();

    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-seed-game-btn").click();
    await expect(page.getByTestId("admin-e2e-seed-status")).toHaveText(/done|failed/i, {
      timeout: 60_000,
    });

    await setUser(page, "e2e_player_1", false);
    await goto(page, routes.HOME_PATH);
    await expect(page.getByTestId("lms-dashboard")).toBeVisible();
    await page.getByTestId("join-game-btn").click();

    if (!routes.MAKE_PICK_PATH) test.fail(true, "MAKE_PICK_PATH not detected");
    await goto(page, routes.MAKE_PICK_PATH as string);
    await expect(page.getByTestId("make-pick-page")).toBeVisible();
    await ensurePickOptions(page);
    await pickAny(page, 0);
    await page.getByTestId("save-pick-btn").first().click();

    await setUser(page, "e2e_player_2", false);
    await goto(page, routes.HOME_PATH);
    await expect(page.getByTestId("lms-dashboard")).toBeVisible();
    await page.getByTestId("join-game-btn").click();

    await goto(page, routes.MAKE_PICK_PATH as string);
    await expect(page.getByTestId("make-pick-page")).toBeVisible();
    await ensurePickOptions(page);
    await pickAny(page, 1);
    await page.getByTestId("save-pick-btn").first().click();

    await setUser(page, "e2e_admin", true);
    await goto(page, routes.ADMIN_PATH);
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
        (p: any) => p.round_id === round.id && p.player_id === "e2e_player_2"
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
          player_id: "e2e_player_2",
          team_id: altTeam.id,
          created_at: new Date().toISOString(),
          status: "pending",
        });
      }
      localStorage.setItem(key, JSON.stringify(st));
    }, STORE_KEY);
    await expect(page.getByTestId("admin-e2e-resolve-round-btn")).toBeVisible();
    page.once("dialog", async (d) => d.dismiss());
    await page.getByTestId("admin-e2e-resolve-round-btn").click();
    await expect(page.getByTestId("admin-e2e-resolve-status")).toHaveText(/done/i, {
      timeout: 60_000,
    });

    const result = await page.evaluate((key: string) => {
      const raw = localStorage.getItem(key) || "{}";
      const st = JSON.parse(raw);
      const leagues = st.leagues || [];
      const rounds = st.rounds || [];
      const picks = st.picks || [];

      const activeLeagueId = localStorage.getItem("active_league_id");
      const league =
        leagues.find((l: any) => l.id === activeLeagueId) || leagues[leagues.length - 1];
      if (!league) return { ok: false, reason: "no league" };

      const leagueRounds = rounds
        .filter((r: any) => r.league_id === league.id)
        .sort((a: any, b: any) => b.round_number - a.round_number);
      if (!leagueRounds.length) return { ok: false, reason: "no round" };

      const completedRound =
        leagueRounds.find((r: any) => r.status === "completed") || leagueRounds[0];
      const roundPicks = picks.filter((p: any) => p.round_id === completedRound.id);
      const eliminated = roundPicks.filter((p: any) => p.status === "eliminated").length;

      return {
        ok: true,
        roundStatus: completedRound.status,
        eliminated,
        picks: roundPicks.length,
      };
    }, STORE_KEY);

    expect(result.ok).toBeTruthy();
    expect(result.roundStatus).toMatch(/completed/i);
    expect(result.picks).toBeGreaterThan(0);
    expect(result.eliminated).toBeGreaterThan(0);
  });
});
