# DARTY U0 — football mechanics audit and upgrade plan

Audit date: 18 October 2026. Owner: Joshua Gordon Jones / Toucan Learn. Director: Claude. Joe supplies playtest feedback and writes commentary. This is a local, read-only gameplay audit on `codex/darty-upgrade`, starting at `68566378220444eec749b884a4f3e92d97798f3b`. Only this document, observation helpers and audit evidence were added. No gameplay, assets, tuning, dependencies or release files were changed. No commit, push, merge, installation or deployment was performed.

**Assessment:** DARTY has substantial football machinery worth keeping. Its largest problem is incomplete composition: different parts of an ordinary match use different action, decision and physics paths. The new outfield modules are much better evidenced than a complete match with keepers, fouls, dismissals, all restarts and every input. Upgrade those seams and the football choices around them; retain the models, DARTY character and accepted controls.

## Evidence boundaries

Statuses describe the requested football capability, not the existence of a function. **works** means the stated narrow contract was exercised; **partly** means a useful implementation exists but coverage, integration or acceptance is incomplete; **broken** identifies a specific contradictory or failed contract; **missing** means no route was found in the audited live path. Unproven is not automatically broken.

| Mark | Proof level | Meaning in this audit |
|---|---|---|
| C | Code read | Current source and call sites inspected. This establishes reachability or a defect in the implementation, not how it feels. |
| U | Unit/fixture execution | Executed Node functions or controlled compositions. |
| US | Source-contract test | A Node test passed/failed against source text. We do not promote this to executed gameplay. |
| S | CPU-v-CPU simulation | Fixed-tick **adapter probes**, with the simplified test host explicitly described below. Not complete matches. |
| B | Browser run | **No successful browser run in U0.** Local server binding was denied; installed Chrome aborted on launch. |
| JH | Joe/Josh historical playtest | A named verdict recorded in the supplied repository documents. No new Joe/Josh playtest occurred. Publication approval is not feel acceptance. |

Read: `README.md`, `CHANGELOG.md`, `FOOTBALL-LEGACY-BASELINE.md`, `REQUEST-LOG-v0.98.md`, both `PLAYTEST-NOTES-*.md`, `JOSH-HANDOFF.md`, match/Quick Play READMEs, current input/host call sites, the V2 modules and relevant tests. Claude's supplied `CLAUDE-ADVICE-FOR-DARTY-2026-10-17.md` was read at the read-only sister-project path. Its principles inform the plan; it is not evidence that DARTY implements them.

Historical text needs care: the baseline document still describes two hits, the September changelog/README/current tracker specify one; the old v0.28.6 note assigns diving to R3, whereas current R3 is flick-up and D-pad Down is dive. Old Online/2P notes do not make those workflows available in current FL V2. Module headers saying “dormant” are also stale: the current preflight loads those modules.

### What actually owns a match

`quick-play/app.js::finalizeMatchPayload/saveAndLaunch` creates the V2 envelope, seed and ownership. `match-engine/match.html` validates it, loads the modules, hosts the scene, collects input and commits transactions. Normal eligible outfield ticks use `live-v2-authority-adapter.js` with Movement, CPU, Formation, Ball, First Touch, Dribbling and Aerial V2. The host owns keeper decisions/saves, referee decisions, offside adjudication, normal restart execution and presentation; Clock/Control V2 also compose over it.

**Material contradiction, C:** `match.html::liveV2CanAdvance` (around line 2117) rejects any sent-off outfielder, keeper possession, a human controlling a keeper, and active skills/slides/flicks/aerial locks. `update` (around lines 5430–5505) then explicitly runs `!liveV2LiveTick` movement, `updateTeamAI`, contact and ball branches. `liveV2ObserveBoundary` resets the adapter across those handoffs. This is separate from the genuine strict stop on a failed V2 transaction. The documentation's “no previous-engine tick” promise is broader than the source implementation. A red card can exclude V2 outfield play for the remainder of the match, not merely one animation.

Do not remove the host or old models in response. First record authority by phase, define deliberate protected handoffs, and migrate one action at a time. The upgrade needs shared action outcomes and honest diagnostics, not a wholesale engine rewrite.

## 1. Mechanics matrix

Paths below are relative to this repository. `H` means `match-engine/match.html`; all named `*-v2.js` modules are in `match-engine/`. Test filenames refer to `tests/`. A test mentioned with US establishes only its source contract.

| Mechanic | Status | Evidence and proof level | Owning file / function |
|---|---|---|---|
| Movement, acceleration, rated turning | works within V2; partly across handoffs | U: Movement suite exercises rated movement, turns, limits and determinism. JH: request log preserves Josh's “running… feels amazing” verdict. No new B/J proof. | `movement-engine-v2.js::advance/step`; H `applyLocomotionInput`, `liveV2ApplyMovement` |
| Sprint and stamina | partly | U: sprint/fatigue/recovery model exists; S: speed bounds passed. C: V2 per-second drain/recovery and host per-frame stamina are different models. Keyboard Shift and pad right trigger reach them. | Movement `DEFAULT_CONFIG`, `advance/step`; H `update`, `pollBoundPad` |
| First touch / receiving | partly | U: foot, thigh, chest, header cushions; heavy/missed touches and timing. S: intended receptions and moving-runner passes occur. C: the human live snapshot supplies a directional **cushion**, not every available module intent. | `first-touch-v2.js::resolve`; `first-touch-authority-adapter-v2.js`; H `liveV2Snapshot/liveV2ApplyContact` |
| Physical dribbling / shielding | partly | U: separated touch leases, chase/resecure, buffers and turnover. S: physical touch cadence and possession continuity pass. C: shield input is pad-only; protected skills still leave this path. | `dribbling-state-v2.js::resolve`, `CONFIG`; H `liveV2QueueDribbleAction`, `pollBoundPad` |
| Stepover | partly | C: Q contextual single move, pad L2+RS chain up to six and exit. US: input/contact contracts pass. CPU V2 emits no stepover intent; older host AI can use one during host-owned play. | H `doSkill`, `registerStepoverFlick`, `updateStepoverChainState`, `startStepoverExit` |
| Roulette | partly | C: Q double-tap and RS down half-circle exist; skill utility exists. No new normal-play execution. Same handoff/CPU gap. | H `finishRightStickGesture`, `doSkill`, `updateActiveSkill` |
| Flick-up | partly | C: R3 variants and physical loose-ball/aerial risk; no keyboard binding found. Host special-action ownership rather than continuous V2 dribble authority. | H `attemptFlickUp`, `nextFlickUpVariant`, `pollBoundPad` |
| Fake shot / directional exit | partly | C: Shoot/Lob then Pass cancellation and exit utility exist; no keyboard route. Random utility can wrong-foot defenders. | H `performFakeShot`, `primeSkillUtility` |
| Ball roll, drag-back, feint, lane change, knock-on | partly | C/U: Q context and pad directional touch paths; normal directional ladder has dedicated tests in repo but was not rerun in U0. JH: Candidate 5 records accepted light/strong/double bounds. Do not silently retune. | H `doSkill`, `directionalKnockOnInput/Plan`, `performDirectionalKnockOn` |
| Short pass | works in scoped fixtures; partly as full football | U/S: passes, interceptions and chains occur. JH: normal-X profile accepted historically. Human channel/charge and CPU launch formula differ. | H `doPassForHuman`, `humanGroundPassTrajectory`, `liveV2ApplyIntelligence`; adapter pass-race gate |
| Lob / long pass | partly | C: charged Square, low/driven modifiers and V2 service physics. S: long passes occur, but probe chooses a simplified trajectory, not the live human lob. No dedicated keyboard lob. | H `doLobPassFor`, `standardV2AerialServiceTrajectory`; Ball `resolveLaunch/step` |
| Ground through ball | partly | C: Triangle charge/direction and receiver rendezvous; R1 driven variant. No keyboard route. Ordinary CPU V2 exposes generic pass targets rather than the full human through vocabulary. | H `controllerThroughDown/Up`, `doThroughPassFor` |
| Over-the-top / flair through ball | partly | C: L1+Triangle, L2+Triangle and combined flair loft. CPU V2 does not choose these distinct actions. | H `doThroughPassFor`, `flairPassExecution` |
| Crossing / low cross / cutback / box occupation | partly; CPU live V2 cross planner missing | C: human cross trajectory and contest metadata exist. Older host `aiPass` cross/box-run planners exist, but `liveV2ApplyIntelligence` emits generic ground/long passes, not an authored cross action. Old v0.96 “CPU crosses” text does not prove this path. | H `doLobPassFor`, `aiPass` cross branch, `assignAerialRuns`; `cpu-intelligence-v2.js::carrierIntent` |
| Normal / placed / finesse shooting | partly | C/U: human finesse + normal, CPU placed profile and keeper model fixtures; CPU range/goal-third search implemented. No U0 full-browser shot matrix. | H `doShootForHuman`, `humanOpenPlayShotPaceMetresPerSecond`, `liveV2ApplyIntelligence`; CPU `carrierIntent` |
| Driven / power shooting | partly | C: human double-tap low-driven and charged normal power; CPU low-driven/driven/power branches. US: October shooting contracts pass. No independent human open-play “power-shot combo”. | H `controllerShootDown/Up`, `doShootForHuman`; CPU `shotProfile` |
| Chip shooting | missing in normal human open play | C: chip penalty exists; no open-play chip mapping/branch found in human shoot pipeline or CPU V2 choice. Do not label penalty chip a complete chip-shot feature. | H `penaltyPhysicsPlan`; missing extension in `doShootForHuman` / CPU `carrierIntent` |
| Volley / header / first-time finish | partly | U: Aerial V2 timing, reach and launches. US: human Circle intent requires a physical contest. C: automatic CPU aerial contact exists, but no full CPU cross/finish-command repertoire; keyboard S can request attacking finish. | `aerial-contact-v2.js::resolveContact`; H `queueHumanAerialFinish`, `resolveAerialDuel`, `performHeader/Volley` |
| Keeper positioning / angle / sweeper | partly | C: goal-bisector, near post, cover and arrival decisions exist. U: targeted keeper fixture contracts. Outside Movement V2 authority. | H `goalkeeperPositioningContract`, `goalkeeperDecisionContract`, `updateGoalkeeper` |
| Keeper catch / parry / rebound | partly | U: contact envelope rejects distant standing saves, penalises powerful/placed shots, prevents repeat lottery on one shot. C: contact then probabilistic save/catch; some catch paths move the keeper toward the ball. Not wholly hand-contact physics. | H `keeperShotContactEnvelope`, `keeperContactSaveModel`, `resolveKeeperBoxShotContest` |
| Low gather / slow roll | partly | U: fast/distant balls excluded from last-chance slow save; reachable slow balls accepted. C: loose-ball claim/low-scoop exists; full animation/contact under pressure unproven. | H `goalkeeperLooseBallContext`, `resolveGoalkeeperLooseBall`, `resolveSlowReachableKeeperSaveBeforeGoal` |
| Keeper distribution | partly | C/US: roll/throw/launched throw/kick/long kick and 5-second host release exist; human/CPU input context differs. Ownership switches to host while keeper holds ball. | H `keeperKick`, `goalkeeperDistributionPlan`, `executeGoalkeeperDistribution`, `controllerPassUp` |
| Keeper 1v1 / smother | partly | C: cover/arrival/rush model and cooldown; smother/block remains probabilistic. No full B shot/1v1 drill. | H `goalkeeperOneVOneContext`, `resolveKeeperOneVOne` |
| Human keeper dives | partly | C: penalty RS choices only; no general manual keeper-dive action found for open play. Do not confuse outfielder simulation with keeper diving. | H `pollPenaltyKeeperChoice`, `updatePenaltyKeeperDecision` |
| Standing tackle | partly | U: Movement contact/action phases. C: human host poke and V2 CPU stand-tackle are different entry paths. V2 contact projection increments tackle stats but does not forward a foul decision. | Movement `advance/step`; H `doPoke`, `tryTackle`, `liveV2ApplyMovement` |
| Slide tackle | partly | U: October recovery-slide decision and action/contact/recovery tests pass. C: CPU V2 can emit slide; human slide uses host staging, and active slide counters can change authority for everyone. | CPU `physicalActionFor`; Movement slide profile; H `primeSlideTackle`, `advanceSlideTackle`, `stageAutonomousContactPresentation` |
| Shoulder challenge | partly | U: Movement contests; C: automatic proximity/context, no explicit shoulder button. V2 winning contacts can pop a head; host shoulder/foul model differs. | Movement shoulder action; H `performShoulderBarge`, `resolveShoulderContact`, `liveV2ApplyMovement` |
| Shirt pulling | partly | C/US: repeated defensive Circle taps, contextual target and three-pull discipline. No keyboard binding. `updateOfficiatingSystems` can also call stochastic CPU pulling outside CPU V2's action repertoire. | H `registerShirtPullTap`, `beginShirtPull`, `updateShirtPulls`, `maybeAIOfficiating` |
| Outfield dives / simulation | partly | C/US: X or D-pad Down, three performances, challenge context, warning/simulation/foul result, replay and box downgrade. Host CPU opportunity hook exists; no CPU V2 dive intent. Its evidence depends on host challenge context. | H `attemptDive`, `decideDiveOutcome`, `aiDiveOpportunity`, `maybeAIOfficiating` |
| Referee judgement / foul-to-contact bridge | broken as a unified contract | C: `liveV2ApplyMovement` consumes tackle/slide/shoulder contacts for presentation/stats; Movement has no foul/severity law resolution and that loop does not call `awardFoul`/record host challenge evidence. Host tackles use separate foul/risk code. A consistent human/CPU contact-to-law outcome is missing. This is a code finding, not a measured live foul rate. | H `liveV2ApplyMovement`, `stageAutonomousContactPresentation`, `awardFoul`; Movement contact telemetry |
| Advantage | missing | C: `awardFoul` starts a stoppage sequence; no retain-possession/recall/deferred-card advantage state found. “Skill advantage” strings are unrelated. | H `awardFoul/startFoulSequence`; future referee outcome state |
| Cards / second yellow / dismissal | partly; V2 continuation broken | C: severity, tactical foul, simulation, dissent, second yellow and red exist. Any sent-off outfielder fails the V2 gate. U: formation module supports player reduction, but host composition does not preserve that path. | H `issueCard`, `liveV2CanAdvance`; Formation reduction logic |
| Offside | partly | C/US: kick-time ball/second-last-defender line including GK, own-half/level handling and direct restart exemptions; involvement/presentation path exists. C: mistimed CPU runs can reposition a target at release, which needs fairness review. No full-match offside rate. | H `offsidePositionAtKick`, `armOffsideCandidate`, `beginOffsidePresentation`, `liveV2ApplyIntelligence` |
| Throw-in | partly | C: aim/charge, physical throw trajectory and receiver support; CPU restart planner. No full match proof or illegal-throw/retake coverage established. | H `restart`, `standardThrowTrajectory`, `takeUserRestart`, `aiRestartPass` |
| Goal kick | partly | C/U: exclusion geometry, short/long distribution, directional services and restart coordinate fixtures. Full normal-match sequence unproven. | H `enforceGoalKickExclusion`, `takeUserRestart`; coordinate/control modules |
| Corner | partly | C/U: placement, service family and contests; suite fixtures execute module rules, not normal-match frequency or attacking success. | H `restart`, `setPieceDeliveryPlan`, `assignAerialRuns`; `set-piece-suite-v2.js` |
| Free kick | partly | U: suite/coordinates and run-up fixtures; US failure described below is an outdated exact call-pattern expectation. C: grounded Pass versus aerial Lob, dip/driven/curl shots and foot mirroring. Keyboard cannot choose every pad technique. | H `takeUserRestart`, `takeUserSetPieceShot`, `lockFreeKickAim`, `updateFreeKickRunUp` |
| Penalty | partly | U: controlled suite/clock contracts. C: run-up and five-choice 400ms post-contact keeper window. CPU choice is weighted using `actualChoice` derived from target Y/Z; it is a scripted reading model, not proof of a physically observed, fair reaction. Preserve the accepted interaction while reviewing its implementation. | H `penaltyPhysicsPlan`, `openPenaltyKeeperDecision`, `updatePenaltyRunUp` |
| Kick-off / goal restart | partly | C/U: centre/own-half/circle legality, pass-to-start, readiness/whistle and watchdogs; period composition tests. Normal goal→replay→kickoff chain not browser-tested in U0. | H `kickoff`, `legalKickoffPoint`, `restartCanBeTaken`, `completeRestart`; Control V2 |
| Restart double touch / backpass / handball / retakes | partly / missing coverage | C: loose-ball keeper claim rejects own-team touches, but this is not complete deliberate-backpass judgement; no complete handball, double-touch, encroachment and retake framework found. Avoid claiming full Laws coverage. | H `goalkeeperLooseBallContext`, `takeUserRestart`; missing shared restart-law outcomes |
| Substitutions / identity / limits | broken as a complete substitution | C: home-only UI swaps name/attrs/appearance/role into the existing starter; ID, number, preferred foot, accumulated stats and disciplinary/action state are not comprehensively replaced. Outgoing player is put back on bench; no substitution-count/window enforcement or autonomous away substitution found. | H `renderSubs`, `confirmSub` click handler around line 7626 |
| Half-time / full-time / added time | partly | U: match clock and period/control compositions pass. C: host presentations and restart handoffs still need full-match acceptance. S probe has no proper periods. | `match-clock-v2.js`, `live-v2-match-control-composition.js`; H `canSettlePeriod`, `beginFullTimeWalkin`, `endMatch` |
| Changing ends / competition completion / injuries | partly / missing extensions | C: second half restarts for away, but `attackDirection` remains fixed by team and no changing-ends transform was found. Quick Play draws are valid; extra time/shootouts and playable injury treatment were not established. These optional competition/injury extensions must not expand the first normal-match upgrade into Career work. | H `attackDirection`, `update` half-time branch; Clock/Control; Quick Play mode contract |
| Formations / lines / width / compactness | partly | U: validated canonical shapes, phases, philosophy overlays, reduced-player plans. S: actual movement has measurable width/length, not merely labels. No phase-specific normal-match calibration; red-card gate bypasses this machinery. | `formation-behaviour-v2.js::resolve`; adapter `formationOutputs/targetMaps`; H `liveV2TeamRoster` |
| Off-ball runs / support triangles | partly | U/S: run commitments, rest defence, lane conflict checks and moving-runner receptions. No guaranteed coordinated short/wide/deep support triplet or full team visual acceptance. Old host attack plans are not proof of V2 equivalence. | CPU `buildCandidates`, `persistCommitments`, `selectNewRuns`, `targetForRun`; adapter `targetMaps` |
| Pressing / cover / recovery | partly | U: primary presser + cover, rest-defence floor, action cooldown. S: sampled near-ball defenders do not swarm. C: V2 defence primarily reacts to a carrier/geometry, lacking the full bad-touch/backpass/touchline/facing trigger state machine. | CPU `defensiveSelection`, `buildDefensiveIntents`; adapter `looseBallRecoveryAssignments` |
| Pass/shoot/carry decisions / commit windows | partly | U/S: run commits 24–96 ticks, rated reaction 1–5 ticks; rejected pass hold and dribble action buffer. C: `decide/carrierIntent` still evaluates each eligible tick; shot-first/opened-run/support/carry priorities are not one comparable utility model with a stable carrier decision cadence. | CPU `decide/carrierIntent`; adapter rejected-pass and dribble commitment logic |
| Possession memory / ping-pong / urgency | partly | U: immediate unpressured defender return suppressed, pressured outlet preserved. S: sampled ABA exists, ABAB not observed. C: memory holds one completed passer/receiver pair, not last-two history or team-wide stagnation urgency in V2. | CPU `observeCirculationOutcome`, `rememberCirculationPass`, `carrierIntent` |
| CPU personalities / difficulty fairness | partly | C: attributes, role families and team philosophy influence choices; host has temperament/composure/reputation. No explicit per-player shot-happy/dribbler/safe-passer tendency policy feeding the complete V2 repertoire. Do not equate different ratings with complete personalities. | CPU `normalizePlayer/carrierIntent`; Formation philosophy overlays; H `mk`, `D0` |
| Ball physics / ground feel / spin / weather | partly | U: MR aerodynamic, skid/roll/settle and energy/collision contracts; S: physical touches/pass flight. JH: accepted normal pass/touch calibration. C: multiple host/CPU/human launch and damping profiles; current feel not judged in U0. | `ball-engine-v2.js::resolveLaunch/step`, `DEFAULT_CONFIG`; H trajectory and pass helpers |
| Player / ball / goal collisions | partly | U: Movement separation/contact and Ball colliders; Aerial/First Touch contests. C: host goalkeeper/goalframe/body handling and handoff paths remain separate; not proof of actual animated hand/boot contact in every case. | Movement `advance/step`; Ball colliders; `live-v2-contact-authority-composer.js`; H `resolveBallBlock`, `update` |
| Replays / camera / skip / restoration | partly | U/US: replay/keeper-cadence and offside camera contracts; C: event-specific replays, pause review, full-state archive and set-piece rigs. Long normal-play interruption rhythm needs Joe/Josh; no new visual proof. | `instant-replay-review-v2.js`, `playtest-full-state-replay-v1.js`; H replay directors, `resolveSetPieceCameraRig` |
| DARTY hard-hit / toy pop | works in tracker fixtures; live rate unproven | U: hard win, deduplication, episode separation, reset and slide-contact tests. C: only committed Movement telemetry enters tracker, presentation queue drains separately. Current default is ONE qualifying hit. No U0 ordinary-play pop or visual proof. | `darty-impact-v1.js::createTracker/register`; H `dartyRecordCommittedContacts`, `dartyDrawFlights` |
| Audio / event hooks | partly | C: gesture unlock, crowd/whistle/kick/contact hooks and event log. US: existing contracts only; no listening test. Browser autoplay/unlock must be checked on Joe's browser. | H `initAudio`, `kickSound`, `crowdReaction`, `whistle`, `logEvent` |
| Professional commentary | missing, deliberately deferred | Request log explicitly defers it. Hooks are reusable, but no authored Joe-line selection, subtitle/cooldown/no-repeat engine established. No new dialogue belongs in U0. | Future consumer of H `logEvent`; Joe-authored templates |
| Performance / pacing | partly | U/US: fixed 60Hz, render profiles and bounded ball substeps; S: measured adapter cost below. No U0 browser FPS/long-frame or memory profile. CPU decisions, clones and report scans can be expensive. | H `loop`, `blankPerformanceTelemetry`; Ball `maxSubstep`; adapter `planTick/commitTick` |
| Complete deterministic match / replay harness | missing | U: same-seed adapter replay and restore pass. C: host uses `Math.random`, wall clocks and timers; archive playback is not a deterministic complete-match resimulation. | Adapter export/restore; H `Math.random/performance.now/setTimeout`; `playtest-full-state-replay-v1.js` |
| Modes / saves / recovery | partly | C/U/US: strict launch and supported Quick Play ownership checks. Only Single Player, CPU vs CPU and Set-Piece Suite are eligible. Career statistical match simulation remains separate; Online, local 2P/co-op are not complete V2 gameplay. | `quick-play/app.js`; H preflight/strict stop; README mode boundary |

## 2. Input coverage matrix

This is **current source reachability**, not physical-pad certification. `Y` = mapped and contextually reachable by code; `P` = only part of the action family; `—` = no dedicated route found. **All live results are unproven in U0**, including mapped actions. Synthetic tests do not establish USB/Bluetooth/browser compatibility. Actions without an input are contextual/automatic where stated.

Face buttons by physical standard Gamepad API index: south 0 = DualSense Cross / Xbox A / Switch **B**; east 1 = Circle / B / Switch **A**; west 2 = Square / X / Switch **Y**; north 3 = Triangle / Y / Switch **X**. Switch naming here is positional as Joe requested. Bumpers/triggers are L1/R1/L2/R2, LB/RB/LT/RT, L/R/ZL/ZR respectively. `RS` means right stick; `R3` means its click. This table covers the supported single-human route; dormant controller-2 functions are not a released 2P claim.

| Action | Keyboard | DualSense | Xbox | Switch Pro | Live FL V2 / owner / qualification |
|---|---|---|---|---|---|
| Move / receive direction / aim | Y Arrows | Y LS | Y LS | Y LS | C: `movementInput/liveV2Snapshot`; unproven in browser |
| Sprint | Y Shift | Y R2 | Y RT | Y ZR | C: Movement path; radial stick deadzone already .15 |
| Shield / protect ball | — | Y L2, RS neutral | Y LT, RS neutral | Y ZL, RS neutral | C: `pollBoundPad`; not a keyboard action |
| Nearest manual switch / in-flight receiver override | Y W | Y L1 release | Y LB release | Y L release | C/US: preserves pass trajectory; modifiers consume release |
| Directional switch | — | Y RS direction while defending | Y RS | Y RS | C: `directionalPlayerSwitch`; context conflicts require pad drill |
| Short charged ground pass | Y A | Y Cross | Y A | Y B | C/U/S: `doPassForHuman`; press/release power |
| Ground through pass | — | Y Triangle | Y Y | Y X | C: charge/release; not keyboard W (W switches) |
| Driven through pass | — | Y R1+Triangle | Y RB+Y | Y R+X | C: `doThroughPassFor(...driven)` |
| Over-the-top through pass | — | Y L1+Triangle | Y LB+Y | Y L+X | C: preserve this exact modifier |
| Flair through / flair over top | — | Y L2+Triangle / +L1 | Y LT+Y / +LB | Y ZL+X / +L | C: rating/failure variants |
| Lob pass / cross | — | Y Square | Y X | Y Y | C: contextual cross; aim/charge |
| Low cross / lower service | — | Y R1+Square | Y RB+X | Y R+Y | C: `doLobPassFor` |
| Driven lob / service | — | Y L1+R1+Square | Y LB+RB+X | Y L+R+Y | C: **L1+Square alone remains ordinary lob**, no new combination |
| Normal / charged power shot | Y S hold | Y Circle hold | Y B hold | Y A hold | C: calibrated normal profile; no separate power-shot chord |
| Placed / finesse shot | — | Y R1+Circle | Y RB+B | Y R+A | C: human finesse; CPU “placed” is its own profile |
| Low-driven shot | Y S double tap | Y Circle double tap | Y B double tap | Y A double tap | C/US: timing windows, second press suppresses delayed normal shot |
| Open-play chip | — | — | — | — | Missing action/mapping; penalty chip is separate |
| Attacking header / volley request | Y S | Y Circle | Y B | Y A | C/U/US: same request; physical height/contest selects technique |
| Aerial pass / header pass | Y A | Y Cross | Y A | Y B | C: airborne contextual pass |
| Defensive aerial clearance | — dedicated | Y Square | Y X | Y Y | C: airborne eligible contest; no button grants ownership |
| Flair aerial / acrobatic finish | — | Y L2+Circle/Square | Y LT+B/X | Y ZL+A/Y | C: physical contest/height/eligibility |
| Fake shot / fake lob | — | Y Circle/Square then Cross | Y B/X then A | Y A/Y then B | C: charge/pending window and exit with LS |
| Contextual stepover | Y Q without directional alternative | P explicit L2+RS chain | P LT+RS | P ZL+RS | C: keyboard move differs from full pad chain |
| Chain stepovers and exit | — | Y L2+RS up/down, LS exit | Y LT+RS, LS | Y ZL+RS, LS | C: max six, neutral/exit latch; unproven on pads |
| Roulette | Y Q twice | Y RS down half-circle | Y same RS gesture | Y same RS gesture | C: current RS recogniser is roulette; old stepover advice is stale |
| Ball roll / drag-back / body feint | Y Q+relative direction | — dedicated route | — dedicated route | — dedicated route | C: generic `doSkill` has these variants, but no direct normal-play pad route for each was established |
| Legacy knock-on / lane change | Y Shift+Q+forward/side | P contextual | P contextual | P contextual | C: keyboard route differs from dedicated directional touch |
| Directional light/strong/double knock-on | — equivalent ladder | Y L1+RS flick, sprint/double timing | Y LB+RS | Y L+RS | C: preserve Candidate 5 semantics and shared player speed |
| Flick-up | — | Y R3 | Y RS click | Y RS click | C: four variants; **R3 does not dive** |
| Standing tackle | Y D once | Y Circle defending | Y B defending | Y A defending | C/U: tap delay/host action; CPU V2 has separate action entry |
| Slide tackle | Y D twice | Y Square defending | Y X defending | Y Y defending | C/U: different keyboard/pad gestures; recovery must be playable |
| Shoulder challenge | P contextual collision | P contextual | P contextual | P contextual | C: no explicit shoulder action button |
| Shirt pull | — | Y repeated defensive Circle taps | Y repeated B | Y repeated A | C/US: not keyboard D double tap, which slides |
| Outfield dive / simulation | Y X | Y D-pad Down | Y D-pad Down | Y D-pad Down | C/US: normal match; suite Down repeats instead |
| Open-play manual keeper dive | — | — | — | — | Keeper chooses saves automatically; no general manual dive route found |
| Keeper roll / throw / launched throw | P A fixed throw | Y Cross charge (tap/medium/long) | Y A charge | Y B charge | C/US: goalkeeper must own ball |
| Keeper foot kick / long kick | P S kick | Y Circle kick / Square long | Y B / X | Y A / Y | C: keyboard lacks explicit long-kick choice |
| Throw-in aim / release | Y Arrows + A | Y LS + Cross charge | Y LS + A | Y LS + B | C: Square/Shoot restart alternatives also exist; legal context required |
| Goal kick short / long service | P Arrows+A/S | Y Cross / Square | Y A / X | Y B / Y | C: keyboard S long restart exists; full service-mode parity absent |
| Corner delivery / low / driven | P Arrows+A/S, default service | Y Square / R1+Square / L1+R1+Square | Y X / RB+X / LB+RB+X | Y Y / R+Y / L+R+Y | C: modes limited by missing keyboard lob modifiers |
| Free-kick camera aim / lock / spin | Y Arrows, S lock, Arrows spin | Y RS / Circle / LS | Y RS / B / LS | Y RS / A / LS | C: hidden aim plane; spin after lock |
| Free-kick dip / driven / curl shot | P S dip only | Y Circle / L1+Circle / R1+Circle | Y B / LB+B / RB+B | Y A / L+A / R+A | C: keyboard not full three-technique parity |
| Free-kick grounded / aerial / low / driven service | P A ground | Y Cross / Square / R1+Square / L1+R1+Square | Y A / X / RB+X / LB+RB+X | Y B / Y / R+Y / L+R+Y | C/US: current source-call test fails; zero-loft branch still present |
| Penalty normal / chip / aim | Y S / Shift+S, Arrows | Y Circle / L1+Circle, LS/RS | Y B / LB+B | Y A / L+A | C/U: staged approach then contact |
| Penalty keeper corner / stay centre | — corner; automatic neutral fallback | Y RS diagonal / neutral | Y RS diagonal / neutral | Y RS diagonal / neutral | C: 400ms after contact; keyboard arrows do not feed `pollPenaltyKeeperChoice` |
| Kick-off / other restart release | Y A, contextual S | Y Cross, contextual shot/lob | Y A | Y B | C: cannot shoot directly to start kickoff |
| Substitutions / formation/tactic changes | P pause UI keyboard/mouse | P pause/menu navigation | P pause/menu navigation | P pause/menu navigation | C: reachable UI, incomplete substitution semantics; not an action button |
| Pause / resume | Y Esc or P | Y Options | Y Menu | Y + | C/US: suite menu ownership differs; P also special celebration context |
| Replay skip | Y Space | Y Cross | Y A | Y B | C: restore held restart; test all incident types |
| Replay review controls | P pause review UI | P pause review UI | P pause review UI | P pause review UI | C: separate review controller in `instant-replay-review-v2.js`; not verified on hardware |
| Camera cycle / selection | Y C / pause UI | P pause UI | P pause UI | P pause UI | C: no dedicated live pad camera-cycle mapping found |
| Celebration choices / special celebration | Y 1–9 / P context | Y D-pad/face contextual | Y same positions | Y same positions | C: `controllerCelebrationChoice`; preserve existing choices |
| Fight / card confrontation | Y F context | Y L3+R3 | Y both stick clicks | Y both stick clicks | C: preserve as DARTY feature; not a prerequisite for realistic football |
| Suite place / repeat / penalty shortcut | Y U / R | Y D-pad Up / Down | Y D-pad Up / Down | Y D-pad Up / Down | C/U: only Set-Piece Suite; context changes meaning |
| Menu select / back / stage navigation | P standard page UI | Y Cross / Circle, LS/D-pad | Y A / B | Y B / A | C/US: `controller-ui.js`; live canvas excludes menu consumption |
| Audio toggle / report note / export | Y pause UI | P pause UI; text needs keyboard | P same | P same | C: audio unlock may require click; Joe writes timed notes |
| DARTY pop | Automatic hard winning contact | Automatic | Automatic | Automatic | U/C: no cheat/pop button; `debugDartyVisual` is synthetic evidence only |
| Guaranteed goal | Disabled by default; G gated | — normal action | — | — | C: test convenience, exclude from football acceptance |
| Remap / calibration / raw input test | — full workflow | — full workflow | — full workflow | — full workflow | Existing preview/debug helpers are not a complete remapping/test screen |

Hardware gaps: raw DualSense face-button and D-pad fallback exists; standard Xbox/Switch detection and reconnect clearing exist. Non-standard Switch layouts/Joy-Cons are not certified. Test actual DualSense, Xbox and Switch Pro in Joe's browser, wired and Bluetooth only where supported; record browser/OS/device ID/mapping, not merely “controller connected”.

## 3. CPU-v-CPU evidence

### Executed checks and reproducibility

Node was not on shell PATH. The already-installed runtime `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node` (v24.21.0) was used. No package or browser was installed/downloaded.

1. Twenty-two focused test files: **327 tests, 326 passed, 1 failed**. Raw output: `audit-evidence/focused-tests.txt`. It covers CPU, Movement, Formation, Ball, Dribbling, First Touch, Aerial, DARTY, keeper balance, contact/input, slides, replay cadence, clock/control, set pieces, offside camera, controller launch and render-profile contracts.
2. Existing tempo suite: **5 tests passed** including eight seeds, passive body/reaction probes, touch cadence, same-seed replay/export-restore and chronology rejection. Raw: `audit-evidence/tempo-baseline.tap`; parsed report: `audit-evidence/tempo-baseline.json`.
3. Additional observation-only metrics: `tools/audit-cpu-v2.mjs` loads the existing fixture's definitions in memory and wraps committed projections; it does not edit the fixture or engines. Three seeds × 1,800 ticks at 60Hz. Raw/structured: `audit-evidence/cpu-probes.jsonl` and `cpu-probes.json`.

The failing test is `human-aerial-finish-and-free-kick-input-authority.mjs:64`: its regex expects a call ending immediately after `{v2SpeedWorld:v2Speed,v2LoftWorld:0}`. The current call includes further ground-damping options. Zero loft and the ground-pass branch remain in source. Classify this as **failed US / probable stale assertion**, not as a demonstrated broken free kick. Repair the assertion and execute the actual launch in a future implementation task; U0 changes neither test nor gameplay.

Re-run from this worktree (use `node` where already available):

```sh
FL_CPU_V2_COMPACT=1 node --test tests/cpu-v-cpu-v2-tempo-characterization.mjs
node tools/audit-cpu-v2.mjs
```

Default probe seeds are 173, 442, 1967. Override with `DARTY_AUDIT_SEEDS=173,442,1967` and `DARTY_AUDIT_TICKS=1800`. Keep `FL_CPU_V2_FOOTBALL_BASELINE`, `FL_CPU_V2_TF_PHYSICAL` and `FL_CPU_V2_PASS_RACE` unset for this baseline; output records both physical-touch and pass-race flags as true.

### These are not full matches

The Node modules run headlessly. **The complete browser host does not have a faithful headless match harness in this repository.** The fixture's `DeterministicHost` supplies its own launch/possession logic, anchors controlled balls, resets boundary/stalled balls to a central taker, has stationary/non-saving keepers, and has no proper referee, offside adjudication, normal set pieces or half/full-time flow. `resolveBoundary` counts shot goal-line crossings without the complete live goal-height/keeper contest. Starting shape is asymmetric: home Invincibles 4-4-2 in settled attack, away Conte 3-4-3 defending. These constraints are part of every interpretation below.

Eight samples total **14,400 ticks / 240 seconds of module simulation**, not eight 90-minute games or eight six-minute DARTY matches. Same formation/attributes each time; seed variation is not broad tactical coverage.

| Seed | Passes attempted | Intended completions | Resolved completion %* | Logical controlled time % | Shots | 3-pass chains | Maximum completed chain | Strict stops |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 173 | 14 | 13 | 92.9 | 42.3 | 2 | 2 | 8 | 0 |
| 442 | 14 | 11 | 84.6 | 32.1 | 3 | 1 | 5 | 0 |
| 1967 | 14 | 11 | 84.6 | 32.1 | 3 | 1 | 5 | 0 |
| 2004 | 14 | 12 | 85.7 | 34.2 | 2 | 2 | 5 | 0 |
| 2014 | 13 | 10 | 83.3 | 40.6 | 2 | 1 | 5 | 0 |
| 2017 | 12 | 8 | 72.7 | 33.8 | 2 | 1 | 5 | 0 |
| 3434 | 16 | 14 | 93.3 | 36.6 | 3 | 2 | 9 | 0 |
| 7331 | 12 | 10 | 83.3 | 38.1 | 3 | 1 | 5 | 0 |

*Resolved denominator excludes passes still in flight. Aggregate: **109 attempted, 89 intended completions, 7 interceptions, 8 recoveries by another teammate, 5 unresolved**. Intended-completion / all attempts is **81.7%**; fixture resolved completion is **85.6%**. Do not interchange them. Fixture pattern labels overlap: 75 short-support, 36 recycle, 30 coordinated-run, 54 progressive, 42 progressive into a moving runner, 14 switch, 18 long. Those are not mutually exclusive physical-length bins. Zero newly-opened-run releases in these short samples is a follow-up question, not proof the feature never works.

The fixture reports **20 synthetic goals from 20 shots and 20 synthetic resets**. This illustrates why its goals/save rate are unusable as live football outcomes. It does not establish overpowered shooting or zero real keeper saves.

### Additional measurements, with definitions

Possession is logical owner time (including separated dribble leases); pass-in-flight/unowned time is reported separately. Home/away percentages below condition on owned time, **not standard broadcast possession**. A controlled 57/43 split can coexist with mostly unowned flight time.

Pass length bins use the release-to-intended-point SI distance: short <10m, medium 10–25m inclusive, long >25m. They are not the fixture's >20m loft threshold. Shape is sampled every 30 ticks across all phases of this probe, excluding GK: width=max lateral span; length=max longitudinal span; line proxy=mean distance of the four deepest outfielders from their own goal. For Conte this is a proxy, not a literal four-defender formation line. No phase-specific real-match conclusion follows from the average.

| Seed/team | Owned-time split % | Passes/completed | Length bins S/M/L | Mean width / length m | Back-four proxy / deepest m | Immediate return pairs / eligible pairs | ABAB / eligible triples |
|---|---:|---:|---|---|---|---|---|
| 173 home | 57.0 | 9/9 | 4/4/1 | 50.75 / 47.79 | 33.63 / 27.12 | 1/7 | 0/6 |
| 173 away | 43.0 | 5/4 | 0/5/0 | 53.11 / 37.59 | 27.70 / 25.09 | 0/3 | 0/1 |
| 442 home | 52.2 | 7/5 | 4/3/0 | 49.78 / 45.29 | 30.56 / 25.13 | 0/4 | 0/2 |
| 442 away | 47.8 | 7/6 | 0/6/1 | 54.98 / 41.93 | 30.52 / 26.58 | 0/4 | 0/1 |
| 1967 home | 52.2 | 7/5 | 4/3/0 | 49.78 / 45.29 | 30.56 / 25.13 | 0/4 | 0/2 |
| 1967 away | 47.8 | 7/6 | 0/6/1 | 54.98 / 41.93 | 30.52 / 26.58 | 0/4 | 0/1 |

An immediate return is consecutive A→B then B→A after A→B completes; ABAB requires a further B-directed release from A after the return completes. The final pass need not complete, so this is a release-chain frequency, not a completed-loop frequency. No possession turnover/other intervening pass may break the chain. The tiny denominator cannot close Joe's whole-match ping-pong concern.

| Seed | Unowned time % | Mean / max opposing outfielders within 5m | Mean moving toward ball within 10m |
|---|---:|---|---:|
| 173 | 57.7 | 0.40 / 1 | 0.52 |
| 442 | 67.9 | 0.29 / 2 | 0.52 |
| 1967 | 67.9 | 0.29 / 2 | 0.52 |

These proximity samples require a logical owner and occur every 0.5 simulated seconds. “Moving toward” requires speed >1m/s and velocity-direction cosine >0.7 toward the ball; it is a measurable chasing proxy, not the CPU's authored press role. There is **no measured swarm in these samples**. Loose-ball and restart swarms remain unmeasured.

Committed physical contacts: seed 173 produced **two away standing-tackle wins** (ticks 1237 and 1678); home produced none. Seeds 442 and 1967 produced **zero recorded tackle/slide/shoulder contacts** for either team. No slide or shoulder contact occurred in this batch. These are real adapter contact counts, not full-match tackle-attempt statistics or evidence that those unobserved actions are absent.

| Requested full-match measure | What U0 can honestly report |
|---|---|
| Possession / passes / length mix | Scoped proxy values above; flight-inclusive team possession and normal-match pass calibration unproven. |
| Shots / on target / goals / saves | Shot requests counted above. On-target, live goals and saves **not measured faithfully**; synthetic goals expressly excluded. |
| Tackles / shoulder contests | Movement contact type/outcome traces are retained per team in `cpu-probes.json`. These are contacts, not all tackle attempts, and have no complete foul adjudication. No faithful full-match tackle rate. |
| Fouls / cards / advantage | Not modelled by the probe; **N/M, not zero**. |
| Offsides | CPU mistiming policy exists; probe does not adjudicate full involvement. **N/M, not zero**. |
| Throw-ins / goal kicks / corners / free kicks / penalties | Replaced by synthetic resets in this host. **N/M, not zero**. |
| Line height / width / compactness | Probe proxies above; phase-tagged normal-match line/unit spacing is still required. |
| Chasing / ABA / ABAB | Definitions and counts above; small, partly asymmetric sample only. |

### Real-football sense checks

Use a distribution of complete matches and named drills, not quotas per possession. A six-minute game can compress football events differently from a 90-minute match: compare full-game counts and percentages separately from physical arrival pace and decision timing. Never multiply these 30-second samples into a real-match forecast.

Primary-source historical anchor: the Premier League's 2023/24 review reports **941 total passes/90, 82.87% pass accuracy, 27.60 shots/90 and 3.28 goals per match**. A deliberately broad initial review band is 700–1,100 combined passes, 70–90% completion, 18–35 combined shots and roughly 1–5 goals over a batch's typical match; individual exceptions are normal. These are **proposed diagnostic bands**, not universal bounds or requirements to inflate DARTY event counts. Its reported 49.96% shooting accuracy excludes blocks in the team table, so do not compare it directly with all-shot on-target percentage. [Premier League season analysis](https://www.premierleague.com/ar/news/4027257).

FIFA's 2022 mid-block analysis gives tournament compactness around **27.2m length × 40.1m width**; compare only out-of-possession mid-block samples with a compatible definition. Probe widths around 50–55m across mixed phases merit inspection, not an automatic failure against a mid-block average. FIFA defines defensive line height and team length as distinct measures; our four-deepest proxy is explicitly not its official metric. [FIFA mid-block analysis](https://www.fifatrainingcentre.com/en/fwc2022/technical-and-tactical-analysis/controlling-the-game-without-the-ball--the-mid-block-and-compactness.php), [FIFA metric definition](https://www.fifatrainingcentre.com/en/fwc2022/efi-metrics/efi-metric--defensive-line-height-and-team-length.php).

For remaining counters, start with **provisional review ranges**, not sourced league averages: possession often within 35–65% but allow tactical extremes; 6–14 combined shots on target, 3–10 saves, 20–45 tackle attempts, 12–30 fouls, 0–6 offsides, 6–14 corners, 20–50 throw-ins, 8–20 goal kicks; penalties usually absent or rare, direct free-kick shots much rarer than ordinary foul restarts. Log event definitions and validate a real reference dataset before making any a hard gate. Pass-length mix has no universal split: expect mostly short/medium passes plus real switches/long releases, dependent on tactics. Chasing has no useful universal per-match total; review one presser plus cover and rare overloads in context. An isolated A→B→A is football; repeated unpressured ABAB without progression is the concern.

Current S data supports passing continuity, progressive receptions and limited nearby chasing. It **cannot** validate scoring balance, referee quality, match completion, or real set-piece frequency.

### Performance evidence

Existing probe: mean tick **7.290ms**, p95 **16.927ms**, max **213.867ms**, over 14,400 samples. Its optional football-quality report passed all behavioural checks and failed `realtimeHeadroom` (p95 target ≤12ms); the ordinary test suite still passed because enforcement is opt-in. Measurements include test-host cloning/metrics and ran with other audit work active. They are not browser simulation-only timings, render FPS, or proof Joe's machine stutters. Isolate CPU/GC/render/report cost in normal browser play before optimising. Preserve this failed optional gate in the evidence rather than advertising a universally green result.

### Exact browser method for the missing complete-match evidence

U0 attempted a local `python3 -m http.server 4337 --bind 127.0.0.1`; sandbox returned `PermissionError: [Errno 1] Operation not permitted`. Installed Playwright was found at `/Applications/ChatGPT.app/Contents/Resources/cua_node/lib/node_modules/playwright`; launching the installed Chrome exited `SIGABRT`. No successful B proof, no escalation, installation, download or live-site substitution followed.

Run outside this restricted execution environment, using existing tools only:

1. Serve **this worktree** with `python3 -m http.server 4337 --bind 127.0.0.1`. Open `http://127.0.0.1:4337/quick-play/index.html?mode=spectator`. Use Invincibles vs Conte Chelsea, six-minute match, fixed weather/camera/difficulty, normal rendering. Follow the full five-stage setup. Keep autoplay enabled; use **no** `fast`, `selfTest`, `instantGoal` or `debugScene` flags and do not invoke `instantResult()`.
2. Fix the seed in both query and launch fragment together. On the loaded local match, run this DevTools snippet, changing 173 to 442/1967 for subsequent runs:

```js
const u = new URL(location.href);
const h = new URLSearchParams(u.hash.slice(1));
const raw = h.get('flMatch').replace(/-/g, '+').replace(/_/g, '/');
const bytes = Uint8Array.from(atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, '=')), c => c.charCodeAt(0));
const cfg = JSON.parse(new TextDecoder().decode(bytes));
cfg.simulationSeed = 173;
u.searchParams.set('simulationSeed', '173');
const encoded = new TextEncoder().encode(JSON.stringify(cfg));
h.set('flMatch', btoa(Array.from(encoded, b => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
u.hash = h.toString();
location.href = u.toString();
```

3. Immediately paste `tools/audit-browser-capture.js` into DevTools. It observes `FLMatch.getState/getReport`, deduplicates events by sequence before the host's 18,000-event cap can discard them, and samples positions/authority every 500ms. It calls no debug setup or gameplay action. Capture each run through `phase === 'ended'`; a timeout, strict stop or stall is a result to retain, not a reason to substitute an instant result. At completion, use `DartyAuditCapture.finish()` and save that returned JSON into local audit evidence. Repeat seed 173 once to expose host nondeterminism, and swap home/away formations for a second batch.
4. Derive passes/completions from team stats plus terminal pass events; physical pass length from `(intendedX-x)/(3176/105)` and `(intendedY-y)/(2142/68)`, where fields are finite. Use event sequence, terminal reception and possession turnover to classify ABA/ABAB; don't infer completion solely from intended target. Derive possession from `possessionTicks`, with an explicit separate in-flight convention. Count shots/onTarget/goals/saves/fouls/offsides/corners from report team stats and reconcile against events. Count each restart by unique restart event, not by sampled held frames; distinguish foul free kicks from corners/goal kicks and penalties. Distinguish tackle attempts, wins, body collisions and shoulder contacts.
5. Time-weight **live-play** position samples, exclude keepers/sent-off players, normalise metres and attacking direction; separate possession, transition, mid-block, high press and dead ball. With public state alone, phase classification and pressure role are partly inferred: label them, or add observational telemetry before treating them as authored labels. Count defenders within 5m and moving toward the ball within 10m using consecutive samples, excluding a zero/large time gap. A 500ms collector is a sampling method, not tick-exact replay.
6. Also run existing `tools/verify-darty-startup.mjs` (with `DARTY_BASE_URL=http://127.0.0.1:4337` and the existing `PLAYWRIGHT_MODULE`) for startup/recovery separately. `verify-darty-browser.mjs` tests a synthetic pop presentation and is **not** ordinary-match proof. For performance, run a second ordinary match with DevTools closed/capture off; record browser Performance and exported render telemetry in a separate measured pass because capture itself adds overhead.

Equal V2 seeds currently do **not** promise equal complete-host results: host randomness and real timers remain. Record seed, exact source hashes, browser, hardware, roster/tactics and flags on every run. M1 below closes this measurement boundary before seeded full-match comparisons become an acceptance gate.

## 4. Biggest gaps, ranked for Joe's experience

This is an impact-ranked code/evidence assessment, not eight newly reproduced playtest complaints. Keeper strength, defensive return passes, weak shooting and slides are Joe's recorded concerns; October changes address them but do not establish fresh feel acceptance.

1. **Football changes path during the same match.** Skills/slides/keeper possession switch outfield authority; dismissals can exclude V2 indefinitely. It undermines predictable movement, tackles and CPU behaviour exactly when an exciting incident happens. C: V2 gate + `update` branch evidence.
2. **No single CPU football policy produces the whole attack.** Generic pass/shot/carry branches, incomplete live crossing/cutback/aerial repertoire, per-tick carrier choice and narrow possession memory can still look unlike a team constructing chances. Existing commitments and October loop fix must be retained. C/U/S; current short probes do not reproduce dominant ping-pong.
3. **Contact does not have one football/referee outcome.** V2 contests, host slide/poke, shirt pulls and dives do not share one foul/evidence/advantage path. A hard winning hit may present cleanly without supplying corresponding law evidence. C; advantage missing; human/CPU parity incomplete.
4. **Action availability depends on the device and opaque context.** Keyboard lacks major actions; pad family mapping exists but all physical pads are unverified here. Open-play chip and general manual keeper dive are absent. C/US; old controls documentation conflicts.
5. **Shooting and saving lack a complete live calibration.** October shot variety and reduced keeper reach are real code, but keeper saves still combine contact envelopes, random odds and repositioning. No normal-play shot/keeper matrix demonstrates their balance. C/U, JH request; no B/J acceptance.
6. **Receiving/ball pace and team support need joint calibration.** Good isolated MR/dribbling systems do not guarantee readable arrivals, playable first touches or short/wide/deep support under pressure across host transitions. CPU and human launch profiles differ. C/U/S; preserve accepted normal-X/turn/touch bounds.
7. **Complete-match laws and personnel are incomplete.** Advantage missing, substitution identity/limits incomplete, red-card continuation contradicts V2 authority, restart/penalty/keeper-input fairness and rare-law coverage need drills through full time. C/U/US; no complete S/B match.
8. **Evidence and frame budget cannot yet certify the experience.** No faithful full-host Node harness, no U0 browser run/pad proof, dispersed tuning, stochastic host and an optional probe performance gate failure. This prevents trustworthy before/after decisions and can conceal regressions. Performance impact on Joe is unproven.

## 5. Milestones — small reviewable builds

Every milestone has an exact source revision/manifest, change log quoting Joe/Josh where relevant, fixed-seed before/after evidence at its actual proof level, named drills, and a normal six-minute playtest with timed written feedback. Use one feel variable per candidate; diagnostic/refactor candidates must preserve tick digests within their declared authority. Joe/Josh decide acceptance; Claude directs sequencing. None of these are authorised implementation or release by U0.

### M1 — Make one match observable and tuning reviewable

- **Scope:** extend the existing adapter replay/export harness rather than replace it; phase/authority ledger and event definitions for every requested stat. Reproduce the skill/slide/keeper/red-card gate cases. Introduce one tuning entry point by moving values unchanged, in small groups, with units and owners; preserve old APIs/models. Make host randomness/clock injectable for test use and isolate presentation randomness before calling full-host matches deterministic. Diagnose the stale free-kick source assertion with an executed launch fixture.
- **Files:** `tools/audit-*`, relevant tests; future tuning module; H `liveV2CanAdvance/ObserveBoundary/update`, adapter export/restore, Clock/Control, full-state replay. Do not start by splitting all 8,510 host lines.
- **Acceptance:** existing seeds 173/442/1967/2004/2014/2017/3434/7331 repeat byte-for-byte at the adapter level; refactor moves no values. Add an equal-seed full-host test only once clocks/RNG are controlled; otherwise label it nondeterministic and retain reports. Complete normal browser CPU-v-CPU matches with all requested counters or explicit missing fields, plus “Skill→Tackle→Keeper→Restart” and “Ten Men to Full Time” drills; identify every unexpected authority transition. No lost pop/score/restart events.
- **Joe tries:** one unchanged-feel six-minute baseline, writing minute/action/expected/actual and one thing worth keeping. Risk: test-host shortcuts becoming gameplay, over-instrumentation affecting frame time, a tuning migration accidentally changing units. Stop those at exact state/launch comparisons.

### M2 — Team shape, support angles and coordinated press

- **Scope:** ball-relative short/wide/deep support assignments, maintain back-line/midfield distances and rest defence; one primary presser plus cover; bad touch, back pass, touchline and receiver-facing triggers with explicit recovery. Keep historic team identities and run commitments. Correct sent-off roster composition without discarding the existing reduced-player formation model.
- **Files:** Formation `resolve`, CPU `targetForRun/selectNewRuns/buildDefensiveIntents`, adapter `targetMaps/movementCommands`, H roster/phase bridge.
- **Acceptance:** same-seed before/after position/phase statistics; valid player counts, bounded width/line height and no NaNs. “Build Out 6v4”, “Wide Trap”, “Lose It and Recover”, “Ten Men Hold Shape”. Over ten representative possessions, a carrier normally has non-collinear short/wide/deep possibilities when geometry allows; unselected players hold/rest-shift rather than chase. Review mid-block metrics around the reference shape with team-specific tolerances. Presser/cover caps are role-based, allowing deliberate emergency overloads. No pace/stamina retuning.
- **Joe tries:** switch between carrier and off-ball teammate; build from the back, lose the ball, inspect passing options. Ask him to mark moments when everyone stands still or crowds him. Risks: rigid formation magnets, offside-safe runs becoming sterile, pressing too passive. Replay the same turnover clips before/after.

### M3 — Passing, receiving, ball feel and CPU choice rhythm

- **Scope:** compare progression, lane safety, receiver facing/readiness and carrying in one decision policy; stable cadence/reaction and carrier commit windows with explicit abort reasons. Keep run/defensive commitments already implemented. Extend memory to last two passers and stagnation urgency without banning useful one-twos. Route CPU through the same launch/receive contracts as the human. Add authored cross/cutback services and supporting box runs as a separately reviewed candidate within this milestone. Centralise charge/arrival/skid/roll knobs while freezing accepted normal-X/ground-Triangle until Joe explicitly wants a change.
- **Files:** CPU `carrierIntent/shortSupportOptions` and circulation memory; adapter pass-race/commitments; H `doPassForHuman/doThroughPassFor/doLobPassFor/liveV2ApplyIntelligence`; Ball/First Touch/Dribbling.
- **Acceptance:** fixed-seed short/medium/long releases, actual arrivals/completions/interceptions, carrier static share, ABA/ABAB with denominators and forward progress. “10m Give and Go”, “25m Switch Under Press”, “Receive on the Half Turn”, “Wing Cross and Cutback”. Passes reach a physically contestable point with controlled tap/hold separation; no receiver teleport/ball steering or free ownership. Repeated unpressured ABAB cannot dominate; useful pressured returns remain. CPU makes visible carries, switches and crosses rather than satisfying quotas. Diagnostic ranges guide review, not forced outcomes.
- **Joe tries:** tap/half/full passes, turn a receiver under press, make a one-two, play wide then cross/cut back. Write whether the ball is too fast, too slippery, too slow or hard to collect, and which input he used. Risks: homogenising team styles, erasing accepted calibration, pass-safety filters eliminating ambition; compare human and CPU physical arrivals, not just completion percentages.

### M4 — Finishing and physical goalkeeper outcomes

- **Scope:** complete normal/placed/low-driven/power/chip action vocabulary; keep October improvements. Shared physical save contact, bounded set/reaction/dive travel, catch/parry/rebound and ground-level gather; verify 1v1 and distribution handoff. Keep the requested penalty five-choice/400ms interaction while removing unexplained trajectory advantage. This milestone uses separate shot-only, keeper-contact and balance candidates.
- **Files:** H shooting/keeper functions and penalty decision; Ball/Aerial/First Touch bridge; tuning; executed keeper fixtures and live drills.
- **Acceptance:** fixed-seed shot requests and actual trajectories separately from keeper outcomes. “Ten Edge-of-Box Shots”, “Low Roller”, “Corner Finish”, “Breakaway”, “Rebound Finish”, “Keeper Roll and Long Release”. Matrix: normal/placed/driven/power/chip × centre/low/high corner × close/edge/range; extend with volley/header. Record on-target, contact, catch/parry, goals, rebound and animation reach. No save without reachable contact, no double reroll, no fast shot treated as slow gather, no keeper teleport. Agree target save distributions before tuning; a roughly two-thirds-save starting hypothesis from Claude is a calibration hypothesis, not a measured DARTY requirement.
- **Joe tries:** the same ten shots and two breakaways each candidate; describe whether a miss was his input, an understandable save or an impossible intervention. Risks: shots becoming automatic goals, rebound chaos, changes to several balance systems at once. Keep power, reach and reaction revisions independently reviewable.

### M5 — Skills, tackles, shirt pulls, dives and referee fairness

- **Scope:** shared action→contact→outcome→recovery→referee evidence for human/CPU; preserve Q/RS skill and dive performances, but remove accidental global authority changes. Port V2 contests into factual contact evidence; explicit clean/late/reckless/from-behind/ball-first decisions, advantage/recall/deferred card, shirt pulls, simulation and contextual CPU choices. Preserve toy pop qualification as a separate consumer of committed winning contact.
- **Files:** Movement action/contact telemetry, CPU action choices, H skill/slide/poke/shoulder/shirt/dive/referee paths, adapter protected handoffs, DARTY tracker tests (without changing its approved parameters).
- **Acceptance:** fixed-seed matched human/CPU action scenarios produce the same physical/law outcomes; “Win Ball Cleanly”, “Late Slide”, “Shoulder Alongside”, “Three Pulls”, “No-Contact Dive”, “Contact Then Dive”, “Play Advantage Then Recall”. Test box/outside-box, second yellow, goalkeeper contact and denied chance. A clean challenge remains playable; a miss has visible recovery; law evidence survives presentation. Run real soft/lost/duplicate/hard-contact pop checks; only a committed qualifying hard win pops once. Full match continues through dismissal in declared authority.
- **Joe tries:** defend a live dribbler, bait/miss a slide, pull a shirt and perform his dives. Write whether calls and recovery made sense and whether the pop still felt like DARTY. Risks: turning intentional comic dives into a realism rewrite, contact animation affecting outcomes, excessive stoppages. Retain Joe's requested performances; change adjudication only as an explicit candidate.

### M6 — Restarts, offside, substitutions and a complete match

- **Scope:** ordinary-game throw-in/goal kick/corner/free kick/penalty/kickoff through the same contracts as suite practice; preserve set-piece vocabulary and camera/foot design. Correct offside snapshot/involvement without moving a runner to manufacture an offence. Repair substitution identity, records, eligibility/limits and away CPU use; half/full-time after all incident types. Define and verify the change-of-ends coordinate/control transform. Add deliberate-backpass/double-touch/retake handling only against a written chosen ruleset, keeping comic presentation. Extra time/shootouts and injuries remain separately scoped competition features.
- **Files:** H restart/offside/run-up/substitution/period functions, Clock/Control, restart/coordinate/suite modules, Quick Play payload roster data.
- **Acceptance:** fixed-seed **complete** browser/harness matches with reconciled goals, cards, offside and set-piece counts, no instant-result substitution. “Touchline Escape”, “Corner to Counter”, “Offside Then Free Kick”, “Penalty at 45”, “Goal at 90”, “Substitute Booked Striker”, “Ten Men to Full Time”. Each ball leaves/enters play once; no duplicate restart or stuck camera; legal keeper release and intended pass variants; second-yellow and substitution preserve distinct player stats/IDs. Full time must settle, not hang on a presentation timer.
- **Joe tries:** one half, substitute a tired player, take each restart, finish the game; write the first moment it stops behaving like a match. Risks: event counters counting held frames as multiple restarts, breaking protected camera/aim grammar, scope growing into Career/Online. Keep those modes outside this upgrade lane.

### M7 — Every action reachable and explainable on keyboard and all three pads

- **Scope:** logical action map, keyboard equivalents for the missing actions, controller-family positional labels, input preview/test screen showing raw axes/buttons and resolved contextual action. Deadzone/reconnect/charge/cancel/menu ownership and optional remapping. Add missing input routes only after action outcomes are stable; preserve the requested pad combinations.
- **Files:** H input handlers/polling and gesture recognisers, `controller-ui.js`, Quick Play controls, a small input-test UI, regression fixtures.
- **Acceptance:** fixed-seed action script equivalence across device packets, then **physical** keyboard, DualSense, Xbox and Switch Pro in Joe's browser. “Input Card: Every Row”, “Fake Shot Without Pass”, “Six Stepovers and Exit”, “R3 Flick / D-pad Dive”, “Keeper Release”, “Reconnect While Holding Sprint”, “Penalty Keeper Four Corners”. Record mapped/reachable/executed result for every matrix row and screenshots of prompts. Distinguish USB and Bluetooth, supported and unsupported raw mappings. No stale held action, duplicate menu activation, accidental switch after a modifier or false dive. Headless packets alone cannot close this milestone.
- **Joe tries:** complete the action card on his available pad, including a full restart and penalty-keeper sequence; type unclear prompt/failed button combinations. Risks: labelling Switch by Xbox letters, gesture conflict and timing inaccessible to keyboard. Keep human-readable help synchronized with the actual action map.

### M8 — CPU tendencies and match-state choices

- **Scope:** a few explicit per-player tendencies (safe/progressive passer, dribbler, shot inclination, tackle aggression) combined with team tactics, fatigue and score/time. No physical cheat bonuses. Ensure CPU can use the intended football/skill/restart repertoire through the shared pipeline; deliberate rarity is different from unreachable code.
- **Files:** CPU normalized attributes/policy, Formation overlays, roster tendency data, tuning; H bridge only where necessary.
- **Acceptance:** same seeds/tactics/ratings with one tendency changed show a reproducible **choice** difference, not changed running/shot/save physics. “Safe Passer vs Dribbler”, “Chase a Goal”, “Protect a Lead”, “Aggressive but Booked”. Track pass/shoot/carry/skill/press choices and successful executions by role, plus abort reasons. Avoid forcing every player to perform every skill each match.
- **Joe tries:** identify which player dribbles, which looks for the pass and whether a trailing team takes sensible risks; written feedback must name examples rather than infer personality from labels. Risks: caricatures, deterministic routines, difficulty overpowering physical fairness. Preserve team identities and compare on identical geometry.

### M9 — Match pacing, performance and release candidate

- **Scope:** profile Joe's real browser/device during ordinary play; separate CPU, physics, render, telemetry, replay and GC. Spread decision work, cap catch-up/substeps, reduce allocation/report overhead where measured; preserve render/model content and approved camera/celebration/dive timing. Verify audio unlock and event hooks. Commentary remains a **separate** Joe-authored task; do not bundle new lines/voice into a performance build.
- **Files:** H `loop`, renderer/report/replay/audio paths; CPU cadence and adapter allocations only where profiles justify; existing verification tools and release evidence notes.
- **Acceptance:** equal-seed non-feel refactors preserve defined tick/event digests; complete multi-seed matches and the named drills pass with all device records. Target 60Hz on agreed hardware, initially p95 total frame ≤20ms and no repeated >80ms stalls; measure uninstrumented normal play plus a profiled pass and document hardware. Isolated simulation should leave render headroom (the existing ≤12ms probe threshold is a separate diagnostic). Twenty-minute soak including pause/replay/restarts/pop/reset/reconnect; no increasing resource/heap trend or authority errors. Joe/Josh accept normal match pacing. No release based solely on unit totals.
- **Joe tries:** a full match plus rematch on his actual setup, reporting stutters, interruptions, audio and whether he wants to play again. Risks: optimising a synthetic workload, hiding stalls by slowing simulation, or sacrificing the approved animations/models. Joshua decides whether and when this reviewed candidate reaches `main`.

## 6. Keep untouched and release ownership

- **DARTY identity and current ONE-hit pop:** hard winning standing-tackle/slide/shoulder contact, thresholds 4.6/5.1/4.9m/s, episode/dedup protection, one detached part per victim, cartoon head/leg flight, pause/landing/reset and presentation-only consequences. Preserve current fall/pop links; do not “realism” them away or restore the old two-hit description.
- **Keep the models and redundant assets/modules/history.** No mass asset replacement, cleanup, deletion, renderer rewrite or removal of provenance just because the audit finds overlap. Joe's familiar look stays.
- **Preserve approved/requested improvements:** reduced impossible keeper reach, October CPU recovery slide and varied/assertive shooting, Switch positional fallback, the unpressured defender return-pass fix with its pressured escape. They need broader acceptance evidence, not automatic rollback.
- **Preserve documented human acceptance:** Josh's running/turning verdict and Candidate 5 normal-X, ground-Triangle and directional-touch bounds. Do not reintroduce a scripted receiver, ball steering, hidden pace boost or truck turning. Changes to those feel parameters need explicit named feedback.
- **Preserve requested controls/presentation:** L1+Triangle over the top, R1+Square low service, L1+R1+Square driven service, L1+Square ordinary lob/manual-switch semantics; Q/RS skill grammar, current R3 flick and D-pad dive, distinct dive performances, Josh's three-technique free kicks and foot mirroring, penalty post-contact choice window, replay skip/restore, existing celebrations/confrontations. Requested/implemented does not mean Joe approved every timing or outcome; the log must keep that distinction.
- **Joe writes commentary.** No invented sample lines, audio production, voice or template system in this audit. Event consumers/subtitles/cooldowns and empty line slots can be scoped in the separately requested commentary task later.
- **Retain Career/creation/save boundaries.** Career is still statistical, not the playable V2 match; don't advertise a new connection. Do not open Online/2P/co-op or change saves as a side effect of this football upgrade.

The repository README states GitHub Pages serves the repository root from **`main`** at `https://joshtoucanlearn.github.io/darty/darty.html`. A local worktree edit is not a live update. This audit did not query deployment state or verify hosted bytes. Releases are **Joshua's call**: review an exact candidate revision, Joe/Josh feedback, changed-file manifest, passing checks and remaining limitations first. Only a separately authorised release process may put reviewed changes on `main` and verify Pages/cache assets. **Never push from this task.**
