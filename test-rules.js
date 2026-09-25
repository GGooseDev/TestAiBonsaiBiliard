/* Node smoke test for rules engine. Run: node test-rules.js */
globalThis.window = globalThis.window || {};
const path = require("path");
["config", "vec", "ball", "table", "physics", "player", "rules"]
  .map(function (n) { return path.join(__dirname, "src", n + ".js"); })
  .forEach(function (p) { require(p); });

var P = window.Poole;
var C = P.CONFIG;
function A(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

/* Fake physics stub — the rules engine only reads these fields. */
function fakePhys(opts) {
  opts = opts || {};
  return {
    firstContact: (opts.firstContact !== undefined) ? opts.firstContact : true,
    cuePocketed: (opts.cuePocketed !== undefined) ? opts.cuePocketed : false,
    pocketedThisShot: (opts.pocketedThisShot || []).map(function (id) { return { id: id }; })
  };
}

/* Build a full ball list + a cue, and register it with the physics so
   the rules engine (which reads P.Physice_balls()) sees it. */
function controlled() {
  var balls = [];
  function b(id) { balls.push(P.Ball.create(id, 20 + (id % 5) * 30, 20 + Math.floor(id / 5) * 30)); }
  for (var i = 1; i <= 15; i++) b(i);
  var cue = P.Ball.create("cue", (C.IX0 + C.IX1) / 2, C.IY1 - 6 * C.BR);
  balls.push(cue);
  P.Physics.setBalls(balls, cue);   /* cue is always the last ball */
  return { balls: balls, cue: cue };
}

/* Fresh game: init the rules engine on two players. */
function initGame(players) { P.Rules.init(players); }

function setGroup(i, g) { P.Rules.players[i].group = g; }

/* Put the engine into a normal (non-break) turn without a real shot. */
function enterNormalTurn() { P.Rules.phase = "between"; P.Rules.isBreak = false; }

/* Two players: human breaker + bot, per the MD (human always breaks first). */
function newPlayers() { return [P.Player.make("human", "You"), P.Player.make("bot", "Bot")]; }

/* ------------------------------------------------------------------ */
/* 1. Empty break -> random groups, turn passes to opponent            */
(function () {
  initGame(newPlayers());
  controlled();
  var D = P.Rules.onShotSettled(fakePhys({ pocketedThisShot: [] }));
  P.Rules.applyDecision(D);
  A(P.Rules.phase === "between", "after empty break -> between (got " + P.Rules.phase + ")");
  A(P.Rules.idx === 1, "turn passed to player1 (idx=" + P.Rules.idx + ")");
  A(P.Rules.players[0].group !== null && P.Rules.players[1].group !== null, "groups assigned");
  A(P.Rules.players[0].group !== P.Rules.players[1].group, "groups differ");
  console.log("T1 empty break OK: groups=" + JSON.stringify([P.Rules.players[0].group, P.Rules.players[1].group]));
})();

/* ------------------------------------------------------------------ */
/* 2. Break pockets a colour, human breaker -> group choice prompt      */
(function () {
  initGame(newPlayers());
  controlled();
  var D = P.Rules.onShotSettled(fakePhys({ pocketedThisShot: [1] }));
  P.Rules.applyDecision(D);
  A(P.Rules.phase === "chooseGroup", "human breaker chooses group (phase=" + P.Rules.phase + ")");
  A(P.Rules.idx === 0, "breaker keeps turn while choosing");
  A(P.Rules.players[0].group === null && P.Rules.players[1].group === null, "no auto-group for human chooser");
  P.Rules.chooseGroup(0, "SOLID");
  P.Rules.finishGroupChoice();
  A(P.Rules.phase === "between", "after choice -> between");
  A(P.Rules.players[0].group === "SOLID" && P.Rules.players[1].group === "STRIPE", "groups set by choice");
  console.log("T2 colour break -> chooseGroup OK");
})();

/* ------------------------------------------------------------------ */
/* 3. Normal shot: scratch only -> foul, respot cue, pass              */
(function () {
  initGame(newPlayers()); var g = controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ cuePocketed: true, pocketedThisShot: [] }));
  A(D.foul === true, "scratch is foul");
  A(D.respotCue === true, "cue respotted");
  A(D.nextTurnPass === true, "turn passes after scratch");
  console.log("T3 scratch OK");
})();

/* ------------------------------------------------------------------ */
/* 4. Normal shot: no contact -> foul, respot cue, pass                */
(function () {
  initGame(newPlayers()); controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ firstContact: false }));
  A(D.foul === true, "no-contact is foul");
  A(D.respotCue === true, "cue respotted on miss");
  A(D.nextTurnPass === true, "turn passes after miss");
  console.log("T4 no-contact OK");
})();

/* ------------------------------------------------------------------ */
/* 5. Normal shot: pockets legal ball -> keep turn                     */
(function () {
  initGame(newPlayers()); controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ pocketedThisShot: [3] }));
  A(D.nextTurnPass === false, "legal pocket -> keep");
  P.Rules.applyDecision(D);
  A(P.Rules.idx === 0, "keeper keeps turn (idx=" + P.Rules.idx + ")");
  console.log("T5 legal pocket -> keep OK");
})();

/* ------------------------------------------------------------------ */
/* 6. Normal shot: pockets opponent ball only -> pass                  */
(function () {
  initGame(newPlayers()); controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ pocketedThisShot: [9] }));
  A(D.nextTurnPass === true, "opponent-only pocket -> pass");
  P.Rules.applyDecision(D);
  A(P.Rules.idx === 1, "turn passed to opponent");
  console.log("T6 opponent ball -> pass OK");
})();

/* ------------------------------------------------------------------ */
/* 7. Clean 8 (no scratch) -> shooter wins                              */
(function () {
  initGame(newPlayers()); controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ pocketedThisShot: [3, 8] }));
  A(D.winner === 0, "clean 8 -> shooter wins");
  P.Rules.applyDecision(D);
  A(P.Rules.phase === "gameover", "gameover after clean 8");
  console.log("T7 clean 8 win OK");
})();

/* ------------------------------------------------------------------ */
/* 8. Scratch + 8 -> opponent wins                                       */
(function () {
  initGame(newPlayers()); controlled(); enterNormalTurn();
  setGroup(0, "SOLID"); setGroup(1, "STRIPE");
  var D = P.Rules.onShotSettled(fakePhys({ cuePocketed: true, pocketedThisShot: [8] }));
  A(D.winner === 1, "scratch+8 -> opponent wins");
  A(D.foul === true, "scratch+8 flagged foul");
  P.Rules.applyDecision(D);
  A(P.Rules.phase === "gameover", "gameover after scratch+8");
  console.log("T8 scratch+8 lose OK");
})();

/* ------------------------------------------------------------------ */
/* 9. legalIds / onTheEight                                            */
(function () {
  initGame(newPlayers()); var g = controlled();
  for (var i = 9; i <= 15; i++) { g.balls.find(function (b) { return b.id === i; }).inPocket = true; }
  P.Rules.players[0].group = "SOLID";
  var ids = P.Rules.legalIds(0);
  A(ids.indexOf(1) >= 0 && ids.indexOf(2) >= 0 && ids.indexOf(3) >= 0, "solids in list: " + JSON.stringify(ids));
  A(ids.indexOf(8) < 0, "8 not legal until group cleared");
  for (var s = 1; s <= 7; s++) { g.balls.find(function (b) { return b.id === s; }).inPocket = true; }
  A(P.Rules.onTheEight(0) === true, "on the black after clearing solids");
  var ids8 = P.Rules.legalIds(0);
  A(ids8.length === 1 && ids8[0] === 8, "only the 8 legal: " + JSON.stringify(ids8));
  console.log("T9 legalIds/onTheEight OK -> group phase list:", JSON.stringify(ids));
})();

console.log("ALL rules tests PASSED");