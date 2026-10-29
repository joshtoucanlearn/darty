import test from 'node:test';
import assert from 'node:assert/strict';
import { createCohesionMetrics } from '../tools/cohesion-metrics.mjs';

test('cohesion observations pair terminal outcomes with the actual delivery without changing attempt counts', () => {
  const metrics = createCohesionMetrics();
  metrics.event({ type: 'pass', loft: 3 });
  metrics.event({ type: 'pass-contact', completed: true });
  metrics.event({ type: 'pass-resolved', completed: false });
  metrics.event({ type: 'pass', loft: 0 });
  metrics.event({ type: 'pass-resolved', completed: true });
  metrics.event({ type: 'pass', loft: 2 });
  metrics.event({ type: 'pass-resolved', completed: true });
  metrics.event({ type: 'pass', loft: 1 });
  assert.deepEqual(metrics.snapshot().passes, { attempted: 4, completed: 2, lofted: 3, loftedCompleted: 1, unresolved: 1 });
});

test('shape observations use active defenders and midfielders of the defending team in metres', () => {
  const metrics = createCohesionMetrics();
  const players = [
    { team: 'you', family: 'centre-back', x: 20, y: 0 },
    { team: 'you', family: 'full-back', x: 22, y: 12 },
    { team: 'you', family: 'central-midfielder', x: 34, y: 6 },
    { team: 'you', family: 'striker', x: 46, y: 6 },
    { team: 'you', family: 'centre-back', x: 0, y: 80, sentOff: true },
    { team: 'you', family: 'goalkeeper', x: 4, y: 0, isGK: true }
  ];
  metrics.sample({ players, possessionTeam: 'opp', ball: { y: 16 } });
  const result = metrics.snapshot();
  assert.equal(result.shapeSamples, 1);
  for (const [key, expected] of Object.entries({ backLineDepthSpread: 2, defenceMidfieldGap: 13,
    teamLength: 26, teamWidth: 12, lateralBallDistance: 10, backLineLargestLateralGap: 12 })) {
    assert.deepEqual(result.shape[key], { mean: expected, p90: expected });
  }
  metrics.sample({ players, possessionTeam: 'you', ball: { y: 16 } });
  assert.equal(metrics.snapshot().shapeSamples, 1);
});
