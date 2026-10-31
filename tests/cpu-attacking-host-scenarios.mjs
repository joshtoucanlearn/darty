import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';

const geometry=`
 const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
 const place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
 for(const [i,p] of you.entries())place(p,45,-28+i*3);
 for(const [i,p] of opp.entries())place(p,70,-28+i*3);
 place(ykeep,2,0);place(okeep,103,0);
`;

test('CPU fake shots invoke the unchanged human action and skill utility: a bite and a composed read',()=>{
 for(const roll of [0,.99]){
  const h=attackingHost(91);
  const result=h.scenario(`(()=>{${liveScene}${geometry}
   const actor=you.find(p=>p.role==='fwd'),defender=opp.find(p=>!p.isGK);
   place(actor,91,0);place(defender,93,0);place(okeep,104,12);defender.lunge=10;
   Object.assign(ball,{owner:actor,target:null,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,isShot:false,lastKicker:null,kickerLock:0});
   const frame=liveV2Authority.planTick(liveV2Snapshot(1));
   const chosen=frame.cpu.you.carrierIntent;
   const random=Math.random;Math.random=()=>${roll};
   try{if(!liveV2Authority.commitTick(frame))throw new Error('fixture commit failed');}finally{Math.random=random;}
   return {chosen:chosen.skill,action:actor.skillType,utility:actor.skillUtilityWindow&&{type:actor.skillUtilityWindow.type,success:actor.skillUtilityWindow.success},
    modifier:skillTackleModifier(actor,defender),stun:defender.stun||0};
  })()`);
  assert.equal(result.chosen,'fake-shot',JSON.stringify(result));
  assert.equal(result.action,'fakeShot');assert.equal(result.utility.type,'fakeShot');
  assert.equal(result.utility.success,roll===0);
  assert.equal(result.modifier,roll===0?.52:1);
  assert.equal(h.state().attack.counts.fakeShots,1,'one shared human skill event, with no parallel fake event');
  console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:roll===0?'fake-bite':'fake-read',fakeShots:h.state().attack.counts.fakeShots,utilitySuccess:result.utility.success,modifier:result.modifier}));
 }
});

test('the real keeper executor releases a checked exit and gameplay resumes instead of resetting its hold forever',()=>{
 const h=attackingHost(98);
 const release=h.scenario(`(()=>{${liveScene}${geometry}
  const gk=ykeep;place(gk,5,0);Object.assign(ball,{owner:gk,x:gk.x,y:gk.y,z:30,vx:0,vy:0,zv:0});
  const taken=keeperKick(gk,'auto');return {taken,released:ball.owner!==gk,pending:!!liveV2PendingLaunch};
 })()`);
 assert.equal(release.taken,true);assert.equal(release.released,true);assert.equal(release.pending,true);
 for(let i=0;i<30;i++)h.step();
 assert.equal(h.state().authority.failureCode,null);assert.ok(h.state().authority.candidateTicks>0);
});

test('a checked keeper short release reaches a teammate and cannot be recaught by its own source',()=>{
 const h=attackingHost(99);
 const release=h.scenario(`(()=>{${liveScene}${geometry}
  const gk=ykeep,receiver=you[0];place(gk,5,0);place(receiver,14,12);
  Object.assign(ball,{owner:gk,x:gk.x,y:gk.y,z:30,vx:0,vy:0,zv:0,lastKicker:null});
  const taken=keeperKick(gk,'auto');return {taken,pass:report.events.filter(e=>e.type==='v2-pass-decision').at(-1)?.reason};
 })()`);
 assert.equal(release.taken,true);assert.equal(release.pass,'keeper-free-short-exit');
 for(let i=0;i<180&&!h.state().actions.passDiagnostics.some(p=>p.reason==='keeper-free-short-exit');i++){
  h.step();
  assert.equal(h.scenario("ball.flightType==='ground-pass'&&(liveV2Authority.status().latestTelemetry?.recoveryAssignments||[]).some(p=>p.authority==='v2-high-ball-contest')"),false,
    'a ground exit from hand height must retain its foot reception route');
 }
 const result=h.state().actions.passDiagnostics.find(p=>p.reason==='keeper-free-short-exit');
 assert.equal(h.state().authority.failureCode,null);assert.ok(result,JSON.stringify(h.state().ball));
 assert.equal(result.completed,true,JSON.stringify(result));
});

test('an accepted feet pass keeps the real receiver position and does not manufacture offside from stale run timing',()=>{
 const h=attackingHost(100);
 const result=h.scenario(`(()=>{${liveScene}${geometry}
  const actor=you[5],receiver=you[6];place(actor,75,0);place(receiver,70,8);
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0});
  const before={x:receiver.x,y:receiver.y};
  liveV2ApplyIntelligence({intelligence:[{type:'pass',playerId:actor.id,targetPlayerId:receiver.id,target:before,
   reason:'checked-feet-fixture',supportKind:'support',passRace:{launchSpeedMetresPerSecond:17,launchLiftAngleDeg:0,ballArrivalTick:40},
   offsideTiming:{attacksBeyondLine:true,mistimedEarly:true,timingOffsetTicks:3}}]});
  return {unchanged:receiver.x===before.x&&receiver.y===before.y,law:offsideCandidate,
   queuedLaw:liveV2PendingLaunch.offsideCandidate};
 })()`);
 assert.equal(result.unchanged,true);assert.equal(result.law,null);assert.equal(result.queuedLaw,null);
});

test('a real CPU throw rejects a marked backward man and physically reaches its checked free receiver',()=>{
 const h=attackingHost(101);
 const release=h.scenario(`(()=>{${liveScene}${geometry}
  const taker=you[0],receiver=you[1],marked=you[2];place(taker,20,-34.8);place(receiver,28,-25);place(marked,18,-25);place(opp[0],18.5,-25);
  kickoffHeld=true;restartMsg='THROW-IN';restartTaker=taker;restartAnchor={x:taker.x,y:taker.y,z:54};restartBallAnchor={x:taker.x,y:taker.y,z:54};
  Object.assign(ball,{owner:null,x:taker.x,y:taker.y,z:54,vx:0,vy:0,zv:0});
  const taken=aiRestartPass(taker),event=report.events.filter(e=>e.type==='cpu-throw-plan').at(-1);
  return {taken,reason:event?.reason,freeTarget:event?.targetId===receiver.id,restartComplete:!kickoffHeld,meetingContract:liveV2PendingLaunch?.meetingContract};
 })()`);
 assert.equal(release.taken,true);assert.equal(release.reason,'checked-throw-free-receiver');assert.equal(release.freeTarget,true);assert.equal(release.restartComplete,true);assert.equal(release.meetingContract,'checked-feet-throw');
 for(let i=0;i<120&&!h.state().actions.passDiagnostics.some(p=>p.reason==='checked-throw-free-receiver');i++)h.step();
 const result=h.state().actions.passDiagnostics.find(p=>p.reason==='checked-throw-free-receiver');
 assert.equal(h.state().authority.failureCode,null);assert.ok(result,JSON.stringify(h.state().ball));assert.equal(result.completed,true,JSON.stringify(result));assert.notEqual(result.terminalReason,'v2-aerial-contact','a short feet throw is controlled without an unopposed heading job');
 console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:'named-throw-to-feet',completed:result.completed,terminal:result.terminalReason}));
});

const incomingShot=(kind)=>`(()=>{${liveScene}${geometry}
 const shooter=you.find(p=>p.role==='fwd'),follower=you.find(p=>p!==shooter&&p.role==='fwd')||you.find(p=>p!==shooter&&p.role==='mid'),gk=okeep;
 place(shooter,90,0);place(follower,98,0);gk.attrs.keeper=55;place(gk,103,${kind==='round'?3.1:0});
 if(${kind==='over'})presentKeeperShotContact(gk,'full-stretch-high',34);
 const envelope=keeperShotContactEnvelope(gk),edge=${kind==='parry'?.35:.84};
 Object.assign(ball,{owner:null,target:null,x:gk.x-envelope.reach*edge,y:gk.y,z:${kind==='over'?2.05:.28}*sz,
  vx:28*sx/60,vy:0,zv:0,isShot:true,shooter,shotType:'normal',shotPower:.8,shotDistance:13*sx,lastKicker:shooter,kickerLock:0,flightType:'shot',onTargetCounted:false});
 lastTouch=shooter.team;lastTouchPlayer=shooter;shooter.stats.shots++;report.teams.you.shots++;logEvent('shot','you',shooter,{shotType:'scripted-incoming-shot'});
 const random=Math.random;let calls=0;Math.random=()=>calls++===0?0:.99;
 let saved;try{saved=resolveKeeperBoxShotContest(gk);}finally{Math.random=random;}
 return {saved,kind:report.events.filter(e=>e.type==='keeper-deflection').at(-1)?.kind,
  lastTouch,lastKickerIsKeeper:ball.lastKicker===gk,loose:ball.owner===null&&!ball.isShot};
})()`;

test('a scripted real keeper parry admits follow-in control and an actual CPU rebound strike',()=>{
 const h=attackingHost(93),contact=h.scenario(incomingShot('parry'));
 assert.equal(contact.saved,true);assert.equal(contact.kind,'parry-danger');assert.equal(contact.loose,true);
 for(let i=0;i<360&&h.state().attack.counts.reboundShots===0;i++)h.step();
 const state=h.state();assert.equal(state.authority.failureCode,null);
 assert.ok(state.attack.counts.reboundShots>=1,JSON.stringify({attack:state.attack.counts,ball:state.ball,authority:state.authority}));
 console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:'parry-follow-in',kind:contact.kind,reboundShots:state.attack.counts.reboundShots,committedTicks:state.authority.candidateTicks}));
});

test('scripted fingertip contact crosses the real goal line and the keeper last touch awards a corner',()=>{
 for(const kind of ['round','over']){
  const h=attackingHost(95),contact=h.scenario(incomingShot(kind));
  assert.equal(contact.saved,true,JSON.stringify(contact));assert.equal(contact.kind,kind==='round'?'tip-round':'tip-over',JSON.stringify(contact));
  assert.equal(contact.lastTouch,'opp');assert.equal(contact.lastKickerIsKeeper,true);
  for(let i=0;i<900&&h.state().attack.counts.cornersFromSaves===0;i++)h.step();
  assert.equal(h.state().attack.counts.cornersFromSaves,1,JSON.stringify(h.state().attack.counts));
  assert.equal(h.scenario('restartMsg'),'CORNER');
  console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:'tip-'+kind,cornersFromSaves:h.state().attack.counts.cornersFromSaves,keeperLastTouch:contact.lastTouch}));
 }
});

test('wide live CPU decisions release an open-play cross and a byline cutback through real executors',()=>{
 for(const cutback of [false,true]){
  const h=attackingHost(97);
  h.scenario(`(()=>{${liveScene}${geometry}
   const actor=you.find(p=>p.role==='wide')||you[6],receiver=you.find(p=>p!==actor&&p.role==='fwd');
   place(actor,${cutback?103.7:80},28);place(receiver,${cutback?90:93},${cutback?8:0});
   for(const [i,p] of opp.entries())place(p,96,-28+i*3);
   if(!${cutback})place(opp[0],78,28);
   Object.assign(ball,{owner:actor,target:null,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,isShot:false,lastKicker:null,kickerLock:0});
  })()`);
  for(let i=0;i<60&&h.state().actions.counts.openPlayCrosses===0;i++)h.step();
  const state=h.state();assert.equal(state.authority.failureCode,null);
  assert.ok(state.actions.counts.openPlayCrosses>=1,JSON.stringify({cutback,decisions:state.actions.decisions,
    latest:h.scenario('({intent:liveV2Authority.status().lastCpuDecision.you?.carrierIntent,race:liveV2Authority.status().latestTelemetry?.cpu.you.passReceiverRace,phase:liveV2ControlPhase(),ballOwner:!!ball.owner})')}));
  if(cutback){assert.ok(state.actions.counts.cutBacks>=1,JSON.stringify(state.actions.decisions));assert.ok(state.actions.counts.bylineDeliveries>=1,JSON.stringify(state.actions.crossOrigins));}
  console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:cutback?'byline-cutback':'open-play-cross',crosses:state.actions.counts.openPlayCrosses,cutBacks:state.actions.counts.cutBacks}));
 }
});

test('a real byline carrier launches an aerial ball to the free far post when the deeper central pullback is covered',()=>{
 const h=attackingHost(377);
 h.scenario(`(()=>{${liveScene}${geometry}
  for(const[i,p]of you.entries())place(p,30,-27+i*3);for(const[i,p]of opp.entries())place(p,65,-28+i*3);
  const actor=you[6],pullback=you[7],receiver=you[8];
  place(actor,103.7,28);place(pullback,93,0);place(receiver,97,-8);place(opp[0],93.4,0);
  place(ykeep,2,18);place(okeep,103,18);
  Object.assign(ball,{owner:actor,target:null,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,
    isShot:false,lastKicker:null,kickerLock:0});
 })()`);
 for(let i=0;i<90&&!h.state().actions.counts.openPlayCrosses;i++)h.step();
 const state=h.state(),delivery=h.scenario("({kind:report.events.filter(e=>e.type==='v2-cross').at(-1)?.kind,lift:liveV2PendingLaunch?.liftAngleDeg||0,vertical:ball.zv})");
 assert.equal(state.authority.failureCode,null);
 assert.equal(delivery.kind,'byline',JSON.stringify({delivery,choices:state.actions.decisions}));
 assert.equal(state.actions.counts.bylineCrosses,1);assert.equal(state.actions.counts.cutBacks,0);
 assert.ok(delivery.lift>0||delivery.vertical>0,'the existing cross launch must physically lift the ball');
 assert.equal(state.actions.counts.outOfPlayRestarts,0);
});

test('a real byline cutback meets a moving closer runner and he finishes through the shared first-time shot path',()=>{
 const h=attackingHost(378);
 h.scenario(`(()=>{${liveScene}${geometry}
  for(const[i,p]of you.entries())place(p,30,-27+i*3);for(const[i,p]of opp.entries())place(p,65,-28+i*3);
  const actor=you[6],receiver=you[8],far=you[7];
  receiver.id='low-runner-2';place(actor,103.7,16);place(receiver,98,0);place(far,97,-12);place(opp[0],97.4,-12);
  Object.assign(receiver.attrs,{shoot:95,control:95,awareness:95,technique:95});receiver.vx=3*sx/60;
  place(ykeep,2,18);place(okeep,103,-18);
  Object.assign(ball,{owner:actor,target:null,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,
    isShot:false,lastKicker:null,kickerLock:0});
 })()`);
 for(let i=0;i<240&&!h.state().attack.counts.cutBackFirstTimeShots;i++)h.step();
 const state=h.state();assert.equal(state.authority.failureCode,null);
 assert.ok(state.actions.counts.cutBacks>=1,JSON.stringify(state.actions.decisions));
 assert.ok(state.attack.counts.cutBackFirstTimeShots>=1,JSON.stringify({attack:state.attack.counts,decisions:state.actions.decisions}));
 assert.equal(state.actions.counts.outOfPlayRestarts,0);
});

test('a free wide CPU carry physically reaches the byline before its delivery without running the ball out',()=>{
 const h=attackingHost(171);
 h.scenario(`(()=>{${liveScene}${geometry}
  const actor=you.find(p=>p.role==='wide')||you[6],receiver=you.find(p=>p!==actor&&p.role==='fwd');
  actor.id='wide-a';place(actor,91,28);place(receiver,93,0);
  for(const [i,p]of opp.entries())place(p,20,-28+i*3);
  Object.assign(ball,{owner:actor,target:null,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,isShot:false,lastKicker:null,kickerLock:0});
 })()`);
 for(let i=0;i<300&&h.state().actions.counts.openPlayCrosses===0;i++)h.step();
 const state=h.state();assert.equal(state.authority.failureCode,null);
 assert.ok(state.actions.counts.bylineDeliveries>=1,JSON.stringify({origins:state.actions.crossOrigins,decisions:state.actions.decisions}));
 assert.equal(state.actions.counts.outOfPlayRestarts,0,'the approach and release stay in play');
 console.log('SCRIPTED_ATTACK_PROOF',JSON.stringify({case:'physical-wide-carry-to-byline',origins:state.actions.crossOrigins,outOfPlayRestarts:state.actions.counts.outOfPlayRestarts}));
});

test('real short links play after a temporary lock and when the receiver is only 4.5 metres away',()=>{
 for(const [distance,lock] of [[8,12],[4.5,0]]){
 const h=attackingHost(104);
 const planned=h.scenario(`(()=>{${liveScene}${geometry}
  const actor=you[8],receiver=you[1];place(actor,42,0);place(receiver,${42+distance},0);
  for(const p of you)if(p!==actor&&p!==receiver)place(p,75,-28+you.indexOf(p)*3);
  for(const p of opp)place(p,90,-28+opp.indexOf(p)*3);
  receiver.receiveT=${lock};Object.assign(receiver.attrs,{control:99,technique:99,agility:99,balance:99});actor.attrs.shoot=1;
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,target:null});
  const snapshot=liveV2Snapshot(1),frame=liveV2Authority.planTick(snapshot),intent=frame.cpu.you.carrierIntent;
  return {lock:snapshot.players.find(p=>p.id===String(receiver.id)).contactLockTicks,
    eligible:snapshot.players.find(p=>p.id===String(receiver.id)).contactEligible,
    type:intent.type,target:intent.targetPlayerId===String(receiver.id),race:intent.passRace};
 })()`);
 assert.equal(planned.lock,lock);assert.equal(planned.eligible,lock===0);
 assert.equal(planned.type,'pass',JSON.stringify(planned));assert.equal(planned.target,true);
 assert.equal(planned.race.accepted,true);assert.ok(planned.race.receiverContactTick>=lock);
 for(let i=0;i<160&&!h.state().actions.passDiagnostics.length;i++)h.step();
 const pass=h.state().actions.passDiagnostics[0];assert.ok(pass,JSON.stringify(h.state().ball));
 assert.equal(pass.completed,true,JSON.stringify(pass));assert.equal(h.state().authority.failureCode,null);
 }
});
