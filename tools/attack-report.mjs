import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function summarizeAttack(rows) {
 if(!rows.length)throw new Error('no match rows');
 if(new Set(rows.map(r=>r.seed)).size!==rows.length)throw new Error('duplicate seeds');
 const sums={},actions={};let passes=0,completed=0,shots=0,onTarget=0,goals=0,fouls=0;
 for(const r of rows){
  if(r.minutes!==6||!r.attack)throw new Error('six minutes and complete attacking counters required');
  for(const [k,v]of Object.entries(r.attack.counts))sums[k]=(sums[k]||0)+v;
  for(const [k,v]of Object.entries(r.actions.counts))actions[k]=(actions[k]||0)+v;
  passes+=r.matchStats.reduce((s,t)=>s+t.passes,0);completed+=r.matchStats.reduce((s,t)=>s+t.completed,0);
  shots+=r.matchStats.reduce((s,t)=>s+t.shots,0);onTarget+=r.matchStats.reduce((s,t)=>s+t.onTarget,0);
  fouls+=r.matchStats.reduce((s,t)=>s+t.fouls,0);goals+=r.score.reduce((s,n)=>s+n,0);
 }
 const n=rows.length,divide=(a,b)=>b?a/b:null;
 return {matches:n,seeds:rows.map(r=>r.seed),fullTime:rows.filter(r=>r.fullTimeReached).length,
  failedSeeds:rows.filter(r=>!r.fullTimeReached||r.stalled||r.authority.failureCode).map(r=>r.seed),stalls:rows.filter(r=>r.stalled).length,
  frozenSource:new Set(rows.map(r=>JSON.stringify(r.sourceHashes))).size===1,sourceHashes:rows[0].sourceHashes,
  maximumLiveCommitGap:Math.max(...rows.map(r=>r.progress.maximumLiveTicksWithoutCommit)),
  totals:sums,actionsTotals:actions,perMatch:Object.fromEntries(Object.entries(sums).map(([k,v])=>[k,v/n])),
  actionsPerMatch:Object.fromEntries(Object.entries(actions).map(([k,v])=>[k,v/n])),
  standard:{passes:passes/n,completed:completed/n,passCompletionPct:divide(completed*100,passes),shots:shots/n,onTarget:onTarget/n,goals:goals/n,fouls:fouls/n},
  ratios:{backwardSharePct:divide(sums.backwardPasses*100,sums.passes),loftedSharePct:divide(sums.loftedPasses*100,sums.passes),
    backwardCompletionPct:divide(sums.backwardCompleted*100,sums.backwardPasses),
    defensiveThirdCompletionPct:divide(sums.defensiveThirdCompleted*100,sums.defensiveThirdPasses),
    loftedCompletionPct:divide(sums.loftedCompleted*100,sums.loftedPasses),inBehindCompletionPct:divide(sums.inBehindCompleted*100,sums.inBehindAttempted),
    averageTouchesBeforePass:divide(sums.passTouches,sums.passPossessionsMeasured),averageSecondsBeforePass:divide(sums.passTimeMs,sums.passPossessionsMeasured*1000),
    averageReceiverMovementM:divide(sums.receiverMovementM,sums.receiptsMeasured),movingReceiptSharePct:divide(sums.receiverMovingReceipts*100,sums.receiptsMeasured)}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [out,...inputs]=process.argv.slice(2),reports=inputs.map(file=>({file,...summarizeAttack(fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse))}));
 fs.writeFileSync(out,JSON.stringify(reports,null,2)+'\n');console.log(JSON.stringify(reports.map(({file,matches,fullTime,stalls,standard,ratios,perMatch,actionsPerMatch})=>({file,matches,fullTime,stalls,standard,ratios,perMatch,actionsPerMatch})),null,2));
}
