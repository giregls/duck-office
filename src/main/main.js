// Electron main process: the window (normal or mini), the tray icon, the live
// tracker of Claude Code agents, and a screenshot mode used for checks.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const icons = require('./icons');
const { createTracker } = require('./tracker');

const SRC = path.join(__dirname, '..');
const argv = parseArgs(process.argv.slice(1));
const CAPTURE = typeof argv.capture === 'string' ? path.resolve(argv.capture) : null;

function parseArgs(list) {
  const out = {};
  for (const a of list) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

let win = null;
let tray = null;
let tracker = null;
let latest = null;
let mode = argv.mini ? 'mini' : 'normal';
let demo = !!argv.demo;
let switching = false;
let attention = { work: 0, waiting: 0, done: 0, idle: 0 };
let state = {};

const APP_ID = 'DuckOffice.App';
app.setAppUserModelId(APP_ID);
if (CAPTURE) app.setPath('userData', path.join(app.getPath('temp'), 'duck-office-capture'));
else if (!app.requestSingleInstanceLock()) app.exit(0);

// ------------------------------------------------------------ persisted window state
const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (_) { return {}; }
}
function saveState() {
  if (CAPTURE) return;
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch (_) { /* not critical */ }
}

function onSomeScreen(b) {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y < a.y + a.height - 40 && b.y + 20 > a.y;
  });
}

// Window sizes are whole multiples of the 480x270 pixel-art screen, in device pixels.
function initialBounds(m) {
  const saved = state[m];
  if (saved && onSomeScreen(saved)) return saved;
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  const sf = d.scaleFactor || 1;
  if (m === 'mini') {
    const k = (480 * 2) / sf <= wa.width * 0.34 ? 2 : 1;
    const width = Math.round((480 * k) / sf), height = Math.round((270 * k) / sf);
    return { width, height, x: wa.x + wa.width - width - 12, y: wa.y + wa.height - height - 12 };
  }
  let k = 1;
  while ((480 * (k + 1)) / sf <= wa.width * 0.9 && (270 * (k + 1)) / sf <= wa.height * 0.85) k++;
  const width = Math.round((480 * k) / sf), height = Math.round((270 * k) / sf);
  return { width, height, x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2) };
}

// ------------------------------------------------------------ window
function createWindow() {
  const mini = mode === 'mini';
  const b = initialBounds(mode);
  const ico = icons.writeIco(path.join(app.getPath('userData'), 'duck.ico'));
  const w = new BrowserWindow({
    ...b,
    useContentSize: true,
    frame: !mini,
    maximizable: !mini,
    fullscreenable: !mini,
    alwaysOnTop: mini || !!state.alwaysOnTop,
    skipTaskbar: false,
    backgroundColor: '#181425',
    title: titleOf(attention),
    icon: ico,
    show: false,
    autoHideMenuBar: true,
    minWidth: 240,
    minHeight: 150,
    webPreferences: {
      preload: path.join(SRC, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: !CAPTURE,
    },
  });
  win = w;
  if (mini) w.setAlwaysOnTop(true, 'floating');
  w.removeMenu();
  w.on('page-title-updated', (e) => e.preventDefault()); // the title shows the waiting count
  if (process.platform === 'win32') {
    // "Pin to taskbar" must relaunch Duck Office, not bare electron.exe
    w.setAppDetails({
      appId: APP_ID,
      appIconPath: ico,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}" "${app.getAppPath()}"`,
      relaunchDisplayName: 'Duck Office',
    });
  }
  w.loadFile(path.join(SRC, 'renderer', 'index.html'), {
    query: {
      mode,
      demo: demo ? '1' : '',
      capture: CAPTURE ? '1' : '',
      hour: argv.hour !== undefined ? String(argv.hour) : '',
      seed: argv.seed !== undefined ? String(argv.seed) : '',
      scenario: typeof argv.scenario === 'string' ? argv.scenario : '',
    },
  });
  w.once('ready-to-show', () => { if (!CAPTURE) w.show(); });
  const remember = () => {
    if (w.isDestroyed() || w.isMinimized() || w.isMaximized() || w.isFullScreen()) return;
    const [width, height] = w.getContentSize();
    const [x, y] = w.getPosition();
    state[mode] = { x, y, width, height };
    saveState();
  };
  w.on('resized', remember);
  w.on('moved', remember);
  w.on('focus', () => w.flashFrame(false));
  w.on('closed', () => {
    if (win !== w) return;
    win = null;
    if (!switching) app.quit();
  });
  if (CAPTURE || argv.debug) {
    // surface page errors in the terminal when checking renders
    w.webContents.on('console-message', (e, level, message, line, source) => {
      const msg = typeof message === 'string' ? message : e.message;
      const lvl = typeof level === 'number' ? level : e.level;
      if (lvl === 'warning' || lvl === 'error' || lvl >= 2) console.log('[page]', msg, source || e.sourceId || '', line || e.lineNumber || '');
    });
  }
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  return w;
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function switchMode(m) {
  if (m === mode || !win) return;
  const old = win;
  mode = m;
  state.mode = m;
  saveState();
  switching = true;
  createWindow();
  old.destroy();
  switching = false;
  win.once('ready-to-show', () => win && win.show());
  refreshTray();
}

// ------------------------------------------------------------ tray
function tooltip() {
  const a = attention;
  const parts = [`${a.work} au travail`];
  if (a.waiting + a.done) parts.push(`${a.waiting + a.done} t'attend${a.waiting + a.done > 1 ? 'ent' : ''}`);
  if (a.idle) parts.push(`${a.idle} en pause`);
  const today = latest && latest.usage && latest.usage.today;
  if (today && today.cost) parts.push(`env. ${today.cost.toFixed(2).replace('.', ',')} $ aujourd'hui`);
  return 'Duck Office — ' + parts.join(' · ');
}

let lastTooltip = '';
function refreshTooltip() {
  const t = tooltip();
  if (!tray || t === lastTooltip) return;
  lastTooltip = t;
  tray.setToolTip(t);
}

const trayImages = {};
function trayImage(alert) {
  const k = alert ? 'alert' : 'normal';
  return trayImages[k] || (trayImages[k] = icons.trayImage(nativeImage, alert));
}

function refreshTray() {
  if (!tray) return;
  tray.setImage(trayImage(attention.waiting > 0));
  refreshTooltip();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir Duck Office', click: showWindow },
    { type: 'separator' },
    { label: 'Fenêtre normale', type: 'radio', checked: mode === 'normal', click: () => switchMode('normal') },
    { label: 'Mode mini (toujours devant)', type: 'radio', checked: mode === 'mini', click: () => switchMode('mini') },
    {
      label: 'Toujours au premier plan', type: 'checkbox', checked: mode === 'mini' || !!state.alwaysOnTop, enabled: mode === 'normal',
      click: (item) => { state.alwaysOnTop = item.checked; saveState(); if (win) win.setAlwaysOnTop(item.checked); },
    },
    {
      label: 'Mode démo (faux canards)', type: 'checkbox', checked: demo,
      click: (item) => { demo = item.checked; if (win) win.webContents.send('command', { type: 'demo', on: demo }); },
    },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.on('click', showWindow);
  refreshTray();
}

// ------------------------------------------------------------ messages from the page
ipcMain.on('ready', (e) => {
  if (latest) e.sender.send('snapshot', latest);
  if (CAPTURE) {
    setTimeout(() => {
      if (!win) return;
      if (argv.select !== undefined) win.webContents.send('command', { type: 'select', index: Number(argv.select) || 0 });
      if (argv.bilan) win.webContents.send('command', { type: 'bilan' });
      const crop = typeof argv.crop === 'string' ? argv.crop.split(',').map(Number) : null;
      const shoot = () => win && win.webContents.send('command', { type: 'capture', scale: Number(argv.scale) || 3, crop });
      // --frames=N: N captures in a row (for the README animation)
      const frames = Math.max(1, Number(argv.frames) || 1);
      setTimeout(() => {
        shoot();
        for (let i = 1; i < frames; i++) setTimeout(shoot, i * (Number(argv['frame-interval']) || 120));
      }, argv.select !== undefined ? 2500 : 0);
    }, Number(argv['capture-delay']) || 4000);
  }
});
ipcMain.on('set-mode', (_e, m) => switchMode(m === 'mini' ? 'mini' : 'normal'));
ipcMain.on('demo-changed', (_e, on) => { demo = !!on; refreshTray(); });
ipcMain.on('quit', () => app.quit());

// ------------------------------------------------------------ "who is waiting for you"
// Computed here from the live snapshots (not by the page): it keeps working while the
// window is minimised, and the demo's fake ducks never raise real alerts.
const MIN = 60000;
let attentionKey = '';
function attentionOf(snap) {
  const now = Date.now();
  const a = { work: 0, waiting: 0, done: 0, idle: 0 };
  for (const ag of (snap && snap.agents) || []) {
    if (ag.kind !== 'session') continue;
    if (ag.state === 'permission' || ag.state === 'input') a.waiting++;
    else if (ag.state === 'done') { if (now - ag.since < 5 * MIN) a.done++; else a.idle++; }
    else a.work++;
  }
  return a;
}
const titleOf = (a) => (a.waiting + a.done ? `(${a.waiting + a.done}) Duck Office` : 'Duck Office');
function updateAttention() {
  const info = attentionOf(latest);
  const key = JSON.stringify(info);
  if (key === attentionKey) return;
  attentionKey = key;
  const before = attention.waiting;
  attention = info;
  if (win) {
    win.setTitle(titleOf(info));
    if (info.waiting > before && !win.isFocused()) win.flashFrame(true);
    if (!info.waiting) win.flashFrame(false);
  }
  refreshTray();
}
let captured = 0;
ipcMain.on('capture-result', (_e, url) => {
  if (!CAPTURE) return;
  const frames = Math.max(1, Number(argv.frames) || 1);
  const file = frames > 1 ? CAPTURE.replace(/(\.png)?$/i, `-${String(captured).padStart(3, '0')}.png`) : CAPTURE;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(String(url).split(',')[1], 'base64'));
  if (++captured >= frames) app.quit();
});

// ------------------------------------------------------------ live data
function startTracker() {
  tracker = createTracker({
    log: (level, msg) => { if (level === 'error' || level === 'warn') console.warn('[tracker]', msg); },
  });
  tracker.on('snapshot', (snap) => {
    latest = snap;
    if (win && !win.isDestroyed()) win.webContents.send('snapshot', snap);
    updateAttention();
    refreshTooltip();
  });
  tracker.start();
  setInterval(updateAttention, 15000); // "done" turns into "idle" after 5 min
}

// ------------------------------------------------------------ lifecycle
app.on('second-instance', showWindow);
app.whenReady().then(() => {
  state = loadState();
  if (state.mode && !argv.mini && !argv.normal && !CAPTURE) mode = state.mode;
  Menu.setApplicationMenu(null);
  createWindow();
  if (!CAPTURE) createTray();
  if (!argv['no-tracker']) startTracker();
});
app.on('before-quit', () => { if (tracker) tracker.stop(); });
app.on('window-all-closed', () => app.quit());
