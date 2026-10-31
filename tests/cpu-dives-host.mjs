import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const geometry=`const sx=(W-2*M)/105,sy=H/68;
 const put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,stun:0,fx:p.team==='you'?1:-1,fy:0});
 you.forEach((p,i)=>put(p,40,-28+i*4));opp.forEach((p,i)=>put(p,70,-28+i*4));put(ykeep,2,0);put(okeep,103,0);`;
test('a last-second rolling dive plays its real replay, ref punch and booking before full time',()=>{
 const h=attackingHost(501);
 const setup=h.scenario(`(()=>{${liveScene}${geometry}
  if(typeof lastAICpuDiveScanFrame!=='undefined')lastAICpuDiveScanFrame=Infinity;
  liveV2ControlRuntime=liveV2ControlApi.createRuntime({sessionId:'last-second-scene',realMatchDurationSeconds:4,
   pitch:{units:'metres',coordinateSystem:'si-metres-world-x-length-y-width-z-up',axisAlignment:'axis-aligned',xMin:0,xMax:105,yMin:0,yMax:68}},liveV2ControlCapability);
  liveV2ControlTick=0;liveV2HalfTimeSeen=false;liveV2ControlDisabled=false;
  Object.assign(ball,{owner:null,isShot:false,vx:0,vy:0,zv:0});
  for(let i=0;i<120;i++)liveV2RunControlOnly();
  const half=liveV2ControlApi.snapshot(liveV2ControlRuntime,liveV2ControlCapability).clock.period;
  halfTimeUntil=0;kickoffHeld=true;restartMsg='KICK OFF';liveV2RunControlOnly();clearRestartState();kickoffHeld=false;clockRunning=true;
  for(let i=0;i<118;i++)liveV2RunControlOnly();
  const actor=you[8];put(actor,78,0);put(opp[0],82,0);Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0});
  const random=Math.random;let accepted;Math.random=()=>.9;try{accepted=attemptDive(actor,'rolling');}finally{Math.random=random;}
  return {half,accepted,decision:pendingDiveDecision?.onField,period:liveV2ControlApi.snapshot(liveV2ControlRuntime,liveV2ControlCapability).clock.period};
 })()`);
 assert.equal(setup.half,'half-time');assert.equal(setup.period,'second-half');assert.equal(setup.accepted,true);assert.equal(setup.decision,'simulation');
 let replaySeen=false,punchSeen=false,sceneSeen=false,ft=false;
 for(let i=0;i<2400&&!ft;i++){
  h.step();
  const r=h.scenario(`({period:liveV2ControlApi.snapshot(liveV2ControlRuntime,liveV2ControlCapability).clock.period,
    replay:diveReplay.active,scene:foulSequence?.scene,punch:report.events.some(e=>e.type==='impact-sound'&&e.kind==='referee-punch'),
    decisionPending:typeof diveDecisionAwaitingApplication!=='undefined'&&!!(diveDecisionAwaitingApplication&&!diveDecisionAwaitingApplication.decisionApplied),booked:you[8].stats.yellows||0})`);
  replaySeen||=r.replay;punchSeen||=r.punch;sceneSeen||=r.scene==='refPunch';
  ft=r.period==='full-time';
  if(ft){assert.ok(replaySeen,'real dive replay finished');assert.ok(sceneSeen,'real referee scene started');assert.ok(punchSeen,'the punch actually landed');assert.equal(r.decisionPending,false);assert.ok(r.booked>=1);}
 }
 assert.equal(h.state().authority.failureCode,null);assert.ok(ft,'scene finishes and clock reaches full time');
});
test('a play-on dive releases its physical possession instead of carrying the ball while falling',()=>{
 const h=attackingHost(502);
 const result=h.scenario(`(()=>{${liveScene}${geometry}
  const actor=you[8],defender=opp[0];put(actor,65,0);put(defender,66,0);
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0});
  actor._challengeContext={frame:officiatingFrame(),offender:defender,contact:true,ballFirst:false,severity:.5};
  const random=Math.random;Math.random=()=>.99;try{attemptDive(actor,'subtle');}finally{Math.random=random;}
  liveV2HostClaimsSkillBall();return {owned:ball.owner===actor,decision:lastPlayOnDive?.footballer===actor,action:actor.action};
 })()`);
 assert.equal(result.decision,true);assert.equal(result.owned,false);assert.equal(result.action,'dive');
});

test('a live rolling play-on fall on the final tick finishes before the whistle',()=>{
 const h=attackingHost(503);
 const setup=h.scenario(`(()=>{${liveScene}${geometry}
  if(typeof lastAICpuDiveScanFrame!=='undefined')lastAICpuDiveScanFrame=Infinity;
  liveV2ControlRuntime=liveV2ControlApi.createRuntime({sessionId:'last-tick-live-dive',realMatchDurationSeconds:4,
   pitch:{units:'metres',coordinateSystem:'si-metres-world-x-length-y-width-z-up',axisAlignment:'axis-aligned',xMin:0,xMax:105,yMin:0,yMax:68}},liveV2ControlCapability);
  liveV2ControlTick=0;liveV2HalfTimeSeen=false;liveV2ControlDisabled=false;
  Object.assign(ball,{owner:null,isShot:false,vx:0,vy:0,zv:0});
  for(let i=0;i<120;i++)liveV2RunControlOnly();
  halfTimeUntil=0;kickoffHeld=true;restartMsg='KICK OFF';liveV2RunControlOnly();clearRestartState();kickoffHeld=false;clockRunning=true;
  for(let i=0;i<119;i++)liveV2RunControlOnly();
  const actor=you[8],defender=opp[0];put(actor,65,0);put(defender,67,0);
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0});
  actor._challengeContext={frame:officiatingFrame(),offender:defender,contact:true,ballFirst:false,severity:.5};
  const random=Math.random;let accepted;Math.random=()=>.99;try{accepted=attemptDive(actor,'rolling');}finally{Math.random=random;}
  return {accepted,playOn:!!lastPlayOnDive,pending:!!pendingDiveDecision};
 })()`);
 assert.equal(setup.accepted,true);assert.equal(setup.playOn,true);assert.equal(setup.pending,false);
 h.step();
 assert.equal(h.scenario('liveV2ControlApi.snapshot(liveV2ControlRuntime,liveV2ControlCapability).clock.period'),'second-half',
  'a live dive cannot be cut off by the last authoritative clock tick');
 let ft=false;
 for(let i=0;i<900&&!ft;i++){
  h.step();ft=h.scenario("liveV2ControlApi.snapshot(liveV2ControlRuntime,liveV2ControlCapability).clock.period==='full-time'");
 }
 assert.equal(h.state().authority.failureCode,null);assert.ok(ft,'real fall ends and the pending period completes');
});

test('a real separated carry remains a loose ball when its carrier dives',()=>{
 const h=attackingHost(507);
 h.scenario(`(()=>{${liveScene}${geometry}
  lastAICpuDiveScanFrame=Infinity;const actor=you[8];put(actor,65,0);for(const [i,p]of opp.entries())put(p,95,-28+i*4);
  for(const p of [...you,...opp])p.stun=600;actor.stun=0;opp[0].stun=0;
  actor.vx=4*sx/60;Object.assign(actor.attrs,{shoot:30,control:90,pace:90,accel:90});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:actor.vx,vy:0,zv:0,isShot:false,lastKicker:null,kickerLock:0});
  // Choose a carry for this lease test; ordinary pass policy is tested separately.
  const api=window.FootballLegacyLiveV2Authority,base=window.FootballLegacyCPUIntelligenceV2,
    capability=api.createCapability({acknowledgement:api.ACKNOWLEDGEMENT,workflow:'cpu-v-cpu',online:false,
      controlOwnership:{humanPlayerIds:[],cpuTeamIds:['you','opp']}}),
    cpu={...base,decide(s,m,c){const d=base.decide(s,m,c);if(s.carrierId!==actor.id)return d;
      return {...d,carrierIntent:{type:'carry',target:{x:s.ball.x+5,y:s.ball.y},confidence:1,reason:'fixture-real-carry'}};}};
  liveV2Authority=api.createAttachment({enabled:true,capability,seed:507,trueFeelPhysicalTouchAuthority:true,cpuPassRaceFilter:true,
    dependencies:{cpu},host:{prepareTick:liveV2PrepareHostTick}});
 })()`);
 let lease=false;
 for(let i=0;i<90&&!lease;i++){h.step();lease=h.scenario('liveV2DribbleLeaseOwnerId===you[8].id&&!ball.owner&&you[8].skill===0');}
 assert.ok(lease,'the unchanged physical dribbling engine actually separates the ball');
 const r=h.scenario(`(()=>{
  const actor=you[8],defender=opp[0];actor._challengeContext={frame:officiatingFrame(),offender:defender,contact:true,ballFirst:false,severity:.5};
  const random=Math.random;let accepted;Math.random=()=>.99;try{accepted=attemptDive(actor,'rolling');}finally{Math.random=random;}
  liveV2HostClaimsSkillBall();return {accepted,playOn:!!lastPlayOnDive,owned:ball.owner===actor};
 })()`);
 assert.equal(r.accepted,true);assert.equal(r.playOn,true);assert.equal(r.owned,false,'a falling actor has no skill-carry claim');
 h.step();
 assert.equal(h.state().authority.failureCode,null);
 const after=h.scenario("({lease:liveV2DribbleLeaseOwnerId,owned:ball.owner===you[8],logical:liveV2Authority.exportState().domain.dribbling.state.logicalOwnerId})");
 assert.equal(after.lease,null);assert.equal(after.owned,false);assert.notEqual(after.logical,'you-8','the shared protected-workflow handoff clears the lease');
 // Keep this lease regression's pickup route clear of the fallen body;
 // actual off-ball charges now have their own physical contact authority.
 h.scenario(`(()=>{const p=opp[0];Object.assign(p.attrs,{control:99,reactions:99,awareness:99});Object.assign(p,{x:ball.x+.35*(W-2*M)/105,y:ball.y,vx:0,vy:0,fx:-1,fy:0,receiveT:0});})()`);
 let recovered=false;
 for(let i=0;i<150&&!recovered;i++){
  h.step();const state=h.scenario("({owned:ball.owner===you[8],other:!!ball.owner&&ball.owner!==you[8],action:you[8].action})");
  assert.equal(state.owned,false,'the diver cannot regain a loose ball while still falling');recovered=state.other;
 }
 assert.equal(h.state().authority.failureCode,null);assert.ok(recovered,'another footballer physically recovers the live ball '+JSON.stringify(h.scenario("({phase:matchPhase,foul:!!foulSequence,ball:[ball.x,ball.y,ball.z],opp:[opp[0].x,opp[0].y],diver:[you[8].x,you[8].y],events:report.events.slice(-6).map(e=>({type:e.type,actor:e.playerId,reason:e.reason,authority:e.authority,proof:e.contactProof}))})")));
});


test('the whistle guard follows a real goal-bound body deflection and ignores routine separation contacts',()=>{
 const h=attackingHost(508),r=h.scenario(`(()=>{${liveScene}${geometry}
  Object.assign(ball,{owner:null,isShot:false,flightType:'involuntary-deflection',x:M+100*sx,y:H/2,vx:12*sx/60,vy:0,z:20,zv:0});
  const deflection=liveV2PeriodEndBlocked();
  Object.assign(ball,{flightType:'ground',vx:0,vy:0});
  const ordinary=liveV2PeriodEndBlocked({intelligence:[],movementTelemetry:{contacts:[{type:'player-separation'}]}}),
    challenge=liveV2PeriodEndBlocked({intelligence:[],movementTelemetry:{contacts:[{type:'slide-contact'}]}});
  return {deflection,ordinary,challenge};
 })()`);
 assert.equal(r.deflection,true);assert.equal(r.ordinary,false);assert.equal(r.challenge,true);
});
