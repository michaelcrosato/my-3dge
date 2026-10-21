/**
 * @file Terrain (PLAN.md WP 10.5, §5.8; docs/PLAYGROUND.md §2.2, §6.3): outdoor ground as plain data, a heightfield
 * made from a seeded spec, and the queries on it. `defineTerrain(id, spec)` registers a spec (the registry kind
 * `terrain`); `getTerrain(id)` makes it (`makeTerrain`): a grid of `cols` × `rows` cells `cell` metres wide from its
 * north-west corner `origin`, a height at every cell corner. The physics stands it as a heightfield
 * (engine/sim/levelBodies.ts's `addTerrainBody`, engine/physics/heightfield.ts), the view draws it in chunks
 * (engine/gfx/terrain.ts), navigation walks it (engine/world/terrainNav.ts).
 *
 * A height is shardfall's: fbm value noise of `height` metres' range at the `scale` of its features, plus a ridged
 * fbm (`ridges` of it), then the `hills` (smooth domes, each `height` high and `radius` across from `at`) added, then
 * rounded to `terrace` steps when that is set, then pulled to each of the `flats` (a footprint flattened to its
 * `height`, blending back over `margin` metres round it), all over `origin`'s height. Cells split as Rapier splits a
 * heightfield's: along the diagonal from the north-east corner to the south-west one, so `terrainHeight` is the
 * collider's surface, the triangle under the point interpolated, and `terrainNormal` that triangle's normal.
 *
 * `surface` is the tag underfoot, `steepSurface` where the ground rises `steep` metres a metre or more (0.7: 35°);
 * `materials` (presentation only, as a level's) are the drawing's layers: the ground, the steep and, from `high`
 * metres over the origin up (0: none), the high one. `scatterTerrain` places trees and rocks by hashes of the cells
 * (shardfall's stateless placement).
 *
 * Invariants: pure: equal specs give equal terrains in Node and Chromium (int32 hashing, polynomial blends, no trig);
 * heights are float32, as the collider keeps them; outside the grid nothing stands (`terrainHeight` is null).
 *
 * Carried from shardfall@fa2dab6 `crates/pav_core/src/terrain.rs:93-153` (`raw_height`: fbm of 5 octaves at
 * lacunarity 2.03, the ridge term, the flattened footprints' smoothstep, `cell`'s terraces; `decor`'s hashed cells),
 * as a concept: on a heightfield's corners rather than in terraced tiles.
 *
 * @example
 * import { createRegistry } from '../core/registry';
 * const reg = createRegistry();
 * defineTerrain('terrain:knoll', { size: [16, 16], hills: [{ at: [8, 8], radius: 8, height: 2 }] }, reg);
 * const knoll = getTerrain('terrain:knoll', reg);
 * [knoll.cols, terrainHeight(knoll, 8, 8), terrainHeight(knoll, 0, 0), terrainHeight(knoll, -1, 0)]; // [16, 2, 0, null]
 * @see engine/world/terrain.test.ts
 */
import { mix32 } from '../core/hash';
import { codeError } from '../core/log';
import { registry as sharedRegistry, type Entry, type Registry } from '../core/registry';
import { createNoise2D } from '../core/noise';
import { Vector3 } from '../core/math';
import type { Schema, SpecOf } from '../core/schema';

/** A two-number field (m). */
const pair = (description: string, required = false) =>
  ({ type: 'array', items: { type: 'number' }, ...(required ? { required } : { default: [0, 0] }), unit: 'm', description }) as const; // prettier-ignore

/** The fields of a `terrain` entry (see the file comment). */
export const TERRAIN_FIELDS = {
  size: pair('Its extent along x and along z, each a whole number of cells: [24, 96].', true),
  cell: { type: 'number', default: 1, minimum: 0.25, maximum: 8, unit: 'm', description: 'The grid’s spacing: a height stands at every cell’s corners.' }, // prettier-ignore
  origin: { type: 'array', items: { type: 'number' }, default: [0, 0, 0], unit: 'm', description: 'Its north-west corner, at the height everything else is added to: [x, y, z].' }, // prettier-ignore
  seed: { type: 'integer', default: 0, description: 'The noise’s seed.' },
  height: { type: 'number', default: 0, minimum: 0, unit: 'm', description: 'The noise’s range: rolling ground about this high (0: none).' }, // prettier-ignore
  scale: { type: 'number', default: 40, minimum: 1, unit: 'm', description: 'The size of the noise’s features.' },
  octaves: { type: 'integer', default: 5, minimum: 1, maximum: 8, description: 'The noise’s octaves.' },
  ridges: { type: 'number', default: 0.5, minimum: 0, maximum: 1, description: 'How much ridged noise is added: shardfall’s half.' }, // prettier-ignore
  hills: { type: 'array', items: { type: 'object' }, default: [], description: 'Smooth domes added: { at: [x, z], radius, height } (m; a negative height digs a hollow).' }, // prettier-ignore
  terrace: { type: 'number', default: 0, minimum: 0, unit: 'm', description: 'Rounds heights to steps this high (0: smooth).' }, // prettier-ignore
  flats: { type: 'array', items: { type: 'object' }, default: [], description: 'Footprints flattened: { rect: [x0, z0, x1, z1], height, margin } (m), the ground blending back over margin round each.' }, // prettier-ignore
  surface: { type: 'string', default: 'grass', description: 'The surface tag underfoot (footsteps, particles).' },
  steep: { type: 'number', default: 0.7, minimum: 0, unit: 'm/m', description: 'Ground rising this much a metre or more is steep (0.7: 35°).' }, // prettier-ignore
  steepSurface: { type: 'string', default: 'rock', description: 'The surface tag on steep ground.' },
  high: { type: 'number', default: 0, minimum: 0, unit: 'm', description: 'The high layer shows from this height over the origin up (0: none).' }, // prettier-ignore
  materials: { type: 'array', items: { type: 'string' }, default: ['material:default'], description: 'Drawing only: the layers’ materials, the ground, then the steep and the high (a game names its own).' }, // prettier-ignore
} as const satisfies Schema;

/** A `terrain` entry: its spec. */
export type TerrainEntry = Entry<typeof TERRAIN_FIELDS>;
/** What `defineTerrain` and `makeTerrain` take: each field of `TERRAIN_FIELDS` (`size` required). */
export type TerrainSpec = SpecOf<typeof TERRAIN_FIELDS>;

/** A dome added to a terrain. */
export interface TerrainHill {
  readonly at: readonly [number, number];
  readonly radius: number;
  readonly height: number;
}

/** A footprint a terrain flattens. */
export interface TerrainFlat {
  readonly rect: readonly [x0: number, z0: number, x1: number, z1: number];
  readonly height: number;
  readonly margin: number;
}

/** A made terrain: its grid, its heights and what the queries and the drawing read (see the file comment). */
export interface Terrain {
  /** Its id without `terrain:`. */
  readonly name: string;
  /** Cells along x and along z, and a cell's side (m). */
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  /** Its north-west corner (m). */
  readonly origin: readonly [number, number, number];
  /** The height (m) at every corner, row by row from the north: corner (col, row) at `row * (cols + 1) + col`. */
  readonly heights: Float32Array;
  /** Its box (m). */
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }; // prettier-ignore
  readonly surface: string;
  readonly steep: number;
  readonly steepSurface: string;
  readonly high: number;
  readonly materials: readonly string[];
  /** Its seed and its flattened footprints, as the spec gave them. */
  readonly seed: number;
  readonly flats: readonly TerrainFlat[];
}

/** A place `scatterTerrain` picks: on the ground, a turn about +Y (rad) and a size factor. */
export interface TerrainPlace {
  readonly position: readonly [number, number, number];
  readonly yaw: number;
  readonly scale: number;
}

/** How `scatterTerrain` places (see its comment). */
export interface ScatterRule {
  /** The chance a cell holds one, 0 to 1. */
  density: number;
  /** Tells two scatters on one terrain apart (trees, rocks): 0 by default. */
  salt?: number;
  /** The steepest ground it places on (m a metre): the terrain's `steep` by default. */
  grade?: number;
  /** How far from every flat's footprint it keeps (m): 0 by default. */
  clear?: number;
  /** The size factor's range: [1, 1] by default. */
  scale?: readonly [number, number];
}

/** `t` eased in and out (smoothstep), for `t` in [0, 1]. */
const smooth = (t: number) => t * t * (3 - 2 * t);
/** `v` held to [lo, hi]. */
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The problems with a terrain spec's shape (beyond its fields' types); none when it makes a terrain. */
export function terrainProblems(spec: TerrainSpec): string[] {
  const problems: string[] = [];
  const pairOk = (value: unknown, n: number) => Array.isArray(value) && value.length === n && value.every(Number.isFinite); // prettier-ignore
  const { size = [0, 0], cell, origin, hills, flats, materials } = { ...defaults(), ...spec } as Required<TerrainSpec>;
  if (!pairOk(size, 2) || !(size[0] > 0 && size[1] > 0))
    problems.push('size must be [x, z], two positive numbers of metres'); // prettier-ignore
  else {
    for (const [axis, extent] of [
      ['x', size[0]],
      ['z', size[1]],
    ] as const) {
      const cells = extent / cell;
      if (Math.abs(cells - Math.round(cells)) > 1e-9) problems.push(`size along ${axis}, ${extent} m, is no whole number of ${cell} m cells`); // prettier-ignore
    }
  }
  if (!pairOk(origin, 3)) problems.push('origin must be [x, y, z] (m)');
  (hills as unknown[]).forEach((hill, i) => {
    const h = hill as Partial<TerrainHill>;
    if (!pairOk(h?.at, 2) || !(Number(h?.radius) > 0) || !Number.isFinite(h?.height)) problems.push(`hills[${i}] must be { at: [x, z], radius (above 0), height } (m)`); // prettier-ignore
  });
  (flats as unknown[]).forEach((flat, i) => {
    const f = flat as Partial<TerrainFlat>;
    const rect = f?.rect;
    if (!pairOk(rect, 4) || !(rect![2] > rect![0] && rect![3] > rect![1]) || !Number.isFinite(f?.height) || !(Number(f?.margin) >= 0)) problems.push(`flats[${i}] must be { rect: [x0, z0, x1, z1] (x1 > x0, z1 > z0), height, margin (0 or more) } (m)`); // prettier-ignore
  });
  if ((materials as unknown[]).length < 1 || (materials as unknown[]).length > 3) problems.push('materials must name 1 to 3 materials: the ground, the steep, the high'); // prettier-ignore
  return problems;
}

/** Makes `spec`'s terrain, named `name` (see the file comment); throws `CORE_BAD_SPEC` naming its problems. */
export function makeTerrain(spec: TerrainSpec, name = 'terrain'): Terrain {
  const problems = terrainProblems(spec);
  if (problems.length) throw codeError('CORE_BAD_SPEC', { where: `terrain ${name}`, problems: problems.join('; ') });
  const s = { ...defaults(), ...spec } as Required<TerrainSpec>;
  const cols = Math.round(s.size[0] / s.cell);
  const rows = Math.round(s.size[1] / s.cell);
  const [ox, oy, oz] = s.origin as [number, number, number];
  const options = { seed: s.seed, octaves: s.octaves, gain: 0.5, lacunarity: 2.03 };
  const base = createNoise2D('value', options);
  const ridge = createNoise2D('value', { ...options, seed: s.seed ^ 0xabc });
  const [scale, amplitude] = [s.scale, s.height];
  const hills = s.hills as unknown as readonly TerrainHill[];
  const flats = s.flats as unknown as readonly TerrainFlat[];
  const heights = new Float32Array((rows + 1) * (cols + 1));
  let [low, top] = [Infinity, -Infinity];
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= cols; col++) {
      const [x, z] = [ox + col * s.cell, oz + row * s.cell];
      let h = 0;
      if (amplitude > 0) {
        const rolling = (base(x / scale, z / scale) - 0.45) * 2 * amplitude;
        const ridged = (1 - Math.abs(ridge(x / (scale * 2.3), z / (scale * 2.3)) * 2 - 1)) * amplitude * 0.6;
        h = rolling + ridged * s.ridges;
      }
      for (const hill of hills) {
        const [dx, dz] = [x - hill.at[0], z - hill.at[1]];
        h += hill.height * smooth(clamp(1 - Math.sqrt(dx * dx + dz * dz) / hill.radius, 0, 1));
      }
      if (s.terrace > 0) h = Math.round(h / s.terrace) * s.terrace;
      for (const flat of flats) {
        const [x0, z0, x1, z1] = flat.rect;
        const [dx, dz] = [Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)];
        const d = Math.sqrt(dx * dx + dz * dz);
        const w = flat.margin > 0 ? smooth(clamp((d - flat.margin / 4) / ((flat.margin * 3) / 4), 0, 1)) : d > 0 ? 1 : 0; // prettier-ignore
        h = h * w + flat.height * (1 - w); // exactly h where w is 1, the flat's height where it is 0
      }
      const y = Math.fround(oy + h);
      heights[row * (cols + 1) + col] = y;
      [low, top] = [Math.min(low, y), Math.max(top, y)];
    }
  }
  return {
    name,
    cols,
    rows,
    cell: s.cell,
    origin: [ox, oy, oz],
    heights,
    bounds: { min: [ox, low, oz], max: [ox + cols * s.cell, top, oz + rows * s.cell] },
    surface: s.surface,
    steep: s.steep,
    steepSurface: s.steepSurface,
    high: s.high,
    materials: [...(s.materials as string[])],
    seed: s.seed,
    flats: flats.map((flat) => ({ rect: [...flat.rect] as const, height: flat.height, margin: flat.margin })),
  };
}

/** Every field's default. */
function defaults(): Partial<TerrainSpec> {
  return Object.fromEntries(
    Object.entries(TERRAIN_FIELDS).flatMap(([key, field]) => ('default' in field ? [[key, field.default]] : [])),
  );
}

/**
 * Where (x, z) falls on `terrain`: its cell and how far across it (0 to 1, east and south) and the heights at the
 * cell's corners; null outside the grid. The east and south edges belong to the last cells.
 */
function cellAt(terrain: Terrain, x: number, z: number) {
  const { cols, rows, cell, origin, heights } = terrain;
  const [u, v] = [(x - origin[0]) / cell, (z - origin[2]) / cell];
  if (!(u >= 0 && v >= 0 && u <= cols && v <= rows)) return null;
  const [col, row] = [Math.min(Math.floor(u), cols - 1), Math.min(Math.floor(v), rows - 1)];
  const at = (c: number, r: number) => heights[r * (cols + 1) + c];
  return { col, row, fu: u - col, fv: v - row, h00: at(col, row), h10: at(col + 1, row), h01: at(col, row + 1), h11: at(col + 1, row + 1) }; // prettier-ignore
}

/** The ground's height (m) at (x, z): the collider's surface (see the file comment); null outside the grid. */
export function terrainHeight(terrain: Terrain, x: number, z: number): number | null {
  const at = cellAt(terrain, x, z);
  if (!at) return null;
  const { fu, fv, h00, h10, h01, h11 } = at;
  // Rapier's split: [north-west, north-east, south-west] where fu + fv ≤ 1, [north-east, south-east, south-west] past it.
  return fu + fv <= 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv); // prettier-ignore
}

/** How the ground rises at (x, z), as metres a metre east and south: its triangle's; null outside the grid. */
export function terrainGradient(terrain: Terrain, x: number, z: number): readonly [number, number] | null {
  const at = cellAt(terrain, x, z);
  if (!at) return null;
  const { fu, fv, h00, h10, h01, h11 } = at;
  const c = terrain.cell;
  return fu + fv <= 1 ? [(h10 - h00) / c, (h01 - h00) / c] : [(h11 - h01) / c, (h11 - h10) / c];
}

/** The ground's upward unit normal at (x, z): its triangle's; null outside the grid. */
export function terrainNormal(terrain: Terrain, x: number, z: number, out = new Vector3()): Vector3 | null {
  const gradient = terrainGradient(terrain, x, z);
  return gradient ? out.set(-gradient[0], 1, -gradient[1]).normalize() : null;
}

/** How steep the ground is at (x, z): metres risen a metre along its slope (1 is 45°); null outside the grid. */
export function terrainGrade(terrain: Terrain, x: number, z: number): number | null {
  const gradient = terrainGradient(terrain, x, z);
  return gradient ? Math.sqrt(gradient[0] * gradient[0] + gradient[1] * gradient[1]) : null;
}

/** The surface tag underfoot at (x, z): `steepSurface` where it is steep, else `surface`; '' outside the grid. */
export function terrainSurface(terrain: Terrain, x: number, z: number): string {
  const grade = terrainGrade(terrain, x, z);
  return grade === null ? '' : grade >= terrain.steep ? terrain.steepSurface : terrain.surface;
}

/** A number in [0, 1) hashed from a cell's place and `k`: the same on every run, no state kept. */
function cellHash(seed: number, salt: number, col: number, row: number, k: number): number {
  let h = mix32(seed ^ Math.imul(salt + 1, 0x9e3779b9));
  h = mix32(h ^ Math.imul(col, 0x85ebca6b));
  h = mix32(h ^ Math.imul(row, 0xc2b2ae35));
  return mix32(h ^ Math.imul(k + 1, 0x27d4eb2f)) / 4294967296;
}

/**
 * Stateless placement (shardfall's decor): each cell holds one place with the chance `density`, jittered inside it,
 * turned and sized, by hashes of the terrain's seed, the rule's `salt` and the cell, never a stream; so a cell's
 * place never depends on another's, and the same rule gives the same places. Steeper ground than `grade` and ground
 * within `clear` of a flat's footprint hold none. Places come row by row from the north-west.
 */
export function scatterTerrain(terrain: Terrain, rule: ScatterRule): TerrainPlace[] {
  const { density, salt = 0, grade = terrain.steep, clear = 0, scale = [1, 1] } = rule;
  const { cols, rows, cell, origin, seed } = terrain;
  const places: TerrainPlace[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const hash = (k: number) => cellHash(seed, salt, col, row, k);
      if (!(hash(0) < density)) continue;
      const [x, z] = [origin[0] + (col + hash(1)) * cell, origin[2] + (row + hash(2)) * cell];
      if ((terrainGrade(terrain, x, z) ?? Infinity) > grade) continue;
      const near = terrain.flats.some(({ rect: [x0, z0, x1, z1] }) => x > x0 - clear && x < x1 + clear && z > z0 - clear && z < z1 + clear); // prettier-ignore
      if (near) continue;
      const yaw = hash(3) * 2 * Math.PI;
      places.push({ position: [x, terrainHeight(terrain, x, z)!, z], yaw, scale: scale[0] + (scale[1] - scale[0]) * hash(4) }); // prettier-ignore
    }
  }
  return places;
}

/** Declares the kind `terrain` on `registry` unless it has it. */
function terrainKind(registry: Registry): void {
  if (registry.kinds().includes('terrain')) return;
  registry.defineKind('terrain', {
    description: 'Terrain: outdoor ground as a seeded heightfield (noise, hills, terraces, flattened footprints).',
    fields: TERRAIN_FIELDS,
    defineWith: "defineTerrain('<id>', { size, cell, origin, seed, height, hills, flats, … })",
    check: (entry) => terrainProblems(entry as unknown as TerrainSpec),
  });
}
terrainKind(sharedRegistry);

/** Registers a terrain on `registry` (the shared one by default); throws `CORE_BAD_SPEC` naming its problems. */
export function defineTerrain(id: string, spec: TerrainSpec, registry: Registry = sharedRegistry): TerrainEntry {
  terrainKind(registry);
  return registry.def('terrain', id, spec as unknown as Record<string, unknown>) as unknown as TerrainEntry;
}

/** The terrain `id` of `registry` (the shared one by default), made afresh: its name is the id without `terrain:`. */
export function getTerrain(id: string, registry: Registry = sharedRegistry): Terrain {
  terrainKind(registry);
  const entry = registry.get('terrain', id) as unknown as TerrainSpec & { id: string };
  return makeTerrain(entry, entry.id.replace(/^terrain:/, ''));
}
