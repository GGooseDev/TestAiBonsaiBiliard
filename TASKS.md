# TASKS: Pool 8-ball WebGL

Update on every chunk. Never mark `done` without a passing command or in-browser confirmation.

## Hygiene (mandatory)
- When a task is finished or no longer relevant, DELETE its entry below.
- Keep only: the current `in_progress` task + at most one user-confirmation bullet.
- No history, no "Done" section, no stale options — stale entries bloat context/cache.

## Active (in progress)
- Aim trajectory look: geometry was already correct (verified via [AIMDBG] logs: line starts on the
  cue-ball front surface `cue.x + dx*C.BR` and ends at the struck ball's near-surface first-contact
  point), but it read as one solid rod passing through the white ball because the yellow cylinder is
  collinear with the cue stick, the ball is only ~14px on screen, and while charging the stick tip
  recedes from the ball. Fix: render the trajectory as a DASHED line — `aimLineMesh` replaced by a
  `THREE.Line` + `LineBasicMaterial(0xffe86b)` built per frame by `setAimDash(a, b)` into world-space
  dash segments (`C.AIM_DASH=9` / `C.AIM_GAP=6` world units); start still at the ball surface, end
  unchanged; solid cylinder mesh and `orientAlong()` helper removed.
  - Files: `src/webgl3d.js` (version marker -> `20260929-aimdash`; `setAimDash()` helper; aimLineMesh
    creation ~line 682; draw() aim block call site ~line 821); `src/config.js` (+`C.AIM_DASH`,
    `C.AIM_GAP`); `index.html` (cache-buster `?v=20260929b`).
  - Verified headless: `node --check src/webgl3d.js` OK; `node smoke-e2e.js` -> all [OK];
    dash-builder sanity check (long line: dashes from t=0 to full length, short line: one dash,
    zero length: fallback) OK. No `orientAlong` references remain in code. Rendering-only change —
    no headless WebGL check exists; needs user in-browser confirmation.

## User confirmation (needed)
- After a no-line report: `src/config.js` had no cache-buster and was likely served from browser cache without the new `C.AIM_DASH`/`C.AIM_GAP` constants → dash coords NaN → invisible line. Added `?v=20260929b` to config.js too (index.html). User must hard-reload; corner label must say `webgl3d 20260929-aimdash`. If still no line, send any red F12 console errors.

## Notes
- Headless only: visual changes stay "fixed-in-code" until the user confirms.
- English-only code text. Constants over magic numbers.
- Keep `ui.js` and `webgl3d.js` sign conventions in sync (reversed/monolith aim).
