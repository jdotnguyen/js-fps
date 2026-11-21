# Repository Guidelines

## Project Structure & Module Organization

Thalassa is a browser FPS built with Three.js, TypeScript, and Vite. `src/main.ts` wires the game together. Gameplay and simulation live in `src/game/`, `src/actors/`, and `src/ai/`. Level construction and the modular kit live in `src/world/`, authored data in `src/data/`, and presentation in `src/render/`, `src/ui/`, and `src/audio/`. Tests sit alongside the modules they cover. Runtime assets live in `public/assets/`, and asset utilities live in `scripts/`.

Check `openspec/specs/` (OpenSpec) before changing architectural decisions. Follow `docs/audio-assets.md` when adding or replacing sounds, and `docs/imported-props.md` when adding a downloaded 3D prop. Follow `docs/modular-grid-standard.md` and `docs/surface-dressing-standard.md` when editing levels, and `docs/voice-casting-standard.md` when adding or regenerating dialogue VO. Record third-party asset attribution in `CREDITS.md`.

## Build, Test, and Development Commands

Use Node.js 22.6 or later for the test runner.

- `npm ci` installs dependencies from the lockfile.
- `npm run dev` starts Vite for local playtesting.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm test` runs the colocated unit tests, at most 4 files at a time (`TEST_CONCURRENCY` changes that). `npm test -- <file>` runs only the files given.
- `npm run build` type-checks and bundles the game into `dist/`.
- `npm run preview` serves the production build locally.

## Shared Machine

Several agents often work in this repository on one PC at the same time, and on 2026-11-20 they filled its RAM. Node.js alone reached about 25 GB. Keep your footprint small:

- Reuse a running dev server instead of starting another. Check `http://localhost:5173/` first, and only run `npm run dev` if nothing answers. Stop any server you started when you finish.
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
