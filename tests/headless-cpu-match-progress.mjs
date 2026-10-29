import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommitProgressMonitor, countsAsFullTime } from '../tools/headless-cpu-match.mjs';

const ended = monitor => ({ phase: 'ended', halfTime: true, fullTime: true,
  authority: { failureCode: null }, progress: monitor.snapshot() });

test('a clock-only finish fails qualification even after commits resume and the watchdog reports no fault', () => {
  const monitor = createCommitProgressMonitor();
  for (let tick = 0; tick < 300; tick++) monitor.observe(true, 0);
  for (let tick = 0; tick < 1000; tick++) monitor.observe(false, 0);
  for (let tick = 0; tick < 300; tick++) monitor.observe(true, 0);
  monitor.observe(true, 1);
  const state = ended(monitor);
  assert.equal(state.progress.maximumLiveTicksWithoutCommit, 600);
  assert.equal(state.progress.stallWindows.length, 1);
  assert.equal(countsAsFullTime(state), false);
});

test('regular commits and a bounded keeper hold qualify through both periods', () => {
  const monitor = createCommitProgressMonitor();
  for (let tick = 1; tick <= 300; tick++) monitor.observe(true, tick);
  for (let tick = 0; tick < 300; tick++) monitor.observe(true, 300);
  for (let tick = 301; tick <= 600; tick++) monitor.observe(true, tick);
  assert.equal(monitor.snapshot().maximumLiveTicksWithoutCommit, 300);
  assert.equal(countsAsFullTime(ended(monitor)), true);
  assert.equal(countsAsFullTime(ended(monitor), { capped: true }), false);
  assert.equal(countsAsFullTime(ended(monitor), { stalled: true }), false);
});

test('a finish without observed live play and gameplay commits cannot qualify', () => {
  const monitor = createCommitProgressMonitor();
  for (let tick = 0; tick < 1200; tick++) monitor.observe(false, 0);
  assert.equal(countsAsFullTime(ended(monitor)), false);
});
