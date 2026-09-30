/* Startup menu: full-screen shader backdrop (warm "fire" bokeh, palette distinct
   from the cool table room) + a large bold title and three horizontal mode
   buttons. Classic fades the overlay out and hands control to P.Game.start();
   Viewer opens P.Viewer (the billiard-ball character scene); Battle Arena is
   still a "coming soon" placeholder. Exposed as window.Poole.Menu ({show, pick}).
   Loaded after THREE.js + config.js in index.html. */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  var N_ORBS = 40;              /* denser than the room field so the backdrop reads as a full bokeh wall, not sparse glints */
  var FADE_MS = 300;            /* menu exit fade, ms */
  var PARALLAX_UV = 0.07;       /* pointer offset mapped to uv (subtle depth cue) */

  var rootEl = null, canvasEl = null, toastEl = null;
  var renderer = null, scene = null, camera = null, mat = null, quadMesh = null;
  var rafId = null, built = false, exiting = false;
  var _cb = null;               /* onSelect callback registered via show() */
  var _pickedMode = null;       /* mode of the button pressed before teardown */
  var _px = 0, _py = 0;         /* raw pointer in -1..1 (centered) */
  var _tx = 0, _ty = 0;         /* lerped parallax -> uCamPar */

  function hexToRgb(input) {
    var s = String(input).replace(/^\s*#*/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (s.length !== 6) return [40, 20, 30];
    var n = parseInt(s, 16);
    if (!isFinite(n)) return [40, 20, 30];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /* DOM: canvas + title/subtitle + horizontal button row + toast. Classes are styled
     in index.html (#menu-root / .menu-*). */
  function buildDom() {
    rootEl = W.document.createElement('div');
    rootEl.id = 'menu-root';

    canvasEl = W.document.createElement('canvas');
    canvasEl.id = 'menu-canvas';
    rootEl.appendChild(canvasEl);

    var ink = W.document.createElement('div');
    ink.id = 'menu-ink';

    var title = W.document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'SUPER POOL';
    ink.appendChild(title);

    var sub = W.document.createElement('p');
    sub.className = 'menu-sub';
    sub.textContent = 'Select mode';
    ink.appendChild(sub);

    var items = W.document.createElement('div');
    items.className = 'menu-items';
    [['classic', 'Classic', 'mi-classic'], ['arena', 'Battle Arena', 'mi-arena'], ['viewer', 'Viewer', 'mi-viewer']]
      .forEach(function (def) {
        var b = W.document.createElement('button');
        b.type = 'button';
        b.className = 'menu-item ' + def[2];
        b.textContent = def[1];
        b.setAttribute('data-mode', def[0]);
        b.addEventListener('click', function () { _pick(def[0]); });
        items.appendChild(b);
      });
    ink.appendChild(items);
    rootEl.appendChild(ink);

    toastEl = W.document.createElement('div');
    toastEl.className = 'menu-toast';
    rootEl.appendChild(toastEl);

    W.document.body.appendChild(rootEl);
  }

  /* Full-screen shader backdrop: one quad spanning the whole viewport (aUv -> clip
     corners), so every orb is in frame at any window aspect ratio. The fragment
     field reuses the room bokeh language (pan + slow rotation + per-disc drift/pulse)
     but with the warm menu palette, larger orbs and pointer parallax. */
   function buildGl() {
    /* Backdrop is pure CSS bokeh now (index.html #menu-canvas); no WebGL context needed. */
    return true;
    /* render into the #menu-canvas that buildDom already put in the DOM; without
       this the WebGL output goes to a detached internal canvas and stays invisible */
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, canvas: canvasEl });
    } catch (e) {
      if (console && console.error) console.error('[menu] WebGL unavailable:', e);
      return false;
    }
    renderer.setPixelRatio(Math.min(W.devicePixelRatio || 1, 2));
    renderer.setSize(W.innerWidth, W.innerHeight, false);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(60, W.innerWidth / Math.max(W.innerHeight, 1), 0.1, 2);

    var rgb = hexToRgb(C.MENU_BG || '#1a0a14');
    var bg = new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    /* warm fill so nothing shows through if any pixel falls outside the quad */
    scene.background = bg;
    var pal = C.MENU_PALETTE || [];

    var posArr = new Float32Array(N_ORBS * 2);
    var radArr = new Float32Array(N_ORBS);
    var colArr = new Float32Array(N_ORBS * 3);
    var metaArr = new Float32Array(N_ORBS * 4);
    for (var i = 0; i < N_ORBS; i++) {
      posArr[i * 2] = Math.random() - 0.5;
      posArr[i * 2 + 1] = Math.random() - 0.5;
      /* orb radius in uv: the whole plane is exactly one screen, so a wider range
         reads as big soft glints (the room uses world-unit radii on a much larger plane) */
       radArr[i] = 0.15 + Math.random() * 0.25;
      var p = hexToRgb(pal.length ? pal[i % pal.length] : '#ff9b3a');
      var m = 1.0 + Math.random() * 1.0;
      colArr[i * 3] = p[0] / 255 * m;
      colArr[i * 3 + 1] = p[1] / 255 * m;
      colArr[i * 3 + 2] = p[2] / 255 * m;
      var spd = (C.BOKEH_SPEED || 0.2) * (0.3 + Math.random() * 0.8);
      metaArr[i * 4] = Math.random() * Math.PI * 2;
      metaArr[i * 4 + 1] = spd * (Math.random() < 0.5 ? -1 : 1);
      metaArr[i * 4 + 2] = spd * (Math.random() < 0.5 ? -1 : 1);
       metaArr[i * 4 + 3] = 0.3 + Math.random() * 0.7;
     }

     /* force one unmistakable marker orb at screen centre so we can confirm the
        GLSL orb loop actually executes and its uniforms upload correctly */
     posArr[0] = 0; posArr[1] = 0;
     radArr[0] = 0.45;
     colArr[0] = 1.0; colArr[1] = 0.2; colArr[2] = 0.1;

     var VS = "attribute vec2 aUv; varying vec2 vUv; void main(){ vUv = aUv; gl_Position = vec4(aUv * 2.0 - 1.0, 0.0, 1.0); }";
    var fs = [
      "precision mediump float;",
      "uniform float uTime;",
      "uniform float uFlow;",
      "uniform float uRot;",
      "uniform vec2 uCamPar;",
      "uniform float uDriftAmp;",
      "uniform float uCore; uniform float uHalo; uniform float uRing;",
      "uniform vec2 uSpotPos[" + N_ORBS + "];",
      "uniform float uSpotR[" + N_ORBS + "];",
      "uniform vec3 uSpotCol[" + N_ORBS + "];",
      "uniform vec4 uSpotMeta[" + N_ORBS + "];",
      "uniform vec3 uBg;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec2 c = vUv - 0.5;",
      "  c += vec2(sin(uTime * 0.06), cos(uTime * 0.05)) * uFlow;",
      "  float cr = cos(uRot); float sr = sin(uRot);",
      "  c = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);",
      "  c += -uCamPar;",
       "  vec3 col = uBg;",
      "  for (int j = 0; j < " + N_ORBS + "; j++) {",
      "    float ph = uSpotMeta[j].x;",
      "    vec2 drift = vec2(",
      "      sin(uTime * uSpotMeta[j].y + ph) * uDriftAmp,",
      "      cos(uTime * uSpotMeta[j].z + ph * 1.73) * uDriftAmp",
      "    );",
      "    vec2 p = uSpotPos[j] + drift;",
      "    float rr = uSpotR[j] * (1.0 + 0.25 * sin(uTime * uSpotMeta[j].w + ph));",
      "    vec2 d = c - p;",
      "    float t = length(d) / max(rr, 0.004);",
      "    float core = exp(-t * t * 2.6);",
      "    float halo = exp(-t * t * 0.75);",
      "    float ring = exp(-pow(t - 1.1, 2.0) * 4.0);",
      "    col += uSpotCol[j] * (core * uCore + halo * uHalo + ring * uRing);",
      "  }",
        "  col *= mix(1.0, 0.55, smoothstep(0.40, 1.30, length(c)));",
       "  /* DIAGNOSTIC: solid bright magenta to prove the canvas+shader is on top */",
       "  gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);",
       "}"
    ];

    mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: fs.join("\n"),
      uniforms: {
        uTime:     { value: 0 },
        uFlow:     { value: C.BOKEH_FLOW || 0.06 },
        uRot:      { value: 0 },
        uCamPar:   { value: new THREE.Vector2(0, 0) },
        uDriftAmp: { value: C.BOKEH_DRIFT || 0.12 },
        /* standalone backdrop (nothing lit in front of it): glints run much brighter
           than the room field, whose C.BOKEH_* alphas are tuned to sit behind foreground */
        uCore:     { value: 3.0 },
        uHalo:     { value: 2.5 },
        uRing:     { value: 1.0 },
        uSpotPos:  { value: posArr },
        uSpotR:    { value: radArr },
        uSpotCol:  { value: colArr },
        uSpotMeta: { value: metaArr },
        uBg:       { value: bg }
      },
      depthTest: false,
      depthWrite: false
    });

    var geo = new THREE.BufferGeometry();
    /* standard UV corners (0..1) -> two triangles fill the whole viewport; the
       vertex shader maps aUv*2-1 into clip space so vUv stays in [0,1] and the
       orb field (positioned in [-0.5,0.5]) lines up with the screen */
    geo.setAttribute('aUv', new THREE.Float32BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    quadMesh = new THREE.Mesh(geo, mat);
    scene.add(quadMesh);

    return true;
  }

  function loop() {
    rafId = W.requestAnimationFrame(loop);
    var now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    var ut = now * 0.001;
    mat.uniforms.uTime.value = ut;
    mat.uniforms.uRot.value =
      Math.sin(ut * C.BOKEH_ROT_SPEED) * (C.BOKEH_ROT_A || 0.03) +
      Math.cos((ut * 1.41 * C.BOKEH_ROT_SPEED) + 1.37) * (C.BOKEH_ROT_B || 0.018);
    _tx += (_px - _tx) * 0.045;
    _ty += (_py - _ty) * 0.045;
    mat.uniforms.uCamPar.value.set(_tx * PARALLAX_UV, _ty * PARALLAX_UV);
    renderer.render(scene, camera);
  }

  var toastTimer = null;
  function toast() {
    if (!toastEl) return;
    toastEl.textContent = 'Coming soon';
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;   /* force reflow so the transition restarts */
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) toastEl.classList.remove('show'); }, 1600);
  }

  function _pick(mode) {
    if (!built || exiting) return;
    if (mode === 'arena') { toast(); return; }
    /* classic and viewer: fade out the overlay, then hand off to the caller
       (main.js starts the game for classic, opens P.Viewer for viewer) */
    exiting = true;
    _pickedMode = mode;
    rootEl.classList.add('menu-exit');
    W.setTimeout(function () { teardown(); }, FADE_MS);
  }

  function teardown() {
    if (rafId !== null) { try { W.cancelAnimationFrame(rafId); } catch (e) {} rafId = null; }
    W.removeEventListener('keydown', _onKey, false);
    W.removeEventListener('pointermove', _onPointerMove, false);
    W.removeEventListener('resize', _onResize, false);
    try { renderer.dispose(); } catch (e) {}
    if (rootEl) rootEl.remove();
    W.document.body.classList.remove('menu-open');
    canvasEl = null; renderer = null; scene = null; camera = null; mat = null; quadMesh = null;
    built = false; exiting = false;
    if (_cb && typeof _cb === 'function') _cb(_pickedMode || 'classic');
  }

  function _onKey(e) {
    var k = (e.key || '').toUpperCase();
    if (k === '1' || k === 'ENTER') _pick('classic');
    else if (k === '2') _pick('arena');
    else if (k === '3') _pick('viewer');
  }

  function _onPointerMove(e) {
    var w = W.innerWidth || 1, h = W.innerHeight || 1;
    _px = (e.clientX / w) * 2 - 1;
    _py = (e.clientY / h) * 2 - 1;
  }

  function _onResize() {
    if (renderer) renderer.setSize(W.innerWidth, W.innerHeight, false);
  }

  function build() {
    if (built) return true;
    buildDom();
    var ok = buildGl();
    if (!ok) {
      /* no THREE / no WebGL: nothing to show — fall straight through to the caller */
      W.document.body.removeChild(rootEl);
      rootEl = canvasEl = toastEl = null;
      if (_cb && typeof _cb === 'function') _cb('classic');
      return false;
    }
    /* hide all in-game UI while the menu overlay is up */
    W.document.body.classList.add('menu-open');
    W.addEventListener('keydown', _onKey, false);
    W.addEventListener('pointermove', _onPointerMove, false);
    W.addEventListener('resize', _onResize, false);
    built = true;
    return true;
  }

  /* Public API: P.Menu.show(onSelect) / P.Menu.pick(mode). pick() is also used by the
     in-page buttons and keyboard; it builds the overlay on demand so e2e can drive it. */
  P.Menu = {
    show: function (onSelect) {
      _cb = (typeof onSelect === 'function') ? onSelect : null;
      return build();
    },
    pick: function (mode) {
      if (!built) build();
      _pick(mode);
    }
  };
})();