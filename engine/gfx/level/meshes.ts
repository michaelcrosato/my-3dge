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
 * Everything sits under one group, `root`, named `level:<name>`; a mesh is named `level:<name>/<recipe>`, or
 * `level:<name>/<storey>/<recipe>` in a level written as storeys (`createLevelMeshes` says how they draw), with `#2`…
 * after a second descriptor of the same recipe, and carries `userData.level`, `userData.recipe` and `userData.glyphs`,
 * which the ID pass and the inspector show. Coordinates are the compiled level's: metres, the map's north-west corner
 * at the origin, +X east, +Z south.
 *
 * Invariants: pure in the level and the recipes (equal inputs give equal buffers); materials come from
 * `options.materials` (the page's material library) and are never disposed here; `dispose()` frees the geometries,
 * leaves the parent and unregisters; nothing reaches the sim.
 *
 * Carried from `my-3d2dge:src/stress-world/10-hall.js:264-405`'s meshes: the floor, the instanced walls and low walls
 * (`inst`, `sidesThenTops`), the pillars, the galleries, the stairs and the dais, from WP 2.2's and 4.2's descriptors.
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
import { Group, Mesh, type BufferGeometry, type InstancedMesh, type Material } from 'three/webgpu';
import { defineCodes, log as sharedLog, type Log } from '../../core/log';
import { storeyView } from '../../world/level/storeys';
import type { CompiledLevel, MeshDescriptor, RoofDescriptor, TileRect } from '../../world/level/types';
import type { Warmup } from '../warmup';
import type { LevelCell } from './cells';
import { flightGeometry } from './flights';
import { framesGeometry, headsGeometry, railingGeometry } from './openings';
import { FALLBACK_RECIPE, LEVEL_RECIPES, type LevelRecipe, type LevelShape } from './recipes';
import { roofGeometry } from './roofs';
import { buildShape, drawnWith, type BuiltShape, type PartCut } from './shapes';
import { ceilingGeometry } from './slabs';
import { surfaceGeometry } from './surface';
import { underRoofGeometry } from './walls';

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
  /** A level written as storeys: the floor material of each room given one, by room name (`{ kitchen: 'material:tile' }`). */
  rooms?: Readonly<Record<string, string>>;
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
  /** A level written as storeys: the storey it draws (an index into `level.storeys`). */
  storey?: number;
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

/** Whether `pieces` holds tile (col, row). */
const holdsTile = (pieces: readonly TileRect[], col: number, row: number) =>
  pieces.some(([c0, r0, c1, r1]) => col >= c0 && col <= c1 && row >= r0 && row <= r1);

/**
 * Draws `level`'s mesh descriptors (see the file comment). A level written as storeys draws each storey's descriptors
 * from its view (engine/world/level/storeys.ts's `storeyView`), bottom first, each part with `userData.storey`: its
 * walls up to the storey above or, under a pitched roof, clipped to the roof's underside in merged runs (walls.ts); its
 * flights of stairs by the riser (flights.ts); its railings as posts and rails (openings.ts). Then each storey's own
 * parts, `ceiling` (its slab's underside and void edges, slabs.ts), `heads` (the wall over its openings and low
 * ceilings) and `frames` (round its doors and windows, openings.ts); the floors of the rooms `options.rooms` gives a
 * material of their own; and the roofs (roofs.ts). They come after every descriptor's mesh, so `parts[i]` is still the
 * i-th descriptor's, storey by storey, for the stage's runs (engine/gfx/stage.ts). A part with nothing to draw (a
 * storey's floor whose every piece its rooms' own floors took) keeps its place in `parts`, hidden and out of the root,
 * since an empty mesh in the scene is drawn with no vertices (WP 13.18: Dawn warns of a draw with an index count of 0).
 */
export function createLevelMeshes(level: CompiledLevel, options: LevelMeshesOptions): LevelMeshes {
  const recipes = { ...LEVEL_RECIPES, ...options.recipes };
  const log = options.log ?? sharedLog;
  const root = new Group();
  root.name = `level:${level.name}`;
  root.userData.level = level.name;
  const names = new Map<string, number>();
  const recipeOf = (name: string): LevelRecipe => {
    if (Object.hasOwn(recipes, name)) return recipes[name];
    const known = Object.keys(recipes).sort().join(', ');
    log.warnOnce('GFX_LEVEL_RECIPE', { level: level.name, recipe: name, known }, name);
    return FALLBACK_RECIPE;
  };
  const materialsOf = (recipe: LevelRecipe) => recipe.materials.map((id) => options.materials.get(id));
  const single = (geometry: BufferGeometry, recipe: LevelRecipe): BuiltShape => ({
    mesh: new Mesh(geometry, drawnWith(geometry, materialsOf(recipe))),
    cells: [],
    cut: null,
  });
  const place = (
    built: BuiltShape,
    recipe: string,
    shape: LevelRecipe,
    glyphs: readonly string[],
    heights: [number, number],
    storey?: number,
  ): LevelMeshPart => {
    // prettier-ignore
    const prefix = storey === undefined ? root.name : `${root.name}/${level.storeys![storey].name}`;
    const base = `${prefix}/${recipe}`;
    const seen = (names.get(base) ?? 0) + 1;
    names.set(base, seen);
    const { mesh, cells, cut } = built;
    mesh.name = seen > 1 ? `${base}#${seen}` : base;
    mesh.castShadow = shape.castShadow;
    mesh.receiveShadow = shape.receiveShadow;
    Object.assign(mesh.userData, { level: level.name, recipe, glyphs: [...glyphs], ...(storey === undefined ? {} : { storey }) }); // prettier-ignore
    if (drawsNothing(mesh.geometry)) mesh.visible = false;
    else root.add(mesh);
    const [bottom, top] = heights;
    const part: LevelMeshPart = { name: mesh.name, recipe, shape: shape.shape, glyphs, mesh, cells, bottom, top, cut, castShadow: shape.castShadow }; // prettier-ignore
    return storey === undefined ? part : { ...part, storey };
  };
  const views = level.storeys ? level.storeys.map((_, k) => storeyView(level, k)) : [level];
  const parts: LevelMeshPart[] = [];
  const roomPieces = new Map<string, { storey: number; base: number; pieces: TileRect[] }>();
  views.forEach((view, k) => {
    const storey = level.storeys ? k : undefined;
    const roof = level.roofs?.find((each) => each.storey === k && each.kind !== 'flat');
    for (const descriptor of view.meshes) {
      const recipe = recipeOf(descriptor.recipe);
      const drawn = storey === undefined ? descriptor : withoutRooms(level, k, descriptor, recipe, options.rooms, roomPieces); // prettier-ignore
      parts.push(place(buildPart(view, drawn, recipe, materialsOf(recipe), single, roof), descriptor.recipe, recipe, descriptor.glyphs, [descriptor.bottom, descriptor.top], storey)); // prettier-ignore
    }
  });
  level.storeys?.forEach((storey, k) => {
    const roof = level.roofs?.find((each) => each.storey === k && each.kind !== 'flat');
    const own: [string, BufferGeometry | null, [number, number]][] = [
      ['ceiling', ceilingGeometry(level, storey), [storey.base - storey.slab, storey.base]],
      ['heads', headsGeometry(level, storey, roof), [storey.base, storey.fullTop]],
      ['frames', framesGeometry((level.openings ?? []).filter((opening) => opening.storey === k), level.tile), [storey.base, storey.fullTop]], // prettier-ignore
    ];
    for (const [name, geometry, heights] of own) {
      const recipe = recipeOf(name);
      if (geometry) parts.push(place(single(geometry, recipe), name, recipe, [], heights, k));
    }
  });
  for (const [room, { storey, base, pieces }] of roomPieces) {
    const recipe = { ...recipeOf('floor'), materials: [options.rooms![room]] };
    parts.push(place(single(surfaceGeometry(level.tile, pieces, base), recipe), `floor:${room}`, recipe, [], [base, base], storey)); // prettier-ignore
  }
  for (const roof of level.roofs ?? []) {
    const recipe = recipeOf('roof');
    parts.push(place(single(roofGeometry(roof), recipe), 'roof', recipe, [], [roof.eave, roof.peak], roof.storey));
  }
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
      const entry = warmup.register(id, { objects: () => parts.filter((part) => part.mesh.parent === root).map((part) => part.mesh) }); // prettier-ignore
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

/** Whether `geometry` has no vertex to draw: no index, or no position, to draw. */
function drawsNothing(geometry: BufferGeometry): boolean {
  return (geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0)) === 0;
}

/**
 * One descriptor's mesh: a storey's full blocks under a pitched roof clipped to it, its flights by the riser, its
 * railings as posts and rails; everything else in its recipe's shape (engine/gfx/level/shapes.ts).
 */
function buildPart(
  view: CompiledLevel,
  descriptor: MeshDescriptor,
  recipe: LevelRecipe,
  materials: readonly Material[],
  single: (geometry: BufferGeometry, recipe: LevelRecipe) => BuiltShape,
  roof: RoofDescriptor | undefined,
): BuiltShape {
  const t = view.tile;
  const { pieces, bottom, top } = descriptor;
  const full = descriptor.glyphs.some((id) => Object.values(view.legend).find((glyph) => glyph.id === id)?.full);
  if (roof && full && (recipe.shape === 'block' || recipe.shape === 'pillar')) {
    const merged = recipe.shape === 'block' ? descriptor.rects : pieces;
    const rects = merged.map(([c0, r0, c1, r1]) => [c0 * t, r0 * t, (c1 + 1) * t, (r1 + 1) * t] as const);
    const geometry = underRoofGeometry(roof, rects, bottom);
    if (geometry) return single(geometry, recipe);
  }
  if (recipe.shape === 'flight') {
    const ramps = view.ramps.filter((ramp) => holdsTile(pieces, ramp.tiles[0], ramp.tiles[1]));
    return single(flightGeometry(t, ramps, bottom), recipe);
  }
  if (recipe.shape === 'railing') {
    const geometry = railingGeometry(t, descriptor.rects, bottom, top);
    if (geometry) return single(geometry, recipe);
  }
  return buildShape(view, descriptor, recipe, materials);
}

/**
 * `descriptor` without the floor pieces of rooms `rooms` gives a material of their own, which go to `found` by room
 * (a surface recipe's only).
 */
function withoutRooms(
  level: CompiledLevel,
  storey: number,
  descriptor: MeshDescriptor,
  recipe: LevelRecipe,
  rooms: Readonly<Record<string, string>> | undefined,
  found: Map<string, { storey: number; base: number; pieces: TileRect[] }>,
): MeshDescriptor {
  if (!rooms || recipe.shape !== 'surface' || !level.rooms?.length) return descriptor;
  const grid = level.storeys![storey].room;
  const kept: TileRect[] = [];
  for (const piece of descriptor.pieces) {
    const room = level.rooms[grid[piece[1] * level.cols + piece[0]]]?.name;
    if (!room || !Object.hasOwn(rooms, room)) {
      kept.push(piece);
      continue;
    }
    const entry = found.get(room) ?? { storey, base: descriptor.bottom, pieces: [] };
    entry.pieces.push(piece);
    found.set(room, entry);
  }
  return kept.length === descriptor.pieces.length ? descriptor : { ...descriptor, pieces: kept };
}
