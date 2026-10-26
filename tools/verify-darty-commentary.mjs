const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.DARTY_BASE_URL || 'http://127.0.0.1:4333';
const output = process.env.DARTY_PROOF_DIR || '/tmp/darty-commentary-proof';
const viewportWidth = Number(process.env.DARTY_VIEWPORT_WIDTH || 1080);
const viewportHeight = Number(process.env.DARTY_VIEWPORT_HEIGHT || 720);
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });
page.setDefaultTimeout(60000);
const errors = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400 && !response.url().includes('favicon')) failedRequests.push(response.url());
});
await page.addInitScript(() => { navigator.getGamepads = () => []; });

try {
  await page.goto(base + '/darty.html', { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Set up a DARTY match' }).click();
  await page.waitForLoadState('networkidle');
  for (const id of ['confirmTeams', 'confirmManagement', 'confirmSetup', 'confirmControls', 'startMatch']) {
    await page.locator('#' + id).click();
  }
  await page.waitForFunction(() => window.FLMatch && window.FLLiveV2 && document.getElementById('matchLoading').hidden);
  await page.waitForFunction(() => window.DartyCommentary?.status().log.some(entry => entry.key === 'kick-off'));
  const kickoff = await page.evaluate(() => window.DartyCommentary.status().log.findLast(entry => entry.key === 'kick-off'));
  assert.equal(kickoff.key, 'kick-off');
  assert.ok(kickoff.text === 'Cheers Jeff' || kickoff.text?.startsWith('Its a lovely day today jeff'));
  assert.equal(await page.evaluate(() => window.DartyCommentary.status().captions), false);
  assert.equal(await page.locator('.darty-commentary').count(), 0);

  await page.waitForFunction(() => {
    const hint = document.getElementById('setPieceHint');
    return FLMatch.getState().phase === 'play' && hint.classList.contains('show') && /ready.*whistle heard/i.test(hint.textContent);
  }, {}, { polling: 250 });
  await page.keyboard.down('a');
  await page.waitForTimeout(250);
  await page.keyboard.up('a');
  await page.waitForFunction(() => FLLiveV2.status().gameplay?.committedTicks >= 60);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Guaranteed goal key/ }).click();
  await page.getByRole('button', { name: 'Resume match' }).click();
  await page.keyboard.press('g');
  await page.waitForFunction(() => window.DartyCommentary.status().log.some(entry => entry.key === 'goal'));
  const goal = await page.evaluate(() => {
    const entry = window.DartyCommentary.status().log.findLast(item => item.key === 'goal');
    const subtitle = document.querySelector('.darty-commentary');
    return { ...entry, subtitlePresent: !!subtitle, subtitleVisible: !!subtitle?.classList.contains('is-visible') };
  });
  assert.ok(['What a fantastic goal', 'What a wonderful goal'].includes(goal.text));
  assert.equal(goal.subtitlePresent, false);
  assert.equal(goal.subtitleVisible, false);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await page.screenshot({ path: path.join(output, 'joe-goal-commentary.png') });
  fs.writeFileSync(path.join(output, 'commentary-verification.json'), JSON.stringify({ kickoff, goal, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ kickoff, goal, errors, failedRequests }));
} finally {
  await browser.close();
}
