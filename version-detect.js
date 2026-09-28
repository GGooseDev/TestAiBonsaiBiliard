'use strict';
var fs = require('fs');
var p = require('path').join(__dirname, 'lib', 'three.min.js');
var s = fs.readFileSync(p, 'utf8');
var tokens = ['r150','r160','r169','r123','r153','r163','r155','r151'];
tokens.forEach(function (tok) {
  var i = s.indexOf(tok);
  if (i >= 0) {
    console.log(tok + ' @' + i + ': ' + JSON.stringify(s.slice(Math.max(0, i - 45), Math.min(s.length, i + 45))));
  }
});
// also search for a version assignment pattern
var re = /"[a-z]{3,}"\s*:\s*"r[0-9]{2,3}"/g;
var m; var seen = {};
while ((m = re.exec(s))) { if (!seen[m[0]]) { seen[m[0]] = 1; console.log('VERPAIR: ' + JSON.stringify(m[0])); } }
// search for "version" near a number
var i = s.indexOf('"version"');
console.log('version key at', i, i >= 0 ? s.slice(Math.max(0, i - 25), Math.min(s.length, i + 30)) : 'N/A');
