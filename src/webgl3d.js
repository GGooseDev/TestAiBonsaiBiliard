/* True-3D WebGL renderer (Three.js, from lib/three.min.js). Owns a camera that
   frames the felt with the raised rail hugging the field edge, and reads P.State
   each frame to position lit spherical balls + cue. Pointer->logical aiming uses
   a ray cast onto the felt plane (perspective-correct). Room context comes from
   a single animated bokeh backdrop shader; all foreground objects use standard
   materials (no post-processing). */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};
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
  var bokehMat = null;          /* animated room-backdrop shader (set in init) */
  var floats3d = [], goEl = null, goNameEl = null;
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
  var FELT_TOP_Y = 0,      /* top surface of the felt */
      FELT_THICK = 12,     /* felt slab thickness (centered below its top)   */
      REST_Y = C.BR;       /* ball centre height above felt top */

  function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }

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

  /* Build the animated room-backdrop (bokeh) floor. N soft, out-of-focus light
     discs drift and pulse in uv space so the area around the table reads as a
     blurred camera background. Foreground (balls / rails / cue) stays on standard
     lit materials; this single shader is purely decorative backdrop. */
  function makeBokehFloor(side) {
    var N = 14,
        posArr = new Float32Array(N * 2),
        radArr = new Float32Array(N),
        colArr = new Float32Array(N * 3);
    for (var i = 0; i < N; i++) {
      posArr[i * 2]     = Math.random();      /* centre across the plane (uv) */
      posArr[i * 2 + 1] = Math.random();
      var rLw = C.BOKEH_MIN_R + Math.random() * C.BOKEH_VAR_R;
      radArr[i]         = rLw / side;         /* world units -> uv radius */
      var warm = 1 - Math.random() * 0.55,     /* warm lamp light       */
          cool = Math.random() * 0.45,         /* cooler accent         */
          m    = 0.32 + Math.random() * 0.38;  /* overall glow intensity */
      colArr[i * 3]     = m * (0.98 * warm + 0.04 * cool);
      colArr[i * 3 + 1] = m * (0.86 * warm + 0.16 * cool);
      colArr[i * 3 + 2] = m * (0.66 * warm + 0.42 * cool);
    }
    var VS = "varying vec2 vUv; void main(){ vUv = uv; vec4 p = modelMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * viewMatrix * p; }";
    var fs = [
      "precision mediump float;",
      "uniform float uTime;",
      "uniform vec2 uSpotPos[" + N + "];",
      "uniform float uSpotR[" + N + "];",
      "uniform vec3 uSpotCol[" + N + "];",
      "uniform vec3 uBg;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec2 c = vUv - 0.5;",
      "  vec3 col = uBg;",
      "  for (int j = 0; j < " + N + "; j++) {",
      "    float ox = sin(uTime * 0.13 + j * 2.4) * 0.045;",
      "    float oy = cos(uTime * 0.11 + j * 3.1) * 0.045;",
      "    vec2 d = c - (uSpotPos[j] - 0.5 + vec2(ox, oy));",
      "    float rr = uSpotR[j] * (1.0 + 0.16 * sin(uTime * 0.7 + j * 1.9));",
      "    float t = length(d) / max(rr, 0.004);",
      "    float core = exp(-t * t * 2.3);",
      "    float halo = exp(-t * t * 0.85) * 0.3;",
      "    float ring = exp(-pow(max(t - 1.05, 0.0) * 3.5, 2.0)) * 0.45;",
      "    col += uSpotCol[j] * (core + halo + ring);",
      "  }",
      "  col *= mix(1.0, 0.45, smoothstep(0.30, 1.0, length(c)));",
      "  gl_FragColor = vec4(col, 1.0);",
      "}"
    ];
    var mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: fs.join("\n"),
      uniforms: {
        uTime:    { value: 0 },
        uSpotPos: { value: posArr },
        uSpotR:   { value: radArr },
        uSpotCol: { value: colArr },
        uBg:      { value: new THREE.Color(0x0a0c11) }
      },
      side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
    mesh.rotation.x = -Math.PI / 2;          /* flat, normal points +Y (overhead view) */
    return { mesh: mesh, mat: mat };
  }

  /* ---- scene building ---- */
  function init(canvas) {
    if (!window.THREE) return;
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
    var opts = { antialias: true };
    if (canvas) opts.canvas = canvas;
    renderer = new THREE.WebGLRenderer(opts);
    renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, 2));
    renderer.setSize(W.innerWidth, W.innerHeight, false);
    renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowType !== undefined) renderer.shadowMap.type = THREE.PCFSoftShadowType;
    else renderer.shadowMap.type = 1;
    renderer.setClearColor(0x0b0e12, 1); /* plain dark background, unchanged */

    scene = new THREE.Scene();
    /* dim room backdrop so the overhead frame has context (no empty black void) */
    scene.background = new THREE.Color(0x0a0c11);
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
    var bokehSide = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + RAIL_DEPTH * 16) * 1.35;
    var bh = makeBokehFloor(bokehSide);
    bh.mesh.position.set(0, legTopY - legLen - 5, 0); /* sits just under the legs */
    scene.add(bh.mesh);
    bokehMat = bh.mat;

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
  }

  /* ---- public API -------------------------------------------------------- */
  P.WebGL3D = {
    ok: function() { return glReady; },           /* did init secure a real GL context? */
    init: function (canvas) { init(canvas); },
    resize: function (w, h) { if (!renderer) return; renderer.setSize(w, h, false); frameCamera(w, h); },
    draw: function (state) {
      if (!renderer) return;
       var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
       if (bokehMat) bokehMat.uniforms.uTime.value = now * 0.001; /* animate backdrop */

      /* camera shake (decaying jitter around the framed base position) */
      var shake = 0;
      if (state && state.shakeUntil > now) shake = Math.min(1, (state.shakeUntil - now) / (C.SHAKE_MS || 700));
      camOffset.set(
        Math.sin(now * 0.13 + 1.7) * 6 * shake,
        Math.sin(now * 0.11 + 2.2) * 4 * shake,
        Math.sin(now * 0.17 + 0.4) * 6 * shake);
      camera.position.copy(baseCamPos).add(camOffset);
      camera.lookAt(0, RAIL_H * 0.2, 0);

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
         var sl = C.CUE_STICK_LEN + power * C.CUE_MAX_EXTEND;
         /* Lean-back cue pivoted on its nose: the tip rests at the ball edge on the
            felt, and the butt end is pulled back along -dir and lifted so it reads as a
            held stroke. The single group origin sits on that tip contact point and the
            whole stick is laid out along one local axis, so changing aim rotates the
            cue about the nose at the ball (not its own centre). Split 80/20 into a
            light shaft and a darker ebony butt. */
          var tp = nose;           /* stick pivots about the exact tip the aim line starts from */
         var bEnd = new THREE.Vector3(
           l2w(cue.x - dx * sl, cue.y - dy * sl, REST_Y).x,
           REST_Y + sl * 0.14,
           l2w(cue.x - dx * sl, cue.y - dy * sl, REST_Y).z);
         var dirFromTip = new THREE.Vector3().subVectors(bEnd, tp);
         if (dirFromTip.lengthSq() < 1e-6) {
           cueGroup.visible = false;
         } else {
           cueGroup.visible = true;
           cueGroup.position.copy(tp);
            cueGroup.quaternion.setFromUnitVectors(UP, dirFromTip.normalize());
           var shaftLen = sl * 0.8;
           shaftMesh.position.set(0, shaftLen * 0.5, 0);
           shaftMesh.quaternion.identity();
           shaftMesh.scale.set(C.CUE_SHAFT_W * 0.5, shaftLen, C.CUE_SHAFT_W * 0.5);
           var buttLen = sl - shaftLen;
           buttMesh.position.set(0, shaftLen + buttLen * 0.5, 0);
           buttMesh.quaternion.identity();
           buttMesh.scale.set(C.CUE_SHAFT_W * 0.65, buttLen, C.CUE_SHAFT_W * 0.65);
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
    screenToTableLogical: function (px, py) {
      /* px/py arrive as raw viewport coordinates; rebase them onto the canvas so
         aiming stays correct even when the canvas is not anchored at (0,0). */
      var r = P.UI && P.UI.canvas && P.UI.canvas.getBoundingClientRect
        ? P.UI.canvas.getBoundingClientRect() : null;
      if (r) { px -= r.left; py -= r.top; }
      var cssW = r ? r.width : W.innerWidth, cssH = r ? r.height : W.innerHeight;
      return _screenToLogical(px, py, cssW, cssH);
    }
  };
})();