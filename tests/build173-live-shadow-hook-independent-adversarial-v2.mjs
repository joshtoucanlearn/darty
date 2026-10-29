import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  captureOptions,
  clone,
  OFFLINE_WORKFLOWS,
  snapshot,
  stablePlayerId,
  teamStates
} from './fixtures/build173-shadow-host-capture-fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const engineDir = path.join(root, 'match-engine');
const hookPath = path.join(engineDir, 'build173-live-shadow-hook-v2.js');
const adapterPath = path.join(engineDir, 'build173-live-shadow-adapter-v2.js');
const capturePath = path.join(engineDir, 'build173-shadow-host-capture-v2.js');
const matchPath = path.join(engineDir, 'match.html');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Hook = require(hookPath);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function recursiveKeys(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => recursiveKeys(item, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    output.push(key);
    recursiveKeys(item, output);
  });
  return output;
}

function runPreflight(search = '', hash = '') {
  const match = matchHtml.match(/<script id="build173V2ShadowPreflight">([\s\S]*?)<\/script>/);
  assert.ok(match, 'exact preflight block must exist');
  const writes = [];
  const window = {};
  vm.runInNewContext(match[1], {
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
  const match = matchHtml.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/);
  assert.ok(match, 'separate conditional offline-live preflight must exist');
  const writes = [];
  const window = {};
  vm.runInNewContext(match[1], {
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

function encoded(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url');
}

function makeHarness(workflow = 'quick-play', overrides = {}) {
  let live = snapshot({ kickoffOptional: true });
  let legacyCalls = 0;
  let snapshotReads = 0;
  let teamStateReads = 0;
  let environmentReads = 0;
  let sessionOptionsReads = 0;
  const host = {
    sessionOptions() {
      sessionOptionsReads += 1;
      if (typeof overrides.sessionOptions === 'function') return overrides.sessionOptions(sessionOptionsReads);
      return captureOptions(workflow, overrides.captureOptions || {});
    },
    captureSnapshot(options) {
      snapshotReads += 1;
      if (typeof overrides.captureSnapshot === 'function') {
        const candidate = overrides.captureSnapshot(snapshotReads, live, options);
        if (candidate !== undefined) return candidate;
      }
      const value = clone(live);
      if (options && options.freeKickPracticeReady === true) value.freeKickPracticeReady = true;
      return value;
    },
    captureTeamStates(after) {
      teamStateReads += 1;
      if (typeof overrides.captureTeamStates === 'function') {
        return overrides.captureTeamStates(teamStateReads, after);
      }
      return teamStates();
    },
    captureEnvironment() {
      environmentReads += 1;
      if (typeof overrides.captureEnvironment === 'function') {
        return overrides.captureEnvironment(environmentReads);
      }
      return { build: 173, workflow, independentReview: true };
    }
  };
  const attachment = Hook.createAttachment({
    enabled: true,
    acknowledgement: Hook.ACKNOWLEDGEMENT,
    workflow,
    sessionId: `independent-hook-${workflow}`,
    online: overrides.online === true,
    onlineMarkers: overrides.onlineMarkers || {},
    host
  });

  function update(mutate) {
    legacyCalls += 1;
    const next = clone(live);
    next.clock = {
      ...next.clock,
      period: 'first-half',
      clockFrames: Number(next.clock.clockFrames || 0) + 0.125,
      matchPhase: 'play',
      paused: false,
      setPieceActive: false,
      kickoffHeld: false,
      restartKind: '',
      deadBall: false,
      offsidePresentation: false,
      celebrationActive: false,
      replayActive: false,
      clockRunning: true,
      reason: 'ball-live'
    };
    next.restart = { kind: '', held: false, takerId: null };
    next.ball = {
      ...next.ball,
      z: Number(next.ball.z || 0),
      zv: Number(next.ball.zv || 0),
      spin: Number(next.ball.spin || 0),
      dip: Number(next.ball.dip || 0),
      curveAccel: Number(next.ball.curveAccel || 0),
      flightType: String(next.ball.flightType || 'ground')
    };
    next.players[1].x += 0.25;
    if (typeof mutate === 'function') mutate(next, live);
    live = next;
    return legacyCalls;
  }

  return {
    attachment,
    host,
    update,
    live: () => clone(live),
    legacyCalls: () => legacyCalls,
    snapshotReads: () => snapshotReads,
    teamStateReads: () => teamStateReads,
    environmentReads: () => environmentReads,
    sessionOptionsReads: () => sessionOptionsReads
  };
}

function arm(harness, workflow = 'quick-play') {
  harness.attachment.resetForNewMatch();
  if (workflow === 'set-piece-suite') harness.attachment.armAfterSetPieceSuiteReady();
  else harness.attachment.armAfterPostWalkoutKickoff();
  assert.equal(harness.attachment.diagnostic().lifecycle, 'armed');
}

test('FROZEN BYTE GATE: reviewed hook, match integration and approved target bytes are exact', () => {
  assert.equal(sha256(fs.readFileSync(hookPath)), '61c4ab42563f3b4b8585371b37e8e2527073bdab4eb5598cb75b677fd1c12fca');
  assert.equal(sha256(fs.readFileSync(matchPath)), 'a1b1a0635d35a5815047c51ceb3561844b2b588f48e014069f8e36763bc428b2');
  assert.equal(sha256(fs.readFileSync(adapterPath)), 'b7cbd0f9366c97b966962c2a2c26c16d592cdb46358c0a7eb9e25cd3e60600e5');
  assert.equal(sha256(fs.readFileSync(capturePath)), 'c6556fafdb0caf1877e4b6b78f27bc4784d2dff5cfcee21b501849db96ea16c5');
});

test('DEFAULT-ZERO-LOAD GATE: only one exact offline flag writes the ten reviewed scripts in order', () => {
  const defaultLive = runLivePreflight();
  assert.equal(defaultLive.diagnostic.requested, false);
  assert.equal(defaultLive.diagnostic.eligible, false);
  assert.deepEqual(defaultLive.writes, []);
  for (const search of [
    '', '?v2Shadow=', '?v2Shadow=0', '?v2Shadow=true', '?v2Shadow=01',
    '?v2Shadow=1&v2Shadow=1', '?V2Shadow=1'
  ]) {
    const result = runPreflight(search);
    assert.equal(result.diagnostic.eligible, false, search);
    assert.deepEqual(result.writes, [], search);
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
  assert.ok(livePreflight, 'the separate conditional offline-live preflight must coexist');
  assert.match(livePreflight[1], /if\(shadowValues\.length\)markers\.push\('shadow-marker-conflict'\)/,
    'the offline-live route must reject every shadow marker before loading');
  assert.doesNotMatch(matchHtml, /<script\s+src=["'][^"']*(?:ball-engine-v2|ball-shadow-bridge-v2|cpu-intelligence-v2|movement-engine-v2|formation-behaviour-v2|match-clock-v2|overhaul-shadow-orchestrator-v2|build173-live-shadow-adapter-v2|build173-shadow-host-capture-v2|build173-live-shadow-hook-v2)\.js/i);
});

test('MALFORMED-DECODE GATE: invalid or non-record flMatch payloads freeze before any script write', () => {
  for (const hash of [
    '#flMatch=%%%',
    `#flMatch=${encoded('{bad json')}`,
    `#flMatch=${encoded(null)}`,
    `#flMatch=${encoded([])}`,
    `#flMatch=${encoded('offline')}`
  ]) {
    const result = runPreflight('?v2Shadow=1', hash);
    assert.equal(result.diagnostic.eligible, false, hash);
    assert.ok(result.diagnostic.urlMarkers.includes('decoded-payload-invalid'), hash);
    assert.deepEqual(result.writes, [], hash);
  }
});

test('ONLINE PREFLIGHT GATE: every declared query and decoded online route freezes before loading', () => {
  const queries = [
    '?v2Shadow=1&onlineRole=host', '?v2Shadow=1&onlineRoom=ROOM',
    '?v2Shadow=1&onlineBuild=173', '?v2Shadow=1&room=ROOM',
    '?v2Shadow=1&join=ROOM', '?v2Shadow=1&mode=online',
    '?v2Shadow=1&mode=online-versus', '?v2Shadow=1&matchType=online',
    '?v2Shadow=1&matchType=online-versus', '?v2Shadow=1&online=1',
    '?v2Shadow=1&online=true'
  ];
  for (const search of queries) {
    const result = runPreflight(search);
    assert.equal(result.diagnostic.eligible, false, search);
    assert.deepEqual(result.writes, [], search);
  }
  for (const payload of [
    { mode: 'online' }, { mode: 'online-versus' }, { matchType: 'online' },
    { matchType: 'online-versus' }, { online: true }, { online: {} },
    { controllers: { online: true } }
  ]) {
    const result = runPreflight('?v2Shadow=1', `#flMatch=${encoded(payload)}`);
    assert.equal(result.diagnostic.eligible, false, JSON.stringify(payload));
    assert.deepEqual(result.writes, [], JSON.stringify(payload));
  }
});

test('ONLINE RUNTIME GATE: direct online state and every saved/config marker stay frozen without reading the host', () => {
  const routes = [
    { online: true },
    { onlineMarkers: { onlineRole: 'host' } },
    { onlineMarkers: { onlineRoom: 'ROOM' } },
    { onlineMarkers: { onlineBuild: '173' } },
    { onlineMarkers: { mode: 'online-versus' } },
    { onlineMarkers: { matchType: 'online' } },
    { onlineMarkers: { configOnline: true } },
    { onlineMarkers: { controllersOnline: true } },
    { onlineMarkers: { urlMarkers: ['join'] } }
  ];
  for (const route of routes) {
    const harness = makeHarness('quick-play', route);
    assert.equal(harness.attachment.diagnostic().lifecycle, 'online-frozen', JSON.stringify(route));
    harness.attachment.resetForNewMatch();
    assert.equal(harness.sessionOptionsReads(), 0, JSON.stringify(route));
    const legacy = () => 173;
    assert.equal(harness.attachment.selectTickRunner(legacy), legacy, JSON.stringify(route));
  }
  const onlineWorkflow = makeHarness('online');
  assert.equal(onlineWorkflow.attachment.diagnostic().enabled, false);
  assert.equal(onlineWorkflow.sessionOptionsReads(), 0);
});

test('EXACT-ONCE GATE: before, after, team, environment and metadata failures never suppress or duplicate Build 173', () => {
  const cases = [
    {
      label: 'before snapshot throw',
      overrides: { captureSnapshot(read) { if (read === 2) throw new Error('before capture fault'); } }
    },
    {
      label: 'after snapshot throw',
      overrides: { captureSnapshot(read) { if (read === 3) throw new Error('after capture fault'); } }
    },
    {
      label: 'team state throw',
      overrides: { captureTeamStates() { throw new Error('team state fault'); } }
    },
    {
      label: 'environment throw',
      overrides: { captureEnvironment() { throw new Error('environment fault'); } }
    }
  ];
  for (const entry of cases) {
    const harness = makeHarness('quick-play', entry.overrides);
    arm(harness);
    const result = harness.attachment.runAuthoritativeUpdate(() => harness.update());
    assert.equal(result, 1, entry.label);
    assert.equal(harness.legacyCalls(), 1, entry.label);
    assert.equal(harness.attachment.diagnostic().lifecycle, 'self-frozen', entry.label);
    harness.attachment.runAuthoritativeUpdate(() => harness.update());
    assert.equal(harness.legacyCalls(), 2, `${entry.label} post-freeze legacy continuity`);
  }

  const metadata = makeHarness();
  arm(metadata);
  const runner = metadata.attachment.selectTickRunner(() => metadata.update(), () => {
    throw new Error('metadata factory fault');
  });
  assert.equal(runner(), 1);
  assert.equal(metadata.legacyCalls(), 1);
  assert.equal(metadata.attachment.diagnostic().lifecycle, 'self-frozen');

  const legacyFailure = makeHarness();
  arm(legacyFailure);
  let calls = 0;
  assert.throws(() => legacyFailure.attachment.runAuthoritativeUpdate(() => {
    calls += 1;
    throw new Error('authoritative legacy failure');
  }), /authoritative legacy failure/);
  assert.equal(calls, 1, 'legacy errors must retain their exact once-and-propagate behaviour');
});

test('ACCESSOR/CYCLE/BOUND GATE: hostile capture values self-freeze with bounded diagnostics after one legacy update', () => {
  const accessor = makeHarness('quick-play', {
    captureSnapshot(read, live) {
      if (read !== 2) return undefined;
      const value = clone(live);
      Object.defineProperty(value, 'clock', {
        enumerable: true,
        get() { throw new Error('x'.repeat(4096)); }
      });
      return value;
    }
  });
  arm(accessor);
  assert.equal(accessor.attachment.runAuthoritativeUpdate(() => accessor.update()), 1);
  assert.equal(accessor.legacyCalls(), 1);
  assert.equal(accessor.attachment.diagnostic().lifecycle, 'self-frozen');
  assert.ok(accessor.attachment.diagnostic().reason.length <= 1024);

  const cyclic = makeHarness('quick-play', {
    captureEnvironment() {
      const value = { build: 173 };
      value.self = value;
      return value;
    }
  });
  arm(cyclic);
  assert.equal(cyclic.attachment.runAuthoritativeUpdate(() => cyclic.update()), 1);
  assert.equal(cyclic.legacyCalls(), 1);
  assert.equal(cyclic.attachment.diagnostic().lifecycle, 'self-frozen');

  const oversized = makeHarness('quick-play', {
    captureEnvironment: () => ({ note: 'z'.repeat(96 * 1024) })
  });
  arm(oversized);
  assert.equal(oversized.attachment.runAuthoritativeUpdate(() => oversized.update()), 1);
  assert.equal(oversized.legacyCalls(), 1);
  assert.equal(oversized.attachment.diagnostic().lifecycle, 'self-frozen');
});

test('READ-ONLY OUTPUT GATE: public and exported surfaces contain telemetry only and stay bounded', () => {
  const harness = makeHarness();
  arm(harness);
  for (let index = 0; index < 24; index += 1) {
    harness.attachment.runAuthoritativeUpdate(() => harness.update(), {
      renderFrameSequence: Math.floor(index / 4),
      simulationStepIndex: index % 4,
      simulationStepsPerRender: 4
    });
  }
  const output = harness.attachment.exportTelemetry();
  assert.equal(output.diagnostic.authority, 'build-173-legacy');
  assert.equal(output.diagnostic.readOnly, true);
  assert.equal(output.diagnostic.liveWrites, false);
  assert.ok(output.telemetry.recordCount <= 16);
  assert.ok(Buffer.byteLength(JSON.stringify(output), 'utf8') <= 512 * 1024);
  assert.equal(Object.isFrozen(output), true);
  for (const key of [
    'before', 'after', 'snapshot', 'state', 'candidateState', 'candidateProjection',
    'commands', 'movementCommands', 'apply', 'project', 'commit', 'writeLive'
  ]) assert.equal(recursiveKeys(output).includes(key), false, key);
  for (const key of ['state', 'snapshot', 'commands', 'apply', 'project', 'commit', 'writeLive']) {
    assert.equal(Object.prototype.hasOwnProperty.call(harness.attachment, key), false, key);
  }
});

test('WALKOUT/FULL-TIME LIFECYCLE GATE: transition and presentation ticks stay outside capture', () => {
  const normal = makeHarness();
  normal.attachment.resetForNewMatch();
  assert.equal(normal.attachment.diagnostic().lifecycle, 'awaiting-kickoff');
  let transitionCalls = 0;
  assert.equal(normal.attachment.runAuthoritativeUpdate(() => {
    transitionCalls += 1;
    normal.attachment.armAfterPostWalkoutKickoff();
    return transitionCalls;
  }), 1, 'walkout transition tick stays legacy-only');
  assert.equal(normal.attachment.diagnostic().hostUpdateSequence, 0);
  assert.equal(normal.attachment.diagnostic().reason, 'armed-after-post-walkout-kickoff');
  normal.attachment.runAuthoritativeUpdate(() => normal.update());
  normal.attachment.armAfterPostWalkoutKickoff();
  assert.equal(normal.attachment.diagnostic().hostUpdateSequence, 1, 'ordinary restart arm cannot reset');
  normal.attachment.finishBeforeFullTimePresentation();
  assert.equal(normal.attachment.diagnostic().lifecycle, 'finished');
  normal.attachment.runAuthoritativeUpdate(() => normal.update());
  assert.equal(normal.attachment.exportTelemetry().telemetry.acceptedTicks, 1, 'walk-in/presentation stays outside capture');
});

test('SET-PIECE ROUTE ISOLATION GATE: lifecycle methods cannot cross-arm the wrong workflow', () => {
  const suite = makeHarness('set-piece-suite');
  suite.attachment.resetForNewMatch();
  suite.attachment.armAfterPostWalkoutKickoff();
  const ordinary = makeHarness('quick-play');
  ordinary.attachment.resetForNewMatch();
  ordinary.attachment.armAfterSetPieceSuiteReady();
  assert.deepEqual(
    [suite.attachment.diagnostic().lifecycle, ordinary.attachment.diagnostic().lifecycle],
    ['self-frozen', 'self-frozen'],
    'each workflow must fail closed if the other workflow\'s public arming route is invoked'
  );
});

test('SET-PIECE READY LIFECYCLE GATE: explicit ready restart arms and captures tick one', () => {
  const readySuite = makeHarness('set-piece-suite');
  readySuite.attachment.resetForNewMatch();
  readySuite.attachment.armAfterSetPieceSuiteReady();
  assert.equal(readySuite.attachment.diagnostic().reason, 'armed-after-set-piece-suite-ready-init');
  readySuite.attachment.runAuthoritativeUpdate(() => readySuite.update());
  assert.equal(readySuite.attachment.exportTelemetry().telemetry.acceptedTicks, 1);
});

test('STATIC LIFECYCLE WIRING GATE: both mutually exclusive clock authorities retain the four approved shadow lifecycle boundaries', () => {
  assert.equal((matchHtml.match(/\.resetForNewMatch\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.armAfterPostWalkoutKickoff\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.armAfterSetPieceSuiteReady\(\)/g) || []).length, 1);
  assert.equal((matchHtml.match(/\.finishBeforeFullTimePresentation\(\)/g) || []).length, 1);
  assert.ok(matchHtml.indexOf("matchPhase='play';kickoff('you');if(build173V2Shadow)build173V2Shadow.armAfterPostWalkoutKickoff()") >= 0);
  assert.match(matchHtml, /function finishBuild173ShadowBeforeFullTime\(\)\{if\(build173V2Shadow\)build173V2Shadow\.finishBeforeFullTimePresentation\(\);\}/,
    'one shared finish boundary must own the sole public shadow finish call');
  assert.equal((matchHtml.match(/finishBuild173ShadowBeforeFullTime\(\)/g) || []).length, 3,
    'one definition plus the live-V2 and Build 173 full-time paths must exist');
  assert.match(matchHtml, /clock\.period==='full-time'[\s\S]{0,360}?finishBuild173ShadowBeforeFullTime\(\);matchPhase='fulltime-presentation'/,
    'conditional live V2 clock authority must finish the read-only shadow before presentation');
  assert.match(matchHtml, /if\(!liveV2OwnsPeriodClock\(\)\)[\s\S]{0,1800}?finishBuild173ShadowBeforeFullTime\(\);matchPhase='fulltime-presentation'/,
    'default Build 173 clock authority must finish the read-only shadow before presentation');
  assert.ok(matchHtml.indexOf("restart('FREE KICK','you',practiceSpot.x,practiceSpot.y,false,actor)") <
    matchHtml.indexOf('if(build173V2Shadow)build173V2Shadow.armAfterSetPieceSuiteReady()'));
});

test('STABLE-IDENTITY GATE: all six workflows retain exactly 22 unique slots across a substitution', () => {
  for (const workflow of OFFLINE_WORKFLOWS) {
    const options = captureOptions(workflow);
    const players = options.teams.flatMap(team => team.players);
    assert.equal(players.length, 22, workflow);
    assert.equal(new Set(players.map(player => player.id)).size, 22, workflow);
    assert.equal(new Set(players.map(player => `${player.id.split(':').slice(0, -1).join(':')}:${player.slotId}`)).size, 22, workflow);

    const harness = makeHarness(workflow);
    arm(harness, workflow);
    const replacementStableId = stablePlayerId('you', 'RST');
    harness.attachment.runAuthoritativeUpdate(() => harness.update(next => {
      const player = next.players.find(row => row.teamId === 'you' && row.slotId === 'RST');
      player.id = 'independent-review-substitute';
      player.actualPlayerId = 'independent-review-substitute';
      assert.equal(replacementStableId, 'slot:you:RST');
    }));
    assert.equal(harness.attachment.diagnostic().lifecycle, 'armed', workflow);
    assert.equal(harness.attachment.exportTelemetry().telemetry.acceptedTicks, 1, workflow);
  }
  assert.match(matchHtml, /id:'build173-shadow:'\+team\+':'\+row\.lineup\.slotId/);
  assert.match(matchHtml, /if\(rows\.length!==11\|\|rows\.some\(row=>!row\.slotId\|\|!row\.position\)\)throw/);
  assert.match(matchHtml, /players:build173V2ShadowRoster\.flatMap\(team=>team\.rows\.map\(build173ShadowPlayerSnapshot\)\)/);
});

test('FAST-SEQUENCING GATE: every simulation step maps to one ordered legacy update and one capture', () => {
  const harness = makeHarness();
  arm(harness);
  let renderFrameSequence = 0;
  let simulationStepIndex = 0;
  const runner = harness.attachment.selectTickRunner(() => harness.update(), () => ({
    renderFrameSequence,
    simulationStepIndex,
    simulationStepsPerRender: 4
  }));
  for (renderFrameSequence = 0; renderFrameSequence < 3; renderFrameSequence += 1) {
    for (simulationStepIndex = 0; simulationStepIndex < 4; simulationStepIndex += 1) runner();
  }
  assert.equal(harness.legacyCalls(), 12);
  assert.equal(harness.attachment.diagnostic().hostUpdateSequence, 12);
  assert.equal(harness.attachment.exportTelemetry().telemetry.acceptedTicks, 12);
  assert.match(matchHtml, /for\(let n=0;n<SIM_STEPS;n\+\+\)\{build173ShadowSimulationStepIndex=n;build173SimulationTick\(\);\}/);
  assert.match(matchHtml, /build173ShadowRenderFrameSequence\+\+;_acc-=STEP/);
});

test('SOURCE AUTHORITY GATE: hook has one legacy call site and no candidate output or live-write vocabulary', () => {
  assert.equal((hookSource.match(/const result = legacyUpdate\(\);/g) || []).length, 1);
  assert.match(hookSource, /if \(!enabled \|\| lifecycle !== 'armed' \|\| !session\) return legacyUpdate\(\);/);
  assert.doesNotMatch(hookSource, /candidate(?:State|Projection)|writeLive|applyToLive|setLiveState/);
  assert.doesNotMatch(matchHtml, /build173V2Shadow\.(?:state|snapshot|commands?|apply|project|commit|writeLive)\b/);
  assert.match(matchHtml, /getV2ShadowTelemetry/);
});
