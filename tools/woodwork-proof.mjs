// Scripted woodwork proof: shots at the post and at the crossbar, both ends, in the real
// match host (headless, seeded). It launches each shot through the same V2 launch seam the
// CPU uses, follows it tick by tick, and reports what the ball and the players did.
//
//   node tools/woodwork-proof.mjs --url-file match-url.txt [--seed 1] [--out proof.json] [--root <game root>]
//
// For every shot it records:
//  - the contact tick (the host tick on which Ball V2 hit the frame and the ball reversed),
//  - the ball's flightType/isShot on and after that tick,
//  - the speed (m/s) and gait of the nearest outfielders over the next 1.5 s,
//  - whether anyone reached the ball (ownership, or an outfielder within 0.6 m) and when.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(option('root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
const urlFile = option('url-file');
const seed = Number(option('seed', 1));
const outFile = option('out', null);
const { createHeadlessMatch } = await import(pathToFileURL(path.join(root, 'tools/headless-cpu-match.mjs')).href);
const url = fs.readFileSync(urlFile, 'utf8').trim();

import { setupSource, sampleSource, hookSource } from './woodwork-scenario.mjs';

function runShot(spec) {
  const match = createHeadlessMatch(url, { seed, minutes: 6, scripted: true, trainVisibility: false });
  let tick = 0;
  for (; tick < 4000; tick++) {
    match.step();
    const [phase, control, held] = match.scenario('[matchPhase, liveV2ControlPhase(), kickoffHeld]');
    if (phase === 'play' && control === 'live' && !held) break;
  }
  for (let settle = 0; settle < 30; settle++) match.step();
  const setup = match.scenario(setupSource(spec));
  if (!setup.ok) return { spec, setup };
  const startIndex = match.scenario('report.events.length');
  const rows = [], trace = [];
  let previous = match.scenario(sampleSource);
  let contact = null;
  for (let t = 1; t <= 420; t++) {
    match.step();
    const now = match.scenario(sampleSource);
    const reversed = Math.sign(now.ball.vx) !== Math.sign(previous.ball.vx) && Math.abs(previous.ball.vx) > 3 && Math.abs(now.ball.vx) > 2;
    if (!contact && (reversed || now.woodwork.length > previous.woodwork.length)) contact = { tick: t, reversed, before: previous.ball, after: now.ball, nearAtContact: now.near };
    rows.push({ t, ball: now.ball, near: now.near.slice(0, 4), woodworkEvents: now.woodwork.length, recovery: now.recovery });
    if (t % 10 === 0 || (contact && t - contact.tick < 40 && t % 3 === 0)) trace.push({ t, flight: now.ball.flightType, isShot: now.ball.isShot, owner: now.ball.owner, ball: [+now.ball.x.toFixed(0), +now.ball.y.toFixed(0), +now.ball.z.toFixed(1), +now.ball.vx.toFixed(1), +now.ball.vy.toFixed(1)], near: now.near.slice(0, 3).map(q => q.id + '/' + q.team + ' d' + q.dist + ' v' + q.speed + ' ' + q.gait) });
    previous = now;
  }
  const noise = new Set(['v2-dribble-state','keeper-positioning-contract','position-contract','v2-carrier-intent','press-unit','mark-transfer','defensive-phase','keeper-contract','keeper-read','engine-authority','ai-attack-plan','ai-attack-pattern','ai-attack-stage','ai-shape-transition','camera-sequence','crowd-reaction','shot-replay-package','zone18-entry','zone20-entry','carry-zone-entry','v2-pass-decision','match-temperature','impact-sound']);
  const events = match.scenario(`report.events.slice(${startIndex}).map(e => ({ type: e.type, team: e.team || null, who: e.playerId || null, frame: e.frame, note: e.woodwork || e.kind || e.reason || e.restart || e.outcome || null }))`).filter(e => !noise.has(e.type)).slice(0, 40);
  // Reduce to the proof facts.
  const contactTick = contact && contact.tick;
  const after = contactTick ? rows.filter(row => row.t >= contactTick) : [];
  const flightAtContact = contactTick ? rows.find(row => row.t === contactTick).ball : null;
  const flightLater = contactTick ? rows.find(row => row.t === Math.min(rows.length, contactTick + 135)).ball : null;
  const firstReach = after.find(row => row.ball.owner || (row.near[0] && row.near[0].dist <= 0.6 && row.near[0].id));
  const sprintWindow = after.filter(row => row.t <= contactTick + 18);
  const peakSpeed = {};
  for (const row of sprintWindow) for (const p of row.near) peakSpeed[p.id] = Math.max(peakSpeed[p.id] || 0, p.speed);
  const peakWithin30 = {};
  for (const row of after.filter(row => row.t <= contactTick + 30)) for (const p of row.near) peakWithin30[p.id] = Math.max(peakWithin30[p.id] || 0, p.speed);
  const nearestAtContact = contact ? contact.nearAtContact.slice(0, 4) : [];
  const authoritiesAt = offset => { const row = contactTick && rows.find(r => r.t === contactTick + offset); if (!row) return null; const counts = {}; for (const a of row.recovery) counts[a.authority] = (counts[a.authority] || 0) + 1; return counts; };
  const assignmentAuthorities = contactTick ? { atContact: authoritiesAt(0), plus6: authoritiesAt(6), plus12: authoritiesAt(12), plus18: authoritiesAt(18), plus30: authoritiesAt(30) } : null;
  return {
    spec, setup, contactTick, trace, events,
    ballBeforeContact: contact && contact.before, ballAtContact: flightAtContact,
    bounced: !!contact && Math.sign(contact.after.vx) !== Math.sign(contact.before.vx) || !!contact && Math.abs(contact.after.zv - contact.before.zv) > 2,
    flightTypeOnContactTick: flightAtContact && flightAtContact.flightType, isShotOnContactTick: flightAtContact && flightAtContact.isShot,
    flightTypeTwoPointTwoFiveSecondsLater: flightLater && flightLater.flightType, isShotTwoPointTwoFiveSecondsLater: flightLater && flightLater.isShot,
    woodworkEventsLogged: rows.length ? rows[rows.length - 1].woodworkEvents : 0,
    nearestAtContact, assignmentAuthorities, peakSpeedWithin18Ticks: peakSpeed, peakSpeedWithin30Ticks: peakWithin30,
    sprinters18: Object.values(peakSpeed).filter(value => value >= 6).length,
    sprinters30: Object.values(peakWithin30).filter(value => value >= 6).length,
    reached: firstReach ? { afterTicks: firstReach.t - contactTick, seconds: +((firstReach.t - contactTick) / 60).toFixed(2), by: firstReach.ball.owner || firstReach.near[0].id } : null,
    minimumDistanceToAnyOutfielder: after.length ? +Math.min(...after.map(row => row.near[0] ? row.near[0].dist : 99)).toFixed(2) : null
  };
}


// ---- Natural play: the first goal-frame contacts of a seeded match, unscripted ----------------------
function naturalProbe(wantedContacts) {
  const match = createHeadlessMatch(url, { seed, minutes: 6, scripted: true, trainVisibility: false });
  match.scenario(hookSource);
  // Optional: leave the woodwork handler off until a tick, so the match is bit-identical to the unfixed build up to
  // that point and the first contact after it can be compared with the unfixed build's own contact at that tick.
  const enableFrom = args.includes('--handler-enabled-from') ? Number(option('handler-enabled-from', 0)) : null;
  if (enableFrom !== null) match.scenario("(() => { const real = applyWoodworkRebound; applyWoodworkRebound = function (kind, details) { return window.__woodworkOn === true ? real(kind, details) : false; }; window.__woodworkOn = false; return true; })()");
  const found = [];
  let globalTick = 0;
  const watching = [];
  for (; globalTick < 40000 && found.length < wantedContacts; globalTick++) {
    if (enableFrom !== null && globalTick === enableFrom) match.scenario('window.__woodworkOn = true');
    match.step();
    const frameContact = match.scenario('window.__lastFrameContact && window.__lastFrameContact.colliderRole');
    const now = match.scenario(sampleSource);
    for (const watch of watching) {
      const dt = globalTick - watch.tick;
      if (dt <= 150 && [0, 6, 18, 30, 60, 135, 150].includes(dt)) watch.samples.push({ afterTicks: dt, seconds: +(dt / 60).toFixed(2), flightType: now.ball.flightType, isShot: now.ball.isShot, owner: now.ball.owner,
        ballSpeed: +Math.hypot(now.ball.vx, now.ball.vy).toFixed(1), near: now.near.slice(0, 4).map(q => ({ id: q.id, team: q.team, dist: q.dist, speed: q.speed, gait: q.gait })), authorities: [...new Set(now.recovery.map(a => a.authority))] });
    }
    if (frameContact && (enableFrom === null || globalTick >= enableFrom)) {
      const entry = { tick: globalTick, role: frameContact, samples: [{ afterTicks: 0, seconds: 0, flightType: now.ball.flightType, isShot: now.ball.isShot, owner: now.ball.owner,
        ballSpeed: +Math.hypot(now.ball.vx, now.ball.vy).toFixed(1), near: now.near.slice(0, 4).map(q => ({ id: q.id, team: q.team, dist: q.dist, speed: q.speed, gait: q.gait })), authorities: [...new Set(now.recovery.map(a => a.authority))] }] };
      watching.push(entry); found.push(entry);
    }
  }
  // Let the last watch window finish.
  for (let extra = 0; extra < 160; extra++) {
    match.step(); globalTick++;
    const now = match.scenario(sampleSource);
    for (const watch of watching) {
      const dt = globalTick - watch.tick;
      if (dt <= 150 && [6, 18, 30, 60, 135, 150].includes(dt)) watch.samples.push({ afterTicks: dt, seconds: +(dt / 60).toFixed(2), flightType: now.ball.flightType, isShot: now.ball.isShot, owner: now.ball.owner,
        ballSpeed: +Math.hypot(now.ball.vx, now.ball.vy).toFixed(1), near: now.near.slice(0, 4).map(q => ({ id: q.id, team: q.team, dist: q.dist, speed: q.speed, gait: q.gait })), authorities: [...new Set(now.recovery.map(a => a.authority))] });
    }
  }
  return found;
}

const specs = [];
for (const end of ['right', 'left']) {
  specs.push({ end, target: 'post', post: 'low', distanceMetres: 14, originOffsetMetres: -4, speedMetresPerSecond: 24 });
  specs.push({ end, target: 'post', post: 'high', distanceMetres: 14, originOffsetMetres: 4, speedMetresPerSecond: 24 });
  specs.push({ end, target: 'crossbar', post: 'low', distanceMetres: 16, originOffsetMetres: 0.5, speedMetresPerSecond: 26 });
}
const natural = args.includes('--natural') ? naturalProbe(Number(option('natural-contacts', 3))) : null;
const results = args.includes('--skip-scripted') ? [] : specs.map(runShot);
const summary = results.map(r => ({ end: r.spec.end, target: r.spec.target + (r.spec.target === 'post' ? '-' + r.spec.post : ''), found: !!(r.setup && r.setup.ok),
  contactTick: r.contactTick, hit: r.setup && r.setup.chosen && r.setup.chosen.hit, bounced: r.bounced, flightTypeOnContactTick: r.flightTypeOnContactTick, isShotOnContactTick: r.isShotOnContactTick,
  flightTypeLater: r.flightTypeTwoPointTwoFiveSecondsLater, isShotLater: r.isShotTwoPointTwoFiveSecondsLater, woodworkEventsLogged: r.woodworkEventsLogged,
  assignmentAuthorities: r.assignmentAuthorities, sprinters18: r.sprinters18, sprinters30: r.sprinters30, reached: r.reached }));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ seed, root, results, summary, natural }, null, 1));
if (natural) console.error(JSON.stringify(natural.map(n => ({ tick: n.tick, role: n.role, samples: n.samples.map(x => ({ s: x.seconds, flight: x.flightType, shot: x.isShot, owner: x.owner, ballMps: x.ballSpeed, auth: x.authorities, near: x.near.map(q => q.id + ':' + q.speed + (q.gait ? '/' + q.gait : '')).join(' ') })) })), null, 1));
console.log(JSON.stringify(summary, null, 1));
