import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('actual keeper rigs stretch the head and hands toward the world reach at both ends and both sides',()=>{
 const h=attackingHost(225),result=h.scenario(`(()=>{${liveScene}
  const rows=[];
  for(const direction of[1,-1])for(const side of[-1,1])for(const animation of['full-stretch-low','full-stretch-mid','full-stretch-high']){
   const gk=direction===1?ykeep:okeep,timing=keeperShotAnimationTiming(animation);gk.fx=direction;gk.fy=0;
   Object.assign(gk,{x:direction===1?M+35:W-M-35,y:H/2,vx:0,vy:0,diveSide:side,
    action:keeperAnimationAction(animation),actionT:timing.duration-timing.contactFrames,keeperAnimationDuration:timing.duration,stun:0});
   const mesh=playerMesh({kind:direction===1?'gkHome':'gkAway',number:1,appearance:gk.appearance});mesh.userData.faceY=Math.atan2(gk.fx,gk.fy)+Math.PI;
   place(mesh,gk,false);mesh.updateMatrixWorld(true);
   const head=new THREE.Vector3(),left=new THREE.Vector3(),right=new THREE.Vector3();mesh.userData.headGroup.getWorldPosition(head);
   mesh.userData.armL.userData.hand.getWorldPosition(left);mesh.userData.armR.userData.hand.getWorldPosition(right);
   rows.push({direction,side,animation,headReach:side*(head.z-worldZ(gk.y)),handReach:Math.max(side*(left.z-worldZ(gk.y)),side*(right.z-worldZ(gk.y)))});
  }
  return rows;})()`);
 for(const row of result){assert.ok(row.headReach>8,JSON.stringify(row));assert.ok(row.handReach>8,JSON.stringify(row));}
});
