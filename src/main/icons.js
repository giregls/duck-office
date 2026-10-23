// App, window and tray icons, generated from the duck sprite (no image files).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

require('../renderer/palette.js');
require('../renderer/sprites.js');
const DO = globalThis.DO;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// The rubber duck, scaled by an integer factor and centred in a size x size square.
function duckRGBA(size, alert) {
  const { w, data } = DO.sprites.decode(DO.sprites.DUCK.front_a, DO.sprites.duckMap(0));
  const k = Math.max(1, Math.floor(size / 16));
  const off = Math.floor((size - 16 * k) / 2);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < 16 * k; y++) {
    for (let x = 0; x < 16 * k; x++) {
      const s = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      const d = ((y + off) * size + (x + off)) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = data[s + c];
    }
  }
  if (alert) {
    // red badge with a white "!" in the top-right corner
    const r = Math.max(3, Math.round(size * 0.2));
    const cx = size - r - 1, cy = r + 1;
    const set = (x, y, rgb) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const d = (y * size + x) * 4;
      out[d] = rgb[0]; out[d + 1] = rgb[1]; out[d + 2] = rgb[2]; out[d + 3] = 255;
    };
    for (let y = -r - 1; y <= r + 1; y++) {
      for (let x = -r - 1; x <= r + 1; x++) {
        const dist = Math.sqrt(x * x + y * y);
        if (dist <= r) set(cx + x, cy + y, DO.hexToRgb(DO.C.red));
        else if (dist <= r + 1) set(cx + x, cy + y, DO.hexToRgb(DO.C.outline));
      }
    }
    const bar = Math.max(1, Math.floor(r / 3));
    for (let y = cy - r + 1; y <= cy + r - 3; y++) for (let x = 0; x < bar; x++) set(cx - (bar >> 1) + x, y, [255, 255, 255]);
    for (let y = cy + r - 1 - bar; y < cy + r - 1; y++) for (let x = 0; x < bar; x++) set(cx - (bar >> 1) + x, y, [255, 255, 255]);
  }
  return out;
}

const pngOf = (size, alert) => png(size, size, duckRGBA(size, alert));
const dataUrl = (buf) => 'data:image/png;base64,' + buf.toString('base64');

function trayImage(nativeImage, alert) {
  const img = nativeImage.createEmpty();
  for (const [scaleFactor, size] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32]]) {
    img.addRepresentation({ scaleFactor, width: size, height: size, dataURL: dataUrl(pngOf(size, alert)) });
  }
  return img;
}

function ico(sizes) {
  const images = sizes.map((s) => ({ s, data: pngOf(s, false) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((im, i) => {
    const b = i * 16;
    dir[b] = im.s >= 256 ? 0 : im.s;
    dir[b + 1] = im.s >= 256 ? 0 : im.s;
    dir.writeUInt16LE(1, b + 4);
    dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(im.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += im.data.length;
  });
  return Buffer.concat([head, dir, ...images.map((im) => im.data)]);
}

function writeIco(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ico([16, 20, 24, 32, 40, 48, 64, 256]));
  return file;
}

module.exports = { png, duckRGBA, trayImage, writeIco };
