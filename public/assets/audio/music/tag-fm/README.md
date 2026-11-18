# TAG FM — station radio loop

This is the in-world kitchen radio for the TAG Industries deep-sea station. It's an original lounge / easy-listening tune, rendered procedurally with numpy and scipy.

| File | What |
|---|---|
| `tag-fm-01.wav` | Dry mix: 44.1 kHz, 16-bit, mono, 64.000 s (2,822,400 samples). Peak -1.2 dBFS, RMS -15.0 dBFS |
| `tag-fm-01-radio-preview.wav` | The same mix with the radio effect below baked in. Peak about -5.7 dBFS, RMS -16.5 dBFS |

## Music
- **Key:** F major. **Tempo:** 120 BPM, swung eighths (the off-beat lands at 62% of the beat), 4/4.
- **Length:** 32 bars, AABA, 8 bars per section:
  - **A1 (0–16 s):** the vibraphone states the hook. Electric piano comps sparsely, the bass plays in two, and the drums are brushes only.
    `Fmaj9 | Dm9 | Gm9 | C13 | Am7 D7b9 | Gm9 | Bbmaj7 C7sus | Fmaj7 Gm7 C7`
  - **A2 (16–32 s):** a breathy low flute takes the lead and the vibes double it softly. The bass walks and a swung hi-hat comes in. The section ends on F6 → F9, which leads into the bridge.
  - **B (32–48 s):** the bridge. Vibes play the lead over a soft string pad, and the drummer moves to the ride cymbal.
    `Bbmaj7 | Bbm7 Eb9 | Am7 | D7b9 | Gm9 | C13 | Am7 Abdim7 | Gm7 C7`
  - **A3 (48–64 s):** the A melody returns, with vibes plus flute an octave up and the pad still underneath.
- The hook is A–C–E–D | C–D–A on beats 1-2-3-and-4 | 1–and-of-2–3. The next bar repeats the same shape one step higher (Bb–D–F–E). This is the melody to reuse in the ruined-room version.
- **Instruments:** FM electric piano (Rhodes-style, slightly chorused, tremolo), vibraphone (motor tremolo), flute (delayed vibrato, breath noise), upright-style bass, brushes, hi-hat, ride, a soft kick, and a string pad. Timing and velocity are humanized. A synthetic room/plate reverb has RT of about 1.6 s on lows and 0.7 s on highs.

## Looping
The file is exactly one 32-bar cycle. Everything that rings past the end — note tails, the reverb tail, the bar-32 drum fill and the pickup notes — was wrapped back onto the start of the buffer. The reverb was applied as a circular convolution. Bar 32 is a ii–V turnaround (Gm7 C7), with a melody pickup (F–G) that resolves into bar 1 (A over Fmaj9).

Play it with `loop = true` and no crossfade. `loopStart` and `loopEnd` can stay at their defaults (0 and the full length). The step across the seam measures 0.004, which is below the local median sample step, so there is no click and no gap.

On the very first play the opening has a faint tail of the ending. This is intended and is what makes the loop seamless.

## Radio effect (the preview uses exactly this chain)
The signal chain runs in this order:
1. **Wow and flutter:** a modulated delay of 4 ms base, with a 0.5 Hz sine at ±0.45 ms (wow, about ±0.14% pitch) plus a 6 Hz sine at ±0.012 ms (flutter).
   In Web Audio: a `DelayNode` with `delayTime = 0.004`, plus two `OscillatorNode`s feeding `GainNode`s of 0.00045 and 0.000012 into `delayTime`.
2. **Static:** hiss and crackle are added before the speaker filter, so the speaker colours them too.
   - Hiss is white noise band-passed to 300 Hz–7 kHz at -46 dBFS RMS, with a slow ±25% level drift at 0.125 Hz.
   - Crackle is about 4 random clicks per second (log-normal amplitudes, roughly -30 dBFS each, high-passed at 900 Hz), plus an occasional bigger pop (about 0.3 per second, around -24 dBFS).
3. **Speaker filter**, built from cascaded biquads:
   - High-pass at 300 Hz, Q 0.707 (2nd-order Butterworth).
   - Low-pass at 3500 Hz, 4th-order Butterworth: two lowpass biquads at 3500 Hz with Q 0.541 and Q 1.307.
   - A `peaking` filter at 1200 Hz, +2.5 dB, Q 1.0 for a boxy small-cabinet tone.
4. **Saturation:** set the level so the peak is about 0.7 going in. Then apply `y = tanh(2.2·x) / tanh(2.2)` (a `WaveShaperNode` curve).
5. **Post filter:** low-pass at 4500 Hz, Q 0.707, to soften the harmonics from the saturation.
6. **Output level:** about -16.5 dBFS RMS. That is roughly 1.5 dB quieter than the dry mix after the band-limiting.

The generator script is `tagfm.py` (numpy/scipy, deterministic seed 1977). It was kept outside the repo.
