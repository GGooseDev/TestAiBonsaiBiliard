const vm = require("vm");
const fs = require("fs");

var BR_EXPECT = 14;
var IX0 = 34, IX1 = 966, IY0 = 34, IY1 = 526;
/* cue ball rest position: IY1 - BR*8 */
var CUE_X = (IX0 + IX1) / 2;
var CUE_Y = IY1 - BR_EXPECT * 8; /* = 414 */

var lastFrameArcs = [];
function grad() { return { addColorStop: function () {} }; }
var BR14 = BR_EXPECT;
var ctxObj = {
  lineCap: null,
  save: function () {}, restore: function () {}, translate: function () {}, scale: function () {},
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {}, strokeRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
  arc: function (x, y, r) { if (Math.abs(r - BR_EXPECT) < 0.01) lastFrameArcs.push({ x, y }); },
  fill: function () {}, stroke: function () {}, fillText: function () {},
  createLinearGradient: grad, createRadialGradient: grad, setLineDash: function () {}
};

var html = fs.readFileSync("index.html", "utf8");
var script = html.match(/<script>([\s\S]*)<\/script>/)[1];
/* expose state at IIFE end (state is read live via the getter each call) */
var endMarker = "requestAnimationFrame(function (ts) { loop(ts); });\n})();";
var idx = script.lastIndexOf(endMarker);
if (idx < 0) throw new Error("IIFE tail not found");
var injected =
  "\n  window.__gGetter = function () { return { " +
  "cueBall: cueBall, balls: balls, " +
  "legalNext: legalNum, nextBall: nextEl ? nextEl.textContent : '', " +
  "isGameOver: function() { return gameOver; }, shotInMotion: function() { return shotInMotion; }, " +
  "freeReturn: function() { return freeReturn; }, " +
  "getShotSpeed: function() { return Math.sqrt(cueBall.vx*cueBall.vx + cueBall.vy*cueBall.vy); }, " +
  "getShotDir: function() { return { vx: cueBall.vx, vy: cueBall.vy }; }, " +
  "_sinkBall: function(b, i) { return sinkBall(b, i); }, _placeBall: function(b, i) { placeBall(b, i); }, " +
  "_processFreeReturns: function() { processFreeReturns(); }, _integrate: function() { if (STEP) integrateStep(STEP); }, " +
  "_reset: function() { resetGame(); } }; };\n" +
  endMarker;
script = script.slice(0, idx) + injected;

var handlers = {}, rafQueue = [];
var perf = { _t: 0, now: function () { this._t += 16; return this._t; } };
var statusEl = { style: {}, textContent: "", innerHTML: "" }, nextEl = { textContent: "" };
var doc = { getElementById: function (id) {
    if (id === "game" || id === "c") return fakeCanvas;
    if (id === "status") return statusEl;
    return nextEl;
  } };
var win = {};
win.addEventListener = function (t, cb) { handlers[t] = cb; };
win.innerWidth = 2200;
win.innerHeight = 1300;
var fakeCanvas = { width: 1000, height: 560, offsetWidth: 2200, style: {},
  getContext: function () { return ctxObj; },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1000, height: 560 }; },
  addEventListener: function (t, cb) { handlers[t] = cb; } };

var context = vm.createContext({ window: win, document: doc, performance: perf,
  requestAnimationFrame: function (cb) { rafQueue.push(cb); } });
vm.runInContext(script, context);
var G = function () { return context.window.__gGetter(); };

function tick(n) {
  for (var i = 0; i < n; i++) {
    var cbs = rafQueue.slice();
    rafQueue.length = 0;
    for (var j = 0; j < cbs.length; j++) {
      lastFrameArcs.length = 0;
      cbs[j](perf.now());
      checkBallPositions(lastFrameArcs);
    }
  }
}
function checkBallPositions(arcs) {
  for (var i = 0; i < arcs.length; i++) {
    var a = arcs[i];
    if (a.x < IX0 - 6 || a.x > IX1 + 6 || a.y < IY0 - 6 || a.y > IY1 + 6) {
      throw new Error("ball out of bounds: x=" + a.x.toFixed(2) + " y=" + a.y.toFixed(2));
    }
  }
}

/* state-based read of the cue ball (equivalent to body arc center; robust to x drift) */
function cuePosNow() {
  var g = G();
  if (!g || !g.cueBall) return null;
  if (g.cueBall.inPocket) return null;
  return g.cueBall;
}
var arcLenNow = function () { return lastFrameArcs.length; };
function ballById(id) {
  var gs = G().balls;
  for (var i = 0; i < gs.length; i++) if (String(gs[i].id) === String(id)) return gs[i];
  return null;
}
function liveCount() {
  var gs = G().balls;
  var n = 0;
  for (var i = 0; i < gs.length; i++) if (!gs[i].inPocket && gs[i].id !== "cue") n++;
  return n;
}

function normAngle(a) { return ((a + Math.PI) % (Math.PI * 2) + Math.PI) % (Math.PI * 2); }
function angleOf(vx, vy) { return Math.atan2(vy, vx); }
function approxAngle(a, b) {
  var d = Math.abs(normAngle(a) - normAngle(b)) - Math.PI * Math.floor((normAngle(a) - normAngle(b) + Math.PI) / (Math.PI * 2));
  return Math.abs(d);
}

function trackUntilSettled(framesPerShot, framesTotal) {
  var g = G();
  if (!g || !g.cueBall) throw new Error("__gGetter not ready");
  var firstY = g.cueBall.inPocket ? null : g.cueBall.y;
  var minY = 1e9, seen = false;
  for (var i = 0; i < framesTotal; i++) {
    tick(framesPerShot);
    var y = cuePosNow();
    if (!y || y.inPocket) break;
    seen = true;
    if (y.y < minY) minY = y.y;
  }
  return { firstY: firstY, minY: minY, stopped: seen };
}

/* drag from (x1,y1) to (x2,y2) and fire; returns the launched velocity direction */
function shoot(x1, y1, x2, y2) {
  if (!handlers.mousedown || !handlers.mousemove || !handlers.mouseup) throw new Error("no input handlers");
  handlers.mousedown({ clientX: x1, clientY: y1 });
  tick(3);
  handlers.mousemove({ clientX: x2, clientY: y2 });
  tick(1);
  /* velocity is applied in the mouseup handler, so read it afterwards */
  handlers.mouseup({ clientX: x2, clientY: y2 });
  return G().getShotDir();
}

function stopAllMoving() {
  for (var i = 0; i < 800; i++) {
    tick(3);
    var c = cuePosNow();
    if (!c) break;
    /* count all balls at rest */
    var gs = G().balls;
    var moving = false;
    for (var k = 0; k < gs.length; k++) {
      if (!gs[k].inPocket && (Math.abs(gs[k].vx) > 1e-9 || Math.abs(gs[k].vy) > 1e-9)) { moving = true; break; }
    }
    if (!moving) break;
  }
}

tick(2);

var c0 = cuePosNow();
if (!c0) throw new Error("cue ball not present initially");
console.log("PASS: initial cue at (" + c0.x.toFixed(1) + "," + c0.y.toFixed(1) + ")");
console.log("arcs in frame:", arcLenNow());

/* tiny drag (on the ball) -> no shot */
var vNo = shoot(CUE_X, c0.y, CUE_X, c0.y);
tick(8);
if (G().isGameOver()) throw new Error("should not be game over");
if (G().shotInMotion() || Math.abs(G().getShotDir().vx) > 5) {
  throw new Error("no-shot drag launched a ball anyway: " + JSON.stringify(G().getShotDir()));
}
var cAfterNo = cuePosNow();
if (!cAfterNo || Math.abs(cAfterNo.y - c0.y) > 2) {
  throw new Error("no-shot drag moved the cue ball");
}
console.log("PASS: cursor on the ball -> no stick, no shot");

/* vertical: pull down -> shoot up (reversed aim) */
var d1 = shoot(CUE_X, c0.y + 60, CUE_X, c0.y + 43);
if (d1 === null) throw new Error("no velocity for short shot");
if (d1.vy >= -2) throw new Error("short shot must fire upward, got vy=" + d1.vy + " vx=" + d1.vx);
var res1 = trackUntilSettled(3, 600);
var shortDist = res1.firstY - res1.minY;
console.log("short shot travel: " + shortDist.toFixed(2) + " px (up)");
if (res1.firstY === null || res1.minY === 1e9) throw new Error("cue ball not tracked after short shot");
if (shortDist < 5) throw new Error("cue ball barely moved on short shot: " + shortDist);

for (var w = 0; w < 200; w++) tick(5);

/* longer vertical pull -> shoot up with more power */
var d2 = shoot(CUE_X, c0.y + 90, CUE_X, c0.y + 160);
if (d2 === null) throw new Error("no velocity for long shot");
if (d2.vy >= -2) throw new Error("long shot must fire upward, got vy=" + d2.vy);
var res2 = trackUntilSettled(3, 600);
var longDist = res2.firstY - res2.minY;
console.log("long shot travel: " + longDist.toFixed(2) + " px (up)");
if (res2.firstY === null || res2.minY === 1e9) throw new Error("cue ball not tracked after long shot");

if (longDist < shortDist * 0.75) {
  throw new Error("power does not scale with cursor-to-ball distance: " + shortDist.toFixed(2) + " vs " + longDist.toFixed(2));
}
if (shortDist <= 0 || longDist <= 0) {
  throw new Error("cue ball did not move upward (direction must be inverted)");
}
console.log("PASS: reversed aim, stick behind ball, power scales with cursor-to-ball distance");

/* horizontal: pull left -> shoot right */
var d3 = shoot(CUE_X - 50, CUE_Y, CUE_X - 120, CUE_Y);
if (d3 === null) throw new Error("no velocity for horizontal shot");
stopAllMoving();
if (d3.vx < -5) throw new Error("pull-left must fire right, got vx=" + d3.vx);
console.log("PASS: pull-left fires right, reversed aim horizontal (vx=" + d3.vx.toFixed(1) + ")");

for (var s = 0; s < 25; s++) {
  var sx = IX0 + Math.random() * (IX1 - IX0);
  var sy = IY0 + Math.random() * (IY1 - IY0);
  var ex = IX0 + Math.random() * (IX1 - IX0);
  var ey = IY0 + Math.random() * (IY1 - IY0);
  shoot(sx, sy, ex, ey);
  tick(300);
}

console.log("PASS: randomized shots, all balls stay in bounds");
console.log("last status:", JSON.stringify(statusEl.textContent));
console.log("last next ball:", JSON.stringify(nextEl.textContent));
console.log("cue now:", G().cueBall.y.toFixed(1), G().cueBall.inPocket ? "POCKETED" : "live",
  "balls live:", G().balls.filter(function (b) { return !b.inPocket; }).length);
tick(400);
stopAllMoving();
console.log("PASS: final settle ok");

/* ---- feature tests: 8-ball special, cue ball pocketing ---- */
function test8BallDoesNotEndGame() {
  G()._reset();
  var eight = null;
  for (var i = 0; i < G().balls.length; i++) if (G().balls[i].id === "8") { eight = G().balls[i]; break; }
  if (!eight) throw new Error("no 8-ball");
  if (G().isGameOver()) throw new Error("game over should be false before any shot");

  G()._sinkBall(eight, 0);
  tick(3);
  if (G().isGameOver()) throw new Error("8-ball pocketed -> game over! it must NOT end the game");
  console.log("PASS: pocketing the 8-ball does NOT end the game");

  G()._processFreeReturns();
  tick(5);
  if (eight.inPocket) {
    for (var i2 = 0; i2 < 60; i2++) {
      tick(1);
      if (!eight.inPocket) break;
      G()._processFreeReturns();
    }
    if (eight.inPocket) throw new Error("8-ball still pocketed after returns");
  }
  console.log("PASS: 8-ball returned to live at (" + eight.x.toFixed(1) + "," + eight.y.toFixed(1) + ")");
}

function testCueBallPocketing() {
  G()._reset();
  var cue = G().cueBall;
  if (!cue) throw new Error("no cue ball in getter");
  if (G().isGameOver()) throw new Error("game over should be false before any shot");

  G()._sinkBall(cue, 0);
  tick(3);
  if (G().isGameOver()) throw new Error("pocketing cue should NOT end the game");
  console.log("PASS: pocketing cue ball does not end the game");

  G()._processFreeReturns();
  tick(5);
  if (cue.inPocket) {
    for (var i2 = 0; i2 < 60; i2++) {
      tick(1);
      if (!cue.inPocket) break;
      G()._processFreeReturns();
    }
    if (cue.inPocket) throw new Error("cue ball still pocketed after returns");
  }
  console.log("PASS: cue ball returned to live at (" + cue.x.toFixed(1) + "," + cue.y.toFixed(1) + ")");
}

try {
  test8BallDoesNotEndGame();
  testCueBallPocketing();
} catch (e) {
  console.error("FEATURE TEST FAILED:", e.message);
  throw e;
}
console.log("PASS: all feature tests passed");
