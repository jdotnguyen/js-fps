# INKSHOT

A cel-shaded, wave-survival first-person shooter that runs in the browser.
Built with [Three.js](https://threejs.org) and Vite. Everything is procedural:
no models, textures or audio files.

## Run

```sh
npm install
npm run dev
```

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look |
| Left click | Fire |
| W A S D | Move |
| Shift | Sprint |
| Space | Jump |
| R | Reload |
| 1 / 2 / wheel | Rifle / shotgun |
| Esc | Pause |

## Layout

| File | Purpose |
| --- | --- |
| `src/main.js` | Bootstrap, game state, input, render loop |
| `src/toon.js` | Toon materials, gradient map, inverted-hull outlines |
| `src/level.js` | Arena geometry, colliders, AABB movement |
| `src/player.js` | First-person controller |
| `src/weapon.js` | View model, hitscan firing, reloads |
| `src/enemies.js` | Enemy types, AI, projectiles, pickups, waves |
| `src/effects.js` | Particles and tracers |
| `src/audio.js` | Synthesized sound effects (Web Audio) |
| `src/hud.js` | DOM HUD and overlays |

## How the cel shading works

- `MeshToonMaterial` with a 3-step nearest-filtered gradient map gives the banded lighting.
- Outlines are "inverted hulls": each mesh gets a slightly larger child drawn
  with back faces only in ink colour.
- The weapon is rendered in a second pass after clearing depth, so it never
  clips into walls.
