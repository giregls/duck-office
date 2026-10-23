# Duck Office

Electron 44 app (plain CommonJS / classic scripts, no bundler, no framework) showing live
Claude Code sessions as pixel-art ducks in an open space. The user speaks French: UI text is French.

## Layout

- `src/main/main.js` — window (normal / frameless "mini"), tray, IPC, `--capture` screenshot mode.
- `src/main/tracker/` — read-only observer of `~/.claude` → snapshots (contract in `index.js`, formats in `docs/claude-code-format.md`); `usage.js` = tokens & API-equivalent cost (prices table, dedupe by message id, cost-state).
- `src/main/icons.js` — PNG/ICO encoder, icons drawn from the duck sprite.
- `src/renderer/` — classic scripts sharing `globalThis.DO`, loaded in order by `index.html`:
  `palette` → `font` → `sprites` → `office` (map, furniture, seats, stations) → `world` (duck behaviour) → `ui` (bubbles, HUD, dialog) → `sim` (demo) → `app` (loop, scaling, input).
- `src/shared/tools.js` — tool name → category + privacy-safe labels (used by tracker and demo).

## Rules

- Never write anything under `~/.claude`; never read `*.key`, `.credentials.json`, the session pipes, and never create `sessions/.fleetview-heartbeat` (it makes every session spend tokens).
- Never display prompts, commands or file contents: titles, file basenames and Bash `description` only.
- All art is code: grids in `sprites.js`, furniture in `office.js`, palette ENDESGA 32 only (`DO.C`). Internal resolution 480x270, integer scaling.
- `world.js` uses the frame clock `now` (never `performance.now()`), so tests can drive it.

## Checks

- `npm test` (Node 24, glob form) — tracker + duck behaviour with a fake clock.
- Visual check: `node_modules/electron/dist/electron.exe . --capture=out.png --demo --no-tracker --hour=14 --seed=7 [--scale=5 --crop=x,y,w,h --select=0 --scenario=hatch|arrive]`, then look at the PNG.
