'use strict';
/*
 * Headless camera / frustum checker (triage B1).
 *
 * Pure math only — no THREE, no DOM, no GL. It reproduces the exact numbers from
 * src/webgl3d.js (frameCamera, leg positions, backdrop plane) and src/config.js
 * to verify two things headlessly:
 *   1) does the default overhead view actually intersect the backdrop plane y=-231,
 *      and where (NDC coverage) — if the user sees black there, it's not occlusion;
 *   2) under ?debug_bg=1 the camera is (0,1350,760) lookAt(0,-232.0,860): check
 *      whether the red debug quad is in-frame and where it lands on screen.
 */

const DEG = Math.PI / 180;

/* ---- src/config.js ---- */
const IX0 = 34, IX1 = 966, IY0 = 34, IY1 = 526;
const HALF_W = (IX1 - IX0) / 2;   // 466
const HALF_H = (IY1 - IY0) / 2;   // 246

/* ---- src/webgl3d.js ---- */
var RAIL_DEPTH = 42, RAIL_H = 46, CAB_H = 70;
const FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
const FELT_THICK = 12;
const legLen = 150, legTopY = -FELT_THICK / 2 - CAB_H;   // -76
const bgY = legTopY - legLen - 5;                        // -231
const bokehHalf = (Math.max(IX1 - IX0, IY1 - IY0) + RAIL_DEPTH * 16) * 2.2 / 2;

function frameCamParams(fov, tilt, aspect) {
  var tanH = Math.tan((fov / 2) * DEG);
  var extX = HALF_W + RAIL_DEPTH * 1.35;
  var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
  var tanV = tanH / Math.max(aspect, 0.001);
  var D = Math.max(extX / tanH, extZ / tanV) * FRAMEMARGIN;
  var p = { x: 0, y: D * Math.cos(tilt * DEG), z: D * Math.sin(tilt * DEG) };
  var t = { x: 0, y: RAIL_H * 0.2, z: 0 };
  return { p: p, t: t, tanH: tanH, aspect: aspect };
}

/* OpenGL-style right-handed lookAt basis: r = right, u = up, f = forward (camera -z). */
function viewTransform(p, t) {
  var fx = t.x - p.x, fy = t.y - p.y, fz = t.z - p.z;
  var fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
  fx /= fl; fy /= fl; fz /= fl;
  var rx = -fz, ry = 0, rz = fx;                 /* cross(f, up=(0,1,0)) */
  var rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  rx /= rl; ry /= rl; rz /= rl;
  var ux = ry * fz - rz * fy;
  var uy = rz * fx - rx * fz;
  var uz = rx * fy - ry * fx;
  return { p: p, t: t, r: { x: rx, y: ry, z: rz }, u: { x: ux, y: uy, z: uz }, f: { x: fx, y: fy, z: fz } };
}

function ndc(vt, aspect, q) {
  var w = vt.f.x * (q.x - vt.p.x) + vt.f.y * (q.y - vt.p.y) + vt.f.z * (q.z - vt.p.z);
  var vx = vt.r.x * (q.x - vt.p.x) + vt.r.y * (q.y - vt.p.y) + vt.r.z * (q.z - vt.p.z);
  var vy = vt.u.x * (q.x - vt.p.x) + vt.u.y * (q.y - vt.p.y) + vt.u.z * (q.z - vt.p.z);
  var tanH = Math.tan(FOV / 2 * DEG);
  if (w <= 0.001) return null;
  return { x: (tanH / aspect) * vx / w, y: tanH * vy / w, w: w };
}

function samplePlane(vt, aspect, half, step) {
  var okX = [], okY = [], nOk = 0, nTotal = 0;
  for (var zx = -half; zx <= half + step / 2; zx += step) {
    for (var zz = -half; zz <= half + step / 2; zz += step) {
      var r = ndc(vt, aspect, { x: zx, y: bgY, z: zz });
      if (r && r.x >= -1 && r.x <= 1 && r.y >= -1 && r.y <= 1) { nOk++; okX.push(r.x); okY.push(r.y); }
      nTotal++;
    }
  }
  if (!nOk) return null;
  okX.sort(function (a, b) { return a - b; });
  okY.sort(function (a, b) { return a - b; });
  return {
    xMin: okX[0].toFixed(2), xMax: okX[okX.length - 1].toFixed(2),
    yMin: okY[0].toFixed(2), yMax: okY[okY.length - 1].toFixed(2),
    frac: (nOk / nTotal * 100).toFixed(1)
  };
}

function report(vt, aspect, label) {
  console.log('\n== ' + label + ' ==');
  console.log('cam pos = (' + vt.p.x.toFixed(1) + ',' + vt.p.y.toFixed(1) + ',' + vt.p.z.toFixed(1) + ')  lookAt (' + vt.t.x + ',' + vt.t.y.toFixed(1) + ',' + vt.t.z + ')');
  var cov = samplePlane(vt, aspect, bokehHalf, 24);
  if (cov) {
    console.log('backdrop plane y=' + bgY + ' visible region (NDC): x=[' + cov.xMin + ',' + cov.xMax + ']  y=[' + cov.yMin + ',' + cov.yMax + ']  (' + cov.frac + '% of sampled plane points)');
  } else {
    console.log('backdrop plane: NOT IN FRAME (0 sampled points visible)');
  }
  var pts = [
    ['backdrop center', { x: 0, y: bgY, z: 0 }],
    ['backdrop near-rail edge z=0', { x: 0, y: bgY, z: 0 }],
    ['quad OLD z=0', { x: 0, y: legTopY - legLen - 3.5, z: 0 }],
    ['quad NEW z=860', { x: 0, y: legTopY - legLen - 3.5, z: 860 }]
  ];
  for (var i = 0; i < pts.length; i++) {
    var r = ndc(vt, aspect, pts[i][1]);
    if (r) {
      var insideFrustum = r.x >= -1 && r.x <= 1 && r.y >= -1 && r.y <= 1;
      console.log(pts[i][0] + ' -> NDC (' + r.x.toFixed(3) + ',' + r.y.toFixed(3) + ')  in-frame=' + insideFrustum);
    } else {
      console.log(pts[i][0] + ' -> behind/beside view axis (not in frame)');
    }
  }
}

/* Default aspect unknown — the window aspect ratio is whatever the user has open.
   Cover the spread with typical windows; the band result should be robust to it. */
console.log('half-table: W=' + HALF_W + ' H=' + HALF_H + '  backdrop y=' + bgY + '  bokeh half-side=' + bokehHalf.toFixed(1));
var k = -1;

for (k = 0; k < 3; k++) {
  var aspects = [16 / 9, 1.0, 21 / 9];
  if (k === 1) { aspects = [1.0]; }      /* wider windows shrink the vertical spread */
  var a = aspects[0];
  var cam = frameCamParams(FOV, TILT_DEG, a);
  var vt = viewTransform(cam.p, cam.t);
  report(vt, a, 'default overhead view, aspect ' + a.toFixed(2));
}

/* ?debug_bg=1 camera (webgl3d.js L578-584) */
(function () {
  for (var j = 0; j < 3; j++) {
    var aspects2 = [16 / 9, 1.0, 21 / 9];
    if (j === 1) { aspects2 = [1.0]; }
    var a2 = aspects2[0];
    var dp = { x: 0, y: 1350, z: 760 };
    var dt = { x: 0, y: -232.0, z: 860 };
    var vt2 = viewTransform(dp, dt);
    report(vt2, a2, 'debug_bg=1 camera, aspect ' + a2.toFixed(2));
  }
})();
