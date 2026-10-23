// Office events (pigeon, robot vacuum, pizza...), driven by a fake clock (no window needed).
const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/shared/tools.js');
require('../src/renderer/palette.js');
require('../src/renderer/font.js');
require('../src/renderer/sprites.js');
require('../src/renderer/office.js');
require('../src/renderer/world.js');
require('../src/renderer/events.js');

const DO = globalThis.DO;
const W = DO.world, E = DO.events, O = DO.office;
const MIN = 60000;

let now = 1_800_000_000_000;
const NOON = new Date(2026, 9, 23, 12, 30); // the events' clock: a Friday lunchtime

function session(id, state, extra) {
  return Object.assign({
    id: 's:' + id, parentId: null, kind: 'session', sessionId: id, project: 'proj', projectKey: 'c:/proj',
    title: 'titre', agentType: null, entrypoint: 'cli', state, since: now, tool: null, waitingFor: null,
    startedAt: now, lastActivity: now, todos: null,
  }, extra);
}
const snap = (...agents) => ({ now, live: true, agents, health: {} });
const idle = (id) => session(id, 'done', { since: now - 30 * MIN });

function run(ms, s, onFrame) {
  const end = now + ms;
  let fed = 0;
  while (now < end) {
    now += 33;
    if (s && now - fed >= 500) { W.ingest(s, now); fed = now; }
    E.update(now, { date: NOON });
    W.update(now);
    if (onFrame) onFrame();
  }
}

function fresh(seed, ...agents) {
  W.reset();
  E.reset(seed, now);
  W.ingest(snap(...agents), now);
  W.update(now);
}

test('every event can be forced, plays to its end and leaves the office clean', () => {
  for (const name of E.names()) {
    const s = snap(idle('a'), idle('b'), idle('c'), session('w', 'tool', { tool: { name: 'Edit', cat: 'edit', since: now } }));
    fresh(1, ...s.agents);
    assert.ok(E.force(name, now, NOON), name);
    let borrowed = 0;
    const end = now + 4 * MIN;
    while (E.current() === name && now < end) {
      run(33, s);
      borrowed = Math.max(borrowed, [...W.ducks.values()].filter((d) => d.event).length);
    }
    assert.notEqual(E.current(), name, `${name} should be over after 4 min`);
    assert.deepEqual([...W.ducks.values()].filter((d) => d.event).map((d) => d.id), [], `${name} released its ducks`);
    for (const k of ['coffeeBroken', 'printerJam', 'arcadeFrenzy', 'blackout', 'pizza', 'cake']) assert.ok(!O.dyn[k], `${name} left dyn.${k} on`);
    if (['arcade', 'pizza', 'birthday', 'watering'].includes(name)) assert.ok(borrowed > 0, `${name} borrows idle ducks`);
  }
});

// Names of the events seen, in order, and the quiet gaps between two of them (ms).
function watch(ms, s) {
  const names = [], gaps = [];
  let quietSince = null;
  run(ms, s, () => {
    const c = E.current();
    if (!c) { if (quietSince === null) quietSince = now; return; }
    if (quietSince !== null && names.length) gaps.push(now - quietSince);
    quietSince = null;
    if (names[names.length - 1] !== c || gaps.length >= names.length) names.push(c);
  });
  return { names, gaps };
}

test('something happens every 30 s to 1 min, never the same thing twice in a row', () => {
  fresh(7, idle('a'), idle('b'), idle('c'));
  const { names, gaps } = watch(30 * MIN, snap(idle('a'), idle('b'), idle('c')));
  assert.ok(names.length >= 15, `only ${names.length} events in 30 min`);
  for (const g of gaps) assert.ok(g >= 29000 && g <= 61000, `gap of ${g} ms`);
  for (let i = 1; i < names.length; i++) assert.notEqual(names[i], names[i - 1], names.join(','));
});

test('events go on while a duck waits for you', () => {
  const s = snap(idle('a'), idle('b'), session('p', 'permission', { waitingFor: 'permission prompt' }));
  fresh(2, ...s.agents);
  const { names } = watch(10 * MIN, s);
  assert.ok(names.length >= 5, names.join(','));
});

test('events happen on their own, the same way for the same seed', () => {
  const seen = () => {
    fresh(42, idle('a'), idle('b'), idle('c'));
    return watch(20 * MIN, snap(idle('a'), idle('b'), idle('c'))).names;
  };
  const first = seen();
  assert.ok(first.length >= 8, `only ${first.length} events in 20 min`);
  // (their lengths depend on how the ducks walk, so only the order is compared)
  assert.deepEqual(seen().slice(0, 8), first.slice(0, 8));
});

test('the cat, the courier and the robot only walk on free floor', () => {
  const bad = new Set();
  for (const name of ['cat', 'pizza', 'robot']) {
    const s = snap(idle('a'), idle('b'));
    fresh(5, ...s.agents);
    E.force(name, now, NOON);
    run(3 * MIN, s, () => {
      for (const e of E.npcs()) {
        if (e.mode !== 'walk') continue;
        const c = Math.floor(e.x / O.T), r = Math.floor(e.y / O.T);
        if (!O.walkable(c, r) && !(c === 15 && r === 15)) bad.add(`${name} ${e.type} at ${c},${r}`);
      }
    });
  }
  assert.deepEqual([...bad], []);
});

test('watering a plant makes it bloom for the day', () => {
  const s = snap(idle('a'));
  fresh(6, ...s.agents);
  for (const k of Object.keys(O.dyn.flowers)) delete O.dyn.flowers[k];
  E.force('watering', now, NOON);
  run(2 * MIN, s);
  assert.equal(Object.keys(O.dyn.flowers).length, 1);
});
