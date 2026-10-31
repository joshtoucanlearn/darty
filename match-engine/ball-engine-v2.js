'use strict';

/*
 * Football Legacy Magnus Reynolds (MR) Engine — Ball Engine V2
 *
 * A deterministic, SI-unit engine for shadow, controlled-suite and explicit
 * offline FL V2 authority. Loading the module alone grants no authority; the
 * live adapter still requires an exact offline capability and transaction.
 */
(function exposeBallEngineV2(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyBallEngineV2 = api;
})(typeof window === 'object' ? window : null, function createBallEngineV2Api() {
  'use strict';

  const VERSION = '2.0.0-shadow';
  const ENGINE_NAME = 'Magnus Reynolds (MR) Engine';
  const STATE_SCHEMA = 'football-legacy-ball-v2-state';
  const CONTEXT_SCHEMA = 'football-legacy-ball-v2-context';
  const TRACE_SCHEMA = 'football-legacy-ball-v2-step-trace';
  const LAUNCH_SCHEMA = 'football-legacy-ball-v2-launch-intent';

  const REGIMES = Object.freeze({
    FLIGHT: 'flight',
    SKID: 'skid',
    ROLL: 'roll',
    SETTLED: 'settled',
    CONTROLLED: 'controlled'
  });

  const COLLIDER_KINDS = Object.freeze({
    PLANE: 'plane',
    SPHERE: 'sphere',
    CAPSULE: 'capsule'
  });

  const MATERIALS = deepFreeze({
    grass: {
      id: 'grass', restitution: 0.48, friction: 0.18, spinFriction: 0.12,
      capture: false, allowEnergyGain: false
    },
    wall: {
      id: 'wall', restitution: 0.34, friction: 0.34, spinFriction: 0.24,
      capture: false, allowEnergyGain: false
    },
    goalFrame: {
      id: 'goal-frame', restitution: 0.67, friction: 0.035, spinFriction: 0.025,
      capture: false, allowEnergyGain: false
    },
    playerBody: {
      id: 'player-body', restitution: 0.26, friction: 0.46, spinFriction: 0.30,
      capture: false, allowEnergyGain: false
    },
    boot: {
      id: 'boot', restitution: 0.44, friction: 0.22, spinFriction: 0.16,
      capture: false, allowEnergyGain: true
    },
    keeperHands: {
      id: 'keeper-hands', restitution: 0, friction: 1, spinFriction: 1,
      capture: true, allowEnergyGain: false
    },
    net: {
      id: 'net', restitution: 0.06, friction: 0.72, spinFriction: 0.62,
      capture: false, allowEnergyGain: false
    }
  });

  const DEFAULT_CONFIG = deepFreeze({
    fixedDelta: 1 / 60,
    maxSubstep: 1 / 240,
    maxDuration: 0.25,
    maxContactsPerSubstep: 4,
    collisionEpsilon: 1e-6,
    radius: 0.11,
    mass: 0.43,
    groundHeight: 0,
    gravity: { x: 0, y: 0, z: -9.80665 },
    airDensity: 1.225,
    airDynamicViscosity: 1.81e-5,
    dragSurface: [
      { speed: 0, coefficient: 0.20 },
      { speed: 12, coefficient: 0.22 },
      { speed: 25, coefficient: 0.25 },
      { speed: 40, coefficient: 0.28 }
    ],
    magnus: {
      liftSlope: 0.72,
      maximumLiftCoefficient: 0.34,
      minimumSpeed: 0.4
    },
    angularDecayPerSecond: 0.16,
    knuckle: {
      enabled: false,
      acceleration: 0.75,
      minimumSpeed: 18,
      maximumSpin: 6,
      oscillationFrequencyHz: 3.5
    },
    ground: {
      material: MATERIALS.grass,
      minimumBounceSpeed: 0.65,
      skidSlipSpeed: 0.55,
      skidFriction: 0.22,
      // Effective natural-grass rolling resistance. The original 0.014 value let a
      // missed ordinary pass retain several metres per second for five-plus
      // seconds, so the ball appeared to float away from play. 0.14 keeps a
      // firm pass alive through its receiving window while allowing realistic
      // loose-ball deceleration after that window.
      rollingFriction: 0.14,
      spinMatchRate: 13,
      settleLinearSpeed: 0.04,
      settleAngularSpeed: 0.8,
      settleDelay: 0.28
    },
    energy: {
      maximumPassiveGainRatio: 0.002,
      absoluteToleranceJ: 1e-8
    }
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return value;
  }

  function finite(value, fallback, label) {
    const result = Number.isFinite(value) ? Number(value) : fallback;
    if (!Number.isFinite(result)) throw new TypeError((label || 'value') + ' must be finite');
    return result;
  }

  function positive(value, fallback, label, allowZero) {
    const result = finite(value, fallback, label);
    if (allowZero ? result < 0 : result <= 0) {
      throw new RangeError((label || 'value') + (allowZero ? ' must be non-negative' : ' must be positive'));
    }
    return result;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function vector(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      x: finite(source.x, fallback.x, 'vector.x'),
      y: finite(source.y, fallback.y, 'vector.y'),
      z: finite(source.z, fallback.z, 'vector.z')
    };
  }

  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
  function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function scale(a, scalar) { return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar }; }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }
  function magnitudeSquared(a) { return dot(a, a); }
  function magnitude(a) { return Math.sqrt(magnitudeSquared(a)); }
  function normalise(a, fallback) {
    const length = magnitude(a);
    if (length <= 1e-12) return vector(fallback || { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    return scale(a, 1 / length);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpVector(a, b, t) {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
  }

  function quaternion(value) {
    const source = value && typeof value === 'object' ? value : {};
    const raw = {
      x: finite(source.x, 0, 'orientation.x'),
      y: finite(source.y, 0, 'orientation.y'),
      z: finite(source.z, 0, 'orientation.z'),
      w: finite(source.w, 1, 'orientation.w')
    };
    const length = Math.hypot(raw.x, raw.y, raw.z, raw.w) || 1;
    return { x: raw.x / length, y: raw.y / length, z: raw.z / length, w: raw.w / length };
  }

  function integrateOrientation(orientation, angularVelocity, dt) {
    const half = dt * 0.5;
    const q = orientation;
    const w = angularVelocity;
    return quaternion({
      x: q.x + half * (w.x * q.w + w.y * q.z - w.z * q.y),
      y: q.y + half * (-w.x * q.z + w.y * q.w + w.z * q.x),
      z: q.z + half * (w.x * q.y - w.y * q.x + w.z * q.w),
      w: q.w + half * (-w.x * q.x - w.y * q.y - w.z * q.z)
    });
  }

  function copyMaterial(material, fallback) {
    const source = material && typeof material === 'object' ? material : fallback;
    return {
      id: String(source.id || fallback.id),
      restitution: clamp(finite(source.restitution, fallback.restitution, 'material.restitution'), 0, 1.5),
      friction: clamp(finite(source.friction, fallback.friction, 'material.friction'), 0, 1),
      spinFriction: clamp(finite(source.spinFriction, fallback.spinFriction, 'material.spinFriction'), 0, 1),
      capture: Boolean(source.capture),
      allowEnergyGain: Boolean(source.allowEnergyGain)
    };
  }

  function copyDragSurface(surface) {
    const source = Array.isArray(surface) && surface.length ? surface : DEFAULT_CONFIG.dragSurface;
    const result = source.map((point, index) => ({
      speed: positive(point.speed, 0, 'dragSurface[' + index + '].speed', true),
      coefficient: positive(point.coefficient, 0, 'dragSurface[' + index + '].coefficient', true)
    })).sort((a, b) => a.speed - b.speed);
    for (let index = 1; index < result.length; index += 1) {
      if (result[index].speed === result[index - 1].speed) {
        throw new RangeError('dragSurface speeds must be unique');
      }
    }
    return result;
  }

  function createConfig(overrides) {
    const source = overrides && typeof overrides === 'object' ? overrides : {};
    const ground = source.ground && typeof source.ground === 'object' ? source.ground : {};
    const magnus = source.magnus && typeof source.magnus === 'object' ? source.magnus : {};
    const knuckle = source.knuckle && typeof source.knuckle === 'object' ? source.knuckle : {};
    const energy = source.energy && typeof source.energy === 'object' ? source.energy : {};
    const result = {
      fixedDelta: positive(source.fixedDelta, DEFAULT_CONFIG.fixedDelta, 'fixedDelta'),
      maxSubstep: positive(source.maxSubstep, DEFAULT_CONFIG.maxSubstep, 'maxSubstep'),
      maxDuration: positive(source.maxDuration, DEFAULT_CONFIG.maxDuration, 'maxDuration'),
      maxContactsPerSubstep: Math.max(1, Math.trunc(positive(
        source.maxContactsPerSubstep,
        DEFAULT_CONFIG.maxContactsPerSubstep,
        'maxContactsPerSubstep'
      ))),
      collisionEpsilon: positive(source.collisionEpsilon, DEFAULT_CONFIG.collisionEpsilon, 'collisionEpsilon'),
      radius: positive(source.radius, DEFAULT_CONFIG.radius, 'radius'),
      mass: positive(source.mass, DEFAULT_CONFIG.mass, 'mass'),
      groundHeight: finite(source.groundHeight, DEFAULT_CONFIG.groundHeight, 'groundHeight'),
      gravity: vector(source.gravity, DEFAULT_CONFIG.gravity),
      airDensity: positive(source.airDensity, DEFAULT_CONFIG.airDensity, 'airDensity', true),
      airDynamicViscosity: positive(
        source.airDynamicViscosity,
        DEFAULT_CONFIG.airDynamicViscosity,
        'airDynamicViscosity'
      ),
      dragSurface: copyDragSurface(source.dragSurface),
      magnus: {
        liftSlope: positive(magnus.liftSlope, DEFAULT_CONFIG.magnus.liftSlope, 'magnus.liftSlope', true),
        maximumLiftCoefficient: positive(
          magnus.maximumLiftCoefficient,
          DEFAULT_CONFIG.magnus.maximumLiftCoefficient,
          'magnus.maximumLiftCoefficient',
          true
        ),
        minimumSpeed: positive(magnus.minimumSpeed, DEFAULT_CONFIG.magnus.minimumSpeed, 'magnus.minimumSpeed', true)
      },
      angularDecayPerSecond: positive(
        source.angularDecayPerSecond,
        DEFAULT_CONFIG.angularDecayPerSecond,
        'angularDecayPerSecond',
        true
      ),
      knuckle: {
        enabled: Boolean(knuckle.enabled),
        acceleration: positive(knuckle.acceleration, DEFAULT_CONFIG.knuckle.acceleration, 'knuckle.acceleration', true),
        minimumSpeed: positive(knuckle.minimumSpeed, DEFAULT_CONFIG.knuckle.minimumSpeed, 'knuckle.minimumSpeed', true),
        maximumSpin: positive(knuckle.maximumSpin, DEFAULT_CONFIG.knuckle.maximumSpin, 'knuckle.maximumSpin', true),
        oscillationFrequencyHz: positive(
          knuckle.oscillationFrequencyHz,
          DEFAULT_CONFIG.knuckle.oscillationFrequencyHz,
          'knuckle.oscillationFrequencyHz'
        )
      },
      ground: {
        material: copyMaterial(ground.material, MATERIALS.grass),
        minimumBounceSpeed: positive(
          ground.minimumBounceSpeed,
          DEFAULT_CONFIG.ground.minimumBounceSpeed,
          'ground.minimumBounceSpeed',
          true
        ),
        skidSlipSpeed: positive(ground.skidSlipSpeed, DEFAULT_CONFIG.ground.skidSlipSpeed, 'ground.skidSlipSpeed', true),
        skidFriction: positive(ground.skidFriction, DEFAULT_CONFIG.ground.skidFriction, 'ground.skidFriction', true),
        rollingFriction: positive(
          ground.rollingFriction,
          DEFAULT_CONFIG.ground.rollingFriction,
          'ground.rollingFriction',
          true
        ),
        spinMatchRate: positive(ground.spinMatchRate, DEFAULT_CONFIG.ground.spinMatchRate, 'ground.spinMatchRate', true),
        settleLinearSpeed: positive(
          ground.settleLinearSpeed,
          DEFAULT_CONFIG.ground.settleLinearSpeed,
          'ground.settleLinearSpeed',
          true
        ),
        settleAngularSpeed: positive(
          ground.settleAngularSpeed,
          DEFAULT_CONFIG.ground.settleAngularSpeed,
          'ground.settleAngularSpeed',
          true
        ),
        settleDelay: positive(ground.settleDelay, DEFAULT_CONFIG.ground.settleDelay, 'ground.settleDelay', true)
      },
      energy: {
        maximumPassiveGainRatio: positive(
          energy.maximumPassiveGainRatio,
          DEFAULT_CONFIG.energy.maximumPassiveGainRatio,
          'energy.maximumPassiveGainRatio',
          true
        ),
        absoluteToleranceJ: positive(
          energy.absoluteToleranceJ,
          DEFAULT_CONFIG.energy.absoluteToleranceJ,
          'energy.absoluteToleranceJ',
          true
        )
      }
    };
    if (result.maxSubstep > result.maxDuration) throw new RangeError('maxSubstep cannot exceed maxDuration');
    return result;
  }

  function createSimulationContext(options) {
    const source = options && typeof options === 'object' ? options : {};
    if (!Number.isInteger(source.seed)) throw new TypeError('A deterministic integer seed is required');
    const seed = source.seed >>> 0;
    if (seed === 0) throw new RangeError('seed must not be zero');
    const randomState = Number.isInteger(source.randomState) ? source.randomState >>> 0 : seed;
    if (randomState === 0) throw new RangeError('randomState must not be zero');
    return {
      schema: CONTEXT_SCHEMA,
      seed,
      randomState,
      randomDrawCount: Math.max(0, Math.trunc(finite(source.randomDrawCount, 0, 'randomDrawCount'))),
      outerTick: Math.max(0, Math.trunc(finite(source.outerTick, 0, 'outerTick'))),
      substepCount: Math.max(0, Math.trunc(finite(source.substepCount, 0, 'substepCount'))),
      elapsed: Math.max(0, finite(source.elapsed, 0, 'elapsed'))
    };
  }

  function cloneContext(context) {
    if (!isSimulationContext(context)) throw new TypeError('A complete deterministic simulation context is required');
    return { ...context };
  }

  function isSimulationContext(context) {
    return Boolean(context && context.schema === CONTEXT_SCHEMA &&
      Number.isInteger(context.seed) && context.seed > 0 &&
      Number.isInteger(context.randomState) && context.randomState > 0 && context.randomState <= 0xffffffff &&
      Number.isInteger(context.randomDrawCount) && context.randomDrawCount >= 0 &&
      Number.isInteger(context.outerTick) && context.outerTick >= 0 &&
      Number.isInteger(context.substepCount) && context.substepCount >= 0 &&
      Number.isFinite(context.elapsed) && context.elapsed >= 0);
  }

  function drawRandom(context) {
    let state = context.randomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    context.randomState = state >>> 0;
    context.randomDrawCount += 1;
    return context.randomState / 4294967296;
  }

  function seedPhase(seed, salt) {
    let value = (seed ^ salt) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = (value ^ (value >>> 16)) >>> 0;
    return value / 4294967296 * Math.PI * 2;
  }

  function createBallState(initial, configOverrides) {
    const config = createConfig(configOverrides);
    const source = initial && typeof initial === 'object' ? initial : {};
    const radius = positive(source.radius, config.radius, 'state.radius');
    const mass = positive(source.mass, config.mass, 'state.mass');
    const position = vector(source.position, { x: 0, y: 0, z: config.groundHeight + radius });
    const velocity = vector(source.velocity, { x: 0, y: 0, z: 0 });
    const angularVelocity = vector(source.angularVelocity, { x: 0, y: 0, z: 0 });
    const level = config.groundHeight + radius;
    const grounded = typeof source.grounded === 'boolean'
      ? source.grounded
      : position.z <= level + config.collisionEpsilon && velocity.z <= config.ground.minimumBounceSpeed;
    const settled = Boolean(source.settled);
    let regime = Object.values(REGIMES).includes(source.regime) ? source.regime : (grounded ? REGIMES.ROLL : REGIMES.FLIGHT);
    if (settled) regime = REGIMES.SETTLED;
    return {
      schema: STATE_SCHEMA,
      id: String(source.id || 'ball'),
      position,
      velocity,
      angularVelocity,
      orientation: quaternion(source.orientation),
      radius,
      mass,
      inertia: positive(source.inertia, (2 / 5) * mass * radius * radius, 'state.inertia'),
      regime,
      grounded,
      settled,
      settleTime: Math.max(0, finite(source.settleTime, 0, 'state.settleTime')),
      contactCount: Math.max(0, Math.trunc(finite(source.contactCount, 0, 'state.contactCount'))),
      lastContact: source.lastContact && typeof source.lastContact === 'object'
        ? {
            colliderId: String(source.lastContact.colliderId || ''),
            materialId: String(source.lastContact.materialId || ''),
            normal: vector(source.lastContact.normal, { x: 0, y: 0, z: 1 }),
            normalSpeed: positive(source.lastContact.normalSpeed, 0, 'lastContact.normalSpeed', true),
            outerTick: Math.max(0, Math.trunc(finite(source.lastContact.outerTick, 0, 'lastContact.outerTick'))),
            substepCount: Math.max(0, Math.trunc(finite(source.lastContact.substepCount, 0, 'lastContact.substepCount')))
          }
        : null,
      lastOuterTick: Math.max(0, Math.trunc(finite(source.lastOuterTick, 0, 'state.lastOuterTick'))),
      simulationTime: Math.max(0, finite(source.simulationTime, 0, 'state.simulationTime')),
      metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {}
    };
  }

  function cloneBallState(state, config) {
    if (!isBallState(state)) throw new TypeError('A complete Ball Engine V2 state is required');
    return createBallState(state, {
      ...(config || {}),
      radius: state.radius,
      mass: state.mass
    });
  }

  function isBallState(state) {
    return Boolean(state && state.schema === STATE_SCHEMA &&
      [state.position, state.velocity, state.angularVelocity].every(item =>
        item && ['x', 'y', 'z'].every(key => Number.isFinite(item[key]))) &&
      state.orientation && ['x', 'y', 'z', 'w'].every(key => Number.isFinite(state.orientation[key])) &&
      Number.isFinite(state.radius) && state.radius > 0 &&
      Number.isFinite(state.mass) && state.mass > 0 &&
      Number.isFinite(state.inertia) && state.inertia > 0 &&
      Object.values(REGIMES).includes(state.regime) &&
      typeof state.grounded === 'boolean' && typeof state.settled === 'boolean' &&
      Number.isFinite(state.settleTime) && Number.isInteger(state.contactCount) &&
      Number.isInteger(state.lastOuterTick) && Number.isFinite(state.simulationTime) &&
      state.metadata && typeof state.metadata === 'object');
  }

  function rpmToRadiansPerSecond(rpm) {
    return finite(rpm, 0, 'rpm') * Math.PI * 2 / 60;
  }

  function createLaunchIntent(input) {
    const source = input && typeof input === 'object' ? input : {};
    const origin = vector(source.origin, { x: 0, y: 0, z: DEFAULT_CONFIG.radius });
    const target = source.target ? vector(source.target, origin) : null;
    const direction = source.direction ? vector(source.direction, { x: 1, y: 0, z: 0 }) : null;
    if (!target && !direction) throw new TypeError('launch intent requires a direction or target');
    const speed = positive(source.speed, NaN, 'launch speed', true);
    if (speed <= 0) throw new RangeError('launch speed must be greater than zero');
    return {
      schema: LAUNCH_SCHEMA,
      id: String(source.id || 'launch'),
      origin,
      target,
      direction,
      speed,
      liftAngleDeg: finite(source.liftAngleDeg, 0, 'liftAngleDeg'),
      sideSpinRpm: finite(source.sideSpinRpm, 0, 'sideSpinRpm'),
      topSpinRpm: finite(source.topSpinRpm, 0, 'topSpinRpm'),
      axialSpinRpm: finite(source.axialSpinRpm, 0, 'axialSpinRpm'),
      source: String(source.source || 'unspecified'),
      metadata: source.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {}
    };
  }

  function resolveLaunch(input, configOverrides) {
    const config = createConfig(configOverrides);
    const intent = input && input.schema === LAUNCH_SCHEMA ? createLaunchIntent(input) : createLaunchIntent(input);
    const rawDirection = intent.direction || subtract(intent.target, intent.origin);
    const forward = normalise({ x: rawDirection.x, y: rawDirection.y, z: 0 }, { x: 1, y: 0, z: 0 });
    if (Math.hypot(rawDirection.x, rawDirection.y) <= 1e-9) {
      throw new RangeError('launch direction must have a horizontal component');
    }
    const lateral = { x: -forward.y, y: forward.x, z: 0 };
    const radians = intent.liftAngleDeg * Math.PI / 180;
    const horizontalSpeed = intent.speed * Math.cos(radians);
    const velocity = add(scale(forward, horizontalSpeed), { x: 0, y: 0, z: intent.speed * Math.sin(radians) });
    const topSpin = scale(lateral, rpmToRadiansPerSecond(intent.topSpinRpm));
    const sideSpin = { x: 0, y: 0, z: rpmToRadiansPerSecond(intent.sideSpinRpm) };
    const axialSpin = scale(forward, rpmToRadiansPerSecond(intent.axialSpinRpm));
    const state = createBallState({
      position: intent.origin,
      velocity,
      angularVelocity: add(add(topSpin, sideSpin), axialSpin),
      radius: config.radius,
      mass: config.mass,
      grounded: false,
      regime: REGIMES.FLIGHT,
      metadata: {
        launchId: intent.id,
        launchSource: intent.source,
        launchMetadata: { ...intent.metadata }
      }
    }, config);
    return {
      intent,
      state,
      frame: { forward, lateral, up: { x: 0, y: 0, z: 1 } },
      event: {
        type: 'launch',
        launchId: intent.id,
        source: intent.source,
        speed: intent.speed,
        liftAngleDeg: intent.liftAngleDeg,
        velocity: { ...state.velocity },
        angularVelocity: { ...state.angularVelocity }
      }
    };
  }

  function createPlaneCollider(input) {
    const source = input && typeof input === 'object' ? input : {};
    const rawNormal = vector(source.normal, { x: 0, y: 0, z: 1 });
    if (magnitude(rawNormal) <= 1e-12) throw new RangeError('plane normal must be non-zero');
    const normal = normalise(rawNormal, { x: 0, y: 0, z: 1 });
    const point = vector(source.point, { x: 0, y: 0, z: 0 });
    return {
      kind: COLLIDER_KINDS.PLANE,
      id: String(source.id || 'plane'),
      role: String(source.role || 'wall'),
      normal,
      constant: dot(normal, point),
      velocity: vector(source.velocity, { x: 0, y: 0, z: 0 }),
      material: copyMaterial(source.material, MATERIALS.wall),
      enabled: source.enabled !== false,
      order: Math.trunc(finite(source.order, 0, 'collider.order'))
    };
  }

  function createSphereCollider(input) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      kind: COLLIDER_KINDS.SPHERE,
      id: String(source.id || 'sphere'),
      role: String(source.role || 'body'),
      center: vector(source.center, { x: 0, y: 0, z: 0 }),
      radius: positive(source.radius, NaN, 'sphere radius'),
      velocity: vector(source.velocity, { x: 0, y: 0, z: 0 }),
      material: copyMaterial(source.material, MATERIALS.playerBody),
      enabled: source.enabled !== false,
      order: Math.trunc(finite(source.order, 0, 'collider.order'))
    };
  }

  function createCapsuleCollider(input) {
    const source = input && typeof input === 'object' ? input : {};
    const start = vector(source.start, { x: 0, y: 0, z: 0 });
    const end = vector(source.end, { x: 0, y: 0, z: 1 });
    if (magnitudeSquared(subtract(end, start)) <= 1e-12) {
      throw new RangeError('capsule endpoints must differ');
    }
    return {
      kind: COLLIDER_KINDS.CAPSULE,
      id: String(source.id || 'capsule'),
      role: String(source.role || 'body'),
      start,
      end,
      radius: positive(source.radius, NaN, 'capsule radius'),
      velocity: vector(source.velocity, { x: 0, y: 0, z: 0 }),
      material: copyMaterial(source.material, MATERIALS.playerBody),
      enabled: source.enabled !== false,
      order: Math.trunc(finite(source.order, 0, 'collider.order'))
    };
  }

  function createGoalFrame(input) {
    const source = input && typeof input === 'object' ? input : {};
    const left = vector(source.leftPostBase, { x: 0, y: -3.66, z: 0 });
    const right = vector(source.rightPostBase, { x: 0, y: 3.66, z: 0 });
    const height = positive(source.height, 2.44, 'goal height');
    const radius = positive(source.postRadius, 0.06, 'post radius');
    const material = copyMaterial(source.material, MATERIALS.goalFrame);
    const prefix = String(source.id || 'goal');
    return [
      createCapsuleCollider({ id: prefix + '-left-post', role: 'goal-post', start: left, end: add(left, { x: 0, y: 0, z: height }), radius, material, order: 10 }),
      createCapsuleCollider({ id: prefix + '-right-post', role: 'goal-post', start: right, end: add(right, { x: 0, y: 0, z: height }), radius, material, order: 11 }),
      createCapsuleCollider({
        id: prefix + '-crossbar', role: 'crossbar',
        start: add(left, { x: 0, y: 0, z: height }),
        end: add(right, { x: 0, y: 0, z: height }),
        radius, material, order: 12
      })
    ];
  }

  function normalisedEnvironment(environment, config) {
    const source = environment && typeof environment === 'object' ? environment : {};
    const colliders = Array.isArray(source.colliders) ? source.colliders.filter(item => item && item.enabled !== false) : [];
    const groundEnabled = source.groundEnabled !== false;
    const result = {
      wind: vector(source.wind, { x: 0, y: 0, z: 0 }),
      airDensity: positive(source.airDensity, config.airDensity, 'environment.airDensity', true),
      airDynamicViscosity: positive(
        source.airDynamicViscosity,
        config.airDynamicViscosity,
        'environment.airDynamicViscosity'
      ),
      colliders: colliders.slice(),
      groundEnabled
    };
    if (groundEnabled) {
      result.colliders.push(createPlaneCollider({
        id: '__ground__',
        role: 'ground',
        point: { x: 0, y: 0, z: config.groundHeight },
        normal: { x: 0, y: 0, z: 1 },
        material: config.ground.material,
        order: -1000
      }));
    }
    result.colliders.sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.id).localeCompare(String(b.id)));
    return result;
  }

  function interpolateDragCoefficient(speed, surface) {
    if (speed <= surface[0].speed) return surface[0].coefficient;
    for (let index = 1; index < surface.length; index += 1) {
      const upper = surface[index];
      const lower = surface[index - 1];
      if (speed <= upper.speed) {
        const t = (speed - lower.speed) / (upper.speed - lower.speed);
        return lerp(lower.coefficient, upper.coefficient, t);
      }
    }
    return surface[surface.length - 1].coefficient;
  }

  function aerodynamicAcceleration(state, environment, config, context) {
    const relativeVelocity = subtract(state.velocity, environment.wind);
    const speed = magnitude(relativeVelocity);
    const area = Math.PI * state.radius * state.radius;
    let acceleration = { ...config.gravity };
    let dragCoefficient = 0;
    let liftCoefficient = 0;
    let spinParameter = 0;
    let reynoldsNumber = 0;
    let knuckleAcceleration = { x: 0, y: 0, z: 0 };
    if (speed > 1e-9 && environment.airDensity > 0) {
      const dynamicPressure = 0.5 * environment.airDensity * speed * speed;
      reynoldsNumber = environment.airDensity * speed * state.radius * 2 /
        environment.airDynamicViscosity;
      dragCoefficient = interpolateDragCoefficient(speed, config.dragSurface);
      const dragMagnitude = dynamicPressure * dragCoefficient * area / state.mass;
      acceleration = add(acceleration, scale(normalise(relativeVelocity), -dragMagnitude));

      const relativeDirection = scale(relativeVelocity, 1 / speed);
      const axialSpin = scale(relativeDirection, dot(state.angularVelocity, relativeDirection));
      const transverseSpin = subtract(state.angularVelocity, axialSpin);
      const transverseSpinMagnitude = magnitude(transverseSpin);
      if (speed >= config.magnus.minimumSpeed && transverseSpinMagnitude > 1e-9) {
        spinParameter = state.radius * transverseSpinMagnitude / speed;
        liftCoefficient = clamp(
          config.magnus.liftSlope * spinParameter,
          0,
          config.magnus.maximumLiftCoefficient
        );
        const magnusAxis = cross(transverseSpin, relativeVelocity);
        if (magnitudeSquared(magnusAxis) > 1e-12) {
          const magnusMagnitude = dynamicPressure * area * liftCoefficient / state.mass;
          acceleration = add(acceleration, scale(normalise(magnusAxis), magnusMagnitude));
        }
      }

      const launchMetadata = state.metadata && state.metadata.launchMetadata;
      const launchKnuckleEnabled = Boolean(launchMetadata && launchMetadata.knuckleEnabled);
      const knuckleMinimumSpeed = launchKnuckleEnabled
        ? clamp(finite(launchMetadata.knuckleMinimumSpeed, config.knuckle.minimumSpeed), 0, 80)
        : config.knuckle.minimumSpeed;
      const knuckleMaximumSpin = launchKnuckleEnabled
        ? clamp(finite(launchMetadata.knuckleMaximumSpin, config.knuckle.maximumSpin), 0, 80)
        : config.knuckle.maximumSpin;
      const knuckleFrequency = launchKnuckleEnabled
        ? clamp(finite(launchMetadata.knuckleOscillationFrequencyHz, config.knuckle.oscillationFrequencyHz), .1, 12)
        : config.knuckle.oscillationFrequencyHz;
      const knuckleStrength = launchKnuckleEnabled
        ? clamp(finite(launchMetadata.knuckleAcceleration, config.knuckle.acceleration), 0, 3)
        : config.knuckle.acceleration;
      if ((config.knuckle.enabled || launchKnuckleEnabled) && speed >= knuckleMinimumSpeed &&
          magnitude(state.angularVelocity) <= knuckleMaximumSpin) {
        if (!isSimulationContext(context)) {
          throw new TypeError('Knuckle forcing requires a complete deterministic simulation context');
        }
        const forward = normalise(relativeVelocity, { x: 1, y: 0, z: 0 });
        const lateral = normalise({ x: -forward.y, y: forward.x, z: 0 }, { x: 0, y: 1, z: 0 });
        const liftAxis = normalise(cross(forward, lateral), { x: 0, y: 0, z: 1 });
        const phase = Math.PI * 2 * knuckleFrequency * state.simulationTime;
        const side = Math.sin(phase + seedPhase(context.seed, 0x9e3779b9));
        const lift = Math.sin(phase + seedPhase(context.seed, 0x85ebca6b));
        knuckleAcceleration = add(
          scale(lateral, side * knuckleStrength),
          scale(liftAxis, lift * knuckleStrength * 0.5)
        );
        acceleration = add(acceleration, knuckleAcceleration);
      }
    }
    return {
      acceleration,
      dragCoefficient,
      liftCoefficient,
      spinParameter,
      reynoldsNumber,
      knuckleAcceleration,
      relativeSpeed: speed
    };
  }

  function pointSegmentClosest(point, start, end) {
    const axis = subtract(end, start);
    const denominator = magnitudeSquared(axis);
    const t = denominator <= 1e-12 ? 0 : clamp(dot(subtract(point, start), axis) / denominator, 0, 1);
    const closest = add(start, scale(axis, t));
    return { point: closest, t, distanceSquared: magnitudeSquared(subtract(point, closest)) };
  }

  function closestSegments(firstStart, firstEnd, secondStart, secondEnd) {
    const u = subtract(firstEnd, firstStart);
    const v = subtract(secondEnd, secondStart);
    const w = subtract(firstStart, secondStart);
    const a = dot(u, u);
    const b = dot(u, v);
    const c = dot(v, v);
    const d = dot(u, w);
    const e = dot(v, w);
    const denominator = a * c - b * b;
    let firstT;
    let secondT;
    if (a <= 1e-12) {
      firstT = 0;
      secondT = c <= 1e-12 ? 0 : clamp(e / c, 0, 1);
    } else if (c <= 1e-12) {
      secondT = 0;
      firstT = clamp(-d / a, 0, 1);
    } else {
      firstT = denominator <= 1e-12 ? 0 : clamp((b * e - c * d) / denominator, 0, 1);
      secondT = clamp((b * firstT + e) / c, 0, 1);
      firstT = clamp((b * secondT - d) / a, 0, 1);
    }
    const firstPoint = add(firstStart, scale(u, firstT));
    const secondPoint = add(secondStart, scale(v, secondT));
    return {
      firstT,
      secondT,
      firstPoint,
      secondPoint,
      distanceSquared: magnitudeSquared(subtract(firstPoint, secondPoint))
    };
  }

  function sweepPlane(start, end, radius, collider, dt, colliderElapsed) {
    // Evaluate both endpoints against the translating plane at the matching
    // simulation times. collider.constant is the plane at the beginning of
    // the outer step; colliderElapsed carries elapsed substeps/contact slices
    // so a moving plane is not reset to its original position on each sweep.
    const elapsed = finite(colliderElapsed, 0, 'collider elapsed');
    const normalSpeed = dot(collider.normal, collider.velocity);
    const startConstant = collider.constant + normalSpeed * elapsed;
    const endConstant = collider.constant + normalSpeed * (elapsed + dt);
    const startDistance = dot(collider.normal, start) - startConstant - radius;
    const endDistance = dot(collider.normal, end) - endConstant - radius;
    if (startDistance <= 0) {
      if (endDistance < startDistance || startDistance < -1e-7) {
        return { t: 0, normal: { ...collider.normal }, penetration: Math.max(0, -startDistance) };
      }
      return null;
    }
    if (endDistance > 0) return null;
    const denominator = startDistance - endDistance;
    const t = denominator <= 1e-12 ? 0 : clamp(startDistance / denominator, 0, 1);
    return { t, normal: { ...collider.normal }, penetration: 0 };
  }

  function sweepSphere(start, end, radius, collider, dt) {
    const relativeEnd = subtract(end, scale(collider.velocity, dt));
    const direction = subtract(relativeEnd, start);
    const offset = subtract(start, collider.center);
    const combinedRadius = radius + collider.radius;
    const c = dot(offset, offset) - combinedRadius * combinedRadius;
    if (c <= 0) return { t: 0, normal: normalise(offset, { x: 1, y: 0, z: 0 }), penetration: Math.max(0, combinedRadius - magnitude(offset)) };
    const a = dot(direction, direction);
    if (a <= 1e-12) return null;
    const b = 2 * dot(offset, direction);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (root < 0 || root > 1) return null;
    const relativePoint = add(offset, scale(direction, root));
    return { t: root, normal: normalise(relativePoint, { x: 1, y: 0, z: 0 }), penetration: 0 };
  }

  function capsuleDistanceAt(start, direction, t, collider) {
    const point = add(start, scale(direction, t));
    const nearest = pointSegmentClosest(point, collider.start, collider.end);
    return { point, nearest: nearest.point, distanceSquared: nearest.distanceSquared };
  }

  // Conservative broadphase: true when the swept ball segment is separated from
  // the capsule axis by more than the combined radius on some axis, so the
  // full sweep below could only return null. The margin absorbs rounding.
  function capsuleSweepMisses(start, relativeEnd, radius, collider) {
    const margin = radius + collider.radius + 1e-4;
    const a = collider.start;
    const b = collider.end;
    const lowX = a.x < b.x ? a.x : b.x;
    const highX = a.x < b.x ? b.x : a.x;
    if (start.x > highX + margin && relativeEnd.x > highX + margin) return true;
    if (start.x < lowX - margin && relativeEnd.x < lowX - margin) return true;
    const lowY = a.y < b.y ? a.y : b.y;
    const highY = a.y < b.y ? b.y : a.y;
    if (start.y > highY + margin && relativeEnd.y > highY + margin) return true;
    if (start.y < lowY - margin && relativeEnd.y < lowY - margin) return true;
    const lowZ = a.z < b.z ? a.z : b.z;
    const highZ = a.z < b.z ? b.z : a.z;
    if (start.z > highZ + margin && relativeEnd.z > highZ + margin) return true;
    if (start.z < lowZ - margin && relativeEnd.z < lowZ - margin) return true;
    return false;
  }

  function sweepCapsule(start, end, radius, collider, dt) {
    const relativeEnd = subtract(end, scale(collider.velocity, dt));
    if (capsuleSweepMisses(start, relativeEnd, radius, collider)) return null;
    const direction = subtract(relativeEnd, start);
    const combinedRadius = radius + collider.radius;
    const startDistance = capsuleDistanceAt(start, direction, 0, collider);
    if (startDistance.distanceSquared <= combinedRadius * combinedRadius) {
      const delta = subtract(startDistance.point, startDistance.nearest);
      return {
        t: 0,
        normal: normalise(delta, normalise(cross(subtract(collider.end, collider.start), { x: 0, y: 0, z: 1 }), { x: 1, y: 0, z: 0 })),
        penetration: Math.max(0, combinedRadius - Math.sqrt(startDistance.distanceSquared))
      };
    }
    const closest = closestSegments(start, relativeEnd, collider.start, collider.end);
    if (closest.distanceSquared > combinedRadius * combinedRadius || closest.firstT <= 0) return null;
    let low = 0;
    let high = closest.firstT;
    for (let iteration = 0; iteration < 30; iteration += 1) {
      const mid = (low + high) * 0.5;
      const sample = capsuleDistanceAt(start, direction, mid, collider);
      if (sample.distanceSquared <= combinedRadius * combinedRadius) high = mid;
      else low = mid;
    }
    const hit = capsuleDistanceAt(start, direction, high, collider);
    return { t: high, normal: normalise(subtract(hit.point, hit.nearest), { x: 1, y: 0, z: 0 }), penetration: 0 };
  }

  function sweepCollider(start, end, radius, collider, dt, colliderElapsed) {
    if (collider.kind === COLLIDER_KINDS.PLANE) {
      return sweepPlane(start, end, radius, collider, dt, colliderElapsed);
    }
    if (collider.kind === COLLIDER_KINDS.SPHERE) return sweepSphere(start, end, radius, collider, dt);
    if (collider.kind === COLLIDER_KINDS.CAPSULE) return sweepCapsule(start, end, radius, collider, dt);
    throw new TypeError('Unknown collider kind: ' + collider.kind);
  }

  function earliestCollision(start, end, state, environment, dt, colliderElapsed) {
    let earliest = null;
    for (let index = 0; index < environment.colliders.length; index += 1) {
      const collider = environment.colliders[index];
      const hit = sweepCollider(start, end, state.radius, collider, dt, colliderElapsed);
      if (!hit) continue;
      if (!earliest || hit.t < earliest.t - 1e-12 ||
          (Math.abs(hit.t - earliest.t) <= 1e-12 && (collider.order || 0) < (earliest.collider.order || 0))) {
        earliest = { ...hit, collider, index };
      }
    }
    return earliest;
  }

  function kineticEnergy(state, velocity, angularVelocity) {
    return 0.5 * state.mass * magnitudeSquared(velocity) + 0.5 * state.inertia * magnitudeSquared(angularVelocity);
  }

  function resolveContact(state, hit, velocity, angularVelocity, config, context, events) {
    const collider = hit.collider;
    const material = collider.material;
    const colliderVelocity = collider.velocity || { x: 0, y: 0, z: 0 };
    const relative = subtract(velocity, colliderVelocity);
    const incomingNormal = dot(relative, hit.normal);
    const normalSpeed = Math.max(0, -incomingNormal);
    const isGround = collider.id === '__ground__';
    const lowGroundImpact = isGround && normalSpeed < config.ground.minimumBounceSpeed;
    const supportContact = lowGroundImpact && state.grounded;
    const beforeEnergy = kineticEnergy(state, velocity, angularVelocity);
    let nextVelocity = { ...velocity };
    let nextAngular = { ...angularVelocity };
    let captured = false;
    if (material.capture) {
      nextVelocity = { ...colliderVelocity };
      nextAngular = { x: 0, y: 0, z: 0 };
      captured = true;
    } else if (incomingNormal < 0) {
      const normalPart = scale(hit.normal, incomingNormal);
      const tangentPart = subtract(relative, normalPart);
      // Gravity produces a tiny inward velocity on every grounded substep. It
      // is a support constraint, not a fresh bounce or friction impulse. The
      // ground-regime solver below owns skid/roll friction and settling.
      const contactFriction = lowGroundImpact ? 0 : material.friction;
      const restitution = lowGroundImpact ? 0 : material.restitution;
      const resolvedRelative = add(
        scale(tangentPart, 1 - contactFriction),
        scale(normalPart, -restitution)
      );
      nextVelocity = add(resolvedRelative, colliderVelocity);
      nextAngular = scale(nextAngular, 1 - (lowGroundImpact ? 0 : material.spinFriction));
      const tangentSpeed = magnitude(tangentPart);
      if (tangentSpeed > 1e-9 && contactFriction > 0) {
        const tangentDirection = scale(tangentPart, 1 / tangentSpeed);
        const spinImpulse = cross(scale(hit.normal, -state.radius), scale(tangentDirection, tangentSpeed * contactFriction));
        nextAngular = add(nextAngular, scale(spinImpulse, state.mass * state.radius / state.inertia));
      }
    }

    const afterEnergy = kineticEnergy(state, nextVelocity, nextAngular);
    const allowed = beforeEnergy * (1 + config.energy.maximumPassiveGainRatio) + config.energy.absoluteToleranceJ;
    let energyClamped = false;
    // A keeper capture is an active attachment constraint: once possession is
    // established the ball must inherit the hands' world velocity, even when
    // that velocity is greater than the incoming ball speed. Passive contact
    // energy limits still apply to every non-capturing material.
    if (!captured && !material.allowEnergyGain && afterEnergy > allowed && afterEnergy > 0) {
      const factor = Math.sqrt(Math.max(0, allowed) / afterEnergy);
      nextVelocity = scale(nextVelocity, factor);
      nextAngular = scale(nextAngular, factor);
      energyClamped = true;
    }
    if (!supportContact) {
      state.contactCount += 1;
      state.lastContact = {
        colliderId: collider.id,
        materialId: material.id,
        normal: { ...hit.normal },
        normalSpeed,
        outerTick: context.outerTick,
        substepCount: context.substepCount
      };
      events.push({
        type: captured ? 'capture' : 'contact',
        colliderId: collider.id,
        colliderRole: collider.role,
        colliderKind: collider.kind,
        materialId: material.id,
        normal: { ...hit.normal },
        normalSpeed,
        timeFraction: hit.t,
        penetration: hit.penetration,
        beforeEnergyJ: beforeEnergy,
        afterEnergyJ: kineticEnergy(state, nextVelocity, nextAngular),
        energyClamped,
        energyPolicy: captured ? 'active-controlled-attachment' : (material.allowEnergyGain ? 'active-collider' : 'passive-contact'),
        outerTick: context.outerTick,
        substepCount: context.substepCount
      });
    }
    return { velocity: nextVelocity, angularVelocity: nextAngular, captured, supportContact };
  }

  function cloneDetachedValue(value, seen) {
    if (!value || typeof value !== 'object') return value;
    const references = seen || new WeakMap();
    if (references.has(value)) return references.get(value);
    const clone = Array.isArray(value) ? [] : {};
    references.set(value, clone);
    Object.keys(value).forEach(key => { clone[key] = cloneDetachedValue(value[key], references); });
    return clone;
  }

  function clonedQueryVector(value, fallback, label) {
    const source = value && typeof value === 'object' ? value : {};
    for (const axis of ['x', 'y', 'z']) {
      if (Object.prototype.hasOwnProperty.call(source, axis) && !Number.isFinite(source[axis])) {
        throw new TypeError(label + '.' + axis + ' must be finite');
      }
    }
    return vector(source, fallback);
  }

  /*
   * Resolve at most one passive player-body contact along an already sampled
   * ball segment. body.position is the current centre of the capsule footprint
   * at its base; heightM is the capsule's total ground-to-head extent. The
   * previous body capsule is inferred from velocity over fixedTickSeconds so
   * both participants are swept over the same interval. This pure query clones
   * its inputs and does not integrate or advance simulationTime/lastOuterTick.
   */
  function resolvePassiveBodyDeflection(stateInput, input) {
    const source = input && typeof input === 'object' ? input : {};
    const body = source.body && typeof source.body === 'object' ? source.body : null;
    if (!body) throw new TypeError('passive body deflection requires a body');
    if (!body.position || typeof body.position !== 'object') {
      throw new TypeError('passive body deflection requires body.position');
    }
    if (!body.velocity || typeof body.velocity !== 'object') {
      throw new TypeError('passive body deflection requires body.velocity');
    }
    if (!source.previousBallPosition || typeof source.previousBallPosition !== 'object') {
      throw new TypeError('passive body deflection requires previousBallPosition');
    }
    if (!Number.isInteger(source.tick) || source.tick < 0) {
      throw new TypeError('passive body deflection tick must be a non-negative integer');
    }
    const config = createConfig();
    // A body is passive even when its capsule is translating. It may redirect
    // existing ball energy, but it must never create any in this public path.
    config.energy.maximumPassiveGainRatio = 0;
    config.energy.absoluteToleranceJ = 0;

    const state = cloneBallState(stateInput, config);
    state.metadata = cloneDetachedValue(state.metadata);
    const previousBallPosition = clonedQueryVector(source.previousBallPosition, state.position, 'previousBallPosition');
    const position = clonedQueryVector(body.position, { x: 0, y: 0, z: 0 }, 'body.position');
    const velocity = clonedQueryVector(body.velocity, { x: 0, y: 0, z: 0 }, 'body.velocity');
    const radius = positive(body.radius, NaN, 'player body radius');
    const height = positive(body.heightM, NaN, 'player body heightM');
    if (height <= radius * 2) {
      throw new RangeError('player body height must exceed twice its radius');
    }
    const duration = positive(source.fixedTickSeconds, config.fixedDelta, 'passive body fixedTickSeconds');
    if (duration > config.maxDuration + 1e-12) {
      throw new RangeError('passive body fixedTickSeconds exceeds the configured safety bound');
    }
    const previousBodyPosition = subtract(position, scale(velocity, duration));
    if (!['x', 'y', 'z'].every(axis => Number.isFinite(previousBodyPosition[axis]))) {
      throw new RangeError('passive body sweep exceeds finite geometry bounds');
    }
    const colliderId = String(body.id || 'player-body');
    if (colliderId === '__ground__') {
      throw new RangeError('__ground__ is reserved and cannot identify a player body');
    }

    const collider = createCapsuleCollider({
      id: colliderId,
      role: 'player-body',
      start: {
        x: previousBodyPosition.x,
        y: previousBodyPosition.y,
        z: previousBodyPosition.z + radius
      },
      end: {
        x: previousBodyPosition.x,
        y: previousBodyPosition.y,
        z: previousBodyPosition.z + height - radius
      },
      radius,
      velocity,
      material: MATERIALS.playerBody
    });
    const hit = sweepCapsule(previousBallPosition, state.position, state.radius, collider, duration);
    if (!hit) return deepFreeze({ hit: false, state, event: null, timeFraction: null });

    // A swept query can begin inside a capsule after a prior contact or after
    // the source player releases the ball. Overlap alone is not a new impact:
    // if the ball is already stationary relative to, or separating from, the
    // body's contact normal, resolving/logging another collision creates the
    // repeated no-op "deflections" seen in the live playtest. Preserve the
    // detached input state and wait for a future genuine inward crossing.
    const incomingNormal = dot(subtract(state.velocity, collider.velocity), hit.normal);
    if (incomingNormal >= -1e-6) {
      return deepFreeze({ hit: false, state, event: null, timeFraction: null });
    }

    state.position = add(
      lerpVector(previousBallPosition, state.position, hit.t),
      scale(hit.normal, config.collisionEpsilon + hit.penetration)
    );
    const events = [];
    const response = resolveContact(
      state,
      { ...hit, collider },
      state.velocity,
      state.angularVelocity,
      config,
      { outerTick: source.tick, substepCount: 0 },
      events
    );
    state.velocity = response.velocity;
    state.angularVelocity = response.angularVelocity;
    if (events.length !== 1 || state.contactCount !== stateInput.contactCount + 1) {
      throw new Error('passive body deflection must resolve exactly one contact');
    }
    return deepFreeze({ hit: true, state, event: events[0], timeFraction: hit.t });
  }

  function integrateMotionWithContacts(
    state,
    velocity,
    angularVelocity,
    dt,
    environment,
    config,
    context,
    events,
    colliderElapsedAtSubstepStart
  ) {
    let position = { ...state.position };
    let nextVelocity = { ...velocity };
    let nextAngular = { ...angularVelocity };
    let remaining = dt;
    let groundContact = false;
    let captured = false;
    let elapsedInSubstep = 0;
    for (let contactIndex = 0; contactIndex < config.maxContactsPerSubstep && remaining > 1e-10; contactIndex += 1) {
      const end = add(position, scale(nextVelocity, remaining));
      const hit = earliestCollision(
        position,
        end,
        state,
        environment,
        remaining,
        colliderElapsedAtSubstepStart + elapsedInSubstep
      );
      if (!hit) {
        position = end;
        remaining = 0;
        break;
      }
      position = lerpVector(position, end, hit.t);
      position = add(position, scale(hit.normal, config.collisionEpsilon + hit.penetration));
      const response = resolveContact(state, hit, nextVelocity, nextAngular, config, context, events);
      nextVelocity = response.velocity;
      nextAngular = response.angularVelocity;
      captured = response.captured;
      if (hit.collider.id === '__ground__') groundContact = true;
      const sweepDuration = remaining;
      elapsedInSubstep += sweepDuration * hit.t;
      remaining *= Math.max(0, 1 - hit.t);
      if (captured) {
        remaining = 0;
        break;
      }
      if (hit.t <= 1e-9) {
        const nudgeDuration = Math.min(remaining, 1e-7);
        remaining = Math.max(0, remaining - nudgeDuration);
        elapsedInSubstep += nudgeDuration;
      }
    }
    if (remaining > 1e-10 && !captured) position = add(position, scale(nextVelocity, remaining));
    return { position, velocity: nextVelocity, angularVelocity: nextAngular, groundContact, captured };
  }

  function applyGroundRegime(state, dt, config, events, priorRegime, groundEnabled) {
    if (!groundEnabled) {
      state.grounded = false;
      state.settled = false;
      state.settleTime = 0;
      state.regime = REGIMES.FLIGHT;
      return;
    }
    const level = config.groundHeight + state.radius;
    const nearGround = state.position.z <= level + config.collisionEpsilon * 8;
    if (!nearGround || state.velocity.z > config.ground.minimumBounceSpeed) {
      state.grounded = false;
      state.settled = false;
      state.settleTime = 0;
      state.regime = REGIMES.FLIGHT;
      return;
    }

    state.position.z = level;
    if (Math.abs(state.velocity.z) < config.ground.minimumBounceSpeed) state.velocity.z = 0;
    if (state.velocity.z > 0) {
      state.grounded = false;
      state.regime = REGIMES.FLIGHT;
      state.settleTime = 0;
      return;
    }
    state.velocity.z = 0;
    state.grounded = true;

    const beforeGroundEnergy = kineticEnergy(state, state.velocity, state.angularVelocity);
    let contactSurfaceVelocity = {
      x: state.velocity.x - state.angularVelocity.y * state.radius,
      y: state.velocity.y + state.angularVelocity.x * state.radius,
      z: 0
    };
    let slipSpeed = Math.hypot(contactSurfaceVelocity.x, contactSurfaceVelocity.y);
    let horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.y);
    const gravityMagnitude = Math.max(0, -config.gravity.z);
    const launchMetadata = state.metadata && state.metadata.launchMetadata;
    if (slipSpeed > config.ground.skidSlipSpeed) {
      // Coulomb friction acts through the contact point. Applying one shared
      // impulse to translation and rotation prevents the old solver from
      // creating spin energy independently of the ball's linear energy.
      const inverseEffectiveMass = 1 / state.mass + state.radius * state.radius / state.inertia;
      const requiredImpulse = slipSpeed / inverseEffectiveMass;
      const openingSkidScale = launchMetadata && launchMetadata.groundDampingModel === 'progressive-ground-strike-v2'
        ? clamp(finite(launchMetadata.groundSkidFrictionScale, 1), .1, 1)
        : 1;
      const maximumImpulse = config.ground.skidFriction * openingSkidScale * state.mass * gravityMagnitude * dt;
      const impulseMagnitude = Math.min(requiredImpulse, maximumImpulse);
      if (impulseMagnitude > 0) {
        const impulse = {
          x: -contactSurfaceVelocity.x / slipSpeed * impulseMagnitude,
          y: -contactSurfaceVelocity.y / slipSpeed * impulseMagnitude,
          z: 0
        };
        state.velocity.x += impulse.x / state.mass;
        state.velocity.y += impulse.y / state.mass;
        const angularImpulse = cross({ x: 0, y: 0, z: -state.radius }, impulse);
        state.angularVelocity.x += angularImpulse.x / state.inertia;
        state.angularVelocity.y += angularImpulse.y / state.inertia;
      }
      state.regime = REGIMES.SKID;
    } else {
      // Project the small residual slip onto the no-slip rolling constraint
      // with the same coupled impulse. This projection is dissipative; it does
      // not manufacture the rotational energy that a direct spin assignment
      // would add.
      if (slipSpeed > 1e-12) {
        const inverseEffectiveMass = 1 / state.mass + state.radius * state.radius / state.inertia;
        const impulseMagnitude = slipSpeed / inverseEffectiveMass;
        const impulse = {
          x: -contactSurfaceVelocity.x / slipSpeed * impulseMagnitude,
          y: -contactSurfaceVelocity.y / slipSpeed * impulseMagnitude,
          z: 0
        };
        state.velocity.x += impulse.x / state.mass;
        state.velocity.y += impulse.y / state.mass;
        const angularImpulse = cross({ x: 0, y: 0, z: -state.radius }, impulse);
        state.angularVelocity.x += angularImpulse.x / state.inertia;
        state.angularVelocity.y += angularImpulse.y / state.inertia;
      }
      contactSurfaceVelocity = {
        x: state.velocity.x - state.angularVelocity.y * state.radius,
        y: state.velocity.y + state.angularVelocity.x * state.radius,
        z: 0
      };
      slipSpeed = Math.hypot(contactSurfaceVelocity.x, contactSurfaceVelocity.y);
      horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.y);
      if (horizontalSpeed > 0) {
      const reduction = Math.min(horizontalSpeed, config.ground.rollingFriction * gravityMagnitude * dt);
      const remaining = horizontalSpeed - reduction;
      const ratio = horizontalSpeed > 0 ? remaining / horizontalSpeed : 0;
      state.velocity.x *= ratio;
      state.velocity.y *= ratio;
      state.angularVelocity.x *= ratio;
      state.angularVelocity.y *= ratio;
      state.angularVelocity.z *= Math.exp(-config.angularDecayPerSecond * dt);
      state.regime = REGIMES.ROLL;
      } else {
        state.velocity.x = 0;
        state.velocity.y = 0;
        state.regime = REGIMES.ROLL;
      }
    }

    // A deliberately weighted ground strike can carry an additional,
    // finite-duration turf-loss profile in its immutable launch metadata.
    // This is passive damping only: it cannot accelerate, curve or retarget
    // the ball, and launches without the exact model tag remain byte-for-byte
    // on the shared grass coefficients above. Scaling linear and angular
    // motion together preserves the skid/roll relationship established by
    // the physical contact solver.
    if (launchMetadata && launchMetadata.groundDampingModel === 'weighted-ground-strike-v1') {
      const dampingPerSecond = clamp(finite(launchMetadata.groundLinearDampingPerSecond, 0), 0, 12);
      const dampingUntilSeconds = clamp(finite(launchMetadata.groundLinearDampingUntilSeconds, 0), 0, 12);
      const activeDuration = Math.max(0, Math.min(dt, dampingUntilSeconds - state.simulationTime));
      if (dampingPerSecond > 0 && activeDuration > 0) {
        const dampingFactor = Math.exp(-dampingPerSecond * activeDuration);
        state.velocity.x *= dampingFactor;
        state.velocity.y *= dampingFactor;
        state.angularVelocity.x *= dampingFactor;
        state.angularVelocity.y *= dampingFactor;
        state.angularVelocity.z *= dampingFactor;
      }
    }
    if (launchMetadata && launchMetadata.groundDampingModel === 'progressive-ground-strike-v2') {
      // A driven pass does not meet a constant synthetic brake. Its initial
      // foot impulse can skim across the surface, while continued contact
      // raises turf loss non-linearly. The launch owns the calibrated curve;
      // this engine merely applies it as passive energy loss. Ground-contact
      // time is tracked separately from flight time so a small bounce cannot
      // consume the progressive part of the pass before the grass does.
      const initialPerSecond = clamp(finite(launchMetadata.groundDampingInitialPerSecond, 0), 0, 12);
      const rampScale = clamp(finite(launchMetadata.groundDampingRampScale, 0), 0, 12);
      const rampExponent = clamp(finite(launchMetadata.groundDampingRampExponent, 2), .1, 6);
      const originX = finite(launchMetadata.groundDampingOriginX, state.position.x);
      const originY = finite(launchMetadata.groundDampingOriginY, state.position.y);
      const referenceDistance = clamp(finite(launchMetadata.groundDampingReferenceDistanceMetres, 0), .1, 80);
      const maximumProgress = clamp(finite(launchMetadata.groundDampingMaximumProgress, 3), .25, 3);
      const dampingUntilSeconds = clamp(finite(launchMetadata.groundLinearDampingUntilSeconds, 0), 0, 12);
      const contactSeconds = clamp(finite(state.metadata.progressiveGroundContactSeconds, 0), 0, 12);
      const activeDuration = Math.max(0, Math.min(dt, dampingUntilSeconds - contactSeconds));
      if ((initialPerSecond > 0 || rampScale > 0) && activeDuration > 0) {
        const travelled = Math.hypot(state.position.x - originX, state.position.y - originY);
        // The synthetic rising-strike curve may deliberately stop steepening
        // after its authored meeting. Natural rolling resistance still acts;
        // only the extra exponential ramp is capped. Untagged and older
        // launches retain the historical 3x path cap exactly.
        const progress = clamp(travelled / referenceDistance, 0, maximumProgress);
        const dampingRate = clamp(initialPerSecond + rampScale * Math.expm1(
          clamp(rampExponent * progress, 0, 8)
        ), 0, 12);
        const dampingFactor = Math.exp(-dampingRate * activeDuration);
        state.velocity.x *= dampingFactor;
        state.velocity.y *= dampingFactor;
        state.angularVelocity.x *= dampingFactor;
        state.angularVelocity.y *= dampingFactor;
        state.angularVelocity.z *= dampingFactor;
      }
      state.metadata.progressiveGroundContactSeconds = contactSeconds + activeDuration;
    }

    // Final invariant guard. Ground friction is passive, so the complete
    // translational + rotational kinetic energy may never rise. Scaling both
    // terms preserves the coupled rolling relationship if numerical error or
    // a future solver change crosses the bound.
    const afterGroundEnergy = kineticEnergy(state, state.velocity, state.angularVelocity);
    const allowedGroundEnergy = beforeGroundEnergy * (1 + config.energy.maximumPassiveGainRatio) + config.energy.absoluteToleranceJ;
    if (afterGroundEnergy > allowedGroundEnergy && afterGroundEnergy > 0) {
      const factor = Math.sqrt(Math.max(0, allowedGroundEnergy) / afterGroundEnergy);
      state.velocity = scale(state.velocity, factor);
      state.angularVelocity = scale(state.angularVelocity, factor);
      events.push({
        type: 'passive-energy-clamp',
        stage: 'ground-regime',
        beforeEnergyJ: beforeGroundEnergy,
        attemptedEnergyJ: afterGroundEnergy,
        afterEnergyJ: kineticEnergy(state, state.velocity, state.angularVelocity)
      });
    }

    const quietLinear = Math.hypot(state.velocity.x, state.velocity.y) <= config.ground.settleLinearSpeed;
    const quietAngular = magnitude(state.angularVelocity) <= config.ground.settleAngularSpeed;
    if (quietLinear && quietAngular) state.settleTime += dt;
    else state.settleTime = 0;
    if (state.settleTime >= config.ground.settleDelay) {
      state.velocity = { x: 0, y: 0, z: 0 };
      state.angularVelocity = { x: 0, y: 0, z: 0 };
      state.settled = true;
      state.regime = REGIMES.SETTLED;
      if (priorRegime !== REGIMES.SETTLED) events.push({ type: 'settled' });
    } else {
      state.settled = false;
    }
  }

  function integrateSubstep(state, context, dt, environment, config, events, samples, colliderElapsed) {
    const priorRegime = state.regime;
    const forces = aerodynamicAcceleration(state, environment, config, context);
    let velocity = add(state.velocity, scale(forces.acceleration, dt));
    let angularVelocity = scale(state.angularVelocity, Math.exp(-config.angularDecayPerSecond * dt));
    const motion = integrateMotionWithContacts(
      state,
      velocity,
      angularVelocity,
      dt,
      environment,
      config,
      context,
      events,
      colliderElapsed
    );
    state.position = motion.position;
    state.velocity = motion.velocity;
    state.angularVelocity = motion.angularVelocity;
    state.orientation = integrateOrientation(state.orientation, state.angularVelocity, dt);
    if (motion.captured) {
      state.regime = REGIMES.CONTROLLED;
      state.grounded = false;
      state.settled = false;
      state.settleTime = 0;
    } else {
      applyGroundRegime(state, dt, config, events, priorRegime, environment.groundEnabled);
    }
    if (state.regime !== priorRegime) {
      events.push({ type: 'regime-change', from: priorRegime, to: state.regime });
    }
    context.substepCount += 1;
    state.simulationTime += dt;
    samples.push({
      substepCount: context.substepCount,
      time: state.simulationTime,
      position: { ...state.position },
      velocity: { ...state.velocity },
      angularVelocity: { ...state.angularVelocity },
      regime: state.regime,
      dragCoefficient: forces.dragCoefficient,
      liftCoefficient: forces.liftCoefficient,
      spinParameter: forces.spinParameter,
      reynoldsNumber: forces.reynoldsNumber,
      knuckleAcceleration: { ...forces.knuckleAcceleration },
      relativeAirSpeed: forces.relativeSpeed
    });
  }

  function step(stateInput, contextInput, duration, environmentInput, configOverrides) {
    const config = createConfig(configOverrides);
    const state = cloneBallState(stateInput, config);
    const context = cloneContext(contextInput);
    const dtTotal = positive(duration, config.fixedDelta, 'duration');
    if (dtTotal > config.maxDuration + 1e-12) {
      throw new RangeError('duration exceeds the configured safety bound');
    }
    const events = [];
    const samples = [];
    const start = {
      outerTick: context.outerTick,
      substepCount: context.substepCount,
      elapsed: context.elapsed,
      signature: stateSignature(state)
    };
    const environment = normalisedEnvironment(environmentInput, config);
    const substeps = state.regime === REGIMES.CONTROLLED || state.settled
      ? 0
      : Math.max(1, Math.ceil((dtTotal - 1e-12) / config.maxSubstep));
    const dt = substeps ? dtTotal / substeps : 0;
    for (let index = 0; index < substeps; index += 1) {
      integrateSubstep(state, context, dt, environment, config, events, samples, index * dt);
      if (state.regime === REGIMES.CONTROLLED || state.settled) break;
    }
    context.outerTick += 1;
    context.elapsed += dtTotal;
    state.lastOuterTick = context.outerTick;
    const trace = {
      schema: TRACE_SCHEMA,
      engineVersion: VERSION,
      start,
      end: {
        outerTick: context.outerTick,
        substepCount: context.substepCount,
        elapsed: context.elapsed,
        signature: stateSignature(state)
      },
      requestedDuration: dtTotal,
      plannedSubsteps: substeps,
      completedSubsteps: samples.length,
      randomDraws: context.randomDrawCount - contextInput.randomDrawCount,
      events,
      samples,
      outcome: {
        regime: state.regime,
        grounded: state.grounded,
        settled: state.settled,
        contactCount: state.contactCount,
        speed: magnitude(state.velocity),
        spin: magnitude(state.angularVelocity)
      }
    };
    return { state, context, trace };
  }

  function advance(stateInput, contextInput, options) {
    const source = options && typeof options === 'object' ? options : {};
    const duration = positive(source.duration, NaN, 'advance.duration');
    const config = createConfig(source.config);
    const stepDuration = positive(source.stepDuration, config.fixedDelta, 'advance.stepDuration');
    let remaining = duration;
    let state = cloneBallState(stateInput, config);
    let context = cloneContext(contextInput);
    const traces = [];
    while (remaining > 1e-12) {
      const slice = Math.min(stepDuration, remaining);
      const result = step(state, context, slice, source.environment, config);
      state = result.state;
      context = result.context;
      traces.push(result.trace);
      remaining -= slice;
      if (state.settled || state.regime === REGIMES.CONTROLLED) break;
    }
    return { state, context, traces };
  }

  function predict(stateInput, contextInput, options) {
    return advance(stateInput, contextInput, options);
  }

  function round(value, places) {
    const scaleValue = 10 ** places;
    return Math.round((value + Number.EPSILON) * scaleValue) / scaleValue;
  }

  function stateSignature(stateInput) {
    if (!isBallState(stateInput)) throw new TypeError('stateSignature requires a complete state');
    const state = stateInput;
    const compact = [
      ...['x', 'y', 'z'].map(key => round(state.position[key], 9)),
      ...['x', 'y', 'z'].map(key => round(state.velocity[key], 9)),
      ...['x', 'y', 'z'].map(key => round(state.angularVelocity[key], 9)),
      ...['x', 'y', 'z', 'w'].map(key => round(state.orientation[key], 9)),
      state.regime,
      state.grounded ? 1 : 0,
      state.settled ? 1 : 0,
      state.contactCount,
      round(state.simulationTime, 9)
    ].join('|');
    let hash = 2166136261;
    for (let index = 0; index < compact.length; index += 1) {
      hash ^= compact.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  return Object.freeze({
    ENGINE_NAME,
    VERSION,
    STATE_SCHEMA,
    CONTEXT_SCHEMA,
    TRACE_SCHEMA,
    LAUNCH_SCHEMA,
    REGIMES,
    COLLIDER_KINDS,
    MATERIALS,
    DEFAULT_CONFIG,
    createConfig,
    createSimulationContext,
    cloneContext,
    isSimulationContext,
    createBallState,
    cloneBallState,
    isBallState,
    createLaunchIntent,
    resolveLaunch,
    createPlaneCollider,
    createSphereCollider,
    createCapsuleCollider,
    resolvePassiveBodyDeflection,
    createGoalFrame,
    interpolateDragCoefficient,
    aerodynamicAcceleration,
    step,
    advance,
    predict,
    stateSignature,
    rpmToRadiansPerSecond,
    vectorMath: Object.freeze({ add, subtract, scale, dot, cross, magnitude, normalise })
  });
});
