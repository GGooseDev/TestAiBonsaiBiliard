/* Battle Arena / pool 3D renderer — shared state + constants.
   First webgl3d module (loaded before coords/assets/init/draw/api). Creates the
   private P._WebGL container that all sibling modules read/write through, since each
   <script> tag is its own scope. Constants are fixed; mutable GL state starts as
   null/empty and is populated by init() (init.js). */
(function () {
  var W = window, P = W.Poole; if (!P) W.Poole = P = {};
  if (P._WebGL) return; /* already initialised (safety against double load) */

  var S = P._WebGL = {};
  var C = P.CONFIG || {};

  /* ---- constants (no THREE needed) ------------------------------------ */
  S.VERSION = '20261001-split';
  S.FOV = 46, S.TILT_DEG = 28, S.FRAMEMARGIN = 1.22;
  S.RAIL_DEPTH = 42, S.RAIL_H = 46, S.CAB_H = 70;
  S.MAX_ANISO = 4;
  S.AIM_BASIS_STEP = 10;
  S.FELT_TOP_Y = 0;
  S.FELT_THICK = 12;
  S.REST_Y = C.BR;
  S.BOKEH_SIDE_REF = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + S.RAIL_DEPTH * 16) * 2.2;
  S.NEAR_ZOOM = 0.75;
  S.ZOOM_SPEED = 6.0;
  S.ZOOM_SENS = 0.0025;

  /* world extents (logical units == world units) — resolved in init() */
  S.HALF_W = 0, S.HALF_H = 0, S.CXw = 0, S.CYw = 0;

  /* mutable GL state — null/empty until init() */
  S.renderer = null, S.scene = null, S.camera = null;
  S.raycaster = null, S.hitPlane = null;
  S.ballsById = {};
  S._ballQuats = {}, S._ballPrev = {};
  S.cueGroup = null, S.aimLineMesh = null, S.targetMesh = null,
     S.targetRingMesh = null, S.shaftMesh = null, S.buttMesh = null;
  S.bokehMat = null, S.bokehHalf = 0, S.bokehMesh = null;
  S.tableGroup = null;
  S.floats3d = [], S.goEl = null, S.goNameEl = null;
  S.bgFirstFrame = false, S.created = false, S.glReady = false;

  /* zoom level (0 = far base frame, 1 = straight down) + per-frame timestamps */
  S.zoomT = 0, S.zoomTargetT = 0, S._lastDrawNow = 0;

  var hasTHREE = !!W.THREE;
  if (hasTHREE) {
    S.hitVec = new THREE.Vector3();
    S.baseCamPos = new THREE.Vector3();
    S.camOffset = new THREE.Vector3();
    S.ndc = new THREE.Vector2();
    S.UP = new THREE.Vector3(0, 1, 0); /* shared unit-up for setFromUnitVectors (never mutated) */
    S.nearCamPos = new THREE.Vector3();
    S.farLookAt = new THREE.Vector3();
    S.nearLookAt = new THREE.Vector3(0, 0, 0);
    S._zoomPos = new THREE.Vector3();
    S._zoomLook = new THREE.Vector3();
    S.bokehMeshBasePos = new THREE.Vector3();
    S._qDelta = new THREE.Quaternion();
    S._axisWorld = new THREE.Vector3();
  } else {
    /* no THREE: these stay null; init()/draw() are no-ops and api.js builds the stub */
    S.hitVec = null, S.baseCamPos = null, S.camOffset = null, S.ndc = null, S.UP = null;
    S.nearCamPos = null, S.farLookAt = null, S.nearLookAt = null,
       S._zoomPos = null, S._zoomLook = null, S.bokehMeshBasePos = null,
       S._qDelta = null, S._axisWorld = null;
  }

  /* flags + DOM refs */
  S.DEBUG_BG = false;
  if (W.location && W.location.search.indexOf('debug_bg=1') >= 0) S.DEBUG_BG = true;

  /* visible fallback for hard init failures: without it the page just stays a black
     rectangle and the only trace is a console error invisible to a user who never
     opened F12. No-op in headless (no document). */
  S.showInitFail = function (msg) {
    if (!W.document || !W.document.body) return;
    try {
      var el = W.document.createElement("div");
      el.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;" +
        "background:#a51b1b;color:#fff;font:bold 16px Arial,sans-serif;text-align:center;" +
        "line-height:1.5;padding:32px;display:flex;align-items:center;justify-content:center;" +
        "user-select:none;";
      el.textContent = msg;
      W.document.body.appendChild(el);
    } catch (e) { /* no-op already guarded above */ }
  };

  /* LOAD MARKER: printed on every page load and stamped into the #dbg-version corner
     label so it is visible even without devtools. Compare after reloads to confirm
     the browser executed THIS copy. */
  if (console && console.log) {
    console.log('[WEBGL3D] loaded v' + S.VERSION + ' @' + new Date().toISOString());
  }
  if (typeof document !== 'undefined') {
    var _dbgEl = document.getElementById('dbg-version');
    if (_dbgEl) _dbgEl.textContent = 'webgl3d ' + S.VERSION;
  }
})();
