import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const onlineApp = read('online/app.js');
const onlineHtml = read('online/index.html');
const quickApp = read('quick-play/app.js');
const quickHtml = read('quick-play/index.html');
let passed = 0;
const productionFailures = [];

const check = (condition, message) => {
  assert.ok(condition, message);
  passed += 1;
};

const productionCheck = (condition, message) => {
  if (!condition) productionFailures.push(message);
  else passed += 1;
};

check(onlineApp.includes("const BUILD='172'"), 'Peers must share the lobby-sync build');
check(onlineApp.includes("const PEER_PREFIX='football-legacy-172-'"), 'Old and new peer rooms must not mix');
check(onlineApp.includes('peerConnected:!!(connection&&connection.open),connectionEpoch'), 'Continuous lobby packets must carry peer truth and epoch');
check(onlineApp.includes('lastPongAt>24000'), 'A short browser stall must not kill the room');
check(onlineApp.includes('existingHealthy=connection.open&&Date.now()-lastPongAt<9000'), 'A stale host connection must be replaceable');
check(onlineApp.includes("if(!connection||!connection.open){"), 'Host launch must fail closed without a live data channel');
check(onlineApp.includes('getProtocolTrace:()=>protocolTrace.slice()'), 'Outer protocol telemetry must be bounded and inspectable');
check(!/ui\.frame\.onload=\(\)=>\{\s*childReady=true/.test(onlineApp), 'Iframe load alone must not claim application readiness');
check(quickApp.includes("type:'ready-state'"), 'Ready intent must use a versioned state packet');
check(quickApp.includes("type:'ready-ack'"), 'Ready state must be acknowledged');
check(quickApp.includes('onlineSendReady(false)'), 'Ready state must be retried after a dropped packet');
check(quickApp.includes('revision>=onlineState.remoteReadyRevision'), 'Older Ready packets must not overwrite newer state');
check(quickApp.includes('onlineState.readyAckRevision!==onlineState.ownReadyRevision'), 'Launch must wait for the exact peer acknowledgement');
check(quickApp.includes('reconcileOnlineConnection(data&&data.peerConnected,data&&data.connectionEpoch)'), 'Continuous packets must heal a missed connection event');
check(quickApp.includes('getProtocolTrace:()=>onlineProtocolTrace.slice()'), 'Lobby protocol telemetry must be inspectable');
check(!quickApp.match(/function applyOnlineSide\([^\n]+remoteReady=false/), 'Team replication must not silently erase Ready state');
check(!quickApp.match(/function applyOnlineSettings\([^\n]+remoteReady=false/), 'Settings replication must not silently erase Ready state');
check(!onlineHtml.includes('<script') && !onlineHtml.includes('id="hostButton"') && !onlineHtml.includes('id="gameFrame"'), 'The public Online page must keep the preserved lobby implementation inert while V2 authority is incomplete');
check(quickHtml.includes('app.js?v=174-fl-v2-final-candidate-5-joe-shots-1'), 'Quick Play must load Joe’s V2-only controller and gameplay bytes while the dormant lobby protocol remains testable but unshipped');

class ReadyPeer {
  constructor(side) {
    this.side = side;
    this.ownReady = false;
    this.ownRevision = 0;
    this.remoteReady = false;
    this.remoteRevision = -1;
    this.ackRevision = -1;
  }
  setReady(ready) {
    if (this.ownReady !== ready) {
      this.ownReady = ready;
      this.ownRevision += 1;
      this.ackRevision = -1;
    }
  }
  readyPacket() {
    return { type: 'ready-state', side: this.side, ready: this.ownReady, revision: this.ownRevision };
  }
  receiveReady(packet) {
    if (packet.revision >= this.remoteRevision) {
      this.remoteRevision = packet.revision;
      this.remoteReady = packet.ready;
    }
    return { type: 'ready-ack', side: packet.side, revision: packet.revision };
  }
  receiveAck(packet) {
    if (packet.side === this.side && packet.revision >= this.ownRevision) this.ackRevision = packet.revision;
  }
}

const home = new ReadyPeer('home');
const away = new ReadyPeer('away');
home.setReady(true);
const dropped = home.readyPacket();
check(away.remoteReady === false, 'A dropped first Ready packet must not create false remote truth');
const retryAck = away.receiveReady(home.readyPacket());
home.receiveAck(retryAck);
check(away.remoteReady && home.ackRevision === home.ownRevision, 'Retry and ACK must converge after a dropped Ready packet');
home.setReady(false);
const newerFalse = home.readyPacket();
away.receiveReady(newerFalse);
away.receiveReady(dropped);
check(away.remoteReady === false && away.remoteRevision === newerFalse.revision, 'A delayed older packet must not resurrect stale Ready state');

// Production protocol contract: Ready belongs to one exact lobby/configuration,
// and launching is an explicit, version-matched, exactly-once transaction.
productionCheck(/\blobbyVersion\b/.test(quickApp), 'Runtime Ready state must carry a lobbyVersion');
productionCheck(/\bconfigRevision\b/.test(quickApp), 'Runtime Ready state must carry a configRevision');
productionCheck(/type:'ready-state'/.test(quickApp) && /lobbyVersion/.test(quickApp) && /configRevision/.test(quickApp), 'Ready packets must be bound to lobbyVersion and configRevision');
productionCheck(/invalidateOnlineLobby/.test(quickApp) && /function onlineLocalChange[\s\S]{0,1200}invalidateOnlineLobby/.test(quickApp), 'Configuration changes must invalidate both prior Ready states through invalidateOnlineLobby');
productionCheck(/function tryOnlineLaunch\(\)[\s\S]{0,700}!onlineState\.startIntent/.test(quickApp), 'Home launch must be gated by an explicit startIntent, not readiness alone');
productionCheck(/document\.addEventListener\('click',event=>\{[\s\S]{0,1800}event\.stopImmediatePropagation\(\)[\s\S]{0,1800}\},true\);/.test(quickApp), 'Online Ready/Start must intercept in capture phase before the generic Start listener can emit an empty launch request');
productionCheck(/launch-proposal/.test(quickApp + onlineApp), 'Home must send a version-matched launch proposal');
productionCheck(/type:'launch-ack'/.test(quickApp + onlineApp), 'Away must acknowledge the matching launch proposal');
productionCheck(/launch-commit/.test(quickApp + onlineApp), 'Home must commit an acknowledged launch exactly once');
productionCheck(/launchCommitted|committedLaunch/.test(quickApp + onlineApp), 'Runtime launch commit handling must retain an exactly-once guard');
productionCheck(/revision>onlineState\.sideRevisions\[side\]/.test(quickApp), 'Team replication must ignore delayed older side revisions');
productionCheck(/revision>onlineState\.settingsRevision/.test(quickApp), 'Settings replication must ignore delayed older settings revisions');
productionCheck(/if\(\+\+onlineResyncTick%2===0\)onlineBroadcastCurrent\(\)/.test(quickApp), 'Dropped team or settings packets must be repaired by periodic full-state rebroadcast');
productionCheck(/pendingLaunch\.phase==='proposal'\?'launch-proposal':'launch-commit'/.test(onlineApp) && /launchTimer=setInterval\(transmitPendingLaunch,500\)/.test(onlineApp), 'Proposal and commit packets must both retry while the launch transaction is pending');
productionCheck(/if\(launchCommitted===message\.launchId\)\{send\(launchPacket\('launch-committed',message\)\)/.test(onlineApp), 'A duplicate commit must re-acknowledge a previously committed guest launch');
productionCheck(/message\.type==='launch-committed'[\s\S]{0,160}completeHostLaunch/.test(onlineApp) && /function completeHostLaunch[\s\S]{0,700}startHostMatch\(launch\)/.test(onlineApp), 'Home must not enter the match until Away confirms the commit');
productionCheck(/function invalidateOnlineLobby[\s\S]{0,1000}type:'launch-cancel'/.test(quickApp) && /data\.message&&data\.message\.type==='launch-cancel'\)cancelLocalLaunch/.test(onlineApp) && /message\.type==='launch-cancel'[\s\S]{0,180}cancelLocalLaunch/.test(onlineApp), 'A team/settings revision change during launch must cancel both the local parent transaction and its remote counterpart');
productionCheck(/message\.type==='launch-commit'&&role==='guest'[\s\S]{0,260}queueChild/.test(onlineApp) && /message\.type==='launch-commit'&&ONLINE_ROLE==='guest'[\s\S]{0,1000}message\.lobbyVersion===lobbyVersion[\s\S]{0,900}type:'launch-commit-ack'/.test(quickApp), 'Away must revalidate the live lobby revision in the child before committing a parent-level launch');
productionCheck(/connection=conn;\s*connectionPending=true;[\s\S]{0,260}disconnectHandled=false;[\s\S]{0,500}conn\.on\('open'/.test(onlineApp), 'Every accepted DataConnection must reset its disconnect guard before it can fail during opening');
productionCheck(/pendingLaunch\.phase==='proposal'&&Date\.now\(\)-pendingLaunch\.startedAt>12000[\s\S]{0,380}launchPacket\('launch-cancel',cancelled\)[\s\S]{0,300}clearLaunchHandshake/.test(onlineApp), 'A proposal timeout must send launch-cancel before abandoning the safe pre-commit transaction');
productionCheck(/if\(pendingLaunch\.phase==='proposal'&&Date\.now\(\)-pendingLaunch\.startedAt>12000\)/.test(onlineApp) && !/if\(Date\.now\(\)-pendingLaunch\.startedAt>12000\)/.test(onlineApp), 'Commit retry must not inherit the proposal timeout and strand one player after a delivered commit');
productionCheck(/const ownHome=ONLINE_OWNED_SIDE==='home',launchLocked=onlineState\.launchRequested/.test(quickApp) && (quickApp.match(/launchLocked\|\|/g)||[]).length>=4, 'Team, tactics, kit and shared settings controls must lock while a launch transaction is in flight');
productionCheck(/function onlineLocalChange\(target\)\{\s*if\(!ONLINE\|\|onlineState\.applyingRemote\|\|onlineState\.launchRequested\)return/.test(quickApp), 'Programmatic or late change events must not mutate configuration while launch is in flight');
productionCheck(/!onlineState\.launchRequested\|\|onlineState\.launchId===message\.launchId/.test(quickApp), 'Away must reject a different concurrent proposal while retaining the accepted launch identity');

class LobbyPeer {
  constructor(side) {
    this.side = side;
    this.lobbyVersion = 1;
    this.configRevision = 1;
    this.ownReady = false;
    this.ownReadyRevision = 0;
    this.ownReadyVersion = null;
    this.remoteReady = false;
    this.remoteReadyRevision = -1;
    this.remoteReadyVersion = null;
    this.startIntent = false;
    this.launchSequence = 0;
    this.pendingProposal = null;
    this.committedProposalIds = new Set();
    this.observedCommitIds = new Set();
  }
  version() {
    return `${this.lobbyVersion}:${this.configRevision}`;
  }
  configurationChanged(lobbyVersion, configRevision) {
    this.lobbyVersion = lobbyVersion;
    this.configRevision = configRevision;
    this.ownReady = false;
    this.ownReadyVersion = null;
    this.remoteReady = false;
    this.remoteReadyRevision = -1;
    this.remoteReadyVersion = null;
    this.startIntent = false;
    this.pendingProposal = null;
  }
  setReady(ready) {
    if (this.ownReady !== ready || this.ownReadyVersion !== this.version()) {
      this.ownReady = ready;
      this.ownReadyRevision += 1;
      this.ownReadyVersion = this.version();
      this.startIntent = false;
      this.pendingProposal = null;
    }
  }
  readyPacket() {
    return {
      type: 'ready-state', side: this.side, ready: this.ownReady,
      revision: this.ownReadyRevision, lobbyVersion: this.lobbyVersion,
      configRevision: this.configRevision,
    };
  }
  receiveReady(packet) {
    if (packet.lobbyVersion !== this.lobbyVersion || packet.configRevision !== this.configRevision) return null;
    if (packet.revision >= this.remoteReadyRevision) {
      this.remoteReadyRevision = packet.revision;
      this.remoteReady = !!packet.ready;
      this.remoteReadyVersion = this.version();
    }
    return {
      type: 'ready-ack', side: packet.side, revision: packet.revision,
      lobbyVersion: this.lobbyVersion, configRevision: this.configRevision,
    };
  }
  bothReady() {
    return this.ownReady && this.remoteReady && this.ownReadyVersion === this.version() && this.remoteReadyVersion === this.version();
  }
  requestStart() {
    if (this.side !== 'home' || !this.bothReady()) return null;
    this.startIntent = true;
    if (!this.pendingProposal) {
      const proposalId = `${this.version()}:${++this.launchSequence}`;
      this.pendingProposal = {
        type: 'launch-proposal', proposalId, lobbyVersion: this.lobbyVersion,
        configRevision: this.configRevision,
      };
    }
    return { ...this.pendingProposal };
  }
  receiveProposal(packet) {
    if (packet.lobbyVersion !== this.lobbyVersion || packet.configRevision !== this.configRevision || !this.bothReady()) return null;
    return {
      type: 'launch-ack', proposalId: packet.proposalId,
      lobbyVersion: this.lobbyVersion, configRevision: this.configRevision,
    };
  }
  receiveLaunchAck(packet) {
    const pending = this.pendingProposal;
    if (!this.startIntent || !pending || packet.proposalId !== pending.proposalId ||
        packet.lobbyVersion !== this.lobbyVersion || packet.configRevision !== this.configRevision ||
        this.committedProposalIds.has(packet.proposalId)) return null;
    this.committedProposalIds.add(packet.proposalId);
    return {
      type: 'launch-commit', proposalId: packet.proposalId,
      lobbyVersion: this.lobbyVersion, configRevision: this.configRevision,
    };
  }
  receiveCommit(packet) {
    if (packet.lobbyVersion !== this.lobbyVersion || packet.configRevision !== this.configRevision ||
        this.observedCommitIds.has(packet.proposalId)) return false;
    this.observedCommitIds.add(packet.proposalId);
    return true;
  }
}

const modelHome = new LobbyPeer('home');
const modelAway = new LobbyPeer('away');

// Drop the first Home Ready packet, then accept its retry and ACK. A duplicate
// is harmless and a delayed packet from an older configuration is rejected.
modelHome.setReady(true);
const droppedReady = modelHome.readyPacket();
check(!modelAway.remoteReady, 'Dropping the first versioned Ready packet leaves remote truth unchanged');
const recoveredReadyAck = modelAway.receiveReady(modelHome.readyPacket());
check(!!recoveredReadyAck && modelAway.remoteReady, 'Retrying the same versioned Ready packet repairs remote truth');
const duplicateReadyAck = modelAway.receiveReady(modelHome.readyPacket());
check(duplicateReadyAck.revision === recoveredReadyAck.revision && modelAway.remoteReadyRevision === droppedReady.revision, 'Duplicate Ready packets converge without advancing remote state');

modelAway.setReady(true);
modelHome.receiveReady(modelAway.readyPacket());
check(modelHome.bothReady() && modelAway.bothReady(), 'Both peers can become Ready for one exact lobby/configuration');
check(!modelHome.startIntent && modelHome.committedProposalIds.size === 0, 'Home-first readiness does not auto-launch without explicit Home startIntent');

const staleReady = modelAway.readyPacket();
modelHome.configurationChanged(2, 2);
modelAway.configurationChanged(2, 2);
check(!modelHome.ownReady && !modelHome.remoteReady && !modelAway.ownReady && !modelAway.remoteReady, 'Changing configuration invalidates both peers\' prior Ready states');
check(modelHome.receiveReady(staleReady) === null && !modelHome.remoteReady, 'A Ready packet from an older lobby/configuration cannot restore readiness');

// Re-ready on the new version. Away-first still cannot launch; Home must make
// an explicit request, and launch proposal/ACK/commit are all version matched.
modelAway.setReady(true);
modelHome.receiveReady(modelAway.readyPacket());
check(!modelHome.startIntent && modelHome.committedProposalIds.size === 0, 'Away-first readiness cannot create Home launch intent');
modelHome.setReady(true);
modelAway.receiveReady(modelHome.readyPacket());
check(modelHome.bothReady() && modelAway.bothReady() && modelHome.committedProposalIds.size === 0, 'Both Ready states alone still do not launch');

const proposal = modelHome.requestStart();
check(proposal?.type === 'launch-proposal' && proposal.lobbyVersion === 2 && proposal.configRevision === 2, 'Explicit Home startIntent creates a version-matched launch proposal');
const droppedProposal = { ...proposal };
const launchAck = modelAway.receiveProposal(proposal);
const duplicateLaunchAck = modelAway.receiveProposal(droppedProposal);
check(launchAck?.proposalId === proposal.proposalId && duplicateLaunchAck?.proposalId === proposal.proposalId, 'Dropped or duplicate launch proposals converge on the same ACK');

const commit = modelHome.receiveLaunchAck(launchAck);
const duplicateCommit = modelHome.receiveLaunchAck(duplicateLaunchAck);
check(commit?.type === 'launch-commit' && duplicateCommit === null && modelHome.committedProposalIds.size === 1, 'Duplicate launch ACKs produce exactly one Home commit');
check(modelAway.receiveCommit(commit) === true && modelAway.receiveCommit(commit) === false && modelAway.observedCommitIds.size === 1, 'Duplicate launch commits are observed exactly once');

modelHome.configurationChanged(3, 3);
modelAway.configurationChanged(3, 3);
check(modelAway.receiveProposal(proposal) === null && modelAway.receiveCommit(commit) === false, 'Reordered launch packets from an older lobby/configuration are rejected');

// Exercise the three independently-owned configuration streams. This catches
// the real transport order where Ready can overtake the team/settings snapshot
// that gives its version meaning, and where an older snapshot arrives last.
class ReplicatedConfiguration {
  constructor(side) {
    this.side = side;
    this.revisions = { home: 0, away: 0, settings: 0 };
    this.ownReady = false;
    this.remoteReady = false;
    this.ownReadyRevision = 0;
    this.remoteReadyRevision = -1;
  }
  version() {
    return `${this.revisions.home}:${this.revisions.away}:${this.revisions.settings}`;
  }
  invalidate() {
    this.ownReady = false;
    this.remoteReady = false;
    this.ownReadyRevision += 1;
    this.remoteReadyRevision = -1;
  }
  localChange(scope) {
    this.revisions[scope] += 1;
    this.invalidate();
    return { type: scope === 'settings' ? 'lobby-settings' : 'lobby-side', scope, revision: this.revisions[scope] };
  }
  receiveConfiguration(packet) {
    if (packet.revision <= this.revisions[packet.scope]) return false;
    this.revisions[packet.scope] = packet.revision;
    this.invalidate();
    return true;
  }
  setReady() {
    this.ownReady = true;
    this.ownReadyRevision += 1;
    return { type: 'ready-state', side: this.side, ready: true, revision: this.ownReadyRevision, configRevision: this.version() };
  }
  receiveReady(packet) {
    const accepted = packet.configRevision === this.version();
    if (packet.revision >= this.remoteReadyRevision) {
      this.remoteReadyRevision = packet.revision;
      this.remoteReady = accepted && packet.ready;
    }
    return { type: 'ready-ack', revision: packet.revision, configRevision: packet.configRevision, accepted };
  }
}

const revisionHome = new ReplicatedConfiguration('home');
const revisionAway = new ReplicatedConfiguration('away');
revisionHome.setReady();
revisionAway.receiveReady(revisionHome.setReady());
revisionAway.setReady();
revisionHome.receiveReady(revisionAway.setReady());

const settingsV1 = revisionHome.localChange('settings');
const readyBeforeSettings = revisionHome.setReady();
const earlySettingsReadyAck = revisionAway.receiveReady(readyBeforeSettings);
check(!earlySettingsReadyAck.accepted && !revisionAway.remoteReady, 'Ready that overtakes its settings revision is rejected rather than applied to stale settings');
check(revisionAway.receiveConfiguration(settingsV1) && revisionAway.version() === revisionHome.version(), 'A later settings snapshot advances the exact shared configuration version');
check(!revisionAway.receiveConfiguration({ ...settingsV1, revision: 0 }) && revisionAway.revisions.settings === 1, 'A delayed older settings snapshot cannot roll the lobby back');
const recoveredSettingsReadyAck = revisionAway.receiveReady(readyBeforeSettings);
check(recoveredSettingsReadyAck.accepted && revisionAway.remoteReady, 'Periodic Ready retry is accepted after the missing settings revision arrives');

const awayTeamV1 = revisionAway.localChange('away');
const readyBeforeAwayTeam = revisionAway.setReady();
const earlyTeamReadyAck = revisionHome.receiveReady(readyBeforeAwayTeam);
check(!earlyTeamReadyAck.accepted && !revisionHome.remoteReady, 'Ready that overtakes its Away-team revision is rejected rather than applied to the old team');
check(revisionHome.receiveConfiguration(awayTeamV1) && revisionHome.version() === revisionAway.version(), 'A later team snapshot advances the exact shared configuration version');
check(!revisionHome.receiveConfiguration({ ...awayTeamV1, revision: 0 }) && revisionHome.revisions.away === 1, 'A delayed older team snapshot cannot roll the lobby back');
check(revisionHome.receiveReady(readyBeforeAwayTeam).accepted && revisionHome.remoteReady, 'Periodic Ready retry is accepted after the missing team revision arrives');

// Model the actual proposal -> ACK -> commit -> committed transaction. Every
// phase is retransmittable, while match entry remains exactly once and requires
// an explicit Home start intent.
class LaunchTransaction {
  constructor(configRevision) {
    this.configRevision = configRevision;
    this.startIntent = false;
    this.pending = null;
    this.guestAccepted = null;
    this.guestCommitted = new Set();
    this.hostCommitted = new Set();
    this.hostStarts = 0;
    this.guestStarts = 0;
  }
  requestStart(startIntent) {
    this.startIntent = !!startIntent;
    if (!this.startIntent) return null;
    this.pending ||= { launchId: `launch-${this.configRevision}`, configRevision: this.configRevision, phase: 'proposal' };
    return this.retry();
  }
  retry() {
    if (!this.pending) return null;
    return { type: this.pending.phase === 'proposal' ? 'launch-proposal' : 'launch-commit', launchId: this.pending.launchId, configRevision: this.pending.configRevision };
  }
  guestReceiveProposal(packet) {
    if (packet.configRevision !== this.configRevision || packet.type !== 'launch-proposal') return null;
    if (this.guestAccepted && this.guestAccepted.launchId !== packet.launchId) return null;
    this.guestAccepted = { launchId: packet.launchId, configRevision: packet.configRevision };
    return { type: 'launch-ack', ...this.guestAccepted };
  }
  hostReceiveAck(packet) {
    if (!this.startIntent || !this.pending || this.pending.phase !== 'proposal' ||
        packet.launchId !== this.pending.launchId || packet.configRevision !== this.configRevision) return null;
    this.pending.phase = 'commit';
    return this.retry();
  }
  guestReceiveCommit(packet) {
    if (!this.guestAccepted || packet.type !== 'launch-commit' || packet.launchId !== this.guestAccepted.launchId ||
        packet.configRevision !== this.configRevision) return null;
    if (!this.guestCommitted.has(packet.launchId)) {
      this.guestCommitted.add(packet.launchId);
      this.guestStarts += 1;
    }
    return { type: 'launch-committed', launchId: packet.launchId, configRevision: packet.configRevision };
  }
  hostReceiveCommitted(packet) {
    if (!this.pending || this.pending.phase !== 'commit' || packet.launchId !== this.pending.launchId ||
        packet.configRevision !== this.configRevision) return false;
    if (!this.hostCommitted.has(packet.launchId)) {
      this.hostCommitted.add(packet.launchId);
      this.hostStarts += 1;
    }
    return true;
  }
  configurationChanged(nextRevision) {
    this.configRevision = nextRevision;
    this.startIntent = false;
    this.pending = null;
    this.guestAccepted = null;
  }
}

const transport = new LaunchTransaction('0:1:1');
check(transport.requestStart(false) === null, 'Both Ready peers still cannot create a launch without explicit Home intent');
const firstProposalAttempt = transport.requestStart(true); // dropped
const retriedProposal = transport.retry();
check(firstProposalAttempt.type === 'launch-proposal' && retriedProposal.launchId === firstProposalAttempt.launchId, 'A dropped proposal retries with the same launch identity');
const firstAckAttempt = transport.guestReceiveProposal(retriedProposal); // dropped
const repeatedProposal = transport.retry();
const recoveredAck = transport.guestReceiveProposal(repeatedProposal);
check(firstAckAttempt.launchId === recoveredAck.launchId && repeatedProposal.type === 'launch-proposal', 'A dropped proposal ACK is repaired by retrying the same proposal');
const firstCommitAttempt = transport.hostReceiveAck(recoveredAck); // dropped
const retriedCommit = transport.retry();
check(firstCommitAttempt.type === 'launch-commit' && retriedCommit.launchId === firstCommitAttempt.launchId, 'A dropped commit retries with the same launch identity');
const firstCommittedAttempt = transport.guestReceiveCommit(retriedCommit); // dropped
const repeatedCommit = transport.retry();
const recoveredCommitted = transport.guestReceiveCommit(repeatedCommit);
check(firstCommittedAttempt.launchId === recoveredCommitted.launchId && transport.guestStarts === 1, 'A dropped committed ACK is repaired without starting Away twice');
check(transport.hostReceiveCommitted(recoveredCommitted) && transport.hostStarts === 1, 'Home starts exactly once only after the recovered committed ACK');
check(transport.hostReceiveCommitted(recoveredCommitted) && transport.hostStarts === 1, 'A duplicate committed ACK cannot start Home twice');

const concurrent = new LaunchTransaction('2:2:2');
const acceptedProposal = concurrent.requestStart(true);
const acceptedProposalAck = concurrent.guestReceiveProposal(acceptedProposal);
const conflictingProposal = { ...acceptedProposal, launchId: `${acceptedProposal.launchId}-other` };
check(concurrent.guestReceiveProposal(conflictingProposal) === null && concurrent.guestAccepted.launchId === acceptedProposal.launchId, 'Away rejects a different concurrent proposal without losing the accepted launch');
check(concurrent.guestReceiveProposal(acceptedProposal)?.launchId === acceptedProposalAck.launchId, 'A retry of the accepted proposal remains idempotently acknowledged');

class TimedLaunch {
  constructor(phase, startedAt = 0) {
    this.phase = phase;
    this.startedAt = startedAt;
    this.pending = true;
  }
  transmit(now) {
    if (!this.pending) return null;
    if (this.phase === 'proposal' && now - this.startedAt > 12000) {
      this.pending = false;
      return { type: 'launch-cancel' };
    }
    return { type: this.phase === 'proposal' ? 'launch-proposal' : 'launch-commit' };
  }
}

const proposalTimeout = new TimedLaunch('proposal');
check(proposalTimeout.transmit(12001)?.type === 'launch-cancel' && !proposalTimeout.pending, 'An unacknowledged proposal times out with an explicit cancellation');
const commitRetry = new TimedLaunch('commit');
check(commitRetry.transmit(12001)?.type === 'launch-commit' && commitRetry.transmit(120000)?.type === 'launch-commit' && commitRetry.pending, 'A commit keeps retrying beyond the proposal deadline until confirmation or disconnect');

class DisconnectLifecycle {
  constructor() {
    this.active = null;
    this.disconnectHandled = false;
    this.handled = [];
  }
  accept(id) {
    this.active = id;
    this.disconnectHandled = false;
  }
  disconnect(id) {
    if (id !== this.active || this.disconnectHandled) return false;
    this.disconnectHandled = true;
    this.handled.push(id);
    return true;
  }
}

const lifecycle = new DisconnectLifecycle();
lifecycle.accept('first');
check(lifecycle.disconnect('first') && !lifecycle.disconnect('first') && lifecycle.handled.length === 1, 'Close and error from one connection share one disconnect cycle');
lifecycle.accept('replacement');
check(lifecycle.disconnect('replacement') && lifecycle.handled.join(',') === 'first,replacement', 'A replacement connection resets the guard even if it fails before opening');
check(!lifecycle.disconnect('first') && lifecycle.handled.length === 2, 'A late event from the replaced connection cannot consume the active connection guard');

class LockedConfiguration {
  constructor() {
    this.launchRequested = false;
    this.revision = 0;
  }
  localChange() {
    if (this.launchRequested) return false;
    this.revision += 1;
    return true;
  }
}

const lockedConfiguration = new LockedConfiguration();
lockedConfiguration.launchRequested = true;
check(!lockedConfiguration.localChange() && lockedConfiguration.revision === 0, 'Late UI change events cannot mutate configuration after launch begins');
lockedConfiguration.launchRequested = false;
check(lockedConfiguration.localChange() && lockedConfiguration.revision === 1, 'Configuration editing resumes after a failed or cancelled launch unlocks the lobby');

const staleTransaction = new LaunchTransaction('1:1:1');
const staleProposalAttempt = staleTransaction.requestStart(true);
const staleAckAttempt = staleTransaction.guestReceiveProposal(staleProposalAttempt);
const staleCommitAttempt = staleTransaction.hostReceiveAck(staleAckAttempt);
staleTransaction.configurationChanged('1:2:1');
check(staleTransaction.guestReceiveCommit(staleCommitAttempt) === null && staleTransaction.guestStarts === 0 && staleTransaction.hostStarts === 0, 'A team/settings revision change cancels an accepted but uncommitted stale launch');

assert.deepEqual(productionFailures, [], `Production lobby protocol is incomplete:\n- ${productionFailures.join('\n- ')}`);

console.log(`online lobby sync: ${passed}/${passed} checks passed`);
