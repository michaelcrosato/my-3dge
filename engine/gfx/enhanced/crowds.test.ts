/**
 * @file Unit tests for GPU-driven crowds (engine/gfx/enhanced/crowds.ts, crowdRegions.ts, crowdNodes.ts), the CPU's
 * half of them in Node: the feature entry, off, says what the picture loses, and needs `indirect-first-instance`; the
 * capacity a crowd starts with; a batch writes its instances as rows into its region, a whole number of blocks laid
 * end to end, and the layout, blocks and indirect arguments follow (an indexed shape's and a plain one's); a frame
 * that changes nothing uploads nothing and asks for no cull, a changed slot uploads itself alone, a turned camera asks
 * for a cull; a region that fills up doubles and moves the next, or all are packed again, keeping their instances; a
 * full buffer drops what is past it, counts it, says it is outgrown and advises once when such a frame is culled; the
 * draw calls and the meshes; the batches it refuses; the materials' copies; and a crowd made with a GPU half.
 * The cull itself runs on the GPU: tests/e2e/gpu-crowds.spec.ts reads it back.
 * @see engine/gfx/enhanced/crowds.ts
 */
import { BoxGeometry, Matrix4, MeshLambertMaterial, MeshNormalMaterial, SphereGeometry, type BufferGeometry } from 'three/webgpu'; // prettier-ignore
import { describe, expect, it } from 'vitest';
import { createLog } from '../../core/log';
import { createRegistry } from '../../core/registry';
import { createSettings } from '../../core/settings';
import { defineFeatures, resolveFeatures } from '../features';
import { createMaterialLibrary } from '../materials/library';
import { createCrowd } from '../puppets/crowd';
import { arrayOf, CROWD_ARGS } from './crowdNodes';
import { createGpuCrowd, GPU_CROWD, GPU_CROWDS_FEATURE, gpuCrowdCapacity, type CrowdCompute } from './crowds';

const adapter = { vendor: '', architecture: '', device: '', description: '', fallback: false };

/** A renderer that records each compute call's thread count. */
function recorder() {
  const calls: number[] = [];
  return { calls, renderer: { compute: (_node: never, count?: number) => calls.push(count ?? -1) } as CrowdCompute };
}

/** A log that keeps what it warns. */
function quietLog() {
  const printed: string[] = [];
  return { printed, log: createLog({ console: { warn: (line) => printed.push(line), error: () => {} } }) };
}

/** A camera at the origin looking down -Z, as three.js makes one. */
async function camera() {
  const { PerspectiveCamera } = await import('three/webgpu');
  const c = new PerspectiveCamera(60, 1, 0.1, 100);
  c.updateMatrixWorld(true);
  return c;
}

/** A matrix placing a unit shape at (x, y, z), scaled by `s`. */
const at = (x: number, y: number, z: number, s = 1) => new Matrix4().makeScale(s, s, s).setPosition(x, y, z).elements;

const material = new MeshLambertMaterial();
const shapes = (): [BufferGeometry, BufferGeometry] => [new SphereGeometry(1, 8, 6), new BoxGeometry().toNonIndexed()];

describe('feature:gpuCrowds', () => {
  it('is a feature entry, and off it says what the picture loses', () => {
    const registry = createRegistry();
    defineFeatures(registry);
    const { id, ...spec } = GPU_CROWDS_FEATURE;
    if (!registry.has('feature', id)) registry.def('feature', id, spec);
    const settings = createSettings({ registry });
    settings.set('gfx.featuresOff', [id]);
    const { printed, log } = quietLog();
    const report = resolveFeatures({ adapter, features: ['indirect-first-instance'], limits: {} }, { registry, settings, log }); // prettier-ignore
    const off = report.off.find((feature) => feature.id === id);
    expect(off).toEqual({ id, advice: spec.advice, reason: 'gfx.featuresOff lists it' });
    expect(printed.filter((line) => line.includes(spec.advice))).toEqual([expect.stringContaining(spec.downgrade)]);
  });

  it('needs indirect-first-instance: a device without it draws crowds through the instancing service', () => {
    const registry = createRegistry();
    defineFeatures(registry);
    const quiet = quietLog().log;
    const without = resolveFeatures({ adapter, features: [], limits: {} }, { registry, log: quiet });
    expect(without.off.find((feature) => feature.id === GPU_CROWDS_FEATURE.id)?.reason).toBe('the device lacks indirect-first-instance'); // prettier-ignore
    const withIt = resolveFeatures({ adapter, features: ['indirect-first-instance'], limits: {} }, { registry, log: quiet }); // prettier-ignore
    expect(withIt.on).toContain(GPU_CROWDS_FEATURE.id);
  });

  it('starts a crowd at 48 slots a body, in a power of two, within its bounds', () => {
    expect([gpuCrowdCapacity(0), gpuCrowdCapacity(100), gpuCrowdCapacity(5000)]).toEqual([4096, 8192, 262144]);
    expect(gpuCrowdCapacity(1e9)).toBe(GPU_CROWD.maximum);
    expect(createGpuCrowd({ capacity: 100 }).capacity).toBe(128); // whole blocks
  });
});

describe('a GPU crowd', () => {
  it('writes each batch into its region, as rows, and lays out the blocks, the layout and the arguments', async () => {
    const crowd = createGpuCrowd({ capacity: 4096 });
    const [ball, box] = shapes();
    const a = crowd.batch({ name: 'a', geometry: ball, material });
    const b = crowd.batch({ name: 'b', geometry: box, material, castShadow: true });
    crowd.begin(await camera());
    for (const batch of [a, b]) batch.begin();
    for (let i = 0; i < 70; i++) a.add(at(i, 0, -10), [1, 0.5, 0.25]);
    for (let i = 0; i < 3; i++) b.add(at(0, i, -10));
    for (const batch of [a, b]) batch.end();
    crowd.end();
    expect([a.count, a.capacity, b.count, b.capacity]).toEqual([70, 128, 3, 64]);
    const source = arrayOf<Float32Array>(crowd.buffers.source);
    expect(Array.from(source.subarray(16 * 69, 16 * 70))).toEqual([1, 0, 0, 69, 0, 1, 0, 0, 0, 0, 1, -10, 1, 0.5, 0.25, 1]); // prettier-ignore
    expect(a.getMatrixAt(69, new Matrix4()).elements).toEqual(at(69, 0, -10));
    expect(Array.from(arrayOf<Uint32Array>(crowd.buffers.layout).subarray(0, 8))).toEqual([0, 70, 0, 2, 128, 3, 2, 1]); // prettier-ignore
    expect(Array.from(arrayOf<Uint32Array>(crowd.buffers.blocks).subarray(0, 6))).toEqual([0, 0, 0, 64, 1, 128]);
    const args = crowd.buffers.indirect.array as Uint32Array;
    expect(Array.from(args.subarray(0, 2 * CROWD_ARGS))).toEqual([ball.getIndex()!.count, 0, 0, 0, 0, 36, 0, 0, 128, 0]); // prettier-ignore
    expect(crowd.stats()).toMatchObject({ batches: 2, instances: 73, regions: 192, blocks: 3, dropped: 0 });
    expect([a.drawCalls(1), b.drawCalls(1), b.drawCalls(0)]).toEqual([1, 2, 1]);
  });

  it('uploads only what changed, culls only when something did, and once a frame', async () => {
    const crowd = createGpuCrowd({ capacity: 4096 });
    const batch = crowd.batch({ name: 'a', geometry: shapes()[0], material });
    const view = await camera();
    const frame = (x: number) => {
      crowd.begin(view);
      batch.begin();
      for (let i = 0; i < 10; i++) batch.add(at(i === 3 ? x : i, 0, -10));
      batch.end();
      crowd.end();
    };
    const { calls, renderer } = recorder();
    frame(3);
    crowd.cull(renderer);
    crowd.cull(renderer); // a second pass of the same frame: the shadow map, then the scene
    expect(calls).toEqual([64, 64]);
    frame(3);
    crowd.cull(renderer);
    expect([crowd.stats().uploadedBytes, calls.length]).toEqual([0, 2]); // nothing changed, nothing to cull
    frame(4);
    crowd.cull(renderer);
    expect([crowd.stats().uploadedBytes, batch.stats().uploadedBytes, calls.length]).toEqual([64, 64, 4]); // one slot
    view.rotation.y = 0.3;
    view.updateMatrixWorld(true);
    frame(4);
    crowd.cull(renderer);
    expect([crowd.stats().uploadedBytes, calls.length]).toEqual([0, 6]); // the view turned: culled again
  });

  it('grows a full region by moving the next, or packs them all again, keeping every instance', async () => {
    const crowd = createGpuCrowd({ capacity: 512 });
    const [first, second] = [crowd.batch({ name: 'a', geometry: shapes()[0], material }), crowd.batch({ name: 'b', geometry: shapes()[1], material })]; // prettier-ignore
    const view = await camera();
    const frame = (n: number, m: number) => {
      crowd.begin(view);
      [first, second].forEach((batch) => batch.begin());
      for (let i = 0; i < n; i++) first.add(at(i, 1, -5));
      for (let i = 0; i < m; i++) second.add(at(i, 2, -5));
      [first, second].forEach((batch) => batch.end());
      crowd.end();
    };
    frame(10, 10);
    expect([first.capacity, second.capacity]).toEqual([64, 64]);
    frame(100, 10); // the first doubles past 64, to 128, and the second moves along
    expect([first.capacity, second.capacity, crowd.stats().regions]).toEqual([128, 64, 192]);
    expect(second.getMatrixAt(9, new Matrix4()).elements).toEqual(at(9, 2, -5));
    frame(100, 300); // the second doubles to 256, then has no room to double again: both packed again
    expect(crowd.stats()).toMatchObject({ regions: 512, dropped: 0 });
    expect([first.getMatrixAt(99, new Matrix4()).elements, second.getMatrixAt(299, new Matrix4()).elements]).toEqual([at(99, 1, -5), at(299, 2, -5)]); // prettier-ignore
  });

  it('drops what a full buffer cannot hold, says it is outgrown, and advises once when such a frame is culled', async () => {
    const { printed, log } = quietLog();
    const crowd = createGpuCrowd({ capacity: 128, log });
    const batch = crowd.batch({ name: 'a', geometry: shapes()[0], material });
    const view = await camera();
    for (const round of [0, 1]) {
      crowd.begin(view);
      batch.begin();
      for (let i = 0; i < 200; i++) batch.add(at(i, round, -5));
      batch.end();
      crowd.end();
      crowd.cull(recorder().renderer);
    }
    expect([batch.count, crowd.stats().dropped, crowd.outgrown]).toEqual([128, 72, true]);
    expect(printed.filter((line) => line.includes('GFX_GPU_CROWD_FULL'))).toHaveLength(1);
  });

  it('draws each batch through one mesh of its own, sharing its shape, and refuses what it cannot draw', () => {
    const crowd = createGpuCrowd();
    const [ball] = shapes();
    const batch = crowd.batch({
      name: 'crowd/puppets/ball',
      geometry: ball,
      material,
      castShadow: true,
      renderOrder: 2,
    });
    const mesh = crowd.objects()[0] as unknown as { name: string; geometry: BufferGeometry; frustumCulled: boolean; visible: boolean; count: number; castShadow: boolean; renderOrder: number }; // prettier-ignore
    expect([mesh.name, mesh.frustumCulled, mesh.visible, mesh.count, mesh.castShadow, mesh.renderOrder]).toEqual(['crowd/puppets/ball/gpu', false, false, 1, true, 2]); // prettier-ignore
    expect(mesh.geometry.getAttribute('position')).toBe(ball.getAttribute('position'));
    expect(mesh.geometry.getIndex()).toBe(ball.getIndex());
    expect(mesh.geometry.indirect).toBe(crowd.buffers.indirect);
    expect(batch.pages).toEqual([]);
    expect(batch.root.children[0]).toBe(mesh);
    const refused = (options: object) => {
      try {
        crowd.batch({ name: 'x', geometry: ball, material, ...options });
      } catch (error) {
        return (error as { code: string }).code;
      }
      return null;
    };
    expect(refused({ attributes: { tint: 3 } })).toBe('GFX_GPU_CROWD_BATCH');
    expect(refused({ material: [material, material] })).toBe('GFX_GPU_CROWD_BATCH');
    expect(() => batch.setAttributeAt('tint', 0, [1])).toThrow(/GPU crowd batch/);
    expect(() => batch.setMatrixAt(-1, new Matrix4())).toThrow(/no slot -1/);
  });

  it('draws with one copy of each material, which reads the instance, the source left as it was', () => {
    const quiet = quietLog();
    const crowd = createGpuCrowd({ log: quiet.log });
    const library = createMaterialLibrary();
    const lit = library.get('material:puppet');
    const [ball, box] = shapes();
    crowd.batch({ name: 'a', geometry: ball, material: lit });
    crowd.batch({ name: 'b', geometry: box, material: lit });
    const [a, b] = crowd.objects() as unknown as { material: { positionNode: unknown; userData: { material: string } }; userData: { restyle(m: unknown): unknown } }[]; // prettier-ignore
    expect(a.material).toBe(b.material); // the batches of one material share it, and its pipelines
    expect(a.material).not.toBe(lit);
    expect([a.material.positionNode !== null, (lit as unknown as { positionNode?: unknown }).positionNode ?? null]).toEqual([true, null]); // prettier-ignore
    expect(a.material.userData.material).toBe('material:puppet'); // the style set re-points it by its entry
    expect([a.userData.restyle(lit), a.userData.restyle(a.material)]).toEqual([a.material, a.material]);
    const normals = new MeshNormalMaterial(); // three.js has no node material for it: kept, and said once
    expect([a.userData.restyle(normals), a.userData.restyle(normals)]).toEqual([a.material, a.material]);
    expect(quiet.printed.filter((line) => line.includes('GFX_GPU_CROWD_BATCH'))).toHaveLength(1);
  });

  it('is what a crowd made with it draws through: every batch, the warm-up and the frame', async () => {
    const half = createGpuCrowd();
    const crowd = createCrowd({ materials: createMaterialLibrary(), gpu: half });
    expect(crowd.gpu).toBe(half);
    expect(crowd.shadows!.batch.pages).toEqual([]); // made through the GPU half
    const entries: (() => readonly unknown[])[] = [];
    crowd.register({ register: (_id, entry) => (entries.push(() => entry.objects()), { dispose() {} }) });
    expect(entries[0]()).toEqual(half.objects());
    crowd.begin(await camera());
    crowd.shadows!.add(0, 0, -5, 0.4);
    crowd.end();
    expect(half.stats()).toMatchObject({ instances: 1, blocks: 1 });
  });
});
