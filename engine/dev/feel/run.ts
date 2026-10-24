/**
 * @file Running a feel course (PLAN.md WP 13.4): `runCourse(course)` plays the course's inputs in a session of its own,
 * as a replay plays (engine/sim/replay.ts: setting values, dev actions, then intents, at each change-point), samples
 * the first player actor after every step, and judges each measure (engine/dev/feel/course.ts) against its reference
 * and tolerance. A course with animation measures, or a first-person camera, poses the player's animator every step
 * (engine/dev/feel/anim.ts: off the shooter model the eyes are where that camera stands; on it they stand at its eye
 * height), and first person's arms against each frame's camera (engine/gfx/viewmodel/rig.ts, an arms rig per camera
 * measure, which its `cameraLost` and `cameraClip` read); each camera measure steps its own camera rig from its first frame, so a dev action that
 * moves the player before it is never counted as the camera's jump, with what the player does, the step's look, the
 * view settings `cam.*` and the course's camera switches (`views`) (engine/dev/feel/camera.ts). `measure` and `judge`
 * are the arithmetic, so a test can check a measure on samples it makes.
 *
 * Invariants: the run is the sim's alone: the same course gives the same samples, results and final hash, which
 * measuring never changes (posing and cameras are presentation). A course whose scene has no player actor fails with
 * `DEV_COURSE_NO_PLAYER`, and an animation measure on a player without an animator with `DEV_COURSE_NO_ANIMATOR`.
 *
 * @example
 * // const result = runCourse(getCourse('course:playground-run'));
 * // result.pass; result.results[0]; // { name: 'run', value: 5.07, reference: 5.07, off: 0, pass: true, … }
 * @see engine/dev/feel/run.test.ts
 */
import { codeError, defineCodes } from '../../core/log';
import { registry as sharedRegistry, type Registry } from '../../core/registry';
import { applyIntents, NO_INTENTS, type IntentChanges, type Intents } from '../../input/intents';
import type { ActorComponents } from '../../sim/actors';
import type { EntityData } from '../../sim/state';
import { cameraPlayer, type EffectsFrame } from '../../gfx/cameras/effects';
import type { CameraPose } from '../../gfx/cameras/pose';
import { rigOptions } from '../../gfx/cameras/rig';
import { queryViewOf } from '../../sim/queryView';
import { createSession } from '../../sim/session';
import type { BodyView, MotionView } from '../../anim/locomotion/motion';
import { hullOf, rideOf } from '../../anim/traversal/contacts';
import { RUNG } from '../../gfx/stageRides';
import { armsLens } from '../../gfx/viewmodel/lens';
import { ArmsRig, vec3Of } from '../../gfx/viewmodel/rig';
import { createAnimTrack, type AnimTrack } from './anim';
import { CAMERA_CHECK, createCameraTrack, type ArmsFrame, type CameraMetrics, type CameraTrack } from './camera';
import { ANIM_METRICS, type Course, type Measure } from './course';

/** The codes this module raises, with their fixes. */
export const RUN_CODES = defineCodes('dev', {
  DEV_COURSE_NO_PLAYER: {
    template: 'the course {course} runs {scene}, which has no player actor to measure',
    fix: 'run a scene that spawns a player actor (spawnActor with player: true), or measure another course',
  },
  DEV_COURSE_NO_ANIMATOR: {
    template: 'the course {course} measures {measure}, but the player of {scene} has no animator to pose',
    fix: 'spawn the player with an animator (spawnActor with anim: { build }), or drop the animation measure',
  },
});

/** The first player actor's state after a step: what a move measure reads. */
export interface CourseSample {
  /** Where its feet are, m. */
  feet: readonly [number, number, number];
  /** Its velocity, m/s. */
  velocity: readonly [number, number, number];
  grounded: boolean;
  /** Where it faces (rad). */
  yaw: number;
  /** On the shooter model: its gait (`run`, `sprint`, `slide`…), its hull (`stand`, `crouch`) and whether it slides. */
  gait?: string;
  stance?: string;
  sliding?: boolean;
  /** On the shooter model: its mode (`ground`, `air`, `mantle`, `climb`, `zipline`, `ladder`, `skydive`) and its mantle's phase. */ // prettier-ignore
  mode?: string;
  mantle?: string;
  /** On the shooter model: its speed along a ride (m/s), its zipline catches since it last stood, its skydive's landing pose. */ // prettier-ignore
  rideSpeed?: number;
  catches?: number;
  landing?: boolean;
}

/** What a run recorded, which `measure` reads: the samples, the posed animation, each camera measure's track. */
export interface CourseRecord {
  /** Sample k is the state after step k; sample 0 the state before the first. */
  samples: CourseSample[];
  anim?: AnimTrack;
  /** Each camera measure's numbers, by its name. */
  cameras: Readonly<Record<string, CameraMetrics>>;
}

/** One measure's verdict. */
export interface MeasureResult {
  name: string;
  metric: Measure['metric'];
  value: number;
  reference: number;
  /** `value − reference`, in the metric's unit. */
  off: number;
  tolerance: Measure['tolerance'];
  pass: boolean;
  /** The WP that will make it pass, for a watched measure: it never fails the course. */
  watch?: string;
}

/** What `runCourse` gives: every measure's verdict, whether all but the watched passed, the final hash and the samples. */
export interface CourseResult {
  id: string;
  scene: string;
  steps: number;
  results: MeasureResult[];
  pass: boolean;
  hash: string;
  samples: CourseSample[];
}

/** A player actor as the query gives it. */
type Player = Partial<ActorComponents> & { id: number; actor: ActorComponents['actor'] };

/** The sample of `player`. */
function sampleOf({ actor, motion }: Player): CourseSample {
  const sample = { feet: [actor.x, actor.y, actor.z], velocity: [actor.vx, actor.vy, actor.vz], grounded: actor.grounded, yaw: actor.yaw } as const; // prettier-ignore
  if (!motion) return sample;
  const { gait, stance, sliding, mode, mantle, rideSpeed, catches, landing } = motion;
  return { ...sample, gait, stance, sliding, mode, mantle, rideSpeed, catches, landing };
}

/** Plays `course` in a session of its own and judges its measures (see the file comment). */
export function runCourse(course: Course, options: { registry?: Registry } = {}): CourseResult {
  const registry = options.registry ?? sharedRegistry;
  const session = createSession(course.scene, { seed: course.seed, settings: course.settings, registry });
  const world = session.world;
  const player = () => (world.query('actor') as unknown as Player[]).find((e) => e.actor.player);
  const first = player();
  if (!first) throw codeError('DEV_COURSE_NO_PLAYER', { course: course.id, scene: course.scene });
  const animated = course.measures.find((m) => (ANIM_METRICS as readonly string[]).includes(m.metric));
  if (animated && !first.animator) throw codeError('DEV_COURSE_NO_ANIMATOR', { course: course.id, measure: animated.name, scene: course.scene }); // prettier-ignore
  const firsts = [...course.measures.map((m) => m.camera ?? ''), ...course.views.map(([, code]) => code)];
  const arms = first.animator !== undefined && firsts.some((code) => code.startsWith('cam3=first'));
  const queries = queryViewOf(world);
  const anim = animated || arms ? createAnimTrack(course.id, queries) : undefined;
  const cameras = course.measures.filter((m) => m.camera !== undefined).map((m) => ({ m, track: undefined as CameraTrack | undefined, arms: undefined as ArmsRig | undefined })); // prettier-ignore
  const declared = (path: string) => registry.kinds().includes('setting') && registry.has('setting', path);
  const setting = (path: string) => (declared(path) ? session.settings.get(path) : undefined);
  const rig = rigOptions(setting);
  const fov = armsLens(setting('cam.armsFov'));
  let [at, intents]: [number, Intents] = [0, NO_INTENTS];
  const record = (k: number) => {
    const e = player()!;
    const sample = sampleOf(e);
    const look = intents.look ? { yaw: intents.look[0], pitch: intents.look[1], aiming: (intents.b ?? []).includes('aim') } : null; // prettier-ignore
    const traverse = { ride: e.motion && e.motion.ride >= 0 ? rideOf(world.get(e.motion.ride) as Record<string, unknown> | undefined) : null, hull: hullOf(e.actor.character, RUNG), look }; // prettier-ignore
    if (anim && e.animator) anim.frame(e.id, e.animator, sample.feet, sample.yaw, world.dt, e.motion as MotionView | undefined, e.actor as unknown as BodyView, traverse); // prettier-ignore
    const doing = cameras.length ? cameraPlayer(e as unknown as EntityData, (intents.b ?? []).includes('aim')) : null;
    const [x, y, z] = sample.feet;
    const eye = doing?.eye !== undefined ? ([x, y + doing.eye, z] as const) : anim?.eye(k);
    for (const c of cameras) {
      if (k < c.m.from || k > (c.m.to ?? course.steps)) continue;
      if (c.track) for (const [step, code] of course.views) if (step === k) c.track.set(code);
      c.track ??= createCameraTrack(c.m.camera!, rig);
      /** First person's arms against this camera's pose, posed by its own arms rig (see the file comment). */
      const posed = (pose: CameraPose, effects: EffectsFrame | null): ArmsFrame | null => {
        const input = anim?.armsInput({ player: doing, effects, aspect: CAMERA_CHECK.aspect, fov });
        if (!input || !e.animator) return null;
        c.arms ??= new ArmsRig(e.animator.build);
        c.arms.update(pose, input, world.dt);
        return { hands: c.arms.hands.map(vec3Of), points: c.arms.points(), fov };
      };
      c.track.frame(sample.feet, { queries, dt: world.dt, player: doing, look: intents.look, arms: posed, ...(eye ? { eye } : {}) }); // prettier-ignore
    }
    return sample;
  };
  const samples = [record(0)];
  for (let k = 0; k < course.steps; k++) {
    let change: IntentChanges = {};
    for (; at < course.inputs.length && course.inputs[at][0] === k; at++) {
      const { set, dev, args, ...keys } = course.inputs[at][1];
      for (const [path, value] of Object.entries(set ?? {})) session.set(path, value);
      if (dev !== undefined) session.act(dev, args);
      change = { ...change, ...keys };
    }
    intents = applyIntents(intents, change, `the course ${course.id}'s inputs at step ${k}`);
    session.step(intents);
    samples.push(record(k + 1));
  }
  const tracks = Object.fromEntries(cameras.map((c) => [c.m.name, c.track?.metrics() ?? { jump: 0, turn: 0, inside: 0, lost: 0, clip: 0 }])); // prettier-ignore
  const run: CourseRecord = { samples, anim, cameras: tracks };
  const results = course.measures.map((m) => judge(m, measure(m, run, course.steps, world.dt), world.dt));
  const pass = results.every((r) => r.pass || r.watch !== undefined);
  return { id: course.id, scene: course.scene, steps: course.steps, results, pass, hash: world.hash(), samples };
}

/** Speed across the ground of a sample. */
const across = (s: CourseSample) => Math.hypot(s.velocity[0], s.velocity[2]);

/** Whether `s` meets a time measure's `until`. */
function reached(m: Measure, s: CourseSample): boolean {
  if (m.until === 'grounded') return s.grounded;
  if (m.until === 'airborne') return !s.grounded;
  if (m.until === 'crouched' || m.until === 'standing') return s.stance === (m.until === 'crouched' ? 'crouch' : 'stand'); // prettier-ignore
  if (m.until === 'sliding' || m.until === 'stopsSliding') return s.sliding === (m.until === 'sliding');
  if (m.until === 'mantling' || m.until === 'climbing') return s.mode === (m.until === 'mantling' ? 'mantle' : 'climb');
  if (m.until === 'grabbing' || m.until === 'hanging' || m.until === 'pulling') return s.mantle === { grabbing: 'grab', hanging: 'hang', pulling: 'pull' }[m.until]; // prettier-ignore
  if (m.until === 'riding' || m.until === 'onLadder' || m.until === 'skydiving') return s.mode === { riding: 'zipline', onLadder: 'ladder', skydiving: 'skydive' }[m.until]; // prettier-ignore
  if (m.until === 'landingPose') return s.mode === 'skydive' && s.landing === true;
  return m.until === 'speedAbove' ? across(s) > m.value! : across(s) < m.value!;
}

/** The value of `m` on what a run of `steps` steps at `dt` recorded (see course.ts for each metric). */
export function measure(m: Measure, run: CourseRecord, steps: number, dt: number): number {
  const { samples } = run;
  const to = Math.min(m.to ?? steps, samples.length - 1);
  const span = samples.slice(m.from, to + 1);
  const start = samples[m.from];
  const camera = run.cameras[m.name];
  switch (m.metric) {
    case 'speed':
      return span.reduce((sum, s) => sum + across(s), 0) / span.length;
    case 'topSpeed':
      return Math.max(...span.map(across));
    case 'speedGain':
      return across(samples[to]) - across(start);
    case 'velocityChange': {
      const [a, b] = [start.velocity, samples[to].velocity];
      return Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    case 'apex':
      return Math.max(...span.map((s) => s.feet[1])) - start.feet[1];
    case 'top':
      return Math.max(...span.map((s) => s.feet[1]));
    case 'height':
      return samples[to].feet[1];
    case 'heightAt': {
      const hit = span.find((s) => reached(m, s));
      return hit ? hit.feet[1] : Infinity;
    }
    case 'distance':
      return Math.hypot(samples[to].feet[0] - start.feet[0], samples[to].feet[2] - start.feet[2]);
    case 'grounded':
      return samples[to].grounded ? 1 : 0;
    case 'time': {
      const hit = span.findIndex((s) => reached(m, s));
      return hit < 0 ? Infinity : hit * dt;
    }
    case 'duration': {
      const hit = span.findIndex((s) => reached(m, s));
      const end = hit < 0 ? -1 : span.findIndex((s, k) => k > hit && !reached(m, s));
      return hit < 0 ? 0 : ((end < 0 ? span.length : end) - hit) * dt;
    }
    case 'topRise':
      return Math.max(...span.map((s) => s.velocity[1]));
    case 'topFall':
      return Math.max(...span.map((s) => -s.velocity[1]));
    case 'rideSpeed':
      return samples[to].rideSpeed ?? 0;
    case 'rideGain':
      return (samples[to].rideSpeed ?? 0) - (start.rideSpeed ?? 0);
    case 'catches':
      return Math.max(...span.map((s) => s.catches ?? 0));
    case 'standHeight':
      return Math.max(...span.filter((s) => s.grounded).map((s) => s.feet[1]), -Infinity);
    case 'footSlide':
      return run.anim!.footSlide(m.from, to);
    case 'pop':
      return run.anim!.pop(m.from, to);
    case 'handGap':
      return run.anim!.handGap(m.point!, m.from, to);
    case 'handContact': {
      const { gap, held } = run.anim!.handContact(m.from, to);
      return m.holds === true && held === 0 ? Number.MAX_VALUE : gap; // a traversal never posed: as far off as JSON writes
    }
    case 'muzzle': {
      const { angle, aimed } = run.anim!.muzzle(m.from, to);
      return aimed === 0 ? Number.MAX_VALUE : angle; // never aimed: nothing measured, so it fails
    }
    case 'cameraJump':
      return camera.jump;
    case 'cameraTurn':
      return camera.turn;
    case 'cameraInside':
      return camera.inside;
    case 'cameraLost':
      return camera.lost;
    case 'cameraClip':
      return camera.clip;
  }
}

/** `m`'s verdict on `value`: within its tolerance (any one it names) of its reference. */
export function judge(m: Measure, value: number, dt: number): MeasureResult {
  const off = value - m.reference;
  const { share, abs, ticks } = m.tolerance;
  const pass =
    Number.isFinite(value) &&
    ((share !== undefined && Math.abs(off) <= share * Math.abs(m.reference) + 1e-9) ||
      (abs !== undefined && Math.abs(off) <= abs + 1e-9) ||
      (ticks !== undefined && Math.abs(off) <= ticks * dt + 1e-9));
  const result = { name: m.name, metric: m.metric, value, reference: m.reference, off, tolerance: m.tolerance, pass };
  return m.watch === undefined ? result : { ...result, watch: m.watch };
}
