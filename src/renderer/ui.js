// Speech bubbles, name tags, the bottom HUD and the old-school RPG dialog box.
(function (DO) {
  const C = DO.C, S = DO.sprites, F = DO.font, O = DO.office;
  const W = 480, H = 270, HUD_Y = O.MAP_H;
  const MIN = 60000;

  const ui = {
    hoverId: null, selectedId: null, dialogT0: 0, chips: [], toast: null, help: false, demo: false, live: false, bootAt: Date.now(),
    usage: null, // snapshot.usage: tokens & cost of the day
    bilan: false, // the day's token report is open
    costChip: null,
  };

  const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + String(m % 60).padStart(2, '0');
  }

  function actionText(a, now) {
    const t = a.tool;
    const lbl = t && t.label ? t.label : '';
    switch (a.state) {
      case 'thinking': return 'Réfléchit…';
      case 'tool':
        switch (t && t.cat) {
          case 'edit': return 'Écrit ' + (lbl || 'du code');
          case 'read': return 'Lit ' + (lbl || 'des fichiers');
          case 'search': return 'Fouille dans le code';
          case 'exec': return 'Lance ' + (lbl ? '« ' + lbl + ' »' : 'une commande');
          case 'web': return 'Cherche sur le web' + (lbl ? ' : ' + lbl : '');
          case 'agent': return 'Briefe un caneton' + (lbl ? ' : ' + lbl : '');
          case 'todo': return 'Met à jour sa liste';
          case 'ask': return 'Te pose une question';
          case 'mcp': return 'Utilise ' + (lbl || 'un outil');
          default: return 'Utilise ' + ((t && t.name) || 'un outil');
        }
      case 'permission': return 'Attend ta permission' + (t ? ' (' + t.name + ')' : '');
      case 'input': return 'Attend ta réponse';
      case 'done':
        if (now - a.since > 20 * MIN) return 'Fait la sieste';
        if (now - a.since > 5 * MIN) return 'En pause';
        return 'A fini, à toi de jouer !';
      case 'supervising': return 'Surveille ses canetons';
      case 'compacting': return 'Range sa mémoire';
      case 'error': return 'Oups, une erreur (nouvel essai)';
      case 'finished': return 'Mission terminée';
      default: return '';
    }
  }

  function projectLabel(a) {
    return a.project === '~' ? 'Dossier perso' : a.project || 'Projet';
  }

  // 1234 -> "1,2 k", 76800000 -> "76,8 M" (French decimal comma)
  function fmtTokens(n, tight) {
    const sp = tight ? '' : ' ';
    const one = (v) => (v < 100 ? v.toFixed(1).replace('.', ',').replace(/,0$/, '') : String(Math.round(v)));
    if (!n || n < 1000) return String(Math.round(n || 0));
    if (n < 1e6) return one(n / 1e3) + sp + 'k';
    if (n < 1e9) return one(n / 1e6) + sp + 'M';
    return one(n / 1e9) + sp + 'G';
  }

  function fmtCost(c, tight) {
    const sp = tight ? '' : ' ';
    if (!c || c < 0.005) return '0' + sp + '$';
    if (c < 1000) return c.toFixed(2).replace('.', ',') + sp + '$';
    return String(Math.round(c)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + sp + '$';
  }

  // claude-opus-5-5 -> "Opus 5.5", claude-3-5-haiku -> "Haiku 3.5"
  function modelName(id) {
    let m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(id || '');
    if (m) return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
    m = /^claude-(\d+)-(\d+)-([a-z]+)/.exec(id || '');
    if (m) return m[3][0].toUpperCase() + m[3].slice(1) + ' ' + m[1] + '.' + m[2];
    return id || '?';
  }

  function usageLine(u, withCache) {
    if (!u || (!u.tokens && !u.cost)) return null;
    const cache = withCache && u.cacheRead > u.tokens * 0.3 ? ' (dont ' + fmtTokens(u.cacheRead) + ' en cache)' : '';
    return 'Tokens ' + fmtTokens(u.tokens) + cache + ' · env. ' + fmtCost(u.cost);
  }

  // ------------------------------------------------------------ bubbles
  function drawBubble(g, x, y, iconName, ink, opts) {
    // 12x11 box with cut corners and a 3px tail pointing down at x
    const bx = Math.round(x - 6), by = Math.round(y - 14 + (opts.bob || 0));
    const fill = opts.fill || C.white;
    R(g, bx + 1, by, 10, 1, C.black); R(g, bx + 1, by + 10, 10, 1, C.black);
    R(g, bx, by + 1, 1, 9, C.black); R(g, bx + 11, by + 1, 1, 9, C.black);
    R(g, bx + 1, by + 1, 10, 9, fill);
    R(g, bx + 5, by + 11, 2, 1, C.black); R(g, bx + 5, by + 10, 2, 1, fill); P(g, bx + 6, by + 12, C.black);
    g.drawImage(S.icon(iconName, ink, C.cyan), bx + 2, by + 2);
  }
  function P(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }

  const baseIcon = (n) => (n ? n.replace(/^dots\d$/, 'dots').replace(/^gear_[ab]$/, 'gear') : n);

  function drawOverlays(g, now) {
    const ents = DO.world.entities();
    for (const e of ents) {
      if (!e.head) continue;
      const ic = DO.world.iconFor(e, now);
      const key = ic ? baseIcon(ic.name) : null;
      if (key !== e.iconName) { e.iconName = key; e.iconSince = now; }
      if (!ic) continue;
      const hovered = ui.hoverId === e.id || ui.selectedId === e.id;
      const fresh = now - e.iconSince < 2500;
      const x = e.head.x, y = e.head.y;
      if (e.kind === 'duckling') {
        if (!(fresh || hovered || ic.name === 'scroll' || ic.name === 'excl' || ic.name === 'check')) continue;
        g.drawImage(S.iconOutlined(ic.name, ic.ink === C.navy ? C.white : ic.ink, C.black), x - 5, y - 11);
        continue;
      }
      if (ic.urgent || (fresh && !ic.small) || hovered) {
        const bob = ic.blink ? (Math.floor(now / 250) % 2 ? -1 : 0) : ic.urgent && !ic.soft ? (Math.floor(now / 500) % 2 ? -1 : 0) : 0;
        const fill = ic.blink && Math.floor(now / 250) % 2 ? C.yellow : C.white;
        drawBubble(g, x, y, ic.name, ic.ink, { bob, fill });
        if (ic.blink) drawRing(g, e, now);
      } else if (e.backSeat) {
        g.drawImage(S.iconOutlined(ic.name, ic.ink === C.navy ? C.white : ic.ink, C.black), x + 8, y - 6);
      } else {
        g.drawImage(S.iconOutlined(ic.name, ic.ink === C.navy ? C.white : ic.ink, C.black), x - 5, y - 11);
      }
    }
    // name tag of the hovered duck
    const h = ui.hoverId && DO.world.get(ui.hoverId);
    if (h && h.head && h.agent && ui.selectedId !== h.id) {
      const a = h.agent;
      const cost = a.usage && a.usage.cost >= 0.005 ? ' · ' + fmtCost(a.usage.cost) : '';
      const text = h.kind === 'duckling'
        ? F.fit((a.agentType || 'Caneton') + ' · ' + (a.title || ''), 150) + cost
        : F.fit(projectLabel(a) + ' · ' + (a.title || ''), 170) + cost;
      const w = F.measure(text) + 6;
      let tx = Math.round(h.head.x - w / 2);
      tx = Math.max(2, Math.min(W - w - 2, tx));
      const ty = Math.max(2, h.head.y - 24);
      R(g, tx, ty, w, 9, C.black);
      R(g, tx + 1, ty + 1, w - 2, 7, C.navy);
      F.draw(g, text, tx + 3, ty + 2, C.white);
    }
  }

  function drawRing(g, e, now) {
    // pulsing floor ring under a duck that needs permission
    const r = 7 + (Math.floor(now / 200) % 3);
    const cx = Math.round(e.rect.x + 8), cy = Math.round(e.rect.y + 16);
    g.fillStyle = Math.floor(now / 250) % 2 ? C.hot : C.gold;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(ang) * r), Math.round(cy + Math.sin(ang) * r * 0.4), 1, 1);
    }
  }

  // ------------------------------------------------------------ HUD
  function drawHud(g, now, info) {
    R(g, 0, HUD_Y, W, H - HUD_Y, C.black);
    R(g, 0, HUD_Y, W, 1, C.slate);
    const s = DO.world.summary(now);
    let x = 4;
    const y = HUD_Y + 4;
    const seg = (icon, ink, text, col) => {
      g.drawImage(S.icon(icon, ink, ink), x, y - 2);
      x += 10;
      x += F.draw(g, text, x, y, col) + 7;
    };
    seg('gear_a', C.lime, s.work + ' au travail', C.silver);
    const urgent = s.wait > 0;
    seg('excl', urgent && Math.floor(now / 400) % 2 ? C.hot : C.gold, (s.wait + s.done) + ' t\'attend' + (s.wait + s.done > 1 ? 'ent' : ''), urgent ? C.yellow : C.silver);
    seg('zz', C.grey, s.idle + ' en pause', C.grey);
    if (s.kids) seg('egg', C.cream, s.kids + ' caneton' + (s.kids > 1 ? 's' : ''), C.grey);

    // right side, from the edge: clock, demo badge, tokens & cost of the day
    const date = info.date;
    const clock = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    let rx = W - 4 - F.measure(clock);
    F.draw(g, clock, rx, y, C.silver);
    rx -= 6;
    if (ui.demo) {
      rx -= 23;
      R(g, rx, HUD_Y + 2, 23, 10, C.magenta);
      F.draw(g, 'DEMO', rx + 2, y, C.white);
      rx -= 5;
    }
    ui.costChip = null;
    const today = ui.usage && ui.usage.today;
    if (today) {
      const text = fmtTokens(today.tokens, true) + ' · ' + fmtCost(today.cost, true) + (ui.usage.partial ? '…' : '');
      const w = F.measure(text) + 13;
      rx -= w;
      if (ui.bilan) R(g, rx - 1, HUD_Y + 1, w + 2, 12, C.slate);
      g.drawImage(S.icon('coin', C.gold, C.yellow), rx, y - 2);
      F.draw(g, text, rx + 11, y, ui.bilan ? C.yellow : C.cream);
      ui.costChip = { x: rx - 1, y: HUD_Y + 1, w: w + 2, h: 12 };
      rx -= 6;
    }

    // chips for ducks waiting for you, oldest first
    ui.chips = [];
    let cx = Math.max(x + 4, 250);
    for (const d of s.waiting) {
      const a = d.agent;
      const label = F.norm(projectLabel(a)).replace(/[^A-Z0-9]/g, '').slice(0, 5) + ' ' + Math.max(0, Math.floor((now - a.since) / MIN)) + 'M';
      const w = F.measure(label) + 14;
      if (cx + w > rx) break;
      const perm = a.state === 'permission' || a.state === 'input';
      const bg = perm ? (Math.floor(now / 400) % 2 ? C.wine : C.red) : C.slate;
      R(g, cx, HUD_Y + 2, w, 10, bg);
      g.drawImage(S.duck('front_a', d.breed, false), 3, 1, 10, 8, cx + 1, HUD_Y + 3, 10, 8);
      F.draw(g, label, cx + 12, HUD_Y + 4, C.white);
      ui.chips.push({ x: cx, y: HUD_Y + 2, w, h: 10, id: d.id });
      cx += w + 3;
    }
  }

  // ------------------------------------------------------------ the day's token report
  function drawBilan(g) {
    if (!ui.bilan) return;
    const u = ui.usage && ui.usage.today;
    const bw = 320, x = Math.round((W - bw) / 2);
    const rows = [];
    const row = (left, mid, right, col) => rows.push({ left, mid, right, col });
    if (!u) row('Pas encore de chiffres', '', '', C.silver);
    else {
      row('Total', fmtTokens(u.tokens) + ' tokens', fmtCost(u.cost), C.white);
      row('', '', '', null);
      for (const p of u.byProject.slice(0, 6)) row(projectLabel(p), fmtTokens(p.tokens), fmtCost(p.cost), C.silver);
      if (u.byProject.length > 6) row('… et ' + (u.byProject.length - 6) + ' autres', '', '', C.grey);
      row('', '', '', null);
      row(u.byModel.slice(0, 3).map((m) => modelName(m.model) + ' ' + fmtCost(m.cost)).join(' · '), '', '', C.grey);
    }
    const h = 34 + rows.length * 9 + 14;
    const y = Math.max(4, Math.round((O.MAP_H - h) / 2));
    R(g, x, y, bw, h, C.black);
    R(g, x + 1, y + 1, bw - 2, h - 2, C.white);
    R(g, x + 2, y + 2, bw - 4, h - 4, C.black);
    R(g, x + 3, y + 3, bw - 6, h - 6, C.grey);
    R(g, x + 4, y + 4, bw - 8, h - 8, C.navy);
    g.drawImage(S.icon('coin', C.gold, C.yellow), x + 9, y + 8);
    F.draw(g, 'Tokens du jour' + (ui.usage && ui.usage.partial ? ' (calcul en cours…)' : ''), x + 21, y + 10, C.yellow);
    F.draw(g, 'Estimation au tarif de l\'API Anthropic', x + 21, y + 19, C.grey);
    rows.forEach((r, i) => {
      if (!r.col) return;
      const ry = y + 32 + i * 9;
      F.draw(g, F.fit(r.left, r.mid ? 150 : bw - 20), x + 10, ry, r.col);
      if (r.mid) F.draw(g, r.mid, x + 230 - F.measure(r.mid), ry, r.col);
      if (r.right) F.draw(g, r.right, x + bw - 10 - F.measure(r.right), ry, r.col === C.white ? C.yellow : r.col);
    });
    F.draw(g, 'Les appels faits en coulisses ne sont pas tous journalises', x + 10, y + h - 12, C.steel);
  }

  // ------------------------------------------------------------ dialog box
  function wrap(text, maxW) {
    const words = F.norm(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (F.measure(t) > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawDialog(g, now) {
    const e = ui.selectedId && DO.world.get(ui.selectedId);
    if (!e || !e.agent) { ui.selectedId = null; return; }
    const a = e.agent;
    // open the box on the half of the office where the duck isn't
    const bw = 300, bh = 61, bx = Math.round((W - bw) / 2);
    const by = e.head && e.head.y > 140 ? 36 : HUD_Y - bh - 4;
    // double border, EarthBound style
    R(g, bx, by, bw, bh, C.black);
    R(g, bx + 1, by + 1, bw - 2, bh - 2, C.white);
    R(g, bx + 2, by + 2, bw - 4, bh - 4, C.black);
    R(g, bx + 3, by + 3, bw - 6, bh - 6, C.grey);
    R(g, bx + 4, by + 4, bw - 8, bh - 8, C.navy);
    // portrait
    R(g, bx + 7, by + 7, 38, 38, C.slate);
    R(g, bx + 8, by + 8, 36, 36, C.deep);
    if (e.kind === 'duckling') g.drawImage(S.duckling('front', e.breed, false), bx + 11, by + 11, 30, 30);
    else {
      g.drawImage(S.duck('front_a', e.breed, false), bx + 10, by + 10, 32, 32);
      if (e.hat) g.drawImage(S.hat(e.hat, 0), bx + 10, by + 10 + S.HATS[e.hat].dy * 2, 32, S.hat(e.hat, 0).height * 2);
    }
    const tx = bx + 51, maxW = bw - 60;
    const title = e.kind === 'duckling'
      ? 'Caneton ' + (a.agentType || '') + ' · ' + (a.title || '')
      : projectLabel(a) + ' · ' + (a.title || '');
    const lines = [];
    lines.push({ text: F.fit(title, maxW), col: C.yellow });
    for (const l of wrap('> ' + actionText(a, now), maxW).slice(0, 2)) lines.push({ text: l, col: C.white });
    const extra = [];
    if (a.state !== 'finished') extra.push('Depuis ' + duration(now - a.since));
    if (e.kind === 'duck') {
      const kids = [...DO.world.ducklings.values()].filter((d) => d.parentId === e.id && !d.leaving).length;
      if (kids) extra.push(kids + ' caneton' + (kids > 1 ? 's' : ''));
      if (a.todos && a.todos.total) extra.push('Tâches ' + a.todos.done + '/' + a.todos.total);
      if (a.entrypoint && a.entrypoint !== 'cli' && a.entrypoint !== 'unknown') extra.push(a.entrypoint.replace('claude-', ''));
    } else {
      const p = DO.world.get(e.parentId);
      if (p) extra.push('Cane : ' + projectLabel(p.agent));
    }
    lines.push({ text: F.fit(extra.join(' · '), maxW), col: C.silver });
    const spent = usageLine(a.usage, e.kind === 'duck');
    if (spent) lines.push({ text: F.fit(spent, maxW), col: C.gold });
    // typewriter reveal
    let budget = Math.floor((now - ui.dialogT0) / 14);
    lines.forEach((l, i) => {
      if (budget <= 0) return;
      const shown = l.text.slice(0, budget);
      budget -= l.text.length;
      F.draw(g, shown, tx, by + 8 + i * 9, l.col);
    });
    if (budget > 0 && Math.floor(now / 400) % 2) {
      R(g, bx + bw - 12, by + bh - 9, 5, 1, C.white); R(g, bx + bw - 11, by + bh - 8, 3, 1, C.white); P(g, bx + bw - 10, by + bh - 7, C.white);
    }
  }

  // ------------------------------------------------------------ empty office, toast, help
  function drawPanel(g, lines, y) {
    const w = Math.max(...lines.map((l) => F.measure(l.text))) + 16;
    const h = lines.length * 9 + 9;
    const x = Math.round((W - w) / 2);
    R(g, x, y, w, h, C.black);
    R(g, x + 1, y + 1, w - 2, h - 2, C.white);
    R(g, x + 2, y + 2, w - 4, h - 4, C.navy);
    lines.forEach((l, i) => F.draw(g, l.text, Math.round((W - F.measure(l.text)) / 2), y + 6 + i * 9, l.col || C.white));
  }

  function drawNotices(g, now) {
    const s = DO.world.summary(now);
    // (wait for the tracker's first real picture before calling the office empty)
    if (!s.total && !ui.demo && (ui.live || now - ui.bootAt > 4000)) {
      drawPanel(g, [
        { text: 'Aucun agent Claude Code en cours', col: C.yellow },
        { text: 'Lance une session : son canard arrivera par l\'ascenseur', col: C.silver },
        { text: 'D = mode démo · H = aide', col: C.grey },
      ], 110);
    }
    if (ui.help) {
      drawPanel(g, [
        { text: 'Duck Office', col: C.yellow },
        { text: 'Clic sur un canard : ce qu\'il fait', col: C.white },
        { text: 'D : mode démo   M : mode mini', col: C.white },
        { text: 'C : tokens et coût du jour', col: C.white },
        { text: 'Échap : fermer   H : cette aide', col: C.white },
        { text: '! = attend ta permission   ? = à toi de jouer', col: C.silver },
      ], 70);
    }
    if (ui.toast && now < ui.toast.until) drawPanel(g, [{ text: ui.toast.text, col: C.yellow }], 40);
  }

  // ------------------------------------------------------------ input
  function pick(x, y) {
    const c0 = ui.costChip;
    if (c0 && x >= c0.x && x < c0.x + c0.w && y >= c0.y && y < c0.y + c0.h) return { cost: true };
    for (const c of ui.chips) if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) return { chip: c.id };
    const e = DO.world.hitTest(x, y);
    return e ? { entity: e.id } : null;
  }

  function onMove(x, y) {
    const p = pick(x, y);
    ui.hoverId = p && p.entity ? p.entity : null;
    return !!p;
  }

  function onClick(x, y, now) {
    const p = pick(x, y);
    ui.help = false;
    if (p && p.cost) { ui.bilan = !ui.bilan; ui.selectedId = null; return; }
    ui.bilan = false;
    const id = p ? p.entity || p.chip : null;
    if (id && id !== ui.selectedId) { ui.selectedId = id; ui.dialogT0 = now; }
    else ui.selectedId = null;
  }

  function toast(text, now) { ui.toast = { text, until: now + 2200 }; }

  DO.ui = Object.assign(ui, { drawOverlays, drawHud, drawDialog, drawNotices, drawBilan, onMove, onClick, toast, actionText, duration, fmtTokens, fmtCost, modelName });
})(globalThis.DO = globalThis.DO || {});
