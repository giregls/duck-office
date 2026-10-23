'use strict';
// Turns a working directory into a display name + a stable key for colouring:
// the git root's folder name when there is one, '~' for the home folder.
const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = new Map();
const SCRATCH_RE = /[\\/](claude|claude-data)[\\/].*[\\/]scratch[\\/]/i;

function normKey(p) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function samePath(a, b) {
  return normKey(path.resolve(a)) === normKey(path.resolve(b));
}

function hasGit(dir) {
  try {
    fs.statSync(path.join(dir, '.git'));
    return true;
  } catch (_) {
    return false;
  }
}

function resolveProject(cwd, home = os.homedir()) {
  if (typeof cwd !== 'string' || !cwd) return { project: '?', projectKey: '?' };
  const hit = cache.get(cwd);
  if (hit) return hit;

  const abs = path.resolve(cwd);
  let result;
  if (samePath(abs, home)) {
    result = { project: '~', projectKey: normKey(abs) };
  } else if (SCRATCH_RE.test(abs)) {
    // Claude Desktop scratch workspaces have unreadable generated names.
    result = { project: 'scratch', projectKey: normKey(abs) };
  } else {
    let root = null;
    let dir = abs;
    for (let i = 0; i < 64; i++) {
      if (samePath(dir, home)) break; // never treat the home folder as a project root
      if (hasGit(dir)) { root = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const base = root || abs;
    result = { project: path.basename(base) || base, projectKey: normKey(base) };
  }
  cache.set(cwd, result);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return result;
}

module.exports = { resolveProject, normKey };
