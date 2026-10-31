import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),Ball=require('../match-engine/ball-engine-v2.js');
function flight({pressure=20,backwards=false,aimY=0,roll=.99}){
 const h=attackingHost(351);
 const q=h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,actor=you[8],defender=opp[0];
  for(const p of opp)Object.assign(p,{x:M+50*sx,y:60});
  Object.assign(actor,{x:M+87*sx,y:H/2,fx:${backwards?-1:1},fy:0,turnAngle:0});
  Object.assign(actor.attrs,{shoot:85,technique:85,balance:75,control:85,awareness:85});
  Object.assign(defender,{x:actor.x+${pressure}*sx,y:actor.y});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:1,vx:0,vy:0,zv:0,target:null});
  const saved=Math.random;Math.random=()=>${roll};try{doShootForHuman(actor,.98,'normal',false,null,{cpu:true,technique:'power',goalPoint:{x:W-M,y:H/2+${aimY}*sy}});}finally{Math.random=saved;}
  return {launch:liveV2PendingLaunch,origin:{x:(ball.x-M)/sx,y:(ball.y-H/2)/sy,z:1/PITCH_UNITS_PER_METRE+.11}};
 })()`);
 let state=Ball.resolveLaunch({id:'real-shared-miss',origin:q.origin,direction:q.launch.direction,speed:q.launch.speedMetresPerSecond,
   liftAngleDeg:q.launch.liftAngleDeg,sideSpinRpm:q.launch.sideSpinRpm,topSpinRpm:q.launch.topSpinRpm}).state,
   context=Ball.createSimulationContext({seed:173}),last=state.position;
 for(let frame=0;frame<180;frame+=15){const next=Ball.step(state,context,.25,{});
  for(const p of next.trace.samples){if(p.position.x>=105){const t=(105-last.x)/(p.position.x-last.x);return {y:last.y+(p.position.y-last.y)*t,z:last.z+(p.position.z-last.z)*t};}last=p.position;}
  state=next.state;context=next.context;
 }
 throw Error('shot never reached the real goal plane');
}
test('the shared shot error produces a physical near-post miss',()=>{
 const p=flight({aimY:3.4,roll:.82});assert.ok(Math.abs(p.y)>3.66&&Math.abs(p.y)<4.66,JSON.stringify(p));assert.ok(p.z<2.44,JSON.stringify(p));
});
test('a very rushed, poorly shaped strike can physically clear the bar by more than two metres',()=>{
 const calm=flight({pressure:20}),rushed=flight({pressure:.6,backwards:true});
 assert.ok(calm.z<2.44,JSON.stringify(calm));assert.ok(rushed.z>4.44,JSON.stringify(rushed));
 console.log('SCRIPTED_SHARED_MISS_PROOF',JSON.stringify({calmGoalHeight:calm.z,skiedGoalHeight:rushed.z}));
});

test('a pressured rising shot can pass just over the actual bar',()=>{const p=flight({pressure:1,roll:.9});assert.ok(p.z>2.44&&p.z<3.44,JSON.stringify(p));});
