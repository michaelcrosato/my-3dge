/**
 * @file Unit tests for placing cameras (`engine/gfx/cameras/place.ts`), in Node with three.js's real cameras: a placed
 * camera looks along the pose's forward with the pose's up, has the pose's lens or frustum and WebGPU's depth range;
 * the pair places the camera of each projection and never makes another; `createCamera` makes the camera a code
 * names and switches from the camera before it; and bad aspects or projections are refused.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { VIEW_NAMES } from './codes';
import { createCamera, createCameraPair, placeCamera } from './place';
import { makePose, poseForward, poseTarget, poseUp, type Vec3 } from './pose';
import { createViewCamera } from './presets';

const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('placeCamera', () => {
  it("aims a PerspectiveCamera along the pose's forward and up, with its lens", () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.2, -0.5],
      [-2.8, 0.9],
      [0.4, -Math.PI / 2],
    ]) {
      const pose = makePose({ position: [1, 2, 3], yaw, pitch, fov: 55, zoom: 1.5, near: 0.2, far: 80 });
      const camera = new PerspectiveCamera();
      placeCamera(pose, camera, 2);
      close(camera.getWorldDirection(new Vector3()).toArray(), poseForward(pose));
      close(new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(), poseUp(pose));
      close(camera.position.toArray(), [1, 2, 3]);
      expect(camera).toMatchObject({ fov: 55, aspect: 2, zoom: 1.5, near: 0.2, far: 80 });
      expect(camera.coordinateSystem).toBe(WebGPUCoordinateSystem);
    }
  });

  it("gives an OrthographicCamera the pose's frustum at the picture's aspect", () => {
    const pose = createViewCamera({ view: 'iso', target: [0, 0, 0], zoom: 2 }).pose();
    const camera = new OrthographicCamera();
    placeCamera(pose, camera, 1.5);
    expect(camera.top).toBeCloseTo(pose.frustumSize / 2, 12);
    expect(camera.bottom).toBeCloseTo(-pose.frustumSize / 2, 12);
    expect(camera.right).toBeCloseTo((pose.frustumSize / 2) * 1.5, 12);
    expect(camera.left).toBeCloseTo((-pose.frustumSize / 2) * 1.5, 12);
    expect(camera.zoom).toBe(2);
    // the target is drawn at the centre of the picture, depth inside WebGPU's 0 to 1
    const ndc = new Vector3(0, 0, 0).project(camera);
    close([ndc.x, ndc.y], [0, 0], 12);
    expect(ndc.z).toBeGreaterThan(0);
    expect(ndc.z).toBeLessThan(1);
  });

  it('refuses a bad aspect and a pose on the other projection', () => {
    const pose = makePose({ position: [0, 0, 0] });
    expect(() => placeCamera(pose, new PerspectiveCamera(), 0)).toThrow(/\[GFX_BAD_CAMERA\] placeCamera: aspect is 0/);
    expect(() => placeCamera(pose, new PerspectiveCamera(), Number.NaN)).toThrow(/aspect is NaN/);
    expect(() => placeCamera(pose, new OrthographicCamera(), 1)).toThrow(
      /a perspective pose goes on a PerspectiveCamera, not this OrthographicCamera/,
    );
  });
});

describe('createCameraPair', () => {
  it('places the camera of each projection, always the same two', () => {
    const pair = createCameraPair();
    const seen = new Set<object>();
    for (const view of VIEW_NAMES) {
      for (const projection of ['orthographic', 'perspective'] as const) {
        const pose = createViewCamera({ view, projection, target: [0, 0, 0] }).pose();
        const camera = pair.place(pose, 16 / 9);
        expect(camera).toBe(pose.projection === 'orthographic' ? pair.orthographic : pair.perspective);
        expect(camera.boost).toBe(pose.boost);
        seen.add(camera);
      }
    }
    for (const code of ['cam3=orbit', 'cam3=fly', 'cam3=fixed']) seen.add(pair.place(createCamera(code).pose(), 1));
    expect(seen.size).toBe(2);
  });
});

describe('createCamera', () => {
  it('makes the camera a code or its data names', () => {
    expect(createCamera('cam=brawler').type).toBe('view');
    expect(createCamera('cam3=orbit').type).toBe('orbit');
    expect(createCamera({ type: 'fly' }).type).toBe('fly');
    expect(createCamera('cam3=fixed').type).toBe('fixed');
    expect(() => createCamera('cam=nope')).toThrow(/GFX_UNKNOWN_CAMERA/);
  });

  it('switches from the camera before it: views and orbits start on its target, fly and fixed at its place', () => {
    const from = createViewCamera({ view: 'threequarter', target: [4, 0, -3] }).pose();
    const view = createCamera('cam=side', { from });
    close(poseTarget(view.pose()), [4, 0, -3]);
    view.update({ follow: [0, 0, 0] }, 0.18); // then it lags toward the followed point
    expect(poseTarget(view.pose())[0]).toBeCloseTo(4 * Math.exp(-1), 9);
    const orbit = createCamera('cam3=orbit', { from });
    close(poseTarget(orbit.pose()), [4, 0, -3]);
    expect(orbit.yaw()).toBeCloseTo(from.yaw, 12); // looking the same way
    expect(orbit.pose().pitch).toBeCloseTo(from.pitch, 12);
    const fly = createCamera('cam3=fly', { from, bounds: { min: [-1, 0, -1], max: [1, 2, 1] } });
    expect(fly.pose().position.every((v, i) => Math.abs(v) <= [1, 2, 1][i])).toBe(true);
    const fixed = createCamera('cam3=fixed', { from: fly.pose() });
    expect(fixed.pose().position).toEqual(fly.pose().position);
    // a code's own target wins over `from`
    const pinned = createCamera('cam=iso,0,1,1,0,1', { from });
    close(poseTarget(pinned.pose()), [1, 0, 1] as Vec3);
  });
});
