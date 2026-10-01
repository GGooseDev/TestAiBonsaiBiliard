/* Scene construction + camera framing. init() builds the whole 3D scene once (idempotent);
   frameCamera fits the felt+rails to the viewport; _onZoomWheel sets the zoom target.
   Exports S.initFn and S.frameCamera so api.js can call them. */
(function () {
  var W = window, P = W.Poole, C = P.CONFIG;
  var S = P._WebGL;

  /* fit the camera so the felt + raised rail always fill the frame with margin.
     TILT_DEG is measured from straight-down: 0 = top-down, 90 = side view.
     Lower values give a higher, more overhead angle so the whole field shows. */
  function frameCamera(w, h) {
    if (!S.camera) return;
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    var tH = Math.tan(THREE.MathUtils.degToRad(S.FOV / 2));
    var tV = tH / Math.max(w / h, 0.001);
    var extX = S.HALF_W + S.RAIL_DEPTH * 1.35;
    var extZ = S.HALF_H + S.RAIL_DEPTH * 1.35 + S.RAIL_H * 0.7;
    var D = Math.max(extX / tH, extZ / tV) * S.FRAMEMARGIN;
    S.baseCamPos.set(
      0,
      D * Math.cos(THREE.MathUtils.degToRad(S.TILT_DEG)),
      D * Math.sin(THREE.MathUtils.degToRad(S.TILT_DEG))
    );
    S.farLookAt.set(0, S.RAIL_H * 0.2, 0);
    /* top-down end: straight down over the field centre, plus zoom (NEAR_ZOOM < 1) */
    S.nearCamPos.set(0, D * S.NEAR_ZOOM, 0);
    S.scene.add(S.camera);
       S.camera.lookAt(S.farLookAt.x, S.farLookAt.y, S.farLookAt.z);
  }

  /* ---- scene building ---- */
   function init(canvas) {
    /* triage (DEBUG_BG only): DOM banner + console line proving webgl3d.js executed and
       init() started, before any GL work. If there is NOT a single "[BG_DBG]" line in the
       F12 Console -> this script did not run at all (wrong folder / stale copy / an
       earlier script error), so the black screen is not a shader issue. */
    if (S.DEBUG_BG) {
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
    if (!W.THREE) {
      S.showInitFail("WebGL rendering unavailable: THREE.js did not load.");
      return;
    }
    /* Idempotent: the #game canvas already holds one GL context after the first
       call, so a second init() must not try to create another (that throws with
       "Canvas has an existing context of a different type"). */
    if (S.created) {
      if (S.renderer) { S.renderer.setSize(W.innerWidth, W.innerHeight, false); }
      if (S.scene) frameCamera(W.innerWidth, W.innerHeight);
      return;
    }
    S.created = true;

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
       S.renderer = new THREE.WebGLRenderer(opts);
       S.renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, 2));
       S.renderer.setSize(W.innerWidth, W.innerHeight, false);
     } catch (e) {
       if (console && console.error) console.error("webgl3d: WebGL context unavailable:", e);
       S.showInitFail("WebGL is not available in this browser. Use a recent Chrome/Edge/Firefox/Safari with hardware acceleration enabled, then hard-reload (Ctrl+Shift+R).");
       return;
     }
    S.renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowType !== undefined) S.renderer.shadowMap.type = THREE.PCFSoftShadowType;
    else S.renderer.shadowMap.type = 1;
    S.renderer.setClearColor(0x14233f, 1); /* plain dark background, unchanged */

    S.scene = new THREE.Scene();
    /* dim room backdrop so the overhead frame has context (no empty black void) */
    S.scene.background = new THREE.Color(0x14233f);
    /* one toggleable group for the whole table (felt + cab + legs + rails + pockets
       + balls + cue/aim overlays) so the menu backdrop loop can render only the bokeh room */
    S.tableGroup = new THREE.Group();
    S.scene.add(S.tableGroup);
    S.camera = new THREE.PerspectiveCamera(S.FOV, W.innerWidth / W.innerHeight, 5, 3000);
    S.raycaster = new THREE.Raycaster();
    S.hitPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); /* raycast the felt surface (y = 0) so pointer aim maps onto the table, not the elevated ball-centre height */

    S.scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    var dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(-600, 1400, 800);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -720;  dir.shadow.camera.right = 720;
    dir.shadow.camera.top = 600;   dir.shadow.camera.bottom = -600;
    dir.shadow.camera.near = 200;  dir.shadow.camera.far = 4200;
    S.scene.add(dir);
    var lamp = new THREE.PointLight(0xfff1d8, 0.55);
    lamp.position.set(0, 900, -260);
    S.scene.add(lamp);

    S.HALF_W = (C.IX1 - C.IX0) / 2; S.HALF_H = (C.IY1 - C.IY0) / 2;
    S.CXw = C.IX0 + S.HALF_W; S.CYw = C.IY0 + S.HALF_H;

    /* Felt albedo: paint P.Noise.sampleFelt into a square canvas, then tile it over the
       felt slab. The grain is period-1 in (u,v), so RepeatWrapping shows no seams;
       repeat 2x1 (scaled up from 4x2) keeps it isotropic across the 932x492 felt; grain ~2x bigger (~5 u). */
    function makeFeltTexture() {
      var S = 256;
      var cv = W.document.createElement('canvas');
      cv.width = cv.height = S;
      var ctx = cv.getContext('2d');
      var img = ctx.createImageData(S, S);
      var d = img.data;
      for (var py = 0; py < S; py++) {
        for (var px = 0; px < S; px++) {
          var c = P.Noise.sampleFelt(px / S, py / S);
          var o = (py * S + px) * 4;
          d[o] = c.r; d[o + 1] = c.g; d[o + 2] = c.b; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      var tex = new THREE.CanvasTexture(cv);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 1);
      tex.needsUpdate = true;
      return tex;
    }

    /* texture carries the felt's own green tint, so colour is left white to pass it through */
    var feltMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeFeltTexture(), roughness: 0.95 });
    var railMat = new THREE.MeshStandardMaterial({ color: 0x6e3b1e, roughness: 0.55 });
    var cabMat = new THREE.MeshStandardMaterial({ color: 0x52341d, roughness: 0.7 });

    /* felt slab, top surface at y=0 */
    var felt = new THREE.Mesh(new THREE.BoxGeometry(C.IX1 - C.IX0, S.FELT_THICK, C.IY1 - C.IY0), feltMat);
    felt.position.set(0, -S.FELT_THICK / 2, 0);
    felt.receiveShadow = true;
    S.tableGroup.add(felt);

    /* cabinet under the felt */
    var cabW = (C.IX1 - C.IX0) + S.RAIL_DEPTH * 2.4, cabHgt = (C.IY1 - C.IY0) + S.RAIL_DEPTH * 2.4;
    var cab = new THREE.Mesh(new THREE.BoxGeometry(cabW, S.CAB_H, cabHgt), cabMat);
    cab.position.set(0, -S.FELT_THICK / 2 - S.CAB_H / 2, 0);
    cab.receiveShadow = true;
    S.tableGroup.add(cab);

    /* legs below the cabinet */
    var legLen = 150;
    var legGeo = new THREE.CylinderGeometry(26, 26, legLen, 12);
    var legTopY = -S.FELT_THICK / 2 - S.CAB_H;
    for (var lx = -1; lx <= 1; lx += 2) for (var lz = -1; lz <= 1; lz += 2) {
      var leg = new THREE.Mesh(legGeo, cabMat);
      leg.position.set(lx * S.HALF_W, legTopY - legLen / 2, lz * S.HALF_H);
        leg.castShadow = true;
        S.tableGroup.add(leg);
    }

    /* room backdrop below/around the cabinet: an animated bokeh field of soft,
       out-of-focus lights so the overhead frame reads as a real table room, not
       an empty void. Slightly larger than the felt+rails to fill the visible
       background; uTime is advanced in draw(). */
     /* 3.5x margin so the colored glint field clearly exceeds the framed view at
        any window aspect ratio (check-bg-extent.js verified coverage up to ~3.5:1) */
      var bokehSide = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + S.RAIL_DEPTH * 16) * 3.5;
    var bh = S.assets.makeBokehFloor(bokehSide);
    bh.mesh.position.set(0, legTopY - legLen - 5, 0); /* sits just under the legs */
    S.scene.add(bh.mesh);
    S.bokehMat = bh.mat;
    S.bokehMesh = bh.mesh;
    S.bokehMeshBasePos.copy(S.bokehMesh.position);
    /* triage (DEBUG_BG only): a semi-transparent bright red quad in front of the glint
       backdrop, 0xff1111 deliberately outside C.BOKEH_PALETTE. Purpose:
       - red tint over the field -> renderer, camera/frustum and shader all work;
       - still pure black -> problem is before this quad (GL context / frustum /
         scene build), i.e. one of console steps 0/1 above failed. */
    if (S.DEBUG_BG) {
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
      S.scene.add(dbQuad);
    }

    /* raised rails hugging the felt edge */
    var sides = [];
    for (var sideZ = -1; sideZ <= 1; sideZ += 2) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(C.IX1 - C.IX0 + S.RAIL_DEPTH * 2, S.RAIL_H, S.RAIL_DEPTH), railMat);
      r.position.set(0, S.RAIL_H / 2, sideZ * S.HALF_H + sideZ * S.RAIL_DEPTH * 0.5);
      r.castShadow = true; r.receiveShadow = true;
      sides.push(r);
    }
    for (var sideX = -1; sideX <= 1; sideX += 2) {
      var l = new THREE.Mesh(new THREE.BoxGeometry(S.RAIL_DEPTH, S.RAIL_H, C.IY1 - C.IY0 + S.RAIL_DEPTH * 2), railMat);
      l.position.set(sideX * S.HALF_W + sideX * S.RAIL_DEPTH * 0.5, S.RAIL_H / 2, 0);
      l.castShadow = true; l.receiveShadow = true;
      sides.push(l);
    }
    for (var s = 0; s < sides.length; s++) S.tableGroup.add(sides[s]);

    /* pockets: dark discs recessed just under the felt top */
    var pocketGeo = new THREE.CylinderGeometry(C.POCKET_R, C.POCKET_R * 0.7, 5, 18);
    var pocketMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    for (var pi = 0; pi < C.pockets.length; pi++) {
      var p = C.pockets[pi];
      var pm = new THREE.Mesh(pocketGeo, pocketMat);
        pm.position.copy(S.coords.l2w(p.x, p.y, -1));
        S.tableGroup.add(pm);
    }

    /* balls (standard material + generated number texture; one mesh per id) */
    S.ballsById = {};
    var ballGeo = new THREE.SphereGeometry(C.BR, 32, 24);
    var allIds = ['cue'];
    for (var n = 1; n <= 15; n++) allIds.push(n);
    for (var bi = 0; bi < allIds.length; bi++) {
      var id = allIds[bi];
      var mat = new THREE.MeshStandardMaterial({ map: S.assets.makeBallTexture(id), roughness: 0.35, metalness: 0.05 });
      var bm = new THREE.Mesh(ballGeo, mat);
        bm.castShadow = true; bm.receiveShadow = true;
        bm.visible = id === 'cue';
        S.tableGroup.add(bm);
      S.ballsById[id] = bm;
    }

    /* aim line + first-contact target + cue stick. All three use bright opaque basic
       materials with raised renderOrder so they read clearly above the lit scene
       from the overhead view (the previous semi-transparent targets were nearly
       invisible against the felt). */
    var unitCyl = new THREE.CylinderGeometry(1, 1, 1, 24);
    /* aim line is a UI overlay: never let the scene occlude it (see I2), so depthTest is
       off. depthWrite stays off so the guide cannot hide balls from other overlays. */
    /* dashed line, not a solid cylinder: dashes clearly separate the trajectory from
       the collinear cue stick so it reads as "from the ball", not a rod through it. */
    S.aimLineMesh = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]),
      new THREE.LineBasicMaterial({ color: 0xffe86b, depthWrite: false, depthTest: false }));
    S.aimLineMesh.renderOrder = 9;
    S.aimLineMesh.visible = false; S.tableGroup.add(S.aimLineMesh);
    /* compact bright dot floated above the struck ball centre: unambiguously flags
       "this is the ball you will hit" without hiding its number */
    S.targetMesh = new THREE.Mesh(new THREE.SphereGeometry(C.BR * 0.45, 16, 12),
                                  new THREE.MeshBasicMaterial({ color: 0xffffff }));
    S.targetMesh.renderOrder = 9;
    S.targetMesh.visible = false; S.tableGroup.add(S.targetMesh);
    /* flat ring on the felt around the predicted contact point: from the overhead
       camera a solid dot alone does not read, so this ground ring makes the shot's
       landing spot unambiguous. Lies just above the felt top, facing up. */
    S.targetRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(C.BR * 1.5, C.BR * 2.2, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe86b }));
    S.targetRingMesh.renderOrder = 10;
    S.targetRingMesh.rotation.x = -Math.PI / 2; /* face up onto the felt */
    S.targetRingMesh.visible = false; S.tableGroup.add(S.targetRingMesh);
    /* two-segment cue stick (the handle was always two pieces: a lighter tapered
        shaft and a darker ebony butt). Both segments are parented under one group
        whose origin is the tip (nose) contact point, so re-aiming rotates the whole
        stick about the nose at the ball instead of spinning about its centre.
        Shaded standard materials + scene lights so it reads as a real lit object. */
    var shaftMat = new THREE.MeshStandardMaterial({ color: 0xf3dca6, roughness: 0.35, metalness: 0 });
    var buttMat  = new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 0.45, metalness: 0 });
    S.cueGroup = new THREE.Group();
    S.tableGroup.add(S.cueGroup);
    S.shaftMesh = new THREE.Mesh(unitCyl, shaftMat);
    S.shaftMesh.visible = false; S.shaftMesh.castShadow = true; S.shaftMesh.receiveShadow = true; S.cueGroup.add(S.shaftMesh);
    S.buttMesh = new THREE.Mesh(unitCyl, buttMat);
    S.buttMesh.visible = false; S.buttMesh.castShadow = true; S.buttMesh.receiveShadow = true; S.cueGroup.add(S.buttMesh);

    S.floats3d = [];
    S.goNameEl = W.document.getElementById('go-name');
    S.goEl = W.document.getElementById('gameover');

    frameCamera(W.innerWidth, W.innerHeight);
    /* public flag: true once init() secured a working WebGL context. The
       WebGLRenderer constructor throws if it can't obtain a context, so reaching
       this line means GL is available. Consumers gate on this instead of
       re-requesting (possibly type-mismatched) contexts from the canvas. */
       S.glReady = !!S.renderer;
       /* wheel -> zoom target (smooth per-frame easing lives in draw()) */
       if (!S.DEBUG_BG && W.document) {
         W.document.addEventListener('wheel', _onZoomWheel, { passive: false });
       }
       /* triage (DEBUG_BG only): GL context + full scene build done; the backdrop plane,
          foreground meshes and the red debug quad are in the scene now. */
       if (S.DEBUG_BG && console && console.info) {
         console.info('[BG_DBG] step 1: GL context ready, scene built (backdrop + red debug quad). Red tint over glints = renderer/camera/shader all OK.');
       }
    }

  /* wheel -> zoom target. Wheel up moves toward the top-down end (closer); the
     actual transition is eased per-frame in draw(), so each notch glides to its
     new level and continuous trackpad deltas stay smooth. preventDefault stops
     page scroll; non-passive is required for that in modern browsers. */
  function _onZoomWheel(e) {
    if (S.DEBUG_BG || !S.camera) return;
    e.preventDefault();
    var dy = e.deltaY || 0;
    S.zoomTargetT = Math.max(0, Math.min(1, S.zoomTargetT - dy * S.ZOOM_SENS));
  }

  S.initFn = init;
  S.frameCamera = frameCamera;
})();
