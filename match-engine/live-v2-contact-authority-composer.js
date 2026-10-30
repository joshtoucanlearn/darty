'use strict';

/*
 * Football Legacy V2 live contact authority composer.
 *
 * This module deliberately has no host mutation surface. It promotes the
 * reviewed First-Touch Authority Adapter and Aerial / Volley Contact resolver
 * into one detached, deterministic contact plan. The normal-match live adapter
 * must stage this plan inside its existing planTick/commitTick transaction.
 */
(function exposeLiveV2ContactAuthorityComposer(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./movement-engine-v2.js') : root && root.FootballLegacyMovementEngineV2,
    typeof module === 'object' && module.exports ? require('./ball-engine-v2.js') : root && root.FootballLegacyBallEngineV2,
    typeof module === 'object' && module.exports ? require('./first-touch-authority-adapter-v2.js') : root && root.FootballLegacyFirstTouchAuthorityAdapterV2,
    typeof module === 'object' && module.exports ? require('./aerial-contact-v2.js') : root && root.FootballLegacyAerialContactV2
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyLiveV2ContactAuthorityComposer = api;
})(typeof window === 'object' ? window : null, function createLiveV2ContactAuthorityComposerApi(Movement, Ball, FirstTouchAuthority, Aerial) {
  'use strict';

  const VERSION = '1.0.0-offline-live-contact-composer-playtest';
  const REQUEST_SCHEMA = 'football-legacy-live-v2-contact-composer-request';
  const RESULT_SCHEMA = 'football-legacy-live-v2-contact-composer-result';
  const CAPABILITY_SCHEMA = 'football-legacy-live-v2-contact-composer-capability';
  const ACKNOWLEDGEMENT = 'EXPLICIT_OFFLINE_LIVE_V2_CONTACT_COMPOSITION';
  const AUTHORITY = 'offline-live-v2-contact-plan';
  const WORKFLOW = 'single-player';
  const SUPPORTED_WORKFLOWS = Object.freeze(['single-player', 'cpu-v-cpu']);
  const PARENT_VERSION = '1.0.0-offline-live-authority-playtest';
  const FIXED_TICK_SECONDS = 1 / 60;
  const COORDINATE_SYSTEM = 'si-metres-centred-pitch-positive-z-up';
  const FIRST_TOUCH_WORKFLOW = 'offline-v2-lab';
  const DRIBBLE_CONTINUATION_PHASE = 'dribble-continuation';
  // Ownership is granted only at a real playable foot-contact distance. The
  // player may be assisted toward the ball by Movement V2, but the ball must
  // never bridge the old two-metre-plus Build 173 reception radius.
  const FIRST_TOUCH_ACQUISITION_RADIUS_METRES = 0.74;
  const MAX_LEDGER_IDS = 256;
  const MAX_RECENT_FIRST_TOUCH_IDS = 64;
  const RETAINED_RECONTACT_MIN_TICKS = 20;
  const RETAINED_RECONTACT_MAX_LOCK_TICKS = 45;
  const RETAINED_RECONTACT_MIN_TRAVEL_METRES = 0.9;
  const LOOSE_RECONTROL_DELAY_MIN_TICKS = 5;
  const LOOSE_RECONTROL_DELAY_RATING_DIVISOR = 9;
  // The releasing player has deliberately created the flight and must not be
  // reinterpreted as a passive bystander while the ball is still clearing
  // their body. Keep this longer than the entire rating-led reaction window;
  // opponents and non-target teammates remain physically active throughout.
  const SOURCE_RELEASE_BODY_PROTECTION_TICKS = 18;
  const REACTION_DELAY_MIN_TICKS = 3;
  const REACTION_DELAY_RATING_DIVISOR = 11;
  const INTENDED_RECEIVER_ANTICIPATION_TICKS = 3;
  const MAX_REACTION_DELAY_TICKS = REACTION_DELAY_MIN_TICKS + Math.round(98 / REACTION_DELAY_RATING_DIVISOR);
  const MAX_TICK = 1000000000;
  const MAX_SEED = 0xffffffff;
  const issuedCapabilities = new WeakSet();

  const DEPENDENCY_CONTRACTS = Object.freeze({
    movement: Object.freeze({ version: '2.0.0-dormant', schemas: Object.freeze({
      PLAYER_SCHEMA: 'football-legacy-movement-player-v2',
      WORLD_SCHEMA: 'football-legacy-movement-world-v2'
    }) }),
    ball: Object.freeze({ version: '2.0.0-shadow', schemas: Object.freeze({
      STATE_SCHEMA: 'football-legacy-ball-v2-state',
      LAUNCH_SCHEMA: 'football-legacy-ball-v2-launch-intent'
    }) }),
    firstTouchAuthority: Object.freeze({ version: '2.0.0-dormant-authority-adapter', schemas: Object.freeze({
      REQUEST_SCHEMA: 'football-legacy-first-touch-authority-adapter-v2-request',
      RESULT_SCHEMA: 'football-legacy-first-touch-authority-adapter-v2-result',
      HANDOFF_SCHEMA: 'football-legacy-first-touch-authority-handoff-v2'
    }) }),
    aerial: Object.freeze({ version: '2.0.0-dormant', schemas: Object.freeze({
      REQUEST_SCHEMA: 'football-legacy-aerial-contact-v2-request',
      RESULT_SCHEMA: 'football-legacy-aerial-contact-v2-result',
      BALL_LAUNCH_SCHEMA: 'football-legacy-ball-v2-launch-intent'
    }) })
  });

  function assertDependencies() {
    const dependencies = { movement: Movement, ball: Ball, firstTouchAuthority: FirstTouchAuthority, aerial: Aerial };
    for (const [name, contract] of Object.entries(DEPENDENCY_CONTRACTS)) {
      const api = dependencies[name];
      if (!api || api.VERSION !== contract.version) throw new Error(name + ' V2 version mismatch');
      for (const [key, value] of Object.entries(contract.schemas)) {
        if (api[key] !== value) throw new Error(name + ' V2 ' + key + ' mismatch');
      }
    }
    if (typeof Movement.createWorldState !== 'function' || typeof Ball.createBallState !== 'function' ||
        typeof Ball.resolveLaunch !== 'function' || typeof FirstTouchAuthority.createCapability !== 'function' ||
        typeof Ball.resolvePassiveBodyDeflection !== 'function' ||
        typeof FirstTouchAuthority.resolve !== 'function' || typeof Aerial.createShadowCapability !== 'function' ||
        typeof Aerial.resolveContact !== 'function') throw new Error('live contact dependency API is incomplete');
  }

  function finite(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(label + ' must be finite');
    return Number(value);
  }

  function integer(value, minimum, maximum, label) {
    const number = finite(value, label);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
      throw new RangeError(label + ' must be an integer within ' + minimum + '..' + maximum);
    }
    return number;
  }

  function stableId(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new TypeError(label + ' must be a stable identifier');
    }
    return value;
  }

  function plainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError(label + ' must be a plain object');
    }
    return value;
  }

  function clone(value, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finite(value, 'JSON value');
    if (!value || typeof value !== 'object') throw new TypeError('contact plan data must be JSON-safe');
    const active = seen || new WeakSet();
    if (active.has(value)) throw new TypeError('contact plan data must not contain cycles');
    active.add(value);
    const output = Array.isArray(value) ? [] : {};
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
      active.delete(value); throw new TypeError('contact plan data must use plain objects');
    }
    for (const key of Object.keys(value)) output[key] = clone(value[key], active);
    active.delete(value);
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

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(key => { result[key] = stableValue(value[key]); });
    return result;
  }

  function stableJson(value) { return JSON.stringify(stableValue(clone(value))); }

  function digest(value) {
    const text = stableJson(value);
    let first = 2166136261, second = 3339675911;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619) >>> 0;
      second = Math.imul(second ^ (code + (index & 255)), 2246822519) >>> 0;
    }
    return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
  }

  function createCapability(options) {
    assertDependencies();
    const source = plainObject(clone(options || {}), 'capability');
    if (source.enabled !== true || source.online !== false || !SUPPORTED_WORKFLOWS.includes(source.workflow) ||
        source.parentAdapterVersion !== PARENT_VERSION || source.parentGrant !== 'offline-normal-match-live-authority' ||
        source.acknowledgement !== ACKNOWLEDGEMENT) {
      throw new Error('exact offline Single Player or CPU-v-CPU live contact capability is required');
    }
    const capability = deepFreeze({
      schema: CAPABILITY_SCHEMA,
      version: VERSION,
      authority: AUTHORITY,
      workflow: source.workflow,
      online: false,
      parentAdapterVersion: PARENT_VERSION,
      parentGrant: source.parentGrant,
      exactOnce: true,
      transactionalPlanOnly: true
    });
    issuedCapabilities.add(capability);
    return capability;
  }

  function assertCapability(capability) {
    if (!capability || !issuedCapabilities.has(capability) || capability.schema !== CAPABILITY_SCHEMA ||
        capability.version !== VERSION || capability.authority !== AUTHORITY || !SUPPORTED_WORKFLOWS.includes(capability.workflow) ||
        capability.online !== false || capability.parentAdapterVersion !== PARENT_VERSION ||
        capability.parentGrant !== 'offline-normal-match-live-authority' || capability.exactOnce !== true ||
        capability.transactionalPlanOnly !== true) throw new Error('issued live contact capability is required');
  }

  function normalizeLedger(value, prefix, label, maximum = MAX_LEDGER_IDS) {
    if (!Array.isArray(value) || value.length > maximum) throw new TypeError(label + ' must be a bounded array');
    const seen = new Set();
    const result = value.map((entry, index) => {
      stableId(entry, label + '[' + index + ']');
      if (!String(entry).startsWith(prefix)) throw new TypeError(label + '[' + index + '] has the wrong authority prefix');
      if (seen.has(entry)) throw new TypeError(label + ' must not contain duplicate IDs');
      seen.add(entry); return entry;
    });
    return result;
  }

  function appendRecentFirstTouchId(ids, id) {
    return [...ids, id].slice(-MAX_RECENT_FIRST_TOUCH_IDS);
  }

  function normalizeRoster(value, world) {
    if (!Array.isArray(value)) throw new TypeError('roster must be an array');
    const worldIds = new Set(world.players.map(player => player.id));
    const ids = new Set();
    const roster = value.map((entry, index) => {
      const source = plainObject(entry, 'roster[' + index + ']');
      const id = stableId(source.id, 'roster[' + index + '].id');
      if (ids.has(id)) throw new TypeError('roster IDs must be unique');
      ids.add(id);
      if (!worldIds.has(id)) throw new Error('roster player must exist in Movement V2 world');
      return {
        id,
        teamId: stableId(source.teamId, 'roster[' + index + '].teamId'),
        isGK: source.isGK === true,
        sentOff: source.sentOff === true,
        available: source.available !== false,
        contactEligible: source.contactEligible !== false,
        bodyContactEligible: source.bodyContactEligible !== false,
        heightM: Math.max(1.3, Math.min(2.2, finite(source.heightM == null ? 1.8 : source.heightM, 'roster height'))),
        attributes: clone(source.attributes || {})
      };
    });
    for (const player of world.players) if (!ids.has(player.id)) throw new Error('every Movement V2 player needs one roster record');
    return roster.sort((a, b) => a.id.localeCompare(b.id));
  }

  function normalizeReactionContext(value, tick, roster) {
    if (value == null) return null;
    const source = plainObject(value, 'reactionContext');
    if (source.active !== true || source.stimulus !== 'deliberate-pass-release') {
      throw new Error('reactionContext must describe one active deliberate pass release');
    }
    const releaseTick = integer(source.releaseTick, 1, tick, 'reactionContext.releaseTick');
    const sourcePlayerId = stableId(source.sourcePlayerId, 'reactionContext.sourcePlayerId');
    const sourceTeamId = stableId(source.sourceTeamId, 'reactionContext.sourceTeamId');
    if (!roster.some(player => player.teamId === sourceTeamId)) {
      throw new Error('reactionContext source team is not represented in contact roster');
    }
    const previous = plainObject(source.previousBallPosition, 'reactionContext.previousBallPosition');
    return {
      active: true,
      stimulus: 'deliberate-pass-release',
      releaseTick,
      sourcePlayerId,
      sourceTeamId,
      previousBallPosition: {
        x: finite(previous.x, 'reactionContext.previousBallPosition.x'),
        y: finite(previous.y, 'reactionContext.previousBallPosition.y'),
        z: finite(previous.z, 'reactionContext.previousBallPosition.z')
      }
    };
  }

  function normalizeAerialIntent(value, tick, epoch, roster) {
    if (value == null) return null;
    const source = plainObject(value, 'aerialIntent');
    const commandEpoch = integer(source.epoch, 0, MAX_TICK, 'aerialIntent.epoch');
    const commandTick = integer(source.commandTick, 1, tick, 'aerialIntent.commandTick');
    const sequence = stableId(source.sequence, 'aerialIntent.sequence');
    const actorId = stableId(source.actorId, 'aerialIntent.actorId');
    const actor = roster.find(player => player.id === actorId);
    if (!actor || actor.sentOff || actor.isGK || !actor.available || !actor.contactEligible) {
      throw new Error('aerial actor must be an eligible outfield roster player');
    }
    if (commandEpoch !== epoch) throw new Error('aerial intent belongs to a different transaction epoch');
    const technique = String(source.technique || 'auto');
    if (!Object.values(Aerial.TECHNIQUES).includes(technique)) throw new Error('unsupported aerial technique');
    const intent = String(source.intent || 'shoot');
    if (!Object.values(Aerial.INTENTS).includes(intent)) throw new Error('unsupported aerial intent');
    const target = plainObject(source.target, 'aerialIntent.target');
    return {
      sequence, epoch: commandEpoch, commandTick, actorId, technique, intent,
      target: { x: finite(target.x, 'aerialIntent.target.x'), y: finite(target.y, 'aerialIntent.target.y'), z: finite(target.z, 'aerialIntent.target.z') }
    };
  }

  function normalizeRequest(input, workflow) {
    const source = plainObject(clone(input || {}), 'request');
    if (source.schema !== REQUEST_SCHEMA || source.workflow !== workflow || source.online !== false) {
      throw new Error('live contact request must match the exact approved offline workflow');
    }
    const tick = integer(source.tick, 1, MAX_TICK, 'request.tick');
    const epoch = integer(source.epoch, 0, MAX_TICK, 'request.epoch');
    const seed = integer(source.seed, 1, MAX_SEED, 'request.seed');
    if (Math.abs(finite(source.fixedTickSeconds, 'request.fixedTickSeconds') - FIXED_TICK_SECONDS) > 1e-12) {
      throw new Error('live contact fixed tick must be exactly 1/60');
    }
    const world = Movement.createWorldState(source.movementWorld);
    if (world.tick !== tick) throw new Error('Movement V2 world must be at the contact tick');
    if (world.ballOwnerId != null) throw new Error('live contact composer accepts only a loose Ball V2 world');
    if (!Ball.isBallState(source.ballState)) throw new TypeError('complete Ball V2 state is required');
    const ballState = Ball.createBallState(source.ballState, { radius: source.ballState.radius, mass: source.ballState.mass });
    if (ballState.lastOuterTick !== tick) throw new Error('Ball V2 state must be integrated through the contact tick');
    const roster = normalizeRoster(source.roster, world);
    const intendedReceiverId = source.intendedReceiverId == null ? null : stableId(source.intendedReceiverId, 'intendedReceiverId');
    if (intendedReceiverId && !roster.some(player => player.id === intendedReceiverId)) throw new Error('intended receiver is not in roster');
    const gate = plainObject(source.gate || {}, 'gate');
    const firstTouchLedger = normalizeLedger(source.consumedFirstTouchIds || [], 'first-touch-v2:',
      'consumedFirstTouchIds', MAX_RECENT_FIRST_TOUCH_IDS);
    const aerialLedger = normalizeLedger(source.consumedAerialIds || [], 'aerial-v2:', 'consumedAerialIds');
    const consumedFirstTouchThroughTick = source.consumedFirstTouchThroughTick == null ? 0
      : integer(source.consumedFirstTouchThroughTick, 0, tick, 'consumedFirstTouchThroughTick');
    const reactionContext = normalizeReactionContext(source.reactionContext, tick, roster);
    return {
      schema: REQUEST_SCHEMA, workflow, online: false, tick, epoch, seed,
      fixedTickSeconds: FIXED_TICK_SECONDS, world, ballState, roster, intendedReceiverId,
      firstTouchIntent: source.firstTouchIntent && typeof source.firstTouchIntent === 'object' ? clone(source.firstTouchIntent) : null,
      reactionContext,
      aerialIntent: normalizeAerialIntent(source.aerialIntent, tick, epoch, roster),
      consumedFirstTouchIds: firstTouchLedger, consumedFirstTouchThroughTick,
      consumedAerialIds: aerialLedger,
      gate: {
        livePlay: gate.livePlay === true,
        restartActive: gate.restartActive === true,
        replayActive: gate.replayActive === true,
        keeperAuthority: gate.keeperAuthority === true,
        offsideInvolvementPending: gate.offsideInvolvementPending === true,
        specialActionAuthority: gate.specialActionAuthority === true
      }
    };
  }

  function centreSnapshot(request) {
    const centre = { x: 52.5, y: 0 };
    const movementWorld = Movement.createWorldState({
      tick: request.tick,
      fixedTickSeconds: FIXED_TICK_SECONDS,
      bounds: { xMin: -52.5, xMax: 52.5, yMin: -34, yMax: 34 },
      ballOwnerId: null,
      players: request.world.players.map(player => ({
        ...player,
        position: { x: player.position.x - centre.x, y: player.position.y - centre.y }
      }))
    });
    const ballState = Ball.createBallState({
      ...request.ballState,
      position: {
        x: request.ballState.position.x - centre.x,
        y: request.ballState.position.y - centre.y,
        z: request.ballState.position.z
      }
    }, { radius: request.ballState.radius, mass: request.ballState.mass });
    return { centre, movementWorld, ballState };
  }

  function ballToPitch(ball, centre) {
    return Ball.createBallState({
      ...ball,
      position: { x: ball.position.x + centre.x, y: ball.position.y + centre.y, z: ball.position.z }
    }, { radius: ball.radius, mass: ball.mass });
  }

  function rosterAttributes(roster) {
    const attributes = roster.attributes || {};
    const rating = (name, fallback) => Math.max(1, Math.min(99, finite(attributes[name] == null ? fallback : attributes[name], 'roster.' + name)));
    return {
      heading: rating('heading', 70), jumping: rating('jumping', 70), strength: rating('strength', 70),
      technique: rating('technique', rating('control', 70)), shooting: rating('shooting', rating('shoot', 70)),
      volleys: rating('volleys', rating('shoot', 70)), balance: rating('balance', 70), agility: rating('agility', 70),
      awareness: rating('awareness', 70), reactions: rating('reactions', rating('awareness', 70)),
      defend: rating('defending', rating('defend', 55))
    };
  }

  function reactionProfile(request, candidate) {
    if (!request.reactionContext) return {
      active: false, rating: null, ratingSource: null, delayTicks: 0,
      ageTicks: null, ready: true, intendedAnticipationTicks: 0
    };
    const attributes = candidate.roster.attributes || {};
    const explicit = Number.isFinite(attributes.reactions);
    const rating = Math.max(1, Math.min(99, finite(explicit ? attributes.reactions :
      (attributes.awareness == null ? 70 : attributes.awareness), 'reaction rating')));
    const baseDelay = REACTION_DELAY_MIN_TICKS + Math.round((99 - rating) / REACTION_DELAY_RATING_DIVISOR);
    const anticipation = candidate.intended ? INTENDED_RECEIVER_ANTICIPATION_TICKS : 0;
    const delayTicks = Math.max(0, baseDelay - anticipation);
    const ageTicks = request.tick - request.reactionContext.releaseTick;
    return {
      active: true,
      rating,
      ratingSource: explicit ? 'reactions' : 'awareness-fallback',
      delayTicks,
      ageTicks,
      ready: ageTicks >= delayTicks,
      intendedAnticipationTicks: anticipation
    };
  }

  function passiveBodyProbe(request, candidate) {
    if (!request.reactionContext || !candidate.roster.bodyContactEligible) return null;
    const ageTicks = request.tick - request.reactionContext.releaseTick;
    if (candidate.player.id === request.reactionContext.sourcePlayerId &&
        ageTicks < SOURCE_RELEASE_BODY_PROTECTION_TICKS) return null;
    const result = Ball.resolvePassiveBodyDeflection(request.ballState, {
      previousBallPosition: request.reactionContext.previousBallPosition,
      body: {
        id: candidate.player.id,
        position: { x: candidate.player.position.x, y: candidate.player.position.y, z: 0 },
        velocity: { x: candidate.player.velocity.x, y: candidate.player.velocity.y, z: 0 },
        radius: candidate.player.radius,
        heightM: candidate.roster.heightM
      },
      tick: request.tick,
      fixedTickSeconds: FIXED_TICK_SECONDS
    });
    return result.hit ? result : null;
  }

  function passiveDeflectionResult(request, candidate, probe, reaction) {
    const handoffId = 'first-touch-v2:body:' + request.tick + ':' + digest({
      playerId: candidate.player.id,
      contactCount: request.ballState.contactCount,
      timeFraction: probe.timeFraction,
      releaseTick: request.reactionContext.releaseTick
    });
    const metadata = clone(probe.state.metadata || {});
    metadata.bodyDeflection = {
      playerId: candidate.player.id,
      teamId: candidate.player.teamId,
      contactTick: request.tick,
      releaseTick: request.reactionContext.releaseTick,
      involuntary: true,
      reactionReady: reaction.ready,
      reactionRating: reaction.rating,
      reactionRatingSource: reaction.ratingSource,
      reactionDelayTicks: reaction.delayTicks,
      releaseAgeTicks: reaction.ageTicks
    };
    const ballState = Ball.createBallState({ ...probe.state, metadata }, {
      radius: probe.state.radius,
      mass: probe.state.mass
    });
    return deepFreeze({
      schema: RESULT_SCHEMA, version: VERSION, authority: AUTHORITY, workflow: request.workflow, online: false,
      tick: request.tick, epoch: request.epoch, status: 'contact', ownedContact: true,
      contactType: 'involuntary-deflection', ownerCandidateId: null, ballState,
      consumedFirstTouchIds: appendRecentFirstTouchId(request.consumedFirstTouchIds, handoffId),
      consumedFirstTouchThroughTick: request.tick,
      consumedAerialIds: request.consumedAerialIds,
      suppressLegacy: {
        reception: true,
        aerialDuel: false,
        outfieldBallBlock: true,
        keeperContact: false,
        wallContact: false
      },
      presentation: {
        playerId: candidate.player.id,
        teamId: candidate.player.teamId,
        outcome: 'deflected',
        reason: reaction.ready ? 'deliberate-control-missed-body-contact' : 'pre-reaction-body-contact',
        technique: 'passive-player-body',
        handoffId,
        possessionDisposition: 'remain-loose',
        phase: 'reaction-deflection'
      },
      detail: {
        handoffId,
        involuntary: true,
        intended: candidate.intended,
        reaction,
        timeFraction: probe.timeFraction,
        event: clone(probe.event),
        incomingVelocity: clone(request.ballState.velocity),
        outgoingVelocity: clone(ballState.velocity)
      }
    });
  }

  function isRetainedTouchContinuation(request, playerId) {
    const lastContact = request.ballState.lastContact;
    const metadata = request.ballState.metadata && request.ballState.metadata.firstTouch;
    return !!(lastContact && metadata &&
      lastContact.colliderId === playerId &&
      String(lastContact.materialId || '').startsWith('first-touch:') &&
      metadata.playerId === playerId && metadata.outcome === 'retained');
  }

  function retainedTouchChainLocked(request, playerId) {
    const metadata = request.ballState.metadata && request.ballState.metadata.firstTouch;
    if (!metadata || metadata.playerId !== playerId || metadata.outcome !== 'retained') return false;
    const contactTick = Number(metadata.contactTick);
    const origin = metadata.contactPosition;
    if (!Number.isSafeInteger(contactTick) || !origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
      return true;
    }
    const elapsedTicks = request.tick - contactTick;
    const travelled = Math.hypot(request.ballState.position.x - origin.x, request.ballState.position.y - origin.y);
    // Prevent the old 18-frame self-contact loop, but never make a cushioned,
    // stationary ball permanently untouchable. During the bounded settle
    // window the ball must both age and travel; after it expires, ordinary
    // contact geometry is authoritative again.
    if (elapsedTicks < RETAINED_RECONTACT_MIN_TICKS) return true;
    if (elapsedTicks > RETAINED_RECONTACT_MAX_LOCK_TICKS) return false;
    return travelled < RETAINED_RECONTACT_MIN_TRAVEL_METRES;
  }

  function looseTouchRetryLocked(request, candidate) {
    const playerId = candidate && candidate.player && candidate.player.id;
    const metadata = request.ballState.metadata && request.ballState.metadata.firstTouch;
    if (!metadata || metadata.playerId !== playerId || metadata.outcome !== 'loose') return false;
    const lastContact = request.ballState.lastContact;
    // Another footballer's genuine touch starts a new contest immediately.
    // Otherwise, the same player may recover their own miscontrol once their
    // reaction-rated reset has elapsed and the ordinary physical contact
    // geometry is met again. This permits realistic second cushions without
    // turning every host animation cycle into an instant control reroll.
    if (lastContact && lastContact.colliderId !== playerId &&
        request.roster.some(player => player.id === lastContact.colliderId)) return false;
    const contactTick = Number.isSafeInteger(metadata.contactTick) ? metadata.contactTick :
      lastContact && lastContact.colliderId === playerId && Number.isSafeInteger(lastContact.outerTick)
        ? lastContact.outerTick : request.tick;
    const rating = rosterAttributes(candidate.roster).reactions;
    const delayTicks = LOOSE_RECONTROL_DELAY_MIN_TICKS +
      Math.round((99 - rating) / LOOSE_RECONTROL_DELAY_RATING_DIVISOR);
    return request.tick - contactTick < delayTicks;
  }

  function noContact(request, status, detail, arbitration) {
    const aerialArbitrated = arbitration === 'aerial-attempt';
    const groundArbitrated = arbitration === 'ground-attempt';
    return deepFreeze({
      schema: RESULT_SCHEMA, version: VERSION, authority: AUTHORITY, workflow: request.workflow, online: false,
      tick: request.tick, epoch: request.epoch, status, ownedContact: false, contactType: null,
      ownerCandidateId: null, ballState: request.ballState, consumedFirstTouchIds: request.consumedFirstTouchIds,
      consumedFirstTouchThroughTick: request.consumedFirstTouchThroughTick,
      consumedAerialIds: request.consumedAerialIds,
      suppressLegacy: {
        reception: aerialArbitrated || groundArbitrated,
        aerialDuel: aerialArbitrated,
        outfieldBallBlock: false,
        keeperContact: false,
        wallContact: false
      },
      presentation: null, detail: detail || null
    });
  }

  function resolveFirstTouch(request) {
    if (request.tick <= request.consumedFirstTouchThroughTick) {
      return noContact(request, 'already-consumed', 'first-touch-high-water', 'ground-attempt');
    }
    const snapshot = centreSnapshot(request);
    const rosterById = Object.fromEntries(request.roster.map(player => [player.id, player]));
    const allCandidates = request.world.players.map(player => ({
      player,
      roster: rosterById[player.id],
      intended: player.id === request.intendedReceiverId,
      distance: Math.hypot(player.position.x - request.ballState.position.x, player.position.y - request.ballState.position.y)
    })).filter(row => row.roster && !row.roster.isGK && !row.roster.sentOff && row.roster.available);
    for (const candidate of allCandidates) candidate.reaction = reactionProfile(request, candidate);
    const physicalHits = allCandidates.map(candidate => ({
      candidate,
      probe: passiveBodyProbe(request, candidate)
    })).filter(row => row.probe)
      .sort((left, right) => left.probe.timeFraction - right.probe.timeFraction ||
        left.candidate.player.id.localeCompare(right.candidate.player.id));
    const physical = physicalHits[0] || null;
    if (physical && (!physical.candidate.reaction.ready || !physical.candidate.roster.contactEligible)) {
      return passiveDeflectionResult(request, physical.candidate, physical.probe, physical.candidate.reaction);
    }
    // A real swept body meeting is authoritative over any later endpoint
    // receiver. If its actor has reacted we give that actor the only deliberate
    // First Touch attempt; if foot-control geometry still fails, the physical
    // body ricochet is committed rather than erased by somebody downstream.
    const candidates = physical ? [physical.candidate].filter(row => row.roster.contactEligible && row.reaction.ready &&
      !retainedTouchChainLocked(request, row.player.id) && !looseTouchRetryLocked(request, row))
      : allCandidates.filter(row => row.roster.contactEligible && row.reaction.ready &&
        row.distance <= FIRST_TOUCH_ACQUISITION_RADIUS_METRES && !retainedTouchChainLocked(request, row.player.id) &&
        !looseTouchRetryLocked(request, row))
        .sort((left, right) => Number(right.intended) - Number(left.intended) ||
          left.distance - right.distance || left.player.id.localeCompare(right.player.id));
    if (!candidates.length) {
      if (physical) return passiveDeflectionResult(request, physical.candidate, physical.probe, physical.candidate.reaction);
      return noContact(request, 'no-contact', request.reactionContext ? {
        reason: 'reaction-window-or-contact-geometry-pending',
        releaseAgeTicks: request.tick - request.reactionContext.releaseTick
      } : 'no-eligible-first-touch-receiver', 'ground-attempt');
    }
    const capability = FirstTouchAuthority.createCapability({
      enabled: true,
      online: false,
      liveAuthority: false,
      workflow: FIRST_TOUCH_WORKFLOW,
      acknowledgement: FirstTouchAuthority.ACKNOWLEDGEMENT
    });
    for (const candidate of candidates) {
      // A retained directional contact deliberately leaves the ball loose for
      // physics-led dribbling. If the same player reaches that same contact
      // chain again, keep resolving the physics but do not present it as a new
      // reception every time the host's short animation lock expires.
      const continuation = isRetainedTouchContinuation(request, candidate.player.id);
      const profile = rosterAttributes(candidate.roster);
      const pressureIds = request.world.players.filter(player => {
        const roster = rosterById[player.id];
        return player.teamId !== candidate.player.teamId && roster && !roster.sentOff && roster.available && roster.contactEligible;
      }).map(player => player.id).sort();
      const receivingIntent = candidate.intended && request.firstTouchIntent &&
        (!continuation || request.firstTouchIntent.source !== 'cpu-v2') ? request.firstTouchIntent : {
        type: candidate.intended ? 'cushion' : 'trap', direction: candidate.player.facing,
        touchDistanceM: candidate.intended ? 0.4 : 0.2, active: false
      };
      const result = FirstTouchAuthority.resolve({
        schema: FirstTouchAuthority.REQUEST_SCHEMA,
        workflow: FIRST_TOUCH_WORKFLOW,
        online: false,
        coordinateSystem: FirstTouchAuthority.COORDINATE_SYSTEM,
        tick: request.tick,
        fixedTickSeconds: FIXED_TICK_SECONDS,
        seed: request.seed,
        movementWorld: snapshot.movementWorld,
        receiverPlayerId: candidate.player.id,
        receiverProfile: {
          schema: FirstTouchAuthority.PROFILE_SCHEMA,
          playerId: candidate.player.id,
          teamId: candidate.player.teamId,
          technique: profile.technique,
          awareness: profile.awareness
        },
        rosterEligibility: {
          schema: FirstTouchAuthority.ROSTER_ELIGIBILITY_SCHEMA,
          tick: request.tick,
          playerId: candidate.player.id,
          teamId: candidate.player.teamId,
          sentOff: false,
          available: true,
          contactEligible: true
        },
        ball: snapshot.ballState,
        pressurePlayerIds: pressureIds,
        // A receiver's directional cushion belongs only to that authored
        // receiver. If an opponent or another teammate reaches the physical
        // ball first, resolve their own neutral contact rather than letting a
        // human stick vector steer somebody else's interception.
        intent: receivingIntent,
        timingOffsetSeconds: 0,
        technique: null,
        // The outer contact ledger also contains passive MR body identities.
        // First Touch Authority owns only its canonical handoff namespace, so
        // keep both exact-once ledgers intact without crossing their IDs.
        consumedHandoffIds: request.consumedFirstTouchIds.filter(id =>
          /^first-touch-v2:[1-9][0-9]*:[a-f0-9]{16}$/.test(id))
      }, capability);
      if (result.status === 'no-contact') {
        if (physical && candidate.player.id === physical.candidate.player.id) {
          return passiveDeflectionResult(request, candidate, physical.probe, candidate.reaction);
        }
        continue;
      }
      if (result.status === 'already-consumed') return noContact(request, 'already-consumed', result.candidateHandoffId, 'ground-attempt');
      const handoff = result.handoff;
      if (!handoff || result.status !== 'pending' || result.schema !== FirstTouchAuthority.RESULT_SCHEMA ||
          result.version !== FirstTouchAuthority.VERSION || handoff.schema !== FirstTouchAuthority.HANDOFF_SCHEMA ||
          handoff.handoffId !== result.candidateHandoffId || handoff.exactOnce !== true ||
          handoff.preconditions.movementTick !== request.tick || handoff.preconditions.ballLastOuterTick !== request.tick ||
          handoff.preconditions.expectedBallContactCount !== request.ballState.contactCount ||
          handoff.preconditions.receiverPlayerId !== candidate.player.id ||
          request.consumedFirstTouchIds.includes(handoff.handoffId) || !Ball.isBallState(handoff.contact.ballState) ||
          handoff.contact.ballState.contactCount !== request.ballState.contactCount + 1 ||
          handoff.contact.ballState.lastContact.colliderId !== candidate.player.id ||
          handoff.contact.ballState.lastContact.outerTick !== request.tick) {
        throw new Error('First Touch V2 live promotion handoff contract failed');
      }
      const pitchedBallState = ballToPitch(handoff.contact.ballState, snapshot.centre);
      const firstTouchMetadata = clone(pitchedBallState.metadata || {});
      firstTouchMetadata.firstTouch = {
        ...(firstTouchMetadata.firstTouch || {}),
        contactTick: request.tick,
        contactPosition: {
          x: pitchedBallState.position.x,
          y: pitchedBallState.position.y
        }
      };
      const ballState = Ball.createBallState({ ...pitchedBallState, metadata: firstTouchMetadata }, {
        radius: pitchedBallState.radius,
        mass: pitchedBallState.mass
      });
      const ownerCandidateId = handoff.possession.disposition === 'candidate-acquire' ? candidate.player.id : null;
      const contactType = continuation ? 'dribble-touch' : 'first-touch';
      return deepFreeze({
        schema: RESULT_SCHEMA, version: VERSION, authority: AUTHORITY, workflow: request.workflow, online: false,
        tick: request.tick, epoch: request.epoch, status: 'contact', ownedContact: true, contactType,
        ownerCandidateId, ballState, receivingIntent: clone(receivingIntent),
        consumedFirstTouchIds: appendRecentFirstTouchId(request.consumedFirstTouchIds, handoff.handoffId),
        consumedFirstTouchThroughTick: request.tick,
        consumedAerialIds: request.consumedAerialIds,
        suppressLegacy: {
          reception: true,
          aerialDuel: true,
          outfieldBallBlock: false,
          keeperContact: false,
          wallContact: false
        },
        presentation: {
          playerId: candidate.player.id, teamId: candidate.player.teamId, outcome: result.outcome,
          reason: result.reason, technique: result.technique, handoffId: handoff.handoffId,
          possessionDisposition: handoff.possession.disposition,
          phase: continuation ? DRIBBLE_CONTINUATION_PHASE : 'reception'
        },
        detail: { sourceResultDigest: digest(result), handoffId: handoff.handoffId,
          retainedTouchContinuation: continuation, reaction: clone(candidate.reaction) }
      });
    }
    if (physical) return passiveDeflectionResult(request, physical.candidate, physical.probe, physical.candidate.reaction);
    return noContact(request, 'no-contact', 'first-touch-geometry-miss', 'ground-attempt');
  }

  function aerialPlayer(player, roster, commandTick) {
    return {
      id: player.id,
      teamId: player.teamId,
      position: { x: player.position.x, y: player.position.y, z: 0 },
      velocity: { x: player.velocity.x, y: player.velocity.y, z: 0 },
      facing: { x: player.facing.x, y: player.facing.y, z: 0 },
      heightM: roster.heightM,
      attributes: rosterAttributes(roster),
      inputTick: commandTick,
      purpose: 'challenge'
    };
  }

  function resolveAerial(request) {
    const intent = request.aerialIntent;
    const ledgerId = 'aerial-v2:' + request.epoch + ':' + intent.sequence;
    // A repeated host command is still part of the already-authoritatively
    // arbitrated aerial lane. Keep the exact legacy reception/aerial-duel
    // retry suppressed so a held input cannot become a second Build 173
    // attempt after V2 consumed it on an earlier tick.
    if (request.consumedAerialIds.includes(ledgerId)) {
      return noContact(request, 'already-consumed', ledgerId, 'aerial-attempt');
    }
    const actor = request.world.players.find(player => player.id === intent.actorId);
    const actorRoster = request.roster.find(player => player.id === intent.actorId);
    if (!actor || !actorRoster) throw new Error('aerial actor is not in canonical Movement V2 state');
    const opponents = request.world.players.filter(player => {
      const roster = request.roster.find(row => row.id === player.id);
      return player.teamId !== actor.teamId && roster && !roster.sentOff && !roster.isGK &&
        roster.available && roster.contactEligible;
    }).map(player => {
      const roster = request.roster.find(row => row.id === player.id);
      return aerialPlayer(player, roster, request.tick - 4);
    });
    const sessionId = 'live-v2-contact-' + request.epoch;
    const capability = Aerial.createShadowCapability({
      grant: Aerial.CAPABILITY_GRANT,
      runtimeMode: Aerial.RUNTIME_MODE,
      authority: Aerial.AUTHORITY,
      sessionId,
      capabilityId: 'contact-' + request.epoch
    });
    const aerialRequest = {
      schema: Aerial.REQUEST_SCHEMA,
      id: 'aerial-' + request.epoch + '-' + intent.sequence,
      sessionId,
      simulationTick: request.tick,
      contactTick: request.tick,
      inputTick: intent.commandTick,
      technique: intent.technique,
      intent: intent.intent,
      actor: aerialPlayer(actor, actorRoster, intent.commandTick),
      ball: {
        id: request.ballState.id,
        position: clone(request.ballState.position),
        velocity: clone(request.ballState.velocity),
        angularVelocity: clone(request.ballState.angularVelocity),
        radiusM: request.ballState.radius
      },
      target: clone(intent.target),
      opponents,
      metadata: { promotedBy: VERSION, epoch: request.epoch, sequence: intent.sequence }
    };
    const normalized = Aerial.createRequest(aerialRequest);
    const technique = Aerial.selectTechnique(normalized);
    const profile = technique && Aerial.TECHNIQUE_PROFILES[technique];
    if (profile && request.tick < intent.commandTick + profile.windupTicks - profile.viableWindowTicks) {
      return noContact(request, 'aerial-pending', {
        ledgerId,
        eligibleFromTick: intent.commandTick + profile.windupTicks - profile.viableWindowTicks
      }, 'aerial-attempt');
    }
    const result = Aerial.resolveContact(normalized, capability);
    if (!result || result.schema !== Aerial.RESULT_SCHEMA || result.version !== Aerial.VERSION ||
        result.requestId !== normalized.id || result.contactTick !== request.tick || result.shadowOnly !== true) {
      throw new Error('Aerial Contact V2 result contract failed');
    }
    if (request.consumedAerialIds.length >= MAX_LEDGER_IDS) throw new Error('aerial exact-once ledger is full');
    const consumedAerialIds = [...request.consumedAerialIds, ledgerId];
    if (result.outcome === Aerial.OUTCOMES.MISS) {
      return deepFreeze({
        ...noContact(request, 'aerial-miss', { ledgerId, reason: result.reason }, 'aerial-attempt'),
        consumedAerialIds,
        presentation: { playerId: actor.id, outcome: 'miss', reason: result.reason, technique: result.technique, ledgerId }
      });
    }
    if (!result.launchIntent || result.launchIntent.schema !== Ball.LAUNCH_SCHEMA) {
      throw new Error('successful aerial contact must hand off one Ball V2 launch');
    }
    const launched = Ball.resolveLaunch(result.launchIntent);
    const contactBy = stableId(result.contactBy, 'aerial result contactBy');
    const collider = request.world.players.find(player => player.id === contactBy);
    const colliderRoster = request.roster.find(row => row.id === contactBy);
    if (!collider || !colliderRoster || colliderRoster.sentOff || colliderRoster.isGK ||
        !colliderRoster.available || !colliderRoster.contactEligible) {
      throw new Error('aerial contact collider must be an eligible outfield Movement V2 player');
    }
    const incoming = request.ballState.velocity;
    const normalRaw = {
      x: request.ballState.position.x - collider.position.x,
      y: request.ballState.position.y - collider.position.y,
      z: request.ballState.position.z - (request.roster.find(row => row.id === collider.id).heightM * 0.55)
    };
    const length = Math.hypot(normalRaw.x, normalRaw.y, normalRaw.z) || 1;
    const normal = { x: normalRaw.x / length, y: normalRaw.y / length, z: normalRaw.z / length };
    const normalSpeed = Math.abs(incoming.x * normal.x + incoming.y * normal.y + incoming.z * normal.z);
    // Ball.resolveLaunch intentionally starts a fresh launch chronology. The
    // live contact seam repairs it from the pre-contact state so one contact is
    // recorded at this outer tick and never silently reset to zero.
    const ballState = Ball.createBallState({
      ...launched.state,
      id: request.ballState.id,
      radius: request.ballState.radius,
      mass: request.ballState.mass,
      inertia: request.ballState.inertia,
      orientation: request.ballState.orientation,
      contactCount: request.ballState.contactCount + 1,
      lastContact: {
        colliderId: contactBy,
        materialId: 'aerial-contact-v2',
        normal,
        normalSpeed,
        outerTick: request.tick,
        substepCount: 0
      },
      lastOuterTick: request.tick,
      simulationTime: request.ballState.simulationTime,
      metadata: {
        ...request.ballState.metadata,
        ...launched.state.metadata,
        liveContactLedgerId: ledgerId,
        liveContactComposerVersion: VERSION,
        aerialResultId: result.id
      }
    }, { radius: request.ballState.radius, mass: request.ballState.mass });
    return deepFreeze({
      schema: RESULT_SCHEMA, version: VERSION, authority: AUTHORITY, workflow: request.workflow, online: false,
      tick: request.tick, epoch: request.epoch, status: 'contact', ownedContact: true, contactType: 'aerial-volley',
      ownerCandidateId: null, ballState, consumedFirstTouchIds: request.consumedFirstTouchIds,
      consumedFirstTouchThroughTick: request.consumedFirstTouchThroughTick, consumedAerialIds,
      suppressLegacy: {
        reception: true,
        aerialDuel: true,
        outfieldBallBlock: false,
        keeperContact: false,
        wallContact: false
      },
      presentation: {
        playerId: contactBy, actorId: actor.id, outcome: result.outcome, reason: result.reason,
        technique: result.technique, contactGrade: result.contactGrade, ledgerId
      },
      detail: { resultId: result.id, launchId: result.launchIntent.id, telemetryDigest: digest(result.telemetry) }
    });
  }

  function compose(input, capability) {
    assertDependencies();
    assertCapability(capability);
    const request = normalizeRequest(input, capability.workflow);
    if (!request.gate.livePlay || request.gate.restartActive || request.gate.replayActive || request.gate.keeperAuthority ||
        request.gate.offsideInvolvementPending || request.gate.specialActionAuthority) {
      return noContact(request, 'gated', clone(request.gate));
    }
    if (request.aerialIntent) return resolveAerial(request);
    return resolveFirstTouch(request);
  }

  return Object.freeze({
    VERSION,
    REQUEST_SCHEMA,
    RESULT_SCHEMA,
    CAPABILITY_SCHEMA,
    ACKNOWLEDGEMENT,
    AUTHORITY,
    WORKFLOW,
    SUPPORTED_WORKFLOWS,
    PARENT_VERSION,
    FIXED_TICK_SECONDS,
    COORDINATE_SYSTEM,
    DRIBBLE_CONTINUATION_PHASE,
    FIRST_TOUCH_ACQUISITION_RADIUS_METRES,
    MAX_RECENT_FIRST_TOUCH_IDS,
    RETAINED_RECONTACT_MIN_TICKS,
    RETAINED_RECONTACT_MAX_LOCK_TICKS,
    RETAINED_RECONTACT_MIN_TRAVEL_METRES,
    SOURCE_RELEASE_BODY_PROTECTION_TICKS,
    REACTION_DELAY_MIN_TICKS,
    REACTION_DELAY_RATING_DIVISOR,
    INTENDED_RECEIVER_ANTICIPATION_TICKS,
    MAX_REACTION_DELAY_TICKS,
    DEPENDENCY_CONTRACTS,
    createCapability,
    compose,
    stableJson
  });
});
