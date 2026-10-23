// Every sprite is a grid of characters decoded at startup — no image files.
// Duck legend: k outline, e eye, p cheek, O/o bill & feet, L/H/D head
// (light/base/shade), l/B/d body (light/base/shade). '.' is transparent.
(function (DO) {
  const C = DO.C;

  const DUCK = {
    front_a: [
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHeHHHHeHk...',
      '...kHeHHHHeHk...',
      '...kpHOOOOHpk...',
      '...kDHoOOoHDk...',
      '....kDHHHHDk....',
      '..kkBBBBBBBBkk..',
      '.kdllBBBBBBBBdk.',
      '.kddlBBBBBBBddk.',
      '.kddBBBBBBBBddk.',
      '..kddBBBBBBddk..',
      '...kkkkkkkkkk...',
      '....OOo..oOO....',
    ],
    front_b: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHeHHHHeHk...',
      '...kHeHHHHeHk...',
      '...kpHOOOOHpk...',
      '...kDHoOOoHDk...',
      '....kDHHHHDk....',
      '..kkBBBBBBBBkk..',
      '.kdllBBBBBBBBdk.',
      '.kddBBBBBBBBddk.',
      '..kddBBBBBBddk..',
      '...kkkkkkkkkk...',
      '....OOo..oOO....',
    ],
    raise: [
      '................',
      '.kk..kkkkkk.....',
      'kddkkLLHHHHk....',
      'kddkLHHHHHHHk...',
      'kddkHeHHHHeHk...',
      '.kdkHeHHHHeHk...',
      '.kdkpHOOOOHpk...',
      '..kddHoOOoHDk...',
      '...kddHHHHDk....',
      '..kkBBBBBBBBkk..',
      '..kllBBBBBBBBdk.',
      '..kdlBBBBBBBddk.',
      '..kdBBBBBBBBddk.',
      '..kddBBBBBBddk..',
      '...kkkkkkkkkk...',
      '....OOo..oOO....',
    ],
    cheer: [
      '................',
      '.kk..kkkkkk..kk.',
      'kddkkLLHHHHkkddk',
      'kddkLHHHHHHHkddk',
      'kddkHeHHHHeHkddk',
      '.kdkHeHHHHeHkdk.',
      '.kdkpHOOOOHpkdk.',
      '..kddHoOOoHDddk.',
      '...kddHHHHDddk..',
      '...kBBBBBBBBk...',
      '..kllBBBBBBBBk..',
      '..klBBBBBBBBBk..',
      '..kBBBBBBBBBBk..',
      '..kdBBBBBBBBdk..',
      '...kkkkkkkkkk...',
      '....OOo..oOO....',
    ],
    nap: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHkkHHkkHk...',
      '...kpHOOOOHpk...',
      '...kDHoOOoHDk...',
      '....kDHHHHDk....',
      '..kkBBBBBBBBkk..',
      '.kdllBBBBBBBBdk.',
      '.kddBBBBBBBBddk.',
      '..kddBBBBBBddk..',
      '...kkkkkkkkkk...',
      '................',
    ],
    back: [
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kDHHHHHHDk...',
      '....kDHHHHDk....',
      '..kkBBBBBBBBkk..',
      '.kdllBBBBBBBBdk.',
      '.kddlBBBBBBBddk.',
      '.kddBBBlBBBBddk.',
      '..kddBlllBBddk..',
      '...kkkkklkkkk...',
      '....OOo..oOO....',
    ],
    work_back: [
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kDHHHHHHDk...',
      '.kk.kDHHHHDk....',
      'kddkBBBBBBBBkk..',
      'kddBBBBBBBBBBdk.',
      '.kkBBBBBBBBBBddk',
      '..kBBBBlBBBBBddk',
      '..kddBBlllBBBkk.',
      '...kkkkklkkkk...',
      '....OOo..oOO....',
    ],
    side_1: [
      '................',
      '........kkkk....',
      '.......kLLHHk...',
      '......kLHHHeHk..',
      '......kHHHHeHOOo',
      '......kHHHHpHoo.',
      '......kDHHHHHk..',
      '.......kDHHHk...',
      'kBk....kBBBBk...',
      'kBBkkkkBBBBBk...',
      '.klllBBBBBBBBk..',
      '.kBBddddddBBBBk.',
      '.kBBBdddddBBBBk.',
      '..kdBBBBBBBBdk..',
      '...kkkkkkkkkk...',
      '....OOO..OOO....',
    ],
    side_2: [
      '........kkkk....',
      '.......kLLHHk...',
      '......kLHHHeHk..',
      '......kHHHHeHOOo',
      '......kHHHHpHoo.',
      '......kDHHHHHk..',
      '.......kDHHHk...',
      'kBk....kBBBBk...',
      'kBBkkkkBBBBBk...',
      '.klllBBBBBBBBk..',
      '.kBBddddddBBBBk.',
      '.kBBBdddddBBBBk.',
      '..kdBBBBBBBBdk..',
      '...kkkkkkkkkk...',
      '....oo...O......',
      '........OOO.....',
    ],
    sitf_type_a: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHeHHHHeHk...',
      '...kpHOOOOHpk...',
      '.kk.kDoOOoDk....',
      'kddkBBBBBBBBkk..',
      'kddBBBBBBBBBBdk.',
      '.kkBBBBBBBBBBddk',
      '..kBBBBBBBBBBddk',
      '..kBBBBBBBBBBkk.',
      '..kBBBBBBBBBBk..',
      '...kkkkkkkkkk...',
    ],
    sitf_type_b: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHeHHHHeHk...',
      '...kpHOOOOHpk...',
      '....kDoOOoDk.kk.',
      '..kkBBBBBBBBkddk',
      '.kdBBBBBBBBBBddk',
      'kddBBBBBBBBBBkk.',
      'kddBBBBBBBBBBk..',
      '.kkBBBBBBBBBBk..',
      '..kBBBBBBBBBBk..',
      '...kkkkkkkkkk...',
    ],
    sitf_think: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLeHHHHeHk...',
      '...kHeHHHHeHk...',
      '...kHHHHHHHHk...',
      '...kpHOOOOHpk...',
      '....kDoOOoDk....',
      '..kkBBBBBBBBkk..',
      '.kdlBBBBBBBBBdk.',
      '.kddBBBBBBBBddk.',
      '.kddBBBBBBBBddk.',
      '..kdBBBBBBBBdk..',
      '..kBBBBBBBBBBk..',
      '...kkkkkkkkkk...',
    ],
    sitb_type_a: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kDHHHHHHDk...',
      '.kk.kDHHHHDk....',
      'kddkBBBBBBBBkk..',
      'kddBBBBBBBBBBdk.',
      '.kkBBBBBBBBBBddk',
      '..kBBBBBBBBBBddk',
      '..kBBBBBlBBBBkk.',
      '..kBBBBlllBBBk..',
      '...kkkkkkkkkk...',
    ],
    sitb_type_b: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kDHHHHHHDk...',
      '....kDHHHHDk.kk.',
      '..kkBBBBBBBBkddk',
      '.kdBBBBBBBBBBddk',
      'kddBBBBBBBBBBkk.',
      'kddBBBBBlBBBBk..',
      '.kkBBBBlllBBBk..',
      '..kBBBBBlBBBBk..',
      '...kkkkkkkkkk...',
    ],
    sitb_idle: [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kLLHHHHk....',
      '...kLHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kHHHHHHHHk...',
      '...kDHHHHHHDk...',
      '....kDHHHHDk....',
      '..kkBBBBBBBBkk..',
      '.kdlBBBBBBBBBdk.',
      '.kddBBBBBBBBddk.',
      '.kddBBBBBBBBddk.',
      '..kdBBBBlBBBdk..',
      '..kBBBBlllBBBk..',
      '...kkkkkkkkkk...',
    ],
  };

  // Derived frames: blinking, scanning eyes, walking feet, sleeping at a desk.
  const withRows = (grid, rows) => grid.map((r, i) => (rows[i] !== undefined ? rows[i] : r));
  const NO_EYES = '...kHHHHHHHHk...';
  DUCK.front_blink = withRows(DUCK.front_a, { 4: NO_EYES, 5: '...kHkkHHkkHk...' });
  DUCK.front_walk_a = withRows(DUCK.front_a, { 15: '....OOo.........' });
  DUCK.front_walk_b = withRows(DUCK.front_a, { 15: '.........oOO....' });
  DUCK.back_walk_a = withRows(DUCK.back, { 15: '....OOo.........' });
  DUCK.back_walk_b = withRows(DUCK.back, { 15: '.........oOO....' });
  DUCK.side_3 = DUCK.side_1;
  DUCK.side_4 = withRows(DUCK.side_2, { 14: '......O...oo....', 15: '.....OOO........' });
  DUCK.sitf_read_a = withRows(DUCK.sitf_think, { 4: '...kLHHHHHHHk...', 5: NO_EYES, 6: '...keHHHHeHHk...' });
  DUCK.sitf_read_b = withRows(DUCK.sitf_think, { 4: '...kLHHHHHHHk...', 5: NO_EYES, 6: '...kHHeHHHHek...' });
  DUCK.sitf_nap = withRows(DUCK.sitf_think, { 4: '...kLHHHHHHHk...', 5: NO_EYES, 6: '...kHkkHHkkHk...' });

  // Where the hat goes for each frame, relative to front_a ([dx, dy]).
  const HAT_AT = {
    front_a: [0, 0], front_b: [0, 1], front_blink: [0, 0], front_walk_a: [0, 0], front_walk_b: [0, 0],
    raise: [0, 0], cheer: [0, 0], nap: [0, 1], back: [0, 0], back_walk_a: [0, 0], back_walk_b: [0, 0], work_back: [0, 0],
    side_1: [2, 0], side_2: [2, -1], side_3: [2, 0], side_4: [2, -1],
    sitf_type_a: [0, 1], sitf_type_b: [0, 1], sitf_think: [0, 1], sitf_read_a: [0, 1], sitf_read_b: [0, 1], sitf_nap: [0, 1],
    sitb_type_a: [0, 1], sitb_type_b: [0, 1], sitb_idle: [0, 1],
  };

  // Hats tell apart the sessions of a same project. dy = first row's offset.
  const HATS = {
    cap: { dy: -1, map: { R: C.red, r: C.wine }, grid: [
      '.....kkkkkk.....',
      '....kRRRRRRk....',
      '...kRRRRRRRRk...',
      '..krrrrrrrrrrk..',
    ] },
    beanie: { dy: -3, map: { R: C.blue, W: C.white }, grid: [
      '.......kk.......',
      '......kWWk......',
      '....kkRRRRkk....',
      '...kRRRRRRRRk...',
      '...kWWWWWWWWk...',
    ] },
    headphones: { dy: -1, map: { R: C.hot }, grid: [
      '.....kkkkkk.....',
      '....kRRRRRRk....',
      '...kRk....kRk...',
      '...kk......kk...',
      '..kRRk....kRRk..',
      '..kRRk....kRRk..',
      '...kk......kk...',
    ] },
    propeller: { dy: -4, map: { R: C.red, Y: C.yellow }, frames: 2, grid: [
      '...kYYYkkYYYk...',
      '.......kk.......',
      '.....kkkkkk.....',
      '....kRYRYRYk....',
      '...kRYRYRYRYk...',
      '...kkkkkkkkkk...',
    ], alt: { 0: '.....kYkkYk.....' } },
    bow: { dy: -1, map: { R: C.hot }, grid: [
      '.........kk.kk..',
      '........kRRkRRk.',
      '.........kkkkk..',
    ] },
  };
  const HAT_NAMES = [null, 'cap', 'beanie', 'headphones', 'propeller', 'bow'];

  const DUCKLING = {
    front: [
      '....kk....',
      '..kkLHkk..',
      '.kLHHHHHk.',
      '.kHeHHeHk.',
      '.kpHOOHpk.',
      '.kDHooHDk.',
      '.kdBBBBdk.',
      'kdBBBBBBdk',
      '.kkkkkkkk.',
      '..OO..OO..',
    ],
    side: [
      '....kkk...',
      '...kLHHk..',
      '...kHHeHOo',
      '...kHHpHo.',
      '.k.kDHHk..',
      'kBkkBBBBk.',
      'kBBBBBBBBk',
      '.kdddBBBdk',
      '..kkkkkkk.',
      '...OO.OO..',
    ],
  };
  DUCKLING.hop = withRows(DUCKLING.front, { 9: '...OO.OO..' });
  DUCKLING.back = withRows(DUCKLING.front, { 3: '.kHHHHHHk.', 4: '.kHHHHHHk.', 5: '.kDHHHHDk.' });
  DUCKLING.side_hop = withRows(DUCKLING.side, { 9: '....O.O...' });

  const EGG = {
    whole: ['..kk..', '.kwwk.', 'kwwwwk', 'kwswwk', 'kwwwsk', 'kswwwk', 'kgwwgk', '.kkkk.'],
    crack: ['..kk..', '.kwwk.', 'kwwwwk', 'kkwkwk', 'kwkwkk', 'kswwwk', 'kgwwgk', '.kkkk.'],
  };

  // 8x8 icons: x = ink, y = glint.
  const ICONS = {
    q: ['..xxxx..', '.xx..xx.', '.....xx.', '....xx..', '...xx...', '...xx...', '........', '...xx...'],
    excl: ['...xx...', '...xx...', '...xx...', '...xx...', '...xx...', '........', '...xx...', '...xx...'],
    dots1: ['........', '........', '........', '........', 'xx......', 'xx......', '........', '........'],
    dots2: ['........', '........', '........', '........', 'xx.xx...', 'xx.xx...', '........', '........'],
    dots3: ['........', '........', '........', '........', 'xx.xx.xx', 'xx.xx.xx', '........', '........'],
    zz: ['...xxxxx', '......x.', '.....x..', '....x...', '...xxxxx', 'xxx.....', '.x......', 'xxx.....'],
    gear_a: ['...xx...', '.x.xx.x.', '..xxxx..', 'xxx..xxx', 'xxx..xxx', '..xxxx..', '.x.xx.x.', '...xx...'],
    gear_b: ['xx....xx', 'xx.xx.xx', '..xxxx..', '.xx..xx.', '.xx..xx.', '..xxxx..', 'xx.xx.xx', 'xx....xx'],
    magnifier: ['.xxxx...', 'x....x..', 'x.yy.x..', 'x.y..x..', 'x....x..', '.xxxxx..', '.....xxx', '......xx'],
    book: ['........', 'xxx..xxx', 'x..xx..x', 'x..xx..x', 'x..xx..x', 'x..xx..x', 'xxxxxxxx', '...xx...'],
    pencil: ['......xx', '.....xyx', '....xyx.', '...xyx..', '..xyx...', '.xxx....', '.xx.....', 'x.......'],
    globe: ['..xxxx..', '.x.xx.x.', 'x..xx..x', 'xxxxxxxx', 'x..xx..x', 'x..xx..x', '.x.xx.x.', '..xxxx..'],
    clipboard: ['..xxxx..', '.x.yy.x.', '.x....x.', '.x.xx.x.', '.x....x.', '.x.xx.x.', '.x....x.', '.xxxxxx.'],
    egg: ['...xx...', '..x..x..', '.x....x.', '.x....x.', 'x......x', 'x......x', '.x....x.', '..xxxx..'],
    plug: ['..x..x..', '..x..x..', '.xxxxxx.', '.xxxxxx.', '.xxxxxx.', '..xxxx..', '...xx...', '...xx...'],
    cloud: ['........', '..xxx...', '.xxxxxx.', 'xxxxxxxx', 'xxxxxxxx', '........', '.x..x..x', 'x..x..x.'],
    squeeze: ['x......x', '.x....x.', '..x..x..', '........', '........', '..x..x..', '.x....x.', 'x......x'],
    check: ['........', '.......x', '......xx', 'x....xx.', 'xx..xx..', '.xxxx...', '..xx....', '........'],
    scroll: ['.xxxxxx.', 'x.xxxx.x', '.x....x.', '.x.xx.x.', '.x....x.', '.x.xx.x.', 'x.xxxx.x', '.xxxxxx.'],
    heart: ['.xx..xx.', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', '.xxxxxx.', '..xxxx..', '...xx...', '........'],
    mug: ['.x.x....', 'x.x.....', '........', 'xxxxx...', 'x...xx..', 'x...x.x.', 'x...xx..', '.xxx....'],
    eye: ['........', '..xxxx..', '.x....x.', 'x..xx..x', 'x..xx..x', '.x....x.', '..xxxx..', '........'],
    coin: ['..xxxx..', '.xxyyxx.', 'xxyxxyxx', 'xxyxxxxx', 'xxyxxxxx', 'xxyxxyxx', '.xxyyxx.', '..xxxx..'],
  };

  function check(name, grid) {
    const w = grid[0].length;
    grid.forEach((row, i) => {
      if (row.length !== w) throw new Error(`sprite ${name}: row ${i} has ${row.length} px, expected ${w}`);
    });
  }
  for (const [n, g] of Object.entries(DUCK)) check('duck.' + n, g);
  for (const [n, g] of Object.entries(DUCKLING)) check('duckling.' + n, g);
  for (const [n, g] of Object.entries(EGG)) check('egg.' + n, g);
  for (const [n, g] of Object.entries(ICONS)) check('icon.' + n, g);
  for (const [n, h] of Object.entries(HATS)) check('hat.' + n, h.grid);

  function duckMap(breed) {
    const b = DO.BREEDS[breed % DO.BREEDS.length];
    return {
      k: C.outline, e: C.black, p: b.cheek || C.pink, O: C.orange, o: C.rust,
      L: b.head[0], H: b.head[1], D: b.head[2], l: b.body[0], B: b.body[1], d: b.body[2],
      w: C.white, g: C.silver, s: b.body[1],
    };
  }

  // Pure decoding (usable from Node for the tray icon): returns RGBA pixels.
  function decode(grid, map) {
    const h = grid.length;
    const w = grid[0].length;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const hex = map[grid[y][x]];
        if (!hex) continue;
        const [r, g, b] = DO.hexToRgb(hex);
        const i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    return { w, h, data };
  }

  const cache = new Map();

  function toCanvas(grid, map, mirror) {
    const { w, h, data } = decode(grid, map);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    if (!mirror) img.data.set(data);
    else {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const s = (y * w + x) * 4;
          const d = (y * w + (w - 1 - x)) * 4;
          img.data[d] = data[s]; img.data[d + 1] = data[s + 1]; img.data[d + 2] = data[s + 2]; img.data[d + 3] = data[s + 3];
        }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function cached(key, make) {
    let c = cache.get(key);
    if (!c) { c = make(); cache.set(key, c); }
    return c;
  }

  function duck(frame, breed, mirror) {
    return cached(`d:${frame}:${breed}:${mirror ? 1 : 0}`, () => toCanvas(DUCK[frame], duckMap(breed), mirror));
  }

  function duckling(frame, breed, mirror) {
    return cached(`dl:${frame}:${breed}:${mirror ? 1 : 0}`, () => toCanvas(DUCKLING[frame], duckMap(breed), mirror));
  }

  function egg(frame, breed) {
    return cached(`e:${frame}:${breed}`, () => toCanvas(EGG[frame], duckMap(breed)));
  }

  function hat(name, frame) {
    const h = HATS[name];
    if (!h) return null;
    const alt = h.alt && frame % (h.frames || 1) === 1 ? h.alt : null;
    const grid = alt ? h.grid.map((r, i) => (alt[i] !== undefined ? alt[i] : r)) : h.grid;
    return cached(`h:${name}:${alt ? 1 : 0}`, () => toCanvas(grid, Object.assign({ k: C.outline }, h.map)));
  }

  function icon(name, ink, glint) {
    return cached(`i:${name}:${ink}:${glint || ''}`, () => toCanvas(ICONS[name], { x: ink, y: glint || C.cyan }));
  }

  // Icon with a 1px outline, for icons floating without a bubble (10x10).
  function iconOutlined(name, ink, outline) {
    return cached(`io:${name}:${ink}:${outline}`, () => {
      const src = ICONS[name];
      const c = document.createElement('canvas');
      c.width = 10;
      c.height = 10;
      const g = c.getContext('2d');
      g.fillStyle = outline;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (src[y][x] === '.') continue;
        g.fillRect(x, y + 1, 3, 1);
        g.fillRect(x + 1, y, 1, 3);
      }
      g.drawImage(icon(name, ink, ink), 1, 1);
      return c;
    });
  }

  DO.sprites = { DUCK, DUCKLING, EGG, ICONS, HATS, HAT_NAMES, HAT_AT, duckMap, decode, duck, duckling, egg, hat, icon, iconOutlined };
})(globalThis.DO = globalThis.DO || {});
