/**
 * @file Unit tests for the platformer's camera (engine/gfx/cameras/follow.ts): 5.5 m back and 20° down from the eye;
 * the devices orbit it; it recentres behind the movement after 1.5 s without look input, at most 1.5 rad/s; the pivot
 * leads by 1 m at a run; a jump within the dead zone keeps the frame still and a fall beyond carries it; a slope that
 * cuts the arm lifts the camera over it; codes round-trip.
 * @see engine/gfx/cameras/follow.ts
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { createPhysics } from '../../physics/world';
import { queryView } from '../../sim/queryView';
import type { CameraPlayer } from './effects';
import { createFollowCamera, FOLLOW_RIG, followState, formatFollowCode, parseFollowCode, stepFollow } from './follow';
import { poseTarget, type Vec3 } from './pose';

const DEG = Math.PI / 180;

/** A player moving at `velocity`, standing or not. */
const moving = (velocity: Vec3, grounded = true): CameraPlayer => ({ velocity, grounded, mode: grounded ? 'ground' : 'air', sprinting: false, sliding: false, boosted: false, aiming: false }); // prettier-ignore

describe('the platformer camera', () => {
  it('stands 5.5 m back and 20° down from the eye, and the devices orbit it', () => {
    const camera = createFollowCamera();
    const pose = camera.update({ follow: [0, 0, 0] }, 1 / 60);
    const [x, y, z] = pose.position;
    expect([x, y, z]).toEqual([0, expect.closeTo(FOLLOW_RIG.height + 5.5 * Math.sin(20 * DEG), 6), expect.closeTo(-5.5 * Math.cos(20 * DEG), 6)]); // prettier-ignore
    expect(camera.code()).toBe('cam3=follow,0,-20,5.5');
    const turned = camera.update({ follow: [0, 0, 0], look: [0.5, 0] }, 1 / 60);
    expect(turned.yaw).toBeCloseTo(-0.5, 9);
  });

  it('recentres behind the movement after 1.5 s without look input, at most 1.5 rad/s', () => {
    let state = followState({ yaw: 0 });
    const east = moving([5, 0, 0]);
    const yaws: number[] = [];
    for (let k = 0; k < 240; k++) {
      state = stepFollow(state, { follow: [k * 0.08, 0, 0], player: east, ...(k === 0 ? { look: [0.001, 0] as const } : {}) }, 1 / 60); // prettier-ignore
      yaws.push(state.yaw);
    }
    expect(Math.abs(yaws[85] - yaws[0])).toBeLessThan(0.01); // waits for 1.5 s
    const fastest = Math.max(...yaws.slice(1).map((y, k) => Math.abs(y - yaws[k])));
    expect(fastest).toBeLessThanOrEqual(FOLLOW_RIG.recentre / 60 + 1e-9);
    expect(yaws[239]).toBeGreaterThan(Math.PI / 2 - 0.2); // turned behind a run east (+X: yaw π/2)
  });

  it('leads a run by 1 m, keeps still through a jump in the dead zone and follows a fall beyond it', () => {
    let state = followState({ yaw: Math.PI / 2 });
    for (let k = 0; k < 120; k++) state = stepFollow(state, { follow: [k * 0.085, 0, 0], player: moving([5.1, 0, 0]) }, 1 / 60); // prettier-ignore
    expect(state.lead[0]).toBeCloseTo(FOLLOW_RIG.ahead, 1);
    const ground = state.base![1];
    state = stepFollow(state, { follow: [10, 1.2, 0], player: moving([0, 1, 0], false) }, 1 / 60); // a jump's top
    expect(state.base![1]).toBeCloseTo(ground, 6);
    state = stepFollow(state, { follow: [10, -3, 0], player: moving([0, -10, 0], false) }, 1 / 60); // a fall
    expect(state.base![1]).toBeCloseTo(-3 + FOLLOW_RIG.zone + FOLLOW_RIG.height, 6); // carried at the zone's edge
  });

  it('lifts over a slope that cuts its arm, and lets it go when clear', () => {
    const physics = createPhysics();
    const slope = { type: 'box', size: [20, 1, 20] } as const;
    physics.addBody({ type: 'fixed', position: [0, 0, -10], rotation: [Math.sin(-0.3), 0, 0, Math.cos(-0.3)], colliders: [{ shape: slope }] }); // prettier-ignore
    physics.step({ dt: 1 / 60, settings: createSettings().sim });
    const queries = queryView(physics);
    let state = followState({ yaw: 0 });
    for (let k = 0; k < 90; k++) state = stepFollow(state, { follow: [0, 0.6, 0], queries }, 1 / 60);
    expect(state.lift).toBeGreaterThan(0.2);
    expect(state.lift).toBeLessThanOrEqual(FOLLOW_RIG.lift);
    const target = poseTarget(createFollowCamera().update({ follow: [0, 0, 0] }));
    expect(target[1]).toBeCloseTo(FOLLOW_RIG.height, 6);
  });

  it('reads and writes its codes', () => {
    expect(parseFollowCode('cam3=follow')).toEqual({ type: 'follow' });
    expect(formatFollowCode(parseFollowCode('cam3=follow,45,-30,8'))).toBe('cam3=follow,45,-30,8');
    expect(() => parseFollowCode('cam3=follow,0,-100,5')).toThrow(/GFX_BAD_CAMERA_CODE.*pitch/);
  });
});
