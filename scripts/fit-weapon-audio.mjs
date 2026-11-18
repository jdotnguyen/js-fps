// Time-stretches weapon samples (pitch preserved, ffmpeg atempo) so their transients land on the moments of
// the animated GLB clips. Originals stay untouched; fitted copies are written next to them as <name>-fit.wav
// and referenced from SAMPLE_URLS in src/audio/sounds.ts. Cue times are CUES in src/render/viewmodel/viewmodel.ts.
//   node scripts/fit-weapon-audio.mjs
import { execFileSync } from 'node:child_process';

const dir = 'public/assets/audio/weapons';
const FITS = [
  // shotgun-pump.wav: rack back at 0.00 s, forend slams home at 0.30 s. In the PostFire clip the pump starts back at
  // 0.10 s and is home at ~0.38 s; the sound starts 0.11 s in (CUES.shotgun.pump), so it needs 0.30 -> 0.27 s: x1.1 faster.
  { src: 'shotgun-pump.wav', out: 'shotgun-pump-fit.wav', tempo: 1.1 },
];

for (const { src, out, tempo } of FITS) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/${src}`, '-filter:a', `atempo=${tempo}`, `${dir}/${out}`]);
  console.log(`${src} -> ${out} (x${tempo})`);
}
