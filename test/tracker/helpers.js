'use strict';
// Synthetic Claude Code files for tests (no real transcript content anywhere).
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duck-tracker-'));
  fs.mkdirSync(path.join(dir, 'sessions'));
  fs.mkdirSync(path.join(dir, 'projects'));
  return dir;
}

function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

let clock = Date.parse('2026-10-23T08:00:00.000Z');
function iso(ms) {
  return new Date(ms === undefined ? (clock += 1000) : ms).toISOString();
}

const base = (sessionId, extra) => ({ sessionId, cwd: 'C:\\work\\demo-project', entrypoint: 'cli', version: '2.1.302', timestamp: iso(), ...extra });

const R = {
  prompt: (sid, text = 'fixture prompt') => ({ type: 'user', ...base(sid), message: { role: 'user', content: text }, origin: { kind: 'human' } }),
  apiRequest: (sid, querySource = 'repl_main_thread') => ({ type: 'api-request', ...base(sid), querySource }),
  toolUse: (sid, id, name, input = {}, extra = {}) => ({
    type: 'assistant', ...base(sid, extra),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' },
  }),
  toolResult: (sid, id, toolUseResult, extra = {}) => ({
    type: 'user', ...base(sid, extra),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
    ...(toolUseResult ? { toolUseResult } : {}),
  }),
  text: (sid, stop = 'end_turn', extra = {}) => ({
    type: 'assistant', ...base(sid, extra), message: { role: 'assistant', content: [{ type: 'text', text: 'fixture answer' }], stop_reason: stop },
  }),
  turnDuration: (sid, pendingBg = 0) => ({ type: 'system', subtype: 'turn_duration', ...base(sid), durationMs: 1000, pendingBackgroundAgentCount: pendingBg }),
  aiTitle: (sid, aiTitle = 'Fixture title') => ({ type: 'ai-title', aiTitle, sessionId: sid }),
  costState: (sid) => ({ type: 'cost-state', sessionId: sid, totalCostUSD: 0 }),
  notification: (sid, taskId, status = 'completed') => ({
    type: 'queue-operation', operation: 'enqueue', timestamp: iso(), sessionId: sid,
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
  }),
};

function lines(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function writeRegistry(claudeDir, pid, fields) {
  const entry = {
    pid, sessionId: fields.sessionId, cwd: 'C:\\work\\demo-project', startedAt: Date.now() - 60000,
    procStart: '1', version: '2.1.302', kind: 'interactive', entrypoint: 'cli', name: 'demo', nameSource: 'derived',
    status: 'busy', updatedAt: Date.now(), statusUpdatedAt: Date.now() - 5000, ...fields,
  };
  fs.writeFileSync(path.join(claudeDir, 'sessions', `${pid}.json`), JSON.stringify(entry));
  return entry;
}

function projectDir(claudeDir, slug = 'C--work-demo-project') {
  const d = path.join(claudeDir, 'projects', slug);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { tmpClaudeDir, rm, R, lines, writeRegistry, projectDir, iso };
