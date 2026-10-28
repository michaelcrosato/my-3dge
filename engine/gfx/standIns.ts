/**
 * @file The stage's stand-ins (engine/gfx/stage.ts, PLAN.md WP 2.7): which entities stand somewhere and where. An entity
 * is drawn as a box when one of its components declares `x` and `z` as numbers in metres (`placeableKinds`, asked of
 * the entries, never of a name); the first such component in registry order places it (`placeOf`): `x`, `y` (the
 * box's bottom, 0 by default) and `z`, `yaw` (rad), `size` (the box's side, m; 0.5 by default) and `material` (a
 * material library id; `material:default` otherwise). Split from stage.ts at its line cap.
 *
 * Invariants: pure reads of the registry and the entity's data; a field that is not a finite number takes its default.
 *
 * @example
 * placeOf({ id: 1, dot: { x: 2, z: 3, size: 0 } }, ['dot']); // { kind: 'dot', place: { x: 2, y: 0, z: 3, yaw: 0, size: 0.5, material: 'material:default' } }
 * @see engine/gfx/stage.test.ts
 */
import type { Registry } from '../core/registry';
import type { Field } from '../core/schema';
import type { EntityData } from '../sim/state';

/** Where a stand-in stands and how it looks, read from its entity's placing component. */
export interface StandInPlace {
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  material: string;
}

/** A side for a stand-in that declares none, m. */
const DEFAULT_SIZE = 0.5;

/** The component kinds whose entities stand somewhere: they declare `x` and `z` as numbers in metres. */
export function placeableKinds(registry: Registry): string[] {
  if (!registry.kinds().includes('component')) return [];
  const metres = (field: unknown) => (field as Field | undefined)?.type === 'number' && (field as Field).unit === 'm';
  const placing = (fields: Record<string, unknown>) => metres(fields.x) && metres(fields.z);
  const list = registry.list('component');
  return list.filter((entry) => placing(entry.fields as Record<string, unknown>)).map((entry) => entry.id);
}

/** A number field of `data`, or `fallback` when it holds none. */
const numberOf = (data: Record<string, unknown>, key: string, fallback: number) =>
  typeof data[key] === 'number' && Number.isFinite(data[key]) ? (data[key] as number) : fallback;

/** Where `entity` stands, from the first of `kinds` it holds; undefined when it holds none. */
export function placeOf(
  entity: EntityData,
  kinds: readonly string[],
): { kind: string; place: StandInPlace } | undefined {
  for (const kind of kinds) {
    const data = entity[kind] as Record<string, unknown> | undefined;
    if (!data) continue;
    const size = numberOf(data, 'size', DEFAULT_SIZE);
    const place = {
      x: numberOf(data, 'x', 0),
      y: numberOf(data, 'y', 0),
      z: numberOf(data, 'z', 0),
      yaw: numberOf(data, 'yaw', 0),
      size: size > 0 ? size : DEFAULT_SIZE,
      material: typeof data.material === 'string' ? data.material : 'material:default',
    };
    return { kind, place };
  }
  return undefined;
}
