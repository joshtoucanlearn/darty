import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { keeperShotRows } from '../tools/keeper-timing-evidence.mjs';

const html=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const section=(start,end)=>{const a=html.indexOf(start),b=html.indexOf(end,a);assert.ok(a>=0&&b>a,start);return html.slice(a,b);};
function fixture({height=12,lateral=90,pace=10,rating=80}={}){
  return new Function(`
    const W=3344,H=2142,M=84,rad=12.75,GOAL_H=230;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const Math=Object.create(globalThis.Math);Math.random=()=>.5;
    let clockFrames=100,ball={x:2300,y:H/2+${lateral},z:${height},vx:${pace},vy:0,zv:0,
      owner:null,isShot:true,shotType:'normal',keeperShotId:1,shooter:{id:'attacker',team:'you'}};
    const gk={id:'keeper',team:'opp',isGK:true,x:3244,y:H/2,vx:0,vy:0,attrs:{keeper:${rating}},
      action:'idle',actionT:0,diveT:0,diveCooldown:0},controlled=null,twoPlayerEnabled=false,AUTO=true;
    const events=[],logEvent=(type,team,gk,extra)=>events.push({type,frame:clockFrames,action:gk.action,actionT:gk.actionT,...extra});
    const goalkeeperPositioningContract=()=>({state:'angle-set',prepared:true,targetX:3244,targetY:H/2,depth:16,threatX:ball.x,threatY:ball.y});
    const goalkeeperLooseBallContext=()=>null,goalkeeperOneVOneContext=()=>null,moveGoalkeeperWithBall=()=>{},
      secondTeamHasHuman=()=>false,showEvent=()=>{},keeperKick=()=>keeperKicks++;
    let kickoffHeld=false,restartMsg='',restartTaker=null,penaltyCalls=0,keeperKicks=0;
    const updatePenaltyKeeperDecision=()=>penaltyCalls++;
    ${section('function keeperIncomingShotFrames','// D2')}
    ${section('function keeperSaveAnimation','function moveGoalkeeperWithBall')}
    ${section('function updateGoalkeeper','function penaltyKeeperChoiceCoversBall')}
    function tick(move=true){updateGoalkeeper(gk);gk.x+=gk.vx;gk.y+=gk.vy;if(gk.actionT>0){gk.actionT--;if(!gk.actionT)gk.action='idle';}if(move)ball.x+=ball.vx;clockFrames++;}
    return {gk,ball,events,tick,update:()=>updateGoalkeeper(gk),timing:keeperShotAnimationTiming,
      contact:(animation='low-scoop')=>presentKeeperShotContact(gk,animation,30),
      newShot:id=>{ball.keeperShotId=id;ball.owner=null;ball.isShot=true;ball.x=2300;},
      penaltyCalls:()=>penaltyCalls,keeperKicks:()=>keeperKicks};
  `)();
}

test('early reads show a bounded set step and no save animation',()=>{
  const game=fixture();game.tick();
  assert.equal(game.events.filter(e=>e.type==='keeper-read').length,1);
  assert.equal(game.events.filter(e=>e.type==='keeper-dive-start').length,0);
  assert.equal(game.gk.action,'idle');assert.equal(game.gk.keeperPose,'ready');
  assert.equal(game.gk.diveT,0);assert.ok(Math.abs(game.gk.vy)<=.72);
});

test('compact and extended actions start at their renderer contact lead, on both sides',()=>{
  for(const context of [{height:12,lateral:0,pace:20},{height:12,lateral:0,pace:10},{height:38,lateral:0,pace:10},{height:44,lateral:0,pace:20},{height:44,lateral:50,pace:10},
    {height:12,lateral:90,pace:10},{height:44,lateral:90,pace:10},{height:74,lateral:90,pace:10}]){
    for(const team of ['you','opp']){
      const game=fixture(context);
      if(team==='you'){game.gk.team='you';game.gk.x=100;game.ball.x=1144;game.ball.vx=-context.pace;game.ball.shooter.team='opp';}
      let arrival=null;
      for(let i=0;i<160;i++){const before=game.ball.x;game.tick();if(team==='opp'?before<=game.gk.x&&game.ball.x>=game.gk.x:before>=game.gk.x&&game.ball.x<=game.gk.x){arrival=game.events[0].frame+i+1;break;}}
      const starts=game.events.filter(e=>e.type==='keeper-dive-start');
      assert.equal(starts.length,1);assert.ok(starts[0].timeToArrival>0&&starts[0].timeToArrival<=starts[0].contactFrames+1);
      assert.ok(starts[0].contactFrames>=12&&starts[0].contactFrames<=26);
      assert.ok(arrival!=null);assert.ok(Math.abs((arrival-starts[0].frame)-starts[0].contactFrames)<=4);
    }
  }
});

test('extension holds on a delayed flight without replaying or rereading the action',()=>{
  const game=fixture();while(!game.gk.keeperShotPlan?.started)game.tick();
  const plan=game.gk.keeperShotPlan;game.ball.vx=1;
  for(let i=0;i<80;i++)game.tick(false);
  assert.equal(plan.elapsed,plan.timing.contactFrames);
  assert.equal(game.gk.keeperAnimationDuration-game.gk.actionT,plan.timing.contactFrames);
  assert.equal(game.events.filter(e=>e.type==='keeper-dive-start').length,1);
  assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,0);
  assert.notEqual(game.gk.action,'keeperRecover');
});

test('contact and rebound do not restart the current clip; recovery cannot reread the same shot',()=>{
  const game=fixture();while(!game.gk.keeperShotPlan?.started)game.tick();
  const plan=game.gk.keeperShotPlan,action=game.gk.action;
  game.contact();const atContact=game.gk.actionT;game.contact('body-catch');
  assert.equal(game.gk.action,action);assert.equal(game.gk.actionT,atContact);
  game.ball.isShot=false;
  while(!plan.finished)game.tick(false);
  game.ball.isShot=true;game.ball.x=game.gk.x-100;
  for(let i=0;i<60;i++)game.tick(false);
  game.contact('hand-jab');
  assert.equal(game.events.filter(e=>e.type==='keeper-read').length,1);
  assert.equal(game.events.filter(e=>e.type==='keeper-dive-start').length,1);
  game.newShot(2);game.tick();assert.equal(game.events.filter(e=>e.type==='keeper-read').length,2);
});

test('one late correction is permitted only before launch',()=>{
  const game=fixture();game.tick();game.ball.vy=2;game.tick();game.ball.vy=-2;game.tick();
  assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,1);
  while(!game.gk.keeperShotPlan.started)game.tick();game.ball.vy=8;game.tick();
  assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,1);
});

test('ordinary smooth curvature and rising height do not improve the original read',()=>{
  for(const team of ['you','opp']){
    const game=fixture();
    if(team==='you'){game.gk.team='you';game.gk.x=100;game.ball.x=1044;game.ball.vx=-10;game.ball.vy=-.2;game.ball.shooter.team='opp';}
    game.tick();
    for(let i=0;i<24;i++){game.ball.vy+=.08;game.ball.z+=2;game.tick();}
    assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,0);
  }
});

test('a material late dip can change the set once before launch',()=>{
  const game=fixture({height:50});game.tick();game.ball.dip=.8;game.ball.zv=-1;game.ball.z=25;game.tick();
  assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,1);
  game.ball.zv=-3;game.tick();assert.equal(game.events.filter(e=>e.type==='keeper-reread').length,1);
});

test('a distinct rebound shot cannot start a second action while follow-through is playing',()=>{
  const game=fixture();while(!game.gk.keeperShotPlan?.started)game.tick();
  game.contact();game.newShot(2);game.tick();game.contact('hand-jab');
  assert.equal(game.events.filter(e=>e.type==='keeper-dive-start').length,1);
});

test('an existing ground or save action is adopted at contact without a second launch',()=>{
  const game=fixture();game.gk.action='keeperLowDive';game.gk.actionT=20;game.gk.keeperAnimationDuration=30;
  game.contact();assert.equal(game.gk.actionT,20);game.tick(false);
  assert.equal(game.gk.action,'keeperLowDive');assert.equal(game.events.filter(e=>e.type==='keeper-dive-start').length,0);
});

test('catch follow-through preserves the original possession clock and release deadline',()=>{
  const game=fixture();while(!game.gk.keeperShotPlan?.started)game.tick();game.contact();
  game.ball.owner=game.gk;game.ball.isShot=false;game.gk.hold=0;game.gk.holdReleaseAt=0;game.tick(false);
  assert.equal(game.gk.hold,1);assert.equal(game.gk.holdReleaseAt,97);assert.equal(game.gk.action,'keeperLowDive');
  game.gk.hold=299;game.gk.holdReleaseAt=2000;game.tick(false);assert.equal(game.keeperKicks(),1);
});

test('an accepted distribution clears the save plan before presenting the release action',()=>{
  const release=section('function keeperKick','const HUMAN_PASS_ASSISTANCE');
  assert.match(release,/if\(!ok\)return telemetry\(false,'launch-rejected',[\s\S]*gk\.keeperShotPlan=null;gk\.diveT=0;[\s\S]*gk\.action=rolling\?/);
});

test('the penalty decision window bypasses open-play scheduling',()=>{
  const game=fixture();game.ball.shotType='penalty';game.gk.penaltyCommit={choice:null};game.tick();
  assert.equal(game.penaltyCalls(),1);assert.equal(game.events.length,0);
});

test('replay capture and playback retain the keeper duration and set pose',()=>{
  assert.match(section('function captureReplaySnapshot','function replayActorRouteSnapshot'),/keeperAnimationDuration:p\.keeperAnimationDuration/);
  assert.match(section('const INSTANT_REPLAY_REVIEW_PLAYER_FIELDS','function refreshInstantReplayReviewUI'),/'keeperAnimationDuration'/);
  assert.match(section('function applyReplaySnapshots','function beginGoalCelebration'),/keeperAnimationDuration/);
});

test('the timing lane preserves the baseline contact save probability function byte for byte',()=>{
  const model=section('function keeperContactSaveModel','function goalkeeperOneVOneContext');
  assert.equal(createHash('sha256').update(model).digest('hex'),'71537b71efbda4c91260aff0d50543e65057dbe285407d3045578b7cba682a42');
});

test('timing evidence counts original contact restarts and excludes a continuous contact pose',()=>{
  const shot={type:'shot',shotId:1,team:'you',frame:0},read={type:'keeper-read',shotId:1,team:'opp',playerId:'keeper',frame:10,timeToGoal:50,animation:'low-dive'};
  const before=keeperShotRows([shot,{...read,action:'keeperLowDive'},
    {type:'keeper-save',shotId:1,team:'opp',playerId:'keeper',frame:70,action:'keeperLowScoop',actionT:30,duration:30}])[0];
  const after=keeperShotRows([shot,{...read,action:'idle'},
    {type:'keeper-dive-start',shotId:1,team:'opp',playerId:'keeper',frame:50,action:'keeperLowDive',timeToArrival:19,animation:'low-dive'},
    {type:'keeper-save',shotId:1,team:'opp',playerId:'keeper',frame:70,action:'keeperLowDive',actionT:29,duration:48}])[0];
  assert.equal(before.repeats,1);assert.equal(before.leadSeconds,1);
  assert.equal(after.repeats,0);assert.equal(after.leadSeconds,1/3);
});
