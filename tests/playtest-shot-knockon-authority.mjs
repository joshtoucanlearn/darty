import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');

function section(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing source boundary: ${start}`);
  assert.ok(to > from, `missing source boundary: ${end}`);
  return html.slice(from, to);
}

const authoritySource = section('function legacyKeeperContactEligible', 'function calculateAddedMinutes');
const authority = new Function(`
  ${authoritySource}
  return { legacyKeeperContactEligible, legacyReceptionAuthorityAllows };
`)();

test('a resolved keeper-box shot is terminal for the rest of its update frame', () => {
  const contestSource = section('function resolveKeeperBoxShotContest', 'function resolveSlowReachableKeeperSaveBeforeGoal');
  const envelopeSource = section('function keeperShotContactEnvelope', 'function keeperContactSaveModel');
  const runtime = new Function(`
    const NativeMath=globalThis.Math,Math=Object.create(NativeMath),events=[];
    let rolls=[];
    Math.random=()=>rolls.length?rolls.shift():0;
    const M=80,W=3200,H=2050,BOX_D=500,BOX_H=800,rad=13,AUTO=true,clockFrames=900;
    const clamp=(value,minimum,maximum)=>NativeMath.max(minimum,NativeMath.min(maximum,value));
    const D=(a,b)=>NativeMath.hypot(a.x-b.x,a.y-b.y);
    const keeperContactSaveModel=()=>({pace:12,paceMps:24,saveChance:.82,placement:.5,power:.4});
    const keeperDivingAction=()=>false;
    ${envelopeSource}
    const penaltyKeeperChoiceCoversBall=()=>true,countShotOnTarget=()=>{};
    const keeperSaveAnimation=({secure})=>secure?'low-scoop':'hand-jab';
    const keeperAnimationAction=animation=>animation==='low-scoop'?'keeperLowScoop':'keeperHandJab';
    const report={teams:{opp:{saves:0}}},ykeep=null;
    const secondTeamHasHuman=()=>false,showEvent=()=>{},crowdReaction=()=>{};
    const logEvent=(type,team,actor,details)=>events.push({type,team,actorId:actor&&actor.id,...details});
    let controlled=null,controlledOpp=null,lastKeeperParry=null,assistCandidate=null,lastTouch=null,lastTouchPlayer=null,poss=0,ball=null;
    ${contestSource}
    ${authoritySource}
    return {
      run({forceSave=false,randomRolls=[]}={}){
        events.length=0;rolls=[...randomRolls];
        const shooter={id:'shooter',name:'Shooter',team:'you'};
        const keeper={id:'keeper',name:'Keeper',team:'opp',x:3120,y:1025,attrs:{keeper:90},stats:{saves:0},sentOff:false,positioningContract:{prepared:true}};
        ball={owner:null,isShot:true,shooter,shotType:'normal',flightType:'shot',x:3100,y:1025,z:12,vx:12,vy:0,zv:0,cool:0,keeperBypassId:null,keeperBypassUntil:0,target:null};
        const keeperShotResolved=resolveKeeperBoxShotContest(keeper,forceSave);
        if(legacyKeeperContactEligible(ball,keeperShotResolved))events.push({type:'keeper-claim',syntheticLegacyFallthrough:true});
        return {keeperShotResolved,ball:{ownerId:ball.owner&&ball.owner.id,isShot:ball.isShot,shooterId:ball.shooter&&ball.shooter.id,cool:ball.cool},events:[...events]};
      }
    };
  `)();

  const caught = runtime.run({ forceSave: true });
  assert.equal(caught.keeperShotResolved, true);
  assert.deepEqual(caught.ball, { ownerId: 'keeper', isShot: false, shooterId: null, cool: 0 });
  assert.equal(caught.events.filter(event => event.type === 'keeper-save').length, 1);
  assert.equal(caught.events.some(event => event.type === 'keeper-claim'), false);

  const parried = runtime.run({ randomRolls: [0, .99] });
  assert.equal(parried.keeperShotResolved, true);
  assert.equal(parried.ball.ownerId, null);
  assert.equal(parried.ball.cool, 8);
  assert.equal(parried.events.filter(event => event.type === 'keeper-save').length, 1);
  assert.equal(parried.events.some(event => event.type === 'keeper-claim'), false);

  assert.equal(authority.legacyKeeperContactEligible({ owner: null, cool: 0 }, false), true, 'unresolved legacy contacts remain available');
  assert.equal(authority.legacyKeeperContactEligible({ owner: null, cool: 0 }, true), false);
  assert.equal(authority.legacyKeeperContactEligible({ owner: { id: 'keeper' }, cool: 0 }, false), false);
});

test('the shooter cannot receive a still-live shot when the six-frame launch locks expire', () => {
  const shooter = { id: 'ljungberg' };
  const sameShooterProjection = { id: 'ljungberg' };
  const teammate = { id: 'pires' };
  const state = { isShot: true, shooter, cool: 0, kickerLock: 0, directionalKnockOnContract: null };

  assert.equal(authority.legacyReceptionAuthorityAllows(state, sameShooterProjection), false);
  assert.equal(authority.legacyReceptionAuthorityAllows(state, teammate), true);
  state.isShot = false;
  assert.equal(authority.legacyReceptionAuthorityAllows(state, sameShooterProjection), true, 'the source lock ends with the shot lifecycle');
});

test('generic reception cannot collapse a directional knock-on after eight frames', () => {
  const initiator = { id: 'lauren' };
  const defender = { id: 'moses' };
  const state = {
    isShot: false,
    shooter: null,
    cool: 0,
    kickerLock: 0,
    directionalKnockOnContract: { playerId: 'lauren', startedAt: 100, reacquireAfter: 107, reacquireMinimumDistance: 60 }
  };

  const eligibleAtFrame108 = [initiator, defender].filter(player => authority.legacyReceptionAuthorityAllows(state, player));
  assert.deepEqual(eligibleAtFrame108.map(player => player.id), ['moses'], 'the initiator stays with the knock-on authority while a defender may intercept');
  state.directionalKnockOnContract = null;
  assert.deepEqual([initiator, defender].filter(player => authority.legacyReceptionAuthorityAllows(state, player)).map(player => player.id), ['lauren', 'moses']);
});

test('the live update consumes both production authority predicates', () => {
  assert.match(html, /keeperShotResolved=resolveKeeperBoxShotContest\(boxKeeper\)/);
  assert.match(html, /if\(legacyKeeperContactEligible\(ball,keeperShotResolved\)\)/);
  assert.match(html, /!legacyReceptionAuthorityAllows\(ball,p\)/);
});
