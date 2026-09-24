import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

// Runs the actual migration and API against ephemeral PostgreSQL, never Supabase.
const db = new PGlite();
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  insert into auth.users values ('${alice}', 'alice@example.test', now()), ('${bob}', 'bob@example.test', now());
`);
await db.exec(await readFile('sql/2026-09-24-marketing-consent.sql', 'utf8'));
const { outputFiles } = await build({ entryPoints: ['api/marketing-preferences.ts'], bundle: true,
  write: false, platform: 'node', format: 'cjs', external: ['@supabase/supabase-js'], logLevel: 'silent' });
const client = {
  auth: { getUser: async token => ({ data: { user: (await db.query('select * from auth.users where id::text = $1', [token])).rows[0] }, error: null }) },
  from(table) {
    assert.equal(table, 'marketing_preferences');
    let id;
    return { select() { return this; }, eq(column, value) { assert.equal(column, 'user_id'); id = value; return this; },
      async maybeSingle() { return { data: (await db.query('select * from public.marketing_preferences where user_id = $1', [id])).rows[0] ?? null, error: null }; } };
  },
  async rpc(name, args) {
    assert.equal(name, 'set_marketing_preference');
    try {
      const result = await db.query('select public.set_marketing_preference($1, $2, $3, $4) as preference',
        [args.p_user_id, args.p_opt_in, args.p_capture_source, args.p_consent_version]);
      return { data: result.rows[0].preference, error: null };
    } catch (error) { return { data: null, error }; }
  },
};
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(() => ({ createClient: () => client }), module, module.exports);
const handler = module.exports.default;
Object.assign(process.env, { SUPABASE_URL: 'http://unused.invalid', SUPABASE_ANON_KEY: 'test', SUPABASE_SERVICE_ROLE_KEY: 'test' });
delete process.env.VITE_ENABLE_MARKETING_DEMO;
async function call(method, body, token = alice) {
  let result;
  const res = { statusCode: 0, setHeader() {}, end(value) { result = { status: this.statusCode, body: JSON.parse(value) }; } };
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return result;
}
const payload = (optIn, source = 'pick_confirmation') => ({ marketing_opt_in: optIn, capture_source: source, consent_version: 'fcc_marketing_v1' });
const events = async () => (await db.query('select * from marketing_consent_events where user_id = $1 order by created_at, id', [alice])).rows;
try {
  assert.equal((await call('GET', undefined, '')).status, 401);
  assert.equal((await call('GET', undefined, 'bad-token')).status, 401);
  const initial = await call('GET');
  assert.equal(initial.body.eligible, false); assert.equal(initial.body.has_preference, false);
  assert.equal((await events()).length, 0);
  assert.equal((await call('POST', payload(true, 'creator_export'))).status, 400);
  assert.equal((await call('POST', { ...payload(true), consent_version: 'old' })).status, 409);
  assert.equal((await call('POST', { ...payload(true), marketing_opt_in: 'true' })).status, 400);
  assert.equal((await call('POST', '{broken')).status, 400);

  const subscribed = await call('POST', { ...payload(true), user_id: bob, email: 'forged@example.test', consent_wording: 'forged' });
  assert.equal(subscribed.body.eligible, true);
  let history = await events(); assert.equal(history.length, 1);
  assert.equal(history[0].user_id, alice);
  assert.equal(history[0].authenticated_email, 'alice@example.test');
  assert.equal(history[0].capture_source, 'pick_confirmation');
  assert.equal(history[0].consent_version, 'fcc_marketing_v1');
  assert.equal(history[0].consent_wording, 'Email me about new FCC competitions, creator leagues and prize competitions.');
  assert.ok(history[0].created_at);
  assert.equal((await call('GET', { user_id: alice }, bob)).body.has_preference, false);
  await Promise.all([call('POST', payload(true)), call('POST', payload(true))]);
  assert.equal((await events()).length, 1);
  assert.equal((await call('POST', payload(false, 'email_preferences'))).body.eligible, false);
  assert.deepEqual((await events()).map(e => e.action), ['opt_in', 'opt_out']);
  await call('POST', payload(false, 'email_preferences'));
  assert.equal((await events()).length, 2);
  await call('POST', payload(true, 'email_preferences'));
  assert.deepEqual((await events()).map(e => e.action), ['opt_in', 'opt_out', 'opt_in']);
  assert.deepEqual((await events())[0], history[0]);

  await db.query('update auth.users set email = $1 where id = $2', ['changed@example.test', alice]);
  const changed = await call('GET');
  assert.equal(changed.body.eligible, false); assert.equal(changed.body.email_changed, true);
  assert.equal((await events()).length, 3, 'GET does not mutate');
  await call('POST', payload(true, 'email_preferences'));
  assert.equal((await events()).length, 4);
  assert.equal((await events())[3].authenticated_email, 'changed@example.test');
  assert.equal((await events())[0].authenticated_email, 'alice@example.test');
  await db.query('update auth.users set email_confirmed_at = null where id = $1', [alice]);
  assert.equal((await call('GET')).body.eligible, false);
  assert.equal((await call('POST', payload(true))).status, 422);
  assert.equal((await call('POST', payload(false))).status, 200, 'Withdrawal remains possible without verified email');
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [alice]);

  // Deliberately fail the second write: no orphan consent event may survive.
  const beforeFailure = (await events()).length;
  await db.exec(`create function public.fail_preference_test() returns trigger language plpgsql as $$ begin raise exception 'test failure'; end $$;
    create trigger fail_preference_test before insert or update on marketing_preferences for each row execute function public.fail_preference_test();`);
  assert.equal((await call('POST', payload(true))).status, 503);
  assert.equal((await events()).length, beforeFailure);
  await db.exec('drop trigger fail_preference_test on marketing_preferences; drop function public.fail_preference_test();');

  await call('POST', payload(true), bob);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${alice}', false);`);
  assert.deepEqual((await db.query('select user_id from marketing_preferences')).rows.map(r => r.user_id), [alice]);
  assert.equal((await db.query('select * from marketing_preferences where user_id = $1', [bob])).rows.length, 0);
  await assert.rejects(db.query('update marketing_preferences set marketing_opt_in = true'));
  await assert.rejects(db.query('select * from marketing_consent_events'));
  await assert.rejects(db.query('delete from marketing_consent_events'));
  await assert.rejects(db.query("select set_marketing_preference($1,true,'email_preferences','fcc_marketing_v1')", [alice]));
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select * from marketing_preferences'));
  await db.exec('reset role; set role service_role;');
  await assert.rejects(db.query("update marketing_consent_events set action = 'opt_out'"));
  await assert.rejects(db.query('delete from marketing_consent_events'));
  await db.query("select set_marketing_preference($1,false,'email_preferences','fcc_marketing_v1')", [bob]);
  await assert.rejects(db.query("select set_marketing_preference($1,true,'forged','fcc_marketing_v1')", [bob]));
  await assert.rejects(db.query("select set_marketing_preference($1,true,'email_preferences','old')", [bob]));
  await db.exec('reset role;');
  process.env.VITE_ENABLE_MARKETING_DEMO = 'true';
  assert.equal((await call('POST', payload(true))).status, 403);
  delete process.env.VITE_ENABLE_MARKETING_DEMO;
  console.log('PASS: actual SQL/API consent lifecycle, identity spoofing, exact evidence, idempotence, rollback, changed/unverified email, RLS, immutable grants and recording guard.');
} finally { await db.close(); }
