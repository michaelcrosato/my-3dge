/**
 * @file A sound definition and its checks (PLAN.md WP 9.1; doctrines: Assets, Agent-operable): a sound is plain data,
 * one voice or a list of voices played together, in the source chip synth's words (`wave`, `freq`, `to`, `dur`,
 * `vol`, `attack`, `hold`, `arp`, `step`, `loop`, `vib`, `filter`, `q`), so its effects, drums and songs copy over as
 * they are (WP 9.2), plus ADSR (`decay`, `sustain`, `release`), a start time `at`, an explicit filter, `fm`, `pluck`
 * and a `delay` echo. `normalizeSound` checks a definition and fills its defaults, throwing a coded error that names
 * the voice and the field.
 *
 * Defaults (the source's): wave `square`, freq 440 Hz, dur 0.15 s (at least 0.012 s), vol 0.3, attack 0.004 s, step
 * 0.06 s, q 1.1. A noise voice without `filter` goes through a bandpass that follows its pitch, as in the source. A
 * frequency is a number in Hz or a note name (`noteFreq`), and pitches below 20 Hz are raised to 20 Hz, as in the
 * source. A filter given by its type alone (`filter: 'lowpass'`) follows the voice's pitch; an object gives it its own
 * `freq` (and `to`, a sweep). `pluck` voices keep one pitch: `to`, `arp`, `vib` and `fm` are refused on them, and `fm`
 * on noise. The source's `delay` (a start offset) is `at` here, because `delay` is the echo. Unknown fields and waves
 * are refused with the closest name, never ignored.
 *
 * @example
 * const [voice] = normalizeSound({ wave: 'pulse', freq: 'A4', to: 880, dur: 0.14 }, 44100);
 * voice.f0; // 440
 * @see engine/audio/dsp/render.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../../core/log';
import { withSimMath } from '../../core/simMath';
import { FILTER_TYPES, type FilterType } from './biquad';
import type { EchoSpec } from './delay';
import { holdEnvelope, type Envelope } from './envelope';
import { TONAL_WAVES } from './osc';

/** The codes a definition's checks raise, with their fixes (collected into docs/ERRORS.md by `x docs`). */
export const VOICE_CODES = defineCodes('audio', {
  AUDIO_UNKNOWN_WAVE: {
    template: '{where}: there is no wave "{wave}"{suggestion}',
    fix: 'use one of {waves}',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts) when a voice names a wave the DSP does not make.',
  },
  AUDIO_UNKNOWN_FIELD: {
    template: '{where} has no field "{field}"{suggestion}',
    fix: 'use only the fields {fields}',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts) for a field a voice, filter, fm, pluck or delay does not have: usually a typo, which would otherwise be silently ignored.',
  },
  AUDIO_BAD_VALUE: {
    template: '{where}: {field} is {value}',
    fix: 'make {field} {rule}',
    doc: 'Raised by `render` (engine/audio/dsp/render.ts) for a value of the wrong type or outside its range, and for fields that do not apply to the voice (a pitch change on a pluck, fm on noise).',
  },
  AUDIO_BAD_NOTE: {
    template: '{where}: "{note}" is not a note',
    fix: 'write a frequency in Hz or a note name: a letter A–G, then # or b, then the octave (A4 = 440 Hz, C#5, Bb2)',
    doc: 'Raised by `noteFreq` and `render` (engine/audio/dsp/voice.ts, render.ts) for a pitch that is neither a positive number nor a note name.',
  },
});

/** Every wave: the tonal ones, white noise, and a Karplus–Strong pluck. */
export const WAVES = [...TONAL_WAVES, 'noise', 'pluck'] as const;

/** One of the waves. */
export type Wave = (typeof WAVES)[number];

/** A pitch: a frequency in Hz, or a note name such as `'A4'`, `'C#5'` or `'Bb2'`. */
export type Pitch = number | string;

/** A filter with its own settings. */
export interface FilterSpec {
  /** The filter type, Web Audio's names. */
  type: FilterType;
  /** The cutoff or centre frequency; without it the filter follows the voice's pitch. */
  freq?: Pitch;
  /** Sweeps the frequency exponentially to this over the voice (needs `freq`). */
  to?: Pitch;
  /** The linear Q; the voice's `q` by default. */
  q?: number;
  /** The gain in dB, for peaking and shelf filters; 0 by default. */
  gain?: number;
}

/** Simple two-operator FM: a sine modulator at `ratio` times the pitch modulates the voice's phase. */
export interface FmSpec {
  /** The modulator's frequency over the voice's pitch. */
  ratio: number;
  /** The modulation index (the phase deviation, in radians). */
  index: number;
  /** Moves the index linearly to this over the voice. */
  to?: number;
}

/** The Karplus–Strong string's settings. */
export interface PluckSpec {
  /** The loop's gain once a period, in (0, 1]; 0.996 by default. */
  decay?: number;
  /** The burst's brightness, in (0, 1]; 1 (white noise) by default. */
  brightness?: number;
}

/** A feedback echo after the voice. */
export interface DelaySpec {
  /** Seconds between repeats, up to 2. */
  time: number;
  /** Each repeat's gain over the previous one, from 0 to 0.95; 0.35 by default. */
  feedback?: number;
  /** The first repeat's gain over the dry voice, from 0 to 1; 0.35 by default. */
  mix?: number;
}

/** One voice of a sound: every field is optional. */
export interface Voice {
  /** The wave; `square` by default. */
  wave?: Wave;
  /** The pitch (for noise, its filter's frequency); 440 Hz by default. */
  freq?: Pitch;
  /** Sweeps the pitch exponentially to this over the voice. */
  to?: Pitch;
  /** Seconds, the release included; 0.15 by default. */
  dur?: number;
  /** The peak gain; 0.3 by default. */
  vol?: number;
  /** When the voice starts within the sound, in seconds; 0 by default. */
  at?: number;
  /** Seconds from silence to full volume; 0.004 by default. */
  attack?: number;
  /** Sustains full volume and releases over the last 30 ms, instead of falling away. */
  hold?: boolean;
  /** ADSR: seconds from full volume to `sustain`; 0 by default. Any of decay, sustain, release makes the envelope ADSR. */
  decay?: number;
  /** ADSR: the level held after the decay, from 0 to 1; 1 by default. */
  sustain?: number;
  /** ADSR: seconds of release, ending at the voice's end; 0.03 by default. */
  release?: number;
  /** An arpeggio: semitones over the pitch, one per `step`. */
  arp?: readonly number[];
  /** Seconds per arpeggio note; 0.06 by default. */
  step?: number;
  /** Repeats the arpeggio instead of holding its last note. */
  loop?: boolean;
  /** Vibrato: `[rate in Hz, depth as a fraction of the pitch]`. */
  vib?: readonly [number, number];
  /** A filter: a type that follows the pitch, or a `FilterSpec`. */
  filter?: FilterType | FilterSpec;
  /** The linear Q of the filter (and of a noise voice's bandpass); 1.1 by default. */
  q?: number;
  /** Simple FM on a tonal wave. */
  fm?: FmSpec;
  /** The string's settings, for `wave: 'pluck'`. */
  pluck?: PluckSpec;
  /** A feedback echo. */
  delay?: DelaySpec;
}

/** A sound: one voice, or several played together. */
export type SoundDef = Voice | readonly Voice[];

/** A checked voice with every default filled, as engine/audio/dsp/synth.ts renders it. */
export interface NormalVoice {
  /** Its place in the definition, which also names its noise stream. */
  index: number;
  wave: Wave;
  /** The pitch in Hz, at least 20. */
  f0: number;
  /** The sweep's end pitch in Hz, or 0 for none. */
  to: number;
  dur: number;
  vol: number;
  at: number;
  env: Envelope;
  /** The arpeggio's frequency ratios, or null. */
  arp: number[] | null;
  step: number;
  loop: boolean;
  /** `[rate in Hz, depth in Hz]`, or null. */
  vib: [number, number] | null;
  /** The filter; `freq` 0 follows the pitch. */
  filter: { type: FilterType; freq: number; to: number; q: number; gain: number } | null;
  fm: { ratio: number; index: number; to: number } | null;
  pluck: { decay: number; brightness: number } | null;
  delay: EchoSpec | null;
}

const NOTE = /^([A-Ga-g])([#b]?)(-?\d)$/;
const SEMITONE: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The longest a sound may last, in seconds. */
export const MAX_SECONDS = 600;

/** A voice's fields, in the order docs list them. */
const VOICE_FIELDS = [
  'wave',
  'freq',
  'to',
  'dur',
  'vol',
  'at',
  'attack',
  'hold',
  'decay',
  'sustain',
  'release',
  'arp',
  'step',
  'loop',
  'vib',
  'filter',
  'q',
  'fm',
  'pluck',
  'delay',
];

/** A frequency in Hz from a pitch: numbers pass through, `noteFreq('A4')` is 440 (equal temperament). */
export function noteFreq(pitch: Pitch, where = 'noteFreq'): number {
  if (typeof pitch === 'number' && Number.isFinite(pitch) && pitch > 0) return pitch;
  const m = typeof pitch === 'string' ? NOTE.exec(pitch.trim()) : null;
  if (!m) throw codeError('AUDIO_BAD_NOTE', { where, note: String(pitch) });
  const semis = SEMITONE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return withSimMath(() => 440 * Math.pow(2, (semis - 69) / 12));
}

/** Throws `AUDIO_BAD_VALUE`. */
function bad(where: string, field: string, value: unknown, rule: string): never {
  throw codeError('AUDIO_BAD_VALUE', { where, field, value: JSON.stringify(value) ?? String(value), rule });
}

/** `value` checked to be a number in [min, max]; `fallback` when it is undefined (required when that is too). */
function num(
  where: string,
  field: string,
  value: unknown,
  fallback: number | undefined,
  min: number,
  max: number,
): number {
  const rule = `a number from ${min} to ${max}`;
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !(value >= min && value <= max)) {
    return bad(where, field, value, value === undefined ? `${rule} (it is required)` : rule);
  }
  return value;
}

/** `value` checked to be a plain object with only `fields`. */
function record(where: string, field: string, value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return bad(where, field, value, `an object with the fields ${fields.join(', ')}`);
  }
  for (const key of Object.keys(value)) {
    if (fields.includes(key)) continue;
    const suggestion = didYouMean(key, fields);
    throw codeError('AUDIO_UNKNOWN_FIELD', {
      where: `${where} ${field}`,
      field: key,
      suggestion,
      fields: fields.join(', '),
    });
  }
  return value as Record<string, unknown>;
}

/** The pitch `value` in Hz, raised to 20 Hz. */
function pitch(where: string, value: unknown): number {
  return Math.max(20, noteFreq(value as Pitch, where));
}

/** The envelope a voice asks for. */
function envelope(where: string, v: Record<string, unknown>, dur: number): Envelope {
  const attack = Math.min(dur, num(where, 'attack', v.attack, 0.004, 0, MAX_SECONDS));
  if (v.hold !== undefined && typeof v.hold !== 'boolean') bad(where, 'hold', v.hold, 'true or false');
  if (v.decay === undefined && v.sustain === undefined && v.release === undefined) {
    return v.hold ? holdEnvelope(attack, dur) : { kind: 'fall', attack };
  }
  return {
    kind: 'adsr',
    attack,
    decay: num(where, 'decay', v.decay, 0, 0, MAX_SECONDS),
    sustain: num(where, 'sustain', v.sustain, 1, 0, 1),
    release: num(where, 'release', v.release, holdEnvelope(attack, dur).release, 0, MAX_SECONDS),
  };
}

/** The filter a voice asks for (a noise voice's bandpass when it asks for none). */
function filter(where: string, v: Record<string, unknown>, wave: Wave, q: number): NormalVoice['filter'] {
  const spec = v.filter;
  if (spec === undefined) return wave === 'noise' ? { type: 'bandpass', freq: 0, to: 0, q, gain: 0 } : null;
  const type = (f: unknown, field: string): FilterType => {
    if (FILTER_TYPES.includes(f as FilterType)) return f as FilterType;
    return bad(where, field, f, `one of ${FILTER_TYPES.join(', ')}${didYouMean(String(f), FILTER_TYPES)}`);
  };
  if (typeof spec === 'string') return { type: type(spec, 'filter'), freq: 0, to: 0, q, gain: 0 };
  const f = record(where, 'filter', spec, ['type', 'freq', 'to', 'q', 'gain']);
  if (f.to !== undefined && f.freq === undefined) bad(where, 'filter.to', f.to, 'absent unless filter.freq is set');
  return {
    type: type(f.type, 'filter.type'),
    freq: f.freq === undefined ? 0 : pitch(`${where} filter`, f.freq),
    to: f.to === undefined ? 0 : pitch(`${where} filter`, f.to),
    q: num(where, 'filter.q', f.q, q, 0.0001, 1000),
    gain: num(where, 'filter.gain', f.gain, 0, -60, 60),
  };
}

/** The string's settings, checked and filled. */
function pluckSpec(where: string, p: Record<string, unknown>): NonNullable<NormalVoice['pluck']> {
  return {
    decay: num(where, 'pluck.decay', p.decay, 0.996, 0.5, 1),
    brightness: num(where, 'pluck.brightness', p.brightness, 1, 0.01, 1),
  };
}

/** One voice checked and filled. */
function voice(value: unknown, index: number, rate: number): NormalVoice {
  const where = `voice ${index}`;
  const v = record(where, 'definition', value, VOICE_FIELDS);
  const wave = (v.wave ?? 'square') as Wave;
  if (!WAVES.includes(wave)) {
    const suggestion = didYouMean(String(wave), WAVES);
    throw codeError('AUDIO_UNKNOWN_WAVE', { where, wave: String(wave), suggestion, waves: WAVES.join(', ') });
  }
  for (const f of wave === 'pluck' ? ['to', 'arp', 'vib', 'fm'] : []) {
    if (v[f] !== undefined) bad(where, f, v[f], 'absent: a pluck keeps one pitch');
  }
  if (wave === 'noise' && v.fm !== undefined) bad(where, 'fm', v.fm, 'absent: fm needs a tonal wave');
  const dur = Math.max(0.012, num(where, 'dur', v.dur, 0.15, 0, MAX_SECONDS));
  const q = num(where, 'q', v.q, 1.1, 0.0001, 1000);
  let arp: number[] | null = null;
  if (v.arp !== undefined) {
    const semitones = v.arp;
    const ok = Array.isArray(semitones) && semitones.length > 0;
    if (!ok || !semitones.every((s) => typeof s === 'number' && Math.abs(s) <= 96)) {
      bad(where, 'arp', semitones, 'a list of semitones from -96 to 96');
    }
    arp = withSimMath(() => (semitones as number[]).map((s) => Math.pow(2, s / 12)));
  }
  if (v.loop !== undefined && typeof v.loop !== 'boolean') bad(where, 'loop', v.loop, 'true or false');
  const f0 = pitch(where, v.freq ?? 440);
  let vib: [number, number] | null = null;
  if (v.vib !== undefined) {
    const [speed, depth] = Array.isArray(v.vib) && v.vib.length === 2 ? (v.vib as unknown[]) : [];
    const ok = typeof speed === 'number' && typeof depth === 'number';
    if (!ok || !(speed > 0 && speed <= rate / 2 && depth >= 0 && depth <= 10)) {
      bad(where, 'vib', v.vib, `[rate in Hz, over 0 and up to ${rate / 2}; depth from 0 to 10]`);
    }
    vib = [speed as number, (depth as number) * f0];
  }
  const fm = v.fm === undefined ? null : record(where, 'fm', v.fm, ['ratio', 'index', 'to']);
  const pluck = v.pluck === undefined ? {} : record(where, 'pluck', v.pluck, ['decay', 'brightness']);
  if (v.pluck !== undefined && wave !== 'pluck') bad(where, 'pluck', v.pluck, "absent unless wave is 'pluck'");
  const delay = v.delay === undefined ? null : record(where, 'delay', v.delay, ['time', 'feedback', 'mix']);
  return {
    index,
    wave,
    f0,
    to: v.to === undefined ? 0 : pitch(where, v.to),
    dur,
    vol: num(where, 'vol', v.vol, 0.3, 0, 10),
    at: num(where, 'at', v.at, 0, 0, MAX_SECONDS),
    env: envelope(where, v, dur),
    arp,
    step: num(where, 'step', v.step, 0.06, 0.001, MAX_SECONDS),
    loop: v.loop === true,
    vib,
    filter: filter(where, v, wave, q),
    fm: fm && {
      ratio: num(where, 'fm.ratio', fm.ratio, undefined, 0.001, 100),
      index: num(where, 'fm.index', fm.index, undefined, 0, 100),
      to: num(where, 'fm.to', fm.to, fm.index as number, 0, 100),
    },
    pluck: wave === 'pluck' ? pluckSpec(where, pluck) : null,
    delay: delay && {
      time: num(where, 'delay.time', delay.time, undefined, 0.001, 2),
      feedback: num(where, 'delay.feedback', delay.feedback, 0.35, 0, 0.95),
      mix: num(where, 'delay.mix', delay.mix, 0.35, 0, 1),
    },
  };
}

/** A definition checked and filled: one normal voice per voice, at `rate` samples per second. */
export function normalizeSound(def: SoundDef, rate: number): NormalVoice[] {
  const list: readonly unknown[] = Array.isArray(def) ? def : [def];
  if (!list.length) bad('the sound', 'the voice list', def, 'at least one voice');
  return list.map((v, i) => voice(v, i, rate));
}
