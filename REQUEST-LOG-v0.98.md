# Football Legacy request log — build 173 gameplay baseline

Updated 17 October 2026 from Joe Baker's DARTY lesson notes and Josh's follow-up playability review. Joe's goalkeeper balance, Nintendo Switch controller support, defender return-pass-loop fix, CPU slide tackles and more assertive, varied shooting are included in the 17 October gameplay release. Commentary remains a separate requested feature for the next task, when Joe will write the source line templates. The earlier Build 173 baseline remains recorded below, including Josh's locomotion verdict: “the game, the running, it feels amazing now. amazing.”

This log deliberately separates **code presence** from **playtest proof**. Josh's existing comments below remain the human acceptance authority; a browser check or CPU simulation cannot silently overwrite them.

## Joe Baker lesson requests — 14 October 2026

- **Goalkeepers are too good:** reduce unrealistic keeper reach and make powerful or well-placed shots more capable of beating the goalkeeper, while keeping routine central saves credible. **Completed and published 14 October 2026.**
- **Nintendo Switch controller fallback:** support Joe's Switch controller if the Xbox controller is unavailable. Use the browser's standard physical face-button order, shown to Joe as **B pass/select, A shoot/tackle/back, Y lob/clear and X through ball**; L/R, ZL/ZR, sticks, D-pad and + retain their matching physical roles. **Implementation and publication approved.**
- **Defenders passing back and forth:** after one defender completes a pass to another, suppress an immediate unpressured return to the same defender. Prefer a third teammate or carry into space, while preserving the return pass as an emergency outlet under genuine pressure. **Implementation and publication approved.**
- **Professional-style commentator:** introduce match commentary for DARTY. **Requested, logged and explicitly deferred to the next task; not implemented here.** Joe will write the template lines before voice, delivery format, event coverage or audio production is chosen.
- **CPU action coverage:** CPU footballers do not currently use every human input. The live FL V2 path uses movement, sprint/containment, shield context, passes, shots, carries, standing tackles and shoulder challenges; it does not yet independently use the complete human skill, dive, shirt-pull, aerial-command or restart-input set. **Audited honestly; no false “all inputs” claim.**
- **Slide tackles need major work:** the old AI contained a slide decision, but the live FL V2 authority could not emit a slide-tackle action. The release adds a goal-side, last-recovery CPU slide choice plus deterministic wind-up, lunge/contact and longer recovery; committed contact now drives the existing DARTY fall system and can produce a toy leg-pop on a genuinely hard hit. The design borrows FLAME's action/contact/recovery and impact-to-fall principles rather than copying Godot ragdoll code into Three.js. **Implemented, autonomously tested and included in the 17 October website release.**
- **Shooting is seriously underwhelming:** CPU shot range was too conservative and every live FL V2 attempt used the same driven profile. The release makes CPU players recognise credible attempts earlier and choose low-driven, placed, driven or power strikes from range, angle and pressure. Human normal shots retain regulation pace but use a flatter flight, stronger strike sound and visible shot/power-strike feedback. **Implemented, autonomously tested and included in the 17 October website release.**

## Build 173 — final gameplay-baseline additions

### Receiver control and directional knock-on

- **In-flight manual receiver override:** a targeted pass initially nominates its expected receiver, but L1/LB nearest-player switching or a directional RS flick may replace that nomination while the ball is travelling. This transfers human control only; the pass trajectory is not steered, retargeted or regenerated.
- **No general autoswitch:** opponent-possession and ordinary loose-ball selection remain manual. The automatic rule is still limited to handing control from the passer to the intended receiving footballer.
- **No knock-on chase boost:** L1 + RS still knocks the ball deliberately ahead, but it no longer increases the footballer's velocity or grants a special chase movement state. Pace, acceleration, sprint input and stamina remain authoritative.
- **Accepted locomotion protected:** none of the shared running, gait, turning, acceleration or sprint constants were retuned in this pass.

### Penalty contract

- A penalty now stages the taker, displays an understandable aim/power/run-up state and prevents the restart or period-end logic from swallowing the sequence.
- The goalkeeper's decision window begins at ball contact and lasts **400 ms**. The only choices are **stay middle, top left, top right, bottom left and bottom right**.
- A human-controlled goalkeeper selects with RS after the strike. A neutral stick remains central. A CPU goalkeeper makes one of the same five post-contact decisions and receives no trajectory oracle or Ultimate physical bonus.
- This establishes the requested interaction and presentation base. Connor's previously reported failure still needs a normal-speed human acceptance pass for staging, timing, aim feel and save readability.

### Josh's retro three-technique free-kick system

This is Josh's system—not “FIFA 20-style driven and curl modifiers.” Its input and aiming grammar deliberately combines ideas Josh remembers from retro FIFA free kicks, while the exact historical edition remains open rather than being falsely asserted.

1. **RS camera/aim before lock:** the camera pan is the aim itself. There is no modern target reticle revealing the destination.
2. **Circle lock:** pressing Circle commits the camera angle, selected technique and charged power.
3. **LS spin after lock:** LS then supplies side curve and top/back spin on the locked camera plane. It does not move a target after the angle has been committed.
4. **Circle — controlled dip:** a regular controlled run-up; laces-to-inside-instep contact below centre; a powerful but controlled through-and-up follow-through. Too much power can still overshoot.
5. **L1 + Circle — driven:** one big, strong base run-up and follow-through. Neutral LS gives central-laces contact and a straight finish through the locked plane. For an inward curl, the taker strikes through the outside section of the ball and follows through ball and body on a slightly wider off-centre line—close to the no-curve action, not a hooked finish. For an outward curl, inside-section laces/instep contact takes the powerful finish across the selected curve side. Its swerve is intentionally restrained and becomes less consistent as power rises; it is not forced to be a low shot.
6. **R1 + Circle — curl:** two specific physical variants. Curve aligned with the approach uses an open hip, inside-instep contact on the lower outer quadrant and wraps up/across the body. Curve opposing that angle closes the hip, cuts through the opposite side of the ball with the instep and follows across the locked aim plane.

The intended direct-shot window is **18–28 metres**. Default dip and R1 curve are calibrated around roughly **two to three power bars**; the L1 driven strike can be taken through full power, but its error and inconsistency widen rather than guaranteeing a perfect blast. The wall is now literal shoulder-to-shoulder footballer geometry with the requested protective pose, not an overlapping visual texture or a loose row of markers.

All of those contacts are **preferred-foot-relative**. Right-foot and left-foot takers swap kicking/plant legs and mirror the hip, shoulder, foot and lateral follow-through geometry. The historic Arsenal and Chelsea package now passes each known left/right preference into the match engine; configured future footballers can use the same field.

The physical distinction is research-informed: wrapping the inside foot around the ball produces controlled sidespin, while more central instep contact prioritises speed and direction. These sources guide the animation/physics relationship but do not determine Josh's controls or prove one exact FIFA edition: [FIFA Training Centre](https://www.fifatrainingcentre.com/en/game/game-analysis/set-plays/set-play-routines/direct-free-kicks-overcoming-long-distances.php), [biomechanical review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3786235/), [2024 instep-direction study](https://commons.nmu.edu/isbs/vol42/iss1/120/).

### Replay and opening-cutscene baseline

- **Unified replay language:** goals, ordinary/carded fouls, red cards, full dive-play-on incident chains, stoppage-triggered dive replays, keeper saves that run out for corners and missed shots all use event-specific timings rather than one generic cutaway.
- **Extra real angles:** every replay plan uses at least two distinct viewport positions from the six physical pitchside cameramen. Goal replays move from a touchline operator through ball flight to a behind-goal operator at true net contact, then track the scorer. Foul/dive replays finish from a second ground-level corner operator; save and miss replays include both touchline and behind-goal evidence before their final view.
- **Readable slow motion:** the lead-in and aftermath remain near real speed while tackle contact, dive impact, save contact, near-miss trajectory or net contact plays through a much slower middle window. This is not a whole-replay speed reduction.
- **Non-intrusive skill context:** a successfully contested fake shot, stepover, roulette or flick-up can become the lead-in to the next natural goal/foul/save/miss replay within the retained buffer. It never pauses live play merely because a skill occurred.
- **Skip and cleanup:** Cross/A or Space skips every replay; the director restores the captured live state and continues into the correct kick-off, free kick, goal kick or corner.
- **Free-kick replay ownership and order:** several slow-motion free-kick angles and speeds are captured as one owned sequence. It plays immediately when the ball is already out; if play is live it waits for the next natural stoppage. That stoppage's own replay runs first, followed by the queued free-kick replay. A post-card confrontation runs before either replay, and the held restart—including timer, signal, camera cut, wall and footballer timing—is then restored exactly.
- **Temporary playtest frequency:** the deliberately high free-kick replay frequency is limited to this Build 173 playtest/version so the new angles, ordering and restore path can be judged; it is not recorded as the intended final broadcast frequency.
- **Fresh walkout every match:** each new match shuffles a six-beat opening plan across four tunnel perspectives, five lineup/establishing views, home and away stars, moving footballers, both goalkeepers, the referee crew, four shot styles and all six pitchside operators. The prior signature is stored locally and excluded from the next load, so reopening a match cannot immediately reproduce the same sequence. Hops, bounces and loosen-up animations are also re-seeded.
- **Acceptance boundary:** the source routes and anti-repeat contract pass the autonomous gate. Josh has not yet judged the complete normal-speed rhythm and framing, so aesthetic acceptance remains open rather than being silently claimed.

### North London stadium overlap correction

- The pale cream/white blocks in Josh's screenshot were current Highbury-style streetscape facade geometry projecting through the upper seating, not a flashing asset and not an old cached build.
- The streetscape is now anchored behind the true rear faces of all four stands. This removes only the seat/facade intersection; the continuous urban backdrop, seating, roof structure and real pitch floodlighting remain in the workflow and in the scene.

### Verification and workflow boundary

- The browser engine gate passes **191/191**. It directly exercises hidden RS aim, post-lock LS spin, all three trajectories, R1 wrap/cut animations, L1 central/inward-wide/outward-across contact and follow-through mirrored between right and left foot, default dip, five-choice post-shot penalties, receiver overrides, unchanged pass trajectories, knock-on speed preservation, multiple pitchside replay routes, decisive-beat slow motion, non-intrusive skill lead-ins and walkout anti-repeat variation.
- After the replay-ordering, exact-restart-restore, stadium-overlap and configured-team controller checks were added, the current browser engine gate passes **192/192**. The same full gate passes in normal Single Player, Controller 1 Home versus Controller 2 Away Local 2P, and Home same-team co-op with both controllers on Home and Away left to the CPU.
- Fresh focused regressions pass the Online connection, controller **13/13**, lobby **85/85**, quality/recovery **23/23**, original-name **5/5**, Player Career links **2/2**, Player Career **9/9** and Create-a-Club **1/1** gates.
- **Current Create-a-Club rerun limitation:** the unchanged form test still passes, but the playable-save test reaches its fixed 120-second timeout while `createStartYear(..., 2026)` is still simulating all 138 seasons from 1888. It times out before its Create-a-Club assertions and continues working because that older generator has no cancellation hook. Build 173 changes no Create-a-Club, career-mode or test file, so this is recorded as a pre-existing slow-gate limitation rather than silently called a new pass or a gameplay regression; the earlier successful 1/1 result above remains historical evidence.
- The browser reports no JavaScript console error. The existing local Three.js resource returns 404 and loads through its CDN fallback.
- The four known exhaustive career-world missing-fixture recovery errors are unchanged and remain open; this match baseline does not claim to repair that separate system.
- **Not published:** Build 173 is the prepared local baseline. Publication requires the explicit later publish step.
- **Nothing removed from the wider workflow:** CPU team/positional behaviour, formation defaults, defending, goalkeeper intelligence/animations, free-kick-suite human tuning, stadium scale/Highbury rebuild, FLARE likenesses, celebration-by-celebration polish, career integration and the later deeper ball-physics pass all remain recorded below. Replay/pitchside-camera and walkout variation now have the requested baseline implementation, but their normal-speed visual acceptance remains open.

## Build 172 — completed remote-match diagnosis and Online freeze

### Evidence-led diagnosis

- **Real remote match:** Josh and Theo completed a hosted Online match with Home authoritative simulation, Away Controller 2 input and a playable live stream. Josh described it as “pretty fucking smooth” and asked for higher frame rate and greater connection stability rather than a new networking architecture.
- **Specific failure:** Away's D-pad Down did not produce a dive during that match. It remains the agreed input; R3 remains flick-up.
- **Control comparison:** local log `FL-MSN757H7` contains D-pad Down controller-input events for Thierry Henry at minute 29 and Freddie Ljungberg at minute 40, each immediately followed by a dive event. The local match action therefore works. The Online defect sat at Firefox's raw DualSense packet boundary.
- **Live transport evidence:** the completed session proved remote Controller 2/Away input and a direct peer path, but the old stream was fixed at 45 fps and had no adaptive sender policy. The correction targets those observed boundaries rather than changing match gameplay.

### Frozen implementation contract

- **Controller truth:** raw Firefox DualSense input is standardised before peer transmission, including Square/Cross and hat-axis D-pad Down to logical button 13. Standard DualSense/Chrome and Xbox One packets retain their existing standard mapping.
- **Adaptive picture:** capture begins at 60 fps. Sender profiles bound resolution, bitrate and frame rate together at 60/50/40/30 fps. Two poor samples trigger one downgrade; six sustained good samples plus a cooldown permit one recovery. Difficulty, player pace and simulation outcomes are never involved.
- **Input stability:** analogue/button values are compacted and reliable-channel backlog is capped so congestion drops stale controller frames instead of replaying them late.
- **Firefox setup recovery:** an Online Quick Play child that remains `about:blank` receives up to three room-preserving reload attempts and stops immediately once ready.
- **Connection recovery:** signalling reconnects when possible. During a live data or media interruption, remote input is cleared and Home's authoritative engine pauses; Away is never silently replaced by CPU. Data recovery is bounded to 30 seconds and media replacement to 18 seconds before an honest failure screen.
- **Version boundary:** Build 172 has its own peer room namespace and cache token.
- **No gameplay drift:** the complete build-171 gameplay/request-log workflow remains. The only match-engine edit is Online capture's default 45-to-60-fps change.

### Verification and remaining boundary

- The intended Arsenal Invincibles v Conte Chelsea Quick Play route passes **184/184** in-browser engine checks, including full raw-Firefox D-pad Down dive and Xbox One movement/aim/sprint/dive routes.
- Online connection, controller, lobby and quality/recovery gates pass: connection gate, **13/13**, **85/85** and **23/23** respectively. Original names pass **5/5**, Player Career links **2/2**, Player Career **9/9** and Create-a-Club **2/2**.
- The exhaustive untouched career-world runner still reports four missing-fixture recovery errors; that separate career defect is not promoted as an Online regression or silently claimed complete.
- One short post-fix remote confirmation remains useful for the exact D-pad Down route and real adaptive-profile behaviour. The playtest stage is otherwise closed; broader gameplay notes move into the next overhaul rather than expanding this release.

## Build 171 — persistent code verification and full join URL

### Request and implementation contract

- **Observed blocker:** Home's generated room code flashed for roughly one frame before the page changed, making ordinary handoff impractical and forcing Josh to recover it from a screen recording.
- **Persistent Home verification:** the generated code and connection state remain on screen until Away actually opens the peer connection.
- **Copyable handoff:** Home receives a copyable full join URL carrying the room destination, so it can be sent directly to the second machine.
- **Visible Away verification:** Away continues to see the entered room code while connecting; it is not hidden immediately after submission.
- **Shared gate:** both players remain at the verification boundary until the peer opens. Only then does the normal Online Quick Play setup replace that screen.
- **Build separation:** the Online cache token and room namespace advance to Build 171, separating this flow from cached Build 170 files and older room names.
- **Preserved scope:** Build 170's connection/Ready/launch transactions and Build 169's controller route remain in place. Build 171 changes no locomotion, CPU, positional, physics, finishing, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

### Acceptance boundary

- **Locally exercised, not remotely accepted:** a two-browser run held Home at the code screen, prefilled Away from the full join URL and released both clients only after peer connection. The dedicated gate passes **27/27**, while the retained Online controller and lobby-transaction gates pass **13/13** and **85/85**.
- **Still mandatory:** on the hosted Build 171, Home must copy and send the full join URL; Away must open it and see the intended code; both screens must persist until connection; then both players must complete setup, matching Ready states, explicit Home Start, Home/Away control, audio/video and an intentional disconnect.

## Build 170 — Online readiness and launch transaction repair

### The real Build 169 evidence

Josh and Connor both used the hosted build on separate machines. Controller navigation worked for both, the UI reported Connor connected and both reached Ready Up. Both pressed Ready and saw a local tick, but the shared state split:

- Josh/Home saw **Home Ready / Waiting for Away**.
- Connor/Away saw **Waiting for opponent**; beneath his settings the lobby package still said **Away not ready / Home not ready**, followed by the room code.
- The match never launched.

That evidence narrows the defect to cross-frame/cross-peer state delivery. It does not invalidate the Build 169 controller fix, and it does invalidate any earlier claim that one local Ready tick or a fire-and-forget launch was sufficient remote proof.

### Build 170 protocol contract

- **Self-healing connection truth:** the Online parent continuously supplies peer-connected truth plus a connection epoch. Quick Play reconciles that current truth, so losing the original connected event cannot strand Away at **Waiting for opponent**.
- **Configuration-bound Ready:** Home, Away and shared settings carry a versioned lobby configuration. Ready is revisioned, acknowledged and retried; it counts only when both clients refer to the same current configuration.
- **Deterministic invalidation:** changing either team, lineup, tactic or kit, or changing Home-owned match settings, invalidates both Ready states. Old or reordered Ready packets cannot approve the changed match.
- **Explicit Home start:** Away readiness never auto-launches. Home must explicitly activate **Start Online Match** after both current Ready states are confirmed.
- **Transactional launch:** launch now proceeds as a retried, idempotent **proposal -> ACK -> commit** sequence tied to the accepted lobby version. Home opens the authoritative match and Away opens the corresponding live-view route only after that shared transaction; duplicate packets do not create a second launch.
- **Connection resilience:** heartbeat loss now allows **24 seconds** for browser throttling or a brief stall, and a legitimate fresh peer can replace a stale old connection during reconnect.
- **Cache coherence:** Online and Quick Play use the Build 170 cache-bust/protocol identifier, preventing one machine from silently keeping the older Build 169 lobby code.
- **Scope preserved:** controller navigation remains the accepted Build 169 DualSense/Xbox route. Build 170 removes no request-log workflow and changes no locomotion, CPU, positional, physics, finishing, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

### Build 170 evidence and acceptance boundary

- **Loss-injected local acceptance:** a live two-tab run deliberately discarded the first Home Ready packet and the explicit connected event. Continuous connection reconciliation and Ready retry recovered without reloading.
- **Ordering and invalidation:** both Home-first and Away-first readiness flows passed. A shared-settings change cleared both Ready states, required a fresh matching Ready transaction and did not permit stale packets to restore the old approval.
- **Launch route:** explicit Home Start completed the proposal/ACK/commit exchange, then placed Home in the authoritative match and Away in its live-view transition.
- **Focused gates:** the Online controller source gate passes **13/13** and the Online lobby-transaction gate passes **85/85**, including reordered configuration packets, dropped launch packets, commit-time revalidation, split-start prevention and reconnect recovery.
- **Neighbour regressions:** original names pass **5/5**, player links **2/2**, Player Career **9/9** and Create-a-Club **1/1**.
- **Honest unrun boundary:** the exhaustive career-world integrity suite was not rerun to completion because the career world is untouched by this Online-only change and its exhaustive build is expensive. No completion claim is made for that unrun gate.
- **Still mandatory:** Josh and Connor must repeat the hosted two-machine flow on Build 170, including a configuration change followed by re-ready, Home's explicit Start, Home match control, Away live view/input, audio/video, and an intentional disconnect. The public signalling/no-dedicated-TURN limitation also remains.

## Build 169 — published Online controller blocker

Josh's first hosted test found that the mouse could traverse the Online Quick Play setup but the controller could not move between sections and the final **Start Match** action did not respond. The fault was in the Online wrapper, not the established match controls:

- **Outer shell repaired:** the Online Host/Join/Cancel/retry screens now load the shared DualSense/Xbox controller-navigation system, with Host as the initial controller target.
- **One controller authority during setup:** the top-level Online page discovers the physical pad and sends its normalised menu packet to the embedded Quick Play screen. The child no longer depends on browser-specific iframe gamepad visibility or polls the same pad a second time.
- **Readiness repaired:** Away controller presence comes from the top-level observation. An empty `navigator.getGamepads()` inside the iframe therefore cannot permanently disable Ready/Start.
- **Focus repaired:** every Quick Play section has an explicit controller-default Continue/Start action, carousel changes actively move focus into the current page, and a Start button that becomes enabled after Away connects takes controller focus instead of leaving Cross/A on a persistent step tab.
- **Launch repaired:** once Away is ready, one host Cross/A on **Start Online Match** both confirms Home and launches. The parent launch route itself was already correct.
- **Direct reproduction:** a two-client test deliberately exposed Xbox/DualSense input only to the outer pages while the Quick Play iframes had no physical controller. R1/RB changed stages exactly once, Cross/A advanced the focused actions, Away readied, and one Home activation opened Arsenal Invincibles v Conte Chelsea in the match engine.
- **Gates:** the dedicated source contract passes **13/13**, the focused original-name/Player Career regressions pass **16/16**, and the unchanged match engine passes **184/184** with zero failures.
- **Acceptance still required:** Josh should verify the repaired hosted build with his wired DualSense; Connor should verify Xbox One. The existing real two-Mac/NAT/audio/video test remains mandatory.
- **Scope preserved:** this is an Online menu/input/readiness hotfix only. It removes no request-log workflow and changes no locomotion, CPU, positional, physics, finishing, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values.

## Build 168 — Online Versus prototype

This addition preserves the complete build-167 offline roster handoff, build-166 controller release and every earlier football-model workflow. It adds a separate **Online** main-menu route for Josh and Connor to play the existing match against one another.

- **Role contract:** the room host is Home and the authoritative match machine; the joining player is Away. The Away controller is normalised and delivered into the existing Controller 2/Away route, so online control does not create a second gameplay implementation.
- **Quick Play ownership:** both players use the same five-stage Quick Play structure. Each owns their respective team, lineup, bench, tactics and kit. The host owns the shared difficulty, stadium, weather, match length, camera and other match-wide settings.
- **Room and readiness:** the host creates a short room code for the guest to enter. Both sides see connection status and must mark themselves ready; only the host can launch after both readiness states are true.
- **Authoritative presentation:** the Home machine runs the match once and streams it to Away. Essential Away play information is mirrored alongside the stream, including scoreboard/state and the actionable HUD required to read the controlled footballer and charged action. This deliberately avoids trying to keep two independently randomised engines in deterministic lockstep.
- **Audio contract:** Quick Play and Online always request normal match sound at 70%; an old saved `0` value can no longer silently mute a new match. The setup Off control is removed, a dedicated pause-menu toggle owns mute/unmute, and Chrome/Firefox get a browser-neutral one-click sound fallback when autoplay policy requires it. The Away shell distinguishes live video, a present audio track, host audio activation and an intentional pause-menu mute.
- **Safeguards:** the shell validates that both players use the same build, orders remote input packets and uses heartbeat/disconnect detection so a lost opponent is reported instead of leaving a falsely live room.
- **Launch contract:** both players must open the hosted HTTPS build at [footballlegacy.github.io/football-legacy](https://footballlegacy.github.io/football-legacy/) and choose **Online**. The downloaded `file://` ZIP route remains valid for offline Quick Play but is unsupported and unreliable for Online Versus because the browser's local-file origin and media rules do not provide a dependable shared online shell.
- **Network limitation:** this friends-only prototype uses the public PeerJS signalling service and has no dedicated TURN relay. Direct peer connection can therefore fail on restrictive school, office, mobile-carrier or symmetric-NAT networks. That is a network-path limitation, not permission to report a failed connection as successful.

### Build 168 evidence and acceptance boundary

- **Clean local two-client flow:** a fresh host and guest completed room join, Home/Away slot assignment, team synchronisation, lineup/bench synchronisation, tactics/kit ownership, shared-setting authority, dual ready and match launch without browser console errors.
- **Match delivery:** the guest received the live host match at **960×486**, essential HUD state was mirrored, and the guest's input reached the host's Controller 2/Away path.
- **Connection failure:** heartbeat expiry produced an explicit opponent-disconnected state rather than leaving the match apparently connected.
- **Autonomous gate:** **184/184** engine checks pass, including the normalised remote Xbox/standard-gamepad packet entering Controller 2/Away and the new default-on/pause-menu audio contract.
- **Still mandatory:** Josh and Connor must complete a real two-Mac test over the internet, each with the intended physical controller, before this can move beyond exercised prototype status. That test must cover room join, team and lineup changes, both ready states, Away movement/passing/shooting, Home movement, HUD readability, audio/video start, a completed half and an intentional disconnect.
- **Scope preserved:** no locomotion, sprint-speed, CPU tactics, positional contract, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty value changed in build 168.

## Build 167 — downloaded-ZIP Quick Play roster handoff

This release repair preserves the complete build-166 controller hotfix and every earlier football-model workflow. It changes only how Quick Play carries the selected match package into the match engine when the game is opened directly from a downloaded ZIP.

- **Failure isolated:** Josh's `FL-MSN7AWXB` loaded generic `HOME` and `AWAY` configuration with fallback footballers such as Harper, Wright and Mensah, even though the Quick Play screen showed Arsenal Invincibles and Conte Chelsea. Connor's `FL-MSN757H7` loaded `Arsenal Invincibles`, `Conte Chelsea`, `ars-henry` and the intended historic rosters correctly. The contrasting logs prove that the team data and selectors were sound and that the failure depended on the launch route.
- **Cause:** Quick Play previously placed the full team, lineup, bench, tactics, kit and controller package only in browser storage before opening `match-engine/match.html`. Firefox does not reliably share that storage between separate local `file://` documents/directories, so a double-clicked downloaded copy could reach the match engine with no package and silently activate generic fallback teams.
- **Offline-safe handoff:** Quick Play now mirrors the same complete package into a base64url URL fragment named `flMatch`. The match engine validates and prioritises that package, while keeping browser storage as the normal served-origin fallback and retaining the decoded package for reload/restart continuity. The fragment is local to the page and is not sent to a web server.
- **Telemetry truth:** reports now identify engine `0.167` and record `matchConfigSource` as `url-fragment`, `browser-storage` or `fallback`, so this class of failure can no longer masquerade as a valid historic-team test.

### Build 167 evidence

- **Contrasting source logs:** `FL-MSN7AWXB` proves the downloaded-file generic fallback; `FL-MSN757H7` proves that Connor's route preserved the correct roster package.
- **End-to-end Quick Play smoke test:** the actual five-stage menu launched Arsenal Invincibles v Conte Chelsea, produced a URL containing the complete `flMatch` package and rendered `ARS 03/04`, `CHE 16/17`, Thierry Henry and Diego Costa in the match.
- **Autonomous gate:** **182/182** checks pass with no browser console errors. The new regression round-trips the complete offline-safe package, including Arsenal, Chelsea, Thierry Henry and the Unicode name César Azpilicueta, without relying on shared browser storage.
- **File-route limitation:** the Codex in-app browser security policy does not permit direct `file://` navigation, so the double-clicked-file path itself still needs one physical acceptance launch after publication. The codec and full menu-to-match boundary are directly covered.
- **Scope preserved:** no locomotion, sprint-speed, CPU tactics, positional contract, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty value changed in build 167.

## Build 166 — three-fix controller release

This hotfix preserves the full build-165 match, CPU, presentation and later-work workflow. It changes only the three regressions reported immediately before publication, plus the clarified manual-switch contract:

- **Quick Play D-pad navigation:** Firefox exposes a wired DualSense D-pad either as buttons 12–15 or as a hat value on axis 9. The shared menu controller now recognises both representations across the observed `54c-0ce6`, DualSense, PS5 and Extended Gamepad identifiers. The visible previous/value/next setting controls and Cross/Circle menu actions remain unchanged.
- **Xbox One compatibility:** Xbox One remains on the browser's standard gamepad contract: A pass, B shoot/tackle, X lob/slide, Y through ball, LB manual switch/modifier, RB finesse/modifier, LT flair/shield, RT sprint, Menu pause, LS movement, RS skills/directional switching and D-pad Down dive. The menus now identify Xbox devices and show A/B labels rather than presenting every controller as a DualSense. Direct checks cover every face/shoulder/trigger/stick/Menu/D-pad index plus an end-to-end Xbox movement, aim, sprint and dive route; Connor still needs the physical-controller acceptance pass.
- **Contextual dive:** the same dual-representation D-pad reader is now used by the live match engine, so D-pad Down reaches the complete dive route rather than disappearing before `attemptDive`. The supplied playtest contained 43 recognised raw-Firefox controller inputs but no D-pad event and no dive, proving an input-delivery regression rather than a failed dive-outcome system.
- **Pass receiver handover:** control now stays with the nominated receiver throughout a targeted pass, through ball, lob or cross. This is an always-on football control rule, so an obsolete saved “auto-switch off” preference cannot disable it. When a through ball is deliberately sent into space and the strict first target scan finds nobody, the closest sensible forward runner is nominated to chase it instead of leaving control on the passer. This directly addresses the three untargeted human through balls in `FL-MSN4HN8T`.
- **Manual defensive switching:** Josh clarified that “auto-switch” meant receiver handover. General loose-ball/opponent-possession switching is removed. L1 remains the nearest-player manual switch and a FIFA-style RS flick selects a teammate in the indicated direction while out of possession. Receiver handover is fixed on and is not presented as a defensive auto-switch option.

### Build 166 evidence

- **Source log:** `FL-MSN4HN8T`, Ultimate, four-minute halves, Arsenal Invincibles v Conte Chelsea, North London night, physical Firefox raw-DualSense playtest. It recorded 1,710 events and 43 controller inputs; zero D-pad inputs and zero dives isolated the common D-pad delivery fault. Its human passing record included three ground through balls with no target, isolating the receiver-handover gap.
- **Automated gate:** **181/181** checks pass with no browser console errors. New direct checks cover Firefox hat-axis Down mapping, the complete hat-axis-to-dive action, intended-receiver control retention, absence of general defensive auto-switching, RS directional manual switching and the full Xbox One standard-gamepad contract.
- **Quick Play smoke test:** the current menu loads Arsenal Invincibles v Conte Chelsea by default, with the updated controller scripts and no visible setup regression.
- **Scope preserved:** no locomotion, sprint-speed, CPU tactics, physics, shooting, defending, goalkeeper, animation, stadium, FLARE, replay, free-kick or difficulty values were changed in this hotfix.

## Build 165 — current implementation and evidence

Build 165 keeps every earlier football-model workflow and adds the latest requested work instead of replacing it:

- **Quick Play Free Kick Suite:** Quick Play now has a dedicated Free Kick Practice mode. It uses a close footballer view, stops the match clock, returns the ball after each attempt and lets the user move anywhere on the pitch before pressing D-pad Up to stage a free kick from that location. The existing locked-target/LS-curve plane, default dip, R1 curve, L1 driven route, wall, whistle and trajectory hold remain the actual free-kick engine under the suite.
- **Goalkeeper save-animation bank:** contextual selection now covers four immediate-range actions (`foot-reaction`, `hand-jab`, `low-scoop`, `body-catch`), five longer dive actions (`low-dive`, `full-stretch-low`, `full-stretch-mid`, `full-stretch-high`, `side-dive`) and three going-to-ground actions (`forward-smother`, `collapse-save`, `loose-ball-cover`). Lateral reach, ball height, pace, time to goal, distance, security and one-v-one context select the action; difficulty supplies no reach or animation-success buff.
- **Goalkeeper possession and distribution:** caught-ball movement is faster and no longer damped by the autonomous hold loop. Cross now has charged ground-roll, throw and launched-throw bands; Square remains the long kick. CPU release timing is quicker while still ranking interception risk, short outlets and the long option.
- **CPU passing and progression:** distance-led pass pace and deliberate ground-ball grip are slightly crisper, immediate line breaks can select through or over-the-top delivery, and the existing possession base remains subordinate to positional contracts, 18/20-zone relationships, one-twos, third-player combinations, box occupation and team identity.
- **Useful CPU skills:** the decision and execution layers now preserve the selected purpose—protected turn, draw-and-release or one-v-one escape. A materially superior progressive pass still wins. Skills do not grant hidden pace or success physics; their value comes from shielding/redirecting the route and whether the carrier actually eliminates or holds off the defender.
- **Defensive recovery:** CB/FB/WB responsibility in low block and box defence is strengthened without altering physical ratings. Goal-side recovery and dangerous-run ownership use the same locomotion and stamina model as every other difficulty.
- **Headers and volleys:** both are genuine commanded shot routes with matching animation/flight types, separate xG and contact logic. Human teams cannot manufacture automatic attacking finishes; CPU sides may use the same aerial choice system. The autonomous gate now exercises both routes directly.
- **Gone Fishing celebration:** the routine is restaged as two roles. The fisher stays upright and reels; a separate rigid fish lies on the turf and flops/slides toward him. The former helicopter-like whole-body rotation is removed.
- **Replay/camera presentation:** pitchside operators are explicitly available for goals, celebrations, fouls, cards, incident chains, dives, misses and saves. Replay impact sections slow around contact, actors face the referee and Cross remains the skip input. Walkout already contains six camera beats and pitchside viewpoints; visual variety still needs Josh's normal-speed acceptance.
- **FLARE and likeness:** the 22 historic starters use individual height, skin tone and flat-mask presets with drawn 2D hair; player and referee 3D hair/eyebrow geometry is disabled. This is a coherent preset base, not a claim that every likeness has been artistically accepted.
- **Grounded locomotion presentation:** the shared momentum/turn-cost resolver remains, while the visual gait uses subtle root movement, planted-foot compensation and momentum-led lean rather than an instant pivot. Physical controller feel remains a human gate.
- **Penalty timing:** a pending penalty run-up prevents the half/full-time whistle from cancelling the kick.

### Build 165 four-match evidence set

All four matches were run sequentially with five-minute halves on Ultimate, North London night, fast presentation and full telemetry. No match was tuned in isolation.

| Match | Result | Shots | xG | Passes | Main behavioural evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| `FL-MSN3E2XO` | Arsenal 1–2 Chelsea | 9–7 | 2.31–1.11 | 106–98 | 10 skill attempts, seven one-two returns, five third-man releases, five crosses, two blocks, one volley chance and ten saves. |
| build `165-evidence-2` | Arsenal 5–0 Chelsea | 14–11 | 3.50–1.34 | 103–89 | 18 skill attempts, five one-two returns, six third-man releases, four blocks and a header chance for each team. |
| build `165-evidence-3` | Arsenal 3–3 Chelsea | 11–15 | 3.31–2.67 | 86–82 | 20 skill attempts, five one-two returns, five third-man completions, 13 blocks, three dives and four cross-derived volleys. |
| build `165-evidence-4` | Arsenal 3–3 Chelsea | 14–7 | 2.68–1.07 | 86–82 | 21 skill attempts, four one-two returns, five third-man releases, 14 blocks, two dives, one volley finish and 13 keeper saves. |

Across the set: **88 shots, 17.99 xG, 732 passes and 20 goals**. The range from 1–2 to 5–0 and two 3–3s demonstrates genuine match variation and a much healthier event volume than the earlier sterile simulations. Twenty goals from 17.99 xG also says the remaining balance edge is defensive pressure and goalkeeper outcome/animation coverage in specific close-box contexts. Following Josh's instruction, shooting volume has **not** been globally nerfed before those systems are judged in human play.

### Workflow retained after build 165

The next work has not been deleted or silently declared complete:

1. Josh performs the normal-speed DualSense Quick Play acceptance pass for passing weight/aim, through-ball receiver control, locomotion, defensive engagement, goalkeeper movement/releases, skill usefulness, headers/volleys, replay frequency and set-piece feel.
2. Josh uses the new Free Kick Suite to judge default dip, R1 curve, limited driven curve, power/aim readability, wall clearance and location-aware staging.
3. Normal-speed visual acceptance remains open for goalkeeper short/long/ground saves, Gone Fishing, pitchside replay framing, walkout variety, FLARE likeness/hair, referee face, reactions and North London proportions.
4. Continue defensive intelligence and goalkeeper refinement from evidence rather than scripting: contain/cover/block ownership, close-box authority, recovery action choice and keeper positioning—not a shot nerf or Ultimate physical bonus.
5. Future shooting design retained, not yet promoted to current implementation: L2 becomes the power/flair-shot modifier. Ordinary footballers use a less accurate power strike; suitable footballers may select lash-it, outside-foot, knuckle or rabona variants with matching ball physics and stat-governed reliability. The Rooney-style lash/volley references remain a design specification for a later controlled pass.
6. Quick Play interface art direction, commentary, the larger ball-physics overhaul and per-celebration polish remain later milestones after the current match loop is accepted.
7. Publication follows a final clean Quick Play smoke test and an honest request-log/GitHub handoff; publishing must not rewrite Josh's open visual verdicts as acceptance.

## Build 164 — `FL-MSMYG3U1` diagnosis and corrective pass

Josh's observed match was a genuine failure case, not a reason to hide the problem behind a shooting nerf: Arsenal beat Conte Chelsea **7–0**, with shots 20–7, shots on target 17–5 and xG 5.78–0.94. The log contained 60 CPU tackle attempts but only 11 completed tackles, one block, 15 keeper saves, two CPU dives and 16 mostly disengaged skill selections. Goals six and seven arrived while the goalkeeper was still in `keeperRecover`. Chelsea's ground passes averaged only about 7.96 pace units, and the visual notes repeatedly identified short/weak delivery, inactive defenders, centre-backs jogging back, poor rebound ownership, absent immediate through balls and low-shot goalkeeper coverage.

The 11 timed notes are now attached to these specific changes rather than being flattened into a generic AI complaint:

- **Passing:** distance-led ground-pass pace is crisper, while direction/error/first touch still come from the same ratings, pressure and body-position rules. Ultimate does not receive a pass-speed or accuracy outcome bonus.
- **Defensive-third responsibility:** low block and box defence now permit the nearest suitable CB/FB/WB/DM to own immediate pressure instead of waiting for a remote midfielder or attacker. A dangerous loose ball or rebound assigns one defensive hunter to its predicted location and one goal-side cover player. Ordinary pace, stamina and locomotion still determine whether they arrive.
- **Recovery sprint:** the defender responsible for the deepest carrier/run can sprint goal-side from the same rated locomotion model. There is no hidden Ultimate recovery pace.
- **Immediate penetration:** an onside run with a viable lane can be recognised directly as a ground through ball or over-the-top return instead of waiting for another full possession decision cycle.
- **Goalkeeper possession:** a CPU keeper can run with the caught ball into free penalty-area space, evade the nearest press and then distribute; human keeper velocity is no longer damped by autonomous hold logic. The running pose visibly cradles the ball with both hands.
- **Goalkeeper low coverage:** low dives and close fast foot saves are distinct from forward smothers and full side dives. Foot-save recovery is deliberately quicker. A new shot can interrupt the recovery pose with a small read penalty, so the keeper is not simply inert for the next finish.
- **Skills and dives:** CPU skills now require a genuinely engaged front defender at a useful distance. Fake shot, stepover, roulette and flick-up choice is contextual; the dive cooldown moved from 18 to 14 match-minutes and the visible non-box selection rate rose slightly, while the existing penalty-area evidence penalty remains.
- **Contact fall:** `fallTwist` locks the footballer's impact facing, tips him to the turf and only then rolls around his long body axis. It no longer spins upright around the world vertical like a helicopter.
- **Free kicks and replays:** a central 39–44 m free kick retains one blocker instead of collapsing to an empty wall. The outcome label now distinguishes `SHOT MISSED · GOAL KICK REPLAY` from `SAVE · CORNER KICK REPLAY`.
- **North London:** Josh's note that the Highbury direction is “nice but broken” remains an open visual verdict. Build 164 does not falsely promote the stadium to accepted or blindly replace it without a more specific visual review.

### Build 164 evidence after the repair

- **Automated gate:** 172/172 checks pass, including the revised 42 m wall, goalkeeper carry contract, low-dive/foot-save animation bank and the existing no-difficulty-physics contract.
- **Five-minute Ultimate CPU match 1:** Arsenal 2–1 Chelsea; possession 55–45, shots 12–8, xG 2.23–1.24, passes 110–74, accuracy 83–73%, tackles 11–13, saves 4–6.
- **Five-minute Ultimate CPU match 2:** Arsenal 3–2 Chelsea; possession 48–52, shots 10–6, xG 2.34–1.14, passes 95–71, accuracy 84–77%, tackles 8–6, saves 3–4.
- These two matches are evidence that Chelsea attack, both teams contest possession and the 7–0 keeper/defensive collapse did not immediately repeat. They do **not** visually accept the new keeper/fall animations, free-kick usability, stadium, skill frequency or controller feel; those remain Josh's next Quick Play gate.

## Build 163 release-candidate reconciliation

| Requested workflow | Current evidence-backed position |
| --- | --- |
| Restore the shared team model and every positional contract | **Implemented and repeatedly exercised.** Goalkeeper, CB, FB, WB, DM, CM, AM, wide-midfielder, winger and striker contracts now sit beneath team phase, unit responsibility and relationship logic. Arsenal keep the asymmetric Invincibles 4-4-2/4-4-1-1 identity; Conte Chelsea keep a 3-4-3 base, 5-4-1 defence and 3-4-2-1/3-2-5 progression. |
| Restore runners beyond the ball and in-flight team shape | **Implemented and live.** Targeted passes retain the passing team's possession state, so the receiving team does not collapse into a defensive shape while its own pass is travelling. Positional targets continue moving beyond the carrier, while protected rest defenders remain behind the attack. |
| One-twos, through/over-the-top returns and third-player combinations | **Implemented and CPU-proven.** The receiver now protects the combination long enough for the originating runner to move; support, ground-through and over-the-top returns are available, but a materially superior live decision may still redirect the move. Recent five-minute samples produced 2–3 genuine completions per side, plus third-player releases/completions. |
| 18-zone and 20-zone football references | **Retained as complementary layers.** The 18-zone grid governs macro territory/progression; the 20-zone grid governs lane and half-space relationships. The possession base no longer suppresses the position contracts, carrying, combinations or final-third escape routes. |
| Offside rule, defensive line, trap and danger behind | **Implemented.** Offside is evaluated at the kick, with restart exemptions. The defending unit can step, hold or drop from passer pressure, line connection, runner pace, defender pace, passing quality, goalkeeper cover and space behind. Rest defence now reads the deepest viable runner before a turnover instead of jogging to a carrier-relative point. |
| Coordinated defending in the final third | **Materially improved and repeated, human acceptance still open.** Pressure, cover, screen, zonal marks and responsibility hand-offs remain phase-specific. The final repair made protected defenders anticipate the highest runner, use ordinary pace-rated sprint recovery and hand immediate pressure to the nearest suitable defensive footballer when a CB is still recovering. It adds no Ultimate pace, reach or outcome bonus. |
| Dribble defence and shot blocking | **Implemented and live.** The first defender controls the exit lane, cover closes the destination and the screen occupies the carrier-to-goal line before contact. Low braced blocks and the solid instep standing trap are live selection/animation routes. The post-fix sample `FL-MSMP4UK9` produced three shot-block reads and three blocks. |
| Goalkeeper positioning and box authority | **Implemented and repeatedly exercised; controller feel remains a human gate.** Keepers bisect ball-goal angle, alter depth for cover, protect the near post, set for crosses, choose hold/set/rush, smother reachable loose balls, catch/parry/block and distribute into a team release shape. Close-box authority is contextual rather than automatic. The final evidence run contained no keeper-error candidates. |
| Shooting/xG calibration without nerfing shots | **Locked to the shared execution model.** No global shooting nerf was applied. Footballer ratings, body shape, pressure, fatigue, distance, placement and real blocking geometry resolve shots; xG describes the chance independently of the named finisher, keeper roll and difficulty. R1 finesse shots are stat-governed curved efforts. |
| Crosses, box occupation, headers and volleys | **CPU-proven, human input acceptance still open.** Wide delivery now waits for near-post, central-pin, far-post, decoy and cutback occupations; crosses and cutbacks have standardised contact trajectories. Both headers and volleys occurred from crosses in the repeated release simulations. Human automatic finishing remains disabled. |
| Free-kick aiming, physics and staging | **Implemented and autonomous gate passed; Josh must judge the controller feel.** The camera/target is placed first, then LS supplies curve on that locked plane. Default dip, R1 curl and L1 driven profiles have different power/flight behaviour; driven curve is intentionally smaller and loses consistency at excessive power. Walls are tight and shoulder-to-shoulder, and direct-central, direct-wide, wide-service, attacking-service and deep restart zones receive distinct onside staging. |
| Footballer/ball/goal/crowd scale and North London | **Rebuilt and visually audited, Josh acceptance still open.** Pitch is regulation 105 × 68 m, goal 7.32 × 2.44 m and ball 22 cm. Footballer height is roster-led. Crowd figures are larger; stands rise higher and fill most of the playable horizon. The stadium now uses close red-brick Islington massing, segregated home/away sections, floodlights and a subordinate rail/city layer rather than an open suburban bowl. |
| Six real pitchside camera operators | **Implemented and normal-speed audited.** North/south touchline, both post-side goal-line and both corner operators track the live ball. Their viewport transforms are actual replay cameras. The normal-speed build 162 foul replay successfully cut to a low ground-level operator angle; goal-side units sit behind the advertising line and outside the immediate goal mouth. |
| Normal presentation versus fast simulation | **Separated.** Fast diagnostics compress presentation only. Normal play retains walkout, foul, dive, missed-shot, save-to-corner, card, incident-chain and goal-replay timing/camera beats. Developer telemetry stays hidden unless `telemetryUi=1`. |
| Clean Quick Play human hand-off | **Prepared.** The release entry is the five-stage Quick Play menu, not a forced raw match. Default test package is Single Player, Arsenal Invincibles v Conte Chelsea, North London night, Ultimate, Broadcast, normal audio at 70% and four-minute halves; local versus, same-team co-op and CPU-v-CPU remain selectable. |

### Release evidence

- **Automated gate:** 172/172 checks pass after the final rest-defence, scale, free-kick, camera and Quick Play changes.
- **Balanced sample before the final recovery repair — `FL-MSMONI9Z`:** 3–3; shots 10–6, xG 1.69–1.13; five combined completed one-twos; one cross-derived finish per side; no keeper-error candidate.
- **Post-repair five-minute sample — `FL-MSMP3XTJ`:** 5–3; shots 22–8, xG 6.05–1.57; keepers made 15 saves; average nearest-defender distance fell to 150.6 for Arsenal chances and 70.2 for Chelsea chances; cross-derived volleys occurred for both teams; no keeper-error candidate.
- **Post-repair five-minute sample — `FL-MSMP4UK9`:** 3–1; shots 13–9, xG 3.07–1.74; keepers made 14 saves; average nearest-defender distance 122.5/134.2; three shot-block reads became three blocks; no keeper-error candidate.
- **Normal-speed review — `FL-MSMP5ZO6`:** 0–0; shots 6–2, xG 1.03–0.19, saves 1–6. The presentation ran to full time with a clean stat screen and no telemetry obstruction. A separate forced foul confirmed the ground-level replay viewport at normal presentation speed.
- These matches demonstrate variation from open 5–3 to controlled 0–0. They are repeated-system evidence, not a promise that every future match distribution is final.

### Human acceptance still honestly open

- Step-over, fake-shot, flick-up, shielding, roulette, lob/cross feel, manual headers/volleys, goalkeeper possession movement and controller aim/receiver selection need Josh's next physical DualSense pass.
- Reaction poses are source-quarantined from the two hated rear-arm silhouettes, but the complete live frequency and close-camera look still need Josh's eyes.
- North London, crowd/footballer proportion, FLARE likeness, walkout/fight direction and the Quick Play art style remain aesthetic acceptance items; they are not promoted to “Accepted” here.
- Commentary, the larger future ball-physics overhaul and the optional side-on scoop slide remain later milestones, as explicitly separated from this stable match-loop release.

## Historical build 111 delta

- **CPU passing:** the reliable short/support-pass base, faster reception decisions, structured recycle ownership and tactical route selection are implemented. The five-minute sample produced 379 passes at a combined 81% completion, so the earlier concern based on raw three-minute totals does not justify another global volume increase. Future CPU simulations use five-minute halves and assess progression, spacing and choice as well as totals.
- **CPU shooting/chance creation:** execution now uses footballer shooting, technique, control, awareness and composure plus pressure, body shape, fatigue, distance, xG and blocking risk. Difficulty changes recognition and selection only; it supplies no shot-accuracy, ball-speed or keeper-resolution bonus. Arsenal's terminal routes explicitly include Cole cross/cutback delivery and Henry's left-channel-to-centre preparation. The first five-minute sample produced only seven total shots, so the previous shooting barrage is not present; Henry's two goals from two shots and Chelsea's four saved efforts require repeated observation rather than an immediate global accuracy change.
- **Free kicks and penalties:** normal dip, R1 curve, L1 driven-wall behaviour, chip penalties, three-lane keeper commitment, a slower visible penalty run-up and held post-kick camera all pass direct checks. Short keyboard/controller presses execute reliably. Pausing now cancels every charged/pending input without taking the restart on resume. These systems have passed the autonomous gate but still need Josh to accept their feel and appearance in Quick Play.
- **Unified replays:** ordinary fouls, carded fouls, incident chains, missed shots and goalkeeper parries that exit for corners now enter a skippable replay before the correct restart. The X-wave participants are explicitly oriented toward the referee. This passes the autonomous route/cleanup gate; framing, frequency and pacing still need Josh's visual acceptance.
- **Pitchside cameras:** six visible ground-level operators now have bodies, tracking rigs and genuine viewport cameras: north/south touchline, left/right goal-line and two corner positions. Their views are selectable by the replay director and one is used in the walkout. Automated checks prove finite geometry, live-ball tracking and camera selection; visual quality remains open.

## Status key

- **Accepted** — Josh has seen/felt the current behaviour in representative play and accepted it.
- **Exercised** — the current build produced the route, but quality remains unaccepted.
- **Coded only** — source/config/test scaffolding exists; representative play has not proved the result.
- **Proven / implemented** in older rows — a particular wiring, automated or browser check exists; this is not human acceptance unless the row explicitly says Josh accepted it.
- **Broken / rejected** — current human evidence directly contradicts the requested result.
- **Not implemented** — the requested behaviour is absent from the current source.
- **Superseded** — Josh replaced the earlier request with a later instruction.

## Historical human truth carried forward from builds 104–113

The table below preserves Josh's line-by-line acceptance notes from the earlier audit. Where a row conflicts with the build-163 reconciliation above, the reconciliation is the current code/evidence position; the wording below remains preserved as the human history that drove the repair.

| Request | Status now | Exact position |
| --- | --- | --- |
| Remove both hated rear-arm foul reactions: the straight-arm and bent/folded-arm versions | **Build 107 removed at source; needs Josh's visual acceptance** | X-wave, dramatic foul, simulation, play-on, goal-reaction and confrontation selection no longer choose `appeal`, `protestDrama` or `innocenceHands`. A final render guard converts every legacy alias—including `handsBehindBack`—to a new clearly overhead `handsRaised` pose; `dejected` becomes `handsOnHead`. The focused sanitizer/selection regression passes, but a real foul scene still needs visual acceptance. |
| Make CPU defending function as a coordinated football unit | **Build 107 defensive responsibility/contact pass observed; human acceptance still open** | Preserve Josh's accepted active tackle feel and Costa aggression. Low-block and box-defence now give central danger to a CB, wide danger to the appropriate FB/WB, with explicit cover and screen duties. Standing challenges keep closing until contact or expiry, then resolve from defending, awareness, balance, carrier retention, facing, shielding and contact quality—not difficulty or pace. In `FL-MSM6FTW8`, all 23 final-third defensive-unit assignments used a valid territorial owner; the defensive midfield/back-line group won 5 of 8 successful tackles, Costa still won one, and neither side had a red card. This is one CPU sample, not final human proof. |
| Make free kicks and penalties playable and readable | **Build 111 reworked; autonomous gate passed, Josh acceptance open** | Josh's prior rejection remains the visual/feel baseline. The rebuilt routes now directly prove a tight location-sized wall, default dip, R1 curve, L1 driven wall interaction, whistle/readiness, short options, slower penalty run-up, chip penalty, three-lane keeper commitment and held trajectory camera. Deep-cross positioning and the full location-by-location shape still need representative human acceptance. |
| Respect human pass aim and switch to the intended through-ball receiver | **Build 166 repaired; needs Josh's physical reconfirmation** | `FL-MSN4HN8T` proved that ordinary targeted passes usually nominated a receiver but three ground through balls did not. Targeted deliveries now retain the nominated receiver for the full flight; an into-space through ball nominates the closest sensible forward runner when the strict first scan is empty. This is receiver handover only, not general auto-switching. |
| Add reliable replays for every foul, saves to corners and missed shots | **Build 173 replay baseline implemented; normal-speed visual acceptance open** | Ordinary/card fouls, red cards, incident chains, stoppage dives, misses and keeper saves to corners enter event-specific skippable routes and complete into the correct restart. Each has a slowed decisive beat, near-real-speed context and at least two distinct physical pitchside-operator positions. Cross/A or Space skips. Successful contested skills may lead into the next natural replay without interrupting play. |
| Do not auto-take a set piece after pause/resume | **Build 111 fixed autonomously; human reconfirmation open** | Pausing now cancels keyboard and both-controller charge states, delayed shot/lob timers and pending tackle input while preserving the held restart and ball position. The dedicated pause/resume regression passes without launching the kick. |
| Make the human playtest route clear and cohesive | **Workflow corrected yeh looks ok, i would improve the graphics cos its pretty microsoft office looking right now** | Reviewed human playtests now begin only through `Quick Play`, where the five-stage setup visibly confirms mode, teams, formations, stadium, difficulty, match length, camera and kits. A direct `match-engine/match.html` launch is a raw diagnostic engine route and cannot be used as acceptance evidence. |
| New stepover input: hold L2 and flick RS vertically; up/down chooses the leg relative to east/west facing; chain up to six; next LS direction produces the exit touch | **Implemented, needs human acceptance - looks shit. visually doesnt work at all. fucntionally actually seems ok** | The old human quarter-circle route has been replaced by leg-mapped vertical beats, a six-beat chain, delayed LS exit state, distinct beat/exit animations and telemetry. Non-L2 roulette remains. |
| Remove the automatic score that occurred without Josh pressing the aerial finish | **Coded guard, not reconfirmed i havent seen it, but volleys arent fucking working** | The specific uncommanded-header guard exists. The latest directly scored L2 flair through ball is a separate unresolved outcome/presentation case and is not counted as proof either way. |
| Stop the striker dribbling into the box while the goalkeeper does nothing | **Broken / unaccepted havent really seen this, but idk seems like the gk behavioural model and movement needs a complete refinement** | Goalkeeper hold/set/rush states exist, but Josh explicitly reported in the latest match that goalkeeper movement was not fixed. Debug-state success is not human proof. |
| Make slide tackles longer, entry-speed responsive and satisfying | **Implemented, needs controller-feel acceptance yeh theyre improved, i want to add a sortve more side on scoop trajectory tackle if poss at some point** | Standing, jogging and sprinting entries now produce increasing launch speed, live duration, travel and contact reach. The slide keeps its initial aim instead of homing, remains live through the skid, has a ground-level extension/recovery animation and logs entry speed and travel. |
| Preserve local versus and add same-team co-op | **Implemented and regression-proven yeh seems ok** | `Co-op / Local 2P` remains Controller 1 Home versus Controller 2 Away. `Same-Team Co-op` is a separate option binding both controllers to Home against CPU Away. Both configurations passed the full engine regression. |
| Run a focused human playtest after the consolidated fixes | **Completed; build rejected yes we need to audit properly, theres so much that hasnt been done thats been requested** | `FL-MSM2G6IH` is the focused three-minute Legendary match. Its 14 timed notes and telemetry now define the active blockers. |

## Historical foundation and carried-forward human notes

| Area | Status now | What is actually present / still owed |
| --- | --- | --- |
| Five-stage FIFA-style Quick Play carousel | **Proven in browser fine** | Teams, Team Settings, Match Settings, Controller Layout and Match Preview now share one FIFA 20-inspired match-centre presentation: large matchup cards, stage rail, controller arrows and persistent command bar. |
| Match modes | **Implemented and regression-proven eh seems ok** | Single Player, Controller 1 Home-v-Controller 2 Away, Same-Team Co-op against the CPU and CPU-v-CPU are separate explicit choices. |
| D-pad Quick Play navigation in Firefox | **Build 166 repaired after regression; direct check passed, physical reconfirmation needed** | The shared menu input now accepts both button D-pad and axis-9 hat representations for the wider set of observed Firefox DualSense identifiers. This follows the build-165 regression where Josh's D-pad stopped navigating despite ordinary face buttons remaining live. |
| Controller editing of dropdown/menu values | **Implemented, needs Firefox controller acceptance i think ok* | Every select is presented as a visible previous/value/next arrow row. Left/Right changes the highlighted value with the existing repeat timing, Cross cycles without opening a native dropdown, and the underlying select remains keyboard/accessibility compatible. |
| Historic test teams and ratings | **Implemented, needs match acceptance seems ok, hazard should be starting if he isnt haha** | Arsenal 2003/04 use a FIFA 05 overall baseline translated into Football Legacy attributes; Conte Chelsea 2016/17 use FIFA 18 launch-era baselines. They also carry distinct formations and tactical identities. |
| North London night stadium | **Rebuilt, needs Josh's visual acceptance has it? i havent noticed a change tbh** | The open suburban backdrop has been replaced by a Highbury/Islington relationship: four tight streets, close continuous brick terraces and mansion blocks, an Art Deco Avenell Road-style frontage, pavement/kerb/road margins and a lower distant railway screened by housing. A dedicated street audit confirms the stadium is pressed directly into the neighbourhood rather than sitting in a green apron. |
| On-screen name follows ball carrier | **Partial / ambiguous yeh sees good** | The two-card HUD can retain the selected human footballer on the left while the opponent card follows possession. This does not cleanly satisfy Josh's earlier request and needs an explicit display rule. |
| Throw-in restart freeze from `FL-MSLNZMXC` | **Proven fixed** | The recursive 1,386-restart loop was isolated and repaired. `FL-MSLOI598` completed with no restart storm. |
| Completed-log preservation and timed notes | **Proven** | Active and completed reports use separate storage keys; the completed 0–3 log survived a new match. |
| Default difficulty | **Build 106 implemented; verification open** | **Ultimate** is now the default, above Legendary. It may improve only scanning, anticipation, tactical coordination, decision selection, marking responsibility and booking awareness. Pace, acceleration, pressing speed, tackle/contact outcome, goalkeeper reach/reaction, passing error, shooting error and first-touch error remain governed by the same physical/statistical rules at every difficulty. |
| Shared footballer locomotion foundation | **Build 107 coded; 131/131 engine checks pass; human feel open** | Human Controller 1, human Controller 2 and CPU steering now pass through the same momentum-preserving resolver. It exposes idle, walk, jog, sprint, brake, turn and recovery states; requested angle, current speed, acceleration, agility and balance govern turn/brake cost. Deterministic 0°, 45°, 90°, 135° and 180° tests show progressively increasing cost, sprinting takes longer to stop than jogging, and high agility reduces turn loss. No difficulty speed multiplier was added. |
| Contextual first-touch families | **Build 107 coded; loose-ball retry defect CPU-proven fixed; visual/controller acceptance open** | Rolling, driven, bouncing, waist-height and dropping arrivals select different contact actions, durations and visible separation. Failed control has a separate heavy-touch animation, a 42-frame same-footballer retry lockout and a minimum loose-ball escape pace. That prevents the old repeated failure every 4/12 frames while preserving a contest for other players. `FL-MSM6TQG4` recorded nine heavy touches across 87 passes, every loose touch met the separation floor and no same-player/pass retry occurred within 60 frames. |

## Controller and user-controlled footballer mechanics

| Request | Status now | Qualification |
| --- | --- | --- |
| Normalise wired DualSense face buttons across Firefox/laptops | **Implemented, needs physical proof fine** | Raw Firefox DualSense Square/Cross remapping passes simulation; a real-controller pass is still required. |
| Xbox One controller mapping for Connor | **Implemented and autonomously proven; physical acceptance still required** | Standard Xbox A/B/X/Y, LB/RB, LT/RT, Menu, LS/RS and D-pad indices are retained. An end-to-end simulated Xbox pad reaches movement, aiming, sprint and D-pad Down contextual dive, while menus present Xbox-specific A/B guidance. |
| R3 flick-up | **Proven input route; feel needs playtest feels shit. it needs an overhaul, or a lot of work at least** | R3 releases a short directional pop. Toe scoop, instep lift, outside-foot and knee-pop variants exist. |
| D-pad Down contextual dive | **Build 166 repaired end to end; physical reconfirmation needed** | `FL-MSN4HN8T` recorded 43 raw-Firefox controller inputs but no D-pad event and no dive. The match now reads both button and axis-9 hat D-pad layouts; a direct regression proves that Firefox hat-axis Down produces a logged dive action without crashing. |
| Remove referee vision from dive outcome | **Implemented** | No referee-vision variable contributes to the current outcome calculation. |
| Remove deception/exaggeration stats; randomly select one of three performances | **Implemented, needs frequency/visual acceptance yeh maybe need to amend the smallest dive intensity, atm he just leans over, i want more of a stumble to at least communicate the idea of whats happened better** | Outcome and animation are separate. Subtle, flop and rolling performances remain; no deception stat is used. |
| Make successful penalty-area dives much rarer | **Implemented, needs longer match proof yeh seems good this** | Penalty-area evidence is downgraded and CPU selection is heavily suppressed there. |
| Let dives play live; whistle immediately/delayed/play on by context; replay only after stoppage | **Implemented, needs visual acceptance yeh seems a bit better, could play out a bit longer** | Live incident and delayed decision states exist. The full variety has not been proven in one representative match. |
| One Circle double-tap equals one shirt pull | **Implemented, input test passes  - i tried to do this i didnt see it, but idk, idk. needs a better examination** | R1 shirt pull was removed; one Circle double-tap creates one manual pull. Physical cadence still needs checking. |
| Fake shot via Circle+Cross and Square+Cross | **Implemented in direct tests; human feel unaccepted - yeh i think i want the window to allow registration quicker than it does; often times i end up sending the the ball away accidentally.** | Same-frame and release-first routes pass. Moving fake shots now show backlift, check before ball contact and exit in the chosen direction; with no exit input, the standing fake shot keeps a longer follow-through instead of forcing movement. |
| Triangle through ball; L1+Triangle over the top; L2+Triangle flair | **Implemented; first-touch follow-up coded in build 107, needs controller/visual acceptance** | The three dedicated through-ball routes remain. Receivers now select distinct rolling, driven, bouncing, waist-height or dropping-ball control contacts using ball height, vertical velocity, pace, flight type, body angle, pressure and attributes. Each family has its own action, duration and visible ball separation; failed control uses a separate heavy-touch action. The classification regression passes, but the transition from each pass into each live touch still needs Josh's controller acceptance. |
| Manual aerial clear with Square; aerial pass with Cross; L2 flair; L1+R1+Square driven loft | **Implemented, needs playtest yeh feels pretty ok, we need to work on the crossing into box feeling, adding some curve onto these crosses maybe, some more physics coded in general** | Routes and duel model exist. Magnetism was reduced and automatic human head-away was removed. |
| Lob pass consistency and no instant header | **Partial eh need a better look** | Deterministic ballistic helpers and an instant-header guard exist, but Josh has not accepted direction, power or feel. |
| New L2 vertical-flick stepover chain | **Implemented, needs human acceptance the "chain" works, the animation / visual presentation is a 2/10** | Deterministic leg mapping and six-beat/LS-exit scenarios are now in the self-test. Feel, timing and animation readability need the controller playtest. |
| Hold L2 to shield; make unshielded dispossession from behind easier | **Implemented, needs controller feel is this working? i guess you should make it obvious with a sublte shielding animation** | With the right stick neutral, L2 puts the carrier in a broad side-on shielding pose and materially reduces the clean-tackle window from behind. A clean unshielded rear challenge can secure possession directly. |
| L1 plus right-stick direction for a large directional touch | **Implemented, needs controller feel havent tried this yet to be fair** | The input releases the ball into the chosen space, visibly separates it from the carrier, gives the footballer a chase burst and logs `directional-knock-on`. It is now shown in the controller guide. |

## Diving, fouls and referee presentation

| Request | Status now | Qualification |
| --- | --- | --- |
| Three dive animations; fix ridiculous roll axis | **Implemented, needs visual acceptance yeh its better** | Rolling is configured along the footballer's long axis on the floor. |
| Clear foul cause and readable contact reaction | **Implemented structurally, needs human visual acceptance yeh seems ok but i want a replay in case its missed man* | Named causes, visible contact placement and direction/force/speed fall selection now pass direct regression. Because Josh previously found live awards unclear, visual readability remains an acceptance item rather than being called solved. |
| Contact force includes standing/jogging/sprinting tackle speed | **Implemented, direct regression passed; controller feel open yeh seems like its a good base coding, we will refine this a lot more!** | Relative speed, closing speed, challenge-entry speed, direction and technique feed fall selection. Slide travel itself now also scales monotonically from standing to jogging to sprinting entry. |
| New falls and negative reactions, including hands on head | **Build 107 reaction source repaired; visual acceptance open** | The direction/speed-sensitive falls remain. All known rear-arm aliases and live foul-scene selections are now quarantined behind `handsRaised` or `handsOnHead`; the active negative palette is hands on head, hands on face, head shake and hands clearly raised above the head. Josh must still visually accept the new live foul scene. |
| Hunched and collapsed laughter after ridiculous booked dives | **Implemented, needs live occurrence - it was working at the very first implementation cycle for a bit but not anymore?** | Both reaction routes exist; the latest observed match did not produce the event. |
| Referee X-wave in front of body | **Coded only; scene staging rejected ah it works better now, but yeah scene staging, the players are mostly fucked man we need to fix this** | The referee pose exists, but the surrounding footballers are not consistently oriented toward the referee and the current cutscene is not accepted. |
| Referee punch and matching impact | **Implemented, previously enjoyed; polish open havent seen it since.** | Punch animation/audio exist. |
| Replay dive-play-on-later-foul/card as one incident | **Build 173 expanded; normal-speed live proof still required. Earlier note retained: “havent seen any chain replays since. you do not employ nearly anywhere near enough replays in general.”** | The 4.6-second incident link now feeds a 6.8-second four-beat replay with a slowed dive/foul contact region, touchline and corner operators, and a clean restart release. |
| Foul/cutscene camera overhaul | **Build 173 structural direction replaced; visual acceptance still open** | Foul and card routes now use event-specific pacing, slow the decisive contact, orient around the incident and use two real ground-level operator positions rather than relying on the old generic framing. This does not convert source success into Josh's visual acceptance. |

## Set pieces and goalkeeping

| Request | Status now | Qualification |
| --- | --- | --- |
| Free-kick wall sized by location and kept 9.15 m away | **Build 111 autonomous pass; visual acceptance open** | Central wall size now steps from five to four to three to zero with distance, wide positions reduce it further, and direct spacing is shoulder-to-shoulder in the deterministic formation check. Josh still needs to judge the playable-camera appearance. |
| Whistle before free kicks and penalties; real-time aiming clock; hold camera after strike | **Build 111 autonomous pass; human timing acceptance open** | The one-time ready whistle, live aiming state and held post-strike camera pass. Pause/resume now clears charged/pending input without consuming the restart. The separate request to keep the match clock running through referee-decision presentation remains open. |
| Default dipping free kick; L1 driven; R1 curve | **Build 111 trajectory routes pass; human feel/visual acceptance open** | Default strikes carry explicit dip; R1 adds pronounced spin/curve; L1 stays flatter and the close wall can block it rather than letting it conveniently lift over. Inside/outside-foot visual language, aiming around either wall side and deep-cross feel still need a controller playtest. |
| L1 chip penalty and dedicated left/centre/right keeper commitment | **Build 111 route/pacing pass; human presentation acceptance open** | The taker now completes a slower run-up before contact, chip and normal routes stay distinct, the keeper commits left/centre/right and remains committed through a two-second recovery, and the camera holds after the strike. |
| Legal kick-off positions and less abrupt restart | **Implemented, needs visual acceptance yeh seems a bit better** | Assembly wait, own-half enforcement and whistle exist. |
| Improve CPU goal kicks and set-piece success | **Reworked and regression-proven; needs match acceptance a little improved but not much** | CPU goal kicks now choose an actual receiver, prefer a safe short exit and otherwise target a measured long outlet. Direct tests prove both routes and keep predicted long-kick landing error within the outlet lane; the next observed match must judge natural quality. |
| Caught ball remains live keeper possession up to five seconds with throw/kick/long-kick | **Coded; live movement/distribution unaccepted keeper movement is fucking teerrible here, why?** | Source route exists, but Josh again reported that goalkeeper movement was not fixed. |
| Team shape while the goalkeeper holds the ball | **Implemented, needs match proof yeh is a bit improved but still needs imrpoving, we need coded systems** | Centre-backs split, full-backs/wing-backs open wide, exactly the nearest suitable DM/CM becomes the central release outlet, and the remaining midfield/forward lines preserve spacing. The earlier “only the nearest central midfielder may track inside” wording was an unsupported inference and is not a defensive rule. |
| Keeper distribution avoids marked receivers and goes long if needed | **Implemented, needs match proof idk need more examination** | Space and lane ranking plus long-outlet fallback exist. |
| Keeper shot reactions and save balance | **Partial / unaccepted need to keep improving, game speed and animation speed proably is a big factor here** | The keeper has multiple coded states and poses, but the latest match does not establish balanced scoring and Josh again rejected keeper movement/presentation. |
| Active goalkeeper one-v-one against a dribbling striker | **Coded; human result rejected yeh keeps dont come out like he should. gk needs behavoiral model** | Hold/set/rush contracts exist and older CPU telemetry looked plausible, but current human evidence says the movement is still wrong. |
| Conte Chelsea tactical identity | **Broken in latest match well the difficulty seems to be the issue, can we scale it up any higher for the cpu to be playing to max intellignece, or we already capped out?** | The formation labels/contracts exist, but Chelsea produced zero wide entries and zero crosses in `FL-MSM2G6IH`; the essential wing-back attack did not appear. |
| Genuine one-twos and third-player combinations | **Implemented structurally; second-striker link now live; wider frequency acceptance open** | Give-and-go and third-man routes remain scored opportunities rather than compulsory scripts. The striker contract now recognises the other striker/link footballer as the first final-third bounce option instead of excluding all strikers and reaching straight back to a deep midfielder. `FL-MSM6YDQX` used that link twice; Arsenal also completed one third-man move, made 11 final-third entries and created five shot intents. Ordinary give-and-go returns were still absent, so the broader frequency gate remains open. |

## CPU football and team behaviour

| Request | Status now | Qualification |
| --- | --- | --- |
| Replace passive “bastardised nothingness” with a shared team model | **Implemented foundation; not accepted as finished mmm ** | Build, advance, create and finish phases plus transition/defensive phases exist. This is now an architecture, but match behaviour still needs substantial tuning. |
| Teammates run beyond the ball | **Proven but uneven ehhh kinda, needs more structure and coded behaviours.** | Telemetry shows beyond-carrier movement; quality, timing and team balance remain inconsistent. |
| Coordinated press: pressure, cover, screen, zonal marks and responsibility transfer | **Build 107 first defensive-unit pass observed; wider balance still open** | Strikers and midfielders retain high/mid-press duties, while own-third danger now transfers to the defensive unit: CB centrally, FB/WB wide, plus cover and screen. Booked footballers reject non-emergency rear challenges. `FL-MSM6FTW8` recorded 23 valid territory assignments and no invalid owner, with 4 total fouls and no reds. Mark-transfer count remains non-diagnostic by itself; human line-shape and repeated-match stability still need acceptance. |
| Different defensive behaviour by territory | **Coded labels; output unaccepted its not good in their own final third. in fact its completely shit.** | Counterpress, high press, wide trap, mid-block, low block and box-defence states exist, but the minute-50 open channel shows the unit does not yet express them reliably. |
| CPU meaningfully tries to win the ball | **Improved / accepted direction improved, except for in defense where it matters most lol** | The commit → close → contact pipeline is visibly better and should be preserved. Add smarter yellow-card, foul, cover and numerical-risk decisions instead of reducing aggression universally. |
| Invincibles attacking identity | **Researched, corrected and materially improved in one current CPU sample; tuning open** | The compact 4-4-2 / asymmetric 4-4-1-1 / situational 3-2-5 model remains. Build 107 adds an explicit leading-striker ↔ link-striker relationship. In `FL-MSM6YDQX`, Arsenal used the strike link twice, Cole drove the overlap 11 times and crossed once, reached the final third 11 times, entered the box four times, generated five shots from 1.43 xG and won 2–1. One match is encouraging, not a balance verdict. |
| Conte 5-4-1/3-4-3 to 3-2-5 attack | **Regressed / broken in latest match idk lets test with cpu v cpu as well** | An older CPU match showed width, but `FL-MSM2G6IH` produced zero Chelsea wide entries and crosses. Current-build evidence wins. |
| Use full-backs/wing-backs as options | **Arsenal full-back route live; Conte wing-back route still inconsistent** | `FL-MSM6YDQX` used Cole as the primary overlap repeatedly (11 overlap drives, three wide entries and one cross). Chelsea produced no wide entry/cross in the same match, so this remains asymmetric and the Conte route is still open. |
| Genuine 1-2/give-and-go | **Coded; incomplete in latest match** | Chelsea started three and completed none. A scored redirect can be valid, but the current match did not produce the requested outcome. |
| Triangles, midfield platform and structured recycle | **Implemented foundation, limited match proof** | Recycle occurred once in `FL-MSLOI598`. In `FL-MSLRFPIP`, Conte Chelsea started three third-player combinations, released all three runners and completed two, while ordinary one-twos redirected to higher-scored options. Wider shape and recycle frequency remain tuning work. |
| CPU passing rhythm and accessibility | **Build 111 volume gate passed; decision quality remains tuning work** | Short support passing has a lower error scale, receivers decide more promptly and an explicit recycle phase owns the reset rather than being relabelled as ordinary support. The five-minute Ultimate sample produced 379 combined passes at 84% Arsenal / 76% Chelsea accuracy. That is ample volume; future tuning targets progression, tempo variation, pressure response and receiver choice rather than blindly adding passes. |
| CPU chance creation and stat-led shooting | **Build 111 implemented and first five-minute sample observed; repeated balance open** | Historic/positional routes create the chance, then one shared execution model uses footballer ratings and football context. Difficulty has no finishing bonus. The first five-minute sample produced seven shots (2–5), six on target (2–4) and 0.67 combined xG; Henry scored both Arsenal shots while Chelsea forced four saves. This proves restrained shot volume and live routes, not final conversion balance or freedom from a player funnel. |
| Wing play, crosses, headers and volleys | **Broken / unproven i couldnt get any volleys off, or headers, despite me trying quite hard** | Arsenal logged eight wide entries and Chelsea none, but neither side crossed. Manual headers/volleys remain unaccepted. |
| Contextual CPU fake shots, stepovers, roulettes, flick-ups and dives | **Implemented, frequency/balance still open yeh keep working on this** | The selector now requires a relevant front/side defender and chooses by challenge context. In `FL-MSLR7KGR`, all three selections were engaged contests: one fake shot wrong-footed its defender, while another fake shot and a roulette were read. Longer observation is still required for the full move set and dives. |
| 18-zone football reference model | **Implemented and observed, balance still open** | A mirrored 6×3 grid now informs pass ranking: progression, free-zone occupation, weak-side switches and central connections are rewarded, while crowded squares and overfilled horizontal/vertical planes are soft-penalised. It guides decisions rather than locking footballers to tiles; `FL-MSLR7KGR` recorded 22 macro-zone entries. |
| Complementary 20-zone positional-play model | **Implemented and observed, balance still open** | A separate mirrored 4×5 map explicitly distinguishes left/right wings, half-spaces and the centre. It governs finer in-possession relationships and half-space/front-five spacing while the 18-zone grid retains macro progression and territorial telemetry. `FL-MSLR7KGR` used all five lane categories across 81 targeted passes, including 25 half-space targets; it does not replace or compete with the 18-zone layer. |
| Make fake shot, stepover, roulette and flick-up tactically useful | **Implemented mechanically, needs human balance acceptance maybe need to remove roulette for now.** | Fake shots can wrong-foot defenders/keepers and burst through the chosen exit; stepovers move defender weight before the exit; roulettes protect against front/side challenges but not from behind; flick-ups evade committed low challenges but produce a less-controlled aerial contest. Distance, angle, timing, technique and awareness resolve the contest, with dedicated telemetry. Detailed limb hitboxes are not required for this first functional layer. |
| Difficulty changes intelligence rather than physics or outcomes | **Build 106 implemented; balance open** | Ultimate improves scanning, memory, coordination, decision selection and discipline. Difficulty-linked pace, press-speed, tackle-success, keeper-reach, keeper-reaction, pass-error, shot-error and first-touch advantages have been removed. Footballer ratings, pressure, body position and the shared rules resolve execution. |
| Remove the Isaac Wright result “scripting”/shot funnel | **Partially corrected; five-minute monitoring now required** | No hidden score script was found. Build 111 separates tactical chance creation from shared rating/context-led shot execution and removes difficulty accuracy bonuses. The first five-minute run had restrained team shot volume but Henry scored both Arsenal shots, so source-level scripting is absent while route/player concentration remains an explicit multi-match check. |
| Distinct positional behaviour systems for goalkeeper, CBs, full-backs, wing-backs, DMs, CMs, AMs, wide midfielders, wingers and strikers | **Build 107 position-specific passes now CPU-observed; full system still open** | Defensive territory ownership, card-aware contact execution and the strike-partner link now have current CPU evidence. The remaining blockers are goalkeeper human behaviour, repeated-match line integrity, Conte wing-back progression, ordinary give-and-go returns and human feel/visual acceptance. |

### Positional-system dependency clarification

The positional request is the implementation layer for several earlier rows rather than one additional isolated feature. It directly owns: purposeful beyond-ball runs, press/cover/screen coordination, zonal marking transfer, full-back and wing-back advancement, midfield triangles/recycling, winger lane use, striker partnerships and prevention of a single-player shot funnel. Those rows remain useful acceptance measurements, but should not produce separate competing patches.

## Presentation, identity and audio

| Request | Status now | Qualification |
| --- | --- | --- |
| Restore flat Nintendo-style FLARE faces and discard Connor's sculpted 3D face route | **Implemented, needs Josh's visual acceptance i want you to remove any more hair assets or anything liek that, and then give the players their respective skin colours, likeliness, height, weight, etc, i also want you to resize the mask and make it bigger on the head** | Flat front-mounted expression plates, enlarged shallow heads and referee/crowd variants exist. |
| Name the reaction system | **Proven in configuration** | FLARE = Football Legacy Animated Reaction Engine. |
| Referee reaction faces | **Implemented, needs visual acceptance ehhh i want more!** | Joke, decision and discipline moods exist. |
| Fans have faces; home/away supporters segregated and react by allegiance | **Implemented, needs match acceptance i dont like that they are the same sizer as before and smaller than the players. we need them to be propoortioned the same. matter of fact we need everything rescaled, thats probably contributing to the fucked up zippiness and all that jazz.** | Lightweight FLARE crowd faces and partisan sections/reactions exist. |
| Celebration roar, angry/boo and “whey” crowd sounds | **Implemented, mix/frequency unproven idk** | Event routes exist. |
| Audio on by default | **Partial due to browser policy idk** | Requested volume defaults to 70%. Firefox may still require one genuine click/controller action to unlock browser audio. |
| Bigger footballers and pitch/world; ball stays the same or smaller | **Implemented, needs visual acceptance i didnt even notice the change** | Pitch/stadium dimensions increased 4.5%, footballer meshes 6% and contact radius 6.25%; the ball collision/visual radii were slightly reduced. Movement was scaled with the world so spacing does not simply slow down. |
| Better ball physics | **Deferred by direction hasnt been done yet has it** | Explicit later milestone after the stable gameplay loop; this pass changes relative ball scale only and does not pretend to be the ball-physics overhaul. |
| Dry walkout: add hops, collisions, tackle reactions, fight trigger and genuinely different openings | **Build 173 shuffled six-beat opening implemented; visual acceptance open** | Every match load now generates an anti-repeat plan across tunnel, lineup, home/away player, keeper, referee, high/low/tracking and real pitchside-operator views. Hops, bounces and loosen actions are re-seeded. Collision/tackle/fight routes remain intact. |
| Completely revamp fight scene and prevent camera lock | **Partial** | Six-stage fight and camera-release guard exist; visual direction has not been accepted. |
| Goal replay through true net contact and then track scorer | **Build 173 four-beat route implemented; visual acceptance open** | The 8.4-second normal presentation uses a touchline operator, ball-flight view, behind-goal operator at true net impact and scorer track, with the strike/net section slowed and Cross/A or Space skip retained. |
| Varied CPU celebrations | **Implemented, match frequency unproven yeh its varied more now nice** | Eight choices with repeat avoidance exist. |
| Commentary | **Not implemented; correctly deferred** | Event vocabulary can feed a later commentary director, but no line selector, interruption model, voice library or audio layer exists. |

## Workflow and records

| Request | Status now | Qualification |
| --- | --- | --- |
| Log every game action and timed tester note | **Proven** | Log version 3 records detailed match events, annotations and summaries. |
| Export and review observed CPU-v-CPU matches | **Proven through persisted/embedded telemetry** | `FL-MSLWJJSA` remains the build-099 baseline. Five later build-100 observations (`FL-MSLXD2RU`, `FL-MSLXGKBA`, `FL-MSLXJ38A`, `FL-MSLXNVFZ`, `FL-MSLXS16W`) were read and reconciled. Browser Blob download remains less reliable than persisted-log recovery. |
| CPU-v-CPU as a selectable mode | **Proven** | Available in Quick Play and used in completed matches. |
| Do not run six games and overload the laptop | **Workflow rule in force** | Validation should use one active match/tab at a time. |
| Keep playtest menus and telemetry out of the match/stat view | **Build 107 fixed** | Logging, recovery and export remain automatic, but the large developer telemetry panel now requires the explicit `telemetryUi=1` diagnostic flag. Ordinary completed and recovered matches show the full football-stat table unobstructed. |
| Use one unambiguous human acceptance route | **Workflow rule in force** | Human reviews use the visible Quick Play setup and final confirmation screen. Raw engine URLs, self-tests and debug scenes remain developer diagnostics and must be labelled as such. |
| Call maps “stadiums” | **Implemented in user-facing terminology** | Some internal variable names remain legacy but the UI/config uses stadium. |
| Update GitHub and shared changelog | **Build 164 local candidate; publication intentionally waiting for Josh's next acceptance** | The latest corrective source and request log are complete locally. GitHub publication remains the final release action after Josh's next Quick Play review; the Google changelog is not being claimed current because it is outside this local workflow. |

## Latest consolidated validation — build 104

### Authoritative controller audit — `FL-MSM2G6IH`

- Quick Play, Single Player, Legendary, Arsenal Invincibles v Conte Chelsea, three minutes per half; Arsenal won 4–0.
- Josh says the active tackle system is materially better. Preserve the commit/contact behaviour and Costa-style aggression.
- Defensive intelligence still fails behind the tackle: Chelsea committed 11 fouls and received three red cards; challenge decisions need booking/risk awareness, while the full-back/line failed to shift across at minute 50.
- The 142 Chelsea marking transfers are **not** classified as good or bad from count alone. The next telemetry must record assignment duration, duplicate marks, abandoned danger and line integrity.
- Both rejected rear-arm foul reactions remain live: `appeal` supplies the bent/rear-arm version and `protestDrama` supplies the straighter variant. Actor orientation is also wrong.
- Human pass aim/receiver switching, free kicks, penalty pace/run-up, restart pause handling, foul/reaction presentation and goalkeeper movement all failed acceptance.
- Chelsea produced zero wide entries and zero crosses; three give-and-go attempts produced no return/completion. One third-player combination completed.
- The complete evidence and corrected repair order are in `FULL-AUDIT-build-104.md`.

- **125/125 automated engine checks passed** in the isolated final run, with no failed checks or runtime exceptions.
- That result is now treated as wiring evidence only. In particular, the rear-arm test checked aliases/config and did not validate the rendered cutscene.
- FIFA-style action power is now shown beneath persistent Home and Away footballer cards in the two bottom corners. The cards follow the carrier, restart taker or acting CPU footballer rather than remaining stuck on the starting player.
- Passes, through balls, lofted balls/crosses, shots, goalkeeper releases and set-piece strikes now expose their relevant action power. Direct free kicks also show a white useful-power marker so the user can judge dip, driven and curved delivery.
- The free-kick formation has been rebuilt: compact wall spacing, no attacking crowd around the goalkeeper, two runners, edge options and genuine short/recycle choices. The instruction strip now states LS aim, hold/release Circle, L1 driven, R1 curve and Cross for the short option.
- The shooting model no longer adds a one-direction aim error or treats goalkeeper contact as an automatic save. Power, placement, distance, keeper preparedness, reach edge and shot pace now resolve a contact chance; a beaten keeper can get a hand near the ball without magically stopping it.
- Targeted finishing calibration produces an 83.8% save chance for a weak central effort and 16.0% for a powerful, well-placed close finish. This is a starting balance, not human acceptance.
- Visual checks confirm both corner cards remain readable at kickoff and at a free kick, with the useful-power marker visible and the wall/attacking setup separated correctly.
- The one-active-tab rule remained in force. Existing Three.js undefined-colour warnings are still present, but the build generated no gameplay exception and no automated failure.

### Three-minute controller playtest — `FL-MSM18YGF`

- Quick Play, Single Player, Legendary, Arsenal Invincibles v Conte Chelsea, North London at night, Broadcast camera; 0–0.
- Arsenal had six shots, four on target and 1.19 xG; Chelsea had four shots, all on target and 0.75 xG. Both goalkeepers saved all four shots faced, including Henry chances at 0.42 and 0.25 xG. This exposed automatic goalkeeper contact as the immediate reason Josh could not score and directly caused the build-104 finishing change.
- Arsenal held 78% possession. Chelsea attempted 16 tackles and committed five fouls; Josh's timed notes praised the CPU build-up and one tackle, but still identified defensive tracking/sprint feel, through-ball magnetism, goalkeeper collection/release animation, fake-shot input timing, foul/replay clarity and free-kick presentation as open.
- Build 104 directly addresses the free-kick presentation and scoring/save-resolution blockers. The other timed notes remain recorded rather than being falsely marked complete.

### Still open after build 104

- **Human scoring feel:** confirm that strong, well-placed chances can now beat the goalkeeper without turning weak central shots into easy goals.
- **Defensive unit:** preserve the improved active tackles while adding card-aware risk, pressure-cover-screen support, lateral line shift and full-back positioning.
- **Aim assistance:** through balls should preserve the user's chosen lane and weight more strongly instead of over-selecting a receiver.
- **Receiver control:** calculate the likely receiver from trajectory/interception time and switch away from the passer.
- **Goalkeeper possession/movement:** stronger throws, better collection decisions and a readable running-with-ball-in-hands animation.
- **Input recognition:** fast loft-pass and fake-shot combinations need physical-controller confirmation and may need a larger input buffer.
- **Foul communication:** remove both rear-arm silhouettes, orient actors deliberately and add a reliable ordinary-foul replay route.
- **Set pieces:** fix pause/resume input, free-kick wall clearance/curve/shape, penalty pacing and taker run-up.
- **Replay director:** add ordinary fouls, saves to corners and missed shots.

## Previous consolidated validation — build 103

- **122/122 automated engine checks passed** in the isolated final run, with zero browser errors.
- The same full regression passed with **Co-op / Local 2P** configured as Controller 1 Home versus Controller 2 Away.
- **Same-Team Co-op** separately passed with both controllers assigned to Home and the CPU assigned to Away.
- The regression covers the current controller mapping, fake shots, vertical-flick stepovers, shielding, directional knock-ons, through/flair/aerial inputs, automatic-finish blocking, dives, shirt pulls, visible CPU challenge commitment, set pieces, goal-kick distribution, low-pace keeper ordering, live keeper-release shape, goalkeeper one-v-ones, all positional families, team shapes, combinations, zones, skills, fouls/falls, FLARE, stadium structure, audio policy and finite 3D geometry.
- Visual browser checks confirm all four match modes, the five Quick Play stages, controller arrow controls and the new dense Highbury-style street relationship.
- Validation followed the one-active-tab rule; no parallel matches were run.
- Earlier locked CPU baseline `FL-MSLWJJSA`: Chelsea won 1–0; 11 shots, 86 passes, 41/59 possession, 14 restarts without a loop, five keeper rushes and nine completed one-v-one decisions.
- Position-contract telemetry was reduced from 15,597 events in the first diagnostic match to 647 in the locked match while retaining phase/job changes and periodic state evidence.

### Latest controller-playtest diagnosis — `FL-MSLZWCAO`

- Quick Play, Single Player, Legendary, Arsenal Invincibles v Conte Chelsea; Josh stopped at minute 17 with Arsenal 2–0 ahead.
- Both goals were uncommanded Patrick Vieira volleys. The first had no Circle input, so it was not recorded as Josh's header; this directly caused the human-team automatic-finish prohibition.
- Chelsea completed only 2 of 6 passes, recorded no final-third entry or shot, and was out-possessed 7,097 ticks to 237. The wider CPU/team model therefore remains unaccepted even though its structural tests are green.
- The log recorded 46 CPU tackle attempts and 16 wins, exposing the old invisible/repeating instant-award path. Build 103 replaces it with commit → close → contact/miss.
- Timed notes also requested L2 shielding, easier unshielded rear dispossession, contextual CPU shirt pulls, L1+RS big touch and CPU slides; those routes are now implemented but explicitly await this next human match.

### Five-match Invincibles correction run

| Match | Result | Main evidence / correction |
| --- | --- | --- |
| `FL-MSLXD2RU` | Arsenal 0–0 Chelsea | Arsenal had no shots and no wide entry; identity repetition was overruling terminal football decisions. |
| `FL-MSLXGKBA` | Arsenal 0–1 Chelsea | Arsenal reached three shots, all on target, 0.83 xG and six final-third entries; Cole/Pires/Bergkamp/Henry relationships appeared. |
| `FL-MSLXJ38A` | Arsenal 0–1 Chelsea | Arsenal completed a third-player move and passed at 80%, but still took no shot; this led to the explicit terminal-finish guard. |
| `FL-MSLXNVFZ` | Arsenal 0–2 Chelsea | Arsenal produced four shots, all on target, and won xG 1.02–0.68; one low-pace reachable goal was flagged as a keeper error rather than treated as tactical failure. |
| `FL-MSLXS16W` | Arsenal 1–1 Chelsea | Balanced 6–6 shots and 0.665–0.841 xG. Pires scored from Henry; one further low-pace reachable equaliser exposed remaining keeper tuning. |

## Superseded or clarified requests

- “World Class by default” was replaced first by **Legendary**, then on 9 August by **Ultimate**.
- “Mute gameplay” was temporary and later replaced by **audio on by default**.
- Mourinho's first Chelsea was replaced by **Conte's 2016/17 Chelsea**.
- Player tendency/reputation for CPU dives was rejected for now; selection is **difficulty and context based**.
- “Player” is ambiguous in development notes; use **footballer**, **user-controlled footballer**, **CPU footballer** and **controller**.
- Automatic head-away is not a general human action: it is limited to **CPU defenders**, while a human uses Square for an eligible opposition cross/corner.
- “Only the nearest central midfielder may track inside” was not a confirmed timed instruction. The retained one-midfielder limit applies only to the **primary central outlet while the goalkeeper holds the ball**; it is not a general defensive tracking clamp.

## Build 164 release gate and next human acceptance

1. **Completed autonomous gate:** the existing team/position contracts, combinations, offside behaviour, box occupation, rest defence, dribble containment, blocks, free-kick routes, scale/stadium work and replay cameras remain in place; build 164 adds defensive danger ownership, loose-ball recovery and the expanded goalkeeper contract.
2. **Completed evidence gate:** 172/172 focused checks and two sequential five-minute Ultimate CPU-v-CPU matches passed without the `FL-MSMYG3U1` collapse. No parallel games were run.
3. **Next hand-off gate:** return human testing to the five-stage Quick Play menu—not a forced raw match—with Ultimate, North London night, normal audio and four-minute halves as the default package.
4. **Next human gate:** Josh physically reviews passing weight, defensive sprint/engagement, through-ball timing, CPU skills/dives, goalkeeper carry/low saves/recovery, the floor-axis fall, set-piece feel, reaction poses and North London art direction.
5. **Publication gate:** tune only failures shown by that fresh log and Josh's timed notes, update this truth table again, then publish the tested candidate to GitHub. Do not silently publish an unaccepted visual/controller pass.

## Recovered requests from Josh's 9 August line-by-line review

These items were missing, understated or falsely promoted in the earlier audit. Josh's wording in the status cells is the acceptance authority; a passing wiring test cannot override what appeared in play.

### Football feel and movement

- **Complete footballer-movement refinement is open.** Rebuild acceleration/deceleration, turning radius, inertia, momentum preservation, sprint-versus-jog separation, dribble touch cadence, change-of-direction cost and collision readability. Movement/game/animation speed must feel less zippy without hidden difficulty scaling.
- **First touch is its own contextual animation system.** Add different contacts for a rolling ball, bouncing ball, waist-height arrival, dropping aerial ball, driven pass and pressured reception; control outcome still comes from technique/control, body position, pressure, ball pace and timing.
- **World/proportion review is open.** Make footballers, stadium and surrounding world read larger relative to the ball, with crowd figures proportionate to footballers. Do not merely change reported scale values; Josh must be able to see the change.
- **Difficulty hard rule:** Ultimate must beat the user by disciplined positioning, scanning, coordination, choice and execution of the shared game—not pace buffs, reach buffs, outcome sliders or possession scripting.

### Defending and goalkeeping

- Preserve the improved physical tackle feel and authentic individual aggression, including Diego Costa, while rebuilding who engages in the defensive third. CBs/FBs/WBs must become the primary relevant challengers rather than leaving strikers and midfielders to do nearly all the work.
- Booking awareness is explicit: a yellow-carded CPU footballer protects the team, avoids rear/low-value challenges and accepts being bypassed unless the situation is a genuine goal emergency.
- The low-block/box-defence unit must allocate engager, cover, central screen, far-post/cutback protection and mark hand-offs separately from high press and midfield defending.
- Human goalkeeper possession locomotion must be normal responsive movement with a readable ball-in-hands run; CPU hold/release timing must not damp the human goalkeeper every frame.
- Goalkeepers still require a complete behaviour/animation pass: one-v-one hold/set/rush choice, loose-ball sweep, cross collection, forward smother, side/forward dive, catch/parry/block, recovery, faster distribution and team release shape.

### Controls, skills and aerial play

- Fake-shot recognition needs a larger/faster cancel window so fast Circle/Square then Cross does not leak an accidental kick. Rebuild the visible backlift/cancel/exit; a stationary fake may retain the long follow-through without forced movement.
- Stepovers are functionally chained but visually rejected. Legs must visibly orbit over the ball, alternating by facing/input, followed by a distinct exit touch; do not reuse fake-shot motion.
- Flick-up feel is rejected. Preserve the useful pop input but rebuild the approach/contact and context variants: knee, instep, outside foot and flick contacts that actually meet the ball.
- Shielding must visibly turn the body side-on rather than exist only as a tackle modifier. Directional knock-on still needs human feel acceptance.
- Roulette is a candidate for temporary quarantine while its usefulness/animation is rebuilt; it is not accepted merely because a route exists.
- Crosses from deeper areas, curve into the box and lob/cross flight require a dedicated refinement. The user must be able to intentionally trigger headers, volleys and flair aerial finishes; current wiring tests did not make those actions usable in play.
- Add the requested future side-on scoop trajectory to the speed-responsive slide-tackle set after the core defensive selection pass.

### Fouls, reactions, replays and restarts

- Both rejected rear-arm silhouettes—straight arm and bent arm—are hard-blocked from acceptance. Remove/quarantine every live alias and rendered branch, then validate screenshots of real foul scenes. Hands on head, hands raised, hands on face, head shake, laughter and grounded reactions need actual selection frequency.
- **Build 173 replay baseline implemented, Josh visual acceptance open:** ordinary/carded fouls, red cards, incident chains, stoppage dives, goals, misses and saves to corners share an event-specific director. It slows the decisive contact/ball beat, uses at least two of the physical pitchside-camera positions, permits Cross/A or Space skip, restores the correct restart and may include a recent successful contested skill only as a non-interrupting lead-in.
- Six visible broadcast camera operators occupy realistic ground-level touchline, behind-advertising/post-side goal-line and corner positions. Their rigs track play and each contains a real selectable viewport. Build 173 deliberately uses multiple operators in both replays and the shuffled anti-repeat walkout; normal-speed framing, scale and shot quality still require Josh.
- Referee-decision stoppages must not incorrectly freeze the match clock. Set-piece aiming/action time still runs at real-time speed. Pause/resume must never consume the pending kick.
- Free kicks remain an overhaul: shoulder-to-shoulder wall, location-aware attackers/defenders, direct shot and deep cross routes, visible default dip, R1 inside/outside curve around either side, L1 driven strike, useful power and readable held trajectory.
- Penalty sequence/readability remains open: slower preparation and run-up, whistle, power/aim feedback, chip pacing and a held post-kick angle.
- Goal kicks and all CPU restarts must select and accurately execute a real outlet using the same ratings/pressure rules, without forced perfect outcomes.

### Presentation and identity

- North London has not passed visual acceptance. The Highbury/Islington change must be unmistakable in the playable camera: stadium tight to continuous terraces/mansion blocks and streets, no Bristol-suburb green apron or generic tower skyline.
- Remove the unwanted hair/sculpted-head remnants for now. FLARE remains the flat-front Nintendo-like face language; enlarge the mask appropriately and assign real footballers recognisable skin tone, height, weight and simple likeness cues. Give the referee and supporters the same coherent face language.
- Crowd figures are too small. Home/away segregation, partisan reactions and faces remain, but people need believable footballer-relative scale.
- Walkout needs genuinely different camera angles and more varied player movement. Fight presentation and all close cutscenes remain visually unaccepted.
- Quick Play flow works, but the interface art direction remains too Microsoft Office-like and needs a stronger FIFA-era match-centre treatment after the core playable loop is stable.

## Current football-model architecture

Do not build nine unrelated AIs. Use one decision hierarchy so positional behaviour remains coordinated:

1. **Team state** — defensive phase, transition, build, advance, create or finish; current team shape and tactical identity.
2. **Unit responsibility** — defensive line, midfield line and attacking line keep useful spacing and exchange responsibilities together.
3. **Position module** — GK, <-- CB, FB, WB, DM, CM, AM, wide midfielder, winger or striker supplies the footballer's normal jobs and forbidden risks for the current phase and zone.
4. **Relationship layer** — pressure/cover, marking hand-off, overlap/underlap, pivot support, third-man run, strike partnership and box occupation are decisions between footballers rather than isolated destinations.
5. **Individual execution** — awareness, technique, pace, stamina, difficulty and pressure affect recognition, timing and quality without changing the underlying football logic.

Initial positional contracts:

- **Goalkeepers:** hold the line when defenders remain engaged, set and narrow the angle without charging, sweep only reachable loose balls, and rush only genuine broken-line close/heavy-touch threats where the keeper can arrive first.
- **Centre-backs:** hold/step/drop decisions, cover partner, protect depth and central lane, hand over marks, defend crosses, carry only when the next line is free, and choose safe progression versus clearance.
- **Full-backs:** balance the far-side rest defence with overlap/underlap, support width, press the opposing winger, pass a mark to the centre-back or wide midfielder, recover goal-side and defend the far post.
- **Wing-backs:** start deeper without the ball, become high outlets earlier than full-backs, combine with the inside forward, attack the back post on the far side and recover into the back five.
- **Defensive midfielders:** screen the centre, show for the first pass, protect an advanced full-back, turn or recycle according to pressure, switch play and track late runners without chasing the ball out of the pivot zone.
- **Central midfielders:** create passing triangles, stagger their heights, support both sides of the ball, execute third-man/give-and-go runs, counterpress locally and decide when one midfielder may enter the box while the other balances.
- **Attacking midfielders:** occupy pockets between lines, scan before receiving, turn when possible, bounce passes under pressure, combine around the box, make late runs and press the opposition pivot after loss.
- **Wide midfielders:** offer width but retain defensive-line responsibility, support the full-back, choose feet versus depth, cross/cut back and recover into the midfield line.
- **Wingers:** stretch or come inside according to the full-back relationship, isolate defenders, run behind, receive to feet, use contextual skills, attack the far post and lead wide pressing traps.
- **Strikers:** pin and separate centre-backs, check short then spin, run channels, coordinate two-striker movement, occupy near/central/far finishing lanes, lay off under pressure and trigger the first press without becoming a lone ball chaser.
