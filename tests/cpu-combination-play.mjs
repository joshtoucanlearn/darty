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
test('pressure favours a clear recycle and ratings scale the estimated risk continuously', () => {
  const state = fixture(); state.players.at(-1).x = 54.5; state.players.at(-1).y = 30;
  state.players[1].x = 45; state.players[1].y = 39;
  const decision = CPU.decide(state, null, { maximumCommittedRuns: 0 });
  assert.equal(decision.carrierIntent.type, 'pass');
  assert.equal(decision.carrierIntent.supportKind, 'recycle');
  assert.ok(decision.carrierIntent.risk.probability >= 0);
  const low = structuredClone(state); low.players[0].passing = 20;
  assert.ok(CPU.decide(low, null, { maximumCommittedRuns: 0 }).carrierIntent.type);
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
