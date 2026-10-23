// Boot: pixel-perfect canvas scaling, main loop, input, live data vs demo.
(function (DO) {
  const W = 480, H = 270;
  const params = new URLSearchParams(location.search);
  const CAPTURE = params.get('capture') === '1';
  const HOUR = params.get('hour');
  const SEED = Number(params.get('seed')) || 0;
  const SCENARIO = params.get('scenario') || '';
  const MODE = params.get('mode') || 'normal';
  const api = window.duckApi || null;

  const screen = document.getElementById('screen');
  const out = screen.getContext('2d');
  const buf = document.createElement('canvas');
  buf.width = W;
  buf.height = H;
  const g = buf.getContext('2d');
  g.imageSmoothingEnabled = false;

  const view = { scale: 1, x: 0, y: 0, cw: 0, ch: 0 };
  let demo = params.get('demo') === '1';
  let live = null;
  let lastSim = 0;

  document.body.classList.add('mode-' + MODE);

  const bad = DO.office.validate();
  if (bad.length) console.warn('unreachable seats/stations:', bad);

  // ---------------------------------------------------------- scaling
  function layout(cw, ch) {
    view.cw = cw;
    view.ch = ch;
    screen.width = cw;
    screen.height = ch;
    const fit = Math.min(cw / W, ch / H);
    view.scale = fit >= 1 ? Math.floor(fit) : fit; // integer zoom keeps pixels crisp
    view.x = Math.floor((cw - W * view.scale) / 2);
    view.y = Math.floor((ch - H * view.scale) / 2);
  }
  const ro = new ResizeObserver((entries) => {
    const e = entries[0];
    const box = e.devicePixelContentBoxSize && e.devicePixelContentBoxSize[0];
    const cw = box ? box.inlineSize : Math.round(e.contentRect.width * devicePixelRatio);
    const ch = box ? box.blockSize : Math.round(e.contentRect.height * devicePixelRatio);
    layout(cw, ch);
  });
  ro.observe(screen, { box: 'device-pixel-content-box' });
  layout(Math.round(screen.clientWidth * devicePixelRatio) || W, Math.round(screen.clientHeight * devicePixelRatio) || H);

  // ---------------------------------------------------------- data
  function setDemo(on, now) {
    demo = on;
    DO.ui.demo = on;
    DO.world.reset();
    DO.ui.selectedId = null;
    if (on) { DO.sim.start(now, SEED, SCENARIO); feedSim(now); }
    else if (live) { DO.world.ingest(live); DO.ui.usage = live.usage || null; }
    else DO.ui.usage = null;
    DO.ui.toast(on ? 'Mode démo : faux canards' : 'Retour à tes vrais agents', now);
    if (api) api.demoChanged(on);
  }

  if (api) {
    api.onSnapshot((snap) => {
      if (snap.health && snap.health.warming) return;
      live = snap;
      DO.ui.live = true;
      if (!demo) { DO.world.ingest(snap); DO.ui.usage = snap.usage || null; }
    });
    api.onCommand((cmd) => {
      const now = Date.now();
      if (cmd.type === 'demo') setDemo(cmd.on, now);
      if (cmd.type === 'capture') capture(cmd.scale || 3, cmd.crop);
      if (cmd.type === 'toast') DO.ui.toast(cmd.text, now);
      if (cmd.type === 'select') {
        const d = [...DO.world.ducks.values()][cmd.index || 0];
        if (d) { DO.ui.selectedId = d.id; DO.ui.dialogT0 = now; }
      }
      if (cmd.type === 'bilan') DO.ui.bilan = true;
    });
  }

  // ---------------------------------------------------------- night
  const masks = new Map();
  function lightMask(r) {
    let c = masks.get(r);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = r * 2 + 1;
    const m = c.getContext('2d');
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.sqrt(x * x + y * y * 1.6) / r;
        if (d > 1) continue;
        const keep = d < 0.55 ? 1 : (1 - d) / 0.45;
        if (keep * 16 > bayer[((y + r) % 4) * 4 + ((x + r) % 4)]) m.fillRect(x + r, y + r, 1, 1);
      }
    }
    masks.set(r, c);
    return c;
  }
  const night = document.createElement('canvas');
  night.width = W;
  night.height = DO.office.MAP_H;
  const ng = night.getContext('2d');
  let nightKey = '';
  function drawNight(phase) {
    const alpha = { night: 0.45, dusk: 0.2, dawn: 0.18, day: 0 }[phase];
    if (!alpha) return;
    const lights = DO.office.lights();
    const key = phase + lights.map((l) => l.x + ',' + l.y).join(';');
    if (key !== nightKey) {
      nightKey = key;
      ng.globalCompositeOperation = 'source-over';
      ng.clearRect(0, 0, W, night.height);
      ng.fillStyle = `rgba(24, 20, 37, ${alpha})`;
      ng.fillRect(0, 0, W, night.height);
      ng.globalCompositeOperation = 'destination-out';
      for (const l of lights) ng.drawImage(lightMask(l.r), l.x - l.r, l.y - l.r);
      ng.globalCompositeOperation = 'source-over';
    }
    g.drawImage(night, 0, 0);
  }

  // ---------------------------------------------------------- frame
  function clock(now) {
    const d = new Date(now);
    if (HOUR !== null && HOUR !== '') d.setHours(Number(HOUR), 20);
    return d;
  }

  function feedSim(now) {
    const snap = DO.sim.snapshot(now);
    DO.world.ingest(snap);
    DO.ui.usage = snap.usage || null;
  }

  function render(now) {
    if (demo && now - lastSim > 400) { lastSim = now; feedSim(now); }
    DO.world.update(now);
    const date = clock(now);
    DO.office.drawBackground(g, date);
    DO.office.drawWallLayer(g, now, date);
    DO.world.draw(g, now);
    drawNight(DO.office.skyPhase(date));
    DO.ui.drawOverlays(g, now);
    DO.ui.drawNotices(g, now);
    DO.ui.drawHud(g, now, { date });
    DO.ui.drawDialog(g, now);
    DO.ui.drawBilan(g);

    out.imageSmoothingEnabled = false;
    out.fillStyle = '#181425';
    out.fillRect(0, 0, view.cw, view.ch);
    out.drawImage(buf, view.x, view.y, Math.round(W * view.scale), Math.round(H * view.scale));
  }

  // 20 fps while something moves, 8 fps when everybody is sitting still: plenty
  // for pixel art, and it keeps the CPU/GPU almost idle.
  let last = 0;
  function loop(t) {
    requestAnimationFrame(loop);
    if (t - last < (DO.world.busy() ? 48 : 120)) return;
    last = t;
    render(Date.now());
  }
  if (CAPTURE) setInterval(() => render(Date.now()), 33);
  else requestAnimationFrame(loop);

  // ---------------------------------------------------------- capture (screenshots for checks)
  function capture(k, crop) {
    render(Date.now());
    const [cx, cy, cw, ch] = crop || [0, 0, W, H];
    const c = document.createElement('canvas');
    c.width = cw * k;
    c.height = ch * k;
    const cg = c.getContext('2d');
    cg.imageSmoothingEnabled = false;
    cg.drawImage(buf, cx, cy, cw, ch, 0, 0, cw * k, ch * k);
    api.captureResult(c.toDataURL('image/png'));
  }

  // ---------------------------------------------------------- input
  function toWorld(ev) {
    const r = screen.getBoundingClientRect();
    const px = (ev.clientX - r.left) * devicePixelRatio;
    const py = (ev.clientY - r.top) * devicePixelRatio;
    return { x: (px - view.x) / view.scale, y: (py - view.y) / view.scale };
  }
  screen.addEventListener('mousemove', (ev) => {
    const p = toWorld(ev);
    screen.style.cursor = DO.ui.onMove(p.x, p.y) ? 'pointer' : 'default';
  });
  screen.addEventListener('mouseleave', () => { DO.ui.hoverId = null; });
  screen.addEventListener('click', (ev) => {
    const p = toWorld(ev);
    DO.ui.onClick(p.x, p.y, Date.now());
  });
  window.addEventListener('keydown', (ev) => {
    const now = Date.now();
    const k = ev.key.toLowerCase();
    if (k === 'd') setDemo(!demo, now);
    else if (k === 'm' && api) api.setMode(MODE === 'mini' ? 'normal' : 'mini');
    else if (k === 'h' || k === '?') DO.ui.help = !DO.ui.help;
    else if (k === 'c') { DO.ui.bilan = !DO.ui.bilan; DO.ui.selectedId = null; }
    else if (k === 'escape') { DO.ui.selectedId = null; DO.ui.help = false; DO.ui.bilan = false; }
  });

  // mini mode title bar
  const bar = document.getElementById('bar');
  if (bar) {
    document.getElementById('btn-normal').addEventListener('click', () => api && api.setMode('normal'));
    document.getElementById('btn-close').addEventListener('click', () => api && api.quit());
  }

  if (demo) setDemo(true, Date.now());
  if (api) api.ready();
})(globalThis.DO = globalThis.DO || {});
