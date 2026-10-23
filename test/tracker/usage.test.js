'use strict';
// Tokens and API-equivalent cost read from transcripts (synthetic fixtures only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { UsageIndex, costOf, normalizeModel } = require('../../src/main/tracker/usage');
const { tmpClaudeDir, rm, lines, projectDir } = require('./helpers');

const SID = '11111111-2222-3333-4444-555555555555';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

// 15:00 local time today, so that "yesterday" and "today" are easy to build.
const NOW = (() => { const d = new Date(); d.setHours(15, 0, 0, 0); return d.getTime(); })();
const MIDNIGHT = (() => { const d = new Date(NOW); d.setHours(0, 0, 0, 0); return d.getTime(); })();

function reply(id, ts, usage, model = 'claude-opus-5-5', blocks = 1) {
  const out = [];
  for (let i = 0; i < blocks; i++) {
    out.push({
      type: 'assistant', sessionId: SID, cwd: 'C:\\work\\demo-project', timestamp: new Date(ts).toISOString(), requestId: 'req_' + id,
      message: { id: 'msg_' + id, model, role: 'assistant', content: [{ type: 'text', text: 'fixture' }], usage },
    });
  }
  return out;
}

test('prices reproduce Claude Code\'s own cost-state totals', () => {
  // numbers taken from real cost-state records (Opus 1h cache writes, Sonnet 5 min ones)
  near(costOf('claude-opus-5-5', { input_tokens: 1022, output_tokens: 27033, cache_read_input_tokens: 566056, cache_creation_input_tokens: 51872, cache_creation: { ephemeral_1h_input_tokens: 51872, ephemeral_5m_input_tokens: 0 } }).cost, 1.0729352);
  near(costOf('claude-sonnet-5-5', { input_tokens: 334, output_tokens: 251845, cache_read_input_tokens: 20733366, cache_creation_input_tokens: 1040469, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 1040469 } }).cost, 7.1936271);
  // (that Haiku total sums several calls, each under the 100K long-prompt threshold)
  near(
    costOf('claude-haiku-5-5', { input_tokens: 70000, output_tokens: 5000, server_tool_use: { web_search_requests: 6 } }).cost +
    costOf('claude-haiku-5-5', { input_tokens: 71117, output_tokens: 4675, server_tool_use: { web_search_requests: 6 } }).cost,
    0.1389492,
  );
});

test('fast mode, long Haiku prompts, provider ids and unknown models', () => {
  near(costOf('claude-opus-5-5', { input_tokens: 1e6, speed: 'fast' }).cost, 8);
  near(costOf('claude-haiku-5-5', { input_tokens: 150000 }).cost, 0.075);
  assert.equal(normalizeModel('us.anthropic.claude-sonnet-5-5-v1:0'), 'claude-sonnet-5-5');
  assert.equal(normalizeModel('claude-opus-5-5[1m]'), 'claude-opus-5-5');
  const guess = costOf('claude-opus-9-9', { input_tokens: 1e6 });
  assert.equal(guess.guessed, true);
  near(guess.cost, 4);
  const unknown = costOf('mystery-model', { input_tokens: 1e6, output_tokens: 10 });
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.cost, 0);
});

test('a response is counted once, across its lines, folders and subagents', () => {
  const dir = tmpClaudeDir();
  try {
    const p1 = projectDir(dir);
    const p2 = projectDir(dir, 'C--work-moved');
    const u = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000 };
    fs.writeFileSync(path.join(p1, `${SID}.jsonl`), lines([...reply('a', NOW - 60000, u, undefined, 3), ...reply('b', NOW - 30000, u)]));
    fs.writeFileSync(path.join(p2, `${SID}.jsonl`), lines([...reply('a', NOW - 60000, u)])); // copied when the session moved
    const sub = path.join(p1, SID, 'subagents');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'agent-x1.jsonl'), lines(reply('c', NOW - 10000, u, 'claude-haiku-5-5')));
    const idx = new UsageIndex({ now: () => NOW });
    idx.followSession(SID, [p1, p2]);
    assert.equal(idx.step(), true);
    assert.equal(idx.sessionUsage(SID).tokens, 3 * 1110);
    assert.equal(idx.fileUsage(path.join(sub, 'agent-x1.jsonl')).tokens, 1110);
  } finally {
    rm(dir);
  }
});

test('a finished run uses Claude Code\'s exact total; "today" starts at midnight', () => {
  const dir = tmpClaudeDir();
  try {
    const p = projectDir(dir);
    const file = path.join(p, `${SID}.jsonl`);
    const u = { input_tokens: 1000, output_tokens: 1000 }; // $0.024 with Opus 5.5
    const runStart = MIDNIGHT + 3600000;
    fs.writeFileSync(file, lines([
      ...reply('old', MIDNIGHT - 3600000, u), // yesterday
      ...reply('t1', runStart + 1000, u),
      ...reply('t2', runStart + 2000, u),
      { type: 'cost-state', sessionId: SID, totalCostUSD: 5, startTime: runStart, totalDuration: 60000, modelUsage: { 'claude-opus-5-5': { inputTokens: 3000, outputTokens: 4000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 5 } } },
      ...reply('t3', runStart + 7200000, u), // a later run, still going
    ]));
    const idx = new UsageIndex({ now: () => NOW });
    idx.followSession(SID, [p]);
    idx.step();
    const today = idx.today(NOW);
    near(today.cost, 5 + 0.024); // exact finished run + estimate of the live one
    assert.equal(today.tokens, 7000 + 2000);
    near(idx.sessionUsage(SID).cost, 0.024 + 5 + 0.024); // yesterday counts for the session, not for today
    assert.equal(today.byProject.length, 1);
    assert.equal(today.byProject[0].project, 'demo-project');
    assert.deepEqual(today.byModel.map((m) => m.model), ['claude-opus-5-5']);
  } finally {
    rm(dir);
  }
});

test('appended bytes are read incrementally; a half-written line waits', () => {
  const dir = tmpClaudeDir();
  try {
    const p = projectDir(dir);
    const file = path.join(p, `${SID}.jsonl`);
    const u = { input_tokens: 5, output_tokens: 5 };
    const [first] = reply('a', NOW - 1000, u);
    const [second] = reply('b', NOW - 500, u);
    const text = JSON.stringify(second);
    fs.writeFileSync(file, JSON.stringify(first) + '\n' + text.slice(0, 40));
    const idx = new UsageIndex({ now: () => NOW });
    idx.followSession(SID, [p]);
    idx.step();
    assert.equal(idx.sessionUsage(SID).tokens, 10);
    fs.appendFileSync(file, text.slice(40) + '\n');
    idx.step();
    assert.equal(idx.sessionUsage(SID).tokens, 20);
    fs.writeFileSync(file, JSON.stringify(first) + '\n'); // rewritten shorter: start over
    idx.step();
    assert.equal(idx.sessionUsage(SID).tokens, 10);
  } finally {
    rm(dir);
  }
});

test('today\'s transcripts are found even for sessions that are already closed', () => {
  const dir = tmpClaudeDir();
  try {
    const p = projectDir(dir);
    fs.writeFileSync(path.join(p, `${SID}.jsonl`), lines(reply('a', NOW - 1000, { input_tokens: 1e6 })));
    const idx = new UsageIndex({ now: () => NOW });
    idx.discoverToday([p], Date.now());
    idx.step();
    near(idx.today(NOW).cost, 4);
    idx.prune(new Set(), NOW + 2 * 86400000); // two days later, nobody live: forgotten
    assert.equal(idx.sessions.size, 0);
  } finally {
    rm(dir);
  }
});
