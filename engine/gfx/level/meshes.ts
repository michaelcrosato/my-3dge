/**
 * @file The level meshes (PLAN.md WP 2.4, WP 4.4, §6.1 "data descriptors"): `createLevelMeshes(level, { materials })`
 * draws a compiled level (engine/world/level/compile.ts) from its mesh descriptors: one mesh per descriptor, built in
 * the shape of the recipe its glyphs name (engine/gfx/level/recipes.ts, shapes.ts). The floor is one welded surface
 * (one draw call); walls and low walls are instanced boxes and pillars instanced pillars (a plinth, a shaft and a
 * capital), one instance per piece, their faces in two groups, sides then tops: the room fixture draws in 7 calls,
 * 13 with a shadow map. v2's galleries, stairs, dais and brazier stands are one mesh per descriptor, a draw group per
 * material slot: the hall draws in 15 calls, 24 with a shadow map.
 *
 * `register(warmup)` registers the meshes with the warm-up (engine/gfx/warmup.ts); `cells` gives each instanced
 * piece's tiles, size and the way it faces out, and each part its recipe's `cut` (the cutaway's input,
 * engine/gfx/cutaway.ts); `drawCalls(shadowMaps)` says what a frame costs.
 *
 * A block's UVs are in metres from each piece's own corner (one geometry serves every instance), so a texture whose
 * pattern repeats a whole number of times across a piece (the v1 brick every 0.5 m, the dressed stone every 1 m)
 * runs on from piece to piece, its tones repeating with each piece as the prototype's per-tile wall textures did; the
 * other shapes' UVs are anchored to the world and run on across the whole level.
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
 * Carried from the meshes of `my-3d2dge:src/stress-world/10-hall.js:264-405`: the floor, the instanced walls and low
 * walls (`inst`, one instance per tile, `sidesThenTops`), the pillars on plinths under capitals, the galleries, the
 * stairs and the dais, built from WP 2.2's and WP 4.2's descriptors.
 *
 * @example
 * // const meshes = createLevelMeshes(getLevel('level:room'), { materials: createMaterialLibrary() });
 * // scene.add(meshes.root);
 * // meshes.register(gfx.warmup);
 * // meshes.drawCalls(1); // 13 for the room: 7 in colour, 6 into the shadow map
 * @see engine/gfx/level/meshes.test.ts
 * @see tests/e2e/level-meshes.spec.ts
 * @see tests/e2e/hall.spec.ts
 */
import { Group, type InstancedMesh, type Material, type Mesh } from 'three/webgpu';
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import type { CompiledLevel } from '../../world/level/types';
import type { Warmup } from '../warmup';
import type { LevelCell } from './cells';
import { FALLBACK_RECIPE, LEVEL_RECIPES, type LevelRecipe, type LevelShape } from './recipes';
import { buildShape, type PartCut } from './shapes';

/** The codes the level meshes raise, with their fixes. */
export const LEVEL_MESH_CODES = defineCodes('gfx', {
  GFX_LEVEL_RECIPE: {
    template: 'level {level} uses the mesh recipe {recipe}, which no level recipe defines: its tiles are grey blocks',
    fix: 'pass createLevelMeshes a recipe named {recipe} in its recipes option (shape, materials, castShadow and receiveShadow, as engine/gfx/level/recipes.ts writes them), or give the glyph a recipe the engine has: {known}',
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

/** One level mesh: its descriptor's recipe and glyphs, the mesh, and for an instanced shape one cell per instance. */
export interface LevelMeshPart {
  name: string;
  recipe: string;
  /** The shape it was drawn in (the recipe's, or a block for a recipe nobody defined). */
  shape: LevelShape;
  glyphs: readonly string[];
  mesh: Mesh | InstancedMesh;
  /** The pieces of a block or pillar shape in instance order (empty for the shapes drawn as one mesh). */
  cells: readonly LevelCell[];
  /** The height its pieces stand on and that of their tops (m): its descriptor's. */
  bottom: number;
  top: number;
  /** How the cutaway cuts its pieces, and its twin's geometry; null when it never cuts. */
  cut: PartCut | null;
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

/**
 * The draw calls `mesh` costs a frame: its groups (one with a single material), once in colour and once per shadow
 * map when it casts; none while it is hidden or an instanced mesh with no instances.
 */
export function meshDrawCalls(mesh: Mesh | InstancedMesh, castShadow: boolean, shadowMaps = 0): number {
  if (!mesh.visible || ((mesh as InstancedMesh).isInstancedMesh && (mesh as InstancedMesh).count === 0)) return 0;
  const groups = Array.isArray(mesh.material) ? mesh.geometry.groups.length : 1;
  return groups * (1 + (castShadow ? shadowMaps : 0));
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
    const materials = recipe.materials.map((id) => options.materials.get(id));
    const { mesh, cells, cut } = buildShape(level, descriptor, recipe, materials);
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
      shape: recipe.shape,
      glyphs: descriptor.glyphs,
      mesh,
      cells,
      bottom: descriptor.bottom,
      top: descriptor.top,
      cut,
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
      return parts.reduce((sum, { mesh, castShadow }) => sum + meshDrawCalls(mesh, castShadow, shadowMaps), 0);
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
