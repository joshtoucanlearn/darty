import test from 'node:test';
import assert from 'node:assert/strict';
import {createAttackMetrics} from '../tools/attack-metrics.mjs';
test('backward and own-third safety counters work entirely from release, control and shot events',()=>{
 const m=createAttackMetrics();
 m.event({type:'pass',team:'you',actorProgress:.2,passProgressM:-8,time:0});
 m.event({type:'pass-resolved',completed:true,receiverTeam:'you',receiverProgress:.15,time:500});
 m.event({type:'pass',team:'you',actorProgress:.15,passProgressM:0,time:1000});
 m.event({type:'pass-resolved',completed:false,receiverTeam:'opp',receiverRole:'striker',receiverProgress:.85,time:1500});
 m.event({type:'possession-gained',team:'opp',actorProgress:.85,time:1501});
 m.event({type:'shot',team:'opp',time:2500});m.event({type:'shot',team:'opp',time:3000});
 let c=m.snapshot().counts;
 assert.equal(c.backwardPasses,1);assert.equal(c.backwardCompleted,1);
 assert.equal(c.ownThirdBackwardPasses,1);assert.equal(c.ownThirdBackwardCompleted,1);
 assert.equal(c.defensiveThirdPasses,2);assert.equal(c.defensiveThirdCompleted,1);
 assert.equal(c.ownThirdTurnovers,1);assert.equal(c.ownThirdPassTurnovers,1);
 assert.equal(c.ownThirdTurnoversToShot,1);assert.equal(c.backwardSquareInterceptedByAttacker,1);
 assert.equal(c.ownThirdBackwardSquareInterceptedByAttacker,1);
 m.event({type:'possession-gained',team:'you',actorProgress:.2,time:4000});
 m.event({type:'possession-gained',team:'opp',actorProgress:.8,time:5000});
 m.event({type:'shot',team:'opp',time:15001});
 assert.equal(m.snapshot().counts.ownThirdTurnovers,2);
 assert.equal(m.snapshot().counts.ownThirdTurnoversToShot,1,'a shot outside ten seconds is excluded');
});
test('passing counts use actual releases, physical receiver movement and distinct on-ball contacts',()=>{
 const m=createAttackMetrics();
 for(let i=0;i<=60;i++)m.frame({time:i*1000/60,live:true,ownerId:'a',players:[{id:'a',team:'you',x:20,y:0,touches:0},{id:'b',team:'you',x:25+i/60*2,y:0,touches:0}]});
 m.event({type:'v2-dribble-state',actorId:'a',touchSequence:1,animationPhase:'dribble-contact',time:300});
 m.event({type:'v2-dribble-state',actorId:'a',touchSequence:1,animationPhase:'dribble-contact',time:400});
 m.event({type:'pass',actorId:'a',team:'you',passProgressM:12,behindLineM:5,flightType:'long-pass',time:1000});
 m.event({type:'pass-resolved',receiverId:'b',completed:true,time:1000});
 m.event({type:'shot',team:'you',time:2000});
 const r=m.snapshot();assert.equal(r.counts.progressivePasses,1);assert.equal(r.counts.inBehindCompleted,1);assert.equal(r.counts.overTopToShot,1);
 assert.equal(r.averageTouchesBeforePass,2);assert.equal(r.averageSecondsBeforePass,1);assert.ok(Math.abs(r.averageReceiverMovementM-2)<1e-9);
});
test('save-to-corner replays count a direct save corner once; subsequent player control clears that attribution',()=>{
 const m=createAttackMetrics();m.event({type:'shot',team:'you',time:0});m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:300});
 m.event({type:'restart',team:'you',kind:'CORNER',time:12000});assert.equal(m.snapshot().counts.cornersFromSaves,1);
 m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:13000});
 m.frame({live:true,time:14000,ownerId:'def',players:[{id:'def',team:'opp',x:0,y:0,touches:1}]});
 m.event({type:'restart',team:'you',kind:'CORNER',time:15000});assert.equal(m.snapshot().counts.cornersFromSaves,1);
});
test('a rebound shot needs an actual keeper/woodwork contact in the same attacking sequence',()=>{
 const m=createAttackMetrics();m.event({type:'shot',team:'you',time:0});m.event({type:'shot',team:'you',time:500});assert.equal(m.snapshot().counts.reboundShots,0);
 m.event({type:'keeper-save',actorId:'gk',team:'opp',outcome:'parried',time:600});m.event({type:'shot',team:'you',time:1000});assert.equal(m.snapshot().counts.reboundShots,1);
 m.event({type:'woodwork',time:1100});m.frame({live:true,time:1150,ownerId:'def',players:[{id:'def',team:'opp',x:0,y:0,touches:1}]});
 m.event({type:'shot',team:'you',time:1200});assert.equal(m.snapshot().counts.reboundShots,1);
});

test('receiver motion is sampled before first physical contact, excluding a later directional receiving roll',()=>{
 const m=createAttackMetrics();m.event({type:'pass',actorId:'a',targetId:'b',team:'you',time:0,flightType:'ground-pass'});
 for(let i=0;i<=60;i++)m.frame({time:i*1000/60,live:true,ownerId:null,players:[{id:'b',team:'you',x:i/60*.5,y:0}]});
 m.event({type:'reception',actorId:'b',team:'you',intent:'directional-touch',time:1000});
 for(let i=61;i<=120;i++)m.frame({time:i*1000/60,live:true,ownerId:null,players:[{id:'b',team:'you',x:.5+(i-60)/60*10,y:0}]});
 m.event({type:'pass-resolved',completed:true,receiverId:'b',time:2000});
 assert.ok(Math.abs(m.snapshot().averageReceiverMovementM-.5)<1e-9);
});
test('an actual first-time layoff contributes one touch and zero holding time',()=>{
 const m=createAttackMetrics();m.event({type:'reception',actorId:'b',team:'you',time:1000});
 m.event({type:'pass',actorId:'b',team:'you',authority:'cpu-v2-first-time',time:1000});
 assert.equal(m.snapshot().averageTouchesBeforePass,1);assert.equal(m.snapshot().averageSecondsBeforePass,0);
});

test('a completed ball in behind can lead to a shot through an extra same-team pass, credited once',()=>{
 const m=createAttackMetrics(),pass=(actorId,team,time,behindLineM,completed=true)=>{
  m.event({type:'pass',actorId,team,time,passProgressM:8,behindLineM,flightType:'long-pass',loft:2});
  m.event({type:'pass-resolved',completed,receiverId:'receiver',time:time+100});};
 pass('a','you',0,4);pass('b','you',1000,-10);
 m.event({type:'shot',team:'you',time:2000});m.event({type:'shot',team:'you',time:2500});
 assert.equal(m.snapshot().counts.inBehindToShot,1);assert.equal(m.snapshot().counts.overTopToShot,1);
});

test('aerial control then shot requires a real descending aerial touch and the same player within two seconds',()=>{
 const m=createAttackMetrics(),touch=(id,z,at)=>m.contact({contact:{contactType:'first-touch',ownerCandidateId:id,presentation:{playerId:id,outcome:'controlled'}},ballTrace:{samples:[{position:{z},velocity:{z:-2}}]}},at);
 touch('a',1.2,0);m.event({type:'shot',actorId:'b',team:'you',shotType:'v2-driven',time:500});
 assert.equal(m.snapshot().counts.aerialControlThenShot,0);
 m.event({type:'shot',actorId:'a',team:'you',shotType:'v2-driven',time:1900});
 assert.equal(m.snapshot().counts.aerialControlThenShot,1);
 touch('a',.2,2100);m.event({type:'shot',actorId:'a',team:'you',shotType:'v2-driven',time:2200});
 assert.equal(m.snapshot().counts.aerialControlThenShot,1,'rolling first touches do not become aerial controls');
 touch('a',1,3000);m.event({type:'shot',actorId:'a',team:'you',shotType:'volley',time:3100});
 assert.equal(m.snapshot().counts.aerialControlThenShot,2,'an actual prior aerial control followed by a volley is also a touch-then-shot sequence');
 touch('a',1,4000);m.event({type:'shot',actorId:'a',team:'you',shotType:'v2-driven',time:6001});
 assert.equal(m.snapshot().counts.aerialControlThenShot,2,'a later shot is outside the protected sequence');
});
test('shot techniques, ground first-time cutbacks and miss categories count actual events separately',()=>{
 const m=createAttackMetrics();for(const shotType of ['v2-driven','v2-low-driven','v2-placed','v2-power','header','volley','overhead-kick','scissor-kick','penalty-chip','chip'])m.event({type:'shot',shotType,time:0});
 m.event({type:'shot',shotType:'v2-low-driven',firstTime:true,fromCutBack:true,time:10});
 for(const missKind of ['near-miss-wide','near-miss-over','wide','over','skied'])m.event({type:'shot-off-target',missKind});
 const r=m.snapshot();assert.equal(Object.values(r.shotTypes).reduce((a,b)=>a+b),11);
 assert.equal(r.shotTypes['low-driven'],2);assert.equal(r.counts.firstTimeGroundShots,1);assert.equal(r.counts.cutBackFirstTimeShots,1);
 assert.equal(r.counts.aerialFirstTimeShots,4);for(const key of ['nearMissWide','nearMissOver','missWide','missOver','skied'])assert.equal(r.counts[key],1);
});

test('miss categories use the real frame clearance and exclude a saved ball going out',()=>{
 const m=createAttackMetrics();m.event({type:'shot',actorId:'a',team:'you',shotType:'driven',shotPressureMetres:1,time:0});
 m.event({type:'shot-off-target',shotMissLateralMetres:4.2,shotMissHeightMetres:1});
 m.event({type:'shot-off-target',shotMissLateralMetres:0,shotMissHeightMetres:2.9});
 m.event({type:'shot-off-target',shotMissLateralMetres:0,shotMissHeightMetres:5});
 let c=m.snapshot().counts;assert.equal(c.nearMissWide,1);assert.equal(c.nearMissOver,1);assert.equal(c.skied,1);assert.equal(c.skiedHeavyPressure,1);
 m.event({type:'keeper-save',team:'opp',outcome:'parried',time:20});
 m.event({type:'shot-off-target',shotMissLateralMetres:4,shotMissHeightMetres:1});
 assert.equal(m.snapshot().counts.nearMissWide,1,'a save round the post is not a shot miss');
});

test('dive attempts stay separate from the final referee award, penalty and simulation booking',()=>{
 const m=createAttackMetrics();m.event({type:'dive',decision:'play-on',penaltyArea:true});
 m.event({type:'dive',decision:'attacker-foul'});m.event({type:'dive-outcome',decision:'attacker-foul',awarded:true,penalty:true});
 m.event({type:'dive',decision:'simulation'});m.event({type:'dive-outcome',decision:'simulation',awarded:true,booked:true,ridiculous:true});
 m.event({type:'dive',decision:'warning'});m.event({type:'dive-outcome',decision:'warning',awarded:false});
 const c=m.snapshot().counts;assert.equal(c.diveAttempts,4);assert.equal(c.diveBoxAttempts,1);assert.equal(c.divePlayOn,1);
 assert.equal(c.diveFoulsGiven,1);assert.equal(c.divePenaltiesGiven,1);assert.equal(c.diveSimulationBookings,1);assert.equal(c.ridiculousDiveCards,1);assert.equal(c.diveWarnings,0,'a rejected handoff is not a final warning');
});


test('directional-touch visibility stops on recontrol or the next release rather than measuring a later pass',()=>{
 for(const end of ['control','pass']){
  const m=createAttackMetrics(),p={id:'runner',team:'you',x:20,y:0};
  m.event({type:'directional-knock-on',actorId:p.id,time:0,touchTier:'sprint-forward-light'});
  m.frame({time:100,live:true,ownerId:null,players:[p],ball:{x:21,y:0}});
  if(end==='pass')m.event({type:'pass',actorId:p.id,team:'you',time:200});
  m.frame({time:200,live:true,ownerId:end==='control'?p.id:null,players:[p],ball:{x:50,y:0}});
  const row=m.snapshot().visibility['sprint-forward-light'];
  assert.equal(row.attempts,1);assert.equal(row.visibleBeyondTwoMetres,0);assert.equal(row.maximumGapM,1);
 }
});

test('dive performances and actual ref-punch impacts are counted without treating a scheduled scene as an impact',()=>{
 const m=createAttackMetrics();for(const performance of['subtle','flop','rolling'])m.event({type:'dive',performance,team:'you',time:0});
 m.event({type:'foul',scene:'refPunch',time:1000});assert.equal(m.snapshot().counts.refPunchScenes,0);
 m.event({type:'impact-sound',kind:'referee-punch',time:2000});const c=m.snapshot().counts;
 assert.equal(c.diveAttempts,3);assert.equal(c.diveSubtle,1);assert.equal(c.diveFlop,1);assert.equal(c.diveRolling,1);assert.equal(c.refPunchScenes,1);
});

test('physical blocks and their corners exclude a later intervening player touch',()=>{
 const m=createAttackMetrics();
 m.event({type:'block',team:'opp',blockedShot:true,looped:true,time:0});
 m.event({type:'restart',team:'you',kind:'CORNER',time:700});
 m.event({type:'block',team:'opp',openPlayCross:true,looped:false,time:1000});
 m.event({type:'restart',team:'you',kind:'CORNER',time:1700});
 m.event({type:'block',team:'opp',openPlayCross:true,controlled:true,time:2000});
 m.event({type:'reception',team:'you',time:2100});
 m.event({type:'restart',team:'you',kind:'CORNER',time:2500});
 const c=m.snapshot().counts;assert.equal(c.shotsBlocked,1);assert.equal(c.shotBlockLoops,1);assert.equal(c.shotBlocksToCorner,1);
 assert.equal(c.crossesBlocked,2);assert.equal(c.crossBlocksLoose,1);assert.equal(c.crossBlocksControlled,1);assert.equal(c.crossBlocksToCorner,1);
});

test('fake-cross sequences require passing the defender physically before a byline delivery',()=>{
 const m=createAttackMetrics();
 m.event({type:'skill',skill:'fake-shot',fakeCross:true,actorId:'wing',defenderId:'back',time:0});
 m.frame({time:1,live:true,players:[{id:'wing',team:'you',direction:1,x:90,y:20},{id:'back',team:'opp',x:91,y:18}]});
 m.frame({time:500,live:true,players:[{id:'wing',team:'you',direction:1,x:89,y:22},{id:'back',team:'opp',x:91,y:18}]});
 assert.equal(m.snapshot().counts.fakeCrossesBeaten,0,'retreating into space is not beating the defender');
 m.frame({time:900,live:true,players:[{id:'wing',team:'you',direction:1,x:93,y:23},{id:'back',team:'opp',x:91,y:18}]});
 m.event({type:'v2-cross',actorId:'wing',kind:'byline',time:1200});
 const c=m.snapshot().counts;assert.equal(c.fakeCrossesTried,1);assert.equal(c.fakeCrossesBeaten,1);assert.equal(c.fakeCrossNextCross,1);assert.equal(c.fakeCrossToByline,1);
});
