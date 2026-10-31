import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Movement=require('../match-engine/movement-engine-v2.js');
function world({gap=1.2,type='stand-tackle',speed=4}={}){
 const action={commandId:'physical-challenge',type,targetId:'carrier',direction:{x:1,y:0},startedTick:0,
   contactStartTick:1,contactEndTick:12,recoveryEndTick:30,resolved:false};
 return Movement.createWorldState({tick:0,ballOwnerId:'carrier',players:[
  {id:'challenger',teamId:'home',position:{x:0,y:0},velocity:{x:speed,y:0},facing:{x:1,y:0},action,
   attributes:{defending:99,strength:99,aggression:99,acceleration:99}},
  {id:'carrier',teamId:'away',position:{x:gap,y:0},facing:{x:1,y:0},attributes:{control:1,balance:1,strength:1}}]});
}
const observation=(x,y=0,z=.11)=>({position:{x,y,z},velocity:{x:0,y:0,z:0},radius:.11});
test('a rating win cannot reach an owned ball through an opponent body',()=>{
 const r=Movement.advance(world({gap:.5}),[],1,undefined,observation(1.25));
 const contact=r.telemetry.contacts.find(c=>c.commandId==='physical-challenge');
 assert.ok(contact,'the bodies really meet');assert.equal(contact.bodyContact,true);assert.equal(contact.ballFirst,false);
 assert.notEqual(r.state.ballOwnerId,'challenger');assert.ok(contact.point&&contact.normal,'the referee receives actual geometry');
});
test('a real extended boot can meet the ball without inventing body contact or a fall',()=>{
 let state=world(),contact;for(let i=0;i<12&&!contact;i++){const r=Movement.advance(state,[],1,undefined,observation(.58,.10));state=r.state;contact=r.telemetry.contacts.find(c=>c.commandId==='physical-challenge');}
 assert.ok(contact);assert.equal(contact.ballFirst,true);assert.equal(contact.bodyContact,false);
 assert.ok(contact.point&&Number.isFinite(contact.ballContactTime));
});
test('a slide cannot touch an airborne ball just because its rating beats the carrier',()=>{
 const r=Movement.advance(world({gap:1.4,type:'slide-tackle',speed:8}),[],1,undefined,observation(.9,0,1.3));
 assert.ok(r.telemetry.contacts.every(c=>c.ballFirst!==true));assert.notEqual(r.state.ballOwnerId,'challenger');
});
test('distant opponents produce no physical action contact',()=>{
 const r=Movement.advance(world({gap:4,type:'slide-tackle',speed:8}),[],1,undefined,observation(4.3));
 assert.ok(!r.telemetry.contacts.some(c=>c.commandId==='physical-challenge'));
});

test('ball first is clean for the entire action at any follow-through speed',()=>{
 for(const slide of [true,false])for(const speed of [0,7,12]){
  const d=Movement.physicalChallengeDecision({bodyContact:true,ballFirst:true,slide,speed,offBall:true,officialTolerance:1});
  assert.equal(d.clean,true);assert.equal(d.chance,0);assert.equal(d.forced,false);
 }
});
test('man-first tackles foul, a separate action has no inherited immunity, and incidental bumps play on',()=>{
 for(const slide of [true,false]){
  const d=Movement.physicalChallengeDecision({bodyContact:true,ballFirst:false,slide,speed:7,officialTolerance:1});
  assert.equal(d.clean,false);assert.equal(d.forced,true);
 }
 const bump=Movement.physicalChallengeDecision({bodyContact:true,incidental:true,ballFirst:false,speed:9,offBall:true});
 assert.equal(bump.clean,true);assert.equal(bump.forced,false);
});
for(const type of ['slide-tackle','stand-tackle'])test(type+' registers physical follow-through after a real clean boot contact',()=>{
 let state=world(type==='slide-tackle'?{gap:2.3,type,speed:8}:{gap:1.2,type,speed:4}),first,later;
 // The owned ball is exposed well ahead of the carrier, on the tackler side.
 for(let i=0;i<27&&!later;i++){
  const r=Movement.advance(state,[],1,undefined,observation(type==='slide-tackle'?.9:.58,.1));state=r.state;
  for(const c of r.telemetry.contacts){if(c.commandId!=='physical-challenge')continue;
   if(c.ballWon)first=c;if(c.bodyContact&&c.ballFirst)later=c;}
 }
 assert.ok(first,'a real boot meets the ball first');assert.equal(first.ballFirst,true);
 assert.ok(later,'the recovery does not discard its later bodily impact');assert.equal(later.bodyContact,true);
 assert.ok(later.bodyContactTick>first.ballContactTick);assert.ok(later.point&&later.normal);
 const decision=Movement.physicalChallengeDecision({...later,slide:type==='slide-tackle',speed:9,offBall:true});
 assert.equal(decision.clean,true);assert.equal(decision.forced,false);
});

test('an observed host-driven actor is not integrated again by Movement',()=>{
 const state=Movement.createWorldState({players:[{id:'performer',teamId:'home',position:{x:1,y:2},velocity:{x:6,y:0},externalMotion:true}]});
 const r=Movement.advance(state,[],1);assert.deepEqual(r.state.players[0].position,{x:1,y:2});assert.equal(r.state.players[0].velocity.x,6);
});
test('a fallen body cannot create an upright shoulder collision or invisible standing barrier',()=>{
 const rig=Movement.createContactRig(),state=Movement.createWorldState({players:[
  {id:'fallen',teamId:'home',position:{x:0,y:0},bodyLow:true,contactRig:rig},
  {id:'runner',teamId:'away',position:{x:.3,y:0},velocity:{x:-3,y:0},contactRig:rig}]});
 const r=Movement.advance(state,[],1,undefined,observation(4));
 assert.ok(!r.telemetry.contacts.some(c=>c.type==='body-contact'));assert.ok(Math.abs(r.state.players.find(p=>p.id==='fallen').position.x)<1e-9);
});
