// Fits the pistol racking sound (freesound_community "beretta 9mm cocking slower") to the Weild clip of pistol.glb.
// The source has the pull-back click at 0.19 s and the slide-home snap at 0.84 s, 0.65 s apart with a silent hold between.
// In Weild (played at WIELD_SPEED 1.3) the slide pulls back at ~0.34 s and lands at ~0.61 s, 0.275 s apart. Rather than
// speeding the whole sample up (chirpy), the silent hold is cut: the two clicks are kept at natural speed and spliced.
//   node scripts/fit-pistol-cock.mjs
import { execFileSync } from 'node:child_process';

const dir = 'public/assets/audio/weapons';
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
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/pistol-cock.mp3`, '-filter_complex', filter, `${dir}/pistol-cock-fit.wav`]);
console.log(`pistol-cock.mp3 -> pistol-cock-fit.wav (clicks ${GAP} s apart; pull-back at ${PRE_A} s)`);
