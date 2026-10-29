// Production host/V2 scripts with DOM and GPU adapters, not a second simulation.
// The optional draw mode runs the real scene/pose code; it does not verify pixels.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

module.exports = async function loadCaptureHost(options = {}) {
  const html = options.html ?? fs.readFileSync(root + '/match-engine/match.html', 'utf8');
  const elements = new Map();
  const noop = () => {};
  function element(id = '') {
    const classes = new Set(), gradient = { addColorStop: noop };
    const ctx = new Proxy({
      canvas: null, createLinearGradient: () => gradient,
      createRadialGradient: () => gradient, measureText: () => ({ width: 20 }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) })
    }, { get: (object, key) => key in object ? object[key] : noop,
      set: (object, key, value) => (object[key] = value, true) });
    const node = {
      id, style: { setProperty: noop }, dataset: {}, children: [],
      classList: {
        add: (...values) => values.forEach(value => classes.add(value)),
        remove: (...values) => values.forEach(value => classes.delete(value)),
        contains: value => classes.has(value),
        toggle(value, on) {
          if (on === undefined) on = !classes.has(value);
          on ? classes.add(value) : classes.delete(value); return on;
        }
      },
      textContent: '', value: '', hidden: false,
      addEventListener: noop, removeEventListener: noop,
      appendChild(child) { this.children.push(child); return child; },
      append: noop, remove: noop, focus: noop, setAttribute: noop,
      getAttribute: () => null, querySelectorAll: () => [], querySelector: () => null,
      getBoundingClientRect: () => ({ width: 1280, height: 720, left: 0, top: 0 }),
      getContext: () => ctx, closest: () => null, hasAttribute: () => false,
      dispatchEvent: noop
    };
    ctx.canvas = node; return node;
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element(id));
  const document = {
    readyState: 'complete', body: element('body'), documentElement: element('html'),
    getElementById: id => elements.get(id) || null, createElement: element,
    querySelectorAll: () => [], querySelector: () => null,
    addEventListener: noop, write: noop
  };
  const seed = options.seed ?? 1772652239;
  const payload = options.payload ?? {
    mode: 'quickPlay', matchType: 'spectator', practiceMode: null, online: null,
    engine: { requested: 'fl-v2', effective: 'fl-v2',
      version: '1.0.0-offline-live-authority-playtest', fallbackReason: null },
    simulationSeed: seed,
    homeTeam: { id: 'arsenal-0304', name: 'Arsenal 03/04' },
    awayTeam: { id: 'chelsea-1617', name: 'Chelsea 16/17' },
    controllers: { player1Team: null, player2Team: null, aiTeam: 'both' }
  };
  const timers = [];
  const sandbox = {
    document, location: {
      search: options.search ?? ('?quickPlay=1&engine=fl-v2&candidate=5&simulationSeed=' + seed +
        '&autoplay=1&capture=1&clean=1&director=' + (options.director ?? 'showcase') + '&camera=' + (options.camera ?? 'broadcast') + '&matchMinutes=' + (options.matchMinutes ?? 6)),
      hash: '#flMatch=' + Buffer.from(JSON.stringify(payload)).toString('base64url'),
      origin: 'http://darty.local'
    },
    navigator: {}, URLSearchParams, TextDecoder, TextEncoder, Uint8Array, console,
    performance: { now: () => 0 }, setTimeout: fn => (timers.push(fn), timers.length),
    clearTimeout: noop, setInterval: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop, addEventListener: noop,
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    Image: class {}, getComputedStyle: () => ({ display: 'block' }), CustomEvent: class {}
  };
  sandbox.window = sandbox; sandbox.parent = sandbox;
  const context = vm.createContext(sandbox);
  const run = (code, filename) => vm.runInContext(code, context, { filename });
  document.write = text => {
    for (const [, src] of text.matchAll(/src="([^"]+)"/g))
      run(fs.readFileSync(root + '/match-engine/' + src.split('?')[0], 'utf8'), src);
  };
  for (const [, attrs, originalCode] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attrs.match(/src="([^"]+)"/);
    if (src) {
      // The standalone 2D set-piece UI and controller navigation are not used by
      // this autonomous V2 spectator match. Browser checks load both normally.
      if (/set-piece-system|controller-ui/.test(src[1])) continue;
      run(options.scripts?.[src[1]] ?? fs.readFileSync(path.resolve(root + '/match-engine', src[1].split('?')[0]), 'utf8'), src[1]);
      if (!src[1].includes('three.min')) continue;
      sandbox.THREE.PMREMGenerator = class {
        compileEquirectangularShader() {}
        fromEquirectangular() { return { texture: new sandbox.THREE.Texture() }; }
        dispose() {}
      };
      sandbox.THREE.TextureLoader = class {
        load(url, onLoad) {
          const texture = new sandbox.THREE.Texture(); if (onLoad) onLoad(texture); return texture;
        }
      };
      sandbox.THREE.WebGLRenderer = class {
        constructor() {
          this.shadowMap = {}; this.info = { render: {} };
          this.capabilities = { getMaxAnisotropy: () => 1 };
        }
        setPixelRatio() {} setSize() {} getPixelRatio() { return 1; }
        render() { sandbox.renderCount = (sandbox.renderCount || 0) + 1; }
      };
    } else if (originalCode.trim()) {
      const code = options.draw
        ? originalCode.replace('  window.FLMatch={', `
          window.__videoVisual=()=>({camera:camera.position.toArray(),cameraFov:camera.fov,
            rotation:camera.quaternion.toArray(),ball:ballMesh.position.toArray(),
            players:youMeshes.map(mesh=>({position:mesh.position.toArray(),
              rotation:mesh.quaternion.toArray(),phase:mesh.userData.phase}))});
          window.FLMatch={`)
        : originalCode.replace('sample:()=>recordReplayFrame(performance.now()),draw,render:renderVideoFrame,',
          'sample:()=>recordReplayFrame(performance.now()),draw:()=>{},render:()=>{},');
      run(code, 'match-inline.js');
    }
  }
  for (const fn of timers.splice(0)) fn();
  await sandbox.dartyCapture.ready;
  return sandbox;
};
