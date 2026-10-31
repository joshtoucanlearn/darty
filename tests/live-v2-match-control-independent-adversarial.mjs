import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Control = require('../match-engine/live-v2-match-control-composition.js');

const HASHES = Object.freeze({
  'match-clock-v2.js': '77249cadbccf83169b25741e9ee7ad704ef8dc751cb12e0960f09b3c97e3dea8',
  'restart-presentation-v2.js': '1d6e6c17c240152f2279a96f69431b9cf4ff38954b35a50a87e063704ebbf54c',
  'set-piece-suite-v2.js': 'ac49f9edce6120bfccf0c4f4f1462a0db57bdbe23a54711c7582ee38a632fcb0',
  'set-piece-coordinate-contract-v2.js': '7f5226aba8a58a4132501c3519820a536b921a6344bca99e65d2e49ec87247e0',
  'live-v2-match-control-composition.js': '406124352ab2550d03da2b845c34c79f2f426a26028639dc390bd0bfac4fa7e6'
});

function sha(file) {
  return crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(root, 'match-engine', file)))
    .digest('hex');
}

function capability(workflow = 'single-player') {
  return Control.createCapability({
    enabled: true,
    workflow,
    online: false,
    requestedEngine: 'fl-v2',
    effectiveEngine: 'fl-v2',
    engineVersion: Control.LIVE_ENGINE_VERSION,
    fallbackEngine: 'build-173',
    acknowledgement: Control.ACKNOWLEDGEMENT
  });
}

function options(sessionId, extra = {}) {
  return {
    sessionId,
    pitch: {
      units: 'metres',
      coordinateSystem: 'si-metres-world-x-length-y-width-z-up',
      axisAlignment: 'axis-aligned',
      xMin: 0,
      xMax: 105,
      yMin: 0,
      yMax: 68
    },
    ...extra
  };
}

function input(tick, phase, workflow = 'single-player', extra = {}) {
  return {
    schema: Control.TICK_INPUT_SCHEMA,
    tick,
    workflow,
    online: false,
    requestedEngine: 'fl-v2',
    effectiveEngine: 'fl-v2',
    engineVersion: Control.LIVE_ENGINE_VERSION,
    hostPhase: phase,
    ...extra
  };
}

function receipt(plan, extra = {}) {
  return {
    schema: Control.RECEIPT_SCHEMA,
    planId: plan.planId,
    tick: plan.tick,
    success: true,
    clockAccepted: true,
    legacyClockAdvanced: false,
    appliedCommandIds: plan.requiredCommandIds,
    ...extra
  };
}

function commit(runtime, cap, plan, extra = {}) {
  return Control.commit(runtime, plan, receipt(plan, extra), cap);
}

function incident(eventId = 'offside-1') {
  return {
    eventId,
    pitchHeight: 68,
    position: { x: 18, y: 10 },
    assistantRefs: [
      { id: 'assistant-north', touchline: 'north', x: 16, y: 0 },
      { id: 'assistant-south', touchline: 'south', x: 16, y: 68 }
    ],
    attackingTeam: 'home',
    defendingTeam: 'away',
    takerOwner: 'cpu',
    goalkeeperOwner: 'cpu'
  };
}

test('review pins the exact composition and all four lower contracts', () => {
  for (const [file, expected] of Object.entries(HASHES)) assert.equal(sha(file), expected, file);
  assert.equal(Control.ACKNOWLEDGEMENT, 'EXPLICIT_FL_V2_OFFLINE_MATCH_CONTROL');
  assert.deepEqual(Control.WORKFLOWS, ['single-player', 'cpu-v-cpu', 'set-piece-suite']);
  assert.equal(Control.FIXED_TICK_SECONDS, 1 / 60);
  assert.equal(Control.MAX_LEDGER, 1024);
});

test('factory provenance and approved offline workflows fail closed', () => {
  for (const workflow of ['online-versus', 'home-co-op', 'local-co-op']) {
    assert.throws(() => capability(workflow), /approved offline/);
  }
  const cap = capability();
  const forged = JSON.parse(JSON.stringify(cap));
  assert.throws(() => Control.createRuntime(options('forged'), forged), /issued/);
  const runtime = Control.createRuntime(options('single'), cap);
  const otherCap = capability('set-piece-suite');
  assert.throws(() => Control.snapshot(runtime, otherCap), /matching issued/);
  const cpuCap = capability('cpu-v-cpu');
  const cpuRuntime = Control.createRuntime(options('cpu-v-cpu'), cpuCap);
  const cpuPlan = Control.prepareTick(cpuRuntime, input(1, 'live', 'cpu-v-cpu'), cpuCap);
  assert.equal(cpuPlan.effectiveEngine, 'fl-v2');
  assert.equal(cpuPlan.workflow, 'cpu-v-cpu');
  assert.equal(commit(cpuRuntime, cpuCap, cpuPlan).workflow, 'cpu-v-cpu');
  assert.equal(Control.snapshot(cpuRuntime, cpuCap).restart.workflow, 'cpu-v-cpu');
});

test('clock phases and one transaction exclude every legacy clock advance', () => {
  const cap = capability();
  const runtime = Control.createRuntime(options('clock', { realMatchDurationSeconds: 240 }), cap);
  let plan = Control.prepareTick(runtime, input(1, 'live'), cap);
  assert.equal(plan.clock.clocks.gameplaySeconds, 0.375);
  assert.equal(Control.snapshot(runtime, cap).committedTick, 0);
  assert.equal(Control.prepareTick(runtime, input(1, 'live'), cap), plan);
  let snapshot = commit(runtime, cap, plan);
  assert.equal(snapshot.committedTick, 1);
  assert.equal(Control.commit(runtime, plan, receipt(plan), cap).committedTick, 1);

  plan = Control.prepareTick(runtime, input(2, 'dead-ball'), cap);
  assert.equal(plan.clock.clocks.gameplaySeconds, 0.375);
  assert.equal(plan.clock.clocks.animationElapsedSeconds, 0.033333);
  commit(runtime, cap, plan);
  plan = Control.prepareTick(runtime, input(3, 'paused'), cap);
  assert.equal(plan.clock.clocks.gameplaySeconds, 0.375);
  assert.equal(plan.clock.clocks.animationElapsedSeconds, 0.033333);
  assert.equal(plan.clock.clocks.pausedElapsedSeconds, 0.016667);

  const dualCap = capability();
  const dual = Control.createRuntime(options('dual'), dualCap);
  const dualPlan = Control.prepareTick(dual, input(1, 'live'), dualCap);
  snapshot = commit(dual, dualCap, dualPlan, { legacyClockAdvanced: true });
  assert.equal(snapshot.effectiveEngine, 'build-173');
  assert.equal(snapshot.committedTick, 0);
});

test('abort is exact retry while host failure and rollback are permanent failback', () => {
  const abortCap = capability();
  const abortRuntime = Control.createRuntime(options('abort'), abortCap);
  const before = Control.snapshot(abortRuntime, abortCap);
  let plan = Control.prepareTick(abortRuntime, input(1, 'live'), abortCap);
  assert.deepEqual(Control.abortPrepared(abortRuntime, plan, abortCap), before);
  plan = Control.prepareTick(abortRuntime, input(1, 'live'), abortCap);
  assert.equal(commit(abortRuntime, abortCap, plan).committedTick, 1);

  const failCap = capability();
  const failRuntime = Control.createRuntime(options('failure'), failCap);
  plan = Control.prepareTick(failRuntime, input(1, 'live'), failCap);
  let snapshot = commit(failRuntime, failCap, plan, { appliedCommandIds: ['not-required'] });
  assert.equal(snapshot.effectiveEngine, 'build-173');
  assert.equal(snapshot.fallbackReason, 'match-control-host-commit-failed');
  assert.equal(Control.prepareTick(failRuntime, input(2, 'live'), failCap).effectiveEngine, 'build-173');

  const rollbackCap = capability();
  const rollbackRuntime = Control.createRuntime(options('rollback'), rollbackCap);
  plan = Control.prepareTick(rollbackRuntime, input(1, 'live'), rollbackCap);
  snapshot = Control.rollback(rollbackRuntime, plan, 'outer-host-apply-failed', rollbackCap);
  assert.equal(snapshot.effectiveEngine, 'build-173');
  assert.equal(snapshot.committedTick, 0);
});

test('offside presentation uses the existing assistant then hands off before release exactly once', () => {
  const cap = capability();
  const runtime = Control.createRuntime(options('offside'), cap);
  const commands = [];
  for (let tick = 1; tick <= 95; tick += 1) {
    const plan = Control.prepareTick(runtime, input(tick, 'offside-presentation', 'single-player', {
      ...(tick === 1 ? { restartIncident: incident() } : {})
    }), cap);
    commands.push(...plan.commands);
    commit(runtime, cap, plan);
  }
  assert.deepEqual(commands.map(command => command.tick), [1, 2, 8, 9, 39, 51, 93, 93, 93, 93]);
  assert.equal(commands.filter(command => command.type === 'restart.free-kick.handoff').length, 1);
  assert.equal(commands.find(command => command.type === 'assistant-referee.select')
    .payload.sourcePayload.actorId, 'assistant-north');
  const handoff = commands.findIndex(command => command.type === 'restart.free-kick.handoff');
  const release = commands.findIndex(command => command.type === 'gameplay.freeze' &&
    command.payload.sourcePayload.frozen === false);
  assert.ok(handoff >= 0 && release > handoff);
  const snapshot = Control.snapshot(runtime, cap);
  assert.equal(snapshot.clock.clocks.gameplaySeconds, 0);
  assert.equal(snapshot.restart.phase, 'complete');
});

test('Set-Piece Suite menu and D-pad shortcut are live composer routes, not dormant helpers', () => {
  const cap = capability('set-piece-suite');
  const runtime = Control.createRuntime(options('suite-controls'), cap);
  let plan = Control.prepareTick(runtime, input(1, 'set-piece', 'set-piece-suite', {
    setPieceEvent: {
      eventId: 'menu-options',
      action: 'menu',
      intent: { device: 'controller', control: 'options', pressed: true }
    }
  }), cap);
  let snapshot = commit(runtime, cap, plan);
  assert.equal(snapshot.setPieceSuite.session.menuOpen, true);

  plan = Control.prepareTick(runtime, input(2, 'set-piece', 'set-piece-suite', {
    setPieceEvent: {
      eventId: 'menu-escape',
      action: 'menu',
      intent: { device: 'keyboard', control: 'escape', pressed: true }
    }
  }), cap);
  snapshot = commit(runtime, cap, plan);
  assert.equal(snapshot.setPieceSuite.session.menuOpen, false);

  plan = Control.prepareTick(runtime, input(3, 'set-piece', 'set-piece-suite', {
    setPieceEvent: {
      eventId: 'penalty-shortcut',
      action: 'shortcut',
      shortcut: { control: 'dpad-up', pressed: true, suiteContext: true, inPenaltyArea: true },
      takerOwner: 'controller-1', goalkeeperOwner: 'cpu', attackingDirection: 1
    }
  }), cap);
  assert.ok(plan.commands.some(command => command.type === 'setpiece.setup.handoff'));
  snapshot = commit(runtime, cap, plan);
  assert.equal(snapshot.setPieceSuite.selectedScenario.kind, 'penalty');
  assert.equal(snapshot.setPieceSuite.trials.at(-1).reason, 'dpad-up-penalty-area-shortcut');
});

test('suite setup and launch use explicit SI transforms in both attacking directions', () => {
  function arm(direction, session) {
    const cap = capability('set-piece-suite');
    const runtime = Control.createRuntime(options(session), cap);
    let plan = Control.prepareTick(runtime, input(1, 'set-piece', 'set-piece-suite', {
      setPieceEvent: {
        eventId: session + '-stage', action: 'stage', scenario: 'free-kick-left-23m',
        takerOwner: 'controller-1', goalkeeperOwner: 'cpu', attackingDirection: direction
      }
    }), cap);
    commit(runtime, cap, plan);
    plan = Control.prepareTick(runtime, input(2, 'set-piece', 'set-piece-suite', {
      setPieceEvent: {
        eventId: session + '-arm', action: 'arm', launch: {},
        takerOwner: 'controller-1', goalkeeperOwner: 'cpu', attackingDirection: direction
      }
    }), cap);
    return plan.commands.find(command => command.type === 'ball.launch.handoff').payload.launchIntent;
  }
  const right = arm(1, 'right');
  const left = arm(-1, 'left');
  assert.equal(right.metadata.liveCoordinateContract.coordinateSystem,
    'si-metres-world-x-length-y-width-z-up');
  assert.ok(Math.abs(right.origin.x + left.origin.x - 105) < 1e-9);
  assert.ok(Math.abs(right.origin.y + left.origin.y - 68) < 1e-9);
  assert.equal(left.metadata.liveCoordinateContract.attackSign, -1);

  const cap = capability('set-piece-suite');
  const runtime = Control.createRuntime(options('scaled', {
    pitch: {
      units: 'metres', coordinateSystem: 'si-metres-world-x-length-y-width-z-up',
      axisAlignment: 'axis-aligned', xMin: 10, xMax: 110, yMin: -30, yMax: 30
    }
  }), cap);
  const plan = Control.prepareTick(runtime, input(1, 'set-piece', 'set-piece-suite', {
    setPieceEvent: {
      eventId: 'scaled-stage', action: 'stage', scenario: 'corner-right',
      takerOwner: 'cpu', goalkeeperOwner: 'cpu', attackingDirection: 1
    }
  }), cap);
  const setup = plan.commands.find(command => command.type === 'setpiece.setup.handoff');
  assert.deepEqual(setup.payload.geometry.ball, { x: 110, y: 30, z: 0.11 });
  assert.equal(setup.payload.transform.xScale, 100 / 105);
  assert.equal(setup.payload.transform.yScale, 60 / 68);
});

test('camera ownership matrix preserves CPU broadcast and human keeper/taker views', () => {
  const cap = capability();
  const policy = details => Control.resolveCameraPolicy({
    workflow: 'single-player', online: false, ...details
  }, cap).preset;
  assert.equal(policy({ restartKind: 'free-kick', takerOwner: 'cpu', goalkeeperOwner: 'cpu' }), 'broadcast');
  assert.equal(policy({ restartKind: 'corner', takerOwner: 'controller-1', goalkeeperOwner: 'cpu' }), 'set-piece-special');
  assert.equal(policy({ restartKind: 'goal-kick', takerOwner: 'keyboard', goalkeeperOwner: 'keyboard' }), 'set-piece-special');
  assert.equal(policy({ restartKind: 'penalty', takerOwner: 'cpu', goalkeeperOwner: 'controller-1' }), 'penalty-save');
  assert.throws(() => Control.resolveCameraPolicy({
    workflow: 'online-versus', online: true, restartKind: 'free-kick', takerOwner: 'online-remote'
  }, cap), /offline workflow/);
});

test('half-time requires one explicit exact-once second-half transition', () => {
  const cap = capability();
  const runtime = Control.createRuntime(options('period', { realMatchDurationSeconds: 2 }), cap);
  for (let tick = 1; tick <= 60; tick += 1) {
    const plan = Control.prepareTick(runtime, input(tick, 'live'), cap);
    commit(runtime, cap, plan);
  }
  assert.equal(Control.snapshot(runtime, cap).clock.period, 'half-time');
  let plan = Control.prepareTick(runtime, input(61, 'kickoff', 'single-player', {
    periodEvent: { eventId: 'second-half', action: 'start-second-half' }
  }), cap);
  assert.equal(plan.clock.period, 'second-half');
  assert.equal(plan.commands.filter(command => command.type === 'clock.period-transition.handoff').length, 1);
  commit(runtime, cap, plan);
  plan = Control.prepareTick(runtime, input(62, 'kickoff', 'single-player', {
    periodEvent: { eventId: 'second-half', action: 'start-second-half' }
  }), cap);
  assert.equal(plan.commands.filter(command => command.type === 'clock.period-transition.handoff').length, 0);
});

test('restart, suite and period identities cannot collide across domains', () => {
  const cap = capability();
  const runtime = Control.createRuntime(options('namespaces'), cap);
  let plan = Control.prepareTick(runtime, input(1, 'offside-presentation', 'single-player', {
    restartIncident: incident('same-id')
  }), cap);
  commit(runtime, cap, plan);
  for (let tick = 2; tick <= 95; tick += 1) {
    plan = Control.prepareTick(runtime, input(tick, 'offside-presentation'), cap);
    commit(runtime, cap, plan);
  }
  plan = Control.prepareTick(runtime, input(96, 'set-piece', 'single-player', {
    setPieceEvent: {
      eventId: 'same-id', action: 'stage', scenario: 'corner-left',
      takerOwner: 'cpu', goalkeeperOwner: 'cpu', attackingDirection: 1
    }
  }), cap);
  assert.ok(plan.commands.some(command => command.type === 'setpiece.setup.handoff'));
  const snapshot = commit(runtime, cap, plan);
  assert.ok(snapshot.ledgers.processedEventIds.some(id => id.startsWith('restart:')));
  assert.ok(snapshot.ledgers.processedEventIds.some(id => id.startsWith('suite:')));
});

test('malformed structures contain failure, and independent runs are byte deterministic', () => {
  for (const hostile of [
    { tick: Number.NaN },
    { tick: 1, setPieceEvent: (() => { const value = {}; value.self = value; return value; })() }
  ]) {
    const cap = capability();
    const runtime = Control.createRuntime(options('hostile-' + String(hostile.tick)), cap);
    let plan;
    assert.doesNotThrow(() => {
      plan = Control.prepareTick(runtime, { ...input(1, 'live'), ...hostile }, cap);
    });
    assert.equal(plan.effectiveEngine, 'build-173');
    assert.equal(Control.snapshot(runtime, cap).committedTick, 0);
  }

  function trace(reverse) {
    const cap = capability('set-piece-suite');
    const runtime = Control.createRuntime(options('deterministic'), cap);
    const event = reverse
      ? { attackingDirection: 1, goalkeeperOwner: 'cpu', takerOwner: 'cpu', scenario: 'corner-left', action: 'stage', eventId: 'stage' }
      : { eventId: 'stage', action: 'stage', scenario: 'corner-left', takerOwner: 'cpu', goalkeeperOwner: 'cpu', attackingDirection: 1 };
    const first = Control.prepareTick(runtime, input(1, 'set-piece', 'set-piece-suite', { setPieceEvent: event }), cap);
    commit(runtime, cap, first);
    const second = Control.prepareTick(runtime, input(2, 'set-piece', 'set-piece-suite', {
      setPieceEvent: { eventId: 'arm', action: 'arm', launch: {}, takerOwner: 'cpu', goalkeeperOwner: 'cpu', attackingDirection: 1 }
    }), cap);
    commit(runtime, cap, second);
    return { first, second, snapshot: Control.snapshot(runtime, cap) };
  }
  assert.equal(Control.stableJson(trace(false)), Control.stableJson(trace(true)));
});

test('ledger saturation fails closed before eviction and cannot replay the oldest action', () => {
  const cap = capability('set-piece-suite');
  const runtime = Control.createRuntime(options('saturation'), cap);
  for (let tick = 1; tick <= Control.MAX_LEDGER; tick += 1) {
    const plan = Control.prepareTick(runtime, input(tick, 'set-piece', 'set-piece-suite', {
      setPieceEvent: {
        eventId: 'event-' + tick,
        action: 'menu',
        intent: { device: 'keyboard', control: 'escape', pressed: false }
      }
    }), cap);
    assert.equal(plan.effectiveEngine, 'fl-v2');
    commit(runtime, cap, plan);
  }
  const before = Control.snapshot(runtime, cap);
  assert.equal(before.ledgers.processedEventIds.length, Control.MAX_LEDGER);
  assert.equal(before.setPieceSuite.session.menuOpen, false);
  let overflow;
  assert.doesNotThrow(() => {
    overflow = Control.prepareTick(runtime, input(1025, 'set-piece', 'set-piece-suite', {
      setPieceEvent: {
        eventId: 'event-1025', action: 'menu',
        intent: { device: 'keyboard', control: 'escape', pressed: true }
      }
    }), cap);
  });
  assert.equal(overflow.effectiveEngine, 'build-173');
  const after = Control.snapshot(runtime, cap);
  assert.equal(after.committedTick, before.committedTick);
  assert.deepEqual(after.ledgers, before.ledgers);
  assert.deepEqual(after.clock, before.clock);
  assert.deepEqual(after.restart, before.restart);
  assert.deepEqual(after.setPieceSuite, before.setPieceSuite);
  const replay = Control.prepareTick(runtime, input(1026, 'set-piece', 'set-piece-suite', {
    setPieceEvent: {
      eventId: 'event-1', action: 'menu',
      intent: { device: 'keyboard', control: 'escape', pressed: true }
    }
  }), cap);
  assert.equal(replay.effectiveEngine, 'build-173');
  assert.equal(Control.snapshot(runtime, cap).setPieceSuite.session.menuOpen, false);
  assert.equal(Control.snapshot(runtime, cap).ledgers.processedEventIds.length, Control.MAX_LEDGER);
});

test('browser/CommonJS parity and source audit expose no ambient or host authority', () => {
  const source = fs.readFileSync(path.join(root, 'match-engine/live-v2-match-control-composition.js'), 'utf8');
  for (const forbidden of [
    'Math.random', 'Date.now', 'performance.now', 'setTimeout(', 'setInterval(',
    'requestAnimationFrame(', 'document.', 'window.addEventListener'
  ]) assert.equal(source.includes(forbidden), false, forbidden);

  const context = vm.createContext({ window: {} });
  for (const file of [
    'match-clock-v2.js', 'restart-presentation-v2.js', 'set-piece-suite-v2.js',
    'set-piece-coordinate-contract-v2.js', 'live-v2-match-control-composition.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, 'match-engine', file), 'utf8'), context, { filename: file });
  }
  const browser = context.window.FootballLegacyLiveV2MatchControlComposition;
  assert.equal(browser.VERSION, Control.VERSION);
  assert.deepEqual(Array.from(browser.WORKFLOWS), Control.WORKFLOWS);
  assert.equal(typeof browser.prepareTick, 'function');
  assert.equal(typeof browser.commit, 'function');
});
