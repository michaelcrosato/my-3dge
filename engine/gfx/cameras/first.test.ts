/**
 * @file Unit tests for the first-person camera (`engine/gfx/cameras/first.ts`): it sits at the head socket (the eye
 * sockets' midpoint, through FK) or eye height without a rig, follows the eye across at once and up and down with its
 * lag (never more than `FIRST_TRAIL` behind), turns and zooms within its limits, looks along the sim's look and takes
 * the player's lens when given, starts from the camera before it, drives the intents' `fromCamera`; the near-body
 * culling hides the body but the hands, and anything near the eye; its codes round-trip.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { forwardKinematics, jointPosition, socketPosition, tipPosition } from '../../anim/fk';
import { Pose } from '../../anim/pose';
import { createSkeleton, JOINTS } from '../../anim/skeleton';
import { fromCamera } from '../../input/intents';
import {
  createFirstCamera,
  eyePoint,
  FIRST_BOB_LAG,
  FIRST_DEFAULTS,
  FIRST_EYE_HEIGHT,
  FIRST_NEAR_BODY,
  FIRST_TRAIL,
  firstState,
  formatFirstCode,
  nearBodyCull,
  parseFirstCode,
  stepFirst,
} from './first';
import { FLY_FOV_RANGE, FLY_MAX_PITCH } from './fly';
import type { CameraPose, Vec3 } from './pose';

const DEG = Math.PI / 180;
const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

/** A heroic skeleton standing at `at`, turned `turn` rad about +Y, in its rest pose, and its FK. */
function rig(at: Vec3 = [3, 0, 2], turn = 0) {
  const skeleton = createSkeleton('build:heroic');
  const pose = new Pose();
  pose.rootPos.set(...at);
  pose.rootRot.setFromAxisAngle(new Vector3(0, 1, 0), turn);
  return { skeleton, world: forwardKinematics(skeleton, pose) };
}

describe('the first-person camera', () => {
  it('sits at the head socket: the midpoint of the eye sockets', () => {
    const { skeleton, world } = rig([3, 0, 2], Math.PI / 2);
    const eye = eyePoint(skeleton, world);
    const l = socketPosition(skeleton, world, 'eyeL');
    const r = socketPosition(skeleton, world, 'eyeR');
    close(eye, [(l.x + r.x) / 2, (l.y + r.y) / 2, (l.z + r.z) / 2], 12);
    expect(eye[0]).toBeGreaterThan(3); // turned to face +X, the eyes are ahead of the head on +X
    const first = createFirstCamera();
    close(first.update({ eye }, 1 / 60).position, eye, 12); // the first eye snaps
  });

  it('follows the eye across at once and up and down with FIRST_BOB_LAG, the same at any frame rate', () => {
    const a = createFirstCamera();
    const b = createFirstCamera();
    a.update({ eye: [0, 1.7, 0] }, 1 / 60);
    b.update({ eye: [0, 1.7, 0] }, 1 / 60);
    a.update({ eye: [1, 1.8, 0] }, FIRST_BOB_LAG);
    for (let i = 0; i < 8; i++) b.update({ eye: [1, 1.8, 0] }, FIRST_BOB_LAG / 8);
    for (const camera of [a, b]) close(camera.pose().position, [1, 1.7 + 0.1 * (1 - Math.exp(-1)), 0], 12);
  });

  it('stands FIRST_EYE_HEIGHT above the followed point without a rig', () => {
    close(createFirstCamera().update({ follow: [2, 0.5, -1] }).position, [2, 0.5 + FIRST_EYE_HEIGHT, -1]);
  });

  it('never trails the eye by more than FIRST_TRAIL, looks along the sim’s look, and takes the player’s lens', () => {
    const first = createFirstCamera();
    first.update({ eye: [0, 1.5, 0] }, 1 / 60);
    expect(first.update({ eye: [0, 0.5, 0] }, 1 / 60).position[1]).toBeCloseTo(0.5 + FIRST_TRAIL, 12); // a fall
    expect(first.update({ eye: [0, 0.5, 0], view: [1, -0.4] }, 1 / 60)).toMatchObject({ yaw: 1, pitch: -0.4 });
    expect(first.update({ eye: [0, 0.5, 0], lens: 80 }, 1 / 60).fov).toBe(80);
    expect(first.update({ eye: [0, 0.5, 0], lens: 80, zoom: 1 }, 1 / 60).fov).toBe(75); // the wheel narrows it still
    expect(first.update({ eye: [0, 0.5, 0], lens: 90 }, 1 / 60).fov).toBe(85);
  });

  it('turns right and up with look and turn, narrows its lens with zoom, within its limits', () => {
    const state = firstState({ yaw: 0, pitch: 0 });
    expect(stepFirst(state, { look: [0.3, 0.2] }, 0)).toMatchObject({ yaw: -0.3, pitch: 0.2 });
    expect(stepFirst(state, { turn: [0, 1] }, 0.5).pitch).toBeCloseTo(0.6, 12);
    expect(stepFirst(state, { look: [0, 9] }, 0).pitch).toBe(FLY_MAX_PITCH);
    expect(stepFirst(state, { zoom: 2 }, 0).fov).toBe(FIRST_DEFAULTS.fov - 10);
    expect(stepFirst(state, { zoom: -99 }, 0).fov).toBe(FLY_FOV_RANGE[1]);
    expect(createFirstCamera().pose()).toMatchObject({ projection: 'perspective', fov: 75, pitch: -0.08 });
  });

  it('starts looking where the camera before it looked, and its yaw drives fromCamera', () => {
    const first = createFirstCamera({ from: { yaw: -2, pitch: -0.2 } as CameraPose });
    expect(first.pose()).toMatchObject({ yaw: -2, pitch: -0.2 });
    close(fromCamera(first.yaw(), [0, 1]), [Math.sin(-2), Math.cos(-2)], 12); // W walks where it looks
  });

  it('culls the body but the hands, and any part near the eye (near-body culling)', () => {
    const { skeleton, world } = rig();
    const eye = eyePoint(skeleton, world);
    const hidden = nearBodyCull(skeleton, world, eye);
    expect(hidden).toEqual(JOINTS.filter((joint) => joint !== 'handL' && joint !== 'handR'));
    const near = nearBodyCull(skeleton, world, eye, { show: JOINTS }); // a "true first person" body
    expect(near).toContain('head');
    expect(near).toContain('neck');
    for (const kept of ['pelvis', 'thighL', 'footR', 'upperArmL', 'handR'] as const) expect(near).not.toContain(kept);
    for (const joint of JOINTS.filter((name) => !near.includes(name))) {
      const p = jointPosition(world, joint); // a part starts at its joint: a kept one is that far at least
      expect(Math.hypot(p.x - eye[0], p.y - eye[1], p.z - eye[2])).toBeGreaterThanOrEqual(FIRST_NEAR_BODY);
    }
    const hand = tipPosition(skeleton, world, 'handL').toArray() as unknown as Vec3; // the eye at the fingertips
    expect(nearBodyCull(skeleton, world, hand)).toContain('handL');
    expect(nearBodyCull(skeleton, world, hand)).not.toContain('handR');
  });

  it('round-trips its codes', () => {
    for (const code of ['cam3=first', 'cam3=first,0,-4.58,75', 'cam3=first,-90,10,60', 'cam3=first,180,-45,90']) {
      expect(formatFirstCode(parseFirstCode(code))).toBe(code);
    }
    expect(parseFirstCode('first,90,-30')).toEqual({ type: 'first', yaw: 90 * DEG, pitch: -30 * DEG });
    const first = createFirstCamera({ yaw: 1, pitch: -0.3, fov: 65 });
    const again = createFirstCamera(parseFirstCode(first.code()));
    expect(again.code()).toBe(first.code());
    expect(again.pose().yaw).toBeCloseTo(1, 3);
    expect(first.describe()).toBe('First person (perspective, 65° field of view), heading 57.3°, pitch -17.19°');
    expect(() => parseFirstCode('cam3=first,1,2,3,4')).toThrow(/takes 0, 2 or 3 numbers/);
    expect(() => parseFirstCode('cam3=first,0,0,500')).toThrow(/fov is 500/);
  });
});
