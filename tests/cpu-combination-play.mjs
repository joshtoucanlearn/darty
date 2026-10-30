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
  for (const [x, kind] of [[80, 'early'], [94, 'byline'], [100, 'cut-back']]) {
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
  driver.tick=2;driver.players[0].x=96;driver.ball.x=96;
  assert.equal(CPU.decide(driver).carrierIntent.reason,'wide-carrier-drive-for-byline',
    'a free drive continues past the old early-service stop into actual cutback depth');
  driver.tick=3;driver.players[0].x=100;driver.ball.x=100;
  const delivery=CPU.decide(driver).carrierIntent;
  assert.equal(delivery.type,'cross');assert.equal(delivery.crossKind,'cut-back');
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
    return CPU.decide(state,null,{maximumCommittedRuns:0}).carrierIntent;
  };
  let low=0,high=0;const skills=new Set();
  for(let i=0;i<96;i++){
    const a=sample('escape-'+i,15),b=sample('escape-'+i,95);
    if(a.type==='take-on'&&a.skill)low++;
    if(b.type==='take-on'&&b.skill){high++;skills.add(b.skill);assert.ok(b.target.x>60);assert.ok(Math.abs(b.target.y-34)>2);}
    for(const action of [sample('escape-'+i,95,true),sample('escape-'+i,95,false,1.6)])if(action.type==='take-on'&&action.skill)skills.add(action.skill);
  }
  assert.ok(low>0);assert.ok(high>low);
  assert.ok(skills.has('roulette'));assert.ok(skills.has('stepover')||skills.has('dragBack'));
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
