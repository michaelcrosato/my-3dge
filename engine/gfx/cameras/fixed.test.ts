/**
 * @file Unit tests for the fixed camera (`engine/gfx/cameras/fixed.ts`): it ignores every input but zoom, keeps the
 * place and lens of the camera it fixes (an orthographic view becoming a perspective camera on its line of sight),
 * and refuses bad numbers.
 */
import { describe, expect, it } from 'vitest';
import { createFixedCamera, fixedState, stepFixed } from './fixed';
import { FLY_FOV, FLY_FOV_RANGE } from './fly';
import { frameSize, makePose, poseForward, poseTarget } from './pose';
import { createViewCamera } from './presets';

describe('the fixed camera', () => {
  it('stays where it is put whatever the input but zoom', () => {
    const fixed = createFixedCamera({ position: [1, 2, 3], yaw: 0.5, pitch: -0.25, fov: 60 });
    const before = fixed.pose();
    const after = fixed.update({ move: [1, 1, 1], look: [1, 1], turn: [1, 1], follow: [9, 9, 9], turnSteps: 3 }, 2);
    expect(after).toEqual(before);
    expect(fixed.update({ zoom: 1 }).fov).toBe(55);
    const state = fixedState({ position: [0, 0, 0] });
    expect(stepFixed(state, {})).toBe(state);
    expect(stepFixed(state, { zoom: -99 }).fov).toBe(FLY_FOV_RANGE[1]);
  });

  it("fixes the camera on screen: a perspective one's place and lens, an orthographic view's line of sight", () => {
    const from = makePose({ position: [3, 4, 5], yaw: 1, pitch: -0.2, fov: 45 });
    expect(createFixedCamera({ from }).pose()).toMatchObject({ position: [3, 4, 5], yaw: 1, pitch: -0.2, fov: 45 });
    const view = createViewCamera({ view: 'threequarter', target: [2, 0, 2] }).pose();
    const fixed = createFixedCamera({ from: view }).pose();
    expect(fixed).toMatchObject({ projection: 'perspective', fov: FLY_FOV });
    expect(poseForward(fixed)[1]).toBeCloseTo(poseForward(view)[1], 12);
    const distance = Math.hypot(...fixed.position.map((v, i) => v - [2, 0, 2][i]));
    const at = poseTarget({ ...fixed, distance });
    at.forEach((v, i) => expect(v).toBeCloseTo([2, 0, 2][i], 9));
    expect(frameSize({ ...fixed, distance }, 1).height).toBeCloseTo(frameSize(view, 1).height, 9);
  });

  it('refuses bad numbers', () => {
    expect(() => createFixedCamera({ position: [0, 0, 0], fov: 200 })).toThrow(
      /\[GFX_BAD_CAMERA\] the fixed camera: fov is 200/,
    );
  });
});
