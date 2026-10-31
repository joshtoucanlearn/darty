import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ballPath = path.join(root, 'match-engine', 'ball-engine-v2.js');
const cpuPath = path.join(root, 'match-engine', 'cpu-intelligence-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const ballSource = fs.readFileSync(ballPath, 'utf8');
const cpuSource = fs.readFileSync(cpuPath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(ballPath);
const CPU = require(cpuPath);

const FIXED_TICK = 1 / 60;

function kineticEnergy(state) {
  const linear = state.velocity.x ** 2 + state.velocity.y ** 2 + state.velocity.z ** 2;
  const angular = state.angularVelocity.x ** 2 + state.angularVelocity.y ** 2 + state.angularVelocity.z ** 2;
  return 0.5 * state.mass * linear + 0.5 * state.inertia * angular;
}

function player(id, teamId, x, y, data = {}) {
  return {
    id,
    teamId,
    x,
    y,
    formationAnchor: { x, y },
    role: 'midfielder',
    position: 'CM',
    pace: 78,
    acceleration: 78,
    awareness: 80,
    passing: 80,
    shooting: 70,
    control: 80,
    stamina: 90,
    ...data
  };
}

function snapshot(data = {}) {
  const players = data.players || [
    player('carrier', 'home', 1200, 1070, { passing: 90, control: 90 }),
    player('runner', 'home', 1420, 500, { role: 'winger', position: 'LW', pace: 92, acceleration: 94 }),
    player('cb-a', 'home', 700, 800, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 700, 1360, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2480, 720, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2500, 1420, { role: 'centre-back', position: 'CB' })
  ];
  return {
    schema: CPU.SNAPSHOT_SCHEMA,
    tick: data.tick ?? 10,
    fixedTickSeconds: data.fixedTickSeconds ?? FIXED_TICK,
    teamId: data.teamId || 'home',
    possessionTeamId: data.possessionTeamId ?? 'home',
    carrierId: data.carrierId === undefined ? 'carrier' : data.carrierId,
    attackingDirection: data.attackingDirection ?? 1,
    offsideLine: data.offsideLine ?? 2800,
    pitch: data.pitch || { xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 },
    ball: data.ball || { x: 1200, y: 1070 },
    players,
    events: data.events || []
  };
}

test('both candidates coexist and browser loading stays behind exact offline preflight gates', () => {
  assert.equal(Ball.VERSION, '2.0.0-shadow');
  assert.equal(CPU.VERSION, '2.0.0-dormant');
  assert.notEqual(Ball, CPU);

  const browser = { window: {} };
  vm.runInNewContext(ballSource, browser);
  vm.runInNewContext(cpuSource, browser);
  assert.equal(browser.window.FootballLegacyBallEngineV2.VERSION, Ball.VERSION);
  assert.equal(browser.window.FootballLegacyCPUIntelligenceV2.VERSION, CPU.VERSION);
  assert.notEqual(browser.window.FootballLegacyBallEngineV2, browser.window.FootballLegacyCPUIntelligenceV2);

  assert.doesNotMatch(matchHtml, /<script\s+src=["'](?:ball-engine-v2|cpu-intelligence-v2)\.js/i);
  const livePreflight = matchHtml.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)?.[1] || '';
  assert.match(livePreflight, /if\(!eligible\)return;[\s\S]*'ball-engine-v2\.js'[\s\S]*'cpu-intelligence-v2\.js'/);
  assert.match(matchHtml,
    /window\.FootballLegacyBallEngineV2&&window\.FootballLegacyBallEngineV2\.ENGINE_NAME/,
    'the match may consume MR only after a gated preflight has installed its browser global');
});

test('combined deterministic calls remain byte-identical and input-order invariant', () => {
  const ballRun = () => {
    const launch = Ball.resolveLaunch({
      direction: { x: 1, y: 0.17, z: 0 },
      speed: 29,
      liftAngleDeg: 21,
      topSpinRpm: 170,
      sideSpinRpm: -95
    });
    return Ball.advance(launch.state, Ball.createSimulationContext({ seed: 0x173 }), {
      duration: 0.75,
      environment: { groundEnabled: false },
      config: { knuckle: { enabled: true, minimumSpeed: 0, maximumSpin: 100, acceleration: 0.25 } }
    });
  };
  assert.deepEqual(ballRun(), ballRun());

  const ordered = snapshot({ tick: 90 });
  const shuffled = {
    ...ordered,
    players: [...ordered.players].reverse(),
    events: [...ordered.events].reverse()
  };
  assert.deepEqual(CPU.decide(ordered), CPU.decide(shuffled));
});

test('groundEnabled false prevents both collider and ground-regime authority', () => {
  const initial = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
    regime: Ball.REGIMES.FLIGHT
  });
  const result = Ball.step(initial, Ball.createSimulationContext({ seed: 201 }), FIXED_TICK, {
    groundEnabled: false
  }, {
    gravity: { x: 0, y: 0, z: 0 },
    airDensity: 0,
    angularDecayPerSecond: 0
  });
  assert.equal(result.state.regime, Ball.REGIMES.FLIGHT);
  assert.equal(result.state.grounded, false);
  assert.equal(result.state.position.z, initial.position.z);
  assert.equal(result.trace.events.some(event => event.colliderId === '__ground__'), false);
});

test('the complete passive ground solver does not create kinetic energy', () => {
  const initial = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 0.5, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.SKID
  });
  const before = kineticEnergy(initial);
  const config = Ball.createConfig({ airDensity: 0, angularDecayPerSecond: 0 });
  const result = Ball.step(initial, Ball.createSimulationContext({ seed: 202 }), FIXED_TICK, undefined, config);
  const after = kineticEnergy(result.state);
  const allowed = before * (1 + config.energy.maximumPassiveGainRatio) + config.energy.absoluteToleranceJ;
  assert.ok(after <= allowed + 1e-12, `passive ground energy ${after} exceeds ${allowed}`);
});

test('steady rolling support contact does not spam gameplay contact state or events', () => {
  const speed = 1.5;
  let state = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: speed, y: 0, z: 0 },
    angularVelocity: { x: 0, y: speed / 0.11, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.ROLL
  });
  let context = Ball.createSimulationContext({ seed: 203 });
  const emittedContacts = [];
  for (let tick = 0; tick < 120; tick += 1) {
    const result = Ball.step(state, context, FIXED_TICK, undefined, { airDensity: 0 });
    emittedContacts.push(...result.trace.events.filter(event => event.type === 'contact' || event.type === 'capture'));
    state = result.state;
    context = result.context;
  }
  assert.deepEqual(emittedContacts, []);
  assert.equal(state.contactCount, 0);
  assert.equal(state.lastContact, null);
});

test('moving keeper capture inherits hands velocity without passive-clamp corruption', () => {
  const hands = Ball.createSphereCollider({
    id: 'moving-hands',
    center: { x: 0.6, y: 0, z: 1 },
    radius: 0.35,
    velocity: { x: -8, y: 0.5, z: 0 },
    material: Ball.MATERIALS.keeperHands
  });
  const initial = Ball.createBallState({
    position: { x: 0, y: 0, z: 1 },
    velocity: { x: 40, y: 0, z: 0 },
    grounded: false
  });
  const result = Ball.step(initial, Ball.createSimulationContext({ seed: 204 }), 0.03, {
    groundEnabled: false,
    colliders: [hands]
  }, {
    gravity: { x: 0, y: 0, z: 0 },
    airDensity: 0,
    angularDecayPerSecond: 0
  });
  const capture = result.trace.events.find(event => event.type === 'capture');
  assert.ok(capture);
  assert.equal(result.state.regime, Ball.REGIMES.CONTROLLED);
  assert.deepEqual(result.state.velocity, hands.velocity);
  assert.equal(capture.energyClamped, false);
  assert.equal(capture.energyPolicy, 'active-controlled-attachment');
});

test('outer-tick, substep and simulation-time clocks have explicit stopped-ball semantics', () => {
  const dynamic = Ball.step(
    Ball.createBallState({ position: { x: 0, y: 0, z: 2 }, velocity: { x: 1, y: 0, z: 0 } }),
    Ball.createSimulationContext({ seed: 205 }),
    FIXED_TICK,
    { groundEnabled: false },
    { gravity: { x: 0, y: 0, z: 0 }, airDensity: 0 }
  );
  assert.deepEqual(
    {
      outerTick: dynamic.context.outerTick,
      substeps: dynamic.context.substepCount,
      elapsed: dynamic.context.elapsed,
      simulationTime: dynamic.state.simulationTime,
      planned: dynamic.trace.plannedSubsteps,
      completed: dynamic.trace.completedSubsteps
    },
    { outerTick: 1, substeps: 4, elapsed: FIXED_TICK, simulationTime: FIXED_TICK, planned: 4, completed: 4 }
  );

  const controlled = Ball.step(
    Ball.createBallState({
      position: { x: 0, y: 0, z: 1 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      regime: Ball.REGIMES.CONTROLLED
    }),
    Ball.createSimulationContext({ seed: 206 }),
    FIXED_TICK,
    { groundEnabled: false }
  );
  assert.deepEqual(
    {
      outerTick: controlled.context.outerTick,
      substeps: controlled.context.substepCount,
      elapsed: controlled.context.elapsed,
      simulationTime: controlled.state.simulationTime,
      planned: controlled.trace.plannedSubsteps,
      completed: controlled.trace.completedSubsteps
    },
    { outerTick: 1, substeps: 0, elapsed: FIXED_TICK, simulationTime: 0, planned: 0, completed: 0 }
  );
});

test('reaction-delayed CPU runs clamp remembered event targets to the current offside line', () => {
  const fixture = CPU.createBaleStyleOpenSpaceBeelineFixture();
  let decision = CPU.decide(fixture.snapshots.closed);
  decision = CPU.decide(fixture.snapshots.opened, decision.memory);
  const reacted = { ...fixture.snapshots.reacted, offsideLine: 1800 };
  decision = CPU.decide(reacted, decision.memory);
  const run = decision.runs.find(entry => entry.playerId === fixture.runnerId);
  const safeBoundary = reacted.offsideLine - CPU.DEFAULT_CONFIG.offsideBuffer;
  assert.ok(run);
  assert.ok(run.target.x <= safeBoundary, `delayed target ${run.target.x} exceeds current safe line ${safeBoundary}`);
});

test('persisted CPU commitments re-clamp after the defensive offside line moves', () => {
  const fixture = CPU.createBaleStyleOpenSpaceBeelineFixture();
  let decision = CPU.decide(fixture.snapshots.closed);
  decision = CPU.decide(fixture.snapshots.opened, decision.memory);
  decision = CPU.decide(fixture.snapshots.reacted, decision.memory);
  const narrowed = { ...fixture.snapshots.narrowed, offsideLine: 1600 };
  decision = CPU.decide(narrowed, decision.memory);
  const run = decision.runs.find(entry => entry.playerId === fixture.runnerId);
  const safeBoundary = narrowed.offsideLine - CPU.DEFAULT_CONFIG.offsideBuffer;
  assert.ok(run);
  assert.ok(run.target.x <= safeBoundary, `persisted target ${run.target.x} exceeds current safe line ${safeBoundary}`);
  assert.ok(decision.telemetry.transitions.some(entry => entry.type === 'run-persisted' && entry.offsideAdjusted));
});

test('reverse-direction runs apply the mirrored offside boundary', () => {
  const players = [
    player('carrier', 'home', 2000, 1070, { passing: 96, control: 92 }),
    player('left-runner', 'home', 1500, 400, {
      role: 'winger', position: 'LW', pace: 99, acceleration: 99, awareness: 99
    }),
    player('cb-a', 'home', 2500, 800, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 2500, 1360, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 700, 750, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 710, 1420, { role: 'centre-back', position: 'CB' })
  ];
  const offsideLine = 1200;
  const decision = CPU.decide(snapshot({
    tick: 220,
    players,
    attackingDirection: -1,
    offsideLine,
    ball: { x: 2000, y: 1070 }
  }), null, {
    minimumLaneClearance: 0,
    minimumPassLaneClearance: 0,
    minimumBidScore: 0
  });
  const safeBoundary = offsideLine + CPU.DEFAULT_CONFIG.offsideBuffer;
  assert.ok(decision.telemetry.bids.length > 0);
  assert.ok(decision.telemetry.bids.every(bid => bid.target.x >= safeBoundary));
  assert.ok(decision.runs.every(run => run.target.x >= safeBoundary));
  assert.ok(decision.telemetry.bids.some(bid => bid.offsideAdjusted));
});

test('run lifecycle aborts on turnover while preserving rest-defence and lane coordination', () => {
  const fixture = CPU.createBaleStyleOpenSpaceBeelineFixture();
  let decision = CPU.decide(fixture.snapshots.closed);
  decision = CPU.decide(fixture.snapshots.opened, decision.memory);
  decision = CPU.decide(fixture.snapshots.reacted, decision.memory);
  assert.ok(decision.runs.some(run => run.playerId === fixture.runnerId));
  decision = CPU.decide(fixture.snapshots.turnover, decision.memory);
  assert.equal(decision.runs.length, 0);
  assert.ok(decision.telemetry.transitions.some(event =>
    event.type === 'run-aborted' && event.playerId === fixture.runnerId && event.reason === 'possession-lost'));

  const coordinatedPlayers = [
    player('carrier', 'home', 1100, 1070, { passing: 94 }),
    player('alpha-runner', 'home', 1450, 1000, { role: 'striker', position: 'ST', pace: 92, awareness: 92 }),
    player('beta-runner', 'home', 1450, 1000, { role: 'striker', position: 'ST', pace: 92, awareness: 92 }),
    player('cb-a', 'home', 700, 760, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 700, 1380, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2900, 400, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2900, 1740, { role: 'centre-back', position: 'CB' })
  ];
  const coordinated = CPU.decide(snapshot({ tick: 230, players: coordinatedPlayers, offsideLine: 2920 }), null, {
    maximumCommittedRuns: 2
  });
  const penetrating = coordinated.runs.filter(run =>
    ['central', 'channel', 'underlap', 'overlap', 'late-box'].includes(run.runType));
  assert.equal(new Set(penetrating.map(run => run.band)).size, penetrating.length);
  assert.ok(coordinated.telemetry.bids.some(bid => bid.rejectionReasons.includes('lane-coordination-conflict')));
  assert.equal(coordinated.runs.some(run => ['cb-a', 'cb-b'].includes(run.playerId) && run.runType !== 'support'), false);
});
