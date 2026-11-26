# The blade creature

The four-armed creature with blade arms: the thing that bursts out of Voss in Lab B, drops into R06, kills Priya in R08, charges the R10 door and fights in R11. Its body is the Necromorph Slasher model (`public/assets/models/infected/necromorph_slasher.glb`, `necromorph` in `src/data/body-models.json`), worn by the `lab_creature` (1.85 m) and `flood_elite` (2.15 m) looks and by the hero tier. What it must do is in `openspec/specs/blade-creature/spec.md` (until archived: `openspec/changes/rig-necromorph/specs/`), and how it is built is in the `rig-necromorph` design.

It is a humanoid body: it keeps the shared 21-joint skeleton, so severing, hit regions, kills, crawling and the enemy AI work on it as on any body.

## Repairing the model

The shipped file is made by `scripts/fix-necromorph-glb.mjs` from the model as committed in `822dddf`. The repair adds one joint, `Jaw_066`, under `Head_013`, and moves the jaw's skin onto it. Nothing else changes. The details are in `scripts/lib/necromorphRepair.mjs`.

```sh
git show 822dddf:public/assets/models/infected/necromorph_slasher.glb > previews/sources/necromorph_slasher_src.glb
node scripts/fix-necromorph-glb.mjs             # writes public/assets/models/infected/necromorph_slasher.glb
node scripts/fix-necromorph-glb.mjs --check     # exit 1 unless the shipped file matches a fresh repair
node scripts/fix-necromorph-glb.mjs --out previews/necromorph_try.glb --skip=jaw   # a variant, or the source re-written
node scripts/fix-necromorph-glb.mjs --fixture   # rewrite scripts/fixtures/necromorph-source.json (the tests' facts about the source)
npm test -- scripts/fixNecromorph.test.ts
```

To test a candidate before it replaces the shipped file, name it with `NECROMORPH_MODEL` (a path from the repository root). The repair tests and the tests under `src/actors/blade/` both read it:

```sh
NECROMORPH_MODEL=previews/necromorph_try.glb npm test -- scripts/fixNecromorph.test.ts src/actors/blade/shoulders.test.ts
```

### Arm envelope

The prepared body hangs its arms, and poses raise them. With the model's weights, an upper arm raised sideways up to about 140 degrees from hanging, or swung forward up to about 100, keeps the skin round the shoulder within 2.5 times its length. Past that, the skin behind the shoulder tears. Keep the creature's poses inside that envelope, and get height from the elbow: with 1.1 m of forearm and blade, a bent elbow puts the blade tips above the head. `src/actors/blade/shoulders.test.ts` checks it; `BLADE_SHOULDER=x,z` probes other angles and `BLADE_EDGES=1` prints the stretched edges.

## The sandbox

With the dev server running (reuse one on `http://localhost:5173/` if it answers), open `http://localhost:5173/sandbox/blade-creature.html`. Both sizes stand beside a 1.78 m crew figure, with height lines at 1 m, 2 m and 3.2 m (a standard room's ceiling).

- Drag to orbit, wheel to zoom, right-drag to pan. The view buttons jump to set framings.
- Pick a pose from the list (type to filter); `blend` is the blend time in seconds.
- The jaw, belly-flare and belly-clench sliders drive the creature's layer directly.
- Play `scream` (or `scream 5 s`), combat `windup R`, `slash R`, `grab` and `stop`.
- Pause, step a frame, or play at 0.25x, 0.5x or 1x.
- Show the hit shapes or hide the floor grid.
- URL: `?pose=<name>` starts the creatures in a pose, `?hits` shows the hit shapes, `?speed=0.25` slows time.
- Console: `window.blade.setPose(name, blend)`, `play(name, hold)`, `stop()`, `jaw(0..1)`, `flare(0..1)`, `clench(0..1)`, `move(v, rate)`, `turn()`, `pause(on)`, `step(frames)`, `speed(x)`, `hits(on)`, `view(name)`, `snap(frames)` and `sheet(opts)` (a follow-camera contact sheet returned as a JPEG data URL).

Close the tab when you are done; each game tab holds a lot of memory on the shared machine.

## Profile and performance formats

`src/data/blade-creature.json` (validated by `src/data/types/bladeCreature.ts`) attaches to the `necromorph` entry of `src/data/body-models.json` via `"rig": "blade"`:

- `model`: body-model id (`"necromorph"`).
- `ankleHeight`: ankle height above the sole at the 1.78 m reference height (m), passed to `FootIkSolver`.
- `poundDistance`: standing distance from a glass pane's face when pounding (m, Lab B). It is the `blade_pound_hit` wrists' reach plus a few centimetres, so the wrists meet the pane on each blow; retune it with the poses. After its walk the creature slides onto this exact spot before the first blow.
- `jaw`: `{ bone, openDeg, rest }` — mandible bone name, full open angle (degrees), and resting hang (0..1).
- `segments`: `[{ joint, bones }]` — extra spine/neck bones that split a game joint's bend equally.
- `limbs`: `[{ name, root }]` — belly-arm root bones preserved as detail chains under the torso.
- `blades`: `{ L: { hand }, R: { hand } }` — hand joints whose blade tips are recorded at preparation.
- `hits`: `{ bladeRadius, maxRadius }` — fitted hit-capsule radii (m, reference height).
- `poseMap`: generic pose name -> `blade_*` pose in `src/data/poses.json` (fallback: `blade_stance`, logged once).
- `performances`: named multi-phase timelines (e.g. `scream`) played by `Humanoid.playPerformance(name, { hold })`, `npcAnim` or kill `attackerPerf`:
  - Each phase has `{ pose, blend, hold, jaw?, flare?, tremor?, stretch? }`.
  - Setting `stretch: true` on a phase lets a caller pass a custom hold duration (s) while keeping the coil and settle timings intact.
  - `setPose`, moving (`speed > 0.25` / `NpcActor.moveTo`) or skipping (`instant: true` / `stopPerformance`) ends any active performance cleanly and resets jaw, flare and tremor.

## Tests

- `scripts/fixNecromorph.test.ts`: the repair (the jaw, and nothing else changed).
- `src/actors/blade/measure.test.ts`: the rest ankle height, the jaw's skin, and the feet against the floor.
- `src/actors/blade/shoulders.test.ts`: the arm envelope.
- `src/actors/blade/fightBaseline.test.ts`: the R06 and R11 fights simulated at fixed seeds. `fightBaseline.json` holds the figures from before the creature's hit shapes changed; `BLADE_FIGHTS=print` prints the current ones.
