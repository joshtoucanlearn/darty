import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeActions, compareMatches } from '../tools/combination-report.mjs';

test('unrecorded baseline actions stay unknown rather than becoming measured zeroes', () => {
  assert.equal(summarizeActions([{}]).recorded, false);
  assert.equal(summarizeActions([{}]).totals, null);
  assert.throws(() => summarizeActions([{}, { actions: {} }]), /mixed action coverage/);
});
test('length and third completion use pooled attempts, not an average of seed percentages', () => {
  const row = (attempted, completed, duels) => ({ actions: { counts: { aerialDuelsContested: duels },
    byLength: { long: { attempted, completed } }, byThird: { middle: { attempted, completed } } } });
  const result = summarizeActions([row(1, 1, 2), row(9, 0, 4)]);
  assert.equal(result.byLength.long.completionPct, 10);
  assert.equal(result.byThird.middle.completionPct, 10);
  assert.equal(result.perMatch.aerialDuelsContested, 3);
});
test('paired reports reject duplicate, missing, shortened and mixed-source candidates', () => {
  const r = (seed, sourceHashes = { engine: 'a' }) => ({ seed, minutes: 6, sourceHashes });
  assert.throws(() => compareMatches([r(1)], [r(1), r(1)]), /pair uniquely/);
  assert.throws(() => compareMatches([r(1)], [r(2)]), /pair uniquely/);
  assert.throws(() => compareMatches([r(1)], [{ ...r(1), minutes: 2 }]), /six-minute/);
  assert.throws(() => compareMatches([r(1), r(2)], [r(1), r(2, { engine: 'b' })]), /source changed/);
});
