// Observation only. A kick is resolved by real control, a deliberate contact,
// or the existing laws event; a target or a receiving lease is not a receipt.
export function createDeliveryMetrics() {
  const passes = {}, clearances = {}, clearanceEpisodes = [], links = [], repeatedLinkEpisodes=[];
  let pass = null, clearance = null, repeatedDefenderLinks = 0,lastBallAction=null,lastBoundaryFrame=null,lastSkill=null;
  const outEpisodes=[];
  const outByLastAction=Object.fromEntries(['dribble-touch','pass','cross','shot','clearance','deflection','keeper','unknown'].map(k=>[k,0]));
  const row = (map, key) => map[key] ||= { attempted: 0, completed: 0, out: 0, own: 0, opponent: 0, stopped: 0 };
  const defender = role => ['centre-back', 'full-back', 'wing-back'].includes(role);
  function passTypes(p) {
    const types = [];
    if (p.flightType === 'throw-in') return ['throw'];
    if (/cross|corner/.test(p.flightType)) return ['cross'];
    if (p.supportKind === 'switch' || /switch/.test(p.reason)) types.push('switch');
    if (p.lofted) types.push('lofted');
    if (p.reason === 'third-man-layoff') types.push('third-man');
    if (/release-.*run|in-behind|through/.test(p.reason || '') || p.supportKind === 'in-behind') types.push('run');
    return types.length ? types : ['ordinary'];
  }
  function resolveClearance(outcome, time) {
    if (!clearance) return;
    row(clearances, clearance.trigger)[outcome]++;
    Object.assign(clearance, { outcome, seconds: (time - clearance.time) / 1000 });
    clearance = null;
  }
  function controlled(actorId, team, time) {
    if (clearance && actorId && team && time > clearance.time)
      resolveClearance(team === clearance.team ? 'own' : 'opponent', time);
  }
  const countPass = delta => { for (const type of passTypes(pass)) row(passes, type).attempted += delta; };
  return {
    event(e) {
      if(['pass','headed-pass'].includes(e.type))lastBallAction=/cross|corner/.test(e.flightType||'')?'cross':'pass';
      else if(e.type==='v2-cross')lastBallAction='cross';
      else if(e.type==='shot')lastBallAction='shot';
      else if(e.type==='clearance')lastBallAction='clearance';
      else if(['directional-knock-on','heavy-touch','reception'].includes(e.type)||e.type==='v2-dribble-state'&&e.animationPhase==='dribble-contact')lastBallAction='dribble-touch';
      else if(['block','involuntary-body-deflection'].includes(e.type)||/^v2-(tackle|slide)-contact$/.test(e.type)&&e.ballWon)lastBallAction='deflection';
      else if(['keeper-deflection','keeper-save','keeper-claim'].includes(e.type))lastBallAction='keeper';
      if(e.type==='skill'||e.type==='directional-knock-on')lastSkill={time:e.time,kind:e.skill||e.touchTier||e.tier};
      if(e.type==='restart'&&/THROW-IN|GOAL KICK|CORNER/.test(e.kind||'')){
        const action=lastBallAction||'unknown';outByLastAction[action]++;
        outEpisodes.push({time:e.time,kind:e.kind,action,context:lastBoundaryFrame,
          skill:lastSkill&&e.time-lastSkill.time<2500?lastSkill.kind:null});lastBallAction=null;
      }

      if (['pass', 'shot', 'headed-pass'].includes(e.type)) controlled(e.actorId, e.team, e.time);
      if (e.type === 'pass') { pass = { actorId: e.actorId, role: e.actorRole, team: e.team,
        time: e.time, flightType: e.flightType, lofted: e.loft > 0 }; countPass(1); }
      if (e.type === 'v2-pass-decision' && pass) { countPass(-1);
        Object.assign(pass, { reason: e.reason, supportKind: e.supportKind }); countPass(1); }
      if (e.type === 'pass-resolved' && pass) {
        for (const type of passTypes(pass)) {
          const r = row(passes, type);
          if (e.completed) r.completed++;
          if (/^restart:(throw-in|goal-kick|corner)$/.test(e.reason || '')) r.out++;
        }
        if (e.completed) {
          const [a, b] = links.slice(-2);
          if (a && b && a.team === pass.team && b.team === pass.team && pass.time - a.time < 15000 &&
              a.actorId === pass.actorId && a.receiverId === b.actorId &&
              b.receiverId === pass.actorId && e.receiverId === b.actorId &&
              defender(a.role) && defender(b.role) && defender(pass.role)) {repeatedDefenderLinks++;
            repeatedLinkEpisodes.push({time:e.time,team:pass.team,passes:[{...a},{...b},{...pass,receiverId:e.receiverId}]});}
          links.push({ ...pass, receiverId: e.receiverId });
          if (links.length > 2) links.shift();
        } else links.length = 0;
        controlled(e.receiverId, e.receiverTeam, e.time);
        pass = null;
      }
      if (e.type === 'clearance') {
        controlled(e.actorId, e.team, e.time);
        if (clearance) resolveClearance('stopped', e.time);
        const trigger = e.trigger || e.reason || 'unlabelled-clearance';
        row(clearances, trigger).attempted++;
        clearance = { actorId: e.actorId, team: e.team, time: e.time, trigger, outcome: null };
        clearanceEpisodes.push(clearance);
      }
      if (e.type === 'possession-gained') controlled(e.actorId, e.team, e.time);
      if (['restart', 'goal', 'half-time', 'full-time'].includes(e.type)) {
        if (clearance) resolveClearance(e.type === 'restart' && /THROW-IN|GOAL KICK|CORNER/.test(e.kind || '') ? 'out' : 'stopped', e.time);
        links.length = 0;
      }
    },
    frame({ time, live, physicalOwnerId, players, boundaryContext }) {
      if(live&&boundaryContext)lastBoundaryFrame=boundaryContext;
      if(live&&physicalOwnerId){const p=players.find(p=>p.id===physicalOwnerId);if(p)lastBallAction=p.isGK?'keeper':'dribble-touch';}
      if (!live || !physicalOwnerId || !clearance) return;
      const p = players.find(p => p.id === physicalOwnerId);
      if (p) controlled(p.id, p.team, time);
    },
    snapshot() {
      return { passes, clearances, clearanceEpisodes,outByLastAction,outEpisodes, repeatedDefenderLinks, repeatedLinkEpisodes,
        unresolvedPass: pass ? { types: passTypes(pass) } : null, unresolvedClearance: !!clearance };
    }
  };
}
