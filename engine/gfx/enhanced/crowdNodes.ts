/**
 * @file GPU-driven crowds' programs (PLAN.md WP 11.4): the buffers a GPU crowd (engine/gfx/enhanced/crowds.ts) keeps,
 * the cull's two compute passes over them, and the material copies its meshes draw with. Split from crowds.ts, which
 * owns the CPU's half (the batches, their regions, the uploads) and says when the passes run.
 * - **The buffers** (`createCrowdBuffers`), each named, so every shader that reads them is the same text and the
 *   batches of one material share their pipelines, as the instancing service's pages do: `crowdSource`, the CPU's
 *   instances (4 vec4 a slot: the rows of a 3 × 4 matrix, then the colour), in each batch's region; `crowdDrawn`, the
 *   instances kept, in the same regions; `crowdBlocks`, each block of 64 slots the cull covers (its batch, its first
 *   slot); `crowdCounts`, the instances each block keeps; `crowdLayout`, each batch's region (start, instances, first
 *   block, blocks); `crowdSpheres`, each batch's bounding sphere in its shape's own frame; `crowdArgs`, five words of
 *   indirect arguments a batch; and the frame camera's six planes.
 * - **The cull** (`createCrowdCull`): a workgroup a block. `count` tests each slot's sphere (its shape's, through the
 *   slot's matrix, the radius by its longest axis) against the planes, as three.js's `Frustum.intersectsSphere` does,
 *   and writes how many of the block's slots it keeps; `scatter` tests them again, sums the counts of its batch's
 *   blocks before it into its offset, copies each kept slot to its batch's region of `crowdDrawn` at the offset plus
 *   its rank among the block's kept slots, so the order is the CPU's, and its batch's last block writes the batch's
 *   instance count. No atomics: the barriers sit in uniform control flow, nothing returns before them.
 * - **The look** (`createCrowdLook`): `wrap(material)` is a node copy (engine/gfx/materials/nodeCopy.ts) made once per
 *   material, whose `positionNode` places the vertex by the instance's matrix (three.js copies it to the ID pass's and
 *   the shadow pass's materials), whose `normalNode` turns the normal by it (in view space, as the lighting reads it),
 *   and whose `colorNode` is the instance's colour times the material's, as r182's instancing multiplies them. The
 *   instance is `crowdDrawn`'s slot `instanceIndex`: the indirect draw's first instance is the region's start.
 *
 * Invariants: presentation only; nothing is read back; the passes write only `crowdCounts`, `crowdDrawn` and the
 * arguments' instance counts; a copy draws a slot as the instancing service draws the same instance.
 *
 * @example
 * // const buffers = createCrowdBuffers(4096); const cull = createCrowdCull(buffers);
 * // renderer.compute(cull.count, blocks * CROWD_BLOCK); renderer.compute(cull.scatter, blocks * CROWD_BLOCK);
 * // mesh.material = createCrowdLook(buffers).wrap(library.get('material:puppet'));
 * @see engine/gfx/enhanced/crowds.test.ts
 * @see tests/e2e/gpu-crowds.spec.ts
 */
import { Vector4, type Material, type Node, type NodeMaterial } from 'three/webgpu';
import { Fn, If, instanceIndex, instancedArray, invocationLocalIndex, Loop, mat4, materialColor, max, normalGeometry, positionGeometry, select, storage, transformNormal, transformNormalToView, uint, uniformArray, vec3, vec4, workgroupArray, workgroupBarrier, workgroupId } from 'three/tsl'; // prettier-ignore
import { IndirectStorageBufferAttribute } from 'three/webgpu';
import { nodeCopy } from '../materials/nodeCopy';

/** Slots a block holds: one workgroup of the cull. */
export const CROWD_BLOCK = 64;

/** Words of indirect arguments a batch: drawIndexedIndirect's five (drawIndirect's four, then one unused). */
export const CROWD_ARGS = 5;

/** A TSL node, as these programs build them. */
type N = Node;

/** A GPU crowd's buffers (see the file comment): their nodes, and the CPU's arrays of those it writes. */
export interface CrowdBuffers {
  /** Instances the regions may hold, in slots. */
  readonly capacity: number;
  /** Batches the arguments and layout hold. */
  readonly batches: number;
  readonly source: N;
  readonly drawn: N;
  readonly blocks: N;
  readonly counts: N;
  readonly layout: N;
  readonly spheres: N;
  readonly args: N;
  /** The indirect arguments, `CROWD_ARGS` words a batch: what each batch's geometry draws by. */
  readonly indirect: IndirectStorageBufferAttribute;
  /** The frame camera's planes: normal and constant, as three.js's `Plane`. */
  readonly planes: Vector4[];
  readonly planesNode: N;
}

/** The array a storage node holds. */
export function arrayOf<T extends Float32Array | Uint32Array>(node: N): T {
  return (node as unknown as { value: { array: T } }).value.array;
}

/** Marks `count` items of a storage node's array from `start` (in array elements) for the next upload. */
export function upload(node: N | IndirectStorageBufferAttribute, start: number, count: number): void {
  const attribute = ('isNode' in node ? (node as unknown as { value: IndirectStorageBufferAttribute }).value : node) as IndirectStorageBufferAttribute; // prettier-ignore
  if (count <= 0) return;
  attribute.addUpdateRange(start, count);
  attribute.needsUpdate = true;
}

/** Makes a GPU crowd's buffers for `capacity` slots (a whole number of blocks) and `batches` batches. */
export function createCrowdBuffers(capacity: number, batches: number): CrowdBuffers {
  const blocks = capacity / CROWD_BLOCK;
  const indirect = new IndirectStorageBufferAttribute(new Uint32Array(batches * CROWD_ARGS), 1);
  const planes = Array.from({ length: 6 }, () => new Vector4());
  const named = (node: unknown, name: string) => (node as { setName(name: string): N }).setName(name);
  return {
    capacity,
    batches,
    source: named(instancedArray(capacity * 4, 'vec4'), 'crowdSource'),
    drawn: named(instancedArray(capacity * 4, 'vec4'), 'crowdDrawn'),
    blocks: named(instancedArray(blocks, 'uvec2'), 'crowdBlocks'),
    counts: named(instancedArray(blocks, 'uint'), 'crowdCounts'),
    layout: named(instancedArray(batches, 'uvec4'), 'crowdLayout'),
    spheres: named(instancedArray(batches, 'vec4'), 'crowdSpheres'),
    args: named(storage(indirect, 'uint', batches * CROWD_ARGS), 'crowdArgs'),
    indirect,
    planes,
    planesNode: named(uniformArray(planes, 'vec4'), 'crowdPlanes'),
  };
}

/** The cull's two passes (see the file comment), each dispatched a workgroup a block. */
export interface CrowdCull {
  readonly count: Node;
  readonly scatter: Node;
  dispose(): void;
}

/** Whether `slot` of `batch` (its `region`) is an instance whose sphere touches the frame camera's view: 1 or 0. */
function kept(b: CrowdBuffers, slot: N, batch: N, region: N): N {
  const row = (k: number) => b.source.element(slot.mul(4).add(k)) as N;
  const [r0, r1, r2] = [row(0), row(1), row(2)];
  const sphere = b.spheres.element(batch) as N;
  const at = (r: N) => r.xyz.dot(sphere.xyz).add(r.w);
  const centre = vec3(at(r0), at(r1), at(r2)) as unknown as N;
  const axis = (a: 'x' | 'y' | 'z') => (vec3(r0[a], r1[a], r2[a]) as unknown as N).length();
  const reach = (sphere.w.mul(max(axis('x'), max(axis('y'), axis('z')))) as N).negate();
  let inside = slot.lessThan(region.x.add(region.y));
  for (let p = 0; p < 6; p++) {
    const plane = b.planesNode.element(uint(p)) as N;
    inside = inside.and(plane.xyz.dot(centre).add(plane.w).greaterThanEqual(reach));
  }
  return select(inside, uint(1), uint(0)) as unknown as N;
}

/** Makes the cull's passes over `b` (see the file comment). */
export function createCrowdCull(b: CrowdBuffers): CrowdCull {
  /** The block this workgroup covers, its batch, its slot for this invocation and its batch's region. */
  const where = () => {
    const block = workgroupId.x as unknown as N;
    const lid = invocationLocalIndex as unknown as N;
    const entry = b.blocks.element(block) as N;
    const batch = entry.x;
    return { block, lid, batch, slot: entry.y.add(lid), region: b.layout.element(batch) as N };
  };
  const count = Fn(() => {
    const flags = workgroupArray('uint', CROWD_BLOCK) as unknown as N;
    const { block, lid, batch, slot, region } = where();
    flags.element(lid).assign(kept(b, slot, batch, region));
    workgroupBarrier();
    If(lid.equal(uint(0)), () => {
      const sum = uint(0).toVar() as unknown as N;
      Loop({ start: uint(0), end: uint(CROWD_BLOCK), type: 'uint' }, ({ i }: { i: N }) => {
        sum.addAssign(flags.element(i));
      });
      b.counts.element(block).assign(sum);
    });
  })()
    .compute(b.capacity, [CROWD_BLOCK])
    .setName('Count the crowd in view');
  const scatter = Fn(() => {
    const flags = workgroupArray('uint', CROWD_BLOCK) as unknown as N;
    const offset = workgroupArray('uint', 1) as unknown as N;
    const { block, lid, batch, slot, region } = where();
    const mine = kept(b, slot, batch, region).toVar() as unknown as N;
    flags.element(lid).assign(mine);
    workgroupBarrier();
    If(lid.equal(uint(0)), () => {
      const before = uint(0).toVar() as unknown as N;
      Loop({ start: region.z, end: block, type: 'uint' }, ({ i }: { i: N }) => {
        before.addAssign(b.counts.element(i));
      });
      offset.element(uint(0)).assign(before);
      If(block.equal(region.z.add(region.w).sub(uint(1))), () => {
        b.args.element(batch.mul(uint(CROWD_ARGS)).add(uint(1))).assign(before.add(b.counts.element(block)));
      });
    });
    workgroupBarrier();
    If(mine.equal(uint(1)), () => {
      const rank = uint(0).toVar() as unknown as N;
      Loop({ start: uint(0), end: lid, type: 'uint' }, ({ i }: { i: N }) => {
        rank.addAssign(flags.element(i));
      });
      const to = region.x.add(offset.element(uint(0))).add(rank);
      for (let k = 0; k < 4; k++) b.drawn.element(to.mul(4).add(k)).assign(b.source.element(slot.mul(4).add(k)));
    });
  })()
    .compute(b.capacity, [CROWD_BLOCK])
    .setName('Keep the crowd in view');
  return {
    count,
    scatter,
    dispose() {
      for (const pass of [count, scatter]) (pass as unknown as { dispose(): void }).dispose();
    },
  };
}

/** A GPU crowd's materials (see the file comment). */
export interface CrowdLook {
  /**
   * `material`'s copy that draws the crowd's instances, made once; one of its own copies is given back as it is;
   * null for a material three.js has no node material for.
   */
  wrap(material: Material): Material | null;
  /** Whether `material` is one of its copies. */
  owns(material: Material): boolean;
  dispose(): void;
}

/** Makes a GPU crowd's materials over `b` (see the file comment). */
export function createCrowdLook(b: CrowdBuffers): CrowdLook {
  const copies = new Map<Material, NodeMaterial>();
  const own = new Set<Material>();
  const row = (k: number) => b.drawn.element(instanceIndex.mul(4).add(k)) as N;
  const matrix = Fn(() => {
    const [r0, r1, r2] = [row(0), row(1), row(2)];
    return mat4(r0.x, r1.x, r2.x, 0, r0.y, r1.y, r2.y, 0, r0.z, r1.z, r2.z, 0, r0.w, r1.w, r2.w, 1);
  })();
  const position = matrix.mul(vec4(positionGeometry, 1)).xyz;
  const normal = transformNormalToView(transformNormal(normalGeometry, matrix)).toVarying('vCrowdNormal').normalize();
  const colour = vec4(row(3).xyz.toVarying('vCrowdColour'), 1);
  return {
    wrap(material) {
      if (own.has(material)) return material;
      let copy = copies.get(material);
      if (copy) return copy;
      copy = nodeCopy(material) ?? undefined;
      if (!copy) return null;
      const source = material as Partial<NodeMaterial>;
      Object.assign(copy, {
        positionNode: position,
        normalNode: normal,
        colorNode: colour.mul(vec4((source.colorNode as Node | null | undefined) ?? materialColor)),
      });
      copies.set(material, copy);
      own.add(copy);
      return copy;
    },
    owns: (material) => own.has(material),
    dispose() {
      for (const copy of copies.values()) copy.dispose();
      copies.clear();
      own.clear();
    },
  };
}
