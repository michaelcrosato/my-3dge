/**
 * @file The DSP core's reference sounds and their golden hashes (PLAN.md WP 9.1, §6.5; doctrine: Reproducible): the
 * sounds engine/audio/dsp/render.test.ts renders in Node and tests/e2e/audio-dsp.spec.ts renders in Node and in
 * Chromium (tests/pages/audio-dsp.html), so one golden per sound holds in both. A few are my-3d2dge's own effects
 * and drums (`my-3d2dge:engine/my-3d2dge.js:3663-3707`, as test data; WP 9.2 carries the set); the others reach every
 * wave, envelope, filter type, sweep, arpeggio, vibrato, FM, pluck and echo, at three rates and several seeds.
 * `randomSound` makes seeded definitions over every field, for the spec's Node-against-Chromium sweep.
 *
 * Invariants: goldens are keyed by platform (`linux-x64`, as Node names it: `${process.platform}-${process.arch}`).
 * A golden changes only with a reason in the commit that changes it: a deliberate change to the DSP's output.
 *
 * @example
 * // tests/e2e/audio-dsp.spec.ts
 * // for (const c of SOUND_CASES) expect(soundHash(render(c.def, c.seed, c.rate))).toBe(GOLDEN['linux-x64'][c.name]);
 * @see engine/audio/dsp/render.test.ts
 * @see tests/e2e/audio-dsp.spec.ts
 */
import { FILTER_TYPES } from '../../engine/audio/dsp/biquad';
import { render, soundHash } from '../../engine/audio/dsp/render';
import { WAVES, type SoundDef, type Voice } from '../../engine/audio/dsp/voice';
import { Rng } from '../../engine/core/rng';

/** One reference sound: a definition rendered with a seed at a rate. */
export interface SoundCase {
  name: string;
  def: SoundDef;
  seed: number;
  rate: number;
}

/** A few bars of my-3d2dge's `title` melody as held square notes, the way a song renders voice by voice. */
const MELODY: Voice[] = ['C5', 'G4', 'C5', 'E5', 'D5', 'C5'].map((note, i) => ({
  wave: 'square',
  freq: note,
  at: i * 0.134,
  dur: 0.12,
  vol: 0.16,
  hold: true,
  attack: 0.006,
}));

/** The reference sounds. */
export const SOUND_CASES: readonly SoundCase[] = [
  { name: 'jump', def: { wave: 'pulse', freq: 280, to: 640, dur: 0.14, vol: 0.3 }, seed: 0, rate: 44100 },
  {
    name: 'coin',
    def: { wave: 'square', freq: 988, arp: [0, 5], step: 0.07, dur: 0.32, vol: 0.26 },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'hurt',
    def: { wave: 'square', freq: 520, to: 120, dur: 0.28, vol: 0.3, vib: [30, 0.05] },
    seed: 0,
    rate: 44100,
  },
  { name: 'shoot', def: { wave: 'pulse12', freq: 900, to: 260, dur: 0.1, vol: 0.2 }, seed: 0, rate: 44100 },
  { name: 'laser', def: { wave: 'saw', freq: 1500, to: 280, dur: 0.18, vol: 0.18 }, seed: 0, rate: 44100 },
  {
    name: 'heal',
    def: { wave: 'triangle', freq: 523, arp: [0, 7, 12, 19], step: 0.06, dur: 0.3, vol: 0.4 },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'warp',
    def: { wave: 'sine', freq: 200, to: 1200, dur: 0.5, vol: 0.28, vib: [12, 0.1] },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'pause',
    def: { wave: 'square', freq: 988, arp: [0, 12, 0, 12], step: 0.05, dur: 0.22, vol: 0.18, loop: true },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'hit',
    def: [
      { wave: 'noise', freq: 1600, to: 500, dur: 0.12, vol: 0.45 },
      { wave: 'square', freq: 180, to: 60, dur: 0.1, vol: 0.25 },
    ],
    seed: 1,
    rate: 44100,
  },
  {
    name: 'hit, seed 2',
    def: [
      { wave: 'noise', freq: 1600, to: 500, dur: 0.12, vol: 0.45 },
      { wave: 'square', freq: 180, to: 60, dur: 0.1, vol: 0.25 },
    ],
    seed: 2,
    rate: 44100,
  },
  {
    name: 'boom',
    def: [
      { wave: 'noise', freq: 600, to: 40, dur: 1.1, vol: 0.6, filter: 'lowpass' },
      { wave: 'sine', freq: 90, to: 30, dur: 0.8, vol: 0.55 },
    ],
    seed: 7,
    rate: 44100,
  },
  {
    name: 'drum h',
    def: [{ wave: 'noise', freq: 7500, dur: 0.035, vol: 0.14, filter: 'highpass' }],
    seed: 3,
    rate: 44100,
  },
  { name: 'drum k', def: [{ wave: 'sine', freq: 150, to: 42, dur: 0.14, vol: 0.7 }], seed: 3, rate: 44100 },
  { name: 'melody', def: MELODY, seed: 0, rate: 44100 },
  {
    name: 'pad, adsr and a swept filter',
    def: {
      wave: 'saw',
      freq: 'A3',
      dur: 0.8,
      vol: 0.3,
      attack: 0.05,
      decay: 0.2,
      sustain: 0.6,
      release: 0.25,
      filter: { type: 'lowpass', freq: 3000, to: 300, q: 4 },
    },
    seed: 0,
    rate: 48000,
  },
  {
    name: 'bell, fm',
    def: { wave: 'sine', freq: 'C5', dur: 1, vol: 0.4, attack: 0.002, fm: { ratio: 3.5, index: 4, to: 0 } },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'pluck',
    def: {
      wave: 'pluck',
      freq: 'E2',
      dur: 1.2,
      vol: 0.5,
      attack: 0,
      pluck: { decay: 0.995, brightness: 0.6 },
    },
    seed: 11,
    rate: 44100,
  },
  {
    name: 'echo',
    def: { wave: 'square', freq: 660, dur: 0.06, vol: 0.2, delay: { time: 0.12, feedback: 0.5, mix: 0.4 } },
    seed: 0,
    rate: 44100,
  },
  {
    name: 'filters',
    def: FILTER_TYPES.map((type, i) => ({
      wave: 'saw',
      freq: 110 * (i + 1),
      at: i * 0.05,
      dur: 0.1,
      filter: { type, freq: 800 + 300 * i, q: 2, gain: i % 2 ? 9 : -9 },
    })),
    seed: 0,
    rate: 22050,
  },
  {
    name: 'waves at 48 kHz',
    def: WAVES.map((wave, i) => ({ wave, freq: 220 * (i + 1), at: i * 0.03, dur: 0.08 })),
    seed: 5,
    rate: 48000,
  },
];

/** The golden hash of each reference sound (`soundHash` of `render(def, seed, rate)`), by platform. */
export const GOLDEN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'linux-x64': {
    jump: '90cfd6d1706db427',
    coin: '3a33db5615ac7cfc',
    hurt: 'fed3b1bf0910fd2f',
    shoot: '4d410043193427bf',
    laser: '3be1163e3dbc8d39',
    heal: '254e24aec81d26f8',
    warp: '445a0d5d884911b7',
    pause: '1027f695a068e805',
    hit: '713ab474711a77f2',
    'hit, seed 2': '139cbbb598985e57',
    boom: 'a8d2aa999c351681',
    'drum h': 'c468384469229280',
    'drum k': '165b5dd3c84e3e30',
    melody: 'c96b3176c954da28',
    'pad, adsr and a swept filter': 'e40ac38fc4976405',
    'bell, fm': 'f2426247eac512db',
    pluck: 'e0a92181ac4dc4b4',
    echo: '0bbe79fe98f0bf64',
    filters: 'f08a39b2e0493465',
    'waves at 48 kHz': '4c6be445e9528211',
  },
};

/** Each reference sound's hash, by name, rendered here. */
export function caseHashes(cases: readonly SoundCase[] = SOUND_CASES): Record<string, string> {
  return Object.fromEntries(cases.map((c) => [c.name, soundHash(render(c.def, c.seed, c.rate))]));
}

/** A seeded random voice that may use every field, in ranges `render` accepts. */
function randomVoice(rng: Rng): Voice {
  const wave = rng.pick(WAVES);
  const voice: Voice = {
    wave,
    freq: rng.chance(0.2) ? rng.pick(['A4', 'C#5', 'Bb2', 'G3']) : rng.range(30, 4000),
    dur: rng.range(0.02, 0.4),
    vol: rng.range(0, 0.8),
  };
  if (rng.chance(0.4)) voice.at = rng.range(0, 0.2);
  if (rng.chance(0.5)) voice.attack = rng.range(0, 0.05);
  if (rng.chance(0.3)) voice.hold = true;
  if (rng.chance(0.3))
    Object.assign(voice, { decay: rng.range(0, 0.1), sustain: rng.next(), release: rng.range(0, 0.1) });
  if (rng.chance(0.3)) voice.q = rng.range(0.3, 8);
  if (rng.chance(0.3)) {
    const type = rng.pick(FILTER_TYPES);
    voice.filter = rng.chance(0.5)
      ? type
      : { type, freq: rng.range(50, 8000), to: rng.range(50, 8000), gain: rng.range(-12, 12) };
  }
  if (rng.chance(0.25)) voice.delay = { time: rng.range(0.01, 0.1), feedback: rng.range(0, 0.7), mix: rng.next() };
  if (wave === 'pluck') {
    if (rng.chance(0.5)) voice.pluck = { decay: rng.range(0.9, 1), brightness: rng.range(0.05, 1) };
    return voice;
  }
  if (rng.chance(0.4)) voice.to = rng.range(30, 4000);
  if (rng.chance(0.3))
    Object.assign(voice, {
      arp: [0, rng.int(-12, 12), rng.int(-12, 24)],
      step: rng.range(0.02, 0.08),
      loop: rng.chance(0.5),
    });
  if (rng.chance(0.3)) voice.vib = [rng.range(1, 40), rng.range(0, 0.2)];
  if (wave !== 'noise' && rng.chance(0.3))
    voice.fm = { ratio: rng.range(0.25, 8), index: rng.range(0, 6), to: rng.range(0, 6) };
  return voice;
}

/** A seeded random sound of one to three voices; with its seed and rate, it is one case of the spec's sweep. */
export function randomSound(seed: number): SoundCase {
  const rng = new Rng(seed);
  const def = Array.from({ length: rng.int(1, 3) }, () => randomVoice(rng));
  return { name: `random ${seed}`, def, seed: rng.int(0, 1000), rate: rng.pick([22050, 44100, 48000]) };
}
