const vm = require("vm");
const fs = require("fs");

var script = fs.readFileSync("index.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
/* synchronously expose game state just before IIFE exits (after resetGame) */
var endMarker = "requestAnimationFrame(loop);\n})();";
var idx = script.lastIndexOf(endMarker);
if (idx < 0) throw new Error("IIFE tail not found");
var injected =
  script.slice(0, idx) +
  "window.__gGetter = function () { return { cueBall: cueBall, legalNum: legalNum }; };\n" +
  endMarker;

var handlers = {}, rafQueue = [];
var perf = { _t: 0, now: function () { this._t += 16; return this._t; } };
function grad() { return { addColorStop: function () {} }; }
var BR_EXPECT = 14;
var lastFrameArcs = [];
var lastRotate = null;
var ctxObj = {
  lineCap: null,
  save: function () {}, restore: function () {}, translate: function () {}, scale: function () {},
  rotate: function (a) { lastRotate = a; },
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {}, strokeRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
  arc: function (x, y, r) { if (Math.abs(r - BR_EXPECT) < 0.01) lastFrameArcs.push({ x, y }); },
  fill: function () {}, stroke: function () {}, fillText: function () {},
  createLinearGradient: grad, createRadialGradient: grad, setLineDash: function () {}
};
var statusEl = { style: {}, textContent: "", innerHTML: "" }, nextEl = {};
var doc = { getElementById: function (id) { return id === "c" ? fakeCanvas : (id === "status" ? statusEl : nextEl); } };
var win = {};
win.addEventListener = function (t, cb) { handlers[t] = cb; };
win.innerWidth = 2200;
win.innerHeight = 1300;
var fakeCanvas = { width: 1000, height: 560, style: {},
  getContext: function () { return ctxObj; },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1000, height: 560 }; },
  addEventListener: function (t, cb) { handlers[t] = cb; } };

var context = vm.createContext({ window: win, document: doc, performance: perf,
  requestAnimationFrame: function (cb) { rafQueue.push(cb); } });
vm.runInContext(injected, context);
var G = function () { return context.window.__gGetter ? context.window.__gGetter() : null; };

function tick(n) {
  for (var i = 0; i < n; i++) {
    var cbs = rafQueue.slice();
    rafQueue.length = 0;
    cbs.forEach(function (cb) { cb(perf.now()); });
  }
}
function shoot(x1, y1, x2, y2) {
  handlers.mousedown({ clientX: x1, clientY: y1 });
  tick(3);
  handlers.mousemove({ clientX: x2, clientY: y2 });
  tick(1);
  handlers.mouseup({ clientX: x2, clientY: y2 });
}
function sampleCue() {
  var g = G();
  if (!g) return null;
  var c = g.cueBall;
  var v = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
  return c.y + " x=" + (c.x - 500).toFixed(3) + " vy=" + c.vy.toFixed(1) + " inPocket=" + c.inPocket + " legal=" + g.legalNum;
}

function trackWithTrace(framesPerShot, framesTotal) {
  var g = G();
  if (!g) return null;
  var firstY = null, minY = 1e9, nullAt = -1, lastLine = "";
  var cue = g.cueBall;
  firstY = cue.y;
  for (var i = 0; i < framesTotal; i++) {
    tick(framesPerShot);
    var c = G().cueBall;
    if (c.inPocket) { if (nullAt < 0) nullAt = i; lastLine = "inPocket@" + i; break; }
    var y = c.y;
    if (y < minY) minY = y;
    if (i % 24 === 0 || i > 300) { console.log("frame " + i + ":" + sampleCue()); }
  }
  return { firstY: firstY, minY: minY, nullAt: nullAt };
}

tick(2);
console.log("init:", sampleCue());
shoot(500, 463, 500, 446);
for (var w = 0; w < 300; w++) tick(5);
console.log("after settle:"); trackWithTrace(3, 600);
