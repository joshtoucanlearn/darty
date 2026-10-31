import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const require=createRequire(import.meta.url),Movement=require('../match-engine/movement-engine-v2.js');
const setup=`${liveScene}
 const sx=(W-2*M)/105,sy=H/68;
 const place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
 for(const [i,p]of you.entries())place(p,25,-28+i*3);
 for(const [i,p]of opp.entries())place(p,90,-28+i*3);
 const actor=you[8],defender=opp[0];place(actor,60,0);place(defender,62,0);
 Object.assign(ball,{owner:actor,x:actor.x+rad,y:actor.y,z:0,vx:0,vy:0,zv:0,kickerLock:0,target:null});
 window.__actor=actor;window.__defender=defender;
`;

for(const skill of ['bodyFeint','dragBack','flick-up'])test(`CPU ${skill} executes the real shared action once and changes physical play`,()=>{
 const h=attackingHost(161);
 const start=h.scenario(`(()=>{${setup}
  defender.slide=${skill==='flick-up'?12:0};
  const intent={playerId:actor.id,type:'take-on',dribbleId:'physical-case',reason:'fixture-exit',target:{x:actor.x+120,y:actor.y-100},maneuver:{skill:'${skill}',phase:'feint',defenderId:defender.id,situation:'low-challenge'}};
  const random=Math.random;Math.random=()=>0;
  try{liveV2ApplyCpuTouches({intelligence:[intent]});liveV2ApplyCpuTouches({intelligence:[intent]});}finally{Math.random=random;}
  return {x:actor.x,y:actor.y,bx:ball.x,by:ball.y,type:actor.skillType,lift:ball.zv,utility:actor.skillUtilityWindow&&actor.skillUtilityWindow.type,protection:liveV2Snapshot(1).players.find(p=>p.id===actor.id).skillProtection};
 })()`);
 if(skill==='flick-up'){
  assert.ok(start.lift>0);assert.equal(start.utility,'flickUp');assert.equal(start.protection.multiplier,.30);
 }else assert.equal(start.type,skill);
 let peak=0;
 for(let i=0;i<10;i++){h.step();peak=Math.max(peak,h.state().ball.z/30);}
 const end=h.scenario('({x:window.__actor.x,y:window.__actor.y,bx:ball.x,by:ball.y})');
 assert.ok(Math.hypot(end.x-start.x,end.y-start.y)>.5,JSON.stringify({skill,start,end}));
 assert.equal(h.state().actions.skills[skill],1,'one real shared event, no cosmetic duplicate');
 assert.equal(h.state().authority.failureCode,null);
 if(skill==='flick-up')assert.ok(peak>.6,JSON.stringify({peak}));
});

test('accepted shared skill multiplier changes the actual Movement challenge, only for the fooled defender',()=>{
 const run=(multiplier,defenderId='challenger')=>{
  const attrs={pace:80,acceleration:80,agility:80,balance:60,strength:80,control:60,defending:99,aggression:90};
  const world=Movement.createWorldState({tick:0,ballOwnerId:'carrier',bounds:{xMin:-20,xMax:20,yMin:-20,yMax:20},players:[
   {id:'challenger',teamId:'away',position:{x:0,y:0},facing:{x:1,y:0},attributes:attrs},
   {id:'carrier',teamId:'home',position:{x:1,y:0},facing:{x:-1,y:0},attributes:attrs,skillProtection:{defenderId,multiplier}}
  ]});
  const result=Movement.advance(world,[{id:'challenge',playerId:'challenger',tick:1,type:'stand-tackle',targetId:'carrier',direction:{x:1,y:0}}],20);
  return result.telemetry.contacts.find(c=>c.actorId==='challenger');
 };
 const ordinary=run(1),fooled=run(.30),other=run(.30,'another-defender');
 assert.equal(ordinary.outcome,'win');assert.equal(fooled.outcome,'contact-lost');assert.equal(fooled.skillTackleMultiplier,.30);
 assert.equal(other.outcome,ordinary.outcome);assert.equal(other.skillTackleMultiplier,1);
 assert.ok(fooled.actorScore<ordinary.actorScore);
});

test('a real boot poke can dispossess a carrier during a shared skill animation',()=>{
 const h=attackingHost(162,{humanInput:true}),r=h.scenario(`(()=>{${setup}
  place(actor,25,20);place(defender,90,20);
  const carrier=opp[8],challenger=you[0];place(carrier,61,0);place(challenger,59.5,0);
  Object.assign(ball,{owner:carrier,x:M+60*sx,y:H/2,z:0,vx:0,vy:0,zv:0,kickerLock:0,target:null});
  doSkillFor(carrier,'dragBack',{x:1,y:0},{moveX:1,moveY:0,sprint:false});
  // Replay a real accepted contact window, with the ball exposed on the
  // defender's side of the carrier. A poke stays loose, so no remote owner.
  Object.assign(ball,{owner:carrier,x:M+60*sx,y:H/2,z:0,vx:0,vy:0,zv:0});
  place(carrier,61,0);place(challenger,59.5,0);challenger.fx=1;
  const api=window.FootballLegacyMovementEngineV2,world=api.createWorldState({tick:5,ballOwnerId:carrier.id,
   players:[{id:carrier.id,teamId:carrier.team,position:{x:61,y:0},facing:{x:1,y:0},attributes:{control:20,balance:20,strength:20}},
    {id:challenger.id,teamId:challenger.team,position:{x:59.5,y:0},facing:{x:1,y:0},
      attributes:{defending:99,strength:99,aggression:99},action:{type:'stand-tackle',commandId:'real-skill-poke',targetId:carrier.id,
        direction:{x:1,y:0},startedTick:0,contactStartTick:3,contactEndTick:12,recoveryEndTick:30}}]}),
   result=api.advance(world,[],1,undefined,{position:{x:60,y:0,z:.11},velocity:{x:0,y:0,z:0},radius:.11}),
   contact=result.telemetry.contacts.find(c=>c.ballWon),poke=result.telemetry.pokes[0];
  liveV2TickCarrier=carrier;
  liveV2ApplyMovement({snapshotTick:6,movement:result.state.players.map(p=>({id:p.id,x:M+p.position.x*sx,y:H/2+p.position.y*sy,
   vx:p.velocity.x*sx/60,vy:p.velocity.y*sy/60,fx:p.facing.x,fy:p.facing.y,stamina:p.stamina,locomotionState:p.locomotionState,action:p.action})),
   movementBallOwnerId:null,logicalBallOwnerId:null,physicalBallSeparated:false,physicalChallengePoke:poke,
   possession:{ownerId:null},movementTelemetry:result.telemetry});
  return {won:!!contact,boot:contact?.ballContact,body:contact?.bodyContact,ballFirst:contact?.ballFirst,
   owned:ball.owner===carrier,loose:!ball.owner,skill:carrier.skill};
 })()`);
 assert.equal(r.won,true);assert.equal(r.boot,true);assert.equal(r.ballFirst,true);
 assert.equal(r.owned,false);assert.equal(r.loose,true);assert.equal(r.skill,0,'the host skill cannot override a real boot poke');
});
