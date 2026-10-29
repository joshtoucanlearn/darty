// Read-only observations of the real host; distances are metres.
export function createCohesionMetrics() {
  const samples = [], passes = { attempted: 0, completed: 0, lofted: 0, loftedCompleted: 0, unresolved: 0 };
  let pending = null;
  return {
    event(event) {
      if (event.type === 'pass') {
        pending = { lofted: event.loft > 0 };
        passes.attempted++;
        if (pending.lofted) passes.lofted++;
      } else if (event.type === 'pass-resolved' && pending) {
        if (event.completed) {
          passes.completed++;
          if (pending.lofted) passes.loftedCompleted++;
        }
        pending = null;
      }
    },
    sample({ players, ball, possessionTeam }) {
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
      return { passes: { ...passes, unresolved: pending ? 1 : 0 }, shapeSamples: samples.length, shape };
    }
  };
}
