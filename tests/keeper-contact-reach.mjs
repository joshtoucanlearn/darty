import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),Ball=require('../match-engine/ball-engine-v2.js'),Adapter=require('../match-engine/live-v2-authority-adapter.js');

test('keeper read forecasts the MR arrival height instead of choosing a foot save from launch height',()=>{
 const result=Adapter.keeperShotForecast({position:{x:80,y:0,z:.2},velocity:{x:25,y:2,z:8},planeX:101},{dependencies:{ball:Ball}});
 assert.ok(result);assert.ok(result.z>2,JSON.stringify(result));assert.ok(result.frames>40&&result.frames<65);
});

test('fingertips replace the old foot pose and timing in one existing dive, at both ends/sides and after deflection',()=>{
 const h=attackingHost(2415640915),rows=h.scenario(`(()=>{${liveScene}
  const rows=[],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  for(const team of ['you','opp'])for(const side of [-1,1])for(const deflected of [false,true]){
   const gk=team==='you'?ykeep:okeep,dir=team==='you'?-1:1,shooter=team==='you'?opp[8]:you[8];
   Object.assign(gk,{x:dir>0?W-M-35:M+35,y:H/2,fx:-dir,fy:0,vx:0,vy:0,stun:0,slide:0,skill:0,diveTargetY:H/2+side*30,
    keeperReachTarget:null,keeperShotPlan:null});clearContactPresentation(gk);
   Object.assign(ball,{owner:null,isShot:true,shooter,x:gk.x-dir*.65*sx,y:gk.y+side*.65*sy,z:2.1*sz,
    vx:dir*24*sx/60,vy:side*2*sy/60,zv:sz/60,shotType:'normal',keeperShotId:'repro-'+team+side+deflected});
   if(deflected){
    const api=window.FootballLegacyBallEngineV2,physical=api.createBallState({position:{x:1,y:.30,z:1.5},velocity:{x:25,y:0,z:0},grounded:false}),
      hit=api.resolvePassiveBodyDeflection(physical,{previousBallPosition:{x:0,y:.30,z:1.5},tick:1,
       body:{id:'fixture-blocker',position:{x:.8,y:0,z:0},velocity:{x:0,y:0,z:0},radius:.25,heightM:2}});
    if(!hit.hit)throw Error('deflection fixture must contact a real body');
    ball.vy=side*Math.abs(hit.state.velocity.y)*sy/60;ball.vx=dir*Math.max(4,Math.abs(hit.state.velocity.x))*sx/60;
   }
   const plan=gk.keeperShotPlan={shotId:keeperShotIdentity(),animation:'foot-reaction',timing:keeperShotAnimationTiming('foot-reaction'),
    started:true,elapsed:9,finished:false,originY:gk.y,committedSide:side};
   Object.assign(gk,{action:'keeperFootSave',actionT:25,keeperAnimationDuration:34,diveT:25});
   const starts=report.events.filter(e=>e.type==='keeper-dive-start').length;
   const result=applyV2KeeperDeflection(gk,80,90);
   const mesh=playerMesh({kind:team==='you'?'gkHome':'gkAway',number:1,appearance:gk.appearance});mesh.userData.faceY=Math.atan2(gk.fx,gk.fy)+Math.PI;
   place(mesh,gk,false);mesh.updateMatrixWorld(true);
   const a=new THREE.Vector3(),b=new THREE.Vector3(),head=new THREE.Vector3();mesh.userData.armL.userData.fingertips.getWorldPosition(a);mesh.userData.armR.userData.fingertips.getWorldPosition(b);mesh.userData.headGroup.getWorldPosition(head);
   const target=keeperReachTarget(gk,ball),point=new THREE.Vector3(worldX(target.x),target.z,worldZ(target.y)),distance=Math.min(a.distanceTo(point),b.distanceTo(point))/sz;
   rows.push({team,side,deflected,kind:result.kind,animation:gk.saveAnimation,elapsed:plan.elapsed,contact:plan.timing.contactFrames,
    duration:gk.keeperAnimationDuration,gap:distance,headSide:side*(head.z-worldZ(gk.y)),newDives:report.events.filter(e=>e.type==='keeper-dive-start').length-starts,
    stagedSpin:liveV2PendingLaunch?.sideSpinRpm,poseGap:gk.keeperReachProof.gapMetres});
  }
  return rows;
 })()`);
 for(const r of rows){assert.equal(r.kind,'tip-over',JSON.stringify(r));assert.equal(r.animation,'full-stretch-high');assert.equal(r.elapsed,r.contact);assert.equal(r.duration,64);
  assert.equal(r.newDives,0);assert.ok(r.gap<.035,JSON.stringify(r));assert.ok(r.poseGap<.035,JSON.stringify(r));assert.ok(r.headSide>0,JSON.stringify(r));assert.ok(Math.abs(r.stagedSpin)>0);}
 console.log('KEEPER_HAND_CONTACT_PROOF',JSON.stringify(rows));
});

test('a genuine early commitment cannot claim a fingertip on the other side after a deflection',()=>{
 const h=attackingHost(3052555897),r=h.scenario(`(()=>{${liveScene}
  const gk=okeep,shooter=you[8],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  Object.assign(gk,{x:W-M-50,y:H/2,fx:-1,fy:0,stun:0,diveT:30,action:'keeperFullStretchMid',actionT:30,keeperAnimationDuration:60,
   keeperShotPlan:{shotId:'late-deflection',animation:'full-stretch-mid',started:true,finished:false,elapsed:24,
    originY:H/2,committedSide:-1,timing:keeperShotAnimationTiming('full-stretch-mid')}});
  Object.assign(ball,{owner:null,isShot:true,shooter,x:gk.x-.4*sx,y:gk.y+1*sy,z:1.2*sz,vx:12,vy:0,zv:0,shotType:'normal',keeperShotId:'late-deflection'});
  const saved=resolveKeeperBoxShotContest(gk,true);
  return {saved,wrong:report.events.filter(e=>e.type==='keeper-wrong-commitment').length,side:gk.keeperShotPlan.committedSide};
 })()`);
 assert.equal(r.saved,false);assert.equal(r.wrong,1);assert.equal(r.side,-1);
});

test('a fingertip contact stages actual MR angular velocity at the unchanged ball position',()=>{
 const h=attackingHost(226),r=h.scenario(`(()=>{${liveScene}
  const gk=okeep,shooter=you[8],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  Object.assign(gk,{x:W-M-45,y:H/2+3.1*sy,fx:-1,fy:0,keeperShotPlan:null,stun:0});
  Object.assign(ball,{owner:null,isShot:true,shooter,x:gk.x-.6*sx,y:gk.y,z:.4*sz,vx:24*sx/60,vy:0,zv:0,shotType:'normal',keeperShotId:'physical-spin'});
  const point={x:ball.x,y:ball.y,z:ball.z},plan=applyV2KeeperDeflection(gk,80,90),launch=liveV2PendingLaunch;
  window.__tipOriginal=point;
  return {unchanged:ball.x===point.x&&ball.y===point.y&&ball.z===point.z,kind:plan.kind,source:launch?.source,spin:launch?.sideSpinRpm};
 })()`);
 assert.equal(r.unchanged,true);assert.equal(r.source,'keeper-deflection');assert.equal(r.kind,'tip-round');assert.ok(Math.abs(r.spin)>100);
 h.step();const result=h.scenario(`({angular:liveV2Authority.exportState().domain.ballState.angularVelocity,owner:ball.owner,
  point:window.__tipOriginal,lastTouch:lastTouchPlayer?.isGK,contacts:report.events.filter(e=>e.type==='keeper-hand-contact').length})`);
 assert.equal(h.state().authority.failureCode,null);assert.ok(Math.abs(result.angular.z)>3,JSON.stringify(result));assert.equal(result.owner,null);assert.equal(result.lastTouch,true);assert.equal(result.contacts,1);
});

test('the accepted-ten high-tip contact with a 36 cm hand gap is rejected before either save branch credits it',()=>{
 const h=attackingHost(229),r=h.scenario(`(()=>{${liveScene}
  const gk=okeep,sx=(W-2*M)/105;
  Object.assign(gk,{x:3239.8149221361946,y:923.4690260377284,fx:-.6997945588021749,fy:-.7143441575815326,
    appearance:{...gk.appearance,bodyIndex:1,heightIndex:0,heightCm:185},number:1,keeperShotPlan:null});
  Object.assign(ball,{owner:null,isShot:true,shooter:you[8],x:3246.506928069716,y:882.7117411366175,z:91.5408869417941,
    vx:8.782761957360114,vy:3.838480903073536,zv:-1.6681276251962063});
  const plan=keeperDeflectionContactPlan(gk,41.303017031744915,55.75),gap=keeperReachAt(gk,ball,{}).gapMetres;
  return {kind:plan.kind,gap,allowed:keeperFingertipContactAllowed(gk,41.303017031744915,55.75)};
 })()`);
 assert.equal(r.kind,'tip-over');assert.ok(r.gap>.35&&r.gap<.37,JSON.stringify(r));assert.equal(r.allowed,false);
});
