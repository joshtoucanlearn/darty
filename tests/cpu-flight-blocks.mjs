import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
for(const kind of ['shot','low-cross'])test(`V2 steps a nearby defender into a real ${kind} contact`,()=>{
 const h=attackingHost(321);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,
    place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
  for(const [i,p]of you.entries())place(p,40,-30+i*2);
  for(const [i,p]of opp.entries())place(p,65,-30+i*2);
  place(ykeep,2,18);place(okeep,103,18);
  const source=you[8],defender=opp[0];place(source,85,0);place(defender,94,1.1);
  Object.assign(defender.attrs,{defend:92,awareness:93,pace:85,accel:90});defender.vy=-2*sy/60;
  window.__blockStart={x:defender.x,y:defender.y};window.__blockDefender=defender;
  Object.assign(ball,{owner:null,target:null,x:M+86*sx,y:H/2,z:.12*sz,vx:18*sx/60,vy:0,zv:0,
    isShot:${kind==='shot'},shooter:${kind==='shot'?'source':'null'},flightType:'${kind}',crossSourceFlight:${kind==='low-cross'?"'low-cross'":'null'},lastKicker:source,aerialSource:source,kickerLock:0,cool:0});
  window.__blockReads=[];const authority=liveV2Authority;liveV2Authority={...authority,planTick(s){const f=authority.planTick(s);
    if(f?.hostProjection.blockAssignments?.length)window.__blockReads.push(...f.hostProjection.blockAssignments);return f;}};
 })()`);
 for(let i=0;i<65&&!h.scenario("report.events.some(e=>e.type==='block')");i++)h.step();
 const result=h.scenario(`({read:window.__blockReads.length,events:report.events.filter(e=>e.type==='block'),
   movedM:Math.hypot((window.__blockDefender.x-window.__blockStart.x)*105/(W-2*M),(window.__blockDefender.y-window.__blockStart.y)*68/H),
   physical:liveV2Authority.status().latestTelemetry?.contact?.contactType})`);
 assert.equal(h.state().authority.failureCode,null);assert.ok(result.read>0,JSON.stringify(result));
 assert.ok(result.movedM>.15,JSON.stringify(result));assert.equal(result.events.length,1,JSON.stringify(result));
 assert.equal(kind==='shot'?h.state().attack.counts.shotsBlocked:h.state().attack.counts.crossesBlocked,1);
 assert.ok(result.events[0].physicalContact||result.events[0].incomingVelocity);if(!result.events[0].controlled)assert.ok(result.events[0].outgoingVelocity);
 console.log('SCRIPTED_BLOCK_PROOF',JSON.stringify({kind,readFrames:result.read,movedMetres:result.movedM,physicalContacts:result.events.length}));
});

test('a moving shot meets a locked defender body physically and deflects after the initial reaction window',()=>{
 const h=attackingHost(322);
 h.scenario(`(()=>{${liveScene}
  const sx=(W-2*M)/105,sy=H/68,sz=PITCH_UNITS_PER_METRE,defender=opp[0],source=you[8];
  for(const p of [...you,...opp])Object.assign(p,{x:M+40*sx,y:80});
  Object.assign(defender,{x:M+95*sx,y:H/2,vx:0,vy:0,receiveT:30});
  Object.assign(source,{x:M+88*sx,y:H/2});
  Object.assign(ball,{owner:null,target:null,x:defender.x-.55*sx,y:defender.y,z:.9*sz,vx:20*sx/60,vy:0,zv:0,
    isShot:true,shooter:source,flightType:'shot',lastKicker:source,aerialSource:source,flightAge:45,kickerLock:0,cool:0});
 })()`);
 for(let i=0;i<6&&!h.state().attack.counts.shotsBlocked;i++)h.step();
 const r=h.scenario("report.events.filter(e=>e.type==='block').at(-1)");
 assert.equal(h.state().authority.failureCode,null);assert.ok(r,JSON.stringify(h.state().ball));
 assert.equal(r.authority,'magnus-reynolds-v2');assert.equal(r.blockedShot,true);
 assert.ok(r.incomingVelocity.x>0);assert.notEqual(r.outgoingVelocity.x,r.incomingVelocity.x);
 assert.equal(h.state().attack.counts.shotsBlocked,1);
});

test('the in-game block diagnostic uses the V2 read and actual contact after the host planner is retired',()=>{
 const h=attackingHost(321),r=h.scenario('window.FLMatch.debugActiveShotBlock()');
 assert.equal(h.state().authority.failureCode,null);assert.equal(r.read,true,JSON.stringify(r));
 assert.equal(r.blocked,true,JSON.stringify(r));assert.equal(r.physicalContact,true,JSON.stringify(r));
 assert.ok(['first-touch-v2','magnus-reynolds-v2'].includes(r.authority));
});
