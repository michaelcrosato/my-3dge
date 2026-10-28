/**
 * @file The kind `sky` (PLAN.md WP 7.1, §6.6): its fields (`SKY_FIELDS`: the background colour, the dome, the sun, the
 * ambient light, the fog, the backdrop's layers and how bright the light pool's point lights shine), `defineSky` for
 * a preset, and the built-in presets, declared on the shared registry when this module loads: `sky:hall`, the
 * torch-lit hall (dark, torches, fog past the focus), and `sky:daylight`, a plain day for fixtures. Others arrive
 * when a scene needs one. engine/gfx/sky.ts's `createSky` puts a preset on a scene. Split from sky.ts at its line cap.
 *
 * Invariants: data only, nothing drawn; every object field's default holds its properties' defaults, so a preset may
 * leave a whole object out. Angles in radians, lengths in metres.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * defineSkies(reg); // the kind and its presets, sky:hall and sky:daylight
 * defineSky('sky:dusk', { background: '#402030', sun: { intensity: 1, elevation: 0.1 } }, reg).sun.azimuth; // 0: as the field's default
 * @see engine/gfx/sky.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Schema } from '../core/schema';
import { AMBIENT_FIELDS, FOG_FIELDS } from './atmosphere';
import { BACKDROP_KINDS } from './backdrop';

const text = (description: string, value: string) => ({ type: 'string', default: value, description }) as const;
const num = (description: string, value: number, minimum = 0, maximum?: number, unit?: string) =>
  ({ type: 'number', default: value, minimum, ...(maximum === undefined ? {} : { maximum }), ...(unit ? { unit } : {}), description }) as const; // prettier-ignore
/** An object field whose default holds every property's default, so a preset may leave the whole object out. */
const group = <const P extends Schema>(description: string, properties: P) => {
  const defaults = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));
  return { type: 'object', default: defaults, description, properties } as const;
};

/** The fields of a `sky` entry; see the file comment. Angles in radians, lengths in metres. */
export const SKY_FIELDS = {
  description: text('What it looks like, in plain sentences.', ''),
  background: text('The colour behind everything, hex, where neither dome nor backdrop is drawn.', '#06050b'),
  pointLights: num("A multiplier on the light pool's intensities: 1 as the light kinds say, 0 puts them out.", 1),
  dome: group("The sky dome: three.js's SkyMesh (the Preetham daylight model), lit by the sun's direction.", {
    show: { type: 'boolean', default: false, description: 'Whether the dome is drawn.' },
    turbidity: num('Haze in the air (SkyMesh turbidity): 2 is clear, 10 is hazy.', 2),
    rayleigh: num('Rayleigh scattering (SkyMesh rayleigh): more is bluer, then redder.', 1),
    mieCoefficient: num('Mie scattering (SkyMesh mieCoefficient): the glow round the sun.', 0.005),
    mieDirectionalG: num('How tight the glow round the sun is (SkyMesh mieDirectionalG), 0 to 1.', 0.8, 0, 1),
    exposure: num('A multiplier on its colour: the frame has no tone mapping, so a clear day wants about 0.5.', 1),
  }),
  sun: group("The sun: three.js's DirectionalLight, shining from its azimuth and elevation; intensity 0 for none.", {
    color: text('Its colour, hex.', '#fff0d8'),
    intensity: num('How bright it is (DirectionalLight intensity); 0 for no sun.', 0),
    azimuth: num('Where it stands round the level, from +Z toward +X.', 0, -7, 7, 'rad'),
    elevation: num('How high it stands above the horizon.', 0.9, 0, 1.5708, 'rad'),
  }),
  ambient: group(
    "The ambient light: three.js's HemisphereLight, one colour from above and one from below.",
    AMBIENT_FIELDS,
  ),
  fog: group(
    'Range fog past the focus plus height fog on the floor (engine/gfx/atmosphere.ts); amount 0 for none.',
    FOG_FIELDS,
  ),
  backdrop: group('Silhouettes round the horizon, far layers first; no layers draws no backdrop.', {
    haze: text('The colour hazed layers fade toward, hex.', '#c8e4f8'),
    tint: text('A colour the silhouettes are drawn through, hex: white as baked; the night darkens them.', '#ffffff'),
    layers: {
      type: 'array',
      default: [],
      description: 'The layers, far to near.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: BACKDROP_KINDS, required: true, description: 'Its silhouette.' },
          color: text('Its colour, hex.', '#5aa060'),
          height: num('Its tallest point, as a share of the backdrop band.', 0.5, 0, 1),
          haze: num('How far it fades toward the haze colour, 0 to 1.', 0, 0, 1),
          seed: { type: 'integer', default: 1, description: 'Its seed: another seed, another skyline.' },
        },
      },
    },
  }),
} as const satisfies Schema;

/** A `sky` entry. */
export type SkyEntry = Entry<typeof SKY_FIELDS>;

/** What `defineSky` takes: any of the fields, and any of a nested object's (a backdrop's layers whole). */
export type SkySpec = {
  [K in Exclude<keyof SkyEntry, 'id' | 'kind'>]?: SkyEntry[K] extends string | number
    ? SkyEntry[K]
    : Partial<SkyEntry[K]>;
};

/** A backdrop as a `sky` entry gives it. */
export type BackdropSpec = SkyEntry['backdrop'];

/** Declares the kind `sky` and the built-in presets on `registry`, unless it has them. */
export function defineSkies(registry: Registry = sharedRegistry): void {
  if (!registry.kinds().includes('sky')) {
    registry.defineKind('sky', {
      description:
        'Sky presets: what surrounds and lights a level (background, dome, backdrop, sun, ambient light, fog, how bright the point lights shine).',
      fields: SKY_FIELDS,
      fallback: 'sky:daylight',
      defineWith: "defineSky('sky:<name>', { background, dome, sun, ambient, fog, backdrop, pointLights })",
    });
  }
  const sky = (id: string, spec: Record<string, unknown>) => registry.has('sky', id) || registry.def('sky', id, spec);
  sky('sky:hall', {
    description: 'The torch-lit hall: a dark vault, torchlight from the light pool, fog from 12 m past the focus.',
    background: '#06050b',
    pointLights: 1,
    ambient: { sky: '#5a5480', ground: '#241f30', intensity: 4 },
    fog: { color: '#06050b', start: 12, end: 70, amount: 1, floor: 0, ceiling: 1.2, height: 0.3 },
  });
  sky('sky:daylight', {
    description: 'A plain day for fixtures: a clear sky dome, a sun from the south-west, hills and mountains far off.',
    background: '#9cc4ec',
    pointLights: 0,
    dome: { show: true, exposure: 0.5 },
    sun: { color: '#fff0d8', intensity: 2.6, azimuth: 3.7, elevation: 0.9 },
    ambient: { sky: '#c8d4ff', ground: '#4a3f30', intensity: 1.6 },
    fog: { color: '#c8daf0', start: 40, end: 220, amount: 0.5 },
    backdrop: {
      haze: '#c8e4f8',
      layers: [
        { kind: 'mountains', color: '#7a98c8', height: 0.95, haze: 0.45, seed: 3 },
        { kind: 'hills', color: '#5aa060', height: 0.5, haze: 0.25, seed: 7 },
        { kind: 'forest', color: '#2f7040', height: 0.32, haze: 0.1, seed: 11 },
      ],
    },
  });
}
defineSkies();

/** Declares a sky preset (`sky:<name>`); see `SKY_FIELDS`. */
export function defineSky(id: string, spec: SkySpec, registry: Registry = sharedRegistry): SkyEntry {
  return registry.def('sky', id, spec) as SkyEntry;
}
