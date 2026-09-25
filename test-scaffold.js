/* Node smoke test for scaffold (config/vec/ball/table). Run: node test-scaffold.js */
globalThis.window = globalThis.window || {};
const path = require("path");
require(path.join(__dirname, "src", "config.js"));
require(path.join(__dirname, "src", "vec.js"));
require(path.join(__dirname, "src", "ball.js"));
require(path.join(__dirname, "src", "table.js"));

const P = window.Poole;
const assert = (cond, msg) => { if (!cond) { throw new Error("FAIL: " + msg); } };

const balls = P.Table.rack();
assert(balls.length === 15, "rack should have 15 object balls");
const ids = balls.map((b) => b.id).sort((a, b) => a - b);
assert(JSON.stringify(ids) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]), "ids must be 1..15");
assert(balls.some((b) => b.id === 8), "black 8 must be in rack");
assert(P.Ball.group(1) === "SOLID", "group(1)==SOLID");
assert(P.Ball.group(9) === "STRIPE", "group(9)==STRIPE");
assert(P.Ball.group(8) === null, "group(8)==null");
assert(!balls.some((b) => b.x !== b.x || b.y !== b.y), "no NaN in rack");

const v = P.Vec.normalize({ x: 3, y: 4 });
assert(Math.abs(v.x - 0.6) < 1e-6, "normalize 3,4 x=0.6");
assert(Math.abs(v.y - 0.8) < 1e-6, "normalize 3,4 y=0.8");

console.log("Scaffold OK");
