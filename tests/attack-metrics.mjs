import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttackMetrics} from '../tools/attack-metrics.mjs';
test('backward and own-third safety counters work entirely from release, control and shot events',()=>{
 const m=createAttackMetrics();
 m.event({type:'pass',team:'you',actorProgress:.2,passProgressM:-8,time:0});
 m.event({type:'pass-resolved',completed:true,receiverTeam:'you',receiverProgress:.15,time:500});
 m.event({type:'pass',team:'you',actorProgress:.15,passProgressM:0,time:1000});
 m.event({type:'pass-resolved',completed:false,receiverTeam:'opp',receiverRole:'striker',receiverProgress:.85,time:1500});
 m.event({type:'possession-gained',team:'opp',actorProgress:.85,time:1501});
 m.event({type:'shot',team:'opp',time:2500});m.event({type:'shot',team:'opp',time:3000});
 let c=m.snapshot().counts;
 assert.equal(c.backwardPasses,1);assert.equal(c.backwardCompleted,1);
 assert.equal(c.defensiveThirdPasses,2);assert.equal(c.defensiveThirdCompleted,1);
 assert.equal(c.ownThirdTurnovers,1);assert.equal(c.ownThirdPassTurnovers,1);
 assert.equal(c.ownThirdTurnoversToShot,1);assert.equal(c.backwardSquareInterceptedByAttacker,1);
 assert.equal(c.ownThirdBackwardSquareInterceptedByAttacker,1);
 m.event({type:'possession-gained',team:'you',actorProgress:.2,time:4000});
 m.event({type:'possession-gained',team:'opp',actorProgress:.8,time:5000});
 m.event({type:'shot',team:'opp',time:15001});
 assert.equal(m.snapshot().counts.ownThirdTurnovers,2);
 assert.equal(m.snapshot().counts.ownThirdTurnoversToShot,1,'a shot outside ten seconds is excluded');
});
test('passing counts use actual releases, physical receiver movement and distinct on-ball contacts',()=>{
 const m=createAttackMetrics();
 for(let i=0;i<=60;i++)m.frame({time:i*1000/60,live:true,ownerId:'a',players:[{id:'a',team:'you',x:20,y:0,touches:0},{id:'b',team:'you',x:25+i/60*2,y:0,touches:0}]});
 m.event({type:'v2-dribble-state',actorId:'a',touchSequence:1,animationPhase:'dribble-contact',time:300});
 m.event({type:'v2-dribble-state',actorId:'a',touchSequence:1,animationPhase:'dribble-contact',time:400});
 m.event({type:'pass',actorId:'a',team:'you',passProgressM:12,behindLineM:5,flightType:'long-pass',time:1000});
 m.event({type:'pass-resolved',receiverId:'b',completed:true,time:1000});
 m.event({type:'shot',team:'you',time:2000});
 const r=m.snapshot();assert.equal(r.counts.progressivePasses,1);assert.equal(r.counts.inBehindCompleted,1);assert.equal(r.counts.overTopToShot,1);
 assert.equal(r.averageTouchesBeforePass,2);assert.equal(r.averageSecondsBeforePass,1);assert.ok(Math.abs(r.averageReceiverMovementM-2)<1e-9);
});
test('save-to-corner replays count a direct save corner once; subsequent player control clears that attribution',()=>{
 const m=createAttackMetrics();m.event({type:'shot',team:'you',time:0});m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:300});
 m.event({type:'restart',team:'you',kind:'CORNER',time:12000});assert.equal(m.snapshot().counts.cornersFromSaves,1);
 m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:13000});
 m.frame({live:true,time:14000,ownerId:'def',players:[{id:'def',team:'opp',x:0,y:0,touches:1}]});
 m.event({type:'restart',team:'you',kind:'CORNER',time:15000});assert.equal(m.snapshot().counts.cornersFromSaves,1);
});
test('a rebound shot needs an actual keeper/woodwork contact in the same attacking sequence',()=>{
 const m=createAttackMetrics();m.event({type:'shot',team:'you',time:0});m.event({type:'shot',team:'you',time:500});assert.equal(m.snapshot().counts.reboundShots,0);
 m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:600});m.event({type:'shot',team:'you',time:1000});assert.equal(m.snapshot().counts.reboundShots,1);
 m.event({type:'woodwork',time:1100});m.frame({live:true,time:1150,ownerId:'def',players:[{id:'def',team:'opp',x:0,y:0,touches:1}]});
 m.event({type:'shot',team:'you',time:1200});assert.equal(m.snapshot().counts.reboundShots,1);
});

test('receiver motion is sampled before first physical contact, excluding a later directional receiving roll',()=>{
 const m=createAttackMetrics();m.event({type:'pass',actorId:'a',targetId:'b',team:'you',time:0,flightType:'ground-pass'});
 for(let i=0;i<=60;i++)m.frame({time:i*1000/60,live:true,ownerId:null,players:[{id:'b',team:'you',x:i/60*.5,y:0}]});
 m.event({type:'reception',actorId:'b',team:'you',intent:'directional-touch',time:1000});
 for(let i=61;i<=120;i++)m.frame({time:i*1000/60,live:true,ownerId:null,players:[{id:'b',team:'you',x:.5+(i-60)/60*10,y:0}]});
 m.event({type:'pass-resolved',completed:true,receiverId:'b',time:2000});
 assert.ok(Math.abs(m.snapshot().averageReceiverMovementM-.5)<1e-9);
});
test('an actual first-time layoff contributes one touch and zero holding time',()=>{
 const m=createAttackMetrics();m.event({type:'reception',actorId:'b',team:'you',time:1000});
 m.event({type:'pass',actorId:'b',team:'you',authority:'cpu-v2-first-time',time:1000});
 assert.equal(m.snapshot().averageTouchesBeforePass,1);assert.equal(m.snapshot().averageSecondsBeforePass,0);
});

test('a completed ball in behind can lead to a shot through an extra same-team pass, credited once',()=>{
 const m=createAttackMetrics(),pass=(actorId,team,time,behindLineM,completed=true)=>{
  m.event({type:'pass',actorId,team,time,passProgressM:8,behindLineM,flightType:'long-pass',loft:2});
  m.event({type:'pass-resolved',completed,receiverId:'receiver',time:time+100});};
 pass('a','you',0,4);pass('b','you',1000,-10);
 m.event({type:'shot',team:'you',time:2000});m.event({type:'shot',team:'you',time:2500});
 assert.equal(m.snapshot().counts.inBehindToShot,1);assert.equal(m.snapshot().counts.overTopToShot,1);
});
