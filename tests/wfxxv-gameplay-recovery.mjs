import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchSource = fs.readFileSync(path.join(root, 'match-engine', 'match.html'), 'utf8');

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

test('missed authored crosses expire only after the contact window and grounding', () => {
  const source = sourceBetween(matchSource, 'const AUTHORED_CROSS_FLIGHTS', 'function assignAerialRuns');
  const context = vm.createContext({ clamp, lastTouch: 'you', logEvent() {}, clearAerialAssignments() {} });
  vm.runInContext(`${source};this.decide=missedCrossRouteExpiryDecision;`, context);
  const base = {
    owner: null,
    target: { id: 'runner' },
    flightType: 'ground',
    crossSourceFlight: 'free-kick-cross',
    crossRouteExpired: false,
    crossNoContactLogged: true,
    flightAge: 54,
    crossContactFrame: 42,
    minAerialFlightAge: 18,
    z: 18,
    zv: -1
  };
  assert.equal(context.decide(base).expire, false, 'airborne service must retain its authored route');
  const grounded = context.decide({ ...base, z: 0, zv: 0 });
  assert.equal(grounded.expire, true);
  assert.equal(grounded.reason, 'no-contact-grounded');
  assert.equal(context.decide({ ...base, z: 0, zv: 0, owner: { id: 'receiver' } }).expire, false,
    'an acquired cross cannot be converted back into a loose ball');
  assert.equal(context.decide({ ...base, z: 0, zv: 0, crossRouteExpired: true }).reason, 'already-expired');
  assert.match(matchSource, /resolveAerialDuel\(false\);expireMissedCrossRoute\(ball\)/,
    'the expiry decision is not wired into live post-contact ball handling');
});

test('normal X registers only a physically reachable reader without steering the authored flight', () => {
  const assistanceSource = sourceBetween(matchSource, 'const HUMAN_PASS_ASSISTANCE', 'function humanAssistedMeetingPoint');
  const context = vm.createContext({ clamp, worldDistanceMetres: (dx, dy) => Math.hypot(dx, dy) / 32 });
  vm.runInContext(`${assistanceSource};this.staticCandidate=humanPassChannelCandidate;this.runnerCandidate=humanNormalPassReceiverCandidate;`, context);
  const src = { x: 2248.6, y: 1754.9 };
  const runner = { id: 'runner', x: 2310, y: 1120, vx: 0, vy: 1.3, attrs: { pace: 84, reactions: 86 } };
  const aim = { x: .113, y: -.994 };
  const requestedDistance = 503.8;
  assert.equal(context.staticCandidate(src, runner, aim, requestedDistance, 'pass', 1).eligible, false,
    'fixture must characterize the previous static power-window miss');
  const authoredPoint = { x: src.x + aim.x * requestedDistance, y: src.y + aim.y * requestedDistance };
  const rendezvous = context.runnerCandidate(src, runner, aim, authoredPoint,
    { predictedArrivalTicks: 92, model: 'test-mr-arrival' }, 1);
  assert.equal(rendezvous.eligible, true, JSON.stringify(rendezvous));
  assert.equal(rendezvous.reason, 'active-receiver-reaches-authored-ground-meeting');

  const passSource = sourceBetween(matchSource, 'function doPassForHuman', 'function doPass(power=0.5)');
  const chaseBlock = sourceBetween(passSource, 'let chaseOnly=false', 'if(chaseOnly)');
  assert.match(chaseBlock, /humanNormalPassReceiverCandidate/);
  assert.doesNotMatch(chaseBlock, /\btx\s*=|\bty\s*=/,
    'receiver rendezvous recognition must not rewrite the user-authored endpoint');
  assert.match(passSource, /mode:'chase-only',[^}]*trajectoryChanged:false/);
  assert.match(passSource, /if\(isSecond\)[\s\S]*controlledOpp=best[\s\S]*controlled=best/,
    'the one allowed assistance is the automatic receiver switch');
});

test('a clean unpressured short kick-off receipt is promoted from retained loose contact to possession', () => {
  const source = sourceBetween(matchSource, 'function cleanKickoffReceptionDecision', 'function liveV2ApplyContact');
  const context = vm.createContext({ PITCH_UNITS_PER_METRE: 32, Math });
  vm.runInContext(`${source};this.decide=cleanKickoffReceptionDecision;`, context);
  const actor = { id: 'receiver', team: 'you' };
  const passer = { id: 'passer', team: 'you' };
  const state = { target: actor, lastKicker: passer, flightType: 'kick-off', flightAge: 6, z: 0, vx: 2.6, vy: 0 };
  const presentation = { playerId: actor.id, outcome: 'retained', possessionDisposition: 'remain-loose' };
  const result = { contactType: 'first-touch', ownerCandidateId: null };
  const clean = context.decide(state, actor, presentation, result, 132);
  assert.equal(clean.secure, true, JSON.stringify(clean));
  assert.equal(clean.reason, 'clean-unpressured-short-kickoff');
  assert.equal(context.decide(state, actor, presentation, result, 60).secure, false, 'pressure must retain normal first-touch risk');
  assert.equal(context.decide(state, actor, { ...presentation, outcome: 'heavy' }, result, 132).secure, false,
    'a visibly heavy kick-off touch must remain loose');

  const transaction = sourceBetween(matchSource, 'function liveV2PrepareHostTick', 'function liveV2RunTick');
  assert.match(transaction, /liveV2ApplyDribbling\(projection\);liveV2ApplyCpuTouches\(projection\);finalizeCleanKickoffReception\(ball\)/,
    'possession finalization must run after V2 dribbling so it cannot be erased in the same transaction');
  assert.match(source, /state\.owner=actor;state\.target=null/);
});

test('directional knock-on preserves the V1.5 free roll with a physical re-acquire window', () => {
  const source = sourceBetween(matchSource, 'const DIRECTIONAL_KNOCK_ON_FORWARD_COS', 'function performDirectionalKnockOn');
  const context = vm.createContext({
    clamp,
    rad: 12.75,
    BALLR: 6,
    facing: player => ({ x: player.fx ?? 1, y: player.fy ?? 0 }),
    worldDistanceMetres: (dx, dy) => Math.hypot(dx / 32, dy / 32),
    worldBallSpeedForMetresPerSecond: value => value / 1.875
  });
  vm.runInContext(`${source};this.plan=directionalKnockOnPlan;this.decide=directionalKnockOnRecoveryDecision;`, context);
  const player = { id: 'carrier', team: 'you', x: 1000, y: 1000, vx: 2, vy: 0, attrs: { control: 86, pace: 84 } };
  const plan = context.plan(player, { x: 1, y: 0 });
  assert.equal(plan.valid, true);
  assert.ok(plan.touchDistance / 32 >= 3.2 && plan.touchDistance / 32 <= 3.8,
    `single flick requested ${plan.touchDistance / 32}m`);
  assert.ok(plan.touchPaceMps >= 8 && plan.touchPaceMps <= 10,
    `single flick launch pace ${plan.touchPaceMps}m/s is not a controlled heavy touch`);
  assert.ok(plan.maximumTravelDistance >= plan.touchDistance * 4.9,
    'the emergency ceiling collapsed the old free-roll window');
  assert.ok(plan.durationFrames >= 150,
    'the physical chase window ends before a natural run-on can occur');

  const sprinter = { ...player, vx: 4.693, vy: 0, gait: 'sprint' };
  const light = context.plan(sprinter, { x: .75, y: 0 }, { sprint: true });
  const strong = context.plan(sprinter, { x: .95, y: 0 }, { sprint: true });
  const double = context.plan(sprinter, { x: .95, y: 0 }, { sprint: true, double: true });
  assert.equal(light.tier, 'sprint-forward-light');
  assert.equal(strong.tier, 'sprint-forward-strong');
  assert.equal(double.tier, 'sprint-forward-double');
  assert.deepEqual([light.touchDistanceMetres, strong.touchDistanceMetres, double.touchDistanceMetres], [3.4, 5.5, 8.5]);
  assert.deepEqual([light.groundDampingModel, strong.groundDampingModel, double.groundDampingModel],
    ['progressive-ground-strike-v2', 'progressive-ground-strike-v2', 'progressive-ground-strike-v2'],
    'sprint-forward variants must decelerate through an MR turf curve rather than the emergency ceiling');
  assert.ok(light.touchPaceMps < strong.touchPaceMps && strong.touchPaceMps < double.touchPaceMps,
    'the physical sprint-touch impulse must rise monotonically with the gesture');
  assert.ok(light.topSpinRpm > 0 && strong.topSpinRpm > light.topSpinRpm && double.topSpinRpm > strong.topSpinRpm,
    'the forward roll must remain coupled to launch pace');

  const atBoundary = context.plan(sprinter,
    { x: Math.cos(75 * Math.PI / 180) * .95, y: Math.sin(75 * Math.PI / 180) * .95 }, { sprint: true });
  const outsideBoundary = context.plan(sprinter,
    { x: Math.cos(75.5 * Math.PI / 180) * .95, y: Math.sin(75.5 * Math.PI / 180) * .95 }, { sprint: true });
  assert.equal(atBoundary.tier, 'sprint-forward-strong', 'the complete 150-degree forward sector is enhanced');
  assert.equal(outsideBoundary.tier, 'baseline-free-roll', 'the genuine anti-directional sector stays on the accepted baseline');
  const jogging = context.plan({ ...sprinter, vx: 3.1 }, { x: .95, y: 0 }, { sprint: true });
  assert.equal(jogging.tier, 'baseline-free-roll', 'holding sprint before reaching a real sprint cannot inflate the touch');

  const startedAt = 100;
  const contract = {
    playerId: player.id,
    startedAt,
    expiresAt: startedAt + plan.durationFrames,
    reacquireAfter: startedAt + 7,
    startX: plan.startX,
    startY: plan.startY,
    targetX: plan.targetX,
    targetY: plan.targetY,
    nx: plan.nx,
    ny: plan.ny,
    distance: plan.touchDistance,
    reacquireMinimumDistance: plan.reacquireMinimumDistance,
    maximumTravelDistance: plan.maximumTravelDistance
  };
  const freeRollTail = {
    owner: null, target: player, flightType: 'ground', z: 0, zv: 0,
    x: plan.startX + plan.touchDistance * 1.8, y: plan.startY,
    vx: plan.touchPace, vy: 0, directionalKnockOnContract: contract
  };
  const tail = context.decide(freeRollTail, player, startedAt + 18, 180);
  assert.equal(tail.atLimit, false, JSON.stringify(tail));
  assert.equal(tail.passedReference, true, JSON.stringify(tail));
  assert.equal(tail.reason, 'free-roll-tail');

  const safetyTravel = { ...freeRollTail, x: plan.startX + plan.maximumTravelDistance * 1.01 };
  const limit = context.decide(safetyTravel, player, startedAt + 90, 180);
  assert.equal(limit.atLimit, true, JSON.stringify(limit));
  assert.equal(limit.reason, 'physical-safety-limit');

  const meetingX = plan.startX + plan.touchDistance * .65;
  const chasingPlayer = { ...player, x: meetingX - 20 };
  const meeting = context.decide({ ...freeRollTail, x: meetingX }, chasingPlayer, startedAt + 18, 180);
  assert.equal(meeting.reacquire, true, JSON.stringify(meeting));
  assert.equal(meeting.reason, 'physical-reacquire');
  assert.doesNotMatch(source, /ERA_MATCH\.groundGrip|groundFriction|rollingResistance/,
    'the knock-on fix must not retune shared Magnus-Reynolds drag');
  assert.match(matchSource, /expireMissedCrossRoute\(ball\);reconcileDirectionalKnockOn\(ball,clockFrames\)/);
});

test('the protected ground-Triangle golden flight constants remain unchanged', () => {
  const throughSource = sourceBetween(matchSource, 'function doThroughPassFor', 'function doLobPassFor');
  assert.match(throughSource, /speed=overTop\?[^:]+:clamp\(7\.2\+distance\*\.0045\+p\*2\.0,7\.8,13\.8\)/);
  assert.match(throughSource, /baseLoft=overTop\?clamp\(trajectory\.loft\*\.88,3\.1,7\.8\):drivenTechnique&&drivenTechnique\.variant==='knuckle-skimmer'\?\.22:\.10/);
  assert.match(throughSource, /groundTrajectory=!overTop&&!flair\?\(driven\?humanDrivenGroundThroughTrajectory\(p,groundDistanceMetres,drivenTechnique\.variant\):humanGroundThroughTrajectory\(p,groundDistanceMetres\)\):null/,
    'ordinary Triangle keeps its protected ground trajectory outside the separate R1 branch');
  assert.doesNotMatch(sourceBetween(matchSource, 'function doPassForHuman', 'function doPass(power=0.5)'), /doThroughPassFor\s*\(/);
});
