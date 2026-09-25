/* Render: draws the full-window bokeh, the table, balls, aim + cue stick,
   floating text messages and the game-over overlay. Pure drawing - reads the
   shared P.State / P.UI / P.Table and NEVER mutates game logic. Transcribed from
   the original "Poole" monolith so every visual (bokeh, shake, glow, wooden
   stick, floating text) is preserved. Exposed via window.Poole.Render. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  function nowMs() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  /* ------------------------------------------------------------------ */
  /* Full-window ambient bokeh (the signature glowing background).        */
  /* ------------------------------------------------------------------ */
  function drawBgFull(ctx) {
    var cv = P.UI.canvas;
    var w = cv ? cv.width : W.innerWidth;
    var h = cv ? cv.height : W.innerHeight;
    var now = nowMs() * 0.001;

    ctx.fillStyle = "#0b0e12";
    ctx.fillRect(0, 0, w, h);

    for (var i = 0; i < C.BOKEH_COUNT; i++) {
      var s = i * 0.939693;                                      /* deterministic offset */
      var x = w * 0.5 + Math.sin(now * (0.10 + i * 0.018) + s) * (w * 0.48);
      var y = h * 0.5 + Math.cos(now * (0.08 + i * 0.015) + s * 2.1) * (h * 0.48);
      var r = C.BOKEH_MIN_R + C.BOKEH_VAR_R * (0.5 + 0.5 * Math.sin(now * (0.28 + i * 0.05) + s * 5.7));
      var hue = (now * 16 + i * 38) % 360;

      var g = ctx.createRadialGradient(x, y, r * 0.18, x, y, r);
      g.addColorStop(0, "hsla(" + hue + ", 75%, 62%, " + C.BOKEH_CORE_ALPHA + ")");
      g.addColorStop(0.65, "hsla(" + hue + ", 72%, 50%, " + C.BOKEH_MID_ALPHA + ")");
      g.addColorStop(1, "hsla(" + hue + ", 75%, 45%, 0)");

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Screen shake (a few px), for the remaining shake window.             */
  /* ------------------------------------------------------------------ */
  function drawShake(ctx) {
    var st = P.State ? P.State() : null;
    if (!st || st.shakeUntil == null) return;
    var t = (st.shakeUntil - nowMs()) / C.SHAKE_MS;
    if (t <= 0) return;
    ctx.translate(Math.sin(t * 30) * 4 * t, Math.cos(t * 26) * 4 * t);
  }

  /* ------------------------------------------------------------------ */
  /* Table (felt + wood border + grain + pockets), in LOGICAL coords.     */
  /* ------------------------------------------------------------------ */
  function drawTable(ctx) {
    var feltTop = C.IY0, feltBot = C.IY1;
    var g = ctx.createLinearGradient(0, feltTop, 0, feltBot);
    g.addColorStop(0, "#0e6b3c");
    g.addColorStop(0.5, "#147a4a");
    g.addColorStop(1, "#0f6d3d");
    ctx.fillStyle = g;
    ctx.fillRect(C.IX0, feltTop, C.IX1 - C.IX0, feltBot - feltTop);

    /* dark wood frame around the felt */
    ctx.strokeStyle = "rgba(46, 22, 8, 0.9)";
    ctx.lineWidth = 34;
    ctx.strokeRect(C.IX0 + 17, feltTop + 17, (C.IX1 - C.IX0) - 34, (feltBot - feltTop) - 34);

    /* thin light edge highlight */
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(C.IX0 + 1, feltTop + 1, (C.IX1 - C.IX0) - 2, (feltBot - feltTop) - 2);

    /* faint vertical wood-grain lines */
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    for (var x = C.IX0; x < C.IX1; x += 42) {
      ctx.beginPath();
      ctx.moveTo(x, feltTop);
      ctx.lineTo(x, feltBot);
      ctx.stroke();
    }

    for (var k = 0; k < C.pockets.length; k++) drawPocket(ctx, k);
  }

  function drawPocket(ctx, k) {
    var p = C.pockets[k];
    var g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, C.POCKET_R);
    g.addColorStop(0, "#020704");
    g.addColorStop(0.6, "#11190f");
    g.addColorStop(1, "#2a1d0e");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, C.POCKET_R, 0, Math.PI * 2);
    ctx.fill();

    /* dark rim so the pocket reads as a hole */
    ctx.strokeStyle = "#050704";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ */
  /* One ball (LOGICAL coords).                                           */
  /* ------------------------------------------------------------------ */
  function drawBall(ctx, b) {
    if (b.inPocket) return;
    var cx = b.x, cy = b.y, r = C.BR;

    /* soft drop shadow */
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.arc(cx + 2, cy + 3, r, 0, Math.PI * 2);
    ctx.fill();

    /* glossy body (monolith look: colour->colour->dark edge) */
    var g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    if (b.id === "cue") {
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#e8e6e0");
    } else {
      g.addColorStop(0, b.color);
      g.addColorStop(0.5, b.color);
      g.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    /* a subtle white band marks the stripes (9-15) so the two groups read clearly */
    if (typeof b.id === "number" && b.id >= 9 && b.id <= 15) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
      ctx.fillRect(cx - r, cy - r * 0.3, r * 2, r * 0.6);
      ctx.restore();
    }

    /* number / cue-ball dots */
    if (typeof b.id === "number") {
      ctx.fillStyle = (b.id === 8 ? "#ddd" : "#fff");
      ctx.font = "bold " + Math.round(r * 0.9) + "px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(b.id, cx + r * 0.12, cy + r * 0.15);
    } else {
      ctx.fillStyle = "#777";
      var dots = [[cx - r * 0.45, cy - r * 0.3], [cx + r * 0.35, cy + r * 0.45], [cx + r * 0.1, cy - r * 0.5]];
      for (var i = 0; i < dots.length; i++) {
        ctx.beginPath();
        ctx.arc(dots[i][0], dots[i][1], 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Aim overlay + wooden cue stick (LOGICAL coords).                     */
  /* Reversed aim: shot flies AWAY from the pointer (monolith behaviour). */
  /* ------------------------------------------------------------------ */
  function findAimPath(cue, ax, ay, balls) {
    var dx = ax - cue.x, dy = ay - cue.y;
    var dist = P.Vec.hypot(dx, dy);
    if (dist < 1e-6) return null;
    dx /= dist;
    dy /= dist;

    var bestT = Infinity, hitBall = null;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.inPocket || b.id === "cue") continue;
      var t = (b.x - cue.x) * dx + (b.y - cue.y) * dy;       /* param along ray to ball centre */
      if (t <= 10) continue;                                 /* skip anything behind/below near */
      var cx = cue.x + dx * t, cy = cue.y + dy * t;          /* point on ray closest to ball */
      var cd2 = (cx - b.x) * (cx - b.x) + (cy - b.y) * (cy - b.y);
      var d2min = C.BR * 2 + C.BR * 0.05;                    /* first-contact condition */
      if (cd2 < d2min && t < bestT) { bestT = t; hitBall = b; }
    }
    return hitBall ? { ball: hitBall, dirX: dx, dirY: dy } : null;
  }

  /* Shared drawing: trajectory + target ring + wooden cue stick, given a point
     (px,py) the cue "points from". Both the human (pointer drag) and the bot
     (planned shot) funnel into this via the same reversed-aim math; `power`
     drives the shaft length and ghost length. */
  function drawAimOverlay(ctx, st, cue, px, py, power) {
    var dx = px - cue.x, dy = py - cue.y;                  /* vector from cue to pointer side */
    var dist = P.Vec.hypot(dx, dy);
    if (dist < 5) return;

    /* reversed aim: real shot direction = AWAY from the pointer side */
    var aimDirX = -(dx / dist), aimDirY = -(dy / dist);

    ctx.save();
    var ghostLen = 80 + power * 300;                      /* logical units along shot dir */

    /* soft halo + dashed core trajectory, along the REAL shot direction */
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(90, 215, 255, 0.16)";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(cue.x + aimDirX * ghostLen, cue.y + aimDirY * ghostLen);
    ctx.stroke();

    ctx.strokeStyle = "rgba(150, 235, 255, " + (0.65 + power * 0.35) + ")";
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 8]);
    ctx.beginPath();
    ctx.moveTo(cue.x, cue.y);
    ctx.lineTo(cue.x + aimDirX * ghostLen, cue.y + aimDirY * ghostLen);
    ctx.stroke();
    ctx.setLineDash([]);

    /* target ring on the predicted contact ball */
    var path = findAimPath(cue, cue.x + aimDirX * 1000, cue.y + aimDirY * 1000, st.balls);
    if (path && path.ball) {
      ctx.strokeStyle = "rgba(255, 240, 150, 0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(path.ball.x, path.ball.y, C.TARGET_RING_R, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* wooden cue stick: tip on the pointer side, shaft straight back behind it */
    var shaftLen = C.CUE_MIN_SHAFT + power * C.CUE_MAX_EXTEND;
    var tipX = cue.x - aimDirX * C.BR, tipY = cue.y - aimDirY * C.BR;
    var buttX = cue.x - aimDirX * (C.BR + shaftLen), buttY = cue.y - aimDirY * (C.BR + shaftLen);

    ctx.lineCap = "butt";
    var shaftG = ctx.createLinearGradient(tipX, tipY, buttX, buttY);
    shaftG.addColorStop(0.0, "#c99a5e");
    shaftG.addColorStop(0.28, "#8a5a2e");
    shaftG.addColorStop(1.0, "#7a4a1f");
    ctx.strokeStyle = shaftG;
    ctx.lineWidth = C.CUE_SHAFT_W;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(buttX, buttY);
    ctx.stroke();

    /* dark ferrule accent near the ball */
    var fx2 = tipX + (buttX - tipX) * 0.07, fy2 = tipY + (buttY - tipY) * 0.07;
    ctx.strokeStyle = "#3a2a14";
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(fx2, fy2);
    ctx.stroke();
    ctx.restore();
  }

  /* Human aiming (pointer drag). */
  function drawAim(ctx) {
    if (!P.UI || !P.UI.shootable || !P.UI.aiming) return;
    var st = P.State ? P.State() : null;
    var cue = st && st.cue;
    if (!cue) return;
    drawAimOverlay(ctx, st, cue, P.UI.aimX, P.UI.aimY, P.UI.power || 0);
  }

  /* Bot aim preview, visible across its whole think window. Always rendered from
     the cue's live position, so both human and bot continue shooting from where
     the white ball actually sits (it only moves to a fixed spot on a scratch foul). */
  function drawAimBot(ctx) {
    if (!P.UI || !P.UI.botAiming) return;
    var st = P.State ? P.State() : null;
    var cue = st && st.cue;
    if (!cue) return;
    drawAimOverlay(ctx, st, cue, P.UI.botAimX, P.UI.botAimY, P.UI.botPower || 0.7);
  }

  /* ------------------------------------------------------------------ */
  /* Rising float text messages (LOGICAL coords), monolith curve.         */
  /* ------------------------------------------------------------------ */
  function drawFloatMessages(ctx) {
    var msgs = P.State ? (P.State().floatMessages || []) : null;
    if (!msgs || !msgs.length) return;
    var now = nowMs();
    for (var i = msgs.length - 1; i >= 0; i--) {
      var m = msgs[i];
      var elapsed = now - m.born;
      if (elapsed >= C.FLASH_MS) { msgs.splice(i, 1); continue; }
      var frac = elapsed / C.FLASH_MS;
      var alpha = frac < 0.15 ? frac / 0.15 : frac < 0.7 ? 1 : (1 - frac) / 0.3;

      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(C.BR * 2) + "px Arial, sans-serif";
      ctx.fillStyle = "rgba(" + m.rgb + "," + alpha.toFixed(3) + ")";
      ctx.shadowColor = "rgb(" + m.rgb + ")";
      ctx.shadowBlur = 16;
      ctx.fillText(m.text, m.x, m.y - frac * C.MSG_RISE);
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Full-screen game-over overlay (SCREEN coords).                       */
  /* ------------------------------------------------------------------ */
  function drawGameOver(ctx) {
    var cv = P.UI.canvas;
    var w = cv ? cv.width : W.innerWidth;
    var h = cv ? cv.height : W.innerHeight;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, w, h);

    var winName = (P.State().winner ? P.State().winner.name : "?");
    var minDim = Math.min(w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "bold " + Math.round(minDim * 0.07) + "px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Game over - " + winName + " wins!", w / 2, h / 2 - minDim * 0.03);
    ctx.font = "bold " + Math.round(minDim * 0.04) + "px Arial, sans-serif";
    ctx.fillText("Click the table to play again", w / 2, h / 2 + minDim * 0.06);
  }

  P.Render = {
    /* Emit a rising text float; rgb is an "R,G,B" string. Position defaults to the
       upper-centre of the felt (logical coords, drawn inside the table scale). */
    showFloatMsg: function (text, rgb) {
      if (!P.State) return;
      var st = P.State();
      if (!st || !Array.isArray(st.floatMessages)) {
        /* State was reset or never seeded; silently ignore in a non-game context. */
        return;
      }
      st.floatMessages.push({
        x: (C.IX0 + C.IX1) / 2,
        y: C.IY0 + (C.IY1 - C.IY0) * 0.34,
        text: text,
        rgb: rgb,
        born: nowMs()
      });
    },

    draw: function (ctx) {
      var st = P.State ? P.State() : null;
      if (!P.UI || !P.UI.canvas) return;
      var w = P.UI.canvas.width, h = P.UI.canvas.height;

      /* base fill (unshaken) so nothing shows through */
      ctx.fillStyle = "#0b0e12";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      if (st) {
        drawShake(ctx);          /* screen-space translate, a few px */
      }
      drawBgFull(ctx);           /* full-window bokeh */
      if (st) {
        ctx.save();
        ctx.translate(P.Table.offX, P.Table.offY);   /* logical -> screen */
        ctx.scale(P.Table.size, P.Table.size);

        drawTable(ctx);
        var balls = st.balls;
        for (var i = 0; i < balls.length; i++) drawBall(ctx, balls[i]);
        drawAim(ctx);
        drawAimBot(ctx);
        drawFloatMessages(ctx);
        ctx.restore();
      }
      ctx.restore();

      if (st && st.gameOver) drawGameOver(ctx);
    }
  };
})();
