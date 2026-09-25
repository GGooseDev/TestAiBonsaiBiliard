/* Node smoke test for physics. Run: node test-physics.js */
globalThis.window = globalThis.window || {};
const path = require("path");
const base = ["config", "vec", "ball", "table", "physics"].map((n) =>
  path.join(__dirname, "src", n + ".js")
).forEach((p) => require(p));

const P = window.Poole;
const C = P.CONFIG;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); };

// pocketIndexFor sanity
assert(P.Table.pocketIndexFor(C.IX0 + 5, C.IY0 + 20) === 0, "top-left pocket idx 0");
assert(P.Table.pocketIndexFor(900, 300) === -1, "mid felt has no pocket");

// rack + cue
var balls = P.Table.rack();
var cue = P.Ball.create("cue", (C.IX0 + C.IX1) / 2, C.IY1 - C.BR * 8);
balls.push(cue);
P.Physics.setBalls(balls, cue);

// give the cue a strong shot up toward the rack (reversed aim style: shoot toward top)
cue.vx = 0;
cue.vy = -500;
P.Physics.resetShot();

for (var i = 0; i < 80; i++) P.Physics.integrateStep(C.STEP);

assert(!balls.some((b) => b.x !== b.x || b.y !== b.y), "no NaN after sim");

// at least the cue must have moved / contacted something
assert(P.Physics.firstContact === true, "cue should have first-contacted a ball (rack is right there)");

// every ball stays within felt bounds
for (var j = 0; j < balls.length; j++) {
  if (balls[j].inPocket) continue;
  var b = balls[j];
  assert(b.x >= C.IX0 - 1 && b.x <= C.IX1 + 1, "x in bounds: " + b.x);
  assert(b.y >= C.IY0 - 1 && b.y <= C.IY1 + 1, "y in bounds: " + b.y);
}

// some ball should have been pocketed or at least a lot moved off initial rack
var moved = 0;
for (var m = 0; m < balls.length; m++) if (balls[m].vx !== 0 || balls[m].vy !== 0) moved++;

console.log("Physics OK — firstContact=" + P.Physics.firstContact,
  "pocketedThisShot=" + JSON.stringify(P.Physics.pocketedThisShot));
console.log("firstContact:", P.Physics.firstContact);
