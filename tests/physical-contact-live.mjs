import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
test('a real boot contact releases one live Ball launch through the adapter without remote ownership',()=>{
 const h=attackingHost(705,{humanInput:true});
 h.scenario(`(()=>{${liveScene}
  lastAICpuDiveScanFrame=Infinity;const sx=(W-2*M)/105,sy=H/68,put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:1,fy:0,skill:0,stun:0,slide:0});
  you.forEach((p,i)=>put(p,25,-28+i*2));opp.forEach((p,i)=>put(p,90,-28+i*2));put(ykeep,2,20);put(okeep,103,20);
  const challenger=you[0],carrier=opp[8];put(challenger,59.5,0);put(carrier,61,0);controlled=challenger;
  Object.assign(challenger.attrs,{defend:99,strength:99,aggression:99});Object.assign(carrier.attrs,{control:20,balance:20,strength:20});
  Object.assign(ball,{owner:carrier,x:M+60*sx,y:H/2,z:0,vx:0,vy:0,zv:0,isShot:false,shooter:null,target:null,kickerLock:0});
  const api=window.FootballLegacyLiveV2Authority,movement=api.contactPoseApi(),capability=api.createCapability({acknowledgement:api.ACKNOWLEDGEMENT,workflow:'single-player',online:false});
  let prepared=false;const traced={...movement,advance(world,commands,ticks,config,physicalBall){
   if(!prepared){prepared=true;world={...world,players:world.players.map(p=>p.id===challenger.id?{...p,action:{type:'stand-tackle',commandId:'live-physical-poke',
    targetId:carrier.id,direction:{x:1,y:0},startedTick:-5,contactStartTick:-2,contactEndTick:7,recoveryEndTick:25}}:p)};}
   return movement.advance(world,commands,ticks,config,physicalBall);
  }};
  liveV2Authority=api.createAttachment({enabled:true,capability,seed:705,trueFeelPhysicalTouchAuthority:true,cpuPassRaceFilter:true,
   dependencies:{movement:traced},host:{prepareTick:liveV2PrepareHostTick}});
  window.__livePhysicalChallenger=challenger;window.__livePhysicalProjection=null;
  const authority=liveV2Authority;liveV2Authority={...authority,planTick(s){const f=authority.planTick(s);if(f)window.__livePhysicalProjection=f.hostProjection;return f;}};
 })()`);
 h.step();
 const r=h.scenario(`({poke:window.__livePhysicalProjection?.physicalChallengePoke,
   contact:window.__livePhysicalProjection?.movementTelemetry?.contacts.find(c=>c.ballWon),
   owned:!!ball.owner,speed:Math.hypot(ball.vx*60/((W-2*M)/105),ball.vy*60/(H/68)),
   source:ball.lastKicker===window.__livePhysicalChallenger,type:ball.flightType,tackles:window.__livePhysicalChallenger.stats.tackles})`);
 assert.equal(h.state().authority.failureCode,null);assert.ok(r.poke,JSON.stringify(r));assert.equal(r.contact.ballContact,true);
 assert.equal(r.owned,false);assert.ok(r.speed>5,JSON.stringify(r));assert.equal(r.source,true);assert.equal(r.type,'tackle-poke');assert.equal(r.tackles,1);
});

test('a clean poke cancels an active physical lease and its queued action before resecure',()=>{
 const h=attackingHost(705,{humanInput:true});
 h.scenario(`(()=>{${liveScene}
  lastAICpuDiveScanFrame=Infinity;const sx=(W-2*M)/105,sy=H/68,put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:1,fy:0,skill:0,stun:0,slide:0});
  you.forEach((p,i)=>put(p,25,-28+i*2));opp.forEach((p,i)=>put(p,90,-28+i*2));put(ykeep,2,20);put(okeep,103,20);
  const challenger=you[0],carrier=opp[8];put(challenger,59.5,0);put(carrier,61,0);controlled=challenger;
  Object.assign(challenger.attrs,{defend:99,strength:99,aggression:99});Object.assign(carrier.attrs,{control:20,balance:20,strength:20});
  Object.assign(ball,{owner:carrier,x:M+60*sx,y:H/2,z:0,vx:0,vy:0,zv:0,isShot:false,shooter:null,target:null,kickerLock:0});
  const api=window.FootballLegacyLiveV2Authority,movement=api.contactPoseApi(),capability=api.createCapability({acknowledgement:api.ACKNOWLEDGEMENT,workflow:'single-player',online:false});
  let prepared=false;const traced={...movement,advance(world,commands,ticks,config,physicalBall){
   if(!prepared){prepared=true;world={...world,players:world.players.map(p=>p.id===challenger.id?{...p,action:{type:'stand-tackle',commandId:'live-physical-poke',
    targetId:carrier.id,direction:{x:1,y:0},startedTick:-5,contactStartTick:-2,contactEndTick:7,recoveryEndTick:25}}:p)};}
   return movement.advance(world,commands,ticks,config,physicalBall);
  }};
  liveV2Authority=api.createAttachment({enabled:true,capability,seed:705,trueFeelPhysicalTouchAuthority:true,cpuPassRaceFilter:true,
   dependencies:{movement:traced},host:{prepareTick:liveV2PrepareHostTick}});
  const state=JSON.parse(JSON.stringify(liveV2Authority.exportState())),dribble=window.FootballLegacyDribblingStateV2;
  state.domain.ballState=window.FootballLegacyBallEngineV2.createBallState({position:{x:60,y:0,z:.11},velocity:{x:0,y:0,z:0},grounded:true});
  state.domain.dribbling=dribble.serializeState(dribble.createState({epoch:state.resetEpoch,phase:'chase-recovery',
    carrierId:carrier.id,carrierTeamId:carrier.team,logicalOwnerId:carrier.id,physicalSeparated:true,touchTick:0,leaseUntilTick:100,
    bufferedAction:{id:'queued-old-owner-pass',type:'pass',actorId:carrier.id,source:'cpu-v2',commandTick:0,expiresTick:100,power:.7,target:{x:2000,y:900}}}));
  delete state.checksum;
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  let hash=2166136261;for(const c of canonical(state)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}state.checksum=((hash>>>0)||0x9e3779b9).toString(16).padStart(8,'0');
  if(!liveV2Authority.restoreState(state))throw Error('could not restore the physical lease fixture');
  window.__livePhysicalChallenger=challenger;window.__livePhysicalProjection=null;
  const authority=liveV2Authority;liveV2Authority={...authority,planTick(s){const f=authority.planTick(s);if(f)window.__livePhysicalProjection=f.hostProjection;return f;}};
 })()`);
 h.step();
 const r=h.scenario(`({poke:window.__livePhysicalProjection?.physicalChallengePoke,
   contact:window.__livePhysicalProjection?.movementTelemetry?.contacts.find(c=>c.ballWon),
   released:window.__livePhysicalProjection?.dribbling.releasedAction,owner:window.__livePhysicalProjection?.dribbling.logicalOwnerId,owned:!!ball.owner,speed:Math.hypot(ball.vx*60/((W-2*M)/105),ball.vy*60/(H/68)),
   source:ball.lastKicker===window.__livePhysicalChallenger,type:ball.flightType,tackles:window.__livePhysicalChallenger.stats.tackles})`);
 assert.equal(r.released,null);assert.equal(r.owner,null);assert.equal(h.state().authority.failureCode,null);assert.ok(r.poke,JSON.stringify(r));assert.equal(r.contact.ballContact,true);
 assert.equal(r.owned,false);assert.ok(r.speed>5,JSON.stringify(r));assert.equal(r.source,true);assert.equal(r.type,'tackle-poke');assert.equal(r.tackles,1);
});

test('an actual body charge reaches the existing referee with its contact proof and no offender repositioning',()=>{
 const h=attackingHost(708),r=h.scenario(`(()=>{${liveScene}
  const api=window.FootballLegacyLiveV2Authority.contactPoseApi(),sx=(W-2*M)/105,sy=H/68,actor=you[0],target=opp[0],rig=liveV2ContactRigFor(actor);
  Object.assign(actor,{skill:0,stun:0,slide:0});Object.assign(target,{skill:0,stun:0,slide:0});
  let world=api.createWorldState({players:[{id:actor.id,teamId:'you',position:{x:59.7,y:0},velocity:{x:7,y:0},facing:{x:1,y:0},contactRig:rig,action:{type:'shoulder-challenge',commandId:'deliberate-charge',targetId:target.id,direction:{x:1,y:0},startedTick:0,contactStartTick:1,contactEndTick:12,recoveryEndTick:30}},
    {id:target.id,teamId:'opp',position:{x:60.3,y:0},facing:{x:-1,y:0},contactRig:liveV2ContactRigFor(target)}]}),result,contact;
  for(let i=0;i<5&&!contact;i++){
    result=api.advance(world,[{id:'body-rush-'+(world.tick+1),tick:world.tick+1,playerId:actor.id,type:'move',move:{x:1,y:0},mode:'sprint'}],1,undefined,
      {position:{x:80,y:10,z:.11},velocity:{x:0,y:0,z:0},radius:.11});world=result.state;
    contact=result.telemetry.contacts.find(c=>c.type==='shoulder-contact');
  }
  liveV2TickCarrier=null;liveV2PendingFoul=null;ball.owner=null;ball.x=M+80*sx;ball.y=H/2+10*sy;
  liveV2ApplyMovement({snapshotTick:world.tick,movement:world.players.map(p=>({id:p.id,x:M+p.position.x*sx,y:H/2+p.position.y*sy,
    vx:p.velocity.x*sx/60,vy:p.velocity.y*sy/60,fx:p.facing.x,fy:p.facing.y,stamina:p.stamina,action:p.action,locomotionState:p.locomotionState})),
    logicalBallOwnerId:null,movementBallOwnerId:null,possession:{ownerId:null},physicalBallSeparated:false,movementTelemetry:result.telemetry});
  const pending=liveV2PendingFoul,point=pending?.info.contactProof?.point,x=actor.x,y=actor.y;
  liveV2HostFollowUps();const event=report.events.filter(e=>e.type==='foul'&&e.authority==='movement-v2').at(-1);
  return {registered:!!contact,pending:!!pending,proof:point&&pending.info.contactProof,
   eventProof:event?.contactProof,offenderMoved:Math.hypot(actor.x-x,actor.y-y)};
 })()`);
 assert.equal(r.registered,true);assert.equal(r.pending,true,JSON.stringify(r));assert.equal(r.proof.bodyContact,true);assert.ok(r.proof.normal);
 assert.equal(r.eventProof.bodyContact,true);assert.ok(r.offenderMoved<1e-9);
});

for(const type of ['slide-tackle','stand-tackle'])test(type+' ball-first follow-through can cause a fall, but cannot reach foul or card authority',()=>{
 const h=attackingHost(709),r=h.scenario(`(()=>{${liveScene}
  const actor=you[0],target=opp[0],api=window.FootballLegacyLiveV2Authority.contactPoseApi();
  Object.assign(actor,{skill:0,stun:0,slide:0});Object.assign(target,{skill:0,stun:0,slide:0});
  liveV2PendingFoul=null;liveV2TickCarrier=target;ball.owner=target;
  const contact={type:'${type}'==='slide-tackle'?'slide-contact':'tackle-contact',commandId:'clean-follow-through',
   bodyContact:true,ballContact:true,ballFirst:true,ballWon:false,outcome:'win',approachSpeedMps:10,
   ballContactTick:10,bodyContactTick:24,contactPart:'boot-to-leg',visibleGapMetres:0,timeFraction:.5,
   point:{x:60,y:0,z:.2},normal:{x:1,y:0,z:0}};
  const before=report.events.length;stageAutonomousContactPresentation(actor,target,contact.type,contact);
  liveV2JudgeContact(actor,target,contact);const pending=!!liveV2PendingFoul;liveV2HostFollowUps();
  const playOn=!foulSequence,events=report.events.slice(before),fall=events.some(e=>e.type==='contact-fall');
  // A distinct new action entered later has its own man-first verdict.
  const separate={...contact,commandId:'new-action',ballFirst:false,ballContact:false,ballContactTick:null,bodyContactTick:50};
  liveV2JudgeContact(actor,target,separate);
  return {pending,playOn,fall,fouls:events.filter(e=>e.type==='foul').length,cards:events.filter(e=>/card/.test(e.type)).length,newActionFoul:!!liveV2PendingFoul};
 })()`);
 assert.equal(r.pending,false);assert.equal(r.playOn,true);assert.equal(r.fall,true);assert.equal(r.fouls,0);assert.equal(r.cards,0);assert.equal(r.newActionFoul,true);
});
test('an incidental running bump is physical, but never a referee challenge',()=>{
 const h=attackingHost(710),r=h.scenario(`(()=>{${liveScene}
  const api=window.FootballLegacyLiveV2Authority.contactPoseApi(),actor=you[0],target=opp[0],rig=liveV2ContactRigFor(actor);
  let world=api.createWorldState({players:[{id:actor.id,teamId:'you',position:{x:59.7,y:0},velocity:{x:7,y:0},facing:{x:1,y:0},contactRig:rig},
   {id:target.id,teamId:'opp',position:{x:60.3,y:0},facing:{x:-1,y:0},contactRig:liveV2ContactRigFor(target)}]}),contact;
  for(let i=0;i<5&&!contact;i++){const r=api.advance(world,[{id:'running-'+i,tick:world.tick+1,playerId:actor.id,type:'move',move:{x:1,y:0},mode:'sprint'}],1,undefined,
   {position:{x:80,y:10,z:.11},velocity:{x:0,y:0,z:0},radius:.11});world=r.state;contact=r.telemetry.contacts.find(c=>c.type==='body-contact');}
  liveV2PendingFoul=null;liveV2TickCarrier=null;liveV2JudgeContact(actor,target,contact);
  return {contact:!!contact,incidental:contact?.incidental,point:contact?.point,normal:contact?.normal,foul:!!liveV2PendingFoul};
 })()`);
 assert.equal(r.contact,true);assert.equal(r.incidental,true);assert.ok(r.point&&r.normal);assert.equal(r.foul,false);
});
