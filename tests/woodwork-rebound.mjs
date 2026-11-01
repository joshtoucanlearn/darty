// Woodwork rebounds. Ball V2 integrates the bounce off the posts and bar; the host must end the shot, name the
// rebound, show and log it once, and hand the ball to the normal loose-ball race. A shot that clips the post and
// still crosses the line must stay the shooter's goal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { attackingHost, liveScene } from './fixtures/attack-host-fixture.mjs';
import { setupSource, sampleSource, hookSource } from '../tools/woodwork-scenario.mjs';
import { createWoodworkMetrics } from '../tools/woodwork-metrics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchHtml = fs.readFileSync(path.join(root, 'match-engine', 'match.html'), 'utf8');

function between(text, start, end) {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing ${start}`);
  return text.slice(a, b);
}

// ---- One path ---------------------------------------------------------------------------------

test('there is exactly one woodwork handler: the V2 contact and the legacy physics branch both call it, and it logs once', () => {
  assert.equal((matchHtml.match(/logEvent\('woodwork'/g) || []).length, 1, 'only the shared handler logs woodwork');
  assert.equal((matchHtml.match(/showEvent\(crossbar\?'OFF THE BAR':'OFF THE POST',650\)/g) || []).length, 1);
  assert.doesNotMatch(matchHtml, /showEvent\('OFF THE (?:POST|BAR)'/, 'no inline copy of the old branch may remain');
  assert.equal((matchHtml.match(/applyWoodworkRebound\('(?:post|crossbar)',\{authority:'legacy-host-physics'\}\)/g) || []).length, 2, 'both legacy branches route through the helper');
  const legacy = between(matchHtml, "if(!liveV2OwnsLooseBall)for(const gx of [M,W-M]){", 'const boxKeeper=');
  assert.match(legacy, /applyWoodworkRebound\('post'/);
  assert.match(legacy, /applyWoodworkRebound\('crossbar'/);
  assert.match(matchHtml, /liveV2ApplyBall\(projection\)\{[^\n]*liveV2ApplyGoalFrameContact\(projection\);\}/, 'the V2 ball application is the single V2 entry point');
  // The legacy branch is skipped whenever V2 applied the ball this tick, so a contact can never fire twice.
  assert.match(matchHtml, /const liveV2OwnsLooseBall=liveV2LiveTick&&!ball\.owner&&\(liveV2TickBallApplied\|\|!!liveV2PendingLaunch\)/);
  assert.match(matchHtml, /if\(!liveV2OwnsLooseBall\)for\(const gx of \[M,W-M\]\)\{/);
});

function helperHost(overrides = {}) {
  const shown = [], logged = [], suite = [];
  const context = {
    ball: { isShot: true, shooter: { team: 'you', id: 'shooter' }, target: { id: 'receiver' }, flightType: 'shot', lastKicker: { id: 'shooter' }, owner: null },
    FREE_KICK_PRACTICE: false, liveV2SuiteShotActive: false,
    showEvent: (text, ms) => shown.push([text, ms]),
    logEvent: (type, team, player, extra) => logged.push({ type, team, player, extra }),
    liveV2QueueSuiteEvent: (action, extra) => suite.push({ action, extra }),
    report: { teams: { you: { onTarget: 0 }, opp: { onTarget: 0 } } },
    ...overrides
  };
  const code = between(matchHtml, '  function applyWoodworkRebound(', '  function liveV2ApplyBall(projection)') +
    between(matchHtml, '  function woodworkReboundCredit(', '  // DARTY kee');
  vm.runInNewContext(code + '\nthis.api={applyWoodworkRebound,liveV2ApplyGoalFrameContact,woodworkReboundCredit,goalEligibleBall};', context);
  return { context, shown, logged, suite };
}

test('the handler ends the shot, names the rebound, shows it once and logs it with the shooter', () => {
  const { context, shown, logged } = helperHost();
  const shooter = context.ball.shooter;
  context.api.applyWoodworkRebound('post', { authority: 'test' });
  assert.deepEqual(shown, [['OFF THE POST', 650]]);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].type, 'woodwork');
  assert.equal(logged[0].team, 'you');
  assert.equal(logged[0].player, shooter);
  assert.equal(logged[0].extra.woodwork, 'post');
  assert.equal(context.ball.isShot, false);
  assert.equal(context.ball.shooter, null);
  assert.equal(context.ball.target, null);
  assert.equal(context.ball.flightType, 'woodwork-rebound');
  assert.equal(context.ball.woodworkShooter, shooter, 'the shooter is remembered for goal credit only');
  context.api.applyWoodworkRebound('crossbar');
  assert.deepEqual(shown[1], ['OFF THE BAR', 650]);
  assert.equal(logged[1].extra.woodwork, 'crossbar');
});

test('the V2 entry point fires once per tick for the first goal-frame contact and ignores everything else', () => {
  const frameContact = role => ({ type: 'contact', colliderId: 'away-goal-v2-left-post', colliderRole: role, normalSpeed: 11.5 });
  let host = helperHost();
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: { events: [{ type: 'contact', colliderRole: 'ground' }, { type: 'regime-change' }] } }), false);
  assert.equal(host.logged.length, 0);
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({}), false);
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: null }), false);
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: { events: [] } }), false);
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: { events: [frameContact('goal-post'), frameContact('crossbar')] } }), true);
  assert.equal(host.logged.length, 1, 'two frame contacts in one tick still log one woodwork event');
  assert.equal(host.logged[0].extra.woodwork, 'post');
  assert.equal(host.logged[0].extra.authority, 'ball-v2-goal-frame-contact');
  assert.equal(host.logged[0].extra.colliderId, 'away-goal-v2-left-post');
  host = helperHost();
  host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: { events: [frameContact('crossbar')] } });
  assert.deepEqual(host.shown, [['OFF THE BAR', 650]]);
  host = helperHost({ ball: { isShot: true, shooter: { team: 'you' }, owner: { id: 'keeper' }, flightType: 'shot' } });
  assert.equal(host.context.api.liveV2ApplyGoalFrameContact({ ballTrace: { events: [frameContact('goal-post')] } }), false, 'a ball in a player\'s hands cannot hit the post');
  assert.equal(host.context.ball.flightType, 'shot');
});

test('a crossing ball that came off the frame is the shooter\'s goal until anyone else touches it', () => {
  const { context } = helperHost();
  const shooter = context.ball.shooter;
  assert.equal(context.api.goalEligibleBall(context.ball), true, 'a live shot is eligible');
  context.api.applyWoodworkRebound('post');
  assert.equal(context.ball.isShot, false);
  assert.equal(context.api.goalEligibleBall(context.ball), true, 'post then in is still a goal');
  context.ball.lastKicker = { id: 'defender' };
  assert.equal(context.api.goalEligibleBall(context.ball), false, 'once a defender touches it, a crossing ball is not a shot goal');
  context.ball.lastKicker = shooter; context.ball.owner = { id: 'keeper' };
  assert.equal(context.api.goalEligibleBall(context.ball), false, 'a caught ball is not a goal');
  context.ball.owner = null; context.ball.flightType = 'ground-pass';
  assert.equal(context.api.goalEligibleBall(context.ball), false, 'the credit ends when the ball is played on');
  assert.equal(context.api.goalEligibleBall({ isShot: false, flightType: 'cross' }), false, 'a plain cross was never eligible');
  assert.equal(context.api.goalEligibleBall({ isShot: true, flightType: 'header-shot' }), true);
  const nonShot = helperHost({ ball: { isShot: false, shooter: null, flightType: 'cross', lastKicker: { id: 'crosser' }, owner: null } });
  nonShot.context.api.applyWoodworkRebound('crossbar');
  assert.equal(nonShot.context.api.goalEligibleBall(nonShot.context.ball), false, 'a cross off the bar earns no shot credit');
});

test('suite free-kick practice still receives the post/crossbar contact it received on the legacy path', () => {
  const { context, suite } = helperHost({ FREE_KICK_PRACTICE: true, liveV2SuiteShotActive: true });
  context.api.applyWoodworkRebound('post');
  context.api.applyWoodworkRebound('crossbar');
  assert.deepEqual(JSON.parse(JSON.stringify(suite)), [
    { action: 'contact', extra: { contact: { kind: 'goal-frame-contact', materialId: 'post' }, resolveResult: 'post' } },
    { action: 'contact', extra: { contact: { kind: 'goal-frame-contact', materialId: 'crossbar' }, resolveResult: 'crossbar' } }
  ]);
});

// ---- The real host, both ends --------------------------------------------------------------------

function fire(spec) {
  const host = attackingHost(91);
  host.scenario(liveScene);
  host.scenario(hookSource);
  const setup = host.scenario(setupSource(spec));
  assert.equal(setup.ok, true, setup.reason);
  let previous = host.scenario(sampleSource), contact = null;
  const rows = [];
  for (let tick = 1; tick <= 300; tick += 1) {
    host.step();
    const now = host.scenario(sampleSource);
    if (!contact && now.woodwork.length > previous.woodwork.length) contact = { tick, before: previous, after: now };
    rows.push({ tick, now });
    previous = now;
  }
  return { setup, contact, rows };
}

for (const end of ['right', 'left']) for (const [target, post] of [['post', 'low'], ['post', 'high'], ['crossbar', 'low']]) {
  test(`${target}${target === 'post' ? '-' + post : ''} at the ${end} goal: the ball bounces, the shot ends on the contact tick and the loose-ball race starts`, () => {
    const { setup, contact, rows } = fire({ end, target, post, distanceMetres: target === 'post' ? 14 : 16, originOffsetMetres: target === 'post' ? (post === 'low' ? -4 : 4) : 0.5, speedMetresPerSecond: target === 'post' ? 24 : 26 });
    assert.ok(contact, 'the frame was hit: ' + JSON.stringify(setup.chosen));
    assert.ok(contact.tick >= 35 && contact.tick <= 60, 'contact tick ' + contact.tick);
    // It really bounced: the ball reversed along the shot line or changed vertical direction sharply.
    const bounce = Math.sign(contact.after.ball.vx) !== Math.sign(contact.before.ball.vx) || Math.abs(contact.after.ball.zv - contact.before.ball.zv) > 2;
    assert.ok(bounce, 'ball bounced off the frame');
    assert.ok(Math.hypot(contact.after.ball.vx, contact.after.ball.vy, contact.after.ball.zv) > 5, 'the rebound carries real pace');
    // On the contact tick the shot is over and the ball is a named woodwork rebound (a keeper touch in the same tick may rename it).
    assert.equal(contact.after.ball.isShot, false);
    assert.equal(contact.after.woodwork.length, 1, 'exactly one woodwork event');
    assert.ok(['woodwork-rebound', 'keeper-deflection'].includes(contact.after.ball.flightType), contact.after.ball.flightType);
    // The adapter's loose-ball race takes over from the shot-follow jobs within a few ticks.
    const switched = rows.filter(row => row.tick > contact.tick && row.tick <= contact.tick + 24).some(row => row.now.recovery.some(a => /loose-ball-recovery|high-ball/.test(a.authority)));
    assert.ok(switched, 'recovery assignments switched to the loose-ball race');
    const stillShotFollow = rows.filter(row => row.tick >= contact.tick + 24 && row.tick <= contact.tick + 90).some(row => row.now.recovery.some(a => /shot-follow-in|shot-rebound-defend/.test(a.authority)) && !row.now.ball.isShot);
    assert.equal(stillShotFollow, false, 'no shot-follow jobs once the shot has ended');
    // Nobody fires it twice.
    const duplicateTicks = rows.filter(row => row.tick > contact.tick && row.tick <= contact.tick + 2 && row.now.woodwork.length > 1);
    assert.equal(duplicateTicks.length, 0, 'no double fire on the next ticks');
  });
}

// ---- Post then in -----------------------------------------------------------------------------------

for (const end of ['right', 'left']) {
  test(`a shot that clips the inside of the post at the ${end} goal and still crosses the line is a goal: the shot ends at the frame, the goal and the shot on target are still the shooter's`, () => {
    const attempts = [
      { post: 'low', distanceMetres: 9, originOffsetMetres: 2, speedMetresPerSecond: 18 }, { post: 'high', distanceMetres: 9, originOffsetMetres: -2, speedMetresPerSecond: 18 },
      { post: 'low', distanceMetres: 11, originOffsetMetres: 1, speedMetresPerSecond: 22 }, { post: 'high', distanceMetres: 11, originOffsetMetres: -1, speedMetresPerSecond: 22 },
      { post: 'low', distanceMetres: 8, originOffsetMetres: 3, speedMetresPerSecond: 16 }, { post: 'high', distanceMetres: 8, originOffsetMetres: -3, speedMetresPerSecond: 16 }
    ];
    let host = null, setup = null;
    for (const attempt of attempts) {
      host = attackingHost(91); host.scenario(liveScene); host.scenario(hookSource);
      setup = host.scenario(setupSource({ end, target: 'post-in', ...attempt }));
      if (setup.ok) break;
    }
    assert.equal(setup.ok, true, 'a launch that clips the inside of the post and ends in the goal exists: ' + (setup.reason || ''));
    const scoreBefore = host.state().score.slice();
    const onTargetBefore = host.state().matchStats.map(team => team.onTarget);
    let sawWoodwork = false, sawShotEndedAtFrame = false;
    for (let tick = 1; tick <= 240; tick += 1) {
      host.step();
      const now = host.scenario(sampleSource);
      if (now.woodwork.length === 1 && !sawWoodwork) { sawWoodwork = true; sawShotEndedAtFrame = now.ball.isShot === false; }
      if (host.state().score[0] + host.state().score[1] > scoreBefore[0] + scoreBefore[1]) break;
    }
    const scoreAfter = host.state().score;
    const scoringTeamIndex = setup.shootingTeam === 'you' ? 0 : 1;
    assert.ok(sawWoodwork, 'the post was hit and logged');
    assert.ok(sawShotEndedAtFrame, 'the shot ended on the frame contact');
    assert.equal(scoreAfter[scoringTeamIndex], scoreBefore[scoringTeamIndex] + 1, 'the goal counts');
    assert.equal(scoreAfter[1 - scoringTeamIndex], scoreBefore[1 - scoringTeamIndex]);
    assert.equal(host.state().matchStats[scoringTeamIndex].onTarget, onTargetBefore[scoringTeamIndex] + 1, 'the shot counts as on target');
    const goal = host.scenario("report.events.filter(e => e.type === 'goal').map(e => ({ team: e.team, playerId: e.playerId }))");
    assert.equal(goal.length, 1);
    assert.equal(goal[0].playerId, setup.shooterId, 'the shooter is the scorer');
  });
}

// ---- Metrics ------------------------------------------------------------------------------------

test('woodwork metrics count hits and the rebound shots, goals and first touches that follow within the window', () => {
  const metrics = createWoodworkMetrics({ reboundWindowMs: 4000 });
  metrics.event({ type: 'woodwork', woodwork: 'post', team: 'you', actorId: 'a', time: 1000 });
  metrics.event({ type: 'reception', team: 'opp', time: 1600 });
  metrics.event({ type: 'shot', team: 'you', time: 2500 });
  metrics.event({ type: 'goal', team: 'you', time: 3000 });
  metrics.event({ type: 'woodwork', woodwork: 'crossbar', team: 'opp', actorId: 'b', time: 20000 });
  metrics.event({ type: 'keeper-claim', team: 'you', time: 20400 });
  metrics.event({ type: 'woodwork', woodwork: 'post', team: 'you', actorId: 'c', time: 40000 });
  metrics.event({ type: 'shot', team: 'opp', time: 46000 });
  metrics.frame({ ballTrace: { events: [{ type: 'contact', colliderRole: 'goal-post' }, { type: 'contact', colliderRole: 'ground' }, { type: 'contact', colliderRole: 'crossbar' }, { type: 'regime-change' }] } });
  metrics.frame({ ballTrace: null });
  metrics.frame({});
  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot.frameContacts, { total: 2, post: 1, crossbar: 1 }, 'every Ball V2 goal-frame contact is counted, handled or not');
  assert.equal(snapshot.hits, 3);
  assert.deepEqual(snapshot.byKind, { post: 2, crossbar: 1 });
  assert.equal(snapshot.reboundShots, 1, 'a shot after the window does not count');
  assert.equal(snapshot.reboundShotsByAttackers, 1);
  assert.equal(snapshot.reboundGoals, 1);
  assert.deepEqual(snapshot.firstReachedBy, { attackers: 0, defenders: 2, unknown: 0, none: 1 });
  assert.equal(snapshot.medianMsToFirstReach, 400);
});
