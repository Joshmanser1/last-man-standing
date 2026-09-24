import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Execute the real API handlers with an in-memory Supabase boundary.
// No network, credentials or database writes are used.
let profile, profileWrites, memberships, fetches;
const client = {
  auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'user@example.test' } } }) },
  from(table) {
    let inserted = false;
    const result = () => ({ data: table === 'profiles' ? profile
      : table === 'leagues' ? { id: 'league-1', is_test: true }
      : table === 'memberships' && inserted ? { league_id: 'league-1' } : null, error: null });
    const query = {
      select() { return this; }, eq() { return this; }, is() { return this; }, limit() { return this; },
      maybeSingle: async () => result(),
      upsert(value) { assert.equal(table, 'profiles'); profile = value; profileWrites++; return this; },
      insert() { assert.equal(table, 'memberships'); assert.ok(profile?.display_name); memberships++; inserted = true; return this; },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return query;
  },
};
async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['@supabase/supabase-js'], logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(() => ({ createClient: () => client }), module, module.exports);
  return module.exports;
}
const { validDisplayName, displayNameOrFallback } = await bundle('src/lib/displayName.ts');
const create = (await bundle('api/create-league.ts')).default;
const join = (await bundle('api/join-league.ts')).default;
process.env.SUPABASE_URL = 'http://unused.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
process.env.SUPABASE_ANON_KEY = 'test-only';
globalThis.fetch = async () => { fetches++; throw new Error('FPL boundary reached'); };
function reset(name) { profile = name === undefined ? null : { id: 'user-1', display_name: name }; profileWrites = memberships = fetches = 0; }
async function call(handler, body) {
  let response;
  const res = { statusCode: 0, setHeader() {}, end(value) { response = { status: this.statusCode, body: JSON.parse(value) }; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res);
  return response;
}
const invalid = [undefined, null, '', '   ', 'You', 'Manager', 'Player', 'User', 'Name', 'No Name', 'Unknown'];
for (const name of invalid) {
  assert.equal(validDisplayName(name), null);
  assert.equal(displayNameOrFallback(name), 'Unknown');
  reset(name);
  const result = await call(create, { name: 'League', start_date_utc: '2030-01-01', fpl_start_event: 1, is_test: true });
  assert.equal(result.status, 422);
  assert.equal(result.body.code, 'profile_required');
  assert.equal(memberships + profileWrites + fetches, 0);
  assert.equal((await call(join, { join_code: 'CODE' })).body.code, 'profile_required');
  const joined = await call(join, { join_code: 'CODE', display_name: '  Renée O’Connor  ' });
  assert.equal(joined.status, 200);
  assert.equal(profile.display_name, 'Renée O’Connor');
  assert.equal(profileWrites, 1);
  assert.equal(memberships, 1);
}
for (const name of ['李', 'Q', 'Renée O’Connor', 'Mary-Jane']) assert.equal(validDisplayName(name), name);
reset('Existing Name');
assert.equal((await call(join, { join_code: 'CODE', display_name: 'Different Name' })).status, 200);
assert.equal(profile.display_name, 'Existing Name');
assert.equal(profileWrites, 0);
await call(create, { name: 'League', start_date_utc: '2030-01-01', fpl_start_event: 1, is_test: true });
assert.equal(fetches, 1, 'Valid profile passes the host guard');
console.log('PASS: canonical validation, invalid host rejection before writes, join repair/persistence order, valid-name preservation.');
