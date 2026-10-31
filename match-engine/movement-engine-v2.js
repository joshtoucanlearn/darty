'use strict';

/*
 * Football Legacy deterministic movement/contact engine v2.
 *
 * Intentionally dormant: this module is not loaded or called by match.html.
 * It provides a pure fixed-tick candidate for shadow tests while Build 173
 * remains the sole live movement and contact authority.
 */
(function exposeMovementEngine(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyMovementEngineV2 = api;
})(typeof window === 'object' ? window : null, function createMovementEngineApi() {
  'use strict';

  const VERSION = '2.0.0-dormant';
  const PLAYER_SCHEMA = 'football-legacy-movement-player-v2';
  const WORLD_SCHEMA = 'football-legacy-movement-world-v2';
  const TELEMETRY_SCHEMA = 'football-legacy-movement-telemetry-v2';

  const DEFAULT_CONFIG = Object.freeze({
    fixedTickSeconds: 1 / 60,
    playerRadius: 0.36,
    baseMass: 76,
    walkSpeed: 2.2,
    runSpeedMinimum: 4.6,
    runSpeedMaximum: 6.25,
    sprintSpeedMinimum: 6.35,
    sprintSpeedMaximum: 9.15,
    jockeySpeedMinimum: 2.35,
    jockeySpeedMaximum: 3.7,
    shieldSpeedMinimum: 1.9,
    shieldSpeedMaximum: 3.1,
    shieldTurnRateMultiplier: 0.84,
    carrierRunSpeedPenaltyMinimum: 0.004,
    carrierRunSpeedPenaltyMaximum: 0.025,
    carrierSprintSpeedPenaltyMinimum: 0.008,
    carrierSprintSpeedPenaltyMaximum: 0.035,
    accelerationMinimum: 5.2,
    accelerationMaximum: 10.8,
    decelerationMinimum: 6.1,
    decelerationMaximum: 12.4,
    turnRateMinimum: 2.2,
    turnRateMaximum: 6.8,
    speedTurnInertia: 0.105,
    sprintStaminaDrainPerSecond: 8.2,
    runStaminaDrainPerSecond: 1.05,
    staminaRecoveryPerSecond: 5.1,
    lowStaminaThreshold: 30,
    minimumFatigueSpeedFactor: 0.72,
    tackleWindupTicks: 3,
    tackleContactTicks: 6,
    tackleRecoveryTicks: 12,
    tackleReach: 0.48,
    tackleLungeSpeed: 5.8,
    tackleAcceleration: 12.5,
    slideWindupTicks: 2,
    slideContactTicks: 10,
    slideRecoveryTicks: 30,
    slideReach: 0.78,
    slideLungeSpeed: 7.4,
    slideAcceleration: 15,
    shoulderWindupTicks: 1,
    shoulderContactTicks: 8,
    shoulderRecoveryTicks: 7,
    shoulderReach: 0.2,
    shoulderSpeed: 5.3,
    contactImpulse: 1.65,
    separationIterations: 3,
    separationSlop: 1e-6,
    maximumAdvanceTicks: 3600,
    safetyVelocityLimit: 20,
    safetyPositionLimit: 100000
  });

  const ROLE_PROFILES = Object.freeze({
    goalkeeper: Object.freeze({ speed: 0.91, acceleration: 0.94, turn: 0.92, mass: 1.05 }),
    defender: Object.freeze({ speed: 0.96, acceleration: 0.96, turn: 0.94, mass: 1.05 }),
    midfielder: Object.freeze({ speed: 1, acceleration: 1, turn: 1.02, mass: 1 }),
    winger: Object.freeze({ speed: 1.035, acceleration: 1.035, turn: 1.04, mass: 0.97 }),
    forward: Object.freeze({ speed: 1.015, acceleration: 1.02, turn: 1, mass: 1 })
  });

  const CONTEXT_MODES = Object.freeze(new Set(['idle', 'walk', 'run', 'sprint', 'jockey', 'shield']));

  function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function rounded(value, places) {
    const scale = 10 ** (places == null ? 6 : places);
    return Math.round(finite(value, 0) * scale) / scale;
  }

  function vector(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    return { x: finite(source.x, fallback.x), y: finite(source.y, fallback.y) };
  }

  function magnitude(value) {
    return Math.hypot(value.x, value.y);
  }

  function normalize(value, fallback) {
    const source = vector(value, fallback || { x: 1, y: 0 });
    const length = magnitude(source);
    if (length <= 1e-12) {
      const safe = vector(fallback, { x: 1, y: 0 });
      const safeLength = magnitude(safe) || 1;
      return { x: safe.x / safeLength, y: safe.y / safeLength };
    }
    return { x: source.x / length, y: source.y / length };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function cloneObject(value) {
    if (Array.isArray(value)) return value.map(cloneObject);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const key of Object.keys(value)) result[key] = cloneObject(value[key]);
    return result;
  }

  function configWith(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const config = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (Number.isFinite(source[key])) config[key] = Number(source[key]);
    }
    if (!(config.fixedTickSeconds > 0)) throw new RangeError('fixedTickSeconds must be positive');
    for (const key of ['tackleWindupTicks', 'tackleContactTicks', 'tackleRecoveryTicks',
      'slideWindupTicks', 'slideContactTicks', 'slideRecoveryTicks',
      'shoulderWindupTicks', 'shoulderContactTicks', 'shoulderRecoveryTicks',
      'separationIterations', 'maximumAdvanceTicks']) {
      if (!Number.isInteger(config[key]) || config[key] < 0) throw new RangeError(key + ' must be a non-negative integer');
    }
    // An accepted physical action must remain observable for at least one
    // authoritative tick in every phase. Zero-length overrides are therefore
    // treated as the smallest valid phase rather than allowing an acknowledged
    // tackle/challenge to disappear before its acknowledgement frame returns.
    for (const key of ['tackleWindupTicks', 'tackleContactTicks', 'tackleRecoveryTicks',
      'slideWindupTicks', 'slideContactTicks', 'slideRecoveryTicks',
      'shoulderWindupTicks', 'shoulderContactTicks', 'shoulderRecoveryTicks']) {
      config[key] = Math.max(1, config[key]);
    }
    for (const key of ['playerRadius', 'baseMass', 'runSpeedMinimum', 'runSpeedMaximum',
      'sprintSpeedMinimum', 'sprintSpeedMaximum', 'accelerationMinimum', 'accelerationMaximum',
      'decelerationMinimum', 'decelerationMaximum', 'turnRateMinimum', 'turnRateMaximum',
      'slideReach', 'slideLungeSpeed', 'slideAcceleration', 'safetyVelocityLimit', 'safetyPositionLimit']) {
      if (!(config[key] > 0)) throw new RangeError(key + ' must be positive');
    }
    if (!(config.shieldTurnRateMultiplier > 0)) throw new RangeError('shieldTurnRateMultiplier must be positive');
    for (const pair of [
      ['carrierRunSpeedPenaltyMinimum', 'carrierRunSpeedPenaltyMaximum'],
      ['carrierSprintSpeedPenaltyMinimum', 'carrierSprintSpeedPenaltyMaximum']
    ]) {
      const minimum = config[pair[0]], maximum = config[pair[1]];
      if (!(minimum >= 0 && maximum >= minimum && maximum < 0.2)) {
        throw new RangeError(pair.join('/') + ' must be an ordered fraction below 0.2');
      }
    }
    return config;
  }

  function roleFamily(value) {
    const label = String(value || 'midfielder').toLowerCase();
    if (/keeper|\bgk\b/.test(label)) return 'goalkeeper';
    if (/back|defender|\bcb\b|\blb\b|\brb\b/.test(label)) return 'defender';
    if (/winger|wide|\blw\b|\brw\b|\blm\b|\brm\b/.test(label)) return 'winger';
    if (/striker|forward|\bst\b|\bcf\b/.test(label)) return 'forward';
    return 'midfielder';
  }

  function attributes(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      pace: clamp(finite(source.pace, 70), 1, 99),
      acceleration: clamp(finite(source.acceleration, source.pace || 70), 1, 99),
      agility: clamp(finite(source.agility, 70), 1, 99),
      balance: clamp(finite(source.balance, 70), 1, 99),
      strength: clamp(finite(source.strength, 70), 1, 99),
      stamina: clamp(finite(source.stamina, 75), 1, 99),
      defending: clamp(finite(source.defending, source.defend || 55), 1, 99),
      aggression: clamp(finite(source.aggression, 65), 1, 99),
      control: clamp(finite(source.control, 70), 1, 99)
    };
  }

  function createControl(value) {
    const source = value && typeof value === 'object' ? value : {};
    const requestedMode = String(source.mode || 'idle');
    return {
      commandId: source.commandId == null ? null : String(source.commandId),
      startTick: Number.isInteger(source.startTick) ? source.startTick : -1,
      untilTick: Number.isInteger(source.untilTick) ? source.untilTick : -1,
      move: vector(source.move, { x: 0, y: 0 }),
      facing: source.facing ? normalize(source.facing, { x: 1, y: 0 }) : null,
      intensity: clamp(finite(source.intensity, 0), 0, 1),
      mode: CONTEXT_MODES.has(requestedMode) ? requestedMode : 'idle',
      // Live human control may ask for a more responsive interpretation of
      // the same rated turn/deceleration model. The default remains exactly
      // one, so CPU and legacy callers retain their existing arithmetic.
      responsivenessMultiplier: clamp(finite(source.responsivenessMultiplier, 1), 1, 1.5),
      ...(source.directionalSteering===true?{directionalSteering:true}:{})
    };
  }

  function createAction(value) {
    if (!value || typeof value !== 'object') return null;
    const type = value.type === 'shoulder-challenge' ? 'shoulder-challenge' :
      value.type === 'slide-tackle' ? 'slide-tackle' : 'stand-tackle';
    return {
      commandId: String(value.commandId || type),
      type,
      targetId: value.targetId == null ? null : String(value.targetId),
      direction: normalize(value.direction, { x: 1, y: 0 }),
      startedTick: Number.isInteger(value.startedTick) ? value.startedTick : 0,
      contactStartTick: Number.isInteger(value.contactStartTick) ? value.contactStartTick : 0,
      contactEndTick: Number.isInteger(value.contactEndTick) ? value.contactEndTick : 0,
      recoveryEndTick: Number.isInteger(value.recoveryEndTick) ? value.recoveryEndTick : 0,
      acknowledged: value.acknowledged !== false,
      resolved: Boolean(value.resolved),
      outcome: value.outcome == null ? null : String(value.outcome),
      ...(Number.isFinite(value.firstBallContactTick)?{firstBallContactTick:value.firstBallContactTick}:{}),
      ...(value.bodyContactRecorded?{bodyContactRecorded:true}:{}),
      ...(value.ballWon?{ballWon:true}:{}),
      ...(value.closestBall?{closestBall:{...value.closestBall}}:{}),
      visible: value.visible !== false,
      ...(value.racePursuit===true&&type==='shoulder-challenge'?{racePursuit:true}:{})
    };
  }

  function createPlayerStateWithConfig(initial, config) {
    const source = initial && typeof initial === 'object' ? initial : {};
    if (typeof source.id !== 'string' || !source.id) throw new TypeError('player id is required');
    const role = typeof source.role === 'string' && source.role
      ? source.role
      : (typeof source.position === 'string' && source.position ? source.position : 'midfielder');
    const family = roleFamily(role);
    const profile = ROLE_PROFILES[family];
    const attrs = attributes(source.attributes || source.attrs || source);
    const facing = normalize(source.facing, magnitude(vector(source.velocity, { x: 0, y: 0 })) > 1e-9
      ? vector(source.velocity, { x: 1, y: 0 }) : { x: 1, y: 0 });
    const radius = clamp(finite(source.radius, config.playerRadius), 0.15, 1.2);
    const derivedMass = config.baseMass * profile.mass * (0.84 + attrs.strength / 99 * 0.32);
    return {
      schema: PLAYER_SCHEMA,
      id: source.id,
      teamId: String(source.teamId || 'team'),
      role,
      roleFamily: family,
      attributes: attrs,
      position: vector(source.position || source, { x: 0, y: 0 }),
      velocity: vector(source.velocity, { x: finite(source.vx, 0), y: finite(source.vy, 0) }),
      facing,
      radius,
      ...(source.contactRig?.schema==='physical-contact-rig-v2'?{contactRig:source.contactRig}:{}),
      ...(source.externalMotion?{externalMotion:true}:{}),...(source.bodyLow?{bodyLow:true}:{}),
      mass: clamp(finite(source.mass, derivedMass), 35, 140),
      stamina: clamp(finite(source.staminaLevel, source.stamina == null ? 100 : source.stamina), 0, 100),
      locomotionState: String(source.locomotionState || 'idle'),
      contextMode: CONTEXT_MODES.has(source.contextMode) ? source.contextMode : 'idle',
      visibleAction: Boolean(source.visibleAction),
      control: createControl(source.control),
      action: createAction(source.action),
      hasBall: Boolean(source.hasBall),
      skillProtection: source.skillProtection&&typeof source.skillProtection.defenderId==='string'?{defenderId:source.skillProtection.defenderId,multiplier:clamp(finite(source.skillProtection.multiplier,1),0,1)}:null,
      touchBurstUntilTick: Number.isInteger(source.touchBurstUntilTick) ? source.touchBurstUntilTick : -1,
      touchBurstAccelerationMultiplier: clamp(finite(source.touchBurstAccelerationMultiplier, 1), 1, 1.08),
      lastCommandAck: source.lastCommandAck ? cloneObject(source.lastCommandAck) : null,
      ...(source.lastBodyContactTick!==undefined?{lastBodyContactTick:finite(source.lastBodyContactTick,-100),lastBodyContactPeerId:String(source.lastBodyContactPeerId||'')}:{}),
      safetyCorrections: Math.max(0, Math.trunc(finite(source.safetyCorrections, 0)))
    };
  }

  function createPlayerState(initial, configOverrides) {
    return createPlayerStateWithConfig(initial, configWith(configOverrides));
  }

  function normalizeBounds(value) {
    const source = value && typeof value === 'object' ? value : {};
    const bounds = {
      xMin: finite(source.xMin, -52.5),
      xMax: finite(source.xMax, 52.5),
      yMin: finite(source.yMin, -34),
      yMax: finite(source.yMax, 34)
    };
    if (!(bounds.xMax > bounds.xMin) || !(bounds.yMax > bounds.yMin)) {
      throw new RangeError('world bounds must have positive width and height');
    }
    return bounds;
  }

  function createWorldStateWithConfig(initial, config) {
    const source = initial && typeof initial === 'object' ? initial : {};
    if (!Number.isInteger(source.tick) || source.tick < 0) {
      if (source.tick !== undefined) throw new TypeError('world tick must be a non-negative integer');
    }
    const fixedTickSeconds = finite(source.fixedTickSeconds, config.fixedTickSeconds);
    if (!(fixedTickSeconds > 0) || Math.abs(fixedTickSeconds - config.fixedTickSeconds) > 1e-12) {
      throw new RangeError('world fixedTickSeconds must match configured fixed tick');
    }
    const players = (Array.isArray(source.players) ? source.players : [])
      .map(player => createPlayerStateWithConfig(player, config));
    const ids = new Set();
    for (const player of players) {
      if (ids.has(player.id)) throw new TypeError('player ids must be unique');
      ids.add(player.id);
    }
    const ballOwnerId = source.ballOwnerId == null ? null : String(source.ballOwnerId);
    if (ballOwnerId && !ids.has(ballOwnerId)) throw new TypeError('ballOwnerId must reference a player');
    for (const player of players) player.hasBall = player.id === ballOwnerId;
    return {
      schema: WORLD_SCHEMA,
      tick: source.tick == null ? 0 : source.tick,
      fixedTickSeconds,
      bounds: normalizeBounds(source.bounds),
      ballOwnerId,
      players: players.sort((a, b) => a.id.localeCompare(b.id))
    };
  }

  function createWorldState(initial, configOverrides) {
    return createWorldStateWithConfig(initial, configWith(configOverrides));
  }

  function isCompleteWorldState(world) {
    if (!world || world.schema !== WORLD_SCHEMA || !Number.isInteger(world.tick) || !(world.fixedTickSeconds > 0) ||
      !Array.isArray(world.players)) return false;
    return world.players.every(player => player.schema === PLAYER_SCHEMA && typeof player.id === 'string' &&
      Number.isFinite(player.position.x) && Number.isFinite(player.position.y) &&
      Number.isFinite(player.velocity.x) && Number.isFinite(player.velocity.y) &&
      Number.isFinite(player.facing.x) && Number.isFinite(player.facing.y) &&
      Number.isFinite(player.stamina) && Number.isFinite(player.radius) && Number.isFinite(player.mass));
  }

  function normalizeCommand(value) {
    const source = value && typeof value === 'object' ? value : {};
    if (!Number.isInteger(source.tick) || source.tick < 0) throw new TypeError('every command requires an explicit non-negative integer tick');
    if (typeof source.playerId !== 'string' || !source.playerId) throw new TypeError('every command requires playerId');
    const type = String(source.type || 'move');
    if (!['move', 'stop', 'stand-tackle', 'slide-tackle', 'shoulder-challenge'].includes(type)) {
      throw new TypeError('unsupported movement command type: ' + type);
    }
    const requestedMode = source.sprint ? 'sprint' : String(source.mode || (type === 'move' ? 'run' : 'idle'));
    // Implicit identity must not depend on a command's array position: a replay
    // may provide the whole timeline while a live adapter provides one tick at
    // a time. Multiple commands of the same type for the same player and tick
    // require explicit IDs and are rejected by advance() as ambiguous.
    const implicitId = type + ':' + source.playerId + ':' + source.tick + ':0';
    return {
      id: String(source.id || implicitId),
      tick: source.tick,
      playerId: source.playerId,
      type,
      move: vector(source.move || source.direction, { x: 0, y: 0 }),
      direction: source.direction ? normalize(source.direction, { x: 1, y: 0 }) : null,
      facing: source.facing ? normalize(source.facing, { x: 1, y: 0 }) : null,
      intensity: clamp(finite(source.intensity, type === 'move' ? 1 : 0), 0, 1),
      mode: CONTEXT_MODES.has(requestedMode) ? requestedMode : 'run',
      responsivenessMultiplier: clamp(finite(source.responsivenessMultiplier, 1), 1, 1.5),
      ...(source.directionalSteering===true?{directionalSteering:true}:{}),
      ...(source.cancelAction===true?{cancelAction:true}:{}),
      durationTicks: Math.max(1, Math.trunc(finite(source.durationTicks, 1))),
      targetId: source.targetId == null ? null : String(source.targetId),
      ...(source.racePursuit===true&&type==='shoulder-challenge'?{racePursuit:true}:{})
    };
  }

  function actionPhase(action, tick) {
    if (!action) return null;
    if (tick < action.contactStartTick) return 'windup';
    if (tick < action.contactEndTick) return 'contact';
    if (tick < action.recoveryEndTick) return 'recovery';
    return 'complete';
  }

  function acknowledgeCommand(player, command, tick, config, telemetry) {
    const isPhysicalAction = ['stand-tackle', 'slide-tackle', 'shoulder-challenge'].includes(command.type);
    const currentPhase = actionPhase(player.action, tick);
    if (isPhysicalAction && player.action && currentPhase !== 'complete') {
      const rejection = {
        type: 'command-rejected', commandId: command.id, commandType: command.type,
        playerId: player.id, tick, accepted: false, reason: 'action-busy',
        activeCommandId: player.action.commandId
      };
      player.lastCommandAck = cloneObject(rejection);
      telemetry.commandAcks.push(rejection);
      telemetry.actions.push({
        type: command.type + '-rejected', commandId: command.id, playerId: player.id,
        tick, reason: 'action-busy', activeCommandId: player.action.commandId
      });
      return;
    }
    if (player.action && currentPhase === 'complete') {
      player.action = null;
      player.visibleAction = false;
    }
    const ack = {
      type: 'command-acknowledged', commandId: command.id, commandType: command.type,
      playerId: player.id, tick, accepted: true
    };
    player.lastCommandAck = cloneObject(ack);
    telemetry.commandAcks.push(ack);
    if (command.type === 'move') {
      player.control = createControl({
        commandId: command.id,
        startTick: tick,
        untilTick: tick + command.durationTicks - 1,
        move: command.move,
        facing: command.facing,
        intensity: command.intensity,
        mode: command.mode,
        responsivenessMultiplier: command.responsivenessMultiplier,
        directionalSteering: command.directionalSteering
      });
      return;
    }
    if (command.type === 'stop') {
      if(command.cancelAction){player.action=null;player.visibleAction=false;}
      player.control = createControl({ commandId: command.id, startTick: tick, untilTick: tick, mode: 'idle' });
      return;
    }
    if(command.racePursuit)player.control=createControl({commandId:command.id,startTick:tick,untilTick:tick+command.durationTicks-1,
      move:command.move,facing:command.facing,intensity:1,mode:'sprint',directionalSteering:command.directionalSteering});
    const tackle = command.type === 'stand-tackle', slide = command.type === 'slide-tackle';
    const windupTicks = slide ? config.slideWindupTicks : tackle ? config.tackleWindupTicks : config.shoulderWindupTicks;
    const contactTicks = slide ? config.slideContactTicks : tackle ? config.tackleContactTicks : config.shoulderContactTicks;
    const recoveryTicks = slide ? config.slideRecoveryTicks : tackle ? config.tackleRecoveryTicks : config.shoulderRecoveryTicks;
    const direction = command.direction || normalize(command.move, player.facing);
    player.action = createAction({
      commandId: command.id,
      type: command.type,
      targetId: command.targetId,
      direction,
      startedTick: tick,
      contactStartTick: tick + windupTicks,
      contactEndTick: tick + windupTicks + contactTicks,
      recoveryEndTick: tick + windupTicks + contactTicks + recoveryTicks,
      acknowledged: true,
      resolved: false,
      outcome: null,
      visible: true,
      ...(command.racePursuit?{racePursuit:true}:{})
    });
    player.visibleAction = true;
    player.locomotionState = command.type + '-windup';
    telemetry.actions.push({
      type: 'action-window-entered', commandId: command.id, action: command.type,
      playerId: player.id, tick, visible: true,
      contactStartTick: player.action.contactStartTick,
      contactEndTick: player.action.contactEndTick,
      recoveryEndTick: player.action.recoveryEndTick
    });
  }

  function rotateToward(current, desired, maximumAngle) {
    const from = Math.atan2(current.y, current.x);
    const to = Math.atan2(desired.y, desired.x);
    let difference = to - from;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    const angle = from + clamp(difference, -maximumAngle, maximumAngle);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function attributeScale(value, minimum, maximum) {
    return minimum + (maximum - minimum) * clamp((value - 1) / 98, 0, 1);
  }

  function fatigueFactor(player, config) {
    if (player.stamina >= config.lowStaminaThreshold) return 1;
    const ratio = player.stamina / Math.max(1, config.lowStaminaThreshold);
    return config.minimumFatigueSpeedFactor + (1 - config.minimumFatigueSpeedFactor) * ratio;
  }

  function limitsFor(player, mode, config) {
    const profile = ROLE_PROFILES[player.roleFamily] || ROLE_PROFILES.midfielder;
    const fatigue = fatigueFactor(player, config);
    let speed;
    if (mode === 'sprint') speed = attributeScale(player.attributes.pace, config.sprintSpeedMinimum, config.sprintSpeedMaximum);
    else if (mode === 'jockey') speed = attributeScale(player.attributes.agility, config.jockeySpeedMinimum, config.jockeySpeedMaximum);
    else if (mode === 'shield') speed = attributeScale(player.attributes.balance, config.shieldSpeedMinimum, config.shieldSpeedMaximum);
    else if (mode === 'walk') speed = config.walkSpeed;
    else if (mode === 'idle') speed = 0;
    else speed = attributeScale(player.attributes.pace, config.runSpeedMinimum, config.runSpeedMaximum);
    if (player.hasBall && (mode === 'run' || mode === 'sprint')) {
      const technique = clamp((player.attributes.control - 1) / 98, 0, 1);
      const minimum = mode === 'sprint' ? config.carrierSprintSpeedPenaltyMinimum : config.carrierRunSpeedPenaltyMinimum;
      const maximum = mode === 'sprint' ? config.carrierSprintSpeedPenaltyMaximum : config.carrierRunSpeedPenaltyMaximum;
      speed *= 1 - (maximum + (minimum - maximum) * technique);
    }
    const acceleration = attributeScale(player.attributes.acceleration,
      config.accelerationMinimum, config.accelerationMaximum) * profile.acceleration * fatigue;
    const deceleration = attributeScale((player.attributes.agility + player.attributes.balance) / 2,
      config.decelerationMinimum, config.decelerationMaximum);
    const turnRate = attributeScale(player.attributes.agility,
      config.turnRateMinimum, config.turnRateMaximum) * profile.turn * (mode === 'jockey' ? 1.22 : mode === 'shield' ? config.shieldTurnRateMultiplier : 1);
    return {
      speed: speed * profile.speed * fatigue,
      acceleration,
      deceleration,
      turnRate
    };
  }

  function activeControl(player, tick) {
    if (player.control && player.control.untilTick >= tick) return player.control;
    return createControl({ mode: 'idle' });
  }

  function integratePlayer(player, tick, config) {
    if(player.externalMotion)return;
    const dt = config.fixedTickSeconds;
    const action = player.action;
    const phase = actionPhase(action, tick);
    if (phase === 'complete') {
      player.action = null;
      player.visibleAction = false;
    }
    const liveAction = player.action;
    const livePhase = actionPhase(liveAction, tick);
    const control = activeControl(player, tick);
    const rawMove = vector(control.move, { x: 0, y: 0 });
    const inputMagnitude = clamp(magnitude(rawMove), 0, 1) * control.intensity;
    let mode = inputMagnitude <= 1e-9 ? 'idle' : control.mode;
    let desiredDirection = inputMagnitude > 1e-9 ? normalize(rawMove, player.facing) : player.facing;
    let forcedSpeed = null;
    let forcedAcceleration = null;
    if (liveAction && !liveAction.racePursuit && livePhase !== 'complete') {
      mode = liveAction.type;
      desiredDirection = liveAction.direction;
      if (livePhase === 'windup') forcedSpeed = liveAction.type === 'slide-tackle' ? 1.5 : liveAction.type === 'stand-tackle' ? 1.2 : 2.2;
      else if (livePhase === 'contact') forcedSpeed = liveAction.type === 'slide-tackle'
        ? config.slideLungeSpeed : liveAction.type === 'stand-tackle' ? config.tackleLungeSpeed : config.shoulderSpeed;
      else forcedSpeed = 0;
      forcedAcceleration = liveAction.type === 'slide-tackle' ? config.slideAcceleration :
        liveAction.type === 'stand-tackle' ? config.tackleAcceleration : config.accelerationMaximum;
    }
    const contextualMode = CONTEXT_MODES.has(mode) ? mode : 'run';
    const limits = limitsFor(player, contextualMode, config);
    const speed = magnitude(player.velocity);
    const response = control.responsivenessMultiplier;
    const velocityDirection = speed > 1e-9 ? normalize(player.velocity, desiredDirection) : desiredDirection;
    const directionAlignment = dot(velocityDirection, desiredDirection);
    const facingAlignment = dot(player.facing, desiredDirection);
    // Live human steering is input-led. The old path first rotated the body
    // through speed inertia and then made velocity chase that rotating body,
    // effectively applying turn delay twice. Keep the body turn readable,
    // but resolve the requested velocity against the stick direction itself.
    // Urgent pursuit uses this same direction-based momentum resolution at
    // neutral responsiveness. It must brake/pivot towards the interception,
    // rather than chase a rotating body away from a ball it has overshot.
    const humanDirectionalSteering = (!liveAction||liveAction.racePursuit) && inputMagnitude > 1e-9 &&
      (response > 1||control.directionalSteering===true) &&
      (directionAlignment < 0.995 || facingAlignment < 0.995 ||
        control.facing && dot(control.facing,desiredDirection)<0.995);
    const turnSeverity = clamp((1 - directionAlignment) / 2, 0, 1);
    const ratedResponse = 1 + (response - 1) * clamp((1 - directionAlignment) / 0.3, 0, 1);
    // With no retained momentum there is nothing physical to preserve: a
    // human can plant and leave in the requested direction instead of taking
    // several frames of forward steps while the old facing slowly rotates.
    const maximumTurn = response > 1 && speed <= 0.25
      ? Math.PI
      : limits.turnRate / (1 + speed * config.speedTurnInertia * (humanDirectionalSteering ? 0.25 : 1)) * response * dt;
    // Facing and travel normally share the same input. A direction-led
    // receiving step can preserve an explicitly requested goal-facing body
    // while the same rated momentum model takes the player to the meeting.
    const facingDirection=humanDirectionalSteering&&control.facing?control.facing:desiredDirection;
    player.facing = rotateToward(player.facing, facingDirection, maximumTurn);
    const targetSpeed = forcedSpeed == null ? limits.speed * inputMagnitude : forcedSpeed;
    if (humanDirectionalSteering) {
      // Resolve the obsolete sideways/old-direction momentum separately from
      // acceleration along the new request. This produces a rated cut or
      // brake-and-go rather than a semicircular run, without teleporting the
      // player, raising their speed ceiling or snapping their facing.
      const along = dot(player.velocity, desiredDirection);
      const lateral = {
        x: player.velocity.x - desiredDirection.x * along,
        y: player.velocity.y - desiredDirection.y * along
      };
      const lateralLength = magnitude(lateral);
      const lateralRate = limits.deceleration * ratedResponse * (1.15 + turnSeverity * 0.65);
      const lateralScale = lateralLength <= 1e-12 ? 0 :
        Math.max(0, lateralLength - lateralRate * dt) / lateralLength;
      let nextAlong = along;
      const alongDifference = targetSpeed - along;
      if (Math.abs(alongDifference) > 1e-12) {
        const replacingOpposedMomentum = along < 0;
        const reducingAlong = alongDifference < 0;
        const alongRate = forcedAcceleration == null
          ? (replacingOpposedMomentum || reducingAlong
            ? limits.deceleration * ratedResponse * (1 + turnSeverity * 0.55)
            : limits.acceleration * ratedResponse)
          : forcedAcceleration;
        const maximumAlongDelta = alongRate * dt;
        nextAlong += clamp(alongDifference, -maximumAlongDelta, maximumAlongDelta);
      }
      player.velocity = {
        x: desiredDirection.x * nextAlong + lateral.x * lateralScale,
        y: desiredDirection.y * nextAlong + lateral.y * lateralScale
      };
    } else {
      const targetVelocity = { x: player.facing.x * targetSpeed, y: player.facing.y * targetSpeed };
      const delta = { x: targetVelocity.x - player.velocity.x, y: targetVelocity.y - player.velocity.y };
      const deltaLength = magnitude(delta);
      const braking = targetSpeed < speed || inputMagnitude <= 1e-9 || (liveAction && livePhase === 'recovery');
      const touchBurst = !braking && player.touchBurstUntilTick >= tick ? player.touchBurstAccelerationMultiplier : 1;
      const rate = forcedAcceleration == null ? (braking ? limits.deceleration : limits.acceleration * touchBurst) : forcedAcceleration;
      const maximumDelta = rate * dt;
      if (deltaLength > maximumDelta && deltaLength > 1e-12) {
        player.velocity.x += delta.x / deltaLength * maximumDelta;
        player.velocity.y += delta.y / deltaLength * maximumDelta;
      } else {
        player.velocity = targetVelocity;
      }
    }
    const velocityLimit = forcedSpeed == null ? Math.max(limits.speed, speed) : Math.max(forcedSpeed, speed);
    const nextSpeed = magnitude(player.velocity);
    if (nextSpeed > velocityLimit && nextSpeed > 1e-12) {
      player.velocity.x *= velocityLimit / nextSpeed;
      player.velocity.y *= velocityLimit / nextSpeed;
    }
    player.position.x += player.velocity.x * dt;
    player.position.y += player.velocity.y * dt;
    const sprinting = control.mode === 'sprint' && inputMagnitude > 0.15 && (!liveAction||liveAction.racePursuit);
    const running = control.mode === 'run' && inputMagnitude > 0.35 && (!liveAction||liveAction.racePursuit);
    if (sprinting) {
      const resilience = 1.18 - player.attributes.stamina / 99 * 0.36;
      player.stamina = clamp(player.stamina - config.sprintStaminaDrainPerSecond * resilience * dt, 0, 100);
    } else if (running) {
      player.stamina = clamp(player.stamina - config.runStaminaDrainPerSecond * dt, 0, 100);
    } else if (!liveAction || livePhase === 'recovery') {
      const recoveryScale = 0.75 + player.attributes.stamina / 99 * 0.35;
      player.stamina = clamp(player.stamina + config.staminaRecoveryPerSecond * recoveryScale * dt, 0, 100);
    }
    if (liveAction) {
      player.visibleAction = true;
      player.locomotionState = liveAction.racePursuit?contextualMode:liveAction.type + '-' + livePhase;
    } else {
      player.visibleAction = false;
      player.contextMode = contextualMode;
      player.locomotionState = contextualMode;
    }
  }

  // Prepared for step7 only. Do not install until the defending ten completes.
  // Model coordinates and joint rotations come from the existing player rig.
  // The renderer and contact geometry consume this one pose; no second reach.
  function fillChallengePose(type,progress,side,out) {
    const q=clamp(progress,0,1),lead=side<0?-1:1;
    out.rootPitch=0;out.rootRoll=0;out.rootLift=0;out.pelvisPivot=false;out.verticalShift=0;out.forwardShift=0;
    out.leftHip=0;out.rightHip=0;out.leftKnee=-.08;out.rightKnee=-.08;
    out.leftArm=-.04;out.rightArm=-.04;out.torsoPitch=0;out.headPitch=0;out.leftFoot=0;out.rightFoot=0;
    if(type==='slide-tackle'){
      const drop=clamp(q/.24,0,1),skid=clamp((q-.08)/.72,0,1),recover=clamp((q-.76)/.24,0,1),
        leadingHip=-.18-skid*.26+recover*.38,leadingKnee=-.12-skid*.18,
        trailingHip=-1.16+recover*.58,
        // Fold the trailing shin back above the turf; the old negative bend
        // drove its boot through the grass once the body became horizontal.
        trailingKnee=-.08+drop*1.68-recover*.7;
      out.rootPitch=.58+drop*.92-recover*.30;out.rootRoll=-lead*Math.sin(q*Math.PI)*.08;
      out.rootLift=7-drop*3.4+recover*1.4;out.pelvisPivot=true;
      out.leftHip=lead>0?trailingHip:leadingHip;out.rightHip=lead>0?leadingHip:trailingHip;
      out.leftKnee=lead>0?trailingKnee:leadingKnee;out.rightKnee=lead>0?leadingKnee:trailingKnee;
      out.leftFoot=-out.rootPitch-out.leftHip-out.leftKnee;out.rightFoot=-out.rootPitch-out.rightHip-out.rightKnee;
      out.leftArm=-.70-skid*.26;out.rightArm=-1.02+skid*.18;
      out.torsoPitch=-drop*.18;out.headPitch=.16*drop;
    }else if(type==='stand-tackle'){
      const jab=Math.sin(q*Math.PI);out.rootPitch=-.18*jab;
      out.rightHip=.98*jab;out.rightKnee=-.16-.85*jab;out.leftHip=-.20*jab;out.leftKnee=-.08-.65*jab;
      out.leftFoot=-out.rootPitch-out.leftHip-out.leftKnee;out.rightFoot=-out.rootPitch-out.rightHip-out.rightKnee;
      out.leftArm=.55*jab;out.rightArm=-.75*jab;
    }else{
      const lean=Math.sin(q*Math.PI);out.rootPitch=-.18*lean;out.rootRoll=-.12*lean;
      out.rightHip=.56*lean;out.leftHip=-.36*lean;out.rightArm=-1.20*lean;
    }
    return out;
  }

  // Exact FK of hip -> knee -> foot -> toe in playerMesh. Scalars and a
  // caller-owned result avoid new vectors/configuration in near-pair queries.
  function fillChallengeFoot(rig,pose,side,toe,headingX,headingY,out) {
    const leg=rig.legLength,hipAngle=side<0?pose.leftHip:pose.rightHip,
      kneeAngle=side<0?pose.leftKnee:pose.rightKnee,
      footAngle=side<0?pose.leftFoot:pose.rightFoot,
      footY=toe===-1?0:-9.90-(leg-1)*10+(toe===true?4.12*Math.sin(footAngle):0),footZ=toe===-1?0:-.76-(toe===true?4.12*Math.cos(footAngle):0),
      ck=Math.cos(kneeAngle),sk=Math.sin(kneeAngle),
      ky=-13.82-(leg-1)*5+footY*ck-footZ*sk,kz=footY*sk+footZ*ck,
      cz=Math.cos(-side*.018),sz=Math.sin(-side*.018),
      hx=side*2.66*rig.stanceHip-ky*sz,
      hy=24.55+(leg-1)*17+ky*cz*Math.cos(hipAngle)-kz*Math.sin(hipAngle),
      hz=ky*cz*Math.sin(hipAngle)+kz*Math.cos(hipAngle),
      x=hx*rig.scale,y=hy*rig.scale*rig.heightScale,z=hz*rig.scale,
      cr=Math.cos(pose.rootRoll),sr=Math.sin(pose.rootRoll),
      rolledX=x*cr-y*sr,rolledY=x*sr+y*cr,
      cp=Math.cos(pose.rootPitch),sp=Math.sin(pose.rootPitch),
      pitchedY=rolledY*cp-z*sp,pitchedZ=rolledY*sp+z*cp,
      // The player looks down local -Z. Express the exact rig point in the
      // same heading used by Movement, preserving finite zero components.
      worldX=-headingY*rolledX-headingX*pitchedZ,
      worldY=headingX*rolledX-headingY*pitchedZ;
    out.x=(worldX+headingX*(pose.forwardShift||0))/rig.xPerMetre;
    out.y=(worldY+headingY*(pose.forwardShift||0))/rig.yPerMetre;
    out.z=(pitchedY+(pose.verticalShift??pose.rootLift))/rig.zPerMetre;
    return out;
  }

  // Supply the same rig profile and reusable foot scratch to physics/render.
  // This is presentation anchoring, not a player/ball teleport.
  function groundChallengePose(rig,pose,progress,scratch){
    pose.verticalShift=pose.rootLift;pose.forwardShift=0;
    if(pose.pelvisPivot)pose.forwardShift=(24.55+(rig.legLength-1)*17)*rig.scale*rig.heightScale*
      Math.sin(pose.rootPitch)*clamp(progress/.24,0,1);
    let minimum=Infinity;
    fillChallengeFoot(rig,pose,-1,false,1,0,scratch);minimum=Math.min(minimum,scratch.z);
    fillChallengeFoot(rig,pose,-1,true,1,0,scratch);minimum=Math.min(minimum,scratch.z);
    fillChallengeFoot(rig,pose,1,false,1,0,scratch);minimum=Math.min(minimum,scratch.z);
    fillChallengeFoot(rig,pose,1,true,1,0,scratch);minimum=Math.min(minimum,scratch.z);
    pose.verticalShift+=(.08-minimum)*rig.zPerMetre;
    return pose;
  }
  const CONTACT_RIG_SHAPES=Object.freeze([
    Object.freeze({legLength:1,stanceHip:1,shoulder:1}),Object.freeze({legLength:.98,stanceHip:1.08*1.06,shoulder:1.10}),
    Object.freeze({legLength:1.04,stanceHip:.94*.93,shoulder:.96}),Object.freeze({legLength:.95,stanceHip:1.10*1.09,shoulder:1.08}),
    Object.freeze({legLength:1.08,stanceHip:.98*.94,shoulder:.99})]);
  function createContactRig(input={}){
    const a=input.appearance||{},index=Math.max(0,Math.trunc(finite(a.bodyIndex,0)))%5,shape=CONTACT_RIG_SHAPES[index],
      scale=(.948+index*.012+(finite(input.number,1)%3)*.006)*1.06,
      heightScale=Number.isFinite(a.heightCm)?clamp(a.heightCm/180,.90,1.12):[.95,.97,.985,1,1.02,1.04,1.055][Math.max(0,Math.trunc(finite(a.heightIndex,3)))%7],
      units=input.units||{},xPerMetre=finite(units.xPerMetre,30.247619047619),yPerMetre=finite(units.yPerMetre,31.5),zPerMetre=finite(units.zPerMetre,31.323529411765);
    return Object.freeze({schema:'physical-contact-rig-v2',legLength:shape.legLength,stanceHip:shape.stanceHip,
      scale,heightScale,xPerMetre,yPerMetre,zPerMetre,
      bodyRadiusM:7.5*shape.shoulder*scale/Math.sqrt(xPerMetre*yPerMetre),heightM:55.5*scale*heightScale/zPerMetre,shoulder:shape.shoulder,armLength:[1,.98,1.04,.95,1.07][index]});
  }
  // Shared anatomical reach: real shoulder/elbow/fingertip lengths, no limb
  // scaling and no movement of the ball. Output is reusable by the renderer.
  function keeperQuaternionFromTo(ax,ay,az,bx,by,bz,out){
    const al=Math.hypot(ax,ay,az)||1,bl=Math.hypot(bx,by,bz)||1;
    ax/=al;ay/=al;az/=al;bx/=bl;by/=bl;bz/=bl;
    let x=ay*bz-az*by,y=az*bx-ax*bz,z=ax*by-ay*bx,w=1+ax*bx+ay*by+az*bz;
    if(w<1e-9){x=Math.abs(ax)>.9?-ay:0;y=Math.abs(ax)>.9?ax:-az;z=Math.abs(ax)>.9?0:ay;w=0;}
    const l=Math.hypot(x,y,z,w)||1;out[0]=x/l;out[1]=y/l;out[2]=z/l;out[3]=w/l;return out;
  }
  function keeperRotate(q,x,y,z,out,inverse=false){
    const sign=inverse?-1:1,qx=q[0]*sign,qy=q[1]*sign,qz=q[2]*sign,qw=q[3],
      ix=qw*x+qy*z-qz*y,iy=qw*y+qz*x-qx*z,iz=qw*z+qx*y-qy*x,iw=-qx*x-qy*y-qz*z;
    out[0]=ix*qw-iw*qx-iy*qz+iz*qy;out[1]=iy*qw-iw*qy-iz*qx+ix*qz;out[2]=iz*qw-iw*qz-ix*qy+iy*qx;return out;
  }
  function keeperReachPose(rig,target,yaw,progress=1,out={}){
    if(!out.root){out.root=[0,0,0,1];out.left=[0,0,0,1];out.right=[0,0,0,1];out.leftElbow=[0,0,0,1];out.rightElbow=[0,0,0,1];out.v=[0,0,0];out.q=[0,0,0,1];out.hand=[0,0,0];}
    const blend=clamp(progress,0,1),height=Math.max(0,target.z),rootY=(.28+Math.min(.55,height/rig.zPerMetre*.30))*rig.zPerMetre*blend,
      cy=Math.cos(yaw/2),sy=Math.sin(yaw/2),q=out.q;
    keeperQuaternionFromTo(0,1,0,target.x,height-rootY,target.y,q);
    // slerp upright -> full extension, then compose the actual facing yaw.
    const angle=Math.acos(clamp(q[3],-1,1)),sn=Math.sin(angle),factor=sn>1e-8?Math.sin(angle*blend)/sn:blend,
      x=q[0]*factor,y=q[1]*factor,z=q[2]*factor,w=Math.cos(angle*blend),r=out.root;
    r[0]=x*cy-z*sy;r[1]=w*sy+y*cy;r[2]=z*cy+x*sy;r[3]=w*cy-y*sy;
    out.rootY=rootY;
    keeperRotate(r,target.x,height-rootY,target.y,out.v,true);
    const tx=out.v[0]/rig.scale,ty=out.v[1]/(rig.scale*rig.heightScale),tz=out.v[2]/rig.scale,
      arm=rig.armLength||1,upper=13.05+(arm-1)*4.4,lowerY=-10.05-(arm-1)*4,lowerZ=-.10,
      lower=Math.hypot(lowerY,lowerZ),shoulderY=40.50+(rig.legLength-1)*17;
    out.gapMetres=Infinity;
    for(let side=-1;side<=1;side+=2){
      const shoulderX=side*5.72*(rig.shoulder||1),dx=tx-shoulderX,dy=ty-shoulderY,dz=tz-.10,
        distance=Math.hypot(dx,dy,dz)||1,length=clamp(distance,Math.abs(upper-lower)+.001,upper+lower-.001),
        nx=dx/distance,ny=dy/distance,nz=dz/distance,
        // Elbows bend behind the reach, in the real joint's flexion plane.
        dot=nz,px=-nx*dot,py=-ny*dot,pz=1-nz*dot,pl=Math.hypot(px,py,pz)||1,
        a=clamp((upper*upper-lower*lower+length*length)/(2*Math.max(.01,length)),-upper,upper),
        h=Math.sqrt(Math.max(0,upper*upper-a*a)),ex=nx*a+px/pl*h,ey=ny*a+py/pl*h,ez=nz*a+pz/pl*h,
        qUpper=side<0?out.left:out.right,qElbow=side<0?out.leftElbow:out.rightElbow;
      keeperQuaternionFromTo(0,-1,0,ex,ey,ez,qUpper);
      keeperRotate(qUpper,nx*length-ex,ny*length-ey,nz*length-ez,out.v,true);
      keeperQuaternionFromTo(0,lowerY,lowerZ,out.v[0],out.v[1],out.v[2],qElbow);
      // Actual endpoint through the same root and anisotropic mesh scale.
      keeperRotate(r,(shoulderX+nx*length)*rig.scale,(shoulderY+ny*length)*rig.scale*rig.heightScale,(.10+nz*length)*rig.scale,out.hand);
      const gap=Math.hypot((out.hand[0]-target.x)/rig.xPerMetre,(out.hand[1]+rootY-height)/rig.zPerMetre,(out.hand[2]-target.y)/rig.yPerMetre);
      if(gap<out.gapMetres){out.gapMetres=gap;out.contactSide=side;}
    }
    return out;
  }

  function physicalChallengeDecision(input){
    // An action keeps its first-contact verdict throughout recovery. Ordinary
    // running contact has no challenge action and cannot enter discipline.
    if(!input.bodyContact||input.incidental||input.ballFirst)return {clean:true,chance:0,forced:false};
    const speed=Math.max(0,finite(input.speed,0)),behind=!!input.fromBehind,won=!!input.won,
      base=input.offBall?1:input.slide?(won?(behind?.50:.10):.62):input.shoulder?(won?(behind?.30:.05):(behind?.32:.08)):(won?(behind?.40:.15):.38),
      chance=clamp(base*(1+Math.max(0,speed-3)*.08)/Math.max(.01,finite(input.officialTolerance,1)),0,.9);
    return {clean:false,chance,forced:!!input.offBall||!input.shoulder};
  }
  function contactFallPlan(input){
    if(input.simulation)return {action:'handsRaised',duration:34,...input};
    if(input.persistentPull||/pull/.test(input.reason||''))return {action:'stumble',duration:30,...input};
    let action='stumble';const shoulder=/shoulder/.test(input.reason||''),impact=input;
    if(shoulder&&impact.intensity<.40)action='shoulderHit';
    else if(shoulder&&impact.intensity<.61)action='fallKnees';
    else if(impact.intensity<.30&&!input.slide)action='stumble';
    else if(input.slide&&impact.intensity>=.74&&impact.entrySpeed>=4.6)action='fallTumble';
    else if(input.slide&&impact.intensity>=.62)action='fallSlide';
    else if(Math.abs(impact.sideDot)>.54&&impact.intensity>=.44)action='fallTwist';
    else if(impact.forwardDot>.34)action='fallForward';else if(impact.forwardDot<-.28)action='fallBack';else action='fallSide';
    const durations={stumble:30,shoulderHit:24,fallKnees:44,fallForward:46,fallSide:50,fallTwist:64,fallBack:48,fallSlide:58,fallTumble:68,tackleFall:40};
    return {...input,action,duration:durations[action]||40};
  }
  function contactProgress(action,tick){return action?clamp((tick-action.startedTick)/Math.max(1,action.recoveryEndTick-action.startedTick),0,1):0;}
  function sweptSphereTime(ax,ay,az,adx,ady,adz,bx,by,bz,bdx,bdy,bdz,radius){
    const x=ax-bx,y=ay-by,z=az-bz,dx=adx-bdx,dy=ady-bdy,dz=adz-bdz,
      c=x*x+y*y+z*z-radius*radius;if(c<=0)return 0;
    const aa=dx*dx+dy*dy+dz*dz;if(aa<1e-14)return Infinity;
    const b=x*dx+y*dy+z*dz;if(b>=0)return Infinity;
    const disc=b*b-aa*c;if(disc<0)return Infinity;
    const t=(-b-Math.sqrt(disc))/aa;return t>=0&&t<=1?t:Infinity;
  }
  function physicalContactScratch(){return {poseA:{},poseB:{},foot:{},
    a:new Float64Array(14*3),b:new Float64Array(14*3),bestBall:Infinity,bestBody:Infinity};}
  const CHALLENGE_FOOT_CACHE=new WeakMap();
  function physicalFeet(player,start,tick,scratch){
    const action=player.action,rig=player.contactRig||DEFAULT_CONTACT_RIG;
    let cache=CHALLENGE_FOOT_CACHE.get(rig);
    if(!cache){cache=new Map();CHALLENGE_FOOT_CACHE.set(rig,cache);}
    for(let frame=0;frame<2;frame++){
      const now=frame?tick:tick-1,progress=contactProgress(action,now),root=frame?player.position:start,
        fx=frame?player.facing.x:finite(start.fx,player.facing.x),fy=frame?player.facing.y:finite(start.fy,player.facing.y),
        out=frame?scratch.a:scratch.b,key=action?action.type+':'+(action.recoveryEndTick-action.startedTick)+':'+(now-action.startedTick):'idle';
      let local=cache.get(key);
      if(!local){
        local=new Float64Array(42);const pose=scratch.poseA;
        fillChallengePose(action?.type||'idle',progress,1,pose);
        if(!action){pose.rootPitch=pose.rootRoll=pose.rootLift=0;pose.leftHip=pose.rightHip=0;pose.leftKnee=pose.rightKnee=-.08;pose.leftFoot=pose.rightFoot=0;}
        groundChallengePose(rig,pose,progress,scratch.foot);
        for(let sideIndex=0;sideIndex<2;sideIndex++)for(let endpoint=0;endpoint<3;endpoint++){
          const side=sideIndex?1:-1,index=(sideIndex*3+endpoint)*3;
          fillChallengeFoot(rig,pose,side,endpoint===2,1,0,scratch.foot);
          local[index]=scratch.foot.x;local[index+1]=scratch.foot.y;local[index+2]=scratch.foot.z;
          if(endpoint===1){fillChallengeFoot(rig,pose,side,true,1,0,scratch.foot);
            local[index]=(local[index]+scratch.foot.x)*.5;local[index+1]=(local[index+1]+scratch.foot.y)*.5;local[index+2]=(local[index+2]+scratch.foot.z)*.5;}
        }
        for(let sideIndex=0;sideIndex<2;sideIndex++){
          fillChallengeFoot(rig,pose,sideIndex?1:-1,-1,1,0,scratch.foot);const ankle=sideIndex*9;
          for(let sample=0;sample<4;sample++){const t=(sample+1)/4,index=(6+sideIndex*4+sample)*3;
            local[index]=local[ankle]+(scratch.foot.x-local[ankle])*t;local[index+1]=local[ankle+1]+(scratch.foot.y-local[ankle+1])*t;local[index+2]=local[ankle+2]+(scratch.foot.z-local[ankle+2])*t;}
        }
        if(cache.size>=256)cache.clear();cache.set(key,local);
      }
      // Rotate the same rig-local points, preserving anisotropic world scales.
      for(let i=0;i<42;i+=3){const x=local[i]*rig.xPerMetre,y=local[i+1]*rig.yPerMetre;
        out[i]=root.x+(fx*x-fy*y)/rig.xPerMetre;out[i+1]=root.y+(fy*x+fx*y)/rig.yPerMetre;out[i+2]=local[i+2];}
    }
  }
  function physicalActionGeometry(actor,target,starts,tick,ball,config,scratch){
    const start=starts[actor.id],other=starts[target.id],dt=config.fixedTickSeconds,
      ax=actor.position.x-start.x,ay=actor.position.y-start.y,
      bx=target.position.x-other.x,by=target.position.y-other.y,
      radius=target.contactRig?.bodyRadiusM??Math.min(.26,target.radius),
      dx=actor.position.x-target.position.x,dy=actor.position.y-target.position.y;
    if(dx*dx+dy*dy>25)return null;
    physicalFeet(actor,start,tick,scratch);let ballTime=Infinity,bodyTime=Infinity,ballIndex=0,bodyIndex=0,legX=0,legY=0,legZ=0;
    const p=scratch.a,prev=scratch.b;
    // Real boot spheres sweep against the real ball and the two lower legs.
    // Nearby leg samples form a short capsule; no player-radius reach is added.
    for(let index=0;index<42;index+=3){
      const px=prev[index],py=prev[index+1],pz=prev[index+2],vx=p[index]-px,vy=p[index+1]-py,vz=p[index+2]-pz,
        t=index<18&&actionPhase(actor.action,tick)==='contact'?sweptSphereTime(px,py,pz,vx,vy,vz,ball.position.x,ball.position.y,ball.position.z,
          ball.velocity.x*dt,ball.velocity.y*dt,ball.velocity.z*dt,.055+ball.radius):Infinity;
      if(index<18&&actionPhase(actor.action,tick)==='contact'){
        const rx=px-ball.position.x,ry=py-ball.position.y,rz=pz-ball.position.z,
          dx=vx-ball.velocity.x*dt,dy=vy-ball.velocity.y*dt,dz=vz-ball.velocity.z*dt,
          den=dx*dx+dy*dy+dz*dz,u=den>1e-12?clamp(-(rx*dx+ry*dy+rz*dz)/den,0,1):0,
          clearance=Math.hypot(rx+dx*u,ry+dy*u,rz+dz*u)-.055-ball.radius,gap=Math.max(0,clearance);
        if(!actor.action.closestBall||clearance<(actor.action.closestBall.clearanceMetres??actor.action.closestBall.gapMetres))actor.action.closestBall={gapMetres:gap,clearanceMetres:clearance,tick:tick-1+u,
          ballCarrierGapMetres:Math.hypot(target.position.x-ball.position.x,target.position.y-ball.position.y)};
      }
      if(t<ballTime){ballTime=t;ballIndex=index;}
      if(Math.max(px,p[index])<Math.min(other.x,target.position.x)-.24||Math.min(px,p[index])>Math.max(other.x,target.position.x)+.24||
          Math.max(py,p[index+1])<Math.min(other.y,target.position.y)-.24||Math.min(py,p[index+1])>Math.max(other.y,target.position.y)+.24||
          Math.min(pz,p[index+2])>(target.bodyLow?.4:.75)+.11||Math.max(pz,p[index+2])<-.01)continue;
      for(let side=-1;side<=1;side+=2)for(let z=.10;z<=(target.bodyLow?.4:.75);z+=.10){
        const lateral=side*2.66*(target.contactRig?.stanceHip||1)*(target.contactRig?.scale||1)/(target.contactRig?.xPerMetre||30.25),
          tx=other.x-finite(other.fy,target.facing.y)*lateral,ty=other.y+finite(other.fx,target.facing.x)*lateral,
          hit=sweptSphereTime(px,py,pz,vx,vy,vz,tx,ty,z,bx,by,0,(index<18?.055:.05)+.055);
        if(hit<bodyTime){bodyTime=hit;bodyIndex=index;legX=tx+bx*hit;legY=ty+by*hit;legZ=z;}
      }
    }
    // Torso/shoulder contact is a separate real body sweep. Sliding bodies
    // also occupy a low capsule behind the hips, never an upright cylinder.
    const actorRadius=actor.contactRig?.bodyRadiusM??Math.min(.26,actor.radius),slide=actor.action.type==='slide-tackle',
      count=!slide&&target.bodyLow?0:slide?3:1;
    for(let body=0;body<count;body++){
      const behind=slide?-body*.3:0,offsetX=actor.facing.x*behind,offsetY=actor.facing.y*behind,
        height=slide?.35:1.05,hit=sweptSphereTime(start.x+offsetX,start.y+offsetY,height,ax,ay,0,
          other.x,other.y,height,bx,by,0,actorRadius+radius);
      if(hit<bodyTime){bodyTime=hit;bodyIndex=-1;legX=other.x+bx*hit;legY=other.y+by*hit;legZ=height;}
    }
    if(!Number.isFinite(ballTime)&&!Number.isFinite(bodyTime))return null;
    const bodyFirst=bodyTime<=ballTime,part=bodyFirst?bodyIndex:ballIndex,time=bodyFirst?bodyTime:ballTime,
      contactX=part<0?start.x+ax*time:prev[part]+(p[part]-prev[part])*time,
      contactY=part<0?start.y+ay*time:prev[part+1]+(p[part+1]-prev[part+1])*time,
      contactZ=part<0?legZ:prev[part+2]+(p[part+2]-prev[part+2])*time,
      targetX=bodyFirst?legX:ball.position.x+ball.velocity.x*dt*time,
      targetY=bodyFirst?legY:ball.position.y+ball.velocity.y*dt*time,
      targetZ=bodyFirst?legZ:ball.position.z+ball.velocity.z*dt*time,
      nx=targetX-contactX,ny=targetY-contactY,nz=targetZ-contactZ,length=Math.hypot(nx,ny,nz)||1,
      combined=bodyFirst?(part<0?actorRadius+radius:(part<18?.055:.05)+.055):.055+ball.radius,
      relativeX=(ax-bx)/dt,relativeY=(ay-by)/dt;
    const bodyX=bodyIndex<0?start.x+ax*bodyTime:prev[bodyIndex]+(p[bodyIndex]-prev[bodyIndex])*bodyTime,
      bodyY=bodyIndex<0?start.y+ay*bodyTime:prev[bodyIndex+1]+(p[bodyIndex+1]-prev[bodyIndex+1])*bodyTime,
      bodyZ=bodyIndex<0?legZ:prev[bodyIndex+2]+(p[bodyIndex+2]-prev[bodyIndex+2])*bodyTime,
      bodyNx=legX-bodyX,bodyNy=legY-bodyY,bodyNz=legZ-bodyZ,bodyLength=Math.hypot(bodyNx,bodyNy,bodyNz)||1,
      bodyCombined=bodyIndex<0?actorRadius+radius:(bodyIndex<18?.055:.05)+.055,
      bodyGeometry=Number.isFinite(bodyTime)?{point:{x:(bodyX+legX)*.5,y:(bodyY+legY)*.5,z:(bodyZ+legZ)*.5},
        normal:{x:bodyNx/bodyLength,y:bodyNy/bodyLength,z:bodyNz/bodyLength},
        contactPart:bodyIndex<0?'body-to-body':bodyIndex<18?'boot-to-leg':'shin-to-leg',
        visibleGapMetres:Math.max(0,bodyLength-bodyCombined),
        approachSpeedMps:Math.max(0,(relativeX*bodyNx+relativeY*bodyNy)/Math.max(1e-9,Math.hypot(bodyNx,bodyNy)))}:null;
    return {ballContact:Number.isFinite(ballTime)&&ballTime<bodyTime-1e-7,bodyContact:Number.isFinite(bodyTime),ballFirst:ballTime<bodyTime-1e-7,bodyGeometry,
      ballContactTime:Number.isFinite(ballTime)?ballTime:null,bodyContactTime:Number.isFinite(bodyTime)?bodyTime:null,
      timeFraction:time,point:{x:contactX+nx*.5,y:contactY+ny*.5,z:contactZ+nz*.5},
      normal:{x:nx/length,y:ny/length,z:nz/length},contactPart:bodyFirst?(part<0?'body-to-body':part<18?'boot-to-leg':'shin-to-leg'):'boot-to-ball',
      visibleGapMetres:Math.max(0,length-combined),approachSpeedMps:Math.max(0,(relativeX*nx+relativeY*ny)/Math.max(1e-9,Math.hypot(nx,ny))),
      ballPoint:Number.isFinite(ballTime)?{x:ball.position.x+ball.velocity.x*dt*ballTime,y:ball.position.y+ball.velocity.y*dt*ballTime,z:ball.position.z+ball.velocity.z*dt*ballTime}:null};
  }
  function resolvePhysicalActionContacts(world,starts,tick,config,telemetry,ball,scratch){
    for(const actor of world.players){
      const action=actor.action,phase=actionPhase(action,tick);
      if(action&&tick===action.contactEndTick)telemetry.actions.push({type:'challenge-closest-approach',commandId:action.commandId,
        playerId:actor.id,tick,closestBall:action.closestBall?{...action.closestBall}:null});
      if(!action||action.bodyContactRecorded||phase==='windup'||phase==='complete')continue;
      const target=targetForAction(actor,world.players);if(!target)continue;
      const geometry=physicalActionGeometry(actor,target,starts,tick,ball,config,scratch);
      if(!geometry)continue;
      const slide=action.type==='slide-tackle',shoulder=action.type==='shoulder-challenge',
        toTarget=normalize({x:target.position.x-actor.position.x,y:target.position.y-actor.position.y},action.direction),
        alignment=dot(action.direction,toTarget),aa=actor.attributes,ta=target.attributes,
        shielding=target.contextMode==='shield'||target.locomotionState==='shield',
        skill=target.skillProtection?.defenderId===actor.id?target.skillProtection.multiplier:1;
      let actorScore,targetScore;
      if(slide){actorScore=(aa.defending*.34+aa.aggression*.24+aa.strength*.16+aa.acceleration*.1+alignment*14)*skill;
        targetScore=ta.control*.34+ta.balance*.34+ta.strength*.16+(shielding?18:0);
      }else if(!shoulder){actorScore=(aa.defending*.38+aa.strength*.24+aa.aggression*.17+aa.acceleration*.08+alignment*12)*skill;
        targetScore=ta.control*.32+ta.balance*.3+ta.strength*.22+(shielding?16:0);
      }else{actorScore=aa.strength*.40+aa.balance*.32+aa.pace*.16+magnitude(actor.velocity)*1.4;
        targetScore=ta.strength*.40+ta.balance*.32+ta.pace*.16+magnitude(target.velocity)*1.4+(shielding?18:0);}
      const previousBall=Number.isFinite(action.firstBallContactTick)?action.firstBallContactTick:null,
        firstBall=previousBall??(geometry.ballContact?tick-1+geometry.ballContactTime:null),
        bodyAt=geometry.bodyContact?tick-1+geometry.bodyContactTime:null,
        ballFirst=firstBall!==null&&(bodyAt===null||firstBall<bodyAt-1e-7),
        newBall=geometry.ballContact&&previousBall===null,
        newBody=geometry.bodyContact&&!action.bodyContactRecorded,
        ballReach=shoulder?Math.hypot(actor.position.x-ball.position.x,actor.position.y-ball.position.y)<=.75&&ball.position.z<.5:ballFirst,
        // A confirmed boot strike is a physical poke. Ratings/utility may
        // prevent reaching it, and still decide the following body/control
        // contest; they cannot leave a struck ball glued to its carrier.
        won=shoulder?actorScore>=targetScore&&geometry.bodyContact&&ballReach:newBall&&ballFirst,
        contactType=slide?'slide-contact':shoulder?'shoulder-contact':'tackle-contact';
      if(!newBall&&!newBody)continue;
      if(newBall)action.firstBallContactTick=firstBall;
      if(newBody)action.bodyContactRecorded=true;
      const winNow=won&&!action.ballWon;
      if(winNow)action.ballWon=true;
      const outcome=action.ballWon?'win':newBody?'contact-lost':'ball-contact';
      const contact={type:contactType,commandId:action.commandId,tick,actorId:actor.id,targetId:target.id,
        ...geometry,closestBall:action.closestBall?{...action.closestBall}:null,ballFirst,ballContact:geometry.ballContact||previousBall!==null,ballContactTick:firstBall,
        bodyContactTick:bodyAt,ballWon:winNow&&geometry.ballContact,actorScore:rounded(actorScore),targetScore:rounded(targetScore),
        skillTackleMultiplier:skill,alignment:rounded(alignment),outcome,
        ...(action.racePursuit?{racePursuit:true}:{})};
      delete contact.bodyGeometry;
      if(newBall)telemetry.contacts.push({...contact,bodyContact:false,bodyContactTime:null,bodyContactTick:null});
      if(newBody)telemetry.contacts.push({...contact,...geometry.bodyGeometry,bodyContact:true,
        ballWon:newBall?false:contact.ballWon});
      if(winNow||newBody&&!action.ballWon){
        const prefix=slide?'slide':shoulder?'shoulder':'tackle';
        telemetry.actions.push({type:prefix+(winNow?'-win':'-contact-lost'),commandId:action.commandId,tick,actorId:actor.id,targetId:target.id,outcome});
      }
      if(winNow&&geometry.ballContact){
        world.ballOwnerId=null;for(const player of world.players)player.hasBall=false;
        telemetry.pokes.push({actorId:actor.id,targetId:target.id,commandId:action.commandId,type:action.type,
          point:{...ball.position},direction:{...action.direction},timeFraction:geometry.ballContactTime??geometry.timeFraction,
          bootContact:geometry.ballContact,ballFirst,bodyContact:geometry.bodyContact});
      }
      if(newBody){
        const n=geometry.bodyGeometry?.normal||geometry.normal,ratio=aa.strength/Math.max(1,ta.strength),impulse=config.contactImpulse*(slide?1.32:1)*clamp(ratio,.55,1.65);
        target.velocity.x+=n.x*impulse;target.velocity.y+=n.y*impulse;
        actor.velocity.x-=n.x*impulse*.18;actor.velocity.y-=n.y*impulse*.18;
      }
      if(newBody||shoulder){action.resolved=true;action.outcome=action.ballWon?'win':'contact-lost';}
    }
    for(const actor of world.players){const action=actor.action;
      if(!action||action.resolved||tick!==action.contactEndTick)continue;
      action.resolved=true;action.outcome=action.ballWon?'win':'miss';
      if(!action.ballWon)telemetry.actions.push({type:action.type==='slide-tackle'?'slide-miss':action.type==='stand-tackle'?'tackle-miss':'shoulder-miss',
        commandId:action.commandId,tick,actorId:actor.id,targetId:action.targetId,outcome:'miss'});
    }
  }

  function forecastLocomotion(source,ticks,configOverrides){
    const config=configWith(configOverrides),p=createPlayerStateWithConfig(source,config),rows=[{position:{...p.position},velocity:{...p.velocity},facing:{...p.facing}}];
    p.control.startTick=1;p.control.untilTick=ticks;
    for(let tick=1;tick<=ticks;tick++){
      if(p.externalMotion){p.position.x+=p.velocity.x*config.fixedTickSeconds;p.position.y+=p.velocity.y*config.fixedTickSeconds;}
      else integratePlayer(p,tick,config);
      rows.push({position:{...p.position},velocity:{...p.velocity},facing:{...p.facing}});
    }
    return rows;
  }
  function forecastPhysicalChallenge(input,configOverrides){
    const config=configWith(configOverrides),source=input.actor,targetSource=input.target,type=input.type,
      samples=input.ballSamples||[],windup=type==='slide-tackle'?config.slideWindupTicks:config.tackleWindupTicks,
      contact=type==='slide-tackle'?config.slideContactTicks:config.tackleContactTicks,horizon=windup+contact,
      scratch=physicalContactScratch();
    if(!source||!targetSource||samples.length<=horizon)return null;
    let best=null;
    for(const aimTick of [windup+2,horizon-1])for(const offset of [-.12,0,.12]){
      const meeting=samples[aimTick],dx=meeting.x-source.position.x,dy=meeting.y-source.position.y,d=Math.hypot(dx,dy)||1,
        aim=normalize({x:dx-dy/d*offset,y:dy+dx/d*offset},source.facing),
        actor=createPlayerStateWithConfig({...source,externalMotion:false,action:null},config),
        target=createPlayerStateWithConfig(targetSource,config),telemetry={actions:[],commandAcks:[]};
      acknowledgeCommand(actor,normalizeCommand({id:'challenge-forecast',playerId:actor.id,tick:1,type,targetId:target.id,direction:aim}),1,config,telemetry);
      let firstBody=null,firstBall=null;
      for(let tick=1;tick<=horizon;tick++){
        const starts={[actor.id]:{...actor.position,fx:actor.facing.x,fy:actor.facing.y},[target.id]:{...target.position,fx:target.facing.x,fy:target.facing.y}};
        integratePlayer(actor,tick,config);
        if(input.targetTrajectory?.[tick]){const p=input.targetTrajectory[tick];Object.assign(target.position,p.position);Object.assign(target.facing,p.facing);Object.assign(target.velocity,p.velocity);}
        else{target.position.x+=target.velocity.x*config.fixedTickSeconds;target.position.y+=target.velocity.y*config.fixedTickSeconds;}
        const a=samples[tick-1],b=samples[tick],ball={position:a,velocity:{x:(b.x-a.x)/config.fixedTickSeconds,y:(b.y-a.y)/config.fixedTickSeconds,z:(b.z-a.z)/config.fixedTickSeconds},radius:.11},
          geometry=physicalActionGeometry(actor,target,starts,tick,ball,config,scratch);
        if(geometry?.bodyContact&&firstBody===null)firstBody=tick-1+geometry.bodyContactTime;
        if(geometry?.ballContact&&firstBall===null)firstBall=tick-1+geometry.ballContactTime;
        if(firstBall!==null)break;
      }
      const clean=firstBall!==null&&(firstBody===null||firstBall<firstBody),closest=actor.action.closestBall,
        row={direction:aim,clean,ballTick:firstBall,bodyTick:firstBody,closestGapMetres:closest?.gapMetres??Infinity,
          contactTick:closest?.tick??null,ballCarrierGapMetres:closest?.ballCarrierGapMetres??null},
        // The held-input forecast gets less certain as a carrier can turn or
        // touch again. Prefer an earlier real boot window over a deeper but
        // later predicted overlap; contact proof itself remains unchanged.
        rank=(clean?100:0)-(firstBody!==null?10:0)-(closest?.clearanceMetres??row.closestGapMetres)-(firstBall??horizon)*.04;
      if(!best||rank>best.rank)best={...row,rank};
    }
    return best;
  }

  const DEFAULT_CONTACT_RIG=createContactRig(),PHYSICAL_CONTACT_SCRATCH=physicalContactScratch();

  function sweptApproach(aStart, aEnd, aRadius, bStart, bEnd, bRadius, extraReach) {
    const relativeStart = { x: aStart.x - bStart.x, y: aStart.y - bStart.y };
    const relativeVelocity = {
      x: (aEnd.x - aStart.x) - (bEnd.x - bStart.x),
      y: (aEnd.y - aStart.y) - (bEnd.y - bStart.y)
    };
    const relativeSpeedSquared = dot(relativeVelocity, relativeVelocity);
    const time = relativeSpeedSquared <= 1e-12 ? 0 :
      clamp(-dot(relativeStart, relativeVelocity) / relativeSpeedSquared, 0, 1);
    const aPoint = { x: aStart.x + (aEnd.x - aStart.x) * time, y: aStart.y + (aEnd.y - aStart.y) * time };
    const bPoint = { x: bStart.x + (bEnd.x - bStart.x) * time, y: bStart.y + (bEnd.y - bStart.y) * time };
    const separation = { x: bPoint.x - aPoint.x, y: bPoint.y - aPoint.y };
    const closestDistance = magnitude(separation);
    const normal = closestDistance > 1e-12 ? { x: separation.x / closestDistance, y: separation.y / closestDistance } : { x: 1, y: 0 };
    const combinedRadius = Math.max(0, finite(aRadius, 0)) + Math.max(0, finite(bRadius, 0)) +
      Math.max(0, finite(extraReach, 0));
    return {
      hit: closestDistance <= combinedRadius,
      time: rounded(time),
      closestDistance: rounded(closestDistance),
      combinedRadius: rounded(combinedRadius),
      normal,
      pointA: aPoint,
      pointB: bPoint,
      relativeClosingSpeed: rounded(Math.max(0, -dot(relativeVelocity, normal)))
    };
  }

  function targetForAction(actor, players) {
    const opponents = players.filter(player => player.teamId !== actor.teamId);
    if (actor.action && actor.action.targetId) {
      const explicit = opponents.find(player => player.id === actor.action.targetId);
      if (explicit) return explicit;
    }
    return opponents.sort((a, b) => distance(actor.position, a.position) - distance(actor.position, b.position) ||
      a.id.localeCompare(b.id))[0] || null;
  }

  function resolveActionContacts(world, starts, tick, config, telemetry) {
    const playersById = Object.fromEntries(world.players.map(player => [player.id, player]));
    for (const actor of world.players) {
      const action = actor.action;
      if (!action || action.resolved || actionPhase(action, tick) !== 'contact') continue;
      const target = targetForAction(actor, world.players);
      if (!target) continue;
      const slide = action.type === 'slide-tackle';
      const approach = sweptApproach(starts[actor.id], actor.position, actor.radius,
        starts[target.id], target.position, target.radius,
        slide ? config.slideReach : action.type === 'stand-tackle' ? config.tackleReach : config.shoulderReach);
      const toTarget = normalize({ x: starts[target.id].x - starts[actor.id].x, y: starts[target.id].y - starts[actor.id].y }, action.direction);
      const alignment = dot(action.direction, toTarget);
      if (!approach.hit || alignment < (slide ? 0.42 : action.type === 'stand-tackle' ? 0.18 : -0.05)) continue;
      // Report actual relative travel toward the opponent for presentation-only
      // consumers. The older sweptApproach.relativeClosingSpeed is retained
      // unchanged because it also contributes to the football contest score.
      const relativeTravel = {
        x: (actor.position.x - starts[actor.id].x) - (target.position.x - starts[target.id].x),
        y: (actor.position.y - starts[actor.id].y) - (target.position.y - starts[target.id].y)
      };
      const approachSpeedMps = rounded(Math.max(0, dot(relativeTravel, toTarget)) / config.fixedTickSeconds);
      const actorAttrs = actor.attributes;
      const targetAttrs = target.attributes;
      const shielding = target.contextMode === 'shield' || target.locomotionState === 'shield';
      let actorScore;
      let targetScore;
      if (slide) {
        actorScore = actorAttrs.defending * 0.34 + actorAttrs.aggression * 0.24 + actorAttrs.strength * 0.16 +
          actorAttrs.acceleration * 0.1 + alignment * 14 + approach.relativeClosingSpeed * 2.6;
        targetScore = targetAttrs.control * 0.34 + targetAttrs.balance * 0.34 + targetAttrs.strength * 0.16 +
          (shielding ? 18 : 0);
      } else if (action.type === 'stand-tackle') {
        actorScore = actorAttrs.defending * 0.38 + actorAttrs.strength * 0.24 + actorAttrs.aggression * 0.17 +
          actorAttrs.acceleration * 0.08 + alignment * 12 + approach.relativeClosingSpeed * 2.2;
        targetScore = targetAttrs.control * 0.32 + targetAttrs.balance * 0.3 + targetAttrs.strength * 0.22 +
          (shielding ? 16 : 0);
      } else if(action.racePursuit){
        actorScore=actorAttrs.strength*.40+actorAttrs.balance*.32+actorAttrs.pace*.16+magnitude(actor.velocity)*1.4;
        targetScore=targetAttrs.strength*.40+targetAttrs.balance*.32+targetAttrs.pace*.16+magnitude(target.velocity)*1.4;
      } else {
        actorScore = actorAttrs.strength * 0.46 + actorAttrs.balance * 0.18 + actorAttrs.aggression * 0.16 +
          approach.relativeClosingSpeed * 2.4 + alignment * 8;
        targetScore = targetAttrs.strength * 0.38 + targetAttrs.balance * 0.4 + (shielding ? 18 : 0);
      }
      const protection=target.skillProtection;
      const skillMultiplier=protection&&protection.defenderId===actor.id?protection.multiplier:1;
      if(action.type!=='shoulder-challenge')actorScore*=skillMultiplier;
      const won = actorScore >= targetScore;
      action.resolved = true;
      action.outcome = won ? 'win' : 'contact-lost';
      const contactType = slide ? 'slide-contact' : action.type === 'stand-tackle' ? 'tackle-contact' : 'shoulder-contact';
      telemetry.contacts.push({
        type: contactType, commandId: action.commandId, tick, actorId: actor.id, targetId: target.id,
        alignment: rounded(alignment), closestDistance: approach.closestDistance,
        relativeClosingSpeed: approach.relativeClosingSpeed, approachSpeedMps, actorScore: rounded(actorScore),
        targetScore: rounded(targetScore), skillTackleMultiplier:skillMultiplier, outcome: action.outcome,
        ...(action.racePursuit?{racePursuit:true}:{})
      });
      const outcomeType = slide ? (won ? 'slide-win' : 'slide-contact-lost') : action.type === 'stand-tackle'
        ? (won ? 'tackle-win' : 'tackle-contact-lost')
        : (won ? 'shoulder-win' : 'shoulder-contact-lost');
      telemetry.actions.push({
        type: outcomeType, commandId: action.commandId, tick, actorId: actor.id,
        targetId: target.id, outcome: action.outcome
      });
      if (won && world.ballOwnerId === target.id) {
        world.ballOwnerId = actor.id;
        for (const player of Object.values(playersById)) player.hasBall = player.id === actor.id;
      }
      const direction = approach.normal;
      const strengthRatio = actorAttrs.strength / Math.max(1, targetAttrs.strength);
      const impulse = config.contactImpulse * (slide ? 1.32 : 1) * clamp(strengthRatio, 0.55, 1.65);
      if (won) {
        target.velocity.x += direction.x * impulse;
        target.velocity.y += direction.y * impulse;
        actor.velocity.x -= direction.x * impulse * 0.18;
        actor.velocity.y -= direction.y * impulse * 0.18;
      } else {
        actor.velocity.x -= direction.x * impulse * 0.55;
        actor.velocity.y -= direction.y * impulse * 0.55;
      }
    }
    for (const actor of world.players) {
      const action = actor.action;
      if (!action || action.resolved || tick !== action.contactEndTick) continue;
      action.resolved = true;
      action.outcome = 'miss';
      telemetry.actions.push({
        type: action.type === 'slide-tackle' ? 'slide-miss' : action.type === 'stand-tackle' ? 'tackle-miss' : 'shoulder-miss',
        commandId: action.commandId, tick, actorId: actor.id, targetId: action.targetId,
        outcome: 'miss'
      });
    }
  }

  function deterministicNormal(firstId, secondId) {
    return firstId.localeCompare(secondId) <= 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  }

  function separatePlayersWithConfig(players, boundsValue, config) {
    const bounds = normalizeBounds(boundsValue);
    const result = players.map(player => createPlayerStateWithConfig(player, config)).sort((a, b) => a.id.localeCompare(b.id));
    const contactMap = {};
    for (let iteration = 0; iteration < config.separationIterations; iteration += 1) {
      for (let firstIndex = 0; firstIndex < result.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < result.length; secondIndex += 1) {
          const first = result[firstIndex];
          const second = result[secondIndex];
          const dx = second.position.x - first.position.x;
          const dy = second.position.y - first.position.y;
          const requiredDistance = first.bodyLow||second.bodyLow?0:(first.contactRig?.bodyRadiusM??first.radius) + (second.contactRig?.bodyRadiusM??second.radius);
          if(dx*dx+dy*dy>=requiredDistance*requiredDistance)continue;
          const currentDistance = Math.hypot(dx, dy);
          const overlap = requiredDistance - currentDistance;
          if (overlap <= config.separationSlop) continue;
          const normal = currentDistance > 1e-12
            ? { x: dx / currentDistance, y: dy / currentDistance }
            : deterministicNormal(first.id, second.id);
          const firstInverseMass = 1 / first.mass;
          const secondInverseMass = 1 / second.mass;
          const inverseMassTotal = firstInverseMass + secondInverseMass;
          const firstAmount = overlap * firstInverseMass / inverseMassTotal;
          const secondAmount = overlap * secondInverseMass / inverseMassTotal;
          first.position.x -= normal.x * firstAmount;
          first.position.y -= normal.y * firstAmount;
          second.position.x += normal.x * secondAmount;
          second.position.y += normal.y * secondAmount;
          const key = first.id + '|' + second.id;
          const previous = contactMap[key];
          if (!previous || overlap > previous.overlap) {
            contactMap[key] = {
              type: 'player-separation', firstId: first.id, secondId: second.id,
              overlap: rounded(overlap), normal: { ...normal },
              ...(first.contactRig&&second.contactRig?{bodyContact:true,geometricBodyContact:true,visibleGapMetres:0,
                point:{x:(first.position.x+second.position.x)*.5,y:(first.position.y+second.position.y)*.5,z:first.action?.type==='slide-tackle'||second.action?.type==='slide-tackle'?.35:1.05},
                approachSpeedMps:Math.max(0,(first.velocity.x-second.velocity.x)*normal.x+(first.velocity.y-second.velocity.y)*normal.y)}:{})
            };
          }
        }
      }
    }
    for (const player of result) {
      player.position.x = clamp(player.position.x, bounds.xMin + player.radius, bounds.xMax - player.radius);
      player.position.y = clamp(player.position.y, bounds.yMin + player.radius, bounds.yMax - player.radius);
    }
    return { players: result, contacts: Object.values(contactMap).sort((a, b) =>
      a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId)) };
  }

  function separatePlayers(players, boundsValue, configOverrides) {
    return separatePlayersWithConfig(players, boundsValue, configWith(configOverrides));
  }

  function safetyGuard(player, fallbackPosition, config, tick, telemetry) {
    const invalidPosition = !Number.isFinite(player.position.x) || !Number.isFinite(player.position.y) ||
      Math.abs(player.position.x) > config.safetyPositionLimit || Math.abs(player.position.y) > config.safetyPositionLimit;
    const invalidVelocity = !Number.isFinite(player.velocity.x) || !Number.isFinite(player.velocity.y);
    if (invalidPosition) player.position = { ...fallbackPosition };
    if (invalidVelocity) player.velocity = { x: 0, y: 0 };
    let speed = magnitude(player.velocity);
    if (speed > config.safetyVelocityLimit && speed > 1e-12) {
      player.velocity.x *= config.safetyVelocityLimit / speed;
      player.velocity.y *= config.safetyVelocityLimit / speed;
      speed = config.safetyVelocityLimit;
      telemetry.safety.push({ type: 'velocity-clamped', playerId: player.id, tick, speed: rounded(speed) });
      player.safetyCorrections += 1;
    }
    if (invalidPosition || invalidVelocity) {
      telemetry.safety.push({
        type: 'non-finite-state-corrected', playerId: player.id, tick,
        positionCorrected: invalidPosition, velocityCorrected: invalidVelocity
      });
      player.safetyCorrections += 1;
    }
    player.stamina = clamp(finite(player.stamina, 0), 0, 100);
    player.facing = normalize(player.facing, { x: 1, y: 0 });
  }

  function processTick(world, commands, tick, config, telemetry, physicalBall, physicalScratch) {
    const playersById = Object.fromEntries(world.players.map(player => [player.id, player]));
    for (const command of commands.filter(item => item.tick === tick)) {
      const player = playersById[command.playerId];
      if (!player) {
        telemetry.commandAcks.push({
          type: 'command-rejected', commandId: command.id, commandType: command.type,
          playerId: command.playerId, tick, accepted: false, reason: 'unknown-player'
        });
        continue;
      }
      acknowledgeCommand(player, command, tick, config, telemetry);
    }
    const starts = Object.fromEntries(world.players.map(player => [player.id, { ...player.position,fx:player.facing.x,fy:player.facing.y }]));
    for (const player of world.players) integratePlayer(player, tick, config);
    if(physicalBall)resolvePhysicalActionContacts(world,starts,tick,config,telemetry,physicalBall,physicalScratch);
    else resolveActionContacts(world, starts, tick, config, telemetry);
    const separated = separatePlayersWithConfig(world.players, world.bounds, config);
    world.players = separated.players;
    for (const contact of separated.contacts){
      telemetry.contacts.push({ ...contact, tick });
      if(!physicalBall||!contact.geometricBodyContact||contact.approachSpeedMps<1.2)continue;
      const first=world.players.find(p=>p.id===contact.firstId),second=world.players.find(p=>p.id===contact.secondId);
      if(first.teamId===second.teamId)continue;
      const n=contact.normal,firstToward=first.velocity.x*n.x+first.velocity.y*n.y,secondToward=-second.velocity.x*n.x-second.velocity.y*n.y,
        actor=firstToward>=secondToward?first:second,target=actor===first?second:first;
      if(actor.action?.bodyContactRecorded||actor.lastBodyContactPeerId===target.id&&tick-actor.lastBodyContactTick<30)continue;
      actor.lastBodyContactPeerId=target.id;actor.lastBodyContactTick=tick;target.lastBodyContactPeerId=actor.id;target.lastBodyContactTick=tick;
      const action=actor.action,firstBall=action?.firstBallContactTick,bodyType=action?.type==='slide-tackle'?'slide-contact':action?.type==='stand-tackle'?'tackle-contact':action?.type==='shoulder-challenge'?'shoulder-contact':'body-contact';
      if(action){action.bodyContactRecorded=true;action.resolved=true;action.outcome=action.ballWon?'win':'contact-lost';
        if(!action.ballWon)telemetry.actions.push({type:action.type==='slide-tackle'?'slide-contact-lost':action.type==='stand-tackle'?'tackle-contact-lost':'shoulder-contact-lost',
          commandId:action.commandId,tick,actorId:actor.id,targetId:target.id,outcome:'contact-lost'});}
      telemetry.contacts.push({type:bodyType,commandId:action?.commandId||'body:'+actor.id+':'+target.id+':'+tick,tick,actorId:actor.id,targetId:target.id,
        outcome:action?.ballWon?'win':'body-contact',bodyContact:true,ballWon:false,ballContact:Number.isFinite(firstBall),ballFirst:Number.isFinite(firstBall),
        ballContactTick:firstBall??null,bodyContactTick:tick,incidental:!action,
        timeFraction:1,contactPart:'body-to-body',visibleGapMetres:0,
        point:contact.point,normal:{x:n.x*(actor===first?1:-1),y:n.y*(actor===first?1:-1),z:0},approachSpeedMps:contact.approachSpeedMps});
    }
    for (const player of world.players) safetyGuard(player, starts[player.id], config, tick, telemetry);
    world.tick = tick;
  }

  function advance(worldState, commandTimeline, ticks, configOverrides, physicalBall) {
    const config = configWith(configOverrides);
    const world = createWorldStateWithConfig(worldState, config);
    if (Math.abs(world.fixedTickSeconds - config.fixedTickSeconds) > 1e-12) {
      throw new RangeError('world fixed tick does not match configuration');
    }
    const count = ticks == null ? 1 : ticks;
    if (!Number.isInteger(count) || count < 0 || count > config.maximumAdvanceTicks) {
      throw new RangeError('ticks must be a non-negative integer within maximumAdvanceTicks');
    }
    const commands = (Array.isArray(commandTimeline) ? commandTimeline : []).map(normalizeCommand);
    const commandIds = new Set();
    for (const command of commands) {
      if (commandIds.has(command.id)) throw new TypeError('duplicate command id: ' + command.id);
      commandIds.add(command.id);
    }
    commands.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    const telemetry = {
      schema: TELEMETRY_SCHEMA,
      version: VERSION,
      authority: 'dormant-candidate',
      startTick: world.tick,
      endTick: world.tick + count,
      fixedTickSeconds: world.fixedTickSeconds,
      commandAcks: [],
      actions: [],
      contacts: [],
      ...(physicalBall?{pokes:[]}:{}),
      safety: []
    };
    const physicalScratch=physicalBall?PHYSICAL_CONTACT_SCRATCH:null;
    if(physicalBall&&count!==1)throw new RangeError('physical ball observation covers exactly one Movement tick');
    if(physicalBall&&(!physicalBall.position||!physicalBall.velocity||![physicalBall.position.x,physicalBall.position.y,physicalBall.position.z,physicalBall.velocity.x,physicalBall.velocity.y,physicalBall.velocity.z,physicalBall.radius].every(Number.isFinite)))throw new TypeError('physical ball observation must be finite');
    for (let index = 0; index < count; index += 1) {
      processTick(world, commands, world.tick + 1, config, telemetry,physicalBall,physicalScratch);
    }
    return { state: world, telemetry };
  }

  function fixturePlayer(id, teamId, x, y, data) {
    const source = data || {};
    return {
      id,
      teamId,
      role: source.role || 'midfielder',
      position: { x, y },
      velocity: source.velocity || { x: 0, y: 0 },
      facing: source.facing || { x: 1, y: 0 },
      attributes: {
        pace: 78, acceleration: 78, agility: 78, balance: 78, strength: 78,
        stamina: 80, defending: 70, aggression: 72, control: 78,
        ...(source.attributes || {})
      },
      staminaLevel: source.staminaLevel == null ? 100 : source.staminaLevel
    };
  }

  function createFailedToRegisterStandTackleFixture() {
    return {
      name: 'failed-to-register stand tackle regression',
      actorId: 'stand-tackler',
      world: {
        tick: 0,
        fixedTickSeconds: 1 / 60,
        bounds: { xMin: -20, xMax: 20, yMin: -12, yMax: 12 },
        ballOwnerId: 'distant-carrier',
        players: [
          fixturePlayer('stand-tackler', 'home', 0, 0, {
            role: 'defender', attributes: { defending: 92, aggression: 88, strength: 86 }
          }),
          fixturePlayer('distant-carrier', 'away', 5.5, 0, { attributes: { control: 86, balance: 84 } })
        ]
      },
      commands: [{
        id: 'stand-tackle-press', tick: 1, playerId: 'stand-tackler', type: 'stand-tackle',
        targetId: 'distant-carrier', direction: { x: 1, y: 0 }
      }]
    };
  }

  function createShoulderChallengeFixture() {
    return {
      name: 'shoulder challenge contact',
      actorId: 'strong-challenger',
      targetId: 'ball-carrier',
      world: {
        tick: 0,
        fixedTickSeconds: 1 / 60,
        bounds: { xMin: -20, xMax: 20, yMin: -12, yMax: 12 },
        ballOwnerId: 'ball-carrier',
        players: [
          fixturePlayer('strong-challenger', 'home', 0, 0, {
            role: 'defender', velocity: { x: 3.2, y: 0 },
            attributes: { strength: 96, balance: 91, aggression: 92 }
          }),
          fixturePlayer('ball-carrier', 'away', 0.92, 0, {
            velocity: { x: 1.1, y: 0 }, attributes: { strength: 65, balance: 67, control: 82 }
          })
        ]
      },
      commands: [{
        id: 'shoulder-press', tick: 1, playerId: 'strong-challenger', type: 'shoulder-challenge',
        targetId: 'ball-carrier', direction: { x: 1, y: 0 }
      }]
    };
  }

  function createDecelerationFixture() {
    return {
      name: 'released-input deceleration',
      playerId: 'decelerating-player',
      world: {
        tick: 0,
        fixedTickSeconds: 1 / 60,
        bounds: { xMin: -100, xMax: 100, yMin: -50, yMax: 50 },
        players: [fixturePlayer('decelerating-player', 'home', 0, 0, {
          velocity: { x: 7.2, y: 0 }, attributes: { agility: 82, balance: 84 }
        })]
      },
      commands: []
    };
  }

  function createSharpTurnFixture() {
    return {
      name: 'sharp-turn inertia',
      playerId: 'turning-player',
      world: {
        tick: 0,
        fixedTickSeconds: 1 / 60,
        bounds: { xMin: -100, xMax: 100, yMin: -50, yMax: 50 },
        players: [fixturePlayer('turning-player', 'home', 0, 0, {
          velocity: { x: 7.2, y: 0 }, facing: { x: 1, y: 0 },
          attributes: { pace: 90, acceleration: 88, agility: 82, balance: 80 }
        })]
      },
      commands: [{
        id: 'reverse-run', tick: 1, playerId: 'turning-player', type: 'move',
        move: { x: -1, y: 0 }, mode: 'run', intensity: 1, durationTicks: 90
      }]
    };
  }

  function createFatigueFixture() {
    return {
      name: 'sprint fatigue and recovery',
      playerId: 'fatigue-runner',
      world: {
        tick: 0,
        fixedTickSeconds: 1 / 60,
        bounds: { xMin: -500, xMax: 500, yMin: -50, yMax: 50 },
        players: [fixturePlayer('fatigue-runner', 'home', -400, 0, {
          attributes: { pace: 94, acceleration: 93, agility: 86, stamina: 72 }, staminaLevel: 100
        })]
      },
      commands: [
        { id: 'long-sprint', tick: 1, playerId: 'fatigue-runner', type: 'move', move: { x: 1, y: 0 }, sprint: true, durationTicks: 720 },
        { id: 'recovery-stop', tick: 721, playerId: 'fatigue-runner', type: 'stop' }
      ],
      sprintTicks: 720,
      recoveryTicks: 360
    };
  }

  return Object.freeze({
    VERSION,
    PLAYER_SCHEMA,
    WORLD_SCHEMA,
    TELEMETRY_SCHEMA,
    DEFAULT_CONFIG,
    ROLE_PROFILES,
    createPlayerState,
    createWorldState,
    isCompleteWorldState,
    sweptApproach,
    separatePlayers,
    forecastLocomotion,forecastPhysicalChallenge, keeperReachPose, createContactRig, fillChallengePose, groundChallengePose, fillChallengeFoot, contactProgress, physicalChallengeDecision,contactFallPlan,
    advance,
    step(worldState, commandTimeline, configOverrides) {
      return advance(worldState, commandTimeline, 1, configOverrides);
    },
    createFailedToRegisterStandTackleFixture,
    createShoulderChallengeFixture,
    createDecelerationFixture,
    createSharpTurnFixture,
    createFatigueFixture
  });
});
