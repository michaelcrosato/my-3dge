/**
 * @file What the frame draws, as the agent eye asks it (PLAN.md WP 12.3; engine/dev/eye.ts): `drawnFaces(root)` indexes
 * every triangle the view's scene draws (each visible mesh's, each drawn instance's, in world space; the sky's,
 * `userData.background`, left out, and a skinned mesh's, whose shape the GPU poses) in a grid of `FACE_CELL` cubes,
 * and `faceAt(point, dir)` says whether one lies within `FACE_NEAR` of a point a ray struck and shows its face to that
 * ray: that face's normal, turned against the ray, else null. A face its material culls (three.js's `side`: the front
 * by default, the back, or both) shows only from its drawn side, as the ID pass draws what the frame draws
 * (engine/gfx/idpass.ts). So the eye passes where the frame draws nothing at a body's surface: a storey or a roof the
 * cutaway hides, a wall it cut down, a collider bigger than its mesh (a railing's whole tile), a ceiling from above.
 *
 * A merged mesh's box would not do: a storey's door heads span the storey, their box round the floor above it.
 *
 * Invariants: read-only (it reads the objects' geometry, matrices and materials); pure in them; engine/dev imports no
 * three.js: the objects are structural (`EyeObject`) and the math is core/math's.
 *
 * @example
 * // const faces = drawnFaces(stage.scene);
 * // faces.faceAt(hit.point, dir); // Vector3 (0, 1, 0): a floor drawn there, facing up at a ray going down; or null
 * @see engine/dev/eyeFaces.test.ts
 */
import { Matrix4, Vector3 } from '../core/math';

/** The grid's cube, m: a triangle is listed in every cube its box, `FACE_NEAR` wider, overlaps. */
export const FACE_CELL = 1;

/** How far from a drawn face a struck point may lie and be on it, m: a collider and its mesh meet within it. */
export const FACE_NEAR = 0.02;

/** three.js's `side` values: a material draws its triangles' front faces, their back faces, or both. */
export const [FRONT_SIDE, BACK_SIDE, DOUBLE_SIDE] = [0, 1, 2];

/** What `drawnFaces` reads of a three.js buffer attribute: its count and each item's components. */
export interface EyeAttribute {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** What `drawnFaces` reads of a three.js object: `Object3D`, `Mesh` and `InstancedMesh`, as far as it needs. */
export interface EyeObject {
  readonly visible: boolean;
  readonly children: readonly EyeObject[];
  readonly matrixWorld: Matrix4;
  readonly userData: Readonly<Record<string, unknown>>;
  readonly isMesh?: boolean;
  /** A skinned mesh's corners are posed on the GPU: its geometry is not its shape. */
  readonly isSkinnedMesh?: boolean;
  readonly geometry?: {
    readonly attributes: { readonly position?: EyeAttribute };
    readonly index: EyeAttribute | null;
    readonly drawRange: { readonly start: number; readonly count: number };
  };
  readonly material?: { readonly side: number } | readonly { readonly side: number }[];
  /** An instanced mesh's: how many of its instances it draws, and each one's matrix. */
  readonly isInstancedMesh?: boolean;
  readonly count?: number;
  getMatrixAt?(index: number, matrix: Matrix4): void;
}

/** The drawn faces (see the file comment). */
export interface EyeFaces {
  /** How many triangles it holds. */
  readonly count: number;
  /** The normal, against `dir`, of a drawn face within `FACE_NEAR` of `point` that shows to a ray along `dir`; else null. */
  faceAt(point: Vector3, dir: Vector3): Vector3 | null;
}

/** The side a mesh's materials draw: both if any does, else the back if all do, else the front. */
function sideOf(material: EyeObject['material']): number {
  const sides = (Array.isArray(material) ? material : [material ?? { side: FRONT_SIDE }]).map((m) => m.side);
  return sides.includes(DOUBLE_SIDE) ? DOUBLE_SIDE : sides.every((side) => side === BACK_SIDE) ? BACK_SIDE : FRONT_SIDE;
}

/** A cube's key: its whole coordinates, within ±4,096 cubes of the origin. */
const keyOf = (x: number, y: number, z: number) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);

/** Indexes what `root` draws (see the file comment). */
export function drawnFaces(root: EyeObject): EyeFaces {
  const corners: number[] = []; // nine a triangle: its corners in world space
  const normals: number[] = []; // three a triangle: its unit normal, its corners counter-clockwise round it
  const sides: number[] = [];
  const cells = new Map<number, number[]>();
  const [matrix, instance] = [new Matrix4(), new Matrix4()];
  const [a, b, c, ab, ac] = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()];
  const add = (side: number) => {
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const length = normal.length();
    if (length < 1e-12) return; // no area: nothing drawn
    normal.divideScalar(length);
    const t = sides.length;
    corners.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    normals.push(normal.x, normal.y, normal.z);
    sides.push(side);
    const cube = (v: number, far: boolean) => Math.floor((v + (far ? FACE_NEAR : -FACE_NEAR)) / FACE_CELL);
    const [x0, x1] = [cube(Math.min(a.x, b.x, c.x), false), cube(Math.max(a.x, b.x, c.x), true)];
    const [y0, y1] = [cube(Math.min(a.y, b.y, c.y), false), cube(Math.max(a.y, b.y, c.y), true)];
    const [z0, z1] = [cube(Math.min(a.z, b.z, c.z), false), cube(Math.max(a.z, b.z, c.z), true)];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          const key = keyOf(x, y, z);
          const list = cells.get(key);
          if (list) list.push(t);
          else cells.set(key, [t]);
        }
      }
    }
  };
  const walk = (object: EyeObject) => {
    if (!object.visible || object.userData.background) return;
    const geometry = object.geometry;
    const position = geometry?.attributes.position;
    if (object.isMesh && !object.isSkinnedMesh && geometry && position) {
      const side = sideOf(object.material);
      const index = geometry.index;
      const total = index ? index.count : position.count;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(total, start + geometry.drawRange.count);
      const corner = (i: number, v: Vector3) => {
        const at = index ? index.getX(i) : i;
        return v.set(position.getX(at), position.getY(at), position.getZ(at)).applyMatrix4(matrix);
      };
      const instances = object.isInstancedMesh ? (object.count ?? 0) : 1;
      for (let k = 0; k < instances; k++) {
        matrix.copy(object.matrixWorld);
        if (object.isInstancedMesh) {
          object.getMatrixAt!(k, instance);
          matrix.multiply(instance);
        }
        const mirrored = matrix.determinant() < 0; // a mirroring matrix turns the corners clockwise
        const drawn = mirrored && side !== DOUBLE_SIDE ? BACK_SIDE + FRONT_SIDE - side : side;
        for (let i = start; i + 2 < end; i += 3) {
          corner(i, a);
          corner(i + 1, b);
          corner(i + 2, c);
          add(drawn);
        }
      }
    }
    for (const child of object.children) walk(child);
  };
  walk(root);
  return {
    count: sides.length,
    faceAt(point, dir) {
      const list = cells.get(keyOf(Math.floor(point.x / FACE_CELL), Math.floor(point.y / FACE_CELL), Math.floor(point.z / FACE_CELL))); // prettier-ignore
      if (!list) return null;
      for (const t of list) {
        const [nx, ny, nz] = [normals[3 * t], normals[3 * t + 1], normals[3 * t + 2]];
        const facing = nx * dir.x + ny * dir.y + nz * dir.z; // below 0: its front faces the ray
        if ((sides[t] === FRONT_SIDE && facing >= 0) || (sides[t] === BACK_SIDE && facing <= 0)) continue;
        const o = 9 * t;
        if (Math.abs(nx * (point.x - corners[o]) + ny * (point.y - corners[o + 1]) + nz * (point.z - corners[o + 2])) > FACE_NEAR) continue; // prettier-ignore
        let inside = true;
        for (let e = 0; e < 3 && inside; e++) {
          const [p, q] = [o + 3 * e, o + 3 * ((e + 1) % 3)]; // an edge, p to q
          const [ex, ey, ez] = [
            corners[q] - corners[p],
            corners[q + 1] - corners[p + 1],
            corners[q + 2] - corners[p + 2],
          ];
          const [mx, my, mz] = [ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex]; // the edge's inward normal, its length
          const across =
            mx * (point.x - corners[p]) + my * (point.y - corners[p + 1]) + mz * (point.z - corners[p + 2]);
          inside = across >= -FACE_NEAR * Math.hypot(ex, ey, ez);
        }
        if (!inside) continue;
        const sign = facing < 0 ? 1 : -1;
        return new Vector3(sign * nx + 0, sign * ny + 0, sign * nz + 0); // + 0: never −0
      }
      return null;
    },
  };
}
