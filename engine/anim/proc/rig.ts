/**
 * @file Procedural rigs (PLAN.md WP 10.1): the contract a creature built from the blocks of engine/anim/proc meets, so
 * one check runs every such rig as `anim.check` runs the humanoid (engine/anim/check.ts) and the `anim` QA family
 * measures their motion (tools/qa/anim.ts). A `ProcRig` names:
 * - `names`: its points (world metres), what the view draws on and the checks measure;
 * - `bones`: pairs of points that keep their distance (a leg's bones, a tail's links), held to the length a bone
 *   gives or else the run's first frame;
 * - `feet`: the points that plant, which must not slide while on the floor (the QA's foot slide);
 * - `closed`: how many of its first points come back at rest (the rest cycle: motes, a wave), for every state or by
 *   state (`rigClosed`: a state not named closes every point);
 * - `states`: what it does, each held some seconds;
 * - `make(state, facing, dt)`: a fresh body facing `facing`, stepped at `dt`: `step(time)` takes it `time` seconds
 *   into the state (undefined: at rest) and returns where its root is; `points()` gives its points.
 * `driveRig(rig, state, facing, dt)` runs a state as the humanoid's matrix does (`STATE_MATRIX.lead` seconds at rest,
 * the state, `STATE_MATRIX.after` at rest); `rigCheck(rig)` runs every state at both of its facings and reports in
 * `anim.check`'s words: points not finite (`finite`), bones off their length (`length`, past `tolerance`), points
 * under the floor (`floor`), a run giving other points the second time (`hash`), and points straying farther than
 * `STATE_MATRIX.rate` at half the step, beyond a step of their own motion (`rate`).
 *
 * Invariants: read-only and deterministic: the same rig gives the same report; a problem is reported once per check,
 * state and point, naming its first frame, how many frames have it and the worst value. A rig that breaks its own
 * contract (a bone, a foot or a closure naming what it lacks, a state it has not, points() not one a name) throws
 * `ANIM_BAD_RIG`.
 *
 * @example
 * import { Vector3 } from '../../core/math';
 * const post: ProcRig = { id: 'rig:post', names: ['foot', 'top'], bones: [['foot', 'top']], states: { still: 0.5 }, make: () => ({ step: () => new Vector3(), points: () => [new Vector3(), new Vector3(0, 1, 0)] }) }; // prettier-ignore
 * rigCheck(post).ok; // true: finite, on the floor, its bone its length, the same every run and at any step
 * @see engine/anim/proc/rig.test.ts
 */
import { Fnv64 } from '../../core/hash';
import { codeError, defineCodes, didYouMean } from '../../core/log';
import type { Vector3 } from '../../core/math';
import type { AnimCheckName, AnimCheckReport, AnimProblem } from '../check';
import { rateDrift, STATE_MATRIX } from '../stateMatrix';

/** The codes this module raises, with their fixes. */
export const RIG_CODES = defineCodes('anim', {
  ANIM_BAD_RIG: {
    template: 'the rig {id} {problem}{suggestion}',
    fix: 'use its own names in bones, feet, closed and runs; give one point a name, bones and states sizes above 0',
    doc: 'Raised by `driveRig` and `rigCheck` (engine/anim/proc/rig.ts) for a rig that breaks its own contract.',
  },
});

/** A body of a rig, made for one run (see the file comment). */
export interface ProcRigBody {
  step(time?: number): Vector3;
  points(): Vector3[];
}

/** A procedural rig (see the file comment). */
export interface ProcRig {
  readonly id: string;
  readonly names: readonly string[];
  readonly bones?: readonly (readonly [a: string, b: string, length?: number])[];
  readonly feet?: readonly string[];
  readonly closed?: number | Readonly<Record<string, number>>;
  readonly states: Readonly<Record<string, number>>;
  make(state: string, facing: number, dt: number): ProcRigBody;
}

/** One run of a rig: its root and its points each step, and the steps the state held. */
export interface RigRun {
  readonly positions: Vector3[];
  readonly world: Vector3[][];
  readonly held: readonly [number, number];
}

/** How many of `rig`'s first points come back at rest after `state` (see the file comment). */
export function rigClosed(rig: ProcRig, state: string): number {
  const closed = rig.closed;
  return typeof closed === 'number' ? closed : (closed?.[state] ?? rig.names.length);
}

/** Throws `ANIM_BAD_RIG` for `rig`: `problem`, with the names closest to `wanted` among `among`. */
function badRig(rig: ProcRig, problem: string, wanted = '', among: readonly string[] = []): never {
  throw codeError('ANIM_BAD_RIG', { id: rig.id, problem, suggestion: wanted ? didYouMean(wanted, among) : '' });
}

/** Throws `ANIM_BAD_RIG` for a bone, a foot or a closure naming what `rig` lacks, or a `state` it has not. */
function checkRig(rig: ProcRig, state?: string): void {
  const states = Object.keys(rig.states);
  for (const name of [...(rig.bones ?? []).flatMap(([a, b]) => [a, b]), ...(rig.feet ?? [])]) {
    if (!rig.names.includes(name)) badRig(rig, `names ${JSON.stringify(name)} in its bones or feet, not one of its points`, name, rig.names); // prettier-ignore
  }
  for (const name of typeof rig.closed === 'object' ? Object.keys(rig.closed) : []) {
    if (!states.includes(name)) badRig(rig, `closes ${JSON.stringify(name)}, not one of its states`, name, states);
  }
  const counts =
    typeof rig.closed === 'object' ? Object.values(rig.closed) : rig.closed === undefined ? [] : [rig.closed];
  const count = counts.find((n) => !(Number.isInteger(n) && n >= 0 && n <= rig.names.length));
  if (count !== undefined) badRig(rig, `closes ${count} points, not a whole number from 0 to its ${rig.names.length}`);
  const bone = (rig.bones ?? []).find(
    ([, , length]) => length !== undefined && !(Number.isFinite(length) && length > 0),
  );
  if (bone) badRig(rig, `gives its bone ${bone[0]}–${bone[1]} the length ${bone[2]}, not a finite length above 0`);
  const held = states.find((name) => !(Number.isFinite(rig.states[name]) && rig.states[name] > 0));
  if (held !== undefined) badRig(rig, `holds its state ${JSON.stringify(held)} ${rig.states[held]} s, not a finite time above 0`); // prettier-ignore
  if (state !== undefined && !states.includes(state)) badRig(rig, `has no state ${JSON.stringify(state)}`, state, states); // prettier-ignore
}

/** Runs `state` of `rig` at `facing` and step `dt`: rest, the state, rest (or rest throughout with `rest`). */
export function driveRig(rig: ProcRig, state: string, facing: number, dt: number, rest = false): RigRun {
  checkRig(rig, state);
  const body = rig.make(state, facing, dt);
  const steps = (s: number) => Math.round(s / dt);
  const [lead, end] = [steps(STATE_MATRIX.lead), steps(STATE_MATRIX.lead) + Math.max(1, steps(rig.states[state]))];
  const [positions, world]: [Vector3[], Vector3[][]] = [[], []];
  for (let i = 0; i < end + steps(STATE_MATRIX.after); i++) {
    positions.push(body.step(!rest && i >= lead && i < end ? (i - lead) * dt : undefined).clone());
    const points = body.points();
    if (points.length !== rig.names.length) badRig(rig, `has points() give ${points.length} for its ${rig.names.length} names`); // prettier-ignore
    world.push(points.map((p) => p.clone()));
  }
  return { positions, world, held: [lead, end] };
}

/** A run's digest over every point of every step. */
export const hashRigRun = (run: RigRun): string => run.world.reduce((h, points) => points.reduce((g, p) => g.numbers(p.toArray()), h), new Fnv64()).hex(); // prettier-ignore

/** A metre value for messages: up to 4 decimals. */
const m = (value: number) => String(Math.round(value * 1e4) / 1e4);

/** Checks every state of `rig` at both facings (see the file comment). */
export function rigCheck(rig: ProcRig, options: { tolerance?: number; floor?: number } = {}): AnimCheckReport {
  const { tolerance = 0.001, floor = 0 } = options;
  checkRig(rig);
  const found = new Map<string, AnimProblem>();
  const index = (name: string) => rig.names.indexOf(name);
  const bones = (rig.bones ?? []).map(([a, b, length]) => [index(a), index(b), `${a}–${b}`, length] as const);
  let frames = 0;
  const add = (state: string, check: AnimCheckName, point: string, frame: number, worst: number, message: string) => {
    const key = `${state}\u0000${check}\u0000${point}`;
    const was = found.get(key);
    if (!was) found.set(key, { check, point, frame, frames: 1, worst, message, state });
    else Object.assign(was, { frames: was.frames + 1, worst: Math.max(was.worst, worst) });
  };
  for (const state of Object.keys(rig.states)) {
    for (const facing of STATE_MATRIX.facings) {
      const run = driveRig(rig, state, facing, 1 / 60);
      const where = `${rig.id}, ${state} facing ${facing}`;
      frames += run.world.length;
      const first = bones.map(([a, b, , length]) => length ?? run.world[0][a].distanceTo(run.world[0][b]));
      run.world.forEach((points, i) => {
        points.forEach((p, k) => {
          if (![p.x, p.y, p.z].every(Number.isFinite)) add(state, 'finite', rig.names[k], i, NaN, `${where}: frame ${i}: ${rig.names[k]} is not a finite point`); // prettier-ignore
          else if (p.y < floor - tolerance) add(state, 'floor', rig.names[k], i, floor - p.y, `${where}: frame ${i}: ${rig.names[k]} is ${m(floor - p.y)} m below the floor`); // prettier-ignore
        });
        bones.forEach(([a, b, name], j) => {
          const off = Math.abs(points[a].distanceTo(points[b]) - first[j]);
          if (off > tolerance) add(state, 'length', name, i, off, `${where}: frame ${i}: the bone ${name} is ${m(off)} m off its length`); // prettier-ignore
        });
      });
      if (hashRigRun(driveRig(rig, state, facing, 1 / 60)) !== hashRigRun(run)) {
        add(state, 'hash', 'run', 0, 1, `${where}: running it again gave other points; look for module state`);
      }
      const local = (r: RigRun) => r.world.map((points, i) => points.map((p) => p.clone().sub(r.positions[i])));
      const drift = rateDrift(local(run), local(driveRig(rig, state, facing, 1 / 120)));
      if (drift.worst > STATE_MATRIX.rate) {
        add(state, 'rate', rig.names[drift.point], drift.frame, drift.worst, `${where}: frame ${drift.frame}: ${rig.names[drift.point]} is ${m(drift.worst)} m from where half steps put it (over ${STATE_MATRIX.rate} m); scale each step's change by dt`); // prettier-ignore
      }
    }
  }
  const problems = [...found.values()];
  return { ok: problems.length === 0, frames, problems };
}
