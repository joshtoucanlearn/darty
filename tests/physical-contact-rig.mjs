import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('the real contact rig and physical foot FK agree at both ends with no boot below the turf',()=>{
 const h=attackingHost(703),rows=h.scenario(`(()=>{${liveScene}
  const api=window.FootballLegacyMovementEngineV2,rows=[],p=you[0],sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE;
  for(const bodyIndex of[0,1,2,3,4])for(const direction of[-1,1])for(const type of['stand-tackle','slide-tackle']){
   p.appearance={...p.appearance,bodyIndex,heightCm:180};const mesh=playerMesh({kind:'home',number:2,appearance:p.appearance});
   Object.assign(p,{x:W/2,y:H/2,fx:direction,fy:0,vx:0,vy:0,stun:0,skill:0,
    action:type==='stand-tackle'?'tackle':'slideTackle',slide:type==='slide-tackle'?30:0,
    v2ContactAction:{type,startedTick:0,recoveryEndTick:100}});mesh.userData.faceY=Math.atan2(direction,0)+Math.PI;
   for(const progress of[.1,.2,.3,.5,.7]){
    clearContactPresentation(p);p.v2ContactTick=progress*100;place(mesh,p,false);mesh.updateMatrixWorld(true);
    const rig=liveV2ContactRigFor(p),pose={},scratch={};api.fillChallengePose(type,progress,1,pose);api.groundChallengePose(rig,pose,progress,scratch);
    for(const side of[-1,1]){const node=side<0?mesh.userData.footL:mesh.userData.footR;
      for(const toe of[false,true]){const point=new THREE.Vector3(0,0,toe?-4.12:0);node.localToWorld(point);
       const actual={x:(point.x-worldX(p.x))/sx,y:(point.z-worldZ(p.y))/sy,z:point.y/sz},predicted={};
       api.fillChallengeFoot(rig,pose,side,toe,direction,0,predicted);
       rows.push({bodyIndex,direction,type,progress,side,toe,error:Math.hypot(actual.x-predicted.x,actual.y-predicted.y,actual.z-predicted.z),height:actual.z});}
    }
   }
  }return rows;})()`);
 assert.equal(rows.length,400);for(const row of rows){assert.ok(row.error<.001,JSON.stringify(row));assert.ok(row.height>=.04,JSON.stringify(row));}
 console.log('PHYSICAL_RIG_PROOF',JSON.stringify({points:rows.length,worstGapMetres:Math.max(...rows.map(r=>r.error)),lowestBootMetres:Math.min(...rows.map(r=>r.height))}));
});
test('a finite zero sideways facing remains straight in the real renderer',()=>{
 const h=attackingHost(704),r=h.scenario(`(()=>{${liveScene}
  const p=you[0],mesh=playerMesh({kind:'home',number:2,appearance:p.appearance});p.fx=1;p.fy=0;p.v2ContactAction=null;p.stun=0;p.slide=0;p.action='idle';
  mesh.userData.faceY=Math.PI*1.5;for(let i=0;i<25;i++)place(mesh,p,false);return mesh.userData.faceY;
 })()`);assert.ok(Math.abs(r-Math.PI*1.5)<1e-12);
});

test('standing and shoulder presentation follows its accepted window without a renewed hold',()=>{
 const h=attackingHost(706),rows=h.scenario(`(()=>{${liveScene}
  const api=window.FootballLegacyLiveV2Authority.contactPoseApi(),sx=(W-2*M)/105,sy=H/68,actor=you[0],target=opp[0],rows=[];
  for(const type of['stand-tackle','shoulder-challenge']){
   let world=api.createWorldState({players:[{id:actor.id,teamId:'you',position:{x:40,y:0}},
     {id:target.id,teamId:'opp',position:{x:45,y:0}}]});
   let moved=api.advance(world,[{id:'window-'+type,tick:1,playerId:actor.id,type,targetId:target.id,direction:{x:1,y:0}}],1);
   const apply=r=>liveV2ApplyMovement({snapshotTick:r.state.tick,movement:r.state.players.map(p=>({id:p.id,x:M+p.position.x*sx,y:H/2+p.position.y*sy,
     vx:p.velocity.x*sx/60,vy:p.velocity.y*sy/60,fx:p.facing.x,fy:p.facing.y,stamina:p.stamina,action:p.action,locomotionState:p.locomotionState})),
     logicalBallOwnerId:null,movementBallOwnerId:null,possession:{ownerId:null},physicalBallSeparated:false,movementTelemetry:r.telemetry});
   apply(moved);const until=actor.presentationActionUntil,remaining=actor.actionT,clock=performance.now;
   moved=api.advance(moved.state,[],2);performance.now=()=>clock()+80;
   try{apply(moved);}finally{performance.now=clock;}
   rows.push({type,sameHold:actor.presentationActionUntil===until,advances:actor.actionT<remaining});
  }return rows;})()`);
 for(const row of rows){assert.equal(row.sameHold,true,JSON.stringify(row));assert.equal(row.advances,true,JSON.stringify(row));}
});
test('the existing dramatic fall renderer caps active bodies and sleeps once settled',()=>{
 const h=attackingHost(707),r=h.scenario(`(()=>{${liveScene}
  contactFallRenderActive=0;const meshes=[];
  for(let i=0;i<5;i++){
   const p=you[i];Object.assign(p,{action:'fallForward',actionT:46,stun:30,slide:0,skill:0,v2ContactAction:null,fallFacingX:1,fallFacingY:0});
   clearContactPresentation(p);const mesh=playerMesh({kind:'home',number:i+2,appearance:p.appearance});place(mesh,p,false);meshes.push(mesh);
  }
  const last=meshes[4],before=last.userData.legR.rotation.x;you[4].actionT=1;place(last,you[4],false);
  return {active:contactFallRenderActive,overflowSleeps:last.userData.contactFallSleeping,sameSettledPose:before===last.userData.legR.rotation.x,
    sleeping:meshes.filter(m=>m.userData.contactFallSleeping).length};
 })()`);
 assert.equal(r.active,4);assert.equal(r.overflowSleeps,true);assert.equal(r.sameSettledPose,true);assert.equal(r.sleeping,1);
});
