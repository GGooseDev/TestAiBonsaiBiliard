/* Table model: bounds, pockets, 16-ball rack layout and the screen transform.
   Exposed via window.Poole.Table. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  P.Table = {
    /* transform state (set by fit()). Defaults so node tests work without a window. */
    size: 1,
    offX: 0,
    offY: 0,
    transformApplied: false, /* set true only by fit(); the browser (GL) path never calls fit() */

    /* Build all 15 object balls in a standard 8-ball triangle:
       apex at the foot (top), 8 in the centre, back corners solid/stripe.
       Returns the array of object-ball objects (cue ball is separate). */
    rack: function () {
      var balls = [];
      var rows = C.RACK_ROWS;
      var midX = (C.IX0 + C.IX1) / 2;
      /* place the apex a few radii below the top rail so the triangle opens toward the breaker */
      var startY = C.IY0 + C.BR * 3;

      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var n = row.length;
        for (var c = 0; c < n; c++) {
          var x = midX + (c - (n - 1) / 2) * C.RACK_GAP_X;
          var y = startY + r * C.RACK_GAP_Y;
          balls.push(P.Ball.create(row[c], x, y));
        }
      }
      return balls;
    },

    /* Which pocket is closest to (x,y)? Returns the pocket index, or -1. */
    pocketIndexFor: function (x, y) {
      var V = P.Vec;
      for (var i = 0; i < C.pockets.length; i++) {
        var p = C.pockets[i];
        if (V.hypot(x - p.x, y - p.y) < C.POCKET_R + C.CATCH_EXTRA) return i;
      }
      return -1;
    },

   /* Transform math shared by fit() and the flat fallback, without touching the
      canvas. The browser (WebGL) path owns the canvas and never calls fit(), so
      this is how the fallback gets a real transform instead of raw pixels. */
   computeTransform: function (winW, winH) {
     var topM = 44, botM = 52;
     var s = Math.min(winW / C.CANVAS_W, (winH - topM - botM) / C.CANVAS_H);
     if (s < 0.2) s = 0.2;
     return {
       size: s,
       offX: (winW - s * C.CANVAS_W) / 2,
       offY: topM + ((winH - topM - botM) - s * C.CANVAS_H) / 2
     };
   },

   /* Resize the canvas to fill the window and compute the logical->screen transform. */
   fit: function (canvas, winW, winH) {
     var t = P.Table.computeTransform(winW, winH);
     P.Table.size = t.size;
     P.Table.offX = t.offX;
     P.Table.offY = t.offY;
     canvas.width = winW;
     canvas.height = winH;
     P.Table.transformApplied = true;
   }
  };
})();
