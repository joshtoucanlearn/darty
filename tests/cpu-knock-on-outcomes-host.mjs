import test from 'node:test';
import assert from 'node:assert/strict';
import {attackingHost,liveScene} from './fixtures/attack-host-fixture.mjs';
const setup=`${liveScene}
 const sx=(W-2*M)/105,sy=H/68,place=(p,x,y)=>Object.assign(p,{x:M+x*sx,y:H/2+y*sy,vx:0,vy:0,fx:p.team==='you'?1:-1,fy:0});
 for(const [i,p]of you.entries())place(p,25,-28+i*3);
 for(const [i,p]of opp.entries())place(p,100,-28+i*3);
 place(ykeep,2,0);place(okeep,103,0);
 const actor=you[8];place(actor,40,20);Object.assign(actor.attrs,{control:99,pace:90,accel:90,agility:90,balance:90});
 Object.assign(ball,{owner:actor,x:actor.x,y:actor.y,z:0,vx:0,vy:0,zv:0,kickerLock:0,target:null});
`;
function outcome(h){
 for(let i=0;i<360&&h.state().knockOns.episodes[0]?.outcome==='pending';i++)h.step();
 assert.equal(h.state().authority.failureCode,null);
 const row=h.state().knockOns.episodes[0];assert.ok(row);assert.notEqual(row.outcome,'pending');return row;
}
test('every CPU tier is recorded from the real unchanged launch through physical recovery',()=>{
 for(const tier of ['baseline','light','strong','double']){
  const h=attackingHost(181);
  const launched=h.scenario(`(()=>{${setup}actor.vx=${tier==='baseline'?3.5:7.7}*PITCH_UNITS_PER_METRE/60;
   return liveV2LaunchDribbleKnockOn(actor,{dribbleId:'physical-${tier}',reason:'free-run',target:{x:actor.x+600,y:actor.y},maneuver:{knockOn:true,knockOnTier:'${tier}',situation:'free-run'}});
  })()`);
  assert.equal(launched,true);assert.equal(h.state().knockOns.attempts,1);
  const row=outcome(h);assert.ok(['same-player','teammate'].includes(row.outcome),JSON.stringify(row));
  assert.ok(row.secondsToOutcome>.1,'a lease at launch is not a recovery');assert.equal(row.situation,'free-run');
  console.log('SCRIPTED_KNOCK_OUTCOME',JSON.stringify({tier:row.tier,outcome:row.outcome,metresGained:row.metresGained,seconds:row.secondsToOutcome}));
 }
});
for(const winner of ['teammate','opponent'])test(`a real ${winner} boot meeting resolves the knock without crediting the initiator`,()=>{
 const h=attackingHost(182);
 h.scenario(`(()=>{${setup}
  const receiver=${winner==='teammate'?'you[7]':'opp[0]'};place(receiver,43.5,20);receiver.fx=-1;Object.assign(receiver.attrs,{control:99,balance:99,awareness:99,reactions:99});
  actor.vx=7.7*PITCH_UNITS_PER_METRE/60;
  // Force the existing physical touch to prove the outcome recorder even
  // when the CPU's choice check correctly refuses that losing launch.
  performDirectionalKnockOn(actor,{x:.75,y:0},false,null,{sprint:true});
 })()`);
 const row=outcome(h);assert.equal(row.outcome,winner,JSON.stringify(row));assert.ok(row.secondsToOutcome>0);
});
test('a frozen knock that actually crosses the field boundary records the real law restart as out of play',()=>{
 const h=attackingHost(183);
 h.scenario(`(()=>{${setup}place(actor,104,25);actor.vx=7.7*PITCH_UNITS_PER_METRE/60;Object.assign(ball,{owner:actor,x:actor.x,y:actor.y});
  if(liveV2LaunchDribbleKnockOn(actor,{dribbleId:'boundary',target:{x:actor.x+600,y:actor.y},maneuver:{knockOn:true,knockOnTier:'light',situation:'insufficient-runway'}}))throw Error('CPU must refuse a known field exit');
  performDirectionalKnockOn(actor,{x:.75,y:0},false,null,{sprint:true});
 })()`);
 const row=outcome(h);assert.equal(row.outcome,'out-of-play',JSON.stringify(row));assert.equal(row.reason,'GOAL KICK');
});

test('CPU choice refuses a known interception before touching the physical ball',()=>{
 const h=attackingHost(184);
 const result=h.scenario(`(()=>{${setup}place(opp[0],45,20);actor.vx=7.7*PITCH_UNITS_PER_METRE/60;
  const before=JSON.stringify({x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,owner:ball.owner?.id||null}),state=JSON.stringify(liveV2Authority.exportState());
  const launched=liveV2LaunchDribbleKnockOn(actor,{dribbleId:'covered-choice',target:{x:actor.x+600,y:actor.y},maneuver:{knockOn:true,knockOnTier:'double'}});
  return {launched,unchanged:before===JSON.stringify({x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy,owner:ball.owner?.id||null}),
   domainUnchanged:state===JSON.stringify(liveV2Authority.exportState()),choice:report.events.filter(e=>e.type==='cpu-knock-on-choice').at(-1)};
 })()`);
 assert.equal(result.launched,false,JSON.stringify(result));assert.equal(result.unchanged,true);assert.equal(result.domainUnchanged,true);
 assert.equal(result.choice.chosenTier,null);assert.ok(result.choice.checks.every(c=>c.opponent));
 assert.equal(h.state().knockOns.attempts,0,'a rejected choice is not an attempted physical touch');
});
test('CPU can downgrade a losing double touch through the same human planner',()=>{
 const h=attackingHost(185);
 const result=h.scenario(`(()=>{${setup}place(opp[0],65,27);actor.vx=7.7*PITCH_UNITS_PER_METRE/60;
  const launched=liveV2LaunchDribbleKnockOn(actor,{dribbleId:'tier-choice',reason:'wing-transition',target:{x:actor.x+1200,y:actor.y},maneuver:{knockOn:true,knockOnTier:'double',situation:'wing-transition'}});
  return {launched,choice:report.events.filter(e=>e.type==='cpu-knock-on-choice').at(-1)};
 })()`);
 assert.equal(result.launched,true,JSON.stringify(result));assert.notEqual(result.choice.chosenTier,'double',JSON.stringify(result));
 assert.ok(result.choice.checks[0].opponent,'the rejected double has a real earlier opponent interception');
 const row=outcome(h);assert.ok(['same-player','teammate'].includes(row.outcome),JSON.stringify(row));
 assert.equal(row.tier,result.choice.chosenTier);
 console.log('SCRIPTED_KNOCK_CHOICE',JSON.stringify({requested:'double',chosen:row.tier,outcome:row.outcome,checks:result.choice.checks}));
});

test('unavailable sprint tiers are rejected by the frozen human planner before any MR forecast',()=>{
 const h=attackingHost(188);
 const result=h.scenario(`(()=>{${setup}actor.vx=3.5*PITCH_UNITS_PER_METRE/60;
  const authority=liveV2Authority;let calls=0;
  liveV2Authority={...authority,planCpuKnockOn(...args){calls++;return authority.planCpuKnockOn(...args);}};
  const launched=liveV2LaunchDribbleKnockOn(actor,{dribbleId:'unavailable-sprint',target:{x:actor.x+1200,y:actor.y},maneuver:{knockOn:true,knockOnTier:'double'}});
  return {launched,calls,ownerRetained:ball.owner===actor};
 })()`);
 assert.equal(result.launched,false);assert.equal(result.ownerRetained,true);assert.equal(result.calls,0);
 assert.equal(h.state().knockOns.attempts,0);
});
