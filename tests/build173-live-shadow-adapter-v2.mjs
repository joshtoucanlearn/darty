import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BUILD173_PITCH, build173Observation } from './fixtures/build173-live-shadow-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'match-engine');
const modulePath = path.join(engineDir, 'build173-live-shadow-adapter-v2.js');
const matchPath = path.join(engineDir, 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Adapter = require(modulePath);
const Orchestrator = require(path.join(engineDir, 'overhaul-shadow-orchestrator-v2.js'));

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
  return Adapter.createCapability({ workflow, acknowledgement: Adapter.ACKNOWLEDGEMENT });
}

function enabledAdapter(overrides = {}) {
  const workflow = overrides.workflow || Orchestrator.WORKFLOWS.QUICK_PLAY;
  return Adapter.createAdapter({
    enabled: true,
    workflow,
    capability: capability(workflow),
    fixedTickSeconds: 1 / 60,
    seed: 173,
    sessionId: 'build173-live-adapter-test',
    ...overrides
  });
}

function recursiveKeys(value, result = []) {
  if (Array.isArray(value)) value.forEach(row => recursiveKeys(row, result));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, row]) => {
    result.push(key);
    recursiveKeys(row, result);
  });
  return result;
}

test('API is pinned to the current unified V2 schema and a 16-record telemetry ceiling', () => {
  assert.equal(Adapter.VERSION, '2.0.0-build173-live-read-only-shadow');
  assert.equal(Adapter.BUILD, 173);
  assert.equal(Adapter.HOST_AUTHORITY, Orchestrator.LIVE_AUTHORITY);
  assert.equal(Adapter.HOST_SCHEMA, 'football-legacy-build173-host-observation-v2');
  assert.equal(Adapter.HOST_CONTRACT_SCHEMA, 'football-legacy-build173-host-contract-v2');
  assert.equal(Adapter.MAX_TRACE_RECORDS, 16);
  assert.equal(Adapter.MAX_OBSERVATION_BYTES, 512 * 1024);
  assert.equal(Adapter.MAX_TELEMETRY_RECORD_BYTES, 64 * 1024);
  assert.equal(Adapter.MAX_TELEMETRY_EXPORT_BYTES, 512 * 1024);
  assert.equal(Orchestrator.VERSION, '2.0.0-dormant-unified-shadow');
  for (const name of ['createCapability', 'resolveStatus', 'validateObservation',
    'createAdapter', 'stableJson']) {
    assert.equal(typeof Adapter[name], 'function', `${name} must be exported`);
  }
  for (const forbidden of ['assertObservation', 'toUnifiedSnapshot', 'project', 'apply']) {
    assert.equal(Object.prototype.hasOwnProperty.call(Adapter, forbidden), false, forbidden);
  }
});

test('plain browser scripts expose the adapter only after the pinned V2 dependency stack', () => {
  const browserWindow = {};
  const context = { window: browserWindow };
  for (const filename of [
    'ball-engine-v2.js', 'ball-shadow-bridge-v2.js', 'cpu-intelligence-v2.js',
    'movement-engine-v2.js', 'formation-behaviour-v2.js', 'match-clock-v2.js',
    'overhaul-shadow-orchestrator-v2.js', 'build173-live-shadow-adapter-v2.js'
  ]) vm.runInNewContext(fs.readFileSync(path.join(engineDir, filename), 'utf8'), context);
  assert.equal(browserWindow.FootballLegacyBuild173LiveShadowAdapterV2.VERSION, Adapter.VERSION);
  assert.equal(typeof browserWindow.FootballLegacyBuild173LiveShadowAdapterV2.createAdapter, 'function');
});

test('EXACT-FLAG GATE: the live shadow adapter has no unconditional load or direct match-page API call', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']build173-live-shadow-adapter-v2\.js/i);
  assert.equal((matchHtml.match(/build173-live-shadow-adapter-v2\.js/g)||[]).length,0);
  assert.doesNotMatch(matchHtml, /FootballLegacyBuild173LiveShadowAdapterV2/);
  assert.match(source, /Build 173 remains the sole authority/i);
});

test('DETERMINISM GATE: adapter has no random, wall-clock, timer, RAF or browser-event source', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /new\s+Date\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /addEventListener\s*\(/);
});

test('DEFAULT-OFF GATE: malformed host data is never evaluated without explicit capability', () => {
  const adapter = Adapter.createAdapter();
  assert.equal(adapter.status.enabled, false);
  assert.equal(adapter.status.reason, 'disabled-by-default');
  const result = adapter.observe({ tick: 999, online: true, malformed: true });
  assert.equal(result.enabled, false);
  assert.equal(result.authority, 'build-173-legacy');
  assert.equal(result.readOnly, true);
  assert.equal(result.candidateExposed, false);
  assert.equal(result.appliedToLive, false);
  assert.equal(adapter.exportTelemetry().recordCount, 1);
});

test('capability requires exact acknowledgement, exact offline workflow and remains read-only', () => {
  assert.throws(() => Adapter.createCapability({ workflow: 'quick-play', acknowledgement: 'yes' }),
    /exact no-live-writes acknowledgement/);
  assert.throws(() => Adapter.createCapability({ workflow: 'online', acknowledgement: Adapter.ACKNOWLEDGEMENT }),
    /offline workflow/);
  const cap = capability();
  assert.equal(cap.readOnly, true);
  assert.equal(cap.authority, 'build-173-legacy');
  const wrongScope = { ...cap, workflow: 'single-player' };
  assert.equal(Adapter.resolveStatus({ enabled: true, workflow: 'quick-play', capability: wrongScope }).enabled, false);
});

test('ONLINE FROZEN GATE: neither attachment options nor a host observation can enter online mode', () => {
  const forged = { ...capability(), workflow: 'online' };
  const online = Adapter.createAdapter({ enabled: true, online: true, workflow: 'online', capability: forged });
  assert.equal(online.status.enabled, false);
  assert.equal(online.status.reason, 'online-frozen');
  const adapter = enabledAdapter();
  const observation = build173Observation(1, value => { value.online = true; });
  assert.throws(() => adapter.observe(observation), /online observations are frozen and rejected/);
  assert.equal(adapter.exportTelemetry().recordCount, 0);
});

test('fixture mirrors Build 173 3344 x 2142 world, 105 x 68 pitch, 22 players and legacy ball units', () => {
  const observation = build173Observation();
  assert.equal(BUILD173_PITCH.xMin, 84);
  assert.equal(BUILD173_PITCH.xMax, 3344 - 84);
  assert.equal(BUILD173_PITCH.yMin, 0);
  assert.equal(BUILD173_PITCH.yMax, 2142);
  assert.equal(BUILD173_PITCH.xUnitsPerMetre, (3344 - 2 * 84) / 105);
  assert.equal(BUILD173_PITCH.yUnitsPerMetre, 2142 / 68);
  assert.equal(BUILD173_PITCH.zUnitsPerMetre, (2142 - 12) / 68);
  assert.equal(observation.before.players.length, 22);
  assert.equal(observation.after.players.length, 22);
  assert.equal(observation.after.ball.x, 1672);
  assert.equal(observation.after.ball.y, 1071);
  assert.equal(observation.contract.clock.acceleration, 22.5);
});

test('exact host identity, team, unit and clock mapping builds the complete unified input', () => {
  const observation = build173Observation();
  const validation = Adapter.validateObservation(observation, { workflow: 'quick-play' });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.hostMapping.hostTeamIds, ['you', 'opp']);
  assert.deepEqual(validation.hostMapping.candidateTeamIds, { you: 'home', opp: 'away' });
  assert.deepEqual(validation.hostMapping.hostPitch, { xMin: 84, xMax: 3260, yMin: 0, yMax: 2142 });
  assert.deepEqual(validation.hostMapping.candidatePitch, { xMin: 0, xMax: 105, yMin: 0, yMax: 68 });
  assert.equal(validation.hostMapping.sourceClockFrames, 0);
  assert.equal(validation.hostMapping.sourceGameplaySeconds, 0);
  const accepted = enabledAdapter().observe(observation);
  assert.equal(accepted.telemetry.mappingComplete, true);
  assert.equal(accepted.candidateExposed, false);
});

test('READ-ONLY AUTHORITY GATE: enabled observation returns telemetry, never candidate state or commands', () => {
  const adapter = enabledAdapter();
  const observation = deepFreeze(build173Observation());
  const before = Adapter.stableJson(observation);
  const result = adapter.observe(observation);
  assert.equal(Adapter.stableJson(observation), before, 'host capture must remain byte-semantically unchanged');
  assert.equal(result.enabled, true);
  assert.equal(result.authority, 'build-173-legacy');
  assert.equal(result.readOnly, true);
  assert.equal(result.candidateExposed, false);
  assert.equal(result.appliedToLive, false);
  assert.equal(result.telemetry.mappingComplete, true);
  assert.equal(result.telemetry.comparison.movement.observedPlayerCount, 22);
  assert.equal(result.telemetry.comparison.formation.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'candidate'), false);
  const keys = recursiveKeys(result);
  for (const forbidden of ['candidateProjection', 'candidateState', 'movementCommands', 'commands']) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} must not escape as live-adapter output`);
  }
  assert.deepEqual(Object.keys(adapter).sort(), [
    'exportTelemetry', 'fixedTickSeconds', 'observe', 'reset', 'sessionId',
    'stableTelemetryJson', 'status', 'traceLimit'
  ]);
});

test('telemetry binds the exact five current candidate component versions', () => {
  const output = enabledAdapter().observe(build173Observation());
  assert.deepEqual(output.telemetry.componentVersions, {
    ballBridge: '2.0.0-dormant-shadow-bridge',
    cpu: '2.0.0-dormant',
    movement: '2.0.0-dormant',
    formation: '2.0.0-dormant',
    clock: '2.0.0-dormant'
  });
});

test('TICK-1 PRE-MATCH EPOCH GATE fails closed and permits a clean retry', () => {
  const adapter = enabledAdapter();
  const wrongStage = build173Observation(1, value => { value.epoch.stage = 'match-shadow'; });
  assert.throws(() => adapter.observe(wrongStage), /tick 1 must attach at the explicit pre-match epoch/);
  assert.equal(adapter.exportTelemetry().recordCount, 0);
  assert.equal(adapter.observe(build173Observation(1)).tick, 1);
});

test('identity is one-to-one and frame rosters/team ownership must exactly match it', () => {
  const duplicateCandidate = build173Observation(1, value => {
    value.identity.teams[0].players[1].candidateId = value.identity.teams[0].players[0].candidateId;
  });
  assert.match(Adapter.validateObservation(duplicateCandidate).errors.join(' '), /candidate player ids must be unique/);
  const missingPlayer = build173Observation(1, value => { value.after.players.pop(); });
  assert.match(Adapter.validateObservation(missingPlayer).errors.join(' '), /player ids must exactly match/);
  const wrongTeam = build173Observation(1, value => { value.after.players[0].teamId = 'opp'; });
  assert.match(Adapter.validateObservation(wrongTeam).errors.join(' '), /team ownership conflicts/);
});

test('unit and clock contracts reject approximation, inference and presentation-time substitution', () => {
  const badUnit = build173Observation(1, value => { value.contract.pitch.xUnitsPerMetre = 31; });
  assert.match(Adapter.validateObservation(badUnit).errors.join(' '), /exactly span 105 metres/);
  const badRate = build173Observation(1, value => { value.contract.pitch.framesPerSecond = 30; });
  assert.match(Adapter.validateObservation(badRate).errors.join(' '), /reciprocal of fixedTickSeconds/);
  const wallClock = build173Observation(1, value => { value.contract.clock.source = 'presentation-time'; });
  assert.match(Adapter.validateObservation(wallClock).errors.join(' '), /simulation-time-only/);
  const phaseConflict = build173Observation(1, value => { value.after.clock.ballLive = true; });
  assert.match(Adapter.validateObservation(phaseConflict).errors.join(' '), /ballLive conflicts/);
  const wrongAcceleration = build173Observation(1, value => { value.contract.clock.acceleration = 15; });
  assert.match(Adapter.validateObservation(wrongAcceleration).errors.join(' '), /90 \/ matchLengthMinutes/);
});

test('DYNAMIC MATCH-LENGTH GATE accepts the exact 90/minutes acceleration across Build 173 limits', () => {
  for (const matchLengthMinutes of [2, 4, 6, 12, 20]) {
    const observation = build173Observation(1, value => {
      value.contract.clock.matchLengthMinutes = matchLengthMinutes;
      value.contract.clock.acceleration = 90 / matchLengthMinutes;
    });
    assert.equal(Adapter.validateObservation(observation).valid, true, `match length ${matchLengthMinutes}`);
  }
});

test('SIMULATION-TIME GATE advances gameplaySeconds only when the governing before phase is PLAY', () => {
  const live = build173Observation(1, value => {
    for (const frame of [value.before, value.after]) {
      frame.clock.phase = 'PLAY';
      frame.clock.ballLive = true;
      frame.clock.reason = 'live-play';
    }
    value.after.clock.gameplaySeconds = (1 / 60) * 22.5;
  });
  assert.equal(Adapter.validateObservation(live).valid, true);
  const deadCreep = build173Observation(1, value => { value.after.clock.gameplaySeconds = 0.01; });
  assert.match(Adapter.validateObservation(deadCreep).errors.join(' '), /phase governing the legacy tick/);
});

test('HELD THROW-IN APRON GATE preserves only the declared taker outside the touchline', () => {
  const held = build173Observation(1, value => {
    value.restart = { kind: 'THROW IN', held: true, takerId: 'you-LM' };
    value.before.players.find(player => player.id === 'you-LM').y = -26;
    value.after.players.find(player => player.id === 'you-LM').y = -26;
  });
  assert.equal(Adapter.validateObservation(held).valid, true);
  const undeclared = build173Observation(1, value => {
    value.before.players.find(player => player.id === 'you-LM').y = -1;
    value.after.players.find(player => player.id === 'you-LM').y = -1;
  });
  assert.match(Adapter.validateObservation(undeclared).errors.join(' '), /held-throw-in staging apron/);
  const secondOutside = build173Observation(1, value => {
    value.restart = { kind: 'THROW IN', held: true, takerId: 'you-LM' };
    for (const frame of [value.before, value.after]) {
      frame.players.find(player => player.id === 'you-LM').y = -26;
      frame.players.find(player => player.id === 'you-RM').y = -1;
    }
  });
  assert.match(Adapter.validateObservation(secondOutside).errors.join(' '), /outside the pitch/);
});

test('BOUNDED INPUT GATE rejects unsafe map keys, cycles, non-plain values and oversized strings', () => {
  const unsafe = build173Observation(1, value => { value.identity.teams[0].id = '__proto__'; });
  assert.match(Adapter.validateObservation(unsafe).errors.join(' '), /reserved and unsafe/);
  const cyclic = build173Observation();
  cyclic.environment.loop = cyclic.environment;
  assert.match(Adapter.validateObservation(cyclic).errors.join(' '), /acyclic/);
  const nonPlain = build173Observation();
  nonPlain.environment.created = new Date(0);
  assert.match(Adapter.validateObservation(nonPlain).errors.join(' '), /plain objects/);
  const oversized = build173Observation(1, value => { value.environment.payload = 'x'.repeat(600000); });
  assert.match(Adapter.validateObservation(oversized).errors.join(' '), /overlong string|byte limit/);
});

test('LIVE FORCE-CONTROL GATE: dip/curve remain raw read-only telemetry and never masquerade as candidate state', () => {
  const observation = build173Observation(1, value => {
    value.before.ball.spin = value.after.ball.spin = 0.5;
    value.before.ball.dip = 0.21;
    value.after.ball.dip = 0.34;
    value.before.ball.curveAccel = 0.07;
    value.after.ball.curveAccel = 0.09;
    value.after.ball.x += 2.25;
    value.after.ball.y -= 1.5;
    value.after.ball.z = 4.75;
    value.after.ball.vx = 2.25;
    value.after.ball.vy = -1.5;
    value.after.ball.zv = 4.75;
    value.after.ball.ownerId = null;
    value.after.ball.flightType = 'direct-free-kick-curve';
  });
  const validation = Adapter.validateObservation(observation, { workflow: 'quick-play' });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.hostMapping.ballForceControlPolicy.rawBefore, { dip: 0.21, curveAccel: 0.07 });
  assert.deepEqual(validation.hostMapping.ballForceControlPolicy.rawAfter, { dip: 0.34, curveAccel: 0.09 });
  assert.equal(validation.hostMapping.ballForceControlPolicy.legacyForceControlsExcludedFromCandidateState, true);
  assert.equal(validation.hostMapping.ballForceControlPolicy.legacyAfterIncludesLegacyForceControlEffects, true);
  const result = enabledAdapter().observe(observation);
  assert.equal(result.telemetry.ballForceControlPolicy.rawAfter.dip, 0.34);
  assert.equal(result.telemetry.ballForceControlPolicy.rawAfter.curveAccel, 0.09);
  assert.equal(result.telemetry.appliedToLive, false);
  assert.equal(result.candidateExposed, false);
});

test('FRACTIONAL CLOCK GATE: dead-ball clockFrames are observational while gameplaySeconds stays authoritative', () => {
  const observation = build173Observation(1, value => {
    value.before.clock.clockFrames = 12.25;
    value.after.clock.clockFrames = 12.25 + 1 / 45;
  });
  const validation = Adapter.validateObservation(observation, { workflow: 'quick-play' });
  assert.equal(validation.valid, true);
  assert.equal(validation.hostMapping.sourceClockFramesBefore, 12.25);
  assert.equal(validation.hostMapping.sourceClockFrames, 12.25 + 1 / 45);
  assert.equal(validation.hostMapping.sourceGameplaySeconds, 0);
  assert.equal(enabledAdapter().observe(observation).telemetry.hostMapping.sourceClockFrames, 12.25 + 1 / 45);
});

test('COORDINATE EDGE GATE: exact anisotropic host edges map to 0..105 by 0..68', () => {
  const observation = build173Observation(1, value => {
    for (const frame of [value.before, value.after]) {
      Object.assign(frame.players[0], { x: 84, y: 0, homeX: 84, homeY: 0 });
      Object.assign(frame.players[1], { x: 3260, y: 2142, homeX: 3260, homeY: 2142 });
      Object.assign(frame.ball, { x: 84, y: 0 });
    }
  });
  const validation = Adapter.validateObservation(observation, { workflow: 'quick-play' });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.hostMapping.hostPitch, { xMin: 84, xMax: 3260, yMin: 0, yMax: 2142 });
  assert.deepEqual(validation.hostMapping.candidatePitch, { xMin: 0, xMax: 105, yMin: 0, yMax: 68 });
  const result = enabledAdapter().observe(observation);
  assert.equal(result.enabled, true);
  assert.equal(result.telemetry.mappingComplete, true);
});

test('accepted observations preserve exact epoch/mapping and consecutive before-after boundaries', () => {
  const adapter = enabledAdapter();
  assert.equal(adapter.observe(build173Observation(1)).tick, 1);
  assert.equal(adapter.observe(build173Observation(2)).tick, 2);
  const changedEpoch = build173Observation(3, value => { value.epoch.id = 'different-match'; });
  assert.throws(() => adapter.observe(changedEpoch), /match epoch cannot change/);
  const changedMapping = build173Observation(3, value => { value.identity.teams[0].candidateId = 'new-home'; });
  assert.throws(() => adapter.observe(changedMapping), /identity\/unit\/clock mapping cannot change/);
  const brokenBoundary = build173Observation(3, value => { value.before.players[0].x += 1; });
  assert.throws(() => adapter.observe(brokenBoundary), /movement boundary continuity failed/);
});

test('two fresh adapters produce byte-identical deterministic comparison telemetry', () => {
  const first = enabledAdapter({ sessionId: 'deterministic-live-shadow' });
  const second = enabledAdapter({ sessionId: 'deterministic-live-shadow' });
  for (let tick = 1; tick <= 4; tick += 1) {
    assert.equal(Adapter.stableJson(first.observe(build173Observation(tick))),
      Adapter.stableJson(second.observe(build173Observation(tick))));
  }
  assert.equal(first.stableTelemetryJson(), second.stableTelemetryJson());
});

test('BOUNDED TELEMETRY GATE: traceLimit is hard-capped at 16 records', () => {
  const adapter = enabledAdapter({ traceLimit: 9999, sessionId: 'bounded-live-shadow' });
  assert.equal(adapter.traceLimit, 16);
  for (let tick = 1; tick <= 24; tick += 1) adapter.observe(build173Observation(tick));
  const telemetry = adapter.exportTelemetry();
  assert.equal(telemetry.traceLimit, 16);
  assert.equal(telemetry.recordCount, 16);
  assert.deepEqual(telemetry.records.map(row => row.sequence),
    Array.from({ length: 16 }, (_, index) => index + 8));
  assert.equal(telemetry.candidateExposed, false);
  assert.equal(telemetry.appliedToLive, false);
  assert.ok(JSON.stringify(telemetry).length * 4 <= Adapter.MAX_TELEMETRY_EXPORT_BYTES);
});

test('output/telemetry are detached clones and cannot mutate adapter or host state', () => {
  const adapter = enabledAdapter();
  const observation = build173Observation();
  const output = adapter.observe(observation);
  output.telemetry.hostMapping.hostTeamIds[0] = 'tampered';
  output.trace.telemetry.comparison.clock.phaseAgreement = false;
  observation.identity.teams[0].players[0].candidateId = 'tampered';
  const exported = adapter.exportTelemetry();
  assert.deepEqual(exported.records[0].telemetry.hostMapping.hostTeamIds, ['you', 'opp']);
  assert.equal(exported.records[0].telemetry.comparison.clock.phaseAgreement, true);
});
