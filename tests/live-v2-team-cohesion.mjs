import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Formation = require('../match-engine/formation-behaviour-v2.js');
const Adapter = require('../match-engine/live-v2-authority-adapter.js');
const dependencies = Object.fromEntries([
  ['ball', 'ball-engine-v2'], ['movement', 'movement-engine-v2'], ['cpu', 'cpu-intelligence-v2'],
  ['formation', 'formation-behaviour-v2'], ['contact', 'live-v2-contact-authority-composer'], ['dribbling', 'dribbling-state-v2']
].map(([key, file]) => [key, require(`../match-engine/${file}.js`)]));
const back = output => output.targets.filter(p => ['centre-back', 'full-back', 'wing-back'].includes(p.roleFamily));
const spread = rows => Math.max(...rows.map(p => p.target.x)) - Math.min(...rows.map(p => p.target.x));
function shape(x, y = 0, vx = 0, options = {}) {
  return Formation.resolve({ formation: '4-4-2', phase: 'defend', tick: 1,
    pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 }, attackingDirection: 1, offsideLine: 105,
    ball: { position: { x, y }, velocity: { x: vx, y: 0 }, free: true }, ...options });
}

test('the defending block advances and shifts across together with the ball', () => {
  const deep = shape(30, -18), high = shape(75, 18);
  assert.ok(back(high)[0].target.x - back(deep)[0].target.x > 25);
  assert.ok(back(high)[0].target.y - back(deep)[0].target.y > 10);
  assert.ok(spread(back(high)) < .001);
  const lowRows = deep.targets.filter(p => p.position !== 'GK');
  const highRows = high.targets.filter(p => p.position !== 'GK');
  assert.ok(spread(highRows) <= 32);
  for (let i = 1; i < lowRows.length; i++) {
    assert.ok(Math.abs((highRows[i].target.x - lowRows[i].target.x) -
      (highRows[0].target.x - lowRows[0].target.x)) < .001, 'the block translates as one unit');
  }
});

test('an incoming ball makes the entire line drop before it travels behind them', () => {
  const still = shape(65), incoming = shape(65, 0, -20), clearance = shape(65, 0, 20);
  assert.ok(back(incoming)[0].target.x < back(still)[0].target.x - 10);
  assert.ok(back(clearance)[0].target.x > back(still)[0].target.x + 5);
  assert.ok(spread(back(incoming)) < .001);
});

test('cohesion preserves mirrored and reduced formations and philosophy-owned attacking duties', () => {
  for (const formation of Formation.FORMATION_INVENTORY) {
    for (const unavailableSlotIds of [[], [Formation.FORMATIONS[formation].slots.find(p => p.position === 'CB').id]]) {
      const options = { formation, unavailableSlotIds };
      const left = shape(70, 15, -8, options);
      const right = shape(35, -15, 8, { ...options, attackingDirection: -1, offsideLine: 0, mirrorLateral: true });
      assert.equal(left.targets.length, 11 - unavailableSlotIds.length);
      assert.ok(spread(back(left)) < .001, formation);
      const line = back(left).slice().sort((a, b) => a.target.y - b.target.y);
      assert.ok(line.slice(1).every((p, i) => p.target.y - line[i].target.y < 17), 'a dismissal must not open a hole between centre and wide defenders');
      for (let i = 0; i < left.targets.length; i++) {
        assert.ok(Math.abs(left.targets[i].target.x + right.targets[i].target.x - 105) < .001);
        assert.ok(Math.abs(left.targets[i].target.y + right.targets[i].target.y) < .001);
      }
    }
  }
  for (const overlay of Object.values(Formation.PHILOSOPHY_OVERLAYS)) {
    const defending = shape(68, 0, 0, { formation: overlay.baseFormation, philosophy: overlay.id });
    assert.ok(spread(back(defending)) < .001);
    const attacking = shape(78, 0, 0, { formation: overlay.baseFormation, philosophy: overlay.id, phase: 'settled-attack' });
    assert.ok(attacking.targets.some(p => p.instruction !== 'balanced'));
    assert.equal(attacking.telemetry.philosophy.id, overlay.id);
  }
});

function snapshot(ownerTeam = 'opp') {
  const state = JSON.parse(readFileSync(new URL('./fixtures/corner-loose-ball-seed-2415640915.json', import.meta.url))).snapshot;
  const owner = state.players.find(p => p.teamId === ownerTeam && p.position === 'CM');
  Object.assign(owner, { x: state.pitch.xMin + 70 * state.units.xPerMetre, y: 1071, vx: 0, vy: 0 });
  Object.assign(state.ball, { x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, zv: 0,
    ownerId: owner.id, targetId: null, flightType: '', lastKickerId: owner.id, lastKickerTeamId: ownerTeam, launchIntent: null });
  return state;
}
function plan(state, workflow = 'cpu-v-cpu') {
  const run = Adapter.createAttachment({ enabled: true, seed: 7, dependencies,
    capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow, online: false,
      onlineMarkers: {}, controlOwnership: { humanPlayerIds: state.humanPlayerIds,
        cpuTeamIds: workflow === 'cpu-v-cpu' ? ['you', 'opp'] : ['opp'] } }),
    host: { prepareTick() { return { commit() {}, rollback() {} }; } } });
  const frame = run.planTick(state);
  assert.ok(frame, JSON.stringify(run.status()));
  assert.equal(run.commitTick(frame), true);
  return frame;
}

test('live adapter supplies ball context in spectator and single-player ownership modes', () => {
  for (const workflow of ['cpu-v-cpu', 'single-player']) {
    const ownerTeam = workflow === 'single-player' ? 'you' : 'opp';
    const defendingTeam = ownerTeam === 'you' ? 'opp' : 'you';
    const high = snapshot(ownerTeam), low = structuredClone(high);
    if (workflow === 'single-player') {
      high.humanPlayerIds = low.humanPlayerIds = [high.players.find(p => p.teamId === 'you' && !p.isGK).id];
    }
    const delta = 30 * low.units.xPerMetre;
    low.ball.x -= delta;
    low.players.find(p => p.id === low.ball.ownerId).x -= delta;
    const a = plan(high, workflow), b = plan(low, workflow);
    assert.ok(Math.abs(back(a.formation[defendingTeam])[0].target.x - back(b.formation[defendingTeam])[0].target.x) > 20);
    assert.ok(a.formation[defendingTeam].telemetry.cohesion);
  }
});

test('a defensive cover target stays with the back line instead of following a distant carrier', () => {
  const state = snapshot();
  const originalDecide = dependencies.cpu.decide;
  const defender = state.players.find(p => p.teamId === 'you' && p.position === 'CB');
  const scriptedCpu = { ...dependencies.cpu, decide(input, memory, config) {
    const result = originalDecide(input, memory, config);
    if (input.teamId === 'you') result.defensiveIntents = [{ playerId: defender.id, type: 'cover',
      target: { x: 70, y: 25 }, targetSpeed: .8, urgency: 'run' }];
    return result;
  } };
  let commands;
  const movement = { ...dependencies.movement, advance(world, input, ...rest) {
    commands = input;
    return dependencies.movement.advance(world, input, ...rest);
  } };
  const run = Adapter.createAttachment({ enabled: true, seed: 9,
    dependencies: { ...dependencies, cpu: scriptedCpu, movement },
    capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow: 'cpu-v-cpu',
      online: false, onlineMarkers: {}, controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] } }),
    host: { prepareTick() { return { commit() {}, rollback() {} }; } } });
  const frame = run.planTick(state);
  assert.ok(frame, JSON.stringify(run.status()));
  const anchor = frame.formation.you.targets.find(p => p.playerId === defender.id).target;
  const x = (defender.x - state.pitch.xMin) / state.units.xPerMetre;
  const y = (defender.y - (state.pitch.yMin + state.pitch.yMax) / 2) / state.units.yPerMetre;
  const towards = { x: anchor.x - x, y: anchor.y - y }, length = Math.hypot(towards.x, towards.y);
  const command = commands.find(row => row.playerId === defender.id && row.type === 'move');
  assert.ok(command);
  assert.ok(command.move.x * towards.x / length + command.move.y * towards.y / length > .999,
    'cover movement must travel toward the connected line anchor');
});
