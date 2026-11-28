# Design

## Context

See `proposal.md`. The run is the first `parallel` block of `sec_glass` (`src/data/sequences/action_security.json`):
Okafor's shout plays at once, her sob plays 0.9 s in on the stumble, and she runs at 5.2 m/s to `priya_wait` by the beds,
where she crouches. In the rescue, Okafor walks to `okafor_window` and she walks to `priya_window` while he says "It's me.
Come to the door." He tries the medical bay door two lines later.

## Decisions

### D1. A new anchor just inside the door

`priya_door_in` (R08, `[4.0, 0, 47.2]`, yaw 0: facing -Z, into the security office) is 1.2 m inside `D_R07_R08` (which
sits on z 46.0 at x 4.0). That is clear of the door leaves as they close 4.6 s into the run, and within the spec's 1.5 m.
`npcMoveTo` turns her to the anchor's yaw on arrival, so the run ends with her facing the door. The existing
`priya_door` (0.3 m inside) is too close to the leaves.

### D2. Timing of the two shouts

Her shout starts 0.1 s into the run. From `priya_r07_hide` the door is about 9 m away, about 1.9 s at 5.2 m/s with the
stumble. Okafor's line starts at 1.5 s, so it begins as she reaches the door. It is still projected from Okafor
(`voiceProject`) as before. The stumble moves from 0.9 s to 1.1 s, after her shout has started.

### D3. Okafor's walk

He walks to `r07_medbay_door` instead of `okafor_window`, so his denied attempt at the door is where he already stands.
Her walk to `priya_window` is removed. The turn-around anchor (`priya_turn_away`) and the walk to `priya_sit` work from the
new spot unchanged.

### D4. Lines and VO

| Id | Speaker | Text | Direction |
| --- | --- | --- | --- |
| `cover_priya_run_02` (new) | nurse | "Don't shoot! Don't shoot!" | screamed while sprinting past armed men, terrified, breathless |
| `sec_okafor_10` | medic | "It's me." | raised to carry through thick glass, steady |
| `sec_okafor_17` | medic | "Sit down by the beds. Breathe with me. In... and out." | low, slow, a doctor pacing a panicking patient; the "In... and out." is breathed with her |
| `sec_priya_18` | nurse | "[a shaky breath] ...Okay. Okay." | trembling, trying to steady herself, close to tears |

`scripts/vo-generate.ts --ids` records each speaker on their pinned model (Priya on `gemini-3.1-flash-tts-preview`, Okafor
on `gemini-2.5-flash-preview-tts`), one request per model, and runs the word check. `cover_priya_run_01` (the sob) stays
in the dialogue file and its reaction pool, so its recordings keep their owner, but the run no longer plays it.

## Risks / Trade-offs

- [The TTS model may not shout convincingly.] → If the take is flat, the fallback per `docs/voice-casting-standard.md`
  is a credited recorded yell. The line keeps its id, so only `audio` changes.
- [Okafor's 2.5-flash quota is 10 requests a day.] → Both his lines go in one request.
