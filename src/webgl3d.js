/* True-3D WebGL renderer (Three.js, from lib/three.min.js). Owns a camera that
   frames the felt with the raised rail hugging the field edge, and reads P.State
   each frame to position lit spherical balls + cue. Pointer->logical aiming uses
   a ray cast onto the felt plane (perspective-correct). Room context comes from
   a single animated bokeh backdrop shader; all foreground objects use standard
   materials (no post-processing). */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};

  /* visible fallback for hard init failures: without it the page just stays a
     black rectangle and the only trace is a console error invisible to a user who
     never opened F12. No-op in headless (no document). */
  function showInitFail(msg) {
    if (!W.document || !W.document.body) return;
    try {
      var el = W.document.createElement("div");
      el.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;" +
        "background:#a51b1b;color:#fff;font:bold 16px Arial,sans-serif;text-align:center;" +
        "line-height:1.5;padding:32px;display:flex;align-items:center;justify-content:center;" +
        "user-select:none;";
      el.textContent = msg;
      W.document.body.appendChild(el);
    } catch (e) { /* no-op already guarded above */ }
  }

  /* three.min.js must be loaded before this module (script order in index.html).
     If it wasn't, the page cannot render 3D at all — before this check the module
     died with a ReferenceError at module level. Surface it on screen instead and
     stub the API so game.js's start() keeps running non-rendering instead of
     crashing. */
  if (!W.THREE) {
    if (console && console.error) console.error("webgl3d: THREE.js not loaded; 3D disabled");
    showInitFail("THREE.js did not load (lib/three.min.js missing or failed). Open index.html from the folder that contains it, then hard-reload (Ctrl+Shift+R).");
    W.Poole.WebGL3D = {
      ok: function () { return false; },
      init: function () {}, resize: function () {}, draw: function () {}, pop: function () {},
      screenToTableLogical: function () { return null; }
    };
    return;
  }

  var C = P.CONFIG;
  var renderer = null, scene = null, camera = null;
  var raycaster = null, hitPlane = null;
  var hitVec = new THREE.Vector3();
  var baseCamPos = new THREE.Vector3();
  var camOffset = new THREE.Vector3();
  var ndc = new THREE.Vector2();
  var UP = new THREE.Vector3(0, 1, 0); /* shared unit-up for setFromUnitVectors (never mutated) */

  var ballsById = {};
  var cueGroup = null,
      aimLineMesh = null, targetMesh = null, targetRingMesh = null,
      shaftMesh = null, buttMesh = null;
  var bokehMat = null;          /* animated colored-glint backdrop shader (set in init) */
  var bokehHalf = 0;            /* half side of the backdrop plane, world units; for parallax normalization */
  var bokehMesh = null;         /* backdrop mesh, translated to cancel camera shake (set in init) */
  var bokehMeshBasePos = new THREE.Vector3(); /* backdrop rest position, world units */
  var DEBUG_BG = false;         /* index.html?debug_bg=1 : camera isolates the backdrop for verification */
  /* resolved early (before any GL work) so triage banners in init() can run even
     if renderer creation throws; the old late read at end of init() is removed. */
  if (W.location && W.location.search.indexOf('debug_bg=1') >= 0) DEBUG_BG = true;
  var floats3d = [], goEl = null, goNameEl = null;
  var bgFirstFrame = false;     /* triage: first-frame console line fires once (DEBUG_BG only) */
  var created = false;           /* init() is idempotent: a canvas holds one GL context */
  var glReady = false;           /* true once init() secured a working WebGL context */

  /* world extents (logical units == world units) - set in init() */
  var HALF_W = 0, HALF_H = 0, CXw = 0, CYw = 0;

   /* tunables (one backdrop shader for the room bokeh; foreground is standard materials + lights).
     TILT_DEG = angle from straight-down (0 = top-down, 90 = side); lower reads as
     more overhead. FRAMEMARGIN keeps the whole felt + rails inside the frame with no
     background showing through the corners of the table. */
  var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var RAIL_DEPTH = 42, RAIL_H = 46, CAB_H = 70;
    var MAX_ANISO = 4;       /* fixed clamp for ball-texture anisotropy (r150+ has no query method) */
    /* probe distance (logical/world units) used to build the per-frame tangent
       basis for screen->logical aiming. Larger => smoother basis, smaller => less
       projection error; 10 keeps the ball's on-screen footprint well resolved. */
    var AIM_BASIS_STEP = 10;
  var FELT_TOP_Y = 0,      /* top surface of the felt */
      FELT_THICK = 12,     /* felt slab thickness (centered below its top)   */
       REST_Y = C.BR;       /* ball centre height above felt top */
   var BOKEH_SIDE_REF = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + RAIL_DEPTH * 16) * 2.2; /* original backdrop side; disc uv sizes normalize to this so they stay constant on screen when the plane is scaled up */

  function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }

  /* Project a world point onto the current camera and return canvas pixel coords.
     Used only for on-screen framing checks (is a point inside the viewport). */
  function _ptToCanvas(v, w, h) {
    var p = v.clone().project(camera);
    return { x: (p.x + 1) * 0.5 * w, y: (1 - p.y) * 0.5 * h };
  }

  /* Largest world offset s (>= baseSl) at which the cue butt end is still inside the
     viewport. The butt sits at l2w(cx-dx*s, cy-dy*s, REST_Y) lifted by s*0.14 in y,
     matching the drawn stick exactly. Bounded by C.CUE_MAX_WORLD_OFF and inset from the
     frame edge by C.CUE_SCREEN_INSET_FRAC so a full-power cue is always fully visible
     and never clipped at the screen border. Returns baseSl when even the rest length
     leaves the frame (should not happen). */
  function _cueMaxOnScreenOff(dx, dy, cx, cy, baseSl, w, h) {
    if (!camera) return baseSl;
    var m = Math.max(12, Math.min(w, h) * (C.CUE_SCREEN_INSET_FRAC || 0.04));
    function inside(s) {
      var p = l2w(cx - dx * s, cy - dy * s, REST_Y);
      p.y += s * 0.14; /* same lift the drawn butt end uses */
      var sp = _ptToCanvas(p, w, h);
      return sp.x >= m && sp.x <= w - m && sp.y >= m && sp.y <= h - m;
    }
    if (!inside(baseSl)) return baseSl;
    var lo = baseSl, hi = C.CUE_MAX_WORLD_OFF || 1500;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) * 0.5;
      if (inside(mid)) { lo = mid; } else { hi = mid; }
    }
    return lo;
  }

  /* ray from canvas px,py to the felt plane; returns logical x,y (perspective-correct) */
  function _screenToLogical(px, py, cssW, cssH) {
    /* returns logical (x,y), or null when the GL context is not ready yet or the
       ray never intersects the felt plane. Null hands control back to ui.js, which
       then uses the flat pointer mapping instead of freezing at the centre point
       (a frozen centre would make the aim line and cue ignore the cursor). */
    if (!renderer || !camera) return null;
    ndc.set((px / cssW) * 2 - 1, 1 - (py / cssH));
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(hitPlane, hitVec)) {
      return { x: hitVec.x + CXw, y: CYw - hitVec.z };
    }
    return null; /* no plane hit: defer to flat fallback in ui.js */
  }

  /* Convert a cursor position (canvas px) to the corrected logical aim point for a
     cue ball at logical (cx, cy). The aim is taken from the cursor's ON-SCREEN
     offset relative to the projected ball, decomposed into a per-frame tangent
     basis (two probe points one STEP in +X / +Y from the ball). This is immune to
     the distortion of raycasting an elevated cursor down to the felt plane, which
     made the cue point in a fixed direction when the cursor hovered near the ball.
     Returns { x, y } in table logical units, or null when the cursor is on the
     ball or the camera is not ready. */
  function _aimFromScreen(px, py, cssW, cssH, cx, cy) {
    if (!camera || !cssW || !cssH) return null;
    var bp = _ptToCanvas(l2w(cx, cy, REST_Y), cssW, cssH);
    var sx = px - bp.x, sy = py - bp.y;
    var sm = Math.sqrt(sx * sx + sy * sy);
    if (sm < 0.5) return null; /* cursor on the ball: no direction yet */
    var rp  = _ptToCanvas(l2w(cx + AIM_BASIS_STEP, cy, REST_Y), cssW, cssH);
    var upp = _ptToCanvas(l2w(cx, cy + AIM_BASIS_STEP, REST_Y), cssW, cssH);
    var sr = { x: rp.x - bp.x, y: rp.y - bp.y };  /* screen vector of +X */
    var su = { x: upp.x - bp.x, y: upp.y - bp.y };/* screen vector of +Y */
    var det = sr.x * su.y - sr.y * su.x;
    if (Math.abs(det) < 1e-6) return null;
    var a = (sx * su.y - sy * su.x) / det; /* steps along +X */
    var b = (sr.x * sy - sr.y * sx) / det; /* steps along +Y */
    return { x: cx + a * AIM_BASIS_STEP, y: cy + b * AIM_BASIS_STEP };
  }

  /* distance along a logical shot direction from (x,y) to the felt boundary */
  function rayToFeltLen(x, y, dx, dy) {
    var L = 8e5;
    if (dx > 0) L = Math.min(L, (C.IX1 - x) / dx);
    if (dx < 0) L = Math.min(L, (x - C.IX0) / -dx);
    if (dy > 0) L = Math.min(L, (C.IY1 - y) / dy);
    if (dy < 0) L = Math.min(L, (y - C.IY0) / -dy);
    return Math.max(1, Math.min(L, 600));
  }

  /* first object ball hit by the shot ray (cue centre -> normalized direction).
     Returns { ball, impactX, impactY } with the impact point on the struck ball's
     surface, or { ball: null } when the shot goes empty. Used to place the target
     marker on the ball the cue will actually strike, not at a far rail point. */
  function firstContact(cx, cy, dx, dy, balls) {
    if (!balls || balls.length === 0) return { ball: null };
    var R = C.BR * 2;                       /* surface-to-surface gap (cue + object) */
    var bestB = null, bestT = Infinity;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.id === 'cue' || b.inPocket) continue;
      var qx = b.x - cx, qy = b.y - cy;
      var ddot = qx * dx + qy * dy;
      if (ddot < 0.01) continue;            /* ball sits behind the shot start */
      var disc = ddot * ddot - (qx * qx + qy * qy) + R * R;
      if (disc < 0) continue;               /* ray misses the ball */
      var t = ddot - Math.sqrt(disc);       /* near intersection on the ray */
      if (t < 0.01 || t >= bestT) continue;
      bestB = b;
      bestT = t;
    }
    if (!bestB) return { ball: null };
    /* point on the ray nearest the struck centre, then back along its normal to
       the exact contact point on the ball surface */
    var rx = bestB.x - cx - bestT * dx;
    var ry = bestB.y - cy - bestT * dy;
    var rl = Math.sqrt(rx * rx + ry * ry) || 1;
    return {
      ball: bestB,
      impactX: bestB.x - R * (rx / rl),
      impactY: bestB.y - R * (ry / rl)
    };
  }

  /* orient a unit-axis cylinder (height along local +Y) so it lies on a->b.
     X and Z get the radius; Y gets the full length. Scale.y = length is what makes
     the object read as a rod along its axis instead of a sideways stub. */
  function orientAlong(mesh, a, b, radius) {
    var v = new THREE.Vector3().subVectors(b, a);
    var len = v.length();
    if (len < 0.001) { mesh.scale.set(radius, 1, radius); mesh.position.copy(a); return; }
    var u = v.normalize();
    mesh.position.copy(a).add(v).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, u);
    mesh.scale.set(radius, len, radius);
  }

  /* fit the camera so the felt + raised rail always fill the frame with margin.
     TILT_DEG is measured from straight-down: 0 = top-down, 90 = side view.
     Lower values give a higher, more overhead angle so the whole field shows. */
  function frameCamera(w, h) {
    if (!camera) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    var tH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    var tV = tH / Math.max(w / h, 0.001);
    var extX = HALF_W + RAIL_DEPTH * 1.35;
    var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
    var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
    baseCamPos.set(
      0,
      D * Math.cos(THREE.MathUtils.degToRad(TILT_DEG)),
      D * Math.sin(THREE.MathUtils.degToRad(TILT_DEG))
    );
    scene.add(camera);
    camera.lookAt(0, RAIL_H * 0.2, 0);
  }

  /* ball surface texture: number printed on the TOP POLE so it stays readable
     from the 3/4 view; equator band for stripes; 5 dots on the 8-ball. */
  var texCache = {};
  function makeBallTexture(id) {
    if (texCache[id]) return texCache[id];
    var SZ = 256, cv = document.createElement('canvas');
    cv.width = cv.height = SZ;
    var x = cv.getContext('2d');
    var isObj = typeof id === 'number';
    var solid = isObj && id <= 7;
    var stripe = isObj && id >= 9;
    var color = C.COLORS[id] || '#ffffff';

    if (id === 'cue') x.fillStyle = '#f2efe6';
    else if (solid) x.fillStyle = color;
    else if (stripe) x.fillStyle = '#f4f1ea';
    else x.fillStyle = color; /* 8 ball (near black) */
    x.fillRect(0, 0, SZ, SZ);

    if (id === 'cue') {
      var sp = [[0.2, 0.55, '#c13'], [0.4, 0.7, '#d8a'], [0.6, 0.7, '#279'], [0.8, 0.55, '#b35']];
      for (var si = 0; si < sp.length; si++) { x.fillStyle = sp[si][2]; x.beginPath(); x.arc(SZ * sp[si][0], SZ * sp[si][1], SZ * 0.04, 0, 7); x.fill(); }
    } else if (solid) {
      _numBadge(x, SZ, id);
    } else if (stripe) {
      x.fillStyle = color;
      x.fillRect(0, SZ * 0.42, SZ, SZ * 0.16);
      _numBadge(x, SZ, id);
    } else { /* 8-ball: white dot ring at the equator + pole number */
      var dxs = [0.2, 0.4, 0.5, 0.6, 0.8];
      for (var di = 0; di < dxs.length; di++) { x.fillStyle = '#ffffff'; x.beginPath(); x.arc(SZ * dxs[di], SZ * 0.5, SZ * 0.045, 0, 7); x.fill(); }
      _numBadge(x, SZ, id);
    }

    var tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = MAX_ANISO;
    texCache[id] = tex;
    return tex;
  }
  function _numBadge(x, SZ, id) {
    var cx = SZ * 0.5, cy = SZ * 0.5, r = SZ * 0.2;
    x.fillStyle = '#ffffff';
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = (id === '8') ? '#ffffff' : '#000000';
    var n = (typeof id === 'number') ? String(id) : 'CUE';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold ' + (SZ * 0.26) + 'px Arial, sans-serif';
    x.fillText(n, cx, cy);
  }

  /* normalize one palette entry to [r,g,b] floats in 0..1. Color constants in this
     project are hex strings (#rrggbb, cf. C.COLORS) so the glint palette entries are
     parsed here instead of being assumed numeric; malformed entries fall back to a
     neutral warm tone rather than NaN, which would darken the whole field. */
  var BOKEH_FALLBACK_RGB = [0.55, 0.65, 1.0];
  function hexToRgb01(input) {
    var s = String(input).replace(/^\s*#*/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length !== 6) return null;
    var n = parseInt(s, 16);
    if (!isFinite(n) || n < 0) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function normColor(entry) {
    var raw = hexToRgb01(entry);
    var out;
    if (raw) {
      out = [raw[0] / 255, raw[1] / 255, raw[2] / 255];
    } else if (Array.isArray(entry) && entry.length >= 3) {
      out = [entry[0], entry[1], entry[2]];
    } else {
      out = BOKEH_FALLBACK_RGB.slice();
    }
    if (!isFinite(out[0]) || !isFinite(out[1]) || !isFinite(out[2])) {
      return BOKEH_FALLBACK_RGB.slice();
    }
    return out;
  }

  /* Build the animated backdrop: a field of colored soft glints behind and around
      the table (a large plane under the legs). Every disc carries a random hue from
      C.BOKEH_PALETTE, a phase, and its own drift speed so the whole layer "walks"
      smoothly on its own (pan + very slow rotation, set per-frame via uFlow/uRot),
      and additionally slides against camera motion (uCamPar) — i.e. when the view
      tilts/rotates the colored lights move behind the table. Purely decorative;
      foreground uses standard lit materials. */
  function makeBokehFloor(side) {
    bokehHalf = side / 2;
    var N = Math.max(4, C.BOKEH_COUNT || 24);
    var posArr  = new Float32Array(N * 2);   /* disc centres in centred uv (-0.5..0.5 == whole plane) */
    var radArr  = new Float32Array(N);       /* uv radius */
    var colArr  = new Float32Array(N * 3);
    var metaArr = new Float32Array(N * 4);   /* phase, drift speed X, drift speed Y, pulse rate */
    var palette = C.BOKEH_PALETTE;
    for (var i = 0; i < N; i++) {
      /* centred uv (-0.5..0.5): the fragment remaps vUv to a centred frame, so
         positions in -1..1 would put ~half of all discs outside the plane
         and the backdrop would read as a near-black field */
      posArr[i * 2]     = Math.random() - 0.5;
      posArr[i * 2 + 1] = Math.random() - 0.5;
       var rLw = (C.BOKEH_MIN_R + Math.random() * (C.BOKEH_VAR_R || 150)) * (side / BOKEH_SIDE_REF);
       radArr[i]         = rLw / side;        /* world units -> uv radius (constant on-screen size) */
      var p = normColor(palette ? palette[i % palette.length] : null);
      var m = 0.45 + Math.random() * 0.65;   /* per-disc brightness scale */
      colArr[i * 3]     = p[0] * m;
      colArr[i * 3 + 1] = p[1] * m;
      colArr[i * 3 + 2] = p[2] * m;
      var spd = (C.BOKEH_SPEED || 0.16) * (0.3 + Math.random() * 0.9);
      metaArr[i * 4]     = Math.random() * Math.PI * 2;                        /* phase */
      metaArr[i * 4 + 1] = spd * (Math.random() < 0.5 ? -1 : 1);              /* drift x (rad/s) */
      metaArr[i * 4 + 2] = spd * (Math.random() < 0.5 ? -1 : 1);              /* drift y (rad/s) */
      metaArr[i * 4 + 3] = 0.4 + Math.random() * 0.9;                          /* pulse rate (rad/s) */
    }
    var VS = "varying vec2 vUv; void main(){ vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * p; }";
    /* Fragment: out-of-focus bokeh orbs — a bright core, a soft wide halo and a faint
       rim, each tinted by its disc colour. Field transform: autonomous smooth pan
       (uFlow) + very slow rotation (uRot) + parallax slide vs camera (uCamPar), so the
       orbs read as light moving behind the table whenever the camera moves. */
    var fs = [
      "precision mediump float;",
      "uniform float uTime;",
      "uniform float uFlow;  /* autonomous pan amplitude, uv */",
      "uniform float uRot;   /* autonomous rotation (rad), driven per-frame in draw() */",
      "uniform vec2 uCamPar; /* camera offset vs base frame, normalized to uv * parallax */",
      "uniform float uDriftAmp;",
      "uniform float uCore;",
      "uniform float uHalo;",
      "uniform float uRing;",
      "uniform vec2 uSpotPos[" + N + "];",
      "uniform float uSpotR[" + N + "];",
      "uniform vec3 uSpotCol[" + N + "];",
      "uniform vec4 uSpotMeta[" + N + "];",
      "uniform vec3 uBg;",
      "uniform float uOrbDebug; /* >0.5 in ?debug_bg=1: draws triage markers (red centre, yellow orb0) */",
      "varying vec2 vUv;",
      "void main() {",
      "  /* move the sampling frame: slow pan, slow spin, then parallax against camera */",
      "  vec2 c = vUv - 0.5;",
      "  c += vec2(sin(uTime * 0.07), cos(uTime * 0.056)) * uFlow;",
      "  float cr = cos(uRot); float sr = sin(uRot);",
      "  c = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);",
      "  c += -uCamPar;",
      "  vec3 col = uBg;",
      "  for (int j = 0; j < " + N + "; j++) {",
      "    float ph = uSpotMeta[j].x;",
      "    vec2 drift = vec2(",
      "        sin(uTime * uSpotMeta[j].y + ph) * uDriftAmp,",
      "        cos(uTime * uSpotMeta[j].z + ph * 1.73) * uDriftAmp",
      "    );",
      "    vec2 p = uSpotPos[j] + drift;",
      "    float rr = uSpotR[j] * (1.0 + 0.18 * sin(uTime * uSpotMeta[j].w + ph));",
      "    vec2 d = c - p;",
      "    float t = length(d) / max(rr, 0.004);",
      "    float core = exp(-t * t * 2.6);",
      "    float halo = exp(-t * t * 0.75);",
      "    float ring = exp(-pow(t - 1.1, 2.0) * 4.0);",
      "    col += uSpotCol[j] * (core * uCore + halo * uHalo + ring * uRing);",
      "  }",
      "  col *= mix(1.0, 0.42, smoothstep(0.45, 1.35, length(c)));",
      "  if (uOrbDebug > 0.5) { /* triage: red = fragment executes (fixed centre); yellow = uSpotPos array uploaded */",
      "    vec2 dc = c;",
      "    if (length(dc) < 0.12) col = vec3(1.0, 0.0, 0.0);",
      "    vec2 p0 = uSpotPos[0];",
      "    if (length(dc - p0) < 0.05) col = vec3(1.0, 1.0, 0.0);",
      "  }",
      "  gl_FragColor = vec4(col, 1.0);",
      "}"
    ];
    var mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: fs.join("\n"),
      uniforms: {
        uTime:     { value: 0 },
        uFlow:     { value: C.BOKEH_FLOW || 0.06 },
        uRot:      { value: 0 },
        uCamPar:   { value: new THREE.Vector2(0, 0) },
        uDriftAmp: { value: C.BOKEH_DRIFT || 0.10 },
         uCore:     { value: C.BOKEH_CORE_ALPHA || 1.0 },
         uHalo:     { value: C.BOKEH_MID_ALPHA || 0.5 },
         uRing:     { value: C.BOKEH_RING_ALPHA || 0.15 },
        uSpotPos:  { value: posArr },
        uSpotR:    { value: radArr },
        uSpotCol:  { value: colArr },
        uSpotMeta: { value: metaArr },
         uBg:       { value: new THREE.Color(0x14233f) },
         uOrbDebug: { value: DEBUG_BG ? 1 : 0 }
      },
      side: THREE.DoubleSide
    });
     var mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
     mesh.rotation.x = -Math.PI / 2;          /* flat, normal points +Y (overhead view) */
     if (DEBUG_BG && console && console.info) {
       console.info('[BG_DBG] step 2: bokeh N=' + N + ', col[0]=[' + colArr[0].toFixed(3) + ',' +
         colArr[1].toFixed(3) + ',' + colArr[2].toFixed(3) + '], pos0=[' + posArr[0].toFixed(3) + ',' +
         posArr[1].toFixed(3) + '], r0=' + radArr[0].toFixed(4) + ' uv');
     }
     return { mesh: mesh, mat: mat };
  }

  /* ---- scene building ---- */
   function init(canvas) {
    /* triage (DEBUG_BG only): DOM banner + console line proving webgl3d.js executed and
       init() started, before any GL work. If there is NOT a single "[BG_DBG]" line in the
       F12 Console -> this script did not run at all (wrong folder / stale copy / an
       earlier script error), so the black screen is not a shader issue. */
    if (DEBUG_BG) {
      var bgDom = W.document ? W.document.createElement('div') : null;
      if (bgDom) {
        bgDom.style.cssText = 'position:fixed;top:10px;left:10px;z-index:9999;pointer-events:none;' +
          'background:#ff3d3d;color:#fff;font:bold 14px Arial,sans-serif;padding:7px 11px;' +
          'box-shadow:0 2px 14px rgba(0,0,0,.65)';
        bgDom.textContent = 'BG_DBG - webgl3d.js is running; open F12 > Console for steps 0-2';
        W.document.body.appendChild(bgDom);
      }
      if (console && console.info) {
        console.info('[BG_DBG] step 0: webgl3d.js ran (glint HEXFIX v2), init() started.');
      }
    }
    /* Defensive duplicate of the module-level THREE check: on a normal load it can
       never be reached here (module-level early-out + stub), but if it somehow is,
       fail visibly instead of returning into a dead game loop. */
    if (!window.THREE) {
      showInitFail("WebGL rendering unavailable: THREE.js did not load.");
      return;
    }
    /* Idempotent: the #game canvas already holds one GL context after the first
       call, so a second init() must not try to create another (that throws with
       "Canvas has an existing context of a different type"). */
    if (created) {
      if (renderer) { renderer.setSize(W.innerWidth, W.innerHeight, false); }
      if (scene) frameCamera(W.innerWidth, W.innerHeight);
      return;
    }
    created = true;

    /* Draw into the caller-provided #game canvas (set via opts.canvas). If none is
       provided, Three.js falls back to its own appended canvas. updateStyle:false
       keeps the canvas's CSS 100vw/100vh layout authoritative; only the GL buffer
       size changes so the scene stays crisp at the native resolution. */
     try {
       var opts = { antialias: true };
       if (canvas) opts.canvas = canvas;
       /* context creation is the only place GL capability actually surfaces. Before
          this try/catch a dead context meant a raw console error and a black square
          with no message for the user. */
       renderer = new THREE.WebGLRenderer(opts);
       renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, 2));
       renderer.setSize(W.innerWidth, W.innerHeight, false);
     } catch (e) {
       if (console && console.error) console.error("webgl3d: WebGL context unavailable:", e);
       showInitFail("WebGL is not available in this browser. Use a recent Chrome/Edge/Firefox/Safari with hardware acceleration enabled, then hard-reload (Ctrl+Shift+R).");
       return;
     }
    renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowType !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowType;
    else renderer.shadowMap.type = 1;
    renderer.setClearColor(0x14233f, 1); /* plain dark background, unchanged */

    scene = new THREE.Scene();
    /* dim room backdrop so the overhead frame has context (no empty black void) */
    scene.background = new THREE.Color(0x14233f);
    camera = new THREE.PerspectiveCamera(FOV, W.innerWidth / W.innerHeight, 5, 3000);
    raycaster = new THREE.Raycaster();
    hitPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); /* raycast the felt surface (y = 0) so pointer aim maps onto the table, not the elevated ball-centre height */

    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    var dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(-600, 1400, 800);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -720;  dir.shadow.camera.right = 720;
    dir.shadow.camera.top = 600;   dir.shadow.camera.bottom = -600;
    dir.shadow.camera.near = 200;  dir.shadow.camera.far = 4200;
    scene.add(dir);
    var lamp = new THREE.PointLight(0xfff1d8, 0.55);
    lamp.position.set(0, 900, -260);
    scene.add(lamp);

    HALF_W = (C.IX1 - C.IX0) / 2; HALF_H = (C.IY1 - C.IY0) / 2;
    CXw = C.IX0 + HALF_W; CYw = C.IY0 + HALF_H;

    var feltMat = new THREE.MeshStandardMaterial({ color: 0x346941, roughness: 1 });
    var railMat = new THREE.MeshStandardMaterial({ color: 0x6e3b1e, roughness: 0.55 });
    var cabMat = new THREE.MeshStandardMaterial({ color: 0x52341d, roughness: 0.7 });

    /* felt slab, top surface at y=0 */
    var felt = new THREE.Mesh(new THREE.BoxGeometry(C.IX1 - C.IX0, FELT_THICK, C.IY1 - C.IY0), feltMat);
    felt.position.set(0, -FELT_THICK / 2, 0);
    felt.receiveShadow = true;
    scene.add(felt);

    /* cabinet under the felt */
    var cabW = (C.IX1 - C.IX0) + RAIL_DEPTH * 2.4, cabHgt = (C.IY1 - C.IY0) + RAIL_DEPTH * 2.4;
    var cab = new THREE.Mesh(new THREE.BoxGeometry(cabW, CAB_H, cabHgt), cabMat);
    cab.position.set(0, -FELT_THICK / 2 - CAB_H / 2, 0);
    cab.receiveShadow = true;
    scene.add(cab);

    /* legs below the cabinet */
    var legLen = 150;
    var legGeo = new THREE.CylinderGeometry(26, 26, legLen, 12);
    var legTopY = -FELT_THICK / 2 - CAB_H;
    for (var lx = -1; lx <= 1; lx += 2) for (var lz = -1; lz <= 1; lz += 2) {
      var leg = new THREE.Mesh(legGeo, cabMat);
      leg.position.set(lx * HALF_W, legTopY - legLen / 2, lz * HALF_H);
      leg.castShadow = true;
      scene.add(leg);
    }

    /* room backdrop below/around the cabinet: an animated bokeh field of soft,
       out-of-focus lights so the overhead frame reads as a real table room, not
       an empty void. Slightly larger than the felt+rails to fill the visible
       background; uTime is advanced in draw(). */
      /* 3.5x margin so the colored glint field clearly exceeds the framed view at
         any window aspect ratio (check-bg-extent.js verified coverage up to ~3.5:1) */
     var bokehSide = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + RAIL_DEPTH * 16) * 3.5;
    var bh = makeBokehFloor(bokehSide);
    bh.mesh.position.set(0, legTopY - legLen - 5, 0); /* sits just under the legs */
    scene.add(bh.mesh);
    bokehMat = bh.mat;
    bokehMesh = bh.mesh;
    bokehMeshBasePos.copy(bokehMesh.position);
    /* triage (DEBUG_BG only): a semi-transparent bright red quad in front of the glint
       backdrop, 0xff1111 deliberately outside C.BOKEH_PALETTE. Purpose:
       - red tint over the field -> renderer, camera/frustum and shader all work;
       - still pure black -> problem is before this quad (GL context / frustum /
         scene build), i.e. one of console steps 0/1 above failed. */
    if (DEBUG_BG) {
      var dbQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(bokehSide, bokehSide),
        new THREE.MeshBasicMaterial({ color: 0xff1111, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
      );
      dbQuad.rotation.x = -Math.PI / 2;
      /* 1.5 units in front of the backdrop plane (which sits at legTopY - legLen - 5), so no z-fight */
       /* triage placement: the ?debug_bg=1 camera (L578-583) aims at z=860 on the
          backdrop plane, so the quad sits at screen centre under that view
          (frustum-check.js confirms NDC ~ (0,0) and the ray is not blocked by
          the table). At z=0 the view ray would cross the felt top and this
          marker would stay hidden behind the table. */
       dbQuad.position.set(0, legTopY - legLen - 3.5, 860);
      dbQuad.renderOrder = 45;
      scene.add(dbQuad);
    }

    /* raised rails hugging the felt edge */
    var sides = [];
    for (var sideZ = -1; sideZ <= 1; sideZ += 2) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(C.IX1 - C.IX0 + RAIL_DEPTH * 2, RAIL_H, RAIL_DEPTH), railMat);
      r.position.set(0, RAIL_H / 2, sideZ * HALF_H + sideZ * RAIL_DEPTH * 0.5);
      r.castShadow = true; r.receiveShadow = true;
      sides.push(r);
    }
    for (var sideX = -1; sideX <= 1; sideX += 2) {
      var l = new THREE.Mesh(new THREE.BoxGeometry(RAIL_DEPTH, RAIL_H, C.IY1 - C.IY0 + RAIL_DEPTH * 2), railMat);
      l.position.set(sideX * HALF_W + sideX * RAIL_DEPTH * 0.5, RAIL_H / 2, 0);
      l.castShadow = true; l.receiveShadow = true;
      sides.push(l);
    }
    for (var s = 0; s < sides.length; s++) scene.add(sides[s]);

    /* pockets: dark discs recessed just under the felt top */
    var pocketGeo = new THREE.CylinderGeometry(C.POCKET_R, C.POCKET_R * 0.7, 5, 18);
    var pocketMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    for (var pi = 0; pi < C.pockets.length; pi++) {
      var p = C.pockets[pi];
      var pm = new THREE.Mesh(pocketGeo, pocketMat);
      pm.position.copy(l2w(p.x, p.y, -1));
      scene.add(pm);
    }

    /* balls (standard material + generated number texture; one mesh per id) */
    ballsById = {};
    var ballGeo = new THREE.SphereGeometry(C.BR, 32, 24);
    var allIds = ['cue'];
    for (var n = 1; n <= 15; n++) allIds.push(n);
    for (var bi = 0; bi < allIds.length; bi++) {
      var id = allIds[bi];
      var mat = new THREE.MeshStandardMaterial({ map: makeBallTexture(id), roughness: 0.35, metalness: 0.05 });
      var bm = new THREE.Mesh(ballGeo, mat);
      bm.castShadow = true; bm.receiveShadow = true;
      bm.visible = id === 'cue';
      scene.add(bm);
      ballsById[id] = bm;
    }

    /* aim line + first-contact target + cue stick. All three use bright opaque basic
       materials with raised renderOrder so they read clearly above the lit scene
       from the overhead view (the previous semi-transparent targets were nearly
       invisible against the felt). */
    var unitCyl = new THREE.CylinderGeometry(1, 1, 1, 24);
    /* aim line is a UI overlay: never let the scene occlude it (see I2), so depthTest is
       off. depthWrite stays off so the guide cannot hide balls from other overlays. */
    aimLineMesh = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ color: 0xffe86b, depthWrite: false, depthTest: false }));
    aimLineMesh.renderOrder = 9;
    aimLineMesh.visible = false; scene.add(aimLineMesh);
    /* compact bright dot floated above the struck ball centre: unambiguously flags
       "this is the ball you will hit" without hiding its number */
    targetMesh = new THREE.Mesh(new THREE.SphereGeometry(C.BR * 0.45, 16, 12),
                                new THREE.MeshBasicMaterial({ color: 0xffffff }));
    targetMesh.renderOrder = 9;
    targetMesh.visible = false; scene.add(targetMesh);
    /* flat ring on the felt around the predicted contact point: from the overhead
       camera a solid dot alone does not read, so this ground ring makes the shot's
       landing spot unambiguous. Lies just above the felt top, facing up. */
    targetRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(C.BR * 1.5, C.BR * 2.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe86b }));
    targetRingMesh.renderOrder = 10;
    targetRingMesh.rotation.x = -Math.PI / 2; /* face up onto the felt */
    targetRingMesh.visible = false; scene.add(targetRingMesh);
    /* two-segment cue stick (the handle was always two pieces: a lighter tapered
         shaft and a darker ebony butt). Both segments are parented under one group
         whose origin is the tip (nose) contact point, so re-aiming rotates the whole
         stick about the nose at the ball instead of spinning about its centre.
         Shaded standard materials + scene lights so it reads as a real lit object. */
    var shaftMat = new THREE.MeshStandardMaterial({ color: 0xf3dca6, roughness: 0.35, metalness: 0 });
    var buttMat  = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.45, metalness: 0 });
    cueGroup = new THREE.Group();
    scene.add(cueGroup);
    shaftMesh = new THREE.Mesh(unitCyl, shaftMat);
    shaftMesh.visible = false; shaftMesh.castShadow = true; shaftMesh.receiveShadow = true; cueGroup.add(shaftMesh);
    buttMesh = new THREE.Mesh(unitCyl, buttMat);
    buttMesh.visible = false; buttMesh.castShadow = true; buttMesh.receiveShadow = true; cueGroup.add(buttMesh);

    floats3d = [];
    goNameEl = W.document.getElementById('go-name');
    goEl = W.document.getElementById('gameover');

    frameCamera(W.innerWidth, W.innerHeight);
    /* public flag: true once init() secured a working WebGL context. The
       WebGLRenderer constructor throws if it can't obtain a context, so reaching
       this line means GL is available. Consumers gate on this instead of
       re-requesting (possibly type-mismatched) contexts from the canvas. */
      glReady = !!renderer;
      /* triage (DEBUG_BG only): GL context + full scene build done; the backdrop plane,
         foreground meshes and the red debug quad are in the scene now. */
      if (DEBUG_BG && console && console.info) {
        console.info('[BG_DBG] step 1: GL context ready, scene built (backdrop + red debug quad). Red tint over glints = renderer/camera/shader all OK.');
      }
    }

  /* ---- public API -------------------------------------------------------- */
  P.WebGL3D = {
    ok: function() { return glReady; },           /* did init secure a real GL context? */
    init: function (canvas) { init(canvas); },
    resize: function (w, h) { if (!renderer) return; renderer.setSize(w, h, false); frameCamera(w, h); },
    draw: function (state) {
      if (!renderer) return;
       var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (bokehMat) {
          /* time, slow autonomous rotation, and a parallax slide against the camera:
             the colored field walks on its own behind the table and slides when the
             view tilts or shakes */
          var ut = now * 0.001;
          bokehMat.uniforms.uTime.value = ut;
          bokehMat.uniforms.uRot.value =
            Math.sin(ut * C.BOKEH_ROT_SPEED) * (C.BOKEH_ROT_A || 0.03) +
            Math.cos((ut * 1.41 * C.BOKEH_ROT_SPEED) + 1.37) * (C.BOKEH_ROT_B || 0.018);
          var px = ((camera.position.x - baseCamPos.x) / bokehHalf) * (C.BOKEH_PARALLAX || 1.0);
          var pz = ((camera.position.z - baseCamPos.z) / bokehHalf) * (C.BOKEH_PARALLAX || 1.0);
          bokehMat.uniforms.uCamPar.value.set(px, pz);
        }

      /* camera shake (decaying jitter around the framed base position) */
      var shake = 0;
      if (state && state.shakeUntil > now) shake = Math.min(1, (state.shakeUntil - now) / (C.SHAKE_MS || 700));
      camOffset.set(
        Math.sin(now * 0.13 + 1.7) * 6 * shake,
        Math.sin(now * 0.11 + 2.2) * 4 * shake,
        Math.sin(now * 0.17 + 0.4) * 6 * shake);
        camera.position.copy(baseCamPos).add(camOffset);
        if (shake <= 0) {
          /* keep the base orientation when not shaking so the backdrop stays put */
          camera.lookAt(0, RAIL_H * 0.2, 0);
        }
        /* backdrop is a fixed room element: translate it by the same shake vector
           as the camera so its on-screen position never changes while the table
           jitters; freeze the parallax slide too. (Skipped in debug_bg mode where
           the camera is overridden and not shaken.) */
        if (!DEBUG_BG && bokehMesh && bokehMat) {
          bokehMesh.position.copy(bokehMeshBasePos).add(camOffset);
          if (shake > 0) bokehMat.uniforms.uCamPar.value.set(0, 0);
        }
       if (DEBUG_BG) {
         /* debug only: stare down at the glint strip near the near rail so the
            colored backdrop fills the frame and can be checked standalone */
         var dbPos = new THREE.Vector3(0, 1350, 760);
         camera.position.copy(dbPos);
         camera.lookAt(new THREE.Vector3(0, -232.0, 860));
       }

       if (!DEBUG_BG) {
         /* balls */
      if (state) {
        for (var i = 0; i < state.balls.length; i++) {
          var b = state.balls[i];
          var m = ballsById[b.id];
          if (!m) continue;
          m.position.copy(l2w(b.x, b.y, REST_Y));
          m.visible = !b.inPocket;
        }
      }

      /* aim line + stick (only while aiming, hide during flight / game over) */
      var wantAim = false, aimX = 0, aimY = 0, power = 0;
      if (state && state.cue) {
        if (P.UI && P.UI.aiming && !P.UI.botAiming) { wantAim = true; aimX = P.UI.aimX; aimY = P.UI.aimY; power = P.UI.power || 0; }
        else if (P.UI && P.UI.botAiming) { wantAim = true; aimX = P.UI.botAimX; aimY = P.UI.botAimY; power = P.UI.botPower || 0; }
      }
      if (wantAim && state.cue) {
        var cue = state.cue;
        var dx = -(aimX - cue.x), dy = -(aimY - cue.y);
        var dlen = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dlen; dy /= dlen;
          /* tip of the cue in world space: the single point both the stick nose and
             the aim line share, so the trajectory reads as being fired from the
             stick tip instead of floating next to it */
          var tipX = cue.x - dx * C.BR, tipY = cue.y - dy * C.BR;
          var nose = l2w(tipX, tipY, REST_Y);

          /* which object ball will be struck first? Marker + felt ring sit at the
             predicted impact point on its surface; fall back to the rail line when
             the shot goes empty. */
          var fc = firstContact(cue.x, cue.y, dx, dy, state.balls);
          var lenL = rayToFeltLen(cue.x, cue.y, dx, dy);
          var gx = fc.ball ? fc.impactX : cue.x + dx * lenL;
          var gy = fc.ball ? fc.impactY : cue.y + dy * lenL;

         aimLineMesh.visible = true; shaftMesh.visible = true; buttMesh.visible = true;
         orientAlong(aimLineMesh, nose, l2w(gx, gy, REST_Y), C.BR * 0.2);
         targetRingMesh.position.copy(l2w(gx, gy, 0.4));
         if (fc.ball) {
           /* a struck ball exists: bright dot floats above its centre and the felt
              ring circles it, so both read clearly from the overhead view */
           targetMesh.visible = true;
           targetMesh.position.copy(l2w(fc.ball.x, fc.ball.y, REST_Y + C.BR * 2.4));
         } else {
           /* empty shot: only the rail-line ring is shown */
           targetMesh.visible = false;
         }
         targetRingMesh.visible = true;
                 /* Cue charging = rigid recede, not stretch: the stick keeps its constant rest
          length (CUE_STICK_LEN) and translates backward along -dir as power rises — the
          tip leaves ball contact and the whole cue moves away from the ball. Max back-
          pull is capped by _cueMaxOnScreenOff so the butt end is always fully visible,
          in every aim orientation (never clipped at the frame border). */
       var SL = C.CUE_STICK_LEN;
       var rec = 0;
       if (power > 0) {
         var vw = renderer.domElement.width, vh = renderer.domElement.height;
         var maxOff = _cueMaxOnScreenOff(dx, dy, cue.x, cue.y, C.BR + SL, vw, vh);
          var recMax = Math.max(0, maxOff - (C.BR + SL));
          /* Cap back-pull at half a stick length so the tip stays between the ball and
             the pointer; the on-screen cap (recMax) still prevents frame clipping. */
          rec = power * Math.min(recMax, C.CUE_MAX_RECED);
       }
       /* Lean-back cue: rigid stick, group origin at the tip. The tip sits BR plus the
          power-driven back-pull "rec" from the ball on -dir; the butt end is exactly
          SL behind it and lifted so it reads as a held stroke. Changing aim rotates
          the cue about the tip; changing power translates it backward without altering
          its length. Split 80/20 into a light shaft and a darker ebony butt. */
        var tp = l2w(cue.x - dx * (C.BR + rec), cue.y - dy * (C.BR + rec), REST_Y);
       var buttOff = C.BR + rec + SL;
       var bEnd = new THREE.Vector3(
         l2w(cue.x - dx * buttOff, cue.y - dy * buttOff, REST_Y).x,
         REST_Y + buttOff * 0.14,
         l2w(cue.x - dx * buttOff, cue.y - dy * buttOff, REST_Y).z);
      var dirFromTip = new THREE.Vector3().subVectors(bEnd, tp);
      if (dirFromTip.lengthSq() < 1e-6) {
        cueGroup.visible = false;
      } else {
        cueGroup.visible = true;
        cueGroup.position.copy(tp);
         cueGroup.quaternion.setFromUnitVectors(UP, dirFromTip.normalize());
        var shaftLen = SL * 0.8;
        shaftMesh.position.set(0, shaftLen * 0.5, 0);
        shaftMesh.quaternion.identity();
        shaftMesh.scale.set(C.CUE_SHAFT_W * 0.5, shaftLen, C.CUE_SHAFT_W * 0.5);
        var buttLen = SL - shaftLen;
        buttMesh.position.set(0, shaftLen + buttLen * 0.5, 0);
        buttMesh.quaternion.identity();
         buttMesh.scale.set(C.CUE_SHAFT_W * 0.65, buttLen, C.CUE_SHAFT_W * 0.65);
       }


        /* Optional on-screen aim debug: while aiming, log the cursor's screen angle
           vs the cue tip's screen angle (both relative to the projected ball centre).
           Enable in the browser console with P.DEBUG_AIM_LOG = true, then aim.
           Off by default; never affects gameplay. */
        if (P.DEBUG_AIM_LOG) {
          var _dbgNow = performance.now();
          if (!P._aimLogT || _dbgNow - P._aimLogT > 120) {
            P._aimLogT = _dbgNow;
            var _r = P.UI.canvas && P.UI.canvas.getBoundingClientRect
                ? P.UI.canvas.getBoundingClientRect() : null;
            var _cw = _r ? _r.width : (renderer.domElement.clientWidth || 1);
            var _ch = _r ? _r.height : (renderer.domElement.clientHeight || 1);
            var _bScr = _ptToCanvas(l2w(cue.x, cue.y, REST_Y), _cw, _ch);
            var _tScr = _ptToCanvas(l2w(tipX, tipY, REST_Y), _cw, _ch);
            var _pcx = P.UI.lastPtr ? P.UI.lastPtr.x - (_r ? _r.left : 0) : 0;
            var _pcy = P.UI.lastPtr ? P.UI.lastPtr.y - (_r ? _r.top : 0) : 0;
            var _curA = Math.atan2(_pcy - _bScr.y, _pcx - _bScr.x);
            var _tipA = Math.atan2(_tScr.y - _bScr.y, _tScr.x - _bScr.x);
            var _diff = (_tipA - _curA + Math.PI) % (Math.PI * 2) - Math.PI;
            var _d = function (x) { return (x * 180 / Math.PI).toFixed(1); };
            console.log('[AIMDBG]', JSON.stringify({
              ballScr: [+_bScr.x.toFixed(1), +_bScr.y.toFixed(1)],
              cursorScr: [+(_pcx).toFixed(1), +(_pcy).toFixed(1)],
              tipScr: [+(_tScr.x.toFixed(1)), +(_tScr.y.toFixed(1))],
              aimLogical: [+(aimX).toFixed(1), +(aimY).toFixed(1)],
              cueLogical: [+(cue.x).toFixed(1), +(cue.y).toFixed(1)],
              cursorDeg: _d(_curA), tipDeg: _d(_tipA), diffDeg: _d(_diff)
            }));
          }
        }
        } else {
          aimLineMesh.visible = false; targetMesh.visible = false; targetRingMesh.visible = false;
         cueGroup.visible = false;
       }

      /* float messages (billboards, rise + fade) */
      for (var f = floats3d.length - 1; f >= 0; f--) {
        var ft = floats3d[f];
        var t = Math.min(1, (now - ft.t0) / ft.life);
        if (t >= 1) {
          if (ft.sprite.material.map) ft.sprite.material.map.dispose();
          scene.remove(ft.sprite);
          floats3d.splice(f, 1);
          continue;
        }
        ft.sprite.position.set(0, REST_Y + 20 + t * (C.MSG_RISE || 80), 0);
        ft.sprite.material.opacity = Math.max(0, (1 - t) * 0.95);
       }
       }

       /* game-over centre card (DOM, pointer-events:none so clicks reach the canvas) */
      if (goEl) {
        if (state && state.gameOver) {
          goEl.style.display = 'flex';
          if (goNameEl) goNameEl.textContent = (state.winner && state.winner.name) || '?';
        } else {
          goEl.style.display = 'none';
        }
      }

       renderer.render(scene, camera);
      /* triage (DEBUG_BG only): proves a frame with the backdrop actually hit the screen. */
      if (DEBUG_BG && !bgFirstFrame) {
        bgFirstFrame = true;
        if (console && console.info) {
          console.info('[BG_DBG] step 2: first frame rendered. If still black, report all [BG_DBG] lines + any Console errors + the exact URL where index.html was opened.');
        }
      }
     },
    pop: function (text, rgbStr) {
      if (!renderer || !scene) return;
      var cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
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
      m.position.set(0, REST_Y + 20, 0);
      scene.add(m);
      floats3d.push({ sprite: m, t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()), life: C.FLASH_MS || 1800 });
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
        return _aimFromScreen(px, py, cssW, cssH, cx, cy);
      }
      return _screenToLogical(px, py, cssW, cssH);
    }
  };
})();