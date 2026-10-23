'use strict';
// Folds Claude Code transcript records (one JSON object per line) into the few
// facts the office needs: open tool calls, model phase, titles, todos and the
// signals that tell when subagents are done. Never keeps message contents.
const { categorize, labelFor } = require('../../shared/tools');

// Big or useless record types, skipped before JSON.parse.
const SKIP_PREFIXES = [
  '{"type":"api-request-blob"',
  '{"type":"api-request-shape"',
  '{"type":"file-history',
  '{"type":"last-prompt"',
  '{"type":"atis-latch"',
  '{"type":"mode"',
  '{"type":"permission-mode"',
];

// api-request.querySource values that mean "this agent is calling the model".
// Other sources are side queries (titles, summaries…) and say nothing about work.
const WORK_QUERY = /^(repl_main_thread|agent:|sdk|main|print)/;
const COMPACT_QUERY = /compact/i;

const END_STOPS = new Set(['end_turn', 'stop_sequence', 'refusal']);
const DONE_STATUSES = /^(completed|failed|killed|stopped|cancelled|canceled|error|timeout|timed_out)$/i;
const NOTIFICATION_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const MAX_IDS = 500;

function parseTs(s) {
  if (typeof s !== 'string') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function isLocalCommand(text) {
  return /^\s*<(local-command|command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr)/.test(text);
}

function addBounded(set, value) {
  set.add(value);
  if (set.size > MAX_IDS) set.delete(set.values().next().value);
}

class TranscriptState {
  constructor({ subagent = false } = {}) {
    this.subagent = subagent;
    this.openTools = new Map(); // tool_use id -> { id, name, cat, label, since, seq }
    this.phase = 'unknown';     // 'thinking' | 'idle' | 'compacting' | 'error' | 'unknown'
    this.phaseSince = null;
    this.lastToolClosed = null;
    this.pendingBg = 0;         // pendingBackgroundAgentCount of the last finished turn
    this.aiTitle = null;
    this.customTitle = null;
    this.agentName = null;
    this.summaryTitle = null;
    this.todos = null;
    this.taskTodos = null;      // approximation for the TaskCreate/TaskUpdate tools
    this.cwd = null;
    this.entrypoint = null;
    this.version = null;
    this.firstTs = null;
    this.lastTs = null;
    this.ended = false;         // last significant record is a cost-state (process exited)
    this.endsTurn = false;      // subagent: a tool result with toolEndsTurn (hand-back)
    this.finishedTaskIds = new Set();    // task/agent ids reported done by task-notifications
    this.syncDoneToolUseIds = new Set(); // Agent/Task tool_use ids that returned synchronously
    this.asyncAgents = new Map();        // tool_use id -> agentId for background launches
    this.records = 0;
    this.badLines = 0;
    this._seq = 0;
  }

  ingestLine(line) {
    for (const p of SKIP_PREFIXES) if (line.startsWith(p)) return;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      this.badLines++;
      return;
    }
    if (o && typeof o === 'object') this.ingest(o);
  }

  ingest(o) {
    this.records++;
    const ts = parseTs(o.timestamp);
    if (ts !== null) {
      if (this.lastTs === null || ts > this.lastTs) this.lastTs = ts;
      if (this.firstTs === null || ts < this.firstTs) this.firstTs = ts;
    }
    if (typeof o.cwd === 'string' && o.cwd) this.cwd = o.cwd;
    if (typeof o.entrypoint === 'string' && o.entrypoint) this.entrypoint = o.entrypoint;
    if (typeof o.version === 'string' && o.version) this.version = o.version;

    // Old transcript format kept sidechain (subagent) lines in the main file.
    if (!this.subagent && o.isSidechain === true) return;

    switch (o.type) {
      case 'assistant': this._assistant(o, ts); this.ended = false; break;
      case 'user': this._user(o, ts); this.ended = false; break;
      case 'system': this._system(o, ts); break;
      case 'api-request': this._apiRequest(o, ts); this.ended = false; break;
      case 'queue-operation': if (typeof o.content === 'string') this._notifications(o.content); break;
      case 'ai-title': if (typeof o.aiTitle === 'string') this.aiTitle = o.aiTitle; break;
      case 'custom-title': if (typeof o.customTitle === 'string') this.customTitle = o.customTitle; break;
      case 'agent-name': if (typeof o.agentName === 'string') this.agentName = o.agentName; break;
      case 'summary': if (typeof o.summary === 'string') this.summaryTitle = o.summary; break;
      case 'cost-state': this.ended = true; break;
      default: break;
    }
  }

  _setPhase(phase, ts) {
    if (this.phase !== phase) {
      this.phase = phase;
      this.phaseSince = ts || Date.now();
    }
  }

  _assistant(o, ts) {
    const m = o.message || {};
    const content = Array.isArray(m.content) ? m.content : [];
    for (const b of content) {
      if (!b || b.type !== 'tool_use' || !b.id) continue;
      const name = typeof b.name === 'string' ? b.name : '?';
      const input = b.input && typeof b.input === 'object' ? b.input : {};
      this.openTools.set(b.id, {
        id: b.id,
        name,
        cat: categorize(name),
        label: labelFor(name, input),
        since: ts || Date.now(),
        seq: ++this._seq,
      });
      this._trackTodos(name, input);
    }
    if (o.isApiErrorMessage) {
      this._setPhase('error', ts);
      return;
    }
    if (END_STOPS.has(m.stop_reason) && this.openTools.size === 0) {
      this._setPhase('idle', ts);
    } else if (this.phase === 'unknown' || this.phase === 'error') {
      this._setPhase('thinking', ts);
    }
  }

  _trackTodos(name, input) {
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      const total = input.todos.length;
      const done = input.todos.filter((t) => t && t.status === 'completed').length;
      this.todos = { done, total };
    } else if (name === 'TaskCreate') {
      const t = this.taskTodos || (this.taskTodos = { created: 0, done: new Set() });
      t.created++;
      this.todos = { done: Math.min(t.done.size, t.created), total: t.created };
    } else if (name === 'TaskUpdate' && input.taskId !== undefined) {
      const t = this.taskTodos || (this.taskTodos = { created: 0, done: new Set() });
      if (input.status === 'completed') t.done.add(String(input.taskId));
      else t.done.delete(String(input.taskId));
      const total = Math.max(t.created, t.done.size);
      this.todos = { done: t.done.size, total };
    }
  }

  _user(o, ts) {
    const m = o.message || {};
    const c = m.content;
    let sawResult = false;
    let sawText = false;
    let interrupted = false;
    if (Array.isArray(c)) {
      for (const b of c) {
        if (!b) continue;
        if (b.type === 'tool_result' && b.tool_use_id) {
          sawResult = true;
          this._closeTool(b.tool_use_id, o.toolUseResult, ts);
        } else if (b.type === 'text' && typeof b.text === 'string') {
          sawText = true;
          if (b.text.startsWith('[Request interrupted')) interrupted = true;
          if (b.text.includes('<task-notification>')) this._notifications(b.text);
        }
      }
    } else if (typeof c === 'string') {
      sawText = true;
      if (c.startsWith('[Request interrupted')) interrupted = true;
      if (c.includes('<task-notification>')) this._notifications(c);
    }
    if (o.toolEndsTurn === true) this.endsTurn = true;

    if (interrupted) {
      this.openTools.clear();
      this._setPhase('idle', ts);
      return;
    }
    if (sawResult) {
      this._setPhase('thinking', ts);
      return;
    }
    if (sawText && !o.isMeta && !(typeof c === 'string' && isLocalCommand(c))) {
      // A prompt (human, peer message or task notification) starts a model turn.
      this._setPhase('thinking', ts);
    }
  }

  _closeTool(id, result, ts) {
    const tool = this.openTools.get(id);
    this.openTools.delete(id);
    this.lastToolClosed = ts || Date.now();
    const r = result && typeof result === 'object' ? result : null;
    const isAgent = tool ? tool.cat === 'agent' : !!(r && (r.agentId || r.isAsync !== undefined));
    if (!isAgent) return;
    if (r && r.status === 'async_launched') {
      if (typeof r.agentId === 'string') this.asyncAgents.set(id, r.agentId);
      if (this.asyncAgents.size > MAX_IDS) this.asyncAgents.delete(this.asyncAgents.keys().next().value);
    } else {
      addBounded(this.syncDoneToolUseIds, id);
    }
  }

  _notifications(text) {
    NOTIFICATION_RE.lastIndex = 0;
    let m;
    while ((m = NOTIFICATION_RE.exec(text))) {
      const body = m[1];
      const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(body);
      const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(body);
      if (id && (!status || DONE_STATUSES.test(status[1]))) addBounded(this.finishedTaskIds, id[1]);
    }
  }

  _system(o, ts) {
    switch (o.subtype) {
      case 'turn_duration':
        this.openTools.clear();
        this.pendingBg = Number(o.pendingBackgroundAgentCount) || 0;
        this._setPhase('idle', ts);
        this.ended = false;
        break;
      case 'stop_hook_summary':
        if (this.openTools.size === 0 && this.phase !== 'unknown') this._setPhase('idle', ts);
        break;
      case 'compact_boundary':
        this._setPhase('thinking', ts);
        break;
      case 'api_error':
        this._setPhase('error', ts);
        break;
      default:
        break;
    }
  }

  _apiRequest(o, ts) {
    const qs = typeof o.querySource === 'string' ? o.querySource : '';
    if (COMPACT_QUERY.test(qs)) this._setPhase('compacting', ts);
    else if (!qs || WORK_QUERY.test(qs)) this._setPhase('thinking', ts);
  }

  latestOpenTool() {
    let best = null;
    for (const t of this.openTools.values()) if (!best || t.seq > best.seq) best = t;
    return best;
  }

  title() {
    return this.customTitle || this.aiTitle || this.agentName || this.summaryTitle || null;
  }
}

module.exports = { TranscriptState, parseTs };
