/**
 * @file GPU-driven crowds (PLAN.md WP 11.4, stage 1): the technique `feature:gpuCrowds`, a crowd's batches
 * (engine/gfx/puppets/crowd.ts) each drawn in one indirect draw whose instances a compute pass chose, testing every
 * instance against the frame's view; the instancing service (engine/gfx/instancing.ts), a draw a page, stays the
 * fallback. `createGpuCrowd({ capacity })` is the crowd's half on the GPU, handed out by engine/gfx/features.ts
 * (`gpuCrowdsFor`) while the feature is on; `createCrowd({ gpu })` makes its batches through `batch`, which stands in
 * for `createInstancedBatch` (an `InstancedBatch` without pages: `begin`, `add`, `end` and the slot methods).
 * - **One buffer, one draw a batch.** The CPU writes each batch's instances into the batch's region of one storage
 *   buffer, as the instancing service writes its pages (engine/gfx/enhanced/crowdRegions.ts: only changed slots are
 *   uploaded). Each batch draws one `Mesh` (`<batch>/gpu`) through r182's `BufferGeometry.setIndirect`, its first
 *   instance its region's start (the adapter feature `indirect-first-instance`), its instance count the cull's. A
 *   frame that writes more than the buffer holds leaves the instances past it out, counted (`stats().dropped`), with
 *   advice `GFX_GPU_CROWD_FULL` once if such a frame is drawn; `outgrown` asks the owner for a larger buffer
 *   (engine/gfx/stageCrowd.ts makes one, twice the size, before the frame draws).
 * - **The cull runs at most once a frame,** before the first pass that draws a batch (its mesh's `onBeforeRender`:
 *   the shadow map, the scene, a shot's ID pass), and only when an instance, a region or the view changed: two compute
 *   calls over the blocks in use (engine/gfx/enhanced/crowdNodes.ts). It tests against the planes of the camera
 *   `begin` was given, the frame's, so the shadow map draws what the view keeps, as the CPU path's shadow map draws
 *   what its level of detail keeps.
 * - **Counts:** `drawCalls` is a call a batch with instances, again per shadow map for casting ones; the renderer
 *   counts the triangles of every instance written (the cull's survivors are never read back).
 *
 * Invariants: presentation only, never in the hash, nothing read back; the buffers are made once at `capacity`; a
 * batch's instances keep the order they were written in, culled or not; a style's material a batch cannot draw
 * leaves it its own, with advice `GFX_GPU_CROWD_BATCH` once; nothing but engine/gfx/features.ts imports this module.
 *
 * @example
 * GPU_CROWDS_FEATURE.needs; // ['indirect-first-instance']
 * gpuCrowdCapacity(5000); // 262144: 48 slots a body, in a power of two
 * // const crowd = createCrowd({ materials: library, gpu: createGpuCrowd({ capacity: gpuCrowdCapacity(5000) }) });
 * @see engine/gfx/enhanced/crowds.test.ts
 * @see tests/e2e/gpu-crowds.spec.ts
 */
import { BufferGeometry, Frustum, Group, Matrix4, Mesh, type Camera, type Material, type Object3D } from 'three/webgpu'; // prettier-ignore
import { codeError, defineCodes, log as sharedLog, type Log } from '../../core/log';
import type { InstancedBatch, InstancedBatchOptions } from '../instancing';
import type { Warmup } from '../warmup';
import { arrayOf, createCrowdBuffers, createCrowdCull, createCrowdLook, CROWD_ARGS, CROWD_BLOCK, upload, type CrowdBuffers } from './crowdNodes'; // prettier-ignore
import { createCrowdRegions, type CrowdRegion } from './crowdRegions';

/** Its codes: the advice the feature registry raises while it is off, a full buffer's, and a batch it cannot draw. */
export const GPU_CROWDS_CODES = defineCodes('gfx', {
  GFX_NO_GPU_CROWDS: {
    template: '{feature} is off: {reason}; {downgrade}',
    fix: 'nothing to do for play; take the feature out of gfx.featuresOff if it is listed there, or use a GPU with indirect-first-instance',
    doc: 'Advice from the feature registry (engine/gfx/features.ts) while GPU-driven crowds are off: crowds draw through the instancing service, a draw call per page of each batch.',
  },
  GFX_GPU_CROWD_FULL: {
    template: 'a GPU crowd of {capacity} slots was given {wanted} instances; {dropped} were left out of a frame',
    fix: 'make the GPU crowd with a larger capacity (createGpuCrowd({ capacity })); the stage makes its own crowd larger by itself',
    doc: 'Advice from a GPU crowd (engine/gfx/enhanced/crowds.ts), once: a frame drawn wrote more instances than its buffer holds, so the ones past it were not drawn.',
  },
  GFX_GPU_CROWD_BATCH: {
    template: 'GPU crowd batch {name}: {problem}',
    fix: '{fix}',
    doc: 'Raised by a GPU crowd (engine/gfx/enhanced/crowds.ts) for a batch it cannot draw (per-instance attributes, an array of materials, a material three.js has no node material for, more batches than it holds) or a slot that is negative or fractional; advice, once, when a style set gives a batch a material it cannot draw, which keeps its own.',
  },
});

/**
 * Its numbers: the batches a crowd holds, the slots a body is given at first, and the smallest and largest buffers
 * (the cull dispatches a workgroup a block along one dimension, of which WebGPU allows 65,535).
 */
export const GPU_CROWD = { batches: 64, perBody: 48, minimum: 4096, maximum: 65_535 * CROWD_BLOCK } as const;

/** Its feature entry (engine/gfx/features.ts registers it). */
export const GPU_CROWDS_FEATURE = {
  id: 'feature:gpuCrowds',
  description:
    "GPU-driven crowds: each crowd batch drawn in one indirect draw, its instances culled against the view in compute (engine/gfx/enhanced/crowds.ts), in place of the instancing service's draw a page.",
  needs: ['indirect-first-instance'],
  advice: 'GFX_NO_GPU_CROWDS',
  downgrade:
    'crowds draw through the instancing service, a draw call per page of each batch, culled by body on the CPU',
} as const;

/** The slots a GPU crowd for `bodies` bodies starts with: `GPU_CROWD.perBody` each, a power of two, at least the minimum. */
export function gpuCrowdCapacity(bodies: number): number {
  const wanted = Math.max(GPU_CROWD.minimum, Math.ceil(bodies) * GPU_CROWD.perBody);
  return Math.min(GPU_CROWD.maximum, 2 ** Math.ceil(Math.log2(wanted)));
}

/** What a GPU crowd holds and did: its batches, instances and slots, the cull's blocks, culls run, the last frame's. */
export interface GpuCrowdStats {
  batches: number;
  instances: number;
  capacity: number;
  /** Slots its regions take. */
  regions: number;
  /** Blocks the next cull covers. */
  blocks: number;
  /** Culls run so far. */
  culls: number;
  /** Bytes the last frame uploaded, and instances it left out. */
  uploadedBytes: number;
  dropped: number;
}

/** What runs the cull: the renderer, as far as the crowd uses it. */
export interface CrowdCompute {
  compute(node: never, count?: number): unknown;
}

/** A crowd's half on the GPU (see the file comment). */
export interface GpuCrowd {
  /** Makes a batch drawn through it: `createInstancedBatch`'s options, without per-instance attributes. */
  batch(options: InstancedBatchOptions): InstancedBatch;
  /** Starts a frame seen through `camera`: the planes the cull tests against. */
  begin(camera: Camera): void;
  /** Ends the frame its batches wrote (after their own `end`): the layout, the uploads, the cull asked for. */
  end(): void;
  /** Runs the cull if the frame asks for it (each mesh calls it before it draws). */
  cull(renderer: CrowdCompute): void;
  /** Its meshes, for the warm-up. */
  objects(): readonly Object3D[];
  /** Whether the last frame wrote more instances than it holds. */
  readonly outgrown: boolean;
  readonly capacity: number;
  /** Its buffers (crowdNodes.ts), for tests that read them back. */
  readonly buffers: CrowdBuffers;
  stats(): GpuCrowdStats;
  dispose(): void;
}

/** `geometry`'s attributes, index and bounds, shared, on a geometry of the batch's own (it carries the indirect draw). */
function shared(geometry: BufferGeometry): BufferGeometry {
  const own = new BufferGeometry();
  own.setIndex(geometry.getIndex());
  for (const [key, attribute] of Object.entries(geometry.attributes)) own.setAttribute(key, attribute);
  geometry.computeBoundingSphere();
  own.boundingSphere = geometry.boundingSphere;
  return own;
}

/** Makes a crowd's half on the GPU, `capacity` slots rounded up to whole blocks (see the file comment). */
export function createGpuCrowd(options: { capacity?: number; log?: Log } = {}): GpuCrowd {
  const log = options.log ?? sharedLog;
  const asked = Math.min(GPU_CROWD.maximum, Math.max(CROWD_BLOCK, options.capacity ?? GPU_CROWD.minimum));
  const capacity = Math.ceil(asked / CROWD_BLOCK) * CROWD_BLOCK;
  const buffers = createCrowdBuffers(capacity, GPU_CROWD.batches);
  const regions = createCrowdRegions(buffers);
  const cull = createCrowdCull(buffers);
  const look = createCrowdLook(buffers);
  const spheres = arrayOf<Float32Array>(buffers.spheres);
  const meshes: Mesh[] = [];
  const frustum = new Frustum();
  const view = new Matrix4();
  const planes = new Float64Array(24).fill(NaN);
  let [pending, outgrown, wanted, dropped, used, culls, uploaded] = [true, false, 0, 0, 0, 0, 0];

  const fail = (name: string, problem: string, fix: string) => codeError('GFX_GPU_CROWD_BATCH', { name, problem, fix });
  /** `slot` checked: a whole number of at least 0. Throws `GFX_GPU_CROWD_BATCH`. */
  const checked = (name: string, slot: number) => {
    if (!Number.isInteger(slot) || slot < 0) throw fail(name, `it has no slot ${slot}`, 'pass a whole slot number of at least 0'); // prettier-ignore
    return slot;
  };

  /** Makes batch `options` (see `GpuCrowd.batch`). Throws `GFX_GPU_CROWD_BATCH`. */
  const makeBatch = (batchOptions: InstancedBatchOptions): InstancedBatch => {
    const { name, geometry, material } = batchOptions;
    if (Object.keys(batchOptions.attributes ?? {}).length) throw fail(name, 'it asks for per-instance attributes', 'draw it through the instancing service (createInstancedBatch)'); // prettier-ignore
    if (Array.isArray(material)) throw fail(name, 'it has an array of materials', 'give it one material');
    if (regions.list.length >= GPU_CROWD.batches) throw fail(name, `a GPU crowd holds ${GPU_CROWD.batches} batches`, 'share batches between bodies, or make another crowd'); // prettier-ignore
    const drawn = look.wrap(material);
    if (!drawn) throw fail(name, `three.js has no node material for a ${material.type}`, 'give it a mesh material three.js turns into a node material (Lambert, Phong, standard, toon, basic or a node material)'); // prettier-ignore
    const own = shared(geometry);
    const index = own.getIndex();
    const region: CrowdRegion = regions.add(index ? index.count : own.getAttribute('position').count, index !== null);
    own.setIndirect(buffers.indirect, region.index * CROWD_ARGS * 4);
    const { center, radius } = own.boundingSphere!;
    spheres.set([center.x, center.y, center.z, radius], region.index * 4);
    upload(buffers.spheres, region.index * 4, 4);
    const mesh = new Mesh(own, drawn);
    const { castShadow = false, receiveShadow = false, renderOrder = 0 } = batchOptions;
    Object.assign(mesh, { name: `${name}/gpu`, count: 1, visible: false, frustumCulled: false, castShadow, receiveShadow, renderOrder }); // prettier-ignore
    /** A style's material it cannot draw: the batch keeps its own and says so, once a material type. */
    const keep = (worn: Material) => {
      log.warnOnce('GFX_GPU_CROWD_BATCH', { name, problem: `three.js has no node material for a ${worn.type}, so it keeps its own`, fix: 'give the style set a mesh material three.js turns into a node material (Lambert, Phong, standard, toon, basic or a node material)' }, `${name}:${worn.type}`); // prettier-ignore
      return mesh.material;
    };
    mesh.userData = { batch: name, restyle: (worn: Material) => look.wrap(worn) ?? keep(worn) };
    mesh.onBeforeRender = (renderer) => crowd.cull(renderer as unknown as CrowdCompute);
    meshes.push(mesh);
    const root = new Group();
    root.name = name;
    root.add(mesh);
    const registrations = new Set<{ dispose(): void }>();
    const batch: InstancedBatch = {
      name,
      root,
      pages: [],
      get pageSlots() {
        return region.slots;
      },
      get capacity() {
        return region.slots;
      },
      get count() {
        return region.count;
      },
      set count(value) {
        const n = Math.max(0, Math.ceil(value));
        region.count = n > 0 && regions.at(region, n - 1) < 0 ? region.slots : n;
      },
      begin() {
        region.count = 0;
      },
      add(matrix, color, offset = 0) {
        const slot = region.count;
        wanted++;
        if (!regions.write(region, slot, matrix, offset, color)) return (dropped++, slot);
        region.count = slot + 1;
        return slot;
      },
      setMatrixAt(slot, matrix) {
        regions.writeMatrix(region, checked(name, slot), 'elements' in matrix ? matrix.elements : matrix);
      },
      getMatrixAt(slot, out) {
        if (checked(name, slot) >= region.slots) throw fail(name, `it has no slot ${slot}`, `pass a slot below ${region.slots}`); // prettier-ignore
        return regions.matrixAt(region, slot, out);
      },
      setColorAt(slot, color) {
        regions.writeColor(region, checked(name, slot), color);
      },
      setAttributeAt(key) {
        throw fail(name, `it has no per-instance attribute ${key}`, 'a GPU crowd batch carries none: draw it through the instancing service (createInstancedBatch)'); // prettier-ignore
      },
      end() {
        if (region.count !== region.shown) [region.shown, regions.laid] = [region.count, true];
        mesh.count = Math.max(1, region.shown);
        mesh.visible = region.shown > 0;
      },
      drawCalls(shadowMaps = 0) {
        return region.shown > 0 ? 1 + (castShadow ? shadowMaps : 0) : 0;
      },
      stats() {
        const bytes = region.uploaded;
        return { pages: 0, capacity: region.slots, count: region.count, uploadedPages: bytes ? 1 : 0, uploadedBytes: bytes }; // prettier-ignore
      },
      register(warmup: Pick<Warmup, 'register'>, id = `batch:${name}`) {
        const entry = warmup.register(id, { objects: () => [mesh] });
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
        [region.gone, region.count, region.shown, regions.laid] = [true, 0, 0, true];
        meshes.splice(meshes.indexOf(mesh), 1);
        own.dispose();
        root.removeFromParent();
      },
    };
    return batch;
  };

  const crowd: GpuCrowd = {
    capacity,
    buffers,
    get outgrown() {
      return outgrown;
    },
    batch: makeBatch,
    begin(camera) {
      camera.updateWorldMatrix(true, false);
      view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(view, camera.coordinateSystem, camera.reversedDepth);
      frustum.planes.forEach(({ normal, constant }, p) => {
        const values = [normal.x, normal.y, normal.z, constant];
        values.forEach((value, k) => {
          if (planes[p * 4 + k] !== value) [planes[p * 4 + k], pending] = [value, true];
        });
        buffers.planes[p].set(values[0], values[1], values[2], values[3]);
      });
      [wanted, dropped] = [0, 0];
    },
    end() {
      if (regions.laid) [used, pending] = [regions.lay(), true];
      uploaded = regions.flush();
      if (uploaded > 0) pending = true;
      outgrown = dropped > 0 && capacity < GPU_CROWD.maximum;
    },
    cull(renderer) {
      if (!pending) return;
      pending = false;
      culls++;
      if (dropped > 0) log.warnOnce('GFX_GPU_CROWD_FULL', { capacity, wanted, dropped });
      const threads = Math.max(1, used) * CROWD_BLOCK;
      renderer.compute(cull.count as never, threads);
      renderer.compute(cull.scatter as never, threads);
    },
    objects: () => meshes,
    stats() {
      const live = regions.list.filter((region) => !region.gone);
      const instances = live.reduce((sum, region) => sum + region.shown, 0);
      return { batches: live.length, instances, capacity, regions: regions.taken(), blocks: used, culls, uploadedBytes: uploaded, dropped }; // prettier-ignore
    },
    dispose() {
      for (const mesh of meshes.splice(0)) {
        mesh.geometry.dispose();
        mesh.removeFromParent();
      }
      cull.dispose();
      look.dispose();
    },
  };
  return crowd;
}
