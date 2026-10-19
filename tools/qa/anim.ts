/**
 * @file The `anim` QA family (PLAN.md §8.6, WP 6.6, I-29): `node x qa anim` drives every body the engine animates
 * through its state matrix and measures the motion, in Node. The humanoid (each build in `HUMANOIDS`, through
 * `animCheckBody`, engine/anim/check.ts) holds every sample state (`state:<name>`), pose (`pose:<name>`), stance
 * (`stance:<name>`), move (`move:<name>`, played by an `Attack`), reaction (`reaction:<name>`) and action
 * (`action:<name>`, each of data/anim/actions/ played by its own check, engine/anim/actions-check.ts `actionCheck`, WP
 * 8.7) at both facings, from rest and back to rest; the blob (`blob:<state>`) and the floater (`floater:<state>`) hold
 * theirs. A build with a `kind` reports under ids of its own (`adult/state:run`, the playground's player), so its
 * accepted exceptions (tests/baselines/qa-anim-adult.json) never loosen the others', and a `plantedStride` build holds
 * every movement state too (`motion:<name>`, engine/anim/locomotion/matrix.ts, WP 13.10) and every traversal and
 * holding state (`traversal:<name>`, `hold:<name>`, engine/anim/traversal/matrix.ts, WP 13.11); the rest share each id,
 * valued by their worst. The first build also runs its matrix twice and at half the step, and so do the blob and the
 * floater. Then every library clip (`clip:<SET>/<Clip>`, `set:<SET>`), as data and on every build
 * (tools/qa/anim/clips.ts, WP 8.6, with its metrics; baseline tests/baselines/qa-anim-library.json): about 40 s, so T1
 * plays a sample.
 *
 * Metrics, one violation per id and metric, valued by the worst case (larger is worse) and naming where it happened:
 * - `nan` (1), `stretch`, `underFloor`, `reach` (metres): `animCheck`'s finite values, bone lengths, feet at or
 *   above the floor and sockets in reach; for the blob and the floater, their points finite and over the floor.
 * - `pop`, `footSlide`, `loopClosure`, `jointLimit` and `twistJump`: the motion metrics (tools/qa/anim/metrics.ts).
 * - `angleRange` (radians): an angle of the body's state (the swing, the spin, the lean, the twist, the aim) past ±540°.
 * - `unstableHash` (1): running the matrix again gives another pose. `rateDrift` (metres): a point strays farther than
 *   `STATE_MATRIX.rate` from a run at half the step, beyond a step of its own motion (stateMatrix.ts `rateDrift`).
 *
 * Accepted exceptions go in `tests/baselines/qa-anim.json`, each with its reason; `--only move:` keeps the moves.
 * Invariants: subjects run in a fixed order with fixed clocks and seeded streams, so the same tree gives the same
 * violations; lengths scale with the build's `size`.
 *
 * Carried from `my-3d2dge:tools/ed-sheet.mjs:100-131`: the joints under the floor and the stretch of the limbs (the
 * pops and the foot slide: metrics.ts).
 *
 * @example
 * animViolations((id) => id.startsWith('floater:')); // []: the floater's states, all within the thresholds
 * Object.keys(humanoidStates()).includes('move:slash'); // true
 * @see tools/qa/anim.test.ts
 */
import { Fnv64 } from '../../engine/core/hash';
import { Vector3 } from '../../engine/core/math';
import { getBuild } from '../../engine/anim/builds';
import { actionCheck } from '../../engine/anim/actions-check';
import { Animator } from '../../engine/anim/character';
import { FootPlant } from '../../engine/anim/footPlant';
import { loadClipLibrary, type ClipLibrary } from '../../engine/anim/clip/library';
import { MOVEMENT_STATES } from '../../engine/anim/locomotion/matrix';
import { TRAVERSAL_STATES } from '../../engine/anim/traversal/matrix';
import { animCheckBody, type AnimCheckName } from '../../engine/anim/check';
import { rateDrift, RUN_POINTS, runPoints, STATE_MATRIX, type MatrixRun, type MatrixState } from '../../engine/anim/stateMatrix'; // prettier-ignore
import { ENGINE_MOVES } from '../../engine/anim/moves-data';
import { POSES, STANCES, type PoseName, type StanceName, type Weapon } from '../../engine/anim/poses';
import { Reactions } from '../../engine/anim/reactions';
import { SAMPLE_STATES } from '../../engine/anim/states';
import { Attack } from '../../engine/anim/attack';
import { Blob, BLOB_MOVES, blobMoveTimes, type BlobInput } from '../../engine/anim/blob';
import { Floater, FLOATER } from '../../engine/anim/floater';
import { defineActions } from '../anim/library';
import { readSet } from '../anim/repack';
import type { QaFamily, QaViolation } from '../cmd/qa';
import {
  ANIM_QA,
  closure,
  footSlide,
  limbs,
  m,
  motionTrack,
  pops,
  worse,
  type Found,
  type Track,
} from './anim/metrics';

/** The humanoid bodies the family drives through the whole matrix; the first also runs it twice and at half the step. */
export const HUMANOIDS: readonly { build: string; weapon: Weapon; kind?: string }[] = [
  { build: 'build:heroic', weapon: 'sword' },
  { build: 'build:chibi', weapon: 'none' },
  { build: 'build:bulky', weapon: 'staff' },
  { build: 'build:skeleton', weapon: 'sword' },
  // the playground's player (WP 13.2), under ids of its own, so what it is accepted never loosens the source builds'
  { build: 'build:adult', weapon: 'none', kind: 'adult/' },
];

/** A humanoid of `HUMANOIDS`, made at a step, its feet planted on the floor (`FootPlant`): what the matrix drives. */
export const makeHumanoid =
  ({ build, weapon }: { build: string; weapon: Weapon }) =>
  (dt: number) => {
    const animator = new Animator({ build, weapon, clock: 1, dt });
    new FootPlant().attach(animator); // last in the post slot, as the view's puppets have it (after G9)
    return animator;
  };

const WALK = new Vector3(0, 0, 2.5);
const [AHEAD, BEHIND, LEFT] = [new Vector3(0, 0, 1), new Vector3(0, 0, -1), new Vector3(1, 0, 0)];
/** A direction in the body's frame, turned to its facing. */
const facingTurn = (direction: Vector3, facing: number) =>
  direction.clone().applyAxisAngle(new Vector3(0, 1, 0), facing);

/** A move played by an `Attack` from its wind to its end. */
function attack(id: string): MatrixState {
  const { time } = new Attack(id).move;
  return {
    seconds: time.wind + time.active + time.recover + 1 / 30,
    script: () => {
      const swing = new Attack(id);
      swing.start();
      return (dt) => {
        swing.update(dt);
        return swing.body ? { body: swing.body } : {};
      };
    },
  };
}

/** A reaction played on the animator: `begin` starts it, `at` seconds in, `then` follows (a get-up). */
function reaction(
  seconds: number,
  begin: (r: Reactions, facing: number) => void,
  then?: [number, (r: Reactions, facing: number) => void],
): MatrixState {
  return {
    seconds,
    script: (animator, facing) => {
      const react = new Reactions({ dt: animator.body.dt }).attach(animator);
      let time = 0;
      begin(react, facing);
      return (dt) => {
        if (then && time < then[0] && time + dt >= then[0]) then[1](react, facing);
        time += dt;
        react.step();
        return { ...react.body };
      };
    },
  };
}

/** The clip sets the actions' clip beats play from (WP 8.7), read once. */
let actionClips: ClipLibrary[] | undefined;

/** Each action of data/anim/actions/ (WP 8.7) played by its own check, by QA id (its id, `action:<name>`). */
export function actionStates(): Record<string, MatrixState> {
  const actions = defineActions();
  actionClips ??= ['quaternius', 'mesh2motion'].map((set) => loadClipLibrary(readSet(set)));
  return Object.fromEntries(actions.map((action) => [action.id, actionCheck(action, { libraries: actionClips })]));
}

/** The humanoid's matrix by QA id: every sample state, pose, stance, move, reaction, action, and for a `plantedStride` `build` (the playground's player) every movement, traversal and holding state (engine/anim/locomotion/matrix.ts, engine/anim/traversal/matrix.ts). */ // prettier-ignore
export function humanoidStates(build?: string): Record<string, MatrixState> {
  const states: Record<string, MatrixState> = {};
  for (const [name, state] of Object.entries(SAMPLE_STATES)) {
    const words = Object.keys(state.states);
    if (words.length !== 1 || words[0] !== 'pose') states[`state:${name}`] = state; // a held pose is `pose:<name>`
  }
  for (const pose of Object.keys(POSES) as PoseName[])
    states[`pose:${pose}`] = { states: { pose }, seconds: pose === 'die' ? 2.2 : 1 };
  for (const stance of Object.keys(STANCES) as StanceName[])
    states[`stance:${stance}`] = { states: { stance, velocity: WALK }, seconds: 1 };
  for (const id of Object.keys(ENGINE_MOVES)) states[id] = attack(id);
  states['reaction:flinch'] = reaction(0.8, (r, f) => r.hit(facingTurn(LEFT, f), f, 2), [
    0.3,
    (r, f) => r.hit(facingTurn(BEHIND, f), f, 3),
  ]);
  states['reaction:fallBack'] = reaction(1.8, (r, f) => r.knockDown(facingTurn(BEHIND, f), f));
  states['reaction:fallFront'] = reaction(1.8, (r, f) => r.knockDown(facingTurn(AHEAD, f), f));
  states['reaction:die'] = reaction(2.6, (r) => r.die(), [1.8, (r) => r.getUp()]);
  return { ...states, ...actionStates(), ...(build && getBuild(build).plantedStride ? { ...MOVEMENT_STATES, ...TRAVERSAL_STATES } : {}) }; // prettier-ignore
}

/**
 * The kinds of the humanoid's QA ids (`state:`, `pose:`, …), from its matrix, then the kinds of the builds that have
 * ids of their own (`adult/`): as `only`, the humanoid without clips.
 */
export function humanoidPrefixes(): string[] {
  const kinds = Object.keys(humanoidStates()).map((id) => id.slice(0, id.indexOf(':') + 1));
  return [...new Set([...kinds, ...HUMANOIDS.flatMap((body) => (body.kind ? [body.kind] : []))])];
}

/** A humanoid run as a track: its joints and sockets (stateMatrix.ts `RUN_POINTS`), standing on its soles. */
function humanoidTrack(run: MatrixRun, where: string, size: number): Track {
  const world = runPoints(run).map((points, i) => points.map((p) => p.add(run.positions[i])));
  const feet = [RUN_POINTS.indexOf('contactL'), RUN_POINTS.indexOf('contactR')];
  const { dt, treadmill, held, positions } = run;
  return motionTrack({ where, size, dt, names: RUN_POINTS, world, positions, feet, treadmill, held });
}

/** A body that is not a humanoid, as the family drives it: its points, its states and a fresh body for one. */
interface PointRig {
  names: readonly string[];
  /** How many of the first points a state must bring back at rest (the others cycle: wings, motes). */
  closed: number;
  /** Seconds each state holds, by QA id. */
  states: Readonly<Record<string, number>>;
  /** A fresh body for `state` at `facing`: `step(time)` tells it the state `time` seconds in, or its rest (undefined). */
  make(state: string, facing: number, dt: number): { step(time?: number): Vector3; points(): Vector3[] };
}

/** The blob's states: what it is told, at rest (time undefined) and while it holds the state. */
const BLOB_TELLS: Readonly<Record<string, (facing: number, blob: Blob, time?: number) => BlobInput>> = {
  rest: () => ({}),
  stretch: (_, __, time) => ({ squash: time === undefined ? 0 : 0.45 }),
  flatten: (_, __, time) => ({ squash: time === undefined ? 0 : -0.45 }),
  turn: (facing, _, time) => ({ look: facingTurn(time === undefined ? AHEAD : LEFT, facing) }),
  hang: () => ({ hang: true }), // a roost is held from the start: hanging is a switch, not a motion
  fold: (_, __, time) => (time === undefined ? {} : { flap: 0, squint: true }),
  kick: (_, blob, time) => (time === 0 && blob.kick(5), {}),
};

/** The blob rig: its body, eyes, mouth and wings, rest-closed. */
const BLOB_RIG: PointRig = {
  names: ['root', 'centre', 'top', 'bottom', 'eyeL', 'eyeR', 'mouth', 'wingL', 'wingL tip', 'wingR', 'wingR tip'],
  closed: 7,
  states: {
    ...Object.fromEntries(Object.keys(BLOB_TELLS).map((name) => [`blob:${name}`, 0.6])),
    ...Object.fromEntries(Object.keys(BLOB_MOVES).map((name) => [`blob:${name}`, blobMoveTimes(name as never).end])),
  },
  make(state, facing, dt) {
    const blob = new Blob({ yaw: facing, dt });
    const name = state.slice('blob:'.length);
    const tell = BLOB_TELLS[name] ?? ((_, __, time) => (time === undefined ? {} : { move: { name, time } }));
    return {
      step: (time) => blob.step(tell(facing, blob, time)).position,
      points() {
        const J = blob.pose();
        const at = (matrix: (typeof J)['root'], x = 0, y = 0) => new Vector3(x, y, 0).applyMatrix4(matrix);
        return [at(J.root), at(J.body), at(J.body, 0, 1), at(J.body, 0, -1), at(J.eyeL), at(J.eyeR), at(J.mouth), at(J.wingL), at(J.wingL, 0, 1), at(J.wingR), at(J.wingR, 0, 1)]; // prettier-ignore
      },
    };
  },
};

/** The floater rig: its core, its axes at the motes' orbit and its motes, hovering on its own over the floor. */
const FLOATER_RIG: PointRig = {
  names: ['core', 'nose', 'side', 'top', 'mote0', 'mote1', 'mote2'],
  closed: 4,
  states: { 'floater:rest': 1, 'floater:travel': 1, 'floater:turn': 1.5, 'floater:swell': 1 }, // a swell held 1 s
  make(state, facing, dt) {
    const wisp = new Floater({ yaw: facing, clock: 0, dt });
    const at = new Vector3(0, FLOATER.height, 0);
    return {
      step(time) {
        const ahead = facingTurn(AHEAD, facing + (state === 'floater:turn' ? 2 * (time ?? 0) : 0)).multiplyScalar(4);
        const moving = time !== undefined && (state === 'floater:travel' || state === 'floater:turn');
        const velocity = moving ? ahead : new Vector3();
        // a charge builds and is spent within the hold: the caller eases the swell, the floater shows it
        const swell = time !== undefined && state === 'floater:swell' ? Math.sin(Math.PI * time) : 0;
        wisp.step({ position: at, velocity, swell, yaw: moving ? undefined : facing });
        const placed = at.clone();
        at.addScaledVector(velocity, dt).y += wisp.hover(at.y, 0) * dt;
        return placed;
      },
      points() {
        const J = wisp.pose();
        const axes = [AHEAD, LEFT, new Vector3(0, 1, 0)].map((axis) => axis.clone().multiplyScalar(FLOATER.orbit).applyMatrix4(J.core)); // prettier-ignore
        return [new Vector3().setFromMatrixPosition(J.core), ...axes, ...J.motes.map((mote) => mote.clone())];
      },
    };
  },
};

/** One run of a point rig: the state held at a facing, from rest and back to rest (or at rest throughout). */
function drive(rig: PointRig, state: string, facing: number, dt: number, rest = false): Track {
  const body = rig.make(state, facing, dt);
  const steps = (s: number) => Math.round(s / dt);
  const [lead, end] = [steps(STATE_MATRIX.lead), steps(STATE_MATRIX.lead) + Math.max(1, steps(rig.states[state]))];
  const [world, at]: [Vector3[][], Vector3[]] = [[], []];
  for (let i = 0; i < end + steps(STATE_MATRIX.after); i++) {
    at.push(body.step(!rest && i >= lead && i < end ? (i - lead) * dt : undefined).clone());
    world.push(body.points());
  }
  return motionTrack({ where: `facing ${facing}`, dt, names: rig.names, world, positions: at, held: [lead, end] });
}

/** A track's digest over every point of every step. */
const hashTrack = (t: Track) => t.world.reduce((h, points) => points.reduce((g, p) => g.numbers(p.toArray()), h), new Fnv64()).hex(); // prettier-ignore

/** Where a point rig's points are not finite or sink below the floor. */
function pointProblems(t: Track): { nan: Found; floor: Found } {
  let [nan, floor]: Found[] = [undefined, undefined];
  t.world.forEach((points, i) =>
    points.forEach((p, k) => {
      const at = `${t.where}: at frame ${i}, ${t.names[k]}`;
      if (![p.x, p.y, p.z].every(Number.isFinite)) nan ??= { value: 1, message: `${at} is not a finite point` };
      else if (p.y < -0.001) floor = worse(floor, { value: -p.y, message: `${at} is ${m(-p.y)} m below the floor` });
    }),
  );
  return { nan, floor };
}

/** The metric each of `animCheckBody`'s checks reports as. */
const METRIC: Readonly<Record<AnimCheckName, string>> = {
  finite: 'nan',
  length: 'stretch',
  rigid: 'stretch',
  floor: 'underFloor',
  reach: 'reach',
  hash: 'unstableHash',
  rate: 'rateDrift',
};

/** Adds what a finding says to the violations, keeping the worst per id and metric. */
type Report = (id: string, metric: string, found: Found) => void;

/** A humanoid body through the whole matrix: `animCheckBody`'s checks, then the motion over each run. */
function checkHumanoid(
  body: (typeof HUMANOIDS)[number],
  states: Record<string, MatrixState>,
  full: boolean,
  report: Report,
): void {
  const make = makeHumanoid(body);
  const angles = new Map<MatrixRun, number>();
  const onStep = ({ body: { state: s } }: Animator, run: MatrixRun) => {
    const largest = Math.max(
      ...[s.arm.theta, s.arm.theta0, s.arm.turn, s.body.lean, s.body.twist, s.aim].map(Math.abs),
    );
    angles.set(run, Math.max(angles.get(run) ?? 0, largest));
  };
  const result = animCheckBody(make, { states, onStep, hash: full, rate: full ? STATE_MATRIX.rate : false });
  for (const p of result.problems) {
    report(p.state ?? '', METRIC[p.check], {
      value: Number.isNaN(p.worst) ? 1 : p.worst,
      message: `${body.build}, ${p.message}`,
    });
  }
  const size = getBuild(body.build).size;
  const longest = Math.max(...Object.values(states).map((state) => state.seconds));
  const rests = new Map(
    animCheckBody(make, { states: { rest: { seconds: longest } }, hash: false, rate: false }).runs.map((run) => [
      run.facing,
      humanoidTrack(run, '', size),
    ]),
  );
  for (const run of result.runs) {
    const where = `${body.build}, ${run.state} facing ${run.facing}`;
    const t = humanoidTrack(run, where, size);
    const { limit, twist } = limbs(run, where);
    const rest = rests.get(run.facing);
    const angle = angles.get(run) ?? 0;
    report(run.state, 'pop', pops(t));
    report(run.state, 'footSlide', footSlide(t));
    report(run.state, 'loopClosure', rest && closure(t, rest));
    report(run.state, 'jointLimit', limit);
    report(run.state, 'twistJump', twist);
    if (angle > ANIM_QA.angle) report(run.state, 'angleRange', { value: angle, message: `${where}: an angle of the body's state reaches ${m(angle)} rad, past ±540°; wrap it` }); // prettier-ignore
  }
}

/** A point rig's states: its own checks, the motion, the hash and the rate. */
function checkPointRig(rig: PointRig, keep: (id: string) => boolean, report: Report): void {
  for (const state of Object.keys(rig.states)) {
    if (!keep(state)) continue;
    for (const facing of STATE_MATRIX.facings) {
      const t = drive(rig, state, facing, 1 / 60);
      const { nan, floor } = pointProblems(t);
      report(state, 'nan', nan);
      report(state, 'underFloor', floor);
      report(state, 'pop', pops(t));
      report(state, 'loopClosure', closure(t, drive(rig, state, facing, 1 / 60, true), rig.closed));
      if (hashTrack(drive(rig, state, facing, 1 / 60)) !== hashTrack(t)) {
        report(state, 'unstableHash', { value: 1, message: `${t.where}: running it again gave other points; look for module state` }); // prettier-ignore
      }
      const { worst, frame, point } = rateDrift(t.local, drive(rig, state, facing, 1 / 120).local);
      if (worst > STATE_MATRIX.rate) {
        report(state, 'rateDrift', { value: worst, message: `${t.where}: at frame ${frame}, ${t.names[point]} is ${m(worst)} m from where half steps put it (over ${STATE_MATRIX.rate} m); scale each step's change by dt` }); // prettier-ignore
      }
    }
  }
}

/** Every violation of the bodies whose ids `keep` keeps, the worst per id and metric, in id order. */
export function animViolations(keep: (id: string) => boolean = () => true): QaViolation[] {
  const found = new Map<string, QaViolation>();
  const report: Report = (id, metric, value) => {
    const key = `${id}\u0000${metric}`;
    if (value && value.value > (found.get(key)?.value ?? -Infinity)) {
      found.set(key, { id, metric, value: Math.round(value.value * 1e4) / 1e4, message: value.message });
    }
  };
  HUMANOIDS.forEach((body, i) => {
    const [kind, matrix] = [body.kind ?? '', Object.entries(humanoidStates(body.build))];
    const states = Object.fromEntries(matrix.filter(([id]) => keep(kind + id)));
    if (Object.keys(states).length === 0) return;
    checkHumanoid(body, states, i === 0, (id, metric, found) => report(kind + id, metric, found));
  });
  for (const rig of [BLOB_RIG, FLOATER_RIG]) checkPointRig(rig, keep, report);
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.metric < b.metric ? -1 : 1));
}

/** The family: every body's motion through its state matrix, then every clip of the library (anim/clips.ts). */
const family: QaFamily = {
  async run({ root, only, keep: asked }) {
    const keep = asked ?? ((id: string) => only.length === 0 || only.some((prefix) => id.startsWith(prefix)));
    const { clipViolations } = await import('./anim/clips'); // loaded here: it measures with this file's metrics
    return [...animViolations(keep), ...clipViolations(root, keep)];
  },
};

export default family;
