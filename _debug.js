const vm = require("vm");
const fs = require("fs");

var html = fs.readFileSync("index.html", "utf8");
var script = html.match(/<script>([\s\S]*)<\/script>/)[1];
/* expose internals for debugging (temp) */
script = script.replace(
  /requestAnimationFrame\(loop\);/,
  "requestAnimationFrame(loop);\n" +
  "window.__g = { balls: balls, cueBall: cueBall, shotInMotion: shotInMotion, freeReturn: freeReturn, legalNum: legalNum };"
);

var handlers = {}, rafQueue = [], perf = { _t: 0, now: function () { this._t += 16; return this._t; } };
var ctxObj = {
  save: function () {}, restore: function () {}, translate: function () {}, scale: function () {}, rotate: function () {},
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {}, strokeRect: function () {}, setLineDash: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, arc: function () {},
  fill: function () {}, stroke: function () {}, fillText: function () {},
  createLinearGradient: function () { return { addColorStop: function () {} }; },
  createRadialGradient: function () { return { addColorStop: function () {} }; }
};
var doc = { getElementById: function (id) { return id === "c" ? fakeCanvas : (id === "status" ? statusEl : nextEl); } };
var win = { addEventListener: function (type, cb) { handlers[type] = cb; }, innerWidth: 2200, innerHeight: 1300 };
var fakeCanvas = { width: 1000, height: 560, style: {}, getContext: function () { return ctxObj; },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1000, height: 560 }; },
  addEventListener: function (type, cb) { handlers[type] = cb; } };
var statusEl = { style: {}, textContent: "", innerHTML: "" }, nextEl = {};

var context = vm.createContext({ window: win, document: doc, performance: perf, requestAnimationFrame: function (cb) { rafQueue.push(cb); } });
vm.runInContext(script, context);

function getG() { return context.window.__g; }

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
function dump(label) {
  var g = getG();
  if (!g || !g.balls) throw new Error("__g not ready yet");
  var lines = g.balls.map(function (b) {
    var v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    return b.id + " @(" + b.x.toFixed(1) + "," + b.y.toFixed(1) + ") " + (b.inPocket ? "POCKETED" : "live") + (v > 0.001 ? " v=" + v.toFixed(2) : "");
  });
  console.log(label, "| cue.inPocket:", g.cueBall.inPocket, "| shotInMotion:", g.shotInMotion, "| legalNum:", g.legalNum, "| freeReturn:", g.freeReturn);
  lines.forEach(function (l) { console.log("  " + l); });
}

tick(2);
dump("start");
shoot(500, 463, 500, 446);
tick(15);
for (var w = 0; w < 200; w++) tick(5);
dump("after short shot settled");
shoot(500, 493, 500, 563);
tick(1);
dump("right after long shot mousedown->mousemove frame");
