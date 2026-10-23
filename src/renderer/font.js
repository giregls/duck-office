// Tiny 3x5 bitmap font. Text is upper-cased and accents are stripped so French
// labels stay readable ("Réfléchit" -> "REFLECHIT").
(function (DO) {
  const G = {
    A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'], B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'],
    C: ['.XX', 'X..', 'X..', 'X..', '.XX'], D: ['XX.', 'X.X', 'X.X', 'X.X', 'XX.'],
    E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'], F: ['XXX', 'X..', 'XX.', 'X..', 'X..'],
    G: ['.XX', 'X..', 'X.X', 'X.X', '.XX'], H: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'],
    I: ['XXX', '.X.', '.X.', '.X.', 'XXX'], J: ['..X', '..X', '..X', 'X.X', '.X.'],
    K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'], L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
    M: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'], N: ['XX.', 'X.X', 'X.X', 'X.X', 'X.X'],
    O: ['.X.', 'X.X', 'X.X', 'X.X', '.X.'], P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
    Q: ['.X.', 'X.X', 'X.X', 'XX.', '.XX'], R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
    S: ['.XX', 'X..', '.X.', '..X', 'XX.'], T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
    U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'], V: ['X.X', 'X.X', 'X.X', 'X.X', '.X.'],
    W: ['X.X', 'X.X', 'XXX', 'XXX', 'X.X'], X: ['X.X', 'X.X', '.X.', 'X.X', 'X.X'],
    Y: ['X.X', 'X.X', '.X.', '.X.', '.X.'], Z: ['XXX', '..X', '.X.', 'X..', 'XXX'],
    0: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'], 1: ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
    2: ['XX.', '..X', '.X.', 'X..', 'XXX'], 3: ['XX.', '..X', '.X.', '..X', 'XX.'],
    4: ['X.X', 'X.X', 'XXX', '..X', '..X'], 5: ['XXX', 'X..', 'XX.', '..X', 'XX.'],
    6: ['.XX', 'X..', 'XXX', 'X.X', 'XXX'], 7: ['XXX', '..X', '.X.', '.X.', '.X.'],
    8: ['XXX', 'X.X', 'XXX', 'X.X', 'XXX'], 9: ['XXX', 'X.X', 'XXX', '..X', 'XX.'],
    '.': ['...', '...', '...', '...', '.X.'], ',': ['...', '...', '...', '.X.', 'X..'],
    ':': ['...', '.X.', '...', '.X.', '...'], ';': ['...', '.X.', '...', '.X.', 'X..'],
    '!': ['.X.', '.X.', '.X.', '...', '.X.'], '?': ['XX.', '..X', '.X.', '...', '.X.'],
    '-': ['...', '...', 'XXX', '...', '...'], '+': ['...', '.X.', 'XXX', '.X.', '...'],
    '/': ['..X', '..X', '.X.', 'X..', 'X..'], '\\': ['X..', 'X..', '.X.', '..X', '..X'],
    '(': ['.X.', 'X..', 'X..', 'X..', '.X.'], ')': ['.X.', '..X', '..X', '..X', '.X.'],
    '[': ['XX.', 'X..', 'X..', 'X..', 'XX.'], ']': ['.XX', '..X', '..X', '..X', '.XX'],
    "'": ['.X.', '.X.', '...', '...', '...'], '"': ['X.X', 'X.X', '...', '...', '...'],
    '#': ['X.X', 'XXX', 'X.X', 'XXX', 'X.X'], '%': ['X.X', '..X', '.X.', 'X..', 'X.X'],
    '>': ['X..', '.X.', '..X', '.X.', 'X..'], '<': ['..X', '.X.', 'X..', '.X.', '..X'],
    '_': ['...', '...', '...', '...', 'XXX'], '=': ['...', 'XXX', '...', 'XXX', '...'],
    '*': ['X.X', '.X.', 'X.X', '...', '...'], '&': ['.X.', 'X.X', '.X.', 'X.X', '.XX'],
    '@': ['XXX', 'X.X', 'X.X', 'X..', '.XX'], '·': ['...', '...', '.X.', '...', '...'],
    '…': ['...', '...', '...', '...', 'X.X'], '|': ['.X.', '.X.', '.X.', '.X.', '.X.'],
    '~': ['...', '.X.', 'X.X', '...', '...'], '$': ['.XX', 'XX.', '.X.', '.XX', 'XX.'],
  };
  const CHARS = Object.keys(G);
  const INDEX = new Map(CHARS.map((ch, i) => [ch, i]));
  const atlases = new Map();

  function norm(text) {
    return String(text == null ? '' : text)
      .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’‘`]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-')
      .toUpperCase();
  }

  function atlas(color) {
    let c = atlases.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CHARS.length * 4;
    c.height = 5;
    const g = c.getContext('2d');
    g.fillStyle = color;
    CHARS.forEach((ch, i) => {
      G[ch].forEach((row, y) => {
        for (let x = 0; x < 3; x++) if (row[x] === 'X') g.fillRect(i * 4 + x, y, 1, 1);
      });
    });
    atlases.set(color, c);
    return c;
  }

  function measure(text) {
    const s = norm(text);
    return s.length ? s.length * 4 - 1 : 0;
  }

  function draw(ctx, text, x, y, color) {
    const s = norm(text);
    const a = atlas(color);
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (const ch of s) {
      const i = INDEX.get(ch);
      if (i !== undefined) ctx.drawImage(a, i * 4, 0, 3, 5, cx, cy, 3, 5);
      cx += 4;
    }
    return cx - x;
  }

  // Text with a 1px outline all around (readable on any background).
  function outlined(ctx, text, x, y, color, outline) {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) draw(ctx, text, x + dx, y + dy, outline);
    draw(ctx, text, x, y, color);
  }

  // Cut a string so that it fits in maxWidth pixels.
  function fit(text, maxWidth) {
    const s = norm(text);
    const max = Math.max(0, Math.floor((maxWidth + 1) / 4));
    if (s.length <= max) return s;
    return max <= 1 ? s.slice(0, max) : s.slice(0, max - 1) + '…';
  }

  DO.font = { draw, outlined, measure, fit, norm, glyphs: G };
})(globalThis.DO = globalThis.DO || {});
