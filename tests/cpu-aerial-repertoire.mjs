import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
for(const [name,height,offsetX,offsetY]of [['overhead',2.2,-.45,.6],['scissor',1.4,.25,.6]])test(`CPU ${name} calls the real flair executor and stages exactly one physical shot`,()=>{
 const h=attackingHost(341);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
    place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const [i,p]of you.entries())place(p,40,-30+i*2);
  for(const [i,p]of opp.entries())place(p,65,-30+i*2);
  const actor=you[8],source=you[2];place(actor,96,0);place(source,85,18);
  Object.assign(actor.attrs,{technique:95,agility:95,awareness:95,control:95,shoot:95,volleys:95});
  place(ykeep,2,15);place(okeep,104,15);
  Object.assign(ball,{owner:null,target:actor,x:actor.x+${offsetX}*sx,y:actor.y+${offsetY}*sy,z:${height}*sz,
    vx:0,vy:0,zv:-1*sz/60,flightType:'cross',crossSourceFlight:'cross',lastKicker:source,aerialSource:source,kickerLock:0,cool:0,flightAge:30,isShot:false});
  window.__savedRandom=Math.random;Math.random=()=>0;
 })()`);
 for(let i=0;i<4&&!h.scenario("report.events.some(e=>e.type==='aerial-flair-attempt')");i++)h.step();
 h.scenario('Math.random=window.__savedRandom');
 const result=h.scenario(`({attempts:report.events.filter(e=>e.type==='aerial-flair-attempt'),shots:report.events.filter(e=>e.type==='shot'),
   launch:liveV2PendingLaunch&&{source:liveV2PendingLaunch.source,speed:liveV2PendingLaunch.speedMetresPerSecond},action:you[8].action})`);
 assert.equal(h.state().authority.failureCode,null);assert.equal(result.attempts.length,1,JSON.stringify(result));
 assert.equal(result.attempts[0].outcome,'connected');assert.equal(result.shots.length,1,JSON.stringify(result));
 assert.equal(result.shots[0].shotType,name+'-kick');assert.equal(result.launch?.source,'acrobatic-shot');
 assert.ok(result.launch.speed>10);assert.equal(h.state().attack.shotTypes[name],1);
});

test('a dropping cross remains a requested physical volley instead of being re-normalized into a header',()=>{
 const h=attackingHost(341);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
    place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const[i,p]of you.entries())place(p,40,-28+i*2);for(const[i,p]of opp.entries())place(p,70,-28+i*2);
  place(ykeep,2,12);place(okeep,103,12);
  const actor=you[8],source=you[2];actor.id='volley-a';place(actor,94,0);place(source,80,-20);
  Object.assign(actor.attrs,{technique:95,agility:95,awareness:95,control:95,shoot:95,volleys:95});
  Object.assign(ball,{owner:null,target:actor,x:M+91*sx,y:H/2,z:3*sz,vx:10*sx/60,vy:0,zv:-sz/60,
    flightType:'cross',crossSourceFlight:'cross',lastKicker:source,aerialSource:source,kickerLock:0,cool:0,flightAge:30,isShot:false});
 })()`);
 let stance=false;
 for(let i=0;i<70&&!h.state().attack.shotTypes.volley;i++){
  h.step();stance ||= h.scenario("liveV2Authority.status().latestTelemetry?.recoveryAssignments.some(r=>r.playerId==='volley-a'&&r.receivingStance==='volley')")===true;
 }
 assert.equal(h.state().authority.failureCode,null);assert.ok(stance);
 assert.equal(h.state().attack.shotTypes.volley,1);assert.equal(h.state().attack.shotTypes.header,undefined);
 const contact=h.scenario("report.events.find(e=>e.type==='v2-aerial-contact'&&e.technique==='volley')");
 assert.ok(contact);assert.ok(contact.ball.z/((2142)/68)<1.55);
});

test('a receiver with time meets a dropping cross inside real chest reach and then shoots without a ground first-time override',()=>{
 const h=attackingHost(341);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
    place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const[i,p]of you.entries())place(p,40,-28+i*2);for(const[i,p]of opp.entries())place(p,70,-28+i*2);
  place(ykeep,2,12);place(okeep,103,12);
  const actor=you[8],source=you[2];actor.id='control-5';place(actor,94,0);place(source,80,-20);
  Object.assign(actor.attrs,{technique:95,agility:95,awareness:95,control:95,shoot:95,volleys:95});
  Object.assign(ball,{owner:null,target:actor,x:M+91*sx,y:H/2,z:3*sz,vx:10*sx/60,vy:0,zv:-sz/60,
    flightType:'cross',crossSourceFlight:'cross',lastKicker:source,aerialSource:source,kickerLock:0,cool:0,flightAge:30,isShot:false});
 })()`);
 let stance=false;
 for(let i=0;i<160&&!h.state().attack.counts.aerialControlThenShot;i++){
  h.step();stance ||= h.scenario("liveV2Authority.status().latestTelemetry?.recoveryAssignments.some(r=>r.playerId==='control-5'&&r.receivingStance==='control')")===true;
 }
 assert.equal(h.state().authority.failureCode,null);assert.ok(stance);
 assert.equal(h.state().attack.counts.aerialControls,1);
 assert.equal(h.state().attack.counts.aerialControlThenShot,1);
 assert.equal(h.state().attack.shotTypes.firstTime||0,0);
 assert.equal(h.state().attack.shotTypes.volley||0,0);
});

test('a checked ball over the top can be brought down in the box instead of missing the chest window while waiting at feet',()=>{
 const h=attackingHost(341);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
    place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const[i,p]of you.entries())place(p,40,-28+i*2);for(const[i,p]of opp.entries())place(p,70,-28+i*2);
  place(ykeep,2,12);place(okeep,103,12);
  const actor=you[8],source=you[2];actor.id='receiver-2';source.id='flight-source';place(actor,94,0);actor.vx=4*sx/60;place(source,80,-20);
  Object.assign(actor.attrs,{technique:95,agility:95,awareness:95,control:95,shoot:95,volleys:95});
  Object.assign(ball,{owner:null,target:actor,x:M+91*sx,y:H/2,z:3*sz,vx:10*sx/60,vy:0,zv:-sz/60,
    flightType:'long-pass',crossSourceFlight:null,lastKicker:source,aerialSource:source,kickerLock:0,cool:0,flightAge:30,isShot:false});
  const q=liveV2QueueLaunch(source,{x:M+95.5*sx,y:H/2},{origin:{x:ball.x,y:ball.y,z:ball.z},
    speedWorld:10*sx/60,loftWorld:-sz/60,flightType:'long-pass',targetPlayer:actor});
  if(!q)throw Error('flight setup failed');Object.assign(q,{meetingContract:'cpu-pass-race-mr-rendezvous-v2',
    receiverMeeting:'feet',predictedArrivalTicks:42,movingInBehind:true});
 })()`);
 let chestTick=-1,shotTick=-1;
 for(let i=0;i<160&&shotTick<0;i++){
  h.step();const c=h.scenario('liveV2Authority.status().latestTelemetry?.contact');
  if(c?.ownedContact&&c.presentation?.playerId==='receiver-2'&&c.presentation.technique==='chest-control')chestTick=i;
  if(h.scenario('you[8].stats.shots>0'))shotTick=i;
 }
 assert.equal(h.state().authority.failureCode,null);
 assert.ok(chestTick>=0,'the runner must physically contact the airborne ball with his chest');
 assert.ok(shotTick>chestTick&&shotTick-chestTick<=120,JSON.stringify({chestTick,shotTick}));
 assert.equal(h.state().attack.counts.firstTimeGroundShots,0);
});
