// Event/control observation only. A requested touch never grants possession.
export function createKnockOnMetrics(){
 const episodes=[],aliases=new Map();let active=null,serial=0;
 const alias=(id,team)=>{if(!aliases.has(id))aliases.set(id,team+'-player-'+(aliases.size+1));return aliases.get(id);};
 const tier=name=>({'baseline-free-roll':'jog-free-roll','sprint-forward-light':'light','sprint-forward-strong':'strong','sprint-forward-double':'double'}[name]||name||'unknown');
 const position=e=>({x:Number(e.x)||0,y:Number(e.y)||0});
 function resolve(row,outcome,time,actor=null,reason=null){
  if(!row||row.outcome!=='pending')return;
  row.outcome=outcome;row.resolvedAt=time;row.secondsToOutcome=Math.max(0,time-row.startedAt)/1000;row.reason=reason;
  if(actor){row.winnerId=actor.id;row.winner=alias(actor.id,actor.team);row.controlPoint={x:actor.x,y:actor.y};
   if(outcome==='same-player')row.metresGained=row.direction*(actor.x-row.start.x);}
  row.chainActive=['same-player','teammate'].includes(outcome);
  if(active===row)active=null;
 }
 function control(actor,time,reason){
  if(active)resolve(active,actor.id===active.actorId?'same-player':actor.team===active.team?'teammate':'opponent',time,actor,reason);
  for(const row of episodes)if(row.chainActive&&actor.team!==row.team)row.chainActive=false;
 }
 function follow(row,action,time,actor){
  if(!row.chainActive||actor.team!==row.team||time-row.resolvedAt>5000)return;
  if(!row.nextAction||row.nextAction==='pass'&&action==='cross'&&row.nextActionAt===time){
   row.nextAction=action;row.nextActionAt=time;row.nextActor=alias(actor.id,actor.team);
  }
 }
 function event(e){
  if(e.type==='directional-knock-on'){
   const actor={id:e.actorId,team:e.team,...position(e)};
   // A new strike is a real physical contact with the previous loose ball.
   control(actor,e.time,'next-physical-knock');
   for(const row of episodes)follow(row,'carry',e.time,actor);
   if(!e.cpu)return;
   active={id:++serial,actorId:e.actorId,actor:alias(e.actorId,e.team),team:e.team,tier:tier(e.touchTier),
    situation:'unspecified',startedAt:e.time,start:position(e),direction:e.direction===-1?-1:1,
    outcome:'pending',metresGained:null,secondsToOutcome:null,nextAction:null,nextActionAt:null,shotWithinFiveSeconds:false,chainActive:false};
   episodes.push(active);return;
  }
  if((e.type==='v2-cpu-knock-on'||e.type==='ai-skill-selection'&&e.skill==='knock-on')&&active?.actorId===e.actorId){
   active.situation=e.situation||e.context||active.situation;
  }
  const action=e.type==='shot'?'shot':e.type==='v2-cross'?'cross':['pass','headed-pass'].includes(e.type)?'pass':e.type==='clearance'?'clearance':null;
  if(action){
   const actor={id:e.actorId,team:e.team,...position(e)};
   if(e.actorId)control(actor,e.time,'physical-'+action);
   for(const row of episodes){
    if(e.type==='shot'&&row.chainActive&&e.team===row.team&&e.time-row.startedAt<=5000)row.shotWithinFiveSeconds=true;
    follow(row,action,e.time,actor);
   }
  }
  if(e.type==='restart'){
   const out=['THROW-IN','GOAL KICK','CORNER'].includes(e.kind);
   if(active){active.restartTeam=e.team;active.retainedAtRestart=e.team===active.team;}
   if(active)resolve(active,out?'out-of-play':'stopped',e.time,null,e.kind);
   for(const row of episodes)row.chainActive=false;
  }
  if(['goal','half-time','full-time'].includes(e.type)){
   if(active)resolve(active,'stopped',e.time,null,e.type);
   for(const row of episodes)row.chainActive=false;
  }
 }
 function frame({time,live,ownerId,physicalOwnerId=ownerId,knockOnActive=false,players=[]}){
  const owner=ownerId&&players.find(p=>p.id===ownerId);
  // Do not mistake the old dribble lease on the launch frame for a recontrol.
  if(owner&&(!active||owner.id!==active.actorId||physicalOwnerId||!knockOnActive))control(owner,time,'control');
  if(active&&!live)resolve(active,'stopped',time,null,'non-live');
  if(active&&time-active.startedAt>12000)resolve(active,'unresolved',time,null,'twelve-seconds');
  if(owner)for(const row of episodes){
   if(!row.nextAction&&row.chainActive&&row.winnerId===owner.id&&row.controlPoint&&
       Math.hypot(owner.x-row.controlPoint.x,owner.y-row.controlPoint.y)>=2)follow(row,'carry',time,owner);
  }
 }
 function group(rows){
  const result={attempts:rows.length,outcomes:{},nextActions:{},keptGainingTwoMetres:0,metresGained:0,
   samePlayer:0,opponentSeconds:0,opponentWins:0,shotsWithinFiveSeconds:0};
  for(const row of rows){result.outcomes[row.outcome]=(result.outcomes[row.outcome]||0)+1;
   if(row.outcome==='same-player'){result.samePlayer++;result.metresGained+=row.metresGained;if(row.metresGained>=2)result.keptGainingTwoMetres++;}
   if(row.outcome==='opponent'){result.opponentWins++;result.opponentSeconds+=row.secondsToOutcome;}
   if(['same-player','teammate'].includes(row.outcome)){const action=row.nextAction||'none-observed';result.nextActions[action]=(result.nextActions[action]||0)+1;}
   if(row.shotWithinFiveSeconds)result.shotsWithinFiveSeconds++;
  }
  result.meanMetresGained=result.samePlayer?result.metresGained/result.samePlayer:null;
  result.meanOpponentSeconds=result.opponentWins?result.opponentSeconds/result.opponentWins:null;
  return result;
 }
 function breakdown(key){return Object.fromEntries([...new Set(episodes.map(key))].sort().map(k=>[k,group(episodes.filter(e=>key(e)===k))]));}
 return {event,frame,snapshot:()=>({measurementVersion:1,...group(episodes),byTier:breakdown(e=>e.tier),bySituation:breakdown(e=>e.situation),
  byTierAndSituation:breakdown(e=>e.tier+':'+e.situation),episodes:episodes.map(({actorId,winnerId,chainActive,...row})=>({...row}))})};
}
