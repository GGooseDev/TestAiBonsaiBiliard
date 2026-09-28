'use strict';
/* Throwaway D13 check: for each realistic aspect ratio, does the default overhead
 * camera (exact game frameCamParams math) clip the finite bokeh backdrop plane at
 * its far plane?  Uses the real THREE from lib/three.min.js.  Output per aspect:
 *   in-frame plane points, max depth, and the clipped % + screen NDC extent of
 *   points with depth > 3000 (GPU far-clip -> scene.background = black). */
var pmod = require('path');
var T = require(pmod.resolve(process.cwd(), 'lib', 'three.min.js'));

var FOV = 46, TILT_DEG = 28, FRAMEMARGIN = 1.22;
var HALF_W = 466, HALF_H = 246;
var RAIL_DEPTH = 42, RAIL_H = 46;
var extX = HALF_W + RAIL_DEPTH * 1.35;                 // 522.7  (webgl3d.js:164)
var extZ = HALF_H + RAIL_DEPTH * 1.35 + RAIL_H * 0.7;  // 334.9
var tH = Math.tan(FOV / 2 * Math.PI / 180);
var BG_Y = -231;                                      // legTopY - 150 - 5
var PLANE_HALF = (Math.max(932, 492) + RAIL_DEPTH * 16) * 2.2 / 2; // ~1764.4
var LOOK_AT_Y = RAIL_H * 0.2;
var STEPS = 120;

for (var FAR_CAND of [3000, 6000]) {
    console.log('===== far=' + FAR_CAND + ' =====');
    for (var A of [1.33, 1.56, 16 / 9, 2.0, 2.1, 2.33, 2.5, 3.0]) {
        var tV = tH / A;
        var D = Math.max(extX / tH, extZ / tV) * FRAMEMARGIN;
        var cam = new T.PerspectiveCamera(FOV, A, 5, FAR_CAND);
        cam.position.x = 0;
        cam.position.y = D * Math.cos(TILT_DEG * Math.PI / 180);
        cam.position.z = D * Math.sin(TILT_DEG * Math.PI / 180);
        cam.lookAt(new T.Vector3(0, LOOK_AT_Y, 0));
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        var P = cam.projectionMatrix.elements;          // m[0]=m00, m[5]=m11, m[14..15]=w row
        var invM = cam.matrixWorldInverse;

        var nIn = 0, maxW = 0;
        var nCl = 0, zmin = 1e9, zmax = -1e9, nxm = 1, xnm = -1,nym = 1, ynM = -1;
        for (var ix = 0; ix <= STEPS; ix++) {
            for (var iz = 0; iz <= STEPS; iz++) {
                var wx = -PLANE_HALF + (ix / STEPS) * PLANE_HALF * 2;
                var wz = -PLANE_HALF + (iz / STEPS) * PLANE_HALF * 2;
                if (wx > PLANE_HALF || wz > PLANE_HALF) continue;
                var v = new T.Vector3(wx, BG_Y, wz).applyMatrix4(invM);
                var w = -v.z;                           // depth along camera -z
                if (w < 5 || w > 1e5) continue;        // skip near/behind-plane
                var cx = P[0] * v.x;                    // clip x (translation col is 0)
                var cy = P[5] * v.y;
                var cw = P[14] * v.z + P[15];           // clip w
                if (!cw || cw === Infinity || cw === -Infinity) continue;
                if (Math.abs(cx / cw) > 1.0002 || Math.abs(cy / cw) > 1.0002) continue;
                nIn++;
                if (w > maxW) maxW = w;
                var ndx = cx / cw, ndy = cy / cw;
                if (w > FAR_CAND) {                     // GPU far-clip -> scene.background (black)
                    nCl++;
                    if (wz < zmin) zmin = wz; if (wz > zmax) zmax = wz;
                    if (ndx < nxm) nxm = ndx; if (ndx > xnm) xnm = ndx;
                    if (ndy < ynm) ynm = ndy; if (ndy > ynM) ynM = ndy;
                }
            }
        }
        console.log('A=' + A.toFixed(3) + ' D=' + D.toFixed(1) + ': inFrame plane pts=' + nIn +
            ' maxDepth=' + maxW.toFixed(0) + 'u' +
            (nCl
                ? ' | CLIPPED ' + (nCl / nIn * 100).toFixed(2) + '% at z[' +
                  Math.round(zmin) + '..' + Math.round(zmax) + '] screen NDC x[' +
                  nxm.toFixed(2) + '..' + xnm.toFixed(2) + '], y[' +
                  ynm.toFixed(2) + '..' + ynM.toFixed(2) + ']'
                : ' | ok'));
    }
}
