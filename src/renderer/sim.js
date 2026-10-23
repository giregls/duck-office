// Demo mode: fake Claude Code sessions and subagents that follow believable
// work cycles, in the exact snapshot format the real tracker produces.
(function (DO) {
  const MIN = 60000;
  const PROJECTS = [
    { project: 'duck-office', titles: ['Dessiner les canetons', 'Corriger le tracker', 'Ajouter le mode mini'] },
    { project: 'site-vitrine', titles: ['Page contact', 'Refonte du header', 'Optimiser les images'] },
    { project: 'api-meteo', titles: ['Migrer vers Postgres', 'Tests d\'intégration', 'Cache Redis'] },
    { project: 'notes', titles: ['Résumé de réunion', 'Plan du trimestre'] },
    { project: 'blog', titles: ['Article sur Rust', 'Corriger le flux RSS'] },
  ];
  const FILES = ['main.js', 'index.html', 'style.css', 'api.ts', 'README.md', 'db.sql', 'App.tsx', 'utils.py', 'config.json'];
  const COMMANDS = ['Lancer les tests', 'Installer les dépendances', 'Compiler le projet', 'git status', 'Démarrer le serveur'];
  const SITES = ['developer.mozilla.org', 'stackoverflow.com', 'docs.python.org', 'github.com'];
  const AGENT_TYPES = [['Explore', 'Explorer le code'], ['Plan', 'Préparer le plan'], ['general-purpose', 'Écrire les tests'], ['Explore', 'Trouver les usages']];

  let rnd = Math.random;
  let sessions = [];
  let subs = [];
  let seq = 0;
  let nextArrival = 0;
  let forceArrival = false;

  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);

  function toolFor(cat, now) {
    const names = { edit: 'Edit', read: 'Read', search: 'Grep', exec: 'Bash', web: 'WebFetch', todo: 'TodoWrite', agent: 'Agent', mcp: 'mcp__notion__search' };
    const label = cat === 'edit' || cat === 'read' ? pick(FILES) : cat === 'exec' ? pick(COMMANDS) : cat === 'web' ? pick(SITES) : cat === 'mcp' ? 'notion' : '';
    return { name: names[cat], cat, label, since: now, count: 1 };
  }

  function makeSession(p, now, state, sinceAgo) {
    const id = 'demo-' + (++seq);
    const s = {
      id: 's:' + id, parentId: null, kind: 'session', sessionId: id,
      project: p.project, projectKey: 'c:/demo/' + p.project, title: pick(p.titles), agentType: null,
      entrypoint: 'cli', state, since: now - (sinceAgo || 0), tool: null, waitingFor: null,
      startedAt: now - (sinceAgo || 0) - 60000, lastActivity: now, todos: null, inferred: false,
      next: now + between(2000, 6000), plan: null,
      spent: { tokens: 0, cacheRead: 0, cost: 0 },
    };
    // what it already spent before the demo started
    spend(s, between(0.4e6, 9e6), 0.46);
    sessions.push(s);
    return s;
  }

  // Fake token use: mostly the cached context read again, at ~0.46 $ per million tokens.
  function spend(o, tokens, rate) {
    o.spent.tokens += tokens;
    o.spent.cacheRead += tokens * 0.9;
    o.spent.cost += (tokens * rate * between(0.7, 1.3)) / 1e6;
  }

  function setState(s, state, now, tool) {
    s.state = state;
    s.since = now;
    s.tool = tool || null;
    s.waitingFor = state === 'permission' ? 'permission prompt' : state === 'input' ? 'input needed' : null;
    s.lastActivity = now;
    if (state === 'tool' || state === 'thinking') spend(s, between(40e3, 220e3), 0.46);
  }

  function spawnSubagents(s, now, n) {
    for (let i = 0; i < n; i++) {
      const [type, desc] = pick(AGENT_TYPES);
      const id = 'sub' + (++seq);
      subs.push({
        id: 'a:' + s.sessionId + ':' + id, parentId: s.id, kind: 'subagent', sessionId: s.sessionId,
        project: s.project, projectKey: s.projectKey, title: desc, agentType: type, entrypoint: 'cli',
        state: 'thinking', since: now, tool: null, waitingFor: null, startedAt: now, lastActivity: now, todos: null,
        next: now + between(1500, 4000), end: now + between(14000, 40000),
        spent: { tokens: 0, cacheRead: 0, cost: 0 },
      });
    }
  }

  // One step of a session's work cycle.
  function advance(s, now) {
    const kids = subs.filter((k) => k.parentId === s.id && k.state !== 'finished');
    switch (s.state) {
      case 'done':
        if (now - s.since > s.waitFor) { setState(s, 'thinking', now); s.next = now + between(2000, 5000); }
        else s.next = now + 1000;
        return;
      case 'permission':
      case 'input':
        setState(s, 'tool', now, toolFor(s.state === 'input' ? 'edit' : pick(['exec', 'edit', 'web']), now));
        s.next = now + between(2000, 8000);
        return;
      case 'tool':
        if (s.tool && s.tool.cat === 'agent' && kids.length && !s.async) { s.next = now + 1000; return; }
        setState(s, 'thinking', now);
        s.next = now + between(1500, 5000);
        return;
      case 'supervising':
        if (kids.length) { s.next = now + 1000; return; }
        setState(s, 'done', now); s.waitFor = between(12000, 50000); s.next = now + 1000;
        return;
      case 'compacting':
      case 'error':
        setState(s, 'thinking', now); s.next = now + between(1500, 4000);
        return;
      default: { // thinking
        const r = rnd();
        if (r < 0.14) {
          if (kids.length) { setState(s, 'supervising', now); s.next = now + 1000; }
          else { setState(s, 'done', now); s.waitFor = between(12000, 50000); s.next = now + 1000; }
          return;
        }
        if (r < 0.24) { setState(s, 'permission', now, toolFor(pick(['exec', 'edit']), now)); s.next = now + between(5000, 14000); return; }
        if (r < 0.27) { setState(s, 'compacting', now); s.next = now + between(4000, 7000); return; }
        if (r < 0.29) { setState(s, 'error', now); s.next = now + 3000; return; }
        if (s.forceAgent || (r < 0.36 && !kids.length)) {
          s.forceAgent = false;
          setState(s, 'tool', now, toolFor('agent', now));
          s.async = rnd() < 0.5;
          spawnSubagents(s, now + 1500, 1 + Math.floor(rnd() * 3));
          s.next = now + (s.async ? 3500 : 6000);
          return;
        }
        const cat = pick(['edit', 'edit', 'read', 'read', 'search', 'exec', 'exec', 'web', 'todo', 'mcp']);
        const dur = { edit: [2000, 6000], read: [1500, 9000], search: [1500, 8000], exec: [2000, 25000], web: [5000, 12000], todo: [2500, 5000], mcp: [2000, 5000] }[cat];
        setState(s, 'tool', now, toolFor(cat, now));
        if (cat === 'todo') { // ticks one or two more items; a full list starts a new one
          const t = s.todos;
          s.todos = !t || t.done >= t.total ? { done: 0, total: 3 + Math.floor(rnd() * 3) } : { done: Math.min(t.total, t.done + 1 + Math.floor(rnd() * 2)), total: t.total };
        }
        s.next = now + between(dur[0], dur[1]) * (cat === 'exec' && rnd() < 0.15 ? 3 : 1);
      }
    }
  }

  function advanceSub(k, now) {
    if (now > k.end && k.state !== 'finished') { k.state = 'finished'; k.since = now; k.tool = null; k.next = now + 8000; return; }
    if (k.state === 'finished') { k.gone = true; return; }
    if (k.state === 'tool') { k.state = 'thinking'; k.since = now; k.tool = null; k.next = now + between(1000, 3000); return; }
    k.state = 'tool';
    k.since = now;
    k.tool = toolFor(pick(['read', 'read', 'search', 'edit', 'exec', 'web']), now);
    k.next = now + between(1500, 6000);
    spend(k, between(20e3, 90e3), 0.3);
  }

  // scenario (screenshots only): 'hatch' = a duck briefs ducklings at once,
  // 'arrive' = a new duck takes the elevator right away.
  function start(now, seed, scenario) {
    rnd = seed ? DO.rng(seed) : Math.random;
    forceArrival = scenario === 'arrive';
    sessions = [];
    subs = [];
    seq = 0;
    const [duck, site, api, notes, blog] = PROJECTS;
    const s1 = makeSession(duck, now, 'tool', 4000); s1.tool = toolFor('edit', now - 3000); s1.tool.label = 'world.js';
    spawnSubagents(s1, now - 5000, 2); s1.async = true;
    subs.forEach((k, i) => { k.state = 'tool'; k.tool = toolFor(i ? 'read' : 'search', now - 2000); });
    const s2 = makeSession(duck, now, 'permission', 9000); s2.tool = toolFor('exec', now - 9000); s2.waitingFor = 'permission prompt';
    const s3 = makeSession(site, now, 'tool', 6000); s3.tool = toolFor('web', now - 6000);
    const s4 = makeSession(site, now, 'done', 40000); s4.waitFor = 60000;
    const s5 = makeSession(api, now, 'tool', 20000); s5.tool = toolFor('exec', now - 20000); s5.tool.label = 'Lancer les tests';
    const s6 = makeSession(api, now, 'done', 9 * MIN); s6.waitFor = 12 * MIN;
    const s7 = makeSession(notes, now, 'done', 35 * MIN); s7.waitFor = 50 * MIN;
    const s8 = makeSession(blog, now, 'thinking', 2000);
    s5.next = now + 30000;
    s6.next = now + 1000; s7.next = now + 1000;
    if (scenario === 'hatch') { s8.next = now + 600; s8.forceAgent = true; s8.async = false; }
    if (scenario === 'wait') {
      // everybody waits for you, standing on their desks: shows both sides of the islands
      sessions.forEach((s, i) => {
        setState(s, i % 2 ? 'input' : 'permission', now - 1000, i % 2 ? null : toolFor('exec', now - 1000));
        s.next = now + 10 * MIN;
      });
    }
    if (scenario === 'busy') {
      // everybody at their desk: shows both seating directions
      sessions.forEach((s, i) => {
        if (i % 2) setState(s, 'tool', now - 1000, toolFor(['edit', 'exec', 'read', 'edit'][i % 4], now - 1000));
        else setState(s, 'thinking', now - 1000);
        s.next = now + 60000;
      });
    }
    nextArrival = now + (forceArrival ? 1200 : 70000);
  }

  function snapshot(now) {
    for (const s of sessions) if (now >= s.next) advance(s, now);
    for (const k of subs) if (now >= k.next) advanceSub(k, now);
    for (const k of subs.filter((x) => x.gone)) { // a finished duckling's tokens stay on its parent's bill
      const p = sessions.find((s) => s.id === k.parentId);
      if (p) for (const f of ['tokens', 'cacheRead', 'cost']) p.spent[f] += k.spent[f];
    }
    subs = subs.filter((k) => !k.gone);
    // occasionally someone arrives, or an idle session leaves
    if (now > nextArrival) {
      nextArrival = now + between(60000, 110000);
      if (forceArrival || (sessions.length < 10 && rnd() < 0.7)) {
        forceArrival = false;
        const s = makeSession(pick(PROJECTS), now, 'thinking', 0);
        s.next = now + 3000;
      } else {
        const idle = sessions.filter((s) => s.state === 'done' && !subs.some((k) => k.parentId === s.id));
        if (idle.length > 1) sessions = sessions.filter((s) => s !== idle[0]);
      }
    }
    const round = (u) => ({ tokens: Math.round(u.tokens), cacheRead: Math.round(u.cacheRead), cost: Math.round(u.cost * 10000) / 10000 });
    const FIELDS = ['id', 'parentId', 'kind', 'sessionId', 'project', 'projectKey', 'title', 'agentType', 'entrypoint', 'state', 'since', 'waitingFor', 'startedAt', 'lastActivity', 'todos', 'inferred'];
    const clean = (o, usage) => {
      const out = {};
      for (const f of FIELDS) out[f] = o[f] === undefined ? null : o[f];
      out.tool = o.tool ? Object.assign({}, o.tool) : null;
      out.usage = round(usage || o.spent);
      return out;
    };
    // a session's bill includes its live ducklings
    const billOf = (s) => {
      const u = Object.assign({}, s.spent);
      for (const k of subs) if (k.parentId === s.id) for (const f of ['tokens', 'cacheRead', 'cost']) u[f] += k.spent[f];
      return u;
    };
    return {
      now, live: false, demo: true,
      agents: [...sessions.map((s) => clean(s, billOf(s))), ...subs.map((k) => clean(k))],
      health: { registry: 'ok', tailed: 0, errors: [] },
      usage: { today: today(sessions.map((s) => [s, billOf(s)])), partial: false },
    };
  }

  // The day's totals: open sessions + sessions closed earlier in the day.
  const EARLIER = [['duck-office', 6.1e6, 2.9], ['site-vitrine', 3.2e6, 1.35], ['notes', 0.9e6, 0.41]];
  function today(bills) {
    const byProject = new Map();
    const add = (project, tokens, cost) => {
      const e = byProject.get(project) || { project, tokens: 0, cost: 0 };
      e.tokens += tokens; e.cost += cost;
      byProject.set(project, e);
    };
    for (const [p, t, c] of EARLIER) add(p, t, c);
    for (const [s, u] of bills) add(s.project, u.tokens, u.cost);
    const list = [...byProject.values()].map((e) => ({ project: e.project, tokens: Math.round(e.tokens), cost: Math.round(e.cost * 100) / 100 })).sort((a, b) => b.cost - a.cost);
    const tokens = list.reduce((n, e) => n + e.tokens, 0);
    const cost = list.reduce((n, e) => n + e.cost, 0);
    const byModel = [['claude-opus-5-5', 0.88], ['claude-sonnet-5-5', 0.09], ['claude-haiku-5-5', 0.03]]
      .map(([model, share]) => ({ model, tokens: Math.round(tokens * share), cost: Math.round(cost * share * 100) / 100 }));
    return { tokens, cacheRead: Math.round(tokens * 0.9), cost: Math.round(cost * 100) / 100, byProject: list, byModel };
  }

  DO.sim = { start, snapshot };
})(globalThis.DO = globalThis.DO || {});
