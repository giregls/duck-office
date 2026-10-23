'use strict';
// Reads Claude Code's registry of running sessions: ~/.claude/sessions/<pid>.json.
// Read-only. The <pid>.<hash>.key files next to them hold secrets: never opened.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IMAGE_OK = /^(claude|node|bun)(\.exe)?$/i;

// Re-reads only the files whose size or mtime changed. A file that fails to
// parse (caught mid-rewrite) keeps its previous value and is retried next time.
function readRegistry(dir, cache, errors) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return { status: e.code === 'ENOENT' ? 'missing' : 'error', entries: [] };
  }
  const seen = new Set();
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue; // skips *.key, dotfiles, anything else
    seen.add(name);
    const file = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch (_) {
      continue;
    }
    const prev = cache.get(name);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (entry && typeof entry.sessionId === 'string' && Number.isInteger(entry.pid)) {
        cache.set(name, { mtimeMs: st.mtimeMs, size: st.size, entry });
      }
    } catch (_) {
      // Half-written: keep the previous value (if any) and retry on the next poll.
      if (errors) errors(`registry: unreadable ${name}`);
    }
  }
  for (const name of [...cache.keys()]) if (!seen.has(name)) cache.delete(name);
  return { status: 'ok', entries: [...cache.values()].map((c) => c.entry) };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// pidDomain looks like "win32:<host>": entries from another OS/host can't be checked here.
function sameDomain(entry) {
  if (typeof entry.pidDomain !== 'string') return true;
  return entry.pidDomain.split(':')[0] === process.platform;
}

// One `tasklist` call listing image names, used to drop registry files whose PID
// was recycled by an unrelated program. Calls back with Map<pid, image> or null.
function listImages(cb) {
  if (process.platform !== 'win32') return cb(null);
  execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }, (err, out) => {
    if (err || typeof out !== 'string') return cb(null);
    const map = new Map();
    for (const line of out.split(/\r?\n/)) {
      const m = /^"([^"]*)","(\d+)"/.exec(line);
      if (m) map.set(Number(m[2]), m[1]);
    }
    cb(map.size ? map : null);
  });
}

function imageLooksLikeClaude(image) {
  return IMAGE_OK.test(image || '');
}

module.exports = { readRegistry, pidAlive, sameDomain, listImages, imageLooksLikeClaude };
