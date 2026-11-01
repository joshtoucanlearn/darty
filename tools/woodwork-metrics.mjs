// Woodwork metrics for the headless match: how often the ball comes off the post or bar, and what happens next.
// Pure observer: it reads logged events, Ball V2's tick trace and a clock, and never touches match state.
const FOLLOW_UP = new Set(['possession-gained', 'reception', 'pass', 'pass-contact', 'shot', 'goal', 'keeper-save', 'keeper-claim', 'keeper-deflection',
  'keeper-hand-contact', 'block', 'involuntary-body-deflection', 'shot-off-target', 'restart', 'v2-aerial-contact', 'v2-tackle-contact']);

export function createWoodworkMetrics({ reboundWindowMs = 4000 } = {}) {
  const hits = [];
  const frameContacts = { total: 0, post: 0, crossbar: 0 };
  const close = (hit, event, time) => {
    if (hit.firstFollowUp || !FOLLOW_UP.has(event.type)) return;
    const gap = time - hit.time;
    if (gap > reboundWindowMs) { hit.expired = true; return; }
    const keeperEvent = event.type.startsWith('keeper-');
    hit.firstFollowUp = { type: event.type, team: event.team || null, afterMs: Math.round(gap),
      side: keeperEvent ? 'defenders' : !hit.team || !event.team ? 'unknown' : event.team === hit.team ? 'attackers' : 'defenders' };
  };
  return {
    // Every goal-frame contact Ball V2 reports in its tick trace, whether or not the host did anything with it.
    frame(projection) {
      const events = projection && projection.ballTrace && projection.ballTrace.events || [];
      for (const event of events) {
        if (!event || event.type !== 'contact' || (event.colliderRole !== 'goal-post' && event.colliderRole !== 'crossbar')) continue;
        frameContacts.total += 1; frameContacts[event.colliderRole === 'crossbar' ? 'crossbar' : 'post'] += 1;
      }
    },
    event(event) {
      const time = Number(event.time) || 0;
      for (const hit of hits) {
        if (hit.expired || time - hit.time > reboundWindowMs) { hit.expired = true; continue; }
        if (event.type === 'shot' && !hit.reboundShot) hit.reboundShot = { team: event.team || null, afterMs: Math.round(time - hit.time), byAttackers: !!hit.team && event.team === hit.team };
        if (event.type === 'goal' && !hit.reboundGoal) hit.reboundGoal = { team: event.team || null, afterMs: Math.round(time - hit.time) };
        close(hit, event, time);
      }
      if (event.type === 'woodwork') hits.push({ time, kind: event.woodwork || null, team: event.team || null, shooterId: event.actorId || null,
        authority: event.authority || null, firstFollowUp: null, reboundShot: null, reboundGoal: null, expired: false });
    },
    snapshot() {
      const sides = { attackers: 0, defenders: 0, unknown: 0, none: 0 };
      for (const hit of hits) sides[hit.firstFollowUp ? hit.firstFollowUp.side : 'none'] += 1;
      const reach = hits.filter(hit => hit.firstFollowUp).map(hit => hit.firstFollowUp.afterMs).sort((a, b) => a - b);
      return {
        schema: 'darty-woodwork-metrics-v1', reboundWindowMs,
        frameContacts: { ...frameContacts },
        hits: hits.length,
        byKind: { post: hits.filter(hit => hit.kind === 'post').length, crossbar: hits.filter(hit => hit.kind === 'crossbar').length },
        byShootingTeam: { you: hits.filter(hit => hit.team === 'you').length, opp: hits.filter(hit => hit.team === 'opp').length, unknown: hits.filter(hit => !hit.team).length },
        reboundShots: hits.filter(hit => hit.reboundShot).length,
        reboundShotsByAttackers: hits.filter(hit => hit.reboundShot && hit.reboundShot.byAttackers).length,
        reboundGoals: hits.filter(hit => hit.reboundGoal).length,
        firstReachedBy: sides,
        medianMsToFirstReach: reach.length ? reach[Math.floor((reach.length - 1) / 2)] : null,
        rows: hits.slice(0, 30).map(hit => ({ atMs: Math.round(hit.time), kind: hit.kind, team: hit.team, shooterId: hit.shooterId, authority: hit.authority,
          firstFollowUp: hit.firstFollowUp, reboundShot: hit.reboundShot, reboundGoal: hit.reboundGoal }))
      };
    }
  };
}
