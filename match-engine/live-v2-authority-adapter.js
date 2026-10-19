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
  const api = factory(root || null, localDribbling);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyLiveV2Authority = api;
})(typeof window === 'object' ? window : null, function createLiveV2AuthorityApi(browserRoot, localDribbling) {
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
  const HUMAN_LOOSE_BALL_GUIDANCE_MAX_DISTANCE_METRES = 5.2;
  const HUMAN_LOOSE_BALL_GUIDANCE_MAX_ETA_SECONDS = 1.45;
  const HUMAN_RECEPTION_GUIDANCE_MAX_DISTANCE_METRES = 18;
  const HUMAN_RECEPTION_GUIDANCE_STRONG_INPUT = 0.62;
  const HUMAN_RECEPTION_GUIDANCE_OPPOSING_DOT = 0.10;
  const HUMAN_INPUT_RESPONSIVENESS_MULTIPLIER = 1.42;
  const CPU_PASS_RACE_MIN_MARGIN_TICKS = 6;
  const CPU_PASS_RECEIVER_READY_BUFFER_TICKS = 8;
  const CPU_PASS_PROGRESSION_READY_BUFFER_TICKS = -4;
  const CPU_PASS_PROGRESSION_MIN_CONFIDENCE = 0.72;
  const CPU_PASS_PROGRESSION_MIN_METRES = 4;
  const CPU_PASS_PROGRESSION_MIN_OPPONENT_MARGIN_TICKS = -2;
  // D1 (19 Oct 2026): long balls take up to 2.4 s to come down, so the race
  // must follow them that far plus the receiver's six-tick margin.
  const CPU_PASS_RACE_MAX_TICKS = 180;
  const CPU_PASS_RACE_MAX_CONTACT_HEIGHT_METRES = 1.45;
  const CPU_PASS_MIN_DISTANCE_METRES = 5.5;
  const CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES = 4.5;
  const CPU_REJECTED_PASS_COMMITMENT_TICKS = 6;
  // The cheap support-pass path is a performance shortcut, not a second set
  // of football contact rules. Only use it for clearly unpressured geometry;
  // ordinary lanes must run the same physical receiver/opponent projection as
  // every other pass. CPU Intelligence measures these two values in canonical
  // pitch units (roughly 30.25 units per metre along the long axis).
  const CPU_SHORT_SUPPORT_FAST_LANE_CLEARANCE = 60;
  const CPU_SHORT_SUPPORT_FAST_RECEIVER_SPACE = 75;
  const TURNOVER_TACKLE_PROTECTION_TICKS = 30;
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
  function cpuLongPassLaunch(distanceMetres) {
    const distance = finite(distanceMetres, 20);
    if (distance <= 30) return { speed: clamp(11 + distance * 0.45, 17, 24), liftAngleDeg: 0 };
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

  function cpuPhysicalActionAllowed(transition, tick) {
    if (!transition) return true;
    if (!Number.isSafeInteger(tick) || !Number.isSafeInteger(transition.startedTick)) return false;
    return tick > transition.startedTick + TURNOVER_TACKLE_PROTECTION_TICKS;
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
        radius: finite(player.radius, 12.75), stamina: clamp(finite(player.stamina, 100), 0, 100),
        heightM: clamp(finite(player.heightM, 1.8), 1.3, 2.2),
        attrs: clone(player.attrs || {}), isGK: Boolean(player.isGK), sentOff: Boolean(player.sentOff),
        contactEligible: player.contactEligible !== false,
        // Animation/reception locks can delay a deliberate touch without
        // making the footballer's body intangible to the MR ball.
        bodyContactEligible: player.bodyContactEligible !== false,
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
    const dribbling = {
      surface: String(dribblingSource.surface || 'dry'),
      actionIntent: dribblingSource.actionIntent && typeof dribblingSource.actionIntent === 'object'
        ? clone(dribblingSource.actionIntent) : null,
      directionalKnockOnIntent
    };
    if (dribbling.actionIntent && dribbling.actionIntent.actorId != null && !ids.has(String(dribbling.actionIntent.actorId))) {
      throw new TypeError('live dribbling action actor is unknown');
    }
    return { tick: snapshot.tick, fixedTickSeconds: FIXED_TICK_SECONDS, pitch, units, players, ball, teams, humanPlayerIds, contact, dribbling };
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
        transition: null,
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
          ballState: clone(domain.ballState),
          ballContext: clone(domain.ballContext),
          lastBallProjection: clone(domain.lastBallProjection),
          lastLaunchSequence: domain.lastLaunchSequence,
          lastTackleState: [...domain.lastTackleState].map(String).sort(),
          lastCarrierEmission: clone(domain.lastCarrierEmission),
          possession: clone(domain.possession),
          transition: clone(domain.transition),
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
        const stagedDomain = {
          world: restoredWorld,
          rosterSignature: String(payload.domain.rosterSignature || ''),
          cpuMemories: clone(payload.domain.cpuMemories || { you: null, opp: null }),
          cpuRejectedPassCommitments: clone(payload.domain.cpuRejectedPassCommitments || { you: null, opp: null }),
          ballState: restoredBall,
          ballContext: dependencies.ball.cloneContext(payload.domain.ballContext),
          lastBallProjection: clone(payload.domain.lastBallProjection),
          lastLaunchSequence: String(payload.domain.lastLaunchSequence || ''),
          lastTackleState: new Set((Array.isArray(payload.domain.lastTackleState) ? payload.domain.lastTackleState : []).map(String)),
          lastCarrierEmission: clone(payload.domain.lastCarrierEmission || { you: '', opp: '' }),
          possession: clone(payload.domain.possession || { teamId: null, ownerId: null, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null }),
          transition: clone(payload.domain.transition),
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
    function formationOutputs(snapshot, phaseState) {
      const output = {};
      for (const team of snapshot.teams) {
        const formation = dependencies.formation.normalizeFormationCode(team.formation);
        if (!formation) throw new Error('formation V2 rejected ' + team.formation);
        const lineup = team.lineup.map(row => ({ id: String(row.id), slotId: String(row.slotId), position: String(row.position) }));
        const validation = dependencies.formation.validateLineup(formation, lineup);
        if (!validation.valid) throw new Error('formation V2 lineup invalid: ' + validation.errors.join(';'));
        const referenceId = snapshot.ball.ownerId || snapshot.ball.targetId;
        const referencePlayer = referenceId && snapshot.players.find(player => player.id === referenceId && player.teamId === team.id);
        const carrierProgress = referencePlayer ? clamp(team.attackingDirection === 1
          ? (referencePlayer.x - snapshot.pitch.xMin) / (snapshot.pitch.xMax - snapshot.pitch.xMin)
          : (snapshot.pitch.xMax - referencePlayer.x) / (snapshot.pitch.xMax - snapshot.pitch.xMin), 0, 1) : null;
        output[team.id] = dependencies.formation.resolve({
          formation, phase: phaseState.phases[team.id], tick: snapshot.tick, lineup,
          philosophy: philosophyFor(team, formation), pitch: METRIC_PITCH,
          attackingDirection: team.attackingDirection,
          offsideLine: (team.offsideLine - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          tactics: { ...team.tactics, carrierProgress }
        });
      }
      return output;
    }
    function derivePossession(snapshot) {
      const owner = snapshot.ball.ownerId && snapshot.players.find(player => player.id === snapshot.ball.ownerId);
      if (owner) return { teamId: owner.teamId, ownerId: owner.id, inFlight: false, intendedReceiverId: null, intendedTarget: null, intendedTargetWindowMetres: null, arrivalWindowEntered: false, releaseTick: null, reactionStimulus: null, offsideCandidate: null };
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
    function cpuOutputs(snapshot, formations, possession) {
      const allPlayers = snapshot.players.map(player => {
        const metric = metricPoint(player, snapshot), velocity = metricVelocity(player, snapshot);
        const target = formations[player.teamId].targets.find(row => row.playerId === player.id), attrs = player.attrs || {};
        return {
          id: player.id, teamId: player.teamId, x: metric.x, y: metric.y, vx: velocity.x, vy: velocity.y,
          role: player.role, position: player.position, formationAnchor: target ? target.target : metric,
          pace: finite(attrs.pace, 70), acceleration: finite(attrs.accel, attrs.pace || 70), awareness: finite(attrs.awareness, 70),
          passing: finite(attrs.pass, 70), shooting: finite(attrs.shoot, 65), control: finite(attrs.control, 70),
          defending: finite(attrs.defend, 55), aggression: finite(attrs.aggression, 65), strength: finite(attrs.strength, 70),
          balance: finite(attrs.balance, 70), fx: player.fx, fy: player.fy,
          stamina: player.stamina, isGK: player.isGK, sentOff: player.sentOff, available: !player.sentOff,
          cpuControlled: !snapshot.humanPlayerIds.has(player.id), humanControlled: snapshot.humanPlayerIds.has(player.id)
        };
      });
      const ballPoint = metricBall(snapshot.ball, snapshot).position, outputs = {}, memories = {};
      for (const team of snapshot.teams) {
        const decision = dependencies.cpu.decide({
          tick: snapshot.tick, fixedTickSeconds: FIXED_TICK_SECONDS, teamId: team.id,
          possessionTeamId: possession.teamId, carrierId: possession.ownerId,
          intendedReceiverId: possession.intendedReceiverId, inFlight: possession.inFlight,
          attackingDirection: team.attackingDirection,
          offsideLine: (team.offsideLine - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
          pitch: METRIC_PITCH, ball: { x: ballPoint.x, y: ballPoint.y }, players: allPlayers,
          events: possession.offsideCandidate ? [{ type: 'offside-candidate', ...clone(possession.offsideCandidate) }] : []
        }, domain.cpuMemories[team.id], { fixedTickSeconds: FIXED_TICK_SECONDS });
        outputs[team.id] = decision; memories[team.id] = decision.memory;
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
        players: world.players.map(player => ({ ...player, hasBall: player.id === currentOutfieldOwnerId }))
      };
      return { world, signature };
    }
    function targetMaps(formations, decisions, snapshot, possession) {
      const shape = {}, run = {}, reception = {}, carrier = {}, defensive = {};
      for (const teamId of ['you', 'opp']) {
        for (const target of formations[teamId].targets) shape[target.playerId] = target.target;
        for (const committed of decisions[teamId].runs || []) run[committed.playerId] = committed.continuationTarget || committed.target;
        const intent = decisions[teamId].carrierIntent;
        // The race gate accepts a pass only when this named receiver can meet
        // the exact authored point. Movement must honour that same point while
        // the ball travels instead of returning the player to an older run or
        // a static formation anchor.
        if (intent && intent.type === 'pass' && intent.targetPlayerId && intent.target) {
          reception[String(intent.targetPlayerId)] = intent.target;
        }
        if (intent && intent.type === 'carry' && intent.target) carrier[teamId] = intent.target;
        for (const intent of decisions[teamId].defensiveIntents || []) {
          if (!intent || !intent.playerId || !intent.target) continue;
          defensive[String(intent.playerId)] = clone(intent);
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
      return { shape, run, reception, carrier, defensive };
    }
    function nearestOpponent(player, snapshot) {
      return snapshot.players.filter(candidate => candidate.teamId !== player.teamId && !candidate.sentOff)
        .map(candidate => ({ candidate, distance: Math.hypot(candidate.x - player.x, candidate.y - player.y) }))
        .sort((a, b) => a.distance - b.distance || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate || null;
    }
    function looseBallRecoveryAssignments(snapshot, world, possession) {
      const gate = snapshot.contact.gate || {};
      if (snapshot.ball.ownerId || !gate.livePlay || gate.restartActive || gate.replayActive ||
          gate.keeperAuthority || gate.specialActionAuthority) return { byId: {}, rows: [] };
      // Pending offside provenance must not make a physically live ball
      // untouchable. Movement may send both teams toward the real loose ball;
      // the host's existing offside phase remains the sole authority deciding
      // whether the named attacker becomes involved or another player resets
      // the phase. Recovery never grants possession here.
      const flightType = String(snapshot.ball.flightType || '').toLowerCase();
      if (/(shot|cross|corner|free-kick|penalty|clearance)/.test(flightType)) return { byId: {}, rows: [] };
      const ball = metricBall(snapshot.ball, snapshot), speed = Math.hypot(ball.velocity.x, ball.velocity.y);
      if (ball.position.z > LOOSE_BALL_MAX_HEIGHT_METRES || speed > LOOSE_BALL_MAX_SPEED_METRES_PER_SECOND) {
        return { byId: {}, rows: [] };
      }
      const horizon = clamp(0.08 + Math.min(speed, 16) * 0.012, 0.08, 0.28);
      const target = {
        x: clamp(ball.position.x + ball.velocity.x * horizon, METRIC_PITCH.xMin + 0.4, METRIC_PITCH.xMax - 0.4),
        y: clamp(ball.position.y + ball.velocity.y * horizon, METRIC_PITCH.yMin + 0.4, METRIC_PITCH.yMax - 0.4)
      };
      const intendedId = String(snapshot.contact.intendedReceiverId || snapshot.ball.targetId || '');
      const byId = {}, rows = [];
      for (const team of snapshot.teams) {
        const candidates = world.players.map(statePlayer => {
          const livePlayer = snapshot.players.find(player => player.id === statePlayer.id);
          if (!livePlayer || livePlayer.teamId !== team.id || livePlayer.sentOff || livePlayer.isGK ||
              !livePlayer.contactEligible) return null;
          // A deliberate in-flight pass is not a neutral loose-ball scramble.
          // The owning team follows its authored reception route while only
          // opponents may actively close the travelling ball.
          if (possession && possession.inFlight && livePlayer.teamId === possession.teamId &&
              !(possession.arrivalWindowEntered && livePlayer.id === possession.intendedReceiverId)) return null;
          const distance = Math.hypot(target.x - statePlayer.position.x, target.y - statePlayer.position.y);
          const attrs = livePlayer.attrs || {}, pace = clamp(finite(attrs.pace, 70), 1, 99);
          const awareness = clamp(finite(attrs.awareness, 70), 1, 99), topSpeed = 5.1 + pace / 99 * 2.25;
          const intended = livePlayer.id === intendedId;
          const goalSide = team.attackingDirection * (target.x - statePlayer.position.x) >= 0;
          const etaSeconds = Math.max(0, distance / topSpeed + (99 - awareness) * 0.0035 - (intended ? 1.35 : 0) - (goalSide ? 0.06 : 0));
          return { playerId: livePlayer.id, teamId: team.id, target, distance, etaSeconds, intended,
            human: snapshot.humanPlayerIds.has(livePlayer.id) };
        }).filter(Boolean).sort((left, right) => left.etaSeconds - right.etaSeconds ||
          Number(right.intended) - Number(left.intended) || left.playerId.localeCompare(right.playerId));
        const addAssignment = (candidate, authority) => {
          if (!candidate || byId[candidate.playerId]) return;
          const row = {
            playerId: candidate.playerId, teamId: candidate.teamId,
            target: { x: candidate.target.x, y: candidate.target.y },
            distanceMetres: +candidate.distance.toFixed(3), etaSeconds: +candidate.etaSeconds.toFixed(3),
            intended: candidate.intended, human: candidate.human, authority
          };
          byId[row.playerId] = row; rows.push(row);
        };
        const selected = candidates[0];
        if (selected && selected.etaSeconds <= (selected.intended ? LOOSE_BALL_MAX_ETA_SECONDS + 1 : LOOSE_BALL_MAX_ETA_SECONDS)) {
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
      return { byId, rows };
    }
    function movementCommands(snapshot, world, formations, decisions, possession) {
      const commands = [], maps = targetMaps(formations, decisions, snapshot, possession), recovery = looseBallRecoveryAssignments(snapshot, world, possession), nextTick = world.tick + 1;
      const leaseOwnerId = hasPhysicalDribblingLease(domain.dribblingState)
        ? String(domain.dribblingState.logicalOwnerId || '') : '';
      const leaseBall = leaseOwnerId ? metricBall(snapshot.ball, snapshot) : null;
      const leaseTarget = leaseBall ? {
        x: clamp(leaseBall.position.x + leaseBall.velocity.x * FIXED_TICK_SECONDS,
          METRIC_PITCH.xMin, METRIC_PITCH.xMax),
        y: clamp(leaseBall.position.y + leaseBall.velocity.y * FIXED_TICK_SECONDS,
          METRIC_PITCH.yMin, METRIC_PITCH.yMax)
      } : null;
      const leaseRecoveryRows = [], receptionGuidanceRows = [];
      const currentTackles = new Set(snapshot.players.filter(player => player.tackleActive).map(player => player.id));
      for (const statePlayer of world.players) {
        const livePlayer = snapshot.players.find(player => player.id === statePlayer.id); if (!livePlayer) continue;
        const isHuman = snapshot.humanPlayerIds.has(livePlayer.id);
        const tackleEdge = currentTackles.has(livePlayer.id) && !domain.lastTackleState.has(livePlayer.id);
        const shoulderEdge = livePlayer.shoulderActive && !domain.lastTackleState.has('shoulder:' + livePlayer.id);
        const defensiveIntent = !isHuman ? maps.defensive[livePlayer.id] || null : null;
        const cpuPhysicalCandidate = defensiveIntent && defensiveIntent.physicalAction &&
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
            : nearestOpponent(livePlayer, snapshot);
          const direction = target ? unit({ x: target.x - livePlayer.x, y: target.y - livePlayer.y }, statePlayer.facing) : statePlayer.facing;
          const type = cpuPhysical ? cpuPhysical.type : tackleEdge ? 'stand-tackle' : 'shoulder-challenge';
          commands.push({ id: type + ':' + livePlayer.id + ':' + nextTick,
            tick: nextTick, playerId: livePlayer.id, type,
            targetId: target && target.id, direction }); continue;
        }
        let desired = { x: 0, y: 0 }, intensity = 0, mode = 'idle';
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
        // During a True Feel touch the player still logically owns the action,
        // but the physical ball is ahead of their feet. Guide Movement toward
        // that real MR position instead of continuing toward an unrelated
        // tactical carrier target and letting the ball drift away.
        const recoveryIntent = leaseRecovery || recovery.byId[livePlayer.id] || null;
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
          const defensiveTarget = defensiveIntent && defensiveIntent.target || null;
          const target = recoveryIntent && recoveryIntent.target || defensiveTarget || receptionTarget || runTarget || carrierTarget || maps.shape[livePlayer.id];
          if (target) {
            const toward = { x: target.x - metric.x, y: target.y - metric.y }, distance = vectorLength(toward);
            desired = unit(toward, statePlayer.facing);
            if (recoveryIntent) {
              const leaseRecoveryActive = recoveryIntent.authority === 'true-feel-lease-recovery';
              intensity = leaseRecoveryActive
                ? clamp(distance / 1.35, 0.58, 0.96)
                : clamp(distance / 4.2, 0.52, 1);
              mode = distance > (leaseRecoveryActive ? 0.58 : 2.2) ? 'sprint' : 'run';
            } else if (defensiveIntent) {
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
                desired = statePlayer.facing;
                intensity = 0;
                mode = 'idle';
              } else {
                const remainingTicks = Number.isSafeInteger(possession && possession.predictedArrivalTick)
                  ? Math.max(0, possession.predictedArrivalTick - snapshot.tick) : null;
                const remainingSeconds = remainingTicks == null ? null : remainingTicks * FIXED_TICK_SECONDS;
                const paceRating = clamp(finite(livePlayer.attrs && livePlayer.attrs.pace, 70), 1, 99);
                const runCapacity = 4.6 + (6.25 - 4.6) * (paceRating - 1) / 98;
                const requiredPace = remainingSeconds == null ? null : distance / Math.max(.08, remainingSeconds);
                intensity = requiredPace == null ? clamp(distance / 3.8, .32, 1) :
                  clamp(requiredPace / Math.max(.1, runCapacity) * 1.12 + .08, .32, 1);
                mode = distance > .55 && (requiredPace == null || requiredPace > runCapacity * .74) ? 'sprint' : 'run';
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
              intensity = clamp(distance / (runTarget ? 7 : 12), runTarget ? 0.74 : 0.12, runTarget ? 1 : 0.72);
              mode = runTarget || intensity > 0.74 ? 'sprint' : intensity > 0.2 ? 'run' : 'walk';
            }
          }
        }
        commands.push(mode === 'idle' ? { id: 'stop:' + livePlayer.id + ':' + nextTick, tick: nextTick, playerId: livePlayer.id, type: 'stop' }
          : { id: 'move:' + livePlayer.id + ':' + nextTick, tick: nextTick, playerId: livePlayer.id, type: 'move', move: desired, facing: desired, mode, intensity, durationTicks: 1,
            ...(isHuman ? { responsivenessMultiplier: HUMAN_INPUT_RESPONSIVENESS_MULTIPLIER } : {}) });
      }
      return { commands, recoveryAssignments: [...recovery.rows, ...leaseRecoveryRows, ...receptionGuidanceRows]
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
        if (['shot', 'pass'].includes(intent.type) && key === stagedCarrierEmission[teamId]) continue;
        if (['shot', 'pass'].includes(intent.type)) stagedCarrierEmission[teamId] = key;
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
          shotProfile: intent.shotProfile ? clone(intent.shotProfile) : null,
          supportKind: intent.supportKind == null ? null : String(intent.supportKind),
          supportMetrics: intent.supportMetrics ? clone(intent.supportMetrics) : null,
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
      return { id: player.id, origin, velocity: state.velocity, facing: state.facing,
        reach: state.radius + .42, reactions, reactionTicks, anticipated,
        maximumSpeed, acceleration, turnRate };
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
    function cpuPassLaunch(snapshot, owner, intent) {
      if (!intent.target) return null;
      const originLive = { x: snapshot.ball.x, y: snapshot.ball.y, z: Math.max(1, finite(snapshot.ball.z, 0)) };
      const targetLive = livePoint(intent.target, snapshot);
      const dx = targetLive.x - originLive.x, dy = targetLive.y - originLive.y;
      const liveDistance = Math.hypot(dx, dy);
      if (liveDistance <= 1e-9) return null;
      const metricDelta = { x: dx / snapshot.units.xPerMetre, y: dy / snapshot.units.yPerMetre };
      const metricDistance = Math.hypot(metricDelta.x, metricDelta.y);
      const metricDirection = unit(metricDelta, { x: 1, y: 0 });
      const shortSupport = ['support', 'recycle'].includes(String(intent.supportKind || ''));
      const long = !shortSupport && metricDistance > 20;
      // Pace is authored once in real metres per second. The prior host-world
      // formula varied with pitch-axis scaling and could turn a tiny pass into
      // a 14-15 m/s release. The committed host consumes this exact race pace.
      const longLaunch = long ? cpuLongPassLaunch(metricDistance) : null;
      const speedMetresPerSecond = longLaunch ? longLaunch.speed : cpuPassPaceMetresPerSecond(metricDistance, shortSupport, long);
      const liftAngleDeg = longLaunch ? longLaunch.liftAngleDeg : 0;
      const originMetric = {
        x: (originLive.x - snapshot.pitch.xMin) / snapshot.units.xPerMetre,
        y: (originLive.y - (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2) / snapshot.units.yPerMetre,
        z: originLive.z / snapshot.units.zPerMetre + .11
      };
      return dependencies.ball.resolveLaunch({
        id: ['cpu-pass-race', resetEpoch, snapshot.tick, owner.id, intent.targetPlayerId || 'none'].join(':'),
        origin: originMetric,
        direction: metricDirection,
        speed: speedMetresPerSecond,
        liftAngleDeg,
        sideSpinRpm: 0,
        topSpinRpm: 0,
        source: longLaunch && longLaunch.liftAngleDeg > 0 ? 'long-pass' : 'ground-pass',
        metadata: { adapterVersion: VERSION, targetPlayerId: intent.targetPlayerId || null }
      });
    }
    function boundarySafeCpuPassIntent(intent) {
      if (!intent || !intent.target) return clone(intent);
      const original = point(intent.target, { x: METRIC_PITCH.xMin, y: 0 });
      const target = {
        x: clamp(original.x, METRIC_PITCH.xMin + CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES,
          METRIC_PITCH.xMax - CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES),
        y: clamp(original.y, METRIC_PITCH.yMin + CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES,
          METRIC_PITCH.yMax - CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES)
      };
      const retargetDistanceMetres = Math.hypot(target.x - original.x, target.y - original.y);
      return { ...clone(intent), target, boundaryRetarget: retargetDistanceMetres > 1e-9 ? {
        original, target: clone(target), distanceMetres: Math.round(retargetDistanceMetres * 1000) / 1000,
        marginMetres: CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES
      } : null };
    }
    function evaluateCpuPassRace(snapshot, owner, intent) {
      const receiverId = intent.targetPlayerId == null ? '' : String(intent.targetPlayerId);
      const receiver = snapshot.players.find(player => player.id === receiverId) || null;
      const ownerPosition = metricPoint(owner, snapshot);
      const intendedTarget = point(intent.target, ownerPosition);
      const intendedDistanceMetres = Math.hypot(intendedTarget.x - ownerPosition.x,
        intendedTarget.y - ownerPosition.y);
      const base = {
        schema: 'football-legacy-cpu-pass-receiver-race-v2',
        evaluatedTick: snapshot.tick,
        passerId: owner.id,
        receiverId: receiverId || null,
        distanceMetres: Math.round(intendedDistanceMetres * 1000) / 1000,
        requiredMarginTicks: CPU_PASS_RACE_MIN_MARGIN_TICKS,
        requiredReceiverReadyBufferTicks: CPU_PASS_RECEIVER_READY_BUFFER_TICKS,
        maximumProjectionTicks: CPU_PASS_RACE_MAX_TICKS,
        boundaryRetarget: clone(intent.boundaryRetarget || null)
      };
      if (!receiver || receiver.teamId !== owner.teamId || receiver.isGK || receiver.sentOff || !receiver.contactEligible) {
        return { ...base, accepted: false, reason: 'receiver-ineligible', ballArrivalTick: null,
          receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      }
      // Below this separation, retaining controlled carry is both safer and
      // more football-like than striking a full MR pass into overlapping body
      // geometry. Ordinary close support remains available once the players
      // create a readable passing lane.
      if (intendedDistanceMetres < CPU_PASS_MIN_DISTANCE_METRES) {
        return { ...base, accepted: false, reason: 'pass-distance-below-control-threshold', ballArrivalTick: null,
          receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      }
      const launch = cpuPassLaunch(snapshot, owner, intent);
      if (!launch) return { ...base, accepted: false, reason: 'trajectory-unavailable', ballArrivalTick: null,
        receiverContactTick: null, opponentContactTick: null, opponentId: null, marginTicks: null, projectedFlightTicks: 0 };
      const target = point(intent.target, launch.state.position);
      const targetDistance = Math.hypot(target.x - launch.state.position.x, target.y - launch.state.position.y);
      const targetWindowMetres = clamp(1.35 + targetDistance * .025, 1.5, 3.25);
      // A temporary host contact lock can expire during the flight. Treat every
      // eligible outfield opponent as a future interceptor instead of erasing a
      // runner merely because they cannot touch the ball on this release tick.
      const opponents = snapshot.players.filter(player => player.teamId !== owner.teamId && !player.isGK && !player.sentOff)
        .sort((a, b) => a.id.localeCompare(b.id));
      const receiverRaceProfile = movementRaceProfile(receiver, snapshot, true);
      const receiverTargetEtaTicks = movementRaceEtaTicks(receiverRaceProfile, target);
      const opponentRaceProfiles = opponents.map(player => movementRaceProfile(player, snapshot));
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
      let ballArrivalTick = null, receiverContactTick = null, opponentContactTick = null, opponentId = null;
      let receiverEtaAtArrivalTick = null, projectedFlightTicks = 0;
      let closestApproach = null;
      const environment = goalEnvironment();
      // Ball V2 is pinned to four 1/240 substeps per 1/60 gameplay tick. Twelve
      // ticks stay below its 0.25-second call bound while retaining exact tick
      // samples from the real MR trajectory.
      const projectionChunkTicks = 15;
      const samplesPerTick = Math.max(1, Math.round(FIXED_TICK_SECONDS / dependencies.ball.DEFAULT_CONFIG.maxSubstep));
      while (projectedFlightTicks < CPU_PASS_RACE_MAX_TICKS) {
        const requestedTicks = Math.min(projectionChunkTicks, CPU_PASS_RACE_MAX_TICKS - projectedFlightTicks);
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
          if (physicsSample.position.z <= CPU_PASS_RACE_MAX_CONTACT_HEIGHT_METRES) {
            const sample = { x: physicsSample.position.x, y: physicsSample.position.y };
            const targetDistanceNow = Math.hypot(sample.x - target.x, sample.y - target.y);
            if (ballArrivalTick == null && targetDistanceNow <= targetWindowMetres) ballArrivalTick = tick;
            // Live Movement sends the receiver to the authored rendezvous, not
            // to an arbitrary earlier point inside this broad arrival window.
            // Pre-release acceptance must evaluate that exact same promise.
            const receiverEta = targetDistanceNow <= targetWindowMetres ? receiverTargetEtaTicks : null;
            if (receiverEta != null && receiverEta <= tick) {
              if (receiverEtaAtArrivalTick == null) receiverEtaAtArrivalTick = receiverEta;
              if (receiverContactTick == null) receiverContactTick = tick;
            }
            if (opponentContactTick == null) {
              for (const opponent of opponentRaceProfiles) {
                if (movementRaceEtaTicks(opponent, sample) <= tick) {
                  opponentContactTick = tick;
                  opponentId = opponent.id;
                  break;
                }
              }
            }
          }
        }
        state = stepped.state;
        context = stepped.context;
        projectedFlightTicks += completedTicks;
        if (completedTicks === 0 || state.settled ||
            (receiverContactTick != null && projectedFlightTicks >= receiverContactTick + CPU_PASS_RACE_MIN_MARGIN_TICKS && opponentContactTick == null)) break;
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
      let reason = 'receiver-arrives-with-six-tick-margin';
      if (receiverContactTick == null) reason = ballArrivalTick == null ? 'trajectory-misses-target-window' : 'receiver-cannot-arrive';
      else if (ballArrivalTick == null || receiverTargetEtaTicks > ballArrivalTick - CPU_PASS_RECEIVER_READY_BUFFER_TICKS) {
        reason = 'receiver-arrival-buffer-below-eight-ticks';
      }
      else if (opponentContactTick != null && opponentContactTick < receiverContactTick + CPU_PASS_RACE_MIN_MARGIN_TICKS) {
        reason = 'interception-margin-below-six-ticks';
      }
      return {
        ...base,
        accepted: reason === 'receiver-arrives-with-six-tick-margin',
        reason,
        ballArrivalTick,
        receiverEtaAtArrivalTick,
        receiverReadyBufferTicks: ballArrivalTick == null ? null : ballArrivalTick - receiverTargetEtaTicks,
        receiverContactTick,
        opponentContactTick,
        opponentId,
        marginTicks,
        projectedFlightTicks,
        targetWindowMetres: Math.round(targetWindowMetres * 1000) / 1000,
        launchSpeedMetresPerSecond: Math.round(launch.intent.speed * 1000) / 1000,
        launchLiftAngleDeg: Math.round(launch.intent.liftAngleDeg * 1000) / 1000,
        trajectorySignature: dependencies.ball.stateSignature(state)
      };
    }
    function rejectedPassFallback(snapshot, owner, rejectedRace) {
      const team = snapshot.teams.find(row => row.id === owner.teamId);
      const direction = team && team.attackingDirection === -1 ? -1 : 1;
      const ownerMetric = metricPoint(owner, snapshot);
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
      if (carryDistance >= 2 && carryClearance >= 3.25) return {
        type: 'carry', targetPlayerId: null, target: carryTarget, confidence: .72,
        reason: 'unsafe-pass-race-carry', fallbackFrom: 'pass', passRace: rejectedRace
      };
      const recycleCandidates = snapshot.players.filter(player => player.teamId === owner.teamId && player.id !== owner.id &&
        !player.isGK && !player.sentOff && player.contactEligible).map(player => {
        const target = metricPoint(player, snapshot);
        return { player, target, distance: Math.hypot(target.x - ownerMetric.x, target.y - ownerMetric.y),
          progress: direction * (target.x - ownerMetric.x) };
      }).filter(row => row.distance >= 3 && row.distance <= 26 && row.progress <= 1)
        .sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id));
      // One deterministic nearest recycle is enough. Exhaustively projecting
      // every teammate through MR on every rejected decision consumed the
      // frame budget without creating a different football decision.
      for (const candidate of recycleCandidates.slice(0, 1)) {
        const recycleIntent = boundarySafeCpuPassIntent({ type: 'pass', targetPlayerId: candidate.player.id, target: candidate.target });
        const recycleRace = evaluateCpuPassRace(snapshot, owner, recycleIntent);
        if (recycleRace.accepted) return {
          type: 'pass', targetPlayerId: candidate.player.id, target: candidate.target, confidence: .66,
          reason: 'unsafe-progressive-pass-safe-recycle', fallbackFrom: 'pass', passRace: recycleRace,
          rejectedPassRace: rejectedRace, offsideTiming: null
        };
      }
      return { type: 'wait', targetPlayerId: null, target: null, confidence: .82,
        reason: 'unsafe-pass-race-wait', fallbackFrom: 'pass', passRace: rejectedRace };
    }
    function lightweightShortSupportRace(snapshot, owner, intent) {
      if (!intent || intent.reason !== 'short-support-circulation' ||
          !['support', 'recycle'].includes(String(intent.supportKind || ''))) return null;
      const receiver = snapshot.players.find(player => String(player.id) === String(intent.targetPlayerId || '')) || null;
      if (!receiver || receiver.teamId !== owner.teamId || receiver.isGK || receiver.sentOff ||
          !receiver.contactEligible || !intent.target) return null;
      const origin = metricPoint(owner, snapshot), receiverPosition = metricPoint(receiver, snapshot);
      const target = point(intent.target, receiverPosition);
      const distanceMetres = Math.hypot(target.x - origin.x, target.y - origin.y);
      const receiverTargetOffsetMetres = Math.hypot(target.x - receiverPosition.x, target.y - receiverPosition.y);
      const metrics = intent.supportMetrics || {};
      const laneClearance = finite(metrics.laneClearance, 0);
      const receiverSpace = finite(metrics.receiverSpace, 0);
      if (distanceMetres < 6 || distanceMetres > 21 || receiverTargetOffsetMetres > 2.25 ||
          laneClearance < CPU_SHORT_SUPPORT_FAST_LANE_CLEARANCE ||
          receiverSpace < CPU_SHORT_SUPPORT_FAST_RECEIVER_SPACE) return null;
      return {
        schema: 'football-legacy-cpu-pass-receiver-race-v2',
        evaluatedTick: snapshot.tick,
        passerId: owner.id,
        receiverId: receiver.id,
        accepted: true,
        reason: 'short-support-lane-release',
        lightweight: true,
        projectedFlightTicks: 0,
        ballArrivalTick: null,
        receiverContactTick: null,
        opponentContactTick: null,
        opponentId: null,
        marginTicks: null,
        requiredMarginTicks: null,
        requiredReceiverReadyBufferTicks: null,
        maximumProjectionTicks: 0,
        distanceMetres: Math.round(distanceMetres * 1000) / 1000,
        launchSpeedMetresPerSecond: Math.round(
          cpuPassPaceMetresPerSecond(distanceMetres, true, false) * 1000
        ) / 1000,
        launchLiftAngleDeg: 0,
        receiverTargetOffsetMetres: Math.round(receiverTargetOffsetMetres * 1000) / 1000,
        boundaryRetarget: clone(intent.boundaryRetarget || null),
        supportKind: String(intent.supportKind),
        laneClearanceCanonical: Math.round(laneClearance * 1000) / 1000,
        receiverSpaceCanonical: Math.round(receiverSpace * 1000) / 1000
      };
    }
    function progressiveRiskRace(snapshot, owner, intent, race) {
      if (!race || race.accepted) return null;
      const team = snapshot.teams.find(row => row.id === owner.teamId);
      const direction = team && team.attackingDirection === -1 ? -1 : 1;
      const targetProgressMetres = intent.target
        ? direction * (intent.target.x - metricPoint(owner, snapshot).x) : 0;
      const progressiveAttempt =
        ['receiver-arrival-buffer-below-eight-ticks', 'interception-margin-below-six-ticks'].includes(race.reason) &&
        finite(intent.confidence, 0) >= CPU_PASS_PROGRESSION_MIN_CONFIDENCE &&
        targetProgressMetres >= CPU_PASS_PROGRESSION_MIN_METRES &&
        Number.isFinite(race.receiverReadyBufferTicks) && race.receiverReadyBufferTicks >= CPU_PASS_PROGRESSION_READY_BUFFER_TICKS &&
        (race.opponentContactTick == null || race.receiverContactTick != null &&
          race.opponentContactTick >= race.receiverContactTick + CPU_PASS_PROGRESSION_MIN_OPPONENT_MARGIN_TICKS);
      return progressiveAttempt ? { ...race, accepted: true,
        reason: 'high-confidence-progressive-risk-envelope', riskEnvelope: {
          minimumConfidence: CPU_PASS_PROGRESSION_MIN_CONFIDENCE,
          minimumReceiverReadyBufferTicks: CPU_PASS_PROGRESSION_READY_BUFFER_TICKS,
          minimumOpponentMarginTicks: CPU_PASS_PROGRESSION_MIN_OPPONENT_MARGIN_TICKS,
          targetProgressMetres: Math.round(targetProgressMetres * 1000) / 1000
        } } : null;
    }
    function receiverFeetCorrection(snapshot, owner, intent, rejectedRace) {
      if (!rejectedRace || !['receiver-cannot-arrive', 'receiver-arrival-buffer-below-eight-ticks',
        'trajectory-misses-target-window'].includes(rejectedRace.reason)) return null;
      const receiver = snapshot.players.find(player => String(player.id) === String(intent.targetPlayerId || '')) || null;
      if (!receiver || receiver.teamId !== owner.teamId || receiver.isGK || receiver.sentOff || !receiver.contactEligible) return null;
      const origin = metricPoint(owner, snapshot), position = metricPoint(receiver, snapshot), velocity = metricVelocity(receiver, snapshot);
      const target = {
        x: clamp(position.x + velocity.x * .12, METRIC_PITCH.xMin + CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES,
          METRIC_PITCH.xMax - CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES),
        y: clamp(position.y + velocity.y * .12, METRIC_PITCH.yMin + CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES,
          METRIC_PITCH.yMax - CPU_PASS_TARGET_BOUNDARY_MARGIN_METRES)
      };
      const distanceMetres = Math.hypot(target.x - origin.x, target.y - origin.y);
      if (distanceMetres < 6 || distanceMetres > 24) return null;
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
      if (!intent || intent.type !== 'pass') {
        commitments[owner.teamId] = null;
        return { outputs, commitments };
      }
      const candidateIntent = boundarySafeCpuPassIntent(intent);
      const commitment = commitments[owner.teamId];
      if (commitment && sameRejectedCpuPass(commitment, candidateIntent)) {
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
      let selectedIntent = candidateIntent;
      const originalRace = lightweightShortSupportRace(snapshot, owner, candidateIntent) ||
        evaluateCpuPassRace(snapshot, owner, candidateIntent);
      let acceptedRace = progressiveRiskRace(snapshot, owner, candidateIntent, originalRace) || originalRace;
      if (!acceptedRace.accepted) {
        const correctedIntent = receiverFeetCorrection(snapshot, owner, candidateIntent, originalRace);
        if (correctedIntent) {
          const correctedRace = evaluateCpuPassRace(snapshot, owner, correctedIntent);
          const correctedAccepted = progressiveRiskRace(snapshot, owner, correctedIntent, correctedRace) || correctedRace;
          if (correctedAccepted.accepted) {
            selectedIntent = correctedIntent;
            acceptedRace = { ...correctedAccepted, rendezvousCorrection: clone(correctedIntent.rendezvousCorrection),
              originalRejectedRace: clone(originalRace) };
          }
        }
      }
      const carrierIntent = acceptedRace.accepted ? { ...clone(selectedIntent), passRace: acceptedRace }
        : rejectedPassFallback(snapshot, owner, originalRace);
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
          targetPlayerId: candidateIntent.targetPlayerId == null ? null : String(candidateIntent.targetPlayerId),
          target: clone(candidateIntent.target),
          reason: String(candidateIntent.reason || ''),
          supportKind: candidateIntent.supportKind == null ? null : String(candidateIntent.supportKind)
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
      return { colliders: [
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
          liftAngleDeg: clamp(finite(intent.liftAngleDeg, 0), -8, 62), sideSpinRpm: clamp(finite(intent.sideSpinRpm, 0), -2200, 2200),
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
    function contactPlan(snapshot, movementState, plannedBall, possession) {
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
      const activeIds = new Set(movementState.players.map(player => player.id));
      const priorBallPosition = metricBall(snapshot.ball, snapshot).position;
      const stimulus = possession && possession.reactionStimulus ||
        (possession && possession.inFlight && possession.deliberatePass && Number.isSafeInteger(possession.releaseTick) &&
          possession.sourcePlayerId ? {
            releaseTick: possession.releaseTick,
            sourcePlayerId: possession.sourcePlayerId,
            sourceTeamId: possession.teamId
          } : null);
      const reactionContext = stimulus && Number.isSafeInteger(stimulus.releaseTick) && stimulus.sourcePlayerId &&
        stimulus.sourceTeamId && snapshot.tick <= stimulus.releaseTick + dependencies.contact.MAX_REACTION_DELAY_TICKS ? {
          active: true,
          stimulus: 'deliberate-pass-release',
          releaseTick: stimulus.releaseTick,
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
            contactEligible: !player.sentOff && !player.isGK && player.contactEligible &&
              (!ownAuthoredFlight || intendedReceiver),
            bodyContactEligible: !player.sentOff && !player.isGK && player.bodyContactEligible,
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
        consumedFirstTouchIds: domain.consumedFirstTouchIds,
        consumedFirstTouchThroughTick: domain.consumedFirstTouchThroughTick,
        consumedAerialIds: domain.consumedAerialIds,
        gate: snapshot.contact.gate
      }, contactCapability);
      if (!result || result.schema !== dependencies.contact.RESULT_SCHEMA || result.version !== dependencies.contact.VERSION ||
          result.tick !== snapshot.tick || result.epoch !== resetEpoch || result.online !== false ||
          !Number.isSafeInteger(result.consumedFirstTouchThroughTick) ||
          result.consumedFirstTouchThroughTick < domain.consumedFirstTouchThroughTick ||
          result.consumedFirstTouchThroughTick > snapshot.tick ||
          !dependencies.ball.isBallState(result.ballState)) throw new Error('live contact composer result contract failed');
      return result;
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
      const row = intelligence.projection.find(intent => intent.playerId === carrierId && ['pass', 'shot'].includes(intent.type));
      if (!row) return null;
      const shotProfile = row.type === 'shot' && row.shotProfile && typeof row.shotProfile === 'object'
        ? row.shotProfile : null;
      return {
        id: ['cpu-dribble-action', resetEpoch, carrierId, row.type, row.targetPlayerId || 'none', Math.floor(snapshot.tick / 6)].join(':'),
        type: row.type,
        actorId: carrierId,
        targetPlayerId: row.targetPlayerId,
        target: row.target,
        power: clamp(finite(shotProfile && shotProfile.power, finite(row.confidence, 0.65)), 0, 1),
        variant: shotProfile ? String(shotProfile.technique || 'driven') : 'normal',
        source: 'cpu-v2',
        commandTick: snapshot.tick
      };
    }
    function dribblingPlan(snapshot, movementState, logicalOwnerId, candidateBallState, intelligence, activeLeaseAtStart) {
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
      const carrierId = activeLeaseAtStart && domain.dribblingState.logicalOwnerId
        ? String(domain.dribblingState.logicalOwnerId)
        : logicalOwnerId;
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
      const result = dependencies.dribbling.resolve({
        schema: dependencies.dribbling.REQUEST_SCHEMA,
        workflow: capability.workflow,
        online: false,
        tick: snapshot.tick,
        epoch: resetEpoch,
        seed: deterministicSeed,
        fixedTickSeconds: FIXED_TICK_SECONDS,
        state: domain.dribblingState,
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
          shield: Boolean(humanControl && humanControl.shield)
        },
        surface: snapshot.dribbling.surface,
        actionIntent,
        gate: snapshot.contact.gate
      }, dribblingCapability);
      if (!result || result.schema !== dependencies.dribbling.RESULT_SCHEMA || result.version !== dependencies.dribbling.VERSION ||
          result.tick !== snapshot.tick || result.epoch !== resetEpoch || result.workflow !== capability.workflow || result.online !== false ||
          !dependencies.ball.isBallState(result.ballState) || !result.serializedState ||
          dependencies.dribbling.restoreState(result.serializedState).schema !== dependencies.dribbling.STATE_SCHEMA) {
        throw new Error('live Dribbling V2 result contract failed');
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
        const formations = formationOutputs(controlSnapshot, phaseState), cpu = cpuOutputs(controlSnapshot, formations, possession);
        let cpuRejectedPassCommitments = { you: null, opp: null };
        if (authorityProfile.cpuPassRaceFilter) {
          const gated = gatedCpuOutputs(controlSnapshot, cpu.outputs);
          cpu.outputs = gated.outputs;
          cpuRejectedPassCommitments = gated.commitments;
        }
        const currentMovement = movementWorld(controlSnapshot), commands = movementCommands(controlSnapshot, currentMovement.world, formations, cpu.outputs, possession);
        const movement = dependencies.movement.advance(currentMovement.world, commands.commands, 1, { fixedTickSeconds: FIXED_TICK_SECONDS });
        const movementProjection = movement.state.players.map(player => {
          const position = livePoint(player.position, snapshot), velocity = liveVelocity(player.velocity, snapshot);
          return { id: player.id, x: position.x, y: position.y, vx: velocity.x, vy: velocity.y, fx: player.facing.x, fy: player.facing.y,
            stamina: player.stamina, locomotionState: player.locomotionState, visibleAction: player.visibleAction, action: player.action ? clone(player.action) : null };
        });
        const intelligence = intelligenceProjection(controlSnapshot, cpu.outputs);
        const movementOwnerId = movement.state.ballOwnerId == null ? null : String(movement.state.ballOwnerId);
        const snapshotOwner = controlSnapshot.ball.ownerId && snapshot.players.find(player => player.id === controlSnapshot.ball.ownerId);
        let effectiveOwnerId = leaseOwnerId || ((movementOwnerId || snapshotOwner && snapshotOwner.isGK)
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
        const contact = activeLeaseAtStart ? null : contactPlan(ballSnapshot, movement.state, plannedBall, possession);
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
          if (!contactOwner && possession.inFlight && contact.contactType === 'involuntary-deflection' && contactActor) {
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
          } else if (!contactOwner && possession.inFlight && contactActor && contactActor.teamId !== possession.teamId) {
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
          const directionalTouchPlayerId = contact.ownedContact && snapshot.contact.firstTouchIntent &&
            snapshot.contact.firstTouchIntent.type === 'directional-touch' && contact.presentation
            ? String(contact.presentation.playerId || '') : '';
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
          candidateBallState, intelligence, activeLeaseAtStart);
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
        } else if ((!possession.inFlight && !possession.offsideCandidate && !possession.reactionStimulus) || activeLeaseAtStart) {
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
          !(suppressedLeaseActions.has(intent.playerId) && ['pass', 'shot'].includes(intent.type)));
        const dribblingProjection = {
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
            ball: hostBallProjection, contact: contact ? clone(contact) : null,
            movementTelemetry: clone(movement.telemetry), recoveryAssignments: clone(commands.recoveryAssignments), ballTrace: clone(plannedBall.trace),
            possession: clone(postMovementPossession), movementBallOwnerId: effectiveOwnerId,
            logicalBallOwnerId: effectiveOwnerId, physicalBallSeparated: physicalSeparated,
            dribbling: dribblingProjection,
            authorityCounters: { legacyOutfieldLocomotion: 0, legacyCpu: 0, legacyLooseBallIntegration: 0, candidateTicks: 1 } },
          staged: { world: stagedWorld, rosterSignature: currentMovement.signature, cpuMemories: cpu.memories,
            cpuRejectedPassCommitments: clone(cpuRejectedPassCommitments),
            ballState: stagedBallState, ballContext: plannedBall.stagedContext, lastBallProjection: stagedBallProjection,
            lastLaunchSequence: plannedBall.stagedLaunchSequence, lastTackleState: commands.stagedTackleState,
            lastCarrierEmission: intelligence.stagedCarrierEmission, possession: postMovementPossession, transition: stagedTransition,
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
          runs: clone(frame.cpu[teamId].runs), carrierIntent: clone(frame.cpu[teamId].carrierIntent) }]));
        latestTelemetry = { movement: clone(frame.movementTelemetry), recoveryAssignments: clone(frame.hostProjection.recoveryAssignments),
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
      finalizePrepared, abortPrepared, rollbackPrepared, commitTick, reset, status, exportState, restoreState,
      disable: reason => freeze(reason || 'manual adapter freeze') });
  }

  return Object.freeze({
    VERSION, ACKNOWLEDGEMENT, SUPPORTED_WORKFLOWS, REQUIRED_DEPENDENCIES, DEPENDENCY_CONTRACTS,
    FIXED_TICK_SECONDS, METRIC_PITCH, TURNOVER_TACKLE_PROTECTION_TICKS,
    HUMAN_RECEPTION_GUIDANCE_MAX_DISTANCE_METRES, HUMAN_RECEPTION_GUIDANCE_STRONG_INPUT,
    HUMAN_RECEPTION_GUIDANCE_OPPOSING_DOT,
    cpuPhysicalActionAllowed, stableHash, createCapability, createAttachment
  });
});
