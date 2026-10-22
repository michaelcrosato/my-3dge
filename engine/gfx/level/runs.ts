/**
 * @file A level's meshes by runs (PLAN.md WP 2.7, WP 7.8): what the stage draws a level with (engine/gfx/stage.ts).
 * `splitRuns(level)` splits each block descriptor into its runs (its merged rectangles), so `runMeshes` names every
 * wall run on its own, `level:room/wall@0,0-15,0` (tiles from column 0, row 0 to column 15, row 0; a level written as
 * storeys puts the storey before the recipe), and the ID pass tells them apart; a run costs two draw groups, in colour
 * and in each shadow map. Surfaces stay whole. `runMeshes` also takes the level's looks: its material swaps (WP 7.8),
 * its rooms' floors (WP 13.14) and its own recipes (WP 13.18), which `levelLooks` reads off its entry. Split from the
 * stage at its line cap (WP 10.5).
 *
 * Invariants: pure in the level; a split descriptor's pieces are the original's inside its run, so the runs together
 * draw what the descriptor did; `parts[i]` is the i-th split descriptor's (engine/gfx/level/meshes.ts).
 *
 * @example
 * import { compileLevel } from '../../world/level/compile';
 * const { runs } = splitRuns(compileLevel('#####\n#...#\n#.#.#\n#####\n'));
 * runs.filter(Boolean).length; // 6: the wall's runs, each drawn on its own
 * @see engine/gfx/stage.test.ts
 */
import type { Material } from 'three/webgpu';
import type { Log } from '../../core/log';
import type { Registry } from '../../core/registry';
import type { LevelEntry } from '../../world/level/level';
import type { CompiledLevel, MeshDescriptor, TileRect } from '../../world/level/types';
import { createLevelMeshes, type LevelMeshes } from './meshes';
import type { LevelRecipe } from './recipes';

/** How `runMeshes` draws: the materials, the level's looks (`LevelLooks`) and where advice goes. */
export interface RunMeshesOptions extends LevelLooks {
  materials: { get(id: string): Material };
  log?: Log;
}

/** A level's looks, its entry's presentation fields (engine/world/level/level.ts): swaps, rooms' floors, recipes. */
export interface LevelLooks {
  /** Material swaps for the level's meshes alone: an id its recipes name → the material drawn instead (WP 7.8). */
  levelMaterials?: Readonly<Record<string, string>>;
  /** A level written as storeys: each room's floor material, by room name (WP 13.14; the level entry's `rooms`). */
  levelRooms?: Readonly<Record<string, string>>;
  /** The level's own recipes, by the name its glyphs give, the engine's replaced (WP 13.18; the entry's `recipes`). */
  levelRecipes?: Readonly<Record<string, LevelRecipe>>;
}

/** The looks the level `id` of `registry` gives its meshes; none for an id it lacks. */
export function levelLooks(registry: Registry, id: string): LevelLooks {
  if (!registry.kinds().includes('level') || !registry.has('level', id)) return {};
  const entry = registry.get('level', id) as LevelEntry;
  // The kind's check holds their shapes: strings, and recipes as recipes.ts writes them.
  return {
    levelMaterials: entry.materials as Readonly<Record<string, string>>,
    levelRooms: entry.rooms as Readonly<Record<string, string>>,
    levelRecipes: entry.recipes as unknown as Readonly<Record<string, LevelRecipe>>,
  };
}

/** `rect` holds `piece` whole. */
const holds = (rect: TileRect, piece: TileRect) =>
  piece[0] >= rect[0] && piece[2] <= rect[2] && piece[1] >= rect[1] && piece[3] <= rect[3];

/**
 * The level with each block descriptor split into one descriptor per run (merged rectangle), surfaces whole, and for
 * each descriptor the run it draws (null for one that was not split).
 */
export function splitRuns(level: CompiledLevel): { level: CompiledLevel; runs: (TileRect | null)[] } {
  const runs: (TileRect | null)[] = [];
  const split = (meshes: readonly MeshDescriptor[]) =>
    meshes.flatMap((descriptor): MeshDescriptor[] => {
      if (descriptor.top - descriptor.bottom <= 0 || descriptor.rects.length < 2) {
        runs.push(null);
        return [descriptor];
      }
      return descriptor.rects.map((rect) => {
        runs.push(rect);
        return { ...descriptor, pieces: descriptor.pieces.filter((piece) => holds(rect, piece)), rects: [rect] };
      });
    });
  // A level written as storeys draws each storey's descriptors, bottom first (engine/gfx/level/meshes.ts).
  if (level.storeys) return { level: { ...level, storeys: level.storeys.map((s) => ({ ...s, meshes: split(s.meshes) })) }, runs }; // prettier-ignore
  return { level: { ...level, meshes: split(level.meshes) }, runs };
}

/** The level's meshes, each run named by its tiles (see the file comment). */
export function runMeshes(level: CompiledLevel, options: RunMeshesOptions): LevelMeshes {
  const split = splitRuns(level);
  const swaps = options.levelMaterials ?? {};
  const materials = { get: (id: string) => options.materials.get(Object.hasOwn(swaps, id) ? swaps[id] : id) };
  const meshes = createLevelMeshes(split.level, { materials, rooms: options.levelRooms, recipes: options.levelRecipes, log: options.log }); // prettier-ignore
  split.runs.forEach((run, i) => {
    if (!run) return;
    const [c0, r0, c1, r1] = run;
    const part = meshes.parts[i];
    const storey = part.storey === undefined ? '' : `${level.storeys![part.storey].name}/`;
    part.name = part.mesh.name = `level:${level.name}/${storey}${part.recipe}@${c0},${r0}-${c1},${r1}`;
  });
  return meshes;
}
