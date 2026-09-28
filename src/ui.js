/* UI: maps pointer/touch gestures on the canvas to an aim in the table's
   logical coordinate space, derives shot power from drag distance, and
   hands a finished shot to the game via P.UI.onFire. Exposed via window.Poole.UI.
   DOM/HUD text is owned by the game; this module is input only. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  var state = null;          /* P.State reference, refreshed by game each frame */
  function setState(s) { state = s || null; }

  /* derive power from how far the pointer is from the cue ball */
  function setPowerFromAim() {
    if (!state || !state.cue) { P.UI.power = 0; return; }
    var dx = P.UI.aimX - state.cue.x;
    var dy = P.UI.aimY - state.cue.y;
    var d = P.Vec.hypot(dx, dy);
    /* full pull -> power 1.0, driven by the single source of truth in
       config.js (C.POWER_MAX_DIST); replacing the old hard-coded 340 so the
       drag-to-power ramp is one tunable knob, not a magic number */
    var maxDrag = C.POWER_MAX_DIST;
    P.UI.power = Math.max(0, Math.min(1, d / maxDrag));
  }

  /* build the finished shot vector for the current aim, or null if too short. */
  function buildShot() {
    if (!state || !state.cue) return null;
    var dx = P.UI.aimX - state.cue.x;
    var dy = P.UI.aimY - state.cue.y;
    var d = P.Vec.hypot(dx, dy);
    if (d < 4) return null;            /* too short to be a real aim */
    /* Reversed aim (monolith feel): the shot flies AWAY from where you point.
       You drag your finger to the side opposite the direction you want the ball
       to travel - the cue tip points at your finger, and the stick pulls back. */
    var dirx = -(dx / d), diry = -(dy / d);
    var speed = 120 + P.UI.power * (C.MAX_SHOT_SPEED - 120);
    return { vx: dirx * speed, vy: diry * speed, power: P.UI.power };
  }

  function startAim(l) {
    if (!P.UI.shootable || state.gameOver) return;
    P.UI.aiming = true;
    P.UI.aimX = l.x; P.UI.aimY = l.y;
    setPowerFromAim();
  }

  function moveAim(l) {
    if (!P.UI.aiming) return;
    P.UI.aimX = l.x; P.UI.aimY = l.y;
    setPowerFromAim();
  }

  function endAim() {
    if (!P.UI.aiming) return;
    P.UI.aiming = false;
    var shot = buildShot();
    if (shot && P.UI.onFire) P.UI.onFire(shot);
    P.UI.power = 0;
  }

  /* attach a canvas and wire up mouse + touch listeners */
  function attach(canvas) {
    P.UI.canvas = canvas;
    canvas.addEventListener("mousedown", function (e) { startAim(toLogical(e)); });
    canvas.addEventListener("mousemove", function (e) { moveAim(toLogical(e)); });
    window.addEventListener("mouseup", endAim);
    canvas.style.touchAction = "none";
    canvas.addEventListener("touchstart", function (e) { e.preventDefault(); if (e.touches && e.touches[0]) startAim(toLogical(e.touches[0])); }, { passive: false });
    canvas.addEventListener("touchmove", function (e) { e.preventDefault(); if (e.touches && e.touches[0]) moveAim(toLogical(e.touches[0])); }, { passive: false });
    window.addEventListener("touchend", endAim);
  }

  /* Map a mouse/touch event to table-logical coords. The WebGL renderer owns the
     camera + felt geometry. When the cue ball's logical centre is supplied it uses
     the on-screen-offset mapping (screenToTableLogical with cx,cy), which points the
     cue where you point even when the cursor hovers over the elevated ball; the
     plain raycast is kept only for compatibility. Falls back to the flat 2D frame
     only before the 3D renderer owns the canvas. */
  /* raw pointer pixels (client coords) — kept for optional on-screen aim debug. */
  function toLogical(e) {
    P.UI.lastPtr = { x: e.clientX, y: e.clientY };
    var cx = state && state.cue ? state.cue.x : null;
    var cy = state && state.cue ? state.cue.y : null;
    var hit = null;
    if (P.WebGL3D) {
      hit = (cx != null && cy != null)
        ? P.WebGL3D.screenToTableLogical(e.clientX, e.clientY, cx, cy)
        : P.WebGL3D.screenToTableLogical(e.clientX, e.clientY);
      if (hit && isFinite(hit.x) && isFinite(hit.y)) {
        P.UI.lastAim = { x: hit.x, y: hit.y };
        return hit;
      }
    }
    /* GL returned null. If we already have a good aim (mid-aim, e.g. the cursor
       sitting on the ball for one frame), hold it to avoid jumping to a mis-scaled
       flat point. The flat transform is only safe before the renderer owns the
       canvas (headless / resize-before-init). */
    if (P.UI.lastAim) return P.UI.lastAim;
    var cr = P.UI.canvas && P.UI.canvas.getBoundingClientRect ? P.UI.canvas.getBoundingClientRect() : null;
    var sx = e.clientX - (cr ? cr.left : 0), sy = e.clientY - (cr ? cr.top : 0);
    var out = { x: (sx - P.Table.offX) / P.Table.size, y: (sy - P.Table.offY) / P.Table.size };
    P.UI.lastAim = out;
    return out;
  }

    P.UI = {
      shootable: false,   /* set by the game when it is a human's turn to aim */
      onFire: null,        /* game-provided callback: onFire(shot) */
      aiming: false,
      aimX: 0, aimY: 0,   /* pointer position in logical coords (human only) */
      power: 0,
      botAiming: false,   /* set by the game while a bot shot is being planned */
      botAimX: 0, botAimY: 0, /* virtual cue-stick direction for the bot's plan */
      botPower: 0,
      /* aim flow also exported so the drag->power mapping can be driven
         headlessly (smoke-e2e.js) without a real canvas or DOM events */
      startAim: startAim,
      moveAim: moveAim,
      endAim: endAim,
      attach: attach,
      setState: setState
    };
})();
