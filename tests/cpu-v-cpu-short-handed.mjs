import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Adapter = require('../match-engine/live-v2-authority-adapter.js');
const dependencies = Object.fromEntries([
  ['ball', 'ball-engine-v2'], ['movement', 'movement-engine-v2'],
  ['cpu', 'cpu-intelligence-v2'], ['formation', 'formation-behaviour-v2'],
  ['contact', 'live-v2-contact-authority-composer'], ['dribbling', 'dribbling-state-v2']
].map(([key, file]) => [key, require(`../match-engine/${file}.js`)]));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/corner-loose-ball-seed-2415640915.json', import.meta.url)));
const source = readFileSync(new URL('../match-engine/match.html', import.meta.url), 'utf8');

test('an outfield dismissal leaves live CPU gameplay eligible without clearing the card', () => {
  const start = source.indexOf('function liveV2CanAdvance()');
  const end = source.indexOf('\n  // D3:', start);
  const run = new Function(`
    const you=[{sentOff:true}],opp=[],ball={owner:null};
    const LAB_HOST_AUTHORITY=false,LIVE_V2_PREFLIGHT={workflow:'cpu-v-cpu',eligible:true};
    const liveV2Authority={},started=true,matchPhase='play',AUTO=true,clockRunning=true;
    const liveV2StrictStopped=false,paused=false,matchOver=false,twoPlayerEnabled=false,FREE_KICK_PRACTICE=false,
      ONLINE_HOST=false,externalSetPieceActive=false,kickoffHeld=false,celebrate=0,offsidePresentation=null,
      foulSequence=null,pendingDiveDecision=null,confrontationSequence=null,instantGoalShot=null;
    const goalReplay={active:false},disciplineReplay={active:false},diveReplay={active:false},specialPSequence={active:false};
    const inReset=()=>false;
    ${source.slice(start, end)}
    return ()=>({eligible:liveV2CanAdvance(),sentOff:you[0].sentOff});
  `)();
  assert.deepEqual(run(), { eligible: true, sentOff: true });
});

function createRun(snapshot) {
  return Adapter.createAttachment({
    enabled: true, seed: fixture.seed, dependencies,
    capability: Adapter.createCapability({
      acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow: 'cpu-v-cpu', online: false,
      onlineMarkers: {}, controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] }
    }),
    host: { prepareTick(projection) { return {
      commit() {
        for (const row of projection.movement) Object.assign(snapshot.players.find(p => p.id === row.id), row);
        if (projection.ball) Object.assign(snapshot.ball, projection.ball);
        snapshot.ball.ownerId = projection.physicalBallSeparated ? null : projection.logicalBallOwnerId;
      }, rollback() {}
    }; } }
  });
}

test('the live adapter removes the actual dismissed slots from the existing reduced formation', () => {
  const snapshot = structuredClone(fixture.snapshot);
  const dismissed = snapshot.players.find(p => p.teamId === 'you' && !p.isGK);
  dismissed.sentOff = true;
  const run = createRun(snapshot), frame = run.planTick(snapshot);
  assert.ok(frame, JSON.stringify(run.status()));
  assert.equal(frame.formation.you.targets.length, 10);
  assert.equal(frame.formation.opp.targets.length, 11);
  assert.equal(frame.formation.you.targets.some(row => row.playerId === dismissed.id), false);
  assert.deepEqual(frame.formation.you.telemetry.adaptation.removedSlotIds, [dismissed.slotId]);
  assert.equal(frame.hostProjection.movement.length, 19);
  assert.equal(run.commitTick(frame), true);
  assert.equal(dismissed.sentOff, true);
});

test('mid-match dismissals resync movement and keep both reduced teams committing sequentially', () => {
  const snapshot = structuredClone(fixture.snapshot), run = createRun(snapshot);
  const dismissed = [];
  for (let tick = 1; tick <= 180; tick++) {
    if (tick === 2) {
      dismissed.push(...snapshot.players.filter(p => p.teamId === 'you' && !p.isGK).slice(0, 2),
        snapshot.players.find(p => p.teamId === 'opp' && !p.isGK));
      for (const player of dismissed) player.sentOff = true;
    }
    snapshot.tick = tick;
    const frame = run.planTick(snapshot);
    assert.ok(frame, JSON.stringify(run.status()));
    assert.equal(run.commitTick(frame), true);
    assert.equal(run.status().committedTicks, tick);
    if (tick === 1) continue;
    assert.equal(frame.formation.you.targets.length, 9);
    assert.equal(frame.formation.opp.targets.length, 10);
    assert.equal(frame.hostProjection.movement.length, 17);
    for (const player of dismissed) {
      assert.equal(player.sentOff, true);
      assert.equal(frame.hostProjection.movement.some(row => row.id === player.id), false);
      assert.equal(frame.formation[player.teamId].targets.some(row => row.playerId === player.id), false);
      assert.equal(frame.hostProjection.intelligence.some(row => row.playerId === player.id || row.targetPlayerId === player.id), false);
    }
  }
});
