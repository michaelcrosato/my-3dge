/**
 * @file Unit tests for camera blends (engine/gfx/cameras/blend.ts): the ends are the very poses; halfway between two
 * views of one target the camera swings round it; an orthographic pose blends as the perspective one that frames the
 * same picture at its target; two orthographic poses blend orthographic; the weight is a smoothstep over the time; the
 * gap is what the blend moved between two weights.
 * @see engine/gfx/cameras/blend.ts
 */
import { describe, expect, it } from 'vitest';
import { BLEND_LENS, BLEND_TIME, blendGap, blendCameras, blendWeight, turnBetween } from './blend';
import { frameSize, makePose, poseTarget } from './pose';
import { createViewCamera } from './presets';

const close = (a: readonly number[], b: readonly number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('camera blends', () => {
  const south = makePose({ position: [0, 0, -10], yaw: 0, distance: 10, fov: 60 });
  const east = makePose({ position: [10, 0, 0], yaw: -Math.PI / 2, distance: 10, fov: 40, roll: 0.2 });

  it('are the very poses at their ends, and swing round a common target between', () => {
    expect(blendCameras(south, east, 0)).toBe(south);
    expect(blendCameras(south, east, 1)).toBe(east);
    const half = blendCameras(south, east, 0.5);
    close(half.position, [Math.SQRT1_2 * 10, 0, -Math.SQRT1_2 * 10]);
    close(poseTarget(half), [0, 0, 0]);
    expect([half.fov, half.roll]).toEqual([50, expect.closeTo(0.1, 9)]);
  });

  it('meet an orthographic pose at the perspective one that frames its picture at its target', () => {
    const iso = createViewCamera({ view: 'iso' }).update({ follow: [0, 0, 0] });
    const near = blendCameras(iso, south, 1e-9);
    expect(near.projection).toBe('perspective');
    expect(near.fov).toBeCloseTo(BLEND_LENS, 6);
    expect(frameSize(near, 1).height).toBeCloseTo(frameSize(iso, 1).height, 3);
    close(poseTarget(near), poseTarget(iso), 3);
    const overhead = createViewCamera({ view: 'overhead' }).update({ follow: [0, 0, 0] });
    expect(blendCameras(iso, overhead, 0.5).projection).toBe('orthographic');
  });

  it('weigh by a smoothstep over the time, and give what a step of it moved', () => {
    expect([blendWeight(0, BLEND_TIME), blendWeight(BLEND_TIME / 2, BLEND_TIME), blendWeight(1, BLEND_TIME)]).toEqual([0, 0.5, 1]); // prettier-ignore
    expect(blendWeight(0, 0)).toBe(1);
    const { move, turn } = blendGap(south, east, 0, 1);
    expect(move).toBeCloseTo(Math.hypot(10, 10), 6);
    expect(turn).toBeCloseTo(Math.PI / 2, 6);
    expect(turnBetween(south, south)).toBe(0);
  });
});
