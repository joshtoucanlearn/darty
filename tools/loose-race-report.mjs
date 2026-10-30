import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function summarizeRaces(rows) {
 let observedFasterWins=0,observedUpsets=0,eligibleWinners=0;
 const counts={},episodes=rows.flatMap(r=>r.races.episodes),side={you:{samples:0,speed:0,peaks:[]},opp:{samples:0,speed:0,peaks:[]}};
 for(const r of rows)for(const[k,v]of Object.entries(r.races.counts))counts[k]=(counts[k]||0)+v;
 for(const e of episodes){
  if(e.winnerId&&e.ids.includes(e.winnerId)&&e.samples.length){
   eligibleWinners++;const initial=e.samples[0].racers,fastest=initial[0].speed>=initial[1].speed?initial[0]:initial[1];
   const faster=fastest.id===e.winnerId&&Math.abs(initial[0].speed-initial[1].speed)>.05;
   if(faster)observedFasterWins++;if(e.nearerId!==e.winnerId&&!faster)observedUpsets++;
  }
  for(const[id,peak]of Object.entries(e.peaks)){const team=id.startsWith('you-')?'you':id.startsWith('opp-')?'opp':null;if(team)side[team].peaks.push(peak);}
  for(const sample of e.samples)for(const [index,p]of sample.racers.entries()){const team=index===0?'you':'opp';side[team].samples++;side[team].speed+=p.speed;}
 }
 const resolution=episodes.filter(e=>e.winnerId).map(e=>e.durationSeconds).sort((a,b)=>a-b),ratio=(a,b)=>b?a/b:null;
 const pct=(a,b)=>ratio(a*100,b),q=f=>resolution.length?resolution[Math.floor((resolution.length-1)*f)]:null;
 return {matches:rows.length,racesPerMatch:counts.races/rows.length,counts,
  meanSpeedMps:ratio(counts.speedSum,counts.playerFrames),meanResolutionSeconds:ratio(counts.secondsToResolution,counts.resolved),
  medianResolutionSeconds:q(.5),p95ResolutionSeconds:q(.95),withinOnePointFiveSecondsPct:pct(counts.withinOnePointFiveSeconds,counts.resolved),
  allRacesResolvedWithinOnePointFiveSecondsPct:pct(counts.withinOnePointFiveSeconds,counts.races),
  fullSprintCommandPct:pct(counts.fullSprintCommandFrames,counts.playerFrames),sprintGaitPct:pct(counts.sprintGaitFrames,counts.playerFrames),
  racersReachingSixMpsPct:pct(counts.racersReachingSixMps,counts.racers),slowSideBySideSecondsPerMatch:counts.slowSideBySideSeconds/rows.length,
  shoulderContestsPerMatch:counts.shoulderContests/rows.length,nearerWinsPct:pct(counts.nearerWins,counts.resolved-counts.thirdPlayerWins),
  fasterWinsPct:pct(observedFasterWins,eligibleWinners),upsetsPct:pct(observedUpsets,eligibleWinners),
  higherPaceRatingWinsPct:pct(counts.fasterWins,counts.resolved-counts.thirdPlayerWins),observedFasterWins,observedUpsets,eligibleWinners,
  sides:Object.fromEntries(Object.entries(side).map(([k,v])=>[k,{meanSampledSpeedMps:ratio(v.speed,v.samples),meanPeakSpeedMps:ratio(v.peaks.reduce((a,b)=>a+b,0),v.peaks.length),peakSpeedMps:v.peaks.length?Math.max(...v.peaks):null}])),
  unresolvedReasons:Object.fromEntries([...new Set(episodes.filter(e=>!e.winnerId).map(e=>e.reason))].map(k=>[k,episodes.filter(e=>!e.winnerId&&e.reason===k).length]))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [out,...files]=process.argv.slice(2),reports=files.map(file=>({file,...summarizeRaces(fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))}));
 fs.writeFileSync(out,JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports,null,2));
}
