# TASKS: Pool 8-ball WebGL

Update on every chunk. Never mark `done` without a passing command or in-browser confirmation.

## Hygiene (mandatory)
- When a task is finished or no longer relevant, DELETE its entry below.
- Keep only: the current `in_progress` task + at most one user-confirmation bullet.
- No history, no "Done" section, no stale options — stale entries bloat context/cache.

## Active (in progress)
- Felt covering texture generated procedurally with mathematical noise (no image assets). New
  pure-math module `src/noise.js` exposes `P.Noise.sampleFelt(u,v)`: seeded mulberry32 PRNG +
  seamless period-1 2D value noise, fBm over two layers (broad dye mottle freqs [3,5]; wool-pile
  grain freqs now [32,64,96] for chunkier speckles), mapped to the old flat `0x346941` tint. In
  `src/webgl3d.js`, `makeFeltTexture()` paints it into a 256x256 canvas -> `THREE.CanvasTexture`
  with `RepeatWrapping` + `repeat(2,1)` (scaled up from 4x2, ~5 logical-unit grain across the
  932x492 felt; no seams because noise is period-1). Contrast raised: brightness factor
  `(0.82+0.36*m)*(0.94+0.12*g)` (mean stays ~1.0, wider tonal range). Felt material `{color:
  0xffffff, map:feltTex, roughness:0.95}` so the texture's own green shows through; ball shadows
  still land on it.
  - Files: `src/noise.js` (grain freqs -> [32,64,96], k formula widened); `src/webgl3d.js`
    (`WEBGL3D_VERSION` -> `20260929-feltbig`; `tex.repeat.set(2,1)` ~line 591; feltMat -> `map`);
    `index.html` (cache-buster now `?v=20260929e`).
  - Verified headless: `node --check src/webgl3d.js` OK; `node _test_felt_noise.js` ->
    PASS=13696 FAIL=0 (range [0,255] integers, period-1 seamlessness on x and y, determinism,
    value noise in [0,1]). Earlier browser bug (`createImageData(S,S,4)` -> "not of type
    ImageDataSettings") fixed by dropping the stray `,4`. Needs user in-browser confirmation.

## User confirmation (needed)
- Hard-reload (Ctrl+Shift+R) to fetch `?v=20260929e`; corner label must read `webgl3d
  20260929-feltbig`. Felt should now show clearly larger, more visible speckled grain. If it's
  still too subtle or looks wrong (seams, too coarse/fine, too dark/bright) or any error remains,
  send the red F12 console errors and what you see.

## Notes
- Headless only: visual changes stay "fixed-in-code" until the user confirms.
- English-only code text. Constants over magic numbers.
- Keep `ui.js` and `webgl3d.js` sign conventions in sync (reversed/monolith aim).
