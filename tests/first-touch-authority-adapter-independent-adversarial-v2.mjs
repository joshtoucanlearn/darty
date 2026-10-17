import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const files = {
  movement: path.join(root, 'match-engine', 'movement-engine-v2.js'),
  ball: path.join(root, 'match-engine', 'ball-engine-v2.js'),
  touch: path.join(root, 'match-engine', 'first-touch-v2.js'),
  adapter: path.join(root, 'match-engine', 'first-touch-authority-adapter-v2.js'),
  match: path.join(root, 'match-engine', 'match.html')
};
const bytes = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, fs.readFileSync(value)]));
const source = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, value.toString('utf8')]));
const require = createRequire(import.meta.url);
const Ball = require(files.ball);
const Adapter = require(files.adapter);

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function capability(workflow = 'offline-v2-lab') {
  return Adapter.createCapability({
    enabled: true,
    online: false,
    liveAuthority: false,
    workflow,
    acknowledgement: Adapter.ACKNOWLEDGEMENT
  });
}

function finiteTree(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteTree);
  if (value && typeof value === 'object') return Object.values(value).every(finiteTree);
  return true;
}

test('freeze and dependency bytes match the independently reviewed versions', () => {
  assert.equal(sha256(bytes.adapter), '2c6bf8b63e327c653556d73ec4c820b742038e63fb1f46217ef912eccec432f2');
  assert.equal(sha256(bytes.movement), 'e8848db45518ef54ed5cec5e65091160605decfb9995d23b9769395f1eafa0b3');
  assert.equal(sha256(bytes.ball), 'e2b6776a12ebcf8353e322c181e2f38dbb18c1c41d10c1cebf134418a296a819');
  assert.equal(sha256(bytes.touch), 'f548c5c33c0d82ce044ebb083ec6deac0deb212f8287608f77e490794894152c');
  assert.equal(Ball.ENGINE_NAME, 'Magnus Reynolds (MR) Engine');
  assert.equal(Ball.VERSION, '2.0.0-shadow');
  assert.equal(Ball.STATE_SCHEMA, 'football-legacy-ball-v2-state');
  assert.equal(typeof Ball.resolvePassiveBodyDeflection, 'function');
  assert.match(source.adapter, /Movement\.VERSION !== '2\.0\.0-dormant'/);
  assert.match(source.adapter, /Ball\.VERSION !== '2\.0\.0-shadow'/);
  assert.match(source.adapter, /FirstTouch\.VERSION !== '2\.0\.0-dormant'/);
});

test('missing or wrong-version browser dependencies fail before capability or resolution', () => {
  const context = vm.createContext({});
  vm.runInContext('this.window = this;', context);
  vm.runInContext(source.adapter, context, { filename: files.adapter });
  assert.throws(() => vm.runInContext(`FootballLegacyFirstTouchAuthorityAdapterV2.createCapability({
    enabled: true, online: false, liveAuthority: false, workflow: 'offline-v2-lab',
    acknowledgement: FootballLegacyFirstTouchAuthorityAdapterV2.ACKNOWLEDGEMENT
  })`, context), /Movement Engine V2 is required/);
});

test('MR and First Touch are conditionally composed by exact offline FL V2 without static live-authority loading', () => {
  const livePreflight = source.match.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)?.[1] || '';
  assert.match(livePreflight, /if\(!eligible\)return;[\s\S]*'ball-engine-v2\.js'/);
  assert.match(livePreflight, /if\(!eligible\)return;[\s\S]*'first-touch-authority-adapter-v2\.js'/);
  assert.doesNotMatch(source.match, /<script[^>]+src=["'](?:ball-engine-v2|first-touch-authority-adapter-v2)\.js/);
  assert.equal(Object.keys(Adapter).some(key => /apply|commit|consume|mutate|live/i.test(key)), false);
  const result = Adapter.resolve(Adapter.createCleanReceptionFixture(), capability());
  assert.equal(result.liveApplied, false);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.handoff.liveApplied, false);
  assert.equal(result.handoff.advisoryOnly, true);
  assert.equal(Object.keys(result).some(key => /apply|commit|consume/i.test(key)), false);
  assert.equal(Object.keys(result.handoff).some(key => /apply|commit|consume/i.test(key)), false);
});

test('structurally exact forged capability and workflow mismatch fail closed', () => {
  const request = Adapter.createCleanReceptionFixture();
  const issued = capability();
  const forged = structuredClone(issued);
  assert.throws(() => Adapter.resolve(request, forged), /matching issued/);
  assert.throws(() => Adapter.resolve(request, capability('shadow')), /matching issued/);
});

test('missing receiver and identity/team/profile substitution fail closed', () => {
  const missing = Adapter.createCleanReceptionFixture();
  missing.receiverPlayerId = 'missing';
  assert.throws(() => Adapter.resolve(missing, capability()), /must reference/);

  const identity = Adapter.createCleanReceptionFixture();
  identity.receiverProfile.playerId = 'defender';
  assert.throws(() => Adapter.resolve(identity, capability()), /identity and team/);

  const sharedAuthority = Adapter.createCleanReceptionFixture();
  sharedAuthority.receiverProfile.position = { x: 0, y: 0 };
  assert.throws(() => Adapter.resolve(sharedAuthority, capability()), /only supplement/);
});

test('sent-off or unavailable receiver must not be contact-eligible', () => {
  const request = Adapter.createCleanReceptionFixture();
  const receiver = request.movementWorld.players.find(player => player.id === request.receiverPlayerId);
  receiver.sentOff = true;
  receiver.available = false;
  request.rosterEligibility = {
    playerId: receiver.id,
    teamId: receiver.teamId,
    sentOff: true,
    available: false,
    eligibleForContact: false
  };
  assert.throws(() => Adapter.resolve(request, capability()), /sent.?off|available|eligible/i,
    'a dismissed receiver must never receive a pending possession/contact handoff');
});

test('existing Movement owner, hasBall flag and controlled Ball regime each fail closed', () => {
  const movementOwned = Adapter.createCleanReceptionFixture();
  movementOwned.movementWorld.ballOwnerId = 'receiver';
  movementOwned.movementWorld.players.find(player => player.id === 'receiver').hasBall = true;
  assert.throws(() => Adapter.resolve(movementOwned, capability()), /loose ball/);

  const strayHasBall = Adapter.createCleanReceptionFixture();
  strayHasBall.movementWorld.players.find(player => player.id === 'defender').hasBall = true;
  assert.throws(() => Adapter.resolve(strayHasBall, capability()), /loose ball/);

  const ballControlled = Adapter.createCleanReceptionFixture();
  ballControlled.ball = Ball.createBallState({ ...ballControlled.ball, regime: Ball.REGIMES.CONTROLLED });
  assert.throws(() => Adapter.resolve(ballControlled, capability()), /controlled Ball/);
});

test('SI coordinate, fixed tick, world tick and Ball outer tick continuity are exact', () => {
  const coordinate = Adapter.createCleanReceptionFixture();
  coordinate.coordinateSystem = 'metres-positive-y-down';
  assert.throws(() => Adapter.resolve(coordinate, capability()), /coordinate system/);

  const fixed = Adapter.createCleanReceptionFixture();
  fixed.movementWorld.fixedTickSeconds = 1 / 30;
  assert.throws(() => Adapter.resolve(fixed, capability()), /fixedTickSeconds/);

  const world = Adapter.createCleanReceptionFixture();
  world.movementWorld.tick -= 1;
  assert.throws(() => Adapter.resolve(world, capability()), /movementWorld\.tick/);

  const ball = Adapter.createCleanReceptionFixture();
  ball.ball.lastOuterTick -= 1;
  assert.throws(() => Adapter.resolve(ball, capability()), /lastOuterTick/);
});

test('same-tick contacted loose Ball cannot be handed off a second time', () => {
  const firstRequest = Adapter.createPressuredHeavyTouchFixture();
  const first = Adapter.resolve(firstRequest, capability());
  assert.equal(first.status, 'pending');
  assert.equal(first.outcome, 'loose');

  const secondRequest = structuredClone(firstRequest);
  secondRequest.ball = structuredClone(first.handoff.contact.ballState);
  secondRequest.consumedHandoffIds = [first.candidateHandoffId];
  assert.throws(() => Adapter.resolve(secondRequest, capability()), /same.?tick|already.*contact|stale|consumed/i,
    'lastContact.outerTick equal to request.tick must block a second contact handoff');
});

test('exact-once contact identity cannot be bypassed by changing seed after consumption', () => {
  const request = Adapter.createCleanReceptionFixture();
  const first = Adapter.resolve(request, capability());
  const replayVariant = structuredClone(request);
  replayVariant.seed += 1;
  replayVariant.consumedHandoffIds = [first.candidateHandoffId];
  const second = Adapter.resolve(replayVariant, capability());
  assert.notEqual(second.status, 'pending', 'same tick/ball/contact-count/receiver must not emit a second pending handoff');
  assert.equal(second.candidateHandoffId, first.candidateHandoffId,
    'exact-once identity must be authority-event based, not seed/result based');
});

test('exact-once contact identity cannot be bypassed by caller-selected pressure subset', () => {
  const request = Adapter.createPressuredHeavyTouchFixture();
  const first = Adapter.resolve(request, capability());
  const replayVariant = structuredClone(request);
  replayVariant.pressurePlayerIds = [];
  replayVariant.consumedHandoffIds = [first.candidateHandoffId];
  const second = Adapter.resolve(replayVariant, capability());
  assert.notEqual(second.status, 'pending', 'same contact opportunity must not mint a new ID from pressure selection');
  assert.equal(second.candidateHandoffId, first.candidateHandoffId);
});

test('identical replay is byte-stable and rollback-owned ledger suppresses then restores exactly', () => {
  const request = Adapter.createReplayRollbackFixture();
  const first = Adapter.resolve(request, capability());
  assert.equal(Adapter.stableJson(Adapter.resolve(structuredClone(request), capability())), Adapter.stableJson(first));

  const consumedRequest = structuredClone(request);
  consumedRequest.consumedHandoffIds = [first.candidateHandoffId];
  const consumed = Adapter.resolve(consumedRequest, capability());
  assert.equal(consumed.status, 'already-consumed');
  assert.equal(consumed.handoff, null);
  assert.equal(consumed.candidateHandoffId, first.candidateHandoffId);

  const rolledBack = Adapter.resolve(structuredClone(request), capability());
  assert.equal(Adapter.stableJson(rolledBack), Adapter.stableJson(first));
});

test('pressure identity is unique, opposing and input-order invariant', () => {
  const request = Adapter.createPressuredHeavyTouchFixture();
  const first = Adapter.resolve(request, capability());
  const reversed = structuredClone(request);
  reversed.pressurePlayerIds.reverse();
  assert.equal(Adapter.stableJson(Adapter.resolve(reversed, capability())), Adapter.stableJson(first));

  const duplicate = structuredClone(request);
  duplicate.pressurePlayerIds.push(duplicate.pressurePlayerIds[0]);
  assert.throws(() => Adapter.resolve(duplicate, capability()), /unique/);

  const teammate = Adapter.createCleanReceptionFixture();
  teammate.pressurePlayerIds = ['receiver'];
  assert.throws(() => Adapter.resolve(teammate, capability()), /opposing team/);
});

test('hostile getters, cycles, reserved keys and symbols are rejected without invocation', () => {
  const getter = Adapter.createCleanReceptionFixture();
  let invoked = 0;
  Object.defineProperty(getter.ball.metadata, 'trap', {
    enumerable: true,
    get() { invoked += 1; return 1; }
  });
  assert.throws(() => Adapter.resolve(getter, capability()), /stable enumerable data property/);
  assert.equal(invoked, 0);

  const cyclic = Adapter.createCleanReceptionFixture();
  cyclic.ball.metadata.self = cyclic.ball.metadata;
  assert.throws(() => Adapter.resolve(cyclic, capability()), /cycles/);

  const reserved = Adapter.createCleanReceptionFixture();
  Object.defineProperty(reserved.ball.metadata, '__proto__', { enumerable: true, value: {} });
  assert.throws(() => Adapter.resolve(reserved, capability()), /reserved key/);

  const symbol = Adapter.createCleanReceptionFixture();
  symbol.ball.metadata[Symbol('unsafe')] = 1;
  assert.throws(() => Adapter.resolve(symbol, capability()), /symbol keys/);
});

test('huge finite values fail before overflow and no non-finite telemetry can escape', () => {
  const ball = Adapter.createCleanReceptionFixture();
  ball.ball.velocity.x = Number.MAX_VALUE;
  assert.throws(() => Adapter.resolve(ball, capability()), /safe envelope|magnitude|finite|range/i);

  const player = Adapter.createCleanReceptionFixture();
  player.movementWorld.players.find(entry => entry.id === 'receiver').position.x = Number.MAX_VALUE;
  assert.throws(() => Adapter.resolve(player, capability()), /SI safety envelope|pitch bounds/);

  const profile = Adapter.createCleanReceptionFixture();
  profile.receiverProfile.technique = Number.MAX_VALUE;
  assert.throws(() => Adapter.resolve(profile, capability()), /within/);
});

test('bounded telemetry remains finite/frozen and cannot carry live authority methods', () => {
  const request = Adapter.createPressuredHeavyTouchFixture();
  const result = Adapter.resolve(request, capability());
  assert.equal(finiteTree(result), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sourceTelemetry), true);
  assert.equal(Object.isFrozen(result.handoff.contact.ballState), true);
  assert.ok(JSON.stringify(result).length < 50000);
  assert.doesNotMatch(JSON.stringify(result), /Infinity|NaN/);
  assert.equal(typeof result.apply, 'undefined');
  assert.equal(typeof result.commit, 'undefined');
  assert.equal(typeof result.consume, 'undefined');
});
