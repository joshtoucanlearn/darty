import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('the harness records accepted real CPU challenge windows from the live V2 transaction',()=>{
 const h=attackingHost(602);
 h.scenario(`(()=>{${liveScene}
  lastAICpuDiveScanFrame=Infinity;const sx=(W-2*M)/105,sy=H/68,put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  you.forEach((p,i)=>put(p,30,-28+i*3));opp.forEach((p,i)=>put(p,90,-28+i*3));put(ykeep,2,0);put(okeep,103,0);
  const actor=you[8],defender=opp[4];put(actor,65,0);put(defender,67,0);actor.aiSkillCooldown=999;
  Object.assign(actor.attrs,{shoot:30,control:90,pace:75});Object.assign(defender.attrs,{defend:90,awareness:95,aggression:90});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,isShot:false,lastKicker:null,kickerLock:0});
 })()`);
 for(let i=0;i<150&&Object.values(h.state().challenges.counts).every(r=>r.attempts===0);i++)h.step();
 assert.equal(h.state().authority.failureCode,null);const stats=h.state().challenges;
 assert.ok(Object.values(stats.counts).some(r=>r.attempts>0),'a committed accepted action reaches the observer');
 assert.ok(stats.episodes.every(e=>e.id&&e.commandId&&Number.isInteger(e.epoch)));
});
