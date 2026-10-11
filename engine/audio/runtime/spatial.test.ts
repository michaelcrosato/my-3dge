/**
 * @file Unit tests for sound in 3D (engine/audio/runtime/spatial.ts): the listener's axes follow the engine's camera
 * pose (unit, orthogonal, its right the camera's right), and occlusion through a real physics world's `QueryView`:
 * a wall of the level between hides a sound, a clear line, a prop or a sound on the wall's own face does not.
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { createPhysics } from '../../physics/world';
import { queryView } from '../../sim/queryView';
import { listenerAxes, occluded, type Vec3 } from './spatial';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe('listenerAxes', () => {
  it('looks along +Z at yaw 0, +X at yaw π/2, and down with the heading as up at pitch −π/2', () => {
    const level = listenerAxes({ yaw: 0, pitch: 0 });
    expect(level.forward).toEqual([0, 0, 1]);
    expect(level.up).toEqual([-0, 1, -0]);
    expect(listenerAxes({ yaw: Math.PI / 2, pitch: 0 }).forward.map((v) => +v.toFixed(12))).toEqual([1, 0, 0]);
    const down = listenerAxes({ yaw: Math.PI / 2, pitch: -Math.PI / 2 });
    expect(down.forward.map((v) => +v.toFixed(12) + 0)).toEqual([0, -1, 0]);
    expect(down.up.map((v) => +v.toFixed(12) + 0)).toEqual([1, 0, 0]);
  });

  it('gives unit, orthogonal axes whose right (forward × up) is the camera’s right, for any pose', () => {
    for (let i = 0; i < 50; i++) {
      const yaw = -Math.PI + (i * 2 * Math.PI) / 50;
      const pitch = -1.4 + (i % 7) * 0.4;
      const { forward, up } = listenerAxes({ yaw, pitch });
      expect(dot(forward, forward)).toBeCloseTo(1, 12);
      expect(dot(up, up)).toBeCloseTo(1, 12);
      expect(dot(forward, up)).toBeCloseTo(0, 12);
      const right = cross(forward, up);
      // engine/gfx/cameras/pose.ts's poseRight: [−cos yaw, 0, sin yaw]
      expect(right[0]).toBeCloseTo(-Math.cos(yaw), 12);
      expect(right[1]).toBeCloseTo(0, 12);
      expect(right[2]).toBeCloseTo(Math.sin(yaw), 12);
    }
  });
});

describe('occluded', () => {
  /** A wall of the level across z = 4 (x from −2 to 2, 3 m high) and a crate (a prop) across z = −4. */
  function queries() {
    const physics = createPhysics();
    physics.addBody({
      type: 'fixed',
      colliders: [{ shape: { type: 'box', size: [4, 3, 0.5] } }],
      position: [0, 1.5, 4],
    });
    physics.addBody({
      type: 'fixed',
      group: 'prop',
      colliders: [{ shape: { type: 'box', size: [4, 3, 0.5] } }],
      position: [0, 1.5, -4],
    });
    physics.step({ dt: 1 / 60, settings: createSettings().sim }); // queries see bodies from the next step
    return queryView(physics);
  }
  const ear: Vec3 = [0, 1.5, 0];

  it('hides a sound behind a wall of the level, not one in the clear', () => {
    const view = queries();
    expect(occluded(view, ear, [0, 1.5, 8])).toBe(true);
    expect(occluded(view, ear, [1.5, 2, 9])).toBe(true);
    expect(occluded(view, ear, [6, 1.5, 8])).toBe(false);
    expect(occluded(view, ear, [0, 1.5, 3])).toBe(false);
  });

  it('lets props through, and never hides a sound on the wall’s own face or within the margin', () => {
    const view = queries();
    expect(occluded(view, ear, [0, 1.5, -8])).toBe(false);
    expect(occluded(view, ear, [0, 1.5, 3.7])).toBe(false);
    expect(occluded(view, ear, [0, 1.6, 0.1])).toBe(false);
  });
});
