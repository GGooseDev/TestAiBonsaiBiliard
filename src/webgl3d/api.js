/* Public P.WebGL3D facade. Builds the API object from the shared state S, exposing
   exactly the methods game.js / ui.js / arena.js / main.js call: ok, init, resize,
   draw, pop, screenToTableLogical, cueStickRec, resetZoom. If THREE is missing it
   surfaces a visible fallback + stub (matching the old module-level early-out). */
(function () {
  var W = window, P = W.Poole;
  var C = P.CONFIG;
  var S = P._WebGL;

  /* three.min.js must be loaded before this module (script order in index.html).
     If it wasn't, the page cannot render 3D at all — before this check the module
     died with a ReferenceError at module level. Surface it on screen instead and
     stub the API so game.js's start() keeps running non-rendering instead of
     crashing. */
  if (!W.THREE) {
    if (console && console.error) console.error("webgl3d: THREE.js not loaded; 3D disabled");
    S.showInitFail("THREE.js did not load (lib/three.min.js missing or failed). Open index.html from the folder that contains it, then hard-reload (Ctrl+Shift+R).");
    W.Poole.WebGL3D = {
      ok: function () { return false; },
      init: function () {}, resize: function () {}, draw: function () {}, pop: function () {},
      resetZoom: function () {}, cueStickRec: function () { return 0; },
      screenToTableLogical: function () { return null; }
    };
    return;
  }

  W.Poole.WebGL3D = {
    ok: function() { return S.glReady; },           /* did init secure a real GL context? */
   init: function (canvas) { S.initFn(canvas); },
   resetZoom: function () { S.zoomT = 0; S.zoomTargetT = 0; }, /* back to the default far frame */
   resize: function (w, h) { if (!S.renderer) return; S.renderer.setSize(w, h, false); S.frameCamera(w, h); },
   cueStickRec: function (dx, dy, cx, cy, power) {
     /* Current cue retraction (tip offset beyond C.BR) for a normalized direction + power,
        identical to what draw() computes so a strike starts from the exact on-screen pull. */
     if (!power || power <= 0) return 0;
     var vw = S.renderer ? S.renderer.domElement.width : 0;
     var vh = S.renderer ? S.renderer.domElement.height : 0;
     if (!vw || !vh) return power * (C.CUE_MAX_RECED || 120);
     var maxOff = S.coords._cueMaxOnScreenOff(dx, dy, cx, cy, C.BR + C.CUE_STICK_LEN, vw, vh);
     var recMax = Math.max(0, maxOff - (C.BR + C.CUE_STICK_LEN));
     return power * Math.min(recMax, C.CUE_MAX_RECED);
   },
    draw: function (state) {
      if (!S.renderer) return;
       S.drawFn(state);
     },
   pop: function (text, rgbStr) {
     if (!S.renderer || !S.scene) return;
     var cv = W.document.createElement('canvas'); cv.width = 512; cv.height = 128;
     var x = cv.getContext('2d');
     var rp = (rgbStr || '255,235,140').replace(/,/g, ' ').trim().split(/\s+/).map(function (t) { return parseInt(t, 16) || 0; });
     x.fillStyle = 'rgb(' + (rp[0] || 255) + ',' + (rp[1] || 235) + ',' + (rp[2] || 140) + ')';
     x.textAlign = 'center'; x.textBaseline = 'middle';
     x.font = 'bold ' + Math.max(48, 96) + 'px Arial, sans-serif';
     x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 12;
     x.fillText(text || '', 256, 64);
     var tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter;
     var m = new THREE.Sprite(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.95, depthWrite: false }));
     m.scale.set(360, 92, 1);
     m.renderOrder = 9;
     m.position.set(0, S.REST_Y + 20, 0);
     S.scene.add(m);
     S.floats3d.push({ sprite: m, t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()), life: C.FLASH_MS || 1800 });
   },
   screenToTableLogical: function (px, py, cx, cy) {
     /* px/py arrive as raw viewport coordinates; rebase them onto the canvas so
        aiming stays correct even when the canvas is not anchored at (0,0). */
     var r = P.UI && P.UI.canvas && P.UI.canvas.getBoundingClientRect
       ? P.UI.canvas.getBoundingClientRect() : null;
     if (r) { px -= r.left; py -= r.top; }
     var cssW = r ? r.width : W.innerWidth, cssH = r ? r.height : W.innerHeight;
     /* When the caller supplies the cue ball's logical centre we use the
        on-screen-offset mapping (immune to elevated-cursor distortion); otherwise
        fall back to the plain raycast for compatibility. */
     if (typeof cx === 'number' && typeof cy === 'number') {
       return S.coords._aimFromScreen(px, py, cssW, cssH, cx, cy);
     }
     return S.coords._screenToLogical(px, py, cssW, cssH);
   }
  };
})();
