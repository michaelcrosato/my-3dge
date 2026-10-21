/**
 * @file Unit tests for the camera effects (engine/gfx/cameras/effects.ts): Apex's lens from its slider; the duck's share
 * and the eye on the shooter model; at rest nothing moves the pose; the sprint lowers the eye 0.15 m and rolls into a
 * turn up to 2°; a boosted slide widens the lens ×1.1 and rolls toward a slide across the view up to 15°; a landing
 * dips the view by its speed and springs back, a jump kicks it up, a hard landing shakes the screen; the sights zoom
 * to 55° at a 70° lens in 0.25 s; the bob dips once each 0.4 s at a run; a weapon's kick; each camera takes its share.
 * @see engine/gfx/cameras/effects.ts
 */
import { describe, expect, it } from 'vitest';
import {
  apexFov,
  applyEffects,
  CAMERA_EYE,
  cameraPlayer,
  createCameraEffects,
  crouchShare,
  EFFECTS,
  FIRST_EFFECTS,
  NO_EFFECTS,
  type CameraPlayer,
} from './effects';
import { makePose } from './pose';

const DEG = Math.PI / 180;

/** A player on the shooter model. */
const player = (fields: Partial<CameraPlayer> = {}): CameraPlayer => ({ velocity: [0, 0, 0], grounded: true, mode: 'ground', sprinting: false, sliding: false, boosted: false, aiming: false, ...fields }); // prettier-ignore

/** Runs `effects` for `seconds` at 60 frames a second, the view turning `turn` rad/s; the last frame. */
function run(effects: ReturnType<typeof createCameraEffects>, who: CameraPlayer, seconds: number, turn = 0) {
  let frame = effects.frame(0, { yaw: 0 });
  for (let k = 1; k <= Math.round(seconds * 60); k++) {
    effects.step(who);
    frame = effects.frame(1 / 60, { yaw: (turn * k) / 60 });
  }
  return frame;
}

describe('the camera effects', () => {
  it('take Apex’s lens from its slider, and the eye from the duck', () => {
    expect(apexFov(90)).toBeCloseTo(73.7398, 4);
    expect(apexFov(70)).toBeCloseTo(55.4129, 4);
    expect([crouchShare({ duck: 'standing' }), crouchShare({ duck: 'ducked' })]).toEqual([0, 1]);
    expect(crouchShare({ duck: 'ducking', duckLeft: 100, duckTotal: 400 })).toBe(0.75);
    expect(crouchShare({ duck: 'unducking', duckLeft: 50, duckTotal: 200 })).toBe(0.25);
    const actor = { vx: 1, vy: 0, vz: 2, grounded: true };
    expect(cameraPlayer({ id: 1, actor })).toMatchObject({ velocity: [1, 0, 2], mode: 'ground', sprinting: false });
    expect(cameraPlayer({ id: 1, actor })?.eye).toBeUndefined();
    const crouched = cameraPlayer({ id: 1, actor, motion: { mode: 'ground', duck: 'ducked', sliding: true, slideBoost: 4 } }); // prettier-ignore
    expect(crouched).toMatchObject({ eye: CAMERA_EYE.crouch, sliding: true, boosted: true });
    expect(cameraPlayer({ id: 2, crate: {} })).toBeNull();
  });

  it('leave the pose as it is at rest', () => {
    const pose = makePose({ position: [0, 1.5, 0], fov: 74 });
    expect(applyEffects(pose, run(createCameraEffects(), player(), 1), FIRST_EFFECTS)).toBe(pose);
  });

  it('lower the eye 0.15 m in a sprint and roll it into a turn up to 2°', () => {
    const frame = run(createCameraEffects(), player({ sprinting: true, velocity: [0, 0, 7.6] }), 2, -Math.PI);
    expect(frame.drop).toBeCloseTo(EFFECTS.sprintDrop, 4);
    expect(frame.roll).toBeCloseTo(2 * DEG, 4); // turning right (yaw falling): the top tips right
    const pose = applyEffects(makePose({ position: [0, 1.5, 0], fov: 74 }), frame, FIRST_EFFECTS);
    expect(pose.position[1]).toBeCloseTo(1.5 - EFFECTS.sprintDrop + frame.bob[1], 6);
    expect(applyEffects(makePose({ position: [0, 1.5, 0] }), frame, NO_EFFECTS).position[1]).toBe(1.5);
  });

  it('widen the lens ×1.1 in a boosted slide and roll toward a slide across the view', () => {
    const frame = run(createCameraEffects(), player({ sliding: true, boosted: true, velocity: [-10, 0, 0] }), 2);
    expect(frame.fov).toBeCloseTo(EFFECTS.slideFov, 4);
    expect(frame.roll).toBeCloseTo(EFFECTS.slideRoll, 3); // sliding to the view's right (−X when it looks along +Z)
  });

  it('dip the view on a landing by its speed and spring back, kick it up on a jump, and shake on a hard landing', () => {
    const effects = createCameraEffects();
    run(effects, player({ grounded: false, mode: 'air', velocity: [0, -20, 0] }), 0.1);
    effects.step(player());
    let lowest = 0;
    let frame = effects.frame(1 / 60, { yaw: 0 });
    expect(frame.shake).toBeCloseTo(EFFECTS.shake.per * (20 - EFFECTS.shake.from), 9);
    for (let k = 0; k < 120; k++) {
      lowest = Math.min(lowest, frame.pitch);
      frame = effects.frame(1 / 60, { yaw: 0 });
    }
    expect(lowest).toBeLessThan(-EFFECTS.punch.max * 0.8);
    expect(lowest).toBeGreaterThan(-EFFECTS.punch.max * 1.3);
    expect(Math.abs(frame.pitch)).toBeLessThan(1e-3); // back at rest
    effects.step(player({ grounded: false, mode: 'air', velocity: [0, 5, 0] }));
    let highest = 0;
    for (let k = 0; k < 30; k++) highest = Math.max(highest, effects.frame(1 / 60, { yaw: 0 }).pitch);
    expect(highest).toBeGreaterThan(EFFECTS.punch.jump * 0.8);
  });

  it('zoom to the sights in 0.25 s, bob once each 0.4 s at a run, and take a weapon’s kick', () => {
    const effects = createCameraEffects();
    const aimed = run(effects, player({ aiming: true }), EFFECTS.ads.time);
    expect(aimed.aim).toBeCloseTo(1, 9);
    expect(aimed.zoom).toBeCloseTo(Math.tan(35 * DEG) / Math.tan(27.5 * DEG), 9);
    const runner = createCameraEffects();
    const phases: number[] = [];
    for (let k = 0; k < 60; k++) {
      runner.step(player({ velocity: [0, 0, 5.1] }));
      phases.push(runner.frame(1 / 60, { yaw: 0 }).bobPhase);
    }
    expect(phases[24] - phases[0]).toBeCloseTo((2 * Math.PI * 24) / 60 / EFFECTS.bob.period, 9);
    runner.kick(0.05, 0.02);
    const kicked = runner.frame(1 / 60, { yaw: 0 });
    expect([kicked.pitch > 0, kicked.yaw > 0]).toEqual([true, true]);
  });
});
