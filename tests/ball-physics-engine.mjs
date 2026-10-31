import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modulePath = path.join(root, 'match-engine', 'ball-physics.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Physics = require(modulePath);

const almostEqual = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
};

test('CommonJS module exposes the complete dormant API', () => {
  assert.equal(Physics.VERSION, '1.0.0-dormant');
  for (const name of [
    'createState', 'cloneState', 'isCompleteState', 'fromLegacyState', 'toLegacyState',
    'legacyWorldStateToSI', 'siStateToLegacyWorld', 'stepLegacy', 'stepExperimental',
    'step', 'predictSteps', 'predictUntil'
  ]) assert.equal(typeof Physics[name], 'function', `${name} must be exported`);
});

test('plain browser script exposes window.FootballLegacyBallPhysics', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow, Object, Number, Math, Boolean, String, TypeError, RangeError });
  assert.equal(browserWindow.FootballLegacyBallPhysics.VERSION, Physics.VERSION);
  assert.equal(typeof browserWindow.FootballLegacyBallPhysics.step, 'function');
});

test('match page no longer loads the retired dormant kernel', () => {
  assert.doesNotMatch(matchHtml, /ball-physics\.js/);
});

test('createState always returns a complete, independent state contract', () => {
  const original = Physics.createState({
    position: { x: 1, y: 2, z: 3 },
    velocity: { x: 4, y: 5, z: 6 },
    angularVelocity: { x: 7, y: 8, z: 9 },
    orientation: { x: 1, y: 2, z: 3, w: 4 },
    metadata: { source: 'unit-test' }
  });
  const clone = Physics.cloneState(original);
  assert.equal(Physics.isCompleteState(original), true);
  assert.equal(Physics.isCompleteState(clone), true);
  clone.position.x = 99;
  clone.metadata.source = 'changed';
  assert.equal(original.position.x, 1);
  assert.equal(original.metadata.source, 'unit-test');
  almostEqual(Math.hypot(...Object.values(original.orientation)), 1);
});

test('distance, velocity and spin unit conversions round-trip', () => {
  for (const axis of ['x', 'y', 'z']) {
    const world = Physics.metresToWorld(12.75, axis);
    almostEqual(Physics.worldToMetres(world, axis), 12.75);
    const perFrame = Physics.metresPerSecondToWorldPerFrame(27.4, axis);
    almostEqual(Physics.worldPerFrameToMetresPerSecond(perFrame, axis), 27.4);
  }
  almostEqual(Physics.radiansPerSecondToRpm(Physics.rpmToRadiansPerSecond(930)), 930);
});

test('legacy flat-state adapters and SI conversion round-trip all motion axes', () => {
  const flat = { x: 300, y: 240, z: 24, vx: 17, vy: -4, zv: 3.2, spin: 0.35, dip: 0.08, flightType: 'shot' };
  const complete = Physics.fromLegacyState(flat);
  assert.equal(Physics.isCompleteState(complete), true);
  assert.deepEqual(Physics.toLegacyState(complete), { ...flat, flightAge: 0 });
  const roundTrip = Physics.siStateToLegacyWorld(Physics.legacyWorldStateToSI(complete));
  for (const key of ['x', 'y', 'z']) almostEqual(roundTrip.position[key], complete.position[key], 1e-9);
  for (const key of ['x', 'y', 'z']) almostEqual(roundTrip.velocity[key], complete.velocity[key], 1e-9);
});

test('legacy one-frame step is exactly move then gravity then horizontal drag', () => {
  const start = Physics.fromLegacyState({ x: 10, y: 20, z: 5, vx: 8, vy: -3, zv: 2 });
  const next = Physics.stepLegacy(start, 1, { gravityPerFrame: 0.26, airDragPerFrame: 0.9 });
  assert.deepEqual(next.position, { x: 18, y: 17, z: 7 });
  assert.deepEqual(next.velocity, { x: 7.2, y: -2.7, z: 1.74 });
  assert.equal(next.tick, 1);
  assert.deepEqual(start.position, { x: 10, y: 20, z: 5 });
});

test('legacy multi-frame stepping is deterministic and preserves the compatibility recurrence', () => {
  const start = Physics.fromLegacyState({ x: 5, y: 7, z: 9, vx: 4, vy: 2, zv: 1.5 });
  const once = Physics.stepLegacy(start, 12);
  const again = Physics.stepLegacy(start, 12);
  let repeated = start;
  for (let index = 0; index < 12; index += 1) repeated = Physics.stepLegacy(repeated, 1);
  assert.deepEqual(once, again);
  assert.deepEqual(once, repeated);
});

test('predictors use the same authoritative step function as manual advancement', () => {
  const legacy = Physics.fromLegacyState({ x: 0, y: 0, z: 12, vx: 8, vy: 2, zv: 4 });
  const prediction = Physics.predictSteps(legacy, 20, { mode: Physics.MODES.LEGACY });
  let manual = legacy;
  for (let index = 0; index < 20; index += 1) manual = Physics.step(manual, { mode: Physics.MODES.LEGACY });
  assert.deepEqual(prediction.state, manual);
  const landing = Physics.predictUntil(legacy, state => state.position.z <= 0, {
    mode: Physics.MODES.LEGACY,
    maxSteps: 180
  });
  assert.equal(landing.matched, true);
  assert.deepEqual(landing.state, landing.samples.at(-1));
});

test('kernel contains no random source or presentation-clock dependency', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
});

test('experimental SI aerodynamic drag reduces air speed deterministically', () => {
  const start = Physics.createState({
    position: { x: 0, y: 0, z: 5 },
    velocity: { x: 30, y: 0, z: 0 },
    grounded: false
  });
  const next = Physics.stepExperimental(start, 0.25);
  assert.ok(Math.hypot(next.velocity.x, next.velocity.y) < 30);
  assert.deepEqual(next, Physics.stepExperimental(start, 0.25));
});

test('experimental Magnus force bends a spinning flight without randomness', () => {
  const base = {
    position: { x: 0, y: 0, z: 3 },
    velocity: { x: 25, y: 0, z: 3 },
    grounded: false
  };
  const straight = Physics.stepExperimental(Physics.createState(base), 0.35);
  const curved = Physics.stepExperimental(Physics.createState({
    ...base,
    angularVelocity: { x: 0, y: 0, z: 70 }
  }), 0.35);
  almostEqual(straight.position.y, 0, 1e-12);
  assert.ok(curved.position.y > straight.position.y + 0.01);
});

test('experimental ground contact resolves bounce and records contact state', () => {
  const start = Physics.createState({
    position: { x: 0, y: 0, z: 0.45 },
    velocity: { x: 8, y: 1, z: -5 },
    grounded: false
  });
  const next = Physics.stepExperimental(start, 0.12);
  assert.ok(next.position.z >= next.radius);
  assert.ok(next.contactCount >= 1);
  assert.ok(next.lastContact && next.lastContact.normalSpeed > 0);
  assert.ok(next.velocity.z > 0);
});

test('experimental ground roll loses speed and reaches a stable settled state', () => {
  const rolling = Physics.createState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 3, y: 1, z: 0 },
    grounded: true
  });
  const slowed = Physics.stepExperimental(rolling, 0.5);
  assert.ok(Math.hypot(slowed.velocity.x, slowed.velocity.y) < Math.hypot(rolling.velocity.x, rolling.velocity.y));
  const quiet = Physics.createState({
    position: { x: 0, y: 0, z: 0.11 },
    velocity: { x: 0.01, y: 0, z: 0 },
    grounded: true
  });
  const settled = Physics.stepExperimental(quiet, 0.5);
  assert.equal(settled.settled, true);
  assert.deepEqual(settled.velocity, { x: 0, y: 0, z: 0 });
  assert.deepEqual(settled.angularVelocity, { x: 0, y: 0, z: 0 });
});

test('DORMANT AUTHORITY GATE: match page neither loads nor consumes the retired kernel', () => {
  // The deterministic kernel stays available to tests as a module, but the live
  // page no longer loads it and live gameplay must not consume it.
  assert.doesNotMatch(
    matchHtml,
    /ball-physics\.js/,
    'The retired dormant kernel must not be loaded by the live page'
  );
  assert.doesNotMatch(
    matchHtml,
    /FootballLegacyBallPhysics\.(?:step|stepLegacy|stepExperimental)\s*\(/,
    'Live gameplay must not consume the kernel until a separately gated opt-in migration'
  );
});
