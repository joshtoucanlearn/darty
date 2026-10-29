// Render-free Node runner for the real match host, including keepers, referee,
// presentations, restarts and the V2 period clock. No browser or network.
// node tools/headless-cpu-match.mjs --url-file /path/match-url.txt --seeds 1,2 --minutes 2
import fs from 'node:fs';
import { createCohesionMetrics } from './cohesion-metrics.mjs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createClock } = require('../match-engine/darty-video-capture.js');
const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
const html = read('match-engine/match.html');
const sourceHashes = Object.fromEntries(['match-engine/match.html', 'match-engine/live-v2-authority-adapter.js', 'tools/headless-cpu-match.mjs', 'tools/cohesion-metrics.mjs', 'match-engine/formation-behaviour-v2.js', 'match-engine/cpu-intelligence-v2.js']
  .map(filename => [filename, createHash('sha256').update(read(filename)).digest('hex')]));
const noop = () => {};

export function createCommitProgressMonitor() {
  let hostTicks = 0, liveHostTicks = 0, committedTick = 0, waiting = 0, maximum = 0, regressions = 0;
  const stallWindows = [];
  return {
    observe(live, committed) {
      hostTicks++;
      if (live) liveHostTicks++;
      if (committed < committedTick) regressions++;
      if (committed > committedTick) waiting = 0;
      else if (live) waiting++;
      // Pauses and presentations suspend this budget; only a commit resets it.
      // Observe the host independently of its watchdog and retain past stalls.
      maximum = Math.max(maximum, waiting);
      if (waiting === 600 && live) stallWindows.push({ hostTick: hostTicks, committedTick: committed });
      committedTick = committed;
    },
    snapshot: () => ({ hostTicks, liveHostTicks, lastCommittedTick: committedTick,
      maximumLiveTicksWithoutCommit: maximum, commitCounterRegressions: regressions,
      stallWindows: stallWindows.map(row => ({ ...row })) })
  };
}

export function countsAsFullTime(state, { stalled = false, capped = false } = {}) {
  return state.phase === 'ended' && state.halfTime === true && state.fullTime === true &&
    !state.authority.failureCode && !stalled && !capped &&
    state.progress.liveHostTicks > 0 && state.progress.lastCommittedTick > 0 &&
    state.progress.maximumLiveTicksWithoutCommit < 600 && state.progress.commitCounterRegressions === 0;
}

export function createHeadlessMatch(inputUrl, { seed, minutes, passRace = true, physicalTouch = true } = {}) {
  const url = new URL(inputUrl);
  const payload = JSON.parse(Buffer.from(new URLSearchParams(url.hash.slice(1)).get('flMatch'), 'base64url'));
  seed ??= payload.simulationSeed;
  payload.simulationSeed = seed;
  if (minutes !== undefined) payload.matchLengthMinutes = minutes;
  url.hash = 'flMatch=' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  url.searchParams.set('simulationSeed', String(seed));
  if (minutes !== undefined) url.searchParams.set('matchMinutes', String(minutes));
  // The supplied launch URL repeats this marker; the preflight rejects repeats.
  // Normalize the marker without changing spectator ownership or the payload.
  url.searchParams.set('autoplay', '1');
  url.searchParams.set('volume', '0');
  if (!passRace) url.searchParams.set('labPassRace', '0');
  if (!physicalTouch) url.searchParams.set('labPhysicalTouch', '0');
  const clock = createClock(seed);
  const progress = createCommitProgressMonitor();
  const cohesion = createCohesionMetrics();
  const canvasContext = new Proxy({}, {
    get(object, key) {
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop: noop });
      return object[key] || noop;
    }
  });
  function element() {
    return {
      style: {}, dataset: {}, children: [], textContent: '', value: '',
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
      addEventListener: noop, removeEventListener: noop, setAttribute: noop, removeAttribute: noop,
      appendChild(child) { this.children.push(child); return child; },
      closest: () => null, before: noop, querySelector: () => null, querySelectorAll: () => [],
      getContext: () => canvasContext,
      getBoundingClientRect: () => ({ width: 640, height: 360, left: 0, top: 0 }),
      focus: noop, blur: noop, click: noop, remove: noop, toDataURL: () => ''
    };
  }
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    createElement: element, createElementNS: element, querySelector: () => null, querySelectorAll: () => [],
    body: element(), head: element(), documentElement: element(), addEventListener: noop, visibilityState: 'visible'
  };
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
  Object.assign(context, {
    console, document, __cohesion: cohesion, location: url, navigator: { getGamepads: () => [], userAgent: 'Node fixed-tick host' },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array,
    atob: text => Buffer.from(text, 'base64').toString('binary'),
    performance: { now: clock.now }, setTimeout: clock.setTimeout, setInterval: clock.setInterval,
    clearTimeout: clock.clearTimer, clearInterval: clock.clearTimer,
    requestAnimationFrame: noop, cancelAnimationFrame: noop, addEventListener: noop, removeEventListener: noop,
    innerWidth: 640, innerHeight: 360, devicePixelRatio: 1,
    Image: class { addEventListener() {} }, fetch: async () => ({ ok: false }),
    getComputedStyle: () => ({ display: 'block' }),
    DartyStartup: { stage: noop, ready: noop, fail: noop }, DartyVideo: null, __random: clock.random,
    __now: () => 1700000000000 + clock.now()
  });
  context.window = context;
  context.parent = context;
  const execute = (code, filename) => vm.runInContext(code, context, { filename });
  execute('Math.random=__random;Date.now=__now;', 'headless-clock.js');
  execute(read('match-engine/vendor/three.min.js'), 'three.js');
  context.THREE.WebGLRenderer = class {
    constructor() { this.shadowMap = {}; this.info = { render: {} }; this.domElement = element(); }
    setPixelRatio() {} getPixelRatio() { return 1; } setSize() {} render() {}
    getSize(vector) { return vector.set(640, 360); }
  };
  execute(read('match-engine/darty-impact-v1.js'), 'darty-impact-v1.js');
  document.write = text => {
    const filename = text.match(/src="([^"?]+)/)?.[1];
    if (filename) execute(read('match-engine/' + filename), filename);
  };
  execute(html.match(/<script id="offlineLiveV2Preflight">([\s\S]*?)<\/script>/)[1], 'preflight.js');
  if (!context.__FL_V2_LIVE_PREFLIGHT.eligible) throw new Error('headless spectator preflight rejected');
  // Lab overrides stay in this VM; the browser capture gate and shipping
  // defaults remain unchanged. Record the adapter's actual profile in state.
  const authorityApi = context.FootballLegacyLiveV2Authority;
  context.FootballLegacyLiveV2Authority = { ...authorityApi, createAttachment: options =>
    authorityApi.createAttachment({ ...options, cpuPassRaceFilter: passRace, trueFeelPhysicalTouchAuthority: physicalTouch }) };
  const start = html.indexOf('<script>\n(function(){') + '<script>'.length;
  const end = html.lastIndexOf('</script>\n<script src="set-piece-system.js"');
  const bridge = `
    const observedLogEvent=logEvent;
    logEvent=function(...args){observedLogEvent(...args);const event=report.events[report.events.length-1];
      if(event&&(event.type==='pass'||event.type==='pass-resolved'))__cohesion.event({...event,
        progress:attackDirection(event.team)===1?(ball.x-M)/(W-2*M):1-(ball.x-M)/(W-2*M)});};
    let cohesionTicks=0;
    window.__headless={
      tick(){const live=matchPhase==='play'&&liveV2ControlPhase()==='live';
        try{DT=1;update();recordReplayFrame(performance.now());}catch(error){liveV2Stop(error);}
        const owner=logicalLivePossessionOwner();
        if(live)__cohesion.possession({owner:owner&&{family:positionFamily(owner)},loose:!owner&&!ball.target});
        else __cohesion.possession({owner:null,loose:false});
        if(live&&++cohesionTicks%60===0){const source=owner||ball.lastKicker;
          __cohesion.sample({possessionTeam:source&&source.team,ownerId:owner&&owner.id,ball:{x:(ball.x-M)*105/(W-2*M),y:ball.y*68/H},
            players:[...you,...opp].map(p=>({id:p.id,team:p.team,sentOff:p.sentOff,isGK:p.isGK,family:positionFamily(p),
              x:(p.x-M)*105/(W-2*M),y:p.y*68/H}))});}
        return{live,committed:liveV2AuthorityTotals.lastCommittedTick};},
      state:()=>({phase:matchPhase,minute:minuteNow(),clockFrames,score:[youScore,oppScore],
        authority:liveV2AuthorityTelemetry(),hostPhase:liveV2ControlPhase(),
        sentOffPlayers:[...you,...opp].filter(player=>player.sentOff).length,keeperOwns:!!(ball&&ball.owner&&ball.owner.isGK),
        redCards:[report.teams.you.reds,report.teams.opp.reds],
        matchStats:['you','opp'].map(team=>({shots:report.teams[team].shots,passes:report.teams[team].passes,
          completed:report.teams[team].completed,offsides:report.teams[team].offsides,
          onTarget:report.teams[team].onTarget,fouls:report.teams[team].fouls})),
        gameplayEligible:liveV2CanAdvance(),reset:inReset(),clockRunning,
        ball:{x:ball&&ball.x,y:ball&&ball.y,z:ball&&ball.z,speed:ball?Math.hypot(ball.vx,ball.vy,ball.zv):0,
          owned:!!(ball&&ball.owner),logicalOwned:!!liveV2Carrier(),shot:!!(ball&&ball.isShot)},
        halfTime:report.events.some(e=>e.type==='half-time'),fullTime:report.events.some(e=>e.type==='full-time')})
    };
  `;
  execute(html.slice(start, end).replace('  setCameraMode(cameraMode,false);', bridge + '\n  setCameraMode(cameraMode,false);'), 'match-host.js');
  clock.advance(200); // The host's existing 180 ms automatic start.
  return {
    state: () => ({ ...context.__headless.state(), progress: progress.snapshot(), cohesion: cohesion.snapshot() }),
    step() { clock.advance(1000 / 60); const sample = context.__headless.tick(); progress.observe(sample.live, sample.committed); }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (name, fallback) => { const index = process.argv.indexOf('--' + name); return index < 0 ? fallback : process.argv[index + 1]; };
  const url = fs.readFileSync(option('url-file'), 'utf8').trim();
  const seeds = option('seeds', '2415640915,1713525629').split(',').map(Number);
  const minutes = Number(option('minutes', '2'));
  const maxTicks = Number(option('max-ticks', String((minutes * 60 + 900) * 60)));
  for (const seed of seeds) {
    // Run with --expose-gc on shared, memory-constrained hosts so a previous
    // match's VM and module graphs are reclaimed before constructing the next.
    global.gc?.();
    const started = Date.now();
    const gates = { passRace: option('pass-race', 'on') !== 'off', physicalTouch: option('physical-touch', 'on') !== 'off' };
    const match = createHeadlessMatch(url, { seed, minutes, ...gates });
    let state, tick = 0, stationaryTicks = 0, stalled = false;
    for (; tick < maxTicks; tick++) {
      if (tick % 600 === 0 && fs.statfsSync(root).bavail * fs.statfsSync(root).bsize < 6 * 1024 ** 3) throw new Error('free disk below 6 GiB');
      match.step();
      if (tick % 120 === 0) {
        state = match.state();
        stationaryTicks = state.hostPhase === 'live' && !state.ball.logicalOwned && state.ball.speed === 0
          ? stationaryTicks + 120 : 0;
        stalled = stationaryTicks >= 1800 || state.progress.stallWindows.length > 0;
        if (state.phase === 'ended' || state.authority.failureCode || stalled) break;
      }
    }
    state = match.state();
    console.log(JSON.stringify({ seed, minutes, gates, sourceHashes, ticks: tick + 1, wallSeconds: (Date.now() - started) / 1000,
      clockFinished: state.phase === 'ended', fullTimeReached: countsAsFullTime(state, { stalled, capped: tick >= maxTicks }),
      capped: tick >= maxTicks, stalled, ...state }));
  }
}
