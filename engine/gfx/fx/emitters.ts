/**
 * @file Emitters (PLAN.md WP 6.4, §5.8, §6.6): the registry kind `emitter`, particle effects as data. An entry says
 * how its particles start (where in an `area`, how fast, how far they `spread`), how they move (`gravity`, `drag`,
 * `turbulence`, landing and bouncing on the floor), how long they live and how they look from birth to death (size,
 * colour, a `brightness` above 1 to glow, opacity, adding light or covering, streaking along their velocity). Then
 * how it is used:
 * - a burst of `count` particles where something happens (`effects.burst(id, at)`), with its `layers`: other
 *   emitters bursting with it, each with its own count, offset and changed fields (`set`), the way shardfall's event
 *   bursts reuse its presets;
 * - `events`: the event types it answers (`effects.event('hit', { position })`): ask the entry, never the id;
 * - a `rate` per second for an emitter that keeps going (a brazier's fire, rain), with a `light` that flickers and
 *   pulses as shardfall's object lights do;
 * - camera `shake` (metres) and a floor `ring` (a shockwave decal) with each burst.
 * The engine's emitters are shardfall's 13 presets and the 2D engine's particle kinds and event effects
 * (engine/gfx/fx/presets.ts); a game adds its own with `defineEmitter` (`x new emitter`).
 *
 * `particleSpec(entry, set)` is what the particle pool (engine/gfx/fx/particles.ts) takes: the fields with their
 * colours linear and multiplied by their brightness, cached per entry and change.
 *
 * Invariants: plain data, every field filled; pairs have two numbers ([birth, death] or [shortest, longest]),
 * vectors three, colours are hex; a layer names another emitter, never its own, and changes only particle fields.
 * Problems raise `CORE_BAD_SPEC` naming each; a missing id gets `emitter:sparks` after a warning.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineEmitter('emitter:sap', { count: 12, velocity: [0, 1.5, 0], gravity: 9.8, lands: true, color: ['#9ad14b', '#4b7a1e'] }, reg);
 * getEmitter('emitter:sap', reg).life; // [1, 1.5]: the default
 * particleSpec(getEmitter('emitter:sparks', reg)).c0; // [6, 3.2, 0.99, 1]: shardfall's sparks, linear and glowing
 * @see engine/gfx/fx/emitters.test.ts
 */
import { toLinear } from '../../core/color';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { Schema } from '../../core/schema';
import { BUILT_IN_EMITTERS } from './presets';

/** A vector field, three numbers. */
const vec3 = (description: string, unit: string, value: readonly number[] = [0, 0, 0]) =>
  ({ type: 'array', items: { type: 'number' }, default: value, unit, description }) as const;

/** A pair of numbers. */
const pair = (value: readonly number[], description: string, unit?: string, minimum = 0) =>
  ({
    type: 'array',
    items: { type: 'number', minimum },
    default: value,
    ...(unit ? { unit } : {}),
    description,
  }) as const;

/** A number at least 0. */
const amount = (value: number, unit: string, description: string, maximum?: number) =>
  ({
    type: 'number',
    default: value,
    minimum: 0,
    ...(maximum === undefined ? {} : { maximum }),
    ...(unit ? { unit } : {}),
    description,
  }) as const;

/** The defaults of an object field's properties. */
const defaultsOf = (properties: Schema): Record<string, unknown> =>
  Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));

/** How particles start, move and look: an emitter's own fields, and what a layer may change (`set`). */
export const PARTICLE_FIELDS = {
  area: vec3('Half extents of the box particles start in, around where it bursts.', 'm'),
  velocity: vec3("Every particle's starting velocity.", 'm/s'),
  spread: amount(1, 'm/s', 'Random extra speed in any direction, up to this.'),
  gravity: { type: 'number', default: 0, unit: 'm/s²', description: 'Pulls particles down; below 0 they rise.' },
  drag: amount(0, '1/s', 'Slows them: the share of their speed lost per second.'),
  turbulence: amount(0, 'm/s²', 'Swirls them (smoke, fireflies).'),
  life: pair([1, 1.5], 'The shortest and longest a particle lives.', 's'),
  size: pair([0.1, 0], 'Its radius at birth and at death.', 'm'),
  color: {
    type: 'array',
    items: { type: 'string' },
    default: ['#ffffff', '#ffffff'],
    description: 'Its colour at birth and at death, hex.',
  },
  brightness: pair([1, 1], 'What each colour is multiplied by, linear: above 1 it glows (with bloom, WP 7.4).'),
  alpha: pair([1, 0], 'Its opacity at birth and at death, 0 to 1.'),
  additive: { type: 'boolean', default: true, description: 'Adds light (fire, sparks, magic) instead of covering.' },
  stretch: { type: 'boolean', default: false, description: 'Streaks along its velocity (sparks, rain).' },
  lands: { type: 'boolean', default: false, description: 'Lands on the floor and bounces: see floor.' },
  floor: {
    type: 'number',
    default: 0,
    unit: 'm',
    description: "The floor's height above the ground the burst names (else where it bursts), when it lands.",
  },
  bounce: amount(0.3, '', 'How much of its fall speed a landing keeps, 0 to 1.', 1),
  prewarm: amount(0, 's', 'Born as if emitted over the last this many seconds, so a new emitter starts in full swing.'),
} as const satisfies Schema;

/** One layer: another emitter bursting with this one. */
const LAYER_FIELDS = {
  emitter: { type: 'string', default: 'emitter:sparks', description: "The other emitter's id." },
  count: { type: 'integer', default: 0, minimum: 0, description: 'Its particles per burst.' },
  offset: vec3('Where it bursts, from where this one does.', 'm'),
  set: { type: 'object', default: {}, description: 'Particle fields it changes for this layer (spread, life…).' },
} as const satisfies Schema;

/** A floor ring that grows and fades with a burst (a shockwave). */
const RING_FIELDS = {
  radius: pair([0, 0], 'Its radius as it starts and as it ends; 0 and 0 for none.', 'm'),
  width: amount(0.1, 'm', 'How wide its band is.'),
  color: { type: 'string', default: '#ffe0a0', description: 'Its colour, hex.' },
  alpha: amount(1, '', 'Its opacity as it starts; it fades to nothing.', 1),
  life: amount(0.35, 's', 'How long it lasts.'),
} as const satisfies Schema;

/** The light a running emitter gives, flickering and pulsing. */
const LIGHT_FIELDS = {
  color: { type: 'string', default: '#ffffff', description: 'Its colour, hex.' },
  intensity: amount(0, '', "Its intensity, three.js's; 0 for none."),
  distance: amount(0, 'm', 'Where it fades out; 0 for no limit.'),
  offset: vec3('Where it shines from, from the emitter.', 'm'),
  flicker: amount(0, '', 'How much it flickers, 0 to 1 (a flame about 0.6).', 1),
  pulse: amount(0, 'Hz', 'How fast it swells and fades; 0 for steady.'),
} as const satisfies Schema;

/** The fields of an `emitter` entry. */
export const EMITTER_FIELDS = {
  description: { type: 'string', default: '', description: 'What it is, in plain sentences.' },
  ...PARTICLE_FIELDS,
  count: { type: 'integer', default: 0, minimum: 0, description: 'Its own particles per burst.' },
  rate: amount(0, '1/s', 'Particles per second while it runs (effects.emit).'),
  offset: vec3('Where it bursts or runs, from the point given.', 'm'),
  layers: {
    type: 'array',
    items: { type: 'object', properties: LAYER_FIELDS },
    default: [],
    description: 'Other emitters bursting with it: { emitter, count, offset, set }.',
  },
  events: {
    type: 'array',
    items: { type: 'string' },
    default: [],
    description: "The event types it bursts at (effects.event): 'hit', 'explosion'…",
  },
  shake: amount(0, 'm', 'Camera shake each burst adds (camera only).'),
  ring: {
    type: 'object',
    default: defaultsOf(RING_FIELDS),
    description: 'A floor ring with each burst.',
    properties: RING_FIELDS,
  },
  light: {
    type: 'object',
    default: defaultsOf(LIGHT_FIELDS),
    description: 'The light it gives while it runs.',
    properties: LIGHT_FIELDS,
  },
} as const satisfies Schema;

/** The particle fields as an emitter entry holds them. */
export type ParticleFields = Omit<Entry<typeof PARTICLE_FIELDS>, 'id' | 'kind'>;

/** One layer of an emitter, filled. */
export interface EmitterLayer {
  readonly emitter: string;
  readonly count: number;
  readonly offset: readonly number[];
  readonly set: Readonly<Partial<ParticleFields>>;
}

/** An `emitter` entry: see the file comment. */
export type Emitter = Omit<Entry<typeof EMITTER_FIELDS>, 'layers'> & { readonly layers: readonly EmitterLayer[] };

/** What `defineEmitter` takes: any field; of `ring` and `light`, any key. */
export type EmitterSpec = Partial<Omit<Emitter, 'id' | 'kind' | 'ring' | 'light' | 'layers'>> & {
  ring?: Partial<Emitter['ring']>;
  light?: Partial<Emitter['light']>;
  layers?: readonly (Partial<Omit<EmitterLayer, 'set'>> & { set?: Partial<ParticleFields> })[];
};

/** A colour: `#rgb` or `#rrggbb`. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** The particle fields' names. */
const PARTICLE_KEYS = new Set(Object.keys(PARTICLE_FIELDS));

/** The problems of an emitter beyond its fields. */
function emitterProblems(e: Emitter): string[] {
  const problems: string[] = [];
  const check = (fields: Partial<ParticleFields>, where: string) => {
    for (const key of ['life', 'size', 'brightness', 'alpha', 'color'] as const) {
      const value = fields[key];
      if (value && value.length !== 2) problems.push(`${where}${key} has ${value.length} values; it is [a, b]`);
    }
    for (const key of ['area', 'velocity'] as const) {
      const value = fields[key];
      if (value && value.length !== 3) problems.push(`${where}${key} has ${value.length} numbers; it is [x, y, z]`);
    }
    for (const value of fields.color ?? []) if (!HEX.test(value)) problems.push(`${where}color "${value}" is not hex`);
    if (fields.life && fields.life[0] > fields.life[1]) problems.push(`${where}life is [longest, shortest]`);
    if (fields.alpha?.some((a) => a > 1)) problems.push(`${where}alpha goes above 1`);
  };
  check(e, '');
  e.layers.forEach((layer, i) => {
    const where = `layers[${i}].`;
    if (layer.emitter === e.id) problems.push(`${where}emitter is the emitter itself`);
    const unknown = Object.keys(layer.set).filter((key) => !PARTICLE_KEYS.has(key));
    if (unknown.length) problems.push(`${where}set changes ${unknown.join(', ')}, which are not particle fields`);
    check(layer.set, `${where}set.`);
  });
  for (const [where, value] of [
    ['ring.color', e.ring.color],
    ['light.color', e.light.color],
  ])
    if (!HEX.test(value)) problems.push(`${where} "${value}" is not hex`);
  if (e.ring.radius.length !== 2) problems.push(`ring.radius has ${e.ring.radius.length} numbers; it is [from, to]`);
  return problems;
}

/** Declares the kind `emitter` on `registry`, with the engine's emitters, unless it has it. */
export function emitterKind(registry: Registry): void {
  if (registry.kinds().includes('emitter')) return;
  registry.defineKind('emitter', {
    description:
      'Emitters: particle effects as data (how particles start, move and look), burst where something happens, answering event types, or running at a rate with a flickering light.',
    fields: EMITTER_FIELDS,
    fallback: 'emitter:sparks',
    defineWith: "defineEmitter('<id>', { count: 12, velocity: [0, 2, 0], color: ['#ffffff', '#ffaa44'] })",
    check: (entry) => emitterProblems(entry as unknown as Emitter),
  });
  for (const [id, spec] of Object.entries(BUILT_IN_EMITTERS)) registry.def('emitter', id, { ...spec });
}
emitterKind(sharedRegistry);

/**
 * Defines an emitter on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (a colour that is not hex, a layer changing what is not a particle field…), `CORE_DUPLICATE_ID` when
 * defined twice.
 */
export function defineEmitter(id: string, spec: EmitterSpec, registry: Registry = sharedRegistry): Emitter {
  emitterKind(registry);
  return registry.def('emitter', id, { ...spec } as Record<string, unknown>) as unknown as Emitter;
}

/** The emitter `id` of `registry` (the shared one by default); a missing id gives `emitter:sparks`, with a warning. */
export function getEmitter(id: string, registry: Registry = sharedRegistry): Emitter {
  emitterKind(registry);
  return registry.get('emitter', id) as unknown as Emitter;
}

/** What the particle pool takes: an emitter's particle fields as numbers, colours linear (see the file comment). */
export interface ParticleSpec {
  readonly area: readonly number[];
  readonly velocity: readonly number[];
  readonly spread: number;
  readonly gravity: number;
  readonly drag: number;
  readonly turbulence: number;
  readonly life: readonly number[];
  readonly size: readonly number[];
  /** Linear RGB times the brightness, and the opacity, at birth and at death. */
  readonly c0: readonly number[];
  readonly c1: readonly number[];
  readonly additive: boolean;
  readonly stretch: boolean;
  readonly lands: boolean;
  readonly floor: number;
  readonly bounce: number;
  readonly prewarm: number;
}

/** The specs made so far, per entry and per change. */
const specs = new WeakMap<object, WeakMap<object, ParticleSpec>>();
/** The key of "no change". */
const SAME = {};

/** `entry`'s particle fields with `set`'s changes, as the pool takes them; cached per entry and `set` object. */
export function particleSpec(entry: ParticleFields, set: Readonly<Partial<ParticleFields>> = SAME): ParticleSpec {
  let byChange = specs.get(entry);
  if (!byChange) specs.set(entry, (byChange = new WeakMap()));
  const known = byChange.get(set);
  if (known) return known;
  const f = { ...entry, ...set } as ParticleFields;
  const linear = (k: 0 | 1) => [...toLinear(f.color[k]).map((c) => c * f.brightness[k]), f.alpha[k]];
  const { area, velocity, spread, gravity, drag, turbulence, life, size } = f;
  const { additive, stretch, lands, floor, bounce, prewarm } = f;
  const spec: ParticleSpec = Object.freeze({
    ...{ area, velocity, spread, gravity, drag, turbulence, life, size, c0: linear(0), c1: linear(1) },
    ...{ additive, stretch, lands, floor, bounce, prewarm },
  });
  byChange.set(set, spec);
  return spec;
}
