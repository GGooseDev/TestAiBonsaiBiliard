var THREE = require('./lib/three.min.js');
var FOV=46,TILT=28,MARGIN=1.22,RAIL_DEPTH=42,RAIL_H=46;
var HALF_W=466,HALF_H=246;
var tH=Math.tan(Math.PI*FOV/360),tV=tH/1.7778;
var extX=HALF_W+RAIL_DEPTH*1.35, extZ=HALF_H+RAIL_DEPTH*1.35+RAIL_H*0.7;
var D=Math.max(extX/tH,extZ/tV)*MARGIN;
console.log('D=',D,'extX=',extX,'extZ=',extZ);
var cam=new THREE.PerspectiveCamera(FOV,1920/1080,5,3000);
cam.position.set(0,D*Math.cos(Math.PI*TILT/180),D*Math.sin(Math.PI*TILT/180));
cam.lookAt(new THREE.Vector3(0,RAIL_H*0.2,0));
function proj(v){var p=v.clone().project(cam);return [p.x.toFixed(3),p.y.toFixed(3)];}
console.log('lookAt(0,9.2,0):', proj(new THREE.Vector3(0,9.2,0)));
console.log('felt center (0,0,0):', proj(new THREE.Vector3(0,0,0)));
console.log('ball rest (0,14,0):', proj(new THREE.Vector3(0,14,0)));
console.log('top-rail world (0,0,-246):', proj(new THREE.Vector3(0,14,-246)));
console.log('bottom-rail world (0,0,+246):', proj(new THREE.Vector3(0,14,246)));
