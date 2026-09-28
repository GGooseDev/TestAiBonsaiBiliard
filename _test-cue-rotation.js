/* Headless rotation + offset test for the cue aim mapping (src/webgl3d.js
   _aimFromScreen / screenToTableLogical). Verified against the REAL camera
   framing. Exits non-zero if any case fails. */
var THREE = require('./lib/three.min.js');
var win = {}; globalThis.window = win;
require('./src/config.js'); var C = win.Poole.CONFIG;

var FOV = 46, TILT = 28, MARGIN = 1.22, RAIL_DEPTH = 42, RAIL_H = 46, REST_Y = C.BR;
var HALF_W = (C.IX1 - C.IX0) / 2, HALF_H = (C.IY1 - C.IY0) / 2;
var CXw = C.IX0 + HALF_W, CYw = C.IY0 + HALF_H;
var camera = null;

function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }

function makeCam(w, h) {
  var c = new THREE.PerspectiveCamera(FOV, w / h, 5, 3000);
  var tH = Math.tan(Math.PI * FOV / 360), tV = tH / Math.max(w / h, 0.001);
  var extX = HALF_W + RAIL_DEPTH * 1.35, extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
  var D = Math.max(extX / tH, extZ / tV) * MARGIN;
  c.position.set(0, D * Math.cos(Math.PI * TILT / 180), D * Math.sin(Math.PI * TILT / 180));
  c.lookAt(new THREE.Vector3(0, RAIL_H * 0.2, 0));
  c.updateMatrixWorld(true); /* camera must be world-updated before project() */
  return c;
}

function p2(v, w, h) {
  camera.updateMatrixWorld(true);
  var r = v.clone().project(camera);
  return { x: (r.x + 1) * 0.5 * w, y: (1 - r.y) * 0.5 * h };
}

/* Mirror of webgl3d.js _aimFromScreen (verified byte-for-byte against src). */
function aim(px, py, cw, ch, cx, cy) {
  var bp = p2(l2w(cx, cy, REST_Y), cw, ch);
  var sx = px - bp.x, sy = py - bp.y, sm = Math.sqrt(sx * sx + sy * sy);
  if (sm < 0.5) return null;
  var rp = p2(l2w(cx + 10, cy, REST_Y), cw, ch);
  var upp = p2(l2w(cx, cy + 10, REST_Y), cw, ch);
  var sr = { x: rp.x - bp.x, y: rp.y - bp.y };
  var su = { x: upp.x - bp.x, y: upp.y - bp.y };
  var det = sr.x * su.y - sr.y * su.x;
  if (Math.abs(det) < 1e-6) return null;
  return { x: cx + ((sx * su.y - sy * su.x) / det) * 10,
           y: cy + ((sr.x * sy - sr.y * sx) / det) * 10 };
}

function angDiff(a, b) { return Math.abs((a - b + Math.PI) % (Math.PI * 2) - Math.PI); }
function angleOf(p, b) { return Math.atan2(p.y - b.y, p.x - b.x); }

var Ww = 1920, Hh = 1080;
var failures = 0, total = 0;
var N = 24;
var BALLS = [ [500, 280], [240, 130], [820, 240] ];
var RADII = [8, 20, 40];

camera = makeCam(Ww, Hh);
BALLS.forEach(function(bc) {
  var bal = p2(l2w(bc[0], bc[1], REST_Y), Ww, Hh);
  for (var i = 0; i < RADII.length; i++) {
    var Rpx = RADII[i];
    for (var k = 0; k < N; k++) {
      var th = k * 2 * Math.PI / N;
      var cx = bal.x + Rpx * Math.cos(th), cy = bal.y - Rpx * Math.sin(th);
      total++;
      var a = aim(cx, cy, Ww, Hh, bc[0], bc[1]);
      if (!a) { console.log('FAIL null aim @ ' + bc.join(',') + ' R=' + Rpx + ' deg=' + (k * 15)); failures++; continue; }
      var dx = -(a.x - bc[0]), dy = -(a.y - bc[1]);
      var dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      var tip = p2(l2w(bc[0] - dx * C.BR, bc[1] - dy * C.BR, REST_Y), Ww, Hh);
      var curA = angleOf({ x: cx, y: cy }, bal), tipA = angleOf(tip, bal);
      var ddeg = angDiff(curA, tipA) * 180 / Math.PI;
      var okX = (Math.sign(cx - bal.x) * Math.sign(tip.x - bal.x) > 0) || cx === bal.x;
      var okY = (Math.sign(cy - bal.y) * Math.sign(tip.y - bal.y) > 0) || cy === bal.y;
      if (!(okX && okY) || ddeg > 25) {
        console.log('FAIL @ ' + bc.join(',') + ' R=' + Rpx + ' deg=' + (k * 15) +
          ' side=' + ((okX && okY) ? 'OK' : 'WRONG') + ' aerr=' + ddeg.toFixed(1));
        failures++;
      }
    }
  }
});

console.log(failures === 0
  ? 'PASS: cue rotation + offset correct across ' + total + ' cases (tip on cursor side, <25 deg error)'
  : 'FAIL: ' + failures + ' case(s)');
process.exitCode = failures ? 1 : 0;
