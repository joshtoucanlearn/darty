#!/usr/bin/env node
// DARTY skill/slide probe (lab only): a human carrier does skills (Q), a human
// defender slides (D D), and every frame records whether FL V2 is still running.
//   node tools/skill-slide-probe.mjs [--seeds 173] [--reps 6]
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://darty.lab';
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_MODULE || '/Users/joshuagordonjones/Documents/ChatGPT/Toucan Learn/website/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const seeds = String(opt('seeds', '173')).split(',').map(Number);
const reps = Number(opt('reps', 6));
const outDir = path.resolve(ROOT, opt('out', 'lab-runs'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };

async function serve(page) {
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin !== ORIGIN) return request.abort('blockedbyclient');
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return request.respond({ status: 403, body: '' });
    if (file.endsWith('/')) file += 'index.html';
    if (!existsSync(file)) return request.respond({ status: 404, body: '' });
    request.respond({ status: 200, contentType: TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', body: await readFile(file) });
  });
}
const decode = t => JSON.parse(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const encode = o => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function launchUrl(browser, seed) {
  const page = await browser.newPage(); await serve(page);
  // Single Player (human v CPU), not spectator.
  await page.goto(`${ORIGIN}/quick-play/index.html?engine=fl-v2&candidate=5&release=joe-20261026-lesson-ready`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof buildMatchData === 'function', { timeout: 30000 });
  const nav = page.waitForNavigation({ timeout: 30000 });
  await page.evaluate(() => saveAndLaunch(buildMatchData()));
  await nav; const u = new URL(page.url()); await page.close();
  const hash = new URLSearchParams(u.hash.slice(1)); const cfg = decode(hash.get('flMatch')); cfg.simulationSeed = seed;
  u.searchParams.set('simulationSeed', String(seed)); u.searchParams.set('matchMinutes', '6'); u.searchParams.set('volume', '0'); u.searchParams.set('capture', '1');
  hash.set('flMatch', encode(cfg)); u.hash = hash.toString(); return u.toString();
}

const frame = () => { const s = window.FLMatch.getState(); return s.engine; };

async function run(browser, seed) {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  await page.setViewport({ width: 640, height: 360 }); await serve(page);
  await page.goto(await launchUrl(browser, seed), { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.dartyCapture, { timeout: 60000 });
  await page.evaluate(() => window.dartyCapture.ready);
  const out = { seed, skills: [], slides: [], errors };
  for (let r = 0; r < reps; r++) {
    // Skill: carrier 30 m out, defenders left in place, press Q while running.
    await page.evaluate(lat => { window.FLMatch.debugShotSetup(30, lat, false); window.dartyCapture.step(4); }, (r % 3 - 1) * 6);
    const combos = String(opt('combos', 'ArrowRight,Shift+ArrowRight,ArrowLeft,ArrowDown,ArrowRight+ArrowDown')).split(',').map(c => c === 'none' ? [] : c.split('+'));
    const combo = combos[r % combos.length];
    await page.keyboard.down('Shift'); await page.keyboard.down('ArrowRight'); await page.evaluate(() => window.dartyCapture.step(12));
    await page.keyboard.up('ArrowRight'); if (!combo.includes('Shift')) await page.keyboard.up('Shift');
    for (const k of combo) if (k !== 'Shift') await page.keyboard.down(k);
    const before = await page.evaluate(() => { const s = window.FLMatch.getState(); return { tick: s.engine.v2Tick, owner: s.ball.owner, live: s.engine.v2Live, phase: s.phase, held: s.restart.held }; });
    await page.keyboard.down('q'); await page.evaluate(() => window.dartyCapture.step(1)); await page.keyboard.up('q');
    const trace = await page.evaluate(() => { const t = []; for (let i = 0; i < 40; i++) { window.dartyCapture.step(1); const s = window.FLMatch.getState(); const h = s.players.find(p => p.id === 'ars-henry'); t.push([s.engine.v2Live ? 1 : 0, s.engine.v2Tick, s.ball.owner || '-', s.phase, s.engine.hostOwned.join(','), Math.round(Math.hypot(s.ball.x - h.x, s.ball.y - h.y)), Math.round(h.x), Math.round(h.y)]); } return t; });
    for (const k of combo) await page.keyboard.up(k);
    const skillEv = await page.evaluate(() => window.FLMatch.getReport().events.slice(-12).map(e => [e.type, e.phase || e.outcome || e.dribbleOutcome || e.skill || '', e.player || e.playerId || ''].join(':')));
    out.skills.push({ rep: r, combo: combo.join('+'), before, v2LiveFrames: trace.filter(f => f[0]).length, frames: trace.length, resets: trace.filter((f, i) => i && f[1] < trace[i - 1][1]).length, moves: [...new Set(trace.map(f => f[4]).filter(Boolean))], movesLiveV2: trace.filter(f => f[4] && f[0]).length, events: skillEv, ownerEnd: trace.at(-1)[2], trace: trace.map(f => f.join('|')), phaseEnd: trace.at(-1)[3] });
  }
  for (let r = 0; r < reps; r++) {
    // Slide: human defender, CPU forward running at him; double-tap D.
    const ids = await page.evaluate(gap => { const r = window.FLMatch.debugDefendSetup(gap, 0); window.dartyCapture.step(2); return r; }, 3 + (r % 3));
    const start = await page.evaluate(() => window.FLMatch.getReport().events.length);
    await page.keyboard.press('d'); await page.keyboard.press('d');
    const trace = await page.evaluate(id => { const t = []; for (let i = 0; i < 50; i++) { window.dartyCapture.step(1); const s = window.FLMatch.getState(); const h = s.players.find(p => p.id === id); t.push([s.engine.v2Live ? 1 : 0, s.engine.v2Tick, s.ball.owner || '-', s.phase, s.engine.hostOwned.join(','), Math.round(Math.hypot(s.ball.x - h.x, s.ball.y - h.y))]); } return t; }, ids.defender);
    const ev = await page.evaluate(st => window.FLMatch.getReport().events.slice(st).map(e => e.type).filter(t => /slide|foul|tackle|free-kick|card|v2-/.test(t)), start);
    out.slides.push({ rep: r, ids, v2LiveFrames: trace.filter(f => f[0]).length, frames: trace.length, moves: [...new Set(trace.map(f => f[4]).filter(Boolean))], movesLiveV2: trace.filter(f => f[4] && f[0]).length, events: ev, ownerEnd: trace.at(-1)[2], phaseEnd: trace.at(-1)[3], trace: r === 0 ? trace.map(f => f.join('|')) : undefined });
  }
  await page.close();
  return out;
}

const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
await mkdir(outDir, { recursive: true });
try { for (const seed of seeds) { const r = await run(browser, seed); await writeFile(path.join(outDir, `skill-slide-${seed}.json`), JSON.stringify(r)); console.log(JSON.stringify(r)); } }
finally { await browser.close(); }
