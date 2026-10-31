import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');

function functionSource(name){
  const marker=`function ${name}(`,start=source.indexOf(marker);assert.notEqual(start,-1,`missing ${name}`);const next=source.indexOf('\n  function ',start+marker.length);assert.notEqual(next,-1,`missing boundary after ${name}`);return source.slice(start,next).trim();
}

function declaration(name){
  const marker=`const ${name}=`,start=source.indexOf(marker);assert.notEqual(start,-1,`missing ${name}`);const end=source.indexOf(';',start);assert.notEqual(end,-1);return source.slice(start,end+1);
}

let now=1000;
const sandbox={performance:{now:()=>now},clamp:(value,min,max)=>Math.max(min,Math.min(max,value))};
vm.createContext(sandbox);
vm.runInContext([
  declaration('CONTACT_FALL_DURATIONS'),declaration('CONTACT_PRESENTATION_FRAMES'),declaration('CONTACT_PRESENTATION_FRAME_MS'),declaration('PITCH_PLANE_CONTACT_ACTIONS'),
  ...['clearLatchedLobAim','latchLobAim','consumeLobAim','directionalSwitchGestureGate','holdContactPresentation','clearContactPresentation','contactPresentationState','shiftContactPresentationTimers','stageStandingTacklePresentation','contactRenderRootY','stageAutonomousContactPresentation'].map(functionSource),
  'globalThis.api={clearLatchedLobAim,latchLobAim,consumeLobAim,directionalSwitchGestureGate,holdContactPresentation,contactPresentationState,shiftContactPresentationTimers,stageStandingTacklePresentation,contactRenderRootY,stageAutonomousContactPresentation};'
].join('\n'),sandbox);
const api=sandbox.api;

test('held LS goal-kick aim survives a neutral Square release and clears after consumption',()=>{
  const state={lobAimX:0,lobAimY:0,lobAimMagnitude:0};
  assert.equal(api.latchLobAim(state,{x:.8,y:.6,strength:1}),true);
  assert.equal(api.latchLobAim(state,{x:0,y:0,strength:0}),false);
  const release=api.consumeLobAim(state,{x:0,y:0,strength:0});
  assert.equal(release.buffered,true);assert.ok(Math.abs(release.x-.8)<1e-9);assert.ok(Math.abs(release.y-.6)<1e-9);assert.equal(release.strength,1);
  assert.deepEqual([state.lobAimX,state.lobAimY,state.lobAimMagnitude],[0,0,0]);
  assert.deepEqual(api.consumeLobAim(state,{x:-.25,y:.5,strength:.55}),{x:-.25,y:.5,strength:.55});
  assert.match(source,/if\(state\.lobCharging\)latchLobAim\(state,/);assert.match(source,/doLobPassFor\(controlled,power,false,mode,releaseAim\)/);assert.match(source,/doLobPassFor\(controlledOpp,power,true,mode,releaseAim\)/);
});

test('L1 plus RS knock-on consumes switching until RS returns neutral',()=>{
  const state={knockOnLatched:true,knockOnSwitchConsumed:true,manualSwitchFlickLatched:false};
  assert.equal(api.directionalSwitchGestureGate(state,.92),false);assert.equal(state.manualSwitchFlickLatched,false);
  assert.equal(api.directionalSwitchGestureGate(state,.1),false);assert.equal(state.knockOnSwitchConsumed,false);assert.equal(state.knockOnLatched,false);
  assert.equal(api.directionalSwitchGestureGate(state,.92),true);assert.equal(state.manualSwitchFlickLatched,true);
  assert.equal(api.directionalSwitchGestureGate(state,.92),false);
});

test('stand-tackle windup and miss are visible without awarding possession',()=>{
  const player={action:'idle',actionT:0,x:4,y:7,vx:1,vy:-1,ownerToken:'unchanged'};
  api.stageStandingTacklePresentation(player,'windup',now);assert.equal(api.contactPresentationState(player,now+80).action,'standingTackleWindup');
  now+=120;api.stageStandingTacklePresentation(player,'miss',now);player.action='idle';player.actionT=0;
  const held=api.contactPresentationState(player,now+100);assert.equal(held.action,'standingTackleMiss');assert.equal(held.held,true);
  assert.deepEqual({x:player.x,y:player.y,vx:player.vx,vy:player.vy,ownerToken:player.ownerToken},{x:4,y:7,vx:1,vy:-1,ownerToken:'unchanged'});assert.equal('owner' in player,false);
  assert.equal(api.contactPresentationState(player,now+500).held,false);
});

test('slide/fall contact holds survive one-to-six gameplay ticks and roots stay on pitch plane',()=>{
  const victim={action:'fallTwist',actionT:64};api.holdContactPresentation(victim,'fallTwist',64,now);victim.action='idle';victim.actionT=0;
  assert.equal(api.contactPresentationState(victim,now+6*(1000/60)).action,'fallTwist');
  assert.equal(api.contactRenderRootY('fallTwist',-2.4,false),0);assert.equal(api.contactRenderRootY('slideContact',-1.1,false),0);assert.equal(api.contactRenderRootY('idle',-1.1,false),-1.1);assert.equal(api.contactRenderRootY('idle',-1.1,true),0);
  assert.equal(api.contactPresentationState(victim,now+65*(1000/60)).held,false);
});

test('autonomous contact stages both participants and delegates its geometry to the physical fall path',()=>{
  const actor={action:'idle',actionT:0,x:10,y:10,vx:2,vy:0},target={action:'idle',actionT:0,x:11,y:13,vx:1,vy:1};
  const contact={bodyContact:true,ballFirst:true,normal:{x:1,y:0,z:0},point:{x:10.5,y:11,z:.8},approachSpeedMps:3};
  let delegated;
  // This extracted presentation unit supplies its new physical dependency;
  // physical-contact-live separately exercises the actual fall implementation.
  sandbox.applyContactFall=(victim,offender,context)=>{delegated={victim,offender,context};api.holdContactPresentation(victim,'fallSide',44);return{action:'fallSide',duration:44};};
  const before={actor:[actor.x,actor.y,actor.vx,actor.vy],target:[target.x,target.y,target.vx,target.vy]};api.stageAutonomousContactPresentation(actor,target,'shoulder-contact',contact);
  assert.equal(actor.presentationAction,'shoulderBarge');assert.equal(target.presentationAction,'fallSide');assert.equal(delegated.victim,target);assert.equal(delegated.offender,actor);
  assert.equal(delegated.context.point,contact.point);assert.equal(delegated.context.normal,contact.normal);assert.equal(delegated.context.ballFirst,true);
  assert.deepEqual([actor.x,actor.y,actor.vx,actor.vy],before.actor);assert.deepEqual([target.x,target.y,target.vx,target.vy],before.target);assert.equal('owner' in actor,false);assert.equal('owner' in target,false);
});

test('pause preserves contact holds and cancels orphaned standing-tackle windups',()=>{
  const player={action:'fallSide',actionT:50},holdStartedAt=now;api.holdContactPresentation(player,'fallSide',50,holdStartedAt);const originalUntil=player.presentationActionUntil,pauseStartedAt=holdStartedAt+80;
  now=originalUntil+2400;assert.ok(now>originalUntil);for(let draw=0;draw<4;draw++)assert.equal(api.contactPresentationState(player,pauseStartedAt).action,'fallSide');assert.equal(player.presentationActionUntil,originalUntil);
  const pausedFor=now-pauseStartedAt;assert.equal(api.shiftContactPresentationTimers([player],pausedFor),1);assert.equal(player.presentationActionUntil,originalUntil+pausedFor);
  assert.equal(api.contactPresentationState(player,now+100).action,'fallSide');
  assert.match(source,/const presentationNow=paused&&pauseStartedAt\?pauseStartedAt:performance\.now\(\),presentation=contactPresentationState\(p,presentationNow\)/);
  assert.match(source,/if\(state\.dTapTimer\)\{clearTimeout\(state\.dTapTimer\);cancelStandingTackleWindup\(isSecond\?controlledOpp:controlled\);\}/);
  assert.match(source,/if\(dTapTimer\)\{clearTimeout\(dTapTimer\);cancelStandingTackleWindup\(controlled\);\}/);
  assert.match(source,/shiftContactPresentationTimers\(\[\.\.\.you,\.\.\.opp,ykeep,okeep\],deltaMs\)/);
});
