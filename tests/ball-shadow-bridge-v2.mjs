import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginePath = path.join(root, 'match-engine', 'ball-engine-v2.js');
const bridgePath = path.join(root, 'match-engine', 'ball-shadow-bridge-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const engineSource = fs.readFileSync(enginePath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(enginePath);
const Bridge = require(bridgePath);

const noAir = {
  gravity: { x: 0, y: 0, z: 0 },
  airDensity: 0,
  angularDecayPerSecond: 0
};

const legacy = (overrides = {}) => ({
  id: 'legacy-ball',
  x: 1000,
  y: 500,
  z: 20,
  vx: 2,
  vy: -1,
  zv: 0.5,
  spin: 0,
  dip: 0,
  curveAccel: 0,
  flightType: 'pass',
  ...overrides
});

const almost = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

function candidateCapability(scope, workflow) {
  return Bridge.createCapability({
    scope,
    workflow,
    acknowledgement: Bridge.ACKNOWLEDGEMENT
  });
}

test('shadow bridge exposes CommonJS/browser APIs and has only the exact-flag conditional match-page load', () => {
  assert.equal(Bridge.VERSION, '2.0.0-dormant-shadow-bridge');
  for (const name of [
    'createUnitSystem', 'createCapability', 'resolveAuthority', 'legacyToCandidateState',
    'candidateToLegacyState', 'compareLegacyToCandidate', 'createBridge'
  ]) assert.equal(typeof Bridge[name], 'function', name);

  const browser = { window: {} };
  vm.runInNewContext(engineSource, browser);
  vm.runInNewContext(bridgeSource, browser);
  assert.equal(browser.window.FootballLegacyBallShadowBridgeV2.VERSION, Bridge.VERSION);
  assert.doesNotMatch(matchHtml, /<script\s+src=["'][^"']*ball-shadow-bridge-v2\.js/i);
  assert.equal((matchHtml.match(/ball-shadow-bridge-v2\.js/g) || []).length, 0);
  assert.doesNotMatch(matchHtml, /FootballLegacyBallShadowBridgeV2/);
});

test('bridge has no random source or wall/presentation clock dependency', () => {
  assert.doesNotMatch(bridgeSource, /Math\.random\s*\(/);
  assert.doesNotMatch(bridgeSource, /Date\.(?:now|UTC)\s*\(/);
  assert.doesNotMatch(bridgeSource, /performance\.now\s*\(/);
  assert.doesNotMatch(bridgeSource, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(bridgeSource, /setTimeout\s*\(/);
});

test('Build 173 is the default authority and online is frozen even when candidate is requested', () => {
  const normal = Bridge.resolveAuthority({});
  assert.equal(normal.authority, Bridge.AUTHORITIES.LEGACY);
  assert.equal(normal.shadowEnabled, false);
  assert.equal(normal.reason, 'legacy-default');

  const online = Bridge.resolveAuthority({
    mode: Bridge.MODES.OFFLINE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.ONLINE,
    online: true
  });
  assert.equal(online.authority, Bridge.AUTHORITIES.LEGACY);
  assert.equal(online.mode, Bridge.MODES.LEGACY);
  assert.equal(online.reason, 'online-frozen');
});

test('candidate modes require exact explicit capabilities and workflow scope', () => {
  assert.throws(() => Bridge.createCapability({
    scope: Bridge.MODES.SUITE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SET_PIECE_SUITE,
    acknowledgement: 'yes'
  }), /explicit acknowledgement/);

  const rejected = Bridge.resolveAuthority({
    mode: Bridge.MODES.SUITE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SET_PIECE_SUITE
  });
  assert.equal(rejected.authority, Bridge.AUTHORITIES.LEGACY);

  const wrongWorkflowCapability = candidateCapability(
    Bridge.MODES.OFFLINE_CANDIDATE,
    Bridge.WORKFLOWS.QUICK_PLAY
  );
  const stillRejected = Bridge.resolveAuthority({
    mode: Bridge.MODES.OFFLINE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SINGLE_PLAYER,
    capability: wrongWorkflowCapability
  });
  assert.equal(stillRejected.authority, Bridge.AUTHORITIES.LEGACY);

  const suiteCapability = candidateCapability(
    Bridge.MODES.SUITE_CANDIDATE,
    Bridge.WORKFLOWS.SET_PIECE_SUITE
  );
  const suite = Bridge.resolveAuthority({
    mode: Bridge.MODES.SUITE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SET_PIECE_SUITE,
    capability: suiteCapability
  });
  assert.equal(suite.authority, Bridge.AUTHORITIES.CANDIDATE);
  assert.equal(suite.reason, 'explicit-suite-candidate');

  const offlineCapability = candidateCapability(
    Bridge.MODES.OFFLINE_CANDIDATE,
    Bridge.WORKFLOWS.SINGLE_PLAYER
  );
  const offline = Bridge.resolveAuthority({
    mode: Bridge.MODES.OFFLINE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SINGLE_PLAYER,
    capability: offlineCapability
  });
  assert.equal(offline.authority, Bridge.AUTHORITIES.CANDIDATE);
  assert.equal(offline.reason, 'explicit-offline-candidate');
});

test('legacy world/SI conversion round-trips positions and per-frame velocities', () => {
  const input = legacy({ spin: 3 });
  const mapping = { spinRadiansPerSecondPerLegacyUnit: 2.5 };
  const mapped = Bridge.legacyToCandidateState(input, { outerTick: 0, elapsed: 0, mapping });
  const projected = Bridge.candidateToLegacyState(mapped.state, { units: mapped.units, mapping, template: input });
  for (const key of ['x', 'y', 'z', 'vx', 'vy', 'zv', 'spin']) almost(projected[key], input[key]);
  assert.equal(mapped.state.simulationTime, 0);

  const grounded = Bridge.legacyToCandidateState(legacy({ z: 0, zv: 0, vx: 0, vy: 0 }), { outerTick: 0, elapsed: 0 });
  assert.equal(grounded.state.position.z, grounded.state.radius);
  assert.equal(grounded.state.grounded, true);
  assert.equal(Bridge.candidateToLegacyState(grounded.state).z, 0);
});

test('legacy curve fields are never silently treated as a complete mapping', () => {
  const input = legacy({ spin: 4, dip: 0.7, curveAccel: 0.2 });
  const unmapped = Bridge.legacyToCandidateState(input, { outerTick: 0, elapsed: 0 });
  assert.deepEqual(unmapped.unmappedFields, ['spin', 'dip', 'curveAccel']);
  assert.equal(unmapped.completeMapping, false);

  const mappedSpin = Bridge.legacyToCandidateState(input, {
    outerTick: 0,
    elapsed: 0,
    mapping: { spinRadiansPerSecondPerLegacyUnit: 3 }
  });
  assert.deepEqual(mappedSpin.unmappedFields, ['dip', 'curveAccel']);
  assert.equal(mappedSpin.completeMapping, false);
});

test('shadow mode requires a non-zero explicit deterministic seed', () => {
  assert.throws(() => Bridge.createBridge({ mode: Bridge.MODES.SHADOW }), /seed/);
  assert.throws(() => Bridge.createBridge({ mode: Bridge.MODES.SHADOW, seed: 0 }), /must not be zero/);
  const legacyBridge = Bridge.createBridge({});
  assert.equal(legacyBridge.authority.authority, Bridge.AUTHORITIES.LEGACY);
});

test('shadow observation is side-effect-free and compares through one fixed 60 Hz step', () => {
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SHADOW,
    workflow: Bridge.WORKFLOWS.QUICK_PLAY,
    seed: 123,
    config: noAir
  });
  const before = legacy({ z: 100, zv: 0, spin: 0 });
  const after = legacy({ x: before.x + before.vx, y: before.y + before.vy, z: 100, zv: 0, spin: 0 });
  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(after);
  const result = adapter.observeStep({
    outerTick: 1,
    legacyBefore: before,
    legacyAfter: after,
    environment: { groundEnabled: false, airDensity: 0 }
  });
  assert.equal(JSON.stringify(before), beforeJson);
  assert.equal(JSON.stringify(after), afterJson);
  assert.equal(result.appliedToLive, false);
  almost(result.comparison.positionErrorWorld, 0, 1e-7);
  almost(result.comparison.velocityErrorWorldPerFrame, 0, 1e-7);
  assert.equal(result.context.outerTick, 1);
  assert.equal(adapter.exportTrace().records.at(-1).type, 'shadow-step');
});

test('shadow observations must use sequential authoritative outer ticks', () => {
  const adapter = Bridge.createBridge({ mode: Bridge.MODES.SHADOW, seed: 7, config: noAir });
  adapter.registerLegacyState(legacy(), { outerTick: 10 });
  assert.throws(() => adapter.observeStep({
    outerTick: 12,
    legacyBefore: legacy(),
    legacyAfter: legacy()
  }), /sequential outer ticks/);
});

test('same registered snapshot and observations emit byte-identical shadow traces', () => {
  const run = () => {
    const adapter = Bridge.createBridge({
      mode: Bridge.MODES.SHADOW,
      workflow: Bridge.WORKFLOWS.QUICK_PLAY,
      seed: 991,
      sessionId: 'deterministic-shadow',
      config: noAir
    });
    adapter.registerLegacyState(legacy({ z: 50, zv: 0 }), { outerTick: 0 });
    adapter.observeStep({
      outerTick: 1,
      legacyBefore: legacy({ z: 50, zv: 0 }),
      legacyAfter: legacy({ x: 1002, y: 499, z: 50, zv: 0 }),
      environment: { groundEnabled: false }
    });
    return adapter.exportTrace();
  };
  assert.deepEqual(run(), run());
});

test('candidate projection is forbidden in shadow and enabled only by an accepted capability', () => {
  const shadow = Bridge.createBridge({ mode: Bridge.MODES.SHADOW, seed: 8 });
  shadow.registerLegacyState(legacy(), { outerTick: 0 });
  assert.throws(() => shadow.candidateAuthorityOutput(legacy()), /Build 173 is authoritative/);

  const capability = candidateCapability(
    Bridge.MODES.SUITE_CANDIDATE,
    Bridge.WORKFLOWS.SET_PIECE_SUITE
  );
  const suite = Bridge.createBridge({
    mode: Bridge.MODES.SUITE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SET_PIECE_SUITE,
    capability,
    seed: 9
  });
  suite.registerLegacyState(legacy(), { outerTick: 0 });
  const output = suite.candidateAuthorityOutput(legacy({ custom: 'preserved' }));
  assert.equal(output.custom, 'preserved');
  assert.equal(output.candidateRegime, Ball.REGIMES.FLIGHT);
  assert.equal(typeof output.candidateSignature, 'string');
});

test('candidate launch registration aligns simulation tick/time and survives missing legacy metadata', () => {
  const capability = candidateCapability(
    Bridge.MODES.SUITE_CANDIDATE,
    Bridge.WORKFLOWS.SET_PIECE_SUITE
  );
  const suite = Bridge.createBridge({
    mode: Bridge.MODES.SUITE_CANDIDATE,
    workflow: Bridge.WORKFLOWS.SET_PIECE_SUITE,
    capability,
    seed: 10,
    config: noAir
  });
  suite.registerCandidateLaunch({
    id: 'suite-launch',
    source: 'set-piece-suite',
    origin: { x: 10, y: 5, z: 0.11 },
    direction: { x: 1, y: 0, z: 0 },
    speed: 20,
    liftAngleDeg: 10
  }, { outerTick: 12 });
  assert.equal(suite.getCandidateState().lastOuterTick, 12);
  almost(suite.getCandidateState().simulationTime, 12 / 60);
  assert.equal(suite.getContext().outerTick, 12);

  const result = suite.observeStep({
    outerTick: 13,
    legacyBefore: legacy(),
    legacyAfter: legacy(),
    environment: { groundEnabled: false }
  });
  assert.equal(result.record.completeMapping, true);
  assert.deepEqual(result.record.unmappedFields, []);
});

test('legacy/online bridge calls are logged as skipped and cannot create candidate state', () => {
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SHADOW,
    workflow: Bridge.WORKFLOWS.ONLINE,
    online: true,
    seed: 5
  });
  const registration = adapter.registerLegacyState(legacy(), { outerTick: 0 });
  const observation = adapter.observeStep({ outerTick: 1 });
  assert.equal(registration.type, 'registration-skipped');
  assert.equal(observation.record.type, 'observation-skipped');
  assert.equal(adapter.getCandidateState(), null);
  assert.equal(adapter.getContext(), null);
});

test('trace export is JSON-safe, bounded and resettable', () => {
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SHADOW,
    seed: 11,
    traceLimit: 2,
    config: noAir
  });
  adapter.registerLegacyState(legacy({ z: 40, zv: 0 }), { outerTick: 0 });
  adapter.observeStep({
    outerTick: 1,
    legacyBefore: legacy({ z: 40, zv: 0 }),
    legacyAfter: legacy({ x: 1002, y: 499, z: 40, zv: 0 }),
    environment: { groundEnabled: false }
  });
  adapter.observeStep({
    outerTick: 2,
    legacyBefore: legacy({ x: 1002, y: 499, z: 40, zv: 0 }),
    legacyAfter: legacy({ x: 1004, y: 498, z: 40, zv: 0 }),
    environment: { groundEnabled: false }
  });
  const exported = adapter.exportTrace();
  assert.equal(exported.recordCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(exported)), exported);
  assert.deepEqual(exported.records.map(record => record.type), ['shadow-step', 'shadow-step']);
  adapter.reset();
  assert.equal(adapter.exportTrace().recordCount, 0);
  assert.equal(adapter.getCandidateState(), null);
  assert.equal(adapter.getContext().outerTick, 0);
});
