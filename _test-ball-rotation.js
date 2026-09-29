/* Headless rolling-spin test mirroring src/webgl3d.js `_updateBallSpin`:
   no-slip spin axis = normalize(up x dir) in world space, angle = path / BR,
   orientation accumulated as a world-space quaternion pre-multiply, identity
   reset on teleport (respot/newGame). Exits non-zero on any failure. */
var THREE = require('./lib/three.min.js');
globalThis.window = globalThis;
require('./src/config.js');
var C = globalThis.Poole.CONFIG;

function assert(cond, label) {
  if (!cond) throw new Error('FAIL: ' + label);
}

/* exact logic mirror of _updateBallSpin (without the THREE.Mesh wrapper) */
function updateSpin(q, prev, x, y) {
  var dsx = x - prev.x, dsy = y - prev.y;
  var ds = Math.sqrt(dsx * dsx + dsy * dsy);
  if (ds > C.BALL_ROT_RESET_DIST) { q.set(0, 0, 0, 1); return ds; }
  if (ds <= 1e-6) return ds;
  var axis = new THREE.Vector3(-dsy, 0, -dsx).normalize();
  var delta = new THREE.Quaternion().setFromAxisAngle(axis, ds / C.BR);
  q.copy(delta.multiply(q)).normalize();
  return ds;
}

/* --- one step in each direction: angle and axis must match no-slip physics ---
   logical +X -> world +X; logical +Y -> world -Z. */
var DS = 20;
function checkDir(dsx, dsy, label) {
  var q = new THREE.Quaternion();
  var prev = { x: 500, y: 300 };
  updateSpin(q, prev, 500 + dsx, 300 + dsy);
  /* expected axis (logical frame): (-dsy, 0, -dsx) normalized; angle ds/BR */
  var ax = new THREE.Vector3(-dsy, 0, -dsx).normalize();
  var exp = new THREE.Quaternion().setFromAxisAngle(ax, Math.sqrt(dsx * dsx + dsy * dsy) / C.BR);
  assert(Math.abs(q.dot(exp)) > 0.99999, label + ': orientation mismatch (dot=' + q.dot(exp) + ')');
  /* no-slip cross-check against up x dir in world space (logical +Y -> world -Z) */
  var q2 = new THREE.Quaternion();
  var d = new THREE.Vector3(dsx, 0, -dsy).normalize();
  updateSpin(q2, { x: 500, y: 300 }, 500 + dsx, 300 + dsy);
  var wAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
  var wExp = new THREE.Quaternion().setFromAxisAngle(wAxis, Math.sqrt(dsx * dsx + dsy * dsy) / C.BR);
  assert(Math.abs(q2.dot(wExp)) > 0.99999, label + ': world-axis mismatch (dot=' + q2.dot(wExp) + ')');
}
checkDir(DS, 0, 'spin +X (axis should be -Z)');
checkDir(0, DS, 'spin +Y (axis should be -X)');
checkDir(DS / Math.sqrt(2), DS / Math.sqrt(2), 'spin diagonal');

/* --- N steps in a straight line accumulate angle linearly (no drift) --- */
var q = new THREE.Quaternion();
var prev = { x: 300, y: 300 };
var STEPS = 50;
for (var s = 0; s < STEPS; s++) {
  updateSpin(q, prev, prev.x + DS, prev.y);
  prev.x += DS;
}
/* total angle N * ds / BR about axis (0,0,-1) */
var totalAngle = STEPS * DS / C.BR;
var expTotal = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), totalAngle);
assert(Math.abs(q.dot(expTotal)) > 0.99999, 'straight-line accumulation (dot=' + q.dot(expTotal) + ')');

/* --- teleport resets orientation to identity --- */
updateSpin(q, { x: 500, y: 300 }, 520, 300); /* build some spin */
assert(Math.abs(q.w) < 1 - 1e-6, 'ball should be spun before teleport');
var JUMP = C.BR * 40; /* far beyond BALL_ROT_RESET_DIST */
updateSpin(q, { x: 500, y: 300 }, 500 + JUMP, 300);
assert(Math.abs(q.x) < 1e-6 && Math.abs(q.y) < 1e-6 && Math.abs(q.z) < 1e-6 && Math.abs(q.w - 1) < 1e-6,
       'teleport must reset orientation to identity');

/* --- normal per-frame travel never exceeds the reset threshold (no spurious resets) --- */
assert(C.MAX_SHOT_SPEED * C.STEP + 5 < C.BALL_ROT_RESET_DIST,
       'max per-frame travel (' + (C.MAX_SHOT_SPEED * C.STEP).toFixed(1) + ') must stay below reset dist (' + C.BALL_ROT_RESET_DIST + ')');

/* --- resting ball keeps orientation unchanged --- */
updateSpin(q, { x: 500, y: 300 }, 500 + DS, 300);
var snapW = q.w;
updateSpin(q, { x: 520, y: 300 }, 520, 300); /* ds == 0 */
assert(Math.abs(q.w - snapW) < 1e-9 && Math.abs(q.x) < 1e-9, 'resting ball must not change orientation');

console.log('PASS: ball rolling spin math (' +
  (STEPS * DS / C.BR).toFixed(2) + ' rad accumulated over ' + STEPS + ' steps; teleport reset OK; no-slip axes OK');
