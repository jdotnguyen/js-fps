# Design

## Context

See proposal.md for the motivation and specs/ for the required behaviour. The current state that shapes the approach:

- **Lights** are changed one room at a time by the `lightState` action (`setLight` in `src/world/level.ts`). Each light has its own pattern and tint (`steady | flicker | dying | strobe | alarm | off`, tint `emergency` or a colour). No station-wide state exists. The slot kind `emergency` exists, as does the `emergency_beacon` prop that offers one, but no room in `slice01` claims an `emergency` slot yet.
- **The PA**: a `say` of a `pa` line with no `fixture` plays from `level.paSpeakerAt(camera.position)`, the nearest PA speaker in the player's room or one that `serves` it. The action half (R04-R11) had none, so the first playtest heard nothing; the Lab Junction gets `pa_lab_junction`, serving Lab B as well.
- **Radio lines** (`channel: "radio"`) play dry and unpositioned. Each sequence speaks on its own channel, so lines in parallel branches of one sequence can overlap. Lines on one channel never overlap.
- **The flashlight prompt** is raised by the `area:dark` bus event, which the R13d trigger emits during the morning rounds, so the prompt is spent before the drop. The tutorial queue shows each prompt once per profile.
- **The flashlight** (`src/render/flashlight.ts`) is a camera-following spot carried at the left of the chest. The viewmodel (`src/render/viewmodel/viewmodel.ts`) draws the pistol and shotgun GLBs. Both are two-handed, with the left hand animated in every clip. The viewmodel also has its own small point light that is driven by the flashlight.
- **Saves** keep `flags: record(scalar)`, so new scalar state can ride in a flag without bumping `SAVE_VERSION`.
- **The klaxon**: the drop plays `klaxon`, which overhaul-flooded-tunnel has since recorded as a looping pump-room horn (`emitter-klaxon.mp3`).
- **TAG FM** is started at four anchors: `radio` (Commons kitchen), `r05_radio`, `hydro_radio` and `dive_radio`. `quiet_restore` picks one of them from the `radio_place` flag.

## Goals / Non-Goals

**Goals:**
- One authored switch that darkens the whole station and can be restored exactly from a save.
- A flashlight model that reads as held without any hand or arm work.
- All new audio comes from the pipelines the repo already uses (Gemini TTS for VO, ElevenLabs for SFX).

**Non-Goals:**
- Restoring main power later in the story. The state allows it, but no content does it yet.
- Hands or arms holding the flashlight, and any new weapon animation.
- Reworking the drop's red emergency lighting, which stays as authored.
- New dialogue-channel rules. Overlap comes from parallel branches.

## Decisions

### Station power is a level-wide mode, kept in a flag
`Level` gains `setPower('mains' | 'backup')`. A new script action `{ "do": "power", "state": "backup" }` sets it and writes the flag `station_power`. On load (`game.ts` restore, and `debugSetup.flags`), the level applies the flag before the first frame.
- *Why a flag:* saves already carry flags, so there is no schema bump or migration, and `debugSetup` can start any later sequence in the blackout.
- *Alternative:* looping `lightState` over every room from the sequence. Rejected: rooms built later or streamed in would miss it, and restoring from a save would need the whole list replayed.

### What counts as a backup light
A light is a backup light when it is an `emergency` slot, or when its level item has `backup: true`. A room with neither falls back to its lowest-index claimed light. Under backup power, backup lights render with a fixed `backup` look: warm white `#ffd9a8` at 25% of authored intensity, range ×0.7, the `steady` pattern unless scripted otherwise. Every other light shows a dark diffuser and drops out of the pool assignment. Room ambient drops to a new `AMBIENT.backup` preset, darker than `AMBIENT.emergency` with no red.
- Authoring: place `emergency_beacon` props, wall-mounted, on the critical path rooms first (R05–R11 and the Commons), so the beacons read as real backup lamps. Other rooms use the fallback until dressed.
- *Alternative:* dimming every light. Rejected: it reads as a dimmer switch, not a power failure. The point is a few pools of light with dark between them.

### Scripted patterns under backup power
`setLight` keeps writing each light's authored pattern and tint, and the power mode decides what renders. Under `backup` the pattern and tint apply to backup lights only (render-lighting delta), so the drop's and later sequences' flickers still work in the dark. Returning to `mains` restores every light from its stored state.

### The blackout beat lives in the contact sequence
The steps go into `contact` in `action_contact.json` after `waitGroup r05_trickle`. The ruined-radio steps (`radio`, `setFlag radio_place = ruined`) are replaced by the beat, and it ends at the existing door close and `cp_contact_clear`. The shape:

```
waitGroup r05_trickle -> wait 1.2
say blackout_radio_ops_01    (overlap, no wait) -> wait 2.7    each wait = the clip's length - 1 s, so the next
say blackout_radio_dock_01   (overlap, no wait) -> wait 5.0    call starts about 1 s before the last one ends
say blackout_radio_hydro_01  (overlap, no wait) -> wait 7.8
say blackout_radio_launch_01 (overlap, no wait) -> wait 4.0
say blackout_radio_ops_02    (overlap, waits for its end)
say blackout_okafor_01 (local)
say blackout_pa_power_01 (pa, no fixture: the Lab Junction speaker, which also serves Lab B)
sfx powerDown -> power backup (the level emits power:changed) -> cameraShake
wait 1.2 -> doorState D_R05_R06 closed -> setFlag contact_done -> checkpoint cp_contact_clear
```

Lines on one sequence share a channel and would play strictly one by one, so the chatter uses `overlap` with waits timed from the clips (2026-11-22: a first cut with 1-1.3 s waits piled four calls on top of each other; the user asked for each call in turn with about 1 s of overlap). Re-measure the waits if a clip is re-recorded. Cut-offs are authored into the clips (the take ends mid-word, followed by a short radio squelch), not stopped at runtime, so skipping or replaying behaves the same. The squad line is Okafor's, since he already speaks the R05 aftermath. The beat's flag `blackout_done` guards the steps on resume, and `debugSetup` for later sequences sets `station_power: "backup"`.

### Flashlight prompt moves to the blackout
`tutorialPrompts.ts` listens for a new `power:backup` event instead of `area:dark`. The `area:dark` trigger stays in R13d, because the dive-bay spec keeps it and other systems may listen to it, but it no longer raises the prompt.
- *Alternative:* keep both triggers. Rejected: the prompt is once per profile, so R13d would always spend it before the blackout and the user's request would never happen.

### Flashlight model: a viewmodel prop, not part of a weapon
`flashlight.glb` goes through the imported-props pipeline (`docs/imported-props.md`): scaled to about 0.22 m long, origin at the lens, textures compressed. The viewmodel adds a `FlashlightProp` group parented to the viewmodel camera space, separate from the weapon GLBs, so weapon clips never move it. Its placement:
- Pose: lower-left, about (−0.17, −0.15, −0.32) from the camera, yawed about 6° in toward the centre, the lens forward and the tail angled down-left off frame. A per-aspect correction keeps the tail off screen from 4:3 to 21:9 and across the FOV range: the x offset scales with the horizontal frustum half-width at that depth.
- Motion: it shares the viewmodel's sway and bob springs, with its own small lag, and is lowered by a 0.25 s raise/lower blend driven by `flashlight.on && weapon !== 'shotgun'`.
- Beam: while the prop is shown, the spot light's origin moves to the lens world position instead of the chest offset, and the existing viewmodel point light sits at the lens. The lens material's emissive follows the flashlight level. With the shotgun the beam goes back to the chest offset.
- *Alternative:* a left-hand flashlight with new arm poses. Declined by the user. A gun-mounted light was declined as well.

### Audio
- **Alarm:** the drop gets its own one-shot, `lockdownAlarm` (`oneshot-lockdown-alarm.mp3`), in the ambience manifest, with the prompt "one cycle of a heavy industrial emergency evacuation alarm... two-tone klaxon horn with a hard attack, metallic resonant tail". The drop's alarm steps play `lockdownAlarm`; the pump room keeps `klaxon`. Recorded only, no procedural fallback.
- **New sounds:** `powerDown` (relays clunking off, generators spooling down, a final hum dying) and `backupHum` (a low 50/60 Hz ballast hum loop), both recorded only. `backupHum` plays as a positional loop on each lit backup lamp near the player, using the light-buzz mechanism so only nearby lamps hum.
- **VO:** new speakers `radio_ops`, `radio_dock`, `radio_hydro` and `radio_launch` added to `scripts/lib/voCast.ts` (voices and model per the station-power spec), `speakers.json` (subtitle names), and the cast table in `docs/voice-casting-standard.md`. Lines go in `slice01.json` with `channel: "radio"`. The PA line uses `pa` / `Gacrux`, and Okafor's line uses `medic` / `Charon` on his pinned 2.5-flash model. Budget: one 3.8 request for the four radio speakers' five lines, one 3.1 request for the PA, and one 2.5-flash request for Okafor.

Draft lines (final wording at recording):

| Line | Speaker | Text |
| --- | --- | --- |
| `blackout_radio_ops_01` | `radio_ops` | "All sections, report. All sections, report status." |
| `blackout_radio_dock_01` | `radio_dock` | "Ops, Docking Ring! Something's in the airlock, it's— it's coming thr—" |
| `blackout_radio_hydro_01` | `radio_hydro` | "There's someone down in the Grow Hall. He's not moving. The vines are moving. Why are the vines moving?" |
| `blackout_radio_launch_01` | `radio_launch` | "It came up the launch trunk! Seal the Launch Hall, seal it, seal—" |
| `blackout_radio_ops_02` | `radio_ops` | "Say again, Launch Hall? Launch Hall, respond. Anyone on this chan—" |
| `blackout_okafor_01` | `medic` | "That's not just us. That's the whole station." |
| `blackout_pa_power_01` | `pa` | "Attention. Main power has failed. Emergency lighting is now active. Thank you for your patience." |

### Radios
Remove the anchors `r05_radio`, `hydro_radio` and `dive_radio` and their radio props. Remove the `hydro`, `dive` and `ruined` branches of `quiet_restore`, and remove `ruined_radio_off`. `radio_place` keeps only the values `commons` and `none`.

## Risks / Trade-offs

- [Backup lighting makes the post-lab path too dark to play without the flashlight] → every room keeps at least one backup light; playtest R05 to R11 with the flashlight off, and author beacons where a room reads black.
- [The fallback "first claimed light" lands in a corner or behind a prop] → treat it as a stopgap; the tasks put beacons on the critical path, and a level test lists the rooms still on the fallback.
- [The flashlight tail shows at an untested aspect or FOV] → the spec's scenarios become a unit test that projects the model's bounding box through the camera at the extremes.
- [Overlapping radio lines become unreadable as subtitles] → keep each call short and stagger the starts by at least 1 s; the subtitle stack already shows several speakers.
- [The Gemini free tier allows 10 requests a day per model] → three requests across three models; retakes stay within one day's quota.
- [Other in-flight changes edit `slice01.json`, `level.ts` and `action_contact.json` (overhaul-flooded-tunnel, adopt-physics-engine)] → keep the level-data edits to anchors, beacons and `backup` marks; rebase before starting, and commit through the private index (see the shared-checkout notes).
- [Players already have a profile that has seen the flashlight prompt] → expected; it won't show again. "Reset tutorials" brings it back.

## Migration Plan

Old saves made after `cp_contact_clear` have no `station_power` flag and would load on main power. On load, if `contact_done` is set and `station_power` is missing, treat the state as `backup`. Saves with `radio_place` set to `hydro`, `dive` or `ruined` load as `none`. No save version bump.
