/**
 * @file The level's shapes (PLAN.md WP 2.4, WP 4.4): `buildShape(level, descriptor, recipe, materials)` builds the
 * mesh of one mesh descriptor (engine/world/level/types.ts) in its recipe's shape (engine/gfx/level/recipes.ts):
 * a welded surface (the floor), instanced blocks (walls, low walls) or pillars (plinth, shaft and capital,
 * engine/gfx/geometry/pillar.ts), or one mesh for a slab (a gallery, slab.ts), the stairs (stairs.ts), smooth ramps
 * (ramp.ts), a dais (dais.ts) or brazier stands (brazier.ts). An instanced shape has one instance per piece, standing
 * at its cell's centre (engine/gfx/level/cells.ts), and for a recipe with `cut` the geometry of its cut twin, which the
 * cutaway (engine/gfx/cutaway.ts) shows in a piece's place: a block `cut.height` tall, or a pillar's parts up to it.
 *
 * An instanced shape, and a cut twin, has at least `PAGE_SLOTS` (1,024) slots, its count its pieces (`instanceSlots`):
 * r182 reads the matrices of a mesh of 1,000 slots or fewer from a uniform buffer named after it, compiling a shader
 * per mesh, and above that from an instanced attribute, one shader for every mesh (engine/gfx/instancing.ts). Measured
 * at gate G6's review: sized by their pieces, the hall's 37 pillars, low walls and walls and their 26 cut twins were
 * a pipeline each per material, pass and camera, and the Stress Box hall's warm-up built 357 pipelines in about 14 s
 * on SwiftShader; at 1,024 slots they share theirs, and it builds 35 in about 4 s. Each costs 64 KiB of matrices.
 *
 * Stairs and daises are found in `level.ramps` and `level.daises`: a descriptor draws those whose first tile it
 * holds (a ramp's north-west tile; a dais's first tile in reading order), so a descriptor split into runs (the stage,
 * engine/gfx/stage.ts) draws each flight or dais once.
 *
 * Materials: one per slot of the shape, a slot past the last material taking the last; one material draws the
 * whole shape at once (one draw call), and each slot is otherwise one draw group.
 *
 * Invariants: pure in the level, the descriptor and the recipe (equal inputs give equal buffers); materials come
 * from the caller and are never disposed here.
 *
 * @example
 * // const { mesh, cells, cut } = buildShape(level, level.meshes[3], LEVEL_RECIPES.wall, [brick, stone]);
 * // cut.geometry(); // a 1 × 0.4375 × 1 m box: the wall's cut twin
 * @see engine/gfx/level/shapes.test.ts
 * @see engine/gfx/level/meshes.test.ts
 */
import { InstancedMesh, Matrix4, Mesh, type BufferGeometry, type Material } from 'three/webgpu';
import type { CompiledLevel, MeshDescriptor, TileRect } from '../../world/level/types';
import { boxGeometry } from '../geometry/box';
import { mergeGeometries, sidesThenTops } from '../geometry/groups';
import { pillarGeometry, pillarParts } from '../geometry/pillar';
import { PAGE_SLOTS } from '../instancing';
import { brazierGeometry } from './brazier';
import { levelCells, type LevelCell } from './cells';
import { daisGeometry } from './dais';
import type { CutWhen, LevelRecipe } from './recipes';
import { slabGeometry } from './slab';
import { rampGeometry } from './ramp';
import { stairsGeometry } from './stairs';
import { surfaceGeometry } from './surface';

/** How the cutaway cuts a part: its recipe's cut, and the geometry of its twin (a new one each call). */
export interface PartCut {
  height: number;
  when: CutWhen;
  geometry(): BufferGeometry;
}

/** One descriptor's mesh, its cells (one per instance; none for a single mesh) and its cut. */
export interface BuiltShape {
  mesh: Mesh | InstancedMesh;
  cells: readonly LevelCell[];
  cut: PartCut | null;
}

/** The slots of an instanced level mesh of `count` pieces: at least `PAGE_SLOTS`, so it shares its shader. */
export function instanceSlots(count: number): number {
  return Math.max(count, PAGE_SLOTS);
}

/** One instance per cell, standing at the cell's centre. */
export function instanced(
  geometry: BufferGeometry,
  materials: Material | Material[],
  cells: readonly LevelCell[],
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, materials, instanceSlots(cells.length));
  placeInstances(mesh, cells);
  return mesh;
}

/** Stands `mesh`'s instances on `cells`, as many as there are, and refits its bounds. */
export function placeInstances(mesh: InstancedMesh, cells: readonly LevelCell[]): void {
  const matrix = new Matrix4();
  cells.forEach((cell, i) => mesh.setMatrixAt(i, matrix.makeTranslation(...cell.centre)));
  mesh.count = cells.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

/** Whether one of `pieces` holds tile (col, row). */
const holdsTile = (pieces: readonly TileRect[], col: number, row: number) =>
  pieces.some(([c0, r0, c1, r1]) => col >= c0 && col <= c1 && row >= r0 && row <= r1);

/** The first tile in reading order of `rect` whose glyph is `glyph`. */
function firstTile(level: CompiledLevel, rect: TileRect, glyph: string): [number, number] {
  for (let row = rect[1]; row <= rect[3]; row++) {
    for (let col = rect[0]; col <= rect[2]; col++) {
      if (level.legend[level.tiles[row * level.cols + col]].id === glyph) return [col, row];
    }
  }
  return [rect[0], rect[1]];
}

/** A pillar `width` across and `height` tall, cut off at `stump`: its parts up to that height. */
function stumpGeometry(width: number, height: number, stump: number): BufferGeometry {
  const boxes = pillarParts({ width, height })
    .filter((part) => part.from < stump)
    .map(({ width: across, from, to }) =>
      boxGeometry({ width: across, height: Math.min(to, stump) - from, depth: across }).translate(0, from, 0),
    );
  const merged = sidesThenTops(mergeGeometries(boxes));
  boxes.forEach((box) => box.dispose());
  return merged;
}

/**
 * Each slot's material: `materials` one per slot, a slot past the last taking the last; the first for the whole
 * when there is one, or the geometry has no slots (a surface).
 */
function drawnWith(geometry: BufferGeometry, materials: readonly Material[]): Material | Material[] {
  if (materials.length === 1 || !geometry.groups.length) {
    geometry.clearGroups();
    return materials[0];
  }
  const slots = Math.max(...geometry.groups.map((group) => group.materialIndex ?? 0)) + 1;
  return Array.from({ length: slots }, (_, slot) => materials[Math.min(slot, materials.length - 1)]);
}

/** Builds `descriptor`'s mesh in `recipe`'s shape, with `materials` (the recipe's, compiled). */
export function buildShape(
  level: CompiledLevel,
  descriptor: MeshDescriptor,
  recipe: LevelRecipe,
  materials: readonly Material[],
): BuiltShape {
  const { pieces, bottom, top } = descriptor;
  const height = top - bottom;
  const single = (geometry: BufferGeometry): BuiltShape => ({
    mesh: new Mesh(geometry, drawnWith(geometry, materials)),
    cells: [],
    cut: null,
  });
  if (recipe.shape === 'slab') return single(slabGeometry(level.tile, pieces, bottom, top));
  if (recipe.shape === 'surface' || height <= 0) return single(surfaceGeometry(level.tile, pieces, bottom));
  if (recipe.shape === 'brazier') return single(brazierGeometry(level, pieces, bottom, top));
  if (recipe.shape === 'stairs' || recipe.shape === 'ramp') {
    const ramps = level.ramps.filter((ramp) => holdsTile(pieces, ramp.tiles[0], ramp.tiles[1]));
    const draw = recipe.shape === 'ramp' ? rampGeometry : stairsGeometry;
    return single(draw(level.tile, ramps, bottom));
  }
  if (recipe.shape === 'dais') {
    const daises = level.daises.filter((dais) => holdsTile(pieces, ...firstTile(level, dais.tiles, dais.glyph)));
    return single(daisGeometry(level.tile, daises, pieces, bottom));
  }
  const [c0, r0, c1, r1] = pieces[0] ?? [0, 0, 0, 0];
  const [width, depth] = [(c1 - c0 + 1) * level.tile, (r1 - r0 + 1) * level.tile];
  const pillar = recipe.shape === 'pillar';
  const geometry = pillar ? pillarGeometry({ width, height }) : sidesThenTops(boxGeometry({ width, height, depth }));
  const cells = levelCells(level, pieces, bottom);
  const mesh = instanced(geometry, drawnWith(geometry, materials), cells);
  const cut = recipe.cut;
  if (!cut || !(cut.height > 0)) return { mesh, cells, cut: null };
  const low = Math.min(cut.height, height);
  return {
    mesh,
    cells,
    cut: {
      height: low,
      when: cut.when,
      geometry() {
        const twin = pillar
          ? stumpGeometry(width, height, low)
          : sidesThenTops(boxGeometry({ width, height: low, depth }));
        if (!Array.isArray(mesh.material)) twin.clearGroups();
        return twin;
      },
    },
  };
}
