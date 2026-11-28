# Proposal

## Why

Giles and Okafor fight beside Jay, but they do it empty-handed and silently: in combat they raise an empty-handed `aim_pistol` pose, and their shots (`squad:fired`) play no sound at all. The player cannot hear covering fire, and cannot see who is shooting. Giving both of them a real pistol, with its own gunshot and the brass it ejects, makes the squad read as armed allies.

## What Changes

- Both squad mates (Giles, the engineer, and Okafor, the medic) carry the same sidearm, an H&K USP. It is the Sketchfab model by Urpo, CC BY 4.0, imported as a small held prop.
- The pistol shows in the right hand whenever the mate is in the aim pose, and is hidden in every other pose, the same way the mug and the scanning wand follow their poses. It sits in that body's own grip and points where the mate aims.
- Each squad shot plays a squad gunshot from the pistol's muzzle. It is a recorded pistol shot ("pistol shot" by mrfriends, Pixabay Content License), separate from Jay's own clip, with its pitch varied per shot. The slide kicks back on each shot.
- Each squad shot shows a muzzle flash at the pistol's muzzle, and the flash lights the room around it, as Jay's own flash does.
- Each squad shot ejects brass from the pistol's ejection port. It lands through casing-drop-audio's landing sounds, with the same surface rules as Jay's brass.
- The squad's hit origin moves from a fixed point 1.4 m above the mate to the pistol's muzzle.
- Credits: a `CREDITS.md` row for the USP and one for the squad gunshot. (This change first added rows for DJMaesen's viewmodel guns too; another change then replaced those guns with JUST's models and their credits.)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `held-props`: adds the squad pistol as a held item: which pose shows it, how it sits in each body's hand, and that it points along the aim.
- `in-world-audio`: adds the squad gunshot (positional, from the muzzle, distinct from Jay's) and squad brass (landing by surface, as Jay's does).

## Impact

- **Depends on:** casing-drop-audio, for its casing landing entry point. squad-sidearms can be built in parallel, but its brass task waits for it.
- **Code:** `src/actors/heldProps.ts` and `src/actors/heldGrip.ts` (a new `pistol` held item), the squad body or animator attachment, `src/ai/squad.ts` (shot origin from the muzzle), and `src/app/session.ts` (wiring `squad:fired` to sound, slide kick and casing).
- **Assets:** `public/assets/models/weapons/squad_pistol.glb`, built by a small import script from the raw download kept in `../props-src/`. Also the squad gunshot under `public/assets/audio/weapons/`, trimmed from the raw download kept in `../audio-src/weapons/`.
- **Not changed:** squad accuracy, damage and fire rate. Infected hearing, which squad shots still do not trigger. Jay's viewmodel guns, apart from their credits.
