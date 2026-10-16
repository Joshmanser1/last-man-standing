import assert from 'node:assert/strict';
import { build } from 'esbuild';

let state;
let checks = 0;
const userId = 'user-1';
const deadline = '2099-01-01T12:00:00.000Z';
const client = {
  auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  from(table) {
    const filters = [];
    let columns = '*';
    let inserted;
    let updated;
    let maximum = Infinity;
    let result;
    const relatedValue = (row, column) => column.startsWith('leagues.')
      ? state.tables.leagues.find(league => league.id === row.league_id)?.[column.slice(8)]
      : row[column];
    const resolve = () => {
      if (result) return result;
      const records = state.tables[table];
      assert.ok(records, `Unexpected table: ${table}`);
      if (table === 'memberships' && columns === 'league_id, role, leagues!inner(is_public)') state.quotaReads++;
      let rows = records.filter(row => filters.every(([column, value]) => relatedValue(row, column) === value));
      if (inserted) {
        rows = [structuredClone(inserted)];
        rows[0].id ??= `inserted-${state.writes.length}`;
        if (table === 'memberships') {
          assert.ok(!records.some(row => row.league_id === inserted.league_id && row.player_id === inserted.player_id), 'Duplicate membership insert');
        }
        records.push(...rows);
        state.writes.push({ table, insert: structuredClone(inserted) });
      }
      if (updated) {
        for (const row of rows) Object.assign(row, updated);
        state.writes.push({ table, update: structuredClone(updated) });
      }
      result = { data: rows.slice(0, maximum).map(row => {
        if (columns === '*') return structuredClone(row);
        return Object.fromEntries(columns.split(/,(?![^()]*\))/).map(column => {
          const field = column.trim();
          return field.startsWith('leagues!inner')
            ? ['leagues', state.tables.leagues.find(league => league.id === row.league_id)]
            : [field, row[field]];
        }));
      }), error: null };
      return result;
    };
    return {
      select(value) { columns = value; return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      is(column, value) { filters.push([column, value]); return this; },
      limit(value) { maximum = value; return this; },
      insert(value) { inserted = value; return this; },
      update(value) { updated = value; return this; },
      async maybeSingle() {
        const response = resolve();
        assert.ok(response.data.length <= 1, `Multiple rows for ${table}`);
        return { ...response, data: response.data[0] ?? null };
      },
      then(onResolve, onReject) { return Promise.resolve().then(resolve).then(onResolve, onReject); },
    };
  },
};

async function bundle(entryPoint) {
  const { outputFiles } = await build({ entryPoints: [entryPoint], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['@supabase/supabase-js'], logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputFiles[0].text)(name => {
    assert.equal(name, '@supabase/supabase-js');
    return { createClient: () => client };
  }, module, module.exports);
  return module.exports.default;
}

const join = await bundle('api/join-league.ts');
const create = await bundle('api/create-league.ts');
Object.assign(process.env, {
  SUPABASE_URL: 'https://unused.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only', SUPABASE_ANON_KEY: 'test-only',
});
globalThis.fetch = async url => {
  state.fetches++;
  if (url.endsWith('/bootstrap-static/')) return { ok: true, json: async () => ({ teams: [], events: [{ id: 1, deadline_time: deadline }] }) };
  assert.ok(url.endsWith('/fixtures/?event=1'), `Unexpected fetch: ${url}`);
  return { ok: true, json: async () => [] };
};

function reset() {
  const leagues = ['A', 'B', 'C'].map(id => ({ id, name: id, join_code: `CODE${id}`,
    is_public: false, is_test: false, status: 'upcoming', deleted_at: null,
    managed_theme: id === 'B' ? { managed: true, enabled: true } : null }));
  state = {
    user: { id: userId, email: 'player@example.test' }, writes: [], quotaReads: 0, fetches: 0,
    tables: {
      leagues, profiles: [{ id: userId, display_name: 'Alex Morgan' }], site_admins: [],
      memberships: [{ id: 'membership-A', league_id: 'A', player_id: userId, role: 'player', is_active: true }],
      rounds: leagues.map(league => ({ id: `round-${league.id}`, league_id: league.id,
        round_number: 1, status: 'upcoming', pick_deadline_utc: deadline })),
      league_tracking_links: [{ slug: 'creator', active: true, join_code: 'CODEB',
        utm_source: 'creator', utm_medium: 'social', utm_campaign: 'launch', utm_content: 'video' }],
    },
  };
}

async function call(handler, body, { method = 'POST', query, authenticated = true } = {}) {
  let response;
  const headers = {};
  const res = { statusCode: 0, setHeader(name, value) { headers[name] = value; },
    end(value) { response = { status: this.statusCode, headers, body: value ? JSON.parse(value) : null }; } };
  await handler({ method, headers: authenticated ? { authorization: 'Bearer test' } : {}, body, query }, res);
  return response;
}

async function check(name, run) {
  reset();
  await run();
  checks++;
  console.log(`PASS: ${name}`);
}

for (const body of [{ join_code: 'CODEB' }, { league_id: 'B' }]) {
  await check(`managed join with existing private membership: ${JSON.stringify(body)}`, async () => {
    const response = await call(join, body);
    assert.equal(response.status, 200);
    assert.equal(response.body.league_id, 'B');
    assert.equal(response.body.membership_created, true);
    assert.equal(state.quotaReads, 0);
    assert.equal(state.tables.memberships.length, 2);
    assert.equal(state.tables.memberships[0].id, 'membership-A');
    assert.equal(state.tables.memberships[0].is_active, true);
  });
}

for (const theme of [null, {}, { managed: false }, { managed: 'true' }, { enabled: true }]) {
  await check(`ordinary quota remains for ${JSON.stringify(theme)}`, async () => {
    state.tables.leagues[2].managed_theme = theme;
    const response = await call(join, { join_code: 'CODEC', managed_theme: { managed: true } });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Already an active member of another private league');
    assert.equal(state.quotaReads, 1);
    assert.deepEqual(state.writes, []);
  });
}

await check('managed membership still counts toward the unchanged ordinary quota', async () => {
  state.tables.memberships[0].league_id = 'B';
  assert.equal((await call(join, { join_code: 'CODEC' })).status, 409);
});

await check('joining managed B does not allow the same user to join ordinary C', async () => {
  assert.equal((await call(join, { join_code: 'CODEB' })).status, 200);
  const response = await call(join, { join_code: 'CODEC' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Already an active member of another private league');
  assert.deepEqual(state.tables.memberships.map(member => member.league_id), ['A', 'B']);
});

await check('managed flag does not require branding to be enabled', async () => {
  state.tables.leagues[1].managed_theme = { managed: true, enabled: false };
  assert.equal((await call(join, { join_code: 'CODEB' })).status, 200);
});

await check('invalid invite code still rejects a supplied managed flag', async () => {
  const response = await call(join, { join_code: 'INVALID', managed_theme: { managed: true } });
  assert.equal(response.status, 404);
  assert.deepEqual(state.writes, []);
});

await check('test league still bypasses quota and closed-round checks', async () => {
  state.tables.leagues[2].is_test = true;
  state.tables.rounds[2].status = 'locked';
  assert.equal((await call(join, { join_code: 'CODEC' })).status, 200);
  assert.equal(state.quotaReads, 0);
});

await check('site admin still bypasses the ordinary join quota', async () => {
  state.tables.site_admins.push({ user_id: userId });
  assert.equal((await call(join, { join_code: 'CODEC' })).status, 200);
  assert.equal(state.quotaReads, 0);
});

await check('site admin still cannot join a closed managed league', async () => {
  state.tables.site_admins.push({ user_id: userId });
  state.tables.rounds[1].status = 'locked';
  assert.equal((await call(join, { join_code: 'CODEB' })).status, 409);
  assert.deepEqual(state.writes, []);
});

await check('ordinary first join still succeeds when no active non-owner membership exists', async () => {
  state.tables.memberships[0].is_active = false;
  assert.equal((await call(join, { join_code: 'CODEC' })).status, 200);
});

for (const isActive of [false, true]) {
  await check(`existing target membership is reused without replacing attribution or role (active: ${isActive})`, async () => {
    const original = { id: 'membership-B', league_id: 'B', player_id: userId, role: 'owner',
      is_active: isActive, first_utm_source: 'original', join_utm_source: 'original-join' };
    state.tables.memberships.push({ ...original });
    const response = await call(join, { join_code: 'CODEB', firstAttribution: { source: 'replacement' },
      joinAttribution: { source: 'replacement', joinCode: 'CODEB' } });
    assert.equal(response.status, 200);
    assert.equal(response.body.membership_created, false);
    assert.deepEqual(state.tables.memberships[1], { ...original, is_active: true });
    assert.deepEqual(state.writes, [{ table: 'memberships', update: { is_active: true } }]);
  });
}

for (const closed of ['locked', 'completed', 'deadline', 'league-completed', 'deleted']) {
  await check(`closed managed league still rejects: ${closed}`, async () => {
    if (closed === 'deadline') state.tables.rounds[1].pick_deadline_utc = '2000-01-01T00:00:00Z';
    else if (closed === 'league-completed') state.tables.leagues[1].status = 'completed';
    else if (closed === 'deleted') state.tables.leagues[1].deleted_at = '2000-01-01T00:00:00Z';
    else state.tables.rounds[1].status = closed;
    const response = await call(join, { join_code: 'CODEB' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Joining is closed because Round 1 has already started.');
    assert.deepEqual(state.writes, []);
  });
}

await check('managed join still requires authentication', async () => {
  assert.equal((await call(join, { join_code: 'CODEB' }, { authenticated: false })).status, 401);
  state.user = null;
  assert.equal((await call(join, { join_code: 'CODEB' })).status, 401);
  assert.deepEqual(state.writes, []);
});

await check('tracked managed join keeps first and join attribution with code binding', async () => {
  const redirect = await call(join, undefined, { method: 'GET', query: { tracking_slug: 'creator' } });
  assert.equal(redirect.status, 302);
  const destination = new URL(redirect.headers.Location, 'https://example.test');
  assert.equal(destination.pathname, '/private/join');
  assert.equal(destination.searchParams.get('code'), 'CODEB');
  assert.equal(destination.searchParams.get('utm_source'), 'creator');
  const capturedAt = '2026-10-01T12:00:00.000Z';
  const response = await call(join, { join_code: 'CODEB',
    firstAttribution: { source: 'first', medium: 'social', capturedAt },
    joinAttribution: { source: 'creator', campaign: 'launch', joinCode: 'CODEB', capturedAt } });
  assert.equal(response.status, 200);
  assert.equal(response.body.first_utm_source, 'first');
  assert.equal(response.body.join_utm_source, 'creator');
  assert.equal(response.body.join_utm_campaign, 'launch');
  assert.equal(response.body.first_attribution_at, capturedAt);
  assert.equal(response.body.join_attribution_at, capturedAt);
});

await check('mismatched managed join attribution remains excluded', async () => {
  const response = await call(join, { join_code: 'CODEB', joinAttribution: { source: 'wrong', joinCode: 'CODEC' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.join_utm_source, undefined);
});

const createBody = { name: 'New League', start_date_utc: deadline, fpl_start_event: 1, join_code: 'NEWCODE' };
await check('host-one restriction still blocks an existing private owner', async () => {
  state.tables.memberships[0].role = 'owner';
  const response = await call(create, { ...createBody, managed_theme: { managed: true } });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'User already owns an active private league');
  assert.equal(state.fetches, 0);
  assert.deepEqual(state.writes, []);
});

await check('host-one still allows a first league despite an existing joined league', async () => {
  const response = await call(create, createBody);
  assert.equal(response.status, 200);
  assert.equal(state.tables.memberships.filter(member => member.role === 'owner').length, 1);
  assert.equal(state.tables.memberships[0].role, 'player');
});

console.log(`PASS: ${checks} managed-quota regression checks; no network or database writes.`);
