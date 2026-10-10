/**
 * @file The geometry registry (PLAN.md WP 2.4, §6.6, I-29): the registry kind `geometry`, one entry per shape a prop,
 * a level or a body names by id (§6.1: `world` names geometry by id, `gfx` builds it). An entry is a builder with its
 * parameters as schema fields, each with a default, and a vertex budget: `defineGeometry('geometry:crate', {
 * description, params, create: (params) => roundedBoxGeometry({ … }) })`. `buildGeometry(ref)` builds one, from an
 * id or `{ geometry, params }`, as a three.js `BufferGeometry` the caller owns. The kit's shapes are built in
 * (engine/gfx/geometry/builtins.ts): `geometry:box`, `roundedBox`, `limb`, `ramp`, `frustum`, `pillar`, `ring`.
 *
 * The `geo` QA family (tools/qa/geo.ts) builds every entry at its defaults and checks it (degenerate triangles,
 * normal consistency, bounds, the budget), so a game's geometry is checked as the engine's is.
 *
 * Invariants: an entry's parameter schema is checked when it is defined (each field valid and with a default); a
 * builder is called with every parameter filled; `buildGeometry` never caches, so each call returns a new geometry;
 * a missing id stands in as `geometry:box` after a warning (`CORE_UNKNOWN_ID`), as a missing material does.
 *
 * @example
 * import { createRegistry } from '../../core/registry';
 * const reg = createRegistry();
 * buildGeometry({ geometry: 'geometry:box', params: { width: 2 } }, reg).getAttribute('position').count; // 24
 * reg.get('geometry', 'geometry:box').budget; // 24
 * @see engine/gfx/geometry/geometry.test.ts
 */
import type { BufferGeometry } from 'three/webgpu';
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { checkField, isPlainObject, parse, type EntryOf, type Schema } from '../../core/schema';
import { BUILT_IN_GEOMETRY } from './builtins';

/** The fields of a `geometry` entry. */
export const GEOMETRY_FIELDS = {
  description: { type: 'string', required: true, description: 'What it is, in plain sentences.' },
  params: {
    type: 'object',
    default: {},
    description:
      "Its parameters as schema fields (engine/core/schema.ts: type, default, description, minimum…), each with a default: what a prop's geometry may set.",
  },
  budget: {
    type: 'integer',
    default: 4096,
    minimum: 1,
    description: 'The most vertices it may have at its default parameters (the geo QA family checks it).',
  },
  create: {
    type: 'function',
    required: true,
    description:
      'The builder: (params) => BufferGeometry, standing on the ground, in metres, with normals and UVs in metres (engine/gfx/geometry/).',
  },
} as const satisfies Schema;

/** A `geometry` entry: one builder. */
export type GeometryEntry = Entry<typeof GEOMETRY_FIELDS> & {
  readonly params: Schema;
  readonly create: (params: Record<string, unknown>) => BufferGeometry;
};

/** A geometry by id with parameters: what a prop's or a level's `geometry` field may hold beside a bare id. */
export interface GeometryRef {
  geometry: string;
  params?: Record<string, unknown>;
}

/** What `defineGeometry` takes: the entry's fields (`params` and `budget` have defaults), `create` typed by `params`. */
export interface GeometrySpec<S extends Schema = Schema> {
  /** What it is, in plain sentences. */
  description: string;
  /** Its parameters, as schema fields (engine/core/schema.ts), each with its default. */
  params?: S;
  /** The most vertices it may have at its defaults; 4096 by default. */
  budget?: number;
  /** The builder: every parameter filled, as `params` declares them. */
  create: (params: EntryOf<S>) => BufferGeometry;
}

/** The problems of a geometry beyond its fields: its parameter schema. */
function geometryProblems(entry: GeometryEntry): string[] {
  if (!isPlainObject(entry.params)) return ['params must be an object of schema fields'];
  const problems: string[] = [];
  for (const [key, field] of Object.entries(entry.params)) {
    problems.push(...checkField(field, `params.${key}`).map((problem) => problem.message));
    if (isPlainObject(field) && field.default === undefined) {
      problems.push(`params.${key} needs a default: a prop may leave any parameter out`);
    }
  }
  return problems;
}

/** Declares the kind `geometry` on `registry`, with the kit's built-in shapes, unless it has it. */
export function geometryKind(registry: Registry): void {
  if (registry.kinds().includes('geometry')) return;
  registry.defineKind('geometry', {
    description:
      'Shapes props, levels and bodies name by id: a builder of a three.js BufferGeometry with its parameters and a vertex budget.',
    fields: GEOMETRY_FIELDS,
    fallback: 'geometry:box',
    defineWith: "defineGeometry('<id>', { description: '…', params: { … }, create: (params) => boxGeometry({ … }) })",
    check: (entry) => geometryProblems(entry as unknown as GeometryEntry),
  });
  for (const [id, spec] of Object.entries(BUILT_IN_GEOMETRY)) {
    registry.def('geometry', id, spec as unknown as Record<string, unknown>);
  }
}
geometryKind(sharedRegistry);

/**
 * Defines a geometry on `registry` (the shared one by default) and returns it. Throws `CORE_BAD_SPEC` naming each
 * problem (a parameter without a description or default…), `CORE_DUPLICATE_ID` when defined twice.
 */
export function defineGeometry<const S extends Schema>(
  id: string,
  spec: GeometrySpec<S>,
  registry: Registry = sharedRegistry,
): GeometryEntry {
  geometryKind(registry);
  return registry.def('geometry', id, spec as unknown as Record<string, unknown>) as unknown as GeometryEntry;
}

/** The geometry `id` of `registry` (the shared one by default); a missing id gives `geometry:box`, with a warning. */
export function getGeometry(id: string, registry: Registry = sharedRegistry): GeometryEntry {
  geometryKind(registry);
  return registry.get('geometry', id) as unknown as GeometryEntry;
}

/**
 * Builds geometry `ref` (an id, or `{ geometry, params }`) from `registry` (the shared one by default): a new
 * `BufferGeometry` the caller owns and disposes. A missing id builds `geometry:box` at its defaults, with a warning.
 * Throws `CORE_BAD_SPEC` for parameters its schema refuses, and what the builder throws (`GFX_BAD_GEOMETRY`).
 */
export function buildGeometry(ref: string | GeometryRef, registry: Registry = sharedRegistry): BufferGeometry {
  const { geometry, params = {} } = typeof ref === 'string' ? { geometry: ref } : ref;
  const entry = getGeometry(geometry, registry);
  const given = entry.id === geometry ? params : {};
  const filled = parse(entry.params, given, `the params of ${entry.id}`) as Record<string, unknown>;
  return entry.create(filled);
}
