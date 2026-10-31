// Observation only: simulated time, physical movement and actual releases.
export function createAttackMetrics() {
  const counts = Object.fromEntries(['passes','progressivePasses','backwardPasses','loftedPasses','loftedCompleted','inBehindAttempted','inBehindCompleted','inBehindToShot','overTopAttempted','overTopCompleted','overTopToShot','passPossessionsMeasured','passTouches','passTimeMs','receiptsMeasured','receiverMovementM','receiverMovingReceipts','jogFreeRoll','sprintLight','sprintStrong','sprintDouble','cushion','layoffs','fakeShots','reboundShots','keeperTipsOver','keeperTipsRound','keeperWrongCommitments','keeperHandContacts','strongParriesWide','poorParriesDanger','cornersFromSaves'].map(k=>[k,0]));
  Object.assign(counts, Object.fromEntries(['backwardCompleted','defensiveThirdPasses','defensiveThirdCompleted',
    'ownThirdTurnovers','ownThirdPassTurnovers','ownThirdTurnoversToShot','backwardSquareInterceptedByAttacker',
    'ownThirdBackwardSquareInterceptedByAttacker','clearances'].map(k=>[k,0])));
  Object.assign(counts,{ownThirdBackwardPasses:0,ownThirdBackwardCompleted:0});
  Object.assign(counts,{diveSubtle:0,diveFlop:0,diveRolling:0,refPunchScenes:0,shotsBlocked:0,shotBlockLoops:0,shotBlocksToCorner:0,crossesBlocked:0,crossBlockLoops:0,crossBlocksToCorner:0,crossBlocksLoose:0,crossBlocksControlled:0,fakeCrossesTried:0,fakeCrossesBeaten:0,fakeCrossNextCross:0,fakeCrossNextCutBack:0,fakeCrossNextShot:0,fakeCrossToByline:0,fakeCrossToCutBack:0});
  Object.assign(counts,{aerialControls:0,aerialControlThenShot:0,firstTimeGroundShots:0,aerialFirstTimeShots:0,cutBackFirstTimeShots:0,nearMissWide:0,nearMissOver:0,missWide:0,missOver:0,skied:0,skiedHeavyPressure:0,missUnclassified:0,diveAttempts:0,diveBoxAttempts:0,diveFoulsGiven:0,divePenaltiesGiven:0,diveSimulationBookings:0,diveWarnings:0,divePlayOn:0,ridiculousDiveCards:0});
  const shotTypes={},aerialControls=new Map(),playerTeams=new Map(),fakeCrosses=new Map();
  const tracks = new Map(), visibility = {},keeperContacts=[]; let exposedTouch=null; let owner = null, episode = null, pending = null, delivery = [], shot = null, save = null, receiving = null;
  let controlTeam=null, dangerTurnover=null,controlRole=null,lastAction=null,lastBlock=null;
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
  function observeContact(projection,time){
    const c=projection?.contact,p=c?.presentation;
    if(!p||!['first-touch','aerial-volley','aerial-control'].includes(c.contactType))return;
    const samples=projection.ballTrace?.samples,last=samples?.at(-1);
    const chest=p.technique==='chest-control';
    if(!chest&&!(c.contactType==='first-touch'&&last?.position?.z>=.6&&last?.velocity?.z<=0))return;
    if(!c.ownerCandidateId&&!['retained','controlled'].includes(p.outcome))return;
    if(p.firstTimePass||p.firstTimeShot)return;
    const id=c.ownerCandidateId||p.playerId;
    if(id){counts.aerialControls++;aerialControls.set(id,{time,team:playerTeams.get(id)||p.teamId||p.duel?.winnerTeamId||null});}
  }
  function event(e) {
    const newDeliberateTouch=['reception','heavy-touch','pass','headed-pass','shot','directional-knock-on','block','involuntary-body-deflection'].includes(e.type)||
      e.type==='v2-aerial-contact'&&e.outcome!=='miss';
    if(newDeliberateTouch){lastBlock=null;save=null;}
    if(e.type==='skill'&&e.skill==='fake-shot'&&e.fakeCross&&e.actorId){counts.fakeCrossesTried++;
      fakeCrosses.set(e.actorId,{defenderId:e.defenderId,time:e.time,beaten:false,next:false});}
    const fake=fakeCrosses.get(e.actorId);
    if(fake&&e.time-fake.time<5000&&!fake.next){
      if(e.type==='shot'){counts.fakeCrossNextShot++;fake.next=true;}
      if(e.type==='v2-cross'){
        if(e.kind==='cut-back'){counts.fakeCrossNextCutBack++;if(fake.beaten)counts.fakeCrossToCutBack++;}
        else {counts.fakeCrossNextCross++;if(fake.beaten&&e.kind==='byline')counts.fakeCrossToByline++;}
        fake.next=true;
      }
    }
    if(e.type==='block'&&(e.blockedShot||e.openPlayCross)){
      if(e.blockedShot){counts.shotsBlocked++;if(e.looped)counts.shotBlockLoops++;}
      if(e.openPlayCross){counts.crossesBlocked++;if(e.looped)counts.crossBlockLoops++;else if(e.controlled)counts.crossBlocksControlled++;else counts.crossBlocksLoose++;}
      lastBlock={team:e.team,time:e.time,shot:!!e.blockedShot,cross:!!e.openPlayCross};
    }
    if(e.type==='restart'&&lastBlock){
      if(e.kind==='CORNER'&&e.team!==lastBlock.team&&e.time-lastBlock.time<6000){
        if(lastBlock.shot)counts.shotBlocksToCorner++;if(lastBlock.cross)counts.crossBlocksToCorner++;}
      lastBlock=null;
    }
    if(['pass','shot','headed-pass','clearance','restart','goal','half-time','full-time'].includes(e.type))exposedTouch=null;
    if(e.type==='dive'){counts.diveAttempts++;if(e.penaltyArea)counts.diveBoxAttempts++;if(e.decision==='play-on')counts.divePlayOn++;
      const performance={subtle:'diveSubtle',flop:'diveFlop',rolling:'diveRolling'}[e.performance];if(performance)counts[performance]++;}
    if(e.type==='impact-sound'&&e.kind==='referee-punch')counts.refPunchScenes++;
    if(e.type==='dive-outcome'&&e.awarded){
      if(e.decision==='attacker-foul'){counts.diveFoulsGiven++;if(e.penalty)counts.divePenaltiesGiven++;}
      if(e.decision==='simulation'&&e.booked){counts.diveSimulationBookings++;if(e.ridiculous)counts.ridiculousDiveCards++;}
      if(e.decision==='warning')counts.diveWarnings++;
    }
    if(e.type==='pass'&&e.actorId)aerialControls.delete(e.actorId);
    if(e.type==='possession-gained')for(const [id,c]of aerialControls)if(c.team&&c.team!==e.team)aerialControls.delete(id);
    if(['restart','goal','half-time','full-time'].includes(e.type))aerialControls.clear();
    if(e.type==='shot-off-target'&&!shot?.saved&&!e.shotDeflected){
      let kind=e.missKind||e.targetOutcome;
      if(Number.isFinite(e.shotMissLateralMetres)&&Number.isFinite(e.shotMissHeightMetres)){
        const wide=Math.max(0,Math.abs(e.shotMissLateralMetres)-3.66),over=Math.max(0,e.shotMissHeightMetres-2.44);
        kind=e.shotMissHeightMetres>4.44?'skied':wide||over
          ? Math.hypot(wide,over)<=1 ? over>wide?'near-miss-over':'near-miss-wide' : over>wide?'over':'wide' : null;
      }
      const key={'near-miss-wide':'nearMissWide','near-miss-over':'nearMissOver','wide':'missWide','over':'missOver','skied':'skied'}[kind];
      if(key){counts[key]++;if(key==='skied'&&(e.heavyPressure||shot?.pressureM<=1.5))counts.skiedHeavyPressure++;}
      else counts.missUnclassified++;
    }
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
      if(ownThird&&gain < -1)counts.ownThirdBackwardPasses++;
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
        if(pending.ownThird&&pending.backward)counts.ownThirdBackwardCompleted++;
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
      const raw=String(e.technique||e.shotType||'unknown').replace(/^v2-/,'');
      const type=/penalty.*chip|chip.*penalty/.test(raw)?'chip-penalty':/overhead|bicycle/.test(raw)?'overhead':/scissor/.test(raw)?'scissor':
        /header/.test(raw)?'header':/volley/.test(raw)?'volley':/low-driven/.test(raw)?'low-driven':/placed|finesse|curl/.test(raw)?'placed':
        /power/.test(raw)?'power':/chip/.test(raw)?'chip':/driven|normal/.test(raw)?'driven':raw;
      shotTypes[type]=(shotTypes[type]||0)+1;
      const aerial=['header','volley','overhead','scissor'].includes(type);
      if(aerial)counts.aerialFirstTimeShots++;
      else if(e.firstTime===true||/first-time/.test(raw)){counts.firstTimeGroundShots++;if(e.fromCutBack)counts.cutBackFirstTimeShots++;}
      const control=aerialControls.get(e.actorId);
      if(control&&e.time>control.time&&e.time-control.time<=2000){counts.aerialControlThenShot++;aerialControls.delete(e.actorId);}

      if(dangerTurnover&&dangerTurnover.team===e.team&&e.time-dangerTurnover.time<=10000&&!dangerTurnover.shot){
        counts.ownThirdTurnoversToShot++;dangerTurnover.shot=true;dangerTurnover.loss.shot=true;
      }
      for(const d of delivery)if(d.team===e.team&&e.time-d.time<=10000&&!d.shot){counts.inBehindToShot++;if(d.overTop)counts.overTopToShot++;d.shot=true;}
      if(shot&&shot.team===e.team&&shot.rebound&&e.time-shot.time<=6000)counts.reboundShots++;
      shot={team:e.team,time:e.time,rebound:false,saved:false,pressureM:e.shotPressureMetres};
    }
    if(e.type==='keeper-save') { save=e.outcome==='caught'?null:{team:e.team,time:e.time,keeperId:e.actorId}; if(shot){shot.rebound=e.outcome!=='caught';shot.saved=true;} }
    if(/woodwork|post-hit|crossbar/.test(e.type)&&shot)shot.rebound=true;
    if(e.type==='keeper-wrong-commitment')counts.keeperWrongCommitments++;
    if(e.type==='keeper-hand-contact'){counts.keeperHandContacts++;keeperContacts.push({time:e.time,kind:e.kind,animation:e.animation,gapMetres:e.gapMetres,physical:e.physical});}
    if(e.type==='keeper-deflection') { const key={'tip-over':'keeperTipsOver','tip-round':'keeperTipsRound','parry-wide':'strongParriesWide','parry-danger':'poorParriesDanger'}[e.kind]; if(key)counts[key]++; }
    if(e.type==='restart') { if(e.kind==='CORNER'&&save&&save.team!==e.team&&e.time-save.time<60000)counts.cornersFromSaves++; save=null;shot=null;delivery=[];pending=null;episode=null;controlTeam=null;dangerTurnover=null; }
    if(['goal','half-time','full-time'].includes(e.type)) {episode=null;pending=null;delivery=[];shot=null;save=null;controlTeam=null;dangerTurnover=null;}
  }
  return {event, contact:observeContact, frame({players,ownerId,physicalOwnerId=ownerId,time,live,ball}) {
    for(const [id,fake]of fakeCrosses){
      if(time-fake.time>5000){fakeCrosses.delete(id);continue;}
      const actor=players.find(p=>p.id===id),defender=players.find(p=>p.id===fake.defenderId);
      if(!fake.beaten&&actor&&defender){
        fake.origin??={x:actor.x,y:actor.y};
        if((actor.direction||1)*(actor.x-defender.x)>.3&&Math.hypot(actor.x-fake.origin.x,actor.y-fake.origin.y)>=1.2&&Math.hypot(actor.x-defender.x,actor.y-defender.y)>=1.8){
          fake.beaten=true;counts.fakeCrossesBeaten++;}
      }
    }
    for(const p of players) {playerTeams.set(p.id,p.team);const rows=tracks.get(p.id)||[];rows.push({x:p.x,y:p.y,t:time});while(rows.length&&rows[0].t<time-1100)rows.shift();tracks.set(p.id,rows);}
    if(exposedTouch&&(!live||physicalOwnerId))exposedTouch=null;
    if(exposedTouch&&ball){const p=players.find(p=>p.id===exposedTouch.id);
      if(p&&time-exposedTouch.time<5000){const gap=Math.hypot(ball.x-p.x,ball.y-p.y),row=visibility[exposedTouch.tier];row.maximumGapM=Math.max(row.maximumGapM,gap);
        if(gap>=2&&!exposedTouch.visible){row.visibleBeyondTwoMetres++;exposedTouch.visible=true;}}
      if(time-exposedTouch.time>5000)exposedTouch=null;
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
  }, snapshot:()=>({measurementVersion:2,keeperContacts,shotTypes:{...shotTypes},visibility,ownThirdLosses,passSafety,counts:{...counts},backwardShare:counts.passes?counts.backwardPasses/counts.passes:0,
    averageTouchesBeforePass:counts.passPossessionsMeasured?counts.passTouches/counts.passPossessionsMeasured:null,
    averageSecondsBeforePass:counts.passPossessionsMeasured?counts.passTimeMs/counts.passPossessionsMeasured/1000:null,
    averageReceiverMovementM:counts.receiptsMeasured?counts.receiverMovementM/counts.receiptsMeasured:null})};
}
