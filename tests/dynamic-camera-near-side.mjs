import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('the restored dynamic camera stays in front of the moved-back near stand at both touchlines',()=>{
 const h=attackingHost(219),result=h.scenario(`(()=>{${liveScene}
  cameraMode='dynamic';cameraRecoveryUntil=0;const rows=[];
  for(const y of[H*.015,H*.5,H*.985]){const actor=you[0];actor.x=W*.5;actor.y=y;
   Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,isShot:false});camLookX=worldX(ball.x);camLookZ=worldZ(ball.y);
   for(let i=0;i<160;i++)camFollow();camera.updateMatrixWorld(true);
   rows.push({camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},fov:camera.fov,frontSeats:H/2+66+STADIUM_NEAR_SETBACK});}
  return rows;})()`);
 for(const row of result){assert.ok(row.camera.z<row.frontSeats-50,JSON.stringify(row));assert.ok(Math.abs(row.camera.y-345)<.1);assert.ok(Math.abs(row.fov-45)<.001);}
});
test('only the near stand is set back; train/roof separation remains above the far roof',()=>{
 const h=attackingHost(220),r=h.scenario(`({setback:STADIUM_NEAR_SETBACK,pitch:{W,H,M},deckClearance:150-64})`);
 assert.equal(r.setback,560);assert.equal(r.deckClearance,86);assert.ok(r.pitch.W>3000&&r.pitch.H>2000);
});
