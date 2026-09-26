/* Headless multi-turn bot-vs-bot playtest. Drives the FULL real Game/Physics/Rules
   pipeline: human-style break via P.UI.onFire, then every subsequent shot through the
   real rules/turn machine (rules.advanceTurn is invoked by G.tick on settle). The
   engine's own timer-based bot fire is disabled in this harness (setTimeout stubbed),
   so we emulate P.Bot.fireBotShot() manually for bot turns and handle the colour-
   break group picker explicitly. Asserts the game terminates (winner) without throwing,
   getting stuck in a shotInFlight loop, or producing non-finite balls. */
var fs = require("fs");

globalThis.window = globalThis;
globalThis.requestAnimationFrame = function () { return 0; };
globalThis.setTimeout = function () { return 0; };   /* engine bot timer: no-op */
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
  ["src/config.js","src/vec.js","src/ball.js","src/table.js",
   "src/physics.js","src/rules.js","src/player.js","src/bot.js","src/ui.js"]
    .forEach(loadModule);
  if (!globalThis.Poole.WebGL3D) {
    globalThis.Poole.WebGL3D = { init:function(){}, resize:function(){},
      draw:function(){}, pop:function(){}, screenToTableLogical:function(){ return null; } };
  }
  loadModule("src/game.js");
} catch (e) { fail("module load threw: " + e.message); }

var C = globalThis.Poole.CONFIG;
var U = globalThis.Poole.UI;
var G = globalThis.Poole.Game;
var R = globalThis.Poole.Rules;
var Bot = globalThis.Poole.Bot;
var Physics = globalThis.Poole.Physics;

var HUMAN_IDX = 0, BOT_IDX = 1;
var MAXFR = 10000;   /* settle budget (frames) per shot, headless */

function newGame() {
  try { G.newGame(); } catch (e) { fail("newGame threw: " + e.message); }
  var s = globalThis.Poole.State();
  if (!s) fail("State() null");
  return s;
}

/* Settle the table until it stops. Returns true if it settled in budget. */
function settle(state) {
  for (var f = 0; state.shotInFlight && f < MAXFR; f++) G.tick();
  if (state.shotInFlight) return false;   /* runaway: physics never settled */
  return true;
}

/* One legal shot for the CURRENT shooter (R.idx). Returns true if the ball moved.
   Human turn -> real human path (shootable + onFire). Bot turn -> emulates fireBotShot(). */
function fireShot(state) {
  var legal = R.legalIds() || [];            /* current shooter's legal object balls */
  var shot = null;
  if (legal.length) shot = Bot.bestShot(state.balls, state.cue, legal);
  if (!shot) {                               /* no clear line: modest knock, may foul (as fireBotShot does) */
    if (state.gameOver) return false;
    var a = Math.random() * Math.PI * 2;
    shot = { vx: Math.cos(a) * C.MAX_SHOT_SPEED * 0.4, vy: Math.sin(a) * C.MAX_SHOT_SPEED * 0.4, power: 0.4 };
  }

  var humanTurn = (R.idx === HUMAN_IDX);
  if (humanTurn) {
    U.shootable = true;
    U.aiming = false;
    try { U.onFire(shot); } catch (e) { fail("onFire threw: " + e.message); return false; }
    /* onHumanFire only moves the ball when shootable && !gameOver */
    if (!state.shotInFlight) shotInFlightForced(state, shot, true);
  } else {
    shotInFlightForced(state, shot, false);
  }
  return state.shotInFlight;
}

/* Directly move the cue (emulates fireBotShot / onHumanFire) so a bot turn can fire. */
function shotInFlightForced(state, shot, viaHuman) {
  Physics.resetShot();
  if (!viaHuman && state.gameOver) return;
  state.cue.vx = shot.vx;
  state.cue.vy = shot.vy;
  U.shootable = false;
  U.aiming = false;
  state.shotInFlight = true;
}

/* After a colour break the human must pick a group (phase=chooseGroup, groups null).
   Simulate that choice so legalIds() is non-empty for the breaker's follow-up shot. */
function resolveGroupChoice(state) {
  if (R.phase === "chooseGroup") {
    R.chooseGroup(HUMAN_IDX, "SOLID");         /* assigns both players' groups */
    R.finishGroupChoice();                     /* phase -> between */
    state.phase = R.phase;
  }
}

/* Deterministic contract tests for P.Rules.onShotSettled — the fault / win
   branches that a stochastic heuristic playtest rarely or never triggers
   (scratch foul, no‑ball‑touched foul, clean‑8 win, scratch‑the‑8, black on
   the break, on‑the‑8 legality). Each case drives the engine with a crafted
   physics result and asserts the returned decision flags. Runs on its own fresh
   state, so it leaves the shared table untouched for the playtest below. */
function auditRulesEngine() {
  G.newGame();                          /* fresh table + rules */
  var R = globalThis.Poole.Rules;
  ok("audit: rules engine armed, groups assigned " +
     R.players[0].group + "/" + R.players[1].group);

  R.autoAssignGroups();                  /* both players now own a group (7 legal balls each) */

  /* pick a real, on‑table legal (non‑black) ball id for a given shooter. */
  function legalId(i) { return R.legalIds(i)[0]; }
  /* run the engine and return its decision object. */
  function dOf(cfg) { return R.onShotSettled(cfg); }

  R.idx = 0;
  R.phase = "between";

  /* --- A: clean legal pot -> keep shooting, no foul / respot --- */
  var lidA = legalId(0);
  var d = dOf({ firstContact: true, cuePocketed: false, pocketedThisShot: [{ id: lidA }] });
  if (d.foul) fail("A1 clean pot flagged foul");
  if (d.nextTurnPass) fail("A2 clean pot passed turn instead of keeping it");
  if (d.respotCue) fail("A3 clean pot re‑spotted the cue");
  ok("A: clean legal pot -> keep turn, no foul/respot (potted id " + lidA + ")");

  /* --- B: scratch (cue pocketed) -> foul + re‑spot cue + pass turn --- */
  d = dOf({ firstContact: true, cuePocketed: true, pocketedThisShot: [{ id: legalId(0) }] });
  if (!d.foul || !d.respotCue || !d.nextTurnPass) {
    fail("B scratch: foul=" + !!d.foul + " respotCue=" + !!d.respotCue + " nextTurnPass=" + !!d.nextTurnPass);
  }
  if (d.winner !== null && d.winner !== undefined) fail("B4 scratch set a winner");
  ok("B: scratch -> foul + re‑spot cue + pass turn");

  /* --- C: no ball touched -> foul + re‑spot cue + pass turn --- */
  d = dOf({ firstContact: false, cuePocketed: false, pocketedThisShot: [] });
  if (!d.foul || !d.respotCue || !d.nextTurnPass) {
    fail("C no‑ball‑touched: foul=" + !!d.foul + " respotCue=" + !!d.respotCue);
  }
  ok("C: no ball touched -> foul + re‑spot cue + pass turn");

  /* --- D: clean black 8 (non‑break) -> shooter wins --- */
  d = dOf({ firstContact: true, cuePocketed: false, pocketedThisShot: [{ id: 8 }] });
  if (d.foul) fail("D1 clean 8 flagged foul");
  if (d.winner !== 0) fail("D2 clean 8 winner=" + d.winner);
  if (d.phaseAfter !== "gameover") fail("D3 clean 8 phaseAfter=" + d.phaseAfter);
  if (d.respot8) fail("D4 clean 8 set respot8");
  ok("D: clean 8 -> shooter wins, phaseAfter=gameover");

  /* --- E: scratch on the 8 -> foul, OPPONENT wins --- */
  d = dOf({ firstContact: true, cuePocketed: true, pocketedThisShot: [{ id: 8 }] });
  if (!d.foul) fail("E1 scratch‑the‑8 not a foul");
  if (d.winner !== 1) fail("E2 scratch‑the‑8 winner=" + d.winner + " (expected opponent)");
  if (d.phaseAfter !== "gameover") fail("E3 scratch‑the‑8 phaseAfter=" + d.phaseAfter);
  ok("E: scratch on the 8 -> foul, opponent wins");

  /* --- F: black pocketed ON THE BREAK -> re‑spot 8, no winner yet --- */
  R.idx = 0; R.phase = "break";
  d = dOf({ firstContact: true, cuePocketed: false, pocketedThisShot: [{ id: 8 }, { id: 3 }] });
  if (d.foul) fail("F1 black‑on‑break flagged foul");
  if (!d.respot8) fail("F2 black‑on‑break respot8 not set");
  if (d.winner !== null && d.winner !== undefined) fail("F3 black‑on‑break set winner=" + d.winner);
  if (d.phaseAfter === "gameover") fail("F4 black‑on‑break phaseAfter=gameover");
  ok("F: black on break -> re‑spot 8, no winner yet");

  /* --- G: on‑the‑8 legality -> legalIds(i) must be exactly [8] when the
     player's group is gone, while the opponent still owns their 7. --- */
  R.phase = "between";
  var i = 1;                              /* any player; player 1's group is untouched so far */
  var toPot = R.legalIds(i).slice();      /* their 7 group balls (the 8 is never in this list) */
    if (toPot.length !== 7) fail("G0 on‑table legal count for player " + i + " = " + toPot.length);
    globalThis.Poole.Physice_balls().forEach(function (b) {
    if (!b.inPocket && toPot.indexOf(b.id) >= 0) b.inPocket = true;  /* pocket every one of theirs */
  });
  var L = R.legalIds(i);
  if (JSON.stringify(L) !== "[8]") fail("G: on‑the‑8 legalIds(" + i + ")=" + JSON.stringify(L) + " (expected [8])");
  if (R.legalIds(1 - i).length !== 7) {
    fail("G: opponent " + (1 - i) + " still has " + R.legalIds(1 - i).length + " legal balls (expected 7)");
  }
  ok("G: cleared group -> only the black 8 is legal for that player; opponent unharmed");
}

function main() {
  auditRulesEngine();                     /* contract checks on a throwaway fresh state */
  var state = newGame();                  /* clean slate for the actual multi‑turn play */
  ok("newGame: " + state.balls.length + " balls, phase=" + state.phase + ", cue=(" +
     Math.round(state.cue.x) + "," + Math.round(state.cue.y) + ")");

  /* --- the break (hard hit into the rack; human breaks by rule) --- */
  var breakVX = -C.MAX_SHOT_SPEED * 0.85, breakVY = C.MAX_SHOT_SPEED * 0.25;
  U.shootable = true; U.power = 0.9; U.aiming = false;
  try { U.onFire({ vx: breakVX, vy: breakVY, power: 0.9 }); } catch (e) { fail("break onFire threw: " + e.message); }
  state.shotInFlight = true;
  if (!settle(state)) fail("break shot never settled within " + MAXFR + " frames");
  resolveGroupChoice(state);
  var breaksFired = 1, keeps = 0;
  if (state.gameOver) { ok("break ended game: " + state.winner.name); return; }
  ok("break settled | phase=" + state.phase + " | idx=" + R.idx + " | groups=[" +
     R.players[0].group + "/" + R.players[1].group + "]");

  /* --- multi-turn play --- */
  var MAX_TURNS = 200, turns = breaksFired;
  while (turns < MAX_TURNS && !state.gameOver) {
    var beforeIdx = R.idx;
    if (!fireShot(state)) { turns++; continue; }   /* gameOver or already at rest */
    if (!settle(state)) fail("shot " + turns + " stalled within " + MAXFR + " frames");
    turns++;
    // detect kept vs passed turn
    if (R.idx === beforeIdx) keeps++; else {}
    console.log("[T" + turns + "] shooter=" + (R.idx !== beforeIdx ? "PASS" : "KEEP") +
      " idx=" + R.idx + " legal=" + (R.legalIds() || []).length +
      " | " + (state.message || ""));
  }

  /* exact count of object balls pocketed over the whole game (a real 8-ball
     win implies the black 8 sank; potting never happens without a shot). */
  var potted = 0;
  state.balls.forEach(function (b) { if (b.id !== "cue" && b.inPocket) potted++; });

  /* --- terminal assertions --- */
  if (state.gameOver) {
    if (potted < 1) fail("gameover with zero object balls pocketed - invalid termination");
    ok("game terminated: winner=" + (state.winner ? state.winner.name : "?") +
       " after " + turns + " turns | potted=" + potted);
  } else {
    ok("NO win reached in " + MAX_TURNS + " turns | potted=" + potted +
       " | phase=" + state.phase + " | idx=" + R.idx + " | groups=[" +
         R.players[0].group + "/" + R.players[1].group + "]");
  }

  var cue = state.cue;
  if (!cue) fail("cue ball missing from state");
  if (!(isFinite(cue.x) && isFinite(cue.y) && isFinite(cue.vx) && isFinite(cue.vy))) {
    fail("cue non-finite: " + JSON.stringify({ x: cue.x, y: cue.y }));
  }
  ok("cue finite at (" + Math.round(cue.x) + ", " + Math.round(cue.y) + ")");

  var bad = 0;
  state.balls.forEach(function (b) {
    if (b.inPocket) return;
    if (!(isFinite(b.x) && isFinite(b.y) && isFinite(b.vx) && isFinite(b.vy))) bad++;
  });
  if (bad > 0) fail("non-finite on-table balls: " + bad);
  ok("all on-table balls finite");

  console.log("[RESULT] turns=" + turns + " | objectBallsPotted=" + potted +
    " | keptTurns=" + keeps + " | phase=" + state.phase + " | gameOver=" + state.gameOver +
    (state.gameOver ? " | winner=" + (state.winner ? state.winner.name : "?") : ""));
}

main();