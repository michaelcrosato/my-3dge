/**
 * @file Unit tests for floor decals (engine/gfx/fx/decals.ts), in Node: a sector's quad is its outer radius round its
 * origin, lying 2 cm above the floor, turned so its local +Y is the facing; a strip's quad is the square round its
 * middle; the shape and paint attributes carry what the material cuts; a telegraph's fill grows with its wind-up and
 * scales with its size; decals past the capacity are counted; the material is one shared node material.
 * @see engine/gfx/fx/decals.ts
 */
import { Matrix4, Vector3, type InstancedBufferAttribute } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../core/registry';
import { getTelegraph } from '../../world/telegraphs';
import { createDecals, DECAL, type Decals } from './decals';

/** Slot `slot`'s matrix, shape and paint. */
function slotOf(decals: Decals, slot: number) {
  const page = decals.batch.pages[0];
  const read = (name: string) =>
    Array.from((page.geometry.getAttribute(name) as InstancedBufferAttribute).array.slice(slot * 4, slot * 4 + 4));
  return { matrix: decals.batch.getMatrixAt(slot, new Matrix4()), shape: read('fxShape'), paint: read('fxPaint') };
}

describe('decals', () => {
  it('lay a sector round its origin, 2 cm up, turned to its facing', () => {
    const decals = createDecals({ capacity: 1024 });
    decals.begin();
    decals.sector([1, 0.5, 2], Math.PI / 2, 0.3, 2, 0.8, 1.2, [1, 0, 0], 0.5, 0.6);
    decals.end();
    const { matrix, shape, paint } = slotOf(decals, 0);
    const forward = new Vector3(0, 1, 0).transformDirection(matrix);
    expect(forward.x).toBeCloseTo(1, 12); // local +Y is the facing: east at yaw π/2
    expect(new Vector3(0, 0, 1).transformDirection(matrix).y).toBeCloseTo(1, 12); // its face looks up
    expect(
      new Vector3(1, 1, 0)
        .applyMatrix4(matrix)
        .toArray()
        .map((v) => +v.toFixed(6)),
    ).toEqual([3, 0.52, 4]);
    expect(shape.map((v) => +v.toFixed(6))).toEqual([0, 0.3, 2, 0.8]);
    expect(paint.map((v) => +v.toFixed(6))).toEqual([1.2, 2, 0.5, 0.6]);
    expect(DECAL.lift).toBe(0.02);
  });

  it('lay a strip round its middle, its quad as wide as its longer side', () => {
    const decals = createDecals({ capacity: 1024 });
    decals.begin();
    decals.line([0, 0, 0], 0, 4, 1, 1.5, [1, 0, 0], 0.5, 0.6);
    decals.end();
    const { matrix, shape, paint } = slotOf(decals, 0);
    expect(
      new Vector3()
        .applyMatrix4(matrix)
        .toArray()
        .map((v) => +v.toFixed(6)),
    ).toEqual([0, 0.02, 2]);
    expect(shape).toEqual([1, 0.5, 2, 0]);
    expect(paint).toEqual([1.5, 2, 0.5, expect.closeTo(0.6, 6)]);
  });

  it("draw a telegraph filled as far as its wind-up, scaled by its size, in its colour's opacity", () => {
    const decals = createDecals({ capacity: 1024 });
    const reg = createRegistry();
    decals.begin();
    decals.telegraph(getTelegraph('telegraph:arc', reg), { telegraph: '', position: [0, 0, 0], yaw: 0, u: 0.5 });
    decals.telegraph(getTelegraph('telegraph:line', reg), {
      telegraph: '',
      position: [0, 0, 0],
      yaw: 0,
      u: 1,
      size: 2,
    });
    decals.end();
    const [arc, line] = [slotOf(decals, 0), slotOf(decals, 1)];
    expect(arc.shape.map((v) => +v.toFixed(6))).toEqual([0, 0.3, 1.5, 0.8]);
    expect(arc.paint.map((v) => +v.toFixed(6))).toEqual([0.9, 1.5, 0.475, 0.6]);
    expect(line.shape).toEqual([1, 1, 4, 0]); // 2 m wide, 8 m long
    expect(line.paint[0]).toBe(8);
  });

  it('count the decals past the capacity, and share one material', () => {
    const decals = createDecals({ capacity: 1024 });
    decals.begin();
    for (let i = 0; i < 1030; i++) decals.sector([i, 0, 0], 0, 0, 1, Math.PI, 1, [1, 1, 1], 1, 0);
    decals.end();
    expect([decals.batch.count, decals.skipped, decals.batch.pages.length]).toEqual([1024, 6, 1]);
    expect(decals.batch.drawCalls()).toBe(1);
    expect(decals.material.forceSinglePass).toBe(true);
    expect(decals.batch.pages[0].material).toBe(decals.material);
  });
});
