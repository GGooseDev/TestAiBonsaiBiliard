/* play-e2e-browser.js — headless-browser proof that Poole is a playable 3D game.
 *
 * The pure-Node tests (smoke-e2e.js / auto-play.js) stub WebGL, so they only
 * prove the state->physics->rules engine. This test runs the REAL Three.js
 * WebGL renderer in headless Chromium and drives actual gameplay:
 *
 *   1. Launch Chrome (headless, software GL — NO --disable-gpu).
 *   2. Serve index.html over HTTP and verify the 3D frame is real, non-flat
 *      pixel content (PNG IDAT size) with no console/runtime errors.
 *   3. Drive turns through the public API: P.UI.onFire(shot), P.Bot.bestShot,
 *      P.Rules.legalIds, P.Game.chooseGroup — the same path a human/AI uses.
 *   4. Prove the rule machine advances (turns change, group picker resolved,
 *      pockets reduce ball count, message updates).
 *   5. Stop when the game is won or a short playable segment has shown at
 *      least one pocketed object ball, then assert every gate.
 *
 * Run:   node play-e2e-browser.js
 * Exit 0 = all gates pass; exit 1 = failure (reason printed before exit).
 *
 * Requires: a puppeteer install reachable via NODE_PATH (the browser binary is
 * discovered by puppeteer itself, e.g. chrome-win64). */

var fs = require("fs");
var path = require("path");
var http = require("http");

const ROOT = __dirname;

const PORT = 17821;             // static-server port (avoid stale browser ports)
const LISTEN_TIMEOUT_MS = 8000;  // max time to bind the static server

// Enough IDAT (compressed pixel) bytes to be clearly above a flat-colour PNG.
const MIN_IDAT_BYTES = 15000;     // full scene is ~40-60 KB, flat is < ~2 KB
// Animated proof: two frames 250 ms apart must differ by more than this many
// pixel bytes, which rules out a frozen/flat canvas.
const MIN_FRAME_DIFF = 4096;
// Wall-clock budget for the whole run.
const RUN_TIMEOUT_MS = 120000;    // 120 s is comfortable for ~8-12 shots
// Human turns the test will drive before giving up (bot turns also progress).
const MAX_HUMAN_SHOTS = 8;

var failReasons = [];
function fail(msg, fatal) {
  var msg = "[FAIL] " + msg;
  failReasons.push(msg);
  console.log(msg);
  if (fatal) process.exit(1);
}

function serve(req, res) {
  if (req.url === "/favicon.ico") { res.writeHead(204, {}); return res.end(); }
  /* strip query strings so versioned tags (?v=...) resolve to real files */
  var u = req.url.split("?")[0];
  req.url = (u === "/" || u === "/index.html") ? "/index.html" : u;
  var p = path.join(ROOT, decodeURIComponent(req.url));
  if (!p.startsWith(path.resolve(ROOT))) { res.writeHead(403, {}); return res.end(); }
  fs.readFile(p, function (err, buf) {
    if (err) { res.writeHead(404, {}); return res.end("missing " + p); }
    var ext = path.extname(p).toLowerCase();
    var type = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
      ".png": "image/png" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(buf);
  });
}

function serverReady() {
  var srv = http.createServer(serve);
  return new Promise(function (ok, err) {
    function onErr(e) { err(e); }
    srv.on("error", onErr);
    srv.listen(PORT, ok);
  });
}

function pngTotalIDat(buf) {
  if (!buf || buf.length < 8) return 0;
  var out = 0, i = 8;
  while (i + 8 <= buf.length) {
    var len = (buf[i] << 24) | ((buf[i + 1] & 0xff) << 16) | ((buf[i + 2] & 0xff) << 8) | buf[i + 3];
    var typeStr = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7]);
    if (typeStr === "IDAT") out += 12 + len;
    i += 12 + len;
  }
  return out;
}

function byteDiff(a, b) {
  var n = Math.min(a.length, b.length), d = 0;
  for (var i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

async function main() {
  console.log("[play-e2e] serving " + ROOT + " on :" + PORT);
  var server = await serverReady();

  var puppeteer;
  try { puppeteer = require("puppeteer"); } catch (e) {
    fail("puppeteer not resolvable: " + e.message, true);
  }

  var chromeExe = await puppeteer.executablePath();
  console.log("[play-e2e] chrome: " + chromeExe);

  var browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--hide-scrollbars",
        "--window-size=1366,768",
        // No "--disable-gpu": on this Chrome build it forces GL_VENDOR/RENDERER
        // to "Disabled" and kills the WebGL context entirely. Without it the
        // headless window gets a real (WebKit) WebGL 2D/3D context.
      ]
    });
  } catch (e) {
    fail("chrome launch failed: " + e.message, true);
  }

  var page = await browser.newPage();
  var consoleErrors = [];
  var runtimeErrors = [];
  page.on("console", function (m) { if (m.type() === "error") consoleErrors.push(String(m.text())); });
  page.on("pageerror", function (e) { runtimeErrors.push(String(e.message)); });

  var startWall = Date.now();
  console.log("[play-e2e] loading http://127.0.0.1:" + PORT + "/index.html");
  try {
    await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "networkidle2", timeout: 60000 });
  } catch (e) {
    fail("page load failed: " + e.message, true);
  }

  // The page opens on the startup menu; select Classic so the real game boots.
  await page.evaluate(function () {
    if (window.Poole && window.Poole.Menu && typeof window.Poole.Menu.pick === "function") {
      window.Poole.Menu.pick("classic");
    }
  });

  // ---- read state helper (runs in page context) ---------------------------------
  function readState() {
    return (function () {
      var P = window.Poole, st = null;
      if (P && typeof P.State === "function") try { st = P.State(); } catch (e) { st = null; }
      function pick(elId) { var el = document.getElementById(elId); return el ? String(el.textContent || "").trim() : ""; }
      return {
        ok3d: (function () {
          try {
            var P = window.Poole;
            // Prefer the renderer's own success flag. NEVER re-request a
            // context from #game here — calling canvas.getContext with the wrong
            // type on an already-WebGL2'd canvas makes Chromium log
            // "Canvas has an existing context of a different type" every poll.
            if (P && P.WebGL3D && typeof P.WebGL3D.ok === "function") {
              return !!P.WebGL3D.ok();
            }
            return !!window.THREE;
          } catch (e) { return false; }
        })(),
        balls: st ? st.balls.length : -1,
        phase: st ? st.phase : "?",
        shootable: st ? P.UI.shootable : null,
        shotInFlight: st ? st.shotInFlight : false,
        gameOver: st ? !!st.gameOver : false,
        winnerName: st && st.winner ? String(st.winner.name || "") : "",
        message: st ? String(st.message || "") : "",
        turnText: pick("turn"),
        groups: pick("groups"),
        inPocketIds: st ? st.balls.filter(function (b) { return b.inPocket; }).map(function (b) { return b.id; }) : [],
        ballsOnTable: st ? st.balls.filter(function (b) { return !b.inPocket; }).length : -1,
        cueX: st ? st.cue.x : NaN,
        cueY: st ? st.cue.y : NaN,
        cueFinite: !isNaN(st ? st.cue.x : 99) && !isNaN(st ? st.cue.y : 99)
      };
    })();
  }

  // ---- gate 0: engine booted + WebGL up + first frame non-flat ---------------
  var ready = null;
  console.log("[play-e2e] waiting for WebGL + 16 balls ...");
  for (var rAttempt = 0; !ready && Date.now() - startWall < LISTEN_TIMEOUT_MS + 30000; rAttempt++) {
    ready = await page.evaluate(readState);
    if (ready.ok3d && ready.balls === 16) break;
    await new Promise(function (ok) { setTimeout(ok, 250); });
  }
  if (!ready || !ready.ok3d) fail("WebGL/THREE not ready (phase=" + (ready ? ready.phase : "?") + ")", false);
  if (!ready || ready.balls !== 16) fail("expected 16 balls, got " + (ready ? ready.balls : "-"), false);

  // Let a few real rAF frames draw so the canvas is populated.
  await new Promise(function (ok) { setTimeout(ok, 2000); });

  async function capturePng(tag) {
    var buf = await page.screenshot({ type: "png" });
    var idat = pngTotalIDat(buf);
    console.log("[play-e2e] " + tag + " frame IDAT=" + idat + " bytes");
    return { idat: idat, buf: buf };
  }

  // Capture the initial rendered 3D scene (the felt, wood rails, rack, 3 balls).
  var startShot = await capturePng("start");
  if (startShot.idat < MIN_IDAT_BYTES) fail("start frame too flat/blank: IDAT=" + startShot.idat);

  // ---- prove the scene is ANIMATED (live 3D) by diffing two in-flight frames --
  var animatedProof = null;
  await new Promise(function (ok) { setTimeout(ok, 500); });

  function fireShot() {
    return page.evaluate(function () {
      var P = window.Poole, st = P.State();
      var legal = [];
      if (P.Rules && typeof P.Rules.legalIds === "function") legal = P.Rules.legalIds();
      else for (var n = 1; n <= 15; n++) { if (n !== 8) legal.push(n); }
      var s = P.Bot.bestShot ? P.Bot.bestShot(st.balls, st.cue, legal) : null;
      var MAX = P.CONFIG.MAX_SHOT_SPEED;
      if (!s || isNaN(s.vx) || isNaN(s.vy)) {
        // Deterministic fallback: knock toward table centre (no magic numbers).
        var CTR = P.CONFIG.CENTER || { x: 500, y: 280 };
        var dx = CTR.x - st.cue.x, dy = CTR.y - st.cue.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        s = { vx: (dx / dist) * MAX * 0.6, vy: (dy / dist) * MAX * 0.6, power: 0.6 };
      }
      return { shot: s, phase: st.phase };
    });
  }

  async function takeAnkFrames() {
    // Return true + diff if two frames taken 250 ms apart differ enough (live 3D).
    var a = await page.screenshot({ type: "png" });
    await new Promise(function (ok) { setTimeout(ok, 250); });
    var b = await page.screenshot({ type: "png" });
    return byteDiff(a, b);
  }

  // ---- drive the short game segment -------------------------------------------
  console.log("[play-e2e] driving gameplay (you fire bestShot on each your-turn)");
  var trace = [];
  var lastTurn = null;
  var lastPocketIds = {};
  var objectPocketsFound = [];
  var turnChanges = 0;
  var groupPickups = 0;
  var humanShotsFired = 0;
  var animatedDiff = 0;

  var canFire = function (s) {
    return s.shootable === true && s.shotInFlight === false && !s.gameOver && s.phase !== "chooseGroup";
  };

  console.log("[play-e2e] start: phase=" + ready.phase + ", turn=" + ready.turnText + ", message=\"" + ready.message + "\"");

  var lastPocketSet = {};
  while (Date.now() - startWall < RUN_TIMEOUT_MS) {
    var s = await page.evaluate(readState);

    if (s.cueFinite === false) { fail("cue ball position went non-finite at " + s.phase, false); }

    // Detect newly pocketed object balls (id 1-7, 9-15).
    s.inPocketIds.forEach(function (id) {
      if (typeof id === "number" && id !== 8) {
        if (!lastPocketSet[id]) {
          lastPocketSet[id] = true;
          objectPocketsFound.push(id);
          console.log("[play-e2e] pocketed ball #" + id);
        }
      }
    });

    if (s.turnText && s.turnText !== lastTurn) {
      lastTurn = s.turnText;
      turnChanges++;
      trace.push("turn=" + s.turnText);
    }

    console.log("[play-e2e] poll phase=" + s.phase + " | ontable=" + s.ballsOnTable +
      " | inPocket=[" + s.inPocketIds.join(",") + "] | shotInFlight=" + s.shotInFlight +
      " | turn=" + s.turnText + " | msg=\"" + s.message + "\"");

    if (s.gameOver) {
      console.log("[play-e2e] GAME OVER: " + s.winnerName + " wins");
      break;
    }

    if (s.phase === "chooseGroup") {
      await page.evaluate(function () { window.Poole.Game.chooseGroup("SOLID"); });
      groupPickups++;
      console.log("[play-e2e] group picker resolved -> SOLID (you keep turn)");
      await new Promise(function (ok) { setTimeout(ok, 120); });
      continue;
    }

    if (canFire(s)) {
      var shot = await fireShot();
      trace.push("YOU fire [" + shot.shot.vx.toFixed(1) + "," + shot.shot.vy.toFixed(1) + "] phase=" + shot.phase);
      console.log("[play-e2e] YOU fire shot " + (humanShotsFired + 1) + ": vx=" + shot.shot.vx.toFixed(0) +
        " vy=" + shot.shot.vy.toFixed(0) + " power=" + (shot.shot.power || "?"));
      await page.evaluate(function (sh) { window.Poole.UI.onFire(sh); }, shot.shot);
      humanShotsFired++;
      // While this shot is moving, capture two frames apart to prove live 3D.
      var inFlight = await page.evaluate(readState).then(function (st) { return st.shotInFlight; });
      if (inFlight && animatedDiff < MIN_FRAME_DIFF) {
        animatedDiff = await takeAnkFrames();
        console.log("[play-e2e] animated-frame byte diff = " + animatedDiff);
      }
    }

    await new Promise(function (ok) { setTimeout(ok, 90); });
  }

  var sLast = await page.evaluate(readState);

  // ---- final render still non-flat --------------------------------------------
  var endShot = await capturePng("end");
  if (endShot.idat < MIN_IDAT_BYTES) fail("end frame too flat/blank: IDAT=" + endShot.idat);

  console.log("[play-e2e] final: phase=" + sLast.phase + " winner=" + (sLast.winnerName || "-") +
    " inPocket=[" + sLast.inPocketIds.join(",") + "]");

  // ---- gates -------------------------------------------------------------------
  if (consoleErrors.length) {
    consoleErrors.forEach(function (m) { console.log("[play-e2e] console error: " + String(m).slice(0, 180)); });
    fail("console errors: " + consoleErrors.length);
  }
  if (runtimeErrors.length) {
    runtimeErrors.forEach(function (m) { console.log("[play-e2e] pageerror: " + m.slice(0, 180)); });
    fail("runtime errors: " + runtimeErrors.length);
  }
  if (!startShot.idat || startShot.idat < MIN_IDAT_BYTES) fail("initial render not non-flat (IDAT=" + startShot.idat + ")");
  if (animatedDiff < MIN_FRAME_DIFF) fail("scene did not visibly animate (frame diff=" + animatedDiff + " < " + MIN_FRAME_DIFF + ")");
  if (humanShotsFired === 0) fail("never fired a human shot");
  if (!sLast.cueFinite) fail("cue non-finite at end");

  // The core 'playable' proof: an object ball was pocketed, or the game reached
  // a resolved end (winner). At minimum, some state must have progressed.
  if (objectPocketsFound.length > 0) {
    console.log("[play-e2e] POCKETS CONFIRMED: " + objectPocketsFound.map(function (n) { return "#" + n; }).join(", "));
  } else if (!sLast.gameOver) {
    fail("no object ball pocketed within the segment and no game-over reached (shots=" +
      humanShotsFired + ", turn changes=" + turnChanges + ")");
  }

  // Rule-machine advanced: at least one visible transition after the break.
  if (turnChanges === 0 && sLast.ballsOnTable === 16 && !sLast.gameOver) {
    fail("rule machine did not advance (no turn change, 16 balls still on table)");
  }

  console.log("");
  console.log("[play-e2e] --- REPORT ---");
  console.log("[play-e2e] human shots fired : " + humanShotsFired);
  console.log("[play-e2e] objects potted    : " + (objectPocketsFound.length ? objectPocketsFound.join(" ") : "-"));
  console.log("[play-e2e] turn transitions  : " + turnChanges);
  console.log("[play-e2e] group picks       : " + groupPickups);
  console.log("[play-e2e] console errors    : " + consoleErrors.length);
  console.log("[play-e2e] runtime errors    : " + runtimeErrors.length);
  console.log("[play-e2e] animated frame diff: " + animatedDiff);
  console.log("[play-e2e] start/end IDAT    : " + startShot.idat + " / " + endShot.idat);
  console.log("[play-e2e] final phase       : " + sLast.phase);
  console.log("[play-e2e] message           : \"" + (sLast.message || "") + "\"");

  if (failReasons.length > 0) {
    console.log("");
    console.log("[play-e2e] " + failReasons.length + " failure(s):");
    failReasons.forEach(function (r) { console.log("   " + r); });
  } else {
    console.log("[play-e2e] OK all gates passed: real 3D WebGL rendering + playable gameplay verified.");
  }

  // Deterministic, guarded teardown: a failing gate must NEVER mask the real
  // reason with a spurious "undefined.read(close)" crash during cleanup.
  try {
    if (server) server.close();
    if (browser) await browser.close();
  } catch (teardownErr) { /* ignore cleanup noise */ }

  process.exit(failReasons.length ? 1 : 0);
}

main().catch(function (e) { fail("fatal: " + e.message, true); });
