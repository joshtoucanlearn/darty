// Observer only. Accepted Movement windows are attempts; commands rejected as
// busy never enter this ledger. Foul/card results are linked to a real action.
export function createChallengeMetrics(){
 const episodes=[],byCommand=new Map(),latestByActor=new Map();
 const kind=a=>a==='slide-tackle'?'slide':a==='stand-tackle'?'standing':a==='shoulder-challenge'?'shoulder':null;
 function projection(p,time,cpu={}){
  const telemetry=p?.movementTelemetry;if(!telemetry)return;
  const epoch=p.dribbling?.serializedState?.state?.epoch??p.dribbling?.telemetry?.epoch??0,key=id=>epoch+':'+id;
  for(const a of telemetry.actions||[]){
   const k=a.type==='action-window-entered'&&kind(a.action);
   if(k&&!byCommand.has(key(a.commandId))){
    let read=null;
    for(const decision of Object.values(cpu)){
      const intent=decision?.defensiveIntents?.find(i=>i.playerId===a.playerId&&i.physicalAction?.issuedTick===p.snapshotTick);
      if(intent){read=intent.physicalAction;break;}
    }
    const selection=read?{purpose:read.purpose,risk:read.risk,carrierBallGapMetres:read.carrierBallGapMetres,
      ballDistanceMetres:read.ballDistanceMetres,distanceMetres:read.distance/30.25,closingSpeedMps:read.relativeClosingSpeed/30.25,bootForecast:read.bootForecast,carrierTouchAgeTicks:read.carrierTouchAgeTicks,nextCarrierTouchTicks:read.nextCarrierTouchTicks,defenderSpeedMps:read.defenderSpeedMps,defenderHeading:read.defenderHeading,reactionDelayTicks:read.reactionDelayTicks,carrierTouchPhase:read.carrierTouchPhase}:null;
    const e={id:key(a.commandId),epoch,tick:a.tick,commandId:a.commandId,actorId:a.playerId,kind:k,time,selection,contact:false,ballFirst:null,won:false,foul:false,card:null,outcome:'pending'};
    episodes.push(e);byCommand.set(key(a.commandId),e);latestByActor.set(a.playerId,e);
   }
   const e=byCommand.get(key(a.commandId));if(!e)continue;
   if(a.type==='challenge-closest-approach')e.closestBall=a.closestBall;
   if(/-(win|contact-lost|miss)$/.test(a.type)){e.won=/-win$/.test(a.type);e.outcome=e.won?'won':/-miss$/.test(a.type)?'missed':'beaten';}
  }
  for(const c of telemetry.contacts||[]){
   if(c.type==='body-contact'&&!byCommand.has(key(c.commandId))){
    const e={id:key(c.commandId),epoch,tick:c.tick,commandId:c.commandId,actorId:c.actorId,kind:'body',time,
      contact:false,ballFirst:false,won:false,foul:false,card:null,outcome:'body-contact'};
    episodes.push(e);byCommand.set(key(c.commandId),e);latestByActor.set(c.actorId,e);
   }
   const e=byCommand.get(key(c.commandId));if(!e)continue;
   if(c.closestBall)e.closestBall=c.closestBall;
   e.actorScore=c.actorScore;e.targetScore=c.targetScore;e.skillTackleMultiplier=c.skillTackleMultiplier;
   e.contact=true;e.targetId=c.targetId;e.ballFirst=typeof c.ballFirst==='boolean'?c.ballFirst:null;
   e.incidental=e.incidental||c.incidental===true;
   e.bodyContact=typeof c.bodyContact==='boolean'?c.bodyContact:null;e.contactTime=time;
   if(c.point)e.point={...c.point};
   const geometric=c.point&&c.normal&&Number.isFinite(c.visibleGapMetres);
   if(geometric){e.geometryMeasured=true;e.bodyGeometryConfirmed=e.bodyGeometryConfirmed||c.bodyContact===true;
    if(c.contactPart==='boot-to-ball'&&c.ballContact){e.bootBallConfirmed=true;e.bootBallGapMetres=Math.max(e.bootBallGapMetres||0,c.visibleGapMetres);}
    if(/(boot|shin)-to-leg/.test(c.contactPart))e.bootLegGapMetres=Math.max(e.bootLegGapMetres||0,c.visibleGapMetres);
   }
  }
 }
 function event(e){
  if(['restart','half-time','full-time','match-abandoned'].includes(e.type))for(const a of episodes)if(a.outcome==='pending')a.outcome='stopped';
  if(e.type==='foul'&&e.authority==='movement-v2'){
   const a=latestByActor.get(e.actorId);
   if(a&&a.contact&&(!e.commandId||a.commandId===e.commandId)&&e.time-a.time<5000){a.foul=true;a.foulTime=e.time;a.outcome='foul';a.foulBodyConfirmed=!!(a.bodyGeometryConfirmed&&e.contactProof?.bodyContact);}
  }
  if(['yellow','red','second-yellow','card','yellow-card','red-card'].includes(e.type)){
   const a=latestByActor.get(e.actorId);if(a&&a.foul&&e.time-a.foulTime<18000&&!/simulation/.test(e.reason||''))a.card=/red|second-yellow/.test(e.type)||e.card==='red'?'red':'yellow';
  }
 }
 function snapshot(){
  const counts={};for(const k of['standing','slide','shoulder','body']){
   const rows=episodes.filter(e=>e.kind===k);
   counts[k]={attempts:rows.length,wonClean:rows.some(e=>e.won&&!e.foul&&!e.geometryMeasured)?null:rows.filter(e=>e.won&&!e.foul&&e.ballFirst===true&&e.bootBallConfirmed).length,
    wins:rows.filter(e=>e.won).length,legalBodyWins:rows.filter(e=>e.won&&!e.foul&&e.bodyGeometryConfirmed&&!e.bootBallConfirmed).length,
    fouls:rows.filter(e=>e.foul).length,cards:rows.filter(e=>e.card).length,redCards:rows.filter(e=>e.card==='red').length,
    missedOrBeaten:rows.filter(e=>!e.foul&&!e.won&&!['pending','stopped'].includes(e.outcome)).length,pending:rows.filter(e=>e.outcome==='pending').length,stopped:rows.filter(e=>e.outcome==='stopped').length,
    physicalContacts:rows.filter(e=>e.contact).length,
    bootConfirmedWins:rows.some(e=>e.won&&!e.geometryMeasured)?null:rows.filter(e=>e.won&&e.bootBallConfirmed).length,
    geometryConfirmedFouls:rows.some(e=>e.foul&&!e.geometryMeasured)?null:rows.filter(e=>e.foul&&e.foulBodyConfirmed).length,
    geometryConfirmedCards:rows.some(e=>e.card&&!e.geometryMeasured)?null:rows.filter(e=>e.card&&e.foulBodyConfirmed).length};
  }
  const total=counts.slide.attempts+counts.standing.attempts+counts.shoulder.attempts;
  const aliases=new Map(),alias=id=>id==null?id:aliases.get(id)||((aliases.set(id,'player-'+(aliases.size+1))),aliases.get(id));
  const redacted=episodes.map((e,i)=>({...e,id:'challenge-'+(i+1),commandId:'action-'+(i+1),actorId:alias(e.actorId),targetId:alias(e.targetId)}));
  const fouls=episodes.filter(e=>e.foul),cards=episodes.filter(e=>e.card),slideWins=episodes.filter(e=>e.kind==='slide'&&e.won),
    pct=(rows,predicate)=>rows.length&&rows.every(e=>e.geometryMeasured)?rows.filter(predicate).length/rows.length*100:null,
    gap=key=>{const values=episodes.map(e=>e[key]).filter(Number.isFinite);return values.length?Math.max(...values):null;};
  const follow=episodes.filter(e=>e.won&&e.ballFirst===true&&e.bodyGeometryConfirmed),
    foulTypes={manFirstSlide:fouls.filter(e=>e.kind==='slide'&&e.ballFirst===false).length,
      manFirstStanding:fouls.filter(e=>e.kind==='standing'&&e.ballFirst===false).length,
      charge:fouls.filter(e=>e.kind==='shoulder'&&!e.incidental).length,incidental:fouls.filter(e=>e.incidental||e.kind==='body').length};
  return {measurementVersion:3,counts,ballFirstWinsFollowedByBodyContact:follow.length,
    ballFirstFollowThroughFouls:follow.filter(e=>e.foul).length,ballFirstFollowThroughCards:follow.filter(e=>e.card).length,foulsByType:foulTypes,slideSharePct:total?counts.slide.attempts/total*100:null,
    foulBodyContactConfirmedPct:pct(fouls,e=>e.foulBodyConfirmed),cardBodyContactConfirmedPct:pct(cards,e=>e.foulBodyConfirmed),
    slideWinBootContactConfirmedPct:pct(slideWins,e=>e.bootBallConfirmed),
    worstBootBallGapMetres:gap('bootBallGapMetres'),worstBootLegGapMetres:gap('bootLegGapMetres'),episodes:redacted};
 }
 return {projection,event,snapshot};
}
