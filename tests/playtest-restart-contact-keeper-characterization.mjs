import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BallV2 = require('../match-engine/ball-engine-v2.js');
const html = fs.readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const WORLD_SCALE = 1.045;
const W = Math.round(3200 * WORLD_SCALE);
const H = Math.round(2050 * WORLD_SCALE);
const M = Math.round(80 * WORLD_SCALE);
const PITCH_UNITS_PER_METRE = (H - 12) / 68;
const X_UNITS_PER_METRE = (W - 2 * M) / 105;
const Y_UNITS_PER_METRE = H / 68;
const CONTROL_RADIUS = 12.75 * 2 + 28;
const ERAS = [
  { ballSpeed: .88, loft: .84, airDrag: .9905, bounce: .41 },
  { ballSpeed: .94, loft: .91, airDrag: .9918, bounce: .44 },
  { ballSpeed: .99, loft: .97, airDrag: .9928, bounce: .47 },
  { ballSpeed: 1.03, loft: 1.02, airDrag: .9938, bounce: .49 }
];

function section(start, end, source = html) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

function trajectoryFunctions(era = ERAS.at(-1)) {
  const throwSource = section('function standardThrowTrajectory', 'function standardLobTrajectory');
  const lowCrossSource = section('function standardLowCrossTrajectory', 'function standardCrossTrajectory');
  return new Function('ERA_MATCH', 'PITCH_UNITS_PER_METRE', 'clamp', `
    ${throwSource}
    ${lowCrossSource}
    return { standardThrowTrajectory, standardLowCrossTrajectory };
  `)(era, PITCH_UNITS_PER_METRE, clamp);
}

function simulateV2(plan, distance, { startHeight = 1, axis = 'y', frames = plan.v2FlightTicks || plan.contactFrame } = {}) {
  const horizontalScale = axis === 'x' ? X_UNITS_PER_METRE : Y_UNITS_PER_METRE;
  const speedMetresPerSecond = plan.v2SpeedWorld * 60 / horizontalScale;
  const verticalIntentMetresPerSecond = plan.v2LoftWorld * 60 / PITCH_UNITS_PER_METRE;
  const liftAngleDeg = Math.atan2(verticalIntentMetresPerSecond, speedMetresPerSecond) * 180 / Math.PI;
  let { state } = BallV2.resolveLaunch({
    origin: { x: 0, y: 0, z: startHeight / PITCH_UNITS_PER_METRE + .11 },
    direction: { x: 1, y: 0, z: 0 },
    speed: speedMetresPerSecond,
    liftAngleDeg,
    source: 'FL-MSQ4R4TZ-characterization'
  });
  let context = BallV2.createSimulationContext({ seed: 404 });
  let maximumHeight = startHeight;
  let arrival = null;
  for (let frame = 1; frame <= frames; frame += 1) {
    ({ state, context } = BallV2.step(state, context, 1 / 60, { groundEnabled: true, colliders: [] }));
    const travelled = state.position.x * horizontalScale;
    const height = (state.position.z - .11) * PITCH_UNITS_PER_METRE;
    maximumHeight = Math.max(maximumHeight, height);
    if (!arrival && travelled >= distance) arrival = { frame, travelled, height, regime: state.regime };
  }
  return {
    travelled: state.position.x * horizontalScale,
    height: (state.position.z - .11) * PITCH_UNITS_PER_METRE,
    maximumHeight,
    arrival
  };
}

test('all inline match scripts remain syntactically valid', () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 4);
  scripts.forEach((match, index) => {
    if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]), `inline script ${index}`);
  });
});

test('pause-adjusted deadlines never turn a human or paused restart into an AI release', () => {
  const shiftSource = section('function shiftPausedPresentationTimers', 'function togglePause');
  const shiftRuntime = new Function(`
    let kickoffHeld=true,restartStartedAt=1000,restartEarliestAt=2000,restartForceAt=3000,restartReadySince=4000,resetUntil=5000;
    let celebrationChoiceDeadline=0,celebrationStartedAt=0,celebrationCompletedAt=0,goalBroadcastHoldUntil=0,setPieceCameraHold=null;
    const goalReplay={active:false},disciplineReplay={active:false},diveReplay={active:false},specialPSequence={active:false};
    const you=[],opp=[],ykeep={},okeep={};
    const shiftContactPresentationTimers=()=>0;
    ${shiftSource}
    return { shift:shiftPausedPresentationTimers, snapshot:()=>({restartStartedAt,restartEarliestAt,restartForceAt,restartReadySince,resetUntil}) };
  `)();
  shiftRuntime.shift(20000);
  assert.deepEqual(shiftRuntime.snapshot(), {
    restartStartedAt: 21000,
    restartEarliestAt: 22000,
    restartForceAt: 23000,
    restartReadySince: 24000,
    resetUntil: 25000
  });

  const watchdogSource = section('function cpuNonKickoffRestartWatchdogEligible', 'function updateDeadBallDisplay');
  const watchdog = new Function(`
    let paused=false,reset=false,restartMsg='THROW-IN',restartTaker={team:'opp'},restartStartedAt=1000,humanTeam=null;
    const performance={now:()=>0},inReset=()=>reset,teamHasHumanController=team=>team===humanTeam;
    ${watchdogSource}
    return values=>{Object.assign({},{...values});paused=!!values.paused;reset=!!values.reset;restartMsg=values.restartMsg;restartTaker=values.restartTaker;restartStartedAt=values.restartStartedAt;humanTeam=values.humanTeam;return cpuNonKickoffRestartWatchdogEligible(values.now);};
  `)();
  const base = { reset: false, restartMsg: 'THROW-IN', restartTaker: { team: 'opp' }, restartStartedAt: 1000, humanTeam: null };
  assert.equal(watchdog({ ...base, paused: true, now: 50000 }), false, 'paused CPU restart must not release');
  assert.equal(watchdog({ ...base, paused: false, humanTeam: 'opp', now: 50000 }), false, 'human restart must never use the CPU watchdog');
  assert.equal(watchdog({ ...base, paused: false, now: 13000 }), false, 'deadline is strictly active-play time');
  assert.equal(watchdog({ ...base, paused: false, now: 13001 }), true, 'CPU watchdog remains available after twelve active seconds');
  assert.equal(watchdog({ ...base, paused: false, restartStartedAt: 21000, now: 26000 }), false, 'a 20s pause-shift leaves only 5s active elapsed');
  assert.equal(watchdog({ ...base, paused: false, restartStartedAt: 21000, now: 33001 }), true);
  assert.match(html, /else if\(cpuNonKickoffRestartWatchdogEligible\(\)\)\{aiRestartPass\(restartTaker\);\}/);
});

test('the loose-ball slide branch resolves swept contact before incidental pickup', () => {
  const slideSource = section('function advanceSlideTackle', 'function solidTrapTackleRead');
  const runtime = new Function(`
    const DT=1,rad=12.75,kickoffHeld=false,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),events=[];
    let ball={owner:null,isShot:false,x:95,y:100,z:0,vx:1,vy:0,zv:0},lastTouch=null,lastTouchPlayer=null,poss=0;
    const slideTackleProfile=()=>({cleanReach:60}),facing=p=>({x:p.fx,y:p.fy}),report={teams:{you:{tackles:0}}};
    const logEvent=(type,team,player,details)=>events.push({type,team,playerId:player.id,...details});
    const holdContactPresentation=()=>true;
    ${slideSource}
    return { run(player){advanceSlideTackle(player,()=>{});return {player,ball,events,report,lastTouch};} };
  `)();
  const player = { id: 'slider', team: 'you', x: 100, y: 100, vx: 10, vy: 0, fx: 1, fy: 0, slide: 5, slideDuration: 10, slideEntrySpeed: 10, slideTravel: 0, slideWon: false, stats: { tackles: 0, rating: 0 } };
  const result = runtime.run(player);
  assert.equal(result.player.slideWon, true);
  assert.equal(result.ball.lastKicker, player);
  assert.equal(result.events.at(-1).looseBall, true);
  assert.equal(result.events.at(-1).slide, true);
  assert.equal(result.report.teams.you.tackles, 1);
});

test('CPU throw solver lands across the legal range in legacy and V2 authority', () => {
  for (const era of ERAS) {
    const { standardThrowTrajectory } = trajectoryFunctions(era);
    for (const distance of [70, 180, 320, 520]) {
      const plan = standardThrowTrajectory(distance, 50, 18);
      let x = 0, z = 50, vx = plan.speed * era.ballSpeed, zv = plan.loft * era.loft;
      for (let frame = 0; frame < plan.flightTicks; frame += 1) {
        x += vx; z += zv; zv -= .26; vx *= era.airDrag;
      }
      assert.ok(Math.abs(x - distance) < .05, `legacy throw distance ${distance}`);
      assert.ok(Math.abs(z - 18) < .05, `legacy throw height ${distance}`);
      for (const axis of ['x', 'y']) {
        const simulated = simulateV2(plan, distance, { startHeight: 50, axis, frames: plan.v2FlightTicks });
        assert.ok(Math.abs(simulated.travelled - distance) <= CONTROL_RADIUS, `V2 ${axis}-axis throw must finish within one control radius at ${distance}`);
        assert.ok(Math.abs(simulated.height - 18) <= 9, `V2 throw must remain receiveable at ${distance}`);
      }
    }
  }
  const cpuRestart = section('function aiRestartPass', 'function takeUserRestart');
  const cpuThrow = section("if(kind==='THROW-IN')", "}else if(kind==='CORNER')", cpuRestart);
  assert.match(cpuThrow, /legalDistance=clamp\(rawDistance,70,520\)/);
  assert.match(cpuThrow, /standardThrowTrajectory\(legalDistance,50,18\)/);
  assert.match(cpuThrow, /v2SpeedWorld:trajectory\.v2SpeedWorld,v2LoftWorld:trajectory\.v2LoftWorld/);
  assert.match(cpuThrow, /authority:'distance-solved-throw'/);
  assert.doesNotMatch(cpuThrow, /playRestartBall\(taker,target,6\.0,3\.2/);
  const humanRestart = section('function takeUserRestart', 'function keeperKick');
  assert.match(humanRestart, /maximumDistance=220\+300\*p/);
  assert.match(humanRestart, /legalDistance=clamp\(rawDistance,70,maximumDistance\)/);
  assert.match(humanRestart, /standardThrowTrajectory\(legalDistance,50,18\)/);
  assert.match(humanRestart, /nearestPlayerToPoint\(taker\.team,point,q=>q!==taker\)/);
});

test('controlled touches atomically clear stale throw and cross flight metadata', () => {
  const clearSource = section('function clearControlledTouchFlightMetadata', 'function clearAerialAssignments');
  const runtime = new Function(`
    const aerialClearReasons=[];
    const clearHumanAerialFinishIntent=reason=>{aerialClearReasons.push(reason);return true;};
    ${clearSource}
    return { clear:clearControlledTouchFlightMetadata, aerialClearReasons };
  `)();
  const state = {
    flightType: 'throw-in', flightAge: 35, aerialSource: { id: 'thrower' }, aerialCooldown: 9, minAerialFlightAge: 22,
    crossContestLogged: true, crossNoContactLogged: true, crossContactFrame: 31, crossContactHeight: 13, crossAuditId: 'old',
    v2ServiceKind:'byline',trajectoryProfile: { old: true }, aimTarget: { x: 1 }, dip: .3, spin: .4, curveAccel: .2
  };
  assert.equal(runtime.clear(state), true);
  assert.deepEqual(runtime.aerialClearReasons, ['controlled-touch']);
  assert.deepEqual(state, {
    flightType: null, flightAge: 0, aerialSource: null, aerialCooldown: 0, minAerialFlightAge: 0,
    crossContestLogged: false, crossNoContactLogged: false, crossContactFrame: null, crossContactHeight: null, crossAuditId: null,
    crossNoContactFrame: null, crossSourceFlight: null, crossRouteExpired: false,v2ServiceKind:null,
    directionalKnockOnContract: null, pendingKickoffReceipt: null,
    trajectoryProfile: null, aimTarget: null, dip: 0, spin: 0, curveAccel: null
  });
  assert.match(section('function liveV2ApplyMovement', 'function liveV2ApplyIntelligence'), /ball\.owner=owner[\s\S]*clearControlledTouchFlightMetadata\(ball\)/);
  assert.match(section('if(!liveV2SuppressLegacyReception', 'if(pendingFreeKickReplay'), /beginFirstTouch[\s\S]*ball\.owner=b[\s\S]*clearControlledTouchFlightMetadata\(ball\)/);
});

test('goal-kick staging is legal and motionless before the restart becomes observable', () => {
  const stagingSource = section('function enforceGoalKickExclusion', 'function legalKickoffPoint');
  const runtime = new Function(`
    const M=84,W=3344,BOX_D=500,performance={now:()=>777},other=team=>team==='you'?'opp':'you';
    let kickoffHeld=true,restartMsg='GOAL KICK';
    const taker={id:'gk',team:'you',x:100,y:100,vx:3,vy:2,desiredVx:1,desiredVy:1,gait:'sprint',locomotionState:'run',action:'goalKick',actionT:20,setPieceTarget:{x:140,y:100},sentOff:false};
    const mate={id:'mate',team:'you',x:250,y:300,vx:4,vy:2,desiredVx:3,desiredVy:2,gait:'sprint',locomotionState:'run',action:'pass',actionT:8,slide:4,lunge:2,setPieceTarget:{x:400,y:500},sentOff:false};
    const opponent={id:'opponent',team:'opp',x:120,y:500,vx:5,vy:2,desiredVx:2,desiredVy:2,gait:'sprint',locomotionState:'run',action:'tackle',actionT:8,slide:3,lunge:2,setPieceTarget:{x:130,y:500,priority:1},sentOff:false};
    const you=[mate],opp=[opponent],ykeep=taker,okeep=null,restartTaker=taker,teamList=team=>team==='you'?[mate,taker]:[opponent];
    const inOwnPenaltyArea=(p,team)=>team==='you'?p.x<M+BOX_D:p.x>W-M-BOX_D;
    ${stagingSource}
    return { result:stageGoalKickAtomically(),taker,mate,opponent };
  `)();
  assert.deepEqual(runtime.result, { atomic: true, stagedPlayers: 3, illegalOpponents: 0 });
  for (const player of [runtime.taker, runtime.mate, runtime.opponent]) {
    assert.equal(player.vx, 0); assert.equal(player.vy, 0);
    assert.equal(player.desiredVx, 0); assert.equal(player.desiredVy, 0);
    assert.equal(player.gait, 'idle'); assert.equal(player.locomotionState, 'idle');
    assert.equal(player.action, 'idle'); assert.equal(player.actionT, 0);
    assert.equal(player.setPieceLocked, true);
  }
  assert.ok(runtime.opponent.x >= 84 + 500 + 42);
  const restartSource = section('function restart(kind', 'function setPieceReady');
  const stageAt = restartSource.indexOf("const goalKickStaging=kind==='GOAL KICK'?stageGoalKickAtomically():null");
  assert.ok(stageAt > restartSource.indexOf('arrangeSetPiece(kind,team,x,y,taker)'));
  assert.ok(stageAt < restartSource.indexOf("showEvent(fromFoul?'FOUL · FREE KICK':kind"));
  assert.ok(stageAt < restartSource.indexOf("logEvent('restart'"));
});

test('keeper release telemetry records real input provenance for rejected and accepted edges', () => {
  const keeperKickSource = section('function keeperKick', 'function doPassForHuman');
  const runtime = new Function(`
    const events=[],clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),twoPlayerEnabled=false,SAME_TEAM_COOP=false;
    let kickoffHeld=false,restartTaker=null,controlled=null,controlledOpp=null,ball={owner:null,humanController:null};
    const gk={id:'keeper',team:'you',hold:12,holdReleaseAt:50},target={id:'target',team:'you'};
    const logEvent=(type,team,player,details)=>events.push({type,team,playerId:player&&player.id,...details});
    const goalkeeperDistributionPlan=()=>({mode:'short',target}),executeGoalkeeperDistribution=()=>true,completeRestart=()=>{kickoffHeld=false;},secondTeamHasHuman=()=>false;
    ${keeperKickSource}
    return {
      reject(){ball.owner={id:'other'};kickoffHeld=false;restartTaker=null;return keeperKick(gk,'throw',.63,'controller-1-cross');},
      accept(){ball.owner=gk;kickoffHeld=true;restartTaker=gk;return keeperKick(gk,'throw',.63,'controller-1-cross');},events
    };
  `)();
  assert.equal(runtime.reject(), false);
  assert.deepEqual(runtime.events.at(-1), {
    type: 'keeper-release-input', team: 'you', playerId: 'keeper', inputSource: 'controller-1-cross', inputDevice: 'gamepad', controller: 1,
    edge: 'release', requested: 'throw', power: .63, accepted: false, reason: 'possession-lost-before-release', keeperId: 'keeper', ballOwnerId: 'other'
  });
  assert.equal(runtime.accept(), true);
  assert.equal(runtime.events.at(-1).accepted, true);
  assert.equal(runtime.events.at(-1).reason, 'restart-released');
  assert.equal(runtime.events.at(-1).edge, 'release');
  for (const source of ['controller-1-cross', 'controller-1-circle', 'controller-1-square', 'controller-2-cross', 'controller-2-circle', 'controller-2-square', 'keyboard-a', 'keyboard-s']) {
    assert.ok(html.includes(`'${source}'`), `missing keeper input provenance ${source}`);
  }
  for (const reason of ['keeper-unavailable', 'possession-lost-before-release', 'no-eligible-target', 'launch-rejected', 'restart-released', 'released']) {
    assert.ok(keeperKickSource.includes(`'${reason}'`), `missing keeper release outcome ${reason}`);
  }
});

test('human and CPU keepers share keeperCarry and the owned ball uses the carry socket', () => {
  const cpuCarry = section('function moveGoalkeeperWithBall', 'function updateGoalkeeper');
  const keeperUpdate = section('function updateGoalkeeper', 'function penaltyKeeperChoiceCoversBall');
  assert.match(cpuCarry, /gk\.action='keeperCarry';gk\.actionT=8;gk\.keeperAnimationDuration=8/);
  assert.match(keeperUpdate, /if\(humanControlled\)\{gk\.keeperPose='carry';gk\.keeperCarryKey='human';gk\.action='keeperCarry';gk\.actionT=8;gk\.keeperAnimationDuration=8;\}/);
  assert.match(html, /carrySocket\.name='keeperCarryBallSocket'/);
  assert.match(html, /grp\.userData=\{[\s\S]*carrySocket,/);
  assert.match(section('function heldBallAnchor', 'function updateSetPieceGuide'), /ball\.owner\.action==='keeperCarry'/);
  assert.match(html, /const heldAnchor=heldBallAnchor\(\),ballWorldX=heldAnchor\?heldAnchor\.x/);
  assert.match(html, /if\(!heldAnchor&&Number\.isFinite\(ballVisualPreviousX\)/);
});

test('R1+Square keeps five-run assignment while the low cross arrives flat at receiver pace', () => {
  for (const era of ERAS) {
    const { standardLowCrossTrajectory } = trajectoryFunctions(era);
    for (const distance of [280, 520, 755, 900]) {
      const plan = standardLowCrossTrajectory(distance, .58);
      assert.equal(plan.mode, 'low-cross');
      assert.equal(plan.calibration, 'fl-v2-flat-skid');
      assert.equal(plan.contactHeight, 0);
      assert.ok(Number.isInteger(plan.v2ContactFrame));
      assert.ok(plan.paceMps >= 17.8 && plan.paceMps <= 19.8);
      assert.ok(plan.speed < 12, 'legacy speed must stay well below the exported 24.784 runaway value');

      let x = 0, z = 1, vx = plan.speed * era.ballSpeed, zv = plan.loft * era.loft, maximumHeight = 1, arrivalFrame = null;
      for (let frame = 1; frame <= 220; frame += 1) {
        x += vx;
        if (z > 0 || zv > 0) {
          z += zv; zv -= .26; vx *= era.airDrag;
          if (z <= 0) {
            z = 0;
            if (zv < -1.05) { zv = -zv * era.bounce; vx *= .74; } else zv = 0;
          }
        } else vx *= .993;
        maximumHeight = Math.max(maximumHeight, z);
        if (!arrivalFrame && x >= distance) arrivalFrame = frame;
      }
      assert.ok(arrivalFrame, `legacy low cross reaches ${distance}`);
      assert.ok(Math.abs(arrivalFrame - plan.contactFrame) <= 8, `legacy contact frame stays solved at ${distance}`);
      assert.ok(maximumHeight <= 2, `legacy low cross stays flat at ${distance}`);

      const simulated = simulateV2(plan, distance, { startHeight: 1, axis: 'y', frames: plan.v2ContactFrame + 30 });
      assert.ok(simulated.arrival, `V2 low cross reaches ${distance}`);
      assert.ok(Math.abs(simulated.arrival.frame - plan.v2ContactFrame) <= 8,
        `V2 contact stays inside the MR receiver window at ${distance}: actual ${simulated.arrival.frame}, planned ${plan.v2ContactFrame}`);
      assert.ok(simulated.arrival.frame <= plan.v2ContactFrame + 8,
        `V2 route must not expire before MR contact at ${distance}`);
      assert.ok(simulated.maximumHeight <= 2, `V2 low cross stays below ${2 / PITCH_UNITS_PER_METRE}m at ${distance}`);
      assert.equal(simulated.arrival.height, 0);
    }
  }
  const launch = section('function launchMatchBall', 'function playRestartBallToPoint');
  assert.match(launch, /stagedV2Launch&&Number\.isFinite\(opts\.v2ContactFrame\)\?opts\.v2ContactFrame:opts\.contactFrame/);
  const lob = section('function doLobPassFor', 'function doLobPass');
  assert.match(launch, /'driven-cross','low-cross','free-kick-cross'/);
  assert.match(lob, /v2SpeedWorld:trajectory\.v2SpeedWorld,v2LoftWorld:trajectory\.v2LoftWorld/);
  assert.match(lob, /v2ContactFrame:isCross\?trajectory\.v2ContactFrame:null/);
  assert.match(lob, /contactHeight:trajectory\.contactHeight\?\?null/);
  assert.match(lob, /calibration:trajectory\.calibration\|\|null/);
  assert.match(html, /const lowCrossSkid=ball\.flightType==='low-cross'/);
});

console.log('FL-MSQ4R4TZ restart, contact, keeper and low-cross functional contracts: PASS');
