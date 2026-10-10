/**
 * @file Unit tests for the warm-up registry (`engine/gfx/warmup.ts`) on three.js objects in Node, with a stand-in
 * renderer that records each `compileAsync`: the shader key follows fog, shadows, lights, entries and key parts;
 * a run compiles step by step for the frame's real target, with progress, makes each registered object drawable
 * without showing it, draws the warm frame and puts everything back, also when it fails. That the real renderer
 * then builds 0 pipelines is proven by tests/e2e/renderer.spec.ts.
 */
import {
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  RenderTarget,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type WebGPURenderer,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createWarmup } from './warmup';

/** A stand-in renderer: each `compileAsync` and `render` builds one pipeline and records what it saw. */
function setup(options: { failCompile?: boolean } = {}) {
  let built = 0;
  const compiles: { target: RenderTarget | null; sparks: number; flagsShown: boolean; culled: boolean }[] = [];
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const sparks = new InstancedMesh(new SphereGeometry(0.1), new MeshBasicMaterial(), 8);
  sparks.count = 0;
  const flags = new Group();
  flags.visible = false;
  const flag = new Mesh(new SphereGeometry(0.2), new MeshBasicMaterial());
  flags.add(flag);
  scene.add(sparks, flags, new DirectionalLight());
  const fake = {
    needsFrameBufferTarget: true,
    getOutputBufferType: () => HalfFloatType,
    depth: true,
    stencil: false,
    samples: 0,
    shadowMap: { enabled: true, type: PCFShadowMap },
    toneMapping: NoToneMapping,
    outputColorSpace: SRGBColorSpace,
    target: null as RenderTarget | null,
    getRenderTarget: () => fake.target,
    setRenderTarget: (target: RenderTarget | null) => void (fake.target = target),
    async compileAsync() {
      if (options.failCompile) throw new Error('compile failed');
      built++;
      compiles.push({
        target: fake.target,
        sparks: sparks.count,
        flagsShown: flags.visible && flags.scale.x === 0,
        culled: sparks.frustumCulled || flag.frustumCulled,
      });
    },
    render: () => void built++,
  };
  const counter = { count: () => ({ built, render: built, compute: 0, shaders: 0, cached: null }) };
  const warmup = createWarmup({ renderer: fake as unknown as WebGPURenderer, counter });
  return { fake, warmup, scene, camera, sparks, flags, flag, compiles, built: () => built };
}

describe('the shader key', () => {
  it('changes with fog, shadows, lights, entries and key parts, and only then', () => {
    const { fake, warmup, scene, flag } = setup();
    const keys = new Set([warmup.key(scene)]);
    expect(warmup.key(scene), 'stable').toBe([...keys][0]);
    const changes: [string, () => void][] = [
      ['linear fog', () => (scene.fog = new Fog(0, 1, 10))],
      ['exponential fog', () => (scene.fog = new FogExp2(0, 0.1))],
      ['shadows off', () => (fake.shadowMap.enabled = false)],
      ['a light', () => scene.add(new PointLight())],
      ['a shadow caster', () => (scene.children[2].castShadow = true)],
      ['an entry', () => warmup.register('pool:flags', { objects: () => [flag] })],
      ['a key part', () => warmup.keyPart('filters', () => 'pixel,grade')],
    ];
    for (const [what, change] of changes) {
      change();
      const key = warmup.key(scene);
      expect(keys.has(key), `${what} changes the key: ${key}`).toBe(false);
      keys.add(key);
    }
    const hidden = new PointLight();
    hidden.visible = false;
    scene.add(hidden);
    expect(keys.has(warmup.key(scene)), 'a hidden light draws nothing: same key').toBe(true);
  });

  it('refuses a second entry under one id', () => {
    const { warmup, flag } = setup();
    const entry = warmup.register('pool:flags', { objects: () => [flag] });
    expect(() => warmup.register('pool:flags', { objects: () => [] })).toThrow(/GFX_DUPLICATE_WARMUP/);
    entry.dispose();
    expect(() => warmup.register('pool:flags', { objects: () => [] })).not.toThrow();
  });
});

describe('run', () => {
  it('compiles step by step for the frame target, with progress, then draws the warm frame', async () => {
    const { warmup, scene, camera, sparks, flag, compiles } = setup();
    warmup.register('pool:sparks', { objects: () => [sparks] });
    warmup.register('pool:flags', { objects: () => [flag] });
    const key = warmup.key(scene);
    const progress: unknown[] = [];
    const report = await warmup.run({ scene, camera }, { onProgress: (step) => progress.push(step) });
    expect(progress).toEqual([
      { done: 1, total: 4, step: 'scene' },
      { done: 2, total: 4, step: 'pool:flags' },
      { done: 3, total: 4, step: 'pool:sparks' },
      { done: 4, total: 4, step: 'frame' },
    ]);
    expect(report).toEqual({
      count: 1,
      key,
      entries: ['pool:flags', 'pool:sparks'],
      compiled: 3,
      drawn: 1,
      built: 4,
      ms: expect.any(Number),
    });
    // Each pool becomes drawable at its own step, and stays so; nothing is culled while compiling.
    expect(compiles.map(({ sparks, flagsShown, culled }) => ({ sparks, flagsShown, culled }))).toEqual([
      { sparks: 0, flagsShown: false, culled: false },
      { sparks: 0, flagsShown: true, culled: false },
      { sparks: 1, flagsShown: true, culled: false },
    ]);
    // The target: a stand-in with the internal half-float target's attachments, then the canvas again.
    const target = compiles[0].target!;
    expect(target).toBeInstanceOf(RenderTarget);
    expect([target.texture.type, target.texture.colorSpace, target.depthBuffer]).toEqual([
      HalfFloatType,
      'srgb-linear',
      true,
    ]);
    expect(warmup).toMatchObject({ last: report, running: false, built: 4, start: 0 });
  });

  it('puts every object back as it was', async () => {
    const { warmup, scene, camera, sparks, flags, flag } = setup();
    const kept = new Matrix4().makeTranslation(1, 2, 3);
    sparks.setMatrixAt(0, kept);
    warmup.register('pool:sparks', { objects: () => [sparks] });
    warmup.register('pool:flags', { objects: () => [flag] });
    await warmup.run({ scene, camera });
    const matrix = new Matrix4();
    sparks.getMatrixAt(0, matrix);
    expect(matrix.equals(kept)).toBe(true);
    expect([sparks.count, flags.visible, flags.scale.toArray(), flag.visible]).toEqual([0, false, [1, 1, 1], true]);
    scene.traverse((object) => expect(object.frustumCulled, object.type).toBe(true));
  });

  it("uses the view's target when given, and the canvas when render() needs no internal target", async () => {
    const given = setup();
    const target = new RenderTarget(4, 4);
    await given.warmup.run({ scene: given.scene, camera: given.camera, target });
    expect(given.compiles[0].target).toBe(target);
    const direct = setup();
    direct.fake.needsFrameBufferTarget = false;
    await direct.warmup.run({ scene: direct.scene, camera: direct.camera });
    expect(direct.compiles[0].target).toBeNull();
  });

  it('runs one warm-up at a time, and draws the warm frame through the view', async () => {
    const { warmup, scene, camera } = setup();
    let drawn = 0;
    const view = { scene, camera, draw: () => void drawn++ };
    const first = warmup.run(view);
    expect(warmup.running).toBe(true);
    expect(warmup.run(view)).toBe(first);
    expect((await first).drawn).toBe(0);
    expect(drawn).toBe(1);
    expect((await warmup.run(view)).count).toBe(2);
  });

  it('puts everything back and counts what it built when it fails', async () => {
    const { warmup, scene, camera, sparks, fake } = setup({ failCompile: true });
    warmup.register('pool:sparks', { objects: () => [sparks] });
    await expect(warmup.run({ scene, camera })).rejects.toThrow('compile failed');
    expect([warmup.running, warmup.last, fake.target, sparks.count]).toEqual([false, null, null, 0]);
  });
});
