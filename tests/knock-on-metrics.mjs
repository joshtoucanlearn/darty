import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnockOnMetrics} from '../tools/knock-on-metrics.mjs';
const launch=(m,tier='sprint-forward-light')=>m.event({type:'directional-knock-on',cpu:true,actorId:'fixture-runner',team:'you',time:0,x:50,y:34,direction:1,touchTier:tier});
const frame=(m,time,id,team,x,extra={})=>m.frame({time,live:true,ownerId:id,players:id?[{id,team,x,y:34}]:[],...extra});

test('same-player recontrol is physical, measures gain and records a cutback leading to a shot',()=>{
 const m=createKnockOnMetrics();launch(m);
 m.event({type:'v2-cpu-knock-on',actorId:'fixture-runner',situation:'wing-transition'});
 frame(m,16,'fixture-runner','you',50,{physicalOwnerId:null,knockOnActive:true});
 assert.equal(m.snapshot().outcomes.pending,1,'the launch-frame lease is not a successful knock');
 frame(m,600,'fixture-runner','you',55);
 m.event({type:'pass',actorId:'fixture-runner',team:'you',time:800,x:55,y:34});
 m.event({type:'v2-cross',actorId:'fixture-runner',team:'you',time:800,x:55,y:34});
 m.event({type:'shot',actorId:'fixture-finisher',team:'you',time:4000,x:70,y:34});
 const s=m.snapshot();assert.equal(s.outcomes['same-player'],1);assert.equal(s.meanMetresGained,5);
 assert.equal(s.keptGainingTwoMetres,1);assert.equal(s.nextActions.cross,1);assert.equal(s.shotsWithinFiveSeconds,1);
 assert.equal(s.byTier.light.attempts,1);assert.equal(s.bySituation['wing-transition'].attempts,1);
 assert.doesNotMatch(JSON.stringify(s),/fixture-runner|fixture-finisher/,'stored episodes use generic aliases');
});
test('teammate, opponent with time, and field exit are separate outcomes for every tier',()=>{
 const m=createKnockOnMetrics();launch(m,'baseline-free-roll');frame(m,400,'fixture-mate','you',54);
 m.event({type:'directional-knock-on',cpu:true,actorId:'fixture-mate',team:'you',time:1000,x:54,y:34,touchTier:'sprint-forward-double'});
 frame(m,1750,'fixture-opponent','opp',61);
 m.event({type:'shot',actorId:'fixture-runner',team:'you',time:2000,x:65,y:34});
 m.event({type:'directional-knock-on',cpu:true,actorId:'fixture-runner',team:'you',time:3000,x:50,y:34,touchTier:'sprint-forward-strong'});
 m.event({type:'restart',kind:'THROW-IN',team:'opp',time:4100});
 const s=m.snapshot();assert.equal(s.attempts,3);assert.equal(s.outcomes.teammate,1);assert.equal(s.outcomes.opponent,1);assert.equal(s.outcomes['out-of-play'],1);
 assert.equal(s.meanOpponentSeconds,.75);assert.equal(s.byTier.double.shotsWithinFiveSeconds,0);
 assert.equal(s.byTier['jog-free-roll'].attempts,1);assert.equal(s.byTier.strong.attempts,1);
 assert.equal(s.episodes[2].retainedAtRestart,false);
});
test('a short physical second knock keeps the first one without changing the existing2m win rule',()=>{
 const m=createKnockOnMetrics();launch(m,'sprint-forward-strong');
 m.event({type:'directional-knock-on',cpu:true,actorId:'fixture-runner',team:'you',time:250,x:51,y:34,touchTier:'sprint-forward-double'});
 m.event({type:'full-time',time:1000});
 const s=m.snapshot();assert.equal(s.attempts,2);assert.equal(s.outcomes['same-player'],1);assert.equal(s.keptGainingTwoMetres,0);
 assert.equal(s.nextActions.carry,1);assert.equal(s.outcomes.stopped,1);
});
test('a real carry, teammate loss and the five-second shot window are observed without guessing from an intent',()=>{
 const m=createKnockOnMetrics();launch(m);frame(m,500,'fixture-runner','you',54);
 frame(m,1000,'fixture-runner','you',56.1);assert.equal(m.snapshot().nextActions.carry,1);
 frame(m,2000,'fixture-opponent','opp',57);
 m.event({type:'shot',actorId:'fixture-runner',team:'you',time:3000,x:60,y:34});
 assert.equal(m.snapshot().shotsWithinFiveSeconds,0,'an attack that lost control is not credited for a later new possession');
});
test('human touches do not create CPU episodes and a foul/period stop is not called a field exit',()=>{
 const m=createKnockOnMetrics();m.event({type:'directional-knock-on',cpu:false,actorId:'human',team:'you',time:0});
 assert.equal(m.snapshot().attempts,0);launch(m);m.event({type:'restart',kind:'FREE KICK',team:'you',time:800});
 assert.equal(m.snapshot().outcomes.stopped,1);assert.equal(m.snapshot().outcomes['out-of-play'],undefined);
});
