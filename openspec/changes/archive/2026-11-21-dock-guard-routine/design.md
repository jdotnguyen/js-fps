# Dock guard performance and booth staging

## Context

The R01 level generator places a loose chair beside the office desk. Jay begins against that desk and leaves via the east opening. The guard's base pose is `idle_wand`. The intro asks for two timed wand poses and then returns him to idle. Hand props currently follow pose selection, so walking or reaching for the chair needs an explicit way to carry the wand up to the moment he puts it down.

## Goals / Non-Goals

Give the guard a silhouette and timing that read from Jay's usual viewpoint. Keep his individual motion scoped to `dock_guard` on the shared rig. His ordinary walk and seated breathing can use the existing library. New capture is optional for actions that read well with authored poses and existing clips.

## Decisions

1. **Cast the guard by NPC identity.** Use a guard-specific motion profile or scene overrides in the existing cast motion system. At rest, carry the wand beside the thigh with a loose elbow and one knee unlocked. Cue the look toward the arriving person, then let the torso and carrying arm follow. A larger looping sway would also move him during dialogue or while the queue is empty. Review the wait across a whole gap between passengers before tuning the scan.
2. **Connect the scan to Ruiz.** Aim the existing look target at Ruiz, blend the reach and low sweep through a weight transfer, then recover into the low carry as he dismisses her. Cue the existing wand beep on the pass. Retain the short arch-only checks for the other arrivals. Repeating the high reach gives the arm an extra stop just before his dismissal.
3. **Use the booth opening and the existing chair.** Cue departure after Giles's dismissal, staging the guard behind Jay as Jay clears the shared route. Run the return alongside the coffee dialogue and walk. Author approach, chair grip and seated alignment from the R01 desk and chair transforms. Give the chair a stable instance identity and a controlled start and end transform so the visible seat and its collision agree during and after the pull. A free physics pull would make the seat endpoint depend on incidental collisions.
4. **Time the prop transitions to contact.** Carry the wand through the approach. Transfer its visible representation from the hand to a point on the desk when it touches down. Align the hand to the chair back for the full pull, release it, then turn and lower the pelvis onto the seat. Use an existing sit-enter clip if its height and foot placement fit this chair. Author the contact and settle on the guard's rig where needed.
5. **Make the seated arrangement the intro endpoint.** The guard's post after arrivals is the desk in the same checkpoint. Use one final placement for normal completion, fast-forward, skip and restoration of an already-completed intro. Cancel pending motions before applying it so a delayed completion cannot move a seated guard or show a second wand. Use the existing arch trigger window and spoken cooldown for his seated glance toward Jay.

## Risks / Trade-offs

- **The chair has moved before the pull.** Reserve its authored staging during the scripted beat and update its collision when the guard places it.
- **The guard and Jay meet in the opening.** Gate the crossing on Jay clearing the route. Review from Jay's actual intro view at normal speed.
- **The hands fit in isolation but slide in R01.** Review on `guard1` with the full animation stack, the actual booth geometry and the wand visible. Check foot plants, hand contact and seat height from the side as well as from the booth.
