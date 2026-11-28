# Design

## Context

See proposal.md - Why. What exists today, as it shapes the approach:

- `drop.json` runs `npcAnim writhing` (a lying pose), then `transform researcher_b to 3 duration 7` in parallel with lines,
  lights and klaxons. `Humanoid.startTransformation` drives `infectionLevel` 0->3 on `smooth()` and sets
  `animator.convulse` to `0.35 + 0.65*sqrt(sin(pi*1.15s))`, which stays at 0.35 or above for the whole 7 s. Foot IK is off
  while it runs.
- The growth, shard, rib and tendril extra bones exist only on procedural bodies (`bodyGeometry.ts`). Imported bodies
  (`bodyModel.ts`) carry only detail and stump extras, so stage 3 on an imported body is the infection tint, glow and
  `hand`/`foreArm` scaled along local Y.
- `castSpec('lab', 'researcher_b')` picks `botanist3` by FNV hash. `speakerBodies.ts` maps `crew_<x>` to NPC `<x>`, so
  `crew_lab` finds no body: no jaw, no gestures, and the local line plays centred.
- Reusable pieces: `Animator.playSequence` (authored pose steps from `poses.json`), `Animator.kick` (additive hit
  reactions), `springs.ts`, `GoreSystem.spurt/burst/chunks/pool` with `GoreClip` planes (blood stops on the glass and runs
  down), the R04 `glass labb cracked` beat that breaks the Lab B floor, and `bodyMaterial.ts`'s `onBeforeCompile` hook.
- `audio-assets`: new SFX come from ElevenLabs; vocal reactions come from Gemini TTS, and other clips must be credited.

## Goals / Non-Goals

**Goals:**
- A kill set piece that works on **any imported body**, so a better Voss model or a new victim drops in without new code.
- Body, voice, blood and sound locked to one cue timeline.
- Keep the two kill kinds behind one sequence step so later victims reuse it.

**Non-Goals:**
- Ragdoll during the kill beats. Panic and impacts are authored poses plus additive kicks and springs, so the timing stays locked to the audio. Physics around the kill (the burst's chunks colliding, her body settling once she is still, the bench props she knocks over) belongs to `adopt-physics-engine`.
- Morphing one mesh into another. No topology-crossing morphs, no point-cloud morphs.
- New runtime dependencies. `GoreSystem` is extended; three.quarks stays an option only if it fails the budget (see Risks).
- Changing the converted path visually beyond keeping it working (`transform` stays for now).

## Decisions

### D1. Grown inside = two bodies and a hand-off, never a deforming mesh
At the burst, Voss's body switches to a `torn` corpse state (chest region hidden or cut by a stump extra, `pool` under it)
and the creature spawns at her chest joint, in a curled start pose, then unfolds. The burst gore covers the frame where
both exist.
*Alternatives:* a dissolve cross-fade (reads as magic, and needs two shaders tuned per model); morph targets (impossible
across topologies); the old `transform` on the human mesh (the current broken result).

### D2. A `kill` step with authored beats, cued from audio
Add one sequence step, `{ "do": "kill", "npc": "researcher_b", "kind": "grownInside", "creature": "<variant>" }`. It runs
a beat list stored as data (a new `data/kills.json`, one entry per kill style):

```
beat     pose seq (poses.json)   convulse   cue to advance              fx / sfx
-------  ----------------------  ---------  --------------------------  ---------------------------
scratch  kill_scratch_arm        0.2        drop_voss_01 line ends      under-skin crawl on forearm
panic    kill_backpedal          0.2->0.5   1.6 s                        bench props kicked; panic breath
glass    kill_glass_pound        0.5        palm contact events x3       hand-print decals; scream 1
arch     kill_arch               0.5->0.9   scream 1 ends                chest bulge; crunch x3; scream 2
burst    kill_burst              1.0        0.35 s                       burst + chunks + spurt; tear; splat
still    corpse (torn)           0          1.5 s                        drip; two death twitches
creature (creature body)         -          unfold seq ends              creature clicks; then shamble
```

Beats advance on whichever comes first: the cue or a safety timeout, so a missing audio file never stalls the scene
(matches `voice-playback`'s missing-recording rule). `say`, `lightState` and klaxon steps in `drop.json` can listen for
`kill:<beat>` events instead of using fixed `wait`s.
*Alternatives:* keep timing in `drop.json` with waits (what drifts today); hard-code beats in `humanoid.ts` (not reusable).

### D3. Convulsion is a ramp plus discrete kicks
Each beat sets a convulse target and the animator eases toward it. Crunches fire `Animator.kick` on spine/chest/neck
with the impulse in the SFX's timing, so each crunch is seen as well as heard. The flat `sqrt(sin)` curve stays only for
`transform` (converted).

### D4. Under-skin movement is a vertex-shader bulge, in bone space
Extend `bodyMaterial.ts`'s `onBeforeCompile`: up to 4 bulge centres (uniform array), each given as a bone index plus an
offset and radius. The vertex shader displaces skinned positions along the normal with a gaussian falloff and darkens a
vein mask around them. The script animates centres along a path (wrist -> elbow -> shoulder -> chest). Because it is
bone-relative and post-skinning it works on any imported model.
*Alternative:* a skinned parasite mesh under her sleeve (needs per-model fitting, and clips through clothes).

### D5. Blood that hides the swap but keeps the view
- In-room: `burst` at chest towards the glass, `chunks` with the glass `GoreClip`, `spurt` from the tear for the `still` beat,
  wall and bench hits, a floor `pool`.
- On the glass: one arterial streak decal low (below 1.0 m) that runs down over ~6 s, plus the hand prints. A **clear band
  between 1.1 m and 1.8 m** (her chest to head height, seen from the gallery anchors) gets no splatter decals; particles
  hitting it still run down and fade.
- Light: a cold white key on her (Lab B's `#e8f4ff` fixture, held steady from `glass` to `still`) so blood reads red under
  the alarm tint; the alarm only takes the room fully at `creature`.
- A 2-frame light dip at `burst` (reusing the `flicker` pattern) as a second mask for the hand-off.

### D6. Voss is a named cast member
`CAST['voss']` with a fixed imported female model and `handRig`; `researcher_b` uses `look: "voss"`; `speakerBodies`
gets `crew_lab: 'researcher_b'`. Until a lab-coat model is licensed, use `office2` or `office3` as a stand-in so the gender
is right immediately.

### D7. Sounds
New sound names, one recorded file or several variants each, registered in `src/audio/sounds.ts`:
`kill_crunch` (x4), `kill_tear`, `kill_burst`, `blood_splat_glass` (x3), `blood_drip` (loop), `creature_clicks`, from
ElevenLabs SFX through a new `gore` manifest (`scripts/gore-generate.ts`, same shape as `ambience-generate.ts`). Vocal
reactions (`voss_panic_breath`, whimpers) come from Gemini TTS in Voss's pinned voice. Screams stay the credited
OpenGameArt clips she already uses, so her voice stays one performer.

## Risks / Trade-offs

- [The sandbox cannot reach `api.elevenlabs.io` (403 blocked-by-allowlist)] -> run `scripts/gore-generate.ts` locally,
  or allow the domain in the agent's network settings; procedural fallbacks are not allowed for new sounds, so the scene
  plays these as silent until the files exist.
- [Imported rigs have inconsistent bone axes, so kicks and bulges point the wrong way] -> express kick directions and
  bulge offsets in group space and convert per bone; verify with threejs-devtools `skeleton_details` on the chosen model.
- [Blood particle count spikes at the burst] -> stay inside ADR-0015's gore budgets; reduced-gore mode uses dark blood and
  fewer chunks as today. three.quarks only if the in-house system cannot hit the look within budget.
- [The creature's start pose clips through Voss's corpse] -> spawn curled at the chest joint, scaled 0.6, and grow to 1.0
  over the unfold; the burst gore covers the first 0.3 s.
- [A female lab-coat model with a usable licence may not exist on Sketchfab] -> the stand-in model in D6 ships first.
- [`necromorph_slasher` may not fit "grew inside a woman in 3 days"] -> creature is a parameter of the `kill` step, so it
  can be swapped without touching the beats.

## Migration Plan

1. Land D6 alone (cast entry + speaker mapping): it fixes the wrong body and silent mouth with no timeline change.
2. Add the `kill` step and `kills.json` behind the existing `drop` sequence; switch `drop.json` from `transform` to `kill`.
3. Update `quiet.test.ts` (it asserts `npc transform researcher_b`) to assert the kill beats in order.
Rollback: revert `drop.json` to the `transform` step; the old path is untouched.

## Open Questions

- Which Sketchfab model becomes Voss's final body (licence check pending).
- Exact creature asset: `necromorph_slasher` as is, or a smaller, wetter variant later.
