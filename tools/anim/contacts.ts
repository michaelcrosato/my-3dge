/**
 * @file Contacts and events, detected at import (PLAN.md §10.2, WP 8.8; ADR-0010 amendment 7): when each foot and hand
 * holds the ground or a surface (a clip's `contacts`), and the moments gameplay listens for (its `events`: `step`,
 * `land`, `hit`), read from a capture's 36 body points. retarget.ts plants the hands in the contact intervals; the
 * playground's mantles, climbs, ladders and ziplines wait for them (ADR-0025).
 *
 * The points are watched in the ground's frame: the capture's own, plus the root's travel, less the treadmill an
 * in-place loop runs on (the velocity most of its hands' and feet's frames share: the rungs of an in-place ladder
 * sinking at 0.4 m/s, the floor of an in-place walk sliding back). Then:
 * - **a foot** holds when its sole (the lowest of its heel, ball and toe, each over its rest height) is within
 *   `FOOT_CLEAR` of the floor, above or below, or when its ball holds still (`STILL`, for `HOLD`) while the pelvis
 *   moves `CARRY` past it: a rung, a ledge;
 * - **a hand** holds when its knuckle holds still while the pelvis moves `CARRY` past it (a rung, a ledge, a wall), or
 *   holds still within `HAND_FLOOR` of the floor (a crawl, a push-up, a three-point landing) or above the head (a
 *   hang). Any other hand still while the body is still too (an idle's) reads as no contact;
 * - **events**: `step` where a foot's contact begins after the clip's first frame; `land` where one begins after
 *   `AIRBORNE` with nothing held (a jump's flight, not a run's); `hit`, in a clip tagged `attack` or `kick`, where the
 *   strike lands
 *   (engine/anim/clip/library.ts `strikeTime`, the runtime's own rule), on the side of the end that reaches farthest.
 *
 * Invariants: times are seconds to the millisecond; intervals in time order per part, gaps of one frame closed and
 * blips of one frame dropped; a loop's contact across its seam is two intervals, one at each end.
 *
 * @example
 * import { clipOf, REST, standing } from '../../tests/unit/anim/clip-fixtures';
 * import { samplePose } from '../../engine/anim/clip/readable';
 * const clip = clipOf([standing(0), standing(1)], { dur: 1 });
 * const data = new Float32Array(31 * 108);
 * for (let f = 0; f < 31; f++) data.set(samplePose(REST, clip, f / 30), f * 108);
 * const capture = { name: 'Stand', n: 31, dur: 1, loop: false, fps: 30, data, move: null };
 * detectContacts(capture, REST, clip).contacts; // both feet on the floor from 0 to 1 s, no hands
 * detectContacts(capture, REST, clip).events; // []: nothing begins after the first frame
 * @see tools/anim/contacts.test.ts
 */
import type { Capture } from '../../engine/anim/clip/encode';
import { strikeTime } from '../../engine/anim/clip/library';
import {
  decodePose,
  keyAt,
  POINT_INDEX,
  type Clip,
  type ClipContact,
  type ClipEvent,
} from '../../engine/anim/clip/readable';
import type { RestBody } from '../../engine/anim/clip/validate';

/** How far above the floor (mm) a foot's sole may be and still stand on it. */
export const FOOT_CLEAR = 30;
/** How far above the floor (mm) a hand's knuckle may be and still lie on it. */
export const HAND_FLOOR = 60;
/** How slowly (mm/s) a held point moves in the ground's frame. */
export const STILL = 200;
/** How long (s) a hand or a raised foot must hold still to count. */
export const HOLD = 0.15;
/** How far (mm) the pelvis must move past a held hand or raised foot over its hold. */
export const CARRY = 50;
/** How close (mm/s) a frame's velocity must come to the treadmill's to count toward it. */
const MATCH = 120;
/** A treadmill slower than this (mm/s) is no treadmill. */
const DRIFT = 100;
/** How long (s) nothing may be held before a foot's contact is a landing: a jump's, not a run's flight. */
export const AIRBORNE = 0.25;
const DG = Math.PI / 180;

type V = [number, number, number];
type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const ms = (t: number) => Math.round(t * 1000) / 1000;

/** The capture's point `name` at frame `f` (mm), the root's travel added. */
function travelled(cap: Capture, f: number, name: string): V {
  const i = (f * 36 + POINT_INDEX[name]) * 3;
  const m = cap.move;
  return [cap.data[i] + (m ? m[f * 2] : 0), cap.data[i + 1] + (m ? m[f * 2 + 1] : 0), cap.data[i + 2]];
}

/**
 * Whether side `s`'s sole stands on the floor at frame `f`: the lowest of its heel, ball and toe, each over its rest
 * height, within `FOOT_CLEAR` of it, above or below (a foot far below it hangs: a ledge hang's).
 */
function onFloor(cap: Capture, R: RestBody, f: number, s: Side): boolean {
  const ballZ = R.ankleZ - R.ab * Math.sin(R.abPitch * DG);
  const toeZ = ballZ - R.bt * Math.sin(R.btPitch * DG);
  const z = (name: string) => travelled(cap, f, name)[2];
  return Math.abs(Math.min(z(`ankle${s}`) - R.ankleZ, z(`ball${s}`) - ballZ, z(`toe${s}`) - toeZ)) < FOOT_CLEAR;
}

/** The middle value of `xs`. */
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * The ground's velocity under an in-place loop (mm/s; zero for any other clip): of the planted balls' median velocity
 * along the floor and the velocity most hand and foot frames share (a ladder's, a wall's), whichever more of the hand
 * and foot frames move with.
 */
export function treadmill(cap: Capture, R: RestBody): V {
  if (!cap.loop || cap.move || cap.n < 3) return [0, 0, 0];
  const velocity = (f: number, name: string): V => {
    const [a, b] = [travelled(cap, f - 1, name), travelled(cap, f + 1, name)];
    return [0, 1, 2].map((j) => ((b[j] - a[j]) * cap.fps) / 2) as V;
  };
  const inner = Array.from({ length: cap.n - 2 }, (_, i) => i + 1);
  const vs = ['ballL', 'ballR', 'knuckL', 'knuckR'].flatMap((name) => inner.map((f) => velocity(f, name)));
  const near = (c: V) => vs.filter((v) => Math.hypot(v[0] - c[0], v[1] - c[1], v[2] - c[2]) < Math.max(MATCH, 0.15 * Math.hypot(...c))); // prettier-ignore
  const candidates: V[] = [[0, 0, 0]];
  const planted = SIDES.flatMap((s) => inner.filter((f) => onFloor(cap, R, f, s)).map((f) => velocity(f, `ball${s}`)));
  if (planted.length) candidates.push([median(planted.map((v) => v[0])), median(planted.map((v) => v[1])), 0]);
  let shared: V[] = [];
  for (const c of vs) {
    const group = near(c);
    if (group.length > shared.length) shared = group;
  }
  candidates.push([0, 1, 2].map((j) => shared.reduce((sum, v) => sum + v[j], 0) / shared.length) as V);
  const best = candidates.reduce((a, b) => (near(b).length > near(a).length ? b : a));
  return Math.hypot(...best) < DRIFT ? [0, 0, 0] : best;
}

/** The frames' runs where `on` holds: `[first, last]` frame pairs, gaps of one frame closed, single frames dropped. */
function runs(on: boolean[]): [number, number][] {
  const filled = on.map((v, f) => v || (f > 0 && f < on.length - 1 && on[f - 1] && on[f + 1]));
  const out: [number, number][] = [];
  for (let f = 0; f < filled.length; f++) {
    if (!filled[f]) continue;
    const start = f;
    while (f + 1 < filled.length && filled[f + 1]) f++;
    if (f > start) out.push([start, f]);
  }
  return out;
}

/** Where `point` holds still in the ground's frame (under `STILL`) for at least `HOLD`: `[first, last]` frames. */
function holds(cap: Capture, at: (f: number, name: string) => V, point: string): [number, number][] {
  const n = cap.n;
  const speed = Array.from({ length: n }, (_, f) => {
    const [f0, f1] = [Math.max(0, f - 1), Math.min(n - 1, f + 1)];
    const [a, b] = [at(f0, point), at(f1, point)];
    return (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * cap.fps) / (f1 - f0);
  });
  return runs(speed.map((v) => v < STILL)).filter(([a, b]) => (b - a) / cap.fps >= HOLD);
}

/** The frames of `point`'s holds that the pelvis moves `CARRY` past (a rung climbed, a ledge pulled up to). */
function carried(cap: Capture, at: (f: number, name: string) => V, point: string): boolean[] {
  const out = new Array<boolean>(cap.n).fill(false);
  for (const [a, b] of holds(cap, at, point)) {
    const rel = (f: number) => at(f, 'pelvis').map((v, j) => v - at(f, point)[j]);
    const r0 = rel(a);
    let moved = 0;
    for (let f = a; f <= b; f++) moved = Math.max(moved, Math.hypot(...rel(f).map((v, j) => v - r0[j])));
    if (moved >= CARRY) out.fill(true, a, b + 1);
  }
  return out;
}

/** The frames of all `point`'s holds. */
function still(cap: Capture, at: (f: number, name: string) => V, point: string): boolean[] {
  const out = new Array<boolean>(cap.n).fill(false);
  for (const [a, b] of holds(cap, at, point)) out.fill(true, a, b + 1);
  return out;
}

/**
 * A capture's contacts and events (see the file comment), on its rest body `R`; `clip` is the capture fitted (its
 * strike is timed on what plays) and `tags` its catalog words.
 */
export function detectContacts(
  cap: Capture,
  R: RestBody,
  clip: Clip,
  tags: readonly string[] = [],
): { contacts: ClipContact[]; events: ClipEvent[] } {
  const ground = treadmill(cap, R);
  const at = (f: number, name: string): V => {
    const p = travelled(cap, f, name);
    const t = f / cap.fps;
    return [p[0] - ground[0] * t, p[1] - ground[1] * t, p[2] - ground[2] * t];
  };
  const frames = Array.from({ length: cap.n }, (_, f) => f);
  const held: Record<ClipContact['part'], boolean[]> = { footL: [], footR: [], handL: [], handR: [] };
  for (const s of SIDES) {
    const raised = carried(cap, at, `ball${s}`);
    held[`foot${s}`] = frames.map((f) => {
      return onFloor(cap, R, f, s) || raised[f];
    });
    const [gripped, resting] = [carried(cap, at, `knuck${s}`), still(cap, at, `knuck${s}`)];
    const low = (f: number) => Math.min(travelled(cap, f, `knuck${s}`)[2], travelled(cap, f, `fist${s}`)[2]);
    const overhead = (f: number) => travelled(cap, f, `knuck${s}`)[2] > travelled(cap, f, 'headTop')[2];
    held[`hand${s}`] = frames.map((f) => gripped[f] || (resting[f] && (low(f) < HAND_FLOOR || overhead(f))));
  }
  const contacts: ClipContact[] = [];
  const events: ClipEvent[] = [];
  const t = (f: number) => ms(Math.min(cap.dur, f / cap.fps));
  for (const part of ['footL', 'footR', 'handL', 'handR'] as const)
    for (const [a, b] of runs(held[part])) contacts.push({ part, from: t(a), to: t(b) });
  contacts.sort((x, y) => x.from - y.from || x.part.localeCompare(y.part));
  for (const c of contacts) {
    if (!c.part.startsWith('foot') || c.from === 0) continue;
    // how long nothing was held before it: from the last hold that ended before it began (else from the start)
    const before = contacts.filter((o) => o !== c && o.from < c.from).map((o) => Math.min(o.to, c.from));
    const air = c.from - (before.length ? Math.max(...before) : 0);
    events.push({ t: c.from, name: air >= AIRBORNE ? 'land' : 'step', side: c.part.slice(4) as Side });
  }
  if (tags.includes('attack') || tags.includes('kick')) {
    const hit = strikeTime(clip, R);
    const kick = tags.includes('kick');
    const points = decodePose(R, keyAt(clip, hit), new Float64Array(108));
    const reach = (s: Side) => points[POINT_INDEX[`${kick ? 'ankle' : 'fist'}${s}`] * 3];
    events.push({ t: ms(hit), name: 'hit', side: reach('L') > reach('R') ? 'L' : 'R' });
  }
  events.sort((x, y) => x.t - y.t || x.name.localeCompare(y.name));
  return { contacts, events };
}
