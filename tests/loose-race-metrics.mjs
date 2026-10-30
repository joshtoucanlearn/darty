import test from 'node:test';
import assert from 'node:assert/strict';
import {createLooseRaceMetrics} from '../tools/loose-race-metrics.mjs';
const pair=[{id:'home-runner',team:'you',x:40,y:-.5,vx:7,vy:0,gait:'sprint',pace:90},{id:'away-runner',team:'opp',x:39,y:.5,vx:6.8,vy:0,gait:'sprint',pace:80}];
function setup(){const m=createLooseRaceMetrics();m.commands(pair.map(p=>({playerId:p.id,mode:'sprint',intensity:1})));m.assignment({possession:{inFlight:false},recoveryAssignments:pair.map(p=>({playerId:p.id,target:{x:45,y:0},authority:'v2-loose-ball-recovery'})),movementTelemetry:{contacts:[]}});return m;}
test('race records actual speeds, full sprint requests, physical shoulders, timing and winner attributes',()=>{
 const m=setup();m.frame({time:0,live:true,players:pair,ball:{x:44,y:0,z:0},ownerId:null});
 m.assignment({movementTelemetry:{contacts:[{type:'shoulder-contact',racePursuit:true}]}});
 m.frame({time:1000,live:true,players:pair,ball:{x:44,y:0,z:0},ownerId:'home-runner'});
 const r=m.snapshot();assert.equal(r.counts.races,1);assert.equal(r.counts.shoulderContests,1);assert.equal(r.meanResolutionSeconds,1);
 assert.equal(r.counts.nearerWins,1);assert.equal(r.counts.fasterWins,1);assert.equal(r.counts.bothWins,1);assert.equal(r.fullSprintCommandShare,1);
 assert.equal(r.meanRacerSpeedMps,6.9);assert.ok(!JSON.stringify(r).includes('home-runner'),'diagnostic IDs are pseudonyms');
});
test('the release frame of an authored pass does not manufacture a new loose-ball race',()=>{
 const m=setup();m.event({type:'pass',actorId:'home-runner',time:1000});
 m.frame({time:1000,live:true,players:pair,ball:{x:44,y:0,z:0},ownerId:null});
 assert.equal(m.snapshot().counts.races,0);
});
