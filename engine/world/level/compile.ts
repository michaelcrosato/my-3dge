/**
 * @file The level compiler (PLAN.md WP 2.2, WP 4.2, WP 13.13, §9.0, I-22; doctrines: Agent-accessible assets,
 * Reproducible): a level's text and the legend (engine/world/level/glyph.ts) in, a `CompiledLevel` out
 * (engine/world/level/types.ts): the map, the glyphs it uses, per-tile characters and solid, walkable, floor and top
 * grids, the ground slab, the colliders (merged boxes, hulls under ramps and daises, cylinders), the ramps and daises,
 * mesh descriptors, spawn points and light spots. A level written as storeys (format 2) compiles through storeys.ts to
 * `my3dge-level/2`, its storeys, rooms, openings and roofs beside those fields. Sim-side: no meshes, no Rapier, no
 * randomness; heights.ts answers `floorHeight`, `topHeight`, `surfaceAt` and `floorBelow` on the result, WP 2.4 draws
 * it and WP 3.1 makes its bodies.
 *
 * `compileLevel(text, { file, name })` throws `LEVEL_INVALID` listing every structural problem (validate.ts), each at
 * its line and column. Content problems (an unreachable spawn) do not stop it; `validateLevel` and `node x qa level`
 * report those.
 *
 * Invariants: the result depends only on the text and on the glyphs the map uses, so compiling the same text again,
 * in Node or in a page, gives equal data and an equal `hashValue` (no Math.random, no clock; every list in a fixed
 * order). It is frozen all the way down, shares nothing a caller can change, and holds only canonical data. A format-1
 * level's legend leaves out the fields only storeys read (`STOREY_FIELDS`), so it compiles to the data and hash it
 * did before format 2 existed.
 *
 * Spawns stand on the floor at their tile's centre, and light spots `lightHeight` above the top there, so a spawn on a
 * dais stands on the dais and a torch spot on a brazier sits above its bowl.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:22-124` (the hall as text: heights, colliders, the walkable grid,
 * the torch spots and meshes all derived from one map) and `my-3d2dge:src/lab3d/20-world.js:12-35`, with the glyph
 * meanings moved out of the code into the legend.
 *
 * @example
 * const level = compileLevel('---\ndescription: A cell.\n---\n#####\n#@.w#\n#####\n', { file: 'cell.txt' });
 * [level.name, level.cols, level.rows, level.spawns[0].id, level.spawns[0].position]; // ['cell', 5, 3, 'spawn:hero', [1.5, 0, 1.5]]
 * level.colliders.map((box) => [box.glyph, box.tiles]); // [['glyph:lowWall', [3, 1, 3, 1]], ['glyph:wall', [0, 0, 4, 0]], …]
 * @see engine/world/level/compile.test.ts
 */
import { codeError } from '../../core/log';
import { freezeValue } from '../../core/schema';
import { groundSlab, levelColliders } from './colliders';
import { STOREY_FIELDS, type Glyph } from './glyph';
import { byText, glyphsOf, holds } from './grid';
import { floorHeight, topHeight, type HeightSource } from './heights';
import { levelMeshes } from './meshes';
import type { ParsedLevel } from './parse';
import { mergeRects } from './rects';
import { roofColliders, roofUnder, wallUnder } from './roofs';
import { roomSides } from './rooms';
import type { CheckedStorey, CheckedStoreys } from './storeys';
import {
  LEVEL_FORMAT,
  LEVEL_FORMAT_2,
  type BoxCollider,
  type ColliderDescriptor,
  type HullCollider,
  type CompiledLevel,
  type LevelGlyph,
  type LightSpot,
  type Point3,
  type RoofDescriptor,
  type SpawnPoint,
  type StoreyDescriptor,
} from './types';
import { checkLevel, type LevelSource } from './validate';

/** How many problems `LEVEL_INVALID`'s message lists before "and N more". */
const LISTED = 5;

/** What `compileLevel` takes beside the text. */
export interface CompileOptions extends LevelSource {
  /** The level's name; the file's name without its folder and `.txt` by default, else `level`. */
  name?: string;
}

/** The name of a level file: `fixtures/levels/room.txt` → `room`. */
export function levelName(file: string): string {
  return (file.split(/[\\/]/).pop() ?? file).replace(/\.txt$/, '');
}

/** One glyph as a format-1 level holds it: every field of its entry but `kind` and those only storeys read. */
function levelGlyph(glyph: Glyph): LevelGlyph {
  const fields: Record<string, unknown> = { ...glyph };
  for (const key of ['kind', ...STOREY_FIELDS]) delete fields[key];
  return fields as unknown as LevelGlyph;
}

/**
 * Compiles a level's text against the legend of `options.registry` (the shared one by default) into plain data;
 * see the file comment. Throws `LEVEL_INVALID`, carrying the problems as `values.problems`, for a structural problem.
 */
export function compileLevel(text: string, options: CompileOptions = {}): CompiledLevel {
  const file = options.file ?? options.name ?? 'level';
  const { parsed, glyphs: tiles, ramps, daises, storeys, problems } = checkLevel(text, { ...options, file });
  if (problems.length) {
    const more = problems.length > LISTED ? `; and ${problems.length - LISTED} more` : '';
    const list = problems.slice(0, LISTED).map((problem) => problem.message);
    throw codeError('LEVEL_INVALID', {
      where: file,
      count: `${problems.length} problem${problems.length === 1 ? '' : 's'}`,
      list: list.join('; ') + more,
      problems,
    });
  }
  const name = options.name ?? (options.file ? levelName(options.file) : 'level');
  if (storeys) return compileStoreys(storeys, parsed, name);
  const { rows: map, width: cols, header } = parsed;
  const rows = map.length;
  const t = header.tile;
  const grid = { cols, rows, tile: t, tiles };
  const legend: Record<string, LevelGlyph> = {};
  for (const glyph of tiles) legend[glyph.char] ??= levelGlyph(glyph);
  const chars = tiles.map((glyph) => glyph.char);
  const heights: HeightSource = { tile: t, cols, rows, tiles: chars, legend, ramps, daises };
  const centres = tiles.map((_, i) => [((i % cols) + 0.5) * t, (Math.floor(i / cols) + 0.5) * t] as const);
  const floor = centres.map(([x, z]) => floorHeight(heights, x, z));
  const top = centres.map(([x, z]) => topHeight(heights, x, z));
  const spawns: SpawnPoint[] = [];
  const lights: LightSpot[] = [];
  tiles.forEach((glyph, i) => {
    const [col, row] = [i % cols, Math.floor(i / cols)];
    const [x, z] = centres[i];
    if (glyph.spawn) {
      spawns.push({
        id: `spawn:${glyph.spawn}`,
        name: glyph.spawn,
        glyph: glyph.id,
        col,
        row,
        position: [x, floor[i], z],
      });
    }
    if (glyph.light) {
      lights.push({ tag: glyph.light, glyph: glyph.id, col, row, position: [x, top[i] + glyph.lightHeight, z] });
    }
  });
  const level: CompiledLevel = {
    format: LEVEL_FORMAT,
    name,
    description: header.description,
    tile: t,
    cols,
    rows,
    map: map.map((row) => row.join('')),
    legend,
    tiles: chars,
    solid: tiles.map((glyph) => glyph.solid),
    walkable: tiles.map((glyph) => glyph.nav.walkable),
    floor,
    top,
    bounds: { min: [0, 0, 0], max: [cols * t, top.reduce((a, b) => Math.max(a, b), 0), rows * t] },
    ground: groundSlab(grid),
    colliders: levelColliders(grid, { ramps, daises }),
    ramps,
    daises,
    meshes: levelMeshes(grid),
    spawns,
    lights,
  };
  return freezeValue(level);
}

/** A ramp or a dais moved up by `base` metres. */
const raised = <T extends { bottom: number; top: number }>(shape: T, base: number): T => ({
  ...shape,
  bottom: shape.bottom + base,
  top: shape.top + base,
});

/** A point moved up by `base` metres. */
const up = ([x, y, z]: Point3, base: number): Point3 => [x, y + base, z];

/** A tile rectangle in metres: `[x0, z0, x1, z1]`. */
const metres = ([c0, r0, c1, r1]: readonly number[], t: number) =>
  [c0 * t, r0 * t, (c1 + 1) * t, (r1 + 1) * t] as const;

/** A solid rising from `bottom` to the storey's full top over `tiles`: a box, or under a pitched roof a clipped hull. */
function riser(
  s: CheckedStorey,
  tiles: readonly [number, number, number, number],
  bottom: number,
  glyph: string,
  surface: string,
): BoxCollider | HullCollider | null {
  const t = s.grid.tile;
  const [x0, z0, x1, z1] = metres(tiles, t);
  if (s.roof && s.roof.kind !== 'flat') {
    const points = wallUnder(s.roof, [x0, z0, x1, z1], bottom);
    return points && { shape: 'hull', glyph, surface, points, tiles, storey: s.index };
  }
  if (!(s.fullTop > bottom)) return null;
  return { shape: 'box', glyph, surface, min: [x0, bottom, z0], max: [x1, s.fullTop, z1], tiles, storey: s.index };
}

/** A storey's colliders: its slabs, its glyphs' colliders from its floor, and its heads; see the file comment. */
function storeyColliders(s: CheckedStorey): ColliderDescriptor[] {
  const { grid, base, index: storey } = s;
  const t = grid.tile;
  const out: ColliderDescriptor[] = [];
  const surfaces = [...new Set(grid.tiles.filter((_, i) => s.floored[i]).map((glyph) => glyph.surface))].sort(byText);
  for (const surface of surfaces) {
    const inside = (c: number, r: number) => s.floored[r * grid.cols + c] && grid.tiles[r * grid.cols + c].surface === surface; // prettier-ignore
    for (const tiles of mergeRects(grid.cols, grid.rows, inside)) {
      const [x0, z0, x1, z1] = metres(tiles, t);
      out.push({ shape: 'box', glyph: '', surface, min: [x0, base - s.slab, z0], max: [x1, base, z1], tiles, storey, part: 'slab' }); // prettier-ignore
    }
  }
  const byId = new Map(glyphsOf(grid).map((glyph) => [glyph.id, glyph]));
  for (const part of levelColliders(grid, { ramps: s.ramps, daises: s.daises })) {
    if (part.shape === 'box' && byId.get(part.glyph)?.full) {
      const full = riser(s, part.tiles, base, part.glyph, part.surface);
      if (full) out.push(full);
    } else if (part.shape === 'box') {
      out.push({ ...part, min: up(part.min, base), max: up(part.max, base), storey });
    } else if (part.shape === 'hull') {
      out.push({ ...part, points: part.points.map((point) => up(point, base)), storey });
    } else {
      out.push({ ...part, center: up(part.center, base), storey });
    }
  }
  for (const glyph of glyphsOf(grid).filter((entry) => entry.head > 0)) {
    for (const tiles of mergeRects(grid.cols, grid.rows, holds(grid, [glyph]))) {
      const head = riser(s, tiles, base + glyph.head, glyph.id, glyph.surface);
      if (head) out.push({ ...head, part: 'head' });
    }
  }
  return out;
}

/** One storey compiled: its grids, ramps, daises and meshes, heights absolute; its spawns and lights beside them. */
function compileStorey(s: CheckedStorey, legend: Record<string, LevelGlyph>, roomOf: Int32Array) {
  const { grid, base } = s;
  const { cols, rows, tile: t } = grid;
  const chars = grid.tiles.map((glyph) => glyph.char);
  const source: HeightSource = { tile: t, cols, rows, tiles: chars, legend, ramps: s.ramps, daises: s.daises };
  const centre = (i: number) => [((i % cols) + 0.5) * t, (Math.floor(i / cols) + 0.5) * t] as const;
  const fullAt = (x: number, z: number) => (s.roof && s.roof.kind !== 'flat' ? roofUnder(s.roof, x, z) : s.fullTop);
  const floor = grid.tiles.map((glyph, i) => (glyph.void ? base : base + floorHeight(source, ...centre(i))));
  const top = grid.tiles.map((glyph, i) =>
    glyph.void ? base : glyph.full ? fullAt(...centre(i)) : base + topHeight(source, ...centre(i)),
  );
  const spawns: SpawnPoint[] = [];
  const lights: LightSpot[] = [];
  grid.tiles.forEach((glyph, i) => {
    const [col, row] = [i % cols, Math.floor(i / cols)];
    const [x, z] = centre(i);
    const storey = s.index;
    if (glyph.spawn) {
      const id = `spawn:${glyph.spawn}`;
      spawns.push({ id, name: glyph.spawn, glyph: glyph.id, col, row, position: [x, floor[i], z], storey });
    }
    if (glyph.light) {
      lights.push({ tag: glyph.light, glyph: glyph.id, col, row, position: [x, top[i] + glyph.lightHeight, z], storey }); // prettier-ignore
    }
  });
  const meshes = levelMeshes(grid, true).map((mesh) => {
    const full = mesh.glyphs.some((id) => grid.tiles.find((glyph) => glyph.id === id)?.full);
    return { ...mesh, bottom: mesh.bottom + base, top: full ? s.fullTop : mesh.top + base };
  });
  const storey: StoreyDescriptor = {
    name: s.parsed.name,
    index: s.index,
    base,
    height: s.height,
    slab: s.slab,
    fullTop: s.fullTop,
    map: s.parsed.rows.map((row) => row.join('')),
    tiles: chars,
    solid: grid.tiles.map((glyph) => glyph.solid),
    walkable: grid.tiles.map((glyph) => glyph.nav.walkable),
    floored: [...s.floored],
    floor,
    top,
    room: [...roomOf],
    ramps: s.ramps.map((ramp) => raised(ramp, base)),
    daises: s.daises.map((dais) => raised(dais, base)),
    meshes,
  };
  return { storey, spawns, lights };
}

/** The level's whole legend: every glyph its storeys use, keyed by character, with every field. */
function legendOf(storeys: readonly CheckedStorey[]): Record<string, LevelGlyph> {
  const legend: Record<string, LevelGlyph> = {};
  for (const s of storeys) {
    for (const glyph of s.grid.tiles) {
      if (legend[glyph.char]) continue;
      const { kind: _kind, ...fields } = glyph;
      legend[glyph.char] = fields as LevelGlyph;
    }
  }
  return legend;
}

/**
 * A checked format-2 level compiled into plain data, as storeys.ts's file comment describes: its storeys' grids, ramps,
 * daises and meshes, heights absolute; every storey's colliders and the roof's; rooms, openings and roofs; the ground
 * storey's grids as the level's own. `name` is the level's.
 */
function compileStoreys(checked: CheckedStoreys, parsed: ParsedLevel, name: string): CompiledLevel {
  const { storeys, roomOf } = checked;
  const [first] = storeys;
  const { cols, rows, tile: t } = first.grid;
  const legend = legendOf(storeys);
  const compiled = storeys.map((s, k) => compileStorey(s, legend, roomOf[k]));
  const roof = storeys[storeys.length - 1].roof;
  const colliders = storeys.flatMap(storeyColliders);
  if (roof) {
    const tiles = [0, 0, cols - 1, rows - 1] as const;
    for (const points of roofColliders(roof)) {
      colliders.push({ shape: 'hull', glyph: '', surface: roof.surface, points, tiles, storey: roof.storey, part: 'roof' }); // prettier-ignore
    }
  }
  const ground =
    compiled[
      Math.max(
        0,
        storeys.findIndex((s) => s.base === 0),
      )
    ].storey;
  const bottom = first.base - first.slab;
  const highest = Math.max(...compiled.map(({ storey }) => Math.max(storey.fullTop, ...storey.top)), roof?.peak ?? -Infinity); // prettier-ignore
  const slab = groundSlab(first.grid);
  const openings = roomSides(
    storeys.flatMap((s) => s.openings),
    roomOf,
    cols,
    rows,
  );
  const level: CompiledLevel = {
    format: LEVEL_FORMAT_2,
    name,
    description: parsed.header.description,
    tile: t,
    cols,
    rows,
    map: ground.map,
    legend,
    tiles: ground.tiles,
    solid: ground.solid,
    walkable: ground.walkable,
    floor: ground.floor,
    top: ground.top,
    bounds: eavesBounds(roof, [0, bottom, 0], [cols * t, highest, rows * t]),
    ground: { min: [slab.min[0], bottom - 1, slab.min[2]], max: [slab.max[0], bottom, slab.max[2]] },
    colliders,
    ramps: ground.ramps,
    daises: ground.daises,
    meshes: ground.meshes,
    spawns: compiled.flatMap((c) => c.spawns),
    lights: compiled.flatMap((c) => c.lights),
    storeys: compiled.map((c) => c.storey),
    rooms: checked.rooms,
    openings,
    roofs: roof ? [roof] : [],
  };
  return freezeValue(level);
}

/** The level's bounds `[min, max]` (m), widened over a roof's eaves where they reach past the map. */
function eavesBounds(roof: RoofDescriptor | null, min: Point3, max: Point3): { min: Point3; max: Point3 } {
  if (!roof) return { min, max };
  const [x0, z0, x1, z1] = roof.footprint;
  const e = roof.eaves;
  return {
    min: [Math.min(min[0], x0 - e), min[1], Math.min(min[2], z0 - e)],
    max: [Math.max(max[0], x1 + e), max[1], Math.max(max[2], z1 + e)],
  };
}
