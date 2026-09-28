/* bg-cam-raster.js — rasterize what the MAIN game camera sees of the bokeh backdrop.

Uses the exact webgl3d.js camera (baseCamPos from TILT/FOV/table dims), the exact
backdrop plane (y = legTopY - legLen - 5, z = 0), the table occluders (felt +
cabinet AABB), and the EXACT orb fragment math. For each screen pixel it decides:
  - occluded by the table, or
  - sees the backdrop (and reports the real field colour there).

This answers "what does the browser actually see" without a browser.
Usage: node bg-cam-raster.js [seed]   (default seed 20240927)
*/
'use strict';

/* ---- scene constants (from src/webgl3d.js + src/config.js) ---- */
var CFG = {
  N: 26, MIN_R: 160, VAR_R: 200, CORE: 0.65, HALO: 0.32, RING: 0.15, DRIFT: 0.12,
  FLOW: 0.06, SPEED: 0.20
};
var PALETTE = ['#7aa3ff', '#b18cff', '#6fd8ce', '#ffb45e', '#ff7f9e', '#7ae0a4'];
var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var RAIL_DEPTH = 42, RAIL_H = 46, CAB_H = 70, FELT_THICK = 12;
var IX0 = 34, IY0 = 34, IX1 = 966, IY1 = 526;
var HALF_W = (IX1 - IX0) / 2, HALF_H = (IY1 - IY0) / 2;   /* 466, 246 */
var SIDE = (Math.max(IX1 - IX0, IY1 - IX0) + RAIL_DEPTH * 16) * 2.2; /* bokehSide ~3528.8 */
var UBG = [0x14 / 255, 0x23 / 255, 0x3f / 255];          /* 0x14233f */
function normColor(hex) {
  if (!hex || typeof hex !== 'string') return [0.35, 0.35, 0.35];
  var v = parseInt(hex.slice(1), 16);
  return [(v >> 16) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
function lum(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }

/* ---- orb generation (exact makeBokehFloor) ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79fa) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function genOrbs(seed, n) {
  var rnd = mulberry32(seed | 0), N = n, side = SIDE;
  var pos = new Float32Array(N * 2), rad = new Float32Array(N),
      col = new Float32Array(N * 3), meta = new Float32Array(N * 4);
  for (var i = 0; i < N; i++) {
    pos[i * 2] = rnd() - 0.5; pos[i * 2 + 1] = rnd() - 0.5;
    rad[i] = (CFG.MIN_R + rnd() * CFG.VAR_R) / side;
    var p = normColor(PALETTE[i % PALETTE.length]), m = 0.45 + rnd() * 0.65;
    col[i * 3] = p[0] * m; col[i * 3 + 1] = p[1] * m; col[i * 3 + 2] = p[2] * m;
    var spd = CFG.SPEED * (0.3 + rnd() * 0.9);
    meta[i * 4] = rnd() * Math.PI * 2;
    meta[i * 4 + 1] = spd * (rnd() < 0.5 ? -1 : 1);
    meta[i * 4 + 2] = spd * (rnd() < 0.5 ? -1 : 1);
    meta[i * 4 + 3] = 0.4 + rnd() * 0.9;
  }
  return { N: N, pos: pos, rad: rad, col: col, meta: meta };
}

/* ---- exact fragment port ---- */
function smoothstep(a, b, x) {
  var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function fragPixel(cx, cy, t, rot, camPar, uFlow, orb) {
  var c = [cx + Math.sin(t * 0.07) * uFlow, cy + Math.cos(t * 0.056) * uFlow];
  var cr = Math.cos(rot[0]), sr = Math.sin(rot[0]);
  c[0] = c[0] * cr - c[1] * sr - camPar[0];
  c[1] = c[0] * sr + c[1] * cr - camPar[1];
  var col = [UBG[0], UBG[1], UBG[2]];
  for (var j = 0; j < orb.N; j++) {
    var ph = orb.meta[j * 4];
    var px = orb.pos[j * 2] + Math.sin(t * orb.meta[j * 4 + 1] + ph) * CFG.DRIFT;
    var py = orb.pos[j * 2 + 1] + Math.cos(t * orb.meta[j * 4 + 2] + ph * 1.73) * CFG.DRIFT;
    var rr = orb.rad[j] * (1.0 + 0.18 * Math.sin(t * orb.meta[j * 4 + 3] + ph));
    var tlen = Math.hypot(c[0] - px, c[1] - py) / Math.max(rr, 0.004);
    var core = Math.exp(-tlen * tlen * 2.6), halo = Math.exp(-tlen * tlen * 0.75),
        ring = Math.exp(-(tlen - 1.1) * (tlen - 1.1) * 4.0);
    var k = core * CFG.CORE + halo * CFG.HALO + ring * CFG.RING;
    col[0] += orb.col[j * 3] * k; col[1] += orb.col[j * 3 + 1] * k; col[2] += orb.col[j * 3 + 2] * k;
  }
  var fade = 1.0 - 0.58 * smoothstep(0.45, 1.35, Math.hypot(c[0], c[1]));
  return [col[0] * fade, col[1] * fade, col[2] * fade];
}

/* ---- table occlusion AABBs (felt + cabinet) ---- */
var CAB_HX = (IX1 - IX0 + RAIL_DEPTH * 2.4) / 2;   /* ~516 */
var CAB_HZ = (IY1 - IY0 + RAIL_DEPTH * 2.4) / 2;   /* ~296 */
var FELT_HX = HALF_W, FELT_HZ = HALF_H;

/* ---- camera axes (derived from baseCamPos + lookAt) ---- */
function buildCamera(aspect) {
  var rad = Math.PI / 180;
  var tH = Math.tan(FOV * rad / 2);                 /* tan(23deg) ~0.4245 */
  var extX = HALF_W + RAIL_DEPTH * 1.35;
  var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
  var tV = tH / Math.max(aspect, 0.001);
  var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
  var TILTR = TILT_DEG * rad;
  var camPos = [0, D * Math.cos(TILTR), D * Math.sin(TILTR)];
  var tgt = [0, RAIL_H * 0.2, 0];
  /* f = normalize(tgt - camPos) */
  var fx = tgt[0] - camPos[0], fy = tgt[1] - camPos[1], fz = tgt[2] - camPos[2];
  var fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  var f = [fx / fl, fy / fl, fz / fl];
  /* up: orthogonalize (0,1,0) against f */
  var d = f[1];                                     /* dot(up0=(0,1,0), f) */
  var up = [-d * f[0], 1 - d * f[1], -d * f[2]];
  var ul = Math.sqrt(up[0] * up[0] + up[1] * up[1] + up[2] * up[2]);
  up[0] /= ul; up[1] /= ul; up[2] /= ul;
  /* right = normalize(cross(f, up0)) */
  var rx = f[1] * 0 - f[2] * 1, ry = f[2] * 0 - f[0] * 0, rz = f[0] * 1 - f[1] * 0;
  var rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  var right = [rx / rl, ry / rl, rz / rl];
  return { camPos: camPos, f: f, up: up, right: right, tH: tH, aspect: aspect };
}

/* ---- ray from NDC to backdrop plane y=PLANE_Y ---- */
function hitPlane(cam, nx, ny) {
  var fx = cam.tH, fy = cam.tH / cam.aspect;
  /* worldDir = f + (fx*nx)*right + (fy*ny)*up   (derived: into-scene ray) */
  var dx = cam.f[0] + fx * nx * cam.right[0] + fy * ny * cam.up[0];
  var dy = cam.f[1] + fx * nx * cam.right[1] + fy * ny * cam.up[1];
  var dz = cam.f[2] + fx * nx * cam.right[2] + fy * ny * cam.up[2];
  var PLANE_Y = -231.0;
  if (dy >= -1e-6) return null;                     /* not going down */
  var t = (PLANE_Y - cam.camPos[1]) / dy;
  if (t <= 0) return null;
  return [cam.camPos[0] + t * dx, PLANE_Y, cam.camPos[2] + t * dz];
}

/* ---- occlusion: does the segment camera->H cross the table top (y=0)? ---- */
function occluded(cam, H) {
  /* ray crosses y=0 at parameter s = camY/(camY - H.y) (linear) */
  var s = cam.camPos[1] / (cam.camPos[1] - H[1]);
  var px = cam.camPos[0] + s * (H[0] - cam.camPos[0]);
  var pz = cam.camPos[2] + s * (H[2] - cam.camPos[2]);
  if (Math.abs(px) < CAB_HX && Math.abs(pz) < CAB_HZ) return true;   /* cabinet */
  if (Math.abs(px) < FELT_HX && Math.abs(pz) < FELT_HZ) return true; /* felt   */
  return false;
}

function main() {
  var seed = Number(process.argv[2]) || 20240927;
  var orb = genOrbs(seed, CFG.N);
  var t = 0.0, rot = [0.0, 0], camPar = [0, 0];
  var W = 48, H = 27;
  var CH = { occl: '#', orb: '=', 'bg': '.', dim: '·' };
  var rows = [], nOccl = 0, nBk = 0, nOrb = 0, sumLb = 0, maxLb = 0;
  for (var a = 0; a < 3; a++) {
    var aspect = [16 / 9, 1, 4 / 5][a];
    var cam = buildCamera(aspect);
    rows.push('aspect ' + aspect.toFixed(2));
    console.log('--- seed ' + seed + '  aspect ' + aspect.toFixed(3) + '  camPos=' +
      cam.camPos.map(function (v) { return v.toFixed(0); }).join(',') + '  D~' +
      Math.round(Math.hypot(cam.camPos[1], cam.camPos[2])) + ' ---');
    var out = [];
    for (var y = 0; y < H; y++) {
      var line = '';
      for (var x = 0; x < W; x++) {
        var nx = (x / W - 0.5) * 2, ny = (1 - y / H - 0.5) * 2;   /* screen up = +ny */
        var hit = hitPlane(cam, nx, ny);
        if (!hit) { line += '·'; continue; }
        if (occluded(cam, hit)) { out.push('occl'); nOccl++; line += '#'; continue; }
        /* backdrop visible: compute field colour at world (hit.x,z) */
        var uvx = hit[0] / SIDE, uvy = hit[2] / SIDE;               /* world -> uv */
        var c = fragPixel(uvx, uvy, t, rot, camPar, CFG.FLOW, orb);
        var l = lum(c);
        if (l > lum(UBG)) { nOrb++; line += 'x'; } else if (l > lum(UBG) * 1.35) { line += '='; }
        else line += '·';
        nBk++; sumLb += l; maxLb = Math.max(maxLb, l);
      }
      out.push('line:' + y);
      if (out.length % 2 === 0 || y === H - 1) { rows.push(line); }
    }
    var tot = nOccl + nBk;
    console.log('  backdrop-visible % = ' + ((nBk / Math.max(tot, 1)) * 100).toFixed(0) +
      '%   orb-pixels ' + nOrb + '   meanL(visible)=' + (sumLb / Math.max(nBk, 1)).toFixed(3) +
      '  maxL=' + maxLb.toFixed(3) + '  bgL=' + lum(UBG).toFixed(3));
    for (var ry = 0; ry < rows.length - 1; ry += 2) console.log('  ' + rows[ry]);
    rows.length = 0;
  }
  console.log('\nConclusion: if backdrop-visible% > 0 AND orb-pixels > 0, the main camera CAN see orbs.');
  console.log('            if backdrop-visible% == 0 (all occluded), the plane is hidden by the table.');
}
main();