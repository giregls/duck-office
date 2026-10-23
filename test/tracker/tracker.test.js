'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTracker } = require('../../src/main/tracker');
const { tmpClaudeDir, rm, R, lines, writeRegistry, projectDir } = require('./helpers');

const SID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SID2 = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

function makeTracker(claudeDir) {
  let clock = Date.now();
  const tracker = createTracker({
    claudeDir, watch: false, checkImages: false, fullScanMs: 0, now: () => clock, home: 'C:\\nobody-home',
  });
  return { tracker, advance: (ms) => { clock += ms; }, now: () => clock };
}

const byId = (snap, id) => snap.agents.find((a) => a.id === id);

test('registry + transcript: tool state, title, project, labels', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy' });
    fs.writeFileSync(path.join(projectDir(dir), `${SID}.jsonl`), lines([
      R.prompt(SID), R.aiTitle(SID, 'Build the duck office'), R.apiRequest(SID),
      R.toolUse(SID, 'toolu_1', 'Bash', { command: 'npm install', description: 'Install deps' }),
    ]));
    const { tracker } = makeTracker(dir);
    const a = byId(tracker.refresh(), `s:${SID}`);
    assert.ok(a, 'session listed');
    assert.equal(a.kind, 'session');
    assert.equal(a.state, 'tool');
    assert.deepEqual({ name: a.tool.name, cat: a.tool.cat, label: a.tool.label, count: a.tool.count },
      { name: 'Bash', cat: 'exec', label: 'Install deps', count: 1 });
    assert.equal(a.title, 'Build the duck office');
    assert.equal(a.project, 'demo-project');
    assert.equal(a.projectKey, 'c:/work/demo-project');
    assert.equal(a.entrypoint, 'cli');
    assert.equal(a.inferred, false);
    assert.equal(a.parentId, null);
  } finally {
    rm(dir);
  }
});

test('registry waiting → permission / input; idle → done with a stable since', () => {
  const dir = tmpClaudeDir();
  try {
    const t0 = Date.now() - 4000;
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: t0 });
    fs.writeFileSync(path.join(projectDir(dir), `${SID}.jsonl`), lines([R.prompt(SID), R.toolUse(SID, 'toolu_1', 'Edit', { file_path: 'a/b/app.js' })]));
    const { tracker, advance } = makeTracker(dir);
    let a = byId(tracker.refresh(), `s:${SID}`);
    assert.equal(a.state, 'permission');
    assert.equal(a.waitingFor, 'permission prompt');
    assert.equal(a.tool.label, 'app.js');
    assert.equal(a.since, t0);

    writeRegistry(dir, process.pid, { sessionId: SID, status: 'waiting', waitingFor: 'input needed', statusUpdatedAt: t0 + 1000 });
    advance(1000);
    a = byId(tracker.refresh(), `s:${SID}`);
    assert.equal(a.state, 'input');

    const t1 = Date.now() - 1000;
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'idle', statusUpdatedAt: t1 });
    advance(1000);
    a = byId(tracker.refresh(), `s:${SID}`);
    assert.equal(a.state, 'done');
    assert.equal(a.since, t1);
    advance(1000);
    assert.equal(byId(tracker.refresh(), `s:${SID}`).since, t1, 'since does not move while the state is unchanged');
  } finally {
    rm(dir);
  }
});

test('dead PIDs are ignored; a half-written registry file keeps the previous value', () => {
  const dir = tmpClaudeDir();
  try {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    writeRegistry(dir, dead, { sessionId: SID2, status: 'busy' });
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy' });
    fs.writeFileSync(path.join(projectDir(dir), `${SID}.jsonl`), lines([R.prompt(SID), R.apiRequest(SID)]));
    const { tracker, advance } = makeTracker(dir);
    let snap = tracker.refresh();
    assert.equal(byId(snap, `s:${SID2}`), undefined, 'dead pid not listed');
    assert.equal(byId(snap, `s:${SID}`).state, 'thinking');

    fs.writeFileSync(path.join(dir, 'sessions', `${process.pid}.json`), '{"pid": 12, "sessionId": "aa');
    advance(1000);
    snap = tracker.refresh();
    assert.equal(byId(snap, `s:${SID}`).state, 'thinking', 'no flap on a half-written file');
  } finally {
    rm(dir);
  }
});

test('a registry file whose PID now belongs to another program is ignored, even later', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy', startedAt: Date.now() - 3600000 });
    let clock = Date.now();
    let image = 'notepad.exe';
    let pendingCb = null;
    const tracker = createTracker({
      claudeDir: dir, watch: false, fullScanMs: 0, now: () => clock,
      listImages: (cb) => { pendingCb = () => cb(new Map([[process.pid, image]])); },
    });
    assert.equal(byId(tracker.refresh(), `s:${SID}`), undefined, 'held until the first process list answers');
    pendingCb();
    clock += 1000;
    assert.equal(byId(tracker.refresh(), `s:${SID}`), undefined, 'recycled PID rejected');
    image = 'claude.exe';
    clock += 61000;
    tracker.refresh();
    if (pendingCb) pendingCb();
    clock += 1000;
    assert.equal(byId(tracker.refresh(), `s:${SID}`), undefined, 'a dead registry entry stays dead');
  } finally {
    rm(dir);
  }
});

test('a genuine Claude process passes the image check', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'idle', startedAt: Date.now() - 3600000 });
    let clock = Date.now();
    const tracker = createTracker({
      claudeDir: dir, watch: false, fullScanMs: 0, now: () => clock,
      listImages: (cb) => cb(new Map([[process.pid, 'claude.exe']])),
    });
    tracker.refresh();
    clock += 1000;
    assert.equal(byId(tracker.refresh(), `s:${SID}`).state, 'done');
  } finally {
    rm(dir);
  }
});

test('a session leaves after its registry file has been gone for the grace period, and is not re-inferred', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'idle' });
    fs.writeFileSync(path.join(projectDir(dir), `${SID}.jsonl`), lines([R.prompt(SID), R.text(SID), R.turnDuration(SID)]));
    const { tracker, advance } = makeTracker(dir);
    assert.ok(byId(tracker.refresh(), `s:${SID}`));
    fs.unlinkSync(path.join(dir, 'sessions', `${process.pid}.json`));
    advance(500);
    assert.ok(byId(tracker.refresh(), `s:${SID}`), 'still there during the grace period');
    advance(2000);
    assert.equal(byId(tracker.refresh(), `s:${SID}`), undefined, 'gone after the grace period');
    advance(1000);
    assert.equal(byId(tracker.refresh(), `s:${SID}`), undefined, 'not brought back as an inferred session');
  } finally {
    rm(dir);
  }
});

test('subagents: finished ones never appear, live ones do, then finish and leave', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy' });
    const pd = projectDir(dir);
    fs.writeFileSync(path.join(pd, `${SID}.jsonl`), lines([
      R.prompt(SID),
      R.toolUse(SID, 'toolu_old', 'Agent', { description: 'Old one' }),
      R.toolResult(SID, 'toolu_old', { isAsync: true, status: 'async_launched', agentId: 'old1' }),
      R.toolUse(SID, 'toolu_live', 'Agent', { description: 'Live one' }),
      R.toolResult(SID, 'toolu_live', { isAsync: true, status: 'async_launched', agentId: 'live1' }),
      R.text(SID), R.turnDuration(SID, 2),
    ]));
    const sd = path.join(pd, SID, 'subagents');
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'agent-old1.jsonl'), lines([R.toolUse(SID, 'toolu_x', 'Read', { file_path: 'x.js' }, { isSidechain: true, agentId: 'old1' })]));
    fs.writeFileSync(path.join(sd, 'agent-old1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Old one', toolUseId: 'toolu_old', finished: true }));
    fs.writeFileSync(path.join(sd, 'agent-live1.jsonl'), lines([R.toolUse(SID, 'toolu_y', 'Grep', { pattern: 'secret' }, { isSidechain: true, agentId: 'live1' })]));
    fs.writeFileSync(path.join(sd, 'agent-live1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Live one', toolUseId: 'toolu_live' }));

    const { tracker, advance } = makeTracker(dir);
    let snap = tracker.refresh();
    assert.equal(byId(snap, `a:${SID}:old1`), undefined, 'finished subagent hidden');
    const live = byId(snap, `a:${SID}:live1`);
    assert.ok(live, 'live subagent listed');
    assert.equal(live.kind, 'subagent');
    assert.equal(live.parentId, `s:${SID}`);
    assert.equal(live.state, 'tool');
    assert.equal(live.tool.cat, 'search');
    assert.equal(live.tool.label, '', 'search patterns are never shown');
    assert.equal(live.title, 'Live one');
    assert.equal(live.agentType, 'Explore');
    assert.equal(byId(snap, `s:${SID}`).state, 'supervising', 'main turn over, a subagent still runs');

    fs.appendFileSync(path.join(pd, `${SID}.jsonl`), lines([R.notification(SID, 'live1')]));
    advance(1000);
    snap = tracker.refresh();
    assert.equal(byId(snap, `a:${SID}:live1`).state, 'finished');
    advance(9000);
    snap = tracker.refresh();
    assert.equal(byId(snap, `a:${SID}:live1`), undefined, 'finished subagent dropped after lingering');
  } finally {
    rm(dir);
  }
});

test('inferred sessions: recent transcripts without registry entry, but not exited or stale ones', () => {
  const dir = tmpClaudeDir();
  try {
    const pd = projectDir(dir, 'C--work-other');
    fs.writeFileSync(path.join(pd, `${SID}.jsonl`), lines([R.prompt(SID), R.toolUse(SID, 'toolu_1', 'WebFetch', { url: 'https://www.example.org/a?b' })]));
    fs.writeFileSync(path.join(pd, `${SID2}.jsonl`), lines([R.prompt(SID2), R.text(SID2), R.costState(SID2)]));
    const old = 'cccccccc-dddd-4eee-8fff-000000000000';
    const oldFile = path.join(pd, `${old}.jsonl`);
    fs.writeFileSync(oldFile, lines([R.prompt(old)]));
    const past = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(oldFile, past, past);

    const { tracker } = makeTracker(dir);
    const snap = tracker.refresh();
    const a = byId(snap, `s:${SID}`);
    assert.ok(a);
    assert.equal(a.inferred, true);
    assert.equal(a.state, 'tool');
    assert.equal(a.tool.label, 'example.org');
    assert.equal(byId(snap, `s:${SID2}`), undefined, 'exited session (cost-state) hidden');
    assert.equal(byId(snap, `s:${old}`), undefined, 'stale transcript hidden');
  } finally {
    rm(dir);
  }
});

test('a session id present in two project folders follows the newest file', () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy' });
    const a = path.join(projectDir(dir, 'C--old-place'), `${SID}.jsonl`);
    const b = path.join(projectDir(dir, 'C--new-place'), `${SID}.jsonl`);
    fs.writeFileSync(a, lines([R.prompt(SID), R.toolUse(SID, 'toolu_1', 'Read', { file_path: 'old.js' })]));
    const past = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(a, past, past);
    fs.writeFileSync(b, lines([R.prompt(SID), R.toolUse(SID, 'toolu_2', 'Write', { file_path: 'new.js' })]));
    const { tracker } = makeTracker(dir);
    const s = byId(tracker.refresh(), `s:${SID}`);
    assert.equal(s.tool.label, 'new.js');
  } finally {
    rm(dir);
  }
});

test('emits snapshots on change and keeps a stable shape', async () => {
  const dir = tmpClaudeDir();
  try {
    writeRegistry(dir, process.pid, { sessionId: SID, status: 'busy' });
    fs.writeFileSync(path.join(projectDir(dir), `${SID}.jsonl`), lines([R.prompt(SID), R.apiRequest(SID)]));
    const { tracker } = makeTracker(dir);
    const got = [];
    tracker.on('snapshot', (s) => got.push(s));
    tracker.refresh();
    tracker.refresh(); // nothing changed, heartbeat not due
    assert.equal(got.length, 1);
    const s = got[0];
    assert.equal(s.live, true);
    assert.equal(typeof s.now, 'number');
    assert.deepEqual(Object.keys(s.health).sort(), ['errors', 'registry', 'tailed', 'warming']);
    assert.deepEqual(Object.keys(s.agents[0]).sort(), [
      'agentType', 'entrypoint', 'id', 'inferred', 'kind', 'lastActivity', 'parentId', 'project', 'projectKey',
      'sessionId', 'since', 'startedAt', 'state', 'title', 'todos', 'tool',
      'usage', 'waitingFor',
    ].sort());
    assert.deepEqual(Object.keys(s.usage).sort(), ['partial', 'today']);
  } finally {
    rm(dir);
  }
});
