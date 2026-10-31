import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),CPU=require('../match-engine/cpu-intelligence-v2.js');
const p=(id,teamId,x,y,data={})=>({id,teamId,x,y,formationAnchor:{x,y},position:'CM',role:'midfielder',fx:teamId==='home'?1:-1,fy:0,pace:80,acceleration:80,awareness:80,defending:80,aggression:75,strength:80,balance:80,control:80,shooting:70,...data});
function situation(tick,{rating=80,speed=8,depth=45,ballGap=.8,side=.5}={}){
 const players=[p('challenger','home',depth-2.5,34+side,{vx:speed,vy:0,defending:rating,awareness:rating}),
  p('cover','home',depth-8,38,{position:'CDM',cpuControlled:false}),p('rest-a','home',10,15,{position:'CB',role:'centre-back'}),
  p('rest-b','home',10,53,{position:'CB',role:'centre-back'}),p('carrier','away',depth,34,{vx:2,control:85})];
 return {schema:CPU.SNAPSHOT_SCHEMA,tick,fixedTickSeconds:1/60,teamId:'home',possessionTeamId:'away',carrierId:'carrier',
  attackingDirection:1,offsideLine:80,pitch:{xMin:0,xMax:105,yMin:0,yMax:68},ball:{x:depth-ballGap,y:34},players};
}
function actions(options){const found=[];for(let tick=1;tick<720;tick+=12){
 const decision=CPU.decide(situation(tick,options),null,{minimumReactionTicks:0,maximumReactionTicks:0});
 for(const i of decision.defensiveIntents)if(i.physicalAction)found.push(i.physicalAction);
}return found;}
test('a sprinting recovery in midfield can choose a real slide, without a closing-speed ban',()=>{
 const rows=actions({speed:8,depth:45});assert.ok(rows.some(i=>i.type==='slide-tackle'),JSON.stringify(rows));
 assert.ok(rows.some(i=>i.type==='slide-tackle'&&i.relativeClosingSpeed>100));
 assert.ok(rows.every(i=>Math.hypot(i.direction.x,i.direction.y)>.99));
});
test('rated challenge frequency is continuous and low ratings still have an opportunity',()=>{
 const low=actions({rating:1}),middle=actions({rating:50}),high=actions({rating:99});
 assert.ok(low.length>0);assert.ok(high.length>=middle.length);assert.ok(middle.length>=low.length);
});
test('a defender faces the carrier and approaches a tighter real jockey window',()=>{
 const s=situation(100,{ballGap:.05,speed:0});s.players[0].x=s.players[4].x-2;
 const d=CPU.decide(s,null,{minimumReactionTicks:0,maximumReactionTicks:0});
 const press=d.defensiveIntents.find(i=>i.type==='press');assert.ok(press);
 assert.ok(Math.abs(press.target.x-s.players[4].x)<1.6,'the presser is not parked two metres away');
});


test('strong pressure permits both low and rising CPU strikes through the existing shot executor',()=>{
 const techniques=new Set();
 for(let i=0;i<160;i++){
  const carrier=p('finisher','home',87,34,{position:'ST',role:'striker',shooting:82,control:80,skillCooldownTicks:999}),
    defender=p('blocker','away',87.6,34,{committed:true}),s={schema:CPU.SNAPSHOT_SCHEMA,tick:1+i*24,fixedTickSeconds:1/60,
      teamId:'home',possessionTeamId:'home',carrierId:carrier.id,attackingDirection:1,offsideLine:104,
      pitch:{xMin:0,xMax:105,yMin:0,yMax:68},ball:{x:87,y:34},players:[carrier,defender]};
  const chosen=CPU.decide(s).carrierIntent;if(chosen.type==='shot')techniques.add(chosen.shotProfile.technique);
 }
 assert.ok(techniques.has('low-driven'));assert.ok(techniques.has('driven'),'a rushed shot can rise and inherit real pressure error');
});


test('a nearby covering defender reads a shooting lane while the primary keeps pressure',()=>{
 let read=false;
 for(let tick=1;tick<180;tick+=12){
  const players=[p('primary','home',13,34,{fx:1}),p('cover','home',11,36,{fx:1}),
    p('rest-a','home',2,15,{position:'CB',role:'centre-back'}),p('rest-b','home',2,53,{position:'CB',role:'centre-back'}),
    p('carrier','away',15,34,{position:'ST',role:'striker',shooting:90,fx:-1})],
    s={schema:CPU.SNAPSHOT_SCHEMA,tick,fixedTickSeconds:1/60,teamId:'home',possessionTeamId:'away',carrierId:'carrier',
      attackingDirection:1,offsideLine:80,pitch:{xMin:0,xMax:105,yMin:0,yMax:68},ball:{x:15,y:34},players};
  const d=CPU.decide(s,null,{minimumReactionTicks:0,maximumReactionTicks:0}),block=d.defensiveIntents.find(i=>i.type==='shot-block');
  if(block){read=true;assert.equal(block.purpose,'shot');assert.ok(block.target.x<15);assert.ok(d.defensiveIntents.some(i=>i.type==='press'&&i.playerId!==block.playerId));}
 }
 assert.ok(read,'the pre-kick shooting-lane read is a real V2 option');
});
