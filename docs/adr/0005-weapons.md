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
