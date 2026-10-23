'use strict';
// Duck Office data layer: watches Claude Code on this machine, read-only, and emits
// snapshots of every live agent (sessions + subagents) for the renderer.
//
// Sources, by priority:
//   1. ~/.claude/sessions/<pid>.json   registry of running sessions (status, waitingFor)
//   2. ~/.claude/projects/<slug>/<sessionId>.jsonl   transcript tail (tools, phase, titles)
//   3. <slug>/<sessionId>/subagents/agent-<id>.jsonl + .meta.json   subagents
// Strictly read-only: never opens *.key / .credentials.json, never writes under ~/.claude.
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileTail } = require('./tail');
const { TranscriptState } = require('./transcript');
const { readRegistry, pidAlive, sameDomain, listImages, imageLooksLikeClaude } = require('./registry');
const { resolveProject } = require('./project');
const { deriveSession, deriveSubagent, maxDefined } = require('./state');
const { UsageIndex } = require('./usage');

const DEFAULTS = {
  pollMs: 1000,
  heartbeatMs: 5000,
  catchupBytes: 512 * 1024,
  inferredMaxAgeMs: 10 * 60 * 1000,  // transcript-only sessions disappear after this much silence
  subagentStaleMs: 10 * 60 * 1000,   // a subagent silent this long is considered finished
  finishedLingerMs: 8000,            // 'finished' subagents stay listed this long
  registryGraceMs: 1500,             // a registry file must be missing this long before a session leaves
  imageCheckMs: 60000,               // tasklist cadence (PID recycling check; spawning it is the costly part)
  firstImageWaitMs: 3000,            // at startup, wait this long at most for the first tasklist answer
  minTickGapMs: 250,                 // watcher-triggered passes are throttled to this
  fullScanMs: 30000,                 // full rescan of project folders (watcher is the fast path)
  findTranscriptMs: 2000,            // retry cadence while a session's transcript doesn't exist yet
  relocateMs: 15000,                 // re-check which project folder holds a session's transcript
  usageDiscoverMs: 30000,            // look for today's transcripts (daily token total) this often
  checkImages: true,
  watch: true,
  usage: true,
};

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const AGENT_FILE_RE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;
const MAX_TITLE = 80;

function clip(s, n) {
  if (typeof s !== 'string') return s;
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

function statSafe(p) {
  try {
    return fs.statSync(p);
  } catch (_) {
    return null;
  }
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

class Tracker extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.claudeDir = opts.claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    this.sessionsDir = path.join(this.claudeDir, 'sessions');
    this.projectsDir = path.join(this.claudeDir, 'projects');
    this.home = opts.home || os.homedir();
    this.log = typeof opts.log === 'function' ? opts.log : () => {};
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.listImages = typeof opts.listImages === 'function' ? opts.listImages : listImages;

    this.running = false;
    this.timer = null;
    this.kickTimer = null;
    this.watchers = new Set();
    this.hints = new Set();

    this.regCache = new Map();
    this.registryStatus = 'missing';
    this.deadEntries = new Set(); // `${pid}:${procStart}` seen dead once: never alive again (PID recycling)
    this.images = null;
    this.imagesAt = 0;
    this.imagesPending = false;
    this.imagesChecked = !this.opts.checkImages;
    this.startedAt = null;
    this.lastTickAt = 0;

    this.sessions = new Map();      // sessionId -> track
    this.endedSessions = new Map(); // sessionId -> time it ended (never re-inferred unless it grows)
    this.projectDirs = [];
    this.projectDirsAt = 0;
    this.lastFullScan = 0;

    this.stable = new Map();        // agent id -> { key, since, seen }
    this.usage = new UsageIndex({ now: this.now, home: this.home });
    this.usageDiscoverAt = -Infinity;
    this.errors = [];
    this.snapshot = { now: this.now(), live: true, agents: [], health: { registry: 'missing', tailed: 0, errors: [] } };
    this.lastBody = null;
    this.lastEmitAt = 0;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this._tick();
    this.timer = setInterval(() => this._tick(), this.opts.pollMs);
    if (this.opts.watch) this._startWatch();
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = this.kickTimer = null;
    for (const w of this.watchers) try { w.close(); } catch (_) { /* ignore */ }
    this.watchers.clear();
    return this;
  }

  getSnapshot() {
    return this.snapshot;
  }

  // Runs one observation pass right now (also used by tests with a fake clock).
  refresh() {
    this._tick();
    return this.snapshot;
  }

  // ---------------------------------------------------------------- loop

  _tick() {
    const now = this.now();
    if (this.startedAt === null) this.startedAt = now;
    this.lastTickAt = now;
    const hints = this.hints;
    this.hints = new Set();
    try {
      this._refreshRegistry(now);
      this._refreshImages(now);
      this._discoverInferred(now, hints);
      for (const t of this.sessions.values()) this._refreshSession(t, now, hints);
      for (const [sid, t] of this.sessions) if (t.removed) this.sessions.delete(sid);
      this._refreshUsage(now);
      this._emit(now);
    } catch (e) {
      this._error(`tick: ${e && e.message ? e.message.slice(0, 120) : 'failed'}`);
    }
  }

  _kick() {
    if (this.kickTimer || !this.running) return;
    const wait = Math.max(150, this.opts.minTickGapMs - (this.now() - this.lastTickAt));
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      if (this.running) this._tick();
    }, wait);
  }

  _error(msg) {
    if (this.errors[this.errors.length - 1] !== msg) {
      this.errors.push(msg);
      if (this.errors.length > 5) this.errors.shift();
    }
    this.log('warn', msg);
  }

  // ---------------------------------------------------------------- registry

  _refreshRegistry(now) {
    const { status, entries } = readRegistry(this.sessionsDir, this.regCache, (m) => this._error(m));
    this.registryStatus = status;
    if (status !== 'ok') return; // can't tell who left: keep everything as is

    const live = new Map();
    for (const e of entries) {
      if (!sameDomain(e) || e.kind === 'daemon') continue;
      const entryKey = `${e.pid}:${e.procStart}`;
      if (this.deadEntries.has(entryKey)) continue;
      if (!this._entryAlive(e)) {
        this.deadEntries.add(entryKey); // a crash leaves the file behind; its PID may get reused later
        if (this.deadEntries.size > 500) this.deadEntries.delete(this.deadEntries.values().next().value);
        continue;
      }
      const prev = live.get(e.sessionId);
      if (!prev || (e.updatedAt || 0) > (prev.updatedAt || 0)) live.set(e.sessionId, e);
    }

    // Until the first process listing answers (≤ firstImageWaitMs), don't add sessions:
    // a stale file whose PID was recycled would otherwise pop in and out at startup.
    const holdNew = !this.imagesChecked && now - this.startedAt < this.opts.firstImageWaitMs;
    this.warming = holdNew && live.size > 0;
    for (const [sid, e] of live) {
      let t = this.sessions.get(sid);
      if (!t) {
        if (holdNew) continue;
        t = this._newTrack(sid, now);
        this.sessions.set(sid, t);
      }
      t.reg = e;
      t.regMissingSince = null;
      t.inferred = false;
      this.endedSessions.delete(sid);
    }

    for (const t of this.sessions.values()) {
      if (!t.reg || live.has(t.sessionId)) continue;
      // Registry entry gone: leave at once if the process is dead, otherwise after a grace
      // period (the file may just be in the middle of a rewrite).
      if (!this._entryAlive(t.reg)) {
        this._endSession(t, now);
      } else if (t.regMissingSince === null) {
        t.regMissingSince = now;
      } else if (now - t.regMissingSince >= this.opts.registryGraceMs) {
        this._endSession(t, now);
      }
    }
  }

  _entryAlive(e) {
    if (!pidAlive(e.pid)) return false;
    // The process list only proves something about processes that existed when it was taken.
    const listedAfterStart = this.images && this.imagesAt > (Number(e.startedAt) || 0);
    if (listedAfterStart && this.images.has(e.pid) && !imageLooksLikeClaude(this.images.get(e.pid))) return false;
    return true;
  }

  _refreshImages(now) {
    if (!this.opts.checkImages || this.imagesPending) return;
    if (this.imagesChecked && now - this.imagesAt < this.opts.imageCheckMs) return;
    if (this.imagesChecked && ![...this.sessions.values()].some((t) => t.reg)) return;
    if (!this.imagesChecked && this.regCache.size === 0) {
      this.imagesChecked = true; // nothing to verify yet
      return;
    }
    this.imagesPending = true;
    this.listImages((map) => {
      this.imagesPending = false;
      this.imagesAt = this.now();
      if (map) this.images = map;
      const first = !this.imagesChecked;
      this.imagesChecked = true;
      if (first && this.running) this._kick();
    });
  }

  _endSession(t, now) {
    t.removed = true;
    this.endedSessions.set(t.sessionId, now);
    if (this.endedSessions.size > 200) this.endedSessions.delete(this.endedSessions.keys().next().value);
  }

  _newTrack(sessionId, now) {
    return {
      sessionId,
      reg: null,
      regMissingSince: null,
      inferred: false,
      removed: false,
      txPath: null,
      tail: null,
      tx: new TranscriptState(),
      lastFind: 0,
      firstSeen: now,
      subs: new Map(),
      doneSubs: new Set(),
    };
  }

  // ---------------------------------------------------------------- transcripts

  _listProjectDirs(now, force) {
    if (!force && now - this.projectDirsAt < 10000) return this.projectDirs;
    this.projectDirsAt = now;
    try {
      this.projectDirs = fs
        .readdirSync(this.projectsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(this.projectsDir, d.name));
    } catch (_) {
      this.projectDirs = [];
    }
    return this.projectDirs;
  }

  // The same session id can live in two project folders (its cwd changed): newest wins.
  _findTranscript(sessionId, now, freshDirs) {
    let best = null;
    let bestM = -1;
    for (const dir of this._listProjectDirs(now, freshDirs)) {
      const st = statSafe(path.join(dir, sessionId + '.jsonl'));
      if (st && st.mtimeMs > bestM) {
        best = path.join(dir, sessionId + '.jsonl');
        bestM = st.mtimeMs;
      }
    }
    return best ? { file: best, mtimeMs: bestM } : null;
  }

  _attachTranscript(t, file) {
    t.txPath = file;
    t.tail = new FileTail(file, { catchupBytes: this.opts.catchupBytes });
    t.tx = new TranscriptState();
  }

  _pollTail(owner, subagent) {
    const r = owner.tail.poll();
    if (r.reset) owner.tx = new TranscriptState({ subagent });
    for (const line of r.lines) owner.tx.ingestLine(line);
  }

  _refreshSession(t, now, hints) {
    if (t.removed) return;
    if (!t.inferred) {
      const due = t.txPath ? now - t.lastFind >= this.opts.relocateMs : now - t.lastFind >= this.opts.findTranscriptMs;
      const hinted = !t.txPath && [...hints].some((h) => h.includes(t.sessionId));
      if (due || hinted) {
        t.lastFind = now;
        const found = this._findTranscript(t.sessionId, now, hinted || !t.txPath);
        const current = t.tail ? t.tail.mtimeMs : -1;
        if (found && found.file !== t.txPath && found.mtimeMs > current + 1000) this._attachTranscript(t, found.file);
      }
    }
    if (t.tail) this._pollTail(t, false);

    if (t.inferred) {
      const quiet = t.tail ? now - t.tail.mtimeMs : Infinity;
      if (t.tx.ended || quiet > this.opts.inferredMaxAgeMs || (t.tail && t.tail.missing)) {
        this._endSession(t, now);
        return;
      }
    }
    this._refreshSubagents(t, now);
  }

  // Sessions not in the registry (older Claude Code, other front-ends): inferred from
  // recently written transcripts that don't end with a cost-state (process exit) record.
  _discoverInferred(now, hints) {
    const files = [];
    if (now - this.lastFullScan >= this.opts.fullScanMs) {
      this.lastFullScan = now;
      for (const dir of this._listProjectDirs(now, true)) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { /* ignore */ }
        for (const n of names) if (SESSION_FILE_RE.test(n)) files.push(path.join(dir, n));
      }
      if (this.opts.watch && this.running) this._startWatch(); // (re)arm watchers that failed or had no folder yet
    } else {
      for (const h of hints) {
        const parts = h.split(/[\\/]/);
        if (parts.length === 2 && SESSION_FILE_RE.test(parts[1])) files.push(path.join(this.projectsDir, h));
      }
    }

    // Anything the registry knows about (live, held at startup, or crashed) is never inferred.
    const regIds = new Set([...this.regCache.values()].map((c) => c.entry.sessionId));
    for (const file of files) {
      const sid = SESSION_FILE_RE.exec(path.basename(file))[1];
      if (this.sessions.has(sid) || regIds.has(sid)) continue;
      const st = statSafe(file);
      if (!st || now - st.mtimeMs > this.opts.inferredMaxAgeMs) continue;
      const endedAt = this.endedSessions.get(sid);
      if (endedAt !== undefined && st.mtimeMs <= endedAt + 2000) continue;

      const t = this._newTrack(sid, now);
      t.inferred = true;
      this._attachTranscript(t, file);
      this._pollTail(t, false);
      if (t.tx.ended) {
        this.endedSessions.set(sid, st.mtimeMs);
        continue;
      }
      this.sessions.set(sid, t);
    }
  }

  // ---------------------------------------------------------------- subagents

  _subFinishedByParent(t, agentId, meta) {
    if (t.tx.finishedTaskIds.has(agentId)) return true;
    return !!(meta && typeof meta.toolUseId === 'string' && t.tx.syncDoneToolUseIds.has(meta.toolUseId));
  }

  _subFinished(t, sub, now) {
    return (
      (sub.meta && sub.meta.finished === true) ||
      this._subFinishedByParent(t, sub.agentId, sub.meta) ||
      sub.tx.endsTurn ||
      now - sub.tail.mtimeMs > this.opts.subagentStaleMs
    );
  }

  _refreshSubagents(t, now) {
    if (!t.txPath) return;
    const dir = path.join(path.dirname(t.txPath), t.sessionId, 'subagents');
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { /* no subagents yet */ }

    for (const name of names) {
      const m = AGENT_FILE_RE.exec(name);
      if (!m) continue;
      const agentId = m[1];
      if (t.subs.has(agentId) || t.doneSubs.has(agentId)) continue;
      const jsonl = path.join(dir, name);
      const st = statSafe(jsonl);
      if (!st) continue;
      if (now - st.mtimeMs > this.opts.subagentStaleMs) {
        t.doneSubs.add(agentId); // silent for ages: finished long ago
        continue;
      }
      const metaPath = path.join(dir, `agent-${agentId}.meta.json`);
      const metaSt = statSafe(metaPath);
      const births = [st.birthtimeMs, metaSt ? metaSt.birthtimeMs : 0].filter((v) => v > 0);
      const sub = {
        agentId,
        jsonl,
        metaPath,
        meta: metaSt ? readJsonSafe(metaPath) : null,
        metaMtime: metaSt ? metaSt.mtimeMs : 0,
        tail: new FileTail(jsonl, { catchupBytes: this.opts.catchupBytes }),
        tx: new TranscriptState({ subagent: true }),
        finishedAt: null,
        discoveredAt: now,
        startedAt: births.length ? Math.round(Math.min(...births)) : now,
      };
      this._pollTail(sub, true);
      if (this._subFinished(t, sub, now)) {
        t.doneSubs.add(agentId); // already done when we found it: never shown
        continue;
      }
      t.subs.set(agentId, sub);
      if (this.opts.usage) this.usage.follow(jsonl, t.sessionId, agentId); // its tokens from the start
    }

    for (const sub of t.subs.values()) {
      if (sub.finishedAt) {
        if (now - sub.finishedAt >= this.opts.finishedLingerMs) {
          t.subs.delete(sub.agentId);
          t.doneSubs.add(sub.agentId);
        }
        continue;
      }
      this._pollTail(sub, true);
      const metaSt = statSafe(sub.metaPath);
      if (metaSt && metaSt.mtimeMs !== sub.metaMtime) {
        const meta = readJsonSafe(sub.metaPath);
        if (meta) {
          sub.meta = meta;
          sub.metaMtime = metaSt.mtimeMs;
        }
      }
      if (this._subFinished(t, sub, now)) sub.finishedAt = now;
    }
    if (t.doneSubs.size > 1000) t.doneSubs.delete(t.doneSubs.values().next().value);
  }

  // ---------------------------------------------------------------- tokens & cost

  _refreshUsage(now) {
    if (!this.opts.usage) return;
    const dirs = this._listProjectDirs(now);
    if (now - this.usageDiscoverAt >= this.opts.usageDiscoverMs) {
      this.usageDiscoverAt = now;
      this.usage.discoverToday(dirs, now);
      this.usage.prune(new Set(this.sessions.keys()), now);
    }
    for (const t of this.sessions.values()) {
      if (now - (t.usageAt || -Infinity) < this.opts.usageDiscoverMs / 3) continue;
      t.usageAt = now;
      this.usage.followSession(t.sessionId, dirs); // whole history, even from older days
    }
    this.usage.step();
  }

  // ---------------------------------------------------------------- snapshot

  _stableSince(id, key, evidence, now) {
    const prev = this.stable.get(id);
    if (prev && prev.key === key) {
      prev.seen = now;
      return prev.since;
    }
    const since = Math.round(Math.min(now, typeof evidence === 'number' && evidence > 0 ? evidence : now));
    this.stable.set(id, { key, since, seen: now });
    return since;
  }

  _info(id, d, base, now) {
    const key = `${d.state}|${d.tool ? `${d.tool.name}@${d.tool.since}` : ''}|${d.waitingFor || ''}`;
    return {
      id,
      parentId: base.parentId,
      kind: base.kind,
      sessionId: base.sessionId,
      project: base.project,
      projectKey: base.projectKey,
      title: clip(base.title, MAX_TITLE),
      agentType: base.agentType,
      entrypoint: base.entrypoint,
      state: d.state,
      since: this._stableSince(id, key, d.evidence, now),
      tool: d.tool,
      waitingFor: d.waitingFor,
      startedAt: Math.round(base.startedAt),
      lastActivity: Math.round(base.lastActivity),
      todos: base.todos ? { done: base.todos.done, total: base.todos.total } : null,
      inferred: base.inferred,
      usage: base.usage || null,
    };
  }

  _sessionTitle(reg, tx, project) {
    const t = tx.customTitle || tx.aiTitle;
    if (t) return t;
    if (reg && typeof reg.name === 'string' && reg.name && reg.nameSource !== 'derived') return reg.name;
    return tx.agentName || tx.summaryTitle || (reg && reg.name) || project;
  }

  _buildAgents(now) {
    const agents = [];
    for (const t of this.sessions.values()) {
      if (t.removed) continue;
      const running = [...t.subs.values()].filter((s) => !s.finishedAt).length;
      const { project, projectKey } = resolveProject((t.reg && t.reg.cwd) || t.tx.cwd, this.home);
      const entrypoint = (t.reg && t.reg.entrypoint) || t.tx.entrypoint || 'unknown';
      const sid = t.sessionId;
      const lastActivity = maxDefined(t.tail && t.tail.mtimeMs, t.tx.lastTs, t.reg && t.reg.updatedAt) || now;
      agents.push(
        this._info(`s:${sid}`, deriveSession(t.reg, t.tx, running, now), {
          parentId: null,
          kind: 'session',
          sessionId: sid,
          project,
          projectKey,
          title: this._sessionTitle(t.reg, t.tx, project),
          agentType: null,
          entrypoint,
          startedAt: (t.reg && t.reg.startedAt) || t.tx.firstTs || t.firstSeen,
          lastActivity,
          todos: t.tx.todos,
          inferred: !t.reg,
          usage: this.usage.sessionUsage(sid),
        }, now),
      );
      for (const sub of t.subs.values()) {
        const meta = sub.meta || {};
        agents.push(
          this._info(`a:${sid}:${sub.agentId}`, deriveSubagent(sub, now), {
            parentId: `s:${sid}`,
            kind: 'subagent',
            sessionId: sid,
            project,
            projectKey,
            title: meta.description || meta.agentType || 'subagent',
            agentType: typeof meta.agentType === 'string' ? meta.agentType : null,
            entrypoint,
            startedAt: sub.startedAt,
            lastActivity: maxDefined(sub.tail.mtimeMs, sub.tx.lastTs) || now,
            todos: sub.tx.todos,
            inferred: !t.reg,
            usage: this.usage.fileUsage(sub.jsonl),
          }, now),
        );
      }
    }
    agents.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const [id, s] of this.stable) if (s.seen !== now) this.stable.delete(id);
    return agents;
  }

  _emit(now) {
    const agents = this._buildAgents(now);
    let tailed = 0;
    for (const t of this.sessions.values()) tailed += (t.tail ? 1 : 0) + t.subs.size;
    // warming: live sessions are still held back (first process check pending), so the
    // page must not treat this snapshot as the startup catch-up.
    const health = { registry: this.registryStatus, tailed, errors: this.errors.slice(), warming: !!this.warming };
    // tokens & API-equivalent cost since midnight; partial while the first read is under way
    const usage = this.opts.usage ? { today: this.usage.today(now), partial: !this.usage.caughtUp } : null;
    const body = JSON.stringify({ agents, health, usage });
    this.snapshot = { now, live: true, agents, health, usage };
    if (body !== this.lastBody || now - this.lastEmitAt >= this.opts.heartbeatMs) {
      this.lastBody = body;
      this.lastEmitAt = now;
      this.emit('snapshot', this.snapshot);
    }
  }

  // ---------------------------------------------------------------- watching

  _startWatch() {
    this._watch(this.projectsDir, true, (name) => {
      if (name) this.hints.add(String(name));
      this._kick();
    });
    this._watch(this.sessionsDir, false, () => this._kick());
  }

  _watch(dir, recursive, onEvent) {
    for (const w of this.watchers) if (w.__dir === dir) return;
    try {
      const w = fs.watch(dir, { recursive, persistent: false }, (_ev, name) => onEvent(name));
      w.__dir = dir;
      w.on('error', (e) => {
        this._error(`watch: ${path.basename(dir)} ${(e && e.code) || 'error'}`);
        try { w.close(); } catch (_) { /* ignore */ }
        this.watchers.delete(w);
      });
      this.watchers.add(w);
    } catch (e) {
      if (!e || e.code !== 'ENOENT') this._error(`watch: cannot watch ${path.basename(dir)}`);
    }
  }
}

function createTracker(opts) {
  return new Tracker(opts);
}

module.exports = { createTracker, Tracker };
