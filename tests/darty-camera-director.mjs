import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Camera from '../match-engine/darty-camera-director.js';
import loadCaptureHost from './fixtures/darty-capture-host.cjs';
import THREE from '../match-engine/vendor/three.min.js';
import { measureShotMotion } from '../tools/camera-motion-metrics.mjs';

const input={enabled:true,open:true,danger:false,x:500,z:0,width:2400,height:1500,ownerTeam:'you'};
function run(seed,seconds=360){
  const director=Camera.create(seed),cuts=[];
  for(let tick=0;tick<seconds*60;tick++){
    const row=director.step({...input,events:tick%30===0?[{type:'pass'}]:[]});
    if(row?.type==='directorCut')cuts.push(row);
  }
  return {cuts,state:director.snapshot()};
}

test('seeded live direction holds for 5 to 10 seconds, with 55 to 65 percent main wide',()=>{
  const a=run(2415640915),b=run(2415640915);
  assert.deepEqual(a,b);
  assert.notDeepEqual(a.cuts,run(43).cuts);
  assert.ok(a.cuts.length>30);
  for(const cut of a.cuts){assert.ok(cut.interval>=5&&cut.interval<=10);assert.equal(cut.phase,'play');assert.equal(cut.danger,false);}
  const share=a.state.durations.broadcast/a.state.liveSeconds;
  assert.ok(share>=.55&&share<=.65,String(share));
});

test('no deadline can force a cut through shots, crosses, tackles or keeper saves',()=>{
  for(const kind of ['shot','cross','tackle','save']){
    const director=Camera.create(9);director.step(input);
    for(let tick=0;tick<15*60;tick++){
      const row=director.step({...input,danger:true,[kind]:true,events:[{type:'pass'}]});
      assert.notEqual(row?.type,'directorCut');
    }
    const row=director.step({...input,events:[{type:'pass'}]});
    assert.equal(row.type,'directorCut');assert.equal(row.deferred,true);
  }
});

test('authored sequences and disabled fixed modes cannot cut; resumption starts on main wide',()=>{
  for(const phase of ['goal','celebration','replay','walkout','half-time','delivery']){
    const director=Camera.create(12);
    for(let tick=0;tick<600;tick++)director.step({...input,events:[{type:'pass'}]});
    assert.notEqual(director.snapshot().angle,'broadcast');
    for(let tick=0;tick<900;tick++)assert.equal(director.step({...input,open:false,phase,events:[{type:'pass'}]}),null);
    const resumed=director.step(input);
    assert.equal(resumed.type,'directorReturn');assert.equal(resumed.to,'broadcast');
    for(let tick=0;tick<299;tick++)assert.notEqual(director.step({...input,events:[{type:'pass'}]})?.type,'directorCut');
  }
  const director=Camera.create(1);
  for(let tick=0;tick<1200;tick++)assert.equal(director.step({...input,enabled:false,events:[{type:'pass'}]}),null);
  assert.equal(director.step({...input,danger:true,shot:true}),null,'a set-piece shot must finish before returning to main');
});

test('set-ups keep directed time and cadence running, including before the kick-off clock starts',()=>{
  for(const setupKind of ['FREE KICK','CORNER','THROW-IN','GOAL KICK','KICK OFF']){
    assert.equal(Camera.resolveScope({started:true,matchPhase:'play',clockRunning:false,setup:true}).directed,true);
    const director=Camera.create(2415640915),cuts=[];
    for(let tick=0;tick<1800;tick++){
      const row=director.step({...input,setup:true,setupKind,events:[]});if(row?.type==='directorCut')cuts.push(row);
    }
    assert.ok(cuts.length>=3);
    for(const row of cuts){assert.ok(row.interval>=5&&row.interval<=10);assert.equal(row.phase,'setup');assert.equal(row.setupKind,setupKind);}
  }
});

test('host camera ownership hands set-up to authored aim, run-up and strike without mutating readiness',()=>{
  const source=fs.readFileSync(new URL('../match-engine/match.html',import.meta.url),'utf8');
  const start=source.indexOf('  function liveCameraContext(){'),end=source.indexOf('  function tickLiveCameraDirector(){',start);
  const base={started:true,clockRunning:false,matchPhase:'play',paused:false,matchOver:false,halfTimeUntil:0,fullTimePresentationUntil:0,
    kickoffHeld:true,restartTaker:{team:'you'},restartMsg:'FREE KICK',restartReadySignalled:false,setPieceAim:{locked:false},setPieceCameraHold:null,
    externalSetPieceActive:false,FREE_KICK_PRACTICE:false,pendingFreeKickRunUp:null,pendingPenaltyRunUp:null,
    celebrate:0,goalReplay:{active:false},disciplineReplay:{active:false},diveReplay:{active:false},instantReplayReviewController:null,
    instantReplayReviewCameraHold:null,specialPSequence:{active:false},foulSequence:null,pendingDiveDecision:null,offsidePresentation:null,
    confrontationSequence:null,pendingCardFight:null,officialPauseUntil:0,performance:{now:()=>1000},
    ball:{isShot:false,owner:null},you:[],opp:[],ykeep:null,okeep:null,crossingAerialService:()=>false,
    liveRestartCameraPreset:()=> 'set-piece-special',window:{DartyCameraDirector:Camera}};
  const context=vm.createContext(base);vm.runInContext(source.slice(start,end),context);
  assert.equal(context.liveCameraContext().phase,'setup');assert.equal(context.liveCameraContext().open,true);
  context.restartReadySignalled=true;assert.equal(context.liveCameraContext().phase,'delivery');
  context.restartReadySignalled=false;context.pendingFreeKickRunUp={};assert.equal(context.liveCameraContext().open,false);
  context.pendingFreeKickRunUp=null;context.setPieceCameraHold={until:2000};assert.equal(context.liveCameraContext().open,false);
  context.setPieceCameraHold=null;context.foulSequence={active:true};assert.equal(context.liveCameraContext().phase,'authored');
  context.foulSequence=null;context.liveRestartCameraPreset=()=> 'broadcast';context.restartReadySignalled=true;
  assert.equal(context.liveCameraContext().phase,'setup','normal CPU set-up stays directed when ready');
  const expired={expires:500};context.pendingCardFight=expired;assert.equal(context.liveCameraContext().open,true);assert.equal(context.pendingCardFight,expired);
  for(const key of ['goalReplay','disciplineReplay','diveReplay','specialPSequence']){
    context[key].active=true;assert.equal(context.liveCameraContext().phase,'authored',key);context[key].active=false;
  }
  for(const key of ['foulSequence','pendingDiveDecision','offsidePresentation','confrontationSequence']){
    context[key]={active:true};assert.equal(context.liveCameraContext().open,false,key);context[key]=null;
  }
  for(const key of ['celebrate','halfTimeUntil','fullTimePresentationUntil','officialPauseUntil']){
    context[key]=2000;assert.equal(context.liveCameraContext().open,false,key);context[key]=0;
  }
  context.instantReplayReviewController={status:()=>({active:true})};assert.equal(context.liveCameraContext().open,false);
  context.instantReplayReviewController=null;context.matchPhase='walkout';assert.equal(context.liveCameraContext().open,false);
});

test('a calm safe deadline prevents an unexplained carry hold; protected flight can defer it',()=>{
  const director=Camera.create(6),cuts=[];
  for(let tick=0;tick<1200;tick++){
    const row=director.step({...input,settledCutAllowed:true,events:[]});if(row?.type==='directorCut')cuts.push(row);
  }
  assert.equal(cuts.length,2);for(const row of cuts){assert.ok(row.interval>=5&&row.interval<=10);assert.equal(row.beat,'settled-play');}
});

test('cuts need a fresh football beat; protected events discard queued beats',()=>{
  const director=Camera.create(1);
  for(let tick=0;tick<700;tick++)assert.notEqual(director.step(input)?.type,'directorCut');
  assert.equal(director.step({...input,events:[{type:'pass'},{type:'shot'}]}),null);
  for(let tick=0;tick<90;tick++)assert.equal(director.step(input),null);
  assert.equal(director.step({...input,events:[{type:'pass'}]}).beat,'pass-release');
  const save=Camera.create(3);
  for(let tick=0;tick<700;tick++)save.step(input);
  save.step({...input,events:[{type:'keeper-save'}]});
  for(let tick=0;tick<70;tick++)assert.equal(save.step({...input,events:[{type:'pass'}]}),null);
});

test('all live rigs preserve screen direction, high end only in the final third',()=>{
  const angles=new Set();
  for(const x of [-800,0,800]){
    const director=Camera.create(42);
    for(let tick=0;tick<36000;tick++){
      director.step({...input,x,events:tick%30===0?[{type:'pass'}]:[]});
      const {pose,angle}=director.snapshot();angles.add(angle);
      assert.ok(pose.z>pose.lz,'same touchline side and horizontal world-X projection');
      if(x===0)assert.notEqual(angle,'highEnd');
    }
  }
  assert.deepEqual([...angles].sort(),['broadcast','follow','highEnd','pitchside','tactical']);
});

test('a cut installs the new rig immediately; intra-shot motion is filtered',()=>{
  const director=Camera.create(42);let row;
  for(let tick=0;tick<800;tick++){
    row=director.step({...input,events:[{type:'pass'}]});
    if(row?.type==='directorCut')break;
  }
  const first=director.snapshot();
  assert.notEqual(first.angle,'broadcast');
  const heights={follow:300,tactical:850,pitchside:135,highEnd:520};
  assert.equal(first.pose.y,heights[first.angle]);
  director.step({...input,x:1000});
  assert.ok(Math.abs(director.snapshot().pose.lx-first.pose.lx)<4);
});

test('showcase cannot override fixed modes or switch on a shot or hit',()=>{
  const source=fs.readFileSync(new URL('../match-engine/darty-video-capture.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/cutUntil|setCamera\(|cycle=now%/);
});

test('each rig cuts onto an already composed thirds frame, with lead room in either direction',()=>{
  for(const angle of ['broadcast','follow','tactical','pitchside','highEnd'])for(const direction of [-1,1])for(const aspect of [16/9,9/16])for(const vx of [0,3]){
    const motion=Camera.createMotion(),data={...input,aspect,attackDirection:direction,vx,vz:0};
    const pose=motion.begin(data,angle,1,8),camera=new THREE.PerspectiveCamera(pose.fov,aspect,.1,20000);
    camera.position.set(pose.x,pose.y,pose.z);camera.lookAt(pose.lx,pose.ly,pose.lz);camera.updateMatrixWorld();
    const projected=new THREE.Vector3(input.x,12,input.z).project(camera);
    assert.ok(Math.abs(projected.x+direction/3)<1e-8,angle+' horizontal thirds');
    assert.ok(Math.abs(projected.y+1/3)<1e-8,angle+' vertical thirds');
  }
});

test('spring response is critically damped and never overshoots a held target',()=>{
  let value=0,velocity=0,previous=0;
  for(let i=0;i<300;i++){const state=Camera.spring(value,velocity,1,5);value=state.value;velocity=state.velocity;assert.ok(value>=previous&&value<=1);previous=value;}
  assert.ok(value>.999999);
});

test('dead zones remove foot jitter; direction, height and horizon remain held within a shot',()=>{
  const quiet=Camera.createMotion(),noise=Camera.createMotion(),data={...input,attackDirection:1,vx:0,vz:0};
  quiet.begin(data,'broadcast',1,8);noise.begin(data,'broadcast',1,8);
  for(let tick=0;tick<480;tick++){
    const a=quiet.step(data),b=noise.step({...data,x:data.x+Math.sin(tick*1.7)*2,z:Math.cos(tick*2.1)*2,attackDirection:tick%2?1:-1});
    assert.deepEqual(a,b);assert.equal(b.y,410);assert.equal(noise.snapshot().shot.direction,1);
    const pitch=Math.atan2(b.y-b.ly,Math.hypot(b.x-b.lx,b.z-b.lz));
    assert.ok(Math.abs(pitch-noise.snapshot().shot.pitch)<.0001);
  }
});

test('held tracking has bounded acceleration through reversals and zoom changes',()=>{
  const motion=Camera.createMotion();motion.begin({...input,attackDirection:1,vx:3,vz:0},'follow',1,8);
  const frames=[];
  for(let tick=0;tick<480;tick++){
    const pose=motion.step({...input,x:500+Math.sin(tick/90)*150,z:Math.cos(tick/90)*20,vx:tick<240?3:-3,vz:0});
    assert.equal(pose.y,300);if(tick%2)frames.push(pose);
  }
  const metrics=measureShotMotion(frames);
  assert.ok(metrics.angularDegreesPerSecondSquared.peak<2,JSON.stringify(metrics));
  assert.ok(metrics.positionMetresPerSecondSquared.peak<25,JSON.stringify(metrics));
  assert.ok(metrics.fovDegreesPerSecondSquared.peak<5,JSON.stringify(metrics));
});

test('display interpolation is smooth between ticks, cannot advance a shot and never blends across a cut',()=>{
  const motion=Camera.createMotion(),control=Camera.createMotion();
  const first=motion.begin(input,'broadcast',1,8);control.begin(input,'broadcast',1,8);
  const next=motion.step({...input,x:600});control.step({...input,x:600});
  assert.deepEqual(motion.sample(0),first);assert.deepEqual(motion.sample(1),next);
  const middle=motion.sample(.5);assert.ok(middle.x>Math.min(first.x,next.x)&&middle.x<Math.max(first.x,next.x));
  assert.equal(middle.y,410);assert.deepEqual(motion.sample(.5),middle);
  assert.deepEqual(motion.step({...input,x:650}),control.step({...input,x:650}));
  const cut=motion.begin({...input,x:900},'pitchside',1,6);
  assert.deepEqual(motion.sample(.2),cut);assert.deepEqual(motion.sample(.8),cut);
});

test('production capture uses the same fixed-tick direction batched and single-step',async()=>{
  const a=await loadCaptureHost({camera:'dynamic',seed:2415640915}),b=await loadCaptureHost({camera:'dynamic',seed:2415640915});
  a.dartyCapture.step(1500);
  for(let i=0;i<1500;i++)b.dartyCapture.step();
  const rows=host=>JSON.stringify(host.dartyCapture.events().filter(e=>e.type.startsWith('director')));
  assert.equal(rows(a),rows(b));
  assert.ok(a.dartyCapture.events().some(e=>e.type==='directorCut'));
  for(const row of a.dartyCapture.events().filter(e=>e.type==='directorCut')){
    assert.equal(row.context.open,true);assert.equal(row.context.danger,false);
  }
});
