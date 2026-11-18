# ADR-0022: Squad characters: personalities, backstory and the infection arc

Status: Accepted (decisions marked [Decided]) / Proposed (specific details, numbers and lines)

## Context
ADR-0011 fixes what the squadmates *do*; ADR-0010 leaves "final names and personalities" open;
ADR-0014 gives the beats; ADR-0017's banter already sets a tone. This ADR is the character bible
those lean on: who Giles and Okafor are, how they talk to each other and to the silent player,
why Giles hides his infection, and a ladder of tells that makes the cliffhanger land. Already
Decided and respected here: Giles is a dry, competent man who deflects with humour; Okafor is calm
and clinical and the first to understand the bloom (ADR-0014); voices are subtitles plus non-verbal
mood sounds (ADR-0010); nobody on the team dies in the slice; the reveal is the final beat.

## Decision
Two old friends and the player alongside them. Their warmth is the thing the reveal breaks, so the
characters are written to be liked first and suspected second.

### Decided (Justin)
1. **Why Giles hides the wound:** contract status and his daughter's school (as written below). [Decided]
2. **Okafor is blindsided.** He never suspects Giles; his only suspicion is of TAG. [Decided]
3. **At the reveal Okafor steps toward Giles**, he does not back away. [Decided]
4. **The player is called Jay.** No nickname. [Decided]
5. **No backstory between Jay and Giles** (or Okafor): they are colleagues on the same station, nothing more is written. [Decided]

## The player: Jay
The security officer is **Jay** [Decided] and never speaks. Giles and Okafor talk to Jay as a
colleague and fill the silence themselves. Nothing about Jay's past or Jay's history with the
squad is written [Decided].

## August Giles, engineer
| | |
|---|---|
| Age / job | 38. Contract systems engineer: pressure, power, ventilation. 11 years on deep stations, 2 at Thalassa. |
| Employer | **TAG contractor, not staff.** A reported illness means a medical hold, lost hazard pay and a topside flight that follows him in his file. This is why he hides it. [Decided] |
| Stakes | A nine-year-old daughter, Mara, topside. His hazard pay is her school. He talks about her once, quietly, in a late quiet moment. [Decided] |
| Personality | Competent, funny, tired. Talks to machines ("come on, sweetheart"). Humour is armour: the worse things get, the faster the jokes come, until they stop. |
| Speech | Short, quick, asks questions rather than giving orders, engineering metaphors ("The place leaks like a sieve with ambitions"). Mild language only. |
| Want / fear | Wants to finish the contract and go home. Fears being a problem someone has to manage. |
| In a fight | Loud and busy: calls his reloads, narrates what he is doing, jokes under fire. Aims at legs (ADR-0011). |
| Hints | Phrased as questions, a nudge not an answer ("Maybe there's another way round?"). |
| Backstory of the wound | Three days before the slice he serviced a coolant line that runs through Lab B and cut his forearm on a lab-side panel. The "routine quarantine" came after. He saw something he could not name, said nothing, and has been wearing long sleeves since. |

## Dr. Tomas Okafor, medic
| | |
|---|---|
| Age / job | 52. Station medical officer, formerly a trauma surgeon on topside rescue flights. |
| Personality | Calm, precise, deadpan. Turns worry into rules and gentle orders ("Caffeine isn't a food group." "Sit, Jay. That's medical advice."). Notices everything, says it as an observation, not an accusation. |
| Speech | Complete short sentences, no filler, drops volume as danger rises. In a fight: one-word target calls ("Legs."). |
| Want / fear | Wants everyone on the team breathing. Fears the patient he sees too late. |
| Suspicion | He suspects TAG ("Routine means the paperwork was filed. It doesn't say why."), **not Giles** [Decided]. He asks about the arm out of plain concern and takes the joke for an answer. His guilt at the reveal is that a doctor looked straight at it and missed it. |
| In a fight | Stays behind the player (ADR-0011), prioritises grabbers, calls clear/not-clear. |
| Hints | Statements of fact, never questions ("Quiet. Something's in the water."). |

## Giles and Okafor
- Two years of shifts together at Thalassa: a Thursday coffee and a standing grudge over Giles's sleep.
- Running bits (keep to a few, repeat sparingly): *observation vs diagnosis*, *coffee count*,
  *Okafor orders, Giles complies sarcastically*, *both tease Jay*.
- The pattern the reveal inverts: Okafor asks if something is wrong, Giles deflects with a joke,
  Okafor believes him. By the end the player has watched this exact exchange four times.

## Infection ladder (tells for `giles.infectionStage`, ADR-0011)
Principle: missable on a first play, obvious on a second.

| Stage | When (ADR-0014 beat) | Tells |
|---|---|---|
| 0 | 1. Quiet | Rubs his forearm; long sleeves; "slept on it wrong". Okafor asks about the arm out of concern, not suspicion (ADR-0017). |
| 1 | 4. Cover me | Flexes his hand after the bypass; one joke lands flat and Okafor glances over. |
| 2 | 5. Breathing room | The off-screen moment at the panel, a fresh bandage ("cut it on the panel"), refuses Okafor's help. Voice rasp begins (ADR-0010). |
| 3 | 6-7. Tunnel and climax | Fewer jokes, sweat, a dark vein under the bandage in torchlight, a cough he covers. Still shoots straight. |
| Reveal | 8. Cliffhanger | The lights return and show the trail behind him. "I didn't want you to see this." His laugh (the `laugh` emote) is gone from his voice profile for good. |

## The reveal, staged
- Giles tells it plainly, no monologue: three days, the panel, Mara, "I was going to say after the shift."
- Okafor, blindsided, steps *toward* Giles on a doctor's instinct ("August-") [Decided]. Giles stops
  him: "Stay back, Tomas." It is the first time he uses Okafor's name seriously, and the joke is
  gone from his voice. The player is soft-locked on Giles (ADR-0014). Cut to black on the change
  beginning. [Proposed lines]
- The slice ends without answering whether Giles is a threat, a victim or both.

## Consequences
- Full backgrounds, supporting cast and the outbreak timeline live in `docs/characters.md`.
- Barks, hints and banter can be written to a clear voice per character, which keeps the
  mood-sound mapping (ADR-0010) consistent.
- Every foreshadowing line has a home on the ladder, so adding or cutting tells is a data edit.

## Execution steps
1. Fold the backstory into `slice01.json` barks and the ADR-0014 beat sheet; the squad addresses
   the player as "Jay".
2. Write the foreshadowing lines against the ladder; add the stage drivers to ADR-0011 step 7.
3. Update ADR-0010's voice notes (Giles rasp stages, laugh removal at the reveal).

## Amendment (2026-11-16)
- **Jay speaks** (ADR-0010 amendment). His voice is **steady and attentive** [Decided]: few
  words, quietly funny, the straight man for Giles, goes along with Okafor's orders, and
  remembers the small details of other people's lives. Jay is a man [Decided]. Bitter irony
  for the reveal: the one who notices everything also missed the arm.
- **Mara plant** [Decided]: in the intro kitchen Jay asks "How's Mara liking the new school?";
  Giles answers in one proud line and deflects fast ("Expensive. Coffee?"). The "talks about
  her once" rule now reads: Jay raises her in the intro; Giles talks about her only once, late.
- **Giles's twist is a tragedy, not a betrayal** [Assumed, Justin did not object]: a good man
  making a human, bad choice out of fear for the contract and Mara's school. Not working for
  TAG, never endangers the squad on purpose. What he saw in Lab B is a secret, not malice.
- **Priya Anand** joins the intro with the same weight as Giles and Okafor (ADR-0017). Okafor's
  guilt gains a second layer: she was covering the bay for him.

## Progress
### 2026-11-17: cast looks and ladder hooks
- `actors/castLooks.ts`: Priya (teal scrubs, plum cardigan), Katie Heins (security, short purple
  hair), Director Hale (charcoal suit), Bram/cook (kitchen whites), Ruiz (comms tech), Sung (diver);
  crew looks botanist, diver, exec, assistant, maintenance, security, crew, lab (seeded faces per NPC
  id). Outfits are recoloured with the new `Look.outfitColors`.
- The infection ladder is data in `ai/squadBrain.ts` (`INFECTION_LADDER`), driven by the
  `giles.infectionStage` flag (see ADR-0011 progress). Not seen in a browser.

### 2026-11-17: the ladder is raised by the action sequences
`giles.infectionStage` (flag, read by the squad every 0.5 s) is set by `src/data/sequences/action_*.json`:
**1** after the cover-me bypass once the six are dead (`flex_hand` anim, numb-hand line, Okafor's glance);
**2** in `sec_glass` when the strangled cry plays at the armory panel (then `rub_forearm`, "Cut it on the panel",
Okafor's offer refused; `giles.bandaged` is set when he is back, see below); **3** on entering the flooded tunnel (cough anim, fewer jokes; also on
the valve and climax); **4** when the R11 lights return in `cliffhanger` (rasp, laugh removed), followed by
`transform giles to 1` over 9 s while Okafor steps toward him and Giles says "Stay back, Tomas." Skipping the
reveal applies stage 4 and the transformation's end state. The Mara line is `valve_quiet_giles_01/02` in `valve_turn`
(Jay keeps control).

Moved bodies (2026-11-17): a downed or dragged NPC holds a lying pose (`Humanoid.carried`, no walking gait); `npcDrag` ropes one body behind another (Priya behind the surgery thing).

### Visible tells
`actors/castTells.ts` (`Humanoid.setTells`) puts small overlay meshes on existing bones: a gauze cuff with ridges and a dark seep on the left forearm (flag `giles.bandaged`), and from stage 3 dark veins (forearm below the cuff, left face, neck) and sweat beads (forehead, lip). `Squad.applyTells` reads `giles.infectionStage` and `giles.bandaged` every 0.5 s, so a load, restart or checkpoint restore brings them back (and removes them when the flags are older; a missing stage flag now means stage 0). Tested in `actors/castTells.test.ts` and `ai/squad.test.ts`; placement unseen in a browser. Not done: the humming stopping (voice mood only), a rolled-up sleeve (the cuff sits over the long sleeve).
