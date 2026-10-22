/**
 * @file Unit tests for holding and aiming (engine/anim/traversal/hold.ts, PLAN.md WP 13.11): the head turns toward the
 * look; a gun aimed down the sights points its muzzle within §5.1's 2° of the aim at every pitch and at headings off
 * the body's (the aim offsets), the support hand on its foregrip, the right eye on its sight line; held low and ready
 * otherwise, still aimed at a run, lowered and turned across the body at a sprint, its foregrip still in hand; a
 * traversal holding the hands lowers it; and without a look or a gun the body is left as it was. WP 13.20: a gun drawn
 * comes into the hands over `HOLD.draw` and leaves them as it is holstered, with no jump of the grip, the hold made
 * again with a body's new animator following the old one's draw; a body that starts with a gun holds it at once.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { Animator } from '../character';
import { jointPosition, jointRotation, socketPosition } from '../fk';
import { HOLD, HoldPlant, type Look } from './hold';

/** The adult (with `weapon`), its hold layer, stepped `n` times at the origin facing +Z with `look`, moving at `speed`. */
function held(look: Look | null, weapon: 'none' | 'gun' = 'gun', speed = 0, busy = 0, n = 30) {
  const animator = new Animator({ build: 'build:adult', weapon, clock: 1 });
  const hold = new HoldPlant().attach(animator);
  [hold.look, hold.busy] = [look && { ...look, raised: look.aiming ? 1 : 0, weight: 1 }, busy];
  for (let k = 0; k < n; k++) animator.update({ position: new Vector3(0, 0, (k * speed) / 60), velocity: new Vector3(0, 0, speed) }); // prettier-ignore
  return { animator, hold };
}

/** The direction of heading `yaw` and pitch `pitch`. */
const dir = (yaw: number, pitch: number) => new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); // prettier-ignore

/** Where the right hand points its weapon: the hand's +Z (authoring.ts `holdAlong`'s frame). */
const muzzle = (a: Animator) => new Vector3(0, 0, 1).applyQuaternion(jointRotation(a.body.world, 'handR'));

describe('holding and aiming', () => {
  it('turns the head toward the look', () => {
    const { animator } = held({ yaw: 0.6, pitch: 0.25 }, 'none');
    const gaze = new Vector3(0, 0, 1).applyQuaternion(jointRotation(animator.body.world, 'head'));
    expect(gaze.angleTo(dir(0.6, 0.25))).toBeLessThan(0.1);
  });

  it('points an aimed gun’s muzzle within 2° of the aim, at every pitch and off the body’s heading, both hands on it', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [0, 0.5],
      [0, -0.5],
      [0.5, 0.2],
      [-0.5, -0.2],
    ]) {
      const { animator, hold } = held({ yaw, pitch, aiming: true });
      expect(muzzle(animator).angleTo(dir(yaw, pitch))).toBeLessThan((2 * Math.PI) / 180);
      const { skeleton, world } = animator.body;
      const grip = socketPosition(skeleton, world, 'weaponR');
      const along = hold.support.clone().sub(grip).dot(hold.barrel);
      expect(hold.support.distanceTo(grip.clone().addScaledVector(hold.barrel, along))).toBeLessThan(1e-3); // on the barrel's line…
      expect(along).toBeGreaterThan(HOLD.fore * 0.5 - 1e-6); // …on its handguard
      expect(socketPosition(skeleton, world, 'weaponL').distanceTo(hold.support)).toBeLessThan(0.01); // the support hand
    }
  });

  it('aims down the sights: the grip along the sight line through the right eye and under it', () => {
    const { animator, hold } = held({ yaw: 0.3, pitch: 0.2, aiming: true });
    const { skeleton, world } = animator.body;
    const up = new Vector3(0, 1, 0).addScaledVector(hold.barrel, -hold.barrel.y).normalize();
    const sights = socketPosition(skeleton, world, 'eyeR').addScaledVector(hold.barrel, HOLD.sights[0]).addScaledVector(up, -HOLD.sights[1]); // prettier-ignore
    expect(socketPosition(skeleton, world, 'weaponR').distanceTo(sights)).toBeLessThan(0.01);
  });

  it('holds it low and ready unless aiming, still aimed at a run, lowered across the body at a sprint, and lowered for a traversal', () => {
    // prettier-ignore
    const ready = held({ yaw: 0, pitch: 0 });
    expect(Math.asin(ready.hold.barrel.y)).toBeCloseTo(-HOLD.ready, 6);
    const run = held({ yaw: 0, pitch: 0, aiming: true }, 'gun', 5.07); // the playground's run, 1.15 of the adult's speedRef
    expect(Math.abs(run.hold.barrel.y)).toBeLessThan(0.01);
    const sprint = held({ yaw: 0, pitch: 0, aiming: true }, 'gun', 7.6);
    expect(Math.asin(sprint.hold.barrel.y)).toBeCloseTo(-HOLD.sprint[0], 2);
    expect(sprint.hold.barrel.x).toBeGreaterThan(0.3); // its muzzle turned across to the body's left (+X, facing +Z)
    const { skeleton, world } = sprint.animator.body;
    expect(socketPosition(skeleton, world, 'weaponL').distanceTo(sprint.hold.support)).toBeLessThan(0.01);
    const [free, busy] = [held(null, 'gun', 0, 0), held(null, 'gun', 0, 1)];
    const plain = held(null, 'none');
    expect(jointPosition(busy.animator.body.world, 'handR').distanceTo(jointPosition(plain.animator.body.world, 'handR'))).toBeLessThan(1e-9); // prettier-ignore
    expect(jointPosition(free.animator.body.world, 'handR').distanceTo(jointPosition(plain.animator.body.world, 'handR'))).toBeGreaterThan(0.05); // prettier-ignore
  });

  it('brings the hands onto a gun drawn over HOLD.draw and off one holstered, the grip never jumping (WP 13.20)', () => {
    expect(held(null, 'gun', 0, 0, 1).hold.drawn).toBe(1); // a body that starts with one holds it at once
    /** A body made again with `weapon` (as the view's pool makes it when the weapon changes), its hold following `from`'s. */
    const again = (from: { animator: Animator; hold: HoldPlant }, weapon: 'none' | 'gun') => {
      const animator = new Animator({ build: 'build:adult', weapon, clock: from.animator.body.state.clock });
      return { animator, hold: new HoldPlant().follow(from.hold).attach(animator) };
    };
    /** `n` steps of `body`: its hold's draw and how far the grip moved in each. */
    const steps = (body: { animator: Animator; hold: HoldPlant }, n: number) =>
      Array.from({ length: n }, () => {
        const before = socketPosition(body.animator.body.skeleton, body.animator.body.world, 'weaponR');
        body.animator.update({ position: new Vector3(), velocity: new Vector3() });
        const after = socketPosition(body.animator.body.skeleton, body.animator.body.world, 'weaponR');
        return { drawn: body.hold.drawn, holding: body.hold.holding, moved: after.distanceTo(before) };
      });
    const bare = held(null, 'none', 0, 0, 10);
    expect([bare.hold.drawn, bare.hold.holding]).toEqual([0, false]);
    const drawing = steps(again(bare, 'gun'), 20);
    const per = 1 / 60 / HOLD.draw; // of the way a step
    expect(drawing[0].drawn).toBeCloseTo(per, 9);
    expect(drawing.findIndex((s) => s.drawn === 1)).toBe(Math.ceil(1 / per - 1e-9) - 1); // 0.25 s in
    expect(drawing.every((s) => s.holding)).toBe(true);
    expect(Math.max(...drawing.slice(1).map((s) => s.moved))).toBeLessThan(0.08); // eased: never a jump
    const armed = again(bare, 'gun');
    steps(armed, 20);
    const holstering = steps(again(armed, 'none'), 20);
    expect(holstering[0].drawn).toBeCloseTo(1 - per, 9);
    expect([holstering.at(-1)!.drawn, holstering.at(-1)!.holding]).toEqual([0, false]); // gone from the hands
    expect(Math.max(...holstering.slice(1).map((s) => s.moved))).toBeLessThan(0.08);
  });

  it('leaves the body as it was without a look or a gun', () => {
    const plain = new Animator({ build: 'build:adult', clock: 1 });
    for (let k = 0; k < 30; k++) plain.update({ position: new Vector3(), velocity: new Vector3() });
    const { animator } = held(null, 'none');
    expect(Array.from(animator.body.world.positions)).toEqual(Array.from(plain.body.world.positions));
  });
});
