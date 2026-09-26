/* All game constants. Loaded FIRST (classic script, shared window.Poole). */
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};

  var C = P.CONFIG = {};

  /* --- table geometry (logical units) --- */
  C.CANVAS_W = 1000;
  C.CANVAS_H = 560;
  C.IX0 = 34;
  C.IY0 = 34;
  C.IX1 = 966;
  C.IY1 = 526;
  C.BR = 14;
  C.POCKET_R = 27;
  C.CATCH_EXTRA = 8;

  var midX = (C.IX0 + C.IX1) / 2;
  C.pockets = [
    { x: C.IX0 + C.BR * 0.0, y: C.IY0 + C.BR * 0.5 },
    { x: midX,                y: C.IY0 + C.BR * 0.3 },
    { x: C.IX1 - C.BR * 0.3,  y: C.IY0 + C.BR * 0.5 },
    { x: C.IX0 + C.BR * 0.5,  y: C.IY1 - C.BR * 0.2 },
    { x: midX,                y: C.IY1 - C.BR * 0.2 },
    { x: C.IX1 - C.BR * 0.2,  y: C.IY1 - C.BR * 0.2 }
  ];

  C.CENTER = { x: (C.IX0 + C.IX1) / 2, y: (C.IY0 + C.IY1) / 2 };
  C.CUE_BREAK_POS = { x: (C.IX0 + C.IX1) / 2, y: C.IY1 - C.BR * 8 };
  C.RESPOT_POS = { x: (C.IX0 + C.IX1) / 2, y: C.IY0 + C.BR * 4 };

  /* --- physics --- */
  C.FRICTION = 0.9;
  C.STOP_SPEED = 30;
  C.BALL_RESTITUTION = 0.9;
  C.CUSHION_E = 0.85;
  C.TANGENT_KEEP = 0.985;
  C.STEP = 1 / 60;
  C.MAX_STEPS_PER_FRAME = 8;
  C.COLLIDE_PASSES = 5;

  /* shooting */
   C.MAX_SHOT_SPEED = 1240;   /* 2x the old 620 so a full pull feels like a hard hit */
   C.POWER_MAX_DIST = 240;
  C.MIN_DRAG = 5;

   /* cue stick visuals — the visible stick (tip to butt) rests at CUE_STICK_LEN so it never
      reads as a stub, and is pulled further from the ball by CUE_MAX_EXTEND as power rises. */
   C.CUE_STICK_LEN = 240;
   C.CUE_MAX_EXTEND = 160;
   C.CUE_SHAFT_W = 7;

  /* effects */
  C.SHAKE_MS = 700;
  C.BOKEH_COUNT = 14;
  C.BOKEH_MIN_R = 90;
  C.BOKEH_VAR_R = 150;
  C.BOKEH_CORE_ALPHA = 0.5;
  C.BOKEH_MID_ALPHA = 0.2;
  C.FLASH_MS = 1800;
  C.MSG_RISE = 80;
  C.TARGET_RING_R = C.BR + 3;
  C.POWER_RING_MIN = 4;
   C.POWER_RING_MAX = 13;

   /* --- ball colors (16-ball) --- */
  var SOLID_HUES = {
    "1": "#f1a62b", "2": "#7e4c7e", "3": "#3e80d9", "4": "#b74a8f",
    "5": "#2aa28e", "6": "#8f3a3a", "7": "#a86a17"
  };
  var STRIPE_HUES = {
    "9": SOLID_HUES["1"], "10": SOLID_HUES["2"], "11": SOLID_HUES["3"],
    "12": SOLID_HUES["4"], "13": SOLID_HUES["5"], "14": SOLID_HUES["6"],
    "15": SOLID_HUES["7"]
  };
  C.COLORS = { cue: "#e9e3d7", "8": "#1c1c1c" };
  var k;
  for (k in SOLID_HUES) C.COLORS[k] = SOLID_HUES[k];
  for (k in STRIPE_HUES) C.COLORS[k] = STRIPE_HUES[k];

  /* Standard 8-ball rack: apex=1 (solid), 8 in center, bottom corners = 2 (solid) / 15 (stripe). */
  C.RACK_ROWS = [
    [1],
    [7, 9],
    [4, 8, 6],
    [3, 5, 11, 13],
    [2, 10, 14, 12, 15]
  ];
  C.RACK_GAP_X = C.BR * 2.2;
  C.RACK_GAP_Y = C.BR * 1.9;
})();
