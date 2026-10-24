/**
 * @file The `sfx` kind (PLAN.md WP 9.2, I-23; doctrines: Assets, Agent-operable): a sound effect as data, rendered
 * into samples by the DSP core (engine/audio/dsp/render.ts). The engine's 33 effects (effects.ts), 6 drums (drums.ts)
 * and its foley (foley.ts) are its entries; a game adds its own with `defineSfx`, and `x new sfx` scaffolds one.
 *
 * An entry's fields:
 * - `voices`: one voice or a list played together, in the chip synth's words (engine/audio/dsp/voice.ts);
 * - `layers`: other effects mixed in, each `{ sfx, at, vol, pitch }` (a start in seconds, a gain, a pitch ratio), so
 *   a big hit is a punch over a boom without copying either; layers nest;
 * - `variants` and `vary`: how many versions the runtime picks between, and how far their pitch spreads either way
 *   (a fraction), so a sound heard a hundred times does not repeat exactly;
 * - `bus`: the mixer bus it plays on (`effects`, `ui` or `ambience`; engine/audio/runtime, WP 9.3);
 * - `loop`: for an effect played looped (a bed of ambience, the wind), the pass it repeats, s: what sounds past it
 *   folds over its start (engine/audio/runtime/buffers.ts `foldLoop`, WP 13.22), so a voice fading out past the pass
 *   crossfades into one fading in at its start and the loop has no seam; 0 loops the whole render as it is.
 *
 * Invariants:
 * - Rendering flattens an entry into one voice list: its voices, then each layer's voices (recursively), each layer
 *   shifted by its `at`, scaled by its `vol` and transposed by its `pitch`. A pitch ratio multiplies every frequency of
 *   a voice (its pitch, its sweep's end and its filter's), never its timing. A layer's noise is drawn from its place
 *   in the flattened list, so it differs from the layer rendered alone.
 * - Variant 0 is the sound as written. Variant k ≥ 1 renders from the seed `derive(seed, 'variant', k)` at the pitch
 *   ratio `1 + vary · u`, `u` drawn in the k-th of `variants − 1` equal slices of [−1, 1), so the variants spread
 *   over the whole range instead of bunching. Each is a pure function of the entry, seed, variant and rate: the same
 *   bits in Node and Chromium.
 * - The kind's check (`sfxProblems`) refuses voices `render` would refuse, and an entry with neither voices nor
 *   layers. Layer ids are looked up when the sound renders (a layer may be defined later): an unknown one throws
 *   `CORE_NO_ENTRY` naming the closest ids, a cycle `AUDIO_LAYER_CYCLE`.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const registry = createRegistry();
 * defineSfx('sfx:bigHit', { layers: [{ sfx: 'sfx:punch' }, { sfx: 'sfx:boom', at: 0.03, vol: 0.5 }] }, registry);
 * sfxVoices('sfx:bigHit', registry).length; // 4: the punch's two voices, then the boom's
 * renderSfx('sfx:jump', { variant: 2, registry }).length; // 6174: 0.14 s at 44,100 Hz
 * @see engine/audio/data/sfx.test.ts
 */
import { codeError, defineCodes } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { derive, Rng } from '../../core/rng';
import type { Schema } from '../../core/schema';
import { DEFAULT_RATE, render } from '../dsp/render';
import { normalizeSound, noteFreq, type SoundDef, type Voice } from '../dsp/voice';
import { DRUMS } from './drums';
import { EFFECTS } from './effects';
import { FOLEY } from './foley';

/** The codes the effects raise beyond the DSP's own, with their fixes. */
export const SFX_CODES = defineCodes('audio', {
  AUDIO_LAYER_CYCLE: {
    template: '{id} contains itself through its layers: {path}',
    fix: 'remove one layer of the cycle: a layer mixes another effect in, which cannot contain the first',
    doc: 'Raised by `sfxVoices` and `renderSfx` (engine/audio/data/sfx.ts) when following layers leads back to an effect already on the path.',
  },
  AUDIO_BAD_VARIANT: {
    template: '{id} has variants 0 to {last}; {variant} is not one of them',
    fix: 'ask for a whole number from 0 to {last}, or give the effect more variants',
    doc: 'Raised by `renderSfx` (engine/audio/data/sfx.ts).',
  },
});

/** The mixer buses an effect may play on. */
export const SFX_BUSES = ['effects', 'ui', 'ambience'] as const;

/** One of the buses. */
export type SfxBus = (typeof SFX_BUSES)[number];

/** Another effect mixed into this one. */
export interface SfxLayer {
  /** The id of the effect mixed in. */
  sfx: string;
  /** Seconds after this sound starts; 0 by default. */
  at?: number;
  /** Its gain; 1 (as written) by default. */
  vol?: number;
  /** Its pitch ratio (2 is an octave up); 1 by default. */
  pitch?: number;
}

/** What `defineSfx` takes: voices, layers or both, and every other field optional. */
export interface SfxSpec {
  /** One voice, or a list played together. */
  voices?: SoundDef;
  /** Other effects mixed in. */
  layers?: readonly SfxLayer[];
  /** How many versions the runtime picks between; 1 by default. */
  variants?: number;
  /** How far the variants' pitch spreads either way, as a fraction; 0.03 by default. */
  vary?: number;
  /** The mixer bus; `effects` by default. */
  bus?: SfxBus;
  /** Played looped, the pass it repeats, s (see the file comment); 0 (the whole render) by default. */
  loop?: number;
}

/** An `sfx` entry: the spec with its defaults filled, frozen. */
export interface Sfx {
  readonly id: string;
  readonly kind: string;
  readonly voices?: SoundDef;
  readonly layers: readonly Readonly<Required<SfxLayer>>[];
  readonly variants: number;
  readonly vary: number;
  readonly bus: SfxBus;
  readonly loop: number;
}

/** A layer's fields. */
const LAYER_FIELDS = {
  sfx: { type: 'string', required: true, description: 'The id of the effect mixed in.' },
  at: { type: 'number', default: 0, minimum: 0, maximum: 60, unit: 's', description: 'When it starts.' },
  vol: { type: 'number', default: 1, minimum: 0, maximum: 10, description: 'Its gain: 1 plays it as written.' },
  pitch: { type: 'number', default: 1, minimum: 0.05, maximum: 20, description: 'Its pitch ratio: 2 is an octave up.' },
} as const satisfies Schema;

/** The kind's fields. */
export const SFX_FIELDS = {
  voices: {
    type: 'any',
    description: "One voice or a list played together, in the chip synth's words (wave, freq, to, dur, vol, …).",
  },
  layers: {
    type: 'array',
    default: [],
    items: { type: 'object', properties: LAYER_FIELDS },
    description: 'Other effects mixed in: { sfx, at, vol, pitch }.',
  },
  variants: {
    type: 'integer',
    default: 1,
    minimum: 1,
    maximum: 16,
    description: 'How many versions the runtime picks between; variant 0 is the sound as written.',
  },
  vary: {
    type: 'number',
    default: 0.03,
    minimum: 0,
    maximum: 0.5,
    description: "How far the variants' pitch spreads either way, as a fraction.",
  },
  bus: { type: 'string', enum: SFX_BUSES, default: 'effects', description: 'The mixer bus it plays on.' },
  loop: {
    type: 'number',
    default: 0,
    minimum: 0,
    maximum: 60,
    unit: 's',
    description: 'The pass a looped play repeats: what sounds past it folds over its start, so the loop has no seam (0: the whole render).', // prettier-ignore
  },
} as const satisfies Schema;

/** voice.ts's defaults for the two fields a layer changes on a voice that leaves them out. */
const VOICE_FREQ = 440;
const VOICE_VOL = 0.3;

/** Where a layer puts its voices: a start offset, a gain and a pitch ratio. */
interface Placement {
  at: number;
  vol: number;
  pitch: number;
}

/** A sound definition as a list. */
const voiceList = (def: SoundDef): readonly Voice[] => (Array.isArray(def) ? def : [def]) as readonly Voice[];

/** The problems of an effect beyond its fields' own: voices `render` refuses, or nothing to play ([] when fine). */
export function sfxProblems(sfx: { voices?: unknown; layers?: readonly unknown[] }): string[] {
  if (sfx.voices === undefined) return sfx.layers?.length ? [] : ['it has neither voices nor layers: give either'];
  try {
    normalizeSound(sfx.voices as SoundDef, DEFAULT_RATE);
    return [];
  } catch (error) {
    return [`voices: ${(error as Error).message}`];
  }
}

/** Declares the `sfx` kind on `registry` with the engine's effects, drums and foley (once). */
export function sfxKind(registry: Registry): void {
  if (registry.kinds().includes('sfx')) return;
  registry.defineKind('sfx', {
    description: 'A sound effect: voices for the DSP core, layers of other effects, variants and a mixer bus.',
    fields: SFX_FIELDS,
    defineWith: "defineSfx('<id>', { voices: { wave: …, freq: …, to: …, dur: … } })",
    check: (entry) => sfxProblems(entry),
  });
  for (const [id, spec] of Object.entries({ ...EFFECTS, ...DRUMS, ...FOLEY })) registry.def('sfx', id, { ...spec });
}
sfxKind(sharedRegistry);

/**
 * Defines an effect on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (an unknown field, a value out of range, a voice `render` refuses), `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineSfx(id: string, spec: SfxSpec, registry: Registry = sharedRegistry): Sfx {
  sfxKind(registry);
  return registry.def('sfx', id, { ...spec }) as unknown as Sfx;
}

/** The effect `id` of `registry`; a missing id throws `CORE_NO_ENTRY`, naming the closest ids. */
export function getSfx(id: string, registry: Registry = sharedRegistry): Sfx {
  sfxKind(registry);
  return registry.get('sfx', id) as unknown as Sfx;
}

/** `voice` started `at` seconds later, its gain times `vol` and every frequency times `pitch`. */
function place(voice: Voice, { at, vol, pitch }: Placement): Voice {
  const out: Voice = { ...voice };
  if (at !== 0) out.at = (voice.at ?? 0) + at;
  if (vol !== 1) out.vol = (voice.vol ?? VOICE_VOL) * vol;
  if (pitch === 1) return out;
  out.freq = noteFreq(voice.freq ?? VOICE_FREQ) * pitch;
  if (voice.to !== undefined) out.to = noteFreq(voice.to) * pitch;
  const filter = voice.filter;
  if (typeof filter === 'object') {
    out.filter = { ...filter };
    if (filter.freq !== undefined) out.filter.freq = noteFreq(filter.freq) * pitch;
    if (filter.to !== undefined) out.filter.to = noteFreq(filter.to) * pitch;
  }
  return out;
}

/** Adds `sfx`'s voices, and its layers' recursively, to `out`, placed by `placement`. */
function collect(sfx: Sfx, registry: Registry, placement: Placement, path: readonly string[], out: Voice[]): void {
  if (sfx.voices !== undefined) for (const voice of voiceList(sfx.voices)) out.push(place(voice, placement));
  for (const layer of sfx.layers) {
    if (path.includes(layer.sfx)) {
      throw codeError('AUDIO_LAYER_CYCLE', { id: path[0], path: [...path, layer.sfx].join(' → ') });
    }
    const inner = {
      at: placement.at + layer.at,
      vol: placement.vol * layer.vol,
      pitch: placement.pitch * layer.pitch,
    };
    collect(getSfx(layer.sfx, registry), registry, inner, [...path, layer.sfx], out);
  }
}

/** The effect as one flat voice list, its layers resolved and placed: what `renderSfx` renders for variant 0. */
export function sfxVoices(sfx: string | Sfx, registry: Registry = sharedRegistry): Voice[] {
  const entry = typeof sfx === 'string' ? getSfx(sfx, registry) : sfx;
  const out: Voice[] = [];
  collect(entry, registry, { at: 0, vol: 1, pitch: 1 }, [entry.id], out);
  return out;
}

/** The pitch ratio of variant `variant` of `sfx` from `seed`: 1 for variant 0, else within 1 ± `vary`. */
export function variantPitch(sfx: Sfx, variant: number, seed = 0): number {
  if (variant === 0 || sfx.variants < 2) return 1;
  const slice = 2 / (sfx.variants - 1);
  const u = -1 + slice * (variant - 1 + new Rng(derive(seed, 'vary', variant)).next());
  return 1 + sfx.vary * u;
}

/** How `renderSfx` renders: which variant, from which seed, at which rate, from which registry. */
export interface SfxRenderOptions {
  /** From 0 to the entry's `variants − 1`; 0 (as written) by default. */
  variant?: number;
  /** A whole number; 0 by default. */
  seed?: number;
  /** Samples per second; 44,100 by default. */
  rate?: number;
  /** The registry the effect and its layers come from; the shared one by default. */
  registry?: Registry;
}

/**
 * The effect as mono samples (engine/audio/dsp/render.ts): one variant, its layers mixed in. Throws
 * `AUDIO_BAD_VARIANT`, `AUDIO_BAD_SEED`, `AUDIO_LAYER_CYCLE`, `CORE_NO_ENTRY` and the DSP's codes.
 */
export function renderSfx(sfx: string | Sfx, options: SfxRenderOptions = {}): Float32Array {
  const { variant = 0, seed = 0, rate = DEFAULT_RATE, registry = sharedRegistry } = options;
  const entry = typeof sfx === 'string' ? getSfx(sfx, registry) : sfx;
  if (!Number.isInteger(variant) || variant < 0 || variant >= entry.variants) {
    throw codeError('AUDIO_BAD_VARIANT', { id: entry.id, last: entry.variants - 1, variant });
  }
  if (!Number.isSafeInteger(seed)) throw codeError('AUDIO_BAD_SEED', { seed });
  const voices = sfxVoices(entry, registry);
  if (variant === 0) return render(voices, seed, rate);
  const pitch = { at: 0, vol: 1, pitch: variantPitch(entry, variant, seed) };
  return render(
    voices.map((voice) => place(voice, pitch)),
    derive(seed, 'variant', variant),
    rate,
  );
}
