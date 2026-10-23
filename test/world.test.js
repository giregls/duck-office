// Behaviour of the ducks, driven by a fake clock (no window needed).
const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/tools.js');
require('../src/renderer/palette.js');
require('../src/renderer/font.js');
require('../src/renderer/sprites.js');
require('../src/renderer/office.js');
require('../src/renderer/world.js');
require('../src/renderer/sim.js');

const DO = globalThis.DO;
const W = DO.world;
const MIN = 60000;

let now = 1_800_000_000_000;

function session(id, state, extra) {
  return Object.assign({
    id: 's:' + id, parentId: null, kind: 'session', sessionId: id, project: 'proj', projectKey: 'c:/proj',
    title: 'titre', agentType: null, entrypoint: 'cli', state, since: now, tool: null, waitingFor: null,
    startedAt: now, lastActivity: now, todos: null,
  }, extra);
}
function subagent(sid, aid, state, extra) {
  return Object.assign(session(sid, state), { id: `a:${sid}:${aid}`, parentId: 's:' + sid, kind: 'subagent', agentType: 'Explore', title: 'Explorer' }, extra);
}
const tool = (name, cat) => ({ name, cat, label: '', since: now, count: 1 });
const snap = (...agents) => ({ now, live: true, agents, health: {} });

// Advance the fake clock, feeding the same snapshot every 500 ms like the tracker.
function run(ms, s) {
  const end = now + ms;
  let fed = 0;
  while (now < end) {
    now += 33;
    if (s && now - fed >= 500) { W.ingest(s, now); fed = now; }
    W.update(now);
  }
}

function fresh(...agents) {
  W.reset();
  W.ingest(snap(...agents), now);
  W.update(now);
}

test('catch-up puts already running agents straight at their desks', () => {
  fresh(session('a', 'tool', { tool: tool('Edit', 'edit') }));
  const d = W.get('s:a');
  assert.equal(d.mode, 'sit');
  assert.equal(d.target.kind, 'seat');
  assert.ok(d.seat && d.seat.kind === 'desk');
});

test('a new session arrives through the elevator, then sits down', () => {
  fresh();
  const s = snap(session('b', 'thinking'));
  W.ingest(s, now);
  W.update(now);
  assert.equal(W.get('s:b').mode, 'lift');
  assert.ok(W.get('s:b').inCabin);
  run(20000, s);
  const d = W.get('s:b');
  assert.equal(d.mode, 'sit');
  assert.equal(d.target.kind, 'seat');
});

test('a permission request makes the duck climb on its desk', () => {
  fresh(session('c', 'thinking'));
  run(3000, snap(session('c', 'permission', { since: now, tool: tool('Bash', 'exec'), waitingFor: 'permission prompt' })));
  const d = W.get('s:c');
  assert.equal(d.mode, 'desk');
  assert.equal(W.iconFor(d, now).name, 'excl');
  assert.equal(W.summary(now).wait, 1);
});

test('a web search sends the duck to the globe', () => {
  fresh(session('d', 'thinking'));
  run(15000, snap(session('d', 'tool', { since: now, tool: tool('WebFetch', 'web') })));
  const d = W.get('s:d');
  assert.equal(d.mode, 'work');
  assert.equal(d.target.station, 'globe');
});

test('a subagent hatches from an egg, then reports back and disappears', () => {
  fresh(session('e', 'thinking'));
  const parent = session('e', 'tool', { tool: tool('Agent', 'agent') });
  W.ingest(snap(parent, subagent('e', 'x1', 'thinking')), now);
  W.update(now);
  assert.ok(['pending', 'egg'].includes(W.get('a:e:x1').mode));
  run(15000, snap(parent, subagent('e', 'x1', 'tool', { tool: tool('Read', 'read') })));
  assert.ok(!['pending', 'egg', 'hatch'].includes(W.get('a:e:x1').mode));
  run(12000, snap(parent, subagent('e', 'x1', 'finished')));
  assert.equal(W.get('a:e:x1'), undefined);
});

test('eggs wait for the parent to reach the meeting table, then hatch on it', () => {
  fresh(session('m', 'thinking'));
  const parent = session('m', 'tool', { since: now, tool: tool('Agent', 'agent') });
  W.ingest(snap(parent, subagent('m', 'k1', 'thinking'), subagent('m', 'k2', 'thinking')), now);
  W.update(now);
  assert.equal(W.get('a:m:k1').mode, 'pending');
  let laid = null;
  const s = snap(parent, subagent('m', 'k1', 'thinking'), subagent('m', 'k2', 'thinking'));
  for (let i = 0; i < 600 && !laid; i++) {
    run(33, s);
    const k = W.get('a:m:k1');
    if (k.mode === 'egg') laid = { onTable: k.onTable, parentMode: W.get('s:m').mode, station: W.get('s:m').target.station };
  }
  assert.ok(laid, 'egg was laid');
  assert.equal(laid.station, 'meeting');
  assert.equal(laid.parentMode, 'work');
  assert.equal(laid.onTable, true);
  run(3000, s);
  assert.ok(['idle', 'walk', 'hop'].includes(W.get('a:m:k2').mode));
});

test('a session that disappears walks out through the elevator', () => {
  fresh(session('f', 'thinking'));
  run(30000, snap());
  assert.equal(W.get('s:f'), undefined);
});

test('a session that comes back while its duck jumps off the desk does not crash', () => {
  fresh(session('r', 'done', { since: now }));
  assert.equal(W.get('s:r').mode, 'desk');
  run(3200, snap()); // gone long enough: the duck starts leaving with a hop down
  assert.equal(W.get('s:r').mode, 'hop');
  run(100, snap(session('r', 'thinking'))); // back during the hop
  assert.doesNotThrow(() => run(6000, snap(session('r', 'thinking'))));
  assert.equal(W.get('s:r').mode, 'sit');
});

test('a "warming" snapshot does not use up the startup catch-up', () => {
  W.reset();
  W.ingest({ now, live: true, agents: [], health: { warming: true } }, now);
  W.ingest(snap(session('w', 'thinking')), now);
  W.update(now);
  assert.equal(W.get('s:w').mode, 'sit');
});

test('ducks waiting for a long time go to the lounge, then nap', () => {
  fresh(session('g', 'done', { since: now - 25 * MIN }));
  const d = W.get('s:g');
  assert.equal(d.target.kind, 'lounge');
  assert.equal(d.w.pose, 'nap');
});

test('walking ducks never cut through furniture or other ducks\' chairs', () => {
  const O = DO.office;
  W.reset();
  DO.sim.start(now, 3);
  W.ingest(DO.sim.snapshot(now), now);
  const own = new Map(); // duck id -> tiles it may legitimately walk on (its own seats)
  const mine = (d) => {
    let s = own.get(d.id);
    if (!s) own.set(d.id, (s = new Set()));
    if (d.seat) { s.add(d.seat.tile.c + ',' + d.seat.tile.r); s.add(d.seat.tile.c + 1 + ',' + d.seat.tile.r); }
    if (d.target && d.target.lseat) s.add(d.target.lseat.tile.c + ',' + d.target.lseat.tile.r);
    return s;
  };
  const bad = new Set();
  let fed = now;
  const end = now + 3 * 60000;
  while (now < end) {
    now += 33;
    if (now - fed >= 400) { W.ingest(DO.sim.snapshot(now), now); fed = now; }
    W.update(now);
    for (const d of W.ducks.values()) {
      const tiles = mine(d);
      if (d.mode !== 'walk') continue;
      const c = Math.floor(d.x / O.T), r = Math.floor(d.y / O.T);
      if (!O.walkable(c, r) && !tiles.has(c + ',' + r)) bad.add(`${d.id} at ${c},${r}`);
    }
  }
  assert.deepEqual([...bad], []);
});

test('sessions of the same project share a pod', () => {
  fresh(session('h1', 'thinking'), session('h2', 'thinking'), session('o', 'thinking', { project: 'other', projectKey: 'c:/other' }));
  const a = W.get('s:h1'), b = W.get('s:h2'), c = W.get('s:o');
  assert.equal(a.seat.pod, b.seat.pod);
  assert.notEqual(a.seat.pod, c.seat.pod);
  assert.equal(a.breed, b.breed);
  assert.notEqual(a.breed, c.breed);
  assert.notEqual(a.hat, b.hat);
});

test('a duck crouches on its way down to the chair, and again when it gets up', () => {
  fresh();
  const modes = new Set();
  const s = snap(session('k', 'thinking'));
  run(20000, s);
  assert.equal(W.get('s:k').mode, 'sit');
  const t = snap(session('k', 'tool', { since: now, tool: tool('WebFetch', 'web') }));
  const end = now + 4000;
  while (now < end) { run(33, t); modes.add(W.get('s:k').mode); }
  assert.ok(modes.has('rise'), [...modes].join(','));
  assert.ok(modes.has('walk'));
  fresh();
  const seen = new Set();
  W.ingest(s, now);
  for (let i = 0; i < 600; i++) { run(33, s); seen.add(W.get('s:k').mode); }
  assert.ok(seen.has('settle'), [...seen].join(','));
});

test('a granted permission: a happy nod on the desk, then back to work', () => {
  fresh(session('n', 'thinking'));
  run(3000, snap(session('n', 'permission', { since: now, tool: tool('Bash', 'exec'), waitingFor: 'permission prompt' })));
  const d = W.get('s:n');
  assert.equal(d.mode, 'desk');
  const back = snap(session('n', 'tool', { since: now, tool: tool('Bash', 'exec') }));
  run(400, back);
  assert.equal(d.mode, 'desk');
  assert.equal(d.action && d.action.name, 'thanks');
  assert.equal(W.iconFor(d, now).name, 'check');
  run(3000, back);
  assert.notEqual(d.mode, 'desk');
});

test('a finished todo list: confetti, a tick, and a green whiteboard', () => {
  fresh(session('t', 'tool', { tool: tool('TodoWrite', 'todo'), todos: { done: 2, total: 4 } }));
  run(600, snap(session('t', 'tool', { tool: tool('TodoWrite', 'todo'), todos: { done: 4, total: 4 } })));
  const d = W.get('s:t');
  assert.equal(W.iconFor(d, now).name, 'check');
  assert.ok(DO.office.dyn.whiteboardParty);
  assert.deepEqual(DO.office.dyn.whiteboard, { done: 4, total: 4 });
});

test('ducklings follow their mother in single file', () => {
  fresh(session('q', 'thinking'), subagent('q', 'd1', 'thinking'), subagent('q', 'd2', 'thinking'));
  const s = snap(session('q', 'tool', { since: now, tool: tool('WebFetch', 'web') }), subagent('q', 'd1', 'thinking'), subagent('q', 'd2', 'thinking'));
  let followed = 0, far = 0;
  const end = now + 20000;
  while (now < end) {
    run(33, s);
    const mum = W.get('s:q');
    for (const id of ['a:q:d1', 'a:q:d2']) {
      const k = W.get(id);
      if (k.mode !== 'follow') continue;
      followed++;
      if (Math.hypot(k.x - mum.x, k.y - mum.y) > 48) far++;
    }
  }
  assert.ok(followed > 20, `followed ${followed} frames`);
  assert.ok(far < followed / 4, `${far} of ${followed} frames far from the mother`);
  assert.equal(W.get('s:q').target.station, 'globe');
  for (const id of ['a:q:d1', 'a:q:d2']) assert.notEqual(W.get(id).mode, 'follow');
});

test('leaving by the elevator: wait for the door, step in, press the button, the door closes', () => {
  fresh(session('z', 'thinking'));
  const phases = [];
  let opened = 0;
  const end = now + 30000;
  while (now < end && W.get('s:z')) {
    run(33, snap());
    const d = W.get('s:z');
    if (d && d.mode === 'lift' && phases[phases.length - 1] !== d.lift.phase) phases.push(d.lift.phase);
    opened = Math.max(opened, DO.office.dyn.elevator);
  }
  assert.equal(W.get('s:z'), undefined);
  assert.deepEqual(phases, ['call', 'stepin', 'turn', 'press', 'close', 'ride']);
  assert.ok(opened > 0.95);
  run(2000, snap());
  assert.equal(DO.office.dyn.elevator, 0); // closed behind it
});

test('arriving by the elevator: the door opens on the cabin and the duck steps out', () => {
  fresh();
  const s = snap(session('y', 'thinking'));
  W.ingest(s, now);
  const phases = [];
  for (let i = 0; i < 200; i++) {
    run(33, s);
    const d = W.get('s:y');
    if (d.mode === 'lift' && phases[phases.length - 1] !== d.lift.phase) phases.push(d.lift.phase);
  }
  assert.deepEqual(phases, ['ding', 'open', 'stepout']);
  assert.ok(!W.get('s:y').inCabin);
  assert.notEqual(W.get('s:y').mode, 'lift');
});
