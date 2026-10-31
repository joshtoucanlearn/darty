'use strict';

/*
 * Football Legacy live V2 authority adapter.
 *
 * This is an explicit, offline-only migration seam. It projects the reviewed
 * deterministic Ball, Movement, CPU, Formation and Contact V2 modules into the existing
 * 3D match without taking ownership of rendering, cameras, controllers,
 * restarts, replays, officiating or presentation. Build 173 remains the
 * deliberate pre-match default. A component fault returns a fail-closed
 * sentinel to the host; the strict playtest host must halt rather than execute
 * a Build 173 gameplay tick.
 */
(function exposeLiveV2Authority(root, factory) {
  const localDribbling = typeof module === 'object' && module.exports
    ? require('./dribbling-state-v2.js')
    : null;
  const localMovement=typeof module==='object'&&module.exports?require('./movement-engine-v2.js'):null;
  const api = factory(root || null, localDribbling,localMovement);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyLiveV2Authority = api;
})(typeof window === 'object' ? window : null, function createLiveV2AuthorityApi(browserRoot, localDribbling,localMovement) {
  'use strict';

  const VERSION = '1.0.0-offline-live-authority-playtest';
  const ACKNOWLEDGEMENT = 'I understand FL V2 is an explicit offline playtest authority whose host must stop on a failed candidate transaction.';
  const SUPPORTED_WORKFLOWS = Object.freeze(['single-player', 'cpu-v-cpu']);
  const REQUIRED_DEPENDENCIES = Object.freeze([
    'ball', 'movement', 'cpu', 'formation', 'contact', 'dribbling'
  ]);
  const DEPENDENCY_CONTRACTS = Object.freeze({
    ball: Object.freeze({ version: '2.0.0-shadow', schemas: Object.freeze({
      STATE_SCHEMA: 'football-legacy-ball-v2-state', CONTEXT_SCHEMA: 'football-legacy-ball-v2-context',
      TRACE_SCHEMA: 'football-legacy-ball-v2-step-trace', LAUNCH_SCHEMA: 'football-legacy-ball-v2-launch-intent'
    }) }),
    movement: Object.freeze({ version: '2.0.0-dormant', schemas: Object.freeze({
      PLAYER_SCHEMA: 'football-legacy-movement-player-v2', WORLD_SCHEMA: 'football-legacy-movement-world-v2',
      TELEMETRY_SCHEMA: 'football-legacy-movement-telemetry-v2'
    }) }),
    cpu: Object.freeze({ version: '2.0.0-dormant', schemas: Object.freeze({
      SNAPSHOT_SCHEMA: 'football-legacy-cpu-snapshot-v2', MEMORY_SCHEMA: 'football-legacy-cpu-memory-v2',
      DECISION_SCHEMA: 'football-legacy-cpu-decision-v2'
    }) }),
    formation: Object.freeze({ version: '2.0.0-dormant', schemas: Object.freeze({
      REQUEST_SCHEMA: 'football-legacy-formation-request-v2', OUTPUT_SCHEMA: 'football-legacy-formation-output-v2',
      TELEMETRY_SCHEMA: 'football-legacy-formation-telemetry-v2', PHILOSOPHY_SCHEMA: 'football-legacy-philosophy-overlay-v2'
    }) }),
    contact: Object.freeze({ version: '1.0.0-offline-live-contact-composer-playtest', schemas: Object.freeze({
      REQUEST_SCHEMA: 'football-legacy-live-v2-contact-composer-request',
      RESULT_SCHEMA: 'football-legacy-live-v2-contact-composer-result',
      CAPABILITY_SCHEMA: 'football-legacy-live-v2-contact-composer-capability'
    }) }),
    dribbling: Object.freeze({ version: '2.0.0-offline-live-dribbling-state', schemas: Object.freeze({
      STATE_SCHEMA: 'football-legacy-dribbling-state-v2',
      REQUEST_SCHEMA: 'football-legacy-dribbling-request-v2',
      RESULT_SCHEMA: 'football-legacy-dribbling-result-v2',
      CAPABILITY_SCHEMA: 'football-legacy-dribbling-capability-v2',
      SERIALIZED_SCHEMA: 'football-legacy-dribbling-serialized-state-v2'
    }) })
  });
  const FIXED_TICK_SECONDS = 1 / 60;
  const METRIC_PITCH = Object.freeze({ xMin: 0, xMax: 105, yMin: -34, yMax: 34 });
  const LOOSE_BALL_MAX_HEIGHT_METRES = 1.05;
  const LOOSE_BALL_MAX_SPEED_METRES_PER_SECOND = 28;
  const LOOSE_BALL_MAX_ETA_SECONDS = 3.2;
  const LOOSE_BALL_INTENDED_ANTICIPATION_SECONDS = 0.28;
  const LOOSE_BALL_INTERCEPT_MIN_SECONDS = 0.1;
  const LOOSE_BALL_INTERCEPT_MAX_SECONDS = 0.85;
  const HUMAN_LOOSE_BALL_GUIDANCE_MAX_DISTANCE_METRES = 5.2;
  const HUMAN_LOOSE_BALL_GUIDANCE_MAX_ETA_SECONDS = 1.45;
  const HUMAN_RECEPTION_GUIDANCE_MAX_DISTANCE_METRES = 18;
  const HUMAN_RECEPTION_GUIDANCE_STRONG_INPUT = 0.62;
  const HUMAN_RECEPTION_GUIDANCE_OPPOSING_DOT = 0.10;
  const HUMAN_INPUT_RESPONSIVENESS_MULTIPLIER = 1.42;
  const CPU_PASS_RACE_MIN_MARGIN_TICKS = 6;
  const CPU_PASS_RECEIVER_READY_BUFFER_TICKS = 8;
  // D1 (19 Oct 2026): long balls take up to 2.4 s to come down, so the race
  // must follow them that far plus the receiver's six-tick margin.
  const CPU_PASS_RACE_MAX_TICKS = 180;
  const CPU_PASS_RACE_MAX_CONTACT_HEIGHT_METRES = 1.45;
  const CPU_PASS_MIN_DISTANCE_METRES = 5.5;
  const CPU_SHORT_LINK_MIN_DISTANCE_METRES = 3.5;
  const CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES = 4.5;
  const CPU_BYLINE_TARGET_BOUNDARY_MARGIN_METRES = 1.25;
  const CPU_REJECTED_PASS_COMMITMENT_TICKS = 6;
  const TURNOVER_TACKLE_PROTECTION_TICKS = 30;
  // Difficulty changes how quickly and ambitiously the CPU reads the match.
  // It never changes footballer speed, reach, collision, pass accuracy or shot
  // execution. Professional is byte-for-byte the CPU V2 default so older
  // callers that do not supply a difficulty keep their existing behaviour.
  const CPU_DECISION_PROFILES = Object.freeze({
    amateur: Object.freeze({ minimumReactionTicks: 4, maximumReactionTicks: 8, minimumBidScore: 126,
      maximumCommittedRuns: 2, defensivePressLeadTicks: 2, defensiveActionCooldownTicks: 42,
      routineProgressiveRunMinimumProgress: 260, routineProgressiveRunMinimumDistance: 310,
      routineProgressiveRunClearanceBonus: 26, routineProgressiveRunScoreAdvantage: 18,
      minimumCarryLaneClearance: 64 }),
    'semi-pro': Object.freeze({ minimumReactionTicks: 2, maximumReactionTicks: 6, minimumBidScore: 116,
      maximumCommittedRuns: 2, defensivePressLeadTicks: 3, defensiveActionCooldownTicks: 36,
      routineProgressiveRunMinimumProgress: 235, routineProgressiveRunMinimumDistance: 285,
      routineProgressiveRunClearanceBonus: 22, routineProgressiveRunScoreAdvantage: 14,
      minimumCarryLaneClearance: 59 }),
    professional: Object.freeze({ minimumReactionTicks: 1, maximumReactionTicks: 5, minimumBidScore: 108,
      maximumCommittedRuns: 3, defensivePressLeadTicks: 3, defensiveActionCooldownTicks: 30,
      routineProgressiveRunMinimumProgress: 210, routineProgressiveRunMinimumDistance: 260,
      routineProgressiveRunClearanceBonus: 18, routineProgressiveRunScoreAdvantage: 10,
      minimumCarryLaneClearance: 54 }),
    'world-class': Object.freeze({ minimumReactionTicks: 1, maximumReactionTicks: 4, minimumBidScore: 104,
      maximumCommittedRuns: 3, defensivePressLeadTicks: 4, defensiveActionCooldownTicks: 28,
      routineProgressiveRunMinimumProgress: 190, routineProgressiveRunMinimumDistance: 235,
      routineProgressiveRunClearanceBonus: 14, routineProgressiveRunScoreAdvantage: 8,
      minimumCarryLaneClearance: 51 }),
    legendary: Object.freeze({ minimumReactionTicks: 0, maximumReactionTicks: 3, minimumBidScore: 100,
      maximumCommittedRuns: 4, defensivePressLeadTicks: 4, defensiveActionCooldownTicks: 26,
      routineProgressiveRunMinimumProgress: 175, routineProgressiveRunMinimumDistance: 225,
      routineProgressiveRunClearanceBonus: 12, routineProgressiveRunScoreAdvantage: 6,
      minimumCarryLaneClearance: 49 }),
    ultimate: Object.freeze({ minimumReactionTicks: 0, maximumReactionTicks: 2, minimumBidScore: 96,
      maximumCommittedRuns: 4, defensivePressLeadTicks: 5, defensiveActionCooldownTicks: 24,
      routineProgressiveRunMinimumProgress: 165, routineProgressiveRunMinimumDistance: 220,
      routineProgressiveRunClearanceBonus: 10, routineProgressiveRunScoreAdvantage: 4,
      minimumCarryLaneClearance: 48 })
  });
  // One shared physical envelope is passed to Movement V2 for every human and
  // CPU challenge. It makes an already-pressed tackle readable for a little
  // longer without introducing a difficulty or controller advantage.
  const LIVE_MOVEMENT_CONTACT_CONFIG = Object.freeze({
    fixedTickSeconds: FIXED_TICK_SECONDS,
    tackleContactTicks: 8,
    tackleReach: 0.60,
    slideContactTicks: 12,
    slideReach: 0.90
  });
  const issuedCapabilities = new WeakSet();

  function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // D1 (19 Oct 2026): a CPU long pass is solved so the ball comes down through
  // contact height at the runner. Fitted to Ball V2 itself
  // (tools/pass-calibration.cjs): at 22 degrees the drop point is about
  // 1.95v - 19.4 metres, at 28 degrees about 2.1v - 17.6 metres. The old fixed
  // 18-23 m/s at ~22 degrees only ever carried 25-38 m, so every 40-70 m
  // release failed its own race and the carrier ran into pressure instead.
  // Releases of 20-30 m stay on the ground as driven passes (a defender standing
  // on the line can still cut them out); only longer releases are lofted.
  function cpuLongPassLaunch(distanceMetres, forceLoft) {
    const distance = finite(distanceMetres, 20);
    if (distance <= 30 && !forceLoft) return { speed: clamp(11 + distance * 0.45, 17, 24), liftAngleDeg: 0 };
    const drop = clamp(distance - 1.5, 15, 46);
    if (drop <= 31) return { speed: clamp((drop + 19.4) / 1.95, 17, 31), liftAngleDeg: 22 };
    return { speed: clamp((drop + 17.6) / 2.1, 17, 31), liftAngleDeg: 28 };
  }

  function cpuPassPaceMetresPerSecond(distanceMetres, shortSupport, long) {
    const distance = clamp(finite(distanceMetres, 0), 0, 70);
    if (long) return clamp(15 + distance * 0.18, 18, 23);
    if (shortSupport) return clamp(7.2 + distance * 0.38, 8.4, 14.5);
    return clamp(8 + distance * 0.42, 9.5, 17);
  }
  function keeperOutgoingContactPlan(input){
    if(input.sameOwnDistribution)return {allowed:false,separated:false};
    if(!input.sameOutgoingParry)return {allowed:true,separated:false};
    const b=input.ball,k=input.keeper,dx=b.x-k.x,dy=b.y-k.y,d=Math.hypot(dx,dy);
    const separated=Boolean(input.separated)||d>input.reach+.3;
    const pace=Math.hypot(b.vx,b.vy),closing=dx*(b.vx-k.vx)+dy*(b.vy-k.vy);
    // One hand contact cannot be caught/parried repeatedly while its outgoing
    // ball is still inside the broad dive envelope. A new opponent touch is
    // immediately eligible; the keeper can also chase and re-enter a ball
    // that has genuinely separated, or pick it up when it has settled.
    return {allowed:separated&&(closing<-.05||pace<.6),separated};
  }
  function contactPoseApi(){return localMovement||browserRoot&&browserRoot.FootballLegacyMovementEngineV2||null;}
  function keeperPoseLocalSide(worldSide,yaw){
    // diveSide belongs to world pitch-Y. A procedural roll/arm choice belongs
    // to mesh-local X; the axes reverse when the keeper faces the other end.
    return Math.sign(-finite(worldSide,1)*Math.sin(finite(yaw,0)))||Math.sign(finite(worldSide,1))||1;
  }

  function cpuPhysicalActionAllowed(transition, tick) {
    if (!transition) return true;
    if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(transition.startedTick)) return false;
    return tick > transition.startedTick + TURNOVER_TACKLE_PROTECTION_TICKS;
  }

  function cpuDifficultyConfig(value) {
    const requested = String(value || 'professional').toLowerCase();
    const level = Object.prototype.hasOwnProperty.call(CPU_DECISION_PROFILES, requested)
      ? requested : 'professional';
    return Object.freeze({ level, decisionOnly: true, overrides: CPU_DECISION_PROFILES[level] });
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const key of Object.keys(value)) output[key] = clone(value[key]);
    return output;
  }

  function deepFreeze(value, seen) {
    if (!value || typeof value !== 'object') return value;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], visited);
    return Object.freeze(value);
  }

  // Retired from the host's owned-ball update, verbatim arithmetic. Shared
  // by its existing human/CPU path and the defender's next-boot forecast.
  function ownedCarryPhase(o){
    const speed=Math.hypot(o.vx,o.vy),trueFeelControlledCarry=o.dribbleOutcome==='controlled-carry';
    return (o.touchPhase||0)+speed*(trueFeelControlledCarry?.035:.22);
  }
  function ownedCarryAnchorPlan(o,ball,env){
    const fd=Math.hypot(o.fx,o.fy)||1,speed=Math.hypot(o.vx,o.vy),trueFeelControlledCarry=o.dribbleOutcome==='controlled-carry',
      clockFrames=env.clockFrames,rad=env.rad,PITCH_UNITS_PER_METRE=env.unitsPerMetre,BALLR=env.ballRadius,
      firstTouch=o.firstTouch&&o.firstTouch.until>clockFrames?o.firstTouch:null,
      firstProgress=firstTouch?clamp((clockFrames-firstTouch.startedAt)/Math.max(1,firstTouch.duration),0,1):1,
      touch=trueFeelControlledCarry&&!firstTouch?0:Math.max(0,Math.sin(o.touchPhase))*8,
      firstSeparation=firstTouch?firstTouch.separation*Math.sin(firstProgress*Math.PI):0,
      anchorX=firstTouch?firstTouch.outX:o.fx/fd,anchorY=firstTouch?firstTouch.outY:o.fy/fd,
      controlledSeparation=trueFeelControlledCarry&&!firstTouch?clamp((Number(o.dribbleTargetSeparation)||.58)*PITCH_UNITS_PER_METRE,rad+BALLR+1,rad+BALLR+24):0,
      ahead=controlledSeparation||rad+7+speed*1.7+touch+firstSeparation,
      footSide=trueFeelControlledCarry&&!firstTouch?(o.dribbleFoot==='left'?-1:o.dribbleFoot==='right'?1:0):0,
      lateral=footSide*PITCH_UNITS_PER_METRE*.075,
      tx=o.x+anchorX*ahead-anchorY*lateral,ty=o.y+anchorY*ahead+anchorX*lateral;
    return {x:ball.x+(tx-ball.x)*.62,y:ball.y+(ty-ball.y)*.62,z:0,vx:o.vx,vy:o.vy,zv:0};
  }
  function stableHash(value) {
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash >>>= 0;
    return hash || 0x9e3779b9;
  }

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }

  function point(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      x: finite(source.x, fallback.x),
      y: finite(source.y, fallback.y)
    };
  }

  function vectorLength(value) {
    return Math.hypot(finite(value && value.x, 0), finite(value && value.y, 0));
  }

  function unit(value, fallback) {
    const source = point(value, fallback || { x: 1, y: 0 });
    const length = Math.hypot(source.x, source.y);
    if (length <= 1e-12) return point(fallback || { x: 1, y: 0 }, { x: 1, y: 0 });
    return { x: source.x / length, y: source.y / length };
  }

  function dependenciesFrom(options) {
    const supplied = options && options.dependencies || {};
    const root = browserRoot || {};
    return {
      ball: supplied.ball || root.FootballLegacyBallEngineV2,
      movement: supplied.movement || root.FootballLegacyMovementEngineV2,
      cpu: supplied.cpu || root.FootballLegacyCPUIntelligenceV2,
      formation: supplied.formation || root.FootballLegacyFormationBehaviourV2,
      contact: supplied.contact || root.FootballLegacyLiveV2ContactAuthorityComposer,
      dribbling: supplied.dribbling || localDribbling || root.FootballLegacyDribblingStateV2
    };
  }

  function keeperShotForecast(input,options){
    const api=dependenciesFrom(options).ball;if(!api)return null;
    let state=api.createBallState({id:'keeper-read',position:input.position,velocity:input.velocity,
      angularVelocity:input.angularVelocity||{x:0,y:0,z:0},grounded:input.position.z<=.111&&input.velocity.z<=0,settled:false}),
      context=api.createSimulationContext({seed:173}),previous=state.position;
    const direction=Math.sign(input.velocity.x)||1,plane=input.planeX;
    if(direction*(plane-previous.x)<=0)return null;
    for(let ticks=0;ticks<120;ticks+=12){
      const result=api.step(state,context,.2,{}),samples=result.trace.samples;
      for(let i=0;i<samples.length;i++){
        const point=samples[i].position;
        if(direction*(point.x-plane)>=0){
          const f=clamp((plane-previous.x)/(point.x-previous.x||1),0,1);
          return {x:plane,y:previous.y+(point.y-previous.y)*f,z:previous.z+(point.z-previous.z)*f,
            frames:ticks+(i+f)/4,velocity:{...samples[i].velocity}};
        }
        previous=point;
      }
      state=result.state;context=result.context;if(state.settled)return null;
    }
    return null;
  }

  function keeperDeflectionPlan(input,options){
    const cpu=dependenciesFrom(options).cpu;
    if(!cpu||typeof cpu.keeperDeflectionPlan!=='function')throw new Error('V2 keeper contact planner unavailable');
    return cpu.keeperDeflectionPlan(input);
  }

  function validateDependencies(dependencies) {
    const errors = [];
    if (!dependencies.ball || typeof dependencies.ball.step !== 'function' ||
        typeof dependencies.ball.resolveLaunch !== 'function') errors.push('ball-v2-api-missing');
    if (!dependencies.movement || typeof dependencies.movement.advance !== 'function' ||
        typeof dependencies.movement.createWorldState !== 'function') errors.push('movement-v2-api-missing');
    if (!dependencies.cpu || typeof dependencies.cpu.decide !== 'function' ||
        typeof dependencies.cpu.createMemory !== 'function') errors.push('cpu-v2-api-missing');
    if (!dependencies.formation || typeof dependencies.formation.resolve !== 'function' ||
        typeof dependencies.formation.validateLineup !== 'function') errors.push('formation-v2-api-missing');
    if (!dependencies.contact || typeof dependencies.contact.createCapability !== 'function' ||
        typeof dependencies.contact.compose !== 'function' ||
        !Number.isSafeInteger(dependencies.contact.MAX_REACTION_DELAY_TICKS) ||
        dependencies.contact.MAX_REACTION_DELAY_TICKS < 1) errors.push('contact-v2-api-missing');
    if (!dependencies.dribbling || typeof dependencies.dribbling.createCapability !== 'function' ||
        typeof dependencies.dribbling.resolve !== 'function' ||
        typeof dependencies.dribbling.serializeState !== 'function' ||
        typeof dependencies.dribbling.restoreState !== 'function') errors.push('dribbling-v2-api-missing');
    for (const name of REQUIRED_DEPENDENCIES) {
      const api = dependencies[name], contract = DEPENDENCY_CONTRACTS[name];
      if (!api || api.VERSION !== contract.version) errors.push(name + '-v2-version-mismatch');
      for (const [key, value] of Object.entries(contract.schemas)) {
        if (!api || api[key] !== value) errors.push(name + '-v2-' + key.toLowerCase().replaceAll('_', '-') + '-mismatch');
      }
    }
    return errors;
  }

  function createCapability(options) {
    const source = options && typeof options === 'object' ? options : {};
    const workflow = String(source.workflow || '');
    if (source.acknowledgement !== ACKNOWLEDGEMENT) throw new Error('explicit FL V2 acknowledgement is required');
    if (!SUPPORTED_WORKFLOWS.includes(workflow)) throw new Error('unsupported live V2 workflow: ' + workflow);
    if (source.online !== false) throw new Error('online must be explicitly false for live V2 authority');
    const onlineMarkers = source.onlineMarkers && typeof source.onlineMarkers === 'object' ? source.onlineMarkers : {};
    const activeMarkers = Object.keys(onlineMarkers).filter(key => {
      const value = onlineMarkers[key];
      return !(value == null || value === false || value === '' || (Array.isArray(value) && value.length === 0));
    });
    if (activeMarkers.length) throw new Error('online markers freeze live V2: ' + activeMarkers.sort().join(','));
    let controlOwnership = null;
    if (workflow === 'cpu-v-cpu') {
      const ownership = source.controlOwnership && typeof source.controlOwnership === 'object'
        ? source.controlOwnership : {};
      const humanPlayerIds = Array.isArray(ownership.humanPlayerIds) ? ownership.humanPlayerIds.map(String) : null;
      const cpuTeamIds = Array.isArray(ownership.cpuTeamIds) ? ownership.cpuTeamIds.map(String).sort() : null;
      if (!humanPlayerIds || humanPlayerIds.length !== 0 || !cpuTeamIds ||
          cpuTeamIds.length !== 2 || cpuTeamIds[0] !== 'opp' || cpuTeamIds[1] !== 'you') {
        throw new Error('CPU-v-CPU live V2 requires zero human players and exact you/opp CPU team ownership');
      }
      controlOwnership = Object.freeze({
        humanPlayerIds: Object.freeze([]),
        cpuTeamIds: Object.freeze(['opp', 'you'])
      });
    }
    const capability = Object.freeze({
      schema: 'football-legacy-live-v2-capability',
      version: VERSION,
      grant: 'offline-normal-match-live-authority',
      workflow,
      controlOwnership,
      offlineOnly: true,
      online: false,
      onlineMarkerDigest: activeMarkers.length ? activeMarkers.sort().join(',') : 'none',
      authority: Object.freeze({
        ballLaunchAndFlight: 'football-legacy-ball-engine-v2',
        ballGroundAndGoalFrameContact: 'football-legacy-ball-engine-v2',
        outfieldLocomotion: 'football-legacy-movement-engine-v2',
        outfieldPlayerContact: 'football-legacy-movement-engine-v2',
        cpuRunsAndCarrierIntent: 'football-legacy-cpu-intelligence-v2',
        teamShape: 'football-legacy-formation-behaviour-v2',
        looseBallRecoverySelection: 'football-legacy-live-v2-authority-adapter',
        firstTouchReception: 'football-legacy-live-v2-contact-authority-composer',
        aerialVolleyAttempt: 'football-legacy-live-v2-contact-authority-composer',
        dribblingPhysicalTouchesAndActionLease: 'football-legacy-dribbling-state-v2',
        goalkeepersSpecialActionsRenderingRulesRestartsReplays: 'build-173',
        wallKeeperAndOutfieldBodyBlock: 'build-173-explicit-contact-handoff'
      })
    });
    issuedCapabilities.add(capability);
    return capability;
  }

  function normalizeSnapshot(snapshot, workflow) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('live snapshot is required');
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 1) throw new TypeError('live snapshot tick must be a positive integer');
    if (Math.abs(finite(snapshot.fixedTickSeconds, 0) - FIXED_TICK_SECONDS) > 1e-12) {
      throw new RangeError('live snapshot fixed tick must be 1/60');
    }
    const pitch = snapshot.pitch && typeof snapshot.pitch === 'object' ? {
      xMin: finite(snapshot.pitch.xMin, NaN), xMax: finite(snapshot.pitch.xMax, NaN),
      yMin: finite(snapshot.pitch.yMin, NaN), yMax: finite(snapshot.pitch.yMax, NaN)
    } : null;
    if (!pitch || !(pitch.xMax > pitch.xMin) || !(pitch.yMax > pitch.yMin)) throw new TypeError('live pitch bounds are invalid');
    const units = snapshot.units && typeof snapshot.units === 'object' ? {
      xPerMetre: finite(snapshot.units.xPerMetre, NaN),
      yPerMetre: finite(snapshot.units.yPerMetre, NaN),
      zPerMetre: finite(snapshot.units.zPerMetre, NaN)
    } : null;
    if (!units || !(units.xPerMetre > 0) || !(units.yPerMetre > 0) || !(units.zPerMetre > 0)) {
      throw new TypeError('live metric conversion is invalid');
    }
    if (Math.abs((pitch.xMax - pitch.xMin) / units.xPerMetre - 105) > 1e-9 ||
        Math.abs((pitch.yMax - pitch.yMin) / units.yPerMetre - 68) > 1e-9) {
      throw new RangeError('live pitch units must map exactly to 105 by 68 metres');
    }
    const players = Array.isArray(snapshot.players) ? snapshot.players.map(player => {
      if (!player || typeof player.id !== 'string' || !player.id || !['you', 'opp'].includes(player.teamId)) {
        throw new TypeError('live player identity is invalid');
      }
      return {
        id: player.id, teamId: player.teamId, role: String(player.role || 'midfielder'),
        position: String(player.position || player.role || 'CM'), slotId: String(player.slotId || ''),
        x: finite(player.x, NaN), y: finite(player.y, NaN), vx: finite(player.vx, 0), vy: finite(player.vy, 0),
        fx: finite(player.fx, player.teamId === 'you' ? 1 : -1), fy: finite(player.fy, 0),
        carryAnchor:player.carryAnchor?clone(player.carryAnchor):null,
        contactRig:player.contactRig?.schema==='physical-contact-rig-v2'?player.contactRig:null,bodyLow:!!player.bodyLow,
        externalMotion:Array.isArray(snapshot.dribbling?.specialActionPlayerIds)&&snapshot.dribbling.specialActionPlayerIds.includes(player.id),
        radius: finite(player.radius, 12.75), stamina: clamp(finite(player.stamina, 100), 0, 100),
        heightM: clamp(finite(player.heightM, 1.8), 1.3, 2.2),
        attrs: clone(player.attrs || {}), isGK: Boolean(player.isGK), sentOff: Boolean(player.sentOff),
        contactEligible: player.contactEligible !== false,
        contactLockTicks: clamp(Math.ceil(finite(player.contactLockTicks, 0)), 0, 600),
        // Animation/reception locks can delay a deliberate touch without
        // making the footballer's body intangible to the MR ball.
        bodyContactEligible: player.bodyContactEligible !== false,
        stunTicks: clamp(Math.trunc(finite(player.stunTicks, 0)), 0, 600),
        skillCooldownTicks: Math.max(0, finite(player.skillCooldownTicks, 0)),
        skillProtection: player.skillProtection&&typeof player.skillProtection.defenderId==='string'?{defenderId:player.skillProtection.defenderId,multiplier:clamp(finite(player.skillProtection.multiplier,1),0,1)}:null,
        lowChallenge: Boolean(player.lowChallenge),physicalSkillActive:Boolean(player.physicalSkillActive),
        skillExitTarget: player.skillExitTarget ? point(player.skillExitTarget, { x: player.x, y: player.y }) : null,
        tackleActive: Boolean(player.tackleActive), shoulderActive: Boolean(player.shoulderActive),
        control: player.control && typeof player.control === 'object' ? {
          x: clamp(finite(player.control.x, 0), -1, 1), y: clamp(finite(player.control.y, 0), -1, 1),
          strength: clamp(finite(player.control.strength, Math.hypot(finite(player.control.x, 0), finite(player.control.y, 0))), 0, 1),
          sprint: Boolean(player.control.sprint), shield: Boolean(player.control.shield)
        } : null
      };
    }) : [];
    if (players.length < 2) throw new TypeError('live snapshot needs players from both teams');
    const ids = new Set();
    for (const player of players) {
      if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) throw new TypeError('live player coordinates are invalid');
      if (ids.has(player.id)) throw new TypeError('live player ids must be unique');
      ids.add(player.id);
    }
    const humanPlayerIds = new Set((Array.isArray(snapshot.humanPlayerIds) ? snapshot.humanPlayerIds : []).map(String));
    for (const id of humanPlayerIds) if (!ids.has(id)) throw new TypeError('human ownership references an unknown player');
    if (workflow === 'cpu-v-cpu' && (humanPlayerIds.size !== 0 || players.some(player => player.control !== null))) {
      throw new Error('CPU-v-CPU live V2 snapshot must contain no human ownership or human control input');
    }
    const ball = snapshot.ball && typeof snapshot.ball === 'object' ? {
      id: String(snapshot.ball.id || 'live-ball'), x: finite(snapshot.ball.x, NaN), y: finite(snapshot.ball.y, NaN),
      z: finite(snapshot.ball.z, 0), vx: finite(snapshot.ball.vx, 0), vy: finite(snapshot.ball.vy, 0),
      zv: finite(snapshot.ball.zv, 0), spin: finite(snapshot.ball.spin, 0), dip: finite(snapshot.ball.dip, 0),
      ownerId: snapshot.ball.ownerId == null ? null : String(snapshot.ball.ownerId),
      targetId: snapshot.ball.targetId == null ? null : String(snapshot.ball.targetId),
      lastKickerId: snapshot.ball.lastKickerId == null ? null : String(snapshot.ball.lastKickerId),
      lastKickerTeamId: snapshot.ball.lastKickerTeamId == null ? null : String(snapshot.ball.lastKickerTeamId),
      flightType: String(snapshot.ball.flightType || ''),
      authoredRouteExpired: snapshot.ball.authoredRouteExpired === true,
      serviceKind:String(snapshot.ball.serviceKind||''),serviceFlight:String(snapshot.ball.serviceFlight||''),flightAge:Number.isFinite(snapshot.ball.flightAge)?Math.max(0,Math.trunc(snapshot.ball.flightAge)):null,
      launchIntent: snapshot.ball.launchIntent && typeof snapshot.ball.launchIntent === 'object'
        ? clone(snapshot.ball.launchIntent) : null
    } : null;
    if (!ball || !Number.isFinite(ball.x) || !Number.isFinite(ball.y)) throw new TypeError('live ball snapshot is invalid');
    if (ball.ownerId && !ids.has(ball.ownerId)) throw new TypeError('live ball owner is unknown');
    if (ball.targetId && !ids.has(ball.targetId)) throw new TypeError('live ball target is unknown');
    if (ball.lastKickerId) {
      const knownLastKicker = players.find(player => player.id === ball.lastKickerId);
      if (!knownLastKicker && !['you', 'opp'].includes(ball.lastKickerTeamId)) {
        throw new TypeError('protected live ball last kicker needs an exact team identity');
      }
      if (knownLastKicker && ball.lastKickerTeamId && knownLastKicker.teamId !== ball.lastKickerTeamId) {
        throw new TypeError('live ball last-kicker team identity mismatch');
      }
      ball.lastKickerTeamId = knownLastKicker ? knownLastKicker.teamId : ball.lastKickerTeamId;
    }
    const teams = Array.isArray(snapshot.teams) ? snapshot.teams.map(team => ({
      id: String(team && team.id || ''), formation: String(team && team.formation || ''),
      phase: String(team && team.phase || 'defend'), philosophy: team && team.philosophy || null,
      attackingDirection: team && team.attackingDirection === -1 ? -1 : 1,
      offsideLine: finite(team && team.offsideLine, team && team.attackingDirection === -1 ? pitch.xMin : pitch.xMax),
      tactics: clone(team && team.tactics || {}), lineup: clone(team && team.lineup || [])
    })) : [];
    if (teams.length !== 2 || new Set(teams.map(team => team.id)).size !== 2 || teams.some(team => !['you', 'opp'].includes(team.id))) {
      throw new TypeError('live snapshot requires exact you and opp team contracts');
    }
    const contactSource = snapshot.contact && typeof snapshot.contact === 'object' ? snapshot.contact : {};
    const contact = {
      intendedReceiverId: contactSource.intendedReceiverId == null ? ball.targetId : String(contactSource.intendedReceiverId),
      firstTouchIntent: contactSource.firstTouchIntent && typeof contactSource.firstTouchIntent === 'object'
        ? clone(contactSource.firstTouchIntent) : null,
      aerialIntent: contactSource.aerialIntent && typeof contactSource.aerialIntent === 'object'
        ? clone(contactSource.aerialIntent) : null,
      gate: {
        livePlay: !!(contactSource.gate && contactSource.gate.livePlay === true),
        restartActive: !!(contactSource.gate && contactSource.gate.restartActive === true),
        replayActive: !!(contactSource.gate && contactSource.gate.replayActive === true),
        keeperAuthority: !!(contactSource.gate && contactSource.gate.keeperAuthority === true),
        offsideInvolvementPending: !!(contactSource.gate && contactSource.gate.offsideInvolvementPending === true),
        specialActionAuthority: !!(contactSource.gate && contactSource.gate.specialActionAuthority === true)
      }
    };
    if (contact.intendedReceiverId && !ids.has(contact.intendedReceiverId)) {
      throw new TypeError('live contact intended receiver is unknown');
    }
    const dribblingSource = snapshot.dribbling && typeof snapshot.dribbling === 'object' ? snapshot.dribbling : {};
    const knockOnSource = dribblingSource.directionalKnockOnIntent &&
      typeof dribblingSource.directionalKnockOnIntent === 'object'
      ? dribblingSource.directionalKnockOnIntent : null;
    const directionalKnockOnIntent = knockOnSource ? {
      playerId: String(knockOnSource.playerId || ''),
      authority: String(knockOnSource.authority || ''),
      launchSequence: knockOnSource.launchSequence == null ? null : String(knockOnSource.launchSequence),
      startX: finite(knockOnSource.startX, NaN), startY: finite(knockOnSource.startY, NaN),
      targetX: finite(knockOnSource.targetX, NaN), targetY: finite(knockOnSource.targetY, NaN),
      nx: finite(knockOnSource.nx, NaN), ny: finite(knockOnSource.ny, NaN),
      distance: finite(knockOnSource.distance, NaN),
      maximumTravelDistance: finite(knockOnSource.maximumTravelDistance, NaN)
    } : null;
    if (directionalKnockOnIntent && (!ids.has(directionalKnockOnIntent.playerId) ||
        directionalKnockOnIntent.authority !== 'live-v2' ||
        !directionalKnockOnIntent.launchSequence ||
        !['startX', 'startY', 'targetX', 'targetY', 'nx', 'ny', 'distance', 'maximumTravelDistance']
          .every(key => Number.isFinite(directionalKnockOnIntent[key])) ||
        directionalKnockOnIntent.distance <= 0 ||
        directionalKnockOnIntent.maximumTravelDistance < directionalKnockOnIntent.distance)) {
      throw new TypeError('live directional knock-on contract is invalid');
    }
    const specialActionPlayerIds = dribblingSource.specialActionPlayerIds == null ? null :
      Array.isArray(dribblingSource.specialActionPlayerIds) ? [...new Set(dribblingSource.specialActionPlayerIds.map(String))] : null;
    if (dribblingSource.specialActionPlayerIds != null && !Array.isArray(dribblingSource.specialActionPlayerIds) ||
        specialActionPlayerIds && specialActionPlayerIds.some(id => !ids.has(id))) {
      throw new TypeError('live dribbling special-action actors must be known player ids');
    }
    const dribbling = {
      specialActionPlayerIds,
      surface: String(dribblingSource.surface || 'dry'),
      actionIntent: dribblingSource.actionIntent && typeof dribblingSource.actionIntent === 'object'
        ? clone(dribblingSource.actionIntent) : null,
      directionalKnockOnIntent
    };
    if (dribbling.actionIntent && dribbling.actionIntent.actorId != null && !ids.has(String(dribbling.actionIntent.actorId))) {
      throw new TypeError('live dribbling action actor is unknown');
    }
    const difficulty = cpuDifficultyConfig(snapshot.difficulty).level;
    return { tick: snapshot.tick, fixedTickSeconds: FIXED_TICK_SECONDS, difficulty, pitch, units, players, ball, teams, humanPlayerIds, contact, dribbling };
  }

  function metricPoint(player, snapshot) {
    return {
      x: (player.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
      y: (player.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre
    };
  }

  function metricVelocity(player, snapshot) {
    return {
      x: player.vx * 60 / snapshot.units.xPerMetre,
      y: player.vy * 60 / snapshot.units.yPerMetre
    };
  }

  function livePoint(metric, snapshot) {
    return {
      x: snapshot.pitch.xMin + metric.x * snapshot.units.xPerMetre,
      y: (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2 + metric.y * snapshot.units.yPerMetre
    };
  }

  function liveVelocity(metric, snapshot) {
    return { x: metric.x * snapshot.units.xPerMetre / 60, y: metric.y * snapshot.units.yPerMetre / 60 };
  }

  function metricBall(ball, snapshot) {
    return {
      position: {
        x: (ball.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
        y: (ball.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre,
        z: Math.max(0.11, ball.z / snapshot.units.zPerMetre + 0.11)
      },
      velocity: {
        x: ball.vx * 60 / snapshot.units.xPerMetre,
        y: ball.vy * 60 / snapshot.units.yPerMetre,
        z: ball.zv * 60 / snapshot.units.zPerMetre
      }
    };
  }

  function liveBall(state, snapshot) {
    return {
      x: snapshot.pitch.xMin + state.position.x * snapshot.units.xPerMetre,
      y: (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2 + state.position.y * snapshot.units.yPerMetre,
      z: Math.max(0, (state.position.z - state.radius) * snapshot.units.zPerMetre),
      vx: state.velocity.x * snapshot.units.xPerMetre / 60,
      vy: state.velocity.y * snapshot.units.yPerMetre / 60,
      zv: state.velocity.z * snapshot.units.zPerMetre / 60,
      regime: state.regime,
      grounded: state.grounded,
      settled: state.settled
    };
  }

  function philosophyFor(team, formation) {
    const id = String(team.philosophy || '');
    const expected = {
      '4-4-2': 'invincibles-442',
      '3-4-3': 'conte-343',
      '4-3-3': 'ancelotti-bbc-433'
    };
    return expected[formation] === id ? id : null;
  }

  function createAttachment(options) {
    const source = options && typeof options === 'object' ? options : {};
    const capability = source.capability;
    if (!issuedCapabilities.has(capability) || capability.schema !== 'football-legacy-live-v2-capability' ||
        capability.version !== VERSION || capability.grant !== 'offline-normal-match-live-authority' ||
        capability.offlineOnly !== true || capability.online !== false || capability.onlineMarkerDigest !== 'none' ||
        !SUPPORTED_WORKFLOWS.includes(capability.workflow)) throw new Error('issued offline live V2 capability required');
    const dependencies = dependenciesFrom(source), dependencyErrors = validateDependencies(dependencies);
    if (dependencyErrors.length) throw new Error(dependencyErrors.join(','));
    const host = source.host && typeof source.host === 'object' ? source.host : {};
    if (typeof host.prepareTick !== 'function') throw new Error('live V2 host.prepareTick is required');
    const authorityProfile = deepFreeze({
      id: source.trueFeelPhysicalTouchAuthority === false || source.cpuPassRaceFilter === false
        ? 'v2-football-baseline-reconciliation' : 'v2-full-candidate',
      trueFeelPhysicalTouchAuthority: source.trueFeelPhysicalTouchAuthority !== false,
      cpuPassRaceFilter: source.cpuPassRaceFilter !== false
    });
    const deterministicSeed = (Number.isInteger(source.seed) ? source.seed >>> 0 : stableHash(source.sessionId || capability.workflow)) || 1;
    const contactCapability = dependencies.contact.createCapability({
      enabled: true,
      online: false,
      workflow: capability.workflow,
      parentAdapterVersion: VERSION,
      parentGrant: capability.grant,
      acknowledgement: dependencies.contact.ACKNOWLEDGEMENT
    });
    const dribblingCapability = dependencies.dribbling.createCapability({
      workflow: capability.workflow,
      online: false,
      acknowledgement: dependencies.dribbling.ACKNOWLEDGEMENT
    });
    let enabled = source.enabled === true, lifecycle = enabled ? 'armed' : 'disabled', failure = null, resetEpoch = 0;
    let attachmentGeneration = 0;
    function freshDomain() {
      return {
        world: null, rosterSignature: '', cpuMemories: { you: null, opp: null },
        cpuRejectedPassCommitments: { you: null, opp: null },
        ballState: null, ballContext: dependencies.ball.createSimulationContext({ seed: (deterministicSeed ^ Math.imul(resetEpoch + 1, 0x9e3779b9)) >>> 0 || deterministicSeed }),
        lastBallProjection: null, lastLaunchSequence: '', lastTackleState: new Set(),
        lastCarrierEmission: { you: '', opp: '' }, possession: { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null },
        transition: null, aerialFlight: null, blockFlight:null,
        consumedFirstTouchIds: [], consumedFirstTouchThroughTick: 0,
        consumedAerialIds: [],
        dribblingState: dependencies.dribbling.createState({ epoch: resetEpoch })
      };
    }
    let domain = freshDomain();
    let planSequence = 0, latestPlanSequence = 0, lastCommittedTick = -1, committedTicks = 0, committedBallTicks = 0, committedContactTicks = 0;
    let lastFormation = { you: null, opp: null }, lastCpuDecision = { you: null, opp: null }, latestTelemetry = null;
    const issuedFrames = new WeakSet(), consumedFrames = new WeakSet(), reservedFrames = new WeakSet(), privateFrames = new WeakMap();
    const issuedPrepared = new WeakSet(), privatePrepared = new WeakMap();
    let activePrepared = null;
    const raceProfileCache = new WeakMap();
    let cachedGoalEnvironment = null;

    function freeze(reason) {
      enabled = false; lifecycle = 'self-disabled-fallback';
      failure = String(reason && reason.message || reason || 'live V2 adapter fault').slice(0, 1024);
      return false;
    }
    function status() {
      return {
        schema: 'football-legacy-live-v2-status', version: VERSION, enabled, lifecycle,
        workflow: capability.workflow, authority: enabled ? 'fl-v2-offline-live' : 'build-173',
        fallback: enabled ? null : 'build-173', failure, fixedTickSeconds: FIXED_TICK_SECONDS,
        deterministicSeed, committedTicks, committedBallTicks, committedContactTicks, lastCommittedTick,
        authorityProfile: clone(authorityProfile),
        authorities: clone(capability.authority), dependencyContracts: clone(DEPENDENCY_CONTRACTS),
        lastFormation: clone(lastFormation), lastCpuDecision: clone(lastCpuDecision), latestTelemetry: clone(latestTelemetry),
        possession: clone(domain.possession),
        cpuRejectedPassCommitments: clone(domain.cpuRejectedPassCommitments),
        blockFlight:clone(domain.blockFlight),
        dribbling: dependencies.dribbling.serializeState(domain.dribblingState)
      };
    }
    function exportState() {
      const payload = {
        schema: 'football-legacy-live-v2-serialized-state',
        version: VERSION,
        workflow: capability.workflow,
        deterministicSeed,
        authorityProfile: clone(authorityProfile),
        resetEpoch,
        attachmentGeneration,
        lastCommittedTick,
        committedTicks,
        committedBallTicks,
        committedContactTicks,
        lifecycle,
        domain: {
          world: clone(domain.world),
          rosterSignature: domain.rosterSignature,
          cpuMemories: clone(domain.cpuMemories),
          cpuRejectedPassCommitments: clone(domain.cpuRejectedPassCommitments),
        blockFlight:clone(domain.blockFlight),
          ballState: clone(domain.ballState),
          ballContext: clone(domain.ballContext),
          lastBallProjection: clone(domain.lastBallProjection),
          lastLaunchSequence: domain.lastLaunchSequence,
          lastTackleState: [...domain.lastTackleState].map(String).sort(),
          lastCarrierEmission: clone(domain.lastCarrierEmission),
          possession: clone(domain.possession),
          transition: clone(domain.transition),
          aerialFlight: clone(domain.aerialFlight),
          consumedFirstTouchIds: clone(domain.consumedFirstTouchIds),
          consumedFirstTouchThroughTick: domain.consumedFirstTouchThroughTick,
          consumedAerialIds: clone(domain.consumedAerialIds),
          dribbling: dependencies.dribbling.serializeState(domain.dribblingState)
        },
        lastFormation: clone(lastFormation),
        lastCpuDecision: clone(lastCpuDecision),
        latestTelemetry: clone(latestTelemetry)
      };
      return deepFreeze({ ...payload, checksum: stableHash(canonical(payload)).toString(16).padStart(8, '0') });
    }
    function restoreState(serialized) {
      if (!enabled || !serialized || serialized.schema !== 'football-legacy-live-v2-serialized-state' ||
          serialized.version !== VERSION || serialized.workflow !== capability.workflow ||
          serialized.deterministicSeed !== deterministicSeed ||
          canonical(serialized.authorityProfile) !== canonical(authorityProfile)) return false;
      try {
        const payload = clone(serialized); delete payload.checksum;
        if (String(serialized.checksum || '') !== stableHash(canonical(payload)).toString(16).padStart(8, '0')) {
          throw new Error('live V2 serialized state checksum mismatch');
        }
        if (!Number.isInteger(payload.resetEpoch) || payload.resetEpoch < 0 ||
            !Number.isInteger(payload.lastCommittedTick) || payload.lastCommittedTick < -1 ||
            !payload.domain || !dependencies.ball.isSimulationContext(payload.domain.ballContext)) {
          throw new Error('live V2 serialized state chronology is invalid');
        }
        const restoredWorld = payload.domain.world == null ? null
          : dependencies.movement.createWorldState(payload.domain.world);
        const restoredBall = payload.domain.ballState == null ? null
          : dependencies.ball.createBallState(payload.domain.ballState);
        const restoredDribbling = dependencies.dribbling.restoreState(payload.domain.dribbling);
        if (restoredDribbling.epoch !== payload.resetEpoch ||
            restoredDribbling.physicalSeparated && !restoredBall) {
          throw new Error('live V2 serialized dribbling state is inconsistent');
        }
        const restoredAerialFlight = payload.domain.aerialFlight || null;
        if (restoredAerialFlight && (typeof restoredAerialFlight.key !== 'string' ||
            !restoredAerialFlight.landing || !Number.isFinite(restoredAerialFlight.landing.x) ||
            !Number.isFinite(restoredAerialFlight.landing.y) || !Number.isSafeInteger(restoredAerialFlight.releaseTick) ||
            !Number.isSafeInteger(restoredAerialFlight.projectedTick) || !Number.isSafeInteger(restoredAerialFlight.arrivalTick))) {
          throw new Error('live V2 serialized aerial forecast is invalid');
        }
        if (restoredAerialFlight?.trajectory && (!Array.isArray(restoredAerialFlight.trajectory) ||
            restoredAerialFlight.trajectory.length > 240 || restoredAerialFlight.trajectory.some(p =>
              !Number.isSafeInteger(p.tick) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)||p.vz!=null&&!Number.isFinite(p.vz)))) {
          throw new Error('live V2 serialized aerial trajectory is invalid');
        }
        const stagedDomain = {
          world: restoredWorld,
          rosterSignature: String(payload.domain.rosterSignature || ''),
          cpuMemories: clone(payload.domain.cpuMemories || { you: null, opp: null }),
          cpuRejectedPassCommitments: clone(payload.domain.cpuRejectedPassCommitments || { you: null, opp: null }),
          blockFlight:clone(payload.domain.blockFlight||null),
          ballState: restoredBall,
          ballContext: dependencies.ball.cloneContext(payload.domain.ballContext),
          lastBallProjection: clone(payload.domain.lastBallProjection),
          lastLaunchSequence: String(payload.domain.lastLaunchSequence || ''),
          lastTackleState: new Set((Array.isArray(payload.domain.lastTackleState) ? payload.domain.lastTackleState : []).map(String)),
          lastCarrierEmission: clone(payload.domain.lastCarrierEmission || { you: '', opp: '' }),
          possession: clone(payload.domain.possession || { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null }),
          transition: clone(payload.domain.transition),
          aerialFlight: clone(restoredAerialFlight),
          consumedFirstTouchIds: clone(payload.domain.consumedFirstTouchIds || []),
          consumedFirstTouchThroughTick: Math.max(0, Math.trunc(finite(payload.domain.consumedFirstTouchThroughTick, 0))),
          consumedAerialIds: clone(payload.domain.consumedAerialIds || []),
          dribblingState: restoredDribbling
        };
        domain = stagedDomain;
        resetEpoch = payload.resetEpoch;
        lastCommittedTick = payload.lastCommittedTick;
        committedTicks = Math.max(0, Math.trunc(finite(payload.committedTicks, 0)));
        committedBallTicks = Math.max(0, Math.trunc(finite(payload.committedBallTicks, 0)));
        committedContactTicks = Math.max(0, Math.trunc(finite(payload.committedContactTicks, 0)));
        lastFormation = clone(payload.lastFormation || { you: null, opp: null });
        lastCpuDecision = clone(payload.lastCpuDecision || { you: null, opp: null });
        latestTelemetry = clone(payload.latestTelemetry);
        lifecycle = payload.lifecycle === 'live' ? 'live' : 'armed';
        failure = null;
        attachmentGeneration += 1;
        activePrepared = null;
        latestPlanSequence = ++planSequence;
        return true;
      } catch (_) { return false; }
    }
    function phaseAuthority(snapshot, possession) {
      let transition = domain.transition && clone(domain.transition);
      if (domain.possession.teamId && possession.teamId && domain.possession.teamId !== possession.teamId) {
        transition = { fromTeamId: domain.possession.teamId, toTeamId: possession.teamId, startedTick: snapshot.tick, untilTick: snapshot.tick + 30 };
      } else if (transition && snapshot.tick > transition.untilTick) transition = null;
      const phases = {};
      const owner = possession.ownerId && snapshot.players.find(player => player.id === possession.ownerId);
      const goalkeeperBuildup = !!(owner && owner.isGK && owner.teamId === possession.teamId);
      for (const team of snapshot.teams) {
        if (transition) phases[team.id] = team.id === transition.toTeamId ? 'positive-transition' : 'negative-transition';
        else if (possession.teamId) phases[team.id] = team.id === possession.teamId ? (goalkeeperBuildup ? 'buildup' : 'settled-attack') : 'defend';
        else phases[team.id] = team.phase;
      }
      return { phases, transition };
    }
    function formationOutputs(snapshot, phaseState, possession) {
      const output = {};
      for (const team of snapshot.teams) {
        const formation = dependencies.formation.normalizeFormationCode(team.formation);
        if (!formation) throw new Error('formation V2 rejected ' + team.formation);
        const lineup = team.lineup.map(row => ({ id: String(row.id), slotId: String(row.slotId), position: String(row.position) }));
        const validation = dependencies.formation.validateLineup(formation, lineup);
        if (!validation.valid) throw new Error('formation V2 lineup invalid: ' + validation.errors.join(';'));
        // Keep the stable lineup for validation, but remove dismissed players'
        // actual slots through Formation V2's existing short-handed adaptation.
        const unavailableSlotIds = lineup.filter(row => snapshot.players.some(player =>
          player.id === row.id && player.sentOff && !player.isGK)).map(row => row.slotId);
        const referenceId = snapshot.ball.ownerId || snapshot.ball.targetId;
        const referencePlayer = referenceId && snapshot.players.find(player => player.id === referenceId && player.teamId === team.id);
        const carrierProgress = referencePlayer ? clamp(team.attackingDirection === 1
          ? (referencePlayer.x - snapshot.pitch.xMin) / (snapshot.pitch.xMax - snapshot.pitch.xMin)
          : (snapshot.pitch.xMax - referencePlayer.x) / (snapshot.pitch.xMax - snapshot.pitch.xMin), 0, 1) : null;
        output[team.id] = dependencies.formation.resolve({
          formation, phase: phaseState.phases[team.id], tick: snapshot.tick, lineup, unavailableSlotIds,
          philosophy: philosophyFor(team, formation), pitch: METRIC_PITCH,
          attackingDirection: team.attackingDirection,
          offsideLine: (team.offsideLine - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          ball: { ...metricBall(snapshot.ball, snapshot), free: !possession.ownerId },
          tactics: { ...team.tactics, carrierProgress }
        });
      }
      return output;
    }
    function derivePossession(snapshot) {
      const owner = snapshot.ball.ownerId && snapshot.players.find(player => player.id === snapshot.ball.ownerId);
      if (owner) return { teamId: owner.teamId, ownerId: owner.id, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null };
      if(/keeper-deflection|woodwork-rebound|involuntary-deflection/.test(snapshot.ball.flightType))return {
        teamId:null,ownerId:null,inFlight:false,intendedReceiverId:null,intendedTarget:null,intendedTargetWindowMetres:null,
        arrivalWindowEntered:false,releaseTick:null,reactionStimulus:clone(domain.possession.reactionStimulus||null),deliberatePass:false,
        offsideCandidate:clone(domain.possession.offsideCandidate||null)};
      const pendingTouch = domain.possession.pendingTouch;
      if (pendingTouch) {
        const last = snapshot.players.find(p => p.id === snapshot.ball.lastKickerId);
        if (snapshot.tick <= pendingTouch.untilTick && (!last || last.teamId === domain.possession.teamId)) {
          // Expected team continuity is not ownership: both teams still race
          // for the free ball, while the combination keeps its short memory.
          return { ...clone(domain.possession), ownerId: null, inFlight: true,
            intendedReceiverId: pendingTouch.targetId, intendedTarget: null,
            arrivalWindowEntered: true, reactionStimulus: null, deliberatePass: false };
        }
        return { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null,
          intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null,
          reactionStimulus: null, offsideCandidate: null };
      }
      // A grounded authored service whose contact window has elapsed is a
      // genuinely loose ball even while it is still rolling. Do not retain the
      // old receiver merely because MR still reports non-zero velocity.
      if (snapshot.ball.authoredRouteExpired) {
        return { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null,
          intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
          releaseTick: null, reactionStimulus: null,
          // Expiring the receiver route is not a deliberate touch. Preserve
          // the original kick's laws provenance until a later contact resolves
          // it, exactly as for an involuntary body deflection.
          offsideCandidate: clone(domain.possession.offsideCandidate || null) };
      }
      const launch = snapshot.ball.launchIntent;
      if (launch) {
        const sourcePlayerId = String(launch.sourcePlayerId || snapshot.ball.lastKickerId || '');
        const sourcePlayer = snapshot.players.find(player => player.id === sourcePlayerId);
        const sourceTeamId = sourcePlayer ? sourcePlayer.teamId : String(launch.sourceTeamId || '');
        if (sourcePlayer || ['you', 'opp'].includes(sourceTeamId)) {
          if(launch.source==='keeper-deflection')return {teamId:null,ownerId:null,inFlight:false,intendedReceiverId:null,
            intendedTarget:null,intendedTargetWindowMetres:null,arrivalWindowEntered:false,releaseTick:null,reactionStimulus:null,offsideCandidate:null};
          const directionalKnockOn = snapshot.dribbling.directionalKnockOnIntent;
          if (directionalKnockOn && String(launch.sequence || '') === directionalKnockOn.launchSequence &&
              directionalKnockOn.playerId === sourcePlayerId) {
            // A knock-on is an authored dribble touch, not a pass to oneself.
            // The host's explicit contact target keeps First Touch eligible to
            // re-acquire it; no reception route or pass reaction window is
            // manufactured here.
            return { teamId: sourceTeamId, ownerId: null, inFlight: false,
              intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null,
              arrivalWindowEntered: false, releaseTick: null, sourcePlayerId,
              deliberatePass: false, directionalKnockOnPlayerId: sourcePlayerId,
              reactionStimulus: null, offsideCandidate: null };
          }
          const origin = launch.origin && typeof launch.origin === 'object' ? launch.origin : { x: snapshot.ball.x, y: snapshot.ball.y };
          const intendedTarget = launch.target && typeof launch.target === 'object' && Number.isFinite(launch.target.x) && Number.isFinite(launch.target.y)
            ? { x: launch.target.x, y: launch.target.y } : null;
          const distanceMetres = intendedTarget ? Math.hypot((intendedTarget.x - origin.x) / snapshot.units.xPerMetre,
            (intendedTarget.y - origin.y) / snapshot.units.yPerMetre) : 0;
          const intendedReceiverId = launch.targetPlayerId == null ? snapshot.ball.targetId : String(launch.targetPlayerId);
          const releaseDescriptor = String(launch.source || snapshot.ball.flightType || '').toLowerCase();
          const deliberatePass = Boolean(intendedReceiverId) && !/(shot|penalty|direct-free-kick)/.test(releaseDescriptor);
          const predictedArrivalTicks = Number.isSafeInteger(launch.predictedArrivalTicks)
            ? clamp(launch.predictedArrivalTicks, 1, 600) : null;
          const meetingContract = launch.meetingContract == null ? null : String(launch.meetingContract);
          return {
          teamId: sourceTeamId, ownerId: null, inFlight: true,
          intendedReceiverId,
          intendedTarget, intendedTargetWindowMetres: intendedTarget ? clamp(1.35 + distanceMetres * .025, 1.5, 3.25) : null,
          arrivalWindowEntered: false,
          releaseTick: snapshot.tick,
          predictedArrivalTicks,
          predictedArrivalTick: predictedArrivalTicks == null ? null : snapshot.tick + predictedArrivalTicks,
          predictedTerminalPaceMetresPerSecond: Number.isFinite(launch.predictedTerminalPaceMetresPerSecond)
            ? Math.max(0, launch.predictedTerminalPaceMetresPerSecond) : null,
          authoredPower: Number.isFinite(launch.authoredPower) ? clamp(launch.authoredPower, 0, 1) : null,
          meetingContract,
          receiverMeeting:launch.receiverMeeting==='feet'?'feet':launch.receiverMeeting==='aerial'?'aerial':null,
          movingInBehind:launch.movingInBehind===true,
          sourcePlayerId,
          deliberatePass,
          reactionStimulus: deliberatePass ? {
            releaseTick: snapshot.tick,
            sourcePlayerId,
            sourceTeamId
          } : null,
          offsideCandidate: clone(launch.offsideCandidate || null)
          };
        }
      }
      const speed = Math.hypot(snapshot.ball.vx, snapshot.ball.vy, snapshot.ball.zv);
      if (domain.possession.teamId && domain.possession.inFlight && speed > 0.03) {
        const lastKicker = snapshot.ball.lastKickerId &&
          snapshot.players.find(player => player.id === String(snapshot.ball.lastKickerId));
        const lastKickerTeamId = lastKicker ? lastKicker.teamId : snapshot.ball.lastKickerTeamId;
        // A keeper parry, interception or other externally-authoritative
        // opposing touch terminates the old authored reception route. The ball
        // remains physically loose; this does not manufacture possession for
        // the touching team.
        if (lastKickerTeamId && lastKickerTeamId !== domain.possession.teamId) {
          return { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null,
            intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
            releaseTick: null, reactionStimulus: null, offsideCandidate: null };
        }
        const retained = clone(domain.possession);
        let targetDistanceMetres = null;
        if (retained.intendedTarget && Number.isFinite(retained.intendedTargetWindowMetres)) {
          targetDistanceMetres = Math.hypot(
            (snapshot.ball.x - retained.intendedTarget.x) / snapshot.units.xPerMetre,
            (snapshot.ball.y - retained.intendedTarget.y) / snapshot.units.yPerMetre
          );
          if (!retained.arrivalWindowEntered) {
            retained.arrivalWindowEntered = targetDistanceMetres <= retained.intendedTargetWindowMetres;
          }
        }
        const predictedArrivalOverdue = Number.isSafeInteger(retained.predictedArrivalTick) &&
          snapshot.tick > retained.predictedArrivalTick + 90;
        const leftArrivalWindow = retained.arrivalWindowEntered && targetDistanceMetres != null &&
          targetDistanceMetres > retained.intendedTargetWindowMetres + .75;
        const stalledAfterArrival = Number.isSafeInteger(retained.predictedArrivalTick) &&
          snapshot.tick > retained.predictedArrivalTick + 18 && speed <= .35;
        if (leftArrivalWindow || predictedArrivalOverdue || stalledAfterArrival) {
          return { teamId: null, ownerId: null, inFlight: false,
            intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null,
            arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null,
            offsideCandidate: clone(retained.offsideCandidate || null),
            routeExpiredAtTick: snapshot.tick,
            routeExpiredReason: leftArrivalWindow ? 'ball-left-arrival-window' :
              stalledAfterArrival ? 'ball-stalled-after-arrival' : 'predicted-arrival-overdue' };
        }
        return retained;
      }
      const priorReaction = domain.possession.reactionStimulus;
      const reactionActive = priorReaction && Number.isSafeInteger(priorReaction.releaseTick) &&
        snapshot.tick <= priorReaction.releaseTick + dependencies.contact.MAX_REACTION_DELAY_TICKS;
      if (reactionActive || domain.possession.offsideCandidate && speed > 0.03) {
        // A passive ricochet ends the authored rendezvous but, under the laws,
        // does not become a deliberate play that resets the original offside
        // state. Keep only that rules provenance while the loose ball travels.
        return { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null,
          intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
          releaseTick: null, sourcePlayerId: null, deliberatePass: false,
          reactionStimulus: reactionActive ? clone(priorReaction) : null,
          offsideCandidate: clone(domain.possession.offsideCandidate) };
      }
      return { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null };
    }
    function physicalChallengeForecasts(snapshot,possession){
      const carrier=possession.ownerId&&snapshot.players.find(p=>p.id===possession.ownerId);
      if(!carrier||carrier.isGK||!dependencies.movement.forecastPhysicalChallenge||!cpuPhysicalActionAllowed(domain.transition,snapshot.tick))return {};
      const defendingTeam=carrier.teamId==='you'?'opp':'you',memory=domain.cpuMemories[defendingTeam]?.defense,primaryId=memory?.primaryPlayerId,coverId=memory?.coverPlayerId,
        eligible=snapshot.players.filter(p=>p.teamId===defendingTeam&&!p.isGK&&!p.sentOff&&(!primaryId||p.id===primaryId||p.id===coverId&&Math.hypot((p.x-carrier.x)/snapshot.units.xPerMetre,(p.y-carrier.y)/snapshot.units.yPerMetre)<2.5)&&
          !snapshot.humanPlayerIds.has(p.id)&&p.stunTicks<=0&&!(memory?.cooldowns?.[p.id]>snapshot.tick)&&
          Math.hypot((p.x-carrier.x)/snapshot.units.xPerMetre,(p.y-carrier.y)/snapshot.units.yPerMetre)<=4.8&&
          !domain.world?.players.find(a=>a.id===p.id)?.action);
      if(!eligible.length)return {};
      const world=movementWorld(snapshot).world,target=world.players.find(p=>p.id===carrier.id);
      if(!target)return {};
      const ball=metricBall(snapshot.ball,snapshot),samples=[{...ball.position}],owned=snapshot.ball.ownerId===carrier.id;
      const targetTrajectory=dependencies.movement.forecastLocomotion(target,16);
      if(owned&&carrier.carryAnchor){
        const state={...carrier.carryAnchor},env=state.environment;
        let point={x:snapshot.ball.x,y:snapshot.ball.y};
        for(let t=1;t<=16;t++){
          const motion=targetTrajectory[t];
          Object.assign(state,{x:snapshot.pitch.xMin+motion.position.x*snapshot.units.xPerMetre,
            y:(snapshot.pitch.yMin+snapshot.pitch.yMax)/2+motion.position.y*snapshot.units.yPerMetre,
            vx:motion.velocity.x*snapshot.units.xPerMetre/60,vy:motion.velocity.y*snapshot.units.yPerMetre/60,fx:motion.facing.x,fy:motion.facing.y});
          state.touchPhase=ownedCarryPhase(state);point=ownedCarryAnchorPlan(state,point,{...env,clockFrames:env.clockFrames+t});
          samples.push({x:(point.x-snapshot.pitch.xMin)/snapshot.units.xPerMetre,y:(point.y-(snapshot.pitch.yMin+snapshot.pitch.yMax)/2)/snapshot.units.yPerMetre,z:.11});
        }
      }else if(owned){
        for(let t=1;t<=16;t++)samples.push({x:ball.position.x+targetTrajectory[t].position.x-target.position.x,
          y:ball.position.y+targetTrajectory[t].position.y-target.position.y,z:ball.position.z});
      }else{
        const state=dependencies.ball.createBallState({...domain.ballState,position:ball.position,velocity:ball.velocity,
          grounded:ball.position.z<=.13&&ball.velocity.z<=.65,settled:false}),
          flight=dependencies.ball.step(state,dependencies.ball.createSimulationContext({seed:stableHash('boot-read:'+snapshot.tick)}),16*FIXED_TICK_SECONDS,goalEnvironment());
        for(let i=3;i<flight.trace.samples.length;i+=4)samples.push({...flight.trace.samples[i].position});
      }
      const rows={};
      for(const actor of world.players){
        if(!eligible.some(p=>p.id===actor.id))continue;
        const live=snapshot.players.find(p=>p.id===actor.id);
        if(actor.teamId===target.teamId||actor.action||actor.externalMotion||live.stunTicks>0||snapshot.humanPlayerIds.has(actor.id)||
            Math.hypot(actor.position.x-target.position.x,actor.position.y-target.position.y)>4.8)continue;
        const quality=(actor.attributes.defending+live.attrs.awareness)/198,
          // Read error changes timing/aim only. The actual boot and collision
          // test remain exact for every rating.
          error=(stableHash(actor.id+':boot-timing:'+Math.floor(snapshot.tick/12))%2001/1000-1)*(1-quality)*.045,
          read=samples.map(p=>({x:p.x+(owned?target.velocity.x:ball.velocity.x)*error,y:p.y+(owned?target.velocity.y:ball.velocity.y)*error,z:p.z}));
        rows[actor.id]={};
        for(const type of ['stand-tackle','slide-tackle'])rows[actor.id][type]=dependencies.movement.forecastPhysicalChallenge({actor,target,targetTrajectory,type,ballSamples:read},LIVE_MOVEMENT_CONTACT_CONFIG);
        rows[actor.id].carrierTouchAgeTicks=Number.isInteger(domain.dribblingState.touchTick)?Math.max(0,snapshot.tick-domain.dribblingState.touchTick):null;
        rows[actor.id].nextCarrierTouchTicks=Math.max(0,domain.dribblingState.nextTouchTick-snapshot.tick);
      }
      return rows;
    }
    function cpuOutputs(snapshot, formations, possession) {
      const allPlayers = snapshot.players.map(player => {
        const metric = metricPoint(player, snapshot), velocity = metricVelocity(player, snapshot);
        const target = formations[player.teamId].targets.find(row => row.playerId === player.id), attrs = player.attrs || {};
        return {
          id: player.id, teamId: player.teamId, x: metric.x, y: metric.y, vx: velocity.x, vy: velocity.y,
          role: player.role, position: player.position, formationAnchor: target ? target.target : metric,
          pace: finite(attrs.pace, 70), acceleration: finite(attrs.accel, attrs.pace || 70), awareness: finite(attrs.awareness, 70),
          agility: finite(attrs.agility, attrs.accel || 70), committed: player.tackleActive || player.shoulderActive || Boolean(domain.world && domain.world.players.find(p => p.id === player.id)?.action),
          passing: finite(attrs.pass, 70), shooting: finite(attrs.shoot, 65), control: finite(attrs.control, 70),
          nextTouchDistanceM:dependencies.dribbling.touchProfile({speed:Math.hypot(velocity.x,velocity.y),control:attrs.control,agility:attrs.agility,sprint:true}).distance,
          touchPhase:player.carryAnchor?.touchPhase,
          skillCooldownTicks: player.skillCooldownTicks,
          lowChallenge: player.lowChallenge,physicalSkillActive:player.physicalSkillActive,stunTicks:player.stunTicks,
          blockPurpose:lastCpuDecision[player.teamId]?.defensiveIntents?.some(i=>i.playerId===player.id&&['cross-block','shot-block'].includes(i.type)&&
            i.targetPlayerId===possession.ownerId&&Math.hypot(metric.x-i.target.x,metric.y-i.target.y)<=1.6)?
            lastCpuDecision[player.teamId].defensiveIntents.find(i=>i.playerId===player.id&&['cross-block','shot-block'].includes(i.type)).purpose:'',
          skillExitTarget: player.skillExitTarget ? metricPoint(player.skillExitTarget, snapshot) : null,
          defending: finite(attrs.defend, 55), aggression: finite(attrs.aggression, 65), strength: finite(attrs.strength, 70),
          balance: finite(attrs.balance, 70), fx: player.fx, fy: player.fy,
          stamina: player.stamina, isGK: player.isGK, sentOff: player.sentOff, available: !player.sentOff,
          cpuControlled: !snapshot.humanPlayerIds.has(player.id), humanControlled: snapshot.humanPlayerIds.has(player.id)
        };
      });
      const ballPoint = metricBall(snapshot.ball, snapshot).position, outputs = {}, memories = {};
      const difficulty = cpuDifficultyConfig(snapshot.difficulty),challengeForecasts=physicalChallengeForecasts(snapshot,possession);
      for (const team of snapshot.teams) {
        const decision = dependencies.cpu.decide({
          tick: snapshot.tick, fixedTickSeconds: FIXED_TICK_SECONDS, teamId: team.id,
          possessionTeamId: possession.teamId, carrierId: possession.ownerId,
          intendedReceiverId: possession.intendedReceiverId, inFlight: possession.inFlight,
          flightType: snapshot.ball.flightType,
          sourcePlayerId: possession.sourcePlayerId,
          attackingDirection: team.attackingDirection,
          offsideLine: (team.offsideLine - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          pitch: METRIC_PITCH, ball: { x: ballPoint.x, y: ballPoint.y }, players: allPlayers,challengeForecasts,
          events: possession.offsideCandidate ? [{ type: 'offside-candidate', ...clone(possession.offsideCandidate) }] : []
        }, domain.cpuMemories[team.id], { fixedTickSeconds: FIXED_TICK_SECONDS, ...difficulty.overrides });
        outputs[team.id] = {
          ...decision,
          telemetry: {
            ...decision.telemetry,
            liveDifficulty: { level: difficulty.level, decisionOnly: true, config: clone(difficulty.overrides) }
          }
        };
        memories[team.id] = decision.memory;
      }
      return { outputs, memories };
    }
    function createMovementWorld(snapshot) {
      const activeOutfieldIds = new Set(snapshot.players.filter(player => !player.sentOff && !player.isGK).map(player => player.id));
      return dependencies.movement.createWorldState({
        tick: Math.max(0, snapshot.tick - 1), fixedTickSeconds: FIXED_TICK_SECONDS, bounds: METRIC_PITCH,
        // Goalkeeper ownership stays entirely in Build 173. Never hand an id
        // that is absent from the Movement world into Movement V2.
        ballOwnerId: snapshot.ball.ownerId && activeOutfieldIds.has(snapshot.ball.ownerId) ? snapshot.ball.ownerId : null,
        players: snapshot.players.filter(player => !player.sentOff && !player.isGK).map(player => {
          const position = metricPoint(player, snapshot), velocity = metricVelocity(player, snapshot), attrs = player.attrs || {};
          return {
            id: player.id, teamId: player.teamId, role: player.position || player.role, position, velocity,
            facing: unit({ x: player.fx, y: player.fy }, { x: player.teamId === 'you' ? 1 : -1, y: 0 }),
            radius: clamp(player.radius / Math.sqrt(snapshot.units.xPerMetre * snapshot.units.yPerMetre), 0.25, 0.7),
            contactRig:player.contactRig||dependencies.movement.createContactRig?.({appearance:{heightCm:player.heightM*100}}),externalMotion:player.externalMotion,bodyLow:player.bodyLow,
            staminaLevel: player.stamina, attributes: {
              pace: finite(attrs.pace, 70), acceleration: finite(attrs.accel, attrs.pace || 70), agility: finite(attrs.agility, 70),
              balance: finite(attrs.balance, 70), strength: finite(attrs.strength, 70), stamina: finite(attrs.stamina, 75),
              defending: finite(attrs.defend, 55), aggression: finite(attrs.aggression, 65), control: finite(attrs.control, 70)
            }
          };
        })
      });
    }
    function movementWorld(snapshot) {
      const active = snapshot.players.filter(player => !player.sentOff && !player.isGK), signature = active.map(player => player.id).sort().join('|');
      const activeIds = new Set(active.map(player => player.id));
      const currentOutfieldOwnerId = snapshot.ball.ownerId && activeIds.has(snapshot.ball.ownerId) ? snapshot.ball.ownerId : null;
      let world = domain.world;
      const resync = !world || signature !== domain.rosterSignature || world.players.length !== active.length || world.tick !== snapshot.tick - 1 ||
        world.players.some(statePlayer => {
          const livePlayer = snapshot.players.find(player => player.id === statePlayer.id);
          if (!livePlayer) return true; const metric = metricPoint(livePlayer, snapshot);
          return Math.hypot(metric.x - statePlayer.position.x, metric.y - statePlayer.position.y) > 1.15;
      });
      if (resync) world = createMovementWorld(snapshot);
      // A release/keeper claim can change ownership without moving any player
      // far enough to trigger a spatial resync. Reconcile it every frame on a
      // planned copy, never by mutating the committed domain world.
      world = {
        ...world,
        ballOwnerId: currentOutfieldOwnerId,
        players: world.players.map(player => {
          const profile=snapshot.players.find(p=>p.id===player.id),externalMotion=profile.externalMotion;
          return {...player,hasBall:player.id===currentOutfieldOwnerId,externalMotion,bodyLow:profile.bodyLow,
            ...(externalMotion||player.externalMotion?{position:metricPoint(profile,snapshot),velocity:metricVelocity(profile,snapshot),stamina:profile.stamina,facing:unit({x:profile.fx,y:profile.fy},player.facing)}:{}),
            skillProtection:clone(profile.skillProtection||null)};
        })
      };
      return { world, signature };
    }
    function targetMaps(formations, decisions, snapshot, possession) {
      const shape = {}, run = {}, reception = {}, carrier = {}, defensive = {}, support = {};
      for (const teamId of ['you', 'opp']) {
        for (const target of formations[teamId].targets) shape[target.playerId] = target.target;
        for (const committed of decisions[teamId].runs || []) run[committed.playerId] = possession.inFlight
          ? committed.continuationTarget || committed.target : committed.target;
        for (const intent of decisions[teamId].supportIntents || []) {
          support[intent.playerId] = intent.target;
          // These two midfield jobs are local combinations, not extra
          // penetrating runners. Receiver and loose-ball contracts win below.
          delete run[intent.playerId];
        }
        const intent = decisions[teamId].carrierIntent;
        // The race gate accepts a pass only when this named receiver can meet
        // the exact authored point. Movement must honour that same point while
        // the ball travels instead of returning the player to an older run or
        // a static formation anchor.
        if (intent && ['pass', 'cross'].includes(intent.type) && intent.targetPlayerId && intent.target && !hasPhysicalDribblingLease(domain.dribblingState)) {
          reception[String(intent.targetPlayerId)] = intent.target;
        }
        if (intent && ['carry', 'take-on', 'protect'].includes(intent.type) && intent.target) carrier[teamId] = intent.target;
        for (const intent of decisions[teamId].defensiveIntents || []) {
          if (!intent || !intent.playerId || !intent.target) continue;
          defensive[String(intent.playerId)] = clone(intent);
        }
      }
      // A cover player belongs to the line; only the primary presser may
      // leave its anchor locally. A distant carrier must not split the unit.
      for (const teamId of ['you', 'opp']) {
        if (possession.teamId === teamId) continue;
        for (const row of formations[teamId].targets) {
          if (!['centre-back', 'full-back', 'wing-back'].includes(row.roleFamily)) continue;
          const intent = defensive[row.playerId];
          if (!intent) continue;
          if(intent.type==='cross-block'||intent.type==='shot-block')continue;
          const reach = intent.type === 'press' ? 3 : 0;
          intent.connectedLine = intent.type === 'cover';
          intent.target.x = clamp(intent.target.x, row.target.x - reach, row.target.x + reach);
          intent.target.y = clamp(intent.target.y, row.target.y - reach, row.target.y + reach);
        }
      }
      // Keep the accepted receiver route alive for every tick of the MR
      // flight. The CPU carrier intent exists only on the kick frame; without
      // this persisted contract the receiver immediately drifts back toward
      // formation and the pre-release race becomes a promise the live motion
      // no longer honours.
      if (possession && possession.inFlight && possession.intendedReceiverId && possession.intendedTarget) {
        reception[String(possession.intendedReceiverId)] = {
          x: (possession.intendedTarget.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          y: (possession.intendedTarget.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre
        };

      }
      return { shape, run, reception, carrier, defensive, support };
    }
    function nearestOpponent(player, snapshot) {
      return snapshot.players.filter(candidate => candidate.teamId !== player.teamId && !candidate.sentOff)
        .map(candidate => ({ candidate, distance: Math.hypot(candidate.x - player.x, candidate.y - player.y) }))
        .sort((a, b) => a.distance - b.distance || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate || null;
    }
    function challengeTarget(player, snapshot, possession) {
      const carrier = possession && possession.ownerId
        ? snapshot.players.find(candidate => candidate.id === possession.ownerId &&
          candidate.teamId !== player.teamId && !candidate.sentOff && !candidate.isGK) || null
        : null;
      if (carrier) {
        const dx = (carrier.x - player.x) / snapshot.units.xPerMetre;
        const dy = (carrier.y - player.y) / snapshot.units.yPerMetre;
        if (Math.hypot(dx, dy) <= 4.8) return carrier;
      }
      return nearestOpponent(player, snapshot);
    }
    function shotFollowAssignments(snapshot,world) {
      const metric=metricBall(snapshot.ball,snapshot),dir=metric.velocity.x>=0?1:-1;
      const goalX=dir>0?105:0,time=Math.max(0,(goalX-metric.position.x)/(Math.abs(metric.velocity.x)>.1?metric.velocity.x:dir*.1));
      const centreY=clamp(metric.position.y+metric.velocity.y*time,-4.5,4.5);
      const byId={},rows=[];
      for(const team of snapshot.teams){
        const attacking=team.attackingDirection===dir;
        const target={x:goalX-dir*(attacking?4:2),y:centreY};
        const candidates=world.players.filter(p=>p.teamId===team.id).map(p=>({p,live:snapshot.players.find(q=>q.id===p.id)}))
          .filter(o=>o.live&&!o.live.isGK&&!o.live.sentOff&&o.live.contactEligible)
          .sort((a,b)=>Math.hypot(a.p.position.x-target.x,a.p.position.y-target.y)-Math.hypot(b.p.position.x-target.x,b.p.position.y-target.y)||a.p.id.localeCompare(b.p.id));
        for(const [i,o] of candidates.slice(0,2).entries()){
          const row={playerId:o.p.id,teamId:team.id,target:{x:target.x-dir*i*2,y:clamp(target.y+(i?3:-2),-9,9)},
            distanceMetres:Math.hypot(o.p.position.x-target.x,o.p.position.y-target.y),intended:false,human:snapshot.humanPlayerIds.has(o.p.id),
            authority:attacking?'v2-shot-follow-in':'v2-shot-rebound-defend'};
          byId[o.p.id]=row;rows.push(row);
        }
      }
      return {byId,rows};
    }
    function looseBallForecast(snapshot) {
      const b=metricBall(snapshot.ball,snapshot),grounded=b.position.z<=.13&&b.velocity.z<=.65;
      let state=dependencies.ball.createBallState({...domain.ballState,id:snapshot.ball.id,position:b.position,velocity:b.velocity,
        grounded,settled:false,regime:grounded?dependencies.ball.REGIMES.ROLL:dependencies.ball.REGIMES.FLIGHT});
      let context=dependencies.ball.createSimulationContext({seed:stableHash('loose-race:'+deterministicSeed+':'+snapshot.tick)});
      const samples=[{tick:0,...b.position}];
      if(Math.hypot(b.velocity.x,b.velocity.y,b.velocity.z)<.05)return samples;
      // One shared detached MR forecast. Both teams read the same grass,
      // bounce and knock-on turf curve; no runner or ball gains a boost.
      for(let ticks=0;ticks<180;ticks+=15){
        const stepped=dependencies.ball.step(state,context,15*FIXED_TICK_SECONDS,goalEnvironment());
        for(let i=23;i<stepped.trace.samples.length;i+=24){const sample=stepped.trace.samples[i];
          samples.push({tick:ticks+Math.ceil((i+1)/4),...sample.position});}
        state=stepped.state;context=stepped.context;if(state.settled)break;
      }
      return samples;
    }
    function recoveryInterception(snapshot,player,forecast) {
      const profile=movementRaceProfile(player,snapshot,true);
      const contactAfter=Math.max(player.contactLockTicks||0,player.stunTicks||0);
      const intercept=forecast.find(sample=>sample.tick>=contactAfter&&sample.z<=1.05&&movementRaceEtaTicks(profile,sample)<=sample.tick);
      const point=intercept||forecast[forecast.length-1];
      return {target:{x:clamp(point.x,.4,104.6),y:clamp(point.y,-33.6,33.6)},
        etaSeconds:Math.max(contactAfter,movementRaceEtaTicks(profile,point))*FIXED_TICK_SECONDS,
        predictedInterceptTick:snapshot.tick+(intercept?intercept.tick:Math.max(contactAfter,movementRaceEtaTicks(profile,point)))};
    }
    function looseBallRecoveryAssignments(snapshot, world, possession) {
      const gate = snapshot.contact.gate || {};
      if (snapshot.ball.ownerId || !gate.livePlay || gate.restartActive || gate.replayActive ||
          gate.keeperAuthority) return { byId: {}, rows: [] };
      if((snapshot.ball.flightType==='shot'||snapshot.ball.flightType==='penalty') && (Math.hypot(snapshot.ball.vx,snapshot.ball.vy,snapshot.ball.zv)>.01 || snapshot.ball.z>.01))return shotFollowAssignments(snapshot,world);
      // Pending offside provenance must not make a physically live ball
      // untouchable. Movement may send both teams toward the real loose ball;
      // the host's existing offside phase remains the sole authority deciding
      // whether the named attacker becomes involved or another player resets
      // the phase. Recovery never grants possession here.
      const flightType = String(snapshot.ball.flightType || '').toLowerCase();
      const ball = metricBall(snapshot.ball, snapshot), speed = Math.hypot(ball.velocity.x, ball.velocity.y);
      // Flight labels retain kick provenance after the ball stops. A grounded,
      // stationary ball is collectible even if that old label still says shot.
      // High services have their own physical chase; shots have follow-in jobs.
      const stopped = snapshot.ball.z === 0 && speed === 0 && ball.velocity.z === 0;
      const droppingSecondBall=ball.position.z<=1.05&&ball.velocity.z<=0&&
        (!possession.inFlight||possession.arrivalWindowEntered||snapshot.ball.authoredRouteExpired);
      if (!stopped && !droppingSecondBall && !snapshot.ball.authoredRouteExpired && /(cross|corner|free-kick|penalty|clearance)/.test(flightType)) return { byId: {}, rows: [] };
      if (ball.position.z > LOOSE_BALL_MAX_HEIGHT_METRES || speed > LOOSE_BALL_MAX_SPEED_METRES_PER_SECOND) {
        return { byId: {}, rows: [] };
      }
      // A route that expires on this tick is already a neutral race. Do not
      // let its stale host target keep the old receiver artificially selected
      // until the host clears ball.target during commit.
      const intendedId = possession && possession.routeExpiredAtTick === snapshot.tick ? '' :
        String(possession && possession.inFlight && possession.intendedReceiverId ||
          snapshot.contact.intendedReceiverId || snapshot.ball.targetId || '');
      const byId = {}, rows = [],forecast=looseBallForecast(snapshot);
      for (const team of snapshot.teams) {
        const candidates = world.players.map(statePlayer => {
          const livePlayer = snapshot.players.find(player => player.id === statePlayer.id);
          if (!livePlayer || livePlayer.teamId !== team.id || livePlayer.sentOff || livePlayer.isGK ||
              !livePlayer.contactEligible&&livePlayer.contactLockTicks<=0 || snapshot.dribbling.specialActionPlayerIds?.includes(livePlayer.id)) return null;
          // A deliberate in-flight pass is not a neutral loose-ball scramble.
          // The owning team follows its authored reception route while only
          // opponents may actively close the travelling ball.
          if (possession && possession.inFlight && livePlayer.teamId === possession.teamId &&
              !(possession.arrivalWindowEntered && livePlayer.id === possession.intendedReceiverId)) return null;
          const meeting=recoveryInterception(snapshot,livePlayer,forecast),target=meeting.target;
          const distance=Math.hypot(target.x-statePlayer.position.x,target.y-statePlayer.position.y);
          const intended=livePlayer.id===intendedId;
          const etaSeconds=meeting.etaSeconds;
          return {playerId:livePlayer.id,teamId:team.id,target,distance,etaSeconds,intended,
            predictedInterceptTick:meeting.predictedInterceptTick,
            human:snapshot.humanPlayerIds.has(livePlayer.id)};
        }).filter(Boolean).sort((left, right) => left.etaSeconds - right.etaSeconds ||
          Number(right.intended) - Number(left.intended) || left.playerId.localeCompare(right.playerId));
        const addAssignment = (candidate, authority) => {
          if (!candidate || byId[candidate.playerId]) return;
          const row = {
            playerId: candidate.playerId, teamId: candidate.teamId,
            target: { x: candidate.target.x, y: candidate.target.y },
            distanceMetres: +candidate.distance.toFixed(3), etaSeconds: +candidate.etaSeconds.toFixed(3),
            intended: candidate.intended, human: candidate.human, authority, urgency:'sprint', targetSpeed:1,
            predictedInterceptTick:candidate.predictedInterceptTick
          };
          byId[row.playerId] = row; rows.push(row);
        };
        const selected = candidates[0];
        if (selected) {
          addAssignment(selected, 'v2-loose-ball-recovery');
        }
        // Team arbitration still names one fastest automatic recovery runner,
        // but the currently controlled footballer also gets a short, local
        // approach vector. Contact remains physical First Touch authority;
        // this does not grant ownership or displace the team winner.
        for (const candidate of candidates) {
          if (!candidate.human || byId[candidate.playerId] ||
              candidate.distance > HUMAN_LOOSE_BALL_GUIDANCE_MAX_DISTANCE_METRES ||
              candidate.etaSeconds > HUMAN_LOOSE_BALL_GUIDANCE_MAX_ETA_SECONDS) continue;
          addAssignment(candidate, 'v2-human-loose-ball-guidance');
        }
      }
      rows.sort((left, right) => left.teamId.localeCompare(right.teamId));
      return { byId, rows, forecast };
    }
    function highBallAssignments(snapshot, world, possession, maps) {
      const ball = metricBall(snapshot.ball, snapshot), gate = snapshot.contact.gate;
      // Ground exits from a keeper's hands and checked throws to feet have
      // an authored foot meeting. An aerial-cover job must not pull that
      // named receiver away from the very rendezvous the MR race accepted.
      if(possession?.deliberatePass&&(['ground-pass','keeper-pass','keeper-ground-roll'].includes(snapshot.ball.flightType)||possession.meetingContract==='checked-feet-throw'))return {flight:null,rows:[]};
      const peak = ball.position.z + Math.max(0, ball.velocity.z) ** 2 / 19.62;
      if (/keeper-deflection|woodwork-rebound|involuntary-deflection/.test(snapshot.ball.flightType)&&ball.position.z<=1.4 || snapshot.ball.isShot || /shot|penalty/.test(snapshot.ball.flightType) || capability.workflow !== 'cpu-v-cpu' || snapshot.ball.ownerId || !gate.livePlay || gate.keeperAuthority ||
          gate.restartActive || gate.specialActionAuthority&&snapshot.dribbling.specialActionPlayerIds===null || (peak < 1.05 && ball.position.z < .4) ||
          hasPhysicalDribblingLease(domain.dribblingState)) return { flight: null, rows: [] };
      const sourceId = possession.sourcePlayerId || snapshot.ball.lastKickerId || '';
      const sourcePlayer = snapshot.players.find(p => p.id === sourceId);
      const sourceTeam = sourcePlayer && sourcePlayer.teamId || possession.teamId || snapshot.ball.lastKickerTeamId || null;
      const receivingPoint=possession.intendedTarget&&metricPoint(possession.intendedTarget,snapshot),
        receivingTeam=snapshot.teams.find(t=>t.id===sourceTeam),
        aerialFinishingRun=possession.movingInBehind&&receivingPoint&&receivingTeam&&
          Math.abs((receivingTeam.attackingDirection>0?105:0)-receivingPoint.x)<21&&Math.abs(receivingPoint.y)<20.16;
      const checkedFeetRendezvous=!aerialFinishingRun&&possession.meetingContract==='cpu-pass-race-mr-rendezvous-v2'&&possession.intendedTarget&&
        (possession.receiverMeeting==='feet'||possession.receiverMeeting==null&&!/cross|corner|free-kick/.test(snapshot.ball.flightType));
      const sequence = snapshot.ball.launchIntent && snapshot.ball.launchIntent.sequence || domain.lastLaunchSequence || 'loose';
      const key = String(sequence) + ':' + sourceId;
      let flight = domain.aerialFlight && domain.aerialFlight.key === key ? clone(domain.aerialFlight) : null;
      if (!flight || snapshot.tick - flight.projectedTick >= 18) {
        let state = dependencies.ball.createBallState({ ...(domain.ballState || {}), id: snapshot.ball.id,
          position: ball.position, velocity: ball.velocity, angularVelocity: domain.ballState && domain.ballState.angularVelocity || { x: 0, y: 0, z: 0 },
          grounded: false, settled: false, regime: dependencies.ball.REGIMES.FLIGHT });
        let context = dependencies.ball.createSimulationContext({ seed: stableHash(['aerial-landing', deterministicSeed, key, snapshot.tick].join(':')) });
        let landing = { x: state.position.x, y: state.position.y }, ticks = 0;
        const trajectory = [];
        // Project MR only once per 18 committed ticks. This is a detached
        // forecast; neither the real ball nor the match's random context moves.
        while (ticks < 240) {
          const step = dependencies.ball.step(state, context, 15 * FIXED_TICK_SECONDS, goalEnvironment());
          for (let i = 3; i < step.trace.samples.length; i += 16) {
            const sample = step.trace.samples[i];
            if (sample.position.z <= 2.65) trajectory.push({ tick: snapshot.tick + ticks + Math.ceil((i + 1) / 4),
              x: sample.position.x, y: sample.position.y, z: sample.position.z, vz:sample.velocity.z });
          }
          const hit = step.trace.samples.findIndex(sample => sample.position.z <= 1.0 && sample.velocity.z <= 0);
          if (hit >= 0) {
            const sample = step.trace.samples[hit]; landing = { x: sample.position.x, y: sample.position.y };
            ticks += Math.ceil((hit + 1) / 4); break;
          }
          state = step.state; context = step.context; ticks += 15;
          landing = { x: state.position.x, y: state.position.y };
          if (state.settled) break;
        }
        flight = { key, sourcePlayerId: sourceId, sourceTeamId: sourceTeam,
          releaseTick: flight ? flight.releaseTick : snapshot.tick, projectedTick: snapshot.tick,
          landing: { x: clamp(landing.x, .5, 104.5), y: clamp(landing.y, -33.5, 33.5) },
          arrivalTick: snapshot.tick + Math.max(1, ticks), flightType: snapshot.ball.flightType, trajectory };
      }
      const rows = [];
      for (const team of snapshot.teams) {
        const candidates = snapshot.players.filter(p => p.teamId === team.id && !p.isGK && !p.sentOff &&
          !snapshot.dribbling.specialActionPlayerIds?.includes(p.id)&&
          !(possession.deliberatePass&&p.id===sourceId&&snapshot.tick-flight.releaseTick<18)).map(player => {
          const metric = metricPoint(player, snapshot), profile = movementRaceProfile(player, snapshot,
            player.id === possession.intendedReceiverId);
          const height = (player.heightM || 1.8) + .18 + (finite(player.attrs?.jumping, 70) - 1) / 98 * .34;
          const intercept = (flight.trajectory || []).find(sample => sample.tick > snapshot.tick && sample.vz <= 1.5 && sample.z <= height &&
            movementRaceEtaTicks(profile, sample) <= sample.tick - snapshot.tick);
          const target = intercept || flight.landing, etaTicks = movementRaceEtaTicks(profile, target);
          return { player, metric, etaTicks, target, contactTick: intercept ? intercept.tick : flight.arrivalTick,
            reachable: !!intercept || etaTicks <= flight.arrivalTick - snapshot.tick + 12,
            distance: Math.hypot(metric.x - target.x, metric.y - target.y) };
        }).sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.contactTick - b.contactTick || a.etaTicks - b.etaTicks ||
          a.distance - b.distance || a.player.id.localeCompare(b.player.id));
        const primary = candidates[0];
        if (!primary) continue;
        const namedFeet=checkedFeetRendezvous&&primary.player.id===possession.intendedReceiverId,
          receivingTarget=namedFeet&&maps.reception[primary.player.id],target=receivingTarget||primary.target,
          receivingEta=receivingTarget?movementRaceEtaTicks(movementRaceProfile(primary.player,snapshot,true),target):primary.etaTicks;
        const row = { playerId: primary.player.id, teamId: team.id, target: { x: primary.target.x, y: primary.target.y },
          authority: 'v2-high-ball-contest', etaSeconds: receivingEta / 60,
          distanceMetres:receivingTarget?Math.hypot(primary.metric.x-target.x,primary.metric.y-target.y):primary.distance,
          reachable: primary.reachable, flightKey: key, contactHeightMetres:primary.target.z??1,
          predictedArrivalTick: namedFeet?possession.predictedArrivalTick:primary.contactTick };
        if(receivingTarget)row.target={x:target.x,y:target.y};
        if(team.id===sourceTeam&&!checkedFeetRendezvous){
          const attrs=primary.player.attrs||{},quality=(finite(attrs.volleys,attrs.control||70)+finite(attrs.technique,attrs.control||70))/198,
            drop=(flight.trajectory||[]).find(q=>q.tick>snapshot.tick&&q.z<=1.5&&q.vz<=0&&
              Math.abs((team.attackingDirection>0?105:0)-q.x)<21&&Math.abs(q.y)<20.16),
            wantsVolley=drop&&stableHash([key,primary.player.id,'volley'].join(':'))/0xffffffff<.18+quality*.56,
            wantsControl=!wantsVolley&&stableHash([key,primary.player.id,'chest'].join(':'))/0xffffffff<.15+finite(attrs.control,70)/99*.65;
          if(drop&&(wantsVolley||wantsControl)){
            const opposition=snapshot.players.filter(p=>p.teamId!==team.id&&!p.sentOff&&!p.isGK),
              opponentEta=Math.min(...opposition.map(p=>movementRaceEtaTicks(movementRaceProfile(p,snapshot,true),drop))),
              stance={x:drop.x-team.attackingDirection*(wantsVolley?.50:0),y:drop.y},
              ownEta=movementRaceEtaTicks(movementRaceProfile(primary.player,snapshot,true),stance);
            // Reception guidance plants short of its target. Leave room for
            // that plant inside the existing contact window: meet the chest
            // ball directly, with braking supplying the body offset. Adding
            // another offset can miss the brief .5m chest-contact window.
            if(ownEta<=drop.tick-snapshot.tick+4&&opponentEta>drop.tick-snapshot.tick-3){
              row.target=stance;row.facing={x:team.attackingDirection,y:0};row.receivingStance=wantsVolley?'volley':'control';
              row.predictedArrivalTick=drop.tick;row.distanceMetres=Math.hypot(primary.metric.x-stance.x,primary.metric.y-stance.y);
            }
          }
        }
        rows.push(row);
        maps.reception[primary.player.id] = row.target;
        delete maps.defensive[primary.player.id]; delete maps.run[primary.player.id]; delete maps.support[primary.player.id];
        if (!checkedFeetRendezvous&&possession.intendedReceiverId && possession.intendedReceiverId !== primary.player.id &&
            snapshot.players.find(p => p.id === possession.intendedReceiverId)?.teamId === team.id) delete maps.reception[possession.intendedReceiverId];
        // The challenger attacks the ball; the remaining defensive unit drops
        // behind the landing point to cover a missed header and the second ball.
        let secondChallenger=false;
        for (const candidate of candidates.slice(1)) {
          if(checkedFeetRendezvous&&candidate.player.id===possession.intendedReceiverId)continue;
          const ownGoal=team.attackingDirection>0?0:105,
            reachableContest=!secondChallenger&&!checkedFeetRendezvous&&sourceTeam&&sourceTeam!==team.id&&
              Math.abs(primary.target.x-ownGoal)<35&&candidate.distance<12&&
              movementRaceEtaTicks(movementRaceProfile(candidate.player,snapshot,true),primary.target)<=primary.contactTick-snapshot.tick+6;
          if(reachableContest){
            const target={x:primary.target.x,y:primary.target.y};secondChallenger=true;
            maps.reception[candidate.player.id]=target;delete maps.defensive[candidate.player.id];delete maps.run[candidate.player.id];delete maps.support[candidate.player.id];
            rows.push({playerId:candidate.player.id,teamId:team.id,target,authority:'v2-high-ball-contest',flightKey:key,
              etaSeconds:movementRaceEtaTicks(movementRaceProfile(candidate.player,snapshot,true),target)/60,
              distanceMetres:Math.hypot(candidate.metric.x-target.x,candidate.metric.y-target.y),reachable:true,predictedArrivalTick:primary.contactTick});continue;
          }
          if (!/(CB|LB|RB|WB|DM|def)/i.test(candidate.player.position + ' ' + candidate.player.role) || candidate.distance > 30) continue;
          const shape = maps.shape[candidate.player.id] || candidate.metric;
          const target = { x: clamp(team.attackingDirection > 0 ? Math.min(shape.x, flight.landing.x - 5.5)
            : Math.max(shape.x, flight.landing.x + 5.5), .75, 104.25), y: shape.y };
          maps.shape[candidate.player.id] = target;
          delete maps.defensive[candidate.player.id]; delete maps.run[candidate.player.id]; delete maps.support[candidate.player.id];
          delete maps.reception[candidate.player.id];
          rows.push({ playerId: candidate.player.id, teamId: team.id, target, authority: 'v2-high-ball-cover', flightKey: key });
        }
      }
      // Look at the incoming ball while moving to its future interception.
      // Otherwise a defender running upfield with a delivery behind him can
      // arrive in range but still present his back to the aerial contact.
      for(const row of rows)if(row.authority==='v2-high-ball-contest'&&sourceTeam&&row.teamId!==sourceTeam){
        const player=world.players.find(p=>p.id===row.playerId);
        if(player){row.facing=unit({x:ball.position.x-player.position.x,y:ball.position.y-player.position.y},player.facing);row.defendingRead=true;}
      }
      return { flight, rows };
    }
    function flightBlockAssignments(snapshot,world,aerialFlight){
      const type=snapshot.ball.flightType==='ground'&&snapshot.ball.serviceFlight?snapshot.ball.serviceFlight:snapshot.ball.flightType,isShot=/shot/.test(type),isCross=/cross|corner/.test(type),
        sourceTeam=snapshot.ball.lastKickerTeamId;
      if(snapshot.ball.ownerId||!sourceTeam||!isShot&&!isCross)return {cache:null,rows:[]};
      const ball=metricBall(snapshot.ball,snapshot),speed=Math.hypot(ball.velocity.x,ball.velocity.y);
      if(speed<3)return {cache:null,rows:[]};
      const near=world.players.filter(p=>p.teamId!==sourceTeam&&!snapshot.humanPlayerIds.has(p.id))
        .map(p=>({p,roster:snapshot.players.find(r=>r.id===p.id),gap:Math.hypot(p.position.x-ball.position.x,p.position.y-ball.position.y)}))
        .filter(o=>o.roster&&!o.roster.isGK&&!o.roster.sentOff&&!o.roster.stunTicks&&o.gap<16&&
          (o.p.position.x-ball.position.x)*ball.velocity.x+(o.p.position.y-ball.position.y)*ball.velocity.y>-.5)
        .sort((a,b)=>a.gap-b.gap||a.p.id.localeCompare(b.p.id)).slice(0,3);
      if(!near.length)return {cache:null,rows:[]};
      const key=[snapshot.ball.launchIntent?.sequence||domain.lastLaunchSequence,snapshot.ball.lastKickerId,type].join(':'),
        cached=domain.blockFlight;
      let cache=cached?.key===key&&snapshot.tick-cached.projectedTick<6?clone(cached):null;
      if(!cache){
        let trajectory=aerialFlight?.trajectory?.filter(p=>p.tick>=snapshot.tick&&p.tick<=snapshot.tick+60)||[];
        if(!trajectory.length){
          trajectory=[];
          let state=dependencies.ball.createBallState({...domain.ballState,id:snapshot.ball.id,position:ball.position,velocity:ball.velocity,
            grounded:ball.position.z<=.13&&ball.velocity.z<=.1,settled:false,
            regime:ball.position.z<=.13&&ball.velocity.z<=.1?dependencies.ball.REGIMES.ROLL:dependencies.ball.REGIMES.FLIGHT}),
            context=dependencies.ball.createSimulationContext({seed:stableHash('block:'+key)});
          for(let ticks=0;ticks<60;ticks+=15){
            const next=dependencies.ball.step(state,context,.25,goalEnvironment());
            for(let i=11;i<next.trace.samples.length;i+=12){const p=next.trace.samples[i];
              trajectory.push({tick:snapshot.tick+ticks+Math.ceil((i+1)/4),...p.position});}
            state=next.state;context=next.context;if(state.settled)break;
          }
        }
        cache={key,projectedTick:snapshot.tick,trajectory};
      }
      const candidates=[];
      for(const {p,roster}of near){
        const profile={...movementRaceProfile({...roster,...livePoint(p.position,snapshot),
          vx:p.velocity.x*snapshot.units.xPerMetre/60,vy:p.velocity.y*snapshot.units.yPerMetre/60},snapshot,true),reach:.30},
          anticipation=(finite(roster.attrs.defend,70)+finite(roster.attrs.awareness,70))/198,
          readTicks=(1-anticipation)*8;
        const meeting=cache.trajectory.find(q=>q.tick>snapshot.tick&&q.z<=1.65&&
          movementRaceEtaTicks(profile,q)+readTicks<=q.tick-snapshot.tick);
        if(meeting)candidates.push({playerId:p.id,teamId:p.teamId,target:{x:meeting.x,y:meeting.y},
          contactTick:meeting.tick,purpose:isShot?'shot':'cross',
          score:meeting.tick+Math.hypot(meeting.x-p.position.x,meeting.y-p.position.y)*2-anticipation*5});
      }
      candidates.sort((a,b)=>a.score-b.score||a.playerId.localeCompare(b.playerId));
      return {cache,rows:candidates.slice(0,1)};
    }
    function movementCommands(snapshot, world, formations, decisions, possession) {
      const commands = [], maps = targetMaps(formations, decisions, snapshot, possession);
      const aerial = highBallAssignments(snapshot, world, possession, maps);
      const recovery = aerial.flight ? { byId: {}, rows: [] } : looseBallRecoveryAssignments(snapshot, world, possession), nextTick = world.tick + 1;
      const blocks=flightBlockAssignments(snapshot,world,aerial.flight);
      for(let i=blocks.rows.length-1;i>=0;i--){
        const row=blocks.rows[i],aerialRead=aerial.rows.find(a=>a.playerId===row.playerId&&a.authority==='v2-high-ball-contest');
        // Keep the earlier reachable header. A later low block forecast must
        // not pull this same defender away from his real aerial contact.
        if(aerialRead?.reachable&&aerialRead.contactHeightMetres>=1.05&&aerialRead.predictedArrivalTick<=row.contactTick)blocks.rows.splice(i,1);
      }
      for(const row of blocks.rows){
        maps.defensive[row.playerId]={...row,type:row.purpose+'-block',targetSpeed:1,urgency:'sprint',accelerate:true,connectedLine:false};
        delete recovery.byId[row.playerId];delete maps.run[row.playerId];delete maps.support[row.playerId];delete maps.reception[row.playerId];
        for(let i=recovery.rows.length-1;i>=0;i--)if(recovery.rows[i].playerId===row.playerId)recovery.rows.splice(i,1);
      }
      const leaseOwnerId = hasPhysicalDribblingLease(domain.dribblingState)
        ? String(domain.dribblingState.logicalOwnerId || '') : '';
      const leaseBall = leaseOwnerId ? metricBall(snapshot.ball, snapshot) : null;
      const leaseTarget = leaseBall ? {
        x: clamp(leaseBall.position.x + leaseBall.velocity.x * FIXED_TICK_SECONDS,
          METRIC_PITCH.xMin, METRIC_PITCH.xMax),
        y: clamp(leaseBall.position.y + leaseBall.velocity.y * FIXED_TICK_SECONDS,
          METRIC_PITCH.yMin, METRIC_PITCH.yMax)
      } : null;
      const raceJostles={};
      const racers=recovery.rows.filter(r=>r.authority==='v2-loose-ball-recovery'&&!r.human);
      if(racers.length===2&&racers[0].teamId!==racers[1].teamId){
        const pair=racers.map(r=>({r,p:world.players.find(p=>p.id===r.playerId),live:snapshot.players.find(p=>p.id===r.playerId)}));
        const [a,b]=pair,ball=metricBall(snapshot.ball,snapshot).position;
        if(a.p&&b.p&&!a.p.action&&!b.p.action&&a.live.contactEligible&&b.live.contactEligible&&a.live.stunTicks<=0&&b.live.stunTicks<=0){
          const gap=Math.hypot(a.p.position.x-b.p.position.x,a.p.position.y-b.p.position.y),
            da=Math.hypot(a.p.position.x-ball.x,a.p.position.y-ball.y),db=Math.hypot(b.p.position.x-ball.x,b.p.position.y-ball.y),
            toward=unit({x:a.r.target.x-a.p.position.x,y:a.r.target.y-a.p.position.y},a.p.facing),
            normal=unit({x:b.p.position.x-a.p.position.x,y:b.p.position.y-a.p.position.y},toward),
            alignment=Math.abs(toward.x*normal.x+toward.y*normal.y),parallel=a.p.facing.x*b.p.facing.x+a.p.facing.y*b.p.facing.y;
          if(gap<=a.p.radius+b.p.radius+.30&&da<3.5&&db<3.5&&alignment<.65&&parallel>.25){
            const actor=da<=db?a:b,target=actor===a?b:a;raceJostles[actor.p.id]=target.p.id;
          }
        }
      }
      const leaseRecoveryRows = [], receptionGuidanceRows = [];
      let sharedRecoveryForecast=recovery.forecast;
      const currentTackles = new Set(snapshot.players.filter(player => player.tackleActive).map(player => player.id));
      for (const statePlayer of world.players) {
        const livePlayer = snapshot.players.find(player => player.id === statePlayer.id); if (!livePlayer) continue;
        // Physical skill/contact stagger already exists in the host handoff.
        // Respect its remaining duration rather than immediately accelerating
        // a wrong-footed defender back through the carrier's chosen exit.
        if (livePlayer.stunTicks > 0) {
          commands.push({ id: 'stagger-stop:' + livePlayer.id + ':' + nextTick, tick: nextTick, playerId: livePlayer.id, type: 'stop',cancelAction:true });
          continue;
        }
        const isHuman = snapshot.humanPlayerIds.has(livePlayer.id);
        const tackleEdge = currentTackles.has(livePlayer.id) && !domain.lastTackleState.has(livePlayer.id);
        const shoulderEdge = livePlayer.shoulderActive && !domain.lastTackleState.has('shoulder:' + livePlayer.id);
        const defensiveIntent = !isHuman ? maps.defensive[livePlayer.id] || null : null;
        const neutralRace=recovery.byId[livePlayer.id]?.authority==='v2-loose-ball-recovery'&&
          recovery.rows.some(row=>row.teamId!==livePlayer.teamId&&row.authority==='v2-loose-ball-recovery');
        const cpuPhysicalCandidate = !neutralRace && defensiveIntent && defensiveIntent.physicalAction &&
          defensiveIntent.physicalAction.issuedTick === snapshot.tick ? defensiveIntent.physicalAction : null;
        // A clean tackle win must create a readable change of possession. CPU
        // defenders may keep pressing during the transition, but a second
        // Movement-authority tackle cannot instantly ping the ball back while
        // the winner and loser are still occupying the same contact space.
        const cpuPhysical = cpuPhysicalCandidate && cpuPhysicalActionAllowed(domain.transition, snapshot.tick)
          ? cpuPhysicalCandidate : null;
        if (tackleEdge || shoulderEdge || cpuPhysical) {
          const target = cpuPhysical
            ? snapshot.players.find(player => player.id === String(cpuPhysical.targetPlayerId || defensiveIntent.targetPlayerId || '')) || null
            : challengeTarget(livePlayer, snapshot, possession);
          const direction = cpuPhysical?.direction ? unit(cpuPhysical.direction,statePlayer.facing) : target ? unit({ x: target.x - livePlayer.x, y: target.y - livePlayer.y }, statePlayer.facing) : statePlayer.facing;
          const type = cpuPhysical ? cpuPhysical.type : tackleEdge ? 'stand-tackle' : 'shoulder-challenge';
          commands.push({ id: type + ':' + livePlayer.id + ':' + nextTick,
            tick: nextTick, playerId: livePlayer.id, type,
            targetId: target && target.id, direction }); continue;
        }
        let desired = { x: 0, y: 0 }, intensity = 0, mode = 'idle', cpuMovementRoute = null,directionalPursuit=false,receivingFacing=null;
        const leaseRecovery = leaseTarget && livePlayer.id === leaseOwnerId ? (() => {
          const distance = Math.hypot(leaseTarget.x - statePlayer.position.x,
            leaseTarget.y - statePlayer.position.y);
          const row = {
            playerId: livePlayer.id,
            teamId: livePlayer.teamId,
            target: { ...leaseTarget },
            distanceMetres: +distance.toFixed(3),
            etaSeconds: null,
            intended: true,
            human: isHuman,
            authority: 'true-feel-lease-recovery'
          };
          leaseRecoveryRows.push(row);
          return row;
        })() : null;
        const knockOn=snapshot.dribbling.directionalKnockOnIntent;
        const knockOnRecovery=!isHuman&&knockOn&&knockOn.playerId===livePlayer.id?(()=>{
          const meeting=recoveryInterception(snapshot,livePlayer,sharedRecoveryForecast||
            (sharedRecoveryForecast=looseBallForecast(snapshot))),target=meeting.target;
          const row={playerId:livePlayer.id,teamId:livePlayer.teamId,target,distanceMetres:Math.hypot(target.x-statePlayer.position.x,target.y-statePlayer.position.y),
            etaSeconds:meeting.etaSeconds,predictedInterceptTick:meeting.predictedInterceptTick,
            intended:true,human:false,authority:'v2-knock-on-chase'};leaseRecoveryRows.push(row);return row;
        })():null;
        // During a True Feel touch the player still logically owns the action,
        // but the physical ball is ahead of their feet. Guide Movement toward
        // that real MR position instead of continuing toward an unrelated
        // tactical carrier target and letting the ball drift away.
        const recoveryIntent = knockOnRecovery || leaseRecovery || recovery.byId[livePlayer.id] || null;
        const receptionTarget = maps.reception[livePlayer.id] || null;
        if (isHuman) {
          const control = livePlayer.control || { x: 0, y: 0, strength: 0, sprint: false };
          const rawDirection = control.strength > 0.02 ? unit(control, statePlayer.facing) : null;
          if (recoveryIntent) {
            const toward = { x: recoveryIntent.target.x - statePlayer.position.x, y: recoveryIntent.target.y - statePlayer.position.y };
            const recoveryDirection = unit(toward, statePlayer.facing), distance = vectorLength(toward);
            const opposing = rawDirection && control.strength > 0.55 &&
              rawDirection.x * recoveryDirection.x + rawDirection.y * recoveryDirection.y < -0.2;
            if (!opposing) {
              const weight = rawDirection ? clamp((recoveryIntent.intended ? 0.68 : 0.48) - control.strength * 0.24, 0.22, 0.68) : 1;
              desired = rawDirection ? unit({ x: rawDirection.x * (1 - weight) + recoveryDirection.x * weight,
                y: rawDirection.y * (1 - weight) + recoveryDirection.y * weight }, recoveryDirection) : recoveryDirection;
              intensity = Math.max(control.strength, clamp(distance / 4.5, 0.3, 0.82));
              mode = control.shield ? 'shield' : control.sprint ? 'sprint' : intensity > 0.38 ? 'run' : 'walk';
            } else {
              desired = rawDirection; intensity = control.strength;
              mode = control.shield ? 'shield' : control.sprint ? 'sprint' : intensity > 0.38 ? 'run' : 'walk';
            }
          } else if (receptionTarget && possession && possession.inFlight &&
              String(possession.intendedReceiverId || '') === String(livePlayer.id)) {
            const toward = { x: receptionTarget.x - statePlayer.position.x, y: receptionTarget.y - statePlayer.position.y };
            const receptionDirection = unit(toward, statePlayer.facing), distance = vectorLength(toward);
            const remainingTicks = Number.isSafeInteger(possession.predictedArrivalTick)
              ? Math.max(0, possession.predictedArrivalTick - snapshot.tick) : null;
            const remainingSeconds = remainingTicks == null ? null : remainingTicks * FIXED_TICK_SECONDS;
            const paceRating = clamp(finite(livePlayer.attrs && livePlayer.attrs.pace, 70), 1, 99);
            const runCapacity = 4.6 + (6.25 - 4.6) * (paceRating - 1) / 98;
            const sprintCapacity = 6.35 + (9.15 - 6.35) * (paceRating - 1) / 98;
            const requiredPace = remainingSeconds == null ? null : distance / Math.max(.08, remainingSeconds);
            const inputDot = rawDirection ? rawDirection.x * receptionDirection.x + rawDirection.y * receptionDirection.y : 1;
            const strongOpposingInput = Boolean(rawDirection && control.strength >= HUMAN_RECEPTION_GUIDANCE_STRONG_INPUT &&
              inputDot < HUMAN_RECEPTION_GUIDANCE_OPPOSING_DOT);
            const insideGuidanceRange = distance <= HUMAN_RECEPTION_GUIDANCE_MAX_DISTANCE_METRES;
            const agility = clamp(finite(livePlayer.attrs && livePlayer.attrs.agility, 70), 1, 99);
            const balance = clamp(finite(livePlayer.attrs && livePlayer.attrs.balance, 70), 1, 99);
            const brakingRating = (agility + balance) / 2;
            const ratedDeceleration = 6.1 + (12.4 - 6.1) * (brakingRating - 1) / 98;
            const closingSpeed = statePlayer.velocity.x * receptionDirection.x + statePlayer.velocity.y * receptionDirection.y;
            const stoppingDistance = Math.max(0, closingSpeed) * Math.max(0, closingSpeed) /
              Math.max(.1, 2 * ratedDeceleration);
            const movingAwayFromMeeting = closingSpeed < -.45;
            // Neutral assistance is allowed to read and approach the meeting,
            // but it must not turn a missed braking point into a full-speed
            // orbit. Brake on the existing line first; after the player has
            // planted, Movement can turn cleanly and physical First Touch can
            // still decide the ball. Any meaningful user direction remains
            // authoritative and bypasses this automatic plant.
            const neutralReceptionBrake = !rawDirection && insideGuidanceRange &&
              (movingAwayFromMeeting || distance <= stoppingDistance + .35);
            const guidanceWeight = !insideGuidanceRange || strongOpposingInput ? 0 : rawDirection
              ? clamp(.52 - control.strength * .40, .10, .42) : .72;
            if (distance <= .28 || neutralReceptionBrake) {
              desired = rawDirection || statePlayer.facing;
              intensity = rawDirection ? control.strength : 0;
              mode = intensity <= .02 ? 'idle' : control.shield ? 'shield' : control.sprint ? 'sprint' : intensity > .38 ? 'run' : 'walk';
            } else if (guidanceWeight > 0) {
              desired = rawDirection ? unit({
                x: rawDirection.x * (1 - guidanceWeight) + receptionDirection.x * guidanceWeight,
                y: rawDirection.y * (1 - guidanceWeight) + receptionDirection.y * guidanceWeight
              }, receptionDirection) : receptionDirection;
              const assistedSprint = control.sprint || (!rawDirection && requiredPace != null && requiredPace > runCapacity * .74);
              const movementCapacity = assistedSprint ? sprintCapacity : runCapacity;
              const timedIntensity = requiredPace == null
                ? clamp(distance / 6.5, .34, .84)
                : clamp(requiredPace / Math.max(.1, movementCapacity) * 1.18 + .08, .38, .98);
              intensity = Math.max(control.strength, timedIntensity);
              mode = control.shield ? 'shield' : assistedSprint ? 'sprint' : intensity > .38 ? 'run' : 'walk';
            } else {
              desired = rawDirection || desired;
              intensity = control.strength;
              mode = intensity <= .02 ? 'idle' : control.shield ? 'shield' : control.sprint ? 'sprint' : intensity > .38 ? 'run' : 'walk';
            }
            if (insideGuidanceRange) receptionGuidanceRows.push({
              playerId: livePlayer.id,
              teamId: livePlayer.teamId,
              target: { x: receptionTarget.x, y: receptionTarget.y },
              distanceMetres: +distance.toFixed(3),
              etaSeconds: remainingSeconds == null ? null : +remainingSeconds.toFixed(3),
              requiredPaceMetresPerSecond: requiredPace == null ? null : +requiredPace.toFixed(3),
              intended: true,
              human: true,
              authority: 'v2-human-reception-guidance',
              guidanceWeight: +guidanceWeight.toFixed(3),
              inputOverride: strongOpposingInput,
              neutralReceptionBrake,
              closingSpeedMetresPerSecond: +closingSpeed.toFixed(3),
              stoppingDistanceMetres: +stoppingDistance.toFixed(3),
              predictedArrivalTick: Number.isSafeInteger(possession.predictedArrivalTick) ? possession.predictedArrivalTick : null,
              predictedTerminalPaceMetresPerSecond: Number.isFinite(possession.predictedTerminalPaceMetresPerSecond)
                ? +possession.predictedTerminalPaceMetresPerSecond.toFixed(3) : null,
              meetingContract: possession.meetingContract || null
            });
          } else {
            desired = rawDirection || desired;
            intensity = control.strength; mode = intensity <= 0.02 ? 'idle' : control.shield ? 'shield' : control.sprint ? 'sprint' : intensity > 0.38 ? 'run' : 'walk';
          }
        } else {
          const metric = metricPoint(livePlayer, snapshot), runTarget = maps.run[livePlayer.id];
          const carrierTarget = snapshot.ball.ownerId === livePlayer.id ? maps.carrier[livePlayer.teamId] : null;
          const carrierIntent = carrierTarget && decisions[livePlayer.teamId].carrierIntent;
          const defensiveTarget = defensiveIntent && defensiveIntent.target || null;
          const target = recoveryIntent && recoveryIntent.target || defensiveTarget || receptionTarget || runTarget || carrierTarget || maps.support[livePlayer.id] || maps.shape[livePlayer.id];
          cpuMovementRoute = recoveryIntent ? 'recovery' : defensiveIntent ? 'defensive' :
            receptionTarget ? 'reception' : runTarget ? 'run' : carrierTarget ? 'carrier' : 'shape';
          if (target) {
            const toward = { x: target.x - metric.x, y: target.y - metric.y }, distance = vectorLength(toward);
            desired = unit(toward, statePlayer.facing);
            if (recoveryIntent) {
              const leaseRecoveryActive = recoveryIntent.authority === 'true-feel-lease-recovery';
              intensity = leaseRecoveryActive
                ? clamp(distance / 1.35, 0.58, 0.96)
                : clamp(distance / 4.2, 0.52, 1);
              mode = distance > (leaseRecoveryActive ? 0.58 : 2.2) ? 'sprint' : 'run';
              const carry = decisions[livePlayer.teamId].carrierIntent;
              if (leaseRecoveryActive && carry && (carry.type === 'carry' || carry.type === 'take-on' && carry.phase === 'burst')) {
                // Match the human sprint request through a physical touch;
                // do not brake the CPU while its own ball is running ahead.
                mode = 'sprint'; intensity = Math.max(intensity, .9);
              }
              const pending = possession.pendingTouch;
              const pendingReceipt=!leaseRecoveryActive&&!knockOnRecovery&&pending&&pending.targetId===livePlayer.id;
              const oppositionRace=recovery.rows.find(row=>row.teamId!==livePlayer.teamId&&row.authority==='v2-loose-ball-recovery');
              const contestedRecovery=oppositionRace&&oppositionRace.distanceMetres<=9&&
                recoveryIntent.distanceMetres<=9&&Math.abs(oppositionRace.etaSeconds-recoveryIntent.etaSeconds)<=1;
              if(knockOnRecovery||recoveryIntent.authority==='v2-loose-ball-recovery'&&contestedRecovery){
                mode='sprint';intensity=1;directionalPursuit=!!contestedRecovery;
              }
              if (pendingReceipt&&!contestedRecovery) {
                // Follow the exit ball at its pace. Full-speed pursuit of a
                // short receiving touch made the player run past his next boot meeting.
                const physical = metricBall(snapshot.ball, snapshot), towardBall = {
                  x: physical.position.x - statePlayer.position.x, y: physical.position.y - statePlayer.position.y
                }, gap = vectorLength(towardBall), correction = clamp((gap - .5) * 4, -2, 4), toBall = unit(towardBall, statePlayer.facing);
                const requested = { x: physical.velocity.x + toBall.x * correction,
                  y: physical.velocity.y + toBall.y * correction };
                const requestedPace = vectorLength(requested), pace = clamp(finite(livePlayer.attrs.pace, 70), 1, 99);
                const runCapacity = 4.6 + (6.25 - 4.6) * (pace - 1) / 98;
                const sprintCapacity = 6.35 + (9.15 - 6.35) * (pace - 1) / 98;
                desired = unit(requested, toBall); mode = requestedPace > runCapacity ? 'sprint' : 'run';
                intensity = clamp(requestedPace / (mode === 'sprint' ? sprintCapacity : runCapacity), .08, 1);
              }
            } else if(defensiveIntent&&['shot-block','cross-block'].includes(defensiveIntent.type)){
              // Plant the body on the meeting line. Sprinting through the
              // endpoint is not a block, even when a broad ETA says reachable.
              const race=movementRaceProfile(livePlayer,snapshot,true),pace=clamp(finite(livePlayer.attrs.pace,70),1,99),
                speed=Math.sqrt(2*race.deceleration*Math.max(0,distance-.18)),
                runCapacity=4.6+(6.25-4.6)*(pace-1)/98,
                sprintCapacity=6.35+(9.15-6.35)*(pace-1)/98;
              mode=distance<.18?'idle':speed>runCapacity?'sprint':'run';
              intensity=clamp(speed/(mode==='sprint'?sprintCapacity:runCapacity),0,1);
            } else if (defensiveIntent && !defensiveIntent.connectedLine) {
              intensity = clamp(finite(defensiveIntent.targetSpeed, defensiveIntent.type === 'press' ? .88 : .62), .18, 1);
              mode = defensiveIntent.accelerate || defensiveIntent.urgency === 'sprint' ? 'sprint' : intensity > .42 ? 'run' : 'walk';
            } else if (receptionTarget) {
              // Arrive, plant and wait for the authored MR ball path. A normal
              // committed run keeps driving through its point; a reception is
              // a rendezvous and must not sprint past the ball before arrival.
              // Braking is evaluated on the current velocity before we turn
              // back toward a missed point. This prevents the target/facing
              // fight that previously made an overshooting CPU receiver orbit
              // or spin while the ball stayed ownerless.
              const receptionDirection = unit(toward, statePlayer.facing);
              const aerialMeeting = aerial.rows.find(row => row.playerId === livePlayer.id && row.authority === 'v2-high-ball-contest');
              const agility = clamp(finite(livePlayer.attrs && livePlayer.attrs.agility, 70), 1, 99);
              const balance = clamp(finite(livePlayer.attrs && livePlayer.attrs.balance, 70), 1, 99);
              const brakingRating = (agility + balance) / 2;
              const ratedDeceleration = 6.1 + (12.4 - 6.1) * (brakingRating - 1) / 98;
              const closingSpeed = statePlayer.velocity.x * receptionDirection.x +
                statePlayer.velocity.y * receptionDirection.y;
              const stoppingDistance = Math.max(0, closingSpeed) * Math.max(0, closingSpeed) /
                Math.max(.1, 2 * ratedDeceleration);
              const movingAwayFromMeeting = closingSpeed < -.35;
              const receptionBrake = movingAwayFromMeeting || distance <= stoppingDistance + .35;
              if (distance <= .28 || receptionBrake) {
                // A high-ball challenger approaching from the wrong facing
                // still needs to turn while shedding old momentum. A stop
                // command preserves facing, causing a turn/stop loop. Plant
                // with a small rated walking step; ordinary foot receptions
                // retain their existing overshoot brake.
                const receptionTurn = movingAwayFromMeeting && distance > .28 &&
                  (aerialMeeting || vectorLength(statePlayer.velocity)<1.2);
                desired = receptionTurn ? receptionDirection : statePlayer.facing;
                intensity = receptionTurn ? .04 : 0;
                mode = receptionTurn ? 'walk' : 'idle';
              } else {
                const arrivalTick = aerialMeeting?.predictedArrivalTick ?? possession?.predictedArrivalTick;
                const remainingTicks = Number.isSafeInteger(arrivalTick) ? Math.max(0, arrivalTick - snapshot.tick) : null;
                const remainingSeconds = remainingTicks == null ? null : remainingTicks * FIXED_TICK_SECONDS;
                const paceRating = clamp(finite(livePlayer.attrs && livePlayer.attrs.pace, 70), 1, 99);
                const runCapacity = 4.6 + (6.25 - 4.6) * (paceRating - 1) / 98;
                const sprintCapacity = 6.35 + (9.15 - 6.35) * (paceRating - 1) / 98;
                const requiredPace = remainingSeconds == null ? null : distance / Math.max(.08, remainingSeconds);
                mode = distance > .55 && (requiredPace == null || requiredPace > runCapacity * .74) ? 'sprint' : 'run';
                const movementCapacity=mode==='sprint'?sprintCapacity:runCapacity;
                intensity = requiredPace == null ? clamp(distance / 3.8, .32, 1) :
                  clamp(requiredPace / Math.max(.1, movementCapacity) * 1.12 + .08, .32, 1);
              }
              if(aerialMeeting?.receivingStance||aerialMeeting?.defendingRead){
                receivingFacing=aerialMeeting.facing;
                // Use the existing direction-led momentum path to take a
                // small receiving step while continuing to face the goal.
                directionalPursuit=true;
                if(mode==='idle'){mode='walk';intensity=distance>.12?.035:aerialMeeting.defendingRead?.015:0;}
              }
              const lowBall=metricBall(snapshot.ball,snapshot);
              const aerialOpponent=aerialMeeting&&aerial.rows.find(row=>row.authority==='v2-high-ball-contest'&&row.teamId!==livePlayer.teamId);
              if(aerialOpponent&&lowBall.position.z<=1.4&&
                  aerialMeeting.distanceMetres<=9&&aerialOpponent.distanceMetres<=9&&
                  Math.abs(aerialMeeting.etaSeconds-aerialOpponent.etaSeconds)<=1){
                // A descending ball is still available for the existing
                // volley/header contact. Its contenders must chase the real
                // low interception, rather than walk around a stale landing.
                const meeting=recoveryInterception(snapshot,livePlayer,sharedRecoveryForecast||
                  (sharedRecoveryForecast=looseBallForecast(snapshot)));
                desired=unit({x:meeting.target.x-metric.x,y:meeting.target.y-metric.y},statePlayer.facing);
                mode='sprint';intensity=1;directionalPursuit=true;
                Object.assign(aerialMeeting,{target:meeting.target,etaSeconds:meeting.etaSeconds,
                  predictedInterceptTick:meeting.predictedInterceptTick});
              }
              receptionGuidanceRows.push({
                playerId: livePlayer.id,
                teamId: livePlayer.teamId,
                target: { x: receptionTarget.x, y: receptionTarget.y },
                distanceMetres: +distance.toFixed(3),
                etaSeconds: Number.isSafeInteger(possession && possession.predictedArrivalTick)
                  ? +(Math.max(0, possession.predictedArrivalTick - snapshot.tick) / 60).toFixed(3) : null,
                intended: true,
                human: false,
                authority: 'v2-cpu-reception-guidance',
                receptionBrake,
                movingAwayFromMeeting,
                closingSpeedMetresPerSecond: +closingSpeed.toFixed(3),
                stoppingDistanceMetres: +stoppingDistance.toFixed(3)
              });
            } else {
              // A carrier with a committed open-space target should attack it
              // at sprint pace, then come back under control near the point.
              // Previously carrierTarget fell through to the formation cap of
              // 0.72, making sprint mathematically impossible with the ball.
              const carrierSprint = Boolean(carrierTarget && distance > 2.2);
              intensity = carrierTarget
                ? clamp(distance / 5, 0.58, 1)
                : clamp(distance / (runTarget ? 7 : 5), runTarget ? 0.74 : 0, 1);
              mode = runTarget || carrierSprint || (!carrierTarget && distance > 7) ? 'sprint' : intensity > 0.2 ? 'run' : 'walk';
              if (carrierIntent && carrierIntent.type === 'protect') { mode = 'shield'; intensity = .45; }
              if (carrierIntent && carrierIntent.type === 'take-on') {
                mode = carrierIntent.phase === 'feint' ? 'run' : 'sprint';
                intensity = carrierIntent.phase === 'feint' ? .26 : 1;
              }
              if(carrierIntent&&carrierIntent.reason==='wide-carrier-drive-for-byline'&&
                  (snapshot.teams.find(t=>t.id===livePlayer.teamId).attackingDirection>0?105-metric.x:metric.x)<10){
                // Come off the sprint before the line. The existing rated
                // locomotion/braking model and close touch still own motion.
                mode='run';intensity=Math.min(intensity,.7);
              }
              if (!runTarget && !carrierTarget && distance < .35) { intensity = 0; mode = 'idle'; }
            }
          }
        }
        if(!isHuman&&(snapshot.ball.ownerId===livePlayer.id||leaseOwnerId===livePlayer.id)&&vectorLength(desired)>.01){
          const q=metricPoint(livePlayer,snapshot),v=metricVelocity(livePlayer,snapshot),speed=vectorLength(v),
            touch=dependencies.dribbling.touchProfile({speed,control:livePlayer.attrs.control,agility:livePlayer.attrs.agility,sprint:mode==='sprint'}),
            roomX=desired.x>0?(105-q.x)/desired.x:desired.x<0?-q.x/desired.x:Infinity,
            roomY=desired.y>0?(34-q.y)/desired.y:desired.y<0?(-34-q.y)/desired.y:Infinity,
            velocityRoomX=v.x>0?(105-q.x)/v.x:v.x<0?-q.x/v.x:Infinity,
            velocityRoomY=v.y>0?(34-q.y)/v.y:v.y<0?(-34-q.y)/v.y:Infinity,
            // Read momentum as well as the new steering input. A turn inward
            // cannot erase the preceding outward touch or its stopping time.
            room=Math.min(roomX,roomY,(speed>.01?Math.min(velocityRoomX,velocityRoomY)*speed:Infinity)),race=movementRaceProfile(livePlayer,snapshot,true),reserve=touch.distance+.4,
            outward=speed,braking=outward*outward/(2*race.deceleration);
          if(room<reserve+braking+1){
            // Slow before the next existing touch, leaving its physical gap
            // inside the line. Neither the ball nor a launched touch is clamped.
            const safePace=Math.sqrt(2*race.deceleration*Math.max(0,room-reserve)),
              runCapacity=4.6+(6.25-4.6)*(clamp(livePlayer.attrs.pace,1,99)-1)/98;
            mode='shield';intensity=Math.min(intensity,clamp(safePace/runCapacity,0,1));
          }
        }
        const labMovementModes = typeof globalThis !== 'undefined' && globalThis.__dartyLabLocomotion;
        if (labMovementModes && !isHuman && mode === 'sprint') {
          const key = 'cpu-' + (cpuMovementRoute || 'unknown') + '-sprint';
          labMovementModes[key] = (labMovementModes[key] || 0) + 1;
        }
        if(raceJostles[livePlayer.id]&&mode==='sprint'){
          const opponent=world.players.find(p=>p.id===raceJostles[livePlayer.id]);
          commands.push({id:'race-shoulder:'+livePlayer.id+':'+nextTick,tick:nextTick,playerId:livePlayer.id,type:'shoulder-challenge',
            targetId:opponent.id,direction:unit({x:opponent.position.x-statePlayer.position.x,y:opponent.position.y-statePlayer.position.y},statePlayer.facing),
            move:desired,facing:desired,mode:'sprint',intensity:1,durationTicks:1,racePursuit:true,directionalSteering:true});continue;
        }
        commands.push(mode === 'idle' ? { id: 'stop:' + livePlayer.id + ':' + nextTick, tick: nextTick, playerId: livePlayer.id, type: 'stop' }
          : { id: 'move:' + livePlayer.id + ':' + nextTick, tick: nextTick, playerId: livePlayer.id, type: 'move', move: desired, facing: receivingFacing||desired, mode, intensity, durationTicks: 1,
            ...(isHuman ? { responsivenessMultiplier: HUMAN_INPUT_RESPONSIVENESS_MULTIPLIER }
              : directionalPursuit?{directionalSteering:true}:{}) });
      }
      return { commands, blockFlight:blocks.cache,blockAssignments:blocks.rows.concat(Object.values(maps.defensive).filter(i=>['cross-block','shot-block'].includes(i.type)&&!blocks.rows.some(r=>r.playerId===i.playerId))),aerialFlight: aerial.flight, recoveryAssignments: [...aerial.rows, ...recovery.rows, ...leaseRecoveryRows, ...receptionGuidanceRows]
        .sort((left, right) => left.teamId.localeCompare(right.teamId) || left.playerId.localeCompare(right.playerId)),
        stagedTackleState: new Set([...currentTackles, ...snapshot.players.filter(player => player.shoulderActive).map(player => 'shoulder:' + player.id)]) };
    }
    function intelligenceProjection(snapshot, decisions) {
      const projection = [], stagedCarrierEmission = { ...domain.lastCarrierEmission };
      for (const teamId of ['you', 'opp']) {
        const intent = decisions[teamId].carrierIntent, owner = snapshot.ball.ownerId && snapshot.players.find(player => player.id === snapshot.ball.ownerId);
        if (!intent || !owner || owner.teamId !== teamId || snapshot.humanPlayerIds.has(owner.id)) continue;
        const targetId = intent.targetPlayerId == null ? '' : String(intent.targetPlayerId);
        const committedRun = (decisions[teamId].runs || []).find(run => String(run.playerId) === targetId) || null;
        const key = owner.id + '|' + intent.type + '|' + targetId + '|' + Math.floor(snapshot.tick / 6);
        if (['shot', 'pass', 'cross', 'clearance'].includes(intent.type) && key === stagedCarrierEmission[teamId]) continue;
        if (['shot', 'pass', 'cross', 'clearance'].includes(intent.type)) stagedCarrierEmission[teamId] = key;
        const sourceTiming = intent.offsideTiming || committedRun && committedRun.offsideTiming || null;
        const offsideTiming = sourceTiming ? clone(sourceTiming) : null;
        if (offsideTiming) {
          offsideTiming.onsideGateX = snapshot.pitch.xMin + finite(sourceTiming.onsideGateX, 0) * snapshot.units.xPerMetre;
          offsideTiming.offsideLineX = snapshot.pitch.xMin + finite(sourceTiming.offsideLineX, 0) * snapshot.units.xPerMetre;
          if (sourceTiming.continuationTarget) offsideTiming.continuationTarget = livePoint(sourceTiming.continuationTarget, snapshot);
          offsideTiming.coordinateSystem = 'build-173-live-pitch';
        }
        projection.push({ teamId, playerId: owner.id, type: intent.type, targetPlayerId: targetId || null,
          target: intent.target ? livePoint(intent.target, snapshot) : null, confidence: finite(intent.confidence, 0), reason: String(intent.reason || 'cpu-v2'),
          dribbleId: [resetEpoch, owner.id, intent.type, intent.startedTick || 0].join(':'),
          maneuver: ['carry', 'take-on', 'protect'].includes(intent.type) ? clone(intent) : null,
          shotProfile: intent.shotProfile ? clone(intent.shotProfile) : null,
          skillIntent: intent.skillIntent ? { ...clone(intent.skillIntent), target: livePoint(intent.skillIntent.target, snapshot) } : null,
          supportKind: intent.supportKind == null ? null : String(intent.supportKind),
          supportMetrics: intent.supportMetrics ? clone(intent.supportMetrics) : null,
          risk: intent.risk ? clone(intent.risk) : null,
          crossKind: intent.crossKind || null, flightType: intent.flightType || null,
          clearanceProfile: intent.clearanceProfile ? clone(intent.clearanceProfile) : null,
          switchMetrics: intent.switchMetrics ? clone(intent.switchMetrics) : null,
          passRace: intent.passRace ? clone(intent.passRace) : null,
          rejectedPassRace: intent.rejectedPassRace ? clone(intent.rejectedPassRace) : null,
          fallbackFrom: intent.fallbackFrom == null ? null : String(intent.fallbackFrom),
          offsideTiming,
          continuationTarget: committedRun && committedRun.continuationTarget ? livePoint(committedRun.continuationTarget, snapshot)
            : intent.target ? livePoint(intent.target, snapshot) : null });
      }
      return { projection, stagedCarrierEmission };
    }
    function movementRaceProfile(player, snapshot, anticipated = false) {
      // Fallback candidates share one immutable roster. Normalize its rated
      // movement once; memoization does not alter any ETA or physical state.
      let profiles=raceProfileCache.get(snapshot.players);
      if(!profiles){profiles=new Map();raceProfileCache.set(snapshot.players,profiles);}
      const cacheKey=player.id+':'+anticipated;
      if(profiles.has(cacheKey))return profiles.get(cacheKey);
      const origin = metricPoint(player, snapshot);
      const attrs = player.attrs || {};
      const state = dependencies.movement.createPlayerState({
        id: player.id,
        teamId: player.teamId,
        role: player.position || player.role,
        position: origin,
        velocity: metricVelocity(player, snapshot),
        facing: unit({ x: player.fx, y: player.fy }, { x: player.teamId === 'you' ? 1 : -1, y: 0 }),
        radius: clamp(player.radius / Math.sqrt(snapshot.units.xPerMetre * snapshot.units.yPerMetre), 0.25, 0.7),
        staminaLevel: player.stamina,
        attributes: {
          pace: finite(attrs.pace, 70),
          acceleration: finite(attrs.accel, attrs.acceleration || attrs.pace || 70),
          agility: finite(attrs.agility, 70),
          balance: finite(attrs.balance, 70),
          stamina: finite(attrs.stamina, 75)
        }
      });
      const reactions = clamp(finite(attrs.reactions, attrs.awareness == null ? 70 : attrs.awareness), 1, 99);
      const baseReactionTicks = 3 + Math.round((99 - reactions) / 11);
      const reactionTicks = Math.max(0, baseReactionTicks - (anticipated ? 3 : 0));
      const config = dependencies.movement.DEFAULT_CONFIG;
      const profile = dependencies.movement.ROLE_PROFILES[state.roleFamily] || dependencies.movement.ROLE_PROFILES.midfielder;
      const attributeScale = (value, minimum, maximum) => minimum + (maximum - minimum) * clamp((value - 1) / 98, 0, 1);
      const fatigue = state.stamina >= config.lowStaminaThreshold ? 1 : config.minimumFatigueSpeedFactor +
        (1 - config.minimumFatigueSpeedFactor) * state.stamina / Math.max(1, config.lowStaminaThreshold);
      const maximumSpeed = attributeScale(state.attributes.pace, config.sprintSpeedMinimum,
        config.sprintSpeedMaximum) * profile.speed * fatigue;
      const acceleration = attributeScale(state.attributes.acceleration, config.accelerationMinimum,
        config.accelerationMaximum) * profile.acceleration * fatigue;
      const currentSpeed = vectorLength(state.velocity);
      const turnRate = attributeScale(state.attributes.agility, config.turnRateMinimum,
        config.turnRateMaximum) * profile.turn / (1 + currentSpeed * config.speedTurnInertia);
      const result = { id: player.id, origin, velocity: state.velocity, facing: state.facing,
        reach: state.radius + .42, reactions, reactionTicks, anticipated,
        maximumSpeed, acceleration, turnRate,
        restingTurnRate:turnRate*(1+currentSpeed*config.speedTurnInertia),
        deceleration:6.1+6.3*clamp(((state.attributes.agility+state.attributes.balance)/2-1)/98,0,1) };
      profiles.set(cacheKey,result);return result;
    }
    function movementRaceEtaTicks(profile, target) {
      const offset = { x: target.x - profile.origin.x, y: target.y - profile.origin.y };
      const distance = Math.max(0, vectorLength(offset) - profile.reach);
      if (distance <= 1e-9) return profile.reactionTicks;
      const direction = unit(offset, profile.facing);
      const maximumSpeed = profile.maximumSpeed, acceleration = profile.acceleration;
      const initialSpeed = clamp(profile.velocity.x * direction.x + profile.velocity.y * direction.y, 0, maximumSpeed);
      const facingDot = clamp(profile.facing.x * direction.x + profile.facing.y * direction.y, -1, 1);
      const turnSeconds = Math.acos(facingDot) / Math.max(0.01, profile.turnRate);
      const accelerationSeconds = Math.max(0, (maximumSpeed - initialSpeed) / Math.max(0.01, acceleration));
      const accelerationDistance = initialSpeed * accelerationSeconds + acceleration * accelerationSeconds * accelerationSeconds / 2;
      const travelSeconds = distance <= accelerationDistance
        ? (-initialSpeed + Math.sqrt(initialSpeed * initialSpeed + 2 * acceleration * distance)) / Math.max(0.01, acceleration)
        : accelerationSeconds + (distance - accelerationDistance) / Math.max(0.01, maximumSpeed);
      return profile.reactionTicks + Math.ceil((turnSeconds + travelSeconds) / FIXED_TICK_SECONDS - 1e-12);
    }
    function planCpuKnockOn(rawSnapshot,playerId,candidates) {
      const snapshot=normalizeSnapshot(rawSnapshot,capability.workflow),actor=snapshot.players.find(p=>p.id===playerId);
      if(!enabled||!actor||snapshot.humanPlayerIds.has(actor.id))return null;
      const players=snapshot.players.filter(p=>!p.sentOff),profiles=players.map(player=>({player,
        // The launch immediately becomes the shared neutral race. Its
        // opposing collector gets the same anticipation as the live chase.
        profile:movementRaceProfile(player,snapshot,true)}));
      const checks=[];
      for(const candidate of (candidates||[]).slice(0,3)){
        const p=candidate.plan;if(!p?.valid)continue;
        if(p.tier!==(candidate.tier==='baseline'?'baseline-free-roll':'sprint-forward-'+candidate.tier))continue;
        const origin=metricPoint({x:p.startX,y:p.startY},snapshot),direction=unit({x:p.nx/snapshot.units.xPerMetre,
          y:p.ny/snapshot.units.yPerMetre},{x:1,y:0});
        const minimumTravel=vectorLength({x:p.nx*p.reacquireMinimumDistance/snapshot.units.xPerMetre,
          y:p.ny*p.reacquireMinimumDistance/snapshot.units.yPerMetre});
        let state=dependencies.ball.resolveLaunch({id:'cpu-knock-choice',origin:{...origin,z:.11+1/snapshot.units.zPerMetre},
          direction,speed:p.touchPaceMps,liftAngleDeg:Math.atan2(.18*60/snapshot.units.zPerMetre,p.touchPaceMps)*180/Math.PI,
          topSpinRpm:p.topSpinRpm,source:'directional-knock-on',metadata:{groundDampingModel:p.groundDampingModel,
            groundDampingInitialPerSecond:p.groundDampingInitialPerSecond,groundDampingRampScale:p.groundDampingRampScale,
            groundDampingRampExponent:p.groundDampingRampExponent,groundDampingOriginX:origin.x,groundDampingOriginY:origin.y,
            groundDampingReferenceDistanceMetres:p.groundDampingReferenceDistanceMetres,
            groundDampingMaximumProgress:p.groundDampingMaximumProgress,groundSkidFrictionScale:p.groundSkidFrictionScale,
            groundLinearDampingUntilSeconds:p.groundLinearDampingUntilSeconds}}).state;
        let context=dependencies.ball.createSimulationContext({seed:stableHash('knock-choice:'+deterministicSeed+':'+snapshot.tick)}),
          own=null,opponent=null,boundaryTick=null;
        for(let start=0;start<360;start+=15){
          const step=dependencies.ball.step(state,context,15*FIXED_TICK_SECONDS,goalEnvironment());
          // At20m/s a six-tick sample can jump clean over a defender's boot.
          // Read each real60Hz MR position, as the live contact path does.
          for(let i=3;i<step.trace.samples.length;i+=4){
            const sample=step.trace.samples[i],tick=start+Math.ceil((i+1)/4),point=sample.position;
            if(point.x<0||point.x>105||point.y< -34||point.y>34){boundaryTick=tick;break;}
            if(point.z>1.05)continue;
            for(const {player,profile}of profiles){
              if(tick<Math.max(player.contactLockTicks||0,player.stunTicks||0))continue;
              if(player.id===actor.id&&(tick<p.kickerLockFrames||Math.hypot(point.x-origin.x,point.y-origin.y)<minimumTravel))continue;
              // This generous speed-only bound cannot remove a reachable
              // player: the full ETA also pays acceleration, turning and
              // reaction. Avoid expensive turn/arrival maths for far bodies.
              const dx=point.x-profile.origin.x,dy=point.y-profile.origin.y,
                possible=profile.reach+profile.maximumSpeed*tick*FIXED_TICK_SECONDS+1e-8;
              if(dx*dx+dy*dy>possible*possible)continue;
              if(movementRaceEtaTicks(profile,point)>tick)continue;
              const meeting={playerId:player.id,tick,point:{x:point.x,y:point.y}};
              if(player.teamId===actor.teamId){if(!own)own=meeting;}else if(!opponent)opponent=meeting;
            }
            if(opponent||own)break;
          }
          state=step.state;context=step.context;if(boundaryTick!=null||own||opponent)break;
        }
        const accepted=!!own&&(!opponent||own.tick<=opponent.tick)&&(!boundaryTick||own.tick<boundaryTick);
        const check={tier:candidate.tier,accepted,own,opponent,boundaryTick,
          reason:accepted?'team-reaches-free-roll-first':opponent?'opponent-reaches-free-roll-first':boundaryTick?'free-roll-leaves-pitch':'no-reachable-control'};
        checks.push(check);
        if(accepted)return {tier:candidate.tier,checks};
      }
      return {tier:null,checks};
    }
    function receptionReadyEtaTicks(profile,target,safetyCritical=false){
      // Safety-critical feet passes promise a prepared reception, not a
      // glancing touch at the edge of body reach after an overshoot. Live
      // guidance plants within this same 28 cm meeting radius.
      if(safetyCritical)profile={...profile,reach:.28};
      const dx=target.x-profile.origin.x,dy=target.y-profile.origin.y,d=Math.hypot(dx,dy),speed=vectorLength(profile.velocity);
      const direction=unit({x:dx,y:dy},profile.facing),closing=profile.velocity.x*direction.x+profile.velocity.y*direction.y;
      const stopDistance=speed*speed/(2*profile.deceleration);
      if(speed<.2 || closing>=-.35&&d>stopDistance+.35)return movementRaceEtaTicks(profile,target);
      // A fast receiver inside the contact radius is not already planted.
      // Honour the same brake, turn and return used by live reception guidance.
      const stopTime=speed/profile.deceleration,stopped={...profile,
        origin:{x:profile.origin.x+profile.velocity.x*stopTime*.5,y:profile.origin.y+profile.velocity.y*stopTime*.5},
        velocity:{x:0,y:0},turnRate:profile.restingTurnRate,reactionTicks:0};
      return profile.reactionTicks+Math.ceil(stopTime*60)+movementRaceEtaTicks(stopped,target);
    }
    const cpuPassLaunchCache=new WeakMap();
    function measuredLoftDrop(speed,angle,originHeight){
      let state=dependencies.ball.resolveLaunch({id:'cpu-loft-weight',origin:{x:0,y:0,z:originHeight},
        direction:{x:1,y:0},speed,liftAngleDeg:angle,source:'long-pass'}).state,
        context=dependencies.ball.createSimulationContext({seed:173});
      let previous={position:state.position,velocity:state.velocity},elapsed=0;
      for(let ticks=0;ticks<240;ticks+=15){
        const step=dependencies.ball.step(state,context,15*FIXED_TICK_SECONDS);
        for(const sample of step.trace.samples){
          elapsed+=dependencies.ball.DEFAULT_CONFIG.maxSubstep;
          if(sample.velocity.z<0&&sample.position.z<=.65){
            const f=clamp((previous.position.z-.65)/Math.max(1e-9,previous.position.z-sample.position.z),0,1);
            return {distance:previous.position.x+(sample.position.x-previous.position.x)*f,
              seconds:elapsed-dependencies.ball.DEFAULT_CONFIG.maxSubstep*(1-f),pace:Math.hypot(sample.velocity.x,sample.velocity.y)};
          }
          previous=sample;
        }
        state=step.state;context=step.context;
      }
      return null;
    }
    function weightedLoftLaunch(snapshot,owner,intent,initial,distance,originHeight){
      const receiver=snapshot.players.find(p=>p.id===intent.targetPlayerId),profile=receiver&&movementRaceProfile(receiver,snapshot,true),
        ready=profile?movementRaceEtaTicks(profile,intent.target)/60:0;
      const quality=clamp(finite(owner.attrs?.pass,70)/99,.01,1),
        executionError=(stableHash(['loft-weight',deterministicSeed,snapshot.tick,owner.id].join(':'))/0xffffffff-.5)*(1-quality)*1.5,
        landingDistance=distance-.25+executionError;
      let angle=initial.liftAngleDeg,speed=initial.speed,drop=null;
      for(let iteration=0;iteration<3;iteration++){
        drop=measuredLoftDrop(speed,angle,originHeight);if(!drop)break;
        const error=landingDistance-drop.distance;
        if(Math.abs(error)<.04)break;
        const probe=measuredLoftDrop(speed+.4,angle,originHeight);if(!probe)break;
        speed=clamp(speed+error/Math.max(.2,(probe.distance-drop.distance)/.4),10,36);
      }
      drop=measuredLoftDrop(speed,angle,originHeight);
      // A moving far-side receiver may need more hang time, not a harder
      // kick past him. Raise the existing loft, then solve its range again.
      if(drop&&ready>drop.seconds-.12&&angle<38){
        angle=clamp(angle+(ready-drop.seconds+.12)*14,angle,38);
        for(let iteration=0;iteration<3;iteration++){
          drop=measuredLoftDrop(speed,angle,originHeight);if(!drop)break;
          const probe=measuredLoftDrop(speed+.4,angle,originHeight);if(!probe)break;
          const error=landingDistance-drop.distance;if(Math.abs(error)<.04)break;
          speed=clamp(speed+error/Math.max(.2,(probe.distance-drop.distance)/.4),10,36);
        }
        drop=measuredLoftDrop(speed,angle,originHeight);
      }
      return {speed,liftAngleDeg:angle,weight:drop?{model:'mr-descending-stride',arrivalSeconds:drop.seconds,
        rangeMetres:drop.distance,targetDistanceMetres:distance,terminalPaceMetresPerSecond:drop.pace}:null};
    }
    function weightedGroundThrough(snapshot,owner,intent,initial,distance,originHeight){
      const receiver=snapshot.players.find(p=>p.id===intent.targetPlayerId);
      if(!receiver)return initial;
      const eta=Math.max(receiver.contactLockTicks,movementRaceEtaTicks(movementRaceProfile(receiver,snapshot,true),intent.target))/60,
        seconds=clamp(Math.max(eta+.10,distance/initial.speed*1.25),.35,2.8);
      const measure=speed=>{
        let state=dependencies.ball.resolveLaunch({id:'cpu-ground-through-weight',origin:{x:0,y:0,z:originHeight},
          direction:{x:1,y:0},speed,liftAngleDeg:0,source:'ground-pass'}).state,
          context=dependencies.ball.createSimulationContext({seed:173}),remaining=seconds;
        while(remaining>1e-9){const dt=Math.min(.25,remaining),step=dependencies.ball.step(state,context,dt);state=step.state;context=step.context;remaining-=dt;}
        return {distance:state.position.x,pace:Math.hypot(state.velocity.x,state.velocity.y)};
      };
      let speed=initial.speed,point=null;
      for(let i=0;i<2;i++){
        point=measure(speed);const error=distance-.20-point.distance;if(Math.abs(error)<.025)break;
        const probe=measure(speed+.5);speed=clamp(speed+error/Math.max(.1,(probe.distance-point.distance)/.5),8,34);
      }
      point=measure(speed);
      return {speed,liftAngleDeg:0,weight:{model:'mr-ground-running-meeting',arrivalSeconds:seconds,
        rangeMetres:point.distance,targetDistanceMetres:distance,terminalPaceMetresPerSecond:point.pace}};
    }
    function cpuPassLaunch(snapshot, owner, intent) {
      if (!intent.target) return null;
      let cache=cpuPassLaunchCache.get(snapshot);if(!cache){cache=new Map();cpuPassLaunchCache.set(snapshot,cache);}
      const key=JSON.stringify([owner.id,intent.type,intent.targetPlayerId,intent.target,intent.supportKind,intent.flightType,intent.crossKind,intent.throwProfile]);
      if(cache.has(key))return cache.get(key);
      const originLive = { x: snapshot.ball.x, y: snapshot.ball.y, z: Math.max(1, finite(snapshot.ball.z, 0)) };
      const targetLive = livePoint(intent.target, snapshot);
      const dx = targetLive.x - originLive.x, dy = targetLive.y - originLive.y;
      const liveDistance = Math.hypot(dx, dy);
      if (liveDistance <= 1e-9) return null;
      const metricDelta = { x: dx / snapshot.units.xPerMetre, y: dy / snapshot.units.yPerMetre };
      const metricDistance = Math.hypot(metricDelta.x, metricDelta.y);
      const metricDirection = unit(metricDelta, { x: 1, y: 0 });
      const shortSupport = ['support', 'recycle'].includes(String(intent.supportKind || ''));
      const loftedBehind=intent.supportKind==='in-behind' && intent.flightType==='long-pass';
      const groundBehind=intent.supportKind==='in-behind' && intent.flightType==='ground-pass';
      const long = !shortSupport && (metricDistance > 20 || loftedBehind);
      // Pace is authored once in real metres per second. The prior host-world
      // formula varied with pitch-axis scaling and could turn a tiny pass into
      // a 14-15 m/s release. The committed host consumes this exact race pace.
      const cross = intent.type === 'cross';
      const switchPass = genuineSwitch(snapshot, owner, intent);
      const deliveryQuality = clamp(finite(owner.attrs && owner.attrs.pass, 70) / 99, .01, 1);
      const deliveryError = (stableHash(['delivery', deterministicSeed, snapshot.tick, owner.id].join(':')) / 0xffffffff - .5) *
        (1 - deliveryQuality);
      let longLaunch = intent.throwProfile ? intent.throwProfile : cross
        ? intent.crossKind === 'cut-back' ? null : { speed: clamp((metricDistance + 17.6) / 2.1 + deliveryError * 2, 15, 31),
          liftAngleDeg: 28 + deliveryError * 5 }
        : groundBehind ? {speed:clamp(11+metricDistance*.45,14,27),liftAngleDeg:0}
        : long || switchPass ? cpuLongPassLaunch(metricDistance, switchPass || loftedBehind) : null;
      if (switchPass && longLaunch) longLaunch.liftAngleDeg += deliveryError * 3;
      const safety=cpuPassSafetyContext(snapshot,owner,intent);
      const speedMetresPerSecond = longLaunch ? longLaunch.speed : cross && intent.crossKind==='cut-back'
        ? clamp(14+metricDistance*.35,16,23) : safety.ownThird || intent.firmExit
        ? clamp(11 + metricDistance * .45, 14, 23) : cpuPassPaceMetresPerSecond(metricDistance, shortSupport, long);
      const liftAngleDeg = longLaunch ? longLaunch.liftAngleDeg : 0;
      const originMetric = {
        x: (originLive.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
        y: (originLive.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre,
        z: originLive.z / snapshot.units.zPerMetre + .11
      };
      if(longLaunch?.liftAngleDeg>0&&!intent.throwProfile&&!cross)
        longLaunch=weightedLoftLaunch(snapshot,owner,intent,longLaunch,metricDistance,originMetric.z);
      else if(groundBehind)longLaunch=weightedGroundThrough(snapshot,owner,intent,longLaunch,metricDistance,originMetric.z);
      const resolved=dependencies.ball.resolveLaunch({
        id: ['cpu-pass-race', resetEpoch, snapshot.tick, owner.id, intent.targetPlayerId || 'none'].join(':'),
        origin: originMetric,
        direction: metricDirection,
        speed: longLaunch?longLaunch.speed:speedMetresPerSecond,
        liftAngleDeg: longLaunch?longLaunch.liftAngleDeg:liftAngleDeg,
        sideSpinRpm: 0,
        topSpinRpm: 0,
        source: intent.throwProfile ? 'throw-in' : cross ? intent.flightType || 'cross' : longLaunch && longLaunch.liftAngleDeg > 0 ? 'long-pass' : 'ground-pass',
        metadata: { adapterVersion: VERSION, targetPlayerId: intent.targetPlayerId || null,
          passWeight:longLaunch?.weight||null }
      });
      cache.set(key,resolved);return resolved;
    }
    function runnerRendezvousIntent(snapshot,owner,intent){
      if(!intent||!['pass','cross'].includes(intent.type)||intent.throwProfile||
          !(intent.type==='cross'&&intent.crossKind==='cut-back'||intent.supportKind==='in-behind'||intent.supportKind==='switch'||
            /^(third-man-layoff|give-and-go-return|release-coordinated-run|release-newly-opened-run)$/.test(intent.reason)))return intent;
      if(cpuPassSafetyContext(snapshot,owner,intent).critical)return intent;
      // A penetrating run includes acceleration after release. Shortening it
      // to current velocity pulls the target back in front of the defenders.
      // Preserve that space and weight the flight to the real rated arrival.
      if(intent.supportKind==='in-behind')return intent;
      const player=snapshot.players.find(p=>p.id===intent.targetPlayerId);if(!player)return intent;
      const origin=metricPoint(player,snapshot),velocity={x:player.vx*60/snapshot.units.xPerMetre,y:player.vy*60/snapshot.units.yPerMetre},
        speed=Math.hypot(velocity.x,velocity.y);
      if(speed<1)return intent;
      // Keep the authored run's direction. A turning/showing support receiver
      // is still a feet pass, not a licence to lead him into an unrelated lane.
      const toward={x:intent.target.x-origin.x,y:intent.target.y-origin.y};
      if(toward.x*velocity.x+toward.y*velocity.y<=0)return intent;
      let candidate=intent;
      for(let iteration=0;iteration<2;iteration++){
        const launch=cpuPassLaunch(snapshot,owner,candidate);if(!launch)break;
        let seconds=launch.intent.metadata?.passWeight?.arrivalSeconds;
        if(seconds==null){
          const direction=unit({x:candidate.target.x-launch.state.position.x,y:candidate.target.y-launch.state.position.y}),
            distance=Math.hypot(candidate.target.x-launch.state.position.x,candidate.target.y-launch.state.position.y);
          let state=launch.state,context=dependencies.ball.createSimulationContext({seed:173});
          for(let ticks=0;ticks<180;ticks+=15){
            const step=dependencies.ball.step(state,context,15*FIXED_TICK_SECONDS);
            const hit=step.trace.samples.findIndex(p=>(p.position.x-launch.state.position.x)*direction.x+
              (p.position.y-launch.state.position.y)*direction.y>=distance-.25&&p.position.z<=1.05);
            if(hit>=0){seconds=ticks/60+(hit+1)*dependencies.ball.DEFAULT_CONFIG.maxSubstep;break;}
            state=step.state;context=step.context;if(state.settled)break;
          }
        }
        if(seconds==null)break;
        const target=boundarySafeCpuPassIntent({...intent,target:{x:origin.x+velocity.x*seconds,y:origin.y+velocity.y*seconds}}).target;
        candidate={...intent,target,runnerMeeting:{model:'mr-flight-current-running-stride',seconds,
          receiverSpeedMetresPerSecond:speed,originalTarget:clone(intent.target)}};
      }
      return candidate;
    }
    function cpuPassSafetyContext(snapshot,owner,intent){
      const team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection;
      const origin=metricPoint(owner,snapshot),progress=intent.target?dir*(intent.target.x-origin.x):0;
      const ownThird=dir>0?origin.x<35:origin.x>70;
      // A long, forward escape ends beyond the own third. Its endpoint may
      // be contested; the own-third back/square receiver must still be free.
      const escapingRun=intent.supportKind==='in-behind'&&progress>=18&&
        Math.hypot(intent.target.x-origin.x,intent.target.y-origin.y)>=25&&
        (dir>0?intent.target.x>35:intent.target.x<70);
      return {ownThird,backward:progress < -1,square:Math.abs(progress)<=1,escapingRun,
        critical:ownThird&&!escapingRun && intent.type!=='cross' && (intent.supportKind!=='throw-in' || progress <= 1)};
    }
    function genuineSwitch(snapshot, owner, intent) {
      if (!intent || intent.type !== 'pass' || intent.supportKind !== 'switch' || !intent.target) return false;
      const origin = metricPoint(owner, snapshot), target = intent.target;
      const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
      const side = origin.y <= 0 ? -1 : 1;
      const congestion = snapshot.players.filter(p => p.teamId !== owner.teamId && !p.isGK && !p.sentOff)
        .filter(p => { const q = metricPoint(p, snapshot); return Math.hypot(q.x - origin.x, q.y - origin.y) < 12 && q.y * side > -3; }).length;
      return distance >= 25 && distance <= 45 && Math.abs(target.y - origin.y) >= 25 && target.y * side < 0 && congestion >= 2;
    }
    function cpuTargetBoundaryMargin(intent){
      return intent&&(intent.type==='cross'||intent.type==='carry'&&intent.reason==='wide-carrier-drive-for-byline')
        ?CPU_BYLINE_TARGET_BOUNDARY_MARGIN_METRES:CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES;
    }
    function boundarySafeCpuPassIntent(intent) {
      if (!intent || !intent.target) return clone(intent);
      const original = point(intent.target, { x: METRIC_PITCH.xMin, y: 0 });
      const margin=cpuTargetBoundaryMargin(intent);
      const target = {
        x: clamp(original.x, METRIC_PITCH.xMin + margin,METRIC_PITCH.xMax - margin),
        y: clamp(original.y, METRIC_PITCH.yMin + margin,METRIC_PITCH.yMax - margin)
      };
      const retargetDistanceMetres = Math.hypot(target.x - original.x, target.y - original.y);
      return { ...clone(intent), target, boundaryRetarget: retargetDistanceMetres > 1e-9 ? {
        original, target: clone(target), distanceMetres: Math.round(retargetDistanceMetres * 1000) / 1000,
        marginMetres: margin
      } : null };
    }
    function futureCpuReceiver(player){
      // A passer's kick lock or an earlier reception lock may expire while a
      // real ball travels. It forbids contact now, not the next linked pass.
      return player && !player.isGK && !player.sentOff &&
        (player.contactEligible || player.contactLockTicks > 0);
    }
    function evaluateCpuPassRace(snapshot, owner, intent) {
      const receiverId = intent.targetPlayerId == null ? '' : String(intent.targetPlayerId);
      const receiver = snapshot.players.find(player => player.id === receiverId) || null;
      const ownerPosition = metricPoint(owner, snapshot);
      const intendedTarget = point(intent.target, ownerPosition);
      const intendedDistanceMetres = Math.hypot(intendedTarget.x - ownerPosition.x,
        intendedTarget.y - ownerPosition.y);
      const switchPass = genuineSwitch(snapshot, owner, intent);
      // A lofted switch buys the far-side receiver time to turn. Require him
      // ready at arrival and still ahead of interceptors; the ordinary eight
      // tick planting buffer would reject that moving far-side reception.
      const team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection;
      const movingBehind=intent.supportKind==='in-behind' && receiver && dir*receiver.vx*60>snapshot.units.xPerMetre &&
        dir*(intent.target.x-metricPoint(receiver,snapshot).x)>1 && dir*receiver.fx>.25 &&
        (dir*(receiver.x-team.offsideLine)<=0 || dir*(receiver.x-(snapshot.pitch.xMin+snapshot.pitch.xMax)/2)<=0);
      const safety=cpuPassSafetyContext(snapshot,owner,intent);
      // Short circulation needs a real first contact, not the same long
      // settling interval as an own-third recycle under an opposing press.
      const runningCutBack=intent.type==='cross'&&intent.crossKind==='cut-back'&&receiver&&dir*receiver.vx*60/snapshot.units.xPerMetre>1;
      const readyBuffer = switchPass || movingBehind || runningCutBack ? 0 : safety.critical
        ? CPU_PASS_RECEIVER_READY_BUFFER_TICKS : intendedDistanceMetres <= 12 ? 2 : intendedDistanceMetres <= 25 ? 4 : 8;
      const raceMargin = safety.critical ? 20 : intendedDistanceMetres <= 12 ? 2 : intendedDistanceMetres <= 25 ? 4 : CPU_PASS_RACE_MIN_MARGIN_TICKS;
      const contactHeight = intent.type === 'cross' ? 2.65 : CPU_PASS_RACE_MAX_CONTACT_HEIGHT_METRES;
      const base = {
        schema: 'football-legacy-cpu-pass-receiver-race-v2',
        evaluatedTick: snapshot.tick,
        passerId: owner.id,
        receiverId: receiverId || null,
        distanceMetres: Math.round(intendedDistanceMetres * 1000) / 1000,
        requiredMarginTicks: raceMargin,
        requiredReceiverReadyBufferTicks: readyBuffer,
        genuineSwitch: switchPass, movingInBehind: Boolean(movingBehind), maximumContactHeightMetres: contactHeight,
        receiverMeeting:intent.type!=='cross'||intent.crossKind==='cut-back'?'feet':'aerial',
        maximumProjectionTicks: CPU_PASS_RACE_MAX_TICKS,
        boundaryRetarget: clone(intent.boundaryRetarget || null)
      };
      Object.assign(base,{safetyCritical:safety.critical,ownThird:safety.ownThird});
      if (!receiver || receiver.teamId !== owner.teamId || !futureCpuReceiver(receiver)) {
        return { ...base, accepted: false, reason: 'receiver-ineligible', ballArrivalTick: null,
          receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      }
      // Below this separation, retaining controlled carry is both safer and
      // more football-like than striking a full MR pass into overlapping body
      // geometry. Ordinary close support remains available once the players
      // create a readable passing lane.
      if (intendedDistanceMetres < (intent.throwProfile ? 3 : safety.critical
        ? CPU_PASS_MIN_DISTANCE_METRES : CPU_SHORT_LINK_MIN_DISTANCE_METRES)) {
        return { ...base, accepted: false, reason: 'pass-distance-below-control-threshold', ballArrivalTick: null,
          receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      }
      const launch = cpuPassLaunch(snapshot, owner, intent);
      if (!launch) return { ...base, accepted: false, reason: 'trajectory-unavailable', ballArrivalTick: null,
        receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      const weight=launch.intent.metadata?.passWeight;
      Object.assign(base,{weightedFlightSeconds:weight?.arrivalSeconds??null,
        weightedLandingRangeMetres:weight?.rangeMetres??null,runnerMeetingSeconds:intent.runnerMeeting?.seconds??
          (intent.supportKind==='in-behind'?weight?.arrivalSeconds??null:null)});
      const target = point(intent.target, launch.state.position);
      const targetDistance = Math.hypot(target.x - launch.state.position.x, target.y - launch.state.position.y);
      const targetWindowMetres = clamp(1.35 + targetDistance * .025, 1.5, 3.25);
      // A temporary host contact lock can expire during the flight. Treat every
      // eligible outfield opponent as a future interceptor instead of erasing a
      // runner merely because they cannot touch the ball on this release tick.
      const opponents = snapshot.players.filter(player => player.teamId !== owner.teamId && !player.isGK && !player.sentOff)
        .sort((a, b) => a.id.localeCompare(b.id));
      const receiverRaceProfile = movementRaceProfile(receiver, snapshot, true);
      const receiverTargetEtaTicks = Math.max(receiver.contactLockTicks, movingBehind||switchPass||intent.type==='cross'
        ? movementRaceEtaTicks(receiverRaceProfile,target) : receptionReadyEtaTicks(receiverRaceProfile,target,safety.critical));
      // The live interception job uses urgent sprint from the current motion.
      // Forecast that same pursuit, rather than adding a second movement
      // reaction delay which makes a closing defender look late to the lane.
      const opponentRaceProfiles = opponents.map(player => movementRaceProfile(player, snapshot, true));
      const receiverSpaceMetres=Math.min(...opponentRaceProfiles.map(p=>Math.hypot(p.origin.x-target.x,p.origin.y-target.y)),Infinity);
      const pressureArrivalTick=Math.min(...opponentRaceProfiles.map(p=>movementRaceEtaTicks(p,target)),Infinity);
      const opponentHeaderHeights = Object.fromEntries(opponents.map(player => [player.id,
        (player.heightM || 1.8) + .18 + (finite(player.attrs?.jumping, 70) - 1) / 98 * .34]));
      if (receiverTargetEtaTicks > CPU_PASS_RACE_MAX_TICKS) return {
        ...base,
        accepted: false,
        reason: 'receiver-cannot-arrive',
        ballArrivalTick: null,
        receiverEtaAtArrivalTick: receiverTargetEtaTicks,
        receiverContactTick: null,
        opponentContactTick: null,
        opponentId: null,
        marginTicks: null,
        projectedFlightTicks: 0,
        targetWindowMetres: Math.round(targetWindowMetres * 1000) / 1000,
        launchSpeedMetresPerSecond: Math.round(launch.intent.speed * 1000) / 1000,
        launchLiftAngleDeg: Math.round(launch.intent.liftAngleDeg * 1000) / 1000,
        trajectorySignature: null
      };
      let state = launch.state;
      let context = dependencies.ball.createSimulationContext({
        seed: stableHash(['cpu-pass-race', deterministicSeed, resetEpoch, snapshot.tick, owner.id, receiver.id].join('|'))
      });
      let ballArrivalTick = null, receiverContactTick = null, opponentContactTick = null, opponentId = null,
        opponentTargetGapMetres=null;
      let opponentContactHeightMetres = null;
      let receiverEtaAtArrivalTick = null, projectedFlightTicks = 0;
      let closestApproach = null;
      const environment = goalEnvironment();
      // Ball V2 is pinned to four 1/240 substeps per 1/60 gameplay tick. Twelve
      // ticks stay below its 0.25-second call bound while retaining exact tick
      // samples from the real MR trajectory.
      const projectionChunkTicks = 15;
      const samplesPerTick = Math.max(1, Math.round(FIXED_TICK_SECONDS / dependencies.ball.DEFAULT_CONFIG.maxSubstep));
      while (projectedFlightTicks < CPU_PASS_RACE_MAX_TICKS) {
        const remainingProofTicks=receiverContactTick==null?projectionChunkTicks:
          Math.max(1,receiverContactTick+raceMargin-projectedFlightTicks);
        const requestedTicks = Math.min(projectionChunkTicks, remainingProofTicks, CPU_PASS_RACE_MAX_TICKS - projectedFlightTicks);
        const stepped = dependencies.ball.step(state, context, requestedTicks * FIXED_TICK_SECONDS, environment);
        const samples = stepped.trace.samples;
        const availableTicks = Math.min(requestedTicks, Math.ceil(samples.length / samplesPerTick));
        let completedTicks = 0;
        for (let localTick = 1; localTick <= availableTicks; localTick += 1) {
          const tick = projectedFlightTicks + localTick;
          const physicsSample = samples[Math.min(localTick * samplesPerTick, samples.length) - 1];
          completedTicks = localTick;
          {
            const gap = Math.hypot(physicsSample.position.x - target.x, physicsSample.position.y - target.y);
            if (!closestApproach || gap < closestApproach.gap) closestApproach = { gap, z: physicsSample.position.z, tick };
          }
          if (physicsSample.position.z <= contactHeight) {
            const sample = { x: physicsSample.position.x, y: physicsSample.position.y };
            const targetDistanceNow = Math.hypot(sample.x - target.x, sample.y - target.y);
            if (ballArrivalTick == null && targetDistanceNow <= targetWindowMetres) ballArrivalTick = tick;
            // Live Movement sends the receiver to the authored rendezvous, not
            // to an arbitrary earlier point inside this broad arrival window.
            // Pre-release acceptance must evaluate that exact same promise.
            // Entering a broad rendezvous window is not a boot contact. A
            // planted short receiver cannot own a ball still 1.5–2 m away.
            // That optimistic shortcut let a pressing forward cut out an
            // apparently safe backward pass before it reached the defender.
            const footMeeting=intent.type!=='cross'||intent.crossKind==='cut-back';
            const receiveRadius=footMeeting?receiverRaceProfile.reach:targetWindowMetres;
            const receiverEta = targetDistanceNow <= receiveRadius ? receiverTargetEtaTicks : null;
            if (receiverEta != null && receiverEta <= tick) {
              if (receiverEtaAtArrivalTick == null) receiverEtaAtArrivalTick = receiverEta;
              if (receiverContactTick == null) receiverContactTick = tick;
            }
            if (opponentContactTick == null) {
              for (const opponent of opponentRaceProfiles) {
                if (movementRaceEtaTicks(opponent, sample) <= tick) {
                  opponentContactTick = tick;
                  opponentTargetGapMetres=targetDistanceNow;
                  opponentId = opponent.id;
                  opponentContactHeightMetres = physicsSample.position.z;
                  break;
                }
              }
            }
          }
          // A standing/headed interception can happen before foot-height arrival.
          // Use the same rated reach and Movement ETA as the live high-ball chase.
          if (opponentContactTick == null && physicsSample.position.z > contactHeight && physicsSample.position.z <= 2.65) {
            for (const opponent of opponentRaceProfiles) {
              if (physicsSample.position.z <= opponentHeaderHeights[opponent.id] &&
                  movementRaceEtaTicks(opponent, physicsSample.position) <= tick) {
                opponentContactTick = tick; opponentId = opponent.id; opponentContactHeightMetres = physicsSample.position.z;
                opponentTargetGapMetres=Math.hypot(physicsSample.position.x-target.x,physicsSample.position.y-target.y);break;
              }
            }
          }
        }
        state = stepped.state;
        context = stepped.context;
        projectedFlightTicks += completedTicks;
        if (completedTicks === 0 || state.settled ||
            (receiverContactTick != null && projectedFlightTicks >= receiverContactTick + raceMargin)) break;
      }
      const marginTicks = receiverContactTick == null || opponentContactTick == null
        ? null : opponentContactTick - receiverContactTick;
      const labMisses = typeof globalThis !== 'undefined' && globalThis.__dartyLabMisses;
      if (labMisses && ballArrivalTick == null && labMisses.length < 400) {
        const finalGapAlong = ((state.position.x - launch.state.position.x) * (target.x - launch.state.position.x) +
          (state.position.y - launch.state.position.y) * (target.y - launch.state.position.y)) / Math.max(1e-6, targetDistance);
        labMisses.push({ d: +targetDistance.toFixed(1), v: +launch.intent.speed.toFixed(1), lift: +launch.intent.liftAngleDeg.toFixed(1),
          window: +targetWindowMetres.toFixed(2), gap: closestApproach && +closestApproach.gap.toFixed(2), z: closestApproach && +closestApproach.z.toFixed(2),
          travelled: +finalGapAlong.toFixed(1), settled: !!state.settled, ticks: projectedFlightTicks, reason: String(intent.reason || '') });
      }
      // An endpoint race is the point of a through ball. It is different
      // from an opponent cutting the lane before the intended meeting. The
      // same MR margin check admits a close finish, never an early intercept.
      const endpointRace=movingBehind&&!safety.critical&&opponentTargetGapMetres!=null&&
        opponentTargetGapMetres<=3&&receiverContactTick!=null&&opponentContactTick>=receiverContactTick-6;
      const requiredMargin=endpointRace?-6:raceMargin;
      let reason = 'receiver-arrives-before-interceptor';
      if (receiverContactTick == null) reason = ballArrivalTick == null ? 'trajectory-misses-target-window' : 'receiver-cannot-arrive';
      else if (ballArrivalTick == null || (movingBehind ? receiverTargetEtaTicks > receiverContactTick : receiverTargetEtaTicks > ballArrivalTick - readyBuffer)) {
        reason = 'receiver-not-ready-at-arrival';
      }
      else if (opponentContactTick != null && opponentContactTick < receiverContactTick + requiredMargin) {
        reason = 'insufficient-interception-margin';
      }
      else if(safety.critical && (receiverSpaceMetres<5 || pressureArrivalTick<receiverContactTick+42 ||
        intent.risk && (intent.risk.pressure>.18 || intent.risk.probability>.36))){
        reason='receiver-not-free-for-safe-recycle';
      }
      // A lofted final-third service deliberately creates a physical aerial
      // duel. It needs a reachable attacker and an arrival contest, not a
      // guaranteed six-tick attacking win. An early low block still rejects it.
      const contestedService=intent.type==='cross'&&intent.crossKind!=='cut-back'&&!safety.critical&&
        receiverContactTick!=null&&opponentContactTick!=null&&opponentContactHeightMetres>=1.05&&
        opponentContactTick>=receiverContactTick-12&&ballArrivalTick!=null;
      if(reason==='insufficient-interception-margin'&&contestedService)reason='reachable-contested-box-service';
      return {
        ...base,
        accepted: ['receiver-arrives-before-interceptor','reachable-contested-box-service'].includes(reason),
        contestedService,endpointRace,opponentTargetGapMetres,requiredMarginTicks:requiredMargin,
        reason,
        ballArrivalTick,
        receiverEtaAtArrivalTick,
        receiverReadyBufferTicks: ballArrivalTick == null ? null : ballArrivalTick - receiverTargetEtaTicks,
        receiverContactTick,
        opponentContactTick,
        opponentContactHeightMetres,
        opponentId,
        receiverSpaceMetres:Number.isFinite(receiverSpaceMetres)?Math.round(receiverSpaceMetres*1000)/1000:null,
        receiverPressureArrivalTick:Number.isFinite(pressureArrivalTick)?pressureArrivalTick:null,
        marginTicks,
        projectedFlightTicks,
        targetWindowMetres: Math.round(targetWindowMetres * 1000) / 1000,
        launchSpeedMetresPerSecond: Math.round(launch.intent.speed * 1000) / 1000,
        launchLiftAngleDeg: Math.round(launch.intent.liftAngleDeg * 1000) / 1000,
        trajectorySignature: dependencies.ball.stateSignature(state)
      };
    }
    function clearanceDanger(snapshot,owner){
      const team=snapshot.teams.find(t=>t.id===owner.teamId),origin=metricPoint(owner,snapshot),dir=team.attackingDirection,
        depth=dir>0?origin.x:105-origin.x;
      if(depth>22||Math.abs(origin.y)>24)return null;
      const threats=snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.sentOff&&!p.isGK).map(p=>{
        const q=metricPoint(p,snapshot),dx=origin.x-q.x,dy=origin.y-q.y,distance=Math.hypot(dx,dy),
          closing=((p.vx-owner.vx)*60/snapshot.units.xPerMetre*dx+(p.vy-owner.vy)*60/snapshot.units.yPerMetre*dy)/Math.max(.1,distance);
        return {distance,closing};}).sort((a,b)=>a.distance-b.distance),nearest=threats[0];
      if(!nearest)return null;
      if(depth<16.5&&threats.filter(p=>p.distance<5).length>=2&&nearest.distance<2.2)return 'box-scramble';
      if(depth<16.5&&/cross|corner|deflection/.test(snapshot.ball.flightType)&&nearest.distance<3)return 'box-second-ball';
      if(nearest.distance<1.15||nearest.distance<1.85&&nearest.closing>1)return 'box-closing-danger';
      return null;
    }
    function clearanceIntent(snapshot,owner,trigger='keeper-long-distribution'){
      const team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection,origin=metricPoint(owner,snapshot),
        quality=clamp(finite(owner.attrs?.pass,70)/99,.01,1),
        zones=snapshot.players.filter(p=>p.teamId===owner.teamId&&p.id!==owner.id&&!p.isGK&&!p.sentOff)
          .map(player=>{const q=metricPoint(player,snapshot),v=metricVelocity(player,snapshot),progress=dir*(q.x-origin.x),
            target={x:clamp(q.x+v.x*.45,10,95),y:clamp(q.y+v.y*.45,-24,24)},
            opponents=snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.sentOff).map(p=>metricPoint(p,snapshot)),
            pressure=Math.min(...opponents.map(p=>Math.hypot(p.x-target.x,p.y-target.y)),10);
            return {player,target,progress,score:Math.min(progress,40)*.3+pressure*.4+(player.position==='ST'?5:0)-Math.abs(target.y)*.08};})
          .filter(p=>p.progress>15&&p.progress<55).sort((a,b)=>b.score-a.score),
        selected=zones[0],target=selected?.target||{x:clamp(origin.x+dir*(30+quality*8),10,95),y:clamp(origin.y*.35,-16,16)},
        distance=Math.hypot(target.x-origin.x,target.y-origin.y),launch=cpuLongPassLaunch(distance,true);
      return {type:'clearance',targetPlayerId:selected?.player.id||null,target,confidence:.95,reason:'own-box-no-safe-exit-clear',
        clearanceProfile:{speedMetresPerSecond:launch.speed,liftAngleDeg:launch.liftAngleDeg,trigger}};
    }
    function firmExitIntent(snapshot,owner){
      const team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection,origin=metricPoint(owner,snapshot);
      const candidates=snapshot.players.filter(p=>p.teamId===owner.teamId&&p.id!==owner.id&&futureCpuReceiver(p))
        .map(player=>{const target=metricPoint(player,snapshot),distance=Math.hypot(target.x-origin.x,target.y-origin.y),progress=dir*(target.x-origin.x);
          const space=Math.min(...snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.sentOff&&!p.isGK)
            .map(p=>{const q=metricPoint(p,snapshot);return Math.hypot(q.x-target.x,q.y-target.y);}),100);
          return {player,target,distance,progress,space,score:progress*.4+Math.min(space,12)*2-distance*.1};})
        .filter(o=>o.distance>=18&&o.distance<=45&&o.progress>=8&&o.space>=4 &&
          (dir*(o.player.x-team.offsideLine)<=0||dir*(o.target.x-52.5)<=0))
        .sort((a,b)=>b.score-a.score||a.player.id.localeCompare(b.player.id));
      for(const candidate of candidates.slice(0,3)){
        const intent=boundarySafeCpuPassIntent({type:'pass',targetPlayerId:candidate.player.id,target:candidate.target,
          supportKind:'firm-exit',firmExit:true,confidence:.8,reason:'own-third-firm-free-outlet'});
        const race=evaluateCpuPassRace(snapshot,owner,intent);
        if(race.accepted)return {...intent,passRace:race};
      }
      return null;
    }
    function planCpuDive(input){return enabled?dependencies.cpu.planCpuDive(input):null;}
    function planOpenPlayChip(input){
      if(!enabled)return null;
      // The preserved penalty executor submits its calibrated pace as the
      // existing launch speed. Read that executed vertical component from MR,
      // then retain it while weighting the open-play landing range.
      const reference=dependencies.ball.resolveLaunch({id:'open-chip-penalty-profile',origin:{x:0,y:0,z:input.heightMetres},
        direction:{x:1,y:0},speed:input.penaltyReferencePaceMetresPerSecond,
        liftAngleDeg:Math.atan2(input.verticalMetresPerSecond,input.penaltyReferencePaceMetresPerSecond)*180/Math.PI,source:'shot'}).state;
      const weighted=dependencies.cpu.weightChipLanding({...input,verticalMetresPerSecond:reference.velocity.z,
        rangeMetres:Math.max(2,dependencies.cpu.openPlayChipRange(input.power)+finite(input.aimErrorMetres,0))},dependencies.ball);
      return {...weighted,speedMetresPerSecond:Math.hypot(weighted.horizontalSpeedMetresPerSecond,weighted.verticalMetresPerSecond),
        liftAngleDeg:Math.atan2(weighted.verticalMetresPerSecond,weighted.horizontalSpeedMetresPerSecond)*180/Math.PI};
    }
    function planKeeperExit(rawSnapshot,keeperId){
      const snapshot=normalizeSnapshot(rawSnapshot,capability.workflow),owner=snapshot.players.find(p=>p.id===keeperId&&p.isGK&&!p.sentOff);
      if(!enabled||!owner||snapshot.humanPlayerIds.has(owner.id))return null;
      const origin=metricPoint(owner,snapshot),team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection;
      const short=snapshot.players.filter(p=>p.teamId===owner.teamId&&futureCpuReceiver(p))
        .map(player=>{const target=metricPoint(player,snapshot),distance=Math.hypot(target.x-origin.x,target.y-origin.y);
          return {player,target,distance};}).filter(o=>o.distance>=6&&o.distance<=25&&dir*(o.target.x-origin.x)>=-1)
        .sort((a,b)=>a.distance-b.distance||a.player.id.localeCompare(b.player.id));
      let intent=null;
      for(const row of short.slice(0,4)){
        const candidate=boundarySafeCpuPassIntent({type:'pass',targetPlayerId:row.player.id,target:row.target,
          supportKind:'support',firmExit:true,confidence:.85,reason:'keeper-free-short-exit'});
        const race=evaluateCpuPassRace(snapshot,owner,candidate);
        if(race.accepted){intent={...candidate,passRace:race};break;}
      }
      intent=intent||firmExitIntent(snapshot,owner)||clearanceIntent(snapshot,owner);
      return {...intent,keeperExit:true,teamId:owner.teamId,playerId:owner.id,target:livePoint(intent.target,snapshot)};
    }
    function planRestartThrowSupport(rawSnapshot,takerId){
      const snapshot=normalizeSnapshot(rawSnapshot,capability.workflow),owner=snapshot.players.find(p=>p.id===takerId);
      if(!enabled||!owner||snapshot.humanPlayerIds.has(owner.id))return null;
      const origin=metricPoint(owner,snapshot),dir=snapshot.teams.find(t=>t.id===owner.teamId).attackingDirection,
        inward=origin.y<0?1:-1,remaining=snapshot.players.filter(p=>p.teamId===owner.teamId&&p.id!==owner.id&&!p.isGK&&!p.sentOff),rows=[];
      // Three distances and two directions give the thrower a feet option,
      // a runner up the line and a free defender behind the press.
      const routes=[{dx:dir*3,dy:5,role:'throw-short-feet'},{dx:dir*10,dy:6,role:'throw-line-run'},
        {dx:-dir*6,dy:9,role:'throw-back-support'},{dx:dir*2,dy:14,role:'throw-inside-link'}];
      for(const route of routes){
        const target={x:clamp(origin.x+route.dx,4.5,100.5),y:clamp(origin.y+inward*route.dy,-29.5,29.5)};
        remaining.sort((a,b)=>{const x=metricPoint(a,snapshot),y=metricPoint(b,snapshot);return Math.hypot(x.x-target.x,x.y-target.y)-Math.hypot(y.x-target.x,y.y-target.y)||a.id.localeCompare(b.id);});
        const player=remaining.shift();if(player)rows.push({playerId:player.id,target:livePoint(target,snapshot),role:route.role,priority:3});
      }
      return rows;
    }
    function planRestartThrow(rawSnapshot,takerId){
      const snapshot=normalizeSnapshot(rawSnapshot,capability.workflow),owner=snapshot.players.find(p=>p.id===takerId&&!p.isGK&&!p.sentOff);
      if(!enabled||!owner||snapshot.humanPlayerIds.has(owner.id))return null;
      const origin=metricPoint(snapshot.ball,snapshot),team=snapshot.teams.find(t=>t.id===owner.teamId),dir=team.attackingDirection;
      function throwing(target){
        const distance=Math.hypot(target.x-origin.x,target.y-origin.y),seconds=clamp(.28+distance/22,.45,1.15);
        const height=snapshot.ball.z/snapshot.units.zPerMetre,targetHeight=.15;
        // Solve this short flight against MR drag/gravity. The legacy throw
        // estimate lands longer throws short of the supposedly free receiver.
        // The two local Newton steps are detached physics, never a ball warp.
        function sample(horizontal,vertical){
          let state=dependencies.ball.resolveLaunch({id:'cpu-throw-solve',origin:{x:0,y:0,z:height+.11},
            direction:{x:1,y:0},speed:Math.hypot(horizontal,vertical),liftAngleDeg:Math.atan2(vertical,horizontal)*180/Math.PI,source:'throw-in'}).state;
          let context=dependencies.ball.createSimulationContext({seed:1});
          for(let left=seconds;left>1e-9;){const dt=Math.min(.2,left),next=dependencies.ball.step(state,context,dt,{});
            state=next.state;context=next.context;left-=dt;}
          return state.position;
        }
        let horizontal=Math.expm1(.0138*distance)/(.0138*seconds),
          vertical=(targetHeight-height-.11+4.903325*seconds*seconds)/seconds+.35*seconds*seconds;
        for(let i=0;i<2;i++){
          const p=sample(horizontal,vertical),px=sample(horizontal+.1,vertical),pz=sample(horizontal,vertical+.1),
            ex=distance-p.x,ez=targetHeight-p.z,a=(px.x-p.x)/.1,b=(pz.x-p.x)/.1,c=(px.z-p.z)/.1,d=(pz.z-p.z)/.1,det=a*d-b*c;
          if(Math.abs(det)<1e-6)break;
          horizontal=Math.max(1,horizontal+(ex*d-b*ez)/det);vertical+=(a*ez-ex*c)/det;
        }
        return {speed:Math.hypot(horizontal,vertical),liftAngleDeg:Math.atan2(vertical,horizontal)*180/Math.PI,flightSeconds:seconds,targetHeightMetres:targetHeight};
      }
      const options=snapshot.players.filter(p=>p.teamId===owner.teamId&&p.id!==owner.id&&futureCpuReceiver(p))
        .map(player=>{
          const position=metricPoint(player,snapshot),velocity=metricVelocity(player,snapshot);
          const target=boundarySafeCpuPassIntent({target:{x:position.x+velocity.x*.12,y:position.y+velocity.y*.12}}).target;
          const distance=Math.hypot(target.x-origin.x,target.y-origin.y),progress=dir*(target.x-origin.x);
          const space=Math.min(...snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.isGK&&!p.sentOff)
            .map(p=>{const q=metricPoint(p,snapshot);return Math.hypot(q.x-target.x,q.y-target.y);}),100);
          return {player,target,distance,progress,score:progress*.5+Math.min(space,15)*1.5-distance*.2};
        }).filter(o=>o.distance>=3&&o.distance<=17.2).sort((a,b)=>b.score-a.score||a.player.id.localeCompare(b.player.id));
      let contested=null;
      for(const row of options){
        const intent={type:'pass',targetPlayerId:row.player.id,target:row.target,supportKind:'throw-in',
          throwProfile:throwing(row.target),confidence:.85,reason:'checked-throw-free-receiver'};
        const race=evaluateCpuPassRace(snapshot,owner,intent);
        if(race.accepted)return {...intent,passRace:race,meetingContract:'checked-feet-throw',playerId:owner.id,target:livePoint(intent.target,snapshot)};
        if(!cpuPassSafetyContext(snapshot,owner,intent).critical && (!contested || row.score>contested.score))contested={score:row.score,intent:{...intent,passRace:race,reason:'named-throw-contested-receiver',playerId:owner.id,target:livePoint(intent.target,snapshot)}};
      }
      // Restart law still requires a release when every short man is marked.
      // Contest a named teammate rather than inventing an unowned destination.
      if(contested)return contested.intent;
      // A crowded throw still has to restart play. Send it firmly up the line
      // into a real second-ball race, rather than gift a marked backward man.
      const target={x:clamp(origin.x+dir*16,1,104),y:clamp(origin.y-Math.sign(origin.y||1)*5,-29,29)};
      return {type:'pass',targetPlayerId:null,target:livePoint(target,snapshot),throwProfile:throwing(target),
        playerId:owner.id,reason:'crowded-throw-up-the-line',confidence:.75};
    }
    function rejectedPassFallback(snapshot, owner, rejectedRace, supportOptions = []) {
      const team = snapshot.teams.find(row => row.id === owner.teamId);
      const direction = team && team.attackingDirection === -1 ? -1 : 1;
      const ownerMetric = metricPoint(owner, snapshot);
      const safeSupport = supportOptions.filter(intent => intent.risk && intent.risk.probability < .42 &&
        intent.risk.pressure < .5 && snapshot.players.some(p => p.id === intent.targetPlayerId &&
          p.teamId === owner.teamId && futureCpuReceiver(p)));
      // The CPU supplies its scored lane/pressure estimates. Test the best
      // short links with the same MR interception projection as the original
      // pass; no forced second forward ball after a rejected run.
      let repeatedOutlet=null;
      for(const candidate of safeSupport.slice(0,3)){
        const intent=boundarySafeCpuPassIntent(candidate);
        const race=evaluateCpuPassRace(snapshot,owner,intent);
        if(race.accepted){const checked={...intent,confidence:.78,
          reason:direction*(intent.target.x-ownerMetric.x)>2 ? 'forward-outlet-after-rejected-run' : 'short-support-after-rejected-run',
          fallbackFrom:'pass',rejectedPassRace:rejectedRace,passRace:race};
          if(!intent.circulationPenalty&&!repeatedOutlet)return checked;
          if(!repeatedOutlet||finite(checked.supportScore,0)>finite(repeatedOutlet.supportScore,0))repeatedOutlet=checked;
        }
      }
      if(repeatedOutlet&&!repeatedOutlet.circulationPenalty)return repeatedOutlet;
      const pressure=Math.min(...snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.sentOff&&!p.isGK)
        .map(p=>{const q=metricPoint(p,snapshot);return Math.hypot(q.x-ownerMetric.x,q.y-ownerMetric.y);}),100);
      // A checked emergency return remains available. In space, compare its
      // diminished repeated-link value with a real carry/firm exit instead of
      // blindly selecting the first safe return for a third time.
      if(repeatedOutlet&&pressure<3.25)return repeatedOutlet;
      const safety=cpuPassSafetyContext(snapshot,owner,{target:ownerMetric});
      if(safety.ownThird){
        const firm=firmExitIntent(snapshot,owner);
        if(firm)return firm;

      }
      const carryTarget = {
        x: clamp(ownerMetric.x + direction * 4.5, METRIC_PITCH.xMin + 1, METRIC_PITCH.xMax - 1),
        y: clamp(ownerMetric.y, METRIC_PITCH.yMin + 1, METRIC_PITCH.yMax - 1)
      };
      const carryDistance = Math.hypot(carryTarget.x - ownerMetric.x, carryTarget.y - ownerMetric.y);
      const carryClearance = Math.min(...snapshot.players.filter(player => player.teamId !== owner.teamId && !player.sentOff)
        .map(player => {
          const position = metricPoint(player, snapshot);
          return Math.hypot(position.x - carryTarget.x, position.y - carryTarget.y);
        }), Infinity);
      const carryScore=45+Math.min(carryClearance,8)*5+carryDistance*4+
        (finite(owner.attrs.control,70)+finite(owner.attrs.awareness,70))*.1;
      if(repeatedOutlet&&(carryDistance<2||carryClearance<3.25||finite(repeatedOutlet.supportScore,0)>=carryScore))return repeatedOutlet;
      if (carryDistance >= 2 && carryClearance >= 3.25) return {
        type: 'carry', targetPlayerId: null, target: carryTarget, confidence: .72,
        reason: repeatedOutlet?'defender-pair-history-break-carry':'unsafe-pass-race-carry', fallbackFrom: 'pass', passRace: rejectedRace
      };
      // A turn/shield is still football under ordinary pressure. Clear only
      // when the box is genuinely in danger and every checked exit is closed.
      for(const side of [-1,1]){
        const target={x:clamp(ownerMetric.x+direction*.5,1.5,103.5),y:clamp(ownerMetric.y+side*1.5,-32.5,32.5)},
          room=Math.min(...snapshot.players.filter(p=>p.teamId!==owner.teamId&&!p.sentOff).map(p=>{
            const q=metricPoint(p,snapshot);return Math.hypot(q.x-target.x,q.y-target.y);}),100);
        if(room>1.6&&pressure>1.2)return {type:'carry',targetPlayerId:null,target,confidence:.7,reason:'turn-away-from-covered-pass',fallbackFrom:'pass'};
      }
      const danger=safety.ownThird&&clearanceDanger(snapshot,owner);
      if(danger)return repeatedOutlet||clearanceIntent(snapshot,owner,danger);
      return {type:'protect',targetPlayerId:null,target:{...ownerMetric},confidence:.82,
        reason:'shield-awaits-safe-outlet',fallbackFrom:'pass',passRace:rejectedRace};
    }
    function receiverFeetCorrection(snapshot, owner, intent, rejectedRace) {
      if (intent.supportKind === 'in-behind') return null;
      if (!rejectedRace || !['receiver-cannot-arrive', 'receiver-not-ready-at-arrival',
        'trajectory-misses-target-window'].includes(rejectedRace.reason)) return null;
      const receiver = snapshot.players.find(player => String(player.id) === String(intent.targetPlayerId || '')) || null;
      if (!receiver || receiver.teamId !== owner.teamId || !futureCpuReceiver(receiver)) return null;
      const origin = metricPoint(owner, snapshot), position = metricPoint(receiver, snapshot), velocity = metricVelocity(receiver, snapshot);
      // Lead a moving receiver along his current motion. Requiring a sprinting
      // teammate to reverse to his old feet rejects an otherwise clear link.
      // This only authors a rendezvous: the same MR race must still accept it.
      const flightSeconds = rejectedRace.ballArrivalTick == null
        ? Math.hypot(position.x-origin.x,position.y-origin.y) / Math.max(1,rejectedRace.launchSpeedMetresPerSecond || 12)
        : rejectedRace.ballArrivalTick * FIXED_TICK_SECONDS;
      const leadSeconds = cpuPassSafetyContext(snapshot,owner,intent).critical ? .12 : clamp(flightSeconds*.65,.2,.8);
      const margin=cpuTargetBoundaryMargin(intent);
      const target = {
        x: clamp(position.x + velocity.x * leadSeconds, METRIC_PITCH.xMin + margin,METRIC_PITCH.xMax - margin),
        y: clamp(position.y + velocity.y * leadSeconds, METRIC_PITCH.yMin + margin,METRIC_PITCH.yMax - margin)
      };
      const distanceMetres = Math.hypot(target.x - origin.x, target.y - origin.y);
      if (distanceMetres < 6 || distanceMetres > 24) return null;
      const direction=snapshot.teams.find(team=>team.id===owner.teamId).attackingDirection;
      // A failed forward rendezvous is not a request to pass behind the
      // carrier to a runner still departing on that run. Select an actual
      // showing support player through the normal checked fallback instead.
      if(direction*(intent.target.x-origin.x)>2&&direction*(target.x-origin.x)<-1)return null;
      return {
        ...clone(intent),
        target,
        rendezvousCorrection: {
          kind: 'receiver-feet',
          originalTarget: clone(intent.target),
          correctedTarget: clone(target),
          distanceMetres: Math.round(distanceMetres * 1000) / 1000,
          rejectedReason: rejectedRace.reason
        }
      };
    }
    function sameRejectedCpuPass(commitment, intent) {
      if (!commitment || !intent || intent.type !== 'pass' || !intent.target || !commitment.authoredPass) return false;
      const authored = commitment.authoredPass;
      if (String(intent.targetPlayerId || '') !== String(authored.targetPlayerId || '') ||
          String(intent.reason || '') !== String(authored.reason || '') ||
          String(intent.supportKind || '') !== String(authored.supportKind || '')) return false;
      return Math.hypot(intent.target.x - authored.target.x, intent.target.y - authored.target.y) <= .75;
    }
    function gatedCpuOutputs(snapshot, outputs) {
      const commitments = clone(domain.cpuRejectedPassCommitments || { you: null, opp: null });
      const owner = snapshot.ball.ownerId && snapshot.players.find(player => player.id === snapshot.ball.ownerId);
      if (!owner || snapshot.humanPlayerIds.has(owner.id)) {
        return { outputs, commitments: { you: null, opp: null } };
      }
      for (const teamId of ['you', 'opp']) {
        const commitment = commitments[teamId];
        if (commitment && (teamId !== owner.teamId || commitment.teamId !== owner.teamId ||
            commitment.ownerId !== owner.id || snapshot.tick > commitment.untilTick)) commitments[teamId] = null;
      }
      const decision = outputs[owner.teamId], intent = decision && decision.carrierIntent;
      if(intent&&['wait','protect','carry','take-on'].includes(intent.type)&&cpuPassSafetyContext(snapshot,owner,intent).ownThird&&
        snapshot.players.some(p=>p.teamId!==owner.teamId&&!p.sentOff&&!p.isGK&&
          Math.hypot((p.x-owner.x)/snapshot.units.xPerMetre,(p.y-owner.y)/snapshot.units.yPerMetre)<10)){
        const fallback=rejectedPassFallback(snapshot,owner,{accepted:false,reason:'own-third-no-clean-short-lane'},decision.supportPassOptions);
        if(fallback.type==='pass'||fallback.type==='clearance')return {commitments,outputs:{...outputs,
          [owner.teamId]:{...decision,carrierIntent:fallback}}};
      }
      if (!intent || !['pass', 'cross'].includes(intent.type)) {
        commitments[owner.teamId] = null;
        return { outputs, commitments };
      }
      const authoredIntent = boundarySafeCpuPassIntent(intent);
      const commitment = commitments[owner.teamId];
      if (commitment && sameRejectedCpuPass(commitment, authoredIntent)) {
        const heldRace = {
          schema: 'football-legacy-cpu-pass-receiver-race-v2',
          accepted: false,
          reason: 'rejected-pass-commitment-held',
          held: true,
          passerId: owner.id,
          receiverId: commitment.receiverId,
          evaluatedTick: commitment.evaluatedTick,
          untilTick: commitment.untilTick,
          sourceRejectedRace: clone(commitment.rejectedRace)
        };
        const heldIntent = clone(commitment.fallbackIntent);
        return { commitments, outputs: {
          ...outputs,
          [owner.teamId]: {
            ...decision,
            carrierIntent: heldIntent,
            telemetry: { ...clone(decision.telemetry || {}), passReceiverRace: heldRace,
              passReceiverRaceFallback: clone(heldIntent) }
          }
        } };
      }
      commitments[owner.teamId] = null;
      // A held rejection has no new flight to solve. Compare the actual CPU
      // request first, then forecast the moving rendezvous only on a fresh
      // admission; the prior order reran several MR flights on every hold tick.
      const candidateIntent = runnerRendezvousIntent(snapshot,owner,authoredIntent);
      let selectedIntent = candidateIntent;
      const originalRace = evaluateCpuPassRace(snapshot, owner, candidateIntent);
      let acceptedRace = originalRace;
      if(!acceptedRace.accepted&&originalRace.reason==='insufficient-interception-margin'&&
          candidateIntent.supportKind==='in-behind'&&candidateIntent.flightType==='ground-pass'){
        // A moving defender can close a lane that looked open at decision
        // time. Try the existing over-the-top flight to the same runner,
        // with its own MR weight and the identical interception authority.
        const lofted=runnerRendezvousIntent(snapshot,owner,{...authoredIntent,flightType:'long-pass',
          reason:candidateIntent.reason==='high-line-ball-in-behind'?'high-line-over-the-top':'run-over-the-top'}),
          loftedRace=evaluateCpuPassRace(snapshot,owner,lofted);
        if(loftedRace.accepted){selectedIntent=lofted;acceptedRace={...loftedRace,originalRejectedRace:clone(originalRace)};}
      }
      if (!acceptedRace.accepted) {
        const correctedIntent = receiverFeetCorrection(snapshot, owner, candidateIntent, originalRace);
        if (correctedIntent) {
          const correctedRace = evaluateCpuPassRace(snapshot, owner, correctedIntent);
          const correctedAccepted = correctedRace;
          if (correctedAccepted.accepted) {
            selectedIntent = correctedIntent;
            acceptedRace = { ...correctedAccepted, rendezvousCorrection: clone(correctedIntent.rendezvousCorrection),
              originalRejectedRace: clone(originalRace) };
          }
        }
      }
      // Score all V2 box runners through the identical interception check.
      // A covered first choice does not prove that the far-post runner is covered.
      if(!acceptedRace.accepted&&candidateIntent.type==='cross'){
        for(const option of candidateIntent.deliveryOptions||[]){
          const alternative=runnerRendezvousIntent(snapshot,owner,boundarySafeCpuPassIntent({...candidateIntent,...option,deliveryOptions:[]}));
          const race=evaluateCpuPassRace(snapshot,owner,alternative);
          if(race.accepted){selectedIntent=alternative;acceptedRace=race;break;}
        }
      }
      let carrierIntent = acceptedRace.accepted ? { ...clone(selectedIntent), passRace: acceptedRace }
        : rejectedPassFallback(snapshot, owner, originalRace, decision.supportPassOptions);
      if(!acceptedRace.accepted&&candidateIntent.type==='cross'&&
          (candidateIntent.wideDriveOption||!['pass','clearance'].includes(carrierIntent.type))){
        // The cross is covered, but the winger may still have real grass
        // towards the line. Use the V2-authored carry/hold only after checked
        // short outlets; never force the rejected delivery or run it out.
        const progress=candidateIntent.wideDriveOption||candidateIntent.bylineHoldOption;
        if(progress)carrierIntent={...clone(progress),fallbackFrom:'cross',passRace:clone(originalRace)};
      }
      // Match lab only: count pass-check outcomes when the lab provides a ledger.
      const labLedger = typeof globalThis !== 'undefined' && globalThis.__dartyLabIntents;
      if (labLedger) {
        const raceKey = 'race:' + String(candidateIntent.reason || '') + ':' + (acceptedRace.accepted ? 'accepted' : originalRace.reason) +
          (acceptedRace.accepted ? '' : '->' + carrierIntent.type + ':' + carrierIntent.reason);
        labLedger[raceKey] = (labLedger[raceKey] || 0) + 1;
      }
      const acceptedFallbackPass = carrierIntent.type === 'pass' && carrierIntent.passRace &&
        carrierIntent.passRace.accepted === true;
      commitments[owner.teamId] = acceptedRace.accepted || acceptedFallbackPass ? null : {
        teamId: owner.teamId,
        ownerId: owner.id,
        receiverId: candidateIntent.targetPlayerId == null ? null : String(candidateIntent.targetPlayerId),
        evaluatedTick: snapshot.tick,
        untilTick: snapshot.tick + CPU_REJECTED_PASS_COMMITMENT_TICKS - 1,
        authoredPass: {
          targetPlayerId: authoredIntent.targetPlayerId == null ? null : String(authoredIntent.targetPlayerId),
          target: clone(authoredIntent.target),
          reason: String(authoredIntent.reason || ''),
          supportKind: authoredIntent.supportKind == null ? null : String(authoredIntent.supportKind)
        },
        fallbackIntent: clone(carrierIntent),
        rejectedRace: clone(originalRace)
      };
      return { commitments, outputs: {
        ...outputs,
        [owner.teamId]: {
          ...decision,
          carrierIntent,
          telemetry: { ...clone(decision.telemetry || {}), passReceiverRace: clone(acceptedRace),
            passReceiverRaceFallback: acceptedRace.accepted ? null : clone(carrierIntent) }
        }
      } };
    }
    function goalEnvironment() {
      if(cachedGoalEnvironment)return cachedGoalEnvironment;
      return cachedGoalEnvironment = { colliders: [
        ...dependencies.ball.createGoalFrame({ id: 'home-goal-v2', leftPostBase: { x: 0, y: -3.66, z: 0 }, rightPostBase: { x: 0, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 }),
        ...dependencies.ball.createGoalFrame({ id: 'away-goal-v2', leftPostBase: { x: 105, y: -3.66, z: 0 }, rightPostBase: { x: 105, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 })
      ], groundEnabled: true };
    }
    function ballMismatch(ball) {
      const prior = domain.lastBallProjection; if (!prior) return true;
      return Math.abs(ball.x - prior.x) > 0.2 || Math.abs(ball.y - prior.y) > 0.2 || Math.abs(ball.z - prior.z) > 0.2 ||
        Math.abs(ball.vx - prior.vx) > 0.08 || Math.abs(ball.vy - prior.vy) > 0.08 || Math.abs(ball.zv - prior.zv) > 0.08;
    }
    function boundDirectionalKnockOn(snapshot, state, projection) {
      const contract = snapshot.dribbling.directionalKnockOnIntent;
      if (!contract || !dependencies.ball.isBallState(state) || !projection) {
        return { state, projection, active: false, bounded: false };
      }
      const dx = projection.x - contract.startX, dy = projection.y - contract.startY;
      const along = dx * contract.nx + dy * contract.ny;
      const lateral = -contract.ny * dx + contract.nx * dy;
      const travelled = Math.hypot(dx, dy);
      const interrupted = Math.abs(lateral) > contract.distance * .60;
      // The authored distance is a knock-on reference, not an endpoint. MR
      // owns the complete free roll; only the distant containment ceiling may
      // intervene, and it must never teleport the ball back to the reference.
      const bounded = !interrupted && travelled >= contract.maximumTravelDistance;
      if (!bounded) return { state, projection, active: !interrupted, bounded: false, along, lateral, travelled };
      const boundedState = dependencies.ball.createBallState({
        ...state,
        position: { ...state.position, z: state.radius },
        velocity: { x: 0, y: 0, z: 0 },
        grounded: true,
        settled: false,
        settleTime: 0,
        regime: dependencies.ball.REGIMES.ROLL,
        metadata: { ...state.metadata, directionalKnockOnSafetyBounded: true,
          directionalKnockOnLaunchSequence: contract.launchSequence }
      });
      return { state: boundedState, projection: liveBall(boundedState, snapshot), active: true,
        bounded: true, along, lateral, travelled };
    }
    function ballPlan(snapshot) {
      if (snapshot.ball.ownerId) return { projection: null, trace: null, stagedState: null, stagedContext: domain.ballContext, stagedProjection: null, stagedLaunchSequence: domain.lastLaunchSequence };
      const metric = metricBall(snapshot.ball, snapshot), intent = snapshot.ball.launchIntent;
      let state = domain.ballState, context = domain.ballContext, launchSequence = domain.lastLaunchSequence;
      if (intent && String(intent.sequence || '') !== launchSequence) {
        const origin = point(intent.origin, { x: snapshot.ball.x, y: snapshot.ball.y });
        const originMetric = { x: (origin.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          y: (origin.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre,
          z: Math.max(.11, finite(intent.origin && intent.origin.z, snapshot.ball.z) / snapshot.units.zPerMetre + .11) };
        const resolved = dependencies.ball.resolveLaunch({ id: 'live-release-' + String(intent.sequence), origin: originMetric,
          direction: unit(intent.direction, { x: 1, y: 0 }), speed: clamp(finite(intent.speedMetresPerSecond, 0), .05, 48),
          liftAngleDeg: clamp(finite(intent.liftAngleDeg, 0), intent.source==='keeper-deflection'?-89:-8, intent.source==='keeper-deflection'||intent.source==='shot'&&intent.trajectoryProfile==='penalty-chip'?89:62), sideSpinRpm: clamp(finite(intent.sideSpinRpm, 0), -2200, 2200),
          topSpinRpm: clamp(finite(intent.topSpinRpm, 0), -1800, 1800), axialSpinRpm: clamp(finite(intent.axialSpinRpm, 0), -1800, 1800), source: String(intent.source || snapshot.ball.flightType || 'live-v2-launch'),
          metadata: { adapterVersion: VERSION, deterministicSeed, sourcePlayerId: intent.sourcePlayerId || null, targetPlayerId: intent.targetPlayerId || null,
            groundDampingModel: intent.groundDampingModel || null,
            groundLinearDampingPerSecond: Number.isFinite(intent.groundLinearDampingPerSecond) ? intent.groundLinearDampingPerSecond : 0,
            groundDampingInitialPerSecond: Number.isFinite(intent.groundDampingInitialPerSecond) ? intent.groundDampingInitialPerSecond : 0,
            groundDampingRampScale: Number.isFinite(intent.groundDampingRampScale) ? intent.groundDampingRampScale : 0,
            groundDampingRampExponent: Number.isFinite(intent.groundDampingRampExponent) ? intent.groundDampingRampExponent : 0,
            groundDampingOriginX: originMetric.x,
            groundDampingOriginY: originMetric.y,
            groundDampingReferenceDistanceMetres: Number.isFinite(intent.groundDampingReferenceDistanceMetres)
              ? intent.groundDampingReferenceDistanceMetres : 0,
            groundDampingMaximumProgress: Number.isFinite(intent.groundDampingMaximumProgress)
              ? intent.groundDampingMaximumProgress : 3,
            groundSkidFrictionScale: Number.isFinite(intent.groundSkidFrictionScale) ? intent.groundSkidFrictionScale : 1,
            groundLinearDampingUntilSeconds: Number.isFinite(intent.groundLinearDampingUntilSeconds) ? intent.groundLinearDampingUntilSeconds : 0,
            knuckleEnabled: intent.knuckleEnabled === true,
            knuckleAcceleration: Number.isFinite(intent.knuckleAcceleration) ? intent.knuckleAcceleration : 0,
            knuckleMinimumSpeed: Number.isFinite(intent.knuckleMinimumSpeed) ? intent.knuckleMinimumSpeed : 18,
            knuckleMaximumSpin: Number.isFinite(intent.knuckleMaximumSpin) ? intent.knuckleMaximumSpin : 6,
            knuckleOscillationFrequencyHz: Number.isFinite(intent.knuckleOscillationFrequencyHz)
              ? intent.knuckleOscillationFrequencyHz : 3.5 } });
        state = resolved.state; launchSequence = String(intent.sequence);
      } else if (!state || ballMismatch(snapshot.ball) ||
          // A host skill or slide can release a carried ball with no launch intent;
          // a loose ball must never keep the carrier's controlled regime.
          state.regime === dependencies.ball.REGIMES.CONTROLLED) {
        state = dependencies.ball.createBallState({ id: snapshot.ball.id, position: metric.position, velocity: metric.velocity,
          angularVelocity: state ? state.angularVelocity : { x: 0, y: 0, z: 0 }, grounded: metric.position.z <= .111 && metric.velocity.z <= .65,
          metadata: { resynchronizedFromBuild173Contact: true } });
      }
      // A Build 173 ownership/restart handoff can resynchronise the ball while
      // the adapter's deterministic simulation tick keeps advancing. Ball V2's
      // context is duration-based, so align only its outer chronology to this
      // exact host tick before stepping; the seeded context and all force state
      // remain intact. Contact then receives lastOuterTick === snapshot.tick.
      if (context.outerTick !== snapshot.tick - 1) context = dependencies.ball.createSimulationContext({
        ...context,
        outerTick: snapshot.tick - 1
      });
      const stepped = dependencies.ball.step(state, context, FIXED_TICK_SECONDS, goalEnvironment());
      const boundedKnockOn = boundDirectionalKnockOn(snapshot, stepped.state, liveBall(stepped.state, snapshot));
      return { projection: boundedKnockOn.projection, trace: stepped.trace, stagedState: boundedKnockOn.state,
        stagedContext: stepped.context, stagedProjection: clone(boundedKnockOn.projection),
        stagedLaunchSequence: launchSequence, directionalKnockOn: boundedKnockOn };
    }
    function cpuHighBallAerialIntent(snapshot, movementState, ballState, possession, flight) {
      if (capability.workflow !== 'cpu-v-cpu' || !flight ||
          !ballState || ballState.velocity.z > 1.5 || ballState.position.z < .4) return null;
      const ball = ballState.position, sourceTeam = flight.sourceTeamId;
      const candidates = movementState.players.map(player => {
        const roster = snapshot.players.find(p => p.id === player.id), attrs = roster && roster.attrs || {};
        const gap = Math.hypot(player.position.x - ball.x, player.position.y - ball.y);
        const access = gap <= 1e-12 ? 1 : ((ball.x - player.position.x) * player.facing.x +
          (ball.y - player.position.y) * player.facing.y) / gap;
        const maximumHeight = (roster && roster.heightM || 1.8) + .18 + (finite(attrs.jumping, 70) - 1) / 98 * .34;
        return { player, roster, gap, maximumHeight, access,
          score: finite(attrs.heading, 70) * .44 + finite(attrs.jumping, 70) * .25 + finite(attrs.awareness, 70) * .16 - gap * 45 };
      }).filter(p => p.roster && p.roster.contactEligible && !p.roster.sentOff && !p.roster.isGK &&
        !snapshot.dribbling.specialActionPlayerIds?.includes(p.player.id)&&
        p.gap <= .86 && ball.z <= p.maximumHeight &&
        p.access >= (ball.z >= 1.05 ? -.78 : -.3) &&
        !(p.player.id === snapshot.ball.lastKickerId && snapshot.tick - flight.releaseTick < 28))
        .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
      const selected = candidates[0];
      if (!selected) return null;
      const team = snapshot.teams.find(t => t.id === selected.player.teamId), direction = team.attackingDirection;
      const distanceToGoal = direction > 0 ? 105 - ball.x : ball.x;
      const shoot = distanceToGoal < 21 && Math.abs(ball.y) < 20.16;
      const opponentGap = Math.min(...movementState.players.filter(p => p.teamId !== selected.player.teamId)
        .map(p => Math.hypot(p.position.x - ball.x, p.position.y - ball.y)), Infinity);
      const flairQuality=(finite(selected.roster.attrs.technique,70)+finite(selected.roster.attrs.agility,70)+finite(selected.roster.attrs.awareness,70))/297;
      if(shoot&&distanceToGoal<16&&selected.gap>=.28&&selected.access<.65&&ball.z>.9&&ball.z<2.5&&
          stableHash([flight.key,selected.player.id,'flair-finish'].join(':'))/0xffffffff<.05+flairQuality*.23)
        return {actorId:selected.player.id,flair:true,intent:'shoot',sequence:['cpu-flair',flight.key,selected.player.id].join(':')};
      const shotTarget={x:direction>0?105:0,y:ball.y>0?-1.6:1.6},
        goalRay=unit({x:shotTarget.x-ball.x,y:shotTarget.y-ball.y},selected.player.facing),
        targetAlignment=goalRay.x*selected.player.facing.x+goalRay.y*selected.player.facing.y;
      if(shoot&&ball.z<1.05&&targetAlignment<-.24)return null;
      const drop=(flight.trajectory||[]).find(q=>q.tick>=snapshot.tick&&q.z<=1.55&&q.vz<=0),
        dropTicks=drop?Math.max(0,drop.tick-snapshot.tick):Math.max(0,(ball.z-1.55)/Math.max(.5,-ballState.velocity.z)*60),
        opponentEta=Math.min(...snapshot.players.filter(p=>p.teamId!==selected.player.teamId&&!p.sentOff&&!p.isGK)
          .map(p=>movementRaceEtaTicks(movementRaceProfile(p,snapshot,true),drop||ball))),
        volleyQuality=(finite(selected.roster.attrs.volleys,selected.roster.attrs.control||70)+finite(selected.roster.attrs.technique,selected.roster.attrs.control||70))/198,
        volleyRead=shoot&&selected.access>=-.3&&targetAlignment>=-.24&&
          (ball.z<=1.55||opponentEta>dropTicks-3)&&stableHash([flight.key,selected.player.id,'volley'].join(':'))/0xffffffff<
          .18+volleyQuality*.56+clamp((3-opponentGap)/3,0,1)*.2;
      // Do not head a good volley before it drops into the existing boot window.
      if(volleyRead&&ball.z>1.55)return null;
      const technique=volleyRead&&ball.z<=1.55?'volley':ball.z>=1.05?'header':'volley';
      const unopposedReceipt = (direction > 0 ? ball.x : 105 - ball.x) > 12 && opponentGap > 2.2;
      const preferChest = unopposedReceipt && !volleyRead &&
        stableHash([flight.key, selected.player.id, 'chest'].join(':')) / 0xffffffff <
          .15 + finite(selected.roster.attrs.control, 70) / 99 * .65;
      // With time and space, receive the delivery rather than heading an
      // uncontested ball straight back into another loose contest. A nearby
      // opponent cancels the wait and the aerial model resolves the challenge.
      if(preferChest&&ball.z<1.05)return null;
      if (preferChest && (ball.z > 1.6 || ball.z >= 1.05 && selected.gap > .5)) return null;
      if (unopposedReceipt && !preferChest && !shoot) return null;
      return { sequence: ['cpu-high', stableHash(flight.key), selected.player.id].join(':'), epoch: resetEpoch,
        commandTick: Math.max(1, snapshot.tick - (technique === 'header' ? 4 : 5)), actorId: selected.player.id,
        technique, intent: shoot ? 'shoot' : 'clear',
        receiveMode: preferChest && ball.z >= 1.05 && ball.z <= 1.6 ? 'chest' : null,
        target: shoot ? { ...shotTarget,z:.85 }
          : { x: clamp(ball.x + direction * 25, 2, 103), y: clamp(ball.y + (ball.y <= 0 ? -8 : 8), -30, 30), z: 1.8 } };
    }
    function contactPlan(snapshot, movementState, plannedBall, possession, cpu, aerialFlight) {
      if (!plannedBall.stagedState || movementState.ballOwnerId != null) return null;
      let aerialIntent = null;
      if (snapshot.contact.aerialIntent) {
        const source = snapshot.contact.aerialIntent, target = source.target && typeof source.target === 'object' ? source.target : {};
        aerialIntent = {
          sequence: String(source.sequence || ''),
          epoch: resetEpoch,
          commandTick: source.commandTick,
          actorId: String(source.actorId || ''),
          technique: String(source.technique || 'auto'),
          intent: String(source.intent || 'shoot'),
          target: {
            x: (finite(target.x, snapshot.pitch.xMin) - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
            y: (finite(target.y, (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) -
              (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre,
            z: Math.max(.11, finite(target.z, 0) / snapshot.units.zPerMetre + .11)
          }
        };
      }
      const cpuService = capability.workflow === 'cpu-v-cpu' && (Boolean(aerialFlight) || /(cross|corner)/.test(snapshot.ball.flightType));
      if (!aerialIntent && cpuService) aerialIntent = cpuHighBallAerialIntent(snapshot, movementState, plannedBall.stagedState, possession, aerialFlight);
      const cpuFlair=aerialIntent?.flair?aerialIntent:null;if(cpuFlair)aerialIntent=null;
      const activeIds = new Set(movementState.players.map(player => player.id));
      const priorBallPosition = metricBall(snapshot.ball, snapshot).position;
      const movingBodyFlight=!snapshot.ball.ownerId&&snapshot.ball.lastKickerId&&snapshot.ball.lastKickerTeamId&&
        Math.hypot(snapshot.ball.vx,snapshot.ball.vy,snapshot.ball.zv)>.03;
      const physicalStimulus=movingBodyFlight&&Number.isFinite(snapshot.ball.flightAge)?{releaseTick:Math.max(1,snapshot.tick-snapshot.ball.flightAge),
        sourcePlayerId:snapshot.ball.lastKickerId,sourceTeamId:snapshot.ball.lastKickerTeamId,physicalKick:true,
        elapsedBeforeEpochTicks:Math.max(0,snapshot.ball.flightAge-snapshot.tick+1)}:
        movingBodyFlight&&possession?.inFlight&&possession.sourcePlayerId===snapshot.ball.lastKickerId&&Number.isSafeInteger(possession.releaseTick)
          ?{releaseTick:possession.releaseTick,sourcePlayerId:possession.sourcePlayerId,sourceTeamId:possession.teamId,physicalKick:true}:null;
      const stimulus = possession && possession.reactionStimulus || physicalStimulus ||
        (possession && possession.inFlight && possession.deliberatePass && Number.isSafeInteger(possession.releaseTick) &&
          possession.sourcePlayerId ? {
            releaseTick: possession.releaseTick,
            sourcePlayerId: possession.sourcePlayerId,
            sourceTeamId: possession.teamId
          } : null);
      const reactionContext = stimulus && Number.isSafeInteger(stimulus.releaseTick) && stimulus.sourcePlayerId &&
        stimulus.sourceTeamId ? {
          active: true,
          stimulus: stimulus.physicalKick?'deliberate-kick-release':'deliberate-pass-release',
          releaseTick: stimulus.releaseTick,elapsedBeforeEpochTicks:stimulus.elapsedBeforeEpochTicks||0,
          sourcePlayerId: stimulus.sourcePlayerId,
          sourceTeamId: stimulus.sourceTeamId,
          previousBallPosition: priorBallPosition
        } : null;
      const authoredReceiverId = possession && possession.inFlight ? possession.intendedReceiverId : null;
      const result = dependencies.contact.compose({
        schema: dependencies.contact.REQUEST_SCHEMA,
        workflow: capability.workflow,
        online: false,
        tick: snapshot.tick,
        epoch: resetEpoch,
        seed: deterministicSeed,
        fixedTickSeconds: FIXED_TICK_SECONDS,
        movementWorld: movementState,
        ballState: plannedBall.stagedState,
        roster: snapshot.players.filter(player => activeIds.has(player.id)).map(player => {
          const ownAuthoredFlight = Boolean(possession && possession.inFlight && possession.deliberatePass &&
            player.teamId === possession.teamId);
          const intendedReceiver = Boolean(ownAuthoredFlight &&
            player.id === possession.intendedReceiverId);
          return {
            id: player.id,
            teamId: player.teamId,
            isGK: player.isGK,
            sentOff: player.sentOff,
            available: !player.sentOff,
            // A teammate may physically deflect an authored pass at any time,
            // but only its intended receiver may deliberately acquire it.
            // The receiver's reaction rating and the swept physical geometry
            // decide when that attempt exists; the authored endpoint is a
            // rendezvous aid, not an invisible contact permission boundary.
            contactEligible: player.id!==cpuFlair?.actorId && !player.sentOff && !player.isGK && player.contactEligible &&
              !snapshot.dribbling.specialActionPlayerIds?.includes(player.id)&&
              (cpuService || !ownAuthoredFlight || intendedReceiver),
            bodyContactEligible: player.id!==cpuFlair?.actorId && !player.sentOff && !player.isGK && player.bodyContactEligible&&
              !snapshot.dribbling.specialActionPlayerIds?.includes(player.id),
            heightM: player.heightM,
            attributes: clone(player.attrs)
          };
        }),
        // Movement V2 intentionally excludes goalkeepers and unavailable
        // players. Do not let a protected Build 173 keeper/restart target fail
        // contact normalization before the explicit authority gate can run.
        intendedReceiverId: (reactionContext || possession && possession.inFlight)
          ? authoredReceiverId && activeIds.has(authoredReceiverId) ? authoredReceiverId : null
          : snapshot.contact.intendedReceiverId && activeIds.has(snapshot.contact.intendedReceiverId)
            ? snapshot.contact.intendedReceiverId : null,
        firstTouchIntent: snapshot.contact.firstTouchIntent,
        reactionContext,
        aerialIntent,
        aerialFlightActive: Boolean(aerialFlight),
        consumedFirstTouchIds: domain.consumedFirstTouchIds,
        consumedFirstTouchThroughTick: domain.consumedFirstTouchThroughTick,
        consumedAerialIds: domain.consumedAerialIds,
        // Host animation authority is per actor. Only legacy snapshots that
        // omit the actor list retain the global protective gate. A distant
        // skill must not suspend everyone else's real first touch or duel.
        gate: {...snapshot.contact.gate,specialActionAuthority:snapshot.dribbling.specialActionPlayerIds===null&&
          snapshot.contact.gate.specialActionAuthority}
      }, contactCapability);
      if (!result || result.schema !== dependencies.contact.RESULT_SCHEMA || result.version !== dependencies.contact.VERSION ||
          result.tick !== snapshot.tick || result.epoch !== resetEpoch || result.online !== false ||
          !Number.isSafeInteger(result.consumedFirstTouchThroughTick) ||
          result.consumedFirstTouchThroughTick < domain.consumedFirstTouchThroughTick ||
          result.consumedFirstTouchThroughTick > snapshot.tick ||
          !dependencies.ball.isBallState(result.ballState)) throw new Error('live contact composer result contract failed');
      // The chosen actor is physically at the ball now. The shared human
      // flair executor owns its reach check, connection chance and launch;
      // do not roll a second aerial-model outcome in front of that path.
      if(cpuFlair&&!result.ownedContact)return {...result,cpuFlairIntent:clone(cpuFlair),sourceFlight:snapshot.ball.flightType,sourceTeam:snapshot.ball.lastKickerTeamId,suppressLegacy:{...result.suppressLegacy,aerialDuel:true}};
      if (!cpuService && result.ownedContact && result.ownerCandidateId && result.contactType === 'first-touch' &&
          plannedBall.stagedState.position.z <= .6 && vectorLength(plannedBall.stagedState.velocity) <= 18) {
        const actor = snapshot.players.find(p => p.id === result.ownerCandidateId);
        const intent = actor && cpu[actor.teamId] && cpu[actor.teamId].firstTimeIntent;
        if (intent && !snapshot.humanPlayerIds.has(actor.id) && actor.id === possession.intendedReceiverId) {
          // The incoming physical first-touch resolver proves foot contact.
          // Redirect that contact into a checked pass without granting a frame
          // of ownership or invoking the host's pass/combination planners.
          const origin = liveBall(plannedBall.stagedState, snapshot);
          const releaseSnapshot = { ...snapshot, ball: { ...snapshot.ball, ...origin, ownerId: actor.id } };
          const candidate = boundarySafeCpuPassIntent(runnerRendezvousIntent(releaseSnapshot,actor,intent));
          const race = evaluateCpuPassRace(releaseSnapshot, actor, candidate);
          if (race.accepted) {
            const launch = cpuPassLaunch(releaseSnapshot, actor, candidate);
            return { ...result, ownerCandidateId: null,
              ballState: dependencies.ball.createBallState({ ...launch.state,
                contactCount: result.ballState.contactCount, lastContact: result.ballState.lastContact,
                lastOuterTick: snapshot.tick, simulationTime: result.ballState.simulationTime }),
              presentation: { ...result.presentation, firstTimePass: { ...clone(candidate), passRace: race,
                origin: clone(plannedBall.stagedState.position), sourceTeamId: actor.teamId } } };
          }
        }
      }
      if(result.ownedContact&&result.contactType==='first-touch'&&!result.presentation?.firstTimePass&&
          plannedBall.stagedState.position.z<=.35&&
          /^(ground-pass|low-cross|driven-cross|involuntary-deflection|keeper-parry|keeper-tip)/.test(
            snapshot.ball.flightType==='ground'?snapshot.ball.serviceFlight||snapshot.ball.flightType:snapshot.ball.flightType)){
        const actor=snapshot.players.find(p=>p.id===String(result.presentation?.playerId||result.ownerCandidateId)),
          moved=actor&&movementState.players.find(p=>p.id===actor.id),b=plannedBall.stagedState.position;
        if(actor&&moved&&!snapshot.humanPlayerIds.has(actor.id)){
          const team=snapshot.teams.find(t=>t.id===actor.teamId),gx=team.attackingDirection>0?105:0,
            distance=Math.hypot(gx-b.x,b.y),quality=(finite(actor.attrs.shoot,70)+finite(actor.attrs.control,70)+finite(actor.attrs.awareness,70))/297,
            roll=stableHash([possession.releaseTick,actor.id,'first-time-ground'].join(':'))/0xffffffff;
          if(distance<19&&Math.abs(b.y)<12&&Math.hypot(plannedBall.stagedState.velocity.x,plannedBall.stagedState.velocity.y)>1&&
              roll<.18+quality*.65){
            const keeper=snapshot.players.find(p=>p.teamId!==actor.teamId&&p.isGK),ky=keeper?metricPoint(keeper,snapshot).y:0,
              target={x:gx,y:ky>=b.y?-2.8:2.8};
            return {...result,presentation:{...result.presentation,firstTimeShot:{target:livePoint(target,snapshot),
              power:clamp(.48+distance/50,.5,.88),technique:'driven',fromCutBack:snapshot.ball.serviceKind==='cut-back'}}};
          }
        }
      }
      return cpuService ? { ...result, sourceFlight: snapshot.ball.flightType, sourceTeam: aerialFlight && aerialFlight.sourceTeamId || snapshot.ball.lastKickerTeamId,
        flightKey: aerialFlight && aerialFlight.key || null,
        suppressLegacy: { ...result.suppressLegacy, aerialDuel: true } } : {...result,sourceFlight:snapshot.ball.flightType==='ground'&&snapshot.ball.serviceFlight?snapshot.ball.serviceFlight:snapshot.ball.flightType,sourceTeam:snapshot.ball.lastKickerTeamId};
    }
    function hasPhysicalDribblingLease(state) {
      return Boolean(state && state.physicalSeparated === true &&
        [dependencies.dribbling.PHASES.SEPARATED_TOUCH, dependencies.dribbling.PHASES.CHASE_RECOVERY].includes(state.phase) &&
        state.logicalOwnerId);
    }
    function controlledBallState(snapshot, ownerId, preferredState) {
      const metric = metricBall(snapshot.ball, snapshot);
      const base = dependencies.ball.isBallState(preferredState) ? preferredState
        : dependencies.ball.isBallState(domain.ballState) ? domain.ballState : null;
      return dependencies.ball.createBallState({
        ...(base || {}),
        id: snapshot.ball.id,
        position: metric.position,
        velocity: metric.velocity,
        regime: dependencies.ball.REGIMES.CONTROLLED,
        grounded: true,
        settled: false,
        settleTime: 0,
        lastOuterTick: snapshot.tick,
        metadata: {
          ...(base && base.metadata || {}),
          liveV2ControlledOwnerId: ownerId,
          adapterVersion: VERSION
        }
      });
    }
    function cpuDribblingAction(snapshot, intelligence, carrierId) {
      if (!carrierId || snapshot.humanPlayerIds.has(carrierId)) return null;
      const row = intelligence.projection.find(intent => intent.playerId === carrierId && ['pass', 'shot', 'cross', 'clearance'].includes(intent.type));
      if (!row) return null;
      const shotProfile = row.type === 'shot' && row.shotProfile && typeof row.shotProfile === 'object'
        ? row.shotProfile : null;
      return {
        id: ['cpu-dribble-action', resetEpoch, carrierId, row.type, row.targetPlayerId || 'none', Math.floor(snapshot.tick / 6)].join(':'),
        type: ['cross','clearance'].includes(row.type) ? 'pass' : row.type,
        actorId: carrierId,
        targetPlayerId: row.targetPlayerId,
        target: row.target,
        power: clamp(finite(shotProfile && shotProfile.power, finite(row.confidence, 0.65)), 0, 1),
        variant: shotProfile ? String(shotProfile.technique || 'driven') : 'normal',
        delivery: { supportKind: row.supportKind, supportMetrics: row.supportMetrics, passRace: row.passRace,
          offsideTiming: row.offsideTiming, reason: row.reason, risk: row.risk, type: row.type,
          crossKind: row.crossKind, flightType: row.flightType, switchMetrics: row.switchMetrics, clearanceProfile: row.clearanceProfile },
        source: 'cpu-v2',
        commandTick: snapshot.tick
      };
    }
    function dribblingPlan(snapshot, movementState, logicalOwnerId, candidateBallState, intelligence, activeLeaseAtStart,physicalPoke) {
      if (!dependencies.ball.isBallState(candidateBallState)) throw new Error('Dribbling V2 requires a complete staged Ball V2 state');
      if (!authorityProfile.trueFeelPhysicalTouchAuthority) {
        const carrier = logicalOwnerId && snapshot.players.find(player => player.id === logicalOwnerId);
        const previous = domain.dribblingState;
        const movementCarrier = carrier && movementState.players.find(player => player.id === carrier.id);
        const speed = movementCarrier ? vectorLength(movementCarrier.velocity) : 0;
        const attributes = carrier && carrier.attrs || {};
        const control = clamp(finite(attributes.control, 70), 1, 99);
        const technique = clamp(finite(attributes.technique, control), 1, 99);
        const agility = clamp(finite(attributes.agility, attributes.accel || attributes.acceleration || 70), 1, 99);
        const qualityScore = (control * 0.45 + technique * 0.35 + agility * 0.2) / 99;
        const nearestPressure = carrier ? snapshot.players.filter(player => player.teamId !== carrier.teamId && !player.sentOff)
          .map(player => ({ id: player.id, distance: Math.hypot(
            (player.x - carrier.x) / snapshot.units.xPerMetre,
            (player.y - carrier.y) / snapshot.units.yPerMetre) }))
          .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0] || null : null;
        const pressure = nearestPressure ? clamp((2.4 - nearestPressure.distance) / 2.4, 0, 1) : 0;
        const cadenceTicks = Math.round(clamp(31 - speed * 1.05 - qualityScore * 3,
          dependencies.dribbling.CONFIG.minimumTouchCadenceTicks,
          dependencies.dribbling.CONFIG.maximumTouchCadenceTicks));
        const sameCarrier = Boolean(carrier && previous.carrierId === carrier.id &&
          previous.logicalOwnerId === carrier.id && previous.phase === dependencies.dribbling.PHASES.SECURED_CONTROL);
        const touchBoundary = Boolean(carrier && (!sameCarrier || snapshot.tick >= previous.nextTouchTick));
        const touchSequence = previous.touchSequence + (touchBoundary ? 1 : 0);
        const foot = carrier ? (touchBoundary ? (touchSequence % 2 === 0 ? 'left' : 'right')
          : previous.foot || (touchSequence % 2 === 0 ? 'left' : 'right')) : null;
        const targetSeparationMetres = carrier
          ? clamp(0.5 + speed * 0.035 + (1 - qualityScore) * 0.12 + pressure * 0.06, 0.5, 0.82)
          : 0;
        const carrierFacing = movementCarrier ? movementCarrier.facing : { x: carrier && carrier.fx || 1, y: carrier && carrier.fy || 0 };
        const carrierPosition = movementCarrier ? movementCarrier.position : carrier ? metricPoint(carrier, snapshot) : null;
        const contactPoint = carrierPosition ? {
          x: carrierPosition.x + carrierFacing.x * targetSeparationMetres - carrierFacing.y * (foot === 'left' ? -0.08 : 0.08),
          y: carrierPosition.y + carrierFacing.y * targetSeparationMetres + carrierFacing.x * (foot === 'left' ? -0.08 : 0.08)
        } : null;
        const state = dependencies.dribbling.createState({
          epoch: resetEpoch,
          phase: carrier ? dependencies.dribbling.PHASES.SECURED_CONTROL : dependencies.dribbling.PHASES.IDLE,
          phaseStartedTick: sameCarrier ? previous.phaseStartedTick : snapshot.tick,
          carrierId: carrier ? carrier.id : null,
          carrierTeamId: carrier ? carrier.teamId : null,
          logicalOwnerId: carrier ? carrier.id : null,
          physicalSeparated: false,
          touchSequence,
          touchTick: touchBoundary ? snapshot.tick : previous.touchTick,
          nextTouchTick: carrier ? (touchBoundary ? snapshot.tick + cadenceTicks : previous.nextTouchTick) : 0,
          foot,
          contact: carrier ? 'instep-push' : null,
          contactPoint,
          targetSeparationMetres,
          lastSeparationMetres: targetSeparationMetres,
          maxSeparationMetres: targetSeparationMetres,
          surface: snapshot.dribbling.surface,
          pressure,
          consumedActionIds: previous.consumedActionIds,
          consumedActionHighWaterTick: previous.consumedActionHighWaterTick,
          consumedActionIdsAtHighWater: previous.consumedActionIdsAtHighWater,
          outcome: carrier ? 'controlled-carry' : 'controlled-carry-loose',
          previousCarrierId: carrier && previous.carrierId && previous.carrierId !== carrier.id
            ? previous.carrierId : previous.previousCarrierId
        });
        const telemetry = {
          schema: 'football-legacy-dribbling-telemetry-v2',
          version: dependencies.dribbling.VERSION,
          eventId: ['dribble-controlled-carry', resetEpoch, carrier ? carrier.id : 'none', touchSequence].join(':'),
          tick: snapshot.tick,
          epoch: resetEpoch,
          workflow: capability.workflow,
          phase: state.phase,
          animationPhase: carrier ? 'dribble-secured' : 'idle',
          carrierId: state.carrierId,
          logicalOwnerId: state.logicalOwnerId,
          physicalSeparated: false,
          touchSequence: state.touchSequence,
          foot: state.foot,
          contact: state.contact,
          separationMetres: +state.lastSeparationMetres.toFixed(4),
          maxSeparationMetres: +state.maxSeparationMetres.toFixed(4),
          targetSeparationMetres: +state.targetSeparationMetres.toFixed(4),
          pressure: +state.pressure.toFixed(4),
          nearestPressurePlayerId: nearestPressure && nearestPressure.id || null,
          surface: snapshot.dribbling.surface,
          quality: carrier ? { control, technique, agility, score: +qualityScore.toFixed(4) } : null,
          outcome: state.outcome,
          bufferedActionId: null,
          releasedActionId: null,
          physicsProfile: 'true-feel-controlled-carry',
          authorityMode: 'attached-controlled-carry',
          cadenceTicks,
          touchBoundary
        };
        const presentation = carrier ? {
          schema: 'football-legacy-dribbling-presentation-v2',
          phase: state.phase,
          animationPhase: 'dribble-secured',
          playerId: state.carrierId,
          previousCarrierId: state.previousCarrierId,
          foot: state.foot,
          contact: state.contact,
          contactPoint: clone(state.contactPoint),
          ballPosition: null,
          separationMetres: +state.lastSeparationMetres.toFixed(4),
          targetSeparationMetres: +state.targetSeparationMetres.toFixed(4),
          outcome: state.outcome,
          releasedAction: null,
          touchBoundary
        } : null;
        return {
          schema: dependencies.dribbling.RESULT_SCHEMA,
          version: dependencies.dribbling.VERSION,
          tick: snapshot.tick,
          epoch: resetEpoch,
          workflow: capability.workflow,
          online: false,
          state,
          serializedState: dependencies.dribbling.serializeState(state),
          ballState: dependencies.ball.cloneBallState(candidateBallState),
          logicalOwnerId: state.logicalOwnerId,
          physicalSeparated: false,
          releasedAction: null,
          authorityHandoff: null,
          telemetry,
          presentation
        };
      }
      const carrierId = !physicalPoke && activeLeaseAtStart && domain.dribblingState.logicalOwnerId
        ? String(domain.dribblingState.logicalOwnerId)
        : physicalPoke?null:logicalOwnerId;
      const movementCarrier = carrierId && movementState.players.find(player => player.id === carrierId);
      const liveCarrier = carrierId && snapshot.players.find(player => player.id === carrierId);
      const human = Boolean(carrierId && snapshot.humanPlayerIds.has(carrierId));
      const humanControl = human && liveCarrier && liveCarrier.control;
      const movementSpeed = movementCarrier ? vectorLength(movementCarrier.velocity) : 0;
      let actionIntent = null;
      if (activeLeaseAtStart && carrierId) {
        const hostAction = snapshot.dribbling.actionIntent;
        actionIntent = hostAction && (!hostAction.actorId || String(hostAction.actorId) === carrierId)
          ? { ...clone(hostAction), actorId: carrierId }
          : cpuDribblingAction(snapshot, intelligence, carrierId);
      }
      const cpuIntent = !human && carrierId && intelligence.projection.find(p => p.playerId === carrierId);
      const maneuver = cpuIntent && cpuIntent.maneuver;
      const result = dependencies.dribbling.resolve({
        schema: dependencies.dribbling.REQUEST_SCHEMA,
        workflow: capability.workflow,
        online: false,
        tick: snapshot.tick,
        epoch: resetEpoch,
        seed: deterministicSeed,
        fixedTickSeconds: FIXED_TICK_SECONDS,
        state:physicalPoke?dependencies.dribbling.createState({epoch:resetEpoch,consumedActionIds:domain.dribblingState.consumedActionIds,
          consumedActionHighWaterTick:domain.dribblingState.consumedActionHighWaterTick,consumedActionIdsAtHighWater:domain.dribblingState.consumedActionIdsAtHighWater}):domain.dribblingState,
        movementWorld: movementState,
        ballState: candidateBallState,
        roster: movementState.players.map(player => {
          const profile = snapshot.players.find(row => row.id === player.id), attrs = profile && profile.attrs || {};
          return {
            id: player.id,
            teamId: player.teamId,
            isGK: Boolean(profile && profile.isGK),
            sentOff: Boolean(profile && profile.sentOff),
            available: Boolean(profile && !profile.isGK && !profile.sentOff),
            contactEligible: Boolean(profile && profile.contactEligible),
            attributes: {
              control: finite(attrs.control, 70),
              technique: finite(attrs.technique, attrs.control || 70),
              agility: finite(attrs.agility, attrs.accel || attrs.acceleration || 70)
            }
          };
        }),
        logicalOwnerId: carrierId,
        carrierInput: {
          // Source is presentation/telemetry only. The resolver deliberately
          // applies one ratings-neutral physical model to both paths.
          source: human ? 'human' : 'cpu',
          direction: humanControl && humanControl.strength > 0.02
            ? { x: humanControl.x, y: humanControl.y }
            : movementCarrier && (movementSpeed > 0.05 ? movementCarrier.velocity : movementCarrier.facing),
          intensity: humanControl ? humanControl.strength : clamp(movementSpeed / 7.2, 0, 1),
          sprint: humanControl ? humanControl.sprint : Boolean(movementCarrier && movementCarrier.locomotionState === 'sprint'),
          shield: Boolean(humanControl ? humanControl.shield : maneuver && maneuver.type === 'protect'||
            !human&&movementCarrier?.control?.mode==='shield')
        },
        surface: snapshot.dribbling.surface,
        actionIntent,
        gate: { ...snapshot.contact.gate,
          // A protected animation belongs to its actor. A distant skill or
          // slide must not release another player's controlled ball/lease.
          specialActionAuthority: snapshot.dribbling.specialActionPlayerIds === null
            ? snapshot.contact.gate.specialActionAuthority
            : snapshot.dribbling.specialActionPlayerIds.includes(carrierId) }
      }, dribblingCapability);
      if (!result || result.schema !== dependencies.dribbling.RESULT_SCHEMA || result.version !== dependencies.dribbling.VERSION ||
          result.tick !== snapshot.tick || result.epoch !== resetEpoch || result.workflow !== capability.workflow || result.online !== false ||
          !dependencies.ball.isBallState(result.ballState) || !result.serializedState ||
          dependencies.dribbling.restoreState(result.serializedState).schema !== dependencies.dribbling.STATE_SCHEMA) {
        throw new Error('live Dribbling V2 result contract failed');
      }
      const released = result.releasedAction;
      if (authorityProfile.cpuPassRaceFilter && released?.source === 'cpu-v2' && released.type === 'pass' && released.delivery?.type !== 'clearance') {
        // A queued pass waits for an actual boot meeting. Its lane/receiver
        // promise can go stale during that touch, so validate the release from
        // the newly committed positions and ball, not the old queue frame.
        const players = snapshot.players.map(player => {
          const moved = movementState.players.find(p => p.id === player.id);
          return moved ? { ...player, ...livePoint(moved.position, snapshot),
            vx: moved.velocity.x * snapshot.units.xPerMetre / 60,
            vy: moved.velocity.y * snapshot.units.yPerMetre / 60,
            fx: moved.facing.x, fy: moved.facing.y } : player;
        });
        const releaseSnapshot = { ...snapshot, players,
          ball: { ...snapshot.ball, ...liveBall(result.ballState, snapshot), ownerId: carrierId } };
        const owner = players.find(p => p.id === carrierId);
        let intent = boundarySafeCpuPassIntent({ ...released.delivery,
          type: released.delivery?.type || 'pass', targetPlayerId: released.targetPlayerId,
          target: metricPoint(released.target, snapshot), confidence: released.power });
        intent=runnerRendezvousIntent(releaseSnapshot,owner,intent);
        let race = evaluateCpuPassRace(releaseSnapshot, owner, intent);
        if (!race.accepted) {
          const corrected = receiverFeetCorrection(releaseSnapshot, owner, intent, race);
          if (corrected) {
            const correctedRace = evaluateCpuPassRace(releaseSnapshot, owner, corrected);
            if (correctedRace.accepted) { intent = corrected; race = correctedRace; }
          }
        }
        const checked = race.accepted ? { ...released, target: livePoint(intent.target, snapshot),
          delivery: { ...released.delivery, passRace: race,
            releaseRecheck: { queuedTick: released.commandTick, checkedTick: snapshot.tick } } } : null;
        return { ...result, releasedAction: checked,
          telemetry: { ...result.telemetry, releasedActionId: checked?.id || null,
            releasePassRecheck: { accepted: race.accepted, reason: race.reason } },
          presentation: { ...result.presentation, releasedAction: checked } };
      }
      return result;
    }
    function planTick(rawSnapshot) {
      if (!enabled) return null;
      try {
        if (activePrepared) {
          const previous = privatePrepared.get(activePrepared);
          if (!previous || !previous.finalized || previous.rolledBack || previous.aborted) {
            throw new Error('live V2 prepared tick remains unresolved');
          }
          previous.sealed = true;
          privatePrepared.delete(activePrepared);
          activePrepared = null;
        }
        const snapshot = normalizeSnapshot(rawSnapshot, capability.workflow);
        const expectedTick = lastCommittedTick < 0 ? 1 : lastCommittedTick + 1;
        if (snapshot.tick !== expectedTick) throw new RangeError('live V2 snapshot tick must be exactly sequential');
        const activeLeaseAtStart = hasPhysicalDribblingLease(domain.dribblingState);
        const leaseOwnerId = activeLeaseAtStart ? String(domain.dribblingState.logicalOwnerId) : null;
        // The carrier retains action and decision authority during a short
        // physical touch lease. The physical snapshot remains ownerless below;
        // only this control snapshot carries the logical owner.
        const controlSnapshot = leaseOwnerId
          ? { ...snapshot, ball: { ...snapshot.ball, ownerId: leaseOwnerId } }
          : snapshot;
        const possession = derivePossession(controlSnapshot), phaseState = phaseAuthority(controlSnapshot, possession);
        const formations = formationOutputs(controlSnapshot, phaseState, possession), cpu = cpuOutputs(controlSnapshot, formations, possession);
        let cpuRejectedPassCommitments = { you: null, opp: null };
        if (authorityProfile.cpuPassRaceFilter) {
          const gated = gatedCpuOutputs(controlSnapshot, cpu.outputs);
          cpu.outputs = gated.outputs;
          cpuRejectedPassCommitments = gated.commitments;
        }
        const currentMovement = movementWorld(controlSnapshot), commands = movementCommands(controlSnapshot, currentMovement.world, formations, cpu.outputs, possession);
        const physicalBall={...metricBall(snapshot.ball,snapshot),radius:.11};
        const movement = dependencies.movement.advance(currentMovement.world, commands.commands, 1, LIVE_MOVEMENT_CONTACT_CONFIG,physicalBall);
        // A proposed input is a reservation, not an executed challenge.
        // Only an acknowledged action consumes the existing cooldown.
        for(const team of snapshot.teams)for(const intent of cpu.outputs[team.id].defensiveIntents||[]){
          const read=intent.physicalAction;if(!read||read.issuedTick!==snapshot.tick)continue;
          const entered=movement.telemetry.actions.some(a=>a.type==='action-window-entered'&&a.playerId===intent.playerId&&a.action===read.type);
          if(!entered){cpu.memories[team.id]=clone(cpu.memories[team.id]);const prior=domain.cpuMemories[team.id]?.defense?.cooldowns?.[intent.playerId];
            if(prior>snapshot.tick)cpu.memories[team.id].defense.cooldowns[intent.playerId]=prior;
            else delete cpu.memories[team.id].defense.cooldowns[intent.playerId];}
        }
        const physicalPoke=movement.telemetry.pokes?.[0]||null;
        const movementProjection = movement.state.players.map(player => {
          const position = livePoint(player.position, snapshot), velocity = liveVelocity(player.velocity, snapshot);
          return { id: player.id, x: position.x, y: position.y, vx: velocity.x, vy: velocity.y, fx: player.facing.x, fy: player.facing.y,
            stamina: player.stamina, locomotionState: player.locomotionState, visibleAction: player.visibleAction, action: player.action ? clone(player.action) : null };
        });
        const labLocomotion = typeof globalThis !== 'undefined' && globalThis.__dartyLabLocomotion;
        if (labLocomotion) {
          for (const player of movementProjection) {
            const state = String(player.locomotionState || 'unknown');
            labLocomotion[state] = (labLocomotion[state] || 0) + 1;
          }
        }
        const intelligence = intelligenceProjection(controlSnapshot, cpu.outputs);
        const movementOwnerId = movement.state.ballOwnerId == null ? null : String(movement.state.ballOwnerId);
        const snapshotOwner = controlSnapshot.ball.ownerId && snapshot.players.find(player => player.id === controlSnapshot.ball.ownerId);
        let effectiveOwnerId = physicalPoke?null:leaseOwnerId || ((movementOwnerId || snapshotOwner && snapshotOwner.isGK)
          ? movementOwnerId || snapshotOwner.id : null);
        let postMovementPossession = effectiveOwnerId ? (() => {
          const owner = snapshot.players.find(player => player.id === effectiveOwnerId);
          return { teamId: owner.teamId, ownerId: owner.id, inFlight: false,
            intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
            releaseTick: null, reactionStimulus: null, offsideCandidate: null };
        })() : snapshotOwner && !snapshotOwner.isGK
          // Movement explicitly returned no owner for an outfield-owned ball:
          // respect that loss instead of silently preserving pre-tick ownership.
          ? { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null }
          : possession;
        const ballSnapshot = {
          ...controlSnapshot,
          ball: { ...snapshot.ball, ownerId: activeLeaseAtStart ? null : effectiveOwnerId }
        };
        // Ball V2 sees the post-Movement owner. A loose ball claimed by a
        // tackle can therefore never be integrated again in the same tick.
        const plannedBall = ballPlan(ballSnapshot);
        if(physicalPoke&&plannedBall.stagedState){
          // The real boot has won this contact. Use the existing Ball launch
          // API at the ball's actual position, as the shared human slide poke
          // does. No remote capture or ball/player repositioning occurs.
          const incoming=plannedBall.stagedState,
            poke=dependencies.ball.resolveLaunch({id:'physical-poke:'+resetEpoch+':'+physicalPoke.commandId,
              origin:incoming.position,direction:physicalPoke.direction,speed:3.5*60/snapshot.units.zPerMetre,
              liftAngleDeg:0,source:'tackle-poke',metadata:{...incoming.metadata,physicalChallenge:true,sourcePlayerId:physicalPoke.actorId}}),
            state=dependencies.ball.createBallState({...poke.state,simulationTime:incoming.simulationTime,lastOuterTick:snapshot.tick,
              contactCount:incoming.contactCount+1,lastContact:{colliderId:physicalPoke.actorId,materialId:'physical-boot',tick:snapshot.tick}});
          plannedBall.stagedState=state;plannedBall.projection=liveBall(state,snapshot);plannedBall.stagedProjection=clone(plannedBall.projection);
        }
        const receiverId = possession.intendedReceiverId || snapshot.contact.intendedReceiverId;
        const receiver = receiverId && movement.state.players.find(p => p.id === receiverId);
        if (receiver && !snapshot.ball.ownerId && !snapshot.dribbling.directionalKnockOnIntent) {
          const human = snapshot.humanPlayerIds.has(receiverId);
          const profile = snapshot.players.find(p => p.id === receiverId);
          const control = profile.control;
          if (!human && !snapshot.contact.firstTouchIntent) {
            const team = snapshot.teams.find(t => t.id === profile.teamId);
            const combination = cpu.memories[profile.teamId].combination.move;
            // The scored firstTimeIntent owns immediate combination passes
            // through the shared MR race at physical contact. An unscored
            // two-metre layoff here could instead knock the ball backwards
            // while the return runner was already departing.
            snapshot.contact.firstTouchIntent = { ...dependencies.dribbling.receivingIntent({ player: {
              ...receiver, attributes: { control: profile.attrs.control, agility: profile.attrs.agility } },
              opponents: movement.state.players.filter(p => p.teamId !== receiver.teamId),
              attackingDirection: team.attackingDirection, bounds: METRIC_PITCH,
              direction: human ? { x: control.x, y: control.y } : null, sprint: Boolean(human && control.sprint), combinationTarget: null,
              combination: Boolean(!human && combination && combination.linkId === receiverId), cpu: true }), source: 'cpu-v2' };
          }
        }
        const contactResult = activeLeaseAtStart||physicalPoke ? null : contactPlan(ballSnapshot, movement.state, plannedBall, possession, cpu.outputs, commands.aerialFlight);
        const contact = contactResult;
        let stagedWorld = movement.state;
        let stagedBallState = plannedBall.stagedState;
        let stagedBallProjection = plannedBall.stagedProjection;
        let hostBallProjection = plannedBall.projection;
        if (contact) {
          stagedBallState = contact.ballState;
          stagedBallProjection = contact.ownedContact && contact.ownerCandidateId
            ? null : liveBall(contact.ballState, snapshot);
          hostBallProjection = stagedBallProjection && clone(stagedBallProjection);
          let contactOwner = null;
          if (contact.ownedContact && contact.ownerCandidateId) {
            const owner = snapshot.players.find(player => player.id === contact.ownerCandidateId);
            if (!owner || owner.isGK || owner.sentOff) throw new Error('live contact owner candidate is ineligible');
            contactOwner = owner;
            effectiveOwnerId = owner.id;
            postMovementPossession = {
              teamId: owner.teamId,
              ownerId: owner.id,
              inFlight: false,
              intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
              releaseTick: null, reactionStimulus: null,
              offsideCandidate: null
            };
          }
          const contactActorId = String(contact.presentation && contact.presentation.playerId ||
            contact.ballState && contact.ballState.lastContact && contact.ballState.lastContact.colliderId || '');
          const contactActor = contactActorId && snapshot.players.find(player => player.id === contactActorId);
          const firstTimePass = contact.presentation && contact.presentation.firstTimePass;
          if (firstTimePass) {
            const target = livePoint(firstTimePass.target, snapshot);
            postMovementPossession = { teamId: firstTimePass.sourceTeamId, ownerId: null, inFlight: true,
              intendedReceiverId: firstTimePass.targetPlayerId, intendedTarget: target,
              intendedTargetWindowMetres: firstTimePass.passRace.targetWindowMetres,
              arrivalWindowEntered: false, releaseTick: snapshot.tick, reactionStimulus: null,
              sourcePlayerId: contact.presentation.playerId, deliberatePass: true, offsideCandidate: null };
          } else if (!contactOwner && contact.ownedContact && contact.contactType === 'aerial-volley') {
            postMovementPossession = { teamId: null, ownerId: null, inFlight: false,
              intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null,
              arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null };
          } else if (!contactOwner && possession.inFlight && contact.contactType === 'involuntary-deflection' && contactActor) {
            // A real MR body ricochet ends the now-invalid authored rendezvous
            // for either team, while retaining the original kick's offside
            // provenance because an involuntary deflection is not deliberate.
            postMovementPossession = {
              teamId: null,
              ownerId: null,
              inFlight: false,
              intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null,
              arrivalWindowEntered: false, releaseTick: null, sourcePlayerId: null, deliberatePass: false,
              reactionStimulus: clone(possession.reactionStimulus || {
                releaseTick: possession.releaseTick,
                sourcePlayerId: possession.sourcePlayerId,
                sourceTeamId: possession.teamId
              }),
              offsideCandidate: clone(possession.offsideCandidate || null)
            };
          } else if (!contactOwner && contact.ownedContact && possession.inFlight && contactActor && contactActor.teamId !== possession.teamId) {
            // A V2-retained opposition deflection also ends the old team's
            // pass route even if the Build 173 host has not yet reflected a
            // new lastKickerId. Ownership stays loose for the next arbitration.
            postMovementPossession = {
              teamId: null,
              ownerId: null,
              inFlight: false,
              intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null,
              arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null
            };
          }
          const activeReceivingTouch = contact.ownedContact && contact.contactType === 'first-touch' &&
            contact.receivingIntent && ['directional-touch', 'layoff'].includes(contact.receivingIntent.type) && contactActorId === receiverId;
          const humanDirectionalTouch = snapshot.humanPlayerIds.has(contactActorId) && contact.ownedContact &&
            snapshot.contact.firstTouchIntent && snapshot.contact.firstTouchIntent.type === 'directional-touch' && contact.presentation;
          const directionalTouchPlayerId = (humanDirectionalTouch || activeReceivingTouch) && contact.presentation
            ? String(contact.presentation.playerId || '') : '';
          if (activeReceivingTouch && !contactOwner && contactActor && !snapshot.humanPlayerIds.has(contactActor.id)) {
            // The authored pass has reached a boot. Chase the real exit ball;
            // its former rendezvous must no longer pin the receiver in place.
            const targetId = contact.receivingIntent.targetPlayerId || contactActor.id;
            postMovementPossession = { teamId: contactActor.teamId, ownerId: null, inFlight: true,
              intendedReceiverId: targetId, intendedTarget: null, intendedTargetWindowMetres: null,
              arrivalWindowEntered: true, releaseTick: null, reactionStimulus: null, offsideCandidate: null,
              deliberatePass: false, pendingTouch: { actorId: contactActor.id, targetId, untilTick: snapshot.tick + 90 } };
          }
          if (contactOwner || directionalTouchPlayerId) {
            const activeOwnerId = contactOwner ? contactOwner.id : stagedWorld.ballOwnerId;
            stagedWorld = dependencies.movement.createWorldState({
              tick: movement.state.tick,
              fixedTickSeconds: FIXED_TICK_SECONDS,
              bounds: movement.state.bounds,
              ballOwnerId: activeOwnerId,
              players: movement.state.players.map(player => {
                if (player.id !== directionalTouchPlayerId) return { ...player, hasBall: player.id === activeOwnerId };
                const profile = snapshot.players.find(row => row.id === player.id), attrs = profile && profile.attrs || {};
                const acceleration = clamp(finite(attrs.accel, attrs.pace || 70), 1, 99);
                return { ...player, hasBall: player.id === activeOwnerId,
                  touchBurstUntilTick: snapshot.tick + 2,
                  touchBurstAccelerationMultiplier: 1.04 + acceleration / 99 * 0.04 };
              })
            });
          }
        }
        const effectiveProfile = effectiveOwnerId && snapshot.players.find(player => player.id === effectiveOwnerId);
        const dribblingOwnerId = effectiveProfile && !effectiveProfile.isGK && !effectiveProfile.sentOff
          ? effectiveOwnerId : null;
        const candidateBallState = dependencies.ball.isBallState(stagedBallState)
          ? stagedBallState
          : controlledBallState(snapshot, dribblingOwnerId, contact && contact.ballState);
        const dribbling = dribblingPlan(controlSnapshot, stagedWorld, dribblingOwnerId,
          candidateBallState, intelligence, activeLeaseAtStart,physicalPoke);
        const dribblingRelevant = activeLeaseAtStart || dribblingOwnerId || domain.dribblingState.carrierId;
        if (dribblingRelevant) effectiveOwnerId = dribbling.logicalOwnerId;
        stagedBallState = dribbling.ballState;
        const physicalSeparated = dribbling.physicalSeparated === true;
        const projectedOwner = effectiveOwnerId && snapshot.players.find(player => player.id === effectiveOwnerId);
        if (effectiveOwnerId) {
          if (!projectedOwner || projectedOwner.sentOff || (dribblingRelevant && projectedOwner.isGK)) {
            throw new Error('Dribbling V2 returned an ineligible owner');
          }
          postMovementPossession = {
            teamId: projectedOwner.teamId,
            ownerId: projectedOwner.id,
            inFlight: false,
            intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
            releaseTick: null, reactionStimulus: null,
            offsideCandidate: null
          };
        } else if (!postMovementPossession.pendingTouch && ((!possession.inFlight && !possession.offsideCandidate && !possession.reactionStimulus) || activeLeaseAtStart)) {
          postMovementPossession = {
            teamId: null,
            ownerId: null,
            inFlight: false,
            intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false,
            releaseTick: null, reactionStimulus: null,
            offsideCandidate: null
          };
        }
        const stagedWorldOwnerId = effectiveOwnerId && stagedWorld.players.some(player => player.id === effectiveOwnerId)
          ? effectiveOwnerId : null;
        stagedWorld = dependencies.movement.createWorldState({
          tick: stagedWorld.tick,
          fixedTickSeconds: FIXED_TICK_SECONDS,
          bounds: stagedWorld.bounds,
          ballOwnerId: stagedWorldOwnerId,
          players: stagedWorld.players.map(player => ({ ...player, hasBall: player.id === stagedWorldOwnerId }))
        });
        hostBallProjection = physicalSeparated || !effectiveOwnerId ? liveBall(stagedBallState, snapshot) : null;
        stagedBallProjection = hostBallProjection && clone(hostBallProjection);
        const suppressedLeaseActions = new Set();
        if (activeLeaseAtStart && leaseOwnerId) suppressedLeaseActions.add(leaseOwnerId);
        if (dribbling.releasedAction && dribbling.releasedAction.actorId) suppressedLeaseActions.add(String(dribbling.releasedAction.actorId));
        const hostIntelligence = intelligence.projection.filter(intent =>
          !(suppressedLeaseActions.has(intent.playerId) && ['pass', 'shot', 'cross', 'clearance'].includes(intent.type)));
        const dribblingProjection = {
          // Contact deliberately does not arbitrate an active leased tick.
          // Its terminal handoff cannot invite a second host proximity catch.
          suppressLegacyReception: activeLeaseAtStart||Boolean(physicalPoke),
          schema: dribbling.schema,
          version: dribbling.version,
          phase: dribbling.state.phase,
          logicalOwnerId: dribbling.logicalOwnerId,
          physicalSeparated,
          bufferedAction: clone(dribbling.state.bufferedAction),
          releasedAction: clone(dribbling.releasedAction),
          authorityHandoff: clone(dribbling.authorityHandoff),
          serializedState: clone(dribbling.serializedState),
          telemetry: clone(dribbling.telemetry),
          presentation: clone(dribbling.presentation)
        };
        dribblingProjection.directionalKnockOn = snapshot.dribbling.directionalKnockOnIntent ? {
          active: plannedBall.directionalKnockOn && plannedBall.directionalKnockOn.active === true,
          bounded: plannedBall.directionalKnockOn && plannedBall.directionalKnockOn.bounded === true,
          playerId: snapshot.dribbling.directionalKnockOnIntent.playerId,
          launchSequence: snapshot.dribbling.directionalKnockOnIntent.launchSequence,
          authority: 'true-feel-magnus-reynolds-v2'
        } : null;
        let stagedTransition = phaseState.transition;
        if (domain.possession.teamId && postMovementPossession.teamId &&
            domain.possession.teamId !== postMovementPossession.teamId) {
          stagedTransition = {
            fromTeamId: domain.possession.teamId,
            toTeamId: postMovementPossession.teamId,
            startedTick: snapshot.tick,
            untilTick: snapshot.tick + 30
          };
        }
        const frame = {
          schema: 'football-legacy-live-v2-tick-frame', version: VERSION, planSequence: ++planSequence, snapshotTick: snapshot.tick,
          hostProjection: { snapshotTick: snapshot.tick, movement: movementProjection, intelligence: hostIntelligence,
            ball: hostBallProjection, contact: contact ? clone(contact) : null,blockAssignments:clone(commands.blockAssignments),
            movementTelemetry: clone(movement.telemetry), recoveryAssignments: clone(commands.recoveryAssignments), ballTrace: clone(plannedBall.trace),
            possession: clone(postMovementPossession), movementBallOwnerId: effectiveOwnerId, physicalChallengePoke:clone(physicalPoke),
            logicalBallOwnerId: effectiveOwnerId, physicalBallSeparated: physicalSeparated,
            dribbling: dribblingProjection,
            authorityCounters: { legacyOutfieldLocomotion: 0, legacyCpu: 0, legacyLooseBallIntegration: 0, candidateTicks: 1 } },
          staged: { world: stagedWorld, rosterSignature: currentMovement.signature, cpuMemories: cpu.memories,
            cpuRejectedPassCommitments: clone(cpuRejectedPassCommitments),blockFlight:clone(commands.blockFlight),
            ballState: stagedBallState, ballContext: plannedBall.stagedContext, lastBallProjection: stagedBallProjection,
            lastLaunchSequence: plannedBall.stagedLaunchSequence, lastTackleState: commands.stagedTackleState,
            lastCarrierEmission: intelligence.stagedCarrierEmission, possession: postMovementPossession, transition: stagedTransition,
            aerialFlight: contact && contact.ownedContact ? null : commands.aerialFlight,
            consumedFirstTouchIds: contact ? clone(contact.consumedFirstTouchIds) : domain.consumedFirstTouchIds,
            consumedFirstTouchThroughTick: contact ? contact.consumedFirstTouchThroughTick : domain.consumedFirstTouchThroughTick,
            consumedAerialIds: contact ? clone(contact.consumedAerialIds) : domain.consumedAerialIds,
            dribblingState: dependencies.dribbling.restoreState(dribbling.serializedState) },
          formation: formations, cpu: cpu.outputs, movementTelemetry: movement.telemetry, ballTrace: plannedBall.trace,
          contact, dribbling
        };
        const publicFrame = deepFreeze({
          schema: frame.schema, version: frame.version, planSequence: frame.planSequence, snapshotTick: frame.snapshotTick,
          hostProjection: clone(frame.hostProjection), formation: clone(frame.formation), cpu: clone(frame.cpu),
          movementTelemetry: clone(frame.movementTelemetry), ballTrace: clone(frame.ballTrace), contact: clone(frame.contact),
          dribbling: clone(frame.dribbling)
        });
        latestPlanSequence = frame.planSequence; issuedFrames.add(publicFrame); privateFrames.set(publicFrame, frame); return publicFrame;
      } catch (error) { freeze(error); return null; }
    }
    function validFrame(publicFrame) {
      const frame = publicFrame && privateFrames.get(publicFrame);
      if (!enabled || !frame || !issuedFrames.has(publicFrame) || consumedFrames.has(publicFrame) || frame.version !== VERSION ||
          frame.planSequence !== latestPlanSequence || frame.snapshotTick !== (lastCommittedTick < 0 ? 1 : lastCommittedTick + 1)) return null;
      return frame;
    }
    function prepareCommit(publicFrame) {
      const frame = validFrame(publicFrame);
      if (!frame || reservedFrames.has(publicFrame) || activePrepared) return null;
      reservedFrames.add(publicFrame);
      try {
        const transaction = host.prepareTick(clone(frame.hostProjection));
        if (!transaction || typeof transaction.commit !== 'function' || typeof transaction.rollback !== 'function') throw new Error('host tick transaction is invalid');
        const prepared = deepFreeze({
          schema: 'football-legacy-live-v2-prepared-tick', version: VERSION,
          planSequence: frame.planSequence, snapshotTick: frame.snapshotTick
        });
        const prior = {
          domain, lastCommittedTick, committedTicks, committedBallTicks, committedContactTicks,
          lastFormation, lastCpuDecision, latestTelemetry, lifecycle, failure
        };
        issuedPrepared.add(prepared);
        privatePrepared.set(prepared, { publicFrame, frame, transaction, prior, generation: attachmentGeneration, applied: false, finalized: false });
        activePrepared = prepared;
        return prepared;
      } catch (error) { freeze(error); return null; }
    }
    function preparedRecord(prepared) {
      const record = prepared && privatePrepared.get(prepared);
      if (!enabled || !record || !issuedPrepared.has(prepared) || record.generation !== attachmentGeneration ||
          record.rolledBack || record.aborted) return null;
      return record;
    }
    function applyPrepared(prepared) {
      const record = preparedRecord(prepared);
      if (!record || record.applied || record.finalized) return false;
      try {
        record.transaction.commit();
        record.applied = true;
        return true;
      } catch (error) {
        try { record.transaction.rollback(); } catch (_) {}
        record.rolledBack = true;
        consumedFrames.add(record.publicFrame);
        if (activePrepared === prepared) activePrepared = null;
        return freeze(error);
      }
    }
    function finalizePrepared(prepared) {
      const record = preparedRecord(prepared);
      if (!record || !record.applied || record.finalized) return false;
      const frame = record.frame;
      try {
        domain = frame.staged; lastCommittedTick = frame.snapshotTick; committedTicks += 1;
        if (frame.hostProjection.ball) committedBallTicks += 1;
        if (frame.contact && frame.contact.ownedContact) committedContactTicks += 1;
        lastFormation = Object.fromEntries(['you', 'opp'].map(teamId => [teamId, {
          formation: frame.formation[teamId].formation, phase: frame.formation[teamId].phase, phaseShape: frame.formation[teamId].phaseShape,
          targets: frame.formation[teamId].targets.map(row => ({ playerId: row.playerId, slotId: row.slotId, target: clone(row.target) })) }]));
        lastCpuDecision = Object.fromEntries(['you', 'opp'].map(teamId => [teamId, { tick: frame.cpu[teamId].tick,
          runs: clone(frame.cpu[teamId].runs),defensiveIntents:clone(frame.cpu[teamId].defensiveIntents), carrierIntent: clone(frame.cpu[teamId].carrierIntent) }]));
        latestTelemetry = { movement: clone(frame.movementTelemetry),blockAssignments:clone(frame.hostProjection.blockAssignments), recoveryAssignments: clone(frame.hostProjection.recoveryAssignments),
          ball: clone(frame.ballTrace), contact: clone(frame.contact), dribbling: clone(frame.dribbling.telemetry),
          possession: clone(domain.possession),
          formation: Object.fromEntries(['you', 'opp'].map(teamId => [teamId, clone(frame.formation[teamId].telemetry)])),
          cpu: Object.fromEntries(['you', 'opp'].map(teamId => [teamId, clone(frame.cpu[teamId].telemetry)])) };
        lifecycle = 'live'; consumedFrames.add(record.publicFrame); record.finalized = true; return true;
      } catch (error) {
        try { record.transaction.rollback(); } catch (_) {}
        Object.assign(record, { rolledBack: true });
        Object.assign(record.prior, {});
        domain = record.prior.domain; lastCommittedTick = record.prior.lastCommittedTick;
        committedTicks = record.prior.committedTicks; committedBallTicks = record.prior.committedBallTicks;
        committedContactTicks = record.prior.committedContactTicks; lastFormation = record.prior.lastFormation;
        lastCpuDecision = record.prior.lastCpuDecision; latestTelemetry = record.prior.latestTelemetry;
        lifecycle = record.prior.lifecycle; failure = record.prior.failure;
        consumedFrames.add(record.publicFrame);
        return freeze(error);
      }
    }
    function abortPrepared(prepared) {
      const record = preparedRecord(prepared);
      if (!record || record.applied || record.finalized) return false;
      try { record.transaction.rollback(); } catch (_) {}
      record.aborted = true;
      privatePrepared.delete(prepared);
      if (activePrepared === prepared) activePrepared = null;
      return true;
    }
    function rollbackPrepared(prepared, reason) {
      const record = prepared && privatePrepared.get(prepared);
      if (!record || !issuedPrepared.has(prepared) || record.generation !== attachmentGeneration ||
          record.rolledBack || record.aborted) return false;
      const expectedTick = record.finalized ? lastCommittedTick : (lastCommittedTick < 0 ? 1 : lastCommittedTick + 1);
      if (record.frame.snapshotTick !== expectedTick || record.frame.planSequence !== latestPlanSequence || record.sealed) return false;
      try { record.transaction.rollback(); } catch (_) {}
      if (record.finalized) {
        domain = record.prior.domain; lastCommittedTick = record.prior.lastCommittedTick;
        committedTicks = record.prior.committedTicks; committedBallTicks = record.prior.committedBallTicks;
        committedContactTicks = record.prior.committedContactTicks; lastFormation = record.prior.lastFormation;
        lastCpuDecision = record.prior.lastCpuDecision; latestTelemetry = record.prior.latestTelemetry;
        lifecycle = record.prior.lifecycle; failure = record.prior.failure;
      }
      record.rolledBack = true;
      consumedFrames.add(record.publicFrame);
      if (activePrepared === prepared) activePrepared = null;
      return freeze(reason || 'outer live V2 host transaction rolled back');
    }
    function commitTick(publicFrame) {
      const prepared = prepareCommit(publicFrame);
      if (!prepared || !applyPrepared(prepared)) return false;
      return finalizePrepared(prepared);
    }
    function reset(reason) {
      if (!enabled) return false;
      resetEpoch += 1; attachmentGeneration += 1; domain = freshDomain(); latestPlanSequence = ++planSequence; lastCommittedTick = -1;
      activePrepared = null;
      lastFormation = { you: null, opp: null }; lastCpuDecision = { you: null, opp: null }; latestTelemetry = null;
      lifecycle = 'armed'; failure = null;
      return { schema: 'football-legacy-live-v2-reset', version: VERSION, resetEpoch, reason: String(reason || 'build-173-restart-handoff') };
    }
    return Object.freeze({ schema: 'football-legacy-live-v2-attachment', version: VERSION, planTick, prepareCommit, applyPrepared,
      finalizePrepared, abortPrepared, rollbackPrepared, commitTick, reset, status, exportState, restoreState, planCpuDive, planOpenPlayChip, planKeeperExit, planRestartThrow, planRestartThrowSupport, planCpuKnockOn,
      disable: reason => freeze(reason || 'manual adapter freeze') });
  }

  return Object.freeze({
    VERSION, ACKNOWLEDGEMENT, SUPPORTED_WORKFLOWS, REQUIRED_DEPENDENCIES, DEPENDENCY_CONTRACTS,
    FIXED_TICK_SECONDS, METRIC_PITCH, TURNOVER_TACKLE_PROTECTION_TICKS,
    CPU_DECISION_PROFILES, LIVE_MOVEMENT_CONTACT_CONFIG,
    HUMAN_RECEPTION_GUIDANCE_MAX_DISTANCE_METRES, HUMAN_RECEPTION_GUIDANCE_STRONG_INPUT,
    HUMAN_RECEPTION_GUIDANCE_OPPOSING_DOT,
    ownedCarryPhase,ownedCarryAnchorPlan,keeperShotForecast, keeperDeflectionPlan, keeperOutgoingContactPlan, keeperPoseLocalSide, contactPoseApi, cpuPhysicalActionAllowed, cpuDifficultyConfig, stableHash, createCapability, createAttachment
  });
});
