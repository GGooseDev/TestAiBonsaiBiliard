/* Physics: fixed-step integration + per-shot bookkeeping (firstContact, cuePocketed,
   pocketedThisShot). Exposed via window.Poole.Physics. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;
  var T = P.Table;

  P.Physics = {
    balls: [],          /* all balls incl. cue */
    cueBall: null,
    firstContact: false,   /* cue struck any object ball this shot? */
    cuePocketed: false,    /* cue went in on this shot? */
    pocketedThisShot: []   /* { id } for object balls pocketed this shot */

  ,
    /* Reset bookkeeping before each shot. */
    resetShot: function () {
      this.firstContact = false;
      this.cuePocketed = false;
      this.pocketedThisShot = [];
    },

    /* Set the working set for a game loop. */
    setBalls: function (balls, cueBall) {
      this.balls = balls;
      this.cueBall = cueBall;
    },

    /* True while any non-pocketed ball has velocity above a hair. */
    anyMoving: function () {
      var eps = 1e-9;
      for (var i = 0; i < this.balls.length; i++) {
        var b = this.balls[i];
        if (!b.inPocket && (Math.abs(b.vx) > eps || Math.abs(b.vy) > eps)) return true;
      }
      return false;
    },

    /* One fixed step of the sim: integrate, pockets, rails, freeze, ball-ball passes. */
    integrateStep: function (dt) {
      var balls = this.balls;

      for (var i = 0; i < balls.length; i++) {
        var b = balls[i];
        if (b.inPocket) continue;

        b.x += b.vx * dt;
        b.y += b.vy * dt;

        var fric = Math.exp(-C.FRICTION * dt);
        b.vx *= fric;
        b.vy *= fric;

        /* pocket capture */
        var pi = T.pocketIndexFor(b.x, b.y);
        if (pi >= 0) { this.sink(b, pi); continue; }

        /* rail collision: only on real penetration while heading into the rail */
        if (b.x < C.IX0 + C.BR && b.vx < 0) {
          b.x = C.IX0 + C.BR; b.vx *= -C.CUSHION_E; b.vy *= C.TANGENT_KEEP;
        }
        if (b.x > C.IX1 - C.BR && b.vx > 0) {
          b.x = C.IX1 - C.BR; b.vx *= -C.CUSHION_E; b.vy *= C.TANGENT_KEEP;
        }
        if (b.y < C.IY0 + C.BR && b.vy < 0) {
          b.y = C.IY0 + C.BR; b.vy *= -C.CUSHION_E; b.vx *= C.TANGENT_KEEP;
        }
        if (b.y > C.IY1 - C.BR && b.vy > 0) {
          b.y = C.IY1 - C.BR; b.vy *= -C.CUSHION_E; b.vx *= C.TANGENT_KEEP;
        }

        if (Math.abs(b.vx) < C.STOP_SPEED && Math.abs(b.vy) < C.STOP_SPEED) {
          b.vx = 0; b.vy = 0;
        }
      }

      /* ball-ball contacts over several passes so tight groups separate cleanly */
      for (var pass = 0; pass < C.COLLIDE_PASSES; pass++) {
        var changed = false;
        for (var a = 0; a < balls.length; a++) {
          var A = balls[a];
          if (A.inPocket) continue;
          for (var c = a + 1; c < balls.length; c++) {
            var B = balls[c];
            if (B.inPocket) continue;
            var dx = B.x - A.x, dy = B.y - A.y;
            var d = P.Vec.hypot(dx, dy);
            if (d >= C.BR * 2) continue;
            changed = true;

            /* cue touching an object ball marks the first contact (miss-foul check) */
            if ((A === this.cueBall || B === this.cueBall)) this.firstContact = true;

            if (d < 1e-9) { dx = 0.01; dy = 0; d = P.Vec.hypot(dx, dy); }
            var nx = dx / d, ny = dy / d;
            var push = C.BR * 2 - d;
            A.x -= nx * (push / 2); A.y -= ny * (push / 2);
            B.x += nx * (push / 2); B.y += ny * (push / 2);

            var rv = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
            if (rv > 0) {
              var k = rv * (1 + C.BALL_RESTITUTION);
              A.vx -= nx * k; A.vy -= ny * k;
              B.vx += nx * k; B.vy += ny * k;
            }
          }
        }
        if (!changed) break;
      }
    },

    /* Move a ball to its pocket and record it for rules. */
    sink: function (b, idx) {
      b.inPocket = true;
      if (P.Ball.isCue(b.id)) {
        this.cuePocketed = true;
      } else {
        this.pocketedThisShot.push({ id: b.id });
      }
    },

    /* Place a pocketed ball back in play at (x,y) and nudge it clear of others. */
    respot: function (b, x, y) {
      var B = C.BR;
      b.inPocket = false;
      b.x = x; b.y = y; b.vx = 0; b.vy = 0;
      for (var n = 0; n < 60; n++) {
        var coll = false;
        for (var i = 0; i < this.balls.length; i++) {
          var o = this.balls[i];
          if (o === b || o.inPocket) continue;
          var d = P.Vec.hypot(o.x - b.x, o.y - b.y);
          if (d < B * 2) {
            coll = true;
            var nx = (b.x - o.x) / Math.max(1e-9, d);
            var ny = (b.y - o.y) / Math.max(1e-9, d);
            b.x += nx * 2; b.y += ny * 2;
          }
        }
        if (!coll) break;
      }
    }
  };
})();
