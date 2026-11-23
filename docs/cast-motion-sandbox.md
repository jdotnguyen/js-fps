# Cast motion sandbox

`/sandbox/cast-motion.html` on the dev server (`npm run dev`) shows every named character's motion side by side (spec `character-motion`, change `per-character-motion`).

- **Grid:** one row per named character (Giles, Okafor, Priya, Voss, Bram, Ruiz, Heins, Hale, Sung), plus the masculine and feminine crew defaults. One column per activity or posture: idle, talk, walk, kneel, crouch, aim, drink, work, sit (chair, stool), lean (wall, back with mug, counter). Rows load as the camera reaches them.
- **Labels:** each cell has a floor label. Red means that cell falls back to the default motion (the character's own profile doesn't cover it yet). Green means the character's own motion.
- **Talk column:** every cell speaks a calm line, so it shows how calm talk gestures (spec `speech-acting`, change `forearm-talk-gesture`). On `neutral`, `question`, `relieved`, `whisper` and `laugh` lines, only the right forearm lifts from the elbow and the wrist bends on the stresses. The upper arm stays within 6° of the idle and the other arm plays its idle. On every line, a character's own talk capture moves only the trunk, at 0.6. With a mug in the right hand, the free left forearm gestures instead (upright-mug-grip D3b). Giles is the exception: his one-handed `giles_talk` capture drives his arms. Heightened lines (`urgent`, `alarmed`, `pained`, `dread`, `scream`) keep their generated whole-arm gestures and aren't shown here. Speech adds no arm motion while a character walks or jogs.
- **Injury row:** "Giles (injury)" follows the stage (0-4, 4 = reveal) and exposure (0 hidden .. 1 showing) sliders, so the favoured left arm can be tuned (design D12).
- **Controls:** Pause, Step (one 1/30 s frame), Restart, speed (0.25x, 0.5x, 1x), Scrub (while paused: drag right to advance; dragging left restarts), solo a row or a column, and the detail pass switch (fingers, forearm twist, trunk distribution; the same as `?detail=0` in the game).
- **Moving around:** click to look, WASD to fly, Space and C for up and down.

The page is a background-throttled WebGL page: when its tab is hidden, the browser stops its frames, so nothing animates until it is shown again. From the console, `window.castMotion` exposes the cells, the state and the row and column lists.

## Held items

What a body holds in the right hand follows its pose (`src/actors/heldProps.ts`, ADR-0029), so the drink, lean-with-mug and aim columns show the grips:

- **Mug** (`*_mug`, `drink` poses): sits against each rig's own knuckle row, fingers wrapped by the solve in `heldGrip.ts`, kept upright or tipped to the mouth (upright-mug-grip).
- **Scanning wand** (`*_wand` poses): a radius wrap round its handle.
- **Pistol** (`aim_pistol`, the aim column; squad-sidearms): the H&K USP from `public/assets/models/weapons/squad_pistol.glb` (`scripts/import-squad-pistol.mjs`). It appears once the blend into the aim pose is half done and goes once the blend out is half done. Its markers are `grip` (the centre of the hand's wrap, placed on the rig's grip frame: the gun's right side on the palm, its forward along the fingers), `muzzle` (the hit origin and where the squad gunshot plays) and `ejectPort` (where the brass leaves), plus the `slide` that kicks back on each shot and the muzzle flash, whose light comes from one point light shared by the squad (`src/render/squadMuzzleLight.ts`). The fingers wrap the grip by the same solve as the mug, with the index kept straight along the frame, off the trigger. While a mate aims at a target, the wrist turns up to 30° to line the bore up with it, and the arm swings up to 15° at the shoulder for a target off to one side.

To fire the squad's pistols, use `/sandbox/squad-sidearms.html` instead: Giles and Okafor aim at a target in a dark room and fire on a key or on auto at the squad's rate, with the muzzle flash and its light, the squad gunshot (positional, muffled through a closed hatch, A/B against Jay's), and the brass landing on concrete, deck plate, a grate over a deck, carpet or shallow water. Its readout shows each mate's aim error and correction, the flash light, and where the last casing landed.
