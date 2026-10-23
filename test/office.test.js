// The office map: everything reachable, and no furniture painted where ducks walk.
const test = require('node:test');
const assert = require('node:assert/strict');

// A fake canvas that records the rectangles painted on it (nothing is rasterised).
class RecordingContext {
  constructor(canvas) { this.canvas = canvas; this.fillStyle = ''; this.globalAlpha = 1; }
  fillRect(x, y, w, h) { if (w > 0 && h > 0) this.canvas.rects.push([x, y, w, h]); }
  drawImage(img, ...a) {
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; } else if (a.length === 4) [dx, dy, dw, dh] = a;
    else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    for (const [x, y, w, h] of img.rects || []) {
      const x0 = Math.max(x, sx, 0), y0 = Math.max(y, sy, 0);
      const x1 = Math.min(x + w, sx + sw, img.width), y1 = Math.min(y + h, sy + sh, img.height);
      if (x1 > x0 && y1 > y0) this.canvas.rects.push([dx + (x0 - sx) * (dw / sw), dy + (y0 - sy) * (dh / sh), (x1 - x0) * (dw / sw), (y1 - y0) * (dh / sh)]);
    }
  }
  clearRect() {}
  createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
  putImageData() {}
}
globalThis.document = {
  createElement: () => {
    const c = { width: 0, height: 0, rects: [] };
    c.getContext = () => new RecordingContext(c);
    return c;
  },
};

require('../src/shared/tools.js');
require('../src/renderer/palette.js');
require('../src/renderer/font.js');
require('../src/renderer/sprites.js');
require('../src/renderer/office.js');
const O = globalThis.DO.office;

test('every seat and station can be reached from the elevator', () => {
  assert.deepEqual(O.validate(), []);
});

test('stations stand on free floor, seats and furniture block their tiles', () => {
  for (const [name, list] of Object.entries(O.STATIONS)) for (const s of list) assert.ok(O.walkable(s.c, s.r), `${name} spot ${s.c},${s.r}`);
  for (const s of [...O.SEATS, ...O.LOUNGE, ...O.MEETING]) assert.ok(!O.walkable(s.tile.c, s.tile.r), `seat ${s.id} must not be a corridor`);
  for (const f of O.FURN) for (const [c, r] of f.tiles) assert.ok(!O.walkable(c, r), `${f.name} at ${c},${r}`);
});

// Pixels painted by each piece of furniture, counted per tile.
function paintedTiles(f) {
  const canvas = document.createElement('canvas');
  canvas.width = O.W; canvas.height = O.MAP_H;
  const g = canvas.getContext('2d');
  for (const part of f.parts) part.draw(g, 1000);
  const hits = new Map();
  for (const [x, y, w, h] of canvas.rects) {
    for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
      for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
        const key = Math.floor(px / O.T) + ',' + Math.floor(py / O.T);
        hits.set(key, (hits.get(key) || 0) + 1);
      }
    }
  }
  return hits;
}

// every desk busy and every pod labelled: draws laptops, monitors and nameplates too
for (const s of O.SEATS) O.dyn.seats[s.id] = { state: 'tool', cat: 'exec' };
for (const p of O.PODS) O.dyn.podLabels[p.id] = 'DUCKS';
O.dyn.globe = true;

test('no furniture is painted over walkable floor beside or below it', () => {
  const problems = [];
  for (const f of O.FURN) {
    const own = new Set(f.tiles.map(([c, r]) => c + ',' + r));
    const top = Math.min(...f.tiles.map(([, r]) => r));
    for (const [tile, n] of paintedTiles(f)) {
      const [c, r] = tile.split(',').map(Number);
      if (own.has(tile) || r < top || !O.walkable(c, r)) continue; // tall things may rise over the tile behind
      problems.push(`${f.name} paints ${n}px on walkable tile ${tile}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('no piece of furniture is drawn over another one', () => {
  const owner = new Map();
  for (const f of O.FURN) for (const [c, r] of f.tiles) owner.set(c + ',' + r, f.name);
  const problems = [];
  for (const f of O.FURN) {
    for (const [tile, n] of paintedTiles(f)) {
      const other = owner.get(tile);
      if (other && other !== f.name && n > 24) problems.push(`${f.name} covers ${n}px of ${other} (${tile})`);
    }
  }
  assert.deepEqual(problems, []);
});
