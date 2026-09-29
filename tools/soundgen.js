/* Procedural sound generator for Poole.
   Synthesizes every cue from math (no external samples) and writes 16-bit PCM
   WAV files to assets/sounds/. Re-run after editing the parameters below to
   A/B-test timbres. Run: node tools/soundgen.js */

var fs = require('fs');
var path = require('path');

/* ================= PARAMETERS (tweak & re-run) ====================== */
var SAMPLE_RATE = 48000;                                  // Hz
var OUT_DIR = path.join(__dirname, '..', 'assets', 'sounds');

/* Per-sound knobs. Frequencies in Hz, decays in seconds.
   Each is shaped to match the real acoustics of that event:
     strike   cue tip knock  -> low-mid woody body + bright tip snap at t=0
     ballball balls clacking -> high bright "ping", strong overtones, very short
     rail     cushion thud   -> dull low-mid + sub-thump, muffled felt tail (no tip snap)
     pocket   ball into hole -> descending "plop" glide + soft bottom thump
     win      ascending C-major arpeggio, bright timbre  (reads: victory)
     loss     descending minor motif, dark slow timbre   (reads: deflation/loss)
   gain is a pre-normalisation level (final peak auto-clamped to 0.95). */
var SOUNDS = {
  strike:   { dur: 0.22, f1: 200, f2: 400, f3: 600, subF: 120, tauBody: 0.055, snapTau: 0.005, gain: 1.0 },
  ballball: { dur: 0.12, f1: 1300, f2: 2600, f3: 3900, tau: 0.030, snapTau: 0.004, gain: 0.95 },
  rail:     { dur: 0.20, f1: 300, f2: 600, subF: 130, tau: 0.070, feltTau: 0.020, gain: 0.9 },
  pocket:   { dur: 0.24, fStart: 360, fEnd: 110, glide: 0.10, thumpF: 80, gain: 0.95 },

  win:      { dur: 0.95, noteTau: 0.30, vib: 0.02, harmonics: [1, 0.35, 0.12], gain: 0.85,
              notes: [[523.25, 0.00], [659.25, 0.18], [784.00, 0.36], [1046.50, 0.54]] },

  loss:     { dur: 0.95, noteTau: 0.42, vib: 0.01, harmonics: [1, 0.40], gain: 0.85,
              notes: [[440.00, 0.00], [392.00, 0.30], [329.63, 0.60]] }
};

/* =============================================================== */
/* Deterministic PRNG (seeded LCG) so re-generating is reproducible. */
function makeNoise(seed) {
  var s = (seed >>> 0) || 7919;
  return function () {
    s = (s * 16807) % 2147483647;
    return ((s / 2147483647) * 2 - 1); // [-1, 1]
  };
}

/* ---------------- per-sound synthesis (returns Float32Array) ---- */
function genStrike(p) {
  var n = Math.round(SAMPLE_RATE * p.dur);
  var out = new Float32Array(n);
  var noise = makeNoise(101);
  for (var i = 0; i < n; i++) {
    var t = i / SAMPLE_RATE;
    var env = Math.exp(-t / p.tauBody);              // woody body knock, fast decay
    var body = Math.sin(2 * Math.PI * p.f1 * t) +   // fundamental ~200Hz "thock"
      0.5 * Math.sin(2 * Math.PI * p.f2 * t) +      // octave (brighter edge)
      0.25 * Math.sin(2 * Math.PI * p.f3 * t);      // faint upper harmonic = woody
    var sub = Math.sin(2 * Math.PI * p.subF * t);   // low weight of the hit
    var snap = noise() * Math.exp(-t / p.snapTau);  // bright tip-contact click at t=0
    out[i] = (body * env * 0.8 + sub * env * 0.35 + snap * 0.35) * p.gain;
  }
  return out;
}

function genBallball(p) {
  var n = Math.round(SAMPLE_RATE * p.dur);
  var out = new Float32Array(n);
  var noise = makeNoise(202);
  for (var i = 0; i < n; i++) {
    var t = i / SAMPLE_RATE;
    var env = Math.exp(-t / p.tau);                 // very short bright decay
    var body = Math.sin(2 * Math.PI * p.f1 * t) +   // high fundamental ~1.3kHz "ping"
      0.5 * Math.sin(2 * Math.PI * p.f2 * t) +      // octave
      0.25 * Math.sin(2 * Math.PI * p.f3 * t);      // third harmonic = crystalline
    var snap = noise() * Math.exp(-t / p.snapTau);  // tiny contact transient
    out[i] = (body * env * 0.85 + snap * 0.15) * p.gain;
  }
  return out;
}

function genRail(p) {
  var n = Math.round(SAMPLE_RATE * p.dur);
  var out = new Float32Array(n);
  var noise = makeNoise(303);
  for (var i = 0; i < n; i++) {
    var t = i / SAMPLE_RATE;
    var env = Math.exp(-t / p.tau);                 // muffled felt tail, longer
    var body = Math.sin(2 * Math.PI * p.f1 * t) +   // dull low-mid ~300Hz
      0.25 * Math.sin(2 * Math.PI * p.f2 * t);      // mild octave (absorbed)
    var thump = Math.sin(2 * Math.PI * p.subF * t); // low cushion "thump" weight
    var felt = noise() * Math.exp(-t / p.feltTau);  // soft muffled felt noise (no tip snap)
    out[i] = (body * env * 0.6 + thump * expDecay(t, 0.08) * 0.5 + felt * 0.12) * p.gain;
  }
  return out;
}

function genPocket(p) {
  var n = Math.round(SAMPLE_RATE * p.dur);
  var out = new Float32Array(n);
  var noise = makeNoise(404);
  var phase = 0;
  for (var i = 0; i < n; i++) {
    var t = i / SAMPLE_RATE;
    // entry click: ball rimming the hole, tiny soft transient at t=0
    var click = noise() * Math.exp(-t / 0.004) * 0.15;
    // falling "plop": pitch glides down as the ball drops into the hole
    var f = p.fStart + (p.fEnd - p.fStart) * Math.min(t / p.glide, 1);
    phase += 2 * Math.PI * f / SAMPLE_RATE;
    var bodyEnv = Math.exp(-t / (p.glide * 0.8)) * Math.min(1, t / 0.015);
    var body = Math.sin(phase) * bodyEnv;
    // bottom thump + faint single bounce when the ball lands in the pocket
    var thump = 0;
    if (t > p.glide - 0.02) {
      var tt = t - (p.glide - 0.02);
      thump = Math.sin(2 * Math.PI * p.thumpF * t) * Math.exp(-tt / 0.05);
      if (tt > 0.035) thump += 0.35 * Math.sin(2 * Math.PI * p.thumpF * t) * Math.exp(-(tt - 0.035) / 0.04);
    }
    out[i] = (body * 0.7 + thump * 0.6 + click) * p.gain;
  }
  return out;
}

/* Small helper: exp decay from t=0, used for the low rail thump. */
function expDecay(t, tau) { return Math.exp(-t / tau); }

/* Ascending (win) or descending (loss) arpeggio with vibrato + harmonics.
   win  -> bright timbre, faster notes, major ascending = clearly positive
   loss -> dark timbre, slower notes, minor-ish descending = deflating */
function genArp(p) {
  var n = Math.round(SAMPLE_RATE * p.dur);
  var out = new Float32Array(n);
  for (var i = 0; i < n; i++) {
    var t = i / SAMPLE_RATE;
    var s = 0;
    for (var k = 0; k < p.notes.length; k++) {
      var f = p.notes[k][0], start = p.notes[k][1];
      if (t < start) continue;
      var dt = t - start;
      var env = Math.exp(-dt / p.noteTau);          // slow decay = deflating feel
      var atk = Math.min(1, dt / 0.02);            // soft attack so notes don't click
      var ff = f * (1 + p.vib * Math.sin(2 * Math.PI * 5 * t)); // gentle vibrato
      for (var h = 0; h < p.harmonics.length; h++) {
        s += p.harmonics[h] * Math.sin(2 * Math.PI * ff * (h + 1) * dt) * env * atk;
      }
    }
    out[i] = s * p.gain;
  }
  return out;
}

/* ============================= WAV writer ======================== */
function putTag(dv, off, str) {
  for (var i = 0; i < str.length; i++) dv.setUint8(off + i, str.charCodeAt(i));
}

function writeWav(filePath, samples) {
  var n = samples.length;
  var buf = new ArrayBuffer(44 + n * 2);
  var dv = new DataView(buf);
  putTag(dv, 0, 'RIFF');
  dv.setUint32(4, 44 + n * 2, true);   // file size
  putTag(dv, 8, 'WAVE');
  putTag(dv, 12, 'fmt ');
  dv.setUint32(16, 16, true);          // fmt sub-chunk size
  dv.setUint16(20, 1, true);           // PCM
  dv.setUint16(22, 1, true);           // mono
  dv.setUint32(24, SAMPLE_RATE, true); // rate
  dv.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  dv.setUint16(32, 2, true);           // block align
  dv.setUint16(34, 16, true);          // bits per sample
  putTag(dv, 36, 'data');
  dv.setUint32(40, n * 2, true);       // data size
    var sv = new Int16Array(buf, 44, n); // samples (little-endian)
    for (var i = 0; i < n; i++) {
      var v = Math.round(samples[i] * 32767);
      if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
      sv[i] = v;
    }
    fs.writeFileSync(filePath, Buffer.from(buf)); // copy ArrayBuffer -> Buffer
}

/* Peak-normalise to 0.95 so every sound is comparable but not clipped. */
function normalize(out) {
  var peak = 0;
  for (var i = 0; i < out.length; i++) if (Math.abs(out[i]) > peak) peak = Math.abs(out[i]);
  if (peak <= 1e-9) return out;
  var scale = 0.95 / peak;
  for (var i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/* ============================= main ============================ */
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  var gen = { strike: genStrike, ballball: genBallball, rail: genRail, pocket: genPocket };
  for (var name in SOUNDS) {
    var p = SOUNDS[name];
    var samples = (name === 'win' || name === 'loss') ? genArp(p) : gen[name](p);
    normalize(samples);
    writeWav(path.join(OUT_DIR, name + '.wav'), samples);
    console.log('wrote ' + name + '.wav  (' + p.dur.toFixed(2) + 's, ' + samples.length + ' samples)');
  }
}

main();
