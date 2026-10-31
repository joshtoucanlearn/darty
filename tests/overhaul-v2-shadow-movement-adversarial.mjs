import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ballPath = path.join(root, 'match-engine', 'ball-engine-v2.js');
const bridgePath = path.join(root, 'match-engine', 'ball-shadow-bridge-v2.js');
const movementPath = path.join(root, 'match-engine', 'movement-engine-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const ballSource = fs.readFileSync(ballPath, 'utf8');
const bridgeSource = fs.readFileSync(bridgePath, 'utf8');
const movementSource = fs.readFileSync(movementPath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(ballPath);
const Bridge = require(bridgePath);
const Movement = require(movementPath);

const FIXED_TICK = 1 / 60;
const noAir = Object.freeze({
  gravity: { x: 0, y: 0, z: 0 },
  airDensity: 0,
  angularDecayPerSecond: 0
});

function legacy(overrides = {}) {
  return {
    id: 'legacy-ball',
    x: 1000,
    y: 500,
    z: 40,
    vx: 2,
    vy: -1,
    zv: 0,
    spin: 0,
    dip: 0,
    curveAccel: 0,
    ...overrides
  };
}

function capability(scope, workflow) {
  return Bridge.createCapability({
    scope,
    workflow,
    acknowledgement: Bridge.ACKNOWLEDGEMENT
  });
}

function player(id, teamId, x, y, overrides = {}) {
  return {
    id,
    teamId,
    role: overrides.role || 'midfielder',
    position: { x, y },
    velocity: overrides.velocity || { x: 0, y: 0 },
    facing: overrides.facing || { x: 1, y: 0 },
    attributes: {
      pace: 78,
      acceleration: 78,
      agility: 78,
      balance: 78,
      strength: 78,
      stamina: 80,
      defending: 70,
      aggression: 72,
      control: 78,
      ...(overrides.attributes || {})
    }
  };
}

function world(players, overrides = {}) {
  return {
    tick: overrides.tick ?? 0,
    fixedTickSeconds: FIXED_TICK,
    bounds: overrides.bounds || { xMin: -100, xMax: 100, yMin: -50, yMax: 50 },
    ballOwnerId: overrides.ballOwnerId ?? null,
    players
  };
}

test('ball, shadow bridge and movement candidate coexist in CommonJS and one browser realm', () => {
  assert.equal(Ball.VERSION, '2.0.0-shadow');
  assert.equal(Bridge.VERSION, '2.0.0-dormant-shadow-bridge');
  assert.equal(Movement.VERSION, '2.0.0-dormant');
  assert.notEqual(Ball, Bridge);
  assert.notEqual(Ball, Movement);
  assert.notEqual(Bridge, Movement);

  const browser = { window: {} };
  vm.runInNewContext(ballSource, browser);
  vm.runInNewContext(bridgeSource, browser);
  vm.runInNewContext(movementSource, browser);
  assert.equal(browser.window.FootballLegacyBallEngineV2.VERSION, Ball.VERSION);
  assert.equal(browser.window.FootballLegacyBallShadowBridgeV2.VERSION, Bridge.VERSION);
  assert.equal(browser.window.FootballLegacyMovementEngineV2.VERSION, Movement.VERSION);
});

test('LIVE AUTHORITY GATE: candidates remain default-off and frozen online', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["'](?:ball-engine-v2|ball-shadow-bridge-v2|movement-engine-v2)\.js/i);
  const match = matchHtml.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/);
  assert.ok(match, 'conditional offline-live preflight must exist');

  const run = (search = '', payload = null) => {
    const writes = [];
    const window = {};
    const hash = payload === null
      ? ''
      : `#flMatch=${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
    vm.runInNewContext(match[1], {
      window,
      location: { search, hash },
      document: { write: value => writes.push(String(value)) },
      URLSearchParams,
      TextDecoder,
      Uint8Array,
      atob
    });
    return {
      diagnostic: JSON.parse(JSON.stringify(window.__FL_V2_LIVE_PREFLIGHT)),
      writes
    };
  };

  const defaultRoute = run();
  assert.equal(defaultRoute.diagnostic.requested, false);
  assert.equal(defaultRoute.diagnostic.eligible, false);
  assert.equal(defaultRoute.diagnostic.reason, 'not-requested');
  assert.deepEqual(defaultRoute.writes, []);

  const onlineRoute = run(
    '?engine=fl-v2&simulationSeed=173&online=true',
    {
      matchType: 'single-player',
      simulationSeed: 173,
      engine: {
        requested: 'fl-v2',
        effective: 'fl-v2',
        version: '1.0.0-offline-live-authority-playtest',
        fallbackReason: null
      },
      online: true
    }
  );
  assert.equal(onlineRoute.diagnostic.requested, true);
  assert.equal(onlineRoute.diagnostic.eligible, false);
  assert.equal(onlineRoute.diagnostic.reason, 'frozen-or-unsupported');
  assert.ok(onlineRoute.diagnostic.urlMarkers.includes('online'));
  assert.ok(onlineRoute.diagnostic.urlMarkers.includes('decoded-online'));
  assert.deepEqual(onlineRoute.writes, []);
});

test('online freezes legacy authority even with an otherwise valid offline capability', () => {
  const offlineCapability = capability(Bridge.MODES.OFFLINE_CANDIDATE, Bridge.WORKFLOWS.QUICK_PLAY);
  for (const request of [
    {
      mode: Bridge.MODES.OFFLINE_CANDIDATE,
      workflow: Bridge.WORKFLOWS.QUICK_PLAY,
      online: true,
      capability: offlineCapability
    },
    {
      mode: Bridge.MODES.OFFLINE_CANDIDATE,
      workflow: Bridge.WORKFLOWS.ONLINE,
      online: false,
      capability: offlineCapability
    }
  ]) {
    const authority = Bridge.resolveAuthority(request);
    assert.equal(authority.authority, Bridge.AUTHORITIES.LEGACY);
    assert.equal(authority.mode, Bridge.MODES.LEGACY);
    assert.equal(authority.shadowEnabled, false);
    assert.equal(authority.reason, 'online-frozen');
    const adapter = Bridge.createBridge({ ...request, seed: 99 });
    assert.throws(() => adapter.candidateAuthorityOutput(legacy()), /Build 173 is authoritative/);
    assert.equal(adapter.getCandidateState(), null);
  }
});

test('shadow replay and reset produce byte-identical bounded traces without live output', () => {
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SHADOW,
    workflow: Bridge.WORKFLOWS.QUICK_PLAY,
    seed: 0x173,
    sessionId: 'reset-replay',
    config: noAir
  });
  const run = () => {
    const before = legacy();
    const after = legacy({ x: 1002, y: 499 });
    adapter.registerLegacyState(before, { outerTick: 0 });
    const result = adapter.observeStep({
      outerTick: 1,
      legacyBefore: before,
      legacyAfter: after,
      environment: { groundEnabled: false }
    });
    assert.equal(result.appliedToLive, false);
    assert.throws(() => adapter.candidateAuthorityOutput(after), /Build 173 is authoritative/);
    return adapter.exportTrace();
  };
  const first = run();
  adapter.reset();
  const second = run();
  assert.deepEqual(second, first);
});

test('reserved bridge provenance cannot be overwritten by caller metadata', () => {
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SHADOW,
    workflow: Bridge.WORKFLOWS.QUICK_PLAY,
    seed: 23,
    config: noAir
  });
  const input = legacy({ spin: 5, dip: 2, curveAccel: 3 });
  const registration = adapter.registerLegacyState(input, {
    outerTick: 0,
    metadata: { source: 'caller-value', unmappedFields: [] }
  });
  assert.equal(registration.completeMapping, false);
  const observation = adapter.observeStep({
    outerTick: 1,
    legacyBefore: input,
    legacyAfter: legacy({ x: 1002, y: 499, spin: 5, dip: 2, curveAccel: 3 }),
    environment: { groundEnabled: false }
  });
  assert.equal(observation.record.completeMapping, false);
  assert.deepEqual(observation.record.unmappedFields, ['spin', 'dip', 'curveAccel']);
  assert.equal(observation.candidateState.metadata.source, 'build-173-legacy-snapshot');
});

test('candidate authority refuses an incomplete legacy-to-candidate mapping', () => {
  const workflow = Bridge.WORKFLOWS.SET_PIECE_SUITE;
  const adapter = Bridge.createBridge({
    mode: Bridge.MODES.SUITE_CANDIDATE,
    workflow,
    capability: capability(Bridge.MODES.SUITE_CANDIDATE, workflow),
    seed: 24
  });
  const input = legacy({ spin: 5, dip: 2, curveAccel: 3 });
  const registration = adapter.registerLegacyState(input, { outerTick: 0 });
  assert.equal(registration.completeMapping, false);
  assert.throws(() => adapter.candidateAuthorityOutput(input), /incomplete|unmapped/i);
});

test('movement with explicit command IDs is invariant across full-timeline and incremental delivery', () => {
  const start = world([player('runner', 'home', 0, 0)]);
  const move = {
    id: 'move-1', tick: 1, playerId: 'runner', type: 'move', move: { x: 1, y: 0 },
    mode: 'run', durationTicks: 2
  };
  const stop = { id: 'stop-2', tick: 2, playerId: 'runner', type: 'stop' };
  const full = Movement.advance(start, [move, stop], 2);
  const first = Movement.advance(start, [move], 1);
  const incremental = Movement.advance(first.state, [stop], 1);
  assert.deepEqual(incremental.state, full.state);
});

test('implicit command identity is stable across full-timeline and incremental delivery', () => {
  const start = world([player('runner', 'home', 0, 0)]);
  const move = { tick: 1, playerId: 'runner', type: 'move', move: { x: 1, y: 0 }, durationTicks: 2 };
  const stop = { tick: 2, playerId: 'runner', type: 'stop' };
  const full = Movement.advance(start, [move, stop], 2);
  const first = Movement.advance(start, [move], 1);
  const incremental = Movement.advance(first.state, [stop], 1);
  assert.deepEqual(incremental.state, full.state);
});

test('unique command IDs make same-tick input-order irrelevant', () => {
  const start = world([player('runner', 'home', 0, 0)]);
  const left = {
    id: 'a-left', tick: 1, playerId: 'runner', type: 'move', move: { x: -1, y: 0 }, durationTicks: 2
  };
  const right = {
    id: 'b-right', tick: 1, playerId: 'runner', type: 'move', move: { x: 1, y: 0 }, durationTicks: 2
  };
  assert.deepEqual(
    Movement.advance(start, [left, right], 1),
    Movement.advance(start, [right, left], 1)
  );
});

test('duplicate explicit command IDs are rejected rather than preserving caller array order', () => {
  const start = world([player('runner', 'home', 0, 0)]);
  const left = {
    id: 'duplicate', tick: 1, playerId: 'runner', type: 'move', move: { x: -1, y: 0 }, durationTicks: 2
  };
  const right = {
    id: 'duplicate', tick: 1, playerId: 'runner', type: 'move', move: { x: 1, y: 0 }, durationTicks: 2
  };
  assert.throws(() => Movement.advance(start, [left, right], 1), /duplicate command id/i);
});

test('zero-length action phases cannot erase an accepted action in its acknowledgement tick', () => {
  const start = world([
    player('actor', 'home', 0, 0, { role: 'defender' }),
    player('target', 'away', 10, 0, { role: 'forward' })
  ]);
  const zero = Movement.advance(start, [{
    id: 'zero-action', tick: 1, playerId: 'actor', type: 'stand-tackle',
    targetId: 'target', direction: { x: 1, y: 0 }
  }], 1, {
    tackleWindupTicks: 0,
    tackleContactTicks: 0,
    tackleRecoveryTicks: 0
  });
  const actor = zero.state.players.find(item => item.id === 'actor');
  assert.equal(actor.visibleAction, true);
  assert.ok(actor.action);
});

test('retriggering an active action cannot erase the first accepted action terminal outcome', () => {
  const start = world([
    player('actor', 'home', 0, 0, { role: 'defender' }),
    player('target', 'away', 10, 0, { role: 'forward' })
  ]);
  const retrigger = Movement.advance(start, [
    {
      id: 'first-action', tick: 1, playerId: 'actor', type: 'stand-tackle',
      targetId: 'target', direction: { x: 1, y: 0 }
    },
    {
      id: 'second-action', tick: 2, playerId: 'actor', type: 'stand-tackle',
      targetId: 'target', direction: { x: 1, y: 0 }
    }
  ], 20);
  const accepted = retrigger.telemetry.commandAcks.filter(event => event.accepted);
  const terminalCommandIds = retrigger.telemetry.actions
    .filter(event => /(?:win|lost|miss|cancelled|rejected)$/.test(event.type))
    .map(event => event.commandId);
  for (const ack of accepted) {
    assert.equal(terminalCommandIds.filter(id => id === ack.commandId).length, 1, ack.commandId);
  }
});

test('three-body separation is deterministic and player-input-order invariant', () => {
  const players = [
    player('charlie', 'home', 0, 0),
    player('alpha', 'away', 0, 0),
    player('bravo', 'home', 0, 0)
  ];
  const bounds = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };
  const ordered = Movement.separatePlayers(players, bounds);
  const reversed = Movement.separatePlayers([...players].reverse(), bounds);
  assert.deepEqual(reversed, ordered);
});
