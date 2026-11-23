# Design

## Context

See proposal.md for why. Facts that shape the approach:

- A sequence run speaks on one channel, `seq:<id>`. A `say` step waits on the line's `done` promise; cancelling the step releases the wait but does **not** stop the line (`actions.ts`, `say`). Cancelling a sequence alone would leave the current line playing and its queued lines still to start.
- `SpeechManager` can stop one line by id (`stop`) or everything (`stopAll`), but not one channel.
- `SequenceDef.once` is stamped in `seq:<id>` when the run starts (`runtime.ts:325`), so a cancelled `once` scene never replays.
- The game host already tests room membership: `roomIs()` in `gameHost.ts` uses `level.roomAt()` with the feet raised 0.5 m, and returns "inside" when there is no level or the room id is unknown. `gatherIn` and `ifAllIn` use it through `host.inRoom`.
- The Jay-drop rule (`speech.ts` pump) measures audibility, not room. It stays for scenes without a room.

## Goals / Non-Goals

**Goals:**
- A sequence declares its room once; leaving that room ends the whole scene, voice, subtitles, queue and speaker poses included.
- Opt-in per scene, with no behaviour change for scenes that do not declare a room.
- One presence test, shared with `gatherIn`, so "in the room" means the same thing everywhere.

**Non-Goals:**
- Changing earshot, propagation or bark/hint rules.
- Resuming or restarting a scene on return.
- Converting any scene besides `admin_hale` in this change.

## Decisions

**1. A `room` field on the sequence, not a step.**
`SequenceDef` gets an optional `room: string` (a level room id, validated against the level at load like other room ids). A scene-wide property belongs on the definition; a step like `endIfLeft` would have to be placed correctly in every parallel branch and would miss lines before it.
*Alternative:* a `watchRoom` step at the top. Rejected: it adds ordering rules for no gain.

**2. The runtime checks presence each update, and cancels the run.**
In `SequenceRuntime.update`, for each live run with a `room`, ask the host `inRoom('player', room)`. If false, end the run as cancelled, so control layers, listeners and `onEnd` hooks release as they do today. Checking per frame (not per line) is what makes leaving mid-line work. No trigger event is needed, since the player's position is already available to the host.
*Alternative:* a level trigger box that emits `trigger:hale_leave`. Rejected: two sources of truth for the room, and the box and room can drift apart.

**3. A grace of zero for the room, but doorway counts as inside.**
Presence uses the same `roomAt` test as `gatherIn`. Hale's doorway cells belong to the office room in the level data; the first implementation task confirms this against `slice01.json` and, if the door cell belongs to the corridor, widens the check for this scene only. No time debounce, since a single frame outside the room ends the scene; a debounce would let Jay start a line in the corridor.

**4. Cancel stops the sequence's channel.**
Add `SpeechManager.stopChannel(channel)`: it ends the current line with `'stopped'` and its subtitle, drops the queue, and removes the lane. The runtime calls it for `seq:<id>` (and the named side channels `seq:<id>:<name>`) when it cancels a run for leaving the room. The same hook can serve any cancelled sequence later, but only the room path calls it in this change, so skips, deaths and restarts behave as now.
*Alternative:* make every `say` step's `cancel()` stop its line. Rejected: it changes how cutscene skips and restarts work, and those are covered by other specs.

**4b. An early end applies the scene's end state, not a bare cancel.**
Cancelling alone would leave a walk-by researcher standing in the Commons and `researcher_walkby_seen` unset, since the despawn and the flag are the last steps. On leaving, the runtime stops the channel, then calls the run's existing `skip()` (the path a skipped cutscene takes: `loop`, `parallel`, `spawn`/`despawn`, instant `npcMoveTo`, `setFlag`, and `say` as "marked heard"), then ends the run as cancelled. A scene that sets a flag at its end therefore sets it when cut short.
*Alternative:* an `onLeave` step list per sequence. Rejected: a second script to keep in step with the first, when skip already says what the end state is.

**5. Speakers reset through the existing speech-ended path.**
`wireSpeechActing` and `npcs.lineEnded` already clear gesture and look-at on `speech:ended`. Stopping the line emits it, so Hale drops the gesture. The scene's `npcLookAt` and `npcAnim` steps, which set a persistent look and idle pose, need an explicit release: the runtime asks the host to clear scripted NPC overrides for NPCs the sequence touched. The tasks check whether such a release already exists (`npcSever`) and reuse it.

**6. Stays finished by `once`.**
`admin_hale` is already `once: true`, and the flag is set at start, so no new "ended early" flag is needed. A scene that is not `once` but declares a room would restart on re-entry under its normal trigger; the spec's requirement is for a scene that plays once, and `admin_hale` is the only opt-in.

**7. The card still works.**
The desk-card exchange is a separate sequence (`admin_card`, `item:given`), not part of `admin_hale`. Nothing in it depends on the scene finishing. The task list includes a test for it.

## Risks / Trade-offs

- [Room id wrong, so the scene never ends or ends at once] → The level-load validation rejects an unknown room id for a sequence, and a test with the real level checks that standing at Hale's desk and in the doorway count as inside and the corridor does not.
- [Teleports and cutscenes move the player out of the room mid-scene] → Intended: the scene ends. `admin_hale` is player-driven, so no cutscene moves the player during it.
- [A skipped or restored scene is cancelled twice] → `stopChannel` on an unknown channel is a no-op, and the runtime ends a run once.
- [Hale is left mid-pose if the release is missed] → Covered by a test that checks his pose and look target after leaving.
- [A skipped end applies side effects such as items or objectives] → That is what "stays finished" means for these scenes; a scene whose end state should not apply when cut short does not opt in.
- [Scenes in other rooms want this] → The field is generic; adding it to a scene is a data change plus a spec scenario.
