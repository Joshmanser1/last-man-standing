import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Real handler, fake database/auth boundary. No external requests or writes.
let priorCount, priorError, saveError, authenticated, saved;
const client = {
  auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'player' } : null } }) },
  from(table) {
    let countQuery = false, writing = false;
    const result = () => {
      if (countQuery) return { count: priorCount, error: priorError ? { message: 'Unavailable' } : null };
      if (writing) { saved++; return { data: saveError ? null : { id: 'saved-pick', team_id: 'team' }, error: saveError ? { message: 'Save rejected' } : null }; }
      return { data: table === 'leagues' ? { id: 'league', current_round: 1, status: 'active', is_test: false }
        : table === 'memberships' ? { id: 'member' }
        : table === 'rounds' ? { id: 'round', league_id: 'league', round_number: 1, status: 'upcoming', pick_deadline_utc: '2099-01-01' }
        : table === 'teams' ? { id: 'team' } : null, error: null };
    };
    return {
      select(_fields, options) { countQuery = options?.head === true; return this; },
      eq() { return this; }, neq() { return this; }, limit() { return this; },
      upsert() { writing = true; return this; },
      maybeSingle: async () => result(),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
  },
};
const { outputFiles } = await build({ entryPoints: ['api/submit-pick.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['@supabase/supabase-js'], logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(() => ({ createClient: () => client }), module, module.exports);
process.env.SUPABASE_URL = 'http://unused.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_ANON_KEY = 'test-only';
for (const scenario of ['first', 'duplicate', 'later', 'unknown', 'failed', 'anonymous']) {
  priorCount = scenario === 'duplicate' ? 1 : scenario === 'later' ? 3 : 0;
  priorError = scenario === 'unknown'; saveError = scenario === 'failed'; authenticated = scenario !== 'anonymous'; saved = 0;
  let response;
  const res = { statusCode: 0, setHeader() {}, end(value) { response = { status: this.statusCode, body: JSON.parse(value) }; } };
  await module.exports.default({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { league_id: 'league', round_id: 'round', team_id: 'team' } }, res);
  assert.equal(response.status, scenario === 'failed' ? 502 : scenario === 'anonymous' ? 401 : 200, scenario);
  assert.equal(response.body.first_pick_submitted, ['failed', 'anonymous'].includes(scenario) ? undefined : scenario === 'first', scenario);
  assert.equal(saved, scenario === 'anonymous' ? 0 : 1, scenario);
}
console.log('PASS: first pick, duplicate/update, later pick, unavailable reporting, failed save and unauthenticated submission');

// Exercise the actual X helper with a controllable consent boundary and SDK spy.
const storage = new Map();
globalThis.sessionStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
globalThis.__consented = true;
async function helper(eventId) {
  const built = await build({ entryPoints: ['src/lib/xPixel.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    define: { 'import.meta.env': JSON.stringify({ VITE_X_FIRST_PICK_EVENT_ID: eventId }) },
    plugins: [{ name: 'consent-boundary', setup(b) {
      b.onResolve({ filter: /advertisingConsent$/ }, () => ({ path: 'consent', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const advertisingTrackingAllowed = () => globalThis.__consented;' }));
    } }], logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', built.outputFiles[0].text)(m, m.exports);
  return m.exports.trackXFirstPick;
}
const events = [];
globalThis.window = { fccXPixelInitialized: true, twq: (...args) => events.push(args) };
const track = await helper('tw-rhi65-testonly');
const first = { id: 'opaque-saved-pick', first_pick_submitted: true };
for (const eventId of [undefined, '', 'tw-other-wrong', 'not-an-event']) await (await helper(eventId))(first);
assert.equal(events.length, 0, 'missing/invalid configuration stays off');
globalThis.__consented = false;
await track(first);
assert.equal(events.length, 0, 'no consent');
globalThis.__consented = true;
for (const result of [null, {}, { id: 'x' }, { ...first, first_pick_submitted: false }]) await track(result);
assert.equal(events.length, 0, 'no confirmed first pick');
await Promise.all([track(first), track(first)]);
assert.equal(events.length, 1, 'concurrent completion is deduplicated');
assert.deepEqual(events[0].slice(0, 2), ['event', 'tw-rhi65-testonly']);
assert.deepEqual(Object.keys(events[0][2]), ['conversion_id']);
assert.match(events[0][2].conversion_id, /^[a-f0-9]{64}$/);
await (await helper('tw-rhi65-testonly'))(first);
assert.equal(events.length, 1, 'reload session marker');
globalThis.__consented = false;
await track({ ...first, id: 'after-withdrawal' });
assert.equal(events.length, 1, 'withdrawal blocks subsequent events');
console.log('PASS: missing configuration, consent, withdrawal, metadata validation, concurrency, reload and minimal parameters');
