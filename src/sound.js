/* Poole.Sound — plays the pre-rendered WAV files (assets/sounds/*.wav) for
   in-game events. Uses a small pool of <audio> elements per sound so that
   overlapping impacts can ring out together. Headless/Node-safe: no-ops when
   there is no DOM / audio support, and never throws even if building an
   <audio> element fails (e.g. headless builds with a stubbed media API). */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};

  /* Relative paths resolved against index.html (works from file:// and http). */
  var MANIFEST = {
    strike:   "assets/sounds/strike.wav",
    ballball: "assets/sounds/ballball.wav",
    rail:     "assets/sounds/rail.wav",
    pocket:   "assets/sounds/pocket.wav",
    win:      "assets/sounds/win.wav",
    loss:     "assets/sounds/loss.wav"
  };

  /* Per-sound base loudness, multiplied by per-event intensity (0..1). */
  var BASE_VOL = { strike: 0.9, ballball: 0.7, rail: 0.55, pocket: 0.65, win: 0.85, loss: 0.7 };

  /* How many simultaneous instances of one sound may ring at once. */
  var POOL = 3;

  var pools = {};   /* name -> <audio>[] */
  var ptrs = {};    /* name -> next round-robin index */
  var enabled = true;
  var audioOK = true; /* assumes buildable until a construction failure proves otherwise */

  /* Build one <audio> element. Prefer the DOM factory (works even when the
     global HTMLAudioElement constructor is stubbed/broken); on any failure
     disable audio permanently so we never spam errors or re-try. */
  function makeElem() {
    try {
      if (!W.document || typeof W.document.createElement !== "function") return null;
      var el = W.document.createElement("audio");
      if (typeof el.play === "function") return el;
      return null;
    } catch (e) {
      audioOK = false;
      return null;
    }
  }

  /* Pick (and lazily grow the pool for) a sound, round-robin so overlapping
     plays hit different elements until the pool is exhausted. */
  function pick(name) {
    if (!audioOK) return null;
    var arr = pools[name];
    if (!arr) { arr = pools[name] = []; ptrs[name] = 0; }
    while (arr.length < POOL) {
      var el = makeElem();
      if (!el) break;                 /* element build failed -> stop, audioOK now false */
      el.src = MANIFEST[name];        /* set once; browser buffers on demand */
      arr.push(el);
    }
    return (arr.length > 0 ? arr[ptrs[name] % POOL] : null);
  }

  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

  P.Sound = {
    /* Play a named sound. intensity (0..1) scales loudness; omitted -> 1. */
    play: function (name, intensity) {
      if (!enabled || !MANIFEST[name] || !audioOK) return;
      var el = pick(name);
      if (!el) { audioOK = false; return; }   /* first failure -> fall back to silent */
      el.currentTime = 0;
      var iv = clamp01(typeof intensity === "number" ? intensity : 1);
      el.volume = clamp01(iv * (BASE_VOL[name] || 0.7));
      try {
        var p = el.play(); // may reject before a user gesture (autoplay policy);
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) { /* ignore: autoplay policy / unsupported media */ }
    },

    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; }
  };
})();
