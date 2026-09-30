/* Character viewer: full-screen canvas with its own WebGL scene for the
   billiard-ball character — orbit camera (drag to rotate, wheel/pinch to zoom),
   floor + shadow, and control buttons (WALK/IDLE, BALL <-> CHARACTER, BACK TO
   MENU). Built once, hidden/shown; exposed as window.Poole.Viewer ({ open, close }). */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};

  /* named constants (viewer world units, character body radius 50) */
  var CAM_NEAR = 0.1, CAM_FAR = 3000;
  var CAM_MIN_D = 90, CAM_MAX_D = 420;
  var CAM_START_D = 235;
  var TARGET_X = 0, TARGET_Y = -8, TARGET_Z = 0;
  var FLOOR_Y = -51;
  var AUTO_ROT_SPEED = 0.14;    /* rad/s idle auto-orbit */
  var POLAR_MIN = 0.16, POLAR_MAX = 1.45;
  var ROT_SENS = 0.005;        /* radians per px of drag */
  var ZOOM_SENS = 0.0012;      /* exp factor per wheel unit */
  var FADE_MS = 300;

  var canvasEl = null, renderer = null, scene = null, camera = null;
  var charRef = null, floorMesh = null, gridMesh = null;
  var rootEl = null, walkBtn = null, morphBtn = null, backBtn = null;
  var rafId = null, built = false, openFlag = false;
  var onBack = null;

  /* orbit state */
  var azim = 0.55, polar = 1.02, camDist = CAM_START_D;
  var dragging = false, lastX = 0, lastY = 0;
  var pointers = {};           /* pointerId -> {x,y}, used for pinch */
  var pinchBase = 0;
  var lastT = 0;

  function buildDom() {
    rootEl = W.document.createElement("div");
    rootEl.id = "viewer-root";

    canvasEl = W.document.createElement("canvas");
    canvasEl.id = "viewer-canvas";
    rootEl.appendChild(canvasEl);

    var ui = W.document.createElement("div");
    ui.className = "viewer-ui";

    walkBtn = W.document.createElement("button");
    walkBtn.type = "button";
    walkBtn.className = "viewer-btn";
    walkBtn.textContent = "WALK";
    walkBtn.addEventListener("click", function () {
      if (!charRef) return;
      charRef.setMode(charRef.mode === "walk" ? "idle" : "walk");
      walkBtn.textContent = charRef.mode === "walk" ? "IDLE" : "WALK";
    });

    morphBtn = W.document.createElement("button");
    morphBtn.type = "button";
    morphBtn.className = "viewer-btn";
    morphBtn.textContent = "BALL";
    morphBtn.addEventListener("click", function () {
      if (!charRef) return;
      charRef.setTransform(charRef.morphT > 0.5 ? "ball" : "char");
      /* label flips after the spring settles, not on press, so it never lags */
      setTimeout(function () {
        if (charRef && openFlag) morphBtn.textContent = charRef.morphT > 0.5 ? "BALL" : "CHARACTER";
      }, FADE_MS * 2);
    });

    backBtn = W.document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "viewer-btn";
    backBtn.textContent = "BACK TO MENU";
    backBtn.addEventListener("click", function () { goBack(); });

    var hint = W.document.createElement("span");
    hint.className = "viewer-hint";
    hint.textContent = "DRAG TO ORBIT  \u00B7  WHEEL TO ZOOM";
    ui.appendChild(walkBtn);
    ui.appendChild(morphBtn);
    ui.appendChild(backBtn);
    ui.appendChild(hint);
    rootEl.appendChild(ui);

    W.document.body.appendChild(rootEl);
  }

  function buildScene() {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvasEl });
    } catch (e) {
      if (console && console.error) console.error("[viewer] WebGL unavailable:", e);
      return false;
    }
    renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, 2));
    renderer.setSize(W.innerWidth, W.innerHeight, false);
    renderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowMap) renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1c33);

    camera = new THREE.PerspectiveCamera(55, W.innerWidth / Math.max(W.innerHeight, 1), CAM_NEAR, CAM_FAR);
    applyCamera();

    /* lights: soft room fill + one shadow-casting key light */
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a1f16, 1.0));
    var dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(90, 160, 110);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 500;
    dir.shadow.camera.left = -80; dir.shadow.camera.right = 80;
    dir.shadow.camera.top = 80; dir.shadow.camera.bottom = -80;
    dir.shadow.bias = -0.002;
    scene.add(dir);

    /* floor + faint grid */
    floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: 0x1a2b45, roughness: 0.9, metalness: 0.05 }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = FLOOR_Y;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    gridMesh = new THREE.GridHelper(400, 20, 0x2a4f78, 0x16314d);
    gridMesh.position.y = FLOOR_Y + 0.02;
    scene.add(gridMesh);

    /* character: ball centre at y=0, feet bottom at -50 (floor at -51) */
    if (P.Character && typeof P.Character.create === "function") {
      charRef = P.Character.create({ ballId: "11" });
      scene.add(charRef.group);
    }

    return true;
  }

  /* orbit camera: polar/azimuth -> position, lookAt target */
  function applyCamera() {
    var x = Math.sin(polar) * Math.cos(azim);
    var y = Math.cos(polar);
    var z = Math.sin(polar) * Math.sin(azim);
    camera.position.set(TARGET_X + x * camDist, TARGET_Y + y * camDist, TARGET_Z + z * camDist);
    camera.lookAt(TARGET_X, TARGET_Y, TARGET_Z);
  }

  function loop(now) {
    rafId = W.requestAnimationFrame(loop);
    var t = now ? now : (typeof performance !== "undefined" ? performance.now() : Date.now());
    var dt = (t - lastT) / 1000;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    lastT = t;

    if (openFlag && charRef) charRef.update(dt);
    if (openFlag && !dragging) azim += AUTO_ROT_SPEED * dt;
    applyCamera();
    renderer.render(scene, camera);
  }

  function startLoop() {
    if (rafId !== null) return;
    lastT = typeof performance !== "undefined" ? performance.now() : Date.now();
    rafId = W.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId !== null) { try { W.cancelAnimationFrame(rafId); } catch (e) {} rafId = null; }
  }

  function goBack() {
    close();
    if (typeof onBack === "function") onBack();
  }

  /* orbit: one pointer drags, two pointers pinch */
  function ptrDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function onPointerDown(e) {
    if (!openFlag) return;
    canvasEl.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(pointers).length === 1) {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
    } else if (Object.keys(pointers).length === 2) {
      var ids = Object.keys(pointers);
      pinchBase = ptrDist(pointers[ids[0]], pointers[ids[1]]);
    }
  }

  function onPointerMove(e) {
    if (!openFlag || !pointers[e.pointerId]) return;
    var p = pointers[e.pointerId];
    p.x = e.clientX; p.y = e.clientY;
    if (Object.keys(pointers).length === 2) {
      var ids = Object.keys(pointers);
      var d = ptrDist(pointers[ids[0]], pointers[ids[1]]);
      if (pinchBase > 4) {
        camDist *= d / pinchBase;
        pinchBase = d;
        if (camDist < CAM_MIN_D) camDist = CAM_MIN_D;
        if (camDist > CAM_MAX_D) camDist = CAM_MAX_D;
      }
    } else if (dragging) {
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      azim += dx * ROT_SENS;
      polar += dy * ROT_SENS;
      if (polar < POLAR_MIN) polar = POLAR_MIN;
      if (polar > POLAR_MAX) polar = POLAR_MAX;
    }
  }

  function onPointerUp(e) {
    delete pointers[e.pointerId];
    dragging = false;
    pinchBase = 0;
  }

  function onWheel(e) {
    if (!openFlag) return;
    e.preventDefault();
    camDist *= Math.exp(-e.deltaY * ZOOM_SENS);
    if (camDist < CAM_MIN_D) camDist = CAM_MIN_D;
    if (camDist > CAM_MAX_D) camDist = CAM_MAX_D;
  }

  function onResize() {
    if (!renderer) return;
    renderer.setSize(W.innerWidth, W.innerHeight, false);
    camera.aspect = W.innerWidth / Math.max(W.innerHeight, 1);
    camera.updateProjectionMatrix();
  }

  function onKey(e) {
    if (openFlag && e.key === "Escape") goBack();
  }

  P.Viewer = {
    /* open: build once if needed, fade in the overlay and start rendering.
       onBack: called by BACK TO MENU / Esc when the viewer closes. */
    open: function (onBackCb) {
      if (openFlag) return;
      onBack = typeof onBackCb === "function" ? onBackCb : null;
      if (!built) {
        buildDom();
        built = buildScene();
        W.addEventListener("resize", onResize);
      }
      openFlag = true;
      rootEl.classList.add("show");
      if (charRef) {
        charRef.setMode("idle");
        charRef.setTransform("char");   /* viewer opens on the character */
      }
      morphBtn.textContent = "BALL";
      walkBtn.textContent = "WALK";
      W.addEventListener("pointerdown", onPointerDown);
      W.addEventListener("pointermove", onPointerMove);
      W.addEventListener("pointerup", onPointerUp);
      W.addEventListener("pointercancel", onPointerUp);
      W.addEventListener("wheel", onWheel, { passive: false });
      W.addEventListener("keydown", onKey);
      startLoop();
    },

    /* true while the viewer overlay is open (used by tests / e2e) */
    isOpen: function () { return openFlag; },

    /* close: fade out and stop rendering; scene is kept for a fast re-open */
    close: function () {
      if (!openFlag) return;
      openFlag = false;
      rootEl.classList.remove("show");
      W.removeEventListener("pointerdown", onPointerDown);
      W.removeEventListener("pointermove", onPointerMove);
      W.removeEventListener("pointerup", onPointerUp);
      W.removeEventListener("pointercancel", onPointerUp);
      W.removeEventListener("wheel", onWheel);
      W.removeEventListener("keydown", onKey);
      stopLoop();
    }
  };
})();
