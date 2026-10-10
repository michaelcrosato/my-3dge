/**
 * @file Unit tests for the fly camera (`engine/gfx/cameras/fly.ts`): it flies along its view direction, strafes along
 * its right, climbs straight up, at its speeds per real second; looks and turns right and up; keeps its pitch, lens
 * and bounds; starts from another camera's pose; and its yaw drives the intents' `fromCamera`.
 */
import { describe, expect, it } from 'vitest';
import { fromCamera } from '../../input/intents';
import {
  createFlyCamera,
  FLY_FAST_SPEED,
  FLY_FOV,
  FLY_FOV_RANGE,
  FLY_MAX_PITCH,
  FLY_SPEED,
  FLY_TURN_SPEED,
  flyState,
  stepFly,
} from './fly';
import { makePose, poseForward, poseRight } from './pose';
import { createViewCamera } from './presets';

const close = (a: readonly number[], b: readonly number[], digits = 9) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe('the fly camera', () => {
  it('flies where it looks, strafes along its right, climbs straight up, at FLY_SPEED (FLY_FAST_SPEED fast)', () => {
    const state = flyState({ position: [0, 2, 0], yaw: 0.7, pitch: -0.4 });
    const f = poseForward(state);
    const r = poseRight(state);
    close(stepFly(state, { move: [0, 1, 0] }, 0.5).position, [f[0] * 2, 2 + f[1] * 2, f[2] * 2]);
    close(stepFly(state, { move: [1, 0, 0] }, 0.5).position, [r[0] * 2, 2, r[2] * 2]);
    close(stepFly(state, { move: [0, 0, 1] }, 0.5).position, [0, 2 + FLY_SPEED * 0.5, 0]);
    close(stepFly(state, { move: [0, 0, -1], fast: true }, 0.1).position, [0, 2 - FLY_FAST_SPEED * 0.1, 0]);
    expect(FLY_SPEED).toBe(64 / 16); // the prototype's 64 units/s
  });

  it('the same real time in many frames flies as far as in one', () => {
    let many = flyState({ position: [0, 1, 0] });
    for (let i = 0; i < 60; i++) many = stepFly(many, { move: [0.5, 1, 0] }, 1 / 60);
    close(many.position, stepFly(flyState({ position: [0, 1, 0] }), { move: [0.5, 1, 0] }, 1).position, 12);
  });

  it('look turns right and up at once; turn at FLY_TURN_SPEED; the pitch stops at ±FLY_MAX_PITCH', () => {
    const state = flyState({ position: [0, 1, 0], yaw: 0, pitch: 0 });
    const looked = stepFly(state, { look: [0.25, 0.1] }, 0);
    expect(looked.yaw).toBeCloseTo(-0.25, 12); // right: the heading falls (yaw 0 looks along +Z, right is −X)
    expect(looked.pitch).toBeCloseTo(0.1, 12);
    const turned = stepFly(state, { turn: [-1, 1] }, 0.5);
    expect(turned.yaw).toBeCloseTo(FLY_TURN_SPEED[0] * 0.5, 12);
    expect(turned.pitch).toBeCloseTo(FLY_TURN_SPEED[1] * 0.5, 12);
    expect(stepFly(state, { look: [0, 9] }, 0).pitch).toBe(FLY_MAX_PITCH);
    expect(stepFly(state, { look: [0, -9] }, 0).pitch).toBe(-FLY_MAX_PITCH);
    expect(stepFly(state, { look: [4, 0] }, 0).yaw).toBeCloseTo(-4 + 2 * Math.PI, 12); // wrapped into (−π, π]
  });

  it('zoom narrows the lens 5° a step within FLY_FOV_RANGE; bounds hold the position', () => {
    const state = flyState({ position: [0, 1, 0], bounds: { min: [-1, 0.5, -1], max: [1, 3, 1] } });
    expect(state.fov).toBe(FLY_FOV);
    expect(stepFly(state, { zoom: 2 }, 0).fov).toBe(FLY_FOV - 10);
    expect(stepFly(state, { zoom: -99 }, 0).fov).toBe(FLY_FOV_RANGE[1]);
    expect(stepFly(state, { move: [0, 1, -1], fast: true }, 10).position).toEqual([0, 0.5, 1]);
    expect(flyState({ position: [5, 5, 5], bounds: state.bounds ?? undefined }).position).toEqual([1, 3, 1]);
  });

  it("starts from another camera's pose: a perspective one's place, an orthographic view's line of sight", () => {
    const from = makePose({ position: [3, 4, 5], yaw: 1, pitch: -0.2, fov: 50 });
    expect(createFlyCamera({ from }).pose()).toMatchObject({ position: [3, 4, 5], yaw: 1, pitch: -0.2, fov: FLY_FOV });
    const iso = createViewCamera({ view: 'iso', target: [0, 0, 0] }).pose();
    const fly = createFlyCamera({ from: iso }).pose();
    close(poseForward(fly), poseForward(iso), 12);
    expect(Math.hypot(...fly.position)).toBeLessThan(20); // near the target, not 60 m back
    expect(createFlyCamera().pose().position).toEqual([0, 1.7, 0]);
  });

  it('its yaw walks W away from the camera, and it refuses bad numbers', () => {
    const fly = createFlyCamera({ position: [0, 1, 0], yaw: -2.4, pitch: 0.3 });
    const f = poseForward(fly.pose());
    const level = Math.hypot(f[0], f[2]);
    close(fromCamera(fly.yaw(), [0, 1]), [f[0] / level, f[2] / level], 12);
    expect(() => createFlyCamera({ position: [0, Number.NaN, 0] })).toThrow(
      /\[GFX_BAD_CAMERA\] the fly camera: position/,
    );
    expect(() => createFlyCamera({ pitch: 3 })).toThrow(/pitch is 3/);
  });
});
