# Handoff: continue building the js-fps slice (written 2026-11-17)

Read this first in a new session. Requirements live in `openspec/specs/` (the old `docs/adr/` decision records were removed;
ADR-00xx numbers below and in code comments refer to them).
Nothing below is committed to git; Justin reviews and commits himself. Never run git.

## Working rules that matter
- The repo is on Justin's Windows PC. From a cloud session, work through the device shell
  (`$HOME/mnt/js-fps`); it has no network, no browser, and `npm run build`/vite can't run
  there (Windows node_modules). Verify with `npx tsc --noEmit` and
  `node --experimental-strip-types --test "src/**/*.test.ts"` (~430 tests, ~100 s; shell calls
  time out at 180 s). Justin does all visual playtesting (`npm run dev`).
- Edit files in place with small exact-string replacements; never retype a file from tool output.
  Files can't be deleted from the device shell without asking Justin for permission.
- Level data is authored by hand, one file per room in `src/data/levels/slice01/` (the generator is frozen).
- Running many parallel subagents burns Justin's usage limit fast; prefer one or two at a time.

## Done (all tests passed at 352/352 before wave 2 started)
- Design: intro rewritten (now openspec/specs/intro-sequence), quiet half (0023), map/objectives/access (0024),
  tutorial prompts (0025), amendments to 0010/0014/0022 and `docs/characters.md`.
  Screenplays: `docs/scripts/intro_shift_change.md`, `docs/scripts/briefing_gallery.md`.
- Story data: intro (44 lines) and briefing (17 lines) sequences in
  `src/data/sequences/drafts/`; ~77 more story lines for every later beat in
  `src/data/dialogue/slice01.json` (commons_*, hydro_*, dive_*, admin_*, drop_*, contact_*,
  cover_*, sec_*, tunnel_*, valve_*, climax_*, end_*, stinger_priya_*); 50 barks + 20 hints in
  `barks01.json`.
- Systems: scripted camera `playerFrame` (6 deg give), speech overlap lane, TAG FM radio
  (`src/audio/radio.ts`, track in `public/assets/audio/music/tag-fm/`), tutorial pop-ups,
  access gating + key items, enemy AI + director + spawn groups (`src/ai/enemy*.ts`), squad
  combat/tasks/revive/biometric/reveal hooks + scripted NPCs + cast looks (`src/ai/squad*.ts`,
  `npcs.ts`, `castLooks.ts`), map/objectives/hints/barks/pickups (`src/ui/map*`,
  `src/game/guidance.ts`), speech + subtitles wired in main.ts, whole level
  `src/data/levels/slice01/` (try `?level=slice01`; names in ADR-0014's "map as built" note).
- [Assumed 2026-11-17] enemies and squadmates push open unlocked auto doors
  (`Level.setActors`, `src/world/level.ts`); locked/sealed/card doors still stop them.

## In progress when the session stopped (wave 2: the story sequences)
Two subagents were cut off by the usage limit partway through. Their partial edits ARE on disk.
At handoff, `npx tsc --noEmit` reported an error in `src/game/supplies.ts` (lines ~128-129:
the new `weapon_shotgun` pickup kind indexes an ammo-only record). Start by running tsc and the
suite and finishing/fixing whatever is half-done. `src/data/dialogue/slice01_action.json`
exists (action-half new lines). Check the level generator for half-made edits.

Remaining work, A then B (or both, carefully):
A. Quiet half (ADR-0023, openspec/specs/intro-sequence): New game loads slice01 and plays the intro (keep ?level=kit_test
   and the demo room reachable); promote intro + briefing out of drafts/ (update intro.test.ts,
   briefing.test.ts); commons free time + `commons_dawdle`; briefing on
   trigger:gallery_brief_spot; three rounds in any order with crew moments, Level 2 Card from
   Hale, hydro storeroom backtrack, `area:dark` in R13d, radio in rooms, cp_round_* checkpoints;
   a reusable render-to-texture security camera feed: action
   `cameraFeed { id, from, lookAt, state: live|static|off, fullscreen? }` on mesh `feed:<id>`
   with a CCTV look, throttled; the admin glimpse; the PA call back; the drop in R03/R04
   (Voss transforms behind glass, red lights, klaxon, glass cracks, lockdown, `drop:done`).
B. Action half (ADR-0014 beats 3-8): shotgun as a weapon pickup in R07a (pistol only before);
   R05 first contact (no fight since trim-lab-wing-encounters: the Voss creature escapes Lab B in the drop's
   blackout and is heard in the ducts); R06 cover-me (Giles bypass task, the escaped creature drops out of the duct,
   90 HP); R07/R08 armory (no play-dead any more),
   Priya's attack through clear glass (she dies on screen; reworked 2026-11-21 as the `mauled` kill), Giles's panel + bandage; R09 biometric door, wading slowdown, valve
   (Mara moment); R11 climax (30 s task, 14 enemies, max 8, a hero); cliffhanger reveal
   (fluid trail, Okafor steps toward Giles, "Stay back, Tomas."), title card, then the
   stinger on a fullscreen camera feed (the bloom raises Priya's corpse), then endSlice. Raise `giles.infectionStage` 1/2/3/4
   at the beats in ADR-0022.
Then: headless tests for every beat chain + skips, ADR progress notes, and a playtest checklist
for Justin.

## Things for Justin to look at
- Judge the TAG FM radio draft (drums and flute are the weak spots).
- Nothing has been seen in a browser: playtest `?level=slice01`, `?level=kit_test&enemies=shambler:3,hero,playDead&debug`, `?debug&seq=cutscene_test`.

## Update (later 2026-11-17)
Done since: Giles bandage/veins/sweat (`castTells.ts`), gore clip plane, `cp_climax_won` + `reveal_restore`, `quiet_restore`, the silent researcher walk-by, TAG FM in the R05 ruin. Also done: Priya's drag is a rope (`npcDrag`, lying pose, no gait; `attachToTrack` accepts anchor lists), a manual save mid-reveal and a death restart into `cp_climax_won` both replay the reveal (`running:<id>` flag in `if`, `onRestart` re-fires restores). Suite 431/431. Still open: nothing has been seen in a browser. See `docs/PLAYTEST.md`.

## Update (2026-11-19, commons pass)
- R02 Commons rebuilt as a cafeteria lounge (galley + servery + menu board, self-serve wall, dining under pendants, window bar SW, rug lounge SE with the TV on the east wall). New kit props in `kit/slice.ts`: `servery`, `menu_board`, `drink_station`, `bin_station`, `rug`, `pendant_light`, `bar_counter`, `wall_clock`, `planter`; `dining_table` takes `caddy`.
- Commons palette is now concrete / concretePainted / labTile: every paint photo slot (paintBone = labPanel, paintTeal, paintDark) is peeling and rusty.
- Engine: flat-colour and static-glow merging in `kit/merge.ts` (see surface-dressing-standard section 6). R01 went 60 -> 51 calls, R02 59 -> 52 with far more dressing.
- The level generator (retired since by split-level-data) now carries the hand edits that had been made straight to `slice01.json` (R01 security post, steel walls and ceilings, R04/R06 danger signs, R12d washroom tiles) via new room options `wallMaterial` / `ceilingMaterial`. Edit the generator, not the JSON. Other sessions were editing the JSON at the same time, so only R02 was spliced in this pass. A full regen would drop JSON-only edits (e.g. ADR-0028 walks) unless they are ported first.

## Update (2026-11-21, overhaul-priya-r08-death: room and kill engine)
- R07 reworked (change `overhaul-priya-r08-death`, design decisions 22-31): one scene from entering the security office to the aftermath (`sec_glass`; `armory_auto`, `sec_glass_near` and `sec_rescue` are gone). R08 is lit on backup power (its own circuit). A room intercom (`src/audio/intercom.ts`, a `pa_speaker` prop with `intercom: 'medbay'` in R07) relays R08 and R08b; the `intercom` and `voiceProject` sequence steps switch it and hold Okafor's voice at 3.5 m. New `medbay` score (`src/audio/scores/medbay.ts`) on the vitals monitor's 0.8 s beat. Dialogue lines can carry a `direction` (VO acting note only). Giles is no longer infected in R06/R07; the cliffhanger still transforms him until it is rewritten.
- R07/R07a/R08/R08b re-staged (change `overhaul-priya-r08-death`, design decisions 10-12): props out of the walls and off the doors, the glass door `D_R07_R08` (sealed) replaces the east medbay pane, the new `instrument_cart` kit piece is the slam stage, Jay's glass spot is 2.28 m from the cart top. `slice01.test.ts` checks placement, the clear stage and lane, the shotgun facing the armory door, and Jay's sightline. The level generator now also emits the `look: 'lab_creature'` contact spawn, so a regen keeps it.
- Kill kinds are now three: `grownInside`, `converted` and `mauled` (`src/data/types/kills.ts`, `src/ai/npcKills.ts`). A `mauled` kill has an `attacker` (an NPC id on the `kill` step) and named `marks` (level refs). Its beat events drive both bodies: `pin`, `grip` (hand on a victim joint, or `release`), `attackerPose`, `haulTo` (`faceMark` on arrival), `slam` (windup, strike, head held on the mark, then `kill:impact {n}`), `throw` (into a glass mark, then a slide to the floor) and `drag`. Beats can end `until: 'impacts'`, and `lines` give the victim's voice per impact (`kill:say` / `kill:cut`, wired to speech in `main.ts`). The grip is kinematic: after every body has moved (`KillDirector.lateUpdate`), her gripped joint goes back into the hand (at most 0.5 m a frame).
- `noticed: { kind: 'stare', at, hold, target: 'player' }` on a `mauled` style: once, during the first beat's approach, the attacker stops and stares at Jay; `kill:notice` brings it forward; the walk makes up the time, so the grab never moves.
- New poses: attacker `maul_grip`, `maul_haul`, `maul_windup`, `maul_impact`, `maul_drag`, `stare`; victim `kill_grabbed`, `kill_hauled`, `kill_slammed`, `kill_thrown`, `kill_slide`, `kill_reach`, `kill_dragged`. Tuned headlessly against the procedural bodies; not yet seen in a browser.
- Flaky, not from this change: `npcKills.test.ts` "each flurry on the glass reports one pound event" (random flurry sizes) fails now and then in full runs.

## Update (2026-11-22, swap-viewmodels-to-just-models: first-person weapons)
- Jay's pistol and shotgun are now JUST's "AnimatedPistol" and "Animated Shotgun" (CC BY 4.0), built by `scripts/fix-just-weapons-glb.mjs` from the Sketchfab glTF and the author's FBX (the sources stay outside the repo). The glTF's gun meshes are out of step with its skin (17x or more away from the hands), so the script rebuilds the gun from the FBX; the arms, skeleton and clips come from the glTF.
- Clips: pistol `Take`, `Shoot`, `Reload` (3.67 s, one reload for empty and part-full, played at 1x), `Hide`; shotgun `Take`, `Shoot` (the shot and the pump in one clip), `ReloadStart`, `Reload` (per shell), `ReloadEnd`, `Hide`, `Watch` (unused). No idle: the rest pose is `Take`'s last frame held, with a small procedural breath (`feel.idle`).
- `WEAPON_MODELS` in `glbWeapons.ts` carries each model's scale (`MODEL_SCALE`, 0.024 m per unit), grip pivot (`ref`), gun bone and muzzle; the poses in `viewmodel.ts` place the grip in camera space (hip is the authored framing seen from a forward eye). The old recoil-cancel mechanism is gone: the recoil springs carry the felt recoil now and are starting values.
- The held flashlight model is gone: the beam is only a light, carried at the left of the chest and pointing exactly along the view on every frame (no spring).
- The pistol rack-on-draw sound (`pistolCock`, `scripts/fit-pistol-cock.mjs`) is removed because the new `Take` has no slide movement. `holster-until-the-drop` still draws the pistol on the first duct bang, now silently. The shotgun pump sample was fitted to the old, longer `PostFire` clip; the new rack is quicker (about 0.2 s), so refit it if it sounds long.
- Tests: `viewmodel.test.ts` (reload and pump flow, cue times, breathing), `glbWeapons.test.ts`, `flashlight.test.ts`, and `scripts/fixJustWeapons.test.ts` (clips, bones, and that every gun part sits on its bones at rest).
