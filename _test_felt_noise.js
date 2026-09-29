/* Headless smoke test for the felt-grain math (src/noise.js).
   Run: node _test_felt_noise.js  */
var path = require('path');
require(path.join(__dirname, 'src', 'noise.js'));

var N = Poole.Noise;
var ok = 0, bad = 0;
function check(cond, msg) {
  if (cond) { ok++; } else { bad++; console.error('FAIL: ' + msg); }
}

/* deterministic point stream (fixed seed -> reproducible test) */
var pt = N.mulberry32(1);

/* 1. range: every channel is an integer in [0,255] */
for (var i = 0; i < 4096; i++) {
  var u = pt(), v = pt();
  var c = N.sampleFelt(u, v);
  check(Number.isInteger(c.r) && c.r >= 0 && c.r <= 255, 'r in range');
  check(Number.isInteger(c.g) && c.g >= 0 && c.g <= 255, 'g in range');
  check(Number.isInteger(c.b) && c.b >= 0 && c.b <= 255, 'b in range');
}

/* 2. periodicity (seamless tiling): n(u,v)==n(u+1,v)==n(u,v+1).
   Use u,v that are not on integer grid boundaries to avoid FP edge cases. */
for (var j = 0; j < 512; j++) {
  var uu = 0.01 + pt() * 0.98, vv = 0.01 + pt() * 0.98;
  var a = N.sampleFelt(uu, vv), b = N.sampleFelt(uu + 1, vv), c = N.sampleFelt(uu, vv + 1);
  check(a.r === b.r && a.g === b.g && a.b === b.b, 'period-x @ (' + uu.toFixed(3) + ',' + vv.toFixed(3) + ')');
  check(a.r === c.r && a.g === c.g && a.b === c.b, 'period-y @ (' + uu.toFixed(3) + ',' + vv.toFixed(3) + ')');
}

/* 3. determinism: same seed -> identical output for fixed points */
for (var k = 0; k < 128; k++) {
  var du = 0.3719, dv = 0.5832;
  var a2 = N.sampleFelt(du, dv);
  check(a2.r === N.sampleFelt(du, dv).r && a2.g === N.sampleFelt(du, dv).g && a2.b === N.sampleFelt(du, dv).b, 'deterministic');
}

/* 4. value noise in [0,1] */
for (var q = 0; q < 256; q++) {
  var nu = pt(), nv = pt();
  var nq = N.makeValueNoise(64, 7)(nu, nv);
  check(nq >= 0 && nq <= 1, 'value noise in [0,1]');
}

console.log('felt noise: PASS=' + ok + ' FAIL=' + bad);
if (bad) process.exitCode = 1;
