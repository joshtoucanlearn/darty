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
      'shoulderWindupTicks', 'shoulderContactTicks', 'shoulderRecoveryTicks',
      'separationIterations', 'maximumAdvanceTicks']) {
      if (!Number.isInteger(config[key]) || config[key] < 0) throw new RangeError(key + ' must be a non-negative integer');
    }
    // An accepted physical action must remain observable for at least one
    // authoritative tick in every phase. Zero-length overrides are therefore
    // treated as the smallest valid phase rather than allowing an acknowledged
    // tackle/challenge to disappear before its acknowledgement frame returns.
    for (const key of ['tackleWindupTicks', 'tackleContactTicks', 'tackleRecoveryTicks',
      'shoulderWindupTicks', 'shoulderContactTicks', 'shoulderRecoveryTicks']) {
      config[key] = Math.max(1, config[key]);
    }
    for (const key of ['playerRadius', 'baseMass', 'runSpeedMinimum', 'runSpeedMaximum',
      'sprintSpeedMinimum', 'sprintSpeedMaximum', 'accelerationMinimum', 'accelerationMaximum',
      'decelerationMinimum', 'decelerationMaximum', 'turnRateMinimum', 'turnRateMaximum',
      'safetyVelocityLimit', 'safetyPositionLimit']) {
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
      responsivenessMultiplier: clamp(finite(source.responsivenessMultiplier, 1), 1, 1.5)
    };
  }

  function createAction(value) {
    if (!value || typeof value !== 'object') return null;
    const type = value.type === 'shoulder-challenge' ? 'shoulder-challenge' : 'stand-tackle';
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
      visible: value.visible !== false
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
      mass: clamp(finite(source.mass, derivedMass), 35, 140),
      stamina: clamp(finite(source.staminaLevel, source.stamina == null ? 100 : source.stamina), 0, 100),
      locomotionState: String(source.locomotionState || 'idle'),
      contextMode: CONTEXT_MODES.has(source.contextMode) ? source.contextMode : 'idle',
      visibleAction: Boolean(source.visibleAction),
      control: createControl(source.control),
      action: createAction(source.action),
      hasBall: Boolean(source.hasBall),
      touchBurstUntilTick: Number.isInteger(source.touchBurstUntilTick) ? source.touchBurstUntilTick : -1,
      touchBurstAccelerationMultiplier: clamp(finite(source.touchBurstAccelerationMultiplier, 1), 1, 1.08),
      lastCommandAck: source.lastCommandAck ? cloneObject(source.lastCommandAck) : null,
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
    if (!['move', 'stop', 'stand-tackle', 'shoulder-challenge'].includes(type)) {
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
      durationTicks: Math.max(1, Math.trunc(finite(source.durationTicks, 1))),
      targetId: source.targetId == null ? null : String(source.targetId)
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
    const isPhysicalAction = command.type === 'stand-tackle' || command.type === 'shoulder-challenge';
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
        responsivenessMultiplier: command.responsivenessMultiplier
      });
      return;
    }
    if (command.type === 'stop') {
      player.control = createControl({ commandId: command.id, startTick: tick, untilTick: tick, mode: 'idle' });
      return;
    }
    const tackle = command.type === 'stand-tackle';
    const windupTicks = tackle ? config.tackleWindupTicks : config.shoulderWindupTicks;
    const contactTicks = tackle ? config.tackleContactTicks : config.shoulderContactTicks;
    const recoveryTicks = tackle ? config.tackleRecoveryTicks : config.shoulderRecoveryTicks;
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
      visible: true
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
    if (liveAction && livePhase !== 'complete') {
      mode = liveAction.type;
      desiredDirection = liveAction.direction;
      if (livePhase === 'windup') forcedSpeed = liveAction.type === 'stand-tackle' ? 1.2 : 2.2;
      else if (livePhase === 'contact') forcedSpeed = liveAction.type === 'stand-tackle'
        ? config.tackleLungeSpeed : config.shoulderSpeed;
      else forcedSpeed = 0;
      forcedAcceleration = liveAction.type === 'stand-tackle' ? config.tackleAcceleration : config.accelerationMaximum;
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
    // CPU/default callers remain on the original facing-led path below.
    const humanDirectionalSteering = !liveAction && inputMagnitude > 1e-9 && response > 1 &&
      (directionAlignment < 0.995 || facingAlignment < 0.995);
    const turnSeverity = clamp((1 - directionAlignment) / 2, 0, 1);
    const ratedResponse = 1 + (response - 1) * clamp((1 - directionAlignment) / 0.3, 0, 1);
    // With no retained momentum there is nothing physical to preserve: a
    // human can plant and leave in the requested direction instead of taking
    // several frames of forward steps while the old facing slowly rotates.
    const maximumTurn = response > 1 && speed <= 0.25
      ? Math.PI
      : limits.turnRate / (1 + speed * config.speedTurnInertia * (humanDirectionalSteering ? 0.25 : 1)) * response * dt;
    player.facing = rotateToward(player.facing, desiredDirection, maximumTurn);
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
    const sprinting = control.mode === 'sprint' && inputMagnitude > 0.15 && !liveAction;
    const running = control.mode === 'run' && inputMagnitude > 0.35 && !liveAction;
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
      player.locomotionState = liveAction.type + '-' + livePhase;
    } else {
      player.visibleAction = false;
      player.contextMode = contextualMode;
      player.locomotionState = contextualMode;
    }
  }

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
      const approach = sweptApproach(starts[actor.id], actor.position, actor.radius,
        starts[target.id], target.position, target.radius,
        action.type === 'stand-tackle' ? config.tackleReach : config.shoulderReach);
      const toTarget = normalize({ x: starts[target.id].x - starts[actor.id].x, y: starts[target.id].y - starts[actor.id].y }, action.direction);
      const alignment = dot(action.direction, toTarget);
      if (!approach.hit || alignment < (action.type === 'stand-tackle' ? 0.18 : -0.05)) continue;
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
      if (action.type === 'stand-tackle') {
        actorScore = actorAttrs.defending * 0.38 + actorAttrs.strength * 0.24 + actorAttrs.aggression * 0.17 +
          actorAttrs.acceleration * 0.08 + alignment * 12 + approach.relativeClosingSpeed * 2.2;
        targetScore = targetAttrs.control * 0.32 + targetAttrs.balance * 0.3 + targetAttrs.strength * 0.22 +
          (shielding ? 16 : 0);
      } else {
        actorScore = actorAttrs.strength * 0.46 + actorAttrs.balance * 0.18 + actorAttrs.aggression * 0.16 +
          approach.relativeClosingSpeed * 2.4 + alignment * 8;
        targetScore = targetAttrs.strength * 0.38 + targetAttrs.balance * 0.4 + (shielding ? 18 : 0);
      }
      const won = actorScore >= targetScore;
      action.resolved = true;
      action.outcome = won ? 'win' : 'contact-lost';
      const contactType = action.type === 'stand-tackle' ? 'tackle-contact' : 'shoulder-contact';
      telemetry.contacts.push({
        type: contactType, commandId: action.commandId, tick, actorId: actor.id, targetId: target.id,
        alignment: rounded(alignment), closestDistance: approach.closestDistance,
        relativeClosingSpeed: approach.relativeClosingSpeed, approachSpeedMps, actorScore: rounded(actorScore),
        targetScore: rounded(targetScore), outcome: action.outcome
      });
      const outcomeType = action.type === 'stand-tackle'
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
      const impulse = config.contactImpulse * clamp(strengthRatio, 0.55, 1.65);
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
        type: action.type === 'stand-tackle' ? 'tackle-miss' : 'shoulder-miss',
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
          const currentDistance = Math.hypot(dx, dy);
          const requiredDistance = first.radius + second.radius;
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
              overlap: rounded(overlap), normal: { ...normal }
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

  function processTick(world, commands, tick, config, telemetry) {
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
    const starts = Object.fromEntries(world.players.map(player => [player.id, { ...player.position }]));
    for (const player of world.players) integratePlayer(player, tick, config);
    resolveActionContacts(world, starts, tick, config, telemetry);
    const separated = separatePlayersWithConfig(world.players, world.bounds, config);
    world.players = separated.players;
    for (const contact of separated.contacts) telemetry.contacts.push({ ...contact, tick });
    for (const player of world.players) safetyGuard(player, starts[player.id], config, tick, telemetry);
    world.tick = tick;
  }

  function advance(worldState, commandTimeline, ticks, configOverrides) {
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
      safety: []
    };
    for (let index = 0; index < count; index += 1) {
      processTick(world, commands, world.tick + 1, config, telemetry);
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
