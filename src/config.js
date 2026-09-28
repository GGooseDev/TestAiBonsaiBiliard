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
    /* Legacy world-unit extension cap, kept for reference. Cue length is now driven
       by the on-screen-framed extension (_cueMaxOnScreenOff) so it reads the same
       regardless of aim direction; this value no longer sets the maximum length. */
    C.CUE_MAX_EXTEND = 160;
    C.CUE_SHAFT_W = 7;
    /* Cue extension is framed to stay inside the viewport: the butt end may reach at
       most C.CUE_MAX_WORLD_OFF world units from the ball (bisection upper bound),
       and stops C.CUE_SCREEN_INSET_FRAC of min(width,height) px short of the frame edge. */
    C.CUE_MAX_WORLD_OFF = 1500;
    C.CUE_SCREEN_INSET_FRAC = 0.04;

  /* effects */
  C.SHAKE_MS = 700;
  C.BOKEH_COUNT = 26;                          /* out-of-focus bokeh orbs behind the table */
  C.BOKEH_MIN_R = 160;                          /* smallest orb size, world units   */
  C.BOKEH_VAR_R = 200;                          /* max extra radius, world units    */
  C.BOKEH_CORE_ALPHA = 0.65;                    /* bright point of light (keeps hue) */
  C.BOKEH_MID_ALPHA = 0.32;                     /* soft out-of-focus halo           */
  C.BOKEH_RING_ALPHA = 0.15;                    /* faint rim, classic bokeh edge    */
  C.BOKEH_DRIFT = 0.12;                         /* per-disc drift amplitude, uv units*/
  C.BOKEH_FLOW = 0.06;                         /* autonomous whole-field pan, uv    */
  C.BOKEH_SPEED = 0.20;                        /* drift speed scale, rad/s          */
  C.BOKEH_ROT_SPEED = 0.05;                    /* autonomous field rotation speed   */
  C.BOKEH_ROT_A = 0.03;                        /* rotation amplitude (rad), term A  */
  C.BOKEH_ROT_B = 0.018;                       /* rotation amplitude (rad), term B  */
  C.BOKEH_PARALLAX = 1.0;                      /* field slide vs camera offset      */
  C.BOKEH_PALETTE = [                         /* hex colors, brightest-first warm accent included */
    "#7aa3ff",  /* blue  */
    "#b18cff",  /* violet */
    "#6fd8ce",  /* teal  */
    "#ffb45e",  /* amber */
    "#ff7f9e",  /* pink  */
    "#7ae0a4"   /* mint  */
  ];
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
