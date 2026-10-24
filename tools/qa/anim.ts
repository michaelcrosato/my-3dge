/**
 * @file The `anim` QA family (PLAN.md §8.6, WP 6.6, I-29): `node x qa anim` drives every body the engine animates
 * through its state matrix and measures the motion, in Node. The humanoid (each build in `HUMANOIDS`, through
 * `animCheckBody`, engine/anim/check.ts) holds every sample state (`state:<name>`), pose (`pose:<name>`), stance
 * (`stance:<name>`), move (`move:<name>`, played by an `Attack`), reaction (`reaction:<name>`) and action
 * (`action:<name>`, each of data/anim/actions/ played by its own check, engine/anim/actions-check.ts `actionCheck`, WP
 * 8.7) at both facings, from rest and back to rest; the point rigs hold theirs (tools/qa/anim/points.ts: the blob,
 * `blob:<state>`, the floater, `floater:<state>`, and WP 10.1's fixture rigs, `rig:<name>/<state>`). A build with a
 * `kind` reports under ids of its own (`adult/state:run`, the playground's player), so its accepted exceptions
 * (tests/baselines/qa-anim-adult.json) never loosen the others', and a `plantedStride` build holds every movement state
 * too (`motion:<name>`, engine/anim/locomotion/matrix.ts, WP 13.10) and every traversal and holding state
 * (`traversal:<name>`, `hold:<name>`, engine/anim/traversal/matrix.ts, WP 13.11); the rest share each id, valued by
 * their worst. The first build also runs its matrix twice and at half the step, and so does every point rig. Then every
 * library clip (`clip:<SET>/<Clip>`, `set:<SET>`), as data and on every build (tools/qa/anim/clips.ts, WP 8.6, with its
 * metrics; baseline tests/baselines/qa-anim-library.json): about 40 s, so T1 plays a sample.
 *
 * Metrics, one violation per id and metric, valued by the worst case (larger is worse) and naming where it happened:
 * - `nan` (1), `stretch`, `underFloor`, `reach` (metres): `animCheck`'s finite values, bone lengths, feet at or
 *   above the floor and sockets in reach; for a point rig, its points finite and over the floor, its bones' lengths.
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
import { Vector3 } from '../../engine/core/math';
import { getBuild } from '../../engine/anim/builds';
import { actionCheck } from '../../engine/anim/actions-check';
import { Animator } from '../../engine/anim/character';
import { FootPlant } from '../../engine/anim/footPlant';
import { loadClipLibrary, type ClipLibrary } from '../../engine/anim/clip/library';
import { MOVEMENT_STATES } from '../../engine/anim/locomotion/matrix';
import { TRAVERSAL_STATES } from '../../engine/anim/traversal/matrix';
import { animCheckBody, type AnimCheckName } from '../../engine/anim/check';
import { RUN_POINTS, runPoints, STATE_MATRIX, type MatrixRun, type MatrixState } from '../../engine/anim/stateMatrix';
import { ADDED_MOVES, ENGINE_MOVES } from '../../engine/anim/moves-data';
import { POSES, STANCES, type PoseName, type StanceName, type Weapon } from '../../engine/anim/poses';
import { Reactions } from '../../engine/anim/reactions';
import { SAMPLE_STATES } from '../../engine/anim/states';
import { Attack } from '../../engine/anim/attack';
import { defineActions } from '../anim/library';
import { readSet } from '../anim/repack';
import type { QaFamily, QaViolation } from '../cmd/qa';
import { ANIM_QA, closure, footSlide, limbs, m, motionTrack, pops, type Track } from './anim/metrics';
import {
  AHEAD,
  BEHIND,
  checkPointRig,
  facingTurn,
  LEFT,
  pointRigs,
  POINT_RIGS,
  type PointRig,
  type Report,
} from './anim/points';

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
  for (const id of Object.keys({ ...ENGINE_MOVES, ...ADDED_MOVES })) states[id] = attack(id);
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

/**
 * Every violation of the bodies whose ids `keep` keeps, the worst per id and metric, in id order: the humanoids, then
 * `rigs` (the engine's point rigs by default; the family adds the fixtures' where the checkout has them, `pointRigs`).
 */
export function animViolations(
  keep: (id: string) => boolean = () => true,
  rigs: readonly PointRig[] = POINT_RIGS,
): QaViolation[] {
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
  for (const { rig, prefix } of rigs) checkPointRig(rig, prefix, keep, report);
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.metric < b.metric ? -1 : 1));
}

/** The family: every body's motion through its state matrix, then every clip of the library (anim/clips.ts). */
const family: QaFamily = {
  async run({ root, only, keep: asked }) {
    const keep = asked ?? ((id: string) => only.length === 0 || only.some((prefix) => id.startsWith(prefix)));
    const { clipViolations } = await import('./anim/clips'); // loaded here: it measures with this file's metrics
    return [...animViolations(keep, await pointRigs(root)), ...clipViolations(root, keep)];
  },
};

export default family;
