// Checks the shot loft solver against Ball V2: launch at the solved upward speed,
// report the height when the ball reaches the goal-line distance.
const Ball = require('../match-engine/ball-engine-v2.js');
function solve(d, v, h) { const k = .0135, t = Math.max(.1, (Math.exp(k * d) - 1) / (k * v)), z0 = 1 / 31.32 + .11; return Math.min(14, Math.max(0, (h - z0 + 5.25 * t * t) / t * 1.04)); }
for (const v of [27, 30, 33, 36]) for (const d of [12, 18, 25, 30]) for (const h of [.6, 1.4, 2.0]) {
  const vz = solve(d, v, h), lift = Math.atan2(vz, v) * 180 / Math.PI;
  const launch = Ball.resolveLaunch({ id: 'h', origin: { x: 0, y: 0, z: 1 / 31.32 + .11 }, direction: { x: 1, y: 0 }, speed: Math.hypot(v, vz), liftAngleDeg: lift, sideSpinRpm: 0, topSpinRpm: 0, source: 'shot', metadata: {} });
  let s = launch.state, c = Ball.createSimulationContext({ seed: 1 }), hit = null, t = 0;
  for (let i = 0; i < 240 && !hit; i++) { const st = Ball.step(s, c, 1 / 60, { colliders: [], groundEnabled: true }); s = st.state; c = st.context; t++; if (s.position.x >= d) hit = { z: s.position.z, speed: Math.hypot(s.velocity.x, s.velocity.y), t }; }
  console.log(`v ${v} d ${d} target ${h}m -> lift ${lift.toFixed(1)} deg, at goal ${hit ? hit.z.toFixed(2) + 'm, ' + hit.speed.toFixed(1) + ' m/s, ' + (hit.t / 60).toFixed(2) + 's' : 'short'}`);
}
