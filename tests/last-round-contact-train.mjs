import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';
import{attackingHost,liveScene}from'./fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),M=require('../match-engine/movement-engine-v2.js');
for(const type of['stand-tackle','slide-tackle'])test(type+' actual boot strike cannot be vetoed by a stronger carrier or active skill score',()=>{
 const slide=type==='slide-tackle';let w=M.createWorldState({ballOwnerId:'carrier',players:[
  {id:'defender',teamId:'home',position:{x:0,y:0},velocity:{x:slide?8:4,y:0},facing:{x:1,y:0},contactRig:M.createContactRig(),attributes:{defending:1,strength:1,aggression:1,acceleration:1},
   action:{type,commandId:'weak-real-boot',targetId:'carrier',direction:{x:1,y:0},startedTick:0,contactStartTick:1,contactEndTick:12,recoveryEndTick:30}},
  {id:'carrier',teamId:'away',position:{x:slide?2.3:1.2,y:0},contactRig:M.createContactRig(),attributes:{control:99,balance:99,strength:99},skillProtection:{defenderId:'defender',multiplier:.3}}]});
 let poke,contact;for(let t=0;t<12&&!poke;t++){const r=M.advance(w,[],1,undefined,{position:{x:slide?.9:.58,y:.10,z:.11},velocity:{x:0,y:0,z:0},radius:.11});w=r.state;poke=r.telemetry.pokes?.[0];contact=r.telemetry.contacts.find(c=>c.ballWon)||contact;}
 assert.ok(poke,'the real ball leaves owned control');assert.ok(contact.actorScore<contact.targetScore);assert.equal(contact.ballFirst,true);assert.equal(contact.skillTackleMultiplier,.3);assert.equal(w.ballOwnerId,null);assert.ok(contact.visibleGapMetres<1e-8);
});
test('train layout keeps its cars above the roof and inside the old full-size geometry',()=>{
 const h=attackingHost(772),r=h.scenario(`(()=>{const a={},b={};trainWorldPosition(a,0);trainWorldPosition(b,10000);return{a,b,roof:42+(STADIUM.touchRows-1)*STADIUM.rowRise+64};})()`);
 assert.equal(r.a.y-r.roof,134);assert.ok(r.b.x>r.a.x);assert.ok(r.a.z<-2000);
});

test('CPU boundary braking selects the existing shield touch path before an outward chase touch',()=>{
 const h=attackingHost(746);
 h.scenario(`(()=>{${liveScene}
  lastAICpuDiveScanFrame=Infinity;const sx=(W-2*M)/105,sy=H/68,put=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:1,fy:0,skill:0,stun:0,slide:0});
  you.forEach((p,i)=>put(p,30,-28+i*2));opp.forEach((p,i)=>put(p,85,-28+i*2));put(ykeep,2,0);put(okeep,103,0);
  const carrier=you[8];put(carrier,65,32);carrier.vx=4*sx/60;carrier.vy=4*sy/60;carrier.fx=.8;carrier.fy=.6;
  Object.assign(ball,{owner:carrier,x:carrier.x+14,y:carrier.y+10,z:0,vx:carrier.vx,vy:carrier.vy,zv:0,isShot:false,shooter:null,target:null,kickerLock:0});
  const api=window.FootballLegacyLiveV2Authority,cpu=window.FootballLegacyCPUIntelligenceV2,
    capability=api.createCapability({acknowledgement:api.ACKNOWLEDGEMENT,workflow:'cpu-v-cpu',online:false,controlOwnership:{humanPlayerIds:[],cpuTeamIds:['you','opp']}});
  liveV2Authority=api.createAttachment({enabled:true,capability,seed:746,trueFeelPhysicalTouchAuthority:true,cpuPassRaceFilter:true,
   dependencies:{cpu:{...cpu,decide(s,m,c){const d=cpu.decide(s,m,c);return s.teamId==='you'&&s.carrierId===carrier.id?{...d,carrierIntent:{type:'carry',target:{x:80,y:32.75},targetPlayerId:null,reason:'wide-carrier-drive-for-byline',confidence:.8}}:d;}}},host:{prepareTick:liveV2PrepareHostTick}});
  const authority=liveV2Authority;window.__boundaryProof=[];liveV2Authority={...authority,planTick(s){const f=authority.planTick(s);if(f){const p=f.hostProjection;window.__boundaryProof.push({phase:p.dribbling.phase,outcome:p.dribbling.outcome,separated:p.physicalBallSeparated});}return f;}};
 })()`);
 for(let i=0;i<60;i++)h.step();const s=h.state(),proof=h.scenario('window.__boundaryProof');
 assert.equal(s.authority.failureCode,null);assert.ok(proof.some(r=>r.phase==='shield'||r.outcome==='shield'),JSON.stringify(proof.slice(0,12)));
 assert.equal(s.deliveries.outByLastAction['dribble-touch'],0);assert.ok(s.ball.y>0);
});


test('a metric-only snapshot gets an anatomical fallback rig, while the live supplied rig stays exact',()=>{
 const h=attackingHost(748);const r=h.scenario(`(()=>{${liveScene}
  const s=liveV2Snapshot(1),frame=liveV2Authority.planTick(s);if(!frame)throw Error('no live frame');liveV2Authority.commitTick(frame);
  const world=liveV2Authority.exportState().domain.world;
  return world.players.map(p=>({rig:p.contactRig,live:s.players.find(q=>q.id===p.id).contactRig}));
 })()`);
 for(const p of r){assert.ok(p.rig.bodyRadiusM<.3);assert.deepEqual(p.rig,p.live);}
 // Source contract: snapshot units convert positions; a missing renderer rig
 // uses the anatomical default, never a55-world-unit body in a metric world.
});
