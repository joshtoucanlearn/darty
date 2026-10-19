// Offline calibration: how far does a Ball V2 pass travel for a given launch?
// Reports, per lift angle and speed, where the ball first comes down through
// contact height (1.45 m) and its first bounce, plus time taken.
const Ball = require('../match-engine/ball-engine-v2.js');
const TICK = 1 / 60;
function fly(speed, lift) {
  const launch = Ball.resolveLaunch({ id: 'cal', origin: { x: 20, y: 0, z: 0.11 }, direction: { x: 1, y: 0 }, speed, liftAngleDeg: lift,
    sideSpinRpm: 0, topSpinRpm: 0, source: lift > 0 ? 'long-pass' : 'ground-pass', metadata: {} });
  let state = launch.state, context = Ball.createSimulationContext({ seed: 1 });
  const env = { colliders: [], groundEnabled: true };
  let wasHigh = false, down = null, bounce = null, t = 0, prevZ = state.position.z, vz = 0;
  const per = Math.round(TICK / Ball.DEFAULT_CONFIG.maxSubstep);
  const at = {};
  for (let tick = 1; tick <= 360; tick++) {
    const stepped = Ball.step(state, context, TICK, env); state = stepped.state; context = stepped.context; t = tick;
    const z = state.position.z, x = state.position.x - 20;
    if (z > 1.45) wasHigh = true;
    if (wasHigh && !down && z <= 1.45) down = { x: +x.toFixed(1), tick };
    if (!bounce && tick > 3 && state.velocity.z > 0 && prevZ < 0.2 && lift > 0) bounce = { x: +x.toFixed(1), tick };
    prevZ = z;
    for (const s of [60, 90, 120, 150, 180, 210]) if (tick === s) at[s] = +x.toFixed(1);
    if (state.settled) break;
  }
  return { down, bounce, at, stop: +(state.position.x - 20).toFixed(1), stopTick: t };
}
for (const lift of [0, 8, 15, 22, 28, 35]) {
  for (const speed of [10, 14, 18, 21, 23, 25, 27, 29, 31]) {
    const r = fly(speed, lift);
    console.log(`lift ${String(lift).padStart(2)} v ${String(speed).padStart(2)}  down@${r.down ? r.down.x + 'm/' + r.down.tick + 't' : '-'}  bounce@${r.bounce ? r.bounce.x + 'm' : '-'}  x@1s ${r.at[60]} 1.5s ${r.at[90]} 2s ${r.at[120]} 2.5s ${r.at[150]} 3s ${r.at[180]} 3.5s ${r.at[210]}  stop ${r.stop}m@${r.stopTick}t`);
  }
}
