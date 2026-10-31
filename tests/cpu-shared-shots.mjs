import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const setup=`${liveScene}
 const sx=(W-2*M)/105,sy=H/68,actor=you[8];
 for(const [i,p]of [...you,...opp].entries())Object.assign(p,{x:M+(i<10?30:70)*sx,y:200+i*30,vx:0,vy:0});
 Object.assign(actor,{x:M+87*sx,y:H/2,vx:0,vy:0,fx:1,fy:0,turnAngle:0});
 Object.assign(ball,{owner:actor,x:actor.x+rad,y:actor.y,z:1,vx:0,vy:0,zv:0,target:null,kickerLock:0});
`;
test('CPU and human ground shots execute the identical aim/error/launch path',()=>{
 const outputs=[];
 for(const cpu of [false,true]){
  const h=attackingHost(301);
  outputs.push(h.scenario(`(()=>{${setup}
   const saved=Math.random;Math.random=()=>.37;
   try{${cpu?"liveV2ApplyIntelligence({intelligence:[{playerId:actor.id,type:'shot',target:{x:W-M,y:H/2},shotProfile:{technique:'driven',power:.72}}]});":"doShootForHuman(actor,.72,'normal',false,{x:1,y:0});"}}
   finally{Math.random=saved;}
   const q=liveV2PendingLaunch;return {speed:q.speedMetresPerSecond,lift:q.liftAngleDeg,spin:q.sideSpinRpm,target:q.target,aim:ball.aimTarget,shots:actor.stats.shots};
  })()`));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(outputs[0])),JSON.parse(JSON.stringify(outputs[1])));assert.equal(outputs[1].shots,1);
});
test('a real low cut-back foot contact can finish first time without waiting for ownership',()=>{
 const h=attackingHost(302);
 h.scenario(`(()=>{${setup.replace('actor=you[8]','actor=you[9]')}
  for(const p of opp)Object.assign(p,{x:M+60*sx,y:100});
  Object.assign(actor,{x:M+94*sx,y:H/2,vx:0,vy:1.5*sy/60,fx:1,fy:0});
  const passer=you[7];Object.assign(passer,{x:M+102*sx,y:H/2+15*sy});
Object.assign(ball,{owner:null,target:actor,x:actor.x+2*sx,y:actor.y,z:1,vx:-12*sx/60,vy:0,zv:0,
   flightType:'low-cross',v2ServiceKind:'cut-back',lastKicker:passer,aerialSource:passer,kickerLock:0,cool:0,isShot:false});
 })()`);
 for(let i=0;i<90&&!h.state().attack.counts.cutBackFirstTimeShots;i++)h.step();
 const state=h.state();assert.equal(state.authority.failureCode,null);
 assert.equal(state.attack.counts.cutBackFirstTimeShots,1,JSON.stringify(state.attack));
 assert.equal(state.attack.counts.firstTimeGroundShots,1);
});
test('an unattached shot command cannot invent possession or a physical first-time contact',()=>{
 const h=attackingHost(303);
 const result=h.scenario(`(()=>{${setup}ball.owner=null;const shots=actor.stats.shots;
  doShootForHuman(actor,.7,'normal',false,null,{cpu:true,firstTime:true,technique:'driven',goalPoint:{x:W-M,y:H/2}});
  return {shots:actor.stats.shots-shots,launch:!!liveV2PendingLaunch};})()`);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{shots:0,launch:false});
});
