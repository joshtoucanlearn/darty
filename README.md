# DARTY

Joe's browser football game: play football, land two separate hard contacts, and watch a toy head or leg pop off.

This is Joe's separate public project based on Football Legacy. Joe's lesson notes and family records are kept outside this repository.

## Play online

Open [DARTY](https://joshtoucanlearn.github.io/darty/darty.html), choose **Set up a DARTY match**, and follow the team and match setup. No account or download is needed. Joe's website arcade links directly to this game.

For today's playtest, use Quick Play. Career remains separate from the playable match engine, as described below.

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

## Publishing

GitHub Pages serves the root of the `main` branch. Push game updates to this repository and wait for the Pages deployment to finish. The stable playtest link is https://joshtoucanlearn.github.io/darty/darty.html.
