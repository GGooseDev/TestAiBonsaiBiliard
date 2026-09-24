# Poole — 9-ball (1 player)

A single-player 9-ball browser game written in vanilla JavaScript (Canvas 2D). No build system, no dependencies: open `index.html` in any modern browser and play.

## Project structure

```
test au/
├── index.html          # The only runnable file. Whole game lives inside one IIFE script tag.
├── _probe.js           # Node debug harness: runs the game script in a vm sandbox, exposes window.__g.
├── _debug.js           # Node debug harness (variant with more exposed state).
└── _debug2.js          # Node debug harness (synchronous getter exposed at IIFE end).
```

### index.html
Everything the game needs is in one file:

1. **HTML/DOM** — a full-window `#game` canvas (buffer size = window size, table scaled/centered inside it) plus an invisible `#bg` canvas for the ambient bokeh background. Fixed-position HUD (`#status`, `#nextBall`) and a footer hint.
2. **Single `<script>` IIFE** — all logic is private to this closure. Top-to-bottom layout:
   - **Constants / config** — table geometry (`CANVAS_W/H`, rails `IX0..IY1`), ball radius `BR`, pocket size, physics constants (friction, restitution, steps per frame), power/shooting limits, cue-stick sizes, bokeh settings, ball colors, pocket coordinates.
   - **Game state** — `balls[]`, `cueBall`, `legalNum`, `freeReturn`, `gameOver`, `shotInMotion` (derived, never sticky).
   - **Physics** (`integrateStep(dt)`):
     - integration with exponential friction and fixed timestep (`STEP = 1/60`, accumulator in `loop()`),
     - pocket capture (`pocketIndexFor`),
     - rail bouncing (cushion restitution + tangent keep, fired only on real penetration),
     - ball–ball resolution: 5 passes of positional separation + elastic impulse in the separating direction.
   - **Game rules** (`sinkBall`, `processFreeReturns`, `resetGame`, `anyMoving`):
     - balls 1..9 must be pocketed in order;
     - black 8 is special — pocketing it never ends the game, it is re-spotted after the table stops;
     - cue ball pocketed or illegal pocket → ball returns to play once the table is settled.
   - **Input / aiming** (`toCanvas`, `mousedown/mousemove/mouseup`, `findAimPath`, `drawAim`): reversed aim (pull away from the target direction), power = pull distance clamped by `POWER_MAX_DIST`; the cue stick is drawn behind the ball, target ball is ringed, dashed trajectory is drawn in front.
   - **Rendering** (`render`, `drawBgFull`, `drawTable`, `drawPocket`, `drawBall`, `drawFloatMessages`, `resize`) — full-screen bokeh, felt + wood border, balls with gradient + numbers, shake on pockets, floating messages.
   - **Main loop** (`loop(ts)`) — fixed-timestep accumulator, max 8 physics steps per frame, derived "in motion" check, free-return processing, `requestAnimationFrame` tail inside the IIFE (the exact `requestAnimationFrame(loop); ... );` tail is what the debug harnesses anchor on).

### Debug harness files (`_*.js`, Node only)
Scratch tools for headless inspection of the game (not part of gameplay):
- all three read the `<script>` block out of `index.html`,
- execute it in a `vm` context with fake `document` / `window` / `performance` / canvas,
- patch the script (near its end) to expose live internals (`window.__g` or `__gGetter`) so a debugger console can read state while feeding synthetic frames via a local `tick()`.

Run: `node _probe.js` (or the other two). They only work on a Linux/Windows node with no browser required.

## How to play
- Press and drag from near the cue ball, release to shoot. Aim is reversed — the cue ball flies in the direction **opposite** to your pull.
- Power grows with pull distance (up to `MAX_SHOT_SPEED`).
- Pocket balls 1→9 in order; legal ball is shown in the HUD.
- Black 8: pocketing it is safe, it returns after the table settles.
- Game over screen: click the table to start a new game.

## Physics constants (easy to tune)
| Name | Meaning | Default |
|---|---|---|
| `BR` | ball radius | 14 |
| `POCKET_R`, `CATCH_EXTRA` | pocket radius / catch margin | 27, 8 |
| `FRICTION` | per-step decay of velocity | 0.9 |
| `STOP_SPEED` | speed threshold to freeze a ball | 30 |
| `BALL_RESTITUTION` | elastic ball–ball impulse | 0.9 |
| `CUSHION_E`, `TANGENT_KEEP` | rail bounce / tangential damping | 0.85, 0.985 |
| `STEP` / `MAX_STEPS_PER_FRAME` | fixed timestep / cap | 1/60, 8 |
| `MAX_SHOT_SPEED`, `POWER_MAX_DIST` | shooting power limits | 620, 240 |
| `COLLIDE_PASSES` | collision-resolution iterations | 5 |
