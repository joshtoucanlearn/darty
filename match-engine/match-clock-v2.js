'use strict';

/*
 * Football Legacy deterministic MatchClock v2.
 *
 * This module is intentionally dormant. It defines a fixed-tick candidate
 * authority for football time, stoppage animation time and period gates, but
 * it is not loaded or called by match.html. Build 173 remains the sole live
 * authority until a separately approved shadow/opt-in migration.
 */
(function exposeMatchClock(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyMatchClockV2 = api;
})(typeof window === 'object' ? window : null, function createMatchClockApi() {
  'use strict';

  const VERSION = '2.0.0-dormant';
  const STATE_SCHEMA = 'football-legacy-match-clock-state-v2';
  const EVENT_SCHEMA = 'football-legacy-match-clock-event-v2';
  const OUTPUT_SCHEMA = 'football-legacy-match-clock-output-v2';
  const TELEMETRY_SCHEMA = 'football-legacy-match-clock-telemetry-v2';

  const ACTIVE_PERIODS = Object.freeze(['first-half', 'second-half']);
  const STOPPED_PHASES = Object.freeze([
    'dead-ball',
    'offside-presentation',
    'set-piece',
    'substitution',
    'card',
    'var',
    'replay',
    'presentation'
  ]);
  const PHASES = Object.freeze(['live'].concat(STOPPED_PHASES, ['paused']));

  const DEFAULT_ADDED_TIME_WEIGHTS = Object.freeze({
    'dead-ball': 1,
    'offside-presentation': 1,
    'set-piece': 1,
    substitution: 1,
    card: 1,
    var: 1,
    replay: 1,
    presentation: 1
  });

  const DEFAULT_CONFIG = Object.freeze({
    fixedTickSeconds: 1 / 60,
    regulationMatchSeconds: 90 * 60,
    baseHalfGameplaySeconds: 45 * 60,
    realMatchDurationSeconds: 6 * 60,
    acceleration: 15,
    addedTimeRoundingSeconds: 60,
    addedTimeRoundingMode: 'nearest',
    maximumAddedTimeSeconds: 10 * 60,
    maximumTraceEntries: 256,
    addedTimeWeights: DEFAULT_ADDED_TIME_WEIGHTS
  });

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

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const result = {};
    const keys = Object.keys(value);
    for (let index = 0; index < keys.length; index += 1) result[keys[index]] = clone(value[keys[index]]);
    return result;
  }

  // State transitions clone the state, but history and stoppages are
  // persistent copy-on-write arrays of immutable entries (see recordInPlace),
  // so the clone shares them instead of re-copying every recorded entry.
  function cloneState(state) {
    const result = {};
    const keys = Object.keys(state);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      result[key] = key === 'history' || key === 'stoppages' ? state[key] : clone(state[key]);
    }
    return result;
  }

  // Snapshots expose frozen copies of the persistent arrays, built once per
  // distinct array identity.
  const FROZEN_COPIES = new WeakMap();
  function frozenCopy(array) {
    let copy = FROZEN_COPIES.get(array);
    if (copy === undefined) {
      copy = deepFreeze(clone(array));
      FROZEN_COPIES.set(array, copy);
    }
    return copy;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(key => {
      result[key] = stableValue(value[key]);
    });
    return result;
  }

  function stableJson(value) {
    return JSON.stringify(stableValue(value));
  }

  function positiveNumber(value, fallback, label) {
    const resolved = value == null ? fallback : Number(value);
    if (!Number.isFinite(resolved) || resolved <= 0) throw new Error(`${label} must be a positive finite number`);
    return resolved;
  }

  function nonNegativeNumber(value, fallback, label) {
    const resolved = value == null ? fallback : Number(value);
    if (!Number.isFinite(resolved) || resolved < 0) throw new Error(`${label} must be a non-negative finite number`);
    return resolved;
  }

  function positiveInteger(value, fallback, label) {
    const resolved = value == null ? fallback : Number(value);
    if (!Number.isInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
    return resolved;
  }

  function resolveConfig(options) {
    const source = options || {};
    const regulationMatchSeconds = positiveNumber(
      source.regulationMatchSeconds,
      DEFAULT_CONFIG.regulationMatchSeconds,
      'regulationMatchSeconds'
    );
    const baseHalfGameplaySeconds = positiveNumber(
      source.baseHalfGameplaySeconds,
      regulationMatchSeconds / 2,
      'baseHalfGameplaySeconds'
    );
    const realMatchDurationSeconds = positiveNumber(
      source.realMatchDurationSeconds,
      DEFAULT_CONFIG.realMatchDurationSeconds,
      'realMatchDurationSeconds'
    );
    const explicitAcceleration = source.acceleration == null
      ? regulationMatchSeconds / realMatchDurationSeconds
      : source.acceleration;
    const acceleration = positiveNumber(explicitAcceleration, DEFAULT_CONFIG.acceleration, 'acceleration');
    const roundingMode = source.addedTimeRoundingMode || DEFAULT_CONFIG.addedTimeRoundingMode;
    if (!['nearest', 'ceil', 'floor'].includes(roundingMode)) {
      throw new Error('addedTimeRoundingMode must be nearest, ceil or floor');
    }
    const weightOverrides = source.addedTimeWeights || {};
    const weights = {};
    STOPPED_PHASES.forEach(phase => {
      weights[phase] = nonNegativeNumber(
        weightOverrides[phase],
        DEFAULT_ADDED_TIME_WEIGHTS[phase],
        `addedTimeWeights.${phase}`
      );
    });
    return {
      fixedTickSeconds: positiveNumber(source.fixedTickSeconds, DEFAULT_CONFIG.fixedTickSeconds, 'fixedTickSeconds'),
      regulationMatchSeconds,
      baseHalfGameplaySeconds,
      realMatchDurationSeconds,
      acceleration,
      addedTimeRoundingSeconds: positiveNumber(
        source.addedTimeRoundingSeconds,
        DEFAULT_CONFIG.addedTimeRoundingSeconds,
        'addedTimeRoundingSeconds'
      ),
      addedTimeRoundingMode: roundingMode,
      maximumAddedTimeSeconds: nonNegativeNumber(
        source.maximumAddedTimeSeconds,
        DEFAULT_CONFIG.maximumAddedTimeSeconds,
        'maximumAddedTimeSeconds'
      ),
      maximumTraceEntries: positiveInteger(
        source.maximumTraceEntries,
        DEFAULT_CONFIG.maximumTraceEntries,
        'maximumTraceEntries'
      ),
      addedTimeWeights: weights
    };
  }

  function createPeriodState(id, config) {
    return {
      id,
      baseTargetSeconds: config.baseHalfGameplaySeconds,
      gameplaySeconds: 0,
      liveRealSeconds: 0,
      stoppedRealSeconds: 0,
      addedTime: {
        candidateSeconds: 0,
        manualSeconds: null,
        sealedSeconds: null,
        postSealSeconds: 0,
        sealedAtTick: null
      }
    };
  }

  function recordInPlace(state, type, details) {
    const event = {
      schema: EVENT_SCHEMA,
      sequence: state.nextEventSequence,
      tick: state.tick,
      type,
      period: state.period,
      phase: state.phase,
      details: clone(details || {})
    };
    state.nextEventSequence += 1;
    // history and stoppages are persistent copy-on-write arrays: recorded
    // entries are never mutated, so state clones share the arrays and an
    // append replaces the array instead of mutating a shared one.
    const history = state.history.slice();
    history.push(event);
    if (history.length > state.config.maximumTraceEntries) history.shift();
    state.history = history;
    return event;
  }

  function stoppedPhase(phase) {
    return STOPPED_PHASES.includes(phase);
  }

  function activePeriod(period) {
    return ACTIVE_PERIODS.includes(period);
  }

  function startStoppageInPlace(state, meta) {
    const details = meta || {};
    const eligible = details.eligibleForAddedTime !== false;
    const configuredWeight = state.config.addedTimeWeights[state.phase];
    const requestedWeight = details.addedTimeWeight;
    const weight = eligible
      ? nonNegativeNumber(requestedWeight, configuredWeight, 'addedTimeWeight')
      : 0;
    state.activeStoppage = {
      id: `stoppage:${state.period}:${state.tick}:${state.nextStoppageSequence}`,
      sequence: state.nextStoppageSequence,
      period: state.period,
      phase: state.phase,
      reason: String(details.reason || state.phase),
      startedTick: state.tick,
      endedTick: null,
      realSeconds: 0,
      addedTimeWeight: weight,
      addedTimeCandidateSeconds: 0,
      eligibleForAddedTime: eligible && weight > 0
    };
    state.nextStoppageSequence += 1;
  }

  function closeStoppageInPlace(state, endReason) {
    if (!state.activeStoppage) return;
    const completed = clone(state.activeStoppage);
    completed.endedTick = state.tick;
    completed.endReason = String(endReason || 'phase-transition');
    const stoppages = state.stoppages.slice();
    stoppages.push(completed);
    if (stoppages.length > state.config.maximumTraceEntries) stoppages.shift();
    state.stoppages = stoppages;
    state.activeStoppage = null;
  }

  function createState(options) {
    const source = options || {};
    const config = resolveConfig(source);
    const initialPhase = source.initialPhase || 'dead-ball';
    if (!PHASES.includes(initialPhase) || initialPhase === 'paused') {
      throw new Error('initialPhase must be live or a recognised stopped phase');
    }
    const state = {
      schema: STATE_SCHEMA,
      version: VERSION,
      tick: 0,
      config,
      period: 'first-half',
      phase: initialPhase,
      resumePhase: null,
      simulationElapsedSeconds: 0,
      animationElapsedSeconds: 0,
      pausedElapsedSeconds: 0,
      presentationElapsedSeconds: 0,
      totalGameplaySeconds: 0,
      totalLiveRealSeconds: 0,
      totalStoppedRealSeconds: 0,
      periodState: createPeriodState('first-half', config),
      firstHalf: null,
      secondHalf: null,
      activeStoppage: null,
      stoppages: [],
      history: [],
      nextEventSequence: 1,
      nextStoppageSequence: 1
    };
    if (stoppedPhase(initialPhase)) {
      startStoppageInPlace(state, {
        reason: source.initialReason || 'pre-kickoff',
        eligibleForAddedTime: source.initialEligibleForAddedTime === true,
        addedTimeWeight: source.initialAddedTimeWeight
      });
    }
    recordInPlace(state, 'clock-created', {
      fixedTickSeconds: config.fixedTickSeconds,
      acceleration: config.acceleration,
      initialPhase
    });
    return state;
  }

  function validateState(state) {
    const errors = [];
    if (!state || typeof state !== 'object') return { valid: false, errors: ['state must be an object'] };
    if (state.schema !== STATE_SCHEMA) errors.push(`schema must be ${STATE_SCHEMA}`);
    if (state.version !== VERSION) errors.push(`version must be ${VERSION}`);
    if (!Number.isInteger(state.tick) || state.tick < 0) errors.push('tick must be a non-negative integer');
    if (!['first-half', 'half-time', 'second-half', 'full-time'].includes(state.period)) errors.push('period is invalid');
    if (!PHASES.includes(state.phase)) errors.push('phase is invalid');
    if (!state.config || !Number.isFinite(state.config.fixedTickSeconds) || state.config.fixedTickSeconds <= 0) {
      errors.push('config.fixedTickSeconds must be positive');
    }
    if (!state.periodState || !Number.isFinite(state.periodState.gameplaySeconds) || state.periodState.gameplaySeconds < 0) {
      errors.push('periodState.gameplaySeconds must be non-negative');
    }
    [
      'simulationElapsedSeconds', 'animationElapsedSeconds', 'pausedElapsedSeconds',
      'presentationElapsedSeconds', 'totalGameplaySeconds', 'totalLiveRealSeconds',
      'totalStoppedRealSeconds'
    ].forEach(key => {
      if (!Number.isFinite(state[key]) || state[key] < 0) errors.push(`${key} must be non-negative and finite`);
    });
    if (!Array.isArray(state.history)) errors.push('history must be an array');
    if (!Array.isArray(state.stoppages)) errors.push('stoppages must be an array');
    if (state.phase === 'paused' && !state.resumePhase) errors.push('paused state requires resumePhase');
    if (state.resumePhase && !PHASES.includes(state.resumePhase)) errors.push('resumePhase is invalid');
    if (state.activeStoppage && !stoppedPhase(state.activeStoppage.phase)) errors.push('activeStoppage phase is invalid');
    return { valid: errors.length === 0, errors };
  }

  function assertState(state) {
    const result = validateState(state);
    if (!result.valid) throw new Error(`invalid MatchClock V2 state: ${result.errors.join('; ')}`);
  }

  function assertTransitionTick(state, event) {
    if (event && event.tick != null && event.tick !== state.tick) {
      throw new Error(`transition tick ${event.tick} does not match authoritative tick ${state.tick}`);
    }
  }

  function enterPhase(state, phase, meta) {
    assertState(state);
    const details = meta || {};
    assertTransitionTick(state, details);
    if (!activePeriod(state.period)) throw new Error(`cannot enter ${phase} during ${state.period}`);
    if (state.phase === 'paused') throw new Error('resume the clock before entering another phase');
    if (!PHASES.includes(phase) || phase === 'paused') throw new Error(`unknown match phase ${phase}`);
    const next = cloneState(state);
    if (next.phase === phase) return next;
    const from = next.phase;
    closeStoppageInPlace(next, `enter-${phase}`);
    next.phase = phase;
    if (stoppedPhase(phase)) startStoppageInPlace(next, details);
    recordInPlace(next, 'phase-transition', {
      from,
      to: phase,
      reason: String(details.reason || `${from}-to-${phase}`)
    });
    return next;
  }

  function pause(state, meta) {
    assertState(state);
    const details = meta || {};
    assertTransitionTick(state, details);
    if (state.phase === 'paused') return cloneState(state);
    const next = cloneState(state);
    const from = next.phase;
    next.resumePhase = from;
    next.phase = 'paused';
    recordInPlace(next, 'paused', { from, reason: String(details.reason || 'pause') });
    return next;
  }

  function resume(state, meta) {
    assertState(state);
    const details = meta || {};
    assertTransitionTick(state, details);
    if (state.phase !== 'paused') throw new Error('clock is not paused');
    const next = cloneState(state);
    const restored = next.resumePhase;
    next.phase = restored;
    next.resumePhase = null;
    recordInPlace(next, 'resumed', { to: restored, reason: String(details.reason || 'resume') });
    return next;
  }

  function declareAddedTime(state, seconds, meta) {
    assertState(state);
    const details = meta || {};
    assertTransitionTick(state, details);
    if (!activePeriod(state.period)) throw new Error('added time can only be declared during an active half');
    if (state.periodState.addedTime.sealedSeconds != null) throw new Error('added time is already sealed');
    const declared = nonNegativeNumber(seconds, 0, 'added time seconds');
    if (declared > state.config.maximumAddedTimeSeconds) throw new Error('added time exceeds configured maximum');
    const next = cloneState(state);
    next.periodState.addedTime.manualSeconds = declared;
    recordInPlace(next, 'added-time-declared', {
      seconds: declared,
      reason: String(details.reason || 'manual-declaration')
    });
    return next;
  }

  function roundAddedTime(candidate, config) {
    const quantum = config.addedTimeRoundingSeconds;
    const ratio = candidate / quantum;
    let units = Math.round(ratio);
    if (config.addedTimeRoundingMode === 'ceil') units = Math.ceil(ratio);
    if (config.addedTimeRoundingMode === 'floor') units = Math.floor(ratio);
    return clamp(units * quantum, 0, config.maximumAddedTimeSeconds);
  }

  function sealAddedTimeInPlace(state) {
    const added = state.periodState.addedTime;
    if (added.sealedSeconds != null) return;
    const source = added.manualSeconds == null
      ? roundAddedTime(added.candidateSeconds, state.config)
      : added.manualSeconds;
    added.sealedSeconds = clamp(source, 0, state.config.maximumAddedTimeSeconds);
    added.sealedAtTick = state.tick;
    recordInPlace(state, 'added-time-sealed', {
      candidateSeconds: rounded(added.candidateSeconds),
      manualSeconds: added.manualSeconds,
      sealedSeconds: added.sealedSeconds
    });
  }

  function currentPeriodTarget(state) {
    const added = state.periodState.addedTime;
    return state.periodState.baseTargetSeconds
      + finite(added.sealedSeconds, 0)
      + finite(added.postSealSeconds, 0);
  }

  function periodSummary(state) {
    const summary = clone(state.periodState);
    summary.completedTick = state.tick;
    summary.totalTargetSeconds = currentPeriodTarget(state);
    return summary;
  }

  function completePeriodInPlace(state) {
    const completedPeriod = state.period;
    const summary = periodSummary(state);
    closeStoppageInPlace(state, 'period-complete');
    if (completedPeriod === 'first-half') {
      state.firstHalf = summary;
      state.period = 'half-time';
      state.phase = 'presentation';
    } else {
      state.secondHalf = summary;
      state.period = 'full-time';
      state.phase = 'presentation';
    }
    state.resumePhase = null;
    recordInPlace(state, 'period-complete', {
      completedPeriod,
      gameplaySeconds: rounded(summary.gameplaySeconds),
      sealedAddedTimeSeconds: summary.addedTime.sealedSeconds,
      postSealAddedTimeSeconds: rounded(summary.addedTime.postSealSeconds)
    });
  }

  function addGameplayInPlace(state, seconds) {
    if (!(seconds > 0)) return;
    state.periodState.gameplaySeconds += seconds;
    state.totalGameplaySeconds += seconds;
  }

  function advanceLiveGameplayInPlace(state, gameplayBudget, periodEndBlocked) {
    let remainingBudget = gameplayBudget;
    const periodState = state.periodState;
    const epsilon = 1e-10;

    if (periodState.addedTime.sealedSeconds == null) {
      const toBase = Math.max(0, periodState.baseTargetSeconds - periodState.gameplaySeconds);
      const regulationAdvance = Math.min(remainingBudget, toBase);
      addGameplayInPlace(state, regulationAdvance);
      remainingBudget -= regulationAdvance;
      if (periodState.gameplaySeconds + epsilon >= periodState.baseTargetSeconds) {
        periodState.gameplaySeconds = periodState.baseTargetSeconds;
        sealAddedTimeInPlace(state);
      }
    }

    if (remainingBudget > epsilon && activePeriod(state.period)) {
      const target = currentPeriodTarget(state);
      const available = Math.max(0, target - state.periodState.gameplaySeconds);
      const addedAdvance = Math.min(remainingBudget, available);
      addGameplayInPlace(state, addedAdvance);
      remainingBudget -= addedAdvance;
    }

    if (activePeriod(state.period)
      && state.periodState.addedTime.sealedSeconds != null
      && state.periodState.gameplaySeconds + epsilon >= currentPeriodTarget(state)) {
      if (periodEndBlocked) {
        periodState.completionPending = true;
        // Continue real live football while the already-started action ends.
        // Never rewind or freeze the simulation clock used by contact locks.
        if (remainingBudget > epsilon) {
          periodState.addedTime.postSealSeconds += remainingBudget;
          addGameplayInPlace(state, remainingBudget);
        }
      } else {
        state.periodState.gameplaySeconds = currentPeriodTarget(state);
        completePeriodInPlace(state);
      }
    }
  }

  function accrueStoppageInPlace(state, dt) {
    const stoppage = state.activeStoppage;
    if (!stoppage) {
      startStoppageInPlace(state, { reason: state.phase });
    }
    const active = state.activeStoppage;
    active.realSeconds += dt;
    const credit = dt * active.addedTimeWeight;
    active.addedTimeCandidateSeconds += credit;
    const added = state.periodState.addedTime;
    if (added.sealedSeconds == null) {
      added.candidateSeconds = Math.min(
        state.config.maximumAddedTimeSeconds,
        added.candidateSeconds + credit
      );
    } else {
      const maximumPostSeal = Math.max(0, state.config.maximumAddedTimeSeconds - added.sealedSeconds);
      added.postSealSeconds = Math.min(maximumPostSeal, added.postSealSeconds + credit);
    }
  }

  function advance(state, tickCount, options) {
    assertState(state);
    if (!Number.isInteger(tickCount) || tickCount < 0) throw new Error('tickCount must be a non-negative integer');
    const periodEndBlocked = options && options.periodEndBlocked === true;
    if (options && options.periodEndBlocked != null && typeof options.periodEndBlocked !== 'boolean')
      throw new TypeError('periodEndBlocked must be a boolean');
    const next = cloneState(state);
    const dt = next.config.fixedTickSeconds;
    for (let index = 0; index < tickCount; index += 1) {
      next.tick += 1;
      next.simulationElapsedSeconds += dt;

      if (next.phase === 'paused') {
        next.pausedElapsedSeconds += dt;
        continue;
      }

      next.animationElapsedSeconds += dt;
      if (!activePeriod(next.period)) {
        next.presentationElapsedSeconds += dt;
        continue;
      }

      if (next.periodState.completionPending && !periodEndBlocked) {
        completePeriodInPlace(next);
        next.presentationElapsedSeconds += dt;
        continue;
      }
      if (next.phase === 'live') {
        next.periodState.liveRealSeconds += dt;
        next.totalLiveRealSeconds += dt;
        advanceLiveGameplayInPlace(next, dt * next.config.acceleration, periodEndBlocked);
      } else if (stoppedPhase(next.phase)) {
        next.periodState.stoppedRealSeconds += dt;
        next.totalStoppedRealSeconds += dt;
        if (next.periodState.completionPending) {
          // The period is already due. Finishing a referee/replay scene earns
          // no fresh playing budget, but its real elapsed time remains recorded.
          if (!next.activeStoppage) startStoppageInPlace(next, { reason: next.phase });
          next.activeStoppage.realSeconds += dt;
        } else accrueStoppageInPlace(next, dt);
      }
    }
    return next;
  }

  // An illegal roster is a distinct terminal result, never a played90minutes.
  function abandonMatch(state, meta) {
    assertState(state);const source=meta||{};assertTransitionTick(state,source);
    if(state.period==='full-time')throw new Error('the match is already terminal');
    if(state.phase==='paused')throw new Error('resume before abandoning the match');
    if(typeof source.teamId!=='string'||!source.teamId||!Number.isInteger(source.remainingPlayers)||
        source.remainingPlayers<0||source.remainingPlayers>=7)throw new TypeError('abandonment requires a named team with fewer than seven players');
    const next=cloneState(state),period=next.period;
    closeStoppageInPlace(next,'match-abandoned');
    next.abandonment={teamId:source.teamId,remainingPlayers:source.remainingPlayers,minimumPlayers:7,
      reason:'insufficient-players',period,tick:next.tick,gameplaySeconds:next.totalGameplaySeconds};
    next.period='full-time';next.phase='presentation';next.resumePhase=null;
    recordInPlace(next,'match-abandoned',next.abandonment);return next;
  }

  function startSecondHalf(state, meta) {
    assertState(state);
    const details = meta || {};
    assertTransitionTick(state, details);
    if (state.period !== 'half-time') throw new Error('second half can only start from half-time');
    if (state.phase === 'paused') throw new Error('resume before starting the second half');
    const next = cloneState(state);
    const from = next.phase;
    next.period = 'second-half';
    next.phase = details.initialPhase || 'dead-ball';
    if (!PHASES.includes(next.phase) || next.phase === 'paused') throw new Error('invalid second-half initial phase');
    next.resumePhase = null;
    next.periodState = createPeriodState('second-half', next.config);
    next.activeStoppage = null;
    if (stoppedPhase(next.phase)) {
      startStoppageInPlace(next, {
        reason: details.reason || 'second-half-pre-kickoff',
        eligibleForAddedTime: details.eligibleForAddedTime === true,
        addedTimeWeight: details.addedTimeWeight
      });
    }
    recordInPlace(next, 'second-half-started', { from, initialPhase: next.phase });
    return next;
  }

  function transition(state, event) {
    if (!event || typeof event !== 'object') throw new Error('transition event must be an object');
    if (event.schema != null && event.schema !== EVENT_SCHEMA) throw new Error(`event schema must be ${EVENT_SCHEMA}`);
    if (event.type === 'enter-phase') return enterPhase(state, event.phase, event);
    if (event.type === 'pause') return pause(state, event);
    if (event.type === 'resume') return resume(state, event);
    if (event.type === 'declare-added-time') return declareAddedTime(state, event.seconds, event);
    if (event.type === 'start-second-half') return startSecondHalf(state, event);
    throw new Error(`unknown MatchClock V2 transition ${event.type}`);
  }

  function runTimeline(state, segments) {
    assertState(state);
    if (!Array.isArray(segments)) throw new Error('segments must be an array');
    let current = cloneState(state);
    segments.forEach((segment, index) => {
      if (!segment || typeof segment !== 'object') throw new Error(`segment ${index} must be an object`);
      if (segment.event) current = transition(current, { ...segment.event, tick: current.tick });
      if (segment.phase && current.phase !== segment.phase) {
        current = enterPhase(current, segment.phase, {
          tick: current.tick,
          reason: segment.reason,
          eligibleForAddedTime: segment.eligibleForAddedTime,
          addedTimeWeight: segment.addedTimeWeight
        });
      }
      if (segment.ticks != null) current = advance(current, segment.ticks);
    });
    return current;
  }

  function displayClock(state) {
    const halfBase = state.config.baseHalfGameplaySeconds;
    const periodSeconds = state.periodState.gameplaySeconds;
    const displaySeconds = state.period === 'second-half' || state.period === 'full-time'&&(!state.abandonment||state.periodState.id==='second-half')
      ? halfBase + periodSeconds
      : periodSeconds;
    const safeSeconds = Math.max(0, displaySeconds);
    const minute = Math.floor(safeSeconds / 60);
    const second = Math.floor(safeSeconds % 60);
    const added = state.periodState.addedTime;
    const displayedAddedSeconds = finite(added.sealedSeconds, 0);
    return {
      footballSeconds: rounded(safeSeconds),
      minute,
      second,
      text: `${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`,
      addedTimeSeconds: rounded(displayedAddedSeconds),
      addedTimeMinutes: rounded(displayedAddedSeconds / 60, 3),
      postSealAddedTimeSeconds: rounded(added.postSealSeconds),
      indicator: displayedAddedSeconds > 0 ? `+${rounded(displayedAddedSeconds / 60, 3)}` : ''
    };
  }

  function snapshot(state) {
    assertState(state);
    const added = state.periodState.addedTime;
    const baseReached = state.periodState.gameplaySeconds >= state.periodState.baseTargetSeconds - 1e-10;
    return {
      schema: OUTPUT_SCHEMA,
      version: VERSION,
      tick: state.tick,
      period: state.period,
      phase: state.phase,
      ...(state.abandonment?{abandonment:clone(state.abandonment)}:{}),
      display: displayClock(state),
      clocks: {
        gameplaySeconds: rounded(state.totalGameplaySeconds),
        periodGameplaySeconds: rounded(state.periodState.gameplaySeconds),
        simulationElapsedSeconds: rounded(state.simulationElapsedSeconds),
        animationElapsedSeconds: rounded(state.animationElapsedSeconds),
        pausedElapsedSeconds: rounded(state.pausedElapsedSeconds),
        presentationElapsedSeconds: rounded(state.presentationElapsedSeconds),
        liveRealSeconds: rounded(state.totalLiveRealSeconds),
        stoppedRealSeconds: rounded(state.totalStoppedRealSeconds)
      },
      addedTime: {
        candidateSeconds: rounded(added.candidateSeconds),
        manualSeconds: added.manualSeconds,
        sealedSeconds: added.sealedSeconds,
        postSealSeconds: rounded(added.postSealSeconds),
        totalSeconds: rounded(finite(added.sealedSeconds, 0) + added.postSealSeconds),
        sealedAtTick: added.sealedAtTick
      },
      gates: {
        baseReached,
        addedTimeSealed: added.sealedSeconds != null,
        halfTime: state.period === 'half-time',
        canStartSecondHalf: state.period === 'half-time' && state.phase !== 'paused',
        fullTime: state.period === 'full-time'&&!state.abandonment,
        ...(state.abandonment?{abandoned:true}:{})
      },
      telemetry: {
        schema: TELEMETRY_SCHEMA,
        tick: state.tick,
        period: state.period,
        phase: state.phase,
        activeStoppage: clone(state.activeStoppage),
        completedStoppages: frozenCopy(state.stoppages),
        history: frozenCopy(state.history)
      }
    };
  }

  function stableTelemetryJson(state) {
    return stableJson(snapshot(state).telemetry);
  }

  return Object.freeze({
    VERSION,
    STATE_SCHEMA,
    EVENT_SCHEMA,
    OUTPUT_SCHEMA,
    TELEMETRY_SCHEMA,
    ACTIVE_PERIODS,
    STOPPED_PHASES,
    PHASES,
    DEFAULT_CONFIG,
    DEFAULT_ADDED_TIME_WEIGHTS,
    createState,
    validateState,
    enterPhase,
    pause,
    resume,
    declareAddedTime,
    startSecondHalf,
    abandonMatch,
    transition,
    advance,
    step(state) {
      return advance(state, 1);
    },
    runTimeline,
    displayClock,
    snapshot,
    stableTelemetryJson,
    stableJson
  });
});
