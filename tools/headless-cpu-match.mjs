// Render-free Node runner for the real match host, including keepers, referee,
// presentations, restarts and the V2 period clock. No browser or network.
// node tools/headless-cpu-match.mjs --url-file /path/match-url.txt --seeds 1,2 --minutes 2
import fs from 'node:fs';
import {createChallengeMetrics} from './challenge-metrics.mjs';
import {createKnockOnMetrics} from './knock-on-metrics.mjs';
import {createLooseRaceMetrics} from './loose-race-metrics.mjs';
import { createDeliveryMetrics } from './delivery-metrics.mjs';
import { createAttackMetrics } from './attack-metrics.mjs';
import { createCombinationMetrics } from './combination-metrics.mjs';
import { createCohesionMetrics } from './cohesion-metrics.mjs';
import { createWoodworkMetrics } from './woodwork-metrics.mjs';
import path from 'node:path';
import vm from 'node:vm';
import {performance as wallPerformance} from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createClock } = require('../match-engine/darty-video-capture.js');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const html = read('match-engine/match.html');
const sourceHashes = Object.fromEntries(['match-engine/match.html', 'match-engine/live-v2-authority-adapter.js', 'tools/headless-cpu-match.mjs', 'tools/cohesion-metrics.mjs', 'tools/attack-metrics.mjs', 'tools/delivery-metrics.mjs', 'tools/challenge-metrics.mjs', 'tools/loose-race-metrics.mjs', 'tools/knock-on-metrics.mjs', 'tools/combination-metrics.mjs', 'match-engine/dribbling-state-v2.js', 'match-engine/first-touch-v2.js', 'match-engine/movement-engine-v2.js', 'match-engine/live-v2-contact-authority-composer.js', 'match-engine/formation-behaviour-v2.js', 'match-engine/cpu-intelligence-v2.js',
  'match-engine/ball-engine-v2.js','match-engine/aerial-contact-v2.js','match-engine/first-touch-authority-adapter-v2.js',
  'match-engine/match-clock-v2.js','match-engine/live-v2-match-control-composition.js','match-engine/darty-video-capture.js']
  .map(filename => [filename, createHash('sha256').update(read(filename)).digest('hex')]));
const noop = () => {};

export function createCommitProgressMonitor() {
  let hostTicks = 0, liveHostTicks = 0, committedTick = 0, waiting = 0, maximum = 0, regressions = 0;
  const stallWindows = [];
  return {
    observe(live, committed) {
      hostTicks++;
      if (live) liveHostTicks++;
      if (committed < committedTick) regressions++;
      if (committed > committedTick) waiting = 0;
      else if (live) waiting++;
      // Pauses and presentations suspend this budget; only a commit resets it.
      // Observe the host independently of its watchdog and retain past stalls.
      maximum = Math.max(maximum, waiting);
      if (waiting === 600 && live) stallWindows.push({ hostTick: hostTicks, committedTick: committed });
      committedTick = committed;
    },
    snapshot: () => ({ hostTicks, liveHostTicks, lastCommittedTick: committedTick,
      maximumLiveTicksWithoutCommit: maximum, commitCounterRegressions: regressions,
      stallWindows: stallWindows.map(row => ({ ...row })) })
  };
}

export function countsAsFullTime(state, { stalled = false, capped = false } = {}) {
  return !state.matchAbandoned && state.phase === 'ended' && state.halfTime === true && state.fullTime === true &&
    !state.authority.failureCode && !stalled && !capped &&
    state.progress.liveHostTicks > 0 && state.progress.lastCommittedTick > 0 &&
    state.progress.maximumLiveTicksWithoutCommit < 600 && state.progress.commitCounterRegressions === 0;
}

export function createHeadlessMatch(inputUrl, { seed, minutes, keeperTrace = false, passRace = true, physicalTouch = true, scripted = false, humanInput = false, trainVisibility = true } = {}) {
  if(humanInput&&!scripted)throw new Error('human input fixtures require scripted mode');
  // CPU wall-time telemetry is observational. This runner has no renderer;
  // these timings must not be reported as rendered frame rate.
  const tickPerformance={samples:0,totalMs:0,maximumMs:0,longFrames:{over25Ms:0,over40Ms:0,over80Ms:0}};
  const url = new URL(inputUrl);
  const payload = JSON.parse(Buffer.from(new URLSearchParams(url.hash.slice(1)).get('flMatch'), 'base64url'));
  seed ??= payload.simulationSeed;
  payload.simulationSeed = seed;
  if (minutes !== undefined) payload.matchLengthMinutes = minutes;
  url.hash = 'flMatch=' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  url.searchParams.set('simulationSeed', String(seed));
  if (minutes !== undefined) url.searchParams.set('matchMinutes', String(minutes));
  // The supplied launch URL repeats this marker; the preflight rejects repeats.
  // Normalize the marker without changing spectator ownership or the payload.
  if(humanInput)url.searchParams.delete('autoplay');else url.searchParams.set('autoplay', '1');
  url.searchParams.set('volume', '0');
  if (!passRace) url.searchParams.set('labPassRace', '0');
  if (!physicalTouch) url.searchParams.set('labPhysicalTouch', '0');
  const clock = createClock(seed);
  const progress = createCommitProgressMonitor();
  const cohesion = createCohesionMetrics();
  const actions = createCombinationMetrics();
  const attack = createAttackMetrics();
  const deliveries = createDeliveryMetrics();
  const races = createLooseRaceMetrics();
  const challenges=createChallengeMetrics();
  const knockOns = createKnockOnMetrics();
  const woodwork = createWoodworkMetrics();
  const canvasContext = new Proxy({}, {
    get(object, key) {
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return object[key] || noop;
    }
  });
  function element() {
    return {
      style: {}, dataset: {}, children: [], textContent: '', value: '',
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, removeEventListener: noop, setAttribute: noop, removeAttribute: noop,
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...children) { this.children = children; },
      closest: () => null, before: noop, querySelector: () => null, querySelectorAll: () => [],
      getContext: () => canvasContext,
      getBoundingClientRect: () => ({ width: 640, height: 360, left: 0, top: 0 }),
      focus: noop, blur: noop, click: noop, remove: noop, toDataURL: () => ''
    };
  }
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, createElementNS: element, querySelector: () => null, querySelectorAll: () => [],
    body: element(), head: element(), documentElement: element(), addEventListener: noop, visibilityState: 'visible'
  };
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  Object.assign(context, {
    console, document, __trainVisibilityEnabled:trainVisibility&&!humanInput, __cohesion: cohesion, __actions: actions, __attack: attack, __deliveries:deliveries, __races: races, __knockOns:knockOns,__woodwork:woodwork,__challenges:challenges, location: url, navigator: { getGamepads: () => [], userAgent: 'Node fixed-tick host' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    performance: { now: clock.now }, setTimeout: clock.setTimeout, setInterval: clock.setInterval,
    clearTimeout: clock.clearTimer, clearInterval: clock.clearTimer,
    requestAnimationFrame: noop, cancelAnimationFrame: noop, addEventListener: noop, removeEventListener: noop,
    innerWidth: 640, innerHeight: 360, devicePixelRatio: 1,
    Image: class { addEventListener() {} }, fetch: async () => ({ ok: false }),
    getComputedStyle: () => ({ display: 'block' }),
    DartyStartup: { stage: noop, ready: noop, fail: noop }, DartyVideo: null, __random: clock.random,
    __now: () => 1700000000000 + clock.now()
  });
  context.window = context;
  context.parent = context;
  const execute = (code, filename) => vm.runInContext(code, context, { filename });
  execute('Math.random=__random;Date.now=__now;', 'headless-clock.js');
  execute(read('match-engine/vendor/three.min.js'), 'three.js');
  context.THREE.WebGLRenderer = class {
    constructor() { this.shadowMap = {}; this.info = { render: {} }; this.domElement = element(); }
    setPixelRatio() {} getPixelRatio() { return 1; } setSize() {} render() {}
    getSize(vector) { return vector.set(640, 360); }
  };
  execute(read('match-engine/darty-impact-v1.js'), 'darty-impact-v1.js');
  document.write = text => {
    const filename = text.match(/src="([^"?]+)/)?.[1];
    if (filename) execute(read('match-engine/' + filename), filename);
  };
  execute(html.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)[1], 'preflight.js');
  if (!context.__FL_V2_LIVE_PREFLIGHT.eligible) throw new Error('headless spectator preflight rejected');
  // Lab overrides stay in this VM; the browser capture gate and shipping
  // defaults remain unchanged. Record the adapter's actual profile in state.
  const movementApi=context.FootballLegacyMovementEngineV2;
  context.FootballLegacyMovementEngineV2={...movementApi,advance(...args){races.commands(args[1]);return movementApi.advance(...args);}};
  const authorityApi = context.FootballLegacyLiveV2Authority;
  context.FootballLegacyLiveV2Authority = { ...authorityApi, createAttachment: options =>
    authorityApi.createAttachment({ ...options, cpuPassRaceFilter: passRace, trueFeelPhysicalTouchAuthority: physicalTouch }) };
  const start = html.indexOf('<script>\n(function(){') + '<script>'.length;
  const end = html.lastIndexOf('</script>\n<script src="set-piece-system.js"');
  const bridge = `
    const observedLogEvent=logEvent;
    logEvent=function(...args){observedLogEvent(...args);const event=report.events[report.events.length-1];
      if(event){const actor=args[2],target=event.targetId&&[...you,...opp].find(p=>p.id===event.targetId),progress=attackDirection(event.team)===1?(ball.x-M)/(W-2*M):1-(ball.x-M)/(W-2*M);
        const dir=attackDirection(event.team),line=dir*offsideLine(event.team),tx=Number(event.intendedX??target?.x??ball.x);
        __races.event({...event,actorId:actor&&actor.id,time:performance.now()});
        __woodwork.event({...event,actorId:actor&&actor.id,time:performance.now()});
        __challenges.event({...event,actorId:actor?.id,time:performance.now()});
        __deliveries.event({...event,actorId:actor?.id,actorRole:actor&&positionFamily(actor),time:performance.now()});
        __knockOns.event({...event,actorId:actor?.id,time:performance.now(),cpu:!!actor&&!teamHasHumanController(actor.team),direction:dir,x:actor?(actor.x-M)*105/(W-2*M):null,y:actor?actor.y*68/H:null});
        const receiver=event.receiverId&&[...you,...opp].find(p=>p.id===event.receiverId),actorProgress=actor?(attackDirection(actor.team)===1?(actor.x-M)/(W-2*M):1-(actor.x-M)/(W-2*M)):null;
        __attack.event({...event,actorId:actor&&actor.id,actorRole:actor&&positionFamily(actor),actorTouches:actor?.stats?.touches,time:performance.now(),actorProgress,passOriginProgress:progress,
          shotPressureMetres:actor?Math.min(...teamList(other(actor.team)).filter(p=>!p.isGK&&!p.sentOff).map(p=>Math.hypot((p.x-actor.x)*105/(W-2*M),(p.y-actor.y)*68/H))):null,
          shotMissLateralMetres:event.ball?Math.abs((event.ball.y-H/2)*68/H):null,shotMissHeightMetres:event.ball?event.ball.z/PITCH_UNITS_PER_METRE+.11:null,
          shotDeflected:event.type==='shot-off-target'&&lastTouch!==event.team,
          receiverRole:receiver&&positionFamily(receiver),receiverProgress:receiver?(attackDirection(receiver.team)===1?(receiver.x-M)/(W-2*M):1-(receiver.x-M)/(W-2*M)):null,
          passProgressM:actor?dir*(tx-actor.x)*105/(W-2*M):0,behindLineM:(dir*tx-line)*105/(W-2*M)});
        __actions.event({...event,actorId:actor&&actor.id,time:performance.now(),progress,inBox:progress>=1-16.5/105&&Math.abs(ball.y*68/H-34)<=20.16,
          defenderId:event.defenderId||(event.type==='ai-skill-selection'&&actor?teamList(other(actor.team)).filter(p=>!p.isGK&&!p.sentOff).sort((a,b)=>D(a,actor)-D(b,actor))[0]?.id:null),cpu:!!actor&&!teamHasHumanController(actor.team),nearestDefender:actor&&teamList(other(actor.team)).some(p=>!p.sentOff&&!p.isGK&&D(p,actor)<120),
          opponentGapMetres:actor?Math.min(...teamList(other(actor.team)).filter(p=>!p.sentOff&&!p.isGK).map(p=>Math.hypot((p.x-ball.x)*105/(W-2*M),(p.y-ball.y)*68/H))):null,
          distanceMetres:target?Math.hypot((Number(event.intendedX||target.x)-ball.x)*105/(W-2*M),(Number(event.intendedY||target.y)-ball.y)*68/H):null});}
      if(event&&(event.type==='pass'||event.type==='pass-resolved'))__cohesion.event({...event,
        progress:attackDirection(event.team)===1?(ball.x-M)/(W-2*M):1-(ball.x-M)/(W-2*M)});};
    const observedApplyDiveDecision=applyDiveDecision;
    applyDiveDecision=function(sequence,decision){
      const applied=sequence?.decisionApplied,prior=foulSequence,player=sequence?.player,
        cards=player?(player.stats.yellows||0)+(player.stats.reds||0):0;
      const result=observedApplyDiveDecision(sequence,decision);
      if(!applied&&sequence?.decisionApplied)__attack.event({type:'dive-outcome',decision,time:performance.now(),
        awarded:!!foulSequence&&foulSequence!==prior,penalty:!!foulSequence&&foulSequence!==prior&&!!foulSequence.penalty,
        booked:!!player&&(player.stats.yellows||0)+(player.stats.reds||0)>cards,ridiculous:sequence.performance==='rolling'});
      return result;
    };
    let cohesionTicks=0;
    const keeperTraceEnabled=${!!keeperTrace},keeperTraceRows=[];
    let keeperTraceShot=0;
    const keeperTraceLog=logEvent;
    logEvent=function(type,team,player,extra){
      keeperTraceLog(type,team,player,extra);
      if(!keeperTraceEnabled)return;
      if(type==='shot')keeperTraceShot=actionSequence;
      if(type==='shot'||type==='goal'||type==='shot-off-target'||type.startsWith('keeper-')){
        const event=report.events[report.events.length-1];
        const {player:playerName,shooter,carrier,...safe}=event;
        keeperTraceRows.push({...safe,shotId:keeperTraceShot,hostMs:performance.now(),
          action:player&&player.action,actionT:player&&player.actionT,
          duration:player&&player.keeperAnimationDuration,diveT:player&&player.diveT});
      }
    };
    const keeperTraceUpdate=updateGoalkeeper;
    updateGoalkeeper=function(gk){
      const before={action:gk.action,actionT:gk.actionT||0};
      keeperTraceUpdate(gk);
      if(keeperTraceEnabled&&(keeperDivingAction(gk.action)||['keeperLowScoop','keeperCatchChest','keeperParry'].includes(gk.action))&&
        (before.action!==gk.action||(gk.actionT||0)>before.actionT+1))
        keeperTraceRows.push({type:'animation-transition',shotId:keeperTraceShot,frame:clockFrames,hostMs:performance.now(),
          playerId:gk.id,team:gk.team,animation:gk.saveAnimation,action:gk.action,actionT:gk.actionT,duration:gk.keeperAnimationDuration});
    };
    const trainView={liveSamples:0,onScreenSamples:0,centreOnScreenSamples:0,visibleCarSum:0},trainProjectPoint=new THREE.Vector3();let trainViewTicks=0;
    function sampleTrainView(){
      if(!__trainVisibilityEnabled)return;
      const priorMode=cameraMode;cameraMode='dynamic';camFollow();cameraMode=priorMode;
      if(matchPhase!=='play'||liveV2ControlPhase()!=='live'||kickoffHeld||STADIUM_THEME!=='north-london'||++trainViewTicks%60!==0)return;
      camera.updateProjectionMatrix();camera.updateMatrixWorld(true);const p=trainWorldPosition(TRAIN_POSITION_SCRATCH,performance.now());let count=0;
      for(let car=-2;car<=2;car++){trainProjectPoint.set(p.x+car*168,p.y,p.z).project(camera);
        const visible=trainProjectPoint.z>=-1&&trainProjectPoint.z<=1&&Math.abs(trainProjectPoint.x)<=1&&Math.abs(trainProjectPoint.y)<=1;
        if(visible){count++;if(car===0)trainView.centreOnScreenSamples++;}}
      trainView.liveSamples++;trainView.visibleCarSum+=count;if(count)trainView.onScreenSamples++;
    }
    window.__headless={
      scenario(code){return eval(code);},
      keeperTrace:()=>({events:keeperTraceRows,teams:report.teams}),
      tick(){const live=matchPhase==='play'&&liveV2ControlPhase()==='live';
        try{DT=1;update();sampleTrainView();recordReplayFrame(performance.now());}catch(error){liveV2Stop(error);}
        const owner=logicalLivePossessionOwner();
        const lastActor=ball.owner||lastTouchPlayer,bx=(ball.x-M)*105/(W-2*M),by=(ball.y-H/2)*68/H,
          nearLine=live&&Math.min(bx,105-bx,34-Math.abs(by))<4;
        __deliveries.frame({time:performance.now(),live,physicalOwnerId:ball.owner?.id||null,players:[...you,...opp,ykeep,okeep].filter(Boolean),
          boundaryContext:nearLine?{x:bx,y:by,flight:ball.flightType,owned:!!ball.owner,knockOn:!!ball.directionalKnockOnContract,
            phase:lastActor?.touchPhase,action:lastActor?.action,speed:lastActor?Math.hypot(lastActor.vx*60*105/(W-2*M),lastActor.vy*60*68/H):0,
            pressureM:lastActor?Math.min(...teamList(other(lastActor.team)).filter(p=>!p.sentOff&&!p.isGK).map(p=>Math.hypot((p.x-lastActor.x)*105/(W-2*M),(p.y-lastActor.y)*68/H))):null}:null});
        __knockOns.frame({time:performance.now(),live,ownerId:owner?.id,physicalOwnerId:ball.owner?.id||null,knockOnActive:!!ball.directionalKnockOnContract,players:[...you,...opp,ykeep,okeep].filter(Boolean).map(p=>({id:p.id,team:p.team,x:(p.x-M)*105/(W-2*M),y:p.y*68/H}))});
        __attack.frame({time:performance.now(),live,ownerId:owner?.id,physicalOwnerId:ball.owner?.id||null,ball:{x:(ball.x-M)*105/(W-2*M),y:ball.y*68/H},players:[...you,...opp].map(p=>({id:p.id,team:p.team,isGK:p.isGK,direction:attackDirection(p.team),x:(p.x-M)*105/(W-2*M),y:p.y*68/H,touches:p.stats.touches}))});
        __races.frame({time:performance.now(),live,ownerId:owner?.id,ball:{x:(ball.x-M)*105/(W-2*M),y:(ball.y-H/2)*68/H,z:(ball.z||0)/PITCH_UNITS_PER_METRE,
          vx:(ball.vx||0)*60*105/(W-2*M),vy:(ball.vy||0)*60*68/H,isShot:ball.isShot,knockOn:!!ball.directionalKnockOnContract,flightType:ball.flightType},
          players:[...you,...opp].map(p=>({id:p.id,team:p.team,isGK:p.isGK,sentOff:p.sentOff,x:(p.x-M)*105/(W-2*M),y:(p.y-H/2)*68/H,
            vx:(p.vx||0)*60*105/(W-2*M),vy:(p.vy||0)*60*68/H,gait:p.gait,pace:p.attrs.pace}))});
        const challengeId=__actions.takeOnDefenderId(),challenged=challengeId&&liveV2PlayerById(challengeId);
        __actions.possession(owner&&{id:owner.id,team:owner.team,time:performance.now(),y:owner.y*68/H,
          progress:attackDirection(owner.team)===1?(owner.x-M)/(W-2*M):1-(owner.x-M)/(W-2*M),
          defenders:Object.fromEntries(teamList(other(owner.team)).filter(p=>!p.sentOff).map(p=>[p.id,attackDirection(owner.team)*(p.x-owner.x)*105/(W-2*M)])),
          defenderBehind:!!(challenged&&!challenged.sentOff&&attackDirection(owner.team)*(owner.x-challenged.x)>45)},live);
        if(live)__cohesion.possession({owner:owner&&{family:positionFamily(owner)},loose:!owner&&!ball.target});
        else __cohesion.possession({owner:null,loose:false});
        if(live&&++cohesionTicks%60===0){const source=owner||ball.lastKicker;
          __cohesion.sample({possessionTeam:source&&source.team,ownerId:owner&&owner.id,possessionAuthored:!!(owner||ball.target),attackingDirections:{you:attackDirection('you'),opp:attackDirection('opp')},ball:{x:(ball.x-M)*105/(W-2*M),y:ball.y*68/H},
            players:[...you,...opp].map(p=>({id:p.id,team:p.team,sentOff:p.sentOff,isGK:p.isGK,family:positionFamily(p),
              x:(p.x-M)*105/(W-2*M),y:p.y*68/H}))});}
        return{live,committed:liveV2AuthorityTotals.lastCommittedTick};},
      state:()=>({environment:{weather:CONFIG.weather,camera:CONFIG.camera,stadiumTheme:STADIUM_THEME,viewAspect:camera.aspect},trainVisibility:{...trainView,onScreenPct:trainView.liveSamples?trainView.onScreenSamples/trainView.liveSamples*100:null,centreOnScreenPct:trainView.liveSamples?trainView.centreOnScreenSamples/trainView.liveSamples*100:null,meanVisibleCars:trainView.liveSamples?trainView.visibleCarSum/trainView.liveSamples:null,measurement:'one live sample per second, real dynamic-camera projection of five car centres; frustum only, no occlusion test'},keeperReadEvidence:matchPhase==='ended'?{truncated:!!report.events[0]&&report.events[0].seq>1,
        events:report.events.filter(e=>['shot','keeper-read','keeper-reread','keeper-dive-start','keeper-save','keeper-beaten','keeper-deflection','goal','shot-off-target','block'].includes(e.type))
          .map(e=>({type:e.type,seq:e.seq,shotId:e.shotId,frame:e.frame,team:e.team,x:e.x,y:e.y,
            predictedY:e.predictedY,animation:e.animation,kind:e.kind,reason:e.reason,
            ball:e.ball?{x:e.ball.x,y:e.ball.y,z:e.ball.z}:null}))}:undefined,phase:matchPhase,matchAbandoned:typeof matchAbandoned==='undefined'?null:matchAbandoned,minute:minuteNow(),clockFrames,score:[youScore,oppScore],
        fullTimeOverlay:{visible:ftime.style.display==='block',score:ftScore.textContent,
          stats:ftStats.innerHTML,scorers:document.getElementById('ftScorers').children.map(p=>p.textContent)},
        authority:liveV2AuthorityTelemetry(),hostPhase:liveV2ControlPhase(),
        sentOffPlayers:[...you,...opp].filter(player=>player.sentOff).length,keeperOwns:!!(ball&&ball.owner&&ball.owner.isGK),
        redCards:[report.teams.you.reds,report.teams.opp.reds],yellowCards:[report.teams.you.yellows,report.teams.opp.yellows],
        matchStats:['you','opp'].map(team=>({shots:report.teams[team].shots,passes:report.teams[team].passes,
          completed:report.teams[team].completed,offsides:report.teams[team].offsides,
          onTarget:report.teams[team].onTarget,fouls:report.teams[team].fouls})),
        gameplayEligible:liveV2CanAdvance(),reset:inReset(),clockRunning,
        ball:{x:ball&&ball.x,y:ball&&ball.y,z:ball&&ball.z,speed:ball?Math.hypot(ball.vx,ball.vy,ball.zv):0,
          owned:!!(ball&&ball.owner),logicalOwned:!!liveV2Carrier(),shot:!!(ball&&ball.isShot)},
        hostPerformance:report.performance?{...report.performance,samples:undefined}:null,
        halfTime:report.events.some(e=>e.type==='half-time'),fullTime:report.events.some(e=>e.type==='full-time')})
    };
  `;
  execute(html.slice(start, end).replace('liveV2Tick=nextTick;', '__challenges.projection(frame.hostProjection,performance.now(),frame.cpu);__actions.frame(frame.cpu,frame.hostProjection);__attack.contact(frame.hostProjection,performance.now());__races.assignment(frame.hostProjection);__woodwork.frame(frame.hostProjection);liveV2Tick=nextTick;').replace('  setCameraMode(cameraMode,false);', bridge + '\n  setCameraMode(cameraMode,false);'), 'match-host.js');
  clock.advance(200); // The host's existing 180 ms automatic start.
  return {
    scenario(code) { if(!scripted)throw new Error('scripted fixture access not enabled');return context.__headless.scenario(code); },
    keeperTrace: () => context.__headless.keeperTrace(),
    state: () => ({ ...context.__headless.state(), progress: progress.snapshot(), cohesion: cohesion.snapshot(), actions: actions.snapshot(), attack: attack.snapshot(), deliveries:deliveries.snapshot(), races: races.snapshot(), knockOns:knockOns.snapshot(), woodwork:woodwork.snapshot(), challenges:challenges.snapshot(), performance:{headlessTickWall:{...tickPerformance,longFrames:{...tickPerformance.longFrames}},renderedFramesMeasured:false} }),
    step() { const began=wallPerformance.now();clock.advance(1000 / 60); const sample = context.__headless.tick(); progress.observe(sample.live, sample.committed);
      if(sample.live){const elapsed=wallPerformance.now()-began;tickPerformance.samples++;tickPerformance.totalMs+=elapsed;tickPerformance.maximumMs=Math.max(tickPerformance.maximumMs,elapsed);
        if(elapsed>25)tickPerformance.longFrames.over25Ms++;if(elapsed>40)tickPerformance.longFrames.over40Ms++;if(elapsed>80)tickPerformance.longFrames.over80Ms++;} }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
  const url = fs.readFileSync(option('url-file'), 'utf8').trim();
  const seeds = option('seeds', '2415640915,1713525629').split(',').map(Number);
  const minutes = Number(option('minutes', '2'));
  const maxTicks = Number(option('max-ticks', String((minutes * 60 + 900) * 60)));
  for (const seed of seeds) {
    // Run with --expose-gc on shared, memory-constrained hosts so a previous
    // match's VM and module graphs are reclaimed before constructing the next.
    global.gc?.();
    const started = Date.now(),cpuStarted=process.cpuUsage(),progressFile=option('progress-file',null);
    const gates = { passRace: option('pass-race', 'on') !== 'off', physicalTouch: option('physical-touch', 'on') !== 'off',trainVisibility:option('train-visibility','on')!=='off' };
    const match = createHeadlessMatch(url, { seed, minutes, ...gates });
    let state, tick = 0, stationaryTicks = 0, stalled = false;
    for (; tick < maxTicks; tick++) {
      if (tick % 600 === 0 && fs.statfsSync(root).bavail * fs.statfsSync(root).bsize < 6 * 1024 ** 3) throw new Error('free disk below 6 GiB');
      match.step();
      if (tick % 120 === 0) {
        state = match.state();
        if(progressFile&&tick%1200===0)fs.writeFileSync(progressFile,JSON.stringify({seed,tick,clockFrames:state.clockFrames,
          committedTick:state.progress.lastCommittedTick,phase:state.hostPhase,fault:state.authority.failureCode,
          wallSeconds:(Date.now()-started)/1000,cpuMicroseconds:process.cpuUsage(cpuStarted),rssBytes:process.memoryUsage.rss()}));
        stationaryTicks = state.hostPhase === 'live' && !state.ball.logicalOwned && state.ball.speed === 0
          ? stationaryTicks + 120 : 0;
        stalled = stationaryTicks >= 1800 || state.progress.stallWindows.length > 0;
        if (state.phase === 'ended' || state.authority.failureCode || stalled) break;
      }
    }
    state = match.state();
    console.log(JSON.stringify({ seed, minutes, gates, sourceHashes, ticks: tick + 1, wallSeconds: (Date.now() - started) / 1000,
      runnerResources:{cpuMicroseconds:process.cpuUsage(cpuStarted),rssBytes:process.memoryUsage.rss()},
      clockFinished: state.phase === 'ended', fullTimeReached: countsAsFullTime(state, { stalled, capped: tick >= maxTicks }),
      capped: tick >= maxTicks, stalled, ...state }));
  }
}
