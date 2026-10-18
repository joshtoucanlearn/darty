/* Paste into DevTools after a CPU vs CPU match loads. Observation only.
 * Collects ordinary browser play, never invokes debug scenes or instantResult.
 * Does not seed Math.random or replace clocks. Equal V2 seeds do not make the
 * complete host deterministic. Stop/export: DartyAuditCapture.finish().
 */
(() => {
  if (!window.FLMatch) throw new Error('Launch through Quick Play first');
  if (window.DartyAuditCapture) throw new Error('Capture already present');
  const events = new Map(), samples = [], errors = [];
  const onError = event => errors.push(String(event.message || event.reason));
  addEventListener('error', onError);
  addEventListener('unhandledrejection', onError);
  let timer;
  function sample() {
    const state = FLMatch.getState(), report = FLMatch.getReport();
    for (const event of report.events || []) events.set(event.seq, event);
    samples.push({ at: performance.now(), state,
      authority: window.FLLiveV2?.status?.() || null });
    if (state.phase === 'ended') clearInterval(timer);
  }
  sample();
  timer = setInterval(sample, 500);
  window.DartyAuditCapture = Object.freeze({
    finish() {
      clearInterval(timer);
      sample();
      removeEventListener('error', onError);
      removeEventListener('unhandledrejection', onError);
      return { scope: 'ordinary browser CPU vs CPU; 500ms observation samples',
        href: location.href, device: navigator.userAgent, errors,
        report: FLMatch.getReport(), summary: FLMatch.getPlaytestSummary(),
        events: [...events.values()].sort((a, b) => a.seq - b.seq), samples };
    }
  });
})();
