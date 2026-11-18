# ADR-0005: Weapons

Status: Accepted (roster) / Proposed (stats)

## Context
The player starts with a security pistol; a shotgun appears partway through [Decided].
Combat centres on dismemberment [Decided]. Resource scarcity depends on difficulty
[Decided]. The HUD shows ammo diegetically on the gun [Decided].

## Decision
Two hitscan weapons defined in `data/weapons.json`, detailed procedural viewmodels,
procedural animation, and an on-gun ammo readout.

## Details

### Stats [Assumed, tuned in playtest]
| | SEC-9 security pistol | Breacher shotgun |
|---|---|---|
| Fire mode | Semi-auto | Pump |
| Magazine | 12 | 6 (loaded per shell) |
| Damage | 18 per shot | 8 pellets x 9 |
| Fire interval | 0.18 s | 0.75 s (pump) |
| Reload | 1.4 s (empty 1.7 s) | 0.5 s per shell, interruptible by firing |
| Spread hip / aim (radians) | 0.020 / 0.004 | 0.075 / 0.055 |
| Effective range | 60 m | 12 m (damage falloff from 6 m to 50% at 12 m) |
| Stagger power | low | high (knocks shamblers back) |
| Ammo type | `pistol` | `shells` |
- Reserve ammo is finite; starting reserves and drops come from ADR-0008.
- Switching: 1 / 2 / mouse wheel, 0.35 s.

### Firing and hits
- Hitscan rays from the camera centre with spread, tested against: enemy limb capsules
  (ADR-0006), world colliders (ADR-0003), and interactables (shootable lights/glass later).
- First hit wins; pellets resolve independently.
- On world hit: impact sparks, decal, ricochet sound. On flesh hit: fluid burst, limb damage.
- Bullets do not hurt teammates [Assumed]: they play a flinch and bark "Watch it!".

### Viewmodels (procedural, detailed)
- Pistol: slide, frame, grip with texture, rear screen, laser emitter, magazine as a
  separate part so reloads can drop it. ~3-5k triangles.
- Shotgun: receiver, pump, twin shell indicator lights, stock, heat shield.
- Built from bevelled boxes, extrusions and cylinders; `painted_metal`, `bare_steel`,
  `rubber` materials.

### Procedural animation
- Sway from mouse delta, bob from movement, spring-based recoil (position + rotation),
  aim pose transition, sprint pose (lowered), reload choreography by tweening parts
  (mag out, mag in, slide release; pump shell inserts), inspect pose none.

### Diegetic ammo
- Pistol: small emissive `screen` material on the back of the slide, canvas redrawn only when
  the count changes (big digits for the mag, small for reserve). Turns red at <=3.
- Shotgun: six indicator lights on the side, one per loaded shell.
- Laser sight (aim mode): thin additive line from emitter to the hit point + dot decal.

### Pickups
- Shotgun obtained from the security armory locker in R07 (ADR-0014), via an
  engineer-unlocked locker.
- Ammo pickups: physical props (pistol magazine box, shell box) with a small glow and
  interact-free auto pickup within 1 m.

## Consequences
- Weapon data can be added per chapter without code changes, except new mechanics.

## Alternatives rejected
- Projectile bullets: hitscan is fine at corridor ranges and much cheaper.
- Plasma-cutter style tools: can arrive later; the slice uses security weapons to match the
  security-officer fantasy.

## Execution steps
1. `weapons.json` + loader; weapon state machine (idle, fire, reload, switch).
2. Hitscan with spread vs world; impacts and decals.
3. Pistol viewmodel and animation; on-gun screen.
4. Shotgun viewmodel, pump/shell reload, indicator lights.
5. Aim mode laser.
6. Ammo pickups.

## Definition of done
- Both weapons feel distinct; reload can be interrupted correctly; ammo counts on the gun
  always match internal state.

## Open questions
- None blocking.

## Progress 2026-11-17: step 6 (ammo pickups)
- Level `pickups` entries with `kind` (`ammo_pistol`, `ammo_shotgun`, `medkit`) and optional
  `amount` (the Standard figure) are supplies; `item` entries stay key items. `game/supplies.ts`
  places a small box with a glowing stripe (medkit: bone case with a red cross), collects it
  within 1 m without interact, adds to the viewmodel reserve (`Viewmodel.addReserve`) and
  toasts "+12 pistol rounds". Taken placed pickups are saved as `pickup:<id>` flags.
- Both guns count as owned until the shotgun pickup exists (gap). No pickup sound yet.

## Progress 2026-11-18: animated GLB viewmodels
- The procedural SDF pistol/shotgun and hands are replaced in play by `public/assets/models/weapons/pistol.glb`
  and `shotgun.glb` (skinned arms + gun, one clip each for Fire, PostFire/pump, reloads, Hide/Unhide/Weild).
  `render/viewmodel/glbWeapons.ts` loads them (`loadWeaponModels`, awaited in main.ts before the `Viewmodel` is
  built); `viewmodel.ts` keeps the state machine and spring layers but takes its timings from the clips.
  The old `pistol.ts` / `shotgun.ts` / `hand.ts` builders remain only for the `?vmlab` turntable.
- The shotgun export had its gun mesh 10,000x too large, backwards and upside down; `scripts/fix-weapon-glb.mjs` rewrites it
  (idempotent, already applied to the committed file). The arms and pistol needed nothing.
- Shotgun cycle: Fire, then PostFire (pump) 0.3 s later, ready 0.9 s after the shot. Reload: PriorToReload, a
  ReloadOne per shell, ReloadLastOne; firing mid-reload drops out of it. Pistol: Fire restarts per shot (0.24 s),
  ReloadClip / EmptyClipReload.
- Audio no longer uses timers. The viewmodel emits `weapon:cue` (`magOut`, `magIn`, `slide`, `slideSoft`, `pump`)
  at times read off the clips (`CUES` in viewmodel.ts); main.ts plays the samples on them. The pump sample is
  time-stretched x1.1 (`scripts/fit-weapon-audio.mjs` -> `shotgun-pump-fit.wav`) so its rack and slam land on
  PostFire's. Other samples already fit and are only re-timed.
- The Fire/PostFire clips throw the whole rig back ~0.35 m; the viewmodel cancels part of that (`recoilCancel`)
  so the gun stays in front of the camera, more when aiming. Pose numbers (`SPECS.*.poses`) are first guesses.
- Gone with the procedural guns: the on-gun ammo screen/lights, the pistol aim laser and the slide-lock on empty.
