# Proposal

## Why

The Commons crew now talk and murmur, but the room itself is silent: nothing scrapes, clinks or brews. Its only room-specific audio is a bed with a faint equipment hum and the kitchen radio, so the kitchen and the full tables read as scenery. This is part 2 of the ambient-life work, after `commons-overheard-chatter`.

## What Changes

All of it before the drop, in the Commons only.

- A chair scrapes when a crew member who wanders between seats gets up from a chair or sits down on one.
- Cups and cutlery clink now and then at tables where crew are sitting.
- Pans, plates and the tap are heard from the kitchen counter while Bram is at his station, after the intro.
- Bram makes a brew now and then while the player is there: he walks to the coffee machine, works it with a grind, hiss and drip, and walks back.
- A scripted scene, the drop or a checkpoint load cuts a brew off.
- The coffee machine is also heard when Bram works it in the intro.
- These sounds are quieter while someone is speaking, and Bram does not start a brew then.

Two fixes to part 1, added after the first listen on 2026-11-26:

- The conversation murmur is raised: it arrived about 20 dB under the room bed, so the other crew sounded silent.
- The pairs' pre-briefing exchanges play after loading the save made as the intro ends.

Out of scope:

- The vending machine, drinks fridge and TV.
- Changes by briefing round and the hush at the gallery call (`station-rising-unease`).
- Other rooms (`sound-rollout`).
- Anything after the drop.
- New animations, carried mugs, or a way to ask Bram for a coffee.
- The Commons room bed and the radio.
- New overheard lines, and how an exchange starts, ends or counts as played.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `in-world-audio`: adds the Commons chair, table and kitchen sounds, Bram's brew, how these sounds sit in the room, and their end at the drop. Existing requirements do not change.

## Impact

- Part 1 code: a level in `src/audio/murmur.ts` and the intro flag read by `src/ai/overheard.ts`.
- Code: a new room-sound controller in `src/audio/`, a new brew routine in `src/ai/`, a way for the ambient-life director to report chair moves and seated crew, and wiring in `src/app/session.ts` and `src/ai/npcs.ts`.
- Data: sound steps in `src/data/sequences/intro_shift_change.json`. No level data changes.
- Assets: new one-shot recordings under `public/assets/audio/ambience/`, registered in `src/audio/sounds.ts`, with `CREDITS.md` lines for any downloaded ones. A little more decoded audio.
- Docs: `docs/PLAYTEST.md`.
- Other work: the intro step waits for the `shorten-intro` change, which edits the same sequence. `npcs.ts`, `session.ts`, `sounds.ts` and `CREDITS.md` carry other uncommitted work.
- Saves: no format change and no new flags.
