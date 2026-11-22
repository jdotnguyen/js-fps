# Design

## Context

The squad walk-in sits in a `parallel` block in `intro_shift_change.json`:

```
Sung's branch                         Door branch
-------------                         -----------
t=0.0  Sung -> arch_scan (~2.6 m)     playerFrame anchor:dock_door (1.0 s)
t=1.0                                 door cycles, wait 0.6 s
t=1.6                                 playerFrame "speaker", initial npc:okafor
t=~2.2 say intro_guard_03  ---------> the speaker shot turns to the guard
t=2-8                                 Okafor and Giles walk ~9.7 m in, silent
then   say intro_okafor_01 (at the counter)
```

`playerFrame` with `target: "speaker"` listens for `speech:started` from any branch, and its `initial` aim doesn't count as the last speaker, so the guard's line always takes the shot. `playerFrame` with a `npc:` target is already a tracking shot: it follows the NPC's live position and ignores speech (`src/script/actions.ts`, `aim` with a `moving` resolver).

Okafor's arrival path (`intro_okafor_arrive`, `okafor_start` -> `[0.35,0,-0.95]` -> `walkby_stop`) is about 9.7 m at speed 1.5, so roughly 6.5 s. Giles starts 1 s later on `intro_giles_arrive`.

## Goals / Non-Goals

**Goals:**
- Nobody's line can pull the view off the squad while they walk in.
- The greeting is spoken while Okafor is walking, and the walk ends close to when Jay's reply finishes.

**Non-Goals:**
- Changing how speaker shots work in the engine. No new step options.
- Reframing the guard's lines at the arch ("Morning, Doctor." and the alarm beat still turn the view to the guard).
- Moving Ruiz's or Sung's beats, or retiming the door cycle.

## Decisions

### D1. A tracking shot on Okafor during the walk-in, not a speaker shot

Replace `playerFrame {target: "speaker", initial: "npc:okafor"}` in the door branch with `playerFrame {target: "npc:okafor", duration: 1}`. Because it's a `playerFrame`, it also ends any speaker shot still running from the crew beats. After Okafor's `npcMoveTo walkby_stop` resolves, start `playerFrame {target: "speaker", initial: "npc:okafor", duration: 0.6}` so the scan and banter keep their current behaviour.

Alternatives:
- *Make Sung's scan finish before the door cycles.* This puts back about 1–2 s of dead time that `intro-pacing-gaze-and-lean` just took out, and it only fixes this one race.
- *A new `say` option that never moves the camera.* It would be reusable, but it's an engine change for a one-off. We can revisit it if a second case shows up.

### D2. The greeting runs in a branch next to Okafor's walk

Inside the existing walk-in `parallel`, add a third branch: `wait ~1.5 s`, `say intro_okafor_01`, `say intro_jay_03`, then `say intro_giles_01`. Those three `say` steps come out of their current places after the walk. The `parallel` waits for its slowest branch, so the counter beats start after both the walk and the lines have finished. No timer has to be matched by hand.

Both of Okafor's greeting lines plus the 0.15 s breath come to about 5–6 s, so starting at 1.5 s they end near Okafor's arrival at about 6.5 s. `intro_giles_01` (addressed to Okafor) then plays as Giles reaches the queue spot. If it runs past the walk, the counter beat simply waits for it.

The scan/banter block stays the same apart from `intro_giles_01` leaving it. `intro_jay_04` ("Morning, Giles...") still answers Giles's jab, now with the guard's "Morning, Doctor." between them.

### D3. The tests pin the shot and the line placement, not timings

`intro.test.ts` asserts on structure. The walk-in shot targets `npc:okafor`. No `"speaker"` shot starts between the airlock opening and Okafor's `walkby_stop` move resolving. `intro_okafor_01`, `intro_jay_03` and `intro_giles_01` sit in the same `parallel` as Okafor's arrival walk. The existing NPC move-order, shot-sequence and skip-parity tests stay green.

### D4. Jay's addressed lines turn the speaker shot to the addressee

`beginConversation` currently ignores every line whose speaker has no body. When such a line carries `to` (and `to` isn't `"player"`), it now aims at the addressee: `host.speakerTarget(to)` for speaker ids, or `npc:<to>` when the host can resolve that NPC id. That's the same `to` the NPC gaze already uses (`npc-conversation-gaze`), so the camera and the listener's head agree. Lines from NPC speakers keep aiming at the speaker. Only Jay's lines get the new behaviour, because an NPC's own line should still show the NPC talking.

Alternative considered: a per-step `frame` override on `say`. It's more flexible, but it duplicates the addressee data that the dialogue file already carries.

No existing Jay line has `to`, so the only lines this affects are the eight intro lines this change tags.

### D5. Sung's counter exchange is a tracking shot

In Sung's branch, start `playerFrame {target: "npc:sung", duration: 0.8}` as she steps up to the counter, alongside her `npcMoveTo walkby_stop`. After `intro_sung_02`, start `playerFrame {target: "speaker", initial: "npc:sung", duration: 0.6}`. The next block begins with the dock-door shot as before. Ruiz's scan still plays out in the background, so the player can look over within the 6° mouse give. This uses the same mechanism as D1 and needs no engine change.

## Risks / Trade-offs

- [Okafor greets Jay from about 5–7 m away] → The VO is local-channel and spatialized, so check its loudness in the playtest. If it sounds too distant, push the start wait back by 0.5–1 s.
- [The tracking shot follows Okafor, so Giles may sit at the edge of the frame for his line] → Giles walks 1 s behind on a nearby path, so he should be in view. The 6° mouse give lets the player look over.
- [`intro-pacing-gaze-and-lean` edits the same file] → This change only touches the squad walk-in block and the say steps after it, and keeps every `to` tag.
