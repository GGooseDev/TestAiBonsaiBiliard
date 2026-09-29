/* Procedural felt-grain math. Pure functions (no THREE / DOM), so the grain is
   deterministic and can be unit-tested headless. Exposed as window.Poole.Noise. */
(function () {
  var W = (typeof window !== 'undefined') ? window : globalThis;
  var P = W.Poole;
  if (!P) P = W.Poole = {};

  /* --- seeded PRNG (mulberry32): stable across runs, no state leakage --- */
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ s >>> 15, 1 | s);
      t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Seamless 2D value noise. n(u,v) is periodic with period 1 on each axis, so
     fBm built from it tiles without seams. N = grid cells per unit (wrap). */
  function makeValueNoise(N, seed) {
    var rng = mulberry32(seed);
    var g = new Float32Array(N * N);
    for (var i = 0; i < N * N; i++) g[i] = rng();

    /* smoothstep: C1-continuous interpolation so the tile reads as felt, not grid */
    function s(t) { return t * t * (3 - 2 * t); }

    return function (u, v) {
      var gu = u * N, gv = v * N;
      var gx = Math.floor(gu), gy = Math.floor(gv);
      var fx = s(gu - gx), fy = s(gv - gy);
      var ix0 = ((gx % N) + N) % N, ix1 = (ix0 + 1) % N;
      var iy0 = ((gy % N) + N) % N, iy1 = (iy0 + 1) % N;
      var a = g[iy0 * N + ix0], b = g[iy0 * N + ix1];
      var c = g[iy1 * N + ix0], d = g[iy1 * N + ix1];
      return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    };
  }

  /* Fractal Brownian motion: sum of integer-frequency octaves, normalized to [0,1].
     Integer frequencies keep the result period-1 (seamless). */
  function fbm(base, u, v, freqs, amps) {
    var acc = 0, tot = 0;
    for (var i = 0; i < freqs.length; i++) {
      acc += base(u * freqs[i], v * freqs[i]) * amps[i];
      tot += amps[i];
    }
    return acc / tot;
  }

  /* --- felt parameters (named constants, tune here) --- */
  var SEED = 20260929;          /* fixed: same felt on every load */
  var MOTTLE_FREQS = [3, 5];    /* broad dye variation (low freq)   */
  var MOTTLE_AMPS = [0.6, 0.3];
  var GRAIN_FREQS = [32, 64, 96];   /* chunky wool-pile grain (lower top freq -> bigger speckles) */
  var GRAIN_AMPS = [0.5, 0.25, 0.125];

  /* base felt tint (matches the old flat 0x346941); pixels carry their own shade */
  var FELT_BASE_R = 0x34;
  var FELT_BASE_G = 0x69;
  var FELT_BASE_B = 0x41;

  var mottle = makeValueNoise(64, SEED + 1);
  var grain = makeValueNoise(256, SEED + 7);

  /* sample the felt albedo at uv in [0,1) (periodic). Returns {r,g,b} in 0..255. */
  function sampleFelt(u, v) {
    var m = fbm(mottle, u, v, MOTTLE_FREQS, MOTTLE_AMPS);   /* 0..1 broad  */
    var g = fbm(grain, u, v, GRAIN_FREQS, GRAIN_AMPS);      /* 0..1 fine   */

    /* mottle: wide light/dark wash; grain: visible per-fibre speckle         */
    var k = (0.82 + 0.36 * m) * (0.94 + 0.12 * g);

    return {
      r: clampR(FELT_BASE_R * k),
      g: clampR(FELT_BASE_G * k),
      b: clampR(FELT_BASE_B * k)
    };
  }

  function clampR(v) {
    v = Math.round(v);
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  P.Noise = {
    mulberry32: mulberry32,
    makeValueNoise: makeValueNoise,
    fbm: fbm,
    sampleFelt: sampleFelt,
    SEED: SEED
  };
})();
