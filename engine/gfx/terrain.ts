/**
 * @file The terrain drawn (PLAN.md WP 10.5; docs/PLAYGROUND.md §2.2): `createTerrainMeshes(terrain, { materials })`
 * draws a terrain (engine/world/terrain.ts) in square chunks of up to `CHUNK` cells a side, each a three.js `LOD` at
 * the chunk's middle holding a mesh per level of detail: every corner, every second, every fourth (`LOD_STEPS`, those
 * that divide the chunk), shown from `LOD_DISTANCES` metres away: three's renderer picks one for each camera, by its
 * distance from a perspective camera, and for an orthographic one (which stands far back: the isometric and top-down
 * views) by what it frames, as far as a 50° lens stands to frame as much (`levelDistance`). The finest mesh is the collider's surface, each cell split as Rapier splits it;
 * coarser ones skip corners, and every mesh hangs a skirt `SKIRT` metres down round its edges, so where neighbours of
 * different detail meet no gap shows the sky. Normals are the full grid's at every level (central differences of the
 * heights), so the light holds still as the levels switch; UVs are world metres (x, z).
 *
 * Materials: the terrain's ground layer from `materials` (a registry material, so the style set re-points it), drawn
 * through the splat (engine/gfx/terrainSplat.ts, the meshes' `userData.restyle`) with its steep and high layers.
 * Names: the root `terrain:<name>`, a chunk's meshes `terrain:<name>/<col>,<row>#<level>` (its north-west cell's
 * column and row, the level from 0, the finest), with `userData.terrain`; the ID pass and the inspector show them.
 *
 * Invariants: pure in the terrain (equal inputs give equal buffers); `drawCalls(shadowMaps)` counts one mesh a chunk
 * (one level shows at a time); `register(warmup)` registers every level of every chunk, so switching builds nothing;
 * `dispose()` frees the geometries and the splat's copies, never the library's materials. Nothing reaches the sim.
 *
 * @example
 * // const meshes = createTerrainMeshes(getTerrain('terrain:hill'), { materials: createMaterialLibrary() });
 * // scene.add(meshes.root);
 * // meshes.register(gfx.warmup);
 * // meshes.drawCalls(1); // 2 a chunk: one level in colour, and into the shadow map
 * @see engine/gfx/terrain.test.ts
 * @see tests/e2e/terrain.spec.ts
 */
import { Group, LOD, Mesh, Vector3, type BufferGeometry, type Camera, type Material, type OrthographicCamera, type PerspectiveCamera } from 'three/webgpu'; // prettier-ignore
import type { Terrain } from '../world/terrain';
import { createWriter, type Vec3 } from './geometry/writer';
import { createTerrainSplat, type TerrainSplat } from './terrainSplat';
import type { Warmup } from './warmup';

/** A chunk's side, in cells, at most. */
export const CHUNK = 32;
/** The levels of detail: the corners each takes, every one, every second, every fourth. */
export const LOD_STEPS = [1, 2, 4] as const;
/** From how far (m) each level shows. */
export const LOD_DISTANCES = [0, 48, 96] as const;
/** How far a chunk's skirt hangs below its edge (m). */
export const SKIRT = 2;
/** tan(25°): half the vertical lens an orthographic view is measured against (three's 50° default). */
const HALF_LENS = 0.4663076581549986;

/**
 * How far `camera` stands from a chunk whose middle is `at`, as its level of detail reads it: the distance, from a
 * perspective camera; from an orthographic one, how far a 50° lens stands to frame its height (m).
 */
export function levelDistance(camera: Camera, at: Vector3): number {
  const ortho = camera as OrthographicCamera;
  if (ortho.isOrthographicCamera) return (ortho.top - ortho.bottom) / ortho.zoom / (2 * HALF_LENS);
  return camera.getWorldPosition(eye).distanceTo(at) / ((camera as PerspectiveCamera).zoom ?? 1);
}

/** Scratch points for the levels' distances: the camera's and a chunk's middle. */
const [eye, middle] = [new Vector3(), new Vector3()];

/** A chunk's LOD: three's, picking a level by `levelDistance`. */
class ChunkLOD extends LOD {
  override update(camera: Camera): void {
    const distance = levelDistance(camera, this.getWorldPosition(middle));
    let shown = 0;
    while (shown + 1 < this.levels.length && distance >= this.levels[shown + 1].distance) shown++;
    this.levels.forEach((level, i) => (level.object.visible = i === shown));
    (this as unknown as { _currentLevel: number })._currentLevel = shown;
  }
}

/** What `createTerrainMeshes` needs: where materials come from. */
export interface TerrainMeshesOptions {
  /** The materials by id: the page's material library (engine/gfx/materials/library.ts). */
  materials: { get(id: string): Material };
}

/** A terrain's meshes (see the file comment). */
export interface TerrainMeshes {
  /** The group holding every chunk: add it to the scene. */
  readonly root: Group;
  /** The chunks, row by row from the north-west. */
  readonly chunks: readonly LOD[];
  /** Every level of every chunk, chunk by chunk, finest first. */
  readonly meshes: readonly Mesh[];
  /** Draw calls a frame costs: a chunk's level shown, once in colour and once per shadow map. */
  drawCalls(shadowMaps?: number): number;
  /** Registers every mesh with `warmup` as `id` (the root's name by default); `dispose()` unregisters. */
  register(warmup: Pick<Warmup, 'register'>, id?: string): { dispose(): void };
  /** Frees the geometries and the splat's materials, removes the root from its parent and unregisters. */
  dispose(): void;
}

/** Every corner's smooth normal: central differences of the heights (one-sided at the edges). */
export function terrainNormals(terrain: Pick<Terrain, 'cols' | 'rows' | 'cell' | 'heights'>): Float32Array {
  const { cols, rows, cell, heights } = terrain;
  const at = (c: number, r: number) => heights[Math.min(rows, Math.max(0, r)) * (cols + 1) + Math.min(cols, Math.max(0, c))]; // prettier-ignore
  const normals = new Float32Array((rows + 1) * (cols + 1) * 3);
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [west, east] = [Math.max(0, c - 1), Math.min(cols, c + 1)];
      const [north, south] = [Math.max(0, r - 1), Math.min(rows, r + 1)];
      const nx = (at(west, r) - at(east, r)) / ((east - west) * cell);
      const nz = (at(c, north) - at(c, south)) / ((south - north) * cell);
      const length = Math.hypot(nx, 1, nz);
      normals.set([nx / length, 1 / length, nz / length], (r * (cols + 1) + c) * 3);
    }
  }
  return normals;
}

/**
 * One level of a chunk: cells `c0`… and `r0`… of `terrain`, `cols` × `rows` of them, taking every `step`-th corner,
 * positions from `middle` (m), with its skirt (see the file comment).
 */
export function chunkGeometry(
  terrain: Terrain,
  normals: Float32Array,
  [c0, r0, cols, rows]: readonly [number, number, number, number],
  step: number,
  middle: Vec3,
): BufferGeometry {
  const { cell, origin, heights } = terrain;
  const writer = createWriter();
  const [across, down] = [cols / step, rows / step];
  const corner = (i: number, j: number, drop = 0) => {
    const [c, r] = [c0 + i * step, r0 + j * step];
    const k = r * (terrain.cols + 1) + c;
    const [x, z] = [origin[0] + c * cell, origin[2] + r * cell];
    const normal: Vec3 = [normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]];
    return writer.vertex([x - middle[0], heights[k] - drop - middle[1], z - middle[2]], normal, [x, z]);
  };
  const first = writer.count;
  for (let j = 0; j <= down; j++) for (let i = 0; i <= across; i++) corner(i, j);
  const index = (i: number, j: number) => first + j * (across + 1) + i;
  for (let j = 0; j < down; j++) {
    for (let i = 0; i < across; i++) {
      // Rapier's split, wound to face up: north-west, south-west, north-east; then north-east, south-west, south-east.
      writer.triangle(index(i, j), index(i, j + 1), index(i + 1, j));
      writer.triangle(index(i + 1, j), index(i, j + 1), index(i + 1, j + 1));
    }
  }
  // The skirt: each edge's corners clockwise seen from above, then the same dropped, joined facing out of the chunk.
  const edges: [number, number][][] = [
    Array.from({ length: across + 1 }, (_, i) => [i, 0]), // north, west to east
    Array.from({ length: down + 1 }, (_, j) => [across, j]), // east, north to south
    Array.from({ length: across + 1 }, (_, i) => [across - i, down]), // south, east to west
    Array.from({ length: down + 1 }, (_, j) => [0, down - j]), // west, south to north
  ];
  for (const edge of edges) {
    const top = edge.map(([i, j]) => corner(i, j));
    const bottom = edge.map(([i, j]) => corner(i, j, SKIRT));
    for (let k = 0; k + 1 < edge.length; k++) {
      writer.triangle(top[k], top[k + 1], bottom[k]);
      writer.triangle(top[k + 1], bottom[k + 1], bottom[k]);
    }
  }
  return writer.build();
}

/** Draws `terrain` (see the file comment). */
export function createTerrainMeshes(terrain: Terrain, options: TerrainMeshesOptions): TerrainMeshes {
  const root = new Group();
  root.name = `terrain:${terrain.name}`;
  root.userData.terrain = terrain.name;
  const [ground, ...layers] = terrain.materials.map((id) => options.materials.get(id));
  const splat: TerrainSplat = createTerrainSplat(terrain, layers);
  const normals = terrainNormals(terrain);
  const chunks: LOD[] = [];
  const meshes: Mesh[] = [];
  const { cell, origin, heights } = terrain;
  for (let r0 = 0; r0 < terrain.rows; r0 += CHUNK) {
    for (let c0 = 0; c0 < terrain.cols; c0 += CHUNK) {
      const [cols, rows] = [Math.min(CHUNK, terrain.cols - c0), Math.min(CHUNK, terrain.rows - r0)];
      const centre = heights[(r0 + (rows >> 1)) * (terrain.cols + 1) + c0 + (cols >> 1)];
      const middle: Vec3 = [origin[0] + (c0 + cols / 2) * cell, centre, origin[2] + (r0 + rows / 2) * cell];
      const lod = new ChunkLOD();
      lod.name = `${root.name}/${c0},${r0}`;
      lod.position.set(...middle);
      LOD_STEPS.forEach((step, level) => {
        if (cols % step || rows % step) return;
        const mesh = new Mesh(chunkGeometry(terrain, normals, [c0, r0, cols, rows], step, middle), splat.wrap(ground));
        Object.assign(mesh, { name: `${lod.name}#${level}`, castShadow: true, receiveShadow: true });
        Object.assign(mesh.userData, { terrain: terrain.name, restyle: (material: Material) => splat.wrap(material) });
        lod.addLevel(mesh, LOD_DISTANCES[level]);
        meshes.push(mesh);
      });
      chunks.push(lod);
      root.add(lod);
    }
  }
  root.updateMatrixWorld(true);
  const registrations = new Set<{ dispose(): void }>();
  return {
    root,
    chunks,
    meshes,
    drawCalls(shadowMaps = 0) {
      return root.visible ? chunks.length * (1 + shadowMaps) : 0;
    },
    register(warmup, id = root.name) {
      const entry = warmup.register(id, { objects: () => meshes });
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
      for (const mesh of meshes) mesh.geometry.dispose();
      splat.dispose();
      root.removeFromParent();
    },
  };
}
