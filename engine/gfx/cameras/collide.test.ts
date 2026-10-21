/**
 * @file Unit tests for camera collision (engine/gfx/cameras/collide.ts): a ball cast stops its skin short of a wall and
 * a sweep twice that; an arm pulls in at once and eases out; a slide runs along a wall it meets and lifts off one it
 * starts against; a followed point slides, or starts again from the eye when it would jump; a carried camera keeps its
 * place on the arm as the arm moves and turns; and a `moveCamera` camera stands at the arm's end past a pole, closes in
 * on a wall at most `COLLIDE_PULL` a second and never stands in it, goes with a player put elsewhere, homes to the clear
 * point after standing stuck for `COLLIDE_STUCK` without a jump, and keeps the base's sight over a wall's top (never
 * sinking behind one it rose over, the base falling or above it) and when the floor grazes its sight under a tipped look.
 * @see engine/gfx/cameras/collide.ts
 */
import { describe, expect, it } from 'vitest';
import { createSettings } from '../../core/settings';
import { createPhysics } from '../../physics/world';
import { queryView } from '../../sim/queryView';
import {
  carry,
  COLLIDE_PULL,
  COLLIDE_RADIUS,
  COLLIDE_SKIN,
  COLLIDE_STUCK,
  easeArm,
  follow,
  moveCamera,
  reach,
  slide,
  sweep,
  type CameraBall,
} from './collide';
import type { Vec3 } from './pose';

/** A floor and a wall 3 m tall whose face is at z = −3 (it runs to −4): one to look over. */
function low() {
  const physics = createPhysics();
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }] }); // prettier-ignore
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 3, 1] }, position: [0, 1.5, -3.5] }] }); // prettier-ignore
  physics.step({ dt: 1 / 60, settings: createSettings().sim });
  return { queries: queryView(physics) };
}

/** A floor, a wall whose face is at z = −3 (it runs to −4) and a pole of radius 0.06 at (0, z = 2). */
function walls() {
  const physics = createPhysics();
  physics.addBody({
    type: 'fixed',
    colliders: [{ shape: { type: 'box', size: [40, 1, 40] }, position: [0, -0.5, 0] }],
  });
  physics.addBody({ type: 'fixed', colliders: [{ shape: { type: 'box', size: [20, 8, 1] }, position: [0, 4, -3.5] }] });
  physics.addBody({ type: 'fixed', position: [0, 2, 2], colliders: [{ shape: { type: 'cylinder', radius: 0.06, height: 4 } }] }); // prettier-ignore
  physics.step({ dt: 1 / 60, settings: createSettings().sim });
  return { queries: queryView(physics) };
}

const far = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('camera collision', () => {
  it('casts a ball to its skin short of a wall, and sweeps to twice that', () => {
    const w = walls();
    expect(reach(w, [5, 1.5, 0], [0, 0, -1], 10)).toBeCloseTo(3 - COLLIDE_RADIUS - COLLIDE_SKIN, 3);
    expect(reach(w, [5, 1.5, 0], [0, 0, 1], 10)).toBe(10); // nothing in front
    expect(reach({}, [5, 1.5, 0], [0, 0, -1], 10)).toBe(10); // no walls without queries
    expect(sweep(w, [5, 1.5, 0], [5, 1.5, -6])[2]).toBeCloseTo(-3 + COLLIDE_RADIUS + 2 * COLLIDE_SKIN, 3);
    expect(sweep(w, [5, 1.5, 0], [5, 1.5, -1])).toEqual([5, 1.5, -1]);
  });

  it('pulls an arm in at once and eases it back out', () => {
    expect(easeArm(5.5, 5.5, 2, 1 / 60)).toBe(2);
    expect(easeArm(2, 5.5, 5.5, 0.3)).toBeCloseTo(2 + 3.5 * (1 - Math.exp(-1)), 9);
  });

  it('slides along a wall it meets, and lifts off one it starts against', () => {
    const w = walls();
    const [x, , z] = slide(w, [5, 1.5, -1], [8, 1.5, -5]); // into the wall at a slant: on along its face
    expect(x).toBeCloseTo(8, 6);
    expect(z).toBeGreaterThan(-3 + COLLIDE_RADIUS);
    expect(z).toBeLessThan(-3 + COLLIDE_RADIUS + 3 * COLLIDE_SKIN);
    const against: Vec3 = [5, 1.5, -3 + COLLIDE_RADIUS + COLLIDE_SKIN / 2];
    expect(slide(w, against, [7, 1.5, against[2]])[0]).toBeCloseTo(7, 5); // along it, though within its skin
  });

  it('follows a point by sliding, and starts again from the eye when it would jump', () => {
    const w = walls();
    expect(follow(w, null, [5, 1.5, 0], [5, 1.5, -6])[2]).toBeCloseTo(-3 + COLLIDE_RADIUS + 2 * COLLIDE_SKIN, 3);
    const along = follow(w, [-1, 1.5, 2], [0, 1.5, 0], [1, 1.5, 2]); // straight at the pole: it stops, never through
    expect(along[0]).toBeCloseTo(-0.06 - COLLIDE_RADIUS - 2 * COLLIDE_SKIN, 3);
    expect(follow(w, [10, 1.5, 0], [0, 1.5, 0], [0, 1.5, 1])).toEqual([0, 1.5, 1]); // 10 m away: from the eye
  });

  it('carries a point with the arm: its place on the arm kept as the arm moves and turns', () => {
    const at: Vec3 = [0, 2, -4];
    const moved = carry(at, { base: [0, 2, 0], yaw: 0, pitch: 0 }, { base: [1, 2, 0], yaw: 0, pitch: 0 });
    expect(moved).toEqual([1, 2, -4]);
    const turned = carry(at, { base: [0, 2, 0], yaw: 0, pitch: 0 }, { base: [0, 2, 0], yaw: Math.PI / 2, pitch: 0 });
    turned.forEach((v, i) => expect(v).toBeCloseTo([-4, 2, 0][i], 9)); // behind a view along +X
  });

  it('stands at the arm’s end past a pole, closes in on a wall at its pace, and never stands in it', () => {
    const w = walls();
    const base: Vec3 = [0, 1.5, 4.5];
    const end: Vec3 = [0, 1.5, -0.5]; // the pole between them
    let ball: CameraBall | null = moveCamera(w, null, base, end, end, 1 / 60);
    expect(ball.at[2]).toBeGreaterThan(2); // the first frame: in front of the pole, as a sweep from the base clears
    ball = { at: end, stuck: 0 };
    expect(moveCamera(w, ball, base, end, end, 1 / 60).at).toEqual(end); // where it fits, past the pole
    let at: Vec3 = [5, 1.5, -1];
    for (let k = 0; k < 60; k++) {
      const next = moveCamera(w, { at, stuck: 0 }, [5, 1.5, 1], at, [5, 1.5, -6], 1 / 60).at; // the end in the wall
      expect(far(next, at)).toBeLessThanOrEqual(COLLIDE_PULL / 60 + 1e-9);
      expect(next[2]).toBeGreaterThan(-3 + COLLIDE_RADIUS);
      at = next;
    }
    expect(at[2]).toBeCloseTo(-3 + COLLIDE_RADIUS + 2 * COLLIDE_SKIN, 2); // in front of the wall, swept from the base
  });

  it('goes with a player put elsewhere; stuck, it homes to the clear point at its pace, never through a wall', () => {
    const w = walls();
    const put = moveCamera(w, { at: [0, 1.5, 0], stuck: 0 }, [10, 1.5, 10], [10, 1.5, 6], [10, 1.5, 6], 1 / 60);
    expect(put.at).toEqual([10, 1.5, 6]);
    const want: Vec3 = [5, 1.5, -22]; // past the wall, where the ball fits: it presses on the wall's face
    let ball: CameraBall = { at: [5, 1.5, -2], stuck: 0 };
    for (let k = 0; k < 180; k++) {
      const next = moveCamera(w, ball, [5, 1.5, -20], ball.at, want, 1 / 60);
      expect(far(next.at, ball.at)).toBeLessThanOrEqual(COLLIDE_PULL / 60 + 2 * COLLIDE_SKIN); // no jump, even stuck (a lift off a face aside)
      expect(next.at[2]).toBeGreaterThan(-3 + COLLIDE_RADIUS); // never through the wall
      ball = next;
    }
    expect(ball.stuck).toBeGreaterThan(COLLIDE_STUCK); // still short of it: homing, never cut there
  });

  it('keeps the base’s sight: over a wall’s top, it never comes down behind it, and comes back over', () => {
    const w = low();
    const base: Vec3 = [5, 1.8, 0];
    const want: Vec3 = [5, 1, -5.5]; // behind the wall and below its top, where the ball fits
    let ball: CameraBall = { at: [5, 4.5, -4.5], stuck: 0 }; // above and past the top: the base sees it over it
    let front = false;
    for (let k = 0; k < 240; k++) {
      const next = moveCamera(w, ball, base, ball.at, want, 1 / 60);
      expect(far(next.at, ball.at)).toBeLessThanOrEqual(COLLIDE_PULL / 60 + 2 * COLLIDE_SKIN);
      if (next.at[2] < -3 + COLLIDE_RADIUS) expect(next.at[1]).toBeGreaterThan(3); // behind it only above its top
      front ||= next.at[2] > -3;
      ball = next;
    }
    expect(front).toBe(true); // stuck above it for a while, then home over the top to the clear point
    let lost: CameraBall = { at: [5, 3.4, -4.4], stuck: 0 }; // the base below its sight line now: lost
    for (let k = 0; k < 30; k++) lost = moveCamera(w, lost, [5, 1.2, 0], [lost.at[0], 2, lost.at[2]], want, 1 / 60);
    expect(lost.at[1]).toBeGreaterThanOrEqual(3.4 - 1e-9); // carried down, it never sinks out of sight
  });

  it('never sinks behind a wall’s top it rose over as the base falls from level with it', () => {
    const w = low();
    let base: Vec3 = [5, 3.3, 0];
    let ball: CameraBall = { at: [5, 3.35, -4.6], stuck: 0 }; // just over the top, past it
    for (let k = 0; k < 90; k++) {
      const drop = k < 40 ? 0.05 : 0; // the base drops 2 m, carrying the camera down with it
      base = [base[0], base[1] - drop, base[2]];
      ball = moveCamera(w, ball, base, [ball.at[0], ball.at[1] - drop, ball.at[2]], [5, 1, -6], 1 / 60);
      if (ball.at[2] < -3 + COLLIDE_RADIUS) expect(ball.at[1], `frame ${k}`).toBeGreaterThan(3 + COLLIDE_RADIUS - COLLIDE_SKIN); // prettier-ignore
    }
  });

  it('keeps the base in sight with no room to spare as the arm swings down past a wall’s top', () => {
    const w = low();
    const base: Vec3 = [5, 4.5, 0]; // above the top
    const sight = (at: Vec3) => far(sweep(w, base, at), at) < 3 * COLLIDE_SKIN;
    let ball: CameraBall = { at: [5, 3.15, -4.6], stuck: 0 }; // on the far side, in its sight with no room to spare
    expect(sight(ball.at)).toBe(true);
    for (let k = 0; k < 60; k++) {
      ball = moveCamera(w, ball, base, ball.at, [5, 1.2, -6.5], 1 / 60); // the arm's end fits there, out of sight
      expect(sight(ball.at), `frame ${k}`).toBe(true); // stopped where it would lose the base
    }
  });

  it('comes down to the clear point over open floor with the look tipped up, the floor grazing its sight', () => {
    const w = low();
    const base: Vec3 = [5, 1.8, 10]; // 13 m from the wall: open floor
    const want: Vec3 = [5, -1.5, 13.2]; // the look 1.2 rad up: the arm's end under the floor
    const clear = sweep(w, base, want);
    let ball: CameraBall = { at: [5, 0.9, 12.6], stuck: 0 }; // over the floor, in the base's sight with room to spare
    for (let k = 0; k < 30; k++) ball = moveCamera(w, ball, base, ball.at, want, 1 / 60);
    expect(far(ball.at, clear)).toBeLessThan(0.1); // within half a second, not held for the stuck second
    expect(ball.stuck).toBe(0);
  });

  it('follows a point held at a lip no faster than the step it is given', () => {
    const w = walls();
    const held = follow(w, [5, 1.5, 0], [5, 1.5, 4], [5, 1.5, 3], 0.2); // 3 m behind, a 0.2 m step: it creeps
    expect(far(held, [5, 1.5, 0])).toBeCloseTo(0.2, 9);
    expect(follow(w, [5, 1.5, 0], [5, 1.5, 4], [5, 1.5, 3], 2.5)).toEqual([5, 1.5, 3]); // put elsewhere: from the eye
  });
});
