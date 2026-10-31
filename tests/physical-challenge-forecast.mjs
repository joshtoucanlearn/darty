import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),M=require('../match-engine/movement-engine-v2.js'),A=require('../match-engine/live-v2-authority-adapter.js');
for(const type of ['stand-tackle','slide-tackle'])test(type+' forecast meets the same visible boot and ball as the real action',()=>{
 const slide=type==='slide-tackle',actor=M.createPlayerState({id:'defender',teamId:'home',position:{x:0,y:0},velocity:{x:slide?8:4,y:0},facing:{x:1,y:0},contactRig:M.createContactRig(),attributes:{defending:99,strength:99,aggression:99,acceleration:99}}),
 target=M.createPlayerState({id:'carrier',teamId:'away',position:{x:slide?2.3:1.2,y:0},contactRig:M.createContactRig(),attributes:{control:1,balance:1,strength:1}}),
 ball={x:slide?.9:.58,y:.10,z:.11},samples=Array.from({length:17},()=>({...ball})),before=JSON.stringify({actor,target,samples}),
 plan=M.forecastPhysicalChallenge({actor,target,type,ballSamples:samples},A.LIVE_MOVEMENT_CONTACT_CONFIG);
 assert.ok(plan.clean,JSON.stringify(plan));assert.equal(JSON.stringify({actor,target,samples}),before,'the read cannot move players or ball');
 let world=M.createWorldState({ballOwnerId:target.id,players:[actor,target]}),hit;
 for(let tick=1;tick<17&&!hit;tick++){
  const r=M.advance(world,tick===1?[{id:'forecast-execution',playerId:actor.id,tick:1,type,targetId:target.id,direction:plan.direction}]:[],1,A.LIVE_MOVEMENT_CONTACT_CONFIG,
   {position:ball,velocity:{x:0,y:0,z:0},radius:.11});world=r.state;hit=r.telemetry.contacts.find(c=>c.ballWon);
 }
 assert.ok(hit);assert.equal(hit.contactPart,'boot-to-ball');assert.ok(hit.visibleGapMetres<1e-8);
});
test('a moving ball outside the boot window does not inherit the abstract slide reach',()=>{
 const actor=M.createPlayerState({id:'defender',teamId:'home',position:{x:0,y:0},velocity:{x:7,y:0},facing:{x:1,y:0},contactRig:M.createContactRig()}),
 target=M.createPlayerState({id:'carrier',teamId:'away',position:{x:3,y:0},velocity:{x:6,y:0},contactRig:M.createContactRig()}),
 samples=Array.from({length:17},(_,t)=>({x:3.6+6*t/60,y:0,z:.11})),plan=M.forecastPhysicalChallenge({actor,target,type:'slide-tackle',ballSamples:samples},A.LIVE_MOVEMENT_CONTACT_CONFIG);
 assert.equal(plan.clean,false);assert.equal(plan.ballTick,null);assert.ok(plan.closestGapMetres>.5);
});
test('a real running shoulder contest preserves pursuit and reception without a tackle hold',()=>{
 const h=attackingHost(711),r=h.scenario(`(()=>{${liveScene}
  const a=you[0],b=opp[0];Object.assign(a,{stun:0,receiveT:0});Object.assign(b,{stun:0,receiveT:0});clearContactPresentation(a);clearContactPresentation(b);
  const c={type:'shoulder-contact',racePursuit:true,bodyContact:true,approachSpeedMps:.8,normal:{x:0,y:1,z:0},point:{x:40,y:0,z:1},ballFirst:false};
  stageAutonomousContactPresentation(a,b,c.type,c);
  return {aStun:a.stun,bStun:b.stun,aReceive:a.receiveT,bReceive:b.receiveT,aHold:!!a.contactHold,bHold:!!b.contactHold};
 })()`);
 assert.equal(r.aStun,0);assert.equal(r.bStun,0);assert.equal(r.aReceive,0);assert.equal(r.bReceive,0);assert.equal(r.aHold,false);assert.equal(r.bHold,false);
});

// Oracle copied from the accepted host solely to prove identical human/CPU
// owned-ball touch arithmetic after moving the live implementation into V2.
test('V2 owned touch path preserves the accepted host arithmetic through receiving, turning and both feet',()=>{
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const oracle=(o,ball,env)=>{const {clockFrames,rad,unitsPerMetre:PITCH_UNITS_PER_METRE,ballRadius:BALLR}=env,fd=Math.hypot(o.fx,o.fy)||1,speed=Math.hypot(o.vx,o.vy),trueFeelControlledCarry=o.dribbleOutcome==='controlled-carry';
        const firstTouch=o.firstTouch&&o.firstTouch.until>clockFrames?o.firstTouch:null,firstProgress=firstTouch?clamp((clockFrames-firstTouch.startedAt)/Math.max(1,firstTouch.duration),0,1):1,touch=trueFeelControlledCarry&&!firstTouch?0:Math.max(0,Math.sin(o.touchPhase))*8,firstSeparation=firstTouch?firstTouch.separation*Math.sin(firstProgress*Math.PI):0,anchorX=firstTouch?firstTouch.outX:o.fx/fd,anchorY=firstTouch?firstTouch.outY:o.fy/fd,controlledSeparation=trueFeelControlledCarry&&!firstTouch?clamp((Number(o.dribbleTargetSeparation)||.58)*PITCH_UNITS_PER_METRE,rad+BALLR+1,rad+BALLR+24):0,ahead=controlledSeparation||rad+7+speed*1.7+touch+firstSeparation,footSide=trueFeelControlledCarry&&!firstTouch?(o.dribbleFoot==='left'?-1:o.dribbleFoot==='right'?1:0):0,lateral=footSide*PITCH_UNITS_PER_METRE*.075,tx=o.x+anchorX*ahead-anchorY*lateral,ty=o.y+anchorY*ahead+anchorX*lateral;
        ball.x+=(tx-ball.x)*.62;ball.y+=(ty-ball.y)*.62;ball.z=0;ball.vx=o.vx;ball.vy=o.vy;ball.zv=0;

 return ball;};
 for(const controlled of [false,true])for(const foot of ['left','right',null])for(const phase of [0,.8,2.4,5])for(const receiving of [false,true]){
  const env={clockFrames:100,rad:12.75,unitsPerMetre:31.323529411765,ballRadius:3.5},p={x:1000,y:800,fx:.6,fy:.8,vx:2.4,vy:-1.1,touchPhase:phase,dribbleOutcome:controlled?'controlled-carry':'secured',dribbleTargetSeparation:.64,dribbleFoot:foot,firstTouch:receiving?{until:110,startedAt:94,duration:16,separation:11,outX:-.8,outY:.6}:null},ball={x:990,y:805,z:0};
  const original=oracle(p,{...ball},env),moved=A.ownedCarryAnchorPlan(p,ball,env);assert.deepEqual(moved,original);
  assert.equal(A.ownedCarryPhase(p),(p.touchPhase||0)+Math.hypot(p.vx,p.vy)*(controlled?.035:.22));
 }
});
