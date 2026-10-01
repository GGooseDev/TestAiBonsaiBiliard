# Poole — Design & architecture

## 1. Architecture
- Vanilla JS, no build/bundler. Shared global `window.Poole`. Classic `<script src>` tags (not ES modules) so double-click / `file://` still works.
- Rendering is WebGL via bundled Three.js (`lib/three.min.js`), **not** Canvas 2D. All drawing lives in the six `src/webgl3d/` modules; logic never touches THREE directly.
- Headless-safe: every module guards for missing THREE/document so Node tests can `require()` them.

## 2. File structure & load order
| File | Responsibility |
|---|---|
| src/config.js | All constants: geometry, physics, shooting limits, ball colors, bokeh/UI, arena (ARENA_*). Loaded first. |
| src/vec.js | Vec2 math: add/sub/dot/normalize/hypot. |
| src/ball.js | Ball: id/type/color, position/velocity, inPocket flag. |
| src/table.js | Table: boundaries, pockets, logical<->screen transform + resize. |
| src/physics.js | integrateStep(dt): friction, rail bounce, ball-ball collision, pocket capture. Tracks firstContact (foul) and pocketedThisShot[] per shot. |
| src/rules.js | 8-ball turn machine: pass/keep, fouls, 8-ball win, group assignment, legal IDs. |
| src/player.js | Player {type:'human'\|'bot', name, group}. Multiplayer seam. |
| src/bot.js | Bot shot planner (ghost-ball + clear-line + margin). |
| src/ui.js | Pointer/touch -> logical aim + power; fires via P.UI.onFire(shot). HUD DOM owned by game.js. |
| src/noise.js | Felt-noise shader source. |
| src/webgl3d/state.js | Shared P._WebGL container + constants (loaded first of the six). |
| src/webgl3d/coords.js | Coordinate/raycast helpers: screenToTableLogical, aim-from-screen, firstContact. |
| src/webgl3d/assets.js | Ball textures + bokeh floor builder. |
| src/webgl3d/init.js | Scene/camera build + zoom wheel handler. |
| src/webgl3d/draw.js | Per-frame render: table/balls/aim/shake/floats + Arena char anchors & chase camera. |
| src/webgl3d/api.js | Public P.WebGL3D facade (ok/init/resize/draw/pop/screenToTableLogical/resetZoom/cueStickRec). |
| src/sound.js | WebAudio SFX: strike, pot, win/loss, foul. |
| src/character.js | P.Character: procedural ball-character + idle/walk morph (see §8). |
| src/viewer.js | P.Viewer: separate WebGL scene + custom orbit camera (see §8). |
| src/menu.js | Startup menu (Classic / Battle Arena / Viewer). |
| src/game.js | Classic orchestrator: state, shot cycle (start->strike->settle->turn), HUD, bot pacing. |
| src/main.js | Entry: canvas + backdrop rAF; routes menu pick -> P.Game.start / P.Viewer.open. |

Load order: three.min.js → config, vec, ball, table, physics, rules, player, bot, ui, noise, webgl3d/{state,coords,assets,init,draw,api}, sound, character, viewer, menu, game, main.
`src/arena.js` is **intentionally not loaded** yet (Arena is "Coming soon" — see §7 / §9).

## 3. Classic rules (8-ball)
1. Two players alternate; you keep the turn only if your shot potted a ball of your group.
2. Foul = scratch (cue respotted to centre) or shooting without touching any ball → turn passes.
3. Black 8 on a clean shot wins; scratch + 8 on one shot loses, 8 returns to play.
4. Human breaks first; potting a colour on break lets you choose SOLID/STRIPE (else random).
5. Game over → click the table / "Play again".

## 4. Multiplayer seam
- All "who shoots" flows through the Player abstraction; physics/rules never see human-vs-bot directly.
- **Current Arena constraint:** a human controls exactly ONE character ball at a time (`state.activeCharIdx`, Tab to switch). Deliberately minimal so a future multiplayer (two humans, two inputs/servers) can be added without core changes.
- Deterministic fixed STEP → netcode path: send the shot vector, receiver replays identical trajectory.

## 5. Bot (v1 heuristics)
Ghost-ball aim + clear line-of-sight + >~15° pocket margin; score = margin − distance penalty. No clean shot → safe low push (never intentional scratch). Difficulty = angle jitter (one param). 0.6–1.4 s think delay with a visible aim preview.

## 6. Physics (carried over)
Fixed STEP=1/60 + accumulator, max 8 steps/frame; friction 0.9, STOP_SPEED 30, restitution 0.9 (5 positional passes), cushion E 0.85 / TANGENT_KEEP 0.985. Per-shot bookkeeping: firstContact + pocketedThisShot[], reset at shot start, read after `anyMoving()` settles.

## 7. Battle Arena (turn-based "Cue vs Balls")
`src/arena.js` → `P.Arena { state, isActive(), start(canvas, onBack), end() }`. Headless-safe.
- **Teams:** human picks CUE or BALLS. Cue wins by potting all characters before the turn limit; Balls win by surviving it.
- **Constants** (config.js): ARENA_CHAR_COUNT=3, ARENA_MAX_TURNS=10, ARENA_MOVE_TIME_MS=5000, ARENA_CHAR_SPEED=120.
- **Phases:** teamSelect → break → ballMove → cueShot → gameOver.
  - *break:* cue auto-breaks the rack.
  - After break: `spawnChars()` picks 3 surviving object balls → characters (`P.Character.create`); none left → Cue wins immediately.
  - *ballMove* (5 s/turn): human=BALLS controls one char with WASD/arrows + Tab switch; other chars bot-wander to random spots (separated so they never overlap). human=CUE: all chars wander, human aims the cue.
  - *cueShot:* human=CUE shoots via pointer (`P.UI` + screenToTableLogical); human=BALLS → bot fires (`P.Bot.bestShot` at the characters).
  - After each shot: cue potted → respot; all chars potted → Cue wins; turns exhausted → Balls win; else next ballMove.
- **Rendering** (in `webgl3d/draw.js`): `_syncChars()` positions per-character `THREE.Group` anchors to follow their balls and hides the plain ball mesh for char ids; `_applyArenaFollow()` drives a **third-person chase camera** behind/above the active character during ballMove when human=BALLS.

## 8. Character & Viewer
- `P.Character.create({ballId})` → `{group, mode, morphT, setMode(m), setTransform("char"|"ball"), update(dt)}`. Body = a real ball colour (+ stripe band + back number badge); face (2 disc eyes + blink), red sneakers with laces/toe cap, white gloves.
- Animation is **procedural, no keyframes**: idle (breathing scale, sway, blinks) + treadmill walk cycle (alternating foot lift/stride, body bob, arm swing), blended by a spring; **morph ball↔character** is a staggered spring pop (eyes → gloves → sneakers) with easeOutBack overshoot.
- `P.Viewer.open(onBack)` — separate WebGL scene (floor+grid, custom orbit cam: drag rotate, wheel zoom, pinch, idle auto-rotate). Overlay buttons WALK/IDLE, BALL/CHARACTER, BACK TO MENU (+Esc).

## 9. Status
- **Classic** fully active; **Viewer** active; **Battle Arena** logic + rendering complete but **not wired to the menu** (shows "Coming soon"). Next step: add `arena.js` to index.html and route the menu button through `P.Arena.start(canvas, onBack)`.
- Headless tests pass: test-scaffold, test-physics, test-rules, test-bot, cue/ball rotation, sound-node, felt-noise; smoke-e2e writes 5 SVG snapshots.
