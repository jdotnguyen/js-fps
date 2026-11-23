/**
 * Is Jay's pistol allowed up? (holster-until-the-drop, intro-sequence spec)
 *
 * He is unarmed from a new game until the Lab B drop's first duct bang, which sets `gunDrawn`. The rule reads saved flags,
 * not the control stack, because `player.reset()` returns the stack to full control on every load and restart. Saves
 * and debug jumps from after the drop carry `drop_done`, so they come back armed. A level without the drop (no
 * `duct_r04` anchor) is never holstered.
 */
export function sidearmAllowed(flags: Readonly<Record<string, string | number | boolean>>, levelHasDrop: boolean): boolean {
  if (!levelHasDrop) return true;
  return flags['gunDrawn'] === true || flags['drop_done'] === true;
}
