/* Battle Arena: a turn-based "Cue vs Balls" mode. Each turn the ball-players
   reposition for C.ARENA_MOVE_TIME_MS, then the cue side fires one shot. Cue
   wins by pocketing all characters before the turn limit; Balls win by surviving
   it. Exposed via window.Poole.Arena. Headless-safe (no THREE required). */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  /* internal state */
  var active = false;
  var state = null;          /* live arena state; mirrored on P.Arena.state */
  var _chars = [];           /* { id, ball, char } — the character balls */
  var _canvas = null;
  var _onBack = null;
  var _rafId = null;
  var _lastT = null;
  var _dom = null;
  var _myAiming = false;
  var _keys = {};

  var raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;

  function makeState() {
    return {
      phase: "teamSelect",
      humanTeam: null,       /* 'cue' | 'balls' */
      turn: 1,
      moveLeftMs: C.ARENA_MOVE_TIME_MS,
      balls: [],
      cue: null,
      chars: [],
      activeCharIdx: 0,
      winner: null,
      shotInFlight: false
    };
  }

  function newBalls() {
    var balls = P.Table.rack();
    var cue = P.Ball.create("cue", C.CUE_BREAK_POS.x, C.CUE_BREAK_POS.y);
    balls.push(cue);
    return { balls: balls, cue: cue };
  }

  function setPhase(p) { state.phase = p; updateDom(); }

  /* ---- movement keys (normalized to lowercase) ---- */
  var KEY_MAP = {
    arrowup: { x: 0, y: -1 }, arrowdown: { x: 0, y: 1 },
    arrowleft: { x: -1, y: 0 }, arrowright: { x: 1, y: 0 },
    w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 }
  };

  function clampBall(b) {
    b.x = Math.max(C.IX0 + C.BR, Math.min(C.IX1 - C.BR, b.x));
    b.y = Math.max(C.IY0 + C.BR, Math.min(C.IY1 - C.BR, b.y));
  }

  function separateBalls(A, B) {
    var dx = A.x - B.x, dy = A.y - B.y;
    var d = Math.hypot(dx, dy);
    var min = C.BR * 2;
    if (d < min) {
      if (d > 1e-6) {
        var push = (min - d) / 2;
        A.x += (dx / d) * push; A.y += (dy / d) * push;
        B.x -= (dx / d) * push; B.y -= (dy / d) * push;
      } else {
        A.x += C.BR * 0.5; B.x -= C.BR * 0.5;
      }
      clampBall(A); clampBall(B);
    }
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---- character update during ballMove ---- */
  function updateChars(dt) {
    for (var i = 0; i < _chars.length; i++) {
      var c = _chars[i], b = c.ball;
      if (b.inPocket) continue;
      var dir = null;
      if (state.humanTeam === "balls" && i === state.activeCharIdx) {
        var kx = 0, ky = 0;
        for (var kc in _keys) {
          var mv = KEY_MAP[kc];
          if (mv) { kx += mv.x; ky += mv.y; }
        }
        if (kx || ky) dir = { x: kx, y: ky };
      } else {
        /* bot wander: pick a new target once the current one is reached */
        if (!c.targetX || Math.hypot(b.x - c.targetX, b.y - c.targetY) < C.BR * 2) {
          c.targetX = rand(C.IX0 + C.BR, C.IX1 - C.BR);
          c.targetY = rand(C.IY0 + C.BR, C.IY1 - C.BR);
        }
        var dx = c.targetX - b.x, dy = c.targetY - b.y;
        var d = Math.hypot(dx, dy) || 1;
        dir = { x: dx / d, y: dy / d };
      }
      if (dir) {
        var s = C.ARENA_CHAR_SPEED * dt;
        b.x += dir.x * s; b.y += dir.y * s;
        clampBall(b);
      }
    }
    /* keep characters from overlapping each other */
    for (var i2 = 0; i2 < _chars.length; i2++) {
      var A = _chars[i2].ball; if (A.inPocket) continue;
      for (var j = i2 + 1; j < _chars.length; j++) {
        var B = _chars[j].ball; if (B.inPocket) continue;
        separateBalls(A, B);
      }
    }
  }

  /* ---- spawn characters on random surviving object balls ---- */
  function spawnChars(balls) {
    var survivors = [];
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (!b.inPocket && P.Ball.isObject(b.id)) survivors.push(b);
    }
    for (var k = survivors.length - 1; k > 0; k--) {
      var j = Math.floor(Math.random() * (k + 1));
      var t = survivors[k]; survivors[k] = survivors[j]; survivors[j] = t;
    }
    var picked = survivors.slice(0, C.ARENA_CHAR_COUNT);
    _chars = [];
    for (var i = 0; i < picked.length; i++) {
      var b = picked[i];
      var ch = null;
      if (P.Character) { try { ch = P.Character.create({ ballId: String(b.id) }); } catch (e) { ch = null; } }
      _chars.push({ id: b.id, ball: b, char: ch });
    }
    _chars.forEach(function (c) { if (c.char) c.char.setTransform("char"); });
    state.chars = _chars;
    return _chars.length;
  }

  /* ---- phase transitions ---- */
  function startBreak() {
    setPhase("break");
    P.Physics.resetShot();
    var c = state.cue;
    var dx = C.CENTER.x - c.x, dy = C.CENTER.y - c.y;
    var d = Math.hypot(dx, dy) || 1;
    var spd = C.MAX_SHOT_SPEED * 0.85;
    c.vx = (dx / d) * spd; c.vy = (dy / d) * spd;
    state.shotInFlight = true;
  }

  function onBreakSettled() {
    state.shotInFlight = false;
    var n = spawnChars(state.balls);
    if (n === 0) { endGame("cue"); return; }   /* nothing left to defend */
    resetTurn();
    setPhase("ballMove");
  }

  function startCueShot() {
    state.shotInFlight = false;
    if (state.humanTeam === "cue") return;      /* human shoots via pointer */
    fireBotShot();
  }

  function fireBotShot() {
    var ids = [];
    for (var i = 0; i < _chars.length; i++) if (!_chars[i].ball.inPocket) ids.push(_chars[i].ball.id);
    if (!ids.length) return;
    var shot = P.Bot.bestShot(state.balls, state.cue, ids);
    if (!shot) return;
    P.Physics.resetShot();
    state.cue.vx = shot.vx; state.cue.vy = shot.vy;
    state.shotInFlight = true;
  }

  function fireHumanShot(shot) {
    P.Physics.resetShot();
    state.cue.vx = shot.vx; state.cue.vy = shot.vy;
    state.shotInFlight = true;
  }

  function onShotSettled() {
    var phys = P.Physics;
    if (phys.cuePocketed || state.cue.inPocket) respotCue();
    var alive = 0;
    for (var i = 0; i < _chars.length; i++) if (!_chars[i].ball.inPocket) alive++;
    if (alive === 0) { endGame("cue"); return; }
    if (state.turn >= C.ARENA_MAX_TURNS) { endGame("balls"); return; }
    state.turn += 1;
    resetTurn();
    setPhase("ballMove");
  }

  function respotCue() {
    var c = state.cue;
    c.inPocket = false; c.x = C.CENTER.x; c.y = C.CENTER.y; c.vx = 0; c.vy = 0;
  }

  function resetTurn() {
    state.moveLeftMs = C.ARENA_MOVE_TIME_MS;
    state.activeCharIdx = 0;
    _chars.forEach(function (c) { c.targetX = null; c.targetY = null; });
  }

  function endGame(winner) {
    state.winner = winner;
    setPhase("gameOver");
  }

  /* ---- rAF simulation loop ---- */
  function tick(dt) {
    if (!active || !state) return;
    dt = Math.min(dt, 0.1);
    switch (state.phase) {
      case "break":
        if (P.Physics.anyMoving()) P.Physics.integrateStep(C.STEP);
        else onBreakSettled();
        break;
      case "ballMove":
        updateChars(dt);
        state.moveLeftMs -= dt * 1000;
        if (state.moveLeftMs <= 0) {
          state.moveLeftMs = 0;
          setPhase("cueShot");
          startCueShot();
        }
        break;
      case "cueShot":
        if (state.shotInFlight) {
          if (P.Physics.anyMoving()) P.Physics.integrateStep(C.STEP);
          else onShotSettled();
        }
        break;
      case "gameOver":
        break;
    }
  }

  function loop(t) {
    _rafId = raf(t);
    var dt = _lastT == null ? 0 : (t - _lastT) / 1000;
    _lastT = t;
    tick(dt);
  }

  /* ---- pointer aim (own listeners; classic UI is kept inert below) ---- */
  function canHumanShoot() {
    return active && state && state.phase === "cueShot" && state.humanTeam === "cue" && !state.shotInFlight;
  }

  function toLogical(e) {
    var x = e.clientX, y = e.clientY;
    if (P.WebGL3D && state.cue) {
      var h = P.WebGL3D.screenToTableLogical(x, y, state.cue.x, state.cue.y);
      if (h && isFinite(h.x) && isFinite(h.y)) return h;
    }
    var cr = _canvas.getBoundingClientRect ? _canvas.getBoundingClientRect() : null;
    var sx = x - (cr ? cr.left : 0), sy = y - (cr ? cr.top : 0);
    return { x: (sx - P.Table.offX) / P.Table.size, y: (sy - P.Table.offY) / P.Table.size };
  }

  function updatePowerPreview() {
    var c = state.cue;
    if (!c) { P.UI.power = 0; return; }
    var d = Math.hypot(P.UI.aimX - c.x, P.UI.aimY - c.y);
    P.UI.power = Math.max(0, Math.min(1, d / C.POWER_MAX_DIST));
  }

  function onDown(e) {
    if (!canHumanShoot()) return;
    _myAiming = true;
    var p = toLogical(e);
    P.UI.aiming = true; P.UI.aimX = p.x; P.UI.aimY = p.y;
    updatePowerPreview();
  }

  function onUp() {
    if (!_myAiming) return;
    _myAiming = false;
    var c = state.cue;
    var dx = P.UI.aimX - c.x, dy = P.UI.aimY - c.y;
    var d = Math.hypot(dx, dy);
    if (d < 4) return;                              /* too short: cancel */
    var dirx = -(dx / d), diry = -(dy / d);
    var power = Math.max(0, Math.min(1, d / C.POWER_MAX_DIST));
    var speed = 120 + power * (C.MAX_SHOT_SPEED - 120);
    fireHumanShot({ vx: dirx * speed, vy: diry * speed, power: power });
  }

  function onTouchStart(e) {
    e.preventDefault();
    if (!e.touches || !e.touches[0]) return;
    if (canHumanShoot()) _myAiming = true;
    var t = e.touches[0];
    P.UI.aiming = _myAiming;
    P.UI.aimX = toLogical(t).x; P.UI.aimY = toLogical(t).y;
    updatePowerPreview();
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!_myAiming || !e.touches || !e.touches[0]) return;
    var t = e.touches[0];
    P.UI.aimX = toLogical(t).x; P.UI.aimY = toLogical(t).y;
    updatePowerPreview();
  }

  function onTouchEnd() { onUp(); }

  /* ---- keyboard (human char control + navigation) ---- */
  function onKey(e) {
    if (!active || !state) return;
    var k = e.key.toLowerCase();
    var navKeys = ["tab", " ", "arrowup", "arrowdown", "arrowleft", "arrowright"];
    if (navKeys.indexOf(k) !== -1) e.preventDefault();
    if (k === "escape") { onBackRequested(); return; }
    _keys[k] = true;
    if (k === "tab" && state.humanTeam === "balls") cycleActiveChar();
  }

  function onKeyUp(e) {
    if (!active) return;
    var k = e.key.toLowerCase();
    if (_keys[k]) delete _keys[k];
  }

  function cycleActiveChar() {
    state.activeCharIdx = (state.activeCharIdx + 1) % Math.max(1, _chars.length);
    updateDom();
  }

  /* ---- DOM overlay ---- */
  function buildDom() {
    var root = document.createElement("div");
    root.className = "arena-root";
    root.style.position = "fixed";
    root.style.left = "0"; root.style.top = "0"; root.style.right = "0"; root.style.bottom = "0";
    root.style.pointerEvents = "none";              /* canvas keeps pointer events; children re-enable */

    var topbar = document.createElement("div");
    topbar.className = "arena-topbar";
    topbar.style.pointerEvents = "auto";
    var turnEl = document.createElement("span");
    turnEl.className = "arena-turn";
    var msgEl = document.createElement("span");
    msgEl.className = "arena-msg";
    topbar.appendChild(turnEl);
    topbar.appendChild(msgEl);

    var panel = document.createElement("div");
    panel.className = "arena-panel";
    panel.style.pointerEvents = "auto";

    var teamWrap = document.createElement("div");
    teamWrap.className = "arena-team";
    var bCue = document.createElement("button");
    bCue.className = "arena-btn";
    bCue.textContent = "CUE";
    bCue.onclick = function () { pickTeam("cue"); };
    var bBall = document.createElement("button");
    bBall.className = "arena-btn";
    bBall.textContent = "BALLS";
    bBall.onclick = function () { pickTeam("balls"); };
    teamWrap.appendChild(bCue);
    teamWrap.appendChild(bBall);

    var overCard = document.createElement("div");
    overCard.className = "arena-over";
    var winnerEl = document.createElement("div");
    winnerEl.className = "arena-winner";
    var retryBtn = document.createElement("button");
    retryBtn.className = "arena-btn";
    retryBtn.textContent = "Play again";
    retryBtn.onclick = function () { resetArena(); };
    var backBtn = document.createElement("button");
    backBtn.className = "arena-btn";
    backBtn.textContent = "Back to menu";
    backBtn.onclick = function () { onBackRequested(); };
    overCard.appendChild(winnerEl);
    overCard.appendChild(retryBtn);
    overCard.appendChild(backBtn);

    panel.appendChild(teamWrap);
    panel.appendChild(overCard);
    root.appendChild(topbar);
    root.appendChild(panel);
    document.body.appendChild(root);
    _dom = { root: root, turnEl: turnEl, msgEl: msgEl, teamWrap: teamWrap, overCard: overCard, winnerEl: winnerEl };
  }

  function pickTeam(team) {
    if (state.phase !== "teamSelect") return;
    state.humanTeam = team;
    startBreak();
  }

  function updateDom() {
    if (!_dom || !state) return;
    _dom.turnEl.textContent = "Turn " + state.turn + " / " + C.ARENA_MAX_TURNS;
    var msg = "";
    switch (state.phase) {
      case "teamSelect":
        msg = state.humanTeam === null ? "Choose your team" : "";
        break;
      case "break":
        msg = "Break!";
        break;
      case "ballMove":
        if (state.humanTeam === "cue") {
          msg = "Balls moving... " + Math.ceil(state.moveLeftMs / 1000) + "s";
        } else {
          var ch = _chars[state.activeCharIdx];
          msg = ch ? "Move ball #" + ch.id + "  (WASD, Tab to switch)" : "";
        }
        break;
      case "cueShot":
        if (state.humanTeam === "cue" && !state.shotInFlight) msg = "Aim & drag to shoot";
        else msg = state.shotInFlight ? "Ball rolling..." : "";
        break;
      case "gameOver":
        msg = "";
        break;
    }
    _dom.msgEl.textContent = msg;
    _dom.teamWrap.style.display = state.phase === "teamSelect" ? "flex" : "none";
    _dom.overCard.style.display = state.phase === "gameOver" ? "block" : "none";
    if (state.phase === "gameOver") {
      _dom.winnerEl.textContent = state.winner === "cue" ? "Cue wins!" : "Balls win!";
    }
  }

  function onBackRequested() {
    var cb = _onBack;
    end();
    if (cb) cb();
  }

  /* ---- lifecycle ---- */
  function resetArena() {
    var s = newBalls();
    state.balls = s.balls;
    state.cue = s.cue;
    P.Physics.setBalls(state.balls, state.cue);
    _chars = [];
    state.chars = [];
    state.humanTeam = null;
    state.turn = 1;
    state.moveLeftMs = C.ARENA_MOVE_TIME_MS;
    state.activeCharIdx = 0;
    state.winner = null;
    state.shotInFlight = false;
    setPhase("teamSelect");
  }

  function start(canvas, onBack) {
    if (active) return;
    active = true;
    _canvas = canvas;
    _onBack = typeof onBack === "function" ? onBack : null;
    state = makeState();
    P.Arena.state = state;
    buildDom();
    resetArena();
    /* keep the classic UI inert so its stale listeners never fire a shot here */
    P.UI.onFire = null;
    P.UI.shootable = false;
    attachListeners();
    _lastT = null;
    if (raf) _rafId = raf(loop);
  }

  function end() {
    if (!active) return;
    active = false;
    if (_rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(_rafId);
    _rafId = null;
    removeListeners();
    if (_dom) {
      var r = _dom.root;
      if (r.parentNode) r.parentNode.removeChild(r);
      _dom = null;
    }
    state = null;
  }

  function attachListeners() {
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    if (_canvas) {
      _canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      _canvas.addEventListener("touchstart", onTouchStart, { passive: false });
      _canvas.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onTouchEnd);
    }
  }

  function removeListeners() {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKeyUp);
    if (_canvas) {
      _canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      _canvas.removeEventListener("touchstart", onTouchStart);
      _canvas.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    }
  }

  P.Arena = {
    state: null,
    isActive: function () { return active; },
    start: function (canvas, onBack) { start(canvas, onBack); },
    end: function () { end(); }
  };
})();
