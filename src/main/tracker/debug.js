'use strict';
// Live, privacy-safe view of what the tracker sees:
//   node src/main/tracker/debug.js [seconds]
// One line per agent: id prefix, kind, project, state, tool category/name, age of the state.
const { createTracker } = require('./index');

const seconds = Number(process.argv[2]) || 10;
const tracker = createTracker({
  log: (level, msg) => {
    if (level !== 'debug') console.error(`[${level}] ${msg}`);
  },
});

function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 120 ? `${s}s` : `${Math.round(s / 60)}m`;
}

function print() {
  const snap = tracker.getSnapshot();
  const now = Date.now();
  const h = snap.health;
  console.log(`--- ${new Date(now).toLocaleTimeString()}  registry=${h.registry} tailed=${h.tailed} agents=${snap.agents.length}${h.errors.length ? ` errors=${h.errors.length}` : ''}`);
  for (const a of snap.agents) {
    const tool = a.tool ? `${a.tool.cat}/${a.tool.name}${a.tool.count > 1 ? `x${a.tool.count}` : ''}` : '-';
    const todos = a.todos ? ` todos=${a.todos.done}/${a.todos.total}` : '';
    console.log(
      `${a.id.slice(0, 16).padEnd(16)} ${a.kind.padEnd(8)} ${String(a.project).slice(0, 18).padEnd(18)} ` +
      `${a.state.padEnd(11)} ${tool.padEnd(18)} ${age(now - a.since).padStart(5)} ${a.entrypoint}${a.inferred ? ' (inferred)' : ''}${todos}`,
    );
  }
}

tracker.start();
const timer = setInterval(print, 1000);
setTimeout(() => {
  clearInterval(timer);
  print();
  tracker.stop();
}, seconds * 1000);
