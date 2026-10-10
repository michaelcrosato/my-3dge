/**
 * @file T2 for materials and procedural textures (PLAN.md WP 2.3) on the scene page (tests/pages/scene.html): every
 * material in the registry, the built-ins plus two the test defines (an unlit checker and an emissive one), is
 * compiled by the material library in the page, its textures baked there on the CPU and uploaded as `DataTexture`s
 * with their mip chains, and drawn on a card in front of the fixture scene. The cards are added after the warm-up, so
 * a frame that had to build a pipeline for one (the library's probes not covering it) fails with `built > 0` and
 * `GFX_COLD_PIPELINE`; each card's window then shows its material (it changed the frame, a textured one shows its
 * texels, the unlit ones their exact colours), and no frame is blank. The page's bakes hash the same as Node's.
 *
 * Invariants: the page runs at `gfx.resolution=full`, so a card's window is read in canvas pixels; frames are drawn
 * by calling the page (`__scene.settle`); cards are planes whose UVs are in metres (the engine's convention), facing
 * the camera, casting and receiving shadows like the probes.
 */
import type { Material, Mesh, PerspectiveCamera, Scene } from 'three/webgpu';
import type { Gfx, FrameReport } from '../../engine/gfx/renderer';
import { bakeTexture } from '../../engine/gfx/textures/bake';
import { registry } from '../../engine/core/registry';
import '../../engine/gfx/materials/material';
import { expect, test, type Frame } from './fixtures';

/** What the scene page publishes as `window.__scene` (tests/pages/scene.ts), as far as this suite uses it. */
interface ScenePage {
  gfx: Gfx;
  scene: Scene;
  camera: PerspectiveCamera;
  three: typeof import('three/webgpu');
  settle(alpha?: number): Promise<FrameReport>;
}

/** One card as the page reports it: its material, how it is drawn, and its window in canvas pixels. */
interface Card {
  id: string;
  type: string;
  textured: boolean;
  unlit: boolean;
  color: string;
  window: { x0: number; y0: number; x1: number; y1: number };
}

/** The page's window as this suite reads it (renderer.spec.ts declares `__scene` globally with its own type). */
type SceneWindow = { __scene: ScenePage };

declare global {
  interface Window {
    /** This suite's cards, kept in the page between steps. */
    __cards: { meshes: Mesh[]; materials: Material[] };
  }
}

const PAGE = 'tests/pages/scene.html?gfx.resolution=full';
const MODULES = {
  library: '/engine/gfx/materials/library.ts',
  material: '/engine/gfx/materials/material.ts',
  bake: '/engine/gfx/textures/bake.ts',
};

/** How many pixels of `window` differ between frames `a` and `b` by more than 8 in some channel, and of how many. */
function changed(a: Frame, b: Frame, { x0, y0, x1, y1 }: Card['window']): [number, number] {
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      if ([0, 1, 2].some((c) => Math.abs(a.rgba[i + c] - b.rgba[i + c]) > 8)) count++;
    }
  }
  return [count, (x1 - x0) * (y1 - y0)];
}

/** The pixels of `window` in `frame`, as hex strings. */
function pixels(frame: Frame, { x0, y0, x1, y1 }: Card['window']): string[] {
  const out: string[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4;
      out.push('#' + [0, 1, 2].map((c) => frame.rgba[i + c].toString(16).padStart(2, '0')).join(''));
    }
  }
  return out;
}

/** Whether two hex colours are within `tolerance` in every channel. */
function near(a: string, b: string, tolerance = 2): boolean {
  return [1, 3, 5].every(
    (at) => Math.abs(parseInt(a.slice(at, at + 2), 16) - parseInt(b.slice(at, at + 2), 16)) <= tolerance,
  );
}

test('every material renders on the scene page after the warm-up, building 0 pipelines, and no frame is blank', async ({
  page,
  harness,
}) => {
  await page.goto(PAGE);
  await harness.ready();
  await harness.assertWebGPU();

  // The library in the page: two test materials, every material compiled, the probes attached, then a warm-up.
  const warmed = await page.evaluate(async (modules) => {
    const { createMaterialLibrary } = (await import(
      modules.library
    )) as typeof import('../../engine/gfx/materials/library');
    const { defineMaterial } = (await import(modules.material)) as typeof import('../../engine/gfx/materials/material');
    defineMaterial('material:test-unlitChecker', {
      description: 'The checker, unlit: its texels reach the screen as baked.',
      map: { texture: 'texture:checker', seed: 3 },
      unlit: true,
    });
    defineMaterial('material:test-ember', {
      description: 'A lit stone that also glows.',
      map: 'texture:stone',
      emissive: '#ff5a1a',
      emissiveIntensity: 0.6,
    });
    const { gfx, scene } = (window as unknown as SceneWindow).__scene;
    // A shadow bias against acne on the cards (a uniform: it changes no pipeline).
    scene.traverse((object) => {
      const light = object as import('three/webgpu').DirectionalLight;
      if (!light.isDirectionalLight) return;
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
    });
    const library = createMaterialLibrary();
    library.attach(gfx.warmup, scene);
    const materials = library.all();
    const frame = await (window as unknown as SceneWindow).__scene.settle();
    window.__cards = { meshes: [], materials };
    return { frame, ids: library.ids, entries: gfx.warmup.last!.entries, stats: gfx.stats() };
  }, MODULES);
  expect(warmed.entries).toContain('materials');
  const expected = registry.list('material').map((entry) => entry.id);
  expect(warmed.ids).toEqual([...expected, 'material:test-ember', 'material:test-unlitChecker'].sort());
  expect(warmed.frame).toMatchObject({ drawn: true, built: 0 });
  expect(warmed.stats.pipelinesAfterWarmUp).toBe(0);
  const before = await harness.readFrame();
  expect(before.blank).toBe(false);

  // A card per material, added after the warm-up: two rows in front of the fixture, each facing the camera.
  const cards: Card[] = await page.evaluate(() => {
    const { scene, camera, three } = (window as unknown as SceneWindow).__scene;
    const { materials } = window.__cards;
    const canvas = (window as unknown as SceneWindow).__scene.gfx.renderer.domElement;
    const size = 1.2;
    const perRow = Math.ceil(materials.length / 2);
    return materials.map((material, i) => {
      const geometry = new three.PlaneGeometry(size, size);
      const uv = geometry.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * size, uv.getY(k) * size);
      const mesh = new three.Mesh(geometry, material);
      const [row, col] = [Math.floor(i / perRow), i % perRow];
      mesh.position.set((col - (perRow - 1) / 2) * 1.45, 2.3 - row * 1.5, 2.5);
      mesh.lookAt(camera.position);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      window.__cards.meshes.push(mesh);
      mesh.updateMatrixWorld(true);
      const corners = [-0.3, 0.3].flatMap((dx) =>
        [-0.3, 0.3].map((dy) => mesh.localToWorld(new three.Vector3(dx * size, dy * size, 0)).project(camera)),
      );
      const xs = corners.map((v) => ((v.x + 1) / 2) * canvas.clientWidth);
      const ys = corners.map((v) => ((1 - v.y) / 2) * canvas.clientHeight);
      const entry = material.userData.material as string;
      const lambert = material as import('three/webgpu').MeshLambertMaterial;
      return {
        id: entry,
        type: material.type,
        textured: Boolean(lambert.map),
        unlit: material.type === 'MeshBasicMaterial',
        color: '#' + lambert.color.getHexString(),
        window: {
          x0: Math.round(Math.min(...xs)),
          y0: Math.round(Math.min(...ys)),
          x1: Math.round(Math.max(...xs)),
          y1: Math.round(Math.max(...ys)),
        },
      };
    });
  });
  const drawn = await page.evaluate(async () => ({
    frame: await (window as unknown as SceneWindow).__scene.settle(),
    stats: (window as unknown as SceneWindow).__scene.gfx.stats(),
  }));
  expect(drawn.frame, 'the probes built every pipeline the cards need').toMatchObject({ drawn: true, built: 0 });
  expect(drawn.stats.pipelinesAfterWarmUp).toBe(0);
  const after = await harness.readFrame();
  expect(after.blank).toBe(false);

  for (const card of cards) {
    const [count, total] = changed(before, after, card.window);
    expect(total, `${card.id}'s window`).toBeGreaterThan(400);
    expect(count / total, `${card.id} changed its window`).toBeGreaterThan(0.6);
    if (card.textured) {
      // Its texels show: more than one colour, the commonest covering at most 85% of the window.
      const counts = new Map<string, number>();
      for (const p of pixels(after, card.window)) counts.set(p, (counts.get(p) ?? 0) + 1);
      expect(counts.size, `${card.id} shows its texels`).toBeGreaterThan(1);
      expect(Math.max(...counts.values()) / total, `${card.id} shows its texels`).toBeLessThan(0.85);
    }
    if (card.id === 'material:test-unlitChecker') {
      const seen = pixels(after, card.window);
      const exact = seen.filter((p) => near(p, '#d8d0e8') || near(p, '#5a5270')).length;
      expect(exact / seen.length, 'the unlit checker shows its baked texels, exactly').toBeGreaterThan(0.9);
      expect(seen.some((p) => near(p, '#d8d0e8')) && seen.some((p) => near(p, '#5a5270'))).toBe(true);
    }
    if (card.unlit && !card.textured) {
      const seen = pixels(after, card.window);
      expect(
        seen.filter((p) => near(p, card.color)).length / seen.length,
        `${card.id} shows its colour`,
      ).toBeGreaterThan(0.9);
    }
  }
  expect(cards.map((card) => card.type)).toContain('MeshBasicMaterial');
  expect(cards.map((card) => card.type)).toContain('MeshLambertMaterial');

  // Each card alone: a frame per material, none blank, none building a pipeline.
  for (const [i, card] of cards.entries()) {
    const alone = await page.evaluate(async (shown) => {
      window.__cards.meshes.forEach((mesh, k) => (mesh.visible = k === shown));
      return (window as unknown as SceneWindow).__scene.settle();
    }, i);
    expect(alone, card.id).toMatchObject({ drawn: true, built: 0 });
    expect((await harness.readFrame()).blank, `${card.id}'s frame`).toBe(false);
  }
});

test("the page's bakes match Node's, byte for byte", async ({ page, harness }) => {
  await page.goto(PAGE);
  await harness.ready();
  const ids = registry.list('texture').map((entry) => entry.id);
  const inPage = await page.evaluate(
    async ({ modules, ids }) => {
      const { bakeTexture } = (await import(modules.bake)) as typeof import('../../engine/gfx/textures/bake');
      return ids.map((id) => [bakeTexture(id).hash, bakeTexture({ texture: id, seed: 7 }).hash]);
    },
    { modules: MODULES, ids },
  );
  expect(ids.length).toBeGreaterThanOrEqual(6);
  expect(inPage).toEqual(ids.map((id) => [bakeTexture(id).hash, bakeTexture({ texture: id, seed: 7 }).hash]));
});
