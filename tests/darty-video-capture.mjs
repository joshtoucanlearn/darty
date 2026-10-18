import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import Capture from '../match-engine/darty-video-capture.js';
import loadCaptureHost from './fixtures/darty-capture-host.cjs';

test('no flags leave clocks, audio, random and browser globals untouched',()=>{
  const sentinel=()=>{},browser={document:{},location:{search:''},setTimeout:sentinel,Math:{random:sentinel}};
  vm.runInNewContext(fs.readFileSync(new URL('../match-engine/darty-video-capture.js',import.meta.url),'utf8'),{window:browser,URLSearchParams});
  assert.equal(browser.setTimeout,sentinel);assert.equal(browser.Math.random,sentinel);
  assert.equal(browser.DartyVideo,undefined);assert.equal(browser.dartyCapture,undefined);
});

test('virtual timers preserve deadlines, cancellation and RAF cadence without wall time',()=>{
  const clock=Capture.createClock(42),rows=[];
  clock.setTimeout(()=>rows.push(['later',clock.now()]),25);
  const cancelled=clock.setTimeout(()=>assert.fail('cancelled timer'),5);clock.clearTimer(cancelled);
  let interval=clock.setInterval(()=>{rows.push(['interval',clock.now()]);clock.clearTimer(interval);},10);
  clock.requestAnimationFrame(t=>rows.push(['raf',t]));clock.advance(1000/60);clock.advance(1000/60);
  assert.deepEqual(rows,[['interval',1010],['raf',1000+1000/60],['later',1025]]);
});

test('GPU and visual random draws cannot perturb the seeded simulation',()=>{
  const a=Capture.createClock(42),b=Capture.createClock(42);
  for(let i=0;i<300;i++){
    a.withRandom('visual',()=>{for(let n=0;n<17;n++)a.random();});a.withRandom('gpu',()=>a.random());
    assert.equal(a.random(),b.random());
  }
});

test('canonical events distinguish restarts, confirmed saves and pops',()=>{
  for(const [input,output]of [[{type:'restart',kind:'PENALTY'},'penalty'],[{type:'restart',kind:'FREE KICK'},'freeKick'],[{type:'keeper-save'},'save'],[{type:'darty-hard-hit'},'hardHit'],[{type:'darty-toy-pop'},'pop']])assert.deepEqual(Capture.eventTypes(input),[output]);
  assert.deepEqual(Capture.eventTypes({type:'shot-off-target'}),[]);
});

test('production scene advances poses but submits the GPU once per step call; step(0) freezes poses',async()=>{
  const host=await loadCaptureHost({draw:true});
  assert.equal(host.renderCount,1);
  const initial=JSON.stringify(host.__videoVisual());host.dartyCapture.step(10);
  assert.equal(host.renderCount,2);assert.notEqual(JSON.stringify(host.__videoVisual()),initial);
  const posed=JSON.stringify(host.__videoVisual());host.dartyCapture.step(0);
  assert.equal(host.renderCount,3);assert.equal(JSON.stringify(host.__videoVisual()),posed);
});

test('production host: same seed gives identical first 300 frames and 300 live frames, batched or single-step',async()=>{
  const a=await loadCaptureHost(),b=await loadCaptureHost();
  a.dartyCapture.step(300);for(let i=0;i<300;i++)b.dartyCapture.step();
  assert.equal(a.dartyCapture.frame(),300);assert.equal(a.dartyCapture.time(),0,'walkout retains its real duration');
  assert.equal(JSON.stringify(a.dartyCapture.events()),JSON.stringify(b.dartyCapture.events()));
  // Reach ordinary on-pitch CPU play, then compare a meaningful ten seconds.
  a.dartyCapture.step(185);b.dartyCapture.step(185);
  const before=a.FLLiveV2.status().gameplay.committedTicks;
  assert.ok(before>0,'real V2 authority has committed live play');
  a.dartyCapture.step(300);for(let i=0;i<300;i++)b.dartyCapture.step();
  assert.equal(a.FLLiveV2.status().gameplay.committedTicks-before,600);
  assert.equal(JSON.stringify(a.dartyCapture.events()),JSON.stringify(b.dartyCapture.events()));
  assert.equal(a.dartyCapture.time(),b.dartyCapture.time());
  assert.equal(a.FLMatch.getState().ball.x,b.FLMatch.getState().ball.x);
  assert.ok(a.dartyCapture.events().filter(e=>e.type==='pass').length>2);
  assert.throws(()=>a.dartyCapture.step(.5),/integer/);
  const detached=a.dartyCapture.events();detached[0].camera.mode='changed';
  assert.notEqual(a.dartyCapture.events()[0].camera.mode,'changed');
  assert.equal(a.dartyCapture.findNext('nonexistent',.1),null);
  assert.equal(a.dartyCapture.forceGoalAttempt(),true);
  assert.equal(a.dartyCapture.forceGoalAttempt(),false,'an in-flight testing attempt cannot start twice');
  const goalFrame=a.dartyCapture.findNext('goal',2);assert.ok(Number.isInteger(goalFrame));
  assert.ok(a.dartyCapture.events().some(e=>e.type==='shot'&&e.testingAid));
  assert.equal(a.FLLiveV2.status().strictStopped,false);
});
