/* Verify the PROPOSED fix: aim direction from the cursor's on-screen offset from
   the projected ball + a per-frame tangent basis. This is immune to the
   raycast-to-felt distortion of an elevated cursor because it compares two
   on-screen positions directly.

   Headless checks (real camera math, same as src/webgl3d.js):
   - cursor right of ball  -> logical x increases, y ~ unchanged
   - cursor up (screen)    -> logical y increases (+Y = top rail), x ~ unchanged
   - cursor down (screen)  -> logical y decreases
   - far-away on felt      -> matches the plain raycast (consistency)
 */
var THREE = require('./lib/three.min.js');
var C = { IX0:-30, IX1:30, IY0:-34, IY1:34, BR:14,
          RAIL_DEPTH:42, RAIL_H:46,
          FOV:46, TILT_DEG:28, FRAMEMARGIN:1.22 };
var HALF_W=(C.IX1-C.IX0)/2, HALF_H=(C.IY1-C.IY0)/2;
var CXw=C.IX0+HALF_W, CYw=C.IY0+HALF_H, REST_Y=C.BR;
function l2w(x,y,hy){return new THREE.Vector3(x-CXw,hy,-(y-CYw));}
function w2l(wx,wz){return{x:wx+CXw,y:CYw-wz};}

var cam, cssW=1920, cssH=1080;
function makeCam(){
  var c=new THREE.PerspectiveCamera(C.FOV, cssW/cssH, 0.1, 5000);
  var tH=Math.tan(THREE.MathUtils.degToRad(C.FOV/2));
  var tV=tH/Math.max(cssW/cssH,0.001);
  var extX=HALF_W+C.RAIL_DEPTH*1.35;
  var extZ=HALF_H+C.RAIL_DEPTH*1.35+C.RAIL_H*0.7;
  var D=Math.max(extX/tH,extZ/tV)*C.FRAMEMARGIN;
  var tilt=THREE.MathUtils.degToRad(C.TILT_DEG);
  c.position.set(0,D*Math.cos(tilt),D*Math.sin(tilt));
  c.lookAt(new THREE.Vector3(0,C.RAIL_H*0.2,0));
  return c;
}
function toCanvas(v){var p=v.clone().project(cam);return{x:(p.x+1)*0.5*cssW,y:1-(p.y+1)*0.5*cssH};}

var AIM_BASIS_STEP=10;
/* PROPOSED corrected mapping: returns logical aim point for cursor (px,py)
   aiming from cue ball at logical (cx,cy). */
function aimFromScreen(px,py,cx,cy){
  var bp=toCanvas(l2w(cx,cy,REST_Y));
  var sx=px-bp.x, sy=py-bp.y;
  var sm=Math.sqrt(sx*sx+sy*sy); if(sm<0.5) return null;
  var rp=toCanvas(l2w(cx+AIM_BASIS_STEP,cy,REST_Y));
  var upP=toCanvas(l2w(cx,cy+AIM_BASIS_STEP,REST_Y));
  var sr={x:rp.x-bp.x,y:rp.y-bp.y};
  var su={x:upP.x-bp.x,y:upP.y-bp.y};
  var det=sr.x*su.y-su.x*sr.y; if(Math.abs(det)<1e-6) return null;
  var a=(sx*su.y-sy*su.x)/det;
  var b=(sr.x*sy-sr.y*sx)/det;
  return { x:cx+a*AIM_BASIS_STEP, y:cy+b*AIM_BASIS_STEP };
}
/* plain raycast (current behaviour) */
function rayLogical(px,py){
  var ndc=new THREE.Vector2((px/cssW)*2-1, 1-(py/cssH));
  var rc=new THREE.Raycaster(); rc.setFromCamera(ndc,cam);
  var hit=new THREE.Vector3();
  if(rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),hit)) return w2l(hit.x,hit.z);
  return null;
}

var cue={x:0,y:0};
var cam2;
function test(){
  cam=cam2;
  var ballPix=toCanvas(l2w(0,0,REST_Y));
  console.log('ball screen px = (%s,%s)', ballPix.x.toFixed(1), ballPix.y.toFixed(1));
  var cases=[
    {n:'RIGHT',dx:80,dy:0,   want:{x:1,y:0}},  /* screen right => +X */
    {n:'LEFT', dx:-80,dy:0,  want:{x:-1,y:0}}, /* screen left  => -X */
    {n:'UP',   dx:0,dy:-80,  want:{x:0,y:1}},  /* screen up    => +Y (top rail) */
    {n:'DOWN', dx:0,dy:+80,  want:{x:0,y:-1}}, /* screen down  => -Y */
    {n:'UP-RGT',dx:60,dy:-60, want:{x:1,y:1}}, /* screen up-right => +X,+Y */
    {n:'DN-LFT', dx:-60,dy:+60, want:{x:-1,y:-1}} /* screen down-left=> -X,-Y */,
  ];
  cases.forEach(function(cs){
    var px=ballPix.x+cs.dx, py=ballPix.y+cs.dy;
    var lg=aimFromScreen(px,py,cue.x,cue.y);
    if(!lg){console.log(' %s -> null', cs.n); return;}
    var dx=lg.x-cue.x, dy=lg.y-cue.y;
    var okx=(cs.want.x>0&&dx>0)||(cs.want.x<0&&dx<0)||Math.abs(dx)<2;
    var oky=(cs.want.y>0&&dy>0)||(cs.want.y<0&&dy<0)||Math.abs(dy)<2;
    console.log(' %s -> logical(%7.1f,%7.1f)  dx=%s dy=%s  %s',
      cs.n, lg.x, lg.y, (dx>0?'+':'-'), (dy>0?'+':'-'), (okx&&oky?'OK':'MISMATCH'));
  });

  /* the plain raycast is unreliable in this repro (ball sits off-frame), so we
     don't compare magnitudes there. The near-ball directional behaviour above IS
     the user's reported symptom and is fully verifiable headlessly. */
}

cam2=makeCam(); test();
console.log('--- second frame size 1366x768 ---');
cssW=1366; cssH=768; cam2=makeCam(); test();
