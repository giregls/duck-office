// The open space: tile map (30x16 tiles of 16px), furniture drawn in code,
// seats, stations and the dynamic bits (sky, screens, LEDs, elevator).
//
// Collisions: every piece of furniture blocks the tiles it stands on, and so do
// seats (a duck can sit there, but nobody walks through a chair). The path finder
// still accepts a blocked tile as the start or the goal of a walk.
(function (DO) {
  const C = DO.C;
  const T = 16, COLS = 30, ROWS = 16, W = 480, MAP_H = 256;
  const SHADOW = 'rgba(24, 20, 37, 0.22)';

  // ---------------------------------------------------------------- drawing primitives
  // Light comes from the top-left: highlights on top/left edges, shade bottom/right.
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const P = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  function box(g, x, y, w, h, fill, line) {
    R(g, x, y, w, h, line);
    R(g, x + 1, y + 1, w - 2, h - 2, fill);
  }
  function panel(g, x, y, w, h, base, light, dark, line) {
    R(g, x, y, w, h, line || C.outline);
    R(g, x + 1, y + 1, w - 2, h - 2, base);
    if (light) { R(g, x + 1, y + 1, w - 2, 1, light); R(g, x + 1, y + 1, 1, h - 2, light); }
    if (dark) { R(g, x + 1, y + h - 2, w - 2, 1, dark); R(g, x + w - 2, y + 2, 1, h - 3, dark); }
  }
  function dither(g, x, y, w, h, c, phase) {
    g.fillStyle = c;
    for (let yy = 0; yy < h; yy++) for (let xx = (yy + (phase || 0)) & 1; xx < w; xx += 2) g.fillRect(x + xx, y + yy, 1, 1);
  }
  function oval(g, cx, cy, rx, ry, c) {
    g.fillStyle = c;
    for (let yy = -ry; yy <= ry; yy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / ((ry + 0.5) * (ry + 0.5)))));
      g.fillRect(cx - half, cy + yy, half * 2 + 1, 1);
    }
  }
  function shade(g, x, y, w, h) { g.fillStyle = SHADOW; g.fillRect(x, y, w, h); }
  function softShadow(g, cx, cy, rx, ry) {
    g.fillStyle = SHADOW;
    for (let yy = -ry; yy <= ry; yy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy * yy) / ((ry + 0.5) * (ry + 0.5)))));
      g.fillRect(cx - half, cy + yy, half * 2 + 1, 1);
    }
  }
  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  // Pre-rendered furniture, built on first use (so the map loads without a DOM, e.g. in tests).
  function sprite(w, h, fn) {
    let c = null;
    return () => {
      if (!c) { c = canvas(w, h); fn(c.getContext('2d')); }
      return c;
    };
  }

  // ---------------------------------------------------------------- map
  const blocked = new Uint8Array(COLS * ROWS);
  function block(c, r, w = 1, h = 1) {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked[y * COLS + x] = 1;
  }
  function walkable(c, r) {
    return c >= 0 && r >= 0 && c < COLS && r < ROWS && !blocked[r * COLS + c];
  }
  const rect = (c, r, w = 1, h = 1) => {
    const out = [];
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) out.push([x, y]);
    return out;
  };

  block(0, 0, COLS, 2); // north wall
  block(0, 0, 1, ROWS); // side walls
  block(COLS - 1, 0, 1, ROWS);

  // Furniture standing on the floor is sorted with the ducks by its anchor line(s).
  // tiles = footprint (blocked); parts = [{ y: anchor, draw(g, now) }].
  const FURN = [];
  function furniture(name, tiles, parts) {
    for (const [c, r] of tiles) block(c, r);
    FURN.push({ name, tiles, parts });
  }

  // ---------------------------------------------------------------- desk pods & seats
  const PODS = [
    { id: 'A', c: 9, r: 4 }, { id: 'B', c: 15, r: 4 },
    { id: 'C', c: 9, r: 10 }, { id: 'D', c: 15, r: 10 },
  ];
  // Desks face each other: the north duck faces you over its laptop, the duck
  // across shows its back under its monitor.
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
        desk: { x: cx, y: north ? Y0 + 26 : Y0 + 45, anchor: Y0 + 54.5 },
        perches: north
          ? [{ x: cx - 12, y: Y0 + 27 }, { x: cx + 12, y: Y0 + 27 }]
          : [{ x: cx - 13, y: Y0 + 46 }, { x: cx + 12, y: Y0 + 46 }],
      });
    }
  }

  // Other places to sit (overflow, idle ducks). Their tile is blocked like a chair.
  function seatAt(id, c, r, view, kind, sitY, anchor) {
    const x = c * T + 8;
    block(c, r);
    return { id, kind, tile: { c, r }, point: { x, y: r * T + 13 }, sit: { x: x - 8, y: sitY, anchor, view }, perches: [] };
  }
  const LOUNGE = [
    seatAt('sofa0', 2, 11, 'front', 'lounge', 172, 182),
    seatAt('sofa1', 3, 11, 'front', 'lounge', 172, 182),
    seatAt('sofa2', 4, 11, 'front', 'lounge', 172, 182),
    seatAt('arm0', 6, 12, 'front', 'lounge', 12 * T - 5, 12 * T + 5),
    seatAt('bean0', 2, 14, 'front', 'lounge', 14 * T - 6, 14 * T + 9),
    seatAt('bean1', 5, 14, 'front', 'lounge', 14 * T - 6, 14 * T + 9),
    seatAt('arm1', 26, 5, 'front', 'lounge', 5 * T - 5, 5 * T + 5),
    seatAt('stool0', 3, 5, 'front', 'lounge', 5 * T - 3, 5 * T + 10),
    seatAt('stool1', 4, 5, 'front', 'lounge', 5 * T - 3, 5 * T + 10),
    seatAt('stool2', 3, 7, 'back', 'lounge', 7 * T - 6, 7 * T + 9),
    seatAt('stool3', 4, 7, 'back', 'lounge', 7 * T - 6, 7 * T + 9),
  ];
  const MEETING = [];
  for (let c = 23; c <= 26; c++) MEETING.push(seatAt('meetN' + c, c, 10, 'front', 'meeting', 10 * T + 4, 10 * T + 20));
  for (let c = 23; c <= 26; c++) MEETING.push(seatAt('meetS' + c, c, 13, 'back', 'meeting', 13 * T - 8, 13 * T + 8));

  // Places where a duck stands to do something (always walkable tiles).
  const spot = (c, r, face) => ({ c, r, face, x: c * T + 8, y: r * T + 13 });
  const STATIONS = {
    coffee: [spot(3, 3, 'up'), spot(2, 3, 'up')],
    cooler: [spot(7, 3, 'up')],
    vending: [spot(2, 5, 'left')],
    whiteboard: [spot(11, 2, 'up'), spot(12, 2, 'up'), spot(10, 2, 'up')],
    shelves: [spot(22, 3, 'up'), spot(21, 3, 'up'), spot(23, 3, 'up')],
    filing: [spot(24, 3, 'up')],
    terminal: [spot(26, 3, 'up'), spot(25, 3, 'up')],
    racks: [spot(27, 3, 'up'), spot(28, 3, 'up')],
    globe: [spot(22, 5, 'right'), spot(24, 5, 'left')],
    meeting: [spot(22, 11, 'right'), spot(27, 11, 'left'), spot(22, 12, 'right'), spot(27, 12, 'left')],
    printer: [spot(13, 14, 'down'), spot(14, 14, 'down')],
    window: [spot(8, 2, 'up'), spot(9, 2, 'up'), spot(14, 2, 'up'), spot(15, 2, 'up'), spot(19, 2, 'up')],
    arcade: [spot(1, 11, 'up')],
    elevator: [spot(16, 2, 'up'), spot(17, 2, 'up')],
  };
  STATIONS.meeting.forEach((s, i) => { s.eggs = { x: i % 2 === 0 ? 372 : 424, y: 184 + (i > 1 ? 10 : 0), dir: i % 2 === 0 ? 1 : -1 }; });
  const ELEVATOR = { x: 272, y: 45, c: 16, r: 2 };

  // Against the north wall (row 2): drawn with the background, nothing walks behind.
  block(1, 2); // fridge
  block(2, 2, 5, 1); // kitchen counter
  block(7, 2); // water cooler
  block(21, 2, 3, 1); // bookshelves
  block(24, 2); // filing cabinet
  block(26, 2); // terminal
  block(27, 2, 2, 1); // server racks

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
  // Windows on the north wall: [x, width].
  const WINDOWS = [[32, 32], [128, 32], [224, 32], [292, 28], [384, 32]];

  function drawSky(g, x0, y0, w, h, phase, now) {
    const cols = SKY[phase];
    for (let y = 0; y < h; y++) {
      const t = y / h;
      const band = t < 0.4 ? 0 : t < 0.75 ? 1 : 2;
      const edge = t < 0.4 ? 0.4 - t : t < 0.75 ? 0.75 - t : 1;
      for (let x = 0; x < w; x++) {
        let b = band;
        if (edge < 0.07 && ((x + y) & 1)) b = Math.min(2, b + 1);
        P(g, x0 + x, y0 + y, cols[b]);
      }
    }
    if (phase === 'night') {
      const rnd = DO.rng(42);
      for (let i = 0; i < 70; i++) {
        const sx = Math.floor(rnd() * W), sy = Math.floor(rnd() * h * 0.7);
        if (sx >= x0 && sx < x0 + w && (now / 900 + i) % 7 > 0.6) P(g, sx, y0 + sy, i % 5 ? C.white : C.yellow);
      }
      if (x0 === 226) { // moon
        R(g, x0 + 18, y0 + 3, 5, 5, C.yellow); R(g, x0 + 19, y0 + 2, 3, 1, C.yellow); R(g, x0 + 19, y0 + 8, 3, 1, C.yellow);
        R(g, x0 + 20, y0 + 3, 3, 4, SKY.night[0]);
      }
    } else if (phase === 'day' || phase === 'dawn') {
      // clouds drift across the whole wall, one sky behind every window
      for (const [base, cy, cw] of [[0, 3, 12], [170, 7, 9], [330, 2, 14]]) {
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
    } else if (phase === 'dusk' && x0 === 130) {
      R(g, x0 + 10, y0 + h - 6, 7, 4, C.gold); R(g, x0 + 11, y0 + h - 7, 5, 1, C.gold);
    }
    // city skyline at the bottom of every window
    const rnd = DO.rng(7);
    const lit = phase === 'night' || phase === 'dusk';
    for (let bx = 0; bx < W; bx += 6) {
      const bh = 3 + Math.floor(rnd() * 7);
      const bw = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < bw; k++) {
        const px = bx + k;
        if (px < x0 || px >= x0 + w) continue;
        R(g, px, y0 + h - bh, 1, bh, lit ? C.navy : C.steel);
        if (lit && k % 2 === 1) for (let yy = h - bh + 1; yy < h - 1; yy += 2) if (rnd() > 0.45) P(g, px, y0 + yy, C.yellow);
      }
    }
  }

  // ---------------------------------------------------------------- floor & walls (static)
  function zoneOf(c, r) {
    if (c <= 7 && r <= 9) return 'kitchen';
    if (c >= 21 && r <= 8) return 'library';
    if (c >= 21) return 'meeting';
    return 'wood';
  }

  function drawFloor(g) {
    // long wooden planks, two close tones, a seam every 4px
    const rnd = DO.rng(11);
    for (let y = 32; y < MAP_H; y += 4) {
      let x = 16 - Math.floor(rnd() * 48);
      while (x < W - 16) {
        const len = 28 + Math.floor(rnd() * 44);
        const tone = rnd() < 0.55 ? C.sand : C.wood;
        const x0 = Math.max(16, x), x1 = Math.min(W - 16, x + len);
        if (x1 > x0) {
          R(g, x0, y, x1 - x0, 3, tone);
          R(g, x0, y + 3, x1 - x0, 1, C.tan);
          if (x > 16) R(g, x0, y, 1, 3, C.tan);
          if (x1 - x0 > 14 && rnd() < 0.7) R(g, x0 + 4 + Math.floor(rnd() * (x1 - x0 - 12)), y + 1, 2 + Math.floor(rnd() * 5), 1, tone === C.sand ? C.wood : C.tan);
        }
        x += len;
      }
    }
    for (let r = 2; r < ROWS; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        const x = c * T, y = r * T, z = zoneOf(c, r);
        if (z === 'kitchen') {
          for (let q = 0; q < 4; q++) {
            const qx = x + (q % 2) * 8, qy = y + (q >> 1) * 8;
            const light = (c * 2 + (q % 2) + r * 2 + (q >> 1)) % 2 === 0;
            R(g, qx, qy, 8, 8, light ? C.cream : C.silver);
            R(g, qx + 7, qy, 1, 8, light ? C.sand : C.grey);
            R(g, qx, qy + 7, 8, 1, light ? C.sand : C.grey);
            if (light) P(g, qx + 1, qy + 1, C.white);
          }
        } else if (z === 'library') {
          R(g, x, y, T, T, C.forest);
          for (let k = 0; k < 4; k++) {
            const px = x + (k % 2) * 8 + ((r + (k >> 1)) % 2) * 4, py = y + (k >> 1) * 8 + 3;
            P(g, px + 1, py, C.green); P(g, px, py + 1, C.green); P(g, px + 2, py + 1, C.green); P(g, px + 1, py + 2, C.green);
          }
        } else if (z === 'meeting') {
          R(g, x, y, T, T, C.slate);
          R(g, x, y + 15, T, 1, C.navy);
          R(g, x + 15, y, 1, T, C.navy);
          for (let k = 2; k < 14; k += 4) P(g, x + k, y + 7, C.steel);
        }
      }
    }
    // thresholds between zones
    R(g, 128, 32, 1, 128, C.tan); R(g, 16, 160, 112, 1, C.tan);
    R(g, 335, 32, 1, MAP_H - 32, C.outline);
  }

  function drawRugs(g) {
    // lounge rug, in front of the sofa (never under it)
    R(g, 34, 194, 60, 44, C.plum);
    R(g, 36, 196, 56, 40, C.magenta);
    R(g, 38, 198, 52, 1, C.pink); R(g, 38, 233, 52, 1, C.pink);
    R(g, 38, 198, 1, 36, C.pink); R(g, 89, 198, 1, 36, C.pink);
    for (let y = 203; y < 230; y += 7) for (let x = 44 + ((y / 7) % 2) * 5; x < 86; x += 10) {
      P(g, x, y, C.pink); P(g, x - 1, y + 1, C.pink); P(g, x + 1, y + 1, C.pink); P(g, x, y + 2, C.pink);
      P(g, x, y + 1, C.yellow);
    }
    for (let y = 195; y < 237; y += 2) { P(g, 33, y, C.cream); P(g, 94, y, C.cream); }
    // runner along the main aisle, between the desk islands
    R(g, 146, 134, 156, 20, C.slate);
    R(g, 148, 136, 152, 16, C.steel);
    R(g, 150, 138, 148, 1, C.grey); R(g, 150, 149, 148, 1, C.grey);
    for (let x = 154; x < 296; x += 8) { P(g, x, 143, C.grey); P(g, x + 1, 142, C.grey); P(g, x + 1, 144, C.grey); P(g, x + 2, 143, C.grey); }
    for (let x = 147; x < 302; x += 3) { P(g, x, 133, C.silver); P(g, x, 154, C.silver); } // fringe
    // library rug under the globe
    R(g, 354, 66, 60, 44, C.wine);
    R(g, 356, 68, 56, 40, C.red);
    R(g, 358, 70, 52, 36, C.wine);
    for (let y = 74; y < 104; y += 6) for (let x = 362 + ((y / 6) % 2) * 3; x < 408; x += 6) P(g, x, y, C.gold);
    R(g, 359, 71, 50, 1, C.amber); R(g, 359, 104, 50, 1, C.amber);
    // welcome mat in front of the elevator
    box(g, 260, 50, 24, 10, C.brown, C.mahogany);
    R(g, 261, 51, 22, 1, C.tan);
    DO.font.draw(g, 'COIN', 265, 53, C.cream);
  }

  function drawWall(g) {
    R(g, 0, 0, W, 4, C.outline);
    R(g, 0, 3, W, 1, C.mahogany);
    R(g, 16, 4, W - 32, 17, C.cream);
    for (let x = 16; x < W - 16; x += 2) P(g, x, 4, C.sand);
    for (let x = 20; x < W - 16; x += 8) R(g, x, 8, 1, 12, C.sand); // faint stripes
    R(g, 16, 21, W - 32, 1, C.sand);
    R(g, 16, 22, W - 32, 1, C.wood); // chair rail
    R(g, 16, 23, W - 32, 1, C.brown);
    R(g, 16, 24, W - 32, 6, C.tan); // wainscot panels
    for (let x = 18; x < W - 20; x += 12) {
      R(g, x, 25, 10, 1, C.brown); R(g, x, 25, 1, 4, C.brown);
      R(g, x + 1, 28, 9, 1, C.wood); R(g, x + 10, 25, 1, 4, C.wood);
    }
    R(g, 16, 30, W - 32, 2, C.mahogany); // baseboard
    R(g, 16, 31, W - 32, 1, C.outline);
    // side walls, seen from above
    R(g, 0, 0, 16, MAP_H, C.outline);
    R(g, 11, 32, 4, MAP_H - 32, C.mahogany); R(g, 15, 32, 1, MAP_H - 32, C.brown);
    R(g, W - 16, 0, 16, MAP_H, C.outline);
    R(g, W - 15, 32, 4, MAP_H - 32, C.mahogany); R(g, W - 16, 32, 1, MAP_H - 32, C.brown);
    shade(g, 16, 32, W - 32, 2); // the wall's shadow on the floor
    shade(g, 16, 32, 2, MAP_H - 32);
  }

  // ---------------------------------------------------------------- wall row furniture (static)
  function drawKitchenWall(g) {
    // backsplash tiles between the counter and the cabinets/window
    R(g, 32, 24, 80, 6, C.white);
    for (let x = 32; x < 112; x += 4) R(g, x + 3, 24, 1, 6, C.silver);
    R(g, 32, 26, 80, 1, C.silver); R(g, 32, 29, 80, 1, C.silver);
    // upper cabinets
    for (let i = 0; i < 3; i++) {
      const x = 64 + i * 16;
      panel(g, x, 6, 16, 13, C.wood, C.cream, C.tan);
      R(g, x + 3, 9, 10, 6, C.sand); R(g, x + 3, 9, 10, 1, C.tan); // door inset
      R(g, x + 7, 15, 2, 1, C.gold);
    }
    R(g, 64, 19, 48, 1, C.mahogany); // under-cabinet light rail
    // chalkboard menu above the water cooler
    box(g, 113, 4, 14, 9, C.navy, C.brown);
    R(g, 115, 6, 7, 1, C.white); R(g, 115, 8, 5, 1, C.silver); R(g, 115, 10, 6, 1, C.silver);
    R(g, 121, 8, 3, 2, C.pink); P(g, 124, 8, C.pink); // a little cup doodle
    R(g, 114, 13, 12, 1, C.mahogany);
  }

  function drawFridge(g) {
    const x = 17, y = 8;
    panel(g, x, y, 15, 40, C.white, null, C.silver);
    R(g, x + 12, y + 1, 2, 38, C.silver);
    R(g, x + 1, y + 13, 13, 1, C.grey); // freezer door
    R(g, x + 2, y + 4, 1, 6, C.grey); R(g, x + 2, y + 17, 1, 10, C.grey); // handles
    P(g, x + 7, y + 5, C.red); P(g, x + 10, y + 8, C.blue); P(g, x + 8, y + 18, C.gold);
    R(g, x + 6, y + 22, 5, 5, C.cream); P(g, x + 7, y + 23, C.blue); P(g, x + 9, y + 24, C.yellow); P(g, x + 8, y + 25, C.lime); // a drawing
    R(g, x + 1, y + 36, 13, 3, C.grey); // kick plate
  }

  function drawCounter(g) {
    // base cabinets
    R(g, 32, 30, 80, 18, C.outline);
    R(g, 33, 31, 78, 3, C.silver); R(g, 33, 31, 78, 1, C.white); // countertop
    R(g, 33, 34, 78, 13, C.brown);
    for (let i = 0; i < 5; i++) {
      const x = 33 + i * 16;
      R(g, x, 34, 1, 13, C.mahogany);
      R(g, x + 2, 35, 12, 2, C.tan); R(g, x + 7, 35, 2, 1, C.gold); // drawer
      R(g, x + 2, 38, 12, 7, C.tan); R(g, x + 3, 39, 10, 5, C.brown); R(g, x + 12, 40, 1, 3, C.gold); // door
    }
    R(g, 33, 46, 78, 1, C.outline); // toe kick
    // kettle
    R(g, 36, 25, 6, 6, C.outline); R(g, 37, 26, 4, 4, C.steel); P(g, 37, 26, C.grey); R(g, 42, 26, 1, 3, C.outline); R(g, 38, 24, 2, 1, C.outline);
    // coffee machine
    panel(g, 49, 13, 13, 18, C.navy, C.slate, C.black);
    R(g, 51, 15, 9, 4, C.wine); R(g, 52, 16, 3, 1, C.red);
    R(g, 51, 21, 9, 1, C.steel); R(g, 54, 22, 3, 2, C.grey); // spout
    R(g, 51, 28, 9, 2, C.steel); // drip tray
    // fruit bowl
    R(g, 67, 28, 9, 3, C.outline); R(g, 68, 28, 7, 2, C.cream);
    P(g, 69, 27, C.red); P(g, 71, 26, C.lime); P(g, 72, 27, C.gold); P(g, 73, 26, C.orange);
    // sink & faucet
    R(g, 80, 30, 13, 3, C.outline); R(g, 81, 31, 11, 1, C.grey); R(g, 82, 31, 9, 1, C.steel);
    R(g, 86, 23, 2, 7, C.silver); R(g, 86, 23, 5, 1, C.silver); P(g, 90, 24, C.silver); P(g, 85, 27, C.grey);
    // microwave
    panel(g, 96, 20, 15, 11, C.silver, C.white, C.grey);
    R(g, 98, 22, 8, 7, C.navy); R(g, 99, 23, 2, 1, C.slate);
    P(g, 108, 23, C.lime); P(g, 108, 25, C.grey); P(g, 108, 27, C.grey);
  }

  function drawCooler(g) {
    panel(g, 115, 30, 12, 18, C.white, null, C.silver);
    R(g, 117, 34, 8, 1, C.silver);
    P(g, 118, 37, C.red); P(g, 123, 37, C.blue);
    R(g, 117, 40, 8, 1, C.grey);
    R(g, 116, 17, 10, 13, C.deep); R(g, 117, 18, 8, 11, C.blue); R(g, 118, 19, 2, 8, C.cyan);
    R(g, 119, 15, 4, 2, C.deep);
  }

  function drawWhiteboard(g) {
    const x = 162, y = 6, w = 60, h = 18;
    panel(g, x, y, w, h, C.white, null, C.silver, C.grey);
    R(g, x + 1, y + 1, w - 2, 1, C.silver);
    R(g, x + 4, y + h, w - 8, 2, C.grey); R(g, x + 4, y + h + 1, w - 8, 1, C.steel); // marker tray
    P(g, x + 10, y + h, C.red); P(g, x + 11, y + h, C.red); P(g, x + 14, y + h, C.blue); P(g, x + 15, y + h, C.blue); P(g, x + 18, y + h, C.green);
    R(g, x + 5, y + 4, 14, 1, C.blue); R(g, x + 5, y + 7, 10, 1, C.blue); R(g, x + 5, y + 10, 12, 1, C.blue);
    for (let k = 0; k < 5; k++) R(g, x + 26 + k * 4, y + 13 - k * 2, 2, k * 2 + 2, k === 4 ? C.red : C.lime);
    R(g, x + 25, y + 15, 20, 1, C.steel);
    // a tiny duck doodle
    R(g, x + 50, y + 5, 4, 3, C.gold); R(g, x + 51, y + 3, 2, 2, C.gold); P(g, x + 53, y + 4, C.orange);
  }

  function drawElevatorFrame(g) {
    R(g, 256, 4, 32, 28, C.outline);
    R(g, 257, 5, 30, 26, C.steel);
    R(g, 257, 5, 30, 1, C.grey);
    R(g, 268, 5, 8, 3, C.black); // floor display
    // exit sign over the doors
    box(g, 266, 0, 12, 5, C.green, C.forest);
    P(g, 268, 1, C.white); R(g, 268, 2, 2, 1, C.white); P(g, 267, 3, C.white); P(g, 269, 3, C.white); // running figure
    R(g, 271, 2, 4, 1, C.white); P(g, 274, 1, C.white); P(g, 274, 3, C.white); // arrow
  }

  function drawClockFace(g, date) {
    const cx = 328, cy = 12;
    oval(g, cx, cy, 5, 5, C.outline);
    oval(g, cx, cy, 4, 4, C.white);
    P(g, cx, cy - 4, C.grey); P(g, cx + 4, cy, C.grey); P(g, cx, cy + 4, C.grey); P(g, cx - 4, cy, C.grey);
    const hr = ((date.getHours() % 12) + date.getMinutes() / 60) / 12 * Math.PI * 2;
    const mn = (date.getMinutes() / 60) * Math.PI * 2;
    for (let k = 1; k <= 3; k++) P(g, cx + Math.round(Math.sin(mn) * k), cy - Math.round(Math.cos(mn) * k), C.black);
    for (let k = 1; k <= 2; k++) P(g, cx + Math.round(Math.sin(hr) * k), cy - Math.round(Math.cos(hr) * k), C.red);
    P(g, cx, cy, C.black);
  }

  function drawShelves(g) {
    const rnd = DO.rng(1234);
    const x0 = 337, w = 46;
    panel(g, x0, 4, w, 44, C.mahogany, C.brown, C.outline);
    R(g, x0 + 2, 6, w - 4, 40, C.outline);
    const books = [C.red, C.blue, C.lime, C.gold, C.plum, C.cream, C.deep, C.rust, C.green, C.magenta, C.pink, C.cyan];
    for (let s = 0; s < 4; s++) {
      const base = 15 + s * 10;
      R(g, x0 + 1, base, w - 2, 2, C.brown); R(g, x0 + 1, base, w - 2, 1, C.tan); // shelf board
      let bx = x0 + 3;
      while (bx < x0 + w - 5) {
        const roll = rnd();
        if (roll < 0.08) { // a book lying flat
          const col = books[Math.floor(rnd() * books.length)];
          R(g, bx, base - 2, 6, 2, col); R(g, bx, base - 2, 6, 1, C.cream);
          bx += 7;
          continue;
        }
        if (roll < 0.14 && s === 0) { // a small plant on the top shelf
          R(g, bx, base - 3, 4, 3, C.rust); R(g, bx, base - 6, 1, 3, C.green); R(g, bx + 1, base - 7, 2, 4, C.lime); R(g, bx + 3, base - 5, 1, 2, C.green);
          bx += 5;
          continue;
        }
        const bw = rnd() < 0.3 ? 3 : 2;
        const bh = 5 + Math.floor(rnd() * 4);
        const col = books[Math.floor(rnd() * books.length)];
        R(g, bx, base - bh, bw, bh, col);
        R(g, bx, base - bh + 2, bw, 1, C.cream); // spine band
        if (bw === 3) P(g, bx + 1, base - 2, C.cream);
        bx += bw + (rnd() < 0.15 ? 1 : 0);
      }
    }
    R(g, x0, 46, w, 2, C.outline);
  }

  function drawFiling(g) {
    panel(g, 386, 25, 13, 23, C.grey, C.silver, C.steel);
    for (let k = 0; k < 3; k++) {
      const y = 27 + k * 7;
      R(g, 387, y + 6, 11, 1, C.steel);
      R(g, 389, y + 1, 7, 2, C.white); R(g, 389, y + 1, 7, 1, C.silver); // label holder
      R(g, 390, y + 4, 5, 1, C.slate); // handle
    }
  }

  function drawTerminalDesk(g) {
    // a framed duck painting above
    box(g, 418, 6, 12, 10, C.blue, C.brown);
    R(g, 419, 13, 10, 2, C.green);
    R(g, 422, 9, 4, 3, C.yellow); R(g, 423, 8, 2, 1, C.yellow); P(g, 425, 9, C.orange);
    // desk + CRT
    panel(g, 416, 34, 16, 14, C.slate, C.steel, C.navy);
    R(g, 418, 40, 12, 1, C.navy);
    panel(g, 417, 18, 15, 15, C.cream, C.white, C.sand);
    R(g, 419, 20, 11, 9, C.black);
    R(g, 422, 31, 5, 3, C.sand); // stand
    R(g, 419, 35, 11, 2, C.grey); R(g, 420, 35, 9, 1, C.silver); // keyboard
  }

  function drawRacks(g) {
    for (const x of [433, 449]) {
      panel(g, x, 6, 14, 42, C.navy, C.slate, C.black);
      for (let y = 9; y < 44; y += 4) {
        R(g, x + 2, y, 10, 3, C.black);
        R(g, x + 2, y, 10, 1, C.slate);
      }
      R(g, x + 2, 44, 10, 2, C.steel); // vent
      P(g, x + 4, 45, C.black); P(g, x + 7, 45, C.black); P(g, x + 10, 45, C.black);
    }
    R(g, 445, 46, 6, 1, C.blue); R(g, 447, 47, 3, 1, C.red); // cables between the racks
  }

  function renderBackground(date) {
    const c = canvas(W, MAP_H);
    const g = c.getContext('2d');
    drawFloor(g);
    drawRugs(g);
    drawWall(g);
    drawKitchenWall(g);
    drawFridge(g);
    drawCounter(g);
    drawCooler(g);
    drawWhiteboard(g);
    drawElevatorFrame(g);
    drawClockFace(g, date);
    drawShelves(g);
    drawFiling(g);
    drawTerminalDesk(g);
    drawRacks(g);
    for (const f of FURN) if (f.shadow) f.shadow(g); // soft shadows of the floor furniture
    return c;
  }

  // ---------------------------------------------------------------- dynamic wall layer
  const dyn = {
    seats: {}, // seatId -> { state, cat }
    elevator: 0, // door openness 0..1
    coffee: false, terminal: false, racks: 0, globe: false,
    whiteboard: null, // { done, total }
    podLabels: {},
  };

  let winCache = null;
  let winKey = '';
  function drawWindows(g, phase, now) {
    const key = phase + ':' + Math.floor(now / 1000);
    if (key !== winKey) {
      winKey = key;
      winCache = winCache || canvas(W, 26);
      const wg = winCache.getContext('2d');
      wg.clearRect(0, 0, W, 26);
      WINDOWS.forEach(([x, w], i) => {
        R(wg, x + 1, 5, w - 2, 18, C.white);
        drawSky(wg, x + 2, 6, w - 4, 15, phase, now);
        R(wg, x + (w >> 1) - 1, 6, 2, 15, C.white); // mullion
        R(wg, x + 2, 12, w - 4, 1, C.white); // transom
        // tied curtains
        for (const cx of [x + 2, x + w - 5]) {
          R(wg, cx, 6, 3, 15, C.sand); R(wg, cx + 1, 6, 1, 15, C.cream);
          R(wg, cx, 13, 3, 1, C.tan);
        }
        R(wg, x, 21, w, 2, C.white); R(wg, x, 22, w, 1, C.silver); // sill
        R(wg, x + w - 1, 5, 1, 16, C.silver);
        if (i === 1 || i === 3) { // a succulent on the sill
          R(wg, x + 9, 19, 3, 2, C.rust); P(wg, x + 9, 18, C.green); P(wg, x + 10, 17, C.lime); P(wg, x + 11, 18, C.green);
        }
      });
    }
    g.drawImage(winCache, 0, 0);
  }

  // sun patches on the floor under the windows
  let beamCache = null;
  let beamKey = '';
  function drawSunbeams(g, phase) {
    if (phase === 'night') return;
    if (beamKey !== phase) {
      beamKey = phase;
      beamCache = beamCache || canvas(W, 80);
      const bg = beamCache.getContext('2d');
      bg.clearRect(0, 0, W, 80);
      bg.fillStyle = phase === 'day' ? 'rgba(255, 255, 255, 0.13)' : 'rgba(254, 174, 52, 0.12)';
      // only windows above free floor (not above the kitchen counter or the filing cabinet)
      for (const [x, w] of WINDOWS.slice(1, 4)) {
        for (let y = 0; y < 26; y++) {
          const shift = Math.floor(y / 2);
          bg.fillRect(x + 4 + shift, 34 + y, w - 8, 1);
        }
      }
    }
    g.drawImage(beamCache, 0, 0);
  }

  function drawElevator(g, now) {
    const open = dyn.elevator;
    R(g, 258, 8, 28, 23, C.navy); // cabin
    R(g, 260, 9, 24, 1, C.gold);
    R(g, 258, 29, 28, 2, C.slate);
    const shift = Math.round(open * 13);
    const w = 14 - shift;
    if (w > 0) {
      for (const [dx, flip] of [[258, false], [272 + shift, true]]) {
        R(g, dx, 8, w, 23, C.grey);
        for (let k = 2; k < w - 1; k += 3) R(g, dx + k, 9, 1, 21, C.silver); // brushed steel
        R(g, flip ? dx : dx + w - 1, 8, 1, 23, C.steel);
      }
    }
    // the floor display lights up while someone takes the elevator
    const lit = open > 0;
    P(g, 271, 6, lit || Math.floor(now / 1500) % 3 === 0 ? C.gold : C.wine);
    P(g, 272, 6, lit ? C.gold : C.wine);
  }

  function drawCoffee(g, now) {
    P(g, 58, 18, Math.floor(now / 600) % 2 ? C.lime : C.green);
    R(g, 53, 25, 5, 4, C.white); R(g, 53, 25, 5, 1, C.brown); P(g, 58, 26, C.white); // cup
    if (dyn.coffee) {
      for (let k = 0; k < 3; k++) {
        const t = (now / 300 + k * 3) % 9;
        P(g, 55 + ((k + Math.floor(t)) % 2), 23 - Math.floor(t), C.silver);
      }
    }
  }

  function drawCoolerBubbles(g, now) {
    const t = Math.floor(now / 250);
    for (let k = 0; k < 3; k++) {
      const y = 28 - ((t + k * 5) % 10);
      P(g, 120 + (k % 2) * 2, y, C.white);
    }
  }

  function drawTerminalScreen(g, now) {
    R(g, 419, 20, 11, 9, C.black);
    const busy = dyn.terminal;
    const scroll = busy ? Math.floor(now / 150) : Math.floor(now / 2000);
    for (let line = 0; line < 4; line++) {
      const len = 2 + ((scroll + line * 3) * 7) % 7;
      R(g, 420, 21 + line * 2, len, 1, busy ? C.lime : C.green);
    }
    if (Math.floor(now / 500) % 2) P(g, 420 + ((scroll * 3) % 7), 27, C.lime);
  }

  function drawRackLeds(g, now) {
    const speed = dyn.racks > 0 ? 120 : 900;
    const tick = Math.floor(now / speed);
    for (const [ri, x] of [[0, 433], [1, 449]]) {
      for (let row = 0; row < 9; row++) {
        const y = 10 + row * 4;
        for (let k = 0; k < 3; k++) {
          const on = (((tick + row * 7 + k * 3 + ri * 5) * 2654435761) >>> 0) % 5 < (dyn.racks > 0 ? 3 : 2);
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
      const done = k < Math.round((wb.done / wb.total) * n);
      R(g, x, y + k * 3, 2, 2, done ? C.green : C.steel);
      R(g, x + 3, y + k * 3, 6 + ((k * 5) % 9), 1, done ? C.grey : C.blue);
    }
  }

  function drawWallLayer(g, now, date) {
    const phase = skyPhase(date);
    drawSunbeams(g, phase);
    drawWindows(g, phase, now);
    drawElevator(g, now);
    drawCoffee(g, now);
    drawCoolerBubbles(g, now);
    drawTerminalScreen(g, now);
    drawRackLeds(g, now);
    drawWhiteboardTodos(g);
  }

  // ---------------------------------------------------------------- desk pods
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

  // Office chair whose backrest is behind a duck that faces you (tile top = y).
  function drawChairNorth(g, cx, y) {
    R(g, cx - 5, y + 1, 10, 9, C.outline);
    R(g, cx - 4, y + 2, 8, 7, C.slate); R(g, cx - 4, y + 2, 8, 1, C.steel); R(g, cx - 4, y + 2, 1, 6, C.steel);
    R(g, cx - 7, y + 7, 2, 4, C.outline); R(g, cx + 5, y + 7, 2, 4, C.outline); // armrests
    R(g, cx - 6, y + 9, 12, 4, C.outline);
    R(g, cx - 5, y + 10, 10, 2, C.steel); // seat
    R(g, cx - 1, y + 13, 2, 1, C.outline); // gas lift
    R(g, cx - 5, y + 14, 10, 1, C.navy); P(g, cx - 5, y + 14, C.black); P(g, cx + 4, y + 14, C.black); // base
  }
  // Office chair seen from behind, in front of a duck that shows its back.
  function drawChairSouth(g, cx, y) {
    R(g, cx - 5, y + 2, 10, 8, C.outline);
    R(g, cx - 4, y + 3, 8, 6, C.slate); R(g, cx - 4, y + 3, 8, 1, C.steel);
    R(g, cx - 3, y + 6, 6, 1, C.navy); // lumbar seam
    R(g, cx - 1, y + 10, 2, 2, C.outline);
    R(g, cx - 5, y + 12, 10, 1, C.navy); P(g, cx - 5, y + 13, C.black); P(g, cx + 4, y + 13, C.black); P(g, cx - 1, y + 13, C.black);
  }

  const DESK_PROPS = ['mug', 'plant', 'papers', 'duck', 'lamp', 'books', 'cactus', 'photo'];
  function drawProp(g, kind, x, y, lit, now) {
    if (kind === 'mug') {
      R(g, x, y, 4, 4, C.outline); R(g, x + 1, y + 1, 2, 2, C.white); R(g, x + 1, y + 1, 2, 1, C.brown); P(g, x + 4, y + 1, C.outline);
      if (lit && Math.floor(now / 500) % 2) P(g, x + 1, y - 2, C.silver);
    } else if (kind === 'plant') {
      R(g, x, y + 2, 5, 3, C.outline); R(g, x + 1, y + 2, 3, 2, C.rust);
      R(g, x, y - 1, 2, 3, C.green); R(g, x + 2, y - 2, 2, 4, C.lime); R(g, x + 4, y, 1, 2, C.green);
    } else if (kind === 'cactus') {
      R(g, x + 1, y + 3, 3, 2, C.amber); R(g, x + 2, y - 1, 1, 4, C.green); P(g, x + 1, y + 1, C.green); P(g, x + 3, y, C.green); P(g, x + 2, y - 2, C.pink);
    } else if (kind === 'papers') {
      R(g, x, y + 1, 6, 4, C.outline); R(g, x + 1, y + 1, 4, 3, C.white); R(g, x + 1, y + 2, 3, 1, C.silver);
      R(g, x + 1, y, 5, 1, C.silver);
    } else if (kind === 'duck') {
      R(g, x, y + 1, 4, 3, C.yellow); R(g, x + 1, y - 1, 2, 2, C.yellow); P(g, x + 3, y, C.orange); P(g, x, y + 3, C.gold);
    } else if (kind === 'lamp') {
      R(g, x, y + 4, 5, 1, C.outline); R(g, x + 1, y + 1, 1, 3, C.steel); R(g, x, y - 1, 5, 2, C.gold); R(g, x + 1, y - 1, 3, 1, C.yellow);
    } else if (kind === 'books') {
      R(g, x, y + 2, 6, 2, C.red); R(g, x + 1, y, 5, 2, C.blue); R(g, x, y + 2, 6, 1, C.pink); R(g, x + 1, y, 5, 1, C.cyan);
    } else if (kind === 'photo') {
      R(g, x, y, 5, 5, C.outline); R(g, x + 1, y + 1, 3, 3, C.cyan); P(g, x + 2, y + 2, C.yellow); P(g, x + 2, y + 5, C.outline);
    }
  }

  function makePod(pod) {
    const X0 = pod.x, Y0 = pod.y;
    const seats = SEATS.filter((s) => s.pod === pod);
    const rnd = DO.rng(DO.hash(pod.id));
    const felt = [C.green, C.deep, C.plum, C.rust][PODS.indexOf(pod) % 4];
    const bench = sprite(64, 43, (g) => {
      // bench: north desk, divider, south desk, front face, legs (sprite y 0 = Y0 + 15)
      R(g, 0, 0, 64, 40, C.outline);
      R(g, 1, 1, 62, 13, C.wood); // north desk
      R(g, 1, 1, 62, 1, C.cream);
      R(g, 1, 19, 62, 14, C.wood); // south desk
      for (let k = 0; k < 7; k++) R(g, 3 + Math.floor(rnd() * 52), 3 + Math.floor(rnd() * 9) + (k > 3 ? 18 : 0), 4 + Math.floor(rnd() * 6), 1, C.sand); // grain
      // privacy divider standing between the two desks
      R(g, 1, 13, 62, 1, C.silver);
      R(g, 1, 14, 62, 4, felt);
      R(g, 1, 14, 62, 1, C.silver);
      R(g, 1, 18, 62, 1, C.tan); // its shadow on the south desk
      for (let k = 0; k < 3; k++) { // sticky notes
        const nx = 6 + Math.floor(rnd() * 50);
        R(g, nx, 15, 2, 2, [C.yellow, C.pink, C.cyan][k]);
      }
      R(g, 1, 32, 62, 1, C.tan); // edge
      R(g, 1, 33, 62, 5, C.brown); // front face
      R(g, 1, 33, 62, 1, C.tan);
      R(g, 1, 38, 62, 1, C.mahogany);
      R(g, 1, 40, 3, 3, C.outline); R(g, 60, 40, 3, 3, C.outline); // legs
      R(g, 1, 1, 1, 37, C.tan); R(g, 62, 1, 1, 37, C.tan);
    });
    const parts = [];
    for (const s of seats) {
      if (s.side === 'n') parts.push({ y: Y0 + 14, draw: (g) => drawChairNorth(g, s.cx, Y0) });
      else parts.push({ y: Y0 + 61, draw: (g) => drawChairSouth(g, s.cx, Y0 + 48) });
    }
    parts.push({
      y: Y0 + 54,
      draw: (g, now) => {
        g.drawImage(bench(), X0, Y0 + 15);
        for (const s of seats) {
          const st = dyn.seats[s.id];
          const prop = DESK_PROPS[DO.hash(s.id) % DESK_PROPS.length];
          if (s.side === 'n') {
            drawProp(g, prop, s.cx + 8, Y0 + 19, !!st, now);
            if (st) {
              // open laptop: we see the back of its lid and a sliver of its base
              R(g, s.cx - 6, Y0 + 13, 12, 9, C.outline);
              R(g, s.cx - 5, Y0 + 14, 10, 7, C.grey);
              R(g, s.cx - 5, Y0 + 14, 10, 1, C.silver);
              P(g, s.cx - 6, Y0 + 13, C.wood); P(g, s.cx + 5, Y0 + 13, C.wood); // rounded corners
              const logo = seatScreenColor(st, now) || C.white;
              R(g, s.cx - 1, Y0 + 16, 2, 2, logo); P(g, s.cx + 1, Y0 + 16, logo);
              R(g, s.cx - 6, Y0 + 22, 12, 1, C.steel);
            } else {
              R(g, s.cx - 6, Y0 + 19, 12, 3, C.outline); R(g, s.cx - 5, Y0 + 19, 10, 1, C.silver); R(g, s.cx - 5, Y0 + 20, 10, 1, C.grey);
            }
          } else {
            drawProp(g, prop === 'mug' ? 'lamp' : prop, s.cx - 15, Y0 + 37, !!st, now);
            // monitor on its stand, keyboard and mouse
            R(g, s.cx - 7, Y0 + 24, 14, 10, C.outline);
            R(g, s.cx - 6, Y0 + 25, 12, 8, st ? seatScreenColor(st, now) : C.navy);
            if (st) drawScreenContent(g, s.cx - 6, Y0 + 25, st, now);
            else R(g, s.cx - 5, Y0 + 26, 3, 1, C.slate); // reflection on the dark screen
            R(g, s.cx - 1, Y0 + 34, 2, 2, C.outline); R(g, s.cx - 3, Y0 + 36, 6, 1, C.outline);
            R(g, s.cx - 6, Y0 + 39, 12, 3, C.outline); R(g, s.cx - 5, Y0 + 39, 10, 1, C.silver); R(g, s.cx - 5, Y0 + 40, 10, 1, C.grey);
            R(g, s.cx + 8, Y0 + 39, 2, 3, C.outline); P(g, s.cx + 8, Y0 + 39, C.silver);
          }
        }
        // the project's nameplate on the front of the bench (none for the home folder)
        const label = dyn.podLabels[pod.id];
        if (label) {
          const w = DO.font.measure(label) + 4;
          box(g, X0 + 32 - (w >> 1), Y0 + 47, w, 7, C.gold, C.mahogany);
          R(g, X0 + 33 - (w >> 1), Y0 + 48, w - 2, 1, C.yellow);
          DO.font.draw(g, label, X0 + 34 - (w >> 1), Y0 + 48, C.outline);
        }
      },
    });
    furniture('pod ' + pod.id, rect(pod.c, pod.r, 4, 4), parts);
    FURN[FURN.length - 1].shadow = (g) => shade(g, X0 + 2, Y0 + 58, 62, 2);
  }

  function drawScreenContent(g, x, y, st, now) {
    if (st.state === 'tool' && st.cat === 'exec') {
      const s = Math.floor(now / 200);
      for (let k = 0; k < 3; k++) R(g, x + 1, y + 1 + k * 2, 2 + ((s + k * 5) % 7), 1, C.lime);
    } else if (st.state === 'tool' && (st.cat === 'edit' || st.cat === 'todo')) {
      const s = Math.floor(now / 250);
      for (let k = 0; k < 3; k++) R(g, x + 1 + (k % 2) * 2, y + 1 + k * 2, 3 + ((s + k * 3) % 6), 1, C.steel);
    } else if (st.state === 'tool' && (st.cat === 'read' || st.cat === 'search')) {
      for (let k = 0; k < 3; k++) R(g, x + 1, y + 1 + k * 2, 9 - k, 1, C.grey);
    } else if (st.state === 'tool' && st.cat === 'web') {
      R(g, x + 3, y + 1, 5, 5, C.cyan); R(g, x + 4, y + 2, 2, 2, C.lime);
    } else if (st.state === 'thinking' || st.state === 'supervising') {
      const k = Math.floor(now / 400) % 3;
      for (let d = 0; d <= k; d++) P(g, x + 3 + d * 2, y + 4, C.cyan);
    } else if (st.state === 'done') {
      const t = now / 1500;
      P(g, x + 5 + Math.round(Math.sin(t) * 3), y + 3 + Math.round(Math.cos(t * 1.3) * 2), C.lime);
    }
  }

  // ---------------------------------------------------------------- kitchen
  function makeKitchen() {
    // vending machine against the west wall
    const vending = sprite(16, 30, (g) => {
      panel(g, 0, 0, 16, 30, C.wine, C.red, C.outline);
      R(g, 2, 3, 9, 18, C.outline); R(g, 3, 4, 7, 16, C.navy); // glass
      const snacks = [C.gold, C.lime, C.red, C.cyan, C.pink, C.orange];
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 3; k++) R(g, 3 + k * 2 + (k > 0 ? k - 1 : 0), 5 + row * 4, 2, 3, snacks[(row * 3 + k) % snacks.length]);
        R(g, 3, 8 + row * 4, 7, 1, C.slate);
      }
      R(g, 4, 5, 1, 14, C.slate); // glass reflection
      R(g, 12, 4, 2, 2, C.lime); // display
      for (let k = 0; k < 3; k++) P(g, 12 + (k % 2), 8 + k * 2, C.silver);
      R(g, 12, 15, 1, 3, C.black); // coin slot
      R(g, 2, 23, 9, 3, C.black); R(g, 2, 23, 9, 1, C.outline);
      R(g, 1, 28, 14, 1, C.outline);
    });
    furniture('vending machine', [[1, 5]], [{ y: 5 * T + 15, draw: (g) => g.drawImage(vending(), 16, 5 * T - 14) }]);
    FURN[FURN.length - 1].shadow = (g) => shade(g, 17, 5 * T + 15, 15, 1);
    // recycling bins
    furniture('bins', [[1, 8]], [{ y: 8 * T + 15, draw: (g) => {
      for (const [x, col, dark] of [[17, C.blue, C.deep], [24, C.green, C.forest]]) {
        R(g, x, 8 * T + 4, 7, 12, C.outline);
        R(g, x + 1, 8 * T + 5, 5, 10, col); R(g, x + 1, 8 * T + 5, 1, 10, dark);
        R(g, x, 8 * T + 3, 7, 2, dark); R(g, x + 1, 8 * T + 3, 5, 1, col);
        P(g, x + 3, 8 * T + 9, C.white); P(g, x + 2, 8 * T + 10, C.white); P(g, x + 4, 8 * T + 10, C.white);
      }
    } }]);
    // round cafe table
    const table = sprite(32, 16, (g) => {
      oval(g, 16, 5, 14, 5, C.outline);
      oval(g, 16, 4, 13, 4, C.white);
      oval(g, 16, 5, 13, 3, C.silver);
      oval(g, 16, 4, 12, 3, C.white);
      R(g, 15, 10, 2, 4, C.outline); R(g, 15, 10, 1, 4, C.grey);
      oval(g, 16, 14, 5, 1, C.outline);
      R(g, 9, 2, 4, 3, C.white); R(g, 9, 2, 4, 1, C.brown); R(g, 9, 2, 1, 3, C.outline); // cup
      R(g, 19, 3, 5, 2, C.gold); P(g, 20, 2, C.yellow); P(g, 22, 2, C.yellow); // croissant
    });
    furniture('cafe table', rect(3, 6, 2, 1), [{ y: 6 * T + 12, draw: (g) => g.drawImage(table(), 48, 6 * T) }]);
    FURN[FURN.length - 1].shadow = (g) => softShadow(g, 64, 6 * T + 15, 10, 1);
    // stools (their tiles are seats)
    for (const s of LOUNGE.filter((x) => x.id.startsWith('stool'))) {
      const x = s.point.x, top = s.tile.r * T;
      const front = s.sit.view === 'front';
      FURN.push({ name: 'stool ' + s.id, tiles: [[s.tile.c, s.tile.r]], parts: [{ y: front ? top + 6 : top + 4, draw: (g) => {
        oval(g, x, top + (front ? 9 : 7), 4, 1, C.outline);
        oval(g, x, top + (front ? 8 : 6), 3, 1, C.red);
        R(g, x - 1, top + (front ? 10 : 8), 2, 4, C.steel);
        R(g, x - 3, top + (front ? 13 : 11), 6, 1, C.grey);
      } }] });
    }
    plant(7, 8, 'fern');
  }

  // ---------------------------------------------------------------- lounge
  function makeLounge() {
    // arcade cabinet (30px tall: it only rises over the free floor tile behind it)
    furniture('arcade', [[1, 10]], [{ y: 10 * T + 15, draw: (g, now) => {
      const x = 17, y = 146;
      R(g, x, y, 15, 30, C.outline);
      R(g, x + 1, y + 1, 13, 28, C.plum);
      R(g, x + 1, y + 1, 1, 28, C.magenta);
      R(g, x + 1, y + 1, 13, 6, C.hot); R(g, x + 2, y + 2, 11, 1, C.pink); // marquee
      DO.font.draw(g, 'GO', x + 4, y + 2, C.yellow);
      R(g, x + 2, y + 8, 11, 9, C.outline); R(g, x + 3, y + 9, 9, 7, C.black); // screen
      const f = Math.floor(now / 180);
      for (let k = 0; k < 4; k++) P(g, x + 3 + ((f + k * 3) % 9), y + 9 + ((f * 2 + k * 5) % 7), k % 2 ? C.cyan : C.lime);
      R(g, x + 1, y + 18, 13, 4, C.magenta); R(g, x + 1, y + 18, 13, 1, C.pink); // control deck
      R(g, x + 4, y + 19, 1, 2, C.outline); P(g, x + 4, y + 18, C.red); // joystick
      P(g, x + 8, y + 20, C.red); P(g, x + 10, y + 20, C.yellow); P(g, x + 12, y + 20, C.cyan);
      R(g, x + 5, y + 24, 5, 2, C.outline); P(g, x + 7, y + 24, C.gold); // coin door
      R(g, x + 1, y + 28, 13, 1, C.black);
    } }]);
    FURN[FURN.length - 1].shadow = (g) => shade(g, 18, 10 * T + 15, 14, 1);

    // sofa: back part (drawn before a seated duck) and front part (after)
    const sofaBack = sprite(48, 22, (g) => {
      R(g, 0, 0, 48, 22, C.outline);
      R(g, 1, 1, 46, 13, C.green); // backrest
      R(g, 1, 1, 46, 2, C.lime);
      R(g, 16, 3, 1, 10, C.forest); R(g, 31, 3, 1, 10, C.forest); // back cushions
      R(g, 6, 14, 36, 7, C.lime); // seat cushions (top)
      R(g, 6, 16, 36, 5, C.green);
      R(g, 21, 14, 1, 7, C.forest); R(g, 27, 14, 1, 7, C.forest);
      R(g, 1, 4, 5, 17, C.forest); R(g, 1, 4, 5, 1, C.green); // armrests
      R(g, 42, 4, 5, 17, C.forest); R(g, 42, 4, 5, 1, C.green);
      R(g, 7, 9, 5, 5, C.pink); R(g, 7, 9, 5, 1, C.sand); // pillows
      R(g, 36, 9, 5, 5, C.gold); R(g, 36, 9, 5, 1, C.yellow);
    });
    const sofaFront = sprite(48, 7, (g) => {
      R(g, 0, 0, 48, 7, C.outline);
      R(g, 6, 0, 36, 5, C.forest); R(g, 6, 0, 36, 1, C.green); // seat front
      R(g, 1, 0, 5, 6, C.pine); R(g, 42, 0, 5, 6, C.pine); // armrest fronts
      R(g, 2, 6, 2, 1, C.mahogany); R(g, 44, 6, 2, 1, C.mahogany); // feet
    });
    FURN.push({ name: 'sofa', tiles: rect(2, 11, 3, 1), parts: [
      { y: 11 * T, draw: (g) => g.drawImage(sofaBack(), 32, 164) },
      { y: 11 * T + 11, draw: (g) => g.drawImage(sofaFront(), 32, 185) },
    ], shadow: (g) => shade(g, 33, 192, 47, 2) });

    furniture('lounge lamp', [[5, 11]], [{ y: 11 * T + 15, draw: (g) => floorLamp(g, 5 * T + 8, 11 * T) }]);
    armchair('arm0', 6, 12, C.red, C.wine, C.pink);
    const table = sprite(28, 14, (g) => {
      R(g, 0, 0, 28, 10, C.outline);
      R(g, 1, 1, 26, 6, C.wood); R(g, 1, 1, 26, 1, C.cream);
      R(g, 1, 7, 26, 2, C.brown);
      R(g, 1, 10, 2, 4, C.outline); R(g, 25, 10, 2, 4, C.outline);
      R(g, 4, 2, 7, 4, C.blue); R(g, 5, 3, 5, 1, C.white); // magazine
      R(g, 7, 1, 6, 3, C.red); R(g, 8, 2, 4, 1, C.pink);
      R(g, 17, 2, 3, 3, C.white); R(g, 17, 2, 3, 1, C.brown); // mug
      R(g, 22, 3, 3, 2, C.rust); P(g, 22, 1, C.green); P(g, 23, 0, C.lime); P(g, 24, 2, C.green); // succulent
    });
    furniture('coffee table', rect(3, 13, 2, 1), [{ y: 13 * T + 14, draw: (g) => g.drawImage(table(), 50, 13 * T + 1) }]);
    FURN[FURN.length - 1].shadow = (g) => shade(g, 51, 13 * T + 15, 27, 1);
    beanbag('bean0', 2, 14, C.gold, C.amber, C.yellow);
    beanbag('bean1', 5, 14, C.blue, C.deep, C.cyan);
    plant(1, 15, 'monstera');
  }

  function floorLamp(g, x, top) {
    oval(g, x, top + 14, 4, 1, C.outline);
    R(g, x, top - 4, 1, 18, C.steel); P(g, x, top - 4, C.silver);
    R(g, x - 4, top - 11, 9, 7, C.outline);
    R(g, x - 3, top - 10, 7, 5, C.cream); R(g, x - 3, top - 10, 7, 1, C.white); R(g, x + 2, top - 9, 1, 4, C.sand);
  }

  function armchair(seatId, c, r, col, dark, light) {
    const x = c * T, top = r * T;
    const back = sprite(16, 22, (g) => {
      R(g, 1, 0, 14, 22, C.outline);
      R(g, 2, 1, 12, 9, col); R(g, 2, 1, 12, 1, light); // backrest
      R(g, 4, 10, 8, 6, light); R(g, 4, 11, 8, 5, col); // seat cushion
      R(g, 0, 6, 4, 15, C.outline); R(g, 1, 7, 3, 13, dark); R(g, 1, 7, 3, 1, col); // armrests
      R(g, 12, 6, 4, 15, C.outline); R(g, 12, 7, 3, 13, dark); R(g, 12, 7, 3, 1, col);
    });
    const front = sprite(16, 7, (g) => {
      R(g, 0, 0, 16, 6, C.outline);
      R(g, 4, 0, 8, 5, dark); R(g, 4, 0, 8, 1, col);
      R(g, 1, 0, 3, 5, C.outline); R(g, 1, 0, 2, 5, dark);
      R(g, 13, 0, 2, 5, dark);
      R(g, 2, 6, 2, 1, C.mahogany); R(g, 12, 6, 2, 1, C.mahogany);
    });
    FURN.push({ name: 'armchair ' + seatId, tiles: [[c, r]], parts: [
      { y: top, draw: (g) => g.drawImage(back(), x, top - 8) },
      { y: top + 15, draw: (g) => g.drawImage(front(), x, top + 9) },
    ], shadow: (g) => shade(g, x + 1, top + 15, 15, 1) });
  }

  function beanbag(seatId, c, r, col, dark, light) {
    const x = c * T, top = r * T;
    const bag = sprite(16, 12, (g) => {
      R(g, 2, 0, 12, 12, C.outline); R(g, 0, 3, 16, 8, C.outline); R(g, 1, 2, 14, 1, C.outline);
      R(g, 3, 1, 10, 10, col); R(g, 1, 4, 14, 6, col);
      R(g, 4, 2, 4, 1, light); R(g, 2, 5, 2, 2, light);
      R(g, 2, 9, 12, 1, dark); R(g, 13, 5, 1, 4, dark);
      R(g, 6, 4, 4, 2, dark); // the dent where you sit
    });
    FURN.push({ name: 'beanbag ' + seatId, tiles: [[c, r]], parts: [
      { y: top + 2, draw: (g) => g.drawImage(bag(), x, top + 4) },
      { y: top + 15, draw: (g) => g.drawImage(bag(), 0, 6, 16, 6, x, top + 10, 16, 6) },
    ], shadow: (g) => softShadow(g, x + 8, top + 15, 7, 1) });
  }

  // ---------------------------------------------------------------- open space extras
  function makeOpenSpace() {
    furniture('coat rack', [[18, 2]], [{ y: 2 * T + 15, draw: (g) => {
      const x = 18 * T + 8;
      oval(g, x, 2 * T + 14, 4, 1, C.outline);
      R(g, x, 12, 1, 34, C.mahogany); P(g, x, 12, C.brown);
      R(g, x - 4, 14, 9, 1, C.mahogany); // hooks
      R(g, x - 6, 15, 5, 14, C.outline); R(g, x - 5, 16, 3, 12, C.blue); R(g, x - 5, 16, 1, 12, C.cyan); // a coat
      R(g, x + 2, 15, 3, 10, C.red); P(g, x + 3, 25, C.wine); // a scarf
      R(g, x - 3, 9, 7, 3, C.outline); R(g, x - 2, 9, 5, 2, C.brown); R(g, x - 3, 11, 7, 1, C.mahogany); // hat
    } }]);
    const printer = sprite(28, 22, (g) => {
      panel(g, 0, 4, 28, 18, C.silver, C.white, C.grey);
      R(g, 2, 0, 24, 5, C.outline); R(g, 3, 1, 22, 3, C.grey); R(g, 3, 1, 22, 1, C.silver); // scanner lid
      R(g, 3, 7, 10, 3, C.white); R(g, 3, 9, 10, 1, C.silver); // output tray with paper
      R(g, 16, 7, 9, 3, C.slate); P(g, 17, 8, C.lime); P(g, 19, 8, C.cyan); P(g, 21, 8, C.grey); // control panel
      R(g, 2, 13, 24, 1, C.grey); R(g, 2, 17, 24, 1, C.grey); // paper drawers
      R(g, 12, 15, 4, 1, C.steel); R(g, 12, 19, 4, 1, C.steel);
    });
    furniture('printer', rect(13, 15, 2, 1), [{ y: 15 * T + 15, draw: (g) => g.drawImage(printer(), 13 * T + 2, 15 * T - 6) }]);
    plant(20, 2, 'fig');
    plant(8, 15, 'snake');
    plant(20, 15, 'bush');
  }

  // ---------------------------------------------------------------- library
  function makeLibrary() {
    furniture('globe', [[23, 5]], [{ y: 5 * T + 15, draw: (g, now) => {
      const cx = 23 * T + 8, top = 5 * T;
      oval(g, cx, top + 14, 5, 1, C.outline); oval(g, cx, top + 13, 4, 1, C.mahogany); // base
      R(g, cx - 1, top - 1, 2, 14, C.outline); R(g, cx - 1, top - 1, 1, 14, C.brown); // pole, up into the sphere
      // meridian half-ring: from the pole, around the left of the sphere, to its top
      R(g, cx - 6, top + 1, 6, 1, C.gold);
      R(g, cx - 8, top - 11, 1, 11, C.amber); P(g, cx - 7, top, C.gold); P(g, cx - 7, top - 12, C.gold);
      R(g, cx - 6, top - 13, 6, 1, C.gold);
      oval(g, cx, top - 6, 6, 6, C.outline);
      oval(g, cx, top - 6, 5, 5, C.blue);
      const f = dyn.globe ? Math.floor(now / 160) % 12 : 4;
      for (const [lx, ly, lw, lh] of [[0, -3, 3, 3], [5, -4, 2, 4], [2, 1, 4, 2], [8, 2, 2, 2], [-3, -1, 2, 3]]) {
        for (let k = 0; k < lw; k++) {
          const px = ((lx + k + f) % 12) - 5;
          for (let yy = 0; yy < lh; yy++) {
            const dx = px, dy = ly + yy;
            if (dx * dx + dy * dy <= 22) P(g, cx + dx, top - 6 + dy, C.green);
          }
        }
      }
      R(g, cx + 2, top - 4, 2, 3, C.deep); P(g, cx + 4, top - 6, C.deep); // shade side
      P(g, cx - 3, top - 9, C.cyan); P(g, cx - 2, top - 10, C.cyan);
    } }]);
    FURN[FURN.length - 1].shadow = (g) => softShadow(g, 23 * T + 9, 5 * T + 15, 5, 1);
    furniture('side table', [[25, 5]], [{ y: 5 * T + 15, draw: (g) => {
      const cx = 25 * T + 8, top = 5 * T;
      oval(g, cx, top + 6, 6, 2, C.outline); oval(g, cx, top + 5, 5, 1, C.wood);
      R(g, cx - 1, top + 8, 2, 5, C.mahogany);
      oval(g, cx, top + 14, 3, 1, C.outline);
      R(g, cx - 4, top + 1, 6, 2, C.red); R(g, cx - 3, top - 1, 5, 2, C.deep); R(g, cx - 4, top + 1, 6, 1, C.pink); // books
      R(g, cx + 2, top + 1, 2, 3, C.white); // mug
    } }]);
    armchair('arm1', 26, 5, C.brown, C.mahogany, C.wood);
    furniture('library lamp', [[27, 5]], [{ y: 5 * T + 15, draw: (g) => floorLamp(g, 27 * T + 8, 5 * T) }]);
    plant(28, 7, 'bush');
  }

  // ---------------------------------------------------------------- meeting room
  function planterBox(g, x, y, w, rnd) {
    R(g, x, y + 7, w, 9, C.outline);
    R(g, x + 1, y + 8, w - 2, 7, C.brown); R(g, x + 1, y + 8, w - 2, 1, C.wood); R(g, x + 1, y + 14, w - 2, 1, C.mahogany);
    for (let k = 1; k < w - 1; k += 8) R(g, x + k, y + 9, 1, 5, C.mahogany);
    // foliage rising out of the box
    for (let k = 0; k < w; k += 3) {
      const h = 5 + Math.floor(rnd() * 7);
      const col = [C.green, C.lime, C.forest, C.green][Math.floor(rnd() * 4)];
      R(g, x + k, y + 8 - h, 3, h, col);
      P(g, x + k + 1, y + 8 - h, col === C.forest ? C.green : C.lime);
      if (rnd() < 0.18) P(g, x + k + 1, y + 9 - h, [C.pink, C.yellow, C.white][Math.floor(rnd() * 3)]); // flowers
    }
  }

  function makeMeeting() {
    // hedge of planters along the north side of the room
    const north = sprite(128, 28, (g) => planterBox(g, 0, 12, 128, DO.rng(77)));
    furniture('planters north', rect(21, 8, 8, 1), [{ y: 8 * T + 15, draw: (g) => g.drawImage(north(), 21 * T, 8 * T - 12) }]);
    // and along the west side, with a door at the top (rows 9-10): one hedge, sorted row by row
    const west = [];
    for (let r = 11; r <= 15; r++) {
      const piece = sprite(16, 28, (g) => planterBox(g, 0, 12, 16, DO.rng(90 + r)));
      west.push({ y: r * T + 15, draw: (g) => g.drawImage(piece(), 21 * T, r * T - 12) });
    }
    furniture('planters west', rect(21, 11, 1, 5), west);
    const table = sprite(64, 40, (g) => {
      R(g, 0, 0, 64, 39, C.outline);
      R(g, 1, 1, 62, 31, C.brown); R(g, 1, 1, 62, 1, C.wood);
      R(g, 3, 4, 58, 25, C.mahogany); R(g, 4, 5, 56, 23, C.brown);
      R(g, 6, 6, 20, 1, C.tan); // shine
      R(g, 1, 32, 62, 6, C.mahogany); R(g, 1, 32, 62, 1, C.brown);
      R(g, 9, 9, 8, 6, C.white); R(g, 10, 10, 6, 1, C.silver); R(g, 10, 12, 5, 1, C.silver); // notepad
      R(g, 46, 18, 9, 5, C.grey); R(g, 46, 18, 9, 1, C.silver); // closed laptop
      R(g, 29, 14, 7, 4, C.outline); R(g, 30, 15, 5, 2, C.black); P(g, 32, 15, C.lime); // conference phone
      R(g, 21, 21, 2, 4, C.cyan); P(g, 21, 21, C.white); R(g, 41, 7, 2, 4, C.cyan); P(g, 41, 7, C.white); // water glasses
    });
    const parts = [];
    for (const s of MEETING) {
      if (s.sit.view === 'front') parts.push({ y: s.sit.anchor - 6, draw: (g) => drawChairNorth(g, s.point.x, s.tile.r * T) });
      else parts.push({ y: s.tile.r * T + 13, draw: (g) => drawChairSouth(g, s.point.x, s.tile.r * T) });
    }
    parts.push({ y: 13 * T, draw: (g) => g.drawImage(table(), 368, 175) });
    furniture('meeting table', rect(23, 11, 4, 2), parts);
    FURN[FURN.length - 1].shadow = (g) => shade(g, 369, 214, 63, 2);
    const sideboard = sprite(64, 20, (g) => {
      panel(g, 0, 4, 64, 16, C.brown, C.wood, C.mahogany);
      for (let k = 0; k < 4; k++) { R(g, 2 + k * 15, 7, 14, 10, C.tan); R(g, 3 + k * 15, 8, 12, 8, C.brown); P(g, 13 + k * 15, 11, C.gold); }
      R(g, 5, 0, 3, 5, C.cyan); R(g, 5, 0, 3, 1, C.white); R(g, 10, 1, 3, 4, C.cyan); R(g, 10, 1, 3, 1, C.white); // bottles
      R(g, 16, 2, 2, 3, C.white); R(g, 19, 2, 2, 3, C.white); // cups
      R(g, 54, 1, 5, 4, C.rust); R(g, 54, -2, 1, 3, C.green); R(g, 55, -3, 2, 3, C.lime); // small plant
    });
    furniture('sideboard', rect(23, 15, 4, 1), [{ y: 15 * T + 15, draw: (g) => g.drawImage(sideboard(), 23 * T, 15 * T - 4) }]);
    plant(28, 9, 'fern');
    plant(28, 15, 'monstera');
  }

  // ---------------------------------------------------------------- plants
  function plant(c, r, kind) {
    const x = c * T, y = r * T;
    furniture('plant ' + kind, [[c, r]], [{ y: y + 15, draw: (g) => {
      R(g, x + 4, y + 9, 8, 7, C.outline); R(g, x + 5, y + 10, 6, 5, C.rust); R(g, x + 5, y + 10, 6, 1, C.amber); R(g, x + 9, y + 11, 1, 3, C.rust);
      if (kind === 'fig') {
        R(g, x + 7, y - 6, 2, 16, C.mahogany);
        for (const [dx, dy] of [[-1, -16], [3, -14], [-4, -11], [5, -9], [-2, -6], [2, -4], [-5, -3], [6, -12]]) {
          R(g, x + 6 + dx, y + dy, 4, 3, C.green); P(g, x + 6 + dx, y + dy, C.lime);
        }
      } else if (kind === 'snake') {
        for (const [dx, h] of [[5, 12], [7, 15], [9, 11], [6, 8], [10, 9]]) {
          R(g, x + dx, y + 9 - h, 2, h, C.green); P(g, x + dx, y + 9 - h, C.lime); P(g, x + dx + 1, y + 11 - h, C.gold);
        }
      } else if (kind === 'monstera') {
        R(g, x + 7, y - 2, 2, 12, C.forest);
        for (const [dx, dy, w, h] of [[0, -6, 6, 5], [8, -8, 6, 6], [2, 0, 5, 4], [9, -1, 6, 4], [4, -11, 6, 5]]) {
          R(g, x + dx, y + dy, w, h, C.green); R(g, x + dx, y + dy, w, 1, C.lime); P(g, x + dx + 2, y + dy + 2, C.forest);
        }
      } else if (kind === 'fern') {
        // arching fronds with little leaflets
        for (const [dir, len, lift] of [[-1, 7, 0.9], [1, 7, 0.9], [-0.6, 6, 1.5], [0.6, 6, 1.5], [-0.15, 6, 2.1], [0.2, 5, 2.2]]) {
          for (let k = 1; k <= len; k++) {
            const fx = Math.round(x + 8 + dir * k);
            const fy = Math.round(y + 9 - k * lift + k * k * 0.13);
            P(g, fx, fy, C.forest);
            P(g, fx, fy - 1, k % 2 ? C.lime : C.green);
            if (k > 1 && k < len) { P(g, fx - 1, fy - 1, C.green); P(g, fx + 1, fy - 2, C.lime); }
          }
        }
      } else { // bush
        oval(g, x + 8, y + 4, 7, 6, C.forest);
        oval(g, x + 7, y + 3, 6, 5, C.green);
        P(g, x + 5, y + 1, C.lime); P(g, x + 9, y, C.lime); P(g, x + 4, y + 5, C.lime); P(g, x + 11, y + 4, C.lime);
      }
    } }]);
    FURN[FURN.length - 1].shadow = (g) => softShadow(g, x + 8, y + 15, 5, 1);
  }

  for (const pod of PODS) makePod(pod);
  makeKitchen();
  makeLounge();
  makeOpenSpace();
  makeLibrary();
  makeMeeting();

  // ---------------------------------------------------------------- lights (night)
  function lights() {
    const L = [];
    for (const s of SEATS) if (dyn.seats[s.id]) L.push({ x: s.cx, y: s.side === 'n' ? s.pod.y + 18 : s.pod.y + 30, r: 18 });
    L.push(
      { x: 55, y: 22, r: 12 }, { x: 88, y: 24, r: 18 }, { x: 24, y: 76, r: 14 }, // coffee, under-cabinet, vending
      { x: 272, y: 20, r: 16 }, { x: 448, y: 26, r: 18 }, { x: 424, y: 26, r: 12 }, // elevator, racks, terminal
      { x: 25, y: 145, r: 16 }, { x: 88, y: 170, r: 26 }, { x: 440, y: 76, r: 26 }, // arcade, lounge lamp, library lamp
    );
    return L;
  }

  // ---------------------------------------------------------------- public
  let bg = null;
  let bgKey = '';
  function drawBackground(g, date) {
    const key = date.getHours() + ':' + date.getMinutes();
    if (!bg || key !== bgKey) { bg = renderBackground(date); bgKey = key; }
    g.drawImage(bg, 0, 0);
  }

  function sortables() {
    const out = [];
    for (const f of FURN) for (const p of f.parts) out.push(p);
    return out;
  }

  // Every seat and station must be reachable from the elevator (seats are blocked
  // tiles: one of their neighbours must be reachable).
  function validate() {
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
    const reach = (c, r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => seen[(r + dr) * COLS + (c + dc)] && walkable(c + dc, r + dr));
    const bad = [];
    for (const s of [...SEATS, ...LOUNGE, ...MEETING]) if (!reach(s.tile.c, s.tile.r)) bad.push(s.id);
    for (const [k, list] of Object.entries(STATIONS)) for (const s of list) if (!walkable(s.c, s.r) || !seen[s.r * COLS + s.c]) bad.push(k + '@' + s.c + ',' + s.r);
    return bad;
  }

  DO.office = {
    T, COLS, ROWS, W, MAP_H, PODS, SEATS, LOUNGE, MEETING, STATIONS, ELEVATOR, FURN,
    walkable, dyn, drawBackground, drawWallLayer, sortables, lights, skyPhase, validate,
  };
})(globalThis.DO = globalThis.DO || {});
