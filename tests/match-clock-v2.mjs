import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modulePath = path.join(root, 'match-engine', 'match-clock-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Clock = require(modulePath);

function fast(options = {}) {
  return Clock.createState({
    fixedTickSeconds: 1,
    acceleration: 60,
    initialPhase: 'live',
    ...options
  });
}

function enter(state, phase, extra = {}) {
  return Clock.enterPhase(state, phase, { tick: state.tick, reason: `test-${phase}`, ...extra });
}

function playFirstHalf(state) {
  return Clock.advance(state, 45);
}

test('CommonJS module exposes the complete dormant MatchClock V2 API', () => {
  assert.equal(Clock.VERSION, '2.0.0-dormant');
  assert.equal(Clock.STATE_SCHEMA, 'football-legacy-match-clock-state-v2');
  assert.equal(Clock.EVENT_SCHEMA, 'football-legacy-match-clock-event-v2');
  assert.equal(Clock.OUTPUT_SCHEMA, 'football-legacy-match-clock-output-v2');
  assert.equal(Clock.TELEMETRY_SCHEMA, 'football-legacy-match-clock-telemetry-v2');
  for (const name of [
    'createState', 'validateState', 'enterPhase', 'pause', 'resume',
    'declareAddedTime', 'startSecondHalf', 'transition', 'advance', 'step',
    'runTimeline', 'displayClock', 'snapshot', 'stableTelemetryJson'
  ]) assert.equal(typeof Clock[name], 'function', `${name} must be exported`);
});

test('plain browser script exposes window.FootballLegacyMatchClockV2', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow });
  const browserApi = browserWindow.FootballLegacyMatchClockV2;
  assert.equal(browserApi.VERSION, Clock.VERSION);
  assert.equal(typeof browserApi.advance, 'function');
  assert.deepEqual(Array.from(browserApi.STOPPED_PHASES), Array.from(Clock.STOPPED_PHASES));
});

test('EXACT-FLAG AUTHORITY GATE: Build 173 has no unconditional MatchClock V2 load or live call', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']match-clock-v2\.js/i);
  assert.doesNotMatch(matchHtml, /FootballLegacyMatchClockV2/);
  assert.match(source, /intentionally dormant/i);
  assert.match(source, /Build 173 remains the sole live[\s*]+authority/i);
});

test('determinism gate: module has no random, wall-clock, RAF or timer authority', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /new\s+Date\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('configuration derives acceleration from intended real match duration', () => {
  const state = Clock.createState({ realMatchDurationSeconds: 540, initialPhase: 'live' });
  assert.equal(state.config.acceleration, 10);
  assert.equal(state.config.fixedTickSeconds, 1 / 60);
  assert.equal(state.config.baseHalfGameplaySeconds, 2700);
  assert.equal(Clock.validateState(state).valid, true);
});

test('FIXED-TICK AUTHORITY: live play advances animation and accelerated football time only by whole ticks', () => {
  const start = fast();
  const one = Clock.step(start);
  assert.equal(one.tick, 1);
  assert.equal(one.simulationElapsedSeconds, 1);
  assert.equal(one.animationElapsedSeconds, 1);
  assert.equal(one.periodState.liveRealSeconds, 1);
  assert.equal(one.periodState.gameplaySeconds, 60);
  assert.equal(one.totalGameplaySeconds, 60);
  assert.throws(() => Clock.advance(start, 0.5), /tickCount/);
  assert.throws(() => Clock.advance(start, -1), /tickCount/);
});

test('ALL STOPPED-PHASE GATE: every required stoppage uses real animation time without advancing gameplay', () => {
  let state = fast();
  state = Clock.advance(state, 2);
  const gameplayBefore = state.totalGameplaySeconds;
  const animationBefore = state.animationElapsedSeconds;
  for (const phase of Clock.STOPPED_PHASES) {
    state = enter(state, phase);
    state = Clock.advance(state, 2);
  }
  assert.equal(state.totalGameplaySeconds, gameplayBefore);
  assert.equal(state.animationElapsedSeconds, animationBefore + Clock.STOPPED_PHASES.length * 2);
  assert.equal(state.totalStoppedRealSeconds, Clock.STOPPED_PHASES.length * 2);
  assert.equal(state.periodState.addedTime.candidateSeconds, Clock.STOPPED_PHASES.length * 2);
  assert.deepEqual(state.stoppages.map(row => row.phase), Clock.STOPPED_PHASES.slice(0, -1));
  assert.equal(state.activeStoppage.phase, 'presentation');
});

test('phase transitions are explicit, tick-matched and telemetry-backed', () => {
  const start = fast();
  assert.throws(() => Clock.enterPhase(start, 'dead-ball', { tick: 1 }), /authoritative tick/);
  assert.throws(() => Clock.enterPhase(start, 'unknown', { tick: 0 }), /unknown match phase/);
  const stopped = Clock.transition(start, {
    schema: Clock.EVENT_SCHEMA,
    type: 'enter-phase',
    tick: 0,
    phase: 'set-piece',
    reason: 'free-kick-awarded'
  });
  assert.equal(stopped.phase, 'set-piece');
  assert.equal(stopped.activeStoppage.reason, 'free-kick-awarded');
  assert.ok(stopped.history.some(event => event.type === 'phase-transition'));
});

test('PAUSE GATE: pause consumes simulation ticks only and resume restores the exact phase', () => {
  let state = Clock.advance(fast(), 5);
  state = Clock.pause(state, { tick: state.tick, reason: 'pause-menu' });
  state = Clock.advance(state, 10);
  assert.equal(state.tick, 15);
  assert.equal(state.simulationElapsedSeconds, 15);
  assert.equal(state.animationElapsedSeconds, 5);
  assert.equal(state.pausedElapsedSeconds, 10);
  assert.equal(state.totalGameplaySeconds, 300);
  assert.equal(state.phase, 'paused');
  assert.equal(state.resumePhase, 'live');
  state = Clock.resume(state, { tick: state.tick });
  state = Clock.step(state);
  assert.equal(state.phase, 'live');
  assert.equal(state.totalGameplaySeconds, 360);
});

test('pausing a stoppage preserves its identity and excludes paused duration from animation and added time', () => {
  let state = enter(fast(), 'var');
  state = Clock.advance(state, 4);
  const id = state.activeStoppage.id;
  state = Clock.pause(state, { tick: state.tick });
  state = Clock.advance(state, 20);
  state = Clock.resume(state, { tick: state.tick });
  state = Clock.advance(state, 6);
  assert.equal(state.activeStoppage.id, id);
  assert.equal(state.activeStoppage.realSeconds, 10);
  assert.equal(state.periodState.addedTime.candidateSeconds, 10);
  assert.equal(state.pausedElapsedSeconds, 20);
  assert.equal(state.animationElapsedSeconds, 10);
});

test('ADDED-TIME GATE: stoppage candidate seals at the base target and extends the half', () => {
  let state = fast();
  state = enter(state, 'substitution');
  state = Clock.advance(state, 60);
  state = enter(state, 'live');
  state = playFirstHalf(state);
  assert.equal(state.period, 'first-half');
  assert.equal(state.periodState.gameplaySeconds, 2700);
  assert.equal(state.periodState.addedTime.candidateSeconds, 60);
  assert.equal(state.periodState.addedTime.sealedSeconds, 60);
  assert.equal(Clock.snapshot(state).display.indicator, '+1');
  state = Clock.step(state);
  assert.equal(state.period, 'half-time');
  assert.equal(state.firstHalf.totalTargetSeconds, 2760);
  assert.equal(Clock.snapshot(state).display.text, '46:00');
});

test('manual added-time declaration deterministically overrides the rounded candidate before sealing', () => {
  let state = fast();
  state = enter(state, 'card');
  state = Clock.advance(state, 10);
  state = enter(state, 'live');
  state = Clock.declareAddedTime(state, 120, { tick: state.tick, reason: 'referee-board' });
  state = Clock.advance(state, 45);
  assert.equal(state.periodState.addedTime.candidateSeconds, 10);
  assert.equal(state.periodState.addedTime.manualSeconds, 120);
  assert.equal(state.periodState.addedTime.sealedSeconds, 120);
  assert.equal(state.period, 'first-half');
  state = Clock.advance(state, 2);
  assert.equal(state.period, 'half-time');
  assert.equal(state.firstHalf.gameplaySeconds, 2820);
  assert.throws(() => Clock.declareAddedTime(state, 60), /active half/);
});

test('stoppage during displayed added time accrues deterministic post-seal extension', () => {
  let state = fast();
  state = enter(state, 'var');
  state = Clock.advance(state, 60);
  state = enter(state, 'live');
  state = Clock.advance(state, 45);
  assert.equal(state.periodState.addedTime.sealedSeconds, 60);
  state = enter(state, 'dead-ball');
  state = Clock.advance(state, 10);
  assert.equal(state.periodState.addedTime.postSealSeconds, 10);
  state = enter(state, 'live');
  state = Clock.step(state);
  assert.equal(state.period, 'first-half', 'ten extra seconds prevent the original +1 target ending this tick');
  state = Clock.step(state);
  assert.equal(state.period, 'half-time');
  assert.equal(state.firstHalf.totalTargetSeconds, 2770);
  assert.equal(state.firstHalf.addedTime.postSealSeconds, 10);
});

test('per-phase added-time policy can exclude or weight animation time without affecting the gameplay freeze', () => {
  let state = fast({ addedTimeWeights: { replay: 0, var: 0.5 } });
  state = enter(state, 'replay');
  state = Clock.advance(state, 20);
  state = enter(state, 'var');
  state = Clock.advance(state, 20);
  assert.equal(state.totalGameplaySeconds, 0);
  assert.equal(state.totalStoppedRealSeconds, 40);
  assert.equal(state.periodState.addedTime.candidateSeconds, 10);
  assert.equal(state.stoppages[0].eligibleForAddedTime, false);
  assert.equal(state.activeStoppage.addedTimeWeight, 0.5);
});

test('FIRST-HALF GATE: half-time is explicit and second half cannot start early', () => {
  const start = fast();
  assert.throws(() => Clock.startSecondHalf(start), /only start from half-time/);
  let state = playFirstHalf(start);
  assert.equal(state.period, 'half-time');
  assert.equal(state.phase, 'presentation');
  assert.equal(Clock.snapshot(state).gates.canStartSecondHalf, true);
  const gameBefore = state.totalGameplaySeconds;
  state = Clock.advance(state, 20);
  assert.equal(state.totalGameplaySeconds, gameBefore);
  assert.equal(state.presentationElapsedSeconds, 20);
  state = Clock.startSecondHalf(state, { tick: state.tick });
  assert.equal(state.period, 'second-half');
  assert.equal(state.phase, 'dead-ball');
  assert.equal(state.periodState.gameplaySeconds, 0);
  assert.equal(state.activeStoppage.addedTimeWeight, 0, 'pre-kickoff presentation is not added time');
});

test('SECOND-HALF/FULL-TIME GATE: a complete match reaches full time exactly once', () => {
  let state = playFirstHalf(fast());
  state = Clock.startSecondHalf(state, { tick: state.tick, initialPhase: 'live' });
  state = Clock.advance(state, 45);
  const output = Clock.snapshot(state);
  assert.equal(state.period, 'full-time');
  assert.equal(state.phase, 'presentation');
  assert.equal(state.totalGameplaySeconds, 5400);
  assert.equal(output.display.text, '90:00');
  assert.equal(output.gates.fullTime, true);
  assert.equal(state.history.filter(event => event.type === 'period-complete').length, 2);
  const before = state.totalGameplaySeconds;
  state = Clock.advance(state, 100);
  assert.equal(state.totalGameplaySeconds, before);
  assert.equal(state.presentationElapsedSeconds, 100);
});

test('second-half display restarts from 45:00 even when the first half contained added time', () => {
  let state = Clock.declareAddedTime(fast(), 60, { tick: 0 });
  state = Clock.advance(state, 46);
  assert.equal(state.period, 'half-time');
  assert.equal(Clock.snapshot(state).display.text, '46:00');
  state = Clock.startSecondHalf(state, { tick: state.tick, initialPhase: 'live' });
  assert.equal(Clock.snapshot(state).display.text, '45:00');
  state = Clock.step(state);
  assert.equal(Clock.snapshot(state).display.text, '46:00');
  assert.equal(state.totalGameplaySeconds, 2820, 'authoritative played time still retains first-half added time');
});

test('FRAME-CHUNK INVARIANCE: identical fixed-tick work is byte-identical across frame chunks', () => {
  const start = Clock.createState({ fixedTickSeconds: 1 / 60, acceleration: 15, initialPhase: 'live' });
  const oneChunk = Clock.advance(start, 2400);
  const chunks = [1, 7, 13, 59, 120, 600, 800, 800];
  let manyChunks = start;
  for (const count of chunks) manyChunks = Clock.advance(manyChunks, count);
  assert.equal(chunks.reduce((sum, value) => sum + value, 0), 2400);
  assert.deepEqual(manyChunks, oneChunk);
  assert.equal(Clock.stableTelemetryJson(manyChunks), Clock.stableTelemetryJson(oneChunk));
});

test('timeline helper is equivalent to explicit transition/advance composition', () => {
  const start = fast();
  const segments = [
    { ticks: 5 },
    { phase: 'dead-ball', ticks: 3, reason: 'throw-in' },
    { event: { type: 'pause' }, ticks: 4 },
    { event: { type: 'resume' }, ticks: 2 },
    { phase: 'live', ticks: 6 }
  ];
  const viaTimeline = Clock.runTimeline(start, segments);
  let explicit = Clock.advance(start, 5);
  explicit = enter(explicit, 'dead-ball', { reason: 'throw-in' });
  explicit = Clock.advance(explicit, 3);
  explicit = Clock.pause(explicit, { tick: explicit.tick });
  explicit = Clock.advance(explicit, 4);
  explicit = Clock.resume(explicit, { tick: explicit.tick });
  explicit = Clock.advance(explicit, 2);
  explicit = Clock.enterPhase(explicit, 'live', { tick: explicit.tick });
  explicit = Clock.advance(explicit, 6);
  assert.deepEqual(viaTimeline, explicit);
});

test('snapshot and stable telemetry are deterministic, JSON-safe and non-mutating', () => {
  let state = enter(fast(), 'offside-presentation');
  state = Clock.advance(state, 7);
  const before = JSON.stringify(state);
  const first = Clock.snapshot(state);
  const second = Clock.snapshot(state);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(Clock.stableTelemetryJson(state), Clock.stableTelemetryJson(state));
  assert.match(Clock.stableTelemetryJson(state), /football-legacy-match-clock-telemetry-v2/);
});

test('safety validation rejects malformed state and impossible configuration', () => {
  const valid = fast();
  const malformed = JSON.parse(JSON.stringify(valid));
  malformed.tick = 1.5;
  malformed.totalGameplaySeconds = Number.NaN;
  const result = Clock.validateState(malformed);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /tick/);
  assert.match(result.errors.join(' '), /totalGameplaySeconds/);
  assert.throws(() => Clock.advance(malformed, 1), /invalid MatchClock V2 state/);
  assert.throws(() => Clock.createState({ fixedTickSeconds: 0 }), /fixedTickSeconds/);
  assert.throws(() => Clock.createState({ acceleration: -1 }), /acceleration/);
  assert.throws(() => Clock.createState({ addedTimeRoundingMode: 'chaos' }), /RoundingMode/);
});

test('trace bounding is deterministic and does not alter clock authority', () => {
  let state = fast({ maximumTraceEntries: 5 });
  for (let index = 0; index < 12; index += 1) {
    state = enter(state, index % 2 === 0 ? 'dead-ball' : 'live');
    state = Clock.step(state);
  }
  assert.ok(state.history.length <= 5);
  assert.ok(state.stoppages.length <= 5);
  assert.equal(Clock.validateState(state).valid, true);
  assert.ok(Number.isFinite(state.totalGameplaySeconds));
});
