// Office events: little scenes that happen now and then, unrelated to the real agents
// (a pigeon on a window sill, the robot vacuum, a pizza delivery...). One at a time, one
// every 30 s to 1 min, and deterministic (seeded random, frame clock) so tests can drive them. Extras (cat, robot, courier) walk with the ducks' path
// finder; idle ducks (done for 5 min or more) can be borrowed through `duck.event`.
(function (DO) {
  const O = DO.office, C = DO.C, S = DO.sprites, T = O.T;
  const MIN = 60000;
  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const P = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const nav = () => DO.world.nav;

  // ------------------------------------------------------------ tiny sprites (lazy canvases)
  // k outline, H head, G body, n neck shimmer, e eye, O orange, a amber stripes, p pink
  const GRIDS = {
    pigeon: ['..kk...', '.kHeO..', 'kGGnk..', 'kGGGk..', '.kpk...'],
    pigeon_peck: ['.......', '..kk...', 'kGGHk..', 'kGGGeO.', '.kpk...'],
    pigeon_fly: ['k...k..', 'kk.kk..', '.kGHeO.', '.kGGk..', '..kk...'],
    cat_a: ['......k..k', 'k.....kOOk', 'Ok....kOep', '.OkkkkOOOk', '.kOaOaOOk.', '.kOkkkkOk.', '.k.k..k.k.'],
    cat_b: ['......k..k', 'k.....kOOk', 'Ok....kOep', '.OkkkkOOOk', '.kOaOaOOk.', '.kOkkkkOk.', '..k.k.k.k.'],
    cat_sleep: ['...kkkk...', '..kOaOak..', '.kOOOOOOk.', 'kOaOOkOkOk', '.kkkkkkkk.'],
  };
  const MAP = { k: C.outline, H: C.slate, G: C.grey, n: C.green, e: C.black, O: C.orange, a: C.amber, p: C.pink };
  const imgs = new Map();
  function img(name, mirror) {
    const key = name + (mirror ? ':m' : '');
    let c = imgs.get(key);
    if (c) return c;
    const { w, h, data } = S.decode(GRIDS[name], MAP);
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const id = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4, d = (y * w + (mirror ? w - 1 - x : x)) * 4;
        for (let k = 0; k < 4; k++) id.data[d + k] = data[s + k];
      }
    }
    g.putImageData(id, 0, 0);
    imgs.set(key, c);
    return c;
  }

  // Draws inside the window panes only (between the curtains, behind the mullion and transom).
  function clipPanes(g, panes, fn) {
    g.save();
    g.beginPath();
    for (const p of panes) {
      g.rect(p.x0, p.y0, p.mid - p.x0, 12 - p.y0);
      g.rect(p.mid + 2, p.y0, p.x1 - p.mid - 2, 12 - p.y0);
      g.rect(p.x0, 13, p.mid - p.x0, p.y1 - 13);
      g.rect(p.mid + 2, 13, p.x1 - p.mid - 2, p.y1 - 13);
    }
    g.clip();
    fn();
    g.restore();
  }

  // ------------------------------------------------------------ state
  const DOCK = { c: 15, r: 15, x: 15 * T + 8, y: 15 * T + 12 };
  const st = { rng: Math.random, current: null, nextAt: 0, last: {}, lastNow: 0, robot: null, day: '' };
  const between = (a, b) => a + st.rng() * (b - a);
  const dayKey = (date) => date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();

  function npc(type, x, y, speed) {
    return { kind: 'npc', type, x, y, tile: nav().tileOf(x, y), path: [], speed: speed || 30, facing: 'down', mode: 'idle', alpha: 1 };
  }
  function walk(e, c, r) {
    nav().walkTo(e, { c, r }, nav().tileCenter({ c, r }), e.speed);
  }
  // true on the frame the extra arrives
  function stepNpc(e, dt) {
    if (e.mode !== 'walk') return false;
    if (!nav().step(e, dt)) return false;
    e.mode = 'idle';
    return true;
  }
  const parkedRobot = () => Object.assign(npc('robot', DOCK.x, DOCK.y, 22), { facing: 'left' });

  // ------------------------------------------------------------ borrowed ducks
  function borrow(ev, duck, station, opts) {
    duck.event = Object.assign({ station, pose: 'work', icon: null, until: Infinity }, opts);
    ev.ducks.push(duck);
  }
  function releaseAll(ev) {
    for (const d of ev.ducks) d.event = null;
    ev.ducks = [];
  }
  // borrowed ducks that went back to work (or left) are no longer part of the event
  function prune(ev) {
    ev.ducks = ev.ducks.filter((d) => {
      const ok = DO.world.ducks.get(d.id) === d && !d.leaving && d.agent.state === 'done';
      if (!ok) d.event = null;
      return ok;
    });
  }
  const arrived = (d, station) => d.mode === 'work' && d.target && d.target.kind === 'station' && d.target.station === station;
  function shuffled(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(st.rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ------------------------------------------------------------ the catalogue
  // name, weight (how often), cooldown, mini (allowed in the small window), calm (no need for
  // 20 fps), maxMs (safety net), when(ctx), start(ev, ctx), update(ev, ctx) -> true when over,
  // stop(ev, ctx), sortables(ev, now), drawWall(g, ev, now). The cooldown keeps an event from
  // coming back too soon (and the same one never plays twice in a row).
  const CATALOG = [];
  const def = (d) => CATALOG.push(Object.assign({ weight: 1, cooldown: 3 * MIN, mini: false, calm: false, maxMs: 3 * MIN }, d));

  // A pigeon lands outside a window, pecks, looks around and flies off.
  def({
    name: 'pigeon', weight: 3, cooldown: 1.5 * MIN, mini: true, maxMs: 30000,
    when: (c) => c.phase !== 'night' && O.dyn.weather !== 'storm',
    start(ev) {
      ev.pane = O.PANES[Math.floor(st.rng() * O.PANES.length)];
      ev.right = st.rng() < 0.5;
      ev.stay = between(7000, 11000);
    },
    update: (ev, c) => c.now - ev.t0 > ev.stay + 3200,
    drawWall(g, ev, now) {
      const p = ev.pane, t = now - ev.t0;
      const px = ev.right ? p.mid + 2 : p.x0 + 1, py = p.y1 - 5;
      let x = px, y = py, frame = 'pigeon', mirror = false;
      const flap = Math.floor(now / 90) % 2 ? 'pigeon_fly' : 'pigeon';
      if (t < 1500) { const k = t / 1500; x = px - 14 * (1 - k); y = py - 9 * (1 - k); frame = flap; }
      else if (t > ev.stay + 1500) { const k = (t - ev.stay - 1500) / 1700; x = px + 18 * k; y = py - 11 * k; frame = flap; }
      else {
        const s = t - 1500;
        frame = Math.floor(s / 600) % 5 === 2 ? 'pigeon_peck' : 'pigeon';
        mirror = Math.floor(s / 2600) % 2 === 1;
      }
      clipPanes(g, [p], () => g.drawImage(img(frame, mirror), Math.round(x), Math.round(y)));
    },
  });

  // Something crosses the sky behind every window: a plane with a banner, a hot-air balloon,
  // or a shooting star at night.
  def({
    name: 'sky', weight: 2, cooldown: 2 * MIN, mini: true, maxMs: 40000,
    when: () => O.dyn.weather === 'clear' || O.dyn.weather === 'cloudy',
    start(ev, c) {
      ev.kind = c.phase === 'night' ? 'star' : st.rng() < 0.6 ? 'plane' : 'balloon';
      ev.dur = { star: 1400, plane: 16000, balloon: 30000 }[ev.kind];
      ev.dir = st.rng() < 0.5 ? 1 : -1;
      ev.x0 = 60 + Math.floor(st.rng() * 360);
    },
    update: (ev, c) => c.now - ev.t0 > ev.dur,
    drawWall(g, ev, now) {
      const k = Math.min(1, (now - ev.t0) / ev.dur);
      clipPanes(g, O.PANES, () => {
        if (ev.kind === 'star') {
          const x = Math.round(ev.x0 - k * 60 * ev.dir), y = Math.round(5 + k * 14);
          for (let i = 0; i < 6; i++) P(g, x + i * ev.dir, y - Math.round(i / 2), i === 0 ? C.white : i < 3 ? C.yellow : C.silver);
          return;
        }
        const x = Math.round(ev.dir > 0 ? -50 + k * (O.W + 100) : O.W + 50 - k * (O.W + 100));
        if (ev.kind === 'plane') {
          const b = -ev.dir; // the banner trails behind
          R(g, x - 3, 8, 8, 2, C.white); R(g, x - 3, 9, 8, 1, C.silver); // fuselage
          R(g, x + (ev.dir > 0 ? -3 : 3), 6, 2, 2, C.red); // tail fin
          R(g, x - 1, 10, 3, 1, C.grey); // wing
          P(g, x + (ev.dir > 0 ? 4 : -4), 8, C.deep); // cockpit
          for (let i = 6; i < 10; i++) P(g, x + b * i, 8, C.grey); // tow rope
          const bx = b > 0 ? x + 10 : x - 10 - 19;
          R(g, bx, 6, 19, 7, C.red); R(g, bx + 1, 7, 17, 5, C.white);
          DO.font.draw(g, 'COIN', bx + 2, 7, C.red);
        } else {
          const y = 7 + Math.round(Math.sin(now / 900));
          R(g, x - 3, y, 7, 6, C.outline);
          R(g, x - 2, y, 5, 6, C.red); R(g, x - 1, y, 1, 6, C.yellow); R(g, x + 1, y, 1, 6, C.yellow);
          R(g, x - 2, y - 1, 5, 1, C.outline); R(g, x - 1, y + 6, 3, 1, C.outline);
          P(g, x - 1, y + 7, C.mahogany); P(g, x + 1, y + 7, C.mahogany);
          R(g, x - 1, y + 8, 3, 2, C.brown); // basket
        }
      });
    },
  });

  // At night, the power flickers and goes out for two seconds ("BZZT" over the racks).
  def({
    name: 'blackout', weight: 1, cooldown: 20 * MIN, mini: true, maxMs: 10000,
    when: (c) => c.phase === 'night' && c.ducks > 0,
    start() {},
    update(ev, c) {
      const t = c.now - ev.t0;
      O.dyn.blackout = t < 1200 ? Math.floor(t / 110) % 3 !== 0 : t < 3400 ? true : t < 4000 ? Math.floor(t / 90) % 2 === 0 : false;
      return t >= 4000;
    },
    stop() { O.dyn.blackout = false; },
    drawWall(g, ev, now) {
      if (now - ev.t0 < 1300) DO.font.outlined(g, 'BZZT', 434, 2, C.yellow, C.black);
    },
  });

  // The coffee machine breaks down: smoke, a red light; a duck on a break comes to fix it,
  // and in the meantime long commands send the ducks to the water cooler instead.
  def({
    name: 'coffee', weight: 2, cooldown: 15 * MIN, mini: true, calm: true, maxMs: 2 * MIN,
    when: (c) => c.hour >= 7 && c.hour < 20,
    start(ev, c) {
      O.dyn.coffeeBroken = true;
      ev.fixAt = 70000;
      const d = shuffled(c.idle)[0];
      if (d) borrow(ev, d, 'coffee', { icon: 'gear' });
    },
    update(ev, c) {
      const t = c.now - ev.t0;
      if (t < 20000 && Math.random() < c.dt * 3) DO.world.burst(54 + Math.random() * 4, 12, 'smoke');
      if (!ev.fixing && ev.ducks.some((d) => arrived(d, 'coffee'))) { ev.fixing = true; ev.fixAt = Math.min(ev.fixAt, t + 12000); }
      return t > ev.fixAt;
    },
    stop() { O.dyn.coffeeBroken = false; },
  });

  // Paper jam: red lights, sheets flying out, and a duck on a break comes to sort it out.
  def({
    name: 'printer', weight: 2, cooldown: 10 * MIN, mini: true, calm: true, maxMs: 90000,
    when: () => true,
    start(ev, c) {
      O.dyn.printerJam = true;
      ev.fixAt = 35000;
      const d = shuffled(c.idle)[0];
      if (d) borrow(ev, d, 'printer', { icon: 'gear' });
    },
    update(ev, c) {
      const t = c.now - ev.t0;
      if (Math.random() < c.dt * (t < 3000 ? 6 : 0.8)) DO.world.burst(214 + Math.random() * 8, 240, 'paper');
      if (!ev.fixing && ev.ducks.some((d) => arrived(d, 'printer'))) { ev.fixing = true; ev.fixAt = Math.min(ev.fixAt, t + 9000); }
      return t > ev.fixAt;
    },
    stop() { O.dyn.printerJam = false; },
  });

  // The robot vacuum leaves its dock, cleans a few spots of the open space and goes back.
  def({
    name: 'robot', weight: 2, cooldown: 4 * MIN, maxMs: 3 * MIN,
    when: (c) => c.ducks <= 5 || c.hour >= 18 || c.hour < 8,
    start(ev) {
      const r = st.robot;
      ev.stops = [];
      for (let tries = 0; tries < 60 && ev.stops.length < 6; tries++) {
        const t = { c: 1 + Math.floor(st.rng() * 20), r: 3 + Math.floor(st.rng() * 13) };
        if (O.walkable(t.c, t.r) && nav().findPath(r.tile, t)) ev.stops.push(t);
      }
      ev.i = -1;
      ev.pause = 0;
    },
    update(ev, c) {
      const r = st.robot;
      if (r.mode === 'walk') {
        if (stepNpc(r, c.dt)) ev.pause = c.now + 700; // bumps, turns around
        return false;
      }
      r.spinning = c.now < ev.pause;
      if (r.spinning) return false;
      if (ev.home) return true;
      ev.i++;
      if (ev.i >= ev.stops.length) { ev.home = true; walk(r, DOCK.c, DOCK.r); r.path.push({ x: DOCK.x, y: DOCK.y }); }
      else walk(r, ev.stops[ev.i].c, ev.stops[ev.i].r);
      return false;
    },
    stop() {
      const r = st.robot;
      Object.assign(r, { x: DOCK.x, y: DOCK.y, tile: { c: DOCK.c, r: DOCK.r }, path: [], mode: 'idle', spinning: false, facing: 'left' });
    },
  });

  // Two ducks on a break play a game at the arcade cabinet; the winner gets confetti.
  def({
    name: 'arcade', weight: 3, cooldown: 4 * MIN, maxMs: 90000,
    when: (c) => c.idle.length >= 2,
    start(ev, c) {
      for (const d of shuffled(c.idle).slice(0, 2)) borrow(ev, d, 'arcade');
    },
    update(ev, c) {
      if (!ev.ducks.length) return true;
      const playing = ev.ducks.filter((d) => arrived(d, 'arcade'));
      O.dyn.arcadeFrenzy = playing.length > 0;
      if (!ev.since && playing.length && playing.length >= ev.ducks.length) ev.since = c.now;
      if (ev.since && c.now - ev.since > 22000) {
        const winner = ev.ducks[Math.floor(st.rng() * ev.ducks.length)];
        winner.action = { name: 'cheer', until: c.now + 1500 };
        DO.world.burst(winner.x, winner.y - 20, 'confetti');
        return true;
      }
      return false;
    },
    stop() { O.dyn.arcadeFrenzy = false; },
  });

  // The office cat comes out of the elevator, naps on the lounge rug, then leaves.
  const RUG = { c: 4, r: 12 };
  def({
    name: 'cat', weight: 2, cooldown: 5 * MIN, maxMs: 150000,
    when: () => true,
    start(ev, c) {
      ev.cat = npc('cat', O.ELEVATOR.x, O.ELEVATOR.y, 28);
      ev.cat.alpha = 0;
      ev.phase = 'enter';
      ev.pt = c.now;
      ev.door = true;
      ev.nap = between(18000, 26000);
    },
    update(ev, c) {
      const cat = ev.cat, t = c.now - ev.pt;
      const next = (phase) => { ev.phase = phase; ev.pt = c.now; };
      if (ev.phase === 'enter') {
        cat.alpha = Math.min(1, t / 600);
        if (t > 700) { ev.door = false; walk(cat, RUG.c, RUG.r); next('go'); }
      } else if (ev.phase === 'go') {
        if (stepNpc(cat, c.dt)) next('nap');
      } else if (ev.phase === 'nap') {
        if (Math.random() < c.dt * 0.6) DO.world.burst(cat.x + 3, cat.y - 9, 'zz');
        if (t > ev.nap) { walk(cat, O.ELEVATOR.c, O.ELEVATOR.r); next('leave'); }
      } else if (ev.phase === 'leave') {
        if (cat.path.length <= 3) ev.door = true;
        if (stepNpc(cat, c.dt)) next('exit');
      } else {
        cat.alpha = Math.max(0, 1 - t / 600);
        if (t > 650) return true;
      }
      return false;
    },
    sortables: (ev, now) => [{ y: ev.cat.y, draw: (g) => drawCat(g, ev.cat, ev.phase === 'nap', now) }],
  });

  // Lunch (or dinner): a courier brings a pizza to the cafe table; ducks on a break help themselves.
  const DROP = { c: 5, r: 7 };
  def({
    name: 'pizza', weight: 2, cooldown: 60 * MIN, maxMs: 150000,
    when: (c) => ((c.hour >= 11.5 && c.hour < 14) || (c.hour >= 19 && c.hour < 21.5)) && c.idle.length >= 1,
    start(ev, c) {
      ev.courier = npc('courier', O.ELEVATOR.x, O.ELEVATOR.y, 40);
      ev.courier.alpha = 0;
      ev.phase = 'enter';
      ev.pt = c.now;
      ev.door = true;
    },
    update(ev, c) {
      const e = ev.courier, t = c.now - ev.pt;
      const next = (phase) => { ev.phase = phase; ev.pt = c.now; };
      if (ev.phase === 'enter') {
        e.alpha = Math.min(1, t / 600);
        if (t > 700) { ev.door = false; walk(e, DROP.c, DROP.r); next('go'); }
      } else if (ev.phase === 'go') {
        if (stepNpc(e, c.dt)) { e.facing = 'up'; next('drop'); }
      } else if (ev.phase === 'drop') {
        if (t > 1200) {
          O.dyn.pizza = true;
          ev.servedAt = c.now;
          for (const d of shuffled(c.idle).slice(0, 2)) borrow(ev, d, 'cafe', { icon: 'heart' });
          walk(e, O.ELEVATOR.c, O.ELEVATOR.r);
          next('leave');
        }
      } else if (ev.phase === 'leave') {
        if (e.path.length <= 3) ev.door = true;
        if (stepNpc(e, c.dt)) next('exit');
      } else if (ev.phase === 'exit') {
        e.alpha = Math.max(0, 1 - t / 600);
        if (t > 650) { ev.door = false; next('gone'); }
      }
      if (ev.servedAt) {
        const eating = ev.ducks.filter((d) => arrived(d, 'cafe')).length;
        if (eating) O.dyn.pizza = Math.min(4, 1 + Math.floor((c.now - ev.servedAt) / 6000));
        return ev.phase === 'gone' && c.now - ev.servedAt > 26000;
      }
      return false;
    },
    stop() { O.dyn.pizza = false; },
    sortables: (ev, now) => (ev.phase === 'gone' ? [] : [{ y: ev.courier.y, draw: (g) => drawCourier(g, ev.courier, !ev.servedAt, now) }]),
  });

  // Somebody's birthday: a cake on the meeting table, the ducks on a break gather around it.
  def({
    name: 'birthday', weight: 1, cooldown: 4 * 60 * MIN, maxMs: 80000,
    when: (c) => c.idle.length >= 2 && !O.dyn.meeting && c.hour >= 10 && c.hour < 18,
    start(ev, c) {
      O.dyn.cake = true;
      for (const d of shuffled(c.idle).slice(0, 4)) borrow(ev, d, 'meeting', { icon: 'heart' });
      DO.world.burst(400, 178, 'confetti');
    },
    update(ev, c) {
      if (O.dyn.meeting) return true; // the room is needed for a briefing
      const t = c.now - ev.t0;
      if (t > 28000 && !ev.cheered) {
        ev.cheered = true;
        DO.world.burst(400, 178, 'confetti');
        for (const d of ev.ducks) if (arrived(d, 'meeting')) d.action = { name: 'cheer', until: c.now + 1500 };
      }
      return t > 31000;
    },
    stop() { O.dyn.cake = false; },
  });

  // A duck on a break waters a plant, which blooms for the rest of the day.
  def({
    name: 'watering', weight: 2, cooldown: 5 * MIN, maxMs: 70000,
    when: (c) => c.idle.length >= 1 && c.hour >= 8 && c.hour < 19,
    start(ev, c) {
      const d = shuffled(c.idle)[0];
      if (d) borrow(ev, d, 'plants');
    },
    update(ev, c) {
      const d = ev.ducks[0];
      if (!d) return true;
      if (!arrived(d, 'plants')) return false;
      if (!ev.wateringAt) ev.wateringAt = c.now;
      if (c.now - ev.wateringAt < 6000) return false;
      O.dyn.flowers[d.target.spot.plant] = dayKey(c.date);
      return true;
    },
    sortables(ev, now) {
      const d = ev.ducks[0];
      if (!d || !ev.wateringAt || !arrived(d, 'plants')) return [];
      return [{ y: d.y + 0.5, draw: (g) => drawCan(g, d, now) }];
    },
  });

  // ------------------------------------------------------------ scheduler
  function context(now, opts, dt) {
    const date = (opts && opts.date) || new Date(now);
    const s = DO.world.summary(now);
    return {
      now, dt, date, hour: date.getHours() + date.getMinutes() / 60, phase: O.skyPhase(date),
      mini: !!(opts && opts.mini), demo: !!(opts && opts.demo),
      ducks: s.total, idle: DO.world.idleDucks(now),
    };
  }

  function start(d, ctx) {
    const ev = { def: d, name: d.name, t0: ctx.now, ducks: [] };
    st.current = ev;
    d.start(ev, ctx);
    return ev;
  }

  function finish(ev, ctx) {
    releaseAll(ev);
    if (ev.def.stop) ev.def.stop(ev, ctx);
    st.last[ev.name] = ctx.now;
    st.lastName = ev.name;
    st.current = null;
    st.nextAt = ctx.now + between(30000, 60000);
  }

  function startRandom(ctx) {
    const ok = CATALOG.filter((d) => d.name !== st.lastName && (!ctx.mini || d.mini) && ctx.now - (st.last[d.name] ?? -Infinity) >= d.cooldown && d.when(ctx));
    if (!ok.length) { st.nextAt = ctx.now + 15000; return; }
    let r = st.rng() * ok.reduce((n, d) => n + d.weight, 0);
    for (const d of ok) {
      r -= d.weight;
      if (r <= 0) return start(d, ctx);
    }
    start(ok[ok.length - 1], ctx);
  }

  function update(now, opts) {
    const dt = st.lastNow ? Math.min(0.1, (now - st.lastNow) / 1000) : 0.016;
    st.lastNow = now;
    const ctx = context(now, opts, dt);
    const today = dayKey(ctx.date);
    if (today !== st.day) { // the flowers watered yesterday have faded
      st.day = today;
      for (const k of Object.keys(O.dyn.flowers)) if (O.dyn.flowers[k] !== today) delete O.dyn.flowers[k];
    }
    const ev = st.current;
    if (ev) {
      prune(ev);
      if (ev.def.update(ev, ctx) || now - ev.t0 > ev.def.maxMs) finish(ev, ctx);
    } else if (now >= st.nextAt) startRandom(ctx);
  }

  // Starts an event right now (screenshots: --event=name), whatever its conditions.
  function force(name, now, date) {
    const d = CATALOG.find((x) => x.name === name);
    if (!d) return false;
    const ctx = context(now, { date }, 0.016);
    if (st.current) finish(st.current, ctx);
    start(d, ctx);
    return true;
  }

  function reset(seed, now) {
    if (st.current) releaseAll(st.current);
    st.rng = DO.rng(seed >>> 0);
    st.current = null;
    st.last = {};
    st.lastName = null;
    st.lastNow = 0;
    st.nextAt = now + between(10000, 30000);
    st.robot = parkedRobot();
    Object.assign(O.dyn, { coffeeBroken: false, printerJam: false, arcadeFrenzy: false, blackout: false, pizza: false, cake: false });
  }

  // ------------------------------------------------------------ drawing
  function drawRobot(g, r, now) {
    const x = Math.round(r.x), y = Math.round(r.y);
    DO.world.footShadow(g, x, y + 1, 6);
    R(g, x - 5, y - 4, 11, 5, C.outline);
    R(g, x - 4, y - 5, 9, 1, C.outline);
    R(g, x - 4, y - 4, 9, 4, C.grey); R(g, x - 3, y - 4, 7, 1, C.silver); // body, shine
    R(g, x - 4, y - 1, 9, 1, C.steel); // bumper
    const moving = r.mode === 'walk';
    P(g, x + (r.facing === 'left' ? -2 : 2), y - 3, r.spinning ? C.red : moving ? (Math.floor(now / 200) % 2 ? C.cyan : C.deep) : C.lime);
    if (moving) P(g, x + (Math.floor(now / 80) % 2 ? -5 : 5), y, C.silver); // dust brush
  }

  function drawCat(g, cat, napping, now) {
    const x = Math.round(cat.x) - 5, y = Math.round(cat.y);
    g.globalAlpha = cat.alpha;
    DO.world.footShadow(g, cat.x, cat.y + 1, 5);
    if (napping) g.drawImage(img('cat_sleep', false), x, y - 5);
    else {
      const frame = cat.mode === 'walk' && Math.floor(now / 140) % 2 ? 'cat_b' : 'cat_a';
      if (cat.facing === 'left' || cat.facing === 'right') cat.side = cat.facing;
      g.drawImage(img(frame, cat.side === 'left'), x, y - 7);
    }
    g.globalAlpha = 1;
  }

  function drawCourier(g, e, carrying, now) {
    const tick = (fps) => Math.floor(now / (1000 / fps));
    let frame, mirror = false;
    if (e.mode === 'walk' && (e.facing === 'left' || e.facing === 'right')) { frame = ['side_1', 'side_2', 'side_3', 'side_4'][tick(8) % 4]; mirror = e.facing === 'left'; }
    else if (e.mode === 'walk') frame = (e.facing === 'up' ? 'back_walk_' : 'front_walk_') + (tick(6) % 2 ? 'a' : 'b');
    else frame = e.facing === 'up' ? 'back' : 'front_a';
    const x = Math.round(e.x) - 8, y = Math.round(e.y) - 15;
    g.globalAlpha = e.alpha;
    DO.world.footShadow(g, e.x, e.y, 5);
    g.drawImage(S.duck(frame, 3, mirror), x, y);
    const at = S.HAT_AT[frame] || [0, 0];
    g.drawImage(S.hat('cap', 0), x + (mirror ? -at[0] : at[0]), y + at[1] + S.HATS.cap.dy);
    if (carrying && e.facing !== 'up') { // the pizza box, held in front
      R(g, x + 2, y + 10, 12, 4, C.outline); R(g, x + 3, y + 10, 10, 3, C.sand); R(g, x + 3, y + 10, 10, 1, C.cream);
      P(g, x + 7, y + 11, C.red);
    }
    g.globalAlpha = 1;
  }

  // Watering can held towards the plant, with a few drops.
  function drawCan(g, d, now) {
    const face = d.target.spot.face;
    const x = Math.round(d.x) + (face === 'right' ? 6 : 4), y = Math.round(d.y) - (face === 'up' ? 12 : 8);
    R(g, x, y, 5, 4, C.outline); R(g, x + 1, y + 1, 3, 2, C.green); R(g, x + 1, y + 1, 3, 1, C.lime);
    R(g, x + 5, y, 2, 1, C.outline); P(g, x + 7, y - 1, C.outline); // spout
    const dx = face === 'right' ? 1 : 0, dy = face === 'up' ? -1 : 1;
    for (let k = 0; k < 3; k++) {
      const t = (Math.floor(now / 120) + k * 2) % 6;
      P(g, x + 7 + dx * t, y + (dy > 0 ? 1 + t : -2 - t), C.cyan);
    }
  }

  function sortables(now) {
    const out = [];
    const r = st.robot;
    if (r) out.push({ y: r.y, draw: (g) => drawRobot(g, r, now) });
    const ev = st.current;
    if (ev && ev.def.sortables) for (const it of ev.def.sortables(ev, now)) out.push(it);
    return out;
  }

  function drawWall(g, now) {
    const ev = st.current;
    if (ev && ev.def.drawWall) ev.def.drawWall(g, ev, now);
  }

  DO.events = {
    update, force, reset, sortables, drawWall,
    busy: () => !!(st.current && !st.current.def.calm),
    wantsDoor: () => !!(st.current && st.current.door),
    current: () => (st.current ? st.current.name : null),
    names: () => CATALOG.map((d) => d.name),
    robot: () => st.robot,
    npcs: () => {
      const ev = st.current;
      return [st.robot, ev && ev.cat, ev && ev.courier].filter(Boolean);
    },
  };
})(globalThis.DO = globalThis.DO || {});
