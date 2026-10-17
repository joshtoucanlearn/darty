import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modulePath = path.join(root, 'match-engine', 'cpu-intelligence-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Intelligence = require(modulePath);

const FIXED_TICK = 1 / 60;

function player(id, teamId, x, y, data = {}) {
  return {
    id,
    teamId,
    x,
    y,
    formationAnchor: { x, y },
    role: 'midfielder',
    position: 'CM',
    pace: 78,
    acceleration: 78,
    awareness: 80,
    passing: 80,
    shooting: 70,
    control: 80,
    stamina: 90,
    ...data
  };
}

function snapshot(data = {}) {
  const players = data.players || [
    player('carrier', 'home', 1200, 1070, { passing: 90, control: 90 }),
    player('runner', 'home', 1420, 500, { role: 'winger', position: 'LW', pace: 92, acceleration: 94 }),
    player('cb-a', 'home', 700, 800, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 700, 1360, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2480, 720, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2500, 1420, { role: 'centre-back', position: 'CB' })
  ];
  return {
    schema: Intelligence.SNAPSHOT_SCHEMA,
    tick: data.tick ?? 10,
    fixedTickSeconds: data.fixedTickSeconds ?? FIXED_TICK,
    teamId: data.teamId || 'home',
    possessionTeamId: data.possessionTeamId ?? 'home',
    carrierId: data.carrierId === undefined ? 'carrier' : data.carrierId,
    attackingDirection: data.attackingDirection ?? 1,
    offsideLine: data.offsideLine ?? 2800,
    pitch: data.pitch || { xMin: 84, xMax: 3260, yMin: 6, yMax: 2136 },
    ball: data.ball || { x: 1200, y: 1070 },
    players,
    events: data.events || []
  };
}

function defensiveSnapshot(tick, data = {}) {
  const players = data.players || [
    player('home-presser', 'home', 1300, 1070, {
      role: 'attacking-midfielder', position: 'CAM', pace: 90, acceleration: 99,
      awareness: 99, defending: 72, aggression: 78, strength: 72, fx: 1, fy: 0
    }),
    player('home-wing', 'home', 820, 320, {
      role: 'winger', position: 'LW', pace: 88, acceleration: 88, awareness: 82
    }),
    player('home-hold', 'home', 1120, 1070, {
      role: 'defensive-midfielder', position: 'CDM', duty: 'hold',
      awareness: 94, defending: 90, strength: 86
    }),
    player('home-cb-a', 'home', 760, 760, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', awareness: 90, defending: 92
    }),
    player('home-cb-b', 'home', 760, 1380, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', awareness: 89, defending: 91
    }),
    player('away-carrier', 'away', 1500, 1070, {
      role: 'striker', position: 'ST', pace: 86, acceleration: 86,
      control: 90, strength: 84, fx: -1, fy: 0
    }),
    player('away-support', 'away', 1750, 1540, { role: 'winger', position: 'RW' })
  ];
  return snapshot({
    tick,
    possessionTeamId: data.possessionTeamId ?? 'away',
    carrierId: data.carrierId === undefined ? 'away-carrier' : data.carrierId,
    players,
    ball: data.ball || { x: 1500, y: 1070 },
    events: data.events || [],
    offsideLine: data.offsideLine ?? 2350,
    attackingDirection: data.attackingDirection ?? 1
  });
}

function assertAllNumbersFinite(value, path = 'decision') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAllNumbersFinite(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) assertAllNumbersFinite(entry, `${path}.${key}`);
  }
}

function defensiveFrameToMetric(frame) {
  const copy = JSON.parse(JSON.stringify(frame));
  const mapPoint = value => ({
    x: (value.x - 84) / 3176 * 105,
    y: (value.y - 6) / 2130 * 68
  });
  copy.pitch = { xMin: 0, xMax: 105, yMin: 0, yMax: 68 };
  copy.offsideLine = (copy.offsideLine - 84) / 3176 * 105;
  copy.ball = mapPoint(copy.ball);
  for (const entry of copy.players) {
    const mapped = mapPoint(entry);
    entry.x = mapped.x;
    entry.y = mapped.y;
    entry.vx = (entry.vx || 0) / 3176 * 105;
    entry.vy = (entry.vy || 0) / 2130 * 68;
    entry.formationAnchor = mapPoint(entry.formationAnchor);
  }
  return copy;
}

test('CommonJS module exposes the complete dormant v2 API', () => {
  assert.equal(Intelligence.VERSION, '2.0.0-dormant');
  assert.equal(Intelligence.SNAPSHOT_SCHEMA, 'football-legacy-cpu-snapshot-v2');
  assert.equal(Intelligence.MEMORY_SCHEMA, 'football-legacy-cpu-memory-v2');
  assert.equal(Intelligence.DECISION_SCHEMA, 'football-legacy-cpu-decision-v2');
  for (const name of ['createMemory', 'validateSnapshot', 'decide', 'createBaleStyleOpenSpaceBeelineFixture']) {
    assert.equal(typeof Intelligence[name], 'function', `${name} must be exported`);
  }
  assert.equal(Intelligence.DEFAULT_CONFIG.fixedTickSeconds, FIXED_TICK);
});

test('plain browser script exposes window.FootballLegacyCPUIntelligenceV2', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow });
  assert.equal(browserWindow.FootballLegacyCPUIntelligenceV2.VERSION, Intelligence.VERSION);
  assert.equal(typeof browserWindow.FootballLegacyCPUIntelligenceV2.decide, 'function');
});

test('EXACT-FLAG AUTHORITY GATE: CPU intelligence has no unconditional load or live call', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']cpu-intelligence-v2\.js/i);
  assert.match(matchHtml, /id="build173V2ShadowPreflight"/);
  assert.doesNotMatch(matchHtml, /FootballLegacyCPUIntelligenceV2/);
  assert.match(source, /intentionally dormant/i);
});

test('engine has no random source or presentation-clock dependency', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
});

test('explicit fixed tick and monotonically advancing simulation ticks are mandatory', () => {
  const missingTick = snapshot();
  delete missingTick.tick;
  assert.throws(() => Intelligence.decide(missingTick), /snapshot\.tick/);
  const missingDuration = snapshot();
  delete missingDuration.fixedTickSeconds;
  assert.throws(() => Intelligence.decide(missingDuration), /fixedTickSeconds/);
  assert.throws(() => Intelligence.decide(snapshot({ fixedTickSeconds: 1 / 30 })), /must match/);
  const first = Intelligence.decide(snapshot({ tick: 20 }));
  assert.throws(() => Intelligence.decide(snapshot({ tick: 20 }), first.memory), /must advance/);
  assert.equal(first.fixedTickSeconds, FIXED_TICK);
});

test('snapshot-to-decision is deterministic, JSON-safe and does not mutate inputs', () => {
  const input = snapshot({ tick: 30 });
  const before = JSON.stringify(input);
  const memory = Intelligence.createMemory();
  const memoryBefore = JSON.stringify(memory);
  const first = Intelligence.decide(input, memory);
  const second = Intelligence.decide(input, memory);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(memory), memoryBefore);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.authority, 'dormant-candidate');
});

test('BALE-STYLE OPEN-SPACE BEELINE: newly opened channel triggers prompt committed acceleration', () => {
  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  assert.equal(fixture.name, 'Bale-style open-space beeline');
  let decision = Intelligence.decide(fixture.snapshots.closed);
  assert.equal(decision.runs.some(run => run.playerId === fixture.runnerId), false, 'closed lanes must not launch the run');

  decision = Intelligence.decide(fixture.snapshots.opened, decision.memory);
  assert.equal(decision.runs.some(run => run.playerId === fixture.runnerId), false, 'reaction tick must be observed, not skipped');
  const perceived = decision.perception.openings.find(event => event.playerId === fixture.runnerId && event.runType === 'channel');
  assert.ok(perceived, 'opening event must be perceived');
  assert.equal(perceived.source, 'event');
  assert.equal(perceived.eligibleTick, fixture.expectedCommitByTick);

  decision = Intelligence.decide(fixture.snapshots.reacted, decision.memory);
  const run = decision.runs.find(entry => entry.playerId === fixture.runnerId);
  assert.ok(run, 'runner must commit by the promised tick');
  assert.equal(decision.tick, fixture.expectedCommitByTick);
  assert.equal(run.runType, 'channel');
  assert.equal(run.state, 'committed');
  assert.equal(run.movementIntent, 'beeline');
  assert.equal(run.accelerate, true);
  assert.equal(run.urgency, 'sprint');
  assert.equal(run.observedOpening, true);
  assert.ok(run.target.x > 2000, 'beeline must attack the newly exposed forward space');
  assert.ok(run.target.x <= fixture.snapshots.reacted.offsideLine - Intelligence.DEFAULT_CONFIG.offsideBuffer);
  assert.ok(decision.telemetry.transitions.some(event => event.type === 'run-committed' && event.playerId === fixture.runnerId));
  assert.equal(decision.carrierIntent.type, 'pass');
  assert.equal(decision.carrierIntent.targetPlayerId, fixture.runnerId);
});

test('committed run persists through a narrowed lane, then aborts deterministically on turnover', () => {
  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  let decision = Intelligence.decide(fixture.snapshots.closed);
  decision = Intelligence.decide(fixture.snapshots.opened, decision.memory);
  decision = Intelligence.decide(fixture.snapshots.reacted, decision.memory);
  const committed = decision.runs.find(run => run.playerId === fixture.runnerId);
  decision = Intelligence.decide(fixture.snapshots.narrowed, decision.memory);
  const persistent = decision.runs.find(run => run.playerId === fixture.runnerId);
  assert.ok(persistent);
  assert.equal(persistent.state, 'persisting');
  assert.equal(persistent.commitTick, committed.commitTick);
  assert.deepEqual(persistent.target, committed.target);
  assert.ok(decision.tick < persistent.minUntilTick);
  decision = Intelligence.decide(fixture.snapshots.turnover, decision.memory);
  assert.equal(decision.runs.some(run => run.playerId === fixture.runnerId), false);
  assert.ok(decision.telemetry.transitions.some(event => event.type === 'run-aborted' &&
    event.playerId === fixture.runnerId && event.reason === 'possession-lost'));
});

test('a persisting run re-clamps its destination when the offside line moves', () => {
  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  let decision = Intelligence.decide(fixture.snapshots.closed);
  decision = Intelligence.decide(fixture.snapshots.opened, decision.memory);
  decision = Intelligence.decide(fixture.snapshots.reacted, decision.memory);
  const committed = decision.runs.find(run => run.playerId === fixture.runnerId);
  assert.ok(committed.target.x > 1770);

  const movingLine = JSON.parse(JSON.stringify(fixture.snapshots.reacted));
  movingLine.tick = 103;
  movingLine.offsideLine = 1800;
  movingLine.events = [];
  decision = Intelligence.decide(movingLine, decision.memory);
  const persistent = decision.runs.find(run => run.playerId === fixture.runnerId);
  assert.ok(persistent);
  assert.equal(persistent.state, 'persisting');
  assert.ok(persistent.target.x <= movingLine.offsideLine - Intelligence.DEFAULT_CONFIG.offsideBuffer);
  const transition = decision.telemetry.transitions.find(event => event.type === 'run-persisted' && event.playerId === fixture.runnerId);
  assert.equal(transition.offsideAdjusted, true);
  assert.deepEqual(transition.target, persistent.target);
});

test('clearance transition derives a new-space event without external event injection', () => {
  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  let decision = Intelligence.decide(fixture.snapshots.closed);
  decision = Intelligence.decide(fixture.snapshots.opened, decision.memory);
  const derived = decision.perception.openings.filter(event => event.source === 'clearance-transition');
  assert.ok(derived.length >= 1);
  assert.ok(derived.every(event => event.previousClearance < event.clearance));
});

test('coordination selects one deterministic winner per penetrating lane', () => {
  const players = [
    player('carrier', 'home', 1100, 1070, { passing: 94 }),
    player('alpha-runner', 'home', 1450, 1000, { role: 'striker', position: 'ST', pace: 92, awareness: 92 }),
    player('beta-runner', 'home', 1450, 1000, { role: 'striker', position: 'ST', pace: 92, awareness: 92 }),
    player('cb-a', 'home', 700, 760, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 700, 1380, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2900, 400, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2900, 1740, { role: 'centre-back', position: 'CB' })
  ];
  const decision = Intelligence.decide(snapshot({ tick: 40, players, offsideLine: 2920 }), null, {
    maximumCommittedRuns: 2
  });
  const penetrating = decision.runs.filter(run => ['central', 'channel', 'underlap', 'overlap', 'late-box'].includes(run.runType));
  const bands = new Set(penetrating.map(run => run.band));
  assert.equal(bands.size, penetrating.length, 'penetrating runs may not collide in one lane band');
  assert.equal(penetrating.some(run => run.playerId === 'alpha-runner'), true, 'stable id tie-break picks alpha');
  assert.ok(decision.telemetry.bids.some(bid => bid.playerId === 'beta-runner' &&
    bid.rejectionReasons.includes('lane-coordination-conflict')));
});

test('offside line clamps targets and rejects a runner already beyond the safe line', () => {
  const players = [
    player('carrier', 'home', 2100, 1070, { passing: 95 }),
    player('safe-winger', 'home', 2450, 420, { role: 'winger', position: 'LW', pace: 96 }),
    player('offside-winger', 'home', 2600, 1680, { role: 'winger', position: 'RW', pace: 96 }),
    player('cb-a', 'home', 1300, 800, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 1300, 1360, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2700, 850, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2710, 1300, { role: 'centre-back', position: 'CB' })
  ];
  const offsideLine = 2600;
  const decision = Intelligence.decide(snapshot({ tick: 50, players, offsideLine }), null, {
    minimumPassLaneClearance: 0
  });
  assert.ok(decision.runs.every(run => run.target.x <= offsideLine - Intelligence.DEFAULT_CONFIG.offsideBuffer));
  assert.equal(decision.runs.some(run => run.playerId === 'offside-winger'), false);
  assert.ok(decision.telemetry.bids.some(bid => bid.playerId === 'offside-winger' &&
    bid.rejectionReasons.includes('already-offside')));
  assert.ok(decision.telemetry.bids.some(bid => bid.playerId === 'safe-winger' && bid.offsideAdjusted));
});

test('onside intent can include a deterministic bounded early-timing mistake', () => {
  const players = [
    player('carrier', 'home', 2100, 1070, { passing: 95, awareness: 92 }),
    player('timing-runner', 'home', 2440, 420, {
      role: 'winger', position: 'LW', pace: 96, acceleration: 95, awareness: 48
    }),
    player('cb-a', 'home', 1300, 800, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 1300, 1360, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2920, 850, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2930, 1300, { role: 'centre-back', position: 'CB' })
  ];
  const offsideLine = 2600;
  const forcedMistake = Intelligence.decide(snapshot({ tick: 55, players, offsideLine }), null, {
    minimumBidScore: 0,
    minimumLaneClearance: 0,
    minimumPassLaneClearance: 0,
    maximumCommittedRuns: 1,
    offsideMistakeBaseRisk: 1,
    offsideMistakeAwarenessRelief: 0,
    offsideMistakePaceRisk: 0,
    offsideMistakeMaxEarlyTicks: 8
  });
  const run = forcedMistake.runs.find(entry => entry.playerId === 'timing-runner');
  assert.ok(run, 'the onside runner must still win a run bid');
  assert.ok(run.target.x <= offsideLine - Intelligence.DEFAULT_CONFIG.offsideBuffer,
    'the immediate movement gate remains onside');
  assert.ok(run.continuationTarget.x > offsideLine - Intelligence.DEFAULT_CONFIG.offsideBuffer,
    'the football run may continue beyond the defensive line after release');
  assert.equal(run.offsideTiming.intent, 'break-on-pass');
  assert.equal(run.offsideTiming.attacksBeyondLine, true);
  assert.equal(run.offsideTiming.mistimedEarly, true);
  assert.ok(run.offsideTiming.timingOffsetTicks < 0);
  assert.ok(run.offsideTiming.timingOffsetTicks >= -8);
  assert.equal(run.offsideTiming.bridgeInstruction, 'release-before-carrier-kick');
  assert.equal(forcedMistake.carrierIntent.type, 'pass');
  assert.deepEqual(forcedMistake.carrierIntent.target, run.continuationTarget);
  assert.deepEqual(forcedMistake.carrierIntent.offsideTiming, run.offsideTiming);

  const perfectTiming = Intelligence.decide(snapshot({ tick: 55, players, offsideLine }), null, {
    minimumBidScore: 0,
    minimumLaneClearance: 0,
    minimumPassLaneClearance: 0,
    maximumCommittedRuns: 1,
    offsideMistakeBaseRisk: 0,
    offsideMistakeAwarenessRelief: 0,
    offsideMistakePaceRisk: 0,
    offsideMistakeMaxEarlyTicks: 8
  });
  const cleanRun = perfectTiming.runs.find(entry => entry.playerId === 'timing-runner');
  assert.ok(cleanRun);
  assert.equal(cleanRun.offsideTiming.mistimedEarly, false);
  assert.equal(cleanRun.offsideTiming.timingOffsetTicks, 0);
  assert.equal(cleanRun.offsideTiming.bridgeInstruction, 'release-on-carrier-kick');
});

test('rest-defense and stay-back role constraints prevent unsafe defender releases', () => {
  const players = [
    player('carrier', 'home', 1200, 1070, { passing: 92 }),
    player('left-back', 'home', 900, 300, { role: 'full-back', position: 'LB', pace: 88 }),
    player('right-back', 'home', 900, 1830, { role: 'full-back', position: 'RB', pace: 88 }),
    player('holding-mid', 'home', 1050, 1070, { role: 'defensive-midfielder', position: 'CDM', duty: 'stay-back' }),
    player('away-a', 'away', 2800, 600, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2800, 1540, { role: 'centre-back', position: 'CB' })
  ];
  const decision = Intelligence.decide(snapshot({ tick: 60, players, offsideLine: 2900 }), null, {
    restDefenseMinimum: 3,
    minimumPassLaneClearance: 0
  });
  assert.equal(decision.runs.some(run => ['left-back', 'right-back'].includes(run.playerId) && run.runType === 'overlap'), false);
  assert.ok(decision.telemetry.bids.some(bid => bid.rejectionReasons.includes('rest-defense-minimum')));
  assert.equal(decision.runs.some(run => run.playerId === 'holding-mid' && run.runType !== 'support'), false);
});

test('formation envelope is applied before an aggressive event target can become a run', () => {
  const players = [
    player('carrier', 'home', 1200, 1070, { passing: 95 }),
    player('full-back', 'home', 820, 260, { role: 'full-back', position: 'LB', pace: 90 }),
    player('cb-a', 'home', 650, 850, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('cb-b', 'home', 650, 1330, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-a', 'away', 2900, 800, { role: 'centre-back', position: 'CB' }),
    player('away-b', 'away', 2900, 1400, { role: 'centre-back', position: 'CB' })
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 70,
    players,
    offsideLine: 3000,
    events: [{
      id: 'impossible-overlap', type: 'space-opened', tick: 70, teamId: 'home',
      playerId: 'full-back', runType: 'overlap', target: { x: 2900, y: 120 }
    }]
  }), null, { minimumPassLaneClearance: 0, restDefenseMinimum: 1 });
  const bid = decision.telemetry.bids.find(entry => entry.playerId === 'full-back' && entry.runType === 'overlap');
  assert.ok(bid);
  assert.equal(bid.formationAdjusted, true);
  assert.ok(bid.target.x <= players[1].formationAnchor.x + 520);
});

test('carrier planner exposes deterministic shot, pass, carry and wait intents', () => {
  const shotPlayers = [
    player('carrier', 'home', 2850, 1070, { shooting: 95, control: 92 }),
    player('away-a', 'away', 2500, 300),
    player('away-b', 'away', 2500, 1830)
  ];
  assert.equal(Intelligence.decide(snapshot({ tick: 80, players: shotPlayers, ball: { x: 2850, y: 1070 } })).carrierIntent.type, 'shot');

  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  let passDecision = Intelligence.decide(fixture.snapshots.closed);
  passDecision = Intelligence.decide(fixture.snapshots.opened, passDecision.memory);
  passDecision = Intelligence.decide(fixture.snapshots.reacted, passDecision.memory);
  assert.equal(passDecision.carrierIntent.type, 'pass');

  const carryPlayers = [
    player('carrier', 'home', 1100, 1070, { control: 93 }),
    player('away-a', 'away', 2600, 300),
    player('away-b', 'away', 2600, 1830)
  ];
  assert.equal(Intelligence.decide(snapshot({ tick: 81, players: carryPlayers, ball: { x: 1100, y: 1070 } })).carrierIntent.type, 'carry');

  const waitPlayers = [
    player('carrier', 'home', 1100, 1070, { control: 70 }),
    player('away-blocker-a', 'away', 1210, 1070),
    player('away-blocker-b', 'away', 1270, 1070)
  ];
  const wait = Intelligence.decide(snapshot({ tick: 82, players: waitPlayers, ball: { x: 1100, y: 1070 } }));
  assert.equal(wait.carrierIntent.type, 'wait');
  assert.equal(wait.carrierIntent.reason, 'no-safe-progressive-action');
});

test('carrier planner retains short support circulation when no penetrating run is committed', () => {
  const players = [
    player('carrier', 'home', 1500, 1070, {
      role: 'central-midfielder', position: 'CM', passing: 92, awareness: 92, control: 90
    }),
    player('support', 'home', 1280, 1240, {
      role: 'defensive-midfielder', position: 'CDM', passing: 90, awareness: 91, control: 89,
      vx: 0, vy: 0
    }),
    player('wide-support', 'home', 1540, 680, {
      role: 'winger', position: 'LW', passing: 84, awareness: 86, control: 88,
      vx: 0, vy: 0
    }),
    player('away-pressure', 'away', 1570, 1070, {
      role: 'midfielder', position: 'CM', awareness: 88
    }),
    player('away-lane', 'away', 1740, 1070, {
      role: 'defensive-midfielder', position: 'CDM', awareness: 90
    }),
    player('away-cover', 'away', 2450, 1550, {
      role: 'centre-back', position: 'CB', awareness: 88
    })
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 83,
    players,
    ball: { x: 1500, y: 1070 },
    offsideLine: 2600
  }), null, { maximumCommittedRuns: 0 });
  assert.equal(decision.runs.some(run => run.playerId === 'support'), false);
  assert.equal(decision.carrierIntent.type, 'pass', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.targetPlayerId, 'support');
  assert.equal(decision.carrierIntent.reason, 'short-support-circulation');
  assert.ok(decision.carrierIntent.target.x <= 1280 + 1e-9);
  assert.ok(decision.carrierIntent.confidence >= .6);
});

test('unpressured defenders break an immediate return-pass loop after a completed pass', () => {
  const players = [
    player('defender-a', 'home', 1040, 1070, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', passing: 90, control: 88
    }),
    player('defender-b', 'home', 1260, 1070, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', passing: 91, control: 90
    }),
    player('midfielder-c', 'home', 1510, 720, {
      role: 'central-midfielder', position: 'CM', passing: 87, control: 90
    }),
    player('away-left', 'away', 2520, 360, { role: 'striker', position: 'ST' }),
    player('away-right', 'away', 2520, 1780, { role: 'striker', position: 'ST' })
  ];
  const memory = Intelligence.createMemory();
  Object.assign(memory, { teamId: 'home', lastTick: 99 });
  Object.assign(memory.circulation, {
    pendingPasserId: 'defender-a', pendingReceiverId: 'defender-b', pendingIssuedTick: 99
  });
  const decision = Intelligence.decide(snapshot({
    tick: 100,
    carrierId: 'defender-b',
    players,
    ball: { x: 1260, y: 1070 },
    offsideLine: 2850
  }), memory, { maximumCommittedRuns: 0 });
  assert.equal(decision.memory.circulation.lastCompletedPasserId, 'defender-a');
  assert.equal(decision.memory.circulation.lastCompletedReceiverId, 'defender-b');
  assert.equal(decision.carrierIntent.type, 'pass', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.targetPlayerId, 'midfielder-c');
  assert.equal(decision.carrierIntent.reason, 'defender-return-loop-break-support');
  assert.ok(decision.telemetry.transitions.some(event => event.type === 'circulation-pass-completed'));
});

test('a defender under genuine pressure may still use the emergency return pass', () => {
  const players = [
    player('defender-a', 'home', 1040, 1070, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', passing: 90, control: 88
    }),
    player('defender-b', 'home', 1260, 1070, {
      role: 'centre-back', position: 'CB', duty: 'stay-back', passing: 91, control: 90
    }),
    player('away-pressure', 'away', 1260, 1120, { role: 'striker', position: 'ST' })
  ];
  const memory = Intelligence.createMemory();
  Object.assign(memory, { teamId: 'home', lastTick: 109 });
  Object.assign(memory.circulation, {
    pendingPasserId: 'defender-a', pendingReceiverId: 'defender-b', pendingIssuedTick: 109
  });
  const decision = Intelligence.decide(snapshot({
    tick: 110,
    carrierId: 'defender-b',
    players,
    ball: { x: 1260, y: 1070 },
    offsideLine: 2850
  }), memory, { maximumCommittedRuns: 0 });
  assert.equal(decision.carrierIntent.type, 'pass', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.targetPlayerId, 'defender-a');
  assert.equal(decision.carrierIntent.reason, 'short-support-circulation');
});

test('a clearly superior progressive coordinated run beats routine short circulation', () => {
  const players = [
    player('carrier', 'home', 1500, 1070, {
      role: 'central-midfielder', position: 'CM', passing: 92, awareness: 92, control: 90
    }),
    player('support', 'home', 1280, 1240, {
      role: 'defensive-midfielder', position: 'CDM', passing: 90, awareness: 91, control: 89,
      vx: 0, vy: 0
    }),
    player('runner', 'home', 1750, 680, {
      role: 'winger', position: 'LW', pace: 92, acceleration: 94, vx: 0, vy: 0
    }),
    player('away-pressure', 'away', 1570, 1070),
    player('away-cover', 'away', 2450, 1550)
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 84,
    players,
    ball: { x: 1500, y: 1070 },
    offsideLine: 2800
  }));
  const routineRun = decision.runs.find(run => run.playerId === 'runner');
  assert.ok(routineRun, 'the off-ball run should still be authored');
  assert.equal(routineRun.observedOpening, false);
  assert.equal(decision.carrierIntent.type, 'pass');
  assert.equal(decision.carrierIntent.targetPlayerId, 'runner');
  assert.equal(decision.carrierIntent.reason, 'release-coordinated-run');
});

test('routine run does not override safer circulation without the required lane advantage', () => {
  const players = [
    player('carrier', 'home', 1500, 1070, {
      role: 'central-midfielder', position: 'CM', passing: 92, awareness: 92, control: 90
    }),
    player('support', 'home', 1280, 1240, {
      role: 'defensive-midfielder', position: 'CDM', passing: 90, awareness: 91, control: 89,
      vx: 0, vy: 0
    }),
    player('runner', 'home', 1750, 680, {
      role: 'winger', position: 'LW', pace: 92, acceleration: 94, vx: 0, vy: 0
    }),
    player('away-pressure', 'away', 1560, 1070),
    player('away-cover', 'away', 2450, 1550)
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 84,
    players,
    ball: { x: 1500, y: 1070 },
    offsideLine: 2800
  }));
  const routineRun = decision.runs.find(run => run.playerId === 'runner');
  assert.ok(routineRun, 'the off-ball run remains independently authored');
  assert.ok(routineRun.passClearance < Intelligence.DEFAULT_CONFIG.minimumPassLaneClearance +
    Intelligence.DEFAULT_CONFIG.routineProgressiveRunClearanceBonus);
  assert.equal(decision.carrierIntent.type, 'pass');
  assert.equal(decision.carrierIntent.targetPlayerId, 'support');
  assert.equal(decision.carrierIntent.reason, 'short-support-circulation');
});

test('an unpressured attacker carries into space before recycling a routine support pass', () => {
  const players = [
    player('carrier', 'home', 1500, 1070, {
      role: 'striker', position: 'ST', passing: 88, awareness: 92, control: 94
    }),
    player('support', 'home', 1510, 1420, {
      role: 'winger', position: 'RW', passing: 88, awareness: 90, control: 91
    }),
    player('away-left', 'away', 2460, 420),
    player('away-right', 'away', 2460, 1740)
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 85,
    players,
    ball: { x: 1500, y: 1070 },
    offsideLine: 2900
  }), null, { maximumCommittedRuns: 0 });
  assert.equal(decision.carrierIntent.type, 'carry', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.reason, 'attacking-carrier-space-open');
  assert.ok(decision.carrierIntent.target.x > 1500);
});

test('elite shooting extends a clear shot decision into a realistic edge-of-box range', () => {
  const players = [
    player('carrier', 'home', 2560, 1070, {
      role: 'striker', position: 'ST', shooting: 95, control: 92
    }),
    player('away-left', 'away', 2700, 420),
    player('away-right', 'away', 2700, 1740)
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 86,
    players,
    ball: { x: 2560, y: 1070 },
    offsideLine: 3100
  }));
  assert.equal(decision.carrierIntent.type, 'shot', JSON.stringify(decision.carrierIntent));
  assert.equal(decision.carrierIntent.reason, 'goal-range-and-shot-lane-open');
  assert.equal(decision.carrierIntent.shotProfile.technique, 'power');
  assert.ok(decision.carrierIntent.shotProfile.power >= .5);
});

test('CPU shot choice varies the strike instead of emitting one generic driven shot', () => {
  const decisionFor = ({ x, y, shooting = 82, control = 84, opponents = [] }) => Intelligence.decide(snapshot({
    tick: 186,
    players: [
      player('carrier', 'home', x, y, { role: 'striker', position: 'ST', shooting, control }),
      ...opponents
    ],
    ball: { x, y },
    offsideLine: 3160
  }), null, { maximumCommittedRuns: 0 }).carrierIntent;
  const close = decisionFor({ x: 2940, y: 1070 });
  const wide = decisionFor({ x: 2680, y: 620 });
  const central = decisionFor({ x: 2720, y: 1070, shooting: 70, control: 68 });
  assert.equal(close.type, 'shot');
  assert.equal(close.shotProfile.technique, 'low-driven');
  assert.equal(wide.type, 'shot');
  assert.equal(wide.shotProfile.technique, 'placed');
  assert.equal(central.type, 'shot');
  assert.equal(central.shotProfile.technique, 'driven');
});

test('a screened centre lane selects an open goal third without bypassing defenders', () => {
  const goalCentreY = (6 + 2136) / 2;
  const players = [
    player('carrier', 'home', 2560, goalCentreY, {
      role: 'striker', position: 'ST', shooting: 95, control: 92
    }),
    player('centre-screen', 'away', 2900, goalCentreY, {
      role: 'goalkeeper', position: 'GK', isGK: true, awareness: 95
    })
  ];
  const first = Intelligence.decide(snapshot({
    tick: 87,
    players,
    ball: { x: 2560, y: goalCentreY },
    offsideLine: 3100
  }), null, { maximumCommittedRuns: 0 });
  const repeated = Intelligence.decide(snapshot({
    tick: 87,
    players,
    ball: { x: 2560, y: goalCentreY },
    offsideLine: 3100
  }), null, { maximumCommittedRuns: 0 });
  assert.equal(first.carrierIntent.type, 'shot', JSON.stringify(first.carrierIntent));
  assert.notEqual(first.carrierIntent.target.y, goalCentreY);
  assert.ok(Math.abs(first.carrierIntent.target.y - goalCentreY) < 115);
  assert.deepEqual(repeated.carrierIntent.target, first.carrierIntent.target);
});

test('carrier refuses the shot when centre and both goal thirds are genuinely screened', () => {
  const goalCentreY = (6 + 2136) / 2;
  const thirdOffsetAtScreen = 2.44 / 68 * (2136 - 6) * ((3100 - 2560) / (3260 - 2560));
  const players = [
    player('carrier', 'home', 2560, goalCentreY, {
      role: 'striker', position: 'ST', shooting: 95, control: 92
    }),
    player('centre-screen', 'away', 3100, goalCentreY),
    player('upper-third-screen', 'away', 3100, goalCentreY - thirdOffsetAtScreen),
    player('lower-third-screen', 'away', 3100, goalCentreY + thirdOffsetAtScreen)
  ];
  const decision = Intelligence.decide(snapshot({
    tick: 88,
    players,
    ball: { x: 2560, y: goalCentreY },
    offsideLine: 3150
  }), null, { maximumCommittedRuns: 0 });
  assert.notEqual(decision.carrierIntent.type, 'shot', JSON.stringify(decision.carrierIntent));
});

test('telemetry contains auditable perception, bid, transition, constraint and carrier records', () => {
  const fixture = Intelligence.createBaleStyleOpenSpaceBeelineFixture();
  let decision = Intelligence.decide(fixture.snapshots.closed);
  decision = Intelligence.decide(fixture.snapshots.opened, decision.memory);
  decision = Intelligence.decide(fixture.snapshots.reacted, decision.memory);
  assert.equal(decision.telemetry.schema, 'football-legacy-cpu-telemetry-v2');
  assert.ok(Array.isArray(decision.telemetry.perception));
  assert.ok(decision.telemetry.bids.length > 0);
  assert.ok(decision.telemetry.transitions.some(event => event.type === 'run-committed'));
  assert.equal(typeof decision.telemetry.constraints, 'object');
  assert.deepEqual(decision.telemetry.carrier, decision.carrierIntent);
});

test('DEFENSIVE LOOP: reaction promotes exactly one challenger plus goal-side cover without collapsing rest defence', () => {
  let decision = Intelligence.decide(defensiveSnapshot(100));
  assert.deepEqual(decision.defensiveIntents, []);
  assert.equal(decision.telemetry.defense.state, 'reacting');
  assert.equal(decision.telemetry.defense.primaryPlayerId, 'home-presser');
  assert.equal(decision.memory.defense.eligibleTick, 101);

  decision = Intelligence.decide(defensiveSnapshot(101), decision.memory);
  assert.equal(decision.defensiveIntents.length, 2);
  const press = decision.defensiveIntents.find(intent => intent.type === 'press');
  const cover = decision.defensiveIntents.find(intent => intent.type === 'cover');
  assert.ok(press);
  assert.ok(cover);
  assert.equal(press.playerId, 'home-presser');
  assert.equal(press.role, 'primary-challenger');
  assert.equal(press.movementIntent, 'beeline');
  assert.equal(press.state, 'committed');
  assert.equal(press.physicalAction, null, 'a distant challenger must not show a tackle animation');
  assert.equal(cover.playerId, 'home-hold');
  assert.equal(cover.role, 'cover-support');
  assert.equal(cover.movementIntent, 'contain');
  assert.ok(cover.target.x < 1500, 'cover must stay goal-side for a team attacking left-to-right');
  assert.equal(cover.physicalAction, null);
  assert.equal(decision.runs.length, 0, 'defensive output must not mutate the attacking-run contract');
  assert.equal(decision.carrierIntent.reason, 'no-controlled-possession');
  assert.equal(decision.memory.defense.minUntilTick, 125);
  assert.equal(decision.memory.defense.expiresTick, 197);
  assertAllNumbersFinite(decision.telemetry);
});

test('DEFENSIVE LOOP: commitment persists under a nearer alternative and is input-order deterministic', () => {
  let decision = Intelligence.decide(defensiveSnapshot(110));
  decision = Intelligence.decide(defensiveSnapshot(111), decision.memory);
  const memory = decision.memory;
  const nearer = defensiveSnapshot(112);
  nearer.players.find(entry => entry.id === 'home-wing').x = 1490;
  nearer.players.find(entry => entry.id === 'home-wing').y = 1070;
  const ordered = Intelligence.decide(nearer, memory);
  const reordered = JSON.parse(JSON.stringify(nearer));
  reordered.players.reverse();
  const shuffled = Intelligence.decide(reordered, memory);
  assert.deepEqual(shuffled, ordered);
  const press = ordered.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.playerId, 'home-presser', 'a marginal nearest-player change cannot erase a commitment');
  assert.equal(press.state, 'persisting');
  assert.ok(ordered.tick < press.minUntilTick);
  assert.ok(ordered.telemetry.transitions.some(event => event.type === 'defense-persisted'));
});

test('DEFENSIVE LOOP: stand tackle and shoulder actions require safe windows and obey simulation-tick cooldown', () => {
  const close = defensiveSnapshot(200);
  const presser = close.players.find(entry => entry.id === 'home-presser');
  presser.x = 1445;
  let decision = Intelligence.decide(close, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  let press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction.type, 'stand-tackle');
  assert.equal(press.physicalAction.targetPlayerId, 'away-carrier');
  assert.ok(press.physicalAction.distance >= Intelligence.DEFAULT_CONFIG.defensiveStandTackleMinDistance);
  assert.ok(press.physicalAction.distance <= Intelligence.DEFAULT_CONFIG.defensiveStandTackleMaxDistance);
  assert.ok(press.physicalAction.alignment >= Intelligence.DEFAULT_CONFIG.defensiveMinimumActionAlignment);
  assert.ok(Math.abs(press.physicalAction.relativeClosingSpeed) <=
    Intelligence.DEFAULT_CONFIG.defensiveMaximumActionRelativeSpeed);
  const cooldownUntil = press.physicalAction.cooldownUntilTick;

  const cooldownFrame = defensiveSnapshot(201);
  cooldownFrame.players.find(entry => entry.id === 'home-presser').x = 1445;
  decision = Intelligence.decide(cooldownFrame, decision.memory, {
    minimumReactionTicks: 0, maximumReactionTicks: 0
  });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction, null, 'the same challenge cannot be emitted every render tick');

  const recovered = defensiveSnapshot(cooldownUntil);
  recovered.players.find(entry => entry.id === 'home-presser').x = 1445;
  decision = Intelligence.decide(recovered, decision.memory, {
    minimumReactionTicks: 0, maximumReactionTicks: 0
  });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction.type, 'stand-tackle');

  const sideOn = defensiveSnapshot(300);
  const sideOnPresser = sideOn.players.find(entry => entry.id === 'home-presser');
  sideOnPresser.x = 1460;
  sideOnPresser.fx = 0.65;
  sideOnPresser.fy = 0.76;
  decision = Intelligence.decide(sideOn, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction.type, 'shoulder-challenge');

  const wrongWay = defensiveSnapshot(400);
  const wrongWayPresser = wrongWay.players.find(entry => entry.id === 'home-presser');
  wrongWayPresser.x = 1445;
  wrongWayPresser.fx = -1;
  decision = Intelligence.decide(wrongWay, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction, null, 'a defender facing away cannot show a challenge');

  const unsafeSpeed = defensiveSnapshot(500);
  const unsafePresser = unsafeSpeed.players.find(entry => entry.id === 'home-presser');
  unsafePresser.x = 1445;
  unsafePresser.vx = 300;
  decision = Intelligence.decide(unsafeSpeed, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction, null, 'an unsafe relative-speed collision cannot show a challenge');
});

test('DEFENSIVE LOOP: a CPU defender can commit the slide input only in a goal-side recovery window', () => {
  const danger = defensiveSnapshot(550);
  const presser = danger.players.find(entry => entry.id === 'home-presser');
  const carrier = danger.players.find(entry => entry.id === 'away-carrier');
  presser.x = 700;
  presser.fx = 1;
  carrier.x = 800;
  danger.ball = { x: carrier.x, y: carrier.y };
  let decision = Intelligence.decide(danger, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  let press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction.type, 'slide-tackle');
  assert.ok(press.physicalAction.distance > Intelligence.DEFAULT_CONFIG.defensiveStandTackleMaxDistance);
  assert.ok(press.physicalAction.ownGoalDepth <= Intelligence.DEFAULT_CONFIG.defensiveSlideDangerDepth);

  const midfield = defensiveSnapshot(551);
  midfield.players.find(entry => entry.id === 'home-presser').x = 1400;
  midfield.players.find(entry => entry.id === 'home-presser').fx = 1;
  midfield.players.find(entry => entry.id === 'away-carrier').x = 1500;
  decision = Intelligence.decide(midfield, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.equal(press.physicalAction, null, 'midfield distance alone must not justify a committed slide');
});

test('DEFENSIVE LOOP: turnover abort is immediate and populated defensive replay memory validates', () => {
  const close = defensiveSnapshot(600);
  close.players.find(entry => entry.id === 'home-presser').x = 1445;
  let decision = Intelligence.decide(close, null, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  assert.ok(decision.defensiveIntents.length > 0);
  assert.deepEqual(Intelligence.createMemory(decision.memory), decision.memory);

  const won = defensiveSnapshot(601, { possessionTeamId: 'home', carrierId: 'home-presser' });
  won.ball = { x: 1300, y: 1070 };
  decision = Intelligence.decide(won, decision.memory, { minimumReactionTicks: 0, maximumReactionTicks: 0 });
  assert.deepEqual(decision.defensiveIntents, []);
  assert.equal(decision.memory.defense.phase, 'idle');
  assert.equal(decision.telemetry.defense.state, 'in-possession');
  assert.ok(decision.telemetry.transitions.some(event => event.type === 'defense-aborted' &&
    event.reason === 'possession-won'));
  assertAllNumbersFinite(decision);

  const malformed = JSON.parse(JSON.stringify(Intelligence.createMemory()));
  malformed.defense.phase = 'committed';
  assert.throws(() => Intelligence.createMemory(malformed), /required while active/);

  const legacyCompatible = JSON.parse(JSON.stringify(decision.memory));
  delete legacyCompatible.defense;
  assert.equal(Intelligence.createMemory(legacyCompatible).defense.phase, 'idle');
});

test('DEFENSIVE LOOP: JSON replay checkpoints, chunk boundaries and roster ordering produce the same trace', () => {
  const frames = Array.from({ length: 7 }, (_, index) => {
    const frame = defensiveSnapshot(700 + index);
    const carrier = frame.players.find(entry => entry.id === 'away-carrier');
    carrier.x += index * 3;
    carrier.y += index % 2 ? 2 : -2;
    if (index % 2) frame.players.reverse();
    frame.ball = { x: carrier.x, y: carrier.y };
    return frame;
  });
  const run = (checkpointAt = -1) => {
    let memory;
    const trace = [];
    for (let index = 0; index < frames.length; index += 1) {
      if (index === checkpointAt) memory = JSON.parse(JSON.stringify(memory));
      const decision = Intelligence.decide(JSON.parse(JSON.stringify(frames[index])), memory);
      trace.push(decision);
      memory = decision.memory;
    }
    return trace;
  };
  const uninterrupted = run();
  assert.deepEqual(run(3), uninterrupted);
  assert.deepEqual(run(5), uninterrupted);

  let replayMemory;
  const replay = frames.map(frame => {
    const decision = Intelligence.decide(JSON.parse(JSON.stringify(frame)), replayMemory);
    replayMemory = JSON.parse(JSON.stringify(decision.memory));
    return decision;
  });
  assert.deepEqual(replay, uninterrupted);
  replay.forEach(assertAllNumbersFinite);
});

test('DEFENSIVE LOOP: configured rest-defence floor can fail closed instead of releasing a protected player', () => {
  const players = [
    player('only-cb-a', 'home', 1000, 850, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('only-cb-b', 'home', 1000, 1290, { role: 'centre-back', position: 'CB', duty: 'stay-back' }),
    player('away-carrier', 'away', 1200, 1070, { role: 'striker', position: 'ST' })
  ];
  const decision = Intelligence.decide(defensiveSnapshot(800, { players }), null, {
    minimumReactionTicks: 0,
    maximumReactionTicks: 0,
    restDefenseMinimum: 2
  });
  assert.deepEqual(decision.defensiveIntents, []);
  assert.equal(decision.telemetry.defense.state, 'rest-defense-protected');
  assert.equal(decision.memory.defense.phase, 'idle');
});

test('DEFENSIVE LOOP: a nearby human-owned player is never selected over an eligible CPU teammate', () => {
  const frame = defensiveSnapshot(900);
  const human = frame.players.find(entry => entry.id === 'home-presser');
  human.x = 1490;
  human.humanControlled = true;
  const cpu = frame.players.find(entry => entry.id === 'home-wing');
  cpu.x = 1390;
  cpu.y = 1070;
  const decision = Intelligence.decide(frame, null, {
    minimumReactionTicks: 0,
    maximumReactionTicks: 0
  });
  const press = decision.defensiveIntents.find(intent => intent.type === 'press');
  assert.ok(press);
  assert.notEqual(press.playerId, human.id);
  assert.equal(press.playerId, cpu.id);
  assert.equal(decision.defensiveIntents.some(intent => intent.playerId === human.id), false);
});

test('DEFENSIVE LOOP: canonical and metric pitches select the same roles and proportionally mapped targets', () => {
  const canonical = Intelligence.decide(defensiveSnapshot(950), null, {
    minimumReactionTicks: 0,
    maximumReactionTicks: 0
  });
  const metric = Intelligence.decide(defensiveFrameToMetric(defensiveSnapshot(950)), null, {
    minimumReactionTicks: 0,
    maximumReactionTicks: 0
  });
  const identity = decision => decision.defensiveIntents.map(intent => ({
    playerId: intent.playerId,
    type: intent.type,
    role: intent.role,
    state: intent.state,
    targetSpeed: intent.targetSpeed,
    physicalAction: intent.physicalAction && intent.physicalAction.type
  }));
  assert.deepEqual(identity(metric), identity(canonical));
  for (let index = 0; index < canonical.defensiveIntents.length; index += 1) {
    const canonicalTarget = canonical.defensiveIntents[index].target;
    const metricTarget = metric.defensiveIntents[index].target;
    assert.ok(Math.abs(metricTarget.x - (canonicalTarget.x - 84) / 3176 * 105) < 0.002);
    assert.ok(Math.abs(metricTarget.y - (canonicalTarget.y - 6) / 2130 * 68) < 0.002);
  }
});
