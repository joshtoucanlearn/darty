// Observational action ledger: actual releases and physical outcomes only.
export function createCombinationMetrics() {
  const counts = { oneTwos: 0, thirdManCombinations: 0, switches: 0, switchesCompleted: 0,
    crosses: 0, crossesCompleted: 0, boxEntries: 0, headers: 0, volleys: 0, shotsFromCrosses: 0,
    takeOns: 0, takeOnsWon: 0, progressiveCarries: 0, dispossessions: 0, finalThirdEntries: 0, boxSlotRuns: 0 };
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
      else if (e.type === 'ai-take-on-attempt' || e.type === 'skill' && e.cpu && e.nearestDefender) {
        counts.takeOns++; takeOn = { actorId: e.actorId, team: e.team, time: e.time, progress: e.progress };
      } else if (e.type === 'ai-take-on-result' && e.outcome === 'defender-eliminated') counts.takeOnsWon++;
      if (['restart', 'half-time', 'full-time', 'goal'].includes(e.type)) { history.length = 0; carry = null; previousOwner = null; takeOn = null; }
    },
    possession(owner, live) {
      if (!live) { carry = null; previousOwner = null; takeOn = null; return; }
      if (!owner) { carry = null; return; }
      if (previousOwner && owner.team !== previousOwner.team) { counts.dispossessions++; takeOn = null; }
      previousOwner = owner;
      if (takeOn && owner.id === takeOn.actorId && owner.time - takeOn.time <= 3500 &&
          owner.progress - takeOn.progress >= 3 / 105 && owner.defenderBehind) { counts.takeOnsWon++; takeOn = null; }
      if (takeOn && owner.time - takeOn.time > 3500) takeOn = null;
      if (!carry || carry.id !== owner.id) carry = { ...owner, counted: false };
      if (!carry.counted && owner.progress - carry.progress >= 10 / 105) { counts.progressiveCarries++; carry.counted = true; }
      if (carry.previousProgress < 2 / 3 && owner.progress >= 2 / 3) counts.finalThirdEntries++;
      if (carry.previousBox === false && inBox(owner)) counts.boxEntries++;
      carry.previousProgress = owner.progress; carry.previousBox = inBox(owner);
    },
    snapshot: () => ({ counts: { ...counts }, byLength, byThird, decisions })
  };
}
