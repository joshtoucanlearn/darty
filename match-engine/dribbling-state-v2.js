'use strict';

/*
 * Football Legacy True Feel — Dribbling State V2
 *
 * A deterministic, SI-unit dribbling state machine for the offline live V2
 * authority.  It owns neither controls nor presentation.  It turns an
 * outfield carrier's real Movement V2 geometry into short, physical Ball V2
 * touch leases and returns an explicit transaction result to the live adapter.
 */
(function exposeDribblingStateV2(root, factory) {
  const Ball = typeof module === 'object' && module.exports
    ? require('./ball-engine-v2.js')
    : root && root.FootballLegacyBallEngineV2;
  const api = factory(Ball);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyDribblingStateV2 = api;
})(typeof window === 'object' ? window : null, function createDribblingStateV2Api(Ball) {
  'use strict';

  const VERSION = '2.0.0-offline-live-dribbling-state';
  const ENGINE_NAME = 'True Feel';
  const STATE_SCHEMA = 'football-legacy-dribbling-state-v2';
  const REQUEST_SCHEMA = 'football-legacy-dribbling-request-v2';
  const RESULT_SCHEMA = 'football-legacy-dribbling-result-v2';
  const CAPABILITY_SCHEMA = 'football-legacy-dribbling-capability-v2';
  const SERIALIZED_SCHEMA = 'football-legacy-dribbling-serialized-state-v2';
  const ACKNOWLEDGEMENT = 'I understand Dribbling V2 creates physical Ball V2 touch leases for explicit offline live authority only.';
  const SUPPORTED_WORKFLOWS = Object.freeze(['single-player', 'cpu-v-cpu']);
  const FIXED_TICK_SECONDS = 1 / 60;
  const MAX_CONSUMED_ACTION_IDS = 2048;
  const ACTION_BUFFER_TICKS = 12;
  const issuedCapabilities = new WeakSet();

  const PHASES = Object.freeze({
    IDLE: 'idle',
    SECURED_CONTROL: 'secured-control',
    TOUCH_PREPARATION: 'touch-preparation',
    SEPARATED_TOUCH: 'separated-touch',
    CHASE_RECOVERY: 'chase-recovery',
    RESECURE: 'resecure',
    HEAVY_TOUCH: 'heavy-touch',
    SHIELD: 'shield',
    TURNOVER: 'turnover'
  });
  const PHASE_VALUES = Object.freeze(Object.values(PHASES));
  const SURFACE_PROFILES = deepFreeze({
    dry: { id: 'dry', distanceMultiplier: 1, speedMultiplier: 1, error: 0, leaseTicks: 0 },
    wet: { id: 'wet', distanceMultiplier: 1.1, speedMultiplier: 1.08, error: 0.035, leaseTicks: 1 },
    worn: { id: 'worn', distanceMultiplier: 1.04, speedMultiplier: 1.03, error: 0.02, leaseTicks: 0 },
    muddy: { id: 'muddy', distanceMultiplier: 0.9, speedMultiplier: 0.84, error: 0.055, leaseTicks: 2 }
  });
  const CONFIG = deepFreeze({
    preparationTicks: 1,
    minimumSeparatedTicks: 5,
    minimumTouchCadenceTicks: 20,
    maximumTouchCadenceTicks: 34,
    minimumLeaseTicks: 9,
    maximumLeaseTicks: 17,
    minimumControlIntensity: 0.16,
    minimumCarrierSpeed: 0.55,
    captureRadiusMin: 0.58,
    captureRadiusMax: 0.82,
    heavySeparationMin: 1.35,
    heavySeparationMax: 2.15,
    turnoverMargin: 0.06
  });
  const TOUCH_CADENCE_BASE_TICKS = deepFreeze({
    walk: 33,
    jog: 31,
    run: 28,
    sprint: 24
  });
  const TOUCH_CADENCE_PHASE_TICKS = Object.freeze([-1, 1, 0, 2, -2]);
  const TOUCH_DISTANCE_MULTIPLIER = deepFreeze({
    walk: 0.72,
    jog: 0.86,
    run: 1,
    sprint: 1.08
  });

  if (!Ball || Ball.VERSION !== '2.0.0-shadow' ||
      Ball.STATE_SCHEMA !== 'football-legacy-ball-v2-state' ||
      typeof Ball.createBallState !== 'function' || typeof Ball.isBallState !== 'function') {
    throw new Error('Dribbling V2 requires the reviewed Ball Engine V2 contract');
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    for (const key of Object.keys(value)) output[key] = clone(value[key]);
    return output;
  }

  function detachedBallState(state) {
    if (!Ball.isBallState(state)) throw new TypeError('complete Ball V2 state is required');
    return Ball.createBallState({ ...state, metadata: clone(state.metadata) }, {
      radius: state.radius,
      mass: state.mass
    });
  }

  function deepFreeze(value, seen) {
    if (!value || typeof value !== 'object') return value;
    const visited = seen || new WeakSet();
    if (visited.has(value)) return value;
    visited.add(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], visited);
    return Object.freeze(value);
  }

  function point(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const base = fallback || { x: 0, y: 0 };
    return { x: finite(source.x, base.x), y: finite(source.y, base.y) };
  }

  function length(value) {
    return Math.hypot(finite(value && value.x, 0), finite(value && value.y, 0));
  }

  function dot(left, right) {
    return finite(left && left.x, 0) * finite(right && right.x, 0) +
      finite(left && left.y, 0) * finite(right && right.y, 0);
  }

  function unit(value, fallback) {
    const base = point(fallback, { x: 1, y: 0 });
    const source = point(value, base), magnitude = length(source);
    if (magnitude <= 1e-12) {
      const baseMagnitude = length(base);
      return baseMagnitude <= 1e-12 ? { x: 1, y: 0 } : { x: base.x / baseMagnitude, y: base.y / baseMagnitude };
    }
    return { x: source.x / magnitude, y: source.y / magnitude };
  }

  function stableHash(value) {
    const text = String(value == null ? '' : value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 0x9e3779b9;
  }

  function random01(seed, salt) {
    let value = (Number(seed) >>> 0) ^ stableHash(salt);
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  }

  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }

  function stateChecksum(state) {
    return stableHash(canonical(state)).toString(16).padStart(8, '0');
  }

  function blankState(epoch) {
    return {
      schema: STATE_SCHEMA,
      version: VERSION,
      epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0,
      phase: PHASES.IDLE,
      phaseStartedTick: 0,
      carrierId: null,
      carrierTeamId: null,
      logicalOwnerId: null,
      physicalSeparated: false,
      touchSequence: 0,
      touchTick: null,
      nextTouchTick: 0,
      leaseUntilTick: null,
      foot: null,
      contact: null,
      contactPoint: null,
      touchVelocity: null,
      targetSeparationMetres: 0,
      lastSeparationMetres: 0,
      maxSeparationMetres: 0,
      surface: 'dry',
      pressure: 0,
      bufferedAction: null,
      consumedActionIds: [],
      consumedActionHighWaterTick: 0,
      consumedActionIdsAtHighWater: [],
      outcome: null,
      previousCarrierId: null
    };
  }

  function createState(initial) {
    const source = initial && typeof initial === 'object' ? initial : {};
    const state = blankState(source.epoch);
    state.phase = PHASE_VALUES.includes(source.phase) ? source.phase : state.phase;
    state.phaseStartedTick = Math.max(0, Math.trunc(finite(source.phaseStartedTick, 0)));
    state.carrierId = source.carrierId == null ? null : String(source.carrierId);
    state.carrierTeamId = source.carrierTeamId == null ? null : String(source.carrierTeamId);
    state.logicalOwnerId = source.logicalOwnerId == null ? null : String(source.logicalOwnerId);
    state.physicalSeparated = Boolean(source.physicalSeparated);
    state.touchSequence = Math.max(0, Math.trunc(finite(source.touchSequence, 0)));
    state.touchTick = source.touchTick == null ? null : Math.max(0, Math.trunc(finite(source.touchTick, 0)));
    state.nextTouchTick = Math.max(0, Math.trunc(finite(source.nextTouchTick, 0)));
    state.leaseUntilTick = source.leaseUntilTick == null ? null : Math.max(0, Math.trunc(finite(source.leaseUntilTick, 0)));
    state.foot = ['left', 'right'].includes(source.foot) ? source.foot : null;
    state.contact = source.contact == null ? null : String(source.contact).slice(0, 32);
    state.contactPoint = source.contactPoint ? point(source.contactPoint) : null;
    state.touchVelocity = source.touchVelocity ? point(source.touchVelocity) : null;
    state.targetSeparationMetres = clamp(finite(source.targetSeparationMetres, 0), 0, 4);
    state.lastSeparationMetres = clamp(finite(source.lastSeparationMetres, 0), 0, 12);
    state.maxSeparationMetres = clamp(finite(source.maxSeparationMetres, 0), 0, 12);
    state.surface = Object.hasOwn(SURFACE_PROFILES, source.surface) ? source.surface : 'dry';
    state.pressure = clamp(finite(source.pressure, 0), 0, 1);
    state.bufferedAction = normalizeBufferedAction(source.bufferedAction);
    const consumedActionIds = Array.isArray(source.consumedActionIds)
      ? [...new Set(source.consumedActionIds.map(String).filter(Boolean))] : [];
    if (consumedActionIds.length > MAX_CONSUMED_ACTION_IDS) throw new RangeError('Dribbling V2 action identity ledger exceeds capacity');
    state.consumedActionIds = consumedActionIds;
    state.consumedActionHighWaterTick = Math.max(0, Math.trunc(finite(source.consumedActionHighWaterTick, 0)));
    state.consumedActionIdsAtHighWater = Array.isArray(source.consumedActionIdsAtHighWater)
      ? [...new Set(source.consumedActionIdsAtHighWater.map(String).filter(Boolean))].slice(0, 4) : [];
    state.outcome = source.outcome == null ? null : String(source.outcome).slice(0, 32);
    state.previousCarrierId = source.previousCarrierId == null ? null : String(source.previousCarrierId);
    if (state.physicalSeparated && ![PHASES.SEPARATED_TOUCH, PHASES.CHASE_RECOVERY].includes(state.phase)) {
      throw new TypeError('physical separation requires a released dribbling phase');
    }
    if (state.physicalSeparated && (!state.carrierId || !state.logicalOwnerId || state.carrierId !== state.logicalOwnerId)) {
      throw new TypeError('physical separation requires retained logical carrier authority');
    }
    return state;
  }

  function serializeState(stateInput) {
    const state = createState(stateInput);
    return deepFreeze({
      schema: SERIALIZED_SCHEMA,
      version: VERSION,
      state,
      checksum: stateChecksum(state)
    });
  }

  function restoreState(serialized) {
    if (!serialized || serialized.schema !== SERIALIZED_SCHEMA || serialized.version !== VERSION ||
        !serialized.state || String(serialized.checksum || '') !== stateChecksum(serialized.state)) {
      throw new TypeError('invalid serialized Dribbling V2 state');
    }
    return createState(serialized.state);
  }

  function createCapability(options) {
    const source = options && typeof options === 'object' ? options : {};
    const workflow = String(source.workflow || '');
    if (source.acknowledgement !== ACKNOWLEDGEMENT) throw new Error('explicit Dribbling V2 acknowledgement is required');
    if (!SUPPORTED_WORKFLOWS.includes(workflow)) throw new Error('unsupported Dribbling V2 workflow: ' + workflow);
    if (source.online !== false) throw new Error('Dribbling V2 requires online:false');
    const capability = Object.freeze({
      schema: CAPABILITY_SCHEMA,
      version: VERSION,
      grant: 'offline-live-v2-dribbling-authority',
      workflow,
      online: false,
      physicsProfile: 'shared-human-cpu-ratings-neutral'
    });
    issuedCapabilities.add(capability);
    return capability;
  }

  function normalizeBufferedAction(value) {
    if (!value || typeof value !== 'object') return null;
    const type = String(value.type || '');
    const id = String(value.id || value.sequence || '');
    if (!id || !['pass', 'shot'].includes(type)) return null;
    return {
      id: id.slice(0, 96),
      type,
      actorId: value.actorId == null ? null : String(value.actorId),
      targetPlayerId: value.targetPlayerId == null ? null : String(value.targetPlayerId),
      target: value.target && typeof value.target === 'object'
        ? { x: finite(value.target.x, 0), y: finite(value.target.y, 0), z: finite(value.target.z, 0) } : null,
      direction: value.direction && typeof value.direction === 'object'
        ? unit(value.direction, { x: 1, y: 0 }) : null,
      power: clamp(finite(value.power, value.confidence), 0, 1),
      variant: String(value.variant || 'normal').slice(0, 48),
      delivery: value.source === 'cpu-v2' && value.delivery ? clone(value.delivery) : null,
      source: String(value.source || 'live-v2').slice(0, 32),
      commandTick: Math.max(0, Math.trunc(finite(value.commandTick, 0))),
      expiresTick: Math.max(0, Math.trunc(finite(value.expiresTick, 0)))
    };
  }

  function normalizeRequest(input, capability) {
    if (!issuedCapabilities.has(capability) || capability.schema !== CAPABILITY_SCHEMA ||
        capability.version !== VERSION || capability.grant !== 'offline-live-v2-dribbling-authority') {
      throw new Error('issued Dribbling V2 capability required');
    }
    const source = input && typeof input === 'object' ? input : {};
    if (source.schema !== REQUEST_SCHEMA) throw new TypeError('Dribbling V2 request schema mismatch');
    if (source.workflow !== capability.workflow || source.online !== false) throw new Error('Dribbling V2 authority scope mismatch');
    if (!Number.isInteger(source.tick) || source.tick < 1) throw new TypeError('Dribbling V2 tick must be a positive integer');
    if (Math.abs(finite(source.fixedTickSeconds, 0) - FIXED_TICK_SECONDS) > 1e-12) {
      throw new RangeError('Dribbling V2 fixed tick must be 1/60');
    }
    if (!source.movementWorld || !Array.isArray(source.movementWorld.players)) throw new TypeError('Movement V2 world is required');
    if (!Ball.isBallState(source.ballState)) throw new TypeError('complete Ball V2 state is required');
    const state = createState(source.state || { epoch: source.epoch });
    const epoch = Math.max(0, Math.trunc(finite(source.epoch, state.epoch)));
    if (state.epoch !== epoch) throw new Error('Dribbling V2 epoch mismatch');
    const roster = Array.isArray(source.roster) ? source.roster.map(row => ({
      id: String(row && row.id || ''),
      teamId: String(row && row.teamId || ''),
      isGK: Boolean(row && row.isGK),
      sentOff: Boolean(row && row.sentOff),
      available: row && row.available !== false,
      contactEligible: row && row.contactEligible !== false,
      attributes: clone(row && (row.attributes || row.attrs) || {})
    })).filter(row => row.id) : [];
    const rosterIds = new Set(roster.map(row => row.id));
    const worldIds = new Set(source.movementWorld.players.map(row => String(row.id)));
    if (roster.length !== rosterIds.size || [...worldIds].some(id => !rosterIds.has(id))) {
      throw new TypeError('Dribbling V2 roster must cover Movement V2 players exactly once');
    }
    const logicalOwnerId = source.logicalOwnerId == null ? null : String(source.logicalOwnerId);
    if (logicalOwnerId && (!worldIds.has(logicalOwnerId) || !rosterIds.has(logicalOwnerId))) {
      throw new TypeError('Dribbling V2 logical owner is ineligible');
    }
    const carrierInputSource = source.carrierInput && typeof source.carrierInput === 'object' ? source.carrierInput : {};
    const gateSource = source.gate && typeof source.gate === 'object' ? source.gate : {};
    return {
      tick: source.tick,
      epoch,
      seed: (Number.isInteger(source.seed) ? source.seed >>> 0 : stableHash(capability.workflow)) || 1,
      workflow: capability.workflow,
      state,
      movementWorld: source.movementWorld,
      ballState: detachedBallState(source.ballState),
      roster,
      logicalOwnerId,
      carrierInput: {
        source: carrierInputSource.source === 'human' ? 'human' : 'cpu',
        direction: carrierInputSource.direction ? unit(carrierInputSource.direction, { x: 1, y: 0 }) : null,
        intensity: clamp(finite(carrierInputSource.intensity, 0), 0, 1),
        sprint: Boolean(carrierInputSource.sprint),
        shield: Boolean(carrierInputSource.shield)
      },
      surface: Object.hasOwn(SURFACE_PROFILES, source.surface) ? source.surface : 'dry',
      actionIntent: normalizeBufferedAction(source.actionIntent),
      gate: {
        livePlay: gateSource.livePlay === true,
        restartActive: gateSource.restartActive === true,
        replayActive: gateSource.replayActive === true,
        keeperAuthority: gateSource.keeperAuthority === true,
        offsideInvolvementPending: gateSource.offsideInvolvementPending === true,
        specialActionAuthority: gateSource.specialActionAuthority === true
      }
    };
  }

  function attributesFor(request, playerId) {
    const row = request.roster.find(item => item.id === playerId), attrs = row && row.attributes || {};
    return {
      control: clamp(finite(attrs.control, 70), 1, 99),
      technique: clamp(finite(attrs.technique, attrs.control), 1, 99),
      agility: clamp(finite(attrs.agility, attrs.acceleration || attrs.accel || 70), 1, 99)
    };
  }

  function playerFor(request, id) {
    return request.movementWorld.players.find(player => String(player.id) === String(id || '')) || null;
  }

  function rosterFor(request, id) {
    return request.roster.find(player => player.id === String(id || '')) || null;
  }

  function pressureAt(request, carrier) {
    const carrierRoster = rosterFor(request, carrier.id);
    if (!carrierRoster) return { score: 0, nearestDistance: null, nearestId: null };
    const nearest = request.movementWorld.players.map(player => {
      const row = rosterFor(request, player.id);
      if (!row || row.teamId === carrierRoster.teamId || row.isGK || row.sentOff || !row.available) return null;
      return { id: row.id, distance: Math.hypot(player.position.x - carrier.position.x, player.position.y - carrier.position.y) };
    }).filter(Boolean).sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0] || null;
    return nearest ? {
      score: clamp((2.4 - nearest.distance) / 2.4, 0, 1),
      nearestDistance: nearest.distance,
      nearestId: nearest.id
    } : { score: 0, nearestDistance: null, nearestId: null };
  }

  function nearestOpponentToBall(request, carrierId, ballPosition) {
    const carrierRoster = rosterFor(request, carrierId);
    if (!carrierRoster) return null;
    return request.movementWorld.players.map(player => {
      const row = rosterFor(request, player.id);
      if (!row || row.teamId === carrierRoster.teamId || row.isGK || row.sentOff || !row.available || !row.contactEligible) return null;
      return { player, roster: row, distance: Math.hypot(player.position.x - ballPosition.x, player.position.y - ballPosition.y) };
    }).filter(Boolean).sort((left, right) => left.distance - right.distance || left.roster.id.localeCompare(right.roster.id))[0] || null;
  }

  function qualityFor(request, carrierId) {
    const attrs = attributesFor(request, carrierId);
    return {
      ...attrs,
      score: (attrs.control * 0.42 + attrs.technique * 0.33 + attrs.agility * 0.25) / 99
    };
  }

  function carrierDirection(request, carrier, quality) {
    const facing = unit(carrier.facing, { x: 1, y: 0 });
    const velocityDirection = length(carrier.velocity) > 0.1 ? unit(carrier.velocity, facing) : facing;
    const desired = request.carrierInput.direction || velocityDirection;
    const response = 0.48 + quality.agility / 99 * 0.42;
    return unit({
      x: facing.x * (1 - response) + desired.x * response,
      y: facing.y * (1 - response) + desired.y * response
    }, desired);
  }

  function carryMode(request, carrier) {
    const speed = carrier ? length(carrier.velocity) : 0;
    const locomotion = String(carrier && carrier.locomotionState || '');
    const intensity = request.carrierInput.intensity || clamp(speed / 7.2, 0, 1);
    if (request.carrierInput.sprint || locomotion === 'sprint') return 'sprint';
    if (locomotion === 'walk' || speed <= 2.55 || intensity <= 0.34) return 'walk';
    if (speed <= 4.25 || intensity <= 0.6) return 'jog';
    return 'run';
  }

  function turnSeverity(request, carrier, desired) {
    if (!carrier) return 0;
    const facing = unit(carrier.facing, { x: 1, y: 0 });
    const travel = length(carrier.velocity) > 0.1 ? unit(carrier.velocity, facing) : facing;
    const exit = desired || carrierDirection(request, carrier, qualityFor(request, carrier.id));
    return clamp((1 - clamp(dot(travel, exit), -1, 1)) * 0.5, 0, 1);
  }

  function selectFoot(sequence, facing, desired) {
    const cross = facing.x * desired.y - facing.y * desired.x;
    if (Math.abs(cross) > 0.18) return cross > 0 ? 'left' : 'right';
    return sequence % 2 === 0 ? 'right' : 'left';
  }

  function touchContact(facing, desired) {
    const alignment = facing.x * desired.x + facing.y * desired.y;
    const lateral = Math.abs(facing.x * desired.y - facing.y * desired.x);
    if (alignment < 0.42) return 'inside-cut';
    if (lateral > 0.42) return 'outside-push';
    return 'instep-push';
  }

  function markAction(state, action, tick) {
    if (!action || action.actorId && action.actorId !== state.carrierId) return null;
    const commandTick = action.commandTick || tick;
    if (commandTick > tick) throw new RangeError('Dribbling V2 action commandTick cannot be in the future');
    if (state.consumedActionIds.includes(action.id)) return null;
    if (commandTick < state.consumedActionHighWaterTick ||
        (commandTick === state.consumedActionHighWaterTick && state.consumedActionIdsAtHighWater.includes(action.id))) return null;
    if (state.consumedActionIds.length >= MAX_CONSUMED_ACTION_IDS) throw new Error('Dribbling V2 action identity ledger saturated');
    if (commandTick === state.consumedActionHighWaterTick) {
      if (state.consumedActionIdsAtHighWater.length >= 4) throw new Error('Dribbling V2 action identity ledger saturated');
      state.consumedActionIdsAtHighWater = [...state.consumedActionIdsAtHighWater, action.id];
    } else {
      state.consumedActionHighWaterTick = commandTick;
      state.consumedActionIdsAtHighWater = [action.id];
    }
    state.consumedActionIds = [...state.consumedActionIds, action.id];
    const leaseExpiry = Number.isInteger(state.leaseUntilTick) ? state.leaseUntilTick + 1 : tick;
    return { ...action, actorId: state.carrierId, commandTick,
      expiresTick: Math.max(tick + ACTION_BUFFER_TICKS, leaseExpiry) };
  }

  function secureState(request, previous, ownerId, outcome) {
    const owner = rosterFor(request, ownerId);
    const player = playerFor(request, ownerId);
    const quality = player ? qualityFor(request, ownerId) : { score: 0.7 };
    const retainedCadenceTick = previous.carrierId === ownerId &&
      Number.isInteger(previous.nextTouchTick) && previous.nextTouchTick > request.tick
      ? previous.nextTouchTick : request.tick + touchCadenceTicks(request, player, quality,
        previous.touchSequence + 1);
    return createState({
      ...previous,
      epoch: request.epoch,
      phase: PHASES.SECURED_CONTROL,
      phaseStartedTick: request.tick,
      carrierId: ownerId,
      carrierTeamId: owner && owner.teamId,
      logicalOwnerId: ownerId,
      physicalSeparated: false,
      touchTick: null,
      leaseUntilTick: null,
      foot: null,
      contact: null,
      contactPoint: null,
      touchVelocity: null,
      targetSeparationMetres: 0,
      lastSeparationMetres: 0,
      maxSeparationMetres: 0,
      pressure: 0,
      outcome: outcome || 'secured',
      // A physical touch already selected its next cadence boundary. Preserve
      // that boundary when the ball is resecured instead of restarting a
      // two-tick timer and creating an eight-to-nine-touches-per-second loop.
      nextTouchTick: retainedCadenceTick,
      previousCarrierId: previous.carrierId && previous.carrierId !== ownerId ? previous.carrierId : previous.previousCarrierId
    });
  }

  function touchCadenceTicks(request, carrier, quality, sequence) {
    const mode = carryMode(request, carrier);
    const desired = carrier ? carrierDirection(request, carrier, quality) : { x: 1, y: 0 };
    const turn = turnSeverity(request, carrier, desired);
    const pressure = carrier ? pressureAt(request, carrier).score : 0;
    const cadencePhase = TOUCH_CADENCE_PHASE_TICKS[Math.max(0, Math.trunc(finite(sequence, 0))) %
      TOUCH_CADENCE_PHASE_TICKS.length];
    // Gait supplies the broad interval; the alternating deterministic phase
    // stops a steady carry becoming another metronome. Pressure and a changed
    // exit shorten the next meeting without making elite control synonymous
    // with frantic extra contacts.
    return Math.round(clamp(TOUCH_CADENCE_BASE_TICKS[mode] + cadencePhase - turn * 3 - pressure * 2 +
      (quality.score - 0.7) * 2, CONFIG.minimumTouchCadenceTicks, CONFIG.maximumTouchCadenceTicks));
  }

  function releaseTouch(request, state, carrier) {
    const quality = qualityFor(request, carrier.id), pressure = pressureAt(request, carrier);
    const profile = SURFACE_PROFILES[request.surface], facing = unit(carrier.facing, { x: 1, y: 0 });
    const intended = carrierDirection(request, carrier, quality);
    const sequence = state.touchSequence + 1;
    const foot = selectFoot(sequence, facing, intended), contact = touchContact(facing, intended);
    const randomError = random01(request.seed, [request.epoch, request.tick, carrier.id, sequence, 'touch-error'].join('|')) * 2 - 1;
    const errorMagnitude = randomError * ((1 - quality.score) * 0.18 + pressure.score * 0.11 + profile.error);
    const perpendicular = { x: -intended.y, y: intended.x };
    const direction = unit({ x: intended.x + perpendicular.x * errorMagnitude, y: intended.y + perpendicular.y * errorMagnitude }, intended);
    const carrierSpeed = length(carrier.velocity), intensity = request.carrierInput.intensity || clamp(carrierSpeed / 7.2, 0, 1);
    const mode = carryMode(request, carrier), turn = turnSeverity(request, carrier, intended);
    const targetSeparation = clamp((0.56 + carrierSpeed * 0.055 + intensity * 0.25 +
      (1 - quality.score) * 0.34 + pressure.score * 0.18) * profile.distanceMultiplier *
      TOUCH_DISTANCE_MULTIPLIER[mode] * (1 - turn * 0.3), 0.44, 1.48);
    const leaseTicks = Math.round(clamp(10 + targetSeparation * 3 + (1 - quality.score) * 2 +
      pressure.score * 2 + profile.leaseTicks, CONFIG.minimumLeaseTicks, CONFIG.maximumLeaseTicks));
    // Match footage and the strict-V2 playtest both require readable carries,
    // not a complete release/chase/gather cycle every seven simulation ticks.
    // Faster movement shortens the interval, while control quality keeps the
    // touch economical; even a sprint remains a physical 1/3-second cadence.
    const cadenceTicks = touchCadenceTicks(request, carrier, quality, sequence + 1);
    const lateralOffset = foot === 'left' ? 0.105 : -0.105;
    const forwardOffset = (clamp(finite(carrier.radius, 0.34), 0.2, 0.65) + request.ballState.radius + 0.055) *
      (1 - turn * 0.28);
    const contactPoint = {
      x: carrier.position.x + facing.x * forwardOffset - facing.y * lateralOffset,
      y: carrier.position.y + facing.y * forwardOffset + facing.x * lateralOffset
    };
    const additionalSpeed = (1.15 + targetSeparation * 0.92 + pressure.score * 0.45 +
      (1 - quality.score) * 0.35) * profile.speedMultiplier;
    const carrierAlongExit = dot(carrier.velocity, direction);
    const retainedAlong = Math.max(0, carrierAlongExit) * (0.86 - turn * 0.18);
    const lateralVelocity = {
      x: carrier.velocity.x - direction.x * carrierAlongExit,
      y: carrier.velocity.y - direction.y * carrierAlongExit
    };
    const lateralRetention = 0.18 * Math.pow(1 - turn, 2);
    const touchVelocity = {
      x: direction.x * (retainedAlong + additionalSpeed) + lateralVelocity.x * lateralRetention,
      y: direction.y * (retainedAlong + additionalSpeed) + lateralVelocity.y * lateralRetention
    };
    const metadata = clone(request.ballState.metadata || {});
    metadata.dribbling = {
      schema: STATE_SCHEMA,
      version: VERSION,
      epoch: request.epoch,
      touchSequence: sequence,
      playerId: carrier.id,
      foot,
      contact,
      surface: profile.id,
      targetSeparationMetres: +targetSeparation.toFixed(4)
    };
    const ballState = Ball.createBallState({
      ...request.ballState,
      position: { x: contactPoint.x, y: contactPoint.y, z: request.ballState.radius },
      velocity: { x: touchVelocity.x, y: touchVelocity.y, z: 0 },
      regime: Ball.REGIMES.SKID,
      grounded: true,
      settled: false,
      settleTime: 0,
      contactCount: request.ballState.contactCount + 1,
      lastContact: {
        colliderId: 'dribble-boot:' + carrier.id + ':' + foot,
        materialId: 'boot',
        normal: { x: -direction.x, y: -direction.y, z: 0 },
        normalSpeed: Math.max(0, additionalSpeed),
        outerTick: request.tick,
        substepCount: 0
      },
      lastOuterTick: request.tick,
      metadata
    });
    const nextState = createState({
      ...state,
      phase: PHASES.SEPARATED_TOUCH,
      phaseStartedTick: request.tick,
      carrierId: carrier.id,
      carrierTeamId: rosterFor(request, carrier.id).teamId,
      logicalOwnerId: carrier.id,
      physicalSeparated: true,
      touchSequence: sequence,
      touchTick: request.tick,
      nextTouchTick: request.tick + cadenceTicks,
      leaseUntilTick: request.tick + leaseTicks,
      foot,
      contact,
      contactPoint,
      touchVelocity,
      targetSeparationMetres: targetSeparation,
      lastSeparationMetres: Math.hypot(ballState.position.x - carrier.position.x, ballState.position.y - carrier.position.y),
      maxSeparationMetres: 0,
      surface: profile.id,
      pressure: pressure.score,
      outcome: 'released'
    });
    nextState.maxSeparationMetres = nextState.lastSeparationMetres;
    return { state: nextState, ballState, quality, pressure };
  }

  function controlledBall(request, player, state, outcome) {
    const metadata = clone(request.ballState.metadata || {});
    metadata.dribbling = {
      ...(metadata.dribbling || {}),
      schema: STATE_SCHEMA,
      version: VERSION,
      phase: outcome,
      outcome,
      resolvedTick: request.tick,
      touchSequence: state.touchSequence,
      playerId: player.id
    };
    return Ball.createBallState({
      ...request.ballState,
      velocity: { x: finite(player.velocity.x, 0), y: finite(player.velocity.y, 0), z: 0 },
      regime: Ball.REGIMES.CONTROLLED,
      grounded: true,
      settled: false,
      settleTime: 0,
      lastOuterTick: Math.max(request.ballState.lastOuterTick, request.tick),
      metadata
    });
  }

  function terminalState(request, state, phase, ownerId, outcome, physicalSeparated) {
    const owner = ownerId && rosterFor(request, ownerId);
    return createState({
      ...state,
      phase,
      phaseStartedTick: request.tick,
      carrierId: ownerId,
      carrierTeamId: owner && owner.teamId,
      logicalOwnerId: ownerId,
      physicalSeparated: Boolean(physicalSeparated),
      leaseUntilTick: null,
      bufferedAction: null,
      outcome,
      previousCarrierId: ownerId !== state.carrierId ? state.carrierId : state.previousCarrierId
    });
  }

  function presentationFor(state, ballState, releasedAction) {
    const phase = state.phase;
    const animationPhase = phase === PHASES.TOUCH_PREPARATION ? 'dribble-windup'
      : phase === PHASES.SEPARATED_TOUCH ? 'dribble-contact'
        : phase === PHASES.CHASE_RECOVERY ? 'dribble-chase'
          : phase === PHASES.RESECURE ? 'dribble-gather'
            : phase === PHASES.HEAVY_TOUCH ? 'dribble-heavy'
              : phase === PHASES.SHIELD ? 'dribble-shield'
                : phase === PHASES.TURNOVER ? 'dribble-turnover'
                  : 'dribble-secured';
    return {
      schema: 'football-legacy-dribbling-presentation-v2',
      phase,
      animationPhase,
      playerId: state.carrierId,
      previousCarrierId: state.previousCarrierId,
      foot: state.foot,
      contact: state.contact,
      contactPoint: clone(state.contactPoint),
      ballPosition: ballState ? clone(ballState.position) : null,
      separationMetres: +state.lastSeparationMetres.toFixed(4),
      targetSeparationMetres: +state.targetSeparationMetres.toFixed(4),
      outcome: state.outcome,
      releasedAction: clone(releasedAction)
    };
  }

  function makeResult(request, state, ballState, releasedAction, quality, pressure) {
    const telemetry = {
      schema: 'football-legacy-dribbling-telemetry-v2',
      version: VERSION,
      eventId: ['dribble', request.epoch, request.tick, state.touchSequence, state.phase].join(':'),
      tick: request.tick,
      epoch: request.epoch,
      workflow: request.workflow,
      phase: state.phase,
      animationPhase: presentationFor(state, null, null).animationPhase,
      carrierId: state.carrierId,
      logicalOwnerId: state.logicalOwnerId,
      physicalSeparated: state.physicalSeparated,
      touchSequence: state.touchSequence,
      foot: state.foot,
      contact: state.contact,
      separationMetres: +state.lastSeparationMetres.toFixed(4),
      maxSeparationMetres: +state.maxSeparationMetres.toFixed(4),
      targetSeparationMetres: +state.targetSeparationMetres.toFixed(4),
      pressure: +(pressure ? pressure.score : state.pressure).toFixed(4),
      nearestPressurePlayerId: pressure && pressure.nearestId || null,
      surface: state.surface,
      quality: quality ? {
        control: quality.control,
        technique: quality.technique,
        agility: quality.agility,
        score: +quality.score.toFixed(4)
      } : null,
      outcome: state.outcome,
      bufferedActionId: state.bufferedAction && state.bufferedAction.id || null,
      releasedActionId: releasedAction && releasedAction.id || null,
      physicsProfile: 'shared-human-cpu-ratings-neutral'
    };
    const handoff = /-handoff$/.test(String(state.outcome || '')) ? {
      id: ['dribble-handoff', request.epoch, request.tick, state.outcome].join(':'),
      authority: state.outcome === 'protected-skill-handoff' ? 'build-173-protected-skill' : 'build-173-protected-workflow',
      reason: state.outcome,
      executeExactlyOnce: true
    } : null;
    return deepFreeze({
      schema: RESULT_SCHEMA,
      version: VERSION,
      tick: request.tick,
      epoch: request.epoch,
      workflow: request.workflow,
      online: false,
      state: createState(state),
      serializedState: serializeState(state),
      ballState: detachedBallState(ballState),
      logicalOwnerId: state.logicalOwnerId,
      physicalSeparated: state.physicalSeparated,
      releasedAction: clone(releasedAction),
      authorityHandoff: handoff,
      telemetry,
      presentation: presentationFor(state, ballState, releasedAction)
    });
  }

  function resolve(input, capability) {
    const request = normalizeRequest(input, capability);
    let state = createState(request.state), ballState = Ball.cloneBallState(request.ballState);
    let releasedAction = null, quality = null, pressure = null;
    const protectedGate = !request.gate.livePlay || request.gate.restartActive || request.gate.replayActive ||
      request.gate.keeperAuthority || request.gate.offsideInvolvementPending || request.gate.specialActionAuthority;
    if (protectedGate) {
      const handoffOutcome = request.gate.specialActionAuthority ? 'protected-skill-handoff'
        : request.gate.restartActive ? 'protected-restart-handoff'
          : request.gate.replayActive ? 'protected-replay-handoff'
            : request.gate.keeperAuthority ? 'protected-keeper-handoff'
              : request.gate.offsideInvolvementPending ? 'protected-offside-handoff'
                : 'protected-stoppage-handoff';
      state = createState({ ...blankState(request.epoch), touchSequence: state.touchSequence,
        consumedActionIds: state.consumedActionIds,
        consumedActionHighWaterTick: state.consumedActionHighWaterTick,
        consumedActionIdsAtHighWater: state.consumedActionIdsAtHighWater,
        phaseStartedTick: request.tick, outcome: handoffOutcome });
      return makeResult(request, state, ballState, null, null, null);
    }

    const activeLease = state.physicalSeparated && [PHASES.SEPARATED_TOUCH, PHASES.CHASE_RECOVERY].includes(state.phase);
    let ownerId = activeLease ? state.logicalOwnerId : request.logicalOwnerId;
    const ownerRoster = ownerId && rosterFor(request, ownerId);
    const ownerPlayer = ownerId && playerFor(request, ownerId);
    if (ownerId && (!ownerRoster || !ownerPlayer || ownerRoster.isGK || ownerRoster.sentOff || !ownerRoster.available)) ownerId = null;

    if (!ownerId) {
      state = createState({ ...blankState(request.epoch), touchSequence: state.touchSequence,
        consumedActionIds: state.consumedActionIds,
        consumedActionHighWaterTick: state.consumedActionHighWaterTick,
        consumedActionIdsAtHighWater: state.consumedActionIdsAtHighWater,
        phaseStartedTick: request.tick,
        previousCarrierId: state.carrierId || state.previousCarrierId, outcome: activeLease ? 'heavy-touch' : 'loose' });
      return makeResult(request, state, ballState, null, null, null);
    }

    if (state.phase === PHASES.IDLE || !state.carrierId || (!activeLease && state.carrierId !== ownerId)) {
      state = secureState(request, state, ownerId, state.carrierId && state.carrierId !== ownerId ? 'turnover-secured' : 'secured');
    }
    const carrier = playerFor(request, state.carrierId), currentAction = markAction(state, request.actionIntent, request.tick);

    if ([PHASES.TOUCH_PREPARATION, PHASES.SEPARATED_TOUCH, PHASES.CHASE_RECOVERY].includes(state.phase) && currentAction) {
      const prior = state.bufferedAction;
      // One physical touch should preserve the decision already made over the
      // ball, not let a CPU carrier reroll its pass target every six ticks as
      // the lease progresses. A newly available shot may supersede a pass;
      // explicit human input may supersede either. Both still wait for real
      // resecure, and neither receives ownership from the buffer itself.
      const explicitHumanUpdate = currentAction.source !== 'cpu-v2';
      const shotUpgrade = currentAction.type === 'shot' && (!prior || prior.type !== 'shot');
      if (!prior || explicitHumanUpdate || shotUpgrade) state.bufferedAction = currentAction;
    } else if ([PHASES.SECURED_CONTROL, PHASES.RESECURE, PHASES.SHIELD].includes(state.phase) && currentAction) {
      releasedAction = currentAction;
    }
    if (state.bufferedAction && request.tick > state.bufferedAction.expiresTick) state.bufferedAction = null;

    if (state.phase === PHASES.RESECURE || state.phase === PHASES.TURNOVER) {
      state = secureState(request, state, state.carrierId, state.outcome);
    } else if (state.phase === PHASES.HEAVY_TOUCH) {
      state = createState({ ...blankState(request.epoch), touchSequence: state.touchSequence,
        consumedActionIds: state.consumedActionIds,
        consumedActionHighWaterTick: state.consumedActionHighWaterTick,
        consumedActionIdsAtHighWater: state.consumedActionIdsAtHighWater,
        phaseStartedTick: request.tick,
        previousCarrierId: state.previousCarrierId, outcome: 'loose-after-heavy-touch' });
      return makeResult(request, state, ballState, null, null, null);
    }

    if (state.phase === PHASES.SHIELD) {
      if (request.carrierInput.shield) {
        state.outcome = 'shield';
        return makeResult(request, state, ballState, releasedAction, qualityFor(request, carrier.id), pressureAt(request, carrier));
      }
      state = secureState(request, state, carrier.id, 'shield-released');
    }

    if (state.phase === PHASES.SECURED_CONTROL) {
      quality = qualityFor(request, carrier.id); pressure = pressureAt(request, carrier);
      const requestedTurn = turnSeverity(request, carrier, carrierDirection(request, carrier, quality));
      if (!releasedAction && requestedTurn >= 0.35) {
        const turnPreparationTicks = Math.round(clamp(5 + (1 - quality.score) * 3, 5, 8));
        const replannedTouchTick = request.tick + turnPreparationTicks;
        if (state.nextTouchTick > replannedTouchTick) {
          state.nextTouchTick = replannedTouchTick;
          state.outcome = 'turn-replanned';
        }
      }
      if (request.carrierInput.shield) {
        state = createState({ ...state, phase: PHASES.SHIELD, phaseStartedTick: request.tick,
          outcome: 'shield', pressure: pressure.score, physicalSeparated: false });
      } else if (!releasedAction && request.tick >= state.nextTouchTick &&
          (request.carrierInput.intensity >= CONFIG.minimumControlIntensity || length(carrier.velocity) >= CONFIG.minimumCarrierSpeed)) {
        state = createState({ ...state, phase: PHASES.TOUCH_PREPARATION, phaseStartedTick: request.tick,
          surface: request.surface, pressure: pressure.score, outcome: 'preparing' });
      } else if (releasedAction) state.outcome = 'action-released';
      else if (state.outcome !== 'turn-replanned') state.outcome = 'secured';
      return makeResult(request, state, ballState, releasedAction, quality, pressure);
    }

    if (state.phase === PHASES.TOUCH_PREPARATION) {
      quality = qualityFor(request, carrier.id); pressure = pressureAt(request, carrier);
      if (request.carrierInput.shield) {
        state = createState({ ...state, phase: PHASES.SHIELD, phaseStartedTick: request.tick,
          physicalSeparated: false, outcome: 'shield', pressure: pressure.score });
      } else if (request.tick - state.phaseStartedTick >= CONFIG.preparationTicks) {
        const release = releaseTouch(request, state, carrier);
        state = release.state; ballState = release.ballState; quality = release.quality; pressure = release.pressure;
      }
      return makeResult(request, state, ballState, null, quality, pressure);
    }

    if (state.phase === PHASES.SEPARATED_TOUCH || state.phase === PHASES.CHASE_RECOVERY) {
      quality = qualityFor(request, carrier.id); pressure = pressureAt(request, carrier);
      const separation = Math.hypot(ballState.position.x - carrier.position.x, ballState.position.y - carrier.position.y);
      state.lastSeparationMetres = separation;
      state.maxSeparationMetres = Math.max(state.maxSeparationMetres, separation);
      state.pressure = pressure.score;
      if (state.phase === PHASES.SEPARATED_TOUCH) {
        state.phase = PHASES.CHASE_RECOVERY;
        state.phaseStartedTick = request.tick;
        state.outcome = 'chasing';
        return makeResult(request, state, ballState, null, quality, pressure);
      }

      const opponent = nearestOpponentToBall(request, carrier.id, ballState.position);
      const captureRadius = clamp(CONFIG.captureRadiusMin + quality.score * 0.18 - pressure.score * 0.04,
        CONFIG.captureRadiusMin, CONFIG.captureRadiusMax);
      const heavyThreshold = clamp(CONFIG.heavySeparationMin + quality.score * 0.7 - pressure.score * 0.2,
        CONFIG.heavySeparationMin, CONFIG.heavySeparationMax);
      const opponentCaptureRadius = opponent
        ? clamp(finite(opponent.player.radius, 0.34), 0.2, 0.65) + ballState.radius + 0.11 : 0;
      const opponentWins = opponent && opponent.distance <= opponentCaptureRadius &&
        opponent.distance + CONFIG.turnoverMargin < separation && !request.carrierInput.shield;
      if (opponentWins) {
        ballState = controlledBall(request, opponent.player, state, 'turnover');
        state = terminalState(request, state, PHASES.TURNOVER, opponent.roster.id, 'turnover', false);
      } else if (request.carrierInput.shield && separation <= captureRadius + 0.12) {
        ballState = controlledBall(request, carrier, state, 'shield');
        state = terminalState(request, state, PHASES.SHIELD, carrier.id, 'shield', false);
      } else if (request.tick - state.touchTick >= CONFIG.minimumSeparatedTicks && separation <= captureRadius) {
        ballState = controlledBall(request, carrier, state, 'resecure');
        releasedAction = state.bufferedAction && request.tick <= state.bufferedAction.expiresTick
          ? clone(state.bufferedAction) : null;
        state = terminalState(request, state, PHASES.RESECURE, carrier.id, 'resecure', false);
      } else if (separation > heavyThreshold || request.tick > state.leaseUntilTick) {
        state = terminalState(request, state, PHASES.HEAVY_TOUCH, null, 'heavy-touch', false);
      } else state.outcome = 'chasing';
      return makeResult(request, state, ballState, releasedAction, quality, pressure);
    }

    return makeResult(request, state, ballState, releasedAction, quality, pressure);
  }

  return Object.freeze({
    ENGINE_NAME,
    VERSION,
    STATE_SCHEMA,
    REQUEST_SCHEMA,
    RESULT_SCHEMA,
    CAPABILITY_SCHEMA,
    SERIALIZED_SCHEMA,
    ACKNOWLEDGEMENT,
    SUPPORTED_WORKFLOWS,
    FIXED_TICK_SECONDS,
    PHASES,
    SURFACE_PROFILES,
    CONFIG,
    createCapability,
    createState,
    serializeState,
    restoreState,
    resolve
  });
});
