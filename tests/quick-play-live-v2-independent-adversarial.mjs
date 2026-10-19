import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'match-engine');
const require = createRequire(import.meta.url);
const Adapter = require(path.join(engine, 'live-v2-authority-adapter.js'));
const Ball = require(path.join(engine, 'ball-engine-v2.js'));
const Movement = require(path.join(engine, 'movement-engine-v2.js'));
const CPU = require(path.join(engine, 'cpu-intelligence-v2.js'));
const Formation = require(path.join(engine, 'formation-behaviour-v2.js'));
const Contact = require(path.join(engine, 'live-v2-contact-authority-composer.js'));
const Dribbling = require(path.join(engine, 'dribbling-state-v2.js'));
const matchSource = readFileSync(path.join(engine, 'match.html'), 'utf8');
const adapterSource = readFileSync(path.join(engine, 'live-v2-authority-adapter.js'), 'utf8');
const contactSource = readFileSync(path.join(engine, 'live-v2-contact-authority-composer.js'), 'utf8');
const historicSource = readFileSync(path.join(root, 'quick-play', 'historic-playtest-squads.js'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const dependencies = { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Contact, dribbling: Dribbling };

function capability(extra = {}) {
  return Adapter.createCapability({
    acknowledgement: Adapter.ACKNOWLEDGEMENT,
    workflow: 'single-player', online: false, onlineMarkers: {}, ...extra
  });
}

function canonicalLineup(teamId) {
  return Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }));
}

function snapshot(tick = 1, overrides = {}) {
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId, formation: '4-3-3', phase: teamId === 'you' ? 'settled-attack' : 'defend',
    philosophy: teamId === 'you' ? 'ancelotti-bbc-433' : null,
    attackingDirection: teamId === 'you' ? 1 : -1,
    offsideLine: teamId === 'you' ? 90 : 15, tactics: {}, lineup: canonicalLineup(teamId)
  }));
  const players = [];
  for (const team of teams) {
    const shape = Formation.resolve({
      formation: team.formation, phase: team.phase, tick, lineup: team.lineup,
      pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
      attackingDirection: team.attackingDirection, offsideLine: team.offsideLine, tactics: {}
    });
    for (const target of shape.targets) players.push({
      id: target.playerId, teamId: team.id, role: target.position, position: target.position,
      slotId: target.slotId, x: target.target.x, y: target.target.y, vx: 0, vy: 0,
      fx: team.attackingDirection, fy: 0, radius: 0.42, stamina: 100,
      attrs: { pace: 88, accel: 88, agility: 88, balance: 88, strength: 88, stamina: 88,
        awareness: 90, pass: 90, shoot: 88, control: 90, defend: 88, aggression: 88 },
      isGK: target.position === 'GK', sentOff: false, tackleActive: false, shoulderActive: false, control: null
    });
  }
  const ownerId = overrides.ownerId === undefined ? 'you-CAM' : overrides.ownerId;
  const owner = ownerId && players.find(player => player.id === ownerId);
  if (owner) owner.control = { x: 1, y: 0, strength: 1, sprint: true };
  const targetId = overrides.targetId || null;
  const source = players.find(player => player.id === (overrides.sourcePlayerId || ownerId || 'you-CAM'));
  const ball = {
    id: 'live-ball', x: source?.x ?? 52.5, y: source?.y ?? 0, z: 0, vx: 0, vy: 0, zv: 0,
    spin: 0, dip: 0, ownerId, targetId, lastKickerId: overrides.lastKickerId || null,
    flightType: overrides.flightType || '', launchIntent: overrides.launchIntent || null,
    ...(overrides.ball || {})
  };
  return {
    tick, fixedTickSeconds: 1 / 60, pitch: { xMin: 0, xMax: 105, yMin: -34, yMax: 34 },
    units: { xPerMetre: 1, yPerMetre: 1, zPerMetre: 1 }, players,
    humanPlayerIds: overrides.humanPlayerIds || (owner ? [owner.id] : []), ball, teams,
    contact: overrides.contact || {
      intendedReceiverId: targetId, firstTouchIntent: null, aerialIntent: null,
      gate: { livePlay: true, restartActive: false, replayActive: false,
        keeperAuthority: false, offsideInvolvementPending: false, specialActionAuthority: false }
    }
  };
}

function attachment(host, options = {}) {
  return Adapter.createAttachment({
    enabled: true, capability: capability(), seed: options.seed || 173173,
    dependencies, host
  });
}

function preflight(query, payload) {
  const script = matchSource.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'offline live preflight must remain extractable');
  const encoded = payload == null ? '' : Buffer.from(JSON.stringify(payload)).toString('base64url');
  const writes = [];
  const context = vm.createContext({
    URLSearchParams, TextDecoder, Uint8Array,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    location: { search: query, hash: encoded ? `#flMatch=${encoded}` : '' },
    document: { write: value => writes.push(value) }, window: {}
  });
  vm.runInContext(script, context, { filename: 'offlineLiveV2Preflight.vm.js' });
  return { value: JSON.parse(JSON.stringify(context.window.__FL_V2_LIVE_PREFLIGHT)), writes };
}

function validPayload(seed = 173173) {
  return {
    mode: 'quickPlay', matchType: 'single-player', online: null,
    controllers: { player1Team: 'home', player2Team: null, aiTeam: 'away' },
    engine: { requested: 'fl-v2', effective: 'fl-v2', version: Adapter.VERSION, fallbackReason: null },
    simulationSeed: seed, practiceMode: null,
    homeTeam: { id: 'madrid-real-2013-14', name: 'Madrid 2013/14' },
    awayTeam: { id: 'woolwich-arsenal', name: 'Arsenal Invincibles' }
  };
}

function cpuPayload(seed = 173173) {
  return {
    ...validPayload(seed),
    matchType: 'spectator',
    controllers: { player1Team: null, player2Team: null, aiTeam: 'both' }
  };
}

function protectedBuild173Payload(seed = 173173, matchType = 'co-op') {
  return {
    ...validPayload(seed),
    matchType,
    controllers: matchType === 'co-op'
      ? { player1Team: 'home', player2Team: 'away', aiTeam: null }
      : { player1Team: 'home', player2Team: 'home', aiTeam: 'away', cooperative: true },
    engine: { requested: 'build-173', effective: 'build-173', version: Adapter.VERSION, fallbackReason: null }
  };
}

test('frozen promotion bytes and lower-engine contracts are exact', () => {
  assert.equal(hash(adapterSource), '204dc528cfae88641c06d271a5a195f003ef9058f36ba3220587788d031ac521');
  assert.equal(hash(matchSource), '52e7a3d73d40305568cdd275b5f1bd11e03e718cdc549a66662acbd1b663a753');
  assert.equal(Adapter.VERSION, '1.0.0-offline-live-authority-playtest');
  assert.deepEqual([...Adapter.SUPPORTED_WORKFLOWS], ['single-player', 'cpu-v-cpu']);
  assert.equal(Ball.VERSION, Adapter.DEPENDENCY_CONTRACTS.ball.version);
  assert.equal(Movement.VERSION, Adapter.DEPENDENCY_CONTRACTS.movement.version);
  assert.equal(CPU.VERSION, Adapter.DEPENDENCY_CONTRACTS.cpu.version);
  assert.equal(Formation.VERSION, Adapter.DEPENDENCY_CONTRACTS.formation.version);
  assert.equal(Contact.VERSION, Adapter.DEPENDENCY_CONTRACTS.contact.version);
  assert.equal(Dribbling.VERSION, Adapter.DEPENDENCY_CONTRACTS.dribbling.version);
  assert.match(adapterSource,
    /const deliberatePass = Boolean\(intendedReceiverId\) && !\/\(shot\|penalty\|direct-free-kick\)\/\.test\(releaseDescriptor\)/,
    'only a deliberate receiver-authored pass may create the reaction stimulus');
  assert.match(adapterSource, /reactionStimulus: deliberatePass \? \{/);
  assert.match(adapterSource, /stimulus: 'deliberate-pass-release'/);
  assert.match(adapterSource, /snapshot\.tick <= stimulus\.releaseTick \+ dependencies\.contact\.MAX_REACTION_DELAY_TICKS/);
  assert.match(adapterSource, /lastKickerTeamId && lastKickerTeamId !== domain\.possession\.teamId/,
    'an external opposing touch must terminate the authored flight');
  assert.match(adapterSource, /contactActor\.teamId !== possession\.teamId/,
    'a same-tick retained opposition contact must neutralise the old flight contract');
  assert.match(contactSource,
    /if \(!request\.reactionContext \|\| !candidate\.roster\.bodyContactEligible\) return null/,
    'MR passive player-body probing must be impossible outside a deliberate-pass reaction context');
  assert.match(contactSource, /Ball\.resolvePassiveBodyDeflection\(request\.ballState/);
  assert.match(contactSource, /contactType: 'involuntary-deflection', ownerCandidateId: null/);
  assert.match(contactSource, /outfieldBallBlock: true/);
});

test('capabilities fail closed against forgery, online markers and unsupported workflows', () => {
  assert.throws(() => Adapter.createAttachment({
    enabled: true,
    capability: { schema: 'football-legacy-live-v2-capability', version: Adapter.VERSION,
      grant: 'offline-normal-match-live-authority', workflow: 'single-player', offlineOnly: true,
      online: false, onlineMarkerDigest: 'none' }, dependencies, host: { prepareTick() {} }
  }), /issued offline live V2 capability/);
  assert.throws(() => capability({ online: true }), /online must be explicitly false/);
  assert.throws(() => capability({ onlineMarkers: { room: 'ABCD' } }), /online markers freeze/);
  assert.throws(() => capability({ workflow: 'co-op' }), /unsupported live V2 workflow/);
});

test('planning is immutable and commit is exact-once and exactly sequential', () => {
  let hostCommits = 0;
  const live = attachment({ prepareTick() { return { commit() { hostCommits += 1; }, rollback() { hostCommits -= 1; } }; } });
  const before = live.status();
  const frame1 = live.planTick(snapshot(1));
  assert.ok(frame1 && Object.isFrozen(frame1) && Object.isFrozen(frame1.hostProjection));
  assert.deepEqual(live.status().possession, before.possession, 'plan may not consume committed possession');
  assert.throws(() => { frame1.hostProjection.snapshotTick = 99; }, TypeError);
  assert.equal(live.commitTick(frame1), true);
  assert.equal(live.commitTick(frame1), false, 'same public token cannot commit twice');
  assert.equal(hostCommits, 1);
  const second = snapshot(2);
  const byId = Object.fromEntries(frame1.hostProjection.movement.map(row => [row.id, row]));
  second.players.forEach(player => { if (byId[player.id]) Object.assign(player, byId[player.id]); });
  const frame2 = live.planTick(second);
  assert.ok(frame2);
  assert.equal(live.commitTick(frame2), true);
  assert.equal(live.status().lastCommittedTick, 2);
  assert.equal(live.status().committedTicks, 2);
});

test('host failure rolls back the whole tick and self-freezes to Build 173', () => {
  const state = { movement: 0, intelligence: 0, ball: 0 };
  const live = attachment({ prepareTick() { const saved = { ...state }; return {
    commit() { state.movement = 1; state.intelligence = 1; throw new Error('host intelligence fault'); },
    rollback() { Object.assign(state, saved); }
  }; } });
  const frame = live.planTick(snapshot(1));
  assert.ok(frame);
  assert.equal(live.commitTick(frame), false);
  assert.deepEqual(state, { movement: 0, intelligence: 0, ball: 0 });
  assert.equal(live.status().enabled, false);
  assert.equal(live.status().authority, 'build-173');
  assert.match(live.status().failure, /host intelligence fault/);
  assert.equal(live.status().committedTicks, 0);
});

test('ordinary pass rollback capture preserves circular Build 173 runtime references without JSON traversal', () => {
  const captureStart = matchSource.indexOf('function liveV2CaptureTransactionState');
  const captureEnd = matchSource.indexOf('function liveV2ApplyMovement', captureStart);
  assert.ok(captureStart > 0 && captureEnd > captureStart);
  const capture = matchSource.slice(captureStart, captureEnd);
  assert.match(capture, /values:Object\.fromEntries\(playerKeys\.map\(key=>\[key,player\[key\]\]\)\)/);
  assert.match(capture, /actionPowerFeedback:\{\.\.\.actionPowerFeedback\}/);
  assert.match(capture, /brains:\{you:\{\.\.\.TEAM_BRAIN\.you\},opp:\{\.\.\.TEAM_BRAIN\.opp\}\}/);
  assert.doesNotMatch(capture, /liveV2Clone\(player\[key\]\)/);
  assert.doesNotMatch(capture, /actionPowerFeedback:liveV2Clone/);
  assert.doesNotMatch(capture, /brains:\{you:liveV2Clone/);
  const actor = { id: 'passer' };
  const scan = { teammates: [{ player: actor }] };
  actor.scan = scan;
  assert.throws(() => JSON.stringify(actor), /circular/i, 'fixture must reproduce the prior browser P0');
  const values = { intent: actor, aiTarget: scan };
  const feedback = { you: { action: 'pass', actor } };
  const brains = { you: { scan }, opp: {} };
  assert.equal(values.intent, actor);
  assert.equal({ ...feedback }.you.actor, actor);
  assert.equal({ ...brains.you }.scan, scan);
});

test('a launch owns released-ball flight while retaining team, receiver and offside context', () => {
  let applied;
  const live = attachment({ prepareTick(projection) { return { commit() { applied = projection; }, rollback() { applied = null; } }; } });
  const source = snapshot(1).players.find(player => player.id === 'you-CAM');
  const target = snapshot(1).players.find(player => player.id === 'you-ST');
  const launch = {
    sequence: 'independent-pass-1', sourcePlayerId: source.id, targetPlayerId: target.id,
    origin: { x: source.x, y: source.y, z: 0 }, target: { x: target.x, y: target.y }, direction: { x: 1, y: 0 },
    speedMetresPerSecond: 20, liftAngleDeg: 5, sideSpinRpm: 0, topSpinRpm: 0,
    source: 'ground-pass', offsideCandidate: { playerId: target.id, mistimedEarly: true }
  };
  const frame = live.planTick(snapshot(1, {
    ownerId: null, sourcePlayerId: source.id, targetId: target.id, lastKickerId: source.id,
    flightType: 'ground-pass', launchIntent: launch, humanPlayerIds: ['you-CAM']
  }));
  assert.ok(frame, JSON.stringify(live.status()));
  assert.ok(frame.hostProjection.ball, 'Ball V2 must integrate the released ball');
  assert.ok(frame.hostProjection.ball.x > source.x, 'a positive-x launch must advance toward its intended target');
  const possession = frame.hostProjection.possession;
  assert.equal(possession.teamId, 'you');
  assert.equal(possession.ownerId, null);
  assert.equal(possession.inFlight, true);
  assert.equal(possession.intendedReceiverId, target.id);
  assert.deepEqual(possession.intendedTarget, launch.target);
  assert.ok(Number.isFinite(possession.intendedTargetWindowMetres) &&
    possession.intendedTargetWindowMetres >= 1.5 && possession.intendedTargetWindowMetres <= 3.25);
  assert.equal(possession.arrivalWindowEntered, false);
  assert.equal(possession.releaseTick, 1);
  assert.equal(possession.deliberatePass, true);
  assert.deepEqual(possession.reactionStimulus, {
    releaseTick: 1,
    sourcePlayerId: source.id,
    sourceTeamId: source.teamId
  });
  assert.deepEqual(possession.offsideCandidate, launch.offsideCandidate);
  assert.equal(live.commitTick(frame), true);
  assert.ok(applied.ball);
  assert.equal(live.status().committedBallTicks, 1);
  assert.equal(live.status().possession.teamId, 'you');
  assert.equal(live.status().possession.intendedReceiverId, target.id);
});

test('late Build 173 release resynchronises Ball V2 chronology to the current contact tick', () => {
  const live = attachment({ prepareTick() { return { commit() {}, rollback() {} }; } });
  let prior = snapshot(1);
  for (let tick = 1; tick <= 97; tick += 1) {
    prior.tick = tick;
    const frame = live.planTick(prior);
    assert.ok(frame, `owned tick ${tick}`);
    assert.equal(live.commitTick(frame), true, `commit owned tick ${tick}`);
    if (tick < 97) prior = snapshot(tick + 1);
  }
  const source = snapshot(98).players.find(player => player.id === 'you-CAM');
  const target = snapshot(98).players.find(player => player.id === 'you-ST');
  const launch = {
    sequence: 'late-pass-at-98', sourcePlayerId: source.id, targetPlayerId: target.id,
    origin: { x: source.x, y: source.y, z: 0 }, direction: { x: 1, y: 0 },
    speedMetresPerSecond: 20, liftAngleDeg: 5, sideSpinRpm: 0, topSpinRpm: 0,
    source: 'ground-pass', offsideCandidate: null
  };
  const frame98 = live.planTick(snapshot(98, {
    ownerId: null, sourcePlayerId: source.id, targetId: target.id, lastKickerId: source.id,
    flightType: 'ground-pass', launchIntent: launch, humanPlayerIds: [source.id]
  }));
  assert.ok(frame98, JSON.stringify(live.status()));
  assert.ok(frame98.hostProjection.ball, 'the late release must be projected by Ball V2');
  assert.equal(frame98.ballTrace.start.outerTick, 97);
  assert.equal(frame98.ballTrace.end.outerTick, 98,
    'Ball V2 chronology must align to the host release tick even before a receiver contact exists');
  assert.equal(live.commitTick(frame98), true);
  assert.equal(live.status().enabled, true);
  assert.equal(live.status().lastCommittedTick, 98);
});

test('deterministic replay, bounded finite telemetry and reset epoch re-arm at tick one', () => {
  const traces = [];
  for (let run = 0; run < 2; run += 1) {
    const out = [];
    const live = attachment({ prepareTick(projection) { return { commit() { out.push(projection); }, rollback() { out.pop(); } }; } }, { seed: 99173 });
    const frame = live.planTick(snapshot(1)); assert.equal(live.commitTick(frame), true);
    const reset = live.reset('independent-restart');
    assert.equal(reset.resetEpoch, 1);
    assert.equal(live.status().lastCommittedTick, -1);
    const replay = live.planTick(snapshot(1)); assert.equal(live.commitTick(replay), true);
    const telemetryText = JSON.stringify(live.status().latestTelemetry);
    assert.ok(telemetryText.length > 0 && telemetryText.length < 500000);
    assert.equal(/(?:NaN|Infinity)/.test(telemetryText), false);
    traces.push(out);
  }
  assert.deepEqual(traces[0], traces[1]);
});

test('preflight loads only exact V2-only Single Player or all-CPU spectator contracts', () => {
  const good = preflight('?quickPlay=1&engine=fl-v2&simulationSeed=173173&candidate=5', validPayload());
  assert.equal(good.value.eligible, true);
  assert.equal(good.value.workflow, 'single-player');
  assert.equal(good.writes.length, 15);
  const cpuGood = preflight('?quickPlay=1&engine=fl-v2&simulationSeed=173173&candidate=5&autoplay=1', cpuPayload());
  assert.equal(cpuGood.value.eligible, true);
  assert.equal(cpuGood.value.workflow, 'cpu-v-cpu');
  assert.equal(cpuGood.writes.length, 15);
  for (const mode of ['co-op', 'home-co-op']) {
    const protectedFallback = preflight('?quickPlay=1&engine=build-173&simulationSeed=173173&candidate=5', protectedBuild173Payload(173173, mode));
    assert.equal(protectedFallback.value.requested, false, `${mode} must not arm V2`);
    assert.equal(protectedFallback.value.eligible, false, `${mode} has no playable prior-engine fallback`);
    assert.equal(protectedFallback.value.reason, 'not-requested', `${mode} preflight reason`);
    assert.equal(protectedFallback.writes.length, 0, `${mode} must not load V2 scripts`);
  }
  for (const [query, payload] of [
    ['?engine=fl-v2&simulationSeed=173173', cpuPayload()],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=0', cpuPayload()],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1&autoplay=1', cpuPayload()],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1', { ...cpuPayload(), controllers: { player1Team: 'home', player2Team: null, aiTeam: 'away' } }],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1', { ...cpuPayload(), controllers: { player1Team: null, player2Team: 'away', aiTeam: 'you' } }],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1', { ...cpuPayload(), controllers: { player1Team: null, player2Team: null, aiTeam: 'both', cooperative: true } }],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1', { ...cpuPayload(), controllers: { player1Team: null, player2Team: null, aiTeam: 'both', online: true } }],
    ['?engine=fl-v2&simulationSeed=173173&autoplay=1', { ...cpuPayload(), online: { protocol: 'football-legacy-online-v1' } }]
  ]) {
    const result = preflight(query, payload);
    assert.equal(result.value.eligible, false);
    assert.equal(result.writes.length, 0);
  }
  for (const [query, mutate] of [
    ['', null],
    ['?engine=fl-v2&engine=fl-v2&simulationSeed=173173', null],
    ['?engine=fl-v2&simulationSeed=0', payload => { payload.simulationSeed = 0; }],
    ['?engine=fl-v2&simulationSeed=173173&mode=online', null],
    ['?engine=fl-v2&simulationSeed=173173&matchType=co-op', null],
    ['?engine=fl-v2&simulationSeed=173173&v2Shadow=1', null]
  ]) {
    const payload = query === '' ? null : validPayload();
    if (payload && mutate) mutate(payload);
    const result = preflight(query, payload);
    assert.equal(result.value.eligible, false, query || 'default');
    assert.equal(result.writes.length, 0, query || 'default');
  }
});

test('live hook is exact-one while MR suppression leaves protected Build 173 wall, keeper and non-pass authority intact', () => {
  const callCount = (matchSource.match(/const liveV2LiveTick=liveV2RunTick\(\)/g) || []).length;
  assert.equal(callCount, 1);
  for (const gate of [
    'if(!liveV2LiveTick&&controlled)',
    'if(!liveV2LiveTick)updateSecondHumanPlayer()',
    "if(!liveV2LiveTick){liveV2AuthorityCounters.legacyCpu++",
    'else if(!liveV2LiveTick||p.isGK||liveV2HostOwnsPlayer(p))',
    'if(!liveV2LiveTick&&!kickoffHeld)',
    'if(!liveV2LiveTick)resolveShoulderContact()',
    'if(!liveV2OwnsLooseBall){liveV2AuthorityCounters.legacyLooseBallIntegration++',
    'if(!liveV2OwnsLooseBall)for(const gx of [M,W-M])'
  ]) assert.ok(matchSource.includes(gate), gate);
  const intelligenceBlock = matchSource.slice(matchSource.indexOf('function liveV2ApplyIntelligence'), matchSource.indexOf('function liveV2ApplyBall'));
  assert.doesNotMatch(intelligenceBlock, /\baiPass\s*\(|\baiShoot\s*\(/);
  assert.match(matchSource,
    /resolveSetPieceWallBlock\(\);if\(!liveV2TickApplied\|\|!liveV2SuppressLegacyBallBlock\)resolveBallBlock\(\);if\(!liveV2SuppressLegacyAerialDuel\)resolveAerialDuel\(false\)/,
    'legacy outfield blocking is suppressed only on an MR-authored V2 contact tick');
  assert.match(matchSource,
    /const boxKeeper=[^;]+,keeperShotResolved=resolveKeeperBoxShotContest\(boxKeeper\);if\(!keeperShotResolved\)resolveSlowReachableKeeperSaveBeforeGoal\(\)/,
    'keeper contact remains in the protected Build 173 lane');
  assert.match(matchSource, /legacyKeeperContactEligible\(ball,keeperShotResolved\)/,
    'legacy keeper contact must remain closed after the box-shot authority resolves the frame');
  assert.match(adapterSource, /firstTouchReception: 'football-legacy-live-v2-contact-authority-composer'/);
  assert.match(adapterSource, /aerialVolleyAttempt: 'football-legacy-live-v2-contact-authority-composer'/);
  assert.match(adapterSource, /looseBallRecoverySelection: 'football-legacy-live-v2-authority-adapter'/);
  assert.match(adapterSource, /wallKeeperAndOutfieldBodyBlock: 'build-173-explicit-contact-handoff'/);
});

test('composed live bridge applies restart and Suite commands honestly and exactly once', () => {
  const applyStart = matchSource.indexOf('function liveV2ApplyControlCommand');
  const applyEnd = matchSource.indexOf('function liveV2PrepareControl', applyStart);
  const apply = matchSource.slice(applyStart, applyEnd);
  for (const command of [
    'audio.whistle.play', 'gameplay.freeze', 'assistant-referee.select', 'camera.pan',
    'assistant-referee.flag', 'camera.restore', 'restart.free-kick.handoff',
    'setpiece.setup.handoff', 'ball.launch.handoff', 'camera.policy.apply',
    'clock.period-transition.handoff'
  ]) assert.ok(apply.includes(`command.type==='${command}'`), command);
  assert.match(apply, /throw new Error\('unrecognized FL V2 match-control command:/);
  assert.match(matchSource, /appliedCommandIds\.push\(command\.id\)/);
  assert.match(matchSource, /function liveV2ControlReceiptMatches\(appliedCommandIds,requiredCommandIds\)/);
  assert.match(matchSource, /applied\.length===required\.length&&applied\.every\(\(id,index\)=>id===required\[index\]\)/);
  assert.match(matchSource, /if\(!liveV2ControlReceiptMatches\(appliedCommandIds,plan\.requiredCommandIds\)\)/);
  assert.doesNotMatch(matchSource, /appliedCommandIds:plan\.requiredCommandIds/);
});

test('offside entry, Suite lifecycle, live aim and menu are wired to real host boundaries', () => {
  const offsideStart = matchSource.indexOf('function beginOffsidePresentation');
  const offsideEnd = matchSource.indexOf('function updateOffsidePresentation', offsideStart);
  const offside = matchSource.slice(offsideStart, offsideEnd);
  assert.match(offside, /const v2RestartOwnsEntry=/);
  assert.match(offside, /if\(!v2RestartOwnsEntry\)\{whistle\(\)/);
  assert.equal((offside.match(/whistle\(\)/g) || []).length, 1);

  assert.match(matchSource, /liveV2QueueSuiteEvent\('arm',\{launch:\{target:canonicalTarget,/);
  assert.match(matchSource, /metadata:\{technique,shotLabel,power:\+p\.toFixed\(3\),paceMps:Number\(paceMps\)\|\|null,arrivalMs:Number\(arrivalMs\)\|\|null,liveAim:true\}/);
  assert.match(matchSource, /liveV2QueueSuiteEvent\('contact',\{contact:\{kind:'keeper-contact'/);
  assert.match(matchSource, /resolveResult:'saved'/);
  assert.match(matchSource, /consumedSuiteEvent\.action==='arm'.*liveV2QueueSuiteEvent\('launch'\)/);
  assert.match(matchSource, /consumedSuiteEvent\.action==='contact'.*liveV2QueueSuiteEvent\('resolve'/);
  assert.match(matchSource, /consumedSuiteEvent\.action==='resolve'\)\{liveV2SuiteShotActive=false;\}/,
    'a resolved attempt must clear the active-shot guard without silently starting another trial');
  assert.match(matchSource, /function liveV2RequestSuiteRepeat\(device='controller'\).*liveV2SuiteRepeatBlocker\(\).*liveV2QueueSuiteEvent\('repeat'/,
    'repeat remains an explicit controller or keyboard workflow after resolution');

  assert.match(matchSource, /panel\.id='flV2SuiteMenu'/);
  assert.match(matchSource, /liveV2SuiteMenuOpen=!liveV2SuiteMenuOpen;liveV2RenderSuiteMenu\(\)/);
  assert.match(matchSource, /control:'options',pressed:true\}\}\);return;\}controllerPauseToggle\(\)/);
  assert.match(matchSource, /control:'escape',pressed:true\}\}\);return;\}togglePause\(\)/);
});

test('controller, keyboard, restart, replay, camera and red-card containment remain Build 173', () => {
  assert.match(matchSource, /pollGamepad\(\);/);
  assert.match(matchSource, /addEventListener\('keydown'/);
  assert.match(matchSource, /movementInput\(\)/);
  assert.match(adapterSource, /goalkeepersSpecialActionsRenderingRulesRestartsReplays: 'build-173'/);
  assert.match(matchSource, /kickoffHeld\|\|inReset\(\)\|\|!clockRunning/);
  assert.match(matchSource, /offsidePresentation\|\|goalReplay\.active\|\|disciplineReplay\.active/);
  assert.match(matchSource, /\[\.\.\.you,\.\.\.opp\]\.some\(player=>player&&player\.sentOff\)/);
  assert.match(matchSource, /liveV2Authority\.reset\('build-173-dead-ball-presentation-or-special-action-handoff'\)/);
});

test('Madrid BBC identity and historic reaction defaults remain intact while unsupported modes stay visible but disabled', () => {
  assert.equal(hash(historicSource), '4aacd4a33083eee996beace57ba038caf6e5b5a580f1896a9b1d765240b879d5');
  assert.equal((historicSource.match(/reactions:overall/g) || []).length, 4,
    'every historic positional default must now expose reactions');
  assert.match(historicSource,
    /Object\.entries\(\{\.\.\.roleDefaults\(role,overall\),\.\.\.specific\}\)/);
  for (const identity of ['madrid-real-2013-14', 'Ancelotti Real Madrid BBC', 'rm-bale', 'rm-benzema', 'rm-ronaldo']) {
    assert.ok(historicSource.includes(identity), identity);
  }
  const quickPlayHtml = readFileSync(path.join(root, 'quick-play', 'index.html'), 'utf8');
  for (const mode of ['single-player', 'free-kick-suite', 'spectator']) assert.ok(quickPlayHtml.includes(`value="${mode}"`), mode);
  for (const mode of ['co-op', 'home-co-op']) assert.match(quickPlayHtml, new RegExp(`value="${mode}" disabled`), mode);
});
