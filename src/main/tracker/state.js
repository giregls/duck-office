'use strict';
// Pure functions: (registry entry, transcript facts) -> the state the renderer shows.
// Priority: registry status (exact, written by Claude Code itself) > transcript tail.

const PERMISSION_RE = /permission|sandbox|approv/i;
const ERROR_TTL_MS = 90 * 1000;

function maxDefined(...values) {
  let best = null;
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v) && (best === null || v > best)) best = v;
  return best;
}

function toolInfo(tx) {
  const t = tx ? tx.latestOpenTool() : null;
  if (!t) return null;
  return { name: t.name, cat: t.cat, label: t.label, since: Math.round(t.since), count: tx.openTools.size };
}

function fromTranscript(tx, now, idleState, fallbackEvidence) {
  const tool = toolInfo(tx);
  if (tool) return { state: tool.cat === 'ask' ? 'input' : 'tool', evidence: tool.since, tool, waitingFor: null };
  const phase = tx ? tx.phase : 'unknown';
  if (phase === 'compacting') return { state: 'compacting', evidence: tx.phaseSince, tool: null, waitingFor: null };
  if (phase === 'error' && now - (tx.phaseSince || 0) < ERROR_TTL_MS) {
    return { state: 'error', evidence: tx.phaseSince, tool: null, waitingFor: null };
  }
  if (phase === 'idle' && idleState) return { state: idleState, evidence: tx.phaseSince, tool: null, waitingFor: null };
  return {
    state: 'thinking',
    evidence: maxDefined(tx && tx.phaseSince, tx && tx.lastToolClosed) || fallbackEvidence,
    tool: null,
    waitingFor: null,
  };
}

// reg: registry entry or null (inferred session); runningSubs: subagents not finished.
function deriveSession(reg, tx, runningSubs, now) {
  if (reg && reg.status === 'waiting') {
    const wf = typeof reg.waitingFor === 'string' ? reg.waitingFor : '';
    return {
      state: PERMISSION_RE.test(wf) ? 'permission' : 'input',
      evidence: reg.statusUpdatedAt,
      tool: toolInfo(tx),
      waitingFor: wf || null,
    };
  }
  if (reg && reg.status === 'idle') return { state: 'done', evidence: reg.statusUpdatedAt, tool: null, waitingFor: null };

  if (!reg) {
    // Inferred from the transcript alone: a finished turn means "waiting for you".
    return fromTranscript(tx, now, runningSubs > 0 ? 'supervising' : 'done', null);
  }
  // Registry says busy (or an unknown status): the transcript tells what kind of work.
  if (tx && tx.phase === 'idle' && !tx.latestOpenTool()) {
    if (runningSubs > 0 || tx.pendingBg > 0) {
      return { state: 'supervising', evidence: tx.phaseSince, tool: null, waitingFor: null };
    }
    // Turn ended in the transcript but the registry is busy again: a new prompt not yet written.
    return { state: 'thinking', evidence: reg.statusUpdatedAt, tool: null, waitingFor: null };
  }
  return fromTranscript(tx, now, null, reg.statusUpdatedAt);
}

function deriveSubagent(sub, now) {
  if (sub.finishedAt) return { state: 'finished', evidence: sub.finishedAt, tool: null, waitingFor: null };
  return fromTranscript(sub.tx, now, null, sub.discoveredAt);
}

module.exports = { deriveSession, deriveSubagent, toolInfo, maxDefined };
