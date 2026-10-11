/**
 * @file The level compiler (PLAN.md WP 2.2, WP 4.2, §9.0, I-22; doctrines: Agent-accessible assets, Reproducible): a
 * level's text and the legend (engine/world/level/glyph.ts) in, a `CompiledLevel` out (engine/world/level/types.ts):
 * the map, the glyphs it uses, per-tile characters and solid, walkable, floor and top grids, the ground slab, the
 * colliders (merged boxes, hulls under ramps and daises, cylinders), the ramps and daises, mesh descriptors, spawn
 * points and light spots. Sim-side: no meshes, no Rapier, no randomness; heights.ts answers `floorHeight`, `topHeight`
 * and `surfaceAt` on the result, WP 2.4 draws it and WP 3.1 makes its bodies.
 *
 * `compileLevel(text, { file, name })` throws `LEVEL_INVALID` listing every structural problem (validate.ts), each at
 * its line and column. Content problems (an unreachable spawn) do not stop it; `validateLevel` and `node x qa level`
 * report those.
 *
 * Invariants: the result depends only on the text and on the glyphs the map uses, so compiling the same text again,
 * in Node or in a page, gives equal data and an equal `hashValue` (no Math.random, no clock; every list in a fixed
 * order). It is frozen all the way down, shares nothing a caller can change, and holds only canonical data.
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
import type { Glyph } from './glyph';
import { floorHeight, topHeight, type HeightSource } from './heights';
import { levelMeshes } from './meshes';
import { LEVEL_FORMAT, type CompiledLevel, type LevelGlyph, type LightSpot, type SpawnPoint } from './types';
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

/** One glyph as the compiled level holds it: every field of its entry but `kind`. */
function levelGlyph(glyph: Glyph): LevelGlyph {
  const { kind: _kind, ...fields } = glyph;
  return fields as LevelGlyph;
}

/**
 * Compiles a level's text against the legend of `options.registry` (the shared one by default) into plain data;
 * see the file comment. Throws `LEVEL_INVALID`, carrying the problems as `values.problems`, for a structural problem.
 */
export function compileLevel(text: string, options: CompileOptions = {}): CompiledLevel {
  const file = options.file ?? options.name ?? 'level';
  const { parsed, glyphs: tiles, ramps, daises, problems } = checkLevel(text, { ...options, file });
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
    name: options.name ?? (options.file ? levelName(options.file) : 'level'),
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
