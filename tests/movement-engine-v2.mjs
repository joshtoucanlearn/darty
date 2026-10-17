import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modulePath = path.join(root, 'match-engine', 'movement-engine-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const require = createRequire(import.meta.url);
const Movement = require(modulePath);
const FIXED_TICK = 1 / 60;

const speed = player => Math.hypot(player.velocity.x, player.velocity.y);
const byId = (world, id) => world.players.find(player => player.id === id);

function player(id, teamId, x, y, data = {}) {
  return {
    id,
    teamId,
    role: data.role || 'midfielder',
    position: { x, y },
    velocity: data.velocity || { x: 0, y: 0 },
    facing: data.facing || { x: 1, y: 0 },
    radius: data.radius,
    mass: data.mass,
    staminaLevel: data.staminaLevel ?? 100,
    touchBurstUntilTick: data.touchBurstUntilTick,
    touchBurstAccelerationMultiplier: data.touchBurstAccelerationMultiplier,
    attributes: {
      pace: 78,
      acceleration: 78,
      agility: 78,
      balance: 78,
      strength: 78,
      stamina: 80,
      defending: 70,
      aggression: 72,
      control: 78,
      ...(data.attributes || {})
    }
  };
}

function world(players, data = {}) {
  return {
    tick: data.tick ?? 0,
    fixedTickSeconds: data.fixedTickSeconds ?? FIXED_TICK,
    bounds: data.bounds || { xMin: -100, xMax: 100, yMin: -50, yMax: 50 },
    ballOwnerId: data.ballOwnerId ?? null,
    players
  };
}

function loadOldConfigPathReference() {
  const replacements = [
    [
      '.map(player => createPlayerStateWithConfig(player, config));',
      '.map(player => createPlayerState(player, config));'
    ],
    [
      'players.map(player => createPlayerStateWithConfig(player, config)).sort',
      'players.map(player => createPlayerState(player, config)).sort'
    ],
    [
      'const world = createWorldStateWithConfig(worldState, config);',
      'const world = createWorldState(worldState, config);'
    ],
    [
      'const separated = separatePlayersWithConfig(world.players, world.bounds, config);',
      'const separated = separatePlayers(world.players, world.bounds, config);'
    ]
  ];
  let referenceSource = source;
  for (const [current, oldPath] of replacements) {
    assert.equal(referenceSource.includes(current), true, `missing movement reference splice: ${current}`);
    referenceSource = referenceSource.replace(current, oldPath);
  }
  const context = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(referenceSource, context, { filename: 'movement-engine-v2-old-config-path.js' });
  return context.module.exports;
}

const OldConfigPathMovement = loadOldConfigPathReference();

test('CommonJS module exposes the complete dormant movement/contact v2 API', () => {
  assert.equal(Movement.VERSION, '2.0.0-dormant');
  assert.equal(Movement.PLAYER_SCHEMA, 'football-legacy-movement-player-v2');
  assert.equal(Movement.WORLD_SCHEMA, 'football-legacy-movement-world-v2');
  assert.equal(Movement.TELEMETRY_SCHEMA, 'football-legacy-movement-telemetry-v2');
  for (const name of [
    'createPlayerState', 'createWorldState', 'isCompleteWorldState', 'sweptApproach',
    'separatePlayers', 'advance', 'step', 'createFailedToRegisterStandTackleFixture',
    'createShoulderChallengeFixture', 'createDecelerationFixture', 'createSharpTurnFixture',
    'createFatigueFixture'
  ]) assert.equal(typeof Movement[name], 'function', `${name} must be exported`);
  assert.equal(Movement.DEFAULT_CONFIG.fixedTickSeconds, FIXED_TICK);
});

test('plain browser script exposes window.FootballLegacyMovementEngineV2', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow });
  assert.equal(browserWindow.FootballLegacyMovementEngineV2.VERSION, Movement.VERSION);
  assert.equal(typeof browserWindow.FootballLegacyMovementEngineV2.advance, 'function');
});

test('EXACT-FLAG AUTHORITY GATE: Build 173 has no unconditional movement V2 load or live call', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']movement-engine-v2\.js/i);
  assert.match(matchHtml, /id="build173V2ShadowPreflight"/);
  assert.doesNotMatch(matchHtml, /FootballLegacyMovementEngineV2/);
  assert.match(source, /intentionally dormant/i);
});

test('kernel has no random source, presentation clock or asynchronous scheduler', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test('fixed-tick contract and explicit command ticks are enforced', () => {
  const base = world([player('runner', 'home', 0, 0)]);
  assert.throws(() => Movement.createWorldState({ ...base, fixedTickSeconds: 1 / 30 }), /must match/);
  assert.throws(() => Movement.createWorldState({ ...base, tick: -1 }), /world tick/);
  assert.throws(() => Movement.advance(base, [{ playerId: 'runner', type: 'move' }], 1), /explicit/);
  assert.throws(() => Movement.advance(base, [], 1.5), /ticks/);
  assert.throws(() => Movement.advance(base, [], 3601), /ticks/);
});

test('validated-config reuse is byte-identical to the old per-player config path', () => {
  const config = { fixedTickSeconds: FIXED_TICK, separationIterations: 3, playerRadius: 0.42 };
  const sample = world([
    player('alpha', 'home', -0.1, 0, {
      role: 'CM', velocity: { x: 0.3, y: -0.1 }, facing: { x: 0.8, y: 0.2 },
      attributes: { pace: 91, acceleration: 88, balance: 83, strength: 79, control: 92 }
    }),
    player('beta', 'away', 0.15, 0.08, {
      role: 'CB', velocity: { x: -0.2, y: 0.05 }, attributes: { defending: 90, strength: 91 }
    }),
    player('gamma', 'home', 8, 4, { role: 'LW', staminaLevel: 72 })
  ], { ballOwnerId: 'alpha' });
  const commands = [{
    id: 'representative-config-reuse', tick: 1, playerId: 'alpha', type: 'move',
    move: { x: 0.9, y: 0.25 }, facing: { x: 0.9, y: 0.25 }, mode: 'sprint', durationTicks: 2
  }];

  assert.equal(
    JSON.stringify(Movement.createWorldState(sample, config)),
    JSON.stringify(OldConfigPathMovement.createWorldState(sample, config))
  );
  assert.equal(
    JSON.stringify(Movement.step(sample, commands, config)),
    JSON.stringify(OldConfigPathMovement.step(sample, commands, config))
  );
  assert.equal(
    JSON.stringify(Movement.advance(sample, commands, 24, config)),
    JSON.stringify(OldConfigPathMovement.advance(sample, commands, 24, config)),
    'the internal canonical-player shortcut must preserve exact multi-tick recanonicalisation semantics'
  );
  assert.equal(
    JSON.stringify(Movement.separatePlayers(sample.players, sample.bounds, config)),
    JSON.stringify(OldConfigPathMovement.separatePlayers(sample.players, sample.bounds, config))
  );
});

test('canonical-player shortcut preserves exact multi-tick facing recanonicalisation', () => {
  const config = {
    fixedTickSeconds: FIXED_TICK,
    playerRadius: 0.2221336681395769,
    separationIterations: 3,
    safetyVelocityLimit: 16.49476738460362
  };
  const sample = world([player('recanonicalised-facing', 'home', 36.88385374844074, -28.86006292887032, {
    role: 'CB',
    velocity: { x: -5.779067503288388, y: -0.5312072215601802 },
    facing: { x: -0.6710189022123814, y: 0.7728325622156262 },
    staminaLevel: 40.03216866403818,
    attributes: {
      pace: 60.38762742653489, acceleration: 63.87030973099172,
      agility: 99, balance: 33.58910319395363, strength: 10.32207241281867,
      stamina: 15.911103738471866, defending: 98.2784366235137,
      aggression: 63.048910880461335, control: 36.71145664528012
    }
  })], {
    tick: 17,
    bounds: { xMin: -60, xMax: 60, yMin: -40, yMax: 40 }
  });
  const commands = [{ id: 'stop-recanonicalised-facing', tick: 18, playerId: 'recanonicalised-facing', type: 'stop' }];
  assert.equal(
    JSON.stringify(Movement.advance(sample, commands, 12, config)),
    JSON.stringify(OldConfigPathMovement.advance(sample, commands, 12, config))
  );
});

test('public movement APIs still fail closed on invalid config after internal reuse', () => {
  const sample = world([player('fail-closed', 'home', 0, 0)]);
  assert.throws(() => Movement.createPlayerState(sample.players[0], { playerRadius: -1 }), /playerRadius.*positive/);
  assert.throws(() => Movement.createWorldState(sample, { fixedTickSeconds: 0 }), /fixedTickSeconds.*positive/);
  assert.throws(() => Movement.separatePlayers(sample.players, sample.bounds, { separationIterations: -1 }), /separationIterations/);
  assert.throws(() => Movement.step(sample, [], { safetyVelocityLimit: 0 }), /safetyVelocityLimit.*positive/);
});

test('state factories sanitize non-finite input and stepping is pure and JSON-safe', () => {
  const malformed = world([{
    id: 'safe', teamId: 'home', position: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    velocity: { x: Number.NEGATIVE_INFINITY, y: Number.NaN }, facing: { x: 0, y: 0 },
    staminaLevel: Number.NaN
  }]);
  const state = Movement.createWorldState(malformed);
  assert.equal(Movement.isCompleteWorldState(state), true);
  const original = world([player('runner', 'home', 0, 0)]);
  const commands = [{ id: 'run', tick: 1, playerId: 'runner', type: 'move', move: { x: 1, y: 0 }, durationTicks: 20 }];
  const beforeWorld = JSON.stringify(original);
  const beforeCommands = JSON.stringify(commands);
  const first = Movement.advance(original, commands, 20);
  const second = Movement.advance(original, commands, 20);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(original), beforeWorld);
  assert.equal(JSON.stringify(commands), beforeCommands);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.telemetry.authority, 'dormant-candidate');
});

test('acceleration reaches but never exceeds the parameterized sprint cap', () => {
  const start = world([player('winger', 'home', 0, 0, {
    role: 'winger', attributes: { pace: 99, acceleration: 99 }
  })]);
  const commands = [{
    id: 'sprint', tick: 1, playerId: 'winger', type: 'move', move: { x: 1, y: 0 },
    sprint: true, intensity: 1, durationTicks: 180
  }];
  const first = Movement.advance(start, commands, 1).state;
  const settled = Movement.advance(first, commands, 179).state;
  assert.ok(speed(byId(first, 'winger')) > 0);
  assert.ok(speed(byId(settled, 'winger')) > speed(byId(first, 'winger')));
  const theoreticalCap = Movement.DEFAULT_CONFIG.sprintSpeedMaximum * Movement.ROLE_PROFILES.winger.speed;
  assert.ok(speed(byId(settled, 'winger')) <= theoreticalCap + 1e-10);
});

test('contextual run, jockey and shield states have explicit distinct caps', () => {
  const players = [
    player('run', 'home', -30, -20),
    player('jockey', 'home', -30, 0),
    player('shield', 'home', -30, 20)
  ];
  const commands = [
    { tick: 1, playerId: 'run', type: 'move', move: { x: 1, y: 0 }, mode: 'run', durationTicks: 240 },
    { tick: 1, playerId: 'jockey', type: 'move', move: { x: 1, y: 0 }, mode: 'jockey', durationTicks: 240 },
    { tick: 1, playerId: 'shield', type: 'move', move: { x: 1, y: 0 }, mode: 'shield', durationTicks: 240 }
  ];
  const result = Movement.advance(world(players), commands, 180).state;
  assert.equal(byId(result, 'run').locomotionState, 'run');
  assert.equal(byId(result, 'jockey').locomotionState, 'jockey');
  assert.equal(byId(result, 'shield').locomotionState, 'shield');
  assert.ok(speed(byId(result, 'run')) > speed(byId(result, 'jockey')));
  assert.ok(speed(byId(result, 'jockey')) > speed(byId(result, 'shield')));
});

test('ball carriers keep a small control-scaled pace cost while off-ball pace stays unchanged', () => {
  const command = id => [{ tick: 1, playerId: id, type: 'move', move: { x: 1, y: 0 }, mode: 'sprint', durationTicks: 240 }];
  const sample = (id, control, owner) => Movement.advance(world([
    player(id, 'home', -40, 0, { attributes: { pace: 88, acceleration: 88, control } })
  ], { ballOwnerId: owner ? id : null }), command(id), 180).state.players[0];
  const lowCarrier = sample('low-carrier', 45, true), lowRunner = sample('low-runner', 45, false);
  const eliteCarrier = sample('elite-carrier', 96, true), eliteRunner = sample('elite-runner', 96, false);
  const lowPenalty = 1 - speed(lowCarrier) / speed(lowRunner), elitePenalty = 1 - speed(eliteCarrier) / speed(eliteRunner);
  assert.ok(lowPenalty > elitePenalty, 'elite control reduces the carrier penalty');
  assert.ok(lowPenalty > 0.008 && lowPenalty < 0.036, lowPenalty);
  assert.ok(elitePenalty > 0.007 && elitePenalty < 0.014, elitePenalty);
  assert.equal(speed(lowRunner), speed(eliteRunner), 'off-ball top speed does not depend on control');
});

test('directional first-touch burst lasts two ticks, affects acceleration only and never raises terminal speed', () => {
  const move = id => [{ tick: 1, playerId: id, type: 'move', move: { x: 1, y: 0 }, mode: 'sprint', durationTicks: 240 }];
  const baseWorld = world([player('base', 'home', -40, 0, { attributes: { pace: 86, acceleration: 84 } })]);
  const burstWorld = world([player('burst', 'home', -40, 0, {
    attributes: { pace: 86, acceleration: 84 }, touchBurstUntilTick: 2, touchBurstAccelerationMultiplier: 1.08
  })]);
  const baseOne = Movement.advance(baseWorld, move('base'), 1).state;
  const burstOne = Movement.advance(burstWorld, move('burst'), 1).state;
  assert.ok(speed(byId(burstOne, 'burst')) > speed(byId(baseOne, 'base')), 'burst changes early acceleration');
  const baseTerminal = Movement.advance(baseOne, move('base'), 179).state;
  const burstTerminal = Movement.advance(burstOne, move('burst'), 179).state;
  assert.equal(speed(byId(burstTerminal, 'burst')), speed(byId(baseTerminal, 'base')), 'terminal maximum remains identical');
  assert.equal(byId(burstTerminal, 'burst').touchBurstUntilTick, 2, 'burst chronology is serialized in state');
});

test('DECELERATION FIXTURE: released input brakes monotonically to rest', () => {
  const fixture = Movement.createDecelerationFixture();
  assert.equal(fixture.name, 'released-input deceleration');
  const one = Movement.advance(fixture.world, fixture.commands, 1).state;
  const twenty = Movement.advance(one, fixture.commands, 19).state;
  const stopped = Movement.advance(twenty, fixture.commands, 100).state;
  assert.ok(speed(byId(one, fixture.playerId)) < 7.2);
  assert.ok(speed(byId(twenty, fixture.playerId)) < speed(byId(one, fixture.playerId)));
  assert.equal(speed(byId(stopped, fixture.playerId)), 0);
  assert.equal(byId(stopped, fixture.playerId).locomotionState, 'idle');
});

test('SHARP-TURN FIXTURE: direction cannot reverse instantly but does complete', () => {
  const fixture = Movement.createSharpTurnFixture();
  assert.equal(fixture.name, 'sharp-turn inertia');
  const first = Movement.advance(fixture.world, fixture.commands, 1).state;
  const firstPlayer = byId(first, fixture.playerId);
  assert.ok(firstPlayer.velocity.x > 0, 'first tick must preserve forward momentum');
  assert.ok(firstPlayer.facing.x > 0.9, 'facing may not snap through 180 degrees');
  assert.notEqual(firstPlayer.facing.y, 0, 'deterministic turn arc must begin');
  const turned = Movement.advance(first, fixture.commands, 89).state;
  assert.ok(byId(turned, fixture.playerId).velocity.x < 0, 'player must eventually run into the requested direction');
  assert.ok(byId(turned, fixture.playerId).facing.x < -0.99);
});

test('human 45, 90 and 180 degree steering is direct, rated and never speed-snapped', () => {
  const run = (angleDegrees, agility = 82, balance = 80) => {
    const fixture = Movement.createSharpTurnFixture();
    const radians = angleDegrees * Math.PI / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    fixture.world.players[0].velocity = { x: 6, y: 0 };
    fixture.world.players[0].attributes = {
      ...fixture.world.players[0].attributes, agility, balance
    };
    fixture.commands[0] = {
      ...fixture.commands[0], move: direction, durationTicks: 90, responsivenessMultiplier: 1.42
    };
    let state = Movement.createWorldState(fixture.world), alignedAt = null, targetPaceAt = null,
      minimumSpeed = Infinity, maximumForward = 0, maximumCrossTrack = 0;
    const normal = { x: -direction.y, y: direction.x };
    for (let tick = 1; tick <= 90; tick += 1) {
      state = Movement.advance(state, fixture.commands, 1).state;
      const actor = byId(state, fixture.playerId);
      const actorSpeed = speed(actor);
      const headingDot = actorSpeed <= 1e-9 ? -1 :
        (actor.velocity.x * direction.x + actor.velocity.y * direction.y) / actorSpeed;
      minimumSpeed = Math.min(minimumSpeed, actorSpeed);
      maximumForward = Math.max(maximumForward, actor.position.x);
      maximumCrossTrack = Math.max(maximumCrossTrack,
        Math.abs(actor.position.x * normal.x + actor.position.y * normal.y));
      if (alignedAt == null && headingDot >= Math.cos(10 * Math.PI / 180)) alignedAt = tick;
      if (targetPaceAt == null && actor.velocity.x * direction.x + actor.velocity.y * direction.y >= 1) targetPaceAt = tick;
    }
    return { actor: byId(state, fixture.playerId), alignedAt, targetPaceAt,
      minimumSpeed, maximumForward, maximumCrossTrack };
  };
  const cut45 = run(45), cut90 = run(90), reverse = run(180);
  assert.ok(cut45.alignedAt <= 14 && cut45.minimumSpeed > 5.5 && cut45.maximumCrossTrack <= .65,
    JSON.stringify(cut45));
  assert.ok(cut90.alignedAt <= 20 && cut90.minimumSpeed > 2.5 && cut90.maximumCrossTrack <= 1.1,
    JSON.stringify(cut90));
  assert.ok(reverse.alignedAt <= 18 && reverse.targetPaceAt <= 24 && reverse.minimumSpeed < .5,
    JSON.stringify(reverse));
  assert.ok(reverse.maximumForward <= .9 && reverse.maximumCrossTrack <= 1e-9, JSON.stringify(reverse));
  assert.ok(reverse.actor.velocity.x < 0 && reverse.actor.facing.x < -.99);

  const elite = run(180, 99, 99), lower = run(180, 50, 50);
  assert.ok(elite.targetPaceAt < reverse.targetPaceAt && reverse.targetPaceAt < lower.targetPaceAt,
    JSON.stringify({ elite, ordinary: reverse, lower }));
  assert.ok(elite.maximumForward < reverse.maximumForward && reverse.maximumForward < lower.maximumForward,
    JSON.stringify({ elite, ordinary: reverse, lower }));
});

test('FATIGUE FIXTURE: sustained sprint drains stamina, lowers speed and recovery restores it', () => {
  const fixture = Movement.createFatigueFixture();
  assert.equal(fixture.name, 'sprint fatigue and recovery');
  const fresh = Movement.advance(fixture.world, fixture.commands, 180).state;
  const fatigued = Movement.advance(fresh, fixture.commands, fixture.sprintTicks - 180).state;
  const freshPlayer = byId(fresh, fixture.playerId);
  const fatiguedPlayer = byId(fatigued, fixture.playerId);
  assert.ok(fatiguedPlayer.stamina < freshPlayer.stamina);
  assert.ok(fatiguedPlayer.stamina < Movement.DEFAULT_CONFIG.lowStaminaThreshold);
  assert.ok(speed(fatiguedPlayer) < speed(freshPlayer));
  const recovered = Movement.advance(fatigued, fixture.commands, fixture.recoveryTicks).state;
  const recoveredPlayer = byId(recovered, fixture.playerId);
  assert.ok(recoveredPlayer.stamina > fatiguedPlayer.stamina);
  assert.equal(speed(recoveredPlayer), 0);
  assert.equal(recoveredPlayer.locomotionState, 'idle');
});

test('FRAME-CHUNK INVARIANCE: one continuous advance equals arbitrary tick chunks exactly', () => {
  const fixture = Movement.createFatigueFixture();
  const continuous = Movement.advance(fixture.world, fixture.commands, 1080).state;
  let chunked = fixture.world;
  for (const ticks of [137, 211, 89, 300, 343]) {
    chunked = Movement.advance(chunked, fixture.commands, ticks).state;
  }
  assert.deepEqual(chunked, continuous);
});

test('swept approach detects between-tick contact without tunnelling and rejects a clear miss', () => {
  const contact = Movement.sweptApproach(
    { x: 0, y: 0 }, { x: 4, y: 0 }, 0.35,
    { x: 2, y: 0 }, { x: 2, y: 0 }, 0.35,
    0
  );
  assert.equal(contact.hit, true);
  assert.equal(contact.time, 0.5);
  assert.equal(contact.closestDistance, 0);
  const miss = Movement.sweptApproach(
    { x: 0, y: 0 }, { x: 4, y: 0 }, 0.35,
    { x: 2, y: 2 }, { x: 2, y: 2 }, 0.35,
    0
  );
  assert.equal(miss.hit, false);
  assert.equal(miss.closestDistance, 2);
});

test('player separation is deterministic, mass-weighted and does not mutate inputs', () => {
  const inputs = [
    player('light', 'home', 0, 0, { mass: 40 }),
    player('heavy', 'away', 0, 0, { mass: 100 })
  ];
  const before = JSON.stringify(inputs);
  const first = Movement.separatePlayers(inputs, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
  const second = Movement.separatePlayers(inputs, { xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(inputs), before);
  const light = first.players.find(item => item.id === 'light');
  const heavy = first.players.find(item => item.id === 'heavy');
  assert.ok(Math.abs(light.position.x) > Math.abs(heavy.position.x), 'lighter body must yield farther');
  assert.ok(Math.hypot(light.position.x - heavy.position.x, light.position.y - heavy.position.y) >=
    light.radius + heavy.radius - 1e-6);
  assert.ok(first.contacts.some(contact => contact.type === 'player-separation'));
});

test('FAILED-TO-REGISTER STAND TACKLE: every press acknowledges and enters a visible action window', () => {
  const fixture = Movement.createFailedToRegisterStandTackleFixture();
  assert.equal(fixture.name, 'failed-to-register stand tackle regression');
  const pressed = Movement.advance(fixture.world, fixture.commands, 1);
  const actor = byId(pressed.state, fixture.actorId);
  assert.equal(actor.lastCommandAck.commandId, 'stand-tackle-press');
  assert.equal(actor.lastCommandAck.accepted, true);
  assert.equal(actor.visibleAction, true);
  assert.equal(actor.locomotionState, 'stand-tackle-windup');
  assert.equal(actor.action.acknowledged, true);
  assert.ok(pressed.telemetry.commandAcks.some(event => event.commandId === 'stand-tackle-press'));
  assert.ok(pressed.telemetry.actions.some(event => event.type === 'action-window-entered' && event.visible));

  const missed = Movement.advance(pressed.state, fixture.commands, 12);
  const resolved = byId(missed.state, fixture.actorId);
  assert.equal(resolved.action.outcome, 'miss');
  assert.equal(resolved.visibleAction, true, 'recovery remains visible after the miss');
  assert.equal(resolved.locomotionState, 'stand-tackle-recovery');
  assert.ok(missed.telemetry.actions.some(event => event.type === 'tackle-miss'));
});

test('stand-tackle contact produces deterministic contact/win telemetry and possession transfer', () => {
  const start = world([
    player('tackler', 'home', 0, 0, {
      role: 'defender', attributes: { defending: 99, strength: 96, aggression: 96, acceleration: 90 }
    }),
    player('carrier', 'away', 0.92, 0, {
      attributes: { control: 45, balance: 45, strength: 45 }
    })
  ], { ballOwnerId: 'carrier' });
  const commands = [{
    id: 'clean-tackle', tick: 1, playerId: 'tackler', type: 'stand-tackle',
    targetId: 'carrier', direction: { x: 1, y: 0 }
  }];
  const result = Movement.advance(start, commands, 10);
  assert.equal(result.state.ballOwnerId, 'tackler');
  assert.ok(result.telemetry.contacts.some(event => event.type === 'tackle-contact' && event.outcome === 'win'));
  assert.ok(result.telemetry.actions.some(event => event.type === 'tackle-win'));
  assert.equal(byId(result.state, 'tackler').action.outcome, 'win');
});

test('slide-tackle has a longer committed contact and recovery window with explicit telemetry', () => {
  const start = world([
    player('slider', 'home', 0, 0, {
      role: 'defender', attributes: { defending: 99, strength: 92, aggression: 98, acceleration: 92 }
    }),
    player('carrier', 'away', 1.65, 0, {
      attributes: { control: 45, balance: 45, strength: 45 }
    })
  ], { ballOwnerId: 'carrier' });
  const commands = [{
    id: 'committed-slide', tick: 1, playerId: 'slider', type: 'slide-tackle',
    targetId: 'carrier', direction: { x: 1, y: 0 }
  }];
  const contact = Movement.advance(start, commands, 15);
  const slider = byId(contact.state, 'slider');
  assert.equal(contact.state.ballOwnerId, 'slider');
  assert.equal(slider.visibleAction, true);
  assert.equal(slider.locomotionState, 'slide-tackle-recovery');
  assert.ok(contact.telemetry.contacts.some(event => event.type === 'slide-contact' && event.outcome === 'win'));
  assert.ok(contact.telemetry.actions.some(event => event.type === 'slide-win'));
  const recovered = Movement.advance(contact.state, [], 30);
  assert.equal(byId(recovered.state, 'slider').action, null);
});

test('SHOULDER-CHALLENGE FIXTURE: physical win is explicit and transfers possession', () => {
  const fixture = Movement.createShoulderChallengeFixture();
  assert.equal(fixture.name, 'shoulder challenge contact');
  const result = Movement.advance(fixture.world, fixture.commands, 15);
  assert.equal(result.state.ballOwnerId, fixture.actorId);
  assert.ok(result.telemetry.contacts.some(event => event.type === 'shoulder-contact' && event.outcome === 'win'));
  assert.ok(result.telemetry.actions.some(event => event.type === 'shoulder-win'));
});

test('role and physical attributes parameterize speed, acceleration and body mass', () => {
  const sprint = [{ tick: 1, playerId: 'subject', type: 'move', move: { x: 1, y: 0 }, sprint: true, durationTicks: 180 }];
  const wingerWorld = world([player('subject', 'home', 0, 0, {
    role: 'winger', attributes: { pace: 99, acceleration: 99, strength: 50 }
  })]);
  const keeperWorld = world([player('subject', 'home', 0, 0, {
    role: 'goalkeeper', attributes: { pace: 40, acceleration: 40, strength: 90 }
  })]);
  const winger = byId(Movement.advance(wingerWorld, sprint, 180).state, 'subject');
  const keeper = byId(Movement.advance(keeperWorld, sprint, 180).state, 'subject');
  assert.ok(speed(winger) > speed(keeper));
  assert.ok(keeper.mass > winger.mass);
});

test('position vectors cannot leak into role metadata when a role is omitted', () => {
  const subject = Movement.createPlayerState({
    id: 'role-safe', teamId: 'home', position: { x: 3, y: -2 }
  });
  assert.equal(subject.role, 'midfielder');
  assert.equal(subject.roleFamily, 'midfielder');
  assert.deepEqual(subject.position, { x: 3, y: -2 });
});

test('finite-state safety guard clamps extreme velocity and records the correction', () => {
  const start = world([player('unsafe', 'home', 0, 0, { velocity: { x: 1000, y: 0 } })]);
  const result = Movement.advance(start, [], 1);
  assert.ok(speed(byId(result.state, 'unsafe')) <= Movement.DEFAULT_CONFIG.safetyVelocityLimit + 1e-10);
  assert.ok(result.telemetry.safety.some(event => event.type === 'velocity-clamped' && event.playerId === 'unsafe'));
  assert.equal(byId(result.state, 'unsafe').safetyCorrections, 1);
});

test('unknown-player commands are deterministically rejected without corrupting state', () => {
  const start = world([player('known', 'home', 0, 0)]);
  const result = Movement.advance(start, [{ tick: 1, playerId: 'missing', type: 'stand-tackle' }], 1);
  assert.equal(result.telemetry.commandAcks.length, 1);
  assert.deepEqual(result.telemetry.commandAcks[0], {
    type: 'command-rejected', commandId: 'stand-tackle:missing:1:0', commandType: 'stand-tackle',
    playerId: 'missing', tick: 1, accepted: false, reason: 'unknown-player'
  });
  assert.equal(Movement.isCompleteWorldState(result.state), true);
});
