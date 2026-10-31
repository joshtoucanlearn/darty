import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Formation=require('../match-engine/formation-behaviour-v2.js');
const pitch={xMin:0,xMax:105,yMin:-34,yMax:34};
const progress=(x,dir)=>dir>0?x/105:1-x/105;

test('in-possession build-up splits the centre-backs at the box edge and sends the full-backs above them',()=>{
 for(const direction of [1,-1]){
  const ballX=direction>0?8:97;
  const result=Formation.resolve({formation:'4-4-2',phase:'buildup',tick:1,pitch,attackingDirection:direction,offsideLine:direction>0?105:0,
   ball:{position:{x:ballX,y:0},velocity:{x:0,y:0},free:false}});
  const centres=result.targets.filter(p=>p.roleFamily==='centre-back'),fullbacks=result.targets.filter(p=>p.roleFamily==='full-back');
  assert.equal(centres.length,2);assert.equal(fullbacks.length,2);
  for(const p of centres){const depth=progress(p.target.x,direction)*105;assert.ok(depth>=16&&depth<=23,JSON.stringify(p));}
  assert.ok(Math.abs(centres[0].target.y-centres[1].target.y)>=20);
  for(const p of fullbacks){assert.ok(progress(p.target.x,direction)*105>=25,JSON.stringify(p));assert.ok(Math.abs(p.target.y)>=24);}
  const pivot=result.targets.find(p=>p.roleFamily==='midfielder'&&/^(CM|DM|CDM)$/.test(p.position)&&
    progress(p.target.x,direction)*105>=20&&progress(p.target.x,direction)*105<=29&&Math.abs(p.target.y)<10);assert.ok(pivot,'a central midfielder shows between the split centre-backs and the next line');
 }
});

test('cohesion preserves an authored outlet floor ahead of the carrier during settled possession',()=>{
 const philosophy=Formation.createPhilosophyOverlay({id:'fixture-linked-outlets',label:'Linked outlets',baseFormation:'4-3-3',
  carrierSupportFloors:{'settled-attack':{CAM:.08,LW:.04,RW:.04,ST:.10}}});
 for(const direction of [1,-1]){
  const result=Formation.resolve({formation:'4-3-3',phase:'settled-attack',philosophy,tick:1,pitch,attackingDirection:direction,offsideLine:direction>0?105:0,
   tactics:{carrierProgress:.50},ball:{position:{x:52.5,y:0},velocity:{x:0,y:0},free:false}});
  for(const[slotId,floor]of Object.entries(philosophy.carrierSupportFloors['settled-attack'])){
   const target=result.targets.find(p=>p.slotId===slotId);assert.ok(target);
   // Target conversion keeps the existing pitch margin, so use the published
   // normalized role progress rather than inventing a second coordinate rule.
   assert.ok(target.normalized.progress>=.50+floor-.00001,JSON.stringify({slotId,target}));
  }
 }
});

test('after a real keeper release the unassigned centre-back moves out rather than collapsing into the box',async()=>{
 const {attackingHost,liveScene}=await import('./fixtures/attack-host-fixture.mjs');
 const h=attackingHost(361);
 const release=h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const[i,p]of you.entries())place(p,38+i*1.5,-27+i*5);
  for(const[i,p]of opp.entries())place(p,65,-27+i*5);
  const centres=you.filter(p=>positionFamily(p)==='centre-back');
  centres.forEach((p,i)=>place(p,13,i?-12:12));place(ykeep,5,0);place(okeep,103,18);
  Object.assign(ball,{owner:ykeep,x:ykeep.x,y:ykeep.y,z:30,vx:0,vy:0,zv:0,target:null});
  if(!keeperKick(ykeep,'auto'))throw Error('keeper fixture did not release');
  const unassigned=centres.find(p=>p.id!==liveV2PendingLaunch?.targetPlayerId);
  window.__buildCentre=unassigned;return {id:unassigned.id,start:(unassigned.x-M)/sx};
 })()`);
 h.step();const target=h.scenario('liveV2Authority.status().lastFormation.you.targets.find(p=>p.playerId===window.__buildCentre.id).target');
 assert.ok(target.x>=16,JSON.stringify(target));
 for(let i=0;i<59;i++)h.step();
 const depth=h.scenario('(window.__buildCentre.x-M)*105/(W-2*M)');
 assert.equal(h.state().authority.failureCode,null);assert.ok(depth>release.start+.5,JSON.stringify({release,depth,target}));
});
