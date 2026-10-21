/**
 * @file The stage's ground (PLAN.md WP 2.7; its frame WP 13.15): `groundMesh(size, material, options)` is a plane 2 cm
 * under a level's floor, `y`, reaching `GROUND_MARGIN` past the level's area on every side, its UVs in metres, named
 * `stage/ground` and receiving shadows. Round a terrain (`hole`) it is a frame about the terrain's area instead, which
 * the terrain itself covers: a site's cut shows what stands under it (a cellar), and the terrain's dips under its
 * origin's height never show the plane through them.
 *
 * Invariants: presentation only; one mesh, every face up; equal inputs make equal geometry; without a hole, three's
 * plane, as the stage has always drawn it.
 *
 * @example
 * import { MeshBasicMaterial } from 'three/webgpu';
 * const frame = groundMesh([32, 32], new MeshBasicMaterial(), { hole: true });
 * frame.geometry.getIndex()!.count / 6; // 8: the cells round the terrain's own
 * @see engine/gfx/stage.test.ts
 */
import { BufferGeometry, Float32BufferAttribute, Mesh, PlaneGeometry, type Material } from 'three/webgpu';

/** How far the ground reaches beyond the level on every side, m: past what any view frames at zoom 0.5. */
export const GROUND_MARGIN = 60;

/** Where the ground lies: its area's north-west corner (m), the floor it stands under (m), and a terrain's hole. */
export interface GroundOptions {
  corner?: readonly [number, number];
  y?: number;
  hole?: boolean;
}

/** The stage's ground round an area of `size` (m, along x and z: see the file comment). */
export function groundMesh(size: readonly [number, number], material: Material, options: GroundOptions = {}): Mesh {
  const { corner: [x0, z0] = [0, 0], y = 0, hole = false } = options;
  const [width, depth] = size;
  const geometry = hole ? frame(x0, z0, width, depth, y - 0.02) : plane(x0, z0, width, depth, y - 0.02);
  const ground = new Mesh(geometry, material);
  Object.assign(ground, { name: 'stage/ground', receiveShadow: true });
  return ground;
}

/** The plane over the area and its margins at height `y`, UVs in metres. */
function plane(x0: number, z0: number, width: number, depth: number, y: number): BufferGeometry {
  const [w, d] = [width + 2 * GROUND_MARGIN, depth + 2 * GROUND_MARGIN];
  const geometry = new PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(x0 + width / 2, y, z0 + depth / 2);
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
  return geometry;
}

/** The margins alone, the eight cells round the area at height `y`, UVs in metres from the south-west as the plane's. */
function frame(x0: number, z0: number, width: number, depth: number, y: number): BufferGeometry {
  const xs = [x0 - GROUND_MARGIN, x0, x0 + width, x0 + width + GROUND_MARGIN];
  const zs = [z0 - GROUND_MARGIN, z0, z0 + depth, z0 + depth + GROUND_MARGIN];
  const [positions, normals, uvs, indices]: number[][] = [[], [], [], []];
  for (const z of zs) {
    for (const x of xs) {
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      uvs.push(x - xs[0], zs[3] - z);
    }
  }
  const at = (c: number, r: number) => r * 4 + c;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 1 && c === 1) continue; // the area's own cell: the terrain's
      // North-west, south-west, north-east; north-east, south-west, south-east: facing up.
      indices.push(at(c, r), at(c, r + 1), at(c + 1, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
