import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createCohesionMetrics } from '../tools/cohesion-metrics.mjs';
const require = createRequire(import.meta.url);
const CPU = require('../match-engine/cpu-intelligence-v2.js');
const Adapter = require('../match-engine/live-v2-authority-adapter.js');
const dependencies = Object.fromEntries([
  ['ball', 'ball-engine-v2'], ['movement', 'movement-engine-v2'], ['cpu', 'cpu-intelligence-v2'],
  ['formation', 'formation-behaviour-v2'], ['contact', 'live-v2-contact-authority-composer'], ['dribbling', 'dribbling-state-v2']
].map(([key, file]) => [key, require(`../match-engine/${file}.js`)]));
function snapshot(x = 55, y = 34) {
  const player = (id, position, px, py, teamId = 'you') => ({ id, teamId, position,
    x: px, y: py, formationAnchor: { x: px, y: py }, pace: 80, awareness: 85,
    passing: 82, control: 80, shooting: 75, defending: 75, acceleration: 80 });
  return { tick: 1, fixedTickSeconds: 1 / 60, teamId: 'you', possessionTeamId: 'you', carrierId: 'carrier',
    attackingDirection: 1, offsideLine: 95, pitch: { xMin: 0, xMax: 105, yMin: 0, yMax: 68 }, ball: { x, y },
    players: [player('carrier', 'ST', x, y), player('left-link', 'CM', 49, 25), player('right-link', 'CM', 53, 43),
      player('back-one', 'CB', 30, 25), player('back-two', 'CB', 30, 43), player('opposition', 'CB', 90, 34, 'opp')] };
}
test('midfield creates a return outlet and a forward link that travel with the carrier', () => {
  const a = CPU.decide(snapshot()), b = CPU.decide(snapshot(61, 40));
  assert.deepEqual(a.supportIntents.map(p => p.type), ['return-outlet', 'forward-link']);
  for (let i = 0; i < 2; i++) {
    const target = a.supportIntents[i].target;
    assert.ok(Math.hypot(target.x - 55, target.y - 34) >= 7);
    assert.ok(Math.hypot(target.x - 55, target.y - 34) <= 14);
    assert.ok(b.supportIntents[i].target.x > target.x + 4);
    assert.ok(b.supportIntents[i].target.y > target.y);
  }
  assert.ok(a.supportIntents[0].target.x < 55 && a.supportIntents[1].target.x > 55);
});
test('support mirrors, respects offside, follows the receiver in flight, and excludes humans and dismissals', () => {
  const state = snapshot(), original = CPU.decide(state).supportIntents;
  const mirrored = structuredClone(state);
  mirrored.attackingDirection = -1; mirrored.offsideLine = 10;
  mirrored.ball.x = 105 - mirrored.ball.x;
  for (const p of mirrored.players) { p.x = 105 - p.x; p.formationAnchor.x = 105 - p.formationAnchor.x; }
  const reflected = CPU.decide(mirrored).supportIntents;
  for (let i = 0; i < 2; i++) assert.ok(Math.abs(original[i].target.x + reflected[i].target.x - 105) < .002);
  state.carrierId = null; state.intendedReceiverId = 'carrier'; state.inFlight = true; state.offsideLine = 57;
  assert.equal(CPU.decide(state).supportIntents.length, 2);
  assert.ok(CPU.decide(state).supportIntents.every(p => p.target.x < 57));
  state.players.find(p => p.id === 'left-link').humanControlled = true;
  state.players.find(p => p.id === 'right-link').sentOff = true;
  assert.equal(CPU.decide(state).supportIntents.length, 0);
  state.possessionTeamId = 'opp'; state.carrierId = 'opposition';
  assert.equal(CPU.decide(state).supportIntents.length, 0);
});
test('a nearby midfielder presses after the rated read while the protected back pair remains intact', () => {
  const state = snapshot();
  state.possessionTeamId = 'opp'; state.carrierId = 'opposition';
  Object.assign(state.players.find(p => p.id === 'opposition'), { x: 55, y: 34 });
  Object.assign(state.players.find(p => p.id === 'carrier'), { x: 90, y: 60 });
  Object.assign(state.players.find(p => p.id === 'left-link'), { x: 53, y: 34 });
  let memory = null, decision;
  for (let tick = 1; tick <= 12; tick++) {
    state.tick = tick; decision = CPU.decide(state, memory); memory = decision.memory;
  }
  assert.ok(decision.defensiveIntents.some(p => p.playerId === 'left-link' && p.type === 'press'));
  assert.equal(decision.supportIntents.length, 0);
});
test('the adapter follows support while authored receptions and physical loose recovery take priority', () => {
  for (const route of ['support', 'reception', 'recovery']) {
    const state = JSON.parse(readFileSync(new URL('./fixtures/corner-loose-ball-seed-2415640915.json', import.meta.url))).snapshot;
    const owner = state.players.find(p => p.teamId === 'you' && p.position === 'CM');
    const link = state.players.find(p => p.teamId === 'you' && p.position === 'CM' && p.id !== owner.id);
    Object.assign(state.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, zv: 0, ownerId: owner.id,
      targetId: null, launchIntent: null, flightType: '', isShot: false });
    const x = (link.x - state.pitch.xMin) / state.units.xPerMetre;
    const y = (link.y - (state.pitch.yMin + state.pitch.yMax) / 2) / state.units.yPerMetre;
    if (route === 'recovery') Object.assign(state.ball, { ownerId: null, lastKickerId: null,
      x: link.x, y: link.y + 2 * state.units.yPerMetre });
    let commands;
    const cpu = { ...CPU, decide(input, memory, config) {
      const result = CPU.decide(input, memory, config);
      result.runs = []; result.defensiveIntents = []; result.supportIntents = [];
      result.carrierIntent = { type: 'wait' };
      if (input.teamId === 'you') {
        result.supportIntents = [{ playerId: link.id, target: { x: x + 5, y } }];
        if (route === 'reception') result.carrierIntent = { type: 'pass', targetPlayerId: link.id, target: { x, y: y + 5 } };
      }
      return result;
    } };
    const movement = { ...dependencies.movement, advance(world, input, ...rest) {
      commands = input; return dependencies.movement.advance(world, input, ...rest);
    } };
    const run = Adapter.createAttachment({ enabled: true, seed: 9, cpuPassRaceFilter: false,
      dependencies: { ...dependencies, cpu, movement },
      capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow: 'cpu-v-cpu', online: false,
        onlineMarkers: {}, controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] } }),
      host: { prepareTick: () => ({ commit() {}, rollback() {} }) } });
    const frame = run.planTick(state);
    assert.ok(frame, JSON.stringify(run.status()));
    const command = commands.find(p => p.playerId === link.id && p.type === 'move');
    assert.ok(command);
    assert.ok(route === 'support' ? command.move.x > .99 : command.move.y > .99);
  }
});
test('midfield observations count clear short lanes, angular spread, final-third entries and genuine loose recoveries', () => {
  const metrics = createCohesionMetrics();
  const players = [
    { id: 'owner', team: 'you', family: 'striker', x: 55, y: 34 },
    { id: 'left', team: 'you', family: 'central-midfielder', x: 49, y: 26 },
    { id: 'right', team: 'you', family: 'central-midfielder', x: 61, y: 42 },
    { id: 'back', team: 'you', family: 'centre-back', x: 30, y: 34 },
    { id: 'other', team: 'opp', family: 'centre-back', x: 90, y: 34 }
  ];
  metrics.sample({ players, ball: { x: 55, y: 34 }, possessionTeam: 'you', ownerId: 'owner' });
  let result = metrics.snapshot();
  assert.equal(result.support.shortOptions.mean, 2);
  assert.equal(result.support.midfieldCarrierDistance.mean, 10);
  assert.equal(result.support.midfieldSupportAngleDegrees.mean, 180);
  for (let tick = 0; tick < 8; tick++) metrics.possession({ loose: false });
  metrics.possession({ owner: players[1] });
  assert.equal(metrics.snapshot().contests.looseRecoveries, 0, 'a pass reception is not a second ball');
  for (let tick = 0; tick < 6; tick++) metrics.possession({ loose: true });
  metrics.possession({ owner: players[1] });
  metrics.event({ type: 'pass', progress: .60 });
  metrics.event({ type: 'pass-resolved', completed: true, progress: .75 });
  result = metrics.snapshot();
  assert.deepEqual(result.contests, { looseRecoveries: 1, midfieldWins: 1 });
  assert.equal(result.progression.completedIntoFinalThird, 1);
});
