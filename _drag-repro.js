/* Reproduce "cue compresses along its axis from mouse movement" by simulating
   real pointer drags through the ACTUAL ui.js mapping + the ACTUAL webgl3d.js
   cue math + the ACTUAL frameCamera camera, then measuring on-screen cue length. */
var THREE = require(require("path").join(__dirname, "lib", "three.min.js"));
var C = { BR: 14, CUE_STICK_LEN: 240, CUE_MAX_EXTEND: 160, IX0: 34, IX1: 966, IY0: 34, IY1: 526,
          RAIL_DEPTH: 42, RAIL_H: 46, POWER_MAX_DIST: 240 };
var HALF_W = (C.IX1 - C.IX0) / 2, HALF_H = (C.IY1 - C.IY0) / 2;
var CXw = C.IX0 + HALF_W, CYw = C.IY0 + HALF_H;
function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }

var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var aspect = 1280 / 720;
var cam = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 5000);
var tH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), tV = tH / aspect;
var extX = HALF_W + C.RAIL_DEPTH * 1.35, extZ = HALF_H + C.RAIL_DEPTH * 1.35 + C.RAIL_H * 0.7;
var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
cam.position.set(0, D * Math.cos(THREE.MathUtils.degToRad(TILT_DEG)), D * Math.sin(THREE.MathUtils.degToRad(TILT_DEG)));
cam.lookAt(new THREE.Vector3(0, C.RAIL_H * 0.2, 0));

var VIEWW = 1280, VIEWH = 720;
function toScreen(v) { var p = v.clone().project(cam); return { x: (p.x + 1) / 2 * VIEWW, y: 1 - (p.y + 1) / 2 * VIEWH }; }

/* ACTUAL ui.js mapping: pointer in screen px relative to ball-at-center;
   power = clamp(dist(ptr,ball)-BR / POWER_MAX_DIST,0,1); aim opposite the pointer. */
function cueFromPointer(px, py, power) {
  var cx = 500, cy = 280;                      // world/logical cue ball (at origin)
  var dx = -(px - cx), dy = -(py - cy);        // monolith: cue points AWAY from pointer
  var dl = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dl; dy /= dl;
  var tip = l2w(cx - dx * C.BR, cy - dy * C.BR, C.BR);
  var sl = C.CUE_STICK_LEN + power * C.CUE_MAX_EXTEND;
  var be = l2w(cx - dx * sl, cy - dy * sl, C.BR);
  be.y = C.BR + sl * 0.14;
  return { tip: tip, butt: be, sl };
}
function screenLen(c) { var a = toScreen(c.tip), b = toScreen(c.butt); return Math.hypot(b.x - a.x, b.y - a.y); }

var DIRS = [ {n:"up",px:-400,py:400}, {n:"down",px:400,py:-400}, {n:"left",px:-400,py:0},
             {n:"right",px:400,py:0}, {n:"up-left",px:-400,py:400}, {n:"down-right",px:400,py:-400} ];
console.log("drag px/py -> power | on-screen cue length (px) at that power");
for (var i = 0; i < DIRS.length; i++) {
  var d = DIRS[i];
  var row = d.n.padEnd(10);
  for (var p = 0.0; p <= 1.001; p += 0.25) {
    var ptrScale = 240 * p;                     // drag away by (power*POWER_MAX_DIST)+BR logical units
    var px = d.px / Math.hypot(d.px, d.py) * (C.BR + ptrScale);
    var py = d.py / Math.hypot(d.px, d.py) * (C.BR + ptrScale);
    var c = cueFromPointer(px, py, p);
    row += (p === 0 ? "" : "\t| " + screenLen(c).toFixed(0));
  }
  console.log(row + "\n");
}
