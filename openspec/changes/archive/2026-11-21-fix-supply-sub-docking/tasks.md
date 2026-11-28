# Tasks

## 1. Submarine Scale and Dock Berth Framing

- [x] 1.1 Reset `SUB_SCALE` to `1` (`14.5 m` dock-fit length) in `src/render/fx/subModel.ts`, update the scale note in `docs/modular-grid-standard.md`, and verify `npm run typecheck` passes.
- [x] 1.2 Re-center the `supply_sub` berth in `scripts/gen-slice01.mjs` (remove `alignBow: true` and place the docked centre around `X ≈ 5.5` so the hull, cradle clamps, sail running lights, and bow spotlights sit inside the `R01` dock window along Jay's intro sightline), regenerate `src/data/levels/slice01.json` via `node scripts/gen-slice01.mjs`, and verify with `npm test -- src/world/slice01.test.ts`.

## 2. Subtle Hull Visibility and Bow Spotlights

- [x] 2.1 Add a subtle wet specular term to `extLamps()` in `src/render/fx/exteriorLight.ts` (keeping `WATER_COLOR`, `WATER_DENSITY`, and `EXTERIOR_AMBIENT` unchanged) and verify shader hooks and lamp packing pass `npm test -- src/render/fx/exteriorLight.test.ts`.
- [x] 2.2 Export/share the soft-edged, marine-snow, water-fogged volumetric beam shader from `src/render/fx/exterior.ts` and update `supply_sub` in `src/world/kit/slice.ts` so its two bow spotlights sit in view through the `R01` window, use the shared volumetric beam shader (ticking `uTime`), and tune tilt/range/intensity plus subtle `R01` dock floodlight grazing so the hull catches a hint of light and both headlamp beams sweep moving pools across the seabed below `R01`; add/update unit assertions in `src/world/slice01.test.ts` and `src/render/fx/exterior.test.ts` verifying both headlamp markers sit within the `R01` window span and aim onto the seabed, and run `npm test -- src/render/fx/exterior.test.ts src/world/slice01.test.ts`.

## 3. ElevenLabs Underwater Docking Audio

- [x] 3.1 Add muffled underwater-through-hull ElevenLabs prompts for `subPass` (`oneshot-sub-pass.mp3`, ~10–11 s) and `subClamp` (`oneshot-sub-clamp.mp3`, ~6–7 s) to `scripts/ambience-generate.ts`, generate both clips with `npm run ambience:generate -- --id subPass` and `npm run ambience:generate -- --id subClamp`, and verify both MP3 files exist in `public/assets/audio/ambience/`.
- [x] 3.2 Register `subPass` and `subClamp` in `SAMPLE_URLS` in `src/audio/sounds.ts`, remove the local procedural `subPass` and `subClamp` functions and `SOUND_SPECS` entries, update the `bulkhead` door fallback in `src/audio/doorAudio.ts` from `'subClamp'` to `'metalKnock'`, and verify `npm run audio:audit` and `npm test -- src/audio/engine.test.ts` pass.

## 4. End-to-End Verification

- [x] 4.1 Run `npm run typecheck`, `npm run audio:audit`, and `npm test` to confirm all unit tests and audio checks pass cleanly.
- [x] 4.2 Exercise a new-game intro in the browser (`?slot=scratch`) and confirm visually and audibly: the Halcyon docks at dock-fit proportions framed inside the `R01` window, the ocean stays dark while a subtle hint of the hull and sail running lights read through the glass, both bow spotlights project soft volumetric beams and sweep lit pools across the seabed, and the muffled underwater ElevenLabs `subPass` and `subClamp` clips play cleanly in sync with docking and clamping.
