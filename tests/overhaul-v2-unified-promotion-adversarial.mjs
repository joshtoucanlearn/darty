import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'match-engine');
const require = createRequire(import.meta.url);

const Orchestrator = require(path.join(engineDir, 'overhaul-shadow-orchestrator-v2.js'));
const CPU = require(path.join(engineDir, 'cpu-intelligence-v2.js'));
const Movement = require(path.join(engineDir, 'movement-engine-v2.js'));
const Formation = require(path.join(engineDir, 'formation-behaviour-v2.js'));
const Aerial = require(path.join(engineDir, 'aerial-contact-v2.js'));
const Ball = require(path.join(engineDir, 'ball-engine-v2.js'));

const FIXED_TICK = 1 / 60;
const LEGACY_PITCH = Object.freeze({ xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 });
const METRIC_PITCH = Object.freeze({ xMin: 0, xMax: 105, yMin: 0, yMax: 68 });
const REPRESENTATIVE_LINEUP = Object.freeze(Formation.canonicalLineup('4-4-2').map((row, index) =>
  Object.freeze({ ...row, id: `representative-home-${index + 1}` })
));
const REPRESENTATIVE_AWAY_LINEUP = Object.freeze(Formation.canonicalLineup('4-4-2').map((row, index) =>
  Object.freeze({ ...row, id: `representative-away-${index + 1}` })
));
const REPRESENTATIVE_HOME_COORDINATES = Object.freeze([
  [5, 34], [24, 58], [20, 43], [20, 25], [24, 10],
  [47, 58], [45, 42], [45, 26], [47, 10], [70, 42], [70, 26]
].map(Object.freeze));

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).map(key => [key, clone(value[key])]));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function capability(workflow = Orchestrator.WORKFLOWS.QUICK_PLAY) {
  return Orchestrator.createCapability({
    workflow,
    acknowledgement: Orchestrator.ACKNOWLEDGEMENT
  });
}

function adapter(options = {}) {
  const workflow = options.workflow || Orchestrator.WORKFLOWS.QUICK_PLAY;
  return Orchestrator.createAdapter({
    enabled: true,
    workflow,
    capability: capability(workflow),
    fixedTickSeconds: FIXED_TICK,
    seed: 173,
    sessionId: 'unified-v2-promotion-audit',
    traceLimit: 8,
    ...options
  });
}

function legacyBall(overrides = {}) {
  return {
    id: 'match-ball',
    x: 52.5,
    y: 34,
    z: 0,
    vx: 0,
    vy: 0,
    zv: 0,
    spin: 0,
    dip: 0,
    curveAccel: 0,
    flightType: null,
    ...overrides
  };
}

const legacyPlayers = Object.freeze([
  Object.freeze({ id: 'home-carrier', teamId: 'home', x: 1160, y: 1070, role: 'CM' }),
  Object.freeze({ id: 'home-runner', teamId: 'home', x: 1320, y: 390, role: 'LW' }),
  Object.freeze({ id: 'home-defender', teamId: 'home', x: 710, y: 790, role: 'CB' }),
  Object.freeze({ id: 'away-blocker', teamId: 'away', x: 1570, y: 440, role: 'RB' })
]);

function movementPlayers(scale = { x: 1, y: 1, xOffset: 0, yOffset: 0 }) {
  return legacyPlayers.map((row, index) => ({
    id: row.id,
    teamId: row.teamId,
    role: row.role,
    position: {
      x: (row.x - LEGACY_PITCH.xMin) * scale.x + scale.xOffset,
      y: (row.y - LEGACY_PITCH.yMin) * scale.y + scale.yOffset
    },
    velocity: { x: 0, y: 0 },
    facing: { x: row.teamId === 'home' ? 1 : -1, y: 0 },
    attributes: {
      pace: index === 1 ? 97 : 78,
      acceleration: index === 1 ? 99 : 78,
      agility: 78,
      balance: 78,
      strength: 78,
      stamina: 84,
      defending: row.role === 'CB' ? 86 : 70,
      aggression: 72,
      control: 82
    },
    staminaLevel: 100
  }));
}

function world(tick, pitch = LEGACY_PITCH, players = movementPlayers()) {
  return {
    schema: Movement.WORLD_SCHEMA,
    tick,
    fixedTickSeconds: FIXED_TICK,
    bounds: clone(pitch),
    ballOwnerId: 'home-carrier',
    players: clone(players)
  };
}

function cpuPlayersFromMovement(players) {
  return players.map(player => ({
    id: player.id,
    teamId: player.teamId,
    x: player.position.x,
    y: player.position.y,
    vx: 0,
    vy: 0,
    formationAnchor: clone(player.position),
    role: player.role,
    position: player.role,
    pace: player.attributes.pace,
    acceleration: player.attributes.acceleration,
    awareness: player.id === 'home-runner' ? 97 : 82,
    passing: player.id === 'home-carrier' ? 94 : 78,
    shooting: player.id === 'home-carrier' ? 72 : 68,
    control: player.attributes.control,
    stamina: 90,
    isGK: false
  }));
}

function representativePlayers() {
  const player = (id, teamId, role, position, index) => ({
    id,
    teamId,
    role,
    position: { x: position[0], y: position[1] },
    velocity: { x: 0, y: 0 },
    facing: { x: teamId === 'home' ? 1 : -1, y: 0 },
    attributes: {
      pace: 72 + (index % 7), acceleration: 74 + (index % 6), agility: 73,
      balance: 76, strength: 75, stamina: 84, defending: 68,
      aggression: 70, control: 78
    },
    staminaLevel: 100
  });
  return REPRESENTATIVE_LINEUP.map((row, index) => player(
    row.id, 'home', row.position, REPRESENTATIVE_HOME_COORDINATES[index], index
  )).concat(REPRESENTATIVE_AWAY_LINEUP.map((row, index) => player(
    row.id,
    'away',
    row.position,
    [METRIC_PITCH.xMax - REPRESENTATIVE_HOME_COORDINATES[index][0], REPRESENTATIVE_HOME_COORDINATES[index][1]],
    index + 11
  )));
}

function representativeSnapshot(tick) {
  const players = representativePlayers();
  const ownerId = 'representative-home-10';
  const representativeWorld = worldTick => ({
    schema: Movement.WORLD_SCHEMA,
    tick: worldTick,
    fixedTickSeconds: FIXED_TICK,
    bounds: clone(METRIC_PITCH),
    ballOwnerId: ownerId,
    players: clone(players)
  });
  return snapshot(tick, {
    pitch: METRIC_PITCH,
    players,
    mapping: mapping(players, {
      cpu: { complete: true, expectedTeamIds: ['home'], config: { fixedTickSeconds: FIXED_TICK } },
      formation: { complete: true, expectedTeamIds: ['away', 'home'] }
    }),
    movementBefore: representativeWorld(tick - 1),
    movementAfter: representativeWorld(tick),
    cpu: [{
      teamId: 'home',
      snapshot: {
        schema: CPU.SNAPSHOT_SCHEMA,
        tick,
        fixedTickSeconds: FIXED_TICK,
        teamId: 'home',
        possessionTeamId: 'home',
        carrierId: ownerId,
        attackingDirection: 1,
        offsideLine: 102,
        pitch: clone(METRIC_PITCH),
        ball: { x: 70, y: 42 },
        players: cpuPlayersFromMovement(players),
        events: []
      }
    }],
    formation: [{
      teamId: 'home',
      request: {
        schema: Formation.REQUEST_SCHEMA,
        tick,
        formation: '4-4-2',
        phase: 'settled-attack',
        pitch: clone(METRIC_PITCH),
        attackingDirection: 1,
        offsideLine: 102,
        lineup: clone(REPRESENTATIVE_LINEUP)
      }
    }, {
      teamId: 'away',
      request: {
        schema: Formation.REQUEST_SCHEMA,
        tick,
        formation: '4-4-2',
        phase: 'defend',
        pitch: clone(METRIC_PITCH),
        attackingDirection: -1,
        offsideLine: 3,
        lineup: clone(REPRESENTATIVE_AWAY_LINEUP)
      }
    }],
    gameplaySeconds: tick * FIXED_TICK
  });
}

function cpuSnapshot(tick, pitch, players, overrides = {}) {
  const carrier = players.find(player => player.id === 'home-carrier');
  return {
    schema: CPU.SNAPSHOT_SCHEMA,
    tick,
    fixedTickSeconds: FIXED_TICK,
    teamId: 'home',
    possessionTeamId: 'home',
    carrierId: 'home-carrier',
    attackingDirection: 1,
    offsideLine: pitch.xMax - (pitch.xMax - pitch.xMin) * 0.08,
    pitch: clone(pitch),
    ball: clone(carrier.position),
    players: cpuPlayersFromMovement(players),
    events: [],
    ...overrides
  };
}

function mapping(players, overrides = {}) {
  const base = {
    schema: Orchestrator.MAPPING_SCHEMA,
    complete: true,
    fixedTickSeconds: FIXED_TICK,
    components: { ball: true, movement: true, cpu: true, formation: true, clock: true },
    playerIds: Object.fromEntries(players.map(player => [player.id, player.id])),
    coordinateTransform: { xScale: 1, xOffset: 0, yScale: 1, yOffset: 0 },
    ball: {
      complete: true,
      units: {
        xUnitsPerMetre: 1,
        yUnitsPerMetre: 1,
        zUnitsPerMetre: 1,
        framesPerSecond: 60,
        ballRadiusMetres: 0.11
      },
      mapping: {},
      config: {}
    },
    movement: { complete: true, config: { fixedTickSeconds: FIXED_TICK } },
    cpu: { complete: true, expectedTeamIds: ['home'], config: { fixedTickSeconds: FIXED_TICK } },
    formation: { complete: true, expectedTeamIds: [] },
    clock: {
      complete: true,
      phaseMap: { PLAY: 'live', DEAD: 'dead-ball', SET_PIECE: 'set-piece', PAUSED: 'paused' },
      config: { fixedTickSeconds: FIXED_TICK, acceleration: 1 }
    }
  };
  return { ...base, ...clone(overrides) };
}

function snapshot(tick, options = {}) {
  const pitch = options.pitch || LEGACY_PITCH;
  const players = options.players || movementPlayers();
  const legacyPhase = options.legacyPhase || 'PLAY';
  const snapshotMapping = options.mapping || mapping(players);
  return {
    schema: Orchestrator.LEGACY_SNAPSHOT_SCHEMA,
    tick,
    fixedTickSeconds: FIXED_TICK,
    workflow: options.workflow || Orchestrator.WORKFLOWS.QUICK_PLAY,
    mapping: snapshotMapping,
    legacy: {
      ball: {
        before: legacyBall(options.ballBefore),
        after: legacyBall(options.ballAfter),
        environment: options.environment
      },
      movement: {
        before: options.movementBefore || world(tick - 1, pitch, players),
        after: options.movementAfter || world(tick, pitch, players),
        commands: options.commands || []
      },
      cpu: options.cpu || [{
        teamId: 'home',
        snapshot: cpuSnapshot(tick, pitch, players, options.cpuOverrides)
      }],
      formation: options.formation || [],
      clock: {
        legacyPhase,
        period: 'first-half',
        ballLive: legacyPhase === 'PLAY',
        gameplaySeconds: options.gameplaySeconds == null ? tick * FIXED_TICK : options.gameplaySeconds,
        reason: 'promotion-audit-' + legacyPhase
      }
    }
  };
}

function comparableOutput(output) {
  const copy = clone(output);
  delete copy.record;
  if (copy.telemetry) delete copy.telemetry.sessionId;
  return copy;
}

function scaleCpuSnapshotToMetric(input) {
  const source = clone(input);
  const canonical = CPU.CANONICAL_PITCH;
  const xScale = (METRIC_PITCH.xMax - METRIC_PITCH.xMin) / (canonical.xMax - canonical.xMin);
  const yScale = (METRIC_PITCH.yMax - METRIC_PITCH.yMin) / (canonical.yMax - canonical.yMin);
  const point = value => ({
    x: (value.x - canonical.xMin) * xScale + METRIC_PITCH.xMin,
    y: (value.y - canonical.yMin) * yScale + METRIC_PITCH.yMin
  });
  source.pitch = clone(METRIC_PITCH);
  source.offsideLine = point({ x: source.offsideLine, y: canonical.yMin }).x;
  source.ball = point(source.ball);
  source.players = source.players.map(player => ({
    ...player,
    ...point(player),
    formationAnchor: point(player.formationAnchor)
  }));
  source.events = source.events.map(event => ({
    ...event,
    target: event.target ? point(event.target) : null
  }));
  return source;
}

function metricPointToCanonical(value) {
  const canonical = CPU.CANONICAL_PITCH;
  return {
    x: (value.x - METRIC_PITCH.xMin) * (canonical.xMax - canonical.xMin) /
      (METRIC_PITCH.xMax - METRIC_PITCH.xMin) + canonical.xMin,
    y: (value.y - METRIC_PITCH.yMin) * (canonical.yMax - canonical.yMin) /
      (METRIC_PITCH.yMax - METRIC_PITCH.yMin) + canonical.yMin
  };
}

function assertPointNear(actual, expected, tolerance = 0.02) {
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `x ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `y ${actual.y} != ${expected.y}`);
}

test('failed first attachment is transactional and does not poison the valid tick-1 retry', () => {
  const reused = adapter();
  assert.throws(() => reused.observe(snapshot(2)), /pre-match tick 1/);

  const retry = reused.observe(snapshot(1));
  const clean = adapter().observe(snapshot(1));
  assert.deepEqual(comparableOutput(retry), comparableOutput(clean));
  assert.equal(reused.exportTrace().recordCount, 1);
});

test('failed mid-trace observation rolls back every engine before retrying the same tick', () => {
  const reused = adapter();
  const clean = adapter();
  reused.observe(snapshot(1));
  clean.observe(snapshot(1));

  const duplicateCommands = [
    { id: 'duplicate-id', tick: 2, playerId: 'home-carrier', type: 'move', move: { x: 1, y: 0 } },
    { id: 'duplicate-id', tick: 2, playerId: 'home-runner', type: 'move', move: { x: 1, y: 0 } }
  ];
  assert.throws(() => reused.observe(snapshot(2, { commands: duplicateCommands })), /duplicate command id/);

  const retry = reused.observe(snapshot(2));
  const expected = clean.observe(snapshot(2));
  assert.deepEqual(comparableOutput(retry), comparableOutput(expected));
  assert.equal(reused.exportTrace().recordCount, 2);
});

test('a late Ball V2 failure cannot commit earlier CPU, movement, or clock candidates', () => {
  const reused = adapter();
  const clean = adapter();
  reused.observe(snapshot(1));
  clean.observe(snapshot(1));
  const traceBeforeFailure = reused.stableTraceJson();

  // Ball is deliberately the final component in the unified barrier. A bad
  // environment therefore exercises rollback after CPU, formation, movement,
  // and MatchClock have all produced staged tick-2 candidates.
  assert.throws(() => reused.observe(snapshot(2, {
    environment: { airDensity: -1 }
  })), /airDensity|non-negative/i);
  assert.equal(reused.stableTraceJson(), traceBeforeFailure);

  const retry = reused.observe(snapshot(2));
  const expected = clean.observe(snapshot(2));
  assert.deepEqual(comparableOutput(retry), comparableOutput(expected));
  assert.equal(reused.exportTrace().recordCount, 2);
  assert.deepEqual(reused.exportTrace().ballTrace, clean.exportTrace().ballTrace);
});

test('sequential snapshots must preserve legacy movement and ball boundary continuity', () => {
  const movementAdapter = adapter();
  movementAdapter.observe(snapshot(1));
  const discontinuousPlayers = movementPlayers();
  discontinuousPlayers[0].position.x += 250;
  assert.throws(() => movementAdapter.observe(snapshot(2, {
    movementBefore: world(1, LEGACY_PITCH, discontinuousPlayers)
  })), /continuity|legacy movement/i);

  const ballAdapter = adapter();
  ballAdapter.observe(snapshot(1, { ballAfter: { x: 52.5 } }));
  assert.throws(() => ballAdapter.observe(snapshot(2, { ballBefore: { x: 999 } })), /continuity|legacy ball/i);
});

test('structural continuity preserves stable-JSON equivalence for signed zero', () => {
  const instance = adapter();
  instance.observe(snapshot(1, { ballAfter: { vx: -0 } }));
  assert.doesNotThrow(() => instance.observe(snapshot(2, { ballBefore: { vx: 0 } })));
});

test('structural continuity catches nested movement mutations while ignoring object key insertion order', () => {
  const reordered = adapter();
  reordered.observe(snapshot(1));
  const tickTwo = snapshot(2);
  const mappingEntries = Object.entries(tickTwo.mapping).reverse();
  tickTwo.mapping = Object.fromEntries(mappingEntries);
  assert.doesNotThrow(() => reordered.observe(tickTwo));

  const nestedMutation = adapter();
  nestedMutation.observe(snapshot(1));
  const changed = snapshot(2);
  changed.legacy.movement.before.players[0].attributes.control += 1;
  assert.throws(() => nestedMutation.observe(changed), /continuity|legacy movement/i);
});

test('structural continuity preserves stable JSON signed-zero equivalence', () => {
  const instance = adapter();
  instance.observe(snapshot(1, {
    ballAfter: { vx: -0 },
    movementAfter: world(1, LEGACY_PITCH, movementPlayers().map(player => ({
      ...player,
      velocity: { x: -0, y: player.velocity.y }
    })))
  }));
  assert.doesNotThrow(() => instance.observe(snapshot(2, {
    ballBefore: { vx: 0 },
    movementBefore: world(1, LEGACY_PITCH, movementPlayers())
  })));
});

test('structural mapping guard catches nested mutations after attachment', () => {
  const instance = adapter();
  instance.observe(snapshot(1));
  const changed = snapshot(2);
  changed.mapping.clock.config.acceleration = 2;
  assert.throws(() => instance.observe(changed), /mapping cannot change/i);
});

test('structural mapping guard preserves stable JSON omission and null coercion semantics', () => {
  const first = snapshot(1);
  first.mapping.diagnostic = {
    omitted: undefined,
    omittedFunction() {},
    nullNumber: Number.NaN,
    nullInfinity: Number.POSITIVE_INFINITY,
    arrayNull: [undefined, Number.NEGATIVE_INFINITY]
  };
  const second = snapshot(2);
  second.mapping.diagnostic = {
    nullNumber: null,
    nullInfinity: null,
    arrayNull: [null, null]
  };
  const instance = adapter();
  instance.observe(first);
  assert.doesNotThrow(() => instance.observe(second));
});

test('first mapping observation preserves stable JSON BigInt rejection timing', () => {
  const supplied = snapshot(1);
  supplied.mapping.diagnostic = { unsupportedInteger: 1n };
  assert.throws(() => adapter().observe(supplied), /BigInt|serializ/i);
});

test('continuity mismatch still traverses stable JSON unsupported values before rejecting', () => {
  const instance = adapter();
  instance.observe(snapshot(1));
  assert.throws(() => instance.observe(snapshot(2, {
    ballBefore: {
      x: 999,
      diagnostic: { unsupportedInteger: 1n }
    }
  })), /BigInt|serializ/i);
});

test('expected and supplied CPU team identities are unique before any engine advances', () => {
  const players = movementPlayers();
  const duplicateMapping = mapping(players, {
    cpu: { complete: true, expectedTeamIds: ['home', 'home'], config: { fixedTickSeconds: FIXED_TICK } }
  });
  const row = { teamId: 'home', snapshot: cpuSnapshot(1, LEGACY_PITCH, players) };
  const result = Orchestrator.validateLegacySnapshot(snapshot(1, {
    players,
    mapping: duplicateMapping,
    cpu: [clone(row), clone(row)]
  }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /unique|duplicate/i);
});

test('complete CPU mapping requires the full movement roster and matching team ownership', () => {
  const players = movementPlayers();
  const incomplete = cpuSnapshot(1, LEGACY_PITCH, players);
  incomplete.players = incomplete.players.filter(player => player.id !== 'away-blocker');
  const missing = Orchestrator.validateLegacySnapshot(snapshot(1, {
    players,
    cpu: [{ teamId: 'home', snapshot: incomplete }]
  }));
  assert.equal(missing.valid, false);
  assert.match(missing.errors.join('; '), /cpu.*player|roster|complete|missing/i);

  const wrongTeam = cpuSnapshot(1, LEGACY_PITCH, players);
  wrongTeam.players.find(player => player.id === 'home-runner').teamId = 'away';
  const ownership = Orchestrator.validateLegacySnapshot(snapshot(1, {
    players,
    cpu: [{ teamId: 'home', snapshot: wrongTeam }]
  }));
  assert.equal(ownership.valid, false);
  assert.match(ownership.errors.join('; '), /team|ownership|identity/i);
});

test('movement player team ownership cannot change across one legacy tick', () => {
  const players = movementPlayers();
  const afterPlayers = clone(players);
  afterPlayers.find(player => player.id === 'home-runner').teamId = 'away';
  const result = Orchestrator.validateLegacySnapshot(snapshot(1, {
    players,
    movementAfter: world(1, LEGACY_PITCH, afterPlayers)
  }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /team|ownership|identity/i);
});

test('formation entries cannot command a player owned by another movement team', () => {
  const slots = Formation.canonicalLineup('4-4-2');
  const players = slots.map((slot, index) => ({
    id: index === 0 ? 'home-carrier' :
      (index === slots.length - 1 ? 'away-in-home-shape' : `home-shape-${index + 1}`),
    teamId: index === slots.length - 1 ? 'away' : 'home',
    role: slot.position,
    position: { x: 400 + index * 170, y: 150 + (index % 4) * 430 },
    velocity: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    attributes: {
      pace: 78, acceleration: 78, agility: 78, balance: 78, strength: 78,
      stamina: 84, defending: 72, aggression: 72, control: 80
    },
    staminaLevel: 100
  }));
  const shapeMapping = mapping(players, {
    cpu: { complete: true, expectedTeamIds: [], config: { fixedTickSeconds: FIXED_TICK } },
    formation: { complete: true, expectedTeamIds: ['home'] }
  });
  const result = Orchestrator.validateLegacySnapshot(snapshot(1, {
    players,
    mapping: shapeMapping,
    cpu: [],
    formation: [{
      teamId: 'home',
      request: {
        schema: Formation.REQUEST_SCHEMA,
        tick: 1,
        formation: '4-4-2',
        phase: 'settled-attack',
        pitch: clone(LEGACY_PITCH),
        attackingDirection: 1,
        offsideLine: 2820,
        lineup: slots.map((slot, index) => ({ ...slot, id: players[index].id }))
      }
    }]
  }));
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), /formation.*team|ownership|belongs/i);
});

test('clock epoch and accepted observations cannot contradict the legacy time arrow', () => {
  const wrongEpoch = snapshot(1);
  wrongEpoch.legacy.clock.period = 'full-time';
  assert.throws(() => adapter().observe(wrongEpoch), /pre-match|first-half|epoch/i);

  const instance = adapter();
  instance.observe(snapshot(1, { gameplaySeconds: FIXED_TICK }));
  assert.throws(() => instance.observe(snapshot(2, { gameplaySeconds: 0 })), /clock|time|monotonic|continuity/i);
});

test('input snapshots and returned projections are isolated from shadow state', () => {
  const instance = adapter();
  const frozen = deepFreeze(snapshot(1));
  const before = Orchestrator.stableJson(frozen);
  const output = instance.observe(frozen);
  assert.equal(Orchestrator.stableJson(frozen), before);

  output.candidate.movement.players[0].position.x = -999999;
  output.legacySnapshot.legacy.ball.before.x = -999999;
  output.telemetry.components.cpu.length = 0;
  const state = instance.getShadowState();
  assert.notEqual(state.movement.players[0].position.x, -999999);
  assert.equal(instance.exportTrace().records[0].telemetry.components.cpu.length, 1);
});

test('caller mutation after observe cannot alter retained nested player or event state', () => {
  const first = snapshot(1, {
    cpuOverrides: {
      events: [{
        id: 'nested-caller-event', type: 'run-request', tick: 1, teamId: 'home',
        playerId: 'home-runner', runType: 'penetrating', target: { x: 1800, y: 420 }
      }]
    }
  });
  const cleanFirst = clone(first);
  const second = snapshot(2);
  const reused = adapter({ sessionId: 'post-observe-detachment' });
  const clean = adapter({ sessionId: 'post-observe-detachment' });
  reused.observe(first);
  clean.observe(cleanFirst);

  first.legacy.movement.after.players[0].attributes.control = 1;
  first.legacy.cpu[0].snapshot.players[0].formationAnchor.x = -999999;
  first.legacy.cpu[0].snapshot.events[0].target.x = -999999;

  assert.deepEqual(comparableOutput(reused.observe(second)), comparableOutput(clean.observe(clone(second))));
  assert.equal(reused.stableTraceJson(), clean.stableTraceJson());
});

test('online remains frozen even with an offline capability object and forged online flags', () => {
  const offlineCapability = capability();
  for (const options of [
    { enabled: true, workflow: Orchestrator.WORKFLOWS.ONLINE, capability: offlineCapability },
    { enabled: true, workflow: Orchestrator.WORKFLOWS.QUICK_PLAY, online: true, capability: offlineCapability }
  ]) {
    const status = Orchestrator.resolveStatus(options);
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'online-frozen');
    assert.equal(status.liveAuthority, Orchestrator.LIVE_AUTHORITY);
    assert.equal(status.readOnly, true);
    assert.equal(status.appliedToLive, false);
  }
});

test('public shadow API remains observation-only while live authority uses a separate exact offline adapter', () => {
  for (const forbidden of ['apply', 'project', 'commit', 'writeLive', 'setAuthority']) {
    assert.equal(Object.prototype.hasOwnProperty.call(Orchestrator, forbidden), false, forbidden);
  }
  const matchHtml = fs.readFileSync(path.join(engineDir, 'match.html'), 'utf8');
  const exactShadowStack = [
    'overhaul-shadow-orchestrator-v2.js', 'ball-engine-v2.js', 'ball-shadow-bridge-v2.js',
    'cpu-intelligence-v2.js', 'movement-engine-v2.js', 'formation-behaviour-v2.js',
    'match-clock-v2.js'
  ];
  const retiredShadowOnly = ['overhaul-shadow-orchestrator-v2.js', 'ball-shadow-bridge-v2.js'];
  for (const filename of exactShadowStack) {
    const mentions = matchHtml.split(`'${filename}'`).length - 1;
    // The two shadow-only modules are no longer named by the page at all; the rest still load through the live preflight.
    if (retiredShadowOnly.includes(filename)) assert.equal(mentions, 0, filename);
    else assert.ok(mentions >= 1, filename);
    assert.doesNotMatch(matchHtml, new RegExp(`<script\\s+src=["'][^"']*${filename.replace(/\./g, '\\.')}`, 'i'));
  }
  assert.match(matchHtml, /matchType=String\(decoded&&decoded\.matchType\|\|''\),liveWorkflow=matchType==='single-player'\?'single-player':matchType==='spectator'\?'cpu-v-cpu':matchType==='free-kick-suite'\?'set-piece-suite':null/);
  assert.match(matchHtml, /candidateValues\[0\]!=='5'/);
  assert.match(matchHtml, /quickPlayValues\[0\]!=='1'/);
  assert.match(matchHtml, /if\(!eligible\)return;[\s\S]*'aerial-contact-v2\.js'/);
  assert.match(matchHtml, /174-fl-v2-final-candidate-5/);
  assert.doesNotMatch(matchHtml, /<script[^>]+src=["']aerial-contact-v2\.js/);
  assert.doesNotMatch(matchHtml, /FootballLegacyOverhaulShadowOrchestratorV2/);
  assert.doesNotMatch(matchHtml, /build173V2Shadow\.(?:state|snapshot|commands?|apply|project|commit)\b/);
});

test('the current unified coordinator is a bounded five-engine comparator, not an aerial authority', () => {
  assert.deepEqual(Array.from(Orchestrator.REQUIRED_COMPONENTS), ['ball', 'movement', 'cpu', 'formation', 'clock']);
  assert.equal(Orchestrator.REQUIRED_COMPONENTS.includes('aerial'), false);
  assert.equal(Orchestrator.COMPONENT_ORDER.includes('aerial-contact'), false);
  const source = fs.readFileSync(path.join(engineDir, 'overhaul-shadow-orchestrator-v2.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]\.\/aerial-contact-v2\.js['"]\)/);
});

test('standalone Aerial V2 handoff remains deterministic and exactly consumable by Ball V2', () => {
  const request = Aerial.createRequest({
    id: 'promotion-audit-header',
    sessionId: 'promotion-audit-aerial',
    simulationTick: 100,
    contactTick: 100,
    inputTick: 96,
    technique: 'header',
    intent: 'shoot',
    actor: {
      id: 'home-header',
      teamId: 'home',
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      heightM: 1.84,
      attributes: {
        heading: 88, jumping: 86, strength: 82, technique: 84, shooting: 84,
        volleys: 78, balance: 82, agility: 80, awareness: 87, defend: 50
      }
    },
    ball: {
      id: 'match-ball',
      position: { x: 0.5, y: 0.02, z: 1.72 },
      velocity: { x: -8, y: 1.5, z: -1.2 },
      angularVelocity: { x: 3, y: -5, z: 7 },
      radiusM: 0.11
    },
    target: { x: 28, y: 1.2, z: 1.1 },
    opponents: []
  });
  const capability = Aerial.createShadowCapability({
    sessionId: request.sessionId,
    grant: Aerial.CAPABILITY_GRANT,
    runtimeMode: Aerial.RUNTIME_MODE,
    authority: Aerial.AUTHORITY,
    capabilityId: 'promotion-audit-capability'
  });
  const first = Aerial.resolveContact(request, capability);
  const second = Aerial.resolveContact(request, capability);
  assert.deepEqual(first, second);
  assert.equal(first.launchIntent?.schema, Ball.LAUNCH_SCHEMA);
  if (first.launchIntent) {
    const launch = Ball.resolveLaunch(first.launchIntent);
    assert.equal(launch.state.metadata.launchId, first.launchIntent.id);
    assert.ok(Number.isFinite(launch.state.velocity.x));
  }
});

test('metric 105x68 snapshots are valid without legacy screen-unit leakage', () => {
  const scale = {
    x: (METRIC_PITCH.xMax - METRIC_PITCH.xMin) / (LEGACY_PITCH.xMax - LEGACY_PITCH.xMin),
    y: (METRIC_PITCH.yMax - METRIC_PITCH.yMin) / (LEGACY_PITCH.yMax - LEGACY_PITCH.yMin),
    xOffset: METRIC_PITCH.xMin,
    yOffset: METRIC_PITCH.yMin
  };
  const players = movementPlayers(scale);
  const result = Orchestrator.validateLegacySnapshot(snapshot(1, {
    pitch: METRIC_PITCH,
    players,
    mapping: mapping(players)
  }));
  assert.equal(result.valid, true, result.errors.join('; '));
});

test('CPU decisions remain semantically invariant between canonical and metric pitch units', () => {
  assert.equal(CPU.COORDINATE_CONTRACT.authoredSpatialValues, 'canonical-reference-pitch-units');
  assert.deepEqual(CPU.COORDINATE_CONTRACT.referencePitch, CPU.CANONICAL_PITCH);
  const fixture = CPU.createBaleStyleOpenSpaceBeelineFixture();
  let canonicalMemory = CPU.createMemory();
  let metricMemory = CPU.createMemory();

  for (const phase of ['closed', 'opened', 'reacted']) {
    const canonicalDecision = CPU.decide(fixture.snapshots[phase], canonicalMemory);
    const metricDecision = CPU.decide(scaleCpuSnapshotToMetric(fixture.snapshots[phase]), metricMemory);
    canonicalMemory = canonicalDecision.memory;
    metricMemory = metricDecision.memory;

    assert.equal(metricDecision.carrierIntent.type, canonicalDecision.carrierIntent.type, phase);
    assert.equal(metricDecision.carrierIntent.targetPlayerId, canonicalDecision.carrierIntent.targetPlayerId, phase);
    assert.equal(metricDecision.carrierIntent.reason, canonicalDecision.carrierIntent.reason, phase);
    assert.equal(metricDecision.carrierIntent.confidence, canonicalDecision.carrierIntent.confidence, phase);
    assert.deepEqual(metricDecision.telemetry.constraints, canonicalDecision.telemetry.constraints, phase);
    assert.deepEqual(
      metricDecision.runs.map(run => [run.playerId, run.runType, run.score, run.clearance, run.passClearance]),
      canonicalDecision.runs.map(run => [run.playerId, run.runType, run.score, run.clearance, run.passClearance]),
      phase
    );
    if (canonicalDecision.carrierIntent.target) {
      assertPointNear(metricPointToCanonical(metricDecision.carrierIntent.target), canonicalDecision.carrierIntent.target);
    }
    for (let index = 0; index < canonicalDecision.runs.length; index += 1) {
      assertPointNear(metricPointToCanonical(metricDecision.runs[index].target), canonicalDecision.runs[index].target);
      assertPointNear(
        metricPointToCanonical(metricDecision.runs[index].continuationTarget),
        canonicalDecision.runs[index].continuationTarget
      );
    }
  }
});

test('representative 22-player read-only shadow stays inside a bounded per-tick CPU budget and trace window', t => {
  const tickCount = 180;
  const instance = adapter({ traceLimit: 16, sessionId: 'performance-bound' });
  const started = process.hrtime.bigint();
  for (let tick = 1; tick <= tickCount; tick += 1) instance.observe(representativeSnapshot(tick));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const averageMs = elapsedMs / tickCount;
  const trace = instance.exportTrace();
  t.diagnostic(`representative 22-player ${tickCount}-tick mean: ${averageMs.toFixed(3)} ms; trace bytes: ${JSON.stringify(trace).length}`);
  assert.ok(averageMs < 5, `representative shadow mean ${averageMs.toFixed(3)} ms exceeds 5 ms`);
  assert.equal(trace.recordCount, 16);
  assert.equal(trace.ballTrace.recordCount, 16);
  assert.ok(JSON.stringify(trace).length < 2_000_000, 'bounded trace unexpectedly exceeds 2 MB');
});

test('representative 22-player trace is invariant across arbitrary render-frame batches', () => {
  const snapshots = Array.from({ length: 48 }, (_, index) => representativeSnapshot(index + 1));
  const individual = adapter({ traceLimit: 64, sessionId: 'chunk-invariance' });
  const batched = adapter({ traceLimit: 64, sessionId: 'chunk-invariance' });
  snapshots.forEach(item => individual.observe(item));
  for (const [start, end] of [[0, 1], [1, 8], [8, 9], [9, 27], [27, 48]]) {
    batched.observeTimeline(snapshots.slice(start, end));
  }
  assert.deepEqual(batched.getShadowState(), individual.getShadowState());
  assert.equal(batched.stableTraceJson(), individual.stableTraceJson());
});

test('unified formation telemetry reuses the exact validated deterministic output', () => {
  const supplied = representativeSnapshot(1);
  const expected = supplied.legacy.formation.map(entry => ({
    teamId: entry.teamId,
    output: Formation.resolve(entry.request)
  })).sort((a, b) => a.teamId.localeCompare(b.teamId));
  const observed = adapter({ traceLimit: 2, sessionId: 'formation-output-equivalence' }).observe(supplied);

  assert.deepEqual(observed.candidate.formation, expected);
  assert.deepEqual(
    observed.telemetry.components.formation,
    expected.map(entry => ({ teamId: entry.teamId, telemetry: clone(entry.output.telemetry) }))
  );
});

test('bounded trace retention never exposes a candidate projection method', () => {
  const instance = adapter({ traceLimit: 3 });
  for (let tick = 1; tick <= 6; tick += 1) instance.observe(snapshot(tick));
  const trace = instance.exportTrace();
  assert.equal(trace.recordCount, 3);
  assert.deepEqual(trace.records.map(record => record.tick), [4, 5, 6]);
  assert.equal(typeof instance.projectCandidate, 'undefined');
  assert.equal(typeof instance.applyToLive, 'undefined');
});
