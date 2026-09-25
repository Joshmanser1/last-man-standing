import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { PGlite } from '@electric-sql/pglite';

// Actual migration in disposable PostgreSQL; no production credentials or writes.
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const league = id(1), round = id(2);
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create type pick_status as enum ('pending','through','eliminated','no-pick');
  create type pick_reason as enum ('loss','draw','no-pick');
  create table leagues (id uuid primary key, current_round int, status text, deleted_at timestamptz);
  create table rounds (id uuid primary key, league_id uuid, round_number int, status text, pick_deadline_utc timestamptz);
  create table memberships (league_id uuid, player_id uuid, is_active boolean, primary key(league_id, player_id));
  create table fixtures (id uuid primary key, round_id uuid, home_team_id uuid, away_team_id uuid, result text, winning_team_id uuid);
  create table picks (id uuid primary key, league_id uuid, round_id uuid, player_id uuid, team_id uuid, status pick_status, reason pick_reason,
    unique(round_id, player_id));
`);
await db.exec(await readFile('sql/2026-09-25-round-finalisation.sql', 'utf8'));
async function seed() {
  await db.exec('truncate picks, fixtures, memberships, rounds, leagues');
  await db.query('insert into leagues values ($1,1,\'active\',null)', [league]);
  await db.query('insert into rounds (id,league_id,round_number,status,pick_deadline_utc) values ($1,$2,1,\'upcoming\',now())', [round, league]);
  for (let i = 0; i < 5; i++) {
    await db.query('insert into memberships values ($1,$2,true)', [league, id(10+i)]);
    if (i < 4) await db.query('insert into picks values ($1,$2,$3,$4,$5,\'pending\',null)',
      [id(40+i), league, round, id(10+i), id(i===3 ? 20 : 20+i)]);
  }
  await db.query("insert into fixtures values ($1,$2,$3,$4,'home_win',$3),($5,$2,$6,$7,'draw',null)",
    [id(30),round,id(20),id(21),id(31),id(22),id(23)]);
}
async function finalize(lockOnly = false, winners = null) {
  return (await db.query('select finalize_fcc_round($1,$2,$3,$4::uuid[]) result', [league,round,!lockOnly,winners])).rows[0].result;
}
const rows = table => db.query(`select * from ${table} order by ${table === 'memberships' ? 'player_id' : 'id'}`).then(r => r.rows);
async function bundle(path, requireMock = ()=>{throw Error('Unexpected import');}) {
  const result = await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent',external:['@supabase/supabase-js']});
  const module={exports:{}};
  new Function('module','exports','require',result.outputFiles[0].text)(module,module.exports,requireMock);
  return module.exports;
}
try {
  await seed();
  await assert.rejects(finalize(), /Lock the round/);
  await finalize(true);
  assert.equal((await rows('memberships'))[4].is_active, false, 'missed pick persists inactive at lock');
  const result = await finalize();
  assert.equal(result.survivors,2);
  const picks = await rows('picks');
  assert.deepEqual(picks.map(p => [p.status,p.reason]), [['through',null],['eliminated','loss'],['eliminated','draw'],['through',null]]);
  assert.deepEqual((await rows('memberships')).map(m=>m.is_active),[true,false,false,true,false]);
  assert.equal((await rows('leagues'))[0].status,'active');
  const before = JSON.stringify(await rows('rounds'));
  assert.equal((await finalize()).already_finalized,true);
  assert.equal(JSON.stringify(await rows('rounds')),before,'repeat leaves finalisation time unchanged');
  await assert.rejects(db.query("update picks set team_id=$1 where id=$2",[id(21),id(40)]),/already finalised/);
  await assert.rejects(db.query('delete from picks where id=$1',[id(40)]),/locked/);
  await assert.rejects(db.query("update fixtures set result='draw',winning_team_id=null where id=$1",[id(30)]),/already finalised/);
  await assert.rejects(db.query("insert into picks values ($1,$2,$3,$4,$5,'pending',null)",[id(90),league,round,id(14),id(20)]),/already finalised/);

  // Inject a late mutation failure: all preceding pick/member writes must roll back.
  await seed(); await finalize(true);
  await db.exec(`create function fail_completion() returns trigger language plpgsql as $$ begin
    if new.status = 'completed' then raise exception 'injected write failure'; end if; return new; end $$;
    create trigger fail_completion before update on rounds for each row execute function fail_completion();`);
  await assert.rejects(finalize(),/injected write failure/);
  assert.ok((await rows('picks')).every(p=>p.status==='pending'));
  assert.deepEqual((await rows('memberships')).map(m=>m.is_active),[true,true,true,true,false]);
  assert.equal((await rows('rounds'))[0].status,'locked');
  assert.equal((await rows('rounds'))[0].finalized_at,null);
  await db.exec('drop trigger fail_completion on rounds');
  assert.equal((await finalize()).survivors,2,'retry succeeds after rollback');

  for (const table of ['picks','memberships','leagues','fixtures']) {
    await seed(); await finalize(true);
    const snapshot = JSON.stringify(await Promise.all(['picks','memberships','rounds','leagues','fixtures'].map(rows)));
    await db.exec(`create or replace function fail_write() returns trigger language plpgsql as $$ begin
      raise exception 'injected ${table} failure'; end $$;
      create trigger fail_write before update on ${table} for each row execute function fail_write();`);
    await assert.rejects(finalize(false, table === 'fixtures' ? [id(20)] : null),new RegExp(`injected ${table} failure`));
    assert.equal(JSON.stringify(await Promise.all(['picks','memberships','rounds','leagues','fixtures'].map(rows))),snapshot);
    await db.exec(`drop trigger fail_write on ${table}`);
  }

  await seed(); await finalize(true);
  await db.exec("update fixtures set result='draw',winning_team_id=null");
  assert.equal((await finalize()).survivors,0);
  assert.equal((await rows('leagues'))[0].status,'active','zero survivors is not a normal completion');
  assert.ok((await rows('memberships')).every(m=>!m.is_active));

  await seed();
  await db.query('delete from picks where id=$1',[id(43)]);
  await finalize(true);
  assert.equal((await finalize()).winner_player_id,id(10));
  assert.equal((await rows('leagues'))[0].status,'completed');

  await seed(); await finalize(true);
  await assert.rejects(finalize(false,[id(20),id(21)]),/Both opponents/);
  assert.ok((await rows('picks')).every(p=>p.status==='pending'));
  assert.equal((await finalize(false,[id(20)])).survivors,2,'manual uses same finaliser');
  await seed(); await finalize(true);
  await db.exec("update fixtures set result='not_set',winning_team_id=null");
  await assert.rejects(finalize(),/incomplete/);
  await assert.rejects(db.query("insert into picks values ($1,$2,$3,$4,$5,'pending',null)",[id(90),league,round,id(14),id(20)]),/locked/);

  await db.exec('set role authenticated');
  await assert.rejects(finalize(),/permission denied/);
  await db.exec('reset role');

  const { runLeagueLifecycle } = await bundle('server/tickLifecycle.ts');
  const reports=[];
  const fake = {
    async rpc(_, args) { return args.p_finalize ? {error:{message:'injected RPC failure'},data:null} : {data:{locked:true},error:null}; },
    from(table) {
      let mode, value, head;
      const q={insert(){mode='insert';return q;},update(v){mode='update';value=v;return q;},select(_,options){head=options?.head;return q;},eq(){return q;},
        limit(){return q;},not(){return q;},is(){return q;},
        single(){return q;},maybeSingle(){return q;},then(resolve){
          if(table==='tick_runs') {if(mode==='update')reports.push(value); return Promise.resolve({data:{id:'run'},error:null}).then(resolve);}
          if(table==='rounds')return Promise.resolve({data:head?null:{id:round,status:'locked',round_number:1},count:1,error:null}).then(resolve);
          if(table==='leagues')return Promise.resolve({data:[{id:league,current_round:1,status:'active'}],error:null}).then(resolve);
          if(table==='fixtures')return Promise.resolve({data:[{result:'home_win',winning_team_id:id(20)}],error:null}).then(resolve);
          throw Error('Unexpected query '+table);
        }};return q;
    }
  };
  const actions=[];
  await assert.rejects(runLeagueLifecycle({supabase:fake,league:{id:league,current_round:1,status:'active'},now:new Date(),actions}),/injected RPC failure/);
  assert.equal(reports.at(-1).status,'error');
  assert.ok(!actions.some(a=>a.step==='evaluate_complete'));
  const tick = (await bundle('api/tick.ts',()=>({createClient:()=>fake}))).default;
  Object.assign(process.env,{SUPABASE_URL:'https://unused.invalid',SUPABASE_SERVICE_ROLE_KEY:'local-test-not-a-real-key',CRON_SECRET:'local-test'});
  let response;
  await tick({method:'GET',headers:{authorization:'Bearer local-test'},query:{}},
    {statusCode:0,setHeader(){},end(body){response={status:this.statusCode,...JSON.parse(body)};}});
  assert.equal(response.status,502);
  assert.equal(response.ok,false);
  assert.ok(response.actions.some(a=>a.step==='league_error'));
  assert.equal(reports.at(-1).status,'error','global tick does not report a failed league as successful');

  const duplicate = {from(){let inserting=false; const q={insert(){inserting=true;return q;},select(){return q;},eq(){return q;},single(){return q;},maybeSingle(){return q;},then(resolve){return Promise.resolve(inserting?{error:{code:'23505'}}:{data:{status:'error'},error:null}).then(resolve);}};return q;}};
  await assert.rejects(runLeagueLifecycle({supabase:duplicate,league:{id:league},now:new Date(),actions:[]}),/Previous league tick failed/);

  const { loadLeaguePicks } = await bundle('server/leaguePicks.ts');
  const many = Array.from({length:1203},(_,i)=>({id:id(1000+i),league_id:league,round_id:id(2+i%3),player_id:id(10+i%5),team_id:id(20+i%4)}));
  const pages={from(){let after=''; const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},gt(_,v){after=v;return q;},then(resolve){return Promise.resolve({data:many.filter(p=>p.id>after).slice(0,100),error:null}).then(resolve);}};return q;}};
  assert.deepEqual(await loadLeaguePicks(pages,league),many,'loads beyond API row cap');
  const { indexPlayerRoundPicks }=await bundle('src/lib/pickIndex.ts');
  const rounds=[{id:round,league_id:league,round_number:1},{id:id(3),league_id:league,round_number:2}];
  const submitted=[picks[0],picks[1],{...picks[0],id:id(60),round_id:id(3),team_id:id(23)}];
  const indexed=indexPlayerRoundPicks(league,rounds,[...submitted,{...picks[0],id:'synthetic',synthetic:true,status:'no-pick'}, {...picks[0],league_id:id(99)}]);
  assert.equal(indexed.get(id(10)).get(1).id,id(40));
  assert.equal(indexed.get(id(11)).get(1).id,id(41));
  assert.equal(indexed.get(id(10)).get(2).team_id,id(23));
  assert.equal(indexed.get(id(11)).get(2),undefined);

  const memberRows=Array.from({length:1203},(_,i)=>({league_id:league,player_id:id(5000+i),is_active:i%2===0,role:'player'}));
  const memberClient={auth:{getUser:async()=>({data:{user:{id:id(10)}},error:null})},from(table){
    let after='',ids;
    const q={select(){return q;},eq(){return q;},is(){return q;},order(){return q;},limit(){return q;},gt(_,v){after=v;return q;},in(_,v){ids=v;return q;},maybeSingle(){return q;},then(resolve){
      const data=table==='leagues'?{id:league,created_by:id(10)}:table==='memberships'?memberRows.filter(m=>m.player_id>after).slice(0,100):ids.map(id=>({id,display_name:'Player '+id}));
      return Promise.resolve({data,error:null}).then(resolve);
    }};return q;
  }};
  const membersApi=(await bundle('api/league-members.ts',()=>({createClient:()=>memberClient}))).default;
  process.env.SUPABASE_ANON_KEY='local-test';
  let membersResponse;
  await membersApi({method:'POST',headers:{authorization:'Bearer local-test'},body:{league_id:league}},
    {statusCode:0,setHeader(){},end(body){membersResponse={status:this.statusCode,body:JSON.parse(body)};}});
  assert.equal(membersResponse.status,200);
  assert.equal(membersResponse.body.length,1203);
  assert.equal(membersResponse.body.at(-1).display_name,'Player '+id(6202));
  console.log('PASS: finalisation, rollback, retries, outcomes, missed picks, manual path, permissions, tick failures, pagination and player/round mapping');
} finally { await db.close(); }
