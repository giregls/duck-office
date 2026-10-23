// Token usage and API-equivalent cost of Claude Code sessions, read from transcripts.
//
// - Every assistant response carries message.usage. A response with several content
//   blocks is written as several lines repeating the same usage: each message id counts once
//   (per session, since a session can also sit in two project folders).
// - When a run ends, Claude Code writes a cost-state record with its own exact total. Inside
//   a finished run that figure replaces our estimate; it also covers background calls
//   (auto-mode checks, titles...) that never reach the transcript.
// - Strictly read-only, and only reads appended bytes after the first pass.
const fs = require('fs');
const path = require('path');
const { resolveProject } = require('./project');

// $ per million tokens: [input, output, cache read, cache write 5 min, cache write 1 h].
// Opus, Sonnet and Haiku 5.5 were checked against Claude Code's own cost-state totals.
const PRICES = [
  ['claude-fable-5-1', [10, 50, 0.25, 12.5, 20]],
  ['claude-mythos-5-1', [10, 50, 0.25, 12.5, 20]],
  ['claude-fable-5', [10, 50, 1, 12.5, 20]],
  ['claude-mythos-5', [10, 50, 1, 12.5, 20]],
  ['claude-opus-5-5', [4, 20, 0.2, 5, 8]],
  ['claude-opus-5', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-8', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-7', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-6', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4-5', [5, 25, 0.5, 6.25, 10]],
  ['claude-opus-4', [15, 75, 1.5, 18.75, 30]],
  ['claude-sonnet-5-5', [2, 10, 0.1, 2.5, 4]],
  ['claude-sonnet-5', [2, 10, 0.2, 2.5, 4]],
  ['claude-sonnet-4', [3, 15, 0.3, 3.75, 6]],
  ['claude-3-7-sonnet', [3, 15, 0.3, 3.75, 6]],
  ['claude-haiku-5-5', [0.1, 0.5, 0.005, 0.125, 0.2]],
  ['claude-haiku-4-5', [1, 5, 0.1, 1.25, 2]],
  ['claude-3-5-haiku', [0.8, 4, 0.08, 1, 1.6]],
];
// Unknown versions of a known family are priced like its current model.
const FAMILY = [['fable', 'claude-fable-5-1'], ['mythos', 'claude-mythos-5-1'], ['opus', 'claude-opus-5-5'], ['sonnet', 'claude-sonnet-5-5'], ['haiku', 'claude-haiku-5-5']];
const WEB_SEARCH_USD = 0.01;
const HAIKU_LONG_PROMPT = 100000; // Haiku 5.5 costs 5x above this many prompt tokens

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const AGENT_FILE_RE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;

// "us.anthropic.claude-opus-5-5-v1:0", "claude-opus-5-5@2026", "claude-opus-5-5[1m]" -> "claude-opus-5-5"
function normalizeModel(model) {
  return String(model || '')
    .toLowerCase()
    .replace(/^.*anthropic\./, '')
    .replace(/@.*$/, '')
    .replace(/\[.*\]$/, '')
    .replace(/-v\d+(?::\d+)?$/, '');
}

function priceFor(model) {
  const id = normalizeModel(model);
  const hit = PRICES.find(([prefix]) => id.startsWith(prefix));
  if (hit) return { id, prices: hit[1], guessed: false };
  const fam = FAMILY.find(([k]) => id.includes(k));
  if (fam) return { id, prices: PRICES.find(([p]) => p === fam[1])[1], guessed: true };
  return { id, prices: null, guessed: true };
}

const num = (v) => (typeof v === 'number' && v > 0 ? v : 0);

function tokensOf(u) {
  const cc = u && typeof u.cache_creation === 'object' && u.cache_creation ? u.cache_creation : null;
  let write1h = cc ? num(cc.ephemeral_1h_input_tokens) : 0;
  let write5m = cc ? num(cc.ephemeral_5m_input_tokens) : 0;
  const declared = num(u.cache_creation_input_tokens);
  if (write1h + write5m === 0) write5m = declared; // older format without the split
  const t = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite: Math.max(declared, write1h + write5m),
    write5m,
    write1h,
    webSearches: num(u.server_tool_use && u.server_tool_use.web_search_requests),
  };
  t.total = t.input + t.output + t.cacheRead + t.cacheWrite;
  return t;
}

// API-equivalent cost of one response, in dollars.
function costOf(model, usage) {
  const t = tokensOf(usage || {});
  const { id, prices, guessed } = priceFor(model);
  if (!prices) return { cost: t.webSearches * WEB_SEARCH_USD, tokens: t, unknown: true, guessed: true, model: id };
  const [pin, pout, pread, pw5, pw1] = prices;
  let k = 1;
  if (id.startsWith('claude-haiku-5-5') && t.input + t.cacheRead + t.cacheWrite > HAIKU_LONG_PROMPT) k *= 5;
  if (usage && usage.speed === 'fast') k *= 2;
  const cost = ((t.input * pin + t.output * pout + t.cacheRead * pread + t.write5m * pw5 + t.write1h * pw1) * k) / 1e6 + t.webSearches * WEB_SEARCH_USD;
  return { cost, tokens: t, unknown: false, guessed, model: id };
}

function midnight(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function statSafe(p) {
  try { return fs.statSync(p); } catch (_) { return null; }
}
function readdirSafe(p) {
  try { return fs.readdirSync(p); } catch (_) { return []; }
}
function readSlice(file, offset, length) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(length);
    const n = fs.readSync(fd, buf, 0, length, offset);
    return n === length ? buf : buf.subarray(0, n);
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch (_) { /* ignore */ }
  }
}

const EMPTY = () => ({ tokens: 0, cacheRead: 0, cost: 0 });
const round = (u) => ({ tokens: Math.round(u.tokens), cacheRead: Math.round(u.cacheRead), cost: Math.round(u.cost * 10000) / 10000 });

class UsageIndex {
  constructor(opts = {}) {
    this.now = typeof opts.now === 'function' ? opts.now : Date.now;
    this.home = opts.home;
    this.budget = opts.budgetBytes || 8 * 1024 * 1024; // bytes read per step, at most
    this.files = new Map(); // path -> followed file
    this.sessions = new Map(); // session id -> { files, seen, runs, cwd, version }
    this.version = 0;
    this.caughtUp = true;
    this.memo = new Map();
  }

  _session(id) {
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, files: new Set(), seen: new Set(), runs: new Map(), cwd: null, version: 0 };
      this.sessions.set(id, s);
    }
    return s;
  }

  follow(file, sessionId, agentId) {
    let f = this.files.get(file);
    if (f) return f;
    f = { file, sessionId, agentId: agentId || null, offset: 0, carry: null, ids: new Set(), responses: [], mtimeMs: 0 };
    this.files.set(file, f);
    this._session(sessionId).files.add(f);
    this.caughtUp = false;
    return f;
  }

  // Every file of a live session (both project folders, all its subagents), whatever its age.
  followSession(sessionId, projectDirs) {
    for (const dir of projectDirs) {
      const main = path.join(dir, sessionId + '.jsonl');
      if (statSafe(main)) this.follow(main, sessionId, null);
      const subdir = path.join(dir, sessionId, 'subagents');
      for (const name of readdirSafe(subdir)) {
        const m = AGENT_FILE_RE.exec(name);
        if (m) this.follow(path.join(subdir, name), sessionId, m[1]);
      }
    }
  }

  // Every transcript written today (for the daily total), open or closed.
  discoverToday(projectDirs, now) {
    const m0 = midnight(now);
    for (const dir of projectDirs) {
      for (const name of readdirSafe(dir)) {
        const m = SESSION_FILE_RE.exec(name);
        if (!m) continue;
        const st = statSafe(path.join(dir, name));
        if (!st || st.mtimeMs < m0) continue;
        this.follow(path.join(dir, name), m[1], null);
        const subdir = path.join(dir, m[1], 'subagents');
        for (const sub of readdirSafe(subdir)) {
          const a = AGENT_FILE_RE.exec(sub);
          if (!a) continue;
          const sst = statSafe(path.join(subdir, sub));
          if (sst && sst.mtimeMs >= m0) this.follow(path.join(subdir, sub), m[1], a[1]);
        }
      }
    }
  }

  // Forget sessions that are neither live nor active today.
  prune(liveIds, now) {
    const m0 = midnight(now);
    for (const [id, s] of this.sessions) {
      if (liveIds.has(id)) continue;
      if ([...s.files].some((f) => f.mtimeMs >= m0)) continue;
      for (const f of s.files) this.files.delete(f.file);
      this.sessions.delete(id);
      this.memo.delete('s:' + id);
      this.version++;
    }
  }

  // Reads appended bytes (up to the budget). Returns true once every file is caught up.
  step() {
    let budget = this.budget;
    let caught = true;
    for (const f of this.files.values()) {
      const st = statSafe(f.file);
      if (!st) continue;
      f.mtimeMs = st.mtimeMs;
      if (st.size < f.offset) this._reset(f);
      if (st.size === f.offset) continue;
      if (budget <= 0) { caught = false; continue; }
      const len = Math.min(st.size - f.offset, budget);
      const buf = readSlice(f.file, f.offset, len);
      if (!buf || !buf.length) continue;
      budget -= buf.length;
      f.offset += buf.length;
      this._ingest(f, buf);
      if (f.offset < st.size) caught = false;
    }
    this.caughtUp = caught;
    return caught;
  }

  _reset(f) {
    const s = this._session(f.sessionId);
    for (const id of f.ids) s.seen.delete(id);
    f.ids.clear();
    f.responses = [];
    f.offset = 0;
    f.carry = null;
    s.version++;
    this.version++;
  }

  _ingest(f, buf) {
    const data = f.carry ? Buffer.concat([f.carry, buf]) : buf;
    let start = 0;
    for (;;) {
      const nl = data.indexOf(10, start);
      if (nl === -1) break;
      if (nl - start > 20) this._line(f, data.subarray(start, nl));
      start = nl + 1;
    }
    f.carry = start < data.length ? Buffer.from(data.subarray(start)) : null;
  }

  _line(f, line) {
    const usage = line.indexOf('"input_tokens"') !== -1; // cheap filter: only usage lines get parsed
    if (!usage && line.indexOf('"cost-state"') === -1) return;
    let o;
    try { o = JSON.parse(line.toString('utf8')); } catch (_) { return; }
    if (!o || typeof o !== 'object') return;
    const s = this._session(f.sessionId);
    if (o.type === 'cost-state') return this._costState(s, o);
    const m = o.message;
    if (!m || typeof m !== 'object' || !m.usage || m.model === '<synthetic>') return;
    if (!s.cwd && typeof o.cwd === 'string') s.cwd = o.cwd;
    const id = m.id || o.requestId;
    if (id) {
      if (s.seen.has(id)) return;
      s.seen.add(id);
      f.ids.add(id);
    }
    const c = costOf(m.model, m.usage);
    f.responses.push({ ts: Date.parse(o.timestamp) || this.now(), model: c.model, tokens: c.tokens.total, cacheRead: c.tokens.cacheRead, cost: c.cost, guessed: c.guessed });
    s.version++;
    this.version++;
  }

  _costState(s, o) {
    if (typeof o.totalCostUSD !== 'number' || typeof o.startTime !== 'number') return;
    const end = o.startTime + num(o.totalDuration);
    const prev = s.runs.get(o.startTime);
    if (prev && prev.end >= end) return;
    const byModel = {};
    let tokens = 0, cacheRead = 0;
    for (const [model, mu] of Object.entries(o.modelUsage || {})) {
      if (!mu || typeof mu !== 'object') continue;
      const t = num(mu.inputTokens) + num(mu.outputTokens) + num(mu.cacheReadInputTokens) + num(mu.cacheCreationInputTokens);
      tokens += t;
      cacheRead += num(mu.cacheReadInputTokens);
      byModel[normalizeModel(model)] = { tokens: t, cost: num(mu.costUSD) };
    }
    s.runs.set(o.startTime, { start: o.startTime, end, cost: o.totalCostUSD, tokens, cacheRead, byModel });
    s.version++;
    this.version++;
  }

  // Responses inside a finished run are already counted by that run's exact total.
  _covered(s, ts, since) {
    for (const r of s.runs.values()) if (r.start >= since && ts >= r.start - 1000 && ts <= r.end + 5000) return true;
    return false;
  }

  // Whole session: exact totals of its finished runs + estimate of the rest.
  sessionUsage(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    const key = 's:' + sessionId;
    const hit = this.memo.get(key);
    if (hit && hit.v === s.version) return hit.u;
    const u = EMPTY();
    for (const r of s.runs.values()) { u.tokens += r.tokens; u.cacheRead += r.cacheRead; u.cost += r.cost; }
    for (const f of s.files) for (const r of f.responses) {
      if (this._covered(s, r.ts, -Infinity)) continue;
      u.tokens += r.tokens; u.cacheRead += r.cacheRead; u.cost += r.cost;
    }
    const out = round(u);
    this.memo.set(key, { v: s.version, u: out });
    return out;
  }

  // One subagent's own responses (estimate).
  fileUsage(file) {
    const f = this.files.get(file);
    if (!f) return null;
    const u = EMPTY();
    for (const r of f.responses) { u.tokens += r.tokens; u.cacheRead += r.cacheRead; u.cost += r.cost; }
    return round(u);
  }

  // Everything spent since local midnight, by project and by model.
  today(now) {
    const m0 = midnight(now);
    const key = 'today:' + m0;
    const hit = this.memo.get(key);
    if (hit && hit.v === this.version) return hit.u;
    const total = EMPTY();
    const byProject = new Map();
    const byModel = new Map();
    const add = (map, k, extra, tokens, cost) => {
      const e = map.get(k) || Object.assign({ tokens: 0, cost: 0 }, extra);
      e.tokens += tokens;
      e.cost += cost;
      map.set(k, e);
    };
    for (const s of this.sessions.values()) {
      const su = EMPTY();
      for (const r of s.runs.values()) {
        if (r.start < m0) continue;
        su.tokens += r.tokens; su.cacheRead += r.cacheRead; su.cost += r.cost;
        for (const [model, mu] of Object.entries(r.byModel)) add(byModel, model, { model }, mu.tokens, mu.cost);
      }
      for (const f of s.files) for (const r of f.responses) {
        if (r.ts < m0 || this._covered(s, r.ts, m0)) continue;
        su.tokens += r.tokens; su.cacheRead += r.cacheRead; su.cost += r.cost;
        add(byModel, r.model, { model: r.model }, r.tokens, r.cost);
      }
      if (!su.tokens && !su.cost) continue;
      total.tokens += su.tokens; total.cacheRead += su.cacheRead; total.cost += su.cost;
      const p = resolveProject(s.cwd, this.home);
      add(byProject, p.projectKey || '?', { project: p.project }, su.tokens, su.cost);
    }
    const list = (map) => [...map.values()]
      .map((e) => Object.assign(e, { tokens: Math.round(e.tokens), cost: Math.round(e.cost * 10000) / 10000 }))
      .sort((a, b) => b.cost - a.cost);
    const out = Object.assign(round(total), { byProject: list(byProject), byModel: list(byModel) });
    this.memo.set(key, { v: this.version, u: out });
    return out;
  }
}

module.exports = { UsageIndex, costOf, tokensOf, normalizeModel, priceFor, PRICES };
