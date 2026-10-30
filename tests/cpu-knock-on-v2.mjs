import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js');
const source=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const W=Math.round(3200*1.045),H=Math.round(2050*1.045),M=Math.round(80*1.045);
const metres=(x,y)=>Math.hypot(x/((W-2*M)/105),y/(H/68));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const speed=(v,x=1,y=0)=>v/(60*metres(x/(Math.hypot(x,y)||1),y/(Math.hypot(x,y)||1)));
const plan=source.slice(source.indexOf('  const DIRECTIONAL_KNOCK_ON_FORWARD_COS'),source.indexOf('  function directionalKnockOnRecoveryDecision'));
const launch=source.slice(source.indexOf('  function liveV2LaunchDribbleKnockOn('),source.indexOf('  function liveV2ApplyIntelligence('));
test('CPU light, strong and double strikes delegate to the exact accepted tier planner without a chase boost',()=>{
 for(const [tier,distance] of [['light',3.4],['strong',5.5],['double',8.5]])for(const control of [1,50,99]){
  const actor={id:'carrier',team:'you',x:1000,y:1000,vx:speed(8.8),vy:0,fx:1,fy:0,attrs:{control,pace:84}};
  let actual,executions=0;const before=[actor.vx,actor.vy];
  const ctx=vm.createContext({clamp,rad:12.75,worldDistanceMetres:metres,worldBallSpeedForMetresPerSecond:speed,
   facing:p=>({x:p.fx,y:p.fy}),logEvent:(type,team,p,extra)=>{actual=extra;},
   performDirectionalKnockOn:(p,stick,isSecond,state,options)=>{executions++;return true;}});
  vm.runInContext(plan+'\n'+launch+';this.launch=liveV2LaunchDribbleKnockOn;',ctx);
  assert.equal(ctx.launch(actor,{dribbleId:tier,target:{x:1400,y:1000},maneuver:{knockOnTier:tier,startedTick:1}}),true);
  assert.equal(executions,1);assert.equal(actual.tier,tier);assert.equal(actual.touchDistanceMetres,distance);
  assert.deepEqual([actor.vx,actor.vy],before);
 }
});
test('CPU chooses tiers from space and rated execution quality, and waits for the accepted real sprint geometry',()=>{
 const choices=[];
 for(const x of [50,70,80,85,90,98]){
  const p=(id,teamId,px,py,position)=>({id,teamId,x:px,y:py,position,formationAnchor:{x:px,y:py},control:80,agility:80,pace:80,passing:75,shooting:50,committed:teamId==='opp'});
  const s={tick:1,fixedTickSeconds:1/60,teamId:'you',possessionTeamId:'you',carrierId:'carrier',attackingDirection:1,
   offsideLine:104,pitch:{xMin:0,xMax:105,yMin:0,yMax:68},ball:{x,y:34},players:[p('carrier','you',x,34,'ST'),p('rest1','you',10,10,'CB'),p('rest2','you',10,58,'CB'),p('marker','opp',x+2.6,34,'CM')]};
  const intent=CPU.decide(s).carrierIntent;assert.equal(intent.type,'take-on');choices.push(intent.knockOnTier);
 }
 assert.deepEqual(new Set(choices),new Set(['light','strong','double']));
});
