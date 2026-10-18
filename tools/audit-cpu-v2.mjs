// Read-only U0 instrumentation of the existing adapter characterization fixture.
// This is NOT the complete browser match host: keepers, referee and restarts
// are not modelled here. Never label the resulting samples full matches.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'tests/cpu-v-cpu-v2-tempo-characterization.mjs');
let code = fs.readFileSync(fixture, 'utf8').split("test('eight-seed FL V2")[0];
code = code.replace(/^import .+;\n/gm, '')
  .replace('const require = createRequire(import.meta.url);', '');
const prelude = `const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {performance} = require('node:perf_hooks');\n`;
const instrumentation = `
const seeds = (process.env.DARTY_AUDIT_SEEDS || '173,442,1967').split(',').map(Number);
const ticks = Number(process.env.DARTY_AUDIT_TICKS || 1800);
const rows = [];
for (const seed of seeds) {
  const run = createRun(seed);
  const observed = {you:0, opp:0, loose:0, samples:0, shape:{you:[],opp:[]},
    defendersWithin5m:[], towardBallWithin10m:[], contacts:[],
    interruptions:[],lastTeam:null,lastResets:0};
  const originalApply = run.host.apply.bind(run.host);
  run.host.apply = projection => {
    const transaction = originalApply(projection);
    return {rollback: transaction.rollback, commit: () => {
      transaction.commit();
      const s = run.host.snapshot;
      for (const contact of projection.movementTelemetry?.contacts || []) {
        if (!['tackle-contact','slide-contact','shoulder-contact'].includes(contact.type)) continue;
        observed.contacts.push({tick:s.tick,type:contact.type,outcome:contact.outcome,
          team:run.host.player(contact.actorId)?.teamId || null});
      }
      const ownerId = projection.physicalBallSeparated ? projection.logicalBallOwnerId : s.ball.ownerId;
      const owner = ownerId ? run.host.player(ownerId) : null;
      if ((owner && observed.lastTeam && owner.teamId !== observed.lastTeam) ||
          run.host.metrics.restarts !== observed.lastResets) observed.interruptions.push(s.tick);
      if (owner) observed.lastTeam = owner.teamId;
      observed.lastResets = run.host.metrics.restarts;
      observed[owner?.teamId || 'loose']++;
      if (s.tick % 30) return;
      observed.samples++;
      for (const team of ['you','opp']) {
        const ps=s.players.filter(p=>p.teamId===team&&!p.isGK&&!p.sentOff);
        const xs=ps.map(p=>(p.x-HOST.xMin)/HOST.xPerMetre);
        const ys=ps.map(p=>p.y/HOST.yPerMetre);
        const fromOwnGoal=xs.map(x=>team==='you'?x:105-x).sort((a,b)=>a-b);
        observed.shape[team].push({width:Math.max(...ys)-Math.min(...ys),
          length:Math.max(...xs)-Math.min(...xs),
          backFourMean:fromOwnGoal.slice(0,4).reduce((a,b)=>a+b,0)/4,
          deepest:fromOwnGoal[0]});
      }
      if (owner) {
        const defenders=s.players.filter(p=>p.teamId!==owner.teamId&&!p.isGK&&!p.sentOff);
        observed.defendersWithin5m.push(defenders.filter(p=>Math.hypot(
          (p.x-s.ball.x)/HOST.xPerMetre,(p.y-s.ball.y)/HOST.yPerMetre)<=5).length);
        observed.towardBallWithin10m.push(defenders.filter(p=>{
          const dx=(s.ball.x-p.x)/HOST.xPerMetre,dy=(s.ball.y-p.y)/HOST.yPerMetre;
          const vx=p.vx*60/HOST.xPerMetre,vy=p.vy*60/HOST.yPerMetre;
          const d=Math.hypot(dx,dy),v=Math.hypot(vx,vy);
          return d<=10&&v>1&&(dx*vx+dy*vy)/Math.max(.001,d*v)>.7;
        }).length);
      }
    }};
  };
  const times=[];
  advance(run,ticks,times);
  const summary=run.host.summary();
  const passes=run.host.metrics.passes;
  const arrivals=new Map(run.host.metrics.arrivals.map(a=>[a.launchTick,a]));
  const teams={};
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  for(const team of ['you','opp']) {
    const ps=passes.filter(p=>p.sourceTeam===team);
    const uninterrupted=(a,b)=>!observed.interruptions.some(t=>t>a.tick&&t<=b.tick);
    let returnPairs=0,alternatingTriples=0,eligiblePairs=0,eligibleTriples=0;
    for(let i=1;i<passes.length;i++) {
      const a=passes[i-1],b=passes[i];
      if(b.sourceTeam!==team||a.sourceTeam!==team||arrivals.get(a.tick)?.outcome!=='completed'||a.targetId!==b.sourceId||!uninterrupted(a,b))continue;
      eligiblePairs++;
      if(b.targetId===a.sourceId) returnPairs++;
      const c=passes[i+1];
      if(c&&c.sourceTeam===team&&arrivals.get(b.tick)?.outcome==='completed'&&c.sourceId===b.targetId&&uninterrupted(b,c)){
        eligibleTriples++;
        if(b.targetId===a.sourceId&&c.targetId===b.sourceId)alternatingTriples++;
      }
    }
    const shape=observed.shape[team];
    teams[team]={ownedTicks:observed[team],
      movementContacts:observed.contacts.filter(c=>c.team===team),
      shareOfOwnedTime:observed[team]/Math.max(1,observed.you+observed.opp),
      shareOfAllTime:observed[team]/ticks,
      passes:ps.length,completedToIntended:ps.filter(p=>arrivals.get(p.tick)?.outcome==='completed').length,
      lengths:{under10m:ps.filter(p=>p.distanceMetres<10).length,
        from10to25m:ps.filter(p=>p.distanceMetres>=10&&p.distanceMetres<=25).length,
        over25m:ps.filter(p=>p.distanceMetres>25).length},
      returnPairs,eligiblePairs,alternatingTriples,eligibleTriples,
      shape:{meanWidthM:mean(shape.map(s=>s.width)),meanLengthM:mean(shape.map(s=>s.length)),
        meanBackFourDistanceFromOwnGoalM:mean(shape.map(s=>s.backFourMean)),
        meanDeepestOutfielderDistanceM:mean(shape.map(s=>s.deepest))}};
  }
  const row={seed,ticks,seconds:ticks/60,teams,looseShare:observed.loose/ticks,
    meanDefendersWithin5m:mean(observed.defendersWithin5m),
    maximumDefendersWithin5m:Math.max(0,...observed.defendersWithin5m),
    meanDefendersMovingTowardBallWithin10m:mean(observed.towardBallWithin10m),
    shots:summary.shots,syntheticGoals:summary.goals,syntheticResets:summary.restarts,
    completionRate:summary.completionRate,passMix:summary.passMix,
    strictStops:summary.strictStops,threePassChains:summary.threePassChains,
    p95ProbeTickMs:percentile(times,.95),
    digest:digest({snapshot:run.host.snapshot,teams,observed,summary})};
  rows.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(root,'audit-evidence/cpu-probes.json'),JSON.stringify({
  scope:'adapter probes with simplified host; not full matches',
  fixture:'tests/cpu-v-cpu-v2-tempo-characterization.mjs',
  profile:{trueFeelPhysicalTouchAuthority:TRUE_FEEL_PHYSICAL_TOUCH_AUTHORITY,cpuPassRaceFilter:CPU_PASS_RACE_FILTER},
  rows},null,2)+'\\n');
`;
new Function('require', 'fs', 'path', 'root', prelude + code + instrumentation)(createRequire(fixture), fs, path, root);
