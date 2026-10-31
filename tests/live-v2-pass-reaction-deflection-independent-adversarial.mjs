import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'match-engine');
const require = createRequire(import.meta.url);
const Movement = require(path.join(engine, 'movement-engine-v2.js'));
const Ball = require(path.join(engine, 'ball-engine-v2.js'));
const Contact = require(path.join(engine, 'live-v2-contact-authority-composer.js'));
const Adapter = require(path.join(engine, 'live-v2-authority-adapter.js'));
const CPU = require(path.join(engine, 'cpu-intelligence-v2.js'));
const Formation = require(path.join(engine, 'formation-behaviour-v2.js'));
const Dribbling = require(path.join(engine, 'dribbling-state-v2.js'));

const composerSource = readFileSync(path.join(engine, 'live-v2-contact-authority-composer.js'), 'utf8');
const adapterSource = readFileSync(path.join(engine, 'live-v2-authority-adapter.js'), 'utf8');
const matchSource = readFileSync(path.join(engine, 'match.html'), 'utf8');
const FIXED_TICK_SECONDS = 1 / 60;

function contactCapability(workflow = 'single-player') {
  return Contact.createCapability({
    enabled: true,
    online: false,
    workflow,
    parentAdapterVersion: Contact.PARENT_VERSION,
    parentGrant: 'offline-normal-match-live-authority',
    acknowledgement: Contact.ACKNOWLEDGEMENT
  });
}

function movementPlayer(id, teamId, x, y = 0, attributes = {}) {
  return {
    id,
    teamId,
    role: 'CM',
    position: { x, y },
    velocity: { x: 0, y: 0 },
    facing: { x: teamId === 'you' ? -1 : 1, y: 0 },
    radius: 0.36,
    attributes: {
      pace: 78,
      acceleration: 78,
      agility: 82,
      balance: 82,
      strength: 75,
      stamina: 80,
      defending: 68,
      aggression: 70,
      control: 94,
      ...attributes
    }
  };
}

function rosterEntry(player, overrides = {}) {
  return {
    id: player.id,
    teamId: player.teamId,
    isGK: false,
    sentOff: false,
    available: true,
    contactEligible: true,
    bodyContactEligible: true,
    heightM: 1.82,
    attributes: {
      control: 94,
      technique: 92,
      awareness: 70,
      heading: 72,
      jumping: 72,
      strength: 75,
      shooting: 75,
      volleys: 75,
      balance: 82,
      agility: 82,
      defending: 68,
      ...(overrides.attributes || {})
    },
    ...overrides
  };
}

function reactionRequest({
  tick = 20,
  releaseTick = 20,
  actorId = 'bystander',
  actorTeamId = 'you',
  actorX = 52.5,
  actorY = 0,
  actorAttributes = { reactions: 1, awareness: 99 },
  actorContactEligible = true,
  intendedReceiverId = 'target',
  sourceX = 70,
  sourceContactEligible = false,
  ballPosition = { x: 52.86, y: 0, z: 0.11 },
  previousBallPosition = { x: 53.3, y: 0, z: 0.11 },
  ballVelocity = { x: -8, y: 0, z: 0 }
} = {}) {
  const source = movementPlayer('source', 'you', sourceX, 0, { reactions: 99, awareness: 99 });
  const actor = movementPlayer(actorId, actorTeamId, actorX, actorY, actorAttributes);
  const target = movementPlayer('target', 'you', 31.5, 8, { reactions: 80, awareness: 80 });
  const defender = movementPlayer('defender', 'opp', 85, -12, { reactions: 80, awareness: 80 });
  const players = [source, actor, target, defender];
  const movementWorld = Movement.createWorldState({
    tick,
    fixedTickSeconds: FIXED_TICK_SECONDS,
    bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    ballOwnerId: null,
    players
  });
  const ballState = Ball.createBallState({
    id: 'reaction-pass-ball',
    position: ballPosition,
    velocity: ballVelocity,
    angularVelocity: { x: 0, y: 3, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.ROLL,
    lastOuterTick: tick,
    contactCount: 0,
    simulationTime: tick / 60
  });
  return {
    schema: Contact.REQUEST_SCHEMA,
    workflow: 'single-player',
    online: false,
    tick,
    epoch: 0,
    seed: 173,
    fixedTickSeconds: FIXED_TICK_SECONDS,
    movementWorld,
    ballState,
    roster: [
      rosterEntry(source, { contactEligible: sourceContactEligible,
        attributes: { reactions: 99, awareness: 99 } }),
      rosterEntry(actor, { contactEligible: actorContactEligible,
        attributes: { ...actorAttributes } }),
      rosterEntry(target, { attributes: { reactions: 80, awareness: 80 } }),
      rosterEntry(defender, { attributes: { reactions: 80, awareness: 80 } })
    ],
    intendedReceiverId,
    firstTouchIntent: null,
    aerialIntent: null,
    reactionContext: {
      active: true,
      stimulus: 'deliberate-pass-release',
      releaseTick,
      sourcePlayerId: source.id,
      sourceTeamId: source.teamId,
      previousBallPosition
    },
    consumedFirstTouchIds: [],
    consumedFirstTouchThroughTick: 0,
    consumedAerialIds: [],
    gate: {
      livePlay: true,
      restartActive: false,
      replayActive: false,
      keeperAuthority: false,
      offsideInvolvementPending: false,
      specialActionAuthority: false
    }
  };
}

function composeReaction(options = {}) {
  return Contact.compose(reactionRequest(options), contactCapability());
}

test('reaction rating is explicit reactions first, awareness fallback second, and delay is monotonic', () => {
  const explicitWins = composeReaction({ actorAttributes: { reactions: 1, awareness: 99 } });
  assert.equal(explicitWins.contactType, 'involuntary-deflection');
  assert.equal(explicitWins.detail.reaction.rating, 1);
  assert.equal(explicitWins.detail.reaction.ratingSource, 'reactions');
  assert.equal(explicitWins.detail.reaction.delayTicks, 12);

  const fallback = composeReaction({ actorAttributes: { awareness: 99 } });
  assert.equal(fallback.detail.reaction.rating, 99);
  assert.equal(fallback.detail.reaction.ratingSource, 'awareness-fallback');
  assert.equal(fallback.detail.reaction.delayTicks, 3);

  const ratings = [1, 25, 50, 75, 99];
  const delays = ratings.map(reactions => composeReaction({
    actorAttributes: { reactions, awareness: 1 }
  }).detail.reaction.delayTicks);
  assert.deepEqual(delays, [12, 10, 7, 5, 3]);
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] < delays[index - 1], `${ratings[index]} reactions must react sooner than ${ratings[index - 1]}`);
  }
});

test('the named receiver anticipates an authored pass but a non-target teammate does not', () => {
  const intended = composeReaction({
    tick: 24,
    releaseTick: 20,
    intendedReceiverId: 'bystander',
    actorAttributes: { reactions: 50, awareness: 99 }
  });
  assert.equal(intended.contactType, 'first-touch');
  assert.equal(intended.presentation.playerId, 'bystander');
  assert.equal(intended.detail.reaction.intendedAnticipationTicks, 3);
  assert.equal(intended.detail.reaction.delayTicks, 4);
  assert.equal(intended.detail.reaction.ready, true);

  const nonTarget = composeReaction({
    tick: 24,
    releaseTick: 20,
    intendedReceiverId: 'target',
    actorAttributes: { reactions: 50, awareness: 99 }
  });
  assert.equal(nonTarget.contactType, 'involuntary-deflection');
  assert.equal(nonTarget.presentation.playerId, 'bystander');
  assert.equal(nonTarget.detail.reaction.intendedAnticipationTicks, 0);
  assert.equal(nonTarget.detail.reaction.delayTicks, 7);
  assert.equal(nonTarget.detail.reaction.ready, false);
});

test('the releasing player cannot body-deflect their own pass during the complete reaction window', () => {
  for (let ageTicks = 0; ageTicks <= Contact.MAX_REACTION_DELAY_TICKS; ageTicks += 1) {
    const protectedResult = composeReaction({
      tick: 20 + ageTicks,
      releaseTick: 20,
      actorX: 90,
      actorY: 20,
      sourceX: 52.5,
      sourceContactEligible: false,
      intendedReceiverId: 'target'
    });
    assert.equal(protectedResult.status, 'no-contact', `source must be passively protected at release age ${ageTicks}`);
    assert.equal(protectedResult.ownerCandidateId, null);
  }
});

test('an unreacted on-path body causes one MR involuntary deflection and never grants possession', () => {
  const input = reactionRequest({ actorAttributes: { reactions: 1, awareness: 99 } });
  const result = Contact.compose(input, contactCapability());
  assert.equal(result.status, 'contact');
  assert.equal(result.contactType, 'involuntary-deflection');
  assert.equal(result.presentation.playerId, 'bystander');
  assert.equal(result.presentation.reason, 'pre-reaction-body-contact');
  assert.equal(result.ownerCandidateId, null);
  assert.equal(result.presentation.possessionDisposition, 'remain-loose');
  assert.equal(result.detail.involuntary, true);
  assert.equal(result.detail.reaction.ready, false);
  assert.equal(result.ballState.contactCount, input.ballState.contactCount + 1);
  assert.equal(result.ballState.lastContact.colliderId, 'bystander');
  assert.notDeepEqual(result.ballState.velocity, input.ballState.velocity);
  assert.deepEqual(result.suppressLegacy, {
    reception: true,
    aerialDuel: false,
    outfieldBallBlock: true,
    keeperContact: false,
    wallContact: false
  });
});

test('a geometric near-miss does not become a touch merely because a player has not reacted', () => {
  const input = reactionRequest({ actorY: 0.9, actorAttributes: { reactions: 1, awareness: 99 } });
  const result = Contact.compose(input, contactCapability());
  assert.equal(result.status, 'no-contact');
  assert.equal(result.contactType, null);
  assert.equal(result.ownerCandidateId, null);
  assert.equal(result.ballState.contactCount, input.ballState.contactCount);
  assert.deepEqual(result.ballState.velocity, input.ballState.velocity);
  assert.equal(result.suppressLegacy.outfieldBallBlock, false);
});

test('once the reaction window expires, the same physical meeting is deliberate First Touch authority', () => {
  const result = composeReaction({
    tick: 27,
    releaseTick: 20,
    actorAttributes: { reactions: 50, awareness: 99 },
    intendedReceiverId: 'target'
  });
  assert.equal(result.contactType, 'first-touch', JSON.stringify(result));
  assert.equal(result.presentation.playerId, 'bystander');
  assert.equal(result.detail.reaction.ratingSource, 'reactions');
  assert.equal(result.detail.reaction.delayTicks, 7);
  assert.equal(result.detail.reaction.ageTicks, 7);
  assert.equal(result.detail.reaction.ready, true);
  assert.notEqual(result.presentation.technique, 'passive-player-body');
});

test('passive MR ledger ids never contaminate the stricter First Touch handoff namespace', () => {
  const request = reactionRequest({
    tick: 27,
    releaseTick: 20,
    actorAttributes: { reactions: 50, awareness: 99 },
    intendedReceiverId: 'target'
  });
  request.consumedFirstTouchIds = ['first-touch-v2:body:26:0123456789abcdef'];
  const result = Contact.compose(request, contactCapability());
  assert.equal(result.contactType, 'first-touch');
  assert.equal(result.presentation.playerId, 'bystander');
  assert.ok(result.consumedFirstTouchIds.includes('first-touch-v2:body:26:0123456789abcdef'));
});

test('the earliest swept body cannot be erased by a later endpoint receiver', () => {
  const source = movementPlayer('source', 'you', 45, 8, { reactions: 99, awareness: 99 });
  // The earlier actor has not yet reacted to the release, while the intended
  // receiver at the endpoint has. The real swept body meeting must therefore
  // win as a passive ricochet instead of being erased by the later foot-control
  // candidate.
  const earlyBody = movementPlayer('early-body', 'opp', 52.55, 0,
    { reactions: 1, awareness: 99 });
  earlyBody.velocity = { x: 0, y: 0 };
  const endpointTarget = movementPlayer('endpoint-target', 'you', 52.62, 0.65,
    { reactions: 99, awareness: 99 });
  const farPlayer = movementPlayer('far-player', 'opp', 80, 8, { reactions: 99, awareness: 99 });
  const players = [source, earlyBody, endpointTarget, farPlayer];
  const tick = 40;
  const request = {
    schema: Contact.REQUEST_SCHEMA,
    workflow: 'single-player',
    online: false,
    tick,
    epoch: 0,
    seed: 173,
    fixedTickSeconds: FIXED_TICK_SECONDS,
    movementWorld: Movement.createWorldState({
      tick,
      fixedTickSeconds: FIXED_TICK_SECONDS,
      bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
      ballOwnerId: null,
      players
    }),
    ballState: Ball.createBallState({
      id: 'body-before-foot-ball',
      position: { x: 52.62, y: 0, z: 0.5 },
      velocity: { x: 37.2, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      regime: Ball.REGIMES.FLIGHT,
      lastOuterTick: tick,
      contactCount: 0,
      simulationTime: tick / 60
    }),
    roster: players.map(player => rosterEntry(player, {
      attributes: {
        control: 99,
        technique: 99,
        awareness: 99,
        reactions: player.id === earlyBody.id ? 1 : 99,
        balance: 99,
        agility: 99,
        strength: 99
      }
    })),
    intendedReceiverId: endpointTarget.id,
    firstTouchIntent: null,
    aerialIntent: null,
    reactionContext: {
      active: true,
      stimulus: 'deliberate-pass-release',
      releaseTick: 39,
      sourcePlayerId: source.id,
      sourceTeamId: source.teamId,
      previousBallPosition: { x: 52, y: 0, z: 0.5 }
    },
    consumedFirstTouchIds: [],
    consumedFirstTouchThroughTick: 0,
    consumedAerialIds: [],
    gate: {
      livePlay: true,
      restartActive: false,
      replayActive: false,
      keeperAuthority: false,
      offsideInvolvementPending: false,
      specialActionAuthority: false
    }
  };

  const result = Contact.compose(request, contactCapability());
  assert.equal(result.contactType, 'involuntary-deflection');
  assert.equal(result.presentation.playerId, earlyBody.id);
  assert.equal(result.presentation.technique, 'passive-player-body');
  assert.equal(result.ownerCandidateId, null);
  assert.equal(result.ballState.lastContact.colliderId, earlyBody.id);
  assert.notEqual(result.ballState.lastContact.colliderId, endpointTarget.id);
});

test('a goalkeeper source outside the Movement roster does not break pass-body reactions', () => {
  const input = reactionRequest();
  const outfieldPlayers = input.movementWorld.players.filter(player => player.id !== 'source');
  const request = {
    ...input,
    movementWorld: Movement.createWorldState({
      tick: input.tick,
      fixedTickSeconds: FIXED_TICK_SECONDS,
      bounds: input.movementWorld.bounds,
      ballOwnerId: null,
      players: outfieldPlayers
    }),
    roster: input.roster.filter(player => player.id !== 'source'),
    reactionContext: {
      ...input.reactionContext,
      sourcePlayerId: 'keeper-source'
    }
  };

  const result = Contact.compose(request, contactCapability());
  assert.equal(result.contactType, 'involuntary-deflection');
  assert.equal(result.presentation.playerId, 'bystander');
  assert.equal(result.detail.reaction.ratingSource, 'reactions');
});

function canonicalLineup(teamId) {
  return Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }));
}

function adapterCapability() {
  return Adapter.createCapability({
    acknowledgement: Adapter.ACKNOWLEDGEMENT,
    workflow: 'single-player',
    online: false,
    onlineMarkers: {}
  });
}

function adapterAttachment() {
  return Adapter.createAttachment({
    enabled: true,
    capability: adapterCapability(),
    seed: 173173,
    dependencies: { ball: Ball, movement: Movement, cpu: CPU, formation: Formation,
      contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

function deflectionSnapshot(tick = 1) {
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId,
    formation: '4-3-3',
    phase: teamId === 'you' ? 'settled-attack' : 'defend',
    philosophy: teamId === 'you' ? 'ancelotti-bbc-433' : null,
    attackingDirection: teamId === 'you' ? 1 : -1,
    offsideLine: teamId === 'you' ? 90 : 15,
    tactics: {},
    lineup: canonicalLineup(teamId)
  }));
  const players = [];
  for (const team of teams) {
    for (const [index, row] of team.lineup.entries()) {
      let x = team.id === 'you' ? 8 + index * 1.1 : 78 + index * 1.1;
      let y = -29 + index * 5.6;
      if (row.id === 'you-CAM') { x = 30; y = 0; }
      if (row.id === 'you-LCM') { x = 30.25; y = 0; }
      if (row.id === 'you-RW') { x = 51; y = 0; }
      players.push({
        id: row.id,
        teamId: team.id,
        role: row.position,
        position: row.position,
        slotId: row.slotId,
        x,
        y,
        vx: 0,
        vy: 0,
        fx: team.attackingDirection,
        fy: 0,
        radius: 0.36,
        heightM: 1.82,
        stamina: 100,
        attrs: {
          pace: 82,
          accel: 82,
          acceleration: 82,
          agility: 82,
          balance: 82,
          strength: 78,
          stamina: 84,
          reactions: row.id === 'you-LCM' ? 1 : 80,
          awareness: row.id === 'you-LCM' ? 99 : 80,
          pass: 84,
          shoot: 76,
          control: 84,
          defend: 74,
          aggression: 74
        },
        isGK: row.position === 'GK',
        sentOff: false,
        contactEligible: row.position !== 'GK' && row.id !== 'you-CAM',
        bodyContactEligible: row.position !== 'GK',
        tackleActive: false,
        shoulderActive: false,
        control: null
      });
    }
  }
  const offsideCandidate = {
    playerId: 'you-RW',
    passerId: 'you-CAM',
    kickTick: tick,
    line: 49.5,
    mistimedEarly: true
  };
  return {
    tick,
    fixedTickSeconds: FIXED_TICK_SECONDS,
    pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    units: { xPerMetre: 1, yPerMetre: 1, zPerMetre: 1 },
    players,
    humanPlayerIds: ['you-CAM'],
    ball: {
      id: 'adapter-deflection-ball',
      x: 30,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      zv: 0,
      spin: 0,
      dip: 0,
      ownerId: null,
      targetId: 'you-RW',
      lastKickerId: 'you-CAM',
      flightType: 'ground-pass',
      launchIntent: {
        sequence: 'twenty-one-metre-pass-bystander-fixture',
        sourcePlayerId: 'you-CAM',
        targetPlayerId: 'you-RW',
        origin: { x: 30, y: 0, z: 0 },
        target: { x: 51, y: 0 },
        direction: { x: 1, y: 0 },
        speedMetresPerSecond: 20,
        liftAngleDeg: 0,
        sideSpinRpm: 0,
        topSpinRpm: 0,
        source: 'ground-pass',
        offsideCandidate
      }
    },
    teams,
    contact: {
      intendedReceiverId: 'you-RW',
      firstTouchIntent: null,
      aerialIntent: null,
      gate: {
        livePlay: true,
        restartActive: false,
        replayActive: false,
        keeperAuthority: false,
        offsideInvolvementPending: false,
        specialActionAuthority: false
      }
    },
    dribbling: { surface: 'dry', actionIntent: null },
    offsideCandidate
  };
}

test('adapter ends the authored route after a passive ricochet, stays ownerless, and preserves offside provenance', () => {
  const live = adapterAttachment();
  const snapshot = deflectionSnapshot(1);
  const reactionStimulus = {
    releaseTick: 1,
    sourcePlayerId: 'you-CAM',
    sourceTeamId: 'you'
  };
  const frame = live.planTick(snapshot);
  assert.ok(frame, JSON.stringify(live.status()));
  assert.equal(frame.contact?.contactType, 'involuntary-deflection');
  assert.equal(frame.contact?.presentation?.playerId, 'you-LCM');
  assert.equal(frame.contact?.ownerCandidateId, null);
  assert.equal(frame.hostProjection.movementBallOwnerId, null);
  assert.equal(frame.hostProjection.logicalBallOwnerId, null);
  assert.deepEqual(frame.hostProjection.possession, {
    teamId: null,
    ownerId: null,
    inFlight: false,
    intendedReceiverId: null,
    intendedTarget: null,
    intendedTargetWindowMetres: null,
    arrivalWindowEntered: false,
    releaseTick: null,
    sourcePlayerId: null,
    deliberatePass: false,
    reactionStimulus,
    offsideCandidate: snapshot.offsideCandidate
  });
  assert.equal(live.commitTick(frame), true);

  const serialized = live.exportState();
  assert.deepEqual(serialized.domain.possession.reactionStimulus, reactionStimulus);
  const restored = adapterAttachment();
  assert.equal(restored.restoreState(serialized), true);
  assert.deepEqual(restored.status().possession.reactionStimulus, reactionStimulus,
    'serialized restore must retain the release stimulus independently of the ended pass route');

  const next = structuredClone(snapshot);
  next.tick = 2;
  next.ball = {
    ...next.ball,
    ...frame.hostProjection.ball,
    ownerId: null,
    targetId: null,
    lastKickerId: 'you-CAM',
    flightType: 'involuntary-deflection',
    launchIntent: null
  };
  next.contact.intendedReceiverId = null;
  for (const movement of frame.hostProjection.movement) {
    const player = next.players.find(row => row.id === movement.id);
    Object.assign(player, { x: movement.x, y: movement.y, vx: movement.vx, vy: movement.vy,
      fx: movement.fx, fy: movement.fy, stamina: movement.stamina });
  }
  const lowReactionBystander = next.players.find(row => row.id === 'you-LCM');
  assert.equal(lowReactionBystander.attrs.reactions, 1);
  lowReactionBystander.x = frame.hostProjection.ball.x + frame.hostProjection.ball.vx * 0.5;
  lowReactionBystander.y = frame.hostProjection.ball.y + frame.hostProjection.ball.vy * 0.5;
  lowReactionBystander.vx = 0;
  lowReactionBystander.vy = 0;
  next.players.find(row => row.id === 'you-CAM').y += 3;
  const looseFrame = live.planTick(next);
  assert.ok(looseFrame, JSON.stringify(live.status()));
  assert.equal(looseFrame.contact?.contactType, 'involuntary-deflection');
  assert.equal(looseFrame.contact?.presentation?.playerId, 'you-LCM');
  assert.equal(looseFrame.contact?.detail?.reaction?.rating, 1);
  assert.equal(looseFrame.contact?.detail?.reaction?.ageTicks, 1);
  assert.equal(looseFrame.contact?.detail?.reaction?.delayTicks, 12);
  assert.equal(looseFrame.contact?.detail?.reaction?.ready, false);
  assert.equal(looseFrame.contact?.ownerCandidateId, null);
  assert.equal(looseFrame.hostProjection.logicalBallOwnerId, null);
  assert.equal(looseFrame.hostProjection.possession.inFlight, false);
  assert.equal(looseFrame.hostProjection.possession.intendedReceiverId, null);
  assert.deepEqual(looseFrame.hostProjection.possession.reactionStimulus, reactionStimulus);
  assert.deepEqual(looseFrame.hostProjection.possession.offsideCandidate, snapshot.offsideCandidate);
  assert.ok(looseFrame.hostProjection.recoveryAssignments.length > 0,
    'the tick after a ricochet must be a loose-ball race, not continuation of the old rendezvous');
  assert.equal(looseFrame.hostProjection.recoveryAssignments.some(row => row.intended), false);
});

test('a finalized reaction-stimulus transaction rolls back to the exact prior domain', () => {
  const live = adapterAttachment();
  const frame = live.planTick(deflectionSnapshot(1));
  assert.ok(frame);
  const prepared = live.prepareCommit(frame);
  assert.ok(prepared);
  assert.equal(live.applyPrepared(prepared), true);
  assert.equal(live.finalizePrepared(prepared), true);
  assert.ok(live.status().possession.reactionStimulus);

  assert.equal(live.rollbackPrepared(prepared, 'independent reaction rollback probe'), false,
    'the public rollback freezes the same-session adapter after restoring its prior domain');
  const status = live.status();
  assert.equal(status.enabled, false);
  assert.equal(status.lastCommittedTick, -1);
  assert.equal(status.possession.reactionStimulus, null);
  assert.equal(status.possession.offsideCandidate, null);
});

test('live V2 owns outfield blocking while the legacy block remains gated', () => {
  assert.match(composerSource, /contactType:\s*'involuntary-deflection'/);
  assert.match(composerSource, /outfieldBallBlock:\s*true/);
  assert.match(adapterSource, /live contact composer result contract failed/);
  assert.match(matchSource,
    /liveV2SuppressLegacyBallBlock=true/,
    'the retired host block stays suppressed throughout live V2');
  assert.match(matchSource,
    /resolveSetPieceWallBlock\(\);if\(!liveV2TickApplied\|\|!liveV2SuppressLegacyBallBlock\)resolveBallBlock\(\);/,
    'strict V2 must not run Build 173 outfield ball blocking after MR already authored the contact');
  assert.doesNotMatch(matchSource,
    /resolveSetPieceWallBlock\(\);resolveBallBlock\(\);if\(!liveV2SuppressLegacyAerialDuel\)/,
    'the former unconditional dual-authority sequence must stay removed');
  assert.match(matchSource,
    /contactType==='involuntary-deflection'[\s\S]{0,700}ball\.target=null;ball\.flightType='involuntary-deflection';ball\.isShot=false;ball\.shooter=null/,
    'the committed host contact must clear the stale route and flight classification in the same transaction');
  assert.match(matchSource,
    /liveV2SuppressLegacyReception,liveV2SuppressLegacyAerialDuel,liveV2SuppressLegacyBallBlock/,
    'host transaction capture must include passive-body legacy suppression');
  assert.match(matchSource,
    /liveV2SuppressLegacyBallBlock=saved\.liveV2SuppressLegacyBallBlock===true/,
    'host transaction rollback must restore passive-body legacy suppression exactly');
  assert.match(matchSource,
    /offsideInvolvementPending:!!offsideCandidate/,
    'any unresolved Build 173 offside candidate must gate V2 reception after the target route is cleared');
  assert.match(matchSource,
    /function liveV2CanStageProtectedLaunch\(source\)[\s\S]{0,1000}restartRelease\|\|keeperRelease/,
    'protected restart and keeper releases must be allowed to stage the V2 launch handoff');
  assert.match(matchSource,
    /lastKickerId:lastKicker\?String\(lastKicker\.id\):null,lastKickerTeamId:lastKicker\?String\(lastKicker\.team\):null/,
    'a goalkeeper excluded from Movement must retain source-team provenance in the live snapshot');
});
