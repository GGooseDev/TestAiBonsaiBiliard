/* Bot: a simple heuristic shot planner for the human-vs-bot opponent.
   Works purely in the table's logical coordinate space (the same units as C.pockets).
   Returns a shot {vx, vy, power, targetId, pocketIdx} the cue should fire,
   or null when it can't find a clear shot (game then uses its own fallback).

   Exposed via window.Poole.Bot.
*/
(function () {
  var W = window;
  var P = W.Poole;
  if (!P) W.Poole = P = {};
  var C = P.CONFIG;

  /* distance along a line segment from point p to segment a->b */
  function distToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return P.Vec.hypot(px - ax, py - ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var cx = ax + t * dx, cy = ay + t * dy;
    return P.Vec.hypot(px - cx, py - cy);
  }

  /* Pick the best legal shot for a candidate target ball. Returns {vx,vy,power,targetId,pocketIdx} or null. */
  function bestShotForTarget(balls, cue, targetId, clearance) {
    var target = null;
    for (var i = 0; i < balls.length; i++) if (balls[i].id === targetId && !balls[i].inPocket) { target = balls[i]; break; }
    if (!target) return null;

    var best = null;
    for (var pi = 0; pi < C.pockets.length; pi++) {
      var pk = C.pockets[pi];
      /* ghost contact point: where cue must hit the target to send it toward the pocket */
      var tdpx = target.x - pk.x, tdpy = target.y - pk.y;
      var tpd = P.Vec.hypot(tdpx, tdpy);
      if (tpd < 1e-9) continue;
      var nx = tdpx / tpd, ny = tdpy / tpd;
      var gx = target.x + nx * C.BR, gy = target.y + ny * C.BR;

      /* shot direction is cue -> ghost point */
      var sx = gx - cue.x, sy = gy - cue.y;
      var sd = P.Vec.hypot(sx, sy);
      if (sd < 1e-9) continue;
      var ux = sx / sd, uy = sy / sd;

      /* clearance: reject if the cue's path to the ghost point is blocked by another ball.
         The target itself must NOT block (it IS the destination). */
      var blocked = false;
      for (var bi = 0; bi < balls.length; bi++) {
        var o = balls[bi];
        if (o === cue || o === target || o.inPocket) continue;
        if (distToSegment(o.x, o.y, cue.x, cue.y, gx, gy) < C.BR * 2 - 1.0) { blocked = true; break; }
      }
      if (blocked) continue;

      /* prefer the most direct clear shot */
      if (!best || sd < best.d) {
        /* compute speed: closer shots a bit slower so the cue doesn't over-run the cushion */
        var tableW = C.IX1 - C.IX0;
        var power = Math.max(0.55, Math.min(1.0, sd / tableW));
        var spd = power * C.MAX_SHOT_SPEED;
        best = {
          vx: ux * spd, vy: uy * spd,
          power: power,
          targetId: targetId, pocketIdx: pi,
          d: sd, gx: gx, gy: gy
        };
      }
    }
    return best;
  }

  /* Given a list of candidate target ids (legal for this player), pick the best shot
     that clears the path, else return a safe fallback that will at least touch a legal ball. */
  function planShot(balls, cue, candidateIds) {
    if (!candidateIds || candidateIds.length === 0) return null;

    /* try each candidate against every pocket, keep the best non-foul-cleared shot */
    var chosen = null;
    for (var i = 0; i < candidateIds.length; i++) {
      var s = bestShotForTarget(balls, cue, candidateIds[i]);
      if (s) {
        if (!chosen || s.d < chosen.d) chosen = s;   /* prefer the most direct clear shot */
      }
    }

    /* Fallback: no clearly clear shot -> knock the closest legal ball with modest power.
       This is legal (firstContact guaranteed) but not aimed at a pocket. */
    if (!chosen) {
      var closest = null, cd = Infinity;
      for (var j = 0; j < candidateIds.length; j++) {
        var id = candidateIds[j];
        for (var k = 0; k < balls.length; k++) {
          if (balls[k].id === id && !balls[k].inPocket) {
            var d = P.Vec.hypot(balls[k].x - cue.x, balls[k].y - cue.y);
            if (d < cd) { cd = d; closest = balls[k]; }
          }
        }
      }
      if (!closest) return null;
      var fx = closest.x - cue.x, fy = closest.y - cue.y;
      var fd = P.Vec.hypot(fx, fy);
      if (fd < 1e-9) return { vx: 0, vy: -C.MAX_SHOT_SPEED * 0.5, power: 0.5, targetId: closest.id, pocketIdx: -1 };
      return {
        vx: (fx / fd) * C.MAX_SHOT_SPEED * 0.45,
        vy: (fy / fd) * C.MAX_SHOT_SPEED * 0.45,
        power: 0.45,
        targetId: closest.id, pocketIdx: -1
      };
    }

    return chosen;
  }

  /* Public API. candidateIds must already be the shooter's legal balls
     (e.g. from P.Rules.legalIds()). Returns the shot object or null. */
  P.Bot = {
    bestShot: function (balls, cue, candidateIds) {
      if (!P.Ball.isCue(cue.id)) return null;
      return planShot(balls, cue, candidateIds);
    }
  };
})();
