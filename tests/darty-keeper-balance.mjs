import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const candidate = fs.readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');
// Fixed published baseline: changing HEAD must not silently move the comparison.
const baseline = execFileSync('git', ['show', '498d413:match-engine/match.html'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
function section(source, start, end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a, start);
  return source.slice(a,b);
}
function harness(source) {
  const model=section(source, source.includes('function keeperShotContactEnvelope')?'function keeperShotContactEnvelope':'function keeperContactSaveModel', 'function goalkeeperOneVOneContext');
  const consumers=section(source, 'function penaltyKeeperChoiceCoversBall', 'function legacyKeeperContactEligible');
  return new Function(`
    const W=3344,H=2142,M=84,rad=12.75,BOX_D=500,BOX_H=1270,PITCH_UNITS_PER_METRE=(H-12)/68,GOAL_H=PITCH_UNITS_PER_METRE*7.32;
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const Math=Object.create(globalThis.Math);let rolls=[],calls=0;Math.random=()=>{calls++;return rolls.shift()??.5;};
    const AUTO=true,clockFrames=100,secondTeamHasHuman=()=>false;
    let ball,ykeep,okeep,report,events,assistCandidate,lastTouch,lastTouchPlayer,poss,lastKeeperParry;
    const logEvent=(type,team,gk,details)=>events.push({type,team,...details}),showEvent=()=>{},crowdReaction=()=>{};
    const countShotOnTarget=()=>{ball.onTargetCounted=true;};
    const keeperSaveAnimation=()=> 'chest-catch',keeperAnimationAction=()=> 'keeperCatchChest';
    const keeperDivingAction=action=>['dive','keeperForwardDive','keeperLowDive','keeperFullStretchMid','keeperFullStretchHigh','keeperFootSave','keeperHandJab','keeperCollapseSave','keeperLooseBallCover'].includes(action);
    const penaltyShotChoice=(y,z)=> (z>50?'top-':'bottom-')+(y<H/2?'left':'right');
    ${section(source,'function worldDistanceMetres','function worldX')}
    ${model}
    ${consumers}
    function setup(options={}){
      const team=options.team||'opp',dir=team==='opp'?1:-1,goalX=team==='opp'?W-M:M,shooterTeam=team==='opp'?'you':'opp';
      const gk={id:'keeper',name:'Keeper',team,x:goalX-dir*40,y:H/2+(options.placement||0)*GOAL_H/2,attrs:{keeper:options.rating||84},stats:{saves:0},action:options.action||'idle',keeperPose:'ready',positioningContract:{prepared:true},vx:0,vy:0};
      ykeep=team==='you'?gk:null;okeep=team==='opp'?gk:null;
      const speed=worldBallSpeedForMetresPerSecond(options.paceMps??28);
      ball={owner:null,isShot:true,shooter:{id:'shooter',name:'Shooter',team:shooterTeam},x:gk.x-dir*(options.distance??20),y:gk.y,z:options.height??10,vx:dir*speed,vy:0,zv:0,shotPower:options.power??.7,shotDistance:options.shotDistance??300,shotType:options.shotType||'normal',flightType:'shot'};
      if(options.penaltyChoice)gk.penaltyCommit={choice:options.penaltyChoice};
      report={teams:{you:{saves:0},opp:{saves:0}}};events=[];calls=0;rolls=options.rolls||[.5,.5];
      return gk;
    }
    return { setup,box:gk=>resolveKeeperBoxShotContest(gk),slow:()=>resolveSlowReachableKeeperSaveBeforeGoal(),model:(gk)=>keeperContactSaveModel(gk,ball,D(gk,ball),typeof keeperShotContactEnvelope==='function'?keeperShotContactEnvelope(gk).reach:92),snapshot:()=>({owner:ball.owner&&ball.owner.id,isShot:ball.isShot,events,calls,ball:{...ball}}) };
  `)();
}

test('standing keepers cannot collect shots beyond their physical contact envelope',()=>{
  for(const team of ['you','opp']){
    const old=harness(baseline),next=harness(candidate),options={team,distance:70,paceMps:28,rolls:[0,0]};
    assert.equal(old.box(old.setup(options)),true);
    assert.equal(next.box(next.setup(options)),false);
    assert.equal(next.snapshot().calls,0,'no save lottery without contact');
    assert.equal(next.snapshot().isShot,true);
  }
});

test('a real dive retains more reach than a standing keeper without reaching three metres',()=>{
  const game=harness(candidate);
  assert.equal(game.box(game.setup({distance:45,rolls:[0,0]})),false);
  assert.equal(game.box(game.setup({distance:45,action:'keeperFullStretchMid',rolls:[0,0]})),true);
  assert.equal(game.box(game.setup({distance:70,action:'keeperFullStretchMid',rolls:[0,0]})),false);
  assert.equal(game.box(game.setup({distance:10,height:80,rolls:[0,0]})),false);
  assert.equal(game.box(game.setup({distance:10,height:80,action:'keeperFullStretchHigh',rolls:[0,0]})),true);
});

test('the last-chance slow-ball path cannot gather fast shots or distant balls',()=>{
  const old=harness(baseline),next=harness(candidate);
  const fast={distance:20,paceMps:32,power:.85,rolls:[0,0]};
  old.setup(fast);next.setup(fast);
  assert.equal(old.slow(),true,'baseline classified this powerful shot as slow');
  assert.equal(next.slow(),false);
  next.setup({distance:70,paceMps:14,power:.2,rolls:[0,0]});
  assert.equal(next.slow(),false);
  next.setup({distance:10,paceMps:14,power:.2,rolls:[0,0]});
  assert.equal(next.slow(),true,'routine reachable rolls are still gathered');
});

test('a wrong penalty commitment cannot be rescued by the slow-ball path',()=>{
  const game=harness(candidate);
  game.setup({shotType:'chip-penalty',paceMps:14,power:.2,distance:10,penaltyChoice:'top-left',rolls:[0,0]});
  assert.equal(game.slow(),false);
  assert.equal(game.snapshot().owner,null);
});

test('a beaten keeper does not immediately reroll the same shot through another save path',()=>{
  const game=harness(candidate),gk=game.setup({paceMps:14,power:.2,distance:10,rolls:[.999,0,0]});
  assert.equal(game.box(gk),false);
  assert.equal(game.box(gk),false);
  assert.equal(game.slow(),false);
  assert.equal(game.snapshot().calls,1);
  assert.equal(game.snapshot().isShot,true);
});

function sample(source,options){
  const game=harness(source);let saved=0,caught=0;
  for(let i=0;i<1000;i++){
    const gk=game.setup({...options,rolls:[(i+.5)/1000,((i*37)%1000+.5)/1000]});
    if(game.box(gk))saved++;
    if(game.snapshot().owner)caught++;
  }
  return{saved,caught,parried:saved-caught};
}
const scenarios={
  gentleCentre:{paceMps:14,power:.2,distance:10,shotDistance:900},
  strongCentre:{paceMps:32,power:.9,distance:20,shotDistance:300},
  strongCorner:{paceMps:32,power:.9,distance:25,placement:.85,shotDistance:300}
};
const comparison=Object.fromEntries(Object.entries(scenarios).map(([name,options])=>[name,{before:sample(baseline,options),candidate:sample(candidate,options)}]));
test('difficult contacts are less reliable while routine saves and rating differences remain',()=>{
  assert.ok(comparison.gentleCentre.candidate.saved>=850);
  assert.ok(comparison.strongCentre.candidate.saved<comparison.strongCentre.before.saved-150);
  assert.ok(comparison.strongCorner.candidate.saved<comparison.strongCentre.candidate.saved-100);
  assert.ok(comparison.strongCentre.candidate.parried/comparison.strongCentre.candidate.saved>comparison.strongCentre.before.parried/comparison.strongCentre.before.saved);
  assert.ok(sample(candidate,{...scenarios.strongCentre,rating:92}).saved>sample(candidate,{...scenarios.strongCentre,rating:60}).saved);
});
test('identical human-side and opponent-side situations receive identical treatment',()=>{
  for(const options of Object.values(scenarios))assert.deepEqual(sample(candidate,{...options,team:'you'}),sample(candidate,{...options,team:'opp'}));
});
console.log('Deterministic contact fixtures per 1000 attempts (not match scoring rates): '+JSON.stringify(comparison));
if(process.env.DARTY_KEEPER_PROOF)fs.writeFileSync(process.env.DARTY_KEEPER_PROOF,JSON.stringify({baseline:'498d413',kind:'controlled-contact-fixtures-not-match-scoring-rates',comparison},null,2));
