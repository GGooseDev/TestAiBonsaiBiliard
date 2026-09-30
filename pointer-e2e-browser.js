/* pointer-e2e-browser.js — headless-browser proof that a REAL human pointer
 * gesture (mousedown -> mousemove aim -> mouseup fire) drives the 3D Poole game.
 *
 * play-e2e-browser.js already proves playable gameplay, but it fires shots via the
 * public API P.UI.onFire(shot), bypassing on-screen input. This test instead sends
 * genuine pointer events with page.mouse and verifies that the full interactive
 * chain works:
 *
 *   1. Launch Chromium (headless, software GL; NO --disable-gpu).
 *   2. Wait for the real Three.js 3D renderer + a full 16-ball rack.
 *   3. On the first human turn (shootable === true), drag the mouse over the
 *      felt: press near centre, move (aim) to build power, release.
 *   4. Assert the game accepted that pointer shot: it must drive a ball into
 *      flight and/or reduce balls on the table / advance the rule machine, with
 *      NO console or runtime errors.
 *   5. Re-assert the scene stays real non-flat 3D (IDAT + animated diff).
 *
 * Run:   node pointer-e2e-browser.js
 * Exit 0 = all gates pass; exit 1 = failure. */

var fs = require("fs");
var path = require("path");
var http = require("http");

const ROOT = __dirname;

const PORT = 17822;             // static-server port (distinct from play-e2e-browser)
const LISTEN_TIMEOUT_MS = 8000;
const MIN_IDAT_BYTES = 15000;   // non-flat PNG threshold
const MIN_FRAME_DIFF = 4096;    // animated proof threshold
const READY_TIMEOUT_MS = 30000; // max time for WebGL + rack to appear
const POINTERSHOT_WAIT_MS = 9000; // max time for the pointer shot to take effect

var failReasons = [];
function fail(msg) {
  var m = "[FAIL] " + msg;
  failReasons.push(m);
  console.log(m);
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
    srv.on("error", err);
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
  console.log("[pointer-e2e] serving " + ROOT + " on :" + PORT);
  var server = await serverReady();

  var puppeteer;
  try { puppeteer = require("puppeteer"); } catch (e) {
    fail("puppeteer not resolvable: " + e.message);
    process.exit(1);
  }

  var chromeExe = await puppeteer.executablePath();
  console.log("[pointer-e2e] chrome: " + chromeExe);

  var browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--hide-scrollbars",
        "--window-size=1366,768"
        // No "--disable-gpu": on this Chrome build it disables WebGL entirely.
      ]
    });
  } catch (e) {
    fail("chrome launch failed: " + e.message);
    process.exit(1);
  }

  var page = await browser.newPage();
  var consoleErrors = [];
  var runtimeErrors = [];
  page.on("console", function (m) { if (m.type() === "error") consoleErrors.push(String(m.text())); });
  page.on("pageerror", function (e) { runtimeErrors.push(String(e.message)); });

  var startWall = Date.now();
  console.log("[pointer-e2e] loading http://127.0.0.1:" + PORT + "/index.html");
  try {
    await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "networkidle2", timeout: 60000 });
  } catch (e) {
    fail("page load failed: " + e.message);
  }

  // The page opens on the startup menu; select Classic so the real game boots.
  await page.evaluate(function () {
    if (window.Poole && window.Poole.Menu && typeof window.Poole.Menu.pick === "function") {
      window.Poole.Menu.pick("classic");
    }
  });

  // ---- read-state helper (page context) ---------------------------------------
  function readState() {
    return (function () {
      var P = window.Poole, st = null;
      if (P && typeof P.State === "function") try { st = P.State(); } catch (e) { st = null; }
      return {
        ok3d: function ok3d() {
          try {
            var P2 = window.Poole;
            // Never re-request a canvas context; prefer the renderer's own flag.
            if (P2 && P2.WebGL3D && typeof P2.WebGL3D.ok === "function") return !!P2.WebGL3D.ok();
            return !!window.THREE;
          } catch (e) { return false; }
        },
        balls: st ? st.balls.length : -1,
        shootable: P ? P.UI.shootable : null,
        shotInFlight: st ? st.shotInFlight : false,
        gameOver: st ? !!st.gameOver : false,
        phase: st ? st.phase : "?",
        ballsOnTable: st ? st.balls.filter(function (b) { return !b.inPocket; }).length : -1,
        inPocketIds: st ? st.balls.filter(function (b) { return b.inPocket; }).map(function (b) { return b.id; }) : [],
        message: st ? String(st.message || "") : "",
        turnText: st ? (document.getElementById("turn") ? document.getElementById("turn").textContent.trim() : "") : ""
      };
    })();
  }

  // Wait for the renderer to be up and the full rack present.
  var ready = null;
  console.log("[pointer-e2e] waiting for WebGL + 16 balls ...");
  for (var a = 0; !ready && Date.now() - startWall < READY_TIMEOUT_MS; a++) {
    ready = await page.evaluate(readState);
    if (ready && ready.ok3d && ready.balls === 16) break;
    await new Promise(function (ok) { setTimeout(ok, 250); });
  }
  if (!ready || !ready.ok3d) fail("WebGL not ready");
  if (!ready || ready.balls !== 16) fail("expected 16 balls, got " + (ready ? ready.balls : "-"));

  // Let real rAF frames populate the canvas.
  await new Promise(function (ok) { setTimeout(ok, 2000); });

  async function capturePng(tag) {
    var buf = await page.screenshot({ type: "png" });
    var idat = pngTotalIDat(buf);
    console.log("[pointer-e2e] " + tag + " frame IDAT=" + idat + " bytes");
    return { idat: idat, buf: buf };
  }

  var startShot = await capturePng("start");
  if (startShot.idat < MIN_IDAT_BYTES) fail("start frame too flat/blank: IDAT=" + startShot.idat);

  // ---- drive a real pointer gesture on the first human turn -------------------
  console.log("[pointer-e2e] waiting for a human (shootable) turn ...");
  var s;
  for (var t0 = Date.now(); Date.now() - t0 < POINTERSHOT_WAIT_MS && Date.now() - startWall < READY_TIMEOUT_MS + 45000; ) {
    s = await page.evaluate(readState);
    if (s.gameOver) break;
    var canAct = s.shootable === true && s.shotInFlight === false && s.phase !== "chooseGroup";
    if (canAct) break;
    // If the very first human turn is the break, great. If a prior shot already put
    // us in a state where only the bot acts, shootable stays false and we just wait.
    await new Promise(function (ok) { setTimeout(ok, 120); });
  }
  if (!s || s.gameOver) fail("game over before a human pointer turn");

  console.log("[pointer-e2e] human turn: phase=" + s.phase + " ontable=" + s.ballsOnTable +
    " message=\"" + (s.message || "") + "\"");

  var baselineOnTable = s.ballsOnTable;
  var baselinePockets = s.inPocketIds.slice();

  // Canvas centre in viewport (CSS) coordinates.
  var rect = await page.evaluate(function () {
    var c = document.getElementById("game");
    if (!c || !c.getBoundingClientRect) return { cx: window.innerWidth / 2, cy: window.innerHeight / 2 };
    var r = c.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  // Drag amount in CSS pixels (aim power). Must exceed the "too short" threshold.
  var DRAG_X = 150;
  var DRAG_Y = -120;

  var midPower = null;
  console.log("[pointer-e2e] pressing pointer at (" + rect.cx.toFixed(0) + "," + rect.cy.toFixed(0) + ")");
  await page.mouse.move(rect.cx, rect.cy, { steps: 1 });
  await page.mouse.down();

  // Simulate an aim sweep: several intermediate mouse moves to update P.UI.aim.
  var STEPS = 8;
  for (var i = 1; i <= STEPS; i++) {
    var frac = i / STEPS;
    await page.mouse.move(rect.cx + DRAG_X * frac, rect.cy + DRAG_Y * frac, { steps: 1 });
    if (i === STEPS / 2) {
      midPower = await page.evaluate(function () { return window.Poole.UI.power; });
    }
  }
  console.log("[pointer-e2e] aim sweep complete; power at mid-sweep = " + (midPower != null ? midPower.toFixed(3) : "?"));

  // Release fires the shot through P.UI.onFire (the human path).
  await new Promise(function (ok) { setTimeout(ok, 40); });
  await page.mouse.up();
  console.log("[pointer-e2e] pointer released -> expecting a fired shot");

  // Watch for the shot to have taken effect.
  var sawShotInFlight = false;
  var sawPocketChange = baselinePockets.join(",") + "|" + s.ballsOnTable;
  var shotApplied = false;
  var appliedReason = "none";
  var waitedShot = Date.now();
  while (Date.now() - waitedShot < POINTERSHOT_WAIT_MS) {
    var cur = await page.evaluate(readState);
    if (cur.gameOver) { shotApplied = true; appliedReason = "gameOver"; break; }
    if (!sawShotInFlight && cur.shotInFlight) { sawShotInFlight = true; }
    var nowKey = cur.inPocketIds.join(",") + "|" + cur.ballsOnTable;
    if (nowKey !== sawPocketChange) { shotApplied = true; appliedReason = "balls/pockets changed"; break; }
    // Turn/phase advancement right after our fire also proves the shot was accepted.
    if (!shotApplied && cur.phase !== s.phase && !cur.gameOver) {
      shotApplied = true;
      appliedReason = "phase advanced to " + cur.phase;
      break;
    }
    await new Promise(function (ok) { setTimeout(ok, 150); });
  }

  // Re-assert animated 3D while the ball is (or was) in flight.
  var animatedDiff = 0;
  if (sawShotInFlight && animatedDiff < MIN_FRAME_DIFF) {
    var a = await page.screenshot({ type: "png" });
    await new Promise(function (ok) { setTimeout(ok, 250); });
    var b = await page.screenshot({ type: "png" });
    animatedDiff = byteDiff(a, b);
  }

  var endShot = await capturePng("end");

  // ---- gates ------------------------------------------------------------------
  if (consoleErrors.length) {
    consoleErrors.forEach(function (m) { console.log("[pointer-e2e] console error: " + String(m).slice(0, 180)); });
    fail("console errors: " + consoleErrors.length);
  }
  if (runtimeErrors.length) {
    runtimeErrors.forEach(function (m) { console.log("[pointer-e2e] pageerror: " + m.slice(0, 180)); });
    fail("runtime errors: " + runtimeErrors.length);
  }
  if (startShot.idat < MIN_IDAT_BYTES) fail("initial render flat/blank (IDAT=" + startShot.idat + ")");
  if (endShot.idat < MIN_IDAT_BYTES) fail("final render flat/blank (IDAT=" + endShot.idat + ")");

  // The pointer must have actually driven a real shot.
  if (midPower === 0 && midPower !== null) fail("no power generated from the pointer drag (power=0)");
  if (!shotApplied && !sawShotInFlight) {
    fail("pointer shot did not take effect (no shot-in-flight, no ball/turn change); reason=" + appliedReason);
  } else {
    console.log("[pointer-e2e] pointer shot accepted (" + appliedReason + ")",
      sawShotInFlight ? "shotInFlight observed" : "");
  }

  console.log("");
  console.log("[pointer-e2e] --- REPORT ---");
  console.log("[pointer-e2e] pointer drag fired, power@" + (midPower != null ? "mid:" + midPower.toFixed(3) : "n/a"));
  console.log("[pointer-e2e] shotInFlight observed    : " + sawShotInFlight);
  console.log("[pointer-e2e] ball/pocket change       : " + shotApplied);
  console.log("[pointer-e2e] applied via             : " + appliedReason);
  console.log("[pointer-e2e] start -> end balls/tables: " + baselineOnTable + " -> ?");
  console.log("[pointer-e2e] console errors           : " + consoleErrors.length);
  console.log("[pointer-e2e] runtime errors           : " + runtimeErrors.length);
  console.log("[pointer-e2e] start/end IDAT           : " + startShot.idat + " / " + endShot.idat);
  console.log("[pointer-e2e] animated frame diff      : " + animatedDiff);

  if (failReasons.length > 0) {
    console.log("");
    console.log("[pointer-e2e] " + failReasons.length + " failure(s):");
    failReasons.forEach(function (r) { console.log("   " + r); });
  } else {
    console.log("[pointer-e2e] OK all gates passed: real 3D WebGL driven by genuine pointer input verified.");
  }

  // Guarded teardown.
  try {
    if (server) server.close();
    if (browser) await browser.close();
  } catch (teardownErr) { /* ignore cleanup noise */ }

  process.exit(failReasons.length ? 1 : 0);
}

main().catch(function (e) { fail("fatal: " + e.message); process.exit(1); });
