/* Game: owns the single source-of-truth state and the per-frame loop.
   Wires UI input to human shots, drives the bot on AI turns, applies rules
   outcomes, and paces rendering. Exposed via window.Poole.Game. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  var HUMAN_IDX = 0, BOT_IDX = 1;

  var state = null;          /* the live state object */
  var rafId = null;
  var botTimer = null;
  var groupPickerIdx = -1;   /* player that must pick a group; -1 = none */

  function ballById(id) {
    if (!state) return null;
    for (var i = 0; i < state.balls.length; i++) {
      if (state.balls[i].id === id) return state.balls[i];
    }
    return null;
  }

  /* P.Rules.players is the SAME array as state.players, ordered [human, bot],
     so rules.idx lines up directly. */
  function curIdx() { return state ? P.Rules.idx : -1; }
  function isHumanTurn() { return curIdx() === HUMAN_IDX; }
  function human() { return state ? state.players[HUMAN_IDX] : null; }

  /* Build a fresh 16-ball game. */
  function buildState() {
    var balls = P.Table.rack();                       /* 15 object balls, standard triangle */
    var cue = P.Ball.create("cue", C.CUE_BREAK_POS.x, C.CUE_BREAK_POS.y);
    balls.push(cue);                                  /* cue shares the same array as objects */

    var players = [
      P.Player.make("human", "You"),
      P.Player.make("bot", "Bot")
    ];

    return {
      balls: balls,
      cue: cue,
      players: players,   /* also owned by P.Rules via init() (same reference) */
      shotInFlight: false,
      phase: "break",
      message: "Break the rack - drag from the cue.",
      floats: [],
      floatMessages: [],   /* rising text bubbles (see render) */
      shakeUntil: -9e9,    /* monolith screen-shake deadline in ms */
      gameOver: false,
      winner: null
    };
  }

  /* Read accessor for render. Identity only changes on newGame(). */
  P.State = function () { return state; };

  function newGame() {
    clearBotTimer();
    groupPickerIdx = -1;
    state = buildState();

    P.Rules.init(state.players);                     /* players/idx/phase -> shared players */
    P.Physics.resetShot();
    P.Physics.setBalls(state.balls, state.cue);       /* rules.legalIds reads the live balls */

    P.UI.setState(state);
    P.UI.onFire = onHumanFire;
    P.UI.shootable = true;                           /* rule 4: human breaks first */
    P.UI.botAiming = false;
    updateHUD();
  }

  /* A shot finished by the human (from P.UI). */
  function onHumanFire(shot) {
    if (!state || state.gameOver || !P.UI.shootable) return;
    P.Physics.resetShot();
    state.cue.vx = shot.vx;
    state.cue.vy = shot.vy;
    P.UI.shootable = false;
    P.UI.aiming = false;
    state.shotInFlight = true;
  }

  /* Celebratory burst at a ball's last position. */
  function pushFloat(id) {
    if (!state) return;
    var b = ballById(id);
    if (!b) return;
    for (var n = 0; n < 5; n++) {
      var a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 80;
      state.floats.push({
        x: b.x, y: b.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1.2, lifeMax: 1.2,
        color: "rgba(255, 200, 90, " + (0.4 + Math.random() * 0.6) + ")"
      });
    }
  }

  /* Rising text float over the table + screen shake (the monolith look).
     rgb is an "R,G,B" string; positioned at upper-center of the felt. */
  function popFloat(text, rgb) {
    if (!state || !P.Render) return;
    P.Render.showFloatMsg(text, rgb);
    state.shakeUntil = typeof performance !== "undefined"
      ? performance.now() + C.SHAKE_MS
      : Date.now() + C.SHAKE_MS;
  }

  /* Resolve a shot that has come to rest. */
  function handleShotOutcome() {
    if (!state) return;
    var phys = P.Physics;
    var result = {
      cuePocketed: phys.cuePocketed,
      firstContact: phys.firstContact,
      pocketedThisShot: phys.pocketedThisShot.slice()
    };

    var D = P.Rules.onShotSettled(result);

    /* physical re-positioning required by the decision */
    if (D.respotCue) P.Physics.respot(state.cue, C.CENTER.x, C.CENTER.y);
    if (D.respot8) {
      var e = ballById(8);
      if (e) P.Physics.respot(e, C.CENTER.x, C.CENTER.y);
    }

    for (var i = 0; i < result.pocketedThisShot.length; i++) {
      pushFloat(result.pocketedThisShot[i].id);
    }

    /* Signature floating text + screen shake (monolith feel). */
    if (result.cuePocketed) {
      popFloat("SCRATCH - foul", "255, 96, 74");
    } else if (result.pocketedThisShot.length > 0) {
      var n = result.pocketedThisShot.length;
      popFloat(n === 1 ? "POCKETED!" : n + " POCKETED!", "255, 235, 140");
    }

    /* --- clean win? --- */
    state.gameOver = (D.winner !== null && D.winner !== undefined);
    if (state.gameOver) {
      state.winner = P.Rules.players[D.winner];
      state.message = (state.winner ? state.winner.name : "?") + " wins! Click to play again.";
      popFloat(state.winner.name + " WINS!", "170, 245, 120");
      P.UI.shootable = false;
      P.UI.aiming = false;
      P.UI.botAiming = false;
      updateHUD();
      return;
    }

    /* advance the turn machine */
    P.Rules.applyDecision(D);
    state.phase = P.Rules.phase;

    if (state.phase === "chooseGroup") {
      showGroupPicker(HUMAN_IDX);     /* only the human breaks, so it's always the breaker's pick */
      return;
    }

    P.UI.shootable = false;
    P.UI.aiming = false;
    if (isHumanTurn()) {
      P.UI.shootable = true;
      state.message = human().name + " - your group " + (P.Rules.players[HUMAN_IDX].group ? P.Rules.players[HUMAN_IDX].group : "(open)") + ".";
    } else {
      scheduleBotShot();
      state.message = "Bot is taking their shot...";
    }
    updateHUD();
  }

  /* short think delay, then fire the bot's chosen shot */
  function scheduleBotShot() {
    if (!state || state.gameOver) return;
    P.UI.shootable = false;
    clearBotTimer();

    /* Pre-compute the chosen shot and expose it as a cue-stick overlay so the
       bot's aim is visible across its think window. fireBotShot fires the same
       plan, so the preview always matches the ball that actually moves. */
    var legal = P.Rules.legalIds();
    var planned = P.Bot.bestShot(state.balls, state.cue, legal);
    if (planned) {
      P.UI.botAiming = true;
      var dl = Math.hypot(planned.vx, planned.vy) || 1;
      var k = 240;                                  /* distance to the virtual pointer side */
      P.UI.botAimX = state.cue.x - (planned.vx / dl) * k;
      P.UI.botAimY = state.cue.y - (planned.vy / dl) * k;
      P.UI.botPower = typeof planned.power === "number" ? planned.power : 0.7;
    }

    botTimer = setTimeout(fireBotShot, 600 + Math.random() * 800);
  }

  function clearBotTimer() { if (botTimer) { clearTimeout(botTimer); botTimer = null; } }

  function fireBotShot() {
    if (!state || state.gameOver || P.UI.shootable) return;
    P.UI.botAiming = false;          /* ball is now in motion; stop the aim preview */
    P.Physics.resetShot();
    var legal = P.Rules.legalIds();            /* from the shared ball list */
    var shot = P.Bot.bestShot(state.balls, state.cue, legal);
    if (!shot) {                               /* no clear shot: a modest random knock (may foul, by design) */
      var a = Math.random() * Math.PI * 2;
      shot = { vx: Math.cos(a) * C.MAX_SHOT_SPEED * 0.4, vy: Math.sin(a) * C.MAX_SHOT_SPEED * 0.4, power: 0.4 };
    }
    state.cue.vx = shot.vx;
    state.cue.vy = shot.vy;
    state.shotInFlight = true;
    P.UI.shootable = false;
    state.message = "Bot is taking their shot...";
  }

  /* HUD (DOM owned by the game, not the UI module). */
  function updateHUD() {
    /* Non-browser contexts (Node e2e): the name "document" is never declared there,
       so we test with typeof instead of negation, which would throw. */
    if (typeof document === "undefined") return;
    var turnEl = document.getElementById("turn");
    var msgEl = document.getElementById("msg");
    if (!turnEl && !msgEl) return;            /* not in DOM yet */

    var grEl = document.getElementById("groups");
    var hintEl = document.getElementById("break-hint");
    var pickWrap = document.getElementById("group-pick-wrap");
    var againBtn = document.getElementById("play-again");

    /* The break-group picker is invisible (display:none, no hit-tests) until the
       human must choose a group. Hiding the whole wrapper - not just the two
       buttons - also prevents transparent buttons from still swallowing clicks. */
    var pickActive = groupPickerIdx >= 0;
    if (pickWrap) {
      pickWrap.style.display = pickActive ? "flex" : "none";
      pickWrap.style.opacity = pickActive ? "1" : "0";
      pickWrap.style.pointerEvents = pickActive ? "auto" : "none";
    }
    if (againBtn) againBtn.style.display = state.gameOver ? "inline-block" : "none";

    if (turnEl) turnEl.textContent = isHumanTurn() ? "You" : "Bot";
    if (hintEl) {
      hintEl.style.display = (state.phase === "break") ? "" : "none";
      hintEl.textContent = "Drag from the cue to break.";
    }
    if (msgEl) msgEl.textContent = state.message;

    var gr = P.Rules.players;
    if (grEl && gr) {
      grEl.textContent =
        "You: " + (gr[HUMAN_IDX].group ? gr[HUMAN_IDX].group : "-") +
        "   Bot: " + (gr[BOT_IDX].group ? gr[BOT_IDX].group : "-");
    }
  }

  /* Human breaker chooses a group (break pocketed a color). */
  function showGroupPicker(idx) {
    groupPickerIdx = idx;
    P.UI.shootable = false;
    if (idx === HUMAN_IDX) {
      state.message = "You pocketed a ball on the break - choose your group.";
      updateHUD();
    } else {
      /* bot auto-picks (unreachable while only human breaks) */
      var g = Math.random() < 0.5 ? "SOLID" : "STRIPE";
      P.Rules.players[idx].group = g;
      P.Rules.players[1 - idx].group = (g === "SOLID") ? "STRIPE" : "SOLID";
      continueBotOrHumanTurn();
    }
  }

  /* After a group picker resolves, set up the next shot. The picker is the
     only path that leaves P.Rules.phase at "chooseGroup", so re-sync
     state.phase to normal play — nothing else reads it in this branch. */
  function continueBotOrHumanTurn() {
    if (!state || state.gameOver) return;
    P.UI.shootable = false;
    P.UI.aiming = false;
    P.UI.botAiming = false;
    state.phase = "between";   /* picker resolved -> normal turn play resumes */
    if (isHumanTurn()) {
      P.UI.shootable = true;
      state.message = human().name + " - you play " + P.Rules.players[HUMAN_IDX].group + ".";
    } else {
      scheduleBotShot();
      state.message = "Bot is taking their shot...";
    }
    updateHUD();
  }

  /* Wired from the DOM by main.js. */
  function chooseGroup(side) {
    if (groupPickerIdx !== HUMAN_IDX) return;   /* only the breaker picks */
    groupPickerIdx = -1;
    P.Rules.players[HUMAN_IDX].group = side;
    P.Rules.players[BOT_IDX].group = (side === "SOLID") ? "STRIPE" : "SOLID";
    state.message = human().name + " - you play " + side + ".";
    continueBotOrHumanTurn();
  }

  function resetAll() { newGame(); }

  /* main game loop */
  function tick() {
    rafId = requestAnimationFrame(tick);
    if (!state) return;
    var ctx = P._renderCtx;

    if (state.gameOver) {
      P.Render.draw(ctx);                       /* static end-screen overlay */
    } else {
      if (state.shotInFlight) {
        var phys = P.Physics;
        if (phys.anyMoving()) {
          phys.integrateStep(C.STEP);
        } else {
          state.shotInFlight = false;
          handleShotOutcome();
        }
      }
      P.Render.draw(ctx);
    }

    if (!state.gameOver && !P.UI.shootable) updateHUD();
  }

  function start(canvas) {
    var ctx = canvas.getContext("2d");
    P._renderCtx = ctx;
    P.UI.attach(canvas);
    P.Table.fit(canvas, W.innerWidth, W.innerHeight);
    newGame();
    W.addEventListener("resize", onResize);
    rafId = requestAnimationFrame(tick);
  }

  function onResize() {
    if (!P._renderCtx || !P._renderCtx.canvas) return;
    P.Table.fit(P._renderCtx.canvas, W.innerWidth, W.innerHeight);
  }

  /* Expose the whole API on window.Poole.Game. `tick` is exported so the headless
     (Node) e2e can drive the render loop deterministically; in the browser,
     start() owns the rAF loop and only it invokes tick(). */
  P.Game = { start: start, newGame: newGame, reset: resetAll, chooseGroup: chooseGroup, tick: tick };
})();
