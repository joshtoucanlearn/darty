import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('a fingertip penalty contact reaches the ball even though penalty scheduling has no open-play dive plan',()=>{
 const h=attackingHost(227),r=h.scenario(`(()=>{${liveScene}
  const gk=okeep,shooter=you[8],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  Object.assign(gk,{x:W-M-35,y:H/2,fx:-1,fy:0,keeperShotPlan:null,stun:0,action:'keeperLowDive',saveAnimation:'full-stretch-low',actionT:30,keeperAnimationDuration:56});
  clearContactPresentation(gk);
  Object.assign(ball,{owner:null,isShot:true,shooter,x:gk.x-.65*sx,y:gk.y+.65*sy,z:2.1*sz,vx:24*sx/60,vy:0,zv:0,shotType:'penalty',keeperShotId:'penalty-tip'});
  const plan=applyV2KeeperDeflection(gk,80,90),mesh=playerMesh({kind:'gkAway',number:1,appearance:gk.appearance});mesh.userData.faceY=Math.atan2(gk.fx,gk.fy)+Math.PI;
  place(mesh,gk,false);mesh.updateMatrixWorld(true);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),target=keeperReachTarget(gk,ball),point=new THREE.Vector3(worldX(target.x),target.z,worldZ(target.y));
  mesh.userData.armL.userData.fingertips.getWorldPosition(a);mesh.userData.armR.userData.fingertips.getWorldPosition(b);
  return {kind:plan.kind,gap:Math.min(a.distanceTo(point),b.distanceTo(point))/sz,openPlayPlan:!!gk.keeperShotPlan};
 })()`);
 assert.equal(r.kind,'tip-over');assert.equal(r.openPlayPlan,false);assert.ok(r.gap<.035,JSON.stringify(r));
});
test('a turning physical challenge renders at the shared Movement heading instead of a second smoothed heading',()=>{
 const h=attackingHost(228),rows=h.scenario(`(()=>{${liveScene}
  const p=you[0],api=window.FootballLegacyLiveV2Authority.contactPoseApi(),rows=[],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  for(const angle of [-2.3,-.4,.8,2.4]){
   Object.assign(p,{x:W/2,y:H/2,fx:Math.cos(angle),fy:Math.sin(angle),stun:0,slide:30,skill:0,action:'slideTackle',
    v2ContactAction:{type:'slide-tackle',startedTick:0,recoveryEndTick:100},v2ContactTick:30});clearContactPresentation(p);
   const mesh=playerMesh({kind:'home',number:2,appearance:p.appearance});mesh.userData.faceY=0;place(mesh,p,false);mesh.updateMatrixWorld(true);
   const pose={},scratch={},rig=liveV2ContactRigFor(p);api.fillChallengePose('slide-tackle',.3,1,pose);api.groundChallengePose(rig,pose,.3,scratch);
   for(const side of [-1,1]){const node=side<0?mesh.userData.footL:mesh.userData.footR,point=new THREE.Vector3(0,0,-4.12);node.localToWorld(point);
    const physical={};api.fillChallengeFoot(rig,pose,side,true,p.fx,p.fy,physical);
    rows.push(Math.hypot((point.x-worldX(p.x))/sx-physical.x,(point.z-worldZ(p.y))/sy-physical.y,point.y/sz-physical.z));}
  }return rows;
 })()`);
 for(const gap of rows)assert.ok(gap<.001,JSON.stringify(rows));
});
