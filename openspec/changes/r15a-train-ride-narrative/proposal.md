# Proposal

## Why

Phase 3 Part 1 (`r11-power-bay-narrative`) restored transit power in `R11`, opened `D_R13d_R11`, and updated the player's objective to board the transit train in `R15a` Departure Boarding Bay. However, entering `R15a` and stepping into Train Car A currently triggers no narrative sequence, squad boarding choreography, transit SFX, or Heins radio exchange—leaving the 3-stage abyssal train ride silent and disconnected from the `R16a`/`R16b` arrival finale.

## What Changes

- **Add `R13d` walk-and-talk transit banter & `R15a` boarding choreography (`src/data/sequences/action_climax.json`, `src/data/levels/slice01.json`)**:
  - **`r13d_transit_walk`**: As soon as `R11` opens `D_R13d_R11`, Giles and Okafor walk ahead out of `R11`, east through `R13d` Maintenance Corridor, and through `D_R13d_R15a` into `R15a` while Jay has full free-roam—exchanging banter about what to do next (heading to `R16` Arrival Terminal for the deep-lift / evac shuttles, whether the sealed sea-tunnel is clear, and checking rounds before stepping off).
  - Add `trigger:r15a_enter` on the `R15a` west platform (just inside `D_R13d_R15a`) and `trigger:r15a_boarded` inside Train Car A's cabin, plus cabin standing anchors for Giles (`r15a_train_giles`) and Okafor (`r15a_train_okafor`).
  - **`r15a_boarding`**: Once in `R15a`, Giles and Okafor react to the powered train, move across the boarding gap into Train Car A, and take positions inside the cabin (keeping player movement free until Jay steps aboard).
  - **`r15a_train_ride`**: When Jay steps inside Train Car A (`trigger:r15a_boarded`), `obj_transit_board` completes, the cabin door seals, `r15a_south` opens, and `TransitRideController` runs the 3-stage abyssal transit ride with Stage 2 (`sea_tunnel`) extended via `tunnelSeconds` (~30 s) to accommodate the full Heins radio exchange during cruise.
  - **Heins radio exchange over rear-bulkhead comms terminal**: During Stage 2 cruise, the rear-bulkhead `train_comms_terminal` chimes and lights up (`transit:comms_state`), and Security Chief Katie Heins (`chief`, `channel: "radio"`) hails the car. She confirms she saw the transit rail come back online, tells them upper-deck security is pinned down, warns that the Arrival Terminal (`R16`) went dark and stopped answering after evacuation teams headed down there, and breaks up into abyssal static as the train decelerates into `R16a`.
  - **Clean arrival handoff to Part 3 (`r16-arrival-finale`)**: As Train Car B glides through `r16a_north` and stops at the `R16a` platform (keeping its boarding door closed and sealing `r16a_north` behind it), the sequence sets `transit_ride_done`, saves checkpoint `cp_r16_arrived`, and emits `transit:arrived_r16` for Part 3 to pick up.
- **Add rear-bulkhead comms terminal visual feedback (`src/world/kit/transit.ts`)**:
  - Listen for `transit:comms_state` (`idle` | `ringing` | `active` | `lost`) on `train_comms_terminal` so its status LED pulses amber while ringing, glows steady green/teal while Heins is on the line, and drops to dim red when the signal breaks up in the deep bore.
- **Generate VO and transit SFX**:
  - Author the `R15a` boarding and train-ride dialogue script in `src/data/dialogue/slice01_action.json` and generate VO clips for Giles, Okafor, Jay, and Heins on each speaker's pinned Gemini TTS model (`scripts/vo-generate.ts`, per `docs/voice-casting-standard.md`).
  - Generate ElevenLabs SFX (`scripts/ambience-generate.ts`) for train door pneumatic close, heavy blast-gate open/close, train pull-out acceleration, abyssal tunnel cruise hum/rattle, arrival braking stop, and comms terminal incoming chime/static burst; register them in `src/audio/sounds.ts`.
- **Restore & debug jump support**:
  - Update `action_restore.json` and `src/app/session.ts` (`?debug&jump=r15a`, `?debug&jump=transit_ride`) so both the boarding beat and the full narrated train ride can be inspected directly in the browser.

## Capabilities

### New Capabilities
- *(none — extends existing `transit-wing` spec)*

### Modified Capabilities
- `transit-wing`: Add requirements for `R15a` boarding choreography, rear-bulkhead comms terminal state feedback, synchronized transit ride SFX, the Stage 2 Heins radio exchange, and the `R16a` arrival handoff (`transit_ride_done` / `transit:arrived_r16`).

## Impact

- Level & Kit: `src/data/levels/slice01.json`, `src/world/kit/transit.ts`, `src/game/transitRide.ts`
- Sequences & Dialogue: `src/data/sequences/action_climax.json`, `src/data/sequences/action_restore.json`, `src/data/dialogue/slice01_action.json`, `src/data/objectives.json`
- Audio: `src/audio/sounds.ts`, `scripts/ambience-generate.ts`, new ElevenLabs SFX in `public/assets/audio/ambience/`, new Gemini TTS VO clips in `public/assets/vo/` (tracked in `scripts/vo-takes.json`)
- Session & Tests: `src/app/session.ts`, `src/script/action.test.ts`, `src/game/transitRide.test.ts`, `src/world/kit/transit.test.ts`

## Out of Scope

- `R16a`/`R16b` lights-off arrival horror reveal, flicker-to-blood/bodies beat, security camera feed cut, weapon-mounted flashlights, monster roar, title card, Priya CAM 04 stinger, and end credits (covered in Phase 3 Part 3: `r16-arrival-finale`).
