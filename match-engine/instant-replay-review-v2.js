(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FootballLegacyInstantReplayReviewV2 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.0.0-pause-only';
  const CLIP_SCHEMA = 'football-legacy-instant-replay-review-v2-clip';
  const SPEEDS = Object.freeze([0.25, 0.5, 1, 2]);
  const AXES = Object.freeze(['dolly', 'pan', 'boom', 'tilt', 'truck', 'orbit']);
  const DEFAULT_LIMITS = Object.freeze({
    maximumDurationMs: 7000,
    minimumDurationMs: 250,
    maximumFrames: 220
  });
  const DEFAULT_CAMERA = Object.freeze({
    distance: 390,
    orbit: Math.PI / 2,
    pan: 0,
    tilt: 0,
    truck: 0,
    boom: 175,
    fov: 45
  });
  const CAMERA_LIMITS = Object.freeze({
    distance: Object.freeze([60, 900]),
    orbit: Object.freeze([-Math.PI, Math.PI]),
    pan: Object.freeze([-1.35, 1.35]),
    tilt: Object.freeze([-0.9, 0.75]),
    truck: Object.freeze([-650, 650]),
    boom: Object.freeze([24, 650]),
    fov: Object.freeze([24, 70])
  });
  const PLAYER_FIELDS = Object.freeze([
    'x', 'y', 'vx', 'vy', 'fx', 'fy', 'gait', 'action', 'actionT', 'slide',
    'stun', 'divePerformance', 'diveDuration', 'diveVariant', 'diveSide',
    'keeperAnimationDuration', 'keeperPose'
  ]);
  const BALL_FIELDS = Object.freeze(['x', 'y', 'z', 'vx', 'vy', 'zv', 'isShot']);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, Number(value) || 0));
  }

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function positiveInteger(value, fallback, maximum) {
    const number = Math.floor(Number(value));
    return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
  }

  function normaliseLimits(input) {
    const source = input && typeof input === 'object' ? input : {};
    const maximumDurationMs = clamp(
      finite(source.maximumDurationMs) ? source.maximumDurationMs : DEFAULT_LIMITS.maximumDurationMs,
      1000,
      DEFAULT_LIMITS.maximumDurationMs
    );
    const minimumDurationMs = clamp(
      finite(source.minimumDurationMs) ? source.minimumDurationMs : DEFAULT_LIMITS.minimumDurationMs,
      100,
      Math.min(1000, maximumDurationMs)
    );
    const maximumFrames = positiveInteger(source.maximumFrames, DEFAULT_LIMITS.maximumFrames, DEFAULT_LIMITS.maximumFrames);
    return Object.freeze({ maximumDurationMs, minimumDurationMs, maximumFrames });
  }

  function clonePlayer(source) {
    const player = source && typeof source === 'object' ? source : {};
    const result = {};
    for (const field of PLAYER_FIELDS) {
      const value = player[field];
      if (typeof value === 'number') result[field] = finite(value) ? Number(value) : 0;
      else if (typeof value === 'string') result[field] = value.slice(0, 64);
      else if (typeof value === 'boolean') result[field] = value;
      else result[field] = field === 'gait' || field === 'action' ? 'idle' : 0;
    }
    return Object.freeze(result);
  }

  function cloneBall(source) {
    const ball = source && typeof source === 'object' ? source : {};
    const result = {};
    for (const field of BALL_FIELDS) {
      if (field === 'isShot') result[field] = !!ball[field];
      else result[field] = finite(ball[field]) ? Number(ball[field]) : 0;
    }
    return Object.freeze(result);
  }

  function cloneFrame(source) {
    if (!source || !finite(source.t) || !source.ball || !Array.isArray(source.players)) return null;
    return Object.freeze({
      t: Number(source.t),
      players: Object.freeze(source.players.slice(0, 32).map(clonePlayer)),
      ball: cloneBall(source.ball)
    });
  }

  function createImmutableClip(inputFrames, options) {
    const limits = normaliseLimits(options);
    const source = Array.isArray(inputFrames) ? inputFrames : [];
    let rows = source.map(cloneFrame).filter(Boolean).sort((a, b) => a.t - b.t);
    if (!rows.length) {
      return Object.freeze({ available: false, reason: 'buffer-empty', schema: CLIP_SCHEMA, limits });
    }
    const latestAt = rows[rows.length - 1].t;
    rows = rows.filter(frame => frame.t >= latestAt - limits.maximumDurationMs);
    if (rows.length > limits.maximumFrames) rows = rows.slice(rows.length - limits.maximumFrames);
    const durationMs = rows.length > 1 ? rows[rows.length - 1].t - rows[0].t : 0;
    if (rows.length < 2 || durationMs < limits.minimumDurationMs) {
      return Object.freeze({
        available: false,
        reason: rows.length < 2 ? 'buffer-too-short' : 'duration-too-short',
        schema: CLIP_SCHEMA,
        frameCount: rows.length,
        durationMs,
        limits
      });
    }
    return Object.freeze({
      available: true,
      reason: null,
      schema: CLIP_SCHEMA,
      frames: Object.freeze(rows),
      frameCount: rows.length,
      durationMs,
      startsAt: rows[0].t,
      endsAt: rows[rows.length - 1].t,
      immutable: true,
      bounded: durationMs <= limits.maximumDurationMs && rows.length <= limits.maximumFrames,
      limits
    });
  }

  function wrapAngle(value) {
    const tau = Math.PI * 2;
    let angle = Number(value) || 0;
    while (angle > Math.PI) angle -= tau;
    while (angle < -Math.PI) angle += tau;
    return angle;
  }

  function createCameraState(input) {
    const source = input && typeof input === 'object' ? input : {};
    const state = {};
    for (const key of Object.keys(DEFAULT_CAMERA)) {
      const limits = CAMERA_LIMITS[key];
      const value = finite(source[key]) ? Number(source[key]) : DEFAULT_CAMERA[key];
      state[key] = key === 'orbit' ? wrapAngle(value) : limits ? clamp(value, limits[0], limits[1]) : value;
    }
    return state;
  }

  function adjustCameraState(input, axis, amount) {
    if (!AXES.includes(axis)) throw new RangeError('unknown instant-replay camera axis');
    const state = createCameraState(input);
    const delta = finite(amount) ? Number(amount) : 0;
    if (axis === 'dolly') state.distance = clamp(state.distance + delta, ...CAMERA_LIMITS.distance);
    else if (axis === 'orbit') state.orbit = wrapAngle(state.orbit + delta);
    else state[axis] = clamp(state[axis] + delta, ...CAMERA_LIMITS[axis]);
    return state;
  }

  function cameraPoseFromState(input, target) {
    const state = createCameraState(input);
    const focus = target && typeof target === 'object' ? target : {};
    const tx = finite(focus.x) ? Number(focus.x) : 0;
    const ty = finite(focus.y) ? Number(focus.y) : 0;
    const tz = finite(focus.z) ? Number(focus.z) : 0;
    const sideX = -Math.sin(state.orbit), sideZ = Math.cos(state.orbit);
    const px = tx + Math.cos(state.orbit) * state.distance + sideX * state.truck;
    const py = ty + state.boom;
    const pz = tz + Math.sin(state.orbit) * state.distance + sideZ * state.truck;
    const baseYaw = Math.atan2(tz - pz, tx - px), horizontal = Math.max(1, Math.hypot(tx - px, tz - pz));
    const yaw = baseYaw + state.pan, pitch = Math.atan2(ty - py, horizontal) + state.tilt;
    const lookDistance = Math.max(120, state.distance), planar = Math.cos(pitch) * lookDistance;
    return Object.freeze({
      position: Object.freeze({ x: px, y: py, z: pz }),
      lookAt: Object.freeze({
        x: px + Math.cos(yaw) * planar,
        y: py + Math.sin(pitch) * lookDistance,
        z: pz + Math.sin(yaw) * planar
      }),
      fov: state.fov,
      state: Object.freeze({ ...state })
    });
  }

  function sampleClip(clip, progress) {
    if (!clip || !clip.available || !clip.frames.length) return null;
    const cursor = clamp(progress, 0, 1), sourceT = clip.startsAt + clip.durationMs * cursor, frames = clip.frames;
    let low = 0, high = frames.length - 1;
    while (low < high - 1) {
      const middle = Math.floor((low + high) / 2);
      if (frames[middle].t <= sourceT) low = middle;
      else high = middle;
    }
    const a = frames[low], b = frames[Math.min(frames.length - 1, low + 1)], span = Math.max(1, b.t - a.t);
    return Object.freeze({ a, b, q: clamp((sourceT - a.t) / span, 0, 1), sourceT, progress: cursor, index: low });
  }

  function createReviewController(options) {
    const limits = normaliseLimits(options);
    let session = null;
    let camera = createCameraState();

    function status() {
      if (!session) return Object.freeze({ active: false, playing: false, progress: 0, speed: 1, restored: true });
      return Object.freeze({
        active: true,
        playing: session.playing,
        progress: session.progress,
        speed: session.speed,
        durationMs: session.clip.durationMs,
        frameCount: session.clip.frameCount,
        immutable: session.clip.immutable,
        bounded: session.clip.bounded,
        restored: session.restored,
        camera: Object.freeze({ ...camera })
      });
    }

    function inspect(frames) {
      return createImmutableClip(frames, limits);
    }

    function open(frames, hooks) {
      if (session) return Object.freeze({ opened: false, reason: 'already-open', ...status() });
      const clip = inspect(frames);
      if (!clip.available) return Object.freeze({ opened: false, reason: clip.reason, clip });
      const source = hooks && typeof hooks === 'object' ? hooks : {};
      session = {
        clip,
        progress: 0,
        playing: source.autoplay !== false,
        speed: SPEEDS.includes(Number(source.speed)) ? Number(source.speed) : 1,
        lastTickAt: finite(source.now) ? Number(source.now) : 0,
        restore: typeof source.restore === 'function' ? source.restore : null,
        restoreToken: source.restoreToken,
        restored: false
      };
      camera = createCameraState(source.camera);
      return Object.freeze({ opened: true, reason: null, ...status(), clip });
    }

    function seek(progress, pausePlayback) {
      if (!session) return status();
      session.progress = clamp(progress, 0, 1);
      if (pausePlayback !== false) session.playing = false;
      session.lastTickAt = 0;
      return status();
    }

    function nudge(milliseconds) {
      if (!session) return status();
      return seek(session.progress + Number(milliseconds || 0) / session.clip.durationMs, true);
    }

    function setPlaying(value, now) {
      if (!session) return status();
      session.playing = !!value;
      session.lastTickAt = finite(now) ? Number(now) : 0;
      return status();
    }

    function togglePlaying(now) {
      return setPlaying(session ? !session.playing : false, now);
    }

    function setSpeed(speed) {
      if (!session) return status();
      const value = Number(speed);
      if (!SPEEDS.includes(value)) throw new RangeError('unsupported instant-replay speed');
      session.speed = value;
      return status();
    }

    function cycleSpeed(direction) {
      if (!session) return status();
      const current = Math.max(0, SPEEDS.indexOf(session.speed)), step = Number(direction) < 0 ? -1 : 1;
      session.speed = SPEEDS[(current + step + SPEEDS.length) % SPEEDS.length];
      return status();
    }

    function tick(now) {
      if (!session) return status();
      const current = finite(now) ? Number(now) : 0;
      if (!session.lastTickAt) {
        session.lastTickAt = current;
        return status();
      }
      const elapsed = clamp(current - session.lastTickAt, 0, 100);
      session.lastTickAt = current;
      if (session.playing && elapsed > 0) {
        session.progress += elapsed * session.speed / session.clip.durationMs;
        if (session.progress >= 1) {
          session.progress = 1;
          session.playing = false;
        }
      }
      return status();
    }

    function sample() {
      return session ? sampleClip(session.clip, session.progress) : null;
    }

    function adjustCamera(axis, amount) {
      if (!session) return status();
      camera = adjustCameraState(camera, axis, amount);
      return status();
    }

    function resetCamera(input) {
      camera = createCameraState(input);
      return status();
    }

    function cameraPose(target) {
      return cameraPoseFromState(camera, target);
    }

    function close(reason) {
      if (!session) return Object.freeze({ closed: false, restored: true, reason: 'not-open' });
      const closing = session;
      session = null;
      if (!closing.restored) {
        closing.restored = true;
        if (closing.restore) closing.restore(closing.restoreToken, String(reason || 'closed'));
      }
      return Object.freeze({ closed: true, restored: closing.restored, reason: String(reason || 'closed') });
    }

    return Object.freeze({
      inspect,
      open,
      close,
      status,
      sample,
      tick,
      seek,
      nudge,
      setPlaying,
      togglePlaying,
      setSpeed,
      cycleSpeed,
      adjustCamera,
      resetCamera,
      cameraPose
    });
  }

  return Object.freeze({
    VERSION,
    CLIP_SCHEMA,
    SPEEDS,
    AXES,
    DEFAULT_LIMITS,
    DEFAULT_CAMERA,
    CAMERA_LIMITS,
    createImmutableClip,
    sampleClip,
    createCameraState,
    adjustCameraState,
    cameraPoseFromState,
    createReviewController
  });
});
