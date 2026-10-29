// Read-only observations of the real host; distances are metres.
export function createCohesionMetrics() {
  const samples = [], passes = { attempted: 0, completed: 0, lofted: 0, loftedCompleted: 0, unresolved: 0 };
  let pending = null, looseTicks = 0;
  const midfieldSamples = [], supportSamples = [];
  const contests = { looseRecoveries: 0, midfieldWins: 0 }, progression = { completedIntoFinalThird: 0 };
  const isMidfield = p => ['defensive-midfielder', 'central-midfielder', 'wide-midfielder', 'attacking-midfielder'].includes(p.family);
  const mean = (rows, key) => rows.reduce((sum, p) => sum + p[key], 0) / rows.length;
  const summarize = rows => Object.fromEntries(Object.keys(rows[0] || {}).map(key => {
    const values = rows.map(row => row[key]).filter(Number.isFinite).sort((a, b) => a - b);
    return [key, { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      p90: values.length ? values[Math.floor(values.length * .9)] : null, samples: values.length }];
  }));
  return {
    // Observe every live tick: an unowned, unauthored ball for >= six ticks,
    // followed by physical/logical control. Pass receptions are excluded.
    possession({ owner, loose }) {
      if (owner) {
        if (looseTicks >= 6) { contests.looseRecoveries++; if (isMidfield(owner)) contests.midfieldWins++; }
        looseTicks = 0;
      } else looseTicks = loose ? looseTicks + 1 : 0;
    },
    event(event) {
      if (event.type === 'pass') {
        pending = { lofted: event.loft > 0, progress: event.progress };
        passes.attempted++;
        if (pending.lofted) passes.lofted++;
      } else if (event.type === 'pass-resolved' && pending) {
        if (event.completed) {
          passes.completed++;
          if (pending.lofted) passes.loftedCompleted++;
          if (pending.progress < 2 / 3 && event.progress >= 2 / 3) progression.completedIntoFinalThird++;
        }
        pending = null;
      }
    },
    sample({ players, ball, possessionTeam, ownerId }) {
      for (const team of ['you', 'opp']) {
        const active = players.filter(p => p.team === team && !p.sentOff && !p.isGK);
        const midfield = active.filter(isMidfield);
        const defence = active.filter(p => ['centre-back', 'full-back', 'wing-back'].includes(p.family));
        const attack = active.filter(p => ['striker', 'winger'].includes(p.family));
        if (!midfield.length || !defence.length) continue;
        const prefix = possessionTeam === team ? 'attacking' : 'defending';
        midfieldSamples.push({ [prefix + 'DefenceGap']: Math.abs(mean(defence, 'x') - mean(midfield, 'x')),
          [prefix + 'AttackGap']: attack.length ? Math.abs(mean(attack, 'x') - mean(midfield, 'x')) : null,
          [prefix + 'LateralBallDistance']: Math.abs(mean(midfield, 'y') - ball.y),
          playersWithinFiveMetres: players.filter(p => !p.sentOff && !p.isGK && Math.hypot(p.x - ball.x, p.y - ball.y) <= 5).length });
      }
      const owner = players.find(p => p.id === ownerId);
      if (owner) {
        const mates = players.filter(p => p.team === owner.team && p.id !== owner.id && !p.sentOff && !p.isGK);
        const midfield = mates.filter(isMidfield);
        const opponents = players.filter(p => p.team !== owner.team && !p.sentOff && !p.isGK);
        const short = mates.filter(p => {
          const dx = p.x - owner.x, dy = p.y - owner.y, d = Math.hypot(dx, dy);
          return d >= 3 && d <= 18 && !opponents.some(o => {
            const t = ((o.x - owner.x) * dx + (o.y - owner.y) * dy) / (d * d);
            return t > 0 && t < 1 && Math.hypot(o.x - owner.x - t * dx, o.y - owner.y - t * dy) < 1.5;
          });
        });
        const angles = short.filter(isMidfield).map(p => Math.atan2(p.y - owner.y, p.x - owner.x));
        let spread = 0;
        for (const a of angles) for (const b of angles) spread = Math.max(spread, Math.acos(Math.cos(a - b)) * 180 / Math.PI);
        supportSamples.push({ shortOptions: short.length, midfieldShortOptions: short.filter(isMidfield).length,
          midfieldCarrierDistance: midfield.length ? midfield.reduce((s, p) => s + Math.hypot(p.x - owner.x, p.y - owner.y), 0) / midfield.length : null,
          midfieldSupportAngleDegrees: spread });
      }
      for (const team of ['you', 'opp']) {
        if (!possessionTeam || possessionTeam === team) continue;
        const active = players.filter(p => p.team === team && !p.sentOff && !p.isGK);
        const defence = active.filter(p => ['centre-back', 'full-back', 'wing-back'].includes(p.family));
        const midfield = active.filter(p => ['defensive-midfielder', 'central-midfielder', 'wide-midfielder', 'attacking-midfielder'].includes(p.family));
        if (defence.length < 2 || !midfield.length) continue;
        const mean = (rows, key) => rows.reduce((sum, p) => sum + p[key], 0) / rows.length;
        const range = (rows, key) => Math.max(...rows.map(p => p[key])) - Math.min(...rows.map(p => p[key]));
        const sorted = defence.slice().sort((a, b) => a.y - b.y);
        samples.push({ backLineDepthSpread: range(defence, 'x'),
          defenceMidfieldGap: Math.abs(mean(defence, 'x') - mean(midfield, 'x')),
          teamLength: range(active, 'x'), teamWidth: range(active, 'y'),
          lateralBallDistance: Math.abs(mean(active, 'y') - ball.y),
          backLineLargestLateralGap: Math.max(...sorted.slice(1).map((p, i) => p.y - sorted[i].y)) });
      }
    },
    snapshot() {
      const shape = {};
      for (const key of Object.keys(samples[0] || {})) {
        const values = samples.map(row => row[key]).sort((a, b) => a - b);
        shape[key] = { mean: values.reduce((a, b) => a + b, 0) / values.length, p90: values[Math.floor(values.length * .9)] };
      }
      // Prefix-specific fields have different sample counts.
      const midfieldKeys = [...new Set(midfieldSamples.flatMap(Object.keys))];
      const midfield = Object.assign({}, ...midfieldKeys.map(key => summarize(midfieldSamples.map(row => ({ [key]: row[key] })))));
      return { passes: { ...passes, unresolved: pending ? 1 : 0 }, shapeSamples: samples.length, shape,
        midfield, support: summarize(supportSamples), contests: { ...contests }, progression: { ...progression } };
    }
  };
}
