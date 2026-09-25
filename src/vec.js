/* Vector2 math, exposed via window.Poole.Vec. Loaded after config. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};

  function hypot(x, y) { return Math.sqrt(x * x + y * y); }

  P.Vec = {
    zero: function () { return { x: 0, y: 0 }; },
    copy: function (v) { return { x: v.x, y: v.y }; },
    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
    scale: function (v, s) { return { x: v.x * s, y: v.y * s }; },
    dot: function (a, b) { return a.x * b.x + a.y * b.y; },
    hypot: hypot,
    dist: function (a, b) { return hypot(a.x - b.x, a.y - b.y); },
    normalize: function (v) {
      var d = hypot(v.x, v.y);
      if (d < 1e-9) return { x: 0, y: 0 };
      return { x: v.x / d, y: v.y / d };
    },
    perp: function (v) { return { x: -v.y, y: v.x }; }
  };
})();
