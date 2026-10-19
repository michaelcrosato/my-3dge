/**
 * @file Feel courses (PLAN.md WP 13.4, docs/PLAYGROUND.md §9.1): the registry kind `course`. A course is data: a
 * scripted run of a scene, as a replay holds one (its scene, settings, seed, steps and change-point inputs, dev actions
 * such as a scene's `place` among them, engine/sim/replay.ts), and the numbers to measure on the run, each against its
 * reference and tolerance (`measures`). engine/dev/feel/run.ts runs one headless and judges it; `node x feel <lab>
 * --course <name|all>` (tools/cmd/feel.ts) runs a lab's.
 *
 * A measure reads the first player actor, once per step (after it): `from` and `to` are steps (sample k is the state
 * after step k, sample 0 the state before the first), `to` the course's last by default. The metrics:
 * - the move (`MOVE_METRICS` says what each reads): its speeds, heights, distances and times, and its rides';
 * - its animation, posed as the page poses it (engine/dev/feel/anim.ts): `footSlide`, the most a sole slides in one
 *   contact, and `pop`, the farthest a point jumps in one step against its neighbours (the anim QA's rules); `handGap`,
 *   the closest either hand comes to `point`;
 * - a camera's (engine/dev/feel/camera.ts), the code in `camera`: `cameraJump`, the most one frame moves it beyond the
 *   player's own move, and `cameraTurn`, the most it turns (rad); `cameraInside`, the frames it stands inside the
 *   level; `cameraLost`, the frames the player is out of its view.
 * A tolerance is a share of the reference (`share`), an amount (`abs`, in the metric's unit) or whole steps (`ticks`,
 * for times); a measure passes within any one it names. A bound is a reference of 0 with the bound as `abs`: the
 * camera's 0.3 m. docs/PLAYGROUND.md §3.2's are the playground's: speeds ±2%, accelerations ±5%, times ±1 tick,
 * heights and distances ±2 cm; §4's and §5.1's give the bounds. A measure that `watch`es names the WP that will make
 * it pass: its number is reported against its bound, never judged, so a course passes before that WP lands and its
 * report tracks the number on the way.
 *
 * Invariants: data only, checked when defined (each metric's own fields, `from` ≤ `to` ≤ `steps`, a tolerance, names
 * unique, change-points in step order within the run); a course never touches a running world: each runs in a
 * session of its own.
 *
 * @example
 * defineCourse('course:test-run', { scene: 'playground:gym', steps: 120, inputs: [[0, { move: [0, 1] }]], measures: [{ name: 'run', metric: 'speed', from: 60, reference: 5.07, tolerance: { share: 0.02 } }] }); // prettier-ignore
 * getCourse('course:test-run').measures[0].from; // 60
 * @see engine/dev/feel/course.test.ts
 */
import { registry as sharedRegistry, type Entry, type Registry } from '../../core/registry';
import { defineSchema } from '../../core/schema';
import { readCameraCode } from '../../gfx/cameras/place';
import type { InputEntry } from '../../sim/replay';

/**
 * The metrics of the move, read off the player's samples: `speed`, the mean speed across the ground from `from` to
 * `to`, and `topSpeed`, the highest; `speedGain`, the speed across the ground at `to` less that at `from`, and
 * `velocityChange`, how far the velocity across the ground moved between them (a lurch's, m/s); `apex`, how far the
 * feet rise above where they were at `from`; `height`, the feet's height at `to`; `distance`, across the ground from
 * the feet at `from` to the feet at `to`; `time`, seconds from `from` to the first sample that meets `until`
 * (`speedAbove` or `speedBelow` `value`, `grounded` or `airborne`; on the shooter model `crouched` or `standing`, its
 * hull, `sliding` or `stopsSliding`, `mantling`, `grabbing`, `hanging`, `pulling` or `climbing`, and `riding` a
 * zipline, `onLadder`, `skydiving` or in its `landingPose`), and `duration`, how long from the first sample that meets
 * it it goes on meeting it (0 if none does); `top`, the highest its feet go; `heightAt`, the feet's height at the
 * first sample that meets `until`; `topRise` and `topFall`, the fastest it rises and falls (m/s); `standHeight`, the
 * highest its feet stand on the ground (what it mantled or climbed onto); `grounded`, 1 when it stands at `to`;
 * `rideSpeed`, its speed along a zipline or up a ladder at `to`, and `rideGain`, that at `to` less that at `from`;
 * `catches`, the most zipline catches it made since it last stood.
 */
export const MOVE_METRICS = ['speed', 'topSpeed', 'speedGain', 'velocityChange', 'apex', 'top', 'height', 'heightAt', 'distance', 'time', 'duration', 'topRise', 'topFall', 'standHeight', 'grounded', 'rideSpeed', 'rideGain', 'catches'] as const; // prettier-ignore

/** The metrics of the player's animation, posed as the page poses it. */
export const ANIM_METRICS = ['footSlide', 'pop', 'handGap'] as const;

/** The metrics of a camera following the player. */
export const CAMERA_METRICS = ['cameraJump', 'cameraTurn', 'cameraInside', 'cameraLost'] as const;

/** Everything a measure reads off the run (see the file comment). */
export const METRICS = [...MOVE_METRICS, ...ANIM_METRICS, ...CAMERA_METRICS] as const;

/** A measure's metric. */
export type Metric = (typeof METRICS)[number];

/** When a `time` measure stops: the first sample at which this holds. */
export const UNTILS = ['speedAbove', 'speedBelow', 'grounded', 'airborne', 'crouched', 'standing', 'sliding', 'stopsSliding', 'mantling', 'grabbing', 'hanging', 'pulling', 'climbing', 'riding', 'onLadder', 'skydiving', 'landingPose'] as const; // prettier-ignore

/** One number a course measures (see the file comment). */
export const MEASURE_FIELDS = defineSchema({
  name: { type: 'string', required: true, description: 'What it measures, as the report names it: "sprint".' },
  metric: { type: 'string', enum: METRICS, required: true, description: 'What it reads off the run.' },
  from: { type: 'integer', default: 1, minimum: 0, description: 'The first sample it reads (0: before the first step).' }, // prettier-ignore
  to: { type: 'integer', minimum: 0, description: 'The last sample it reads; absent: the course’s last.' },
  until: { type: 'string', enum: UNTILS, description: 'For `time`: the sample that ends it; for `duration`: the state it times; for `heightAt`: the state it waits for.' }, // prettier-ignore
  value: { type: 'number', description: 'For `time` with `speedAbove` or `speedBelow`: the speed, m/s.' },
  camera: { type: 'string', description: 'For a camera metric: the camera’s code (`cam3=chase`, `cam=iso`).' },
  point: { type: 'array', items: { type: 'number' }, description: 'For `handGap`: the point, world [x, y, z], m.' },
  reference: { type: 'number', required: true, description: 'What it should be (docs/PLAYGROUND.md §3.2), or 0 for a bound.' }, // prettier-ignore
  watch: { type: 'string', description: 'Reported against its bound but never judged until the WP it names makes it pass: "WP 13.10".' }, // prettier-ignore
  tolerance: {
    type: 'object',
    default: {},
    description: 'How far off it may be: a share of the reference, an amount or whole steps (any one passes).',
    properties: {
      share: { type: 'number', minimum: 0, description: 'A share of the reference: 0.02 is ±2%.' },
      abs: { type: 'number', minimum: 0, description: 'An amount, in the metric’s unit.' },
      ticks: { type: 'integer', minimum: 0, description: 'Whole steps, for `time`.' },
    },
  },
});

/** A course's fields: what `defineCourse` takes (see the file comment). */
export const COURSE_FIELDS = defineSchema({
  description: { type: 'string', default: '', description: 'What it drives over, and what it shows.' },
  scene: { type: 'string', required: true, description: 'The scene it runs (a scene id).' },
  settings: { type: 'object', default: {}, description: 'Setting values over the scene’s at the start, path → value.' },
  seed: { type: 'integer', default: 1, minimum: 0, description: 'The run’s seed.' },
  steps: { type: 'integer', required: true, minimum: 1, description: 'How many sim steps it runs.' },
  inputs: {
    type: 'array',
    default: [],
    description: 'Change-points [step, change], as a replay’s (engine/sim/replay.ts): after that many steps, before the next.', // prettier-ignore
  },
  views: {
    type: 'array',
    default: [],
    description: 'Camera switches [step, code] for its camera measures, after that many steps, blended as the page’s live switches (WP 13.8).', // prettier-ignore
  },
  measures: {
    type: 'array',
    required: true,
    items: { type: 'object', properties: MEASURE_FIELDS, description: 'One number it measures.' },
    description: 'The numbers it measures, each against its reference and tolerance.',
  },
});

/** A measure, as a course holds it. */
export interface Measure {
  readonly name: string;
  readonly metric: Metric;
  readonly from: number;
  readonly to?: number;
  readonly until?: (typeof UNTILS)[number];
  readonly value?: number;
  readonly camera?: string;
  readonly point?: readonly [number, number, number];
  readonly reference: number;
  readonly tolerance: { readonly share?: number; readonly abs?: number; readonly ticks?: number };
  /** The WP that will make it pass; until then it is reported, never judged. */
  readonly watch?: string;
}

/** A course, as the registry holds it. */
export type Course = Omit<Entry<typeof COURSE_FIELDS>, 'inputs' | 'measures' | 'views'> & { readonly inputs: readonly InputEntry[]; readonly views: readonly (readonly [number, string])[]; readonly measures: readonly Measure[] }; // prettier-ignore

/** The problems of one measure beyond its fields: its steps, its metric's own fields and its tolerance. */
function measureProblems(m: Measure, steps: number, at: string): string[] {
  const problems: string[] = [];
  const to = m.to ?? steps;
  if (m.from > to) problems.push(`${at}: from ${m.from} is after to ${to}`);
  if (to > steps) problems.push(`${at}: to ${to} is past the course's ${steps} steps`);
  if (m.metric === 'time' && !m.until) problems.push(`${at}: a time measure names when it ends (until)`);
  if (m.metric === 'duration' && !m.until) problems.push(`${at}: a duration measure names the state it times (until)`);
  if (m.metric === 'heightAt' && !m.until) problems.push(`${at}: a heightAt measure names the state it waits for (until)`); // prettier-ignore
  if (m.until?.startsWith('speed') && m.value === undefined) problems.push(`${at}: ${m.until} needs a value (m/s)`);
  const camera = (CAMERA_METRICS as readonly string[]).includes(m.metric);
  if (camera !== (m.camera !== undefined)) problems.push(camera ? `${at}: ${m.metric} names its camera (camera: 'cam3=chase')` : `${at}: only a camera metric names a camera`); // prettier-ignore
  const point = m.point;
  if ((m.metric === 'handGap') !== (point !== undefined)) problems.push(m.metric === 'handGap' ? `${at}: handGap names its point ([x, y, z])` : `${at}: only handGap names a point`); // prettier-ignore
  if (point && (point.length !== 3 || !point.every(Number.isFinite))) problems.push(`${at}: point is [x, y, z] in metres`); // prettier-ignore
  const { share, abs, ticks } = m.tolerance;
  if (share === undefined && abs === undefined && ticks === undefined) problems.push(`${at}: give a tolerance (share, abs or ticks)`); // prettier-ignore
  return problems;
}

/** The problems of a parsed course beyond its fields: each measure's, and two measures of one name. */
function courseProblems(course: Course): string[] {
  const problems = course.measures.flatMap((m, i) => measureProblems(m, course.steps, `measures[${i}] (${m.name})`));
  const steps = course.inputs.map((entry) => (Array.isArray(entry) ? entry[0] : NaN));
  const odd = steps.findIndex((step) => !Number.isInteger(step) || step < 0 || step >= course.steps);
  if (odd >= 0) problems.push(`inputs[${odd}] is not [step, change] with a step from 0 to ${course.steps - 1}`);
  const late = steps.findIndex((step, i) => i > 0 && step < steps[i - 1]);
  if (late > 0) problems.push(`inputs[${late}] at step ${steps[late]} comes after step ${steps[late - 1]}: give change-points in step order`); // prettier-ignore
  const names = course.measures.map((m) => m.name);
  for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) problems.push(`two measures are named ${JSON.stringify(name)}`); // prettier-ignore
  course.views.forEach((view, i) => {
    const [step, code] = Array.isArray(view) ? view : [NaN, undefined];
    if (!Number.isInteger(step) || step < 0 || step > course.steps || typeof code !== 'string') return problems.push(`views[${i}] is not [step, camera code] with a step from 0 to ${course.steps}`); // prettier-ignore
    try {
      readCameraCode(code);
    } catch (error) {
      problems.push(`views[${i}]: ${(error as Error).message}`);
    }
  });
  return problems;
}

/** Declares the kind `course` on `registry`, once. */
export function courseKind(registry: Registry = sharedRegistry): void {
  if (registry.kinds().includes('course')) return;
  registry.defineKind('course', {
    description:
      'A feel course: a scripted run of a scene (a replay’s inputs) and the numbers to measure on it, each against its reference and tolerance (node x feel).', // prettier-ignore
    fields: COURSE_FIELDS,
    check: (entry) => courseProblems(entry as Course),
    defineWith: "defineCourse('course:<name>', { scene, steps, inputs: [[0, { move: [0, 1] }]], measures: [{ name, metric, reference, tolerance: { share: 0.02 } }] })", // prettier-ignore
  });
}

/** Registers a course (on the shared registry by default). Throws `CORE_BAD_SPEC` naming each problem. */
export function defineCourse(id: string, spec: Record<string, unknown>, registry: Registry = sharedRegistry): Course {
  courseKind(registry);
  return registry.def('course', id, spec) as Course;
}

/** The course `id`. Throws `CORE_NO_ENTRY` naming the closest ids. */
export function getCourse(id: string, registry: Registry = sharedRegistry): Course {
  courseKind(registry);
  return registry.get('course', id) as Course;
}

/** Every course, sorted by id. */
export function listCourses(registry: Registry = sharedRegistry): Course[] {
  courseKind(registry);
  return registry.list('course') as Course[];
}
