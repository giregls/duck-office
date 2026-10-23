// Shared between the main process (require) and the renderer (classic <script>).
// Maps Claude Code tool names to the categories the office understands, and
// builds short, privacy-safe labels (never prompts, commands or file contents).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DO = root.DO || {};
  root.DO.tools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CATEGORY = {
    Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
    Read: 'read', NotebookRead: 'read',
    Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
    Bash: 'exec', PowerShell: 'exec', BashOutput: 'exec', KillShell: 'exec', KillBash: 'exec',
    Monitor: 'exec', TaskOutput: 'exec', TaskStop: 'exec',
    WebFetch: 'web', WebSearch: 'web',
    Agent: 'agent', Task: 'agent', SendMessage: 'agent',
    TodoWrite: 'todo', TaskCreate: 'todo', TaskUpdate: 'todo', TaskList: 'todo',
    EnterPlanMode: 'todo', ExitPlanMode: 'todo',
    AskUserQuestion: 'ask',
  };

  const CATEGORIES = ['edit', 'read', 'search', 'exec', 'web', 'agent', 'todo', 'ask', 'mcp', 'other'];

  function categorize(name) {
    if (!name) return 'other';
    if (CATEGORY[name]) return CATEGORY[name];
    if (name.startsWith('mcp__')) return 'mcp';
    return 'other';
  }

  function short(text, max) {
    if (typeof text !== 'string') return '';
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
  }

  function basename(p) {
    if (typeof p !== 'string') return '';
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  // Short label shown next to a duck. Deliberately avoids anything that could
  // leak private content: file names only, never paths, commands or patterns.
  function labelFor(name, input) {
    input = input || {};
    const cat = categorize(name);
    if (cat === 'edit' || cat === 'read') return short(basename(input.file_path || input.notebook_path || input.path), 28);
    if (name === 'Bash' || name === 'PowerShell') {
      if (input.description) return short(input.description, 28);
      const cmd = typeof input.command === 'string' ? input.command.trim().split(/\s+/)[0] : '';
      return short(basename(cmd), 20);
    }
    if (name === 'WebFetch') {
      try { return short(new URL(input.url).hostname.replace(/^www\./, ''), 28); } catch (_) { return ''; }
    }
    if (cat === 'agent') return short(input.description || input.subagent_type || '', 28);
    if (cat === 'mcp') return short(name.split('__')[1] || '', 20);
    if (name === 'Skill') return short(input.skill || input.command || '', 20);
    return '';
  }

  return { categorize, labelFor, CATEGORIES };
});
