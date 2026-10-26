import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { deliveryFailure, ResendDeliveryError, reminderInWindow } = await load('server/email/retryPolicy.ts');
const { createResendTransport } = await load('server/email/resendTransport.ts');
const { processServiceEmails } = await load('server/email/serviceEmailProcessor.ts');
const { createSupabaseServiceEmailRepository } = await load('server/email/supabaseServiceEmailRepository.ts');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const at = new Date('2026-10-26T23:59:30Z');
const quota = code => new ResendDeliveryError('Capacity exhausted', 429, code);
assert.equal(deliveryFailure(quota('daily_quota_exceeded'), 1, at).nextAttemptAt, '2026-10-27T00:00:00.000Z');
assert.equal(deliveryFailure(quota('monthly_quota_exceeded'), 5, new Date('2026-10-31T23:59:30Z')).nextAttemptAt,
  '2026-11-01T00:00:00.000Z');
assert.equal(deliveryFailure(quota('monthly_quota_exceeded'), 1, at).kind, 'capacity');
assert.equal(deliveryFailure(new ResendDeliveryError('Slow down', 429, 'rate_limit_exceeded', '120'), 1, at).nextAttemptAt,
  '2026-10-27T00:01:30.000Z');
assert.equal(deliveryFailure(new ResendDeliveryError('Wait', 429, 'rate_limit_exceeded', 'Tue, 27 Oct 2026 01:00:00 GMT'), 1, at).nextAttemptAt,
  '2026-10-27T01:00:00.000Z');
assert.equal(deliveryFailure(new ResendDeliveryError('Wait', 429, 'unknown', 'invalid'), 1, at).nextAttemptAt,
  '2026-10-27T00:00:30.000Z');
assert.equal(deliveryFailure(new ResendDeliveryError('Invalid', 422, 'validation_error'), 1, at).kind, 'permanent');
assert.equal(deliveryFailure(new ResendDeliveryError('Conflict', 409, 'invalid_idempotent_request'), 1, at).kind, 'permanent');
assert.equal(deliveryFailure(new ResendDeliveryError('Busy', 409, 'concurrent_idempotent_requests'), 1, at).kind, 'transient');
assert.equal(deliveryFailure(new ResendDeliveryError('Unavailable', 503, 'application_error'), 3, at).nextAttemptAt,
  '2026-10-27T00:59:30.000Z');
assert.equal(deliveryFailure(Error('Network error'), 1, at).kind, 'transient');
assert.equal(reminderInWindow('2026-10-27T19:59:30Z', at), true);
assert.equal(reminderInWindow('2026-10-27T19:59:29Z', at), false);
assert.equal(reminderInWindow('2026-10-28T03:59:31Z', at), false);

const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('idempotency-key'), 'synthetic-key');
    assert.deepEqual(JSON.parse(options.body), { from: 'sender@example.test', to: ['synthetic@example.test'],
      reply_to: 'reply@example.test', subject: 'Synthetic', html: '<p>Test</p>', text: 'Test' });
    return new Response(JSON.stringify({ name: 'daily_quota_exceeded', message: 'Daily quota' }),
      { status: 429, headers: { 'Retry-After': '120', 'Content-Type': 'application/json' } });
  };
  const transport = createResendTransport({ apiKey: 're_synthetic_never_sent', from: 'sender@example.test', replyTo: 'reply@example.test' });
  const message = { to: 'synthetic@example.test', subject: 'Synthetic', html: '<p>Test</p>', text: 'Test', idempotencyKey: 'synthetic-key' };
  await assert.rejects(transport.send(message), error => {
    assert.equal(error.status, 429); assert.equal(error.code, 'daily_quota_exceeded');
    assert.equal(error.retryAfter, '120'); assert.equal(error.message, 'Daily quota'); return true;
  });
  assert.equal(requests, 1, 'transport does not make hidden quota retries');
  globalThis.fetch = async () => { throw Error('Synthetic connection failure'); };
  await assert.rejects(transport.send(message), error => error.status === null && error.code === 'application_error');
  globalThis.fetch = async () => new Response('Provider unavailable', { status: 503, headers: { 'retry-after': '60' } });
  await assert.rejects(transport.send(message), error => error.status === 503 && error.retryAfter === '60');
} finally { globalThis.fetch = originalFetch; }

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create table leagues(id uuid primary key);
    create table rounds(id uuid primary key,league_id uuid,status text,pick_deadline_utc timestamptz,finalized_at timestamptz);
    insert into leagues values('${id(1)}');
    insert into rounds values('${id(2)}','${id(1)}','completed',now()-interval '1 day',now()),
      ('${id(3)}','${id(1)}','upcoming',now()+interval '24 hours',null);`);
  await db.exec(await readFile('sql/2026-09-28-service-email-deliveries.sql', 'utf8'));
  for (let player = 10; player < 180; player++) await db.query('insert into auth.users values($1)', [id(player)]);
  for (let player = 10; player < 171; player++) await db.query(`insert into service_email_deliveries
    (league_id,round_id,player_id,event_type,outcome,status,attempt_count,provider_message_id,sent_at)
    values($1,$2,$3,'round_result','through','sent',1,$4,now())`, [id(1), id(2), id(player), `synthetic-${player}`]);
  const originalSent = (await db.query('select to_jsonb(d) as original from service_email_deliveries d order by player_id')).rows.map(row => row.original);
  await db.exec(await readFile('sql/2026-10-26-service-email-retries.sql', 'utf8'));
  const migratedSent = (await db.query(`select to_jsonb(d) - array['next_attempt_at','retryable','last_provider_error','expired_at','uncertain_since'] as original
    from service_email_deliveries d order by player_id`)).rows.map(row => row.original);
  assert.deepEqual(originalSent, migratedSent, 'all 161 synthetic sent records preserved');

  const rpcArguments = {
    prepare_service_email_retries: [],
    claim_service_email_delivery: ['p_league_id', 'p_round_id', 'p_player_id', 'p_event_type', 'p_outcome'],
    complete_service_email_delivery: ['p_delivery_id', 'p_claim_token', 'p_provider_message_id'],
    record_service_email_failure: ['p_delivery_id', 'p_claim_token', 'p_error', 'p_failure'],
    release_service_email_delivery: ['p_delivery_id', 'p_claim_token'],
  };
  const realRepository = createSupabaseServiceEmailRepository({
    async rpc(name, parameters = {}) {
      const values = rpcArguments[name].map(key => parameters[key]);
      const placeholders = values.map((_value, index) => `$${index + 1}`).join(',');
      const result = await db.query(`select public.${name}(${placeholders}) value`, values);
      return { data: result.rows[0].value, error: null };
    },
  });
  const candidate = player => ({ leagueId: id(1), leagueName: 'Synthetic league', roundId: id(2), roundNumber: 1,
    playerId: id(player), eventType: 'round_result', outcome: 'through', deadlineUtc: new Date().toISOString(),
    teamName: 'Synthetic FC', survivorsRemaining: 3 });
  let candidates = [...Array.from({ length: 161 }, (_value, index) => candidate(index + 10)), candidate(171), candidate(172)],
    calls = [], failure = quota('daily_quota_exceeded');
  let marketing = false, eligible = true, now = new Date();
  const repository = { ...realRepository,
    async discover() { return { candidates, zeroSurvivorRoundsSkipped: 0, ambiguousMissedPickResultsSkipped: 0 }; },
    async resolveAuthEmail() { return 'synthetic@example.test'; },
    async allowsMarketing() { return marketing; },
    async recheck() { return eligible; },
  };
  const transport = { async send(message) { calls.push(message); if (failure) throw failure; return { id: `synthetic-${calls.length}` }; } };
  const run = (overrides = {}) => processServiceEmails({ enabled: true, appOrigin: 'https://example.test', now,
    clock: () => now, repository, transport, ...overrides });
  const rows = async () => (await db.query("select * from service_email_deliveries where player_id >= $1 order by player_id", [id(171)])).rows;
  const makeDue = async () => db.exec(`update service_email_provider_state set blocked_until=now()-interval '1 second';
    update service_email_deliveries set next_attempt_at=now()-interval '1 second' where status='failed' and retryable;`);
  const clearUnsent = async () => {
    await db.exec("delete from service_email_deliveries where player_id >= '00000000-0000-4000-8000-000000000171'; delete from service_email_provider_state;");
    calls = []; eligible = true; marketing = false;
  };

  let summary = await run();
  assert.equal(summary.deferred, 1); assert.equal(calls.length, 1, 'quota stops remaining batch');
  let ledger = await rows();
  assert.equal(ledger.length, 1); assert.equal(ledger[0].attempt_count, 0);
  assert.equal(ledger[0].last_provider_error.status, 429);
  assert.equal(ledger[0].last_provider_error.code, 'daily_quota_exceeded');
  await run(); assert.equal(calls.length, 1, 'later tick respects persisted shared cooldown');
  assert.equal(await realRepository.claim(candidate(172)), null, 'atomic claim also respects shared cooldown');
  await makeDue(); failure = null; marketing = true;
  summary = await run(); assert.equal(summary.resultsSent, 2, 'ticks resume after reset');
  assert.ok(calls[1].text.includes('https://t.me/FCCCompetitions'), 'consent re-read on retry');
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey, 'delivery key unchanged');
  await run(); assert.equal(calls.length, 3, 'sent records never reclaimed');
  assert.equal((await db.query("select count(*)::int total from service_email_deliveries where status='sent'")).rows[0].total, 163);

  await clearUnsent(); candidates = [candidate(171)]; failure = quota('monthly_quota_exceeded');
  for (let day = 0; day < 8; day++) {
    await run(); assert.equal((await rows())[0].attempt_count, 0, 'monthly deferrals never consume allowance');
    await makeDue();
  }
  failure = null; summary = await run(); assert.equal(summary.resultsSent, 1, 'monthly capacity eventually resumes');

  await clearUnsent(); failure = new ResendDeliveryError('Slow down', 429, 'rate_limit_exceeded', '7200');
  await run(); ledger = await rows();
  assert.equal(ledger[0].last_provider_error.retryAfter, '7200');
  assert.equal(ledger[0].attempt_count, 0);
  assert.ok(new Date(ledger[0].next_attempt_at).getTime() >= now.getTime() + 7200_000);
  await run(); assert.equal(calls.length, 1);

  await clearUnsent(); failure = new ResendDeliveryError('Unavailable', 503, 'application_error');
  for (let attempt = 1; attempt <= 5; attempt++) {
    await run(); assert.equal((await rows())[0].attempt_count, attempt);
    await run(); assert.equal(calls.length, attempt, 'backoff prevents early retries');
    await makeDue();
  }
  await run(); assert.equal(calls.length, 5, 'ordinary transient failures retain five-attempt cap');
  assert.ok((await rows())[0].uncertain_since);

  await clearUnsent(); failure = new ResendDeliveryError('Bad address', 422, 'validation_error');
  await run(); await makeDue(); await run();
  assert.equal(calls.length, 1); assert.equal((await rows())[0].retryable, false, 'permanent rejection is terminal');

  await clearUnsent(); failure = null;
  const first = await realRepository.claim(candidate(171));
  assert.ok(first); assert.equal(await realRepository.claim(candidate(171)), null, 'concurrent claim denied');
  await db.query("update service_email_deliveries set claimed_at=now()-interval '16 minutes' where id=$1", [first.id]);
  const reclaimed = await realRepository.claim(candidate(171));
  assert.ok(reclaimed); assert.notEqual(reclaimed.claimToken, first.claimToken);
  await assert.rejects(realRepository.complete(first, 'stale-provider-id'), /claim was lost/);
  await realRepository.complete(reclaimed, 'synthetic-reclaimed');
  await run(); assert.equal(calls.length, 0);

  await clearUnsent(); failure = null;
  const accepted = new Map(); let providerRequests = 0, actualDeliveries = 0;
  const idempotentProvider = { async send(message) {
    providerRequests++;
    if (accepted.has(message.idempotencyKey)) return { id: accepted.get(message.idempotencyKey) };
    accepted.set(message.idempotencyKey, 'synthetic-accepted-once'); actualDeliveries++;
    throw Error('Synthetic connection lost after provider accepted');
  } };
  await run({ transport: idempotentProvider }); await makeDue();
  summary = await run({ transport: idempotentProvider });
  assert.equal(summary.resultsSent, 1); assert.equal(providerRequests, 2); assert.equal(actualDeliveries, 1);

  await clearUnsent(); failure = Error('Synthetic uncertain send');
  await run(); await makeDue(); eligible = false;
  await run(); ledger = await rows();
  assert.equal(calls.length, 1); assert.equal(ledger.length, 1);
  assert.equal(ledger[0].retryable, false, 'eligibility changes cannot delete uncertain delivery history');

  await clearUnsent(); failure = Error('Synthetic lost response');
  await run(); await makeDue();
  await db.exec("update service_email_deliveries set uncertain_since=now()-interval '24 hours' where status='failed'");
  await run(); assert.equal(calls.length, 1, 'uncertain send never retried beyond provider idempotency retention');
  assert.equal((await rows())[0].retryable, false);

  await clearUnsent(); failure = null;
  summary = await run({ repository: { ...repository, async complete() { throw Error('Synthetic completion failure'); } } });
  ledger = await rows(); assert.equal(ledger[0].last_provider_error.kind, 'accepted');
  assert.ok(ledger[0].provider_message_id); assert.equal(ledger[0].retryable, false);
  await run(); assert.equal(calls.length, 1, 'known provider acceptance requires reconciliation, never another send');

  await clearUnsent(); failure = quota('daily_quota_exceeded');
  candidates = [{ ...candidate(171), roundId: id(3), eventType: 'pick_reminder', outcome: null,
    deadlineUtc: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() }];
  await run();
  await db.exec("update rounds set pick_deadline_utc=now()+interval '19 hours' where status='upcoming'");
  summary = await run();
  assert.equal(summary.expiredReminders, 1, 'expiry is processed even while provider is paused');
  ledger = await rows(); assert.ok(ledger[0].expired_at); assert.equal(ledger[0].retryable, false);
  assert.equal(ledger[0].last_provider_error.code, 'reminder_expired');
  await makeDue(); failure = null; await run(); assert.equal(calls.length, 1, 'expired reminder never sent');
  await db.exec("update rounds set pick_deadline_utc=now()-interval '1 hour' where status='upcoming'");
  assert.equal(await realRepository.claim({ ...candidates[0], playerId: id(172) }), null, 'atomic claim blocks past-deadline reminders');

  await clearUnsent(); failure = null;
  await db.exec("update rounds set pick_deadline_utc=now()+interval '24 hours' where status='upcoming'");
  candidates[0].deadlineUtc = new Date(now.getTime() + 19 * 60 * 60_000).toISOString();
  summary = await run(); assert.equal(summary.expiredReminders, 1); assert.equal(calls.length, 0, 'final pre-send window guard');
  await clearUnsent(); candidates = [candidate(171)]; eligible = false;
  await run(); assert.equal(calls.length, 0); assert.equal((await rows()).length, 0, 'changed eligibility releases claim');

  await db.exec('set role authenticated');
  await assert.rejects(() => db.query('select prepare_service_email_retries()'), /permission denied/);
  await db.exec('reset role; set role service_role');
  await db.query('select prepare_service_email_retries()');
  await assert.rejects(() => db.query('delete from service_email_provider_state'), /permission denied/);
  await db.exec('reset role');
} finally { await db.close(); }
console.log('PASS: structured provider errors, UTC resets, quota/rate deferral, durable cooldown, bounded retries, expiry, claims and duplicate protection (synthetic only)');
