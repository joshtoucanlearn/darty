// Aggregate the real-host observations without averaging percentages per seed.
// node tools/midfield-report.mjs output.json run.jsonl [continuation.jsonl ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function aggregateMatches(rows) {
  const ids = rows.map(row => row.seed);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate seeds');
  const count = rows.length;
  const sum = fn => rows.reduce((total, row) => total + fn(row), 0);
  const total = { passes: sum(r => r.cohesion.passes.attempted), completed: sum(r => r.cohesion.passes.completed),
    lofted: sum(r => r.cohesion.passes.lofted), loftedCompleted: sum(r => r.cohesion.passes.loftedCompleted),
    shots: sum(r => r.matchStats.reduce((s, t) => s + t.shots, 0)),
    onTarget: sum(r => r.matchStats.reduce((s, t) => s + t.onTarget, 0)),
    goals: sum(r => r.score.reduce((s, g) => s + g, 0)),
    fouls: sum(r => r.matchStats.reduce((s, t) => s + t.fouls, 0)),
    offsides: sum(r => r.matchStats.reduce((s, t) => s + t.offsides, 0)),
    finalThirdEntries: sum(r => r.cohesion.progression.completedIntoFinalThird),
    looseRecoveries: sum(r => r.cohesion.contests.looseRecoveries),
    midfieldSecondBallWins: sum(r => r.cohesion.contests.midfieldWins) };
  const weighted = section => {
    const keys = [...new Set(rows.flatMap(r => Object.keys(r.cohesion[section])))];
    return Object.fromEntries(keys.map(key => {
      let samples = 0, value = 0;
      for (const row of rows) {
        const metric = row.cohesion[section][key];
        if (!metric || !Number.isFinite(metric.mean)) continue;
        const weight = metric.samples ?? row.cohesion.shapeSamples;
        samples += weight; value += metric.mean * weight;
      }
      return [key, samples ? value / samples : null];
    }));
  };
  return { matches: count, seeds: ids, minutes: [...new Set(rows.map(r => r.minutes))],
    gates: [...new Map(rows.map(r => [JSON.stringify(r.gates), r.gates])).values()],
    fullTime: rows.filter(r => r.fullTimeReached).length,
    stalledSeeds: rows.filter(r => r.stalled || !r.fullTimeReached).map(r => r.seed),
    maximumLiveCommitGap: Math.max(...rows.map(r => r.progress.maximumLiveTicksWithoutCommit)),
    totals: total,
    metrics: { passes: total.passes / count, passCompletionPct: total.completed / total.passes * 100,
      shots: total.shots / count, onTarget: total.onTarget / count, goals: total.goals / count, fouls: total.fouls / count,
      loftedSharePct: total.lofted / total.passes * 100, loftedCompletionPct: total.loftedCompleted / total.lofted * 100,
      finalThirdEntries: total.finalThirdEntries / count,
      midfieldSecondBallWins: total.midfieldSecondBallWins / count,
      midfieldSecondBallWinSharePct: total.midfieldSecondBallWins / total.looseRecoveries * 100,
      ...weighted('shape'), ...weighted('midfield'), ...weighted('support') },
    sourceHashes: [...new Map(rows.map(r => [JSON.stringify(r.sourceHashes), r.sourceHashes])).values()],
    definitions: {
      shape: 'Original cohesion definition: actual defending outfield shape every 60 live ticks, sample-weighted metres.',
      midfield: 'Actual midfield line to defence/attack centroids and lateral distance from ball, split by possession.',
      shortOptions: 'Teammates 3–18 m from a logical carrier with no opposing outfielder within 1.5 m of the interior passing segment; geometric availability.',
      supportAngle: 'Largest angular separation between clear short midfield options, degrees; fewer than two = zero.',
      secondBall: 'Control following >= 6 consecutive live ticks unowned and without a named target; logical dribble leases and authored pass receptions excluded.',
      finalThird: 'Completed host passes starting outside and ending inside the attacking final third.',
      nearBall: 'Both teams active outfielders within 5 m, sampled in live play; repeated per-team observations have equal weight.'
    },
    perSeed: rows.map(r => ({ seed: r.seed, fullTimeReached: r.fullTimeReached, score: r.score,
      matchStats: r.matchStats, cohesion: r.cohesion, progress: r.progress })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...files] = process.argv.slice(2);
  const rows = files.flatMap(file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
  const report = aggregateMatches(rows);
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ matches: report.matches, fullTime: report.fullTime, metrics: report.metrics }, null, 2));
}
