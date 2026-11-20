// Fits the pistol racking sound (freesound_community "beretta 9mm cocking slower") to the Weild clip of pistol.glb.
// The source has the pull-back click at 0.19 s and the slide-home snap at 0.84 s, 0.65 s apart with a silent hold between.
// In Weild (played at WIELD_SPEED 1.3) the slide pulls back at ~0.34 s and lands at ~0.61 s, 0.275 s apart. Rather than
// speeding the whole sample up (chirpy), the silent hold is cut: the two clicks are kept at natural speed and spliced.
//
// The source master does not ship with the game. Get it from git history, then run:
//   git show 822dddf:public/assets/audio/weapons/pistol-cock.mp3 > pistol-cock.mp3
//   node scripts/fit-pistol-cock.mjs pistol-cock.mp3 [out.mp3]
// Output defaults to public/assets/audio/weapons/pistol-cock-fit.mp3 (SAMPLE_URLS.pistolCock in src/audio/sounds.ts).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const [src, out = 'public/assets/audio/weapons/pistol-cock-fit.mp3'] = process.argv.slice(2);
if (!src || !existsSync(src)) {
  console.error('usage: node scripts/fit-pistol-cock.mjs <pistol-cock source master> [out.mp3]  (see the header for where to get it)');
  process.exit(1);
}
const GAP = 0.275; // seconds between the pull-back transient and the slide-home transient in the fitted file
const PRE_A = 0.06; // pull-back transient sits this far into the output
const PRE_B = 0.04; // lead-in kept before the snap transient
const aStart = 0.19 - PRE_A; // source times
const bStart = 0.84 - PRE_B;
const bDelayMs = Math.round((PRE_A + GAP - PRE_B) * 1000);
const filter = [
  `[0:a]atrim=${aStart}:0.27,asetpts=PTS-STARTPTS,afade=t=out:st=0.10:d=0.04[a]`,
  `[0:a]atrim=${bStart}:1.30,asetpts=PTS-STARTPTS,afade=t=out:st=0.40:d=0.10,adelay=${bDelayMs}|${bDelayMs}[b]`,
  `[a][b]amix=inputs=2:duration=longest:normalize=0`,
].join(';');
// Same encoding as the shipped weapon fits: 48 kHz mono VBR mp3.
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', filter, '-ar', '48000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', out]);
console.log(`${src} -> ${out} (clicks ${GAP} s apart; pull-back at ${PRE_A} s)`);
