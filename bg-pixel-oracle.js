/* bg-pixel-oracle.js — autonomous CPU "pixel color" oracle for the bokeh backdrop.

Runs the EXACT webgl3d.js fragment math + orb generation (same config values,
same units) on a CPU and reports real per-pixel RGB colours, an ASCII heat-map,
and a failure-mode matrix that shows which uniform's absence produces the
user-reported "just flat blue" symptom. No browser / no GL required.

Usage: node bg-pixel-oracle.js [seeds...]   (default seeds 20240927 1 1337)
*/
'use strict';

/* ---- exact config values from src/config.js (bokeh block) ---- */
var CFG = {
  N: 26, MIN_R: 160, VAR_R: 200, CORE: 0.65, HALO: 0.32, RING: 0.15,
  DRIFT: 0.12, FLOW: 0.06, SIDE: (932 + 42 * 16) * 2.2
};
var PALETTE = ['#7aa3ff', '#b18cff', '#6fd8ce', '#ffb45e', '#ff7f9e', '#7ae0a4'];
function normColor(hex) {
  if (!hex || typeof hex !== 'string') return [0.35, 0.35, 0.35];
  var v = parseInt(hex.slice(1), 16);
  return [(v >> 16) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
var UBG = { r: 0x14 / 255, g: 0x23 / 255, b: 0x3f / 255 }; /* 0x14233f */
var BG_LUM = lum([UBG.r, UBG.g, UBG.b]);

/* ---- reproducible PRNG (same family used by smoke-e2e) ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79fa) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- generate orb arrays exactly like makeBokehFloor ---- */
function genOrbs(seed, cfg) {
  var rnd = mulberry32(seed | 0);
  var N = cfg.N, side = cfg.SIDE;
  var pos = new Float32Array(N * 2), rad = new Float32Array(N),
      col = new Float32Array(N * 3), meta = new Float32Array(N * 4);
  for (var i = 0; i < N; i++) {
    pos[i * 2] = rnd() - 0.5;
    pos[i * 2 + 1] = rnd() - 0.5;
    var rLw = cfg.MIN_R + rnd() * (cfg.VAR_R || 150);
    rad[i] = rLw / side;
    var p = normColor(PALETTE[i % PALETTE.length]);
    var m = 0.45 + rnd() * 0.65;
    col[i * 3] = p[0] * m; col[i * 3 + 1] = p[1] * m; col[i * 3 + 2] = p[2] * m;
    var spd = (CFG.SPEED ? CFG.SPEED : 0.16) * (0.3 + rnd() * 0.9);
    meta[i * 4] = rnd() * Math.PI * 2;
    meta[i * 4 + 1] = spd * (rnd() < 0.5 ? -1 : 1);
    meta[i * 4 + 2] = spd * (rnd() < 0.5 ? -1 : 1);
    meta[i * 4 + 3] = 0.4 + rnd() * 0.9;
  }
  return { N: N, pos: pos, rad: rad, col: col, meta: meta };
}

CFG.SPEED = 0.20; /* C.BOKEH_SPEED */

/* ---- EXACT fragment port (copied from webgl3d.js makeBokehFloor) ---- */
function smoothstep(a, b, x) {
  var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function fragPixel(cx, cy, t, rot, camPar, uFlow, orb, mode) {
  var c = [cx + Math.sin(t * 0.07) * uFlow, cy + Math.cos(t * 0.056) * uFlow];
  var cr = Math.cos(rot[0]), sr = Math.sin(rot[0]);
  c[0] = c[0] * cr - c[1] * sr - camPar[0];
  c[1] = c[0] * sr + c[1] * cr - camPar[1];
  var col = [UBG.r, UBG.g, UBG.b];
  for (var j = 0; j < orb.N; j++) {
    var ph = orb.meta[j * 4];
    var px = orb.pos[j * 2] + Math.sin(t * orb.meta[j * 4 + 1] + ph) * CFG.DRIFT;
    var py = orb.pos[j * 2 + 1] + Math.cos(t * orb.meta[j * 4 + 2] + ph * 1.73) * CFG.DRIFT;
    if (mode === 'pos0') { px = 0; py = 0; }
    var rr = orb.rad[j] * (1.0 + 0.18 * Math.sin(t * orb.meta[j * 4 + 3] + ph));
    if (mode === 'r0') { rr = 0; }
    var tlen = Math.hypot(c[0] - px, c[1] - py) / Math.max(rr, 0.004);
    var core = Math.exp(-tlen * tlen * 2.6);
    var halo = Math.exp(-tlen * tlen * 0.75);
    var ring = Math.exp(-(tlen - 1.1) * (tlen - 1.1) * 4.0);
    var cc = CFG.CORE, ch = CFG.HALO, cr2 = CFG.RING;
    if (mode === 'col0') { cc = 0; ch = 0; cr2 = 0; }
    var k = core * cc + halo * ch + ring * cr2;
    col[0] += orb.col[j * 3] * k;
    col[1] += orb.col[j * 3 + 1] * k;
    col[2] += orb.col[j * 3 + 2] * k;
  }
  var fade = 1.0 - 0.58 * smoothstep(0.45, 1.35, Math.hypot(c[0], c[1]));
  return [col[0] * fade, col[1] * fade, col[2] * fade];
}

function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
var CH = [' ', '·', ':', '+', '=', '-', 'x'];
function asciiChar(c) {
  var l = lum(c);
  var i = Math.min(CH.length - 1, Math.max(0, Math.floor(l * CH.length)));
  return CH[i];
}

/* unoccluded screen-edge sample points (table hides the centre, not these) */
function corners() { return [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3], [0, -0.45], [0, 0.45]]; }

function render(seed, t, mode) {
  var orb = (mode === 'empty') ? genOrbs(seed, { N: 0 }) : genOrbs(seed, CFG);
  var W = 64, H = 84, rot = [t * 0.02, 0], rows = [], sumL = 0, nCol = 0, maxL = 0, minL = 1e9;
  for (var y = 0; y < H; y++) {
    var line = '';
    for (var x = 0; x < W; x++) {
      var cx = (x / W - 0.5), cy = (y / H - 0.5);   /* full plane -0.5..0.5 */
      var c = fragPixel(cx, cy, t, rot, [0, 0], CFG.FLOW, orb, mode);
      var l = lum(c);
      sumL += l; maxL = Math.max(maxL, l); minL = Math.min(minL, l);
      if (l > BG_LUM) nCol++;
      line += asciiChar(c);
    }
    rows.push(line);
  }
  return { rows: rows, meanL: sumL / (W * H), maxL: maxL, minL: minL,
           coloredPct: nCol / (W * H) * 100, t: t, mode: mode };
}

function main() {
  var seeds = process.argv.slice(2).map(Number).filter(Boolean) || [20240927, 1, 1337];
  console.log('=== BG PIXEL ORACLE — exact webgl3d.js bokeh fragment on CPU ===');
  console.log('CFG: N=' + CFG.N + '  side=' + CFG.SIDE.toFixed(1) +
    '  uBgRGB=' + Math.round(UBG.r * 255) + ',' + Math.round(UBG.g * 255) + ',' + Math.round(UBG.b * 255));
  console.log('bg luminance = ' + BG_LUM.toFixed(3));
  for (var s = 0; s < seeds.length; s++) {
    console.log('\n--- seed ' + seeds[s] + ' ---');
    for (var ti = 0; ti < 2; ti++) {
      var t = ti * 2.0, a = render(seeds[s], t, 'real');
      console.log('t=' + t.toFixed(1) + 's  real : meanL=' + a.meanL.toFixed(3) + '  maxL=' +
        a.maxL.toFixed(3) + '  minL=' + a.minL.toFixed(3) + '  coloredPct=' + a.coloredPct.toFixed(0) + '%');
      if (ti === 0) {
        console.log('  ASCII heat-map (luminance -> char), t=0.0:');
        for (var ry = 0; ry < a.rows.length; ry += 2) console.log('  ' + a.rows[ry]);
      }
    }
    console.log('\n  RGB at unoccluded screen edges, t=0.0 (mode : x,y,z per point):');
    var modes = { real: 'real', pos0: 'pos0', col0: 'col0', r0: 'r0', empty: 'empty' };
    for (var cm in modes) {
      var orb = modes[cm] === 'empty' ? genOrbs(seeds[s], { N: 0 }) : genOrbs(seeds[s], CFG);
      var out = [];
      for (var cp = 0; cp < corners().length; cp++) {
        var pt = corners()[cp];
        var c = fragPixel(pt[0], pt[1], 0, [0.02, 0], [0, 0], CFG.FLOW, orb, modes[cm]);
        out.push(c[0].toFixed(2) + ',' + c[1].toFixed(2) + ',' + c[2].toFixed(2));
      }
      console.log('  ' + modes[cm].padEnd(6) + ' : ' + out.join(' | '));
    }
  }
}
main();