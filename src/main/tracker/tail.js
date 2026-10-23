'use strict';
// Incremental reader for append-only JSONL files that another process is writing.
// - first poll reads only the last `catchupBytes` (dropping the first, partial line)
// - next polls read only the new bytes, from a saved offset
// - splits on '\n' bytes before UTF-8 decoding, keeps the incomplete last line for later
// - if the file shrinks (rewritten/truncated) it starts over and reports `reset: true`
// Files are opened, read and closed on every poll: no handle is kept, so Claude Code
// can keep appending, rotating or deleting them.
const fs = require('fs');

const MAX_PENDING = 8 * 1024 * 1024; // give up on absurdly long lines
const MAX_READ = 4 * 1024 * 1024;    // never read more than this in one poll

class FileTail {
  constructor(file, { catchupBytes = 512 * 1024 } = {}) {
    this.file = file;
    this.catchupBytes = catchupBytes;
    this.offset = null;    // null until the first (catch-up) read
    this.pending = null;   // Buffer with an incomplete trailing line
    this.skipToNewline = false;
    this.size = 0;
    this.mtimeMs = 0;
    this.missing = false;
  }

  // Returns { lines: string[], reset: boolean, changed: boolean }.
  poll() {
    let st;
    try {
      st = fs.statSync(this.file);
    } catch (_) {
      this.missing = true;
      return { lines: [], reset: false, changed: false };
    }
    this.missing = false;
    const changed = st.size !== this.size || st.mtimeMs !== this.mtimeMs;
    this.size = st.size;
    this.mtimeMs = st.mtimeMs;

    let reset = false;
    if (this.offset !== null && st.size < this.offset) {
      // Truncated or replaced: start over from the tail.
      this.offset = null;
      this.pending = null;
      this.skipToNewline = false;
      reset = true;
    }

    if (this.offset === null) {
      const start = Math.max(0, st.size - this.catchupBytes);
      this.skipToNewline = start > 0;
      const lines = this._read(start, st.size);
      return { lines, reset, changed: true };
    }
    if (st.size === this.offset) return { lines: [], reset, changed };

    let start = this.offset;
    if (st.size - start > MAX_READ) {
      // Fell far behind (huge burst): jump ahead instead of parsing megabytes.
      start = st.size - MAX_READ;
      this.pending = null;
      this.skipToNewline = true;
    }
    return { lines: this._read(start, st.size), reset, changed: true };
  }

  _read(start, end) {
    const len = end - start;
    this.offset = end;
    if (len <= 0) return [];
    const buf = Buffer.allocUnsafe(len);
    let got = 0;
    let fd;
    try {
      fd = fs.openSync(this.file, 'r');
      while (got < len) {
        const n = fs.readSync(fd, buf, got, len - got, start + got);
        if (n <= 0) break;
        got += n;
      }
    } catch (_) {
      this.offset = start; // retry on next poll
      return [];
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* ignore */ }
    }

    let data = buf.subarray(0, got);
    if (got < len) this.offset = start + got;
    if (this.pending) {
      data = Buffer.concat([this.pending, data]);
      this.pending = null;
    }

    const lines = [];
    let from = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0x0a) continue;
      if (this.skipToNewline) {
        this.skipToNewline = false; // drop the partial first line
      } else if (i > from) {
        lines.push(data.toString('utf8', from, i));
      }
      from = i + 1;
    }
    if (from < data.length) {
      const rest = data.subarray(from);
      if (rest.length > MAX_PENDING) {
        this.pending = null;
        this.skipToNewline = true;
      } else {
        this.pending = Buffer.from(rest); // copy: don't pin the big read buffer
      }
    }
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.length > 0);
  }
}

module.exports = { FileTail };
