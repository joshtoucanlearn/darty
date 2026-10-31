import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Clock=require('../match-engine/match-clock-v2.js');
const fast=()=>Clock.createState({fixedTickSeconds:1,acceleration:60,initialPhase:'live'});
test('a protected live ball continues simulation and football time after the period is due',()=>{
 let clock=Clock.advance(fast(),44);
 clock=Clock.advance(clock,2,{periodEndBlocked:true});
 assert.equal(clock.period,'first-half');assert.equal(clock.periodState.completionPending,true);
 assert.equal(clock.totalGameplaySeconds,2760);assert.equal(clock.totalLiveRealSeconds,46);
 assert.equal(clock.simulationElapsedSeconds,46);
 clock=Clock.advance(clock,1,{periodEndBlocked:false});
 assert.equal(clock.period,'half-time');assert.equal(clock.totalGameplaySeconds,2760);
});
test('a due period waits through a referee scene without inventing another stoppage-time budget',()=>{
 let clock=Clock.advance(fast(),45,{periodEndBlocked:true});
 const football=clock.totalGameplaySeconds,added=clock.periodState.addedTime.postSealSeconds;
 clock=Clock.enterPhase(clock,'presentation',{tick:clock.tick,reason:'pending-referee-scene',eligibleForAddedTime:true});
 clock=Clock.advance(clock,12,{periodEndBlocked:true});
 assert.equal(clock.period,'first-half');assert.equal(clock.totalGameplaySeconds,football);
 assert.equal(clock.periodState.addedTime.postSealSeconds,added);assert.equal(clock.totalStoppedRealSeconds,12);
 clock=Clock.advance(clock,1,{periodEndBlocked:false});
 assert.equal(clock.period,'half-time');assert.equal(clock.totalGameplaySeconds,football);
 assert.equal(clock.stoppages.at(-1).realSeconds,12);
});
test('pausing cannot finish a pending period and second-half protection also delays full time',()=>{
 let clock=Clock.advance(fast(),45,{periodEndBlocked:true});
 clock=Clock.pause(clock,{tick:clock.tick,reason:'user-pause'});
 clock=Clock.advance(clock,3,{periodEndBlocked:false});assert.equal(clock.period,'first-half');
 clock=Clock.resume(clock,{tick:clock.tick,reason:'user-resume'});
 clock=Clock.advance(clock,1,{periodEndBlocked:false});assert.equal(clock.period,'half-time');
 clock=Clock.startSecondHalf(clock,{tick:clock.tick,initialPhase:'live'});
 assert.equal(clock.periodState.completionPending,undefined);
 clock=Clock.advance(clock,45,{periodEndBlocked:true});assert.equal(clock.period,'second-half');
 clock=Clock.advance(clock,1,{periodEndBlocked:false});assert.equal(clock.period,'full-time');
});
test('the ordinary clock still finishes at its original exact budget without protection',()=>{
 const clock=Clock.advance(fast(),45);assert.equal(clock.period,'half-time');
 assert.equal(clock.totalGameplaySeconds,2700);assert.equal(clock.firstHalf.totalTargetSeconds,2700);
 assert.throws(()=>Clock.advance(fast(),1,{periodEndBlocked:'yes'}),/boolean/);
});
