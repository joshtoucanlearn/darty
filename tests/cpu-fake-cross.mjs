import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js');
test('a wide CPU reads a cross blocker and executes the accepted fake-shot utility with a real exit',()=>{
 const p=(id,teamId,x,y,position,extra={})=>({id,teamId,x,y,position,role:position,vx:0,vy:0,fx:teamId==='home'?1:-1,fy:0,
   pace:90,acceleration:90,awareness:90,shooting:85,control:92,passing:90,agility:92,defending:85,available:true,...extra});
 const players=[p('wing','home',96,24,'RW'),p('runner','home',94,0,'ST'),p('home-left','home',50,-12,'CB'),p('home-right','home',50,12,'CB'),
  p('blocker','away',97,22,'LB',{blockPurpose:'cross'}),p('away-left','away',99,-4,'CB'),p('away-right','away',99,4,'CB'),p('keeper','away',104,0,'GK',{isGK:true})];
 let decision;
 for(let tick=1;tick<61;tick++){
  decision=CPU.decide({tick,fixedTickSeconds:1/60,teamId:'home',possessionTeamId:'home',carrierId:'wing',attackingDirection:1,
   offsideLine:99,pitch:{xMin:0,xMax:105,yMin:-34,yMax:34},ball:{x:96,y:24},players});
  if(decision.carrierIntent.reason==='fake-cross-draws-pass-block')break;
 }
 const choice=decision.carrierIntent;assert.equal(choice.reason,'fake-cross-draws-pass-block',JSON.stringify(choice));
 assert.equal(choice.skill,'fake-shot');assert.ok(['outside-byline','inside'].includes(choice.exitLane));
 const continued=CPU.decide({tick:choice.startedTick+26,fixedTickSeconds:1/60,teamId:'home',possessionTeamId:'home',carrierId:'wing',attackingDirection:1,
   offsideLine:99,pitch:{xMin:0,xMax:105,yMin:-34,yMax:34},ball:{x:96,y:24},players},decision.memory);
 assert.equal(continued.carrierIntent.dribbleId,choice.dribbleId,'a crossing choice must not interrupt the committed fake exit');
 assert.equal(continued.carrierIntent.phase,'burst');
 assert.deepEqual(continued.carrierIntent.target,choice.target);

 const h=attackingHost(331);
 const result=h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,actor=you[8],defender=opp[0];
  for(const p of opp)Object.assign(p,{x:M+65*sx,y:60});
  Object.assign(actor,{x:M+96*sx,y:H/2+24*sy,fx:1,fy:0});
  Object.assign(defender,{x:M+97*sx,y:H/2+22*sy,fx:-1,fy:0,action:'shotBlock',slide:0,lunge:0});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0});
  const saved=Math.random;Math.random=()=>0;
  try{liveV2ApplyCpuTouches({intelligence:[{playerId:actor.id,type:'take-on',target:{x:M+${choice.target.x}*sx,y:H/2+${choice.target.y}*sy},dribbleId:'real-fake-cross',
    maneuver:{skill:'fake-shot',phase:'feint',situation:'fake-cross',defenderId:defender.id}}]});}finally{Math.random=saved;}
  return {skill:actor.skillType,utility:actor.skillUtilityWindow?.type,success:actor.skillUtilityWindow?.success,modifier:skillTackleModifier(actor,defender),exit:actor.v2SkillExitTarget,stun:defender.stun};
 })()`);
 assert.equal(result.skill,'fakeShot');assert.equal(result.utility,'fakeShot');assert.equal(result.success,true);
 assert.equal(result.modifier,.52);assert.ok(result.stun>0);assert.ok(result.exit);
});

test('the normal human fake path recognizes a real V2 cross read and records the fake-cross attempt',()=>{
 const h=attackingHost(332,{humanInput:true});
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,actor=you[8],defender=opp[0];controlled=actor;
  for(const [i,p]of you.entries())Object.assign(p,{x:M+40*sx,y:100+i*60});
  for(const [i,p]of opp.entries())Object.assign(p,{x:M+70*sx,y:100+i*60});
  Object.assign(actor,{x:M+96*sx,y:H/2+24*sy,fx:1,fy:0});
  Object.assign(defender,{x:M+97*sx,y:H/2+22*sy,fx:-1,fy:0});Object.assign(defender.attrs,{defend:99,awareness:99});
  Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,target:null});
  const api=window.FootballLegacyLiveV2Authority,base=window.FootballLegacyCPUIntelligenceV2,
    cpu={...base,decide(s,m,c){const d=base.decide(s,m,c);return {...d,
      carrierIntent:s.teamId===s.possessionTeamId?{type:'protect',target:{x:s.ball.x,y:s.ball.y},confidence:1,reason:'fixture-holds-for-cross-read'}:d.carrierIntent,
      defensiveIntents:d.defensiveIntents.filter(i=>i.type==='cross-block')};}},
    capability=api.createCapability({acknowledgement:api.ACKNOWLEDGEMENT,workflow:'single-player',online:false,onlineMarkers:{}});
  liveV2Authority=api.createAttachment({enabled:true,capability,seed:332,dependencies:{cpu},host:{prepareTick:liveV2PrepareHostTick}});
 })()`);
 for(let i=0;i<3;i++)h.step();
 const result=h.scenario(`(()=>{const actor=you[8],defender=opp[0],read=liveV2Authority.status().lastCpuDecision.opp.defensiveIntents.find(i=>i.type==='cross-block');
  const random=Math.random;Math.random=()=>0;try{performFakeShot(actor,{buttonActions:{},moveX:.8,moveY:.6},true);}finally{Math.random=random;}
  keys['arrowright']=true;keys['arrowdown']=true;return {read:!!read,event:report.events.filter(e=>e.type==='skill').at(-1),utility:actor.skillUtilityWindow?.success};})()`);
 assert.equal(result.read,true,JSON.stringify(result));assert.equal(result.event.fakeCross,true,JSON.stringify(result));
 assert.equal(h.state().attack.counts.fakeCrossesTried,1);assert.equal(result.utility,true);
 for(let i=0;i<40;i++)h.step();
 const outcome=h.scenario('({x:(you[8].x-M)*105/(W-2*M),y:(you[8].y-H/2)*68/H,defenderX:(opp[0].x-M)*105/(W-2*M)})');
 console.log('SCRIPTED_FAKE_CROSS_EXIT',JSON.stringify({outcome,counts:h.state().attack.counts.fakeCrossesBeaten}));
 assert.equal(h.state().attack.counts.fakeCrossesBeaten,1,JSON.stringify(outcome));
});
