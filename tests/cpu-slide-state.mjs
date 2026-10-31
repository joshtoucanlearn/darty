import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('an actual Movement slide is a low challenge for the shared flick utility with no second host mover',()=>{
 const h=attackingHost(601),r=h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,actor=you[8],defender=opp[0];
  for(const [i,p] of you.entries())Object.assign(p,{x:M+30*sx,y:100+i*50});
  for(const [i,p] of opp.entries())Object.assign(p,{x:M+90*sx,y:100+i*50});
  Object.assign(actor,{x:M+65*sx,y:H/2,fx:1,fy:0,vx:0,vy:0,stun:0,skill:0});
  Object.assign(defender,{x:M+67.5*sx,y:H/2,fx:-1,fy:0,vx:-8*sx/60,vy:0,stun:0,slide:0});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,target:null,isShot:false});
  const Movement=window.FootballLegacyMovementEngineV2,
   world=Movement.createWorldState({tick:0,fixedTickSeconds:1/60,bounds:{xMin:0,xMax:105,yMin:-34,yMax:34},ballOwnerId:actor.id,
    players:[{id:actor.id,teamId:actor.team,position:{x:65,y:0},facing:{x:1,y:0},attributes:{control:85,balance:85}},
      {id:defender.id,teamId:defender.team,position:{x:67.5,y:0},velocity:{x:-8,y:0},facing:{x:-1,y:0},attributes:{pace:85,defending:80}}]}),
   result=Movement.advance(world,[{id:'real-slide',tick:1,playerId:defender.id,type:'slide-tackle',targetId:actor.id,direction:{x:-1,y:0}}],3),
   moved=result.state.players.find(p=>p.id===defender.id),projection={snapshotTick:3,movement:[{id:defender.id,
    x:M+moved.position.x*sx,y:H/2+moved.position.y*sy,vx:moved.velocity.x*sx/60,vy:moved.velocity.y*sy/60,
    fx:moved.facing.x,fy:moved.facing.y,stamina:moved.stamina,locomotionState:moved.locomotionState,action:moved.action}],
    logicalBallOwnerId:actor.id,movementBallOwnerId:actor.id,physicalBallSeparated:false,possession:{ownerId:actor.id},movementTelemetry:result.telemetry};
  liveV2ApplyMovement(projection);
  const heldUntil=defender.presentationActionUntil;liveV2ApplyMovement(projection);
  const snapshot=liveV2Snapshot(1),low=snapshot.players.find(p=>p.id===defender.id).lowChallenge,
    hostOwned=liveV2HostOwnsPlayer(defender),excluded=snapshot.dribbling.specialActionPlayerIds.includes(defender.id);
  const random=Math.random;Math.random=()=>0;let performed;try{performed=attemptFlickUp(actor,{x:1,y:0});}finally{Math.random=random;}
  return {performed,low,hostOwned,excluded,slide:defender.slide,v2Owned:defender.v2SlideOwned,
    holdUnchanged:heldUntil===defender.presentationActionUntil,modifier:skillTackleModifier(actor,defender),
    utility:actor.skillUtilityWindow&&{type:actor.skillUtilityWindow.type,success:actor.skillUtilityWindow.success},zv:ball.zv};
 })()`);
 assert.equal(r.v2Owned,true);assert.ok(r.slide>0);assert.equal(r.low,true);
 assert.equal(r.hostOwned,false,'the host cannot integrate the V2 slide twice');assert.equal(r.excluded,false,'its physical low body remains in V2');
 assert.equal(r.holdUnchanged,true,'the same action does not renew the presentation hold each frame');
 assert.equal(r.performed,true);assert.equal(r.utility.type,'flickUp');assert.equal(r.utility.success,true);assert.equal(r.modifier,.30);assert.ok(r.zv>0);
});
