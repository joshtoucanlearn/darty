import test from 'node:test';
import assert from 'node:assert/strict';
import { measureShotMotion } from '../tools/camera-motion-metrics.mjs';

function frames(acceleration=0){
  return Array.from({length:120},(_,i)=>{
    const t=i/30,x=(3*t+.5*acceleration*t*t)*32,yaw=(2*t+.5*acceleration*t*t)*Math.PI/180;
    return {x,y:400,z:1000,lx:x+Math.sin(yaw)*1000,ly:400,lz:1000-Math.cos(yaw)*1000,fov:45+t*.1};
  });
}
test('motion metrics report zero acceleration for constant translation, angular speed and zoom',()=>{
  const result=measureShotMotion(frames());
  for(const key of ['positionMetresPerSecondSquared','angularDegreesPerSecondSquared','fovDegreesPerSecondSquared'])assert.ok(result[key].peak<1e-7,JSON.stringify(result));
});
test('motion metrics recover known positional and angular acceleration with correct units',()=>{
  const result=measureShotMotion(frames(2));
  for(const key of ['positionMetresPerSecondSquared','angularDegreesPerSecondSquared'])for(const stat of ['peak','p95'])assert.ok(Math.abs(result[key][stat]-2)<1e-7,JSON.stringify(result));
});
