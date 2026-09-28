/* screen-raster-check.js - headless full-pipeline screen simulation of the Poole
 * 8-ball backdrop (no WebGL). Mirrors src/webgl3d.js: exact default frame
 * (FOV 46, tilt 28, margin 1.22, PerspectiveCamera 5..3000) + ?debug_bg=1
 * camera, all meshes from init() as AABBs, backdrop plane analytically with
 * its UV mapping (c = (x/side, -z/side), from rotation.x = -PI/2). A screen
 * pixel grid gets rays with near/far clipping; each pixel reports which mesh
 * it sees and, for backdrop hits, evaluates the glint fragment with the exact
 * shader math. Deterministic "screen pixel tool": if the plane is in view and
 * every hit pixel is finite, colored and changing between t=0 and t=2s, then
 * a black square in the browser must be upstream of the shader (stale page /
 * dead GL pipeline) -> triage ladder B1. Run: node screen-raster-check.js
 */
'use strict';

var W = globalThis;
if (!W.window) W.window = W;                 /* config.js attaches to window.Poole */
globalThis.performance = W.performance || { now: Date.now };
var Poole = require("./src/config.js");   /* populates window.Poole via the window shim */
var C = W.Poole.CONFIG;

/* scene constants mirrored from src/webgl3d.js L37-46, L377, L394-420, L431-433 */
var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var RAIL_DEPTH = 42, RAIL_H = 46, CAB_H = 70, FELT_THICK = 12, LEGLEN = 150;
var NEAR_P = 5, FAR_P = 3000, LOOK_AT_Y = RAIL_H * 0.2;
var HALF_W = (C.IX1 - C.IX0) / 2;           /* 466 */
var HALF_H = (C.IY1 - C.IY0) / 2;           /* 246 */
var legTopY = -FELT_THICK / 2 - CAB_H;      /* L417, top of the legs = -76 */
var bokehSide = (Math.max(C.IX1 - C.IX0, C.IY1 - C.IY0) + RAIL_DEPTH * 16) * 2.2;
var PLANE_Y = legTopY - LEGLEN - 5;         /* L433, y = -231 */
var PLANE_HALF = bokehSide / 2;             /* ~1764 */
/* world-space AABB meshes (centre + half extents); felt top at y = 0.
 * F felt slab, C cabinet, R rails x4, L legs x4; B backdrop plane is analytic. */
var CAB_W = ((C.IX1 - C.IX0) + RAIL_DEPTH * 2.4) / 2;   /* cab spans rails, 516.4 */
var CAB_Z = ((C.IY1 - C.IY0) + RAIL_DEPTH * 2.4) / 2;   /* 296.4 */
var RLONG_W = (C.IX1 - C.IX0 + RAIL_DEPTH * 2) / 2;     /* rail length X, 508 */
var RSZ_W = (C.IY1 - C.IY0 + RAIL_DEPTH * 2) / 2;       /* rail length Z, 288 */
var REND_Z = HALF_H + RAIL_DEPTH * 0.5;                  /* 267, side rails */
var REND_X = HALF_W + RAIL_DEPTH * 0.5;                  /* 487, end rails */

var AABB_MESHES = [
  { id: "F", c: [0, -FELT_THICK / 2, 0],               h: [HALF_W, FELT_THICK / 2, HALF_H] },
  { id: "C", c: [0, -FELT_THICK / 2 - CAB_H / 2, 0],   h: [CAB_W, CAB_H / 2, CAB_Z] },
  { id: "R", c: [0, RAIL_H / 2, REND_Z],               h: [RLONG_W, RAIL_H / 2, RAIL_DEPTH / 2] },
  { id: "R", c: [0, RAIL_H / 2, -REND_Z],              h: [RLONG_W, RAIL_H / 2, RAIL_DEPTH / 2] },
  { id: "R", c: [REND_X, RAIL_H / 2, 0],               h: [RAIL_DEPTH / 2, RAIL_H / 2, RSZ_W] },
  { id: "R", c: [-REND_X, RAIL_H / 2, 0],              h: [RAIL_DEPTH / 2, RAIL_H / 2, RSZ_W] },
  { id: "L", c: [ HALF_W, legTopY - LEGLEN / 2,  HALF_H], h: [RAIL_DEPTH * 0.6, LEGLEN / 2, RAIL_DEPTH * 0.6] },
  { id: "L", c: [ HALF_W, legTopY - LEGLEN / 2, -HALF_H], h: [RAIL_DEPTH * 0.6, LEGLEN / 2, RAIL_DEPTH * 0.6] },
  { id: "L", c: [-HALF_W, legTopY - LEGLEN / 2,  HALF_H], h: [RAIL_DEPTH * 0.6, LEGLEN / 2, RAIL_DEPTH * 0.6] },
  { id: "L", c: [-HALF_W, legTopY - LEGLEN / 2, -HALF_H], h: [RAIL_DEPTH * 0.6, LEGLEN / 2, RAIL_DEPTH * 0.6] }
];
/* small vec3 helpers */
function vsub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function vadd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vscale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function vcross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vlen(a) { return Math.sqrt(vdot(a, a)); }
function vnorm(a) { var l = vlen(a); return l > 1e-9 ? vscale(a, 1 / l) : [0, 0, 1]; }

/* glint fragment model: JS side of makeBokehFloor + fragPixel (webgl3d.js
 * L230-256 and L262-303); seeded PRNG instead of Math.random so runs are
 * reproducible, but same distributions as the browser. */
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hexRgb(entry) {
  var s = String(entry).replace(/^#*/, '');
  if (s.length === 3) {
    s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2); }
  if (s.length !== 6) return null;
  var n = parseInt(s, 16);
  if (!isFinite(n) || n < 0) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
var BOKEH_FALLBACK_RGB = [0.55, 0.65, 1.0];   /* webgl3d.js L198 */
function normColor(entry) {
  var raw = hexRgb(entry);
  if (raw) return [raw[0] / 255, raw[1] / 255, raw[2] / 255];
  if (Array.isArray(entry) && entry.length >= 3) {
    if (isFinite(entry[0]) && isFinite(entry[1]) && isFinite(entry[2])) return [entry[0], entry[1], entry[2]]; }
  return BOKEH_FALLBACK_RGB.slice();
}
/* builds N discs (centred uv -0.5..0.5, radii world units, palette color * m)
 * exactly like makeBokehFloor; seed => reproducible placement. */
function buildDiscs(seed) {
  var N = Math.max(4, C.BOKEH_COUNT || 24);
  var side = bokehSide;
  var rnd = seed === "auto" ? Math.random : mulberry32(seed);
  var posArr = new Float32Array(N * 2), radArr = new Float32Array(N);
  var colArr = new Float32Array(N * 3), metaArr = new Float32Array(N * 4);
  var palette = C.BOKEH_PALETTE;
  for (var i = 0; i < N; i++) {
    posArr[i * 2] = rnd() - 0.5;
    posArr[i * 2 + 1] = rnd() - 0.5;
    var rLw = C.BOKEH_MIN_R + rnd() * (C.BOKEH_VAR_R || 150);
    radArr[i] = rLw / side;
    var p = normColor(palette ? palette[i % palette.length] : null);
    var m = 0.45 + rnd() * 0.65;
    colArr[i * 3] = p[0] * m; colArr[i * 3 + 1] = p[1] * m; colArr[i * 3 + 2] = p[2] * m;
    var spd = (C.BOKEH_SPEED || 0.16) * (0.3 + rnd() * 0.9);
    metaArr[i * 4] = rnd() * Math.PI * 2;
    metaArr[i * 4 + 1] = spd * (rnd() < 0.5 ? -1 : 1);
    metaArr[i * 4 + 2] = spd * (rnd() < 0.5 ? -1 : 1);
    metaArr[i * 4 + 3] = 0.4 + rnd() * 0.9;
  }
  for (var k = 0; k < 4 * N; k++) {
    if (!isFinite(metaArr[k])) return { N: N, pos: posArr, rad: radArr, col: colArr, meta: metaArr };
  }
  if (!isFinite(posArr[0]) || !isFinite(radArr[0]) || !isFinite(colArr[0])) {
    fail("raster: non-finite glint uniform in disc build"); }
  return { N: N, pos: posArr, rad: radArr, col: colArr, meta: metaArr };
}

var BG_LINT = [20 / 255, 35 / 255, 63 / 255];
var BG_L = 0.299 * BG_LINT[0] + 0.587 * BG_LINT[1] + 0.114 * BG_LINT[2];
function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
/* JS equivalent of fragment main(): pan + rotation + per-disc Gaussian
 * core/halo/ring at centred-uv point (cx, cy) at time t seconds (uTime). */
function fragPixel(cx, cy, t, model) {
  var f = C.BOKEH_FLOW || 0.06;
  var x = cx + Math.sin(t * 0.07) * f;
  var y = cy + Math.cos(t * 0.056) * f;
  var uRot = Math.sin(t * (C.BOKEH_ROT_SPEED || 0.25)) * (C.BOKEH_ROT_A || 0.03) +
    Math.cos((t * 1.41 * (C.BOKEH_ROT_SPEED || 0.25)) + 1.37) * (C.BOKEH_ROT_B || 0.018);
  var cr = Math.cos(uRot), sr = Math.sin(uRot);
  var nx = x * cr - y * sr, ny = x * sr + y * cr;   /* rotated pan vector */
  var outR = BG_LINT[0], outG = BG_LINT[1], outB = BG_LINT[2];
  var dAmp = C.BOKEH_DRIFT || 0.12, coreA = C.BOKEH_CORE_ALPHA || 1.0,
    haloA = C.BOKEH_MID_ALPHA || 0.5, ringA = C.BOKEH_RING_ALPHA || 0.15;
  for (var j = 0; j < model.N; j++) {
    var ph = model.meta[j * 4];
    var dx = Math.sin(t * model.meta[j * 4 + 1] + ph) * dAmp;
    var dy = Math.cos(t * model.meta[j * 4 + 2] + ph * 1.73) * dAmp;
    var rx = nx - (model.pos[j * 2] + dx);
    var ry = ny - (model.pos[j * 2 + 1] + dy);
    var rr = Math.max(model.rad[j] * (1 + 0.18 * Math.sin(t * model.meta[j * 4 + 3] + ph)), 0.004);
    var tt = Math.sqrt(rx * rx + ry * ry) / rr;
    var core = Math.exp(-tt * tt * 2.6), halo = Math.exp(-tt * tt * 0.75);
    var ring = Math.exp(-Math.pow(tt - 1.1, 2) * 4);
    var w = core * coreA + halo * haloA + ring * ringA;
    outR += model.col[j * 3] * w; outG += model.col[j * 3 + 1] * w;
    outB += model.col[j * 3 + 2] * w;
  }
  /* radial vignette: mix(1.0, 0.42, smoothstep(0.45, 1.35, length(c))) */
  var fall = 0.42 + (1 - 0.42) * (1 - smooth01(Math.sqrt(nx * nx + ny * ny), 0.45, 1.35));
  return [outR * fall, outG * fall, outB * fall];
}
function smooth01(v, a, b) {
  var t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/* model factory: disc build + fragPixel closure, one per seed */
function makeModel(seed) {
  var d = buildDiscs(seed);
  return d;
}
/* default frame camera: frameCamera (webgl3d.js L126-141) + PerspectiveCamera
 * (FOV, aspect, NEAR..FAR). tH = half-angle vertically? no: tan(FOV/2) for
 * the vertical... here FOV is vertical, so tH applies to height (Y). */
function frameView(aspect) {
  var tH = Math.tan(Math.PI * FOV / 360);
  var tV = tH / aspect;
  var extX = HALF_W + RAIL_DEPTH * 1.35;
  var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
  var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
  var th = Math.PI * TILT_DEG / 180;
  return { pos: [0, D * Math.cos(th), D * Math.sin(th)],
           target: [0, LOOK_AT_Y, 0], aspect: aspect };
}
function debugView() {
  return { pos: [0, 1350, 760], target: [0, -232.0, 860], aspect: 1.56 };
}
function camBasis(view) {
  var f = vnorm(vsub(view.target, view.pos));            /* screen -Y dir */
  var r = vnorm(vcross(f, [0, 1, 0]));                   /* screen +X */
  return { f: f, r: r, s: vcross(r, f), aspect: view.aspect }; /* screen +Y */
}
function rayDir(b, sx, sy) {
  var tH = Math.tan(Math.PI * FOV / 360);
  var tV = tH / b.aspect;
  return vnorm(vadd(vadd(vscale(b.f, 1), vscale(b.r, sx * tH)), vscale(b.s, sy * tV)));
}
/* AABB slab intersection. Correct box test: all 3 slab intervals must overlap,
 * i.e. tmin = max of all entry ts and tmax = min of all exit ts. The ray is
 * clipped to [NEAR_P, FAR_P] before returning, exactly like the GPU clip. */
function hitAABB(o, d, m) {
  var tmin = -Infinity, tmax = Infinity;
  for (var i = 0; i < 3; i++) {
    var oI = o[i], dI = d[i], c = m.c[i], h = m.h[i];
    if (Math.abs(dI) < 1e-9) {
      if (oI <= -h || oI >= h) return null;              /* parallel outside */
    } else {
      var t0 = (c - h - oI) / dI, t1 = (c + h - oI) / dI;
      if (t0 > t1) { var tmp = t0; t0 = t1; t1 = tmp; }
      if (tmin < t0) tmin = t0;
      if (tmax > t1) tmax = t1;
    }
  }
  if (!(tmin < tmax)) return null;
  var t = Math.max(tmin, 0);                            /* front face */
  if (t >= NEAR_P && t <= FAR_P) return { t: t };
  return null;
}
/* backdrop plane at y = PLANE_Y, finite to +/- PLANE_HALF in X and Z.
 * t must be within camera clip range [NEAR_P, FAR_P] (same as the GPU). */
function hitPlane(o, d) {
  if (Math.abs(d[1]) < 1e-9) return null;               /* parallel to plane */
  var t = (PLANE_Y - o[1]) / d[1];
  if (t < NEAR_P || t > FAR_P) return null;
  var x = o[0] + d[0] * t, z = o[2] + d[2] * t;
  if (x < -PLANE_HALF || x > PLANE_HALF) return null;
  if (z < -PLANE_HALF || z > PLANE_HALF) return null;
  return { t: t, x: x, z: z };
}
/* shader remap: vUv is centred uv, plane rotation.x = -PI/2 sends local Y to
 * world -Z, so cY = -z/side. Discs live in -0.5..0.5 centered uv. */
function planeUV(x, z) { return [x / bokehSide, -z / bokehSide]; }
var FAILS = [];
function fail(msg) { FAILS.push(msg); }
function okFinite(c) { return isFinite(c[0]) && isFinite(c[1]) && isFinite(c[2]); }

/* same definitions as smoke-e2e.js L226-237 */
function isColored(c) {
  var mX = Math.max(c[0], c[1], c[2]), mN = Math.min(c[0], c[1], c[2]);
  return (mX - mN) >= 0.15 && mX >= 0.35;
}
function isBright(c) { return lum(c) > 0.30; }
function isDarkGap(c) { return lum(c) <= BG_L + 0.04; }
function srgbEncode(v) {
  return Math.max(0, Math.min(1, v) <= 0.0031308 ? v * 12.92 :
         1.055 * Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.4) - 0.055);
}
function rgbHex(c) {
  var hx = function (v) {
    return (Math.round(srgbEncode(v) * 255)).toString(16).padStart(2, "0").toUpperCase(); };
  return "#" + hx(c[0]) + hx(c[1]) + hx(c[2]);
}
function fmt(f, d) { return f.toFixed(d); }

/* per-region stats over a sample: the backdrop fragment is only computed on B (plane) pixels;
 * F/C/R/L hits are opaque table surfaces that occlude it and carry no fragment color. */
function analyse(pix) {
  var total = pix.length, nF = 0, nN = 0, nB = 0, nOcc = 0;
  var nonBlack = 0;                            /* L > 0.05 -> real scene data on screen */
  var colored = 0, bright = 0, hueful = 0, wash = 0, darkGap = 0;
  var lSum = 0, lMax = 0, lMin = Infinity, cSum = [0, 0, 0];
  for (var i = 0; i < pix.length; i++) {
    var p = pix[i];
    if (!p) { nF++; continue; }                /* fragment never reached (ray clip / miss) */
    if (p.meshId !== "B") { nOcc++; continue; } /* opaque surface occludes the backdrop */
    nB++;                                        /* backdrop fragment in view */
    if (!okFinite(p.rgb)) { nN++; FAILS.push("pixel at " + i + " has non-finite rgb: " + JSON.stringify(p.rgb)); continue; }
    var L = 0.299 * p.rgb[0] + 0.587 * p.rgb[1] + 0.114 * p.rgb[2];
    lSum += L; lMax = Math.max(lMax, L); lMin = Math.min(lMin, L);
    cSum[0] += p.rgb[0]; cSum[1] += p.rgb[1]; cSum[2] += p.rgb[2];
    var ch = [p.rgb[0], p.rgb[1], p.rgb[2]];
    if (L > 0.05) { nonBlack++; if (isColored(ch)) colored++; if (isBright(ch)) bright++;
      if (ch[0] > 0.32 && ch[1] > 0.32 && ch[2] > 0.32) wash++;
    }
    if (!isDarkGap(ch)) { /* hueful: chroma above 5% of luma, luma not too dark */
      var mX = Math.max(ch[0], ch[1], ch[2]), mN = Math.min(ch[0], ch[1], ch[2]);
      if ((mX - mN) / (L + 1e-6) > 0.05 && L > 0.04) hueful++;
    } else darkGap++;
  }
  return { n: total, nB: nB, occluded: nOcc, fragPixels: nB,
           nonBlack: nonBlack, colored: colored, bright: bright, hueful: hueful, wash: wash, darkGap: darkGap,
           lSum: lSum, lMax: lMax, lMin: lMin, cSum: cSum, nFail: nF, nNaN: nN };
}
/* casts the full screen pixel grid (aspect-corrected NDC) through the
 * same clip range as the GPU, returns one record per sampled pixel:
 * { frag: bool, rgb, L, meshId } — 0/undefined for fragments not reached. */
function rasterizeGrid(view, seed, ROWS, COLS, t, model, basis) {
  var pix = [];
  for (var ry = 0; ry < ROWS; ry++) {
    for (var cx = 0; cx < COLS; cx++) {
      var sx = (cx + 0.5) / COLS * 2 - 1;
      var sy = (ry + 0.5) / ROWS * 2 - 1; /* top to bottom */
      var dir = rayDir(basis, sx, sy);
      var best = null;                     /* nearest hit wins (z-buffer order) */
      var hits = [];
      for (var mi = 0; mi < AABB_MESHES.length; mi++) {
        var h = hitAABB(view.pos, dir, AABB_MESHES[mi]);
        if (h) hits.push({ t: h.t, id: AABB_MESHES[mi].id });
      }
      var hp = hitPlane(view.pos, dir);
      var plane = null;
      if (hp && (plane == null || true)) plane = { t: hp.t, id: "B", x: hp.x, z: hp.z };
      /* nearest finite hit among mesh + backdrop plane */
      var nbest = null;
      for (var hi = 0; hi < hits.length; hi++) {
        if (!isFinite(hits[hi].t) || hits[hi].t < NEAR_P) continue;
        if (!nbest || hits[hi].t < nbest.t) nbest = { t: hits[hi].t, id: hits[hi].id };
      }
      if (plane && isFinite(plane.t)) {
        if (!nbest || plane.t < nbest.t) nbest = { t: plane.t, id: "B", x: plane.x, z: plane.z };
      }
      var rgb = null;
      if (nbest && nbest.id === "B") {
        var uv = planeUV(nbest.x, nbest.z);
        var col = fragPixel(uv[0], uv[1], t, model);
        if (okFinite(col)) { rgb = col; /* L computed in analyse */ }
      }
      pix.push({ frag: !!rgb, rgb: rgb ? rgb.slice() : null, meshId: nbest ? nbest.id : null, t01: sx, t02: sy });
    }
  }
  return pix;
}
function pct(v, n) { return n > 0 ? ((v * 100) / n).toFixed(1) + "%" : "n/a"; }

/* one full run for one view: seeds x2, t=0 and t=2s. Reports whether the
 * backdrop is actually in view (B hits), whether its pixels are colored/bright
 * and moving over time, and any finite-failures. */
function analyseView(view) {
  var out = [];
  var ROWS = 20, COLS = 32;
  out.push("\n==== " + view.name + "  (aspect " + view.aspect + ") ====");
  for (var seed of [1, 1337]) {
    var model = makeModel(seed);
    var basis = camBasis(view);
    var t0Pix = rasterizeGrid(view, seed, ROWS, COLS, 0, model, basis);
    var t2Pix = rasterizeGrid(view, seed, ROWS, COLS, 2, model, basis);
    /* movement: L change > 0.005 at same pixel between t=0 and t=2s */
    var moving = 0, nonBlack = 0;
    for (var i = 0; i < t0Pix.length; i++) {
      var a = t0Pix[i], b = t2Pix[i];
      if (!a.frag || !b.frag) continue;
      var La = 0.299 * a.rgb[0] + 0.587 * a.rgb[1] + 0.114 * a.rgb[2];
      var Lb = 0.299 * b.rgb[0] + 0.587 * b.rgb[1] + 0.114 * b.rgb[2];
      nonBlack++;
      if (Math.abs(La - Lb) > 0.005) moving++;
    }
    var a0 = analyse(t0Pix), a2 = analyse(t2Pix);
    out.push("seed " + seed + ":");
    out.push("  nonBlack %        : " + pct(a0.nonBlack, t0Pix.length) +
             "  (B pixels " + a0.nB + ", table occluded " + a0.occluded + "/" + t0Pix.length + ")");
    out.push("  colored / bright  : " + a0.colored + " / " + a0.bright +
             "   moving(t0->t2) % : " + pct(moving, nonBlack));
    out.push("  hueful/wash/darkGap: " + a0.hueful + "/" + a0.wash + "/" + a0.darkGap +
             "   Lmin..Lmax: " + fmt(a0.lMin, 4) + ".." + fmt(a0.lMax, 4));
    out.push("  avg color         : rgb(" +
              (Math.min(255, Math.round(srgbEncode(a0.cSum[0] / t0Pix.length) * 255)) + "," +
               Math.min(255, Math.round(srgbEncode(a0.cSum[1] / t0Pix.length) * 255)) + "," +
               Math.min(255, Math.round(srgbEncode(a0.cSum[2] / t0Pix.length) * 255))) + ")");
    if (a0.fragPixels > 0 && moving === 0) FAILS.push("seed " + seed + ": backdrop in view but ZERO movement across 2s — frozen shader clock or no disc");
    if (a0.colored === 0 && a0.bright === 0) FAILS.push("seed " + seed + ": backdrop renders only dark/background color (colored=0 bright=0)");
  }
  return out;
}
/* ASCII preview: brightest backdrop pixel of the centre band, t=0 seed=1 */
function asciiPreview(pix) {
  var chars = " .:-=+*#%@";
  var rows = [], cols = 24;
  for (var ry = 0; ry < 8; ry++) {
    var line = "";
    for (var cx = 0; cx < cols; cx++) {
      var idx = ry * 8 + Math.round((cx / cols) * 15);   /* sub-sample grid */
      var p = pix[idx];
      if (!p || !p.rgb || !okFinite(p.rgb)) { line += "."; continue; }
      var L = 0.299 * p.rgb[0] + 0.587 * p.rgb[1] + 0.114 * p.rgb[2];
      line += chars[Math.min(chars.length - 1, Math.floor(L * 16))];
    }
    rows.push(line);
  }
  return rows.join("\n");
}

function main() {
  var ROWS = 20, COLS = 32;
  var frameViewObj = frameView(1.56); frameViewObj.name = "default-frame (1.56)";
  var dbgViewObj   = debugView();      dbgViewObj.name = "?debug_bg=1 (1.56)";
  var lines = [];
  lines.push("# screen raster check (headless, no WebGL)\n");
  lines.push("FOV " + FOV + " tilt " + TILT_DEG + " NEAR/FAR " + NEAR_P + "/" + FAR_P);
  lines.push("plane y=" + fmt(PLANE_Y, 2) + " side=" + fmt(bokehSide, 1) +
             " grid=" + ROWS + "x" + COLS + " seeds=[1,1337] t=[0s,2s]");
  for (var vi = 0; vi < 2; vi++) {
    var view = (vi === 0) ? frameViewObj : dbgViewObj;
    lines.push.apply(lines, analyseView(view));
    if (vi === 0) {
      /* one quick t=0 map for visual confirmation of backdrop occupancy */
      var basis = camBasis(view);
      var model = makeModel(1);
      var px = rasterizeGrid(view, 1, ROWS, COLS, 0, model, basis);
      lines.push("\n  preview (top->bottom):\n" + asciiPreview(px));
    }
    lines.push("");
  }
  lines.push("# FAILS (" + FAILS.length + ")");
  FAILS.forEach(function (f) { lines.push("  - " + f); });
  if (FAILS.length === 0) lines.push("  none");
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(FAILS.length ? 1 : 0);
}

/* guards against a corrupted environment */
if (isFinite(bokehSide) && PLANE_Y < 0) main();
else FAILS.push("bad scene constants: " + bokehSide + " / " + PLANE_Y);
if (FAILS.length) { process.stdout.write("FAILED:\n" + FAILS.join("\n") + "\n"); process.exit(1); }
//__end__










