# Poole — 8-ball Pool (2-player: you vs Bot)

A two-player 8-ball browser game written in vanilla JavaScript (Canvas 2D).
You play against a built-in bot. No build system, no dependencies: **double-click
`index.html`** in any modern browser and play. The original single-file 9-ball
monolith has been split into small `src/` modules that share the `window.Poole`
namespace via classic `<script src>` tags (so `file://` + double-click still works,
which ES modules cannot do on Chrome/Edge).

## How to play

- **Aim is reversed** (faithful to the original): press and drag *away* from the
  direction you want the cue ball to travel. The cue-stick tip points at your
  finger; the ball flies the opposite way. A dashed guide shows the real shot
  line and rings the ball you would hit first.
- Power grows with pull distance (up to `MAX_SHOT_SPEED`).
- **Standard 8-ball rules:** you continue only after pocketing *your* group's
  ball (solids 1–7 or stripes 9–15). Foul = scratch (cue potted, re-spotted in
  centre) or shooting without touching any ball; the opponent then takes the turn.
- **Black 8** is the winner: pocket it on a clean shot to win. Pocketing it on
  the *same* shot you scratch the cue, you lose and the 8 returns to play.
- Human always breaks first. If you break and pot a solid/stripe you choose your
  group (SOLID / STRIPE buttons). Otherwise groups are assigned randomly.
- When the game ends, click the table (or the "Play again" button) for a new game.

## Project structure

```
test au/
├── index.html        # Thin shell: canvases + HUD + 12 <script src> tags. The only runnable file.
├── README.md
├── DESIGN.md
├── src/
│   ├── config.js     # Every constant (geometry, physics, shooting limits, colors, bokeh)
│   ├── vec.js        # Vec2 math: add/sub/dot/normalize/hypot
│   ├── ball.js       # Ball: id/type/color, position+velocity, inPocket flag
│   ├── table.js      # Boundaries + pockets; logical<->screen transform & resize
│   ├── physics.js    # integrateStep(dt): friction, rails, ball-ball, pockets;
│   │                 #   per-shot bookkeeping firstContact / pocketedThisShot
│   ├── rules.js      # Turn machine: pass/keep, fouls, 8-ball win, groups, legal IDs
│   ├── player.js     # Player {type:'human'|'bot', name, group} — the multiplayer seam
│   ├── bot.js        # Bot shot planner (ghost-ball + clear-line + margin, difficulty jitter)
│   ├── ui.js         # Pointer/touch -> logical aim + power; fires via P.UI.onFire
│   ├── render.js     # Drawing: bokeh, table, balls, aim overlay, shake, text floats, end screen
│   └── game.js       # Orchestrator: state, shot cycle (start->shoot->settle->turn), HUD
├── test-physics.js   # Node test: collision / first-contact / pocket capture
├── test-rules.js     # Node test: break, color-break, scratch, foul, win, group pass
└── test-bot.js       # Node test: bot picks clear shots / fallback / null
```

### Load order (top-to-bottom, each depends on the previous)

`config.js` → `vec.js` → `ball.js` → `table.js` → `physics.js` → `rules.js` →
`player.js` → `bot.js` → `ui.js` → `render.js` → `game.js` → `main.js`.

Classic scripts share one global `window.Poole`. Modules never mutate each other's
private state; `render.js` only reads `P.State`/`P.UI`/`P.Table` and draws.

## Preserved visuals

From the original Poole monolith, carried into `src/render.js` unchanged in feel:

- Full-window **ambient bokeh** behind a centred, scaled table (no second canvas).
- Green felt + dark wood border + grain lines + six pockets.
- Glossy gradient balls with shadow, numbers (8 shown light), and cue-ball dots.
- A **wooden cue stick** drawn with the aim, plus a dashed trajectory line and a
  yellow target ring on the predicted contact ball.
- **Screen shake** (a few pixels) on every pot / scratch and a win.
- Rising **floating text** messages ("POCKETED!", "SCRATCH - foul", "… WINS!").

## Physics constants (easy to tune — all in `src/config.js`)

| Name | Meaning | Default |
|---|---|---|
| `BR` | ball radius | 14 |
| `POCKET_R`, `CATCH_EXTRA` | pocket radius / catch margin | 27, 8 |
| `FRICTION` | per-step velocity decay | 0.9 |
| `STOP_SPEED` | speed threshold to freeze a ball | 30 |
| `BALL_RESTITUTION` | elastic ball–ball impulse | 0.9 |
| `CUSHION_E`, `TANGENT_KEEP` | rail bounce / tangential damping | 0.85, 0.985 |
| `STEP` / `MAX_STEPS_PER_FRAME` | fixed timestep / cap | 1/60, 8 |
| `MAX_SHOT_SPEED`, `POWER_MAX_DIST` | shooting power limits | 1240, 240 |

## Testing (Node only)

All logic lives in pure modules so it runs headless under Node. Run from the project root:

```bash
node test-physics.js      # physics + first-contact + pocket capture
node test-rules.js        # rules engine (break, fouls, win, groups)
node test-bot.js          # bot planner decisions
node test-scaffold.js     # loads all modules in browser order; must not throw
node smoke-e2e.js         # fixed-step render-loop e2e + writes 5 SVG snapshots
```

The "Scaffold OK" line means every module defines its expected API in the same
load order the browser uses — the closest thing to a load-time smoke test.
The five files written by `smoke-e2e.js` — `snapshot-rack.svg`, `snapshot-aim.svg`,
`snapshot-after.svg`, `snapshot-win.svg` and `snapshot-foul.svg` — open in any
browser as static visual proof of the table, balls, aim overlay, game-over screen
and foul float. Final pixel-perfect confirmation still needs a browser (double-click
`index.html`).
