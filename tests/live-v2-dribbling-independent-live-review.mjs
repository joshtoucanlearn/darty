import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Adapter = require('../match-engine/live-v2-authority-adapter.js');
const Ball = require('../match-engine/ball-engine-v2.js');
const Movement = require('../match-engine/movement-engine-v2.js');
const CPU = require('../match-engine/cpu-intelligence-v2.js');
const Formation = require('../match-engine/formation-behaviour-v2.js');
const Contact = require('../match-engine/live-v2-contact-authority-composer.js');
const Dribbling = require('../match-engine/dribbling-state-v2.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchSource = readFileSync(path.join(root, 'match-engine', 'match.html'), 'utf8');
const dependencies = { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Contact, dribbling: Dribbling };

function functionSource(name) {
  const marker = `function ${name}(`, start = matchSource.indexOf(marker);
  assert.notEqual(start, -1, `missing host helper: ${name}`);
  const open = matchSource.indexOf('{', start + marker.length);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let index = open; index < matchSource.length; index += 1) {
    const char = matchSource[index], next = matchSource[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return matchSource.slice(start, index + 1);
  }
  assert.fail(`unterminated host helper: ${name}`);
}

function dribblingCapability() {
  return Dribbling.createCapability({ acknowledgement: Dribbling.ACKNOWLEDGEMENT, workflow: 'single-player', online: false });
}

function coreWorld(tick) {
  return Movement.createWorldState({
    tick, fixedTickSeconds: 1 / 60, bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 }, ballOwnerId: 'carrier',
    players: [
      { id: 'carrier', teamId: 'you', role: 'RW', position: { x: 40, y: 0 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, radius: 0.34, attributes: {} },
      { id: 'defender', teamId: 'opp', role: 'LB', position: { x: 50, y: 0 }, velocity: { x: 0, y: 0 }, facing: { x: -1, y: 0 }, radius: 0.34, attributes: {} }
    ]
  });
}

function coreBall() {
  return Ball.createBallState({ id: 'review-ball', position: { x: 40.42, y: 0, z: 0.11 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, regime: Ball.REGIMES.CONTROLLED });
}

function coreResolve(tick, state, actionIntent, capability = dribblingCapability(), ballState = coreBall()) {
  return Dribbling.resolve({
    schema: Dribbling.REQUEST_SCHEMA, workflow: 'single-player', online: false, tick, epoch: 0, seed: 91377,
    fixedTickSeconds: 1 / 60, state, movementWorld: coreWorld(tick), ballState,
    roster: [
      { id: 'carrier', teamId: 'you', isGK: false, sentOff: false, available: true, contactEligible: true, attributes: { control: 86, technique: 84, agility: 88 } },
      { id: 'defender', teamId: 'opp', isGK: false, sentOff: false, available: true, contactEligible: true, attributes: { control: 70, technique: 68, agility: 73 } }
    ],
    logicalOwnerId: 'carrier', carrierInput: { source: 'human', direction: { x: 1, y: 0 }, intensity: 0, sprint: false, shield: false },
    surface: 'dry', actionIntent,
    gate: { livePlay: true, restartActive: false, replayActive: false, keeperAuthority: false, offsideInvolvementPending: false, specialActionAuthority: false }
  }, capability);
}

function canonicalLineup(teamId) {
  return Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }));
}

function adapterSnapshot() {
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId, formation: '4-3-3', phase: teamId === 'you' ? 'settled-attack' : 'defend', philosophy: null,
    attackingDirection: teamId === 'you' ? 1 : -1, offsideLine: teamId === 'you' ? 90 : 15, tactics: {}, lineup: canonicalLineup(teamId)
  }));
  const players = [];
  for (const team of teams) {
    const shape = Formation.resolve({ formation: team.formation, phase: team.phase, tick: 1, lineup: team.lineup,
      pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 }, attackingDirection: team.attackingDirection, offsideLine: team.offsideLine, tactics: {} });
    for (const target of shape.targets) players.push({
      id: target.playerId, teamId: team.id, role: target.position, position: target.position, slotId: target.slotId,
      x: target.target.x, y: target.target.y, vx: 0, vy: 0, fx: team.attackingDirection, fy: 0, radius: 0.34,
      stamina: 100, heightM: 1.82, attrs: { pace: 82, accel: 82, agility: 82, technique: 82, balance: 82, strength: 82, stamina: 82, awareness: 82, pass: 82, shoot: 82, control: 82, defend: 72, aggression: 72 },
      isGK: target.position === 'GK', sentOff: false, contactEligible: target.position !== 'GK', tackleActive: false, shoulderActive: false, control: null
    });
  }
  const owner = players.find(player => player.id === 'you-CAM');
  owner.control = { x: 1, y: 0, strength: 0.7, sprint: false, shield: false };
  return {
    tick: 1, fixedTickSeconds: 1 / 60, pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 }, units: { xPerMetre: 1, yPerMetre: 1, zPerMetre: 1 },
    players, humanPlayerIds: ['you-CAM'],
    ball: { id: 'adapter-ball', x: owner.x, y: owner.y, z: 0, vx: 0, vy: 0, zv: 0, spin: 0, dip: 0, ownerId: owner.id, targetId: null, lastKickerId: null, flightType: '', launchIntent: null },
    teams,
    contact: { intendedReceiverId: null, firstTouchIntent: null, aerialIntent: null, gate: { livePlay: true, restartActive: false, replayActive: false, keeperAuthority: false, offsideInvolvementPending: false, specialActionAuthority: false } },
    dribbling: { surface: 'dry', actionIntent: null }
  };
}

function advanceAdapterSnapshot(snapshot, projection, tick) {
  const next = structuredClone(snapshot);
  next.tick = tick;
  const movementById = Object.fromEntries(projection.movement.map(row => [row.id, row]));
  for (const player of next.players) {
    const moved = movementById[player.id];
    if (!moved) continue;
    Object.assign(player, {
      x: moved.x, y: moved.y, vx: moved.vx, vy: moved.vy,
      fx: moved.fx, fy: moved.fy, stamina: moved.stamina
    });
  }
  next.ball.ownerId = projection.physicalBallSeparated ? null : projection.logicalBallOwnerId;
  if (projection.ball) Object.assign(next.ball, projection.ball);
  if (!projection.physicalBallSeparated && next.ball.ownerId) {
    const owner = next.players.find(player => player.id === next.ball.ownerId);
    if (owner) Object.assign(next.ball, {
      x: owner.x, y: owner.y, z: 0, vx: owner.vx, vy: owner.vy, zv: 0
    });
  }
  next.ball.launchIntent = null;
  next.dribbling = { surface: 'dry', actionIntent: null };
  return next;
}

function adapterAttachment() {
  const capability = Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow: 'single-player', online: false, onlineMarkers: {} });
  return Adapter.createAttachment({
    enabled: true, capability, seed: 91377, dependencies,
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
}

test('a physical Dribbling V2 lease cannot be reclaimed by the same-frame legacy reception loop', () => {
  const contactApply = functionSource('liveV2ApplyContact');
  const updateWindow = matchSource.slice(matchSource.indexOf('const liveV2LiveTick=liveV2RunTick()'), matchSource.indexOf('if(pendingFreeKickReplay', matchSource.indexOf('const liveV2LiveTick=liveV2RunTick()')));
  const suppressesInApply = /liveV2SuppressLegacyReception\s*=\s*projection\.physicalBallSeparated\s*===\s*true/.test(contactApply);
  const excludesOwnedLooseBall = /if\([^\n]{0,240}!liveV2OwnsLooseBall[^\n]{0,240}liveV2SuppressLegacyReception/.test(updateWindow) ||
    /if\([^\n]{0,240}liveV2SuppressLegacyReception[^\n]{0,240}!liveV2OwnsLooseBall/.test(updateWindow);
  assert.ok(suppressesInApply || excludesOwnedLooseBall,
    'ownerless Ball V2 touch must stay exclusively physical; legacy reception must be suppressed for the whole lease');
});

test('terminal or expired lease output retires the host pending action instead of poisoning later input', () => {
  const applySource = functionSource('liveV2ApplyDribbling');
  const harness = new Function(`
    let liveV2DribbleLeaseOwnerId='carrier';
    let liveV2PendingDribbleAction={id:'queued-pass',type:'pass',actorId:'carrier'};
    let liveV2LastDribbleLogKey='';
    let liveV2ConsumedDribbleActionIds=new Set();
    const ball={owner:null};
    const liveV2PlayerById=()=>null;
    const liveV2AcknowledgeDribbleAction=()=>false;
    const logEvent=()=>{};
    const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
    const liveV2ApplyIntelligence=()=>{};
    const doThroughPassFor=()=>{};
    const doLobPassFor=()=>{};
    const doPassForHuman=()=>{};
    const doShootForHuman=()=>{};
    ${applySource}
    liveV2ApplyDribbling({physicalBallSeparated:false,logicalBallOwnerId:null,dribbling:{physicalSeparated:false,logicalOwnerId:null,phase:'heavy-touch',bufferedAction:null,releasedAction:null,authorityHandoff:null,presentation:null,telemetry:null}});
    return {lease:liveV2DribbleLeaseOwnerId,pending:liveV2PendingDribbleAction};
  `)();
  assert.equal(harness.lease, null);
  assert.equal(harness.pending, null, 'an action consumed by a failed/expired lease must not block all later pass and shot input');
});

test('host rollback covers dribble presentation fields and receiver-control switching', () => {
  // The per-player field list moved out of the capture function into the explicit
  // liveV2PlayerTransactionValues reader; the same fields must still be captured.
  const capture = functionSource('liveV2CaptureTransactionState') + functionSource('liveV2PlayerTransactionValues');
  const restore = functionSource('liveV2RestoreTransactionState');
  for (const field of ['dribbleFoot', 'dribbleContact', 'dribbleSeparation', 'dribbleTargetSeparation', 'dribbleOutcome']) {
    assert.match(capture, new RegExp(`(?:['\"]${field}['\"]|\\b${field}:player\\.${field}\\b)`), `${field} must be restored after a discarded host transaction`);
  }
  assert.match(capture, /(?:^|[,\{])controlled(?:[,\}])/, 'human receiver selection must be captured');
  assert.match(capture, /(?:^|[,\{])controlledOpp(?:[,\}])/, 'second-controller selection must be captured for protected routes');
  assert.match(restore, /controlled\s*=\s*saved\.controlled/);
  assert.match(restore, /controlledOpp\s*=\s*saved\.controlledOpp/);
});

test('delayed human release consumes the direction captured with the buffered command', () => {
  const apply = functionSource('liveV2ApplyDribbling');
  assert.match(apply, /releasedAction\.direction/,
    'resecure dispatch must not re-read a later stick direction and change the buffered pass, lob, through ball, or shot');
});

test('newly secured dribbling presentation cannot overwrite a contact-owned first-touch animation', () => {
  const apply = functionSource('liveV2ApplyDribbling');
  assert.match(apply, /projection\.contact/,
    'the dribbling presenter must defer to a first-touch contact already applied in the same atomic frame');
  assert.match(apply, /first-touch/);
});

test('heavy touch and turnover animate the prior carrier rather than the ball winner', () => {
  const apply = functionSource('liveV2ApplyDribbling');
  assert.match(apply, /presentation\.previousCarrierId/,
    'heavy-touch has no new carrier and turnover playerId is the winner; the losing carrier is previousCarrierId');
});

test('action identity is exact-once across command ticks and future chronology cannot poison the ledger', () => {
  const cap = dribblingCapability();
  const action = tick => ({ id: 'same-action-id', type: 'pass', actorId: 'carrier', commandTick: tick, power: 0.6 });
  const first = coreResolve(1, Dribbling.createState({ epoch: 0 }), action(1), cap);
  assert.equal(first.releasedAction?.id, 'same-action-id');
  const duplicate = coreResolve(2, first.state, action(2), cap);
  assert.equal(duplicate.releasedAction, null, 'the same stable action ID must never execute twice even if commandTick changes');

  const futureCap = dribblingCapability();
  let future;
  try {
    future = coreResolve(1, Dribbling.createState({ epoch: 0 }), action(100), futureCap);
  } catch (error) {
    assert.match(String(error && error.message), /command|future|tick/i);
    return;
  }
  assert.equal(future.releasedAction, null, 'future-dated input must be rejected rather than executed');
  assert.ok(future.state.consumedActionHighWaterTick <= 1, 'future input must not suppress subsequent legitimate actions');
});

test('pure planning cannot freeze or alias caller-owned nested Ball metadata', () => {
  const metadata = { review: { mutable: true } };
  const inputBall = Ball.createBallState({
    id: 'metadata-ball', position: { x: 40.42, y: 0, z: 0.11 }, velocity: { x: 0, y: 0, z: 0 },
    grounded: true, regime: Ball.REGIMES.CONTROLLED, metadata
  });
  const nestedInput = inputBall.metadata.review;
  assert.equal(Object.isFrozen(nestedInput), false);
  const output = coreResolve(1, Dribbling.createState({ epoch: 0 }), null, dribblingCapability(), inputBall);
  assert.notEqual(output.ballState.metadata.review, nestedInput, 'result metadata must not alias caller state');
  assert.equal(Object.isFrozen(nestedInput), false, 'deep-freezing a result must not mutate caller state');
});

test('one public frame can reserve at most one prepared transaction', () => {
  const live = adapterAttachment(), frame = live.planTick(adapterSnapshot());
  assert.ok(frame);
  const first = live.prepareCommit(frame), second = live.prepareCommit(frame);
  assert.ok(first);
  assert.equal(second, null, 'preparing the same frame twice would permit duplicate host mutation and committed tick counts');
});

test('bounded exact-once bookkeeping permits more than 32 legitimate actions in a match', () => {
  const cap = dribblingCapability();
  let state = Dribbling.createState({ epoch: 0 });
  for (let tick = 1; tick <= 40; tick += 1) {
    const action = {
      id: `legitimate-action-${tick}`, type: 'pass', actorId: 'carrier',
      commandTick: tick, power: 0.6
    };
    const output = coreResolve(tick, state, action, cap);
    assert.equal(output.releasedAction?.id, action.id, `legitimate action ${tick} must not saturate a lifetime ledger`);
    state = output.state;
  }
  assert.equal(state.consumedActionIds.length, 40, 'legitimate identities must remain exact-once after the old 32-action boundary');
  assert.ok(state.consumedActionIds.length <= 2048, 'the exact-once ledger remains finitely bounded');
});

test('an old finalized transaction cannot roll back after a newer tick commits', () => {
  const live = adapterAttachment();
  const firstSnapshot = adapterSnapshot();
  const firstFrame = live.planTick(firstSnapshot), firstPrepared = live.prepareCommit(firstFrame);
  assert.ok(firstPrepared);
  assert.equal(live.applyPrepared(firstPrepared), true);
  assert.equal(live.finalizePrepared(firstPrepared), true);

  const secondSnapshot = advanceAdapterSnapshot(firstSnapshot, firstFrame.hostProjection, 2);
  const secondFrame = live.planTick(secondSnapshot), secondPrepared = live.prepareCommit(secondFrame);
  assert.ok(secondPrepared);
  assert.equal(live.applyPrepared(secondPrepared), true);
  assert.equal(live.finalizePrepared(secondPrepared), true);
  assert.deepEqual(
    { enabled: live.status().enabled, lastCommittedTick: live.status().lastCommittedTick, committedTicks: live.status().committedTicks },
    { enabled: true, lastCommittedTick: 2, committedTicks: 2 }
  );

  assert.equal(live.rollbackPrepared(firstPrepared, 'late rollback probe'), false);
  const after = live.status();
  assert.deepEqual(
    { enabled: after.enabled, lastCommittedTick: after.lastCommittedTick, committedTicks: after.committedTicks },
    { enabled: true, lastCommittedTick: 2, committedTicks: 2 },
    'a stale rollback token must be inert and must not rewind or disable a newer committed state'
  );
});
