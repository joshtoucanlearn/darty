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
          supportMetrics: supportMetrics ||
            { distance: 242, progress: 120, laneClearance: 120, receiverSpace: 140 }
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
    dependencies: { ball: Ball, movement: Movement, cpu: forcedPassCpu(target), formation: Formation,
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

test('CPU-v-CPU accepts a projected MR pass only when its receiver wins the rated race by six ticks', () => {
  const fixture = snapshotFixture();
  const frame = runTick(attachment('cpu-v-cpu', fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass');
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.equal(intent.passRace.accepted, true);
  assert.equal(intent.passRace.requiredMarginTicks, 6);
  assert.equal(intent.passRace.requiredReceiverReadyBufferTicks, 8);
  assert.ok(intent.passRace.receiverReadyBufferTicks >= 8);
  assert.equal(intent.passRace.reason, 'receiver-arrives-with-six-tick-margin');
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
  assert.ok(['receiver-cannot-arrive', 'trajectory-misses-target-window', 'receiver-arrival-buffer-below-eight-ticks'].includes(unreachableIntent.passRace.reason));

  const contested = snapshotFixture({ interceptor: { x: 55, y: 0 } });
  const contestedFrame = runTick(attachment('cpu-v-cpu', contested.target), contested.snapshot);
  const contestedIntent = contestedFrame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.ok(['carry', 'wait'].includes(contestedIntent.type) ||
    (contestedIntent.type === 'pass' && contestedIntent.reason === 'unsafe-progressive-pass-safe-recycle'));
  assert.notEqual(contestedIntent.targetPlayerId, RECEIVER_ID);
  assert.equal(contestedIntent.fallbackFrom, 'pass');
  assert.equal(contestedIntent.passRace.accepted, false);
  assert.equal(contestedIntent.passRace.reason, 'interception-margin-below-six-ticks');
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
  assert.equal(receiverIntent.passRace.reason, 'receiver-arrives-with-six-tick-margin');

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
  assert.equal(interceptorIntent.passRace.reason, 'interception-margin-below-six-ticks');
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
          assert.equal(contact.ownerCandidateId, RECEIVER_ID, JSON.stringify(contact));
          break;
        }
        assert.notEqual(contact?.ownerCandidateId, RECEIVER_ID,
          `receiver acquired without physical contact at tick ${flightSnapshot.tick}: ${JSON.stringify(contact)}`);
      } else {
        break;
      }
      flightSnapshot = advanceFlightSnapshot(flightSnapshot, flightFrame);
    }
    assert.ok(preArrivalTicks >= 3, `only observed ${preArrivalTicks} pre-arrival ticks`);
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

test('only a rated progressive pass can use the bounded late-arrival risk envelope', () => {
  const fixture = snapshotFixture({ receiver: { x: 48, y: 0 }, target: { x: 55, y: 0 },
    interceptor: { x: 60.8, y: 0 } });
  const high = runTick(riskAttachment(fixture.target, .86), structuredClone(fixture.snapshot));
  const highIntent = high.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(highIntent.type, 'pass', JSON.stringify(highIntent));
  assert.equal(highIntent.targetPlayerId, RECEIVER_ID);
  assert.equal(highIntent.passRace.reason, 'high-confidence-progressive-risk-envelope');
  assert.equal(highIntent.passRace.riskEnvelope.minimumReceiverReadyBufferTicks, -4);
  assert.equal(highIntent.passRace.riskEnvelope.minimumOpponentMarginTicks, -2);
  const low = runTick(riskAttachment(fixture.target, .7), structuredClone(fixture.snapshot));
  const lowIntent = low.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.notEqual(lowIntent.passRace?.reason, 'high-confidence-progressive-risk-envelope');
});

test('a short support pass uses the cheap lane release instead of a 150-tick MR pre-simulation', () => {
  const fixture = snapshotFixture({ receiver: { x: 42, y: 0 }, target: { x: 42, y: 0 } });
  const frame = runTick(shortSupportAttachment(fixture.target), fixture.snapshot);
  const intent = frame.hostProjection.intelligence.find(row => row.playerId === OWNER_ID);
  assert.equal(intent.type, 'pass', JSON.stringify(intent));
  assert.equal(intent.targetPlayerId, RECEIVER_ID);
  assert.equal(intent.passRace.accepted, true);
  assert.equal(intent.passRace.reason, 'short-support-lane-release');
  assert.equal(intent.passRace.projectedFlightTicks, 0);
  assert.equal(intent.passRace.lightweight, true);
  assert.equal(intent.passRace.laneClearanceCanonical, 120);
  assert.equal(intent.passRace.receiverSpaceCanonical, 140);
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
