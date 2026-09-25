/* smoke-e2e.js — headless end-to-end check for the 8-ball game.
   Drives the real P.Game / P.Render / P.Physics pipeline in Node (no DOM, no browser)
   and emits openable SVG snapshots as "something showable".
   Run:  node smoke-e2e.js */

var fs = require("fs");

// ---------------------------------------------------------------- env stubs ---
globalThis.window = globalThis;                          /* every module does `var W = window` */
globalThis.requestAnimationFrame = function () { return 0; };  /* no-op: we drive frames manually */
globalThis.setTimeout = function () { return 0; };
globalThis.clearTimeout = function () {};
if (!globalThis.performance) globalThis.performance = {};
globalThis.performance.now = Date.now;

var loadOrder = [
  "src/config.js", "src/vec.js", "src/ball.js", "src/table.js",
  "src/physics.js", "src/rules.js", "src/player.js", "src/bot.js",
  "src/ui.js", "src/render.js", "src/game.js"
];

function loadModule(relPath) {
  var code = fs.readFileSync(relPath, "utf8");
  return new Function("window", "globalThis",
    "globalThis.window = globalThis.window || window;\n" + code)(globalThis, globalThis);
}

function fail(msg) { console.log("[FAIL] " + msg); process.exit(1); }
function ok(label) { console.log("[OK] " + label); }

try {
  for (var i = 0; i < loadOrder.length; i++) loadModule(loadOrder[i]);
} catch (e) { fail("module load threw: " + e.message); }

var C = globalThis.Poole.CONFIG;
var T = globalThis.Poole.Table;
var U = globalThis.Poole.UI;
var G = globalThis.Poole.Game;

// ------------------------------------------------ mock canvas + strict ctx ---
function makeCanvas(w, h) {
  var ops = { n: 0 };
  return {
    width: w, height: h,
    getContext: function (type) {
      if (type !== "2d") fail("unsupported context: " + type);
      function finite(v, name) { if (typeof v === "number" && !isFinite(v)) throw new Error("non-finite in " + name + "() : " + v); }
      return {
        fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, lineCap: "butt",
        font: "", textAlign: "left", textBaseline: "alphabetic", shadowColor: "", shadowBlur: 0,
        save: function () { ops.n++; return this; },
        restore: function () { ops.n++; return this; },
        translate: function (x, y) { finite(x,"t");finite(y,"t");ops.n++;return this; },
        scale: function (x, y) { finite(x,"s");finite(y,"s");ops.n++;return this; },
        rotate: function (a) { finite(a,"r");ops.n++;return this; },
        setTransform: function () { ops.n++; return this; },
        beginPath: function () { ops.n++; return this; },
        closePath: function () { ops.n++; return this; },
        moveTo: function (x, y) { finite(x,"m");finite(y,"m");ops.n++;return this; },
        lineTo: function (x, y) { finite(x,"l");finite(y,"l");ops.n++;return this; },
        quadCurveTo: function () { ops.n++; return this; },
        bezierCurveTo: function () { ops.n++; return this; },
        arc: function (cx,cy,r,a0,a1) { finite(cx,"a");finite(cy,"a");finite(r,"a");finite(a0,"a");finite(a1,"a");ops.n++;return this; },
        arcTo: function () { ops.n++; return this; },
        ellipse: function () { ops.n++; return this; },
        rect: function (x,y,w,h) { finite(x,"r");finite(y,"r");finite(w,"r");finite(h,"r");ops.n++;return this; },
        strokeRect: function (x,y,w,h) { finite(x,"sr");finite(y,"sr");finite(w,"sr");finite(h,"sr");ops.n++;return this; },
        fillRect: function (x,y,w,h) { finite(x,"fr");finite(y,"fr");finite(w,"fr");finite(h,"fr");ops.n++;return this; },
        fill: function () { ops.n++; return this; },
        stroke: function () { ops.n++; return this; },
        clip: function () { ops.n++; return this; },
        setLineDash: function (arr) { ops.n++; return this; },
        drawImage: function () { ops.n++; return this; },
        fillText: function (t,x,y) { finite(x,"ft");finite(y,"ft");ops.n++;return this; },
        createLinearGradient: function (x0,y0,x1,y1) {
          finite(x0,"clg");finite(y0,"clg");finite(x1,"clg");finite(y1,"clg"); return { addColorStop: function () {} };
        },
        createRadialGradient: function (cx0,cy0,r0,cx1,cy1,r1) {
          finite(cx0,"crg");finite(cy0,"crg");finite(r0,"crg");finite(cx1,"crg");finite(cy1,"crg");finite(r1,"crg"); return { addColorStop: function () {} };
        }
      };
    },
    __ops: ops
  };
}

var mockCanvas = makeCanvas(1600, 900);
var mockCtx = mockCanvas.getContext("2d");
globalThis.Poole._renderCtx = mockCtx;   /* game.js tick() reads P._renderCtx */
U.canvas = mockCanvas;
T.fit(mockCanvas, 1600, 900);

// ------------------------------------------------ seed + smoke draw ----------
try { G.newGame(); } catch (e) { fail("P.Game.newGame() threw: " + e.message); }
var state = globalThis.Poole.State();
if (!state) fail("P.State() returned null after newGame");

for (var f = 0; f < 30; f++) {
  try { G.tick(); } catch (e) { fail("draw loop threw in frame " + f + ": " + e.message); }
}
var opsBefore = mockCanvas.__ops.n;
for (var f2 = 0; f2 < 400; f2++) G.tick();
if (mockCanvas.__ops.n - opsBefore < 300) {
  fail("too few render ops (table/balls not drawn): " + (mockCanvas.__ops.n - opsBefore));
}

function SC(x, y) { return { x: T.offX + x * T.size, y: T.offY + y * T.size }; }
var onTable = 0;
state.balls.forEach(function (b) {
  var s = SC(b.x, b.y);
  if (!isFinite(s.x) || !isFinite(s.y)) fail("non-finite ball " + b.id + ": " + JSON.stringify({ x: b.x, y: b.y }));
  if (!b.inPocket) onTable++;
});
ok("430 frames rendered — " + (mockCanvas.__ops.n - opsBefore) + " draw ops, " + onTable + "/" + state.balls.length + " balls on table");

// ------------------------------------------------ fire the break shot --------
U.aiming = true; U.shootable = true; U.power = 0.65;
U.aimX = state.cue.x - 220; U.aimY = state.cue.y + 180;
G.tick();

emitSVG("snapshot-rack.svg", state, false);   // clean rack
emitSVG("snapshot-aim.svg", state, true);     // rack + cue stick + dash line

U.onFire({ vx: 45, vy: -C.MAX_SHOT_SPEED * 0.82 });
var settled = 0, MAX_FRAMES = 8000;
while (state.shotInFlight && settled < MAX_FRAMES) { G.tick(); settled++; }
if (state.shotInFlight) fail("break shot never settled in " + MAX_FRAMES + " frames");
ok("break settled in " + settled + " frames; phase=" + state.phase);

emitSVG("snapshot-after.svg", state, false);
var onTable2 = 0; state.balls.forEach(function (b) { if (!b.inPocket) onTable2++; });
ok("post-break: " + onTable2 + " balls still on table");

/* ---------------- extra showable frames ----------------
   The two frames below exercise render paths that the earlier
   break-scene snapshots never covered: the full-screen game-over
   overlay (drawGameOver) and a foul float (drawFloatMessages). */

/* (A) clean win by "You": 8-ball pocketed + game-over overlay + win float. */
{
  var stW = globalThis.Poole.State();
  for (var wi = 0; wi < stW.balls.length; wi++) { if (stW.balls[wi].id === 8) { stW.balls[wi].inPocket = true; } }
  stW.gameOver = true;
  stW.winner = stW.players[0];                        /* name "You" */
  stW.message = stW.winner.name + " wins! Click to play again.";
  globalThis.Poole.Render.showFloatMsg(stW.winner.name + " WINS!", "170,245,120");
  emitSVG("snapshot-win.svg", stW, false, true);      /* 4th arg = render floats + overlay */
}

/* (B) scratch foul: fresh full rack, cue re-spotted to centre, "SCRATCH - foul" float. */
{
  G.newGame();                                        /* pristine 16-ball state */
  var stF = globalThis.Poole.State();
  if (stF.cue) { stF.cue.x = C.CENTER.x; stF.cue.y = C.CENTER.y; }
  stF.floatMessages = [];
  stF.message = "SCRATCH - foul (cue back to centre)";
  globalThis.Poole.Render.showFloatMsg("SCRATCH - foul", "255,96,74");
  emitSVG("snapshot-foul.svg", stF, false, true);
}

var files = ["snapshot-rack.svg", "snapshot-aim.svg", "snapshot-after.svg", "snapshot-win.svg", "snapshot-foul.svg"];
for (var a = 0; a < files.length; a++) {
  ok(files[a] + " (" + fs.statSync(files[a]).size + " bytes)");
}
console.log("\nSnapshots written to repo root. Open a .svg file in any browser.");

  /* showOverlay: also render rising float text (floats) and the full-screen game-over
     overlay (when st.gameOver), matching src/render.js drawFloatMessages/drawGameOver. */
  function emitSVG(path, st, withAim, showOverlay) {
  var size = T.size, ox = T.offX, oy = T.offY;
  function sc(lx, ly) { return { x: ox + lx * size, y: oy + ly * size }; }
  var r = C.BR * size, pr = C.POCKET_R * size;
  var W = 1600, H = 900;

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

  // dark wood frame + light highlight border
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

  state.balls.forEach(function (b) {
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
    var dirx = -(dx / dl), diry = -(dy / dl);   // real shot direction (away from pointer)
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
     /* Rising float text (logical coords) — static peak-alpha frame.
        Mirrors render.js drawFloatMessages(): bold, sized ~2*ball radius. */
     var msgs = st.floatMessages || [];
     for (var qi = 0; qi < msgs.length; qi++) {
       var m = msgs[qi];
       var ms = sc(m.x, m.y);
       o.push('<text x="' + ms.x.toFixed(1) + '" y="' + ms.y.toFixed(1) + '" ' +
         'text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" ' +
         'font-size="' + (C.BR * 2 * size).toFixed(1) + '" fill="rgb(' + m.rgb + ')" ' +
         'fill-opacity="1">' + escapeXml(m.text) + '</text>');
     }

     /* Full-screen game-over overlay (screen coords) — mirrors drawGameOver(). */
     if (st.gameOver) {
       o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#000" opacity="0.5"/>');
       var winName = st.winner ? st.winner.name : "?";
       var minDim = Math.min(W, H);
       var fs1 = Math.round(minDim * 0.07), fs2 = Math.round(minDim * 0.04);
       o.push('<text x="' + (W / 2) + '" y="' + (H / 2 - minDim * 0.03).toFixed(1) + '" ' +
         'text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" ' +
         'font-size="' + fs1 + '" fill="#ffffff">' + escapeXml("Game over - " + winName + " wins!") + '</text>');
       o.push('<text x="' + (W / 2) + '" y="' + (H / 2 + minDim * 0.06).toFixed(1) + '" ' +
         'text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" ' +
         'font-size="' + fs2 + '" fill="#ffffff">' + escapeXml("Click the table to play again") + '</text>');
     }
   }

   o.push('<text x="' + W / 2 + '" y="' + (H - 8) + '" font-family="Arial" font-size="14" ' +
     'fill="#9fd7ff" text-anchor="middle">' + escapeXml(st.message || "") + '</text>');

   o.push('</svg>');
  /* o[0] is already the full <svg ...> open tag and the last is </svg>; do NOT
     wrap the joined array in extra angle brackets (that produced invalid XML). */
  fs.writeFileSync(path, o.join(""), "utf8");
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, function (ch) {
    switch (ch) { case "&": return "&amp;"; case "<": return "&lt;"; case ">": return "&gt;";
                  case '"': return '&quot;'; case "'": return "&#39;"; }
  });
}