/* Headless smoke test for the character viewer feature (node only, no DOM/WebGL).
   Stubs THREE.js + document minimally, loads config.js -> character.js -> viewer.js,
   and drives a few hundred animation frames to verify:
     - P.Character.create builds the model from an existing game ball (#11)
     - morph ball->character spring reaches 1 and all accessory parts become visible
     - blink cycle squashes eyes; walk mode lifts the sneakers
     - P.Viewer.open/close works end-to-end (DOM + scene stubs, frame pump) */
(function () {
  var path = require("path");
  var root = __dirname + "/..";

  /* ---------- THREE.js stub ---------- */
  function V3(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  V3.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  V3.prototype.normalize = function () {
    var l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z) || 1;
    this.x /= l; this.y /= l; this.z /= l;
    return this;
  };

  var Quaternion = function () { this.setFromUnitVectors = function (a, b) { return this; }; };

  var Group = function () {
    var self = this;
    self.children = [];
    self.visible = true;
    self.position = new FakeVec();
    self.rotation = {};
    self.quaternion = new Quaternion();
    self.scale = new FakeVec();
    self.add = function () {
      for (var i = 0; i < arguments.length; i++) if (arguments[i]) self.children.push(arguments[i]);
      return self;
    };
  };

  /* fake vector that actually stores values (tests read .x/.y/.z back) */
  var FakeVec = function (x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; };
  FakeVec.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
  var Mesh = function (geo, mat) {
    this.scale = new FakeVec(); this.position = new FakeVec(); this.rotation = {};
    this.castShadow = false; this.receiveShadow = false; this.visible = true;
  };

  /* geometry stubs: plain objects; GridHelper needs .position in viewer.buildScene */
  var GeoStub = function () { return { position: new FakeVec(), rotation: {} }; };
  var MatStub = function () {};
  var TexStub = function (cv) { return { minFilter: 0, texture: cv }; };
  var Cam = function () { this.aspect = 1; this.position = new FakeVec();
    this.lookAt = function () {}; this.updateProjectionMatrix = function () {}; };
  var LightBase = function () { this.position = new V3(0, 0, 0); this.castShadow = false;
    this.shadow = { mapSize: { set: function (a, b) {} }, camera: {}, bias: 0 }; };

  var Renderer = function (opts) {
    this.setPixelRatio = function () {};
    this.setSize = function (w, h, up) {};
    this.shadowMap = { enabled: false, type: 0 };
    this.render = function (scene, cam) {};
  };

  var Scene = function () { this.background = null; this.add = function (m) { return this; }; };

  var THREE = {
    Vector3: V3, Quaternion: Quaternion, Group: Group, Mesh: Mesh, Scene: Scene,
    SphereGeometry: GeoStub, BoxGeometry: GeoStub, CylinderGeometry: GeoStub, CircleGeometry: GeoStub, PlaneGeometry: GeoStub, GridHelper: GeoStub,
    MeshStandardMaterial: MatStub, MeshBasicMaterial: MatStub, ShaderMaterial: MatStub, CanvasTexture: TexStub, Color: function () {},
    PerspectiveCamera: Cam, HemisphereLight: LightBase, DirectionalLight: LightBase, WebGLRenderer: Renderer, PCFSoftShadowMap: 4
  };

  /* ---------- document / window stubs ---------- */
  var rafQueue = [], rafNextId = 1;
  function element(tag) {
    var el = {
      tagName: tag === "canvas" ? "CANVAS" : tag,
      className: "", textContent: "", style: {},
      children: [],
      classList: { add: function (c) { this.className = (this.className + " " + c).trim(); },
                   remove: function (c) { this.className = (this.className + " " + c).replace(" " + c, "").trim(); } },
      appendChild: function (c) { el.children.push(c); return c; },
      remove: function () {},
      setPointerCapture: function () {},
      addEventListener: function () {}, removeEventListener: function () {}
    };
    if (tag === "canvas") {
      el.getContext = function () {
        return { fillStyle: "", beginPath: function () {}, arc: function () {}, fill: function () {},
                 textAlign: "", textBaseline: "", font: "", fillText: function () {} };
      };
    }
    return el;
  }

  var documentStub = {
    createElement: element,
    body: element("body"),
    getElementById: function (id) { return id === "game" ? null : null; },
    classList: { add: function () {}, remove: function () {} }
  };

  globalThis.window = globalThis;
  if (typeof globalThis.document === "undefined") globalThis.document = documentStub;
  window.document = documentStub;
  window.innerWidth = 1280; window.innerHeight = 720;
  window.devicePixelRatio = 1;
  window.performance = { now: function () { return Date.now(); } };
  /* rAF stub: entries carry ids so cancelAnimationFrame can drop the pending frame */
  window.requestAnimationFrame = function (cb) { var e = { id: rafNextId++, cb: cb }; rafQueue.push(e); return e.id; };
  window.cancelAnimationFrame = function (id) { for (var i = 0; i < rafQueue.length; i++) if (rafQueue[i].id === id) { rafQueue.splice(i, 1); break; } };
  var events = [];
  window.addEventListener = function (type, fn, opts) { events.push(type); };
  window.removeEventListener = function () {};
  window.THREE = THREE;

  /* viewer loop drives its own rAF queue; the character is driven directly here */
  function pumpFrames(n, stepMs) {
    var t0 = Date.now();
    for (var i = 1; i <= n; i++) {
      var e = rafQueue.shift();
      if (e) e.cb(t0 + i * stepMs);
    }
  }
  function stepChar(n) {
    for (var i = 0; i < n; i++) char.update(1 / 60);
  }

  /* ---------- load modules in index.html order (the ones this feature needs) ---------- */
  require(path.join(root, "src/config.js"));
  require(path.join(root, "src/character.js"));
  require(path.join(root, "src/viewer.js"));

  var P = globalThis.Poole;
  var failures = [];
  function assert(cond, msg) {
    if (cond) console.log("  ok: " + msg);
    else { failures.push(msg); console.log(" FAIL: " + msg); }
  }

  /* ---------- character ---------- */
  console.log("[character]");
  var char = P.Character.create({ ballId: "11" });
  assert(char && char.group, "create() returns a group");
  assert(typeof P.CONFIG.COLORS["11"] === "string", "config still has the #11 striped color");

  /* initial state: pure ball — only body/band/badge visible */
  var top = function () { return char.group.children; };
  function visibleCount() {
    var n = 0;
    for (var i = 0; i < top().length; i++) if (top()[i].visible) n++;
    return n;
  }
  assert(visibleCount() === 3, "starts as a plain ball: 3 visible parts (body+band+badge), got " + visibleCount());

  /* morph to character */
  char.setTransform("char");
  stepChar(240); /* ~4s of spring at 5.5/s -> t ~ 1 */
  assert(char.morphT > 0.99, "morph reaches character (t=" + char.morphT.toFixed(3) + ")");
  /* root children: body + stripe band + number badge + eyes x2 + feet x2 + hands x2 = 9 */
  assert(visibleCount() === 9, "all parts visible after morph (body+band+badge+eyes/feet/hands), got " + visibleCount());

  /* blink: eyes squash during their window */
  var minBlink = 1;
  for (var i = 0; i < 600; i++) {
    char.update(1 / 60);
    for (var ei = 3; ei <= 4; ei++) if (top()[ei].scale.y < minBlink) minBlink = top()[ei].scale.y;
  }
  assert(minBlink < 0.2, "blink squashes eyes (min scale.y=" + minBlink.toFixed(3) + ")");

  /* walk: sneakers lift in a cycle */
  char.setMode("walk");
  stepChar(180);
  var maxLift = 0;
  for (var i = 0; i < 240; i++) {
    char.update(1 / 60);
    for (var fi = 5; fi <= 6; fi++) {
      var y = top()[fi].position.y - (-47.5); /* FOOT_BASE_Y */
      if (y > maxLift) maxLift = y;
    }
  }
  assert(char.mode === "walk", "mode stays walk");
  assert(maxLift > 3, "walk lifts sneakers (max=" + maxLift.toFixed(2) + ")");

  /* back to ball */
  char.setMode("idle");
  char.setTransform("ball");
  stepChar(240);
  assert(char.morphT < 0.01, "morph returns to ball (t=" + char.morphT.toFixed(3) + ")");
  assert(visibleCount() === 3, "accessories hidden again, got " + visibleCount());

  /* ---------- viewer ---------- */
  console.log("[viewer]");
  var onBackCalled = false;
  function fakeCb() { onBackCalled = true; }

  P.Viewer.open(fakeCb);
  assert(P.Viewer.isOpen && P.Viewer.isOpen(), "viewer opens and reports open");
  pumpFrames(120, 16.7); /* render loop runs without throwing */
  assert(onBackCalled === false, "stays open until BACK is pressed");

  P.Viewer.close();
  assert(P.Viewer.isOpen() === false, "viewer closes and reports closed");
  pumpFrames(30, 16.7); /* no loop running -> no rAF re-schedule side effects */
  assert(rafQueue.length === 0, "no orphaned rAF after close");

  P.Viewer.open(fakeCb);
  assert(P.Viewer.isOpen(), "viewer re-opens cleanly");
  pumpFrames(60, 16.7);
  P.Viewer.close();
  assert(P.Viewer.isOpen() === false, "second close works");

  console.log("[done]");
  if (failures.length) {
    console.error("FAILURES (" + failures.length + "):");
    for (var f = 0; f < failures.length; f++) console.error(" - " + failures[f]);
    process.exitCode = 1;
  } else {
    console.log("ALL PASSED");
  }
})();
