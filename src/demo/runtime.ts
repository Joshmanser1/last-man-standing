import type { Fixture, League, Membership, Pick, Round, Team } from "../data/types";

export type MarketingDemoScenario =
  | "active"
  | "pick_submitted"
  | "survived"
  | "eliminated"
  | "winner";

type DemoLeague = League & {
  created_at?: string;
  start_date_utc?: string;
  description?: string;
  prize?: string;
  host_name?: string;
  competition_name?: string;
  viewer_has_membership?: boolean;
  viewer_is_owner?: boolean;
  viewer_role?: string | null;
  viewer_is_active?: boolean;
  viewer_joined_at?: string | null;
};

type DemoMember = Membership & {
  role?: string;
  display_name?: string | null;
};

type DemoState = {
  joinedLeagueIds: string[];
  activeLeagueId: string;
  scenario: MarketingDemoScenario;
  createdLeague: DemoLeague | null;
};

type DemoSnapshot = {
  leagues: DemoLeague[];
  rounds: Round[];
  teams: Team[];
  fixtures: Array<Fixture & { league_id: string }>;
  memberships: DemoMember[];
  picks: Pick[];
};

const DEMO_ACTIVE_KEY = "fcc_marketing_demo_active_v1";
const DEMO_STATE_KEY = "fcc_marketing_demo_state_v1";
const DEMO_PLAYER_ID = "demo-user-001";
const DEMO_PLAYER_NAME = "Alex Morgan";
const DEMO_PLAYER_EMAIL = "alex@fantasycommandcentre.co.uk";
const DEMO_LEAGUE_ID = "demo-league-founding-host";
const DEMO_JOIN_CODE = "FCC123";
const DEMO_ROUND_1_ID = "demo-round-1";
const DEMO_ROUND_2_ID = "demo-round-2";
const DEMO_ROUND_3_ID = "demo-round-3";
const DEMO_CREATED_LEAGUE_ID = "demo-created-league";
const DEMO_CREATED_ROUND_ID = "demo-created-round-1";
const DEMO_CREATED_JOIN_CODE = "HOST88";
const DEMO_DEADLINE_UTC = "2026-09-12T11:30:00.000Z";
const DEMO_CREATED_DEADLINE_UTC = "2026-09-19T11:30:00.000Z";
const DEFAULT_CREATED_AT = "2026-08-06T09:00:00.000Z";

export function isMarketingDemoEnabled() {
  return import.meta.env.VITE_ENABLE_MARKETING_DEMO === "true";
}

export function isMarketingDemoRequested(pathname: string, search: string) {
  if (pathname === "/demo") return true;
  const params = new URLSearchParams(search);
  return params.get("marketingDemo") === "true";
}

export function isMarketingDemoActive() {
  return (
    typeof window !== "undefined" &&
    isMarketingDemoEnabled() &&
    window.sessionStorage.getItem(DEMO_ACTIVE_KEY) === "1"
  );
}

function defaultState(): DemoState {
  return {
    joinedLeagueIds: [DEMO_LEAGUE_ID],
    activeLeagueId: DEMO_LEAGUE_ID,
    scenario: "active",
    createdLeague: null,
  };
}

function readState(): DemoState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(DEMO_STATE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...(JSON.parse(raw) as Partial<DemoState>) };
  } catch {
    return defaultState();
  }
}

function writeState(next: DemoState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("lms:store-updated"));
}

export function activateMarketingDemo() {
  if (typeof window === "undefined" || !isMarketingDemoEnabled()) return false;
  window.sessionStorage.setItem(DEMO_ACTIVE_KEY, "1");
  window.localStorage.setItem("player_id", DEMO_PLAYER_ID);
  window.localStorage.setItem("player_name", DEMO_PLAYER_NAME);
  window.localStorage.setItem("active_league_id", readState().activeLeagueId);
  window.dispatchEvent(new Event("lms:store-updated"));
  return true;
}

export function ensureMarketingDemoForLocation(pathname: string, search: string) {
  if (!isMarketingDemoEnabled()) return false;
  if (!isMarketingDemoRequested(pathname, search)) return false;
  return activateMarketingDemo();
}

export function resetMarketingDemo() {
  if (typeof window === "undefined") return;
  writeState(defaultState());
  window.localStorage.removeItem("fcc_demo_outcome_seen_v1");
  window.localStorage.removeItem("fcc_demo_popup_seen_v1");
  window.localStorage.setItem("active_league_id", DEMO_LEAGUE_ID);
  window.localStorage.setItem("player_id", DEMO_PLAYER_ID);
  window.localStorage.setItem("player_name", DEMO_PLAYER_NAME);
}

export function getMarketingDemoUser() {
  return {
    id: DEMO_PLAYER_ID,
    display_name: DEMO_PLAYER_NAME,
    email: DEMO_PLAYER_EMAIL,
  };
}

export function getMarketingDemoScenario(): MarketingDemoScenario {
  return readState().scenario;
}

export function setMarketingDemoScenario(scenario: MarketingDemoScenario) {
  const next = readState();
  next.scenario = scenario;
  writeState(next);
}

export function rememberCreatedDemoLeague(leagueName: string) {
  const next = readState();
  next.createdLeague = {
    id: DEMO_CREATED_LEAGUE_ID,
    name: leagueName || "Weekend Winners Demo",
    status: "upcoming",
    current_round: 1,
    is_public: false,
    join_code: DEMO_CREATED_JOIN_CODE,
    created_by: DEMO_PLAYER_ID,
    is_test: true,
    created_at: DEFAULT_CREATED_AT,
    start_date_utc: DEMO_CREATED_DEADLINE_UTC,
    description:
      "This is a fictional demo league created in Marketing Demo mode.",
    prize: "Bragging rights",
    host_name: DEMO_PLAYER_NAME,
    competition_name: "Premier League Last Man Standing",
    viewer_has_membership: true,
    viewer_is_owner: true,
    viewer_role: "owner",
    viewer_is_active: true,
    viewer_joined_at: DEFAULT_CREATED_AT,
  };
  next.activeLeagueId = DEMO_CREATED_LEAGUE_ID;
  if (!next.joinedLeagueIds.includes(DEMO_CREATED_LEAGUE_ID)) {
    next.joinedLeagueIds = [...next.joinedLeagueIds, DEMO_CREATED_LEAGUE_ID];
  }
  writeState(next);
  window.localStorage.setItem("active_league_id", DEMO_CREATED_LEAGUE_ID);
  return next.createdLeague;
}

export function joinMarketingDemoLeague() {
  const next = readState();
  if (!next.joinedLeagueIds.includes(DEMO_LEAGUE_ID)) {
    next.joinedLeagueIds = [...next.joinedLeagueIds, DEMO_LEAGUE_ID];
  }
  next.activeLeagueId = DEMO_LEAGUE_ID;
  writeState(next);
  window.localStorage.setItem("active_league_id", DEMO_LEAGUE_ID);
  return findMembership(DEMO_LEAGUE_ID, DEMO_PLAYER_ID, getMarketingDemoSnapshot());
}

function team(leagueId: string, id: string, name: string, code: string): Team {
  return { id, league_id: leagueId, name, code };
}

function leagueBase(): DemoLeague {
  return {
    id: DEMO_LEAGUE_ID,
    name: "Founding Host Demo",
    status: "active",
    current_round: 3,
    is_public: false,
    join_code: DEMO_JOIN_CODE,
    created_by: DEMO_PLAYER_ID,
    is_test: true,
    created_at: DEFAULT_CREATED_AT,
    start_date_utc: "2026-08-23T11:30:00.000Z",
    description:
      "Welcome to the Founding Host Demo League. Pick one Premier League team to win each round. Lose or draw and you are eliminated.",
    prize: "£100 winner's prize",
    host_name: DEMO_PLAYER_NAME,
    competition_name: "Premier League Last Man Standing",
  };
}

function demoTeams(): Team[] {
  return [
    team(DEMO_LEAGUE_ID, "team-ars", "Arsenal", "ARS"),
    team(DEMO_LEAGUE_ID, "team-eve", "Everton", "EVE"),
    team(DEMO_LEAGUE_ID, "team-liv", "Liverpool", "LIV"),
    team(DEMO_LEAGUE_ID, "team-bou", "Bournemouth", "BOU"),
    team(DEMO_LEAGUE_ID, "team-che", "Chelsea", "CHE"),
    team(DEMO_LEAGUE_ID, "team-ful", "Fulham", "FUL"),
    team(DEMO_LEAGUE_ID, "team-mci", "Manchester City", "MCI"),
    team(DEMO_LEAGUE_ID, "team-wol", "Wolves", "WOL"),
    team(DEMO_LEAGUE_ID, "team-new", "Newcastle", "NEW"),
    team(DEMO_LEAGUE_ID, "team-bha", "Brighton", "BHA"),
    team(DEMO_LEAGUE_ID, "team-tot", "Tottenham", "TOT"),
    team(DEMO_LEAGUE_ID, "team-bre", "Brentford", "BRE"),
    team(DEMO_LEAGUE_ID, "team-avl", "Aston Villa", "AVL"),
    team(DEMO_LEAGUE_ID, "team-whu", "West Ham", "WHU"),
    team(DEMO_LEAGUE_ID, "team-mun", "Manchester United", "MUN"),
    team(DEMO_LEAGUE_ID, "team-cry", "Crystal Palace", "CRY"),
  ];
}

function demoRounds(): Round[] {
  return [
    {
      id: DEMO_ROUND_1_ID,
      league_id: DEMO_LEAGUE_ID,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: "2026-08-23T11:30:00.000Z",
      status: "completed",
    },
    {
      id: DEMO_ROUND_2_ID,
      league_id: DEMO_LEAGUE_ID,
      round_number: 2,
      name: "Round 2",
      pick_deadline_utc: "2026-08-30T11:30:00.000Z",
      status: "completed",
    },
    {
      id: DEMO_ROUND_3_ID,
      league_id: DEMO_LEAGUE_ID,
      round_number: 3,
      name: "Round 3",
      pick_deadline_utc: DEMO_DEADLINE_UTC,
      status: "upcoming",
    },
  ];
}

function member(
  id: string,
  display_name: string,
  is_active: boolean,
  role: string,
  joined_at = "2026-08-06T09:00:00.000Z"
): DemoMember {
  return {
    id: `${DEMO_LEAGUE_ID}:${id}`,
    league_id: DEMO_LEAGUE_ID,
    player_id: id,
    is_active,
    joined_at,
    role,
    display_name,
  };
}

function demoMembers(): DemoMember[] {
  return [
    member(DEMO_PLAYER_ID, "Alex Morgan", true, "owner"),
    member("demo-user-002", "Jamie Taylor", true, "player"),
    member("demo-user-003", "Sarah Wilson", true, "player"),
    member("demo-user-004", "Daniel Green", false, "player"),
    member("demo-user-005", "Emma Roberts", false, "player"),
    member("demo-user-006", "Ben Walker", false, "player"),
    member("demo-user-007", "Chloe Evans", true, "player"),
    member("demo-user-008", "Ryan Hughes", false, "player"),
    member("demo-user-009", "Sophie Clarke", true, "player"),
    member("demo-user-010", "Tom Bennett", true, "player"),
  ];
}

function pick(
  id: string,
  roundId: string,
  playerId: string,
  teamId: string | null,
  status: Pick["status"],
  reason?: Pick["reason"]
): Pick {
  return {
    id,
    league_id: DEMO_LEAGUE_ID,
    round_id: roundId,
    player_id: playerId,
    team_id: teamId ?? "",
    created_at: DEFAULT_CREATED_AT,
    status,
    reason,
  };
}

function basePicks(): Pick[] {
  return [
    pick("pick-r1-alex", DEMO_ROUND_1_ID, DEMO_PLAYER_ID, "team-ars", "through"),
    pick("pick-r1-jamie", DEMO_ROUND_1_ID, "demo-user-002", "team-liv", "through"),
    pick("pick-r1-sarah", DEMO_ROUND_1_ID, "demo-user-003", "team-mci", "through"),
    pick("pick-r1-daniel", DEMO_ROUND_1_ID, "demo-user-004", "team-avl", "through"),
    pick("pick-r1-emma", DEMO_ROUND_1_ID, "demo-user-005", "team-mun", "no-pick", "no-pick"),
    pick("pick-r1-ben", DEMO_ROUND_1_ID, "demo-user-006", "team-che", "eliminated", "draw"),
    pick("pick-r1-chloe", DEMO_ROUND_1_ID, "demo-user-007", "team-new", "through"),
    pick("pick-r1-ryan", DEMO_ROUND_1_ID, "demo-user-008", "team-tot", "through"),
    pick("pick-r1-sophie", DEMO_ROUND_1_ID, "demo-user-009", "team-whu", "through"),
    pick("pick-r1-tom", DEMO_ROUND_1_ID, "demo-user-010", "team-bha", "through"),

    pick("pick-r2-alex", DEMO_ROUND_2_ID, DEMO_PLAYER_ID, "team-che", "through"),
    pick("pick-r2-jamie", DEMO_ROUND_2_ID, "demo-user-002", "team-new", "through"),
    pick("pick-r2-sarah", DEMO_ROUND_2_ID, "demo-user-003", "team-tot", "through"),
    pick("pick-r2-daniel", DEMO_ROUND_2_ID, "demo-user-004", "team-bha", "eliminated", "loss"),
    pick("pick-r2-chloe", DEMO_ROUND_2_ID, "demo-user-007", "team-ful", "through"),
    pick("pick-r2-ryan", DEMO_ROUND_2_ID, "demo-user-008", "team-mci", "eliminated", "draw"),
    pick("pick-r2-sophie", DEMO_ROUND_2_ID, "demo-user-009", "team-ars", "through"),
    pick("pick-r2-tom", DEMO_ROUND_2_ID, "demo-user-010", "team-liv", "through"),

    pick("pick-r3-jamie", DEMO_ROUND_3_ID, "demo-user-002", "team-mci", "pending"),
    pick("pick-r3-sarah", DEMO_ROUND_3_ID, "demo-user-003", "team-new", "pending"),
    pick("pick-r3-chloe", DEMO_ROUND_3_ID, "demo-user-007", "team-ars", "pending"),
    pick("pick-r3-tom", DEMO_ROUND_3_ID, "demo-user-010", "team-che", "pending"),
  ];
}

function demoFixtures(): Array<Fixture & { league_id: string }> {
  return [
    {
      id: "fx-r3-1",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-ars",
      away_team_id: "team-eve",
      kickoff_utc: "2026-09-12T11:30:00.000Z",
      result: "not_set",
    },
    {
      id: "fx-r3-2",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-liv",
      away_team_id: "team-bou",
      kickoff_utc: "2026-09-12T14:00:00.000Z",
      result: "not_set",
    },
    {
      id: "fx-r3-3",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-che",
      away_team_id: "team-ful",
      kickoff_utc: "2026-09-12T14:00:00.000Z",
      result: "not_set",
    },
    {
      id: "fx-r3-4",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-mci",
      away_team_id: "team-wol",
      kickoff_utc: "2026-09-12T16:30:00.000Z",
      result: "not_set",
    },
    {
      id: "fx-r3-5",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-new",
      away_team_id: "team-bha",
      kickoff_utc: "2026-09-13T13:00:00.000Z",
      result: "not_set",
    },
    {
      id: "fx-r3-6",
      league_id: DEMO_LEAGUE_ID,
      round_id: DEMO_ROUND_3_ID,
      home_team_id: "team-tot",
      away_team_id: "team-bre",
      kickoff_utc: "2026-09-13T15:30:00.000Z",
      result: "not_set",
    },
  ];
}

function createdLeagueSnapshot(createdLeague: DemoLeague): DemoSnapshot {
  const teams = [
    team(createdLeague.id, "created-team-ars", "Arsenal", "ARS"),
    team(createdLeague.id, "created-team-liv", "Liverpool", "LIV"),
    team(createdLeague.id, "created-team-che", "Chelsea", "CHE"),
    team(createdLeague.id, "created-team-mci", "Manchester City", "MCI"),
  ];
  const memberships: DemoMember[] = [
    {
      id: `${createdLeague.id}:${DEMO_PLAYER_ID}`,
      league_id: createdLeague.id,
      player_id: DEMO_PLAYER_ID,
      is_active: true,
      joined_at: DEFAULT_CREATED_AT,
      role: "owner",
      display_name: DEMO_PLAYER_NAME,
    },
  ];
  const rounds: Round[] = [
    {
      id: DEMO_CREATED_ROUND_ID,
      league_id: createdLeague.id,
      round_number: 1,
      name: "Round 1",
      pick_deadline_utc: DEMO_CREATED_DEADLINE_UTC,
      status: "upcoming",
    },
  ];
  return {
    leagues: [createdLeague],
    rounds,
    teams,
    fixtures: [
      {
        id: "created-fx-1",
        league_id: createdLeague.id,
        round_id: DEMO_CREATED_ROUND_ID,
        home_team_id: "created-team-ars",
        away_team_id: "created-team-liv",
        kickoff_utc: DEMO_CREATED_DEADLINE_UTC,
        result: "not_set",
      },
      {
        id: "created-fx-2",
        league_id: createdLeague.id,
        round_id: DEMO_CREATED_ROUND_ID,
        home_team_id: "created-team-che",
        away_team_id: "created-team-mci",
        kickoff_utc: DEMO_CREATED_DEADLINE_UTC,
        result: "not_set",
      },
    ],
    memberships,
    picks: [],
  };
}

function withScenario(snapshot: DemoSnapshot, scenario: MarketingDemoScenario): DemoSnapshot {
  const next: DemoSnapshot = {
    leagues: snapshot.leagues.map((league) => ({ ...league })),
    rounds: snapshot.rounds.map((round) => ({ ...round })),
    teams: snapshot.teams.map((teamEntry) => ({ ...teamEntry })),
    fixtures: snapshot.fixtures.map((fixture) => ({ ...fixture })),
    memberships: snapshot.memberships.map((membership) => ({ ...membership })),
    picks: snapshot.picks.map((entry) => ({ ...entry })),
  };

  const viewerPick = next.picks.find(
    (entry) =>
      entry.round_id === DEMO_ROUND_3_ID && entry.player_id === DEMO_PLAYER_ID
  );

  if ((scenario === "pick_submitted" || scenario === "survived" || scenario === "winner") && !viewerPick) {
    next.picks.push(
      pick("pick-r3-alex", DEMO_ROUND_3_ID, DEMO_PLAYER_ID, "team-ars", "pending")
    );
  }

  if (scenario === "survived") {
    next.rounds = next.rounds.map((round) =>
      round.id === DEMO_ROUND_3_ID ? { ...round, status: "completed" } : round
    );
    next.picks = next.picks.map((entry) => {
      if (entry.round_id !== DEMO_ROUND_3_ID) return entry;
      if (entry.player_id === DEMO_PLAYER_ID) return { ...entry, status: "through", reason: undefined };
      if (entry.player_id === "demo-user-009") return { ...entry, status: "through", reason: undefined };
      return { ...entry, status: "eliminated", reason: "loss" };
    });
  }

  if (scenario === "eliminated") {
    next.rounds = next.rounds.map((round) =>
      round.id === DEMO_ROUND_3_ID ? { ...round, status: "completed" } : round
    );
    next.picks = next.picks
      .filter((entry) => entry.round_id !== DEMO_ROUND_3_ID || entry.player_id !== DEMO_PLAYER_ID)
      .concat([
        pick("pick-r3-alex", DEMO_ROUND_3_ID, DEMO_PLAYER_ID, "team-ars", "eliminated", "draw"),
      ])
      .map((entry) => {
        if (entry.round_id !== DEMO_ROUND_3_ID || entry.player_id === DEMO_PLAYER_ID) return entry;
        if (entry.player_id === "demo-user-002") return { ...entry, status: "through", reason: undefined };
        return { ...entry, status: "eliminated", reason: "loss" };
      });
    next.memberships = next.memberships.map((entry) =>
      entry.player_id === DEMO_PLAYER_ID ? { ...entry, is_active: false } : entry
    );
  }

  if (scenario === "winner") {
    next.leagues = next.leagues.map((league) =>
      league.id === DEMO_LEAGUE_ID ? { ...league, status: "completed" } : league
    );
    next.rounds = next.rounds.map((round) =>
      round.id === DEMO_ROUND_3_ID ? { ...round, status: "completed" } : round
    );
    next.picks = next.picks.map((entry) => {
      if (entry.round_id !== DEMO_ROUND_3_ID) return entry;
      if (entry.player_id === DEMO_PLAYER_ID) return { ...entry, status: "through", reason: undefined };
      return { ...entry, status: "eliminated", reason: "loss" };
    });
    next.memberships = next.memberships.map((entry) =>
      entry.player_id === DEMO_PLAYER_ID
        ? { ...entry, is_active: true, final_position: 1 }
        : { ...entry, is_active: false }
    );
  }

  return next;
}

export function getMarketingDemoSnapshot(): DemoSnapshot {
  const state = readState();
  const base: DemoSnapshot = {
    leagues: [leagueBase()],
    rounds: demoRounds(),
    teams: demoTeams(),
    memberships: demoMembers(),
    picks: basePicks(),
    fixtures: demoFixtures(),
  };
  const seeded = withScenario(base, state.scenario);

  if (state.createdLeague) {
    const created = createdLeagueSnapshot(state.createdLeague);
    seeded.leagues.push(...created.leagues);
    seeded.rounds.push(...created.rounds);
    seeded.teams.push(...created.teams);
    seeded.memberships.push(...created.memberships);
    seeded.picks.push(...created.picks);
    seeded.fixtures.push(...created.fixtures);
  }

  seeded.leagues = seeded.leagues.map((league) => ({
    ...league,
    viewer_has_membership: state.joinedLeagueIds.includes(league.id),
    viewer_is_owner: league.created_by === DEMO_PLAYER_ID,
    viewer_role: league.created_by === DEMO_PLAYER_ID ? "owner" : "player",
    viewer_is_active:
      findMembership(league.id, DEMO_PLAYER_ID, seeded)?.is_active !== false,
    viewer_joined_at:
      findMembership(league.id, DEMO_PLAYER_ID, seeded)?.joined_at ?? DEFAULT_CREATED_AT,
  }));

  return seeded;
}

export function getMarketingDemoLeague(leagueId: string) {
  return getMarketingDemoSnapshot().leagues.find((league) => league.id === leagueId) ?? null;
}

export function getMarketingDemoRound(leagueId: string) {
  const snapshot = getMarketingDemoSnapshot();
  const league = snapshot.leagues.find((entry) => entry.id === leagueId);
  if (!league) return null;
  return (
    snapshot.rounds.find(
      (entry) =>
        entry.league_id === leagueId && entry.round_number === league.current_round
    ) ?? null
  );
}

export function getMarketingDemoRoundRows(leagueId: string) {
  return getMarketingDemoSnapshot().rounds.filter((entry) => entry.league_id === leagueId);
}

export function getMarketingDemoFixtures(roundId: string) {
  return getMarketingDemoSnapshot().fixtures.filter((entry) => entry.round_id === roundId);
}

export function getMarketingDemoUsedTeamIds(leagueId: string, playerId: string) {
  return new Set(
    getMarketingDemoSnapshot()
      .picks.filter((pickEntry) => pickEntry.league_id === leagueId && pickEntry.player_id === playerId)
      .map((pickEntry) => pickEntry.team_id)
      .filter(Boolean)
  );
}

export function submitMarketingDemoPick(teamId: string) {
  const next = readState();
  next.scenario = "pick_submitted";
  writeState(next);
  const snapshot = getMarketingDemoSnapshot();
  const currentRound = getMarketingDemoRound(DEMO_LEAGUE_ID);
  if (!currentRound) return null;
  return (
    snapshot.picks.find(
      (entry) =>
        entry.round_id === currentRound.id &&
        entry.player_id === DEMO_PLAYER_ID &&
        entry.team_id === teamId
    ) ?? null
  );
}

export function createMarketingDemoLeague(name: string) {
  return rememberCreatedDemoLeague(name);
}

export function findMembership(leagueId: string, playerId: string, snapshot = getMarketingDemoSnapshot()) {
  return (
    snapshot.memberships.find(
      (entry) => entry.league_id === leagueId && entry.player_id === playerId
    ) ?? null
  );
}

export function getMarketingDemoStartPath() {
  return `/private/join?code=${DEMO_JOIN_CODE}`;
}

export function getMarketingDemoJoinCode() {
  return DEMO_JOIN_CODE;
}

