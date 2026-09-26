# Football Legacy — Build 174 Candidate 5

## DARTY local branch (not published)

This isolated clone also contains Joe's DARTY experiment. Open `darty.html` locally through a static server to launch a match with cartoon toy-part pop-offs after two separate hard winning contacts against the same player. The DARTY changes are not on the public Football Legacy site, and the Football Legacy description and links below document the August 14 source baseline rather than a DARTY release.

To check DARTY, run `node --test tests/darty-impact-v1.mjs`. With a local server running on port 4331 and Playwright available, `node tools/verify-darty-browser.mjs` checks both detached parts, pause, landing and reset. Set `PLAYWRIGHT_MODULE` to an installed Playwright module path if needed; `DARTY_BASE_URL` changes the server URL and `DARTY_PROOF_DIR` changes the screenshot/evidence folder (default `/tmp/darty-browser-proof`). This is a deliberately instrumented rendering fixture, separate from ordinary match gameplay.

Football Legacy is a browser football game prototype with FL V2 Quick Play, historic teams, creation tools, Career Mode and Grassroots to Glory.

## Play the current game

Open **[Football Legacy](https://footballlegacy.github.io/football-legacy/)**, choose Quick Play and launch one of the three released match workflows:

- Single Player.
- CPU vs CPU.
- Set-Piece Suite.

FL V2 is fixed as the sole playable match engine. There is no previous-build selector, default or fallback. Local two-player, same-team Home Co-op and Online Versus are unavailable until each has complete V2 authority; selecting or opening those routes cannot launch the previous engine.

Candidate 5 completes the accepted normal-X and ground-Triangle weight calibration, restores direct rated turning, and gives the light, strong and double-flick sprint touches distinct physical gaps with progressive MR turf drag. The ball now skids, rolls and settles naturally instead of using the distant directional-touch safety ceiling as a brake. Pass aim, timing, physical interception, independent player reading and ownership remain player- and geometry-authored.

The Invincibles, Conte Chelsea and Ancelotti's representative 2013/14 Real Madrid BBC squad remain available. Their ratings are Football Legacy playtest values, not official EA ratings.

## V2 safety boundary

A match launches only when its supported workflow, V2 query, V2 payload, ownership model and deterministic seed agree exactly. Missing, malformed, contradictory, unsupported, direct or stale launch data fails closed before simulation.

If a live V2 authority transaction fails, the candidate tick is rolled back and the match stops behind an exportable diagnostic screen. It does not execute a previous-engine tick.

Internal Build 173-named adapters, hashes, fixtures and tests may remain as non-playable provenance or host compatibility. They are not a hidden game option. The separate FL V1.5 forensic archive is untouched and is not bundled as a Candidate 5 fallback.

Read `research/overhaul/fl-v2-only-playable-authority-2026-08-13.md` for the binding release contract.

## Controller playtest

Connect one DualSense or compatible controller, then open Quick Play or double-click `START-PS5-SINGLE-PLAYER.command`. USB-C is the verified DualSense route. Bluetooth can appear connected without delivering input on some Mac/browser combinations and is not claimed fixed.

The two-player launcher and the Online shell are intentionally unavailable while those modes lack V2 authority.

Menu controls:

- D-pad or left stick: move focus.
- Cross/A: select.
- Circle/B: back.
- Options: pause during a match.

## Match controls

- Left stick: move.
- R2: sprint.
- Cross/A: pass.
- Circle/B: shoot or standing tackle; on an authored cross it requests a header/volley finish, while the physical contest decides who reaches the ball. Rapid defensive taps pull a shirt.
- Square/X: lob pass or slide tackle.
- Triangle/Y: through pass; L1/LB + Triangle/Y sends it over the top.
- L1/LB: nearest-player manual switch when defending.
- R1/RB: finesse-shot modifier and curved free-kick modifier.
- L2/LT: shield/flair modifier.
- D-pad Down: contextual dive.
- R3: flick the ball up.
- L2/LT + right-stick vertical flick: chained stepovers.
- Right-stick down half-circle: roulette.

At a free kick, Cross/A gives a grounded pass inside the selected left-stick and power channel. Square/X gives the aerial service, R1/RB + Square/X gives a lower, faster ball, and L1/LB + R1/RB + Square/X gives the driven delivery. Corners and goal kicks use the same directional Square/X service family. Direct free-kick shots remain on Circle/B with their dipping, driven and curved modifiers.

Read `research/overhaul/set-piece-directional-camera-runup-closure-2026-08-12.md` for the current set-piece controls and visual evidence, and `PLAYTEST-NOTES-v0.28.6.md` for the historical visual-pass record.

## Development

The game is build-free: edit the HTML, CSS and JavaScript files, then reopen the supported Quick Play route. `match-engine/match.html` is the shared V2 host, but opening it directly without the exact launch contract must stop rather than start a match. Shared controller menu navigation lives in `controller-ui.js`.

Read `JOSH-HANDOFF.md` before changing gameplay systems.
