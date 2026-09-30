# Poole — 8-ball. Design and project tasks

## 1. What changes
- Single-player 9-ball becomes a 2-player pool game: human + bot now, designed so that player vs player is added later without core changes.
- New rules: turn-based pool (see section 3).
- Refactor: the 642-line monolith in index.html is split into `src/` modules; no build step, still playable by double-clicking index.html.
- Existing physics and visuals are kept as-is; constants move from "magic numbers" to one config file.

## 2. File structure and load order

| File | Responsibility |
|---|---|
| src/config.js | All constants: table geometry (IX0..IY1, BR, pocket coordinates), physics (FRICTION, STEP...), shooting limits, ball colors, bokeh/UI settings. Loaded first. |
| src/vec.js | Vec2 math: add/sub/dot/normalize/hypot. |
| src/ball.js | Ball class: id/type/color, position/velocity, inPocket flag. Drawn by render. |
| src/table.js | Table object: boundaries, pockets, logical<->screen transform + resize (offX/offY/size). |
| src/physics.js | integrateStep(dt): friction, rail bounce, ball-ball collision, pocket capture. Tracks `firstContact` (foul check) and which balls were pocketed during the current shot. |
| src/rules.js | Turn machine: who shoots, "pocketed -> keep turn", fouls (scratch / no-ball contact), 8-ball win condition, group assignment after break, legal-ball HUD text. |
| src/player.js | `Player { type: 'human'\|'bot', name, group }`. Human reads the pointer only on his turn; bot stub. This abstraction is the multiplayer seam. |
| src/bot.js | Bot shot planner (see section 5). Difficulty as a parameter. |
| src/ui.js | Pointer/touch input only: drag → logical aim + power, fired via `P.UI.onFire(shot)`. HUD DOM text is owned by `game.js`. |
| src/render.js | Drawing: table+pockets+balls, aim overlay (stick, dashed line, target ring), screen shake. |
| src/game.js | Orchestrator: game state, shot cycle (start -> shoot -> settle -> resolve turn), calls rules + physics. |
| src/main.js | DOM setup, players [human, bot], rAF loop with fixed-step accumulator. |

index.html contains only the canvases/HUD and 12 `<script src="src/...">` tags in the order above. Classic scripts (shared `window.Poole` namespace), NOT ES modules: modules do not load over `file://` in Chrome/Edge, and double-click must keep working.

## 3. Rules (v1)
1. Two players take turns; you continue only if your shot pocketed a ball, otherwise the turn passes to the opponent.
2. Foul: cue ball pocketed -> cue ball re-spotted in the center, turn passes (no ball-in-hand in v1). Same handling when shooting without touching any ball ("miss" foul).
3. Pocket the black 8 -> game over, the shooter wins (only if no foul on that shot; scratch + 8 on one shot -> foul wins, 8 returns to play, turn passes).
4. Break: the human always breaks first. If a colored (solid/stripe) ball is pocketed on the break, the shooter chooses his group; if nothing or only the 8 is pocketed, groups are random; 8 from the break is re-spotted.
5. After the game ends -> click the table for a new game (same players, positions reset).

    ### Ball set (confirmed)
    - Standard **16-ball 8-ball**: 7 solids (1–7), 7 stripes (9–15), black 8; groups assigned after the break. The module structure matches "rules of pool" and is built accordingly (rack, colors/stripes, group logic all 16-ball).

## 4. Multiplayer-ready design
- All "who shoots" logic goes through the Player abstraction; physics/rules never know about human vs bot specifically.
- Later player-vs-player = a second human on the same screen (two inputs) or two screens; core code untouched.
- Physics is deterministic on the fixed STEP, so netcode is possible later: send the shot vector, the receiver gets the same trajectory frame for frame.

## 5. Bot (v1, heuristics)
- For each ball in own group x each pocket: target aim point = "ghost ball" position behind the pocket on the pocket->ball line.
- Checks: cue ball -> ghost has a clear line of sight (no other ball between); pocket angle after hit has margin > ~15 deg; required power is within limits.
- Score = margin angle - distance penalty; take the best shot above a threshold.
- No acceptable shot -> safe play: low-power push at the nearest own ball (never scratch on purpose).
- Difficulty = random angle jitter in the final aim vector (one parameter, easy/normal/hard).
- 0.6..1.4 s "thinking" delay before the shot so it is visually readable.

## 6. Physics details carried over from old code
- Fixed STEP = 1/60 + accumulator, max 8 steps/frame; friction `exp(-FRICTION*dt)`; STOP_SPEED freeze; ball-ball restitution 0.9 (5 positional passes); cushion E 0.85, TANGENT_KEEP 0.985.
- New vs old: per-shot bookkeeping — `firstContact` (cue hits a ball?) and `pocketedThisShot[]` — reset when a shot starts, read after the table settles (via `anyMoving()`).

## 7. Tasks (execution order)
1. src/ scaffolding + config.js, vec.js.
2. ball.js, table.js.
3. physics.js (migrate integrateStep; add firstContact / pocketedThisShot tracking).
4. rules.js (turn machine: pass on empty shot, scratch, 8 win, group assignment).
5. player.js + bot.js (Player abstraction, bot shot planner, difficulty).
6. ui.js + render.js (HUD, float messages, table/balls/aim drawing; aim overlay only for the current shooter).
7. game.js + main.js (state + rAF loop); rewire index.html to script tags.
8. Update README.md; delete _debug.js, _debug2.js, _probe.js (obsolete scratch harnesses).
9. Manual browser tests: human vs bot, break with pocketed ball, scratch + 8 on one shot, turn passing on empty shot.

## 8. Old-code debt to clean during refactor
- Dead "Ball-in-hand: click to pick up" HUD text with no implementation -> replaced by auto re-spot in the center.
- 9-ball legal order (1..9) and "8 returns to center" -> replaced by 8-ball rules.
- Cue stick aim helpers (`findAimPath`, `drawAim`) move to render.js, shown only for the human shooter; hidden during bot thinking.

## 9. Status (complete)
- All 12 modules implemented and loaded in browser order; the original monolith is gone,
  replaced by `src/` plus a thin `index.html` shell.
- Preserved visuals (in `src/render.js`): full-window bokeh, screen shake, glowing
  gradient balls with numbers/dots, wooden cue stick, dashed aim line + target ring,
  and rising text floats ("POCKETED!", "SCRATCH - foul", "… WINS!").
- **Reversed aim** kept (drag away from your target direction) to match the original feel;
  a dashed guide always shows the true shot line so it stays legible.
- Obsolete node debug harnesses (`_debug.js`, `_debug2.js`, `_probe.js`) deleted.
- Headless tests pass: `test-physics.js`, `test-rules.js`, `test-bot.js`, and
  `test-scaffold.js` (full load-order smoke test).
- Headless end-to-end (`smoke-e2e.js`) drives a full fixed-step render loop over the
  real table/physics and writes five well-formed SVG snapshots to the repo root
  as openable visual proof:
  - `snapshot-rack.svg` — clean 16-ball rack + six pockets.
  - `snapshot-aim.svg` — rack with cue stick, dashed guide and target ring.
  - `snapshot-after.svg` — post-break scatter (nine balls still on the table).
  - `snapshot-win.svg` — game-over dim overlay + "… WINS!" float; exercises the
    `drawGameOver` / `drawFloatMessages` render paths.
  - `snapshot-foul.svg` — "SCRATCH - foul" float with the cue re-spotted to centre.
- Final pixel-perfect check still needs a browser (double-click `index.html`):
  human vs bot, break with a pocketed colour, scratch + 8 on one shot, and turn
  pass on an empty shot.

## 10. Character viewer (added after main game)
- **src/character.js** — `P.Character.create({ ballId })` → `{ group, mode, morphT, setMode(m), setTransform("char"|"ball"), update(dt) }`.
  - Body: sphere from an existing game ball color (`CHAR_BALL_ID`, default `"11"` striped blue). Striped balls get a white equator band + canvas-rendered number badge at the back pole.
  - Face: two flat disc eyes (white sclera, dark iris, highlight) with a short blink squash; no mouth (kept minimal per design).
  - Feet: red sneakers (`SNK_UPPER_HEX` / `SOLO_HEX`) with white laces + toe cap, no legs — they sit on the floor and lift procedurally.
  - Hands: white gloves (fist sphere + 4 fanned fingers + inward thumb).
  - Animation: procedural idle (breathing scale, sway) and walk cycle (alternating foot lift, body bob, arm swing), blended by a `walkBlend` spring; blink on its own period.
  - Morph ball↔character: single spring (`MORPH_SPEED`) with per-part delays (eyes → gloves → sneakers) and an easeOutBack overshoot; parts hidden when scale < 0.01.
- **src/viewer.js** — `P.Viewer { open(onBack), close(), isOpen() }`. Own `#viewer-canvas` overlay (z-index 40, above the menu's 30) with a separate WebGL scene: floor + grid at y = FLOOR_Y, hemisphere light + shadow-casting directional light. No OrbitControls in the bundled three.min.js, so camera is custom: azimuth/polar/distance with drag rotate, wheel zoom (clamped CAM_START_D 235 → [90..420]), pinch on touch, gentle auto-rotate when idle. DOM overlay buttons: WALK/IDLE, BALL/CHARACTER, BACK TO MENU (+ Esc).
- **Wiring**: index.html loads `character.js` then `viewer.js` before `menu.js`; menu's 3rd button/key calls the `afterMenu` callback with `"viewer"`; main.js routes it to `P.Viewer.open(onBack)` (the bokeh backdrop loop keeps running underneath, hidden by the opaque viewer canvas); BACK TO MENU / Esc → `P.Menu.show(afterMenu)`.
- **Headless verification**: `test/character-viewer.smoke.js` stubs THREE + document and drives the character/viewer loops — model build, morph to/from ball, blink squash, walk lift, mode state, viewer open/close/reopen, no orphaned rAF.
