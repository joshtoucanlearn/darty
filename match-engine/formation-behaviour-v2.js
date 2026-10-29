'use strict';

/*
 * Football Legacy deterministic Formation / Team Behaviour v2.
 *
 * This module is intentionally dormant. It provides a pure, data-driven
 * candidate contract for formation geometry and team behaviour, but it is not
 * loaded or called by match.html. Build 173 remains the sole live authority
 * until a separately approved shadow/opt-in migration.
 */
(function exposeFormationBehaviour(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FootballLegacyFormationBehaviourV2 = api;
})(typeof window === 'object' ? window : null, function createFormationBehaviourApi() {
  'use strict';

  const VERSION = '2.0.0-dormant';
  const REQUEST_SCHEMA = 'football-legacy-formation-request-v2';
  const OUTPUT_SCHEMA = 'football-legacy-formation-output-v2';
  const TELEMETRY_SCHEMA = 'football-legacy-formation-telemetry-v2';
  const PHILOSOPHY_SCHEMA = 'football-legacy-philosophy-overlay-v2';

  const PHASES = Object.freeze([
    'buildup',
    'settled-attack',
    'defend',
    'positive-transition',
    'negative-transition'
  ]);

  const DEFAULT_CONFIG = Object.freeze({
    pitchLength: 105,
    pitchWidth: 68,
    pitchMargin: 0.75,
    offsideBuffer: 0.5,
    minimumPlayers: 7,
    maximumPlayers: 11,
    minimumTacticalScale: 0.65,
    maximumTacticalScale: 1.35
  });

  const POSITION_COMPATIBILITY = Object.freeze({
    GK: Object.freeze(['GK']),
    RB: Object.freeze(['RB', 'RWB', 'CB']),
    LB: Object.freeze(['LB', 'LWB', 'CB']),
    CB: Object.freeze(['CB', 'RB', 'LB']),
    RWB: Object.freeze(['RWB', 'RB', 'RM']),
    LWB: Object.freeze(['LWB', 'LB', 'LM']),
    RM: Object.freeze(['RM', 'RW', 'RWB', 'CM']),
    LM: Object.freeze(['LM', 'LW', 'LWB', 'CM']),
    CM: Object.freeze(['CM', 'CDM', 'CAM', 'RM', 'LM']),
    CDM: Object.freeze(['CDM', 'CM', 'CB']),
    CAM: Object.freeze(['CAM', 'CM', 'CF', 'RW', 'LW']),
    RW: Object.freeze(['RW', 'RM', 'RWB', 'ST', 'CAM']),
    LW: Object.freeze(['LW', 'LM', 'LWB', 'ST', 'CAM']),
    ST: Object.freeze(['ST', 'CF', 'RW', 'LW', 'CAM']),
    CF: Object.freeze(['CF', 'ST', 'CAM', 'RW', 'LW'])
  });

  const PHASE_GEOMETRY = Object.freeze({
    buildup: Object.freeze({ goalkeeper: 0.05, start: 0.2, end: 0.68, restMaximum: 0.45 }),
    'settled-attack': Object.freeze({ goalkeeper: 0.08, start: 0.31, end: 0.82, restMaximum: 0.48 }),
    defend: Object.freeze({ goalkeeper: 0.04, start: 0.17, end: 0.53, restMaximum: 0.38 }),
    'positive-transition': Object.freeze({ goalkeeper: 0.06, start: 0.25, end: 0.74, restMaximum: 0.46 }),
    'negative-transition': Object.freeze({ goalkeeper: 0.05, start: 0.2, end: 0.6, restMaximum: 0.4 })
  });

  function finite(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function rounded(value, places) {
    const scale = 10 ** (places == null ? 4 : places);
    return Math.round(finite(value, 0) * scale) / scale;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).forEach(key => {
      result[key] = clone(value[key]);
    });
    return result;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(key => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const result = {};
    Object.keys(value).sort().forEach(key => {
      result[key] = stableValue(value[key]);
    });
    return result;
  }

  function stableJson(value) {
    return JSON.stringify(stableValue(value));
  }

  function roleFamily(position) {
    if (position === 'GK') return 'goalkeeper';
    if (position === 'CB') return 'centre-back';
    if (position === 'RB' || position === 'LB') return 'full-back';
    if (position === 'RWB' || position === 'LWB') return 'wing-back';
    if (position === 'CDM') return 'defensive-midfielder';
    if (position === 'CAM') return 'attacking-midfielder';
    if (position === 'RM' || position === 'LM' || position === 'CM') return 'midfielder';
    if (position === 'RW' || position === 'LW') return 'winger';
    return 'striker';
  }

  function defaultSide(lateral) {
    if (lateral < 0.43) return 'left';
    if (lateral > 0.57) return 'right';
    return 'centre';
  }

  function defaultRestRank(position) {
    if (position === 'CB') return 0;
    if (position === 'RB' || position === 'LB') return 1;
    if (position === 'CDM') return 2;
    if (position === 'CM') return 3;
    if (position === 'RWB' || position === 'LWB') return 4;
    if (position === 'RM' || position === 'LM') return 5;
    if (position === 'CAM') return 6;
    return 7;
  }

  function slot(id, position, band, lateral, duty) {
    return {
      id,
      position,
      compatiblePositions: (POSITION_COMPATIBILITY[position] || [position]).slice(),
      roleFamily: roleFamily(position),
      band,
      lateral,
      side: defaultSide(lateral),
      duty: duty || 'balanced',
      restRank: defaultRestRank(position)
    };
  }

  function formation(code, label, defensiveShape, offensiveShape, phaseShapes, slots, reductionOrder, restDefence) {
    return {
      code,
      label,
      canonicalShapes: { defensive: defensiveShape, offensive: offensiveShape },
      phaseShapes,
      slots,
      reductionOrder,
      restDefence
    };
  }

  const FORMATIONS = deepFreeze({
    '4-4-2': formation(
      '4-4-2', '4-4-2', '4-4-2', '2-4-4',
      {
        buildup: '2-4-4',
        'settled-attack': '2-4-4',
        defend: '4-4-2',
        'positive-transition': '4-4-2',
        'negative-transition': '4-4-2'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LB', 'LB', 1, 0.14, 'support'),
        slot('LCB', 'CB', 1, 0.38, 'stopper'),
        slot('RCB', 'CB', 1, 0.62, 'cover'),
        slot('RB', 'RB', 1, 0.86, 'support'),
        slot('LM', 'LM', 2, 0.13, 'wide-support'),
        slot('LCM', 'CM', 2, 0.39, 'two-way'),
        slot('RCM', 'CM', 2, 0.61, 'two-way'),
        slot('RM', 'RM', 2, 0.87, 'wide-support'),
        slot('LST', 'ST', 3, 0.4, 'link-forward'),
        slot('RST', 'ST', 3, 0.6, 'run-in-behind')
      ],
      ['LST', 'RM', 'LM', 'RST'],
      2
    ),
    '4-3-3': formation(
      '4-3-3', '4-3-3', '4-1-4-1', '2-3-5',
      {
        buildup: '2-3-5',
        'settled-attack': '2-3-5',
        defend: '4-1-4-1',
        'positive-transition': '2-3-5',
        'negative-transition': '4-1-4-1'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LB', 'LB', 1, 0.14, 'support'),
        slot('LCB', 'CB', 1, 0.38, 'stopper'),
        slot('RCB', 'CB', 1, 0.62, 'cover'),
        slot('RB', 'RB', 1, 0.86, 'support'),
        slot('LCM', 'CM', 2, 0.27, 'progressor'),
        slot('CAM', 'CAM', 2, 0.5, 'creator'),
        slot('RCM', 'CM', 2, 0.73, 'two-way'),
        slot('LW', 'LW', 3, 0.13, 'wide-forward'),
        slot('ST', 'ST', 3, 0.5, 'run-in-behind'),
        slot('RW', 'RW', 3, 0.87, 'wide-forward')
      ],
      ['RW', 'LW', 'RCM', 'ST'],
      2
    ),
    '4-2-3-1': formation(
      '4-2-3-1', '4-2-3-1', '4-4-1-1', '2-3-5',
      {
        buildup: '2-3-5',
        'settled-attack': '2-3-5',
        defend: '4-4-1-1',
        'positive-transition': '4-2-3-1',
        'negative-transition': '4-4-1-1'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LB', 'LB', 1, 0.14, 'support'),
        slot('LCB', 'CB', 1, 0.38, 'stopper'),
        slot('RCB', 'CB', 1, 0.62, 'cover'),
        slot('RB', 'RB', 1, 0.86, 'support'),
        slot('LCDM', 'CDM', 2, 0.4, 'anchor'),
        slot('RCDM', 'CDM', 2, 0.6, 'progressor'),
        slot('LW', 'LW', 3, 0.13, 'wide-forward'),
        slot('CAM', 'CAM', 3, 0.5, 'creator'),
        slot('RW', 'RW', 3, 0.87, 'wide-forward'),
        slot('ST', 'ST', 4, 0.5, 'run-in-behind')
      ],
      ['RW', 'LW', 'CAM', 'ST'],
      2
    ),
    '3-5-2': formation(
      '3-5-2', '3-5-2', '5-3-2', '3-2-5',
      {
        buildup: '3-2-5',
        'settled-attack': '3-2-5',
        defend: '5-3-2',
        'positive-transition': '3-5-2',
        'negative-transition': '5-3-2'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LCB', 'CB', 1, 0.26, 'wide-cover'),
        slot('CB', 'CB', 1, 0.5, 'stopper'),
        slot('RCB', 'CB', 1, 0.74, 'wide-cover'),
        slot('LWB', 'LWB', 2, 0.07, 'two-way-width'),
        slot('LCM', 'CM', 2, 0.29, 'progressor'),
        slot('CDM', 'CDM', 2, 0.5, 'anchor'),
        slot('RCM', 'CM', 2, 0.71, 'two-way'),
        slot('RWB', 'RWB', 2, 0.93, 'two-way-width'),
        slot('LST', 'ST', 3, 0.4, 'link-forward'),
        slot('RST', 'ST', 3, 0.6, 'run-in-behind')
      ],
      ['RST', 'RWB', 'LST', 'LWB'],
      3
    ),
    '3-4-3': formation(
      '3-4-3', '3-4-3', '5-4-1', '3-2-5',
      {
        buildup: '3-4-2-1',
        'settled-attack': '3-2-5',
        defend: '5-4-1',
        'positive-transition': '3-4-3',
        'negative-transition': '5-4-1'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LCB', 'CB', 1, 0.26, 'wide-cover'),
        slot('CB', 'CB', 1, 0.5, 'stopper'),
        slot('RCB', 'CB', 1, 0.74, 'wide-cover'),
        slot('LWB', 'LWB', 2, 0.07, 'two-way-width'),
        slot('LCM', 'CM', 2, 0.4, 'progressor'),
        slot('RCM', 'CM', 2, 0.6, 'anchor'),
        slot('RWB', 'RWB', 2, 0.93, 'two-way-width'),
        slot('LW', 'LW', 3, 0.15, 'inside-forward'),
        slot('ST', 'ST', 3, 0.5, 'reference-forward'),
        slot('RW', 'RW', 3, 0.85, 'inside-forward')
      ],
      ['RW', 'LW', 'RWB', 'LWB'],
      3
    ),
    '5-3-2': formation(
      '5-3-2', '5-3-2', '5-3-2', '3-2-5',
      {
        buildup: '3-2-5',
        'settled-attack': '3-2-5',
        defend: '5-3-2',
        'positive-transition': '5-3-2',
        'negative-transition': '5-3-2'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LWB', 'LWB', 1, 0.07, 'two-way-width'),
        slot('LCB', 'CB', 1, 0.27, 'wide-cover'),
        slot('CB', 'CB', 1, 0.5, 'stopper'),
        slot('RCB', 'CB', 1, 0.73, 'wide-cover'),
        slot('RWB', 'RWB', 1, 0.93, 'two-way-width'),
        slot('LCM', 'CM', 2, 0.28, 'progressor'),
        slot('CM', 'CM', 2, 0.5, 'anchor'),
        slot('RCM', 'CM', 2, 0.72, 'two-way'),
        slot('LST', 'ST', 3, 0.4, 'link-forward'),
        slot('RST', 'ST', 3, 0.6, 'run-in-behind')
      ],
      ['RST', 'RWB', 'LST', 'LWB'],
      3
    ),
    '5-2-3': formation(
      '5-2-3', '5-2-3', '5-4-1', '3-2-5',
      {
        buildup: '3-2-5',
        'settled-attack': '3-2-5',
        defend: '5-4-1',
        'positive-transition': '5-2-3',
        'negative-transition': '5-4-1'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LWB', 'LWB', 1, 0.07, 'two-way-width'),
        slot('LCB', 'CB', 1, 0.27, 'wide-cover'),
        slot('CB', 'CB', 1, 0.5, 'stopper'),
        slot('RCB', 'CB', 1, 0.73, 'wide-cover'),
        slot('RWB', 'RWB', 1, 0.93, 'two-way-width'),
        slot('LCM', 'CM', 2, 0.4, 'progressor'),
        slot('RCM', 'CM', 2, 0.6, 'anchor'),
        slot('LW', 'LW', 3, 0.15, 'inside-forward'),
        slot('ST', 'ST', 3, 0.5, 'reference-forward'),
        slot('RW', 'RW', 3, 0.85, 'inside-forward')
      ],
      ['RW', 'LW', 'RWB', 'LWB'],
      3
    ),
    '4-5-1': formation(
      '4-5-1', '4-5-1', '4-5-1', '2-3-5',
      {
        buildup: '2-3-5',
        'settled-attack': '2-3-5',
        defend: '4-5-1',
        'positive-transition': '4-5-1',
        'negative-transition': '4-5-1'
      },
      [
        slot('GK', 'GK', 0, 0.5, 'sweeper-keeper'),
        slot('LB', 'LB', 1, 0.14, 'support'),
        slot('LCB', 'CB', 1, 0.38, 'stopper'),
        slot('RCB', 'CB', 1, 0.62, 'cover'),
        slot('RB', 'RB', 1, 0.86, 'support'),
        slot('LM', 'LM', 2, 0.09, 'wide-support'),
        slot('LCM', 'CM', 2, 0.29, 'progressor'),
        slot('CDM', 'CDM', 2, 0.5, 'anchor'),
        slot('RCM', 'CM', 2, 0.71, 'two-way'),
        slot('RM', 'RM', 2, 0.91, 'wide-support'),
        slot('ST', 'ST', 3, 0.5, 'reference-forward')
      ],
      ['RM', 'LM', 'RCM', 'ST'],
      2
    )
  });

  const FORMATION_INVENTORY = deepFreeze(Object.keys(FORMATIONS));

  const FORMATION_AUDIT = deepFreeze([
    { formation: '4-4-2', sources: ['quick-play', 'match-engine', 'create-club', 'career-mode'] },
    { formation: '4-3-3', sources: ['quick-play', 'match-engine', 'create-club', 'career-mode'] },
    { formation: '4-2-3-1', sources: ['quick-play', 'match-engine', 'create-club', 'career-mode'] },
    { formation: '3-5-2', sources: ['quick-play', 'match-engine', 'create-club', 'career-mode'] },
    { formation: '3-4-3', sources: ['quick-play', 'match-engine', 'historic-playtest'] },
    { formation: '5-3-2', sources: ['match-engine'] },
    { formation: '5-2-3', sources: ['match-engine'] },
    { formation: '4-5-1', sources: ['create-club', 'career-mode'] }
  ]);

  function normalizeFormationCode(value) {
    const text = String(value == null ? '' : value).trim();
    if (FORMATIONS[text]) return text;
    const compact = text.replace(/[^0-9]/g, '');
    const aliases = {
      442: '4-4-2',
      433: '4-3-3',
      4231: '4-2-3-1',
      352: '3-5-2',
      343: '3-4-3',
      532: '5-3-2',
      523: '5-2-3',
      451: '4-5-1'
    };
    return aliases[compact] || '';
  }

  function normalizePhase(value) {
    const text = String(value == null ? '' : value).trim().toLowerCase().replace(/_/g, '-');
    const aliases = {
      build: 'buildup',
      'build-up': 'buildup',
      attack: 'settled-attack',
      'settled-possession': 'settled-attack',
      defence: 'defend',
      defensive: 'defend',
      'positive-transition': 'positive-transition',
      'transition-positive': 'positive-transition',
      'negative-transition': 'negative-transition',
      'transition-negative': 'negative-transition'
    };
    if (PHASES.includes(text)) return text;
    return aliases[text] || '';
  }

  function validateFormation(value) {
    const normalized = normalizeFormationCode(value);
    return {
      valid: Boolean(normalized),
      formation: normalized,
      errors: normalized ? [] : [`Unsupported formation: ${String(value)}`]
    };
  }

  function canonicalLineup(formationCode) {
    const normalized = normalizeFormationCode(formationCode);
    if (!normalized) throw new Error(`Unsupported formation: ${String(formationCode)}`);
    return FORMATIONS[normalized].slots.map((formationSlot, index) => ({
      id: `${normalized}-player-${String(index + 1).padStart(2, '0')}`,
      slotId: formationSlot.id,
      position: formationSlot.position
    }));
  }

  function validateLineup(formationCode, lineup) {
    const normalized = normalizeFormationCode(formationCode);
    const errors = [];
    if (!normalized) {
      return { valid: false, formation: '', errors: [`Unsupported formation: ${String(formationCode)}`], assignments: [] };
    }
    const definition = FORMATIONS[normalized];
    if (!Array.isArray(lineup)) {
      return { valid: false, formation: normalized, errors: ['lineup must be an array'], assignments: [] };
    }
    if (lineup.length !== 11) errors.push(`lineup must contain 11 players; received ${lineup.length}`);
    const useSlotIds = lineup.length > 0 && lineup.every(row => row && typeof row.slotId === 'string');
    const bySlot = {};
    if (useSlotIds) {
      lineup.forEach(row => {
        if (bySlot[row.slotId]) errors.push(`duplicate slotId: ${row.slotId}`);
        bySlot[row.slotId] = row;
      });
    }
    const ids = {};
    const assignments = definition.slots.map((formationSlot, index) => {
      const player = useSlotIds ? bySlot[formationSlot.id] : lineup[index];
      if (!player || typeof player !== 'object') {
        errors.push(`missing player for slot ${formationSlot.id}`);
        return null;
      }
      const playerId = String(player.id == null ? '' : player.id);
      if (!playerId) errors.push(`slot ${formationSlot.id} requires a player id`);
      else if (ids[playerId]) errors.push(`duplicate player id: ${playerId}`);
      else ids[playerId] = true;
      const position = String(player.position == null ? '' : player.position).toUpperCase();
      if (!formationSlot.compatiblePositions.includes(position)) {
        errors.push(`${formationSlot.id} (${formationSlot.position}) rejects position ${position || '<empty>'}`);
      }
      return {
        playerId,
        slotId: formationSlot.id,
        position,
        expectedPosition: formationSlot.position,
        compatible: formationSlot.compatiblePositions.includes(position)
      };
    }).filter(Boolean);
    if (useSlotIds) {
      Object.keys(bySlot).forEach(slotId => {
        if (!definition.slots.some(formationSlot => formationSlot.id === slotId)) errors.push(`unknown slotId: ${slotId}`);
      });
    }
    const goalkeeperAssignments = assignments.filter(assignment => assignment.expectedPosition === 'GK');
    if (goalkeeperAssignments.length !== 1 || goalkeeperAssignments[0].position !== 'GK') {
      errors.push('lineup must assign exactly one goalkeeper to the GK slot');
    }
    return { valid: errors.length === 0, formation: normalized, errors, assignments };
  }

  function validatePhilosophyOverlay(value) {
    const errors = [];
    const source = value && typeof value === 'object' ? value : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) errors.push('philosophy overlay must be an object');
    const id = String(source.id == null ? '' : source.id).trim();
    const label = String(source.label == null ? '' : source.label).trim();
    const baseFormation = normalizeFormationCode(source.baseFormation);
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) errors.push('philosophy id must be a lowercase stable identifier');
    if (!label) errors.push('philosophy label is required');
    if (!baseFormation) errors.push(`unsupported philosophy baseFormation: ${String(source.baseFormation)}`);
    if (Object.prototype.hasOwnProperty.call(source, 'teamId') || Object.prototype.hasOwnProperty.call(source, 'teamIds')) {
      errors.push('philosophy overlays cannot contain team IDs');
    }
    const phaseShapes = source.phaseShapes && typeof source.phaseShapes === 'object' ? source.phaseShapes : {};
    Object.keys(phaseShapes).forEach(phase => {
      if (!normalizePhase(phase)) errors.push(`unknown phaseShapes phase: ${phase}`);
      if (!String(phaseShapes[phase] || '').trim()) errors.push(`phaseShapes.${phase} must be a non-empty shape label`);
    });
    const phaseModifiers = source.phaseModifiers && typeof source.phaseModifiers === 'object' ? source.phaseModifiers : {};
    Object.keys(phaseModifiers).forEach(phase => {
      const normalizedPhase = normalizePhase(phase);
      if (!normalizedPhase) errors.push(`unknown phaseModifiers phase: ${phase}`);
      const modifiers = phaseModifiers[phase];
      if (!modifiers || typeof modifiers !== 'object') errors.push(`phaseModifiers.${phase} must be an object`);
      else ['width', 'depth', 'compactness'].forEach(key => {
        if (modifiers[key] != null && !Number.isFinite(modifiers[key])) errors.push(`phaseModifiers.${phase}.${key} must be finite`);
      });
    });
    const adjustments = source.slotAdjustments && typeof source.slotAdjustments === 'object' ? source.slotAdjustments : {};
    Object.keys(adjustments).forEach(phase => {
      const normalizedPhase = normalizePhase(phase);
      if (!normalizedPhase) errors.push(`unknown slotAdjustments phase: ${phase}`);
      const rows = adjustments[phase];
      if (!rows || typeof rows !== 'object') errors.push(`slotAdjustments.${phase} must be an object`);
      else if (baseFormation) Object.keys(rows).forEach(slotId => {
        if (!FORMATIONS[baseFormation].slots.some(formationSlot => formationSlot.id === slotId)) {
          errors.push(`slotAdjustments.${phase} references unknown slot ${slotId}`);
        }
        const adjustment = rows[slotId];
        if (!adjustment || typeof adjustment !== 'object') errors.push(`slotAdjustments.${phase}.${slotId} must be an object`);
        else ['progress', 'longitudinalOffset', 'lateral', 'lateralOffset'].forEach(key => {
          if (adjustment[key] != null && !Number.isFinite(adjustment[key])) {
            errors.push(`slotAdjustments.${phase}.${slotId}.${key} must be finite`);
          }
        });
      });
    });
    const restDefence = source.restDefence && typeof source.restDefence === 'object' ? source.restDefence : {};
    Object.keys(restDefence).forEach(phase => {
      if (!normalizePhase(phase)) errors.push(`unknown restDefence phase: ${phase}`);
      if (!Number.isInteger(restDefence[phase]) || restDefence[phase] < 0 || restDefence[phase] > 6) {
        errors.push(`restDefence.${phase} must be an integer from 0 to 6`);
      }
    });
    const restDefenceExclusions = Array.isArray(source.restDefenceExclusions) ? source.restDefenceExclusions.map(String) : [];
    if (baseFormation) restDefenceExclusions.forEach(slotId => {
      if (!FORMATIONS[baseFormation].slots.some(formationSlot => formationSlot.id === slotId)) {
        errors.push(`restDefenceExclusions references unknown slot ${slotId}`);
      }
    });
    const carrierSupportFloors = source.carrierSupportFloors && typeof source.carrierSupportFloors === 'object'
      ? source.carrierSupportFloors : {};
    Object.keys(carrierSupportFloors).forEach(phase => {
      if (!normalizePhase(phase)) errors.push(`unknown carrierSupportFloors phase: ${phase}`);
      const rows = carrierSupportFloors[phase];
      if (!rows || typeof rows !== 'object' || Array.isArray(rows)) errors.push(`carrierSupportFloors.${phase} must be an object`);
      else if (baseFormation) Object.keys(rows).forEach(slotId => {
        if (!FORMATIONS[baseFormation].slots.some(formationSlot => formationSlot.id === slotId)) {
          errors.push(`carrierSupportFloors.${phase} references unknown slot ${slotId}`);
        }
        if (!Number.isFinite(rows[slotId]) || rows[slotId] < -1 || rows[slotId] > 1) {
          errors.push(`carrierSupportFloors.${phase}.${slotId} must be finite from -1 to 1`);
        }
      });
    });
    return {
      valid: errors.length === 0,
      errors,
      normalized: errors.length ? null : {
        schema: PHILOSOPHY_SCHEMA,
        id,
        label,
        baseFormation,
        phaseShapes: clone(phaseShapes),
        phaseModifiers: clone(phaseModifiers),
        slotAdjustments: clone(adjustments),
        restDefence: clone(restDefence),
        restDefenceExclusions: restDefenceExclusions.slice(),
        carrierSupportFloors: clone(carrierSupportFloors),
        principles: Array.isArray(source.principles) ? source.principles.map(String) : []
      }
    };
  }

  function createPhilosophyOverlay(value) {
    const validation = validatePhilosophyOverlay(value);
    if (!validation.valid) throw new Error(`Invalid philosophy overlay: ${validation.errors.join('; ')}`);
    return deepFreeze(validation.normalized);
  }

  const PHILOSOPHY_OVERLAYS = deepFreeze({
    'invincibles-442': createPhilosophyOverlay({
      id: 'invincibles-442',
      label: 'Invincibles 4-4-2 behaviour',
      baseFormation: '4-4-2',
      phaseShapes: {
        buildup: '4-4-1-1',
        'settled-attack': '3-2-5',
        defend: '4-4-2',
        'positive-transition': '4-4-1-1',
        'negative-transition': '4-4-2'
      },
      phaseModifiers: {
        buildup: { width: 1.02, depth: 1.02, compactness: 1.04 },
        'settled-attack': { width: 1.08, depth: 1.08, compactness: 1.02 },
        'positive-transition': { width: 1.04, depth: 1.12, compactness: 1 }
      },
      slotAdjustments: {
        buildup: {
          LB: { longitudinalOffset: 0.07, instruction: 'overlap left when the lane opens' },
          LM: { lateral: 0.31, longitudinalOffset: 0.04, instruction: 'arrive inside from the left' },
          LST: { longitudinalOffset: -0.08, instruction: 'drop between the lines as connector' },
          RST: { lateral: 0.56, longitudinalOffset: 0.04, instruction: 'threaten the left-centre channel' }
        },
        'settled-attack': {
          LB: { progress: 0.62, instruction: 'supply the fifth attacking lane' },
          LM: { lateral: 0.33, longitudinalOffset: 0.05, instruction: 'combine inside-left' },
          RM: { lateral: 0.68, longitudinalOffset: 0.05, instruction: 'make diagonal support runs' },
          LST: { progress: 0.7, lateral: 0.47, instruction: 'connect midfield and attack' },
          RST: { progress: 0.84, lateral: 0.4, instruction: 'attack depth from the left-centre lane' }
        },
        'positive-transition': {
          LST: { longitudinalOffset: -0.06, instruction: 'show for the first forward pass' },
          RST: { longitudinalOffset: 0.06, instruction: 'accelerate beyond the last line' }
        }
      },
      restDefence: { buildup: 3, 'settled-attack': 3, 'positive-transition': 3 },
      restDefenceExclusions: ['LB'],
      carrierSupportFloors: {
        'settled-attack': { LB: -0.08, LM: -0.03, LCM: -0.12, RCM: -0.12, RM: -0.03, LST: 0.02, RST: 0.1 }
      },
      principles: [
        'left-sided overlap and inside rotation',
        'one forward connects while one attacks depth',
        'three-player rest defence protects transitions'
      ]
    }),
    'conte-343': createPhilosophyOverlay({
      id: 'conte-343',
      label: 'Conte 3-4-3 behaviour',
      baseFormation: '3-4-3',
      phaseShapes: {
        buildup: '3-4-2-1',
        'settled-attack': '3-2-5',
        defend: '5-4-1',
        'positive-transition': '3-4-2-1',
        'negative-transition': '5-4-1'
      },
      phaseModifiers: {
        buildup: { width: 1.08, depth: 1, compactness: 1.03 },
        'settled-attack': { width: 1.14, depth: 1.06, compactness: 1.02 },
        defend: { width: 0.98, depth: 0.92, compactness: 1.14 },
        'negative-transition': { width: 0.98, depth: 0.95, compactness: 1.12 }
      },
      slotAdjustments: {
        buildup: {
          LWB: { lateral: 0.05, longitudinalOffset: 0.05, instruction: 'hold the outside left lane' },
          RWB: { lateral: 0.95, longitudinalOffset: 0.05, instruction: 'hold the outside right lane' },
          LW: { lateral: 0.38, longitudinalOffset: -0.08, instruction: 'receive in the left half-space' },
          RW: { lateral: 0.62, longitudinalOffset: -0.08, instruction: 'receive in the right half-space' }
        },
        'settled-attack': {
          LWB: { progress: 0.76, lateral: 0.05, instruction: 'occupy the fifth attacking lane' },
          RWB: { progress: 0.76, lateral: 0.95, instruction: 'occupy the fifth attacking lane' },
          LW: { lateral: 0.36, instruction: 'attack the left half-space' },
          RW: { lateral: 0.64, instruction: 'attack the right half-space' }
        },
        defend: {
          LWB: { progress: 0.18, lateral: 0.08, instruction: 'recover into the back five' },
          RWB: { progress: 0.18, lateral: 0.92, instruction: 'recover into the back five' },
          LW: { progress: 0.39, lateral: 0.25, instruction: 'screen the left midfield lane' },
          RW: { progress: 0.39, lateral: 0.75, instruction: 'screen the right midfield lane' },
          ST: { progress: 0.53, instruction: 'remain the single outlet' }
        },
        'negative-transition': {
          LWB: { progress: 0.2, instruction: 'recover immediately outside the left centre-back' },
          RWB: { progress: 0.2, instruction: 'recover immediately outside the right centre-back' }
        }
      },
      restDefence: { buildup: 3, 'settled-attack': 3, 'positive-transition': 3 },
      carrierSupportFloors: {
        'settled-attack': { LWB: -0.04, LCM: -0.1, RCM: -0.1, RWB: -0.04, LW: 0.02, ST: 0.08, RW: 0.02 }
      },
      principles: [
        'wing-backs provide full attacking width',
        'wide forwards receive in the half-spaces',
        'back three hold rest defence and wing-backs recover into a five'
      ]
    }),
    'ancelotti-bbc-433': createPhilosophyOverlay({
      id: 'ancelotti-bbc-433',
      label: 'Ancelotti BBC 4-3-3 behaviour',
      baseFormation: '4-3-3',
      phaseShapes: {
        buildup: '4-3-3',
        'settled-attack': '2-3-5',
        defend: '4-4-2',
        'positive-transition': '4-3-3',
        'negative-transition': '4-4-2'
      },
      phaseModifiers: {
        buildup: { width: 1.08, depth: 1.03, compactness: 1.02 },
        'settled-attack': { width: 1.12, depth: 1.12, compactness: 0.98 },
        defend: { width: 1.02, depth: 0.95, compactness: 1.08 },
        'positive-transition': { width: 1.1, depth: 1.18, compactness: 0.96 },
        'negative-transition': { width: 1, depth: 0.96, compactness: 1.1 }
      },
      slotAdjustments: {
        buildup: {
          LB: { lateral: 0.07, longitudinalOffset: 0.08, instruction: 'provide the outside left lane' },
          RB: { lateral: 0.93, longitudinalOffset: 0.04, instruction: 'support the right-side release' },
          LCM: { lateral: 0.35, longitudinalOffset: 0.06, instruction: 'carry through the left half-space' },
          CAM: { progress: 0.29, lateral: 0.5, instruction: 'anchor circulation behind the ball' },
          RCM: { lateral: 0.62, instruction: 'control tempo and connect the right' },
          ST: { longitudinalOffset: -0.08, instruction: 'drop to link the front three' },
          LW: { lateral: 0.25, instruction: 'start wide then attack the left-centre channel' },
          RW: { lateral: 0.76, instruction: 'hold width before an inside run' }
        },
        'settled-attack': {
          LB: { progress: 0.69, lateral: 0.06, instruction: 'supply full attacking width' },
          RB: { progress: 0.59, lateral: 0.94, instruction: 'support and protect the right lane' },
          LCM: { progress: 0.63, lateral: 0.36, instruction: 'arrive as the left-sided carrier' },
          CAM: { progress: 0.44, instruction: 'hold the central rest position' },
          ST: { progress: 0.7, instruction: 'connect midfield to both inside forwards' },
          LW: { progress: 0.86, lateral: 0.36, instruction: 'attack depth from the left-centre channel' },
          RW: { progress: 0.82, lateral: 0.66, instruction: 'make the right-to-centre power run' }
        },
        defend: {
          LCM: { progress: 0.37, lateral: 0.23, instruction: 'recover to the left midfield lane' },
          RCM: { progress: 0.37, lateral: 0.58, instruction: 'protect the central-right lane' },
          RW: { progress: 0.37, lateral: 0.8, instruction: 'recover into the right midfield line' },
          CAM: { progress: 0.3, lateral: 0.42, instruction: 'screen in front of the back four' },
          ST: { progress: 0.52, lateral: 0.55, instruction: 'remain a linking counter outlet' },
          LW: { progress: 0.55, lateral: 0.4, instruction: 'remain the primary depth outlet' }
        },
        'positive-transition': {
          ST: { longitudinalOffset: -0.05, instruction: 'show for the first forward pass' },
          LW: { longitudinalOffset: 0.1, lateral: 0.34, instruction: 'sprint into the left-centre channel' },
          RW: { longitudinalOffset: 0.09, lateral: 0.68, instruction: 'sprint inside from the right' },
          LCM: { longitudinalOffset: 0.06, instruction: 'carry the transition when the pass is blocked' }
        },
        'negative-transition': {
          CAM: { progress: 0.29, instruction: 'protect the centre immediately after loss' },
          RW: { progress: 0.38, lateral: 0.8, instruction: 'recover into the right midfield lane' },
          LCM: { progress: 0.38, lateral: 0.23, instruction: 'recover into the left midfield lane' }
        }
      },
      restDefence: { buildup: 3, 'settled-attack': 3, 'positive-transition': 3 },
      principles: [
        'Benzema links midfield to both wide forwards',
        'Ronaldo and Bale attack inside channels at counter speed',
        'the left central midfielder carries while the deepest midfielder anchors',
        'full-backs provide width without abandoning a three-player rest defence',
        'the team recovers into a credible 4-4-2 block'
      ]
    })
  });

  function resolvePhilosophy(value, formationCode) {
    if (value == null || value === '') return null;
    let overlay;
    if (typeof value === 'string') {
      overlay = PHILOSOPHY_OVERLAYS[value];
      if (!overlay) throw new Error(`Unknown philosophy overlay: ${value}`);
    } else {
      overlay = createPhilosophyOverlay(value);
    }
    if (overlay.baseFormation !== formationCode) {
      throw new Error(`Philosophy ${overlay.id} requires ${overlay.baseFormation}, not ${formationCode}`);
    }
    return overlay;
  }

  function pitchFrom(value, config) {
    const source = value && typeof value === 'object' ? value : {};
    const xMin = finite(source.xMin, 0);
    const xMax = finite(source.xMax, xMin + config.pitchLength);
    const yMin = finite(source.yMin, 0);
    const yMax = finite(source.yMax, yMin + config.pitchWidth);
    if (!(xMax > xMin) || !(yMax > yMin)) throw new Error('pitch bounds must have positive width and height');
    return { xMin, xMax, yMin, yMax };
  }

  function effectiveConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      pitchLength: Math.max(1, finite(source.pitchLength, DEFAULT_CONFIG.pitchLength)),
      pitchWidth: Math.max(1, finite(source.pitchWidth, DEFAULT_CONFIG.pitchWidth)),
      pitchMargin: Math.max(0, finite(source.pitchMargin, DEFAULT_CONFIG.pitchMargin)),
      offsideBuffer: Math.max(0, finite(source.offsideBuffer, DEFAULT_CONFIG.offsideBuffer)),
      minimumPlayers: DEFAULT_CONFIG.minimumPlayers,
      maximumPlayers: DEFAULT_CONFIG.maximumPlayers,
      minimumTacticalScale: DEFAULT_CONFIG.minimumTacticalScale,
      maximumTacticalScale: DEFAULT_CONFIG.maximumTacticalScale
    };
  }

  function phaseMapValue(object, phase) {
    if (!object || typeof object !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(object, phase)) return object[phase];
    return undefined;
  }

  function phaseAdjustments(overlay, phase) {
    return overlay && overlay.slotAdjustments && phaseMapValue(overlay.slotAdjustments, phase) || {};
  }

  function removeSlots(definition, unavailableSlotIds, playerCount) {
    const validIds = definition.slots.map(formationSlot => formationSlot.id);
    const removed = [];
    const unavailable = Array.isArray(unavailableSlotIds) ? unavailableSlotIds.map(String) : [];
    unavailable.forEach(slotId => {
      if (!validIds.includes(slotId)) throw new Error(`Unknown unavailable slot: ${slotId}`);
      if (slotId === 'GK') throw new Error('GK cannot be removed by outfield sent-off adaptation');
      if (!removed.includes(slotId)) removed.push(slotId);
    });
    const needed = 11 - playerCount;
    if (removed.length > needed) throw new Error('unavailableSlotIds exceeds requested playerCount reduction');
    definition.reductionOrder.forEach(slotId => {
      if (removed.length < needed && !removed.includes(slotId)) removed.push(slotId);
    });
    definition.slots.slice().reverse().forEach(formationSlot => {
      if (removed.length < needed && formationSlot.id !== 'GK' && !removed.includes(formationSlot.id)) {
        removed.push(formationSlot.id);
      }
    });
    return removed;
  }

  function longitudinalForBand(band, maximumBand, geometry) {
    if (band <= 0) return geometry.goalkeeper;
    if (maximumBand <= 1) return geometry.start;
    return geometry.start + ((band - 1) / (maximumBand - 1)) * (geometry.end - geometry.start);
  }

  function tacticalScale(value, config) {
    return clamp(finite(value, 1), config.minimumTacticalScale, config.maximumTacticalScale);
  }

  function metricsForTargets(targets) {
    const outfield = targets.filter(target => target.position !== 'GK');
    if (!outfield.length) return { width: 0, depth: 0, compactnessRadius: 0, centroid: { x: 0, y: 0 } };
    const xs = outfield.map(target => target.target.x);
    const ys = outfield.map(target => target.target.y);
    const centroid = {
      x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
      y: ys.reduce((sum, value) => sum + value, 0) / ys.length
    };
    const radius = outfield.reduce((sum, target) => {
      return sum + Math.hypot(target.target.x - centroid.x, target.target.y - centroid.y);
    }, 0) / outfield.length;
    return {
      width: rounded(Math.max(...ys) - Math.min(...ys), 3),
      depth: rounded(Math.max(...xs) - Math.min(...xs), 3),
      compactnessRadius: rounded(radius, 3),
      centroid: { x: rounded(centroid.x, 3), y: rounded(centroid.y, 3) }
    };
  }

  function resolve(request) {
    const input = request && typeof request === 'object' ? request : {};
    const config = effectiveConfig(input.config);
    const formationCode = normalizeFormationCode(input.formation);
    if (!formationCode) throw new Error(`Unsupported formation: ${String(input.formation)}`);
    const phase = normalizePhase(input.phase);
    if (!phase) throw new Error(`Unsupported phase: ${String(input.phase)}`);
    const definition = FORMATIONS[formationCode];
    const tick = input.tick == null ? 0 : input.tick;
    if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative simulation integer');
    const unavailableSlotIds = Array.isArray(input.unavailableSlotIds) ? input.unavailableSlotIds.map(String) : [];
    const inferredPlayerCount = 11 - unavailableSlotIds.length;
    const playerCount = input.playerCount == null ? inferredPlayerCount : input.playerCount;
    if (!Number.isInteger(playerCount) || playerCount < config.minimumPlayers || playerCount > config.maximumPlayers) {
      throw new Error(`playerCount must be an integer from ${config.minimumPlayers} to ${config.maximumPlayers}`);
    }
    const lineup = input.lineup == null ? canonicalLineup(formationCode) : input.lineup;
    const lineupValidation = validateLineup(formationCode, lineup);
    if (!lineupValidation.valid) throw new Error(`Invalid lineup: ${lineupValidation.errors.join('; ')}`);
    const assignmentBySlot = {};
    lineupValidation.assignments.forEach(assignment => {
      assignmentBySlot[assignment.slotId] = assignment;
    });
    const philosophy = resolvePhilosophy(input.philosophy, formationCode);
    const pitch = pitchFrom(input.pitch, config);
    const attackingDirection = input.attackingDirection === -1 ? -1 : 1;
    const mirrorLateral = Boolean(input.mirrorLateral);
    const defaultOffsideLine = attackingDirection === 1 ? pitch.xMax - config.pitchMargin : pitch.xMin + config.pitchMargin;
    const offsideLine = clamp(finite(input.offsideLine, defaultOffsideLine), pitch.xMin, pitch.xMax);
    const geometry = PHASE_GEOMETRY[phase];
    const overlayPhaseModifiers = philosophy && phaseMapValue(philosophy.phaseModifiers, phase) || {};
    const tactics = input.tactics && typeof input.tactics === 'object' ? input.tactics : {};
    const widthScale = tacticalScale(finite(tactics.width, 1) * finite(overlayPhaseModifiers.width, 1), config);
    const depthScale = tacticalScale(finite(tactics.depth, 1) * finite(overlayPhaseModifiers.depth, 1), config);
    const compactnessScale = tacticalScale(finite(tactics.compactness, 1) * finite(overlayPhaseModifiers.compactness, 1), config);
    const effectiveWidthScale = clamp(widthScale / compactnessScale, config.minimumTacticalScale, config.maximumTacticalScale);
    const effectiveDepthScale = clamp(depthScale / compactnessScale, config.minimumTacticalScale, config.maximumTacticalScale);
    const removedSlots = removeSlots(definition, unavailableSlotIds, playerCount);
    const adjustments = phaseAdjustments(philosophy, phase);
    const maximumBand = Math.max(...definition.slots.map(formationSlot => formationSlot.band));
    const phaseCentre = (geometry.start + geometry.end) / 2;

    const allGeometry = definition.slots.map((formationSlot, ordinal) => {
      const adjustment = adjustments[formationSlot.id] || {};
      const baseProgress = longitudinalForBand(formationSlot.band, maximumBand, geometry);
      const requestedProgress = Number.isFinite(adjustment.progress) ? adjustment.progress : baseProgress;
      const scaledProgress = phaseCentre + (requestedProgress - phaseCentre) * effectiveDepthScale;
      return {
        formationSlot,
        ordinal,
        progress: clamp(scaledProgress + finite(adjustment.longitudinalOffset, 0), 0.025, 0.95),
        lateral: clamp(Number.isFinite(adjustment.lateral) ? adjustment.lateral : formationSlot.lateral, 0.02, 0.98),
        instruction: String(adjustment.instruction || formationSlot.duty),
        removed: removedSlots.includes(formationSlot.id)
      };
    });

    const connectedDefence = input.ball && input.ball.position &&
      Number.isFinite(input.ball.position.x) && Number.isFinite(input.ball.position.y) &&
      (phase === 'defend' || phase === 'negative-transition');
    const activeGeometry = allGeometry.filter(row => !row.removed);
    const lineGroups = {};
    allGeometry.forEach(row => {
      const key = String(connectedDefence && ['centre-back', 'full-back', 'wing-back'].includes(row.formationSlot.roleFamily)
        ? 1 : row.formationSlot.band);
      if (!lineGroups[key]) lineGroups[key] = { all: [], active: [] };
      lineGroups[key].all.push(row);
      if (!row.removed) lineGroups[key].active.push(row);
    });
    Object.keys(lineGroups).forEach(key => {
      const group = lineGroups[key];
      if (!group.active.length || Number(key) === 0) return;
      const allLaterals = group.all.map(row => row.lateral).sort((a, b) => a - b);
      const minimum = allLaterals[0];
      const maximum = allLaterals[allLaterals.length - 1];
      const sortedActive = group.active.slice().sort((a, b) => a.lateral - b.lateral || a.ordinal - b.ordinal);
      sortedActive.forEach((row, index) => {
        let adapted = sortedActive.length === 1
          ? (minimum + maximum) / 2
          : minimum + (index / (sortedActive.length - 1)) * (maximum - minimum);
        const reductionScale = connectedDefence && Number(key) === 1 ? group.active.length / group.all.length : 1;
        adapted = 0.5 + (adapted - 0.5) * effectiveWidthScale * reductionScale;
        row.lateral = clamp(adapted, 0.02, 0.98);
      });
    });

    const activeOutfield = activeGeometry.filter(row => row.formationSlot.position !== 'GK');
    const requestedRestDefence = philosophy && phaseMapValue(philosophy.restDefence, phase);
    const restDefenceCount = clamp(
      Number.isInteger(requestedRestDefence) ? requestedRestDefence : definition.restDefence,
      0,
      Math.max(0, activeOutfield.length - 1)
    );
    const restDefenceExclusions = new Set(philosophy && philosophy.restDefenceExclusions || []);
    const restDefenceIds = activeOutfield.slice().sort((a, b) => {
      const aExcluded = restDefenceExclusions.has(a.formationSlot.id) ? 1 : 0;
      const bExcluded = restDefenceExclusions.has(b.formationSlot.id) ? 1 : 0;
      if (aExcluded !== bExcluded) return aExcluded - bExcluded;
      return a.formationSlot.restRank - b.formationSlot.restRank || a.ordinal - b.ordinal;
    }).slice(0, restDefenceCount).map(row => row.formationSlot.id);
    activeGeometry.forEach(row => {
      if (restDefenceIds.includes(row.formationSlot.id)) row.progress = Math.min(row.progress, geometry.restMaximum);
    });

    // Static anchors collapse behind an advancing carrier. Philosophy-owned
    // relative floors let support lanes travel with play while preserving the
    // selected rest defence and the normal pitch/offside clamps.
    const carrierProgress = clamp(finite(tactics.carrierProgress, NaN), 0, 1);
    const supportFloors = philosophy && phaseMapValue(philosophy.carrierSupportFloors, phase);
    if (supportFloors && Number.isFinite(carrierProgress)) {
      activeGeometry.forEach(row => {
        if (restDefenceIds.includes(row.formationSlot.id) || !Object.prototype.hasOwnProperty.call(supportFloors, row.formationSlot.id)) return;
        row.progress = clamp(Math.max(row.progress, carrierProgress + supportFloors[row.formationSlot.id]), 0.025, 0.95);
      });
    }

    // The phase/philosophy still owns the roles and relative lanes. Translate
    // their block with play rather than leaving the rest defence at fixed
    // pitch coordinates while the other lines follow a carrier.
    const ball = input.ball;
    let cohesion = null;
    if (ball && ball.position && Number.isFinite(ball.position.x) && Number.isFinite(ball.position.y)) {
      const length = pitch.xMax - pitch.xMin, width = pitch.yMax - pitch.yMin;
      const defending = phase === 'defend' || phase === 'negative-transition';
      const velocity = ball.free && ball.velocity ? ball.velocity : {};
      const referenceX = clamp(ball.position.x + finite(velocity.x, 0) * .8, pitch.xMin, pitch.xMax);
      const ballProgress = attackingDirection === 1 ? (referenceX - pitch.xMin) / length : (pitch.xMax - referenceX) / length;
      const lineProgress = clamp(ballProgress - (defending ? .15 : .30), .065, .55);
      const minimum = Math.min(...activeOutfield.map(row => row.progress));
      const maximum = Math.max(...activeOutfield.map(row => row.progress));
      const blockDepth = (defending ? .29 : .40) * effectiveDepthScale;
      const lateralScale = defending ? .82 : 1;
      const ballLateral = clamp((ball.position.y - pitch.yMin) / width, 0, 1);
      const requestedShift = (ballLateral - .5) * (mirrorLateral ? -1 : 1) * (defending ? .42 : .24);
      const laterals = activeOutfield.map(row => .5 + (row.lateral - .5) * lateralScale);
      // Bound the translation once for the unit, not separately per player.
      const shift = clamp(requestedShift, .03 - Math.min(...laterals), .97 - Math.max(...laterals));
      activeOutfield.forEach(row => {
        const defender = ['centre-back', 'full-back', 'wing-back'].includes(row.formationSlot.roleFamily);
        const relative = (row.progress - minimum) / Math.max(.01, maximum - minimum);
        row.progress = clamp(lineProgress + (defending && defender ? 0 : relative * blockDepth), .025, .95);
        row.lateral = .5 + (row.lateral - .5) * lateralScale + shift;
      });
      cohesion = { lineProgress: rounded(lineProgress), ballProgress: rounded(ballProgress),
        lateralShift: rounded(shift), defending, anticipationSeconds: ball.free ? .8 : 0 };
    }

    const xLow = pitch.xMin + Math.min(config.pitchMargin, (pitch.xMax - pitch.xMin) * 0.2);
    const xHigh = pitch.xMax - Math.min(config.pitchMargin, (pitch.xMax - pitch.xMin) * 0.2);
    const yLow = pitch.yMin + Math.min(config.pitchMargin, (pitch.yMax - pitch.yMin) * 0.2);
    const yHigh = pitch.yMax - Math.min(config.pitchMargin, (pitch.yMax - pitch.yMin) * 0.2);
    const targets = activeGeometry.sort((a, b) => a.ordinal - b.ordinal).map(row => {
      const canonicalX = attackingDirection === 1
        ? xLow + row.progress * (xHigh - xLow)
        : xHigh - row.progress * (xHigh - xLow);
      const unmirroredY = yLow + row.lateral * (yHigh - yLow);
      let x = clamp(canonicalX, xLow, xHigh);
      let offsideClamped = false;
      if (row.formationSlot.position !== 'GK') {
        if (attackingDirection === 1) {
          const maximumOnside = Math.max(xLow, offsideLine - config.offsideBuffer);
          if (x > maximumOnside) { x = maximumOnside; offsideClamped = true; }
        } else {
          const minimumOnside = Math.min(xHigh, offsideLine + config.offsideBuffer);
          if (x < minimumOnside) { x = minimumOnside; offsideClamped = true; }
        }
      }
      const y = mirrorLateral ? pitch.yMin + pitch.yMax - unmirroredY : unmirroredY;
      const normalizedProgress = attackingDirection === 1
        ? (x - xLow) / Math.max(1e-9, xHigh - xLow)
        : (xHigh - x) / Math.max(1e-9, xHigh - xLow);
      const assignment = assignmentBySlot[row.formationSlot.id];
      return {
        slotId: row.formationSlot.id,
        playerId: assignment.playerId,
        position: assignment.position,
        expectedPosition: row.formationSlot.position,
        roleFamily: row.formationSlot.roleFamily,
        side: row.formationSlot.side,
        duty: row.formationSlot.duty,
        instruction: row.instruction,
        restDefence: restDefenceIds.includes(row.formationSlot.id),
        offsideClamped,
        normalized: {
          progress: rounded(normalizedProgress),
          lateral: rounded(mirrorLateral ? 1 - row.lateral : row.lateral)
        },
        target: { x: rounded(x, 4), y: rounded(y, 4) }
      };
    });

    const shapeLabel = philosophy && phaseMapValue(philosophy.phaseShapes, phase) || definition.phaseShapes[phase];
    const metrics = metricsForTargets(targets);
    const telemetry = {
      schema: TELEMETRY_SCHEMA,
      version: VERSION,
      authority: 'dormant-candidate',
      tick,
      formation: formationCode,
      phase,
      canonicalShapes: clone(definition.canonicalShapes),
      phaseShape: shapeLabel,
      philosophy: philosophy ? { id: philosophy.id, label: philosophy.label } : null,
      playerCount,
      adaptation: {
        type: removedSlots.length ? 'deterministic-player-count-reduction' : 'full-eleven',
        unavailableSlotIds: unavailableSlotIds.slice(),
        removedSlotIds: removedSlots.slice(),
        activeSlotIds: targets.map(target => target.slotId)
      },
      restDefence: { requested: restDefenceCount, slotIds: restDefenceIds.slice() },
      tactics: {
        width: rounded(widthScale),
        depth: rounded(depthScale),
        compactness: rounded(compactnessScale),
        effectiveWidth: rounded(effectiveWidthScale),
        effectiveDepth: rounded(effectiveDepthScale)
      },
      bounds: {
        pitch: clone(pitch),
        inset: rounded(config.pitchMargin),
        offsideLine: rounded(offsideLine),
        offsideBuffer: rounded(config.offsideBuffer),
        attackingDirection,
        mirrorLateral,
        clampedSlotIds: targets.filter(target => target.offsideClamped).map(target => target.slotId)
      },
      metrics,
      ...(cohesion ? { cohesion } : {})
    };

    return {
      schema: OUTPUT_SCHEMA,
      version: VERSION,
      tick,
      formation: formationCode,
      phase,
      phaseShape: shapeLabel,
      attackingDirection,
      mirrorLateral,
      targets,
      telemetry
    };
  }

  function stableTelemetryJson(outputOrTelemetry) {
    const value = outputOrTelemetry && outputOrTelemetry.telemetry
      ? outputOrTelemetry.telemetry
      : outputOrTelemetry;
    return stableJson(value);
  }

  return Object.freeze({
    VERSION,
    REQUEST_SCHEMA,
    OUTPUT_SCHEMA,
    TELEMETRY_SCHEMA,
    PHILOSOPHY_SCHEMA,
    PHASES,
    DEFAULT_CONFIG,
    POSITION_COMPATIBILITY,
    FORMATION_INVENTORY,
    FORMATION_AUDIT,
    FORMATIONS,
    PHILOSOPHY_OVERLAYS,
    normalizeFormationCode,
    normalizePhase,
    validateFormation,
    canonicalLineup,
    validateLineup,
    validatePhilosophyOverlay,
    createPhilosophyOverlay,
    resolve,
    stableTelemetryJson
  });
});
