/* Coordinate & raycasting helpers. Pure functions over shared state S; exported to
   S.coords so init.js/draw.js/api.js can call them (l2w, _ptToCanvas, firstContact,
   rayToFeltLen, screen-to-logical mapping, cue-stick framing). */
(function () {
  var W = window, P = W.Poole, C = P.CONFIG;
  var S = P._WebGL;

  /* world extents (logical units == world units) - set in init() */
  /* l2w: logical (x,y) + height -> world. World is centred by CXw/CYw offsets. */
  function l2w(x, y, hy) { return new THREE.Vector3(x - S.CXw, hy, -(y - S.CYw)); }

  /* Project a world point onto the current camera and return canvas pixel coords.
     Used only for on-screen framing checks (is a point inside the viewport). */
  function _ptToCanvas(v, w, h) {
    var p = v.clone().project(S.camera);
    return { x: (p.x + 1) * 0.5 * w, y: (1 - p.y) * 0.5 * h };
  }

  /* Largest world offset s (>= baseSl) at which the cue butt end is still inside the
     viewport. The butt sits at l2w(cx-dx*s, cy-dy*s, REST_Y) lifted by s*0.14 in y,
     matching the drawn stick exactly. Bounded by C.CUE_MAX_WORLD_OFF and inset from the
     frame edge by C.CUE_SCREEN_INSET_FRAC so a full-power cue is always fully visible
     and never clipped at the screen border. Returns baseSl when even the rest length
     leaves the frame (should not happen). */
  function _cueMaxOnScreenOff(dx, dy, cx, cy, baseSl, w, h) {
    if (!S.camera) return baseSl;
    var m = Math.max(12, Math.min(w, h) * (C.CUE_SCREEN_INSET_FRAC || 0.04));
    function inside(s) {
      var p = l2w(cx - dx * s, cy - dy * s, S.REST_Y);
      p.y += s * 0.14; /* same lift the drawn butt end uses */
      var sp = _ptToCanvas(p, w, h);
      return sp.x >= m && sp.x <= w - m && sp.y >= m && sp.y <= h - m;
    }
    if (!inside(baseSl)) return baseSl;
    var lo = baseSl, hi = C.CUE_MAX_WORLD_OFF || 1500;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) * 0.5;
      if (inside(mid)) { lo = mid; } else { hi = mid; }
    }
    return lo;
  }

  /* ray from canvas px,py to the felt plane; returns logical x,y (perspective-correct) */
  function _screenToLogical(px, py, cssW, cssH) {
    /* returns logical (x,y), or null when the GL context is not ready yet or the
       ray never intersects the felt plane. Null hands control back to ui.js, which
       then uses the flat pointer mapping instead of freezing at the centre point
       (a frozen centre would make the aim line and cue ignore the cursor). */
    if (!S.renderer || !S.camera) return null;
    S.ndc.set((px / cssW) * 2 - 1, 1 - (py / cssH));
    S.raycaster.setFromCamera(S.ndc, S.camera);
    if (S.raycaster.ray.intersectPlane(S.hitPlane, S.hitVec)) {
      return { x: S.hitVec.x + S.CXw, y: S.CYw - S.hitVec.z };
    }
    return null; /* no plane hit: defer to flat fallback in ui.js */
  }

  /* Convert a cursor position (canvas px) to the corrected logical aim point for a
     cue ball at logical (cx, cy). The aim is taken from the cursor's ON-SCREEN
     offset relative to the projected ball, decomposed into a per-frame tangent
     basis (two probe points one STEP in +X / +Y from the ball). This is immune to
     the distortion of raycasting an elevated cursor down to the felt plane, which
     made the cue point in a fixed direction when the cursor hovered near the ball.
     Returns { x, y } in table logical units, or null when the cursor is on the
     ball or the camera is not ready. */
  function _aimFromScreen(px, py, cssW, cssH, cx, cy) {
    if (!S.camera || !cssW || !cssH) return null;
    var bp = _ptToCanvas(l2w(cx, cy, S.REST_Y), cssW, cssH);
    var sx = px - bp.x, sy = py - bp.y;
    var sm = Math.sqrt(sx * sx + sy * sy);
    if (sm < 0.5) return null; /* cursor on the ball: no direction yet */
    var rp  = _ptToCanvas(l2w(cx + S.AIM_BASIS_STEP, cy, S.REST_Y), cssW, cssH);
    var upp = _ptToCanvas(l2w(cx, cy + S.AIM_BASIS_STEP, S.REST_Y), cssW, cssH);
    var sr = { x: rp.x - bp.x, y: rp.y - bp.y };  /* screen vector of +X */
    var su = { x: upp.x - bp.x, y: upp.y - bp.y };/* screen vector of +Y */
    var det = sr.x * su.y - sr.y * su.x;
    if (Math.abs(det) < 1e-6) return null;
    var a = (sx * su.y - sy * su.x) / det; /* steps along +X */
    var b = (sr.x * sy - sr.y * sx) / det; /* steps along +Y */
    return { x: cx + a * S.AIM_BASIS_STEP, y: cy + b * S.AIM_BASIS_STEP };
  }

  /* distance along a logical shot direction from (x,y) to the felt boundary */
  function rayToFeltLen(x, y, dx, dy) {
    var L = 8e5;
    if (dx > 0) L = Math.min(L, (C.IX1 - x) / dx);
    if (dx < 0) L = Math.min(L, (x - C.IX0) / -dx);
    if (dy > 0) L = Math.min(L, (C.IY1 - y) / dy);
    if (dy < 0) L = Math.min(L, (y - C.IY0) / -dy);
    return Math.max(1, Math.min(L, 600));
  }

  /* first object ball hit by the shot ray (cue centre -> normalized direction).
     Returns { ball, impactX, impactY } with the impact point on the struck ball's
     surface, or { ball: null } when the shot goes empty. Used to place the target
     marker on the ball the cue will actually strike, not at a far rail point. */
  function firstContact(cx, cy, dx, dy, balls) {
    if (!balls || balls.length === 0) return { ball: null };
    var R = C.BR * 2;                       /* surface-to-surface gap (cue + object) */
    var bestB = null, bestT = Infinity;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.id === 'cue' || b.inPocket) continue;
      var qx = b.x - cx, qy = b.y - cy;
      var ddot = qx * dx + qy * dy;
      if (ddot < 0.01) continue;            /* ball sits behind the shot start */
      var disc = ddot * ddot - (qx * qx + qy * qy) + R * R;
      if (disc < 0) continue;               /* ray misses the ball */
      var t = ddot - Math.sqrt(disc);       /* near intersection on the ray */
      if (t < 0.01 || t >= bestT) continue;
      bestB = b;
      bestT = t;
    }
    if (!bestB) return { ball: null };
    /* point on the ray nearest the struck centre, then back along its normal to
       the exact contact point on the ball surface */
      var rx = bestB.x - cx - bestT * dx;
      var ry = bestB.y - cy - bestT * dy;
      var rl = Math.sqrt(rx * rx + ry * ry) || 1;
      /* contact point on the struck ball's own surface (one BR back from its centre,
         not R=2BR — that lands on the cue ball's contact position instead) */
      return {
        ball: bestB,
        impactX: bestB.x - C.BR * (rx / rl),
        impactY: bestB.y - C.BR * (ry / rl)
      };
  }

  S.coords = { l2w: l2w, _ptToCanvas: _ptToCanvas, _cueMaxOnScreenOff: _cueMaxOnScreenOff,
    _screenToLogical: _screenToLogical, _aimFromScreen: _aimFromScreen,
    rayToFeltLen: rayToFeltLen, firstContact: firstContact };
})();
