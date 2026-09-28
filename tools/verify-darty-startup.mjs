import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const engines = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.DARTY_BROWSER || 'chromium';
const base = process.env.DARTY_BASE_URL || 'http://127.0.0.1:4333';
const output = process.env.DARTY_PROOF_DIR || '/tmp/darty-startup-proof';
fs.mkdirSync(output, { recursive: true });
const browser = await engines[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400 && !response.url().includes('favicon')) failedRequests.push(response.url()); });
try {
  await page.goto(base + '/darty.html', { waitUntil: 'networkidle' });
  assert.match(await page.locator('.rules').innerText(), /One hard hit/);
  await page.getByRole('link', { name: 'Set up a DARTY match' }).click();
  await page.waitForLoadState('networkidle');
  for (const id of ['confirmTeams', 'confirmManagement', 'confirmSetup', 'confirmControls', 'startMatch']) await page.locator('#' + id).click();
  const loadedAt = Date.now();
  await page.waitForFunction(() => window.FLMatch && window.FLLiveV2 && document.getElementById('matchLoading').hidden, {}, { timeout: 60000 });
  const startupMs = Date.now() - loadedAt;
  console.log(engine + ': pitch rendered after ' + startupMs + ' ms');
  assert.equal(await page.evaluate(() => DartyImpactV1.DEFAULTS.hitsToDetach), 1);
  assert.match(await page.locator('#dartyBadge').innerText(), /1 hard hit/i);
  await page.waitForFunction(() => {
    const hint = document.getElementById('setPieceHint');
    return FLMatch.getState().phase === 'play' && hint.classList.contains('show') && /ready.*whistle heard/i.test(hint.textContent);
  }, {}, { timeout: 45000, polling: 250 });
  console.log(engine + ': whistle ready');
  await page.keyboard.down('a');
  await page.waitForTimeout(250);
  await page.keyboard.up('a');
  await page.waitForFunction(() => FLLiveV2.status().gameplay?.committedTicks >= 60, {}, { timeout: 45000 });
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(1000);
  await page.keyboard.up('ArrowRight');
  const result = await page.evaluate(() => ({ phase: FLMatch.getState().phase, live: FLLiveV2.status(), darty: FLMatch.getDartyState() }));
  assert.equal(result.live.strictStopped, false);
  assert.equal(result.live.failure, null);
  assert.equal(result.darty.version, '1.1.0-one-hit');
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await page.screenshot({ path: path.join(output, engine + '-match.png') });
  fs.writeFileSync(path.join(output, engine + '-match.json'), JSON.stringify({ startupMs, result, errors, failedRequests }, null, 2));
  console.log(JSON.stringify({ engine, startupMs, ticks: result.live.gameplay.committedTicks, version: result.darty.version, errors, failedRequests }));

  // Failure injection checks only recovery UI, never simulates live gameplay.
  await page.route('**/darty-impact-v1.js?*', route => route.abort());
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('heading', { name: 'The match could not start' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reload match' }).isVisible(), true);
  await page.screenshot({ path: path.join(output, engine + '-load-recovery.png') });
  await page.unroute('**/darty-impact-v1.js?*');
  await page.getByRole('button', { name: 'Reload match' }).click();
  await page.waitForFunction(() => window.FLMatch && document.getElementById('matchLoading').hidden, {}, { timeout: 60000 });
  console.log(engine + ': missing-file recovery and Reload match passed');

  let releaseDownload;
  const downloadGate = new Promise(resolve => { releaseDownload = resolve; });
  await page.route('**/darty-impact-v1.js?*', async route => { await downloadGate; await route.continue(); });
  await page.reload({ waitUntil: 'commit' });
  await page.getByRole('heading', { name: 'Loading your match…', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Still loading your match…', exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await page.getByRole('button', { name: 'Reload match' }).isVisible(), true);
  releaseDownload();
  await page.waitForFunction(() => window.FLMatch && document.getElementById('matchLoading').hidden, {}, { timeout: 60000 });
  console.log(engine + ': delayed-file loading feedback and recovery passed');
} catch (error) {
  await page.screenshot({ path: path.join(output, engine + '-failure.png') });
  console.error(JSON.stringify({ errors, failedRequests, text: (await page.locator('body').innerText()).slice(-2500) }));
  throw error;
} finally { await browser.close(); }
