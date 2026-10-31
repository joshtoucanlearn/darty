// Joshua asked for these human faults to be checked and handed to Joe, not fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const scene=`${liveScene}
 const sx=(W-2*M)/105,sy=H/68;
 const place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
 for(const [i,p]of you.entries())place(p,25,-28+i*3);
 for(const [i,p]of opp.entries())place(p,90,-28+i*3);
 const actor=you[8],defender=opp[0];place(actor,60,0);place(defender,62,0);
 controlled=actor;Object.assign(actor,{skillUtilityWindow:null,skillStartFx:1,skillStartFy:0});
 Object.assign(ball,{owner:actor,x:actor.x+rad,y:actor.y,z:0,vx:0,vy:0,zv:0,kickerLock:0,target:null});
 Object.assign(gamepadInput,{moveX:0,moveY:0,moveMagnitude:0,sprint:false,previousButtons:[]});
 window.__skillActor=actor;window.__skillDefender=defender;
`;
const sample=h=>h.scenario(`(()=>{const p=window.__skillActor,d=window.__skillDefender;return {x:p.x,y:p.y,fx:p.fx,fy:p.fy,bx:ball.x,by:ball.y,bz:ball.z,type:p.skillType,utility:p.skillUtilityWindow&&{type:p.skillUtilityWindow.type,success:p.skillUtilityWindow.success},modifier:skillTackleModifier(p,d),stun:d.stun,authority:liveV2AuthorityTelemetry()};})()`);

for(const move of ['stepover','roulette'])test(`human primary ${move} has body motion but its accepted utility is still missing (handoff characterization)`,()=>{
 const h=attackingHost(151,{humanInput:true});
 h.scenario(`(()=>{${scene}qTapAt=-Infinity;controllerSkill();${move==='roulette'?'controllerSkill();':''}})()`);
 const start=sample(h);assert.equal(start.type,move);
 for(let i=0;i<8;i++)h.step();
 const end=sample(h),distance=Math.hypot(end.x-start.x,end.y-start.y)/30.25;
 assert.ok(distance>.08,JSON.stringify({move,distance,end}));
 assert.ok(Math.abs(end.fy)>(move==='roulette'?.7:.03),JSON.stringify(end));
 assert.equal(end.utility,null,'known primary doSkill route never calls primeSkillUtility; intentionally left for Joe');
 assert.equal(end.modifier,1);assert.equal(h.state().authority.failureCode,null);
 console.log('SCRIPTED_HUMAN_SKILL_CHARACTERIZATION',JSON.stringify({move,bodyMovedM:distance,ballMovedM:Math.hypot(end.bx-start.bx,end.by-start.by)/30.25,utilityWindow:false,tackleModifier:end.modifier,unfixedPerInstruction:true}));
});

test('human R3 without L3 executes the shared flick-up and low-challenge utility once while held',()=>{
 const h=attackingHost(152,{humanInput:true});
 const start=h.scenario(`(()=>{${scene}
  defender.slide=12;defender.slideDuration=30;defender.action='slideTackle';
  window.__r3Pad={index:0,mapping:'standard',id:'Fixture pad',axes:[1,0,0,0],buttons:Array.from({length:18},(_,i)=>({pressed:i===11,value:i===11?1:0}))};
  const random=Math.random;Math.random=()=>0;
  try{pollBoundPad(gamepadInput,window.__r3Pad,false);}finally{Math.random=random;}
  return {utility:actor.skillUtilityWindow&&{type:actor.skillUtilityWindow.type,success:actor.skillUtilityWindow.success,lowChallenge:actor.skillUtilityWindow.lowChallenge},modifier:skillTackleModifier(actor,defender),lift:ball.zv};
 })()`);
 assert.equal(start.utility?.type,'flickUp');assert.equal(start.utility.success,true);assert.equal(start.utility.lowChallenge,true);
 assert.equal(start.modifier,.30);assert.ok(start.lift>0);
 let maximumHeight=0;
 for(let i=0;i<12;i++){h.scenario('pollBoundPad(gamepadInput,window.__r3Pad,false)');h.step();maximumHeight=Math.max(maximumHeight,sample(h).bz/30);}
 assert.ok(maximumHeight>.8,JSON.stringify({maximumHeight,state:h.state().ball}));
 assert.equal(h.state().actions.skills['flick-up'],1,'held R3 is a single input edge');
 assert.equal(h.state().authority.failureCode,null);
 console.log('SCRIPTED_HUMAN_SKILL_CHARACTERIZATION',JSON.stringify({move:'R3 flick-up',maximumHeightM:maximumHeight,lowChallengeUtility:true,tackleModifier:start.modifier}));
});

test('human L2 plus right-stick step-over beat waits for a real left-stick exit and primes the accepted utility',()=>{
 const h=attackingHost(153,{humanInput:true});
 const start=h.scenario(`(()=>{${scene}
  place(defender,68,0);
  window.__chainPad={index:0,connected:true,mapping:'standard',id:'Fixture pad',axes:[0,0,0,-1],buttons:Array.from({length:18},(_,i)=>({pressed:i===6,value:i===6?1:0}))};
  navigator.getGamepads=()=>[window.__chainPad];
  pollBoundPad(gamepadInput,window.__chainPad,false);
  return {type:actor.skillType,chain:gamepadInput.stepoverChainCount,x:actor.x,y:actor.y};
 })()`);
 assert.equal(start.type,'stepoverBeat');assert.equal(start.chain,1);
 h.scenario('window.__chainPad.axes=[0,0,0,0];window.__chainPad.buttons[6]={pressed:false,value:0};pollBoundPad(gamepadInput,window.__chainPad,false)');
 for(let i=0;i<28;i++){h.scenario('pollBoundPad(gamepadInput,window.__chainPad,false)');h.step();}
 const waiting=h.scenario('({awaiting:gamepadInput.stepoverAwaitingExit,utility:window.__skillActor.skillUtilityWindow})');
 assert.equal(waiting.awaiting,true,JSON.stringify(waiting));assert.equal(waiting.utility,null,'beats alone do not claim the final deception');
 const exit=h.scenario(`(()=>{const actor=window.__skillActor,defender=window.__skillDefender;Object.assign(defender,{x:actor.x+2*(W-2*M)/105,y:actor.y,vx:0,vy:0});window.__chainPad.axes=[.8,-.6,0,0];const random=Math.random;Math.random=()=>0;
  try{pollBoundPad(gamepadInput,window.__chainPad,false);}finally{Math.random=random;}
  const p=window.__skillActor,d=window.__skillDefender;return {type:p.skillType,utility:p.skillUtilityWindow?.type,modifier:skillTackleModifier(p,d),fx:p.fx,fy:p.fy};
 })()`);
 assert.equal(exit.type,'stepoverExit');assert.equal(exit.utility,'stepover');assert.equal(exit.modifier,.46);
 assert.ok(exit.fx>.5&&exit.fy<-.4);
 for(let i=0;i<6;i++)h.step();
 const end=sample(h);assert.ok(Math.hypot(end.x-start.x,end.y-start.y)/30.25>.1);
 assert.equal(h.state().authority.failureCode,null);
 console.log('SCRIPTED_HUMAN_SKILL_CHARACTERIZATION',JSON.stringify({move:'L2 right-stick beat then left-stick exit',utilityWindow:true,tackleModifier:exit.modifier,physicalExit:true}));
});
