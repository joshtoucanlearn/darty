import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  BUILD173_WORLD,
  BUILD173_PITCH,
  BUILD173_MARKINGS,
  BUILD173_THROW_IN_APRON,
  OFFLINE_WORKFLOWS,
  clone,
  stablePlayerId,
  actualPlayerId,
  teams,
  controlOwnership,
  captureOptions,
  snapshot,
  walkoutSnapshot,
  walkinSnapshot,
  teamStates,
  captureTickInput,
  observationInput
} from './fixtures/build173-shadow-host-capture-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'match-engine');
const modulePath = path.join(engineDir, 'build173-shadow-host-capture-v2.js');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(path.join(engineDir, 'match.html'), 'utf8');
const require = createRequire(import.meta.url);
const Capture = require(modulePath);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function recursiveKeys(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => recursiveKeys(item, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    output.push(key);
    recursiveKeys(item, output);
  });
  return output;
}

function armedSession(workflow = 'quick-play', epochId = `epoch-${workflow}-001`) {
  const session = Capture.createCaptureSession(captureOptions(workflow));
  const kickoff = snapshot({ kickoffOptional: true });
  const arm = session.arm(kickoff, { epochId });
  assert.equal(arm.lifecycle, 'armed', arm.reason);
  assert.equal(arm.trace.type, 'capture-armed');
  return { session, kickoff };
}

function assertAccepted(result, tick) {
  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.trace.type, 'capture-accepted');
  assert.equal(result.tick, tick);
  assert.equal(result.lifecycle, 'armed');
}

test('API and exact six-workflow scope are pinned to the Build 173 plain-host capture', () => {
  assert.equal(Capture.VERSION, '2.0.0-build173-plain-host-capture');
  assert.equal(Capture.BUILD, 173);
  assert.equal(Capture.HOST_AUTHORITY, 'build-173-legacy');
  assert.equal(Capture.HOST_SCHEMA, 'football-legacy-build173-host-observation-v2');
  assert.equal(Capture.HOST_CONTRACT_SCHEMA, 'football-legacy-build173-host-contract-v2');
  assert.equal(Capture.FIXED_TICK_SECONDS, 1 / 60);
  assert.deepEqual([...Capture.OFFLINE_WORKFLOWS], [...OFFLINE_WORKFLOWS]);
  assert.deepEqual(Object.values(Capture.WORKFLOWS).sort(), [...OFFLINE_WORKFLOWS, 'online'].sort());
  for (const name of ['resolveStatus', 'createPitchContract', 'createIdentity', 'prepareObservation',
    'createCaptureSession', 'phaseFromHostClock', 'presentationBoundary', 'stableJson', 'digest']) {
    assert.equal(typeof Capture[name], 'function', `${name} must be exported`);
  }
});

test('EXACT-FLAG/READ-ONLY GATE: host capture has no unconditional load, direct API call or application surface', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']build173-shadow-host-capture-v2\.js/i);
  assert.equal((matchHtml.match(/build173-shadow-host-capture-v2\.js/g)||[]).length,0);
  assert.doesNotMatch(matchHtml, /FootballLegacyBuild173ShadowHostCaptureV2/);
  assert.match(source, /never calls the match[\s*]+update loop/i);
  assert.doesNotMatch(source, /function\s+(?:apply|project|commit|mutate)(?:ToLive|Candidate)?\s*\(/i);
});

test('exact Build 173 world, markings, throw-in apron and metric conversion are explicit', () => {
  const contract = Capture.createPitchContract(4);
  assert.deepEqual(contract.world, BUILD173_WORLD);
  assert.deepEqual(contract.pitch, BUILD173_PITCH);
  assert.deepEqual(contract.coordinateEvidence.markedPitch,
    { ...BUILD173_MARKINGS, evidence: 'match.html strokeRect(M,6,W-2*M,H-12)' });
  assert.deepEqual(contract.staging.throwInApron, BUILD173_THROW_IN_APRON);
  assert.equal(contract.pitch.xUnitsPerMetre, 3176 / 105);
  assert.equal(contract.pitch.yUnitsPerMetre, 2142 / 68);
  assert.equal(contract.pitch.zUnitsPerMetre, 2130 / 68);
  assert.equal(contract.clock.matchLengthMinutes, 4);
  assert.equal(contract.clock.acceleration, 22.5);
  assert.equal(contract.clock.source, 'simulation-time-only');
  assert.equal(Object.isFrozen(contract), true);
});

test('all six offline workflows retain their exact human/CPU ownership without using connectivity', () => {
  const expected = {
    'set-piece-suite': { humanCounts: [1, 0], cpu: ['opp'] },
    'single-player': { humanCounts: [1, 0], cpu: ['opp'] },
    'quick-play': { humanCounts: [1, 0], cpu: ['opp'] },
    'local-two-player': { humanCounts: [1, 1], cpu: [] },
    'home-coop': { humanCounts: [2, 0], cpu: ['opp'] },
    'cpu-v-cpu': { humanCounts: [0, 0], cpu: ['opp', 'you'] }
  };
  for (const workflow of OFFLINE_WORKFLOWS) {
    const base = captureOptions(workflow);
    const identity = Capture.createIdentity(base);
    assert.equal(identity.teams.length, 2, workflow);
    assert.equal(identity.teams.flatMap(team => team.players).length, 22, workflow);
    assert.equal(identity.teams.every(team => team.players.filter(player => player.position === 'GK').length === 1), true);
    const participantCounts = identity.teams.map(team =>
      identity.controlOwnership.participants.filter(participant => participant.teamId === team.id).length);
    assert.deepEqual(participantCounts, expected[workflow].humanCounts, workflow);
    assert.deepEqual([...identity.controlOwnership.cpuTeamIds].sort(), expected[workflow].cpu, workflow);
    const disconnected = Capture.createIdentity({
      ...base,
      controllerConnectivity: { 'controller-one': false, 'controller-two': false }
    });
    assert.equal(Capture.stableJson(disconnected), Capture.stableJson(identity), workflow);
    const session = Capture.createCaptureSession(base);
    assert.equal(session.status.enabled, true, workflow);
    const before = snapshot({ kickoffOptional: true });
    const after = snapshot({ kickoffOptional: true, clockFrames: 0.125 });
    assert.equal(session.arm(before, { epochId: `workflow-${workflow}-epoch` }).lifecycle, 'armed', workflow);
    assertAccepted(session.captureTick(captureTickInput(before, after, { sequence: 1 })), 1);
  }

  const suite = Capture.createCaptureSession(captureOptions('set-piece-suite'));
  const practiceReady = snapshot({ phase: 'DEAD_BALL' });
  practiceReady.freeKickPracticeReady = true;
  const armed = suite.arm(practiceReady, { epochId: 'set-piece-suite-ready-epoch' });
  assert.equal(armed.lifecycle, 'armed');
  assert.equal(armed.anchor, 'set-piece-suite-ready');
});

test('DEFAULT-OFF and ONLINE-FROZEN gates never inspect malformed match data', () => {
  const disabled = Capture.createCaptureSession();
  assert.equal(disabled.status.enabled, false);
  assert.equal(disabled.status.reason, 'disabled-by-default');
  assert.equal(disabled.arm({ malformed: true }).trace.type, 'arm-skipped');

  const base = {
    enabled: true,
    acknowledgement: Capture.ACKNOWLEDGEMENT,
    workflow: 'quick-play'
  };
  const markerCases = [
    { onlineMarkers: { onlineRole: 'guest' } },
    { onlineMarkers: { onlineRoom: 'ROOM' } },
    { onlineMarkers: { onlineBuild: '173' } },
    { onlineMarkers: { mode: 'online' } },
    { onlineMarkers: { matchType: 'online-versus' } },
    { onlineMarkers: { configOnline: true } },
    { onlineMarkers: { controllersOnline: true } },
    { onlineMarkers: { urlMarkers: ['join=ROOM'] } },
    { online: true },
    { workflow: 'online' }
  ];
  for (const markers of markerCases) {
    const status = Capture.resolveStatus({ ...base, ...markers });
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'online-frozen');
    assert.ok(status.onlineMarkerReasons.length >= 1);
  }
});

test('walkout tunnel state is skipped and capture arms only on the real on-pitch kickoff transition', () => {
  const session = Capture.createCaptureSession(captureOptions('quick-play'));
  const skipped = session.arm(walkoutSnapshot(), { epochId: 'walkout-epoch' });
  assert.equal(skipped.trace.type, 'presentation-prelude-skipped');
  assert.equal(skipped.lifecycle, 'awaiting-kickoff');
  const kickoff = snapshot({ kickoffOptional: true });
  const armed = session.arm(kickoff, { epochId: 'post-walkout-epoch' });
  assert.equal(armed.trace.type, 'capture-armed');
  assert.equal(armed.lifecycle, 'armed');
  assert.equal(armed.anchor, 'post-walkout-kickoff');
  assert.deepEqual(armed.kickoffDefaults,
    ['curveAccel', 'dip', 'flightType', 'spin', 'z', 'zv']);
});

test('optional kickoff-only ball fields receive explicit deterministic zero/ground defaults', () => {
  const before = snapshot({ kickoffOptional: true });
  const after = snapshot({ kickoffOptional: true, clockFrames: 0.25 });
  delete before.ball.id;
  delete after.ball.id;
  const observation = Capture.prepareObservation(observationInput({ before, after }));
  for (const frame of [observation.before, observation.after]) {
    assert.equal(frame.ball.id, 'match-ball');
    assert.equal(frame.ball.z, 0);
    assert.equal(frame.ball.zv, 0);
    assert.equal(frame.ball.spin, 0);
    assert.equal(frame.ball.dip, 0);
    assert.equal(frame.ball.curveAccel, 0);
    assert.equal(frame.ball.flightType, 'ground');
  }
  assert.deepEqual(observation.environment.hostCapture.kickoffDefaults.before,
    ['curveAccel', 'dip', 'flightType', 'spin', 'z', 'zv']);
  assert.equal(observation.contract.clock.matchLengthMinutes, 4);
  assert.equal(observation.identity.teams.flatMap(team => team.players).length, 22);
  assert.equal(observation.epoch.stage, 'pre-match');
  assert.equal(Capture.prepareObservation(observationInput({ tick: 2 })).epoch.stage, 'match-shadow');
  assert.equal(Object.isFrozen(observation), true);
});

test('simulation gameplay seconds are monotonic and independent of fractional/reset legacy clockFrames', () => {
  const { session, kickoff } = armedSession();
  const held = snapshot({ kickoffOptional: true, clockFrames: 0.25 });
  const tick1 = session.captureTick(captureTickInput(kickoff, held, { sequence: 1 }));
  assertAccepted(tick1, 1);
  assert.equal(tick1.clockFrames, 0.25);
  assert.equal(tick1.gameplaySeconds, 0);

  const live = snapshot({ phase: 'PLAY', clockFrames: 101.75 });
  const tick2 = session.captureTick(captureTickInput(held, live, { sequence: 2 }));
  assertAccepted(tick2, 2);
  assert.equal(tick2.clockFrames, 101.75);
  assert.equal(tick2.gameplaySeconds, 0);

  const dead = snapshot({ phase: 'DEAD_BALL', clockFrames: 0.125 });
  const tick3 = session.captureTick(captureTickInput(live, dead, { sequence: 3 }));
  assertAccepted(tick3, 3);
  assert.equal(tick3.clockFrames, 0.125);
  assert.equal(tick3.gameplaySeconds, 0.375);
  assert.equal(session.exportTelemetry().cumulativeGameplaySeconds, 0.375);
});

test('phase mapping follows live, dead-ball, set-piece and paused host evidence exactly', () => {
  assert.equal(Capture.phaseFromHostClock(snapshot({ phase: 'PLAY' }).clock), 'PLAY');
  assert.equal(Capture.phaseFromHostClock(snapshot({ phase: 'DEAD_BALL' }).clock), 'DEAD_BALL');
  assert.equal(Capture.phaseFromHostClock(snapshot({ phase: 'SET_PIECE' }).clock), 'SET_PIECE');
  assert.equal(Capture.phaseFromHostClock(snapshot({ phase: 'PAUSED' }).clock), 'PAUSED');
});

test('legacy ball dip/curve and actual-player movement/CPU references map without altering values', () => {
  const homeRunner = actualPlayerId('you', 'LST');
  const awayMarker = actualPlayerId('opp', 'RCB');
  const before = snapshot({
    phase: 'PLAY',
    clockFrames: 12.5,
    ownerId: homeRunner,
    ball: { vx: 13.25, vy: -7.5, z: 18, zv: 2.2, spin: 0.85, dip: 1.75, curveAccel: -0.035, flightType: 'driven' }
  });
  const after = snapshot({
    phase: 'PLAY',
    clockFrames: 13.125,
    ownerId: homeRunner,
    ball: { vx: 13.1, vy: -7.55, z: 19.2, zv: 1.95, spin: 0.82, dip: 1.75, curveAccel: -0.035, flightType: 'driven' }
  });
  const states = teamStates({
    events: { opp: [{ type: 'recovery-run', teamId: 'opp', playerId: awayMarker, runType: 'cover' }] }
  });
  const observation = Capture.prepareObservation(observationInput({
    before,
    after,
    gameplaySecondsBefore: 5,
    movementCommands: [{ type: 'run', playerId: homeRunner, targetId: awayMarker }],
    teamStates: states
  }));
  assert.equal(observation.after.ball.ownerId, stablePlayerId('you', 'LST'));
  assert.equal(observation.after.ball.dip, 1.75);
  assert.equal(observation.after.ball.curveAccel, -0.035);
  assert.equal(observation.after.ball.spin, 0.82);
  assert.equal(observation.movementCommands[0].playerId, stablePlayerId('you', 'LST'));
  assert.equal(observation.movementCommands[0].targetId, stablePlayerId('opp', 'RCB'));
  assert.equal(observation.cpu[0].events[0].playerId, stablePlayerId('opp', 'RCB'));
  assert.equal(observation.after.clock.gameplaySeconds, 5.375);
});

test('held throw-in taker is preserved at both exact apron edges and never clamped', () => {
  for (const y of [-26, 2168]) {
    const raw = snapshot({ throwIn: { teamId: 'you', slotId: 'RB', y } });
    const rawBytes = JSON.stringify(raw);
    const observation = Capture.prepareObservation(observationInput({ before: raw, after: raw }));
    const stableId = stablePlayerId('you', 'RB');
    assert.equal(observation.after.players.find(player => player.id === stableId).y, y);
    assert.deepEqual(observation.environment.hostCapture.stagingPlayers.after, [{
      id: stableId,
      x: 1672,
      y,
      exception: 'declared-held-throw-in-taker-only'
    }]);
    assert.equal(JSON.stringify(raw), rawBytes, 'capture must not clamp or mutate the raw host snapshot');
  }
  const invalid = snapshot({ throwIn: { teamId: 'you', slotId: 'RB', y: -27 } });
  assert.throws(() => Capture.prepareObservation(observationInput({ before: invalid, after: invalid })),
    /outside the pitch without the held throw-in taker exception/);
});

test('adapter handoff accepts the exact held throw-in apron during an armed session', () => {
  const { session, kickoff } = armedSession('quick-play', 'throw-in-epoch');
  const heldKickoff = snapshot({ kickoffOptional: true, clockFrames: 0.25 });
  assertAccepted(session.captureTick(captureTickInput(kickoff, heldKickoff, { sequence: 1 })), 1);
  const staged = snapshot({ clockFrames: 0.5, throwIn: { teamId: 'you', slotId: 'RB', y: -26 } });
  const result = session.captureTick(captureTickInput(heldKickoff, staged, { sequence: 2 }));
  assertAccepted(result, 2);
  assert.equal(result.stagingPlayerCount, 1);
});

test('sent-off slots remain in the exact 22-player roster and appear in formation availability', () => {
  const redCardSlot = stablePlayerId('you', 'RCB');
  const before = snapshot();
  const after = snapshot({ sentOffStableIds: [redCardSlot] });
  const observation = Capture.prepareObservation(observationInput({ before, after }));
  assert.equal(observation.after.players.length, 22);
  assert.equal(observation.after.players.find(player => player.id === redCardSlot).sentOff, true);
  assert.deepEqual(observation.identity.teams.map(team => team.players.length), [11, 11]);
  const homeFormation = observation.formation.find(entry => entry.teamId === 'you');
  assert.equal(homeFormation.playerCount, 10);
  assert.deepEqual(homeFormation.unavailableSlotIds, ['RCB']);
  assert.deepEqual(observation.environment.hostCapture.formationAvailability.find(entry => entry.teamId === 'you'), {
    teamId: 'you',
    playerCount: 10,
    unavailableSlotIds: ['RCB']
  });
});

test('substitutions preserve the stable on-pitch slot and expose old/new actual IDs only as telemetry', () => {
  const stableId = stablePlayerId('you', 'RST');
  const oldActualId = actualPlayerId('you', 'RST');
  const newActualId = 'ars-reyes';
  const before = snapshot({ kickoffOptional: true });
  const after = snapshot({ actualPlayerIds: { [stableId]: newActualId } });
  const pure = Capture.prepareObservation(observationInput({ before, after }));
  assert.equal(pure.after.players.find(player => player.id === stableId).id, stableId);
  assert.equal(pure.environment.hostCapture.actualPlayerIds.before[stableId], oldActualId);
  assert.equal(pure.environment.hostCapture.actualPlayerIds.after[stableId], newActualId);

  const session = Capture.createCaptureSession(captureOptions('quick-play'));
  assert.equal(session.arm(before, { epochId: 'substitution-epoch' }).lifecycle, 'armed');
  const substitution = {
    teamId: 'you',
    slotId: 'RST',
    outPlayerId: oldActualId,
    inPlayerId: newActualId
  };
  assertAccepted(session.captureTick(captureTickInput(before, after, {
    sequence: 1,
    substitutions: [substitution]
  })), 1);

  const missingRecord = Capture.createCaptureSession(captureOptions('quick-play'));
  assert.equal(missingRecord.arm(before, { epochId: 'missing-substitution-epoch' }).lifecycle, 'armed');
  const frozen = missingRecord.captureTick(captureTickInput(before, after, { sequence: 1 }));
  assert.equal(frozen.accepted, false);
  assert.equal(frozen.lifecycle, 'self-frozen');
  assert.equal(frozen.trace.type, 'capture-self-frozen');
  assert.match(frozen.reason, /substitution changed stable slots/);
});

test('FAST mode records every simulation update even when three ticks share one render frame', () => {
  const { session, kickoff } = armedSession('quick-play', 'fast-epoch');
  let before = kickoff;
  for (let index = 0; index < 3; index += 1) {
    const after = snapshot({ kickoffOptional: true, clockFrames: (index + 1) / 8 });
    const result = session.captureTick(captureTickInput(before, after, {
      sequence: index + 1,
      renderFrameSequence: 44,
      simulationStepIndex: index,
      simulationStepsPerRender: 3
    }));
    assertAccepted(result, index + 1);
    before = after;
  }
  assert.equal(session.exportTelemetry().acceptedTicks, 3);
  assert.equal(session.exportTelemetry().nextTick, 4);
});

test('capture is immutable, exact-sequential and permanently self-freezes on a skipped update', () => {
  const { session, kickoff } = armedSession('quick-play', 'sequence-epoch');
  const after = snapshot({ kickoffOptional: true, clockFrames: 0.25 });
  const input = deepFreeze(captureTickInput(kickoff, after, { sequence: 1 }));
  const bytes = Capture.stableJson(input);
  assertAccepted(session.captureTick(input), 1);
  assert.equal(Capture.stableJson(input), bytes);

  const skipped = session.captureTick(captureTickInput(after, snapshot({ kickoffOptional: true, clockFrames: 0.5 }), {
    sequence: 3
  }));
  assert.equal(skipped.accepted, false);
  assert.equal(skipped.lifecycle, 'self-frozen');
  assert.match(skipped.reason, /exactly one sequential capture tick/);
  const later = session.captureTick({ malformed: true });
  assert.equal(later.trace.type, 'capture-skipped');
  assert.equal(later.reason, 'capture-not-armed');
  assert.equal(later.lifecycle, 'self-frozen');
});

test('capture finishes before full-time walk-in and walk-in staging fails closed if not finished', () => {
  const finishedState = armedSession('quick-play', 'finish-epoch');
  const finishedSession = finishedState.session;
  const finish = finishedSession.finish('full-time-before-walkin');
  assert.equal(finish.trace.type, 'capture-finished');
  assert.equal(finish.lifecycle, 'finished');
  const skipped = finishedSession.captureTick(captureTickInput(snapshot(), walkinSnapshot(), { sequence: 1 }));
  assert.equal(skipped.trace.type, 'capture-skipped');
  assert.equal(skipped.lifecycle, 'finished');

  const active = armedSession('quick-play', 'walkin-fail-closed-epoch');
  const frozen = active.session.captureTick(captureTickInput(active.kickoff, walkinSnapshot(), { sequence: 1 }));
  assert.equal(frozen.trace.type, 'capture-self-frozen');
  assert.equal(frozen.lifecycle, 'self-frozen');
  assert.match(frozen.reason, /finish capture before full-time walk-in/);

  const reset = finishedSession.reset();
  assert.equal(reset.reset, true);
  assert.equal(reset.lifecycle, 'awaiting-kickoff');
  const reused = finishedSession.arm(finishedState.kickoff, { epochId: 'finish-epoch' });
  assert.equal(reused.lifecycle, 'self-frozen');
  assert.match(reused.reason, /fresh match epoch id/);
  finishedSession.reset();
  const fresh = finishedSession.arm(finishedState.kickoff, { epochId: 'fresh-finish-epoch' });
  assert.equal(fresh.lifecycle, 'armed');
  assert.equal(fresh.nextTick, 1);
});

test('telemetry remains bounded and never exports candidate state, live commands or captured snapshots', () => {
  const { session, kickoff } = armedSession('quick-play', 'telemetry-epoch');
  const after = snapshot({ kickoffOptional: true, clockFrames: 0.25 });
  const result = session.captureTick(captureTickInput(kickoff, after, { sequence: 1 }));
  assertAccepted(result, 1);
  assert.equal(result.readOnly, true);
  assert.equal(result.liveWrites, false);
  assert.equal(result.adapterTelemetry.mappingComplete, true);
  const keys = recursiveKeys({ result, export: session.exportTelemetry() });
  for (const forbidden of ['candidateProjection', 'candidateState', 'movementCommands', 'commands', 'before', 'after']) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} must not escape telemetry`);
  }
  assert.ok(session.exportTelemetry().recordCount <= Capture.MAX_TRACE_RECORDS);
});

test('identical detached host input produces deterministic capture telemetry', () => {
  function run() {
    const { session, kickoff } = armedSession('quick-play', 'deterministic-epoch');
    const after = snapshot({ kickoffOptional: true, clockFrames: 0.125 });
    assertAccepted(session.captureTick(captureTickInput(kickoff, after, {
      sequence: 1,
      renderFrameSequence: 20,
      environment: { weather: 'night-clear', stadium: 'north-london' }
    })), 1);
    return session.stableTelemetryJson();
  }
  assert.equal(run(), run());
});
