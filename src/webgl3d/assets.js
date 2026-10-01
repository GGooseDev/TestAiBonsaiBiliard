/* Texture & backdrop asset builders. Exports to S.assets: makeBallTexture and
   makeBokehFloor (called from init.js). Colour helpers are internal to this module. */
(function () {
  var W = window, P = W.Poole, C = P.CONFIG;
  var S = P._WebGL;

  /* ball surface texture: number printed on the TOP POLE so it stays readable
     from the 3/4 view; equator band for stripes; 5 dots on the 8-ball. */
  var texCache = {};
  function makeBallTexture(id) {
    if (texCache[id]) return texCache[id];
    var SZ = 256, cv = W.document.createElement('canvas');
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
    tex.anisotropy = S.MAX_ANISO;
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
    S.bokehHalf = side / 2;
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
       var rLw = (C.BOKEH_MIN_R + Math.random() * (C.BOKEH_VAR_R || 150)) * (side / S.BOKEH_SIDE_REF);
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
         uOrbDebug: { value: S.DEBUG_BG ? 1 : 0 }
      },
      side: THREE.DoubleSide
    });
     var mesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), mat);
     mesh.rotation.x = -Math.PI / 2;          /* flat, normal points +Y (overhead view) */
     if (S.DEBUG_BG && console && console.info) {
       console.info('[BG_DBG] step 2: bokeh N=' + N + ', col[0]=[' + colArr[0].toFixed(3) + ',' +
         colArr[1].toFixed(3) + ',' + colArr[2].toFixed(3) + '], pos0=[' + posArr[0].toFixed(3) + ',' +
         posArr[1].toFixed(3) + '], r0=' + radArr[0].toFixed(4) + ' uv');
     }
     return { mesh: mesh, mat: mat };
  }

  S.assets = { makeBallTexture: makeBallTexture, makeBokehFloor: makeBokehFloor };
})();
