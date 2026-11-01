// Shared scenario sources for the woodwork proof and its test. Each string runs inside the match host
// (scenario() evaluates in the host closure), so it can read the live match but is written to touch only the ball,
// one shooter and the keeper, exactly as a shot from the CPU would.
// Setup runs inside the match host (scenario() evaluates in its closure).
export const setupSource = spec => `(() => {
  const spec = ${JSON.stringify(spec)};
  const xPer = (W - 2 * M) / 105, yPer = H / 68, zPer = PITCH_UNITS_PER_METRE;
  const shootingTeam = (spec.end === 'right') === (attackDirection('you') === 1) ? 'you' : 'opp';
  const dir = attackDirection(shootingTeam), goalX = dir > 0 ? W - M : M;
  const outfield = teamList(shootingTeam).filter(p => !p.isGK && !p.sentOff);
  const shooter = outfield.slice().sort((a, b) => Math.abs(a.x - goalX) - Math.abs(b.x - goalX))[0];
  const keeper = shootingTeam === 'you' ? okeep : ykeep;
  // Move the keeper well out of the rebound's way so the first contact is a field player's to win.
  keeper.x = goalX - dir * 34 * xPer; keeper.y = H / 2 + (spec.post === 'low' ? 1 : -1) * 18 * yPer; keeper.vx = keeper.vy = 0;
  const originX = goalX - dir * spec.distanceMetres * xPer, originY = H / 2 + spec.originOffsetMetres * yPer;
  const originalAssignment = __races.assignment;
  __races.assignment = function (projection) { window.__lastRecovery = (projection.recoveryAssignments || []).map(row => ({ id: row.playerId, authority: row.authority, urgency: row.urgency, eta: row.etaSeconds })); return originalAssignment.call(this, projection); };
  const Ball = window.FootballLegacyBallEngineV2;
  const frame = [...Ball.createGoalFrame({ id: 'home-goal-v2', leftPostBase: { x: 0, y: -3.66, z: 0 }, rightPostBase: { x: 0, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 }),
    ...Ball.createGoalFrame({ id: 'away-goal-v2', leftPostBase: { x: 105, y: -3.66, z: 0 }, rightPostBase: { x: 105, y: 3.66, z: 0 }, height: 2.44, postRadius: 0.06 })];
  const environment = { colliders: frame, groundEnabled: true };
  const metricX = dir > 0 ? 105 - spec.distanceMetres : spec.distanceMetres, metricY = spec.originOffsetMetres;
  const metricDirX = dir > 0 ? 1 : -1;
  // Find a launch that really strikes the requested part of the frame (the physics decides, not the script).
  let chosen = null;
  const wanted = spec.target === 'crossbar' ? 'crossbar' : 'goal-post';
  const wantsIn = spec.target === 'post-in';
  const aimMetres = spec.target === 'crossbar' ? [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2] : wantsIn ? [-0.05, -0.08, -0.11, -0.14, -0.17, -0.2, -0.24, -0.28] : [0, 0.03, -0.03, 0.06, -0.06, 0.1, -0.1, 0.14, -0.14];
  search:
  for (const lateralBias of aimMetres) for (let lift = spec.target === 'crossbar' ? 4 : 0; lift <= (spec.target === 'crossbar' ? 26 : 3); lift += spec.target === 'crossbar' ? 0.25 : 0.5) {
    const postY = (spec.target === 'crossbar' ? lateralBias : (spec.post === 'low' ? -3.66 : 3.66) + (spec.post === 'low' ? -lateralBias : lateralBias));
    const dx = (dir > 0 ? 105 : 0) - metricX, dy = postY - metricY, length = Math.hypot(dx, dy);
    const direction = { x: dx / length, y: dy / length, z: 0 };
    const resolved = Ball.resolveLaunch({ id: 'woodwork-search', origin: { x: metricX, y: metricY, z: 0.11 }, direction, speed: spec.speedMetresPerSecond, liftAngleDeg: lift, sideSpinRpm: 0, topSpinRpm: 0, axialSpinRpm: 0, source: 'shot' });
    let state = resolved.state, context = Ball.createSimulationContext({ seed: 7 });
    for (let tick = 0; tick < 120; tick++) {
      const stepped = Ball.step(state, context, 1 / 60, environment); state = stepped.state; context = stepped.context;
      const hit = stepped.trace.events.find(event => event.type === 'contact' && (event.colliderRole === 'goal-post' || event.colliderRole === 'crossbar'));
      if (hit) {
        if (wantsIn) {
          // Keep stepping: the rebound must carry the ball back across the goal line between the posts and under the bar.
          let inside = false;
          for (let after = 0; after < 90 && !inside; after++) {
            const next = Ball.step(state, context, 1 / 60, environment); state = next.state; context = next.context;
            const crossed = dir > 0 ? state.position.x > 105 : state.position.x < 0;
            if (crossed) { inside = Math.abs(state.position.y) < 3.55 && state.position.z < 2.33; break; }
            if (state.position.x < -1 || state.position.x > 106) break;
          }
          if (hit.colliderRole === 'goal-post' && inside) { chosen = { direction, lift, postY, hit: hit.colliderRole, tick }; break search; }
          break;
        }
        if (hit.colliderRole === wanted && Math.abs(state.velocity.x) > 3) { chosen = { direction, lift, postY, hit: hit.colliderRole, tick }; break search; } break;
      }
      if (state.position.x < -1 || state.position.x > 106 || state.position.z < 0.05 && tick > 3) break;
    }
  }
  if (!chosen) return { ok: false, reason: 'no launch found for ' + JSON.stringify(spec) };
  ball.owner = null; ball.target = null;
  const origin = { x: M + metricX * xPer, y: originY, z: 0 };
  ball.x = origin.x; ball.y = origin.y; ball.z = 0; ball.vx = ball.vy = ball.zv = 0;
  const targetPoint = { x: goalX, y: H / 2 + chosen.postY * yPer };
  const release = liveV2QueueLaunch(shooter, targetPoint, { origin, speedWorld: 1, loftWorld: 0, flightType: 'shot' });
  release.direction = { x: chosen.direction.x, y: chosen.direction.y };
  release.speedMetresPerSecond = spec.speedMetresPerSecond; release.liftAngleDeg = chosen.lift;
  const horizontal = spec.speedMetresPerSecond * Math.cos(chosen.lift * Math.PI / 180), vertical = spec.speedMetresPerSecond * Math.sin(chosen.lift * Math.PI / 180);
  ball.vx = chosen.direction.x * horizontal * xPer / 60; ball.vy = chosen.direction.y * horizontal * yPer / 60; ball.zv = vertical * zPer / 60;
  ball.isShot = true; ball.shooter = shooter; ball.shotType = 'normal'; ball.flightType = 'shot'; ball.lastKicker = shooter; ball.aerialSource = shooter;
  ball.onTargetCounted = false; ball.cool = 6; ball.kickerLock = 24; ball.keeperBypassId = null; ball.keeperBypassUntil = 0;
  lastTouch = shooter.team; lastTouchPlayer = shooter; poss = 8;
  return { ok: true, shootingTeam, shooterId: shooter.id, goalX, dir, chosen: { lift: chosen.lift, postY: chosen.postY, hit: chosen.hit, predictedTick: chosen.tick }, keeperId: keeper.id };
})()`;

export const sampleSource = `(() => {
  const xPer = (W - 2 * M) / 105, yPer = H / 68;
  const players = [...you, ...opp].filter(p => !p.isGK && !p.sentOff).map(p => ({ id: p.id, team: p.team, x: p.x, y: p.y,
    speed: Math.hypot(p.vx * 60 / xPer, p.vy * 60 / yPer), gait: p.gait || '', dist: Math.hypot((p.x - ball.x) / xPer, (p.y - ball.y) / yPer) }));
  players.sort((a, b) => a.dist - b.dist);
  return { ball: { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx * 60 / xPer, vy: ball.vy * 60 / yPer, zv: ball.zv * 60 / PITCH_UNITS_PER_METRE, isShot: !!ball.isShot, flightType: ball.flightType || null,
      shooter: ball.shooter && ball.shooter.id || null, owner: ball.owner && ball.owner.id || null, lastTouch: lastTouchPlayer && lastTouchPlayer.id || null },
    recovery: window.__lastRecovery || [],
    woodwork: report.events.filter(e => e.type === 'woodwork').map(e => ({ frame: e.frame, woodwork: e.woodwork, team: e.team })),
    near: players.slice(0, 6).map(p => ({ id: p.id, team: p.team, dist: +p.dist.toFixed(2), speed: +p.speed.toFixed(2), gait: p.gait })) };
})()`;


export const hookSource = `(() => {
  const original = __races.assignment;
  window.__frameContacts = [];
  __races.assignment = function (projection) {
    window.__lastRecovery = (projection.recoveryAssignments || []).map(row => ({ id: row.playerId, authority: row.authority, urgency: row.urgency, eta: row.etaSeconds }));
    const events = projection.ballTrace && projection.ballTrace.events || [];
    window.__lastFrameContact = events.find(event => event.type === 'contact' && (event.colliderRole === 'goal-post' || event.colliderRole === 'crossbar')) || null;
    return original.call(this, projection);
  };
  return true;
})()`;
