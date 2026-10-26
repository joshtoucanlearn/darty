import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(path.join(root, relative));
const readText = relative => read(relative).toString('utf8');
const readJson = relative => JSON.parse(readText(relative));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = readJson('research/overhaul/build-173-baseline-manifest.json');
const matrix = readJson('research/overhaul/protected-workflows.json');
const matchHtml = readText('match-engine/match.html');
const quickPlayHtml = readText('quick-play/index.html');
const quickPlayApp = readText('quick-play/app.js');

function inlineScript(id) {
  const match = matchHtml.match(new RegExp(`<script id=["']${id}["']>([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `${id} inline script must exist`);
  return match[1];
}

test('F0 records FL V2 Candidate 5 as the sole playable authority', () => {
  assert.equal(manifest.schema, 'football-legacy-overhaul-baseline-v1');
  assert.equal(manifest.schemaVersion, '2.0.0');
  assert.equal(manifest.build, 173);
  assert.equal(manifest.candidateBuild, 174);
  assert.equal(manifest.authority.currentRung, 'authoritative-v2-only-playable');
  assert.equal(manifest.authority.defaultAuthority, 'fl-v2');
  assert.equal(manifest.authority.liveGameplayOwner, 'match-engine/match.html');
  assert.equal(manifest.authority.candidateMayControlLiveGameplay, true);
  assert.deepEqual(manifest.authority.candidateAuthorityScope, [
    'single-player-quick-play', 'cpu-versus-cpu', 'set-piece-suite'
  ]);
  assert.equal(manifest.authority.candidateAuthorityRequiresExplicitSelection, false);
  assert.equal(manifest.authority.runtimeFailurePolicy, 'rollback-then-freeze-fl-v2-with-blocking-diagnostic');
  assert.equal(manifest.authority.scopedLegacyMaintenanceAllowed, true);
  assert.equal(manifest.authority.onlineChangesAllowed, true);
  assert.equal(manifest.authority.offlineOptInApprovedByJoshua, true);
  assert.equal(manifest.authority.v2OnlyPlayableApprovedByJoshua, true);
  assert.equal(manifest.authority.furtherMigrationRequiresExplicitJoshuaApproval, false);
  assert.equal(manifest.reference.pathRecordedInManifest, false);
});

test('every pinned protected file exists and matches its candidate SHA-256', () => {
  assert.ok(manifest.protectedFiles.length >= 19);
  for (const entry of manifest.protectedFiles) {
    assert.match(entry.path, /^(?!\/)(?!.*\.\.)/);
    assert.ok(existsSync(path.join(root, entry.path)), `${entry.path} must exist`);
    assert.match(entry.baselineSha256, /^[a-f0-9]{64}$/);
    if (entry.pinState === 'pending-final-freeze') {
      assert.equal(entry.candidateSha256, null, `${entry.path} pending pin must be explicit`);
      continue;
    }
    assert.match(entry.candidateSha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(read(entry.path)), entry.candidateSha256, `${entry.path} candidate hash`);
    if (entry.expectedRelation.startsWith('byte-identical')) {
      assert.equal(entry.candidateSha256, entry.baselineSha256, `${entry.path} must remain Build 173-identical`);
    }
  }
});

test('every pinned promoted runtime file is new to the baseline, scoped and hash-sealed', () => {
  assert.equal(manifest.promotedFiles.length, 23);
  const paths = manifest.promotedFiles.map(entry => entry.path);
  assert.equal(new Set(paths).size, paths.length, 'promoted file paths must be unique');
  for (const entry of manifest.promotedFiles) {
    assert.match(entry.path, /^(?!\/)(?!.*\.\.)/);
    assert.equal(entry.baselineAbsent, true, `${entry.path} must be declared absent from Build 173`);
    assert.ok(existsSync(path.join(root, entry.path)), `${entry.path} must exist`);
    assert.ok(Array.isArray(entry.authorityScope) && entry.authorityScope.length > 0, `${entry.path} scope`);
    if (entry.pinState === 'pending-final-freeze') {
      assert.equal(entry.candidateSha256, null, `${entry.path} pending pin must be explicit`);
      continue;
    }
    assert.match(entry.candidateSha256, /^[a-f0-9]{64}$/);
    assert.equal(sha256(read(entry.path)), entry.candidateSha256, `${entry.path} promoted hash`);
  }
  assert.deepEqual(
    manifest.promotedFiles.filter(entry => entry.pinState === 'pending-final-freeze').map(entry => entry.path),
    []
  );
  assert.ok(paths.includes('match-engine/dribbling-state-v2.js'));
  assert.ok(paths.includes('match-engine/instant-replay-review-v2.js'));
  assert.ok(paths.includes('match-engine/playtest-full-state-replay-v1.js'));
  assert.deepEqual(
    manifest.promotedFiles.find(entry => entry.path === 'match-engine/playtest-full-state-replay-v1.js').authorityScope,
    ['diagnostics-and-playtest-exports']
  );
});

test('release freeze has no unresolved candidate hash pins', () => {
  const pending = [...manifest.protectedFiles, ...manifest.promotedFiles]
    .filter(entry => entry.pinState === 'pending-final-freeze')
    .map(entry => entry.path);
  assert.deepEqual(pending, [], `final release pins still pending: ${pending.join(', ')}`);
});

test('Quick Play fixes FL V2 as the sole authority for exactly three playable modes', () => {
  const authority = manifest.allowedCandidateDelta.offlineOptInAuthority;
  assert.equal(authority.id, 'build-174-v2-only-playable-authority');
  assert.equal(authority.defaultEngine, 'fl-v2');
  assert.equal(authority.selector, null);
  assert.equal(authority.selectorDefault, 'fl-v2');
  assert.equal(authority.selectorOptIn, null);
  assert.equal(authority.onlinePolicy, 'unavailable-until-v2-authority');
  assert.equal(authority.unsupportedWorkflowPolicy, 'disabled-no-previous-engine-fallback');
  assert.equal(authority.runtimeFailurePolicy, 'rollback-candidate-transaction-and-freeze-fl-v2-with-blocking-diagnostic');
  assert.deepEqual(authority.workflows.map(item => item.protectedWorkflow), [
    'single-player-quick-play', 'cpu-versus-cpu', 'set-piece-suite'
  ]);
  assert.deepEqual(authority.workflows.map(item => item.quickPlayMatchType), [
    'single-player', 'spectator', 'free-kick-suite'
  ]);
  assert.deepEqual(authority.workflows.map(item => item.runtimeWorkflow), [
    'single-player', 'cpu-v-cpu', 'set-piece-suite'
  ]);
  const cpuWorkflow = authority.workflows.find(item => item.protectedWorkflow === 'cpu-versus-cpu');
  assert.deepEqual(cpuWorkflow.authority, ['gameplay', 'match-control']);
  assert.deepEqual(cpuWorkflow.controlOwnership, { humanPlayerIds: [], cpuTeamIds: ['you', 'opp'] });
  assert.deepEqual(cpuWorkflow.queryRequirement, { autoplay: '1' });
  assert.equal(authority.queryContract.autoplay, 'exactly-one-value-1-for-cpu-versus-cpu-only');
  assert.equal(authority.queryContract.candidate, '5-cache-only');
  assert.deepEqual(authority.payloadContract['controllers.cpu-versus-cpu'], {
    player1Team: null, player2Team: null, aiTeam: 'both', online: 'not-true', cooperative: 'not-true'
  });
  assert.match(quickPlayHtml, /<input id="gameplayEngine" type="hidden" value="fl-v2">/);
  assert.doesNotMatch(quickPlayHtml, /value="build-173"/);
  assert.match(quickPlayHtml, /<option value="co-op" disabled>[\s\S]*?<option value="home-co-op" disabled>/);
  assert.match(quickPlayApp, /const QUICK_PLAY_ENGINE_VERSION='1\.0\.0-offline-live-authority-playtest'/);
  assert.doesNotMatch(quickPlayApp, /BUILD_173_ENGINE/);
  assert.match(quickPlayApp, /if\(online\|\|mode==='online'\)return\{requested:FL_V2_ENGINE,effective:UNAVAILABLE_ENGINE/);
  assert.match(quickPlayApp, /if\(!FL_V2_PLAYABLE_MODES\.includes\(mode\)\)return\{requested:FL_V2_ENGINE,effective:UNAVAILABLE_ENGINE/);
  assert.match(quickPlayApp, /return\{requested:FL_V2_ENGINE,effective:FL_V2_ENGINE,version:QUICK_PLAY_ENGINE_VERSION,fallbackReason:null\}/);
  assert.match(quickPlayApp, /if\(selection\.effective!==FL_V2_ENGINE\)throw new Error/);
  assert.match(quickPlayApp, /function finalizeMatchPayload\(payload,requested,online=false\)[\s\S]*?result\.simulationSeed=deterministicSimulationSeed\(result\)/);
  assert.match(quickPlayApp, /params\.set\('simulationSeed',String\(simulationSeed\)\)/);
  assert.match(quickPlayApp, /if\(engine\?\.effective===FL_V2_ENGINE\)\{params\.set\('engine',FL_V2_ENGINE\);params\.set\('candidate',FL_V2_CANDIDATE\);params\.set\('release','joe-20261026-lesson-ready'\);\}else\{params\.delete\('engine'\);params\.delete\('candidate'\);params\.delete\('release'\);\}/);
  assert.match(quickPlayApp, /if\(data\.matchType==='spectator'\)params\.set\('autoplay','1'\)/);
});

test('the match page conditionally loads the exact FL V2 runtime only after fail-closed preflight', () => {
  const delta = manifest.allowedCandidateDelta;
  const authority = delta.offlineOptInAuthority;
  assert.equal(matchHtml.split(delta.exactLine).length - 1, delta.occurrences);
  assert.equal(delta.baselineSha256, manifest.protectedFiles.find(entry => entry.path === delta.path).baselineSha256);

  const preflight = inlineScript('offlineLiveV2Preflight');
  assert.match(preflight, /engineValues=params\.getAll\('engine'\)/);
  assert.match(preflight, /candidateValues=params\.getAll\('candidate'\)/);
  assert.match(preflight, /seedValues=params\.getAll\('simulationSeed'\)/);
  assert.match(preflight, /quickPlayValues=params\.getAll\('quickPlay'\)/);
  assert.match(preflight, /shadowValues=params\.getAll\('v2Shadow'\)/);
  assert.match(preflight, /if\(shadowValues\.length\)markers\.push\('shadow-marker-conflict'\)/);
  assert.match(preflight, /queryRequested=engineValues\.length===1&&engineValues\[0\]==='fl-v2'/);
  assert.match(preflight, /payloadRequested=!!\(payloadEngine&&payloadEngine\.requested==='fl-v2'\)/);
  assert.match(preflight, /if\(payloadEngine\.effective!=='fl-v2'\)markers\.push\('payload-engine-effective-mismatch'\)/);
  assert.match(preflight, /if\(payloadEngine\.version!=='1\.0\.0-offline-live-authority-playtest'\)/);
  assert.match(preflight, /else if\(querySeed!==String\(payloadSeed>>>0\)\)markers\.push\('simulation-seed-mismatch'\)/);
  assert.match(preflight, /if\(candidateValues\.length!==1\)[\s\S]*?candidateValues\[0\]!=='5'/);
  assert.match(preflight, /if\(quickPlayValues\.length!==1\)[\s\S]*?quickPlayValues\[0\]!=='1'/);
  assert.match(preflight, /if\(!decoded\|\|decoded\.mode!=='quickPlay'\)markers\.push\('payload-mode-invalid'\)/);
  assert.match(preflight, /const matchType=String\(decoded&&decoded\.matchType\|\|''\),liveWorkflow=matchType==='single-player'\?'single-player':matchType==='spectator'\?'cpu-v-cpu':matchType==='free-kick-suite'\?'set-piece-suite':null/);
  assert.match(preflight, /const exactCpuOwnership=exactControllerKeys&&controllers\.player1Team===null&&controllers\.player2Team===null&&controllers\.aiTeam==='both'/);
  assert.match(preflight, /if\(autoplayValues\.length!==1\|\|autoplayValues\[0\]!=='1'\)markers\.push\(autoplayValues\.length>1\?'duplicate-autoplay-marker':'cpu-v-cpu-autoplay-marker-invalid'\)/);
  assert.match(preflight, /eligible=requested&&queryRequested&&payloadRequested&&!!decoded&&!!liveWorkflow&&unique\.length===0/);
  assert.match(preflight, /if\(!eligible\)return/);
  assert.match(preflight, /window\.__FL_V2_LIVE_PREFLIGHT=Object\.freeze/);

  let priorIndex = -1;
  for (const filename of authority.orderedScripts) {
    assert.equal(preflight.split(`'${filename}'`).length - 1, 1, `${filename} exact live loader entry`);
    const index = preflight.indexOf(`'${filename}'`);
    assert.ok(index > priorIndex, `${filename} conditional order`);
    priorIndex = index;
    assert.doesNotMatch(matchHtml, new RegExp(`<script\\s+src=["'][^"']*${filename.replace(/\./g, '\\.')}`, 'i'), `${filename} must not load unconditionally`);
  }
  assert.equal(authority.scriptCacheVersion, '174-fl-v2-final-candidate-5-joe-lesson-ready-2');
  assert.match(preflight, /pieces\.forEach\(src=>document\.write\('<script src="'\+src\+'\?v=174-fl-v2-final-candidate-5-joe-lesson-ready-2/);
  assert.match(matchHtml, /trueFeelPhysicalTouchAuthority:true,cpuPassRaceFilter:true/);
});

test('the live host composes candidate transactions with rollback and a blocking strict V2 stop', () => {
  assert.match(matchHtml, /function liveV2Stop\(reason\)[\s\S]*?liveV2StrictStopped=true;paused=true;clockRunning=false[\s\S]*?liveV2Badge\('FL V2 stopped · Match halted',true,liveV2AttachFailure\)/);
  assert.match(matchHtml, /prepared=liveV2Authority\.prepareCommit\(frame\)/);
  assert.match(matchHtml, /liveV2Authority\.applyPrepared\(prepared\)/);
  assert.match(matchHtml, /liveV2Authority\.finalizePrepared\(prepared\)/);
  assert.match(matchHtml, /catch\(error\)\{liveV2RestoreTransactionState\(saved\);if\(prepared\)liveV2Authority\.rollbackPrepared\(prepared,error\)/);
  assert.match(matchHtml, /liveV2ControlApi\.rollback\(liveV2ControlRuntime,controlPlan,'outer-host-rollback'/);
  assert.match(matchHtml, /window\.FLLiveV2=Object\.freeze\(\{status:[\s\S]*?stop:\(\)=>liveV2Stop\('manual FL V2 strict stop'\)/);
  assert.match(matchHtml, /const liveV2LiveTick=liveV2RunTick\(\);if\(liveV2StrictStopped\|\|liveV2PeriodTransitionApplied\)return/);
  assert.match(matchHtml, /id="v2StrictFailurePage"[\s\S]*?Export diagnostic log[\s\S]*?Restart FL V2[\s\S]*?Exit to match setup/);
  assert.doesNotMatch(matchHtml, /FL V2 fallback · Build 173 active|build-173-fallback/);
  assert.match(matchHtml, /LIVE_V2_PREFLIGHT\.workflow==='single-player'/);
  assert.match(matchHtml, /LIVE_V2_PREFLIGHT\.workflow==='cpu-v-cpu'/);
  assert.match(matchHtml, /LIVE_V2_PREFLIGHT\.workflow==='set-piece-suite'/);
  assert.match(matchHtml, /controlOwnership:\{humanPlayerIds:\[\],cpuTeamIds:\['you','opp'\]\}/);
});

test('the exact-flag v2Shadow path remains offline, read-only and independently pinned', () => {
  const shadow = manifest.allowedCandidateDelta.liveShadowAttachment;
  const shadowPreflight = inlineScript('build173V2ShadowPreflight');
  assert.equal(shadow.id, 'build173-exact-flag-offline-read-only-shadow');
  assert.equal(shadow.exactFlag, 'v2Shadow=1');
  assert.equal(shadow.defaultLoadsV2, false);
  assert.equal(shadow.onlinePolicy, 'preflight-and-capture-frozen');
  assert.equal(shadow.armingPolicy, 'exact-workflow-method-bound-fail-closed');
  assert.equal(shadow.authority, 'nonplayable-build-173-reference-only');
  assert.equal(shadow.liveProjectionAllowed, false);
  assert.equal(shadow.workflowRemovalAllowed, true);
  assert.match(shadowPreflight, /values=params\.getAll\('v2Shadow'\),requested=values\.length===1&&values\[0\]==='1'/);
  assert.match(shadowPreflight, /if\(!eligible\)return/);
  let priorIndex = -1;
  for (const filename of shadow.orderedScripts) {
    assert.equal(shadowPreflight.split(`'${filename}'`).length - 1, 1, `${filename} exact shadow loader entry`);
    const index = shadowPreflight.indexOf(`'${filename}'`);
    assert.ok(index > priorIndex, `${filename} shadow order`);
    priorIndex = index;
  }
  for (const [fileKey, hashKey] of [
    ['adapter', 'adapterSha256'], ['capture', 'captureSha256'], ['hook', 'hookSha256'],
    ['contract', 'contractSha256'], ['regressionGate', 'regressionGateSha256']
  ]) {
    assert.ok(existsSync(path.join(root, shadow[fileKey])), `${fileKey} must exist`);
    assert.equal(sha256(read(shadow[fileKey])), shadow[hashKey], `${fileKey} protected hash`);
  }
  assert.doesNotMatch(matchHtml, /build173V2Shadow\.(?:state|snapshot|commands?|apply|project|commit)\b/);
  assert.match(matchHtml, /getV2ShadowTelemetry/);
});

test('legacy maintenance and the additive Madrid contract remain sealed', () => {
  const delta = manifest.allowedCandidateDelta;
  assert.equal(delta.liveMaintenance.id, 'offside-restart-presentation-camera-policy');
  assert.equal(delta.liveMaintenance.authority, 'legacy-inline-only');
  assert.equal(delta.liveMaintenance.onlinePolicy, 'broadcast-camera-frozen');
  assert.ok(delta.liveMaintenance.scope.length >= 4);
  for (const [pathKey, hashKey] of [
    ['regressionGate', 'regressionGateSha256'],
    ['replayCleanupRegressionGate', 'replayCleanupRegressionGateSha256']
  ]) {
    assert.ok(existsSync(path.join(root, delta.liveMaintenance[pathKey])));
    assert.equal(sha256(read(delta.liveMaintenance[pathKey])), delta.liveMaintenance[hashKey]);
  }
  const madrid = delta.historicTeamAddition;
  assert.equal(madrid.id, 'madrid-real-2013-14');
  assert.equal(sha256(read(madrid.contract)), madrid.contractSha256);
  assert.equal(sha256(read(madrid.regressionGate)), madrid.regressionGateSha256);
  assert.equal(madrid.onlineChangesAllowed, false);
  assert.equal(madrid.workflowRemovalAllowed, false);
});

test('an optional external Build 173 reference can be verified without recording its local path', () => {
  if (!process.env.FL_BUILD_173_REFERENCE) return;
  const referenceRoot = path.resolve(process.env.FL_BUILD_173_REFERENCE);
  for (const entry of manifest.protectedFiles) {
    const referencePath = path.join(referenceRoot, entry.path);
    assert.ok(existsSync(referencePath), `${entry.path} external reference must exist`);
    assert.equal(sha256(readFileSync(referencePath)), entry.baselineSha256, `${entry.path} baseline hash`);
  }
});

test('the workflow matrix exposes exactly three V2 playable modes and blocks incomplete multiplayer modes', () => {
  assert.equal(matrix.schema, 'football-legacy-protected-workflow-matrix-v1');
  assert.equal(matrix.schemaVersion, '3.0.0');
  assert.equal(matrix.build, 174);
  assert.equal(matrix.candidateBuild, 174);
  assert.equal(matrix.candidate, 5);
  assert.equal(matrix.policy.defaultAuthority, 'fl-v2');
  assert.equal(matrix.policy.replacementAllowedByThisMatrix, true);
  assert.equal(matrix.policy.explicitOfflineOptInAllowed, false);
  assert.equal(matrix.policy.explicitOfflineOptInAuthority, null);
  assert.equal(matrix.policy.removalAllowed, false);
  assert.equal(matrix.policy.legacyPlayableRemovalAllowed, true);
  assert.equal(matrix.policy.silentRerouteAllowed, false);
  assert.equal(matrix.policy.previousBuildSelectionAllowed, false);
  assert.equal(matrix.policy.previousBuildDefaultAllowed, false);
  assert.equal(matrix.policy.previousBuildFallbackAllowed, false);
  assert.equal(matrix.policy.onlineFoundationPolicy, 'unavailable-until-v2-authority');
  assert.equal(matrix.policy.directLaunchPolicy, 'exact-v2-contract-or-fail-closed-before-simulation');
  assert.equal(matrix.policy.runtimeFailurePolicy, 'same-tick-rollback-then-strict-v2-stop');
  const required = [
    'single-player-quick-play', 'local-two-player', 'home-co-op', 'cpu-versus-cpu',
    'online-versus', 'input-devices', 'match-lifecycle', 'normal-match-set-pieces',
    'set-piece-suite', 'career-mode', 'create-a-club', 'player-career', 'content-inputs',
    'diagnostics-and-playtest-exports'
  ];
  assert.deepEqual(matrix.workflows.map(item => item.id).sort(), required.sort());
  const playable = matrix.workflows.filter(item => item.status === 'playable');
  assert.deepEqual(playable.map(item => item.id), ['single-player-quick-play', 'cpu-versus-cpu', 'set-piece-suite']);
  assert.deepEqual(matrix.policy.v2PlayableWorkflows, playable.map(item => item.id));
  for (const workflow of playable) {
    assert.equal(workflow.authority, 'fl-v2');
    assert.equal(workflow.defaultAuthority, 'fl-v2');
    assert.equal(workflow.activation.online, false);
    assert.equal(workflow.activation.requestedEngine, 'fl-v2');
    assert.equal(workflow.activation.requiresExactQueryAndPayloadAgreement, true);
  }
  const unavailable = matrix.workflows.filter(item => item.status === 'unavailable');
  assert.deepEqual(unavailable.map(item => item.id), ['local-two-player', 'home-co-op', 'online-versus']);
  assert.deepEqual(matrix.policy.unavailableUntilV2Authority, unavailable.map(item => item.id));
  for (const workflow of unavailable) {
    assert.equal(workflow.authority, 'none');
    assert.ok(workflow.requiredGates.includes('no-launch'));
    assert.ok(workflow.requiredGates.includes('no-previous-engine-fallback'));
  }
  const cpuWorkflow = matrix.workflows.find(item => item.id === 'cpu-versus-cpu');
  assert.equal(cpuWorkflow.activation.quickPlayMatchType, 'spectator');
  assert.equal(cpuWorkflow.activation.runtimeWorkflow, 'cpu-v-cpu');
  assert.equal(cpuWorkflow.activation.requiresExactAllCpuOwnership, true);
  assert.equal(cpuWorkflow.activation.requiresAutoplayQueryValue, '1');
  assert.deepEqual(cpuWorkflow.activation.controlOwnership, {
    humanPlayerIds: [], cpuTeamIds: ['you', 'opp']
  });
  for (const gate of [
    'fixed-v2-authority', 'payload-query-agreement', 'deterministic-seed', 'exact-all-cpu-ownership',
    'autoplay', 'ai-assignment', 'gameplay-authority', 'match-control', 'strict-v2-stop-no-previous-engine-continuation'
  ]) assert.ok(cpuWorkflow.requiredGates.includes(gate), `CPU v CPU requires ${gate}`);
  for (const workflow of matrix.workflows) {
    assert.ok(['playable', 'unavailable', 'protected'].includes(workflow.status));
    assert.ok(workflow.entryPoints.length > 0);
    assert.ok(workflow.requiredGates.length > 0);
  }
});

test('Online gameplay is publicly unavailable while its dormant transport remains sealed for V2 migration', () => {
  const online = manifest.protectedFiles.filter(entry => entry.path.startsWith('online/'));
  assert.deepEqual(online.map(entry => entry.path).sort(), ['online/app.js', 'online/index.html']);
  assert.deepEqual(online.map(entry => entry.expectedRelation).sort(), [
    'dormant-unloaded-online-transport-provenance',
    'online-unavailable-until-v2-authority-no-playable-transport'
  ]);
  const maintenance = manifest.allowedCandidateDelta.controllerReconnectMaintenance;
  assert.equal(maintenance.authority, 'input-transport-maintenance-only');
  assert.equal(maintenance.onlineGameplayAuthority, 'unavailable-until-v2-authority');
  assert.equal(maintenance.onlineGameplayAuthorityChanged, true);
  for (const [relative, expected] of Object.entries(maintenance.files)) {
    assert.equal(sha256(read(relative)), expected, `${relative} reconnect maintenance hash`);
  }
  for (const [relative, expected] of Object.entries(maintenance.regressionGates)) {
    assert.equal(sha256(read(relative)), expected, `${relative} reconnect gate hash`);
  }
  assert.equal(matrix.workflows.find(item => item.id === 'online-versus').authority, 'none');
  assert.equal(matrix.workflows.find(item => item.id === 'online-versus').status, 'unavailable');
  assert.equal(manifest.allowedCandidateDelta.offlineOptInAuthority.onlinePolicy, 'unavailable-until-v2-authority');
});
