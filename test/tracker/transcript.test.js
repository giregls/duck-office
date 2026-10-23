'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TranscriptState } = require('../../src/main/tracker/transcript');
const { R } = require('./helpers');

const SID = '11111111-2222-3333-4444-555555555555';

function feed(tx, records) {
  for (const r of records) tx.ingestLine(JSON.stringify(r));
  return tx;
}

test('tool calls open and close; the latest open call wins', () => {
  const tx = feed(new TranscriptState(), [
    R.prompt(SID),
    R.apiRequest(SID),
    R.toolUse(SID, 'toolu_a', 'Read', { file_path: 'C:\\secret\\dir\\main.js' }),
    R.toolUse(SID, 'toolu_b', 'Bash', { command: 'npm test --silent', description: 'Run the tests' }),
  ]);
  assert.equal(tx.openTools.size, 2);
  const t = tx.latestOpenTool();
  assert.equal(t.name, 'Bash');
  assert.equal(t.cat, 'exec');
  assert.equal(t.label, 'Run the tests');
  feed(tx, [R.toolResult(SID, 'toolu_b'), R.toolResult(SID, 'toolu_a')]);
  assert.equal(tx.openTools.size, 0);
  assert.equal(tx.phase, 'thinking');
});

test('labels never contain paths', () => {
  const tx = feed(new TranscriptState(), [R.toolUse(SID, 'toolu_a', 'Edit', { file_path: 'C:\\Users\\x\\private\\notes.md' })]);
  assert.equal(tx.latestOpenTool().label, 'notes.md');
});

test('turn_duration ends the turn and keeps the background agent count', () => {
  const tx = feed(new TranscriptState(), [R.prompt(SID), R.text(SID), R.turnDuration(SID, 2)]);
  assert.equal(tx.phase, 'idle');
  assert.equal(tx.pendingBg, 2);
});

test('end_turn alone (older format without turn_duration) ends the turn', () => {
  const tx = feed(new TranscriptState(), [R.prompt(SID), R.text(SID, 'end_turn')]);
  assert.equal(tx.phase, 'idle');
});

test('compaction and side queries', () => {
  const tx = feed(new TranscriptState(), [R.prompt(SID), R.apiRequest(SID, 'compact')]);
  assert.equal(tx.phase, 'compacting');
  feed(tx, [R.turnDuration(SID), R.apiRequest(SID, 'title_generation')]);
  assert.equal(tx.phase, 'idle', 'side queries do not mean the agent works');
});

test('interruption clears open tools', () => {
  const tx = feed(new TranscriptState(), [
    R.toolUse(SID, 'toolu_a', 'Bash', { command: 'sleep 100' }),
    { type: 'user', sessionId: SID, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
  ]);
  assert.equal(tx.openTools.size, 0);
  assert.equal(tx.phase, 'idle');
});

test('async agent launches, sync agent results and task notifications are recorded', () => {
  const tx = feed(new TranscriptState(), [
    R.toolUse(SID, 'toolu_async', 'Agent', { description: 'Explore', subagent_type: 'Explore', prompt: 'p' }),
    R.toolResult(SID, 'toolu_async', { isAsync: true, status: 'async_launched', agentId: 'abc123', prompt: 'p' }),
    R.toolUse(SID, 'toolu_sync', 'Task', { description: 'Plan', prompt: 'p' }),
    R.toolResult(SID, 'toolu_sync', { status: 'completed', agentId: 'def456' }),
    R.notification(SID, 'abc123', 'completed'),
  ]);
  assert.equal(tx.asyncAgents.get('toolu_async'), 'abc123');
  assert.ok(tx.syncDoneToolUseIds.has('toolu_sync'));
  assert.ok(!tx.syncDoneToolUseIds.has('toolu_async'));
  assert.ok(tx.finishedTaskIds.has('abc123'));
});

test('titles, todos and the cost-state end marker', () => {
  const tx = feed(new TranscriptState(), [
    R.aiTitle(SID, 'AI title'),
    { type: 'custom-title', customTitle: 'Custom title', sessionId: SID },
    R.toolUse(SID, 'toolu_t', 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }, { content: 'c', status: 'pending' }] }),
    R.toolResult(SID, 'toolu_t'),
    R.costState(SID),
  ]);
  assert.equal(tx.title(), 'Custom title');
  assert.deepEqual(tx.todos, { done: 1, total: 3 });
  assert.equal(tx.ended, true);
  feed(tx, [R.prompt(SID)]);
  assert.equal(tx.ended, false, 'a resumed session is alive again');
});

test('sidechain lines inside a main transcript are ignored; garbage lines are survived', () => {
  const tx = new TranscriptState();
  tx.ingestLine('{"type":"assistant", broken');
  tx.ingestLine(JSON.stringify(R.toolUse(SID, 'toolu_side', 'Bash', {}, { isSidechain: true })));
  tx.ingestLine('{"type":"api-request-blob","message":{"content":[{"type":"tool_use","id":"x","name":"Bash"}]}}');
  assert.equal(tx.openTools.size, 0);
  assert.equal(tx.badLines, 1);
});
