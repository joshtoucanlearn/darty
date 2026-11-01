import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const matchPath = path.join(root, 'match-engine', 'match.html');
const source = fs.readFileSync(matchPath, 'utf8');

test('balanced playtest rendering is the default while the prior high-quality path stays opt-in', () => {
  assert.match(source, /query\.get\('renderQuality'\)==='high'/);
  assert.match(source, /id:'playtest-balanced',pixelRatioCap:1,shadowMapSize:1024,dynamicActorShadows:false,actorDetailDistance:360/);
  assert.match(source, /id:'high',pixelRatioCap:2,shadowMapSize:3072,dynamicActorShadows:true,actorDetailDistance:Infinity/);
  assert.match(source, /renderer\.setPixelRatio\(Math\.min\(devicePixelRatio,RENDER_QUALITY_PROFILE\.pixelRatioCap\)\)/);
});

test('balanced mode keeps one static stadium shadow map and uses existing actor contact shadows', () => {
  assert.match(source, /renderer\.shadowMap\.autoUpdate=RENDER_HIGH_QUALITY/);
  assert.match(source, /const CAST=o=>\(o\.castShadow=RENDER_QUALITY_PROFILE\.dynamicActorShadows,o\.receiveShadow=true,o\)/);
  assert.match(source, /ballMesh\.castShadow=RENDER_QUALITY_PROFILE\.dynamicActorShadows/);
  assert.match(source, /if\(!RENDER_HIGH_QUALITY\)renderer\.shadowMap\.needsUpdate=true/);
  assert.match(source, /contactShadow=new THREE\.Mesh/);
});

test('broadcast-distance actors keep their articulated silhouette while tiny mesh details become close-up only', () => {
  assert.match(source, /const performanceDetails=\[\]/);
  assert.match(source, /geometry&&geometry\.type==='LatheGeometry'/);
  assert.match(source, /node===facePanel\|\|/, 'faces are never a distance-culled detail (Joshua, 1 Nov)');
  assert.match(source, /mesh\.position\.distanceTo\(camera\.position\)<=RENDER_QUALITY_PROFILE\.actorDetailDistance/);
  assert.match(source, /u\.performanceDetails\.forEach\(node=>\{node\.visible=detailVisible;\}\)/);
  assert.match(source, /u\.ring\.visible=!!highlighted/);
});

test('balanced night lighting uses six wider floodlights while high quality retains ten', () => {
  assert.match(source, /floodStart=RENDER_HIGH_QUALITY\?-W\*\.38:-W\*\.32/);
  assert.match(source, /floodStep=RENDER_HIGH_QUALITY\?W\*\.19:W\*\.32/);
  assert.match(source, /floodIntensity=RENDER_HIGH_QUALITY\?\.30:\.42/);
});

test('the exported playtest log records the effective renderer profile, not only device DPR', () => {
  assert.match(source, /quality:RENDER_QUALITY_PROFILE\.id,effectivePixelRatio:\+renderer\.getPixelRatio\(\)\.toFixed\(2\),shadowMapSize:RENDER_QUALITY_PROFILE\.shadowMapSize,dynamicActorShadows:RENDER_QUALITY_PROFILE\.dynamicActorShadows/);
  assert.match(source, /perf\.renderer\.effectivePixelRatio=\+renderer\.getPixelRatio\(\)\.toFixed\(2\)/);
});

test('all inline match scripts still parse after renderer profile integration', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(code => code.trim());
  assert.ok(scripts.length >= 4);
  for (const [index, code] of scripts.entries()) assert.doesNotThrow(() => new vm.Script(code, { filename: `match-inline-${index}.js` }));
});
