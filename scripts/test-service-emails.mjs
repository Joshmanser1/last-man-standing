import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { processServiceEmails } = await load('server/email/serviceEmailProcessor.ts');
const { reminderCandidates, resultCandidates } = await load('server/email/eligibility.ts');
const { createSupabaseServiceEmailRepository } = await load('server/email/supabaseServiceEmailRepository.ts');
const { activateLeagueFromSearch } = await load('src/lib/leagueRoute.ts');
const { tickHandler } = await load('api/tick.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-09-28T12:00:00Z');
const baseRound = { id:id(2), league_id:id(1), round_number:1, status:'upcoming', pick_deadline_utc:'2026-09-29T12:00:00Z', finalized_at:null };
const member = player => ({ player_id:player, is_active:true, joined_at:'2026-09-01T00:00:00Z' });
const snapshot = (overrides={}) => ({
  league:{id:id(1),name:'FCC Saturday Club',current_round:1}, rounds:[baseRound], memberships:[member(id(10))], picks:[],
  teams:[{id:id(20),name:'Arsenal'},{id:id(21),name:'Chelsea'}], ...overrides,
});
const reminder = reminderCandidates(snapshot(), id(2))[0];
const resultCandidate = (outcome='through') => ({ ...reminder, eventType:'round_result', outcome,
  teamName:outcome==='eliminated_no_pick'?null:'Arsenal', survivorsRemaining:3 });

function harness(candidates, options={}) {
  const state = new Map(), sent=[];
  let claims=0, recheck=options.recheck ?? (()=>true), failOnce=options.failOnce ?? false;
  const repository = {
    async discover(){ return {candidates,zeroSurvivorRoundsSkipped:options.zeroRounds??0,
      ambiguousMissedPickResultsSkipped:options.ambiguousMissedPicks??0}; },
    async resolveAuthEmail(playerId){ if(options.authError)throw Error('auth unavailable'); return options.missingEmail ? null : `${playerId.slice(-2)}@example.test`; },
    async claim(candidate){
      const key=[candidate.leagueId,candidate.roundId,candidate.playerId,candidate.eventType].join(':');
      const existing=state.get(key); if(existing==='sent'||existing==='processing')return null;
      state.set(key,'processing'); claims++; return {id:key,claimToken:'token-'+claims,attemptCount:claims};
    },
    async recheck(candidate){ return recheck(candidate); },
    async complete(claim){ state.set(claim.id,'sent'); },
    async fail(claim){ state.set(claim.id,'failed'); },
    async release(claim){ state.delete(claim.id); },
  };
  const transport={async send(message){ sent.push(message); if(failOnce){failOnce=false;throw Error('provider down');} return{id:'msg-'+sent.length}; }};
  const run=(extra={})=>processServiceEmails({enabled:true,appOrigin:'https://lms.fantasycommandcentre.co.uk',now,pilotAllowlist:'',repository,transport,...extra});
  return {run,sent,state,get claims(){return claims;},setRecheck(value){recheck=value;}};
}

// Reminder eligibility and delivery.
assert.equal(reminderCandidates(snapshot(),id(2)).length,1);
assert.equal(reminderCandidates(snapshot({picks:[{round_id:id(2),player_id:id(10),team_id:id(20),status:'pending'}]}),id(2)).length,0);
assert.equal(reminderCandidates(snapshot({league:{id:id(1),name:'FCC Saturday Club',current_round:2}}),id(2)).length,0);
const storage={value:'old-league',getItem(){return this.value;},setItem(_key,value){this.value=value;}};
assert.equal(activateLeagueFromSearch(`?league_id=${id(1)}`,storage),id(1));
assert.equal(storage.value,id(1),'email route activates its explicit league before page loading');
assert.equal(activateLeagueFromSearch('',storage),id(1));
let h=harness([reminder]); let summary=await h.run();
assert.equal(summary.remindersSent,1); assert.equal(h.sent.length,1); assert.match(h.sent[0].subject,/due tomorrow/);
assert.match(h.sent[0].text,/\/make-pick\?league_id=/);
await h.run(); assert.equal(h.sent.length,1,'duplicate reminder invocation');

// A pick arriving after discovery/claim is rechecked before provider send and releases the claim.
h=harness([reminder],{recheck:()=>false}); summary=await h.run();
assert.equal(h.sent.length,0); assert.equal(summary.ineligibleAfterClaim,1); assert.equal(h.state.size,0);

// Finalisation is required, and each stored result maps to the correct email outcome.
assert.equal(resultCandidates(snapshot(),id(2)).candidates.length,0);
const finalRound={...baseRound,status:'completed',finalized_at:'2026-09-28T11:00:00Z'};
let final=resultCandidates(snapshot({rounds:[finalRound],memberships:[member(id(10)),member(id(11)),member(id(12)),member(id(13)),member(id(14))],picks:[
  {round_id:id(2),player_id:id(10),team_id:id(20),status:'through',reason:null},
  {round_id:id(2),player_id:id(11),team_id:id(21),status:'eliminated',reason:'loss'},
  {round_id:id(2),player_id:id(12),team_id:id(21),status:'eliminated',reason:'draw'},
  {round_id:id(2),player_id:id(14),team_id:null,status:'no-pick',reason:'no-pick'},
]}),id(2));
assert.deepEqual(final.candidates.map(c=>c.outcome),['through','eliminated_loss','eliminated_draw','eliminated_no_pick']);
assert.equal(final.ambiguousMissedPicks,1,'missing current-round pick is ambiguous and skipped');
h=harness(final.candidates); summary=await h.run(); assert.equal(summary.resultsSent,4); assert.equal(h.sent.length,4);
assert.match(h.sent[0].text,/WON\. YOU SURVIVED/); assert.match(h.sent[1].text,/LOST\. YOU'RE OUT/);
assert.match(h.sent[2].text,/DREW\. YOU'RE OUT/); assert.match(h.sent[3].text,/MISSED THE DEADLINE/);
assert.match(h.sent[1].text,/\/leaderboard\?view=eliminations&league_id=/);
assert.ok(h.sent.every(message=>message.text.includes('https://lms.fantasycommandcentre.co.uk/')));
await h.run(); assert.equal(h.sent.length,4,'duplicate results invocation');
h=harness([],{ambiguousMissedPicks:1}); summary=await h.run(); assert.equal(summary.ambiguousMissedPickResultsSkipped,1); assert.equal(h.sent.length,0);

// Production regression: finalisation made the missed-pick member inactive and
// persisted an authoritative null-team no-pick result, despite sparse prior history.
const roundOne={id:id(101),league_id:id(1),round_number:1,status:'locked',pick_deadline_utc:'2026-09-10T12:00:00Z',finalized_at:null};
const roundTwo={id:id(102),league_id:id(1),round_number:2,status:'locked',pick_deadline_utc:'2026-09-20T12:00:00Z',finalized_at:null};
const roundThree={id:id(103),league_id:id(1),round_number:3,status:'completed',pick_deadline_utc:'2026-09-28T10:00:00Z',finalized_at:'2026-09-28T11:00:00Z'};
const productionResult=resultCandidates(snapshot({
  league:{id:id(1),name:'FCC Saturday Club',current_round:3},
  rounds:[roundOne,roundTwo,roundThree],
  memberships:[member(id(10)),{...member(id(14)),is_active:false}],
  picks:[
    {round_id:roundOne.id,player_id:id(10),team_id:id(20),status:'through',reason:null},
    {round_id:roundTwo.id,player_id:id(10),team_id:id(21),status:'through',reason:null},
    {round_id:roundThree.id,player_id:id(10),team_id:id(20),status:'through',reason:null},
    {round_id:roundThree.id,player_id:id(14),team_id:null,status:'no-pick',reason:'no-pick'},
  ],
}),roundThree.id);
const missedPickCandidates=productionResult.candidates.filter(candidate=>candidate.playerId===id(14));
assert.equal(missedPickCandidates.length,1);
assert.equal(missedPickCandidates[0].eventType,'round_result');
assert.equal(missedPickCandidates[0].outcome,'eliminated_no_pick');
h=harness(missedPickCandidates); summary=await h.run({pilotAllowlist:'14@example.test'});
assert.equal(summary.resultsSent,1); assert.equal(h.sent.length,1); assert.match(h.sent[0].text,/MISSED THE DEADLINE/);
await h.run({pilotAllowlist:'14@example.test'}); assert.equal(h.sent.length,1,'persisted no-pick result is not resent');

// Zero survivors suppress every normal result email.
final=resultCandidates(snapshot({rounds:[finalRound],picks:[{round_id:id(2),player_id:id(10),team_id:id(20),status:'eliminated',reason:'loss'}]}),id(2));
assert.equal(final.zeroSurvivors,true); assert.equal(final.candidates.length,0);
h=harness([],{zeroRounds:1}); summary=await h.run(); assert.equal(summary.zeroSurvivorRoundsSkipped,1); assert.equal(h.sent.length,0);

// Master switch, pilot safety, missing Auth email and retryable provider failure.
h=harness([reminder]); summary=await h.run({enabled:false}); assert.equal(summary.disabled,true); assert.equal(h.sent.length,0); assert.equal(h.claims,0);
h=harness([reminder]); summary=await h.run({pilotAllowlist:'pilot@example.test'}); assert.equal(summary.pilotBlocked,1); assert.equal(h.claims,0); assert.equal(h.state.size,0);
summary=await h.run({pilotAllowlist:'10@example.test'}); assert.equal(summary.remindersSent,1,'pilot-blocked recipient was not consumed');
h=harness([reminder],{missingEmail:true}); summary=await h.run(); assert.equal(summary.missingAuthEmail,1); assert.equal(h.claims,0);
h=harness([reminder],{authError:true}); summary=await h.run(); assert.equal(summary.failed,1); assert.equal(summary.missingAuthEmail,0); assert.equal(h.claims,0);
h=harness([reminder],{failOnce:true}); summary=await h.run(); assert.equal(summary.failed,1); assert.equal([...h.state.values()][0],'failed');
summary=await h.run(); assert.equal(summary.remindersSent,1); assert.equal(h.sent.length,2,'failed send is retryable');

// Concurrent processors share an atomic claim; only one reaches the provider.
h=harness([reminder]); await Promise.all([h.run(),h.run()]); assert.equal(h.sent.length,1);

// Discovery can race a soft deletion: a round remains queryable while its
// league is intentionally excluded by deleted_at IS NULL.
function discoveryDatabase(leagueResult) {
  return {
    from(table) {
      const filters=new Map();
      const result=()=>{
        if(table==='rounds') {
          return {data:filters.get('status')==='upcoming'?[{id:id(2),league_id:id(1)}]:[],error:null};
        }
        if(table==='leagues') return leagueResult;
        throw Error(`Snapshot data should not load for a missing league: ${table}`);
      };
      const query={
        select(){return query;},eq(column,value){filters.set(column,value);return query;},
        is(){return query;},not(){return query;},gte(){return query;},lte(){return query;},
        order(){return query;},range(){return query;},maybeSingle(){return Promise.resolve(result());},
        then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);},
      };
      return query;
    },
  };
}
let discovery=await createSupabaseServiceEmailRepository(discoveryDatabase({data:null,error:null})).discover(now);
assert.deepEqual(discovery,{candidates:[],zeroSurvivorRoundsSkipped:0,ambiguousMissedPickResultsSkipped:0},
  'a round whose league was soft-deleted is skipped without aborting discovery');
await assert.rejects(
  createSupabaseServiceEmailRepository(discoveryDatabase({data:null,error:{message:'multiple league rows'}})).discover(now),
  /League snapshot lookup failed: multiple league rows/,
  'unexpected league cardinality includes query context'
);

// The existing tick endpoint owns orchestration without coupling email delivery
// to successful competition-state processing.
function tickDatabase(events) {
  return {
    from(table) {
      let operation='select', payload=null, selectOptions=null;
      const result=()=>{
        if(table==='tick_runs' && operation==='insert') return {data:{id:'tick-1'},error:null};
        if(table==='tick_runs' && operation==='update') { events.push(`tick:${payload.status}`); return {data:null,error:null}; }
        if(table==='rounds') return {data:selectOptions?.head?null:[],count:selectOptions?.count==='exact'?1:null,error:null};
        if(table==='leagues') return {data:[{id:id(1),status:'active',current_round:1,is_test:false}],error:null};
        throw Error(`Unexpected tick table ${table}`);
      };
      const query={
        insert(value){operation='insert';payload=value;return query;},
        update(value){operation='update';payload=value;return query;},
        select(_columns,options){selectOptions=options??null;return query;},
        eq(){return query;},not(){return query;},is(){return query;},limit(){return query;},
        single(){return Promise.resolve(result());},maybeSingle(){return Promise.resolve(result());},
        then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);},
      };
      return query;
    },
  };
}
function tickResponse() {
  return {statusCode:0,headers:{},body:null,setHeader(name,value){this.headers[name]=value;},end(body){this.body=JSON.parse(body);}};
}
const savedTickEnv={
  CRON_SECRET:process.env.CRON_SECRET,
  SUPABASE_URL:process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,
  SERVICE_EMAILS_ENABLED:process.env.SERVICE_EMAILS_ENABLED,
};
Object.assign(process.env,{CRON_SECRET:'tick-secret',SUPABASE_URL:'https://unused.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'local-test-service-role-key',SERVICE_EMAILS_ENABLED:'true'});
const emailSummary={disabled:false,remindersSent:1,resultsSent:0,skipped:0,failed:0,
  zeroSurvivorRoundsSkipped:0,missingAuthEmail:0,pilotBlocked:0,ineligibleAfterClaim:0,ambiguousMissedPickResultsSkipped:0};
try {
  let events=[]; let database=tickDatabase(events); let response=tickResponse();
  const dependencies={createClient:()=>database,
    async runLeagueLifecycle(){events.push('lifecycle');},
    async runServiceEmails(){events.push('email');return{status:200,body:emailSummary};}};
  await tickHandler({method:'GET',headers:{authorization:'Bearer tick-secret'},query:{}},response,dependencies);
  assert.equal(response.statusCode,200); assert.equal(response.body.ok,true);
  assert.deepEqual(events,['lifecycle','tick:ok','email'],'normal tick completes lifecycle before email processing');
  assert.deepEqual(response.body.service_emails,emailSummary);

  events=[]; response=tickResponse();
  const emailOnlyDependencies={createClient:()=>({from(){throw Error('email-only touched competition state');}}),
    async runLeagueLifecycle(){events.push('lifecycle');},
    async runServiceEmails(){events.push('email');return{status:200,body:emailSummary};}};
  await tickHandler({method:'GET',headers:{authorization:'Bearer tick-secret'},query:{mode:'service-emails'}},response,emailOnlyDependencies);
  assert.equal(response.statusCode,200); assert.deepEqual(response.body,emailSummary); assert.deepEqual(events,['email']);

  events=[]; response=tickResponse();
  await tickHandler({method:'GET',headers:{},query:{mode:'service-emails'}},response,emailOnlyDependencies);
  assert.equal(response.statusCode,401); assert.deepEqual(events,[],'unauthorized requests invoke neither lifecycle nor email work');

  events=[]; database=tickDatabase(events); response=tickResponse();
  const originalConsoleError=console.error;
  console.error=()=>{};
  try {
    await tickHandler({method:'GET',headers:{authorization:'Bearer tick-secret'},query:{}},response,{
      createClient:()=>database,async runLeagueLifecycle(){events.push('lifecycle');},
      async runServiceEmails(){events.push('email');throw Error('provider unavailable');},
    });
  } finally { console.error=originalConsoleError; }
  assert.equal(response.statusCode,200); assert.equal(response.body.ok,true);
  assert.deepEqual(events,['lifecycle','tick:ok','email']);
  assert.deepEqual(response.body.service_emails,{error:'Service email processing failed.'});
} finally {
  for (const [key,value] of Object.entries(savedTickEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key]=value;
  }
}

// Exercise the real ledger migration against disposable PostgreSQL.
const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users(id uuid primary key); create table public.leagues(id uuid primary key);
    create table public.rounds(id uuid primary key); insert into auth.users values('${id(10)}');
    insert into leagues values('${id(1)}'); insert into rounds values('${id(2)}');`);
  await db.exec(await readFile('sql/2026-09-28-service-email-deliveries.sql','utf8'));
  const claim=async()=> (await db.query("select claim_service_email_delivery($1,$2,$3,'pick_reminder',null) value",[id(1),id(2),id(10)])).rows[0].value;
  const first=await claim(); assert.ok(first.id && first.claim_token);
  assert.equal(await claim(),null,'fresh concurrent claim is rejected');
  assert.equal((await db.query('select count(*)::int count from service_email_deliveries')).rows[0].count,1);
  assert.equal((await db.query('select fail_service_email_delivery($1,$2,$3) value',[first.id,first.claim_token,'provider down'])).rows[0].value,true);
  const retry=await claim(); assert.equal(retry.attempt_count,2);
  assert.equal((await db.query('select complete_service_email_delivery($1,$2,$3) value',[retry.id,retry.claim_token,'resend-1'])).rows[0].value,true);
  assert.equal(await claim(),null,'sent delivery cannot be reclaimed');
  await db.exec('set role authenticated');
  await assert.rejects(claim(),/permission denied/);
  await db.exec('reset role');
} finally { await db.close(); }

console.log('PASS: service email eligibility, templates, switches, allowlist, recheck, retries, deduplication and atomic ledger claims');
