# Tasks

> Implementation note: Apply this change using the `threejs-game-director` skill to guide visual art-direction, lighting polish, and browser verification.

## 1. Transit Kit Pieces for R16a Overhaul

- [x] 1.1 Extend `transit_depart_board` in `src/world/kit/transit.ts` with a `mode: 'departure' | 'arrival'` parameter (default `'departure'`) so `R16a` displays Arrival Track Dock status without changing `R15a`, and verify with unit tests in `src/world/kit/transit.test.ts` (`npm test -- src/world/kit/transit.test.ts`).
- [x] 1.2 Add `transit_rotating_beacon` in `src/world/kit/transit.ts` with red rotating twin volumetric beams, `reducedFlashing` steady-lens fallback, claimed `'emergency'` light slot, `transit:r16_beacons` `{ on: boolean }` listener, and level-reset cleanup; add unit tests in `src/world/kit/transit.test.ts` covering rotation, `reducedFlashing`, toggle, and reset (`npm test -- src/world/kit/transit.test.ts`).
- [x] 1.3 Add `blood_decal` (cached glossy dark-red floor/wall pool, spatter, drag, and smear variants using `polygonOffset`) and `fallen_body` (uncollided crew silhouette prop movable via `Level.setPropTransform`) in `src/world/kit/transit.ts`, and verify their geometry, material sharing, and non-blocking collision in `src/world/kit/transit.test.ts` (`npm test -- src/world/kit/transit.test.ts`).

## 2. R16a Ocean Windows, Clean Transit Architecture, Signage & Props

- [x] 2.1 Replace `R16a`'s east-wall track panels (`[22, 0, 8..10]`, `rot: 270`) in `src/data/levels/slice01.json` with `wall_window` (`flicker: true`) so exterior floodlights cast beams out into the dark ocean behind Train Car B, and add track-side conduit/rail signal dressing; verify with `npm test -- src/world/slice01.test.ts`.
- [x] 2.2 Dress `R16a` in `src/data/levels/slice01.json` with overhead gantry ribs/beams (keeping the `12 m` west stair opening unobstructed), hung `pipe_run`s, the arrival-mode `transit_depart_board`, `room_sign` (`R16A`), directional `transit_sign` (`ARRIVAL CONCOURSE`), and north/south platform prop clusters (seating, luggage/crates, electrical/comms cabinets) keeping `z = 33.2..36.8` clear; verify headless walkability and grid compliance via `npm test -- src/world/slice01.test.ts`.

## 3. Horror Blood Dressing, Rigged Fallen Crew Bodies, Named Lighting & Rotating Pillar Beacons

- [x] 3.1 Place dense dark-crimson CC0 `blood_decal` pools, spatter, smears, and wall/pillar leaks across `R16a` (platform, west stairs, north/south walls) and `R16b` (concourse floor and all 6 facing pillars); verify in `src/world/slice01.test.ts`.
- [x] 3.2 Upgrade `R16a`'s overhead lights in `src/data/levels/slice01.json` with explicit IDs (`r16a_light_*`), 1–2 `shadow: true` hero lights, and warm/cool contrast while keeping the south dark bore unlit; mount `transit_rotating_beacon` props on the facing inner faces of `R16b`'s concourse pillars (and flanking `R16a` dock faces); verify named-light blackout (`tintRoomLights('R16a', 'black')`), selective `setLight` flash, and beacon reset in `src/world/slice01.test.ts`.
- [x] 3.3 Add debug preview support in `src/app/session.ts` for `?debug&jump=r16&r16mode=blackout|emergency` so default full lighting, pitch-black blackout, and rotating red pillar beacons can all be inspected directly; verify `npm run typecheck`.
- [x] 3.4 Add 5 varied dead poses (`corpseSprawled`, `corpseCurled`, `corpseTwisted`, `corpseReaching`, `corpseWallSlump`) to `src/data/poses.json`, add `dead: true` and `blood: true` support in `NpcData`/`NpcDirector`/`BodyMaterials` (static grounded `Humanoid` corpses with zero AI/collision/breathing and UV-composited dark-crimson blood splatters), replace the raw-GLB `fallen_body` props in `R16a`/`R16b` with rigged `dead: true` crew NPCs (including `r16_pillar_body`), and verify grounding, pose validity, and scripted movement in `src/world/slice01.test.ts` and `src/ai/npcs.test.ts`.

## 4. Integration & Browser Visual Verification

- [x] 4.1 Run `npm run typecheck`, `npm test -- src/world/kit/transit.test.ts src/world/slice01.test.ts`, and a browser visual check across `?debug&jump=r16` (full lighting + ocean window behind train + blood/body sightline), `?debug&jump=r16&r16mode=blackout`, and `?debug&jump=r16&r16mode=emergency` (rotating red beacons on facing pillars) plus `?checker` UV check; confirm no clipping, z-fighting, or lighting regressions.

## Workflow follow-up

- Archive the change (`openspec-archive-change`) and sync the delta into `openspec/specs/transit-wing/spec.md` once implementation and visual review are complete.
