/**
 * @file Unit tests for the procedural humanoid (engine/anim/humanoid.ts), PLAN.md WP 3.6's Done when: the
 * differential tests against my-3d2dge's reference vectors (tests/baselines/port/humanoid-{chibi,heroic,bulky}.json,
 * converted to SI) put the joints within 1 cm on average and 3 cm at worst, every exception listed with its reason.
 * Also: the fixed step, a solve that reads only the state, bone lengths in every state, and the seeded stream.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from '../core/math';
import { Rng } from '../core/rng';
import { SIM_DT } from '../core/time';
import { animCheck } from './check';
import { jointPosition, jointRotation, jointToWorld } from './fk';
import { Humanoid, type HumanoidInput } from './humanoid';
import { hashPose, type Pose } from './pose';
import { POSES, STANCES } from './poses';

type V3 = [number, number, number];
/** One reference run (tools/cmd/port.ts `humanoidRun`). */
interface Run {
  state: string;
  facing: number;
  t0: number;
  root0: V3;
  velocity: V3;
  input: { pose?: string; stance?: string; dash?: boolean; air?: boolean; climb?: boolean };
  samples: number[][];
}
/** One build's reference vectors. */
interface Vectors {
  dt: number;
  steps: number;
  points: string[];
  runs: Run[];
}
const BUILDS = ['chibi', 'heroic', 'bulky'];
const load = (build: string) =>
  JSON.parse(readFileSync(`tests/baselines/port/humanoid-${build}.json`, 'utf8')) as Vectors;

/** A my-3d2dge position in metres (Appendix C): (x, y, z) / 16 → (x, z, y). */
const point = (x: number, y: number, z: number, out = new Vector3()) => out.set(x / 16, z / 16, y / 16);

/** my-3d2dge's sword (`bladeLen` 11 units): the old `tip()` is the wrist plus the blade's direction times this. */
const BLADE = 11 / 16;

/** The old rig's joints that are skeleton joints, by their new names (Appendix C). */
const JOINT_OF: Record<string, string> = {
  hipC: 'pelvis',
  shC: 'neck',
  hipL: 'thighL',
  hipR: 'thighR',
  kneeL: 'shinL',
  kneeR: 'shinR',
  shL: 'upperArmL',
  shR: 'upperArmR',
  elbowL: 'forearmL',
  elbowR: 'forearmR',
  handL: 'handL',
  handR: 'handR',
};

/**
 * Where an old point is on the new skeleton. The old `head` is the head's centre, one radius above the skull's base;
 * the old foot point is the sole under the ankle (ADR-0009 amendment 1); the old tip ran from the wrist along the
 * blade, which is the weapon socket's +Z.
 */
function newPoint(hero: Humanoid, name: string, out: Vector3): Vector3 {
  const { world, skeleton } = hero;
  if (JOINT_OF[name]) return jointPosition(world, JOINT_OF[name] as 'pelvis', out);
  if (name === 'head') return jointToWorld(world, 'head', new Vector3(0, skeleton.headRadius, 0), out);
  if (name === 'footL' || name === 'footR') {
    return jointToWorld(world, name, new Vector3(0, -hero.build.ankleHeight * hero.build.size, 0), out);
  }
  const blade = new Vector3(0, 0, 1).applyQuaternion(jointRotation(world, 'handR'));
  return jointPosition(world, 'handR', out).addScaledVector(blade, BLADE * hero.build.size);
}

/** The input of one reference step, in the engine's terms: SI, +Y up, yaw = π/2 − facing (Appendix C). */
function inputOf(run: Run, root: V3): HumanoidInput {
  return {
    position: point(...root),
    velocity: point(...run.velocity),
    yaw: Math.PI / 2 - (run.facing * Math.PI) / 4,
    dash: run.input.dash,
    air: run.input.air,
    climb: run.input.climb,
    pose: run.input.pose as HumanoidInput['pose'],
    stance: run.input.stance as HumanoidInput['stance'],
  };
}

/** Every sampled point's error (metres) over one build's runs, by `state/point`. */
function differential(build: string): Map<string, number[]> {
  const ref = load(build);
  const errors = new Map<string, number[]>();
  const [want, got] = [new Vector3(), new Vector3()];
  for (const run of ref.runs) {
    // the reference rig's recorded breathing phase, injected (WP 0.11): breathing cannot add to the error
    const hero = new Humanoid({ build: `build:${build}`, weapon: 'sword', clock: run.t0, dt: ref.dt });
    const root: V3 = [...run.root0];
    let next = 0;
    for (let step = 1; step <= ref.steps; step++) {
      for (let i = 0; i < 3; i++) root[i] += run.velocity[i] * ref.dt;
      hero.update(inputOf(run, root));
      const sample = run.samples[next];
      if (sample?.[0] !== step) continue;
      next++;
      ref.points.forEach((name, i) => {
        point(sample[4 + i * 3], sample[5 + i * 3], sample[6 + i * 3], want);
        const key = `${run.state}/${name}`;
        if (!errors.has(key)) errors.set(key, []);
        errors.get(key)!.push(newPoint(hero, name, got).distanceTo(want));
      });
    }
    expect(next).toBe(run.samples.length);
  }
  return errors;
}

/**
 * Points allowed past 3 cm, each with its reason. Empty: no view hack ran when the vectors were recorded
 * (tests/baselines/port/README.md: `_cheat` 0, `_pitch` and `_camSide` unset), and the ankle's bend, the one change
 * of shape, keeps every knee and sole within 3 cm.
 */
const EXCEPTIONS: Readonly<Record<string, string>> = {};

/** The worst error of each `state/point`, worst first. */
const worstOf = (errors: Map<string, number[]>) =>
  [...errors].map(([key, list]) => [key, Math.max(...list)] as const).sort((a, b) => b[1] - a[1]);

describe('the differential tests against my-3d2dge (WP 3.6 Done when)', () => {
  const results = new Map<string, Map<string, number[]>>();
  beforeAll(() => {
    for (const build of BUILDS) results.set(build, differential(build));
  });

  for (const build of BUILDS) {
    it(`${build}: every joint within 1 cm on average and 3 cm at worst, over 18 states at 8 facings`, () => {
      const errors = results.get(build)!;
      const all = [...errors.values()].flat();
      const mean = all.reduce((a, b) => a + b, 0) / all.length;
      const worst = worstOf(errors);
      expect(all.length).toBe(18 * (30 + 7 * 3) * 16); // 18 states; 30 samples at facing 0, 3 at each other; 16 points
      expect(mean).toBeLessThan(0.01);
      expect(mean).toBeLessThan(0.001); // measured 0.70–0.78 mm
      const over = worst.filter(([key, e]) => e > 0.03 && !EXCEPTIONS[key]);
      expect(over, `worst: ${JSON.stringify(worst.slice(0, 6))}`).toEqual([]);
      expect(worst[0][1]).toBeLessThan(0.021); // measured 1.6–2.0 cm, a knee or a kneeling sole
    });
  }

  it('lands every joint above the knees on the old points, to float32 rounding', () => {
    const exact = ['hipC', 'shC', 'head', 'shL', 'shR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'tip'];
    for (const errors of results.values()) {
      for (const [key, list] of errors) {
        if (exact.includes(key.split('/')[1])) expect(Math.max(...list), key).toBeLessThan(2e-6);
      }
    }
  });

  it("matches the legs exactly where the feet are in the air, and within the ankle's bend elsewhere", () => {
    for (const errors of results.values()) {
      for (const name of ['kneeL', 'kneeR', 'footL', 'footR']) {
        expect(Math.max(...errors.get(`air/${name}`)!), `air/${name}`).toBeLessThan(2e-6);
      }
      const legs = [...errors].filter(([key]) => /\/(knee|foot)/.test(key)).flatMap(([, list]) => list);
      expect(legs.reduce((a, b) => a + b, 0) / legs.length).toBeLessThan(0.004); // measured 2.8–3.1 mm
    }
  });
});

/** Steps `hero` `steps` times with `input`. */
function run(hero: Humanoid, input: HumanoidInput, steps: number): Humanoid {
  for (let i = 0; i < steps; i++) hero.update(input);
  return hero;
}
const WALK: HumanoidInput = { velocity: new Vector3(0, 0, 2), yaw: 0.4 };

describe('the fixed step and the two halves of an update', () => {
  it('steps at SIM_DT by default', () => {
    const hero = new Humanoid({ clock: 0 });
    expect(hero.dt).toBe(SIM_DT);
    run(hero, {}, 60);
    expect(hero.state.clock).toBeCloseTo(1, 12);
  });

  it('gives the same state and pose for the same inputs, every time', () => {
    const make = () => run(new Humanoid({ build: 'build:bulky', weapon: 'staff', rng: new Rng(3) }), WALK, 90);
    const [a, b] = [make(), make()];
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(hashPose(a.pose)).toBe(hashPose(b.pose));
  });

  it('solves from the state alone: a copy of the state gives the same pose, and solving again changes nothing', () => {
    const hero = run(new Humanoid({ rng: new Rng(9) }), { ...WALK, pose: 'cheer', position: new Vector3(3, 0, 1) }, 45);
    const hash = hashPose(hero.pose);
    expect(hashPose(hero.solve().pose)).toBe(hash);
    const copy = new Humanoid({ rng: new Rng(1) });
    Object.assign(copy.state, structuredClone(hero.state));
    copy.position.copy(hero.position);
    copy.yaw = hero.yaw;
    expect(hashPose(copy.solve().pose)).toBe(hash);
  });

  it('keeps every bone its length in every state, with finite values', () => {
    const inputs: HumanoidInput[] = [
      WALK,
      { ...WALK, dash: true },
      { air: true },
      { climb: true, velocity: new Vector3(0, 2, 0) },
      { ...WALK, hurt: true, point: true, aim: 0.4 },
      ...Object.keys(POSES).map((pose) => ({ pose }) as HumanoidInput),
      ...Object.keys(STANCES).map((stance) => ({ ...WALK, stance }) as HumanoidInput),
    ];
    for (const build of ['build:chibi', 'build:skeleton']) {
      const poses: Pose[] = [];
      for (const input of inputs) {
        const hero = new Humanoid({ build, weapon: 'sword', clock: 1 });
        for (let i = 0; i < 60; i++) poses.push(hero.update(input).pose.clone());
      }
      const report = animCheck({ poses, skeleton: build, floor: -10 });
      expect(report.problems).toEqual([]);
    }
  });
});

describe('the seeded stream', () => {
  it('draws the breathing phase from the entity stream, unless the clock is given', () => {
    expect(new Humanoid({ rng: new Rng(5) }).state.clock).toBe(new Rng(5).next() * 10);
    expect(new Humanoid({ rng: new Rng(5), clock: 2.5 }).state.clock).toBe(2.5);
    expect(new Humanoid({ rng: new Rng(6) }).state.clock).not.toBe(new Humanoid({ rng: new Rng(5) }).state.clock);
  });

  it('times the blinks from the same stream: shut for 0.12 s, then open 2 to 5 s', () => {
    const rng = new Rng(11);
    const hero = new Humanoid({ rng, clock: 0 });
    const before = rng.state;
    const opens: number[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      const was = hero.step().state.blink;
      if (was > 1.9) opens.push(was);
    }
    expect(rng.state).not.toBe(before);
    for (const open of opens.filter((o, i) => i === 0 || o !== opens[i - 1] - SIM_DT)) {
      expect(open).toBeGreaterThanOrEqual(2 - SIM_DT);
      expect(open).toBeLessThanOrEqual(5);
    }
  });
});

describe('the humanoid’s stance and what the view shows (WP 13.10)', () => {
  it('says when a planted build’s feet stand: both standing, in turn walking, neither while it strikes; null for others', () => {
    expect(new Humanoid({ build: 'build:heroic', clock: 0 }).update({}).stance()).toBeNull();
    const adult = new Humanoid({ build: 'build:adult', clock: 0 });
    expect(adult.update({}).stance()).toEqual([true, true]);
    const seen = new Set<string>();
    for (let i = 0; i < 90; i++) {
      const stance = adult.update({ velocity: new Vector3(0, 0, 4.4) }).stance();
      if (i >= 30) seen.add(JSON.stringify(stance)); // up to speed: below a step's pace both stand
    }
    expect(seen).toEqual(new Set(['[true,false]', '[false,true]', '[false,false]'])); // a run's flight between steps
    for (let i = 0; i < 3; i++) adult.update({ body: { move: 'move:slash', phase: 'wind', u: 0.5 } });
    expect(adult.stance()).toEqual([false, false]);
  });

  it('tells the ground’s velocity under a body running in place, and none otherwise', () => {
    const adult = new Humanoid({ build: 'build:adult', clock: 0 });
    adult.update({ run: 1, yaw: Math.PI / 2 });
    const belt = adult.treadmill();
    expect(belt.x).toBeCloseTo(-adult.build.speedRef, 12);
    expect(Math.abs(belt.z)).toBeLessThan(1e-12);
    expect(adult.update({}).treadmill().length()).toBe(0);
  });

  it('poses what the view shows but never steps or hashes it', () => {
    const [plain, shown] = [new Humanoid({ build: 'build:adult', clock: 0 }), new Humanoid({ build: 'build:adult', clock: 0 })]; // prettier-ignore
    shown.shown.crouch = 1;
    for (let i = 0; i < 30; i++) [plain, shown].forEach((h) => h.update({ velocity: new Vector3(0, 0, 2) }));
    expect(JSON.stringify(shown.state)).toBe(JSON.stringify(plain.state));
    expect(jointPosition(shown.world, 'pelvis').y).toBeLessThan(jointPosition(plain.world, 'pelvis').y - 0.1);
  });
});
