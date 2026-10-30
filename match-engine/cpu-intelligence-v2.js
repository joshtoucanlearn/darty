'use strict';

/*
 * Football Legacy deterministic CPU intelligence v2.
 *
 * This module is intentionally dormant. It is a pure, fixed-tick
 * snapshot-to-decision candidate and is not loaded or called by match.html.
 * The established Build 173 workflow remains the sole live authority until a
 * separately approved shadow/opt-in migration.
 */
(function exposeCpuIntelligence(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyCPUIntelligenceV2 = api;
})(typeof window === 'object' ? window : null, function createCpuIntelligenceApi() {
  'use strict';

  const VERSION = '2.0.0-dormant';
  const SNAPSHOT_SCHEMA = 'football-legacy-cpu-snapshot-v2';
  const MEMORY_SCHEMA = 'football-legacy-cpu-memory-v2';
  const DECISION_SCHEMA = 'football-legacy-cpu-decision-v2';

  const CANONICAL_PITCH = Object.freeze({ xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 });
  const GOAL_THIRD_OFFSET_CANONICAL = (CANONICAL_PITCH.yMax - CANONICAL_PITCH.yMin) * 2.44 / 68;
  const COORDINATE_CONTRACT = Object.freeze({
    schema: 'football-legacy-cpu-coordinate-contract-v2',
    snapshotPoints: 'supplied-pitch-units',
    decisionPoints: 'supplied-pitch-units',
    memoryPoints: 'supplied-pitch-units',
    authoredSpatialValues: 'canonical-reference-pitch-units',
    measuredSpatialValues: 'canonical-reference-pitch-units',
    referencePitch: CANONICAL_PITCH
  });

  const DEFAULT_CONFIG = Object.freeze({
    fixedTickSeconds: 1 / 60,
    minimumReactionTicks: 1,
    maximumReactionTicks: 5,
    openingMemoryTicks: 42,
    minimumCommitTicks: 24,
    maximumCommitTicks: 96,
    abortBlockedTicks: 4,
    minimumLaneClearance: 46,
    openedLaneClearance: 92,
    newlyOpenedDelta: 54,
    severeBlockClearance: 24,
    minimumPassLaneClearance: 34,
    minimumBidScore: 108,
    maximumCommittedRuns: 3,
    laneConflictWidth: 210,
    offsideBuffer: 30,
    offsideMistakeBaseRisk: 0.25,
    offsideMistakeAwarenessRelief: 0.18,
    offsideMistakePaceRisk: 0.04,
    offsideMistakeMaxEarlyTicks: 8,
    minimumForwardRun: 75,
    restDefenseMinimum: 2,
    defensivePressLeadTicks: 3,
    defensiveActionCooldownTicks: 30,
    defensiveStandTackleMinDistance: 12,
    defensiveStandTackleMaxDistance: 76,
    defensiveSlideTackleMinDistance: 78,
    defensiveSlideTackleMaxDistance: 118,
    defensiveSlideMinimumAlignment: 0.72,
    defensiveSlideDangerDepth: 790,
    defensiveShoulderMaxDistance: 50,
    defensiveMinimumActionAlignment: 0.5,
    defensiveMaximumActionRelativeSpeed: 260,
    defensiveCoverDepth: 240,
    shotDistance: 690,
    minimumShotLaneClearance: 27,
    minimumCarryLaneClearance: 54,
    carryDistance: 230,
    routineProgressiveRunMinimumProgress: 210,
    routineProgressiveRunMinimumDistance: 260,
    routineProgressiveRunClearanceBonus: 18,
    routineProgressiveRunScoreAdvantage: 10,
    circulationHistoryPasses: 6,
    circulationHistoryTicks: 720,
    circulationRepeatedPairLimit: 2,
    pitchInset: 18
  });

  const FORWARD_LIMIT_BY_FAMILY = Object.freeze({
    goalkeeper: 0,
    'centre-back': 170,
    'full-back': 520,
    'wing-back': 650,
    'defensive-midfielder': 360,
    midfielder: 610,
    'attacking-midfielder': 790,
    winger: 920,
    striker: 980
  });

  const PENETRATING_RUNS = Object.freeze(new Set(['channel', 'overlap', 'underlap', 'central', 'late-box']));

  function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function rounded(value, places) {
    const scale = 10 ** (places == null ? 3 : places);
    return Math.round(finite(value, 0) * scale) / scale;
  }

  function point(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      x: finite(source.x, fallback.x),
      y: finite(source.y, fallback.y)
    };
  }

  function pitchSpace(pitch) {
    const canonicalWidth = CANONICAL_PITCH.xMax - CANONICAL_PITCH.xMin;
    const canonicalHeight = CANONICAL_PITCH.yMax - CANONICAL_PITCH.yMin;
    const width = pitch.xMax - pitch.xMin;
    const height = pitch.yMax - pitch.yMin;
    return {
      xUnitsPerCanonical: width / canonicalWidth,
      yUnitsPerCanonical: height / canonicalHeight,
      xFromCanonical(value) {
        return value * width / canonicalWidth;
      },
      yFromCanonical(value) {
        return value * height / canonicalHeight;
      },
      xToCanonical(value) {
        return value * canonicalWidth / width;
      },
      yToCanonical(value) {
        return value * canonicalHeight / height;
      },
      pointToCanonical(value) {
        return {
          x: (value.x - pitch.xMin) * canonicalWidth / width + CANONICAL_PITCH.xMin,
          y: (value.y - pitch.yMin) * canonicalHeight / height + CANONICAL_PITCH.yMin
        };
      }
    };
  }

  function distance(a, b, space) {
    return Math.hypot(space.xToCanonical(a.x - b.x), space.yToCanonical(a.y - b.y));
  }

  function distanceToSegment(subject, start, end, space) {
    const canonicalSubject = space.pointToCanonical(subject);
    const canonicalStart = space.pointToCanonical(start);
    const canonicalEnd = space.pointToCanonical(end);
    const dx = canonicalEnd.x - canonicalStart.x;
    const dy = canonicalEnd.y - canonicalStart.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 1e-9) {
      return Math.hypot(canonicalSubject.x - canonicalStart.x, canonicalSubject.y - canonicalStart.y);
    }
    const amount = clamp(((canonicalSubject.x - canonicalStart.x) * dx +
      (canonicalSubject.y - canonicalStart.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(
      canonicalSubject.x - (canonicalStart.x + dx * amount),
      canonicalSubject.y - (canonicalStart.y + dy * amount)
    );
  }

  function cloneObject(value) {
    if (Array.isArray(value)) return value.map(cloneObject);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const key of Object.keys(value)) result[key] = cloneObject(value[key]);
    return result;
  }

  function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function configWith(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const config = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if (!Number.isFinite(source[key])) throw new TypeError(key + ' must be a finite number');
      config[key] = Number(source[key]);
    }
    if (!(config.fixedTickSeconds > 0)) throw new RangeError('fixedTickSeconds must be positive');
    if (!Number.isInteger(config.minimumReactionTicks) || config.minimumReactionTicks < 0) {
      throw new RangeError('minimumReactionTicks must be a non-negative integer');
    }
    if (!Number.isInteger(config.maximumReactionTicks) || config.maximumReactionTicks < config.minimumReactionTicks) {
      throw new RangeError('maximumReactionTicks must be an integer at least minimumReactionTicks');
    }
    for (const key of ['openingMemoryTicks', 'minimumCommitTicks', 'maximumCommitTicks', 'abortBlockedTicks',
      'maximumCommittedRuns', 'restDefenseMinimum', 'offsideMistakeMaxEarlyTicks',
      'defensivePressLeadTicks', 'defensiveActionCooldownTicks', 'circulationHistoryPasses',
      'circulationHistoryTicks', 'circulationRepeatedPairLimit']) {
      if (!Number.isInteger(config[key]) || config[key] < 0) throw new RangeError(key + ' must be a non-negative integer');
    }
    if (config.circulationHistoryPasses < 2) throw new RangeError('circulationHistoryPasses must be at least 2');
    if (config.circulationRepeatedPairLimit < 1) throw new RangeError('circulationRepeatedPairLimit must be at least 1');
    if (config.maximumCommitTicks < config.minimumCommitTicks) {
      throw new RangeError('maximumCommitTicks must be at least minimumCommitTicks');
    }
    for (const key of ['offsideMistakeBaseRisk', 'offsideMistakeAwarenessRelief', 'offsideMistakePaceRisk']) {
      if (config[key] < 0 || config[key] > 1) throw new RangeError(key + ' must be between 0 and 1');
    }
    if (config.defensiveMinimumActionAlignment < 0 || config.defensiveMinimumActionAlignment > 1) {
      throw new RangeError('defensiveMinimumActionAlignment must be between 0 and 1');
    }
    for (const key of ['minimumLaneClearance', 'openedLaneClearance', 'newlyOpenedDelta',
      'severeBlockClearance', 'minimumPassLaneClearance', 'minimumBidScore', 'offsideBuffer',
      'minimumForwardRun', 'shotDistance', 'minimumShotLaneClearance', 'minimumCarryLaneClearance',
      'carryDistance', 'pitchInset', 'defensiveStandTackleMinDistance',
      'defensiveStandTackleMaxDistance', 'defensiveSlideTackleMinDistance',
      'defensiveSlideTackleMaxDistance', 'defensiveSlideDangerDepth', 'defensiveShoulderMaxDistance',
      'defensiveMaximumActionRelativeSpeed', 'defensiveCoverDepth']) {
      if (config[key] < 0) throw new RangeError(key + ' must be non-negative');
    }
    if (config.defensiveStandTackleMaxDistance < config.defensiveStandTackleMinDistance) {
      throw new RangeError('defensiveStandTackleMaxDistance must be at least defensiveStandTackleMinDistance');
    }
    if (config.defensiveSlideTackleMaxDistance < config.defensiveSlideTackleMinDistance) {
      throw new RangeError('defensiveSlideTackleMaxDistance must be at least defensiveSlideTackleMinDistance');
    }
    if (config.defensiveSlideMinimumAlignment < 0 || config.defensiveSlideMinimumAlignment > 1) {
      throw new RangeError('defensiveSlideMinimumAlignment must be between 0 and 1');
    }
    if (!(config.laneConflictWidth > 0)) throw new RangeError('laneConflictWidth must be positive');
    return config;
  }

  function normalizePitch(value) {
    const source = value && typeof value === 'object' ? value : {};
    const pitch = {
      xMin: finite(source.xMin, CANONICAL_PITCH.xMin),
      xMax: finite(source.xMax, CANONICAL_PITCH.xMax),
      yMin: finite(source.yMin, CANONICAL_PITCH.yMin),
      yMax: finite(source.yMax, CANONICAL_PITCH.yMax)
    };
    if (!(pitch.xMax > pitch.xMin) || !(pitch.yMax > pitch.yMin)) {
      throw new RangeError('pitch bounds must have positive width and height');
    }
    return pitch;
  }

  function validateConfigForPitch(config, pitch) {
    // Spatial configuration is authored in the declared canonical reference
    // pitch, independent of the caller's pitch units. Runtime geometry is
    // converted through pitchSpace(), so these bounds remain strict and unit
    // stable on legacy, metric and other positively-sized pitch mappings.
    pitchSpace(pitch);
    const width = CANONICAL_PITCH.xMax - CANONICAL_PITCH.xMin;
    const height = CANONICAL_PITCH.yMax - CANONICAL_PITCH.yMin;
    const diagonal = Math.hypot(width, height);
    for (const key of ['minimumLaneClearance', 'openedLaneClearance', 'newlyOpenedDelta',
      'severeBlockClearance', 'minimumPassLaneClearance', 'minimumShotLaneClearance',
      'minimumCarryLaneClearance']) {
      if (config[key] > diagonal) throw new RangeError(key + ' must not exceed the pitch diagonal');
    }
    for (const key of ['offsideBuffer', 'minimumForwardRun', 'shotDistance', 'carryDistance']) {
      if (config[key] >= width) throw new RangeError(key + ' must be less than the pitch width');
    }
    for (const key of ['defensiveStandTackleMinDistance', 'defensiveStandTackleMaxDistance',
      'defensiveSlideTackleMinDistance', 'defensiveSlideTackleMaxDistance',
      'defensiveSlideDangerDepth', 'defensiveShoulderMaxDistance', 'defensiveCoverDepth']) {
      if (config[key] > diagonal) throw new RangeError(key + ' must not exceed the pitch diagonal');
    }
    if (config.laneConflictWidth > height) {
      throw new RangeError('laneConflictWidth must not exceed the pitch height');
    }
    if (config.pitchInset * 2 >= Math.min(width, height)) {
      throw new RangeError('pitchInset must leave a positive playable area');
    }
  }

  function normalizePlayer(value) {
    const source = value && typeof value === 'object' ? value : {};
    if (typeof source.id !== 'string' || !source.id) throw new TypeError('every player requires a non-empty id');
    if (typeof source.teamId !== 'string' || !source.teamId) throw new TypeError('every player requires a teamId');
    const anchor = point(source.formationAnchor, { x: finite(source.x, 0), y: finite(source.y, 0) });
    return {
      id: source.id,
      teamId: source.teamId,
      x: finite(source.x, 0),
      y: finite(source.y, 0),
      vx: finite(source.vx, 0),
      vy: finite(source.vy, 0),
      role: String(source.role || source.position || 'midfielder'),
      position: String(source.position || source.role || 'midfielder'),
      unitRole: String(source.unitRole || ''),
      duty: String(source.duty || 'balanced'),
      formationAnchor: anchor,
      pace: clamp(finite(source.pace, 70), 1, 99),
      acceleration: clamp(finite(source.acceleration, source.pace || 70), 1, 99),
      awareness: clamp(finite(source.awareness, 70), 1, 99),
      passing: clamp(finite(source.passing, source.pass || 70), 1, 99),
      shooting: clamp(finite(source.shooting, source.shoot || 65), 1, 99),
      control: clamp(finite(source.control, 70), 1, 99),
      agility: clamp(finite(source.agility, source.acceleration || 70), 1, 99),
      committed: Boolean(source.committed),
      defending: clamp(finite(source.defending, source.defend || 65), 1, 99),
      aggression: clamp(finite(source.aggression, 70), 1, 99),
      strength: clamp(finite(source.strength, 70), 1, 99),
      balance: clamp(finite(source.balance, 70), 1, 99),
      stamina: clamp(finite(source.stamina, 80), 0, 100),
      fx: finite(source.fx, 0),
      fy: finite(source.fy, 0),
      cpuControlled: source.cpuControlled !== false && !Boolean(source.humanControlled),
      isGK: Boolean(source.isGK),
      sentOff: Boolean(source.sentOff),
      available: source.available !== false
    };
  }

  function normalizeEvent(value, index, tick) {
    const source = value && typeof value === 'object' ? value : {};
    const eventTick = Number.isInteger(source.tick) ? source.tick : tick;
    return {
      id: String(source.id || source.type + ':' + eventTick + ':' + index),
      type: String(source.type || ''),
      tick: eventTick,
      teamId: source.teamId == null ? null : String(source.teamId),
      playerId: source.playerId == null ? null : String(source.playerId),
      runType: source.runType == null ? null : String(source.runType),
      target: source.target ? point(source.target, { x: 0, y: 0 }) : null,
      reason: String(source.reason || 'external-observation')
    };
  }

  function normalizeSnapshot(snapshot, config) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('snapshot must be an object');
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) {
      throw new TypeError('snapshot.tick must be an explicit non-negative integer simulation tick');
    }
    if (!Number.isFinite(snapshot.fixedTickSeconds) || !(snapshot.fixedTickSeconds > 0)) {
      throw new TypeError('snapshot.fixedTickSeconds must explicitly define the simulation tick duration');
    }
    if (Math.abs(snapshot.fixedTickSeconds - config.fixedTickSeconds) > 1e-12) {
      throw new RangeError('snapshot.fixedTickSeconds must match the configured fixed tick');
    }
    if (typeof snapshot.teamId !== 'string' || !snapshot.teamId) throw new TypeError('snapshot.teamId is required');
    const direction = snapshot.attackingDirection;
    if (direction !== 1 && direction !== -1) throw new TypeError('attackingDirection must be exactly 1 or -1');
    const pitch = normalizePitch(snapshot.pitch);
    validateConfigForPitch(config, pitch);
    const players = Array.isArray(snapshot.players) ? snapshot.players.map(normalizePlayer) : [];
    const ids = new Set();
    for (const player of players) {
      if (ids.has(player.id)) throw new TypeError('player ids must be unique');
      ids.add(player.id);
    }
    const teamPlayers = players.filter(player => player.teamId === snapshot.teamId);
    if (!teamPlayers.length) throw new TypeError('snapshot must contain at least one controlled-team player');
    const carrierId = snapshot.carrierId == null ? null : String(snapshot.carrierId);
    if (carrierId && !ids.has(carrierId)) throw new TypeError('carrierId must reference a player in snapshot.players');
    const possessionTeamId = snapshot.possessionTeamId == null ? null : String(snapshot.possessionTeamId);
    const carrier = carrierId ? players.find(player => player.id === carrierId) : null;
    if (carrier && !possessionTeamId) {
      throw new TypeError('possessionTeamId is required when carrierId is set');
    }
    if (carrier && carrier.teamId !== possessionTeamId) {
      throw new RangeError('carrierId player teamId must match possessionTeamId');
    }
    if (possessionTeamId && !players.some(player => player.teamId === possessionTeamId)) {
      throw new TypeError('possessionTeamId must reference a team represented in snapshot.players');
    }
    const offsideLine = finite(snapshot.offsideLine, direction > 0 ? pitch.xMax : pitch.xMin);
    const ballFallback = carrierId ? players.find(player => player.id === carrierId) : null;
    const ball = point(snapshot.ball, ballFallback || { x: (pitch.xMin + pitch.xMax) / 2, y: (pitch.yMin + pitch.yMax) / 2 });
    const events = (Array.isArray(snapshot.events) ? snapshot.events : [])
      .map((event, index) => normalizeEvent(event, index, snapshot.tick))
      .filter(event => event.tick <= snapshot.tick)
      .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
    return {
      schema: SNAPSHOT_SCHEMA,
      tick: snapshot.tick,
      fixedTickSeconds: snapshot.fixedTickSeconds,
      teamId: snapshot.teamId,
      possessionTeamId,
      carrierId,
      intendedReceiverId: snapshot.intendedReceiverId == null ? null : String(snapshot.intendedReceiverId),
      inFlight: snapshot.inFlight === true,
      attackingDirection: direction,
      offsideLine,
      pitch,
      ball,
      players: players.sort((a, b) => a.id.localeCompare(b.id)),
      events
    };
  }

  function validateMemoryPoint(value, label) {
    if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
      throw new TypeError(label + ' must be a finite {x, y} point');
    }
  }

  function validateMemoryInteger(value, label, minimum) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new TypeError(label + ' must be an integer at least ' + minimum);
    }
  }

  function validateMemoryNumber(value, label, minimum, maximum) {
    if (!Number.isFinite(value) || value < minimum || (maximum != null && value > maximum)) {
      throw new TypeError(label + ' must be a finite number in the supported range');
    }
  }

  function validateMemoryString(value, label) {
    if (typeof value !== 'string' || !value) throw new TypeError(label + ' must be a non-empty string');
  }

  function emptyDefenseMemory(cooldowns) {
    return {
      phase: 'idle',
      carrierId: null,
      observedTick: null,
      eligibleTick: null,
      reactionTicks: 0,
      primaryPlayerId: null,
      coverPlayerId: null,
      commitTick: null,
      minUntilTick: null,
      expiresTick: null,
      cooldowns: cloneObject(cooldowns || {})
    };
  }

  function emptyCirculationMemory() {
    return {
      pendingPasserId: null,
      pendingReceiverId: null,
      pendingIssuedTick: null,
      lastCompletedPasserId: null,
      lastCompletedReceiverId: null,
      lastCompletedTick: null,
      recentPasses: []
    };
  }

  function validateCirculationMemory(circulation) {
    if (!isRecord(circulation)) throw new TypeError('memory.circulation must be an object');
    for (const field of ['pendingPasserId', 'pendingReceiverId',
      'lastCompletedPasserId', 'lastCompletedReceiverId']) {
      if (circulation[field] != null) validateMemoryString(circulation[field], 'memory.circulation.' + field);
    }
    for (const field of ['pendingIssuedTick', 'lastCompletedTick']) {
      if (circulation[field] != null) validateMemoryInteger(circulation[field], 'memory.circulation.' + field, 0);
    }
    const pending = [circulation.pendingPasserId, circulation.pendingReceiverId,
      circulation.pendingIssuedTick].filter(value => value != null).length;
    if (pending !== 0 && pending !== 3) throw new RangeError('memory pending circulation pass is incomplete');
    const completed = [circulation.lastCompletedPasserId, circulation.lastCompletedReceiverId,
      circulation.lastCompletedTick].filter(value => value != null).length;
    if (completed !== 0 && completed !== 3) throw new RangeError('memory completed circulation pass is incomplete');
    if (circulation.recentPasses != null && !Array.isArray(circulation.recentPasses)) {
      throw new TypeError('memory.circulation.recentPasses must be an array');
    }
    for (const [index, pass] of (circulation.recentPasses || []).entries()) {
      if (!isRecord(pass)) throw new TypeError('memory.circulation.recentPasses.' + index + ' must be an object');
      validateMemoryString(pass.passerId, 'memory.circulation.recentPasses.' + index + '.passerId');
      validateMemoryString(pass.receiverId, 'memory.circulation.recentPasses.' + index + '.receiverId');
      validateMemoryInteger(pass.tick, 'memory.circulation.recentPasses.' + index + '.tick', 0);
    }
  }

  function validateDefenseMemory(defense) {
    if (!isRecord(defense)) throw new TypeError('memory.defense must be an object');
    if (!['idle', 'reacting', 'committed', 'persisting'].includes(defense.phase)) {
      throw new RangeError('memory.defense.phase is unsupported');
    }
    if (!isRecord(defense.cooldowns)) throw new TypeError('memory.defense.cooldowns must be an object map');
    for (const [playerId, untilTick] of Object.entries(defense.cooldowns)) {
      validateMemoryString(playerId, 'memory.defense cooldown player id');
      validateMemoryInteger(untilTick, 'memory.defense.cooldowns.' + playerId, 0);
    }
    validateMemoryInteger(defense.reactionTicks, 'memory.defense.reactionTicks', 0);
    for (const field of ['carrierId', 'primaryPlayerId', 'coverPlayerId']) {
      if (defense[field] != null) validateMemoryString(defense[field], 'memory.defense.' + field);
    }
    for (const field of ['observedTick', 'eligibleTick', 'commitTick', 'minUntilTick', 'expiresTick']) {
      if (defense[field] != null) validateMemoryInteger(defense[field], 'memory.defense.' + field, 0);
    }
    if (defense.phase === 'idle') return;
    for (const field of ['carrierId', 'primaryPlayerId']) {
      if (defense[field] == null) throw new TypeError('memory.defense.' + field + ' is required while active');
    }
    if (defense.observedTick == null || defense.eligibleTick == null || defense.eligibleTick < defense.observedTick) {
      throw new RangeError('memory defensive reaction lifecycle is inconsistent');
    }
    if (defense.phase === 'reacting') return;
    if (defense.commitTick == null || defense.minUntilTick == null || defense.expiresTick == null ||
        defense.commitTick < defense.eligibleTick || defense.minUntilTick < defense.commitTick ||
        defense.expiresTick < defense.minUntilTick) {
      throw new RangeError('memory defensive commitment lifecycle is inconsistent');
    }
  }

  function validateMemoryMaps(source) {
    for (const name of ['lanes', 'observations', 'commitments']) {
      if (!isRecord(source[name])) throw new TypeError('memory.' + name + ' must be an object map');
    }
    for (const [key, lane] of Object.entries(source.lanes)) {
      if (!isRecord(lane)) throw new TypeError('memory.lanes.' + key + ' must be an object');
      validateMemoryInteger(lane.tick, 'memory.lanes.' + key + '.tick', 0);
      validateMemoryNumber(lane.clearance, 'memory.lanes.' + key + '.clearance', 0);
      validateMemoryNumber(lane.passClearance, 'memory.lanes.' + key + '.passClearance', 0);
      validateMemoryPoint(lane.target, 'memory.lanes.' + key + '.target');
    }
    for (const [key, observation] of Object.entries(source.observations)) {
      if (!isRecord(observation)) throw new TypeError('memory.observations.' + key + ' must be an object');
      for (const field of ['key', 'eventId', 'source', 'reason', 'playerId', 'runType', 'laneKey']) {
        validateMemoryString(observation[field], 'memory.observations.' + key + '.' + field);
      }
      if (observation.key !== key) throw new RangeError('memory observation key must match its map key');
      validateMemoryPoint(observation.target, 'memory.observations.' + key + '.target');
      for (const field of ['openedTick', 'perceivedTick', 'reactionTicks', 'eligibleTick', 'expiresTick']) {
        validateMemoryInteger(observation[field], 'memory.observations.' + key + '.' + field, 0);
      }
      if (observation.openedTick > observation.perceivedTick ||
          observation.eligibleTick < observation.perceivedTick ||
          observation.expiresTick < observation.perceivedTick) {
        throw new RangeError('memory observation tick lifecycle is inconsistent');
      }
      if (observation.previousClearance != null) {
        validateMemoryNumber(observation.previousClearance,
          'memory.observations.' + key + '.previousClearance', 0);
      }
      validateMemoryNumber(observation.clearance, 'memory.observations.' + key + '.clearance', 0);
    }
    for (const [key, commitment] of Object.entries(source.commitments)) {
      if (!isRecord(commitment)) throw new TypeError('memory.commitments.' + key + ' must be an object');
      for (const field of ['playerId', 'runType', 'laneKey', 'state', 'movementIntent', 'urgency']) {
        validateMemoryString(commitment[field], 'memory.commitments.' + key + '.' + field);
      }
      if (commitment.playerId !== key) throw new RangeError('memory commitment playerId must match its map key');
      if (!['committed', 'persisting'].includes(commitment.state)) {
        throw new RangeError('memory commitment state is unsupported');
      }
      if (typeof commitment.accelerate !== 'boolean') {
        throw new TypeError('memory.commitments.' + key + '.accelerate must be boolean');
      }
      validateMemoryInteger(commitment.band, 'memory.commitments.' + key + '.band', 0);
      validateMemoryPoint(commitment.target, 'memory.commitments.' + key + '.target');
      validateMemoryPoint(commitment.continuationTarget, 'memory.commitments.' + key + '.continuationTarget');
      if (!isRecord(commitment.offsideTiming)) {
        throw new TypeError('memory.commitments.' + key + '.offsideTiming must be an object');
      }
      const timing = commitment.offsideTiming;
      validateMemoryString(timing.intent, 'memory.commitments.' + key + '.offsideTiming.intent');
      validateMemoryString(timing.bridgeInstruction,
        'memory.commitments.' + key + '.offsideTiming.bridgeInstruction');
      validateMemoryNumber(timing.onsideGateX,
        'memory.commitments.' + key + '.offsideTiming.onsideGateX', -Infinity);
      validateMemoryNumber(timing.offsideLineX,
        'memory.commitments.' + key + '.offsideTiming.offsideLineX', -Infinity);
      validateMemoryPoint(timing.continuationTarget,
        'memory.commitments.' + key + '.offsideTiming.continuationTarget');
      if (typeof timing.attacksBeyondLine !== 'boolean' || typeof timing.mistimedEarly !== 'boolean') {
        throw new TypeError('memory commitment offside flags must be boolean');
      }
      if (!Number.isInteger(timing.timingOffsetTicks) || timing.timingOffsetTicks > 0) {
        throw new TypeError('memory commitment timingOffsetTicks must be a non-positive integer');
      }
      validateMemoryNumber(timing.mistakeRisk,
        'memory.commitments.' + key + '.offsideTiming.mistakeRisk', 0, 1);
      validateMemoryNumber(timing.deterministicDraw,
        'memory.commitments.' + key + '.offsideTiming.deterministicDraw', 0, 1);
      for (const field of ['score', 'clearance', 'passClearance', 'targetSpeed']) {
        validateMemoryNumber(commitment[field], 'memory.commitments.' + key + '.' + field, 0);
      }
      for (const field of ['offsideAdjustedAtCommit', 'observedOpening']) {
        if (typeof commitment[field] !== 'boolean') {
          throw new TypeError('memory.commitments.' + key + '.' + field + ' must be boolean');
        }
      }
      if (commitment.observationKey != null && typeof commitment.observationKey !== 'string') {
        throw new TypeError('memory commitment observationKey must be null or a string');
      }
      if (commitment.openedTick != null) {
        validateMemoryInteger(commitment.openedTick, 'memory.commitments.' + key + '.openedTick', 0);
      }
      for (const field of ['reactionTicks', 'commitTick', 'minUntilTick', 'expiresTick', 'blockedTicks', 'lastTick']) {
        validateMemoryInteger(commitment[field], 'memory.commitments.' + key + '.' + field, 0);
      }
      if (commitment.minUntilTick < commitment.commitTick ||
          commitment.expiresTick < commitment.minUntilTick ||
          commitment.lastTick < commitment.commitTick) {
        throw new RangeError('memory commitment tick lifecycle is inconsistent');
      }
    }
  }

  function createMemory(initial) {
    if (initial != null && !isRecord(initial)) throw new TypeError('memory must be an object');
    const source = initial || {};
    const fresh = Object.keys(source).length === 0;
    if (!fresh) {
      if (source.schema !== MEMORY_SCHEMA) throw new TypeError('memory.schema must match ' + MEMORY_SCHEMA);
      if (source.teamId != null && (typeof source.teamId !== 'string' || !source.teamId)) {
        throw new TypeError('memory.teamId must be null or a non-empty string');
      }
      validateMemoryInteger(source.lastTick, 'memory.lastTick', -1);
      validateMemoryMaps(source);
      if (source.defense != null) validateDefenseMemory(source.defense);
      if (source.circulation != null) validateCirculationMemory(source.circulation);
      if (source.dribble != null) {
        if (!isRecord(source.dribble)) throw new TypeError('memory.dribble must be an object');
        for (const key of ['untilTick', 'cooldownUntilTick']) validateMemoryInteger(source.dribble[key], 'dribble.' + key, 0);
        if (source.dribble.carrierId != null) validateMemoryString(source.dribble.carrierId, 'dribble.carrierId');
        if (source.dribble.intent != null) {
          if (!['carry', 'take-on', 'protect'].includes(source.dribble.intent.type)) throw new TypeError('invalid dribble intent');
          validateMemoryPoint(source.dribble.intent.target, 'dribble.target');
        }
      }
      if (source.combination != null) {
        const c = source.combination;
        if (!isRecord(c)) throw new TypeError('memory.combination must be an object');
        if (c.lastOwnerId != null) validateMemoryString(c.lastOwnerId, 'combination.lastOwnerId');
        if (c.lastOwnerPoint != null) validateMemoryPoint(c.lastOwnerPoint, 'combination.lastOwnerPoint');
        if (c.move != null) {
          if (!isRecord(c.move)) throw new TypeError('combination.move must be an object');
          for (const key of ['originId', 'linkId']) validateMemoryString(c.move[key], 'combination.' + key);
          validateMemoryPoint(c.move.target, 'combination.target');
          validateMemoryInteger(c.move.expiresTick, 'combination.expiresTick', 0);
          if (c.move.thirdId != null) {
            validateMemoryString(c.move.thirdId, 'combination.thirdId');
            validateMemoryPoint(c.move.thirdTarget, 'combination.thirdTarget');
          }
        }
      }
    }
    const lanes = fresh ? {} : cloneObject(source.lanes);
    const observations = fresh ? {} : cloneObject(source.observations);
    const commitments = fresh ? {} : cloneObject(source.commitments);
    const defense = fresh || source.defense == null
      ? emptyDefenseMemory()
      : cloneObject(source.defense);
    const circulation = fresh || source.circulation == null
      ? emptyCirculationMemory()
      : cloneObject(source.circulation);
    if (!Array.isArray(circulation.recentPasses)) circulation.recentPasses = [];
    return {
      schema: MEMORY_SCHEMA,
      teamId: fresh || source.teamId == null ? null : source.teamId,
      lastTick: fresh ? -1 : source.lastTick,
      lanes,
      observations,
      commitments,
      defense,
      circulation,
      dribble: source.dribble ? cloneObject(source.dribble) : { carrierId: null, intent: null, untilTick: 0, cooldownUntilTick: 0 },
      combination: source.combination ? cloneObject(source.combination) : { lastOwnerId: null, lastOwnerPoint: null, move: null }
    };
  }

  function familyOf(player) {
    if (player.isGK) return 'goalkeeper';
    const label = (player.position + ' ' + player.role + ' ' + player.unitRole).toLowerCase();
    if (/centre.?back|center.?back|\bcb\b/.test(label)) return 'centre-back';
    if (/wing.?back|\blwb\b|\brwb\b/.test(label)) return 'wing-back';
    if (/full.?back|left.?back|right.?back|\blb\b|\brb\b/.test(label)) return 'full-back';
    if (/defensive.?mid|holding|\bcdm\b|\bdm\b/.test(label)) return 'defensive-midfielder';
    if (/attacking.?mid|number.?10|\bcam\b|\bam\b/.test(label)) return 'attacking-midfielder';
    if (/winger|wide.?forward|wide.?mid|\blw\b|\brw\b|\blm\b|\brm\b/.test(label)) return 'winger';
    if (/striker|forward|centre.?forward|center.?forward|\bst\b|\bcf\b/.test(label)) return 'striker';
    return 'midfielder';
  }

  function isHoldDuty(player) {
    return /stay.?back|hold|anchor|cover/.test((player.duty + ' ' + player.unitRole).toLowerCase());
  }

  function isRestDefender(player) {
    const family = familyOf(player);
    return family === 'centre-back' || family === 'full-back' || family === 'wing-back' ||
      family === 'defensive-midfielder' || isHoldDuty(player);
  }

  function allowedRunTypes(player) {
    const family = familyOf(player);
    if (family === 'goalkeeper') return [];
    if (isHoldDuty(player)) return ['support'];
    if (family === 'centre-back') return ['support'];
    if (family === 'full-back' || family === 'wing-back') return ['overlap', 'support'];
    if (family === 'defensive-midfielder') return ['support', 'late-box'];
    if (family === 'midfielder') return ['support', 'late-box', 'underlap'];
    if (family === 'attacking-midfielder') return ['underlap', 'channel', 'support'];
    if (family === 'winger') return ['channel', 'overlap', 'underlap'];
    return ['central', 'channel', 'support'];
  }

  function reactionTicks(player, config) {
    const span = config.maximumReactionTicks - config.minimumReactionTicks;
    const reading = (player.awareness * 0.72 + player.acceleration * 0.28) / 99;
    return clamp(Math.round(config.maximumReactionTicks - reading * span),
      config.minimumReactionTicks, config.maximumReactionTicks);
  }

  function stableUnit(label) {
    const text = String(label || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function activeControlledOutfield(snapshot) {
    return snapshot.players.filter(player => player.teamId === snapshot.teamId && !player.sentOff &&
      player.available && !player.isGK);
  }

  function eligibleCpuOutfield(snapshot) {
    return activeControlledOutfield(snapshot).filter(player => player.cpuControlled);
  }

  function defensiveCarrier(snapshot) {
    if (!snapshot.carrierId || !snapshot.possessionTeamId || snapshot.possessionTeamId === snapshot.teamId) return null;
    const carrier = snapshot.players.find(player => player.id === snapshot.carrierId) || null;
    return carrier && carrier.teamId === snapshot.possessionTeamId && !carrier.sentOff && carrier.available
      ? carrier
      : null;
  }

  function boundedDefensivePoint(raw, snapshot, config) {
    const space = pitchSpace(snapshot.pitch);
    const xInset = space.xFromCanonical(config.pitchInset);
    const yInset = space.yFromCanonical(config.pitchInset);
    return {
      x: rounded(clamp(raw.x, snapshot.pitch.xMin + xInset, snapshot.pitch.xMax - xInset)),
      y: rounded(clamp(raw.y, snapshot.pitch.yMin + yInset, snapshot.pitch.yMax - yInset))
    };
  }

  function defensivePressTarget(carrier, snapshot, config) {
    const seconds = config.defensivePressLeadTicks * snapshot.fixedTickSeconds;
    return boundedDefensivePoint({
      x: carrier.x + carrier.vx * seconds,
      y: carrier.y + carrier.vy * seconds
    }, snapshot, config);
  }

  function defensiveCoverTarget(carrier, cover, snapshot, config) {
    const space = pitchSpace(snapshot.pitch);
    const ownGoal = {
      x: snapshot.attackingDirection > 0 ? snapshot.pitch.xMin : snapshot.pitch.xMax,
      y: (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2
    };
    const dx = space.xToCanonical(ownGoal.x - carrier.x);
    const dy = space.yToCanonical(ownGoal.y - carrier.y);
    const length = Math.hypot(dx, dy) || 1;
    const goalSide = {
      x: carrier.x + space.xFromCanonical(dx / length * config.defensiveCoverDepth),
      y: carrier.y + space.yFromCanonical(dy / length * config.defensiveCoverDepth)
    };
    const anchor = cover ? cover.formationAnchor : goalSide;
    return boundedDefensivePoint({
      x: goalSide.x * 0.78 + anchor.x * 0.22,
      y: goalSide.y * 0.78 + anchor.y * 0.22
    }, snapshot, config);
  }

  function defensiveSelection(snapshot, carrier, config) {
    const players = eligibleCpuOutfield(snapshot);
    const space = pitchSpace(snapshot.pitch);
    const restCount = activeControlledOutfield(snapshot).filter(isRestDefender).length;
    const primaryRows = players.filter(player => !isRestDefender(player) ||
      restCount - 1 >= config.restDefenseMinimum).map(player => {
      const family = familyOf(player);
      const rolePenalty = isRestDefender(player) ? 84 :
        (family === 'striker' || family === 'winger' || family === 'attacking-midfielder' ? -22 : 0);
      const score = distance(player, carrier, space) + rolePenalty - player.awareness * 0.26 -
        player.acceleration * 0.12 - player.defending * 0.08;
      return { player, score };
    }).sort((a, b) => a.score - b.score || a.player.id.localeCompare(b.player.id));
    const primary = primaryRows.length ? primaryRows[0].player : null;
    if (!primary) return { primary: null, cover: null, restCount };
    const coverProbe = defensiveCoverTarget(carrier, null, snapshot, config);
    const coverRows = players.filter(player => player.id !== primary.id).map(player => {
      const protectionBonus = isRestDefender(player) ? -135 : 0;
      const holdBonus = isHoldDuty(player) ? -42 : 0;
      return {
        player,
        score: distance(player, coverProbe, space) + protectionBonus + holdBonus - player.awareness * 0.18
      };
    }).sort((a, b) => a.score - b.score || a.player.id.localeCompare(b.player.id));
    return { primary, cover: coverRows.length ? coverRows[0].player : null, restCount };
  }

  function resetDefensiveCommitment(memory) {
    memory.defense = emptyDefenseMemory(memory.defense && memory.defense.cooldowns);
  }

  function pruneDefensiveCooldowns(memory, tick) {
    const source = memory.defense && memory.defense.cooldowns || {};
    memory.defense.cooldowns = Object.fromEntries(Object.entries(source)
      .filter(([, untilTick]) => untilTick > tick)
      .sort((a, b) => a[0].localeCompare(b[0])));
  }

  function observeDefensiveCarrier(memory, snapshot, carrier, selection, config, telemetry) {
    const delay = reactionTicks(selection.primary, config);
    memory.defense = {
      phase: 'reacting',
      carrierId: carrier.id,
      observedTick: snapshot.tick,
      eligibleTick: snapshot.tick + delay,
      reactionTicks: delay,
      primaryPlayerId: selection.primary.id,
      coverPlayerId: selection.cover ? selection.cover.id : null,
      commitTick: null,
      minUntilTick: null,
      expiresTick: null,
      cooldowns: cloneObject(memory.defense.cooldowns)
    };
    telemetry.transitions.push({
      type: 'defense-observed', tick: snapshot.tick, carrierId: carrier.id,
      primaryPlayerId: selection.primary.id,
      coverPlayerId: selection.cover ? selection.cover.id : null,
      reactionTicks: delay, eligibleTick: snapshot.tick + delay
    });
  }

  function canonicalVelocity(player, space) {
    return { x: space.xToCanonical(player.vx), y: space.yToCanonical(player.vy) };
  }

  function physicalActionFor(primary, carrier, snapshot, memory, config) {
    const cooldownUntil = memory.defense.cooldowns[primary.id];
    if (Number.isInteger(cooldownUntil) && snapshot.tick < cooldownUntil) return null;
    const space = pitchSpace(snapshot.pitch);
    const dx = space.xToCanonical(carrier.x - primary.x);
    const dy = space.yToCanonical(carrier.y - primary.y);
    const contactDistance = Math.hypot(dx, dy);
    if (!(contactDistance > 1e-9)) return null;
    const toward = { x: dx / contactDistance, y: dy / contactDistance };
    const velocity = canonicalVelocity(primary, space);
    const carrierVelocity = canonicalVelocity(carrier, space);
    let facing = { x: primary.fx, y: primary.fy };
    let facingLength = Math.hypot(facing.x, facing.y);
    if (facingLength <= 1e-9) {
      facing = { ...velocity };
      facingLength = Math.hypot(facing.x, facing.y);
    }
    if (facingLength <= 1e-9) {
      facing = { ...toward };
      facingLength = 1;
    }
    const alignment = clamp((facing.x / facingLength) * toward.x + (facing.y / facingLength) * toward.y, -1, 1);
    const relativeClosingSpeed = (velocity.x - carrierVelocity.x) * toward.x +
      (velocity.y - carrierVelocity.y) * toward.y;
    const safeRelativeSpeed = Math.abs(relativeClosingSpeed) <= config.defensiveMaximumActionRelativeSpeed;
    const ownGoalX = snapshot.attackingDirection > 0 ? snapshot.pitch.xMin : snapshot.pitch.xMax;
    const carrierOwnGoalDepth = space.xToCanonical(Math.abs(carrier.x - ownGoalX));
    const ballGap = distance(carrier, snapshot.ball, space);
    const ballDistance = distance(primary, snapshot.ball, space);
    // An exposed ball on the far side of the carrier is still screened by
    // his body. Jockey around it instead of lunging through his legs.
    if (ballGap > 12 && ballDistance >= contactDistance - 4) return null;
    // Inside boot reach a defender can poke; otherwise delay until the ball
    // leaves the carrier's feet. Ratings change timing, never availability.
    if (ballGap < 18 + primary.defending / 99 * 8 && contactDistance > 30) return null;
    const slideEligible = safeRelativeSpeed &&
      contactDistance >= config.defensiveSlideTackleMinDistance &&
      contactDistance <= config.defensiveSlideTackleMaxDistance &&
      alignment >= config.defensiveSlideMinimumAlignment &&
      carrierOwnGoalDepth <= config.defensiveSlideDangerDepth;
    const shoulderEligible = safeRelativeSpeed && contactDistance <= config.defensiveShoulderMaxDistance &&
      contactDistance >= 4 && alignment >= config.defensiveMinimumActionAlignment * 0.5 && alignment < 0.82 &&
      ballGap > 20;
    const tackleEligible = safeRelativeSpeed &&
      contactDistance >= config.defensiveStandTackleMinDistance &&
      contactDistance <= config.defensiveStandTackleMaxDistance &&
      alignment >= config.defensiveMinimumActionAlignment;
    // Sliding is a committed recovery tool, never the default close-range
    // challenge. It is available only beyond standing reach and close enough
    // to the defender's own goal for the recovery risk to have a football
    // reason. This mirrors FLAME's retained action/risk split without copying
    // its Godot implementation into the browser simulation.
    const type = slideEligible ? 'slide-tackle' : shoulderEligible ? 'shoulder-challenge' : tackleEligible ? 'stand-tackle' : null;
    if (!type) return null;
    const nextCooldown = snapshot.tick + Math.round(config.defensiveActionCooldownTicks * (1.3 - primary.defending / 198));
    memory.defense.cooldowns[primary.id] = nextCooldown;
    return {
      type,
      targetPlayerId: carrier.id,
      issuedTick: snapshot.tick,
      distance: rounded(contactDistance),
      alignment: rounded(alignment, 6),
      relativeClosingSpeed: rounded(relativeClosingSpeed),
      ownGoalDepth: rounded(carrierOwnGoalDepth),
      cooldownUntilTick: nextCooldown
    };
  }

  function buildDefensiveIntents(snapshot, memory, config, telemetry) {
    pruneDefensiveCooldowns(memory, snapshot.tick);
    const previous = cloneObject(memory.defense);
    const carrier = defensiveCarrier(snapshot);
    if (!carrier) {
      if (memory.defense.phase !== 'idle') {
        telemetry.transitions.push({
          type: 'defense-aborted', tick: snapshot.tick,
          carrierId: memory.defense.carrierId,
          reason: snapshot.possessionTeamId === snapshot.teamId ? 'possession-won' : 'carrier-unavailable'
        });
      }
      resetDefensiveCommitment(memory);
      telemetry.defense = {
        state: snapshot.possessionTeamId === snapshot.teamId ? 'in-possession' : 'no-opponent-carrier',
        carrierId: null, primaryPlayerId: null, coverPlayerId: null,
        reactionTicksRemaining: 0, intents: []
      };
      return [];
    }

    const playersById = Object.fromEntries(snapshot.players.map(player => [player.id, player]));
    const storedPrimary = playersById[memory.defense.primaryPlayerId];
    const controlled = activeControlledOutfield(snapshot);
    const currentRestCount = controlled.filter(isRestDefender).length;
    const storedPrimarySafe = storedPrimary && storedPrimary.teamId === snapshot.teamId &&
      !storedPrimary.isGK && storedPrimary.available && !storedPrimary.sentOff && storedPrimary.cpuControlled &&
      (!isRestDefender(storedPrimary) || currentRestCount - 1 >= config.restDefenseMinimum);
    const carrierChanged = memory.defense.carrierId !== carrier.id;
    const expired = ['committed', 'persisting'].includes(memory.defense.phase) &&
      snapshot.tick >= memory.defense.expiresTick;
    if (memory.defense.phase === 'idle' || carrierChanged || expired || !storedPrimarySafe) {
      if (memory.defense.phase !== 'idle') {
        telemetry.transitions.push({
          type: 'defense-aborted', tick: snapshot.tick,
          carrierId: memory.defense.carrierId,
          reason: carrierChanged ? 'carrier-changed' : expired ? 'commitment-expired' : 'challenger-unavailable'
        });
      }
      const selection = defensiveSelection(snapshot, carrier, config);
      if (!selection.primary) {
        resetDefensiveCommitment(memory);
        telemetry.defense = {
          state: 'rest-defense-protected', carrierId: carrier.id,
          primaryPlayerId: null, coverPlayerId: null,
          reactionTicksRemaining: 0, intents: []
        };
        return [];
      }
      observeDefensiveCarrier(memory, snapshot, carrier, selection, config, telemetry);
    }

    if (memory.defense.phase === 'reacting' && snapshot.tick < memory.defense.eligibleTick) {
      telemetry.defense = {
        state: 'reacting', carrierId: carrier.id,
        primaryPlayerId: memory.defense.primaryPlayerId,
        coverPlayerId: memory.defense.coverPlayerId,
        reactionTicksRemaining: memory.defense.eligibleTick - snapshot.tick,
        intents: []
      };
      return [];
    }

    if (memory.defense.phase === 'reacting') {
      memory.defense.phase = 'committed';
      memory.defense.commitTick = snapshot.tick;
      memory.defense.minUntilTick = snapshot.tick + config.minimumCommitTicks;
      memory.defense.expiresTick = snapshot.tick + config.maximumCommitTicks;
      telemetry.transitions.push({
        type: 'defense-committed', tick: snapshot.tick, carrierId: carrier.id,
        primaryPlayerId: memory.defense.primaryPlayerId,
        coverPlayerId: memory.defense.coverPlayerId,
        minUntilTick: memory.defense.minUntilTick,
        expiresTick: memory.defense.expiresTick
      });
    } else {
      memory.defense.phase = 'persisting';
    }

    const primary = playersById[memory.defense.primaryPlayerId];
    let cover = playersById[memory.defense.coverPlayerId] || null;
    if (!cover || cover.teamId !== snapshot.teamId || cover.sentOff || !cover.available || cover.isGK || !cover.cpuControlled ||
        cover.id === primary.id) {
      const replacement = defensiveSelection(snapshot, carrier, config);
      cover = replacement.cover && replacement.cover.id !== primary.id ? replacement.cover : null;
      memory.defense.coverPlayerId = cover ? cover.id : null;
    }
    const state = memory.defense.phase;
    const ballGap = distance(carrier, snapshot.ball, pitchSpace(snapshot.pitch));
    const exposed = ballGap > 25;
    const close = distance(primary, carrier, pitchSpace(snapshot.pitch)) < 155;
    const pressTarget = close && !exposed ? (() => {
      const space = pitchSpace(snapshot.pitch), ownDir = snapshot.attackingDirection;
      return boundedDefensivePoint({ x: carrier.x - ownDir * space.xFromCanonical(60),
        y: carrier.y + carrier.vy * .12 }, snapshot, config);
    })() : exposed ? boundedDefensivePoint(snapshot.ball, snapshot, config) : defensivePressTarget(carrier, snapshot, config);
    const physicalAction = physicalActionFor(primary, carrier, snapshot, memory, config);
    const intents = [{
      playerId: primary.id,
      type: 'press',
      role: 'primary-challenger',
      targetPlayerId: carrier.id,
      target: pressTarget,
      movementIntent: close && !exposed ? 'jockey' : 'beeline',
      accelerate: !close || exposed,
      urgency: close && !exposed ? 'balanced' : 'sprint',
      targetSpeed: close && !exposed ? .5 : rounded(0.82 + primary.pace / 99 * 0.18),
      state,
      commitTick: memory.defense.commitTick,
      minUntilTick: memory.defense.minUntilTick,
      expiresTick: memory.defense.expiresTick,
      physicalAction
    }];
    if (cover) {
      intents.push({
        playerId: cover.id,
        type: 'cover',
        role: 'cover-support',
        targetPlayerId: carrier.id,
        target: defensiveCoverTarget(carrier, cover, snapshot, config),
        movementIntent: 'contain',
        accelerate: false,
        urgency: 'balanced',
        targetSpeed: rounded(0.52 + cover.awareness / 99 * 0.18),
        state,
        commitTick: memory.defense.commitTick,
        minUntilTick: memory.defense.minUntilTick,
        expiresTick: memory.defense.expiresTick,
        physicalAction: null
      });
    }
    intents.sort((a, b) => (a.type === 'press' ? -1 : 1) - (b.type === 'press' ? -1 : 1) ||
      a.playerId.localeCompare(b.playerId));
    telemetry.defense = {
      state,
      carrierId: carrier.id,
      primaryPlayerId: primary.id,
      coverPlayerId: cover ? cover.id : null,
      reactionTicksRemaining: 0,
      previousState: previous.phase,
      intents: cloneObject(intents)
    };
    telemetry.transitions.push({
      type: state === 'committed' ? 'defense-issued' : 'defense-persisted',
      tick: snapshot.tick, carrierId: carrier.id,
      primaryPlayerId: primary.id, coverPlayerId: cover ? cover.id : null,
      physicalAction: cloneObject(physicalAction)
    });
    return intents;
  }

  function safeOnsideX(rawX, snapshot, config) {
    const direction = snapshot.attackingDirection;
    const boundary = snapshot.offsideLine - direction * pitchSpace(snapshot.pitch).xFromCanonical(config.offsideBuffer);
    return direction > 0 ? Math.min(rawX, boundary) : Math.max(rawX, boundary);
  }

  function explicitOpeningFor(snapshot, player, runType) {
    return snapshot.events.find(event => event.type === 'space-opened' &&
      (!event.teamId || event.teamId === snapshot.teamId) &&
      (!event.playerId || event.playerId === player.id) &&
      (!event.runType || event.runType === runType)) || null;
  }

  function targetForRun(snapshot, player, runType, config) {
    const pitch = snapshot.pitch;
    const space = pitchSpace(pitch);
    const direction = snapshot.attackingDirection;
    const width = pitch.yMax - pitch.yMin;
    const middleY = (pitch.yMin + pitch.yMax) / 2;
    const upperSide = player.formationAnchor.y <= middleY ? -1 : 1;
    const paceStep = 250 + player.pace * 2.65;
    const forwardStep = runType === 'support' ? 125 : runType === 'late-box' ? 285 : paceStep;
    let target = { x: player.x + direction * space.xFromCanonical(forwardStep), y: player.y };
    if (runType === 'overlap') {
      target.y = upperSide < 0 ? pitch.yMin + width * 0.075 : pitch.yMax - width * 0.075;
    } else if (runType === 'underlap') {
      target.y = player.y + (middleY - player.y) * 0.52;
    } else if (runType === 'channel') {
      target.y = player.y + (middleY - player.y) * 0.22;
    } else if (runType === 'central' || runType === 'late-box') {
      target.y = player.y + (middleY - player.y) * 0.68;
    } else if (runType === 'support') {
      target.y = player.formationAnchor.y + (snapshot.ball.y - player.formationAnchor.y) * 0.24;
    }
    const event = explicitOpeningFor(snapshot, player, runType);
    if (event && event.target) target = { ...event.target };
    const family = familyOf(player);
    const forwardLimit = FORWARD_LIMIT_BY_FAMILY[family] == null ? 560 : FORWARD_LIMIT_BY_FAMILY[family];
    const scaledForwardLimit = space.xFromCanonical(forwardLimit);
    const anchorDelta = direction * (target.x - player.formationAnchor.x);
    const formationAdjusted = anchorDelta > scaledForwardLimit;
    if (formationAdjusted) target.x = player.formationAnchor.x + direction * scaledForwardLimit;
    const rawTargetX = target.x;
    const xInset = space.xFromCanonical(config.pitchInset);
    const yInset = space.yFromCanonical(config.pitchInset);
    const continuationTarget = {
      x: clamp(target.x, pitch.xMin + xInset, pitch.xMax - xInset),
      y: clamp(target.y, pitch.yMin + yInset, pitch.yMax - yInset)
    };
    target.x = safeOnsideX(target.x, snapshot, config);
    target.x = clamp(target.x, pitch.xMin + xInset, pitch.xMax - xInset);
    target.y = clamp(target.y, pitch.yMin + yInset, pitch.yMax - yInset);
    return {
      target,
      event,
      continuationTarget,
      formationAdjusted,
      offsideAdjusted: Math.abs(target.x - rawTargetX) > 1e-9
    };
  }

  function laneClearance(start, end, opponents, space) {
    if (!opponents.length) return 999;
    return Math.min(...opponents.map(opponent => distanceToSegment(opponent, start, end, space)));
  }

  function laneBand(target, snapshot, config) {
    const space = pitchSpace(snapshot.pitch);
    return Math.floor(space.yToCanonical(target.y - snapshot.pitch.yMin) / config.laneConflictWidth);
  }

  function measureCandidate(snapshot, player, runType, config) {
    const space = pitchSpace(snapshot.pitch);
    const targetData = targetForRun(snapshot, player, runType, config);
    const target = targetData.target;
    const opponents = snapshot.players.filter(candidate => candidate.teamId !== snapshot.teamId &&
      !candidate.sentOff && candidate.available);
    const carrier = snapshot.players.find(candidate => candidate.id === snapshot.carrierId) || null;
    const clearance = laneClearance(player, target, opponents, space);
    const passClearance = carrier ? laneClearance(carrier, target, opponents, space) : 0;
    const forwardGain = space.xToCanonical(snapshot.attackingDirection * (target.x - player.x));
    const currentOffside = snapshot.attackingDirection * (player.x - snapshot.offsideLine) >
      -space.xFromCanonical(config.offsideBuffer * 0.25);
    const roleBonus = runType === 'channel' ? 15 : runType === 'overlap' ? 10 :
      runType === 'underlap' ? 12 : runType === 'central' ? 14 : runType === 'late-box' ? 8 : 2;
    const score = clamp(forwardGain / 6, -40, 68) + clamp(clearance / 7.5, 0, 38) +
      clamp(passClearance / 12, 0, 22) + player.pace * 0.18 + player.awareness * 0.13 + roleBonus +
      (targetData.event ? 54 : 0) - (player.stamina < 30 ? 18 : 0);
    const constraintReasons = [];
    if (currentOffside) constraintReasons.push('already-offside');
    if (forwardGain < (runType === 'support' ? 20 : config.minimumForwardRun)) constraintReasons.push('insufficient-forward-gain');
    if (PENETRATING_RUNS.has(runType) && clearance < config.minimumLaneClearance) constraintReasons.push('lane-blocked');
    if (PENETRATING_RUNS.has(runType) && passClearance < config.minimumPassLaneClearance) constraintReasons.push('pass-lane-blocked');
    if (isHoldDuty(player) && PENETRATING_RUNS.has(runType)) constraintReasons.push('role-hold-duty');
    return {
      playerId: player.id,
      family: familyOf(player),
      runType,
      laneKey: player.id + ':' + runType,
      band: laneBand(target, snapshot, config),
      target,
      continuationTarget: { ...targetData.continuationTarget },
      forwardGain,
      clearance,
      passClearance,
      score,
      event: targetData.event,
      formationAdjusted: targetData.formationAdjusted,
      offsideAdjusted: targetData.offsideAdjusted,
      constraintReasons
    };
  }

  function buildCandidates(snapshot, config) {
    const candidates = [];
    if (snapshot.possessionTeamId !== snapshot.teamId || !snapshot.carrierId) return candidates;
    for (const player of snapshot.players) {
      if (player.teamId !== snapshot.teamId || player.id === snapshot.carrierId || player.sentOff ||
        !player.available || player.isGK) continue;
      for (const runType of allowedRunTypes(player)) candidates.push(measureCandidate(snapshot, player, runType, config));
    }
    return candidates.sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId) ||
      a.runType.localeCompare(b.runType));
  }

  function observationKey(candidate, openedTick) {
    return candidate.laneKey + ':' + openedTick;
  }

  function newestObservation(memory, candidate, tick) {
    return Object.values(memory.observations)
      .filter(observation => observation.playerId === candidate.playerId &&
        observation.runType === candidate.runType && observation.expiresTick >= tick)
      .sort((a, b) => b.openedTick - a.openedTick || a.key.localeCompare(b.key))[0] || null;
  }

  function perceiveOpenings(snapshot, memory, candidates, playersById, config, telemetry) {
    for (const key of Object.keys(memory.observations)) {
      if (memory.observations[key].expiresTick < snapshot.tick) delete memory.observations[key];
    }
    for (const candidate of candidates) {
      const previous = memory.lanes[candidate.laneKey] || null;
      const explicit = candidate.event;
      const derived = previous && previous.clearance < config.openedLaneClearance &&
        candidate.clearance >= config.openedLaneClearance &&
        candidate.clearance - previous.clearance >= config.newlyOpenedDelta;
      if (!explicit && !derived) continue;
      const openedTick = explicit ? explicit.tick : snapshot.tick;
      const key = observationKey(candidate, openedTick);
      if (memory.observations[key]) continue;
      const player = playersById[candidate.playerId];
      const delay = reactionTicks(player, config);
      const observation = {
        key,
        eventId: explicit ? explicit.id : 'derived:' + key,
        source: explicit ? 'event' : 'clearance-transition',
        reason: explicit ? explicit.reason : 'lane-clearance-crossed-threshold',
        playerId: candidate.playerId,
        runType: candidate.runType,
        laneKey: candidate.laneKey,
        target: { ...candidate.target },
        openedTick,
        perceivedTick: snapshot.tick,
        reactionTicks: delay,
        eligibleTick: snapshot.tick + delay,
        expiresTick: snapshot.tick + config.openingMemoryTicks,
        previousClearance: previous ? rounded(previous.clearance) : null,
        clearance: rounded(candidate.clearance)
      };
      memory.observations[key] = observation;
      telemetry.perception.push({ type: 'space-opened-perceived', ...cloneObject(observation) });
    }
    for (const candidate of candidates) {
      memory.lanes[candidate.laneKey] = {
        tick: snapshot.tick,
        clearance: rounded(candidate.clearance),
        passClearance: rounded(candidate.passClearance),
        target: { ...candidate.target }
      };
    }
  }

  function candidateForCommitment(candidates, commitment) {
    return candidates.find(candidate => candidate.playerId === commitment.playerId &&
      candidate.runType === commitment.runType) || null;
  }

  function currentOffside(player, snapshot, config) {
    return snapshot.attackingDirection * (player.x - snapshot.offsideLine) >
      -pitchSpace(snapshot.pitch).xFromCanonical(config.offsideBuffer * 0.25);
  }

  function persistCommitments(snapshot, memory, candidates, playersById, config, telemetry) {
    const space = pitchSpace(snapshot.pitch);
    const xInset = space.xFromCanonical(config.pitchInset);
    const yInset = space.yFromCanonical(config.pitchInset);
    const active = [];
    for (const playerId of Object.keys(memory.commitments).sort()) {
      const prior = memory.commitments[playerId];
      const player = playersById[playerId];
      const candidate = candidateForCommitment(candidates, prior);
      let abortReason = null;
      if (snapshot.possessionTeamId !== snapshot.teamId || (!snapshot.carrierId && !snapshot.inFlight)) abortReason = 'possession-lost';
      else if (snapshot.carrierId === playerId) abortReason = 'runner-received';
      else if (!player || player.sentOff || !player.available) abortReason = 'runner-unavailable';
      else if (currentOffside(player, snapshot, config)) abortReason = 'runner-offside';
      else if (snapshot.tick >= prior.expiresTick) abortReason = 'commitment-expired';
      let blockedTicks = prior.blockedTicks || 0;
      if (!abortReason && candidate && candidate.clearance < config.severeBlockClearance) blockedTicks += 1;
      else if (!abortReason) blockedTicks = 0;
      if (!abortReason && snapshot.tick >= prior.minUntilTick && blockedTicks >= config.abortBlockedTicks) {
        abortReason = 'lane-sealed';
      }
      if (abortReason) {
        telemetry.transitions.push({
          type: 'run-aborted', playerId, runType: prior.runType, tick: snapshot.tick,
          reason: abortReason, ageTicks: snapshot.tick - prior.commitTick
        });
        delete memory.commitments[playerId];
        continue;
      }
      const next = {
        ...cloneObject(prior),
        state: 'persisting',
        blockedTicks,
        lastTick: snapshot.tick
      };
      // A commitment may persist, but its destination cannot preserve an old
      // offside boundary after the defensive line moves. Re-clamp every tick
      // while leaving the run lifecycle and minimum persistence intact.
      const priorTargetX = next.target.x;
      next.target.x = safeOnsideX(next.target.x, snapshot, config);
      next.target.x = clamp(next.target.x,
        snapshot.pitch.xMin + xInset,
        snapshot.pitch.xMax - xInset);
      next.target.y = clamp(next.target.y,
        snapshot.pitch.yMin + yInset,
        snapshot.pitch.yMax - yInset);
      const offsideAdjusted = Math.abs(next.target.x - priorTargetX) > 1e-9;
      if (next.offsideTiming) {
        next.offsideTiming.onsideGateX = rounded(safeOnsideX(
          snapshot.attackingDirection > 0 ? snapshot.pitch.xMax : snapshot.pitch.xMin,
          snapshot,
          config
        ));
        next.offsideTiming.offsideLineX = rounded(snapshot.offsideLine);
      }
      memory.commitments[playerId] = next;
      active.push(next);
      telemetry.transitions.push({
        type: 'run-persisted', playerId, runType: next.runType, tick: snapshot.tick,
        minUntilTick: next.minUntilTick, blockedTicks,
        target: { ...next.target }, offsideAdjusted,
        offsideTiming: cloneObject(next.offsideTiming || null)
      });
    }
    return active;
  }

  function restDefenseAvailable(snapshot) {
    return snapshot.players.filter(player => player.teamId === snapshot.teamId && !player.sentOff &&
      player.available && !player.isGK && isRestDefender(player)).length;
  }

  function makeRun(candidate, player, observation, snapshot, config) {
    const space = pitchSpace(snapshot.pitch);
    const xInset = space.xFromCanonical(config.pitchInset);
    const yInset = space.yFromCanonical(config.pitchInset);
    const rememberedTarget = observation && observation.target ? observation.target : candidate.target;
    const target = { ...rememberedTarget };
    const rawTargetX = target.x;
    // Perception is deliberately delayed, but constraints are not. A channel
    // remembered before the reaction window must be revalidated against the
    // current defensive line and pitch at the exact commit tick.
    target.x = safeOnsideX(target.x, snapshot, config);
    target.x = clamp(target.x,
      snapshot.pitch.xMin + xInset,
      snapshot.pitch.xMax - xInset);
    target.y = clamp(target.y,
      snapshot.pitch.yMin + yInset,
      snapshot.pitch.yMax - yInset);
    const offsideAdjustedAtCommit = Math.abs(target.x - rawTargetX) > 1e-9;
    const continuationTarget = observation && observation.target ? {
      x: clamp(observation.target.x, snapshot.pitch.xMin + xInset,
        snapshot.pitch.xMax - xInset),
      y: clamp(observation.target.y, snapshot.pitch.yMin + yInset,
        snapshot.pitch.yMax - yInset)
    } : { ...candidate.continuationTarget };
    const onsideGateX = safeOnsideX(
      snapshot.attackingDirection > 0 ? snapshot.pitch.xMax : snapshot.pitch.xMin,
      snapshot,
      config
    );
    const attacksBeyondLine = PENETRATING_RUNS.has(candidate.runType) &&
      snapshot.attackingDirection * (continuationTarget.x - onsideGateX) > 1e-9;
    const mistakeRisk = attacksBeyondLine ? clamp(
      config.offsideMistakeBaseRisk - player.awareness / 99 * config.offsideMistakeAwarenessRelief +
        player.pace / 99 * config.offsideMistakePaceRisk,
      0,
      1
    ) : 0;
    const timingKey = [snapshot.teamId, snapshot.carrierId, player.id, candidate.runType,
      observation ? observation.openedTick : snapshot.tick].join(':');
    const timingDraw = stableUnit(timingKey);
    const mistimedEarly = attacksBeyondLine && config.offsideMistakeMaxEarlyTicks > 0 && timingDraw < mistakeRisk;
    const earlyDraw = stableUnit(timingKey + ':early-ticks');
    const timingOffsetTicks = mistimedEarly
      ? -Math.max(1, Math.ceil(earlyDraw * config.offsideMistakeMaxEarlyTicks))
      : 0;
    const offsideTiming = {
      intent: attacksBeyondLine ? 'break-on-pass' : 'remain-onside',
      onsideGateX: rounded(onsideGateX),
      offsideLineX: rounded(snapshot.offsideLine),
      continuationTarget: { ...continuationTarget },
      attacksBeyondLine,
      mistimedEarly,
      timingOffsetTicks,
      mistakeRisk: rounded(mistakeRisk, 6),
      deterministicDraw: rounded(timingDraw, 6),
      bridgeInstruction: attacksBeyondLine
        ? (mistimedEarly ? 'release-before-carrier-kick' : 'release-on-carrier-kick')
        : 'hold-onside-gate'
    };
    const openingBonus = observation ? 28 + (observation.source === 'event' ? 24 : 0) : 0;
    return {
      playerId: candidate.playerId,
      runType: candidate.runType,
      laneKey: candidate.laneKey,
      band: candidate.band,
      state: 'committed',
      movementIntent: 'beeline',
      accelerate: true,
      urgency: 'sprint',
      target: { ...target },
      continuationTarget: { ...continuationTarget },
      offsideTiming,
      offsideAdjustedAtCommit,
      score: rounded(candidate.score + openingBonus),
      clearance: rounded(candidate.clearance),
      passClearance: rounded(candidate.passClearance),
      observedOpening: Boolean(observation),
      observationKey: observation ? observation.key : null,
      openedTick: observation ? observation.openedTick : null,
      reactionTicks: observation ? observation.reactionTicks : 0,
      commitTick: snapshot.tick,
      minUntilTick: snapshot.tick + config.minimumCommitTicks,
      expiresTick: snapshot.tick + config.maximumCommitTicks,
      blockedTicks: 0,
      lastTick: snapshot.tick,
      targetSpeed: rounded(0.72 + player.pace / 99 * 0.28)
    };
  }

  function selectNewRuns(snapshot, memory, candidates, playersById, active, config, telemetry) {
    const selected = [...active];
    const occupiedPlayers = new Set(active.map(run => run.playerId));
    const occupiedBands = new Set(active.map(run => run.band));
    const restAvailable = restDefenseAvailable(snapshot);
    let restReleased = active.filter(run => isRestDefender(playersById[run.playerId]) &&
      PENETRATING_RUNS.has(run.runType)).length;
    const ordered = candidates.map(candidate => {
      const observation = newestObservation(memory, candidate, snapshot.tick);
      const openingBonus = observation ? 28 + (observation.source === 'event' ? 24 : 0) : 0;
      return { candidate, observation, openingBonus, effectiveScore: candidate.score + openingBonus };
    }).sort((a, b) => b.effectiveScore - a.effectiveScore ||
      a.candidate.playerId.localeCompare(b.candidate.playerId) ||
      a.candidate.runType.localeCompare(b.candidate.runType));
    for (const row of ordered) {
      const { candidate, observation, openingBonus } = row;
      const bid = {
        playerId: candidate.playerId,
        runType: candidate.runType,
        laneKey: candidate.laneKey,
        band: candidate.band,
        target: { ...candidate.target },
        continuationTarget: { ...candidate.continuationTarget },
        score: rounded(candidate.score + openingBonus),
        clearance: rounded(candidate.clearance),
        passClearance: rounded(candidate.passClearance),
        openingState: observation ? (snapshot.tick >= observation.eligibleTick ? 'eligible' : 'reacting') : 'routine',
        eligibleTick: observation ? observation.eligibleTick : snapshot.tick,
        formationAdjusted: candidate.formationAdjusted,
        offsideAdjusted: candidate.offsideAdjusted,
        accepted: false,
        rejectionReasons: [...candidate.constraintReasons]
      };
      if (selected.length >= config.maximumCommittedRuns) bid.rejectionReasons.push('team-run-capacity');
      if (occupiedPlayers.has(candidate.playerId)) bid.rejectionReasons.push('runner-already-committed');
      if (occupiedBands.has(candidate.band) && PENETRATING_RUNS.has(candidate.runType)) bid.rejectionReasons.push('lane-coordination-conflict');
      if (observation && snapshot.tick < observation.eligibleTick) bid.rejectionReasons.push('reaction-window');
      if (bid.score < config.minimumBidScore) bid.rejectionReasons.push('bid-below-threshold');
      const player = playersById[candidate.playerId];
      const releasesRestDefender = isRestDefender(player) && PENETRATING_RUNS.has(candidate.runType);
      if (releasesRestDefender && restAvailable - (restReleased + 1) < config.restDefenseMinimum) {
        bid.rejectionReasons.push('rest-defense-minimum');
      }
      bid.rejectionReasons = [...new Set(bid.rejectionReasons)].sort();
      if (!bid.rejectionReasons.length) {
        const run = makeRun(candidate, player, observation, snapshot, config);
        selected.push(run);
        memory.commitments[run.playerId] = cloneObject(run);
        occupiedPlayers.add(run.playerId);
        occupiedBands.add(run.band);
        if (releasesRestDefender) restReleased += 1;
        bid.accepted = true;
        telemetry.transitions.push({
          type: 'run-committed', playerId: run.playerId, runType: run.runType, tick: snapshot.tick,
          target: { ...run.target }, score: run.score, reactionTicks: run.reactionTicks,
          continuationTarget: { ...run.continuationTarget }, offsideTiming: cloneObject(run.offsideTiming),
          movementIntent: run.movementIntent, accelerate: run.accelerate
        });
      }
      telemetry.bids.push(bid);
    }
    return selected.sort((a, b) => a.playerId.localeCompare(b.playerId));
  }

  function nearestOpponentClearance(start, end, snapshot) {
    const opponents = snapshot.players.filter(player => player.teamId !== snapshot.teamId &&
      !player.sentOff && player.available);
    return laneClearance(start, end, opponents, pitchSpace(snapshot.pitch));
  }

  function midfieldSupportIntents(snapshot, config) {
    if (snapshot.possessionTeamId !== snapshot.teamId) return [];
    const referenceId = snapshot.carrierId || (snapshot.inFlight && snapshot.intendedReceiverId);
    const carrier = snapshot.players.find(player => player.id === referenceId);
    if (!carrier || carrier.isGK || carrier.sentOff || !carrier.available || carrier.teamId !== snapshot.teamId) return [];
    const space = pitchSpace(snapshot.pitch), direction = snapshot.attackingDirection;
    const midfield = eligibleCpuOutfield(snapshot).filter(player => player.id !== referenceId &&
      (['defensive-midfielder', 'midfielder', 'attacking-midfielder'].includes(familyOf(player)) ||
        /wide.?mid|\blm\b|\brm\b/i.test(player.position + ' ' + player.role)))
      .sort((a, b) => distance(a.formationAnchor, carrier, space) - distance(b.formationAnchor, carrier, space) ||
        a.id.localeCompare(b.id)).slice(0, 2)
      .sort((a, b) => direction * (a.formationAnchor.x - b.formationAnchor.x) ||
        a.formationAnchor.y - b.formationAnchor.y || a.id.localeCompare(b.id));
    return midfield.map((player, index) => {
      // Keep a return outlet and a forward link rather than bidding every
      // midfielder into the same forward-running pool. The formation still
      // limits how far either job can travel from the connected block.
      const behind = index === 0 || isHoldDuty(player) || familyOf(player) === 'defensive-midfielder';
      const side = player.formationAnchor.y <= carrier.y ? -1 : 1;
      const longitudinal = behind ? -180 : 180;
      const anchorReach = space.xFromCanonical(420);
      const x = clamp(carrier.x + direction * space.xFromCanonical(longitudinal),
        player.formationAnchor.x - anchorReach, player.formationAnchor.x + anchorReach);
      const candidates = [side * 250, -side * 250, side * 360].map(lateral => {
        const target = boundedDefensivePoint({ x: safeOnsideX(x, snapshot, config),
          y: carrier.y + space.yFromCanonical(lateral) }, snapshot, config);
        const clearance = nearestOpponentClearance(carrier, target, snapshot);
        const receiverSpace = nearestOpponentClearance(target, target, snapshot);
        const shapeCost = distance(target, player.formationAnchor, space);
        return { target, score: Math.min(clearance, 150) + Math.min(receiverSpace, 180) * .5 - shapeCost * .12 };
      }).sort((a, b) => b.score - a.score);
      return { playerId: player.id, type: behind ? 'return-outlet' : 'forward-link',
        referencePlayerId: carrier.id, target: candidates[0].target };
    });
  }

  function shortSupportOptions(snapshot, carrier, config) {
    const space = pitchSpace(snapshot.pitch);
    const opponents = snapshot.players.filter(player => player.teamId !== snapshot.teamId &&
      !player.sentOff && player.available);
    const xInset = space.xFromCanonical(config.pitchInset);
    const yInset = space.yFromCanonical(config.pitchInset);
    const minimumDistance = 105;
    const maximumDistance = 780;
    const maximumBackwardProgress = -245;
    const maximumForwardProgress = 600;
    const leadSeconds = .16;
    return snapshot.players.filter(player => player.teamId === snapshot.teamId && player.id !== carrier.id &&
      !player.isGK && !player.sentOff && player.available).map(player => {
        const target = {
          x: clamp(player.x + player.vx * leadSeconds,
            snapshot.pitch.xMin + xInset, snapshot.pitch.xMax - xInset),
          y: clamp(player.y + player.vy * leadSeconds,
            snapshot.pitch.yMin + yInset, snapshot.pitch.yMax - yInset)
        };
        const passDistance = distance(carrier, target, space);
        const progress = space.xToCanonical(snapshot.attackingDirection * (target.x - carrier.x));
        const lane = laneClearance(carrier, target, opponents, space);
        const receiverSpace = laneClearance(player, player, opponents, space);
        const beyondOffsideLine = snapshot.attackingDirection * (target.x - snapshot.offsideLine) >
          -space.xFromCanonical(config.offsideBuffer * .25);
        const centralLink = ['defensive-midfielder', 'midfielder', 'attacking-midfielder'].includes(familyOf(player)) ? 18 : 0;
        const quality = (player.awareness + player.passing + player.control) / 3;
        const distanceShape = -Math.abs(passDistance - 315) * .18;
        const risk = passRisk(snapshot, carrier, player, target);
        const pressured = nearestOpponentClearance(carrier, carrier, snapshot) < 110;
        const score = Math.min(210, lane) * .58 + Math.min(300, receiverSpace) * .42 +
          progress * (pressured ? .035 : .16) + quality * .42 + distanceShape + centralLink - risk.probability * 180 +
          (pressured && progress < -45 ? 25 : 0);
        return { player, target, passDistance, progress, lane, receiverSpace, beyondOffsideLine, score, risk };
      }).filter(option => !option.beyondOffsideLine && option.passDistance >= minimumDistance &&
        option.passDistance <= maximumDistance && option.progress >= maximumBackwardProgress &&
        option.progress <= maximumForwardProgress && option.lane >= config.minimumPassLaneClearance &&
        option.receiverSpace >= config.minimumPassLaneClearance)
      .sort((left, right) => right.score - left.score || left.passDistance - right.passDistance ||
        left.player.id.localeCompare(right.player.id));
  }

  // Cheap decision-time estimate. The adapter still checks the actual MR flight.
  // Both receiver pressure and an opponent's travel time to the interior lane
  // matter; a clear line at release alone is not a safe pass.
  function passRisk(snapshot, carrier, receiver, target) {
    const space = pitchSpace(snapshot.pitch);
    const length = distance(carrier, target, space), pace = 300 + carrier.passing * 1.1;
    const dx = space.xToCanonical(target.x - carrier.x), dy = space.yToCanonical(target.y - carrier.y);
    let interception = 0, pressure = 0;
    for (const opponent of snapshot.players.filter(p => p.teamId !== carrier.teamId && !p.sentOff && p.available)) {
      const ox = space.xToCanonical(opponent.x - carrier.x), oy = space.yToCanonical(opponent.y - carrier.y);
      const t = clamp((ox * dx + oy * dy) / Math.max(1, length * length), .08, 1);
      const gap = Math.hypot(ox - t * dx, oy - t * dy);
      const arrival = Math.max(0, gap - 22) / (125 + opponent.pace * .8) + .15;
      const ballTime = length * t / pace;
      interception = Math.max(interception, clamp((ballTime - arrival + .23) / .65, 0, 1));
      const receiverGap = distance(opponent, target, space);
      pressure = Math.max(pressure, clamp((110 - receiverGap) / 110, 0, 1));
    }
    const quality = (carrier.passing + receiver.control + receiver.awareness) / 297;
    return { interception: rounded(interception), pressure: rounded(pressure),
      probability: rounded(clamp(interception * .65 + pressure * .28 + (1 - quality) * .12, 0, .97)) };
  }

  function combinationMovement(snapshot, memory, config) {
    const state = memory.combination, space = pitchSpace(snapshot.pitch), dir = snapshot.attackingDirection;
    const playerById = id => snapshot.players.find(p => p.id === id && !p.sentOff && p.available);
    if (snapshot.possessionTeamId !== snapshot.teamId) { state.move = null; state.lastOwnerId = null; return []; }
    // This is an observed authored flight, not the previous requested intent.
    if (snapshot.inFlight && !snapshot.carrierId && snapshot.intendedReceiverId && state.lastOwnerId &&
        (!state.move || state.move.linkId !== snapshot.intendedReceiverId || state.move.originId !== state.lastOwnerId)) {
      const origin = playerById(state.lastOwnerId), link = playerById(snapshot.intendedReceiverId);
      if (origin && link && origin.id !== link.id && !isRestDefender(origin) && !isHoldDuty(origin) &&
          distance(origin, link, space) >= 165 && distance(origin, link, space) <= 700) {
        const quality = (origin.awareness + origin.control + origin.passing) / 297;
        if (stableUnit(origin.id + ':' + link.id + ':' + Math.floor(snapshot.tick / 60)) < .35 + quality * .6) {
          const target = boundedDefensivePoint({ x: safeOnsideX(origin.x + dir * space.xFromCanonical(270), snapshot, config),
            y: origin.y + space.yFromCanonical(origin.y <= link.y ? -70 : 70) }, snapshot, config);
          const third = eligibleCpuOutfield(snapshot).filter(p => p.id !== origin.id && p.id !== link.id &&
            !isRestDefender(p) && !isHoldDuty(p) && distance(p, link, space) < 650)
            .sort((a, b) => distance(a, link, space) - distance(b, link, space) || a.id.localeCompare(b.id))[0];
          const thirdTarget = third && boundedDefensivePoint({
            x: safeOnsideX(link.x + dir * space.xFromCanonical(230), snapshot, config),
            y: link.y + space.yFromCanonical(target.y <= link.y ? 220 : -220) }, snapshot, config);
          state.move = { originId: origin.id, linkId: link.id, target, thirdId: third && third.id,
            thirdTarget, expiresTick: snapshot.tick + 210 };
        }
      }
    }
    if (snapshot.carrierId) {
      state.lastOwnerId = snapshot.carrierId;
      const owner = playerById(snapshot.carrierId);
      state.lastOwnerPoint = owner && { x: owner.x, y: owner.y };
    }
    const move = state.move;
    if (!move) return [];
    if (snapshot.tick > move.expiresTick || !playerById(move.originId) || !playerById(move.linkId) ||
        (snapshot.carrierId && ![move.linkId, move.originId, move.thirdId].includes(snapshot.carrierId))) {
      state.move = null; return [];
    }
    const intents = [{ playerId: move.originId, type: 'give-and-go', target: move.target }];
    if (move.thirdId && playerById(move.thirdId)) intents.push({ playerId: move.thirdId, type: 'third-man', target: move.thirdTarget });
    return intents.filter(p => p.playerId !== snapshot.carrierId).map(p => ({ ...p,
      target: { ...p.target, x: safeOnsideX(p.target.x, snapshot, config) } }));
  }

  function combinationPass(snapshot, carrier, memory, config) {
    const move = memory.combination.move;
    if (!move || snapshot.carrierId !== move.linkId || snapshot.tick > move.expiresTick) return null;
    const space = pitchSpace(snapshot.pitch);
    const options = [move.originId, move.thirdId].filter(Boolean).map(id => {
      const player = snapshot.players.find(p => p.id === id && !p.sentOff && p.available);
      if (!player) return null;
      // Pass into the runner's reachable stride, not his distant run endpoint.
      const target = { x: player.x + player.vx * .22, y: player.y + player.vy * .22 };
      const progress = space.xToCanonical(snapshot.attackingDirection * (target.x - carrier.x));
      const length = distance(carrier, target, space), lane = nearestOpponentClearance(carrier, target, snapshot);
      const risk = passRisk(snapshot, carrier, player, target);
      return { player, target, progress, length, lane, risk,
        score: progress * .2 + Math.min(lane, 210) * .6 - risk.probability * 180 };
    }).filter(p => p && p.progress > 45 && p.length >= 165 && p.length <= 700 &&
      p.lane >= config.minimumPassLaneClearance && p.risk.probability < .45 && !currentOffside(p.player, snapshot, config))
      .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
    const best = options[0];
    if (!best) return null;
    return { type: 'pass', targetPlayerId: best.player.id, target: best.target, confidence: .82,
      supportKind: 'support', risk: best.risk, offsideTiming: null,
      reason: best.player.id === move.originId ? 'give-and-go-return' : 'third-man-layoff' };
  }

  function observeCirculationOutcome(snapshot, memory, telemetry, config) {
    const circulation = memory.circulation;
    if (snapshot.possessionTeamId !== snapshot.teamId) {
      circulation.pendingPasserId = null;
      circulation.pendingReceiverId = null;
      circulation.pendingIssuedTick = null;
      circulation.lastCompletedPasserId = null;
      circulation.lastCompletedReceiverId = null;
      circulation.lastCompletedTick = null;
      circulation.recentPasses = [];
      return;
    }
    if (!circulation.pendingPasserId) return;
    const completed = snapshot.possessionTeamId === snapshot.teamId &&
      snapshot.carrierId === circulation.pendingReceiverId;
    if (completed) {
      circulation.lastCompletedPasserId = circulation.pendingPasserId;
      circulation.lastCompletedReceiverId = circulation.pendingReceiverId;
      circulation.lastCompletedTick = snapshot.tick;
      circulation.recentPasses.push({
        passerId: circulation.pendingPasserId,
        receiverId: circulation.pendingReceiverId,
        tick: snapshot.tick
      });
      circulation.recentPasses = circulation.recentPasses
        .filter(pass => snapshot.tick - pass.tick <= config.circulationHistoryTicks)
        .slice(-config.circulationHistoryPasses);
      telemetry.transitions.push({
        type: 'circulation-pass-completed',
        passerId: circulation.pendingPasserId,
        receiverId: circulation.pendingReceiverId,
        tick: snapshot.tick
      });
    }
    const possessionResolvedElsewhere = snapshot.carrierId &&
      (snapshot.possessionTeamId !== snapshot.teamId ||
        ![circulation.pendingPasserId, circulation.pendingReceiverId].includes(snapshot.carrierId));
    const expired = snapshot.tick - circulation.pendingIssuedTick > 240;
    if (completed || possessionResolvedElsewhere || expired) {
      circulation.pendingPasserId = null;
      circulation.pendingReceiverId = null;
      circulation.pendingIssuedTick = null;
    }
  }

  function rememberCirculationPass(snapshot, intent, memory) {
    if (intent.type !== 'pass' || !snapshot.carrierId || !intent.targetPlayerId) return;
    memory.circulation.pendingPasserId = snapshot.carrierId;
    memory.circulation.pendingReceiverId = intent.targetPlayerId;
    memory.circulation.pendingIssuedTick = snapshot.tick;
  }

  function recentCirculationPairCount(circulation, playerA, playerB, tick, config) {
    return (circulation.recentPasses || []).filter(pass =>
      tick - pass.tick <= config.circulationHistoryTicks &&
      ((pass.passerId === playerA && pass.receiverId === playerB) ||
        (pass.passerId === playerB && pass.receiverId === playerA))).length;
  }

  // One committed exit, chosen from real lanes. No per-frame skill lottery.
  function dribbleOptions(snapshot, carrier, memory, config) {
    const space = pitchSpace(snapshot.pitch), dir = snapshot.attackingDirection;
    const opponents = snapshot.players.filter(p => p.teamId !== carrier.teamId && !p.sentOff && p.available);
    const near = opponents.map(p => ({ p, d: distance(p, carrier, space) }))
      .sort((a, b) => a.d - b.d || a.p.id.localeCompare(b.p.id));
    const nearest = near[0], state = memory.dribble;
    if (state.carrierId !== carrier.id) {
      state.carrierId = carrier.id; state.intent = null; state.untilTick = 0;
    }
    if (state.intent && snapshot.tick < state.untilTick && distance(carrier, state.intent.target, space) > 30) {
      const others = opponents.filter(p => p.id !== state.intent.defenderId);
      if (laneClearance(carrier, state.intent.target, others, space) >= 45) {
        const elapsed = snapshot.tick - state.intent.startedTick;
        return { ...cloneObject(state.intent), phase: elapsed < state.intent.feintTicks ? 'feint' : 'burst' };
      }
    }
    state.intent = null;
    const pointAt = (forward, lateral) => boundedDefensivePoint({
      x: carrier.x + dir * space.xFromCanonical(forward),
      y: carrier.y + space.yFromCanonical(lateral)
    }, snapshot, config);
    const centre = (snapshot.pitch.yMin + snapshot.pitch.yMax) / 2;
    const lanes = [0, -.55, .55, -1, 1].map(slope => {
      const target = pointAt(420 / Math.hypot(1, slope), 420 * slope / Math.hypot(1, slope));
      const forwardOpponents = opponents.filter(p => dir * space.xToCanonical(p.x - carrier.x) >= -30);
      const clearance = laneClearance(carrier, target, forwardOpponents, space);
      const endpoint = laneClearance(target, target, opponents, space);
      const inward = Math.abs(carrier.y - centre) - Math.abs(target.y - centre);
      return { target, clearance, score: Math.min(clearance, 220) + Math.min(endpoint, 220) * .25 +
        space.yToCanonical(inward) * .08 - Math.abs(slope) * 8 };
    }).sort((a, b) => b.score - a.score);
    const best = lanes[0];
    let takeOn = null;
    if (nearest && nearest.d >= 32 && nearest.d <= 125 && snapshot.tick >= state.cooldownUntilTick &&
        near.filter(p => p.d < 145).length === 1 && dir * space.xToCanonical(nearest.p.x - carrier.x) > nearest.d * .72) {
      const defender = nearest.p, velocity = canonicalVelocity(defender, space);
      const closing = velocity.x * -dir;
      const side = defender.y >= carrier.y ? -1 : 1;
      const exits = [side, -side].map(sign => {
        const target = pointAt(210, sign * 120);
        const others = opponents.filter(p => p.id !== defender.id);
        const behind = laneClearance(target, target, opponents, space);
        const lane = laneClearance(carrier, target, others, space);
        const offBalance = Math.abs(velocity.y - sign * 90) / 160 + Math.max(0, closing) / 180;
        const quality = (carrier.control + carrier.agility - defender.defending - defender.pace) / 198;
        return { target, sign, behind, lane, score: Math.min(behind, 160) * .45 + Math.min(lane, 180) * .3 +
          offBalance * 24 + quality * 35 };
      }).filter(e => e.behind > 70 && e.lane > 72).sort((a, b) => b.score - a.score);
      if (exits.length) {
        const exit = exits[0], set = Math.hypot(velocity.x, velocity.y) < 75 && !defender.committed;
        const lateral = Math.abs(space.yToCanonical(defender.y - carrier.y));
        const skill = !set || nearest.d > 95 ? null : nearest.d < 52 ? 'roulette' : lateral > 30 ? 'bodyFeint' :
          nearest.d < 80 ? 'stepover' : 'dragBack';
        const exitDx = dir * space.xToCanonical(exit.target.x - carrier.x), exitDy = space.yToCanonical(exit.target.y - carrier.y), exitLength = Math.hypot(exitDx, exitDy) || 1;
        let runwayMetres = 0;
        const cover = opponents.filter(p => p.id !== defender.id);
        for (let metres = 4; metres <= 44; metres += 2) {
          const probe = pointAt(exitDx / exitLength * metres * 30.25, exitDy / exitLength * metres * 30.25);
          if (distance(probe, carrier, space) < metres * 30.25 * .9 || laneClearance(probe, probe, cover, space) < 80) break;
          runwayMetres = metres;
        }
        const quality = (carrier.control + carrier.agility + carrier.pace) / 297;
        const tiers = [
          { tier: 'light', score: 1.1 - runwayMetres * .015 },
          { tier: 'strong', score: .25 + quality * .5 + runwayMetres * .035 },
          { tier: 'double', score: -.75 + quality * .7 + runwayMetres * .055 + (defender.committed ? .3 : 0) }
        ].sort((a, b) => b.score - a.score);
        takeOn = { type: 'take-on', targetPlayerId: null, target: exit.target, confidence: .7,
          reason: defender.committed || closing > 60 ? 'commitment-exit' : 'isolated-defender-space-behind',
          defenderId: defender.id, skill, feintTicks: skill ? Math.round(12 - carrier.agility / 99 * 5) : 0,
          knockOn: defender.committed || closing > 90, knockOnTier: tiers[0].tier, runwayMetres, startedTick: snapshot.tick, phase: skill ? 'feint' : 'burst',
          score: exit.score };
      }
    }
    return { carry: best && best.clearance >= config.minimumCarryLaneClearance ? {
      type: 'carry', targetPlayerId: null, target: best.target, confidence: .8, reason: 'open-directional-lane',
      clearance: best.clearance, score: best.score } : null, takeOn, nearest };
  }

  function commitDribble(snapshot, memory, intent, ticks) {
    memory.dribble.intent = cloneObject(intent); memory.dribble.untilTick = snapshot.tick + ticks;
    if (intent.type === 'take-on') memory.dribble.cooldownUntilTick = snapshot.tick + 210;
    return intent;
  }

  function carrierIntent(snapshot, runs, memory, config) {
    const carrier = snapshot.players.find(player => player.id === snapshot.carrierId) || null;
    if (!carrier || snapshot.possessionTeamId !== snapshot.teamId) {
      memory.dribble.intent = null; memory.dribble.carrierId = null;
      return { type: 'wait', targetPlayerId: null, target: null, confidence: 1, reason: 'no-controlled-possession' };
    }
    const pitch = snapshot.pitch;
    const goal = {
      x: snapshot.attackingDirection > 0 ? pitch.xMax : pitch.xMin,
      y: (pitch.yMin + pitch.yMax) / 2
    };
    const space = pitchSpace(pitch);
    const goalDistance = distance(carrier, goal, space);
    // A footballer does not abandon a valid shot merely because the exact
    // centre of the goal is screened. Test the centres of all three goal
    // thirds while keeping the same physical lane-clearance rule. The keeper
    // remains an opponent in this geometry, so placement can work around his
    // position without bypassing the downstream save authority.
    const goalThirdOffset = space.yFromCanonical(GOAL_THIRD_OFFSET_CANONICAL);
    const farPostSign = carrier.y <= goal.y ? 1 : -1;
    const shotLanes = [
      { target: goal, tiePriority: 0 },
      { target: { x: goal.x, y: goal.y + farPostSign * goalThirdOffset }, tiePriority: 1 },
      { target: { x: goal.x, y: goal.y - farPostSign * goalThirdOffset }, tiePriority: 2 }
    ].map(lane => ({ ...lane, clearance: nearestOpponentClearance(carrier, lane.target, snapshot) }))
      .sort((left, right) => right.clearance - left.clearance || left.tiePriority - right.tiePriority);
    const bestShotLane = shotLanes[0];
    const shotClearance = bestShotLane.clearance;
    const ratedShotDistance = config.shotDistance + clamp(carrier.shooting - 62, 0, 37) * 5;
    if (goalDistance <= ratedShotDistance && shotClearance >= config.minimumShotLaneClearance && carrier.shooting >= 62) {
      const lateralOffset = Math.abs(space.yToCanonical(carrier.y - goal.y));
      const closeRange = goalDistance <= 390;
      const longRange = goalDistance >= 690;
      const wideAngle = lateralOffset >= 360;
      const pressure = nearestOpponentClearance(carrier, carrier, snapshot);
      let technique = 'driven';
      if (closeRange || pressure < 72) technique = 'low-driven';
      else if (wideAngle && carrier.control >= 70) technique = 'placed';
      else if (longRange && carrier.shooting >= 74) technique = 'power';
      const power = clamp(0.48 + goalDistance / Math.max(1, ratedShotDistance) * 0.38 +
        (technique === 'power' ? 0.1 : technique === 'low-driven' ? 0.04 : 0), 0.5, 0.98);
      return {
        type: 'shot', targetPlayerId: null, target: { ...bestShotLane.target },
        confidence: rounded(clamp(0.45 + carrier.shooting / 180 + shotClearance / 900, 0, 0.99)),
        reason: 'goal-range-and-shot-lane-open',
        shotProfile: {
          technique,
          power: rounded(power, 4),
          distance: rounded(goalDistance),
          laneClearance: rounded(shotClearance),
          pressure: rounded(pressure),
          wideAngle
        }
      };
    }
    const dribble = dribbleOptions(snapshot, carrier, memory, config);
    if (dribble.type) return dribble;
    const combination = combinationPass(snapshot, carrier, memory, config);
    if (combination) return combination;
    const passOptions = runs.map(run => {
      const runner = snapshot.players.find(player => player.id === run.playerId);
      const releaseTarget = run.continuationTarget || run.target;
      const clearance = nearestOpponentClearance(carrier, releaseTarget, snapshot);
      const progress = space.xToCanonical(snapshot.attackingDirection * (releaseTarget.x - carrier.x));
      const passDistance = distance(carrier, releaseTarget, space);
      const risk = runner ? passRisk(snapshot, carrier, runner, releaseTarget) : { probability: 1 };
      return { run, runner, clearance, progress, passDistance, risk,
        score: progress * 0.16 + Math.min(clearance, 210) * 0.42 + run.score * 0.75 - risk.probability * 210 };
    // A two-metre nudge is not a release into a coordinated run. Treat it as
    // continued possession and let the carrier/receiver create separation.
    // The previous 45-unit progress floor produced full-strength passes to a
    // teammate almost standing on the ball, which MR correctly carried far
    // beyond the nominal rendezvous.
    // D1 (19 Oct 2026): a release beyond ~46 m (1390 canonical units) cannot be
    // delivered by Ball V2 as a playable pass, so it is not a real option.
    }).filter(option => option.runner && option.clearance >= config.minimumPassLaneClearance &&
      option.progress > 75 && option.passDistance >= 165 && option.passDistance <= 1390 && option.risk.probability < .62)
      .sort((a, b) => b.score - a.score || a.run.playerId.localeCompare(b.run.playerId));
    const releaseRun = best => ({
      type: 'pass', targetPlayerId: best.run.playerId,
      target: { ...(best.run.continuationTarget || best.run.target) },
      offsideTiming: cloneObject(best.run.offsideTiming || null),
      confidence: rounded(clamp(0.42 + carrier.passing / 200 + best.clearance / 1000, 0, 0.98)),
      risk: best.risk,
      reason: best.run.observedOpening ? 'release-newly-opened-run' : 'release-coordinated-run'
    });
    const openedRun = passOptions.find(option => option.run.observedOpening);
    const supportOptions = shortSupportOptions(snapshot, carrier, config);
    const carrierPressure = nearestOpponentClearance(carrier, carrier, snapshot);
    // Under pressure, a safe outlet outranks a speculative opening. In space,
    // a genuinely better progressive lane still beats routine circulation.
    if (openedRun && (carrierPressure >= 110 || !supportOptions.length ||
        openedRun.risk.probability <= supportOptions[0].risk.probability + .08)) return releaseRun(openedRun);
    const carrierFamily = familyOf(carrier);
    const previousPasser = memory.circulation.lastCompletedPasserId
      ? snapshot.players.find(player => player.id === memory.circulation.lastCompletedPasserId) || null
      : null;
    const recentDefenderReceipt = memory.circulation.lastCompletedReceiverId === carrier.id &&
      memory.circulation.lastCompletedTick != null &&
      snapshot.tick - memory.circulation.lastCompletedTick <= 180 &&
      previousPasser && previousPasser.teamId === carrier.teamId &&
      isRestDefender(carrier) && isRestDefender(previousPasser);
    const suppressDirectReturn = recentDefenderReceipt && carrierPressure >= 82;
    const repeatedDefenderPairs = new Set(supportOptions.filter(option =>
      isRestDefender(carrier) && isRestDefender(option.player) && carrierPressure >= 82 &&
      recentCirculationPairCount(memory.circulation, carrier.id, option.player.id,
        snapshot.tick, config) >= config.circulationRepeatedPairLimit).map(option => option.player.id));
    const suppressHistoricalPair = repeatedDefenderPairs.size > 0;
    const alternativeSupport = suppressDirectReturn || suppressHistoricalPair
      ? supportOptions.filter(option =>
        (!previousPasser || !suppressDirectReturn || option.player.id !== previousPasser.id) &&
        !repeatedDefenderPairs.has(option.player.id))
      : supportOptions;
    const preferredSupportOptions = alternativeSupport.length ? alternativeSupport : supportOptions;
    // Circulation remains the default, but it must not erase an independently
    // authored penetrating run whose live geometry is materially better. This
    // comparison is deliberately systemic: progress, distance, lane clearance
    // and the same run/support scores used by the planner all have to agree.
    // The downstream live pass-race gate still owns whether the ball is safe
    // to release; this layer only keeps a real forward option in contention.
    const bestSupport = preferredSupportOptions[0] || null;
    const progressiveRoutineRun = passOptions.find(option =>
      !option.run.observedOpening && PENETRATING_RUNS.has(option.run.runType) &&
      option.progress >= config.routineProgressiveRunMinimumProgress &&
      option.passDistance >= config.routineProgressiveRunMinimumDistance &&
      option.clearance >= config.minimumPassLaneClearance + config.routineProgressiveRunClearanceBonus &&
      (!bestSupport || option.score >= bestSupport.score + config.routineProgressiveRunScoreAdvantage));
    if (progressiveRoutineRun) return releaseRun(progressiveRoutineRun);
    const circulationRole = ['centre-back', 'full-back', 'wing-back', 'defensive-midfielder', 'midfielder']
      .includes(carrierFamily);
    const carryTarget = dribble.carry && dribble.carry.target;
    const carryClearance = dribble.carry ? dribble.carry.clearance : 0;
    // A linked return remains first choice. Otherwise compare a real 1v1 exit
    // against the best outlet; control/agility scale its attractiveness.
    const takeOn = dribble.takeOn;
    if (takeOn && (!bestSupport || carrierPressure >= 82 && bestSupport.progress < 100 &&
        takeOn.score + (carrier.control + carrier.agility) * .2 > bestSupport.score)) {
      return commitDribble(snapshot, memory, takeOn, 90);
    }
    if (dribble.carry && dribble.nearest && snapshot.attackingDirection *
        space.xToCanonical(carrier.x - dribble.nearest.p.x) > 45 && snapshot.attackingDirection * carrier.vx > 0) {
      return { ...dribble.carry, reason: 'carry-away-from-beaten-defender' };
    }
    if ((suppressDirectReturn || suppressHistoricalPair) && !alternativeSupport.length &&
        carryClearance >= config.minimumCarryLaneClearance) {
      return {
        type: 'carry', targetPlayerId: null, target: carryTarget,
        confidence: rounded(clamp(0.43 + carrier.control / 195 + carryClearance / 1250, 0, 0.95)),
        reason: suppressHistoricalPair ? 'defender-pair-history-break-carry' : 'defender-return-loop-break-carry'
      };
    }
    const assertiveCarrier = ['attacking-midfielder', 'winger', 'striker'].includes(carrierFamily);
    // An unpressured attacking carrier should use the space in front of him.
    // Previously every available support pass won first, producing lateral
    // striker ping-pong and preventing the team from ever entering shot range.
    const freeProgress = carrierPressure >= 210 && carryClearance >= 120 && bestSupport && bestSupport.progress <= 0;
    if ((assertiveCarrier || freeProgress) && carrierPressure >= 135 && carryClearance >= config.minimumCarryLaneClearance) {
      return {
        type: 'carry', targetPlayerId: null, target: carryTarget,
        confidence: rounded(clamp(0.45 + carrier.control / 185 + carryClearance / 1200, 0, 0.97)),
        reason: 'attacking-carrier-space-open'
      };
    }
    if (preferredSupportOptions.length &&
        (circulationRole || carrierPressure < 180 || preferredSupportOptions[0].progress > 75)) {
      const best = preferredSupportOptions[0];
      return {
        type: 'pass', targetPlayerId: best.player.id, target: { ...best.target }, offsideTiming: null,
        confidence: rounded(clamp(.36 + carrier.passing / 300 + best.lane / 2200 + best.receiverSpace / 3000,
          .58, .94)),
        reason: suppressHistoricalPair && !repeatedDefenderPairs.has(best.player.id)
          ? 'defender-pair-history-break-support'
          : suppressDirectReturn && best.player.id !== previousPasser.id
            ? 'defender-return-loop-break-support'
            : 'short-support-circulation',
        supportKind: best.progress < -45 ? 'recycle' : 'support',
        risk: best.risk,
        supportMetrics: {
          distance: rounded(best.passDistance),
          progress: rounded(best.progress),
          laneClearance: rounded(best.lane),
          receiverSpace: rounded(best.receiverSpace)
        }
      };
    }
    if (passOptions.length) return releaseRun(passOptions[0]);
    if (carryClearance >= config.minimumCarryLaneClearance) {
      return {
        type: 'carry', targetPlayerId: null, target: carryTarget,
        confidence: rounded(clamp(0.4 + carrier.control / 190 + carryClearance / 1100, 0, 0.96)),
        reason: 'carrier-forward-lane-open'
      };
    }
    if (dribble.nearest && dribble.nearest.d < 85) {
      const defender = dribble.nearest.p, dx = space.xToCanonical(carrier.x - defender.x),
        dy = space.yToCanonical(carrier.y - defender.y), length = Math.hypot(dx, dy) || 1;
      return { type: 'protect', targetPlayerId: null,
        target: boundedDefensivePoint({ x: carrier.x + space.xFromCanonical(dx / length * 65),
          y: carrier.y + space.yFromCanonical(dy / length * 65) }, snapshot, config),
        confidence: .75, reason: 'pressure-no-safe-outlet', defenderId: defender.id };
    }
    const reacting = Object.values(memory.observations).some(observation =>
      observation.eligibleTick > snapshot.tick && observation.expiresTick >= snapshot.tick);
    return {
      type: 'wait', targetPlayerId: null, target: null,
      confidence: reacting ? 0.78 : 0.62,
      reason: reacting ? 'opening-read-in-progress' : 'no-safe-progressive-action'
    };
  }

  function summarizeConstraints(telemetry) {
    const summary = {};
    for (const bid of telemetry.bids) {
      for (const reason of bid.rejectionReasons) summary[reason] = (summary[reason] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(summary).sort((a, b) => a[0].localeCompare(b[0])));
  }

  function decide(snapshot, previousMemory, overrides) {
    const config = configWith(overrides);
    const current = normalizeSnapshot(snapshot, config);
    const memory = createMemory(previousMemory);
    if (memory.teamId && memory.teamId !== current.teamId) throw new RangeError('memory belongs to another team');
    if (memory.lastTick >= current.tick) throw new RangeError('snapshot.tick must advance beyond memory.lastTick');
    memory.teamId = current.teamId;
    const playersById = Object.fromEntries(current.players.map(player => [player.id, player]));
    const telemetry = {
      schema: 'football-legacy-cpu-telemetry-v2',
      tick: current.tick,
      fixedTickSeconds: current.fixedTickSeconds,
      perception: [],
      bids: [],
      transitions: [],
      constraints: {},
      carrier: null,
      defense: null
    };
    const candidates = buildCandidates(current, config);
    perceiveOpenings(current, memory, candidates, playersById, config, telemetry);
    const active = persistCommitments(current, memory, candidates, playersById, config, telemetry);
    const runs = selectNewRuns(current, memory, candidates, playersById, active, config, telemetry);
    observeCirculationOutcome(current, memory, telemetry, config);
    const combinationIntents = combinationMovement(current, memory, config);
    const intent = carrierIntent(current, runs, memory, config);
    // Match lab only: count carrier decisions when the lab provides a ledger.
    const labLedger = typeof globalThis !== 'undefined' && globalThis.__dartyLabIntents;
    if (labLedger && current.carrierId && current.possessionTeamId === current.teamId) {
      const key = intent.type + ':' + intent.reason;
      labLedger[key] = (labLedger[key] || 0) + 1;
      const carrier = current.players.find(player => player.id === current.carrierId);
      if (carrier) {
        const space = pitchSpace(current.pitch);
        const goal = { x: current.attackingDirection > 0 ? current.pitch.xMax : current.pitch.xMin, y: (current.pitch.yMin + current.pitch.yMax) / 2 };
        const metres = distance(carrier, goal, space) * 105 / (CANONICAL_PITCH.xMax - CANONICAL_PITCH.xMin);
        const bucket = 'dist:' + String(Math.min(60, Math.floor(metres / 5) * 5)).padStart(2, '0');
        labLedger[bucket] = (labLedger[bucket] || 0) + 1;
        if (metres <= 25) {
          const shotKey = 'near:' + intent.type + ':' + intent.reason;
          labLedger[shotKey] = (labLedger[shotKey] || 0) + 1;
        }
      }
    }
    rememberCirculationPass(current, intent, memory);
    const defensiveIntents = buildDefensiveIntents(current, memory, config, telemetry);
    const supportIntents = midfieldSupportIntents(current, config)
      .filter(intent => !combinationIntents.some(move => move.playerId === intent.playerId)).concat(combinationIntents);
    telemetry.carrier = cloneObject(intent);
    telemetry.constraints = summarizeConstraints(telemetry);
    memory.lastTick = current.tick;
    const decision = {
      schema: DECISION_SCHEMA,
      version: VERSION,
      tick: current.tick,
      fixedTickSeconds: current.fixedTickSeconds,
      teamId: current.teamId,
      authority: 'dormant-candidate',
      perception: { openings: telemetry.perception.map(entry => cloneObject(entry)) },
      runs,
      carrierIntent: intent,
      defensiveIntents,
      supportIntents,
      memory,
      telemetry
    };
    return decision;
  }

  function fixturePlayer(id, teamId, x, y, data) {
    return {
      id, teamId, x, y, formationAnchor: { x, y }, role: 'midfielder', position: 'CM',
      pace: 76, acceleration: 76, awareness: 78, passing: 78, shooting: 68, control: 78,
      stamina: 88, ...(data || {})
    };
  }

  function createBaleStyleOpenSpaceBeelineFixture() {
    const pitch = { xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 };
    const basePlayers = [
      fixturePlayer('bale-style-runner', 'home', 1320, 390, {
        role: 'left-winger', position: 'LW', pace: 97, acceleration: 99, awareness: 97,
        control: 92, shooting: 90, formationAnchor: { x: 1180, y: 390 }
      }),
      fixturePlayer('home-carrier', 'home', 1160, 1070, {
        role: 'central-midfielder', position: 'CM', passing: 94, awareness: 94, control: 92
      }),
      fixturePlayer('home-cb-left', 'home', 710, 790, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
      fixturePlayer('home-cb-right', 'home', 700, 1370, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
      fixturePlayer('home-dm', 'home', 940, 1070, { role: 'defensive-midfielder', position: 'CDM', duty: 'hold' }),
      fixturePlayer('away-blocker', 'away', 1570, 440, { role: 'full-back', position: 'RB', awareness: 82 }),
      fixturePlayer('away-wide-blocker', 'away', 1560, 285, { role: 'winger', position: 'RW', awareness: 76 }),
      fixturePlayer('away-inside-blocker', 'away', 1560, 560, { role: 'midfielder', position: 'CM', awareness: 78 }),
      fixturePlayer('away-cb-left', 'away', 2800, 770, { role: 'centre-back', position: 'CB' }),
      fixturePlayer('away-cb-right', 'away', 2810, 1390, { role: 'centre-back', position: 'CB' }),
      fixturePlayer('away-mid', 'away', 1940, 1280, { role: 'midfielder', position: 'CM' })
    ];
    function snapshotAt(tick, phase) {
      const players = basePlayers.map(player => ({ ...cloneObject(player) }));
      const blocker = players.find(player => player.id === 'away-blocker');
      const wideBlocker = players.find(player => player.id === 'away-wide-blocker');
      const insideBlocker = players.find(player => player.id === 'away-inside-blocker');
      const events = [];
      if (phase !== 'closed') {
        blocker.y = 940;
        wideBlocker.y = 1180;
        insideBlocker.y = 1460;
      }
      if (phase === 'opened') {
        events.push({
          id: 'bale-left-channel-opens', type: 'space-opened', tick, teamId: 'home',
          playerId: 'bale-style-runner', runType: 'channel', target: { x: 2260, y: 455 },
          reason: 'full-back-vacated-wide-channel'
        });
      }
      if (phase === 'narrowed') blocker.y = 620;
      return {
        schema: SNAPSHOT_SCHEMA,
        tick,
        fixedTickSeconds: 1 / 60,
        teamId: 'home',
        possessionTeamId: phase === 'turnover' ? 'away' : 'home',
        carrierId: phase === 'turnover' ? 'away-mid' : 'home-carrier',
        attackingDirection: 1,
        offsideLine: 2820,
        pitch,
        ball: phase === 'turnover' ? { x: 1940, y: 1280 } : { x: 1160, y: 1070 },
        players,
        events
      };
    }
    return {
      name: 'Bale-style open-space beeline',
      runnerId: 'bale-style-runner',
      carrierId: 'home-carrier',
      openTick: 101,
      expectedCommitByTick: 102,
      snapshots: {
        closed: snapshotAt(100, 'closed'),
        opened: snapshotAt(101, 'opened'),
        reacted: snapshotAt(102, 'open'),
        narrowed: snapshotAt(108, 'narrowed'),
        turnover: snapshotAt(130, 'turnover')
      }
    };
  }

  return Object.freeze({
    VERSION,
    SNAPSHOT_SCHEMA,
    MEMORY_SCHEMA,
    DECISION_SCHEMA,
    CANONICAL_PITCH,
    COORDINATE_CONTRACT,
    DEFAULT_CONFIG,
    createMemory,
    validateSnapshot(snapshot, overrides) {
      return normalizeSnapshot(snapshot, configWith(overrides));
    },
    decide,
    createBaleStyleOpenSpaceBeelineFixture
  });
});
