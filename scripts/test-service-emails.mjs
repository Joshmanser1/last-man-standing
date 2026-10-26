import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { processServiceEmails } = await load('server/email/serviceEmailProcessor.ts');
const { reminderCandidates, resultCandidates: evaluateResults, parseResultEmailStartAt,
  approvedResultEmailExceptionRoundIds, parseResultEmailExceptionRoundIds } = await load('server/email/eligibility.ts');
const { createSupabaseServiceEmailRepository } = await load('server/email/supabaseServiceEmailRepository.ts');
const { renderServiceEmail } = await load('server/email/templates.ts');
const { activateLeagueFromSearch } = await load('src/lib/leagueRoute.ts');
const { tickHandler } = await load('api/tick.ts');
const { markRolloverLeagueId, markRolloverRoundId, markRolloverJoinUrl } = await load('server/email/types.ts');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-09-28T12:00:00Z');
const resultsStartAt='2026-09-28T00:00:00Z';
const resultCandidates=(data,roundId,at=now)=>evaluateResults(data,roundId,at,resultsStartAt);
const baseRound = { id:id(2), league_id:id(1), round_number:1, status:'upcoming', pick_deadline_utc:'2026-09-29T12:00:00Z', finalized_at:null };
const member = player => ({ player_id:player, is_active:true, joined_at:'2026-09-01T00:00:00Z' });
const snapshot = (overrides={}) => ({
  league:{id:id(1),name:'FCC Saturday Club',current_round:1}, rounds:[baseRound], memberships:[member(id(10))], picks:[],
  teams:[{id:id(20),name:'Arsenal'},{id:id(21),name:'Chelsea'}], ...overrides,
});
const reminder = reminderCandidates(snapshot(), id(2))[0];
const resultCandidate = (outcome='through') => ({ ...reminder, eventType:'round_result', outcome,
  teamName:outcome==='eliminated_no_pick'?null:'Arsenal', survivorsRemaining:3 });

function assertTelegramSection(message, primaryCta) {
  const footer="You're receiving this email because you're taking part in this competition on Fantasy Command Centre.";
  assert.match(message.html, /href="https:\/\/t\.me\/FCCCompetitions"/);
  assert.match(message.text, /Join FCC on Telegram → https:\/\/t\.me\/FCCCompetitions/);
  for(const content of [message.html,message.text]) {
    assert.equal(content.split('https://t.me/FCCCompetitions').length-1,1,'one direct Telegram link');
    assert.ok(content.includes('Join our Telegram channel for competition updates, results and reminders.'));
    assert.ok(content.indexOf(primaryCta)<content.indexOf("Don't miss an FCC update!"),'pick action stays primary');
    assert.ok(content.indexOf("Don't miss an FCC update!")<content.indexOf(footer),'Telegram precedes existing footer');
  }
}

function harness(candidates, options={}) {
  const state = new Map(), sent=[];
  let claims=0, recheck=options.recheck ?? (()=>true), failOnce=options.failOnce ?? false;
  const repository = {
    async prepareRetries(){ return {blockedUntil:null,expired:0}; },
    async discover(){ return {candidates,zeroSurvivorRoundsSkipped:options.zeroRounds??0,
      ambiguousMissedPickResultsSkipped:options.ambiguousMissedPicks??0}; },
    async resolveAuthEmail(playerId){ if(options.authError)throw Error('auth unavailable'); return options.missingEmail ? null : `${playerId.slice(-2)}@example.test`; },
    async allowsMarketing(playerId){ if(options.marketingError)throw Error('preferences unavailable'); return typeof options.marketing==='function'?options.marketing(playerId):options.marketing === true; },
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
  const run=(extra={})=>processServiceEmails({enabled:true,appOrigin:'https://lms.fantasycommandcentre.co.uk',now,clock:()=>now,pilotAllowlist:'',repository,transport,...extra});
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
let h=harness([reminder],{marketing:true}); let summary=await h.run();
assert.equal(summary.remindersSent,1); assert.equal(h.sent.length,1); assert.match(h.sent[0].subject,/due tomorrow/);
assert.match(h.sent[0].text,/\/make-pick\?league_id=/);
assert.match(h.sent[0].text,/29 September 2026 at 13:00/);
assertTelegramSection(h.sent[0],'MAKE MY PICK');
await h.run(); assert.equal(h.sent.length,1,'duplicate reminder invocation');

// A pick arriving after discovery/claim is rechecked before provider send and releases the claim.
h=harness([reminder],{recheck:()=>false}); summary=await h.run();
assert.equal(h.sent.length,0); assert.equal(summary.ineligibleAfterClaim,1); assert.equal(h.state.size,0);

// Finalisation is required, and each stored result maps to the correct email outcome.
assert.equal(resultCandidates(snapshot(),id(2)).candidates.length,0);
const finalRound={...baseRound,status:'completed',finalized_at:'2026-09-28T11:00:00Z'};
const cutoffSnapshot=snapshot({rounds:[finalRound],picks:[
  {round_id:id(2),player_id:id(10),team_id:id(20),status:'through'},
]});
for(const invalid of [undefined,'','invalid','2026-09-28','2026-02-30T00:00:00Z','2026-09-28T00:00:00']) {
  assert.equal(parseResultEmailStartAt(invalid),null);
  assert.equal(evaluateResults(cutoffSnapshot,id(2),now,invalid).candidates.length,0,'invalid cutoff fails closed');
}
assert.equal(evaluateResults(cutoffSnapshot,id(2),now,finalRound.pick_deadline_utc).candidates.length,1,'cutoff boundary is inclusive');
assert.equal(evaluateResults(cutoffSnapshot,id(2),now,'2026-09-30T00:00:00Z').candidates.length,0,'historical deadline excluded even if finalisation is recent');
assert.equal(evaluateResults(cutoffSnapshot,id(2),new Date('2027-01-01T00:00:00Z'),resultsStartAt).candidates.length,1,'cutoff does not move with deployment or processing time');
assert.equal(reminderCandidates(snapshot(),id(2)).length,1,'result cutoff does not change reminders');
assert.equal(reminderCandidates(snapshot({memberships:[{...member(id(10)),is_active:false}]}),id(2)).length,0,'inactive players do not receive pick reminders');
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
assert.ok(h.sent.every(message=>!message.html.includes('FCCCompetitions')&&!message.text.includes('FCCCompetitions')),
  'results without a next-pick prompt remain unchanged');
await h.run(); assert.equal(h.sent.length,4,'duplicate results invocation');
h=harness([],{ambiguousMissedPicks:1}); summary=await h.run(); assert.equal(summary.ambiguousMissedPickResultsSkipped,1); assert.equal(h.sent.length,0);

// Survivor presentation uses the actual next round, without changing recipients.
const nextRound={...baseRound,id:id(3),round_number:2,pick_deadline_utc:'2026-10-17T10:00:00Z'};
const survivorSnapshot=snapshot({
  league:{id:id(1),name:'FCC Saturday Club',current_round:2,status:'active'},
  rounds:[finalRound,nextRound],memberships:[member(id(10)),member(id(11)),member(id(12))],
  picks:[
    {round_id:id(2),player_id:id(10),team_id:id(20),status:'through'},
    {round_id:id(2),player_id:id(11),team_id:id(20),status:'through'},
    {round_id:id(2),player_id:id(12),team_id:id(21),status:'eliminated',reason:'loss'},
  ],
});
const origin='https://lms.fantasycommandcentre.co.uk';
const candidatesFor=data=>resultCandidates(data,id(2),now).candidates;
let survivorCandidates=candidatesFor(survivorSnapshot);
assert.equal(survivorCandidates.length,3);
assert.deepEqual(survivorCandidates[0].nextRound,{roundNumber:2,deadlineUtc:nextRound.pick_deadline_utc,alreadyPicked:false});
h=harness(survivorCandidates,{marketing:true}); summary=await h.run(); assert.equal(summary.resultsSent,3);
for(const message of h.sent.slice(0,2)) {
  assert.match(message.text,/Round 1 is complete/);
  assert.match(message.text,/Round 2\nNext deadline\nSat 17 Oct · 11:00/);
  assert.match(message.html,/Round 2/); assert.match(message.html,/Sat 17 Oct · 11:00/);
  assert.ok(message.html.includes(`href="${origin}/make-pick?league_id=${id(1)}"`));
  assert.ok(message.text.includes(`MAKE YOUR PICK: ${origin}/make-pick?league_id=${id(1)}`));
  assertTelegramSection(message,'MAKE YOUR PICK');
}
assert.doesNotMatch(h.sent[2].text,/MAKE YOUR PICK|Next deadline/);
assertTelegramSection(h.sent[2],'VIEW RESULTS');
await h.run(); assert.equal(h.sent.length,3,'next-round presentation does not affect deduplication');

const normalResultVariants=[
  ...['through','eliminated_loss','eliminated_draw','eliminated_no_pick'].map(outcome=>resultCandidate(outcome)),
  survivorCandidates[0],
  {...survivorCandidates[0],nextRound:{...survivorCandidates[0].nextRound,alreadyPicked:true}},
  {...resultCandidate(),survivorsRemaining:1},
];
for(const candidate of normalResultVariants) {
  const baseline=renderServiceEmail(candidate,origin);
  for(const consent of [{marketing:true},{marketing:false},{marketingError:true},{}]) {
    h=harness([candidate],consent);
    assert.equal((await h.run()).resultsSent,1,'consent only controls promotion, not result delivery');
    const message=h.sent[0];
    assert.deepEqual(message.primaryCta,baseline.primaryCta,'primary result CTAs are unchanged');
    assert.equal(message.subject,baseline.subject);
    assert.equal(message.idempotencyKey,`fcc-round_result-${candidate.leagueId}-${candidate.roundId}-${candidate.playerId}`);
    if(consent.marketing===true) {
      assertTelegramSection(message,baseline.primaryCta.label);
      assert.equal(message.includesTelegram,true);
      assert.match(message.text,/Manage promotional email preferences/);
    } else {
      assert.doesNotMatch(message.html+message.text,/FCCCompetitions/);
      assert.equal(message.includesTelegram,false);
    }
    await h.run(); assert.equal(h.sent.length,1,'Telegram does not change delivery deduplication');
  }
}

// Elimination variants remain byte-for-byte unchanged, even with next-round data.
for(const outcome of ['eliminated_loss','eliminated_draw','eliminated_no_pick']) {
  const candidate=resultCandidate(outcome);
  assert.deepEqual(renderServiceEmail({...candidate,nextRound:survivorCandidates[0].nextRound},origin),
    renderServiceEmail(candidate,origin));
}
const withoutCta=data=>{
  const candidates=candidatesFor(data);
  assert.ok(candidates.length>0,'presentation guards must not suppress result recipients');
  for(const candidate of candidates) {
    assert.equal(candidate.nextRound,null);
    const message=renderServiceEmail(candidate,origin);
    assert.doesNotMatch(message.text,/MAKE YOUR PICK|Next deadline|Invalid Date|undefined/);
    assert.doesNotMatch(message.html,/MAKE YOUR PICK|Next deadline|Invalid Date|undefined/);
    assert.doesNotMatch(message.html+message.text,/FCCCompetitions/);
  }
};
withoutCta({...survivorSnapshot,league:{...survivorSnapshot.league,status:'completed'}});
withoutCta({...survivorSnapshot,picks:survivorSnapshot.picks.filter(pick=>pick.player_id!==id(11))}); // sole survivor/winner
withoutCta({...survivorSnapshot,rounds:[finalRound]});
withoutCta({...survivorSnapshot,league:{...survivorSnapshot.league,current_round:1}});
for(const overrides of [
  {status:'locked'},{status:'completed'},{finalized_at:now.toISOString()},
  {round_number:3},{league_id:id(99)},{pick_deadline_utc:'invalid'},
  {pick_deadline_utc:null},{pick_deadline_utc:now.toISOString()},
]) withoutCta({...survivorSnapshot,rounds:[finalRound,{...nextRound,...overrides}]});
const winter=candidatesFor({...survivorSnapshot,rounds:[finalRound,{...nextRound,pick_deadline_utc:'2027-01-09T11:00:00Z'}]})[0];
assert.match(renderServiceEmail(winter,origin+'/').text,/Sat 9 Jan · 11:00/,'UK formatting also handles GMT');
assert.ok(renderServiceEmail(winter,origin+'/').text.includes(`MAKE YOUR PICK: ${origin}/make-pick?league_id=${id(1)}`));

// Read real repository snapshots and refresh presentation during the existing recheck.
let emailSnapshot=survivorSnapshot;
const emailDatabase={from(table){
  let columns; const filters=new Map();
  const result=()=>{
    if(table==='leagues') { assert.equal(columns,'id,name,current_round,status,is_test'); return {data:emailSnapshot.league,error:null}; }
    if(table==='rounds'&&columns==='id,league_id') return {data:emailSnapshot.rounds.filter(round=>
      round.status===filters.get('status')
      && (!filters.has('gte:pick_deadline_utc')||Date.parse(round.pick_deadline_utc)>=Date.parse(filters.get('gte:pick_deadline_utc')))
      && (!filters.has('in:id')||filters.get('in:id').includes(round.id))
      && (!filters.has('lte:pick_deadline_utc')||Date.parse(round.pick_deadline_utc)<=Date.parse(filters.get('lte:pick_deadline_utc')))),error:null};
    return {data:emailSnapshot[table],error:null};
  };
  const query={select(value){columns=value;return query;},eq(key,value){filters.set(key,value);return query;},
    is(){return query;},not(){return query;},in(key,value){filters.set(`in:${key}`,value);return query;},gte(key,value){filters.set(`gte:${key}`,value);return query;},lte(key,value){filters.set(`lte:${key}`,value);return query;},order(){return query;},range(){return query;},
    maybeSingle(){return Promise.resolve(result());},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
  return query;
}};
const emailRepository=createSupabaseServiceEmailRepository(emailDatabase,{resultsStartAt});
survivorCandidates=(await emailRepository.discover(now)).candidates;
assert.deepEqual(survivorCandidates[0].nextRound,{roundNumber:2,deadlineUtc:nextRound.pick_deadline_utc,alreadyPicked:false});
emailSnapshot={...survivorSnapshot,rounds:[finalRound,{...nextRound,pick_deadline_utc:'2026-10-17T12:30:00Z'}]};
h=harness([survivorCandidates[0]],{recheck:candidate=>emailRepository.recheck(candidate,now)});
summary=await h.run(); assert.equal(summary.resultsSent,1);
assert.match(h.sent[0].text,/Sat 17 Oct · 13:30/,'pre-send recheck refreshes the persisted deadline');
emailSnapshot={...survivorSnapshot,league:{...survivorSnapshot.league,status:'completed'}};
h=harness([survivorCandidates[1]],{recheck:candidate=>emailRepository.recheck(candidate,now)});
summary=await h.run(); assert.equal(summary.resultsSent,1,'completion only affects presentation');
assert.doesNotMatch(h.sent[0].text,/MAKE YOUR PICK|Next deadline/,'recheck clears stale next-round data');

// A next-round pick submitted between discovery and delivery changes presentation,
// without suppressing the result notification itself.
emailSnapshot={...survivorSnapshot,picks:[...survivorSnapshot.picks,
  {round_id:nextRound.id,player_id:id(10),team_id:id(21),status:'pending'}]};
h=harness([candidatesFor(survivorSnapshot)[0]],{recheck:candidate=>emailRepository.recheck(candidate,now)});
summary=await h.run();
assert.equal(summary.resultsSent,1);
assert.match(h.sent[0].text,/next-round pick is already submitted/);
assert.doesNotMatch(h.sent[0].text+h.sent[0].html,/MAKE YOUR PICK/);
assert.ok(h.sent[0].text.includes(`VIEW COMPETITION: ${origin}/leaderboard?view=leaderboard&league_id=${id(1)}`));

// Discovery and the pre-send snapshot both enforce the fixed result cutoff.
emailSnapshot=cutoffSnapshot;
for(const value of [undefined,'invalid','2026-09-30T00:00:00Z']) {
  const restricted=createSupabaseServiceEmailRepository(emailDatabase,{resultsStartAt:value});
  assert.equal((await restricted.discover(now)).candidates.filter(c=>c.eventType==='round_result').length,0);
  assert.equal(await restricted.recheck(resultCandidate(),now),false);
}
emailSnapshot={...cutoffSnapshot,rounds:[{...finalRound,pick_deadline_utc:'2026-09-27T12:00:00Z'}]};
h=harness([resultCandidate()],{recheck:candidate=>emailRepository.recheck(candidate,now)});
summary=await h.run();
assert.equal(summary.resultsSent,0,'changed persisted deadline is checked immediately before sending');
assert.equal(h.claims,1); assert.equal(h.state.size,0,'blocked result claim is released');
assert.deepEqual(approvedResultEmailExceptionRoundIds,[
  '12bcb92e-4649-4006-9d14-489a8bf4eb10',
  'a21ee081-fe55-410a-b6f3-60b3fb234eef',
  'e9ee31fd-0135-454f-b86d-d12e59fd145f',
  '64f222d4-e4c2-4c4d-9e82-3e38d4a2dccb',
]);
const excludedRoundId='ef648874-e568-4b9c-8550-0fdb4fef8252';
assert.equal(parseResultEmailExceptionRoundIds(`${excludedRoundId},invalid,${id(2)}`).size,0);
assert.equal(parseResultEmailExceptionRoundIds().size,0);
for(const exceptionId of approvedResultEmailExceptionRoundIds) {
  const historicalCutoff='2026-10-25T00:00:00Z';
  const exceptionRound={...finalRound,id:exceptionId,pick_deadline_utc:'2026-10-23T17:30:00Z'};
  emailSnapshot={...cutoffSnapshot,rounds:[exceptionRound],picks:cutoffSnapshot.picks.map(pick=>({...pick,round_id:exceptionId}))};
  const exceptionConfig=`invalid,${excludedRoundId}, ${exceptionId.toUpperCase()},${exceptionId}`;
  assert.deepEqual([...parseResultEmailExceptionRoundIds(exceptionConfig)],[exceptionId]);
  const exceptionRepository=createSupabaseServiceEmailRepository(emailDatabase,{
    resultsStartAt:historicalCutoff,resultsExceptionRoundIds:exceptionConfig,
  });
  const discovered=(await exceptionRepository.discover(now)).candidates;
  assert.equal(discovered.length,1,'an approved finalised pre-cutoff round is discovered');
  assert.equal(discovered[0].eventType,'round_result');
  assert.equal(await exceptionRepository.recheck(discovered[0],now),true);
  const withoutException=createSupabaseServiceEmailRepository(emailDatabase,{resultsStartAt:historicalCutoff});
  assert.equal((await withoutException.discover(now)).candidates.length,0,'exceptions are opt-in');
  assert.equal(await withoutException.recheck(discovered[0],now),false,'removal blocks the pre-send recheck');
  h=harness(discovered,{recheck:candidate=>exceptionRepository.recheck(candidate,now),marketing:false});
  assert.equal((await h.run()).resultsSent,1);
  assert.doesNotMatch(h.sent[0].html+h.sent[0].text,/FCCCompetitions/);
  await h.run(); assert.equal(h.sent.length,1,'exception results retain deduplication');
  h=harness(discovered,{recheck:candidate=>exceptionRepository.recheck(candidate,now),marketingError:true});
  await h.run(); assert.doesNotMatch(h.sent[0].html+h.sent[0].text,/FCCCompetitions/);
  for(const invalidCutoff of [undefined,'invalid']) {
    const invalidRepository=createSupabaseServiceEmailRepository(emailDatabase,{
      resultsStartAt:invalidCutoff,resultsExceptionRoundIds:exceptionId,
    });
    assert.equal((await invalidRepository.discover(now)).candidates.length,0,'exceptions require a valid cutoff');
    assert.equal(await invalidRepository.recheck(discovered[0],now),false);
  }
  emailSnapshot={...emailSnapshot,rounds:[{...exceptionRound,status:'locked',finalized_at:null}]};
  assert.equal((await exceptionRepository.discover(now)).candidates.length,0,'locked exceptions cannot send results');
  assert.equal(await exceptionRepository.recheck(discovered[0],now),false);
  emailSnapshot={...emailSnapshot,rounds:[{...exceptionRound,finalized_at:null}]};
  assert.equal(await exceptionRepository.recheck(discovered[0],now),false,'finalisation timestamp is required');
  emailSnapshot={...emailSnapshot,rounds:[exceptionRound],picks:emailSnapshot.picks.map(pick=>({...pick,status:'eliminated',reason:'loss'}))};
  assert.equal((await exceptionRepository.discover(now)).candidates.length,0,'zero survivors still suppress exception results');
  emailSnapshot={...emailSnapshot,picks:cutoffSnapshot.picks.map(pick=>({...pick,round_id:exceptionId})),
    rounds:[{...exceptionRound,pick_deadline_utc:historicalCutoff}]};
  assert.equal((await exceptionRepository.discover(now)).candidates.length,1,'normal and exception discovery deduplicate the same round');
  emailSnapshot={...emailSnapshot,rounds:[exceptionRound],league:{...emailSnapshot.league,is_test:true}};
  assert.equal((await exceptionRepository.discover(now)).candidates.length,0,'test competitions stay excluded');
  assert.equal(await exceptionRepository.recheck(discovered[0],now),false);
}
emailSnapshot={...cutoffSnapshot,rounds:[{...finalRound,id:excludedRoundId,pick_deadline_utc:'2026-10-23T17:30:00Z'}],
  picks:cutoffSnapshot.picks.map(pick=>({...pick,round_id:excludedRoundId}))};
const approvedExceptions=new Set(approvedResultEmailExceptionRoundIds);
assert.equal(evaluateResults(emailSnapshot,excludedRoundId,now,'2026-10-25T00:00:00Z',
  new Set([...approvedExceptions,excludedRoundId])).candidates.length,0,'POF123 cannot bypass the cutoff even through direct evaluation');
const excludedRepository=createSupabaseServiceEmailRepository(emailDatabase,{
  resultsStartAt:'2026-10-25T00:00:00Z',resultsExceptionRoundIds:[...approvedExceptions,excludedRoundId].join(','),
});
assert.equal((await excludedRepository.discover(now)).candidates.length,0,'POF123 stays out of discovery');
assert.equal(await excludedRepository.recheck({...resultCandidate(),roundId:excludedRoundId},now),false);
const markRounds=Array.from({length:5},(_,index)=>({
  id:index===4?markRolloverRoundId:id(201+index),league_id:markRolloverLeagueId,round_number:index+1,
  status:'completed',pick_deadline_utc:index===4?'2026-10-23T17:30:00Z':'2026-09-12T12:30:00Z',
  finalized_at:index===0?null:'2026-10-25T21:00:00Z',
}));
const markMembers=Array.from({length:91},(_,index)=>({...member(id(1000+index)),is_active:false}));
const markPicks=markMembers.map((entry,index)=>({
  player_id:entry.player_id,round_id:markRounds[index%5].id,team_id:index%3===2?null:id(20),
  status:index%3===2?'no-pick':'eliminated',reason:['loss','draw','no-pick'][index%3],
}));
const markSnapshot=snapshot({league:{id:markRolloverLeagueId,name:'Mark (FPL)',status:'active',current_round:5},
  rounds:markRounds,memberships:markMembers,picks:markPicks});
emailSnapshot=markSnapshot;
const markRepository=createSupabaseServiceEmailRepository(emailDatabase,{
  resultsStartAt:'2026-10-25T00:00:00Z',resultsExceptionRoundIds:approvedResultEmailExceptionRoundIds.join(','),
});
const markCandidates=(await markRepository.discover(now)).candidates;
assert.equal(markCandidates.length,91,'the final zero-survivor notice reaches original members, including earlier eliminations');
assert.ok(markCandidates.every(candidate=>candidate.roundId===markRolloverRoundId&&candidate.resultVariant==='mark_rollover'));
const consentingPlayers=new Set(markMembers.slice(0,7).map(entry=>entry.player_id));
h=harness(markCandidates,{marketing:playerId=>consentingPlayers.has(playerId),recheck:candidate=>markRepository.recheck(candidate,now)});
assert.equal((await h.run()).resultsSent,91);
assert.equal(h.sent.filter(message=>message.text.includes(markRolloverJoinUrl)).length,7);
for(const [index,message] of h.sent.entries()) {
  assert.match(message.text,new RegExp(`eliminated in Round ${index%5+1}`));
  assert.match(message.text,/91 entered.*five rounds/);
  assert.match(message.text,/Nobody won the £50 prize/);
  assert.match(message.text,/£50 has rolled over into Mark FPL v2/);
  assert.match(message.text,/beginning GW9 on 31 October/);
  assert.match(message.text,/Your original entry does not transfer/);
  assert.match(message.text,/join the new league separately/);
  assert.doesNotMatch(message.text+message.html,/FCCCompetitions|YOU SURVIVED|You're through|YOU WON/);
  assert.equal(message.idempotencyKey,`fcc-round_result-${markRolloverLeagueId}-${markRolloverRoundId}-${markMembers[index].player_id}`);
  if(index<7) {
    assert.match(message.text,/JOIN MARK FPL v2/);
    assert.match(message.text,/Manage promotional email preferences/);
  } else {
    assert.doesNotMatch(message.text+message.html,/\/j\/mark-fpl-rollover|JOIN MARK FPL v2/);
    assert.match(message.text,/VIEW ORIGINAL RESULTS/);
    assert.ok(message.text.includes(`view=eliminations&league_id=${markRolloverLeagueId}`));
  }
}
await h.run();assert.equal(h.sent.length,91,'competition-ending emails retain the existing round-result delivery keys');
h=harness([markCandidates[0]],{marketingError:true,recheck:candidate=>markRepository.recheck(candidate,now)});
assert.equal((await h.run()).resultsSent,1);
assert.doesNotMatch(h.sent[0].text+h.sent[0].html,/\/j\/mark-fpl-rollover|FCCCompetitions/);
assert.equal(await markRepository.recheck(markCandidates[0],now),true,'legacy completed-round outcomes remain usable without rewriting history');
emailSnapshot={...markSnapshot,rounds:markRounds.map(round=>round.id===markRolloverRoundId?{...round,status:'locked'}:round)};
assert.equal((await markRepository.discover(now)).candidates.length,0);
assert.equal(await markRepository.recheck(markCandidates[0],now),false);
emailSnapshot={...markSnapshot,rounds:markRounds.map(round=>round.id===markRolloverRoundId?{...round,finalized_at:null}:round)};
assert.equal((await markRepository.discover(now)).candidates.length,0);
emailSnapshot={...markSnapshot,picks:[...markPicks,{round_id:markRolloverRoundId,player_id:id(999),status:'pending',reason:null}]};
assert.equal((await markRepository.discover(now)).candidates.length,0,'pending outcomes prevent a no-winner assertion');
emailSnapshot={...markSnapshot,picks:markPicks.filter(pick=>pick.round_id!==markRolloverRoundId)};
assert.equal((await markRepository.discover(now)).candidates.length,0,'an empty terminal round is not evidence of a rollover');
emailSnapshot={...markSnapshot,picks:markPicks.map((pick,index)=>index===4?{...pick,status:'through',reason:null}:pick)};
assert.ok((await markRepository.discover(now)).candidates.every(candidate=>candidate.resultVariant!=='mark_rollover'));
assert.equal(await markRepository.recheck(markCandidates[0],now),false,'a surviving player cancels rollover eligibility');
emailSnapshot={...markSnapshot,picks:markPicks.map((pick,index)=>index===0?{...pick,round_id:markRounds[1].id}:pick)};
assert.equal(await markRepository.recheck(markCandidates[0],now),false,'changed individual elimination round is rechecked');
emailSnapshot={...markSnapshot,memberships:[...markMembers,{...member(id(999)),joined_at:'2026-10-24T00:00:00Z'}],
  picks:[...markPicks,{round_id:markRounds[0].id,player_id:id(999),status:'eliminated',reason:'loss'}]};
assert.equal((await markRepository.discover(now)).candidates.length,91,'late memberships cannot expand the original audience');
emailSnapshot={...markSnapshot,picks:markPicks.filter(pick=>pick.player_id!==markMembers[0].player_id)};
assert.equal((await markRepository.discover(now)).candidates.length,90,'unknown historical outcomes are not invented');
assert.throws(()=>renderServiceEmail({...markCandidates[0],leagueId:id(1)},origin),/Invalid Mark rollover/);
assert.throws(()=>renderServiceEmail({...markCandidates[0],outcome:'through'},origin),/Invalid Mark rollover/);
emailSnapshot=snapshot();
const reminderOnlyRepository=createSupabaseServiceEmailRepository(emailDatabase);
const reminderOnlyCandidates=(await reminderOnlyRepository.discover(now)).candidates;
assert.equal(reminderOnlyCandidates.length,1,'missing result cutoff preserves upcoming reminder discovery');
h=harness(reminderOnlyCandidates,{recheck:candidate=>reminderOnlyRepository.recheck(candidate,now)});
assert.equal((await h.run()).remindersSent,1,'missing result cutoff preserves reminder delivery');
emailSnapshot={...emailSnapshot,picks:[{round_id:id(2),player_id:id(10),team_id:id(20),status:'pending'}]};
assert.equal(await reminderOnlyRepository.recheck(reminder,now),false,'a newly submitted pick suppresses a reminder at recheck');
// Test competitions never send service emails, even without a pilot allowlist.
emailSnapshot=snapshot({league:{...snapshot().league,is_test:true}});
assert.equal(reminderCandidates(emailSnapshot,id(2)).length,0);
assert.equal((await reminderOnlyRepository.discover(now)).candidates.length,0);
assert.equal(await reminderOnlyRepository.recheck(reminder,now),false,'a league switched to test after discovery is blocked');
emailSnapshot={...survivorSnapshot,league:{...survivorSnapshot.league,is_test:true}};
assert.equal(resultCandidates(emailSnapshot,id(2)).candidates.length,0);
assert.equal((await emailRepository.discover(now)).candidates.length,0);
h=harness([resultCandidate()],{recheck:candidate=>emailRepository.recheck(candidate,now)});
assert.equal((await h.run({pilotAllowlist:undefined})).resultsSent,0);
assert.equal(h.sent.length,0,'test league result cannot reach an external recipient');

// Promotion needs authoritative consent, while service delivery never does.
for(const options of [{},{marketing:false},{marketingError:true}]) {
  h=harness([reminder],options); summary=await h.run();
  assert.equal(summary.remindersSent,1);
  assert.doesNotMatch(h.sent[0].html+h.sent[0].text,/FCCCompetitions/);
}
h=harness([reminder],{marketing:true}); await h.run();
assertTelegramSection(h.sent[0],'MAKE MY PICK');
assert.match(h.sent[0].text,/Manage promotional email preferences:.*\/email-preferences/);
assert.doesNotMatch(renderServiceEmail(reminder,origin).html,/FCCCompetitions/,'template defaults to service-only');
for(const preference of [null,{marketing_opt_in:false,consented_email:'10@example.test'},
  {marketing_opt_in:true,consented_email:'old@example.test'},
  {marketing_opt_in:true,consented_email:'10@example.test'}]) {
  const preferenceRepo=createSupabaseServiceEmailRepository({from(table){
    assert.equal(table,'marketing_preferences','legacy profile consent is never read');
    return {select(){return this;},eq(column,value){assert.equal(column,'user_id');assert.equal(value,id(10));return this;},
      async maybeSingle(){return {data:preference,error:null};}};
  }});
  assert.equal(await preferenceRepo.allowsMarketing(id(10),'10@example.test'),preference?.marketing_opt_in===true&&preference?.consented_email==='10@example.test');
}
const unavailablePreferences=createSupabaseServiceEmailRepository({from(){return {
  select(){return this;},eq(){return this;},async maybeSingle(){return {data:null,error:{message:'unavailable'}};},
};}});
assert.equal(await unavailablePreferences.allowsMarketing(id(10),'10@example.test'),false);
h=harness([reminder],{marketing:true});
await h.run({pilotAllowlist:'owner@example.test'});
assert.equal(h.sent.length,0); assert.equal(h.claims,0);
await h.run({pilotAllowlist:undefined});
assert.equal(h.sent.length,1,'removing the pilot permits a previously blocked candidate');

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
  assert.equal(response.body.service_email_status,200);
  let finishEmails;
  const pendingEmails=new Promise(resolve=>{finishEmails=resolve;});
  let emailStageStarted;
  const emailStageReady=new Promise(resolve=>{emailStageStarted=resolve;});
  const pendingResponse=tickResponse();
  const pendingTick=tickHandler({method:'GET',headers:{authorization:'Bearer tick-secret'},query:{}},pendingResponse,{
    ...dependencies,async runServiceEmails(){emailStageStarted();return pendingEmails;},
  });
  await emailStageReady;
  assert.equal(pendingResponse.body,null,'acknowledgement waits for the email stage');
  finishEmails({status:200,body:emailSummary});
  await pendingTick;
  assert.equal(pendingResponse.body.service_email_status,200);

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
  assert.equal(response.body.service_email_status,502);
  for(const emailStatus of [207,502,503]) {
    response=tickResponse();
    await tickHandler({method:'GET',headers:{authorization:'Bearer tick-secret'},query:{}},response,{
      ...dependencies,async runServiceEmails(){return {status:emailStatus,body:{error:'email failure'}};},
    });
    assert.equal(response.statusCode,200,'lifecycle success remains independent of email status');
    assert.equal(response.body.service_email_status,emailStatus,'email status is visible in the acknowledgement');
  }
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

const timeoutDb=new PGlite();
try {
  await timeoutDb.exec(`create role anon; create role authenticated; create role service_role; create schema vault; create schema net; create schema cron;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table vault.secrets(id uuid,name text);
    insert into vault.secrets values('${id(8001)}','fcc_tick_url'),('${id(8002)}','fcc_tick_cron_secret');
    create table cron.job(jobid bigint,jobname text,schedule text,active boolean,username text,command text);
    insert into cron.job values(1,'fcc-global-lms-tick','*/15 * * * *',true,'postgres','select public.invoke_fcc_global_tick();');
    create table net._http_response(id bigint,created timestamptz,status_code int,timed_out boolean,error_msg text);
    insert into vault.decrypted_secrets values ('fcc_tick_url','https://example.test/api/tick'),('fcc_tick_cron_secret','test-secret');
    create function net.http_get(url text,headers jsonb,timeout_milliseconds integer) returns bigint language sql as
      'select case when url = ''https://example.test/api/tick'' and headers->>''Authorization'' = ''Bearer test-secret''
        then timeout_milliseconds::bigint else -1::bigint end';
    create function public.invoke_fcc_global_tick() returns bigint language sql as 'select 10000::bigint';
    revoke all on function public.invoke_fcc_global_tick() from public,anon,authenticated;
    grant execute on function public.invoke_fcc_global_tick() to service_role;`);
  const beforeTimeout=await timeoutDb.query("select oid,proowner,proacl from pg_proc where oid='public.invoke_fcc_global_tick()'::regprocedure");
  const beforeCron=await timeoutDb.query('select * from cron.job');
  const beforeVault=await timeoutDb.query('select * from vault.secrets order by name');
  await timeoutDb.exec(await readFile('sql/2026-10-25-fcc-tick-http-timeout.sql','utf8'));
  assert.deepEqual((await timeoutDb.query("select oid,proowner,proacl from pg_proc where oid='public.invoke_fcc_global_tick()'::regprocedure")).rows,
    beforeTimeout.rows,'timeout replacement preserves function identity, owner and exact ACL');
  assert.deepEqual((await timeoutDb.query('select * from cron.job')).rows,beforeCron.rows,'cron schedule and job are untouched');
  assert.deepEqual((await timeoutDb.query('select * from vault.secrets order by name')).rows,beforeVault.rows,'Vault secrets are untouched');
  await timeoutDb.exec(await readFile('sql/2026-10-25-fcc-tick-deployment-checks.sql','utf8'));
  assert.equal(Number((await timeoutDb.query('select public.invoke_fcc_global_tick() as timeout')).rows[0].timeout),310000);
  await timeoutDb.exec('set role anon');
  await assert.rejects(timeoutDb.query('select public.invoke_fcc_global_tick()'),/permission denied/);
  await timeoutDb.exec('reset role; delete from vault.decrypted_secrets');
  assert.equal((await timeoutDb.query('select public.invoke_fcc_global_tick() as request')).rows[0].request,null);
  const vercel=JSON.parse(await readFile('vercel.json','utf8'));
  assert.equal(vercel.functions['api/tick.ts'].maxDuration,300);
} finally { await timeoutDb.close(); }

// Validate the SELECT-only production preview against disposable tables and
// compare historical/post-cutoff outcomes, without credentials or network calls.
const previewDb=new PGlite();
try {
  await previewDb.exec(`create schema auth;
    create table auth.users(id uuid, email text, email_confirmed_at timestamptz);
    create table leagues(id uuid, join_code text, deleted_at timestamptz, is_test boolean);
    create table rounds(id uuid,league_id uuid,round_number int,status text,pick_deadline_utc timestamptz,finalized_at timestamptz);
    create table memberships(league_id uuid,player_id uuid,joined_at timestamptz);
    create table picks(round_id uuid,player_id uuid,status text,reason text);
    create table service_email_deliveries(league_id uuid,round_id uuid,player_id uuid,event_type text,status text,attempt_count int,claimed_at timestamptz);
    insert into auth.users values('${id(10)}','player@example.test',now());
    insert into leagues values('${id(1)}','FCCLMS',null,false);
    insert into memberships values('${id(1)}','${id(10)}',null);
    insert into rounds values
      ('${id(2)}','${id(1)}',1,'completed','2026-10-24T12:00:00Z',now()),
      ('${id(3)}','${id(1)}',2,'completed','2026-10-25T00:00:00Z',now());
    insert into picks values('${id(2)}','${id(10)}','through',null),('${id(3)}','${id(10)}','through',null);`);
  const previewSql=await readFile('sql/2026-10-24-service-email-rollout-preview.sql','utf8');
  const rows=(await previewDb.query(previewSql)).rows;
  assert.equal(rows.length,2);
  assert.equal(rows.find(row=>row.round_number===1).rollout_scope,'BLOCKED_HISTORICAL');
  assert.equal(rows.find(row=>row.round_number===2).rollout_scope,'POST_CUTOFF');
  assert.ok(rows.every(row=>Number(row.claimable_without_cutoff)===1));
  await previewDb.exec(`insert into service_email_deliveries values
    ('${id(1)}','${id(3)}','${id(10)}','round_result','sent',1,now());`);
  const sent=(await previewDb.query(previewSql)).rows.find(row=>row.round_number===2);
  assert.equal(Number(sent.claimable_without_cutoff),0);
  assert.equal(Number(sent.already_sent),1);
  await previewDb.exec('update leagues set is_test=true');
  assert.equal((await previewDb.query(previewSql)).rows.length,0,'preview excludes test competitions');
} finally { await previewDb.close(); }

const weekendDb=new PGlite();
try {
  await weekendDb.exec(`create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table leagues(id uuid primary key,status text,current_round int,is_test boolean,deleted_at timestamptz);
    create table rounds(id uuid primary key,league_id uuid,round_number int,status text,pick_deadline_utc timestamptz,finalized_at timestamptz);
    create table memberships(league_id uuid,player_id uuid,joined_at timestamptz);
    create table picks(round_id uuid,player_id uuid,status text,reason text);
    create table marketing_preferences(user_id uuid,marketing_opt_in boolean,consented_email text);
    create table service_email_deliveries(id uuid,league_id uuid,round_id uuid,player_id uuid,event_type text,status text,attempt_count int,claimed_at timestamptz);
    insert into leagues values('${markRolloverLeagueId}','active',5,false,null);`);
  for(const round of markRounds) await weekendDb.query('insert into rounds values($1,$2,$3,$4,$5,$6)',
    [round.id,round.league_id,round.round_number,round.status,round.pick_deadline_utc,round.finalized_at]);
  for(const [index,entry] of markMembers.entries()) {
    const email=`player${index}@example.test`;
    await weekendDb.query('insert into auth.users values($1,$2,now())',[entry.player_id,email]);
    await weekendDb.query('insert into memberships values($1,$2,$3)',[markRolloverLeagueId,entry.player_id,entry.joined_at]);
    await weekendDb.query('insert into marketing_preferences values($1,$2,$3)',[entry.player_id,index<7,email]);
    const pick=markPicks[index];
    await weekendDb.query('insert into picks values($1,$2,$3,$4)',[pick.round_id,pick.player_id,pick.status,pick.reason]);
  }
  for(const [index,leagueId] of ['f6f3e1be-8c00-4174-8172-2d078fb09cb3','088ee7c0-660e-4b68-ab6f-a75032ff9cc2','a0a73aa0-d9c6-43e9-bbe3-03ae90312ee2'].entries()) {
    const roundId=approvedResultEmailExceptionRoundIds[index+1],roundNumber=[2,3,1][index];
    await weekendDb.query('insert into leagues values($1,$2,$3,false,null)',[leagueId,'active',roundNumber]);
    await weekendDb.query('insert into rounds values($1,$2,$3,$4,$5,now())',[roundId,leagueId,roundNumber,'completed','2026-10-23T17:30:00Z']);
    const playerId=id(3000+index);
    await weekendDb.query('insert into auth.users values($1,$2,now())',[playerId,`other${index}@example.test`]);
    await weekendDb.query('insert into memberships values($1,$2,null)',[leagueId,playerId]);
    await weekendDb.query('insert into picks values($1,$2,$3,null)',[roundId,playerId,'through']);
  }
  const sql=await readFile('sql/2026-10-25-weekend-result-email-preview.sql','utf8');
  const runPreview=async()=>{
    const results=await weekendDb.exec(sql);
    return {states:results.find(result=>result.rows.some(row=>'persisted_picks' in row)).rows,
      recipients:results.find(result=>result.rows.some(row=>'email_type' in row))?.rows??[]};
  };
  let preview=await runPreview();
  assert.equal(preview.states.length,4);
  assert.equal(preview.recipients.length,94);
  let markRows=preview.recipients.filter(row=>row.competition==='MARKPL');
  assert.equal(markRows.length,91);
  assert.equal(markRows.filter(row=>row.includes_mark_join_invitation).length,7);
  assert.ok(markRows.every(row=>row.template==='mark_rollover'&&!row.includes_telegram&&Number(row.claimable_recipients)===91));
  assert.ok(markRows.filter(row=>!row.marketing_permitted).every(row=>!row.primary_cta_destination.includes('mark-fpl-rollover')));
  assert.ok(markRows.filter(row=>row.marketing_permitted).every(row=>row.primary_cta_destination===markRolloverJoinUrl));
  assert.ok(preview.recipients.filter(row=>row.competition!=='MARKPL').every(row=>row.template==='standard_result'));
  for(const row of markRows) {
    const index=markMembers.findIndex(entry=>entry.player_id===row.player_id);
    assert.equal(row.individual_outcome_round,index%5+1);
    assert.equal(row.outcome,markCandidates[index].outcome,'SQL and application outcomes agree');
  }
  for(const [index,leagueId] of ['f6f3e1be-8c00-4174-8172-2d078fb09cb3','088ee7c0-660e-4b68-ab6f-a75032ff9cc2','a0a73aa0-d9c6-43e9-bbe3-03ae90312ee2'].entries()) {
    await weekendDb.query('insert into marketing_preferences values($1,true,$2)',[id(3000+index),`other${index}@example.test`]);
    for(const [outcomeIndex,outcome] of ['eliminated_loss','eliminated_draw','eliminated_no_pick'].entries()) {
      const playerId=id(4000+index*3+outcomeIndex),email=`result${index}-${outcomeIndex}@example.test`;
      await weekendDb.query('insert into auth.users values($1,$2,now())',[playerId,email]);
      await weekendDb.query('insert into memberships values($1,$2,null)',[leagueId,playerId]);
      await weekendDb.query('insert into marketing_preferences values($1,true,$2)',[playerId,email]);
      await weekendDb.query('insert into picks values($1,$2,$3,$4)',[approvedResultEmailExceptionRoundIds[index+1],playerId,
        outcome==='eliminated_no_pick'?'no-pick':'eliminated',outcome==='eliminated_no_pick'?'no-pick':outcome==='eliminated_draw'?'draw':'loss']);
    }
  }
  preview=await runPreview();
  let normalRows=preview.recipients.filter(row=>row.competition!=='MARKPL');
  assert.equal(normalRows.length,12);
  assert.ok(normalRows.every(row=>row.marketing_permitted&&row.includes_telegram),'SQL includes every consented normal result outcome');
  for(const row of normalRows) {
    const rendered=renderServiceEmail({...resultCandidate(row.outcome),leagueId:row.primary_cta_destination.split('league_id=')[1]},origin,{includeTelegram:true});
    assert.equal(row.includes_telegram,rendered.includesTelegram,'preview agrees with rendered Telegram sections');
    assert.equal(row.primary_cta_destination,rendered.primaryCta.url);
  }
  await weekendDb.query('update marketing_preferences set marketing_opt_in=false where user_id=$1',[id(4000)]);
  await weekendDb.query('update marketing_preferences set consented_email=$1 where user_id=$2',['old@example.test',id(4001)]);
  await weekendDb.query('delete from marketing_preferences where user_id=$1',[id(4002)]);
  preview=await runPreview();normalRows=preview.recipients.filter(row=>row.competition!=='MARKPL');
  assert.equal(normalRows.filter(row=>row.includes_telegram).length,9);
  assert.ok(normalRows.filter(row=>[id(4000),id(4001),id(4002)].includes(row.player_id)).every(row=>!row.includes_telegram),
    'SQL suppresses promotion for refused, changed-email and missing consent');
  assert.ok(preview.recipients.filter(row=>row.competition==='MARKPL').every(row=>!row.includes_telegram),'MARKPL stays excluded');
  await weekendDb.query('insert into service_email_deliveries values($1,$2,$3,$4,$5,$6,1,now())',
    [id(9000),markRolloverLeagueId,markRolloverRoundId,markMembers[0].player_id,'round_result','sent']);
  preview=await runPreview();markRows=preview.recipients.filter(row=>row.competition==='MARKPL');
  assert.ok(markRows.every(row=>Number(row.claimable_recipients)===90));
  assert.equal(markRows.find(row=>row.player_id===markMembers[0].player_id).claimable,false);
  await weekendDb.query('update auth.users set email=$1 where id=$2',['changed@example.test',markMembers[1].player_id]);
  preview=await runPreview();
  assert.equal(preview.recipients.find(row=>row.player_id===markMembers[1].player_id).includes_mark_join_invitation,false);
  await weekendDb.query('update rounds set status=$1,finalized_at=null where id=$2',['locked',markRolloverRoundId]);
  preview=await runPreview();assert.equal(preview.recipients.filter(row=>row.competition==='MARKPL').length,0);
  await weekendDb.query('update rounds set status=$1,finalized_at=now() where id=$2',['completed',markRolloverRoundId]);
  await weekendDb.query('update picks set status=$1,reason=null where round_id=$2 and player_id=$3',['pending',markRolloverRoundId,markMembers[4].player_id]);
  preview=await runPreview();assert.equal(preview.recipients.filter(row=>row.competition==='MARKPL').length,0);
} finally { await weekendDb.close(); }

console.log('PASS: service email eligibility, templates, switches, allowlist, recheck, retries, deduplication and atomic ledger claims');
