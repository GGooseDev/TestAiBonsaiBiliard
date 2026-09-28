/* Verify the NEW framed cue: on-screen tip->butt length grows monotonically with
   power in every direction, and at power 1 the butt end stays inside the frame
   (no clipping). Reproduces _cueMaxOnScreenOff + on-screen length exactly. */
var THREE = require(require("path").join(__dirname, "lib", "three.min.js"));
var C = { BR: 14, CUE_STICK_LEN: 240, CUE_MAX_WORLD_OFF: 1500, CUE_SCREEN_INSET_FRAC: 0.04,
          IX0: 34, IX1: 966, IY0: 34, IY1: 526, RAIL_DEPTH: 42, RAIL_H: 46 };
var HALF_W = (C.IX1 - C.IX0) / 2, HALF_H = (C.IY1 - C.IY0) / 2;
var CXw = C.IX0 + HALF_W, CYw = C.IY0 + HALF_H;
function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }

var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22, VIEWW = 1280, VIEWH = 720;
var cam = new THREE.PerspectiveCamera(FOV, VIEWW / VIEWH, 0.1, 5000);
var tH = Math.tan(THREE.MathUtils.degToRad(FOV / 2)), tV = tH / (VIEWW / VIEWH);
var extX = HALF_W + C.RAIL_DEPTH * 1.35, extZ = HALF_H + C.RAIL_DEPTH * 1.35 + C.RAIL_H * 0.7;
var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
cam.position.set(0, D * Math.cos(THREE.MathUtils.degToRad(TILT_DEG)), D * Math.sin(THREE.MathUtils.degToRad(TILT_DEG)));
cam.lookAt(new THREE.Vector3(0, C.RAIL_H * 0.2, 0));
var REST_Y = C.BR;
function ptToCanvas(v, w, h) { var p = v.clone().project(cam); return { x: (p.x + 1) * 0.5 * w, y: 1 - (p.y + 1) * 0.5 * h }; }
function maxOff(dx, dy, cx, cy, baseSl, w, h) {
  var m = Math.max(12, Math.min(w, h) * (C.CUE_SCREEN_INSET_FRAC || 0.04));
  function inside(s) { var p = l2w(cx - dx * s, cy - dy * s, REST_Y); p.y += s * 0.14; var sp = ptToCanvas(p, w, h);
    return sp.x >= m && sp.x <= w - m && sp.y >= m && sp.y <= h - m; }
  if (!inside(baseSl)) return baseSl;
  var lo = baseSl, hi = C.CUE_MAX_WORLD_OFF;
  for (var i = 0; i < 24; i++) { var mid = (lo + hi) * 0.5; if (inside(mid)) lo = mid; else hi = mid; }
  return lo;
}
function screenLen(dx, dy, cx, cy, sl, w, h) {
  var tip = l2w(cx - dx * C.BR, cy - dy * C.BR, REST_Y);
  var butt = l2w(cx - dx * sl, cy - dy * sl, REST_Y); butt.y += sl * 0.14;
  var a = ptToCanvas(tip, w, h), b = ptToCanvas(butt, w, h);
  return Math.hypot(b.x - a.x, b.y - a.y);
}
var cueX = (C.IX0 + C.IX1) / 2, cueY = (C.IY0 + C.IY1) / 2; // ball centre ~ (500,280)
var dirs = [ {n:"up(away)",x:0,y:-1}, {n:"down(near)",x:0,y:1}, {n:"left",x:-1,y:0}, {n:"right",x:1,y:0} ];
console.log("dir | p=0 | p=.5 | p=1  (on-screen px)  [maxOff]  [in-frame @1]");
var allOk = true;
for (var i = 0; i < dirs.length; i++) {
  var d = dirs[i]; var baseSl = C.CUE_STICK_LEN;
  var off = maxOff(d.x, d.y, cueX, cueY, baseSl, VIEWW, VIEWH);
  var L0 = screenLen(d.x, d.y, cueX, cueY, baseSl, VIEWW, VIEWH);
  var sl1 = baseSl + 1.0 * (off - baseSl);
  var L1 = screenLen(d.x, d.y, cueX, cueY, sl1, VIEWW, VIEWH);
  var Lm = screenLen(d.x, d.y, cueX, cueY, baseSl + 0.5 * (off - baseSl), VIEWW, VIEWH);
  var inFrame = ptToCanvas(l2w(cueX - d.x * sl1, cueY - d.y * sl1, REST_Y).clone(), VIEWW, VIEWH) ;
  { var p = l2w(cueX - d.x * sl1, cueY - d.y * sl1, REST_Y); p.y += sl1 * 0.14;
    var s = ptToCanvas(p, VIEWW, VIEWH); var m = Math.max(12, Math.min(VIEWW,VIEWH)*C.CUE_SCREEN_INSET_FRAC);
    inFrame = (s.x >= m && s.x <= VIEWW - m && s.y >= m && s.y <= VIEWH - m); }
  if (L0 > Lm || Lm > L1) allOk = false;
  console.log(d.n.padEnd(13) + " " + L0.toFixed(0) + " | " + Lm.toFixed(0) + " | " + L1.toFixed(0) + "   [" + off.toFixed(0) + "]  " + (inFrame ? "yes" : "CLIPPED"));
}
console.log("\nmonotonic non-decreasing in all directions: " + allOk);
