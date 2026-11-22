/**
 * The player's reduced-flashing setting, mirrored here once per frame by `Level.update` so kit pieces that animate
 * their own lights (the dive bay gantry beacon) can honour it without a settings dependency.
 */
export const flashingState = { reduced: false };
