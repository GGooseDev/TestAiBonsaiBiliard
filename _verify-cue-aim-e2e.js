/* END-TO-END headless verification of the cue-aim fix using the EXACT real
   constants (config.js) and the EXACT real camera (frameCamera), l2w,
   _aimFromScreen from webgl3d.js, and the EXACT cue tip/butt layout from the
   draw loop.

   For each of 8 cursor directions around the ball we assert that, ON SCREEN,
   the cue tip and butt project on the SAME side of the ball as the cursor
   (cue axis aligned with the ball->cursor line). That is what "the cue
   rotates about the ball in the cursor direction" means.

   Runs at the real break position AND the table centre, two frame sizes.
 */
var THREE = require('./lib/three.min.js');

/* load real config via the window shim */
var win = {};
globalThis.window = win;
require('./src/config.js');
var C = win.Poole.CONFIG;

/* ---- constants copied exactly from webgl3d.js ---- */
var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var RAIL_DEPTH = 42, RAIL_H = 46, REST_Y = C.BR;
var AIM_BASIS_STEP = 10;

var HALF_W, HALF_H, CXw, CYw;
function initExtents() {
  HALF_W = (C.IX1 - C.IX0) / 2; HALF_H = (C.IY1 - C.IY0) / 2;
  CXw = C.IX0 + HALF_W; CYw = C.IY0 + HALF_H;
}

var camera, scene, baseCamPos;
initExtents();

function l2w(x, y, hy) { return new THREE.Vector3(x - CXw, hy, -(y - CYw)); }
function _ptToCanvas(v, w, h) {
  var p = v.clone().project(camera);
  return { x: (p.x + 1) * 0.5 * w, y: 1 - (p.y + 1) * 0.5 * h };
}

/* frameCamera verbatim (minus scene.add / renderer bits that don't affect projection) */
function frameCamera(w, h) {
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  var tH = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  var tV = tH / Math.max(w / h, 0.001);
  var extX = HALF_W + RAIL_DEPTH * 1.35;
  var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
  var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
  baseCamPos.set(0, D * Math.cos(THREE.MathUtils.degToRad(TILT_DEG)),
                D * Math.sin(THREE.MathUtils.degToRad(TILT_DEG)));
  camera.position.copy(baseCamPos);
  camera.lookAt(0, RAIL_H * 0.2, 0);
}

/* _aimFromScreen verbatim */
function aimFromScreen(px, py, cssW, cssH, cx, cy) {
  if (!camera || !cssW || !cssH) return null;
  var bp = _ptToCanvas(l2w(cx, cy, REST_Y), cssW, cssH);
  var sx = px - bp.x, sy = py - bp.y;
  var sm = Math.sqrt(sx * sx + sy * sy);
  if (sm < 0.5) return null;
  var rp  = _ptToCanvas(l2w(cx + AIM_BASIS_STEP, cy, REST_Y), cssW, cssH);
  var upp = _ptToCanvas(l2w(cx, cy + AIM_BASIS_STEP, REST_Y), cssW, cssH);
  var sr = { x: rp.x - bp.x, y: rp.y - bp.y };
  var su = { x: upp.x - bp.x, y: upp.y - bp.y };
  var det = sr.x * su.y - sr.y * su.x;
  if (Math.abs(det) < 1e-6) return null;
  var a = (sx * su.y - sy * su.x) / det;
  var b = (sr.x * sy - sr.y * sx) / det;
  return { x: cx + a * AIM_BASIS_STEP, y: cy + b * AIM_BASIS_STEP };
}

/* cue tip & butt EXACTLY as in draw(), for a given aim (logical) and power */
function cueScreenPoints(cssW, cssH, cue, aimX, aimY, power) {
  var dx = -(aimX - cue.x), dy = -(aimY - cue.y);
  var dlen = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dlen; dy /= dlen;
  var tipX = cue.x - dx * C.BR, tipY = cue.y - dy * C.BR;
  var nose = l2w(tipX, tipY, REST_Y);
  var baseSl = C.CUE_STICK_LEN;
  var sl = baseSl + power * 150; /* approx of _cueMaxOnScreenOff growth; enough to see butt */
  var bEnd = new THREE.Vector3(
    l2w(cue.x - dx * sl, cue.y - dy * sl, REST_Y).x,
    REST_Y + sl * 0.14,
    l2w(cue.x - dx * sl, cue.y - dy * sl, REST_Y).z);
  return { nose: _ptToCanvas(nose, cssW, cssH), butt: _ptToCanvas(bEnd, cssW, cssH) };
}

function onSameSide(a, b, c) { /* (a-b) and (c-b) same sign? a is the point, c the cursor */
  return (a - b) * (c - b) >= -1e-6;
}

function runFrame(cssW, cssH, cuePos, label) {
  camera = new THREE.PerspectiveCamera(FOV, cssW / cssH, 0.1, 5000);
  scene = new THREE.Scene();
  baseCamPos = new THREE.Vector3();
  frameCamera(cssW, cssH);

  var ballPix = _ptToCanvas(l2w(cuePos.x, cuePos.y, REST_Y), cssW, cssH);
  console.log('\n[%s] ball logical(%.0f,%.0f) -> screen(%.0f,%.0f) of %dx%d',
    label, cuePos.x, cuePos.y, ballPix.x, ballPix.y, cssW, cssH);

  var dirs = [
    {n:'R',  dx: 120, dy: 0},  {n:'L',  dx:-120, dy: 0},
    {n:'U',  dx: 0,   dy:-120}, {n:'D',  dx: 0,   dy: 120},
    {n:'UR', dx: 84,  dy:-84},  {n:'UL', dx:-84,  dy:-84},
    {n:'DR', dx: 84,  dy: 84},  {n:'DL', dx:-84,  dy: 84},
  ];
  var pass = 0;
  dirs.forEach(function(d) {
    var cx = ballPix.x + d.dx, cy = ballPix.y + d.dy;
    var aim = aimFromScreen(cx, cy, cssW, cssH, cuePos.x, cuePos.y);
    if (!aim) { console.log('  %s -> null (cursor on ball?)', d.n); return; pass++; }
    var pts = cueScreenPoints(cssW, cssH, cuePos, aim.x, aim.y, 0.6);
    var noseSameX = onSameSide(pts.nose.x, ballPix.x, cx);
    var noseSameY = onSameSide(pts.nose.y, ballPix.y, cy);
    var buttSameX = onSameSide(pts.butt.x, ballPix.x, cx);
    var buttSameY = onSameSide(pts.butt.y, ballPix.y, cy);
    var ok = true;
    if (Math.abs(d.dx) > 10) ok = ok && noseSameX && buttSameX;
    if (Math.abs(d.dy) > 10) ok = ok && noseSameY && buttSameY;
    console.log('  %s aim(%7.1f,%.1f) nose(%.0f,%.0f) butt(%.0f,%.0f)  %s',
      d.n, aim.x, aim.y, pts.nose.x, pts.nose.y, pts.butt.x, pts.butt.y, ok ? 'OK' : 'MISMATCH');
    if (ok) pass++;
  });
  console.log('  [%s] %d/%d directions aligned', label, pass, dirs.length);
}

runFrame(1920, 1080, C.CUE_BREAK_POS, 'break');
runFrame(1920, 1080, { x: (C.IX0 + C.IX1) / 2, y: (C.IY0 + C.IY1) / 2 }, 'centre');
runFrame(1366, 768, C.CUE_BREAK_POS, 'break-1366');
