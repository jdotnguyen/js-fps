import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareWords, spokenChars, type CompareInput } from './voCompare.ts';

/**
 * The 19 clips shipped with the wrong words, as the speech model heard them on 2026-11-25, with the subtitles of the
 * lines recorded either side of each (openspec fix-misaligned-voice-clips).
 */
const BAD: Record<string, CompareInput> = {
  intro_jay_05: {
    text: "They're powdered, Giles. You ask every single morning.",
    heard: "They're powder, Giles. You ask every single morning. What's in it?",
    next: "What's in it?",
  },
  dive_jay_01: {
    text: "What's in it?",
    heard: 'Everything alright, director?',
    previous: "They're powdered, Giles. You ask every single morning.",
    next: 'Everything all right, Director?',
  },
  admin_jay_01: {
    text: 'Everything all right, Director?',
    heard: "Oh, right, you're reference.",
    previous: "What's in it?",
    next: "I'll write you a reference.",
  },
  brief_hale_03: {
    text: 'Please keep clear of the east corridor. There is no cause for concern.',
    heard: 'Please keep clear of the East Corridor. There is no cause for concern. Thank you.',
    previous: 'As a precaution, Lab B is under a routine quarantine until further notice.',
    next: 'Thank you. TAG Industries appreciates you.',
  },
  brief_hale_04: {
    text: 'Thank you. TAG Industries appreciates you.',
    heard: 'Tag Industries appreciates you.',
    previous: 'Please keep clear of the east corridor. There is no cause for concern.',
    next: "No. No, tell them the samples stay sealed. I don't care who's asking.",
  },
  admin_hale_02: {
    text: 'Ah. Officer. Good morning. Your card, of course.',
    heard: 'Ah, officer. Good morning.',
    previous: "No. No, tell them the samples stay sealed. I don't care who's asking.",
    next: 'Perfectly. A busy morning. TAG appreciates you.',
  },
  admin_hale_03: {
    text: 'Perfectly. A busy morning. TAG appreciates you.',
    heard: 'Your card, of course, perfectly. A busy morning.',
    previous: 'Ah. Officer. Good morning. Your card, of course.',
    next: 'Close the door on your way out.',
  },
  admin_hale_04: {
    text: 'Close the door on your way out.',
    heard: 'Tag appreciates you. Close the door on your way out.',
    previous: 'Perfectly. A busy morning. TAG appreciates you.',
  },
  dive_sung_02: {
    text: 'Mud from the trench. Lab B ordered it. Lab B orders a lot of mud.',
    heard: 'mud from the trench, lab B ordered it.',
    previous: "Jay! Case is by the launch trunk. Don't drop it.",
    next: "Locker's signed. Thanks, officer.",
  },
  dive_sung_03: {
    text: "Locker's signed. Thanks, officer.",
    heard: "My B order's a lot of mud.",
    previous: 'Mud from the trench. Lab B ordered it. Lab B orders a lot of mud.',
    next: "Morning, officer. Mind the misters, they've got opinions today.",
  },
  hydro_botanist_01: {
    text: "Morning, officer. Mind the misters, they've got opinions today.",
    heard: "Lockers signed. Thanks, officer. Morning, officer. Mind the misters. They've got opinions today.",
    previous: "Locker's signed. Thanks, officer.",
    next: "Third time this week. The tomatoes don't care. I do.",
  },
  drop_heins_02: {
    text: "Door's locked from the other side!",
    heard: 'Nobody touches the glass.',
    previous: 'Blinds up. Hale wants eyes on it. Nobody touches the glass.',
    next: 'Glass is holding. Back away. Jay, get them out of here!',
  },
  drop_heins_03: {
    text: 'Glass is holding. Back away. Jay, get them out of here!',
    heard: 'Doors locked from the other side. Glass is holding. Back away. Jay, get them out of here!',
    previous: "Door's locked from the other side!",
  },
  r13d_giles_02: {
    text: "Blast gates stayed sealed when the grid dumped. Plus it's half a click of solid steel bore under the trench—even those things aren't swimming through that.",
    heard: "Blascades State sealed when the grid dumped, plus it's half a click of solid steel bore under the trench. Even those things aren't swimming through that. There she is. Line one. Still on the rails and lit up.",
    next: "There she is—Line One, still on the rails and lit up. Come on, let's get aboard before something changes its mind.",
  },
  r15a_giles_01: {
    text: "There she is—Line One, still on the rails and lit up. Come on, let's get aboard before something changes its mind.",
    heard: "Come on, let's get aboard before something changes its mind. Door is sealed. Hold on to something. She pulls hard off the dock.",
    next: "Door's sealed. Hold onto something—she pulls hard off the dock.",
  },
  r15a_giles_02: {
    text: "Door's sealed. Hold onto something—she pulls hard off the dock.",
    heard: "Whoa, rear console's lighting up.",
    next: "Whoa—rear console's lighting up. That's a live carrier.",
  },
  r15a_giles_03: {
    text: "Whoa—rear console's lighting up. That's a live carrier.",
    heard: "That's a live carrier, Master.",
    next: 'Lost her. Too much rock between us and the upper hull.',
  },
  r15a_giles_04: {
    text: 'Lost her. Too much rock between us and the upper hull.',
    heard: 'Too much rock between us and the upper hole.',
    previous: "Whoa—rear console's lighting up. That's a live carrier.",
  },
  sec_giles_06: {
    text: "I can't- Tomas, I can't override it!",
    heard: "Stay back, Tamas. It's sealed from upstairs. I can't. Tamas, I can't override it.",
    previous: 'Stay back, Tomas.',
    next: 'Christ. Oh, Christ.',
  },
};

/** Clips that say their line, which the model spelled or split its own way. */
const MISHEARD: Array<[text: string, heard: string]> = [
  ["Med lab's through there.", 'Midlabs through there.'],
  ['Phase two. Rail bus taking load.', 'Face 2, Railbus Taking Load.'],
  ["Halcyon came in on time, for once. Divers, your sample run's cleared for oh-nine-hundred.", 'Halcyon came in on time for once. Diverse, your sample runs cleared for 0.900.'],
  ["Company. Two o'clock-ish.", 'company to a clockish.'],
  ['Doctor, med checks for everyone off the sub. Giles...', 'Dr. Medchex for everyone off the sub. Giles'],
  ['Ring three pump.', 'Ring 3 Pump.'],
  ["Deep-lift and the evac shuttles both stage out of R-Sixteen.", 'Deep lift in the EVAC shuttles both stage out of R16.'],
  ["Welcome back, Sung. How's topside?", "Welcome back, son. How's top side?"],
  ["Cheers, Bram. You're a saint.", "Cheers, Brown, you're a saint."],
  ['Lights in three, two...', 'Lights in 3, 2.'],
  ["Third time this week. The tomatoes don't care. I do.", "Third time this week, the tomatoes don't care. I do."],
  ['Not any more.', 'Not anymore.'],
  ['All right. [beat] You heard the man.', 'Alright, you heard the man.'],
];

test('compare: every clip that shipped with the wrong words is held', () => {
  assert.equal(Object.keys(BAD).length, 19);
  for (const [id, input] of Object.entries(BAD)) assert.notDeepEqual(compareWords(input), [], id);
});

test('compare: misheard names, numbers and word breaks pass', () => {
  for (const [text, heard] of MISHEARD) assert.deepEqual(compareWords({ text, heard }), [], `${text} / ${heard}`);
});

test('compare: a missing or added phrase as short as "Thank you" is named', () => {
  assert.match(compareWords({ text: 'Thank you. Goodbye now.', heard: 'Goodbye now.' }).join(), /missing "thankyou"/);
  assert.match(compareWords({ text: 'Goodbye now.', heard: 'Goodbye now. Thank you.' }).join(), /added "thankyou"/);
});

test('compare: one short word of a neighbouring line on either end is enough', () => {
  const text = 'Get the door open.';
  assert.deepEqual(compareWords({ text, heard: 'Get the door open. Jay.' }), [], 'a short stray word alone is below the limit');
  assert.match(compareWords({ text, heard: 'Get the door open. Jay.', next: 'Jay, wait.' }).join(), /next line's "jay"/);
  assert.match(compareWords({ text, heard: 'Wait. Get the door open.', previous: 'Hey, wait.' }).join(), /previous line's "wait"/);
});

test('compare: silence is held', () => {
  assert.deepEqual(compareWords({ text: 'Hello there.', heard: '' }), ['nothing was heard']);
  assert.deepEqual(compareWords({ text: 'Hello there.', heard: '*sigh*' }), ['nothing was heard']);
});

test('compare: number words, punctuation and sound notes do not count', () => {
  assert.equal(spokenChars("R-Sixteen, [beat] it's *sighs* twenty (low) feet."), 'r16its20feet');
});
