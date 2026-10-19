/**
 * @file Unit tests for the foot plant (engine/anim/footPlant.ts), PLAN.md WP 3.5's Done when: on a 10° slope and a
 * 0.2 m step `footPlant` keeps the soles within 5 mm of the surface, drops the pelvis to a lower level and locks a foot
 * in stance; after G9, with `floor` given, a root below the floor still stands the soles on it, and the `FootPlant`
 * layer, last in an animator's `post` slot, stands a kneel, a crouch, a dash and a guard on the floor
 * (engine/anim/authoring.test.ts's known sinks), toes and heels included, without sinking a walk, and stays last in the
 * slot, keeping nothing between ticks; WP 13.10: through the query view's ground (`queryGround`) it stands the soles on
 * a ramp, and on the body's floor past the slope band; a sole in stance stays put, on the floor below as the body steps
 * up onto a box, and rides a treadmill.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { animCheck } from './check';
import { Animator } from './character';
import { createWorldPose, forwardKinematics, jointPosition, jointToWorld, socketPosition, tipPosition } from './fk';
import { footPlant, FootPlant, queryGround } from './footPlant';
import type { GroundProbe } from './ik';
import { createFootPlantState } from './locomotion/locks';
import { Pose } from './pose';
import { createSkeleton, PROPORTIONS, type Skeleton } from './skeleton';
import type { AnimatorInput } from './states';

const BUILDS = ['build:chibi', 'build:heroic', 'build:bulky'];
/** A pose with the character moved and turned, and its FK. */
function placed(skeleton: Skeleton, yaw = 0.7) {
  const pose = new Pose();
  pose.rootPos.set(1.5, 0.25, -2);
  pose.rootRot.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return { pose, world: forwardKinematics(skeleton, pose) };
}

describe('footPlant: soles within 5 mm of the surface', () => {
  const SLOPE = (10 * Math.PI) / 180;
  /** The height and normal of a ground at (x, z). */
  type Ground = (x: number, z: number, normal: Vector3) => number;
  const slope: Ground = (x, _z, n) => (n.set(-Math.sin(SLOPE), Math.cos(SLOPE), 0), Math.tan(SLOPE) * x);
  const step: Ground = (_x, z, n) => (n.set(0, 1, 0), z >= 0 ? 0.2 : 0);
  /** A probe of `ground`: a ray straight down from `origin`. */
  const probeOf =
    (ground: Ground): GroundProbe =>
    (origin, distance, hit) => {
      const y = ground(origin.x, origin.z, hit.normal);
      hit.point.set(origin.x, y, origin.z);
      return y <= origin.y && origin.y - y <= distance;
    };
  /** The sole points of one foot: heel, contact and toe tip. */
  const sole = (skeleton: Skeleton, world: ReturnType<typeof createWorldPose>, side: 'L' | 'R') => {
    const b = skeleton.build;
    const heel = new Vector3(0, -b.ankleHeight * b.size, -PROPORTIONS.heel * b.footLength * b.size);
    return [
      jointToWorld(world, `foot${side}`, heel),
      socketPosition(skeleton, world, `contact${side}`),
      tipPosition(skeleton, world, `toe${side}`),
    ];
  };
  const gap = (ground: Ground, p: Vector3) => Math.abs(p.y - ground(p.x, p.z, new Vector3()));

  for (const id of BUILDS) {
    it(`${id} on a 10° slope, facing every way: every sole point`, () => {
      const skeleton = createSkeleton(id);
      for (let yaw = 0; yaw < 2 * Math.PI; yaw += Math.PI / 6) {
        const { pose, world } = placed(skeleton, yaw);
        pose.rootPos.y = slope(pose.rootPos.x, pose.rootPos.z, new Vector3());
        forwardKinematics(skeleton, pose, world);
        footPlant(skeleton, pose, world, probeOf(slope));
        for (const side of ['L', 'R'] as const) {
          for (const p of sole(skeleton, world, side)) expect(gap(slope, p)).toBeLessThan(0.005);
        }
      }
    });

    it(`${id} across a 0.2 m step, walking over its edge`, () => {
      const skeleton = createSkeleton(id);
      for (const yaw of [0, Math.PI / 2, 0.4, Math.PI]) {
        for (let z = -0.4; z <= 0.4; z += 0.025) {
          const { pose, world } = placed(skeleton, yaw);
          pose.rootPos.set(0.3, step(0.3, z, new Vector3()), z);
          forwardKinematics(skeleton, pose, world);
          const drop = footPlant(skeleton, pose, world, probeOf(step));
          expect(drop).toBeGreaterThanOrEqual(0);
          expect(drop).toBeLessThan(0.25);
          for (const side of ['L', 'R'] as const) {
            const points = sole(skeleton, world, side);
            expect(gap(step, points[1])).toBeLessThan(0.005);
            const level = points.every((p) => p.z >= 0) || points.every((p) => p.z < 0);
            if (level) for (const p of points) expect(gap(step, p)).toBeLessThan(0.005);
          }
        }
      }
    });
  }

  it('drops the pelvis so a foot can reach a lower level', () => {
    const skeleton = createSkeleton('build:heroic');
    const { pose, world } = placed(skeleton, Math.PI / 2); // facing +X: the left foot at −Z, over the low side
    pose.rootPos.set(0, 0.2, 0.02);
    forwardKinematics(skeleton, pose, world);
    const drop = footPlant(skeleton, pose, world, probeOf(step));
    expect(drop).toBeGreaterThan(0.15);
    expect(pose.rootPos.y).toBeCloseTo(0.2 - drop, 12);
    expect(socketPosition(skeleton, world, 'contactL').y).toBeCloseTo(0, 3);
    expect(socketPosition(skeleton, world, 'contactR').y).toBeCloseTo(0.2, 3);
  });

  it('locks a foot during stance, releases it after', () => {
    const skeleton = createSkeleton('build:chibi');
    const state = createFootPlantState();
    const probe = probeOf(slope);
    let [locked, lockedBall] = [new Vector3(), new Vector3()];
    for (let tick = 0; tick < 40; tick++) {
      const { pose, world } = placed(skeleton, 0.3);
      pose.rootPos.set(0.01 * tick, 0, 0.004 * tick);
      pose.rootPos.y = slope(pose.rootPos.x, pose.rootPos.z, new Vector3());
      forwardKinematics(skeleton, pose, world);
      const stance = [tick < 20, true] as const;
      footPlant(skeleton, pose, world, probe, { state, stance });
      const contact = socketPosition(skeleton, world, 'contactL');
      const ball = jointPosition(world, 'toeL'); // a build that locks no heel roll keeps its ball put too
      if (tick === 0) [locked, lockedBall] = [contact.clone(), ball.clone()];
      if (tick < 20) expect(contact.distanceTo(locked)).toBeLessThan(1e-5);
      if (tick < 20) expect(ball.distanceTo(lockedBall)).toBeLessThan(1e-5);
      if (tick >= 30) expect(contact.distanceTo(locked)).toBeGreaterThan(0.2);
      expect(gap(slope, contact)).toBeLessThan(0.005);
    }
  });
});

describe('footPlant on a given floor, and the FootPlant layer (after G9)', () => {
  const flat: GroundProbe = (origin, distance, hit) => {
    hit.point.set(origin.x, 0, origin.z);
    hit.normal.set(0, 1, 0);
    return origin.y >= 0 && origin.y <= distance;
  };

  for (const id of BUILDS) {
    it(`${id}: a root 8 cm below the floor, given floor 0, leaves the soles within 5 mm of it`, () => {
      const skeleton = createSkeleton(id);
      const { pose, world } = placed(skeleton, 0.4);
      pose.rootPos.y = -0.08;
      forwardKinematics(skeleton, pose, world);
      footPlant(skeleton, pose, world, flat, { floor: 0 });
      for (const side of ['L', 'R'] as const)
        expect(Math.abs(socketPosition(skeleton, world, `contact${side}`).y)).toBeLessThan(0.005);
    });
  }

  /** The worst depth below the floor of an animator's feet over 90 steps of `input`, after 30 to settle. */
  const sink = (build: string, input: AnimatorInput, plant: boolean) => {
    const animator = new Animator({ build, weapon: 'sword', clock: 1 });
    if (plant) new FootPlant().attach(animator);
    const poses = Array.from({ length: 120 }, () => animator.update({ position: new Vector3(), ...input }).body.pose.clone()); // prettier-ignore
    const report = animCheck({ poses: poses.slice(30), skeleton: animator.body.skeleton });
    return Math.max(0, ...report.problems.filter((p) => p.check === 'floor').map((p) => p.worst));
  };
  const KNOWN: Record<string, AnimatorInput> = {
    kneel: { pose: 'kneel' },
    crouch: { pose: 'crouch' },
    dash: { velocity: new Vector3(0, 0, 16), dash: true },
    guard: { pose: 'guard' },
  };

  for (const build of [...BUILDS, 'build:skeleton']) {
    it(`${build}: the layer stands authoring.test.ts's known sinks on the floor, and never sinks a walk`, () => {
      for (const [name, input] of Object.entries(KNOWN)) {
        expect(sink(build, input, false), `${name} without the plant`).toBeGreaterThan(0);
        expect(sink(build, input, true), name).toBe(0);
      }
      expect(sink(build, { velocity: new Vector3(0, 0, 2.5) }, true), 'walk').toBe(0);
    });
  }

  it('ends the post slot, whatever is added after it, and plants the pose that slot made', () => {
    const animator = new Animator({ build: 'build:heroic', clock: 1 });
    const order: string[] = [];
    const plant = new FootPlant().attach(animator);
    const apply = plant.apply.bind(plant);
    plant.apply = (a) => (order.push('footPlant'), apply(a));
    animator.use('post', { name: 'later', weight: 1, apply: () => void order.push('later') });
    animator.update({ pose: 'kneel', position: new Vector3(0, 0.3, 0) });
    expect(order).toEqual(['later', 'footPlant']);
    expect(animator.layer('footPlant')).toBe(plant);
    for (let i = 0; i < 60; i++) animator.update({ pose: 'kneel', position: new Vector3(0, 0.3, 0) });
    expect(plant.inspect().drop).toBeGreaterThanOrEqual(0);
    for (const side of ['L', 'R'] as const) expect(animator.socket(`contact${side}`).y).toBeGreaterThan(0.3 - 0.001);
  });
});

describe('the FootPlant layer on the physics ground, with the stance locks (WP 13.10)', () => {
  /** A ground of `height(x, z)`, as the sim's query view would probe it: none for a ray starting inside it. */
  const queries = (height: (x: number, z: number) => number, normal = new Vector3(0, 1, 0)) => ({
    probe: (x: number, z: number, o: { from?: number; depth?: number } = {}) => {
      const y = height(x, z);
      return y <= (o.from ?? 1e3) && y >= -(o.depth ?? 1e3) ? { y, normal } : null;
    },
  });
  /**
   * The adult planted on `ground`, walked `ticks` steps at `velocity` from `start`, its body's floor at `floor(z)`: each
   * tick's soles, and the left foot's ball and heel (it rolls on its heel as it lands, on its ball as it pushes off).
   */
  const walk = (ground: GroundProbe | null, ticks: number, velocity: Vector3, floor = (_z: number) => 0) => {
    const animator = new Animator({ build: 'build:adult', clock: 1 });
    const plant = new FootPlant().attach(animator);
    plant.ground = ground;
    const position = new Vector3();
    const soles: { L: Vector3; R: Vector3; ball: Vector3; heel: Vector3; low: number; lowR: number; tips: Vector3[]; stance: readonly [boolean, boolean] | null }[] = []; // prettier-ignore
    const b = animator.body.build;
    for (let i = 0; i < ticks; i++) {
      position.addScaledVector(velocity, 1 / 60).setY(floor(position.z));
      animator.update({ position: position.clone(), velocity });
      const { world, skeleton } = animator.body;
      const [L, R, ball] = [animator.socket('contactL'), animator.socket('contactR'), jointPosition(world, 'toeL')]; // prettier-ignore
      const heel = jointToWorld(world, 'footL', new Vector3(0, -b.ankleHeight * b.size, -PROPORTIONS.heel * b.footLength * b.size)); // prettier-ignore
      const lowest = (s: 'L' | 'R', sole: Vector3) => Math.min(sole.y, tipPosition(skeleton, world, `toe${s}`).y, jointToWorld(world, `foot${s}`, new Vector3(0, -b.ankleHeight * b.size, -PROPORTIONS.heel * b.footLength * b.size)).y); // prettier-ignore
      const tips = [tipPosition(skeleton, world, 'toeL'), tipPosition(skeleton, world, 'toeR')];
      soles.push({ L, R, ball, heel, low: lowest('L', L), lowR: lowest('R', R), tips, stance: animator.body.stance() });
    }
    return { animator, plant, soles };
  };
  /** How far the point a held foot rolls on moved between two ticks: its heel or its ball, whichever stayed. */
  const rolled = (now: { ball: Vector3; heel: Vector3 }, then: { ball: Vector3; heel: Vector3 }) =>
    Math.min(now.ball.distanceTo(then.ball), now.heel.distanceTo(then.heel));

  it('queryGround probes the query view straight down, and finds no ground from inside a body', () => {
    const probe = queryGround(queries(() => 0.4));
    const hit = { point: new Vector3(), normal: new Vector3() };
    expect(probe(new Vector3(1, 1, 2), 1, hit)).toBe(true);
    expect(hit.point.toArray()).toEqual([1, 0.4, 2]);
    expect(probe(new Vector3(1, 0.3, 2), 1, hit)).toBe(false); // the ray starts inside it
    expect(probe(new Vector3(1, 2, 2), 1, hit)).toBe(false); // out of reach
  });

  it('stands the soles on a ramp the body walks up, and on its floor where the ground falls away past the slope band', () => {
    const slope = Math.tan((20 * Math.PI) / 180);
    const ramp = walk(queryGround(queries((_x, z) => z * slope)), 120, new Vector3(0, 0, 1.5), (z) => z * slope);
    for (const { L, R } of ramp.soles.slice(30)) {
      for (const sole of [L, R]) expect(sole.y - sole.z * slope).toBeGreaterThan(-0.005); // on or over the ramp
    }
    const grounded = ramp.soles.slice(30).filter(({ low, ball }) => low - ball.z * slope < 0.01);
    expect(grounded.length).toBeGreaterThan(40); // the left foot does stand on it, heel or toes down
    const ledge = walk(queryGround(queries(() => -1)), 60, new Vector3());
    expect(ledge.plant.floorAt(0.1, 0)).toBe(0); // a metre down is past the band: the body's floor
    const { low, lowR } = ledge.soles.at(-1)!;
    for (const y of [low, lowR]) expect(Math.abs(y)).toBeLessThan(0.005); // standing on it, heel or toes down
  });

  it('runs up onto a box: a sole in stance stays on the floor it stood on as the body steps up, the trailing one lifting after', () => {
    for (let edge = 4; edge < 4.8; edge += 0.05) {
      const box = (_x: number, z: number) => (z >= edge ? 0.4 : 0);
      const up = walk(queryGround(queries(box)), 75, new Vector3(0, 0, 5), (z) => (z >= edge - 0.25 ? 0.4 : 0));
      for (const [i, { L, low, tips, stance }] of up.soles.entries()) {
        const [height, before] = [L.y - box(L.x, L.z), up.soles[i - 1]];
        if (stance?.[0] && before?.stance?.[0])
          expect(rolled(up.soles[i], before)).toBeLessThan(1e-6); // held there
        else if (stance?.[0] && i > 30) expect(Math.abs(low - box(L.x, L.z))).toBeLessThan(0.005); // landing on its floor
        expect(height).toBeGreaterThan(-0.005); // its contact never under the floor or the box, leaving or not
        for (const tip of tips) if (tip.y < 0.39) expect(tip.z - edge).toBeLessThan(0.18); // toes into the riser (deferred)
      }
    }
  });

  it('holds a sole in stance where it landed as the body walks on, and lets it go when its stance ends', () => {
    const { soles } = walk(null, 150, new Vector3(0, 0, 2.5));
    let held = 0;
    for (let i = 31; i < soles.length; i++) {
      if (!soles[i].stance?.[0] || !soles[i - 1].stance?.[0]) continue;
      expect(rolled(soles[i], soles[i - 1])).toBeLessThan(1e-6); // rolling on its heel, then on its ball
      held++;
    }
    expect(held).toBeGreaterThan(30);
    expect(soles.at(-1)!.L.z - soles[30].L.z).toBeGreaterThan(2); // and steps on with the body
  });

  it('rides a treadmill: a body told to run in place carries its stance sole back at the belt’s speed', () => {
    const animator = new Animator({ build: 'build:adult', clock: 1 });
    new FootPlant().attach(animator);
    const belt = animator.body.build.speedRef;
    let carried = 0;
    let last = new Vector3();
    for (let i = 0; i < 90; i++) {
      animator.update({ position: new Vector3(), run: 1 });
      const sole = animator.socket('contactL');
      if (i > 30 && animator.body.stance()?.[0] && sole.y < 0.001) carried = Math.max(carried, (last.z - sole.z) * 60);
      last = sole;
    }
    expect(carried).toBeCloseTo(belt, 1);
  });
});
