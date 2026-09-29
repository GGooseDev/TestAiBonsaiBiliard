/* One-off check: sound.js must load cleanly under Node's fake window and no-op. */
globalThis.window = globalThis.window || {};
const path = require("path");
require(path.join(__dirname, "src", "sound.js"));
const P = window.Poole;
if (typeof P.Sound !== "object") { throw new Error("P.Sound not defined"); }
if (typeof P.Sound.play !== "function") { throw new Error("P.Sound.play not a function"); }
P.Sound.play("strike", 1);
P.Sound.play("ballball", 0.5);
P.Sound.play("rail", 0.3);
P.Sound.play("pocket", 0.9);
P.Sound.play("win", 1);
P.Sound.play("loss", 1);
console.log("play() no-ops OK (no DOM, did not throw)");
console.log("setEnabled works:", P.Sound.setEnabled(false), P.Sound.isEnabled());
P.Sound.setEnabled(true);
console.log("OK");
