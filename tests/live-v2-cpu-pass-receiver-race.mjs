import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Adapter = require('../match-engine/live-v2-authority-adapter.js');
const Ball = require('../match-engine/ball-engine-v2.js');
const Movement = require('../match-engine/movement-engine-v2.js');
const CPU = require('../match-engine/cpu-intelligence-v2.js');
const Formation = require('../match-engine/formation-behaviour-v2.js');
const Contact = require('../match-engine/live-v2-contact-authority-composer.js');
const Dribbling = require('../match-engine/dribbling-state-v2.js');
const ADAPTER_SOURCE = readFileSync(new URL('../match-engine/live-v2-authority-adapter.js', import.meta.url), 'utf8');
const MATCH_SOURCE = readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');

const PITCH = Object.freeze({ xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 });
const UNITS = Object.freeze({
  xPerMetre: (PITCH.xMax - PITCH.xMin) / 105,
  yPerMetre: (PITCH.yMax - PITCH.yMin) / 68,
  zPerMetre: 30
});
const OWNER_ID = 'you-CAM';
const RECEIVER_ID = 'you-RW';

function canonicalLineup(teamId) {
  return Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }));
}

function worldPoint(metric) {
  return {
    x: PITCH.xMin + metric.x * UNITS.xPerMetre,
    y: (PITCH.yMin + PITCH.yMax) / 2 + metric.y * UNITS.yPerMetre
  };
}

function forcedPassCpu(target) {
  return {
    ...CPU,
    decide(snapshot, previousMemory, options) {
      const decision = CPU.decide(snapshot, previousMemory, options);
      if (snapshot.teamId !== snapshot.possessionTeamId || snapshot.carrierId == null) return decision;
      return {
        ...decision,
        carrierIntent: {
          type: 'pass',
          targetPlayerId: RECEIVER_ID,
          target: { ...target },
          confidence: .91,
          reason: 'forced-pass-race-fixture'
        }
      };
    }
  };
}

function forcedProgressiveRiskCpu(target, confidence = .86) {
  const base = forcedPassCpu(target);
  return {
    ...base,
    decide(snapshot, previousMemory, options) {
      const decision = base.decide(snapshot, previousMemory, options);
      if (decision.carrierIntent?.type !== 'pass') return decision;
      return { ...decision, carrierIntent: { ...decision.carrierIntent, confidence,
        reason: 'forced-progressive-risk-fixture' } };
    }
  };
}

function forcedShortSupportCpu(target, supportMetrics = null) {
  const base = forcedPassCpu(target);
  return {
    ...base,
    decide(snapshot, previousMemory, options) {
      const decision = base.decide(snapshot, previousMemory, options);
      if (decision.carrierIntent?.type !== 'pass') return decision;
      return {
        ...decision,
        carrierIntent: {
          ...decision.carrierIntent,
          confidence: .76,
          reason: 'short-support-circulation',
          supportKind: 'support',
          risk: { probability: .1, interception: .1, pressure: 0 },
          supportMetrics: supportMetrics ||
            { distance: 242, progress: 120, laneClearance: 180, receiverSpace: 180 }
        }
      };
    }
  };
}

function forcedCarryCpu(target) {
  return {
    ...CPU,
    decide(snapshot, previousMemory, options) {
      const decision = CPU.decide(snapshot, previousMemory, options);
      if (snapshot.teamId !== snapshot.possessionTeamId || snapshot.carrierId == null) return decision;
      return {
        ...decision,
        carrierIntent: {
          type: 'carry',
          target: { ...target },
          confidence: .9,
          reason: 'forced-open-space-carry-fixture'
        }
      };
    }
  };
}

function sequencedCpu(firstTarget, nextIntent) {
  let controlledDecision = 0;
  return {
    ...CPU,
    decide(snapshot, previousMemory, options) {
      const decision = CPU.decide(snapshot, previousMemory, options);
      if (snapshot.teamId !== snapshot.possessionTeamId || snapshot.carrierId == null) return decision;
      controlledDecision += 1;
      return {
        ...decision,
        carrierIntent: controlledDecision === 1 ? {
          type: 'pass', targetPlayerId: RECEIVER_ID, target: { ...firstTarget },
          confidence: .91, reason: 'forced-pass-race-fixture'
        } : structuredClone(nextIntent)
      };
    }
  };
}

function snapshotFixture({ tick = 1, workflow = 'cpu-v-cpu', receiver = { x: 55, y: 0 },
  receiverVelocity = { x: 0, y: 0 }, target = { x: 55, y: 0 }, interceptor = null,
  interceptorVelocity = { x: 0, y: 0 } } = {}) {
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId,
    formation: '4-3-3',
    phase: teamId === 'you' ? 'settled-attack' : 'defend',
    philosophy: teamId === 'you' ? 'ancelotti-bbc-433' : null,
    attackingDirection: teamId === 'you' ? 1 : -1,
    offsideLine: worldPoint({ x: teamId === 'you' ? 92 : 18, y: 0 }).x,
    tactics: {},
    lineup: canonicalLineup(teamId)
  }));
  const players = [];
  for (const team of teams) {
    for (const [index, row] of team.lineup.entries()) {
      const metric = team.id === 'you'
        ? { x: 20 + index * .35, y: -28 + index * 5.2 }
        : { x: 91 + index * .18, y: -29 + index * 5.4 };
      if (row.id === OWNER_ID) Object.assign(metric, { x: 34, y: 0 });
      if (row.id === RECEIVER_ID) Object.assign(metric, receiver);
      if (interceptor && row.id === 'opp-LCB') Object.assign(metric, interceptor);
      const live = worldPoint(metric);
      const velocity = row.id === RECEIVER_ID ? receiverVelocity
        : interceptor && row.id === 'opp-LCB' ? interceptorVelocity
          : { x: 0, y: 0 };
      players.push({
        id: row.id,
        teamId: team.id,
        role: row.position,
        position: row.position,
        slotId: row.slotId,
        x: live.x,
        y: live.y,
        vx: velocity.x * UNITS.xPerMetre / 60,
        vy: velocity.y * UNITS.yPerMetre / 60,
        fx: team.attackingDirection,
        fy: 0,
        radius: .36 * Math.sqrt(UNITS.xPerMetre * UNITS.yPerMetre),
        stamina: 100,
        heightM: 1.82,
        attrs: {
          pace: 84,
          accel: 84,
          acceleration: 84,
          agility: 84,
          balance: 82,
          strength: 78,
          stamina: 86,
          awareness: 86,
          pass: 88,
          shoot: 74,
          control: 86,
          defend: 76,
          aggression: 74
        },
        isGK: row.position === 'GK',
        sentOff: false,
        contactEligible: row.position !== 'GK',
        tackleActive: false,
        shoulderActive: false,
        control: null
      });
    }
  }
  const owner = players.find(player => player.id === OWNER_ID);
  if (workflow === 'single-player') owner.control = { x: 1, y: 0, strength: .72, sprint: false, shield: false };
  return {
    target,
    snapshot: {
      tick,
      fixedTickSeconds: 1 / 60,
      pitch: { ...PITCH },
      units: { ...UNITS },
      players,
      humanPlayerIds: workflow === 'single-player' ? [OWNER_ID] : [],
      ball: {
        id: 'pass-race-ball', x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, zv: 0,
        spin: 0, dip: 0, ownerId: OWNER_ID, targetId: null, lastKickerId: null,
        flightType: '', launchIntent: null
      },
      teams,
      contact: {
        intendedReceiverId: null, firstTouchIntent: null, aerialIntent: null,
        gate: { livePlay: true, restartActive: false, replayActive: false, keeperAuthority: false,
          offsideInvolvementPending: false, specialActionAuthority: false }
      },
      dribbling: { surface: 'dry', actionIntent: null }
    }
  };
}

function capability(workflow) {
  return Adapter.createCapability({
    acknowledgement: Adapter.ACKNOWLEDGEMENT,
    workflow,
    online: false,
    onlineMarkers: {},
    ...(workflow === 'cpu-v-cpu'
      ? { controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] } }
      : {})
  });
}

function attachment(workflow, target, options = {}) {
  return Adapter.createAttachment({
    enabled: true,
    capability: capability(workflow),
    seed: 201020,
    cpuPassRaceFilter: options.cpuPassRaceFilter,
    trueFeelPhysicalTouchAuthority: options.trueFeelPhysicalTouchAuthority,
    dependencies: { ball: Ball, movement: Movement, cpu: options.cpu || forcedPassCpu(target), formation: Formation,
      contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function riskAttachment(target, confidence) {
  return Adapter.createAttachment({
    enabled: true,
    capability: capability('cpu-v-cpu'),
    seed: 201021,
    dependencies: { ball: Ball, movement: Movement, cpu: forcedProgressiveRiskCpu(target, confidence),
      formation: Formation, contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function shortSupportAttachment(target, supportMetrics = null) {
  return Adapter.createAttachment({
    enabled: true,
    capability: capability('cpu-v-cpu'),
    seed: 201022,
    dependencies: { ball: Ball, movement: Movement, cpu: forcedShortSupportCpu(target, supportMetrics),
      formation: Formation, contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function carryAttachment(target) {
  return Adapter.createAttachment({
    enabled: true,
    capability: capability('cpu-v-cpu'),
    seed: 201024,
    dependencies: { ball: Ball, movement: Movement, cpu: forcedCarryCpu(target), formation: Formation,
      contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function sequencedAttachment(target, nextIntent) {
  return Adapter.createAttachment({
    enabled: true,
    capability: capability('cpu-v-cpu'),
    seed: 201023,
    dependencies: { ball: Ball, movement: Movement, cpu: sequencedCpu(target, nextIntent),
      formation: Formation, contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function runTick(live, snapshot) {
  const frame = live.planTick(snapshot);
  assert.ok(frame, JSON.stringify(live.status()));
  assert.equal(live.commitTick(frame), true, JSON.stringify(live.status()));
  return frame;
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function withValidChecksum(serialized) {
  const payload = structuredClone(serialized);
  delete payload.checksum;
  return {
    ...payload,
    checksum: Adapter.stableHash(canonical(payload)).toString(16).padStart(8, '0')
  };
}

function launchSnapshotFromAcceptedPass(fixture, frame) {
  const next = structuredClone(fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent?.type, 'pass', JSON.stringify(intent));
  assert.equal(intent?.targetPlayerId, RECEIVER_ID);
  assert.equal(intent?.passRace?.accepted, true, JSON.stringify(intent?.passRace));
  for (const movement of frame.hostProjection.movement) {
    const player = next.players.find(row => row.id === movement.id);
    Object.assign(player, {
      x: movement.x, y: movement.y, vx: movement.vx, vy: movement.vy,
      fx: movement.fx, fy: movement.fy, stamina: movement.stamina
    });
  }
  const origin = { x: next.ball.x, y: next.ball.y, z: Math.max(1, next.ball.z || 0) };
  const dx = intent.target.x - origin.x;
  const dy = intent.target.y - origin.y;
  const metric = { x: dx / UNITS.xPerMetre, y: dy / UNITS.yPerMetre };
  const length = Math.hypot(metric.x, metric.y) || 1;
  next.tick = 2;
  next.ball = {
    ...next.ball,
    x: origin.x,
    y: origin.y,
    z: origin.z,
    vx: 0,
    vy: 0,
    zv: 0,
    ownerId: null,
    targetId: RECEIVER_ID,
    lastKickerId: OWNER_ID,
    flightType: 'ground-pass',
    launchIntent: {
      sequence: 'independent-accepted-pass-1',
      sourcePlayerId: OWNER_ID,
      targetPlayerId: RECEIVER_ID,
      origin,
      target: { x: intent.target.x, y: intent.target.y },
      direction: { x: metric.x / length, y: metric.y / length },
      speedMetresPerSecond: intent.passRace.launchSpeedMetresPerSecond,
      liftAngleDeg: intent.passRace.launchLiftAngleDeg,
      sideSpinRpm: 0,
      topSpinRpm: 0,
      source: 'ground-pass'
    }
  };
  next.contact.intendedReceiverId = RECEIVER_ID;
  next.players.find(row => row.id === OWNER_ID).contactEligible = false;
  return next;
}

function advanceFlightSnapshot(snapshot, frame) {
  const next = structuredClone(snapshot);
  next.tick += 1;
  for (const movement of frame.hostProjection.movement) {
    const player = next.players.find(row => row.id === movement.id);
    Object.assign(player, {
      x: movement.x, y: movement.y, vx: movement.vx, vy: movement.vy,
      fx: movement.fx, fy: movement.fy, stamina: movement.stamina
    });
  }
  if (frame.hostProjection.ball) Object.assign(next.ball, frame.hostProjection.ball);
  next.ball.ownerId = frame.hostProjection.physicalBallSeparated
    ? null : frame.hostProjection.logicalBallOwnerId;
  next.ball.launchIntent = null;
  if (frame.hostProjection.contact?.contactType === 'involuntary-deflection') {
    next.ball.targetId = null;
    next.ball.flightType = 'involuntary-deflection';
  }
  next.contact.intendedReceiverId = next.ball.targetId;
  return next;
}

test('an own-third MR pass protects the actual receiver contact with a twenty-tick opponent margin', () => {
  const fixture = snapshotFixture();
  const frame = runTick(attachment('cpu-v-cpu', fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass');
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.equal(intent.passRace.accepted, true);
  assert.equal(intent.passRace.requiredMarginTicks, 20);
  assert.equal(intent.passRace.safetyCritical, true);
  assert.equal(intent.passRace.requiredReceiverReadyBufferTicks, 8);
  assert.ok(intent.passRace.receiverReadyBufferTicks >= 8);
  assert.equal(intent.passRace.reason, 'receiver-arrives-before-interceptor');
  assert.ok(intent.passRace.receiverContactTick >= intent.passRace.ballArrivalTick);
  assert.equal(intent.passRace.opponentContactTick, null);
  assert.match(intent.passRace.trajectorySignature, /^[0-9a-f]{8}$/);
  assert.deepEqual(intent.target, worldPoint(fixture.target));
  assert.ok(intent.continuationTarget && Number.isFinite(intent.continuationTarget.x) && Number.isFinite(intent.continuationTarget.y));
});

test('CPU-v-CPU rejects both a receiver that cannot arrive and an interception race below the six-tick margin', () => {
  const unreachable = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const unreachableFrame = runTick(attachment('cpu-v-cpu', unreachable.target), unreachable.snapshot);
  const unreachableIntent = unreachableFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.ok(['carry', 'wait'].includes(unreachableIntent.type) ||
    (unreachableIntent.type === 'pass' && unreachableIntent.reason === 'unsafe-progressive-pass-safe-recycle'));
  assert.notEqual(unreachableIntent.targetPlayerId, RECEIVER_ID);
  assert.equal(unreachableIntent.fallbackFrom, 'pass');
  assert.equal(unreachableIntent.passRace.accepted, false);
  assert.ok(['receiver-cannot-arrive', 'trajectory-misses-target-window', 'receiver-not-ready-at-arrival'].includes(unreachableIntent.passRace.reason));

  const contested = snapshotFixture({ interceptor: { x: 55, y: 0 } });
  const contestedFrame = runTick(attachment('cpu-v-cpu', contested.target), contested.snapshot);
  const contestedIntent = contestedFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.ok(['carry', 'wait'].includes(contestedIntent.type) ||
    (contestedIntent.type === 'pass' && contestedIntent.reason === 'unsafe-progressive-pass-safe-recycle'));
  assert.notEqual(contestedIntent.targetPlayerId, RECEIVER_ID);
  assert.equal(contestedIntent.fallbackFrom, 'pass');
  assert.equal(contestedIntent.passRace.accepted, false);
  assert.equal(contestedIntent.passRace.reason, 'insufficient-interception-margin');
  assert.ok(contestedIntent.passRace.opponentContactTick < contestedIntent.passRace.receiverContactTick + 6);
});

test('a rejected CPU pass holds its existing fallback for exactly six committed ticks', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target);
  const frames = [];
  for (let tick = 1; tick <= 7; tick += 1) {
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.tick = tick;
    frames.push(runTick(live, snapshot));
  }
  const first = frames[0].cpu.you.carrierIntent;
  assert.equal(first.fallbackFrom, 'pass');
  assert.equal(frames[0].cpu.you.telemetry.passReceiverRace.held, undefined);
  for (let index = 1; index < 6; index += 1) {
    assert.deepEqual(frames[index].cpu.you.carrierIntent, first);
    assert.equal(frames[index].cpu.you.telemetry.passReceiverRace.reason,
      'rejected-pass-commitment-held');
    assert.equal(frames[index].cpu.you.telemetry.passReceiverRace.evaluatedTick, 1);
    assert.equal(frames[index].cpu.you.telemetry.passReceiverRace.untilTick, 6);
  }
  assert.notEqual(frames[6].cpu.you.telemetry.passReceiverRace.reason,
    'rejected-pass-commitment-held');
  assert.equal(live.status().cpuRejectedPassCommitments.you.evaluatedTick, 7);
  assert.equal(live.status().cpuRejectedPassCommitments.you.untilTick, 12);
});

test('a rejected-pass commitment cancels on CPU owner or possession-team change', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target);
  runTick(live, fixture.snapshot);
  assert.equal(live.status().cpuRejectedPassCommitments.you.ownerId, OWNER_ID);

  const changedOwner = structuredClone(fixture.snapshot);
  changedOwner.tick = 2;
  changedOwner.ball.ownerId = 'you-LCM';
  const ownerFrame = runTick(live, changedOwner);
  assert.notEqual(ownerFrame.cpu.you.telemetry.passReceiverRace.reason,
    'rejected-pass-commitment-held');
  assert.notEqual(live.status().cpuRejectedPassCommitments.you?.ownerId, OWNER_ID);

  const changedTeam = structuredClone(fixture.snapshot);
  changedTeam.tick = 3;
  changedTeam.ball.ownerId = 'opp-LCM';
  const teamFrame = runTick(live, changedTeam);
  assert.notEqual(teamFrame.cpu.opp.telemetry.passReceiverRace.reason,
    'rejected-pass-commitment-held');
  assert.equal(live.status().cpuRejectedPassCommitments.you, null);
  assert.notEqual(live.status().cpuRejectedPassCommitments.opp?.ownerId, OWNER_ID);
});

test('accepted passes and human ownership never create or consume rejected-pass commitments', () => {
  const accepted = snapshotFixture();
  const acceptedLive = attachment('cpu-v-cpu', accepted.target);
  const acceptedFrame = runTick(acceptedLive, accepted.snapshot);
  assert.equal(acceptedFrame.cpu.you.carrierIntent.passRace.accepted, true);
  assert.deepEqual(acceptedLive.status().cpuRejectedPassCommitments, { you: null, opp: null });

  const human = snapshotFixture({ workflow: 'single-player', receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const humanLive = attachment('single-player', human.target);
  const humanFrame = runTick(humanLive, human.snapshot);
  assert.equal(Object.hasOwn(humanFrame.cpu.you.carrierIntent, 'passRace'), false);
  assert.deepEqual(humanLive.status().cpuRejectedPassCommitments, { you: null, opp: null });
});

test('a newly available shot immediately cancels a rejected-pass commitment', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const live = sequencedAttachment(fixture.target, {
    type: 'shot', targetPlayerId: null, target: { x: 105, y: 0 },
    confidence: .95, reason: 'new-shot-lane-open'
  });
  runTick(live, fixture.snapshot);
  const next = structuredClone(fixture.snapshot);
  next.tick = 2;
  const frame = runTick(live, next);
  assert.equal(frame.cpu.you.carrierIntent.type, 'shot');
  assert.equal(frame.cpu.you.carrierIntent.reason, 'new-shot-lane-open');
  assert.equal(live.status().cpuRejectedPassCommitments.you, null);
});

test('a meaningfully new pass target immediately cancels and reevaluates a rejected pass', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const nextTarget = { x: 55, y: 0 };
  const live = sequencedAttachment(fixture.target, {
    type: 'pass', targetPlayerId: RECEIVER_ID, target: nextTarget,
    confidence: .94, reason: 'release-newly-opened-run'
  });
  runTick(live, fixture.snapshot);
  const next = structuredClone(fixture.snapshot);
  next.tick = 2;
  const frame = runTick(live, next);
  assert.notEqual(frame.cpu.you.telemetry.passReceiverRace.reason,
    'rejected-pass-commitment-held');
  assert.equal(frame.cpu.you.telemetry.passReceiverRace.evaluatedTick, 2);
  assert.equal(frame.cpu.you.telemetry.passReceiverRace.receiverId, RECEIVER_ID);
  const currentCommitment = live.status().cpuRejectedPassCommitments.you;
  assert.ok(currentCommitment == null || currentCommitment.evaluatedTick === 2);
  assert.notEqual(currentCommitment?.authoredPass?.reason, 'forced-pass-race-fixture');
});

test('an active rejected-pass commitment is transactional and export-restore identical', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });

  const rolledBack = attachment('cpu-v-cpu', fixture.target);
  const uncommitted = rolledBack.planTick(structuredClone(fixture.snapshot));
  assert.ok(uncommitted);
  assert.deepEqual(rolledBack.status().cpuRejectedPassCommitments, { you: null, opp: null });
  const prepared = rolledBack.prepareCommit(uncommitted);
  assert.ok(prepared);
  assert.equal(rolledBack.abortPrepared(prepared), true);
  assert.deepEqual(rolledBack.status().cpuRejectedPassCommitments, { you: null, opp: null });

  const direct = attachment('cpu-v-cpu', fixture.target);
  const checkpointed = attachment('cpu-v-cpu', fixture.target);
  runTick(direct, structuredClone(fixture.snapshot));
  runTick(checkpointed, structuredClone(fixture.snapshot));
  const checkpoint = structuredClone(checkpointed.exportState());
  assert.equal(checkpoint.domain.cpuRejectedPassCommitments.you.evaluatedTick, 1);
  assert.equal(checkpoint.domain.cpuRejectedPassCommitments.you.untilTick, 6);

  const resumed = attachment('cpu-v-cpu', fixture.target);
  assert.equal(resumed.restoreState(checkpoint), true);
  for (let tick = 2; tick <= 7; tick += 1) {
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.tick = tick;
    const directFrame = runTick(direct, structuredClone(snapshot));
    const resumedFrame = runTick(resumed, snapshot);
    assert.deepEqual(resumedFrame.hostProjection, directFrame.hostProjection);
    assert.deepEqual(resumedFrame.cpu, directFrame.cpu);
  }
  const directState = structuredClone(direct.exportState());
  const resumedState = structuredClone(resumed.exportState());
  resumedState.attachmentGeneration = directState.attachmentGeneration;
  delete directState.checksum;
  delete resumedState.checksum;
  assert.deepEqual(resumedState, directState);
});

test('a legacy checkpoint missing rejected-pass commitments restores with an empty default', () => {
  const fixture = snapshotFixture();
  const source = attachment('cpu-v-cpu', fixture.target);
  runTick(source, structuredClone(fixture.snapshot));
  const legacyCheckpoint = structuredClone(source.exportState());
  delete legacyCheckpoint.domain.cpuRejectedPassCommitments;

  const resumed = attachment('cpu-v-cpu', fixture.target);
  assert.equal(resumed.restoreState(withValidChecksum(legacyCheckpoint)), true);
  assert.deepEqual(resumed.status().cpuRejectedPassCommitments, { you: null, opp: null });
});

test('adapter reset clears every rejected-pass commitment', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target);
  runTick(live, fixture.snapshot);
  assert.ok(live.status().cpuRejectedPassCommitments.you);

  assert.equal(live.reset('rejected-pass-commitment-test').schema,
    'football-legacy-live-v2-reset');
  assert.deepEqual(live.status().cpuRejectedPassCommitments, { you: null, opp: null });
  assert.deepEqual(live.exportState().domain.cpuRejectedPassCommitments, { you: null, opp: null });
});

test('the pass-race-disabled profile cannot retain rejected-pass commitments', () => {
  const fixture = snapshotFixture({ receiver: { x: 10, y: 28 }, target: { x: 78, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target, { cpuPassRaceFilter: false });
  for (let tick = 1; tick <= 8; tick += 1) {
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.tick = tick;
    const frame = runTick(live, snapshot);
    assert.equal(Object.hasOwn(frame.cpu.you.carrierIntent, 'passRace'), false);
    assert.deepEqual(live.status().cpuRejectedPassCommitments, { you: null, opp: null });
  }
});

test('receiver and interceptor races use rated movement to the MR path rather than release-tick origins', () => {
  const movingReceiver = snapshotFixture({
    receiver: { x: 52, y: 2 },
    receiverVelocity: { x: 3.2, y: -2.4 },
    target: { x: 55, y: 0 }
  });
  const receiverFrame = runTick(attachment('cpu-v-cpu', movingReceiver.target), movingReceiver.snapshot);
  const receiverIntent = receiverFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(receiverIntent.type, 'pass', JSON.stringify(receiverIntent));
  assert.equal(receiverIntent.targetPlayerId, RECEIVER_ID);
  assert.equal(receiverIntent.passRace.accepted, true, JSON.stringify(receiverIntent.passRace));
  assert.equal(receiverIntent.passRace.reason, 'receiver-arrives-before-interceptor');

  const movingInterceptor = snapshotFixture({
    receiver: { x: 55, y: 0 },
    target: { x: 55, y: 0 },
    interceptor: { x: 53.5, y: 2 },
    interceptorVelocity: { x: 1.2, y: -4.8 }
  });
  const interceptorFrame = runTick(attachment('cpu-v-cpu', movingInterceptor.target), movingInterceptor.snapshot);
  const interceptorIntent = interceptorFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.ok(interceptorIntent.type !== 'pass' || interceptorIntent.targetPlayerId !== RECEIVER_ID,
    JSON.stringify(interceptorIntent));
  assert.equal(interceptorIntent.fallbackFrom, 'pass');
  assert.equal(interceptorIntent.passRace.accepted, false);
  assert.equal(interceptorIntent.passRace.reason, 'insufficient-interception-margin');
});

test('an intended receiver may cushion a physically intersecting MR pass before the authored endpoint', () => {
  const fixture = snapshotFixture({
    receiver: { x: 46.55, y: 0 },
    target: { x: 46.55, y: 0 }
  });
  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const releaseIntent = releaseFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  const passRace = releaseIntent.passRace || releaseIntent.rejectedPassRace;
  const authoredDistanceMetres = Math.hypot(fixture.target.x - 34, fixture.target.y);

  assert.ok(authoredDistanceMetres >= 10 && authoredDistanceMetres <= 15);
  assert.ok(passRace, JSON.stringify(releaseIntent));
  assert.deepEqual(releaseIntent.target, worldPoint(fixture.target), JSON.stringify(releaseIntent));
  assert.ok(passRace.ballArrivalTick >= Math.floor(authoredDistanceMetres /
    passRace.launchSpeedMetresPerSecond * 60), JSON.stringify(passRace));
  assert.ok(passRace.receiverContactTick == null || passRace.receiverContactTick >= passRace.ballArrivalTick,
    JSON.stringify(passRace));
  if (releaseIntent.type === 'pass' && releaseIntent.targetPlayerId === RECEIVER_ID) {
    let flightSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
    // Exercise the explicit cushion contract. Automatic directional receiving
    // has separate race/continuation tests and deliberately grants no owner.
    flightSnapshot.contact.firstTouchIntent = { type: 'cushion', direction: { x: 1, y: 0 }, touchDistanceM: .3, active: false };
    // The race accepted a lead pass. Put the named receiver directly on the
    // early physical path after release so this fixture distinguishes real
    // contact authority from the later authored endpoint window.
    const earlyReceiver = flightSnapshot.players.find(row => row.id === RECEIVER_ID);
    Object.assign(earlyReceiver, { ...worldPoint({ x: 35.2, y: 0 }), vx: 0, vy: 0 });
    let preArrivalTicks = 0;
    let physicalCushion = null;
    for (let step = 0; step < Math.min(120, passRace.ballArrivalTick + 6); step += 1) {
      const flightFrame = runTick(live, flightSnapshot);
      const contact = flightFrame.hostProjection.contact;
      const arrivalWindowEntered = flightFrame.hostProjection.possession.arrivalWindowEntered === true;
      if (!arrivalWindowEntered) {
        preArrivalTicks += 1;
        if (contact?.contactType) {
          physicalCushion = contact;
          const authoredWorldTarget = worldPoint(fixture.target);
          const contactBall = flightSnapshot.ball;
          const endpointDistanceMetres = Math.hypot(
            (contactBall.x - authoredWorldTarget.x) / UNITS.xPerMetre,
            (contactBall.y - authoredWorldTarget.y) / UNITS.yPerMetre
          );
          assert.ok(endpointDistanceMetres > 3.25,
            `fixture contacted only inside the old endpoint window: ${endpointDistanceMetres.toFixed(3)} m`);
          assert.equal(contact.presentation?.playerId, RECEIVER_ID, JSON.stringify(contact));
          assert.equal(contact.contactType, 'first-touch', JSON.stringify(contact));
          assert.equal(contact.ownedContact, true, JSON.stringify(contact));
          assert.ok(contact.ownerCandidateId===RECEIVER_ID || contact.ownerCandidateId===null&&
            contact.presentation.possessionDisposition==='remain-loose', JSON.stringify(contact));
          break;
        }
        assert.notEqual(contact?.ownerCandidateId, RECEIVER_ID,
          `receiver acquired without physical contact at tick ${flightSnapshot.tick}: ${JSON.stringify(contact)}`);
      } else {
        break;
      }
      flightSnapshot = advanceFlightSnapshot(flightSnapshot, flightFrame);
    }
    assert.ok(preArrivalTicks >= 1, `only observed ${preArrivalTicks} pre-arrival ticks`);
    assert.ok(physicalCushion,
      'the intended receiver physically intersected the ball but was forced to wait for the endpoint window');
  } else {
    assert.equal(releaseIntent.fallbackFrom, 'pass');
    assert.equal(passRace.accepted, false);
  }
});

test('wide CPU rendezvous points stay inside a deterministic 4.5-metre boundary corridor', () => {
  const fixture = snapshotFixture({ receiver: { x: 48, y: 29.5 }, target: { x: 48, y: 34 } });
  const owner = fixture.snapshot.players.find(player => player.id === OWNER_ID);
  const shifted = worldPoint({ x: 34, y: 25 });
  Object.assign(owner, { x: shifted.x, y: shifted.y });
  Object.assign(fixture.snapshot.ball, { x: shifted.x, y: shifted.y });
  const frame = runTick(attachment('cpu-v-cpu', fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass');
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.deepEqual(intent.target, worldPoint({ x: 48, y: 29.5 }));
  assert.equal(intent.passRace.boundaryRetarget.distanceMetres, 4.5);
  assert.equal(intent.passRace.boundaryRetarget.marginMetres, 4.5);
});

test('high passing confidence cannot override an opponent interception', () => {
  const fixture = snapshotFixture({ receiver: { x: 48, y: 0 }, target: { x: 55, y: 0 },
    interceptor: { x: 41, y: 0 } });
  const high = runTick(riskAttachment(fixture.target, .86), structuredClone(fixture.snapshot));
  const highIntent = high.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(high.cpu.you.telemetry.passReceiverRace.accepted, false);
  assert.equal(high.cpu.you.telemetry.passReceiverRace.reason, 'insufficient-interception-margin');
  assert.notEqual(highIntent.passRace?.reason, 'high-confidence-progressive-risk-envelope');
  const low = runTick(riskAttachment(fixture.target, .7), structuredClone(fixture.snapshot));
  const lowIntent = low.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.notEqual(lowIntent.passRace?.reason, 'high-confidence-progressive-risk-envelope');
});

test('a clean short support pass clears the same MR interception race as every other pass', () => {
  const fixture = snapshotFixture({ receiver: { x: 52, y: 0 }, target: { x: 52, y: 0 } });
  Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),worldPoint({x:44,y:0}));
  Object.assign(fixture.snapshot.ball,worldPoint({x:44,y:0}));
  const frame = runTick(shortSupportAttachment(fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass', JSON.stringify(intent));
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.equal(intent.passRace.accepted, true);
  assert.equal(intent.passRace.lightweight, undefined);
  assert.ok(intent.passRace.projectedFlightTicks > 0);
  assert.equal(intent.passRace.requiredMarginTicks, 2);
});

test('an ordinary support lane earns release through the physical receiver race', () => {
  const fixture = snapshotFixture({ receiver: { x: 42, y: 0 }, target: { x: 42, y: 0 } });
  const frame = runTick(shortSupportAttachment(fixture.target,
    { distance: 242, progress: 120, laneClearance: 52, receiverSpace: 70 }), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass', JSON.stringify(intent));
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.equal(intent.passRace.accepted, true);
  assert.equal(intent.passRace.lightweight, undefined);
  assert.ok(intent.passRace.projectedFlightTicks > 0, JSON.stringify(intent.passRace));
});

test('overlapping CPU support stays under controlled carry instead of launching a micro-pass', () => {
  const fixture = snapshotFixture({ receiver: { x: 37, y: 0 }, target: { x: 37, y: 0 } });
  const frame = runTick(attachment('cpu-v-cpu', fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.ok(intent.type !== 'pass' || intent.targetPlayerId !== RECEIVER_ID, JSON.stringify(intent));
  assert.equal(intent.fallbackFrom, 'pass');
  assert.equal(intent.passRace.reason, 'pass-distance-below-control-threshold');
  assert.ok(intent.passRace.distanceMetres < 5.5);
});

test('a CPU carrier sprints into distant open space but keeps a nearby carry controlled', () => {
  const farFixture = snapshotFixture({ target: { x: 55, y: 0 } });
  const far = runTick(carryAttachment({ x: 55, y: 0 }), farFixture.snapshot);
  const farCarrier = far.hostProjection.movement.find(row => row.id === OWNER_ID);
  assert.equal(far.cpu.you.carrierIntent.type, 'carry');
  assert.equal(farCarrier.locomotionState, 'sprint', JSON.stringify(farCarrier));

  const nearFixture = snapshotFixture({ target: { x: 34.6, y: 0 } });
  const near = runTick(carryAttachment({ x: 34.6, y: 0 }), nearFixture.snapshot);
  const nearCarrier = near.hostProjection.movement.find(row => row.id === OWNER_ID);
  assert.equal(near.cpu.you.carrierIntent.type, 'carry');
  assert.notEqual(nearCarrier.locomotionState, 'sprint', JSON.stringify(nearCarrier));
});

test('the accepted receiver rendezvous persists after the one-frame carrier intent has gone', () => {
  assert.match(ADAPTER_SOURCE,
    /possession\s*&&\s*possession\.inFlight\s*&&\s*possession\.intendedReceiverId\s*&&\s*possession\.intendedTarget/);
  assert.match(ADAPTER_SOURCE,
    /reception\[String\(possession\.intendedReceiverId\)\]\s*=\s*\{/);

  const fixture = snapshotFixture({
    receiver: { x: 52, y: 2 },
    receiverVelocity: { x: 0, y: 0 },
    target: { x: 55, y: 0 }
  });
  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const flightSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  const before = flightSnapshot.players.find(row => row.id === RECEIVER_ID);
  const intended = flightSnapshot.ball.launchIntent.target;
  const beforeDistance = Math.hypot(
    (before.x - intended.x) / UNITS.xPerMetre,
    (before.y - intended.y) / UNITS.yPerMetre
  );

  const flightFrame = runTick(live, flightSnapshot);
  assert.equal(flightFrame.hostProjection.intelligence.some(row => row.playerId === OWNER_ID), false,
    'carrier pass intent must be absent on the flight tick');
  assert.equal(flightFrame.hostProjection.recoveryAssignments.some(row => row.playerId === RECEIVER_ID &&
    row.authority === 'v2-loose-ball-recovery'), false,
    'own receiver route must not be replaced by generic loose-ball recovery');
  assert.ok(flightFrame.hostProjection.recoveryAssignments.some(row => row.playerId === RECEIVER_ID &&
    row.authority === 'v2-cpu-reception-guidance'),
  'the persisted CPU rendezvous should expose its timed physical guidance');
  const after = flightFrame.hostProjection.movement.find(row => row.id === RECEIVER_ID);
  const afterDistance = Math.hypot(
    (after.x - intended.x) / UNITS.xPerMetre,
    (after.y - intended.y) / UNITS.yPerMetre
  );
  assert.ok(afterDistance < beforeDistance,
    `receiver did not persist toward rendezvous: ${beforeDistance} -> ${afterDistance}`);
  assert.ok(['walk', 'run', 'sprint'].includes(after.locomotionState), JSON.stringify(after));
});

test('an overshooting CPU receiver brakes before turning back instead of orbiting the meeting', () => {
  const fixture = snapshotFixture({ receiver: { x: 52, y: 0 }, target: { x: 55, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const flightSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  const meeting = flightSnapshot.ball.launchIntent.target;
  const receiver = flightSnapshot.players.find(row => row.id === RECEIVER_ID);
  Object.assign(receiver, {
    x: meeting.x + 1.1 * UNITS.xPerMetre,
    y: meeting.y,
    vx: 7 * UNITS.xPerMetre / 60,
    vy: 0,
    fx: 1,
    fy: 0
  });
  flightSnapshot.ball.launchIntent.predictedArrivalTicks = 54;

  const frame = runTick(live, flightSnapshot);
  const guidance = frame.hostProjection.recoveryAssignments.find(row =>
    row.authority === 'v2-cpu-reception-guidance' && row.playerId === RECEIVER_ID);
  const movement = frame.hostProjection.movement.find(row => row.id === RECEIVER_ID);

  assert.ok(guidance, JSON.stringify(frame.hostProjection.recoveryAssignments));
  assert.equal(guidance.movingAwayFromMeeting, true, JSON.stringify(guidance));
  assert.equal(guidance.receptionBrake, true, JSON.stringify(guidance));
  assert.equal(movement.locomotionState, 'idle', JSON.stringify(movement));
  assert.ok(movement.fx > .8, `receiver snapped its facing back toward the missed point: ${JSON.stringify(movement)}`);
  assert.ok(movement.vx >= 0 && movement.vx < receiver.vx,
    `receiver did not brake on its existing line: ${receiver.vx} -> ${movement.vx}`);
});

test('a receiver who has shed his overshoot momentum can turn back and reach the real pass',()=>{
 const fixture=snapshotFixture({receiver:{x:52,y:0},target:{x:55,y:0}}),live=attachment('cpu-v-cpu',fixture.target);
 const released=runTick(live,fixture.snapshot);let snapshot=launchSnapshotFromAcceptedPass(fixture,released);
 const meeting=snapshot.ball.launchIntent.target,receiver=snapshot.players.find(p=>p.id===RECEIVER_ID);
 Object.assign(receiver,{x:meeting.x+1.1*UNITS.xPerMetre,y:meeting.y,vx:.8*UNITS.xPerMetre/60,vy:0,fx:1,fy:0});
 let received=false,turned=false,turnedTick=null,receivedTick=null;
 for(let i=0;i<100;i++){
  const frame=runTick(live,snapshot),p=frame.hostProjection.movement.find(p=>p.id===RECEIVER_ID);
  if(p.fx<-.5){turned=true;turnedTick??=i+1;}
  if(frame.hostProjection.contact?.ownerCandidateId===RECEIVER_ID||frame.hostProjection.logicalBallOwnerId===RECEIVER_ID){received=true;receivedTick=i+1;break;}
  snapshot=advanceFlightSnapshot(snapshot,frame);
 }
 console.log('TURN_RECEPTION_PROOF',JSON.stringify({turnedTick,receivedTick}));
 assert.equal(turned,true,'braking must not keep resetting the turn toward the meeting');
 assert.ok(turnedTick<=30,'the rated receiver should turn through 120 degrees within half a second after shedding momentum');
 assert.equal(received,true,'a free receiver must physically meet the checked pass');
});

test('a safety-critical pass waits for an overshooting receiver to recover his feet',()=>{
 const target={x:20.245,y:-29.5},fixture=snapshotFixture({receiver:{x:20.609,y:-28.849},target,
  receiverVelocity:{x:-2.448,y:-5.543},interceptor:{x:32.3,y:-29.5}});
 const owner=fixture.snapshot.players.find(p=>p.id===OWNER_ID);Object.assign(owner,worldPoint({x:7.386,y:-26.056}));
 Object.assign(fixture.snapshot.ball,worldPoint({x:7.386,y:-26.056}));
 for(const p of fixture.snapshot.players)if(p.teamId==='you'&&p.id!==OWNER_ID&&p.id!==RECEIVER_ID)Object.assign(p,worldPoint({x:60,y:25}));
 const receiver=fixture.snapshot.players.find(p=>p.id===RECEIVER_ID);
 Object.assign(receiver,{fx:-.404,fy:-.915,radius:12.75,stamina:39.97});
 Object.assign(receiver.attrs,{pace:87,accel:89,acceleration:89,control:95,awareness:94,balance:91,agility:94,reactions:93});
 const frame=runTick(attachment('cpu-v-cpu',target),fixture.snapshot),race=frame.cpu.you.telemetry.passReceiverRace;
 assert.equal(race.safetyCritical,true);assert.ok(race.receiverSpaceMetres>10);
 assert.equal(race.accepted,false,'being free does not make a receiver who is still braking and turning ready');
 Object.assign(receiver,{...worldPoint(target),vx:0,vy:0});
 const ready=runTick(attachment('cpu-v-cpu',target),fixture.snapshot).cpu.you.telemetry.passReceiverRace;
 assert.equal(ready.accepted,true,JSON.stringify(ready));
});

test('a missed offside-pending rendezvous becomes a physical loose-ball race instead of an authority deadlock', () => {
  const fixture = snapshotFixture({ receiver: { x: 55, y: 0 }, target: { x: 55, y: 0 } });
  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  let flightSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  const meeting = flightSnapshot.ball.launchIntent.target;
  flightSnapshot.ball.launchIntent.predictedArrivalTicks = 24;
  flightSnapshot.ball.launchIntent.offsideCandidate = {
    playerId: RECEIVER_ID,
    teamId: 'you',
    passerId: OWNER_ID,
    kickTick: flightSnapshot.tick
  };
  flightSnapshot.contact.gate.offsideInvolvementPending = true;
  const launchFrame = runTick(live, flightSnapshot);

  flightSnapshot = advanceFlightSnapshot(flightSnapshot, launchFrame);
  Object.assign(flightSnapshot.ball, {
    x: meeting.x,
    y: meeting.y,
    z: 0,
    vx: 4 * UNITS.xPerMetre / 60,
    vy: 0,
    zv: 0,
    targetId: RECEIVER_ID,
    launchIntent: null
  });
  flightSnapshot.contact.gate.offsideInvolvementPending = true;
  const arrivalFrame = runTick(live, flightSnapshot);
  assert.equal(arrivalFrame.hostProjection.possession.inFlight, true);
  assert.equal(arrivalFrame.hostProjection.possession.arrivalWindowEntered, true);

  flightSnapshot = advanceFlightSnapshot(flightSnapshot, arrivalFrame);
  Object.assign(flightSnapshot.ball, {
    x: meeting.x + 4.5 * UNITS.xPerMetre,
    y: meeting.y,
    z: 0,
    vx: 1.2 * UNITS.xPerMetre / 60,
    vy: 0,
    zv: 0,
    targetId: RECEIVER_ID,
    launchIntent: null
  });
  flightSnapshot.contact.gate.offsideInvolvementPending = true;
  const missedFrame = runTick(live, flightSnapshot);

  assert.equal(missedFrame.hostProjection.possession.inFlight, false,
    JSON.stringify(missedFrame.hostProjection.possession));
  assert.equal(missedFrame.hostProjection.possession.ownerId, null);
  assert.equal(missedFrame.hostProjection.possession.routeExpiredReason, 'ball-left-arrival-window');
  assert.ok(missedFrame.hostProjection.recoveryAssignments.some(row =>
    row.authority === 'v2-loose-ball-recovery'),
  JSON.stringify(missedFrame.hostProjection.recoveryAssignments));
  assert.equal(missedFrame.hostProjection.recoveryAssignments.some(row => row.intended), false,
    'an expired route must not keep biasing the loose-ball race toward its old receiver');
  assert.equal(missedFrame.hostProjection.contact?.ownerCandidateId ?? null, null,
    'recovery movement must not grant possession while the host still adjudicates offside involvement');
  assert.match(MATCH_SOURCE,
    /routeExpiredAtTick===projection\.snapshotTick\)\{const expiredTarget=ball\.target;ball\.target=null;/,
    'the committed host must clear the stale named target once the authored route ends');
});

test('pass-race output is replay-identical and remains chunk-identical after adapter export/restore', () => {
  const fixture = snapshotFixture();
  const replayA = attachment('cpu-v-cpu', fixture.target);
  const replayB = attachment('cpu-v-cpu', fixture.target);
  const firstA = replayA.planTick(structuredClone(fixture.snapshot));
  const firstB = replayB.planTick(structuredClone(fixture.snapshot));
  assert.deepEqual(firstB.hostProjection, firstA.hostProjection);
  assert.equal(replayA.commitTick(firstA), true);
  assert.equal(replayB.commitTick(firstB), true);

  const uninterrupted = attachment('cpu-v-cpu', fixture.target);
  const firstChunk = attachment('cpu-v-cpu', fixture.target);
  const direct = [];
  for (let tick = 1; tick <= 7; tick += 1) {
    const current = structuredClone(fixture.snapshot);
    current.tick = tick;
    direct.push(runTick(uninterrupted, current).hostProjection);
  }
  for (let tick = 1; tick <= 3; tick += 1) {
    const current = structuredClone(fixture.snapshot);
    current.tick = tick;
    runTick(firstChunk, current);
  }
  const resumed = attachment('cpu-v-cpu', fixture.target);
  assert.equal(resumed.restoreState(structuredClone(firstChunk.exportState())), true);
  for (let tick = 4; tick <= 7; tick += 1) {
    const current = structuredClone(fixture.snapshot);
    current.tick = tick;
    assert.deepEqual(runTick(resumed, current).hostProjection, direct[tick - 1]);
  }
});

test('the CPU receiver-race gate never rewrites a human-owned Single Player pass path', () => {
  const fixture = snapshotFixture({ workflow: 'single-player', interceptor: { x: 55, y: 0 } });
  const frame = runTick(attachment('single-player', fixture.target), fixture.snapshot);
  assert.equal(frame.cpu.you.carrierIntent.type, 'pass');
  assert.equal(Object.hasOwn(frame.cpu.you.carrierIntent, 'passRace'), false);
  assert.equal(frame.hostProjection.intelligence.some(row => row.playerId === OWNER_ID), false);
  assert.equal(frame.hostProjection.logicalBallOwnerId, OWNER_ID);
});

test('a non-intended teammate in the pass lane produces a physical pre-reaction deflection rather than a magic reception', () => {
  const fixture = snapshotFixture();
  const bystander = fixture.snapshot.players.find(player => player.id === 'you-LCB');
  assert.ok(bystander);
  Object.assign(bystander, worldPoint({ x: 34.45, y: 0 }));

  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const flightSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  const flightFrame = runTick(live, flightSnapshot);
  const contact = flightFrame.hostProjection.contact;

  assert.equal(contact?.contactType, 'involuntary-deflection', JSON.stringify(contact));
  assert.equal(contact?.presentation?.playerId, bystander.id, JSON.stringify(contact));
  assert.equal(contact?.ownerCandidateId, null);
  assert.equal(contact?.ballState?.lastContact?.colliderId, bystander.id);
  assert.equal(contact?.ballState?.lastContact?.materialId, 'player-body');
  assert.equal(contact?.detail?.reaction?.ready, false);
  assert.equal(contact?.detail?.involuntary, true);
  assert.notDeepEqual(contact?.detail?.incomingVelocity, contact?.detail?.outgoingVelocity);
});

test('the deliberate-pass teammate lock cannot suppress an attacking shot rebound', () => {
  const fixture = snapshotFixture();
  const attacker = fixture.snapshot.players.find(player => player.id === 'you-LCB');
  assert.ok(attacker);
  Object.assign(attacker, worldPoint({ x: 34.45, y: 0 }));

  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const shotSnapshot = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  Object.assign(shotSnapshot.ball, { flightType: 'shot', targetId: null });
  Object.assign(shotSnapshot.ball.launchIntent, {
    source: 'shot',
    targetPlayerId: null,
    target: worldPoint({ x: 105, y: 0 })
  });
  shotSnapshot.contact.intendedReceiverId = null;
  const contact = runTick(live, shotSnapshot).hostProjection.contact;

  assert.equal(contact?.presentation?.playerId, attacker.id, JSON.stringify(contact));
  assert.equal(contact?.ballState?.lastContact?.colliderId, attacker.id, JSON.stringify(contact));
});

test('a shot contract cannot keep attackers contact-ineligible after an explicit opposing touch', () => {
  const fixture = snapshotFixture();
  const attacker = fixture.snapshot.players.find(player => player.id === 'you-LCB');
  const shooter = fixture.snapshot.players.find(player => player.id === OWNER_ID);
  const target = worldPoint({ x: 104, y: 0 });
  const origin = { x: shooter.x, y: shooter.y, z: 1 };
  const dxM = (target.x - origin.x) / UNITS.xPerMetre;
  const dyM = (target.y - origin.y) / UNITS.yPerMetre;
  const distanceM = Math.hypot(dxM, dyM) || 1;
  Object.assign(attacker, worldPoint({ x: 45, y: 0 }));
  Object.assign(fixture.snapshot.ball, {
    ownerId: null,
    lastKickerId: shooter.id,
    targetId: null,
    flightType: 'shot',
    launchIntent: {
      sequence: 'independent-shot-1',
      sourcePlayerId: shooter.id,
      targetPlayerId: null,
      origin,
      target,
      direction: { x: dxM / distanceM, y: dyM / distanceM },
      speedMetresPerSecond: 28,
      liftAngleDeg: 5,
      sideSpinRpm: 0,
      topSpinRpm: 0,
      source: 'shot'
    }
  });

  const live = attachment('cpu-v-cpu', fixture.target);
  runTick(live, fixture.snapshot);

  const rebound = structuredClone(fixture.snapshot);
  rebound.tick = 2;
  rebound.ball = {
    ...rebound.ball,
    ...worldPoint({ x: 45, y: 0 }),
    z: 0,
    vx: -5,
    vy: 0,
    zv: 0,
    ownerId: null,
    targetId: null,
    lastKickerId: 'opp-GK',
    flightType: 'shot',
    launchIntent: null
  };
  const frame = runTick(live, rebound);
  const contact = frame.hostProjection.contact;
  assert.equal(contact?.presentation?.playerId, attacker.id,
    `attacker remained locked after opposing touch: ${JSON.stringify(contact)}`);
});

test('an explicit opposing deflection ends the original team pass-flight contact lock', () => {
  const fixture = snapshotFixture();
  const attacker = fixture.snapshot.players.find(player => player.id === 'you-LCB');
  const live = attachment('cpu-v-cpu', fixture.target);
  const releaseFrame = runTick(live, fixture.snapshot);
  const flight = launchSnapshotFromAcceptedPass(fixture, releaseFrame);
  const flightFrame = runTick(live, flight);
  const deflection = structuredClone(flight);
  deflection.tick = 3;
  for (const movement of flightFrame.hostProjection.movement) {
    const player = deflection.players.find(row => row.id === movement.id);
    Object.assign(player, {
      x: movement.x, y: movement.y, vx: movement.vx, vy: movement.vy,
      fx: movement.fx, fy: movement.fy, stamina: movement.stamina
    });
  }
  const loosePoint = worldPoint({ x: 45, y: 0 });
  Object.assign(attacker, loosePoint);
  Object.assign(deflection.players.find(player => player.id === attacker.id), loosePoint);
  Object.assign(deflection.ball, {
    ...loosePoint,
    z: 0,
    vx: -5,
    vy: 0,
    zv: 0,
    targetId: null,
    lastKickerId: 'opp-LCB',
    flightType: 'ground-pass',
    launchIntent: null
  });

  const frame = runTick(live, deflection);
  const contact = frame.hostProjection.contact;
  assert.equal(contact?.presentation?.playerId, attacker.id,
    `original team remained locked after opposing deflection: ${JSON.stringify(contact)}`);
});

test('a human receiver cushion intent cannot steer an opponent interception', () => {
  const makeFlight = firstTouchIntent => {
    const fixture = snapshotFixture({ workflow: 'single-player' });
    const source = fixture.snapshot.players.find(player => player.id === OWNER_ID);
    const receiver = fixture.snapshot.players.find(player => player.id === RECEIVER_ID);
    const interceptor = fixture.snapshot.players.find(player => player.id === 'opp-LCB');
    const originMetric = { x: 34, y: 0 };
    const origin = { ...worldPoint(originMetric), z: 1 };
    const target = worldPoint(fixture.target);
    Object.assign(interceptor, worldPoint({ x: 34.35, y: 0 }));
    source.control = null;
    receiver.control = { x: 0, y: 1, strength: .9, sprint: false, shield: false };
    fixture.snapshot.humanPlayerIds = [RECEIVER_ID];
    const dxM = fixture.target.x - originMetric.x;
    const dyM = fixture.target.y - originMetric.y;
    const distanceM = Math.hypot(dxM, dyM) || 1;
    Object.assign(fixture.snapshot.ball, {
      x: origin.x,
      y: origin.y,
      z: origin.z,
      ownerId: null,
      targetId: RECEIVER_ID,
      lastKickerId: OWNER_ID,
      flightType: 'ground-pass',
      launchIntent: {
        sequence: 'human-receiver-intent-scope',
        sourcePlayerId: OWNER_ID,
        targetPlayerId: RECEIVER_ID,
        origin,
        target,
        direction: { x: dxM / distanceM, y: dyM / distanceM },
        speedMetresPerSecond: 20,
        liftAngleDeg: 0,
        sideSpinRpm: 0,
        topSpinRpm: 0,
        source: 'ground-pass'
      }
    });
    fixture.snapshot.contact.intendedReceiverId = RECEIVER_ID;
    fixture.snapshot.contact.firstTouchIntent = firstTouchIntent;
    return runTick(attachment('single-player', fixture.target), fixture.snapshot).hostProjection.contact;
  };

  const guided = makeFlight({ type: 'cushion', direction: { x: 0, y: 1 }, touchDistanceM: .46, active: false });
  const neutral = makeFlight(null);
  assert.equal(guided?.presentation?.playerId, 'opp-LCB', JSON.stringify(guided));
  assert.equal(neutral?.presentation?.playerId, 'opp-LCB', JSON.stringify(neutral));
  assert.deepEqual(guided.ballState, neutral.ballState,
    'the human receiver intent changed the opponent interception physics');
});

function serviceAttachment(target, intentFields) {
  const base = forcedPassCpu(target);
  const cpu = { ...base, decide(...args) { const d = base.decide(...args);
    return d.carrierIntent.type === 'pass' ? { ...d, carrierIntent: { ...d.carrierIntent, ...intentFields } } : d; } };
  return Adapter.createAttachment({ enabled: true, capability: capability('cpu-v-cpu'), seed: 201020,
    dependencies: { ball: Ball, movement: Movement, cpu, formation: Formation, contact: Contact, dribbling: Dribbling },
    host: { prepareTick: () => ({ commit() {}, rollback() {} }) } });
}
test('only a geometrically genuine lofted switch earns the far-side moving-receiver race buffer', () => {
  const target = { x: 55, y: 18 }, fixture = snapshotFixture({ receiver: target, target });
  Object.assign(fixture.snapshot.players.find(p => p.id === OWNER_ID), worldPoint({ x: 55, y: -22 }));
  Object.assign(fixture.snapshot.players.find(p => p.id === 'opp-LCB'), worldPoint({ x: 56, y: -18 }));
  Object.assign(fixture.snapshot.players.find(p => p.id === 'opp-RCB'), worldPoint({ x: 60, y: -24 }));
  fixture.snapshot.ball.x = worldPoint({ x: 55, y: -22 }).x;
  fixture.snapshot.ball.y = worldPoint({ x: 55, y: -22 }).y;
  let live = serviceAttachment(target, { supportKind: 'switch', reason: 'switch-congested-side' });
  const frame = runTick(live, fixture.snapshot);
  const race = frame.cpu.you.telemetry.passReceiverRace;
  assert.equal(race.genuineSwitch, true, JSON.stringify(race));
  assert.equal(race.accepted, true, JSON.stringify(race));
  assert.equal(race.requiredReceiverReadyBufferTicks, 0);
  assert.equal(race.requiredMarginTicks, 6);
  assert.ok(race.launchLiftAngleDeg > 0);
  assert.ok(race.receiverContactTick>race.ballArrivalTick,
    'the broad switch arrival window is not credited as physical boot contact');
  Object.assign(fixture.snapshot.players.find(p => p.id === 'opp-RCB'), worldPoint({ x: 91, y: -24 }));
  live = serviceAttachment(target, { supportKind: 'switch', reason: 'switch-congested-side' });
  const ordinary = runTick(live, fixture.snapshot).cpu.you.telemetry.passReceiverRace;
  assert.equal(ordinary.genuineSwitch, false);
  assert.equal(ordinary.requiredReceiverReadyBufferTicks, 8);
  assert.equal(ordinary.requiredMarginTicks, 6);
});
test('crosses use a crossing launch and aerial receive height while retaining the ordinary interceptor margin', () => {
  const target = { x: 94, y: 0 }, fixture = snapshotFixture({ receiver: target, target });
  const origin = worldPoint({ x: 83, y: -26 });
  Object.assign(fixture.snapshot.players.find(p => p.id === OWNER_ID), origin);
  fixture.snapshot.ball.x = origin.x; fixture.snapshot.ball.y = origin.y;
  for (const p of fixture.snapshot.players.filter(p => p.teamId === 'opp')) Object.assign(p, worldPoint({ x: 80, y: 29 }));
  const live = serviceAttachment(target, { type: 'cross', crossKind: 'early', flightType: 'cross', reason: 'wide-final-third-early-cross' });
  const frame = runTick(live, fixture.snapshot), race = frame.cpu.you.telemetry.passReceiverRace;
  assert.equal(race.maximumContactHeightMetres, 2.65);
  assert.equal(race.requiredMarginTicks, 6);
  assert.equal(race.genuineSwitch, false);
  assert.ok(Math.abs(race.launchLiftAngleDeg - 28) < 1);
  assert.ok(race.accepted, JSON.stringify(race));
});

test('a deliberate cross can target1.25m inside the byline and still clears the full MR interception race',()=>{
 const target={x:105,y:0},receiver={x:103.75,y:0},fixture=snapshotFixture({receiver,target});
 const origin=worldPoint({x:83,y:-26});
 Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),origin);
 Object.assign(fixture.snapshot.ball,{x:origin.x,y:origin.y});
 for(const p of fixture.snapshot.players.filter(p=>p.teamId==='opp'))Object.assign(p,worldPoint({x:80,y:29}));
 const frame=runTick(serviceAttachment(target,{type:'cross',crossKind:'byline',flightType:'cross',reason:'wide-final-third-byline-cross'}),fixture.snapshot);
 const intent=frame.hostProjection.intelligence.find(p=>p.playerId===OWNER_ID),race=frame.cpu.you.telemetry.passReceiverRace;
 assert.equal(race.accepted,true,JSON.stringify(race));assert.equal(race.requiredMarginTicks,6);
 assert.equal(race.boundaryRetarget.marginMetres,1.25);assert.deepEqual(intent.target,worldPoint(receiver));
});

test('a real covered cutback remains rejected while a checked short outlet or free byline approach keeps the attack alive',()=>{
 const c=JSON.parse(readFileSync(new URL('./fixtures/covered-byline-cutback.json',import.meta.url),'utf8'));
 const team=c.snapshot.players.find(p=>p.id===c.passerId).teamId;
 const cpu={...CPU,decide(...args){const d=CPU.decide(...args);if(args[0].teamId!==team)return d;
  const plan=d.carrierIntent,wideDriveOption=plan.wideDriveOption||(plan.reason==='wide-carrier-drive-for-byline'?plan:null);
  assert.ok(wideDriveOption,'the real V2 planner finds a free approach from this captured geometry');
  return {...d,carrierIntent:{...c.intent,wideDriveOption,bylineHoldOption:plan.bylineHoldOption}};
 }};
 const live=Adapter.createAttachment({enabled:true,capability:capability('cpu-v-cpu'),seed:1,
  dependencies:{ball:Ball,movement:Movement,cpu,formation:Formation,contact:Contact,dribbling:Dribbling},
  host:{prepareTick:()=>({commit(){},rollback(){}})}});
 const frame=runTick(live,c.snapshot),race=frame.cpu[team].telemetry.passReceiverRace,intent=frame.cpu[team].carrierIntent;
 assert.equal(race.accepted,false);assert.ok(race.opponentContactTick<race.receiverContactTick);assert.ok(race.marginTicks<0,'the full MR projection must still show the interception');
 assert.equal(intent.type,'carry');assert.equal(intent.reason,'wide-carrier-drive-for-byline');assert.equal(intent.target.x,1.25);
 assert.ok(!intent.knockOn,'the final approach keeps close control instead of launching a long free roll');
 assert.notEqual(frame.dribbling.releasedAction?.type,'pass','the rejected cutback is never released');
});

test('pressured CPU service creates V2 headers and volleys at physical contact, including defensive contests, without host aerial authority', () => {
  for (const [height, defending] of [[2.05, false], [.8, false], [2.05, true]]) {
    const target = { x: 94, y: 0 }, fixture = snapshotFixture({ receiver: target, target });
    const origin = worldPoint({x:target.x+(height<1.05?.45:.15),y:target.y});
    for (const p of fixture.snapshot.players.filter(p => p.teamId === 'opp')) Object.assign(p, worldPoint({ x: 80, y: 28 }));
    if(!defending)Object.assign(fixture.snapshot.players.find(p=>p.id==='opp-LCB'),worldPoint({x:94,y:1.7}));
    if (defending) {
      const defender = fixture.snapshot.players.find(p => p.id === 'opp-LCB');
      Object.assign(defender, worldPoint({ x: 94.25, y: 0 })); Object.assign(defender.attrs, { heading: 99, jumping: 99, awareness: 99 });
      Object.assign(fixture.snapshot.players.find(p => p.id === RECEIVER_ID), worldPoint({ x: 95.5, y: 0 }));
    }
    fixture.snapshot.ball = { ...fixture.snapshot.ball, ...origin, z: height * UNITS.zPerMetre, ownerId: null,
      targetId: RECEIVER_ID, lastKickerId: OWNER_ID, lastKickerTeamId: 'you', flightType: 'cross',
      launchIntent: { sequence: 'physical-service-fixture', sourcePlayerId: OWNER_ID, sourceTeamId: 'you',
        targetPlayerId: RECEIVER_ID, origin: { ...origin, z: height * UNITS.zPerMetre }, target: origin,
        direction: { x: 1, y: 0 }, speedMetresPerSecond: .05, liftAngleDeg: 0, sideSpinRpm: 0, topSpinRpm: 0, source: 'cross' } };
    const live = attachment('cpu-v-cpu', target);
    let snapshot = fixture.snapshot, contact; const trace = [];
    for (let tick = 1; tick <= 24; tick++) {
      const frame = runTick(live, snapshot);
      trace.push({tick,z:frame.hostProjection.ball?.z,status:frame.hostProjection.contact.status,p:frame.hostProjection.possession,reason:frame.hostProjection.contact.presentation,detail:frame.hostProjection.contact.detail});
      assert.equal(frame.hostProjection.contact.suppressLegacy.aerialDuel, true,JSON.stringify({height,defending,tick,c:frame.hostProjection.contact,p:frame.hostProjection.possession}));
      if (frame.hostProjection.contact.contactType === 'aerial-volley') { contact = frame.hostProjection.contact; break; }
      snapshot = advanceFlightSnapshot(snapshot, frame);
      snapshot.ball.launchIntent = null;
    }
    assert.ok(contact, JSON.stringify({height,defending,trace}));
    assert.ok((height>1.05?['header','volley']:['volley']).includes(contact.presentation.technique));
    if(contact.presentation.technique==='volley')assert.ok(contact.ballState.position.z<=1.55,'waiting for a volley must reach the real boot window');
    assert.equal(contact.presentation.outcome, 'contact', JSON.stringify(contact.presentation));
    assert.equal(contact.presentation.intent, defending ? 'clear' : 'shoot');
    assert.equal(contact.presentation.playerId, defending ? 'opp-LCB' : RECEIVER_ID);
    assert.equal(contact.ownerCandidateId, null);
  }
});

test('a CPU combination can redirect a real first touch directly into a checked layoff without an ownership frame', () => {
  const target={x:46.55,y:0}, fixture=snapshotFixture({receiver:target,target});
  const outgoingId='you-ST', outgoingTarget={x:44,y:5};
  Object.assign(fixture.snapshot.players.find(p=>p.id===outgoingId),worldPoint(outgoingTarget));
  const base=forcedPassCpu(target), cpu={...base,decide(snapshot,memory,options){
    const d=base.decide(snapshot,memory,options);
    return {...d,firstTimeIntent:snapshot.teamId==='you'&&snapshot.inFlight?{
      type:'pass',targetPlayerId:outgoingId,target:outgoingTarget,confidence:.85,supportKind:'support',
      reason:'third-man-layoff',risk:{probability:.05}}:null};
  }};
  const live=Adapter.createAttachment({enabled:true,capability:capability('cpu-v-cpu'),seed:201020,
    dependencies:{ball:Ball,movement:Movement,cpu,formation:Formation,contact:Contact,dribbling:Dribbling},
    host:{prepareTick:()=>({commit(){},rollback(){}})}});
  const initial=runTick(live,fixture.snapshot);
  let snapshot=launchSnapshotFromAcceptedPass(fixture,initial),found;
  Object.assign(snapshot.players.find(p=>p.id===RECEIVER_ID),{...worldPoint({x:35.2,y:0}),vx:0,vy:0});
  for(let i=0;i<160;i++){
    const frame=runTick(live,snapshot),pass=frame.hostProjection.contact?.presentation?.firstTimePass;
    if(pass){found=frame;break;}
    snapshot=advanceFlightSnapshot(snapshot,frame);snapshot.ball.launchIntent=null;
  }
  assert.ok(found,'the incoming flight must reach a physical first-touch contact');
  assert.equal(found.hostProjection.contact.ownerCandidateId,null);
  assert.equal(found.hostProjection.possession.ownerId,null);
  assert.equal(found.hostProjection.possession.intendedReceiverId,outgoingId);
  assert.equal(found.hostProjection.contact.presentation.firstTimePass.passRace.accepted,true);
  assert.ok(Math.hypot(found.hostProjection.ball.vx,found.hostProjection.ball.vy)>0);
});

test('every high-ball flight type admits both teams to a rated physical aerial contest', () => {
  for(const flightType of ['long-pass','over-the-top-through','switch','clearance','goal-kick','cross']){
    const target={x:94,y:0},fixture=snapshotFixture({receiver:target,target}),origin=worldPoint({x:94.05,y:0});
    for(const p of fixture.snapshot.players.filter(p=>p.teamId==='opp'))Object.assign(p,worldPoint({x:80,y:28}));
    const defender=fixture.snapshot.players.find(p=>p.id==='opp-LCB');
    Object.assign(defender,worldPoint({x:94.5,y:0}));Object.assign(defender.attrs,{heading:99,jumping:99,strength:99,awareness:99});
    const sourceId=flightType==='goal-kick'?'you-GK':OWNER_ID;
    fixture.snapshot.ball={...fixture.snapshot.ball,...origin,z:2.05*UNITS.zPerMetre,ownerId:null,
      targetId:flightType==='clearance'||flightType==='goal-kick'?null:RECEIVER_ID,lastKickerId:sourceId,lastKickerTeamId:'you',flightType,
      launchIntent:{sequence:'all-high-'+flightType,sourcePlayerId:sourceId,sourceTeamId:'you',targetPlayerId:flightType==='clearance'||flightType==='goal-kick'?null:RECEIVER_ID,
        origin:{...origin,z:2.05*UNITS.zPerMetre},target:origin,direction:{x:1,y:0},speedMetresPerSecond:.05,liftAngleDeg:0,sideSpinRpm:0,topSpinRpm:0,source:flightType}};
    const live=attachment('cpu-v-cpu',target);let snapshot=fixture.snapshot,duel;
    for(let tick=1;tick<=16;tick++){
      const frame=runTick(live,snapshot);
      if(frame.hostProjection.contact?.presentation?.duel){duel=frame.hostProjection.contact.presentation.duel;break;}
      snapshot=advanceFlightSnapshot(snapshot,frame);
    }
    assert.ok(duel,flightType+' never reached V2 aerial contact');
    assert.equal(duel.contested,true,flightType+': '+JSON.stringify(duel));
    assert.ok(['you','opp'].includes(duel.winnerTeamId),flightType+': '+JSON.stringify(duel));
    assert.ok([RECEIVER_ID,'opp-LCB'].includes(duel.winnerId));
  }
});
test('high-ball movement sends one reachable challenger per team and drops defensive cover behind the landing point',()=>{
  const target={x:60,y:0},fixture=snapshotFixture({receiver:{x:55,y:0},target});
  Object.assign(fixture.snapshot.players.find(p=>p.id==='opp-LCB'),worldPoint({x:65,y:0}),{fx:1,fy:0});
  Object.assign(fixture.snapshot.players.find(p=>p.id==='opp-RCB'),worldPoint({x:72,y:8}),{fx:1,fy:0});
  const origin=worldPoint(target);
  fixture.snapshot.ball={...fixture.snapshot.ball,...origin,z:8*UNITS.zPerMetre,vz:0,ownerId:null,targetId:null,
    lastKickerId:OWNER_ID,lastKickerTeamId:'you',flightType:'long-pass',launchIntent:{sequence:'landing-cover',sourcePlayerId:OWNER_ID,sourceTeamId:'you',
    targetPlayerId:null,origin:{...origin,z:8*UNITS.zPerMetre},target:origin,direction:{x:1,y:0},speedMetresPerSecond:1,liftAngleDeg:0,sideSpinRpm:0,topSpinRpm:0,source:'long-pass'}};
  const live=attachment('cpu-v-cpu',target),frame=runTick(live,fixture.snapshot);
  const rows=frame.hostProjection.recoveryAssignments,challengers=rows.filter(p=>p.authority==='v2-high-ball-contest');
  assert.equal(challengers.length,2);assert.equal(new Set(challengers.map(p=>p.teamId)).size,2);
  assert.equal(challengers.find(p=>p.teamId==='opp').playerId,'opp-LCB');
  const cover=rows.find(p=>p.playerId==='opp-RCB'&&p.authority==='v2-high-ball-cover');assert.ok(cover);
  assert.ok(cover.target.x>=challengers.find(p=>p.teamId==='opp').target.x+5.5);
  const saved=live.exportState(),resumed=attachment('cpu-v-cpu',target);assert.equal(resumed.restoreState(saved),true);
  const next=advanceFlightSnapshot(fixture.snapshot,frame);
  const nextFrame=runTick(live,next);
  assert.deepEqual(runTick(resumed,next).hostProjection,nextFrame.hostProjection);
  const invalid=structuredClone(saved);
  invalid.domain.aerialFlight.trajectory[0].x='invalid';
  assert.equal(attachment('cpu-v-cpu',target).restoreState(withValidChecksum(invalid)),false);
  let moving=advanceFlightSnapshot(next,nextFrame);
  for(let i=0;i<40;i++)moving=advanceFlightSnapshot(moving,runTick(live,moving));
  assert.ok(moving.players.find(p=>p.id==='opp-LCB').x<worldPoint({x:65,y:0}).x,
    'the challenger actually travels toward the landing trajectory');
  assert.ok(moving.players.find(p=>p.id==='opp-RCB').x>worldPoint({x:72,y:8}).x,
    'the covering defender actually drops behind rather than only publishing a target');
});

test('an attacker who meets an opposing clearance near goal may finish instead of automatically clearing it',()=>{
  const target={x:94,y:0},fixture=snapshotFixture({receiver:target,target}),origin=worldPoint({x:94.05,y:0});
  for(const p of fixture.snapshot.players.filter(p=>p.teamId==='opp'))Object.assign(p,worldPoint({x:80,y:28}));
  Object.assign(fixture.snapshot.players.find(p=>p.id==='opp-LCB'),worldPoint({x:94,y:1.7}));
  fixture.snapshot.ball={...fixture.snapshot.ball,...origin,z:2.05*UNITS.zPerMetre,ownerId:null,targetId:null,
    lastKickerId:'opp-CAM',lastKickerTeamId:'opp',flightType:'clearance',launchIntent:{sequence:'opposing-clearance-finish',
    sourcePlayerId:'opp-CAM',sourceTeamId:'opp',targetPlayerId:null,origin:{...origin,z:2.05*UNITS.zPerMetre},target:origin,
    direction:{x:1,y:0},speedMetresPerSecond:.05,liftAngleDeg:0,sideSpinRpm:0,topSpinRpm:0,source:'clearance'}};
  const live=attachment('cpu-v-cpu',target);let snapshot=fixture.snapshot,contact;
  for(let tick=1;tick<=36;tick++){
    const frame=runTick(live,snapshot);
    if(frame.hostProjection.contact?.presentation?.duel){contact=frame.hostProjection.contact;break;}
    snapshot=advanceFlightSnapshot(snapshot,frame);
  }
  assert.ok(contact);assert.equal(contact.presentation.playerId,RECEIVER_ID);
  assert.equal(contact.presentation.intent,'shoot');assert.equal(contact.sourceFlight,'clearance');
});

test('an unpressured high-ball receiver can wait for a rated chest absorption instead of heading clear at first reach',()=>{
  let chestFound=false;
  for(const sequence of ['settle-a','settle-b','settle-c','settle-d']){
    const target={x:60,y:0},fixture=snapshotFixture({receiver:target,target}),origin=worldPoint({x:60.05,y:0});
    fixture.snapshot.ball={...fixture.snapshot.ball,...origin,z:2.05*UNITS.zPerMetre,ownerId:null,targetId:RECEIVER_ID,
      lastKickerId:OWNER_ID,lastKickerTeamId:'you',flightType:'long-pass',launchIntent:{sequence,sourcePlayerId:OWNER_ID,sourceTeamId:'you',
      targetPlayerId:RECEIVER_ID,origin:{...origin,z:2.05*UNITS.zPerMetre},target:origin,direction:{x:1,y:0},speedMetresPerSecond:.05,liftAngleDeg:0,sideSpinRpm:0,topSpinRpm:0,source:'long-pass'}};
    const live=attachment('cpu-v-cpu',target);let snapshot=fixture.snapshot,pending=0;
    for(let tick=1;tick<=45;tick++){
      const frame=runTick(live,snapshot),contact=frame.hostProjection.contact;
      if(contact?.status==='aerial-pending'&&contact.consumedAerialIds.length===0)pending++;
      if(contact?.presentation?.duel){
        if(contact.presentation.technique==='chest-control'){
          assert.ok(pending>=5,'the receiver must actually let the ball descend');
          assert.equal(contact.presentation.duel.winnerId,RECEIVER_ID);chestFound=true;
        }
        break;
      }
      snapshot=advanceFlightSnapshot(snapshot,frame);
    }
    if(chestFound)break;
  }
  assert.ok(chestFound,'a reachable, unpressured long ball should admit chest control');
});

test('a physically staggered defender brakes until the skill/contact stagger expires',()=>{
  const held=snapshotFixture({interceptor:{x:65,y:0}}),free=structuredClone(held);
  held.snapshot.players.find(p=>p.id==='opp-LCB').stunTicks=10;
  const heldLive=attachment('cpu-v-cpu',held.target),freeLive=attachment('cpu-v-cpu',free.target);
  runTick(heldLive,held.snapshot);runTick(freeLive,free.snapshot);
  assert.equal(heldLive.exportState().domain.world.players.find(p=>p.id==='opp-LCB').control.mode,'idle');
  assert.notEqual(freeLive.exportState().domain.world.players.find(p=>p.id==='opp-LCB').control.mode,'idle');
});

test('pass races account for a reachable headed interception above foot reception height',()=>{
  let headedInterception=false;
  for(const x of [58,59,60,61,62,63,64]){
    const fixture=snapshotFixture({receiver:{x:65,y:0},target:{x:65,y:0},interceptor:{x,y:0}});
    Object.assign(fixture.snapshot.players.find(p=>p.id==='opp-LCB').attrs,{pace:1,acceleration:1,accel:1,agility:99,jumping:99});
    const frame=runTick(attachment('cpu-v-cpu',fixture.target),fixture.snapshot);
    const intent=frame.hostProjection.intelligence.find(p=>p.playerId===OWNER_ID),race=intent.rejectedPassRace||intent.passRace;
    if(race?.opponentContactHeightMetres>1.45){
      assert.equal(race.accepted,false);assert.equal(race.opponentId,'opp-LCB');headedInterception=true;break;
    }
  }
  assert.ok(headedInterception,'a defender under the lofted trajectory can head it before its foot-height arrival');
});

test('an onside, goal-facing runner may meet a real lofted ball behind the line without the stationary eight-tick wait',()=>{
  const target={x:62,y:0},base=forcedPassCpu(target),cpu={...base,decide(s,m,o){const d=base.decide(s,m,o);if(d.carrierIntent.type==='pass')d.carrierIntent={...d.carrierIntent,supportKind:'in-behind',flightType:'long-pass'};return d;}};
  const {snapshot}=snapshotFixture({receiver:{x:51,y:0},receiverVelocity:{x:7,y:0},target});
  snapshot.teams[0].offsideLine=worldPoint({x:53,y:0}).x;
  const run=attachment('cpu-v-cpu',target,{cpu});
  const frame=run.planTick(snapshot);assert.ok(frame);
  const race=frame.cpu.you.telemetry.passReceiverRace;
  assert.equal(race.movingInBehind,true);assert.equal(race.requiredReceiverReadyBufferTicks,0);
  assert.equal(race.accepted,true,JSON.stringify(race));assert.equal(frame.cpu.you.carrierIntent.supportKind,'in-behind');
  assert.ok(race.launchLiftAngleDeg>0);
});

test('a CPU follows its own frozen-contract knock-on at ordinary full sprint even when a teammate has the shorter recovery race',()=>{
  const {snapshot}=snapshotFixture();const owner=snapshot.players.find(p=>p.id===OWNER_ID),mate=snapshot.players.find(p=>p.id===RECEIVER_ID);
  Object.assign(owner,{x:worldPoint({x:40,y:0}).x,y:worldPoint({x:40,y:0}).y});
  Object.assign(mate,worldPoint({x:48,y:1}));
  Object.assign(snapshot.ball,{ownerId:null,x:worldPoint({x:45,y:0}).x,y:worldPoint({x:45,y:0}).y,vx:10*UNITS.xPerMetre/60,flightType:'directional-knock-on',lastKickerId:OWNER_ID});
  snapshot.dribbling.directionalKnockOnIntent={playerId:OWNER_ID,authority:'live-v2',launchSequence:'jog-1',startX:owner.x,startY:owner.y,
    targetX:worldPoint({x:44,y:0}).x,targetY:owner.y,nx:1,ny:0,distance:4*UNITS.xPerMetre,maximumTravelDistance:20*UNITS.xPerMetre};
  const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=live.planTick(snapshot);assert.ok(frame);
  const row=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===OWNER_ID&&r.authority==='v2-knock-on-chase');assert.ok(row);
  const movement=frame.hostProjection.movement.find(p=>p.id===OWNER_ID);
  assert.ok(movement.vx>0,'the initiator physically accelerates after his touch');
  assert.equal(frame.hostProjection.logicalBallOwnerId,null,'a chase command grants no ownership');
  assert.equal(live.commitTick(frame),true);
  const control=live.exportState().domain.world.players.find(p=>p.id===OWNER_ID).control;
  assert.equal(control.mode,'sprint');assert.equal(control.intensity,1);
  assert.ok(!control.directionalSteering,'an unopposed chase retains ordinary rated steering');
  assert.equal(control.responsivenessMultiplier,1,'shared pursuit receives no responsiveness bonus');
});

test('controlled True Feel leases retain the accepted CPU steering instead of borrowing the neutral-race request',()=>{
 const fixture=snapshotFixture(),live=carryAttachment({x:60,y:0});let snapshot=fixture.snapshot,seen=false;
 for(let tick=1;tick<=72;tick++){
  const frame=runTick(live,snapshot);
  const lease=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===OWNER_ID&&r.authority==='true-feel-lease-recovery');
  if(lease){const control=live.exportState().domain.world.players.find(p=>p.id===OWNER_ID).control;
   assert.ok(!control.directionalSteering,'controlled dribble and passing movement remains on the accepted path');
   assert.equal(control.responsivenessMultiplier,1);seen=true;break;}
  snapshot=advanceFlightSnapshot(snapshot,frame);
 }
 assert.equal(seen,true,'fixture must exercise a real separated controlled touch');
});

test('keeper and woodwork rebounds terminate a travelling shot route and admit both teams to the loose-ball race',()=>{
 for(const flightType of ['keeper-deflection','woodwork-rebound']){
  const {snapshot}=snapshotFixture(),origin=worldPoint({x:62,y:0}),run=attachment('cpu-v-cpu',{x:80,y:0});
  Object.assign(snapshot.ball,{ownerId:null,x:origin.x,y:origin.y,vx:25*UNITS.xPerMetre/60,flightType:'shot',lastKickerId:OWNER_ID,
    launchIntent:{sequence:'shot-rebound-1',sourcePlayerId:OWNER_ID,sourceTeamId:'you',origin:{...origin,z:1},target:worldPoint({x:105,y:0}),direction:{x:1,y:0},speedMetresPerSecond:25,liftAngleDeg:0,source:'shot',targetPlayerId:null}});
  const shot=run.planTick(snapshot);assert.ok(shot);assert.ok(run.commitTick(shot));
  snapshot.tick=2;Object.assign(snapshot.ball,{launchIntent:null,flightType,vx:-8*UNITS.xPerMetre/60,z:0,zv:0,lastKickerId:flightType==='keeper-deflection'?'opp-GK':OWNER_ID});
  const rebound=run.planTick(snapshot);assert.ok(rebound);
  assert.equal(rebound.hostProjection.possession.inFlight,false);
  const teams=new Set(rebound.hostProjection.recoveryAssignments.filter(r=>r.authority==='v2-loose-ball-recovery').map(r=>r.teamId));
  assert.deepEqual([...teams].sort(),['opp','you']);
 }
});

test('pre-release movement honours the curved onside run target before using its beyond-line continuation',()=>{
 const {snapshot}=snapshotFixture({receiver:{x:48,y:0}}),base=forcedPassCpu({x:70,y:0});
 snapshot.teams[0].offsideLine=worldPoint({x:53,y:0}).x;
 const cpu={...base,decide(s,m,o){const d=base.decide(s,m,o);if(s.teamId==='you'){d.carrierIntent={type:'wait',target:null,targetPlayerId:null,reason:'hold-kick-for-run'};d.runs=[{playerId:RECEIVER_ID,target:{x:51,y:8},continuationTarget:{x:70,y:0}}];d.supportIntents=d.supportIntents.filter(p=>p.playerId!==RECEIVER_ID);}return d;}};
 const run=attachment('cpu-v-cpu',{x:70,y:0},{cpu});let f;
 for(let tick=1;tick<=12;tick++){
  snapshot.tick=tick;f=run.planTick(snapshot);assert.ok(f);assert.ok(run.commitTick(f));
  for(const p of f.hostProjection.movement)Object.assign(snapshot.players.find(q=>q.id===p.id),p);
 }
 const receiver=f.hostProjection.movement.find(p=>p.id===RECEIVER_ID);
 assert.ok(receiver.vy>0,'the runner curves along the onside route instead of blindly chasing the far endpoint');
 assert.ok(receiver.x<snapshot.teams[0].offsideLine);
});

test('own-third backward and square outlets cannot use a window shortcut or a covered receiver',()=>{
 for(const receiver of [{x:26,y:0},{x:34,y:12}]){
  const fixture=snapshotFixture({receiver,target:receiver,interceptor:{x:receiver.x+1,y:receiver.y+.5}});
  const frame=runTick(attachment('cpu-v-cpu',fixture.target,{cpu:forcedShortSupportCpu(fixture.target)}),fixture.snapshot);
  const race=frame.cpu.you.telemetry.passReceiverRace;
  assert.equal(race.lightweight,undefined);
  assert.equal(race.safetyCritical,true);assert.equal(race.accepted,false,JSON.stringify(race));
  assert.notEqual(frame.hostProjection.intelligence.find(p=>p.playerId===OWNER_ID)?.targetPlayerId,RECEIVER_ID);
 }
 const fixture=snapshotFixture({receiver:{x:26,y:12},target:{x:26,y:12}});
 const frame=runTick(attachment('cpu-v-cpu',fixture.target,{cpu:forcedShortSupportCpu(fixture.target)}),fixture.snapshot);
 const race=frame.cpu.you.telemetry.passReceiverRace;
 assert.equal(race.accepted,true,JSON.stringify(race));assert.equal(race.requiredMarginTicks,20);
 assert.ok(race.receiverSpaceMetres>=3.5);assert.ok(race.launchSpeedMetresPerSecond>=14);
 assert.ok(race.receiverContactTick>race.ballArrivalTick,'broad window entry is not credited as boot contact');
 assert.ok(race.projectedFlightTicks>=race.receiverContactTick+race.requiredMarginTicks,
   'the simulation covers the complete safety margin instead of stopping after the ordinary six ticks');
});

test('the live keeper shares checked short outlets and clears when every receiver is covered',()=>{
 const {snapshot}=snapshotFixture(),keeper=snapshot.players.find(p=>p.id==='you-GK');
 Object.assign(keeper,worldPoint({x:5,y:0}));
 snapshot.ball={...snapshot.ball,...worldPoint({x:5,y:0}),ownerId:keeper.id,z:0};
 const mates=snapshot.players.filter(p=>p.teamId==='you'&&!p.isGK),foes=snapshot.players.filter(p=>p.teamId==='opp'&&!p.isGK);
 for(const [i,p]of mates.entries())Object.assign(p,worldPoint({x:14+i*.4,y:-6+i}));
 for(const [i,p]of foes.entries())Object.assign(p,worldPoint({x:14+i*.4+.5,y:-6+i+.3}));
 const live=attachment('cpu-v-cpu',{x:26,y:0}),before=live.exportState();
 const blocked=live.planKeeperExit(snapshot,keeper.id);
 assert.equal(blocked.type,'clearance',JSON.stringify(blocked));assert.equal(blocked.targetPlayerId,null);
 assert.ok(blocked.target.x>keeper.x);assert.deepEqual(live.exportState(),before,'planning never grants keeper/distribution ownership');
 Object.assign(mates[0],worldPoint({x:16,y:18}));
 const safe=live.planKeeperExit(snapshot,keeper.id);
 assert.equal(safe.type,'pass',JSON.stringify(safe));assert.equal(safe.targetPlayerId,mates[0].id);
 assert.equal(safe.passRace.accepted,true);assert.equal(safe.passRace.ownThird,true);assert.equal(safe.passRace.safetyCritical,true);
 assert.ok(safe.passRace.launchSpeedMetresPerSecond>=14);
});

test('a fast receiver moving away from a feet rendezvous must brake and return before being counted ready',()=>{
 const target={x:48,y:0},fixture=snapshotFixture({receiver:target,target,receiverVelocity:{x:8,y:0}});
 const frame=runTick(attachment('cpu-v-cpu',target),fixture.snapshot),race=frame.cpu.you.telemetry.passReceiverRace;
 assert.equal(race.accepted,false,JSON.stringify(race));
 assert.ok(race.receiverEtaAtArrivalTick>0||race.receiverContactTick===null,JSON.stringify(race));
 const stationary=snapshotFixture({receiver:target,target});
 assert.equal(runTick(attachment('cpu-v-cpu',target),stationary.snapshot).cpu.you.telemetry.passReceiverRace.accepted,true);
});

test('a rejected forward run cannot become a backward feet pass under the original run instruction',()=>{
 const target={x:58,y:0},fixture=snapshotFixture({receiver:{x:26,y:0},target,receiverVelocity:{x:4,y:0}});
 const frame=runTick(attachment('cpu-v-cpu',target),fixture.snapshot);
 const intent=frame.cpu.you.carrierIntent;
 assert.notEqual(intent.reason,'forced-pass-race-fixture');
 assert.notEqual(intent.rendezvousCorrection?.kind,'receiver-feet');
 assert.equal(frame.cpu.you.telemetry.passReceiverRace.accepted,false);
});

test('CPU throw-ins check the real ball flight and receiver pressure before choosing a short exit',()=>{
 const {snapshot}=snapshotFixture({receiver:{x:32,y:-25}}),owner=snapshot.players.find(p=>p.id===OWNER_ID);
 Object.assign(owner,worldPoint({x:25,y:-34.8}));
 for(const p of snapshot.players)if(p.teamId==='you'&&p.id!==OWNER_ID&&p.id!==RECEIVER_ID)Object.assign(p,worldPoint({x:55,y:20}));
 Object.assign(snapshot.ball,{...worldPoint({x:25,y:-33.6}),ownerId:null,z:50});
 const run=attachment('cpu-v-cpu',{x:32,y:-25}),before=run.exportState();
 const safe=run.planRestartThrow(snapshot,OWNER_ID);
 assert.equal(safe.reason,'checked-throw-free-receiver',JSON.stringify(safe));assert.equal(safe.targetPlayerId,RECEIVER_ID);
 assert.equal(safe.passRace.accepted,true);assert.equal(safe.passRace.ownThird,true);assert.equal(safe.passRace.safetyCritical,false);assert.ok(safe.throwProfile.liftAngleDeg>0);
 assert.deepEqual(run.exportState(),before,'restart planning grants no control or commit');
 Object.assign(snapshot.players.find(p=>p.id==='opp-LCB'),worldPoint({x:32.5,y:-25}));
 const crowded=run.planRestartThrow(snapshot,OWNER_ID);
 assert.equal(crowded.reason,'named-throw-contested-receiver');assert.equal(crowded.targetPlayerId,RECEIVER_ID);assert.equal(crowded.passRace.accepted,false);
 assert.ok(crowded.target.x>owner.x);
});

test('checked CPU throws reach the free rendezvous through actual MR flight across the legal short range',()=>{
 for(const distance of [4.5,5,6,8,10,12,14,16,17.2]){
  const origin={x:25,y:-33.6},inward=Math.min(distance,4.6),target={x:25+Math.sqrt(distance*distance-inward*inward),y:origin.y+inward};
  const {snapshot}=snapshotFixture({receiver:target}),owner=snapshot.players.find(p=>p.id===OWNER_ID);
  Object.assign(owner,worldPoint({x:25,y:-34.8}));
  for(const p of snapshot.players)if(p.teamId==='you'&&p.id!==OWNER_ID&&p.id!==RECEIVER_ID)Object.assign(p,worldPoint({x:65,y:20}));
  Object.assign(snapshot.ball,{...worldPoint(origin),ownerId:null,z:50});
  const intent=attachment('cpu-v-cpu',target).planRestartThrow(snapshot,OWNER_ID);
  assert.equal(intent.targetPlayerId,RECEIVER_ID,JSON.stringify({distance,intent}));
  const profile=intent.throwProfile;
  let state=Ball.resolveLaunch({id:'physical-throw-range',origin:{...origin,z:50/30+.11},
    direction:{x:target.x-origin.x,y:target.y-origin.y},speed:profile.speed,liftAngleDeg:profile.liftAngleDeg,source:'throw-in'}).state;
  let context=Ball.createSimulationContext({seed:1}),left=profile.flightSeconds;
  while(left>1e-9){const dt=Math.min(.2,left),next=Ball.step(state,context,dt,{});state=next.state;context=next.context;left-=dt;}
  assert.ok(Math.hypot(state.position.x-target.x,state.position.y-target.y)<.02,JSON.stringify({distance,position:state.position,target}));
  assert.ok(Math.abs(state.position.z-profile.targetHeightMetres)<.02,JSON.stringify({distance,position:state.position}));
 }
});

// Midfield circulation must not inherit the emergency own-third policy.
test('a clean midfield backward link keeps the real interception check with a distance-scaled margin',()=>{
 const target={x:42,y:0},fixture=snapshotFixture({receiver:target,target});
 Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),worldPoint({x:55,y:0}));
 Object.assign(fixture.snapshot.ball,worldPoint({x:55,y:0}));
 const race=runTick(attachment('cpu-v-cpu',target),fixture.snapshot).cpu.you.telemetry.passReceiverRace;
 assert.equal(race.accepted,true,JSON.stringify(race));assert.equal(race.safetyCritical,false);
 assert.equal(race.requiredMarginTicks,4);assert.equal(race.requiredReceiverReadyBufferTicks,4);
 assert.ok(race.projectedFlightTicks>0);
});
test('V2 throw support offers distinct feet, line, back and inside routes without moving bodies',()=>{
 const {snapshot}=snapshotFixture(),owner=snapshot.players.find(p=>p.id===OWNER_ID);
 Object.assign(owner,worldPoint({x:40,y:-34.8}));const original=structuredClone(snapshot);
 const routes=attachment('cpu-v-cpu',{x:50,y:0}).planRestartThrowSupport(snapshot,OWNER_ID);
 assert.equal(routes.length,4);assert.equal(new Set(routes.map(r=>r.playerId)).size,4);
 assert.deepEqual(routes.map(r=>r.role),['throw-short-feet','throw-line-run','throw-back-support','throw-inside-link']);
 assert.ok(routes.some(r=>r.target.x<owner.x));assert.ok(routes.some(r=>r.target.x>owner.x));
 assert.deepEqual(snapshot,original);
});

test('a temporary receiver lock is checked at MR arrival rather than rejecting the entire next combination',()=>{
 const target={x:42,y:0},fixture=snapshotFixture({receiver:target,target});
 const receiver=fixture.snapshot.players.find(p=>p.id===RECEIVER_ID);
 receiver.contactEligible=false;receiver.contactLockTicks=12;
 const admitted=runTick(attachment('cpu-v-cpu',target),structuredClone(fixture.snapshot)).cpu.you.telemetry.passReceiverRace;
 assert.equal(admitted.accepted,true,JSON.stringify(admitted));assert.ok(admitted.receiverContactTick>=12);
 receiver.contactLockTicks=180;
 const locked=runTick(attachment('cpu-v-cpu',target),structuredClone(fixture.snapshot)).cpu.you.telemetry.passReceiverRace;
 assert.equal(locked.accepted,false,'a lock extending beyond the playable meeting still rejects the pass');
 receiver.contactLockTicks=0;
 const unavailable=runTick(attachment('cpu-v-cpu',target),fixture.snapshot).cpu.you.telemetry.passReceiverRace;
 assert.equal(unavailable.accepted,false);assert.equal(unavailable.reason,'receiver-ineligible');
});

test('a prepared close midfield link keeps its MR check while overlapping and own-third micro passes remain rejected',()=>{
 const target={x:49.5,y:0},fixture=snapshotFixture({receiver:target,target});
 Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),worldPoint({x:45,y:0}));
 Object.assign(fixture.snapshot.ball,worldPoint({x:45,y:0}));
 const safe=runTick(attachment('cpu-v-cpu',target),structuredClone(fixture.snapshot)).cpu.you.telemetry.passReceiverRace;
 assert.equal(safe.accepted,true,JSON.stringify(safe));assert.ok(safe.projectedFlightTicks>0);assert.equal(safe.distanceMetres,4.5);
 Object.assign(fixture.snapshot.players.find(p=>p.teamId==='opp'&&!p.isGK),worldPoint({x:47,y:0}));
 const covered=runTick(attachment('cpu-v-cpu',target),fixture.snapshot).cpu.you.telemetry.passReceiverRace;
 assert.equal(covered.accepted,false,'the shorter distance never bypasses a real interceptor');
 const own=snapshotFixture({receiver:{x:24.5,y:0},target:{x:24.5,y:0}});
 Object.assign(own.snapshot.players.find(p=>p.id===OWNER_ID),worldPoint({x:20,y:0}));Object.assign(own.snapshot.ball,worldPoint({x:20,y:0}));
 const ownRace=runTick(attachment('cpu-v-cpu',{x:24.5,y:0}),own.snapshot).cpu.you.telemetry.passReceiverRace;
 assert.equal(ownRace.accepted,false);assert.equal(ownRace.safetyCritical,true);assert.equal(ownRace.reason,'pass-distance-below-control-threshold');
});

test('contested neutral recovery requests the shared pursuit while a remote opponent leaves receiving movement unchanged',()=>{
 for(const contested of [false,true]){
  const {snapshot}=snapshotFixture();const ball=worldPoint({x:45,y:0});
  for(const p of snapshot.players.filter(p=>p.teamId==='you'))Object.assign(p,worldPoint({x:20,y:-20}));
  const actor=snapshot.players.find(p=>p.id===OWNER_ID);Object.assign(actor,worldPoint({x:41,y:0}));
  const opponent=snapshot.players.find(p=>p.teamId==='opp'&&!p.isGK);Object.assign(opponent,worldPoint({x:contested?48:80,y:0}));
  Object.assign(snapshot.ball,{ownerId:null,targetId:null,x:ball.x,y:ball.y,vx:0,vy:0,z:0,zv:0,flightType:'ground'});
  const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=runTick(live,snapshot);
  const row=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===OWNER_ID&&r.authority==='v2-loose-ball-recovery');assert.ok(row);
  const control=live.exportState().domain.world.players.find(p=>p.id===OWNER_ID).control;
  assert.equal(!!control.directionalSteering,contested);
  if(contested){assert.equal(control.mode,'sprint');assert.equal(control.intensity,1);}
  assert.equal(control.responsivenessMultiplier,1);
 }
});

test('opponents chasing a descending clearance keep urgent shared pursuit instead of aerial walk-turn braking',()=>{
 const {snapshot}=snapshotFixture();
 for(const p of snapshot.players)Object.assign(p,worldPoint({x:p.teamId==='you'?15:80,y:25}));
 const actor=snapshot.players.find(p=>p.id===OWNER_ID),opponent=snapshot.players.find(p=>p.teamId==='opp'&&!p.isGK);
 for(const [p,y]of [[actor,-.4],[opponent,.4]])Object.assign(p,worldPoint({x:96,y}),{vx:2*UNITS.xPerMetre/60,vy:0,fx:1,fy:0});
 const point=worldPoint({x:95,y:0});Object.assign(snapshot.ball,{ownerId:null,targetId:null,...point,z:.8*UNITS.zPerMetre,
  vx:-.5*UNITS.xPerMetre/60,vy:0,zv:-2*UNITS.zPerMetre/60,flightType:'clearance',launchIntent:null});
 const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=runTick(live,snapshot);
 for(const id of [actor.id,opponent.id]){
  const row=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===id&&r.authority==='v2-high-ball-contest');assert.ok(row);
  const control=live.exportState().domain.world.players.find(p=>p.id===id).control;
  assert.equal(control.mode,'sprint');assert.equal(control.intensity,1);assert.equal(control.directionalSteering,true);
  assert.ok(Number.isSafeInteger(row.predictedInterceptTick));
 }
});

test('a knock-on chase predicts a real meeting after the source boot lock rather than chasing its current spot',()=>{
 const {snapshot}=snapshotFixture(),actor=snapshot.players.find(p=>p.id===OWNER_ID);
 Object.assign(actor,worldPoint({x:45,y:0}),{vx:7.7*UNITS.xPerMetre/60,fx:1,fy:0,contactEligible:false,contactLockTicks:14});
 const origin=worldPoint({x:45.4,y:0});Object.assign(snapshot.ball,{ownerId:null,targetId:OWNER_ID,...origin,z:0,vx:15*UNITS.xPerMetre/60,vy:0,zv:0,flightType:'directional-knock-on'});
 snapshot.dribbling.directionalKnockOnIntent={playerId:OWNER_ID,authority:'live-v2',launchSequence:'locked-source',startX:origin.x,startY:origin.y,
  targetX:origin.x+5.5*UNITS.xPerMetre,targetY:origin.y,nx:1,ny:0,distance:5.5*UNITS.xPerMetre,maximumTravelDistance:30*UNITS.xPerMetre};
 const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=runTick(live,snapshot);
 const row=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===OWNER_ID&&r.authority==='v2-knock-on-chase');assert.ok(row);
 assert.ok(row.predictedInterceptTick>=snapshot.tick+14);assert.ok(row.target.x>45.4);
 assert.equal(live.exportState().domain.world.players.find(p=>p.id===OWNER_ID).control.mode,'sprint');
});

test('a distant protected skill cannot gate the physical loose-ball contact of either opponent',()=>{
 for(const team of ['you','opp']){
  const {snapshot}=snapshotFixture(),actor=snapshot.players.find(p=>p.teamId===team&&!p.isGK),remote=snapshot.players.find(p=>p.teamId!==team&&!p.isGK);
  for(const p of snapshot.players)Object.assign(p,worldPoint({x:15,y:25}));
  Object.assign(actor,worldPoint({x:45,y:0}),{fx:1,fy:0,vx:0,vy:0});Object.assign(remote,worldPoint({x:80,y:-25}));
  const point=worldPoint({x:45.55,y:0});Object.assign(snapshot.ball,{ownerId:null,targetId:null,...point,z:0,vx:0,vy:0,zv:0,flightType:'ground'});
  snapshot.contact.gate.specialActionAuthority=true;snapshot.dribbling.specialActionPlayerIds=[remote.id];
  const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=runTick(live,snapshot);
  const contact=frame.hostProjection.contact;
  assert.equal(contact?.ownedContact,true,JSON.stringify(contact));assert.equal(contact.presentation.playerId,actor.id);
 }
});
test('the host-protected skill actor stays excluded while another player can physically collect the same loose ball',()=>{
 const {snapshot}=snapshotFixture(),protectedActor=snapshot.players.find(p=>p.id===OWNER_ID),actor=snapshot.players.find(p=>p.teamId==='opp'&&!p.isGK);
 for(const p of snapshot.players)Object.assign(p,worldPoint({x:15,y:25}));
 Object.assign(protectedActor,worldPoint({x:45,y:0}),{fx:1,fy:0});Object.assign(actor,worldPoint({x:46,y:0}),{fx:-1,fy:0});
 const point=worldPoint({x:45.5,y:0});Object.assign(snapshot.ball,{ownerId:null,targetId:null,...point,z:0,vx:0,vy:0,zv:0,flightType:'ground'});
 snapshot.contact.gate.specialActionAuthority=true;snapshot.dribbling.specialActionPlayerIds=[protectedActor.id];
 const live=attachment('cpu-v-cpu',{x:55,y:0}),frame=runTick(live,snapshot),contact=frame.hostProjection.contact;
 assert.equal(contact?.ownedContact,true,JSON.stringify(contact));assert.equal(contact.presentation.playerId,actor.id);
});

test('a low second-ball race keeps a kick-locked challenger sprinting without granting a second contact',()=>{
 const {snapshot}=snapshotFixture(),source=snapshot.players.find(p=>p.id===OWNER_ID),rival=snapshot.players.find(p=>p.id==='opp-LCB');
 Object.assign(source,worldPoint({x:61.8,y:-30.5}),{contactEligible:false,contactLockTicks:13,vx:0,vy:0});
 Object.assign(rival,worldPoint({x:61,y:-28.6}),{vx:0,vy:-5*UNITS.yPerMetre/60});
 Object.assign(snapshot.ball,worldPoint({x:61.4,y:-30.9}),{ownerId:null,z:.55*UNITS.zPerMetre,zv:.4*UNITS.zPerMetre/60,
  vx:-2*UNITS.xPerMetre/60,vy:-2*UNITS.yPerMetre/60,lastKickerId:OWNER_ID,lastKickerTeamId:'you',flightType:'v2-headed-clearance',launchIntent:null});
 const run=attachment('cpu-v-cpu',{x:80,y:0}),frame=run.planTick(snapshot);assert.ok(frame);assert.equal(run.commitTick(frame),true);
 const own=run.exportState().domain.world.players.find(p=>p.id===OWNER_ID);
 assert.equal(own.control.mode,'sprint','the last toucher can race while his real contact lock expires');
 assert.equal(own.control.intensity,1);assert.equal(own.control.directionalSteering,true);
 assert.notEqual(frame.hostProjection.contact?.ownerCandidateId,OWNER_ID,'pursuit cannot bypass the boot lock');
});

test('rejecting a short own-third pass does not clear when the nearest opponent is eight metres away',()=>{
 const {snapshot}=snapshotFixture({receiver:{x:14,y:0},target:{x:14,y:0},interceptor:{x:14.2,y:0}});
 Object.assign(snapshot.players.find(p=>p.id===OWNER_ID),worldPoint({x:25,y:0}));
 Object.assign(snapshot.players.find(p=>p.id==='opp-RCB'),worldPoint({x:25,y:8}));
 Object.assign(snapshot.ball,worldPoint({x:25,y:0}));
 const cpu={...forcedPassCpu({x:14,y:0}),decide(...args){const d=forcedPassCpu({x:14,y:0}).decide(...args);return {...d,supportPassOptions:[]};}};
 const run=attachment('cpu-v-cpu',{x:14,y:0},{cpu}),frame=run.planTick(snapshot);assert.ok(frame);
 assert.notEqual(frame.cpu.you.carrierIntent.type,'clearance',JSON.stringify(frame.cpu.you.carrierIntent));
 assert.ok(['carry','protect','wait','pass'].includes(frame.cpu.you.carrierIntent.type));
});

test('switch weighting drops through the real MR flight at the authored receiver, at both ends',()=>{
 for(const direction of[1,-1]){
  const x=v=>direction===1?v:105-v,target={x:x(55),y:19},fixture=snapshotFixture({receiver:target,target});
  fixture.snapshot.teams[0].attackingDirection=direction;fixture.snapshot.teams[1].attackingDirection=-direction;
  fixture.snapshot.teams[0].offsideLine=worldPoint({x:x(95),y:0}).x;
  const origin=worldPoint({x:x(55),y:-21});Object.assign(fixture.snapshot.ball,origin);
  Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),origin);
  for(const [i,p]of fixture.snapshot.players.filter(p=>p.teamId==='opp').entries())Object.assign(p,worldPoint({x:x(i<2?60:95),y:i<2?-20+i*3:29}));
  const run=serviceAttachment(target,{supportKind:'switch',reason:'switch-congested-side'}),frame=run.planTick(fixture.snapshot);assert.ok(frame);
  const intent=frame.cpu.you.carrierIntent,race=intent.passRace;assert.equal(intent.type,'pass',JSON.stringify(intent));
  assert.equal(race.accepted,true);assert.ok(race.weightedFlightSeconds>1);
  assert.ok(Math.abs(race.weightedLandingRangeMetres-40)<.5,JSON.stringify(race));
  const launch=Ball.resolveLaunch({id:'actual-checked-switch',origin:{x:x(55),y:-21,z:1/UNITS.zPerMetre+.11},
   direction:{x:0,y:1},speed:race.launchSpeedMetresPerSecond,liftAngleDeg:race.launchLiftAngleDeg,source:'long-pass'});
  let state=launch.state,context=Ball.createSimulationContext({seed:173}),landing;
  for(let t=0;t<180;t+=15){const step=Ball.step(state,context,.25);landing=step.trace.samples.find(p=>p.velocity.z<0&&p.position.z<=.65);
   state=step.state;context=step.context;if(landing)break;}
  assert.ok(landing);assert.ok(Math.abs(landing.position.y-target.y)<.6,JSON.stringify(landing.position));
 }
});

test('a ground through pass uses the real running stride and cannot turn into a loft merely because it is long',()=>{
 const target={x:88,y:0},fixture=snapshotFixture({receiver:{x:76,y:0},receiverVelocity:{x:6,y:0},target});
 const origin=worldPoint({x:59,y:0});Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),origin);Object.assign(fixture.snapshot.ball,origin);
 for(const [i,p]of fixture.snapshot.players.filter(p=>p.teamId==='opp').entries())Object.assign(p,worldPoint({x:i<2?80:103,y:i<2?(i?-12:12):28}));
 const run=serviceAttachment(target,{supportKind:'in-behind',flightType:'ground-pass',reason:'ground-through-ball-in-behind'}),frame=run.planTick(fixture.snapshot);assert.ok(frame);
 const intent=frame.cpu.you.carrierIntent;assert.equal(intent.type,'pass',JSON.stringify(intent));assert.equal(intent.passRace.accepted,true);
 assert.equal(intent.passRace.launchLiftAngleDeg,0);assert.ok(intent.passRace.runnerMeetingSeconds>0);
 assert.ok(intent.target.x>80);assert.ok(intent.target.x<100.5);assert.equal(intent.passRace.movingInBehind,true);
});

test('a closing ground interception can select a separately checked loft to the runner, while an earlier blocker still rejects both',()=>{
 for(const interceptorX of[68,64]){
  const target={x:88,y:0},fixture=snapshotFixture({receiver:{x:76,y:0},receiverVelocity:{x:6,y:0},target});
  const origin=worldPoint({x:59,y:0});Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),origin);Object.assign(fixture.snapshot.ball,origin);
  const opponents=fixture.snapshot.players.filter(p=>p.teamId==='opp');
  for(const[i,p]of opponents.entries())Object.assign(p,worldPoint({x:i<2?80:103,y:i<2?(i?-12:12):28}));
  Object.assign(opponents[1],worldPoint({x:interceptorX,y:0}));
  const run=serviceAttachment(target,{supportKind:'in-behind',flightType:'ground-pass',reason:'ground-through-ball-in-behind'}),frame=run.planTick(fixture.snapshot);
  assert.ok(frame);const intent=frame.cpu.you.carrierIntent;
  if(interceptorX===64){assert.ok(['carry','protect','wait'].includes(intent.type));assert.equal(frame.cpu.you.telemetry.passReceiverRace.accepted,false);continue;}
  const race=intent.passRace;assert.equal(intent.reason,'run-over-the-top');assert.equal(race.accepted,true);
  assert.equal(race.originalRejectedRace.reason,'insufficient-interception-margin');assert.ok(race.launchLiftAngleDeg>0);
  const delta={x:intent.target.x-59,y:intent.target.y},length=Math.hypot(delta.x,delta.y),
    launch=Ball.resolveLaunch({id:'checked-run-loft',origin:{x:59,y:0,z:1/UNITS.zPerMetre+.11},
      direction:{x:delta.x/length,y:delta.y/length},speed:race.launchSpeedMetresPerSecond,liftAngleDeg:race.launchLiftAngleDeg});
  let state=launch.state,context=Ball.createSimulationContext({seed:173}),crossing;
  for(let t=0;t<120&&!crossing;t+=15){const step=Ball.step(state,context,.25);
   crossing=step.trace.samples.find(p=>p.position.x>=interceptorX);state=step.state;context=step.context;}
  assert.ok(crossing);assert.ok(crossing.position.z>race.originalRejectedRace.maximumContactHeightMetres,JSON.stringify(crossing.position));
 }
});

test('a six-tick rejected runner request does not rerun loft weighting while its authored pass is held',()=>{
 const target={x:70,y:18},fixture=snapshotFixture({receiver:{x:65,y:16},receiverVelocity:{x:2,y:1},target,interceptor:{x:68,y:18}});
 const origin=worldPoint({x:50,y:-22});Object.assign(fixture.snapshot.ball,origin);Object.assign(fixture.snapshot.players.find(p=>p.id===OWNER_ID),origin);
 let measurements=0;const ball={...Ball,resolveLaunch(input,...args){if(input.id==='cpu-loft-weight')measurements++;return Ball.resolveLaunch(input,...args);}},base=forcedPassCpu(target);
 const cpu={...base,decide(...args){const d=base.decide(...args);return d.carrierIntent.type==='pass'?{...d,supportPassOptions:[],carrierIntent:{...d.carrierIntent,supportKind:'switch',reason:'switch-congested-side'}}:d;}};
 const run=Adapter.createAttachment({enabled:true,capability:capability('cpu-v-cpu'),seed:201020,
  dependencies:{ball,movement:Movement,cpu,formation:Formation,contact:Contact,dribbling:Dribbling},host:{prepareTick:()=>({commit(){},rollback(){}})}});
 const first=runTick(run,fixture.snapshot);assert.equal(first.cpu.you.telemetry.passReceiverRace.accepted,false);
 assert.ok(measurements>0,'the fresh request must really forecast a moving loft');
 measurements=0;fixture.snapshot.tick=2;const held=runTick(run,fixture.snapshot);
 assert.equal(held.cpu.you.telemetry.passReceiverRace.reason,'rejected-pass-commitment-held');
 assert.equal(measurements,0,'a held rejection has no new ball to weight');
});

test('a real formerly overhit switch keeps its checked feet receiver on the MR rendezvous and reaches physical control',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/overhit-switch-receiver.json',import.meta.url),'utf8'));
 const run=attachment('cpu-v-cpu',{x:70,y:0});let snapshot=fixture.snapshot,contact=null,minimumGap=Infinity,firstTouchTick=null;
 const target={x:(fixture.target.x-snapshot.pitch.xMin)/snapshot.units.xPerMetre,
  y:(fixture.target.y-(snapshot.pitch.yMin+snapshot.pitch.yMax)/2)/snapshot.units.yPerMetre};
 for(let tick=0;tick<180;tick++){
  const frame=runTick(run,snapshot),c=frame.hostProjection.contact,ball=frame.hostProjection.ball,
    player=frame.hostProjection.movement.find(p=>p.id===fixture.receiverId);
  const guide=frame.hostProjection.recoveryAssignments.find(r=>r.playerId===fixture.receiverId&&r.authority==='v2-cpu-reception-guidance');
  if(guide&&frame.hostProjection.possession.meetingContract==='cpu-pass-race-mr-rendezvous-v2')
   assert.ok(Math.hypot(guide.target.x-target.x,guide.target.y-target.y)<.01,'aerial arbitration cannot move an admitted feet rendezvous');
  if(ball&&ball.z/snapshot.units.zPerMetre<1.45)minimumGap=Math.min(minimumGap,Math.hypot((ball.x-player.x)/snapshot.units.xPerMetre,(ball.y-player.y)/snapshot.units.yPerMetre));
  if(c?.presentation?.playerId===fixture.receiverId&&c.ownedContact){firstTouchTick??=tick;if(c.ownerCandidateId===fixture.receiverId||frame.hostProjection.logicalBallOwnerId===fixture.receiverId||c.presentation.firstTimePass){contact={tick,c};break;}}
  snapshot=advanceFlightSnapshot(snapshot,frame);
  for(const p of snapshot.players){p.contactLockTicks=Math.max(0,p.contactLockTicks-1);p.stunTicks=Math.max(0,p.stunTicks-1);if(!p.contactLockTicks&&!p.isGK)p.contactEligible=true;}
 }
 assert.ok(contact,JSON.stringify({minimumGap,firstTouchTick}));assert.ok(firstTouchTick<=110,JSON.stringify({firstTouchTick,controlTick:contact.tick,minimumGap}));assert.ok(contact.tick<=firstTouchTick+45,JSON.stringify({firstTouchTick,controlTick:contact.tick}));
 console.log('SCRIPTED_SWITCH_PROOF',JSON.stringify({firstTouchTick,controlTick:contact.tick,minimumGapMetres:minimumGap,ballRetargeted:false}));
});


test('a long escaping run clears the shared MR check while an early interception stays rejected',()=>{
 const rows=JSON.parse(readFileSync(new URL('./fixtures/behind-pass-interception.json',import.meta.url),'utf8'));
 for(const [index,row]of rows.entries()){
  const cpu={...CPU,decide(snapshot,memory,config){const d=CPU.decide(snapshot,memory,config);
   return snapshot.teamId===snapshot.possessionTeamId?{...d,carrierIntent:row.intent,supportPassOptions:[]}:d;}};
  const frame=runTick(attachment('cpu-v-cpu',row.intent.target,{cpu}),row.snapshot),team=row.snapshot.players.find(p=>p.id===row.snapshot.ball.ownerId).teamId,
   race=frame.cpu[team].telemetry.passReceiverRace;
  assert.equal(race.accepted,index===0,JSON.stringify(race));
  if(index===0){assert.equal(race.ownThird,true);assert.equal(race.safetyCritical,false);assert.ok(race.marginTicks>=race.requiredMarginTicks);}
  else {assert.equal(race.reason,'insufficient-interception-margin');assert.ok(race.opponentTargetGapMetres>30);}
 }
});
