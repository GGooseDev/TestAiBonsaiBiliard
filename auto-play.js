/* auto-play.js — headless full-game driver for the 16-ball engine.

   smoke-e2e.js only renders a single break scene (its setTimeout stub means
   bot turns never fire). This script auto-plays *entire* games by driving
   every shot through the public API:
     - human turn (break or legal shot) -> P.UI.onFire(shot)
     - group picker after a colour break -> P.Game.chooseGroup("SOLID")
     - bot turn  (native setTimeout is stubbed out here)  -> apply P.Bot.bestShot()
   and pump P.Game.tick() by hand. No browser, no timers, deterministic-ish.

   Run: node auto-play.js
   Exits 0 if the engine plays at least one full segment without throwing. */
(function () {
  var fs = require("fs");

  /* Match the harness convention of smoke-e2e / test-scaffold: window is the
     global object and every module attaches its API to window.Poole via a
     `var W = window` IIFE. */
  globalThis.window = globalThis;
  globalThis.requestAnimationFrame = function () { return 0; };
  globalThis.setTimeout = function () { return 0; };
  globalThis.clearTimeout = function () {};
  if (!globalThis.performance) globalThis.performance = {};
  globalThis.performance.now = Date.now;

   /* webgl3d.js is a browser/WebGL module (needs THREE). It is loaded last,
      after the headless stub below so tick()/start() never crash in Node. */
   var loadOrder = [
    "src/config.js", "src/vec.js", "src/ball.js", "src/table.js",
    "src/physics.js", "src/rules.js", "src/player.js", "src/bot.js",
    "src/ui.js"
   ];

   function loadModule(relPath) {
     var code = fs.readFileSync(relPath, "utf8");
     return new Function("window", "globalThis",
       "globalThis.window = globalThis.window || window;\n" + code)(globalThis, globalThis);
   }

   for (var i = 0; i < loadOrder.length; i++) {
     try { loadModule(loadOrder[i]); } catch (e) { fail("module load threw: " + e.message); }
   }
   /* Node has no THREE/WebGL, so game.js's P.WebGL3D calls must be no-ops. */
   if (!globalThis.Poole.WebGL3D) {
     globalThis.Poole.WebGL3D = { init: function () {}, resize: function () {}, draw: function () {}, pop: function () {}, screenToTableLogical: function () { return null; } };
   }
   try { loadModule("src/game.js"); } catch (e) { fail("module load threw: " + e.message); }

  function fail(msg) { console.log("[FAIL] " + msg); process.exit(1); }

  var C = globalThis.Poole.CONFIG;
  var T = globalThis.Poole.Table;
  var U = globalThis.Poole.UI;
  var G = globalThis.Poole.Game;
  var R = globalThis.Poole.Rules;
  var B = globalThis.Poole.Bot;
  var PH = globalThis.Poole.Physics;

  /* The setTimeout stub above (line ~21) means the engine's native bot-turn
     timer never fires in this harness, so we fire bot shots by hand in the
     driver loop below. */

   /* No fake 2D ctx is needed anymore: the WebGL renderer is stubbed in Node
      (P.WebGL3D.draw() is a no-op), so the driver only exercises game state. */
   T.fit({ width: 1600, height: 900 }, 1600, 900);

  /* A shot aimed straight at the rack from the break spot (matches the value
     smoke-e2e uses to make a deterministic break hit). */
  function breakShot() { return { vx: 45, vy: -C.MAX_SHOT_SPEED * 0.82 }; }

  function legalShot(state) {
    var legal = R.legalIds();
    var s = B.bestShot(state.balls, state.cue, legal);
    if (!s) {
      var a = Math.PI * 1.3;               /* weak, safe knock toward the felt */
      s = { vx: Math.cos(a) * C.MAX_SHOT_SPEED * 0.4, vy: Math.sin(a) * C.MAX_SHOT_SPEED * 0.4, power: 0.4 };
    }
    return s;
  }

  function ballsOnTable(state) {
    var n = 0;
    for (var i = 0; i < state.balls.length; i++) { if (!state.balls[i].inPocket) n++; }
    return n;
  }

  var totalFrames = 0;
  var maxTotal = 60000;                 /* room for one or two full games */
  var perShotLimit = 1500;              /* frames a single shot may take to settle */
  var framesSinceShot = 0;
  var shotsFired = 0;
  var lastShotInFlight = false;
  var winnerName = null;

  function fail(msg) {
    console.error("FAIL: " + msg);
    process.exit(1);
  }

  G.newGame();

  while (true) {
    var s = globalThis.Poole.State();
    if (!s) { fail("P.State() is null"); }
    if (s.gameOver) {
      winnerName = s.winner ? s.winner.name : "?";
      break;
    }

    G.tick();
    totalFrames++;
    framesSinceShot++;
    if (totalFrames > maxTotal) { console.log("\nstopped at frame cap (" + maxTotal + ")"); break; }

    s = globalThis.Poole.State();
    if (!s || s.gameOver) break;

    /* A previously moving shot just came to rest -> log the settled outcome. */
    if (lastShotInFlight && !s.shotInFlight) {
      framesSinceShot = 0;
      var ballsOnTheCue = ballsOnTable(s);
      console.log("shot #" + (shotsFired) + " settled  | phase=" + s.phase +
        " groups: You=" + (R.players[0].group || "-") + " Bot=" + (R.players[1].group || "-") +
        "  balls on table=" + ballsOnTheCue);
      if (!isFinite(s.cue.x) || !isFinite(s.cue.y)) {
        fail("non-finite cue after settle: " + JSON.stringify({ x: s.cue.x, y: s.cue.y }));
      }
    }

    if (s.shotInFlight) {
      if (framesSinceShot > perShotLimit) { fail("shot never settled (stuck?) at frame " + totalFrames); }
      continue;
    }

    /* Group picker after a colour break -> auto-pick SOLID. */
    if (s.phase === "chooseGroup") {
      G.chooseGroup("SOLID");
      framesSinceShot = 0;
      continue;
    }

    if (R.idx === 0) {                 /* human's turn: fire break or legal shot */
      var humanShot = (s.phase === "break" || s.phase === "pre") ? breakShot() : legalShot(s);
      U.onFire(humanShot);
      shotsFired++;
      framesSinceShot = 0;
    } else {                            /* bot's turn: fire manually (native timer is a stub) */
      var botShot = legalShot(s);
      PH.resetShot();
      s.cue.vx = botShot.vx;
      s.cue.vy = botShot.vy;
      s.shotInFlight = true;
      U.shootable = false;
      shotsFired++;
      framesSinceShot = 0;
    }
  }

  var finalS = globalThis.Poole.State();
  var finalBalls = finalS ? ballsOnTable(finalS) : null;
  console.log("\n--- auto-play report ---");
  console.log("shots fired   : " + shotsFired);
  console.log("frames pumped : " + totalFrames);
  console.log("final phase   : " + (finalS ? finalS.phase : "-"));
  console.log("winner        : " + winnerName);
  console.log("balls left    : " + finalBalls);

  if (shotsFired < 1) fail("no shots fired");
  console.log("\nOK auto-play completed without throwing.");
})();
