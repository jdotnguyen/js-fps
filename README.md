# Thalassa

Deep-sea horror FPS (repo: `js-fps`).

A story-driven, Dead Space-style survival-horror FPS that runs in the browser.
You are a security officer on a deep-sea research station overrun by an infection,
fighting alongside two specialists. Built with Three.js, TypeScript and Vite.
Level geometry is a procedural modular kit dressed with CC0 PBR textures; characters, weapons and audio
mix procedural assets with imported models and recorded sounds (credits in [CREDITS.md](CREDITS.md)).

- Design summary: [DESIGN.md](DESIGN.md)
- Executable decisions, in build order: [docs/adr/](docs/adr/README.md)
- Level texturing and dressing rules: [docs/surface-dressing-standard.md](docs/surface-dressing-standard.md)

## Run

```sh
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Unit tests with Node's built-in runner (Node 22.6+) |
| `npm run build` | Typecheck, then production build |

## Debug flags

Add to the URL: `?debug` (stats, lil-gui), later `?seq=<sequence id>` and `?cp=<checkpoint id>`.

## Current state

A detailed demo corridor ("Lab B observation") to judge the look: procedural PBR textures,
flickering and dying lights, a hand-held flashlight, an alarm beacon, light shafts, dust,
a window onto the abyss, post-processing, and a procedural soundscape (hum, vent fan,
light buzz that crackles with the flicker, drips, knocks, hull groans, a klaxon behind the door,
footsteps that change on grating, and something large calling from outside). Movement is a fly camera kept inside the room
(the real player controller is ADR-0004).

Starts at a title screen (Continue / New game / Load game / Settings). Saving follows
ADR-0016: autosave at checkpoints, manual saves at the green save terminal, three slots.

| Input | Action (current build) |
| --- | --- |
| Click | Capture mouse |
| Mouse | Look |
| W A S D | Move |
| Space / C | Up / down |
| Shift | Faster |
| F | Flashlight |
| E | Use (save terminal) |
| Esc | Pause menu |

`npm run textures:preview` writes PNG contact sheets of every texture to `previews/`.
`npm run sounds:preview` writes every sound as a WAV (plus a spectrogram sheet) to `previews/sounds/`.
Audio starts on your first click (browser rule).
