# Design

## Context

`SequenceDef.room` (`src/script/types.ts:58`) names one room. `Runtime.update` ends a run when `host.inRoom('player', room)` is false (`runtime.ts:237`), and `begin` refuses a scene that starts while the player is outside (`runtime.ts:360`), keeping its `once`. The four round scenes name no room, so none of this applies to them.

Where the scenes happen, from `slice01.json`:

| Scene | Trigger fires in | Speakers stand in |
|---|---|---|
| `hydro_moment` | R12a Hydroponics Vestibule | R12b Grow Hall |
| `dive_moment` | R13a Wet Vestibule | R13b Launch Hall (Sung is moved there instantly) |
| `admin_moment` | R14a TAG Reception | R14a |
| `hydro_store_moment` | R12e Hydroponics Storeroom | Jay only |

A single `room` does not fit the first two. Bound to the vestibule, the scene would end as soon as Jay walked toward the botanist. Bound to the hall, `begin` would refuse it, because the trigger fires while the player is still in the vestibule, and `once` is then kept for a scene that was never heard.

## Decisions

1. **`room` accepts a string or a list.** `room: ["R12a", "R12b"]`. `playerLeft` is true only when the player is in none of them. The load-time `hasRoom` warning checks each one. Alternative: move the trigger boxes into the halls. Rejected, because it changes level data and the walking path for a timing rule, and `once` scenes still need the vestibule path to stay covered.
2. **Binding by data, no new action.** Only `rounds.json` changes for the scenes. The engine change is the list.
3. **End state comes from `skip`.** A scene ended early runs the same path as a skipped one (`endScene`: `skip`, then `end`, then release NPCs). `dive_moment` ends with `emit trunk:secure`, and an instant step runs on skip, so the case is still secured. Verify in a test, since this is the one scene whose end state matters beyond "seen".
4. **Rooms for `hydro_store_moment`.** R12e only. It has Jay's two lines and no other speaker, so leaving the storeroom ends it, as for the walk-by greeting.
5. **`inRoom` per room.** `gameHost.inRoom(who, room)` stays a single-room test. The runtime loops over the list.

5b. **A line already started finishes (decided with the user).** Leaving drops the queued lines and releases the scene, but the line playing is left to end by itself, and its voice and subtitle follow earshot as before, so it fades as the player walks off. `SpeechManager.stopChannels` takes `letFinish`, and the host passes it for a scene ending (`gameHost`). This also changes `admin_hale` and `researcher_walkby`, whose tests said the line stops at once. A Jay line in progress finishes too, as any started line does.

## Principle

Jay SHALL NOT talk to someone in a room he has already left. This change enforces it for the four round scenes by binding them to rooms. The `dialogue-channels` earshot rule (a Jay line is dropped when every other speaker is out of earshot) already specifies the same behavior, yet Jay kept talking, so the code is not meeting that spec. Task 3.1 finds out why.

**Deferred follow-up:** make the room check the default, so a scene with a `say` from a placed NPC is bound to that NPC's room unless it opts out. It touches every existing sequence, so it is not part of this change. Decide after 3.1: if the earshot rule turns out to work as written, the default is worth doing; if 3.1 finds and fixes a flaw, it may not be needed.

## Earshot finding (task 3.1)

Read from the code; not reproduced at runtime. The earshot rule works as written: `SpeechManager.pump` drops a Jay line when `audibleNow(lane.lastOther)` is false, and `session.ts` decides audibility with `voiceAudibility(...).level >= EARSHOT_LEVEL` (0.01, about -40 dB). That threshold is generous. A voice carries at full gain along its route for 25 m and fades to nothing at 30 m (`VOICE_FADE_START_M`, `VOICE_SILENT_M`), an open doorway only scales it down, and the panner's own falloff (reference 1.5 m) does not reach -40 dB until well past that. So a botanist in the grow hall stays "in earshot" for anyone in the vestibule, the corridor outside it, or a room one door further, and Jay keeps answering.

So the earshot rule and the principle differ: earshot asks whether Jay can still hear the other speaker, and the principle asks whether he is still in their room.  `dialogue-channels` already says a room scene ends when the player leaves the room, which is why binding these scenes is the right fix, and why the earshot rule alone could not be. Nothing to change in `speech.ts`. The deferred follow-up (a default room per scene) is worth doing, since any other unbound conversation has the same behavior.

## Open questions
- None. The maintenance worker (`maint_1`) stands in R13b with Sung, confirmed in task 2.1.

## Risks

- Several round scenes can be started from a debug jump or checkpoint restore while the player stands elsewhere. `begin` already declines those, so the change makes such a start a no-op where it used to play. Tests for the debug route cover it.
