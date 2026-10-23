'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FileTail } = require('../../src/main/tracker/tail');
const { tmpClaudeDir, rm } = require('./helpers');

test('reads appended lines and holds back the incomplete last line', () => {
  const dir = tmpClaudeDir();
  const f = path.join(dir, 't.jsonl');
  try {
    fs.writeFileSync(f, '{"a":1}\n{"a":2}\n{"a":');
    const tail = new FileTail(f);
    assert.deepEqual(tail.poll().lines, ['{"a":1}', '{"a":2}']);
    assert.deepEqual(tail.poll().lines, []);
    fs.appendFileSync(f, '3}\n');
    assert.deepEqual(tail.poll().lines, ['{"a":3}']);
  } finally {
    rm(dir);
  }
});

test('a multi-byte character split across two reads is decoded correctly', () => {
  const dir = tmpClaudeDir();
  const f = path.join(dir, 't.jsonl');
  try {
    const bytes = Buffer.from('{"t":"canard é 🦆"}\n', 'utf8');
    const cut = bytes.indexOf(0xc3) + 1; // middle of "é"
    fs.writeFileSync(f, bytes.subarray(0, cut));
    const tail = new FileTail(f);
    assert.deepEqual(tail.poll().lines, []);
    fs.appendFileSync(f, bytes.subarray(cut));
    assert.deepEqual(tail.poll().lines, ['{"t":"canard é 🦆"}']);
  } finally {
    rm(dir);
  }
});

test('catch-up reads only the tail and drops the partial first line', () => {
  const dir = tmpClaudeDir();
  const f = path.join(dir, 't.jsonl');
  try {
    const all = Array.from({ length: 50 }, (_, i) => `{"n":${i}}`).join('\n') + '\n';
    fs.writeFileSync(f, all);
    const tail = new FileTail(f, { catchupBytes: 40 });
    const got = tail.poll().lines;
    assert.ok(got.length > 0 && got.length < 50);
    for (const l of got) assert.doesNotThrow(() => JSON.parse(l));
    assert.equal(got[got.length - 1], '{"n":49}');
  } finally {
    rm(dir);
  }
});

test('a truncated file is re-read from scratch and reported as reset', () => {
  const dir = tmpClaudeDir();
  const f = path.join(dir, 't.jsonl');
  try {
    fs.writeFileSync(f, '{"a":1}\n{"a":2}\n');
    const tail = new FileTail(f);
    tail.poll();
    fs.writeFileSync(f, '{"b":1}\n');
    const r = tail.poll();
    assert.equal(r.reset, true);
    assert.deepEqual(r.lines, ['{"b":1}']);
  } finally {
    rm(dir);
  }
});

test('a missing file is reported without throwing', () => {
  const tail = new FileTail(path.join(require('os').tmpdir(), 'does-not-exist-duck.jsonl'));
  assert.deepEqual(tail.poll().lines, []);
  assert.equal(tail.missing, true);
});
