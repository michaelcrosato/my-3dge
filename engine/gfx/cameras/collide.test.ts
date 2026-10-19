/**
 * @file Unit tests for camera collision (engine/gfx/cameras/collide.ts): a ball cast stops its skin short of a wall and
 * a sweep twice that; an arm pulls in at once and eases out; a slide runs along a wall it meets and lifts off one it
 * starts against; a followed point slides, or starts again from the eye when it would jump; a carried camera keeps its
 * place on the arm as the arm moves and turns; and a `moveCamera` camera stands at the arm's end past a pole, closes in
 * on a wall at most `COLLIDE_PULL` a second and never stands in it, goes with a player put elsewhere, and goes where it
 * wants after standing stuck for `COLLIDE_STUCK`.
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

  it('goes with a player put elsewhere, and where it wants after standing stuck', () => {
    const w = walls();
    const put = moveCamera(w, { at: [0, 1.5, 0], stuck: 0 }, [10, 1.5, 10], [10, 1.5, 6], [10, 1.5, 6], 1 / 60);
    expect(put.at).toEqual([10, 1.5, 6]);
    const want: Vec3 = [5, 1.5, -22]; // past the wall, where the ball fits: it presses on the wall's face
    let ball: CameraBall = { at: [5, 1.5, -2], stuck: 0 };
    let k = 0;
    for (; k < 120 && ball.at[2] > -3; k++) ball = moveCamera(w, ball, [5, 1.5, -20], ball.at, want, 1 / 60);
    expect(Math.abs(k - COLLIDE_STUCK * 60)).toBeLessThanOrEqual(1); // stuck a second at the face, then there
    expect(ball.at).toEqual(want);
  });
});
