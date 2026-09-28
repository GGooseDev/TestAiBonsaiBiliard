/* Extract the real fragment shader text from webgl3d.js exactly as the runtime
   builds it (fs array joined with \n, N substituted), then validate bracket
   balance. This is the parse-level check my CPU math-oracle missed. */
'use strict';
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, 'src', 'webgl3d.js'), 'utf8');
var N = 26; // C.BOKEH_COUNT (match webgl3d.js makeBokehFloor default)

var lines = src.split(/\r?\n/);
var startI = -1;
for (var i = 0; i < lines.length; i++) {
  if (/^\s*var fs\s*=\s*\[\s*$/.test(lines[i])) { startI = i; break; }
}
if (startI === -1) throw new Error('could not find `var fs = [`');
var endI = -1;
for (var j = startI + 1; j < lines.length; j++) {
  if (/^\s*\]\s*;$/.test(lines[j])) { endI = j; break; }
}
if (endI === -1) throw new Error('could not find closing `];` for fs array');

var out = [];
for (var k = startI + 1; k < endI; k++) {
  var L = lines[k].trim();
  if (L === '' || L.indexOf('//') >= 0) continue; // skip comments
  var s;
  if (L.indexOf('+ N +') >= 0) {
    // "part1" + N + "part2"  ->  part1 <N> part2
    var parts = L.split('+ N +');
    s = parts[0].replace(/^"/, '').replace(/"(\s*)$/ , '$1') ;
    // strip the outer quotes on each raw part
    s = parts[0].replace(/^"(.*)$/s, '$1').replace(/(\+ N \+)$/, '');
    var tail = (parts[1] || '');
    s += N.toString();
    s += tail.replace(/^\s*"/, '').replace(/"\s*$/, '');
  } else {
    // plain "str"
    s = L.replace(/^"(.*?)"\s*$/, '$1');
    if (s === '') s = L.replace(/^"/, '').replace(/"$/, '');
  }
  out.push(s);
}
var shaderSrc = out.join('\n');

var stack = [];
var pairs = { ')': '(', ']': '[', '}': '{' };
for (var p = 0; p < shaderSrc.length; p++) {
  var ch = shaderSrc[p];
  if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
  else if (pairs[ch]) {
    if (stack.pop() !== pairs[ch]) {
      console.error('UNBALANCED at char ' + p + ': expected ' + pairs[ch] + ', got ' + ch);
      console.error('context: ...' + shaderSrc.slice(Math.max(0, p - 40), p + 20).replace(/\n/g, '\\n') + '...');
      process.exit(1);
    }
  }
}
if (stack.length) { console.error('UNCLOSED ' + stack.length + ' open bracket(s): ' + stack.join('')); process.exit(1); }

console.log('FRAGMENT SHADER: ' + shaderSrc.length + ' chars, all brackets balanced. OK');
