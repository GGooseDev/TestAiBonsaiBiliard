# TASKS: Pool 8-ball WebGL

## Done (verified headlessly)
- Character viewer feature: `src/character.js` (procedural ball character: body from a game ball, default striped #11; eyes with blink; red sneakers; white gloves; idle/walk procedural animation; ball↔character morph via staggered springs) and `src/viewer.js` (own canvas, custom orbit camera — drag rotate / wheel zoom / pinch, auto-rotate; WALK/IDLE, BALL/CHARACTER, BACK TO MENU controls).
- Wired into the menu: 3rd button/key (Viewer) → `P.Viewer.open(onBack)`; BACK TO MENU / Esc re-shows the menu via the same callback. index.html loads character.js + viewer.js before menu.js.
- Headless smoke test passes: `test/character-viewer.smoke.js` (model build, morph to/from ball, blink squash, walk lift, mode state, viewer open/close/reopen, no orphaned rAF).

## Fixed in code (needs browser confirmation)
- Double-click `index.html` → menu → Viewer button → character page renders with orbit camera; WALK/IDLE and BALL/CHARACTER buttons toggle correctly; BACK TO MENU returns to the bokeh backdrop + menu.

