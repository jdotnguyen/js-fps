# Design

## Context

See proposal.md (Why). The facts that shape the approach:

- `AMBIENT_GESTURES` in `src/ai/npcActor.ts` lists what each base pose may pick every 5-12 s, held 1.4-3.2 s.
  `idle_crossed` picks `glance`, `glance_other`, `idle_weight` and `look_down`; `idle_hips` picks `glance`,
  `glance_other`, `idle_weight` and `look_up`. `idle`, `idle_weight`, `sit_chair` and `sit_sofa` can pick a crossed
  pose (`idle_crossed`, `sit_chair_crossed`, `sit_sofa_crossed`). No list picks `idle_hips` as a gesture.
- `SQUAD_FIDGETS` in `src/ai/squad.ts` includes `idle_crossed`, held 2-4 s.
- Seated and leaning gestures already avoid this problem: they `extends` their base pose in `src/data/poses.json`.
- `playAnim` already prefers `<base pose>_<gesture>` over a timed scripted gesture when that pose exists.
- `standingOverlayKind` in `src/actors/animator.ts` decides which joints of a standing pose layer over the mocap base.
  A name ending `_glance` or `_glance_other` is a head-only overlay, which would leave the arms on the mocap idle. A
  name it doesn't know (such as `..._look_down`) gets no overlay, which would turn the mocap base off.
- `anchorCrossedArms` and `anchorHandsOnHips` pin the wrists only while the pose name matches `(^|_)idle_crossed$` or
  `(^|_)idle_hips$`.

## Goals / Non-Goals

**Goals:**
- A character resting with crossed arms or hands on hips never moves its arms for an idle gesture.
- No new gesture system: the same pose and overlay mechanisms the cast already uses.

**Non-Goals:**
- Held mugs (same cause, a separate follow-up).
- Releasing the arms when a character with one of these resting poses walks. No scene walks Heins, Hale or the diver in
  it today. `moveTo` keeps the base pose, so a future scripted walk would need that handled.
- Changing the speech layer. A calm line's forearm gesture is largely held by the wrist anchoring today, and stays so.

## Decisions

### D1. Gestures are poses that extend the resting pose

Add `idle_crossed_glance`, `idle_crossed_glance_other` and `idle_crossed_look_down`, each extending `idle_crossed`,
and `idle_hips_glance`, `idle_hips_glance_other` and `idle_hips_look_up`, each extending `idle_hips`. Each sets only
neck and head angles, taken from `glance`, `glance_other`, `look_down` and `look_up`. The arm joints are inherited, so
a blend between the base and a gesture leaves them still.

Each base picks only its own three. Both drop `idle_weight`: the mocap idle already shifts weight, and that gesture
exists to move the trunk, arms and legs.

Because of the `<base>_<gesture>` lookup in `playAnim`, a scripted `glance` on these characters takes the new variant
with no further code. That is wanted: it keeps the arms in place. No scene sends one to Heins, Hale or the diver today.

Alternatives considered: drive the head through the look-at layer and play no pose (needs a second kind of gesture in
the picker); add an additive layer over any base (new animator work for two pose families).

### D2. One "pose family" test in the animator

One predicate matches a resting pose and its variants, with or without a character prefix, and is used for both
families:

- `standingOverlayKind` returns `arms` for either family. It must be checked before the `_glance` suffix test. The arms
  overlay already carries neck and head, so the turn of the head still shows.
- `anchorCrossedArms` and `anchorHandsOnHips` stay on for their whole family, so their weight doesn't ease out during a
  gesture.

### D3. Take crossed poses out of the fidget lists

Remove `idle_crossed` from the `idle` and `idle_weight` gesture lists and from `SQUAD_FIDGETS`, and remove
`sit_chair_crossed` and `sit_sofa_crossed` from the seated lists. The poses stay defined for authored use.

Alternative considered: keep crossing as a fidget held 8-15 s. Rejected because a held fidget has side effects that a
long hold would make visible: a walking `NpcActor` keeps its gesture pose until the move ends, a squadmate's
`gestureLeft` blocks the reset to the walk pose and also counts as an injury tell, and its expiry re-applies the rest
pose. Making that safe is more work than the variety is worth now.

## Risks / Trade-offs

- [Idle crew look less varied] -> Four standing and several seated gestures remain. A held crossed-arm idle can be added
  later as its own change.
- [A shorter list changes the seeded picks, so tests that expect a gesture at a time may shift] -> Run the NPC, squad
  and motion tests; adjust only expectations that depended on the sequence of picks.
- [The head gestures read weakly without the chest turn of a plain glance] -> Check Heins and Hale in the game; raise
  the neck and head angles in the variants if needed.
- [Okafor's profile swaps `glance` for his own pose, which the new variants don't inherit] -> He never rests in either
  family today.
