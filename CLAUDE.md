# Duck Office

Electron 44 app (plain CommonJS / classic scripts, no bundler, no framework) showing live
Claude Code sessions as pixel-art ducks in an open space. The user speaks French: UI text is French.

## Layout

- `src/main/main.js` — window (normal / frameless "mini"), tray, IPC, `--capture` screenshot mode.
- `src/main/tracker/` — read-only observer of `~/.claude` → snapshots (contract in `index.js`, formats in `docs/claude-code-format.md`); `usage.js` = tokens & API-equivalent cost (prices table, dedupe by message id, cost-state).
- `src/main/icons.js` — PNG/ICO encoder, icons drawn from the duck sprite.
- `src/renderer/` — classic scripts sharing `globalThis.DO`, loaded in order by `index.html`:
  `palette` → `font` → `sprites` → `office` (map, furniture, seats, stations, sky, weather, seasons, night lights) → `world` (duck behaviour) → `events` (office events: scheduler + catalogue) → `ui` (bubbles, HUD, dialog) → `sim` (demo) → `app` (loop, scaling, input).
- `src/shared/tools.js` — tool name → category + privacy-safe labels (used by tracker and demo).

## Rules

- Never write anything under `~/.claude`; never read `*.key`, `.credentials.json`, the session pipes, and never create `sessions/.fleetview-heartbeat` (it makes every session spend tokens).
- Never display prompts, commands or file contents: titles, file basenames and Bash `description` only.
- All art is code: grids in `sprites.js`, furniture in `office.js`, palette ENDESGA 32 only (`DO.C`). Internal resolution 480x270, integer scaling.
- `world.js` uses the frame clock `now` (never `performance.now()`), so tests can drive it.
- Furniture goes through `furniture()` in `office.js`: it blocks its tiles and its parts are y-sorted with the ducks. Seats are blocked tiles too (only their own duck steps on them). Sprites are lazy (`sprite()`), so `office.js` loads under Node. Animated or seasonal furniture reads `O.dyn` (season, weather, pizza, cake...): the office test draws every season with every extra on.
- `events.js`: up to 3 events at once (`SLOTS`), each slot quiet for 30 s to 1 min after its event, never the same event twice at once or twice in a row (cooldowns per event); decisions use its seeded `st.rng` (cosmetic particles may use `Math.random`). Extras (cat, robot, courier) walk with `DO.world.nav`; idle ducks are borrowed through `duck.event`, read first by `want()`, and must always be released (`finish`/`prune`).
- The elevator (`liftStart`/`liftStep` in `world.js`, shared with the extras): riders wait for the door, step into the cabin, press the button, the door closes; arrivals step out. While `inCabin` they are drawn between the cabin (wall layer) and `drawElevatorDoors`; the door opens while any rider calls it (`liftCalls`).

## Checks

- `npm test` (Node 24, glob form) — tracker + duck behaviour with a fake clock + office map (everything reachable, no furniture painted over walkable floor or over other furniture, walking ducks never cross furniture).
- Visual check: `node_modules/electron/dist/electron.exe . --capture=out.png --demo --no-tracker --hour=14 --seed=7 [--scale=5 --crop=x,y,w,h --select=0 --scenario=hatch|arrive|busy|wait --weather=rain --date=2026-12-24 --event=pizza --event-at=500 --capture-delay=20000]`, then look at the PNG. One capture at a time (parallel ones share a cache folder and hang).
