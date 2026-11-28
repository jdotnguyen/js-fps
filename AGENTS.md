# Repository Guidelines

## Project Structure & Module Organization

Thalassa is a browser FPS built with Three.js, TypeScript, and Vite. `src/main.ts` wires the game together. Gameplay and simulation live in `src/game/`, `src/actors/`, and `src/ai/`. Level construction and the modular kit live in `src/world/`, authored data in `src/data/`, and presentation in `src/render/`, `src/ui/`, and `src/audio/`. Tests sit alongside the modules they cover. Runtime assets live in `public/assets/`, and asset utilities live in `scripts/`.

Check `openspec/specs/` (OpenSpec) before changing architectural decisions. Follow `docs/audio-assets.md` when adding or replacing sounds, and `docs/imported-props.md` when adding a downloaded 3D prop. Follow `docs/mocap-sources.md` when adding motion capture, and review character motion in the cast motion sandbox (`docs/cast-motion-sandbox.md`). Follow `docs/modular-grid-standard.md` and `docs/surface-dressing-standard.md` when editing levels, and `docs/voice-casting-standard.md` when adding or regenerating dialogue VO. Read `docs/physics.md` before touching `src/physics/` or anything that creates physical bodies. Record third-party asset attribution in `CREDITS.md`.

## Where Things Live

Edit the file that owns what you are working on, so agents on different work stay out of each other's way.

| Work | Where |
| --- | --- |
| A room: layout (cells, floor, wall and ceiling finishes, extra pieces), props, lights, atmosphere, water, NPCs, anchors, walks, spawns, triggers | `src/data/levels/slice01/rooms/<id>.json` (for example `R02.json`) |
| Doors and vents, which span two rooms | `src/data/levels/slice01/doors.json` |
| The level: room list and order, player and squad starts, pickups, map stations, checkpoints | `src/data/levels/slice01/level.json` |
| A scene sequence | `src/data/sequences/<scene>.json` |
| Code that belongs to one scene of a level (the Lab B floor breaking), not a mechanism any room can use | `src/world/setpieces/<name>.ts`, listed in `index.ts` there. `src/world/level.ts` names no room or scene (a test checks) |
| A named character: body model, own poses, motion profile, motion-capture pack (written by `scripts/bake-mocap.mjs`) | `src/data/cast/<name>/`: `body.json`, `poses.json`, `motion.json`, `mocap.json`, each where the character has one |
| A creature: profile and poses (`docs/blade-creature.md`, `docs/creature-rig.md`) | `src/data/creatures/<id>/`: `creature.json`, `poses.json` |
| Poses more than one character uses | `src/data/poses/<family>.json` (sit, lean, corpse, kill and so on) |
| Generic crew and infected body models, and which crew look wears which | `src/data/body-models.json`, `src/actors/castLooks.ts` |
| The default motion of unnamed crew | `src/data/motion-crew.json` |
| Sounds, one file per area (`docs/audio-assets.md`). A new area is also listed in `index.ts` there | `src/audio/sounds/<area>.ts` |

Read a level in tests and tools with `readLevel` (`src/data/levels/readLevel.ts`), not by opening its files. No script writes the level files. A room's floors, walls and ceilings are built from its `layout` when the level loads (`docs/modular-grid-standard.md`).

A new pose, body or motion file is also listed in `src/data/poseFiles.ts`, `src/data/bodyModelFiles.ts` or `src/data/motionFiles.ts`. A pose name or model id used in two files fails loading.

## Build, Test, and Development Commands

Use Node.js 22.6 or later for the test runner.

- `npm ci` installs dependencies from the lockfile.
- `npm run dev` starts Vite for local playtesting.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm test` runs the colocated unit tests, at most 4 files at a time (`TEST_CONCURRENCY` changes that). `npm test -- <file>` runs only the files given.
- `npm run build` type-checks and bundles the game into `dist/`.
- `npm run preview` serves the production build locally.
- `npm run playtest:serve` builds and serves a private copy for browser testing (see Shared Machine).

## Shared Machine

Several agents often work in this repository on one PC at the same time, and on 2026-11-20 they filled its RAM. Node.js alone reached about 25 GB. Keep your footprint small:

- Browser-test your own copy of the game, never a shared dev server, which reloads every page whenever any agent saves a file. Ports 5173 and 4300 are the player's.
- Run `npm run playtest:serve` in the background and wait for the URL it prints (ports 4180-4183). It serves a production build of the current tree, where `?debug`, `?slot=scratch` and `?memprobe` work. A failed build may be another agent's half-saved file, so retry.
- That copy is frozen: after changing source or assets, stop it and run it again.
- Stop your own server when done with `npm run playtest:serve -- stop <port>`; it also stops itself after 30 minutes. With all four slots busy it waits for one. Don't start another kind of server to get around the wait.
- The build leaves out the sandbox pages (`sandbox/*.html`, `voices.html`) and can't serve `/src/...` imports. Only for those, run your own dev server (`npx vite --port 5200`, use the URL it prints), keep it from reloading your page (in an init script, stub `WebSocket` connections whose protocol includes `vite`), and stop it when done.
- Use your own headless browser. If the Playwright MCP says the browser is already in use, launch one through `playwright-core`.
- Close every browser, tab and Playwright session you open once you are done with it. Each game tab holds about 1.5-2 GB.
- While iterating, run the test files you touched (`npm test -- src/world/collision.test.ts`), not the whole suite. The level tests take 400 MB-1.1 GB each.
- Leave `TEST_CONCURRENCY` at its default. Raise it only for a solo run when no other agent is active.
- For memory measurements, open the game with `?slot=scratch&memprobe` so the player's saves are never touched (spec `runtime-memory`).

## Coding Style & Naming Conventions

Match nearby TypeScript. Use two-space indentation, single quotes, and semicolons. Use camelCase for functions, variables, and most module filenames, and PascalCase for classes and types. Preserve explicit `.ts` extensions on local TypeScript imports and use type-only imports where appropriate. Use `npm run typecheck` for static checks. The package defines no separate lint or formatting script.

## Testing Guidelines

Use Node's built-in `node:test` runner and `node:assert/strict`. Place tests next to the relevant code as `<module>.test.ts`, such as `src/world/collision.test.ts`. Run `npm test` before opening a pull request. The repository defines no numeric coverage threshold. For changes to visuals, input, or gameplay, also exercise the affected path in the browser using `docs/PLAYTEST.md` as a reference.

## Commit & Pull Request Guidelines

Use concise, descriptive commit subjects in plain language, following recent examples such as “Optimize bundle splitting, lazy-load worlds, and compress 3D/audio/texture assets.” Reference relevant OpenSpec changes or specs when applicable. In pull requests, summarize the behavior change and verification, link related issues or specs when available, and attach screenshots or short clips for visible changes.
