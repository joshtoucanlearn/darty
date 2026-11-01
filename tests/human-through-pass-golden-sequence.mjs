import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchPath = path.join(root, 'match-engine', 'match.html');
const matchSource = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(path.join(root, 'match-engine', 'ball-engine-v2.js'));
const Movement = require(path.join(root, 'match-engine', 'movement-engine-v2.js'));
const Dribbling = require(path.join(root, 'match-engine', 'dribbling-state-v2.js'));
const FirstTouch = require(path.join(root, 'match-engine', 'first-touch-v2.js'));

const GOLDEN = Object.freeze({
  sourceLog: 'football-legacy-playtest-FL-MSQ1ILVP',
  pressFrame: 6704,
  releaseFrame: 6712,
  pressToReleaseMs: 95,
  chargeDivisorMs: 760,
  source: Object.freeze({ x: 1927.4, y: 585.0 }),
  release: Object.freeze({ x: 1947.5, y: 599.4 }),
  receiverAtRelease: Object.freeze({ x: 2238.4, y: 675.2 }),
  landing: Object.freeze({ x: 2399.5, y: 682.8 }),
  receptionFrame: 6842,
  receptionBall: Object.freeze({ x: 2707.7, y: 741.4 }),
  receptionPlayer: Object.freeze({ x: 2708.9, y: 814.6 }),
  leadHostUnits: 159.1,
  launchPaceHostPerTick: 9.52,
  arrivalPaceHostPerTick: 4.06,
  arrivalFrames: 130,
  shootPressFrame: 6897,
  shootReleaseFrame: 6921,
  shotPower: 0.4
});

const W = Math.round(3200 * 1.045);
const H = Math.round(2050 * 1.045);
const M = Math.round(80 * 1.045);
const PITCH_UNITS_PER_METRE = (H - 12) / 68;
const X_PER_METRE = (W - 2 * M) / 105;
const Y_PER_METRE = H / 68;
const triangleChargeDurationMatch = matchSource.match(/TRIANGLE_CHARGE_DURATION_MS=(\d+)/);
assert.ok(triangleChargeDurationMatch, 'missing Triangle charge duration');
const TRIANGLE_CHARGE_DURATION_MS = Number(triangleChargeDurationMatch[1]);

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

function unit(vector) {
  const magnitude = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function currentControllerThroughCharge(heldMs) {
  const controllerSource = sourceBetween(
    matchSource,
    'function controllerThroughDown',
    'function controllerTackleTap'
  );
  let now = 10_000;
  let releaseCall = null;
  const source = { id: 'ars-bergkamp' };
  const state = {
    currentButtons: [],
    throughCharging: false,
    throughOverTop: false,
    throughFlair: false,
    throughChargeStartedAt: 0,
    l1UsedAsModifier: false
  };
  const context = vm.createContext({
    gamepadExternalInputLocked: () => false,
    paused: false,
    started: true,
    hasBall: player => player === source,
    liveV2DribbleLeaseOwns: () => false,
    controller2Skill: () => {},
    controllerSkill: () => {},
    performance: { now: () => now },
    clamp,
    TRIANGLE_CHARGE_DURATION_MS,
    doThroughPassFor: (...args) => {
      releaseCall = args;
      return { captured: true };
    }
  });
  vm.runInContext(`${controllerSource}\nthis.controllerThroughDown=controllerThroughDown;this.controllerThroughUp=controllerThroughUp;`, context, {
    filename: 'current-human-through-charge.vm.js'
  });
  assert.equal(context.controllerThroughDown(state, source, false), 'through-ball');
  now += heldMs;
  assert.deepEqual(context.controllerThroughUp(state, source, false), { captured: true });
  return {
    power: releaseCall[3],
    overTop: releaseCall[2],
    flair: releaseCall[4]
  };
}

function movementWorld(tick, carrierId, carrierPosition, ballOwnerId = null) {
  return Movement.createWorldState({
    tick,
    fixedTickSeconds: 1 / 60,
    bounds: { xMin: -20, xMax: 120, yMin: -40, yMax: 40 },
    ballOwnerId,
    players: [
      {
        id: carrierId,
        teamId: 'you',
        role: 'ST',
        position: carrierPosition,
        velocity: { x: 0, y: 0 },
        facing: { x: 1, y: 0 },
        radius: 0.34,
        attributes: {
          control: 98, technique: 98, agility: 98, pace: 98,
          acceleration: 99, balance: 95, strength: 86
        }
      },
      {
        id: 'opponent-cb',
        teamId: 'opp',
        role: 'CB',
        position: { x: 12, y: 10 },
        velocity: { x: 0, y: 0 },
        facing: { x: -1, y: 0 },
        radius: 0.34,
        attributes: {
          control: 75, technique: 73, agility: 68, pace: 80,
          acceleration: 75, balance: 82, strength: 97
        }
      }
    ]
  });
}

function dribblingRoster(carrierId) {
  return [
    {
      id: carrierId,
      teamId: 'you',
      isGK: false,
      sentOff: false,
      available: true,
      attributes: { control: 98, technique: 98, agility: 98 }
    },
    {
      id: 'opponent-cb',
      teamId: 'opp',
      isGK: false,
      sentOff: false,
      available: true,
      attributes: { control: 75, technique: 73, agility: 68 }
    }
  ];
}

function dribblingCapability() {
  return Dribbling.createCapability({
    acknowledgement: Dribbling.ACKNOWLEDGEMENT,
    workflow: 'single-player',
    online: false
  });
}

function resolveDribbling({ tick, carrierId, carrierPosition, state, ballState, logicalOwnerId, actionIntent, direction, capability }) {
  return Dribbling.resolve({
    schema: Dribbling.REQUEST_SCHEMA,
    workflow: 'single-player',
    online: false,
    tick,
    epoch: 0,
    seed: 173,
    fixedTickSeconds: 1 / 60,
    state,
    movementWorld: movementWorld(tick, carrierId, carrierPosition, logicalOwnerId),
    ballState,
    roster: dribblingRoster(carrierId),
    logicalOwnerId,
    carrierInput: {
      source: 'human',
      direction,
      intensity: 0.82,
      sprint: false,
      shield: false
    },
    surface: 'dry',
    actionIntent,
    gate: {
      livePlay: true,
      restartActive: false,
      replayActive: false,
      keeperAuthority: false,
      offsideInvolvementPending: false,
      specialActionAuthority: false
    }
  }, capability);
}

function bufferGoldenThroughAction(direction, power) {
  const carrierId = 'ars-bergkamp';
  const capability = dribblingCapability();
  let state = Dribbling.createState({
    epoch: 0,
    phase: Dribbling.PHASES.CHASE_RECOVERY,
    phaseStartedTick: GOLDEN.pressFrame - 1,
    carrierId,
    carrierTeamId: 'you',
    logicalOwnerId: carrierId,
    physicalSeparated: true,
    touchSequence: 12,
    touchTick: GOLDEN.pressFrame - 6,
    nextTouchTick: GOLDEN.releaseFrame + 8,
    leaseUntilTick: GOLDEN.releaseFrame + 8,
    targetSeparationMetres: 0.95,
    lastSeparationMetres: 0.95,
    maxSeparationMetres: 0.95,
    surface: 'dry',
    outcome: 'chasing'
  });
  let ballState = Ball.createBallState({
    id: 'golden-buffer-ball',
    position: { x: 0.96, y: 0, z: 0.11 },
    velocity: { x: 0.4, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.SKID
  });
  const actionIntent = {
    id: 'golden-through-f6704',
    type: 'pass',
    actorId: carrierId,
    targetPlayerId: null,
    direction,
    power,
    variant: 'through',
    source: 'controller-1',
    commandTick: GOLDEN.pressFrame
  };
  const queued = resolveDribbling({
    tick: GOLDEN.pressFrame,
    carrierId,
    carrierPosition: { x: 0, y: 0 },
    state,
    ballState,
    logicalOwnerId: null,
    actionIntent,
    direction,
    capability
  });
  assert.equal(queued.releasedAction, null);
  assert.equal(queued.state.bufferedAction.id, actionIntent.id);
  state = queued.state;
  ballState = Ball.createBallState({
    ...queued.ballState,
    position: { x: 0.34, y: 0, z: 0.11 },
    velocity: { x: 0.1, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.ROLL
  });
  const released = resolveDribbling({
    tick: GOLDEN.releaseFrame,
    carrierId,
    carrierPosition: { x: 0, y: 0 },
    state,
    ballState,
    logicalOwnerId: null,
    actionIntent: null,
    direction,
    capability
  });
  assert.equal(released.state.phase, Dribbling.PHASES.RESECURE);
  assert.equal(released.releasedAction.id, actionIntent.id);
  return released.releasedAction;
}

function throughHarness({ source, teammates, direction, power }) {
  const assistanceSource = sourceBetween(
    matchSource,
    'const HUMAN_PASS_ASSISTANCE',
    'function doPassForHuman'
  );
  const throughSource = sourceBetween(
    matchSource,
    'function doThroughPassFor',
    'function doLobPassFor'
  );
  const launchCalls = [];
  const ball = { owner: source, x: source.x, y: source.y, z: 0, stats: {} };
  let context;
  context = vm.createContext({
    started: true,
    paused: false,
    inReset: () => false,
    liveV2QueueDribbleAction: () => false,
    hasBall: player => ball.owner === player,
    clamp,
    gamepadInput: { moveX: direction.x, moveY: direction.y },
    gamepadInput2: { moveX: 0, moveY: 0 },
    movementInput: () => direction,
    secondMovementInput: () => direction,
    facing: player => unit({ x: player.fx, y: player.fy }),
    attackDirection: () => 1,
    teamList: () => [source, ...teammates],
    nearestOpponentDistance: () => 293.6,
    predictiveLaneRisk: () => 0,
    other: team => team === 'you' ? 'opp' : 'you',
    D: (left, right) => Math.hypot(left.x - right.x, left.y - right.y),
    worldDistanceMetres: (dx, dy) => Math.hypot(dx / X_PER_METRE, dy / Y_PER_METRE),
    worldBallSpeedForMetresPerSecond: (pace, dx, dy) => {
      const magnitude = Math.hypot(dx, dy) || 1;
      const metresPerWorldUnit = Math.hypot((dx / magnitude) / X_PER_METRE, (dy / magnitude) / Y_PER_METRE);
      return clamp(pace, 0, 40) / (60 * Math.max(0.0001, metresPerWorldUnit));
    },
    M,
    W,
    H,
    rad: 12.75,
    ball,
    recordPass: () => {},
    actionPowerPulse: () => {},
    kickSound: () => {},
    showEvent: () => {},
    logEvent: () => {},
    armOffsideCandidate: () => {},
    clearSetPieceTargets: () => {},
    standardLobTrajectory: distance => ({ speed: distance / 50, loft: 4 }),
    flairPassExecution: () => null,
    flairFailureAnimation: () => null,
    launchMatchBall: (actor, point, details) => {
      launchCalls.push({ actor, point: { ...point }, details: { ...details } });
      context.liveV2PendingLaunch = {
        sequence: `test-launch-${launchCalls.length}`,
        sourcePlayerId: actor.id,
        targetPlayerId: details.targetPlayer?.id || null,
        target: { ...point }
      };
      ball.owner = null;
      ball.target = details.targetPlayer || null;
      return true;
    },
    liveV2PendingLaunch: null,
    clockFrames: 1000,
    FootballLegacyBallEngineV2: Ball,
    PITCH_UNITS_PER_METRE,
    restartMsg: '',
    SAME_TEAM_COOP: false,
    AUTO: false,
    primaryHumanTeam: 'you',
    controlled: source,
    controlledOpp: null,
    offsideCandidate: null
  });
  vm.runInContext('Math.random=()=>0.5;', context);
  vm.runInContext(`${assistanceSource}\n${throughSource}\nthis.doThroughPassFor=doThroughPassFor;this.throughMinDot=humanPassAssistanceMinDot('through',1);`, context, {
    filename: 'current-human-through-pass.vm.js'
  });
  const result = context.doThroughPassFor(
    source,
    false,
    false,
    power,
    false,
    null,
    null,
    null,
    null,
    direction
  );
  return {
    result,
    launch: launchCalls[0],
    pendingLaunch: JSON.parse(JSON.stringify(context.liveV2PendingLaunch)),
    controlled: context.controlled,
    minDot: context.throughMinDot
  };
}

function currentGroundThroughTrajectory(power, distanceMetres) {
  const trajectorySource = sourceBetween(
    matchSource,
    'function measureHumanGroundPassRendezvous',
    'function humanGroundPassMeetingWithinRange'
  );
  const context = vm.createContext({ clamp, FootballLegacyBallEngineV2: Ball, PITCH_UNITS_PER_METRE });
  vm.runInContext(`${trajectorySource}\nthis.humanGroundThroughTrajectory=humanGroundThroughTrajectory;`, context, {
    filename: 'current-human-ground-through-trajectory.vm.js'
  });
  return JSON.parse(JSON.stringify(context.humanGroundThroughTrajectory(power, distanceMetres)));
}

function currentGroundThroughRange(power) {
  const rangeSource = sourceBetween(
    matchSource,
    'function humanGroundThroughAuthoredRangeMetres',
    'function humanGroundThroughTrajectory'
  );
  const context = vm.createContext({ clamp });
  vm.runInContext(`${rangeSource}\nthis.humanGroundThroughAuthoredRangeMetres=humanGroundThroughAuthoredRangeMetres;`, context, {
    filename: 'current-human-ground-through-range.vm.js'
  });
  return context.humanGroundThroughAuthoredRangeMetres(power);
}

function currentGroundPassTrajectory(power, distanceMetres) {
  const trajectorySource = sourceBetween(
    matchSource,
    'function measureHumanGroundPassRendezvous',
    'function humanGroundThroughTrajectory'
  );
  const context = vm.createContext({ clamp, FootballLegacyBallEngineV2: Ball, PITCH_UNITS_PER_METRE });
  vm.runInContext(`${trajectorySource}\nthis.humanGroundPassTrajectory=humanGroundPassTrajectory;`, context, {
    filename: 'current-human-ground-pass-trajectory.vm.js'
  });
  return JSON.parse(JSON.stringify(context.humanGroundPassTrajectory(power, distanceMetres)));
}

function runMetricGroundRendezvous(distanceMetres, trajectory) {
  const launch = Ball.resolveLaunch({
    id: 'ground-through-matrix',
    origin: { x: 0, y: 0, z: 0.11 + 1 / PITCH_UNITS_PER_METRE },
    target: { x: distanceMetres, y: 0, z: 0.11 },
    speed: trajectory.launchPaceMps,
    liftAngleDeg: 0,
    sideSpinRpm: 0,
    topSpinRpm: 0,
    axialSpinRpm: 0,
    source: 'ground-through-ball',
    metadata: trajectory.groundDampingModel ? {
      groundDampingModel: trajectory.groundDampingModel,
      groundDampingInitialPerSecond: trajectory.groundDampingInitialPerSecond,
      groundDampingRampScale: trajectory.groundDampingRampScale,
      groundDampingRampExponent: trajectory.groundDampingRampExponent,
      groundDampingOriginX: 0,
      groundDampingOriginY: 0,
      groundDampingReferenceDistanceMetres: trajectory.groundDampingReferenceDistanceMetres,
      groundDampingMaximumProgress: trajectory.groundDampingMaximumProgress,
      groundSkidFrictionScale: trajectory.groundSkidFrictionScale,
      groundLinearDampingUntilSeconds: trajectory.groundLinearDampingUntilSeconds
    } : undefined
  });
  let state = launch.state;
  let context = Ball.createSimulationContext({ seed: 173 });
  for (let tick = 0; tick < trajectory.predictedArrivalTicks; tick += 1) {
    const output = Ball.step(state, context, 1 / 60);
    state = output.state;
    context = output.context;
  }
  return state;
}

function runMetricGroundRollout(distanceMetres, trajectory) {
  const launch = Ball.resolveLaunch({
    id: 'ground-profile-rollout',
    origin: { x: 0, y: 0, z: 0.11 + 1 / PITCH_UNITS_PER_METRE },
    target: { x: distanceMetres, y: 0, z: 0.11 },
    speed: trajectory.launchPaceMps,
    liftAngleDeg: 0,
    sideSpinRpm: 0,
    topSpinRpm: 0,
    axialSpinRpm: 0,
    source: 'ground-through-ball',
    metadata: {
      groundDampingModel: trajectory.groundDampingModel,
      groundDampingInitialPerSecond: trajectory.groundDampingInitialPerSecond,
      groundDampingRampScale: trajectory.groundDampingRampScale,
      groundDampingRampExponent: trajectory.groundDampingRampExponent,
      groundDampingOriginX: 0,
      groundDampingOriginY: 0,
      groundDampingReferenceDistanceMetres: trajectory.groundDampingReferenceDistanceMetres,
      groundDampingMaximumProgress: trajectory.groundDampingMaximumProgress,
      groundSkidFrictionScale: trajectory.groundSkidFrictionScale,
      groundLinearDampingUntilSeconds: trajectory.groundLinearDampingUntilSeconds
    }
  });
  let state = launch.state;
  let context = Ball.createSimulationContext({ seed: 173 });
  const thresholdSpeeds = {};
  let previousSpeed = Math.hypot(state.velocity.x, state.velocity.y);
  let maximumPassiveSpeedGain = 0;
  let settled = null;
  for (let tick = 0; tick <= 600; tick += 1) {
    const speed = Math.hypot(state.velocity.x, state.velocity.y);
    const progress = state.position.x / distanceMetres;
    for (const threshold of [.25, .5, .75, 1]) {
      if (thresholdSpeeds[threshold] == null && progress >= threshold) thresholdSpeeds[threshold] = speed;
    }
    maximumPassiveSpeedGain = Math.max(maximumPassiveSpeedGain, speed - previousSpeed);
    previousSpeed = speed;
    if (speed <= .08) {
      settled = { tick, distanceMetres: state.position.x };
      break;
    }
    const output = Ball.step(state, context, 1 / 60);
    state = output.state;
    context = output.context;
  }
  return { thresholdSpeeds, settled, maximumPassiveSpeedGain };
}

function runMagnusReynoldsFlight(originHost, targetHost, speedWorld, loftWorld, ticks, strike = null, config = undefined) {
  const dx = targetHost.x - originHost.x;
  const dy = targetHost.y - originHost.y;
  const horizontalHost = Math.hypot(dx, dy) || 1;
  const speedMetresPerSecond = speedWorld * 60 * Math.hypot(
    dx / horizontalHost / X_PER_METRE,
    dy / horizontalHost / Y_PER_METRE
  );
  const verticalMetresPerSecond = loftWorld * 60 / PITCH_UNITS_PER_METRE;
  const liftAngleDeg = Math.atan2(verticalMetresPerSecond, speedMetresPerSecond) * 180 / Math.PI;
  const origin = {
    x: (originHost.x - M) / X_PER_METRE,
    y: (originHost.y - H / 2) / Y_PER_METRE,
    // liveV2QueueLaunch converts the host ball's one-unit release height,
    // then adds the MR radius offset.
    z: 0.11 + (1 / PITCH_UNITS_PER_METRE)
  };
  const target = {
    x: (targetHost.x - M) / X_PER_METRE,
    y: (targetHost.y - H / 2) / Y_PER_METRE,
    z: 0.11
  };
  const launch = Ball.resolveLaunch({
    id: 'golden-bergkamp-henry-through',
    origin,
    target,
    speed: speedMetresPerSecond,
    liftAngleDeg,
    sideSpinRpm: 0,
    topSpinRpm: 0,
    axialSpinRpm: 0,
    source: 'ground-through-ball',
    metadata: strike && strike.groundDampingModel ? {
      groundDampingModel: strike.groundDampingModel,
      groundDampingInitialPerSecond: strike.groundDampingInitialPerSecond,
      groundDampingRampScale: strike.groundDampingRampScale,
      groundDampingRampExponent: strike.groundDampingRampExponent,
      groundDampingOriginX: origin.x,
      groundDampingOriginY: origin.y,
      groundDampingReferenceDistanceMetres: strike.groundDampingReferenceDistanceMetres,
      groundDampingMaximumProgress: strike.groundDampingMaximumProgress,
      groundSkidFrictionScale: strike.groundSkidFrictionScale,
      groundLinearDampingUntilSeconds: strike.groundLinearDampingUntilSeconds
    } : undefined
  }, config);
  let state = launch.state;
  let context = Ball.createSimulationContext({ seed: 173 });
  for (let tick = 0; tick < ticks; tick += 1) {
    const output = Ball.step(state, context, 1 / 60, {}, config);
    state = output.state;
    context = output.context;
  }
  return {
    state,
    launch,
    host: {
      x: M + state.position.x * X_PER_METRE,
      y: H / 2 + state.position.y * Y_PER_METRE,
      pace: Math.hypot(
        state.velocity.x * X_PER_METRE / 60,
        state.velocity.y * Y_PER_METRE / 60
      )
    }
  };
}

function resolveGoldenReception(arrivalState) {
  const incoming = unit(arrivalState.velocity);
  const runDirection = unit({
    x: 2920.1 - GOLDEN.receptionPlayer.x,
    y: (734.9 - GOLDEN.receptionPlayer.y) * X_PER_METRE / Y_PER_METRE
  });
  const receptionBall = Ball.createBallState({
    ...arrivalState,
    id: 'golden-reception-ball',
    position: { x: -incoming.x * 0.52, y: -incoming.y * 0.52, z: 0.11 },
    velocity: { ...arrivalState.velocity, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.ROLL
  });
  const request = FirstTouch.createGroundReceptionFixture({
    tick: GOLDEN.receptionFrame,
    seed: 173,
    ball: receptionBall,
    player: {
      id: 'ars-henry',
      teamId: 'you',
      position: { x: 0, y: 0 },
      velocity: { x: 3.1 * runDirection.x, y: 3.1 * runDirection.y },
      facing: runDirection,
      heightM: 1.88,
      attributes: {
        control: 98,
        technique: 98,
        balance: 95,
        agility: 98,
        strength: 86,
        awareness: 98
      }
    },
    intent: {
      type: 'cushion',
      direction: runDirection,
      touchDistanceM: 0.34,
      active: false
    },
    pressure: [],
    timingOffsetSeconds: 0
  });
  const capability = FirstTouch.createCapability({
    enabled: true,
    online: false,
    workflow: 'offline-v2-lab',
    acknowledgement: FirstTouch.ACKNOWLEDGEMENT
  });
  return FirstTouch.resolve(request, capability);
}

function resolveShotHandoff(ownerId) {
  const capability = dribblingCapability();
  const state = Dribbling.createState({
    epoch: 0,
    phase: Dribbling.PHASES.SECURED_CONTROL,
    phaseStartedTick: GOLDEN.receptionFrame,
    carrierId: ownerId,
    carrierTeamId: 'you',
    logicalOwnerId: ownerId,
    physicalSeparated: false,
    touchSequence: 13,
    nextTouchTick: GOLDEN.shootReleaseFrame + 10,
    outcome: 'first-touch-controlled'
  });
  const ballState = Ball.createBallState({
    id: 'golden-shot-handoff-ball',
    position: { x: 0.42, y: 0, z: 0.11 },
    velocity: { x: 3.2, y: 0, z: 0 },
    grounded: true,
    regime: Ball.REGIMES.CONTROLLED
  });
  return resolveDribbling({
    tick: GOLDEN.shootReleaseFrame,
    carrierId: ownerId,
    carrierPosition: { x: 0, y: 0 },
    state,
    ballState,
    logicalOwnerId: ownerId,
    actionIntent: {
      id: 'golden-shot-f6921',
      type: 'shot',
      actorId: ownerId,
      direction: { x: 1, y: 0 },
      power: GOLDEN.shotPower,
      variant: 'normal',
      source: 'controller-1',
      commandTick: GOLDEN.shootReleaseFrame
    },
    direction: { x: 1, y: 0 },
    capability
  });
}

test('golden-derived Bergkamp to Henry conditions preserve authored channel, runner handoff, MR rendezvous, cushion and shot emergence', () => {
  const charged = currentControllerThroughCharge(GOLDEN.pressToReleaseMs);
  assert.equal(GOLDEN.releaseFrame - GOLDEN.pressFrame, 8);
  assert.equal(GOLDEN.pressToReleaseMs / GOLDEN.chargeDivisorMs, 0.125);
  assert.equal(TRIANGLE_CHARGE_DURATION_MS, 777);
  assert.equal(charged.power, GOLDEN.pressToReleaseMs / TRIANGLE_CHARGE_DURATION_MS);
  assert.ok(charged.power < 0.125 && charged.power > 0.12,
    `one-tick-slower live Triangle charge drifted too far from the historical input: ${charged.power}`);
  assert.equal(charged.overTop, false);
  assert.equal(charged.flair, false);

  const heldDirection = unit({
    x: GOLDEN.receiverAtRelease.x - GOLDEN.source.x,
    y: GOLDEN.receiverAtRelease.y - GOLDEN.source.y
  });
  const releasedAction = bufferGoldenThroughAction(heldDirection, charged.power);
  assert.equal(releasedAction.power, charged.power);
  assert.deepEqual(releasedAction.direction, heldDirection);
  assert.equal(releasedAction.commandTick, GOLDEN.pressFrame);

  const releaseDelta = {
    x: GOLDEN.release.x - GOLDEN.source.x,
    y: GOLDEN.release.y - GOLDEN.source.y
  };
  const face = unit(releaseDelta);
  const targetSpeed = (GOLDEN.leadHostUnits - 105 - charged.power * 185) / 13;
  const targetVx = (GOLDEN.landing.x - GOLDEN.receiverAtRelease.x - GOLDEN.leadHostUnits) / 3.3;
  const targetVy = Math.sqrt(targetSpeed * targetSpeed - targetVx * targetVx);
  const bergkamp = {
    id: 'ars-bergkamp',
    name: 'Dennis Bergkamp',
    team: 'you',
    role: 'fwd',
    attackRole: 'central-pin',
    x: GOLDEN.source.x,
    y: GOLDEN.source.y,
    vx: 0,
    vy: 0,
    fx: face.x,
    fy: face.y,
    attrs: { pass: 100 },
    stats: { touches: 0 },
    sentOff: false,
    isGK: false
  };
  const henry = {
    id: 'ars-henry',
    name: 'Thierry Henry',
    team: 'you',
    role: 'fwd',
    attackRole: 'runner',
    x: GOLDEN.receiverAtRelease.x,
    y: GOLDEN.receiverAtRelease.y,
    vx: targetVx,
    vy: targetVy,
    attrs: { pass: 93 },
    stats: { touches: 0 },
    sentOff: false,
    isGK: false
  };
  const through = throughHarness({
    source: bergkamp,
    teammates: [henry],
    direction: releasedAction.direction,
    power: releasedAction.power
  });
  assert.equal(through.result.targetId, henry.id);
  assert.equal(through.controlled.id, henry.id, 'receiver control must switch to Henry at launch');
  const authoredRangeMetres = currentGroundThroughRange(charged.power);
  const authoredDistanceMetres = Math.hypot(
    (through.result.intendedLanding.x - bergkamp.x) / X_PER_METRE,
    (through.result.intendedLanding.y - bergkamp.y) / Y_PER_METRE
  );
  assert.ok(Math.abs(authoredDistanceMetres - authoredRangeMetres) <= .05,
    `Triangle authored ${authoredDistanceMetres}m instead of held-power range ${authoredRangeMetres}m`);
  const authoredDirection = unit({
    x: through.result.intendedLanding.x - bergkamp.x,
    y: through.result.intendedLanding.y - bergkamp.y
  });
  assert.ok(authoredDirection.x * heldDirection.x + authoredDirection.y * heldDirection.y >= .999,
    'receiver reading redirected the held Triangle direction');
  assert.deepEqual(through.result.landing, through.result.intendedLanding,
    'zero-error fixture changed its authored physical meeting');
  assert.equal(through.result.loft, 0.1);
  assert.equal(through.result.calibration, 'mr-v2-ground-triangle-measured-power-punch-tail-v4-2026-08-14');
  assert.ok(through.result.paceMps > through.result.predictedTerminalPaceMps);
  assert.ok(through.result.predictedArrivalTicks > 0);
  assert.equal(through.launch.details.groundDampingModel, 'progressive-ground-strike-v2');
  assert.ok(through.launch.details.groundDampingInitialPerSecond > 0);
  assert.ok(through.launch.details.groundDampingRampScale > 0);
  assert.equal(through.launch.details.groundDampingRampExponent, 2.65);
  assert.ok(through.launch.details.groundSkidFrictionScale < 1);
  assert.deepEqual(through.pendingLaunch.authoredMeeting, through.launch.point);
  assert.equal(through.pendingLaunch.predictedArrivalTicks, through.result.predictedArrivalTicks);
  assert.equal(through.pendingLaunch.meetingContract, through.result.meetingContract);

  const inferredOrigin = {
    x: bergkamp.x + face.x * (12.75 + 12),
    y: bergkamp.y + face.y * (12.75 + 12)
  };
  assert.ok(Math.abs(inferredOrigin.x - GOLDEN.release.x) < 0.05);
  assert.ok(Math.abs(inferredOrigin.y - GOLDEN.release.y) < 0.05);
  const mr = runMagnusReynoldsFlight(
    inferredOrigin,
    through.launch.point,
    through.launch.details.v2SpeedWorld,
    through.launch.details.v2LoftWorld,
    through.result.predictedArrivalTicks,
    through.launch.details
  );
  assert.ok(Math.abs(mr.host.x - through.launch.point.x) <= X_PER_METRE * 0.35, `MR x ${mr.host.x}`);
  assert.ok(Math.abs(mr.host.y - through.launch.point.y) <= Y_PER_METRE * 0.35, `MR y ${mr.host.y}`);
  assert.ok(Math.abs(Math.hypot(mr.state.velocity.x, mr.state.velocity.y) - through.result.predictedTerminalPaceMps) <= 0.35,
    `MR terminal pace ${Math.hypot(mr.state.velocity.x, mr.state.velocity.y)}`);

  const reception = resolveGoldenReception(mr.state);
  assert.equal(reception.outcome, 'controlled');
  assert.equal(reception.technique, 'foot-cushion');
  assert.equal(reception.ownerCandidateId, henry.id);
  assert.equal(reception.telemetry.intent, 'cushion');

  assert.equal(GOLDEN.shootReleaseFrame - GOLDEN.shootPressFrame, 24);
  const shot = resolveShotHandoff(reception.ownerCandidateId);
  assert.equal(shot.releasedAction.type, 'shot');
  assert.equal(shot.releasedAction.actorId, henry.id);
  assert.equal(shot.releasedAction.power, GOLDEN.shotPower);
});

test('power-authored ground-Triangle matrix reaches every short-to-full MR meeting monotonically', () => {
  // The old playtest matrix exposed the defect: assistance could turn one
  // low-power input into radically different distances. The corrected matrix
  // derives every physical meeting from held power first, then verifies MR.
  const matrix = [.10, .125, .133, .18, .25, .35, .5, .75, 1]
    .map(power => ({ power, distanceMetres: currentGroundThroughRange(power) }));
  assert.equal(matrix[0].distanceMetres, 6.5, 'minimum Triangle tap must stay a distinct short through ball');
  assert.equal(matrix.at(-1).distanceMetres, 45, 'full Triangle hold must retain its authored space-pass range');
  for (const sample of matrix) {
    const trajectory = currentGroundThroughTrajectory(sample.power, sample.distanceMetres);
    const state = runMetricGroundRendezvous(sample.distanceMetres, trajectory);
    assert.equal(trajectory.model, 'mr-v2-ground-triangle-measured-power-punch-tail-v4-2026-08-14');
    assert.equal(trajectory.groundDampingModel, 'progressive-ground-strike-v2');
    assert.equal(trajectory.arrivalModel, 'measured-ball-v2-rendezvous');
    assert.equal(trajectory.reachesAuthoredMeeting, true);
    assert.ok(trajectory.measuredMeetingErrorMetres <= .1,
      `power ${sample.power}: measured MR error ${trajectory.measuredMeetingErrorMetres}m`);
    assert.ok(Math.abs(state.position.x - sample.distanceMetres) <= 0.65,
      `power ${sample.power}: expected ${sample.distanceMetres}m, got ${state.position.x}m`);
    assert.ok(Math.abs(state.position.y) <= 0.02, `power ${sample.power}: lateral drift ${state.position.y}m`);
    assert.ok(Math.abs(Math.hypot(state.velocity.x, state.velocity.y) - trajectory.terminalPaceMps) <= 0.65,
      `power ${sample.power}: terminal pace ${Math.hypot(state.velocity.x, state.velocity.y)}m/s`);
  }
  assert.ok(matrix.every((row, index) => index === 0 || row.distanceMetres > matrix[index - 1].distanceMetres),
    `held power did not increase authored range: ${JSON.stringify(matrix)}`);
  const paceSeries = matrix.map(row => currentGroundThroughTrajectory(row.power, row.distanceMetres).launchPaceMps);
  assert.ok(paceSeries.every((pace, index) => index === 0 || pace >= paceSeries[index - 1]),
    `held power did not increase launch pace: ${paceSeries.join(',')}`);
});

test('MSSGKN8P correction adds opening punch only to the identified tap-to-medium Triangle band', () => {
  const oldRange = power => {
    const normalised = clamp((power - .10) / .90, 0, 1);
    return clamp(6.5 + 38.5 * Math.pow(normalised, 1.23), 6.5, 45);
  };
  const samples = [.10, .133, .259, .308, .347, .437, .75, 1]
    .map(power => {
      const distanceMetres = currentGroundThroughRange(power);
      const trajectory = currentGroundThroughTrajectory(power, distanceMetres);
      return {
        power,
        distanceMetres,
        previousDistanceMetres: oldRange(power),
        rangeCorrectionMetres: distanceMetres - oldRange(power),
        openingPunchCorrection: trajectory.openingPunchCorrection,
        launchPaceMps: trajectory.launchPaceMps
      };
    });
  const byPower = power => samples.find(sample => sample.power === power);

  assert.ok(byPower(.133).rangeCorrectionMetres > 0 && byPower(.133).rangeCorrectionMetres < .08,
    `accepted tap received more than a tiny correction: ${JSON.stringify(byPower(.133))}`);
  assert.ok(byPower(.259).rangeCorrectionMetres >= .38 && byPower(.259).rangeCorrectionMetres <= .46,
    `underweight 25.9% pass missed its bounded range correction: ${JSON.stringify(byPower(.259))}`);
  assert.ok(byPower(.347).rangeCorrectionMetres >= .33 && byPower(.347).rangeCorrectionMetres <= .40,
    `underweight 34.7% pass missed its bounded range correction: ${JSON.stringify(byPower(.347))}`);
  assert.ok(byPower(.437).rangeCorrectionMetres < .08,
    `already-powerful 43.7% pass received the low/medium correction: ${JSON.stringify(byPower(.437))}`);
  assert.equal(byPower(.10).rangeCorrectionMetres, 0);
  assert.equal(byPower(1).rangeCorrectionMetres, 0);
  assert.ok(byPower(.259).openingPunchCorrection > byPower(.133).openingPunchCorrection);
  assert.ok(byPower(.347).openingPunchCorrection > byPower(.437).openingPunchCorrection);
  assert.ok(samples.every((sample, index) => index === 0 || sample.distanceMetres > samples[index - 1].distanceMetres),
    `bounded correction broke power-to-distance ordering: ${JSON.stringify(samples)}`);
  assert.ok(samples.every((sample, index) => index === 0 || sample.launchPaceMps >= samples[index - 1].launchPaceMps),
    `bounded correction broke power-to-punch ordering: ${JSON.stringify(samples)}`);
});

test('MSSHO0P4 correction adds only a tiny strike and one-to-two-roll tail around larger Triangle charge', () => {
  const powers = [.10, .35, .437, .553, .65, .80, 1];
  const rows = powers.map(power => {
    const distanceMetres = currentGroundThroughRange(power);
    const current = currentGroundThroughTrajectory(power, distanceMetres);
    const previous = {
      ...current,
      launchPaceMps: current.launchPaceMps - current.largePassPunchCorrection,
      groundDampingMaximumProgress: current.groundDampingMaximumProgress + current.largePassTailCorrection
    };
    const currentRollout = runMetricGroundRollout(distanceMetres, current);
    const previousRollout = runMetricGroundRollout(distanceMetres, previous);
    assert.ok(currentRollout.settled && previousRollout.settled, `Triangle ${power} did not settle`);
    return {
      power,
      shape: current.largePassFinishShape,
      punchCorrection: current.largePassPunchCorrection,
      tailCorrection: current.largePassTailCorrection,
      addedRollMetres: currentRollout.settled.distanceMetres - previousRollout.settled.distanceMetres
    };
  });
  const byPower = power => rows.find(row => row.power === power);
  assert.equal(byPower(.10).shape, 0);
  assert.equal(byPower(.35).shape, 0);
  assert.equal(byPower(.437).shape, 0);
  assert.equal(byPower(.80).shape, 0);
  assert.equal(byPower(1).shape, 0);
  assert.ok(byPower(.553).punchCorrection >= .52 && byPower(.553).punchCorrection <= .56,
    `identified larger pass missed its tiny punch correction: ${JSON.stringify(byPower(.553))}`);
  assert.ok(byPower(.553).addedRollMetres >= .65 && byPower(.553).addedRollMetres <= 1.45,
    `identified larger pass did not gain roughly one-to-two ball rolls: ${JSON.stringify(byPower(.553))}`);
  assert.ok(byPower(.65).addedRollMetres > 0,
    `larger-pass tail band vanished too early: ${JSON.stringify(byPower(.65))}`);
});

test('MSS5XHV7 low tap stays short and lets nearby Lauren read it without Gilberto redirecting the ball', () => {
  const source = {
    id: 'ars-ljungberg', name: 'Freddie Ljungberg', team: 'you', role: 'mid', attackRole: 'carrier',
    x: 938.13, y: 1985.02, vx: -1.302, vy: -.794, fx: -.5044, fy: -.8635,
    attrs: { pass: 88 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const lauren = {
    id: 'ars-lauren', name: 'Lauren', team: 'you', role: 'def', attackRole: 'overlap',
    x: 858.69, y: 1828.38, vx: 1.383, vy: .331,
    aiTarget: { x: 1349.68, y: 1499.4 },
    attrs: { pass: 80, pace: 89 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const gilberto = {
    id: 'ars-gilberto', name: 'Gilberto Silva', team: 'you', role: 'mid', attackRole: 'central-cover',
    x: 1417.12, y: 1533.65, vx: 1.764, vy: -1.24,
    aiTarget: { x: 1550.76, y: 1240.73 },
    attrs: { pass: 86, pace: 74 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = unit({ x: .564, y: -.826 });
  const power = .133;
  const baseline = throughHarness({
    source: structuredClone(source), teammates: [], direction, power
  });
  const replayShape = throughHarness({ source, teammates: [lauren, gilberto], direction, power });
  const rangeMetres = currentGroundThroughRange(power);
  const endpointMetres = Math.hypot(
    (replayShape.result.intendedLanding.x - source.x) / X_PER_METRE,
    (replayShape.result.intendedLanding.y - source.y) / Y_PER_METRE
  );
  const endpointDirection = unit({
    x: replayShape.result.intendedLanding.x - source.x,
    y: replayShape.result.intendedLanding.y - source.y
  });

  assert.ok(rangeMetres >= 6.5 && rangeMetres <= 7.5,
    `13.3% Triangle must be a genuinely short option, got ${rangeMetres}m`);
  assert.ok(Math.abs(endpointMetres - rangeMetres) <= .05,
    `teammate reading expanded ${rangeMetres}m power to ${endpointMetres}m`);
  assert.ok(endpointDirection.x * direction.x + endpointDirection.y * direction.y >= .999,
    'receiver selection rotated the held-stick direction');
  assert.deepEqual(replayShape.launch.point, baseline.launch.point,
    'nearby and distant candidates changed the physical Triangle endpoint');
  assert.equal(replayShape.result.targetId, lauren.id,
    'the nearby physically reachable reader was ignored for the distant target');
  assert.equal(replayShape.result.receiverRegistration, 'local-receiver-reaches-authored-ground-meeting');
  assert.equal(replayShape.launch.details.targetPlayer, lauren);
  assert.ok(replayShape.result.authoredDistanceMetres <= 10,
    `low-tap Ball V2 flight expanded to ${replayShape.result.authoredDistanceMetres}m`);
});

test('ground Triangle uses progressive turf loss with more glide than X but a bounded missed-pass tail', () => {
  const scenarios = [
    { power: .18, distanceMetres: 10 },
    { power: .276, distanceMetres: 31.16 },
    { power: .62, distanceMetres: 35 }
  ];
  for (const scenario of scenarios) {
    const through = currentGroundThroughTrajectory(scenario.power, scenario.distanceMetres);
    const normalX = currentGroundPassTrajectory(scenario.power, scenario.distanceMetres);
    const throughRollout = runMetricGroundRollout(scenario.distanceMetres, through);
    const xRollout = runMetricGroundRollout(scenario.distanceMetres, normalX);
    const throughSpeeds = [.25, .5, .75, 1].map(point => throughRollout.thresholdSpeeds[point]);
    assert.equal(through.groundDampingModel, 'progressive-ground-strike-v2');
    assert.ok(through.groundDampingInitialPerSecond < normalX.groundDampingInitialPerSecond,
      `Triangle lost its lower opening drag: ${JSON.stringify({ scenario, through, normalX })}`);
    assert.ok(through.groundSkidFrictionScale < normalX.groundSkidFrictionScale,
      `Triangle lost its cleaner opening skid: ${JSON.stringify({ scenario, through, normalX })}`);
    assert.ok(throughSpeeds.every(Number.isFinite),
      `Triangle did not traverse its authored path: ${JSON.stringify({ scenario, throughRollout })}`);
    assert.ok(throughSpeeds.every((speed, index) => index === 0 || speed < throughSpeeds[index - 1]),
      `Triangle did not progressively decelerate: ${JSON.stringify({ scenario, throughSpeeds })}`);
    assert.ok(throughSpeeds[3] >= 5.5,
      `Triangle died before its physical meeting: ${JSON.stringify({ scenario, throughSpeeds })}`);
    assert.ok(throughRollout.settled, `missed Triangle did not settle: ${JSON.stringify({ scenario, throughRollout })}`);
    assert.ok(xRollout.settled, `comparison X did not settle: ${JSON.stringify({ scenario, xRollout })}`);
    const throughTail = throughRollout.settled.distanceMetres - scenario.distanceMetres;
    const xTail = xRollout.settled.distanceMetres - scenario.distanceMetres;
    assert.ok(throughTail >= xTail + .8,
      `Triangle did not preserve extra space-pass glide: ${JSON.stringify({ scenario, throughTail, xTail })}`);
    assert.ok(throughTail <= Math.max(8, scenario.distanceMetres * .42),
      `missed Triangle retained an ice-like tail: ${JSON.stringify({ scenario, throughTail })}`);
    assert.ok(throughRollout.maximumPassiveSpeedGain <= 1e-6,
      `Triangle passively accelerated: ${JSON.stringify({ scenario, maximumPassiveSpeedGain: throughRollout.maximumPassiveSpeedGain })}`);
  }
});

test('higher Triangle charge produces materially more absolute post-meeting roll', () => {
  const powers = [.10, .25, .50, .75, 1];
  const rows = powers.map(power => {
    const distanceMetres = currentGroundThroughRange(power);
    const trajectory = currentGroundThroughTrajectory(power, distanceMetres);
    const rollout = runMetricGroundRollout(distanceMetres, trajectory);
    assert.ok(rollout.settled, `Triangle power ${power} did not settle`);
    return { power, distanceMetres, tailMetres: rollout.settled.distanceMetres - distanceMetres };
  });
  assert.ok(rows.every((row, index) => index === 0 || row.tailMetres > rows[index - 1].tailMetres),
    `more Triangle power reduced absolute roll: ${JSON.stringify(rows)}`);
  assert.ok(rows.at(-1).tailMetres >= rows[0].tailMetres * 1.8,
    `full-power Triangle did not roll materially farther than a tap: ${JSON.stringify(rows)}`);
});

test('at one fixed meeting, higher charge leaves more end roll for X and Triangle', () => {
  const powers = [.15, .35, .55, .75, 1];
  const distanceMetres = 20;
  for (const [label, trajectoryFor] of [
    ['X', currentGroundPassTrajectory],
    ['Triangle', currentGroundThroughTrajectory]
  ]) {
    const rows = powers.map(power => {
      const rollout = runMetricGroundRollout(distanceMetres, trajectoryFor(power, distanceMetres));
      assert.ok(rollout.settled, `${label} power ${power} did not settle`);
      return { power, tailMetres: rollout.settled.distanceMetres - distanceMetres };
    });
    assert.ok(rows.every((row, index) => index === 0 || row.tailMetres > rows[index - 1].tailMetres),
      `more ${label} power reduced end-of-pass roll at the same meeting: ${JSON.stringify(rows)}`);
    assert.ok(rows.at(-1).tailMetres >= rows[0].tailMetres + 2.5,
      `full-power ${label} did not retain materially more end roll than a tap: ${JSON.stringify(rows)}`);
  }
});

test('RED: through assistance cannot select a runner outside the full-stick authored channel', () => {
  const source = {
    id: 'passer', name: 'Passer', team: 'you', role: 'mid', attackRole: 'central-pin',
    x: 1000, y: 1000, vx: 0, vy: 0, fx: 1, fy: 0,
    attrs: { pass: 100 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const outsideRunner = {
    id: 'outside-runner', name: 'Outside Runner', team: 'you', role: 'fwd', attackRole: 'runner',
    x: 990, y: 1400, vx: 0, vy: 0,
    attrs: { pass: 80 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = { x: 1, y: 0 };
  const through = throughHarness({ source, teammates: [outsideRunner], direction, power: 0.125 });
  const selected = through.result.targetId === outsideRunner.id;
  const candidateVector = unit({ x: outsideRunner.x - source.x, y: outsideRunner.y - source.y });
  const candidateDot = candidateVector.x * direction.x + candidateVector.y * direction.y;
  assert.ok(!selected || candidateDot >= through.minDot,
    `assistance selected dot ${candidateDot.toFixed(3)} below authored-channel minimum ${through.minDot.toFixed(3)}`);
});

test('RED: through rendezvous assistance cannot rewrite an in-channel held direction outside its cone', () => {
  const source = {
    id: 'passer', name: 'Passer', team: 'you', role: 'mid', attackRole: 'central-pin',
    x: 1000, y: 1000, vx: 0, vy: 0, fx: 1, fy: 0,
    attrs: { pass: 100 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const inChannelRunner = {
    id: 'in-channel-runner', name: 'In Channel Runner', team: 'you', role: 'fwd', attackRole: 'runner',
    x: 1000, y: 1105, vx: 0, vy: 0,
    attrs: { pass: 80 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = { x: 0, y: 1 };
  const through = throughHarness({ source, teammates: [inChannelRunner], direction, power: 0.125 });
  assert.equal(through.result.targetId, inChannelRunner.id, 'fixture must select its in-channel runner');
  const landingVector = unit({
    x: through.launch.point.x - source.x,
    y: through.launch.point.y - source.y
  });
  const landingDot = landingVector.x * direction.x + landingVector.y * direction.y;
  assert.ok(landingDot >= through.minDot,
    `assistance rewrote landing dot ${landingDot.toFixed(3)} below authored-channel minimum ${through.minDot.toFixed(3)}`);
});

test('Triangle nominates an in-channel runner without scripting or mutating the runner route', () => {
  const source = {
    id: 'independent-passer', name: 'Independent Passer', team: 'you', role: 'mid', attackRole: 'central-pin',
    x: 1200, y: 980, vx: 0, vy: 0, fx: 1, fy: 0,
    attrs: { pass: 100 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const runner = {
    id: 'independent-runner', name: 'Independent Runner', team: 'you', role: 'fwd', attackRole: 'runner',
    x: 1510, y: 1045, vx: 3.2, vy: -0.45,
    aiTarget: { x: 1880, y: 995 }, intent: { type: 'run', source: 'independent-off-ball-system' },
    attrs: { pass: 80 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = unit({ x: 1, y: 0.15 });
  const routeBefore = structuredClone({
    x: runner.x, y: runner.y, vx: runner.vx, vy: runner.vy,
    aiTarget: runner.aiTarget, intent: runner.intent
  });

  const through = throughHarness({ source, teammates: [runner], direction, power: 0.32 });
  const landingDirection = unit({
    x: through.launch.point.x - source.x,
    y: through.launch.point.y - source.y
  });

  assert.equal(through.result.targetId, runner.id);
  assert.equal(through.launch.details.targetPlayer, runner);
  assert.equal(through.controlled, runner, 'handover may select the runner; it must not steer the runner');
  assert.deepEqual({
    x: runner.x, y: runner.y, vx: runner.vx, vy: runner.vy,
    aiTarget: runner.aiTarget, intent: runner.intent
  }, routeBefore, 'Triangle must leave the independently authored runner route untouched');
  assert.ok(
    landingDirection.x * direction.x + landingDirection.y * direction.y >= through.minDot,
    'the solved meeting point must remain inside the human-authored stick channel'
  );
});

test('CUO5O ground Triangle nominates the first route intersection without changing its authored pass or runner route', () => {
  const source = {
    id: 'ars-campbell', name: 'Sol Campbell', team: 'you', role: 'def', attackRole: 'central-cover',
    x: 1188.3, y: 1370.7, vx: 0, vy: 0, fx: -.144, fy: -.990,
    attrs: { pass: 73 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = unit({ x: -.144, y: -.990 });
  const routeTarget = { x: 976.7, y: 816.0 };
  const toure = {
    id: 'ars-toure', name: 'Kolo Toure', team: 'you', role: 'def', attackRole: 'central-cover',
    x: 1012.4, y: 1091.4, vx: -.35, vy: -2.70,
    aiTarget: routeTarget, intent: { type: 'run', source: 'independent-off-ball-system' },
    attrs: { pass: 75, pace: 87 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const routeBefore = structuredClone({
    x: toure.x, y: toure.y, vx: toure.vx, vy: toure.vy,
    aiTarget: toure.aiTarget, intent: toure.intent
  });
  const baseline = throughHarness({ source: structuredClone(source), teammates: [], direction, power: .232 });
  const registered = throughHarness({ source, teammates: [toure], direction, power: .232 });

  assert.equal(baseline.result.targetId, null, 'recorded authored pass remains valid without a runner');
  assert.equal(registered.result.targetId, toure.id);
  assert.equal(registered.result.receiverRegistration, 'active-runner-intersects-authored-ground-channel');
  assert.equal(registered.controlled, toure, 'registration must hand control to the intersecting runner');
  assert.deepEqual(registered.launch.point, baseline.launch.point, 'receiver nomination must not redirect Triangle');
  assert.equal(registered.result.speed, baseline.result.speed, 'receiver nomination must not reweight Triangle');
  assert.equal(registered.result.loft, baseline.result.loft, 'receiver nomination must not change ground physics');
  assert.equal(registered.result.leadDistance, baseline.result.leadDistance, 'receiver nomination must not change held-power lead');
  assert.deepEqual({
    x: toure.x, y: toure.y, vx: toure.vx, vy: toure.vy,
    aiTarget: toure.aiTarget, intent: toure.intent
  }, routeBefore, 'receiver registration must not mutate the independent runner route');
});

test('stationary Ljungberg reads the exact MR meeting without redirecting the authored Triangle', () => {
  const source = {
    id: 'stationary-read-passer', name: 'Stationary Read Passer', team: 'you', role: 'mid', attackRole: 'carrier',
    x: 2000, y: 1500, vx: 0, vy: 0, fx: 0, fy: -1,
    attrs: { pass: 92 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const direction = { x: 0, y: -1 };
  const ljungberg = {
    id: 'ars-ljungberg', name: 'Freddie Ljungberg', team: 'you', role: 'mid', attackRole: 'diagonal-run',
    x: 1880, y: 1050, vx: 0, vy: 0,
    attrs: { pass: 88, pace: 91 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const runnerBefore = structuredClone(ljungberg);
  const baseline = throughHarness({
    source: structuredClone(source), teammates: [], direction, power: 0.3
  });
  const registered = throughHarness({ source, teammates: [ljungberg], direction, power: 0.3 });

  assert.equal(baseline.result.targetId, null, 'authored space pass must remain valid without a receiver');
  assert.equal(registered.result.targetId, ljungberg.id);
  assert.equal(registered.result.receiverRegistration, 'stationary-receiver-reaches-authored-ground-meeting');
  assert.equal(registered.controlled, ljungberg, 'the stationary reader must receive control at launch');
  assert.equal(registered.launch.details.targetPlayer, ljungberg);
  assert.equal(registered.pendingLaunch.targetPlayerId, ljungberg.id);
  assert.deepEqual(registered.launch.point, baseline.launch.point, 'receiver nomination must not redirect Triangle');
  assert.deepEqual(registered.pendingLaunch.target, baseline.launch.point);
  assert.deepEqual(registered.pendingLaunch.authoredMeeting, baseline.launch.point);
  assert.equal(registered.result.speed, baseline.result.speed, 'receiver nomination must not reweight host presentation');
  assert.equal(registered.result.paceMps, baseline.result.paceMps, 'receiver nomination must not reweight Ball V2');
  assert.equal(registered.result.predictedArrivalTicks, baseline.result.predictedArrivalTicks);
  assert.equal(registered.result.leadDistance, baseline.result.leadDistance, 'held power must remain authoritative');
  assert.equal(registered.result.meetingContract, 'mr-v2-ground-triangle-measured-power-punch-tail-v4-2026-08-14');
  assert.deepEqual(ljungberg, runnerBefore, 'registration must not invent or mutate an off-ball route');

  const activeReader = {
    ...structuredClone(runnerBefore), id: 'ars-henry', name: 'Thierry Henry', x: 1872, y: 1040,
    aiTarget: { ...baseline.launch.point }
  };
  const ranked = throughHarness({
    source: structuredClone(source), teammates: [structuredClone(runnerBefore), activeReader], direction, power: 0.3
  });
  assert.equal(ranked.result.targetId, activeReader.id,
    'an aligned active runner remains a ranking bonus among receivers who can reach the same immutable meeting');
  assert.deepEqual(ranked.launch.point, baseline.launch.point);
});

test('human hold power and independent runner motion influence the rendezvous without forcing a pattern', () => {
  const source = {
    id: 'power-passer', name: 'Power Passer', team: 'you', role: 'mid', attackRole: 'central-pin',
    x: 1000, y: 1000, vx: 0, vy: 0, fx: 1, fy: 0,
    attrs: { pass: 100 }, stats: { touches: 0 }, sentOff: false, isGK: false
  };
  const makeRunner = (id, vy) => ({
    id, name: id, team: 'you', role: 'fwd', attackRole: 'runner',
    x: 1450, y: 1020, vx: 3, vy,
    attrs: { pass: 80 }, stats: { touches: 0 }, sentOff: false, isGK: false
  });
  const direction = { x: 1, y: 0 };

  const shortHold = currentControllerThroughCharge(90);
  const longHold = currentControllerThroughCharge(500);
  assert.ok(longHold.power > shortHold.power, 'release timing must remain the source of pass power');

  const lowPower = throughHarness({
    source: structuredClone(source), teammates: [makeRunner('runner-low', 0)],
    direction, power: shortHold.power
  });
  const highPower = throughHarness({
    source: structuredClone(source), teammates: [makeRunner('runner-high', 0)],
    direction, power: longHold.power
  });
  assert.ok(highPower.result.leadDistance > lowPower.result.leadDistance);
  assert.ok(highPower.result.landing.x > lowPower.result.landing.x);

  const still = throughHarness({
    source: structuredClone(source), teammates: [makeRunner('runner-still', 0)],
    direction, power: 0.32
  });
  const moving = throughHarness({
    source: structuredClone(source), teammates: [makeRunner('runner-moving', 1.8)],
    direction, power: 0.32
  });
  assert.equal(moving.result.landing.x, still.result.landing.x,
    'independent runner motion must not lengthen the physical Triangle');
  assert.equal(moving.result.landing.y, still.result.landing.y,
    'independent runner motion must not steer the physical Triangle');
  assert.equal(moving.result.targetId, 'runner-moving');
  assert.equal(still.result.targetId, 'runner-still');
});
