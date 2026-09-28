/* Sweep cursor in a full 24-step circle around an ON-SCREEN ball using the REAL
   frameCamera + _aimFromScreen + real cue tip layout. Flags any null aim or
   tip-on-wrong-side, so we can see exactly where the rotation breaks down.
 */
var THREE = require('./lib/three.min.js');
var win = {}; globalThis.window = win;
require('./src/config.js'); var C = win.Poole.CONFIG;

var FOV=46, TILT=28, MARGIN=1.22, RAIL_DEPTH=42, RAIL_H=46, REST_Y=C.BR;
var HALF_W=(C.IX1-C.IX0)/2, HALF_H=(C.IY1-C.IY0)/2, CXw=C.IX0+HALF_W, CYw=C.IY0+HALF_H;
var camera=null;

function l2w(x,y,hy){return new THREE.Vector3(x-CXw, hy, -(y-CYw));}
function cam(w,h){
  var c=new THREE.PerspectiveCamera(FOV, w/h, 5, 3000);
  var tH=Math.tan(Math.PI*FOV/360), tV=tH/Math.max(w/h,0.001);
  var extX=HALF_W+RAIL_DEPTH*1.35, extZ=HALF_H+RAIL_DEPTH*1.35+RAIL_H*0.7;
  var D=Math.max(extX/tH, extZ/tV)*MARGIN;
  c.position.set(0, D*Math.cos(Math.PI*TILT/180), D*Math.sin(Math.PI*TILT/180));
  c.lookAt(new THREE.Vector3(0, RAIL_H*0.2, 0));
  return c;
}
function p2(v,w,h){var r=v.clone().project(camera);return{x:(r.x+1)*0.5*w,y:1-(r.y+1)*0.5*h};}

function aim(px_,py_,cw,ch,cx,cy){
  var bp=p2(l2w(cx,cy,REST_Y),cw,ch);
  var sx=px_-bp.x, sy=py_-bp.y, sm=Math.sqrt(sx*sx+sy*sy);
  if(sm<0.5)return null;
  var rp=p2(l2w(cx+10,cy,REST_Y),cw,ch), upp=p2(l2w(cx,cy+10,REST_Y),cw,ch);
  var sr={x:rp.x-bp.x,y:rp.y-bp.y}, su={x:upp.x-bp.x,y:upp.y-bp.y};
  var det=sr.x*su.y-sr.y*su.x; if(Math.abs(det)<1e-6)return null;
  var a=(sx*su.y-sy*su.x)/det, b=(sr.x*sy-sr.y*sx)/det;
  return {x:cx+a*10,y:cy+b*10};
}

function sweep(cssW,cssH,label){
  camera=cam(cssW,cssH);
  var best=null,bestE=1e9;
  for(var gx=C.IX0+10;gx<C.IX1-10;gx+=20)for(var gy=C.IY0+10;gy<C.IY1-10;gy+=20){
    var s=p2(l2w(gx,gy,REST_Y),cssW,cssH);
    if(s.x<0||s.x>cssW||s.y<0||s.y>cssH)continue;
    var e=(s.x-0.5*cssW)*(s.x-0.5*cssW)+(s.y-0.5*cssH)*(s.y-0.5*cssH);
    if(e<bestE){bestE=e;best={x:gx,y:gy,s:s};}
  }
  console.log('\n[%s] on-screen ball logical(%.0f,%.0f) -> screen(%.1f,%.1f)  frame %dx%d',
    label,best.x,best.y,best.s.x,best.s.y,cssW,cssH);
  var bal=best.s, Rpx=90, ok=0,n=24;
  for(var i=0;i<n;i++){
    var th=i*2*Math.PI/n;
    var cxb=bal.x+Rpx*Math.cos(th), cib=bal.y-Rpx*Math.sin(th);
    var aim_=aim(cxb,cib,cssW,cssH,best.x,best.y);
    if(!aim_){console.log('  %3d deg -> NULL aim (frozen)',i*15);continue;}
    var dx=-(aim_.x-best.x), dy=-(aim_.y-best.y); var dl=Math.hypot(dx,dy)||1; dx/=dl;dy/=dl;
    var nose=p2(l2w(best.x-dx*C.BR,best.y-dy*C.BR,REST_Y),cssW,cssH);
    var cdx=Math.sign(cxb-bal.x), cdy=Math.sign(cib-bal.y);
    var ndx=Math.sign(nose.x-bal.x), ndy=Math.sign(nose.y-bal.y);
    var okX=(cdx===0?ndx===0:(cdx*ndx>0)), okY=(cdy===0?ndy===0:(cdy*ndy>0));
    if(okX&&okY)ok++;
    console.log('  %3d deg  aim(%8.1f,%.1f)  nose(%7.1f,%7.1f)  %s',
      i*15, aim_.x, aim_.y, nose.x, nose.y, (okX&&okY)?'OK':'X');
  }
  console.log('  [%s] %d/%24 tip on cursor side', label, ok);
}
sweep(1920,1080,'1920');
sweep(1366,768,'1366');
