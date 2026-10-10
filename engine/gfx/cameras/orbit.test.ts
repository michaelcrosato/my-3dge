/**
 * @file Unit tests for the orbit camera (`engine/gfx/cameras/orbit.ts`): its position on the sphere and its look at
 * the target, turning right and up as OrbitControls does, rates per second, zoom steps within the distance limits,
 * the elevation limits, following, a fixed target, and its yaw driving the intents' `fromCamera`.
 */
import { describe, expect, it } from 'vitest';
import { fromCamera } from '../../input/intents';
import {
  createOrbitCamera,
  ORBIT_DEFAULTS,
  ORBIT_FOV,
  ORBIT_LIFT,
  ORBIT_LIMITS,
  ORBIT_TURN_SPEED,
  ORBIT_ZOOM_STEP,
  orbitPose,
  orbitState,
  stepOrbit,
} from './orbit';
import { lookAt, poseForward, poseTarget } from './pose';

const DEG = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('the orbit camera', () => {
  it('stands on its sphere round the target and looks at it, in perspective', () => {
    const orbit = createOrbitCamera({ azimuth: 90 * DEG, elevation: 30 * DEG, distance: 10, target: [1, 0, 2] });
    const pose = orbit.pose();
    close(pose.position, [1 + 10 * Math.cos(30 * DEG), 5, 2]); // azimuth 90°: on the +X side
    close(poseTarget(pose), [1, 0, 2]);
    expect(lookAt(pose.position, [1, 0, 2]).distance).toBeCloseTo(10, 12);
    expect(pose).toMatchObject({ projection: 'perspective', fov: ORBIT_FOV, boost: 1 });
    expect(orbit.yaw()).toBeCloseTo(-90 * DEG, 12); // looking along −X
  });

  it("starts at lab3d's place and follows a point raised by ORBIT_LIFT", () => {
    const orbit = createOrbitCamera();
    expect(orbit.spec()).toMatchObject({ azimuth: ORBIT_DEFAULTS.azimuth, distance: 17 });
    orbit.update({ follow: [4, 0, 4] }, 1 / 60);
    close(poseTarget(orbit.pose()), [4, ORBIT_LIFT, 4]);
    orbit.update({ follow: [5, 0, 4] }, 0.2);
    expect(poseTarget(orbit.pose())[0]).toBeCloseTo(4 + (1 - Math.exp(-1)), 9);
  });

  it('look and turn right lower the azimuth, up lowers the elevation; rates count per second', () => {
    const state = orbitState({ azimuth: 0, elevation: 45 * DEG, distance: 10, target: [0, 0, 0] });
    const right = stepOrbit(state, { look: [0.2, 0] }, 0);
    expect(right.azimuth).toBeCloseTo(-0.2, 12);
    expect(orbitPose(right).yaw).toBeCloseTo(Math.PI - 0.2, 12); // the view turned right
    const up = stepOrbit(state, { look: [0, 0.1] }, 0);
    expect(up.elevation).toBeCloseTo(45 * DEG - 0.1, 12);
    expect(orbitPose(up).pitch).toBeGreaterThan(orbitPose(state).pitch); // the view tilted up
    const held = stepOrbit(state, { turn: [1, -1] }, 0.5);
    expect(held.azimuth).toBeCloseTo(-ORBIT_TURN_SPEED[0] * 0.5, 12);
    expect(held.elevation).toBeCloseTo(45 * DEG + ORBIT_TURN_SPEED[1] * 0.5, 12);
  });

  it('zoom steps divide the distance by ORBIT_ZOOM_STEP; distance and elevation stay within the limits', () => {
    const state = orbitState({ distance: 10, target: [0, 0, 0] });
    expect(stepOrbit(state, { zoom: 2 }, 0).distance).toBeCloseTo(10 / ORBIT_ZOOM_STEP ** 2, 12);
    expect(stepOrbit(state, { zoom: -100 }, 0).distance).toBe(ORBIT_LIMITS.distance[1]);
    expect(stepOrbit(state, { zoom: 100 }, 0).distance).toBe(ORBIT_LIMITS.distance[0]);
    expect(stepOrbit(state, { look: [0, -10] }, 0).elevation).toBe(ORBIT_LIMITS.elevation[1]);
    expect(stepOrbit(state, { look: [0, 10] }, 0).elevation).toBe(ORBIT_LIMITS.elevation[0]);
  });

  it('a fixed orbit ignores the follow; its yaw walks W away from the camera', () => {
    const orbit = createOrbitCamera({ azimuth: 1, elevation: 0.5, distance: 8, target: [0, 1, 0] });
    orbit.update({ follow: [9, 9, 9], look: [0.3, 0] }, 1);
    close(poseTarget(orbit.pose()), [0, 1, 0]);
    const f = poseForward(orbit.pose());
    const level = Math.hypot(f[0], f[2]);
    close(fromCamera(orbit.yaw(), [0, 1]), [f[0] / level, f[2] / level], 12);
  });

  it('refuses numbers out of range, naming each', () => {
    expect(() => createOrbitCamera({ elevation: 2, distance: 0 })).toThrow(
      /\[GFX_BAD_CAMERA\] the orbit camera: elevation is 2; .*distance is 0/,
    );
    expect(() => createOrbitCamera({ fov: Number.NaN })).toThrow(/fov is NaN/);
  });
});
