import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Movement = require('../match-engine/movement-engine-v2.js');
const Ball = require('../match-engine/ball-engine-v2.js');
const Composer = require('../match-engine/live-v2-contact-authority-composer.js');

const HASHES = Object.freeze({
  'live-v2-contact-authority-composer.js': '15f87890f25012412dff34d1d8f0dcdf44694d14d107b859f260cde3c4e6c10b',
  'first-touch-v2.js': 'f548c5c33c0d82ce044ebb083ec6deac0deb212f8287608f77e490794894152c',
  'first-touch-authority-adapter-v2.js': '2c6bf8b63e327c653556d73ec4c820b742038e63fb1f46217ef912eccec432f2',
  'aerial-contact-v2.js': '54bf086bef9e0f149f9ed2445454da510fca5908e79aa77d95ba5f70d5e8b1ba',
  'ball-engine-v2.js': 'e2b6776a12ebcf8353e322c181e2f38dbb18c1c41d10c1cebf134418a296a819',
  'movement-engine-v2.js': 'e8848db45518ef54ed5cec5e65091160605decfb9995d23b9769395f1eafa0b3'
});

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'match-engine', file))).digest('hex');
}

function capability(workflow = 'single-player') {
  return Composer.createCapability({
    enabled: true,
    online: false,
    workflow,
    parentAdapterVersion: Composer.PARENT_VERSION,
    parentGrant: 'offline-normal-match-live-authority',
    acknowledgement: Composer.ACKNOWLEDGEMENT
  });
}

function movementPlayer(id, teamId, x, y = 0, overrides = {}) {
  return {
    id,
    teamId,
    role: overrides.role || 'CM',
    position: { x, y },
    velocity: overrides.velocity || { x: 0, y: 0 },
    facing: overrides.facing || { x: teamId === 'you' ? 1 : -1, y: 0 },
    attributes: {
      pace: 80, acceleration: 80, agility: 86, balance: 86, strength: 78,
      stamina: 82, defending: 72, aggression: 74, control: 92,
      ...(overrides.attributes || {})
    }
  };
}

function rosterPlayer(player, overrides = {}) {
  return {
    id: player.id,
    teamId: player.teamId,
    isGK: false,
    sentOff: false,
    available: true,
    contactEligible: true,
    heightM: 1.82,
    attributes: {
      control: 92, technique: 92, awareness: 90, heading: 84, jumping: 84,
      strength: 78, shooting: 88, shoot: 88, volleys: 90, balance: 86,
      agility: 86, defending: 72,
      ...(overrides.attributes || {})
    },
    ...overrides
  };
}

function fixture(overrides = {}) {
  const tick = overrides.tick ?? 41;
  const epoch = overrides.epoch ?? 0;
  const receiver = overrides.receiver || movementPlayer('receiver', 'you', 52.5);
  const defender = overrides.defender || movementPlayer('defender', 'opp', 56.5);
  const players = overrides.players || [receiver, defender];
  const movementWorld = Movement.createWorldState({
    tick,
    fixedTickSeconds: 1 / 60,
    bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    ballOwnerId: null,
    players
  });
  const ballState = Ball.createBallState({
    id: 'match-ball',
    position: overrides.ballPosition || { x: 53.02, y: 0, z: 0.11 },
    velocity: overrides.ballVelocity || { x: -8, y: 0, z: 0 },
    angularVelocity: overrides.angularVelocity || { x: 0, y: 3, z: 0 },
    grounded: overrides.grounded ?? true,
    regime: overrides.regime || Ball.REGIMES.ROLL,
    lastOuterTick: tick,
    contactCount: overrides.contactCount ?? 3,
    simulationTime: tick / 60,
    metadata: { retained: 'pre-contact' }
  });
  const defaultRoster = players.map(player => rosterPlayer(player,
    player.id === defender.id ? overrides.defenderRoster || {} : overrides.receiverRoster || {}));
  return {
    schema: Composer.REQUEST_SCHEMA,
    workflow: overrides.workflow || 'single-player',
    online: false,
    tick,
    epoch,
    seed: overrides.seed ?? 173,
    fixedTickSeconds: 1 / 60,
    movementWorld,
    ballState,
    roster: overrides.roster || defaultRoster,
    intendedReceiverId: overrides.intendedReceiverId === undefined ? receiver.id : overrides.intendedReceiverId,
    firstTouchIntent: overrides.firstTouchIntent || null,
    aerialIntent: overrides.aerialIntent || null,
    consumedFirstTouchIds: overrides.consumedFirstTouchIds || [],
    consumedAerialIds: overrides.consumedAerialIds || [],
    gate: {
      livePlay: true,
      restartActive: false,
      replayActive: false,
      keeperAuthority: false,
      offsideInvolvementPending: false,
      specialActionAuthority: false,
      ...(overrides.gate || {})
    }
  };
}

function aerialFixture(overrides = {}) {
  const tick = overrides.tick ?? 100;
  const epoch = overrides.epoch ?? 7;
  const receiver = overrides.receiver || movementPlayer('receiver', 'you', 52.5, 0, {
    role: 'ST', attributes: { strength: 94, control: 94 }
  });
  const defender = overrides.defender || movementPlayer('defender', 'opp', 56.5, 0, {
    role: 'CB', attributes: { strength: 42, defending: 42 }
  });
  return fixture({
    ...overrides,
    tick,
    epoch,
    receiver,
    defender,
    ballPosition: overrides.ballPosition || { x: 52.96, y: 0.04, z: 0.9 },
    ballVelocity: overrides.ballVelocity || { x: -8, y: 1.5, z: -1.2 },
    angularVelocity: overrides.angularVelocity || { x: 3, y: -5, z: 7 },
    grounded: false,
    regime: Ball.REGIMES.FLIGHT,
    aerialIntent: overrides.aerialIntent || {
      sequence: 'attempt-1', epoch, commandTick: tick - 5, actorId: receiver.id,
      technique: 'volley', intent: 'shoot', target: { x: 80, y: 1.2, z: 1.1 }
    }
  });
}

test('review is pinned to the declared contact composition and exact lower-engine bytes', () => {
  for (const [file, expected] of Object.entries(HASHES)) assert.equal(sha(file), expected, file);
  const composerSource = fs.readFileSync(path.join(root, 'match-engine', 'live-v2-contact-authority-composer.js'), 'utf8');
  assert.equal(Composer.ACKNOWLEDGEMENT, 'EXPLICIT_OFFLINE_LIVE_V2_CONTACT_COMPOSITION');
  assert.equal(Composer.AUTHORITY, 'offline-live-v2-contact-plan');
  assert.deepEqual([...Composer.SUPPORTED_WORKFLOWS], ['single-player', 'cpu-v-cpu']);
  assert.equal(Composer.MAX_RECENT_FIRST_TOUCH_IDS, 64);
  assert.equal(Composer.RETAINED_RECONTACT_MIN_TICKS, 20);
  assert.equal(Composer.RETAINED_RECONTACT_MAX_LOCK_TICKS, 45);
  assert.equal(Composer.RETAINED_RECONTACT_MIN_TRAVEL_METRES, 0.9);
  assert.ok(Composer.SOURCE_RELEASE_BODY_PROTECTION_TICKS > Composer.MAX_REACTION_DELAY_TICKS,
    'the releasing player must remain outside passive body arbitration for the full reaction window');
  assert.equal(Composer.REACTION_DELAY_MIN_TICKS, 3);
  assert.equal(Composer.REACTION_DELAY_RATING_DIVISOR, 11);
  assert.equal(Composer.INTENDED_RECEIVER_ANTICIPATION_TICKS, 3);
  assert.equal(Composer.MAX_REACTION_DELAY_TICKS, 12);
  assert.match(composerSource, /candidate\.intended && request\.firstTouchIntent/,
    'a human receiver intent must not steer another candidate');
  assert.match(composerSource, /consumedFirstTouchThroughTick/,
    'bounded recent evidence must retain a monotonic exact-once watermark');
  assert.match(composerSource, /if \(!request\.reactionContext \|\| !candidate\.roster\.bodyContactEligible\) return null/,
    'MR passive player-body authority must require the deliberate-pass reaction context');
  assert.match(composerSource, /Ball\.resolvePassiveBodyDeflection\(request\.ballState/);
  assert.match(composerSource, /contactType: 'involuntary-deflection', ownerCandidateId: null/);
  assert.match(composerSource, /outfieldBallBlock: true/,
    'an authored MR body deflection must suppress the overlapping legacy body block exactly on that tick');
});

test('only factory-issued explicit offline Single Player or CPU-v-CPU capabilities can compose', () => {
  const forged = {
    schema: Composer.CAPABILITY_SCHEMA,
    version: Composer.VERSION,
    authority: Composer.AUTHORITY,
    workflow: 'single-player',
    online: false,
    parentAdapterVersion: Composer.PARENT_VERSION,
    parentGrant: 'offline-normal-match-live-authority',
    exactOnce: true,
    transactionalPlanOnly: true
  };
  assert.throws(() => Composer.compose(fixture(), forged), /issued live contact capability/);
  for (const patch of [
    { online: true },
    { workflow: 'online-versus' },
    { workflow: 'home-co-op' },
    { parentAdapterVersion: 'forged' },
    { parentGrant: 'forged' }
  ]) {
    assert.throws(() => Composer.createCapability({
      enabled: true,
      online: false,
      workflow: 'single-player',
      parentAdapterVersion: Composer.PARENT_VERSION,
      parentGrant: 'offline-normal-match-live-authority',
      acknowledgement: Composer.ACKNOWLEDGEMENT,
      ...patch
    }), /exact offline Single Player/);
  }
  const cpuCapability = capability('cpu-v-cpu');
  const cpuResult = Composer.compose(fixture({ workflow: 'cpu-v-cpu' }), cpuCapability);
  assert.equal(cpuResult.workflow, 'cpu-v-cpu');
  assert.throws(() => Composer.compose(fixture(), cpuCapability), /match the exact approved offline workflow/);
});

test('composition is pure and retry-stable before outer commit', () => {
  const input = fixture();
  const before = Composer.stableJson(input);
  const first = Composer.compose(input, capability());
  const second = Composer.compose(structuredClone(input), capability());
  assert.equal(Composer.stableJson(input), before);
  assert.equal(Composer.stableJson(first), Composer.stableJson(second));
  assert.deepEqual(input.consumedFirstTouchIds, []);
});

test('ground reception records exactly one contact and stages possession without touching protected lanes', () => {
  const input = fixture({ contactCount: 11 });
  const result = Composer.compose(input, capability());
  assert.equal(result.status, 'contact');
  assert.equal(result.contactType, 'first-touch');
  assert.equal(result.ballState.contactCount, 12);
  assert.equal(result.ballState.lastContact.outerTick, input.tick);
  assert.equal(result.ballState.lastOuterTick, input.tick);
  assert.equal(result.ballState.simulationTime, input.ballState.simulationTime);
  assert.equal(result.ballState.metadata.retained, 'pre-contact');
  assert.equal(result.ownerCandidateId, 'receiver');
  assert.deepEqual(result.suppressLegacy, {
    reception: true,
    aerialDuel: true,
    outfieldBallBlock: false,
    keeperContact: false,
    wallContact: false
  });
});

test('retained same-player continuation is contact-authoritative without replaying reception presentation', () => {
  const directional = {
    type: 'directional-touch', direction: { x: 1, y: 0 }, touchDistanceM: 1.1, active: true
  };
  const first = Composer.compose(fixture({ tick: 41, firstTouchIntent: directional }), capability());
  assert.equal(first.contactType, 'first-touch');
  assert.equal(first.presentation.outcome, 'retained');

  const lockedInput = fixture({
    tick: 59,
    firstTouchIntent: directional,
    contactCount: first.ballState.contactCount
  });
  lockedInput.ballState = Ball.createBallState({
    ...structuredClone(first.ballState),
    lastOuterTick: lockedInput.tick
  });
  const locked = Composer.compose(lockedInput, capability());
  assert.equal(locked.status, 'no-contact', 'the old eighteen-frame recontact loop must remain blocked');

  const continuationInput = fixture({
    tick: 87,
    firstTouchIntent: directional,
    contactCount: first.ballState.contactCount
  });
  continuationInput.ballState = Ball.createBallState({
    ...structuredClone(first.ballState),
    lastOuterTick: continuationInput.tick
  });
  const continuation = Composer.compose(continuationInput, capability());
  assert.equal(continuation.status, 'contact');
  assert.equal(continuation.contactType, 'dribble-touch');
  assert.equal(continuation.presentation.phase, Composer.DRIBBLE_CONTINUATION_PHASE);
  assert.equal(continuation.detail.retainedTouchContinuation, true);
  assert.equal(continuation.ballState.contactCount, first.ballState.contactCount + 1);
  assert.equal(continuation.suppressLegacy.reception, true);
});

test('a high ball cannot be stolen by the ground first-touch lane', () => {
  const input = fixture({
    ballPosition: { x: 52.8, y: 0, z: 3 },
    ballVelocity: { x: 0, y: 0, z: -1 },
    grounded: false,
    regime: Ball.REGIMES.FLIGHT
  });
  const result = Composer.compose(input, capability());
  assert.equal(result.status, 'no-contact');
  assert.equal(result.ownedContact, false);
  assert.equal(result.ballState.contactCount, input.ballState.contactCount);
  assert.deepEqual(result.suppressLegacy, {
    reception: true,
    aerialDuel: false,
    outfieldBallBlock: false,
    keeperContact: false,
    wallContact: false
  });
});

test('offside involvement, keeper, restart, replay and special authority gate before either resolver', () => {
  for (const key of ['offsideInvolvementPending', 'keeperAuthority', 'restartActive', 'replayActive', 'specialActionAuthority']) {
    const input = aerialFixture({ gate: { [key]: true } });
    const result = Composer.compose(input, capability());
    assert.equal(result.status, 'gated', key);
    assert.equal(result.ownedContact, false, key);
    assert.equal(result.ballState.contactCount, input.ballState.contactCount, key);
    assert.deepEqual(result.consumedAerialIds, [], key);
  }
});

test('aerial authority is mutually exclusive with ground reception and repairs launch chronology', () => {
  const input = aerialFixture({ contactCount: 19 });
  const result = Composer.compose(input, capability());
  assert.equal(result.status, 'contact');
  assert.equal(result.contactType, 'aerial-volley');
  assert.equal(result.ballState.contactCount, 20);
  assert.equal(result.ballState.lastOuterTick, input.tick);
  assert.equal(result.ballState.lastContact.outerTick, input.tick);
  assert.equal(result.ballState.lastContact.colliderId, result.presentation.playerId);
  assert.equal(result.ballState.metadata.retained, 'pre-contact');
  assert.equal(result.ballState.metadata.liveContactLedgerId, result.consumedAerialIds[0]);
  assert.deepEqual(result.consumedFirstTouchIds, []);
});

test('pending and missed aerial attempts suppress same-tick legacy retry but retain keeper/wall/body handling', () => {
  const pendingInput = aerialFixture({
    aerialIntent: {
      sequence: 'pending', epoch: 7, commandTick: 99, actorId: 'receiver',
      technique: 'volley', intent: 'shoot', target: { x: 80, y: 0, z: 1 }
    }
  });
  const pending = Composer.compose(pendingInput, capability());
  assert.equal(pending.status, 'aerial-pending');
  assert.deepEqual(pending.consumedAerialIds, []);
  assert.equal(pending.suppressLegacy.reception, true);
  assert.equal(pending.suppressLegacy.aerialDuel, true);
  assert.equal(pending.suppressLegacy.outfieldBallBlock, false);
  assert.equal(pending.suppressLegacy.keeperContact, false);
  assert.equal(pending.suppressLegacy.wallContact, false);

  const missInput = aerialFixture({ ballPosition: { x: 70, y: 0, z: 3 } });
  const miss = Composer.compose(missInput, capability());
  assert.equal(miss.status, 'aerial-miss');
  assert.equal(miss.consumedAerialIds.length, 1);
  assert.equal(miss.suppressLegacy.reception, true);
  assert.equal(miss.suppressLegacy.aerialDuel, true);
  assert.equal(miss.suppressLegacy.keeperContact, false);
  assert.equal(miss.suppressLegacy.wallContact, false);
});

test('aerial exact-once ledger is epoch-bound and consumed only by outer commit state', () => {
  const input = aerialFixture({ epoch: 12 });
  const first = Composer.compose(input, capability());
  assert.deepEqual(input.consumedAerialIds, []);
  assert.equal(Composer.stableJson(Composer.compose(input, capability())), Composer.stableJson(first));
  const duplicateInput = aerialFixture({ epoch: 12, consumedAerialIds: first.consumedAerialIds });
  const duplicate = Composer.compose(duplicateInput, capability());
  assert.equal(duplicate.status, 'already-consumed');
  assert.equal(duplicate.ownedContact, false);
  assert.equal(duplicate.suppressLegacy.reception, true);
  assert.equal(duplicate.suppressLegacy.aerialDuel, true);
  assert.equal(duplicate.suppressLegacy.outfieldBallBlock, false);
  assert.equal(duplicate.suppressLegacy.keeperContact, false);
  assert.equal(duplicate.suppressLegacy.wallContact, false);
  const stale = aerialFixture({
    epoch: 13,
    aerialIntent: {
      sequence: 'stale', epoch: 12, commandTick: 95, actorId: 'receiver',
      technique: 'volley', intent: 'shoot', target: { x: 80, y: 0, z: 1 }
    }
  });
  assert.throws(() => Composer.compose(stale, capability()), /different transaction epoch/);
});

test('sent-off, unavailable, ineligible and goalkeeper aerial actors fail closed', () => {
  for (const patch of [{ sentOff: true }, { available: false }, { contactEligible: false }, { isGK: true }]) {
    const input = aerialFixture();
    Object.assign(input.roster.find(row => row.id === 'receiver'), patch);
    assert.throws(() => Composer.compose(input, capability()), /eligible outfield/, JSON.stringify(patch));
  }
});

test('sent-off, unavailable, ineligible and goalkeeper opponents cannot win an aerial duel', () => {
  for (const patch of [{ sentOff: true }, { available: false }, { contactEligible: false }, { isGK: true }]) {
    const defender = movementPlayer('defender', 'opp', 52.96, 0.02, {
      role: 'CB', attributes: { strength: 99, defending: 99 }
    });
    const input = aerialFixture({
      defender,
      defenderRoster: {
        ...patch,
        attributes: { heading: 99, jumping: 99, strength: 99, defending: 99, awareness: 99 }
      }
    });
    const result = Composer.compose(input, capability());
    assert.notEqual(result.presentation?.playerId, 'defender', JSON.stringify(patch));
  }
});

test('coordinate centring is translation-safe across both halves of the fixed metric pitch', () => {
  function runAt(x) {
    const receiver = movementPlayer('receiver', 'you', x);
    const defender = movementPlayer('defender', 'opp', x + 4);
    return Composer.compose(fixture({
      receiver,
      defender,
      ballPosition: { x: x + 0.52, y: 0, z: 0.11 }
    }), capability());
  }
  const left = runAt(22);
  const right = runAt(83);
  assert.equal(left.status, 'contact');
  assert.equal(right.status, 'contact');
  assert.equal(left.presentation.outcome, right.presentation.outcome);
  assert.ok(Math.abs((right.ballState.position.x - left.ballState.position.x) - 61) < 1e-9);
  assert.equal(right.ballState.velocity.x, left.ballState.velocity.x);
  assert.equal(right.ballState.velocity.y, left.ballState.velocity.y);
});

test('hostile malformed structures fail without partial mutation or ambient authority', () => {
  const cyclic = fixture();
  cyclic.firstTouchIntent = {};
  cyclic.firstTouchIntent.self = cyclic.firstTouchIntent;
  assert.throws(() => Composer.compose(cyclic, capability()), /cycles|JSON-safe/);
  const source = fs.readFileSync(path.join(root, 'match-engine/live-v2-contact-authority-composer.js'), 'utf8');
  for (const forbidden of [
    'Math.random', 'Date.now', 'performance.now', 'requestAnimationFrame(',
    'setTimeout(', 'setInterval(', 'document.', 'window.addEventListener'
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});
