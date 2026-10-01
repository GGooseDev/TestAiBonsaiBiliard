# Poole — 3D Pool (Classic / Battle Arena / Viewer)

Vanilla-JS browser game. No build step, no bundler: **double-click `index.html`**.
Rendering is WebGL (Three.js bundled in `lib/`), not Canvas 2D. One menu offers three modes:
**Classic** (8-ball vs Bot), **Battle Arena** (turn-based Cue vs Balls), **Viewer** (character showcase).

## Run
- Double-click `index.html` (classic `<script src>` tags, so it works over `file://`).
- Menu: click a mode or press 1 / 2 / 3.

## Layout
`src/` — all logic on shared `window.Poole`.
- `config.js` constants (geometry, physics, shooting, bokeh, arena)
- `vec.js` Vec2 math · `ball.js` Ball · `table.js` bounds/pockets + logical<->screen transform
- `physics.js` integrateStep: friction/rails/collide/pockets; tracks firstContact + pocketedThisShot
- `rules.js` 8-ball turn machine (pass/foul/win/groups/legalIds)
- `player.js` Player {type:'human'|'bot', name, group} — multiplayer seam
- `bot.js` shot planner (ghost-ball + clear-line + margin)
- `ui.js` pointer/touch -> logical aim + power; fires via `P.UI.onFire(shot)`
- `noise.js` felt-noise shader source · `sound.js` WebAudio SFX (strike/pot/win/loss/foul)
- `character.js` P.Character: procedural ball-character (eyes/sneakers/gloves), idle+walk morph
- `viewer.js` P.Viewer: separate WebGL scene + custom orbit camera
- `menu.js` startup menu (3 modes) · `game.js` Classic orchestrator (state/shot cycle/HUD/bot pacing)
- `main.js` entry: canvas + backdrop rAF + menu -> mode handoff

`src/webgl3d/` — 3D renderer split into six ordered modules.
- `state.js` shared P._WebGL container + constants · `coords.js` coordinate/raycast helpers
- `assets.js` ball textures + bokeh floor · `init.js` scene/camera build + zoom wheel
- `draw.js` per-frame render: table/balls/aim/shake/floats + Arena char anchors & chase cam
- `api.js` public P.WebGL3D facade (ok/init/resize/draw/pop/screenToTableLogical/resetZoom/cueStickRec)

**Load order** (top→bottom in index.html): three.min.js → config, vec, ball, table, physics, rules, player, bot, ui, noise, webgl3d/{state,coords,assets,init,draw,api}, sound, character, viewer, menu, game, main.

## Tests (Node, headless)
- `test-scaffold.js` load-order smoke test (must not throw)
- `test-physics.js` collision / first-contact / pocket capture
- `test-rules.js` break, color-break, scratch, foul, win, group pass
- `test-bot.js` bot picks clear shots / fallback / null
- `_test-cue-rotation.js` cue-stick aim math (216 cases) · `_test-ball-rotation.js` rolling spin
- `_test_sound_node.js` WebAudio SFX · `_test_felt_noise.js` felt-noise shader
- `smoke-e2e.js` fixed-step render e2e → writes 5 SVG snapshots

## Arena status
Arena logic is complete (`src/arena.js`) and its rendering lives in `webgl3d/draw.js`,
but it is **not yet wired to the menu** — picking Battle Arena shows "Coming soon".
