# DARTY

Joe's browser football game: play football, land two separate hard contacts, and watch a toy head or leg pop off.

This is a separate private project based on Football Legacy. Joe's lesson notes and family records are kept outside this repository.

## Run locally

Serve this folder with a static web server, then open `index.html` for all game modes or `darty.html` for the DARTY introduction. For example:

```sh
python3 -m http.server 4331 --bind 127.0.0.1
```

Open http://127.0.0.1:4331/ in a desktop browser. Single-player supports keyboard or a compatible controller. Career saves stay in that browser.

## Current Career boundary

Career still uses its inherited statistical match simulation and animated timeline. It is not yet connected to the later browser Sim Lab's live V2 simulation or playable matches. Quick Play runs the V2 match engine with DARTY's two-hit mechanic. Do not treat Career's moving dots as proof of that connection.

## Checks

```sh
node --test tests/darty-impact-v1.mjs
node tools/verify-darty-browser.mjs
```

The browser check requires Playwright and Chrome, with the local server running. `PLAYWRIGHT_MODULE`, `DARTY_BASE_URL` and `DARTY_PROOF_DIR` override the module path, server and output folder. The presentation fixture checks flight, pause, landing and reset; it is separate from ordinary match gameplay.

## Source

The starting point is Football Legacy commit `0e3ff010b65668fe0144f99cd65a1f21695f7332` (14 August 2026). Its history is preserved. `upstream` is retained for reference with pushing disabled; `origin` is `joshtoucanlearn/darty`.

See [the baseline notes](FOOTBALL-LEGACY-BASELINE.md) for the inherited engine and mode boundaries, and [the changelog](CHANGELOG.md) for DARTY changes.

## Joe's website playtest

Quick Play is published through Joe's existing GitHub Pages website at https://joshtoucanlearn.github.io/os-joe/darty/. The separate DARTY source repository remains private. Career is not included in that playtest export.

To refresh the website's runtime from this checkout, run:

```sh
python3 tools/export-joe-playtest.py ../joe-os/public/darty
```

Then build and publish `joe-os` following its README. The export copies the Quick Play and match scripts unchanged, includes their asset dependencies, and records file hashes and the source commit in `playtest-build.json`. It excludes teaching records, research notes and repository history.
