/* Player abstraction: the multiplayer seam. A player is just {type:'human'|'bot', name, group, difficulty}.
   All "who shoots" logic goes through this; physics/rules never know human vs bot specifics.
   Exposed via window.Poole.Player. */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};

  P.Player = {
    /* Create a player. type: 'human' | 'bot'; difficulty for bots ('easy'|'normal'|'hard'). */
    make: function (type, name, difficulty) {
      return {
        type: type,
        name: (name || (type === "human" ? "You" : "Bot")) ,
        group: null,          /* SOLID | STRIPE | null until assigned */
        difficulty: difficulty || "normal"
      };
    }
  };
})();
