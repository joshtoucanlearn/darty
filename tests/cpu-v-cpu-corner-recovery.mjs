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
function hostFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing host helper ${name}`);
  return source.slice(start, source.indexOf('\n  function ', start + 10));
}
function attachment(host = { prepareTick: () => ({ commit() {}, rollback() {} }) }) {
  return Adapter.createAttachment({
    enabled: true, seed: fixture.seed, dependencies,
    capability: Adapter.createCapability({
      acknowledgement: Adapter.ACKNOWLEDGEMENT, workflow: 'cpu-v-cpu', online: false,
      onlineMarkers: {}, controlOwnership: { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] }
    }), host
  });
}

test('seed 2415640915 replay shot settles and is physically recovered near the corner', () => {
  const snapshot = structuredClone(fixture.snapshot);
  let recovered = false, recoveryTicks = 0;
  const run = attachment({ prepareTick(projection) {
    return { commit() {
      for (const row of projection.movement) Object.assign(snapshot.players.find(p => p.id === row.id), row);
      if (projection.ball) Object.assign(snapshot.ball, projection.ball);
      snapshot.ball.ownerId = projection.physicalBallSeparated ? null : projection.logicalBallOwnerId;
      snapshot.ball.targetId = null;
      if (projection.recoveryAssignments.some(row => row.authority === 'v2-loose-ball-recovery')) recoveryTicks++;
      if (projection.logicalBallOwnerId || projection.contact?.result?.ownerCandidateId) recovered = true;
    }, rollback() {} };
  } });
  for (let tick = 1; tick <= 1200 && !recovered; tick++) {
    snapshot.tick = tick;
    const frame = run.planTick(snapshot);
    assert.ok(frame, JSON.stringify(run.status()));
    assert.equal(run.commitTick(frame), true);
  }
  assert.ok(recoveryTicks > 0, 'the settled shot must acquire a recovery runner');
  assert.ok(recovered, 'recovery must reach physical contact, without a restart or possession grant');
});

test('a stopped shot gets a collector even when every outfielder is beyond the short intercept horizon', () => {
  const snapshot = structuredClone(fixture.snapshot);
  Object.assign(snapshot.ball, { z: 0, vx: 0, vy: 0, zv: 0 });
  for (const player of snapshot.players) if (!player.isGK) player.x = Math.max(player.x, 1500);
  const run = attachment();
  const frame = run.planTick(snapshot);
  assert.ok(frame, JSON.stringify(run.status()));
  const rows = frame.hostProjection.recoveryAssignments.filter(row => row.authority === 'v2-loose-ball-recovery');
  assert.deepEqual(rows.map(row => row.teamId).sort(), ['opp', 'you']);
  assert.ok(rows.every(row => row.etaSeconds > 3.2));
});

test('moving and airborne shots retain their existing protected flight authority', () => {
  for (const change of [{ vx: 2 }, { z: 20, zv: -1 }]) {
    const snapshot = structuredClone(fixture.snapshot);
    Object.assign(snapshot.ball, { vx: 0, vy: 0, zv: 0, z: 0 }, change);
    const frame = attachment().planTick(snapshot);
    assert.ok(frame);
    assert.equal(frame.hostProjection.recoveryAssignments.length, 0);
  }
});

test('live control ticks without gameplay commits reach the existing fault path in bounded time', () => {
  const run = new Function(`
    let liveV2ProgressTick=0,liveV2ProgressWait=0;
    let liveV2AuthorityTotals={lastCommittedTick:0};
    let matchPhase='play',phase='live',fault=null,liveV2Authority={},liveV2StrictStopped=false;
    const liveV2ControlPhase=()=>phase,inReset=()=>false;
    const liveV2Stop=reason=>{fault=reason;liveV2StrictStopped=true;return false;};
    ${hostFunction('liveV2GuardProgress')}
    return {step:liveV2GuardProgress,state:()=>({fault,wait:liveV2ProgressWait}),
      commit(){liveV2AuthorityTotals.lastCommittedTick++;},phase(value){phase=value;}};
  `)();
  for (let tick = 0; tick < 1200; tick++) { run.commit(); run.step(); }
  assert.equal(run.state().fault, null);
  run.phase('paused');
  for (let tick = 0; tick < 1200; tick++) run.step();
  assert.equal(run.state().fault, null);
  run.phase('live');
  for (let tick = 0; tick < 300; tick++) run.step();
  assert.equal(run.state().fault, null, 'the existing keeper release window remains available');
  run.commit(); run.step();
  for (let tick = 0; tick < 600; tick++) run.step();
  assert.match(run.state().fault, /gameplay.*commit/i);
});

test('a missing candidate frame faults even if the adapter still reports enabled', () => {
  const run = new Function(`
    let liveV2TickApplied,liveV2TickBallApplied,liveV2PendingFoul,liveV2TickCarrier,liveV2AuthorityCounters;
    let liveV2Tick=0,liveV2PendingLaunch=null,fault=null;
    const liveV2Authority={planTick:()=>null,status:()=>({enabled:true,failure:null})};
    const liveV2Carrier=()=>null,liveV2CanAdvance=()=>true,liveV2CaptureTransactionState=()=>({}),liveV2Snapshot=()=>({});
    const liveV2Stop=reason=>{fault=reason;return false;};
    ${hostFunction('liveV2RunTick')}
    return ()=>{liveV2RunTick();return fault;};
  `)();
  assert.match(run(), /candidate planning fault/);
});

test('an exception outside the adapter records an authority fault before the render loop exits', () => {
  const start = source.indexOf('function loop(now){');
  const loop = source.slice(start, source.indexOf('\n  if(video&&video.capture)', start));
  const run = new Function(`
    let _lastT=1,_acc=20,build173ShadowSimulationStepIndex=0,build173ShadowRenderFrameSequence=0;
    const STEP=1000/60,SIM_STEPS=1,pollGamepad=()=>{},window={DartyStartup:{fail(){}}},console={error(){}},errorBox={style:{}};
    let DT,fault=null;
    const build173SimulationTick=()=>{throw new Error('injected host exception');};
    const liveV2Stop=error=>{fault=error.message;};
    ${loop}
    return ()=>{loop(17);return fault;};
  `)();
  assert.equal(run(), 'injected host exception');
});
