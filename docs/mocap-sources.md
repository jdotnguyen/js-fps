# Motion-capture sources

The clip library (`src/data/mocap-core.json`) is baked from free motion capture onto the shared 21-joint skeleton (spec `mocap-library`, change `per-character-motion`). The bake list `scripts/mocap.sources.json` names every source and every take, and sources live under `previews/sources/mocap/` (gitignored). The only exception is `zombie_walk.glb`, a model already committed under `public/assets/`.

```
node scripts/mocap-fetch.mjs      # download exactly the takes the bake list names
node scripts/bake-mocap.mjs       # bake (stops and names any missing file)
node scripts/bake-mocap.mjs --check
```

## Sources

| Id | Source | Licence | Format | Get it |
|---|---|---|---|---|
| `quaternius-ual` | Quaternius, Universal Animation Library (Standard) | CC0 1.0 | glTF, finger joints | [itch.io](https://quaternius.itch.io/universal-animation-library); `mocap-fetch` uses the [glTF mirror](https://github.com/J-Ponzo/gltf-universal-animation-library) |
| `zombie-walk` | LostBoyz2078, Zombie Walk | CC BY-NC 4.0 | GLB (committed) | already in `public/assets/models/infected/` |
| `cmu` | CMU Graphics Lab Motion Capture Database, BVH conversion by Bruce Hahne | No restrictions on use | BVH, 120 fps, no fingers | [mocap.cs.cmu.edu](http://mocap.cs.cmu.edu/); `mocap-fetch` downloads single takes from the [GitHub copy](https://github.com/una-dinosauria/cmu-mocap). Index: `previews/sources/mocap/cmu/cmu-mocap-index-text.txt` |
| `bandai-1`, `bandai-2` | Bandai Namco Research Motion Dataset 1 and 2 | CC BY-NC 4.0 | BVH, 30 fps, no fingers | [GitHub](https://github.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset); `mocap-fetch` downloads single takes |
| `100style` | Mason, Starke, Komura, 100STYLE | CC BY 4.0 | BVH, 60 fps, no fingers | manual: the BVH-only archive linked from [the dataset page](https://ianxmason.github.io/100style/) (the full set is 15 GB; keep only the styles the bake list names) |

## What each source has

| Need | Quaternius | CMU | Bandai 1 | Bandai 2 | 100STYLE |
|---|---|---|---|---|---|
| Standing idle | `Idle_Loop` | `77_02` standing, `40_10`/`40_11` wait for bus, `82_08` stand still | - | - | - |
| Talk | `Idle_Talking_Loop`, `Sitting_Talking_Loop` | `18_08`/`19_08` conversation with hand gestures, `18_10`/`19_10` quarrel | `respond`, `call` (normal only) | - | - |
| Walk, turn, run | walk, formal walk, jog, sprint | `120_*` style walks, `132_*`/`136_*` odd walks, `77_19`-`77_24` limping (hurt right leg) | walk, run, dash, walk-back/left/right in 15 styles | walk, walk-turn-left/right, run in 7 styles | 100 locomotion styles |
| Sit | `Sitting_Enter`/`Idle`/`Exit` | `13_01`-`13_06` and `14_27`-`14_36` high stool and stepstool, `75_17`-`75_19`, `86_09` | - | - | - |
| Lean | - | `22_18`/`23_18` lean with hands on a high stool, `15_06` lean forward | - | - | - |
| Kneel, crouch | `Fixing_Kneeling`, `Crouch_Idle_Loop` | `22_03`/`23_03` kneel and comfort, `69_70`+ squat and pick up | - | - | - |
| Drink | - | `13_07`-`13_09`, `14_04`/`14_05`/`14_37` drink soda, `22_13`/`23_13`, `62_12` | - | - | - |
| Work, actions | `Interact`, `PickUp_Table`, pistol set | `14_13` mop, `62_11` cleaning up, `79_*`/`80_*` phone, headphones, scared, cleaning window | bow, bye, guide | wave and raise hands (both, left, right) | - |
| Get up from the floor | - | `77_16`/`77_17` lying face-down, getting up (`77_17` is `priya_rise`: face-down 1.6 s, hands and knees, kneel, stand bowed by 6.0 s), `77_18` from lying on the back | - | - | - |

One-shot clips (`loop: false`, such as `priya_rise`) play once and hold their last frame. The bake keeps their hip height from the floor up (the lowest foot in the clip sits on the floor), so a get-up starts with the hips near the floor. Kill beats play them with `clip` (see `src/data/types/kills.ts`).

Some takes stand in a swayback. The performer's pelvis tips forward and the upper back bends back to balance it, so the character sticks his butt out and pushes his chest forward (Bram's `80_14` talk, and `80_37`, his idle before `137_41`). For these, set `"levelTrunk": true` on a standing BVH clip in the bake list.

A standing idle loops for whole scenes, so its take must not carry an incidental action. Bram's first idle, `80_37` ("TV"), had the performer raise and click a remote: in the intro his right hand rose about 27 cm and his wrist flicked on every 3.7 s loop, and scaling the arm motion down still read as the same gesture. Pick a take whose hands rest (`137_41` "Strong Man Wait", 3.2-6.7 s, keeps both hands within about 1 cm on Bram), and measure the hands on the character, not just the source joints.
- **What it does.** The bake removes the take's average forward/back tilt from the pelvis, spine and chest. The chest keeps its own lean, up to 10° forward and 3° back, spread evenly over the lower and upper back. Every frame keeps its motion around that average.
- **What it leaves alone.** The legs keep their world angles and the feet stay planted. The arms, neck and head keep their pose against the chest. Turning and side-lean are unchanged. The bake log prints the pelvis/spine/chest pitch before and after.
- **When to use it.** Use it for standing idle, talk and their posture holds (`src/actors/mocapPosture.test.ts` fails any standing idle or talk whose pelvis is more than 10° from upright or whose upper back bends more than 12° backwards). Don't use it on walks and runs, which lean into their speed, or on kneels, crouches and get-ups.

None of the BVH sources record finger joints. Finger tracks come only from the Quaternius clips; everyone else's fingers come from the hand solver (`src/actors/handPhysics.ts`) and each character's hand personality.

Every source used by a clip needs a row in `CREDITS.md` (Animations) and an entry in the in-game credits.

## Sizes

The core library loads at start and must stay within 2 MB. Every other named character's clips are a pack of their own (`pack` in the bake list), written to `src/data/mocap/<character>.json` and loaded with that character's body (`src/actors/mocapPacks.ts`). The bake rewrites this table.

<!-- sizes:begin -->
| Pack | Clips | Size |
|---|---|---|
| core | 39 | 895.5 KB |
| bram | 8 | 223.4 KB |
| hale | 5 | 148.4 KB |
| heins | 4 | 56.2 KB |
| priya | 9 | 203.6 KB |
| ruiz | 4 | 95.3 KB |
| sung | 4 | 67.8 KB |
| voss | 7 | 190.6 KB |
<!-- sizes:end -->
