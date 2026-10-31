import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = path.join(root, 'match-engine', 'ball-engine-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(modulePath);

const almost = (actual, expected, tolerance = 1e-8, message = '') => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message || 'values differ'}: ${actual} vs ${expected}`);
};

const almostVector = (actual, expected, tolerance = 1e-8) => {
  for (const axis of ['x', 'y', 'z']) almost(actual[axis], expected[axis], tolerance, axis);
};

const noAir = {
  gravity: { x: 0, y: 0, z: 0 },
  airDensity: 0,
  angularDecayPerSecond: 0
};

const kineticEnergy = state => 0.5 * state.mass * (
  state.velocity.x ** 2 + state.velocity.y ** 2 + state.velocity.z ** 2
) + 0.5 * state.inertia * (
  state.angularVelocity.x ** 2 + state.angularVelocity.y ** 2 + state.angularVelocity.z ** 2
);

test('the MR engine exposes its browser/CommonJS API and joins live authority only through the exact V2 preflight', () => {
  assert.equal(Ball.ENGINE_NAME, 'Magnus Reynolds (MR) Engine');
  assert.equal(Ball.VERSION, '2.0.0-shadow');
  for (const name of [
    'createConfig', 'createSimulationContext', 'createBallState', 'createLaunchIntent',
    'resolveLaunch', 'createPlaneCollider', 'createSphereCollider', 'createCapsuleCollider',
    'createGoalFrame', 'step', 'advance', 'predict', 'stateSignature'
  ]) assert.equal(typeof Ball[name], 'function', name);
  const browser = { window: {} };
  vm.runInNewContext(source, browser);
  assert.equal(browser.window.FootballLegacyBallEngineV2.VERSION, Ball.VERSION);
  assert.doesNotMatch(matchHtml, /<script\s+src=["']ball-engine-v2\.js/i);
  assert.match(matchHtml, /id="offlineLiveV2Preflight"/);
  assert.match(matchHtml, /if\(!eligible\)return;[\s\S]*pieces=\['ball-engine-v2\.js'/,
    'the live module must remain behind the exact offline V2 capability gate');
  assert.match(matchHtml, /FootballLegacyBallEngineV2/,
    'the active V2 report should expose the public MR engine identity');
});

test('the candidate has no unseeded random source or presentation-clock dependency', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.(?:now|UTC)\s*\(/);
  assert.doesNotMatch(source, /performance\.now\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
});

test('simulation context requires a non-zero deterministic integer seed', () => {
  assert.throws(() => Ball.createSimulationContext({}), /seed is required/);
  assert.throws(() => Ball.createSimulationContext({ seed: 0 }), /must not be zero/);
  assert.throws(() => Ball.createSimulationContext({ seed: 1.5 }), /integer seed/);
  const context = Ball.createSimulationContext({ seed: 0x12345678 });
  assert.equal(Ball.isSimulationContext(context), true);
  assert.deepEqual(
    { outerTick: context.outerTick, substepCount: context.substepCount, elapsed: context.elapsed },
    { outerTick: 0, substepCount: 0, elapsed: 0 }
  );
});

test('state contract separates outer ticks, substeps and simulation time', () => {
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 2 }, velocity: { x: 1, y: 0, z: 0 } });
  const context = Ball.createSimulationContext({ seed: 9 });
  const result = Ball.step(state, context, 1 / 60, { groundEnabled: false }, noAir);
  assert.equal(result.context.outerTick, 1);
  assert.equal(result.context.substepCount, 4);
  assert.equal(result.state.lastOuterTick, 1);
  almost(result.state.simulationTime, 1 / 60);
  assert.equal(result.trace.plannedSubsteps, 4);
  assert.equal(result.trace.completedSubsteps, 4);
  assert.equal(context.outerTick, 0, 'input context is immutable');
  assert.equal(state.position.x, 0, 'input state is immutable');
});

test('ground-disabled flight never invents a support surface at ball-radius height', () => {
  const state = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
    regime: Ball.REGIMES.FLIGHT
  });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 91 }), 1 / 60, { groundEnabled: false }, noAir);
  assert.equal(result.state.grounded, false);
  assert.equal(result.state.regime, Ball.REGIMES.FLIGHT);
  assert.equal(result.trace.events.some(event => event.colliderId === '__ground__'), false);
  assert.equal(result.trace.events.some(event => event.type === 'regime-change'), false);
  almost(result.state.position.x, 1 / 60);
});

test('launch contract resolves direction, lift and all three spin axes', () => {
  const result = Ball.resolveLaunch({
    id: 'free-kick-1',
    source: 'suite',
    origin: { x: 3, y: 4, z: 0.11 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 20,
    liftAngleDeg: 30,
    sideSpinRpm: 120,
    topSpinRpm: 60,
    axialSpinRpm: 30
  });
  almost(result.state.velocity.x, 20 * Math.cos(Math.PI / 6));
  almost(result.state.velocity.z, 10);
  almost(result.state.angularVelocity.x, Ball.rpmToRadiansPerSecond(30));
  almost(result.state.angularVelocity.y, Ball.rpmToRadiansPerSecond(60));
  almost(result.state.angularVelocity.z, Ball.rpmToRadiansPerSecond(120));
  assert.equal(result.state.metadata.launchId, 'free-kick-1');
  assert.equal(result.event.type, 'launch');
});

test('a target launch rejects a vertical-only direction rather than inventing aim', () => {
  assert.throws(() => Ball.resolveLaunch({
    origin: { x: 1, y: 1, z: 0.11 },
    target: { x: 1, y: 1, z: 2 },
    speed: 10
  }), /horizontal component/);
});

test('the same state, context, environment and seed replay byte-identically', () => {
  const launch = Ball.resolveLaunch({ direction: { x: 1, y: 0.2, z: 0 }, speed: 28, liftAngleDeg: 18, sideSpinRpm: 180 });
  const run = () => Ball.advance(launch.state, Ball.createSimulationContext({ seed: 77 }), {
    duration: 1.5,
    environment: { groundEnabled: false },
    config: { knuckle: { enabled: true, minimumSpeed: 0, maximumSpin: 100, acceleration: 0.4 } }
  });
  const first = run();
  const second = run();
  assert.deepEqual(first, second);
  assert.equal(Ball.stateSignature(first.state), Ball.stateSignature(second.state));
});

test('fixed 240 Hz substeps produce render-chunk invariant flight', () => {
  const launch = Ball.resolveLaunch({ direction: { x: 1, y: 0.1, z: 0 }, speed: 32, liftAngleDeg: 24, topSpinRpm: 140 });
  const context = Ball.createSimulationContext({ seed: 123 });
  const sixty = Ball.advance(launch.state, context, {
    duration: 2,
    stepDuration: 1 / 60,
    environment: { groundEnabled: false }
  });
  const thirty = Ball.advance(launch.state, context, {
    duration: 2,
    stepDuration: 1 / 30,
    environment: { groundEnabled: false }
  });
  almostVector(sixty.state.position, thirty.state.position, 2e-8);
  almostVector(sixty.state.velocity, thirty.state.velocity, 2e-8);
  almostVector(sixty.state.angularVelocity, thirty.state.angularVelocity, 2e-8);
  assert.equal(sixty.context.substepCount, thirty.context.substepCount);
  assert.equal(sixty.context.outerTick, 120);
  assert.equal(thirty.context.outerTick, 60);
});

test('speed-dependent aerodynamic drag monotonically reduces a no-gravity flight', () => {
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 4 }, velocity: { x: 30, y: 0, z: 0 }, grounded: false });
  const result = Ball.advance(state, Ball.createSimulationContext({ seed: 3 }), {
    duration: 1,
    environment: { groundEnabled: false },
    config: { gravity: { x: 0, y: 0, z: 0 } }
  });
  assert.ok(result.state.velocity.x > 0);
  assert.ok(result.state.velocity.x < 30);
  assert.ok(result.traces.flatMap(trace => trace.samples).every(sample => sample.dragCoefficient >= 0.2));
});

test('vector Magnus bends equal opposite side-spin flights symmetrically', () => {
  const simulate = sideSpinRpm => {
    const launch = Ball.resolveLaunch({ direction: { x: 1, y: 0, z: 0 }, speed: 25, liftAngleDeg: 12, sideSpinRpm });
    return Ball.advance(launch.state, Ball.createSimulationContext({ seed: 4 }), {
      duration: 1,
      environment: { groundEnabled: false }
    }).state;
  };
  const positive = simulate(300);
  const negative = simulate(-300);
  assert.ok(positive.position.y > 0);
  assert.ok(negative.position.y < 0);
  almost(positive.position.y, -negative.position.y, 1e-8);
  almost(positive.position.x, negative.position.x, 1e-8);
});

test('positive top spin produces more dip than equal backspin', () => {
  const simulate = topSpinRpm => {
    const launch = Ball.resolveLaunch({ direction: { x: 1, y: 0, z: 0 }, speed: 26, liftAngleDeg: 25, topSpinRpm });
    return Ball.advance(launch.state, Ball.createSimulationContext({ seed: 5 }), {
      duration: 0.8,
      environment: { groundEnabled: false }
    }).state.position.z;
  };
  assert.ok(simulate(260) < simulate(-260));
});

test('ground contact bounces without passive energy creation', () => {
  const state = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.2 },
    velocity: { x: 6, y: 0, z: -20 },
    grounded: false
  });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 6 }), 1 / 60, undefined, noAir);
  const contact = result.trace.events.find(event => event.colliderId === '__ground__');
  assert.ok(contact);
  assert.ok(result.state.position.z >= result.state.radius - 1e-6);
  assert.ok(result.state.velocity.z > 0);
  assert.ok(contact.afterEnergyJ <= contact.beforeEnergyJ * 1.002 + 1e-8);
  assert.equal(contact.energyClamped, false);
});

test('ground regimes progress from skid through roll to a deterministic settle', () => {
  const state = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 3, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.SKID
  });
  const config = {
    gravity: { x: 0, y: 0, z: -9.80665 },
    airDensity: 0,
    ground: {
      skidFriction: 0.5,
      rollingFriction: 0.2,
      settleLinearSpeed: 0.05,
      settleAngularSpeed: 1,
      settleDelay: 0.1
    }
  };
  const first = Ball.step(state, Ball.createSimulationContext({ seed: 7 }), 1 / 60, undefined, config);
  assert.equal(first.state.regime, Ball.REGIMES.SKID);
  const final = Ball.advance(first.state, first.context, { duration: 4, config });
  assert.equal(final.state.regime, Ball.REGIMES.SETTLED);
  assert.equal(final.state.settled, true);
  assert.deepEqual(final.state.velocity, { x: 0, y: 0, z: 0 });
});

test('default grass resistance prevents missed ground passes floating away', () => {
  const rollout = speed => Ball.advance(Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: speed, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.SKID
  }), Ball.createSimulationContext({ seed: 701 }), { duration: 5 });
  const short = rollout(5);
  const firm = rollout(9);
  assert.ok(short.state.position.x >= 6 && short.state.position.x <= 7,
    `5 m/s loose ball rolled ${short.state.position.x}m`);
  assert.equal(short.state.settled, true);
  assert.ok(firm.state.position.x >= 17 && firm.state.position.x <= 19,
    `9 m/s loose ball rolled ${firm.state.position.x}m`);
  assert.ok(Math.hypot(firm.state.velocity.x, firm.state.velocity.y) < 0.15,
    `9 m/s loose ball still travelled at ${Math.hypot(firm.state.velocity.x, firm.state.velocity.y)}m/s`);
});

test('finite weighted-ground damping is passive, opt-in and leaves ordinary launches unchanged', () => {
  const run = metadata => {
    const launch = Ball.resolveLaunch({
      id: 'weighted-ground-isolation',
      origin: { x: 0, y: 0, z: .11 },
      direction: { x: 1, y: 0, z: 0 },
      speed: 14,
      liftAngleDeg: 0,
      source: 'ground-pass',
      metadata
    });
    return Ball.advance(launch.state, Ball.createSimulationContext({ seed: 703 }), { duration: 1.5 });
  };
  const ordinary = run({ unrelated: true });
  const untagged = run({
    groundLinearDampingPerSecond: 1.2,
    groundLinearDampingUntilSeconds: .65
  });
  almostVector(untagged.state.position, ordinary.state.position, 1e-10);
  almostVector(untagged.state.velocity, ordinary.state.velocity, 1e-10);
  almostVector(untagged.state.angularVelocity, ordinary.state.angularVelocity, 1e-10);

  const weighted = run({
    groundDampingModel: 'weighted-ground-strike-v1',
    groundLinearDampingPerSecond: 1.2,
    groundLinearDampingUntilSeconds: .65
  });
  assert.ok(weighted.state.position.x < ordinary.state.position.x,
    'the opt-in turf-loss profile did not reduce rollout distance');
  assert.ok(Math.hypot(weighted.state.velocity.x, weighted.state.velocity.y) <
    Math.hypot(ordinary.state.velocity.x, ordinary.state.velocity.y),
  'the opt-in turf-loss profile did not dissipate pace');
  assert.equal(weighted.traces.flatMap(trace => trace.events)
    .some(event => event.type === 'passive-energy-clamp'), false,
  'the damping profile attempted to add energy');
});

test('progressive ground strike applies passive distance-ramped turf loss only when tagged', () => {
  const metadata = {
    groundDampingModel: 'progressive-ground-strike-v2',
    groundDampingInitialPerSecond: .21,
    groundDampingRampScale: .0532,
    groundDampingRampExponent: 3.8,
    groundDampingOriginX: 0,
    groundDampingOriginY: 0,
    groundDampingReferenceDistanceMetres: 16,
    groundSkidFrictionScale: .55,
    groundLinearDampingUntilSeconds: 8
  };
  const launch = Ball.resolveLaunch({
    id: 'progressive-ground-distance-ramp',
    origin: { x: 0, y: 0, z: .142 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 23.12,
    liftAngleDeg: 0,
    source: 'ground-pass',
    metadata
  });
  let state = launch.state;
  let context = Ball.createSimulationContext({ seed: 704 });
  const speeds = {};
  for (let tick = 1; tick <= 240 && !state.settled; tick += 1) {
    const output = Ball.step(state, context, 1 / 60);
    state = output.state;
    context = output.context;
    for (const fraction of [.25, .5, .75, 1]) {
      if (speeds[fraction] == null && state.position.x >= 16 * fraction) {
        speeds[fraction] = Math.hypot(state.velocity.x, state.velocity.y);
      }
    }
    assert.equal(output.trace.events.some(event => event.type === 'passive-energy-clamp'), false,
      'progressive turf loss attempted to add energy');
  }
  assert.ok(Object.values(speeds).every(Number.isFinite), JSON.stringify(speeds));
  assert.ok(speeds[.25] >= speeds[.5] && speeds[.5] >= speeds[.75] && speeds[.75] >= speeds[1],
    `progressive turf profile accelerated: ${JSON.stringify(speeds)}`);
  assert.ok(speeds[.75] - speeds[1] > (speeds[.5] - speeds[.75]) * 1.2,
    `late grass drag did not exceed middle-route drag: ${JSON.stringify(speeds)}`);

  const ordinary = Ball.resolveLaunch({
    id: 'progressive-ground-untagged-control',
    origin: { x: 0, y: 0, z: .142 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 23.12,
    source: 'ground-pass',
    metadata: { ...metadata, groundDampingModel: null }
  });
  const ordinaryResult = Ball.advance(ordinary.state, Ball.createSimulationContext({ seed: 704 }), { duration: 2.5 });
  assert.ok(ordinaryResult.state.position.x > state.position.x + 2,
    'untagged ball unexpectedly inherited progressive strike drag');
});

test('default grass roll decelerates at its measured surface rate without passive acceleration', () => {
  const initialSpeed = 5;
  let state = Ball.createBallState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: initialSpeed, y: 0, z: 0 },
    // Exact no-slip roll: v = omega times radius. This isolates rolling
    // resistance from the deliberately stronger skid-to-roll conversion.
    angularVelocity: { x: 0, y: initialSpeed / 0.11, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.ROLL
  });
  let context = Ball.createSimulationContext({ seed: 702 });
  let previousSpeed = initialSpeed;
  let maximumGain = 0;
  for (let tick = 0; tick < 60; tick += 1) {
    const result = Ball.step(state, context, 1 / 60, undefined, {
      airDensity: 0,
      angularDecayPerSecond: 0
    });
    state = result.state;
    context = result.context;
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    maximumGain = Math.max(maximumGain, speed - previousSpeed);
    previousSpeed = speed;
  }
  const measuredDeceleration = initialSpeed - previousSpeed;
  assert.ok(measuredDeceleration >= 1.36 && measuredDeceleration <= 1.39,
    `one-second rolling deceleration was ${measuredDeceleration}m/s^2`);
  assert.ok(maximumGain <= 1e-10,
    `passive roll accelerated by ${maximumGain}m/s in one tick`);
  assert.equal(state.regime, Ball.REGIMES.ROLL);
});

test('passive ground projection cannot create combined linear and rotational energy', () => {
  for (const speed of [0.1, 0.5, 20]) {
    const state = Ball.createBallState({
      position: { x: 0, y: 0, z: 0.11 },
      velocity: { x: speed, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      regime: Ball.REGIMES.SKID
    });
    const before = kineticEnergy(state);
    const result = Ball.step(state, Ball.createSimulationContext({ seed: 92 }), 1 / 60, undefined, noAir);
    const after = kineticEnergy(result.state);
    assert.ok(after <= before * 1.002 + 1e-8, `${speed} m/s gained passive energy: ${before} -> ${after}`);
  }
});

test('swept plane collision prevents a 100 m/s ball tunnelling through a wall', () => {
  const wall = Ball.createPlaneCollider({
    id: 'test-wall',
    point: { x: 1, y: 0, z: 0 },
    normal: { x: -1, y: 0, z: 0 },
    material: Ball.MATERIALS.wall
  });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 }, velocity: { x: 100, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 8 }), 0.02, { groundEnabled: false, colliders: [wall] }, noAir);
  assert.ok(result.trace.events.some(event => event.colliderId === 'test-wall'));
  assert.ok(result.state.position.x <= 1 - state.radius + 1e-4);
  assert.ok(result.state.velocity.x < 0);
});

test('swept sphere collision resolves a fast goal-post proxy', () => {
  const post = Ball.createSphereCollider({
    id: 'post-sphere', center: { x: 1, y: 0, z: 1 }, radius: 0.06,
    material: Ball.MATERIALS.goalFrame
  });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 }, velocity: { x: 110, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 10 }), 0.02, { groundEnabled: false, colliders: [post] }, noAir);
  assert.ok(result.trace.events.some(event => event.colliderId === 'post-sphere'));
  assert.ok(result.state.velocity.x < 0);
});

test('swept capsule collision resolves a fast body or frame contact', () => {
  const body = Ball.createCapsuleCollider({
    id: 'body-capsule', start: { x: 1, y: 0, z: 0 }, end: { x: 1, y: 0, z: 2 },
    radius: 0.18, material: Ball.MATERIALS.playerBody
  });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 }, velocity: { x: 120, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 11 }), 0.02, { groundEnabled: false, colliders: [body] }, noAir);
  assert.ok(result.trace.events.some(event => event.colliderId === 'body-capsule'));
  assert.ok(result.state.position.x < 1);
});

test('keeper-hands material creates an explicit controlled-ball state', () => {
  const hands = Ball.createSphereCollider({
    id: 'keeper-hands', center: { x: 1, y: 0, z: 1 }, radius: 0.35,
    velocity: { x: 0.5, y: 0, z: 0 }, material: Ball.MATERIALS.keeperHands
  });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 }, velocity: { x: 40, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 12 }), 0.03, { groundEnabled: false, colliders: [hands] }, noAir);
  assert.equal(result.state.regime, Ball.REGIMES.CONTROLLED);
  assert.deepEqual(result.state.velocity, { x: 0.5, y: 0, z: 0 });
  assert.ok(result.trace.events.some(event => event.type === 'capture'));
});

test('moving keeper capture is an active attachment and inherits the hands velocity exactly', () => {
  const hands = Ball.createSphereCollider({
    id: 'moving-keeper-hands', center: { x: 0.5, y: 0, z: 1 }, radius: 0.35,
    velocity: { x: -8, y: 0.4, z: 0 }, material: Ball.MATERIALS.keeperHands
  });
  const state = Ball.createBallState({
    position: { x: 0, y: 0, z: 1 },
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false
  });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 93 }), 0.02, { groundEnabled: false, colliders: [hands] }, noAir);
  const capture = result.trace.events.find(event => event.colliderId === 'moving-keeper-hands');
  assert.ok(capture);
  assert.equal(capture.type, 'capture');
  assert.equal(capture.energyPolicy, 'active-controlled-attachment');
  assert.equal(capture.energyClamped, false);
  assert.deepEqual(result.state.velocity, hands.velocity);
  assert.equal(result.state.regime, Ball.REGIMES.CONTROLLED);
});

test('goal-frame factory returns two posts and one crossbar as capsules', () => {
  const frame = Ball.createGoalFrame({
    id: 'north-goal',
    leftPostBase: { x: 52.5, y: -3.66, z: 0 },
    rightPostBase: { x: 52.5, y: 3.66, z: 0 }
  });
  assert.equal(frame.length, 3);
  assert.deepEqual(frame.map(item => item.id), ['north-goal-left-post', 'north-goal-right-post', 'north-goal-crossbar']);
  assert.ok(frame.every(item => item.kind === Ball.COLLIDER_KINDS.CAPSULE));
  assert.ok(frame.every(item => item.material.id === 'goal-frame'));
});

test('earliest collider wins independent of supplied collider order', () => {
  const near = Ball.createPlaneCollider({ id: 'near', point: { x: 0.7, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, order: 5 });
  const far = Ball.createPlaneCollider({ id: 'far', point: { x: 1.2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, order: 0 });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 }, velocity: { x: 100, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 13 }), 0.01, { groundEnabled: false, colliders: [far, near] }, noAir);
  assert.equal(result.trace.events.find(event => event.type === 'contact').colliderId, 'near');
});

test('moving boot contact may add finite, explicitly active energy', () => {
  const boot = Ball.createSphereCollider({
    id: 'moving-boot', center: { x: 0.6, y: 0, z: 0.5 }, radius: 0.12,
    velocity: { x: -12, y: 0, z: 0 }, material: Ball.MATERIALS.boot
  });
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 0.5 }, velocity: { x: 15, y: 0, z: 0 }, grounded: false });
  const result = Ball.step(state, Ball.createSimulationContext({ seed: 14 }), 0.03, { groundEnabled: false, colliders: [boot] }, noAir);
  const contact = result.trace.events.find(event => event.colliderId === 'moving-boot');
  assert.ok(contact);
  assert.equal(contact.energyClamped, false);
  assert.ok(Number.isFinite(contact.afterEnergyJ));
  assert.ok(['flight', 'skid', 'roll'].includes(result.state.regime));
});

test('knuckle perturbation is time-correlated, deterministic by seed and differs across seeds', () => {
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 3 }, velocity: { x: 30, y: 0, z: 0 }, grounded: false });
  const config = {
    gravity: { x: 0, y: 0, z: 0 },
    knuckle: { enabled: true, minimumSpeed: 0, maximumSpin: 10, acceleration: 2 }
  };
  const run = seed => Ball.advance(state, Ball.createSimulationContext({ seed }), {
    duration: 0.25, environment: { groundEnabled: false }, config
  });
  const first = run(100);
  const repeat = run(100);
  const other = run(101);
  assert.deepEqual(first, repeat);
  assert.notEqual(Ball.stateSignature(first.state), Ball.stateSignature(other.state));
  assert.equal(first.context.randomDrawCount, 0, 'correlated forcing must not consume per-substep white-noise draws');
});

test('predict uses the same step path as manual advance', () => {
  const launch = Ball.resolveLaunch({ direction: { x: 1, y: -0.2, z: 0 }, speed: 24, liftAngleDeg: 16 });
  const context = Ball.createSimulationContext({ seed: 15 });
  const options = { duration: 1.25, stepDuration: 1 / 60, environment: { groundEnabled: false } };
  const predicted = Ball.predict(launch.state, context, options);
  const advanced = Ball.advance(launch.state, context, options);
  assert.deepEqual(predicted, advanced);
  assert.equal(Ball.stateSignature(predicted.state), Ball.stateSignature(advanced.state));
});

test('state signatures are stable, sensitive and exclude metadata noise', () => {
  const first = Ball.createBallState({ position: { x: 1, y: 2, z: 3 }, metadata: { note: 'a' } });
  const samePhysics = Ball.createBallState({ position: { x: 1, y: 2, z: 3 }, metadata: { note: 'b' } });
  const changed = Ball.createBallState({ position: { x: 1.0001, y: 2, z: 3 } });
  assert.equal(Ball.stateSignature(first), Ball.stateSignature(samePhysics));
  assert.notEqual(Ball.stateSignature(first), Ball.stateSignature(changed));
});

test('safety bounds reject oversized steps and invalid geometry', () => {
  const state = Ball.createBallState({ position: { x: 0, y: 0, z: 1 } });
  const context = Ball.createSimulationContext({ seed: 16 });
  assert.throws(() => Ball.step(state, context, 0.5), /safety bound/);
  assert.throws(() => Ball.createSphereCollider({ radius: 0 }), /positive/);
  assert.throws(() => Ball.createCapsuleCollider({ start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 0 }, radius: 1 }), /endpoints must differ/);
});
