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
import { defineBuild, getBuild } from './builds';
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

/**
 * The plant's sums on the ten walks of its characterization test, as measured on 2026-10-25 (WP 12.2; PRINT_PLANT=1
 * prints them): each walk's left and right soles' heights, both soles' z, the ball's and the heel's heights, both
 * lowest points, and the pelvis's height at the end.
 */
/** footPlant's option test's sums, as measured on 2026-10-25 (WP 12.2; PRINT_PLANT=1 prints them). */
const PLANT_OPTION_SUMS: Record<string, number> = {
  plain: 14407.814715,
  striding: 14426.342167,
  stepping: 14419.998092,
  flat: 13560.510594,
};

const PLANT_SUMS: Record<string, number[]> = {
  flat: [3.80936946, 3.616701961, 347.623806394, 4.799871867, 4.792664644, 3.759189966, -0.048312906],
  ramp: [41.676861745, 40.87443351, 211.146871005, 43.097186423, 42.262543479, 80.451336153, 0.648744003],
  box: [16.632032117, 17.416140798, 481.840584841, 16.06682718, 18.724460796, 27.659300258, 0.28],
  ledge: [0.506651744, 1.307125564, 29.116419709, 1.39883723, 0.514233566, 0.84119302, -0.040248386],
  dip: [2.924102703, -1.048904252, 278.486518178, 3.841903545, 3.973076335, -1.043221019, -0.041518286],
  pit: [3.376371699, -12.588366897, 278.902781165, 3.988820192, 4.625339453, -12.435767034, -0.041518286],
  tall: [4.629956356, 2.431358538, 77.998009589, 5.573690099, 5.414068336, 5.908020675, -0.060643791],
  lift: [14.374891207, 13.947815652, 141.517351191, 15.694127429, 15.0581449, 26.374159173, 0.207663767],
  climb: [29.673151866, 29.835924246, 126.029200302, 30.629211137, 30.049922005, 57.719369323, 0.94999553],
  crouch: [0.418552774, 0.490578795, 113.798977436, 2.238334171, 0.620945908, 0.902360759, -0.347795468],
};

describe('footPlant’s options, called as the layer calls it', () => {
  it('plants as it was measured over its options: locks, rolls, steps, stride, levels, a squash, missing ground', () => {
    // characterization (WP 12.2): footPlant called straight on a walk that spins, for each set of options, its plants
    // summed; a change meant to plant otherwise measures them again (PRINT_PLANT=1 prints them), its reason in its commit
    let t = 0;
    const ground: GroundProbe = (origin, distance, hit) => {
      const [x, z] = [origin.x, origin.z];
      if (x > 1.2 && z > 0.6) return false; // a hole: no ground under it
      const y = x < -0.3 ? -0.2 : 0.004 * t + 0.08 * Math.max(0, z - 0.5); // a step down, a rising ramp
      hit.point.set(x, y, z);
      hit.normal.set(0, 1, -0.08).normalize();
      return y <= origin.y && origin.y - y <= distance;
    };
    const sets: Record<string, Record<string, unknown>> = {
      plain: {},
      striding: { rolls: true, stride: 0.6, levels: true },
      stepping: { rolls: true, steps: true, stride: 0 },
      flat: { rolls: false, release: 0 },
    };
    const states = Object.fromEntries(Object.keys(sets).map((name) => [name, createFootPlantState()]));
    const sums: Record<string, number> = Object.fromEntries(Object.keys(sets).map((name) => [name, 0]));
    const animator = new Animator({ build: 'build:adult', clock: 1 });
    const position = new Vector3();
    for (let i = 0; i < 120; i++, t++) {
      const yaw = 0.09 * i; // spinning: a held foot's heading wraps past π
      const velocity = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(i < 90 ? 1.4 : 0);
      position.addScaledVector(velocity, 1 / 60);
      animator.update({ position: position.clone(), velocity, yaw, body: { crouch: i > 60 && i < 80 ? 0.8 : 0 } });
      const { skeleton, pose } = animator.body;
      const stance = animator.body.stance() ?? [false, false];
      for (const [name, options] of Object.entries(sets)) {
        const [p, w] = [pose.clone(), createWorldPose()];
        if (name === 'flat') p.rootScale.set(1, 0.92, 1); // squashed
        forwardKinematics(skeleton, p, w);
        const state = name === 'plain' ? undefined : states[name];
        const drop = footPlant(skeleton, p, w, ground, { floor: position.y, ...(state ? { state, stance } : {}), ...options }); // prettier-ignore
        sums[name] += drop + w.positions.reduce((a, v, k) => a + v * ((k % 7) + 1), 0);
      }
    }
    const rounded = Object.fromEntries(Object.entries(sums).map(([name, v]) => [name, Math.round(v * 1e6) / 1e6]));
    if (process.env.PRINT_PLANT) console.log(JSON.stringify(rounded));
    expect(rounded).toEqual(PLANT_OPTION_SUMS);
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
  const walk = (
    ground: GroundProbe | null,
    ticks: number,
    velocity: Vector3,
    floor = (_z: number) => 0,
    build = 'build:adult',
    input: AnimatorInput = {},
  ) => {
    const animator = new Animator({ build, clock: 1 });
    const plant = new FootPlant().attach(animator);
    plant.ground = ground;
    const position = new Vector3();
    const soles: { L: Vector3; R: Vector3; ball: Vector3; heel: Vector3; low: number; lowR: number; tips: Vector3[]; stance: readonly [boolean, boolean] | null }[] = []; // prettier-ignore
    const b = animator.body.build;
    for (let i = 0; i < ticks; i++) {
      position.addScaledVector(velocity, 1 / 60).setY(floor(position.z));
      animator.update({ ...input, position: position.clone(), velocity });
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
      for (const [i, { L, R, low, tips, stance }] of up.soles.entries()) {
        const [height, before] = [L.y - box(L.x, L.z), up.soles[i - 1]];
        expect(R.y - box(R.x, R.z)).toBeGreaterThan(-0.005); // the right contact too
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

  it('plants as it was measured: each walk’s soles, ball, heel and lowest points, summed over its ticks', () => {
    // characterization (WP 12.2): the plant's numbers on ten walks, so that a change to how it plants shows here; a
    // change meant to plant otherwise measures them again (PRINT_PLANT=1 prints them), its reason in its commit
    const { id: _id, kind: _kind, ...adult } = getBuild('build:adult') as unknown as Record<string, unknown>;
    defineBuild('build:plant-tall', { ...adult, size: 1.3 } as never);
    const slope = Math.tan((20 * Math.PI) / 180);
    let t = 0;
    const walks = {
      flat: walk(null, 90, new Vector3(0, 0, 2.5)),
      ramp: walk(queryGround(queries((_x, z) => z * slope)), 90, new Vector3(0, 0, 1.5), (z) => z * slope),
      box: walk(queryGround(queries((_x, z) => (z >= 4.3 ? 0.4 : 0))), 75, new Vector3(0, 0, 5), (z) => (z >= 4.05 ? 0.4 : 0)), // prettier-ignore
      ledge: walk(queryGround(queries(() => -1)), 40, new Vector3(0, 0, 1)),
      dip: walk(queryGround(queries((_x, z) => (z > 1 && z < 1.6 ? -0.12 : 0))), 90, new Vector3(0, 0, 2)),
      pit: walk(queryGround(queries((_x, z) => (z > 1 && z < 1.8 ? -0.55 : 0))), 90, new Vector3(0, 0, 2)), // just in a lifted foot's reach
      tall: walk(queryGround(queries((x) => 0.05 * x)), 60, new Vector3(1.2, 0, 1.2), undefined, 'build:plant-tall'),
      lift: walk(queryGround(queries(() => 0.003 * t)), 90, new Vector3(0, 0, 1), () => 0.003 * ++t), // the ground rising
      climb: walk(queryGround(queries((_x, z) => (z >= 1.2 ? 1 : 0))), 60, new Vector3(0, 0, 2), (z) => (z >= 1.1 ? 1 : 0)), // prettier-ignore
      crouch: walk(queryGround(queries(() => 0)), 90, new Vector3(0, 0, 0.8), undefined, undefined, { body: { crouch: 1 } }), // prettier-ignore
    };
    const sums = Object.fromEntries(
      Object.entries(walks).map(([name, { soles, animator }]) => {
        const sum = (f: (s: (typeof soles)[number]) => number) => Math.round(soles.reduce((a, s) => a + f(s), 0) * 1e9) / 1e9; // prettier-ignore
        return [name, [sum((s) => s.L.y), sum((s) => s.R.y), sum((s) => s.L.z + s.R.z), sum((s) => s.ball.y), sum((s) => s.heel.y), sum((s) => s.low + s.lowR), Math.round(animator.body.pose.rootPos.y * 1e9) / 1e9]]; // prettier-ignore
      }),
    );
    if (process.env.PRINT_PLANT) console.log(JSON.stringify(sums));
    expect(sums).toEqual(PLANT_SUMS);
    expect(Object.keys(sums)).toHaveLength(10);
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
