// The open space: tile map (30x16 tiles of 16px), furniture drawn in code,
// seats, stations and the dynamic bits (sky, screens, LEDs, elevator).
(function (DO) {
  const C = DO.C;
  const T = 16, COLS = 30, ROWS = 16, W = 480, MAP_H = 256;

  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const P = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  function box(g, x, y, w, h, fill, line) {
    R(g, x, y, w, h, line);
    R(g, x + 1, y + 1, w - 2, h - 2, fill);
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // ---------------------------------------------------------------- map
  const blocked = new Uint8Array(COLS * ROWS);
  function block(c, r, w = 1, h = 1) {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked[y * COLS + x] = 1;
  }
  function walkable(c, r) {
    return c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r * COLS + c];
  }

  block(0, 0, COLS, 2); // north wall
  block(0, 0, 1, ROWS); // side walls
  block(COLS - 1, 0, 1, ROWS);
  block(1, 2); // fridge
  block(2, 2, 5, 1); // kitchen counter
  block(7, 2); // water cooler
  block(3, 6, 2, 1); // cafe table
  block(7, 8); // kitchen plant
  block(20, 2); // plant by the clock
  block(21, 2, 3, 1); // bookshelves
  block(24, 2); // filing cabinet
  block(26, 2); // terminal
  block(27, 2, 2, 1); // server racks
  block(23, 5); // globe
  block(27, 5); // floor lamp
  block(1, 10); // arcade cabinet
  block(3, 13, 2, 1); // lounge coffee table
  block(23, 11, 4, 2); // meeting table
  block(1, 15); block(20, 15); block(28, 15); block(28, 9); // plants

  const PODS = [
    { id: 'A', c: 9, r: 4 }, { id: 'B', c: 15, r: 4 },
    { id: 'C', c: 9, r: 10 }, { id: 'D', c: 15, r: 10 },
  ];
  for (const pod of PODS) block(pod.c, pod.r + 1, 4, 2);

  // Desk seats. Faces alternate: the north duck faces you, the duck across shows
  // its back and its screen.
  const SEATS = [];
  for (const pod of PODS) {
    const X0 = pod.c * T, Y0 = pod.r * T;
    pod.x = X0; pod.y = Y0;
    for (const [side, i] of [['n', 0], ['s', 0], ['n', 1], ['s', 1]]) {
      const cx = X0 + 16 + 32 * i;
      const north = side === 'n';
      SEATS.push({
        id: pod.id + side + i, pod, side, i, cx, kind: 'desk',
        tile: { c: pod.c + 2 * i, r: north ? pod.r : pod.r + 3 },
        point: { x: cx, y: north ? Y0 + 13 : Y0 + 61 },
        sit: { x: cx - 8, y: north ? Y0 + 4 : Y0 + 40, anchor: north ? Y0 + 20 : Y0 + 56, view: north ? 'front' : 'back' },
        desk: { x: cx, y: north ? Y0 + 26 : Y0 + 44, anchor: Y0 + 54.5 },
        perches: north
          ? [{ x: cx - 12, y: Y0 + 29 }, { x: cx + 12, y: Y0 + 29 }]
          : [{ x: cx - 13, y: Y0 + 45 }, { x: cx + 12, y: Y0 + 45 }],
      });
    }
  }

  // Other places to sit (overflow, idle ducks). view: front (facing you) or back.
  function seatAt(id, c, r, view, kind, extra) {
    const x = c * T + 8;
    const sitY = extra && extra.sitY !== undefined ? extra.sitY : (view === 'front' ? r * T - 2 : r * T - 6);
    return Object.assign({
      id, kind, tile: { c, r }, point: { x, y: r * T + 13 },
      sit: { x: x - 8, y: sitY, anchor: (extra && extra.anchor) || r * T + 10, view }, perches: [],
    }, extra || {});
  }
  const LOUNGE = [
    seatAt('sofa0', 2, 11, 'front', 'lounge', { sitY: 11 * T - 4, anchor: 11 * T + 6 }),
    seatAt('sofa1', 3, 11, 'front', 'lounge', { sitY: 11 * T - 4, anchor: 11 * T + 6 }),
    seatAt('sofa2', 4, 11, 'front', 'lounge', { sitY: 11 * T - 4, anchor: 11 * T + 6 }),
    seatAt('arm0', 6, 12, 'front', 'lounge', { sitY: 12 * T - 4, anchor: 12 * T + 6 }),
    seatAt('bean0', 2, 14, 'front', 'lounge', { sitY: 14 * T - 6, anchor: 14 * T + 9 }),
    seatAt('bean1', 5, 14, 'front', 'lounge', { sitY: 14 * T - 6, anchor: 14 * T + 9 }),
    seatAt('arm1', 26, 5, 'front', 'lounge', { sitY: 5 * T - 4, anchor: 5 * T + 6 }),
    seatAt('stool0', 3, 5, 'front', 'lounge', { sitY: 5 * T - 1, anchor: 5 * T + 10 }),
    seatAt('stool1', 4, 5, 'front', 'lounge', { sitY: 5 * T - 1, anchor: 5 * T + 10 }),
    seatAt('stool2', 3, 7, 'back', 'lounge', { sitY: 7 * T - 9, anchor: 7 * T + 8 }),
    seatAt('stool3', 4, 7, 'back', 'lounge', { sitY: 7 * T - 9, anchor: 7 * T + 8 }),
  ];
  const MEETING = [];
  for (let c = 23; c <= 26; c++) MEETING.push(seatAt('meetN' + c, c, 10, 'front', 'meeting', { sitY: 10 * T + 4, anchor: 10 * T + 20 }));
  for (let c = 23; c <= 26; c++) MEETING.push(seatAt('meetS' + c, c, 13, 'back', 'meeting', { sitY: 13 * T - 8, anchor: 13 * T + 8 }));

  const spot = (c, r, face) => ({ c, r, face, x: c * T + 8, y: r * T + 13 });
  const STATIONS = {
    coffee: [spot(3, 3, 'up'), spot(2, 3, 'up')],
    cooler: [spot(7, 3, 'up')],
    whiteboard: [spot(11, 2, 'up'), spot(12, 2, 'up'), spot(10, 2, 'up')],
    shelves: [spot(22, 3, 'up'), spot(21, 3, 'up'), spot(23, 3, 'up')],
    filing: [spot(24, 3, 'up')],
    terminal: [spot(26, 3, 'up'), spot(25, 3, 'up')],
    racks: [spot(27, 3, 'up'), spot(28, 3, 'up')],
    globe: [spot(22, 5, 'right'), spot(24, 5, 'left')],
    meeting: [spot(22, 11, 'right'), spot(27, 11, 'left'), spot(22, 12, 'right'), spot(27, 12, 'left')],
    window: [spot(8, 2, 'up'), spot(9, 2, 'up'), spot(14, 2, 'up'), spot(15, 2, 'up'), spot(18, 2, 'up'), spot(19, 2, 'up')],
    arcade: [spot(1, 11, 'up')],
    elevator: [spot(16, 2, 'up'), spot(17, 2, 'up')],
  };
  STATIONS.meeting.forEach((s, i) => { s.eggs = { x: i % 2 === 0 ? 372 : 418, y: 184 + (i > 1 ? 10 : 0), dir: i % 2 === 0 ? 1 : -1 }; });
  const ELEVATOR = { x: 272, y: 45, c: 16, r: 2 };

  // ---------------------------------------------------------------- time & sky
  function skyPhase(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 21 || h < 5.5) return 'night';
    if (h < 7.5) return 'dawn';
    if (h < 18) return 'day';
    return 'dusk';
  }
  const SKY = {
    night: [C.black, C.navy, C.slate],
    dawn: [C.slate, C.magenta, C.gold],
    day: [C.blue, C.blue, C.cyan],
    dusk: [C.slate, C.plum, C.orange],
  };

  // Windows on the north wall (pixel x of the 2-tile frame).
  const WINDOWS = [32, 128, 224, 288, 384];

  function drawSky(g, x0, y0, w, h, phase, now) {
    const cols = SKY[phase];
    // banded gradient with a dithered seam between bands
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const band = t < 0.4 ? 0 : t < 0.75 ? 1 : 2;
      for (let x = 0; x < w; x++) {
        let b = band;
        const edge = t < 0.4 ? 0.4 - t : t < 0.75 ? 0.75 - t : 1;
        if (edge < 0.06 && ((x + y) & 1)) b = Math.min(2, b + 1);
        P(g, x0 + x, y0 + y, cols[b]);
      }
    }
    const wx = (x) => x0 + x; // local helpers
    if (phase === 'night') {
      const rnd = DO.rng(42);
      for (let i = 0; i < 60; i++) {
        const sx = Math.floor(rnd() * W), sy = Math.floor(rnd() * h * 0.7);
        if (sx >= x0 && sx < x0 + w && ((now / 900 + i) % 7) > 0.6) P(g, sx, y0 + sy, i % 5 ? C.white : C.yellow);
      }
      if (x0 === 224) { // moon
        R(g, wx(18), y0 + 3, 5, 5, C.yellow); R(g, wx(19), y0 + 2, 3, 1, C.yellow); R(g, wx(19), y0 + 8, 3, 1, C.yellow);
        R(g, wx(20), y0 + 3, 3, 4, SKY.night[0]);
      }
    } else if (phase === 'day' || phase === 'dawn') {
      // clouds drift across the whole wall, as one sky behind every window
      const clouds = [[0, 3, 12], [170, 7, 9], [330, 2, 14]];
      for (const [base, cy, cw] of clouds) {
        const cx = Math.floor(((base + now / 4000) % (W + 40)) - 20);
        for (let k = 0; k < cw; k++) {
          const px = cx + k;
          if (px < x0 || px >= x0 + w) continue;
          const top = k < 2 || k > cw - 3 ? 1 : 0;
          R(g, px, y0 + cy + top, 1, 3 - top, C.white);
          if (k > 2 && k < cw - 4) P(g, px, y0 + cy - 1, C.white);
          P(g, px, y0 + cy + 3, C.silver);
        }
      }
    } else if (phase === 'dusk') {
      if (x0 === 128) { R(g, wx(10), y0 + h - 6, 7, 4, C.gold); R(g, wx(11), y0 + h - 7, 5, 1, C.gold); }
    }
    // city skyline at the bottom
    const rnd = DO.rng(7);
    const night = phase === 'night' || phase === 'dusk';
    for (let bx = 0; bx < W; bx += 6) {
      const bh = 3 + Math.floor(rnd() * 7);
      const bw = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < bw; k++) {
        const px = bx + k;
        if (px < x0 || px >= x0 + w) continue;
        R(g, px, y0 + h - bh, 1, bh, night ? C.navy : C.steel);
        if (night && k % 2 === 1) for (let yy = h - bh + 1; yy < h - 1; yy += 2) if (rnd() > 0.45) P(g, px, y0 + yy, C.yellow);
      }
    }
  }

  // ---------------------------------------------------------------- background (static, re-rendered each minute)
  let bg = null;
  let bgKey = '';

  function zoneOf(c, r) {
    if (c <= 7 && r <= 9) return 'kitchen';
    if (c >= 21 && r <= 8) return 'library';
    if (c >= 21) return 'meeting';
    return 'wood';
  }

  function drawFloor(g) {
    for (let r = 2; r < ROWS; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        const x = c * T, y = r * T, z = zoneOf(c, r);
        if (z === 'kitchen') {
          for (let q = 0; q < 4; q++) {
            const qx = x + (q % 2) * 8, qy = y + (q >> 1) * 8;
            R(g, qx, qy, 8, 8, (c + r + q + (q >> 1)) % 2 ? C.cream : C.silver);
          }
        } else if (z === 'library') {
          R(g, x, y, T, T, C.forest);
          for (let k = 0; k < 16; k += 4) P(g, x + k + (r % 2) * 2, y + ((k * 3) % 16), C.green);
        } else if (z === 'meeting') {
          R(g, x, y, T, T, C.slate);
          for (let k = 0; k < 16; k += 2) if ((k + r) % 4 === 0) R(g, x + k, y + 7, 1, 2, C.steel);
        } else {
          R(g, x, y, T, T, C.sand);
          for (let py = 0; py < 16; py += 4) {
            R(g, x, y + py + 3, T, 1, C.wood);
            const row = r * 4 + py / 4;
            if ((c + row * 2) % 3 === 0) { // long boards: a joint every third tile
              const joint = (row * 7) % 16;
              R(g, x + joint, y + py, 1, 3, C.wood);
            }
            if ((c * 5 + row) % 7 === 0) P(g, x + ((row * 5) % 14) + 1, y + py + 1, C.cream);
          }
        }
      }
    }
    // lounge rug
    R(g, 32, 176, 80, 64, C.plum);
    R(g, 34, 178, 76, 60, C.magenta);
    for (let y = 182; y < 236; y += 6) for (let x = 38 + ((y / 6) % 2) * 3; x < 106; x += 6) P(g, x, y, C.pink);
    R(g, 36, 180, 72, 1, C.pink); R(g, 36, 235, 72, 1, C.pink);
    // library rug under the globe
    R(g, 344, 72, 64, 30, C.pine);
    R(g, 346, 74, 60, 26, C.green);
    R(g, 348, 76, 56, 22, C.forest);
  }

  function drawWalls(g) {
    // north wall face
    R(g, 0, 0, W, 4, C.outline);
    R(g, 0, 3, W, 1, C.mahogany);
    R(g, 0, 4, W, 20, C.cream);
    for (let x = 0; x < W; x += 2) P(g, x, 4, C.sand);
    R(g, 0, 23, W, 1, C.wood);
    R(g, 0, 24, W, 6, C.tan);
    for (let x = 4; x < W; x += 8) R(g, x, 25, 1, 4, C.brown);
    R(g, 0, 30, W, 2, C.mahogany);
    // side walls
    R(g, 0, 0, 16, MAP_H, C.outline);
    R(g, 13, 32, 3, MAP_H - 32, C.mahogany);
    R(g, W - 16, 0, 16, MAP_H, C.outline);
    R(g, W - 16, 32, 3, MAP_H - 32, C.mahogany);
    // floor shadow under the north wall
    R(g, 16, 32, W - 32, 2, C.tan);
  }

  function drawWhiteboard(g) {
    const x = 162, y = 6, w = 60, h = 18;
    box(g, x, y, w, h, C.white, C.steel);
    R(g, x + 1, y + 1, w - 2, 1, C.silver);
    R(g, x + 4, y + h, w - 8, 2, C.grey); // marker tray
    P(g, x + 10, y + h, C.red); P(g, x + 11, y + h, C.red); P(g, x + 14, y + h, C.blue); P(g, x + 15, y + h, C.blue);
    // scribbles: a little chart and some lines
    R(g, x + 5, y + 4, 14, 1, C.blue); R(g, x + 5, y + 7, 10, 1, C.blue); R(g, x + 5, y + 10, 12, 1, C.blue);
    for (let k = 0; k < 5; k++) R(g, x + 26 + k * 4, y + 13 - k * 2, 2, k * 2 + 2, k === 4 ? C.red : C.lime);
    R(g, x + 25, y + 15, 20, 1, C.steel);
  }

  function drawFridge(g) {
    box(g, 17, 10, 15, 38, C.white, C.outline);
    R(g, 29, 11, 2, 36, C.silver);
    R(g, 18, 24, 13, 1, C.grey);
    R(g, 19, 14, 1, 7, C.grey); R(g, 19, 27, 1, 9, C.grey);
    P(g, 23, 16, C.red); P(g, 26, 14, C.blue); P(g, 24, 30, C.gold); // magnets
  }

  function drawCounter(g) {
    // upper cabinets
    box(g, 66, 6, 44, 13, C.wood, C.mahogany);
    R(g, 87, 7, 1, 11, C.mahogany);
    P(g, 84, 13, C.gold); P(g, 90, 13, C.gold);
    // counter
    R(g, 32, 30, 80, 18, C.outline);
    R(g, 33, 31, 78, 3, C.silver);
    R(g, 33, 34, 78, 13, C.brown);
    for (let x = 33; x < 111; x += 13) R(g, x, 34, 1, 13, C.mahogany);
    for (let x = 38; x < 111; x += 13) P(g, x + 4, 40, C.gold);
    R(g, 33, 46, 78, 1, C.mahogany);
    // sink
    R(g, 80, 30, 12, 2, C.grey); R(g, 81, 30, 10, 1, C.steel);
    R(g, 88, 23, 1, 7, C.silver); R(g, 86, 23, 3, 1, C.silver);
    // coffee machine
    box(g, 49, 15, 12, 16, C.navy, C.outline);
    R(g, 51, 17, 8, 4, C.wine);
    R(g, 52, 25, 6, 1, C.steel);
    // fruit bowl
    R(g, 98, 28, 7, 2, C.cream); P(g, 99, 27, C.red); P(g, 101, 27, C.lime); P(g, 103, 27, C.gold);
  }

  function drawCooler(g) {
    box(g, 115, 30, 11, 18, C.white, C.outline);
    R(g, 117, 34, 7, 1, C.silver);
    P(g, 118, 37, C.red); P(g, 122, 37, C.blue);
    box(g, 116, 14, 9, 17, C.cyan, C.deep);
    R(g, 117, 15, 2, 14, C.white);
    R(g, 118, 12, 5, 2, C.deep);
  }

  function drawShelves(g) {
    const rnd = DO.rng(1234);
    const x0 = 337, w = 46;
    box(g, x0, 6, w, 42, C.outline, C.mahogany);
    R(g, x0 + 1, 7, w - 2, 40, C.outline);
    const books = [C.red, C.blue, C.lime, C.gold, C.plum, C.cream, C.deep, C.rust, C.green, C.magenta, C.pink, C.cyan];
    for (let s = 0; s < 4; s++) {
      const base = 16 + s * 10;
      R(g, x0 + 1, base, w - 2, 2, C.brown);
      let bx = x0 + 2;
      while (bx < x0 + w - 4) {
        const bw = rnd() < 0.3 ? 3 : 2;
        const bh = 5 + Math.floor(rnd() * 4);
        if (rnd() < 0.12) { bx += 2; continue; }
        const col = books[Math.floor(rnd() * books.length)];
        R(g, bx, base - bh, bw, bh, col);
        P(g, bx, base - bh + 2, C.cream);
        bx += bw + (rnd() < 0.2 ? 1 : 0);
      }
    }
    R(g, x0, 46, w, 2, C.mahogany);
  }

  function drawFiling(g) {
    box(g, 386, 22, 13, 26, C.grey, C.outline);
    R(g, 397, 23, 1, 24, C.steel);
    for (let k = 0; k < 3; k++) {
      R(g, 387, 29 + k * 6, 11, 1, C.steel);
      R(g, 390, 25 + k * 6, 5, 1, C.silver);
    }
  }

  function drawTerminalDesk(g) {
    box(g, 416, 35, 16, 13, C.slate, C.outline);
    R(g, 417, 36, 14, 1, C.steel);
    box(g, 418, 20, 13, 14, C.silver, C.outline);
    R(g, 420, 22, 9, 8, C.black);
    R(g, 422, 32, 5, 3, C.grey);
  }

  function drawRacks(g) {
    for (const x of [433, 449]) {
      box(g, x, 6, 14, 42, C.navy, C.outline);
      R(g, x + 1, 7, 12, 1, C.slate);
      for (let y = 10; y < 46; y += 4) R(g, x + 2, y, 10, 3, C.black);
    }
  }

  function drawClockFace(g, date) {
    const cx = 328, cy = 12;
    R(g, cx - 3, cy - 5, 7, 11, C.outline); R(g, cx - 5, cy - 3, 11, 7, C.outline);
    R(g, cx - 4, cy - 4, 9, 9, C.outline);
    R(g, cx - 3, cy - 4, 7, 9, C.white); R(g, cx - 4, cy - 3, 9, 7, C.white);
    const hr = (date.getHours() % 12 + date.getMinutes() / 60) / 12 * Math.PI * 2;
    const mn = date.getMinutes() / 60 * Math.PI * 2;
    for (let k = 1; k <= 3; k++) P(g, cx + Math.round(Math.sin(mn) * k), cy - Math.round(Math.cos(mn) * k), C.black);
    for (let k = 1; k <= 2; k++) P(g, cx + Math.round(Math.sin(hr) * k), cy - Math.round(Math.cos(hr) * k), C.red);
    P(g, cx, cy, C.black);
  }

  function drawWallPlantShadows(g) {
    // soft shadows under free-standing furniture
    const sh = (x, y, w) => R(g, x, y, w, 2, C.tan);
    for (const pod of PODS) sh(pod.x + 2, pod.y + 55, 60);
    R(g, 369, 214, 62, 2, C.steel); // meeting table
  }

  function renderBackground(date) {
    const c = canvas(W, MAP_H);
    const g = c.getContext('2d');
    drawFloor(g);
    drawWalls(g);
    drawWallPlantShadows(g);
    drawWhiteboard(g);
    drawFridge(g);
    drawCounter(g);
    drawCooler(g);
    drawShelves(g);
    drawFiling(g);
    drawTerminalDesk(g);
    drawRacks(g);
    drawClockFace(g, date);
    // elevator frame
    R(g, 256, 4, 32, 28, C.outline);
    R(g, 257, 5, 30, 3, C.steel);
    return c;
  }

  // ---------------------------------------------------------------- dynamic wall layer
  const dyn = {
    seats: {}, // seatId -> { breed, state, cat, blink }
    elevator: 0, // door openness 0..1
    coffee: false, terminal: false, racks: 0, globe: false, arcade: true,
    whiteboard: null, // { done, total }
    podLabels: {},
  };

  // The sky moves slowly: redraw the windows once per second only.
  let winCache = null;
  let winKey = '';
  function drawWindows(g, phase, now) {
    const key = phase + ':' + Math.floor(now / 1000);
    if (key !== winKey) {
      winKey = key;
      winCache = winCache || canvas(W, 26);
      const wg = winCache.getContext('2d');
      wg.clearRect(0, 0, W, 26);
      for (const x of WINDOWS) {
        R(wg, x + 1, 5, 30, 19, C.white);
        drawSky(wg, x + 2, 6, 28, 16, phase, now);
        R(wg, x + 15, 6, 2, 16, C.white); // mullion
        R(wg, x + 1, 22, 30, 2, C.white);
        R(wg, x + 1, 23, 30, 1, C.silver);
        R(wg, x + 31, 5, 1, 19, C.silver);
      }
    }
    g.drawImage(winCache, 0, 0);
  }

  function drawElevator(g, now) {
    const open = dyn.elevator;
    R(g, 258, 8, 28, 24, C.navy); // cabin
    R(g, 260, 9, 24, 1, C.gold);
    const shift = Math.round(open * 13);
    const w = 14 - shift;
    if (w > 0) {
      R(g, 258, 8, w, 24, C.grey);
      R(g, 259, 9, 1, 22, C.silver);
      R(g, 258 + w - 1, 8, 1, 24, C.steel);
      R(g, 272 + shift, 8, w, 24, C.grey);
      R(g, 272 + shift, 8, 1, 24, C.steel);
      if (w > 2) R(g, 272 + shift + w - 2, 9, 1, 22, C.silver);
    }
    // floor indicator
    R(g, 268, 5, 8, 3, C.black);
    P(g, 271, 6, open > 0 || Math.floor(now / 1500) % 3 === 0 ? C.gold : C.wine);
    P(g, 272, 6, open > 0 ? C.gold : C.wine);
  }

  function drawCoffee(g, now) {
    P(g, 59, 18, Math.floor(now / 600) % 2 ? C.lime : C.green);
    R(g, 53, 26, 4, 4, C.white); // cup
    if (dyn.coffee) {
      for (let k = 0; k < 3; k++) {
        const t = (now / 300 + k * 3) % 9;
        P(g, 54 + ((k + Math.floor(t)) % 2), 24 - Math.floor(t), C.silver);
      }
    }
  }

  function drawTerminalScreen(g, now) {
    R(g, 420, 22, 9, 8, C.black);
    const busy = dyn.terminal;
    const scroll = busy ? Math.floor(now / 150) : Math.floor(now / 2000);
    for (let line = 0; line < 4; line++) {
      const len = 2 + ((scroll + line * 3) * 7) % 6;
      R(g, 421, 23 + line * 2, len, 1, busy ? C.lime : C.green);
    }
    if (Math.floor(now / 500) % 2) P(g, 421 + ((scroll * 3) % 6), 29, C.lime);
  }

  function drawRackLeds(g, now) {
    const speed = dyn.racks > 0 ? 120 : 900;
    const tick = Math.floor(now / speed);
    for (const [ri, x] of [[0, 433], [1, 449]]) {
      for (let row = 0; row < 9; row++) {
        const y = 11 + row * 4;
        for (let k = 0; k < 3; k++) {
          const on = ((tick + row * 7 + k * 3 + ri * 5) * 2654435761 >>> 0) % 5 < (dyn.racks > 0 ? 3 : 2);
          const col = k === 2 && row % 3 === 0 && dyn.racks > 1 ? C.gold : C.lime;
          P(g, x + 3 + k * 2, y, on ? col : C.forest);
        }
        P(g, x + 10, y, C.slate);
      }
    }
  }

  function drawWhiteboardTodos(g) {
    const wb = dyn.whiteboard;
    if (!wb || !wb.total) return;
    const x = 166, y = 9, n = Math.min(wb.total, 4);
    R(g, x - 1, y - 1, 26, n * 3 + 2, C.white);
    for (let k = 0; k < n; k++) {
      const done = k < Math.round(wb.done / wb.total * n);
      R(g, x, y + k * 3, 2, 2, done ? C.green : C.steel);
      R(g, x + 3, y + k * 3, 6 + ((k * 5) % 9), 1, done ? C.grey : C.blue);
    }
  }

  function drawWallLayer(g, now, date) {
    const phase = skyPhase(date);
    drawWindows(g, phase, now);
    drawElevator(g, now);
    drawCoffee(g, now);
    drawTerminalScreen(g, now);
    drawRackLeds(g, now);
    drawWhiteboardTodos(g);
  }

  // ---------------------------------------------------------------- sortable furniture
  // Each entry: { y: anchor (feet line), draw(g, now) }. Ducks are sorted with them.
  function sprite(w, h, fn) {
    const c = canvas(w, h);
    fn(c.getContext('2d'));
    return c;
  }

  const STATE_SCREEN = {
    thinking: C.deep, tool: C.blue, permission: C.gold, input: C.gold, done: C.slate,
    supervising: C.deep, compacting: C.magenta, error: C.red,
  };
  const CAT_SCREEN = { edit: C.white, read: C.cream, search: C.cream, exec: C.black, web: C.blue, agent: C.gold, todo: C.white, mcp: C.magenta, other: C.blue, ask: C.gold };

  function seatScreenColor(s, now) {
    if (!s) return null;
    if ((s.state === 'permission' || s.state === 'input') && Math.floor(now / 400) % 2) return C.hot;
    if (s.state === 'tool' && s.cat) return CAT_SCREEN[s.cat] || C.blue;
    return STATE_SCREEN[s.state] || C.slate;
  }

  function drawChairNorth(g, cx, y) {
    // backrest behind a duck that faces you
    box(g, cx - 5, y, 10, 10, C.slate, C.outline);
    R(g, cx - 4, y + 1, 8, 1, C.steel);
    box(g, cx - 6, y + 9, 12, 4, C.steel, C.outline);
  }
  function drawChairSouth(g, cx, y) {
    // backrest in front of a duck that shows its back
    box(g, cx - 5, y, 10, 8, C.slate, C.outline);
    R(g, cx - 4, y + 1, 8, 1, C.steel);
    R(g, cx - 4, y + 6, 8, 1, C.navy);
    R(g, cx - 1, y + 8, 2, 2, C.outline);
    R(g, cx - 4, y + 10, 8, 1, C.outline);
  }

  const DESK_PROPS = ['mug', 'plant', 'papers', 'duck', 'lamp', 'mug', 'cactus', 'papers'];
  function drawProp(g, kind, x, y) {
    if (kind === 'mug') { R(g, x, y, 3, 3, C.white); P(g, x + 3, y + 1, C.white); R(g, x, y, 3, 1, C.brown); }
    else if (kind === 'plant') { R(g, x, y + 2, 4, 3, C.rust); R(g, x, y - 1, 1, 3, C.green); R(g, x + 1, y - 2, 2, 4, C.lime); R(g, x + 3, y, 1, 2, C.green); }
    else if (kind === 'cactus') { R(g, x + 1, y + 3, 3, 2, C.amber); R(g, x + 2, y - 2, 1, 5, C.green); P(g, x + 1, y, C.green); P(g, x + 3, y - 1, C.green); }
    else if (kind === 'papers') { R(g, x, y, 5, 3, C.white); R(g, x + 1, y + 1, 3, 1, C.silver); R(g, x + 1, y - 1, 5, 1, C.silver); }
    else if (kind === 'duck') { R(g, x, y, 4, 3, C.yellow); R(g, x + 1, y - 2, 2, 2, C.yellow); P(g, x + 3, y - 1, C.orange); }
    else if (kind === 'lamp') { R(g, x, y + 3, 4, 1, C.steel); R(g, x + 1, y, 1, 3, C.steel); R(g, x, y - 1, 4, 2, C.gold); }
  }

  function makePod(pod) {
    const X0 = pod.x, Y0 = pod.y;
    const seats = SEATS.filter((s) => s.pod === pod);
    const bench = sprite(64, 56, (g) => {
      R(g, 0, 15, 64, 40, C.outline);
      R(g, 1, 16, 62, 32, C.wood);
      R(g, 1, 16, 62, 1, C.cream);
      R(g, 1, 30, 62, 1, C.steel); // low divider between the facing desks
      R(g, 1, 31, 62, 2, C.grey);
      R(g, 1, 33, 62, 1, C.tan);
      R(g, 1, 48, 62, 5, C.brown);
      R(g, 1, 53, 62, 1, C.mahogany);
      R(g, 2, 54, 2, 2, C.outline); R(g, 60, 54, 2, 2, C.outline);
    });
    const out = [];
    for (const s of seats) {
      if (s.side === 'n') out.push({ y: Y0 + 14, draw: (g) => drawChairNorth(g, s.cx, Y0 + 2) });
      else out.push({ y: Y0 + 60, draw: (g) => drawChairSouth(g, s.cx, Y0 + 51) });
    }
    out.push({
      y: Y0 + 54,
      draw: (g, now) => {
        g.drawImage(bench, X0, Y0);
        for (const s of seats) {
          const st = dyn.seats[s.id];
          const prop = DESK_PROPS[DO.hash(s.id) % DESK_PROPS.length];
          if (s.side === 'n') {
            drawProp(g, prop, s.cx + 9, Y0 + 22);
            if (st) {
              box(g, s.cx - 6, Y0 + 13, 12, 9, C.grey, C.outline);
              R(g, s.cx - 5, Y0 + 14, 10, 1, C.silver);
              R(g, s.cx - 1, Y0 + 16, 2, 2, seatScreenColor(st, now) || C.white);
              R(g, s.cx - 6, Y0 + 22, 12, 1, C.steel);
            } else {
              box(g, s.cx - 6, Y0 + 19, 12, 3, C.grey, C.outline);
            }
          } else {
            drawProp(g, prop === 'mug' ? 'lamp' : prop, s.cx - 15, Y0 + 38);
            if (st) {
              const col = seatScreenColor(st, now);
              box(g, s.cx - 6, Y0 + 27, 12, 9, C.steel, C.outline);
              R(g, s.cx - 5, Y0 + 28, 10, 7, col);
              drawScreenContent(g, s.cx - 5, Y0 + 28, st, now);
              box(g, s.cx - 7, Y0 + 35, 14, 4, C.grey, C.outline);
              R(g, s.cx - 5, Y0 + 36, 10, 1, C.silver);
            } else {
              box(g, s.cx - 6, Y0 + 34, 12, 3, C.grey, C.outline);
            }
          }
        }
        // project nameplate on the front of the bench
        const label = dyn.podLabels[pod.id];
        if (label) {
          const w = DO.font.measure(label) + 4;
          box(g, X0 + 32 - (w >> 1), Y0 + 47, w, 7, C.cream, C.mahogany);
          DO.font.draw(g, label, X0 + 34 - (w >> 1), Y0 + 48, C.outline);
        }
      },
    });
    return out;
  }

  function drawScreenContent(g, x, y, st, now) {
    if (st.state === 'tool' && st.cat === 'exec') {
      const s = Math.floor(now / 200);
      for (let k = 0; k < 3; k++) R(g, x + 1, y + 1 + k * 2, 2 + ((s + k * 5) % 6), 1, C.lime);
    } else if (st.state === 'tool' && (st.cat === 'edit' || st.cat === 'todo')) {
      const s = Math.floor(now / 250);
      for (let k = 0; k < 3; k++) R(g, x + 1 + (k % 2) * 2, y + 1 + k * 2, 3 + ((s + k * 3) % 5), 1, C.steel);
    } else if (st.state === 'tool' && (st.cat === 'read' || st.cat === 'search')) {
      for (let k = 0; k < 3; k++) R(g, x + 1, y + 1 + k * 2, 8 - k, 1, C.grey);
    } else if (st.state === 'tool' && st.cat === 'web') {
      R(g, x + 3, y + 1, 4, 4, C.cyan); R(g, x + 4, y + 2, 2, 1, C.lime);
    } else if (st.state === 'thinking' || st.state === 'supervising') {
      const k = Math.floor(now / 400) % 3;
      for (let d = 0; d <= k; d++) P(g, x + 3 + d * 2, y + 3, C.cyan);
    } else if (st.state === 'done') {
      const t = now / 1500;
      P(g, x + 4 + Math.round(Math.sin(t) * 3), y + 3 + Math.round(Math.cos(t * 1.3) * 2), C.lime);
    }
  }

  function makeMeeting() {
    const out = [];
    const table = sprite(66, 40, (g) => {
      R(g, 0, 0, 66, 39, C.outline);
      R(g, 1, 1, 64, 31, C.brown);
      R(g, 1, 1, 64, 1, C.wood);
      R(g, 3, 4, 60, 25, C.mahogany);
      R(g, 4, 5, 58, 23, C.brown);
      R(g, 1, 32, 64, 6, C.mahogany);
      R(g, 20, 12, 8, 6, C.white); R(g, 21, 13, 6, 1, C.silver); // notes on the table
      R(g, 40, 15, 3, 3, C.white);
    });
    for (const s of MEETING) {
      if (s.sit.view === 'front') out.push({ y: s.sit.anchor - 6, draw: (g) => drawChairNorth(g, s.point.x, s.tile.r * T + 2) });
      else out.push({ y: s.tile.r * T + 12, draw: (g) => drawChairSouth(g, s.point.x, s.tile.r * T + 3) });
    }
    out.push({ y: 13 * T, draw: (g) => g.drawImage(table, 367, 175) });
    return out;
  }

  function makeLounge() {
    const out = [];
    const sofaBack = sprite(48, 14, (g) => {
      R(g, 0, 0, 48, 14, C.outline);
      R(g, 1, 1, 46, 12, C.green);
      R(g, 1, 1, 46, 2, C.lime);
      R(g, 16, 3, 1, 10, C.forest); R(g, 31, 3, 1, 10, C.forest);
    });
    const sofaFront = sprite(52, 12, (g) => {
      R(g, 0, 0, 4, 12, C.outline); R(g, 1, 1, 3, 10, C.forest);
      R(g, 48, 0, 4, 12, C.outline); R(g, 48, 1, 3, 10, C.forest);
      R(g, 2, 4, 48, 8, C.outline);
      R(g, 4, 4, 44, 3, C.green); R(g, 4, 7, 44, 4, C.forest);
      R(g, 19, 4, 1, 3, C.forest); R(g, 34, 4, 1, 3, C.forest);
    });
    out.push({ y: 11 * T, draw: (g) => g.drawImage(sofaBack, 32, 166) });
    out.push({ y: 11 * T + 12, draw: (g) => g.drawImage(sofaFront, 30, 180) });
    const armchair = (x, y, col, dark) => sprite(16, 22, (g) => {
      R(g, 1, 0, 14, 10, C.outline); R(g, 2, 1, 12, 8, col); R(g, 2, 1, 12, 1, C.pink);
      R(g, 0, 8, 16, 12, C.outline); R(g, 1, 9, 3, 10, dark); R(g, 12, 9, 3, 10, dark);
      R(g, 4, 12, 8, 7, col);
      void x; void y;
    });
    const armL = armchair(0, 0, C.red, C.wine);
    const armLib = armchair(0, 0, C.red, C.wine);
    out.push({ y: 12 * T + 2, draw: (g) => g.drawImage(armL, 6 * T, 12 * T - 6) });
    out.push({ y: 5 * T + 2, draw: (g) => g.drawImage(armLib, 26 * T, 5 * T - 6) });
    for (const [c, col, dark] of [[2, C.gold, C.amber], [5, C.blue, C.deep]]) {
      const bag = sprite(16, 10, (g) => {
        R(g, 2, 0, 12, 10, C.outline); R(g, 0, 3, 16, 7, C.outline);
        R(g, 3, 1, 10, 8, col); R(g, 1, 4, 14, 5, col); R(g, 2, 8, 12, 1, dark); R(g, 4, 2, 3, 1, C.white);
      });
      out.push({ y: 14 * T + 14, draw: (g) => g.drawImage(bag, c * T, 14 * T + 6) });
    }
    const coffeeTable = sprite(30, 12, (g) => {
      R(g, 0, 0, 30, 9, C.outline); R(g, 1, 1, 28, 6, C.wood); R(g, 1, 7, 28, 1, C.brown);
      R(g, 2, 9, 2, 3, C.outline); R(g, 26, 9, 2, 3, C.outline);
      R(g, 5, 2, 6, 4, C.blue); R(g, 6, 3, 4, 1, C.white); // magazine
      R(g, 20, 2, 3, 3, C.white); R(g, 20, 2, 3, 1, C.brown); // mug
    });
    out.push({ y: 13 * T + 12, draw: (g) => g.drawImage(coffeeTable, 49, 13 * T + 2) });
    // arcade cabinet (blocked at 1,10)
    out.push({
      y: 10 * T + 15,
      draw: (g, now) => {
        R(g, 17, 132, 15, 44, C.outline);
        R(g, 18, 133, 13, 42, C.plum);
        R(g, 18, 133, 13, 5, C.hot);
        DO.font.draw(g, 'GO', 21, 133, C.yellow);
        R(g, 19, 140, 11, 10, C.black);
        const f = Math.floor(now / 180);
        for (let k = 0; k < 4; k++) P(g, 20 + ((f + k * 3) % 9), 141 + ((f * 2 + k * 5) % 8), k % 2 ? C.cyan : C.lime);
        R(g, 18, 151, 13, 4, C.magenta);
        P(g, 22, 152, C.red); P(g, 26, 152, C.yellow); P(g, 28, 152, C.cyan);
        R(g, 19, 156, 11, 18, C.plum);
        R(g, 20, 158, 9, 1, C.magenta);
      },
    });
    return out;
  }

  function makeKitchen() {
    const out = [];
    const table = sprite(28, 16, (g) => {
      R(g, 2, 0, 24, 9, C.outline); R(g, 0, 2, 28, 5, C.outline);
      R(g, 3, 1, 22, 7, C.white); R(g, 1, 3, 26, 3, C.white);
      R(g, 3, 6, 22, 2, C.silver);
      R(g, 12, 9, 4, 6, C.outline); R(g, 13, 9, 2, 5, C.grey);
      R(g, 8, 14, 12, 2, C.outline);
      R(g, 8, 2, 3, 2, C.yellow); // a croissant
    });
    for (const s of LOUNGE.filter((x) => x.id.startsWith('stool'))) {
      out.push({ y: s.sit.view === 'front' ? s.sit.anchor - 4 : s.tile.r * T + 15, draw: (g) => {
        const x = s.point.x, y = s.tile.r * T + (s.sit.view === 'front' ? 9 : 8);
        R(g, x - 4, y, 8, 3, C.outline); R(g, x - 3, y, 6, 2, C.red);
        R(g, x - 1, y + 3, 2, 4, C.outline);
      } });
    }
    out.push({ y: 6 * T + 13, draw: (g) => g.drawImage(table, 50, 6 * T) });
    return out;
  }

  function makeLibrary() {
    const out = [];
    out.push({
      y: 5 * T + 14,
      draw: (g, now) => { // globe
        const x = 23 * T, y = 5 * T;
        R(g, x + 3, y + 13, 10, 3, C.outline); R(g, x + 4, y + 13, 8, 2, C.mahogany);
        R(g, x + 7, y + 9, 2, 5, C.gold);
        R(g, x + 2, y - 8, 12, 12, C.outline);
        R(g, x + 3, y - 7, 10, 10, C.blue);
        const f = dyn.globe ? Math.floor(now / 160) % 10 : 3;
        for (const [lx, ly, lw, lh] of [[0, 1, 3, 3], [5, 0, 2, 4], [2, 5, 4, 2], [7, 6, 2, 2]]) {
          for (let k = 0; k < lw; k++) {
            const px = (lx + k + f) % 12;
            if (px < 10) R(g, x + 3 + px, y - 7 + ly, 1, lh, C.green);
          }
        }
        P(g, x + 4, y - 6, C.cyan);
        R(g, x + 1, y - 8, 1, 12, C.gold); R(g, x + 14, y - 8, 1, 12, C.gold);
      },
    });
    out.push({
      y: 5 * T + 15,
      draw: (g, now) => { // floor lamp
        const x = 27 * T + 8, y = 5 * T;
        R(g, x - 3, y + 13, 7, 2, C.outline);
        R(g, x, y - 10, 1, 23, C.steel);
        R(g, x - 4, y - 14, 9, 5, C.outline); R(g, x - 3, y - 13, 7, 3, C.cream);
        void now;
      },
    });
    return out;
  }

  function plant(c, r, big) {
    const x = c * T, y = r * T;
    return { y: y + 15, draw: (g) => {
      R(g, x + 4, y + 9, 8, 7, C.outline); R(g, x + 5, y + 10, 6, 5, C.rust); R(g, x + 5, y + 10, 6, 1, C.amber);
      const top = big ? y - 10 : y - 2;
      R(g, x + 7, top + 4, 2, y + 9 - top - 4, C.forest);
      for (const [dx, dy, w, h, col] of [[1, 6, 5, 3, C.green], [9, 4, 5, 3, C.green], [4, 1, 4, 3, C.lime], [8, 0, 3, 5, C.lime], [2, 9, 4, 2, C.lime], [10, 8, 4, 2, C.forest]]) {
        R(g, x + dx, top + dy, w, h, col);
      }
    } };
  }

  let sortablesCache = null;
  function sortables() {
    if (sortablesCache) return sortablesCache;
    const list = [];
    for (const pod of PODS) list.push(...makePod(pod));
    list.push(...makeMeeting(), ...makeLounge(), ...makeKitchen(), ...makeLibrary());
    list.push(plant(20, 2, true), plant(7, 8, false), plant(1, 15, true), plant(20, 15, false), plant(28, 15, true), plant(28, 9, false));
    sortablesCache = list;
    return list;
  }

  // ---------------------------------------------------------------- lights (night)
  function lights() {
    const L = [];
    for (const s of SEATS) if (dyn.seats[s.id]) L.push({ x: s.cx, y: s.side === 'n' ? s.pod.y + 18 : s.pod.y + 32, r: 18 });
    L.push({ x: 55, y: 22, r: 12 }, { x: 272, y: 20, r: 16 }, { x: 440, y: 26, r: 18 }, { x: 424, y: 28, r: 12 }, { x: 25, y: 145, r: 16 }, { x: 440, y: 66, r: 26 });
    return L;
  }

  // ---------------------------------------------------------------- public
  function drawBackground(g, date) {
    const key = date.getHours() + ':' + date.getMinutes();
    if (!bg || key !== bgKey) { bg = renderBackground(date); bgKey = key; }
    g.drawImage(bg, 0, 0);
  }

  function validate() {
    // every seat and station must be reachable from the elevator
    const seen = new Uint8Array(COLS * ROWS);
    const q = [[ELEVATOR.c, ELEVATOR.r]];
    seen[ELEVATOR.r * COLS + ELEVATOR.c] = 1;
    while (q.length) {
      const [c, r] = q.shift();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        if (walkable(nc, nr) && !seen[nr * COLS + nc]) { seen[nr * COLS + nc] = 1; q.push([nc, nr]); }
      }
    }
    const bad = [];
    for (const s of [...SEATS, ...LOUNGE, ...MEETING]) if (!seen[s.tile.r * COLS + s.tile.c]) bad.push(s.id);
    for (const [k, list] of Object.entries(STATIONS)) for (const s of list) if (!seen[s.r * COLS + s.c]) bad.push(k);
    return bad;
  }

  DO.office = {
    T, COLS, ROWS, W, MAP_H, PODS, SEATS, LOUNGE, MEETING, STATIONS, ELEVATOR,
    walkable, dyn, drawBackground, drawWallLayer, sortables, lights, skyPhase, validate,
  };
})(globalThis.DO = globalThis.DO || {});
