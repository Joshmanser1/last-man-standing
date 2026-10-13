import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise both production creation handlers without network or database writes.
let isSiteAdmin = false;
let writes = [];
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  from(table) {
    let inserted;
    const result = () => ({
      data: inserted ?? (table === 'profiles' ? { display_name: 'League Host' }
        : table === 'site_admins' ? (isSiteAdmin ? { user_id: 'user-1' } : null)
        : table === 'memberships' ? [] : null),
      error: null,
    });
    return {
      select() { return this; }, eq() { return this; }, is() { return this; }, limit() { return this; },
      insert(value) { inserted = value; writes.push({ table, value }); return this; },
      maybeSingle: async () => result(),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  },
};
async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['@supabase/supabase-js'], logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(
    () => ({ createClient: () => client }), module, module.exports);
  return module.exports.default;
}
process.env.SUPABASE_URL = 'http://unused.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.SUPABASE_ANON_KEY = 'test-only';
process.env.VITE_SUPABASE_ANON_KEY = 'test-only';
const deadline = '2030-01-01T11:00:00Z';
globalThis.fetch = async (url) => {
  if (url.endsWith('/bootstrap-static/')) {
    return { ok: true, json: async () => ({ teams: [], events: [{ id: 1, deadline_time: deadline }] }) };
  }
  assert.ok(url.endsWith('/fixtures/?event=1'), `Unexpected fetch: ${url}`);
  return { ok: true, json: async () => [] };
};
const create = await bundle('api/create-league.ts');
const admin = await bundle('api/admin.ts');
async function call(handler, body) {
  writes = [];
  let response;
  const res = { statusCode: 0, setHeader() {},
    end(value) { response = { status: this.statusCode, body: JSON.parse(value) }; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const leagues = writes.filter(write => write.table === 'leagues');
  assert.equal(leagues.length, 1);
  const league = leagues[0].value;
  // Creation still sets up the owner and the upcoming first round as before.
  assert.ok(writes.some(write => write.table === 'memberships' && write.value.role === 'owner'));
  const round = writes.find(write => write.table === 'rounds').value;
  assert.equal(round.league_id, league.id);
  assert.equal(round.status, 'upcoming');
  assert.equal(league.status, 'upcoming');
  assert.equal(league.current_round, 1);
  if (!league.is_test) assert.equal(round.pick_deadline_utc, deadline);
  return league;
}
const base = { name: 'League', start_date_utc: deadline, fpl_start_event: 1, join_code: 'HOST01' };
for (const siteAdmin of [false, true]) {
  isSiteAdmin = siteAdmin;
  for (const isPublic of [false, true]) {
    for (const isTest of [undefined, false, true]) {
      for (const automation of [undefined, false, true]) {
        const league = await call(create, { ...base, is_public: isPublic,
          ...(isTest === undefined ? {} : { is_test: isTest }),
          ...(automation === undefined ? {} : { automation_enabled: automation }) });
        assert.equal(league.is_test, isTest === true);
        assert.equal(league.is_public, isPublic);
        assert.equal(league.automation_enabled, isTest !== true,
          'Real leagues must enable automation; tests must remain manual, regardless of client flags');
      }
    }
  }
}
isSiteAdmin = true;
for (const isPublic of [false, true]) {
  for (const automation of [undefined, false, true]) {
    const league = await call(admin, { ...base, action: 'create-founder-league', is_public: isPublic,
      ...(automation === undefined ? {} : { automation_enabled: automation }) });
    assert.equal(league.is_public, isPublic);
    assert.equal(league.is_test, false);
    assert.equal(league.automation_enabled, true);
  }
}
console.log('PASS: real private/public and admin founder leagues enable automation; test leagues remain manual; client flags cannot override either default.');
