# Design

## Context

See `proposal.md` for motivation. `R15a` ("Departure Boarding Bay"), `R15b` ("Abyssal Sea-Tunnel"), and `R16a` ("Arrival Track Dock") already have their finished architecture, walkable train cars (`r15a_train`, `r15b_train`, `r16a_train`), rear-bulkhead `train_comms_terminal`, blast gates (`r15a_south`, `r16a_north`), and `TransitRideController` (`src/game/transitRide.ts`). What is missing is the narrative wiring, trigger zones, squad boarding choreography, rear-bulkhead comms terminal feedback, transit ride SFX, and the Stage 2 Heins radio exchange that bridges `R11` Power Bay into the `R16a`/`R16b` arrival finale.

## Goals / Non-Goals

**Goals:**
- Deliver a continuous, free-movement boarding and transit ride sequence from entering `R15a` through stepping onto Train Car A, riding the 3-stage abyssal transit line, listening to the Heins radio exchange over the rear-bulkhead comms terminal, and gliding to a halt in `R16a`.
- Keep `TransitRideController`'s physics, timings, and seamless stage handoffs intact, using its existing `transit:start_ride` `{ tunnelSeconds }` parameter to give Stage 2 cruise enough room (~30 s) for the radio conversation without rushing or clipping into Stage 3.
- Generate all dialogue VO on each speaker's pinned Gemini TTS model (`docs/voice-casting-standard.md`) and all transit mechanical/comms SFX via ElevenLabs SFX (`docs/audio-assets.md`).
- Hand off cleanly to Phase 3 Part 3 (`r16-arrival-finale`) via `transit_ride_done` and `transit:arrived_r16` with Train Car B's boarding door still closed.

**Non-Goals:**
- `R16a`/`R16b` blackout horror reveal, flicker-to-blood/bodies beat, security camera feed cut, weapon-mounted flashlights, monster roar, title card, Priya CAM 04 stinger, or end credits (Phase 3 Part 3: `r16-arrival-finale`).
- Changing `TransitRideController`'s Stage 1 pull-out distance/duration (`14 m` in `3.8 s`) or Stage 3 arrival glide (`15 m` in `9.0 s`).

## Proposed R11->R13d->R15a & Transit Ride Beat-by-Beat Timeline (Dialogue, SFX, Actions, Doors & Lights)

All dialogue VO will be generated via `scripts/vo-generate.ts` using each speaker's pinned Gemini TTS model per `docs/voice-casting-standard.md`:
- **Giles** (`engineer`): `Algenib` on `gemini-2.5-flash-preview-tts` (6 lines)
- **Okafor** (`medic`): `Charon` on `gemini-2.5-flash-preview-tts` (5 lines)
- **Jay** (`player`): `Orus` on `gemini-3.1-flash-tts-preview` (3 lines)
- **Heins** (`chief`): `Kore` on `gemini-3.1-flash-tts-preview`, pinned accent **General American** (4 lines, `channel: "radio"`)

Total sequence duration: **~20–24 s** walk-and-talk from `R11` through `R13d` onto the `R15a` platform & into Train Car A (100% free player roam throughout; Jay can linger or board whenever ready) + **~44.4 s** for the 3-stage transit ride (`1.6 s` gate open + `3.8 s` pull-out + `30.0 s` Stage 2 tunnel cruise/decel + `9.0 s` Stage 3 glide into `R16a`).

### Part A — `R11` -> `R13d` Walk-and-Talk & `R15a` Boarding (`r13d_transit_walk` + `r15a_boarding`)

| Time (rough) | Beat | Dialogue (ID / Speaker / Emote / Channel) | SFX & Audio | Actions, Animations, Doors & Lights |
| --- | --- | --- | --- | --- |
| `0:00` | **0. Leave R11** | *(follows `r11_giles_07`: "Straight through the maintenance hall...")* | Steady energized `R11` power-bay hum; squad footsteps | `r11_power_bay` finishes, `D_R13d_R11` is **open**, `cp_r11_powered` saves, and `r13d_transit_walk` starts. Giles and Okafor begin walking north through `D_R13d_R11` and east down `R13d` toward `D_R13d_R15a`. Player has **full free roam**. |
| `0:01 – 0:05` | **1. What's the play?** | `r13d_okafor_01` — **Okafor** (`neutral`, `local`): *"Line One runs straight to the Arrival Terminal, yes? What's our play once we get off?"* | Corridor footsteps; clean `R13d` transit hum | Giles leads east through `R13d` (`dark_corridor`); Okafor walks a pace behind. |
| `0:05 – 0:10` | **2. Evac shuttles at R16** | `r13d_giles_01` — **Giles** (`neutral`, `local`): *"Deep-lift and the evac shuttles both stage out of R-Sixteen. If Heins or anyone from topside got a boat prepped, that's where they'll be."* | — | Squad approaches `D_R13d_R15a`; door opens (`state: "open"`) as they reach it so the way into `R15a` is clear. |
| `0:10 – 0:14` | **3. Is the tunnel clear?** | `r13d_jay_01` — **Jay** (`neutral`, `local`): *"Assuming the tunnel's clear. Think anything got down into the transit wing?"* | `D_R13d_R15a` bulkhead cycle SFX | Giles and Okafor step into `R15a` Departure Boarding Bay (`R15a` lights & departure board steady; `r15a_south` blast gate **sealed**; Train Car A door **open**). |
| `0:14 – 0:19` | **4. Solid steel bore** | `r13d_giles_02` — **Giles** (`neutral`, `local`): *"Blast gates stayed sealed when the grid dumped. Plus it's half a click of solid steel bore under the trench—even those things aren't swimming through that."* | Clean industrial rail-bay ambience | Giles pauses briefly on the `R15a` west platform glancing east at the docked train car, then heads toward the boarding gap. |
| `0:19 – 0:23` | **5. Check your rounds** | `r13d_okafor_02` — **Okafor** (`neutral`, `local`): *"Good. Check your rounds before we board, Jay. I don't want any surprises when the doors open on the other end."* | — | Okafor walks toward the `2.2 m` boarding gap behind Giles. |
| `0:23 – 0:28` | **6. Squad boards Car A** | `r15a_giles_01` — **Giles** (`relieved`, `local`): *"There she is—Line One, still on the rails and lit up. Come on, let's get aboard before something changes its mind."* | Footsteps across boarding step onto cabin floor | Giles enters Train Car A to `anchor:r15a_train_giles` (rear-left near comms bulkhead); Okafor enters to `anchor:r15a_train_okafor` (mid-right). |
| `0:28 – 0:31` | **7. Call Jay aboard** | `r15a_okafor_01` — **Okafor** (`neutral`, `local`): *"Jay, inside. Once that bulkhead drops we're not coming back up this way."* | — | Okafor faces the open doorway; `obj_transit_board` (*"Departure Bay: board the transit train"*) points to `anchor:r15a_train_inside`. Squad waits inside while Jay free-roams until stepping aboard (`trigger:r15a_boarded`). |

### Part B — 3-Stage Abyssal Transit Ride & Heins Radio Exchange (`r15a_train_ride`)

| Time (rough) | Ride Stage | Beat | Dialogue (Line ID / Speaker / Emote / Channel) | SFX & Audio | Actions, Animations, Doors & Lights |
| --- | --- | --- | --- | --- | --- |
| `0:00 – 0:01.6` | **Stage 0** (`gate_open`, `1.6 s`) | **3. Cabin seals & blast gate opens** | `r15a_giles_02` — **Giles** (`neutral`, `local`, `wait: false`): *"Door's sealed. Hold onto something—she pulls hard off the dock."* | **`trainDoorClose`** (pneumatic cabin door slide + heavy latch) + **`blastGateOpen`** (heavy hydraulic armored shutter retracting at `r15a_south`) | `trigger:r15a_boarded` fires. `obj_transit_board` completes; `D_R13d_R15a` locks behind them. `transit:start_ride` fires with `{ tunnelSeconds: 30 }`. Train Car A boarding door slides **closed** (collider engaged); `r15a_south` retracts **open** (signals flip green); subtle `cameraShake` (`0.03`, `0.5 s`). Mates locked in cabin. |
| `0:01.6 – 0:05.4` | **Stage 1** (`pullout`, `3.8 s`) | **4. Departure pull-out** | — | **`trainPullout`** (heavy electric bogie motor whine + steel rail clack accelerating out of the bay) | Train Car A pulls `14 m` south (`z: 38 -> 52`) through `r15a_south` into the lit tunnel shroud, carrying Jay, Giles, and Okafor smoothly. Headlights ramp on (`transit:car_motion`). Subtle `cameraShake` (`0.025`, `1.2 s`). |
| `0:05.4 – 0:07.6` | **Stage 2** (`sea_tunnel` accel, `2.2 s`) | **5. Tunnel cruise ramp-up** | — | **`trainTunnelCruise`** (looping deep-sea rail rumble + rhythmic tunnel-rib whoosh; fades in smoothly over `1.0 s`) | Seamless handoff to `R15b` (`r15b_train`). Hallway ramps `7.37 -> 20 m/s`. Cabin stays lit by its own cold teal-white overhead lights (`r15b_train_cabin_a/b`) while lit rib bars scroll past the windows. |
| `0:07.6 – 0:10.5` | **Stage 2** (`sea_tunnel` cruise) | **6. Comms terminal hails** | `r15a_giles_03` — **Giles** (`neutral`, `local`): *"Whoa—rear console's lighting up. That's a live carrier."* | **`trainCommsRing`** (urgent two-tone industrial radio hail chime at rear bulkhead) | `transit:comms_state` `{ state: 'ringing' }` — rear-bulkhead `train_comms_terminal` LED pulses amber. Giles turns toward the rear bulkhead (`train_comms_terminal`) and reaches to key the channel (`panel_work` / `typing` briefly). |
| `0:10.5 – 0:14.5` | **Stage 2** (`sea_tunnel` cruise) | **7. Heins hails Car One** | `r15a_heins_01` — **Heins** (`urgent`, **`radio`**): *"Transit Car One—Jay, is that you? I saw the lower rail bus spike back online."* | `intercomClick` as Giles opens the channel; `voicePlayer` radio bandpass + squelch + static bed | `transit:comms_state` `{ state: 'active' }` — terminal LED shifts to steady green/teal. Okafor turns toward the rear bulkhead listening closely. |
| `0:14.5 – 0:18.5` | **Stage 2** (`sea_tunnel` cruise) | **8. Jay checks in** | `r15a_jay_01` — **Jay** (`relieved`, `local`): *"Chief! Yeah, it's me—I've got Giles and Okafor. We're heading down to the Arrival Terminal."* | Tunnel cruise rumble continues underneath | Free player look/move inside the moving cabin. |
| `0:18.5 – 0:23.0` | **Stage 2** (`sea_tunnel` cruise) | **9. Upper deck status** | `r15a_heins_02` — **Heins** (`alarmed`, **`radio`**): *"Thank God. Listen to me—security's pinned on the upper deck, and we lost the whole south wing twenty minutes ago."* | Radio static/squelch | Giles and Okafor exchange a tense glance inside the cabin. |
| `0:23.0 – 0:26.5` | **Stage 2** (`sea_tunnel` cruise) | **10. Okafor asks about evac** | `r15a_okafor_02` — **Okafor** (`neutral`, `local`): *"Katie, what about the evacuation teams? Did anyone make it to the Arrival Terminal?"* | Tunnel cruise rumble | Okafor steps/leans slightly closer to the rear comms terminal. |
| `0:26.5 – 0:31.5` | **Stage 2** (`sea_tunnel` cruise) | **11. R16 went dark** | `r15a_heins_03` — **Heins** (`dread`, **`radio`**): *"Two squads took the first shuttle down. They radioed in from the concourse, then—nothing. Every camera on R-Sixteen went black."* | Radio static/squelch | Mood shifts cold; Giles looks down at the console, Okafor checks his sidearm. |
| `0:31.5 – 0:33.5` | **Stage 2** (`sea_tunnel` decel starts at `31.4 s`) | **12. Jay's question** | `r15a_jay_02` — **Jay** (`dread`, `local`): *"Black? You mean power's out down there too?"* | **`trainBrakeStop`** begins (deep pneumatic air-brake hiss + rail deceleration groan); `R16a`/`R16b` pre-warm in background | Stage 2 deceleration begins (`20 -> 5 m/s` over `4.0 s`); closed `R16a` blast gate emerges from the fog ahead through the windshield. |
| `0:33.5 – 0:37.0` | **Stage 2** (`sea_tunnel` decel) | **13. Heins's warning cuts out** | `r15a_heins_04` — **Heins** (`urgent`, **`radio`**): *"I don't know—something hit them before they could seal the dock. Jay, do NOT walk into that concourse blind—keep your weapons up and—"* | **`intercomStatic`** harsh static cutoff burst as signal dies | `transit:comms_state` `{ state: 'lost' }` — terminal LED drops to dim red. |
| `0:37.0 – 0:40.0` | **Stage 3** (`arrival`, `0:35.4 – 0:44.4`) | **14. Signal lost & R16a gate lifts** | `r15a_giles_04` — **Giles** (`dread`, `local`): *"Lost her. Too much rock between us and the upper hull."* | **`blastGateOpen`** (fast hydraulic lift of `r16a_north` at `0.1 s` into Stage 3); `trainBrakeStop` tail continues | Seamless handoff to Train Car B (`r16a_train`) at `35.4 s`. `r16a_north` lifts rapidly; Train Car B glides `15 m` south (`z: 20 -> 35`) into `R16a` beside the platform with the concourse on the right. |
| `0:40.0 – 0:43.5` | **Stage 3** (`arrival`) | **15. Docking in R16a** | `r15a_okafor_03` — **Okafor** (`whisper`, `local`): *"We're coming into the dock. Stay ready."* | `trainTunnelCruise` fades out as speed reaches `0` | Giles and Okafor face the right-side boarding door/windows looking out toward the `R16a` platform & `R16b` concourse. |
| `0:44.4` | **Arrived** (`arrived`) | **16. Handoff to Part 3** | — | **`blastGateClose`** (`r16a_north` seals shut behind Train Car B) | Train Car B comes to a full stop. `r16a_north` seals; Train Car B's boarding door remains **closed**. `transit_ride_done = true`, checkpoint `cp_r16_arrived` saves, and `transit:arrived_r16` emits (ready for Part 3: `r16-arrival-finale`). |

## Decisions

1. **Extend Stage 2 cruise via `transit:start_ride` `{ tunnelSeconds: 30 }` rather than changing `TransitRideController` defaults**:
   - `TransitRideController` already accepts `{ tunnelSeconds }` on `transit:start_ride` (with `DEFAULT_TUNNEL_SECONDS = 8.0` for quick debug/unit tests). Passing `tunnelSeconds: 30` from `r15a_train_ride` keeps all existing unit tests and quick debug checks fast while giving the authored Heins radio exchange ~24 s of steady cruise before the 4 s deceleration into the closed `R16a` gate.
   - *Alternative considered*: Pause Stage 2 indefinitely until dialogue finishes. Rejected because `TransitRideController`'s analytical gate-approach math (`RIG_GATE_FINAL_Z + remaining`) depends on a known `tunnelSeconds` duration so the closed gate arrives at `10.125 m` with zero frame-timing drift.

2. **Use `channel: "radio"` on Heins's lines + rear-bulkhead `transit:comms_state` visual cue**:
   - `WebAudioVoicePlayer` already routes `channel: "radio"` through its dedicated 300–3400 Hz band-pass, waveshaper, compressor, squelch clicks, and static bed, and tags subtitles with `[radio]`.
   - Adding a lightweight `transit:comms_state` listener to `train_comms_terminal` in `src/world/kit/transit.ts` (updating the existing `commsLedMat` emissive color/pulse) visually anchors the radio exchange to the rear-bulkhead terminal across `r15a_train`, `r15b_train`, and `r16a_train` without modifying cabin geometry or light counts.

3. **Dedicated ElevenLabs transit SFX (`scripts/ambience-generate.ts`)**:
   - Generate seven focused transit SFX clips via ElevenLabs SFX (`ELEVENLABS_API_KEY`):
     - `trainDoorClose` (`oneshot-train-door-close.mp3`): pneumatic subway/industrial rail door sliding shut with heavy mechanical lock (~1.8 s).
     - `blastGateOpen` (`oneshot-blast-gate-open.mp3`): massive subsea armored blast-gate shutter retracting upward with hydraulic hiss and steel resonance (~2.5 s).
     - `blastGateClose` (`oneshot-blast-gate-close.mp3`): heavy armored blast-gate shutter slamming down and locking sealed (~2.2 s).
     - `trainPullout` (`oneshot-train-pullout.mp3`): electric subsea transit car traction motor spooling up and accelerating over steel rails (~4.2 s).
     - `trainTunnelCruise` (`emitter-train-tunnel-cruise.mp3`): seamless looping interior cabin rail hum, rhythmic sleeper clack, and muted tunnel air whoosh (~8.0 s loop).
     - `trainBrakeStop` (`oneshot-train-brake-stop.mp3`): heavy pneumatic air-brake hiss and steel-wheel deceleration groan coming to a smooth dock stop (~5.0 s).
     - `trainCommsRing` (`oneshot-train-comms-ring.mp3`): urgent retro-industrial two-tone radio hail chime on a metal bulkhead terminal (~1.5 s).
   - Register all seven in `src/audio/sounds.ts` and trigger them from `r15a_train_ride` (and `trainTunnelCruise` via an audio loop or `TransitRideController` / `session.ts` listener on `transit:ride_state` so it cleanly starts on `sea_tunnel` and stops on `arrived` / `idle` / `level:reset`).

4. **Gemini TTS VO batching & quota efficiency**:
   - All 18 new lines fit into **2 Gemini TTS requests**:
     - Batch 1 (`gemini-2.5-flash-preview-tts`): Giles (`r13d_giles_01`–`02`, `r15a_giles_01`–`04`) + Okafor (`r13d_okafor_01`–`02`, `r15a_okafor_01`–`03`) = 11 lines.
     - Batch 2 (`gemini-3.1-flash-tts-preview`): Jay (`r13d_jay_01`, `r15a_jay_01`–`02`) + Heins (`r15a_heins_01`–`04`, pinned General American accent) = 7 lines.
   - Zero speaker recasting, zero off-model drift, and well inside the 10-request/day free-tier limit per model.

5. **Clean handoff to Part 3 (`r16-arrival-finale`)**:
   - `r15a_train_ride` ends when `transit:ride_state` reports `arrived`: sets `transit_ride_done = true`, saves checkpoint `cp_r16_arrived`, and emits `transit:arrived_r16`.
   - Train Car B's boarding door stays closed (matching `transit-wing` spec), and `R16a`/`R16b` lighting/blackout stays untouched in Part 2 so Part 3 (`r16-arrival-finale`) can black out `R16a`/`R16b` before arrival or right on `transit:ride_state` (`arrival`) without conflicting with Part 2.

## Risks / Trade-offs

- **[Risk] Dialogue timing in Stage 2 could drift slightly from `tunnelSeconds: 30` depending on generated VO clip lengths** → Measure actual generated MP3 durations after `scripts/vo-generate.ts` runs and tune `tunnelSeconds` (e.g., `28`–`34` s) so `r15a_heins_04` cuts off right as deceleration starts (`decelStart = tunnelSeconds - 4`).
- **[Risk] Player could sprint straight into Train Car A before `r15a_boarding` finishes** → Make `r15a_train_ride` wait briefly or interrupt `r15a_boarding` cleanly (`lockMatesInCabin` in `TransitRideController` already snaps any mate not yet inside into the cabin seats/positions so the squad is never left behind on the platform).
- **[Risk] `trainTunnelCruise` loop could keep playing if the player resets or jumps away mid-ride** → Tie the loop lifecycle directly to `transit:ride_state` (`sea_tunnel` -> start, `arrived` / `idle` / `level:reset` -> stop/fade out).
