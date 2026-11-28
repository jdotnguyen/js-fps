# Design

## Context

- Squad mates (`engineer` = Giles, `medic` = Okafor) already switch to the `aim_pistol` pose in combat (`src/ai/squad.ts`). The animator drives it from the `pistol_idle` clip (`aimPistol` in `motion-profiles.json`). `handPhysics.ts` already gives that pose a right-hand `grip`, and `animator.ts` lists it as arms-busy. Today the hand is empty.
- Held items (`src/actors/heldProps.ts`) are chosen from the pose name by regex (`MUG_POSE`, `WAND_POSE`), with a grip radius per item, and the fingers are solved round them by `src/actors/heldGrip.ts`. ADR-0029 and the held-props spec cover the mug and the wand.
- `Squad.fire` emits `squad:fired { id, enemy, hit, killed }` and uses a hit origin of `position + 1.4 m`. Nothing listens to that event for audio. Squad mates fire every `COMBAT.fireInterval` (0.33 s) ± 15%, so two mates together reach about 6 shots a second.
- casing-drop-audio provides the casing landing entry point (kind, ejection point, right vector, seed) and owns the 4-voice cap.
- The raw model is `heckler__koch_usp_pistol.glb` (Urpo, CC BY 4.0, credit embedded). It is about 7.3k triangles in three meshes, `Slide`, `Barrel` (body) and `Small` (parts), with 9 PNG textures (about 4.8 MB) and no animation. The file is about 2 m long in its own units.

## Goals / Non-Goals

**Goals:**
- One `pistol` held item driven by the existing pose-based system, so any later armed character gets it from the pose alone.
- Muzzle and ejection port taken from the model, so the sound, the casing and the hit origin all come from the gun.

**Non-Goals:**
- Tracers, smoke or a shadow-casting flash.
- Holster meshes, or draw and holster animations. The pistol appears and disappears at the pose blend midpoint.
- Infected hearing squad shots. The current behaviour (only the player's shots are a `gunshot` noise) is kept, so encounter balance does not shift.
- Reload animations or ammo for the squad.
- Replacing Jay's viewmodel guns. Only their credits are added.

## Decisions

### D1. Import with a dedicated script, not `npm run props`

`npm run props` registers kit props in `kit-manifest.json` and bakes everything into one mesh. The pistol needs neither: it is not level dressing, and the slide must stay separate. Instead, follow `scripts/import-flashlight.mjs`: `scripts/import-squad-pistol.mjs` reads `../props-src/weapons/heckler__koch_usp_pistol.glb` and writes `public/assets/models/weapons/squad_pistol.glb`. It:

- bakes the node transforms, scales the model to a real length of 0.194 m and puts the barrel along -Z;
- keeps two meshes, `slide` and `frame` (`Barrel` merged with `Small`);
- adds empty marker nodes `muzzle`, `ejectPort` and `grip`, the grip being the centre of the grip at the web of the hand;
- simplifies to about 3,000 triangles in total, since it is only ever seen at third-person distance;
- re-encodes the textures as 512 px WebP, merged into one material per mesh.

### D2. Grip frame from markers, solved like the mug

Add `pistol` to `HeldItem`, chosen by `/(^|_)pistol(_|$)/` on the pose. Its grip radius is about 0.016 m, the grip treated as a rounded bar. The pistol is placed by its `grip` marker in the hand's canonical frame (bone -Y, palm -X, thumb -Z), and the existing `solveHeldGrip` wraps the fingers. The index finger is kept straight along the frame, off the trigger. Visibility follows the pose blend weight with a threshold of 0.5.

### D3. Aim correction: the wrist, then the shoulder

The `pistol_idle` clip points the forearm forward, but on the real rigs the pistol, held with the fingers square to its grip, points 23-36 degrees high and to one side of a target straight ahead (measured during implementation), as a real pistol does in a straight wrist. Each frame, after everything else has moved the arm, turn the wrist toward the target's aim point by up to 30 degrees (about the ulnar deviation a shooter's wrist gives); then swing the whole right arm rigidly at the shoulder by up to 15 degrees, eased in over about 0.15 s once the pistol shows, for what the wrist cannot reach (a target off to one side; two passes, since the swing moves the muzzle); then let the wrist use what is left of its range. Seating the bore along the hand's axis instead was tried: it needs less correction but runs the fingers into the trigger guard. The barrel is the bore, the model's -Z through the muzzle, not `muzzle` minus `grip`: the muzzle sits 8 cm above the grip marker, 27 degrees off the barrel line. The pistol stays rigidly parented to the hand, so its steadiness comes from the arm, which the hand-steadying already handles.

### D4. Shot wiring

Extend `squad:fired` with `muzzle` and `ejectPort` world points (and the gun's right vector), read from the markers. `Squad.fire` asks the body for these when it has a pistol, and falls back to the old `+1.4 m` point when not, for example when the body has not loaded. `session.ts` handles the event: it plays `squadPistolShot` at the muzzle (positional, occluded, rate jitter ±4%), kicks the slide (a 0.03 m back-travel spring that returns within 0.15 s), and calls the casing entry point with `kind: 'brass'`.

### D5. The squad gunshot

`squadPistolShot` is a recorded clip the user chose, "pistol shot" by mrfriends on Pixabay (Pixabay Content License: free use, no attribution required; credited in `CREDITS.md` anyway), replacing four ElevenLabs takes generated first. The raw download stays in `../audio-src/weapons/`. It is made mono, its leading silence and silent tail trimmed, raised 3.3 dB into a -1 dB limiter, and registered in `SAMPLE_URLS` as one file; the per-shot rate jitter (±4%) gives consecutive shots different pitches. It plays at gain 0.9 (Jay's pistol plays at 0.6), since the clip is about 8 LU quieter than `pistolShot` and more gain into the limiter would flatten its crack. The route is recorded in `docs/audio-assets.md`.

### D6. Credits

Add a `CREDITS.md` row (and an in-game credits entry) for the USP (Urpo, CC BY 4.0, with what the import script did), and a `CREDITS.md` row for the squad gunshot (D5). Rows for DJMaesen's viewmodel guns were added here at first; while this change was in progress another change replaced Jay's `pistol.glb` and `shotgun.glb` with JUST's models (CC BY 4.0) and their credits, so those rows were removed.

### D7. Muzzle flash that lights the room

Each squad shot shows a flash sprite on the pistol's `muzzle` marker for 55 ms (as long as Jay's pistol flash): two crossed additive planes along the bore and one facing down it, a fresh roll and size each shot, driven by the body's shot clock with the slide kick. The light is one `PointLight` shared by both mates (`src/render/squadMuzzleLight.ts`), as warm and strong as Jay's pistol flash (intensity 6, 7 m, decay 2), placed 6 cm ahead of the muzzle and fading to zero over the same 55 ms, with no shadow. It stays in the scene at zero intensity between shots, so the light count that every material program is keyed by never changes, and room captures borrow it like the player's lights. A newer shot takes it over; two mates' flashes rarely overlap at their fire rate, and both still show their sprite. `squad:fired` carries the bore's `forward` for it.

## Risks / Trade-offs

- [A second muzzle light costs shading on every lit pixel] → One shared light, not one per mate, and none in a world without a squad.

- [The gun pops in at the blend midpoint] → The arm is mid-raise at that point, so the motion hides it. A proper draw is a non-goal (see above).
- [The `pistol_idle` clip's hand pose conflicts with the grip solve] → `handPhysics` already returns `grip` for `aim_pistol`, so check the solve on both rigs in the cast motion sandbox (`docs/cast-motion-sandbox.md`).
- [Rapid squad fire floods the casing voices] → casing-drop-audio's shared 4-voice cap with oldest-fade handles this. The squad shot itself is not capped, because it is the important cue.
- [Simplifying the slide too far shows gaps against the frame] → Simplify each mesh separately, with seam locking, as the props pipeline does.
