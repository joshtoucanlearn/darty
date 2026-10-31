import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
import {countsAsFullTime,createCommitProgressMonitor} from '../tools/headless-cpu-match.mjs';
const require=createRequire(import.meta.url),Clock=require('../match-engine/match-clock-v2.js'),Control=require('../match-engine/live-v2-match-control-composition.js');
test('minimum roster counts include the goalkeeper and abandonment preserves actual football time',()=>{
 assert.equal(Control.minimumRosterStatus({home:7,away:11}),null);
 assert.deepEqual(Control.minimumRosterStatus({home:6,away:11}),{teamId:'home',remainingPlayers:6,minimumPlayers:7});
 assert.throws(()=>Control.minimumRosterStatus({home:6,away:12}),/counts/);
 const before=Clock.advance(Clock.createState({fixedTickSeconds:1,acceleration:60,initialPhase:'live'}),10),
  ended=Clock.abandonMatch(before,{teamId:'home',remainingPlayers:6,tick:before.tick}),s=Clock.snapshot(ended);
 assert.equal(s.clocks.gameplaySeconds,600);assert.equal(s.display.text,'10:00');assert.equal(s.gates.fullTime,false);assert.equal(s.gates.abandoned,true);
 assert.equal(s.abandonment.remainingPlayers,6);assert.equal(ended.secondHalf,null);
 assert.throws(()=>Clock.abandonMatch(before,{teamId:'home',remainingPlayers:7}),/fewer than seven/);
 assert.throws(()=>Clock.abandonMatch(before,{teamId:'home',remainingPlayers:6,tick:0}),/transition tick/);
});
test('four dismissals leave a legal seven-player team and the V2 formation still advances',()=>{
 const h=attackingHost(611);h.scenario(`(()=>{${liveScene}for(const p of opp.slice(0,4))p.sentOff=true;})()`);
 for(let i=0;i<10;i++)h.step();
 assert.equal(h.state().authority.failureCode,null);assert.equal(h.state().matchAbandoned,null);assert.ok(h.state().authority.candidateTicks>0);
});
test('five dismissals terminate through the control clock without a formation fault or a false full-time pass',()=>{
 const h=attackingHost(612);h.scenario(`(()=>{${liveScene}for(const p of opp.slice(0,5))p.sentOff=true;})()`);
 for(let i=0;i<500&&h.state().phase!=='ended';i++)h.step();
 const s=h.state();assert.equal(s.authority.failureCode,null);assert.equal(s.phase,'ended');assert.equal(s.matchAbandoned.remainingPlayers,6);
 assert.equal(s.fullTime,false);assert.match(h.scenario("document.getElementById('ftTitle').textContent"),/abandoned/i);
 assert.equal(countsAsFullTime(s),false);
 const monitor=createCommitProgressMonitor();monitor.observe(true,1);
 assert.equal(countsAsFullTime({phase:'ended',halfTime:true,fullTime:true,matchAbandoned:{remainingPlayers:6},authority:{failureCode:null},progress:monitor.snapshot()}),false);
});
test('an insufficient roster waits for an existing referee replay before becoming terminal',()=>{
 const h=attackingHost(613);h.scenario(`(()=>{${liveScene}for(const p of opp.slice(0,5))p.sentOff=true;disciplineReplay.active=true;disciplineReplay.startedAt=performance.now();disciplineReplay.duration=100000;})()`);
 // Run only the real control transaction: the replay renderer is irrelevant to this gate.
 h.scenario('liveV2RunControlOnly()');assert.equal(h.state().matchAbandoned,null);
 h.scenario('disciplineReplay.active=false;liveV2RunControlOnly()');
 assert.equal(h.state().authority.failureCode,null);assert.equal(h.state().matchAbandoned.remainingPlayers,6);
});
