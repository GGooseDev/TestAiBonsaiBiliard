/* Node smoke test for the bot shot planner. Run: node test-bot.js */
globalThis.window = globalThis.window || {};
const path = require("path");
["config","vec","ball","table","physics","player","rules","bot"]
  .map(function (n) { return path.join(__dirname, "src", n + ".js"); })
  .forEach(function (p) { require(p); });

var P = window.Poole;
var C = P.CONFIG;
function A(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
function fin(v) { return typeof v === "number" && !isNaN(v); }

function makeCue(x, y) { return P.Ball.create("cue", x, y); }

/* Open table: cue bottom-centre, one legal ball high up near a pocket, nothing in the way. */
(function () {
  var balls = [P.Ball.create(1, 320, 90)];
  balls.push(P.Ball.create("cue", 500, 480));
  P.Physics.setBalls(balls, balls[balls.length - 1]);
  var shot = P.Bot.bestShot(balls, balls[balls.length - 1], [1]);
  A(shot && fin(shot.vx) && fin(shot.vy), "bot returns a shot with finite vx/vy");
  A(fin(shot.power) && shot.power >= 0.4 && shot.power <= 1.0, "power in range (" + shot.power + ")");
  A(shot.targetId === 1, "target is the legal ball (" + shot.targetId + ")");
  A(shot.pocketIdx !== -1, "bot found a clear pocketed shot (pocketIdx=" + shot.pocketIdx + ")");
  A(P.Vec.hypot(shot.vx, shot.vy) > 0, "shot has non-zero speed");
  console.log("B1 open clear shot OK: speed=" + P.Vec.hypot(shot.vx, shot.vy).toFixed(0),
    "power=" + shot.power.toFixed(3), "pocket=" + shot.pocketIdx);
})();

/* Fallback: a wall of balls blocks every path to the target -> no clean pocket,
   bot falls back to a safe (un-potted) knock with pocketIdx === -1. */
(function () {
  var balls = [P.Ball.create(3, 500, 90)];                 /* legal target high up */
  for (var x of [340, 420, 460, 500, 540]) balls.push(P.Ball.create("x" + x, x, 250)); /* wall */
  var cue = P.Ball.create("cue", 500, 480);
  balls.push(cue);
  P.Physics.setBalls(balls, cue);
  var shot = P.Bot.bestShot(balls, cue, [3]);
  A(shot && fin(shot.vx) && fin(shot.vy), "bot returns a fallback shot with finite vx/vy");
  A(shot.pocketIdx === -1, "blocked path -> fallback (pocketIdx=" + shot.pocketIdx + ")");
  A(shot.targetId === 3, "fallback targets the legal ball (" + shot.targetId + ")");
  console.log("B2 blocked->fallback OK: speed=" + P.Vec.hypot(shot.vx, shot.vy).toFixed(0), "power=" + shot.power.toFixed(3));
})();

/* No legal balls -> bestShot returns null. */
(function () {
  var cue = P.Ball.create("cue", 500, 480);
  var balls = [P.Ball.create(5, 320, 90), cue];
  P.Physics.setBalls(balls, cue);
  var shot = P.Bot.bestShot(balls, cue, []);   /* empty candidate list */
  A(shot === null, "empty candidate list -> null");
  console.log("B3 no legal balls -> null OK");
})();

console.log("ALL bot tests PASSED");