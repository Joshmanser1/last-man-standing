import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create table public.memberships (id uuid primary key);
`);
await db.exec(await readFile("sql/2026-09-30-attribution-tracking.sql", "utf8"));
const membershipColumns = await db.query(`
  select column_name from information_schema.columns
  where table_schema = 'public' and table_name = 'memberships'
`);
assert.ok(membershipColumns.rows.some(row => row.column_name === "first_utm_source"));
assert.ok(membershipColumns.rows.some(row => row.column_name === "join_attribution_at"));
assert.equal((await db.query("select count(*)::int as count from league_tracking_links")).rows[0].count, 0);
await db.close();

async function bundle(entryPoint, requireImpl = () => ({})) {
  const { outputFiles } = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["@supabase/supabase-js"],
    logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputFiles[0].text)(requireImpl, module, module.exports);
  return module.exports;
}

const stored = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: key => stored.delete(key),
  clear: () => stored.clear(),
};

const attribution = await bundle("src/lib/attribution.ts");
const oocfm = "?utm_source=oocfm&utm_medium=creator&utm_campaign=oocfm_lms_1&utm_content=launch";
const the44 = "?code=THE44&utm_source=the44&utm_medium=creator&utm_campaign=the44_lms_1&utm_content=launch";

attribution.captureAttribution("/", oocfm);
let result = attribution.getAttributionForJoin("OOCFM");
assert.equal(result.firstAttribution.source, "oocfm");
assert.equal(result.joinAttribution, null);

attribution.captureAttribution("/private/join", `?code=OOCFM&${oocfm.slice(1)}`);
result = attribution.getAttributionForJoin("OOCFM");
assert.equal(result.firstAttribution.source, "oocfm");
assert.equal(result.joinAttribution.source, "oocfm");
assert.equal(result.joinAttribution.joinCode, "OOCFM");

attribution.captureAttribution("/private/join", the44);
result = attribution.getAttributionForJoin("THE44");
assert.equal(result.firstAttribution.source, "oocfm", "later campaigns must not overwrite first touch");
assert.equal(result.joinAttribution.source, "the44", "join touch follows the current tracked competition");
assert.equal(attribution.getAttributionForJoin("UNRELATED").joinAttribution, null, "stale join touch must not cross leagues");

stored.clear();
attribution.captureAttribution("/private/join", "?code=DIRECT");
assert.deepEqual(attribution.getAttributionForJoin("DIRECT"), {
  firstAttribution: null,
  joinAttribution: null,
});

let insertedMembership = null;
let existingMembership = null;
const trackingLinks = {
  oocfm: {
    join_code: "REAL & CODE",
    utm_source: "oocfm",
    utm_medium: "creator partner",
    utm_campaign: "oocfm_lms_1",
    utm_content: "launch/one",
    active: true,
  },
};

const client = {
  auth: {
    getUser: async () => ({
      data: { user: { id: "user-1", email: "player@example.test" } },
      error: null,
    }),
  },
  from(table) {
    const filters = new Map();
    let insertValue = null;
    let updateValue = null;
    const query = {
      select() { return this; },
      eq(column, value) { filters.set(column, value); return this; },
      limit() { return this; },
      insert(value) { insertValue = value; insertedMembership = value; return this; },
      update(value) { updateValue = value; return this; },
      async maybeSingle() {
        if (table === "league_tracking_links") {
          const link = trackingLinks[filters.get("slug")];
          return { data: link?.active && filters.get("active") === true ? link : null, error: null };
        }
        if (table === "profiles") {
          return { data: { id: "user-1", display_name: "Alex Morgan", email: "player@example.test" }, error: null };
        }
        if (table === "site_admins") return { data: { user_id: "user-1" }, error: null };
        if (table === "leagues") {
          return { data: { id: "league-1", is_public: false, is_test: true, status: "upcoming", deleted_at: null }, error: null };
        }
        if (table === "memberships" && insertValue) {
          return { data: { id: "membership-1", ...insertValue }, error: null };
        }
        if (table === "memberships" && updateValue) {
          return { data: { ...existingMembership, ...updateValue }, error: null };
        }
        if (table === "memberships") return { data: existingMembership, error: null };
        throw new Error(`Unexpected table: ${table}`);
      },
    };
    return query;
  },
};

const joinHandler = (await bundle("api/join-league.ts", name => {
  assert.equal(name, "@supabase/supabase-js");
  return { createClient: () => client };
})).default;

Object.assign(process.env, {
  SUPABASE_URL: "https://unused.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  SUPABASE_ANON_KEY: "anon-key",
});

async function call(method, { body, query } = {}) {
  let responseBody = "";
  const headers = {};
  const res = {
    statusCode: 0,
    setHeader(name, value) { headers[name] = value; },
    end(value = "") { responseBody = value; },
  };
  await joinHandler({ method, headers: { authorization: "Bearer token" }, body, query }, res);
  return {
    status: res.statusCode,
    headers,
    body: responseBody ? JSON.parse(responseBody) : null,
  };
}

const redirect = await call("GET", { query: { tracking_slug: "oocfm" } });
assert.equal(redirect.status, 302);
const redirectUrl = new URL(redirect.headers.Location, "https://lms.fantasycommandcentre.co.uk");
assert.equal(redirectUrl.pathname, "/private/join");
assert.equal(redirectUrl.searchParams.get("code"), "REAL & CODE");
assert.equal(redirectUrl.searchParams.get("utm_medium"), "creator partner");
assert.equal(redirectUrl.searchParams.get("utm_content"), "launch/one");
assert.equal((await call("GET", { query: { tracking_slug: "unknown" } })).headers.Location, "/private/join");

const baseJoin = { join_code: "CODE" };
insertedMembership = null;
assert.equal((await call("POST", { body: baseJoin })).status, 200);
assert.equal(Object.keys(insertedMembership).some(key => key.includes("utm") || key.includes("attribution")), false);

insertedMembership = null;
const capturedAt = "2026-09-30T08:00:00.000Z";
const attributedJoin = await call("POST", {
  body: {
    ...baseJoin,
    firstAttribution: { source: "  oocfm  ", medium: "creator", campaign: "oocfm_lms_1", content: "launch", capturedAt },
    joinAttribution: { source: "the44", medium: "creator", campaign: "the44_lms_1", content: "launch", joinCode: "code", capturedAt },
  },
});
assert.equal(attributedJoin.status, 200);
assert.equal(insertedMembership.first_utm_source, "oocfm");
assert.equal(insertedMembership.join_utm_source, "the44");
assert.equal(insertedMembership.first_attribution_at, capturedAt);

insertedMembership = null;
await call("POST", {
  body: {
    ...baseJoin,
    firstAttribution: { source: 42, campaign: "valid", capturedAt: "invalid" },
    joinAttribution: { source: "stale", joinCode: "OTHER", capturedAt },
  },
});
assert.equal(insertedMembership.first_utm_source, undefined);
assert.equal(insertedMembership.first_utm_campaign, "valid");
assert.equal(insertedMembership.first_attribution_at, undefined);
assert.equal(insertedMembership.join_utm_source, undefined);

existingMembership = {
  id: "membership-existing",
  league_id: "league-1",
  player_id: "user-1",
  first_utm_source: "original",
  join_utm_source: "original-join",
  is_active: false,
};
insertedMembership = null;
const existingResult = await call("POST", {
  body: {
    ...baseJoin,
    firstAttribution: { source: "replacement", capturedAt },
    joinAttribution: { source: "replacement", joinCode: "CODE", capturedAt },
  },
});
assert.equal(existingResult.status, 200);
assert.equal(existingResult.body.first_utm_source, "original");
assert.equal(existingResult.body.join_utm_source, "original-join");
assert.equal(insertedMembership, null);

console.log("PASS: first-touch immutability, join-code binding, redirect encoding, optional attribution, malformed input safety, existing membership preservation.");
