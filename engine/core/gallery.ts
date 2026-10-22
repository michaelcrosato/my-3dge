/**
 * @file The `gallery` field (PLAN.md WP 7.7): how the gallery (engine/dev/gallery.ts, `x gallery`, `#gallery/<kind>/<id>`)
 * shows an entry of a kind that needs visual review, as one field of the kind's schema (engine/core/schema.ts) with
 * the kind's own defaults: `galleryField(defaults)`. Its three properties:
 * - `camera`: `turntable`, four views round the entry a quarter turn apart, fitted to its size; `front`, one fitted
 *   view from its front left; or a camera code (engine/gfx/cameras/codes.ts), drawn as written.
 * - `duration`: how long it plays, in seconds: four frames, one in the middle of each quarter of it; 0 for a still,
 *   or for a move and an emitter their own play (the ends of the wind-up and the strike, the middle and end of the
 *   follow-through; the burst while its longest-lived part lives).
 * - `states`: the states it is shown in, one frame each (a body's: a sample state, a pose or a stance,
 *   engine/anim/states.ts and poses.ts); none for most kinds.
 *
 * Props, materials, emitters, looks, bodies and moves have the field; a kind has a gallery when its schema does
 * (`galleryKinds`, asked of the schemas, never of a kind's name), so a game's kind joins by adding it.
 *
 * Invariants: a filled `gallery` value always has all three properties (`parse` fills them); a duration is never
 * negative.
 *
 * @example
 * const fields = { gallery: galleryField({ camera: 'turntable' }) };
 * fields.gallery.default; // { camera: 'turntable', duration: 0, states: [] }
 * @see engine/core/gallery.test.ts
 */
import type { Registry } from './registry';

/** How the gallery shows an entry: its camera, how long it plays (s) and the states it is shown in. */
export interface Gallery {
  readonly camera: string;
  readonly duration: number;
  readonly states: readonly string[];
}

/** The camera words a `gallery` field takes besides a camera code. */
export const GALLERY_CAMERAS = {
  turntable: 'Four views round it, a quarter turn apart, from 25° up, fitted to its size.',
  front: 'One view from its front left, 25° up, fitted to its size.',
} as const;

/** The field's properties, their defaults the kind's (`galleryField`). */
const PROPERTIES = {
  camera: {
    type: 'string',
    description: `How the gallery frames it: ${Object.entries(GALLERY_CAMERAS).map(([word, what]) => `\`${word}\` (${what})`).join(', ')}, or a camera code drawn as written.`, // prettier-ignore
  },
  duration: {
    type: 'number',
    minimum: 0,
    unit: 's',
    description: "How long it plays: four frames, one in each quarter's middle; 0 for a still (a move's or an emitter's: its own length).", // prettier-ignore
  },
  states: {
    type: 'array',
    items: { type: 'string' },
    description: "The states it is shown in, one frame each (a body's: a sample state, a pose or a stance).",
  },
} as const;

/** The `gallery` field of a kind's schema, with the kind's own defaults (see the file comment). */
export function galleryField(defaults: Partial<Gallery> = {}) {
  const { camera = 'front', duration = 0, states = [] } = defaults;
  return {
    type: 'object',
    description: 'How the gallery shows it (engine/core/gallery.ts; x gallery, #gallery/<kind>/<id>): its camera, how long it plays and the states it is shown in.', // prettier-ignore
    properties: {
      camera: { ...PROPERTIES.camera, default: camera },
      duration: { ...PROPERTIES.duration, default: duration },
      states: { ...PROPERTIES.states, default: [...states] },
    },
    default: { camera, duration, states: [...states] } as Gallery,
  } as const;
}

/** The kinds of `registry` whose schema has the field `gallery`, sorted. */
export function galleryKinds(registry: Registry): string[] {
  return registry.kinds().filter((kind) => registry.describe(kind).fields.some((field) => field.key === 'gallery'));
}
