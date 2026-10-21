/**
 * @file Unit tests for the traversal plant (engine/anim/traversal/plant.ts, PLAN.md WP 13.11): a body that does not
 * traverse is left as it was; one hanging from a lip has its grips on the lip and its legs hanging, and from a low lip
 * hangs under its hands, its feet off the floor; a mantle's knees and toes stay off its face under the lip
 * (engine/anim/traversal/clear.ts); one on a zipline holds the cable, drawn up to it when the cable is out of its arms'
 * reach; a skydive glides on its front and stands up into its landing pose; a hard landing's right hand goes down on
 * the floor; and what it put each limb on stays in `limbs`.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import { Animator } from '../character';
import { jointPosition, socketPosition, tipPosition } from '../fk';
import { FootPlant } from '../footPlant';
import { TraversalPlant } from './plant';
import { TraversalPose } from './pose';

const hull = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };

/** The adult with the foot plant and the traversal plant after it, and its traversal. */
function body() {
  const animator = new Animator({ build: 'build:adult', clock: 1 });
  new FootPlant().attach(animator);
  const plant = new TraversalPlant().attach(animator);
  plant.pose = new TraversalPose();
  return { animator, plant, pose: plant.pose };
}

/** Steps `b` `n` times at `feet` with `view` (and `ride`), in the air unless the view is on the ground. */
function hold(
  b: ReturnType<typeof body>,
  n: number,
  view: Record<string, unknown>,
  feet: Vector3,
  ride: object | null = null,
  vy = 0,
  on = hull,
) {
  // prettier-ignore
  for (let k = 0; k < n; k++) {
    b.pose.update(view, ride, on, b.animator.body.build, feet, { vx: 0, vy, vz: 0, yaw: 0 }, b.animator.body.dt);
    b.animator.update({ position: feet.clone(), velocity: new Vector3(0, vy, 0), air: view.mode !== 'ground' });
  }
  return b;
}

const grips = (b: ReturnType<typeof body>) => {
  const { skeleton, world } = b.animator.body;
  return [socketPosition(skeleton, world, 'weaponL'), socketPosition(skeleton, world, 'weaponR')];
};

describe('the traversal plant', () => {
  it('leaves a body that does not traverse as it was', () => {
    const [plain, layered] = [new Animator({ build: 'build:adult', clock: 1 }), body()];
    new FootPlant().attach(plain);
    for (let k = 0; k < 30; k++) {
      const at = new Vector3(0, 0, k * 0.05);
      plain.update({ position: at.clone(), velocity: new Vector3(0, 0, 3) });
      hold(layered, 0, { mode: 'ground' }, at);
      layered.pose.update(
        { mode: 'ground' },
        null,
        hull,
        layered.animator.body.build,
        at,
        null,
        layered.animator.body.dt,
      );
      layered.animator.update({ position: at.clone(), velocity: new Vector3(0, 0, 3) });
    }
    expect(Array.from(layered.animator.body.world.positions)).toEqual(Array.from(plain.body.world.positions));
  });

  it('hangs from a lip, its grips on it and its legs hanging under the hips', () => {
    const hang = { mode: 'mantle', mantle: 'hang', mantleLeft: 10, mantleTotal: 27, lipX: 0, lipY: 2.2, lipZ: 0.45, wallX: 0, wallZ: -1, fromY: 0.3 }; // prettier-ignore
    const b = hold(body(), 20, hang, new Vector3(0, 0.3, 0));
    const [left, right] = b.plant.limbs;
    expect([left.held, right.held]).toEqual([true, true]);
    const [l, r] = grips(b);
    expect(l.distanceTo(left.point)).toBeLessThan(1e-3);
    expect(r.distanceTo(right.point)).toBeLessThan(1e-3);
    expect(r.x).toBeLessThan(l.x); // facing +Z: the right hand at −X
    const { world } = b.animator.body;
    expect(jointPosition(world, 'footL').y).toBeLessThan(jointPosition(world, 'thighL').y - 0.6);
  });

  it('hangs under its hands from a low lip: the arms near straight, the hips off the face, the feet off the floor', () => {
    const lip = { lipX: 0, lipY: 2, lipZ: 0.87, wallX: 0, wallZ: -1, fromY: 0 }; // its face at z 0.85
    const b = hold(body(), 40, { mode: 'mantle', mantle: 'hang', mantleLeft: 19, mantleTotal: 27, ...lip }, new Vector3(0, 0.44, 0.434)); // prettier-ignore
    const { skeleton, world } = b.animator.body;
    for (const side of ['L', 'R'] as const) {
      const grip = socketPosition(skeleton, world, `weapon${side}`);
      expect(jointPosition(world, `upperArm${side}`).distanceTo(grip)).toBeGreaterThan(0.55); // of a hooked hand's 0.595 m reach
      expect(jointPosition(world, `forearm${side}`).y).toBeLessThan(grip.y); // the elbow under the hand
      expect(socketPosition(skeleton, world, `contact${side}`).y).toBeGreaterThan(0.05);
    }
    expect(0.85 - jointPosition(world, 'pelvis').z).toBeGreaterThan(0.15);
    expect(0.85 - jointPosition(world, 'pelvis').z).toBeLessThan(0.35);
  });

  it('keeps its knees and toes off a mantle’s face under the lip through the grab and the pull', () => {
    const [face, top] = [0.85, 2.02];
    const b = body();
    let [knee, toe] = [Infinity, Infinity];
    for (let k = 0; k <= 45; k++) {
      const lip = { lipX: 0, lipY: 2, lipZ: face + 0.02, wallX: 0, wallZ: -1 };
      const grab = k <= 27;
      const view = grab ? { mode: 'mantle', mantle: 'grab', mantleLeft: 27 - k, mantleTotal: 27, fromY: 0, ...lip } : { mode: 'mantle', mantle: 'pull', mantleLeft: 45 - k, mantleTotal: 18, fromY: top, ...lip }; // prettier-ignore
      hold(b, 1, view, new Vector3(0, grab ? (top * k) / 27 : top, face - 0.42 + (grab ? 0 : (0.86 * (k - 27)) / 18)));
      const { skeleton, world } = b.animator.body;
      for (const side of ['L', 'R'] as const) {
        const [at, tip] = [jointPosition(world, `shin${side}`), tipPosition(skeleton, world, `toe${side}`)];
        if (at.y < 1.99) knee = Math.min(knee, face - at.z);
        if (tip.y < 1.99) toe = Math.min(toe, face - tip.z);
      }
    }
    expect(knee).toBeGreaterThan(0.06 - 1e-6);
    expect(toe).toBeGreaterThan(0.01 - 1e-6);
  });

  it('holds a zipline’s cable, drawn up to it when it hangs out of the arms’ reach', () => {
    const ride = { zipline: { from: [0, 8, -10], to: [0, 8, 10] } };
    const b = hold(body(), 20, { mode: 'zipline', rideDir: 1 }, new Vector3(0, 8 - hull.hang, 0), ride);
    const [l, r] = grips(b);
    expect([b.plant.limbs[0].held, b.plant.limbs[1].held]).toEqual([true, true]);
    expect(l.distanceTo(b.plant.limbs[0].point)).toBeLessThan(1e-3);
    expect(r.distanceTo(b.plant.limbs[1].point)).toBeLessThan(1e-3);
    const long = { ...hull, hang: hull.hang + 0.6 }; // a hang 60 cm longer than the adult's arms reach
    const high = hold(body(), 20, { mode: 'zipline', rideDir: 1 }, new Vector3(0, 8 - long.hang, 0), ride, 0, long);
    expect(grips(high)[1].distanceTo(high.plant.limbs[1].point)).toBeLessThan(1e-3);
    const pelvis = (x: ReturnType<typeof body>) => jointPosition(x.animator.body.world, 'pelvis').y - x.animator.body.position.y; // prettier-ignore
    expect(pelvis(high)).toBeGreaterThan(pelvis(b) + 0.1); // drawn up to the cable
  });

  it('glides on its front in a skydive and stands up into its landing pose', () => {
    const chest = (b: ReturnType<typeof body>) => {
      const { world } = b.animator.body;
      return jointPosition(world, 'neck').sub(jointPosition(world, 'pelvis')).normalize();
    };
    const glide = hold(body(), 40, { mode: 'skydive' }, new Vector3(0, 100, 0), null, -20);
    expect(Math.abs(chest(glide).y)).toBeLessThan(0.2); // the spine about level: on its front
    const landing = hold(glide, 60, { mode: 'skydive', landing: true }, new Vector3(0, 30, 0), null, -6);
    expect(chest(landing).y).toBeGreaterThan(0.9); // upright again
  });

  it('puts a hard landing’s right hand down on the floor, flat', () => {
    const b = body();
    hold(b, 10, { mode: 'ground' }, new Vector3());
    Object.assign(b.animator.body.shown, { land: 1, hard: 1 }); // the bottom of a hard landing's dip
    b.animator.update({ position: new Vector3(), velocity: new Vector3() });
    expect(b.plant.limbs[1].held).toBe(true);
    expect(grips(b)[1].y).toBeCloseTo(0.03, 2); // a palm over the floor
  });
});
