// Time-stretches weapon samples (pitch preserved, ffmpeg atempo) so their transients land on the moments of
// the animated GLB clips. Fitted files are written as <name>-fit.mp3 in public/assets/audio/weapons/ and
// referenced from SAMPLE_URLS in src/audio/sounds.ts. Cue times are CUES in src/render/viewmodel/viewmodel.ts.
//
// The source masters do not ship with the game. Get them from git history into a folder, then run:
//   mkdir -p masters && git show 822dddf^:public/assets/audio/weapons/shotgun-pump.wav > masters/shotgun-pump.wav
//   node scripts/fit-weapon-audio.mjs masters [outDir]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir = 'public/assets/audio/weapons'] = process.argv.slice(2);
const FITS = [
  // shotgun-pump.wav: rack back at 0.00 s, forend slams home at 0.30 s. In the PostFire clip the pump starts back at
  // 0.10 s and is home at ~0.38 s; the sound starts 0.11 s in (CUES.shotgun.pump), so it needs 0.30 -> 0.27 s: x1.1 faster.
  { src: 'shotgun-pump.wav', out: 'shotgun-pump-fit.mp3', tempo: 1.1 },
];

if (!srcDir || FITS.some(({ src }) => !existsSync(join(srcDir, src)))) {
  console.error(`usage: node scripts/fit-weapon-audio.mjs <masters folder> [outDir]; the folder needs: ${FITS.map((f) => f.src).join(', ')} (see the header)`);
  process.exit(1);
}
for (const { src, out, tempo } of FITS) {
  // Same encoding as the shipped weapon fits: 48 kHz mono VBR mp3.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(srcDir, src), '-filter:a', `atempo=${tempo}`, '-ar', '48000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', join(outDir, out)]);
  console.log(`${src} -> ${join(outDir, out)} (x${tempo})`);
}
