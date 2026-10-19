#!/usr/bin/env node
// DARTY shot probe (from the match lab): follows each CPU shot frame by frame,
// headlessly on the capture
// clock (virtual time + seeded randomness) and writes one JSON report per run.
//
//   node tools/match-lab.mjs [--seeds 173,442] [--minutes 6] [--out lab-runs] [--probe]
//
// Files are served straight from this worktree through request interception, so
// no local web server is needed. Gameplay is untouched: the lab only reads the
// public FLMatch / dartyCapture APIs.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = (() => { const i = process.argv.indexOf('--root'); return i >= 0 ? process.argv[i + 1] : null; })();
// --root points the lab at another copy of the game (e.g. the V1.5 lab copy's game/ folder).
const ROOT = rootArg ? path.resolve(rootArg) : LAB_DIR;
const ORIGIN = 'http://darty.lab';
const require = createRequire(import.meta.url);
const PUPPETEER = process.env.PUPPETEER_MODULE || '/Users/joshuagordonjones/Documents/ChatGPT/Toucan Learn/website/node_modules/puppeteer-core';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const puppeteer = require(PUPPETEER);

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const flag = name => args.includes('--' + name);
const seeds = String(opt('seeds', '173')).split(',').map(Number).filter(Number.isFinite);
const minutes = Number(opt('minutes', 6));
const outDir = path.resolve(LAB_DIR, opt('out', 'lab-runs'));
const probe = flag('probe');
const extraParams = Object.fromEntries(String(opt('params', '')).split('&').filter(Boolean).map(kv => kv.split('=')));
const label = opt('label', '');
const shots = Number(opt('shots', 0));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ktx2': 'image/ktx2' };

// The launch contract needs Quick Play's own payload, so the lab asks Quick Play
// to build one (Invincibles v Conte Chelsea spectator defaults), captures the
// resulting link, then sets the seed in both the query and the payload.
let launchTemplate = null;
async function getLaunchTemplate(browser) {
  if (launchTemplate) return launchTemplate;
  const page = await browser.newPage();
  await serve(page);
  await page.goto(`${ORIGIN}/quick-play/index.html?${opt('qp', 'mode=spectator&engine=fl-v2&candidate=5&release=joe-20261019-fouls')}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.buildMatchData === 'function' || typeof buildMatchData === 'function', { timeout: 30000 });
  const nav = page.waitForNavigation({ timeout: 30000 });
  await page.evaluate(() => saveAndLaunch(buildMatchData()));
  await nav;
  launchTemplate = page.url();
  await page.close();
  return launchTemplate;
}

function decodePayload(text) {
  const raw = text.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(raw.padEnd(Math.ceil(raw.length / 4) * 4, '='), 'base64').toString('utf8'));
}
function encodePayload(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function matchUrl(template, seed, extra = {}) {
  const u = new URL(template);
  const hash = new URLSearchParams(u.hash.slice(1));
  const cfg = decodePayload(hash.get('flMatch'));
  cfg.simulationSeed = seed;
  u.searchParams.set('simulationSeed', String(seed));
  u.searchParams.set('matchMinutes', String(minutes));
  u.searchParams.set('volume', '0');
  u.searchParams.set('capture', '1');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  hash.set('flMatch', encodePayload(cfg));
  u.hash = hash.toString();
  return u.toString();
}

async function serve(page) {
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return request.abort('blockedbyclient');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return request.respond({ status: 403, body: '' });
    if (file.endsWith('/')) file += 'index.html';
    if (!existsSync(file)) return request.respond({ status: 404, body: '' });
    try { request.respond({ status: 200, contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', body: await readFile(file) }); }
    catch { request.respond({ status: 500, body: '' }); }
  });
}

async function runMatch(browser, seed) {
  // Commentary probe: load throwaway markers (never real lines) and record which
  // moments fire during a CPU match.
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.setViewport({ width: 960, height: 540 });
  await serve(page);
  await page.goto(matchUrl(await getLaunchTemplate(browser), seed, { ...extraParams, commentary: '1' }), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.dartyCapture, { timeout: 60000 });
  await page.evaluate(() => window.dartyCapture.ready);
  await page.evaluate(() => { const api = window.DartyCommentary; api.load({ schema: api.SCHEMA, moments: Object.fromEntries(api.MOMENTS.map(k => [k, ['[' + k + '] {player} / {team} / {score}']])) }); });
  let shot = 0;
  for (let i = 0; i < Number(opt('chunks', 60)); i++) {
    await page.evaluate(() => window.dartyCapture.step(150));
    if (shots && shot < shots && await page.evaluate(() => { const b = document.querySelector('.darty-commentary'); return !!(b && b.classList.contains('is-visible')); })) {
      shot++; await page.screenshot({ path: path.join(outDir, `${label || 'commentary'}-seed-${seed}-${shot}.png`) });
    }
  }
  const status = await page.evaluate(() => window.DartyCommentary.status());
  await page.close();
  return { seed, traces: status.log, errors };
}

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
await mkdir(outDir, { recursive: true });
try {
  for (const seed of seeds) {
    const result = await runMatch(browser, seed);
    const file = path.join(outDir, `${label ? label + '-' : ''}commentary-seed-${seed}.json`);
    await writeFile(file, JSON.stringify(result));
    console.log(JSON.stringify({ seed, file: path.relative(LAB_DIR, file), shots: result.traces.length, errors: result.errors.length }));
  }
} finally {
  await browser.close();
}
