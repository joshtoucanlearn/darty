// Observation only: simulated time, physical movement and actual releases.
export function createAttackMetrics() {
  const counts = Object.fromEntries(['passes','progressivePasses','backwardPasses','loftedPasses','loftedCompleted','inBehindAttempted','inBehindCompleted','inBehindToShot','overTopAttempted','overTopCompleted','overTopToShot','passPossessionsMeasured','passTouches','passTimeMs','receiptsMeasured','receiverMovementM','receiverMovingReceipts','jogFreeRoll','sprintLight','sprintStrong','sprintDouble','cushion','layoffs','fakeShots','reboundShots','keeperTipsOver','keeperTipsRound','strongParriesWide','poorParriesDanger','cornersFromSaves'].map(k=>[k,0]));
  Object.assign(counts, Object.fromEntries(['backwardCompleted','defensiveThirdPasses','defensiveThirdCompleted',
    'ownThirdTurnovers','ownThirdPassTurnovers','ownThirdTurnoversToShot','backwardSquareInterceptedByAttacker',
    'ownThirdBackwardSquareInterceptedByAttacker','clearances'].map(k=>[k,0])));
  const tracks = new Map(), visibility = {}; let exposedTouch=null; let owner = null, episode = null, pending = null, delivery = [], shot = null, save = null, receiving = null;
  let controlTeam=null, dangerTurnover=null,controlRole=null,lastAction=null;
  const ownThirdLosses=[],passSafety=[];
  function controlledBy(team, progress, time, fromPass=false) {
    if(!team)return;
    if(controlTeam&&controlTeam!==team){
      if(progress>=2/3){counts.ownThirdTurnovers++;if(fromPass)counts.ownThirdPassTurnovers++;
        dangerTurnover={team,time,shot:false};
        const loss={time,fromPass,role:controlRole,action:fromPass?pending?.reason||'unlabelled-pass':lastAction,shot:false};
        ownThirdLosses.push(loss);dangerTurnover.loss=loss;}
      else dangerTurnover=null;
    }
    if(dangerTurnover&&dangerTurnover.team!==team)dangerTurnover=null;
    controlTeam=team;
  }
  function movementBefore(id,time){
    const rows=(tracks.get(id)||[]).filter(p=>p.t>=time-1000);if(rows.length<2||time-rows[0].t<900)return null;
    let d=0;for(let i=1;i<rows.length;i++)d+=Math.hypot(rows[i].x-rows[i-1].x,rows[i].y-rows[i-1].y);return d;
  }
  function event(e) {
    if(e.type==='clearance')counts.clearances++;
    if(e.type==='v2-carrier-intent')lastAction=e.intent+':'+e.reason;
    if(e.type==='directional-knock-on')lastAction='knock-on:'+e.touchTier;
    if(e.type==='skill')lastAction='skill:'+e.skill;
    if(e.type==='v2-pass-decision'&&pending)pending.reason=e.reason;
    if(pending&&['reception','heavy-touch'].includes(e.type)&&e.team===pending.team&&!Object.hasOwn(pending.receipts,e.actorId))pending.receipts[e.actorId]=movementBefore(e.actorId,e.time);
    if(['reception','heavy-touch'].includes(e.type))receiving={id:e.actorId,start:e.time,touches:1,sequence:null};
    if(episode&&episode.id===e.actorId){
      if(e.type==='directional-knock-on')episode.touches++;
      if(e.type==='v2-dribble-state' && e.animationPhase==='dribble-contact' && e.touchSequence!==episode.sequence){episode.touches++;episode.sequence=e.touchSequence;}
    }
    if (e.type === 'pass') {
      counts.passes++; const gain = e.passProgressM || 0;
      if (gain >= 5) counts.progressivePasses++;
      if (gain < -1) counts.backwardPasses++;
      const loft = Number.isFinite(e.loft) ? e.loft > 0 : /long|lob|corner|cross/.test(e.flightType || '') && !/low-cross/.test(e.flightType || '');
      const behind = e.behindLineM >= 2 && gain >= 5;
      const originProgress=e.passOriginProgress??e.actorProgress;
      const ownThird=Number.isFinite(originProgress)&&originProgress<1/3;
      if(ownThird)counts.defensiveThirdPasses++;
      controlTeam=e.team;controlRole=e.actorRole;
      pending = { team:e.team, loft, behind, overTop:behind && loft, time:e.time, receipts:{},
        backward:gain < -1, backwardSquare:gain<=1, ownThird,flightType:e.flightType };
      if(loft) counts.loftedPasses++; if(behind) counts.inBehindAttempted++; if(pending.overTop) counts.overTopAttempted++;
      const held=episode&&episode.id===e.actorId?episode:receiving&&receiving.id===e.actorId&&e.time-receiving.start<1000?receiving:null;
      if(held){counts.passPossessionsMeasured++;counts.passTimeMs+=e.time-held.start;counts.passTouches+=Math.max(1,held.touches);}
      else if(e.authority==='cpu-v2-first-time'||e.flightType==='headed-pass'){counts.passPossessionsMeasured++;counts.passTouches++;}
      episode = null;
    }
    if (e.type === 'pass-resolved' && pending) {
      passSafety.push({backward:pending.backward,ownThird:pending.ownThird,flightType:pending.flightType,
        reason:pending.reason||'unlabelled-pass',completed:!!e.completed,terminalReason:e.reason||null});
      if(e.completed) {
        controlRole=e.receiverRole||controlRole;lastAction='receiving-touch';
        if(pending.backward)counts.backwardCompleted++;
        if(pending.ownThird)counts.defensiveThirdCompleted++;
        if(pending.loft) counts.loftedCompleted++;
        if(pending.behind) counts.inBehindCompleted++;
        if(pending.overTop) counts.overTopCompleted++;
        if(pending.behind)delivery=delivery.filter(d=>e.time-d.time<=10000).concat({...pending,receiverId:e.receiverId,time:e.time,shot:false}).slice(-8);
        const d=Object.hasOwn(pending.receipts,e.receiverId)?pending.receipts[e.receiverId]:movementBefore(e.receiverId,e.time);
        if(d!=null){counts.receiptsMeasured++;counts.receiverMovementM+=d;if(d>=.5)counts.receiverMovingReceipts++;}
      }
      else if(e.receiverTeam&&e.receiverTeam!==pending.team){
        if(pending.backwardSquare&&['striker','winger','attacking-midfielder'].includes(e.receiverRole)){
          counts.backwardSquareInterceptedByAttacker++;
          if(pending.ownThird)counts.ownThirdBackwardSquareInterceptedByAttacker++;
        }
        controlledBy(e.receiverTeam,Number.isFinite(e.receiverProgress)?e.receiverProgress:0,e.time,true);
      }
      pending=null;
    }
    if(e.type==='possession-gained'){controlledBy(e.team,e.actorProgress,e.time);controlRole=e.actorRole;lastAction='controlled';}
    if(e.type==='directional-knock-on') { exposedTouch={id:e.actorId,time:e.time,tier:e.touchTier,visible:false}; visibility[e.touchTier] ||= {attempts:0,visibleBeyondTwoMetres:0,maximumGapM:0};visibility[e.touchTier].attempts++; const key={'baseline-free-roll':'jogFreeRoll','sprint-forward-light':'sprintLight','sprint-forward-strong':'sprintStrong','sprint-forward-double':'sprintDouble'}[e.touchTier];if(key)counts[key]++; }
    if(e.type==='reception'||e.type==='heavy-touch') { if(e.intent==='layoff')counts.layoffs++;else if(!e.intent||['trap','cushion'].includes(e.intent))counts.cushion++; }
    if(e.type==='skill'&&e.skill==='fake-shot')counts.fakeShots++;
    if(e.type==='shot') {
      if(dangerTurnover&&dangerTurnover.team===e.team&&e.time-dangerTurnover.time<=10000&&!dangerTurnover.shot){
        counts.ownThirdTurnoversToShot++;dangerTurnover.shot=true;dangerTurnover.loss.shot=true;
      }
      for(const d of delivery)if(d.team===e.team&&e.time-d.time<=10000&&!d.shot){counts.inBehindToShot++;if(d.overTop)counts.overTopToShot++;d.shot=true;}
      if(shot&&shot.team===e.team&&shot.rebound&&e.time-shot.time<=6000)counts.reboundShots++;
      shot={team:e.team,time:e.time,rebound:false};
    }
    if(e.type==='keeper-save') { save=e.outcome==='caught'?null:{team:e.team,time:e.time,keeperId:e.actorId}; if(shot)shot.rebound=e.outcome!=='caught'; }
    if(/woodwork|post-hit|crossbar/.test(e.type)&&shot)shot.rebound=true;
    if(e.type==='keeper-deflection') { const key={'tip-over':'keeperTipsOver','tip-round':'keeperTipsRound','parry-wide':'strongParriesWide','parry-danger':'poorParriesDanger'}[e.kind]; if(key)counts[key]++; }
    if(e.type==='restart') { if(e.kind==='CORNER'&&save&&save.team!==e.team&&e.time-save.time<60000)counts.cornersFromSaves++; save=null;shot=null;delivery=[];pending=null;episode=null;controlTeam=null;dangerTurnover=null; }
    if(['goal','half-time','full-time'].includes(e.type)) {episode=null;pending=null;delivery=[];shot=null;save=null;controlTeam=null;dangerTurnover=null;}
  }
  return {event, frame({players,ownerId,time,live,ball}) {
    for(const p of players) {const rows=tracks.get(p.id)||[];rows.push({x:p.x,y:p.y,t:time});while(rows.length&&rows[0].t<time-1100)rows.shift();tracks.set(p.id,rows);}
    if(exposedTouch&&ball){const p=players.find(p=>p.id===exposedTouch.id);
      if(p&&time-exposedTouch.time<5000){const gap=Math.hypot(ball.x-p.x,ball.y-p.y),row=visibility[exposedTouch.tier];row.maximumGapM=Math.max(row.maximumGapM,gap);
        if(gap>=2&&!exposedTouch.visible){row.visibleBeyondTwoMetres++;exposedTouch.visible=true;}}
      if(time-exposedTouch.time>5000||ownerId&&ownerId!==exposedTouch.id)exposedTouch=null;
    }
    const p=players.find(p=>p.id===ownerId);
    if(!live) {episode=null;owner=null;return;}
    if(p) {
      if(save&&p.id!==save.keeperId)save=null;
      if(owner!==p.id||!episode)episode=receiving&&receiving.id===p.id&&time-receiving.start<2000?{...receiving}:{id:p.id,start:time,touches:1,sequence:null};

      if(delivery.some(d=>p.team!==d.team))delivery=[];
      if(shot&&p.team!==shot.team&&!p.isGK)shot=null;
      owner=p.id;
    }
  }, snapshot:()=>({visibility,ownThirdLosses,passSafety,counts:{...counts},backwardShare:counts.passes?counts.backwardPasses/counts.passes:0,
    averageTouchesBeforePass:counts.passPossessionsMeasured?counts.passTouches/counts.passPossessionsMeasured:null,
    averageSecondsBeforePass:counts.passPossessionsMeasured?counts.passTimeMs/counts.passPossessionsMeasured/1000:null,
    averageReceiverMovementM:counts.receiptsMeasured?counts.receiverMovementM/counts.receiptsMeasured:null})};
}
