'use strict';

/*
 * Football Legacy V2 offline match-control composition.
 *
 * This module composes MatchClock V2, Restart Presentation V2 and the
 * Set-Piece Suite V2 behind one transactional, exact-once host boundary. It
 * deliberately has no DOM, renderer, input listener or match.html hook. The
 * live host must prepare a tick, apply every required command, then commit the
 * receipt. Any rejected transaction permanently returns that runtime to the
 * Build 173 fallback.
 */
(function exposeLiveV2MatchControlComposition(root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./match-clock-v2.js') : root && root.FootballLegacyMatchClockV2,
    typeof module === 'object' && module.exports ? require('./restart-presentation-v2.js') : root && root.FootballLegacyRestartPresentationV2,
    typeof module === 'object' && module.exports ? require('./set-piece-suite-v2.js') : root && root.FootballLegacySetPieceSuiteV2,
    typeof module === 'object' && module.exports ? require('./set-piece-coordinate-contract-v2.js') : root && root.FootballLegacySetPieceCoordinateContractV2
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyLiveV2MatchControlComposition = api;
})(typeof window === 'object' ? window : null, function createLiveV2MatchControlCompositionApi(Clock, Restart, Suite, Coordinates) {
  'use strict';

  const VERSION = '1.0.0-offline-live-match-control';
  const CAPABILITY_SCHEMA = 'football-legacy-live-v2-match-control-capability-v1';
  const RUNTIME_SCHEMA = 'football-legacy-live-v2-match-control-runtime-v1';
  const TICK_INPUT_SCHEMA = 'football-legacy-live-v2-match-control-tick-v1';
  const PLAN_SCHEMA = 'football-legacy-live-v2-match-control-plan-v1';
  const COMMAND_SCHEMA = 'football-legacy-live-v2-match-control-command-v1';
  const RECEIPT_SCHEMA = 'football-legacy-live-v2-match-control-receipt-v1';
  const SNAPSHOT_SCHEMA = 'football-legacy-live-v2-match-control-snapshot-v1';
  const AUTHORITY = 'fl-v2-approved-offline-match-control';
  const ACKNOWLEDGEMENT = 'EXPLICIT_FL_V2_OFFLINE_MATCH_CONTROL';
  const WORKFLOWS = Object.freeze(['single-player', 'cpu-v-cpu', 'set-piece-suite']);
  const ENGINE = 'fl-v2';
  const FALLBACK_ENGINE = 'build-173';
  const LIVE_ENGINE_VERSION = '1.0.0-offline-live-authority-playtest';
  const FIXED_TICK_SECONDS = 1 / 60;
  const MAX_TICK = 1000000000;
  const MAX_LEDGER = 1024;
  const MAX_ID_LENGTH = 95;
  const SAFE_LIMITS = Object.freeze({ depth: 12, nodes: 4096, array: 1024, keys: 128, string: 2048 });
  const RESERVED_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);
  const ISSUED_CAPABILITIES = new WeakSet();
  const ISSUED_RUNTIMES = new WeakSet();
  const PRIVATE = new WeakMap();

  const HOST_PHASE_TO_CLOCK_PHASE = Object.freeze({
    kickoff: 'dead-ball',
    live: 'live',
    'dead-ball': 'dead-ball',
    'restart-setup': 'dead-ball',
    'offside-presentation': 'offside-presentation',
    'set-piece': 'set-piece',
    substitution: 'substitution',
    card: 'card',
    var: 'var',
    replay: 'replay',
    celebration: 'presentation',
    presentation: 'presentation',
    'half-time': 'presentation',
    'full-time': 'presentation',
    paused: 'paused'
  });

  const SET_PIECE_ACTIONS = Object.freeze([
    'stage', 'arm', 'launch', 'contact', 'resolve', 'reset', 'repeat', 'menu', 'shortcut'
  ]);
  const PERIOD_ACTIONS = Object.freeze(['start-second-half','abandon-match']);

  function assertDependencies() {
    if (!Clock || Clock.VERSION !== '2.0.0-dormant' ||
        Clock.STATE_SCHEMA !== 'football-legacy-match-clock-state-v2' ||
        Clock.OUTPUT_SCHEMA !== 'football-legacy-match-clock-output-v2') {
      throw new Error('current MatchClock V2 is required');
    }
    if (!Restart || Restart.VERSION !== '2.0.0-dormant' ||
        Restart.STATE_SCHEMA !== 'football-legacy-restart-presentation-v2-state' ||
        Restart.COMMAND_SCHEMA !== 'football-legacy-restart-presentation-v2-command') {
      throw new Error('current Restart Presentation V2 is required');
    }
    if (!Suite || Suite.VERSION !== '2.0.0-dormant' ||
        Suite.STATE_SCHEMA !== 'football-legacy-set-piece-suite-v2-state' ||
        Suite.BALL_LAUNCH_SCHEMA !== 'football-legacy-ball-v2-launch-intent') {
      throw new Error('current Set-Piece Suite V2 is required');
    }
    if (!Coordinates || Coordinates.VERSION !== '2.0.0-dormant' ||
        Coordinates.PITCH_SCHEMA !== 'football-legacy-set-piece-coordinate-v2-pitch' ||
        Coordinates.TRANSFORM_SCHEMA !== 'football-legacy-set-piece-coordinate-v2-transform' ||
        Coordinates.CANONICAL_COORDINATE_SYSTEM !== 'si-metres-attacking-positive-x') {
      throw new Error('current Set-Piece Coordinate Contract V2 is required');
    }
  }

  function finite(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(label + ' must be finite');
    return Number(value);
  }

  function integer(value, minimum, maximum, label) {
    const number = finite(value, label);
    if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
      throw new RangeError(label + ' must be a safe integer within ' + minimum + '..' + maximum);
    }
    return number;
  }

  function stableId(value, label) {
    if (typeof value !== 'string' || value.length > MAX_ID_LENGTH ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
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

  function safeClone(value, label, state, depth) {
    const path = label || 'value';
    const tracker = state || { active: new WeakSet(), nodes: 0 };
    const level = depth || 0;
    if (level > SAFE_LIMITS.depth) throw new RangeError(path + ' exceeds the safe depth limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finite(value, path);
    if (typeof value === 'string') {
      if (value.length > SAFE_LIMITS.string) throw new RangeError(path + ' exceeds the safe string limit');
      return value;
    }
    if (!value || typeof value !== 'object') throw new TypeError(path + ' must contain JSON-safe data');
    tracker.nodes += 1;
    if (tracker.nodes > SAFE_LIMITS.nodes) throw new RangeError(path + ' exceeds the safe node limit');
    if (tracker.active.has(value)) throw new TypeError(path + ' must not contain cycles');
    tracker.active.add(value);
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype) {
      tracker.active.delete(value);
      throw new TypeError(path + ' must contain plain objects only');
    }
    if (array && value.length > SAFE_LIMITS.array) {
      tracker.active.delete(value);
      throw new RangeError(path + ' exceeds the safe array limit');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > (array ? value.length + 1 : SAFE_LIMITS.keys)) {
      tracker.active.delete(value);
      throw new RangeError(path + ' exceeds the safe key limit');
    }
    const output = array ? [] : {};
    for (const key of keys) {
      if (typeof key !== 'string') {
        tracker.active.delete(value);
        throw new TypeError(path + ' must not contain symbol keys');
      }
      if (array && key === 'length') continue;
      if (RESERVED_KEYS.includes(key)) {
        tracker.active.delete(value);
        throw new TypeError(path + ' contains a reserved key');
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        tracker.active.delete(value);
        throw new TypeError(path + '.' + key + ' must be a stable enumerable data property');
      }
      output[key] = safeClone(descriptor.value, path + '.' + key, tracker, level + 1);
    }
    tracker.active.delete(value);
    return output;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const output = {};
    Object.keys(value).sort().forEach(key => { output[key] = stableValue(value[key]); });
    return output;
  }

  // Single-pass equivalent of JSON.stringify(stableValue(safeClone(value))) for
  // plain JSON data inside the safe limits. It returns null for anything the
  // validating path could reject (non-finite numbers, undefined, non-plain
  // objects, reserved keys, limit overruns, cycles), and the caller then runs
  // the original validating path so errors are unchanged.
  function stableJsonFast(value) {
    const tracker = { nodes: 0, unfrozen: 0, deepest: 0 };
    const text = stableFast(value, 0, tracker);
    return text === undefined ? null : text;
  }

  // Deeply frozen subtrees are immutable, so their stable text is computed once
  // per object. A hit replays the node and depth accounting of the original
  // traversal so the safe limits behave exactly as they would uncached.
  const STABLE_TEXT_CACHE = new WeakMap();

  function stableFast(value, level, tracker) {
    if (value === null) return 'null';
    const kind = typeof value;
    if (kind === 'boolean') return value ? 'true' : 'false';
    if (kind === 'number') return Number.isFinite(value) ? String(value) : undefined;
    if (kind === 'string') return value.length > SAFE_LIMITS.string ? undefined : JSON.stringify(value);
    if (kind !== 'object' || level > SAFE_LIMITS.depth) return undefined;
    const frozen = Object.isFrozen(value);
    if (frozen) {
      const hit = STABLE_TEXT_CACHE.get(value);
      if (hit !== undefined) {
        if (level + hit.height > SAFE_LIMITS.depth) return undefined;
        tracker.nodes += hit.nodes;
        if (tracker.nodes > SAFE_LIMITS.nodes) return undefined;
        if (level + hit.height > tracker.deepest) tracker.deepest = level + hit.height;
        return hit.text;
      }
    }
    const startNodes = tracker.nodes;
    const startUnfrozen = tracker.unfrozen;
    const outerDeepest = tracker.deepest;
    tracker.deepest = level;
    tracker.nodes += 1;
    if (tracker.nodes > SAFE_LIMITS.nodes) return undefined;
    if (!frozen) tracker.unfrozen += 1;
    let text;
    if (Array.isArray(value)) {
      const length = value.length;
      if (Object.getPrototypeOf(value) !== Array.prototype || length > SAFE_LIMITS.array) return undefined;
      text = '[';
      for (let index = 0; index < length; index += 1) {
        const item = stableFast(value[index], level + 1, tracker);
        if (item === undefined) return undefined;
        text += index === 0 ? item : ',' + item;
      }
      text += ']';
    } else {
      if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
      const keys = Object.keys(value);
      if (keys.length > SAFE_LIMITS.keys) return undefined;
      keys.sort();
      text = '{';
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const first = key.charCodeAt(0);
        if (first >= 48 && first <= 57) return undefined; // array-index keys reorder under JSON.stringify
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return undefined;
        const item = stableFast(value[key], level + 1, tracker);
        if (item === undefined) return undefined;
        text += (index === 0 ? '' : ',') + JSON.stringify(key) + ':' + item;
      }
      text += '}';
    }
    if (frozen && tracker.unfrozen === startUnfrozen) {
      STABLE_TEXT_CACHE.set(value, { text, nodes: tracker.nodes - startNodes, height: tracker.deepest - level });
    }
    if (outerDeepest > tracker.deepest) tracker.deepest = outerDeepest;
    return text;
  }

  function stableJson(value) {
    const fast = stableJsonFast(value);
    if (fast !== null) return fast;
    return JSON.stringify(stableValue(safeClone(value, 'stableJson')));
  }

  function digest(value) {
    const text = stableJson(value);
    let first = 2166136261;
    let second = 3339675911;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 16777619) >>> 0;
      second ^= code + (index & 255);
      second = Math.imul(second, 2246822519) >>> 0;
    }
    return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function compareIds(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function addLedger(list, values) {
    const seen = new Set(list);
    const next = list.slice();
    values.forEach(value => {
      if (!seen.has(value)) {
        seen.add(value);
        next.push(value);
      }
    });
    if (next.length > MAX_LEDGER) {
      throw new RangeError('exact-once ledger capacity would be exceeded');
    }
    return next;
  }

  function assertLedgerCapacity(list, values, label) {
    const projected = new Set(list);
    values.forEach(value => projected.add(value));
    if (projected.size > MAX_LEDGER) {
      throw new RangeError((label || 'exact-once') + ' ledger capacity would be exceeded');
    }
  }

  function eventLedgerId(domain, eventId) {
    const sourceId = stableId(eventId, domain + ' event id');
    return domain + ':' + digest(sourceId);
  }

  function createCapability(options) {
    assertDependencies();
    const source = plainObject(safeClone(options, 'capability'), 'capability');
    if (source.enabled !== true || !WORKFLOWS.includes(source.workflow) || source.online !== false ||
        source.requestedEngine !== ENGINE || source.effectiveEngine !== ENGINE ||
        source.engineVersion !== LIVE_ENGINE_VERSION || source.fallbackEngine !== FALLBACK_ENGINE ||
        source.acknowledgement !== ACKNOWLEDGEMENT) {
      throw new TypeError('exact FL V2 approved offline match-control capability is required');
    }
    const capability = deepFreeze({
      schema: CAPABILITY_SCHEMA,
      version: VERSION,
      authority: AUTHORITY,
      workflow: source.workflow,
      online: false,
      requestedEngine: ENGINE,
      effectiveEngine: ENGINE,
      engineVersion: LIVE_ENGINE_VERSION,
      fallbackEngine: FALLBACK_ENGINE
    });
    ISSUED_CAPABILITIES.add(capability);
    return capability;
  }

  function assertCapability(capability) {
    if (!capability || !ISSUED_CAPABILITIES.has(capability) || capability.schema !== CAPABILITY_SCHEMA ||
        capability.version !== VERSION || capability.authority !== AUTHORITY ||
        !WORKFLOWS.includes(capability.workflow) || capability.online !== false ||
        capability.requestedEngine !== ENGINE || capability.effectiveEngine !== ENGINE ||
        capability.engineVersion !== LIVE_ENGINE_VERSION || capability.fallbackEngine !== FALLBACK_ENGINE) {
      throw new TypeError('matching issued FL V2 match-control capability is required');
    }
  }

  function createRuntime(options, capability) {
    assertCapability(capability);
    const source = plainObject(safeClone(options || {}, 'runtime options'), 'runtime options');
    const sessionId = stableId(source.sessionId || 'fl-v2-match-control', 'runtime.sessionId');
    const fixedTickSeconds = source.fixedTickSeconds == null ? FIXED_TICK_SECONDS :
      finite(source.fixedTickSeconds, 'runtime.fixedTickSeconds');
    if (fixedTickSeconds !== FIXED_TICK_SECONDS) throw new RangeError('runtime fixed tick must be exactly 1/60 second');
    const realMatchDurationSeconds = source.realMatchDurationSeconds == null ? 240 :
      finite(source.realMatchDurationSeconds, 'runtime.realMatchDurationSeconds');
    if (!(realMatchDurationSeconds > 0 && realMatchDurationSeconds <= 60 * 60)) {
      throw new RangeError('runtime.realMatchDurationSeconds must be within 0..3600');
    }
    const pitch = Coordinates.createMetricPitchBounds(plainObject(source.pitch, 'runtime.pitch'));
    const restartSessionId = 'restart-' + digest(sessionId);
    const suiteSessionId = 'suite-' + digest(sessionId);
    const restartCapability = Restart.createShadowCapability({
      grant: Restart.CAPABILITY_GRANT,
      runtimeMode: Restart.RUNTIME_MODE,
      authority: Restart.RUNTIME_AUTHORITY,
      sessionId: restartSessionId,
      capabilityId: 'match-control-restart-capability'
    });
    let restartState = Restart.createState({ sessionId: restartSessionId });
    restartState = Restart.activate(restartState, restartCapability, {
      workflow: capability.workflow === 'set-piece-suite'
        ? Restart.WORKFLOWS.SET_PIECE_SUITE
        : capability.workflow === 'cpu-v-cpu'
          ? Restart.WORKFLOWS.CPU_V_CPU
          : Restart.WORKFLOWS.SINGLE_PLAYER,
      runtimeMode: Restart.RUNTIME_MODE,
      authority: Restart.RUNTIME_AUTHORITY,
      normalMatchAuthority: false,
      online: false
    });
    const suiteCapability = Suite.createSuiteCapability({
      grant: Suite.CAPABILITY_GRANT,
      runtimeMode: Suite.SUITE_RUNTIME_MODE,
      authority: Suite.SUITE_RUNTIME_AUTHORITY,
      sessionId: suiteSessionId,
      capabilityId: 'match-control-suite-capability'
    });
    let suiteState = Suite.createState({ sessionId: suiteSessionId });
    suiteState = Suite.activate(suiteState, suiteCapability, {
      runtimeMode: Suite.SUITE_RUNTIME_MODE,
      authority: Suite.SUITE_RUNTIME_AUTHORITY,
      normalMatchAuthority: false
    });
    const clockState = Clock.createState({
      fixedTickSeconds,
      realMatchDurationSeconds,
      initialPhase: 'dead-ball',
      initialReason: 'pre-kickoff',
      initialEligibleForAddedTime: false
    });
    const runtime = deepFreeze({
      schema: RUNTIME_SCHEMA,
      version: VERSION,
      authority: AUTHORITY,
      sessionId,
      workflow: capability.workflow,
      online: false
    });
    ISSUED_RUNTIMES.add(runtime);
    PRIVATE.set(runtime, {
      enabled: true,
      fallbackReason: null,
      committedTick: 0,
      clockState,
      restartState,
      restartCapability,
      restartCommandSequence: restartState.commands.length,
      suiteState,
      suiteCapability,
      processedEventIds: [],
      consumedCommandIds: [],
      lastCommittedPlanId: null,
      pending: null,
      pitch
    });
    return runtime;
  }

  function assertRuntime(runtime, capability) {
    assertCapability(capability);
    if (!runtime || !ISSUED_RUNTIMES.has(runtime) || runtime.schema !== RUNTIME_SCHEMA ||
        runtime.version !== VERSION || runtime.authority !== AUTHORITY ||
        !WORKFLOWS.includes(runtime.workflow) || runtime.workflow !== capability.workflow ||
        runtime.online !== false || !PRIVATE.has(runtime)) {
      throw new TypeError('matching issued FL V2 match-control runtime is required');
    }
    return PRIVATE.get(runtime);
  }

  function mapHostPhase(hostPhase) {
    if (!Object.prototype.hasOwnProperty.call(HOST_PHASE_TO_CLOCK_PHASE, hostPhase)) {
      throw new RangeError('host phase is unsupported: ' + hostPhase);
    }
    return HOST_PHASE_TO_CLOCK_PHASE[hostPhase];
  }

  function normalizeTickInput(input, workflow) {
    const source = plainObject(safeClone(input, 'tick input'), 'tick input');
    if (source.schema !== TICK_INPUT_SCHEMA || source.workflow !== workflow || source.online !== false ||
        source.requestedEngine !== ENGINE || source.effectiveEngine !== ENGINE ||
        source.engineVersion !== LIVE_ENGINE_VERSION) {
      throw new TypeError('tick input must match the explicit FL V2 approved offline workflow authority');
    }
    const tick = integer(source.tick, 1, MAX_TICK, 'tick input.tick');
    const hostPhase = String(source.hostPhase || '');
    mapHostPhase(hostPhase);
    if(source.periodEndBlocked!=null&&typeof source.periodEndBlocked!=='boolean')throw new TypeError('periodEndBlocked must be a boolean');
    const reason = source.reason == null ? hostPhase : String(source.reason);
    if (!reason || reason.length > 160) throw new TypeError('tick input.reason must be 1..160 characters');
    const restartIncident = source.restartIncident == null ? null :
      plainObject(source.restartIncident, 'tick input.restartIncident');
    const setPieceEvent = source.setPieceEvent == null ? null :
      plainObject(source.setPieceEvent, 'tick input.setPieceEvent');
    const periodEvent = source.periodEvent == null ? null : plainObject(source.periodEvent, 'tick input.periodEvent');
    if (restartIncident && setPieceEvent) throw new Error('restart presentation and set-piece event cannot share one tick');
    let normalizedRestart = null;
    if (restartIncident) {
      const eventId = stableId(restartIncident.eventId || restartIncident.id, 'restartIncident.eventId');
      normalizedRestart = safeClone(Object.assign({}, restartIncident, {
        eventId,
        id: eventId,
        ledgerId: eventLedgerId('restart', eventId)
      }), 'restartIncident');
    }
    let normalizedSetPiece = null;
    if (setPieceEvent) {
      const eventId = stableId(setPieceEvent.eventId, 'setPieceEvent.eventId');
      const action = String(setPieceEvent.action || '');
      if (!SET_PIECE_ACTIONS.includes(action)) throw new RangeError('setPieceEvent.action is unsupported');
      normalizedSetPiece = safeClone(Object.assign({}, setPieceEvent, {
        eventId,
        action,
        ledgerId: eventLedgerId('suite', eventId)
      }), 'setPieceEvent');
    }
    let normalizedPeriod = null;
    if (periodEvent) {
      const eventId = stableId(periodEvent.eventId, 'periodEvent.eventId');
      const action = String(periodEvent.action || '');
      if (!PERIOD_ACTIONS.includes(action)) throw new RangeError('periodEvent.action is unsupported');
      if(action==='abandon-match'&&(typeof periodEvent.teamId!=='string'||!periodEvent.teamId||
          !Number.isInteger(periodEvent.remainingPlayers)||periodEvent.remainingPlayers<0||periodEvent.remainingPlayers>=7))
        throw new TypeError('abandon-match requires a team with fewer than seven players');
      normalizedPeriod = { eventId, action,...(action==='abandon-match'?{teamId:periodEvent.teamId,remainingPlayers:periodEvent.remainingPlayers}:{}), ledgerId: eventLedgerId('period', eventId) };
    }
    return {
      schema: TICK_INPUT_SCHEMA,
      tick,
      workflow,
      online: false,
      requestedEngine: ENGINE,
      effectiveEngine: ENGINE,
      engineVersion: LIVE_ENGINE_VERSION,
      hostPhase,
      reason,
      periodEndBlocked: source.periodEndBlocked === true,
      eligibleForAddedTime: source.eligibleForAddedTime !== false,
      addedTimeWeight: source.addedTimeWeight == null ? null : finite(source.addedTimeWeight, 'addedTimeWeight'),
      restartIncident: normalizedRestart,
      setPieceEvent: normalizedSetPiece,
      periodEvent: normalizedPeriod
    };
  }

  function transitionClock(clockState, input, periodAlreadyProcessed) {
    const desired = mapHostPhase(input.hostPhase);
    let next = clockState;
    if (input.periodEvent && !periodAlreadyProcessed) {
      if(input.periodEvent.action==='abandon-match'){
        if(input.periodEndBlocked||input.hostPhase==='paused')throw new Error('abandonment must wait for the pending referee action');
        return Clock.advance(Clock.abandonMatch(next,input.periodEvent),1);
      }
      if (input.periodEvent.action !== 'start-second-half' || next.period !== 'half-time' ||
          !['kickoff', 'dead-ball'].includes(input.hostPhase)) {
        throw new Error('start-second-half requires half-time and a kickoff/dead-ball host phase');
      }
      next = Clock.startSecondHalf(next, {
        tick: next.tick,
        initialPhase: 'dead-ball',
        reason: 'second-half-pre-kickoff',
        eligibleForAddedTime: false
      });
    }
    if (desired === 'paused') {
      if (next.phase !== 'paused') next = Clock.pause(next, { tick: next.tick, reason: input.reason });
    } else {
      if (next.phase === 'paused') next = Clock.resume(next, { tick: next.tick, reason: 'host-resumed' });
      const activePeriod = Clock.ACTIVE_PERIODS.includes(next.period);
      if (activePeriod && next.phase !== desired) {
        next = Clock.enterPhase(next, desired, {
          tick: next.tick,
          reason: input.reason,
          eligibleForAddedTime: input.eligibleForAddedTime,
          addedTimeWeight: input.addedTimeWeight == null ? undefined : input.addedTimeWeight
        });
      } else if (!activePeriod && desired !== 'presentation') {
        throw new Error('half-time/full-time clock accepts presentation host phase only');
      }
    }
    return Clock.advance(next, 1, { periodEndBlocked: input.periodEndBlocked });
  }

  function cameraRestartKind(scenarioKind) {
    if (scenarioKind === Suite.SCENARIO_KINDS.FREE_KICK) return Restart.RESTART_KINDS.FREE_KICK;
    if (scenarioKind === Suite.SCENARIO_KINDS.CORNER) return Restart.RESTART_KINDS.CORNER;
    if (scenarioKind === Suite.SCENARIO_KINDS.PENALTY) return Restart.RESTART_KINDS.PENALTY;
    throw new RangeError('scenario kind has no camera policy');
  }

  function cameraPolicyForEvent(suiteState, event, workflow) {
    if (!suiteState.selectedScenario) throw new Error('a staged scenario is required before camera policy resolution');
    return Restart.resolveCameraPolicy({
      workflow: workflow === 'set-piece-suite'
        ? Restart.WORKFLOWS.SET_PIECE_SUITE
        : workflow === 'cpu-v-cpu'
          ? Restart.WORKFLOWS.CPU_V_CPU
          : Restart.WORKFLOWS.SINGLE_PLAYER,
      restartKind: cameraRestartKind(suiteState.selectedScenario.kind),
      takerOwner: event.takerOwner,
      goalkeeperOwner: event.goalkeeperOwner == null ? Restart.OWNERS.CPU : event.goalkeeperOwner
    });
  }

  function setPieceTransform(pitch, event) {
    if (event.attackingDirection !== 1 && event.attackingDirection !== -1) {
      throw new RangeError('setPieceEvent.attackingDirection must be exactly +1 or -1');
    }
    return Coordinates.createTransform({
      pitch,
      orientation: event.attackingDirection === 1
        ? Coordinates.ORIENTATIONS.ATTACKING_RIGHT
        : Coordinates.ORIENTATIONS.ATTACKING_LEFT
    });
  }

  function unitToward(origin, target) {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-9)) throw new RangeError('set-piece origin and target must be horizontally distinct');
    return { x: dx / length, y: dy / length };
  }

  function canonicalRoleGeometry(scenario) {
    const origin = scenario.geometry.origin;
    const target = scenario.geometry.target;
    const forward = unitToward(origin, target);
    const taker = {
      x: Math.max(-52.5, Math.min(52.5, origin.x - forward.x * 1.8)),
      y: Math.max(-34, Math.min(34, origin.y - forward.y * 1.8)),
      z: 0
    };
    const wallPreset = Suite.WALL_PRESETS[scenario.wallPreset];
    const wall = [];
    if (wallPreset && wallPreset.defenders > 0) {
      const centre = {
        x: origin.x + forward.x * 9.15,
        y: origin.y + forward.y * 9.15
      };
      const lateral = { x: -forward.y, y: forward.x };
      for (let index = 0; index < wallPreset.defenders; index += 1) {
        const offset = (index - (wallPreset.defenders - 1) / 2) * 0.72;
        wall.push({
          x: Math.max(-52.5, Math.min(52.5, centre.x + lateral.x * offset)),
          y: Math.max(-34, Math.min(34, centre.y + lateral.y * offset)),
          z: 0
        });
      }
    }
    const keeperPreset = Suite.KEEPER_PRESETS[scenario.keeperPreset];
    const keeper = keeperPreset.behaviour === 'disabled' ? null : {
      x: 52.5 - keeperPreset.depthOffsetM,
      y: keeperPreset.lateralOffsetM,
      z: 0
    };
    return Coordinates.createCanonicalGeometry({
      schema: Coordinates.GEOMETRY_SCHEMA,
      coordinateSystem: Coordinates.CANONICAL_COORDINATE_SYSTEM,
      ball: { x: origin.x, y: origin.y, z: origin.z },
      taker,
      wall,
      keeper,
      targets: [{ x: target.x, y: target.y, z: target.z }]
    });
  }

  function liveSetPieceGeometry(scenario, pitch, event) {
    const transform = setPieceTransform(pitch, event);
    return {
      transform,
      geometry: Coordinates.canonicalToPitchGeometry(canonicalRoleGeometry(scenario), transform)
    };
  }

  function mapLaunchIntent(launchIntent, transform) {
    const mapped = safeClone(launchIntent, 'suite launch intent');
    mapped.origin = Coordinates.canonicalToPitchPoint(launchIntent.origin, transform);
    mapped.target = launchIntent.target == null ? null :
      Coordinates.canonicalToPitchPoint(launchIntent.target, transform);
    mapped.direction = launchIntent.direction == null ? null :
      Coordinates.canonicalToPitchVector(launchIntent.direction, transform);
    mapped.metadata = Object.assign({}, mapped.metadata, {
      liveCoordinateContract: {
        version: Coordinates.VERSION,
        coordinateSystem: Coordinates.PITCH_COORDINATE_SYSTEM,
        orientation: transform.orientation,
        attackSign: transform.attackSign,
        pitch: transform.pitch
      }
    });
    return mapped;
  }

  function setupCommand(event, tick, suiteState, pitch) {
    const mapped = liveSetPieceGeometry(suiteState.selectedScenario, pitch, event);
    return compositionCommand(
      'suite-setup:' + digest({ eventId: event.eventId, scenarioId: suiteState.selectedScenario.id,
        attackingDirection: event.attackingDirection }),
      tick,
      'setpiece.setup.handoff',
      'set-piece-suite-v2-coordinate-contract',
      {
        scenarioId: suiteState.selectedScenario.id,
        attackingDirection: event.attackingDirection,
        transform: mapped.transform,
        geometry: mapped.geometry,
        exactlyOnce: true
      },
      true
    );
  }

  function compositionCommand(id, tick, type, source, payload, handoff) {
    const commandId = stableId(id, 'command id');
    return {
      schema: COMMAND_SCHEMA,
      version: VERSION,
      id: commandId,
      tick,
      type,
      source,
      authority: AUTHORITY,
      exactOnce: true,
      handoff: handoff === true,
      handoffId: handoff === true ? commandId : null,
      payload: safeClone(payload || {}, 'command payload')
    };
  }

  function wrapRestartCommands(commands) {
    return commands.map(command => compositionCommand(
      'restart:' + command.sequence + ':' + digest(command),
      command.simulationTick,
      command.type,
      'restart-presentation-v2',
      {
        phase: command.phase,
        incidentId: command.incidentId,
        sourceCommandId: command.id,
        sourcePayload: command.payload
      },
      command.type === Restart.COMMANDS.HANDOFF_FREE_KICK
    ));
  }

  function applySetPieceEvent(suiteState, event, tick, capability, processedEventIds, workflow, pitch) {
    if (!event || processedEventIds.includes(event.ledgerId)) {
      return { state: suiteState, commands: [], processedEventId: null };
    }
    let next = suiteState;
    const commands = [];
    const action = event.action;
    if (action !== 'menu' && event.hostPhase !== undefined) {
      throw new Error('setPieceEvent must not carry a second host phase');
    }
    if (action === 'stage') {
      next = Suite.stageScenario(next, event.scenario, capability, { reason: event.reason || 'live-composition-stage' });
      commands.push(setupCommand(event, tick, next, pitch));
    } else if (action === 'arm') {
      const armed = Suite.createLaunchIntent(next, event.launch || {}, capability);
      next = armed.state;
      const transform = setPieceTransform(pitch, event);
      const mappedLaunchIntent = mapLaunchIntent(armed.launchIntent, transform);
      commands.push(compositionCommand(
        'suite-launch:' + digest(armed.launchIntent),
        tick,
        'ball.launch.handoff',
        'set-piece-suite-v2',
        { launchIntent: mappedLaunchIntent, transform, exactlyOnce: true },
        true
      ));
    } else if (action === 'launch') {
      next = Suite.markLaunched(next, { simulationTick: tick, consumer: 'fl-v2-ball-authority' }, capability);
    } else if (action === 'contact') {
      next = Suite.recordContact(next, Object.assign({}, event.contact || {}, { simulationTick: tick }), capability);
    } else if (action === 'resolve') {
      next = Suite.recordOutcome(next, Object.assign({}, event.outcome || {}, { simulationTick: tick }), capability);
    } else if (action === 'reset') {
      next = Suite.resetTrial(next, capability);
      commands.push(setupCommand(event, tick, next, pitch));
    } else if (action === 'repeat') {
      next = Suite.repeatTrial(next, capability);
      const repeated = Suite.getPendingLaunchIntent(next);
      const transform = setPieceTransform(pitch, event);
      commands.push(setupCommand(event, tick, next, pitch));
      commands.push(compositionCommand(
        'suite-launch:' + digest(repeated),
        tick,
        'ball.launch.handoff',
        'set-piece-suite-v2',
        { launchIntent: mapLaunchIntent(repeated, transform), transform, exactlyOnce: true, repeated: true },
        true
      ));
    } else if (action === 'menu') {
      next = Suite.handleMenuIntent(next, event.intent, capability);
    } else if (action === 'shortcut') {
      next = Suite.handleShortcut(next, event.shortcut, capability);
      if (next !== suiteState) commands.push(setupCommand(event, tick, next, pitch));
    }
    if ((['stage', 'arm', 'repeat', 'reset'].includes(action) ||
        (action === 'shortcut' && next !== suiteState)) && next.selectedScenario) {
      const policy = cameraPolicyForEvent(next, event, workflow);
      commands.unshift(compositionCommand(
        'camera:' + digest({ eventId: event.eventId, policy }),
        tick,
        'camera.policy.apply',
        'restart-presentation-v2-camera-policy',
        { policy, scenarioId: next.selectedScenario.id },
        false
      ));
    }
    return { state: next, commands, processedEventId: event.ledgerId };
  }

  function fallbackPlan(runtime, state, tick) {
    const safeTick = Number.isSafeInteger(tick) && tick >= 0 && tick <= MAX_TICK ? tick : state.committedTick;
    const plan = {
      schema: PLAN_SCHEMA,
      version: VERSION,
      authority: AUTHORITY,
      sessionId: runtime.sessionId,
      workflow: runtime.workflow,
      tick: safeTick,
      requestedEngine: ENGINE,
      effectiveEngine: FALLBACK_ENGINE,
      engineVersion: LIVE_ENGINE_VERSION,
      fallbackReason: state.fallbackReason || 'match-control-disabled',
      v2Applied: false,
      transactional: true,
      exactOnce: true,
      clockAuthority: FALLBACK_ENGINE,
      requiresLegacyClockFrozen: false,
      commands: [],
      requiredCommandIds: [],
      clock: null
    };
    plan.planId = 'fallback:' + plan.tick + ':' + digest(plan);
    return deepFreeze(plan);
  }

  function activateFallback(state, reason) {
    state.enabled = false;
    state.fallbackReason = String(reason || 'match-control-fallback').slice(0, 160);
    state.pending = null;
  }

  function prepareTick(runtime, input, capability) {
    const state = assertRuntime(runtime, capability);
    if (!state.enabled) {
      return fallbackPlan(runtime, state, state.committedTick);
    }
    let normalized;
    try {
      normalized = normalizeTickInput(input, runtime.workflow);
      if (normalized.tick !== state.committedTick + 1) {
        throw new RangeError('tick must be exactly the next authoritative simulation tick');
      }
      const inputDigest = digest(normalized);
      if (state.pending) {
        if (state.pending.inputDigest !== inputDigest) throw new Error('a different transaction is already pending');
        return state.pending.plan;
      }
      const restartAlreadyProcessed = normalized.restartIncident &&
        state.processedEventIds.includes(normalized.restartIncident.ledgerId);
      const setPieceAlreadyProcessed = normalized.setPieceEvent &&
        state.processedEventIds.includes(normalized.setPieceEvent.ledgerId);
      const periodAlreadyProcessed = normalized.periodEvent &&
        state.processedEventIds.includes(normalized.periodEvent.ledgerId);
      const proposedEventLedgerIds = [];
      if (normalized.restartIncident && !restartAlreadyProcessed) {
        proposedEventLedgerIds.push(normalized.restartIncident.ledgerId);
      }
      if (normalized.setPieceEvent && !setPieceAlreadyProcessed) {
        proposedEventLedgerIds.push(normalized.setPieceEvent.ledgerId);
      }
      if (normalized.periodEvent && !periodAlreadyProcessed) {
        proposedEventLedgerIds.push(normalized.periodEvent.ledgerId);
      }
      assertLedgerCapacity(state.processedEventIds, proposedEventLedgerIds, 'processed event');
      if (normalized.restartIncident && !restartAlreadyProcessed && normalized.hostPhase !== 'offside-presentation') {
        throw new Error('a new offside incident requires the offside-presentation host phase');
      }
      if (runtime.workflow === 'set-piece-suite' && normalized.restartIncident && !restartAlreadyProcessed) {
        throw new Error('offside presentation is frozen out of the Set-Piece Suite workflow');
      }
      const terminalSuitePresentationEvent = normalized.setPieceEvent &&
        ['contact', 'resolve'].includes(normalized.setPieceEvent.action) &&
        ['replay', 'celebration'].includes(normalized.hostPhase);
      if (normalized.setPieceEvent && !setPieceAlreadyProcessed &&
          normalized.setPieceEvent.action !== 'menu' && normalized.hostPhase !== 'set-piece' &&
          !terminalSuitePresentationEvent) {
        throw new Error('set-piece lifecycle actions require the set-piece host phase');
      }
      if ((state.restartState.active || (normalized.restartIncident && !restartAlreadyProcessed)) &&
          normalized.setPieceEvent && !setPieceAlreadyProcessed) {
        throw new Error('restart presentation owns the presentation lane until its handoff completes');
      }

      const nextClock = transitionClock(state.clockState, normalized, periodAlreadyProcessed);
      let nextRestart = state.restartState;
      if (normalized.restartIncident && !restartAlreadyProcessed) {
        nextRestart = Restart.beginOffsidePresentation(
          nextRestart,
          state.restartCapability,
          normalized.restartIncident,
          normalized.tick
        );
      }
      nextRestart = Restart.advance(nextRestart, state.restartCapability, normalized.tick);
      const restartSourceCommands = Restart.commandsSince(nextRestart, state.restartCommandSequence);
      const nextRestartCommandSequence = nextRestart.commands.length;
      let commands = wrapRestartCommands(restartSourceCommands);
      if (normalized.periodEvent && !periodAlreadyProcessed) {
        commands.push(compositionCommand(
          'period:' + digest(normalized.periodEvent),
          normalized.tick,
          'clock.period-transition.handoff',
          'match-clock-v2',
          {
            action: normalized.periodEvent.action,
            priorPeriod: state.clockState.period,
            nextPeriod: nextClock.period,
            exclusiveClockAuthority: true,
            exactlyOnce: true
          },
          true
        ));
      }
      const setPiece = applySetPieceEvent(
        state.suiteState,
        setPieceAlreadyProcessed ? null : normalized.setPieceEvent,
        normalized.tick,
        state.suiteCapability,
        state.processedEventIds,
        runtime.workflow,
        state.pitch
      );
      commands = commands.concat(setPiece.commands);
      commands = commands.filter(command => !state.consumedCommandIds.includes(command.id));
      const requiredCommandIds = commands.map(command => command.id).sort(compareIds);
      assertLedgerCapacity(state.consumedCommandIds, requiredCommandIds, 'consumed command');
      const processedEventIds = [];
      if (normalized.restartIncident && !restartAlreadyProcessed) processedEventIds.push(normalized.restartIncident.ledgerId);
      if (setPiece.processedEventId) processedEventIds.push(setPiece.processedEventId);
      if (normalized.periodEvent && !periodAlreadyProcessed) processedEventIds.push(normalized.periodEvent.ledgerId);
      const clockSnapshot = Clock.snapshot(nextClock);
      const planBase = {
        schema: PLAN_SCHEMA,
        version: VERSION,
        authority: AUTHORITY,
        sessionId: runtime.sessionId,
        workflow: runtime.workflow,
        tick: normalized.tick,
        requestedEngine: ENGINE,
        effectiveEngine: ENGINE,
        engineVersion: LIVE_ENGINE_VERSION,
        fallbackReason: null,
        v2Applied: true,
        transactional: true,
        exactOnce: true,
        clockAuthority: ENGINE,
        requiresLegacyClockFrozen: true,
        hostPhase: normalized.hostPhase,
        clockPhase: clockSnapshot.phase,
        commands,
        requiredCommandIds,
        clock: clockSnapshot
      };
      const planId = 'match-control:' + normalized.tick + ':' + digest(planBase);
      const plan = deepFreeze(Object.assign({ planId }, planBase));
      state.pending = {
        plan,
        inputDigest,
        nextClock,
        nextRestart,
        nextRestartCommandSequence,
        nextSuite: setPiece.state,
        processedEventIds,
        commandIds: requiredCommandIds
      };
      return plan;
    } catch (error) {
      activateFallback(state, 'match-control-plan-failed');
      return fallbackPlan(runtime, state, normalized ? normalized.tick : state.committedTick);
    }
  }

  function sameIds(left, right) {
    if (left.length !== right.length) return false;
    const a = left.slice().sort(compareIds);
    const b = right.slice().sort(compareIds);
    return a.every((value, index) => value === b[index]);
  }

  function snapshot(runtime, capability) {
    const state = assertRuntime(runtime, capability);
    const clock = Clock.snapshot(state.clockState);
    const restart = Restart.createExportPayload(state.restartState);
    const suite = Suite.createExportPayload(state.suiteState, state.suiteCapability);
    return deepFreeze({
      schema: SNAPSHOT_SCHEMA,
      version: VERSION,
      authority: AUTHORITY,
      sessionId: runtime.sessionId,
      workflow: runtime.workflow,
      online: false,
      requestedEngine: ENGINE,
      effectiveEngine: state.enabled ? ENGINE : FALLBACK_ENGINE,
      engineVersion: LIVE_ENGINE_VERSION,
      fallbackReason: state.fallbackReason,
      enabled: state.enabled,
      committedTick: state.committedTick,
      pendingPlanId: state.pending ? state.pending.plan.planId : null,
      lastCommittedPlanId: state.lastCommittedPlanId,
      ledgers: {
        processedEventIds: state.processedEventIds.slice(),
        consumedCommandIds: state.consumedCommandIds.slice()
      },
      pitch: state.pitch,
      clock,
      restart,
      setPieceSuite: suite
    });
  }

  function commit(runtime, plan, receipt, capability) {
    const state = assertRuntime(runtime, capability);
    if (!state.enabled) return snapshot(runtime, capability);
    if (plan && plan.planId === state.lastCommittedPlanId && !state.pending) return snapshot(runtime, capability);
    try {
      if (!state.pending || !plan || plan.schema !== PLAN_SCHEMA || plan.planId !== state.pending.plan.planId) {
        throw new Error('commit must reference the pending match-control plan');
      }
      const accepted = plainObject(safeClone(receipt, 'host receipt'), 'host receipt');
      if (accepted.schema !== RECEIPT_SCHEMA || accepted.planId !== plan.planId ||
          accepted.tick !== plan.tick || accepted.success !== true || accepted.clockAccepted !== true ||
          accepted.legacyClockAdvanced !== false ||
          !Array.isArray(accepted.appliedCommandIds) ||
          !sameIds(accepted.appliedCommandIds, plan.requiredCommandIds)) {
        throw new Error('host receipt did not atomically accept the complete plan');
      }
      accepted.appliedCommandIds.forEach((id, index) => stableId(id, 'host receipt command ' + index));
      state.clockState = state.pending.nextClock;
      state.restartState = state.pending.nextRestart;
      state.restartCommandSequence = state.pending.nextRestartCommandSequence;
      state.suiteState = state.pending.nextSuite;
      state.processedEventIds = addLedger(state.processedEventIds, state.pending.processedEventIds);
      state.consumedCommandIds = addLedger(state.consumedCommandIds, state.pending.commandIds);
      state.committedTick = plan.tick;
      state.lastCommittedPlanId = plan.planId;
      state.pending = null;
      return snapshot(runtime, capability);
    } catch (error) {
      activateFallback(state, 'match-control-host-commit-failed');
      return snapshot(runtime, capability);
    }
  }

  function rollback(runtime, plan, reason, capability) {
    const state = assertRuntime(runtime, capability);
    if (!state.enabled) return snapshot(runtime, capability);
    if (!state.pending || !plan || plan.planId !== state.pending.plan.planId) {
      throw new Error('rollback must reference the pending match-control plan');
    }
    activateFallback(state, reason || 'match-control-host-rollback');
    return snapshot(runtime, capability);
  }

  function abortPrepared(runtime, plan, capability) {
    const state = assertRuntime(runtime, capability);
    if (!state.enabled) return snapshot(runtime, capability);
    if (!state.pending || !plan || plan.planId !== state.pending.plan.planId) {
      throw new Error('abort must reference the pending match-control plan');
    }
    state.pending = null;
    return snapshot(runtime, capability);
  }

  function disable(runtime, reason, capability) {
    const state = assertRuntime(runtime, capability);
    activateFallback(state, reason || 'match-control-manually-disabled');
    return snapshot(runtime, capability);
  }

  function resolveCameraPolicy(input, capability) {
    assertCapability(capability);
    const source = plainObject(safeClone(input, 'camera policy input'), 'camera policy input');
    if (!WORKFLOWS.includes(source.workflow) || source.workflow !== capability.workflow || source.online !== false) {
      throw new Error('camera policy is limited to the capability offline workflow');
    }
    return Restart.resolveCameraPolicy({
      workflow: source.workflow === 'set-piece-suite'
        ? Restart.WORKFLOWS.SET_PIECE_SUITE
        : source.workflow === 'cpu-v-cpu'
          ? Restart.WORKFLOWS.CPU_V_CPU
          : Restart.WORKFLOWS.SINGLE_PLAYER,
      restartKind: source.restartKind,
      takerOwner: source.takerOwner,
      goalkeeperOwner: source.goalkeeperOwner == null ? Restart.OWNERS.CPU : source.goalkeeperOwner
    });
  }

  function minimumRosterStatus(teams){
    if(!teams||typeof teams!=='object')throw new TypeError('team player counts are required');
    let insufficient=null;
    for(const teamId of Object.keys(teams)){
      const count=teams[teamId];if(!Number.isInteger(count)||count<0||count>11)throw new TypeError('team counts must be integers0..11 including the goalkeeper');
      if(count<7&&!insufficient)insufficient={teamId,remainingPlayers:count,minimumPlayers:7};
    }
    return insufficient;
  }
  function periodEndProtection(facts={}){
 if(facts.sceneActive||facts.decisionPending||facts.activeDive||facts.penaltyPending||facts.physicalActionPending)return true;
 const b=facts.ball;
 if(!b||b.owned||!b.shotOrRebound||![b.x,b.y,b.vx,b.vy,b.direction].every(Number.isFinite)||
     ![-1,1].includes(b.direction)||b.direction*b.vx<=0)return false;
 const seconds=((b.direction>0?105:0)-b.x)/b.vx;
 return seconds>=0&&seconds<=4&&Math.abs(b.y+b.vy*seconds)<=3.66+1.25;
}

  return Object.freeze({
    periodEndProtection,minimumRosterStatus,
    VERSION,
    CAPABILITY_SCHEMA,
    RUNTIME_SCHEMA,
    TICK_INPUT_SCHEMA,
    PLAN_SCHEMA,
    COMMAND_SCHEMA,
    RECEIPT_SCHEMA,
    SNAPSHOT_SCHEMA,
    AUTHORITY,
    ACKNOWLEDGEMENT,
    WORKFLOWS,
    ENGINE,
    FALLBACK_ENGINE,
    LIVE_ENGINE_VERSION,
    FIXED_TICK_SECONDS,
    MAX_LEDGER,
    HOST_PHASE_TO_CLOCK_PHASE,
    SET_PIECE_ACTIONS,
    PERIOD_ACTIONS,
    createCapability,
    createRuntime,
    mapHostPhase,
    prepareTick,
    commit,
    rollback,
    abortPrepared,
    disable,
    snapshot,
    resolveCameraPolicy,
    stableJson
  });
});
