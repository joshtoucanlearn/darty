// Speed round, 31 Oct 2026. These tests pin the properties that let the optimisations be
// proven "no gameplay change": every fast path must equal the slow path it replaced.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'match-engine');
const require = createRequire(import.meta.url);
const matchHtml = fs.readFileSync(path.join(engineDir, 'match.html'), 'utf8');
const ballSource = fs.readFileSync(path.join(engineDir, 'ball-engine-v2.js'), 'utf8');
const compositionSource = fs.readFileSync(path.join(engineDir, 'live-v2-match-control-composition.js'), 'utf8');
const Ball = require(path.join(engineDir, 'ball-engine-v2.js'));
const Clock = require(path.join(engineDir, 'match-clock-v2.js'));

function lcg(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

function sourceBetween(text, start, end) {
  const a = text.indexOf(start);
  assert.ok(a >= 0, 'missing: ' + start);
  const b = text.indexOf(end, a);
  assert.ok(b > a, 'missing end: ' + end);
  return text.slice(a, b);
}

// ---- Ball V2 capsule broadphase ------------------------------------------------------------

test('capsule broadphase never changes a Ball V2 step: results are bit-identical to the unfiltered engine', () => {
  assert.match(ballSource, /function capsuleSweepMisses\(/);
  const patched = ballSource.replace('if (capsuleSweepMisses(start, relativeEnd, radius, collider)) return null;', '');
  assert.notEqual(patched, ballSource, 'the broadphase call must be removable for the reference engine');
  const sandbox = { module: { exports: {} }, window: undefined };
  vm.runInNewContext(patched, sandbox);
  const Reference = sandbox.module.exports;
  const environment = {
    colliders: [
      ...Ball.createGoalFrame({ id: 'home', leftPostBase: { x: 0, y: -3.66, z: 0 }, rightPostBase: { x: 0, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 }),
      ...Ball.createGoalFrame({ id: 'away', leftPostBase: { x: 105, y: -3.66, z: 0 }, rightPostBase: { x: 105, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 })
    ],
    groundEnabled: true
  };
  const random = lcg(20261031);
  let frameHits = 0;
  for (let trial = 0; trial < 600; trial += 1) {
    const nearGoal = trial % 3 !== 0;
    const x = nearGoal ? (trial % 2 ? 105 - random() * 6 : random() * 6) : random() * 105;
    const initial = {
      position: { x, y: (random() - 0.5) * 12, z: 0.11 + random() * 3 },
      velocity: { x: (random() - 0.5) * 60, y: (random() - 0.5) * 30, z: (random() - 0.2) * 14 },
      angularVelocity: { x: (random() - 0.5) * 30, y: (random() - 0.5) * 30, z: (random() - 0.5) * 30 }
    };
    let a = { state: Ball.createBallState(initial), context: Ball.createSimulationContext({ seed: 1000 + trial }) };
    let b = { state: Reference.createBallState(initial), context: Reference.createSimulationContext({ seed: 1000 + trial }) };
    for (let tick = 0; tick < 30; tick += 1) {
      a = Ball.step(a.state, a.context, 1 / 60, environment);
      b = Reference.step(b.state, b.context, 1 / 60, environment);
      // The reference engine runs in another realm, so compare by value through JSON (exact for doubles).
      assert.equal(JSON.stringify(a.state), JSON.stringify(b.state), `trial ${trial} tick ${tick} state`);
      assert.equal(JSON.stringify(a.trace.events), JSON.stringify(b.trace.events), `trial ${trial} tick ${tick} events`);
      frameHits += a.trace.events.filter(event => event.colliderRole === 'goal-post' || event.colliderRole === 'crossbar').length;
    }
  }
  assert.ok(frameHits > 0, 'the property test must actually reach the goal frame');
});

// ---- Control composition stable text -------------------------------------------------------

test('single-pass stable text equals JSON.stringify(stableValue(safeClone(value))) for plain data and bails otherwise', () => {
  const withFinite = sourceBetween(compositionSource, 'const SAFE_LIMITS', 'function compareIds') + '\nthis.api={stableJsonFast,stableJson,safeClone,stableValue};';
  const context = {};
  vm.runInNewContext(withFinite, context);
  const { stableJsonFast, stableJson, safeClone, stableValue } = context.api;
  // Inputs are built inside the module's realm so prototype checks behave as they do in the page.
  const make = code => vm.runInContext('(' + code + ')', context);
  const slow = value => JSON.stringify(stableValue(safeClone(value, 'test')));
  const cases = make(`[
    { b: 2, a: 1, c: [3, { z: 1, y: [true, null, 'x"y'] }], d: -0, e: 1e21, f: 'é\\n' },
    [], {}, [[], {}, [[1]]],
    { nested: { deeper: { deepest: { list: [1, 2, 3, { k: 'v' }] } } } },
    { 'a-b': 1, a_b: 2, 'a b': 3 },
    Object.freeze({ list: Object.freeze([Object.freeze({ k: 1 }), Object.freeze({ k: 2 })]) })
  ]`);
  for (const value of cases) {
    assert.equal(stableJson(value), slow(value));
    assert.equal(stableJsonFast(value), slow(value));
    assert.equal(stableJsonFast(value), slow(value), 'a second call (frozen-text cache) must agree');
  }
  // Integer-like keys reorder under JSON.stringify, so the fast path must hand them to the validating path.
  const indexKeys = make("({ 10: 'a', 9: 'b' })");
  assert.equal(stableJsonFast(indexKeys), null);
  assert.equal(stableJson(indexKeys), slow(indexKeys));
  // Anything the validating path rejects must still be rejected, not silently hashed.
  const bad = make(`[{ v: NaN }, { v: Infinity }, { v: undefined }, { v: () => 1 }, { v: new Date(0) }, JSON.parse('{"__proto__":{"x":1}}')]`);
  for (const value of bad) {
    assert.equal(stableJsonFast(value), null);
    assert.throws(() => stableJson(value));
  }
  const cycle = make('(() => { const c = { a: 1 }; c.self = c; return c; })()');
  assert.equal(stableJsonFast(cycle), null);
  assert.throws(() => stableJson(cycle), /cycle/);
  const long = make("({ s: 'x'.repeat(3000) })");
  assert.equal(stableJsonFast(long), null);
  assert.throws(() => stableJson(long), /string limit/);
});

// ---- Match clock history sharing ----------------------------------------------------------

test('match clock history is copy-on-write: states never alias a later append and snapshots are detached and frozen', () => {
  let state = Clock.createState({ fixedTickSeconds: 1, acceleration: 60, initialPhase: 'live' });
  const earlier = state;
  state = Clock.enterPhase(state, 'dead-ball', { tick: state.tick, reason: 'test-dead-ball' });
  state = Clock.enterPhase(state, 'live', { tick: state.tick, reason: 'test-live' });
  assert.ok(state.history.length > earlier.history.length);
  assert.notEqual(state.history, earlier.history, 'an append must replace the array, never mutate the earlier state');
  const before = JSON.stringify(earlier.history);
  Clock.advance(state, 5);
  assert.equal(JSON.stringify(earlier.history), before, 'earlier states are untouched');

  const advanced = Clock.advance(state, 3);
  assert.equal(advanced.history, state.history, 'a pure advance shares the unchanged history array instead of re-copying it');
  const first = Clock.snapshot(state);
  const second = Clock.snapshot(advanced);
  assert.deepEqual(first.telemetry.history, JSON.parse(JSON.stringify(state.history)));
  assert.ok(Object.isFrozen(first.telemetry.history) && Object.isFrozen(first.telemetry.history[0]));
  assert.equal(first.telemetry.history, second.telemetry.history, 'snapshots of the same history share one frozen copy');
  assert.notEqual(first.telemetry.history, state.history, 'the snapshot copy is detached from the live state');
  assert.throws(() => { 'use strict'; first.telemetry.history[0].type = 'tampered'; }, TypeError);
  assert.notEqual(state.history[0].type, 'tampered');
  const longer = Clock.enterPhase(advanced, 'dead-ball', { tick: advanced.tick, reason: 'test-more' });
  assert.notEqual(Clock.snapshot(longer).telemetry.history, first.telemetry.history);
});

// ---- Host fast clone and transaction capture ----------------------------------------------

function hostCloneApi() {
  const code = sourceBetween(matchHtml, 'const LIVE_V2_CLONE_FAIL', 'function liveV2CaptureTransactionState');
  const context = {};
  vm.runInNewContext(code + '\nthis.api={liveV2Clone,liveV2PlayerTransactionValues};', context);
  context.make = expression => vm.runInContext('(' + expression + ')', context);
  return context;
}

test('host liveV2Clone is exactly the JSON round trip, including every case JSON rewrites', () => {
  const host = hostCloneApi();
  const { liveV2Clone } = host.api;
  const cases = [
    'null', 'undefined', '0', '-0', '7', "'text'", 'true',
    '({ rating: 6.0, goals: 0, distance: -0, passes: 12 })',
    "[1, [2, { a: [3] }], 'x']",
    '({ a: undefined, b: 1, c: () => 1 })',
    '[undefined, () => 1, NaN, Infinity, -Infinity]',
    '({ n: NaN, i: Infinity })',
    'new Date(86400000)',
    '({ when: new Date(86400000), set: new Set([1]), map: new Map([[1, 2]]) })',
    'Object.assign(Object.create(null), { a: 1 })',
    `JSON.parse('{"__proto__":{"polluted":true},"ok":1}')`,
    '({ toJSON() { return { replaced: true }; } })',
    'new Array(3)',
    '({ arr: [, 1] })',
    '({ deep: { deeper: { deepest: [{ z: -0, y: 1.5, w: "s" }] } } })'
  ];
  for (const code of cases) {
    const value = host.make(code);
    let expected, expectedError = null;
    try { expected = value == null ? value : JSON.parse(JSON.stringify(value)); } catch (error) { expectedError = error; }
    if (expectedError) assert.throws(() => liveV2Clone(value), Error, code);
    else if (expected === undefined) assert.equal(liveV2Clone(value), undefined, code);
    else {
      const actual = liveV2Clone(value);
      assert.equal(JSON.stringify(actual), JSON.stringify(expected), code);
      if (expected && typeof expected === 'object') assert.notEqual(actual, value, 'must be a detached copy: ' + code);
    }
  }
  const cyclic = host.make('(() => { const c = {}; c.self = c; return c; })()');
  assert.throws(() => liveV2Clone(cyclic), /circular|cycl/i);
  assert.ok(Object.is(liveV2Clone(host.make('({ z: -0 })')).z, 0), 'JSON turns -0 into 0');
});

test('liveV2PlayerTransactionValues reads exactly the original 77 rollback fields, in order, by reference', () => {
  const { liveV2PlayerTransactionValues } = hostCloneApi().api;
  const original = ['v2ContactAction','v2ContactTick','v2PhysicalFoulProof','v2SlideOwned','v2SlideCommandId','v2ActionCommandId','slide','slideDuration','slideDirX','slideDirY','slideEntrySpeed','skill','skillDuration','skillProgress','skillType','knockOnTargetDistance','v2DribbleIntentKey','v2CpuSkillKey','v2SkillExitTarget','v2SkillExitUntil','v2KnockOnKey','v2KnockChoiceUntil','v2LastKnockTier','v2LastKnockOnFrame','v2CpuFakeKey','skillUtilityWindow','skillStartFx','skillStartFy','fakeExitX','fakeExitY','fakeShotStationary','aiSkillCooldown','oneVOneState','oneVOneCooldown','x','y','vx','vy','desiredVx','desiredVy','fx','fy','stamina','locomotionState','previousLocomotionState','gait','action','actionT','presentationAction','presentationActionDuration','presentationActionUntil','shielding','shieldSide','lunge','tcd','stun','receiveT','touchPhase','firstTouch','dribbleFoot','dribbleContact','dribbleSeparation','dribbleTargetSeparation','dribbleOutcome','intent','aiTarget','runIntent','runIntentT','aerialCommand','aerialCommandUntil','aerialCommandFrame','aerialTiming','aerialLockUntil','setPieceLocked','setPieceTarget','hold','holdReleaseAt'];
  const retained = { scan: { teammates: [{ player: 'live reference' }] } };
  const player = Object.fromEntries(original.map((key, index) => [key, index]));
  player.intent = retained;
  const values = liveV2PlayerTransactionValues(player);
  assert.equal(JSON.stringify(Object.keys(values)), JSON.stringify(original));
  for (const key of original) assert.equal(values[key], player[key], key);
  assert.equal(values.intent, retained, 'intent objects that keep live footballer references are captured by reference');
  const sparse = liveV2PlayerTransactionValues({ x: 1 });
  assert.equal(JSON.stringify(Object.keys(sparse)), JSON.stringify(original), 'absent fields are still present (as undefined), exactly as Object.fromEntries produced them');
  assert.equal(sparse.y, undefined);
});

test('host log scan finds the same last engine-authority event as copying and reversing the whole log', () => {
  const context = {};
  vm.runInNewContext(sourceBetween(matchHtml, 'const liveV2AuthorityScan', 'function recordLiveV2Authority') + '\nthis.api={liveV2LastEngineAuthorityEvent};', context);
  const { liveV2LastEngineAuthorityEvent } = context.api;
  const reference = events => [...events].reverse().find(event => event.type === 'engine-authority');
  const random = lcg(31102026);
  const events = [];
  const check = () => assert.equal(liveV2LastEngineAuthorityEvent(events), reference(events));
  check();
  for (let step = 0; step < 4000; step += 1) {
    const roll = random();
    if (roll < 0.70) events.push({ type: random() < 0.02 ? 'engine-authority' : 'pass', seq: step });
    else if (roll < 0.80 && events.length) events.length = Math.max(0, events.length - Math.floor(random() * 6)); // rollback truncation
    else if (roll < 0.85 && events.length > 20) events.splice(0, 10); // front trim
    else if (roll < 0.87) events.push({ type: 'engine-authority', seq: step });
    check();
  }
  const other = [{ type: 'engine-authority', seq: 'other-log' }];
  assert.equal(liveV2LastEngineAuthorityEvent(other), other[0], 'a replaced log is rescanned');
});

// ---- Adapter public frame ---------------------------------------------------------------

test('adapter public frame keeps the live projection eager and clones diagnostic fields once, frozen, on first read', () => {
  const adapterSource = fs.readFileSync(path.join(engineDir, 'live-v2-authority-adapter.js'), 'utf8');
  const code = sourceBetween(adapterSource, '  function clone(value) {', '  function deepFreeze(value, seen) {');
  const context = {};
  vm.runInNewContext(code + '\nthis.api={clone,createPublicFrame,freezeFreshTree};', context);
  const { createPublicFrame } = context.api;
  const privateFrame = {
    schema: 's', version: 'v', planSequence: 3, snapshotTick: 9,
    hostProjection: { ball: { x: 1 }, movement: [{ id: 'a', x: 1 }] },
    formation: { you: { targets: [{ id: 'a', target: { x: 1, y: 2 } }] } }, cpu: { you: { runs: [1, 2] } },
    movementTelemetry: { contacts: [] }, ballTrace: { events: [{ type: 'contact' }] }, contact: null, dribbling: { telemetry: { n: 1 } }
  };
  const frame = createPublicFrame(privateFrame);
  assert.equal(JSON.stringify(Object.keys(frame)), JSON.stringify(['schema', 'version', 'planSequence', 'snapshotTick', 'hostProjection', 'formation', 'cpu', 'movementTelemetry', 'ballTrace', 'contact', 'dribbling']));
  assert.ok(Object.isFrozen(frame) && Object.isFrozen(frame.hostProjection) && Object.isFrozen(frame.hostProjection.movement[0]));
  assert.notEqual(frame.hostProjection, privateFrame.hostProjection, 'the live projection is a detached copy');
  const cpu = frame.cpu;
  assert.equal(frame.cpu, cpu, 'a diagnostic field is cloned once and then memoised');
  assert.notEqual(cpu, privateFrame.cpu);
  assert.equal(JSON.stringify(frame), JSON.stringify({ ...privateFrame }));
  assert.ok(Object.isFrozen(frame.cpu.you.runs));
  assert.throws(() => { frame.cpu.you.runs.push(3); }, TypeError);
  assert.equal(frame.contact, null);
  privateFrame.ballTrace.events[0].type = 'mutated-after';
  assert.ok(['contact', 'mutated-after'].includes(frame.ballTrace.events[0].type));
});

// ---- Page weight and graphics tiers ---------------------------------------------------------

test('the live page loads three.js once, and no retired shadow or dormant-kernel script', () => {
  const threeTags = matchHtml.split('\n').filter(line => !line.includes('document.write')).join('\n').match(/<script[^>]+src="[^"]*three[^"]*"/g) || [];
  assert.equal(threeTags.length, 1, 'one local three.js tag');
  const fallbacks = matchHtml.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js/g) || [];
  assert.equal(fallbacks.length, 1);
  assert.match(matchHtml, /if\(!window\.THREE\)\{document\.write\('<script src="https:\/\/cdnjs/, 'the CDN copy is a fallback that runs only if the local copy failed');
  assert.doesNotMatch(matchHtml, /ball-physics\.js|build173V2ShadowPreflight|ball-shadow-bridge-v2\.js|overhaul-shadow-orchestrator-v2\.js|build173-live-shadow-adapter-v2|build173-live-shadow-hook-v2\.js|build173-shadow-host-capture-v2/);
  assert.doesNotMatch(matchHtml, /attachBuild173V2Shadow|finishBuild173ShadowBeforeFullTime|build173V2Shadow\b/);
});

function governorApi() {
  const code = sourceBetween(matchHtml, '  const RENDER_TIERS=[', '  const renderTierRequest=') + sourceBetween(matchHtml, '  function renderGovernorSummary(', '  function applyRenderTier(){');
  const context = {};
  vm.runInNewContext(code + '\nthis.api={RENDER_TIERS,RENDER_GOVERNOR_SETTINGS,renderGovernorDecide,renderGovernorSummary};', context);
  return context.api;
}

test('tier 0 is the shipping look and the lighter tiers only ever reduce render cost', () => {
  const { RENDER_TIERS } = governorApi();
  assert.equal(RENDER_TIERS.length, 4);
  const full = RENDER_TIERS[0];
  assert.equal(full.id, 'full');
  assert.equal(full.pixelScale, 1);
  assert.equal(full.crowdDetail, 0);
  assert.ok(full.crowdArms && full.crowdFigures && full.streetDecor);
  assert.equal(full.waveStride, 1);
  assert.equal(full.armStride, 4, 'the original every-4th-frame arm animation');
  assert.equal(full.actorDetailDistance, Infinity);
  for (let i = 1; i < RENDER_TIERS.length; i += 1) {
    const lighter = RENDER_TIERS[i], heavier = RENDER_TIERS[i - 1];
    assert.ok(lighter.pixelScale < heavier.pixelScale, 'pixel scale falls with each tier');
    assert.ok(lighter.waveStride >= heavier.waveStride, 'crowd wave updates never speed up');
    assert.ok(lighter.crowdDetail >= heavier.crowdDetail, 'crowd geometry never gets heavier');
    assert.ok(lighter.actorDetailDistance <= heavier.actorDetailDistance);
    assert.ok(heavier.crowdArms || !lighter.crowdArms);
    assert.ok(heavier.crowdFigures || !lighter.crowdFigures);
    assert.ok(heavier.streetDecor || !lighter.streetDecor);
  }
  assert.ok(RENDER_TIERS.every(tier => tier.pixelScale >= 0.5), 'never below half resolution');
});

test('the governor steps down only for a sustained slow render window and never for a fast, marginal or simulation-bound one', () => {
  const { renderGovernorDecide, RENDER_GOVERNOR_SETTINGS } = governorApi();
  const window = (ms, count = RENDER_GOVERNOR_SETTINGS.windowFrames) => Array(count).fill(ms);
  const decide = (frames, simulation, tier = 0) => renderGovernorDecide(frames, simulation, tier);
  assert.equal(decide(window(16.7), window(3)).step, false, '60 fps stays on tier 0');
  assert.equal(decide(window(8.3), window(3)).step, false, 'a 120 Hz display stays on tier 0');
  assert.equal(decide(window(20), window(3)).step, false, '50 fps is still acceptable');
  assert.equal(decide(window(33.3), window(4)).step, true, '30 fps steps down');
  assert.equal(decide(window(50), window(4)).step, true);
  assert.equal(decide([...window(17, 60), ...window(60, 30)], window(3)).step, false, 'occasional stalls on a fast device do not step down');
  assert.equal(decide([...window(19.5, 40), ...window(40, 50)], window(3)).step, true, 'a mostly slow window with heavy stalls steps down');
  assert.equal(decide(window(33.3), window(25)).step, false, 'a device whose frame is mostly simulation cost is not helped by lighter graphics');
  assert.equal(decide(window(40), window(4), 3).step, false, 'the lightest tier is the floor');
  assert.equal(decide([], []).step, false, 'no frames, no decision');
});

test('the render governor and tiers touch no match state', () => {
  const governor = sourceBetween(matchHtml, '  // ===== Automatic lighter graphics for weak devices =====', '  const scene=new THREE.Scene();');
  for (const forbidden of [/\bball\./, /\byou\b/, /\bopp\b/, /\bposs\b/, /clockFrames/, /youScore|oppScore/, /liveV2/, /\blogEvent\(/, /report\.events/]) {
    assert.doesNotMatch(governor.replace(/\/\/.*$/gm, ''), forbidden, String(forbidden));
  }
  assert.match(governor, /\?renderTier=0\.\.3 pins/);
  assert.match(matchHtml, /renderGovernor\.mode==='high'|mode:RENDER_HIGH_QUALITY\?'high'/);
});
