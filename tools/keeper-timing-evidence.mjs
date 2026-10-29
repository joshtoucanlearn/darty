// Shared analysis for original and updated host traces. Times use live 60 Hz frames.
export function keeperShotRows(trace){
  return trace.filter(event=>event.type==='shot').map(shot=>{
    const events=trace.filter(event=>event.shotId===shot.shotId);
    const reads=events.filter(event=>event.type==='keeper-read');
    const starts=events.filter(event=>event.type==='keeper-dive-start');
    const contact=events.find(event=>['keeper-save','keeper-beaten','goal','shot-off-target'].includes(event.type));
    const first=starts[0]||reads.find(event=>!['idle','keeperSet'].includes(event.action))||
      events.find(event=>event.type==='keeper-save');
    const keeperId=first?.playerId??reads[0]?.playerId;
    const transitions=events.filter(event=>event.type==='animation-transition'&&event.playerId===keeperId);
    // Original contacts reset the whole clip to progress zero even after the
    // read already launched it. Count those as well as duplicate read/launches.
    const contactRestarts=events.filter(event=>event.type==='keeper-save'&&first&&event.frame>first.frame&&
      event.duration>0&&event.actionT/event.duration>.95).length;
    const startCount=starts.length||reads.length||(first?1:0);
    const outcome=events.some(event=>event.type==='keeper-save')?'saved':events.some(event=>event.type==='goal')?'goal':
      events.some(event=>event.type==='shot-off-target')?'off-target':'unresolved-or-blocked';
    return{shotId:shot.shotId,shotType:shot.shotType||null,readFrame:reads[0]?.frame??null,
      diveStartFrame:first?.frame??null,diveStarts:(starts.length?starts:reads).map(event=>event.frame),
      arrivalFrame:contact?.frame??null,arrivalKind:contact?.type??null,
      leadSeconds:first&&contact?(contact.frame-first.frame)/60:null,
      predictedLeadSeconds:starts[0]?.timeToArrival!=null?starts[0].timeToArrival/60:first?.type==='keeper-read'?first.timeToGoal/60:null,
      animation:first?.animation??null,outcome,reads:reads.length,starts:startCount,
      repeats:Math.max(0,startCount-1)+contactRestarts,contactRestarts,
      transitions:transitions.map(({frame,action,actionT,duration})=>({frame,action,actionT,duration})),
      arrivalAction:contact?.type?.startsWith('keeper-')?contact.action:null,
      arrivalActionT:contact?.type?.startsWith('keeper-')?contact.actionT:null,
      arrivalDuration:contact?.type?.startsWith('keeper-')?contact.duration:null};
  });
}
export function keeperTimingSummary(matches){
  const faced=matches.flatMap(match=>match.shots).filter(shot=>shot.readFrame!=null||shot.diveStartFrame!=null);
  const distribution=values=>{values=values.filter(Number.isFinite).sort((a,b)=>a-b);return{n:values.length,min:values[0]??null,p50:values[Math.floor(values.length*.5)]??null,p90:values[Math.floor(values.length*.9)]??null,max:values.at(-1)??null};};
  const totals=matches.reduce((out,match)=>{for(const key of ['shots','saves','goals'])out[key]+=match.totals[key];return out;},{shots:0,saves:0,goals:0});
  return{seeds:matches.map(match=>match.seed),minutes:matches[0]?.minutes,sourceHashes:matches[0]?.sourceHashes,
    fullTime:matches.filter(match=>match.fullTimeReached).length,matches:matches.length,totals,
    perMatch:{saves:totals.saves/matches.length,goals:totals.goals/matches.length},conversion:totals.goals/Math.max(1,totals.shots),
    leadSeconds:distribution(faced.map(shot=>shot.leadSeconds)),predictedLeadSeconds:distribution(faced.map(shot=>shot.predictedLeadSeconds)),
    leadByArrivalKind:Object.fromEntries(['keeper-save','keeper-beaten','goal','shot-off-target'].map(kind=>
      [kind,distribution(faced.filter(shot=>shot.arrivalKind===kind).map(shot=>shot.leadSeconds))])),
    repeats:faced.reduce((sum,shot)=>sum+shot.repeats,0),contactRestarts:faced.reduce((sum,shot)=>sum+shot.contactRestarts,0),
    animationTransitions:faced.reduce((sum,shot)=>sum+shot.transitions.length,0)};
}
