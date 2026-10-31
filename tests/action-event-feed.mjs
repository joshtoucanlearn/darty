import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const source=readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  let eventTimer=0;'),source.indexOf('  let officialTimer='));
function feed(search=''){
 let now=0,serial=0;const timers=new Map(),classes=new Set(),body=new Set();
 const eventFeed={textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)}};
 const ctx=vm.createContext({URLSearchParams,location:{search},performance:{now:()=>now},eventFeed,
  document:{documentElement:{classList:{toggle(){}}},body:{classList:{contains:x=>body.has(x)}}},kickoffHeld:false,ball:{owner:null,directionalKnockOnContract:null},
  clearTimeout:id=>timers.delete(id),setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;}});
 vm.runInContext(block,ctx);
 return {ctx,body,eventFeed,visible:()=>classes.has('show'),run:s=>vm.runInContext(s,ctx),advance(ms){const end=now+ms;
  while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};
}
test('the default existing label is brief and a more interesting collision respects the minimum gap',()=>{
 const f=feed();f.run("showEvent('BODY FEINT',700,40)");assert.equal(f.eventFeed.textContent,'BODY FEINT');
 f.run("presentActionEvent('keeper-deflection','opp',null,{kind:'tip-over'})");
 f.run("showEvent('DRAG-BACK',700,40)");f.advance(319);assert.equal(f.eventFeed.textContent,'BODY FEINT');
 f.advance(1);assert.equal(f.eventFeed.textContent,'TIPPED OVER');assert.equal(f.visible(),true);
 f.advance(700);assert.equal(f.visible(),false);
});
test('actions=0 disables new and existing feedback; set pieces discard queued labels',()=>{
 const off=feed('?actions=0');off.run("showEvent('HEADER');presentActionEvent('dive','you',null,{})");assert.equal(off.visible(),false);
 const f=feed();f.run("showEvent('BODY FEINT',700,40);showEvent('VOLLEY',700,55)");f.body.add('setPieceActive');f.advance(320);
 assert.equal(f.visible(),false);f.body.delete('setPieceActive');f.advance(1000);assert.equal(f.visible(),false);
 f.ctx.kickoffHeld=true;f.run("showEvent('CHIP')");assert.equal(f.visible(),false);
});
test('a launch lease is not a pickup; a real teammate pickup is labelled as it happens',()=>{
 const f=feed();f.run("var runner={team:'you'},mate={team:'you'};ball.directionalKnockOnContract={};presentActionEvent('directional-knock-on','you',runner,{touchTier:'sprint-forward-strong'});observeActionFeedKnock(runner)");
 assert.equal(f.eventFeed.textContent,'KNOCK-ON STRONG');f.advance(320);
 f.run('observeActionFeedKnock(mate)');assert.equal(f.eventFeed.textContent,'TEAMMATE PICKUP');
});
test('a teammate first-time contact reports a pickup even without an owned waiting frame',()=>{
 const f=feed();f.run("var runner={team:'you'},mate={team:'you'};ball.directionalKnockOnContract={};presentActionEvent('directional-knock-on','you',runner,{touchTier:'baseline-free-roll'})");
 f.advance(320);f.run("presentActionEvent('pass','you',mate,{flightType:'ground-pass'})");assert.equal(f.eventFeed.textContent,'TEAMMATE PICKUP');
});
test('skill, combination, delivery, finishing and save events share the one existing element',()=>{
 for(const [type,extra,label]of [
  ['skill',{skill:'fake-shot'},'FAKE SHOT'],['skill',{skill:'bodyFeint'},'BODY FEINT'],['skill-utility',{skill:'fakeShot'},'FAKE SHOT'],['skill-utility',{skill:'flickUp'},'FLICK-UP'],
  ['v2-pass-decision',{reason:'give-and-go-return'},'ONE-TWO'],['v2-pass-decision',{reason:'third-man-layoff'},'THIRD MAN'],
  ['v2-pass-decision',{reason:'switch-congested-side'},'SWITCH'],['v2-pass-decision',{reason:'high-line-over-the-top'},'THROUGH BALL'],['v2-pass-decision',{reason:'ground-through-ball-in-behind'},'THROUGH BALL'],
  ['v2-cross',{kind:'byline'},'BYLINE CROSS'],['v2-cross',{kind:'cut-back'},'CUT-BACK'],
  ['shot',{shotType:'chip'},'CHIP'],['shot',{shotType:'normal',firstTime:true},'FIRST TIME'],
  ['shot-off-target',{targetOutcome:'near-miss'},'NEAR MISS'],['shot-off-target',{missKind:'skied'},'SKIED'],
  ['keeper-deflection',{kind:'tip-round'},'TIPPED ROUND'],['impact-sound',{kind:'referee-punch'},'REF PUNCH']]){
  const f=feed();f.ctx.extra=extra;f.ctx.type=type;f.run("presentActionEvent(type,'you',null,extra)");assert.equal(f.eventFeed.textContent,label);
 }
});
test('presentation on and off produce identical sequential fixed-tick gameplay and observer rows',()=>{
 function run(actions){const h=attackingHost(187,{actions});h.scenario(liveScene);for(let i=0;i<2400;i++)h.step();const s=h.state();
  return JSON.parse(JSON.stringify(Object.fromEntries(['ticks','clockFrames','score','authority','matchStats','actions','attack','races','knockOns','cohesion','ball','minute','phase','progress'].map(k=>[k,s[k]]))));}
 assert.deepEqual(run(true),run(false));
});

test('miss feedback reads the physical post and bar clearance instead of the old launch aim',()=>{
 for(const [lateral,height,label]of [[4.1,1.2,'NEAR MISS'],[1,2.8,'NEAR MISS'],[1,5.2,'SKIED'],[5.2,1,'SHOT WIDE']]){
  const f=feed();Object.assign(f.ctx,{H:2142,PITCH_UNITS_PER_METRE:2142/68});
  Object.assign(f.ctx.ball,{y:1071+lateral*2142/68,z:(height-.11)*2142/68});
  f.run("presentActionEvent('shot-off-target','you',null,{targetOutcome:'on-frame'})");
  assert.equal(f.eventFeed.textContent,label);
 }
});
