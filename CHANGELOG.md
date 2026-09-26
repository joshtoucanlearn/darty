# Football Legacy — Changelog

## DARTY local follow-up — 27 September 2026 (not published)

- Detached parts now use a frozen copy of the contact pose, so walking and head animations cannot pull or rotate them after the pop. The original rig is hidden until a new match restores it.
- Pause freezes the flight and sparkle age. Landed parts stay still; resetting a match clears the effect, restores visibility and releases temporary sparkle/socket resources.
- Added contact-to-host tests using real Movement V2 tackle and shoulder telemetry, covering soft contacts, duplicate episodes, the second-hit pop and invalid participants. Focused tracker, movement and launch checks pass (56 checks).
- Verified head and leg flight, frozen child poses, pause, landing and reset in an instrumented browser presentation fixture. This fixture checks rendering, not the occurrence of two hard contacts during ordinary play. Joe's own playtest remains outstanding.

## DARTY local prototype — 22 September 2026 (not published)

- Added Joe's separate DARTY entry page and match overlay to this isolated clone of the August 14 browser build; no FLAME/Godot or public-site files were changed.
- A per-player toy-impact tracker consumes only successfully committed FL V2 standing-tackle/shoulder-contact telemetry. A new presentation-only approach-speed measurement uses each footballer's actual travel toward the opponent during the contact tick, without changing the existing contest score; two distinct hard wins against the same victim (at least 4.6 m/s tackle or 4.9 m/s shoulder approach, separated by at least 18 committed ticks) trigger one head/leg pop. A collision's duplicate command ID, soft hit, lost challenge or repeated contact window cannot count twice.
- A copy of the rendered head or leg detaches, arcs with a yellow/orange sparkle burst and lands on the pitch without blood or gore. Match logic and player-control ownership remain unchanged. A new match resets the count and restores the mesh.
- Added focused tracker tests and a clearly synthetic `FLMatch.debugDartyVisual()` presentation fixture for local visual review. Thresholds and the overall feel await Joe's playtest.

Last reviewed: 14 August 2026 — Build 174 Candidate 5 passing, locomotion and directional-touch release

This file records the two source lines and the combined build produced from them:

- **Combined integration build v0.31.0** — the complete v0.30.1 career/data build plus Josh's complete v0.96 match branch, with the overlapping Quick Play page merged rather than replaced.
- **Career and data build v0.30.1** — the current Player Career/original-names copy with the Create-a-Club career fixes below.
- **Match Engine v0.96** — Josh's GitHub pull request #1, included unchanged except for the intentional Quick Play integration described below.

## Build 174 Candidate 5 — accepted passing, locomotion and directional-touch baseline

- Freezes the human-accepted normal-X ground pass and ordinary ground-Triangle profiles after iterative live playtests: shorter tap access, faster charge response, stronger opening impulse, progressive grass drag and materially larger power-dependent end roll.
- Restores direct, agility-rated 45, 90 and 180 degree turning without velocity snaps, hidden terminal-speed bonuses or the rejected truck-turn philosophy.
- Splits sprint-forward L1/LB + right-stick touches across the full 150-degree forward sector into light, strong and physical double-flick tiers while preserving the accepted jogging and off-angle touch behaviour.
- Gives every sprint-forward tier an opt-in Magnus-Reynolds progressive turf curve. The light tier extends slightly; strong and double preserve their accepted physical gaps; all settle naturally before the emergency containment distance instead of stopping dead while still moving quickly.
- Preserves physical interception, First Touch ownership, independent receiver reading, player-authored direction and the separate FL V1.5 forensic archive. Nothing scripts the lost Golden Sequence.
- Uses the cache-only `candidate=5` marker and `174-fl-v2-final-candidate-5` module token.

## Build 174 Candidate 4 — V2-only playable-authority cutover

- Makes FL V2 the fixed and sole playable match authority. Quick Play no longer offers a previous-build selector, default or fallback.
- Keeps Single Player, all-CPU CPU vs CPU and Set-Piece Suite as the released playable modes.
- Makes Local 2P, same-team Home Co-op and Online Versus visibly unavailable until each has complete V2 authority. They cannot launch a previous engine or silently reroute to another mode.
- Requires exact agreement between the supported workflow, V2 query, V2 payload, ownership data and deterministic seed. Raw, direct, stale, malformed, contradictory, online, shadow-only and unsupported launch routes fail closed before simulation.
- Retains same-tick transaction rollback followed by the strict V2 diagnostic stop. No previous-engine tick executes as a recovery path.
- Uses the cache-only `candidate=4` marker and `174-fl-v2-final-candidate-4` module token. These markers isolate bytes without changing authority or deterministic seed.
- Preserves Build 173-named hashes, adapters, fixtures and tests only where they provide non-playable provenance, host compatibility, diagnostics or regression coverage. Stale shadow/opt-in module headers are superseded by the V2-only authority contract.
- Leaves Career Mode, Create-a-Club, Player Career and creation/data workflows intact; any handoff into a match must satisfy the V2-only contract.
- Leaves the separate FL V1.5 forensic archive untouched. It is not bundled as a fallback.
- Defines the binding release boundary in `research/overhaul/fl-v2-only-playable-authority-2026-08-13.md` and the machine-readable scope in `research/overhaul/protected-workflows.json`.

## Build 174 Candidates 2-3 — superseded migration history

The bullets in this section record the earlier opt-in release state. Their Build 173-default, engine-selector and unsupported-mode fallback rules are historical and do not apply to Candidate 4.

- Candidate 2 was published through pull requests #10 and #11. Candidate 3 was the following local closure batch.
- Candidate 3 preserved player-authored normal-pass and ground-through channels while solving the Ball V2 rendezvous, added reaction-rated genuine recontrol attempts after loose aerial cushions, closed keeper/shot and directional-knock-on double resolution, bound explicit aerial finishes to one cross flight, repaired free-kick staging and ground-pass input, graded slide cards from challenge physics, and held repeated rejected CPU pass decisions for six committed ticks.
- Candidate 3 used a cache-only `candidate=3` match marker and `174-fl-v2-final-candidate-3` V2 module token. Those markers did not alter authority or deterministic seed.
- At that migration stage, unsupported Co-op, same-team Co-op and Online selections launched a clean Build 173 engine envelope. Candidate 4 removes that playable path entirely.

- Adds **FL V2 · Strict Offline Playtest** to the existing Quick Play setup while retaining **Build 173 · Stable** as the deliberate pre-match default.
- Limits FL V2 to explicit offline **Single Player**, all-CPU **CPU vs CPU**, and **Set-Piece Suite** selections. Local 2P, same-team co-op and Online remain on Build 173; all career/creation workflows remain intact.
- Promotes deterministic Ball, Movement, CPU, Formation, First Touch and Aerial systems for Single Player and all-CPU CPU vs CPU. If candidate preparation or commit fails, the tick rolls back and the V2 match freezes behind the diagnostic screen; it never switches back to Build 173.
- Promotes the reviewed Match Clock, Restart, Set-Piece and coordinate systems for the Set-Piece Suite while preserving the normal Quick Play entry flow.
- Replaces silent mid-match fallback with strict playtest enforcement: any FL V2 authority fault rolls back the candidate tick, freezes the match, and presents export/restart/exit actions without executing a Build 173 gameplay tick.
- Adds Ancelotti's representative 2013/14 Real Madrid BBC squad, preferred 4-3-3 selection and team-behaviour overlay alongside the existing Invincibles and Conte Chelsea historic teams. Ratings are Football Legacy playtest values, not official EA ratings.
- Applies the three latest playtest-log batches: directional and charged pass/through-ball/throw-in control, rebuilt lob and low-cross delivery, receiver self-contact protection, first-touch acceleration, rating-scaled carrier movement, faster shielding, improved collision ownership and more assertive goalkeeper loose-ball/release behaviour.
- Adds targeted carrier-relative attacking-support and rest-defence corrections for the Invincibles and Conte Chelsea while preserving each historic tactical identity; Arsenal's full-match support/pressing shape remains open for visual calibration. CPU free kicks use the calibrated lob trajectory and CPU vs CPU now runs the live V2 authority rather than silently falling back to Build 173.
- Re-anchors goal, shot and foul replays to the actual incident, adds the owned three-view set-piece replay package, and keeps CPU restart cameras on the live match angle while preserving human and goalkeeper-controlled penalty views.
- Improves controller disconnect/reconnect handling, prevents held/stale D-pad input after reconnection, isolates text-entry fields from gameplay input, and makes Quick Play launch single-flight with immediate loading feedback.
- Adds charged, rotating throw-in aim with supporting runs; low crosses on R1 + Square; nearest-ball L1 switching; revised goalkeeper possession spacing; and the high-contrast Total 90-inspired match ball treatment.
- Hardens controller reconnect state and prevents false Firefox D-pad input after device reuse. USB-C remains the verified DualSense playtest route; Bluetooth can still enumerate without supplying gameplay input on some Mac/browser combinations and is not claimed fixed.
- Removes the temporary deferred normal-match free-kick replay queue. Goal, immediate dead-ball and per-attempt practice replays remain.
- Adds the whistle, assistant-referee flag and exact-once free-kick handoff presentation for offside, plus the requested human/CPU restart-camera ownership policy.
- Gives free kicks a slower preferred-foot and technique-sensitive 3.5–4.3 metre approach, and moves the set-piece camera farther behind the player while keeping the ball, full taker, wall and goal framed together.
- Adds one consistent directional service vocabulary to free kicks, corners and goal kicks: Square for normal loft and bend, R1 + Square for a lower/faster service, and L1 + R1 + Square for a driven flatter ball. The left stick at release supplies the line and spin bias; direct free-kick Circle shots remain separate.
- Preserves Build 172's Online signalling, lobby, controller and quality/recovery protocols; FL V2 cannot arm in Online.
- At that superseded migration stage, Build 173 was the deliberate default and Candidate 3 had not been published. Candidate 4 replaces that state with the V2-only authority contract above.

## Mandatory GitHub setup for Connor's AI agent

Before any future GitHub publication, Connor's AI agent **must** verify that the official GitHub CLI is installed and authenticated:

1. Run `gh --version` and `gh auth status` before creating commits or promising a push.
2. If `gh` is missing on macOS, install the official CLI with `brew install gh`.
3. Authenticate the intended owner account with `gh auth login --hostname github.com --git-protocol https --web`, then rerun `gh auth status` and verify the `footballlegacy` organisation is accessible.
4. Use the repository's normal branch, commit, push and draft-pull-request workflow. Do not silently replace it with manual website uploads or claim publication succeeded before the remote branch and pull request have been verified.

This is a mandatory workstation prerequisite for Connor's AI agent, not an optional recommendation. It was added after build 166 was locally complete but the first publication attempt found that `gh` was absent.

## Build 173 — receiver, penalty and free-kick gameplay baseline

- Preserves the running and locomotion base that Josh accepted as feeling “amazing”. Ultimate receives no pace, acceleration, recovery, shot, save or other physical outcome advantage in this pass.
- Allows L1/LB nearest-player switching and directional RS switching while a targeted pass, through ball, lob or cross is travelling. The chosen footballer replaces the initially predicted receiver without steering or rebuilding the ball trajectory. General defensive and loose-ball switching remains manual.
- Removes the directional-knock-on chase burst. The touch still pushes the ball into space, but the footballer continues under the common pace, acceleration, sprint and stamina model.
- Rebuilds penalties around a readable staged run-up and a goalkeeper decision opened only after contact. For 400 ms the defending goalkeeper may stay central or choose top left, top right, bottom left or bottom right; the human goalkeeper uses RS and a CPU goalkeeper obeys the same five-choice timing boundary.
- Rebuilds direct free kicks around Josh's three-technique system, rather than attributing it to FIFA 20: Circle is the controlled dipping strike, L1 + Circle the driven strike and R1 + Circle the pronounced curve strike. The historical inspiration is recorded more cautiously as a retro camera-aim/opposite-stick-spin grammar because the exact FIFA edition remains open.
- Removes the visible target. RS pans the set-piece camera and therefore positions the hidden aim plane before the kick is locked; pressing Circle locks that camera angle, power and technique; LS then supplies side-spin plus top/back-spin on that fixed plane.
- Gives each free-kick technique a distinct run-up, contact and follow-through. The default dip uses a regular controlled approach and strikes below centre with laces-to-inside-instep. R1 uses either an open-hip inside-instep wrap or, when the selected curve opposes the approach/aim angle, a closed-hip instep cut across the ball.
- L1 retains one large, forceful driven base action. With no curve it contacts centrally with the laces and follows straight through the locked aim plane. An inward curl strikes through the ball's outside section and keeps that straight-through body action on a slightly wider off-centre line; an outward curl uses inside-section laces/instep contact and takes the finish across the selected curve side. Driven curve remains intentionally much smaller and less consistent at high power than the R1 curve route.
- Calibrates direct scoring attempts for roughly **18–28 metres**. Default dip and R1 curve use approximately **two to three power bars**; L1 driven may reach full power but receives deliberately wider error rather than a guaranteed perfect result. The defending wall is literal shoulder-to-shoulder footballer geometry with protective poses.
- Free-kick limb geometry is now preferred-foot-relative. The kicking leg, plant leg, hip, shoulders, feet and lateral follow-through values mirror for a left-foot taker rather than replaying a right-foot pose. The historic Quick Play roster now supplies its existing left/right-foot distinction to the match footballers.
- The contact design is grounded in the football distinction between wrapping the inside foot around the ball for sidespin and striking more centrally with the instep for speed. These are design references, not a claim of copying one FIFA edition exactly: [FIFA Training Centre](https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/set-play-routines/direct-free-kicks-overcoming-long-distances.php), [biomechanical review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3786235/), [2024 instep-direction study](https://commons.nmu.edu/isbs/vol42/iss1/120/).
- Rebuilds the replay director without interrupting live play. Goals now use a touchline operator, ball-flight view, behind-goal operator at true net contact and scorer track; fouls/cards, incident chains, dives, saves to corners and misses use longer event-specific pacing with near-real-speed context and a deliberately slowed decisive contact or ball beat. Every route remains skippable with Cross/A or Space and restores the correct live restart state.
- Adds several owned slow-motion free-kick views at different angles and speeds. They play immediately if the ball is already out, or queue until the next natural stoppage if play remains live. The stoppage's own replay has priority, then the queued free-kick sequence; any post-card confrontation precedes both. Replay completion or skipping restores the held restart's timer, signal, camera cut, wall and player timing exactly.
- Keeps the high free-kick replay frequency explicitly temporary for this Build 173 playtest/version; it is present to expose the new replay routes for judgment, not to set the eventual broadcast frequency.
- Makes successful contested fake shots, stepovers, roulettes and flick-ups eligible as the opening context of the next natural goal/foul/save/miss replay. A skill never triggers an instant mid-play cutaway.
- Replaces the fixed opening with a shuffled six-beat walkout plan on every match load. Tunnel perspective, lineup view, featured home/away star, moving footballer, goalkeeper or referee crew, shot style and pitchside-operator choice vary; the previous plan is retained locally so the next load cannot immediately repeat it. Existing hops, bounces and loosen-up actions are re-seeded as part of the new plan.
- Moves the North London Highbury-style streetscape behind the true rear faces of all four stands, removing the cream facade blocks that were visibly intersecting the upper seats in Josh's screenshot. Seating, continuous urban backdrop, roof structure and the actual pitch floodlights remain intact.
- Extends telemetry and the autonomous gate to expose the selected free-kick approach, contact point, follow-through and spin response, penalty decision timing, receiver overrides, knock-on speed preservation, replay slow-motion/viewport routes and walkout anti-repeat plans.
- Verification passes **191/191** in-browser engine checks with no JavaScript console errors. Fresh focused regressions pass the Online connection gate, controller **13/13**, lobby **85/85**, quality/recovery **23/23**, original-name **5/5**, Player Career links **2/2**, Player Career **9/9** and Create-a-Club **1/1** gates.
- The expanded current browser gate passes **192/192** in normal Single Player, Local 2P with Controller 1 Home versus Controller 2 Away, and Home same-team co-op with both controllers on Home and Away left to the CPU. This new result is appended rather than replacing the historical 191/191 gate above.
- The current unchanged Create-a-Club form test passes, while its playable-save test reaches the fixed 120-second limit before assertions because the older `createStartYear(..., 2026)` path is still simulating 138 seasons from 1888 and has no cancellation hook. Build 173 touches none of the Create-a-Club, career-mode or test files; this pre-existing slow-gate limitation is recorded alongside the earlier successful 1/1 result rather than erasing it or misreporting the timed-out rerun as a pass.
- One resource-path 404 for the local Three.js file remains non-blocking because the existing CDN fallback loads. The four existing exhaustive career-world missing-fixture recovery failures remain outside this match-engine change.
- Build 173 was published as the offline gameplay baseline. Replay and walkout retained the requested baseline implementation, while human visual acceptance remained open. Every CPU, positional-contract, defending, goalkeeper, stadium, FLARE, career and later ball-physics workflow already recorded below remains in the request log.

## Build 172 — Online quality and recovery freeze

- Josh and Theo completed a full hosted two-machine Online match. The authoritative Home match, Away Controller 2 input and live picture were playable and broadly smooth enough for Josh to close the exploratory playtest stage. This is the first completed real remote-match evidence for the Online prototype.
- The same session exposed one bounded controller defect: D-pad Down did not produce a dive for Away. The comparison log `FL-MSN757H7` records two local D-pad Down inputs followed by two dive events, isolating the failure to the browser/network controller boundary rather than the dive outcome system.
- Firefox raw DualSense packets are now normalised on the sending machine before transmission. The raw Square/Cross layout becomes the standard logical layout and Firefox's hat-axis D-pad Down becomes standard button 13. Xbox One and already-standard browser mappings remain unchanged. D-pad Down is still dive; R3 is still flick-up.
- Raises host capture from 45 to 60 fps and adds four bounded WebRTC profiles: 60 fps / 5 Mbps, 50 fps / 3.5 Mbps, 40 fps / 2.4 Mbps and 30 fps / 1.5 Mbps. The host reads measured output frame rate, round-trip time, packet loss, available outgoing bitrate and browser CPU/bandwidth limitation, degrades after repeated poor samples and recovers more cautiously after sustained good samples.
- Caps reliable-channel controller backlog at 64 KiB and rounds analogue/button samples to three decimal places, preventing stale input packets from accumulating when the link is temporarily congested.
- Repairs Firefox's observed `about:blank` Quick Play iframe failure with three bounded reload attempts that preserve the active room and stop as soon as the child setup confirms readiness.
- Adds bounded signalling, data and media recovery. PeerJS signalling reconnects automatically; a lost data path gives Away 30 seconds to rejoin; an interrupted video path requests/redials the existing authoritative stream for 18 seconds. Home clears remote input so the match pauses safely, and never replaces Away with CPU control during recovery.
- Advances the Online room namespace and Quick Play cache tokens to Build 172 so older scripts and rooms cannot mix with the new transport contract.
- Preserves the frozen gameplay base. No locomotion, sprint speed, CPU tactics, positional contract, passing, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty value changes are included; the only match-engine change is the Online capture default from 45 to 60 fps.
- Verification passes the correctly configured historic Quick Play browser gate **184/184**, Online controller **13/13**, lobby transaction **85/85**, connection gate and new quality/recovery gate **23/23**. Original names pass **5/5**, Player Career links **2/2**, Player Career **9/9** and Create-a-Club **2/2**. The first Create-a-Club run exceeded its time limit while the live browser/server were consuming resources, then passed unchanged after those were closed.
- The exhaustive career-world audit was run but still reports four missing-fixture recovery errors across its 1888, 1950, 2000 and 2026 fixtures. Build 172 changes no career files and does not claim that separate existing gate.
- Post-fix remote acceptance is intentionally small: confirm one Away D-pad Down dive and observe the adaptive quality label over a short two-machine session. The larger gameplay overhaul and Josh's new notes begin after this frozen release.

## Build 171 — Online code-verification hold

- Keeps Home on the room-code verification screen until Away opens the peer connection, removing the previous one-frame code flash.
- Shows a copyable full join URL on Home so the host can send one complete link instead of asking Away to remember or retype a briefly displayed code.
- Keeps the entered room code visible on Away's verification screen while the connection is being established.
- Holds both sides at the verification boundary until the peer opens; Quick Play setup does not replace the code screen early.
- Advances the Online cache-bust and room namespace to Build 171 so old cached clients and older-build room names do not silently mix with this flow.
- Retains Build 170's connection, Ready and launch transactions and Build 169's controller navigation. It changes no match gameplay, locomotion, CPU tactics, positional contracts, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.
- A local two-browser acceptance held Home at the code screen before connection, prefilled Away from the complete join URL, and released both clients into Quick Play only after the DataConnection opened. The focused gate passes **27/27**, the Online controller gate **13/13**, and the retained lobby-transaction gate **85/85**.
- This is not a remote-acceptance claim. A fresh hosted two-machine test must still prove the full-link handoff, both verification screens and the subsequent setup/launch route.

## Build 170 — Online lobby transaction fix

- Josh and Connor's real two-machine Build 169 test established the exact failure boundary: controller navigation worked on both machines, the peer connected and both players reached Ready Up, but Home showed **Home Ready / Waiting for Away** while Away showed **Waiting for opponent** and its package reported Home and Away not ready. No match launched. This was a readiness/connection state desynchronisation, not another controller-navigation failure.
- Retains the working Build 169 DualSense/Xbox Online controller navigation unchanged.
- Continuously sends the authoritative peer-connected truth and a connection epoch into Quick Play, so a missed one-shot connected event heals instead of leaving one client permanently stale.
- Replaces one-shot readiness with a revisioned **Ready -> ACK** transaction that retries until acknowledged and is bound to the same versioned Home, Away and shared-settings configuration on both machines.
- Any team, lineup, tactic, kit or shared match-setting change advances that configuration and invalidates both Ready states. A stale Ready packet cannot authorise a changed fixture.
- Keeps launch under explicit Home control. Away becoming ready never starts a match by itself; Home must activate **Start Online Match** against the current matching Ready state.
- Replaces the fire-and-forget launch with a retried, idempotent **proposal -> ACK -> commit** transaction. Home enters the authoritative match and Away enters the live-view route only for the same accepted launch/configuration, while duplicate launch packets are safe.
- Extends the heartbeat tolerance to **24 seconds** for brief browser throttling and permits a fresh peer connection to replace a stale old connection rather than rejecting a legitimate reconnect.
- Advances the Online/Quick Play cache-bust and peer protocol to Build 170 so a machine cannot silently retain the Build 169 lobby scripts.
- A live two-tab local acceptance deliberately dropped the first Home Ready packet and the explicit connected event. It then passed both Home-first and Away-first readiness ordering, shared-settings invalidation and re-ready, explicit Home Start, and the Home-match/Away-live-view transition.
- Focused validation passes **13/13** Online controller checks and **85/85** Online lobby-transaction checks, including reordered configuration packets, dropped launch packets, commit-time revalidation, split-start prevention and reconnect recovery. Unchanged-area regression checks pass original names **5/5**, player links **2/2**, Player Career **9/9** and Create-a-Club **1/1**.
- The exhaustive career-world integrity suite was not rerun to completion: that area is untouched by this narrowly scoped Online protocol repair and the exhaustive world build is expensive. This release does not claim that unrun gate.
- A fresh Josh/Connor two-machine Build 170 test remains required. This repair changes no match gameplay, locomotion, CPU tactics, positional contracts, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

## Build 169 — Online controller and Start hotfix

- Repairs the published Online shell's missing controller navigation. Host, Join, Cancel and retry screens now use the shared DualSense/Xbox menu system.
- Makes the top-level Online page the single source for local controller discovery during setup, then bridges normalised D-pad/left-stick, Cross/A, Circle/B and L1/LB/R1/RB input into the Quick Play iframe.
- Prevents duplicate input by suspending the outer controller menu while the iframe owns setup and disabling the iframe's unreliable physical-pad poll in favour of the bridged packet.
- Uses the top-level controller-presence result for Away readiness, so an iframe that reports no gamepads no longer leaves **Ready/Start** permanently disabled.
- Moves controller focus to the active page's Continue/Start action after every carousel change instead of retaining focus on a still-visible tab.
- When Away is already ready, the host's visible **Start Online Match** action now readies Home and launches with the same Cross/A press.
- The exact published failure was reproduced and passed with the controller exposed only to the outer page: Xbox and DualSense packets moved through all five stages, Away readied, and one host activation opened the match. A final disabled-to-enabled focus gate also covers Home reaching Match Preview before Away connects. The dedicated static gate passes **13/13**, the focused regression suites pass **16/16**, and the match engine remains **184/184**.
- Removes the synthetic acceptance hook before publication and changes no locomotion, CPU tactics, positional contracts, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.
- Physical Chrome/Firefox DualSense, Connor Xbox One and real two-Mac internet acceptance remain mandatory.

## Build 168 — Online Versus prototype

- Adds **Online** as a separate main-menu mode, using the established Quick Play setup rather than replacing or reducing any offline, career or local multiplayer route.
- The host occupies **Home** and runs the authoritative match; the joining player occupies **Away**, with their controller delivered to the existing Controller 2/Away input path.
- Each player owns their team, lineup, bench, tactics and kit selections. The host owns the shared match settings, including difficulty, stadium, weather, match length and camera.
- Adds short room-code hosting/joining, explicit connection state and a dual-ready gate before the host can start the match.
- Streams the host's authoritative match to the Away player and mirrors the essential playable HUD, rather than attempting a second independently randomised simulation that could desynchronise.
- Match sound now always launches at the normal 70% level instead of inheriting a stale saved `0` value. The setup-screen Off option has been removed; sound is muted and restored from a dedicated pause-menu toggle.
- Chrome and Firefox retain a visible, browser-neutral **Enable match sound** fallback when autoplay policy requires one click. Online now reports whether the host audio context is running and rejects a stream that has no required audio track.
- Adds same-build validation, ordered remote-input handling, heartbeat/disconnect detection and honest connection-loss presentation.
- Online play requires the hosted HTTPS build at [footballlegacy.github.io/football-legacy](https://footballlegacy.github.io/football-legacy/). A downloaded `file://` ZIP is unsupported and unreliable for this mode because browser origin and media restrictions prevent a dependable online shell.
- Uses the public PeerJS signalling service for the friends-only prototype. No dedicated TURN relay is configured, so restrictive school, office, carrier or symmetric-NAT networks may fail to establish the peer connection even when the room code is correct.
- A clean local two-client full flow passed: host/join, Home/Away ownership, team and lineup/bench synchronisation, dual ready, launch, remote Controller 2 delivery, a live **960×486** match stream with the browser sound gate, mirrored essential HUD and connection-loss handling. The engine gate passes **184/184**.
- A real two-Mac internet test between Josh and Connor remains mandatory before Online Versus can be called accepted or generally reliable.
- Changes no locomotion, CPU tactics, positional contracts, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

## Build 167 — offline Quick Play roster handoff

- Fixes the downloaded-ZIP route that could show Arsenal Invincibles and Conte Chelsea in Quick Play but load generic `HOME` and `AWAY` footballers in the match.
- Mirrors the complete selected teams, lineups, benches, tactics, kits and controller assignments into a validated local URL fragment, while retaining browser storage for normal served play and reload continuity.
- Adds `matchConfigSource` telemetry and corrects the playtest engine label to `0.167`, making URL, browser-storage and fallback launches distinguishable in future logs.
- Is supported by the contrasting logs `FL-MSN7AWXB` (generic fallback) and `FL-MSN757H7` (correct historic rosters), an end-to-end five-stage Quick Play launch, and a clean **182/182** engine gate.
- Changes no locomotion, CPU tactics, positional contracts, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

## Build 166 — controller publication hotfix

- Preserves the complete build-165 match, CPU, presentation and request-log workflow.
- Repairs Firefox DualSense D-pad navigation and D-pad Down contextual dive delivery.
- Makes intended pass-receiver handover reliable while keeping all defensive player switching manual through L1 or directional RS.
- Retains the Xbox One browser-standard mapping and adds explicit Xbox detection, A/B menu guidance and direct checks for A/B/X/Y, LB/RB, LT/RT, Menu, LS/RS and D-pad controls.
- Passes the clean **181/181** in-browser engine gate; physical Xbox acceptance remains for Connor.

## v0.31.1 — Missing-fixture recovery hotfix

- Repairs saves that open with no scheduled matches for the controlled club.
- Preserves existing fixtures and prevents duplicate fixture IDs.
- Runs defensively so repair or persistence failure cannot stop the career page rendering.
- Adds an automated 1888 broken-save recovery test.

## v0.31.0 — Combined career and match integration

**Status:** published to the shared GitHub `main` branch through [pull request #2](https://github.com/connorwr833/football-legacy/pull/2) on 9 August 2026. Merge commit: `b306474`.

### Included without removals

- Preserved **Take Charge**, **Create a Club** and **Player Career** as the three main career choices.
- Preserved grassroots careers inside Create-a-Club for tiers 7–15, including informal recruitment, part-time registrations, availability conflicts and non-football departures.
- Preserved professional Create-a-Club rules for tiers 1–6, original club/competition/player display names and the complete Player Career system.
- Included Josh's full v0.96 match engine, historic Arsenal and Chelsea squads, attacking identities, spectator mode, controls, physicality, set pieces, fights, celebrations, audio and North London stadium configuration.
- Merged the only overlapping file, `quick-play/index.html`, so the original-name loaders and Josh's historic-squad loader both run. Neither version silently replaced the other.
- Kept every tracked file from GitHub `main`; the combined change set contains **zero tracked-file deletions**.

### Combined verification

- **18 automated career/data checks passed, 0 failed**, including full tier-15 grassroots and tier-2 professional world builds.
- The combined Quick Play script, historic-squad pack and both inline Match Engine scripts pass JavaScript syntax validation.
- Player Career, Create-a-Club routing, original names, existing-save migration and all tested local links pass in the combined directory.
- Josh's five source files were recovered from pull-request head `2fca39f` and checked by SHA-256 before integration.

### Publication record — 9 August 2026

- Combined [pull request #2](https://github.com/connorwr833/football-legacy/pull/2) merged **8 commits across 47 changed files** into `main`, with **3,965 additions, 679 line removals and zero deleted tracked files**.
- Merge commit `b306474` contains both the career/data work and Josh's complete v0.96 match work.
- Josh's original [pull request #1](https://github.com/connorwr833/football-legacy/pull/1) was closed only after its full contents were preserved in the combined merge. Its branch and commit history remain available for traceability.
- The shared Quick Play page loads both the original-name data and Josh's historic squad pack; neither side replaced the other.

## Pre-publication review record — 9 August 2026

- Before publication, the GitHub `main` branch contained one commit: `82a6a68` (**Initial Football Legacy playable build**).
- At that review point, the repository had one pull request: Josh's [pull request #1](https://github.com/connorwr833/football-legacy/pull/1).
- Josh's current pull-request head is `2fca39f`, following commits `4f8e0de` and `5968c48`. The live scope remains 5 files, 3 commits and **+1,678 / -502 lines**.
- GitHub reported at review time that the branch had no conflicts with `main`. It was Draft, with 0 checks, 0 submitted reviews and 0 review comments.
- The current local career/data copy differs from its preceding local v0.30 copy across 32 files, with **+1,256 / -171 lines**. This includes the Player Career/original-name work and the Create-a-Club/grassroots repairs documented below.
- The current local career/data suite passes **18 checks, 0 failures**. Josh's branch has static and built-in playtest evidence recorded below, but no GitHub-run automated checks.
- **Decision at review time:** Josh's v0.96 work was accepted for the combined integration build. Publication then proceeded through pull request #2 after correcting the visible v0.95/v0.96 title mismatch; a complete hands-on match playtest remains required before calling the match experience release-ready.

## v0.30.1 — Create-a-Club career repair

### Career setup and routing

- Reduced the career-type choice to one screen on the main homepage: **Take Charge**, **Create a Club** or **Player Career**.
- Removed the standalone Grassroots career choice. Grassroots remains fully available by choosing a bottom-tier entry inside Create-a-Club.
- Removed the manager-creation **Previous Job** field.
- Locked created clubs to the present-day 2026/27 start for now.
- Removed the second career-type prompt and the extra save/confirmation loop.
- Creating the club now builds its career and opens the career homepage directly.

### Created clubs, squads and tier rules

- Added exact starting-tier selection from tier 1 through tier 15.
- Added a preselected 20-player generated squad whose ratings scale to the chosen tier and whose positional balance includes two goalkeepers, six defenders, five midfielders and three forwards.
- Added choices to retain or replace generated players, use custom created players and select from the game’s named real-player/iconic-player records.
- Selected existing real players are moved into the created club rather than duplicated.
- Tier 7–15 starts use the preserved grassroots systems: informal/no-fee recruitment, part-time registrations, day-job conflicts, matchday availability and player departures for university, relocation and other non-football reasons.
- Tier 1–6 starts use professional contracts, transfer budgets, wage budgets and normal transfer negotiation.
- The created club now replaces a valid club slot in the selected 2026 division, retains pyramid membership and receives a valid first-season fixture list.

### Playability repairs

- Repaired the broken Create-a-Club handoff that previously returned to setup without constructing a career save.
- Added defensive save boot repair for an invalid or missing controlled-club reference so the career homepage cannot fail on that handoff.
- Preserved the selected club, manager, squad, finances, tier rules and homepage tab before the career UI renders.

### Verification

- **18 automated checks passed, 0 failed** across created-club careers, Player Career routes and saves, original names and existing-save migration.
- A full 1888→2026 career-world build passed for both tier 15 and tier 2 created clubs.
- The built tier-15 save successfully rendered Home, Inbox, Team, Squad, Transfers, Club, Board, Competitions, History, Search, Manager and Settings.
- All modified inline scripts and the grassroots career module pass JavaScript syntax validation.

## v0.30.0 — Player Career and original names

### Player Career

- Added **Player Career** as a separate start-menu choice alongside **Create Legacy** and **Grassroots to Glory**.
- Preserved the existing Grassroots to Glory mode and its direct start-menu route.
- Added a career beginning at age 14 through either a club academy or local grassroots football.
- Added progression through grassroots, district football, academy trials, youth teams, reserves, first-team football, veteran football and possible later returns to the grassroots game.
- Added release and redemption paths: being released is a career event, not an automatic game over.
- Added permanent match records covering opponent, competition, result, minutes, rating, goals, assists, captaincy and key moments.
- Kept club, youth-international and senior-international appearances as separate records.
- Added development, age-based decline, fitness, fatigue, morale, training, objectives and coach trust.
- Added individual relationships with teammates, the club manager, supporters, the player's agent, family, the national manager and international teammates.
- Added contracts, transfer interest, playing-time conversations, role discussions, feedback and pressure.
- Added off-pitch choices involving family, rest, extra training, social media and nightlife.
- Added youth and senior international selection, separate international records and earnable international captaincy.
- Added player-controlled retirement with no forced career-length cap.
- Added a post-retirement handoff into the existing manager-career identity, retaining the player's career record.
- Added a separate Player Career save and **Continue Player Career** menu card.

### Original football names

- Restored the original display names of all **92 Quick Play teams**.
- Restored the original display names of all **320 career-database clubs**: 164 English clubs and 156 world clubs.
- Restored English league names and the historical names used by overseas leagues.
- Restored FA Cup, FIFA World Cup and UEFA competition names, while retaining period-appropriate historic competition names.
- Restored founder clubs, timeline entrants and overseas club identities from the game's embedded real-club references.
- Restored **110 unique, high-confidence iconic-player identities**, including Pelé, Diego Maradona, Lionel Messi, Cristiano Ronaldo and Johan Cruyff.
- Added display-name migration for existing saves while deliberately preserving technical IDs and gameplay values.
- Left generated players, managers and grassroots clubs unchanged where no real identity exists.
- Left most current Quick Play player names unchanged because the game does not contain a complete, trustworthy original-name mapping; no names were guessed.

### Verification

- Player Career routes, saves and links: **16 passed, 0 failed**.
- Long-career test: more than 25 seasons and 1,040 permanently recorded matches without forced retirement.
- Academy release, grassroots redemption, international-record separation, captaincy, relationship persistence and retirement handoff tested.
- Original names: **92/92** Quick Play teams, **320/320** club rows and **110/110** unique iconic-player mappings verified.
- Existing-save migration confirmed to leave technical IDs and gameplay values unchanged.
- 2026 career-world integrity simulation: **0 errors, 0 warnings**.
- Existing 1888 career-world integrity audit: **0 errors, 0 warnings**.

### Deliberately still separate or unfinished

- Football-politics and referee careers are not included yet.
- Player Career currently uses its statistical match simulation; a full 3D key-match handoff is not yet integrated.
- Deep international tournaments, qualifying groups and full squad-selection screens remain future work.
- Later senior Player Career offers still use a smaller fictional pool rather than the whole synchronized career world.
- Injuries, boot deals, awards, interviews and full story scenes remain future layers.

## v0.96 — Historic squads and expanded Match Engine

**Status:** included in v0.31.0 on `main` through [pull request #2](https://github.com/connorwr833/football-legacy/pull/2). Josh's original [pull request #1](https://github.com/connorwr833/football-legacy/pull/1) was then closed as superseded by the combined merge, with its branch and history preserved.

### Historic playtest teams

- Added Arsenal 2003/04 and Chelsea 2016/17 historic playtest squads.
- Added full 18-player squad lists, unique shirt numbers, role-calibrated attributes and correct 4-4-2/3-4-3 starting shapes.
- Added Arsenal's 4-4-2 to 2-4-4 attacking identity, with overlapping fullbacks and wide combinations.
- Added Chelsea's 3-4-3 to 3-2-5 attacking identity, with wingback height and inside-forward occupation.
- Linked fullback and wingback movement to passing options, crosses and cutbacks.
- Added give-and-go behaviour and playtest telemetry for the new team identities.

### Match intelligence and team identity

- Added normalized difficulty handling and team-specific playstyle configuration.
- Added attacking shapes, repeatable attacking patterns, zonal roles, support runs, overlaps and defensive-phase marking.
- Expanded AI celebrations, match-state presentation cleanup and match/playtest telemetry export and recovery tools.
- Disabled the guaranteed-goal test shortcut for normal play.

### Controls and football actions

- Expanded mappings for both gamepads.
- Added lob passes, fake shots, flick-ups, manual aerial actions and flair aerial actions.
- Added crossing, headers, volleys, shoulder barges and enhanced contact outcomes.
- Added a multi-stage shirt-pull interaction and contextual diving decisions.
- Added penalty goalkeeper control, free-kick walls and stricter kickoff-law enforcement.

### Physicality, presentation and atmosphere

- Added contact-fall reactions and expanded collision feedback.
- Added confrontations, walkout fights and cinematic fight presentation.
- Added expanded celebration handling and match presentation cleanup.
- Added crowd and collision audio systems.
- Added a built-in North London stadium backdrop and stadium-theme configuration.

### Quick Play changes

- Added spectator mode with both teams controlled by AI.
- Added 3-4-3 to the selectable formations.
- Added the North London built-in stadium as the current default stadium theme.
- Changed the current default setup to a night match on Legendary difficulty.
- Passed named difficulty settings directly into the expanded match engine.

### Review and validation notes

- Pull request scope: **5 changed files, 3 commits, +1,678 / -502 lines**.
- Current commits: `2fca39f` (**Add Arsenal and Conte Chelsea playtest squads**), `5968c48` (**Add v0.96 team attacking identities**) and `4f8e0de` (**Document v0.96 historic team playtest**).
- The proposed match script, Quick Play script and historic-squad data all pass JavaScript syntax validation.
- Both historic squad packs contain 18 players with unique IDs, unique shirt numbers and integer attributes within the valid 1–99 range.
- At pre-publication review, the original pull request had **no automated GitHub checks, reviews or review comments** and was marked **Draft**.
- At that same review point, GitHub reported **no conflicts with the base branch**. After the combined merge changed `main`, the original draft was closed as superseded rather than merged a second time.
- Josh's pull-request file displayed **v0.95** in the page title while its internal report/configuration identified **v0.96**. The combined v0.31.0 build corrects that visible title to **v0.96** before publication.
- The pull request's original short description understates its actual scope. The broader controls, AI, physicality, fight, celebration, set-piece, audio, stadium and spectator changes are documented above so they are not silently introduced.
- Static validation is complete, but a full hands-on match playtest is still required before treating v0.96 as release-ready.
- The project owner has approved this change set for integration testing; that approval does not waive the manual playtest or permit it to overwrite the separate career/data work.

## Integration rule

Neither line of work should remove or silently replace an existing game mode. Player Career, Take Charge and Create-a-Club must remain available when the match branch is integrated; grassroots careers remain the tier 7–15 end of Create-a-Club. Josh's five-file pull request is match/Quick Play scoped and should be applied into a combined test build rather than used to replace the career/data directory wholesale.
