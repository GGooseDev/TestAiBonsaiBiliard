/* Per-frame render. draw(state) reads P.State each frame to position lit balls + cue,
   animate the backdrop/zoom/shake, and (for Battle Arena) drive character anchors +
   follow-camera. _updateBallSpin integrates no-slip roll; setAimDash rebuilds the
   dashed trajectory. Exports S.drawFn. */
(function () {
  var W = window, P = W.Poole, C = P.CONFIG;
  var S = P._WebGL;

  /* integrate no-slip rolling spin for one ball from its per-frame logical
     displacement. Spin axis is up x dir in world space, which is (-dy, 0, -dx) since
     l2w maps logical y to negative world z; angle is path length over radius BR.
     Orientation accumulates in world space (delta pre-multiplied). A jump larger than
     C.BALL_ROT_RESET_DIST (respot / newGame) resets the ball to identity so a fresh
     placement never inherits stale spin or whips around on screen. */
  function _updateBallSpin(b, m) {
    var prev = S._ballPrev[b.id];
    S._ballPrev[b.id] = { x: b.x, y: b.y };
    if (b.inPocket || !prev) return;

    var q = S._ballQuats[b.id];
    if (!q) { q = new THREE.Quaternion(); S._ballQuats[b.id] = q; }

    var dsx = b.x - prev.x, dsy = b.y - prev.y;
    var ds = Math.sqrt(dsx * dsx + dsy * dsy);
    if (ds > C.BALL_ROT_RESET_DIST) {
      q.set(0, 0, 0, 1); /* teleport: re-orient, no inherited spin */
    } else if (ds > 1e-6) {
      S._axisWorld.set(-dsy, 0, -dsx).normalize();
      S._qDelta.setFromAxisAngle(S._axisWorld, ds / C.BR);
      q.copy(S._qDelta.multiply(q)).normalize(); /* world-space: delta applied after */
    }
    m.quaternion.copy(q);
  }

  /* build the aim trajectory as dashed world-space segments so it reads as a guide
     anchored to the cue ball surface, clearly separated from the solid cue stick. */
  function setAimDash(a, b) {
    var ab = new THREE.Vector3().subVectors(b, a);
    var len = ab.length();
    var u = len > 0.01 ? ab.normalize() : new THREE.Vector3(1, 0, 0);
    var p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
    var pts = [];
    for (var t = 0; t < len; t += C.AIM_DASH + C.AIM_GAP) {
      var e = Math.min(t + C.AIM_DASH, len);
      if (e <= t) break;
       p0.copy(a).addScaledVector(u, t); pts.push(p0.clone());
       p1.copy(a).addScaledVector(u, e);   pts.push(p1.clone());
    }
    if (pts.length === 0) { pts = [a, b]; }
    S.aimLineMesh.geometry.dispose();
    S.aimLineMesh.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  /* ---- Battle Arena: character anchors + chase camera ------------------- */
  var ARENA_FOLLOW_H = 210;    /* height above felt for the chase cam */
  var ARENA_FOLLOW_D = 320;    /* depth behind the char (toward +z / viewer) */
  var _charAnchors = {};       /* ballId -> { anchor: THREE.Group, char } */
  var _lastCharNow = null;
  var _arenaCamPos = null;     /* lazily built on first arena chase frame (needs THREE) */
  var _arenaLookT  = null;

  /* true when this ball id is one of the arena's character balls (drawn as a
     P.Character, not a plain sphere) */
  function _isCharBallId(state, id) {
    if (!P.Arena || !P.Arena.isActive() || !state || !state.chars) return false;
    for (var i = 0; i < state.chars.length; i++) if (state.chars[i].id === id) return true;
    return false;
  }

  /* lazily create a scaled THREE.Group anchor per character ball and keep it
     registered to the live ball position each frame. The char body is built in
     viewer units (radius 50), so scale by C.BR/50 to match a game ball. */
  function _syncChars(state, now) {
    var active = P.Arena && P.Arena.isActive();
    if (!active) {
      for (var k in _charAnchors) { S.scene.remove(_charAnchors[k].anchor); delete _charAnchors[k]; }
      return;
    }
    if (!state || !state.chars || state.chars.length === 0) return;
    var dt = _lastCharNow != null ? Math.min(0.1, (now - _lastCharNow) / 1000) : 0;
    _lastCharNow = now;
    /* drop anchors for ids that are no longer characters (restart / respawn) */
    var seen = {};
    for (var i = 0; i < state.chars.length; i++) {
      if (state.chars[i].char) seen[String(state.chars[i].id)] = true;
    }
    for (var k2 in _charAnchors) {
      if (!seen[k2]) { S.scene.remove(_charAnchors[k2].anchor); delete _charAnchors[k2]; }
    }
    var scale = C.BR / 50;
    for (var i3 = 0; i3 < state.chars.length; i3++) {
      var c = state.chars[i3];
      if (!c.char) continue;             /* headless / no THREE: nothing to draw */
      var key = String(c.id);
      var entry = _charAnchors[key];
      if (!entry) {
        entry = { anchor: new THREE.Group(), char: c.char };
        entry.anchor.scale.set(scale, scale, scale);
        S.scene.add(entry.anchor);
        _charAnchors[key] = entry;
      }
      var ball = c.ball;
      if (ball.inPocket) {
        entry.anchor.visible = false;
      } else {
        entry.anchor.visible = true;
        entry.anchor.position.copy(S.coords.l2w(ball.x, ball.y, S.REST_Y));
        entry.char.update(dt);
      }
    }
  }

  /* follow behind the active ball-character while it moves (only when the human
     plays Balls; Cue keeps the overhead framing). Entry glides in via lerp. */
  function _applyArenaFollow(state) {
    if (S.DEBUG_BG || !P.Arena || !P.Arena.isActive() || !state) return;
    var as = P.Arena.state;
    if (!as || as.phase !== "ballMove" || as.humanTeam !== "balls") return;
    var chars = as.chars || [];
    var ai = (typeof as.activeCharIdx === "number" ? as.activeCharIdx : 0);
    var ch = chars[ai];
    if (!ch || !ch.ball) return;
    var ball = ch.ball;
    if (!_arenaCamPos) { _arenaCamPos = new THREE.Vector3(); _arenaLookT = new THREE.Vector3(); }
    var t = S.coords.l2w(ball.x, ball.y, S.REST_Y + 10);
    _arenaLookT.copy(t);
    _arenaCamPos.set(t.x, t.y + ARENA_FOLLOW_H, t.z + ARENA_FOLLOW_D);
    S.camera.position.lerp(_arenaCamPos, 0.25);
    S.camera.lookAt(_arenaLookT.x, _arenaLookT.y - 4, _arenaLookT.z);
  }

  S.drawFn = function (state) {
    if (!S.renderer) return;
     /* menu backdrop loop passes no state: hide the whole table and render only
        the bokeh room so the startup screen is a warm glow, not a live table */
     S.tableGroup.visible = !!state;
     var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
     if (S.bokehMat) {
       /* time, slow autonomous rotation, and a parallax slide against the camera:
          the colored field walks on its own behind the table and slides when the
          view tilts or shakes */
       var ut = now * 0.001;
       S.bokehMat.uniforms.uTime.value = ut;
       S.bokehMat.uniforms.uRot.value =
         Math.sin(ut * C.BOKEH_ROT_SPEED) * (C.BOKEH_ROT_A || 0.03) +
         Math.cos((ut * 1.41 * C.BOKEH_ROT_SPEED) + 1.37) * (C.BOKEH_ROT_B || 0.018);
      }

    /* smooth wheel zoom: ease the current level toward the target set by the wheel.
       0 = far base frame (current default), 1 = straight down over the field centre. */
    if (!S.DEBUG_BG) {
      var zdt = Math.min(0.1, (now - S._lastDrawNow) * 0.001);
      S._lastDrawNow = now;
      S.zoomT += (S.zoomTargetT - S.zoomT) * (1 - Math.exp(-zdt * S.ZOOM_SPEED));
      if (Math.abs(S.zoomTargetT - S.zoomT) < 0.001) S.zoomT = S.zoomTargetT; /* snap, no tail */
    }

    /* camera shake (decaying jitter around the framed base position) */
    var shake = 0;
    if (state && state.shakeUntil > now) shake = Math.min(1, (state.shakeUntil - now) / (C.SHAKE_MS || 700));
    S.camOffset.set(
      Math.sin(now * 0.13 + 1.7) * 6 * shake,
      Math.sin(now * 0.11 + 2.2) * 4 * shake,
      Math.sin(now * 0.17 + 0.4) * 6 * shake);
       S._zoomPos.lerpVectors(S.baseCamPos, S.nearCamPos, S.zoomT);
       S.camera.position.copy(S._zoomPos).add(S.camOffset);
       if (shake <= 0) {
         /* keep the interpolated orientation when not shaking so the backdrop stays put */
         S._zoomLook.lerpVectors(S.farLookAt, S.nearLookAt, S.zoomT);
         S.camera.lookAt(S._zoomLook.x, S._zoomLook.y, S._zoomLook.z);
       }
       /* backdrop is a fixed room element: translate it by the same shake vector
          as the camera so its on-screen position never changes while the table
          jitters. (Skipped in debug_bg mode where the camera is overridden and not
          shaken.) Parallax uses only the shake offset, not the full zoom offset тАФ
          the top-down end moves ~800 world units vs base and would slide half the
          backdrop uv field out of view otherwise. */
       var px = (S.camOffset.x / S.bokehHalf) * (C.BOKEH_PARALLAX || 1.0);
       var pz = (S.camOffset.z / S.bokehHalf) * (C.BOKEH_PARALLAX || 1.0);
       if (S.bokehMat) S.bokehMat.uniforms.uCamPar.value.set(px, pz);
       if (!S.DEBUG_BG && S.bokehMesh) {
         S.bokehMesh.position.copy(S.bokehMeshBasePos).add(S.camOffset);
       }
    if (S.DEBUG_BG) {
      /* debug only: stare down at the glint strip near the near rail so the
         colored backdrop fills the frame and can be checked standalone */
      var dbPos = new THREE.Vector3(0, 1350, 760);
      S.camera.position.copy(dbPos);
      S.camera.lookAt(new THREE.Vector3(0, -232.0, 860));
    }

    /* Battle Arena: override the overhead framing to chase the active ball-character
       while it moves (only for the human playing Balls; Cue keeps the default view). */
    _applyArenaFollow(state);

    if (!S.DEBUG_BG) {
      /* balls */
     if (state) {
       for (var i = 0; i < state.balls.length; i++) {
         var b = state.balls[i];
         var m = S.ballsById[b.id];
         if (!m) continue;
          m.position.copy(S.coords.l2w(b.x, b.y, S.REST_Y));
          /* a character ball is drawn as a P.Character anchor instead of a plain sphere */
          m.visible = !b.inPocket && !_isCharBallId(state, b.id);
          _updateBallSpin(b, m);
        }
    }

     /* Battle Arena: (re)position + animate the character anchors to follow their balls. */
    _syncChars(state, now);

      /* aim line + stick (only while aiming, hide during flight / game over) */
      var wantAim = false, aimX = 0, aimY = 0, power = 0;
      if (state && state.cue) {
        if (P.UI && P.UI.aiming && !P.UI.botAiming) { wantAim = true; aimX = P.UI.aimX; aimY = P.UI.aimY; power = P.UI.power || 0; }
        else if (P.UI && P.UI.botAiming) { wantAim = true; aimX = P.UI.botAimX; aimY = P.UI.botAimY; power = P.UI.botPower || 0; }
      }
      /* During the cue-strike swing the stick animates even though no aim preview is active. */
      var strike = state ? state.strike : null;
      if (!wantAim && strike) { wantAim = true; }
     if (wantAim && state.cue) {
       var cue = state.cue;
        var dx = -(aimX - cue.x), dy = -(aimY - cue.y);
        if (strike) { dx = strike.dx; dy = strike.dy; }
        var dlen = Math.sqrt(dx * dx + dy * dy) || 1; dx /= dlen; dy /= dlen;
          /* point BR behind the ball centre along the shot direction (cue side);
             kept for the optional [AIMDBG] pointer-vs-tip angle log only */
          var tipX = cue.x - dx * C.BR, tipY = cue.y - dy * C.BR;

          /* which object ball will be struck first? Marker + felt ring sit at the
            predicted impact point on its surface; fall back to the rail line when
            the shot goes empty. */
         var fc = S.coords.firstContact(cue.x, cue.y, dx, dy, state.balls);
         var lenL = S.coords.rayToFeltLen(cue.x, cue.y, dx, dy);
         var gx = fc.ball ? fc.impactX : cue.x + dx * lenL;
         var gy = fc.ball ? fc.impactY : cue.y + dy * lenL;

         S.aimLineMesh.visible = true; S.shaftMesh.visible = true; S.buttMesh.visible = true;
          /* trajectory runs from the ball's surface in the shot direction to the
             predicted impact point; rendered as dashed world-space segments so it reads
             as a guide anchored to the ball, not an extension of the cue stick */
          setAimDash(S.coords.l2w(cue.x + dx * C.BR, cue.y + dy * C.BR, S.REST_Y), S.coords.l2w(gx, gy, S.REST_Y));
         S.targetRingMesh.position.copy(S.coords.l2w(gx, gy, 0.4));
        if (fc.ball) {
          /* a struck ball exists: bright dot floats above its centre and the felt
             ring circles it, so both read clearly from the overhead view */
          S.targetMesh.visible = true;
          S.targetMesh.position.copy(S.coords.l2w(fc.ball.x, fc.ball.y, S.REST_Y + C.BR * 2.4));
        } else {
          /* empty shot: only the rail-line ring is shown */
          S.targetMesh.visible = false;
        }
        S.targetRingMesh.visible = true;
        if (strike) { S.aimLineMesh.visible = false; S.targetMesh.visible = false; S.targetRingMesh.visible = false; }
                /* Cue charging = rigid recede, not stretch: the stick keeps its constant rest
           length (CUE_STICK_LEN) and translates backward along -dir as power rises — the
           tip leaves ball contact and the whole cue moves away from the ball. Max back-
           pull is capped by _cueMaxOnScreenOff so the butt end is always fully visible,
           in every aim orientation (never clipped at the frame border). */
        var SL = C.CUE_STICK_LEN;
         var rec = 0;
         if (strike) {
           /* Ease-in quadratic: accelerates into contact so the tip reaches rec=0 on the final frame. */
           var f = (strike.total - strike.left) / (strike.total - 1);
           if (f < 0) f = 0;
           if (f > 1) f = 1;
           rec = strike.rec0 * (1 - f * f);
         } else if (power > 0) {
          var vw = S.renderer.domElement.width, vh = S.renderer.domElement.height;
          var maxOff = S.coords._cueMaxOnScreenOff(dx, dy, cue.x, cue.y, C.BR + SL, vw, vh);
           var recMax = Math.max(0, maxOff - (C.BR + SL));
           /* Cap back-pull at half a stick length so the tip stays between the ball and
              the pointer; the on-screen cap (recMax) still prevents frame clipping. */
           rec = power * Math.min(recMax, C.CUE_MAX_RECED);
        }
        /* Lean-back cue: rigid stick, group origin at the tip. The tip sits BR plus the
           power-driven back-pull "rec" from the ball on -dir; the butt end is exactly
           SL behind it and lifted so it reads as a held stroke. Changing aim rotates
           the cue about the tip; changing power translates it backward without altering
           its length. Split 80/20 into a light shaft and a darker ebony butt. */
         var tp = S.coords.l2w(cue.x - dx * (C.BR + rec), cue.y - dy * (C.BR + rec), S.REST_Y);
        var buttOff = C.BR + rec + SL;
        var bEnd = new THREE.Vector3(
          S.coords.l2w(cue.x - dx * buttOff, cue.y - dy * buttOff, S.REST_Y).x,
          S.REST_Y + buttOff * 0.14,
          S.coords.l2w(cue.x - dx * buttOff, cue.y - dy * buttOff, S.REST_Y).z);
       var dirFromTip = new THREE.Vector3().subVectors(bEnd, tp);
       if (dirFromTip.lengthSq() < 1e-6) {
         S.cueGroup.visible = false;
       } else {
         S.cueGroup.visible = true;
         S.cueGroup.position.copy(tp);
          S.cueGroup.quaternion.setFromUnitVectors(S.UP, dirFromTip.normalize());
         var shaftLen = SL * 0.8;
         S.shaftMesh.position.set(0, shaftLen * 0.5, 0);
         S.shaftMesh.quaternion.identity();
         S.shaftMesh.scale.set(C.CUE_SHAFT_W * 0.5, shaftLen, C.CUE_SHAFT_W * 0.5);
         var buttLen = SL - shaftLen;
         S.buttMesh.position.set(0, shaftLen + buttLen * 0.5, 0);
         S.buttMesh.quaternion.identity();
          S.buttMesh.scale.set(C.CUE_SHAFT_W * 0.65, buttLen, C.CUE_SHAFT_W * 0.65);
        }

 
          /* Optional on-screen aim debug: while aiming, log the cursor's screen angle
             vs the cue tip's screen angle (both relative to the projected ball centre),
             plus the rendered aim-line endpoints in logical and screen coordinates and
             the first-contact target. Enable in the browser console with
             Poole.DEBUG_AIM_LOG = true (global object is window.Poole), then aim.
             Off by default; never affects gameplay. */
         if (P.DEBUG_AIM_LOG) {
           var _dbgNow = performance.now();
           if (!P._aimLogT || _dbgNow - P._aimLogT > 120) {
             P._aimLogT = _dbgNow;
             var _r = P.UI.canvas && P.UI.canvas.getBoundingClientRect
                 ? P.UI.canvas.getBoundingClientRect() : null;
             var _cw = _r ? _r.width : (S.renderer.domElement.clientWidth || 1);
             var _ch = _r ? _r.height : (S.renderer.domElement.clientHeight || 1);
             var _bScr = S.coords._ptToCanvas(S.coords.l2w(cue.x, cue.y, S.REST_Y), _cw, _ch);
              var _tScr = S.coords._ptToCanvas(S.coords.l2w(tipX, tipY, S.REST_Y), _cw, _ch);
              /* aim-line endpoints in screen space — compare 1:1 with what you see */
              var _sScr = S.coords._ptToCanvas(S.coords.l2w(cue.x + dx * C.BR, cue.y + dy * C.BR, S.REST_Y), _cw, _ch);
              var _eScr = S.coords._ptToCanvas(S.coords.l2w(gx, gy, S.REST_Y), _cw, _ch);
              var _pcx = P.UI.lastPtr ? P.UI.lastPtr.x - (_r ? _r.left : 0) : 0;
             var _pcy = P.UI.lastPtr ? P.UI.lastPtr.y - (_r ? _r.top : 0) : 0;
             var _curA = Math.atan2(_pcy - _bScr.y, _pcx - _bScr.x);
             var _tipA = Math.atan2(_tScr.y - _bScr.y, _tScr.x - _bScr.x);
             var _diff = (_tipA - _curA + Math.PI) % (Math.PI * 2) - Math.PI;
             var _d = function (x) { return (x * 180 / Math.PI).toFixed(1); };
             console.log('[AIMDBG]', JSON.stringify({
               ballScr: [+_bScr.x.toFixed(1), +_bScr.y.toFixed(1)],
               cursorScr: [+(_pcx).toFixed(1), +(_pcy).toFixed(1)],
               tipScr: [+(_tScr.x.toFixed(1)), +(_tScr.y.toFixed(1))],
               aimLogical: [+(aimX).toFixed(1), +(aimY).toFixed(1)],
                cueLogical: [+(cue.x).toFixed(1), +(cue.y).toFixed(1)],
                lineStartLogical: [+(cue.x + dx * C.BR).toFixed(1), +(cue.y + dy * C.BR).toFixed(1)],
                lineEndLogical: [+(gx).toFixed(1), +(gy).toFixed(1)],
                lineLenUnits: (Math.sqrt((gx - cue.x - dx * C.BR) * (gx - cue.x - dx * C.BR) + (gy - cue.y - dy * C.BR) * (gy - cue.y - dy * C.BR))).toFixed(1),
                fcBall: fc ? String(fc.ball.id) : null,
                lineStartScr: [+(_sScr.x.toFixed(1)), +(_sScr.y.toFixed(1))],
                lineEndScr: [+(_eScr.x.toFixed(1)), +(_eScr.y.toFixed(1))],
                cursorDeg: _d(_curA), tipDeg: _d(_tipA), diffDeg: _d(_diff)
               }));
            }
          }
      } else {
         S.aimLineMesh.visible = false; S.targetMesh.visible = false; S.targetRingMesh.visible = false;
        S.cueGroup.visible = false;
      }

      /* float messages (billboards, rise + fade) */
      for (var f2 = S.floats3d.length - 1; f2 >= 0; f2--) {
        var ft = S.floats3d[f2];
        var t = Math.min(1, (now - ft.t0) / ft.life);
        if (t >= 1) {
          if (ft.sprite.material.map) ft.sprite.material.map.dispose();
          S.scene.remove(ft.sprite);
          S.floats3d.splice(f2, 1);
          continue;
        }
        ft.sprite.position.set(0, S.REST_Y + 20 + t * (C.MSG_RISE || 80), 0);
         ft.sprite.material.opacity = Math.max(0, (1 - t) * 0.95);
        }
      }

       /* game-over centre card (DOM, pointer-events:none so clicks reach the canvas) */
     if (S.goEl) {
       if (state && state.gameOver) {
         S.goEl.style.display = 'flex';
         if (S.goNameEl) S.goNameEl.textContent = (state.winner && state.winner.name) || '?';
       } else {
         S.goEl.style.display = 'none';
       }
     }

      S.renderer.render(S.scene, S.camera);
     /* triage (DEBUG_BG only): proves a frame with the backdrop actually hit the screen. */
     if (S.DEBUG_BG && !S.bgFirstFrame) {
       S.bgFirstFrame = true;
       if (console && console.info) {
         console.info('[BG_DBG] step 2: first frame rendered. If still black, report all [BG_DBG] lines + any Console errors + the exact URL where index.html was opened.');
       }
     }
   };
})();
