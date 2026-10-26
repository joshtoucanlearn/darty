import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchPath = path.join(root, 'match-engine', 'match.html');
const adapterPath = path.join(root, 'match-engine', 'live-v2-authority-adapter.js');
const composerPath = path.join(root, 'match-engine', 'live-v2-contact-authority-composer.js');
const matchSource = fs.readFileSync(matchPath, 'utf8');
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const require = createRequire(import.meta.url);
const Movement = require(path.join(root, 'match-engine', 'movement-engine-v2.js'));
const Ball = require(path.join(root, 'match-engine', 'ball-engine-v2.js'));
const CPU = require(path.join(root, 'match-engine', 'cpu-intelligence-v2.js'));
const Formation = require(path.join(root, 'match-engine', 'formation-behaviour-v2.js'));
const Composer = require(composerPath);
const Adapter = require(adapterPath);

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return source.slice(from, to);
}

function capability() {
  return Composer.createCapability({
    enabled: true,
    online: false,
    workflow: 'single-player',
    parentAdapterVersion: Composer.PARENT_VERSION,
    parentGrant: 'offline-normal-match-live-authority',
    acknowledgement: Composer.ACKNOWLEDGEMENT
  });
}

function movementPlayer(id, teamId, x, y = 0) {
  return {
    id,
    teamId,
    role: teamId === 'you' ? 'CM' : 'CB',
    position: { x, y },
    velocity: { x: 0, y: 0 },
    facing: { x: teamId === 'you' ? 1 : -1, y: 0 },
    attributes: {
      pace: 78,
      acceleration: 78,
      agility: 86,
      balance: 86,
      strength: 76,
      stamina: 80,
      defending: teamId === 'you' ? 58 : 78,
      aggression: 70,
      control: 92
    }
  };
}

function roster(player, contactEligible = true) {
  return {
    id: player.id,
    teamId: player.teamId,
    isGK: false,
    sentOff: false,
    available: true,
    contactEligible,
    heightM: 1.82,
    attributes: {
      control: 92,
      technique: 90,
      awareness: 90,
      heading: 72,
      jumping: 72,
      strength: 76,
      shooting: 72,
      shoot: 72,
      volleys: 72,
      balance: 86,
      agility: 86,
      defending: player.teamId === 'you' ? 58 : 78
    }
  };
}

function goalkeeperPossessionSnapshot() {
  const tick = 1;
  const pitch = { xMin: 0, xMax: 105, yMin: -34, yMax: 34 };
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId,
    formation: '4-3-3',
    phase: teamId === 'you' ? 'settled-attack' : 'defend',
    philosophy: null,
    attackingDirection: teamId === 'you' ? 1 : -1,
    offsideLine: teamId === 'you' ? 90 : 15,
    tactics: {},
    lineup: Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }))
  }));
  const players = teams.flatMap(team => Formation.resolve({
    formation: team.formation,
    phase: team.phase,
    tick,
    lineup: team.lineup,
    pitch,
    attackingDirection: team.attackingDirection,
    offsideLine: team.offsideLine,
    tactics: team.tactics
  }).targets.map(target => ({
    id: target.playerId,
    teamId: team.id,
    role: target.position,
    position: target.position,
    slotId: target.slotId,
    x: target.target.x,
    y: target.target.y,
    vx: 0,
    vy: 0,
    fx: team.attackingDirection,
    fy: 0,
    radius: 0.42,
    stamina: 100,
    attrs: {
      pace: 80, accel: 80, agility: 80, balance: 80, strength: 80, stamina: 80,
      awareness: 84, pass: 82, shoot: 76, control: 84, defend: 78, aggression: 78
    },
    isGK: target.position === 'GK',
    sentOff: false,
    tackleActive: false,
    shoulderActive: false,
    control: null
  })));
  const goalkeeper = players.find(player => player.id === 'you-GK');
  assert.ok(goalkeeper, 'canonical fixture must expose the possessing goalkeeper');
  return {
    tick,
    fixedTickSeconds: 1 / 60,
    pitch,
    units: { xPerMetre: 1, yPerMetre: 1, zPerMetre: 1 },
    players,
    humanPlayerIds: [],
    ball: {
      id: 'live-ball', x: goalkeeper.x, y: goalkeeper.y, z: 0,
      vx: 0, vy: 0, zv: 0, spin: 0, dip: 0,
      ownerId: goalkeeper.id, targetId: null, lastKickerId: null,
      flightType: '', launchIntent: null
    },
    teams,
    contact: {
      intendedReceiverId: null,
      firstTouchIntent: null,
      aerialIntent: null,
      gate: {
        livePlay: true,
        restartActive: false,
        replayActive: false,
        keeperAuthority: true,
        offsideInvolvementPending: false,
        specialActionAuthority: false
      }
    }
  };
}

function releaseContactRequest({
  tick = 20,
  sourceEligible = false,
  sourceX = 52.5,
  receiverX = 55,
  ballX = sourceX,
  ballZ = 0.11,
  velocity = { x: 5, y: 0, z: 0 },
  grounded = true,
  regime = Ball.REGIMES.ROLL
} = {}) {
  const source = movementPlayer('source', 'you', sourceX);
  const receiver = movementPlayer('receiver', 'you', receiverX);
  const defender = movementPlayer('defender', 'opp', 61);
  const movementWorld = Movement.createWorldState({
    tick,
    fixedTickSeconds: 1 / 60,
    bounds: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    ballOwnerId: null,
    players: [source, receiver, defender]
  });
  const ballState = Ball.createBallState({
    id: 'match-ball',
    position: { x: ballX, y: 0, z: ballZ },
    velocity,
    angularVelocity: { x: 0, y: 2, z: 0 },
    grounded,
    regime,
    lastOuterTick: tick,
    contactCount: 0,
    simulationTime: tick / 60
  });
  return {
    schema: Composer.REQUEST_SCHEMA,
    workflow: 'single-player',
    online: false,
    tick,
    epoch: 0,
    seed: 173,
    fixedTickSeconds: 1 / 60,
    movementWorld,
    ballState,
    roster: [roster(source, sourceEligible), roster(receiver), roster(defender)],
    intendedReceiverId: 'receiver',
    firstTouchIntent: null,
    aerialIntent: null,
    consumedFirstTouchIds: [],
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

test('the live snapshot excludes a recent kicker and propagates that eligibility into contact authority', () => {
  const snapshot = sourceBetween(matchSource, 'function liveV2Snapshot', 'function liveV2CanAdvance');
  assert.match(snapshot, /kickerLocked=ball\.lastKicker===player&&Number\(ball\.kickerLock\|\|0\)>0/);
  assert.match(snapshot, /receptionLocked=Number\(player\.receiveT\|\|0\)>0/);
  assert.match(snapshot, /contactEligible:!kickerLocked&&!receptionLocked/);

  const normalize = sourceBetween(adapterSource, 'function normalizeSnapshot', 'function livePoint');
  assert.match(normalize, /contactEligible:\s*player\.contactEligible\s*!==\s*false/);
  assert.match(adapterSource, /contactEligible:\s*!player\.sentOff\s*&&\s*!player\.isGK\s*&&\s*player\.contactEligible/);
  assert.match(snapshot, /shield:!!player\.shielding/, 'L2 shielding must cross the live V2 snapshot boundary');
  assert.match(snapshot, /type:'cushion'[\s\S]*touchDistanceM:\.18\+input\.strength\*\.28[\s\S]*active:false/, 'ordinary receiver input must author a directional cushion without forcing an ownerless knock-on');
  assert.match(matchSource, /function performDirectionalKnockOn[\s\S]*flightType='directional-knock-on'/, 'the explicit L1 plus right-stick knock-on workflow must remain available');
  assert.match(adapterSource, /control\.shield\s*\?\s*'shield'/, 'shield mode must outrank run and sprint in Movement V2');
  assert.match(adapterSource, /touchBurstUntilTick:\s*snapshot\.tick\s*\+\s*2/, 'an explicit directional First Touch intent must retain its two-tick acceleration-only burst');
  assert.match(matchSource, /player\.locomotionState==='shield'[\s\S]*player\.shieldSide=/, 'the live projection must retain a mirrored visible shielding pose');
});

test('short pass, loft and either throw-in side cannot be re-contacted by their source on the release tick', async t => {
  const cases = [
    ['short pass', { velocity: { x: 5, y: 0, z: 0 }, grounded: true, regime: Ball.REGIMES.ROLL }],
    ['lofted pass', { ballZ: 0.7, velocity: { x: 8, y: 0, z: 2.4 }, grounded: false, regime: Ball.REGIMES.FLIGHT }],
    ['human throw-in', { ballZ: 1.1, velocity: { x: 6, y: 1, z: 2 }, grounded: false, regime: Ball.REGIMES.FLIGHT }],
    ['CPU throw-in', { ballZ: 1.1, velocity: { x: 6, y: -1, z: 2 }, grounded: false, regime: Ball.REGIMES.FLIGHT }]
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, () => {
      const result = Composer.compose(releaseContactRequest(overrides), capability());
      assert.equal(result.status, 'no-contact');
      assert.equal(result.ownedContact, false);
      assert.equal(result.detail, 'no-eligible-first-touch-receiver');
      assert.equal(result.ballState.lastContact, null);
    });
  }

  const unsafeControl = Composer.compose(releaseContactRequest({ sourceEligible: true }), capability());
  assert.equal(unsafeControl.status, 'contact', 'control fixture must reproduce source self-contact if exclusion is removed');
  assert.equal(unsafeControl.ballState.lastContact.colliderId, 'source');
});

test('the intended receiver can contact after the ball has cleared the excluded source', () => {
  const result = Composer.compose(releaseContactRequest({
    sourceX: 52.5,
    receiverX: 55,
    ballX: 54.85,
    velocity: { x: 4, y: 0, z: 0 }
  }), capability());
  assert.equal(result.status, 'contact');
  assert.equal(result.contactType, 'first-touch');
  assert.equal(result.ballState.lastContact.colliderId, 'receiver');
  assert.notEqual(result.ballState.lastContact.colliderId, 'source');
});

test('V2 owns the ground reception lane and grants possession only inside the 0.74 metre contact window', () => {
  assert.equal(Composer.FIRST_TOUCH_ACQUISITION_RADIUS_METRES, 0.74);
  const outside = Composer.compose(releaseContactRequest({
    receiverX: 55,
    ballX: 54.25,
    velocity: { x: 3, y: 0, z: 0 }
  }), capability());
  assert.equal(outside.status, 'no-contact');
  assert.equal(outside.ownedContact, false);
  assert.equal(outside.suppressLegacy.reception, true, 'the old 2.35m reception lane may not retry a V2 miss');

  const inside = Composer.compose(releaseContactRequest({
    receiverX: 55,
    ballX: 54.35,
    velocity: { x: 0.8, y: 0, z: 0 }
  }), capability());
  assert.equal(inside.status, 'contact');
  assert.equal(inside.ownerCandidateId, 'receiver');

  const hostApply = sourceBetween(matchSource, 'function liveV2ApplyMovement', 'function liveV2ApplyIntelligence');
  assert.doesNotMatch(hostApply, /ball\.x=owner\.x|ball\.y=owner\.y/, 'ownership must not teleport the ball to the player centre');
});

test('neutral V2 play assigns one collector per team and assists the intended human toward the ball', () => {
  const makeSnapshot = oppositeInput => {
    const snapshot = goalkeeperPossessionSnapshot();
    const receiver = snapshot.players.find(player => player.id === 'you-CAM') || snapshot.players.find(player => player.teamId === 'you' && !player.isGK);
    receiver.x = 50; receiver.y = 0;
    receiver.control = oppositeInput
      ? { x: -1, y: 0, strength: 1, sprint: false, shield: false }
      : { x: 0, y: 0, strength: 0, sprint: false, shield: false };
    snapshot.humanPlayerIds = [receiver.id];
    Object.assign(snapshot.ball, {
      x: 52.2, y: 0, z: 0, vx: 0.045, vy: 0, zv: 0,
      ownerId: null, targetId: receiver.id, lastKickerId: 'you-ST',
      flightType: 'ground-pass', launchIntent: null
    });
    snapshot.contact.intendedReceiverId = receiver.id;
    snapshot.contact.gate.keeperAuthority = false;
    return { snapshot, receiver };
  };
  const plan = oppositeInput => {
    const { snapshot, receiver } = makeSnapshot(oppositeInput);
    const live = Adapter.createAttachment({
      enabled: true,
      capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT,
        workflow: 'single-player', online: false, onlineMarkers: {} }),
      seed: 173173,
      dependencies: { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Composer },
      host: { prepareTick() { return { commit() {}, rollback() {} }; } }
    });
    const frame = live.planTick(snapshot);
    assert.ok(frame, JSON.stringify(live.status()));
    return { frame, receiver };
  };

  const assisted = plan(false);
  assert.equal(assisted.frame.hostProjection.recoveryAssignments.length, 2);
  assert.deepEqual(assisted.frame.hostProjection.recoveryAssignments.map(row => row.teamId).sort(), ['opp', 'you']);
  const humanAssignment = assisted.frame.hostProjection.recoveryAssignments.find(row => row.playerId === assisted.receiver.id);
  assert.ok(humanAssignment && humanAssignment.intended && humanAssignment.human);
  const assistedProjection = assisted.frame.hostProjection.movement.find(row => row.id === assisted.receiver.id);
  assert.ok(assistedProjection.x > assisted.receiver.x, 'neutral input should move the player toward the ball');

  const opposed = plan(true);
  const opposedProjection = opposed.frame.hostProjection.movement.find(row => row.id === opposed.receiver.id);
  assert.ok(opposedProjection.vx < assistedProjection.vx,
    'a strong opposite input must reduce/reverse the assisted movement instead of being overridden');
});

test('each CPU team chases a moving loose ball at its own interception point', () => {
  const snapshot = goalkeeperPossessionSnapshot();
  snapshot.humanPlayerIds = [];
  snapshot.contact.gate.keeperAuthority = false;
  snapshot.contact.intendedReceiverId = null;
  for (const [index, player] of snapshot.players.entries()) {
    if (player.isGK) continue;
    player.x = player.teamId === 'you' ? 7 + index * .08 : 98 - index * .08;
    player.y = player.teamId === 'you' ? -28 : 28;
  }
  const chasingFromBehind = snapshot.players.find(player => player.id === 'you-CAM');
  const meetingFromAhead = snapshot.players.find(player => player.id === 'opp-CAM');
  assert.ok(chasingFromBehind && meetingFromAhead);
  Object.assign(chasingFromBehind, { x: 44, y: 0 });
  Object.assign(meetingFromAhead, { x: 54, y: 0 });
  Object.assign(snapshot.ball, {
    x: 50, y: 0, z: 0, vx: 4 / 60, vy: 0, zv: 0,
    ownerId: null, targetId: null, lastKickerId: 'you-ST',
    flightType: 'ground-pass', launchIntent: null
  });

  const live = Adapter.createAttachment({
    enabled: true,
    capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT,
      workflow: 'cpu-v-cpu', online: false, onlineMarkers: {},
      controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] } }),
    seed: 173174,
    dependencies: { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Composer },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
  const frame = live.planTick(snapshot);
  assert.ok(frame, JSON.stringify(live.status()));
  const behind = frame.hostProjection.recoveryAssignments.find(row => row.playerId === chasingFromBehind.id);
  const ahead = frame.hostProjection.recoveryAssignments.find(row => row.playerId === meetingFromAhead.id);
  assert.ok(behind && ahead, JSON.stringify(frame.hostProjection.recoveryAssignments));
  assert.ok(behind.target.x > ahead.target.x + 1,
    `collectors shared a naive chase point: ${JSON.stringify(frame.hostProjection.recoveryAssignments)}`);
  for (const player of [chasingFromBehind, meetingFromAhead]) {
    const movement = frame.hostProjection.movement.find(row => row.id === player.id);
    assert.equal(movement.locomotionState, 'sprint', JSON.stringify(movement));
  }
});

test('goalkeeper possession resolves the owning team to buildup and the opponent to defend', () => {
  const live = Adapter.createAttachment({
    enabled: true,
    capability: Adapter.createCapability({
      acknowledgement: Adapter.ACKNOWLEDGEMENT,
      workflow: 'single-player',
      online: false,
      onlineMarkers: {}
    }),
    seed: 173173,
    dependencies: { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Composer },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
  const frame = live.planTick(goalkeeperPossessionSnapshot());
  assert.ok(frame, JSON.stringify(live.status()));
  assert.equal(frame.formation.you.phase, 'buildup');
  assert.equal(frame.formation.opp.phase, 'defend');
  assert.notEqual(frame.formation.you.phase, 'settled-attack');
});

test('every affected Build 173 launch path supplies the source lock used by live V2', () => {
  const pass = sourceBetween(matchSource, 'function doPassForHuman', 'function doPass(');
  assert.match(pass, /ball\.lastKicker=src;ball\.kickerLock=/);
  assert.match(pass, /src\.receiveT=Math\.max\(src\.receiveT\|\|0,/);

  const commonLaunch = sourceBetween(matchSource, 'function launchMatchBall', 'function playRestartBallToPoint');
  assert.match(commonLaunch, /ball\.lastKicker=source;ball\.kickerLock=opts\.kickerLock\|\|18/);

  const lob = sourceBetween(matchSource, 'function doLobPassFor', 'function doLobPass(');
  assert.match(lob, /launchMatchBall\(src,point,[\s\S]*kickerLock:/);
  assert.match(lob, /src\.receiveT=Math\.max\(src\.receiveT\|\|0,/);

  const restartLaunch = sourceBetween(matchSource, 'function playRestartBallToPoint', 'const PENALTY_KEEPER_DECISION_MS');
  assert.match(restartLaunch, /launchMatchBall\(taker,point,[\s\S]*kickerLock:20/);

  const cpuRestart = sourceBetween(matchSource, 'function aiRestartPass', 'function takeUserRestart');
  assert.match(cpuRestart, /kind==='THROW-IN'[\s\S]*standardThrowTrajectory\(legalDistance,50,18\)[\s\S]*playRestartBallToPoint\(taker,point,trajectory\.speed,trajectory\.loft,'throw-in',target,\{v2SpeedWorld:trajectory\.v2SpeedWorld,v2LoftWorld:trajectory\.v2LoftWorld\}\)/,
    'CPU throws must use the same distance-solved, source-locked launch seam as human throws');
  const humanRestart = sourceBetween(matchSource, 'function takeUserRestart', 'function keeperKick');
  assert.match(humanRestart, /kind==='THROW-IN'[\s\S]*maximumDistance=220\+300\*p[\s\S]*standardThrowTrajectory\(legalDistance,50,18\)[\s\S]*playRestartBallToPoint\(taker,point,trajectory\.speed,trajectory\.loft,'throw-in',target,\{v2SpeedWorld:trajectory\.v2SpeedWorld,v2LoftWorld:trajectory\.v2LoftWorld\}\)/);
});

test('manual passes nominate a chase-only receiver without changing the authored trajectory', () => {
  const pass = sourceBetween(matchSource, 'function doPassForHuman', 'function doPass(');
  assert.match(pass, /let chaseOnly=false/);
  assert.match(pass, /best=candidates\[0\]\.teammate;chaseOnly=true/);
  assert.match(pass, /mode:'chase-only',trajectoryChanged:false/);
  assert.ok(pass.indexOf("tx+=(-a.y)") < pass.indexOf('best=candidates[0].teammate'), 'manual trajectory must be final before chase assignment');
  assert.doesNotMatch(pass.slice(pass.indexOf('best=candidates[0].teammate')), /passDestination\(/,
    'chase-only assignment may not invoke assisted trajectory targeting');
});

test('the yellow match ball visibly rotates from travel and selected shot replays run slower', () => {
  assert.match(matchSource, /bg\.fillStyle='#e8e22a'/);
  assert.match(matchSource, /travel\/Math\.max\(\.01,BALL_VISUAL_R\)/);
  assert.match(matchSource, /rotateOnWorldAxis/);
  assert.match(matchSource, /SHOT_REPLAY_PACKAGE_SPEEDS=Object\.freeze\(\[\.4,\.4,\.2\]\)/);
});

test('throw-ins hold for visible movement, offer four routes and use aim plus charged Cross power', () => {
  const arrangement = sourceBetween(matchSource, "if(kind==='THROW-IN'){", "if(kind==='CORNER'){");
  assert.match(arrangement, /options=\[\{x:x\+dir\*145[\s\S]*x:x\+dir\*315[\s\S]*x:x\+dir\*70/);
  const restartSetup = sourceBetween(matchSource, 'function restart(kind', 'function enterFreeKickPractice');
  assert.match(restartSetup, /kind==='THROW-IN'\?3000/, 'thrower gets a full three-second option-creation window');
  const readiness = sourceBetween(matchSource, 'function setPieceReady', 'function restartCanBeTaken');
  assert.match(readiness, /restartMsg==='THROW-IN'\?\.72/, 'moving throw routes have a reachable assembly threshold');
  const hints = sourceBetween(matchSource, 'function updateDeadBallDisplay', 'function clearRestartState');
  assert.match(hints, /THROW-IN'.*LS<\/b> rotate and choose[\s\S]*hold\/release Cross \/ A<\/b> for throw power/);
  const humanRestart = sourceBetween(matchSource, 'function takeUserRestart', 'function keeperKick');
  assert.match(humanRestart, /const kind=restartMsg,taker=restartTaker,p=clamp\(power,0,1\),aim=setPieceAimPoint\(\)/);
  assert.match(humanRestart, /maximumDistance=220\+300\*p/);
  assert.match(humanRestart, /legalDistance=clamp\(rawDistance,70,maximumDistance\)/);
  assert.match(humanRestart, /nearestPlayerToPoint\(taker\.team,point,q=>q!==taker\)/);
  assert.match(humanRestart, /authority:'distance-solved-throw'/);
});

test('Triangle charges on press and tap versus hold produces monotonic through-ball power on release', () => {
  const down = sourceBetween(matchSource, 'function controllerThroughDown', 'function controllerThroughUp');
  const up = sourceBetween(matchSource, 'function controllerThroughUp', 'function controllerTackleTap');
  assert.match(down, /state\.throughCharging=true/);
  assert.match(down, /state\.throughChargeStartedAt=performance\.now\(\)/);
  assert.doesNotMatch(down, /doThroughPassFor\(/, 'press must arm, not launch');
  assert.match(up, /doThroughPassFor\(src,isSecond,overTop,power,flair,null,null,null,null,null,driven\)/,
    'Triangle release preserves ordinary power while forwarding the separately latched R1 technique flag');

  const calibration = up.match(/power=clamp\(heldMs\/TRIANGLE_CHARGE_DURATION_MS,(\.\d+),(\d+)\)/);
  assert.ok(calibration, 'through release must expose a bounded hold-duration calibration');
  const duration = matchSource.match(/const TRIANGLE_CHARGE_DURATION_MS=(\d+)/);
  assert.ok(duration, 'the protected Triangle charge duration must remain explicit');
  const [, floorText, capText] = calibration;
  const divisorText = duration[1];
  const divisor = Number(divisorText), floor = Number(floorText), cap = Number(capText);
  const powerAt = heldMs => Math.max(floor, Math.min(cap, heldMs / divisor));
  assert.equal(powerAt(0), floor);
  assert.equal(powerAt(50), floor, 'a very short tap remains a small through ball');
  assert.ok(powerAt(divisor / 2) > powerAt(50));
  assert.equal(powerAt(divisor), cap);
  assert.equal(powerAt(divisor * 2), cap);

  const launch = sourceBetween(matchSource, 'function doThroughPassFor', 'function doLobPassFor');
  assert.match(launch, /const p=clamp\(Number\.isFinite\(power\)\?power:\.58,\.10,1\)/);
  assert.match(launch, /overTop\?190\+p\*270:105\+p\*185/);
  assert.match(launch, /7\.2\+distance\*\.0045\+p\*2\.0/);
  assert.match(launch, /lowPowerAim=clamp\(\(\.55-p\)\/\.45,0,1\)/,
    'a lightly powered through ball must weight the requested stick lane more strongly');
  assert.match(launch, /aimLane\*lowPowerAim\*\.42/);
});

test('R1 plus Square maps to a distinct low-cross launch for either local controller', () => {
  const primary = sourceBetween(matchSource, 'function controllerLobDown', 'function controllerThroughDown');
  assert.match(primary, /currentButtons\[5\]\?'low-cross':'normal'/);
  assert.match(primary, /lobMode==='low-cross'\?'low-cross':'lob-pass'/);

  const secondary = sourceBetween(matchSource, 'function controller2LobDown', 'function controller2TackleTap');
  assert.match(secondary, /currentButtons\[5\]\?'low-cross':'normal'/);
  assert.match(secondary, /lobMode==='low-cross'\?'low-cross':'lob-pass'/);

  const primaryRelease = sourceBetween(matchSource, 'function gamepadButtonUp', 'function controller2PassDown');
  assert.match(primaryRelease, /action==='low-cross'\)controllerLobUp\(\)/);
  const secondaryRelease = sourceBetween(matchSource, 'function gamepad2ButtonUp', 'function resetPadRuntime');
  assert.match(secondaryRelease, /action==='low-cross'\)controller2LobUp\(\)/);

  const lob = sourceBetween(matchSource, 'function doLobPassFor', 'function doLobPass(');
  assert.match(lob, /lowCross=mode==='low-cross'/);
  assert.match(lob, /flightType=lowCross\?'low-cross'/);
  assert.match(lob, /\['cross','driven-cross','low-cross'\]\.includes\(flightType\)/);
  const trajectory = sourceBetween(matchSource, 'function standardCrossTrajectory', 'function flairPassExecution');
  assert.match(trajectory, /mode==='low-cross'\?13/);
});

test('the playtest textarea is an editable target and both global keyboard edges exit before game input', () => {
  const editable = matchSource.match(/function editableInputTarget\(target\)\{[^}]+\}/)?.[0];
  assert.ok(editable, 'editable-target guard must remain present');
  const context = vm.createContext({ result: null });
  vm.runInContext(`${editable};this.editableInputTarget=editableInputTarget;`, context);
  const textarea = { matches: selector => selector.includes('textarea'), isContentEditable: false };
  const input = { matches: selector => selector.includes('input'), isContentEditable: false };
  const richText = { matches: () => false, isContentEditable: true };
  const canvas = { matches: () => false, isContentEditable: false };
  assert.equal(context.editableInputTarget(textarea), true);
  assert.equal(context.editableInputTarget(input), true);
  assert.equal(context.editableInputTarget(richText), true);
  assert.equal(context.editableInputTarget(canvas), false);

  const keydown = sourceBetween(matchSource, "addEventListener('keydown'", "addEventListener('keyup'");
  const keyup = sourceBetween(matchSource, "addEventListener('keyup'", 'const playtestToolsOverlay');
  assert.match(keydown, /^addEventListener\('keydown',e=>\{if\(editableInputTarget\(e\.target\)\)return;/);
  assert.match(keyup, /^addEventListener\('keyup',e=>\{if\(editableInputTarget\(e\.target\)\)return;/);
  assert.ok(keydown.indexOf('editableInputTarget(e.target)') < keydown.indexOf('initAudio(true)'), 'keydown guard precedes side effects');
  assert.ok(keyup.indexOf('editableInputTarget(e.target)') < keyup.indexOf('keys[k]=false'), 'keyup guard precedes held-key mutation');
  assert.match(matchSource, /<textarea id="playtestNoteInput"/);
});
