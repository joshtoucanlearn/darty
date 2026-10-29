// Serial, render-free keeper timing evidence from the production match host.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { keeperShotRows, keeperTimingSummary } from './keeper-timing-evidence.mjs';
import { createHeadlessMatch, countsAsFullTime } from './headless-cpu-match.mjs';

const option=(name,fallback)=>{const at=process.argv.indexOf('--'+name);return at<0?fallback:process.argv[at+1];};
const out=option('out');
if(!out)throw new Error('--out is required');
fs.mkdirSync(out,{recursive:true});
if(process.argv.includes('--reanalyze')){
  const matches=fs.readdirSync(out).filter(name=>/^seed-\d+\.json$/.test(name)).map(name=>{
    const filename=path.join(out,name),result=JSON.parse(fs.readFileSync(filename,'utf8'));
    result.shots=keeperShotRows(JSON.parse(fs.readFileSync(filename.replace('.json','-events.json'),'utf8')));
    fs.writeFileSync(filename,JSON.stringify(result,null,2));return result;
  }).sort((a,b)=>a.seed-b.seed);
  const summary=keeperTimingSummary(matches);
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify(summary));process.exit(0);
}
const seeds=option('seeds','1,2,3,4,5,6,7,8,2415640915,1713525629').split(',').map(Number);
const minutes=Number(option('minutes','2'));
const payload={mode:'quickPlay',matchType:'spectator',practiceMode:null,online:null,
  engine:{requested:'fl-v2',effective:'fl-v2',version:'1.0.0-offline-live-authority-playtest',fallbackReason:null},
  homeTeam:{id:'timing-home',name:'Home'},awayTeam:{id:'timing-away',name:'Away'},
  controllers:{player1Team:null,player2Team:null,aiTeam:'both'}};
const url='http://darty.local/match-engine/match.html?quickPlay=1&engine=fl-v2&candidate=5&autoplay=1#flMatch='+Buffer.from(JSON.stringify(payload)).toString('base64url');
const sourceHashes=Object.fromEntries(['match-engine/match.html','tools/headless-cpu-match.mjs','tools/keeper-timing-audit.mjs'].map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const matches=[];
for(const seed of seeds){
  global.gc?.();
  const started=Date.now(),match=createHeadlessMatch(url,{seed,minutes,keeperTrace:true});
  const maxTicks=(minutes*60+900)*60;
  let state,tick=0,stationary=0,stalled=false;
  for(;tick<maxTicks;tick++){
    if(tick%600===0){const disk=fs.statfsSync(out);if(disk.bavail*disk.bsize<6*1024**3)throw new Error('free disk below 6 GiB');}
    match.step();
    if(tick>0&&tick%6000===0)console.log(JSON.stringify({seed,hostTick:tick,minute:match.state().minute}));
    if(tick%120===0){
      state=match.state();
      stationary=state.hostPhase==='live'&&!state.ball.logicalOwned&&state.ball.speed===0?stationary+120:0;
      stalled=stationary>=1800||state.progress.stallWindows.length>0;
      if(state.phase==='ended'||state.authority.failureCode||stalled)break;
    }
  }
  state=match.state();
  const trace=match.keeperTrace();
  const shots=keeperShotRows(trace.events);
  const result={seed,minutes,sourceHashes,ticks:tick+1,wallSeconds:(Date.now()-started)/1000,
    fullTimeReached:countsAsFullTime(state,{stalled,capped:tick>=maxTicks}),stalled,capped:tick>=maxTicks,...state,
    totals:{shots:shots.length,saves:trace.teams.you.saves+trace.teams.opp.saves,goals:state.score.reduce((a,b)=>a+b,0)},shots};
  fs.writeFileSync(path.join(out,`seed-${seed}.json`),JSON.stringify(result,null,2));
  fs.writeFileSync(path.join(out,`seed-${seed}-events.json`),JSON.stringify(trace.events,null,2));
  matches.push(result);
  console.log(JSON.stringify({seed,fullTimeReached:result.fullTimeReached,wallSeconds:result.wallSeconds,...result.totals}));
}
const summary=keeperTimingSummary(matches);
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
