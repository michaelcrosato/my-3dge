/**
 * @file Unit tests for the shooter's camera (engine/gfx/cameras/shoulder.ts): over the right shoulder 3.8 m back from
 * the eye, looking along the view, the hero left of the screen's centre; the swap eases it over the left shoulder; the
 * sim's look sets the view and the devices turn it; raised sights pull the arm in to 1.5 m; the player's lens; backing
 * into a wall the camera never jumps, never stands in it and keeps his chest in the picture; codes round-trip.
 * @see engine/gfx/cameras/shoulder.ts
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { createPhysics } from '../../physics/world';
import { queryView } from '../../sim/queryView';
import { inPicture } from '../../dev/feel/camera';
import { COLLIDE_RADIUS } from './collide';
import { poseForward, poseRight, type Vec3 } from './pose';
import { createShoulderCamera, formatShoulderCode, parseShoulderCode, SHOULDER, shoulderState } from './shoulder';

const close = (a: readonly number[], b: readonly number[], digits = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

/** A floor and a wall whose face is at z = −3. */
function walls() {
  const physics = createPhysics();
  physics.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }],
  });
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 8, 1] }, position: [0, 4, -3.5] }] });
  physics.step({ dt: 1 / 60, settings: createSettings().sim });
  return queryView(physics);
}

describe('the shooter camera', () => {
  it('stands over the right shoulder, 3.8 m back along the view, the hero left of the centre', () => {
    const camera = createShoulderCamera();
    const pose = camera.update({ follow: [0, 0, 0] }, 1 / 60);
    close(pose.position, [-SHOULDER.right, SHOULDER.height + SHOULDER.up, -SHOULDER.back]);
    close(poseForward(pose), [0, 0, 1]);
    expect(pose.fov).toBeCloseTo(SHOULDER.lens, 9);
    expect(camera.code()).toBe('cam3=shoulder,0,0,3.8');
    expect(camera.describe()).toBe('Shooter camera (perspective, 74° field of view), over the right shoulder, 3.8 m back, heading 0°, pitch 0°'); // prettier-ignore
  });

  it('swaps to the left shoulder, eased, and back by its code', () => {
    const camera = createShoulderCamera();
    camera.update({ follow: [0, 0, 0] }, 1 / 60);
    const x = (dt: number, swap = false) => camera.update({ follow: [0, 0, 0], swap }, dt).position[0];
    const first = x(1 / 60, true);
    expect(first).toBeGreaterThan(-SHOULDER.right);
    expect(first).toBeLessThan(SHOULDER.right); // eased, not cut
    expect(x(1)).toBeCloseTo(SHOULDER.right, 2);
    expect(camera.code()).toBe('cam3=shoulder,0,0,3.8,-1');
    expect(createShoulderCamera(parseShoulderCode('cam3=shoulder,0,0,3.8,-1')).update({ follow: [0, 0, 0] }).position[0]).toBeCloseTo(SHOULDER.right, 9); // prettier-ignore
  });

  it('looks along the sim’s look when given, and the devices turn it otherwise', () => {
    const camera = createShoulderCamera();
    const pose = camera.update({ follow: [0, 0, 0], view: [Math.PI / 2, -0.3] }, 1 / 60);
    expect([pose.yaw, pose.pitch]).toEqual([Math.PI / 2, -0.3]);
    const turned = camera.update({ follow: [0, 0, 0], look: [0.1, 0.05] }, 1 / 60);
    expect(turned.yaw).toBeCloseTo(Math.PI / 2 - 0.1, 9);
    expect(turned.pitch).toBeCloseTo(-0.25, 9);
  });

  it('pulls the arm in to 1.5 m with the sights raised, and takes the player’s lens', () => {
    const camera = createShoulderCamera();
    camera.update({ follow: [0, 0, 0] }, 1 / 60);
    let pose = camera.pose();
    for (let k = 0; k < 60; k++) pose = camera.update({ follow: [0, 0, 0], aim: 1, lens: 80 }, 1 / 60);
    expect(pose.position[2]).toBeCloseTo(-SHOULDER.aim, 2);
    expect(pose.fov).toBe(80);
  });

  it('backing into a wall, never jumps, never stands in it and keeps his chest in the picture', () => {
    const queries = walls();
    const camera = createShoulderCamera();
    let last = camera.update({ follow: [0, 0, 3], queries }, 1 / 60);
    for (let k = 1; k <= 150; k++) {
      const feet: Vec3 = [0, 0, 3 - k * 0.03]; // backing up to 0.5 m from the wall
      const pose = camera.update({ follow: feet, queries }, 1 / 60);
      const moved = Math.hypot(...pose.position.map((v, i) => v - last.position[i]));
      expect(moved).toBeLessThan(0.03 + 0.3);
      expect(queries.overlap({ type: 'ball', radius: COLLIDE_RADIUS - 0.03 }, pose.position, { groups: 'world' })).toEqual([]); // prettier-ignore
      expect(inPicture(pose, [feet[0], feet[1] + 1.2, feet[2]]), `frame ${k}`).toBe(true);
      last = pose;
    }
    expect(last.position[2]).toBeGreaterThan(-3 + COLLIDE_RADIUS);
    expect(Math.abs(last.position[0] - poseRight(last)[0] * -SHOULDER.right)).toBeGreaterThan(0.2); // drawn in toward the eye
  });

  it('refuses a side that is not 1 or -1, and reads and writes its codes', () => {
    expect(() => shoulderState({ side: 0 })).toThrow(/GFX_BAD_CAMERA.*side is 0/);
    expect(parseShoulderCode('cam3=shoulder')).toEqual({ type: 'shoulder' });
    expect(formatShoulderCode(parseShoulderCode('cam3=shoulder,90,-10,2.5'))).toBe('cam3=shoulder,90,-10,2.5');
    expect(() => parseShoulderCode('cam3=shoulder,0,0')).toThrow(/GFX_BAD_CAMERA_CODE/);
  });
});
