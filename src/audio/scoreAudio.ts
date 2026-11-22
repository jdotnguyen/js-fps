import { BUS_BASE_LEVELS, type AudioEngine } from './engine.ts';

/** While a score plays, the room ambience steps back by about 6 dB so the music is not buried (adaptive-music). */
const AMBIENCE_UNDER_SCORE = 0.5;
import type { ScoreAudio, ScoreBusHandle, StereoPair } from './scorePlayer.ts';

/** `ScoreAudio` on the real engine: each score gets a gain stage on the music bus; layers loop from one start time. */
export function engineScoreAudio(engine: AudioEngine): ScoreAudio {
  const ctx = engine.ctx;
  const buffer = (data: StereoPair, sampleRate: number): AudioBuffer => {
    const b = ctx.createBuffer(2, data.left.length, sampleRate);
    b.copyToChannel(data.left, 0);
    b.copyToChannel(data.right, 1);
    return b;
  };
  const nodeOf = new WeakMap<ScoreBusHandle, GainNode>();
  let playing = 0;
  const ambience = (): void => {
    const g = playing > 0 ? BUS_BASE_LEVELS.ambience * AMBIENCE_UNDER_SCORE : BUS_BASE_LEVELS.ambience;
    engine.buses.ambience.gain.setTargetAtTime(g, ctx.currentTime, 0.8);
  };
  return {
    now: () => ctx.currentTime,
    bus() {
      const gain = new GainNode(ctx, { gain: 0 });
      gain.connect(engine.buses.music);
      playing++;
      ambience();
      let released = false;
      const h: ScoreBusHandle = {
        setGain: (v, tc) => gain.gain.setTargetAtTime(v, ctx.currentTime, tc),
        release: () => {
          gain.disconnect();
          if (released) return;
          released = true;
          playing--;
          ambience();
        },
      };
      nodeOf.set(h, gain);
      return h;
    },
    layer(bus, data, sampleRate, when) {
      const source = new AudioBufferSourceNode(ctx, { buffer: buffer(data, sampleRate), loop: true });
      const gain = new GainNode(ctx, { gain: 0 });
      source.connect(gain).connect(nodeOf.get(bus)!);
      source.start(when);
      return {
        setGain: (v, tc) => gain.gain.setTargetAtTime(v, ctx.currentTime, tc),
        stop: () => {
          try {
            source.stop();
          } catch {
            // never started
          }
          source.disconnect();
          gain.disconnect();
        },
      };
    },
    oneShot(bus, data, sampleRate, when, g) {
      const source = new AudioBufferSourceNode(ctx, { buffer: buffer(data, sampleRate) });
      const gain = new GainNode(ctx, { gain: g });
      source.connect(gain).connect(nodeOf.get(bus)!);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(when);
    },
  };
}
