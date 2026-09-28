var THREE = require('./lib/three.min.js');
var win={}; globalThis.window=win;
require('./src/config.js'); var C=win.Poole.CONFIG;
var FOV=46,TILT=28,MARGIN=1.22,RAIL_DEPTH=42,RAIL_H=46,REST_Y=C.BR;
var HALF_W=(C.IX1-C.IX0)/2,HALF_H=(C.IY1-C.IY0)/2,CXw=C.IX0+HALF_W,CYw=C.IY0+HALF_H;
function l2w(x,y,hy){return new THREE.Vector3(x-CXw,hy,-(y-CYw));}
var W=1920,H=1080;
var tH=Math.tan(Math.PI*FOV/360),tV=tH/(W/H);
var extX=HALF_W+RAIL_DEPTH*1.35, extZ=HALF_H+RAIL_DEPTH*1.35+RAIL_H*0.7;
var D=Math.max(extX/tH,extZ/tV)*MARGIN;
console.log('D=',D);
var cam=new THREE.PerspectiveCamera(FOV,W/H,5,3000);
cam.position.set(0,D*Math.cos(Math.PI*TILT/180),D*Math.sin(Math.PI*TILT/180));
cam.lookAt(new THREE.Vector3(0,RAIL_H*0.2,0));
function sx(v){var p=v.clone().project(cam);return (p.x+1)*0.5*W;}
function sy(v){var p=v.clone().project(cam);return 1-(p.y+1)*0.5*H;}
console.log('cam pos Y,Z =', cam.position.y, cam.position.z);
var pts=[
 {n:'centre(500,280)',x:500,y:280},
 {n:'top-rail centre(500,'+C.IY1+')',x:500,y:C.IY1},
 {n:'bottom-rail centre(500,'+C.IY0+')',x:500,y:C.IY0},
 {n:'left rail('+C.IX0+',280)',x:C.IX0,y:280},
 {n:'right rail('+C.IX1+',280)',x:C.IX1,y:280},
 {n:'break(500,'+(C.IY1-C.BR*8)+')',x:500,y:C.IY1-C.BR*8},
 {n:'respot(500,'+(C.IY0+C.BR*4)+')',x:500,y:C.IY0+C.BR*4},
];
pts.forEach(function(p){var v=l2w(p.x,p.y,REST_Y);console.log('  %-24s screen(%.1f, %.1f)', p.n, sx(v), sy(v));});
