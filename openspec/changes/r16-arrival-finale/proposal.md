# Proposal

## Why

Phase 3 Part 2 (`r15a-train-ride-narrative`) finishes the `R15a` boarding choreography, the 3-stage abyssal train ride, and the Heins radio exchange, handing off at `transit:arrived_r16` with Train Car B parked at the `R16a` Arrival Track Dock and its boarding door closed. However, nothing yet handles the tunnel power-loss cutoff, the pitch-black `R16a`/`R16b` arrival horror reveal, the surveillance-camera finale where Giles and Okafor advance into the concourse with weapon-mounted flashlights, or the hard cut to `story:cliffhanger` (`THALASSA / SLICE ONE` -> Priya `CAM 04` stinger -> end credits).

## What Changes

- **Tunnel power-loss emergency shift & reserve coasting announcement (`src/world/kit/transit.ts`, `src/data/sequences/action_climax.json`, `src/game/transitRide.ts`)**:
  - The moment `r15a_heins_04` cuts off into static, play a heavy traction-power shutdown SFX, shift `R15b` (and the `R16a` north shroud) hallway strips from bright white to dim emergency red (`transit:tunnel_power`), keep Train Car B's warm cabin lights steady (no flicker), and play a calm automated Transit PA announcement (`pa`, `channel: "pa"`) reporting rail-bus power loss and reserve coasting to the nearest stop (`R16a` Arrival Terminal) for safety shutdown.
  - Extend `r15a_train_ride`'s `tunnelSeconds` to give the power-loss SFX and PA announcement clean room before Stage 3 deceleration into `R16a`.
- **Pitch-black `R16a`/`R16b` arrival cutscene & auxiliary exterior train lights (`src/world/kit/transit.ts`, `src/data/sequences/action_climax.json`, `src/data/levels/slice01.json`)**:
  - Black out `R16a` and `R16b` before Stage 3 glides into `R16a` so the dock and concourse are pitch black on arrival (lit only by Train Car B's steady cabin lights).
  - Lock Jay into cutscene (`playerControl` locked, `playerFrame`) looking out the right-side windows down toward the dark `R16a` platform floor as the train stops and `r16a_north` seals behind it.
  - Play a second Transit PA announcement (*auxiliary exterior lights engaged*) and switch on **two pre-allocated downward exterior auxiliary lights** on Train Car B aimed at the platform floor, catching the edge of the blood pools (`transit:train_aux_lights`).
  - Jay reacts (*"Wait... is that blood?!"*), the camera pans smoothly up to eye level toward `R16b`, and a heavy bass horror impact hits as `R16a`/`R16b` overhead lights **flicker bright 2–3 times**—revealing the blood-drenched massacre and fallen crew—before dying back to pitch black.
  - During the flicker/darkness, a corpse near the right edge of the concourse frame is dragged away into shadow.
  - Brief tense banter inside the cabin: Giles and Okafor decide to step out and check the terminal, telling Jay to stay put in the car.
- **Surveillance camera finale, weapon-mounted flashlights, pillar-cam 0.5 s monster reveal & cliffhanger handoff (`src/ai/squad.ts`, `src/actors/body.ts`, `src/data/sequences/action_climax.json`, `src/data/levels/slice01.json`)**:
  - Open Train Car B's boarding door; turn off Jay's flashlight (`playerFlashlight: false`) and hide Jay's weapon viewmodel (`weapons: false`) as Giles and Okafor step out onto the `R16a` platform.
  - Cut to **Surveillance Camera 1** (`cameraFeed` fullscreen, e.g. `CAM 09  ARRIVAL DOCK`) watching Giles and Okafor step off the train, announce *"Flashlights on."*, switch on their **dynamic weapon-mounted flashlights** aimed west into `R16b`, and advance up the stairs into the dark concourse.
  - All dialogue during surveillance view plays through the gritty `channel: "radio"` filter: Giles and Okafor cautiously advancing, then panic and gunfire (muzzle flashes + pistol shots) as something moves in the dark.
  - As soon as they open fire, hard-cut to **Surveillance Camera 2** (`CAM 10  CONCOURSE`) framed tight on one of the `R16b` pillars: weapon-flashlight beams and bright muzzle flashes light the left side of the frame, and the **big monster** (`hero` creature) steps out from behind the pillar on the right side of the frame for **~0.5 s**—
  - **Hard cut to black + dead silence** (SFX cut), emitting `story:cliffhanger` to trigger the existing `title_card` (`THALASSA / SLICE ONE`) -> `stinger_priya` (`CAM 04 MEDBAY`) -> `endSlice`.
- **Audio & VO (`src/data/dialogue/slice01_action.json`, `src/audio/sounds.ts`, `scripts/ambience-generate.ts`)**:
  - Play the buildup score during the cabin sequence and cut it before the surveillance feed starts.
  - Author the Transit PA announcements and R16 arrival/surveillance dialogue lines in `src/data/dialogue/slice01_action.json` and generate VO clips on each speaker's pinned Gemini TTS model (`pa`, `player`, `engineer`, `medic`).
  - Generate ElevenLabs SFX for traction power-down, heavy bass horror impact, and monster reveal sting/roar.
- **Restore & debug jump support (`src/data/sequences/action_restore.json`, `src/app/session.ts`)**:
  - Support `?debug&jump=r16_finale` (jumping directly into Train Car B gliding into pitch-black `R16a` or right at the arrival cutoff) so the full R16 finale can be iterated and verified directly in the browser.

## Capabilities

### New Capabilities
- *(none — extends existing `transit-wing` spec)*

### Modified Capabilities
- `transit-wing`: Add requirements for tunnel emergency-red power loss and Transit PA reserve coasting, pitch-black `R16a`/`R16b` arrival with Train Car B downward exterior auxiliary lights, the bass-hit flicker massacre reveal and edge-of-frame body drag, squad weapon-mounted dynamic flashlights, two-angle fullscreen surveillance camera finale (`CAM 09` -> `CAM 10` pillar split with 0.5 s big-monster reveal), and hard blackout cut into `story:cliffhanger`.

## Impact

- World & Lighting: `src/world/kit/transit.ts`, `src/data/levels/slice01.json` (fixed light budget preserved via pre-allocated lights)
- Squad & Combat Visuals: `src/ai/squad.ts`, `src/actors/body.ts` (weapon-mounted dynamic spotlights and scripted pistol firing / muzzle flash boost for CCTV readability)
- Sequences & Dialogue: `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `src/data/dialogue/slice01_action.json`
- Audio & VO: `src/audio/sounds.ts`, `scripts/ambience-generate.ts`, new ElevenLabs SFX in `public/assets/audio/ambience/`, new Gemini TTS VO clips in `public/assets/vo/`
- Session & Tests: `src/app/session.ts`, `src/script/action.test.ts`, `src/world/kit/transit.test.ts`, `src/ai/squad.test.ts`

## Out of Scope

- Post-slice gameplay inside `R16b`/`R16c` (Slice One ends on `story:cliffhanger` -> `title_card` -> `stinger_priya` -> `endSlice`).
- Changes to `R16c` Arrival Dispatch interior dressing (remains an undressed shell per `transit-wing` spec).
