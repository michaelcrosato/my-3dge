/**
 * @file Unit tests for the viewmodel's lens (engine/gfx/viewmodel/lens.ts, PLAN.md WP 13.12): the arms' depth rises
 * with the true depth, meets their near plane where it starts, and keeps a point a metre away nearer the eye than any
 * wall the capsule lets come; a drawn point stays on its ray, and with the spread lands where the arms' own lens would
 * draw it; the arms' frame and the edge a hand is kept within; the setting's lens.
 */
import { describe, expect, it } from 'vitest';
import { apexFov } from '../cameras/effects';
import { makePose, poseForward, poseRight, poseUp, type CameraPose, type Vec3 } from '../cameras/pose';
import { armsDepth, armsLens, armsSpread, drawnPoint, inArmsFrame, intoArmsFrame, VIEWMODEL } from './lens';

/** `p` in `pose`'s frame: across, up, along. */
function view(pose: CameraPose, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - pose.position[0], p[1] - pose.position[1], p[2] - pose.position[2]];
  const dot = (a: Vec3) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  return [dot(poseRight(pose)), dot(poseUp(pose)), dot(poseForward(pose))];
}

const turned = makePose({ position: [3, 1.52, -2], yaw: 0.7, pitch: -0.3, roll: 0.05, fov: VIEWMODEL.fov, near: 0.05 });

describe('the viewmodel lens', () => {
  it('draws the arms’ depth rising with the true depth, from their near plane to within a few centimetres', () => {
    const near = 0.05;
    expect(armsDepth(VIEWMODEL.near, near)).toBeCloseTo(near * VIEWMODEL.lift, 12);
    expect(armsDepth(VIEWMODEL.near - 1e-9, near)).toBeCloseTo(near * VIEWMODEL.lift, 6); // no step at their near plane
    let last = -Infinity;
    for (let z = -0.2; z <= 1.2; z += 0.01) {
      const d = armsDepth(z, near);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
    expect(armsDepth(1, near)).toBeLessThan(0.2); // a hand a metre out still nearer the eye than a wall can come (0.28 m)
    expect(armsDepth(0.08, near)).toBeLessThan(near); // nearer than 8 cm along the view: cut
  });

  it('keeps each point on its ray, and with the spread puts it where the arms’ lens would', () => {
    const p: Vec3 = [3.2, 1.3, -1.5];
    const [x, y, z] = view(turned, p);
    const [dx, dy, dz] = view(turned, drawnPoint(turned, p));
    expect(dx / dz).toBeCloseTo(x / z, 9);
    expect(dy / dz).toBeCloseTo(y / z, 9);
    expect(dz).toBeCloseTo(armsDepth(z, turned.near), 9);
    const wide = makePose({ ...turned, fov: apexFov(110) }); // the slider at its widest: the arms keep their shape
    const [wx, wy, wz] = view(wide, drawnPoint(wide, p));
    const tan = (fov: number) => Math.tan((fov * Math.PI) / 360);
    expect(wy / wz / tan(wide.fov)).toBeCloseTo(y / z / tan(VIEWMODEL.fov), 9);
    expect(wx / wz / tan(wide.fov)).toBeCloseTo(x / z / tan(VIEWMODEL.fov), 9);
    expect(armsSpread(wide)).toBeGreaterThan(1);
    expect(armsSpread({ fov: VIEWMODEL.fov, zoom: 2 })).toBeCloseTo(0.5, 12); // the sights' zoom: the arms keep theirs
  });

  it('frames the arms with their own lens, and keeps a hand within its margin, as far from the eye', () => {
    const half = Math.tan((VIEWMODEL.fov * Math.PI) / 360);
    const forward = poseForward(turned);
    const up = poseUp(turned);
    const at = (along: number, rise: number): Vec3 => [0, 1, 2].map((i) => turned.position[i] + forward[i] * along + up[i] * rise) as unknown as Vec3; // prettier-ignore
    expect(inArmsFrame(turned, at(0.5, 0.5 * half * 0.99), 16 / 9)).toBe(true);
    expect(inArmsFrame(turned, at(0.5, 0.5 * half * 1.01), 16 / 9)).toBe(false);
    expect(inArmsFrame(turned, at(-0.5, 0), 16 / 9)).toBe(false); // behind the eye
    expect(inArmsFrame(turned, at(0.06, 0), 16 / 9)).toBe(false); // nearer than their near plane draws
    const inside = at(0.4, -0.1);
    expect(intoArmsFrame(turned, inside, 16 / 9)).toBe(inside);
    for (const p of [at(0.2, 0.8), at(-0.3, 0.2), at(0.1, -2)]) {
      const kept = intoArmsFrame(turned, p, 16 / 9);
      const [x, y, z] = view(turned, kept);
      expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(...view(turned, p)), 9);
      expect(Math.abs(y / (z * half))).toBeCloseTo(VIEWMODEL.margin, 9); // on the margin's edge it went past
      expect(inArmsFrame(turned, kept, 16 / 9)).toBe(true);
    }
  });

  it('reads the arms’ lens from the setting in Apex’s horizontal degrees', () => {
    expect(armsLens(70)).toBeCloseTo(VIEWMODEL.fov, 12);
    expect(armsLens(90)).toBeCloseTo(apexFov(90), 12);
    expect(armsLens(undefined)).toBe(VIEWMODEL.fov);
  });
});
