// Observational action ledger: actual releases and physical outcomes only.
export function createCombinationMetrics() {
  const counts = { oneTwos: 0, thirdManCombinations: 0, switches: 0, switchesCompleted: 0,
    crosses: 0, crossesCompleted: 0, boxEntries: 0, headers: 0, volleys: 0, shotsFromCrosses: 0,
    takeOns: 0, takeOnsWon: 0, progressiveCarries: 0, dispossessions: 0, finalThirdEntries: 0, boxSlotRuns: 0, tacklesWon: 0, skillsUsed: 0, knockOns: 0, knockOnsWon: 0,
    directionalFirstTouches: 0, directionalKept: 0, directionalLost: 0, directionalToCarry: 0, directionalToPass: 0, directionalToShot: 0, nextActionWithinOneSecond: 0, knockOnNextActionWithinOneSecond: 0 };
  const skills = {}, carryDirections = {}, receiving = {};
  let touch = null, knockOn = null;
  const byLength = {}, byThird = {}, decisions = {}, history = [];
  let pending = null, carry = null, previousOwner = null, lastCross = null, takeOn = null;
  const bucket = (map, key) => map[key] ||= { attempted: 0, completed: 0 };
  const inBox = p => p.progress >= 1 - 16.5 / 105 && Math.abs(p.y - 34) <= 20.16;
  function terminal(event) {
    if (!pending) return;
    if (event.completed) {
      for (const map of [bucket(byLength, pending.length), bucket(byThird, pending.third)]) map.completed++;
      if (pending.switch) counts.switchesCompleted++;
      if (pending.cross) counts.crossesCompleted++;
      if (pending.progress < 2 / 3 && event.progress >= 2 / 3) counts.finalThirdEntries++;
      if (!pending.inBox && event.inBox) counts.boxEntries++;
      const prior = history.at(-1);
      if (prior && prior.team === pending.team && pending.time - prior.time <= 6000 &&
          prior.receiver === pending.actorId && event.receiverId === prior.actorId &&
          event.progress > prior.progress + 1.5 / 105) counts.oneTwos++;
      // Two completed linked passes involving three distinct players, with a
      // planned layoff (not any arbitrary three-player passing chain).
      if (prior && prior.receiver === pending.actorId && prior.team === pending.team &&
          pending.reason === 'third-man-layoff' && event.receiverId !== prior.actorId &&
          pending.time - prior.time <= 6000) counts.thirdManCombinations++;
      history.push({ ...pending, receiver: event.receiverId });
      if (history.length > 3) history.shift();
    } else history.length = 0;
    pending = null;
  }
  return {
    event(e) {
      if (e.type === 'skill') { counts.skillsUsed++; skills[e.skill || 'unknown'] = (skills[e.skill || 'unknown'] || 0) + 1; }
      if (e.type === 'tackle' || /^v2-(tackle|slide|shoulder)-contact$/.test(e.type) && e.ballWon) counts.tacklesWon++;
      if (e.type === 'reception' || e.type === 'heavy-touch') {
        const key = (e.cpu === false ? 'human:' : 'cpu:') + (e.intent || 'cushion'); receiving[key] = (receiving[key] || 0) + 1;
        if (e.cpu !== false && e.intent === 'directional-touch') {
          counts.directionalFirstTouches++;
          if (touch && !touch.kept) counts.directionalLost++;
          touch = { actorId: e.actorId, team: e.team, time: e.time, progress: e.progress, kept: false, carry: false, action: false };
        }
      }
      if (e.type === 'directional-knock-on' && e.cpu !== false) {
        counts.knockOns++; knockOn = { actorId: e.actorId, team: e.team, time: e.time, progress: e.progress, won: false, action: false };
      }
      if (touch && touch.actorId === e.actorId && ['pass', 'shot'].includes(e.type) && !touch.action) {
        touch.action = true; counts[e.type === 'pass' ? 'directionalToPass' : 'directionalToShot']++;
        if (e.time - touch.time <= 1000) counts.nextActionWithinOneSecond++;
      }
      if (knockOn && knockOn.actorId === e.actorId && ['pass', 'shot'].includes(e.type) && !knockOn.action) {
        if (e.time - knockOn.time <= 1000) counts.knockOnNextActionWithinOneSecond++;
        knockOn.action = true;
      }
      if (e.type === 'pass') {
        const d = e.distanceMetres;
        pending = { actorId: e.actorId, team: e.team, receiver: e.targetId, progress: e.progress, inBox: e.inBox,
          time: e.time, length: d < 10 ? 'short-under-10m' : d <= 25 ? 'medium-10-25m' : 'long-over-25m',
          third: e.progress < 1 / 3 ? 'defensive' : e.progress < 2 / 3 ? 'middle' : 'attacking',
          cross: /cross|corner/.test(e.flightType || ''), switch: false };
        for (const map of [bucket(byLength, pending.length), bucket(byThird, pending.third)]) map.attempted++;
        if (pending.cross) { counts.crosses++; lastCross = { team: e.team, time: e.time }; }
      } else if (e.type === 'v2-pass-decision') {
        decisions[e.reason] = (decisions[e.reason] || 0) + 1;
        if (pending) {
          pending.reason = e.reason;
          if (e.reason === 'switch-congested-side') { pending.switch = true; counts.switches++; }
        }
      } else if (e.type === 'pass-resolved') terminal(e);
      else if (e.type === 'v2-box-slot-run') counts.boxSlotRuns++;
      else if (e.type === 'v2-cross') { /* release is already counted as a pass */ }
      else if (e.type === 'v2-aerial-contact' && e.outcome !== 'missed') {
        if (e.technique === 'header') counts.headers++; else counts.volleys++;
      } else if (e.type === 'header') counts.headers++;
      else if (e.type === 'volley') counts.volleys++;
      else if (e.type === 'shot' && (e.fromCross || lastCross && lastCross.team === e.team && e.time - lastCross.time <= 5000)) counts.shotsFromCrosses++;
      else if (e.type === 'ai-take-on-attempt' || e.type === 'ai-skill-selection' && e.defenderId) {
        // The retained host executor can emit both selection and attempt for
        // one action. Count the contact episode once; wins are observed below.
        if (!takeOn || takeOn.actorId !== e.actorId || e.time !== takeOn.time) {
          counts.takeOns++; takeOn = { actorId: e.actorId, team: e.team, time: e.time, progress: e.progress, defenderId: e.defenderId };
        }
      }
      if (['restart', 'half-time', 'full-time', 'goal'].includes(e.type)) {
        if (touch && !touch.kept) counts.directionalLost++; touch = null; knockOn = null; history.length = 0; carry = null; previousOwner = null; takeOn = null; }
    },
    possession(owner, live) {
      if (!live) { carry = null; previousOwner = null; takeOn = null; return; }
      if (!owner) { carry = null; return; }
      if (touch) {
        if (owner.team !== touch.team || owner.time - touch.time > 3500) { if (!touch.kept) counts.directionalLost++; touch = null; }
        else if (owner.id === touch.actorId) {
          if (!touch.kept) { counts.directionalKept++; touch.kept = true; }
          if (!touch.carry && owner.progress - touch.progress >= 3 / 105) { counts.directionalToCarry++; touch.carry = true; if (!touch.action && owner.time - touch.time <= 1000) { counts.nextActionWithinOneSecond++; touch.action = true; } }
        }
      }
      if (knockOn && owner.id === knockOn.actorId) {
        if (!knockOn.won && owner.progress - knockOn.progress >= 2 / 105) { counts.knockOnsWon++; knockOn.won = true; }
        if (!knockOn.action && owner.progress - knockOn.progress >= 3 / 105) {
          if (owner.time - knockOn.time <= 1000) counts.knockOnNextActionWithinOneSecond++;
          knockOn.action = true;
        }
      }
      if (knockOn && (owner.team !== knockOn.team || owner.time - knockOn.time > 3500)) knockOn = null;
      if (previousOwner && owner.team !== previousOwner.team) { counts.dispossessions++; takeOn = null; }
      previousOwner = owner;
      if (takeOn && owner.id === takeOn.actorId && owner.time - takeOn.time <= 3500 &&
          owner.progress - takeOn.progress >= 2 / 105 && (takeOn.defenderId && owner.defenders ? owner.defenders[takeOn.defenderId] < -.5 : owner.defenderBehind)) { counts.takeOnsWon++; takeOn = null; }
      if (takeOn && owner.time - takeOn.time > 3500) takeOn = null;
      if (!carry || carry.id !== owner.id) carry = { ...owner, counted: false };
      if (!carry.directionCounted && Math.hypot((owner.progress - carry.progress) * 105, owner.y - carry.y) >= 3) {
        const forward = (owner.progress - carry.progress) * 105, lateral = owner.y - carry.y;
        const direction = forward < -1 ? 'backward' : Math.abs(lateral) < Math.abs(forward) * .3 ? 'forward' :
          Math.abs(forward) < Math.abs(lateral) * .3 ? 'lateral' : Math.abs(owner.y - 34) < Math.abs(carry.y - 34) ? 'diagonal-inside' : 'diagonal-outside';
        carryDirections[direction] = (carryDirections[direction] || 0) + 1; carry.directionCounted = true;
      }
      if (!carry.counted && owner.progress - carry.progress >= 10 / 105) { counts.progressiveCarries++; carry.counted = true; }
      if (carry.previousProgress < 2 / 3 && owner.progress >= 2 / 3) counts.finalThirdEntries++;
      if (carry.previousBox === false && inBox(owner)) counts.boxEntries++;
      carry.previousProgress = owner.progress; carry.previousBox = inBox(owner);
    },
    snapshot: () => ({ counts: { ...counts }, byLength, byThird, decisions, skills, carryDirections, receiving })
  };
}
