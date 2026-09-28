import test from 'node:test';
import assert from 'node:assert/strict';
import Darty from '../match-engine/darty-impact-v1.js';
import Movement from '../match-engine/movement-engine-v2.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function contact(overrides = {}) {
  return {
    type: 'tackle-contact',
    commandId: 'tackle-1',
    tick: 100,
    actorId: 'home-4',
    targetId: 'away-9',
    outcome: 'win',
    relativeClosingSpeed: 5.4,
    ...overrides
  };
}

test('soft contacts and lost challenges do not count as hard hits', () => {
  const tracker = Darty.createTracker();
  assert.equal(tracker.register(contact({ relativeClosingSpeed: 4.59 })).reason, 'below-hard-threshold');
  assert.equal(tracker.register(contact({ commandId: 'lost', outcome: 'contact-lost', relativeClosingSpeed: 8 })).reason, 'non-winning-contact');
  assert.equal(tracker.snapshot('away-9').hardHits, 0);
});

test('one telemetry episode cannot count twice, even if projected again', () => {
  const tracker = Darty.createTracker();
  const first = tracker.register(contact());
  const repeated = tracker.register(contact({ tick: 101 }));
  assert.equal(first.accepted, true);
  assert.equal(first.target.hardHits, 1);
  assert.equal(repeated.reason, 'duplicate-episode');
  assert.equal(tracker.snapshot('away-9').hardHits, 1);
});

test('two command IDs inside one collision window remain one impact episode', () => {
  const tracker = Darty.createTracker();
  assert.equal(tracker.register(contact()).accepted, true);
  const sameCollision = tracker.register(contact({ commandId: 'tackle-2', tick: 108 }));
  assert.equal(sameCollision.reason, 'same-contact-window');
  assert.equal(tracker.snapshot('away-9').hardHits, 1);
});

test('the first hard tackle detaches exactly one leg; later contacts cannot pop again', () => {
  const tracker = Darty.createTracker();
  const first = tracker.register(contact());
  assert.equal(first.accepted, true);
  assert.ok(['legL', 'legR'].includes(first.detachPart));
  assert.equal(first.target.hardHits, 1);
  const second = tracker.register(contact({ commandId: 'tackle-2', tick: 140, actorId: 'home-6' }));
  assert.equal(second.reason, 'already-detached');
  assert.equal(second.detachPart, null);
  assert.equal(second.target.hardHits, 1);
});

test('hits stay isolated per victim and a hard shoulder clash chooses the head', () => {
  const tracker = Darty.createTracker();
  tracker.register(contact());
  assert.equal(tracker.snapshot('away-9').hardHits, 1);
  assert.equal(tracker.snapshot('away-7').hardHits, 0);
  const head = tracker.register(contact({
    type: 'shoulder-contact', commandId: 'shoulder-1', tick: 150, targetId: 'away-7',
    actorId: 'home-5', relativeClosingSpeed: 5.3
  }));
  assert.equal(head.detachPart, 'head');
  assert.equal(head.target.hardHits, 1);
});

test('reset starts a clean match for every player', () => {
  const tracker = Darty.createTracker();
  tracker.register(contact());
  tracker.reset();
  assert.deepEqual(tracker.snapshot('away-9'), {
    targetId: 'away-9', hardHits: 0, detachedPart: null, lastAcceptedTick: null
  });
  assert.equal(tracker.register(contact()).target.hardHits, 1);
});

test('real Movement V2 contact telemetry distinguishes a soft press from a running hard shoulder', () => {
  const fixture = Movement.createShoulderChallengeFixture();
  const run = speed => {
    const world = structuredClone(fixture.world);
    world.players[0].velocity.x = speed;
    world.players[1].velocity.x = 0;
    return Movement.advance(world, fixture.commands, 15).telemetry.contacts
      .find(event => event.type === 'shoulder-contact');
  };
  const soft = run(3.2);
  const hard = run(6);
  assert.equal(soft.outcome, 'win');
  assert.equal(hard.outcome, 'win');
  assert.ok(soft.approachSpeedMps < 4.9);
  assert.ok(hard.approachSpeedMps >= 4.9);
  const tracker = Darty.createTracker();
  assert.equal(tracker.register({ ...soft, relativeClosingSpeed: soft.approachSpeedMps }).accepted, false);
  const first = tracker.register({ ...hard, relativeClosingSpeed: hard.approachSpeedMps, tick: 100 });
  assert.equal(first.target.hardHits, 1);
  assert.equal(first.detachPart, 'head');
});

// Exercise the actual host bridge with contacts resolved by Movement V2. In
// particular, its older relativeClosingSpeed is zero in these contact fixtures.
const matchSource = readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');
const bridgeSource = matchSource.slice(matchSource.indexOf('  function dartyRecordCommittedContacts('), matchSource.indexOf('  function contactImpact('));
function hostHarness() {
  const tracker = Darty.createTracker(), queue = [], events = [];
  const players = new Map([
    ['strong-challenger', { id: 'strong-challenger', team: 'you' }],
    ['ball-carrier', { id: 'ball-carrier', team: 'opp' }]
  ]);
  const totals = { lastCommittedTick: 100, gameplayEpochs: 1 };
  const context = vm.createContext({
    dartyTracker: tracker, dartyDetachQueue: queue, liveV2AuthorityTotals: totals,
    liveV2PlayerById: id => players.get(id),
    logEvent: (type, team, player, detail) => events.push({ type, ...detail }),
    showEvent() {}
  });
  vm.runInContext(bridgeSource, context);
  return { tracker, queue, events, totals, players, record: context.dartyRecordCommittedContacts };
}
function resolvedContact(type, id, speed = 6) {
  const fixture = Movement.createShoulderChallengeFixture();
  fixture.world.players[0].velocity.x = speed;
  fixture.world.players[0].attributes.defending = 95;
  fixture.world.players[1].velocity.x = 0;
  fixture.commands[0].type = type;
  fixture.commands[0].id = id;
  return { movementTelemetry: Movement.advance(fixture.world, fixture.commands, 15).telemetry };
}

for (const type of ['stand-tackle', 'shoulder-challenge']) {
  test(`the first committed hard ${type} contact reaches the host pop queue exactly once`, () => {
    const host = hostHarness();
    host.record(resolvedContact(type, 'soft', 3.2));
    assert.equal(host.tracker.snapshot('ball-carrier').hardHits, 0);
    const first = resolvedContact(type, 'first');
    host.record(first);
    assert.equal(host.tracker.snapshot('ball-carrier').hardHits, 1);
    assert.equal(host.queue.length, 1);
    host.totals.lastCommittedTick = 140;
    host.record(first);
    assert.equal(host.tracker.snapshot('ball-carrier').hardHits, 1);
    host.record(resolvedContact(type, 'second'));
    assert.equal(host.queue.length, 1);
    assert.equal(host.queue[0].targetId, 'ball-carrier');
    assert.match(host.queue[0].part, type === 'stand-tackle' ? /^leg[LR]$/ : /^head$/);
    assert.equal(host.events.filter(event => event.type === 'darty-toy-pop').length, 1);
  });
}

test('host bridge excludes missing, same-team and sent-off players', () => {
  const host = hostHarness(), projection = resolvedContact('shoulder-challenge', 'hard');
  host.players.get('ball-carrier').team = 'you';
  host.record(projection);
  host.players.get('ball-carrier').team = 'opp';
  host.players.get('ball-carrier').sentOff = true;
  host.record(projection);
  host.players.delete('ball-carrier');
  host.record(projection);
  assert.equal(host.events.length, 0);
  assert.equal(host.queue.length, 0);
});
