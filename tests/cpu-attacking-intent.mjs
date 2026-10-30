import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js'),Ball=require('../match-engine/ball-engine-v2.js');
function fixture(dir=1,rating=80) {
 const p=(id,teamId,x,y,position,extra={})=>({id,teamId,x:dir===1?x:105-x,y,position,formationAnchor:{x:dir===1?x:105-x,y},
   fx:dir,fy:0,vx:0,vy:0,pace:rating,control:rating,passing:rating,shooting:rating,awareness:rating,agility:rating,...extra});
 return {tick:1,fixedTickSeconds:1/60,teamId:'you',possessionTeamId:'you',carrierId:'carrier',attackingDirection:dir,offsideLine:dir===1?53:52,
  pitch:{xMin:0,xMax:105,yMin:-34,yMax:34},ball:{x:dir===1?35:70,y:0},players:[p('carrier','you',25,0,'CM'),
   p('runner','you',49,5,'ST',{vx:dir*6}),p('rest-a','you',18,-10,'CB'),p('rest-b','you',18,10,'CB'),
   p('line-a','opp',53,-5,'CB'),p('line-b','opp',52,14,'CB'),p('keeper','opp',101,0,'GK',{isGK:true})]};
}
test('a moving, goal-facing, onside runner behind a high line gets first service at every rating and direction',()=>{
 for(const dir of [1,-1])for(const rating of [1,50,99]){
  const s=fixture(dir,rating),i=CPU.decide(s,null,{maximumCommittedRuns:0}).carrierIntent;
  assert.equal(i.type,'pass');assert.equal(i.targetPlayerId,'runner');assert.equal(i.supportKind,'in-behind');
  assert.ok(dir*(i.target.x-s.offsideLine)>2);assert.equal(i.flightType,'long-pass');
 }
});
test('a stationary, wrong-facing or offside forward cannot masquerade as a ready runner behind a high line',()=>{
 for(const patch of [{vx:0},{fx:-1},{x:56}]){
  const s=fixture();Object.assign(s.players[1],patch);
  assert.notEqual(CPU.decide(s,null,{maximumCommittedRuns:0}).carrierIntent.supportKind,'in-behind');
 }
});
function crossing(plan,dir) {
 let state=Ball.createBallState({id:'save',position:plan.position,velocity:plan.velocity,grounded:false}),context=Ball.createSimulationContext({seed:1});
 for(let i=0;i<200;i++){const r=Ball.step(state,context,1/60,{colliders:Ball.createGoalFrame({id:'tip-frame',leftPostBase:{x:dir===1?105:0,y:-3.66,z:0},rightPostBase:{x:dir===1?105:0,y:3.66,z:0}})});state=r.state;context=r.context;
  if(dir*(state.position.x-(dir===1?105:0))>=0)return state;}
 throw new Error('deflection did not cross goal line '+JSON.stringify({dir,plan,last:state.position}));
}
test('fingertip contacts keep pace and physically clear the bar or post in the shared ball engine',()=>{
 for(const dir of [1,-1])for(const rating of [1,50,99])for(const high of [true,false])for(const gap of [.5,2,6]){
  const input={position:{x:dir===1?105-gap:gap,y:high?0:3.45,z:high?2.3:1.1},velocity:{x:dir*25,y:high?0:2,z:high?1:0},
   keeper:{x:dir===1?102.5:2.5,y:0},goalDirection:dir,rating,contactEdge:.98,contactQuality:.4};
  const p=CPU.keeperDeflectionPlan(input),s=crossing(p,dir);
  assert.equal(p.kind,high?'tip-over':'tip-round');assert.equal(p.fingertips,true);
  assert.ok(Math.hypot(p.velocity.x,p.velocity.y,p.velocity.z)>=Math.hypot(input.velocity.x,input.velocity.y,input.velocity.z)*.8);
  if(high)assert.ok(s.position.z>2.61,JSON.stringify(s.position));else assert.ok(Math.abs(s.position.y)>3.83,JSON.stringify(s.position));
 }
});
test('strong wide contacts and poor central contacts have different physical exits with continuous rating quality',()=>{
 const input={position:{x:100,y:2.8,z:1},velocity:{x:24,y:3,z:0},keeper:{x:100,y:0},goalDirection:1,rating:80,contactEdge:.4,contactQuality:.8};
 const wide=CPU.keeperDeflectionPlan(input);assert.equal(wide.kind,'parry-wide');assert.ok(wide.velocity.y>0);
 const danger=CPU.keeperDeflectionPlan({...input,position:{x:100,y:0,z:.4},rating:1,contactQuality:0});
 assert.equal(danger.kind,'parry-danger');assert.ok(danger.velocity.x<0);
 for(const rating of [1,30,60,99])assert.ok(CPU.keeperDeflectionPlan({...input,rating}).quality>0);
});
