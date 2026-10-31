import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const modulePath = path.join(root, 'match-engine', 'formation-behaviour-v2.js');
const matchPath = path.join(root, 'match-engine', 'match.html');
const quickPlayPath = path.join(root, 'quick-play', 'app.js');
const createClubPath = path.join(root, 'create-club', 'index.html');
const careerSystemsPath = path.join(root, 'career-mode', 'js', 'career-systems.js');
const source = fs.readFileSync(modulePath, 'utf8');
const matchHtml = fs.readFileSync(matchPath, 'utf8');
const quickPlay = fs.readFileSync(quickPlayPath, 'utf8');
const createClub = fs.readFileSync(createClubPath, 'utf8');
const careerSystems = fs.readFileSync(careerSystemsPath, 'utf8');
const require = createRequire(import.meta.url);
const Formation = require(modulePath);

const EXPECTED_INVENTORY = ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '3-4-3', '5-3-2', '5-2-3', '4-5-1'];

function request(data = {}) {
  return {
    schema: Formation.REQUEST_SCHEMA,
    tick: data.tick ?? 100,
    formation: data.formation || '4-4-2',
    phase: data.phase || 'settled-attack',
    pitch: data.pitch || { xMin: 0, xMax: 105, yMin: 0, yMax: 68 },
    attackingDirection: data.attackingDirection ?? 1,
    offsideLine: data.offsideLine ?? (data.attackingDirection === -1 ? 0 : 105),
    ...data
  };
}

function formationCodesFromRepository() {
  const discovered = new Set();
  const quickStart = quickPlay.indexOf('const FORMATIONS={');
  const quickEnd = quickPlay.indexOf('const TACTIC_OPTIONS=', quickStart);
  const quickBlock = quickPlay.slice(quickStart, quickEnd);
  for (const match of quickBlock.matchAll(/'([0-9](?:-[0-9])+)':\s*\[/g)) discovered.add(match[1]);

  const matchStart = matchHtml.indexOf('const sets={', matchHtml.indexOf('function formationSlots'));
  const matchEnd = matchHtml.indexOf('const unitRoles={', matchStart);
  const matchBlock = matchHtml.slice(matchStart, matchEnd);
  for (const match of matchBlock.matchAll(/'([0-9]+)':\s*\[/g)) {
    const normalized = Formation.normalizeFormationCode(match[1]);
    if (normalized) discovered.add(normalized);
  }

  for (const match of createClub.matchAll(/<option value="(442|433|4231|352|343|532|523|451)">/g)) {
    discovered.add(Formation.normalizeFormationCode(match[1]));
  }

  const careerMatch = careerSystems.match(/formations=\[([^\]]+)\]/);
  assert.ok(careerMatch, 'career formation pool must be discoverable');
  for (const match of careerMatch[1].matchAll(/'([0-9](?:-[0-9])*)'/g)) discovered.add(match[1]);
  return discovered;
}

function targetBySlot(output, slotId) {
  const target = output.targets.find(row => row.slotId === slotId);
  assert.ok(target, `missing target ${slotId}`);
  return target;
}

test('CommonJS module exposes the complete dormant Formation V2 API', () => {
  assert.equal(Formation.VERSION, '2.0.0-dormant');
  assert.equal(Formation.REQUEST_SCHEMA, 'football-legacy-formation-request-v2');
  assert.equal(Formation.OUTPUT_SCHEMA, 'football-legacy-formation-output-v2');
  assert.equal(Formation.TELEMETRY_SCHEMA, 'football-legacy-formation-telemetry-v2');
  for (const name of [
    'normalizeFormationCode',
    'validateFormation',
    'canonicalLineup',
    'validateLineup',
    'validatePhilosophyOverlay',
    'createPhilosophyOverlay',
    'resolve',
    'stableTelemetryJson'
  ]) assert.equal(typeof Formation[name], 'function', `${name} must be exported`);
});

test('plain browser script exposes window.FootballLegacyFormationBehaviourV2', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow });
  const browserApi = browserWindow.FootballLegacyFormationBehaviourV2;
  assert.equal(browserApi.VERSION, Formation.VERSION);
  assert.equal(typeof browserApi.resolve, 'function');
  assert.deepEqual(Array.from(browserApi.FORMATION_INVENTORY), EXPECTED_INVENTORY);
});

test('EXACT-FLAG AUTHORITY GATE: Formation V2 is conditional and limited to stable shadow identities', () => {
  assert.doesNotMatch(matchHtml, /<script\s+src=["']formation-behaviour-v2\.js/i);
  assert.match(matchHtml, /const api=window\.FootballLegacyFormationBehaviourV2/);
  assert.doesNotMatch(matchHtml, /FootballLegacyFormationBehaviourV2\.(?:resolve|apply|project)\s*\(/);
  assert.match(source, /intentionally dormant/i);
  assert.match(source, /Build 173 remains the sole live authority/i);
});

test('determinism gate: module has no random or presentation-clock dependency', () => {
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /new\s+Date\s*\(/);
  assert.doesNotMatch(source, /performance\.(?:now|timeOrigin)\s*\(/);
  assert.doesNotMatch(source, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
});

test('FULL INVENTORY COVERAGE GATE: repository union exactly matches the eight data contracts', () => {
  const discovered = formationCodesFromRepository();
  assert.deepEqual(Array.from(discovered).sort(), EXPECTED_INVENTORY.slice().sort());
  assert.deepEqual(Array.from(Formation.FORMATION_INVENTORY), EXPECTED_INVENTORY);
  assert.deepEqual(Formation.FORMATION_AUDIT.map(row => row.formation), EXPECTED_INVENTORY);
  for (const row of Formation.FORMATION_AUDIT) assert.ok(row.sources.length > 0, `${row.formation} needs audit evidence`);
});

test('each formation has exactly eleven unique, role-valid slots and one goalkeeper', () => {
  for (const code of EXPECTED_INVENTORY) {
    const definition = Formation.FORMATIONS[code];
    assert.ok(definition, `${code} definition missing`);
    assert.equal(definition.slots.length, 11, `${code} must include a full eleven`);
    assert.equal(new Set(definition.slots.map(row => row.id)).size, 11, `${code} slot IDs must be unique`);
    assert.equal(definition.slots.filter(row => row.position === 'GK').length, 1, `${code} must have one GK`);
    assert.equal(definition.slots[0].id, 'GK');
    for (const row of definition.slots) {
      assert.ok(row.compatiblePositions.includes(row.position), `${code}/${row.id} rejects its canonical position`);
      assert.ok(['left', 'centre', 'right'].includes(row.side));
      assert.ok(Number.isFinite(row.lateral) && row.lateral > 0 && row.lateral < 1);
      assert.ok(Number.isInteger(row.band) && row.band >= 0);
    }
    assert.equal(Formation.validateLineup(code, Formation.canonicalLineup(code)).valid, true);
  }
});

test('all five phases resolve to safe eleven-player shapes for every audited formation', () => {
  for (const formation of EXPECTED_INVENTORY) {
    for (const phase of Formation.PHASES) {
      const output = Formation.resolve(request({ formation, phase }));
      assert.equal(output.schema, Formation.OUTPUT_SCHEMA);
      assert.equal(output.targets.length, 11, `${formation}/${phase}`);
      assert.equal(output.telemetry.playerCount, 11);
      assert.equal(output.telemetry.phaseShape, Formation.FORMATIONS[formation].phaseShapes[phase]);
      const shapeTotal = output.phaseShape.split('-').reduce((sum, value) => sum + Number(value), 0);
      assert.equal(shapeTotal, 10, `${formation}/${phase} shape must account for ten outfield players`);
      for (const target of output.targets) {
        assert.ok(Number.isFinite(target.target.x) && Number.isFinite(target.target.y));
        assert.ok(target.target.x >= 0.75 && target.target.x <= 104.25);
        assert.ok(target.target.y >= 0.75 && target.target.y <= 67.25);
      }
    }
  }
});

test('snapshot-to-shape resolution is pure, deterministic and JSON-safe', () => {
  const input = request({ formation: '4-2-3-1', phase: 'positive-transition', tick: 913 });
  const before = JSON.stringify(input);
  const first = Formation.resolve(input);
  const second = Formation.resolve(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.tick, 913);
  assert.throws(() => Formation.resolve({ ...input, tick: -1 }), /tick/);
  assert.throws(() => Formation.resolve({ ...input, tick: 1.5 }), /tick/);
});

test('role-slot validation accepts stable slot mapping and rejects incompatible or duplicate players', () => {
  const canonical = Formation.canonicalLineup('4-4-2');
  assert.equal(Formation.validateLineup('442', canonical.slice().reverse()).valid, true, 'slot IDs permit stable unordered input');
  const incompatible = canonical.map(row => ({ ...row }));
  incompatible.find(row => row.slotId === 'LB').position = 'ST';
  const incompatibleResult = Formation.validateLineup('4-4-2', incompatible);
  assert.equal(incompatibleResult.valid, false);
  assert.match(incompatibleResult.errors.join(' '), /LB.*rejects position ST/);
  const duplicate = canonical.map(row => ({ ...row }));
  duplicate[2].id = duplicate[1].id;
  assert.match(Formation.validateLineup('4-4-2', duplicate).errors.join(' '), /duplicate player id/);
  assert.equal(Formation.validateLineup('4-4-2', canonical.slice(0, 10)).valid, false);
  assert.throws(() => Formation.resolve(request({ lineup: incompatible })), /Invalid lineup/);
});

test('pitch and offside bounds are authoritative in both attacking directions', () => {
  const pitch = { xMin: 10, xMax: 115, yMin: 5, yMax: 73 };
  const forward = Formation.resolve(request({ pitch, offsideLine: 74, attackingDirection: 1 }));
  const reverse = Formation.resolve(request({ pitch, offsideLine: 46, attackingDirection: -1 }));
  for (const target of forward.targets) {
    assert.ok(target.target.x >= 10.75 && target.target.x <= 114.25);
    assert.ok(target.target.y >= 5.75 && target.target.y <= 72.25);
    if (target.position !== 'GK') assert.ok(target.target.x <= 73.5 + 1e-9);
  }
  for (const target of reverse.targets) {
    assert.ok(target.target.x >= 10.75 && target.target.x <= 114.25);
    assert.ok(target.target.y >= 5.75 && target.target.y <= 72.25);
    if (target.position !== 'GK') assert.ok(target.target.x >= 46.5 - 1e-9);
  }
  assert.ok(forward.telemetry.bounds.clampedSlotIds.length > 0);
  assert.ok(reverse.telemetry.bounds.clampedSlotIds.length > 0);
});

test('width, depth and compactness controls produce monotonic geometry changes', () => {
  const narrow = Formation.resolve(request({ tactics: { width: 0.7, depth: 1, compactness: 1 } }));
  const wide = Formation.resolve(request({ tactics: { width: 1.3, depth: 1, compactness: 1 } }));
  assert.ok(wide.telemetry.metrics.width > narrow.telemetry.metrics.width);
  const shallow = Formation.resolve(request({ phase: 'defend', tactics: { width: 1, depth: 0.7, compactness: 1 } }));
  const deep = Formation.resolve(request({ phase: 'defend', tactics: { width: 1, depth: 1.3, compactness: 1 } }));
  assert.ok(deep.telemetry.metrics.depth > shallow.telemetry.metrics.depth);
  const loose = Formation.resolve(request({ tactics: { width: 1, depth: 1, compactness: 0.7 } }));
  const compact = Formation.resolve(request({ tactics: { width: 1, depth: 1, compactness: 1.3 } }));
  assert.ok(compact.telemetry.metrics.compactnessRadius < loose.telemetry.metrics.compactnessRadius);
});

test('rest-defence gate marks the requested stable cover unit behind the attack', () => {
  for (const formation of EXPECTED_INVENTORY) {
    const output = Formation.resolve(request({ formation, phase: 'settled-attack' }));
    const expected = Formation.FORMATIONS[formation].restDefence;
    const rest = output.targets.filter(target => target.restDefence);
    assert.equal(rest.length, expected, formation);
    assert.deepEqual(rest.map(target => target.slotId), output.telemetry.restDefence.slotIds);
    for (const target of rest) assert.ok(target.normalized.progress <= 0.48 + 1e-4, `${formation}/${target.slotId}`);
  }
});

test('sent-off/player-count adaptation is deterministic from ten down to seven and retains the goalkeeper', () => {
  for (const formation of EXPECTED_INVENTORY) {
    for (const playerCount of [10, 9, 8, 7]) {
      const input = request({ formation, phase: 'negative-transition', playerCount });
      const first = Formation.resolve(input);
      const second = Formation.resolve(input);
      assert.deepEqual(first, second);
      assert.equal(first.targets.length, playerCount, `${formation}/${playerCount}`);
      assert.ok(first.targets.some(target => target.slotId === 'GK'));
      assert.equal(first.telemetry.adaptation.removedSlotIds.length, 11 - playerCount);
      assert.equal(new Set(first.telemetry.adaptation.removedSlotIds).size, 11 - playerCount);
      assert.equal(first.telemetry.adaptation.type, 'deterministic-player-count-reduction');
    }
  }
  const explicit = Formation.resolve(request({ playerCount: 10, unavailableSlotIds: ['LST'] }));
  assert.deepEqual(explicit.telemetry.adaptation.removedSlotIds, ['LST']);
  assert.throws(() => Formation.resolve(request({ playerCount: 6 })), /playerCount/);
  assert.throws(() => Formation.resolve(request({ playerCount: 12 })), /playerCount/);
  assert.throws(() => Formation.resolve(request({ playerCount: 10, unavailableSlotIds: ['GK'] })), /GK cannot be removed/);
});

test('lateral mirroring is stable, including a reduced ten-player philosophy shape', () => {
  const pitch = { xMin: 3, xMax: 108, yMin: 5, yMax: 73 };
  const baseInput = request({
    formation: '4-4-2',
    phase: 'settled-attack',
    philosophy: 'invincibles-442',
    playerCount: 10,
    unavailableSlotIds: ['LST'],
    pitch
  });
  const normal = Formation.resolve({ ...baseInput, mirrorLateral: false });
  const mirrored = Formation.resolve({ ...baseInput, mirrorLateral: true });
  assert.deepEqual(normal.targets.map(row => row.slotId), mirrored.targets.map(row => row.slotId));
  for (const row of normal.targets) {
    const reflected = targetBySlot(mirrored, row.slotId);
    assert.equal(reflected.target.x, row.target.x);
    assert.ok(Math.abs(reflected.target.y + row.target.y - (pitch.yMin + pitch.yMax)) < 1e-8, row.slotId);
    assert.ok(Math.abs(reflected.normalized.lateral + row.normalized.lateral - 1) < 1e-8, row.slotId);
  }
});

test('attacking-direction mirroring is stable when offside bounds are mirrored too', () => {
  const forward = Formation.resolve(request({ formation: '3-5-2', attackingDirection: 1, offsideLine: 105 }));
  const reverse = Formation.resolve(request({ formation: '3-5-2', attackingDirection: -1, offsideLine: 0 }));
  for (const row of forward.targets) {
    const reflected = targetBySlot(reverse, row.slotId);
    assert.ok(Math.abs(reflected.target.x + row.target.x - 105) < 1e-8, row.slotId);
    assert.equal(reflected.target.y, row.target.y);
  }
});

test('Invincibles 4-4-2 is a reusable philosophy overlay, not a team-ID branch', () => {
  const overlay = Formation.PHILOSOPHY_OVERLAYS['invincibles-442'];
  assert.equal(overlay.baseFormation, '4-4-2');
  const buildup = Formation.resolve(request({ formation: '4-4-2', phase: 'buildup', philosophy: overlay.id }));
  const attack = Formation.resolve(request({ formation: '4-4-2', phase: 'settled-attack', philosophy: overlay.id }));
  assert.equal(buildup.phaseShape, '4-4-1-1');
  assert.equal(attack.phaseShape, '3-2-5');
  assert.equal(attack.telemetry.restDefence.slotIds.length, 3);
  assert.equal(attack.telemetry.restDefence.slotIds.includes('LB'), false, 'Cole lane must not be selected into the back three');
  assert.equal(attack.telemetry.restDefence.slotIds.includes('RB'), true, 'right back forms the asymmetric back three');
  assert.match(targetBySlot(buildup, 'LB').instruction, /overlap/i);
  assert.match(targetBySlot(buildup, 'LST').instruction, /connector/i);
  assert.doesNotMatch(source, /woolwich-arsenal|west-london-blues/);
  assert.equal(Object.prototype.hasOwnProperty.call(overlay, 'teamId'), false);
});

test('Invincibles settled attack advances support relative to an advanced carrier', () => {
  const staticShape = Formation.resolve(request({ formation: '4-4-2', phase: 'settled-attack', philosophy: 'invincibles-442' }));
  const advanced = Formation.resolve(request({ formation: '4-4-2', phase: 'settled-attack', philosophy: 'invincibles-442', tactics: { carrierProgress: 0.74 } }));
  for (const slotId of ['LB', 'LM', 'RM', 'LST', 'RST']) {
    assert.ok(targetBySlot(advanced, slotId).normalized.progress >= targetBySlot(staticShape, slotId).normalized.progress, slotId);
  }
  assert.ok(targetBySlot(advanced, 'LST').normalized.progress >= 0.75, 'connector stays near the carrier');
  assert.ok(targetBySlot(advanced, 'RST').normalized.progress >= 0.83, 'depth runner stays beyond the carrier');
  assert.ok(targetBySlot(advanced, 'LM').normalized.progress >= 0.70, 'left support lane follows play');
  assert.ok(targetBySlot(advanced, 'RM').normalized.progress >= 0.70, 'right support lane follows play');
  assert.equal(targetBySlot(advanced, 'RB').restDefence, true);
  assert.equal(targetBySlot(advanced, 'LB').restDefence, false);
});

test('Conte 3-4-3 is a reusable 3-4-2-1 / 5-4-1 philosophy overlay', () => {
  const overlay = Formation.PHILOSOPHY_OVERLAYS['conte-343'];
  assert.equal(overlay.baseFormation, '3-4-3');
  const buildup = Formation.resolve(request({ formation: '3-4-3', phase: 'buildup', philosophy: overlay.id }));
  const defend = Formation.resolve(request({ formation: '3-4-3', phase: 'defend', philosophy: overlay.id }));
  assert.equal(buildup.phaseShape, '3-4-2-1');
  assert.equal(defend.phaseShape, '5-4-1');
  assert.ok(targetBySlot(defend, 'LWB').normalized.progress <= 0.22);
  assert.ok(targetBySlot(defend, 'RWB').normalized.progress <= 0.22);
  assert.match(targetBySlot(buildup, 'LW').instruction, /half-space/i);
  assert.equal(Object.prototype.hasOwnProperty.call(overlay, 'teamId'), false);
});

test('Conte settled attack carries both central midfielders and all five attacking lanes with a wide carrier', () => {
  const staticShape = Formation.resolve(request({ formation: '3-4-3', phase: 'settled-attack', philosophy: 'conte-343' }));
  const advanced = Formation.resolve(request({ formation: '3-4-3', phase: 'settled-attack', philosophy: 'conte-343', tactics: { carrierProgress: 0.72 } }));
  for (const slotId of ['LWB', 'LCM', 'RCM', 'RWB', 'LW', 'ST', 'RW']) {
    assert.ok(targetBySlot(advanced, slotId).normalized.progress >= targetBySlot(staticShape, slotId).normalized.progress, slotId);
  }
  assert.ok(targetBySlot(advanced, 'LCM').normalized.progress >= 0.62, 'left central midfielder remains a forward support option');
  assert.ok(targetBySlot(advanced, 'RCM').normalized.progress >= 0.62, 'right central midfielder remains a forward support option');
  assert.ok(targetBySlot(advanced, 'ST').normalized.progress >= 0.8, 'striker remains the high outlet');
  assert.equal(advanced.telemetry.restDefence.slotIds.length, 3);
});

test('Ancelotti BBC 4-3-3 is a reusable counterattacking and 4-4-2 recovery overlay', () => {
  const overlay = Formation.PHILOSOPHY_OVERLAYS['ancelotti-bbc-433'];
  assert.equal(overlay.baseFormation, '4-3-3');
  const buildup = Formation.resolve(request({ formation: '4-3-3', phase: 'buildup', philosophy: overlay.id }));
  const attack = Formation.resolve(request({ formation: '4-3-3', phase: 'settled-attack', philosophy: overlay.id }));
  const defend = Formation.resolve(request({ formation: '4-3-3', phase: 'defend', philosophy: overlay.id }));
  const transition = Formation.resolve(request({ formation: '4-3-3', phase: 'positive-transition', philosophy: overlay.id }));
  assert.equal(buildup.phaseShape, '4-3-3');
  assert.equal(attack.phaseShape, '2-3-5');
  assert.equal(defend.phaseShape, '4-4-2');
  assert.equal(transition.phaseShape, '4-3-3');
  assert.equal(attack.telemetry.restDefence.slotIds.length, 3);
  assert.match(targetBySlot(buildup, 'ST').instruction, /link the front three/i);
  assert.match(targetBySlot(transition, 'LW').instruction, /left-centre channel/i);
  assert.match(targetBySlot(defend, 'RW').instruction, /right midfield line/i);
  assert.ok(targetBySlot(attack, 'LB').normalized.lateral < 0.1);
  assert.ok(targetBySlot(attack, 'LW').normalized.progress > targetBySlot(attack, 'ST').normalized.progress);
  assert.equal(Object.prototype.hasOwnProperty.call(overlay, 'teamId'), false);
  assert.doesNotMatch(JSON.stringify(overlay), /madrid-real-2013-14/);
});

test('career-facing philosophy interface accepts pure custom overlays and rejects team coupling', () => {
  const before = JSON.stringify(Formation.FORMATIONS['4-3-3']);
  const customSpec = {
    id: 'patient-433',
    label: 'Patient 4-3-3',
    baseFormation: '4-3-3',
    phaseShapes: { buildup: '2-3-5' },
    phaseModifiers: { buildup: { width: 1.05, depth: 0.9, compactness: 1.08 } },
    slotAdjustments: { buildup: { CAM: { longitudinalOffset: -0.04, instruction: 'show between midfield lines' } } },
    restDefence: { buildup: 3 },
    principles: ['patient circulation before penetration']
  };
  const overlay = Formation.createPhilosophyOverlay(customSpec);
  assert.equal(overlay.schema, Formation.PHILOSOPHY_SCHEMA);
  const output = Formation.resolve(request({ formation: '4-3-3', phase: 'buildup', philosophy: overlay }));
  assert.equal(output.telemetry.philosophy.id, 'patient-433');
  assert.equal(output.telemetry.restDefence.slotIds.length, 3);
  assert.match(targetBySlot(output, 'CAM').instruction, /between midfield lines/);
  assert.equal(JSON.stringify(Formation.FORMATIONS['4-3-3']), before, 'base contract must remain immutable');
  const coupled = Formation.validatePhilosophyOverlay({ ...customSpec, teamId: 'some-club' });
  assert.equal(coupled.valid, false);
  assert.match(coupled.errors.join(' '), /cannot contain team IDs/);
  assert.throws(() => Formation.resolve(request({ formation: '4-4-2', philosophy: overlay })), /requires 4-3-3/);
});

test('stable JSON telemetry is byte-identical and key-canonical', () => {
  const first = Formation.resolve(request({ formation: '5-2-3', phase: 'positive-transition', playerCount: 9 }));
  const second = Formation.resolve(request({ formation: '523', phase: 'positive_transition', playerCount: 9 }));
  const firstJson = Formation.stableTelemetryJson(first);
  const secondJson = Formation.stableTelemetryJson(second);
  assert.equal(firstJson, secondJson);
  assert.deepEqual(JSON.parse(firstJson), JSON.parse(JSON.stringify(first.telemetry)));
  assert.ok(firstJson.startsWith('{"adaptation":'), 'stable serializer sorts object keys');
  assert.equal(JSON.parse(firstJson).authority, 'dormant-candidate');
});

test('safety guards reject malformed formation, phase, pitch, player count and philosophy data', () => {
  assert.equal(Formation.validateFormation('442').formation, '4-4-2');
  assert.equal(Formation.validateFormation('9-9-9').valid, false);
  assert.throws(() => Formation.resolve(request({ formation: '9-9-9' })), /Unsupported formation/);
  assert.throws(() => Formation.resolve(request({ phase: 'half-time-show' })), /Unsupported phase/);
  assert.throws(() => Formation.resolve(request({ pitch: { xMin: 5, xMax: 5, yMin: 0, yMax: 68 } })), /pitch bounds/);
  assert.throws(() => Formation.createPhilosophyOverlay({ id: 'bad', label: 'Bad', baseFormation: '442', slotAdjustments: { buildup: { NOPE: {} } } }), /unknown slot/);
});
