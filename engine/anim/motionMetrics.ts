/**
 * @file Motion metrics on a track of points (PLAN.md §8.6, WP 6.6; WP 13.4 moved them here from tools/qa/anim/metrics.ts,
 * so the anim QA family and the feel kit, engine/dev/feel/anim.ts, read motion by one set of rules): a `Track` holds
 * points per step, world and measured from the body, and each metric returns the worst case (`Found`, larger is worse)
 * and the sentence naming where it happened. Thresholds are `ANIM_QA`'s, for a body of `size` 1; lengths scale with
 * the size.
 * - `pops` (metres in a step): a point, measured from the body's position, jumps more than `ANIM_QA.pop.min` in one
 *   step and more than `ratio` times the steps either side (a fast, steady sweep is motion, not a pop); `worstPop`
 *   is the largest such jump of any size.
 * - `footSlide` (metres): a sole within `ANIM_QA.slide.contact` of the floor in consecutive steps moves over the
 *   ground (a treadmill's ground moves too) more than `limit` in one contact; `worstSlide` is the most of any size.
 *
 * Invariants: pure functions of the track; nothing here reads a clock, a stream or the sim.
 *
 * Carried from `my-3d2dge:tools/ed-sheet.mjs:100-131`: the pops relative to the neighbouring steps (9 units a step and
 * 2.5 times the neighbours, the neighbours counted as at least 0.5 units, here in metres), the foot slide (there over
 * the idle hold, here per contact in every state).
 *
 * @example
 * import { Vector3 } from '../core/math';
 * const still = motionTrack({ where: 'test', names: ['p'], world: [[new Vector3()], [new Vector3()]], positions: [new Vector3(), new Vector3()] }); // prettier-ignore
 * pops(still); // undefined: nothing moved
 * @see engine/anim/motionMetrics.test.ts
 * @see tools/qa/anim.test.ts
 */
import { Vector3 } from '../core/math';
import { SIM_DT } from '../core/time';

/** The thresholds, in metres and radians for a body of `size` 1. */
export const ANIM_QA = {
  pop: { min: 9 / 16, ratio: 2.5, floor: 0.5 / 16 },
  slide: { contact: 0.005, limit: 0.05 },
  closure: 0.02,
  twist: { fold: (140 * Math.PI) / 180, jump: (120 * Math.PI) / 180 },
  hinge: 0.02,
  angle: 3 * Math.PI,
} as const;
/** One run as the metrics read it: points per step, world and measured from the body, and what they need besides. */
export interface Track {
  /** Where it ran, for messages: the build, the state, the facing. */
  where: string;
  /** The body's scale: thresholds grow with it. */
  size: number;
  dt: number;
  names: readonly string[];
  world: Vector3[][];
  /** The points measured from the body's position. */
  local: Vector3[][];
  /** The indices of the soles. */
  feet: readonly number[];
  /** The ground's velocity under the body while it holds the state, and the steps that hold it. */
  treadmill: Vector3;
  held: readonly [number, number];
}

/** What a metric found: the worst value and its sentence. */
export type Found = { value: number; message: string } | undefined;

const ZERO = new Vector3();
/** A metre (or radian) value for messages: up to 4 decimals. */
export const m = (value: number): string => String(Math.round(value * 1e4) / 1e4);
/** The worse of two findings. */
export const worse = (a: Found, b: Found): Found => (!a || (b && b.value > a.value) ? b : a);

/** A track from its points (world metres) and the body's position at each step. */
export function motionTrack(
  spec: Pick<Track, 'where' | 'names' | 'world'> & Partial<Track> & { positions: readonly Vector3[] },
): Track {
  const local = spec.world.map((points, i) => points.map((p) => p.clone().sub(spec.positions[i])));
  return { size: 1, dt: SIM_DT, feet: [], treadmill: ZERO, held: [0, 0], local, ...spec };
}

/**
 * The largest jump of a point in one step among those more than `ANIM_QA.pop.ratio` times the steps either side, of
 * any size: what `pops` judges against its minimum, and the feel kit's `pop` (engine/dev/feel/anim.ts).
 */
export function worstPop(t: Track): Found {
  const { ratio, floor } = ANIM_QA.pop;
  let best: { value: number; k: number; i: number; d: number[] } | undefined;
  t.names.forEach((_, k) => {
    const d = t.local.slice(1).map((points, i) => points[k].distanceTo(t.local[i][k]));
    for (let i = 1; i < d.length - 1; i++) {
      if (d[i] <= ratio * Math.max(d[i - 1], d[i + 1], floor * t.size)) continue;
      if (!best || d[i] > best.value) best = { value: d[i], k, i, d };
    }
  });
  if (!best) return undefined;
  const { value, k, i, d } = best;
  const message = `${t.where}: ${t.names[k]} jumps ${m(value)} m in one step at frame ${i + 1} (${m(d[i - 1])} and ${m(d[i + 1])} m either side); ease into the pose`; // prettier-ignore
  return { value, message };
}

/** Pops: a point that jumps in one step while the steps either side are much shorter (ed-sheet.mjs:122-125). */
export function pops(t: Track): Found {
  const found = worstPop(t);
  return found && found.value > ANIM_QA.pop.min * t.size ? found : undefined;
}

/**
 * The most a sole within `ANIM_QA.slide.contact` of the floor slides over the ground in one contact, of any size: what
 * `footSlide` judges against its limit, and the feel kit's `footSlide`.
 */
export function worstSlide(t: Track): Found {
  const { contact } = ANIM_QA.slide;
  let best: { value: number; k: number; i: number } | undefined;
  for (const k of t.feet) {
    let slide = -1;
    for (let i = 1; i < t.world.length; i++) {
      const [a, b] = [t.world[i - 1][k], t.world[i][k]];
      if (Math.max(a.y, b.y) > contact * t.size) {
        slide = -1;
        continue;
      }
      const ground = i >= t.held[0] && i < t.held[1] ? t.treadmill : ZERO;
      slide = Math.max(0, slide) + Math.hypot(b.x - a.x - ground.x * t.dt, b.z - a.z - ground.z * t.dt);
      if (!best || slide > best.value) best = { value: slide, k, i };
    }
  }
  if (!best) return undefined;
  const message = `${t.where}: ${t.names[best.k]} slides ${m(best.value)} m on the floor by frame ${best.i} in one contact; plant it, or lift it to move it`; // prettier-ignore
  return { value: best.value, message };
}

/** Foot slide: a sole on the floor moving over the ground, the most in one contact. */
export function footSlide(t: Track): Found {
  const found = worstSlide(t);
  return found && found.value > ANIM_QA.slide.limit * t.size ? found : undefined;
}
