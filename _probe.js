var fs = require("fs"), vm = require("vm");
var script = fs.readFileSync("index.html", "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
var patched = script.replace(
  /requestAnimationFrame\(loop\);/,
  "requestAnimationFrame(loop);\n" +
  "window.__g = { balls: balls, cueBall: cueBall };"
);

var perf = { _t: 0, now: function () { this._t += 16; return this._t; } };
var ctxObj = {
  save: function () {}, restore: function () {}, translate: function () {}, scale: function () {}, rotate: function () {},
  setTransform: function () {}, clearRect: function () {}, fillRect: function () {}, strokeRect: function () {},
  beginPath: function () {}, moveTo: function () {}, lineTo: function () {}, arc: function () {},
  fill: function () {}, stroke: function () {}, fillText: function () {},
  createLinearGradient: function () { return { addColorStop: function () {} }; },
  createRadialGradient: function () { return { addColorStop: function () {} }; }
};
var doc = { getElementById: function (id) { return id === "c" ? fakeCanvas : null; } };
var win = {};
win.addEventListener = function (t, cb) { win.handlers[t] = cb; };
win.handlers = {};
win.innerWidth = 2200;
win.innerHeight = 1300;
var fakeCanvas = { width: 1000, height: 560, style: {}, getContext: function () { return ctxObj; },
  getBoundingClientRect: function () { return { left: 0, top: 0, width: 1000, height: 560 }; } };

var context = vm.createContext({ window: win, document: doc, performance: perf });
vm.runInContext(patched, context);
console.log("__g:", typeof context.window.__g);
if (context.window.__g) {
  console.log("balls:", context.window.__g.balls.length);
  console.log("cue: x=" + context.window.__g.cueBall.x.toFixed(1), "y=" + context.window.__g.cueBall.y.toFixed(1));
}
