/**
 * @file Secondary motion drawn (PLAN.md WP 6.2, WP 7.8, ADR-0018 amendment 1): the meshes of a `Secondary`'s chains
 * (engine/anim/secondary.ts) for a puppet. `createChainMeshes(secondary, { material, color, name })` makes one mesh
 * per part the layer has: the cape a ribbon between its two edges, hair and a tail each a strand (a square tube
 * `STRAND` wide). `update()` writes the chains' points into them after each pose; `meshes` are named
 * `<name>/cape`, `<name>/hair` and `<name>/tail`, so the ID pass names each part (engine/gfx/idpass.ts).
 *
 * Invariants: presentation only, reading the layer and never stepping it; vertices are world metres, so the meshes
 * hang under an object at the origin (engine/gfx/puppets/actors.ts puts them under the puppet's mesh, whose bones
 * carry the body, so they are the puppet's in the ID pass); both faces of a ribbon are drawn by its own triangles, so
 * the puppet's lit, single-sided, vertex-coloured material serves them; bounds are refreshed at every update, so
 * culling never drops them; `dispose()` frees the geometries.
 *
 * @example
 * import { MeshLambertNodeMaterial, Vector3 } from 'three/webgpu';
 * import { Animator } from '../../anim/character';
 * import { Secondary } from '../../anim/secondary';
 * const hero = new Animator({ build: 'build:heroic' });
 * const extras = new Secondary({ cape: true, squash: false });
 * hero.use('secondary', extras);
 * hero.update({ velocity: new Vector3(0, 0, 2) });
 * const material = new MeshLambertNodeMaterial({ vertexColors: true });
 * const chains = createChainMeshes(extras, { material, name: 'actor#1' });
 * chains.update();
 * chains.meshes.map((m) => m.name); // ['actor#1/cape']
 * @see engine/gfx/puppets/chains.test.ts
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, Vector3, type Material } from 'three/webgpu';
import type { Chain, Secondary } from '../../anim/secondary';
import { toLinear } from '../../core/color';

/** A strand's width, metres: hair's and a tail's square tube. */
export const STRAND = { hair: 0.05, tail: 0.07 } as const;

/** The meshes of one `Secondary`'s chains (see the file comment). */
export interface ChainMeshes {
  /** One mesh per part: the cape, the hair, the tail, those the layer has. */
  readonly meshes: readonly Mesh[];
  /** Writes the chains' points into the meshes, and their bounds. */
  update(): void;
  /** Frees the geometries and takes the meshes from their parent. */
  dispose(): void;
}

/** What `createChainMeshes` takes: the material (lit, vertex-coloured), the colour (CSS hex) and the name's stem. */
export interface ChainMeshOptions {
  material: Material;
  color?: string;
  name: string;
}

/** One part: its mesh, and how to write its vertices from the chains. */
interface Part {
  mesh: Mesh;
  write(position: BufferAttribute): void;
}

const [tangent, side, up, corner] = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const [X_AXIS, Z_AXIS] = [new Vector3(1, 0, 0), new Vector3(0, 0, 1)];

/** A geometry of `vertices` coloured `rgb`, with `index`, its positions written each frame. */
function partGeometry(vertices: number, index: number[], rgb: readonly number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(vertices * 3), 3);
  position.setUsage(DynamicDrawUsage); // rewritten every pose
  const color = new Float32Array(vertices * 3);
  for (let v = 0; v < vertices; v++) color.set(rgb, v * 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setIndex(index);
  return geometry;
}

/** The cape: rows of its left and right edges, front faces then the same reversed (the back's own vertices). */
function capePart(left: Chain, right: Chain): { vertices: number; index: number[]; write: Part['write'] } {
  const n = left.n;
  const index: number[] = [];
  for (const [base, flip] of [
    [0, false],
    [2 * n, true],
  ] as const) {
    for (let i = 0; i < n - 1; i++) {
      const [a, b, c, d] = [base + 2 * i, base + 2 * i + 1, base + 2 * i + 2, base + 2 * i + 3];
      index.push(...(flip ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    }
  }
  const write = (position: BufferAttribute) => {
    for (let i = 0; i < n; i++) {
      for (const base of [0, 2 * n]) {
        position.setXYZ(base + 2 * i, left.points[i].x, left.points[i].y, left.points[i].z);
        position.setXYZ(base + 2 * i + 1, right.points[i].x, right.points[i].y, right.points[i].z);
      }
    }
  };
  return { vertices: 4 * n, index, write };
}

/** A strand along `chain`: 4 corners round each point, `width` across, its sides joined point to point. */
function strandPart(chain: Chain, width: number): { vertices: number; index: number[]; write: Part['write'] } {
  const n = chain.n;
  const index: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < 4; k++) {
      const [a, b] = [4 * i + k, 4 * i + ((k + 1) % 4)];
      index.push(a, a + 4, b, b, a + 4, b + 4);
    }
  }
  const half = width / 2;
  const write = (position: BufferAttribute) => {
    for (let i = 0; i < n; i++) {
      const [from, to] = i < n - 1 ? [chain.points[i], chain.points[i + 1]] : [chain.points[i - 1], chain.points[i]];
      tangent.subVectors(to, from);
      if (tangent.lengthSq() < 1e-12) tangent.set(0, -1, 0);
      tangent.normalize();
      side.crossVectors(tangent, Math.abs(tangent.x) > 0.9 ? Z_AXIS : X_AXIS).normalize();
      up.crossVectors(side, tangent);
      for (let k = 0; k < 4; k++) {
        const [s, u] = [k === 0 || k === 3 ? half : -half, k < 2 ? half : -half];
        corner.copy(chain.points[i]).addScaledVector(side, s).addScaledVector(up, u);
        position.setXYZ(4 * i + k, corner.x, corner.y, corner.z);
      }
    }
  };
  return { vertices: 4 * n, index, write };
}

/** The meshes of `secondary`'s chains (see the file comment). */
export function createChainMeshes(secondary: Secondary, options: ChainMeshOptions): ChainMeshes {
  const rgb = toLinear(options.color ?? '#7a2430');
  const made: { name: string; vertices: number; index: number[]; write: Part['write'] }[] = [];
  if (secondary.cape) made.push({ name: 'cape', ...capePart(secondary.cape.left, secondary.cape.right) });
  if (secondary.hair) made.push({ name: 'hair', ...strandPart(secondary.hair, STRAND.hair) });
  if (secondary.tail) made.push({ name: 'tail', ...strandPart(secondary.tail, STRAND.tail) });
  const parts: Part[] = made.map(({ name, vertices, index, write }) => {
    const mesh = new Mesh(partGeometry(vertices, index, rgb), options.material);
    Object.assign(mesh, { name: `${options.name}/${name}`, castShadow: true, receiveShadow: true });
    mesh.userData.part = name;
    return { mesh, write };
  });
  return {
    meshes: parts.map((part) => part.mesh),
    update() {
      for (const { mesh, write } of parts) {
        const geometry = mesh.geometry;
        const position = geometry.getAttribute('position') as BufferAttribute;
        write(position);
        position.needsUpdate = true;
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
      }
    },
    dispose() {
      for (const { mesh } of parts) {
        mesh.geometry.dispose();
        mesh.removeFromParent();
      }
    },
  };
}
