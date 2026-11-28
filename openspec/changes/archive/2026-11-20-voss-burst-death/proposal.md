# Proposal

## Why

The Lab B accident (the `drop` sequence) is the slice's first on-camera horror beat, and it does not land. Dr. Lena Voss
shows up as a male body: she uses the generic `lab` look, which hashes to `botanist3`. Her own lines never reach her body,
because `crew_lab` resolves to a non-existent NPC `lab`. Her transformation is a fixed 7 s noise curve with no relation to
her lines and screams. And the "monster" she becomes is an imported human mesh with stretched hands, since procedural
growths do not exist on imported bodies. The player should see clearly that something grew inside her and killed her.

## What Changes

- Voss becomes a named cast member with a female body, so she looks the same every run and her `crew_lab` lines drive her
  jaw, gestures and positional voice.
- The Lab B death switches from "she slowly converts" to **grown inside**: Voss stays human, panics, convulses, dies when
  a creature bursts out of her chest, and leaves a torn corpse. The creature is its own body (`necromorph_slasher` or a
  replacement), never a deformed human mesh.
- Infected kills come in two kinds a set piece can name: **grown inside** (shown on camera, burst out) and **converted**
  (off-screen or masked; the body is found or revealed already turned). Lab B uses grown inside.
- The death plays as authored beats (scratch, panic, glass, arch, burst, stillness, creature), cued from its audio and
  not from a fixed clock. Convulsion builds over the beats; it does not stay flat.
- Something is visibly moving under her skin before the burst (bulges crawling up the forearm, then pushing from the chest).
- Heavy blood that still lets the player see her: spray, chunks, wall and bench hits, a floor pool, one arterial streak
  low on the glass that runs down. A clear band at her chest height keeps the glass see-through, and a cold white key light
  stays on her so blood reads red under the emergency alarm tint.
- New recorded body sounds (bone crunches, flesh tearing, the burst, blood hitting glass, drips, creature clicks) from
  ElevenLabs SFX. Vocal reactions (panting, whimpers, screams) stay Gemini TTS or credited clips, per `audio-assets`.

## Capabilities

### New Capabilities
- `infection-kills`: How a scripted infected death plays on camera: the two kill kinds (grown inside, converted), the
  victim's beat structure and audio cueing, under-skin movement, the burst and corpse, blood readability through glass,
  and the body sounds that go with it.

### Modified Capabilities
<!-- None: the new sounds follow audio-assets and voice-playback as written. -->

## Impact

- `src/data/sequences/drop.json`: rebuilt timeline; new step kinds or arguments for kill beats.
- `src/data/levels/slice01.json`: `researcher_b` gets Voss's cast look; Lab B gets the white key light and the glass decal targets.
- `src/actors/castLooks.ts`, `src/ai/speakerBodies.ts`: Voss cast entry; `crew_lab` -> `researcher_b`.
- `src/actors/humanoid.ts`, `src/actors/animator.ts`, `src/actors/bodyMaterial.ts`: authored kill beats, a convulsion ramp,
  under-skin bulge shader; the old `transform` path stays for converted kills.
- `src/actors/gore.ts`: burst-from-chest, glass splatter decals, running streaks.
- `src/ai/npcs.ts`, `src/script/actions.ts`: spawn the creature at the burst and hand off from the corpse.
- `src/data/body-models.json`, `CREDITS.md`: a female body for Voss (new Sketchfab model, licence to be confirmed), plus the creature.
- `scripts/ambience-generate.ts` (or a new gore SFX manifest), `src/audio/sounds.ts`: new sound names and files.
  Generating them needs `api.elevenlabs.io` allowed in the agent's network settings, or a local run of the script.
- Tests: `src/script/quiet.test.ts` (the drop test expects `npc transform researcher_b`), `src/world/slice01.test.ts`.
