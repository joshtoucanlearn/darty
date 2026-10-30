// Observation only. Race episodes use actual unowned balls and both opponents;
// no winner, movement target or contact is changed by this recorder.
export function createLooseRaceMetrics() {
  const episodes=[];let latest=null,active=null,sequence=0,controls={},releaseUntil=-Infinity;
  const aliases=new Map();
  function safe(value){if(typeof value==='string')return aliases.get(value)||value;if(Array.isArray(value))return value.map(safe);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[aliases.get(k)||k,safe(v)]));return value;}
  const counts={races:0,resolved:0,withinOnePointFiveSeconds:0,unresolved:0,shoulderContests:0,nearerWins:0,fasterWins:0,bothWins:0,upsets:0,thirdPlayerWins:0,
    secondsToResolution:0,playerFrames:0,speedSum:0,sprintGaitFrames:0,fullSprintCommandFrames:0,slowSideBySideSeconds:0,racersReachingSixMps:0,racers:0};
  function end(time,winnerId,reason) {
    if(!active)return;active.durationSeconds=(time-active.started)/1000;active.winnerId=winnerId||null;active.reason=reason;
    if(winnerId){counts.resolved++;counts.secondsToResolution+=active.durationSeconds;if(active.durationSeconds<=1.5)counts.withinOnePointFiveSeconds++;
      if(active.ids.includes(winnerId)){const near=winnerId===active.nearerId,fast=winnerId===active.fasterId;if(near)counts.nearerWins++;if(fast)counts.fasterWins++;if(near&&fast)counts.bothWins++;if(!near&&!fast)counts.upsets++;}
      else counts.thirdPlayerWins++;
    }else counts.unresolved++;
    for(const peak of Object.values(active.peaks)){counts.racers++;if(peak>=6)counts.racersReachingSixMps++;}
    episodes.push(active);active=null;
  }
  return {
    commands(rows){controls=Object.fromEntries((rows||[]).map(p=>[p.playerId,{...p,mode:p.mode||p.type}]));},
    assignment(projection){latest={projection,controls};for(const c of projection.movementTelemetry?.contacts||[])if(c.type==='shoulder-contact'&&(active||c.racePursuit)){counts.shoulderContests++;if(active)active.shoulderContests++;}},
    event(e){
      if(['pass','shot','headed-pass','clearance'].includes(e.type))releaseUntil=e.time+25;
      if(active&&['pass','shot','headed-pass','clearance'].includes(e.type)&&active.ids.includes(e.actorId))end(e.time,e.actorId,'first-time-play');
      if(active&&['restart','goal','half-time','full-time'].includes(e.type))end(e.time,null,e.type);
    },
    frame({time,live,players,ball,ownerId}){
      const byTeam={};for(const p of players){byTeam[p.team]=(byTeam[p.team]||0)+1;if(!aliases.has(p.id))aliases.set(p.id,p.team+'-player-'+byTeam[p.team]);}
      if(!live){if(active)end(time,null,'dead-ball-or-handoff');return;}
      if(ownerId){if(active)end(time,ownerId,'control');return;}
      if(!active&&time<=releaseUntil)return;
      if(!ball||ball.isShot||ball.z>1.4){if(active)end(time,null,'protected-flight');return;}
      const route=latest?.projection?.possession;
      const deliberate=route?.inFlight&&route.deliberatePass&&!route.arrivalWindowEntered;
      if(deliberate&&!ball.knockOn&&!/deflection|rebound/.test(ball.flightType||'')){if(active)end(time,null,'authored-pass');return;}
      const available=players.filter(p=>!p.isGK&&!p.sentOff);
      const nearest=team=>available.filter(p=>p.team===team).map(p=>({...p,gap:Math.hypot(p.x-ball.x,p.y-ball.y)})).sort((a,b)=>a.gap-b.gap||a.id.localeCompare(b.id))[0];
      const pair=[nearest('you'),nearest('opp')];
      if(!active){
        if(pair.some(p=>!p||p.gap>9)||Math.min(...pair.map(p=>p.gap))>7)return;
        const [a,b]=pair;if(Math.abs(a.gap/(5.1+a.pace/99*2.25)-b.gap/(5.1+b.pace/99*2.25))>1)return;
        active={id:++sequence,started:time,flightType:ball.flightType,ids:pair.map(p=>p.id),nearerId:a.gap<=b.gap?a.id:b.id,fasterId:a.pace>=b.pace?a.id:b.id,
          initialGaps:pair.map(p=>p.gap),initialPace:pair.map(p=>p.pace),peaks:Object.fromEntries(pair.map(p=>[p.id,0])),shoulderContests:0,samples:[],lastSample:-Infinity};counts.races++;
      }
      const racers=active.ids.map(id=>players.find(p=>p.id===id));if(racers.some(p=>!p||p.sentOff)){end(time,null,'racer-unavailable');return;}
      const rows=racers.map(p=>{const speed=Math.hypot(p.vx,p.vy),assignment=latest?.projection?.recoveryAssignments?.find(r=>r.playerId===p.id),control=latest?.controls[p.id];
        active.peaks[p.id]=Math.max(active.peaks[p.id],speed);counts.playerFrames++;counts.speedSum+=speed;if(p.gait==='sprint')counts.sprintGaitFrames++;
        if(control?.mode==='sprint'&&control.intensity>=.98)counts.fullSprintCommandFrames++;
        return {id:p.id,speed,gait:p.gait,commandMode:control?.mode||null,intensity:control?.intensity??null,x:p.x,y:p.y,gap:Math.hypot(p.x-ball.x,p.y-ball.y),
          target:assignment?.target||null,authority:assignment?.authority||null,etaSeconds:assignment?.etaSeconds??null};});
      if(time-active.started>350&&rows.every(p=>p.speed<4.5)&&Math.hypot(rows[0].x-rows[1].x,rows[0].y-rows[1].y)<1.6)counts.slowSideBySideSeconds+=1/60;
      if(time-active.lastSample>=100&&active.samples.length<100){active.samples.push({ms:time-active.started,ball:{x:ball.x,y:ball.y,vx:ball.vx,vy:ball.vy},racers:rows});active.lastSample=time;}
      if(time-active.started>=10000)end(time,null,'ten-second-unresolved');
    },
    snapshot:()=>({counts:{...counts},meanRacerSpeedMps:counts.playerFrames?counts.speedSum/counts.playerFrames:null,
      meanResolutionSeconds:counts.resolved?counts.secondsToResolution/counts.resolved:null,
      sprintGaitShare:counts.playerFrames?counts.sprintGaitFrames/counts.playerFrames:null,
      fullSprintCommandShare:counts.playerFrames?counts.fullSprintCommandFrames/counts.playerFrames:null,
      episodes:safe(episodes),active:active?safe({...active}):null})
  };
}
