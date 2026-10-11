/**
 * @file Telegraphs (PLAN.md WP 6.4, §5.6, §6.6): the registry kind `telegraph`, the warning shapes an attack shows on
 * the floor before it lands, as data (an `arc`, a `ring`, a `line` or a `cone`, in metres), and the geometry sim code
 * tests them with: whether a body is inside one when it goes off, and whether it was a near miss (outside, but within
 * `near` metres: a perfect dodge). engine/gfx/fx draws the same shapes at floor height, filling as the wind-up runs.
 *
 * A telegraph is placed where its attacker stands on the floor (`TelegraphPlace`: `position`, the floor's height in
 * `position.y`, facing `yaw`, forward (sin yaw, 0, cos yaw), its wind-up share `u` from 0 to 1, lengths scaled by
 * `size`). The shapes, in that frame:
 * - `arc`: the floor from `inner` to `radius` within `halfAngle` either side of forward (a swing);
 * - `ring`: the floor from `inner` to `radius` all round (`inner` 0: a disc; a slam);
 * - `line`: a strip `width` wide from the place forward `length` metres (a charge, a beam);
 * - `cone`: an arc from the place itself (`inner` 0), the floor shape of a measured hit cone (`coneOf`).
 * Every shape reaches from `yMin` to `yMax` above the floor. `telegraphGap` is a body's signed distance to the shape
 * (exact on the floor, and above or below the heights to the extruded shape, minus the body's radius: below 0 it
 * overlaps); `inTelegraph` and `nearMiss` read it.
 * The fill a view draws is `telegraphFill`: the reach grows from `inner` to `radius` (a line from 0 to `length`).
 *
 * Carried as a concept from Emberdeep (`my-3d2dge:src/emberdeep/10-combat.js:315-352`: `FX.telegraph`'s circle, arc,
 * line and ring and `teleNearMiss`'s gaps, a near miss within 16 units, 1 m) and the Stress test's walker arc
 * (`src/stress-world/35-effects.js:84-88`: from 0.6 of the body's radius out to the move's reach, ±0.8 rad, `#ff4a3a`,
 * alpha 0.25 to 0.7 as it fills), rebuilt with exact distances.
 *
 * Invariants: sim-side and pure: no clock, no random stream, no state; `Math.sin`, `Math.cos` called by name (the
 * sim's math swap reaches them). An entry is plain data, every field filled; `inner` stays below `radius`, `yMin`
 * below `yMax`. Problems raise `CORE_BAD_SPEC` naming each; a missing id gets `telegraph:arc` after a warning.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * defineTelegraph('telegraph:sweep', { shape: 'arc', inner: 0.3, radius: 2, halfAngle: 1 }, reg);
 * const place = { telegraph: 'telegraph:sweep', position: [0, 0, 0], yaw: 0, u: 1 } as const;
 * telegraphGap(getTelegraph('telegraph:sweep', reg), place, [0, 0, 1.5]); // -0.5: inside, half a metre from the rim
 * nearMiss(getTelegraph('telegraph:sweep', reg), place, [0, 0, 2.6], 0.3); // true: 0.3 m outside, within 1 m
 * @see engine/world/telegraphs.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Schema } from '../core/schema';

/** The shapes a telegraph has. */
export const TELEGRAPH_SHAPES = ['arc', 'ring', 'line', 'cone'] as const;

/** A length in metres, at least 0. */
const metres = (value: number, description: string) =>
  ({ type: 'number', default: value, minimum: 0, unit: 'm', description }) as const;

/** The fields of a `telegraph` entry. */
export const TELEGRAPH_FIELDS = {
  description: { type: 'string', default: '', description: 'What it warns of, in plain sentences.' },
  shape: { type: 'string', enum: TELEGRAPH_SHAPES, default: 'arc', description: 'arc, ring, line or cone.' },
  radius: metres(1.5, "How far an arc, a ring or a cone reaches from the place (the line's: its length)."),
  inner: metres(0, 'Where an arc or a ring starts, from the place: the floor inside it is safe.'),
  halfAngle: {
    type: 'number',
    default: 0.8,
    minimum: 0,
    maximum: Math.PI,
    unit: 'rad',
    description: 'How wide an arc or a cone reaches either side of forward (π: all round).',
  },
  length: metres(3, 'How far a line reaches forward.'),
  width: metres(1, 'How wide a line is.'),
  yMin: { type: 'number', default: -0.25, unit: 'm', description: 'The lowest it reaches, above the floor.' },
  yMax: { type: 'number', default: 2.5, unit: 'm', description: 'The highest it reaches, above the floor.' },
  near: metres(1, 'How far outside it a body still counts a near miss (a perfect dodge).'),
  color: { type: 'string', default: '#ff4a3a', description: 'Its colour on the floor, hex.' },
  alpha: {
    type: 'array',
    items: { type: 'number', minimum: 0, maximum: 1 },
    default: [0.25, 0.7],
    description: "The fill's opacity as the wind-up starts and as it ends, 0 to 1.",
  },
  edge: {
    type: 'number',
    default: 0.6,
    minimum: 0,
    maximum: 1,
    description: "The outline's opacity: the whole shape's rim, shown from the start.",
  },
} as const satisfies Schema;

/** A `telegraph` entry: see the file comment. */
export type Telegraph = Omit<Entry<typeof TELEGRAPH_FIELDS>, 'alpha'> & { readonly alpha: readonly number[] };

/** What `defineTelegraph` takes: any field. */
export type TelegraphSpec = Partial<Omit<Telegraph, 'id' | 'kind'>>;

/** A point: three.js's `Vector3`, `{ x, y, z }` or `[x, y, z]`, metres. */
export type PointLike = Readonly<{ x: number; y: number; z: number }> | readonly [number, number, number];

/** A telegraph where it stands: plain data, as a component or a frame's list holds it. */
export interface TelegraphPlace {
  /** The telegraph's id. */
  readonly telegraph: string;
  /** Where it stands: its origin, on the floor (y is the floor's height). */
  readonly position: PointLike;
  /** Its facing, rad; forward is (sin yaw, 0, cos yaw). */
  readonly yaw: number;
  /** How far its wind-up has run, 0 to 1. */
  readonly u: number;
  /** Scales every length (a big attacker's reach); 1 by default. */
  readonly size?: number;
}

/** The kind's own entries: one generic shape each. */
const BUILT_IN: Record<string, TelegraphSpec> = {
  'telegraph:arc': {
    description: "A swing's warning: from near the attacker out to its reach, 0.8 rad either side of its facing.",
    shape: 'arc',
    inner: 0.3,
    radius: 1.5,
  },
  'telegraph:ring': {
    description: 'A slam or a blast: the floor all round, out to its radius.',
    shape: 'ring',
    radius: 2,
  },
  'telegraph:line': {
    description: 'A charge or a beam: a strip a metre wide, 4 m forward.',
    shape: 'line',
    length: 4,
    width: 1,
  },
  'telegraph:cone': {
    description: 'A thrust or a breath: the floor from the attacker out to its reach, 0.5 rad either side.',
    shape: 'cone',
    radius: 2,
    halfAngle: 0.5,
  },
};

/** A colour: `#rgb` or `#rrggbb`. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The problems of a telegraph beyond its fields. */
function telegraphProblems(t: Telegraph): string[] {
  const problems: string[] = [];
  if (t.shape !== 'line' && !(t.radius > 0)) problems.push(`a ${t.shape} needs a radius above 0`);
  if ((t.shape === 'arc' || t.shape === 'ring') && t.inner >= t.radius) {
    problems.push(`inner ${t.inner} is not below radius ${t.radius}: the ${t.shape} would be empty`);
  }
  if (t.shape === 'line' && !(t.length > 0 && t.width > 0)) problems.push('a line needs a length and a width above 0');
  if (t.yMin >= t.yMax) problems.push(`yMin ${t.yMin} is not below yMax ${t.yMax}`);
  if (t.alpha.length !== 2) problems.push(`alpha has ${t.alpha.length} numbers; it is [start, end]`);
  if (!HEX.test(t.color)) problems.push(`color "${t.color}" is not a hex colour ('#ff4a3a')`);
  return problems;
}

/** Declares the kind `telegraph` on `registry`, with its four shapes, unless it has it. */
export function telegraphKind(registry: Registry): void {
  if (registry.kinds().includes('telegraph')) return;
  registry.defineKind('telegraph', {
    description:
      "Telegraphs: an attack's warning shape on the floor (arc, ring, line or cone, in metres), drawn as it winds up and tested for hits and near misses when it goes off.",
    fields: TELEGRAPH_FIELDS,
    fallback: 'telegraph:arc',
    defineWith: "defineTelegraph('<id>', { shape: 'arc', radius: 2, halfAngle: 0.8 })",
    check: (entry) => telegraphProblems(entry as unknown as Telegraph),
  });
  for (const [id, spec] of Object.entries(BUILT_IN)) registry.def('telegraph', id, { ...spec });
}
telegraphKind(sharedRegistry);

/**
 * Defines a telegraph on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (an empty ring, a line without a width, a colour that is not hex…), `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineTelegraph(id: string, spec: TelegraphSpec, registry: Registry = sharedRegistry): Telegraph {
  telegraphKind(registry);
  return registry.def('telegraph', id, { ...spec } as Record<string, unknown>) as unknown as Telegraph;
}

/** The telegraph `id` of `registry` (the shared one by default); a missing id gives `telegraph:arc`, with a warning. */
export function getTelegraph(id: string, registry: Registry = sharedRegistry): Telegraph {
  telegraphKind(registry);
  return registry.get('telegraph', id) as unknown as Telegraph;
}

/** A cone's fields from a measured hit shape (engine/anim/moves.ts `measureMove`): its range, angle and heights. */
export function coneOf(hit: { range: number; halfAngle: number; yMin: number; yMax: number }): TelegraphSpec {
  const { range, halfAngle, yMin, yMax } = hit;
  return { shape: 'cone', radius: range, halfAngle, yMin, yMax: Math.max(yMax, yMin + 1e-3) };
}

/** The coordinates of a `PointLike`. */
export function pointOf(point: PointLike): [number, number, number] {
  return 'x' in point ? [point.x, point.y, point.z] : [point[0], point[1], point[2]];
}

/** The distance from (x, y) to (px, py). */
const dist = (x: number, y: number, px: number, py: number) => Math.hypot(x - px, y - py);

/**
 * The signed distance on the floor from (`f`, `s`), metres forward and to the side of the place, to the sector of
 * radii `r0`..`r1` within `half` of forward: below 0 inside. Exact; at `half` ≥ π an annulus.
 */
function sectorGap(f: number, s: number, r0: number, r1: number, half: number): number {
  const rho = Math.hypot(f, s);
  if (half >= Math.PI) return Math.max(r0 - rho, rho - r1);
  const [x, y] = [f, Math.abs(s)];
  const theta = Math.atan2(y, x);
  const [ex, ey] = [Math.cos(half), Math.sin(half)];
  const within = theta <= half;
  let d = within ? Math.abs(rho - r1) : dist(x, y, ex * r1, ey * r1);
  if (r0 > 0) d = Math.min(d, within ? Math.abs(rho - r0) : dist(x, y, ex * r0, ey * r0));
  const t = Math.min(r1, Math.max(r0, x * ex + y * ey));
  d = Math.min(d, dist(x, y, ex * t, ey * t));
  return within && rho >= r0 && rho <= r1 ? -d : d;
}

/** The signed distance on the floor from (`f`, `s`) to a strip `length` forward and `width` wide: below 0 inside. */
function lineGap(f: number, s: number, length: number, width: number): number {
  const qx = Math.abs(f - length / 2) - length / 2;
  const qy = Math.abs(s) - width / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/** The signed distance on the floor from (`f`, `s`) to `t`'s shape scaled by `size`: below 0 inside. */
export function floorGap(t: Telegraph, f: number, s: number, size = 1): number {
  if (t.shape === 'line') return lineGap(f, s, t.length * size, t.width * size);
  const inner = t.shape === 'cone' ? 0 : t.inner * size;
  return sectorGap(f, s, inner, t.radius * size, t.shape === 'ring' ? Math.PI : t.halfAngle);
}

/**
 * How far a body at `point` (its feet, metres) with `radius` stands outside telegraph `t` placed at `place`, minus the
 * radius: between its heights, the signed distance to its shape on the floor (below 0 inside); above or below them,
 * the distance to the extruded shape. Below 0 the body overlaps it.
 */
export function telegraphGap(t: Telegraph, place: TelegraphPlace, point: PointLike, radius = 0): number {
  const [px, py, pz] = pointOf(place.position);
  const [x, y, z] = pointOf(point);
  const size = place.size ?? 1;
  const [dx, dz] = [x - px, z - pz];
  const [sin, cos] = [Math.sin(place.yaw), Math.cos(place.yaw)];
  const g = floorGap(t, dx * sin + dz * cos, dz * sin - dx * cos, size);
  const dy = y - py;
  const v = Math.max(t.yMin * size - dy, dy - t.yMax * size);
  return (v > 0 ? Math.hypot(Math.max(g, 0), v) : g) - radius;
}

/** Whether a body at `point` with `radius` overlaps telegraph `t` placed at `place`: what it hits as it goes off. */
export function inTelegraph(t: Telegraph, place: TelegraphPlace, point: PointLike, radius = 0): boolean {
  return telegraphGap(t, place, point, radius) <= 0;
}

/** Whether a body at `point` with `radius` stands outside telegraph `t` but within its `near` metres (scaled). */
export function nearMiss(t: Telegraph, place: TelegraphPlace, point: PointLike, radius = 0): boolean {
  const gap = telegraphGap(t, place, point, radius);
  return gap > 0 && gap <= t.near * (place.size ?? 1);
}

/** How far `t`'s drawn fill reaches at wind-up share `u` (clamped 0 to 1), metres before scaling: see the file comment. */
export function telegraphFill(t: Telegraph, u: number): number {
  const k = Math.min(1, Math.max(0, u));
  if (t.shape === 'line') return t.length * k;
  const inner = t.shape === 'cone' ? 0 : t.inner;
  return inner + (t.radius - inner) * k;
}
