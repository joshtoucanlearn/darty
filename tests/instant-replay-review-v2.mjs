import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Review = require('../match-engine/instant-replay-review-v2.js');

function frame(t, offset = 0) {
  return {
    t,
    players: [{ x: offset, y: 20, vx: 1, vy: 0, fx: 1, fy: 0, gait: 'jog', action: 'idle', actionT: 0 }],
    ball: { x: offset + 5, y: 22, z: 1, vx: 1.2, vy: 0, zv: 0, isShot: false }
  };
}

test('the review clip is a bounded immutable copy of the latest seven seconds', () => {
  const source = Array.from({ length: 261 }, (_, index) => frame(index * 50, index));
  const clip = Review.createImmutableClip(source);
  assert.equal(clip.available, true);
  assert.equal(clip.immutable, true);
  assert.equal(clip.bounded, true);
  assert.ok(clip.durationMs <= 7000);
  assert.ok(clip.frameCount <= 220);
  assert.equal(clip.endsAt, 13000);
  assert.ok(clip.startsAt >= 6000);
  assert.ok(Object.isFrozen(clip.frames));
  assert.ok(clip.frames.every(row => Object.isFrozen(row) && Object.isFrozen(row.players) && Object.isFrozen(row.ball)));
  const copiedX = clip.frames.at(-1).ball.x;
  source.at(-1).ball.x = 999999;
  assert.equal(clip.frames.at(-1).ball.x, copiedX, 'the live replay buffer must not be retained by reference');
  assert.throws(() => { clip.frames.at(-1).ball.x = -1; }, TypeError);
});

test('an empty or too-short buffer fails closed', () => {
  assert.deepEqual(Review.createImmutableClip([]).reason, 'buffer-empty');
  assert.deepEqual(Review.createImmutableClip([frame(0)]).reason, 'buffer-too-short');
  assert.deepEqual(Review.createImmutableClip([frame(0), frame(100)]).reason, 'duration-too-short');
});

test('keeper set poses and animation durations survive the immutable replay copy and sampling', () => {
  const frames=[frame(0),frame(400),frame(800)];
  Object.assign(frames[0].players[0],{keeperPose:'ready',keeperAnimationDuration:0});
  Object.assign(frames[1].players[0],{keeperPose:'active',action:'keeperLowDive',actionT:34,keeperAnimationDuration:56});
  Object.assign(frames[2].players[0],{keeperPose:'active',action:'keeperLowDive',actionT:12,keeperAnimationDuration:56});
  const clip=Review.createImmutableClip(frames);
  assert.equal(clip.frames[0].players[0].keeperPose,'ready');
  assert.equal(clip.frames[1].players[0].keeperAnimationDuration,56);
  const controller=Review.createReviewController();controller.open(frames,{now:0});controller.seek(.5);
  frames[1].players[0].keeperAnimationDuration=18;
  assert.equal(controller.sample().a.players[0].keeperAnimationDuration,56);
  assert.equal(controller.sample().a.players[0].actionT,34);
});

test('playback, scrub and speed remain inside the frozen source timeline', () => {
  const frames = [frame(1000, 0), frame(1500, 10), frame(2000, 20)];
  const controller = Review.createReviewController();
  assert.equal(controller.open(frames, { now: 1000 }).opened, true);
  controller.tick(1050);
  const progressed = controller.tick(1150);
  assert.ok(progressed.progress > 0 && progressed.progress <= 0.2);
  controller.setSpeed(2);
  assert.equal(controller.status().speed, 2);
  controller.seek(0.75);
  assert.equal(controller.status().playing, false);
  assert.equal(controller.sample().sourceT, 1750);
  assert.equal(controller.sample().a.t, 1500);
  assert.equal(controller.sample().b.t, 2000);
  assert.equal(controller.sample().q, 0.5);
  controller.nudge(10000);
  assert.equal(controller.status().progress, 1);
  controller.nudge(-10000);
  assert.equal(controller.status().progress, 0);
});

test('package restore executes exactly once on close or error-style repeated closure', () => {
  const frames = [frame(0), frame(400), frame(800)];
  const token = { name: 'paused-match' };
  let restores = 0;
  const reasons = [];
  const controller = Review.createReviewController();
  controller.open(frames, { restoreToken: token, restore: (value, reason) => { assert.equal(value, token); restores++; reasons.push(reason); } });
  assert.equal(controller.close('render-error').closed, true);
  assert.equal(controller.close('second-close').closed, false);
  assert.equal(restores, 1);
  assert.deepEqual(reasons, ['render-error']);
  assert.equal(controller.status().active, false);
});

test('dolly, pan, boom, tilt, truck and orbit are bounded independent axes', () => {
  let state = Review.createCameraState();
  for (const axis of Review.AXES) {
    const before = { ...state };
    state = Review.adjustCameraState(state, axis, axis === 'dolly' || axis === 'boom' || axis === 'truck' ? 12 : 0.12);
    const changedKey = axis === 'dolly' ? 'distance' : axis;
    assert.notEqual(state[changedKey], before[changedKey], `${axis} must change its own camera degree of freedom`);
    for (const key of Object.keys(before)) {
      if (key !== changedKey) assert.equal(state[key], before[key], `${axis} must not alter ${key}`);
    }
  }
  state = Review.adjustCameraState(state, 'dolly', 100000);
  assert.equal(state.distance, Review.CAMERA_LIMITS.distance[1]);
  state = Review.adjustCameraState(state, 'boom', -100000);
  assert.equal(state.boom, Review.CAMERA_LIMITS.boom[0]);
  const pose = Review.cameraPoseFromState(state, { x: 12, y: 5, z: -8 });
  assert.ok(Object.values(pose.position).every(Number.isFinite));
  assert.ok(Object.values(pose.lookAt).every(Number.isFinite));
});

test('match host exposes only a pause-menu, offline, presentation-transaction integration', () => {
  const html = fs.readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="instant-replay-review-v2\.js/);
  assert.match(html, /id="instantReplayReviewBtn"/);
  assert.match(html, /id="instantReplayReviewPage"/);
  assert.match(html, /function openInstantReplayReview\(/);
  assert.match(html, /if\(!paused\|\|ONLINE_HOST\|\|!instantReplayReviewOrdinaryPauseAvailable\(\)\)return false/);
  assert.match(html, /function captureInstantReplayReviewRestoreState\(/);
  assert.match(html, /function restoreInstantReplayReviewStateOnce\(/);
  assert.match(html, /function beginInstantReplayReviewProjection\(/);
  assert.match(html, /function endInstantReplayReviewProjection\(/);
  assert.match(html, /instantReplayReviewInputGuard/);
  assert.match(html, /\['instantReplayReviewBtn','Instant replay review unavailable in Online'\]/);
  assert.match(html, /instantReplayReviewBtn\?\.addEventListener\('click',openInstantReplayReview\)/);
  assert.doesNotMatch(html, /__FL_INSTANT_REPLAY_REVIEW_DEBUG__=\{[^}]*open:/);
  assert.match(html, /addEventListener\('keydown',e=>\{if\(editableInputTarget\(e\.target\)\)return;if\(instantReplayReviewHandleKeyDown\(e\)\)return;/,
    'editable playtest notes must remain isolated before replay or gameplay keyboard handling');
  assert.match(html, /finally\{try\{endInstantReplayReviewProjection\(instantReplayReviewProjection\);\}catch\(error\).*finally\{if\(instantReplayReviewDrawError/);
  assert.match(html, /instantReplayReviewCameraHold&&paused&&!instantReplayActive/);

  const pollStart = html.indexOf('function pollGamepad()');
  const bindStart = html.indexOf('bindPadState(gamepadInput,gp1,false)', pollStart);
  const reviewPoll = html.indexOf('pollInstantReplayReviewGamepad(gp1);return;', pollStart);
  assert.ok(pollStart >= 0 && reviewPoll > pollStart && reviewPoll < bindStart, 'private review polling must return before live input binding');

  const from = html.indexOf('function openInstantReplayReview(');
  const to = html.indexOf('function instantReplayReviewHandleKeyDown', from);
  assert.ok(from >= 0 && to > from);
  const host = html.slice(from, to);
  assert.doesNotMatch(host, /\bAUTO\b|SECOND_CONTROLLER|SAME_TEAM_COOP|savedMatchConfig/, 'every local legacy mode must share the same review path');
  assert.match(html, /catch\(error\)\{console\.error\(error\);closeInstantReplayReview\('input-error'\)/);
  for (const forbidden of [
    /youScore\s*=/,
    /oppScore\s*=/,
    /clockFrames\s*=/,
    /goalReplay\.active\s*=/,
    /disciplineReplay\.active\s*=/,
    /kickoffHeld\s*=/,
    /restartTaker\s*=/,
    /liveV2Tick\s*=/
  ]) assert.doesNotMatch(host, forbidden);
});
