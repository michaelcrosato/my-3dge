/**
 * @file Unit tests for the instancing service (engine/gfx/instancing.ts), in Node: pages above r182's 1,000-slot
 * uniform path (a smaller page size refused), paging as instances are added (2,000 instances on two pages of 1,024),
 * colours and per-instance attributes present on every page before it is ever drawn, `StaticDrawUsage` kept, update
 * ranges only on the pages that changed and always over their used slots, r182's instance sync moved before the
 * upload (and left alone on another release), slot access, the draw-call count, the warm-up registration and
 * `dispose`. The GPU half (the ID pass following moved instances, no pipeline per page) is
 * tests/e2e/instancing.spec.ts.
 * @see engine/gfx/instancing.ts
 */
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstanceNode,
  Matrix4,
  MeshBasicMaterial,
  REVISION,
  StaticDrawUsage,
  Vector3,
  type InstancedMesh,
} from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createLog } from '../core/log';
import {
  createInstancedBatch,
  INSTANCE_SYNC,
  instancePath,
  PAGE_SLOTS,
  syncBeforeUpload,
  UNIFORM_INSTANCE_LIMIT,
  type InstancedBatch,
} from './instancing';

const geometry = new BoxGeometry(1, 1, 1);
const material = new MeshBasicMaterial();

/** A batch of unit boxes named `test`. */
const make = (extra: Partial<Parameters<typeof createInstancedBatch>[0]> = {}) =>
  createInstancedBatch({ name: 'test', geometry, material, ...extra });

/** Writes `n` instances in a row, instance i at x = i, coloured by its index. */
function fill(batch: InstancedBatch, n: number): void {
  const m = new Matrix4();
  batch.begin();
  for (let i = 0; i < n; i++) batch.add(m.makeTranslation(i, 0, 0).elements, [i / n, 0, 1]);
  batch.end();
}

/** The update ranges of a page's matrices, colours and every other instanced attribute. */
const ranges = (mesh: InstancedMesh) => ({
  matrix: mesh.instanceMatrix.updateRanges.map((r) => [r.start, r.count]),
  color: mesh.instanceColor!.updateRanges.map((r) => [r.start, r.count]),
});

describe('pages', () => {
  it('keeps every page above the uniform-buffer path, and refuses smaller pages', () => {
    expect(instancePath(UNIFORM_INSTANCE_LIMIT)).toBe('uniform');
    expect(instancePath(UNIFORM_INSTANCE_LIMIT + 1)).toBe('attribute');
    expect(PAGE_SLOTS).toBeGreaterThan(UNIFORM_INSTANCE_LIMIT);
    const batch = make();
    expect(batch.pages).toHaveLength(1);
    expect(batch.pages[0].instanceMatrix.count).toBe(1024);
    expect(instancePath(batch.pages[0].instanceMatrix.count)).toBe('attribute');
    for (const slots of [1000, 256, 1024.5]) {
      expect(() => make({ pageSlots: slots })).toThrow(/GFX_INSTANCE_PAGE/);
    }
    expect(make({ pageSlots: 1001 }).capacity).toBe(1001);
  });

  it('pages 2,000 instances onto two pages of 1,024, each with its colours from the start', () => {
    const batch = make();
    fill(batch, 2000);
    expect(batch.pages.map((page) => [page.name, page.count, page.visible])).toEqual([
      ['test/page0', 1024, true],
      ['test/page1', 976, true],
    ]);
    expect(batch.capacity).toBe(2048);
    expect(batch.root.children).toEqual(batch.pages);
    for (const page of batch.pages) {
      expect(page.instanceColor, 'a colour attribute before the first render').not.toBeNull();
      expect(page.instanceMatrix.usage).toBe(StaticDrawUsage);
      expect(page.instanceMatrix.usage).not.toBe(DynamicDrawUsage);
      expect(page.geometry).toBe(geometry);
      expect(page.material).toBe(material);
      expect(page.frustumCulled).toBe(false);
    }
    const m = new Matrix4();
    expect(new Vector3().setFromMatrixPosition(batch.getMatrixAt(1500, m)).x).toBe(1500);
    batch.pages[1].getMatrixAt(1500 - 1024, m);
    expect(m).toEqual(batch.getMatrixAt(1500, new Matrix4()));
    const c = new Color();
    batch.pages[1].getColorAt(1999 - 1024, c);
    expect([c.r, c.g, c.b]).toEqual([Math.fround(1999 / 2000), 0, 1]);
  });

  it('makes a new page white before it is drawn, and hides empty pages', () => {
    const batch = make();
    fill(batch, 3000);
    const third = batch.pages[2];
    expect(Array.from(third.instanceColor!.array.slice((3000 - 2048) * 3))).toEqual(
      new Array((3072 - 3000) * 3).fill(1),
    );
    fill(batch, 10);
    expect(batch.pages.map((page) => [page.count, page.visible])).toEqual([
      [10, true],
      [0, false],
      [0, false],
    ]);
    expect(batch.pages).toHaveLength(3);
  });
});

describe('the sync before the upload', () => {
  it("runs r182's instance node update before the renderer uploads, once per render", () => {
    expect(REVISION).toBe('182');
    expect(INSTANCE_SYNC).toEqual({ patched: true, problems: [] });
    const matrices = new InstancedBufferAttribute(new Float32Array(1100 * 16), 16);
    const node = new InstanceNode(1100, matrices) as unknown as {
      getUpdateBeforeType(): string;
      updateBefore(frame: unknown): void;
      buffer: { version: number; updateRanges: unknown[]; clearUpdateRanges(): void } | null;
    };
    expect(node.getUpdateBeforeType()).toBe('render');
    node.buffer = { version: 0, updateRanges: [], clearUpdateRanges: () => void (node.buffer!.updateRanges = []) };
    matrices.addUpdateRange(0, 32);
    matrices.needsUpdate = true;
    node.updateBefore({});
    expect(node.buffer.version, 'the copy is current before the upload').toBe(matrices.version);
    expect(node.buffer.updateRanges).toEqual([{ start: 0, count: 32 }]);
    expect(syncBeforeUpload(), 'a second call changes nothing').toEqual({ patched: true, problems: [] });
  });

  it('changes nothing on another release or node class, and the batch advises it once', () => {
    class Bare {}
    expect(syncBeforeUpload(Bare, '182')).toEqual({
      patched: false,
      problems: ['InstanceNode has no update() and getUpdateBeforeType() to wrap'],
    });
    expect(syncBeforeUpload(InstanceNode, '185').problems).toEqual([
      "three.js is r185, the fix wraps r182's InstanceNode",
    ]);
    const quiet = createLog({ console: { warn: () => {}, error: () => {} } });
    make({ log: quiet });
    expect(quiet.advice, 'patched here: no advice').toEqual([]);
  });
});

describe('update ranges', () => {
  it('uploads only pages that changed, each over its used slots', () => {
    const batch = make();
    fill(batch, 2000);
    expect(ranges(batch.pages[0])).toEqual({ matrix: [[0, 1024 * 16]], color: [[0, 1024 * 3]] });
    expect(ranges(batch.pages[1])).toEqual({ matrix: [[0, 976 * 16]], color: [[0, 976 * 3]] });
    expect(batch.stats()).toMatchObject({ pages: 2, count: 2000, uploadedPages: 2 });
    expect(batch.stats().uploadedBytes).toBe(2000 * (16 + 3) * 4);
    const versions = batch.pages.map((page) => page.instanceMatrix.version);

    batch.end();
    expect(batch.stats().uploadedPages, 'nothing changed').toBe(0);
    expect(batch.pages.map((page) => page.instanceMatrix.version)).toEqual(versions);

    batch.setMatrixAt(1500, new Matrix4().makeTranslation(0, 5, 0));
    batch.end();
    expect(batch.stats()).toMatchObject({ uploadedPages: 1, uploadedBytes: 976 * 19 * 4 });
    expect(batch.pages[0].instanceMatrix.version).toBe(versions[0]);
    expect(batch.pages[1].instanceMatrix.version).toBe(versions[1] + 1);
    expect(ranges(batch.pages[1]).matrix, 'the whole used part, never only the slot').toEqual([[0, 976 * 16]]);
  });

  it('counts pages up and down through count, and refuses negative or fractional slots', () => {
    const batch = make();
    batch.count = 1500;
    batch.end();
    expect(batch.pages.map((page) => page.count)).toEqual([1024, 476]);
    batch.count = 0;
    batch.end();
    expect(batch.pages.map((page) => page.visible)).toEqual([false, false]);
    expect(() => batch.setMatrixAt(-1, new Matrix4())).toThrow(/GFX_INSTANCE_SLOT/);
    expect(() => batch.setColorAt(0.5, [1, 1, 1])).toThrow(/GFX_INSTANCE_SLOT/);
    expect(() => batch.getMatrixAt(5000, new Matrix4())).toThrow(/GFX_INSTANCE_SLOT/);
    batch.setColorAt(3, new Color(0.5, 0.25, 0));
    expect(Array.from(batch.pages[0].instanceColor!.array.slice(9, 12))).toEqual([0.5, 0.25, 0]);
  });
});

describe('per-instance attributes', () => {
  it('adds them to every page before it is drawn, sharing the geometry, and ranges them with the rest', () => {
    const batch = make({ attributes: { tint: 3, flash: 1 } });
    batch.count = 1100;
    batch.setAttributeAt('tint', 1050, [0.1, 0.2, 0.3]);
    batch.end();
    const [first, second] = batch.pages;
    for (const page of [first, second]) {
      expect(page.geometry).not.toBe(geometry);
      expect(page.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(page.geometry.getIndex()).toBe(geometry.getIndex());
      expect(page.geometry.getAttribute('tint').count).toBe(1024);
      expect(
        (page.geometry.getAttribute('tint') as unknown as { isInstancedBufferAttribute: boolean })
          .isInstancedBufferAttribute,
      ).toBe(true);
      expect(page.geometry.getAttribute('flash').itemSize).toBe(1);
    }
    expect(Array.from(second.geometry.getAttribute('tint').array.slice(26 * 3, 27 * 3))).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
    expect((second.geometry.getAttribute('tint') as InstancedBufferAttribute).updateRanges).toEqual([
      { start: 0, count: 76 * 3 },
    ]);
  });

  it('refuses bad sizes, taken names and unknown attributes', () => {
    expect(() => make({ attributes: { tint: 5 } })).toThrow(/GFX_INSTANCE_ATTRIBUTE.*item size 5/);
    expect(() => make({ attributes: { normal: 3 } })).toThrow(/GFX_INSTANCE_ATTRIBUTE.*normal is taken/);
    expect(() => make({ attributes: { instanceColor: 3 } })).toThrow(/GFX_INSTANCE_ATTRIBUTE/);
    expect(() => make().setAttributeAt('tint', 0, [1])).toThrow(/no per-instance attribute tint/);
  });
});

describe('the frame', () => {
  it('counts draw calls per shown page, and again per shadow map when casting', () => {
    const batch = make({ castShadow: true });
    expect(batch.drawCalls(1)).toBe(0);
    fill(batch, 2000);
    expect([batch.drawCalls(), batch.drawCalls(1)]).toEqual([2, 4]);
    expect(make().drawCalls(1)).toBe(0);
  });

  it('registers every page, those added later too, and disposes', () => {
    const registered: { id: string; objects: () => readonly unknown[] }[] = [];
    let disposed = 0;
    const warmup = {
      register: (id: string, entry: { objects: () => readonly unknown[] }) => {
        registered.push({ id, ...entry });
        return { dispose: () => void disposed++ };
      },
    };
    const batch = make();
    batch.register(warmup);
    expect(registered[0].id).toBe('batch:test');
    expect(registered[0].objects()).toHaveLength(1);
    fill(batch, 2500);
    expect(registered[0].objects()).toHaveLength(3);
    const parent = { removed: false };
    batch.root.removeFromParent = () => {
      parent.removed = true;
      return batch.root;
    };
    batch.dispose();
    expect([disposed, parent.removed]).toEqual([1, true]);
  });
});
