import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { captureOptions, clone, OFFLINE_WORKFLOWS, snapshot, teamStates } from './fixtures/build173-shadow-host-capture-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'match-engine');
const matchHtml = fs.readFileSync(path.join(engineDir, 'match.html'), 'utf8');
const Hook = (await import('../match-engine/build173-live-shadow-hook-v2.js')).default;

function hostFor(workflow = 'quick-play') {
  let live = snapshot({ kickoffOptional: true });
  let updateCalls = 0;
  let failCapture = false;
  const host = {
    sessionOptions: () => captureOptions(workflow),
    captureSnapshot: options => {
      if (failCapture) throw new Error('fixture capture failure');
      const value = clone(live);
      if (options && options.freeKickPracticeReady === true) value.freeKickPracticeReady = true;
      return value;
    },
    captureTeamStates: () => teamStates(),
    captureEnvironment: () => ({ build: 173, fixture: true })
  };
  return {
    host,
    current: () => clone(live),
    calls: () => updateCalls,
    failCapture: value => { failCapture = value; },
    update() {
      updateCalls += 1;
      const next = clone(live);
      next.clock = {
        ...next.clock,
        period: 'first-half',
        clockFrames: Number(next.clock.clockFrames || 0) + 1,
        matchPhase: 'play', paused: false, setPieceActive: false, kickoffHeld: false,
        restartKind: '', deadBall: false, offsidePresentation: false,
        celebrationActive: false, replayActive: false, clockRunning: true, reason: 'ball-live'
      };
      next.restart = { kind: '', held: false, takerId: null };
      next.ball = { ...next.ball, z: 0, zv: 0, spin: 0, dip: 0, curveAccel: 0, flightType: 'ground' };
      next.players[1].x += 1;
      live = next;
      return updateCalls;
    }
  };
}

function attachment(workflow = 'quick-play', overrides = {}) {
  const fixture = hostFor(workflow);
  const value = Hook.createAttachment({
    enabled: true,
    acknowledgement: Hook.ACKNOWLEDGEMENT,
    workflow,
    sessionId: `hook-${workflow}`,
    host: fixture.host,
    ...overrides
  });
  return { fixture, value };
}

function runPreflight(search = '', hash = '') {
  const source = matchHtml.match(/<script id="build173V2ShadowPreflight">([\s\S]*?)<\/script>/)[1];
  const writes = [];
  const window = {};
  vm.runInNewContext(source, {
    window,
    location: { search, hash },
    document: { write: value => writes.push(String(value)) },
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    atob
  });
  return { diagnostic: window.__FL_V2_SHADOW_PREFLIGHT, writes };
}

function runLivePreflight(search = '', hash = '') {
  const source = matchHtml.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)[1];
  const writes = [];
  const window = {};
  vm.runInNewContext(source, {
    window,
    location: { search, hash },
    document: { write: value => writes.push(String(value)) },
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    atob
  });
  return { diagnostic: window.__FL_V2_LIVE_PREFLIGHT, writes };
}

test('public API is a telemetry-only exact-flag hook with no projection or apply surface', () => {
  assert.equal(Hook.VERSION, '2.0.0-build173-exact-flag-live-shadow-hook');
  assert.equal(Hook.ACKNOWLEDGEMENT, 'EXPLICIT_BUILD_173_EXACT_FLAG_OFFLINE_TELEMETRY_HOOK');
  assert.deepEqual(Object.keys(Hook).sort(), ['ACKNOWLEDGEMENT', 'DIAGNOSTIC_SCHEMA', 'VERSION', 'createAttachment'].sort());
  const { value } = attachment();
  assert.deepEqual(Object.keys(value).sort(), [
    'diagnostic', 'resetForNewMatch', 'armAfterPostWalkoutKickoff', 'armAfterSetPieceSuiteReady',
    'finishBeforeFullTimePresentation', 'runAuthoritativeUpdate', 'selectTickRunner', 'exportTelemetry'
  ].sort());
  for (const forbidden of ['state', 'snapshot', 'command', 'commands', 'apply', 'project', 'commit']) {
    assert.equal(Object.prototype.hasOwnProperty.call(value, forbidden), false, forbidden);
  }
});

test('default and malformed flags load no V2 component while the exact offline flag loads the reviewed UMD stack in order', () => {
  const defaultLive = runLivePreflight();
  assert.equal(defaultLive.diagnostic.requested, false);
  assert.equal(defaultLive.diagnostic.eligible, false);
  assert.deepEqual(defaultLive.writes, []);
  for (const search of ['', '?v2Shadow=0', '?v2Shadow=true', '?v2Shadow=1&v2Shadow=1']) {
    const result = runPreflight(search);
    assert.equal(result.diagnostic.eligible, false);
    assert.deepEqual(result.writes, []);
  }
  const exact = runPreflight('?v2Shadow=1');
  assert.equal(exact.diagnostic.eligible, true);
  assert.deepEqual(exact.writes.map(value => value.match(/src="([^"]+)/)[1]), [
    'ball-engine-v2.js', 'ball-shadow-bridge-v2.js', 'cpu-intelligence-v2.js',
    'movement-engine-v2.js', 'formation-behaviour-v2.js', 'match-clock-v2.js',
    'overhaul-shadow-orchestrator-v2.js', 'build173-live-shadow-adapter-v2.js',
    'build173-shadow-host-capture-v2.js', 'build173-live-shadow-hook-v2.js'
  ]);
  const liveEngineConflict = runPreflight('?v2Shadow=1&engine=fl-v2');
  assert.equal(liveEngineConflict.diagnostic.eligible, false);
  assert.ok(liveEngineConflict.diagnostic.urlMarkers.includes('live-engine-marker'));
  assert.deepEqual(liveEngineConflict.writes, []);
  const shadowConflict = runLivePreflight('?v2Shadow=1&engine=fl-v2');
  assert.equal(shadowConflict.diagnostic.eligible, false);
  assert.ok(shadowConflict.diagnostic.urlMarkers.includes('shadow-marker-conflict'));
  assert.deepEqual(shadowConflict.writes, []);
  const livePreflight = matchHtml.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/);
  assert.ok(livePreflight, 'separate conditional offline-live preflight must remain present');
  assert.match(livePreflight[1], /if\(shadowValues\.length\)markers\.push\('shadow-marker-conflict'\)/);
});

test('obvious URL and decoded online markers freeze before any V2 component is loaded', () => {
  for (const search of ['?v2Shadow=1&onlineRole=host', '?v2Shadow=1&join=ROOM', '?v2Shadow=1&online=true', '?v2Shadow=1&matchType=online-versus']) {
    const result = runPreflight(search);
    assert.equal(result.diagnostic.eligible, false);
    assert.deepEqual(result.writes, []);
  }
  const payload = Buffer.from(JSON.stringify({ mode: 'quickPlay', online: { role: 'away' } })).toString('base64url');
  const decoded = runPreflight('?v2Shadow=1', `#flMatch=${payload}`);
  assert.equal(decoded.diagnostic.eligible, false);
  assert.ok(decoded.diagnostic.urlMarkers.includes('decoded-online'));
  assert.deepEqual(decoded.writes, []);
});

test('fresh epoch arms after kickoff, captures exactly one authoritative update, then finishes before presentation', () => {
  const { fixture, value } = attachment();
  assert.equal(value.diagnostic().lifecycle, 'awaiting-new-match');
  value.resetForNewMatch();
  assert.equal(value.diagnostic().lifecycle, 'awaiting-kickoff');
  value.armAfterPostWalkoutKickoff();
  assert.equal(value.diagnostic().lifecycle, 'armed');
  const result = value.runAuthoritativeUpdate(() => fixture.update(), {
    renderFrameSequence: 4, simulationStepIndex: 0, simulationStepsPerRender: 1
  });
  assert.equal(result, 1);
  assert.equal(fixture.calls(), 1);
  assert.equal(value.diagnostic().hostUpdateSequence, 1);
  assert.equal(value.exportTelemetry().telemetry.acceptedTicks, 1);
  value.finishBeforeFullTimePresentation();
  assert.equal(value.diagnostic().lifecycle, 'finished');
  value.runAuthoritativeUpdate(() => fixture.update());
  assert.equal(fixture.calls(), 2, 'finished shadow may not suppress the legacy update');
  assert.equal(value.exportTelemetry().telemetry.acceptedTicks, 1, 'post-match presentation is outside capture');
});

test('walkout transition tick is skipped, ordinary restarts do not reset, and a fresh match can begin a new epoch', () => {
  const { fixture, value } = attachment();
  value.resetForNewMatch();
  let transitionCalls = 0;
  const directTransition = value.runAuthoritativeUpdate(() => { transitionCalls += 1; return 173; });
  assert.equal(directTransition, 173);
  assert.equal(transitionCalls, 1);
  assert.equal(value.diagnostic().hostUpdateSequence, 0);
  value.armAfterPostWalkoutKickoff();
  value.runAuthoritativeUpdate(() => fixture.update());
  assert.equal(value.diagnostic().hostUpdateSequence, 1);
  value.armAfterPostWalkoutKickoff();
  assert.equal(value.diagnostic().hostUpdateSequence, 1, 'ordinary restart arm calls cannot create a new epoch');
  value.finishBeforeFullTimePresentation();
  value.resetForNewMatch();
  assert.equal(value.diagnostic().lifecycle, 'awaiting-kickoff');
  assert.match(value.diagnostic().epochId, /epoch:2$/);
});

test('FAST simulation steps retain exact update counts and ordered per-render metadata', () => {
  const { fixture, value } = attachment();
  value.resetForNewMatch();
  value.armAfterPostWalkoutKickoff();
  let step = 0;
  const runner = value.selectTickRunner(() => fixture.update(), () => ({
    renderFrameSequence: 9,
    simulationStepIndex: step++,
    simulationStepsPerRender: 4
  }));
  for (let index = 0; index < 4; index += 1) runner();
  assert.equal(fixture.calls(), 4);
  assert.equal(value.diagnostic().hostUpdateSequence, 4);
  assert.equal(value.exportTelemetry().telemetry.acceptedTicks, 4);
});

test('all six offline workflows preserve their ownership contract and accept a live shadow tick', () => {
  for (const workflow of OFFLINE_WORKFLOWS) {
    const { fixture, value } = attachment(workflow);
    value.resetForNewMatch();
    if (workflow === 'set-piece-suite') value.armAfterSetPieceSuiteReady();
    else value.armAfterPostWalkoutKickoff();
    value.runAuthoritativeUpdate(() => fixture.update(), { simulationStepsPerRender: 1 });
    assert.equal(value.diagnostic().lifecycle, 'armed', workflow);
    assert.equal(value.exportTelemetry().telemetry.acceptedTicks, 1, workflow);
  }
});

test('each arming method is bound to its exact workflow and cross-method calls fail closed', () => {
  const ordinary = attachment('quick-play');
  ordinary.value.resetForNewMatch();
  ordinary.value.armAfterSetPieceSuiteReady();
  assert.equal(ordinary.value.diagnostic().lifecycle, 'self-frozen');
  assert.equal(ordinary.value.diagnostic().failure.stage, 'arm');
  assert.match(ordinary.value.diagnostic().reason, /arm method does not match.*workflow/);
  assert.equal(ordinary.value.runAuthoritativeUpdate(() => ordinary.fixture.update()), 1);
  assert.equal(ordinary.fixture.calls(), 1, 'wrong-method freeze cannot suppress Build 173');

  const suite = attachment('set-piece-suite');
  suite.value.resetForNewMatch();
  suite.value.armAfterPostWalkoutKickoff();
  assert.equal(suite.value.diagnostic().lifecycle, 'self-frozen');
  assert.equal(suite.value.diagnostic().failure.stage, 'arm');
  assert.match(suite.value.diagnostic().reason, /arm method does not match.*workflow/);
  assert.equal(suite.value.runAuthoritativeUpdate(() => suite.fixture.update()), 1);
  assert.equal(suite.fixture.calls(), 1, 'wrong-method freeze cannot suppress Build 173');
});

test('online status and capture faults self-freeze without interrupting Build 173', () => {
  const online = attachment('quick-play', { online: true, onlineMarkers: { onlineRole: 'host' } });
  assert.equal(online.value.diagnostic().lifecycle, 'online-frozen');
  const legacy = () => 173;
  assert.equal(online.value.selectTickRunner(legacy), legacy);

  const broken = attachment();
  broken.value.resetForNewMatch();
  broken.value.armAfterPostWalkoutKickoff();
  broken.fixture.failCapture(true);
  assert.equal(broken.value.runAuthoritativeUpdate(() => broken.fixture.update()), 1);
  assert.equal(broken.fixture.calls(), 1);
  assert.equal(broken.value.diagnostic().lifecycle, 'self-frozen');
  assert.equal(broken.value.runAuthoritativeUpdate(() => broken.fixture.update()), 2);
  assert.equal(broken.fixture.calls(), 2);
});

test('match integration has only the approved lifecycle boundaries under either mutually exclusive clock authority and no live projection path', () => {
  assert.equal((matchHtml.match(/\.resetForNewMatch\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.armAfterPostWalkoutKickoff\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.armAfterSetPieceSuiteReady\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.finishBeforeFullTimePresentation\(\)/g) || []).length, 1);
  assert.match(matchHtml, /kickoff\('opp'\);}\s*return;/, 'half-time kickoff must not reset the shadow epoch');
  assert.match(matchHtml, /function finishBuild173ShadowBeforeFullTime\(\)\{if\(build173V2Shadow\)build173V2Shadow\.finishBeforeFullTimePresentation\(\);\}/);
  assert.equal((matchHtml.match(/finishBuild173ShadowBeforeFullTime\(\)/g) || []).length, 3);
  assert.match(matchHtml, /clock\.period==='full-time'[\s\S]{0,360}?finishBuild173ShadowBeforeFullTime\(\);matchPhase='fulltime-presentation'/);
  assert.match(matchHtml, /if\(!liveV2OwnsPeriodClock\(\)\)[\s\S]{0,1800}?finishBuild173ShadowBeforeFullTime\(\);matchPhase='fulltime-presentation'/);
  assert.match(matchHtml, /build173SimulationTick=build173V2Shadow\?build173V2Shadow\.selectTickRunner\(update/);
  assert.match(matchHtml, /build173ShadowSimulationStepIndex=n;build173SimulationTick\(\)/);
  assert.doesNotMatch(matchHtml, /FootballLegacyBuild173LiveShadowAdapterV2\.(?:apply|project|commit)/);
  assert.doesNotMatch(matchHtml, /FootballLegacyBuild173ShadowHostCaptureV2\.(?:apply|project|commit)/);
  assert.doesNotMatch(matchHtml, /build173V2Shadow\.(?:state|snapshot|commands?|apply|project|commit)\b/);
});
