import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'match-engine');
const modulePath = path.join(engineDir, 'overhaul-shadow-orchestrator-v2.js');
const matchPath = path.join(engineDir, 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Orchestrator = require(modulePath);
const Bridge = require(path.join(engineDir, 'ball-shadow-bridge-v2.js'));
const CPU = require(path.join(engineDir, 'cpu-intelligence-v2.js'));
const Movement = require(path.join(engineDir, 'movement-engine-v2.js'));
const Formation = require(path.join(engineDir, 'formation-behaviour-v2.js'));
const Clock = require(path.join(engineDir, 'match-clock-v2.js'));

const FIXED_TICK = 1 / 60;

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
    sessionId: 'unified-v2-test',
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

const formationLineup = Formation.canonicalLineup('4-4-2').map((row, index) => ({
  ...row,
  id: `home-${index + 1}`
}));

const homeCoordinates = [
  [5, 34], [24, 58], [20, 43], [20, 25], [24, 10],
  [47, 58], [45, 42], [45, 26], [47, 10], [70, 42], [70, 26]
];
const awayCoordinates = [[86, 24], [87, 44]];

function movementPlayer(id, teamId, coordinate, position, index) {
  return {
    id,
    teamId,
    role: position,
    position: { x: coordinate[0], y: coordinate[1] },
    velocity: { x: 0, y: 0 },
    facing: { x: teamId === 'home' ? 1 : -1, y: 0 },
    attributes: {
      pace: 72 + (index % 7), acceleration: 74 + (index % 6), agility: 73,
      balance: 76, strength: 75, stamina: 84, defending: 68,
      aggression: 70, control: 78
    },
    staminaLevel: 100
  };
}

function movementPlayers() {
  const home = formationLineup.map((row, index) => movementPlayer(
    row.id, 'home', homeCoordinates[index], row.position, index
  ));
  const away = awayCoordinates.map((coordinate, index) => movementPlayer(
    `away-${index + 1}`, 'away', coordinate, index ? 'CB' : 'RB', index + 11
  ));
  return home.concat(away);
}

function cpuPlayers() {
  return movementPlayers().map(player => ({
    id: player.id,
    teamId: player.teamId,
    x: player.position.x,
    y: player.position.y,
    vx: 0,
    vy: 0,
    formationAnchor: { x: player.position.x, y: player.position.y },
    role: player.role,
    position: player.role,
    pace: player.attributes.pace,
    acceleration: player.attributes.acceleration,
    awareness: player.teamId === 'home' ? 84 : 78,
    passing: 82,
    shooting: player.role === 'ST' ? 88 : 66,
    control: 82,
    stamina: 90,
    isGK: player.role === 'GK'
  }));
}

function world(tick, overrides = {}) {
  return {
    schema: Movement.WORLD_SCHEMA,
    tick,
    fixedTickSeconds: FIXED_TICK,
    bounds: { xMin: 0, xMax: 105, yMin: 0, yMax: 68 },
    ballOwnerId: 'home-10',
    players: movementPlayers(),
    ...overrides
  };
}

function mapping(overrides = {}) {
  const ids = Object.fromEntries(movementPlayers().map(player => [player.id, player.id]));
  const base = {
    schema: Orchestrator.MAPPING_SCHEMA,
    complete: true,
    fixedTickSeconds: FIXED_TICK,
    components: { ball: true, movement: true, cpu: true, formation: true, clock: true },
    playerIds: ids,
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
    formation: { complete: true, expectedTeamIds: ['home'] },
    clock: {
      complete: true,
      phaseMap: { PLAY: 'live', DEAD: 'dead-ball', SET_PIECE: 'set-piece', PAUSED: 'paused' },
      config: { fixedTickSeconds: FIXED_TICK, acceleration: 1 }
    }
  };
  return { ...base, ...overrides };
}

function snapshot(tick, options = {}) {
  const legacyPhase = options.legacyPhase || 'PLAY';
  const liveTicks = options.liveTicks == null ? tick : options.liveTicks;
  return {
    schema: Orchestrator.LEGACY_SNAPSHOT_SCHEMA,
    tick,
    fixedTickSeconds: FIXED_TICK,
    workflow: options.workflow || Orchestrator.WORKFLOWS.QUICK_PLAY,
    mapping: options.mapping || mapping(),
    legacy: {
      ball: {
        before: legacyBall(options.ballBefore),
        after: legacyBall(options.ballAfter),
        environment: options.environment
      },
      movement: {
        before: world(tick - 1),
        after: world(tick),
        commands: options.commands || []
      },
      cpu: [{
        teamId: 'home',
        snapshot: {
          schema: CPU.SNAPSHOT_SCHEMA,
          tick,
          fixedTickSeconds: FIXED_TICK,
          teamId: 'home',
          possessionTeamId: 'home',
          carrierId: 'home-10',
          attackingDirection: 1,
          offsideLine: 102,
          pitch: { xMin: 0, xMax: 105, yMin: 0, yMax: 68 },
          ball: { x: 70, y: 42 },
          players: cpuPlayers(),
          events: options.events || []
        }
      }],
      formation: [{
        teamId: 'home',
        request: {
          schema: Formation.REQUEST_SCHEMA,
          tick,
          formation: '4-4-2',
          phase: options.formationPhase || 'settled-attack',
          pitch: { xMin: 0, xMax: 105, yMin: 0, yMax: 68 },
          attackingDirection: 1,
          offsideLine: 102,
          lineup: formationLineup
        }
      }],
      clock: {
        legacyPhase,
        period: 'first-half',
        ballLive: legacyPhase === 'PLAY',
        gameplaySeconds: liveTicks * FIXED_TICK,
        reason: 'test-' + legacyPhase
      }
    }
  };
}

test('CommonJS API exposes a dormant unified shadow coordinator', () => {
  assert.equal(Orchestrator.VERSION, '2.0.0-dormant-unified-shadow');
  assert.equal(Orchestrator.LIVE_AUTHORITY, 'build-173-legacy');
  assert.deepEqual(Array.from(Orchestrator.COMPONENT_ORDER), [
    'clock-phase', 'formation-behaviour', 'cpu-intelligence',
    'movement-contact', 'ball-integration', 'comparison-telemetry'
  ]);
  for (const name of [
    'createCapability', 'resolveStatus', 'validateLegacySnapshot',
    'assertLegacySnapshot', 'createAdapter', 'stableJson'
  ]) assert.equal(typeof Orchestrator[name], 'function', `${name} must be exported`);
});

test('plain browser scripts expose the orchestrator only after all five dependencies', () => {
  const browserWindow = {};
  const context = { window: browserWindow };
  for (const filename of [
    'ball-engine-v2.js', 'ball-shadow-bridge-v2.js', 'cpu-intelligence-v2.js',
    'movement-engine-v2.js', 'formation-behaviour-v2.js', 'match-clock-v2.js',
    'overhaul-shadow-orchestrator-v2.js'
  ]) vm.runInNewContext(fs.readFileSync(path.join(engineDir, filename), 'utf8'), context);
  assert.equal(browserWindow.FootballLegacyOverhaulShadowOrchestratorV2.VERSION, Orchestrator.VERSION);
  assert.equal(typeof browserWindow.FootballLegacyOverhaulShadowOrchestratorV2.createAdapter, 'function');
});

test('EXACT-FLAG AUTHORITY GATE: match.html conditionally loads but never directly calls the unified orchestrator', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["'][^"']*overhaul-shadow-orchestrator-v2\.js/i);
  assert.equal((matchHtml.match(/overhaul-shadow-orchestrator-v2\.js/g) || []).length, 0);
  assert.doesNotMatch(matchHtml, /FootballLegacyOverhaulShadowOrchestratorV2/);
  assert.match(source, /Intentionally dormant and read-only/i);
  assert.match(source, /Build 173 remains the sole live[\s*]+authority/i);
});

test('determinism gate: no random, wall-clock, presentation-clock, timer or RAF authority', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /new\s+Date\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('DEFAULT DISABLED GATE: malformed observations cannot invoke a candidate by accident', () => {
  const dormant = Orchestrator.createAdapter();
  assert.equal(dormant.status.enabled, false);
  assert.equal(dormant.status.reason, 'disabled-by-default');
  const result = dormant.observe({ tick: 999, malformed: true });
  assert.equal(result.enabled, false);
  assert.equal(result.authority, Orchestrator.LIVE_AUTHORITY);
  assert.equal(result.appliedToLive, false);
  assert.equal(dormant.getShadowState().ball, null);
  assert.equal(dormant.exportTrace().ballTrace, null);
});

test('capability must use the exact acknowledgement and workflow scope', () => {
  assert.throws(() => Orchestrator.createCapability({
    workflow: Orchestrator.WORKFLOWS.QUICK_PLAY,
    acknowledgement: 'yes'
  }), /exact read-only acknowledgement/);
  const wrong = capability(Orchestrator.WORKFLOWS.SINGLE_PLAYER);
  const status = Orchestrator.resolveStatus({
    enabled: true,
    workflow: Orchestrator.WORKFLOWS.QUICK_PLAY,
    capability: wrong
  });
  assert.equal(status.enabled, false);
  assert.equal(status.reason, 'capability-rejected');
});

test('ONLINE FROZEN GATE: no capability can enable the online workflow', () => {
  assert.throws(() => Orchestrator.createCapability({
    workflow: Orchestrator.WORKFLOWS.ONLINE,
    acknowledgement: Orchestrator.ACKNOWLEDGEMENT
  }), /offline workflow/);
  const status = Orchestrator.resolveStatus({
    enabled: true,
    workflow: Orchestrator.WORKFLOWS.ONLINE,
    capability: { ...capability(), workflow: Orchestrator.WORKFLOWS.ONLINE }
  });
  assert.equal(status.enabled, false);
  assert.equal(status.reason, 'online-frozen');
  assert.equal(status.liveAuthority, 'build-173-legacy');
});

test('every existing offline workflow can be explicitly observed without becoming authoritative', () => {
  for (const workflow of Orchestrator.OFFLINE_WORKFLOWS) {
    const status = Orchestrator.resolveStatus({ enabled: true, workflow, capability: capability(workflow) });
    assert.equal(status.enabled, true, workflow);
    assert.equal(status.liveAuthority, Orchestrator.LIVE_AUTHORITY);
    assert.equal(status.appliedToLive, false);
  }
});

test('complete legacy snapshot validates all five mapped components', () => {
  assert.deepEqual(Orchestrator.validateLegacySnapshot(snapshot(1), {
    workflow: Orchestrator.WORKFLOWS.QUICK_PLAY
  }), { valid: true, errors: [] });
});

test('ATOMIC MAPPING GATE: every component must be explicitly complete', () => {
  for (const component of Orchestrator.REQUIRED_COMPONENTS) {
    const broken = snapshot(1);
    broken.mapping.components[component] = false;
    const result = Orchestrator.validateLegacySnapshot(broken);
    assert.equal(result.valid, false, component);
    assert.match(result.errors.join(' '), new RegExp('components\\.' + component));
  }
});

test('identity, unit, team-set and clock mappings fail closed instead of guessing', () => {
  const missingId = snapshot(1);
  delete missingId.mapping.playerIds['home-1'];
  assert.match(Orchestrator.validateLegacySnapshot(missingId).errors.join(' '), /no explicit playerIds mapping/);

  const wrongRate = snapshot(1);
  wrongRate.mapping.ball.units.framesPerSecond = 30;
  assert.match(Orchestrator.validateLegacySnapshot(wrongRate).errors.join(' '), /reciprocal/);

  const wrongTeams = snapshot(1);
  wrongTeams.mapping.cpu.expectedTeamIds = [];
  assert.match(Orchestrator.validateLegacySnapshot(wrongTeams).errors.join(' '), /team set/);

  const unknownPhase = snapshot(1);
  unknownPhase.legacy.clock.legacyPhase = 'MYSTERY';
  unknownPhase.legacy.clock.ballLive = false;
  assert.match(Orchestrator.validateLegacySnapshot(unknownPhase).errors.join(' '), /no explicit phaseMap/);
});

test('ball spin/dip/curve fields cannot pass under a falsely complete top-level flag', () => {
  const broken = snapshot(1, { ballBefore: { dip: 0.4 }, ballAfter: { dip: 0.4 } });
  const validation = Orchestrator.validateLegacySnapshot(broken);
  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /ball mapping is incomplete.*dip/);
});

test('fixed-tick composition emits all five aligned candidates and read-only comparisons', () => {
  const shadow = adapter();
  const result = shadow.observe(snapshot(1));
  assert.equal(result.tick, 1);
  assert.equal(result.authority, Orchestrator.LIVE_AUTHORITY);
  assert.equal(result.shadowAuthority, Orchestrator.SHADOW_AUTHORITY);
  assert.equal(result.appliedToLive, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.candidate.ball.lastOuterTick, 1);
  assert.equal(result.candidate.movement.tick, 1);
  assert.equal(result.candidate.clock.tick, 1);
  assert.equal(result.candidate.cpu[0].decision.tick, 1);
  assert.equal(result.candidate.formation[0].output.tick, 1);
  assert.equal(result.telemetry.mappingComplete, true);
  assert.equal(result.telemetry.components.ball.record.type, 'shadow-step');
  assert.equal(result.telemetry.components.movement.endTick, 1);
  assert.equal(result.telemetry.components.clock.tick, 1);
  assert.ok(result.telemetry.commandDerivations.some(row => row.source === 'formation-target'));
  assert.ok(result.telemetry.comparisons.movement.players.length > 0);
});

test('explicit legacy movement commands outrank CPU and formation-derived commands', () => {
  const shadow = adapter();
  const input = snapshot(1, {
    commands: [{
      id: 'legacy-user-move', tick: 1, playerId: 'home-1', type: 'move',
      move: { x: 0, y: 1 }, mode: 'sprint', intensity: 1, durationTicks: 1
    }]
  });
  const result = shadow.observe(input);
  const derivation = result.telemetry.commandDerivations.find(row => row.playerId === 'home-1');
  assert.equal(derivation.source, 'explicit-legacy-command');
  const acks = result.telemetry.components.movement.commandAcks.filter(row => row.playerId === 'home-1');
  assert.equal(acks.length, 1);
  assert.equal(acks[0].accepted, true);
});

test('MatchClock composition follows FIFA-style live/dead timing without touching legacy time', () => {
  const shadow = adapter();
  const live = shadow.observe(snapshot(1, { legacyPhase: 'PLAY', liveTicks: 1 }));
  const stopped = shadow.observe(snapshot(2, { legacyPhase: 'DEAD', liveTicks: 1 }));
  assert.ok(Math.abs(live.candidate.clock.clocks.gameplaySeconds - FIXED_TICK) < 1e-6);
  assert.ok(Math.abs(stopped.candidate.clock.clocks.gameplaySeconds - FIXED_TICK) < 1e-6);
  assert.ok(Math.abs(stopped.candidate.clock.clocks.animationElapsedSeconds - (2 * FIXED_TICK)) < 1e-6);
  assert.equal(stopped.candidate.clock.phase, 'dead-ball');
  assert.equal(stopped.legacySnapshot.legacy.clock.gameplaySeconds, FIXED_TICK);
});

test('sequential and mapping-stability gates reject replay gaps or mid-trace reinterpretation', () => {
  const gap = adapter();
  gap.observe(snapshot(1));
  assert.throws(() => gap.observe(snapshot(3)), /sequential fixed ticks/);

  const drift = adapter();
  drift.observe(snapshot(1));
  const changed = snapshot(2);
  changed.mapping.coordinateTransform.xOffset = 1;
  assert.throws(() => drift.observe(changed), /mapping cannot change/);
});

test('shared clock epoch requires pre-match attachment rather than inventing missing history', () => {
  const shadow = adapter();
  assert.throws(() => shadow.observe(snapshot(20)), /attach at pre-match tick 1/);
});

test('legacy snapshots are preserved exactly and never mutated by observation', () => {
  const input = snapshot(1);
  const before = clone(input);
  deepFreeze(input);
  const result = adapter().observe(input);
  assert.deepEqual(input, before);
  assert.deepEqual(result.legacySnapshot, before);
  assert.notEqual(result.legacySnapshot, input);
});

test('determinism gate: identical adapters and legacy traces emit byte-identical output', () => {
  const first = adapter();
  const second = adapter();
  const a = first.observeTimeline([
    snapshot(1),
    snapshot(2, { legacyPhase: 'DEAD', liveTicks: 1 }),
    snapshot(3, { legacyPhase: 'PLAY', liveTicks: 2 })
  ]);
  const b = second.observeTimeline([
    snapshot(1),
    snapshot(2, { legacyPhase: 'DEAD', liveTicks: 1 }),
    snapshot(3, { legacyPhase: 'PLAY', liveTicks: 2 })
  ]);
  assert.equal(Orchestrator.stableJson(a), Orchestrator.stableJson(b));
  assert.equal(first.stableTraceJson(), second.stableTraceJson());
});

test('frame-chunk gate: one timeline call equals the same snapshots observed individually', () => {
  const batched = adapter();
  const stepped = adapter();
  const inputs = [snapshot(1), snapshot(2), snapshot(3)];
  const batchOutput = batched.observeTimeline(inputs.map(clone));
  const stepOutput = inputs.map(input => stepped.observe(clone(input)));
  assert.equal(Orchestrator.stableJson(batchOutput), Orchestrator.stableJson(stepOutput));
  assert.equal(batched.stableTraceJson(), stepped.stableTraceJson());
});

test('trace export is stable JSON telemetry and contains no live projection surface', () => {
  const shadow = adapter();
  shadow.observe(snapshot(1));
  const trace = shadow.exportTrace();
  assert.equal(trace.recordCount, 1);
  assert.equal(trace.records[0].telemetry.appliedToLive, false);
  assert.equal(trace.ballTrace.authority.authority, Bridge.AUTHORITIES.LEGACY);
  assert.equal(typeof shadow.candidateAuthorityOutput, 'undefined');
  assert.equal(shadow.stableTraceJson(), Orchestrator.stableJson(trace));
});

test('reset clears every candidate and permits a deterministic fresh trace', () => {
  const shadow = adapter();
  const first = shadow.observe(snapshot(1));
  shadow.reset();
  assert.deepEqual(shadow.getShadowState(), { movement: null, clock: null, cpuMemories: {}, ball: null });
  const second = shadow.observe(snapshot(1));
  assert.equal(Orchestrator.stableJson(first), Orchestrator.stableJson(second));
});
