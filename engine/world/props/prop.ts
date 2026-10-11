/**
 * @file The prop registry (PLAN.md WP 4.5, §6.6): the registry kind `prop`, one entry per kind of thing that stands
 * in a level, as data: the meshes it is drawn with (geometry and material by id, §6.1: `world` names them, `gfx`
 * builds them, engine/gfx/props.ts), its body (a shape and a material for the physics world), an optional light
 * spot, where a level places it, and its interaction hooks. The engine's props are the crate, the barrel, the
 * brazier's fire and the pillar (engine/world/props/catalog.ts); a game adds its own with `defineProp` (`x new prop`).
 *
 * A prop's frame: its base, where it stands, is the origin, +Y up, and its parts stand on it as the geometry kit's
 * shapes stand on the ground. Its body's shape stands on the base too, so the body's origin, the prop's centre, is
 * `propCentre(prop)` above it: what a body's pose (`readBody`) and `propPose` give, and what the meshes are drawn
 * at. A part with `flame.tongues` above 0 is drawn as that many flame tongues dancing round its origin (its geometry
 * a cone one metre high, stretched each frame), the 2D hall's flames. The hooks: `hit` (a swing, a blast) knocks a
 * dynamic prop away and leaves the others; `use` does nothing; shared code calls them and never compares ids.
 *
 * Carried: the idea of my-3d2dge's 2D prop catalog (`src/starter/*`, `src/emberdeep/51-themes.js`): kinds of props
 * as data with their light metadata (a colour, a reach and a flicker beside the drawing).
 *
 * Invariants: an entry is plain data plus its two hooks, every field filled with its default; a part's name is
 * unique in its prop; colours are hex; vectors have three numbers; a body's shape has a size above 0; spawn names
 * and light tags are words. Geometry and material ids are gfx's to resolve (a missing one draws its kind's fallback,
 * and `node x qa geo tex --only prop:` reports it). Problems raise `CORE_BAD_SPEC` naming each; a missing id gets
 * `prop:crate` after a warning (`CORE_UNKNOWN_ID`).
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * defineProp('prop:stool', { parts: [{ geometry: 'geometry:frustum', params: { radiusBottom: 0.2, radiusTop: 0.2, height: 0.45 }, material: 'material:planks' }], body: { type: 'dynamic', shape: 'cylinder', radius: 0.2, height: 0.45 } }, reg);
 * propCentre(getProp('prop:stool', reg)); // 0.225: half its height
 * getProp('prop:crate', reg).body.type; // 'dynamic': the engine's props come with the kind
 * @see engine/world/props/prop.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import type { EntryOf, Schema } from '../../core/schema';
import type { Point3 } from '../level/types';
import { BUILT_IN_PROPS } from './catalog';

/** A vector field in metres (or `unit`), three numbers. */
const vec3 = (value: readonly number[], description: string, unit = 'm') =>
  ({ type: 'array', items: { type: 'number' }, default: value, unit, description }) as const;

/** A length in metres, at least 0. */
const metres = (value: number, description: string) =>
  ({ type: 'number', default: value, minimum: 0, unit: 'm', description }) as const;

/** The object of `properties`' defaults: a nested field's default, so a spec leaving it out gets every key. */
const defaultsOf = (properties: Schema): Record<string, unknown> =>
  Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default]));

/** The fields of a part's flame. */
const FLAME_FIELDS = {
  tongues: { type: 'integer', default: 0, minimum: 0, maximum: 8, description: 'How many tongues; 0: still.' },
  ring: metres(0.1, 'How far from its origin the tongues stand.'),
  height: metres(0.4375, "A tongue's mean height; it dances about half of it either way."),
  sway: metres(0.0875, 'How far a tongue sways sideways, leaning 3 rad per metre of sway.'),
  core: { type: 'string', default: '#ffd36a', description: 'The colour of the core inside each tongue, hex.' },
} as const satisfies Schema;

/** The fields of one part: a mesh of the prop. */
export const PROP_PART_FIELDS = {
  name: {
    type: 'string',
    default: 'mesh',
    description: 'Its name, unique in the prop: the ID pass names its batch `<prop>/<name>` (prop:crate/mesh).',
  },
  geometry: {
    type: 'string',
    default: 'geometry:box',
    description: 'Its geometry by id (engine/gfx/geometry), standing on the ground, in metres.',
  },
  params: { type: 'object', default: {}, description: "The geometry's parameters; the rest keep their defaults." },
  material: {
    type: 'string',
    default: 'material:default',
    description: 'Its material by id (engine/gfx/materials): on every face, or on its sides when top names another.',
  },
  top: {
    type: 'string',
    default: '',
    description: "A material for its tops and bottoms (faces within 45° of up or down: a barrel's lids); '' for none.",
  },
  tint: { type: 'string', default: '#ffffff', description: 'A colour multiplying the material, hex, per instance.' },
  position: vec3([0, 0, 0], "Where its origin stands in the prop's frame (the base at 0, +Y up)."),
  rotation: vec3([0, 0, 0], 'Its turn in the prop’s frame, Euler angles about X, Y then Z.', 'rad'),
  shadow: { type: 'boolean', default: true, description: 'Whether it casts shadows (every part receives them).' },
  flame: {
    type: 'object',
    default: defaultsOf(FLAME_FIELDS),
    description:
      'Drawn as flame tongues dancing round its origin (its geometry a cone 1 m high), or still (tongues 0).',
    properties: FLAME_FIELDS,
  },
} as const satisfies Schema;

/** The physics shapes a prop's body may have, sized as three.js sizes its geometries. */
export const PROP_SHAPES = ['box', 'cylinder', 'ball', 'capsule'] as const;

/** The fields of a prop's body: its type, its shape and its material (engine/physics/bodies.ts's PROP_MATERIAL). */
const BODY_FIELDS = {
  type: {
    type: 'string',
    enum: ['none', 'fixed', 'dynamic'],
    default: 'none',
    description:
      "'dynamic' falls, slides and is knocked; 'fixed' stands where it is placed and blocks; 'none' has none.",
  },
  shape: { type: 'string', enum: PROP_SHAPES, default: 'box', description: 'Its shape.' },
  size: vec3([1, 1, 1], "A box's width, height and depth."),
  radius: metres(0.5, "A cylinder's, ball's or capsule's radius."),
  height: metres(1, "A cylinder's height, or a capsule's straight middle."),
  density: {
    type: 'number',
    default: 57,
    minimum: 0,
    unit: 'kg/m³',
    description: "A hollow crate's: 24 kg at 0.75 m.",
  },
  friction: { type: 'number', default: 0.7, minimum: 0, description: 'Coulomb friction.' },
  restitution: { type: 'number', default: 0.05, minimum: 0, maximum: 1, description: 'Bounciness, 0 to 1.' },
  linearDamping: { type: 'number', default: 0.3, minimum: 0, unit: '1/s', description: 'Slows its sliding.' },
  angularDamping: { type: 'number', default: 0.8, minimum: 0, unit: '1/s', description: 'Slows its rolling.' },
} as const satisfies Schema;

/** The fields of a prop's light spot, as three.js's `PointLight` takes them. */
const LIGHT_FIELDS = {
  tag: { type: 'string', default: '', description: "What kind of light it is ('torch'); '' for none." },
  color: { type: 'string', default: '#ffffff', description: 'Its colour, hex.' },
  intensity: { type: 'number', default: 1, minimum: 0, description: "Its intensity, three.js's." },
  distance: metres(0, 'Where it fades out; 0 for no limit.'),
  decay: { type: 'number', default: 2, minimum: 0, description: 'How it dims with distance (2: physically).' },
  position: vec3([0, 0, 0], "Where it shines from, in the prop's frame."),
  flicker: { type: 'boolean', default: false, description: "Whether it flickers as a flame does (gfx's FLICKER)." },
} as const satisfies Schema;

/** The fields of where a level places a prop. */
const PLACE_FIELDS = {
  spawn: {
    type: 'string',
    default: '',
    description: "The spawn name whose points place it, on their floor (a glyph with spawn: 'crate'); '' none.",
  },
  light: {
    type: 'string',
    default: '',
    description: "The light-spot tag whose spots place it, on the top of the spot's tile ('torch'); '' none.",
  },
} as const satisfies Schema;

/** The fields of a `prop` entry. */
export const PROP_FIELDS = {
  description: { type: 'string', default: '', description: 'What it is, in plain sentences.' },
  parts: {
    type: 'array',
    items: { type: 'object', properties: PROP_PART_FIELDS },
    default: [],
    description: 'Its meshes: { name, geometry, params, material, top, tint, position, rotation, shadow, flame }.',
  },
  body: {
    type: 'object',
    default: defaultsOf(BODY_FIELDS),
    description: 'Its body in the physics world, standing on its base: { type, shape, size, radius, height, … }.',
    properties: BODY_FIELDS,
  },
  light: {
    type: 'object',
    default: defaultsOf(LIGHT_FIELDS),
    description: "Its light spot, for the light pool (WP 7.1): { tag, color, intensity, … }; tag '' for none.",
    properties: LIGHT_FIELDS,
  },
  place: {
    type: 'object',
    default: defaultsOf(PLACE_FIELDS),
    description: 'Where a level places it (levelProps): on spawn points by name, or under light spots by tag.',
    properties: PLACE_FIELDS,
  },
  hit: {
    type: 'function',
    default: (touch: PropTouch): void => {
      if (touch.prop.body.type === 'dynamic') touch.knock();
    },
    description: 'What a hit does (a swing, a blast): (touch) => void. By default a dynamic prop is knocked away.',
  },
  use: {
    type: 'function',
    default: (touch: PropTouch): void => void touch,
    description: 'What using it does (the interact button): (touch) => void. Nothing by default.',
  },
} as const satisfies Schema;

/** How hard a knock is, as engine/physics/bodies.ts's `knock` takes it. */
export interface PropKnock {
  /** Away from `from`, across the ground (m/s). */
  speed?: number;
  /** Upward (m/s). */
  up?: number;
  /** The twist about +Y, −0.5 to 0.5. */
  spin?: number;
}

/** What a hook is given: the prop, its body, where the touch comes from, and the means to answer it. */
export interface PropTouch {
  readonly prop: Prop;
  /** Its body in the physics world, or −1. */
  readonly body: number;
  /** Where the touch comes from (m): the swing's, the blast's or the user's position. */
  readonly from: Point3;
  /** Knocks it away from `from`: the caller passes engine/physics/bodies.ts's `knock` on its body. */
  knock(options?: PropKnock): void;
}

/** One part of a `prop` entry, filled: see `PROP_PART_FIELDS`. */
export type PropPart = Omit<EntryOf<typeof PROP_PART_FIELDS>, 'params' | 'position' | 'rotation'> & {
  readonly params: Readonly<Record<string, unknown>>;
  readonly position: readonly number[];
  readonly rotation: readonly number[];
};

/** A `prop` entry: see the file comment. */
export type Prop = Omit<Entry<typeof PROP_FIELDS>, 'parts' | 'hit' | 'use'> & {
  readonly parts: readonly PropPart[];
  readonly hit: (touch: PropTouch) => void;
  readonly use: (touch: PropTouch) => void;
};

/** Every key of `T` optional, and those of the plain objects in it (not arrays or functions). */
type Partly<T> = {
  -readonly [K in keyof T]?: T[K] extends readonly unknown[] | ((...args: never[]) => unknown)
    ? T[K]
    : T[K] extends object
      ? { -readonly [P in keyof T[K]]?: T[K][P] }
      : T[K];
};

/** What `defineProp` takes: any field, and of its objects (body, light, place, each part and its flame) any key. */
export type PropDefinition = Partly<Omit<Prop, 'id' | 'kind' | 'parts'>> & { parts?: readonly Partly<PropPart>[] };

/** A spawn name or light tag: a word. */
const WORD = /^[A-Za-z0-9_-]+$/;
/** A colour: `#rgb` or `#rrggbb`. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The problems of a prop beyond its fields: parts, colours, vectors, its body's size and its placement words. */
function propProblems(prop: Prop): string[] {
  const problems: string[] = [];
  const vector = (value: readonly number[], where: string) => {
    if (value.length !== 3) problems.push(`${where} has ${value.length} numbers; it is [x, y, z]`);
  };
  const colour = (value: string, where: string) => {
    if (!HEX.test(value)) problems.push(`${where} "${value}" is not a hex colour ('#ffc8a0')`);
  };
  if (!prop.parts.length && !prop.light.tag) problems.push('it draws nothing: give it a part, or a light');
  const names = new Set<string>();
  prop.parts.forEach((part, i) => {
    const at = `parts[${i}]`;
    if (names.has(part.name)) problems.push(`${at}.name "${part.name}" is taken by another part; name each part`);
    names.add(part.name);
    vector(part.position, `${at}.position`);
    vector(part.rotation, `${at}.rotation`);
    colour(part.tint, `${at}.tint`);
    colour(part.flame.core, `${at}.flame.core`);
  });
  const { body, light, place } = prop;
  vector(body.size, 'body.size');
  if (body.type !== 'none') {
    const sizes = body.shape === 'box' ? body.size : [body.radius, ...(body.shape === 'ball' ? [] : [body.height])];
    if (sizes.some((size) => !(size > 0)) && body.shape !== 'capsule') {
      problems.push(`a ${body.shape} body needs sizes above 0: ${body.shape === 'box' ? 'size' : 'radius and height'}`);
    }
    if (body.shape === 'capsule' && !(body.radius > 0)) problems.push('a capsule body needs a radius above 0');
    if (body.type === 'dynamic' && !(body.density > 0)) problems.push('a dynamic body needs a density above 0');
  }
  vector(light.position, 'light.position');
  colour(light.color, 'light.color');
  for (const [key, word] of [
    ['place.spawn', place.spawn],
    ['place.light', place.light],
    ['light.tag', light.tag],
  ]) {
    if (word && !WORD.test(word)) problems.push(`${key} "${word}" must be a word (letters, digits, _ and -)`);
  }
  return problems;
}

/** Declares the kind `prop` on `registry`, with the engine's props, unless it has it. */
export function propKind(registry: Registry): void {
  if (registry.kinds().includes('prop')) return;
  registry.defineKind('prop', {
    description:
      'Props: things that stand in a level, as data: meshes (geometry and material by id), a body, an optional light spot, where a level places them, and interaction hooks.',
    fields: PROP_FIELDS,
    fallback: 'prop:crate',
    defineWith: "defineProp('<id>', { parts: [{ geometry: '…', material: '…' }], body: { type: 'dynamic', … } })",
    check: (entry) => propProblems(entry as unknown as Prop),
  });
  for (const [id, spec] of Object.entries(BUILT_IN_PROPS)) registry.def('prop', id, { ...spec });
}
propKind(sharedRegistry);

/**
 * Defines a prop on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (a part name used twice, a colour that is not hex, a body without a size…), `CORE_DUPLICATE_ID` when
 * defined twice.
 */
export function defineProp(id: string, spec: PropDefinition, registry: Registry = sharedRegistry): Prop {
  propKind(registry);
  return registry.def('prop', id, { ...spec } as Record<string, unknown>) as unknown as Prop;
}

/** The prop `id` of `registry` (the shared one by default); a missing id gives `prop:crate`, with a warning. */
export function getProp(id: string, registry: Registry = sharedRegistry): Prop {
  propKind(registry);
  return registry.get('prop', id) as unknown as Prop;
}

/** The height of a prop's centre above its base (m): its body's origin, half its shape's height; 0 without a body. */
export function propCentre(prop: Prop): number {
  const { type, shape, size, radius, height } = prop.body;
  if (type === 'none') return 0;
  if (shape === 'box') return size[1] / 2;
  if (shape === 'ball') return radius;
  return shape === 'capsule' ? height / 2 + radius : height / 2;
}
