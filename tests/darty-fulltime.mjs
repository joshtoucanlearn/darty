import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClock } = require('../match-engine/darty-video-capture.js');
const source = readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');
const cleanCSS = readFileSync(new URL('../match-engine/darty-video-capture.css', import.meta.url), 'utf8');
const between = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};
const noop = () => {};
function element() {
  return {
    style: {}, dataset: {}, children: [], hidden: false, innerHTML: '', text: '',
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { this.text = String(value); this.children = []; },
    replaceChildren(...children) { this.text = ''; this.children = children; },
    appendChild(child) { this.children.push(child); },
    classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop,
    focus() { this.focused = true; }
  };
}

test('endMatch presents report numbers, short names and recorded scorers, and focuses restart', () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const home = { possessionTicks: 60, shots: 9, onTarget: 4, passes: 20, completed: 15, fouls: 3, yellows: 2, reds: 1, saves: 5 };
  const away = { possessionTicks: 40, shots: 7, onTarget: 6, passes: 25, completed: 20, fouls: 6, yellows: 1, reds: 0, saves: 2 };
  const context = vm.createContext({
    report: { teams: { you: home, opp: away }, events: [
      { type: 'goal', team: 'you', player: 'Player One', minute: 12 },
      { type: 'goal', team: 'you', player: 'Player Two', minute: 73, ownGoal: true },
      { type: 'goal', team: 'opp', player: 'Player Three', minute: 45 },
      { type: 'shot', team: 'you', player: 'Unscored', minute: 80 }
    ] },
    document: { getElementById: get, createElement: element },
    ftime: get('ftime'), ftScore: get('ftScore'), ftMsg: get('ftMsg'), ftStats: get('ftStats'), ftBtn: get('ftBtn'),
    homeDisplayName: 'HME', awayDisplayName: 'AWY', youScore: 2, oppScore: 1,
    you: [], opp: [], ykeep: { stats: {}, stamina: 100 }, okeep: { stats: {}, stamina: 100 },
    finishMatchAudio: noop, clearMatchPresentationUI: noop, clamp: value => value,
    logEvent(type) { context.report.events.push({ type }); }, playtestSummary: () => ({}),
    persistPlaytestLog: noop, publishFullPlaytestData: noop, query: new URLSearchParams()
  });
  get('ftime').style.display = 'none';
  vm.runInContext(between('  function showFullTimeStats()', "  document.getElementById('exportBtn').textContent=") + '\nendMatch();', context);
  assert.equal(get('ftime').style.display, 'block');
  assert.equal(get('ftScore').textContent, 'HME 2 – 1 AWY');
  assert.equal(get('ftMsg').textContent, 'HME win');
  assert.deepEqual(get('ftScorers').children.map(p => p.textContent), ['Player One 12′\nPlayer Two 73′ (OG)', 'Player Three 45′']);
  const rows = [...get('ftStats').innerHTML.matchAll(/<tr><td>(.*?)<\/td><th scope="row">(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)].map(row => row.slice(1));
  assert.deepEqual(rows, [
    ['60%', 'Possession', '40%'], ['9 (4)', 'Shots (on target)', '7 (6)'],
    ['20 (75%)', 'Passes (complete)', '25 (80%)'], ['3', 'Fouls', '6'],
    ['2', 'Yellow cards', '1'], ['1', 'Red cards', '0'], ['5', 'Saves', '2']
  ]);
  assert.equal(get('ftBtn').focused, true);
  context.report.events = [];
  context.report.score = { you: 0, opp: 0 };
  Object.assign(home, { passes: 0, completed: 0 });
  vm.runInContext('showFullTimeStats();', context);
  assert.equal(get('ftScorers').hidden, true);
  assert.equal(get('ftMsg').textContent, 'Draw');
  assert.match(get('ftStats').innerHTML, /0 \(0%\)/);
});

test('clean mode permits the full-time region and compact scrollable phone layout', () => {
  const rule = cleanCSS.match(/html\.darty-clean body > ([^{]+)\{display:none!important\}/)[1];
  const exempt = [...rule.matchAll(/:not\(([^)]+)\)/g)].map(match => match[1]);
  assert.ok(exempt.includes('#ftime'));
  assert.match(source, /<section[^>]*id="ftime"[^>]*aria-labelledby="ftTitle"[^>]*style="display:none"/);
  const panel = source.match(/#ftime\{([^}]+)\}/)[1];
  assert.match(panel, /width:min\(360px,calc\(100vw - 24px\)\)/);
  assert.match(panel, /max-height:calc\(100dvh - 24px\)/);
  assert.match(panel, /overflow:auto/);
  assert.doesNotMatch(panel, /inset:0/);
});

const payload = { mode: 'quickPlay', matchType: 'spectator', simulationSeed: 'random',
  homeTeam: { id: 'home', name: 'Home Ω', shortName: 'HME' }, awayTeam: { id: 'away', name: 'Away', shortName: 'AWY' },
  matchLengthMinutes: 2, settings: { weather: 'rain' } };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = url => JSON.parse(Buffer.from(new URLSearchParams(new URL(url).hash.slice(1)).get('flMatch'), 'base64url'));
function launch(input, randomWord = 1234) {
  let location = new URL(input);
  const window = {};
  const context = vm.createContext({ window, get location() { return location; }, URL, URLSearchParams,
    TextEncoder, TextDecoder, Uint8Array, Uint32Array, atob, btoa,
    crypto: { getRandomValues(array) { array[0] = randomWord; return array; } },
    history: { state: null, replaceState(state, unused, next) { location = new URL(next, location); } } });
  vm.runInContext(source.match(/<script id="dartyRandomSeed">([\s\S]*?)<\/script>/)[1], context);
  vm.runInContext(between('  function decodeMatchPayload(', '  const fragmentParams=') +
    between('  function matchRestartURL(', '  ftBtn.addEventListener('), context);
  return { context, window, get url() { return location.href; }, restart: () => vm.runInContext('matchRestartURL()', context) };
}
const launchURL = value => 'https://example.test/match.html?autoplay=1&clean=1&director=showcase&commentary=0&volume=30&simulationSeed=random#extra=keep&flMatch=' + encode(value);

test('random launch restart restores both random seeds and preserves every other URL/payload field', () => {
  const first = launch(launchURL(payload));
  assert.equal(first.window.__dartyRandomMatch, true);
  assert.equal(decode(first.url).simulationSeed, 1235);
  assert.equal(new URL(first.url).searchParams.get('simulationSeed'), '1235');
  const restart = first.restart();
  assert.equal(new URL(restart).searchParams.get('simulationSeed'), 'random');
  assert.deepEqual(decode(restart), payload);
  assert.equal(new URLSearchParams(new URL(restart).hash.slice(1)).get('extra'), 'keep');
  const before = new URL(first.url), after = new URL(restart);
  before.searchParams.delete('simulationSeed'); after.searchParams.delete('simulationSeed');
  assert.equal(after.search, before.search);
  const second = launch(restart, 5678);
  assert.equal(decode(second.url).simulationSeed, 5679);
});

test('fixed spectator and human fixtures reload their identical URL', () => {
  const fixed = launch(launchURL({ ...payload, simulationSeed: 42 }).replace('simulationSeed=random', 'simulationSeed=42'));
  const human = launch(launchURL({ ...payload, matchType: 'single-player', simulationSeed: 42 }));
  for (const fixture of [fixed, human]) {
    assert.equal(fixture.restart(), fixture.url);
    let reloads = 0;
    fixture.context.location.reload = () => reloads++;
    vm.runInContext('restartMatch()', fixture.context);
    assert.equal(reloads, 1);
  }
});

test('focused restart accepts Space, Enter, keyboard A and a fresh controller A press', () => {
  let clicks = 0;
  const ftBtn = { click() { clicks++; } }, other = {};
  const context = vm.createContext({ matchOver: true, ftime: { style: { display: 'block' } }, ftBtn,
    document: { activeElement: ftBtn }, editableInputTarget: () => false,
    gamepadButtonPressed: gp => gp.pressed, addEventListener(type, fn) { context.keydown = fn; } });
  vm.runInContext(between("  addEventListener('keydown',e=>{", '    if(instantReplayReviewHandleKeyDown(e))') + '});' +
    between('  function pollBoundPad(', '    if(instantReplayReviewController&&') + '}', context);
  for (const key of [' ', 'Enter', 'a', 'A']) {
    let prevented = false;
    context.keydown({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  }
  assert.equal(clicks, 4);
  context.keydown({ key: 'Enter', repeat: true, preventDefault: noop });
  assert.equal(clicks, 4);
  context.document.activeElement = other;
  context.keydown({ key: 'a', preventDefault: noop });
  assert.equal(clicks, 4);
  context.state = { previousButtons: [] };
  vm.runInContext('pollBoundPad(state,{pressed:true});', context);
  assert.equal(clicks, 4, 'controller respects focus');
  context.document.activeElement = ftBtn;
  vm.runInContext('pollBoundPad(state,{pressed:true});pollBoundPad(state,{pressed:false});pollBoundPad(state,{pressed:true});pollBoundPad(state,{pressed:true});', context);
  assert.equal(clicks, 5, 'held A cannot repeatedly restart');
  vm.runInContext('pollBoundPad(state,{pressed:false},true);pollBoundPad(state,{pressed:true},true);', context);
  assert.equal(clicks, 6, 'second controller can activate the focused button');
});

function audioHost() {
  const clock = createClock(1), nodes = [];
  class Param {
    constructor(value = 0) { this.base = value; this.events = []; }
    get value() {
      let value = this.base, previous = 0, now = clock.now() / 1000;
      for (const event of this.events) {
        if (event.time > now) return event.ramp ? value + (event.value - value) * (now - previous) / (event.time - previous) : value;
        value = event.value; previous = event.time;
      }
      return value;
    }
    set value(value) { this.base = value; this.events = []; }
    setValueAtTime(value, time) { this.events.push({ value, time }); }
    linearRampToValueAtTime(value, time) { this.events.push({ value, time, ramp: true }); }
    exponentialRampToValueAtTime(value, time) { this.setValueAtTime(value, time); }
    setTargetAtTime(value, time) { this.setValueAtTime(value, time); }
    cancelScheduledValues(time) { const value = this.value; this.events = this.events.filter(event => event.time < time); this.base = value; }
  }
  const node = (source = false) => {
    const result = { gain: new Param(), frequency: new Param(), Q: new Param(),
      connect() { return arguments[0]; }, disconnect() { this.disconnected = true; },
      start(time = clock.now() / 1000) { this.startedAt = time; }, stop(time = clock.now() / 1000) { this.stoppedAt = time; } };
    if (source) nodes.push(result);
    return result;
  };
  class AudioContext {
    state = 'running'; sampleRate = 100; destination = node();
    get currentTime() { return clock.now() / 1000; }
    createGain() { return node(); } createBiquadFilter() { return node(); }
    createBufferSource() { return node(true); } createOscillator() { return node(true); }
    createBuffer(channels, size) { return { getChannelData: () => new Float32Array(size) }; }
  }
  const context = vm.createContext({ video: null, query: new URLSearchParams('volume=30'),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), cv: element(),
    document: { getElementById: element }, window: { AudioContext }, STADIUM: { size: 'medium' },
    addEventListener: noop, showEvent: noop, setTimeout: clock.setTimeout, parent: {},
    clearTimeout: clock.clearTimer, performance: { now: clock.now } });
  vm.runInContext(between('  const requestedAudioPercent=', '  function editableInputTarget('), context);
  return { context, clock, nodes, run: code => vm.runInContext(code, context) };
}

test('final whistle completes before a one-second fade to exact zero and ambience/LFO stop', () => {
  const host = audioHost(), { run, clock, nodes } = host;
  run('initAudio(true);');
  assert.equal(run('audioMaster.gain.value'), .3);
  assert.equal(run('ambienceOn'), true);
  assert.equal(nodes.length, 2);
  run('finishMatchAudio();finishMatchAudio();');
  assert.equal(nodes.length, 8, 'one triple whistle including its three vibrato oscillators');
  const whistleEnd = Math.max(...nodes.slice(2).map(n => n.stoppedAt));
  assert.equal(whistleEnd, 1.96);
  clock.advance(960);
  assert.equal(run('audioMaster.gain.value'), .3, 'final whistle has its full gain');
  clock.advance(500);
  assert.ok(Math.abs(run('audioMaster.gain.value') - .15) < 1e-9);
  clock.advance(500);
  assert.equal(run('audioMaster.gain.value'), 0);
  assert.equal(run('ambienceOn'), false);
  assert.equal(run('ambienceNodes.length'), 0);
  assert.ok(nodes.every(n => n.stoppedAt <= clock.now() / 1000));
  assert.ok(nodes.slice(0, 2).every(n => n.disconnected));
  run('setAudioMuted(true,false);setAudioMuted(false,false);initAudio(true);startAmbience();cheer(true);kickSound(1);');
  assert.equal(run('audioMaster.gain.value'), 0);
  assert.equal(run('ambienceOn'), false);
  assert.equal(nodes.length, 8);
  const fresh = audioHost();fresh.run('initAudio(true);');
  assert.equal(fresh.run('audioMaster.gain.value'), .3);
  assert.equal(fresh.run('ambienceOn'), true);
});

test('finishing before audio unlock cannot start ambience later', () => {
  const { run, nodes } = audioHost();
  run('finishMatchAudio();initAudio(true);startAmbience();');
  assert.equal(nodes.length, 0);
  assert.equal(run('ambienceOn'), false);
});

test('full-time stops any separate commentary audio and prevents another line', async () => {
  const instances = [];
  const window = { console, setTimeout: () => 1, clearTimeout: noop,
    Audio: class { constructor() { instances.push(this); } play() { return Promise.resolve(); } pause() { this.paused = true; } } };
  vm.runInNewContext(readFileSync(new URL('../match-engine/darty-commentary.js', import.meta.url), 'utf8'), { window, console });
  const api = window.DartyCommentary;
  await api.init({ captions: false, lines: { schema: api.SCHEMA, moments: { goal: [{ text: 'Goal!', audio: 'goal.mp3' }] } } });
  api.onEvent({ type: 'goal', team: 'you', minute: 12 }, { score: { you: 1, opp: 0 } });
  assert.equal(instances.length, 1);
  api.stop();
  assert.equal(instances[0].paused, true);
  assert.equal(api.status().enabled, false);
  api.onEvent({ type: 'goal', team: 'you', minute: 13 }, { score: { you: 2, opp: 0 } });
  assert.equal(instances.length, 1);
});
