/**
 * @file The level meshes (PLAN.md WP 2.4, §6.1 "data descriptors"): `createLevelMeshes(level, { materials })` draws a
 * compiled level (engine/world/level/compile.ts) from its mesh descriptors: one mesh per descriptor, built by the
 * recipe its glyphs name (engine/gfx/level/recipes.ts). The floor is one welded surface (one draw call); walls, low
 * walls and pillars are instanced boxes, one instance per piece, their faces in two groups, sides then tops (two
 * draw calls per recipe however many pieces), so the room fixture draws in 7 calls, 13 with a shadow map.
 * `register(warmup)` registers the meshes with the warm-up (engine/gfx/warmup.ts), so their pipelines are built
 * before the first frame shows them; `cells` gives each block piece's tiles and the way it faces out (the cutaway's
 * input, WP 4.4); `drawCalls(shadowMaps)` says what a frame costs.
 *
 * Everything sits under one group, `root`, named `level:<name>`; a mesh is named `level:<name>/<recipe>` (with `#2`…
 * after a second descriptor of the same recipe), and carries `userData.level`, `userData.recipe` and
 * `userData.glyphs`, which the ID pass and the inspector show. Coordinates are the compiled level's: metres, the map's
 * north-west corner at the origin, +X east, +Z south.
 *
 * Invariants: pure in the level and the recipes (equal inputs give equal buffers); materials come from
 * `options.materials` (the page's material library) and are never disposed here; `dispose()` frees the geometries,
 * leaves the parent and unregisters; nothing reaches the sim.
 *
 * Carried from the meshes of `my-3d2dge:src/stress-world/10-hall.js:264-332`: the floor, the instanced walls and low
 * walls (`inst`, one instance per tile, `sidesThenTops`) and the pillars, built from WP 2.2's descriptors.
 *
 * @example
 * // const meshes = createLevelMeshes(getLevel('level:room'), { materials: createMaterialLibrary() });
 * // scene.add(meshes.root);
 * // meshes.register(gfx.warmup);
 * // meshes.drawCalls(1); // 13 for the room: 7 in colour, 6 into the shadow map
 * @see engine/gfx/level/meshes.test.ts
 * @see tests/e2e/level-meshes.spec.ts
 */
import { Group, InstancedMesh, Matrix4, Mesh, type BufferGeometry, type Material } from 'three/webgpu';
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import type { CompiledLevel, MeshDescriptor } from '../../world/level/types';
import { boxGeometry } from '../geometry/box';
import { sidesThenTops } from '../geometry/groups';
import type { Warmup } from '../warmup';
import { levelCells, type LevelCell } from './cells';
import { FALLBACK_RECIPE, LEVEL_RECIPES, type LevelRecipe } from './recipes';
import { surfaceGeometry } from './surface';

/** The codes the level meshes raise, with their fixes. */
export const LEVEL_MESH_CODES = defineCodes('gfx', {
  GFX_LEVEL_RECIPE: {
    template: 'level {level} uses the mesh recipe {recipe}, which no level recipe defines: its tiles are grey blocks',
    fix: "pass createLevelMeshes a recipe for it ({ recipes: { {recipe}: { shape: 'block', materials: [sides, tops], castShadow: true, receiveShadow: true } } }), or give the glyph a recipe the engine has: {known}",
    doc: 'Advice from `createLevelMeshes` (engine/gfx/level/meshes.ts) when a glyph names a mesh recipe that neither the engine (engine/gfx/level/recipes.ts) nor the `recipes` option defines: its tiles are drawn as grey boxes from their floor to their top, so the level still shows where they are.',
  },
});

/** What `createLevelMeshes` needs: where materials come from, and optionally more recipes and a log. */
export interface LevelMeshesOptions {
  /** The materials by id: the page's material library (engine/gfx/materials/library.ts). */
  materials: { get(id: string): Material };
  /** Recipes to add or replace, by the name a glyph's `mesh` gives: a game's own glyph meshes. */
  recipes?: Readonly<Record<string, LevelRecipe>>;
  /** Where advice goes (the shared log by default). */
  log?: Log;
}

/** One level mesh: its descriptor's recipe and glyphs, the mesh, and for a block one cell per instance. */
export interface LevelMeshPart {
  name: string;
  recipe: string;
  glyphs: readonly string[];
  mesh: Mesh | InstancedMesh;
  /** The block's pieces in instance order (empty for a surface). */
  cells: readonly LevelCell[];
  castShadow: boolean;
}

/** A level's meshes (see the file comment). */
export interface LevelMeshes {
  /** The group holding every mesh: add it to the scene. */
  readonly root: Group;
  /** The meshes, one per descriptor, in the descriptors' order. */
  readonly parts: readonly LevelMeshPart[];
  /** Every block piece's cell, in the order of `parts`, then of instances. */
  readonly cells: readonly LevelCell[];
  /** Draw calls a frame costs: each mesh's groups, once in colour and once per shadow map for those that cast. */
  drawCalls(shadowMaps?: number): number;
  /** Registers the meshes with `warmup` as `id` (the root's name by default); `dispose()` unregisters. */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Frees the geometries, removes the root from its parent and unregisters. */
  dispose(): void;
}

/** One instance per cell, standing at the cell's centre. */
function instanced(geometry: BufferGeometry, materials: Material[], cells: readonly LevelCell[]): InstancedMesh {
  const mesh = new InstancedMesh(geometry, materials, cells.length);
  const matrix = new Matrix4();
  cells.forEach((cell, i) => mesh.setMatrixAt(i, matrix.makeTranslation(...cell.centre)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

/** Builds one descriptor's mesh with `recipe`. */
function build(level: CompiledLevel, descriptor: MeshDescriptor, recipe: LevelRecipe, options: LevelMeshesOptions) {
  const materials = recipe.materials.map((id) => options.materials.get(id));
  const [c0, r0, c1, r1] = descriptor.pieces[0] ?? [0, 0, 0, 0];
  const height = descriptor.top - descriptor.bottom;
  if (recipe.shape === 'surface' || height <= 0) {
    const geometry = surfaceGeometry(level.tile, descriptor.pieces, descriptor.bottom);
    return { mesh: new Mesh(geometry, materials[0]), cells: [] };
  }
  const box = boxGeometry({ width: (c1 - c0 + 1) * level.tile, height, depth: (r1 - r0 + 1) * level.tile });
  const cells = levelCells(level, descriptor.pieces, descriptor.bottom);
  return { mesh: instanced(sidesThenTops(box), materials, cells), cells };
}

/** Draws `level`'s mesh descriptors (see the file comment). */
export function createLevelMeshes(level: CompiledLevel, options: LevelMeshesOptions): LevelMeshes {
  const recipes = { ...LEVEL_RECIPES, ...options.recipes };
  const log = options.log ?? sharedLog;
  const root = new Group();
  root.name = `level:${level.name}`;
  root.userData.level = level.name;
  const names = new Map<string, number>();
  const parts: LevelMeshPart[] = level.meshes.map((descriptor) => {
    let recipe = Object.hasOwn(recipes, descriptor.recipe) ? recipes[descriptor.recipe] : undefined;
    if (!recipe) {
      const known = Object.keys(recipes).sort().join(', ');
      log.warnOnce('GFX_LEVEL_RECIPE', { level: level.name, recipe: descriptor.recipe, known }, descriptor.recipe);
      recipe = FALLBACK_RECIPE;
    }
    const { mesh, cells } = build(level, descriptor, recipe, options);
    const base = `${root.name}/${descriptor.recipe}`;
    const seen = (names.get(base) ?? 0) + 1;
    names.set(base, seen);
    mesh.name = seen > 1 ? `${base}#${seen}` : base;
    mesh.castShadow = recipe.castShadow;
    mesh.receiveShadow = recipe.receiveShadow;
    Object.assign(mesh.userData, { level: level.name, recipe: descriptor.recipe, glyphs: [...descriptor.glyphs] });
    root.add(mesh);
    return {
      name: mesh.name,
      recipe: descriptor.recipe,
      glyphs: descriptor.glyphs,
      mesh,
      cells,
      castShadow: recipe.castShadow,
    };
  });
  root.updateMatrixWorld(true);
  const registrations = new Set<{ dispose(): void }>();
  return {
    root,
    parts,
    cells: parts.flatMap((part) => part.cells),
    drawCalls(shadowMaps = 0) {
      return parts.reduce((sum, { mesh, castShadow }) => {
        const groups = Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
        return sum + groups * (1 + (castShadow ? shadowMaps : 0));
      }, 0);
    },
    register(warmup, id = root.name) {
      const entry = warmup.register(id, { objects: () => parts.map((part) => part.mesh) });
      const registration = {
        dispose() {
          registrations.delete(registration);
          entry.dispose();
        },
      };
      registrations.add(registration);
      return registration;
    },
    dispose() {
      for (const registration of [...registrations]) registration.dispose();
      for (const { mesh } of parts) mesh.geometry.dispose();
      root.removeFromParent();
    },
  };
}
