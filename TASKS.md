# TASKS: Pool 8-ball WebGL

Update on every chunk. Never mark `done` without a passing command or in-browser confirmation.

## Hygiene (mandatory)
- When a task is finished or no longer relevant, DELETE its entry below.
- Keep only: the current `in_progress` task + at most one user-confirmation bullet.
- No history, no "Done" section, no stale options — stale entries bloat context/cache.

## Active (in progress)
- Cue stick: rigid RECEDING instead of stretching; back-pull capped at half a stick
  (`C.CUE_MAX_RECED = C.CUE_STICK_LEN * 0.5`). Aim rotation is recomputed every frame
  from the live pointer so the cue tracks the cursor continuously while charging
  (no frozen "old" angle).
  - Files: `src/webgl3d.js` (`rec = power * Math.min(recMax, C.CUE_MAX_RECED)`; orientation
    from `dx/dy` each frame), `src/config.js` (`CUE_MAX_RECED`).
  - Verified headless: `node --check src/config.js && node --check src/webgl3d.js` OK;
    `node _test-cue-rotation.js` -> PASS 216/216; `node smoke-e2e.js` -> all [OK].
  - Tip stays between ball and finger at full power (rec <= 120 < POWER_MAX_DIST=240);
    on-screen cap (`recMax`) still prevents frame clipping. Temp helper `_fixcue.js` deleted.

## User confirmation (needed)
- Hard-reload in browser, charge the cue: it should slide straight back behind the ball
  without elongating, and its aim angle must keep following the cursor with no frozen
  rotation. Butt end must never leave the frame.

## Notes
- Headless only: visual changes stay "fixed-in-code" until the user confirms.
- English-only code text. Constants over magic numbers.
- Keep `ui.js` and `webgl3d.js` sign conventions in sync (reversed/monolith aim).
