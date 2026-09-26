/* smoke-e2e.js — headless end-to-end check for the 16-ball engine.
   Drives the real P.Game / P.Physics / P.Rules pipeline in Node (no DOM, no
   WebGL). The 3D renderer is stubbed as a no-op so game.js's P.WebGL3D.*
   calls are harmless here; what matters is that state -> physics -> rules ->
   loop runs without throwing. As evidence it emits openable top-down SVG
   snapshots of the logical state (something you can open in a browser).
   Run:  node smoke-e2e.js
   Exits 0 if the full pipeline runs through a break and post-break state. */

var fs = require("fs");

/* Harness convention: `window` is the global object, every module attaches its
   API to window.Poole via a `var W = window` IIFE. No timers in Node. */
globalThis.window = globalThis;
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
if (!globalThis.performance) globalThis.performance = {};
globalThis.performance.now = Date.now;

function loadModule(relPath) {
  var code = fs.readFileSync(relPath, "utf8");
  return new Function("window", "globalThis",
    "globalThis.window = globalThis.window || window;\n" + code)(globalThis, globalThis);
}

function fail(msg) { console.log("[FAIL] " + msg); process.exit(1); }
function ok(label) { console.log("[OK] " + label); }

try {
  /* Logic modules only. webgl3d.js is a browser/WebGL module (needs THREE);
     we stub it below so game.js's P.WebGL3D.* calls in Node are no-ops. */
  ["src/config.js", "src/vec.js", "src/ball.js", "src/table.js",
   "src/physics.js", "src/rules.js", "src/player.js", "src/bot.js", "src/ui.js"]
    .forEach(loadModule);

  if (!globalThis.Poole.WebGL3D) {
    globalThis.Poole.WebGL3D = {
      init: function () {},
      resize: function () {},
      draw: function () {},
      pop: function () {},
      screenToTableLogical: function () { return null; }
    };
  }
  loadModule("src/game.js");
} catch (e) { fail("module load threw: " + e.message); }

var C = globalThis.Poole.CONFIG;
var T = globalThis.Poole.Table;
var U = globalThis.Poole.UI;
var G = globalThis.Poole.Game;

/* Table transform for the SVG snapshots (headless: we only need the mapping). */
T.fit({ width: 0, height: 0 }, 1600, 900);
var W = 1600, H = 900;

/* ---- seed + smoke-drive ---------------------------------------------
   The renderer is a headless no-op, so we assert the loop *doesn't throw* and
   that state evolves, not on pixel output. */
try { G.newGame(); } catch (e) { fail("P.Game.newGame() threw: " + e.message); }
var state = globalThis.Poole.State();
if (!state) fail("P.State() returned null after newGame");
if (state.balls.length !== 16) fail("expected 16 balls, got " + state.balls.length);
ok("newGame: 16 balls on table, phase=" + state.phase + ", turn=human");

for (var f = 0; f < 50; f++) { G.tick(); }   /* must not throw */
ok("50 idle frames ran without throwing");

function SC(x, y) { return { x: T.offX + x * T.size, y: T.offY + y * T.size }; }
var onTable = 0;
state.balls.forEach(function (b) {
  var s = SC(b.x, b.y);
  if (!isFinite(s.x) || !isFinite(s.y)) fail("non-finite ball " + b.id + ": " + JSON.stringify({ x: b.x, y: b.y }));
  if (!b.inPocket) onTable++;
});
emitSVG("snapshot-rack.svg", state, false);
ok("snapshot-rack.svg emitted; " + onTable + "/" + state.balls.length + " balls on table");

/* ---- aim + fire the break ------------------------------------------- */
U.aiming = true; U.shootable = true; U.power = 0.65;
U.aimX = state.cue.x - 220; U.aimY = state.cue.y + 180;
emitSVG("snapshot-aim.svg", state, true);     /* rack + cue stick + dash line */

/* Reversed-aim convention (ui.js): the cue flies AWAY from the pointer. */
U.onFire({ vx: 45, vy: -C.MAX_SHOT_SPEED * 0.82 });
var settled = 0, MAX_FRAMES = 8000;
while (state.shotInFlight && settled < MAX_FRAMES) { G.tick(); settled++; }
if (state.shotInFlight) fail("break shot never settled in " + MAX_FRAMES + " frames");
ok("break settled in " + settled + " frames; phase=" + state.phase);

emitSVG("snapshot-after.svg", state, false);
var onTable2 = 0; state.balls.forEach(function (b) { if (!b.inPocket) onTable2++; });
ok("post-break: " + onTable2 + " balls still on table");

/* ---- extra showable frames (top-down schematic) -------------------------
   Exercise state paths the break scene never covers: a game-over flag (DOM
   #gameover overlay) and a freshly re-spotted cue (foul). */

/* (A) clean win by "You": 8-ball pocketed + gameOver -> overlay. */
{
  var stW = globalThis.Poole.State();
  for (var wi = 0; wi < stW.balls.length; wi++) { if (stW.balls[wi].id === 8) { stW.balls[wi].inPocket = true; } }
  stW.gameOver = true;
  stW.winner = stW.players[0];                        /* "You" */
  stW.message = stW.winner.name + " wins! Click to play again.";
  emitSVG("snapshot-win.svg", stW, false, true);      /* 4th arg = overlay on */
}

/* (B) scratch foul: fresh full rack, cue re-spotted to centre. */
{
  G.newGame();                                        /* pristine 16-ball state */
  var stF = globalThis.Poole.State();
  if (stF.cue) { stF.cue.x = C.CENTER.x; stF.cue.y = C.CENTER.y; }
  stF.message = "SCRATCH - foul (cue back to centre)";
  emitSVG("snapshot-foul.svg", stF, false);
}

var files = ["snapshot-rack.svg", "snapshot-aim.svg", "snapshot-after.svg", "snapshot-win.svg", "snapshot-foul.svg"];
for (var a = 0; a < files.length; a++) {
  ok(files[a] + " (" + fs.statSync(files[a]).size + " bytes)");
}
console.log("\nSnapshots written to repo root. Open a .svg file in any browser.");

/* ---- top-down SVG snapshot (logical coords). Pure Node, no canvas. ----
   Renders the current state's balls/rack/rail as an openable <svg>. `st` is
   the specific state object to snapshot. */
function emitSVG(path, st, withAim, showOverlay) {
  var size = T.size, ox = T.offX, oy = T.offY;
  function sc(lx, ly) { return { x: ox + lx * size, y: oy + ly * size }; }
  var r = C.BR * size, pr = C.POCKET_R * size;
  var o = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'];
  o.push('<defs>' +
    '<radialGradient id="shine" cx="0.30" cy="0.28" r="1">' +
    '<stop offset="0" stop-color="#ffffff"/><stop offset="0.2" stop-color="#ffffff" stop-opacity="0.9"/>' +
    '<stop offset="0.7" stop-color="#ffffff" stop-opacity="0.06"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="felt" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#0e6b3c"/><stop offset="0.5" stop-color="#147a4a"/><stop offset="1" stop-color="#0f6d3d"/></linearGradient>' +
    '<radialGradient id="pocket" cx="0.5" cy="0.5" r="0.75">' +
    '<stop offset="0" stop-color="#020704"/><stop offset="0.6" stop-color="#11190f"/><stop offset="1" stop-color="#2a1d0e"/></radialGradient>' +
    '</defs>');

  o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#0b0e12"/>');
  var left = ox + C.IX0 * size, up = oy + C.IY0 * size, right = ox + C.IX1 * size, down = oy + C.IY1 * size;
  o.push('<rect x="' + left + '" y="' + up + '" width="' + (right - left) + '" height="' + (down - up) + '" fill="url(#felt)"/>');

  /* dark wood frame + light highlight border */
  o.push('<rect x="' + (ox + (C.IX0 + 17) * size) + '" y="' + (oy + (C.IY0 + 17) * size) + '" width="' + (C.IX1 - C.IX0 - 34) * size +
    '" height="' + (C.IY1 - C.IY0 - 34) * size + '" fill="none" stroke="#2e1608" stroke-width="' + r + '"/>');
  o.push('<rect x="' + (ox + (C.IX0 + 1) * size) + '" y="' + (oy + (C.IY0 + 1) * size) + '" width="' + (C.IX1 - C.IX0 - 2) * size +
    '" height="' + (C.IY1 - C.IY0 - 2) * size + '" fill="none" stroke="#ffffff3d" stroke-width="' + (r * 0.35).toFixed(1) + '"/>');

  for (var gi = 0; gi < 8; gi++) {
    var gx = ox + (C.IX0 + C.BR * (3 + gi * 12)) * size;
    o.push('<line x1="' + gx + '" y1="' + up + '" x2="' + gx + '" y2="' + down + '" stroke="#ffffff05" stroke-width="' + (r * 0.6).toFixed(1) + '"/>');
  }

  for (var i = 0; i < C.pockets.length; i++) {
    var p = sc(C.pockets[i].x, C.pockets[i].y);
    o.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + pr + '" fill="url(#pocket)"/>');
    o.push('<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (pr * 0.65).toFixed(1) + '" fill="#050704" opacity="0.5"/>');
  }

  st.balls.forEach(function (b) {
    if (b.inPocket) return;
    var s = sc(b.x, b.y);
    var hex = b.color || "#f0f0f0";
    o.push('<circle cx="' + s.x + '" cy="' + s.y + '" r="' + r + '" fill="' + hex + '"/>');
    o.push('<circle cx="' + s.x + '" cy="' + s.y + '" r="' + r + '" fill="url(#shine)" opacity="0.92"/>');

    if (typeof b.id === "number" && b.id >= 9 && b.id <= 15) {
      o.push('<ellipse cx="' + s.x + '" cy="' + s.y + '" rx="' + (r * 0.74).toFixed(1) + '" ry="' + (r * 0.32).toFixed(1) + '" fill="#ffffffcc"/>');
    }
    if (typeof b.id === "number") {
      var nfill = (b.id === 8) ? "#ddd" : "#fff";
      o.push('<text x="' + (s.x + r * 0.12).toFixed(1) + '" y="' + (s.y + r * 0.15).toFixed(1) +
        '" font-family="Arial,sans-serif" font-size="' + (r * 0.6).toFixed(1) + '" font-weight="bold"' +
        ' text-anchor="middle" dominant-baseline="central" fill="' + nfill + '">' + b.id + '</text>');
    } else if (b.id === "cue") {
      var d = r * 0.27;
      o.push('<circle cx="' + s.x + '" cy="' + (s.y - d).toFixed(1) + '" r="' + d.toFixed(1) + '" fill="#777"/>');
      o.push('<circle cx="' + (s.x - d).toFixed(1) + '" cy="' + (s.y + d * 0.6).toFixed(1) + '" r="' + d.toFixed(1) + '" fill="#777"/>');
      o.push('<circle cx="' + (s.x + d).toFixed(1) + '" cy="' + (s.y + d * 0.6).toFixed(1) + '" r="' + d.toFixed(1) + '" fill="#777"/>');
    }
  });

  if (withAim) {
    var cu = st.cue;
    var dx = U.aimX - cu.x, dy = U.aimY - cu.y;
    var dl = Math.sqrt(dx * dx + dy * dy) || 1;
    var dirx = -(dx / dl), diry = -(dy / dl);   /* real shot direction (away from pointer) */
    var ls = sc(cu.x + dirx * (C.BR + 46), cu.y + diry * (C.BR + 46));
    var le = sc(cu.x + dirx * 470, cu.y + diry * 470);
    o.push('<line x1="' + ls.x + '" y1="' + ls.y + '" x2="' + le.x + '" y2="' + le.y +
      '" stroke="#5ed7ff" stroke-opacity="0.6" stroke-width="' + (r * 0.8).toFixed(1) + ' stroke-dasharray="14,14"/>');
    o.push('<circle cx="' + le.x + '" cy="' + le.y + '" r="' + ((C.BR + C.BR * 0.35) * size).toFixed(1) +
      '" fill="none" stroke="#5ed7ff" stroke-width="' + (r * 0.3).toFixed(1) + '" opacity="0.6"/>');

    var tip = sc(cu.x + dirx * (42 + C.BR), cu.y + diry * (42 + C.BR));
    var butt = sc(cu.x - dirx * 380, cu.y - diry * 380);
    o.push('<line x1="' + tip.x + '" y1="' + tip.y + '" x2="' + butt.x + '" y2="' + butt.y +
      '" stroke="#c59a63" stroke-width="' + (r * 1.7).toFixed(1) + '" stroke-linecap="round" opacity="0.9"/>');
    o.push('<line x1="' + tip.x + '" y1="' + tip.y + '" x2="' + butt.x + '" y2="' + butt.y +
      '" stroke="#6b4221" stroke-width="' + (r * 0.5).toFixed(1) + '" stroke-linecap="round" opacity="0.35"/>');
    o.push('<circle cx="' + tip.x + '" cy="' + tip.y + '" r="' + (r * 0.6).toFixed(1) + '" fill="#7e8b95"/>');
  }

  if (showOverlay) {
    /* Full-screen game-over overlay (screen coords) — mirrors the DOM #gameover
       centre card, shown only while state.gameOver. */
    var minDim = Math.min(W, H);
    var fs1 = Math.round(minDim * 0.07), fs2 = Math.round(minDim * 0.04);
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#000" opacity="0.5"/>');
    var winName = st.winner ? st.winner.name : "?";
    o.push('<text x="' + (W / 2) + '" y="' + (H / 2 - minDim * 0.03).toFixed(1) + '" ' +
      'text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" ' +
      'font-size="' + fs1 + '" fill="#ffffff">' + escapeXml("Game over - " + winName + " wins!") + '</text>');
    o.push('<text x="' + (W / 2) + '" y="' + (H / 2 + minDim * 0.06).toFixed(1) + '" ' +
      'text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" ' +
      'font-size="' + fs2 + '" fill="#ffffff">' + escapeXml("Click the table to play again") + '</text>');
  }

  o.push('<text x="' + W / 2 + '" y="' + (H - 8) + '" font-family="Arial" font-size="14" ' +
    'fill="#9fd7ff" text-anchor="middle">' + escapeXml(st.message || "") + '</text>');

  o.push('</svg>');
  fs.writeFileSync(path, o.join(""), "utf8");
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    switch (ch) { case "&": return "&amp;"; case "<": return "&lt;"; case ">": return "&gt;";
                  case '"': return '&quot;'; case "'": return "&#39;"; }
  });
}
