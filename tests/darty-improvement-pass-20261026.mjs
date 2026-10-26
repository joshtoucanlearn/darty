import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'match-engine');
const require = createRequire(import.meta.url);
const Adapter = require(path.join(engine, 'live-v2-authority-adapter.js'));
const Ball = require(path.join(engine, 'ball-engine-v2.js'));
const Movement = require(path.join(engine, 'movement-engine-v2.js'));
const CPU = require(path.join(engine, 'cpu-intelligence-v2.js'));
const Formation = require(path.join(engine, 'formation-behaviour-v2.js'));
const Contact = require(path.join(engine, 'live-v2-contact-authority-composer.js'));
const Dribbling = require(path.join(engine, 'dribbling-state-v2.js'));
const matchSource = readFileSync(path.join(engine, 'match.html'), 'utf8');

function liveSnapshot() {
  const pitch = { xMin: 0, xMax: 105, yMin: -34, yMax: 34 };
  const teams = ['you', 'opp'].map(teamId => ({
    id: teamId,
    formation: '4-3-3',
    phase: teamId === 'opp' ? 'settled-attack' : 'defend',
    philosophy: null,
    attackingDirection: teamId === 'you' ? 1 : -1,
    offsideLine: teamId === 'you' ? 90 : 15,
    tactics: {},
    lineup: Formation.canonicalLineup('4-3-3').map(row => ({ ...row, id: `${teamId}-${row.slotId}` }))
  }));
  const players = teams.flatMap(team => Formation.resolve({
    formation: team.formation,
    phase: team.phase,
    tick: 1,
    lineup: team.lineup,
    pitch,
    attackingDirection: team.attackingDirection,
    offsideLine: team.offsideLine,
    tactics: {}
  }).targets.map(target => ({
    id: target.playerId,
    teamId: team.id,
    role: target.position,
    position: target.position,
    slotId: target.slotId,
    x: target.target.x,
    y: target.target.y,
    vx: 0,
    vy: 0,
    fx: team.attackingDirection,
    fy: 0,
    radius: 0.42,
    stamina: 100,
    attrs: { pace: 82, accel: 82, agility: 82, balance: 82, strength: 82, stamina: 82,
      awareness: 84, pass: 82, shoot: 78, control: 84, defend: 80, aggression: 82 },
    isGK: target.position === 'GK',
    sentOff: false,
    contactEligible: true,
    tackleActive: false,
    shoulderActive: false,
    control: null
  })));
  const challenger = players.find(player => player.teamId === 'you' && !player.isGK);
  const opponents = players.filter(player => player.teamId === 'opp' && !player.isGK);
  const carrier = opponents[0];
  const nearerBystander = opponents[1];
  Object.assign(challenger, {
    x: 50, y: 0, fx: 1, fy: 0, tackleActive: true,
    control: { x: 1, y: 0, strength: 1, sprint: true, shield: false }
  });
  Object.assign(nearerBystander, { x: 50.5, y: 0 });
  Object.assign(carrier, { x: 53, y: 0, fx: -1, fy: 0 });
  return {
    challenger,
    carrier,
    snapshot: {
      tick: 1,
      fixedTickSeconds: 1 / 60,
      difficulty: 'ultimate',
      pitch,
      units: { xPerMetre: 1, yPerMetre: 1, zPerMetre: 1 },
      players,
      humanPlayerIds: [challenger.id],
      ball: { id: 'live-ball', x: carrier.x, y: carrier.y, z: 0, vx: 0, vy: 0, zv: 0,
        spin: 0, dip: 0, ownerId: carrier.id, targetId: null, lastKickerId: null,
        lastKickerTeamId: null, flightType: '', authoredRouteExpired: false, launchIntent: null },
      teams,
      contact: { intendedReceiverId: null, firstTouchIntent: null, aerialIntent: null,
        gate: { livePlay: true, restartActive: false, replayActive: false, keeperAuthority: false,
          offsideInvolvementPending: false, specialActionAuthority: false } },
      dribbling: { surface: 'dry', actionIntent: null, directionalKnockOnIntent: null }
    }
  };
}

test('a carried ball can cross either goal line only inside the goal mouth', () => {
  const declaration = matchSource.match(/function controlledCarryGoalTeam\([^}]+\}/)?.[0];
  assert.ok(declaration, 'controlled carry goal helper must stay directly testable');
  const context = { M: 100, W: 3500, H: 2300, GOAL_H: 250, BALLR: 5, result: null };
  vm.runInNewContext(`${declaration};result=[
    controlledCarryGoalTeam({team:'you',isGK:false,sentOff:false},3401,1150),
    controlledCarryGoalTeam({team:'opp',isGK:false,sentOff:false},99,1150),
    controlledCarryGoalTeam({team:'you',isGK:false,sentOff:false},3401,800),
    controlledCarryGoalTeam({team:'you',isGK:true,sentOff:false},3401,1150)
  ]`, context);
  assert.deepEqual(Array.from(context.result), ['you', 'opp', null, null]);
  assert.match(matchSource, /logEvent\('dribble-goal-entry'[\s\S]*score\(carriedGoalTeam\)/);
});
test('ultimate CPU tuning changes decisions only and preserves the shared physical model', () => {
  const professional = Adapter.cpuDifficultyConfig('professional');
  const ultimate = Adapter.cpuDifficultyConfig('ultimate');
  assert.equal(professional.decisionOnly, true);
  assert.equal(ultimate.decisionOnly, true);
  assert.ok(ultimate.overrides.maximumReactionTicks < professional.overrides.maximumReactionTicks);
  assert.ok(ultimate.overrides.minimumBidScore < professional.overrides.minimumBidScore);
  assert.ok(ultimate.overrides.maximumCommittedRuns > professional.overrides.maximumCommittedRuns);
  for (const forbidden of ['pace', 'acceleration', 'tackleReach', 'slideReach', 'passError', 'shotError']) {
    assert.equal(Object.hasOwn(ultimate.overrides, forbidden), false);
  }
  assert.deepEqual(Adapter.LIVE_MOVEMENT_CONTACT_CONFIG, {
    fixedTickSeconds: 1 / 60,
    tackleContactTicks: 8,
    tackleReach: 0.60,
    slideContactTicks: 12,
    slideReach: 0.90
  });
});

test('a human challenge targets the nearby ball carrier, not a closer off-ball opponent', () => {
  const { snapshot, challenger, carrier } = liveSnapshot();
  const live = Adapter.createAttachment({
    enabled: true,
    capability: Adapter.createCapability({ acknowledgement: Adapter.ACKNOWLEDGEMENT,
      workflow: 'single-player', online: false, onlineMarkers: {} }),
    seed: 17320261026,
    dependencies: { ball: Ball, movement: Movement, cpu: CPU, formation: Formation, contact: Contact, dribbling: Dribbling },
    host: { prepareTick() { return { commit() {}, rollback() {} }; } }
  });
  const frame = live.planTick(snapshot);
  assert.ok(frame, JSON.stringify(live.status()));
  const challengerProjection = frame.hostProjection.movement.find(player => player.id === challenger.id);
  assert.equal(challengerProjection.action.type, 'stand-tackle');
  assert.equal(challengerProjection.action.targetId, carrier.id);
  assert.equal(frame.cpu.opp.telemetry.liveDifficulty.level, 'ultimate');
  assert.equal(frame.cpu.opp.telemetry.liveDifficulty.decisionOnly, true);
});
