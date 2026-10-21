/**
 * @file Sites (PLAN.md WP 13.15; docs/PLAYGROUND.md §6.3): a scene's levels standing on its terrain. `defineSite(id, {
 * terrain, structures })` registers one (the registry kind `site`) and `getSite(id)` makes it (`makeSite`): each
 * structure a level placed with its map's north-west corner at `at` (its storey on 0 standing at `at`'s height) and
 * turned `turn` quarter turns about +Y (counter-clockwise from above: east to north). The terrain is flattened round
 * each footprint to that height (`flatten` metres of margin), and cut where a structure reaches under it (the tiles of a
 * storey below its ground floor, a basement, and the rectangles it names in `cuts`: window wells, a bulkhead), so the
 * cutaway can show what is below and nobody walks on ground over a basement.
 *
 * Queries over all of it, in world metres (engine/world/siteQueries.ts): the highest surface under a point, its tag,
 * the structure, storey and room a point is in, whether a point is in a solid, and a clear sight line. `toLocal` and
 * `toWorld` carry points between a structure's frame and the world exactly (a quarter turn swaps and negates, so no
 * trigonometry), and `quarterTurn` is the rotation bodies and meshes take.
 *
 * Invariants: pure: equal specs give equal sites in Node and Chromium; a structure keeps its level's own data, in its
 * own frame; the terrain's cut is a flag per cell (`cut`), 1 where nothing of the terrain stands.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * import { defineLevel } from './level/level';
 * const reg = createRegistry();
 * defineLevel('level:hut', { text: '#####\n#...#\n#####\n', file: 'hut.txt' }, reg);
 * defineSite('site:yard', { structures: [{ level: 'level:hut', at: [10, 0, 4], turn: 1 }] }, reg);
 * const [hut] = getSite('site:yard', reg).structures;
 * [hut.footprint, toWorld(hut, 1, 0), toLocal(hut, 10, 3)]; // [[10, -1, 13, 4], [10, 3], [1, 0]]: turned, east is north
 * @see engine/world/site.test.ts
 */
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import type { Schema } from '../core/schema';
import { getLevel } from './level/level';
import type { CompiledLevel } from './level/types';
import { makeTerrain, type Terrain, type TerrainFlat, type TerrainSpec } from './terrain';

/** The fields of a `site` entry (see the file comment). */
export const SITE_FIELDS = {
  terrain: { type: 'string', default: '', description: 'Its terrain (`terrain:<name>`); none when empty.' },
  structures: { type: 'array', items: { type: 'object' }, default: [], description: 'The levels standing on it: { level, at: [x, y, z], turn (quarter turns, 0 to 3), flatten (m, 4: the ground flattened round it), cuts ([[x0, z0, x1, z1]], its own metres: holes in the ground) }.' }, // prettier-ignore
} as const satisfies Schema;

/** A `site` entry. */
export type SiteEntry = Entry<typeof SITE_FIELDS>;

/** A structure as a site's spec places it. */
export interface StructureSpec {
  readonly level: string;
  readonly at: readonly [number, number, number];
  readonly turn?: number;
  readonly flatten?: number;
  readonly cuts?: readonly (readonly [number, number, number, number])[];
}

/** What `defineSite` takes. */
export interface SiteSpec {
  readonly terrain?: string;
  readonly structures?: readonly StructureSpec[];
}

/** A quarter turn's count, 0 to 3. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** A structure placed: its level, in its own frame, and where it stands (see the file comment). */
export interface SiteStructure {
  /** Its level's name, and its index in the site. */
  readonly name: string;
  readonly index: number;
  readonly level: CompiledLevel;
  readonly at: readonly [number, number, number];
  readonly turn: QuarterTurns;
  /** Its map's rectangle in the world, [x0, z0, x1, z1] (m). */
  readonly footprint: readonly [number, number, number, number];
  /** Its box in the world (m). */
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }; // prettier-ignore
  /** The rectangles it cuts out of the ground, in its own metres. */
  readonly cuts: readonly (readonly [number, number, number, number])[];
}

/** A made site (see the file comment). */
export interface Site {
  /** Its id without `site:`. */
  readonly name: string;
  readonly terrain: Terrain | null;
  readonly structures: readonly SiteStructure[];
  /** Per terrain cell, row by row: 1 where the terrain is cut (null without a terrain or a cut). */
  readonly cut: Uint8Array | null;
}

/** World (x, z) from a structure's own (lx, lz): turned `turn` quarter turns, then moved to `at`. */
export function toWorld(s: Pick<SiteStructure, 'at' | 'turn'>, lx: number, lz: number): [number, number] {
  const [x, z] = turnVector(s.turn, lx, lz);
  return [s.at[0] + x, s.at[2] + z];
}

/** A direction (x, z) turned `turn` quarter turns about +Y, as `toWorld` turns a structure's; never −0 (state holds it). */
export function turnVector(turn: QuarterTurns, x: number, z: number): [number, number] {
  const [px, pz, nx, nz] = [x || 0, z || 0, -x || 0, -z || 0]; // never −0, whatever comes in
  return ([[px, pz], [pz, nx], [nx, nz], [nz, px]] as [number, number][])[turn]; // prettier-ignore
}

/** A structure's own (x, z) from world (wx, wz): `toWorld` undone. */
export function toLocal(s: Pick<SiteStructure, 'at' | 'turn'>, wx: number, wz: number): [number, number] {
  const [dx, dz] = [wx - s.at[0], wz - s.at[2]];
  return [
    [dx, dz],
    [-dz, dx],
    [-dx, -dz],
    [dz, -dx],
  ][s.turn] as [number, number];
}

/** The rotation of `turn` quarter turns about +Y, as [x, y, z, w]. */
export function quarterTurn(turn: QuarterTurns): readonly [number, number, number, number] {
  return ([[0, 0, 0, 1], [0, Math.SQRT1_2, 0, Math.SQRT1_2], [0, 1, 0, 0], [0, Math.SQRT1_2, 0, -Math.SQRT1_2]] as const)[turn]; // prettier-ignore
}

/** A local rectangle [x0, z0, x1, z1] (m) of structure `s` as a world rectangle. */
export function worldRect(
  s: Pick<SiteStructure, 'at' | 'turn'>,
  [x0, z0, x1, z1]: readonly number[],
): [number, number, number, number] {
  // prettier-ignore
  const [a, b] = [toWorld(s, x0, z0), toWorld(s, x1, z1)];
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** The problems with a site spec's shape; none when it makes a site. */
export function siteProblems(spec: SiteSpec): string[] {
  const problems: string[] = [];
  (spec.structures ?? []).forEach((s, i) => {
    const at = s?.at as unknown;
    if (typeof s?.level !== 'string') problems.push(`structures[${i}].level must be a level id`);
    if (!Array.isArray(at) || at.length !== 3 || !at.every(Number.isFinite)) problems.push(`structures[${i}].at must be [x, y, z] (m)`); // prettier-ignore
    if (s?.turn !== undefined && ![0, 1, 2, 3].includes(s.turn)) problems.push(`structures[${i}].turn must be 0, 1, 2 or 3 quarter turns`); // prettier-ignore
    if (s?.flatten !== undefined && !(s.flatten >= 0))
      problems.push(`structures[${i}].flatten must be 0 or more metres`);
    for (const cut of s?.cuts ?? []) {
      if (!Array.isArray(cut) || cut.length !== 4 || !(cut[2] > cut[0] && cut[3] > cut[1])) problems.push(`structures[${i}].cuts must be [x0, z0, x1, z1] rectangles (x1 > x0, z1 > z0)`); // prettier-ignore
    }
  });
  return problems;
}

/** A structure placed from its spec (see `SiteStructure`). */
function place(spec: StructureSpec, index: number, registry: Registry): SiteStructure {
  const level = getLevel(spec.level, registry);
  const turn = (spec.turn ?? 0) as QuarterTurns;
  const at = [spec.at[0], spec.at[1], spec.at[2]] as const;
  const footprint = worldRect({ at, turn }, [0, 0, level.cols * level.tile, level.rows * level.tile]);
  const [lo, hi] = [level.bounds.min, level.bounds.max];
  const box = worldRect({ at, turn }, [lo[0], lo[2], hi[0], hi[2]]);
  const bounds = { min: [box[0], at[1] + lo[1], box[1]] as const, max: [box[2], at[1] + hi[1], box[3]] as const };
  return { name: level.name, index, level, at, turn, footprint, bounds, cuts: spec.cuts ?? [] };
}

/** The local rectangles a structure cuts out of the ground: its storeys' floored tiles below its ground floor, and its own. */
function cutRects(s: SiteStructure): (readonly [number, number, number, number])[] {
  const { level } = s;
  const t = level.tile;
  const below = (level.storeys ?? []).filter((storey) => storey.base < 0);
  const tiles: [number, number, number, number][] = [];
  for (const storey of below) {
    storey.floored.forEach((floored, i) => {
      const [c, r] = [i % level.cols, Math.floor(i / level.cols)];
      if (floored) tiles.push([c * t, r * t, (c + 1) * t, (r + 1) * t]);
    });
  }
  return [...tiles, ...s.cuts];
}

/** The terrain's cells a cut covers (their centres inside one of the structures' cut rectangles), or null. */
function cutCells(terrain: Terrain, structures: readonly SiteStructure[]): Uint8Array | null {
  const { cols, rows, cell, origin } = terrain;
  const cut = new Uint8Array(cols * rows);
  let any = false;
  for (const s of structures) {
    for (const rect of cutRects(s)) {
      const [x0, z0, x1, z1] = worldRect(s, rect);
      const [c0, c1] = [Math.ceil((x0 - origin[0]) / cell - 0.5), Math.floor((x1 - origin[0]) / cell - 0.5)];
      const [r0, r1] = [Math.ceil((z0 - origin[2]) / cell - 0.5), Math.floor((z1 - origin[2]) / cell - 0.5)];
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) [cut[r * cols + c], any] = [1, true];
      }
    }
  }
  return any ? cut : null;
}

/** Makes `spec`'s site, named `name`, from the levels and the terrain `registry` holds (see the file comment). */
export function makeSite(spec: SiteSpec, name = 'site', registry: Registry = sharedRegistry): Site {
  const problems = siteProblems(spec);
  if (problems.length) throw codeError('CORE_BAD_SPEC', { where: `site ${name}`, problems: problems.join('; ') });
  const structures = (spec.structures ?? []).map((s, i) => place(s, i, registry));
  let terrain: Terrain | null = null;
  if (spec.terrain) {
    const given = registry.get('terrain', spec.terrain) as unknown as TerrainSpec & { id: string };
    const flats: TerrainFlat[] = (spec.structures ?? []).map((s, i) => {
      const [x0, z0, x1, z1] = structures[i].footprint;
      return { rect: [x0, z0, x1, z1], height: s.at[1], margin: s.flatten ?? 4 };
    });
    const terrainName = given.id.replace(/^terrain:/, '');
    const all = [...((given.flats ?? []) as unknown as TerrainFlat[]), ...flats] as unknown as TerrainSpec['flats'];
    terrain = makeTerrain({ ...given, flats: all }, terrainName);
  }
  return { name, terrain, structures, cut: terrain ? cutCells(terrain, structures) : null };
}

/** Declares the kind `site` on `registry` unless it has it. */
function siteKind(registry: Registry): void {
  if (registry.kinds().includes('site')) return;
  registry.defineKind('site', {
    description: 'Sites: levels standing on a terrain, each placed at an offset and a quarter turn.',
    fields: SITE_FIELDS,
    defineWith: "defineSite('<id>', { terrain, structures: [{ level, at, turn, flatten, cuts }] })",
    check: (entry) => siteProblems(entry as unknown as SiteSpec),
  });
}
siteKind(sharedRegistry);

/** Registers a site on `registry` (the shared one by default); throws `CORE_BAD_SPEC` naming its problems. */
export function defineSite(id: string, spec: SiteSpec, registry: Registry = sharedRegistry): SiteEntry {
  siteKind(registry);
  return registry.def('site', id, spec as unknown as Record<string, unknown>) as unknown as SiteEntry;
}

/** The site `id` of `registry` (the shared one by default), made afresh: its name is the id without `site:`. */
export function getSite(id: string, registry: Registry = sharedRegistry): Site {
  siteKind(registry);
  const entry = registry.get('site', id) as unknown as SiteSpec & { id: string };
  return makeSite({ terrain: entry.terrain || undefined, structures: entry.structures }, entry.id.replace(/^site:/, ''), registry); // prettier-ignore
}
