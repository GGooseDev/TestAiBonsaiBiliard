/* Procedural billiard-ball character (P.Character). The body is one of the
   existing game balls (C.COLORS, optional white equator band for stripes,
   number badge on the back pole); accessories — eyes, sneakers and gloves —
   are built from primitives and pop in/out with a staggered spring morph
   (ball <-> character). All animation is procedural per frame: idle
   (breathing, sway, blinks) and a treadmill walk cycle. No keyframes. */
(function () {
  var W = window, P = W.Poole;
  if (!P) W.Poole = P = {};

  /* headless fallback so node tests can require this file without THREE.js */
  if (!W.THREE) {
    P.Character = { create: function () { return null; } };
    return;
  }

  /* --- named constants (viewer world units, body radius 50) --- */
  var BODY_R = 50;
  var CHAR_BALL_ID = "11";        /* base ball from C.COLORS: striped blue #11 */
  var MORPH_SPEED = 5.5;          /* morph spring rate, 1/s                     */
  var WALK_RAD = 5.0;             /* walk cycle angular speed, rad/s            */
  var BLINK_PERIOD = 3.6;         /* seconds between blinks                     */
  var BLINK_DUR = 0.14;           /* blink window (close+open), s               */
  var EYE_DELAY = 0.04;           /* morph stagger delays (eyes < gloves < feet)*/
  var GLOVE_DELAY = 0.12;
  var SNK_DELAY = 0.20;

  var SNK_UPPER_HEX = 0xd62b35;   /* red upper                                  */
  var SOLE_HEX = 0xf4f1ea;        /* white sole (cue-ball off-white)            */
  var GLOVE_HEX = 0xf6f2e8;       /* glove off-white                             */
  var IRIS_HEX = 0x1a2540;        /* pupil dark navy                             */

  var EYE_X = 15, EYE_Y = 9;      /* eye centres on the face (+Z)               */
  var EYE_R = 10.5, IRIS_R = 5.2, HL_R = 1.7;
  var SOLE_LEN = 24, SOLE_W = 13, SOLE_T = 7;   /* sole slab: len x wide x thick */
  var UPPER_L = 19, UPPER_W = 11, UPPER_H = 9.5; /* puffy red upper ellipsoid    */
  var LACE_R = 1.25;                           /* chunky white laces             */
  var FLOAT_Y = 5;                /* low hover: feet just above the floor       */
  var FOOT_X = 28, FOOT_Z = 12;   /* feet spread wide and forward of the bottom  */
  var SPLAY = 0.22;               /* toe splay angle, rad                        */
  var SNK_LIFT = 10;              /* max step lift                               */
  var STRIDE_Z = 4;               /* fore/aft foot swing per step                */
  var FOOT_BASE_Y = -BODY_R;      /* sole bottom at ball bottom                  */
  var ARM_AMPL = 0.65;            /* arm-swing amplitude, rad                    */
  var BOB_IDLE = 1.8;             /* idle vertical bob                           */
  var BOB_WALK = 7;               /* walk vertical bob (highest mid-stride)      */
  var HAND_X = 64, HAND_Y = 4, HAND_Z = 18; /* hands hang out beyond the ball */
  var FIST_R = 9;                 /* rounded fist sphere                          */
  var FINGER_CAP_LEN = 6, FINGER_R = 3.2;  /* capsule fingers                    */
  var THUMB_CAP_LEN = 6, THUMB_R = 3;       /* capsule thumb                      */
  var HAND_TILT_X = 0.15;         /* hands hang slightly forward                 */
  var BADGE_R = 13;

  var UPZ = new THREE.Vector3(0, 0, 1);

  /* easeOutBack: overshoots to ~1.1 for the "pop" feel of morphing parts */
  function backEase(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    var c = 1.70158;
    return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
  }

  /* per-part morph scale: 0 before the part's delay window, overshoots to 1 after */
  function partScale(t, d) {
    var u = (t - d) / (1 - d);
    if (u < 0) u = 0;
    if (u > 1) u = 1;
    return backEase(u);
  }

  /* lerp helper for idle/walk blending */
  function mix(a, b, w) { return a + (b - a) * w; }

  /* small white disc with the ball number, like the game's ball badges */
  function makeBadgeTexture(n) {
    var S = 128, cv = W.document.createElement("canvas");
    cv.width = cv.height = S;
    var x = cv.getContext("2d");
    x.fillStyle = "#ffffff";
    x.beginPath(); x.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#1a1a1a";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.font = "bold " + (S * 0.5) + "px Arial, sans-serif";
    x.fillText(n, S / 2, S / 2 + 4);
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  P.Character = {
    create: function (opts) {
      opts = opts || {};
      var ballId = typeof opts.ballId === "string" ? opts.ballId : CHAR_BALL_ID;
      var num = parseInt(ballId, 10);
      var isStripe = num >= 9 && num <= 15;
      var colorHex = (P.CONFIG && P.CONFIG.COLORS && P.CONFIG.COLORS[ballId]) || "#3e80d9";

      /* materials */
      var bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.12, metalness: 0 });
      var bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
      var soleMat = new THREE.MeshStandardMaterial({ color: SOLE_HEX, roughness: 0.8 });
      var upperMat = new THREE.MeshStandardMaterial({ color: SNK_UPPER_HEX, roughness: 0.6 });
      var laceMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var gloveMat = new THREE.MeshStandardMaterial({ color: GLOVE_HEX, roughness: 0.85 });
      var scleraMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      var irisMat = new THREE.MeshBasicMaterial({ color: IRIS_HEX });

      /* body: existing-ball look — glossy sphere, stripe band, back number badge */
      var root = new THREE.Group();
      var bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(BODY_R, 48, 32), bodyMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      root.add(bodyMesh);

      if (isStripe) {
        /* open-ended cylinder slightly outside the sphere = equator stripe band */
        var band = new THREE.Mesh(
          new THREE.CylinderGeometry(BODY_R + 0.5, BODY_R + 0.5, 9, 48, 1, true),
          bandMat);
        root.add(band);
      }

      /* number badge on the back pole (-Z), opposite the face */
      var badge = new THREE.Mesh(
        new THREE.CircleGeometry(BADGE_R, 24),
        new THREE.MeshBasicMaterial({ map: makeBadgeTexture(String(num)) }));
      badge.position.set(0, 0, -BODY_R - 0.5);
      badge.rotation.y = Math.PI;
      root.add(badge);

      /* eyes (face +Z): flat white discs with dark pupils; blink = squash Y */
      var eyeGroups = [], pupils = [];
      for (var es = -1; es <= 1; es += 2) {
        var g = new THREE.Group();
        var px = es * EYE_X, py = EYE_Y;
        var pz = Math.sqrt(BODY_R * BODY_R - px * px - py * py) + 0.6;
        g.position.set(px, py, pz);
        /* face the disc outward along the sphere normal at that point */
        g.quaternion.setFromUnitVectors(UPZ, new THREE.Vector3(px, py, pz).normalize());
        var sclera = new THREE.Mesh(new THREE.CircleGeometry(EYE_R, 24), scleraMat);
        var iris = new THREE.Mesh(new THREE.CircleGeometry(IRIS_R, 20), irisMat);
        iris.position.set(0, 1.8, 0.05);
        var hl = new THREE.Mesh(new THREE.CircleGeometry(HL_R, 12), scleraMat);
        hl.position.set(2.4, 3, 0.1);
        g.add(sclera, iris, hl);
        root.add(g);
        eyeGroups.push(g);
        pupils.push(iris);
      }

       /* sneakers: rounded sole slab, puffy red upper, white toe cap, chunky laces */
       var footGroups = [];
       for (var fs = -1; fs <= 1; fs += 2) {
         var fg = new THREE.Group();
         /* sole: squashed sphere = rounded slab; group origin at its bottom */
         var sole = new THREE.Mesh(
           new THREE.SphereGeometry(1, 32, 24), soleMat);
         sole.scale.set(SOLE_W / 2, SOLE_T / 2, SOLE_LEN / 2);
         sole.position.y = SOLE_T / 2;
         sole.castShadow = true; sole.receiveShadow = true;
         fg.add(sole);

         /* puffy red upper sitting on the sole */
         var upper = new THREE.Mesh(
           new THREE.SphereGeometry(1, 32, 24), upperMat);
         upper.scale.set(UPPER_W / 2, UPPER_H / 2, UPPER_L / 2);
         upper.position.y = SOLE_T + (UPPER_H / 2) - 2; /* sink into the sole */
         upper.castShadow = true; upper.receiveShadow = true;
         fg.add(upper);

         /* white rounded toe cap at the front of the upper */
         var toeCap = new THREE.Mesh(
           new THREE.SphereGeometry(1, 24, 16), soleMat);
         toeCap.scale.set(5, 3.8, 5.4);
         toeCap.position.set(0, SOLE_T + UPPER_H * 0.28, UPPER_L * 0.42);
         toeCap.castShadow = true;
         fg.add(toeCap);

         /* chunky laces: bars across the width, stacked up the instep */
         for (var li = 0; li < 4; li++) {
           var lace = new THREE.Mesh(
             new THREE.CylinderGeometry(LACE_R, LACE_R, UPPER_W + 1.5, 12), laceMat);
           lace.rotation.z = Math.PI / 2; /* lay along X (across the foot) */
           lace.position.set(0, SOLE_T + UPPER_H * 0.86, -UPPER_L * 0.2 + li * (UPPER_L * 0.11));
           fg.add(lace);
         }

         fg.position.set(fs * FOOT_X, FOOT_BASE_Y, FOOT_Z);
         /* toes point outward: +Y rotation turns +Z toward +X */
         fg.rotation.y = fs * SPLAY;
         root.add(fg);
         footGroups.push(fg);
       }

       /* gloves (rounded mitts): fist sphere + capsule fingers hanging down, thumb inward */
       var handGroups = [];
       for (var hs = -1; hs <= 1; hs += 2) {
         var hg = new THREE.Group();
         /* rounded fist */
         var fist = new THREE.Mesh(new THREE.SphereGeometry(FIST_R, 24, 18), gloveMat);
         fist.scale.set(1.05, 1.0, 0.9);
         fist.castShadow = true; fist.receiveShadow = true;
         hg.add(fist);
         /* fingers: rounded capsules fanned below the fist */
         for (var fi = 0; fi < 4; fi++) {
           var finger = new THREE.Mesh(
             new THREE.CapsuleGeometry(FINGER_R, FINGER_CAP_LEN, 6, 8), gloveMat);
           finger.position.set((fi - 1.5) * 3.0, -(FIST_R - 3.5), 0);
           finger.rotation.z = -(fi - 1.5) * 0.1;
           finger.castShadow = true;
           hg.add(finger);
         }
         /* thumb: capsule pointing inward toward the body centre */
         var thumb = new THREE.Mesh(
           new THREE.CapsuleGeometry(THUMB_R, THUMB_CAP_LEN, 6, 8), gloveMat);
         thumb.position.set(-hs * (FIST_R + THUMB_R - 1.5), -1.5, 0);
         thumb.rotation.z = hs * Math.PI / 2;
         thumb.castShadow = true;
         hg.add(thumb);

          var hx = hs * HAND_X, hy = HAND_Y;
          hg.position.set(hx, hy, HAND_Z);
         /* hang slightly forward and out */
         hg.rotation.x = HAND_TILT_X;
         hg.rotation.y = hs * 0.1;
         root.add(hg);
         handGroups.push(hg);
       }

      /* initial accessory state: pure ball */
      eyeGroups[0].visible = false; eyeGroups[1].visible = false;
      handGroups[0].visible = false; handGroups[1].visible = false;
      footGroups[0].visible = false; footGroups[1].visible = false;

      var state = { mode: "idle", morphT: 0, morphTarget: 0, walkBlend: 0, clock: 0 };

      function update(dt) {
        dt = Math.min(dt || 0, 0.1);
        state.clock += dt;
        var T = state.clock;

        /* morph spring toward ball(0)/character(1) */
        state.morphT += (state.morphTarget - state.morphT) * (1 - Math.exp(-MORPH_SPEED * dt));
        var t = state.morphT;  /* local alias for the rest of the frame */

        /* idle <-> walk blend */
        state.walkBlend += ((state.mode === "walk" ? 1 : 0) - state.walkBlend) * (1 - Math.exp(-4 * dt));
        var walk = state.walkBlend;

        var mEye = partScale(t, EYE_DELAY);
        var mGlove = partScale(t, GLOVE_DELAY);
        var mSnk = partScale(t, SNK_DELAY);

        /* blink: closed (squashed) only inside its short window */
        var bp = T % BLINK_PERIOD;
        var blink = 1;
        if (bp < BLINK_DUR) {
          blink = 1 - 0.94 * Math.sin((bp / BLINK_DUR) * Math.PI);
        }

         /* walk cycle values (group 0 = x<0 lifts when sin > 0) */
         var phase = T * WALK_RAD;
         var sSin = Math.sin(phase);
         var liftRt = Math.pow(Math.max(0, sSin), 2) * SNK_LIFT;    /* group 0 (x<0) */
         var liftLt = Math.pow(Math.max(0, -sSin), 2) * SNK_LIFT;   /* group 1 (x>0)  */

         /* pose: mix(idleValue, walkValue, walkBlend) */
         var breath = Math.sin(T * 2.3);
         var bobY = mix(breath * BOB_IDLE, (1 - Math.abs(sSin)) * BOB_WALK, walk);
         var tiltX = sSin * 0.05;
         var swayRy = Math.sin(T * 0.8) * 0.1;
         var strideZ = sSin * STRIDE_Z;

         /* body: mid-morph squash + breathing + vertical bob */
         var squish = Math.sin(Math.PI * t);
         bodyMesh.scale.set(1 + 0.14 * squish, (1 - 0.18 * squish) * (1 + 0.025 * breath), 1 + 0.14 * squish);
          root.position.y = FLOAT_Y + bobY;   /* hover above the floor */
         /* wobble only while morphing (amplitude dies at t=0 and t=1) */
         root.rotation.y = swayRy * (1 - walk) + Math.sin(t * 6) * 0.25 * (1 - t);
         root.rotation.x = tiltX * walk;

         /* eyes: morph scale + blink squash; pupils drift around (idle) / forward (walk) */
         var lookX = mix(Math.sin(T * 0.53) * 2.0 + Math.sin(T * 0.81) * 1.0, sSin * 2.6, walk);
         for (var ei = 0; ei < 2; ei++) {
           eyeGroups[ei].scale.set(mEye, mEye * blink, mEye);
           eyeGroups[ei].visible = mEye > 0.01;
           pupils[ei].position.set(lookX, 1.8, 0.05 + walk * 1.4);
         }

         /* gloves: morph scale + arm swing (opposite phase to the same-side foot) */
         for (var hi = 0; hi < 2; hi++) {
           var idleLean = Math.sin(T * 1.7 + (hi === 0 ? 0 : Math.PI / 2)) * 0.08;
           var swing = (hi === 0 ? -sSin : sSin) * ARM_AMPL;
           handGroups[hi].rotation.x = mix(idleLean, swing, walk) + HAND_TILT_X;
           handGroups[hi].scale.set(mGlove, mGlove, mGlove);
           handGroups[hi].visible = mGlove > 0.01;
         }

         /* sneakers: morph scale + step lift + fore/aft stride + toe-up when airborne */
         var lifts = [liftRt, liftLt];
         for (var fi2 = 0; fi2 < 2; fi2++) {
           footGroups[fi2].position.y = FOOT_BASE_Y + mix(Math.sin(T * 2.3) * 0.8, lifts[fi2], walk);
           footGroups[fi2].position.z = FOOT_Z + (fi2 === 0 ? strideZ : -strideZ) * walk;
           footGroups[fi2].rotation.x = -(lifts[fi2] / SNK_LIFT) * 0.45 * walk;
           footGroups[fi2].scale.set(mSnk, mSnk, mSnk);
           footGroups[fi2].visible = mSnk > 0.01;
         }

        state.morphT = t;
      }

      /* public handle */
      var char = {
        group: root,
        mode: "idle",
        morphT: 0,
        setMode: function (m) { state.mode = m === "walk" ? "walk" : "idle"; char.mode = state.mode; },
        setTransform: function (target) { state.morphTarget = (target === "char") ? 1 : 0; },
        update: function (dt) { update(dt); char.morphT = state.morphT; }
      };
      return char;
    }
  };
})();
