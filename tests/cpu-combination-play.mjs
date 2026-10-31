import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createCombinationMetrics } from '../tools/combination-metrics.mjs';
const require = createRequire(import.meta.url), CPU = require('../match-engine/cpu-intelligence-v2.js');
function fixture(tick = 1) {
  const p = (id, position, x, y, teamId = 'you') => ({ id, position, x, y, teamId,
    formationAnchor: { x, y }, pace: 85, awareness: 90, passing: 90, control: 90, vx: 0, vy: 0 });
  return { tick, fixedTickSeconds: 1 / 60, teamId: 'you', possessionTeamId: 'you', carrierId: 'origin',
    attackingDirection: 1, offsideLine: 96, pitch: { xMin: 0, xMax: 105, yMin: 0, yMax: 68 }, ball: { x: 52, y: 30 },
    players: [p('origin', 'CM', 52, 30), p('link', 'AM', 60, 38), p('third', 'ST', 63, 24),
      p('back-a', 'CB', 30, 22), p('back-b', 'CB', 30, 46), p('opponent', 'CB', 94, 50, 'opp')] };
}
test('actual pass flight preserves runs and sends the releasing player and third man forward', () => {
  let first = CPU.decide(fixture());
  let state = fixture(2); state.carrierId = null; state.inFlight = true; state.intendedReceiverId = 'link';
  const flight = CPU.decide(state, first.memory);
  assert.ok(!flight.telemetry.transitions.some(t => t.type === 'run-aborted' && t.reason === 'possession-lost'));
  assert.deepEqual(flight.supportIntents.filter(p => ['give-and-go', 'third-man'].includes(p.type)).map(p => p.type), ['give-and-go', 'third-man']);
  assert.ok(flight.firstTimeIntent, 'the receiver can prepare a physical one-touch layoff during flight');
  assert.equal(flight.firstTimeIntent.reason, 'third-man-layoff');
  const run = flight.supportIntents.find(p => p.type === 'give-and-go');
  assert.ok(run.target.x > 52);
  state = fixture(3); state.carrierId = 'link'; state.players[0].x = 63; state.players[0].vx = 4;
  const receipt = CPU.decide(state, flight.memory);
  assert.equal(receipt.carrierIntent.reason, 'give-and-go-return');
  assert.equal(receipt.carrierIntent.targetPlayerId, 'origin');
  assert.ok(receipt.carrierIntent.target.x > state.players[0].x);
  assert.deepEqual(CPU.decide(state, JSON.parse(JSON.stringify(flight.memory))), receipt);
});
test('third man receives the layoff when the return runner is marked', () => {
  let state = fixture(), initial = CPU.decide(state);
  state = fixture(2); Object.assign(state, { carrierId: null, inFlight: true, intendedReceiverId: 'link' });
  const flight = CPU.decide(state, initial.memory);
  state = fixture(3); state.carrierId = 'link'; state.players[0].x = 63;
  Object.assign(state.players.at(-1), { x: 63.5, y: 30 });
  Object.assign(state.players[2], { x: 66, y: 46 });
  const decision = CPU.decide(state, flight.memory);
  assert.equal(decision.carrierIntent.reason, 'third-man-layoff');
  assert.equal(decision.carrierIntent.targetPlayerId, 'third');
});
test('rejected requests cannot start combinations; turnover and dismissal cancel them', () => {
  const first = CPU.decide(fixture());
  const held = CPU.decide(fixture(2), first.memory);
  assert.equal(held.memory.combination.move, null);
  let state = fixture(3); Object.assign(state, { carrierId: null, inFlight: true, intendedReceiverId: 'link' });
  const flight = CPU.decide(state, held.memory);
  state = fixture(4); state.possessionTeamId = 'opp'; state.carrierId = 'opponent';
  assert.equal(CPU.decide(state, flight.memory).memory.combination.move, null);
  state = fixture(4); state.players[0].sentOff = true;
  assert.equal(CPU.decide(state, flight.memory).memory.combination.move, null);
});
test('pressure chooses the clean support lane and ratings scale its estimated risk continuously', () => {
  const state = fixture(); state.players.at(-1).x = 54.5; state.players.at(-1).y = 30;
  state.players[1].x = 45; state.players[1].y = 39;
  const decision = CPU.decide(state, null, { maximumCommittedRuns: 0 });
  assert.equal(decision.carrierIntent.type, 'pass');
  assert.equal(decision.carrierIntent.targetPlayerId, 'link');
  const forward = decision.supportPassOptions.find(p => p.targetPlayerId === 'third');
  assert.ok(forward.risk.probability > decision.carrierIntent.risk.probability,
    'a nearby opponent covering the forward lane does not force that pass');
  assert.ok(decision.carrierIntent.risk.probability >= 0);
  const low = structuredClone(state); low.players[0].passing = 20;
  assert.ok(CPU.decide(low, null, { maximumCommittedRuns: 0 }).supportPassOptions
    .find(p=>p.targetPlayerId==='link').risk.probability > decision.carrierIntent.risk.probability);
});
test('action ledger requires two completed linked passes, progression and actual layoff metadata', () => {
  const m = createCombinationMetrics();
  const pass = (actorId, targetId, progress, time) => m.event({ type: 'pass', actorId, targetId, team: 'you', progress, time, distanceMetres: 8 });
  const resolve = (receiverId, progress, time, completed = true) => m.event({ type: 'pass-resolved', receiverId, progress, time, completed });
  pass('a', 'b', .5, 0); resolve('b', .56, 1000);
  pass('b', 'a', .56, 1200); resolve('a', .60, 2200);
  assert.equal(m.snapshot().counts.oneTwos, 1);
  pass('a', 'b', .6, 2400); resolve('b', .65, 3000);
  pass('b', 'c', .65, 3200); m.event({ type: 'v2-pass-decision', reason: 'third-man-layoff' }); resolve('c', .72, 4200);
  assert.equal(m.snapshot().counts.thirdManCombinations, 1);
  assert.equal(m.snapshot().counts.finalThirdEntries, 1);
  pass('c', 'a', .72, 4500); resolve('a', .75, 5000, false);
  assert.equal(m.snapshot().byLength['short-under-10m'].attempted, 5);
  assert.equal(m.snapshot().byLength['short-under-10m'].completed, 4);
});

test('wide final-third carriers choose early crosses, byline service and cutbacks with four distinct box slots', () => {
  for (const [x, kind] of [[80, 'early'], [103.6, 'cut-back']]) {
    const state = fixture();
    Object.assign(state.players[0], { position: 'RW', x, y: 7 });
    Object.assign(state.players[1], { position: 'ST', x: kind === 'byline' ? 97 : 94, y: 34 });
    Object.assign(state.players[2], { position: 'ST', x: 93, y: 41 });
    state.players.push({ ...state.players[1], id: 'spot', position: 'AM', x: 91, y: 30 },
      { ...state.players[1], id: 'edge', position: 'CM', x: 87, y: 43 },
      { ...state.players[1], id: 'outlet', position: 'CM', x: 78, y: 20, formationAnchor: { x: 78, y: 20 } });
    if(x===80)Object.assign(state.players.find(p=>p.teamId==='opp'),{x:82,y:7});
    state.offsideLine = 103; state.ball = { x, y: 7 };
    const decision = CPU.decide(state,null,{maximumCommittedRuns:0});
    const slots = decision.supportIntents.filter(p => p.type.startsWith('box-'));
    assert.equal(slots.length, 4);
    assert.equal(new Set(slots.map(p => p.playerId)).size, 4);
    assert.equal(new Set(slots.map(p => p.slot)).size, 4);
    assert.ok(decision.supportIntents.some(p => p.type === 'return-outlet'), 'box occupation preserves the short return outlet');
    assert.equal(decision.carrierIntent.type, 'cross', JSON.stringify(decision.carrierIntent));
    assert.equal(decision.carrierIntent.crossKind, kind);
    assert.ok(['cross', 'low-cross'].includes(decision.carrierIntent.flightType));
  }
});
test('switches need near-side congestion and a genuinely distant far-side outlet', () => {
  const state = fixture();
  Object.assign(state.players[0], { x: 55, y: 8 });
  Object.assign(state.players[1], { x: 58, y: 48 });
  Object.assign(state.players.at(-1), { x: 56, y: 12 });
  state.players.push({ ...state.players.at(-1), id: 'near-two', x: 59, y: 9 });
  const decision = CPU.decide(state,null,{maximumCommittedRuns:0});
  assert.equal(decision.carrierIntent.supportKind, 'switch', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.targetPlayerId, 'link');
  state.players.at(-1).x = 95;
  assert.notEqual(CPU.decide(state,null,{maximumCommittedRuns:0}).carrierIntent.supportKind, 'switch');
  state.players.at(-1).x = 59; state.players[1].y = 20;
  assert.notEqual(CPU.decide(state,null,{maximumCommittedRuns:0}).carrierIntent.supportKind, 'switch');
});
test('box runners continue through service, retain rest defenders and exclude sent-off players', () => {
  const state = fixture(); Object.assign(state, { carrierId: null, inFlight: true, intendedReceiverId: 'link', flightType: 'cross' });
  state.ball = { x: 89, y: 10 }; state.players[2].sentOff = true;
  state.players.push({...state.players[1],id:'service-runner',position:'ST',x:90,y:30,formationAnchor:{x:90,y:30}});
  const decision = CPU.decide(state);
  const slots = decision.supportIntents.filter(p => p.type.startsWith('box-'));
  assert.ok(slots.length);
  assert.ok(!slots.some(p => ['back-a', 'back-b', 'third'].includes(p.playerId)));
});

test('a two-player combination without an available third runner remains JSON checkpoint identical', () => {
  const state=fixture();state.players=state.players.filter(p=>p.id!=='third');
  const first=CPU.decide(state);Object.assign(state,{tick:2,carrierId:null,inFlight:true,intendedReceiverId:'link'});
  const flight=CPU.decide(state,first.memory);
  assert.equal(flight.memory.combination.move.thirdId,null);
  state.tick=3;
  assert.deepEqual(CPU.decide(state,flight.memory),CPU.decide(state,JSON.parse(JSON.stringify(flight.memory))));
});

test('a safe progressive local link takes precedence over a merely available far-side switch',()=>{
  const state=fixture();Object.assign(state.players[0],{x:55,y:8});Object.assign(state.players[1],{x:58,y:48});
  Object.assign(state.players.at(-1),{x:56,y:12});state.players.push({...state.players.at(-1),id:'near-two',x:59,y:9});
  state.players.push({...state.players[1],id:'inside-link',position:'CM',x:64,y:1,formationAnchor:{x:64,y:1}});
  const decision=CPU.decide(state,null,{maximumCommittedRuns:0});
  assert.equal(decision.carrierIntent.type,'pass');assert.notEqual(decision.carrierIntent.supportKind,'switch');
  assert.ok(decision.carrierIntent.target.x>55,JSON.stringify(decision.carrierIntent));
});
test('wide carriers can keep width on a real drive and then deliver from the byline',()=>{
  let driver;
  for(const id of ['wide-a','wide-b','wide-c','wide-d','wide-e','wide-f','wide-g','wide-h']){
    const state=fixture();state.carrierId=id;Object.assign(state.players[0],{id,position:'RW',x:80,y:7});
    Object.assign(state.players[1],{position:'ST',x:94,y:34});Object.assign(state.players[2],{position:'ST',x:93,y:41});
    state.offsideLine=103;state.ball={x:80,y:7};
    const d=CPU.decide(state);
    if(d.carrierIntent.reason==='wide-carrier-drive-for-byline'){driver=state;assert.equal(d.carrierIntent.target.y,7);assert.ok(d.carrierIntent.target.x>80);break;}
  }
  assert.ok(driver,'rated wide-drive choices should exist');
  const finalApproach=structuredClone(driver);finalApproach.players[0].x=94;finalApproach.players[0].vx=7;finalApproach.ball.x=94;
  const closeControl=CPU.decide(finalApproach).carrierIntent;
  assert.equal(closeControl.reason,'wide-carrier-drive-for-byline');assert.ok(!closeControl.knockOn,'unchanged free-roll tiers need more room than the final approach');
  driver.tick=2;driver.players[0].x=96;driver.ball.x=96;
  assert.equal(CPU.decide(driver).carrierIntent.reason,'wide-carrier-drive-for-byline',
    'a free drive continues past the old early-service stop into actual cutback depth');
  driver.tick=3;driver.players[0].x=100;driver.ball.x=100;
  assert.equal(CPU.decide(driver).carrierIntent.reason,'wide-carrier-drive-for-byline', 'free wide carries pass the old5.5m delivery stop');
  driver.tick=4;driver.players[0].x=103.6;driver.ball.x=103.6;
  const delivery=CPU.decide(driver).carrierIntent;
  assert.equal(delivery.type,'cross');assert.equal(delivery.crossKind,'cut-back');
});

test('a free far-post runner receives a byline cross while a deeper central pullback is covered',()=>{
 for(const direction of[1,-1]){
  let observed=0;
  for(let tick=20;tick<70;tick++){
   const state=fixture(tick);state.attackingDirection=direction;
   Object.assign(state.players[0],{id:'winger',position:'RW',x:103.7,y:7});state.carrierId='winger';state.ball={x:103.7,y:7};
   Object.assign(state.players[1],{id:'pullback',position:'AM',x:93,y:34});
   Object.assign(state.players[2],{id:'far-post',position:'ST',x:97,y:42});
   Object.assign(state.players.at(-1),{x:93.4,y:34});
   if(direction<0){for(const p of state.players)p.x=105-p.x;state.ball.x=105-state.ball.x;state.offsideLine=9;}
   const intent=CPU.decide(state).carrierIntent;
   if(intent.type!=='cross')continue;observed++;
   assert.equal(intent.targetPlayerId,'far-post',JSON.stringify(intent));
   assert.equal(intent.crossKind,'byline','a slightly backward ball to the far post is an aerial cross, not automatically a ground cutback');
   assert.equal(intent.flightType,'cross');
  }
  assert.ok(observed>0);
 }
});

test('a runner arriving closer to goal can still meet a low cutback first time',()=>{
 let observed=0;
 for(let tick=20;tick<70;tick++){
  const state=fixture(tick);Object.assign(state.players[0],{id:'winger',position:'RW',x:103.7,y:7});
  state.carrierId='winger';state.ball={x:103.7,y:7};
  Object.assign(state.players[1],{id:'arriving-runner',position:'ST',x:98,y:34,vx:3,fx:1,fy:0});
  Object.assign(state.players[2],{id:'far-post',position:'ST',x:97,y:46});
  Object.assign(state.players.at(-1),{x:97.4,y:46});
  const intent=CPU.decide(state).carrierIntent;if(intent.type!=='cross')continue;observed++;
  assert.equal(intent.targetPlayerId,'arriving-runner');assert.equal(intent.crossKind,'cut-back');
  assert.equal(intent.flightType,'low-cross');
 }
 assert.ok(observed>0);
});

test('box runners stay onside behind the byline carrier even after the defensive line is beaten at either end',()=>{
 for(const dir of [1,-1]){
  const s=fixture();Object.assign(s.players[0],{position:'RW',x:103.6,y:7});
  Object.assign(s.players[1],{position:'ST',x:94,y:34});Object.assign(s.players[2],{position:'ST',x:93,y:41});
  s.offsideLine=60;s.ball={x:103.6,y:7};
  if(dir<0){s.attackingDirection=-1;s.offsideLine=105-s.offsideLine;s.ball.x=105-s.ball.x;
   for(const p of s.players){p.x=105-p.x;p.formationAnchor.x=105-p.formationAnchor.x;}}
  const d=CPU.decide(s,null,{maximumCommittedRuns:0}),slots=d.supportIntents.filter(p=>p.type.startsWith('box-'));
  assert.ok(slots.length>=2);assert.ok(slots.every(p=>dir>0?p.target.x>85:p.target.x<20),JSON.stringify(slots));
  assert.equal(d.carrierIntent.type,'cross',JSON.stringify(d.carrierIntent));assert.equal(d.carrierIntent.crossKind,'cut-back');
 }
});

test('wide box occupation preserves the passer return run and third-man layoff',()=>{
  const first=CPU.decide(fixture()),state=fixture(2);
  Object.assign(state,{carrierId:null,inFlight:true,intendedReceiverId:'link'});
  Object.assign(state.players[0],{x:74,y:12});Object.assign(state.players[2],{x:77,y:25});
  Object.assign(state.players[1],{x:82,y:7});state.ball={x:78,y:7};
  const decision=CPU.decide(state,first.memory);
  assert.ok(decision.supportIntents.some(p=>p.playerId==='origin'&&p.type==='give-and-go'));
  assert.ok(decision.supportIntents.some(p=>p.playerId==='third'&&p.type==='third-man'));
  assert.ok(!decision.supportIntents.some(p=>p.type.startsWith('box-')&&['origin','third','link'].includes(p.playerId)));
  Object.assign(state,{tick:3,carrierId:'link',inFlight:false});
  Object.assign(state.players[0],{x:84,y:12});Object.assign(state.players[2],{x:86,y:23});
  const receipt=CPU.decide(state,decision.memory);
  assert.ok(['give-and-go-return','third-man-layoff'].includes(receipt.carrierIntent.reason),
    'a wide receiver completes a valid combination before starting a new cross/drive');
});

test('V2 selects real escape space for take-ons and ratings scale selection without disabling low ratings',()=>{
  const sample=(id,rating,lowChallenge=false,gap=2.7)=>{
    const state=fixture();state.carrierId=id;Object.assign(state.players[0],{id,position:'RW',x:60,y:34,control:rating,awareness:rating});
    state.players=state.players.filter(p=>!['link','third'].includes(p.id));
    Object.assign(state.players.at(-1),{x:60+gap,y:34,lowChallenge});state.ball={x:60,y:34};
    const decision=CPU.decide(state,null,{maximumCommittedRuns:0});
    return {...decision.carrierIntent,recoveryTicks:decision.memory.dribble.cooldownUntilTick-state.tick};
  };
  let low=0,high=0;const skills=new Set();
  for(let i=0;i<96;i++){
    const a=sample('escape-'+i,15),b=sample('escape-'+i,95);
    if(a.type==='take-on'&&a.skill)low++;
    if(b.type==='take-on'&&b.skill){high++;skills.add(b.skill);assert.ok(b.target.x>60);assert.ok(Math.abs(b.target.y-34)>2);}
    if(a.type==='take-on'&&b.type==='take-on')assert.ok(b.recoveryTicks<a.recoveryTicks,'higher ability shortens recovery between genuine opportunities');
    for(const action of [sample('escape-'+i,95,true),sample('escape-'+i,95,false,1.6)])if(action.type==='take-on'&&action.skill)skills.add(action.skill);
  }
  assert.ok(low>0);assert.ok(high>=low);
  assert.ok(!skills.has('roulette')&&!skills.has('stepover'),'Joshua disabled these CPU skills');
  assert.ok(skills.has('flick-up'));assert.ok(skills.has('bodyFeint')||skills.has('dragBack'));
  const state=fixture();state.players[0].skillExitTarget={x:58,y:33};
  assert.equal(CPU.decide(state).carrierIntent.reason,'finish-physical-skill-exit');
});

test('an open shot retains Stage A priority over an available combination or new cross',()=>{
  const first=CPU.decide(fixture()),flight=fixture(2);
  Object.assign(flight,{carrierId:null,inFlight:true,intendedReceiverId:'link'});
  const linked=CPU.decide(flight,first.memory),receipt=fixture(3);
  receipt.carrierId='link';Object.assign(receipt.players[1],{x:93,y:34,shooting:90});
  Object.assign(receipt.players[0],{x:95,y:25});Object.assign(receipt.players[2],{x:95,y:42});
  const decision=CPU.decide(receipt,linked.memory);
  assert.ok(decision.memory.combination.move,'the alternative combination is still active');
  assert.equal(decision.carrierIntent.type,'shot');
  assert.equal(decision.carrierIntent.reason,'goal-range-and-shot-lane-open');
});

test('a remembered combination does not veto a free deep-wide byline approach',()=>{
 let checked=0;
 for(const id of ['wide-a','wide-b','wide-c','wide-d','wide-e','wide-f','wide-g','wide-h']){
  const state=fixture(20);state.carrierId=id;state.offsideLine=103;state.ball={x:94,y:7};
  Object.assign(state.players[0],{id,position:'RW',x:94,y:7});
  Object.assign(state.players[1],{position:'ST',x:94,y:34});Object.assign(state.players[2],{position:'ST',x:93,y:41});
  const plain=CPU.decide(state);if(plain.carrierIntent.reason!=='wide-carrier-drive-for-byline')continue;
  const memory=CPU.createMemory();memory.combination.move={originId:'link',linkId:id,thirdId:'third',
   target:{x:98,y:34},thirdTarget:{x:97,y:41},expiresTick:200};
  const linked=CPU.decide(state,memory);assert.equal(linked.carrierIntent.reason,'wide-carrier-drive-for-byline');checked++;
 }
 assert.ok(checked>0);
});

test('a chosen free byline run keeps its endpoint until arrival or a real covering defender closes it',()=>{
 const state=fixture();Object.assign(state.players[0],{id:'wide-a',position:'RW',x:84,y:7});state.carrierId='wide-a';state.ball={x:84,y:7};
 const first=CPU.decide(state);assert.equal(first.carrierIntent.reason,'wide-carrier-drive-for-byline');
 assert.ok(first.carrierIntent.target.x>103,'commit the actual byline instead of rescoring after an eight-metre segment');
 Object.assign(state,{tick:180,ball:{x:95,y:7}});Object.assign(state.players[0],{x:95,y:7});
 const next=CPU.decide(state,first.memory);assert.equal(next.carrierIntent.reason,'wide-carrier-drive-for-byline');
 assert.deepEqual(next.carrierIntent.target,first.carrierIntent.target);
});

test('a free return or third man completes the combination before a new wide carry or fake cross',()=>{
 const first=CPU.decide(fixture()),flight=fixture(2);
 Object.assign(flight,{carrierId:null,inFlight:true,intendedReceiverId:'link'});
 const memory=CPU.decide(flight,first.memory).memory;
 for(const crossRead of [false,true])for(let tick=3;tick<33;tick++){
  const state=fixture(tick);state.carrierId='link';state.ball={x:93,y:7};
  Object.assign(state.players[1],{x:93,y:7});Object.assign(state.players[0],{x:95,y:14});
  Object.assign(state.players[2],{x:96,y:23});
  Object.assign(state.players.at(-1),{x:92,y:3,blockPurpose:crossRead?'cross':''});
  const decision=CPU.decide(state,memory);
  assert.ok(['give-and-go-return','third-man-layoff'].includes(decision.carrierIntent.reason),
    JSON.stringify({crossRead,tick,intent:decision.carrierIntent}));
 }
});

test('after a physical skill beats its defender a newly open combination is released instead of finishing an empty carry',()=>{
 const first=CPU.decide(fixture()),flight=fixture(2);Object.assign(flight,{carrierId:null,inFlight:true,intendedReceiverId:'link'});
 const flightMemory=CPU.decide(flight,first.memory).memory;
 const receiving=fixture(3);receiving.carrierId='link';receiving.ball={x:60,y:38};
 Object.assign(receiving.players[0],{x:58});Object.assign(receiving.players[2],{x:56});Object.assign(receiving.players.at(-1),{x:62.9,y:38});
 const extras=[['mark-origin',58,29.5],['mark-third',56,23.5],['last-back',94,60],['keeper',104,34]]
  .map(([id,x,y])=>({...receiving.players.at(-1),id,x,y,isGK:id==='keeper'}));receiving.players.push(...extras);
 const skill=CPU.decide(receiving,flightMemory);assert.equal(skill.carrierIntent.type,'take-on');assert.equal(skill.carrierIntent.skill,'bodyFeint');
 const opened=fixture(24);opened.carrierId='link';opened.ball={x:65,y:38};Object.assign(opened.players[1],{x:65,y:38,physicalSkillActive:false});
 Object.assign(opened.players[0],{x:68,vx:4});Object.assign(opened.players[2],{x:70,y:46});Object.assign(opened.players.at(-1),{x:62.9,y:38});opened.players.push(...extras);
 const released=CPU.decide(opened,skill.memory);assert.ok(['give-and-go-return','third-man-layoff'].includes(released.carrierIntent.reason),JSON.stringify(released.carrierIntent));
 Object.assign(opened.players.find(p=>p.id==='opponent'),{x:65.1,y:40});
 const angle=CPU.decide(opened,skill.memory);
 assert.ok(['give-and-go-return','third-man-layoff'].includes(angle.carrierIntent.reason),
   'a finished feint can open a safe passing angle before the attacker runs beyond the defender: '+JSON.stringify(angle.carrierIntent));
 opened.players[1].physicalSkillActive=true;
 const active=CPU.decide(opened,skill.memory);assert.equal(active.carrierIntent.type,'take-on','a physical skill still in progress must finish its actual animation');
});
