/* Entry point (loaded last): wires the DOM (canvas + HUD buttons) and kicks off the game.
   Everything else lives in the src/ modules already on window.Poole. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};

  function main() {
    var canvas = W.document.getElementById("game");
    if (!canvas) return;

    /* DOM actions wired to the game */
    var playAgainBtn = W.document.getElementById("play-again");
    var solBtn = W.document.getElementById("group-sol");
    var striBtn = W.document.getElementById("group-stri");
    if (playAgainBtn) playAgainBtn.addEventListener("click", function () { P.Game.newGame(); });
    if (solBtn) solBtn.addEventListener("click", function () { P.Game.chooseGroup("SOLID"); });
    if (striBtn) striBtn.addEventListener("click", function () { P.Game.chooseGroup("STRIPE"); });

    /* game-over: clicking the table also restarts */
    canvas.addEventListener("click", function () {
      var st = P.State();
      if (st && st.gameOver) P.Game.newGame();
    });

    /* --- startup --------------------------------------------------------- */
    /* The live in-game scene (table + warm shimmering bokeh) is rendered on #game
       while the menu is up, so the backdrop matches the game exactly. Classic hands
       off to the real tick loop; Arena/Viewer never start it. */
    var backdropRaf = null;
    function showBackdrop() {
      if (!P.WebGL3D) return;                 /* headless: nothing to render         */
      P.WebGL3D.init(canvas);                 /* idempotent; Game.start re-inits safely */
      P.WebGL3D.resize(W.innerWidth, W.innerHeight);
      (function loop() {
        backdropRaf = W.requestAnimationFrame(loop);
         P.WebGL3D.draw(null);                 /* no state -> bokeh room only, table hidden */
      })();
    }
    function hideBackdrop() {
      if (backdropRaf) { W.cancelAnimationFrame(backdropRaf); backdropRaf = null; }
    }
    W.addEventListener("resize", function () {
      if (backdropRaf && P.WebGL3D) P.WebGL3D.resize(W.innerWidth, W.innerHeight);
    });

    if (P.Menu && typeof P.Menu.show === 'function') {
      showBackdrop();
      P.Menu.show(function (mode) {
        hideBackdrop();
        if (mode === 'classic') P.Game.start(canvas);
      });
    } else {
      /* menu module missing: fall back to launching the game directly */
      P.Game.start(canvas);
    }
  }

  if (W.document.readyState === "complete") main();
  else W.addEventListener("DOMContentLoaded", main);
})();
