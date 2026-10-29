// Reproduce the paired gate from archived baseline rows; never rerun baseline.
// node tools/combination-report.mjs output.json baseline.jsonl candidate.jsonl [rest.jsonl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateMatches } from './midfield-report.mjs';

export function summarizeActions(rows) {
  const measured = rows.filter(row => row.actions);
  if (!measured.length) return { recorded: false, totals: null, perMatch: null, byLength: null, byThird: null };
  if (measured.length !== rows.length) throw new Error('mixed action coverage is not comparable');
  const totals = {}, byLength = {}, byThird = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.actions.counts)) totals[key] = (totals[key] || 0) + value;
    for (const [name, map] of [['byLength', byLength], ['byThird', byThird]]) {
      for (const [key, value] of Object.entries(row.actions[name])) {
        map[key] ||= { attempted: 0, completed: 0 };
        map[key].attempted += value.attempted; map[key].completed += value.completed;
      }
    }
  }
  for (const map of [byLength, byThird]) for (const value of Object.values(map)) {
    value.completionPct = value.attempted ? value.completed / value.attempted * 100 : null;
    value.attemptsPerMatch = value.attempted / rows.length;
  }
  return { recorded: true, totals, perMatch: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / rows.length])), byLength, byThird };
}

export function compareMatches(baseline, candidate) {
  const ids = candidate.map(row => row.seed), selected = baseline.filter(row => ids.includes(row.seed));
  if (new Set(ids).size !== ids.length || new Set(selected.map(row => row.seed)).size !== ids.length || selected.length !== ids.length) {
    throw new Error('candidate and baseline seeds must pair uniquely');
  }
  if (candidate.some(row => row.minutes !== 6) || selected.some(row => row.minutes !== 6)) throw new Error('six-minute gate required');
  const hashes = new Set(candidate.map(row => JSON.stringify(row.sourceHashes)));
  if (hashes.size !== 1) throw new Error('candidate source changed inside the gate');
  const summary = rows => ({ ...aggregateMatches(rows), actions: summarizeActions(rows),
    redCards: rows.reduce((n, row) => n + row.redCards.reduce((a, b) => a + b, 0), 0) / rows.length,
    secondBallRecoveries: rows.reduce((n, row) => n + row.cohesion.contests.looseRecoveries, 0) / rows.length });
  return { baselineReused: true, before: summary(selected), after: summary(candidate),
    definitions: { missing: 'Unrecorded baseline actions and pass splits are null, never zero.',
      aerialDuels: 'Physical V2 aerial contacts with an opposing eligible challenger; winners split by team and delivery source.',
      secondBalls: 'Original loose recoveries require at least six unowned untargeted live ticks; aerial-specific recoveries are separately labelled.',
      completion: 'Terminal same-team control or deliberate first-time/heading contact; second-ball retention is separate.' } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, baselineFile, ...candidateFiles] = process.argv.slice(2);
  const read = file => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const result = compareMatches(read(baselineFile), candidateFiles.flatMap(read));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ matches: result.after.matches, fullTime: result.after.fullTime,
    stalledSeeds: result.after.stalledSeeds, metrics: result.after.metrics, actions: result.after.actions.perMatch }, null, 2));
}
