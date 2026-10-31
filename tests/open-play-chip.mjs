import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js'),Ball=require('../match-engine/ball-engine-v2.js');
test('the shared chip weights the existing vertical profile to its powered MR landing range',()=>{
 for(const range of [7,12,20,32,44]){
  const power=CPU.openPlayChipPower(range);
  assert.ok(Math.abs(CPU.openPlayChipRange(power)-range)<.001);
  const plan=CPU.weightChipLanding({rangeMetres:range,verticalMetresPerSecond:9,heightMetres:.14},Ball);
  assert.ok(Math.abs(plan.landingMetres-range)<.025,JSON.stringify(plan));
  assert.equal(plan.verticalMetresPerSecond,9);assert.equal(plan.trajectoryProfile,'penalty-chip');
 }
});
test('open-play chip executes the same penalty-chip lift through the real shared shot path',()=>{
 const h=attackingHost(311);
 const r=h.scenario(`(()=>{${liveScene}
  const actor=you[8];Object.assign(actor,{x:W-M-18*PITCH_UNITS_PER_METRE,y:H/2,fx:1,fy:0});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:1,vx:0,vy:0,zv:0,target:null});
  const expected=penaltyPhysicsPlan({team:actor.team,taker:actor,power:.6,shotType:'chip-penalty',targetY:H/2,aimHeight:.5,deterministic:true});
  const random=Math.random;Math.random=()=>.5;try{doShootForHuman(actor,.6,'chip',false,{x:1,y:0});}finally{Math.random=random;}
  return {profile:ball.trajectoryProfile,type:ball.shotType,vertical:liveV2PendingLaunch&&Math.sin(liveV2PendingLaunch.liftAngleDeg*Math.PI/180)*liveV2PendingLaunch.speedMetresPerSecond,
    expectedVertical:window.FootballLegacyBallEngineV2.resolveLaunch({id:'actual-penalty-reference',origin:{x:0,y:0,z:1/PITCH_UNITS_PER_METRE+.11},direction:{x:1,y:0},speed:worldBallPaceMetresPerSecond(expected.horizontalSpeed*ERA_MATCH.ballSpeed,W-M-actor.x,H/2-actor.y),liftAngleDeg:Math.atan2(expected.zv*60/PITCH_UNITS_PER_METRE,worldBallPaceMetresPerSecond(expected.horizontalSpeed*ERA_MATCH.ballSpeed,W-M-actor.x,H/2-actor.y))*180/Math.PI}).state.velocity.z,queue:liveV2PendingLaunch,source:liveV2PendingLaunch?.source,shots:actor.stats.shots};
 })()`);
 assert.equal(r.profile,'penalty-chip');assert.equal(r.type,'chip');assert.equal(r.source,'shot');assert.equal(r.shots,1);
 assert.ok(Math.abs(r.vertical-r.expectedVertical)<1e-9,JSON.stringify(r));
 let state=Ball.resolveLaunch({id:'actual-common-chip',origin:{x:0,y:0,z:.11+1/((2142-12)/68)},direction:{x:1,y:0},
   speed:r.queue.speedMetresPerSecond,liftAngleDeg:r.queue.liftAngleDeg}).state,context=Ball.createSimulationContext({seed:173}),landing=null;
 for(let tick=0;tick<180&&!landing;tick+=15){const next=Ball.step(state,context,.25,{}),hit=next.trace.events.find(e=>e.type==='contact'&&e.normal.z>.9);
  if(hit){const sample=next.trace.samples.find(p=>p.substepCount===hit.substepCount+1);landing=sample?.position.x;}
  state=next.state;context=next.context;}
 assert.ok(Math.abs(landing-CPU.openPlayChipRange(.6))<.12,JSON.stringify({landing,poweredRange:CPU.openPlayChipRange(.6)}));

});

test('human L1 plus Circle launches an open-play chip and consumes the switch modifier',()=>{
 const h=attackingHost(312,{humanInput:true});
 h.scenario(`(()=>{${liveScene}
  const actor=you[8];controlled=actor;Object.assign(actor,{x:W-M-18*PITCH_UNITS_PER_METRE,y:H/2,fx:1,fy:0});
  for(const p of opp)Object.assign(p,{x:M+50*PITCH_UNITS_PER_METRE,y:80});
  Object.assign(ball,{owner:actor,x:actor.x+rad,y:actor.y,z:0,vx:0,vy:0,zv:0,target:null});
  window.__chipActorId=actor.id;window.__chipPad={index:0,connected:true,mapping:'standard',id:'Fixture pad',axes:[0,0,0,0],buttons:Array.from({length:18},(_,i)=>({pressed:i===1||i===4,value:i===1||i===4?1:0}))};
  navigator.getGamepads=()=>[window.__chipPad];pollBoundPad(gamepadInput,window.__chipPad,false);
 })()`);
 for(let i=0;i<30;i++)h.step();
 const selected=h.scenario('({variant:gamepadInput.openPlayShotType,consumed:gamepadInput.l1UsedAsModifier})');
 assert.equal(selected.variant,'chip');assert.equal(selected.consumed,true);
 h.scenario('window.__chipPad.buttons[1]={pressed:false,value:0};pollBoundPad(gamepadInput,window.__chipPad,false)');
 for(let i=0;i<16;i++)h.step();
 const shot=h.scenario("report.events.filter(e=>e.type==='shot').at(-1)?.shotType");assert.equal(shot,'chip');
 h.scenario('window.__chipPad.buttons[4]={pressed:false,value:0};pollBoundPad(gamepadInput,window.__chipPad,false)');
 assert.equal(h.scenario('controlled.id===window.__chipActorId'),true);
});

test('undercharged and full chips retain their weighted lift through the actual live adapter',()=>{
 for(const power of [.24,.6,.95]){
  const h=attackingHost(313);
  const queue=h.scenario(`(()=>{${liveScene}
   const sx=(W-2*M)/105,actor=you[8];
   for(const p of [...you,...opp])Object.assign(p,{x:M+40*sx,y:80});
   Object.assign(actor,{x:M+87*sx,y:H/2,fx:1,fy:0});
   Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:1,vx:0,vy:0,zv:0,target:null});
   const random=Math.random;Math.random=()=>.5;try{doShootForHuman(actor,${power},'chip',false,{x:1,y:0});}finally{Math.random=random;}
   return liveV2PendingLaunch;
  })()`);
  assert.equal(queue.trajectoryProfile,'penalty-chip');
  h.step();assert.equal(h.state().authority.failureCode,null);
  const velocity=h.scenario('liveV2Authority.exportState().domain.ballState.velocity');
  const start=Ball.resolveLaunch({id:'expected-chip',origin:{x:87,y:0,z:.11+1/(2142/68)},direction:queue.direction,
    speed:queue.speedMetresPerSecond,liftAngleDeg:queue.liftAngleDeg}).state;
  const expected=Ball.step(start,Ball.createSimulationContext({seed:313}),1/60,{}).state.velocity;
  assert.ok(Math.abs(velocity.z-expected.z)<.002,JSON.stringify({power,angle:queue.liftAngleDeg,velocity,expected}));
 }
});
