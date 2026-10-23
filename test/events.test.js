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
    while (E.running().includes(name) && now < end) {
      run(33, s);
      borrowed = Math.max(borrowed, [...W.ducks.values()].filter((d) => d.event && d.event.station).length);
    }
    assert.ok(!E.running().includes(name), name + ' should be over after 4 min');
    const flag = { coffee: 'coffeeBroken', printer: 'printerJam', arcade: 'arcadeFrenzy', blackout: 'blackout', pizza: 'pizza', birthday: 'cake' }[name];
    if (flag) assert.ok(!O.dyn[flag], name + ' left dyn.' + flag + ' on');
    if (['arcade', 'pizza', 'birthday', 'watering'].includes(name)) assert.ok(borrowed > 0, name + ' borrows idle ducks');
  }
});

test('a finished event lets its ducks go', () => {
  const s = snap(idle('a'), idle('b'));
  fresh(9, ...s.agents);
  E.force('arcade', now, NOON);
  const mine = () => [...W.ducks.values()].filter((d) => d.event && d.event.station === 'arcade').length;
  run(15000, s);
  assert.equal(mine(), 2);
  while (E.running().includes('arcade')) run(33, s);
  assert.equal(mine(), 0);
});

// Follows the event slots: names in the order they start, the quiet gap of a slot between
// two of its events, how many events ran at once, and any event running twice at once.
function watch(ms, s) {
  const starts = [], gaps = [], quiet = [], twice = [];
  let most = 0, prev = E.slots();
  run(ms, s, () => {
    const cur = E.slots();
    cur.forEach((name, i) => {
      if (!name && prev[i]) quiet[i] = now;
      if (name && name !== prev[i]) {
        starts.push(name);
        if (!prev[i] && quiet[i] !== undefined) gaps.push(now - quiet[i]);
      }
    });
    const live = cur.filter(Boolean);
    most = Math.max(most, live.length);
    if (new Set(live).size !== live.length) twice.push(live.join(','));
    prev = cur;
  });
  return { starts, gaps, most, twice };
}

test('up to 3 events at once, each slot with a quiet gap of 30 s to 1 min', () => {
  const s = snap(idle('a'), idle('b'), idle('c'), idle('d'));
  fresh(7, ...s.agents);
  const { starts, gaps, most, twice } = watch(30 * MIN, s);
  assert.equal(most, 3);
  assert.deepEqual(twice, []);
  assert.ok(starts.length >= 30, 'only ' + starts.length + ' events in 30 min');
  for (const g of gaps) assert.ok(g >= 29000, 'gap of ' + g + ' ms');
  const onTime = gaps.filter((g) => g <= 61000).length;
  assert.ok(onTime >= gaps.length * 0.9, onTime + ' of ' + gaps.length + ' gaps within 1 min');
  for (let i = 1; i < starts.length; i++) assert.notEqual(starts[i], starts[i - 1], starts.join(','));
});

test('events go on while a duck waits for you', () => {
  const s = snap(idle('a'), idle('b'), session('p', 'permission', { waitingFor: 'permission prompt' }));
  fresh(2, ...s.agents);
  assert.ok(watch(5 * MIN, s).starts.length >= 6);
});

test('events happen on their own, the same way for the same seed', () => {
  const seen = () => {
    fresh(42, idle('a'), idle('b'), idle('c'));
    return watch(10 * MIN, snap(idle('a'), idle('b'), idle('c'))).starts;
  };
  const first = seen();
  assert.ok(first.length >= 8, 'only ' + first.length + ' events in 10 min');
  // (their lengths depend on how the ducks walk, so only the first ones are compared)
  assert.deepEqual(seen().slice(0, 6), first.slice(0, 6));
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
