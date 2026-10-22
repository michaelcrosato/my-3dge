/**
 * @file The `geo` QA family (PLAN.md §8.6, WP 2.4, I-29): `node x qa geo` checks every `geometry` entry the shared
 * registry has (the kit's, engine/gfx/geometry/builtins.ts, and a game's: each `*.ts` module under
 * `labs/<name>/geometry/` imported first), built at its defaults; every `prop` entry's parts (WP 4.5: the engine's,
 * engine/world/props/catalog.ts, and a game's under `labs/<name>/props/`), each built as the prop draws it, under the
 * prop's id; and the level meshes (engine/gfx/level/meshes.ts) of every level file the `level` family reads
 * (tools/qa/level.ts: `labs/box/levels/`, `fixtures/levels/`; a level that does not compile is the `level` family's
 * to report). It runs in T1 through `runQa` (tools/qa/geo.test.ts).
 *
 * Metrics, one violation per item and metric, larger worse (engine/gfx/geometry/inspect.ts measures):
 * - `attributes`: a missing `position`, `normal` or `uv`, or an index entry naming no vertex;
 * - `nonFinite`: NaN or infinite numbers;
 * - `degenerate`: triangles with an area below 1e-10 m²;
 * - `normals`: normals not of length 1, and triangles wound against their normals (normal consistency);
 * - `bounds`: for a geometry, the axes longer than 100 m (centimetres taken for metres) or, when fewer than two axes
 *   reach 1 mm, a line or a point; for a level, how far (m) its meshes reach outside the level's bounds, past the
 *   1 cm a door's or a window's frame stands out of an outer wall on the map's edge (engine/gfx/level/openings.ts);
 * - `vertices`: a geometry's (or a prop part's) vertices above its entry's `budget`, a level's drawn vertices (each
 *   instance counted) above 32 per map tile a storey;
 * - `reference`: a prop part naming a geometry no entry defines (drawn as a box);
 * - `float`: a prop with a body whose parts' lowest point is more than 1 cm above or below its base, where its
 *   body stands: it floats or sinks;
 * - `drawCalls`: a level's meshes costing more than 20 draw calls a storey with one shadow map;
 * - `recipe`: a level's mesh recipes that no level recipe defines (drawn as grey blocks);
 * - `unstableHash`: 1 when building a geometry twice gives other buffers;
 * - `build`: 1 when building threw, with the error.
 * A violation names the numbers, the budget and the likely fix. Accepted exceptions go in
 * `tests/baselines/qa-geo.json`, each with its reason.
 *
 * Invariants: geometry in id order, then props in id order (each one's parts in order), then levels in `levelFiles`
 * order, so violations come in a fixed order; the level
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
import { PROUD } from '../../engine/gfx/level/openings';
import { buildPropPart, partMatrix } from '../../engine/gfx/props';
import { propKind, type Prop } from '../../engine/world/props/prop';
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
  return labModules(root, 'geometry');
}

/** A game's modules in `labs/<name>/<folder>/*.ts` (tests excluded), labs and files in name order. */
export function labModules(root: string, folder: string): string[] {
  const labs = join(root, 'labs');
  if (!existsSync(labs)) return [];
  return readdirSync(labs)
    .sort()
    .map((lab) => join('labs', lab, folder))
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
  return checkShape(entry.id, () => buildGeometry(entry.id, registry), entry.budget, 'at its defaults', '').violations;
}

/**
 * The violations of the shape `build` builds, as item `id`, and the shape: `where` says which shape (`at its
 * defaults`), and `lead` starts the messages that do not name it otherwise.
 */
function checkShape(
  id: string,
  build: () => BufferGeometry,
  budget: number,
  where: string,
  lead: string,
): { violations: QaViolation[]; geometry: BufferGeometry | null } {
  let geometry: BufferGeometry;
  try {
    geometry = build();
  } catch (error) {
    const message = `${lead}building it threw: ${(error as Error).message}`;
    return { violations: [{ id, metric: 'build', value: 1, message }], geometry: null };
  }
  const out = faultsOf(id, geometry, where);
  const { vertices, min, max } = inspectGeometry(geometry);
  const sizes = max.map((high, k) => high - min[k]);
  const long = sizes.filter((size) => size > MAX_SIZE).length;
  const flat = sizes.filter((size) => size >= MIN_SIZE).length < 2;
  if (long || flat) {
    const shown = sizes.map((size) => +size.toFixed(4)).join(' × ');
    const why = long
      ? `longer than ${MAX_SIZE} m: sizes are in metres (a centimetre value is 100 times too big)`
      : 'a line or a point: give it at least two sides of 1 mm or more';
    out.push({ id, metric: 'bounds', value: long || 1, message: `${lead}its bounds are ${shown} m, ${why}` });
  }
  if (vertices > budget) {
    out.push({
      id,
      metric: 'vertices',
      value: vertices,
      message: `${vertices} vertices ${where}, above its budget of ${budget}: use fewer segments, or raise budget if the shape needs them`,
    });
  }
  const again = build();
  const same = (name: string) =>
    Array.from(again.getAttribute(name)?.array ?? []).join() ===
    Array.from(geometry.getAttribute(name)?.array ?? []).join();
  if (!['position', 'normal', 'uv'].every(same)) {
    out.push({
      id,
      metric: 'unstableHash',
      value: 1,
      message: `${lead}building it twice gave other buffers: a builder takes no randomness and keeps no state between calls`,
    });
  }
  again.dispose();
  return { violations: out, geometry };
}

/** How far (m) a prop's parts may reach below or stop above its base, where its body stands. */
export const PROP_FLOAT = 0.01;

/** The violations of one prop's parts, each built as the prop draws it, as the prop's id. */
function checkProp(registry: Registry, prop: Prop): QaViolation[] {
  const out: QaViolation[] = [];
  let lowest = Infinity;
  for (const part of prop.parts) {
    const named = `part ${part.name} (${part.geometry})`;
    if (!registry.has('geometry', part.geometry)) {
      const message = `${named} names a geometry no entry defines, so it draws as a box: define it, or name one of node x describe geometry`;
      out.push({ id: prop.id, metric: 'reference', value: 1, message });
      continue;
    }
    const budget = (registry.get('geometry', part.geometry) as unknown as GeometryEntry).budget;
    const build = () => buildPropPart(part, registry);
    const { violations, geometry } = checkShape(prop.id, build, budget, `in ${named}`, `${named}: `);
    out.push(...violations);
    if (!geometry || part.flame.tongues) continue;
    geometry.applyMatrix4(partMatrix(part));
    lowest = Math.min(lowest, inspectGeometry(geometry).min[1]);
    geometry.dispose();
  }
  if (prop.body.type !== 'none' && Number.isFinite(lowest) && Math.abs(lowest) > PROP_FLOAT) {
    const off = `${Math.abs(lowest).toFixed(3)} m ${lowest > 0 ? 'above' : 'below'}`;
    const message = `its parts' lowest point is ${off} its base, where its ${prop.body.shape} body stands, so the prop ${lowest > 0 ? 'floats' : 'sinks'}: stand the parts on the base (their position's y), or size the body to them`;
    out.push({ id: prop.id, metric: 'float', value: Math.abs(lowest), message });
  }
  return out;
}

/** The violations of every prop on `registry` (or those of `ids`), in id order, as the props' ids. */
export function checkProps(registry: Registry = sharedRegistry, ids?: readonly string[]): QaViolation[] {
  propKind(registry);
  geometryKind(registry);
  return (registry.list('prop') as unknown as Prop[])
    .filter((prop) => !ids || ids.includes(prop.id))
    .flatMap((prop) => checkProp(registry, prop));
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
  if (reach > MIN_SIZE + PROUD) {
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
  const storeys = level.storeys?.length ?? 1;
  const budget = LEVEL_VERTICES_PER_TILE * level.cols * level.rows * storeys;
  if (drawn > budget) {
    at({
      metric: 'vertices',
      value: drawn,
      message: `its meshes draw ${drawn} vertices, above ${LEVEL_VERTICES_PER_TILE} per tile (${budget}): a recipe tessellates too finely; instance or merge its pieces`,
    });
  }
  const calls = meshes.drawCalls(1);
  if (calls > LEVEL_DRAW_CALLS * storeys) {
    at({
      metric: 'drawCalls',
      value: calls,
      message: `its meshes cost ${calls} draw calls with one shadow map, above ${LEVEL_DRAW_CALLS * storeys} (${LEVEL_DRAW_CALLS} a storey): ${meshes.parts.length} meshes (one per recipe, height, surface and footprint); share recipes and heights between glyphs`,
    });
  }
  meshes.dispose();
  material.dispose();
  return out;
}

/** The family: every geometry of the shared registry, then every prop's parts, then every level file's meshes. */
const family: QaFamily = {
  async run({ root, only, keep: asked }) {
    for (const module of [...geometryModules(root), ...labModules(root, 'props')]) {
      await import(pathToFileURL(join(root, module)).href);
    }
    const keep = asked ?? ((id: string) => !only.length || only.some((prefix) => id.startsWith(prefix)));
    const ids = sharedRegistry.list('geometry').map((entry) => entry.id);
    const violations = checkGeometries(sharedRegistry, ids.filter(keep));
    propKind(sharedRegistry);
    const props = sharedRegistry.list('prop').map((entry) => entry.id);
    violations.push(...checkProps(sharedRegistry, props.filter(keep)));
    for (const level of levelFiles(root)) {
      if (!keep(level.id)) continue;
      let compiled: CompiledLevel;
      try {
        compiled = compileLevel(readFileSync(join(root, level.file), 'utf8'), {
          file: level.file,
          registry: level.registry,
        });
      } catch {
        continue;
      }
      violations.push(...checkLevelMeshes(level.id, compiled, level.file));
    }
    return violations;
  },
};

export default family;
