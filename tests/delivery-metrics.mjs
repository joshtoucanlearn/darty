import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryMetrics} from '../tools/delivery-metrics.mjs';
test('out-of-play delivery counts use the actual laws terminal, with overlapping loft/run tags',()=>{
 const m=createDeliveryMetrics();m.event({type:'pass',team:'you',actorId:'a',time:0,loft:1,flightType:'long-pass'});
 m.event({type:'v2-pass-decision',reason:'release-newly-opened-run',time:0});
 m.event({type:'pass-resolved',completed:false,reason:'restart:throw-in',time:1500});
 const s=m.snapshot();assert.equal(s.passes.lofted.attempted,1);assert.equal(s.passes.lofted.out,1);assert.equal(s.passes.run.out,1);assert.equal(s.passes.ordinary?.attempted||0,0);
 m.event({type:'pass',team:'you',actorId:'b',flightType:'ground-pass',time:2000});
 assert.equal(m.snapshot().passes.ordinary.attempted,1,'a final unresolved launch is still an attempt');
});
test('clearance outcomes come from real possession or the goal/touch line, never the launch target',()=>{
 const m=createDeliveryMetrics();m.event({type:'clearance',actorId:'a',team:'you',time:0,trigger:'closing-pressure'});
 m.frame({time:100,live:true,physicalOwnerId:null,players:[]});assert.equal(m.snapshot().unresolvedClearance,true);
 m.frame({time:1000,live:true,physicalOwnerId:'b',players:[{id:'b',team:'you'}]});
 m.event({type:'clearance',actorId:'b',team:'you',time:2000,trigger:'box-pressure'});
 m.event({type:'shot',actorId:'c',team:'opp',time:3000});
 m.event({type:'clearance',actorId:'d',team:'opp',time:4000,trigger:'box-pressure'});
 m.event({type:'restart',kind:'THROW-IN',time:5000});
 const s=m.snapshot();assert.equal(s.clearances['closing-pressure'].own,1);assert.equal(s.clearances['box-pressure'].opponent,1);assert.equal(s.clearances['box-pressure'].out,1);
});
test('only a completed defender A to B to A to B chain counts as a repeated link',()=>{
 const m=createDeliveryMetrics();let time=0;
 for(const [a,b]of[['a','b'],['b','a'],['a','b'],['b','c']]){
  m.event({type:'pass',actorId:a,actorRole:'centre-back',team:'you',time});
  m.event({type:'pass-resolved',completed:true,receiverId:b,receiverTeam:'you',time:time+100});time+=1000;
 }
 assert.equal(m.snapshot().repeatedDefenderLinks,1);
});

test('out-of-play counters attribute the last physical action on every row',()=>{
 const m=createDeliveryMetrics();
 for(const [event,kind]of [[{type:'directional-knock-on'},'dribble-touch'],[{type:'pass'},'pass'],[{type:'pass',flightType:'cross'},'cross'],[{type:'shot'},'shot'],[{type:'clearance'},'clearance'],[{type:'involuntary-body-deflection'},'deflection'],[{type:'keeper-deflection'},'keeper']]){
  m.event({...event,time:100});m.event({type:'restart',kind:'THROW-IN',time:200});
  assert.equal(m.snapshot().outByLastAction[kind],1);
 }
 assert.equal(Object.values(m.snapshot().outByLastAction).reduce((a,b)=>a+b),7);
});

test('a headed pass and a physical boot deflection cannot be labelled as a dribble-out',()=>{
 const m=createDeliveryMetrics();m.event({type:'reception',time:0});m.event({type:'headed-pass',time:100});
 m.event({type:'restart',kind:'THROW-IN',time:300});assert.equal(m.snapshot().outByLastAction.pass,1);
 m.event({type:'reception',time:1000});m.event({type:'v2-slide-contact',ballWon:true,time:1200});
 m.frame({time:1250,live:true,players:[],boundaryContext:{x:51,y:33.8,knockOn:false,pressureM:2,action:'dribbleTouchChase'}});
 m.event({type:'restart',kind:'THROW-IN',time:1300});const r=m.snapshot();assert.equal(r.outByLastAction.deflection,1);assert.equal(r.outByLastAction['dribble-touch'],0);
 assert.equal(r.outEpisodes[1].context.y,33.8);
});
