# Football Legacy Build 174 — Candidate 5 V2-only release checklist

Audited: 14 August 2026. Candidate 5 supersedes the published Candidate 4 cutover commit `662b08d` and PR #12.

## Binding playable-authority decision

- FL V2 is the only playable match authority in the main Football Legacy repository.
- The playable routes are Single Player, CPU versus CPU, and Set-Piece Suite.
- Local two-player, same-team co-op, and Online are visibly unavailable until they have complete V2 authority.
- No public selector, default, malformed URL, cached payload, unsupported mode, or runtime fault may start or fall back to the previous engine.
- A match starts only from an exact Candidate 5 V2 contract. Every other direct or constructed match request strict-stops before the simulation loop.
- Internal Build 173-named host scaffolding, reference hashes, adapters, fixtures, and sentinels remain solely because the live V2 composition and its regression evidence depend on them. They are not playable entry points or fallback authority.
- The separate `footballlegacy/fl-v1.5` forensic archive is not part of this cutover and remains untouched.

The binding policy is `research/overhaul/fl-v2-only-playable-authority-2026-08-13.md`. `research/overhaul/protected-workflows.json` is the machine-readable workflow matrix.

## Public entry-point contract

Publicly playable:

- `/quick-play/?mode=single-player&engine=fl-v2&candidate=5`
- `/quick-play/?mode=spectator&engine=fl-v2&candidate=5`
- `/quick-play/?mode=free-kick-suite&engine=fl-v2&candidate=5`

Unavailable rather than downgraded:

- Co-op / local two-player
- Same-Team Co-op
- Online versus

Entry-point requirements:

- Quick Play displays one fixed `FL V2 · Current` authority label and no engine selector.
- Root navigation exposes only the three V2 routes; unavailable modes are disabled notices.
- Online is a static migration notice with no PeerJS transport, host/join controls, iframe, or match launch.
- `match-engine/index.html` and desktop launchers route through Candidate 5 Quick Play, never a raw legacy match URL.
- The two-player launcher reports that the mode is unavailable.
- An exact match request contains one payload, Candidate 5 query markers, a matching uint32 seed, named teams, an exact controller envelope, and one of the three supported mode contracts.
- `v2Shadow`, Online markers, co-op controllers, missing payloads, duplicate payloads, stale candidates, previous-engine envelopes, and malformed team/controller data all fail closed.

## Candidate 5 cache boundary

- Quick Play application URL: `174-fl-v2-final-candidate-5`.
- Dynamically loaded V2 runtime URL: `174-fl-v2-final-candidate-5`.
- Quick Play writes `engine=fl-v2&candidate=5` to every supported match URL.
- Unchanged historical-squad and replay-export assets retain their previous content tokens; their bytes did not change.
- GitHub Pages previously served `Cache-Control: max-age=600`; public verification must use Candidate 5 URLs and compare bytes after merge.

## Frozen production hashes

The final manifest must match these SHA-256 values after the last edit:

- `match-engine/match.html`: `52e7a3d73d40305568cdd275b5f1bd11e03e718cdc549a66662acbd1b663a753`
- `match-engine/ball-engine-v2.js`: `e2b6776a12ebcf8353e322c181e2f38dbb18c1c41d10c1cebf134418a296a819`
- `match-engine/movement-engine-v2.js`: `e8848db45518ef54ed5cec5e65091160605decfb9995d23b9769395f1eafa0b3`
- `match-engine/dribbling-state-v2.js`: `84ae72d02125b2bdf273dc838258ce6b26d9dfe59d52e568e262d1550ab72a42`
- `match-engine/live-v2-authority-adapter.js`: `204dc528cfae88641c06d271a5a195f003ef9058f36ba3220587788d031ac521`
- `match-engine/live-v2-contact-authority-composer.js`: `15f87890f25012412dff34d1d8f0dcdf44694d14d107b859f260cde3c4e6c10b`
- `quick-play/app.js`: `d529c12f1d0032070e283eb328e45aec90c77057fe71dba5d7962c4cd2759c3a`
- `quick-play/index.html`: `31044b79e93b8a439aa2a0478df3bc6e45069c96b749366554dcf952936ed498`
- `quick-play/styles.css`: `ed49a7f9f80f876373c38feafa1599b3a1248faa513b39d67788f5221fc53532`
- `index.html`: `c89952fe449e8af8bfbb1b1ca00c856d880e3e809646928869719d3288adf772`
- `styles.css`: `a60b5b114ce5d41ddd4d54717dce27ce51ba5bea0fedf14e11d42da2010e40b4`
- `online/index.html`: `84085c9fcedbd70964d8f8c7705752418fe8a73165c4220b86beeb01fc9e09dc`
- `match-engine/index.html`: `ca35d6f816c652f569799072463c35563895573afd67122fc644d7688ad8cc61`

`research/overhaul/build-173-baseline-manifest.json` must validate every protected current byte while preserving baseline hashes as provenance.

## Verification gates

Required automated evidence:

1. V2-only public-entry scan: no selectable/default/fallback previous engine and no raw playable match link.
2. Exact-match preflight: supported contracts arm; every missing, stale, malformed, unsupported, shadow, Online, co-op, or prior-engine contract stops before animation/simulation.
3. Quick Play selection and launch: supported modes always resolve to V2 Candidate 5; unsupported modes cannot materialize a launch payload.
4. Root/launcher/Online gates: V2 routes only; unavailable modes remain inert.
5. Foundation/manifest and frozen-byte gates.
6. Single Player, CPU versus CPU, and Set-Piece Suite live-authority tests.
7. Passing, rendezvous, aerial, restart, free-kick, contact, discipline, dribbling, replay, match-control, movement, Ball V2, First Touch, and deterministic checkpoint regressions.
8. Inline match scripts and changed standalone JavaScript parse cleanly.
9. Browser smoke through the real Quick Play UI for all three routes, plus unsupported-mode and direct-invalid-link fail-closed checks.

Candidate 5 materially changes ground-ball and locomotion bytes, so the earlier four-seed CPU characterization is retained only as historical comparison and is not presented as current football-quality proof. The current release is based on repeated human acceptance of normal X, ordinary Triangle and locomotion, the MSSKHOQN directional-touch playtest, and current deterministic physical regressions. CPU intelligence remains a later refinement lane rather than a false release-closure claim.

## Curated commit boundary

Stage only the reviewed Candidate 5 authority, public-entry, manifest, documentation, and test files. Do not use `git add -A`.

Must remain unstaged:

- `tests/career-world-integrity-report.json`
- raw ball-physics captures and generated input ledgers
- unfinished offline V2 labs and browser labs
- Golden reconstruction/viewer experiments
- non-authoritative authority-kernel/boundary candidates
- local analysis tools and any research containing private machine paths

Before commit:

- inspect `git diff --cached --stat` and the full staged diff;
- verify no staged file has an unstaged overlap;
- scan staged additions for secrets, private paths, temporary paths, captures, archives, binary/media payloads, and oversized data;
- rerun `git diff --cached --check`;
- confirm the generated career report remains outside the index.

## Publication route

- Local branch: `agent/fl-v2-playtest`.
- Push explicitly with `git push origin HEAD:refs/heads/agent/fl-v2-playtest`; do not use its stale configured upstream.
- Open a pull request against `main`, record the exact Candidate 5 evidence, review the immutable PR delta, then merge.
- A local commit, branch push, or pull request is not publication. GitHub Pages is published only after merge to `main` and public-byte verification.
- After merge, verify HTTP 200 and SHA-256 equality for root, Quick Play, match page, V2 adapter/composer, and every newly referenced asset. Then run a final public Single Player launch using the Candidate 5 link.
- The GitHub CLI token was invalid at the last audit. Normal HTTPS push used the macOS credential path; PR creation/merge can use the signed-in GitHub browser if CLI authentication remains unavailable.

## Current status

- Candidate 5 production, cache markers and public-entry changes are local and unpublished.
- Human acceptance: normal X, ordinary Triangle and locomotion were explicitly accepted in the preceding playtests. MSSKHOQN accepted the light, strong and large directional-touch behaviours and requested only progressive MR drag/roll; the final curve preserves those gaps and has deterministic physical evidence, but has not been falsely relabelled as a post-change human replay.
- Current final-byte gameplay regression passed 185/185 after the final touch curve. Candidate 5 cache, preflight, public-entry and static integration validation passed 223/223 on the final pins.
- Local Candidate 5 browser smoke passed through the real Quick Play UI for Single Player, CPU vs CPU and Set-Piece Suite, each reaching FL V2 live with no console errors. The curated 54-path staged-index audit passed; the generated career report and every unrelated lab, capture, reconstruction and tool remain outside the index. Commit, push, PR, merge and Pages verification: pending.
