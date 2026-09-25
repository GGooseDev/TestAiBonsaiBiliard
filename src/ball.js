/* Ball model + group/type helpers, exposed via window.Poole.Ball. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  P.Ball = {
    /* Create an object ball or the cue ball (id === "cue"). */
    create: function (id, x, y) {
      return { id: id, x: x, y: y, vx: 0, vy: 0, inPocket: false, color: C.COLORS[id] || "#f0f0f0" };
    },

    /* Is the id a numeric object ball 1..15? (cue is "cue") */
    isObject: function (id) {
      return typeof id === "number" && id >= 1 && id <= 15;
    },

    /* Standard group of this ball. Returns "SOLID", "STRIPE" or null (8/cue). */
    group: function (id) {
      if (typeof id !== "number") return null;
      if (id >= 1 && id <= 7) return "SOLID";
      if (id >= 9 && id <= 15) return "STRIPE";
      return null;
    },

    /* The group a player owns (SOLID|STRIPE). Same-group balls are legal. */
    isGroupBall: function (ball, playerGroup) {
      if (!playerGroup) return false;
      var g = P.Ball.group(ball.id);
      return g === playerGroup;
    },

    /* Is this the black 8? */
    isBlack: function (id) {
      return id === 8;
    },
    isCue: function (id) {
      return id === "cue";
    }
  };
})();
