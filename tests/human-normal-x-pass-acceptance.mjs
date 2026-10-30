import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchPath = path.join(root, 'match-engine', 'match.html');
const matchSource = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Ball = require(path.join(root, 'match-engine', 'ball-engine-v2.js'));

// These dimensions are the exact live host dimensions in match.html. Keeping
// both axes is important: liveV2QueueLaunch converts host pace to metric pace
// along the authored direction rather than assuming square host units.
const W = Math.round(3200 * 1.045);
const H = Math.round(2050 * 1.045);
const M = Math.round(80 * 1.045);
const RAD = 12.75;
const X_PER_METRE = (W - 2 * M) / 105;
const Y_PER_METRE = H / 68;
const Z_PER_METRE = (H - 12) / 68;
const FOOTBALL_CIRCUMFERENCE_METRES = Math.PI * .22;

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

const queueSource = sourceBetween(
  matchSource,
  'function liveV2QueueLaunch',
  '// MatchClock/Restart/Set-Piece V2'
);
const assistanceSource = sourceBetween(
  matchSource,
  'const HUMAN_PASS_ASSISTANCE',
  'function doPassForHuman'
);
const normalPassSource = sourceBetween(
  matchSource,
  'function doPassForHuman',
  'function doPass(power=0.5)'
);
const throughPassSource = sourceBetween(
  matchSource,
  'function doThroughPassFor',
  'function doLobPassFor'
);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function unit(vector) {
  const magnitude = Math.hypot(vector.x, vector.y) || 1;
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}

function player(overrides = {}) {
  return {
    id: 'passer', name: 'Passer', team: 'you', role: 'mid', attackRole: 'creator',
    x: 1000, y: 1000, vx: 0, vy: 0, fx: 1, fy: 0,
    attrs: { pass: 92 }, stats: { touches: 0 }, sentOff: false, isGK: false,
    ...overrides
  };
}

/**
 * Executes the production normal-X function and production V2 queue adapter in
 * a deliberately small host. No pass-distance, pace, loft, assistance or MR
 * formula is copied into this harness.
 */
function executeNormalX({ power, direction = { x: 1, y: 0 }, teammates = [], passer = player() }) {
  const team = [passer, ...teammates];
  const ball = { owner: passer, x: passer.x, y: passer.y, z: 0, stats: {} };
  const logs = [];
  const context = vm.createContext({
    started: true,
    paused: false,
    inReset: () => false,
    liveV2QueueDribbleAction: () => false,
    kickoffHeld: false,
    takeUserRestart: () => false,
    gamepadInput: { moveX: direction.x, moveY: direction.y },
    gamepadInput2: { moveX: 0, moveY: 0 },
    movementInput: () => direction,
    secondMovementInput: () => direction,
    facing: actor => unit({ x: actor.fx, y: actor.fy }),
    ykeep: null,
    okeep: null,
    hasBall: actor => ball.owner === actor,
    teamList: () => team,
    predictiveLaneRisk: () => 0,
    nearestOpponentDistance: actor => Number(actor.testSpace ?? 150),
    passValue: (_source, target) => Number(target.testPassValue ?? 0),
    other: currentTeam => currentTeam === 'you' ? 'opp' : 'you',
    CONFIG: { weather: 'day' },
    clamp,
    W,
    H,
    M,
    PITCH_UNITS_PER_METRE: Z_PER_METRE,
    FootballLegacyBallEngineV2: Ball,
    worldDistanceMetres: (dx, dy) => Math.hypot((Number(dx) || 0) / X_PER_METRE, (Number(dy) || 0) / Y_PER_METRE),
    worldBallSpeedForMetresPerSecond: (paceMps, dx = 1, dy = 0) => {
      const distance = Math.hypot(dx, dy) || 1;
      const metresPerWorldUnit = Math.hypot((dx / distance) / X_PER_METRE, (dy / distance) / Y_PER_METRE);
      return clamp(Number(paceMps) || 0, 0, 40) / (60 * Math.max(.0001, metresPerWorldUnit));
    },
    ball,
    poss: 0,
    rad: RAD,
    liveV2Authority: {},
    liveV2CanStageProtectedLaunch: () => true,
    liveV2PendingLaunch: null,
    liveV2LaunchSerial: 0,
    liveV2CpuOffsideTiming: null,
    offsidePositionAtKick: () => null,
    clockFrames: 1000,
    recordPass: () => {},
    logEvent: (kind, eventTeam, actor, details) => logs.push({ kind, team: eventTeam, actor, details }),
    actionPowerPulse: () => {},
    kickSound: () => {},
    armOffsideCandidate: () => {},
    clearRestartState: () => {},
    restartMsg: '',
    SAME_TEAM_COOP: false,
    controlled: passer,
    controlledOpp: null,
    offsideCandidate: null,
    clockRunning: true
  });
  vm.runInContext('Math.random=()=>0.5;', context);
  vm.runInContext(
    `${queueSource}\n${assistanceSource}\n${normalPassSource}\n` +
      'this.doPassForHuman=doPassForHuman;this.minimumPassDot=humanPassAssistanceMinDot("pass",1);' +
      'this.normalXPace=humanGroundPassPaceMetresPerSecond;this.normalXTrajectory=humanGroundPassTrajectory;',
    context,
    { filename: 'current-human-normal-x-pass.vm.js' }
  );
  context.doPassForHuman(passer, power, false, direction);
  return {
    passer,
    ball,
    logs,
    launch: context.liveV2PendingLaunch,
    controlled: context.controlled,
    minimumPassDot: context.minimumPassDot,
    normalXPace: context.normalXPace,
    normalXTrajectory: context.normalXTrajectory
  };
}

function resolveCurrentMrFlight(intent, maximumSeconds = 9) {
  assert.ok(intent, 'normal X must stage a V2 launch intent');
  const origin = {
    x: (intent.origin.x - M) / X_PER_METRE,
    y: (intent.origin.y - H / 2) / Y_PER_METRE,
    z: Math.max(.11, intent.origin.z / Z_PER_METRE + .11)
  };
  const target = {
    x: (intent.target.x - M) / X_PER_METRE,
    y: (intent.target.y - H / 2) / Y_PER_METRE,
    z: .11
  };
  const launch = Ball.resolveLaunch({
    id: `normal-x-${intent.sequence}`,
    origin,
    direction: intent.direction,
    speed: intent.speedMetresPerSecond,
    liftAngleDeg: intent.liftAngleDeg,
    sideSpinRpm: intent.sideSpinRpm,
    topSpinRpm: intent.topSpinRpm,
    source: intent.source,
    metadata: {
      groundDampingModel: intent.groundDampingModel,
      groundDampingInitialPerSecond: intent.groundDampingInitialPerSecond,
      groundDampingRampScale: intent.groundDampingRampScale,
      groundDampingRampExponent: intent.groundDampingRampExponent,
      groundDampingOriginX: origin.x,
      groundDampingOriginY: origin.y,
      groundDampingReferenceDistanceMetres: intent.groundDampingReferenceDistanceMetres,
      groundDampingMaximumProgress: intent.groundDampingMaximumProgress,
      groundSkidFrictionScale: intent.groundSkidFrictionScale,
      groundLinearDampingUntilSeconds: intent.groundLinearDampingUntilSeconds
    }
  });
  const targetDistance = Math.hypot(target.x - origin.x, target.y - origin.y);
  const targetWindow = clamp(1.35 + targetDistance * .025, 1.5, 3.25);
  const thresholds = [0.25, 0.5, 0.75];
  const thresholdSpeeds = new Map();
  let state = launch.state;
  let context = Ball.createSimulationContext({ seed: 173 });
  let arrival = null;
  let settled = null;
  let atPredicted = null;
  let minimumTargetDistance = Infinity;
  const launchHorizontalSpeed = Math.hypot(state.velocity.x, state.velocity.y);
  let previousHorizontalSpeed = launchHorizontalSpeed;
  let maximumPassiveSpeedGain = 0;
  let simulatedTicks = 0;
  for (let tick = 1; tick <= Math.round(maximumSeconds * 60); tick += 1) {
    const output = Ball.step(state, context, 1 / 60);
    state = output.state;
    context = output.context;
    const travelled = Math.hypot(state.position.x - origin.x, state.position.y - origin.y);
    const distanceToTarget = Math.hypot(state.position.x - target.x, state.position.y - target.y);
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.y);
    maximumPassiveSpeedGain = Math.max(maximumPassiveSpeedGain, horizontalSpeed - previousHorizontalSpeed);
    previousHorizontalSpeed = horizontalSpeed;
    simulatedTicks = tick;
    minimumTargetDistance = Math.min(minimumTargetDistance, distanceToTarget);
    for (const threshold of thresholds) {
      if (!thresholdSpeeds.has(threshold) && travelled >= targetDistance * threshold) {
        thresholdSpeeds.set(threshold, horizontalSpeed);
      }
    }
    if (!arrival && distanceToTarget <= targetWindow) {
      arrival = { tick, seconds: tick / 60, speed: horizontalSpeed, distanceToTarget };
    }
    if (tick === intent.predictedArrivalTicks) {
      atPredicted = { tick, speed: horizontalSpeed, distanceToTarget };
    }
    if (state.settled) {
      settled = { tick, seconds: tick / 60, speed: horizontalSpeed,
        distanceFromOrigin: travelled, regime: state.regime };
      break;
    }
  }
  return {
    intent,
    origin,
    target,
    targetDistance,
    targetWindow,
    launchHorizontalSpeed,
    thresholdSpeeds: Object.fromEntries(thresholds.map(threshold => [threshold, thresholdSpeeds.get(threshold) ?? null])),
    arrival,
    atPredicted,
    settled,
    minimumTargetDistance,
    maximumPassiveSpeedGain,
    final: {
      seconds: simulatedTicks / 60,
      speed: Math.hypot(state.velocity.x, state.velocity.y),
      distanceFromOrigin: Math.hypot(state.position.x - origin.x, state.position.y - origin.y),
      settled: state.settled,
      regime: state.regime
    }
  };
}

function formatFlight(row) {
  const flight = row.flight;
  return JSON.stringify({
    power: row.power,
    metres: +flight.targetDistance.toFixed(2),
    launchMps: +flight.launchHorizontalSpeed.toFixed(2),
    arrivalSeconds: flight.arrival && +flight.arrival.seconds.toFixed(2),
    arrivalMps: flight.arrival && +flight.arrival.speed.toFixed(2),
    quarterMps: flight.thresholdSpeeds[0.25] && +flight.thresholdSpeeds[0.25].toFixed(2),
    halfMps: flight.thresholdSpeeds[0.5] && +flight.thresholdSpeeds[0.5].toFixed(2),
    threeQuarterMps: flight.thresholdSpeeds[0.75] && +flight.thresholdSpeeds[0.75].toFixed(2),
    predictedErrorMetres: flight.atPredicted && +flight.atPredicted.distanceToTarget.toFixed(2),
    predictedMps: flight.atPredicted && +flight.atPredicted.speed.toFixed(2),
    finalMps: +flight.final.speed.toFixed(2),
    finalMetres: +flight.final.distanceFromOrigin.toFixed(2)
  });
}

test('normal-X and Triangle keep independent authored trajectories and input contracts', () => {
  assert.match(throughPassSource, /(?:const\s+[^;]*,)?speed=overTop\?[^:]+:clamp\(7\.2\+distance\*\.0045\+p\*2\.0,7\.8,13\.8\)/,
    'the proven through-ball pace formula changed while calibrating normal X');
  assert.match(throughPassSource, /driven\?humanDrivenGroundThroughTrajectory\([^:]+:humanGroundThroughTrajectory\(/,
    'ordinary and R1 Triangle no longer select independent physical trajectories');
  assert.doesNotMatch(normalPassSource, /doThroughPassFor\s*\(/,
    'normal X must not acquire its calibration by routing through Triangle');
});

test('normal-X exposes the final faster charge and shorter minimum-tap contract on every human input path', () => {
  assert.match(matchSource,
    /const NORMAL_X_CHARGE_DURATION_MS=720,NORMAL_X_MINIMUM_POWER=\.05;/,
    'normal X did not retain its 720 ms charge and 5% minimum tap');
  assert.ok(matchSource.includes(
    'heldMs/(ordinaryGroundPass?NORMAL_X_CHARGE_DURATION_MS:760),ordinaryGroundPass?NORMAL_X_MINIMUM_POWER:.07'),
    'controller-one normal X is not using the final charge window');
  assert.ok(matchSource.includes(
    'heldMs/(keeperRelease?760:NORMAL_X_CHARGE_DURATION_MS),keeperRelease?.07:NORMAL_X_MINIMUM_POWER'),
    'controller-two normal X is not using the final charge window');
  assert.match(matchSource,
    /heldMs\/NORMAL_X_CHARGE_DURATION_MS,NORMAL_X_MINIMUM_POWER,1/,
    'keyboard A is not using the final charge window');

  const quickestTap = clamp(0 / 720, .05, 1);
  const commonHold = clamp(216 / 720, .05, 1);
  assert.equal(quickestTap, .05,
    'the lightest registerable press no longer exposes the short-recycling band');
  assert.ok(commonHold > clamp(216 / 760, .07, 1),
    'a common held pass does not fill slightly faster than the previous input curve');
});

test('full-stick normal-X assistance cannot select or redirect outside the authored channel', () => {
  const inChannel = player({
    id: 'in-channel', name: 'In Channel', x: 1190, y: 1000,
    vx: 0, vy: 42, testSpace: 70, testPassValue: -200
  });
  const outsideChannel = player({
    id: 'outside-channel', name: 'Outside Channel', x: 1000, y: 1190,
    vx: 0, vy: 0, testSpace: 220, testPassValue: 500
  });
  const result = executeNormalX({
    power: .1,
    direction: { x: 1, y: 0 },
    teammates: [outsideChannel, inChannel]
  });
  assert.ok(result.launch, 'normal X did not stage a V2 launch');
  assert.equal(result.ball.target?.id, inChannel.id,
    'an attractive teammate outside the full-stick channel overrode the authored aim');
  assert.equal(result.launch.targetPlayerId, inChannel.id);
  const authored = { x: 1, y: 0 };
  const endpointDirection = unit({
    x: result.launch.target.x - result.passer.x,
    y: result.launch.target.y - result.passer.y
  });
  const endpointDot = endpointDirection.x * authored.x + endpointDirection.y * authored.y;
  assert.ok(endpointDot >= result.minimumPassDot - 1e-9,
    `rendezvous assistance redirected dot ${endpointDot.toFixed(3)} below full-stick channel ${result.minimumPassDot.toFixed(3)}`);
});

test('full-stick normal X preserves its authored weight and control when a runner is beyond it and moving away', () => {
  // FL-MSRRUMG6 seq521: the input authored an approximately 11 m pass, but
  // broad receiver assistance stretched the endpoint to approximately 16 m
  // and switched control to a runner who was already beyond that weight. The
  // receiver must not be nominated merely because he is somewhere down the
  // channel: that switched control and drove him in a full circle around a
  // static endpoint. The pass itself must not gain five metres of hidden
  // power either.
  const passer = player({ x: 1451.52, y: 1130.11 });
  const runner = player({
    id: 'runner', name: 'Runner', x: 2005.82, y: 880.23,
    vx: 3.865, vy: .775, testSpace: 150, testPassValue: 100
  });
  const result = executeNormalX({
    power: .305,
    direction: { x: .884, y: -.468 },
    passer,
    teammates: [runner]
  });
  const intent = result.logs.find(row => row.kind === 'human-pass-intent')?.details;
  assert.ok(intent, JSON.stringify(result.logs));
  const hiddenExtensionMetres = intent.authoredDistanceMetres - intent.requestedDistanceMetres;
  assert.ok(hiddenExtensionMetres <= 2,
    `normal X secretly added ${hiddenExtensionMetres.toFixed(2)} m: ${JSON.stringify(intent)}`);
  assert.ok(intent.authoredDistanceMetres <= intent.requestedDistanceMetres * 1.18,
    `normal X exceeded its authored power window: ${JSON.stringify(intent)}`);
  assert.ok(intent.correctionAngleDeg <= 12,
    `normal X redirected ${intent.correctionAngleDeg.toFixed(2)} degrees: ${JSON.stringify(intent)}`);
  assert.notEqual(intent.assistance, 'rendezvous-inside-channel',
    'a runner outside the authored power window was allowed to rewrite the pass endpoint');
  assert.equal(result.launch.targetPlayerId, null,
    'a receiver beyond the selected weight and moving away was still force-selected');
  assert.equal(result.ball.target, null,
    'the host retained a wrong-way chase target for the short pass');
  assert.equal(result.controlled, passer,
    'control snapped to the unsuitable runner despite the authored short pass');
  assert.equal(result.logs.some(row => row.kind === 'pass-receiver-assignment'), false,
    'an impossible chase-only assignment was still logged');
});

test('normal-X power produces monotonic range and launch pace through its 3-40 m ground-pass band', () => {
  const powers = [.05, .07, .15, .25, .40, .55, .70, .85, 1];
  const rows = powers.map(power => {
    const result = executeNormalX({ power });
    return { power, result, flight: resolveCurrentMrFlight(result.launch) };
  });
  for (let index = 1; index < rows.length; index += 1) {
    assert.ok(rows[index].flight.targetDistance > rows[index - 1].flight.targetDistance,
      `more X power reduced range: ${formatFlight(rows[index - 1])} -> ${formatFlight(rows[index])}`);
    assert.ok(rows[index].flight.launchHorizontalSpeed + 1e-9 >= rows[index - 1].flight.launchHorizontalSpeed,
      `more X power reduced launch pace: ${formatFlight(rows[index - 1])} -> ${formatFlight(rows[index])}`);
  }
  const mediumFirm = rows.find(row => row.power === .55).flight;
  const full = rows.at(-1).flight;
  const lightest = rows[0].flight;
  assert.ok(lightest.targetDistance >= 3 && lightest.targetDistance <= 3.5,
    `lightest registerable X did not expose the shorter recycling pass: ${formatFlight(rows[0])}`);
  assert.ok(mediumFirm.targetDistance >= 19.5,
    `55% X still authored too little playable distance: ${formatFlight(rows.find(row => row.power === .55))}`);
  assert.ok(full.targetDistance >= 38 && full.targetDistance <= 40,
    `full X did not expose the expanded 38-40 m ground-pass range: ${formatFlight(rows.at(-1))}`);
});

test('normal-X hold power changes the V2 launch and terminal pace even when receiving distance is fixed', () => {
  const { normalXTrajectory } = executeNormalX({ power: .1 });
  const distanceMetres = 15;
  const tap = normalXTrajectory(.05, distanceMetres);
  const medium = normalXTrajectory(.50, distanceMetres);
  const firm = normalXTrajectory(1, distanceMetres);
  assert.ok(tap.launchPaceMps < medium.launchPaceMps && medium.launchPaceMps < firm.launchPaceMps,
    `normal X still uses power only to choose range at a fixed endpoint: ${JSON.stringify({ tap, medium, firm })}`);
  assert.ok(tap.terminalPaceMps < medium.terminalPaceMps && medium.terminalPaceMps < firm.terminalPaceMps,
    `normal X lost terminal power feel at a fixed endpoint: ${JSON.stringify({ tap, medium, firm })}`);
  assert.ok(tap.groundDampingInitialPerSecond > medium.groundDampingInitialPerSecond &&
    medium.groundDampingInitialPerSecond > firm.groundDampingInitialPerSecond,
  `higher input power did not reduce opening turf loss: ${JSON.stringify({ tap, medium, firm })}`);
  assert.ok(tap.groundSkidFrictionScale > medium.groundSkidFrictionScale &&
    medium.groundSkidFrictionScale > firm.groundSkidFrictionScale,
  `higher input power did not reduce opening skid drag: ${JSON.stringify({ tap, medium, firm })}`);
  assert.equal(tap.groundDampingRampExponent, 2.5);
  assert.equal(medium.groundDampingRampExponent, 2.5);
  assert.equal(firm.groundDampingRampExponent, 2.5);
});

test('representative 3-40 m normal-X passes stay grounded, decelerate and enter playable windows', () => {
  const powers = [.05, .30, .55, .78, 1];
  const rows = powers.map(power => {
    const result = executeNormalX({ power });
    return { power, result, flight: resolveCurrentMrFlight(result.launch) };
  });
  const violations = [];
  const accept = (condition, message) => { if (!condition) violations.push(message); };
  for (const row of rows) {
    const { result, flight } = row;
    const evidence = formatFlight(row);
    accept(result.launch.source === 'ground-pass', `normal X became a charged lob: ${evidence}`);
    accept(result.ball.zv === 0, `3-40 m normal X acquired host loft: ${evidence}`);
    accept(result.launch.liftAngleDeg === 0, `3-40 m normal X acquired MR lift: ${evidence}`);

    // The lower bound now protects a recognisable foot strike instead of
    // accepting the old softly towed launch. The upper bound remains below
    // shot pace even for a full 40 m driven ground pass.
    accept(flight.launchHorizontalSpeed >= 15.4 && flight.launchHorizontalSpeed <= 34.1,
      `normal X did not launch with believable crispness: ${evidence}`);
    accept(result.launch.groundDampingModel === 'progressive-ground-strike-v2',
      `normal X did not carry its isolated physical weighting profile: ${evidence}`);
    accept(Boolean(flight.arrival), `normal X never entered its receiving window: ${evidence}`);
    accept(Boolean(flight.atPredicted), `normal X has no measurable predicted meeting: ${evidence}`);
    if (flight.atPredicted) {
      accept(flight.atPredicted.distanceToTarget <= 1,
        `normal X missed its authored point at the predicted meeting: ${evidence}`);
      accept(Math.abs(flight.atPredicted.speed - result.launch.predictedTerminalPaceMetresPerSecond) <= 1.25,
        `normal X terminal prediction drifted from the measured ball: ${evidence}`);
      const maximumTerminalShare=flight.targetDistance<5?.62:.55;
      accept(flight.atPredicted.speed <= flight.launchHorizontalSpeed * maximumTerminalShare,
        `normal X retained an ice-like tail at its authored meeting: ${evidence}`);
    }
    if (flight.arrival) {
      accept(flight.arrival.seconds >= (flight.targetDistance<5?.11:.18) && flight.arrival.seconds <= 3.2,
        `normal X reached its receiving window implausibly: ${evidence}`);
      accept(flight.arrival.speed >= 2.0,
        `normal X died before a receiver could meet it: ${evidence}`);
    }

    const quarter = flight.thresholdSpeeds[0.25];
    const half = flight.thresholdSpeeds[0.5];
    const threeQuarter = flight.thresholdSpeeds[0.75];
    accept([quarter, half, threeQuarter].every(Number.isFinite),
      `normal X did not traverse its intended path: ${evidence}`);
    if ([quarter, half, threeQuarter].every(Number.isFinite)) {
      accept(quarter + 1e-6 >= half && half + 1e-6 >= threeQuarter,
        `normal X accelerated or held an artificial glide through its path: ${evidence}`);
      if (flight.atPredicted && flight.targetDistance >= 12) {
        const middleQuarterLoss = half - threeQuarter;
        const finalQuarterLoss = threeQuarter - flight.atPredicted.speed;
        // A 10% larger final-quarter loss is already a genuinely rising
        // distance-progressive drag curve. Keep that physical distinction
        // without shaving away the higher-charge end roll the player asked
        // to preserve.
        accept(finalQuarterLoss >= middleQuarterLoss * 1.10,
          `grass resistance did not rise non-linearly with continued travel: ${evidence}`);
        accept(finalQuarterLoss <= middleQuarterLoss * 2.4,
          `grass resistance arrived too abruptly in the final quarter: ${evidence}`);
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('the complete missed-pass rollout is bounded after the receiving window', () => {
  const powers = [.05, .20, .305, .35, .45, .55, .75, 1];
  const rows = powers.map(power => {
    const result = executeNormalX({ power });
    return { power, result, flight: resolveCurrentMrFlight(result.launch, 9) };
  });
  const violations = [];
  for (const row of rows) {
    const { flight } = row;
    const evidence = formatFlight(row);
    const tailDistance = flight.final.distanceFromOrigin - flight.targetDistance;
    const measuredTailTarget = 1.5 + 22 * row.power - 11 * row.power * row.power;
    const tailFloor = measuredTailTarget - .65;
    const tailLimit = measuredTailTarget + .75;
    if (!flight.settled) violations.push(`missed pass did not settle within nine seconds: ${evidence}`);
    if (flight.settled && flight.settled.seconds > 6.5) {
      violations.push(`missed pass remained live too long: ${evidence}`);
    }
    if (tailDistance < tailFloor - .05) {
      violations.push(`missed pass stopped after only ${tailDistance.toFixed(2)} m beyond a ${flight.targetDistance.toFixed(2)} m meeting: ${evidence}`);
    }
    if (tailDistance > tailLimit + .05) {
      violations.push(`missed pass slid ${tailDistance.toFixed(2)} m beyond a ${flight.targetDistance.toFixed(2)} m meeting: ${evidence}`);
    }
    if (flight.maximumPassiveSpeedGain > 1e-6) {
      violations.push(`pass passively accelerated by ${flight.maximumPassiveSpeedGain.toFixed(6)} m/s: ${evidence}`);
    }
    if (flight.launchHorizontalSpeed > 34.1) {
      violations.push(`ground-pass launch exceeded the calibrated band: ${evidence}`);
    }
  }
  const absoluteTails = rows.map(row => row.flight.final.distanceFromOrigin - row.flight.targetDistance);
  for (let index = 1; index < absoluteTails.length; index += 1) {
    if (absoluteTails[index] <= absoluteTails[index - 1]) {
      violations.push(`more X power reduced absolute post-meeting roll: ${JSON.stringify({ powers, absoluteTails })}`);
      break;
    }
  }
  if (absoluteTails.at(-1) < absoluteTails[0] * 3.7) {
    violations.push(`full-power X did not roll materially farther than a tap: ${JSON.stringify({ powers, absoluteTails })}`);
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('FL-MSSCWI9Y weak X retains the bounded additional slow-roll window estimated in replay after input remapping', () => {
  // The logged launch travelled 9.154 m to its authored meeting and stopped
  // after 12.582 m. Slow-motion inspection estimated roughly four further
  // rotations, but that visual count is not frame-calibrated. Treat it as the
  // centre of a three-to-five-rotation acceptance window without moving the
  // authored meeting itself.
  // The slightly faster 720 ms input curve needs about 25.7% charge to author
  // the same physical flight that previously required 23.9%.
  const result = executeNormalX({ power: .257, direction: { x: -.487, y: -.874 } });
  const flight = resolveCurrentMrFlight(result.launch, 9);
  const loggedFlightDistance = 9.154;
  const loggedStopDistance = 12.582;
  const minimumStopDistance = loggedStopDistance + 3 * FOOTBALL_CIRCUMFERENCE_METRES;
  const maximumStopDistance = loggedStopDistance + 5 * FOOTBALL_CIRCUMFERENCE_METRES;
  assert.ok(Math.abs(flight.targetDistance - loggedFlightDistance) <= .08,
    `incident reproduction changed the authored flight: ${formatFlight({ power: .257, flight })}`);
  assert.ok(flight.settled, `incident reproduction never settled: ${formatFlight({ power: .257, flight })}`);
  assert.ok(flight.final.distanceFromOrigin >= minimumStopDistance,
    `X retained less than the estimated slow-roll window: ${JSON.stringify({ minimumStopDistance, flight: formatFlight({ power: .257, flight }) })}`);
  assert.ok(flight.final.distanceFromOrigin <= maximumStopDistance,
    `X exceeded the estimated slow-roll window: ${JSON.stringify({ maximumStopDistance, flight: formatFlight({ power: .257, flight }) })}`);
  assert.ok(flight.settled.seconds <= 3.2,
    `slow-roll correction became an infinite slide: ${formatFlight({ power: .257, flight })}`);
  const intent = result.logs.find(row => row.kind === 'human-pass-intent')?.details;
  assert.equal(intent?.calibration, 'mr-v2-normal-x-measured-power-tail-v2-2026-08-14');
  assert.ok(Number.isFinite(intent?.groundDampingMaximumProgress));
});

test('full-charge normal X is a believable 38-40 m driven ground pass, never an implicit lob', () => {
  const result = executeNormalX({ power: 1 });
  const flight = resolveCurrentMrFlight(result.launch);
  assert.equal(result.launch.source, 'ground-pass');
  assert.equal(result.ball.flightType, 'ground-pass');
  assert.equal(result.ball.zv, 0);
  assert.equal(result.launch.liftAngleDeg, 0);
  assert.ok(flight.targetDistance >= 38 && flight.targetDistance <= 40,
    `full-charge X authored ${flight.targetDistance.toFixed(2)} m instead of an elite 38-40 m ground pass`);
  assert.ok(flight.arrival, `full-charge X never reached its meeting: ${formatFlight({ power: 1, flight })}`);
});

test('chase-only receiver assignment uses the exact same meeting as the Ball-V2 target', () => {
  const runner = player({
    id: 'runner', name: 'Runner', x: 1455, y: 1000, vx: 0, vy: 0,
    attrs: { pass: 70, pace: 82, reactions: 84 }
  });
  const result = executeNormalX({ power: .24, teammates: [runner] });
  const assignment = result.logs.find(event => event.kind === 'pass-receiver-assignment');
  const intent = result.logs.find(event => event.kind === 'human-pass-intent');
  assert.ok(assignment, 'scenario did not exercise chase-only assignment');
  assert.equal(result.launch.targetPlayerId, runner.id);
  assert.equal(assignment.details.sameAsBallTarget, true);
  assert.equal(assignment.details.meetingX, +result.launch.target.x.toFixed(1));
  assert.equal(assignment.details.meetingY, +result.launch.target.y.toFixed(1));
  assert.equal(intent.details.authoredMeetingX, +result.launch.target.x.toFixed(1));
  assert.equal(intent.details.authoredMeetingY, +result.launch.target.y.toFixed(1));
  assert.ok(Number.isFinite(intent.details.requestedDistanceMetres));
  assert.ok(Number.isFinite(intent.details.authoredDistanceMetres));
  assert.ok(Number.isFinite(intent.details.v2FlightDistanceMetres));
  assert.equal(intent.details.predictedArrivalTicks, result.launch.predictedArrivalTicks);
  assert.equal(intent.details.predictedTerminalPaceMps,
    +result.launch.predictedTerminalPaceMetresPerSecond.toFixed(2));
  assert.equal(intent.details.groundDampingModel, 'progressive-ground-strike-v2');
  assert.equal(intent.details.groundLinearDampingUntilSeconds, 8);
  assert.ok(Number.isFinite(intent.details.groundDampingInitialPerSecond));
  assert.ok(Number.isFinite(intent.details.groundDampingRampScale));
  assert.equal(intent.details.groundDampingRampExponent, 2.5);
  assert.ok(Number.isFinite(intent.details.groundDampingReferenceDistanceMetres));
  assert.ok(Number.isFinite(intent.details.groundSkidFrictionScale));
});
