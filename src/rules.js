/* Rules / turn machine for standard 8-ball.
   Reads a Physics-like object after each shot and produces a decision.
   The rules engine never touches the DOM; it only mutates state and returns instructions.
   Exposed via window.Poole.Rules. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  P.Rules = {
    /* state */
    players: null,   /* [Player, Player] in shoot order */
    idx: 0,          /* shooter index */
    phase: "pre",    /* pre|break|between|chooseGroup|shooting|gameover */
    isBreak: true

  ,
    init: function (players) {
      this.players = players;
      this.idx = 0;
      this.phase = "break"; // human always breaks first (rule 4)
      this.reset();
    },

    /* reset both players and turn to a fresh game */
    reset: function () {
      for (var i = 0; i < 2; i++) { this.players[i].group = null; }
      this.idx = 0;
      this.phase = "break";
    },

    current: function () { return this.players[this.idx]; },
    opponent: function () { return this.players[1 - this.idx]; },

    /* object-ball ids the current player must shoot (or [8] if on the black). */
    legalIds: function (i) {
      i = i == null ? this.idx : i;
      var g = this.players[i].group;
      var balls = P.Physice_balls();
      if (!g) return [];
      var groupInPlay = false, blackInPlay = false;
      for (var k = 0; k < balls.length; k++) {
        var b = balls[k];
        if (b.inPocket) continue;
        if (b.id === 8) blackInPlay = true;
        else if (P.Ball.isGroupBall({ id: b.id }, g)) groupInPlay = true;
      }
      if (groupInPlay) {
        var ids = [];
        for (var m = 0; m < balls.length; m++) {
          var c = balls[m];
          if (!c.inPocket && P.Ball.isGroupBall({ id: c.id }, g)) ids.push(c.id);
        }
        return ids;
      }
      return blackInPlay ? [8] : [];
    },

    /* true when the given player has no group balls left and the 8 is in play. */
    onTheEight: function (i) {
      i = i == null ? this.idx : i;
      var g = this.players[i].group;
      if (!g) return false;
      var balls = P.Physice_balls();
      var groupInPlay = false, blackInPlay = false;
      for (var k = 0; k < balls.length; k++) {
        var b = balls[k];
        if (b.inPocket) continue;
        if (b.id === 8) blackInPlay = true;
        else if (P.Ball.isGroupBall({ id: b.id }, g)) groupInPlay = true;
      }
      return !groupInPlay && blackInPlay;
    },

    /* random group assignment for both players. */
    autoAssignGroups: function () {
      var sides = ["SOLID", "STRIPE"];
      if (Math.random() < 0.5) sides.reverse();
      this.players[0].group = sides[0];
      this.players[1].group = sides[1];
    },

    /* The core: called after every shot once the table is still.
       Expects a physics object exposing firstContact, cuePocketed and pocketedThisShot [].
       Returns a decision object. */
    onShotSettled: function (phys) {
      var shooterIdx = this.idx;
      var shooter = this.current();
      var balls = P.Physice_balls();
      var potted = phys.pocketedThisShot.slice();
      var cuePocketed = !!phys.cuePocketed;
      var firstContact = !!phys.firstContact;
      var isBreak = (this.phase === "break");

      function idIn(id) { return balls.some(function (b) { return b.id === id && !b.inPocket; }); }
      function isGroupOfShooter(id) { return P.Ball.isGroupBall({ id: id }, shooter.group); }

      var D = {
        winner: null, foul: false, cuePocketed: cuePocketed, nextTurnPass: true,
        respot8: false, respotCue: false, needGroupChoice: false, message: "", phaseAfter: null
      };

      var blackPotted = potted.some(function (d) { return d.id === 8; });

      /* --- black 8 is special --- */
      if (blackPotted) {
        if (cuePocketed) {
          D.winner = 1 - shooterIdx;      /* fouling shooter loses */
          D.foul = true;
          D.phaseAfter = "gameover";
          D.message = "Foul: " + shooter.name + " scratches the cue and sinks the 8 — " + this.opponent().name + " wins.";
        } else if (isBreak) {
          D.respot8 = true;              /* on the break the 8 is re-played */
          D.phaseAfter = isBreak ? null : null;
        } else {
          D.winner = shooterIdx;         /* clean 8 wins */
          D.phaseAfter = "gameover";
          D.message = shooter.name + " sinks the black 8 and wins.";
        }
        return D;
      }

      /* --- break shot --- */
      if (isBreak) {
        var colorPotted = potted.some(function (d) { return P.Ball.group(d.id) !== null; });
        D.nextTurnPass = colorPotted ? false : true;  /* colour on break -> keeper keeps turn */
        if (colorPotted && shooter.type === "human") {
          D.needGroupChoice = true;
          D.phaseAfter = "chooseGroup";
          D.message = shooter.name + " pockets a ball on the break - choose your group.";
        } else {
          this.autoAssignGroups();
          D.phaseAfter = "between";
          D.message = colorPotted
            ? (shooter.name + " breaks into " + this.players[0].group + "/" + this.players[1].group + ".")
            : ("Open break. Groups random. " + this.opponent().name + " shoots.");
        }
        return D;
      }

      /* --- normal shot between turns --- */
      if (cuePocketed || !firstContact) {
        D.foul = true;
        D.nextTurnPass = true;
        D.respotCue = true;
        D.message = cuePocketed
          ? "Foul: " + shooter.name + " scratches the cue ball. Re-spot and " + this.opponent().name + "'s turn."
          : "Foul: no ball touched. Cue re-spotted, " + this.opponent().name + "'s turn.";
        D.phaseAfter = "between";
      } else {
        var pottedLegal = potted.some(function (d) { return isGroupOfShooter(d.id); });
        if (pottedLegal) {
          D.nextTurnPass = false;              /* keeper keeps shooting */
          D.message = shooter.name + " pockets a legal ball - keep shooting.";
          D.phaseAfter = "between";
        } else {
          D.nextTurnPass = true;               /* turn changes */
          D.message = "Turn to " + this.opponent().name + ".";
          D.phaseAfter = "between";
        }
      }

      return D;
    },

    /* Advance the turn machine after a settled shot.
       game.js (not this engine) does the physical re-positioning of balls;
       it only reads the flags in D before and after calling this. */
    applyDecision: function (D) {
      if (D.winner !== null) { this.phase = "gameover"; return D; }
      if (D.needGroupChoice) { this.phase = "chooseGroup"; return D; } /* breaker keeps idx */
      if (D.nextTurnPass) { this.idx = 1 - this.idx; }
      this.phase = "between";
      this.isBreak = false;
      return D;
    },

    /* Human breaker picks a group after a colour is pocketed on the break. */
    chooseGroup: function (i, side) {
      var other = side === "SOLID" ? "STRIPE" : "SOLID";
      this.players[i].group = side;
      this.players[1 - i].group = other;
    },

    /* Called right after a human chooses on the break: breaker now shoots their group. */
    finishGroupChoice: function () { this.phase = "between"; return this.phase; },

    legalBallCount: function () { return this.legalIds().length; }
  };

  /* small indirection so rules can read the current ball list from physics without a global. */
  P.Physice_balls = function () { return (P.Physics && P.Physics.balls) || []; };
})();
