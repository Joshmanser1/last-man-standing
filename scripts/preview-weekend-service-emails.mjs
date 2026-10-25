import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { build } from 'esbuild';

const localEnv = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(line => /^\w+=/.test(line)).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const url = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase read credentials are required.');
const origin = new URL(url).origin;
const database = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input, init) => {
      const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method.toUpperCase() !== 'GET' || requestUrl.origin !== origin
        || requestUrl.pathname.startsWith('/rest/v1/rpc/')) {
        throw new Error('Preview permits only same-origin GET requests and forbids RPCs.');
      }
      return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
    },
  },
});

async function load(entry) {
  const bundled = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}

async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Preview query returned no data.');
  return data;
}

const { approvedResultEmailExceptionRoundIds } = await load('server/email/eligibility.ts');
const { createSupabaseServiceEmailRepository } = await load('server/email/supabaseServiceEmailRepository.ts');
const { renderServiceEmail } = await load('server/email/templates.ts');
const resultsStartAt = '2026-10-25T00:00:00Z';
const now = new Date();
const repository = createSupabaseServiceEmailRepository(database, {
  resultsStartAt, resultsExceptionRoundIds: approvedResultEmailExceptionRoundIds.join(','),
});
const rounds = await read(database.from('rounds')
  .select('id,league_id,round_number,status,pick_deadline_utc,finalized_at')
  .in('id', [...approvedResultEmailExceptionRoundIds]));
if (rounds.length !== approvedResultEmailExceptionRoundIds.length) throw new Error('An approved round is missing.');
const leagues = await read(database.from('leagues').select('id,join_code,is_test,deleted_at')
  .in('id', rounds.map(round => round.league_id)));
const deliveries = [];
for (let from = 0;; from += 500) {
  const page = await read(database.from('service_email_deliveries')
    .select('round_id,player_id,status,attempt_count,claimed_at')
    .eq('event_type', 'round_result').in('round_id', [...approvedResultEmailExceptionRoundIds])
    .order('id').range(from, from + 499));
  deliveries.push(...page);
  if (page.length < 500) break;
}
const ledger = new Map(deliveries.map(delivery => [`${delivery.round_id}:${delivery.player_id}`, delivery]));
const reports = new Map(rounds.map(round => {
  const league = leagues.find(entry => entry.id === round.league_id);
  if (!league || league.is_test === true || league.deleted_at) throw new Error('Approved league is missing, deleted or test.');
  return [round.id, {
    competition: league.join_code, round_id: round.id, round_number: round.round_number,
    deadline: round.pick_deadline_utc, status: round.status, finalized_at: round.finalized_at,
    ready_for_results: round.status === 'completed' && !!round.finalized_at,
    email_type: 'round_result', eligible_verified_recipients: 0, claimable_recipients: 0,
    already_sent: deliveries.filter(delivery => delivery.round_id === round.id && delivery.status === 'sent').length,
    missing_verified_email: 0, ineligible_on_recheck: 0,
    presentations: [],
    outcomes: Object.fromEntries(['through', 'eliminated_loss', 'eliminated_draw', 'eliminated_no_pick']
      .map(outcome => [outcome, { eligible: 0, claimable: 0, claimable_with_marketing_consent: 0 }])),
  }];
}));
const discovery = await repository.discover(now);
for (const candidate of discovery.candidates) {
  if (candidate.eventType !== 'round_result' || !reports.has(candidate.roundId)) continue;
  const report = reports.get(candidate.roundId);
  const email = await repository.resolveAuthEmail(candidate.playerId);
  if (!email) { report.missing_verified_email++; continue; }
  if (!(await repository.recheck(candidate, now))) { report.ineligible_on_recheck++; continue; }
  report.eligible_verified_recipients++;
  report.outcomes[candidate.outcome].eligible++;
  const delivery = ledger.get(`${candidate.roundId}:${candidate.playerId}`);
  const claimable = !delivery || (delivery.attempt_count < 5
    && (delivery.status === 'failed' || (delivery.status === 'processing'
      && Date.parse(delivery.claimed_at) < now.getTime() - 15 * 60 * 1000)));
  if (!claimable) continue;
  report.claimable_recipients++;
  report.outcomes[candidate.outcome].claimable++;
  const marketingPermitted = await repository.allowsMarketing(candidate.playerId, email);
  if (marketingPermitted) {
    report.outcomes[candidate.outcome].claimable_with_marketing_consent++;
  }
  const rendered = renderServiceEmail(candidate, 'https://lms.fantasycommandcentre.co.uk', {
    includeTelegram: marketingPermitted, includeRolloverInvitation: marketingPermitted,
  });
  const presentation = {
    template: candidate.resultVariant ?? 'standard_result', outcome: candidate.outcome,
    individual_outcome_round: candidate.eliminationRoundNumber ?? candidate.roundNumber,
    marketing_permitted: marketingPermitted, primary_cta: rendered.primaryCta,
    includes_telegram: rendered.includesTelegram,
  };
  const existing = report.presentations.find(entry => JSON.stringify(entry.presentation) === JSON.stringify(presentation));
  if (existing) existing.recipients++;
  else report.presentations.push({ presentation, recipients: 1 });
}
console.log(JSON.stringify({
  preview_started_at: now.toISOString(), preview_completed_at: new Date().toISOString(),
  read_only: true, proposed_results_start_at: resultsStartAt,
  proposed_exception_round_ids: approvedResultEmailExceptionRoundIds,
  before_pilot_allowlist: true, rounds: [...reports.values()],
  zero_survivor_rounds_skipped: discovery.zeroSurvivorRoundsSkipped,
  ambiguous_missed_pick_results_skipped: discovery.ambiguousMissedPickResultsSkipped,
}, null, 2));
