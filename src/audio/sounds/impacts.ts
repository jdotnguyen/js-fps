/** Loose props and severed pieces hitting things. Part of the sound registry (./index.ts). */

function impactFiles(bank: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `assets/audio/physics/${bank}-${i + 1}.mp3`);
}

export const samples = {
  // Loose props and severed pieces hitting things (adopt-physics-engine D16; src/audio/impacts.ts). CC0 cuts built by
  // scripts/impacts-generate.ts (see CREDITS.md), every clip peaking at -6 dB; play gain sets the level.
  propCartCrash: impactFiles('prop-cart-crash', 3),
  propCartKnock: impactFiles('prop-cart-knock', 4),
  propGlass: impactFiles('prop-glass', 8),
  propGlassHard: impactFiles('prop-glass-hard', 4),
  propMetal: impactFiles('prop-metal', 6),
  propThud: impactFiles('prop-thud', 4),
  limbThud: impactFiles('limb-thud', 1),
  // The R08 slam (livelier-cart-slam D6): the steel tray struck under her head, and its instruments jumping (CC0 cuts).
  cartSlam: impactFiles('cart-slam', 3),
  cartRattle: impactFiles('cart-rattle', 3),
  // The kidney dish landing hard and spinning down (impacts.ts `dish`; ElevenLabs over a Kenney clang, gore-generate.ts).
  propDishSpin: 'assets/audio/gore/dish-spin.mp3',
} as const satisfies Record<string, string | readonly string[]>;
