import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');

function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return html.slice(from, to);
}

test('inline match scripts remain syntactically valid', () => {
  for (const [index, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]), `inline script ${index} must parse`);
  }
});

test('open-play shot logging persists the latest launch anchor and goal replay crops around it', () => {
  const logging = section('function logEvent', 'function forcePlaytestPersistence');
  const replay = section('function markOpenPlayShotReplayAnchor', 'function captureRestartFootballerState');
  const goal = section('function startGoalReplay', 'function updateGoalReplay');
  const scoring = section('function score(who)', '// ===================== 3D SCENE');
  assert.match(logging, /type==='shot'\?markOpenPlayShotReplayAnchor/);
  assert.match(replay, /latestOpenPlayShotReplayAnchor=anchor/);
  assert.match(goal, /frame\.t>=goalReplay\.anchorAt-900/);
  assert.match(goal, /createShotReplayPackage\(kind,frames,\{anchorAt:kind==='goal-replay'\?goalReplay\.anchorAt:0\}\)/);
  assert.match(scoring, /latestOpenPlayShotReplayAnchor\.team===who/);
  assert.match(scoring, /goalReplay\.anchorAt=scoringAnchor&&scoringAnchor\.at/);
});

test('ordinary foul cameras replay contact in their first two angles and can seek backwards', () => {
  assert.match(html, /'ordinary-foul-replay':\{durationMs:6200[\s\S]*anchorWindowsMs:\[\[-900,360\],\[-650,520\]/);
  assert.match(html, /'carded-foul-replay':\{durationMs:7000/);
  assert.match(html, /'red-card-replay':\{durationMs:7600/);
  const seek = section('function replayAnchoredSourceTime', 'const replaySkipLabel');
  assert.match(seek, /replayBeatFor\(kind,progress\)/);
  assert.match(seek, /anchorAt\+window\[0\]/);
  assert.match(seek, /while\(next>0&&frames\[next\]\.t>sourceT\)next--/);
  assert.match(seek, /while\(next<frames\.length-2&&frames\[next\+1\]\.t<sourceT\)next\+\+/);
  assert.match(html, /contactAt:now,replayAnchorAt:now,replayEventAt:now/);
});

test('missed-shot and save-to-corner replay only after stoppage and remain launch anchored', () => {
  const outcome = section('function shotOutcomeReplayStoppageConfirmed', 'function startPracticeFreeKickReplay');
  assert.match(outcome, /kind!=='save-to-corner'/);
  assert.match(outcome, /save-remained-in-live-play/);
  assert.match(outcome, /candidate\.at-900/);
  assert.match(outcome, /replayAnchorAt:candidate&&candidate\.at/);
  assert.match(outcome, /SHOT WIDE · GOAL KICK REPLAY/);
});

test('keeper release targets have useful depth and loose-ball races are ETA gated', () => {
  const release = section('function goalkeeperReleaseTarget', 'function sameSidePositionPartner');
  const loose = section('function goalkeeperLooseBallContext', 'function resolveKeeperOneVOne');
  assert.match(release, /dir\*500/);
  assert.match(release, /side\*H\*\.20/);
  assert.match(release, /dir\*585/);
  assert.match(release, /dir\*760/);
  assert.match(loose, /keeperEta\+1\.5<defenderEta&&keeperEta\+1\.0<opponentEta/);
  assert.match(loose, /state\.isShot\|\|crossFlight\|\|restartActive/);
  assert.match(loose, /keeper-loose-ball-claim/);
  assert.match(loose, /difficultyPhysicalBonus:false/);
});

test('a goalkeeper cannot reclaim their own distribution before another player touches it', () => {
  const contextSource = section('function goalkeeperLooseBallContext', 'function resolveGoalkeeperLooseBall');
  const runtime = new Function(`
    const M=84,W=3344,H=2142,BOX_D=499,BOX_H=1270,kickoffHeld=false,ball=null,lastTouch=null,lastTouchPlayer=null;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),teamList=()=>[],other=team=>team==='you'?'opp':'you';
    ${contextSource}
    return { context: goalkeeperLooseBallContext };
  `)();
  const gk={id:'keeper',team:'you',x:146,y:1071,attrs:{keeper:84}};
  const opponent={id:'opponent',team:'opp',x:434,y:1071};
  const shooter={id:'shooter',team:'opp',x:544,y:1071};
  const released={owner:null,isShot:false,x:264,y:1071,z:0,vx:2.1,vy:0,flightType:'keeper-pass',lastKicker:gk};
  const common={ballState:released,restartActive:false,defenders:[],opponents:[]};
  assert.equal(runtime.context(gk,{...common,lastTouchTeam:'you',lastTouchPlayer:gk}),null, 'immediate own release must not be reclaimed');
  released.x=329;
  assert.equal(runtime.context(gk,{...common,lastTouchTeam:'you',lastTouchPlayer:gk}),null, 'the same release must stay ineligible after travelling');
  assert.ok(runtime.context(gk,{...common,lastTouchTeam:'opp',lastTouchPlayer:opponent}), 'an opponent touch must restore keeper eligibility');
  const parry={...released,flightType:'shot-parry',lastKicker:shooter};
  assert.ok(runtime.context(gk,{...common,ballState:parry,lastTouchTeam:'you',lastTouchPlayer:gk}), 'the keeper may recover their own parry');
});

test('V2 playtest telemetry remains cumulative across dead-ball authority epochs', () => {
  const authority = section('const LIVE_V2_PREFLIGHT', 'function liveV2QueueLaunch');
  const boundary = section('function liveV2ObserveBoundary', 'function liveV2Clone');
  assert.match(authority, /liveV2AuthorityTotals=\{candidateTicks:0,lastCommittedTick:0,gameplayEpochs:0\}/);
  assert.match(authority, /lastCommittedTick:Number\(liveV2AuthorityTotals\.lastCommittedTick\)/);
  assert.match(authority, /currentEpochTick:Number\(liveV2Tick\)/);
  assert.match(authority, /liveV2AuthorityTotals\.candidateTicks\+=Number\(liveV2AuthorityCounters\.candidateTicks\)/);
  assert.match(authority, /liveV2AuthorityTotals\.lastCommittedTick\+\+/);
  assert.match(boundary, /liveV2Tick=0/);
  assert.doesNotMatch(boundary, /liveV2AuthorityTotals\s*=/, 'dead-ball handoff must not erase cumulative playtest evidence');
  assert.match(html, /let liveV2GameplayWorkflow=LIVE_V2_PREFLIGHT\.workflow/);
  assert.match(html, /liveV2Badge\(liveV2GameplayWorkflow==='cpu-v-cpu'\?'V2 · CPU':'V2 · SP'\)/);
  assert.match(html, /LIVE_V2_PREFLIGHT\.workflow==='set-piece-suite'\?'V2 · SET PIECE':liveV2GameplayWorkflow==='cpu-v-cpu'\?'V2 · CPU':'V2 · SP'/);
});

test('pausing freezes goal presentation time and keeps the four-second broadcast hold', () => {
  const pause = section('let pauseStartedAt=0', 'function exitToMatchSetup');
  const scoring = section('function score(who)', '// ===================== 3D SCENE');
  const camera = section('function camFollow', 'const COL=');
  assert.match(pause, /function shiftPausedPresentationTimers\(deltaMs\)/);
  assert.match(pause, /celebrationStartedAt=shift\(celebrationStartedAt\)/);
  assert.match(pause, /goalReplay\.startedAt=shift\(goalReplay\.startedAt\)/);
  assert.match(pause, /disciplineReplay\.startedAt=shift\(disciplineReplay\.startedAt\)/);
  assert.match(pause, /goalBroadcastHoldUntil=shift\(goalBroadcastHoldUntil\)/);
  assert.match(pause, /shiftPausedPresentationTimers\(now-pauseStartedAt\)/);
  assert.match(scoring, /goalBroadcastHoldUntil=goalMoment\+\(FAST\?120:4000\)/);
  assert.match(camera, /celebrate>0&&goalBroadcastHoldTarget&&now<goalBroadcastHoldUntil/);
  assert.ok(camera.indexOf('goalBroadcastHoldTarget&&now<goalBroadcastHoldUntil') < camera.indexOf('goalReplay.active'), 'broadcast hold must precede replay/director cameras');
});

test('keeper carrying is an isolated floor and readable visual steps do not change world speed', () => {
  const locomotion = section('function ratedLocomotionSpeed', 'function applyLocomotionInput');
  const keeperCarry = section('function moveGoalkeeperWithBall', 'function updateGoalkeeper');
  const drawMovement = section("else if(spd>.14)", 'else{\n      const motion=u.motion');
  assert.match(locomotion, /carrying&&p\.isGK\?Math\.max\(1\.06,baseRatingScale\)/);
  assert.match(locomotion, /p\.isGK\?1:sprint\?\.90:\.96/);
  assert.match(keeperCarry, /pressure<250\?3\.90:3\.45/);
  assert.match(drawMovement, /const gaitCadenceScale=1\.2/);
  assert.match(drawMovement, /moved\*\(sprinting\?\.142:\.098\)\*gaitCadenceScale/);
  assert.match(drawMovement, /sprinting\?\.36:\.252/);
  assert.match(html, /gaitCadenceScale:1\.2,visualStepDistanceRatio:\.8333,worldSpeedScale:1/);
  assert.match(html, /readable football gait cadence is presentation-only and does not reduce world locomotion speed/);
  assert.doesNotMatch(drawMovement, /(?:p\.x|p\.y|p\.vx|p\.vy)\s*[*/+-]?=/, 'presentation phase must not change world locomotion state');
});

test('minute-37 slow loose ball selects and claims with the safe goal-side centre-back by ETA', () => {
  const contextSource = section('function outfieldLooseBallRecoveryContext', 'function resolveOutfieldLooseBallRecovery');
  const resolveSource = section('function resolveOutfieldLooseBallRecovery', 'function updateTeamAI');
  const runtime = new Function(`
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const M=84,W=3344,H=2142,rad=12.75,BALLR=5.55,clockFrames=100,AUTO=true,twoPlayerEnabled=false,controlled=null,controlledOpp=null;
    const D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),positionFamily=p=>p.family,fatigueQuality=()=>1,teamList=()=>[];
    const goalkeeperLooseBallContext=(gk)=>gk&&gk.winsEta?{active:true,keeperEta:3.1}:null;
    let kickoffHeld=false,lastTouch='opp',lastTouchPlayer=null,poss=0;
    const events=[],logEvent=(type,team,p,extra)=>events.push({type,team,playerId:p&&p.id,...extra}),steer=(p,tx,ty,maxSp)=>{const dx=tx-p.x,dy=ty-p.y,d=Math.hypot(dx,dy)||1;p.vx=dx/d*maxSp;p.vy=dy/d*maxSp;};
    let ball=null;
    ${contextSource}
    ${resolveSource}
    return { context: outfieldLooseBallRecoveryContext, resolve: resolveOutfieldLooseBallRecovery, setBall:value=>ball=value, events };
  `)();
  const centreBack={id:'cb',team:'you',family:'centre-back',x:1090,y:1080,vx:0,vy:0,stamina:100,attrs:{pace:78},stats:{touches:0}},
    fullBack={id:'fb',team:'you',family:'full-back',x:875,y:900,vx:0,vy:0,stamina:100,attrs:{pace:90},stats:{touches:0}},
    opponent={id:'opp',team:'opp',family:'striker',x:1470,y:1085,attrs:{pace:80}},
    state={owner:null,target:null,isShot:false,x:1210,y:1070,z:0,vx:-1.05,vy:.08,flightType:'ground',lastKicker:null,kickerLock:0};
  runtime.setBall(state);
  const options={ballState:state,restartActive:false,defenders:[centreBack,fullBack],opponents:[opponent],goalkeeper:{id:'gk',winsEta:false},lastTouchTeam:'opp',lastTouchPlayer:opponent,excludedPlayerIds:[]};
  const start = runtime.context('you', options);
  assert.equal(start.active, true);
  assert.equal(start.winnerId, 'cb');
  assert.equal(start.winnerFamily, 'centre-back');
  assert.equal(start.goalSide, true);
  assert.ok(start.winnerEta < start.opponentEta);
  let frames = 0, current = start;
  while (!state.owner && frames < 120) {
    runtime.resolve(centreBack, current, [centreBack, fullBack]);
    centreBack.x += centreBack.vx; centreBack.y += centreBack.vy;
    state.x += state.vx; state.y += state.vy; state.vx *= .977; state.vy *= .977;
    frames++;
    if (!state.owner) current = runtime.context('you', options);
  }
  assert.equal(state.owner, centreBack);
  assert.ok(frames > 0 && frames < 120);
  assert.equal(runtime.events.at(-1).type, 'outfield-loose-ball-claim');
  assert.equal(runtime.events.at(-1).difficultyPhysicalBonus, false);

  state.owner=null;state.x=1210;state.y=1070;state.vx=-1.05;state.vy=.08;
  const keeperFirst = runtime.context('you', {...options, goalkeeper:{id:'gk',winsEta:true}});
  assert.equal(keeperFirst.active, false);
  assert.equal(keeperFirst.reason, 'goalkeeper-wins-loose-ball-eta');
});

test('human open-play and direct-free-kick power is bounded in metres per second with arrival telemetry', () => {
  const scale = section('function worldDistanceMetres', 'function worldX');
  const freeKick = section('function freeKickPhysicsPlan', 'function freeKickRouteAnalysis');
  const shooting = section('function doShootForHuman', 'function doShoot(power');
  assert.match(scale, /humanOpenPlayShotPaceMetresPerSecond/);
  assert.match(scale, /directFreeKickPaceMetresPerSecond/);
  assert.match(scale, /return clamp\(22\+p\*8\.4\+s\*2\.1,25,33\)/);
  assert.match(scale, /return clamp\(24\.5\+p\*7\.8\+s\*1\.7,27,34\)/);
  assert.match(freeKick, /paceMps=directFreeKickPaceMetresPerSecond/);
  assert.match(freeKick, /actualPaceMps/);
  assert.match(freeKick, /arrivalMs/);
  assert.match(shooting, /calibratedPaceMps=humanOpenPlayShotPaceMetresPerSecond/);
  assert.match(shooting, /shotLaunchPaceMps=calibratedPaceMps/);
  assert.match(shooting, /paceMps:\+calibratedPaceMps\.toFixed\(2\),arrivalMs/);

  const calibration = new Function(`const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)); ${scale}; return {open:humanOpenPlayShotPaceMetresPerSecond,fk:directFreeKickPaceMetresPerSecond};`)();
  const openRows=['finesse','normal','lowDriven'].flatMap(type=>[.24,.62,1].map(power=>calibration.open(power,.84,type)));
  const fkRows=['dipping','curved','driven'].flatMap(type=>[.2,.6,1].map(power=>calibration.fk(power,.84,type)));
  assert.ok(Math.min(...openRows)>=22.5 && Math.max(...openRows)<=34);
  assert.ok(Math.min(...fkRows)>=22.5 && Math.max(...fkRows)<=34);
  assert.ok(calibration.open(.24,.84,'normal') < calibration.open(1,.84,'normal'));
  assert.ok(calibration.fk(.2,.84,'driven') < calibration.fk(1,.84,'driven'));
  assert.ok(18/calibration.open(.62,.84,'normal')*1000 >= 500);
  assert.ok(32/calibration.fk(.78,.84,'dipping')*1000 <= 1500);
});

console.log('playtest replay, goalkeeper and gait-cadence regressions: PASS');
