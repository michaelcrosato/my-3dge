/**
 * @file The `geo` QA family (PLAN.md §8.6, WP 2.4, I-29): `node x qa geo` checks every `geometry` entry the shared
 * registry has (the kit's, engine/gfx/geometry/builtins.ts, and a game's: each `*.ts` module under
 * `labs/<name>/geometry/` imported first), built at its defaults, and the level meshes (engine/gfx/level/meshes.ts) of
 * every level file the `level` family reads (tools/qa/level.ts: `labs/box/levels/`, `fixtures/levels/`; a level that
 * does not compile is the `level` family's to report). It runs in T1 through `runQa` (tools/qa/geo.test.ts).
 *
 * Metrics, one violation per item and metric, larger worse (engine/gfx/geometry/inspect.ts measures):
 * - `attributes`: a missing `position`, `normal` or `uv`, or an index entry naming no vertex;
 * - `nonFinite`: NaN or infinite numbers;
 * - `degenerate`: triangles with an area below 1e-10 m²;
 * - `normals`: normals not of length 1, and triangles wound against their normals (normal consistency);
 * - `bounds`: for a geometry, the axes longer than 100 m (centimetres taken for metres) or, when fewer than two axes
 *   reach 1 mm, a line or a point; for a level, how far (m) its meshes reach outside the level's bounds;
 * - `vertices`: a geometry's vertices above its entry's `budget`, a level's drawn vertices (each instance counted)
 *   above 32 per map tile;
 * - `drawCalls`: a level's meshes costing more than 20 draw calls with one shadow map;
 * - `recipe`: a level's mesh recipes that no level recipe defines (drawn as grey blocks);
 * - `unstableHash`: 1 when building a geometry twice gives other buffers;
 * - `build`: 1 when building threw, with the error.
 * A violation names the numbers, the budget and the likely fix. Accepted exceptions go in
 * `tests/baselines/qa-geo.json`, each with its reason.
 *
 * Invariants: geometry in id order, then levels in `levelFiles` order, so violations come in a fixed order; the level
 * meshes are built with stand-in materials (geometry only) and a log of their own, so the family prints nothing.
 *
 * @example
 * import { registry } from '../../engine/core/registry';
 * checkGeometries(registry, ['geometry:box']).length; // 0
 * @see tools/qa/geo.test.ts
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Box3, MeshBasicMaterial, type BufferGeometry, type InstancedMesh } from 'three/webgpu';
import { createLog } from '../../engine/core/log';
import { registry as sharedRegistry, type Registry } from '../../engine/core/registry';
import { buildGeometry, geometryKind, type GeometryEntry } from '../../engine/gfx/geometry/geometry';
import { inspectGeometry } from '../../engine/gfx/geometry/inspect';
import { createLevelMeshes } from '../../engine/gfx/level/meshes';
import { compileLevel } from '../../engine/world/level/compile';
import type { CompiledLevel } from '../../engine/world/level/types';
import type { QaFamily, QaViolation } from '../cmd/qa';
import { levelFiles } from './level';

/** The longest a geometry may be on any axis (m). */
export const MAX_SIZE = 100;
/** The shortest extent that counts as an axis (m). */
const MIN_SIZE = 0.001;
/** Drawn vertices a level may have per map tile. */
export const LEVEL_VERTICES_PER_TILE = 32;
/** Draw calls a level's meshes may cost with one shadow map. */
export const LEVEL_DRAW_CALLS = 20;

/** A game's geometry modules, `labs/<name>/geometry/*.ts` (tests excluded), labs and files in name order. */
export function geometryModules(root: string): string[] {
  const labs = join(root, 'labs');
  if (!existsSync(labs)) return [];
  return readdirSync(labs)
    .sort()
    .map((lab) => join('labs', lab, 'geometry'))
    .filter((dir) => existsSync(join(root, dir)))
    .flatMap((dir) =>
      readdirSync(join(root, dir))
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .sort()
        .map((name) => join(dir, name)),
    );
}

/** The violations of `geometry`'s faults, as `id`'s (the measures every item shares). */
function faultsOf(id: string, geometry: BufferGeometry, where: string): QaViolation[] {
  const report = inspectGeometry(geometry);
  const out: QaViolation[] = [];
  const add = (metric: string, value: number, message: string) => {
    if (value > 0) out.push({ id, metric, value, message: `${where}: ${message}` });
  };
  add(
    'attributes',
    report.missing.length + report.badIndex,
    `missing ${report.missing.join(', ') || 'no attribute'}, ${report.badIndex} index entries naming no vertex: a mesh needs position, normal and uv (UVs in metres), and an index within its vertices`,
  );
  add(
    'nonFinite',
    report.nonFinite,
    `${report.nonFinite} NaN or infinite numbers: look for 0/0 (a zero-length normal) or an unchecked size`,
  );
  add(
    'degenerate',
    report.degenerate,
    `${report.degenerate} of ${report.triangles} triangles have no area: skip triangles with two corners on a pole or a zero-size side`,
  );
  add(
    'normals',
    report.badNormals + report.flipped,
    `${report.badNormals} normals not of length 1 and ${report.flipped} triangles wound against their normals: normalize normals, and list each triangle's corners counter-clockwise seen from where its normal points`,
  );
  return out;
}

/** The violations of one `geometry` entry, built at its defaults. */
function checkEntry(registry: Registry, entry: GeometryEntry): QaViolation[] {
  let geometry: BufferGeometry;
  try {
    geometry = buildGeometry(entry.id, registry);
  } catch (error) {
    return [{ id: entry.id, metric: 'build', value: 1, message: `building it threw: ${(error as Error).message}` }];
  }
  const out = faultsOf(entry.id, geometry, 'at its defaults');
  const { vertices, min, max } = inspectGeometry(geometry);
  const sizes = max.map((high, k) => high - min[k]);
  const long = sizes.filter((size) => size > MAX_SIZE).length;
  const flat = sizes.filter((size) => size >= MIN_SIZE).length < 2;
  if (long || flat) {
    const shown = sizes.map((size) => +size.toFixed(4)).join(' × ');
    const why = long
      ? `longer than ${MAX_SIZE} m: sizes are in metres (a centimetre value is 100 times too big)`
      : 'a line or a point: give it at least two sides of 1 mm or more';
    out.push({ id: entry.id, metric: 'bounds', value: long || 1, message: `its bounds are ${shown} m, ${why}` });
  }
  if (vertices > entry.budget) {
    out.push({
      id: entry.id,
      metric: 'vertices',
      value: vertices,
      message: `${vertices} vertices at its defaults, above its budget of ${entry.budget}: use fewer segments, or raise budget if the shape needs them`,
    });
  }
  const again = buildGeometry(entry.id, registry);
  const same = (name: string) =>
    Array.from(again.getAttribute(name)?.array ?? []).join() ===
    Array.from(geometry.getAttribute(name)?.array ?? []).join();
  if (!['position', 'normal', 'uv'].every(same)) {
    out.push({
      id: entry.id,
      metric: 'unstableHash',
      value: 1,
      message: 'building it twice gave other buffers: a builder takes no randomness and keeps no state between calls',
    });
  }
  return out;
}

/** The violations of every geometry on `registry` (or those of `ids`), in id order. */
export function checkGeometries(registry: Registry = sharedRegistry, ids?: readonly string[]): QaViolation[] {
  geometryKind(registry);
  return (registry.list('geometry') as unknown as GeometryEntry[])
    .filter((entry) => !ids || ids.includes(entry.id))
    .flatMap((entry) => checkEntry(registry, entry));
}

/** The violations of `level`'s meshes, as item `id`. */
export function checkLevelMeshes(id: string, level: CompiledLevel, file?: string): QaViolation[] {
  const unknown: string[] = [];
  const log = createLog({ console: { warn: (line) => unknown.push(line), error: () => {} } });
  const material = new MeshBasicMaterial();
  const meshes = createLevelMeshes(level, { materials: { get: () => material }, log });
  const out: QaViolation[] = [];
  const at = (violation: Omit<QaViolation, 'id'>) => out.push({ id, ...violation, ...(file ? { file } : {}) });
  // The meshes' faults, one violation per metric: the counts summed, the first mesh's message.
  const faults = new Map<string, QaViolation[]>();
  for (const part of meshes.parts) {
    for (const fault of faultsOf(id, part.mesh.geometry, part.name)) {
      faults.set(fault.metric, [...(faults.get(fault.metric) ?? []), fault]);
    }
  }
  for (const [metric, list] of faults) {
    const more = list.length > 1 ? ` (and ${list.length - 1} more meshes)` : '';
    at({ metric, value: list.reduce((sum, fault) => sum + fault.value, 0), message: list[0].message + more });
  }
  if (unknown.length) {
    at({ metric: 'recipe', value: unknown.length, message: unknown.join('; ') });
  }
  const box = new Box3().setFromObject(meshes.root, true);
  const reach = Math.max(
    ...[0, 1, 2].map((k) =>
      Math.max(level.bounds.min[k] - box.min.getComponent(k), box.max.getComponent(k) - level.bounds.max[k]),
    ),
  );
  if (reach > MIN_SIZE) {
    at({
      metric: 'bounds',
      value: reach,
      message: `its meshes reach ${reach.toFixed(3)} m outside the level's bounds (${level.bounds.min.join(', ')} to ${level.bounds.max.join(', ')}): a recipe builds past its pieces' tiles or above their top`,
    });
  }
  const drawn = meshes.parts.reduce((sum, { mesh }) => {
    const copies = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
    return sum + mesh.geometry.getAttribute('position').count * copies;
  }, 0);
  const budget = LEVEL_VERTICES_PER_TILE * level.cols * level.rows;
  if (drawn > budget) {
    at({
      metric: 'vertices',
      value: drawn,
      message: `its meshes draw ${drawn} vertices, above ${LEVEL_VERTICES_PER_TILE} per tile (${budget}): a recipe tessellates too finely; instance or merge its pieces`,
    });
  }
  const calls = meshes.drawCalls(1);
  if (calls > LEVEL_DRAW_CALLS) {
    at({
      metric: 'drawCalls',
      value: calls,
      message: `its meshes cost ${calls} draw calls with one shadow map, above ${LEVEL_DRAW_CALLS}: ${meshes.parts.length} meshes (one per recipe, height, surface and footprint); share recipes and heights between glyphs`,
    });
  }
  meshes.dispose();
  material.dispose();
  return out;
}

/** The family: every geometry of the shared registry, then every level file's meshes. */
const family: QaFamily = {
  async run({ root, only }) {
    for (const module of geometryModules(root)) await import(pathToFileURL(join(root, module)).href);
    const keep = (id: string) => !only.length || only.some((prefix) => id.startsWith(prefix));
    const ids = sharedRegistry.list('geometry').map((entry) => entry.id);
    const violations = checkGeometries(sharedRegistry, ids.filter(keep));
    for (const level of levelFiles(root)) {
      if (!keep(level.id)) continue;
      let compiled: CompiledLevel;
      try {
        compiled = compileLevel(readFileSync(join(root, level.file), 'utf8'), { file: level.file });
      } catch {
        continue;
      }
      violations.push(...checkLevelMeshes(level.id, compiled, level.file));
    }
    return violations;
  },
};

export default family;
