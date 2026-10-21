/**
 * @file Unit tests for engine/input/aim.ts (T1, WP 13.9): the ray through a point of the picture for a perspective and
 * an orthographic pose, with the boost's stretch undone; where a ray meets a floor; and the aim by each rule: the
 * centre's ray to what it meets beyond the player's eye, the pointer onto his floor, a right stick's push along it
 * (twin sticks, ahead of the pointer), and nothing for `none` or without a player.
 * @see engine/input/aim.ts
 */
import { describe, expect, it } from 'vitest';
import { AIM_RANGE, aimPoint, onFloor, screenRay, STICK_REACH, type AimPose, type Vec3 } from './aim';

/** Each number of `a` within 1e-9 of `b`'s. */
const close = (a: readonly number[] | null | undefined, b: readonly number[]) => {
  expect(a).toHaveLength(b.length);
  a!.forEach((value, i) => expect(value).toBeCloseTo(b[i], 9));
};

/** A camera 10 m up, straight down at heading 0, orthographic and 20 m tall at zoom 1. */
const top: AimPose = { position: [0, 10, 0], yaw: 0, pitch: -Math.PI / 2, projection: 'orthographic', fov: 50, frustumSize: 20, zoom: 1 }; // prettier-ignore

/** An eye 1.5 m up looking along +Z through a 90° lens. */
const eye: AimPose = { position: [0, 1.5, 0], yaw: 0, pitch: 0, projection: 'perspective', fov: 90, frustumSize: 0, zoom: 1 }; // prettier-ignore

describe('screenRay and onFloor', () => {
  it('run through the picture: the centre along the view, an edge through the lens’s, a zoom narrowing it', () => {
    close(screenRay(eye, [0, 0], 1).direction, [0, 0, 1]);
    const corner = screenRay(eye, [1, 1], 2).direction; // forward + 2 × right (−X facing +Z) + up, at length 1
    close(corner, [-2 / Math.sqrt(6), 1 / Math.sqrt(6), 1 / Math.sqrt(6)]);
    close(screenRay({ ...eye, zoom: 2 }, [0, 1], 1).direction, [0, 0.5 / Math.hypot(1, 0.5), 1 / Math.hypot(1, 0.5)]);
    const flat = screenRay(top, [0.5, 0], 1); // orthographic: the start moves across the picture, the ray points down
    close(flat.origin, [-5, 10, 0]);
    close(flat.direction, [0, -1, 0]);
    close(onFloor(flat, 0), [-5, 0, 0]);
  });

  it('meet true heights through a boosted picture, and miss a floor they run level with or away from', () => {
    const tilted: AimPose = { ...top, pitch: -Math.PI / 4, boost: 2 }; // heights drawn twice as tall
    const ray = screenRay(tilted, [0, 0], 1);
    close(onFloor(ray, 0), [0, 0, 10]); // the floor is drawn where it is
    close(onFloor(ray, 1), [0, 1, 8]); // the picture shows 1 m drawn 2 m up where the boosted ray meets 2 m
    expect(onFloor(screenRay(eye, [0, 0], 1), 0)).toBeNull(); // level with it
    expect(onFloor(screenRay(eye, [0, 1], 1), 0)).toBeNull(); // looking up, away from it
  });
});

describe('aimPoint', () => {
  it('aims the centre at what its ray meets beyond the eye, else as far as it looks', () => {
    const casts: [Vec3, Vec3, number][] = [];
    const meets = (at: number | null) => (origin: Vec3, direction: Vec3, max: number) => {
      casts.push([origin, direction, max]);
      return at;
    };
    close(aimPoint('centre', { pose: eye, aspect: 1, feet: [0, 0, 0], eye: [0, 1.5, 0], cast: meets(4) }), [0, 1.5, 4]);
    const behind: AimPose = { ...eye, position: [0, 1.8, -3.8] }; // a camera over his shoulder, 3.8 m back
    const view = { pose: behind, aspect: 1, feet: [0, 0, 0] as Vec3, eye: [0, 1.5, 0] as Vec3 };
    close(aimPoint('centre', { ...view, cast: meets(2) }), [0, 1.8, 2]);
    close(casts.at(-1)![0], [0, 1.8, 0]); // cast from abreast of his eye: never at what stands between them
    expect(casts.at(-1)![2]).toBeCloseTo(AIM_RANGE - 3.8, 9);
    close(aimPoint('centre', { ...view, cast: meets(null) }), [0, 1.8, AIM_RANGE - 3.8]);
    close(aimPoint('centre', view), [0, 1.8, AIM_RANGE - 3.8]); // no world to cast into
  });

  it('aims the pointer onto his floor, a pushed stick ahead of it along the picture, and nothing at rest', () => {
    const view = { pose: top, aspect: 1, feet: [2, 0.5, 3] as Vec3 };
    close(aimPoint('pointer', { ...view, pointer: [0, 0.5] }), [0, 0.5, 5]); // up the picture, on his floor
    close(aimPoint('pointer', { ...view, pointer: [0, 0.5], stick: [0, 0.3] }), [2, 0.5, 3 + STICK_REACH]); // stick first
    close(aimPoint('pointer', { ...view, stick: [1, 0] }), [2 - STICK_REACH, 0.5, 3]); // the picture's right: −X here
    expect(aimPoint('pointer', view)).toBeUndefined();
    expect(aimPoint('pointer', { ...view, pose: eye, pointer: [0, 0.5] })).toBeUndefined(); // above the horizon
  });

  it('aims nowhere by the rule none, or without a player', () => {
    expect(aimPoint('none', { pose: eye, aspect: 1, feet: [0, 0, 0], cast: () => 1 })).toBeUndefined();
    expect(aimPoint('centre', { pose: eye, aspect: 1, cast: () => 1 })).toBeUndefined();
    expect(aimPoint('pointer', { pose: top, aspect: 1, pointer: [0, 0] })).toBeUndefined();
  });
});
