/**
 * @file The audio page's module (`tests/pages/audio.html`), Chromium's half of tests/e2e/audio.spec.ts: it makes the
 * page's runtime (engine/audio/runtime/audio.ts), locked until a gesture, with the title song asked for before it,
 * and publishes it as `window.__audio.live`; and it renders scenarios through the runtime into
 * `OfflineAudioContext`s, measuring the output as numbers (tone amplitudes, RMS, onsets) for the spec to hold
 * within tolerances. It signals ready through `window.__engine`.
 *
 * The scenarios use their own registry of test sounds: sine tones held at 0.5, each at its own frequency so one
 * measurement never hears another, a noise click, and two songs of held sines (`song:test.a` with a second layer
 * from intensity 0.5, `song:test.b`), 120 bpm in 4/4: a beat is 0.5 s and a bar 2 s. Each scenario that changes
 * something mid-render does it at a context time through `context.suspend(t)`.
 */
import { createAudio, type Audio, type AudioOptions } from '../../engine/audio/runtime/audio';
import type { MusicPosition } from '../../engine/audio/runtime/music';
import type { ListenerPose } from '../../engine/audio/runtime/spatial';
import { defineSfx } from '../../engine/audio/data/sfx';
import { defineSong } from '../../engine/audio/data/song';
import { rms, toneAmplitude } from '../../engine/audio/dsp/measure';
import { createRegistry, type Registry } from '../../engine/core/registry';
import type { QueryView } from '../../engine/sim/queryView';

/** The offline renders' sample rate. */
const RATE = 44100;

/** The test sounds' frequencies, Hz. */
export const FREQ = {
  tone: 441,
  high: 4410,
  low: 220.5,
  duck: 1323,
  sting: 1764,
  iron: 882,
  a3: 220,
  e5: 659.26,
  c5: 523.25,
};

/** The test sounds and songs in a registry of their own. */
function sounds(): Registry {
  const registry = createRegistry();
  const tone = (freq: number, dur: number) => ({
    voices: { wave: 'sine' as const, freq, dur, vol: 0.5, attack: 0.005, hold: true, release: 0.005 },
  });
  defineSfx('sfx:test.tone', tone(FREQ.tone, 0.5), registry);
  defineSfx('sfx:test.high', tone(FREQ.high, 2), registry);
  defineSfx('sfx:test.low', tone(FREQ.low, 2), registry);
  defineSfx('sfx:test.duck', tone(FREQ.duck, 0.5), registry);
  defineSfx('sfx:test.sting', tone(FREQ.sting, 0.3), registry);
  defineSfx('sfx:test.iron', tone(FREQ.iron, 0.1), registry);
  const white = { type: 'highpass' as const, freq: 20 }; // noise as it is: white
  defineSfx('sfx:test.click', { voices: { wave: 'noise', dur: 0.05, vol: 0.5, filter: white } }, registry);
  const bar = (note: string) => [note, ...Array(15).fill('-')].join(' ');
  const held = { wave: 'sine' as const, vol: 0.3, gate: 1, attack: 0.005 };
  defineSong(
    'song:test.a',
    {
      tracks: [
        { notes: bar('A3'), ...held },
        { notes: bar('E5'), ...held, intensity: 0.5 },
      ],
    },
    registry,
  );
  defineSong('song:test.b', { tracks: [{ notes: bar('C5'), ...held }] }, registry);
  return registry;
}

/** The listener at the origin, looking along +Z: its right is −X. */
const POSE: ListenerPose = { position: [0, 0, 0], yaw: 0, pitch: 0 };

/** A QueryView whose every ray hits a wall (`blocked`) or none: only `raycast` is asked. */
const wall = (blocked: boolean) =>
  ({ raycast: () => (blocked ? { body: 1, distance: 1 } : null) }) as unknown as QueryView;

/** The amplitude of the `freq` tone in `x` from `t0` to `t1` seconds. */
const amp = (x: Float32Array, freq: number, t0: number, t1: number) =>
  toneAmplitude(x, freq, RATE, Math.round(t0 * RATE), Math.round(t1 * RATE));

/** The RMS of `x` from `t0` to `t1` seconds. */
const level = (x: Float32Array, t0: number, t1: number) => rms(x, Math.round(t0 * RATE), Math.round(t1 * RATE));

/** When the `freq` tone first reaches half of `steady` after `t0`: the centre of the first 10 ms window that does. */
function onset(x: Float32Array, freq: number, t0: number, t1: number, steady: number): number {
  const [win, hop] = [Math.round(0.01 * RATE), Math.round(0.001 * RATE)];
  for (let i = Math.round(t0 * RATE); i + win <= Math.round(t1 * RATE); i += hop) {
    if (toneAmplitude(x, freq, RATE, i, i + win) >= steady / 2) return (i + win / 2) / RATE;
  }
  return NaN;
}

/** `seconds` of stereo rendered through a runtime on an `OfflineAudioContext`, after `script` set it up. */
async function render(
  seconds: number,
  script: (audio: Audio, at: (time: number, change: () => void) => void) => void,
  options: AudioOptions = {},
) {
  const context = new OfflineAudioContext(2, Math.round(seconds * RATE), RATE);
  const audio = createAudio({ context, registry: sounds(), ...options });
  const failures: unknown[] = [];
  const at = (time: number, change: () => void) =>
    void context.suspend(time).then(() => {
      try {
        change();
      } catch (error) {
        failures.push(error);
      }
      return context.resume();
    });
  script(audio, at);
  const buffer = await context.startRendering();
  if (failures.length) throw failures[0];
  return { audio, left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
}

/** The runtime without rendering: a context that never starts. */
const quiet = (options: AudioOptions = {}) =>
  createAudio({ context: new OfflineAudioContext(2, RATE, RATE), registry: sounds(), ...options });

const scenarios = {
  /** An effect unplaced on `effects` (both ears, at the voice's level times the master's 0.7), one on `ui` at 0.5. */
  async levels() {
    const { left, right } = await render(1, (audio) => {
      audio.play('sfx:test.tone');
      audio.play('sfx:test.low', { bus: 'ui', vol: 0.5 });
    });
    return {
      left: amp(left, FREQ.tone, 0.1, 0.4),
      right: amp(right, FREQ.tone, 0.1, 0.4),
      ui: amp(left, FREQ.low, 0.1, 0.4),
    };
  },
  /** A high tone 2 m to the listener's right; the same tone 2 m, then 4 m, ahead. */
  async spatial() {
    const side = await render(1, (audio) => {
      audio.update(POSE);
      audio.play('sfx:test.high', { position: [-2, 0, 0] });
    });
    const ahead = await render(2, (audio) => {
      audio.update(POSE);
      audio.play('sfx:test.tone', { position: [0, 0, 2] });
      audio.play('sfx:test.tone', { position: [0, 0, 4], when: 1 });
    });
    const both = (t0: number, t1: number) => amp(ahead.left, FREQ.tone, t0, t1) + amp(ahead.right, FREQ.tone, t0, t1);
    return {
      rightOverLeft: level(side.right, 0.1, 0.9) / level(side.left, 0.1, 0.9),
      fourOverTwo: both(1.1, 1.4) / both(0.1, 0.4),
      listener: side.audio.info().listener,
    };
  },
  /** A high and a low tone 2 m ahead, in the clear, then behind a wall from 0.8 s. */
  async occlusion() {
    const flags: boolean[] = [];
    const { left } = await render(2, (audio, at) => {
      audio.update(POSE, wall(false));
      const sounds = [
        audio.play('sfx:test.high', { position: [0, 0, 2] }),
        audio.play('sfx:test.low', { position: [0, 0, 2] }),
      ];
      flags.push(...sounds.map((sound) => sound?.occluded ?? true));
      at(0.8, () => {
        audio.update(POSE, wall(true));
        flags.push(...sounds.map((sound) => sound?.occluded ?? false));
      });
    });
    return {
      flags,
      high: amp(left, FREQ.high, 1.2, 1.9) / amp(left, FREQ.high, 0.1, 0.75),
      low: amp(left, FREQ.low, 1.2, 1.9) / amp(left, FREQ.low, 0.1, 0.75),
    };
  },
  /**
   * Song A at intensity 0; at 0.6 s the intensity rises and a bound event plays a stinger (both on the next beat); at
   * 2.6 s song B is asked for (on the next bar line); at 5 s an effect ducks the music.
   */
  async music() {
    const seen: { start?: number; position?: MusicPosition | null } = {};
    const { left } = await render(7, (audio, at) => {
      audio.bind('boss', 'sfx:test.sting');
      audio.music('song:test.a', { intensity: 0 });
      seen.start = audio.info().music?.start;
      at(0.6, () => {
        audio.intensity(1);
        audio.event('boss', { id: 3 });
      });
      at(2.6, () => audio.music('song:test.b'));
      at(4.5, () => (seen.position = audio.info().music));
      at(5, () => audio.play('sfx:test.duck', { duck: true }));
    });
    const a3 = amp(left, FREQ.a3, 0.2, 0.9);
    const c5 = amp(left, FREQ.c5, 4.4, 4.9);
    return {
      ...seen,
      leadBefore: amp(left, FREQ.e5, 0.2, 0.9) / a3,
      leadAfter: amp(left, FREQ.e5, 1.4, 1.9) / a3,
      stinger: onset(left, FREQ.sting, 0.5, 1.5, amp(left, FREQ.sting, 1.1, 1.3)),
      aAfterB: amp(left, FREQ.a3, 4.2, 4.9) / a3,
      bBefore: amp(left, FREQ.c5, 3.4, 3.95) / c5,
      section: onset(left, FREQ.c5, 3.5, 4.5, c5),
      ducked: amp(left, FREQ.c5, 5.1, 5.45) / c5,
      released: amp(left, FREQ.c5, 6.1, 6.9) / c5,
    };
  },
  /**
   * A white noise click at 0.5 s in the hall and in no room: their difference is the reverb alone (the dry paths are
   * the same), whose energy is the click's times `wet²` in each ear, since each channel's response has unit energy.
   */
  async reverb() {
    const click = (room: 'hall' | 'none') =>
      render(2, (audio) => {
        audio.room(room);
        audio.play('sfx:test.click', { when: 0.5 });
      });
    const [hall, none] = [await click('hall'), await click('none')];
    const energy = (x: Float32Array, y?: Float32Array) => x.reduce((sum, v, i) => sum + v * (y ? y[i] : v), 0);
    const wet = [hall.left, hall.right].map((channel, c) => channel.map((v, i) => v - [none.left, none.right][c][i]));
    return {
      wetOverDry: [energy(wet[0]) / energy(none.left), energy(wet[1]) / energy(none.right)],
      correlation: energy(wet[0], wet[1]) / Math.sqrt(energy(wet[0]) * energy(wet[1])),
      later: level(hall.left, 1.4, 1.6) / level(hall.left, 0.6, 0.8),
      dry: level(none.left, 0.6, 0.8),
      room: hall.audio.info().mixer?.room,
    };
  },
  /** Voices of one sound past `perSound`, then other sounds past `max`, with the gap. */
  limits() {
    const audio = quiet({ limits: { max: 3, perSound: 2 } });
    const voices = (id: string, when: number) => (audio.play(id, { when }) ? audio.info().voices.join(' ') : null);
    return [
      voices('sfx:test.tone', 0),
      voices('sfx:test.tone', 0.01),
      voices('sfx:test.tone', 0.1),
      voices('sfx:test.tone', 0.2),
      voices('sfx:test.low', 0.2),
      voices('sfx:test.high', 0.2),
    ];
  },
  /** The effect a surface tag plays. */
  footsteps() {
    const mapped = quiet({ footsteps: { iron: 'sfx:test.iron', '*': 'sfx:test.tone' } });
    return {
      iron: mapped.footstep('iron', [1, 0, 1])?.id,
      mud: mapped.footstep('mud')?.id,
      fallback: quiet().footstep('stone')?.id,
    };
  },
};

/** The page's runtime: locked until a gesture; the title song waits for it. */
const live = createAudio();
live.music('song:title');

/** What the page offers the spec. */
const audioPage = {
  ...scenarios,
  live: {
    info: () => live.info(),
    play: () => live.play('sfx:jump')?.id ?? null,
    suspend: async () => {
      await (live.context as AudioContext).suspend();
      return live.state;
    },
    close: async () => {
      await live.close();
      return live.state;
    },
  },
};

declare global {
  interface Window {
    __audio: typeof audioPage;
  }
}

Object.assign(window, { __audio: audioPage, __engine: { ready: true, errors: [] } });
