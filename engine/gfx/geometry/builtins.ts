/**
 * @file The geometry kit's built-in entries (PLAN.md WP 2.4): one `geometry` entry per builder of
 * engine/gfx/geometry/, its parameters the builder's options as schema fields with the builder's defaults, and a
 * vertex budget a little above what the defaults build. Every registry gets them with the kind `geometry`
 * (engine/gfx/geometry/geometry.ts); a game's own shapes (`geometry:crate`) live with the game.
 *
 * Invariants: ids `geometry:<builder>`; parameters in metres (`unit: 'm'`) or counts; each default is the builder's
 * own, so `buildGeometry('geometry:ring')` and `ringGeometry()` build the same.
 *
 * @example
 * Object.keys(BUILT_IN_GEOMETRY); // ['geometry:box', 'geometry:roundedBox', 'geometry:limb', 'geometry:ramp', 'geometry:frustum', 'geometry:pillar', 'geometry:ring']
 * @see engine/gfx/geometry/geometry.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { boxGeometry } from './box';
import { frustumGeometry } from './frustum';
import { limbGeometry } from './limb';
import { pillarGeometry } from './pillar';
import { rampGeometry } from './ramp';
import { ringGeometry } from './ring';
import { roundedBoxGeometry } from './roundedBox';

/** A size in metres: at least `minimum` (1 mm by default). */
const metres = (value: number, description: string, minimum = 0.001) =>
  ({ type: 'number', default: value, minimum, unit: 'm', description }) as const;

/** A whole number of segments, at least `minimum`. */
const steps = (value: number, description: string, minimum: number) =>
  ({ type: 'integer', default: value, minimum, maximum: 256, description }) as const;

/** The builder taking `params` as its options. */
const from =
  <O>(build: (options: O) => BufferGeometry) =>
  (params: Record<string, unknown>) =>
    build(params as O);

/** The kit's entries by id, as `defineGeometry` specs. */
export const BUILT_IN_GEOMETRY = {
  'geometry:box': {
    description: 'A box standing on the ground, UVs in metres on every face (boxGeometry).',
    params: {
      width: metres(1, 'Along X.'),
      height: metres(1, 'Along Y, up from the ground.'),
      depth: metres(1, 'Along Z.'),
    },
    budget: 24,
    create: from(boxGeometry),
  },
  'geometry:roundedBox': {
    description: 'A box with rounded edges and corners, smooth normals (roundedBoxGeometry): crates, chests, a head.',
    params: {
      width: metres(1, 'Along X.'),
      height: metres(1, 'Along Y.'),
      depth: metres(1, 'Along Z.'),
      radius: metres(0.1, 'The rounding: at most half the smallest side.', 0),
      segments: steps(2, 'Steps over each 45° of the rounding.', 1),
    },
    budget: 600,
    create: from(roundedBoxGeometry),
  },
  'geometry:limb': {
    description: 'A tapered limb from the origin up +Y: the hull of two spheres (limbGeometry).',
    params: {
      length: metres(0.5, 'From joint to joint.'),
      radiusStart: metres(0.08, 'The radius at the origin.'),
      radiusEnd: metres(0.06, 'The radius at the far joint.'),
      radialSegments: steps(12, 'Steps around.', 3),
      capSegments: steps(4, 'Rings over each cap.', 1),
    },
    budget: 300,
    create: from(limbGeometry),
  },
  'geometry:ramp': {
    description: 'A ramp rising towards +Z, or a wedge with low 0 (rampGeometry).',
    params: {
      width: metres(1, 'Across (X).'),
      depth: metres(2, 'Along the run (Z).'),
      low: metres(0, 'The height at the -Z end.', 0),
      high: metres(1, 'The height at the +Z end.'),
    },
    budget: 24,
    create: from(rampGeometry),
  },
  'geometry:frustum': {
    description: 'A frustum, prism, cylinder or cone standing on the ground, faceted or smooth (frustumGeometry).',
    params: {
      radiusBottom: metres(1, 'The bottom corners’ radius.'),
      radiusTop: metres(1, 'The top corners’ radius; 0 for a cone.', 0),
      height: metres(1, 'Up from the ground.'),
      radialSegments: steps(8, 'Sides around.', 3),
      smooth: { type: 'boolean', default: false, description: 'Smooth normals around instead of flat sides.' },
    },
    budget: 120,
    create: from(frustumGeometry),
  },
  'geometry:pillar': {
    description:
      'A pillar with a plinth, a shaft and a two-slab capital, as one geometry, sides then tops (pillarGeometry).',
    params: {
      width: metres(2, 'The footprint’s side.'),
      height: metres(3.5, 'From the ground to the top of the capital.'),
    },
    budget: 96,
    create: from(pillarGeometry),
  },
  'geometry:ring': {
    description: 'A ring on the ground: flat and facing up, or a solid band with a height (ringGeometry).',
    params: {
      innerRadius: metres(0.8, 'The hole’s radius; 0 for a disc.', 0),
      outerRadius: metres(1, 'The outer radius.'),
      height: metres(0, 'The band’s height; 0 for a flat ring.', 0),
      radialSegments: steps(32, 'Steps around.', 3),
    },
    budget: 160,
    create: from(ringGeometry),
  },
} as const;
