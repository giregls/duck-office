// Writes the duck .ico used by the shortcuts: node scripts/make-icon.js [out.ico]
const path = require('path');
const { writeIco } = require('../src/main/icons');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'build', 'duck.ico'));
writeIco(out);
console.log(out);
