/* One-off check: how much of the backdrop plane (y = legTopY - legLen - 5) does the
   framed view cover for each window aspect ratio? Reports required half-extent vs
   current default plane half-side (2.2x margin) and the margin needed for full
   coverage with 25% safety. Mirrors frameCamera() in src/webgl3d.js exactly. */
var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var RAIL_DEPTH = 42, RAIL_H = 46, CAB_H = 70, FELT_THICK = 12;
var HALF_W = (966 - 34) / 2, HALF_H = (526 - 34) / 2;
var extX = HALF_W + RAIL_DEPTH * 1.35;
var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;
var LEG_LEN = 150;
var PLANE_Y = -(FELT_THICK / 2 + CAB_H) - LEG_LEN - 5;
var DEG = Math.PI / 180;
var tH = Math.tan((FOV / 2) * DEG);
var A = TILT_DEG * DEG;
var BASE = Math.max(966 - 34, 526 - 34) + RAIL_DEPTH * 16;
var CUR_HALF = (BASE * 2.2) / 2;
function norm3(x, y, z) {
  var l = Math.sqrt(x * x + y * y + z * z) || 1e-9;
  return [x / l, y / l, z / l];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function extentForAspect(a) {
  var tV = tH / Math.max(a, 0.001);
  var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
  var C = [0, D * Math.cos(A), D * Math.sin(A)];
  var T = [0, RAIL_H * 0.2, 0];
  var f = norm3(T[0] - C[0], T[1] - C[1], T[2] - C[2]);
  var r = norm3.apply(null, cross3(f, [0, 1, 0]));
  var u = norm3.apply(null, cross3(r, f));
  var mx = 0, mz = 0;
  for (var sx = -1; sx <= 1; sx += 2) {
    for (var sy = -1; sy <= 1; sy += 2) {
      var d = [f[0] + sx * tV * r[0] + sy * tH * u[0],
               f[1] + sx * tV * r[1] + sy * tH * u[1],
               f[2] + sx * tV * r[2] + sy * tH * u[2]];
      d = norm3.apply(null, d);
      var t = (PLANE_Y - C[1]) / d[1];
      if (t <= 0) continue; /* ray goes away from the plane */
      var px = C[0] + t * d[0], pz = C[2] + t * d[2];
      mx = Math.max(mx, Math.abs(px));
      mz = Math.max(mz, Math.abs(pz));
    }
  }
  return { halfX: mx, halfZ: mz, D: D };
}
console.log('plane y = ' + PLANE_Y + '  base = ' + BASE.toFixed(1) + '  current half-side = ' + CUR_HALF.toFixed(1));
var worstReq = 0;
[0.75, 1.0, 1.33, 1.78, 2.0, 2.33, 2.5, 3.0].forEach(function (a) {
  var e = extentForAspect(a);
  var req = Math.max(e.halfX, e.halfZ);
  worstReq = Math.max(worstReq, req);
  console.log('aspect ' + a.toFixed(2) + ': D=' + e.D.toFixed(0) + '  req half-extent=' + req.toFixed(0)
    + '  current covers ' + ((CUR_HALF / req) * 100).toFixed(0) + '%');
});
console.log('worst-case required half-extent = ' + worstReq.toFixed(1));
var margin = (worstReq * 1.25) / BASE;
console.log('margin multiplier needed = ' + margin.toFixed(3) + '  -> use ' + Math.ceil(margin * 100) / 100 + 'x');
console.log('new half-side at ' + Math.ceil(margin * 100) / 100 + 'x = ' + (BASE * Math.ceil(margin * 100) / 100 / 2).toFixed(0));
