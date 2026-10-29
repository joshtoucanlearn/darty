import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Ball = require(path.join(root, 'match-engine', 'ball-engine-v2.js'));
const matchHtml = fs.readFileSync(path.join(root, 'match-engine', 'match.html'), 'utf8');

const almost = (actual, expected, tolerance = 1e-9, label = 'values') => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label} differ: ${actual} vs ${expected}`);
};

const almostVector = (actual, expected, tolerance = 1e-9) => {
  for (const axis of ['x', 'y', 'z']) almost(actual[axis], expected[axis], tolerance, axis);
};

const isolatedConfig = Ball.createConfig({
  gravity: { x: 0, y: 0, z: 0 },
  angularDecayPerSecond: 0,
  dragSurface: [{ speed: 0, coefficient: 0 }],
  magnus: { liftSlope: 0.72, maximumLiftCoefficient: 0.34, minimumSpeed: 0 },
  knuckle: { enabled: false }
});

const environment = (overrides = {}) => ({
  wind: { x: 0, y: 0, z: 0 },
  airDensity: isolatedConfig.airDensity,
  airDynamicViscosity: isolatedConfig.airDynamicViscosity,
  ...overrides
});

const state = (overrides = {}) => Ball.createBallState({
  position: { x: 0, y: 0, z: 3 },
  velocity: { x: 30, y: 0, z: 0 },
  angularVelocity: { x: 0, y: 0, z: 0 },
  grounded: false,
  ...overrides
});

test('MR aerodynamics loads only behind exact V2 preflight and preserves untuned profile defaults', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']ball-engine-v2\.js/i);
  assert.match(matchHtml, /id="build173V2ShadowPreflight"/);
  const shadowStart = matchHtml.indexOf('<script id="build173V2ShadowPreflight">');
  const shadowEnd = matchHtml.indexOf('</script>', shadowStart);
  const shadowPreflight = matchHtml.slice(shadowStart, shadowEnd);
  assert.ok(shadowPreflight.indexOf('if(!eligible)return;') < shadowPreflight.indexOf("['ball-engine-v2.js'"),
    'shadow Ball V2 bytes must load only after exact shadow eligibility');
  const liveStart = matchHtml.indexOf('<script id="offlineLiveV2Preflight">');
  const liveEnd = matchHtml.indexOf('</script>', liveStart);
  const livePreflight = matchHtml.slice(liveStart, liveEnd);
  assert.ok(livePreflight.indexOf('if(!eligible)return;') < livePreflight.indexOf("const pieces=['ball-engine-v2.js'"),
    'live MR bytes must load only after exact offline workflow eligibility');
  assert.match(livePreflight, /'live-v2-authority-adapter\.js'/);
  const presentationLine = matchHtml.split('\n').find(line => line.includes('config.systems='));
  assert.ok(presentationLine, 'the named-engine presentation config must exist');
  assert.equal((presentationLine.match(/FootballLegacyBallEngineV2/g) || []).length, 2);
  const measurementStart = matchHtml.indexOf('  function measureHumanGroundPassRendezvous(');
  assert.ok(measurementStart >= 0, 'the reviewed trajectory measurement must remain explicit');
  const measurementEnd = matchHtml.indexOf('\n  function ', measurementStart + 1);
  assert.ok(measurementEnd > measurementStart);
  const measurement = matchHtml.slice(measurementStart, measurementEnd);
  assert.match(measurement, /Ball\.resolveLaunch\(/);
  assert.match(measurement, /Ball\.step\(/);
  assert.doesNotMatch(measurement, /\bball\s*(?:\.|\[)/,
    'trajectory measurement must not access the live host ball');
  assert.doesNotMatch(matchHtml.replace(presentationLine, '').replace(measurement, ''), /FootballLegacyBallEngineV2/,
    'Ball V2 host references are limited to presentation and the read-only trajectory measurement');
  assert.match(presentationLine, /ballPhysics:window\.FootballLegacyBallEngineV2&&window\.FootballLegacyBallEngineV2\.ENGINE_NAME/);
  assert.deepEqual(Ball.DEFAULT_CONFIG.dragSurface, [
    { speed: 0, coefficient: 0.20 },
    { speed: 12, coefficient: 0.22 },
    { speed: 25, coefficient: 0.25 },
    { speed: 40, coefficient: 0.28 }
  ]);
  assert.equal(Ball.DEFAULT_CONFIG.angularDecayPerSecond, 0.16);
  assert.equal(Ball.DEFAULT_CONFIG.knuckle.enabled, false);
  assert.equal('reverseMagnus' in Ball.DEFAULT_CONFIG.magnus, false);
});

test('Magnus lift uses transverse spin only and cannot be inflated by axial spin', () => {
  const context = Ball.createSimulationContext({ seed: 0x173 });
  const transverse = Ball.aerodynamicAcceleration(
    state({ angularVelocity: { x: 0, y: 0, z: 20 } }),
    environment(),
    isolatedConfig,
    context
  );
  const mixed = Ball.aerodynamicAcceleration(
    state({ angularVelocity: { x: 500, y: 0, z: 20 } }),
    environment(),
    isolatedConfig,
    context
  );
  const axial = Ball.aerodynamicAcceleration(
    state({ angularVelocity: { x: 500, y: 0, z: 0 } }),
    environment(),
    isolatedConfig,
    context
  );

  almost(mixed.spinParameter, transverse.spinParameter, 1e-12, 'spin parameters');
  almost(mixed.liftCoefficient, transverse.liftCoefficient, 1e-12, 'lift coefficients');
  almostVector(mixed.acceleration, transverse.acceleration, 1e-12);
  assert.equal(axial.spinParameter, 0);
  assert.equal(axial.liftCoefficient, 0);
  almostVector(axial.acceleration, { x: 0, y: 0, z: 0 }, 1e-12);
});

test('Magnus remains wind-relative, orthogonal to airflow and odd under spin reversal', () => {
  const context = Ball.createSimulationContext({ seed: 0x174 });
  const positive = Ball.aerodynamicAcceleration(
    state({ angularVelocity: { x: 0, y: 0, z: 20 } }),
    environment(),
    isolatedConfig,
    context
  );
  const negative = Ball.aerodynamicAcceleration(
    state({ angularVelocity: { x: 0, y: 0, z: -20 } }),
    environment(),
    isolatedConfig,
    context
  );
  const translated = Ball.aerodynamicAcceleration(
    state({ velocity: { x: 40, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 20 } }),
    environment({ wind: { x: 10, y: 0, z: 0 } }),
    isolatedConfig,
    context
  );

  almostVector(positive.acceleration, translated.acceleration, 1e-12);
  almostVector(positive.acceleration, {
    x: -negative.acceleration.x,
    y: -negative.acceleration.y,
    z: -negative.acceleration.z
  }, 1e-12);
  almost(Ball.vectorMath.dot(positive.acceleration, { x: 30, y: 0, z: 0 }), 0, 1e-12,
    'Magnus/airflow dot product');
});

test('Reynolds telemetry has SI scaling without silently retuning the drag surface', () => {
  const context = Ball.createSimulationContext({ seed: 0x175 });
  const baseline = Ball.aerodynamicAcceleration(state(), environment(), isolatedConfig, context);
  const large = Ball.aerodynamicAcceleration(state({ radius: 0.22 }), environment(), isolatedConfig, context);
  const thinAir = Ball.aerodynamicAcceleration(
    state(), environment({ airDensity: isolatedConfig.airDensity / 2 }), isolatedConfig, context
  );
  const viscous = Ball.aerodynamicAcceleration(
    state(), environment({ airDynamicViscosity: isolatedConfig.airDynamicViscosity * 2 }), isolatedConfig, context
  );
  const expected = isolatedConfig.airDensity * 30 * 0.22 / isolatedConfig.airDynamicViscosity;

  almost(baseline.reynoldsNumber, expected, 1e-8, 'Reynolds number');
  almost(large.reynoldsNumber, baseline.reynoldsNumber * 2, 1e-8, 'diameter scaling');
  almost(thinAir.reynoldsNumber, baseline.reynoldsNumber / 2, 1e-8, 'density scaling');
  almost(viscous.reynoldsNumber, baseline.reynoldsNumber / 2, 1e-8, 'viscosity scaling');
  assert.equal(baseline.dragCoefficient, viscous.dragCoefficient,
    'viscosity is diagnostic until a validated ball-profile coefficient surface exists');
});

test('seeded knuckle forcing is bounded, zero-mean and temporally correlated', () => {
  const config = Ball.createConfig({
    gravity: { x: 0, y: 0, z: 0 },
    angularDecayPerSecond: 0,
    dragSurface: [{ speed: 0, coefficient: 0 }],
    magnus: { liftSlope: 0, maximumLiftCoefficient: 0, minimumSpeed: 0 },
    knuckle: {
      enabled: true,
      acceleration: 2,
      minimumSpeed: 18,
      maximumSpin: 6,
      oscillationFrequencyHz: 3.5
    }
  });
  const sample = (seed, time, angularVelocity = { x: 0, y: 0, z: 0 }, speed = 30) =>
    Ball.aerodynamicAcceleration(
      state({ velocity: { x: speed, y: 0, z: 0 }, angularVelocity, simulationTime: time }),
      {
        wind: { x: 0, y: 0, z: 0 },
        airDensity: config.airDensity,
        airDynamicViscosity: config.airDynamicViscosity
      },
      config,
      Ball.createSimulationContext({ seed })
    ).knuckleAcceleration;

  const dt = 1 / 240;
  const series = Array.from({ length: 480 }, (_, index) => sample(0x176, index * dt).y);
  const repeat = Array.from({ length: 480 }, (_, index) => sample(0x176, index * dt).y);
  const other = Array.from({ length: 480 }, (_, index) => sample(0x177, index * dt).y);
  assert.deepEqual(series, repeat);
  assert.notDeepEqual(series, other);
  assert.ok(series.every(value => Math.abs(value) <= 2 + 1e-12));
  almost(series.reduce((sum, value) => sum + value, 0) / series.length, 0, 1e-10, 'two-second mean');

  const lagProduct = series.slice(1).reduce((sum, value, index) => sum + value * series[index], 0);
  const energy = series.slice(0, -1).reduce((sum, value) => sum + value * value, 0);
  assert.ok(lagProduct / energy > 0.99, 'forcing should be strongly correlated at adjacent 240 Hz samples');

  const rising = Ball.aerodynamicAcceleration(
    state({ velocity: { x: 30, y: 0, z: 8 }, simulationTime: 0.137 }),
    {
      wind: { x: 0, y: 0, z: 0 },
      airDensity: config.airDensity,
      airDynamicViscosity: config.airDynamicViscosity
    },
    config,
    Ball.createSimulationContext({ seed: 0x176 })
  );
  almost(Ball.vectorMath.dot(rising.knuckleAcceleration, { x: 30, y: 0, z: 8 }), 0, 1e-12,
    'knuckle/airflow dot product');

  almostVector(sample(0x176, 0, { x: 0, y: 0, z: 7 }), { x: 0, y: 0, z: 0 }, 1e-12);
  almostVector(sample(0x176, 0, { x: 0, y: 0, z: 0 }, 17), { x: 0, y: 0, z: 0 }, 1e-12);
});

test('correlated knuckle flight is replay- and render-chunk invariant', () => {
  const initial = state();
  const config = {
    gravity: { x: 0, y: 0, z: 0 },
    angularDecayPerSecond: 0,
    dragSurface: [{ speed: 0, coefficient: 0 }],
    magnus: { liftSlope: 0, maximumLiftCoefficient: 0, minimumSpeed: 0 },
    knuckle: {
      enabled: true,
      acceleration: 2,
      minimumSpeed: 18,
      maximumSpin: 6,
      oscillationFrequencyHz: 3.5
    }
  };
  const run = stepDuration => Ball.advance(initial, Ball.createSimulationContext({ seed: 0x178 }), {
    duration: 1,
    stepDuration,
    environment: { groundEnabled: false },
    config
  });
  const sixty = run(1 / 60);
  const thirty = run(1 / 30);

  almostVector(sixty.state.position, thirty.state.position, 2e-8);
  almostVector(sixty.state.velocity, thirty.state.velocity, 2e-8);
  assert.equal(sixty.context.substepCount, thirty.context.substepCount);
  assert.equal(sixty.context.randomDrawCount, 0);
  assert.equal(thirty.context.randomDrawCount, 0);
});
