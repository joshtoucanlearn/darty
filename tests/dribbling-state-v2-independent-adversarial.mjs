import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ball = require('../match-engine/ball-engine-v2.js');
const Movement = require('../match-engine/movement-engine-v2.js');
const Dribbling = require('../match-engine/dribbling-state-v2.js');
const source = fs.readFileSync(new URL('../match-engine/dribbling-state-v2.js', import.meta.url), 'utf8');
const ballSource = fs.readFileSync(new URL('../match-engine/ball-engine-v2.js', import.meta.url), 'utf8');

function cap(workflow = 'single-player') {
  return Dribbling.createCapability({ acknowledgement: Dribbling.ACKNOWLEDGEMENT, workflow, online: false });
}

function fixture(tick, state, ballState, sourceKind = 'human') {
  const movementWorld = Movement.createWorldState({
    tick,
    fixedTickSeconds: 1 / 60,
    bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    ballOwnerId: 'p1',
    players: [
      { id: 'p1', teamId: 'you', role: 'CM', position: { x: 50 + tick * 0.05, y: 2 }, velocity: { x: 3, y: 0 }, facing: { x: 1, y: 0 }, radius: 0.34 },
      { id: 'p2', teamId: 'opp', role: 'CM', position: { x: 54, y: 2 }, velocity: { x: 0, y: 0 }, facing: { x: -1, y: 0 }, radius: 0.34 }
    ]
  });
  return {
    schema: Dribbling.REQUEST_SCHEMA,
    workflow: 'single-player', online: false, tick, epoch: 3, seed: 90210, fixedTickSeconds: 1 / 60,
    state, movementWorld, ballState,
    roster: [
      { id: 'p1', teamId: 'you', available: true, attributes: { control: 82, technique: 79, agility: 85 } },
      { id: 'p2', teamId: 'opp', available: true, attributes: { control: 70, technique: 70, agility: 70 } }
    ],
    logicalOwnerId: 'p1',
    carrierInput: { source: sourceKind, direction: { x: 1, y: 0 }, intensity: 0.7, sprint: false, shield: false },
    surface: 'dry', actionIntent: null,
    gate: { livePlay: true, restartActive: false, replayActive: false, keeperAuthority: false, offsideInvolvementPending: false, specialActionAuthority: false }
  };
}

test('independent source audit finds an explicit finite machine, no ambient randomness, and no difficulty branch', () => {
  assert.equal(createHash('sha256').update(source).digest('hex'), '61d4202d7f99bc29bf57c2769f5f286c36e293706325916eded885dfc74e8377');
  assert.equal(Dribbling.ENGINE_NAME, 'True Feel');
  assert.equal(Dribbling.CONFIG.minimumTouchCadenceTicks, 20);
  assert.equal(Dribbling.CONFIG.maximumTouchCadenceTicks, 34);
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /difficulty\s*[.\[]|difficulty\s*===|difficulty\s*>|difficulty\s*</);
  for (const phase of ['secured-control', 'touch-preparation', 'separated-touch', 'chase-recovery', 'resecure', 'heavy-touch', 'shield', 'turnover']) {
    assert.match(source, new RegExp("'" + phase + "'"));
  }
  assert.match(source, /Ball\.createBallState/);
  assert.match(source, /targetSeparationMetres/);
  assert.match(source, /ACTION_BUFFER_TICKS = 12/);
  assert.match(source, /MAX_CONSUMED_ACTION_IDS = 2048/);
  assert.match(source, /consumedActionHighWaterTick/);
  assert.match(source, /consumedActionIdsAtHighWater/);
  assert.match(source, /TOUCH_CADENCE_BASE_TICKS/);
  assert.match(source, /turn-replanned/);
  const telemetryLiteral = source.slice(source.indexOf('const telemetry = {'), source.indexOf('\n    };', source.indexOf('const telemetry = {')));
  assert.equal((telemetryLiteral.match(/\n      pressure:/g) || []).length, 1);
});

test('browser UMD exposes the same contract only when reviewed Ball V2 is supplied', () => {
  const context = { window: {}, console };
  context.window.window = context.window;
  vm.runInNewContext(ballSource, context, { filename: 'ball-engine-v2.js' });
  vm.runInNewContext(source, context, { filename: 'dribbling-state-v2.js' });
  const Browser = context.window.FootballLegacyDribblingStateV2;
  assert.equal(Browser.VERSION, Dribbling.VERSION);
  assert.equal(Browser.STATE_SCHEMA, Dribbling.STATE_SCHEMA);
  assert.deepEqual(Array.from(Browser.SUPPORTED_WORKFLOWS), ['single-player', 'cpu-v-cpu']);
});

test('independent chunk runner is byte deterministic across serialization boundaries', () => {
  const capability = cap();
  const initialState = Dribbling.createState({ epoch: 3 });
  const initialBall = Ball.createBallState({ id: 'b', position: { x: 50.4, y: 2, z: 0.11 }, velocity: { x: 3, y: 0, z: 0 }, grounded: true, regime: Ball.REGIMES.CONTROLLED });
  let stateA = initialState, ballA = initialBall;
  const traceA = [];
  for (let tick = 1; tick <= 5; tick += 1) {
    const output = Dribbling.resolve(fixture(tick, stateA, ballA), capability);
    stateA = output.state; ballA = output.ballState; traceA.push(output.telemetry);
  }
  let stateB = initialState, ballB = initialBall;
  const traceB = [];
  for (let tick = 1; tick <= 2; tick += 1) {
    const output = Dribbling.resolve(fixture(tick, stateB, ballB), capability);
    stateB = output.state; ballB = output.ballState; traceB.push(output.telemetry);
  }
  stateB = Dribbling.restoreState(JSON.parse(JSON.stringify(Dribbling.serializeState(stateB))));
  ballB = Ball.createBallState(JSON.parse(JSON.stringify(ballB)));
  for (let tick = 3; tick <= 5; tick += 1) {
    const output = Dribbling.resolve(fixture(tick, stateB, ballB), capability);
    stateB = output.state; ballB = output.ballState; traceB.push(output.telemetry);
  }
  assert.deepEqual(traceB, traceA);
  assert.deepEqual(stateB, stateA);
  assert.deepEqual(ballB, ballA);
});

test('independent source-kind metamorphic gate proves human and CPU physics are shared', () => {
  const capability = cap();
  let humanState = Dribbling.createState({ epoch: 3 }), cpuState = Dribbling.createState({ epoch: 3 });
  let humanBall = Ball.createBallState({ id: 'b', position: { x: 50.4, y: 2, z: 0.11 }, grounded: true, regime: Ball.REGIMES.CONTROLLED });
  let cpuBall = Ball.cloneBallState(humanBall);
  for (let tick = 1; tick <= 4; tick += 1) {
    const human = Dribbling.resolve(fixture(tick, humanState, humanBall, 'human'), capability);
    const cpu = Dribbling.resolve(fixture(tick, cpuState, cpuBall, 'cpu'), capability);
    humanState = human.state; humanBall = human.ballState;
    cpuState = cpu.state; cpuBall = cpu.ballState;
    assert.deepEqual(cpu.state, human.state);
    assert.deepEqual(cpu.ballState, human.ballState);
  }
});
