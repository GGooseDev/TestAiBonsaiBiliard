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

    P.Game.start(canvas);
  }

  if (W.document.readyState === "complete") main();
  else W.addEventListener("DOMContentLoaded", main);
})();
