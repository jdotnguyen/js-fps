// Fits weapon samples to the animated GLB clips, by time-stretching (pitch preserved, ffmpeg atempo) or by cutting
// out the quiet between two transients, so the transients land on the moments of the clips. Fitted files are written as <name>-fit.mp3 in public/assets/audio/weapons/ and
// referenced from `samples` in src/audio/sounds/weapons.ts. Cue times are CUES in src/render/viewmodel/viewmodel.ts.
//
// The source masters do not ship with the game. Get them from git history into a folder, then run:
//   mkdir -p masters && git show 822dddf^:public/assets/audio/weapons/shotgun-pump.wav > masters/shotgun-pump.wav
//   git show ac361d9^:public/assets/audio/weapons/pistol-cock.mp3 > masters/pistol-cock.mp3
//   node scripts/fit-weapon-audio.mjs masters [outDir]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir = 'public/assets/audio/weapons'] = process.argv.slice(2);
const FITS = [
  // shotgun-pump.wav: rack back at 0.00 s, forend slams home at 0.30 s. In the PostFire clip the pump starts back at
  // 0.10 s and is home at ~0.38 s; the sound starts 0.11 s in (CUES.shotgun.pump), so it needs 0.30 -> 0.27 s: x1.1 faster.
  { src: 'shotgun-pump.wav', out: 'shotgun-pump-fit.mp3', filter: ['-filter:a', 'atempo=1.1'] },
  // pistol-cock.mp3: the slide pulled back (peak at 0.19 s), a long gap, then snapping home (0.87 s). In the Reload clip
  // the slide is back at 3.15 s and home at 3.25 s: keep 0.12-0.25 and 0.79-1.30 s, which puts the peaks 0.14 s apart, at
  // 0.07 and 0.21 s (the sound starts at CUES.pistol.slide).
  {
    src: 'pistol-cock.mp3',
    out: 'pistol-cock-fit.mp3',
    filter: [
      '-filter_complex',
      '[0:a]atrim=0.12:0.25,asetpts=PTS-STARTPTS,afade=t=out:st=0.12:d=0.01[pull];[0:a]atrim=0.79:1.30,asetpts=PTS-STARTPTS,afade=t=in:d=0.005,afade=t=out:st=0.41:d=0.1[home];[pull][home]concat=n=2:v=0:a=1',
    ],
  },
];

if (!srcDir || FITS.some(({ src }) => !existsSync(join(srcDir, src)))) {
  console.error(`usage: node scripts/fit-weapon-audio.mjs <masters folder> [outDir]; the folder needs: ${FITS.map((f) => f.src).join(', ')} (see the header)`);
  process.exit(1);
}
for (const { src, out, filter } of FITS) {
  // Same encoding as the shipped weapon fits: 48 kHz mono VBR mp3.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(srcDir, src), ...filter, '-ar', '48000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', join(outDir, out)]);
  console.log(`${src} -> ${join(outDir, out)}`);
}
