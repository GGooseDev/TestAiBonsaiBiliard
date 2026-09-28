# TASKS: Pool 8-ball WebGL

Update on every chunk. Never mark `done` without a passing command or in-browser confirmation.

## Done
- [x] Cue extension math verified headlessly: butt moves 240 -> 400 units with power, tip fixed at ball edge. No bug in code.

## Fixed in code (needs browser confirmation)
- Cue aim direction: cursor was mapped via raycast to the felt plane, which biased aim near the ball (cue always pointed down). Now aim uses the cursor's on-screen offset from the projected ball (`_aimFromScreen` in `src/webgl3d.js`, `toLogical` and `lastAim` guard in `src/ui.js`).
- Headless check: all 4 directions and diagonals map correctly.

## Waiting on user
- Confirm in browser: drag the cursor near the cue ball up/down/left/right. The cue must point where you point, nose at the ball.
- Cue extension looks like it stops growing when aimed at a rail (butt goes past the rails and is clipped). Pick one:
  - B: cap recession inside the felt
  - C: add a power indicator (bar / brightening aim line)
  - D: lower `TILT_DEG` / reframe the camera

## Notes
- Headless only: visual changes stay "fixed-in-code" until the user confirms.
- English-only code text. Constants over magic numbers.
- Keep `ui.js` and `webgl3d.js` sign conventions in sync (reversed/monolith aim).