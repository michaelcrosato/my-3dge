/**
 * @file Unit tests for camera poses (`engine/gfx/cameras/pose.ts`): the directions are an orthonormal frame in the
 * conventions of PLAN.md §6.3 (forward(ψ) along +Z at yaw 0, right = forward × up, the intents' `fromCamera` agreeing),
 * `lookAt` and `orbitPoint` invert each other, frame sizes for both projections, `perspectiveFrom` keeps the framing,
 * `makePose` refuses bad numbers naming each, and `cameraFrom` checks `dt`.
 */
import { describe, expect, it } from 'vitest';
import { fromCamera } from '../../input/intents';
import {
  approach,
  frameSize,
  headingOf,
  lookAt,
  makePose,
  orbitPoint,
  perspectiveFrom,
  poseForward,
  poseRight,
  poseTarget,
  poseUp,
  wrapAngle,
  type Vec3,
} from './pose';
import { createViewCamera } from './presets';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const close = (a: readonly number[], b: readonly number[], digits = 12) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('directions', () => {
  it('yaw 0 looks along +Z, π/2 along +X; right is forward × up; up is right × forward', () => {
    close(poseForward({ yaw: 0, pitch: 0 }), [0, 0, 1]);
    close(poseForward({ yaw: Math.PI / 2, pitch: 0 }), [1, 0, 0]);
    close(poseRight({ yaw: 0 }), [-1, 0, 0]);
    close(poseForward({ yaw: 0, pitch: -Math.PI / 2 }), [0, -1, 0]);
    close(poseUp({ yaw: 0, pitch: -Math.PI / 2 }), [0, 0, 1]); // straight down: up on screen is the heading
    for (const [yaw, pitch] of [
      [0.3, -0.4],
      [2.5, 0.7],
      [-1.9, -1.2],
      [Math.PI, 0],
    ]) {
      const f = poseForward({ yaw, pitch });
      const r = poseRight({ yaw });
      const u = poseUp({ yaw, pitch });
      expect(dot(f, f)).toBeCloseTo(1, 12);
      expect(dot(r, r)).toBeCloseTo(1, 12);
      expect(dot(u, u)).toBeCloseTo(1, 12);
      expect(dot(f, r)).toBeCloseTo(0, 12);
      expect(dot(f, u)).toBeCloseTo(0, 12);
      close(
        cross(f, [0, 1, 0]).map((v) => v / Math.cos(pitch)),
        r,
      );
      close(cross(r, f), u);
      expect(u[1]).toBeGreaterThanOrEqual(0); // never upside down
    }
  });

  it("agrees with the intents' fromCamera: W walks along the camera's level forward, D along its right", () => {
    for (const yaw of [0, 0.8, -2.2, Math.PI]) {
      const f = poseForward({ yaw, pitch: -0.6 });
      const level = Math.hypot(f[0], f[2]);
      close(fromCamera(yaw, [0, 1]), [f[0] / level, f[2] / level]);
      const r = poseRight({ yaw });
      close(fromCamera(yaw, [1, 0]), [r[0], r[2]]);
    }
  });
});

describe('lookAt, orbitPoint, headingOf', () => {
  it('a camera at orbitPoint(target, azimuth, elevation, d) looks at the target with heading azimuth + π', () => {
    const target: Vec3 = [2, 1, -3];
    for (const [azimuth, elevation, d] of [
      [0, 0.5, 10],
      [Math.PI / 4, Math.PI / 6, 20],
      [-2, 1.2, 3],
    ]) {
      const at = orbitPoint(target, azimuth, elevation, d);
      const look = lookAt(at, target);
      expect(look.distance).toBeCloseTo(d, 12);
      expect(look.pitch).toBeCloseTo(-elevation, 12);
      expect(wrapAngle(look.yaw - headingOf(azimuth))).toBeCloseTo(0, 12);
      close(poseTarget(makePose({ position: at, yaw: look.yaw, pitch: look.pitch, distance: d })), target);
    }
    close(orbitPoint([0, 0, 0], 0, 0, 5), [0, 0, 5]); // azimuth 0: on +Z, as Spherical's theta
    close(orbitPoint([0, 0, 0], Math.PI / 2, 0, 5), [5, 0, 0]);
    expect(lookAt([0, 5, 0], [0, 0, 0])).toEqual({ yaw: 0, pitch: -Math.PI / 2, distance: 5 });
  });

  it('wrapAngle wraps into (−π, π]', () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-0.5)).toBe(-0.5);
    expect(wrapAngle(7)).toBeCloseTo(7 - 2 * Math.PI, 12);
  });
});

describe('frames', () => {
  it('orthographic: the frustum over the zoom; perspective: the lens at the target distance', () => {
    const ortho = makePose({ position: [0, 0, 0], projection: 'orthographic', frustumSize: 12, zoom: 1.5 });
    expect(frameSize(ortho, 2)).toEqual({ width: 16, height: 8 });
    const persp = makePose({ position: [0, 0, 0], fov: 90, distance: 5, zoom: 2 });
    expect(frameSize(persp, 1).height).toBeCloseTo(5, 12);
  });

  it('perspectiveFrom keeps a perspective pose, and frames an orthographic one from its line of sight', () => {
    const persp = makePose({ position: [1, 2, 3], yaw: 0.5, pitch: -0.2 });
    expect(perspectiveFrom(persp, 70)).toEqual({ position: persp.position, yaw: 0.5, pitch: -0.2 });
    const iso = createViewCamera({ view: 'iso', target: [4, 0, 4], zoom: 2 }).pose();
    const from = perspectiveFrom(iso, 60);
    const moved = makePose({ ...from, fov: 60, distance: lookAt(from.position, [4, 0, 4]).distance });
    close(poseTarget(moved), [4, 0, 4]);
    expect(frameSize(moved, 1).height).toBeCloseTo(frameSize(iso, 1).height, 9);
  });

  it('approach moves the share k of the way', () => {
    expect(approach([0, 0, 0], [10, -4, 2], 0.25)).toEqual([2.5, -1, 0.5]);
  });
});

describe('makePose', () => {
  it('fills defaults, freezes, and refuses bad numbers naming every field', () => {
    const pose = makePose({ position: [0, 1, 2] });
    expect(pose).toMatchObject({
      yaw: 0,
      pitch: 0,
      projection: 'perspective',
      fov: 50,
      zoom: 1,
      boost: 1,
      near: 0.1,
      far: 2000,
    });
    expect(Object.isFrozen(pose) && Object.isFrozen(pose.position)).toBe(true);
    expect(() => makePose({ position: [0, Number.NaN, 0], fov: 0, pitch: 2, far: 0.01 })).toThrow(
      /\[GFX_BAD_CAMERA\] makePose: position is \[0,null,0\].*pitch is 2.*fov is 0.*far is 0.01/,
    );
    expect(() => makePose({ position: [0, 0, 0], projection: 'fisheye' as 'perspective' })).toThrow(
      /projection is "fisheye"/,
    );
  });

  it("cameraFrom refuses a negative or non-finite dt, and a camera's yaw is wrapped", () => {
    const view = createViewCamera({ view: 'iso' });
    expect(() => view.update({}, -1)).toThrow(/\[GFX_BAD_CAMERA\] view camera update: dt is -1/);
    expect(() => view.update({}, Number.POSITIVE_INFINITY)).toThrow(/dt is Infinity/);
    expect(view.yaw()).toBeCloseTo(-3 * (Math.PI / 4), 12); // iso stands at 45°: it looks along −X −Z
  });
});
