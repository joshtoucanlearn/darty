import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const base = process.env.DARTY_BASE_URL || 'http://127.0.0.1:4334';
const output = process.env.DARTY_PROOF_DIR || '/tmp/darty-lesson-fixes-proof';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 720 } });
page.setDefaultTimeout(60000);
const errors = [];
const failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400 && !response.url().includes('favicon')) failedRequests.push(response.url());
});
await page.addInitScript(() => { navigator.getGamepads = () => []; });

try {
  await page.goto(base + '/quick-play/index.html?mode=single-player&engine=fl-v2&candidate=5', { waitUntil: 'networkidle' });
  for (const id of ['confirmTeams', 'confirmManagement', 'confirmSetup', 'confirmControls', 'startMatch']) {
    await page.locator('#' + id).click();
  }
  await page.waitForFunction(() => window.FLMatch && document.getElementById('matchLoading').hidden);
  const result = await page.evaluate(() => ({
    slide: FLMatch.debugLessonSlideBalance(),
    offBall: FLMatch.debugLessonOffBallFoul(),
    keeper: FLMatch.debugLessonKeeperFollowThrough(),
    state: FLMatch.getState()
  }));
  assert.equal(result.slide.clean.clean, true);
  assert.equal(result.slide.missed.clean, false);
  assert.ok(result.slide.clean.chance <= 0.82);
  assert.ok(result.slide.rear.chance < result.slide.clean.chance);
  assert.equal(result.offBall.staged, true);
  assert.equal(result.offBall.reason, 'off-ball sliding tackle');
  assert.deepEqual(result.offBall.foul, {
    offBall: true,
    reason: 'off-ball sliding tackle',
    method: 'slide-tackle'
  });
  assert.equal(result.offBall.incidentalFoul, false);
  assert.ok(['fallForward', 'fallSide', 'fallBack', 'fallSlide', 'fallTwist', 'fallTumble', 'stumble'].includes(result.offBall.victimAction));
  assert.ok(result.keeper.followThrough.extensionFrames > 0);
  assert.ok(result.keeper.active.diveT > 0);
  assert.equal(result.keeper.active.action, 'keeperLowDive');
  assert.equal(result.keeper.active.envelope.diving, true);
  assert.equal(result.keeper.recovery.recovering, true);
  assert.ok(result.keeper.recovery.reach > 36);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  fs.writeFileSync(path.join(output, 'lesson-fixes-verification.json'), JSON.stringify({ result, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ slide: result.slide, offBall: result.offBall, keeper: result.keeper, errors, failedRequests }));
} finally {
  await browser.close();
}
