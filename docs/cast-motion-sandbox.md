# Cast motion sandbox

`/sandbox/cast-motion.html` on the dev server (`npm run dev`) shows every named character's motion side by side (spec `character-motion`, change `per-character-motion`).

- **Grid:** one row per named character (Giles, Okafor, Priya, Voss, Bram, Ruiz, Heins, Hale, Sung), plus the masculine and feminine crew defaults. One column per activity or posture: idle, talk, walk, kneel, crouch, aim, drink, work, sit (chair, stool), lean (wall, back with mug, counter). Rows load as the camera reaches them.
- **Labels:** each cell has a floor label. Red means that cell falls back to the default motion (the character's own profile doesn't cover it yet). Green means the character's own motion.
- **Talk column:** every cell speaks a calm line, so it shows how calm talk gestures (spec `speech-acting`, change `forearm-talk-gesture`). On `neutral`, `question`, `relieved`, `whisper` and `laugh` lines, only the right forearm lifts from the elbow and the wrist bends on the stresses. The upper arm stays within 6° of the idle and the other arm plays its idle. On every line, a character's own talk capture moves only the trunk, at 0.6. With a mug in the right hand, the free left forearm gestures instead (upright-mug-grip D3b). Giles is the exception: his one-handed `giles_talk` capture drives his arms. Heightened lines (`urgent`, `alarmed`, `pained`, `dread`, `scream`) keep their generated whole-arm gestures and aren't shown here. Speech adds no arm motion while a character walks or jogs.
- **Injury row:** "Giles (injury)" follows the stage (0-4, 4 = reveal) and exposure (0 hidden .. 1 showing) sliders, so the favoured left arm can be tuned (design D12).
- **Controls:** Pause, Step (one 1/30 s frame), Restart, speed (0.25x, 0.5x, 1x), Scrub (while paused: drag right to advance; dragging left restarts), solo a row or a column, and the detail pass switch (fingers, forearm twist, trunk distribution; the same as `?detail=0` in the game).
- **Moving around:** click to look, WASD to fly, Space and C for up and down.

The page is a background-throttled WebGL page: when its tab is hidden, the browser stops its frames, so nothing animates until it is shown again. From the console, `window.castMotion` exposes the cells, the state and the row and column lists.
