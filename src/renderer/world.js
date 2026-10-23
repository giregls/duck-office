// Ducks and ducklings: turns agent snapshots into behaviour (where to go,
// what to do there), moves them around the office and draws them.
(function (DO) {
  const O = DO.office, S = DO.sprites, C = DO.C;
  const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const MIN = 60000;
  const SPEED = { walk: 42, hurry: 72, duckling: 36 };
  const WORKING = new Set(['thinking', 'tool', 'compacting', 'supervising', 'error']);

  const ducks = new Map(); // agent id -> duck
  const ducklings = new Map(); // agent id -> duckling
  let particles = [];
  const seatOwner = new Map(); // seat id -> duck id (assigned seat)
  const loungeOwner = new Map(); // lounge seat id -> duck id (temporary)
  const spotOwner = new Map(); // 'station:index' -> duck id
  let firstSnapshot = true;
  let counter = 0;
  let NOW = Date.now(); // clock of the current frame (tests drive it)

  // ------------------------------------------------------------ persistence
  const STORE_KEY = 'duck-office:v1';
  const store = (() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return { seats: s.seats || {}, breeds: s.breeds || {}, hats: s.hats || {}, seen: s.seen || {} };
    } catch (_) {
      return { seats: {}, breeds: {}, hats: {}, seen: {} };
    }
  })();
  let saveDue = 0;
  function touch(key) { store.seen[key] = Date.now(); saveDue = saveDue || Date.now() + 2000; }
  function maybeSave(now) {
    if (!saveDue || now < saveDue) return;
    saveDue = 0;
    const cutoff = now - 7 * 24 * 3600 * 1000;
    for (const [k, t] of Object.entries(store.seen)) {
      if (t > cutoff) continue;
      delete store.seen[k]; delete store.seats[k]; delete store.hats[k]; delete store.breeds[k];
    }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) { /* private mode: fine */ }
  }

  function breedFor(projectKey) {
    if (store.breeds[projectKey] !== undefined) { touch(projectKey); return store.breeds[projectKey]; }
    const used = new Set([...ducks.values()].map((d) => d.breed));
    const n = DO.BREEDS.length;
    let b = DO.hash(projectKey) % n;
    for (let k = 0; k < n && used.has(b); k++) b = (b + 1) % n;
    store.breeds[projectKey] = b;
    touch(projectKey);
    return b;
  }

  function hatFor(duck) {
    if (store.hats[duck.id] !== undefined) return store.hats[duck.id];
    const taken = new Set([...ducks.values()].filter((d) => d !== duck && d.agent.projectKey === duck.agent.projectKey).map((d) => d.hat));
    let hat = null;
    for (const h of S.HAT_NAMES) if (!taken.has(h)) { hat = h; break; }
    store.hats[duck.id] = hat;
    return hat;
  }

  // ------------------------------------------------------------ path finding (BFS, tiny grid)
  function findPath(from, to) {
    const COLS = O.COLS;
    const start = from.r * COLS + from.c, goal = to.r * COLS + to.c;
    if (start === goal) return [];
    const prev = new Int32Array(COLS * O.ROWS).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      if (cur === goal) break;
      const c = cur % COLS, r = (cur / COLS) | 0;
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr;
        const ni = nr * COLS + nc;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= O.ROWS || prev[ni] !== -1) continue;
        if (!O.walkable(nc, nr) && ni !== goal) continue;
        prev[ni] = cur;
        q.push(ni);
      }
    }
    if (prev[goal] === -1) return null;
    const out = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) out.push({ c: cur % COLS, r: (cur / COLS) | 0 });
    return out.reverse();
  }

  const tileCenter = (t) => ({ x: t.c * O.T + 8, y: t.r * O.T + 13, tile: t });
  const tileOf = (x, y) => ({ c: Math.max(0, Math.min(O.COLS - 1, Math.floor(x / O.T))), r: Math.max(0, Math.min(O.ROWS - 1, Math.floor(y / O.T))) });

  function walkTo(e, tile, point, speed) {
    const from = e.path.length && e.path[0].tile ? e.path[0].tile : (e.tile || tileOf(e.x, e.y));
    const tiles = findPath(from, tile) || [];
    const pts = [];
    if (e.path.length && e.path[0].tile) pts.push(e.path[0]);
    for (const t of tiles) pts.push(tileCenter(t));
    if (point) pts.push({ x: point.x, y: point.y });
    e.path = pts;
    e.speed = speed;
    e.mode = 'walk';
  }

  function step(e, dt) {
    let left = e.speed * dt;
    while (left > 0 && e.path.length) {
      const wp = e.path[0];
      const dx = wp.x - e.x, dy = wp.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.01) {
        if (Math.abs(dx) > Math.abs(dy)) e.facing = dx > 0 ? 'right' : 'left';
        else e.facing = dy > 0 ? 'down' : 'up';
      }
      if (d <= left) {
        e.x = wp.x; e.y = wp.y; left -= d;
        if (wp.tile) e.tile = wp.tile;
        e.path.shift();
      } else {
        e.x += (dx / d) * left; e.y += (dy / d) * left;
        left = 0;
      }
    }
    return e.path.length === 0;
  }

  function startHop(e, to, then, dur) {
    e.hop = { fx: e.x, fy: e.y, tx: to.x, ty: to.y, t0: NOW, dur: dur || 380, then };
    e.mode = 'hop';
    if (Math.abs(to.x - e.x) > 2) e.facing = to.x > e.x ? 'right' : 'left';
  }

  // ------------------------------------------------------------ seats & spots
  const allSeats = () => [...O.SEATS, ...O.MEETING, ...O.LOUNGE];
  const seatById = (id) => allSeats().find((s) => s.id === id);

  function assignSeat(duck) {
    const take = (s) => { seatOwner.set(s.id, duck.id); store.seats[duck.id] = s.id; touch(duck.id); return s; };
    const saved = store.seats[duck.id] && seatById(store.seats[duck.id]);
    if (saved && !seatOwner.has(saved.id) && !loungeOwner.has(saved.id)) return take(saved);
    for (const d of ducks.values()) {
      if (d === duck || !d.seat || d.seat.kind !== 'desk' || d.agent.projectKey !== duck.agent.projectKey) continue;
      const free = O.SEATS.find((s) => s.pod === d.seat.pod && !seatOwner.has(s.id));
      if (free) return take(free);
    }
    for (const pod of O.PODS) {
      const seats = O.SEATS.filter((s) => s.pod === pod);
      if (seats.every((s) => !seatOwner.has(s.id))) return take(seats[0]);
    }
    const any = O.SEATS.find((s) => !seatOwner.has(s.id));
    if (any) return take(any);
    const over = [...O.MEETING, ...O.LOUNGE].find((s) => !seatOwner.has(s.id) && !loungeOwner.has(s.id));
    return over ? take(over) : null;
  }

  function reserveLounge(duck) {
    for (const [id, owner] of loungeOwner) if (owner === duck.id) return seatById(id);
    const free = O.LOUNGE.filter((s) => !seatOwner.has(s.id) && !loungeOwner.has(s.id));
    if (!free.length) return null;
    free.sort((a, b) => DO.hash(duck.id + a.id) - DO.hash(duck.id + b.id));
    loungeOwner.set(free[0].id, duck.id);
    return free[0];
  }

  function reserveSpot(duck, name) {
    const list = O.STATIONS[name] || [];
    for (let i = 0; i < list.length; i++) if (spotOwner.get(name + ':' + i) === duck.id) return list[i];
    for (let i = 0; i < list.length; i++) {
      if (!spotOwner.has(name + ':' + i)) { spotOwner.set(name + ':' + i, duck.id); return list[i]; }
    }
    return null;
  }

  function releaseTemp(duck, keep) {
    for (const [k, owner] of [...spotOwner]) if (owner === duck.id && k !== keep) spotOwner.delete(k);
    if (keep !== 'lounge') for (const [k, owner] of [...loungeOwner]) if (owner === duck.id) loungeOwner.delete(k);
  }

  // ------------------------------------------------------------ desire: agent state -> place, pose, icon
  function want(duck, now) {
    const a = duck.agent;
    const dur = now - (a.since || now);
    const t = a.tool;
    const tdur = t ? now - (t.since || now) : 0;
    const W = (kind, pose, icon, extra) => Object.assign({ kind, pose, icon }, extra);
    switch (a.state) {
      case 'permission': return W('desk', 'alert', 'excl', { urgent: true, blink: true });
      case 'input': return W('desk', 'ask', 'q', { urgent: true });
      case 'done':
        if (dur < 5 * MIN) return W('desk', 'calm', 'q', { urgent: true, soft: true });
        if (duck.wander && now < duck.wander.until) return W('station', 'look', 'q', { station: duck.wander.station, small: true });
        if (dur < 20 * MIN) return W('lounge', 'lounge', 'q', { small: true });
        return W('lounge', 'nap', 'zz', { small: true });
      case 'error': return W('seat', dur < 2500 ? 'panic' : 'think', 'cloud');
      case 'compacting': return W('station', 'work', 'squeeze', { station: 'printer' }); // tidying its memory: off to the printer
      case 'supervising': return W('seat', 'think', 'eye');
      case 'thinking': return W('seat', 'think', 'dots');
      case 'tool': {
        const cat = (t && t.cat) || 'other';
        if (cat === 'edit') return W('seat', 'type-fast', 'pencil');
        if (cat === 'read') return tdur > 5000 ? W('station', 'work', 'book', { station: 'shelves' }) : W('seat', 'read', 'book');
        if (cat === 'search') return tdur > 5000 ? W('station', 'work', 'magnifier', { station: 'filing' }) : W('seat', 'read', 'magnifier');
        if (cat === 'exec') {
          if (tdur > 45000) return W('station', 'sip', 'mug', { station: 'coffee' });
          if (tdur > 3000) return W('station', 'work', 'gear', { station: duck.hashv % 2 ? 'racks' : 'terminal' });
          return W('seat', 'type', 'gear');
        }
        if (cat === 'web') return W('station', 'spin', 'globe', { station: 'globe' });
        if (cat === 'agent') return W('station', 'brief', 'egg', { station: 'meeting' });
        if (cat === 'todo') return W('station', 'work', 'clipboard', { station: 'whiteboard' });
        if (cat === 'ask') return W('desk', 'ask', 'q', { urgent: true });
        return W('seat', 'type', 'plug');
      }
      default: return W('seat', 'think', 'dots');
    }
  }

  // The returned target keeps the desire's key even when it falls back (station
  // full, no lounge seat left...) so that decide() doesn't retry every frame.
  function resolveTarget(duck, w) {
    const key = w.key;
    const seat = duck.seat;
    let kind = w.kind;
    if (kind === 'station') {
      const s = reserveSpot(duck, w.station);
      if (s) return { key, kind: 'station', station: w.station, spot: s, tile: { c: s.c, r: s.r }, point: { x: s.x, y: s.y }, face: s.face, urgent: w.urgent };
      kind = 'seat';
    }
    if (kind === 'lounge') {
      const l = reserveLounge(duck);
      if (l) return { key, kind: 'lounge', lseat: l, tile: l.tile, point: l.point };
      kind = 'seat';
    }
    if (!seat) {
      const sp = reserveSpot(duck, 'window') || O.STATIONS.window[duck.hashv % O.STATIONS.window.length];
      return { key, kind: 'station', station: 'window', spot: sp, tile: { c: sp.c, r: sp.r }, point: { x: sp.x, y: sp.y }, face: 'up', urgent: w.urgent };
    }
    if (kind === 'desk') {
      if (seat.desk) return { key, kind: 'desk', seat, tile: seat.tile, point: seat.point, deskPoint: seat.desk, urgent: true };
      return { key, kind: 'standseat', seat, tile: seat.tile, point: seat.point, urgent: true };
    }
    return { key, kind: 'seat', seat, tile: seat.tile, point: seat.point };
  }

  function setTarget(duck, w, now, instant) {
    const target = resolveTarget(duck, w);
    releaseTemp(duck, target.kind === 'station' ? target.station + ':' + O.STATIONS[target.station].indexOf(target.spot) : target.kind === 'lounge' ? 'lounge' : null);
    duck.target = target;
    duck.arrivedAt = 0;
    if (instant) {
      duck.path = [];
      duck.tile = target.tile;
      if (target.kind === 'desk') { duck.x = target.deskPoint.x; duck.y = target.deskPoint.y; }
      else { duck.x = target.point.x; duck.y = target.point.y; }
      arrive(duck, now, true);
      return;
    }
    const speed = w.urgent || w.station === 'meeting' ? SPEED.hurry : SPEED.walk; // eager to brief its ducklings
    if (duck.mode === 'desk' && duck.seat) {
      // hop down from the desk first
      startHop(duck, duck.seat.point, () => { duck.tile = duck.seat.tile; walkTo(duck, target.tile, target.point, speed); });
      return;
    }
    walkTo(duck, target.tile, target.point, speed);
  }

  function arrive(duck, now, instant) {
    const t = duck.target;
    duck.arrivedAt = now;
    if (!t) { duck.mode = 'idle'; return; }
    if (t.kind === 'desk') {
      if (instant) { duck.mode = 'desk'; duck.facing = 'down'; return; }
      startHop(duck, t.deskPoint, () => { duck.mode = 'desk'; duck.facing = 'down'; duck.arrivedAt = NOW; });
      return;
    }
    if (t.kind === 'seat' || t.kind === 'lounge') { duck.mode = 'sit'; return; }
    if (t.kind === 'standseat') { duck.mode = 'idle'; duck.facing = 'down'; return; }
    if (t.kind === 'elevator') { duck.mode = 'exit'; duck.t0 = now; duck.facing = 'up'; return; }
    duck.mode = 'work';
    duck.facing = t.face || 'up';
  }

  function decide(duck, now) {
    if (duck.leaving || duck.mode === 'enter' || duck.mode === 'exit' || duck.mode === 'hop') return;
    const a = duck.agent;
    // lounging ducks sometimes go for a coffee or look out of the window
    if (a.state === 'done' && now - a.since >= 5 * MIN && now - a.since < 20 * MIN) {
      if (!duck.wander && now > (duck.nextWander || 0)) {
        const spots = ['coffee', 'cooler', 'window', 'window', 'arcade', 'vending'];
        duck.wander = { station: spots[Math.floor(Math.random() * spots.length)], until: now + 9000 + Math.random() * 7000 };
        duck.nextWander = now + 40000 + Math.random() * 50000;
      } else if (duck.wander && now > duck.wander.until) duck.wander = null;
    } else duck.wander = null;

    const w = want(duck, now);
    w.key = w.kind === 'station' ? 'station:' + w.station : w.kind;
    duck.w = w;
    if (w.key !== duck.wantKey) { duck.wantKey = w.key; duck.wantSince = now; }
    const cur = duck.target;
    if (cur && cur.key === w.key) return;
    const settled = now - duck.wantSince;
    const stayed = now - (duck.arrivedAt || now);
    let go;
    if (!cur || w.urgent || cur.urgent) go = true;
    else if (cur.kind === 'station' && duck.mode !== 'walk') go = stayed > 4000 && settled > (w.kind === 'seat' ? 2500 : 600);
    else go = settled > 300;
    if (go) setTarget(duck, w, now);
  }

  // ------------------------------------------------------------ snapshot ingestion
  function makeDuck(agent, now, catchUp) {
    const duck = {
      id: agent.id, kind: 'duck', agent, born: now, order: counter++, hashv: DO.hash(agent.id),
      x: O.ELEVATOR.x, y: O.ELEVATOR.y, tile: { c: O.ELEVATOR.c, r: O.ELEVATOR.r }, facing: 'down',
      mode: 'enter', t0: now, path: [], speed: SPEED.walk, target: null, wantKey: null, wantSince: now,
      iconName: null, iconSince: now, action: null,
    };
    ducks.set(duck.id, duck);
    duck.breed = breedFor(agent.projectKey || agent.project || agent.id);
    duck.hat = hatFor(duck);
    duck.seat = assignSeat(duck);
    touch(duck.id);
    if (catchUp) {
      const w = want(duck, now);
      w.key = w.kind === 'station' ? 'station:' + w.station : w.kind;
      duck.w = w; duck.wantKey = w.key;
      setTarget(duck, w, now, true);
    }
    return duck;
  }

  function makeDuckling(agent, now, catchUp) {
    const parent = ducks.get(agent.parentId);
    const siblings = [...ducklings.values()].filter((d) => d.parentId === agent.parentId && !d.leaving);
    const dl = {
      id: agent.id, kind: 'duckling', agent, parentId: agent.parentId, born: now, order: counter++, hashv: DO.hash(agent.id),
      x: O.ELEVATOR.x, y: O.ELEVATOR.y, tile: { c: O.ELEVATOR.c, r: O.ELEVATOR.r }, facing: 'down', mode: 'idle',
      path: [], speed: SPEED.duckling, slotKey: null, iconName: null, iconSince: now,
      breed: parent ? parent.breed : breedFor(agent.projectKey || agent.id),
    };
    ducklings.set(dl.id, dl);
    if (!parent) return dl;
    if (catchUp) {
      const slot = slotsFor(parent)[siblings.length % 12];
      if (slot) { dl.x = slot.x; dl.y = slot.y; dl.tile = tileOf(slot.x, slot.y); dl.slot = slot; dl.slotKey = parent.slotsKey; }
      return dl;
    }
    // A new subagent hatches from an egg. If its parent is on its way to the
    // meeting table to brief it, the egg waits to be laid on the table.
    const pa = parent.agent;
    const briefing = pa.state === 'tool' && pa.tool && pa.tool.cat === 'agent';
    dl.eggIndex = siblings.length;
    if (briefing && !atMeeting(parent)) { dl.mode = 'pending'; dl.t0 = now; return dl; }
    layEgg(dl, parent, now);
    return dl;
  }

  function atMeeting(duck) {
    const t = duck.target;
    return !!(t && t.kind === 'station' && t.station === 'meeting' && t.spot.eggs && duck.mode === 'work');
  }

  function layEgg(dl, parent, now) {
    const i = dl.eggIndex || 0;
    if (atMeeting(parent)) {
      const e = parent.target.spot.eggs;
      dl.x = e.x + e.dir * (i % 5) * 8; dl.y = e.y + Math.floor(i / 5) * 6; dl.onTable = true;
    } else {
      dl.x = parent.x + (i % 2 ? 11 : -11) + (i >> 1) * (i % 2 ? 4 : -4);
      dl.y = parent.y + 2;
    }
    dl.tile = tileOf(dl.x, dl.y);
    dl.mode = 'egg';
    dl.t0 = now + (i % 5) * 220;
  }

  function ingest(snap, at) {
    const now = at || Date.now();
    if (snap && snap.health && snap.health.warming) return; // the real first picture is coming
    const catchUp = firstSnapshot;
    firstSnapshot = false;
    const seen = new Set();
    const agents = (snap && snap.agents) || [];
    for (const a of agents.filter((x) => x.kind !== 'subagent')) {
      seen.add(a.id);
      let duck = ducks.get(a.id);
      if (!duck) duck = makeDuck(a, now, catchUp);
      const prev = duck.agent;
      duck.agent = a;
      duck.missingSince = 0;
      if (duck.leaving && duck.mode !== 'exit') { duck.leaving = false; duck.target = null; duck.wantKey = null; }
      if (prev !== a && WORKING.has(prev.state) && a.state === 'done') duck.action = { name: 'cheer', until: now + 1300 };
      if (prev !== a && prev.state !== 'permission' && a.state === 'permission') duck.alertAt = now;
    }
    for (const a of agents.filter((x) => x.kind === 'subagent')) {
      seen.add(a.id);
      let dl = ducklings.get(a.id);
      if (!dl) {
        if (a.state === 'finished') continue;
        dl = makeDuckling(a, now, catchUp);
      }
      dl.agent = a;
      if (a.state === 'finished' && !dl.leaving) dl.leaving = true;
    }
    for (const duck of ducks.values()) {
      if (seen.has(duck.id)) continue;
      if (!duck.missingSince) duck.missingSince = now;
    }
    for (const dl of ducklings.values()) if (!seen.has(dl.id)) dl.leaving = true;
  }

  // ------------------------------------------------------------ ducklings
  function slotsFor(parent) {
    const t = parent.target;
    const key = (t ? t.key + ':' + (t.spot ? t.spot.c + ',' + t.spot.r : '') + (t.lseat ? t.lseat.id : '') : 'none') + ':' + (parent.seat ? parent.seat.id : '') + ':' + parent.mode;
    if (parent.slotsCache && parent.slotsKey === key) return parent.slotsCache;
    const slots = [];
    if (t && t.kind === 'seat' && parent.seat && parent.seat.perches && parent.mode === 'sit') {
      for (const p of parent.seat.perches) slots.push({ x: p.x, y: p.y, desk: true, anchor: parent.seat.desk ? parent.seat.desk.anchor + 0.3 : p.y });
    }
    const start = t ? t.tile : tileOf(parent.x, parent.y);
    const seen = new Set([start.r * O.COLS + start.c]);
    const q = [start];
    const tiles = [];
    for (let h = 0; h < q.length && tiles.length < 8; h++) {
      const cur = q[h];
      for (const [dc, dr] of DIRS) {
        const n = { c: cur.c + dc, r: cur.r + dr };
        const k = n.r * O.COLS + n.c;
        if (seen.has(k) || !O.walkable(n.c, n.r)) continue;
        seen.add(k);
        q.push(n);
        tiles.push(n);
      }
    }
    for (const tl of tiles) {
      slots.push({ x: tl.c * O.T + 4, y: tl.r * O.T + 12, tile: tl });
      slots.push({ x: tl.c * O.T + 12, y: tl.r * O.T + 14, tile: tl });
    }
    parent.slotsCache = slots;
    parent.slotsKey = key;
    return slots;
  }

  function updateDuckling(dl, now, dt) {
    const parent = ducks.get(dl.parentId);
    if (dl.mode === 'pending') {
      if (dl.leaving) { dl.remove = true; return; }
      if (!parent || parent.leaving) { layEggNearElevator(dl, now); return; }
      if (atMeeting(parent) || now - dl.t0 > 16000) layEgg(dl, parent, now);
      return;
    }
    if (dl.mode === 'egg') {
      if (now - dl.t0 > 1100) { dl.mode = 'hatch'; dl.t0 = now; }
      return;
    }
    if (dl.mode === 'hatch') {
      if (now - dl.t0 > 350) {
        burst(dl.x, dl.y - 4, 'shell', dl.breed);
        dl.mode = 'idle';
        dl.popAt = now;
        if (dl.onTable && parent) {
          // jump down from the meeting table next to the parent
          const mine = [...ducklings.values()].filter((d) => d.parentId === dl.parentId && !d.leaving).sort((a, b) => a.order - b.order);
          const slots = slotsFor(parent);
          const slot = slots[Math.max(0, mine.indexOf(dl)) % Math.max(1, slots.length)];
          if (slot) {
            dl.slot = slot;
            dl.slotKey = parent.slotsKey;
            dl.hopAnchor = 13 * O.T + 1;
            startHop(dl, slot, () => { dl.onTable = false; dl.hopAnchor = 0; dl.tile = tileOf(dl.x, dl.y); }, 420);
          }
        }
      }
      return;
    }
    if (dl.mode === 'hop') {
      const h = dl.hop;
      const k = Math.min(1, (now - h.t0) / h.dur);
      dl.x = h.fx + (h.tx - h.fx) * k;
      dl.y = h.fy + (h.ty - h.fy) * k;
      if (k >= 1) { dl.mode = 'idle'; dl.hop = null; if (h.then) h.then(); }
      return;
    }
    if (dl.mode === 'report') {
      if (now - dl.t0 > 900) { burst(dl.x, dl.y - 5, 'poof', dl.breed); dl.remove = true; if (parent) burst(parent.x, parent.y - 20, 'heart'); }
      return;
    }
    if (dl.mode === 'exit') {
      if (now - dl.t0 > 700) dl.remove = true;
      return;
    }
    if (dl.mode === 'walk') {
      if (step(dl, dt)) {
        dl.mode = 'idle';
        if (dl.after) { const f = dl.after; dl.after = null; f(); }
      }
      return;
    }
    // idle: decide where to be
    if (dl.leaving) {
      if (dl.returning) return;
      dl.returning = true;
      if (parent && !parent.leaving && parent.mode !== 'exit') {
        const off = dl.hashv % 2 ? 9 : -9;
        const goal = { x: parent.x + off, y: parent.y + 1 };
        const done = () => { dl.mode = 'report'; dl.t0 = NOW; dl.facing = off > 0 ? 'left' : 'right'; };
        if (dl.slot && dl.slot.desk) {
          dl.hopAnchor = dl.slot.anchor; // stay in front of the desk while jumping off it
          startHop(dl, tileCenter(parent.seat ? parent.seat.tile : tileOf(parent.x, parent.y)), () => { dl.hopAnchor = 0; goTo(dl, goal, done); }, 300);
        } else goTo(dl, goal, done);
      } else {
        const done = () => { dl.mode = 'exit'; dl.t0 = NOW; };
        goTo(dl, { x: O.ELEVATOR.x + (dl.hashv % 2 ? -5 : 5), y: O.ELEVATOR.y }, done);
      }
      return;
    }
    if (!parent) return;
    if (now < (dl.moveAfter || 0)) return;
    const slots = slotsFor(parent);
    if (dl.slotKey === parent.slotsKey && dl.slot) return;
    const mine = [...ducklings.values()].filter((d) => d.parentId === dl.parentId && !d.leaving).sort((a, b) => a.order - b.order);
    const idx = mine.indexOf(dl);
    const slot = slots[Math.max(0, idx) % Math.max(1, slots.length)];
    if (!slot) return;
    if (dl.slotKey !== parent.slotsKey && dl.slotKey !== null && !dl.moveAfter) { dl.moveAfter = now + idx * 160; return; }
    dl.moveAfter = 0;
    dl.slotKey = parent.slotsKey;
    const old = dl.slot;
    const wasDesk = old && old.desk;
    dl.slot = slot;
    const go = () => {
      if (slot.desk) {
        const base = tileCenter(parent.seat.tile);
        goTo(dl, base, () => startHop(dl, slot, null, 320));
      } else goTo(dl, slot);
    };
    if (wasDesk && parent.seat) {
      dl.hopAnchor = old.anchor;
      startHop(dl, tileCenter(parent.seat.tile), () => { dl.hopAnchor = 0; go(); }, 300);
    } else go();
  }

  function layEggNearElevator(dl, now) {
    dl.x = O.ELEVATOR.x; dl.y = O.ELEVATOR.y + 4; dl.tile = tileOf(dl.x, dl.y);
    dl.mode = 'egg';
    dl.t0 = now;
  }

  function goTo(e, point, after) {
    const tile = point.tile || tileOf(point.x, point.y);
    walkTo(e, tile, point, e.kind === 'duckling' ? SPEED.duckling : SPEED.walk);
    e.after = after || null;
    if (!e.path.length) { e.mode = 'idle'; if (after) after(); }
  }

  // ------------------------------------------------------------ particles
  function burst(x, y, kind, breed) {
    const b = DO.BREEDS[(breed || 0) % DO.BREEDS.length];
    const add = (p) => particles.push(Object.assign({ t: 0 }, p));
    if (kind === 'poof') for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      add({ x, y, vx: Math.cos(a) * 18, vy: Math.sin(a) * 12 - 8, g: 10, life: 0.9, col: i % 3 ? C.white : b.body[1], size: 1 });
    }
    if (kind === 'shell') for (let i = 0; i < 6; i++) add({ x, y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 20, g: 90, life: 0.6, col: i % 2 ? C.white : C.silver, size: 1 });
    if (kind === 'confetti') for (let i = 0; i < 12; i++) add({ x, y, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 30, g: 70, life: 1.1, col: [C.red, C.yellow, C.cyan, C.lime, C.pink][i % 5], size: 1 });
    if (kind === 'spark') add({ x, y, vx: (Math.random() - 0.5) * 20, vy: -15 - Math.random() * 10, g: 40, life: 0.35, col: Math.random() < 0.5 ? C.yellow : C.cyan, size: 1, ambient: true });
    if (kind === 'heart') add({ x, y, vx: 0, vy: -10, g: 0, life: 1.1, icon: 'heart', col: C.hot });
    if (kind === 'zz') add({ x, y, vx: 4, vy: -6, g: 0, life: 1.8, text: 'z', col: C.white, ambient: true });
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.t += dt;
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    particles = particles.filter((p) => p.t < p.life);
  }

  // ------------------------------------------------------------ update
  let lastUpdate = 0;
  function update(now) {
    NOW = now;
    const dt = lastUpdate ? Math.min(0.1, (now - lastUpdate) / 1000) : 0.016;
    lastUpdate = now;
    for (const duck of [...ducks.values()]) {
      // gone from the snapshot for a while -> walk out through the elevator
      if (duck.missingSince && !duck.leaving && now - duck.missingSince > 3000) {
        duck.leaving = true;
        releaseTemp(duck, null);
        const e = O.STATIONS.elevator[duck.hashv % 2];
        duck.target = { key: 'elevator', kind: 'elevator', tile: { c: e.c, r: e.r }, point: { x: e.x, y: e.y } };
        // (the session may come back during the hop: then decide() picks a new target)
        if (duck.mode === 'desk' && duck.seat) startHop(duck, duck.seat.point, () => { duck.tile = duck.seat.tile; if (duck.leaving && duck.target) walkTo(duck, duck.target.tile, duck.target.point, SPEED.walk); });
        else walkTo(duck, duck.target.tile, duck.target.point, SPEED.walk);
      }
      if (duck.mode === 'enter') {
        if (now - duck.t0 > 900) { duck.mode = 'idle'; duck.target = null; }
        else continue;
      }
      if (duck.mode === 'exit') {
        if (now - duck.t0 > 900) {
          ducks.delete(duck.id);
          for (const [k, v] of [...seatOwner]) if (v === duck.id) seatOwner.delete(k);
          releaseTemp(duck, null);
        }
        continue;
      }
      if (duck.mode === 'hop') {
        const h = duck.hop;
        const k = Math.min(1, (now - h.t0) / h.dur);
        duck.x = h.fx + (h.tx - h.fx) * k;
        duck.y = h.fy + (h.ty - h.fy) * k;
        if (k >= 1) { duck.hop = null; duck.mode = 'idle'; if (h.then) h.then(); }
        continue;
      }
      if (duck.mode === 'walk' && step(duck, dt)) arrive(duck, now);
      decide(duck, now);
      // a few sparks fly from busy keyboards
      if (duck.mode === 'sit' && duck.w && duck.w.pose === 'type-fast' && Math.random() < dt * 3) burst(duck.x + (Math.random() - 0.5) * 10, duck.y - 4, 'spark');
      if (duck.mode === 'sit' && duck.w && duck.w.pose === 'nap' && Math.random() < dt * 0.5) burst(duck.x + 4, duck.y - 18, 'zz');
      if (duck.action && now > duck.action.until) duck.action = null;
    }
    for (const dl of [...ducklings.values()]) {
      updateDuckling(dl, now, dt);
      if (dl.remove) ducklings.delete(dl.id);
    }
    updateParticles(dt);
    updateOffice(now, dt);
    maybeSave(now);
  }

  let door = 0;
  function updateOffice(now, dt) {
    const dyn = O.dyn;
    dyn.seats = {};
    const podProjects = {};
    for (const duck of ducks.values()) {
      if (!duck.seat || duck.leaving) continue;
      const a = duck.agent;
      dyn.seats[duck.seat.id] = { state: a.state === 'done' && now - a.since > 5 * MIN ? 'done' : a.state, cat: a.tool && a.tool.cat };
      if (duck.seat.pod) {
        const p = (podProjects[duck.seat.pod.id] = podProjects[duck.seat.pod.id] || {});
        p[a.project] = (p[a.project] || 0) + 1;
      }
    }
    // nameplate = the island's main project; none for the home folder (no project there)
    dyn.podLabels = {};
    for (const [pod, counts] of Object.entries(podProjects)) {
      const best = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
      if (best === '~' || best === '?' || best === 'scratch') continue;
      const words = DO.font.norm(best).split(/[^A-Z0-9]+/).filter(Boolean); // "duck-office" -> DUCK
      let label = words[0] || '';
      if (label.length < 3 && words[1]) label += words[1];
      dyn.podLabels[pod] = label.slice(0, 6);
    }
    let openWanted = false, coffee = false, terminal = false, globe = false, racks = 0, wb = null;
    for (const duck of ducks.values()) {
      if (duck.mode === 'enter' || duck.mode === 'exit') openWanted = true;
      if (duck.leaving && duck.mode === 'walk' && duck.path.length <= 2) openWanted = true;
      const t = duck.target;
      if (duck.mode === 'work' && t && t.kind === 'station') {
        if (t.station === 'coffee') coffee = true;
        if (t.station === 'terminal') terminal = true;
        if (t.station === 'globe') globe = true;
        if (t.station === 'whiteboard' && duck.agent.todos) wb = duck.agent.todos;
      }
      if (duck.agent.tool && duck.agent.tool.cat === 'exec') racks++;
    }
    for (const dl of ducklings.values()) if (dl.mode === 'exit') openWanted = true;
    door = Math.max(0, Math.min(1, door + (openWanted ? 4 : -3) * dt));
    dyn.elevator = door;
    dyn.coffee = coffee || Math.floor(now / 9000) % 4 === 0;
    dyn.terminal = terminal;
    dyn.globe = globe;
    dyn.racks = racks;
    dyn.whiteboard = wb;
  }

  // ------------------------------------------------------------ drawing
  function blinkFrame(duck, now) {
    return (now + duck.hashv % 4000) % 4200 < 140;
  }

  function duckFrame(duck, now) {
    const w = duck.w || {};
    const tick = (fps) => Math.floor(now / (1000 / fps));
    let frame = 'front_a', mirror = false, x = duck.x - 8, y = duck.y - 15, dx = 0, dy = 0, anchor = duck.y, alpha = 1;
    const act = duck.action && (duck.mode === 'sit' || duck.mode === 'desk' || duck.mode === 'idle' || duck.mode === 'work') ? duck.action.name : null;
    if (duck.mode === 'walk' || duck.mode === 'hop') {
      if (duck.facing === 'left' || duck.facing === 'right') { frame = ['side_1', 'side_2', 'side_3', 'side_4'][tick(8) % 4]; mirror = duck.facing === 'left'; }
      else { const a = tick(6) % 2; frame = (duck.facing === 'up' ? 'back_walk_' : 'front_walk_') + (a ? 'a' : 'b'); dx = a ? 1 : -1; }
      if (duck.mode === 'hop') {
        const k = Math.min(1, (now - duck.hop.t0) / duck.hop.dur);
        dy = -Math.round(Math.sin(k * Math.PI) * 9);
        anchor = Math.max(duck.hop.fy, duck.hop.ty) + 0.5;
        if (duck.seat && duck.seat.desk) anchor = Math.max(anchor, duck.seat.desk.anchor);
      }
    } else if (duck.mode === 'sit') {
      const t = duck.target;
      const s = t && t.kind === 'lounge' ? t.lseat : duck.seat;
      if (s) { x = s.sit.x; y = s.sit.y; anchor = s.sit.anchor; }
      const view = s ? s.sit.view : 'front';
      const lounge = s && s.kind === 'lounge';
      let pose = w.pose;
      if (t && t.kind === 'seat' && w.kind !== 'seat') pose = 'type';
      if (lounge) {
        if (view === 'back') frame = 'sitb_idle';
        else if (pose === 'nap') frame = 'nap';
        else frame = blinkFrame(duck, now) ? 'front_blink' : 'front_b';
      } else if (view === 'front') {
        if (act === 'cheer') { frame = tick(8) % 2 ? 'sitf_think' : 'sitf_type_a'; dy = tick(8) % 2 ? -1 : 0; }
        else if (pose === 'type-fast') frame = tick(12) % 2 ? 'sitf_type_a' : 'sitf_type_b';
        else if (pose === 'type') frame = tick(7) % 2 ? 'sitf_type_a' : 'sitf_type_b';
        else if (pose === 'read') frame = tick(2) % 2 ? 'sitf_read_a' : 'sitf_read_b';
        else if (pose === 'panic') { frame = 'sitf_think'; dx = tick(14) % 2 ? 1 : -1; }
        else if (pose === 'nap') frame = 'sitf_nap';
        else frame = 'sitf_think';
      } else {
        if (pose === 'type-fast') frame = tick(12) % 2 ? 'sitb_type_a' : 'sitb_type_b';
        else if (pose === 'type') frame = tick(7) % 2 ? 'sitb_type_a' : 'sitb_type_b';
        else if (pose === 'panic') { frame = 'sitb_idle'; dx = tick(14) % 2 ? 1 : -1; }
        else { frame = 'sitb_idle'; dy = pose === 'read' && tick(1) % 2 ? 1 : 0; }
      }
    } else if (duck.mode === 'desk') {
      const p = duck.seat.desk;
      x = p.x - 8; y = p.y - 15; anchor = p.anchor;
      if (act === 'cheer') { frame = tick(8) % 2 ? 'cheer' : 'front_a'; dy = tick(8) % 2 ? -2 : 0; }
      else if (w.pose === 'alert') { const k = tick(4) % 2; frame = k ? 'raise' : 'front_a'; dy = k ? -2 : 0; }
      else if (w.pose === 'ask') { frame = tick(2) % 3 === 0 ? 'front_a' : 'raise'; }
      else { frame = blinkFrame(duck, now) ? 'front_blink' : tick(2) % 2 ? 'front_a' : 'front_b'; }
    } else if (duck.mode === 'work') {
      const f = duck.facing;
      if (w.pose === 'look' || w.pose === 'lounge' || w.pose === 'nap') {
        frame = f === 'up' ? 'back' : f === 'down' ? 'front_a' : 'side_1'; mirror = f === 'left';
        dy = tick(1) % 2 ? 1 : 0;
      } else if (f === 'left' || f === 'right') { frame = tick(4) % 2 ? 'side_1' : 'side_2'; mirror = f === 'left'; if (frame === 'side_2') dy = 1; }
      else if (f === 'up') {
        if (w.pose === 'sip') frame = 'back';
        else { frame = 'work_back'; mirror = tick(6) % 2 === 1; }
      } else frame = 'front_a';
    } else if (duck.mode === 'enter' || duck.mode === 'exit') {
      const k = Math.min(1, (now - duck.t0) / 900);
      if (duck.mode === 'enter') { alpha = Math.min(1, k * 2); frame = tick(4) % 2 ? 'raise' : 'front_a'; dy = Math.round((1 - k) * -3); }
      else { alpha = 1 - k; frame = 'back'; dy = -Math.round(k * 5); }
    } else {
      // idle, standing
      if (act === 'cheer') { frame = tick(8) % 2 ? 'cheer' : 'front_a'; dy = tick(8) % 2 ? -2 : 0; }
      else if (duck.facing === 'up') frame = 'back';
      else if (duck.facing === 'left' || duck.facing === 'right') { frame = 'side_1'; mirror = duck.facing === 'left'; }
      else if (w.pose === 'alert') { const k = tick(4) % 2; frame = k ? 'raise' : 'front_a'; dy = k ? -2 : 0; }
      else frame = blinkFrame(duck, now) ? 'front_blink' : tick(2) % 2 ? 'front_a' : 'front_b';
    }
    return { frame, mirror, x: Math.round(x + dx), y: Math.round(y + dy), anchor, alpha };
  }

  // A soft oval under the feet: grounds the ducks, and stays on the floor while they hop.
  const FOOT_SHADOW = 'rgba(24, 20, 37, 0.28)';
  function footShadow(g, x, y, rx) {
    g.fillStyle = FOOT_SHADOW;
    g.fillRect(Math.round(x) - rx + 1, Math.round(y), rx * 2 - 1, 1);
    g.fillRect(Math.round(x) - rx + 2, Math.round(y) + 1, rx * 2 - 3, 1);
  }

  function drawDuck(g, duck, now) {
    const f = duckFrame(duck, now);
    duck.rect = { x: f.x, y: f.y, w: 16, h: 16 };
    if (f.alpha < 1) g.globalAlpha = Math.max(0, f.alpha);
    if (duck.mode === 'desk' && duck.seat && duck.seat.desk) footShadow(g, duck.seat.desk.x, duck.seat.desk.y, 5);
    else if (duck.mode !== 'sit') footShadow(g, duck.x, duck.y, 5);
    g.drawImage(S.duck(f.frame, duck.breed, f.mirror), f.x, f.y);
    if (duck.hat) {
      const at = S.HAT_AT[f.frame] || [0, 0];
      const hatDx = f.mirror ? -at[0] : at[0];
      const spin = duck.hat === 'propeller' && duck.agent.state === 'thinking' ? Math.floor(now / 120) : 0;
      const img = S.hat(duck.hat, spin);
      if (img) g.drawImage(img, f.x + hatDx, f.y + at[1] + S.HATS[duck.hat].dy);
    }
    g.globalAlpha = 1;
    duck.head = { x: f.x + 8 + (f.frame.startsWith('side') ? (f.mirror ? -2 : 2) : 0), y: f.y + (S.HAT_AT[f.frame] || [0, 0])[1] + (duck.hat ? S.HATS[duck.hat].dy : 1) };
    duck.backSeat = f.frame.startsWith('sitb'); // its screen is right above its head
  }

  function drawDuckling(g, dl, now) {
    if (dl.mode === 'pending') { dl.rect = null; dl.head = null; return; }
    const tick = (fps) => Math.floor(now / (1000 / fps));
    let x = Math.round(dl.x) - 5, y = Math.round(dl.y) - 9;
    if (dl.mode === 'egg' || dl.mode === 'hatch') {
      const wob = dl.mode === 'hatch' || now - dl.t0 > 600 ? (tick(12) % 2 ? 1 : -1) : 0;
      const img = S.egg(dl.mode === 'hatch' ? 'crack' : 'whole', dl.breed);
      if (now >= dl.t0 - 50) g.drawImage(img, Math.round(dl.x) - 3 + wob, Math.round(dl.y) - 8);
      dl.rect = { x: Math.round(dl.x) - 3, y: Math.round(dl.y) - 8, w: 6, h: 8 };
      dl.head = { x: Math.round(dl.x), y: Math.round(dl.y) - 9 };
      return;
    }
    let frame = 'front', mirror = false, dy = 0;
    if (dl.mode === 'walk' || dl.mode === 'hop') {
      if (dl.facing === 'left' || dl.facing === 'right') { frame = tick(8) % 2 ? 'side' : 'side_hop'; mirror = dl.facing === 'left'; }
      else frame = dl.facing === 'up' ? 'back' : tick(8) % 2 ? 'front' : 'hop';
      dy = tick(8) % 2 ? -1 : 0;
      if (dl.mode === 'hop') {
        const k = Math.min(1, (now - dl.hop.t0) / dl.hop.dur);
        dy = -Math.round(Math.sin(k * Math.PI) * 7);
      }
    } else if (dl.mode === 'report') {
      frame = 'side'; mirror = dl.facing === 'left'; dy = tick(3) % 2 ? -1 : 0;
    } else if (dl.mode === 'exit') {
      g.globalAlpha = Math.max(0, 1 - (now - dl.t0) / 700);
      frame = 'back';
    } else {
      const busy = dl.agent && (dl.agent.state === 'tool' || dl.agent.state === 'thinking');
      if (busy) { frame = tick(dl.agent.state === 'tool' ? 4 : 2) % 2 ? 'front' : 'hop'; dy = frame === 'hop' ? -1 : 0; }
      else frame = 'front';
    }
    footShadow(g, dl.x, dl.y + 1, 3);
    g.drawImage(S.duckling(frame, dl.breed, mirror), x, y + dy);
    g.globalAlpha = 1;
    dl.rect = { x, y: y + dy, w: 10, h: 10 };
    dl.head = { x: x + 5, y: y + dy };
  }

  function anchorOf(e) {
    if (e.kind === 'duckling') {
      if (e.mode === 'egg' || e.mode === 'hatch') return e.onTable ? 13 * O.T + 1 : e.y;
      if (e.mode === 'hop' && e.hopAnchor) return e.hopAnchor;
      if (e.slot && e.slot.desk && e.mode === 'idle') return e.slot.anchor;
      if (e.mode === 'hop' && e.slot && e.slot.desk) return e.slot.anchor;
      return e.y;
    }
    return duckFrame(e, NOW).anchor;
  }

  function draw(g, now) {
    const list = O.sortables().slice();
    for (const duck of ducks.values()) list.push({ y: anchorOf(duck), draw: (gg) => drawDuck(gg, duck, now) });
    for (const dl of ducklings.values()) list.push({ y: anchorOf(dl), draw: (gg) => drawDuckling(gg, dl, now) });
    list.sort((a, b) => a.y - b.y);
    for (const it of list) it.draw(g, now);
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      g.globalAlpha = Math.max(0, Math.min(1, a * 1.5));
      if (p.icon) g.drawImage(S.icon(p.icon, p.col), Math.round(p.x) - 4, Math.round(p.y) - 4);
      else if (p.text) DO.font.draw(g, p.text, Math.round(p.x), Math.round(p.y), p.col);
      else { g.fillStyle = p.col; g.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size); }
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ queries for the UI
  function iconFor(e, now) {
    if (e.kind === 'duckling') {
      if (e.mode === 'egg' || e.mode === 'hatch' || e.mode === 'pending') return null;
      if (e.mode === 'report') return { name: 'scroll', ink: C.outline };
      if (e.leaving) return { name: 'check', ink: C.green };
      if (e.popAt && now - e.popAt < 900) return { name: 'excl', ink: C.red };
      const a = e.agent;
      if (!a) return null;
      if (a.state === 'tool' && a.tool) return { name: ICON_BY_CAT[a.tool.cat] || 'plug', ink: C.navy, small: true };
      if (a.state === 'permission') return { name: 'excl', ink: C.red, small: true };
      return { name: 'dots' + (1 + (Math.floor(now / 400) % 3)), ink: C.navy, small: true };
    }
    if (e.mode === 'enter' || e.leaving) return null;
    const w = e.w;
    if (!w) return null;
    let name = w.icon;
    if (name === 'dots') name = 'dots' + (1 + (Math.floor(now / 400) % 3));
    if (name === 'gear') name = Math.floor(now / 250) % 2 ? 'gear_a' : 'gear_b';
    const ink = w.blink ? (Math.floor(now / 250) % 2 ? C.hot : C.wine) : name === 'cloud' ? C.steel : name === 'q' && w.urgent && !w.soft ? C.deep : C.navy;
    return { name, ink, urgent: !!w.urgent, soft: !!w.soft, blink: !!w.blink, small: !!w.small };
  }
  const ICON_BY_CAT = { edit: 'pencil', read: 'book', search: 'magnifier', exec: 'gear_a', web: 'globe', agent: 'egg', todo: 'clipboard', mcp: 'plug', other: 'plug', ask: 'q' };

  function entities() {
    return [...ducks.values(), ...ducklings.values()];
  }

  function hitTest(x, y) {
    const list = entities().filter((e) => e.rect && x >= e.rect.x - 1 && x < e.rect.x + e.rect.w + 1 && y >= e.rect.y - 1 && y < e.rect.y + e.rect.h + 1);
    list.sort((a, b) => anchorOf(b) - anchorOf(a));
    return list[0] || null;
  }

  function summary(now) {
    let work = 0, wait = 0, done = 0, idle = 0;
    const waiting = [];
    for (const d of ducks.values()) {
      if (d.leaving) continue;
      const a = d.agent;
      if (a.state === 'permission' || a.state === 'input') { wait++; waiting.push(d); }
      else if (a.state === 'done') { if (now - a.since < 5 * MIN) { done++; waiting.push(d); } else idle++; }
      else work++;
    }
    waiting.sort((a, b) => {
      const ua = a.agent.state === 'done' ? 1 : 0, ub = b.agent.state === 'done' ? 1 : 0;
      return ua - ub || a.agent.since - b.agent.since;
    });
    const kids = [...ducklings.values()].filter((d) => !d.leaving).length;
    return { work, wait, done, idle, kids, waiting, total: ducks.size };
  }

  const MOVING = new Set(['walk', 'hop', 'enter', 'exit', 'egg', 'hatch', 'report']);
  function busy() {
    if (particles.some((p) => !p.ambient)) return true; // typing sparks and zZ don't need 30 fps
    for (const e of ducks.values()) if (MOVING.has(e.mode) || e.action) return true;
    for (const e of ducklings.values()) if (MOVING.has(e.mode)) return true;
    return false;
  }

  function reset() {
    ducks.clear(); ducklings.clear(); particles = [];
    seatOwner.clear(); loungeOwner.clear(); spotOwner.clear();
    firstSnapshot = true;
    lastUpdate = 0;
  }

  DO.world = { ingest, update, draw, hitTest, summary, iconFor, entities, reset, busy, get: (id) => ducks.get(id) || ducklings.get(id), ducks, ducklings, burst };
})(globalThis.DO = globalThis.DO || {});
