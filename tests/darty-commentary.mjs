import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../match-engine/darty-commentary.js', import.meta.url), 'utf8');
function load() {
  let clock = 0;
  const added = [];
  const bar = { textContent: '', classList: { add() {}, remove() {} }, setAttribute() {} };
  const window = {
    performance: { now: () => clock },
    setTimeout: () => 1, clearTimeout() {},
    document: { body: { appendChild: el => added.push(el) }, getElementById: () => null, createElement: () => bar },
    console
  };
  vm.runInNewContext(source, { window, console });
  return { api: window.DartyCommentary, tick: ms => { clock += ms; }, bar };
}
const ctx = { teams: { you: 'Arsenal', opp: 'Chelsea' }, keepers: { you: 'Lehmann', opp: 'Courtois' }, score: { you: 1, opp: 0 }, teamOf: id => id.startsWith('ars') ? 'you' : 'opp' };

test('silent until Joe writes lines; never invents one', () => {
  const { api } = load();
  api.load({ schema: api.SCHEMA, moments: {} });
  assert.equal(api.onEvent({ type: 'goal', team: 'you', playerId: 'ars-henry', player: 'Henry', minute: 30 }, ctx), null);
  assert.deepEqual(Object.values(api.status().lines).reduce((a, b) => a + b, 0), 0);
});

test('fills magic words, skips bad lines and unknown moments', () => {
  const { api, bar } = load();
  const count = api.load({ schema: api.SCHEMA, moments: { goal: ['{player} for {team}! {score} against {opponent} in minute {minute}', { text: '' }, 42], nonsense: ['x'] } });
  assert.equal(count, 1);
  assert.equal(api.onEvent({ type: 'goal', team: 'you', playerId: 'ars-henry', player: 'Henry', minute: 30 }, ctx), 'goal');
  assert.equal(bar.textContent, 'Henry for Arsenal! 1-0 against Chelsea in minute 30');
});

test('goal types: own goal, equaliser, late winner, header, long range', () => {
  const { api } = load();
  const m = (event, score) => api.momentFor(event, { ...ctx, score });
  assert.equal(m({ type: 'goal', team: 'you', playerId: 'che-terry', minute: 20 }, { you: 1, opp: 0 }), 'own-goal');
  assert.equal(m({ type: 'goal', team: 'you', playerId: 'ars-henry', minute: 40 }, { you: 1, opp: 1 }), 'equaliser');
  assert.equal(m({ type: 'goal', team: 'you', playerId: 'ars-henry', minute: 88 }, { you: 2, opp: 1 }), 'late-winner');
  api.momentFor({ type: 'shot', team: 'opp', shotType: 'header' }, ctx);
  assert.equal(m({ type: 'goal', team: 'opp', playerId: 'che-costa', minute: 30 }, { you: 0, opp: 2 }), 'header-goal');
  api.momentFor({ type: 'shot', team: 'opp', distance: 820 }, ctx);
  assert.equal(m({ type: 'goal', team: 'opp', playerId: 'che-hazard', minute: 50 }, { you: 0, opp: 3 }), 'long-range-goal');
  assert.equal(api.momentFor({ type: 'darty-toy-pop', team: 'opp' }, ctx), 'pop');
  assert.equal(api.momentFor({ type: 'restart', kind: 'CORNER' }, ctx), 'corner');
});

test('cooldown holds routine lines, goals cut in, no line repeats back to back', () => {
  const { api, tick } = load();
  api.load({ schema: api.SCHEMA, moments: { corner: ['c1', 'c2'], goal: ['g1', 'g2', 'g3'] } });
  assert.equal(api.onEvent({ type: 'restart', kind: 'CORNER' }, ctx), 'corner');
  tick(500);
  assert.equal(api.onEvent({ type: 'restart', kind: 'CORNER' }, ctx), null, 'routine line waits for the cooldown');
  assert.equal(api.onEvent({ type: 'goal', team: 'you', playerId: 'ars-henry', minute: 10 }, { ...ctx, score: { you: 2, opp: 0 } }), 'goal', 'a goal interrupts');
  const said = [];
  for (let i = 0; i < 6; i++) { tick(10000); api.onEvent({ type: 'goal', team: 'you', playerId: 'ars-henry', minute: 10 }, { ...ctx, score: { you: 3 + i, opp: 0 } }); said.push(api.status().log.at(-1).text); }
  for (let i = 1; i < said.length; i++) assert.notEqual(said[i], said[i - 1]);
});
