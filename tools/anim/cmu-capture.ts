/**
 * @file CMU takes turned into captures (PLAN.md §5.3, WP 8.5): `readCmu` cuts picked stretches of a subject's takes
 * (tools/anim/asf-amc.ts reads and poses them) into the captures the importer fits (engine/anim/clip/encode.ts
 * `Capture`: the 36 body points in the rig's frame, f forward, r right, z up, centred on the root on the ground), like
 * any other library's. Ported from `my-3d2dge:tools/asf-amc.mjs:80-175` with its operations kept, for its bits, and
 * two additions:
 * - **frames in-betweened**: an output frame between two source frames blends their points, by default; `legacy`
 *   takes the nearest source frame instead, as the source does, to reproduce today's CMU set byte for byte;
 * - **rotations too**: each bone's turn from its rest (T-pose) orientation, about the rig's axes, as a quaternion per
 *   frame (`rotations`, in `bones` order), for format 2's hands, feet and spine (WP 8.8).
 *
 * The rig's frame comes from the rest pose: up is +y, forward runs from the left heel toward the toes, right toward
 * the right hip. CMU's hands have one finger bone and a thumb, so the knuckle line (index, pinky) is set across the
 * hand, toward the thumb, and the fist point halfway down the fingers. Each stretch is turned about the vertical to
 * face forward and slid to start at the origin. A loop's stretch is searched for its best cycle (tools/anim/cycle.ts),
 * cut there and played in place: it faces the way it travels, its root follows the straight line through the cycle
 * (so the hips keep their sway), what its last frame still differs from its first is spread over the cycle, and its
 * `stride` is how far it travelled. `_rest` is the T-pose stood on the floor the takes stand on: the height the
 * lowest foot point keeps most often.
 *
 * @example
 * import { writeFileSync, mkdtempSync } from 'node:fs';
 * import { tmpdir } from 'node:os';
 * import { join } from 'node:path';
 * import { testAsf, testAmc } from './asf-amc-fixture';
 * const dir = mkdtempSync(join(tmpdir(), 'cmu-'));
 * writeFileSync(join(dir, '99.asf'), testAsf());
 * writeFileSync(join(dir, '99_01.amc'), testAmc(240));
 * const caps = readCmu(join(dir, '99.asf'), [{ name: 'Walk', take: '99_01', fps: 120 }]);
 * [caps.Walk.n, caps.Walk.take]; // [60, '99_01 0.00-1.99']
 * @see tools/anim/asf-amc.test.ts
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Capture } from '../../engine/anim/clip/encode';
import { POINT_COUNT, POSE_POINTS } from '../../engine/anim/clip/readable';
import { mm, mv, pose, readAmc, readAsf, tr, type AmcFrame, type Skeleton, type V } from './asf-amc';
import { bestCycle } from './cycle';

const MM = 1000;
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => mul(a, 1 / (Math.hypot(...a) || 1));
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A picked stretch of a take: seconds `from`–`to` (to the end when absent), its rate, and whether it loops. */
export interface Pick {
  name: string;
  take: string;
  from?: number;
  to?: number;
  fps?: number;
  loop?: boolean;
  /** A loop's shortest cycle, seconds (a gait whose feet meet between steps matches itself after one step). */
  minCycle?: number;
}
/** A capture read from a take, with each bone's rotation from rest per frame (`bones` order), quaternions. */
export type CmuCapture = Capture & { bones?: string[]; rotations?: Float32Array };
/** How `readCmu` samples: the output rate, nearest frames (legacy) or in-betweened ones, and where notes go. */
export interface CmuOptions {
  fps?: number;
  legacy?: boolean;
  notes?: string[];
  /** Reads a take's `.amc` text (default: beside the `.asf`). */
  readTake?: (take: string) => string;
}

const BONES_NEEDED = ['lowerback', 'upperback', 'thorax', 'upperneck', 'head'].concat(
  ...['l', 'r'].map((s) =>
    ['hipjoint', 'femur', 'tibia', 'foot', 'toes', 'clavicle', 'humerus', 'radius', 'hand', 'fingers', 'thumb'].map(
      (b) => s + b,
    ),
  ),
);
const I = POSE_POINTS.indexOf('pelvis');

/** One subject's picked stretches as captures, plus `_rest` (see the file comment); `asfFile` is the skeleton. */
export function readCmu(asfFile: string, picks: Pick[], options: CmuOptions = {}): Record<string, CmuCapture> {
  const { fps: FPS = 30, legacy = false, notes = [] } = options;
  const readTake =
    options.readTake ?? ((take: string) => readFileSync(join(dirname(asfFile), `${take}.amc`), 'latin1'));
  const sk = readAsf(readFileSync(asfFile, 'latin1'));
  const [B, rest] = [sk.bones, pose(sk, null)];
  const missing = BONES_NEEDED.filter((n) => !B[n]);
  if (missing.length) throw new Error(`${basename(asfFile)} lacks bones: ${missing.join(', ')}`);
  // the rig's frame from the rest pose: up is +y; forward from the heel toward the toes; right toward the right hip
  const fwd0 = norm([rest.end.ltoes[0] - rest.end.ltibia[0], 0, rest.end.ltoes[2] - rest.end.ltibia[2]]);
  let RIGHT = [fwd0[2], 0, -fwd0[0]];
  if (dot(sub(rest.end.rhipjoint, rest.end.lhipjoint), RIGHT) < 0) RIGHT = mul(RIGHT, -1);
  const points = cmuPoints(sk, fwd0);
  type Posed = ReturnType<typeof pose>;
  const pts = (ps: Posed) => POSE_POINTS.map((n) => points(ps, n));
  const local = (p: V, o: V) => {
    const d = [p[0] - o[0], p[1], p[2] - o[2]];
    return [d[0] * fwd0[0] + d[2] * fwd0[2], d[0] * RIGHT[0] + d[2] * RIGHT[2], d[1]];
  };
  const J = POSE_POINTS.indexOf('pelvisF');
  const heading = (W: V[]) => {
    const h = sub(W[J], W[I]);
    return Math.atan2(dot([h[0], 0, h[2]], RIGHT), dot([h[0], 0, h[2]], fwd0));
  };
  const turned = cycleFrame(sk, pts, fwd0, RIGHT);
  const feet = ['toeL', 'toeR', 'ballL', 'ballR'].map((k) => POSE_POINTS.indexOf(k));
  const low = (W: V[]) => Math.min(...feet.map((k) => W[k][1]));
  const [takes, clips, lows] = [{} as Record<string, AmcFrame[]>, {} as Record<string, CmuCapture>, [] as number[]];
  const P = POINT_COUNT;
  for (const pk of picks) {
    if (!takes[pk.take]) {
      // a new take: its lowest foot point, frame by frame (where the floor is, below)
      takes[pk.take] = readAmc(readTake(pk.take));
      const every = Math.max(1, Math.round((pk.fps || 120) / 30));
      for (let k = 0; k < takes[pk.take].length; k += every) lows.push(low(pts(pose(sk, takes[pk.take][k]))));
    }
    const frames = takes[pk.take];
    const src = pk.fps || 120;
    let [from, to] = [pk.from || 0, Math.min(pk.to === undefined ? Infinity : pk.to, (frames.length - 1) / src)];
    if (!(to > from)) {
      const lasts = ((frames.length - 1) / src).toFixed(2);
      throw new Error(`${pk.name}: ${pk.take} has no frames from ${from} s to ${pk.to} s (it lasts ${lasts} s)`);
    }
    let seam = 0;
    const shares: number[] = [];
    if (pk.loop) [from, to, seam] = bestCycle(frames.length, src, from, to, (k) => turned(frames[k]), pk.minCycle);
    // a loop's frames are spaced to end exactly on its cycle (a stretch of a few milliseconds at most)
    const n = Math.max(1, Math.round((to - from) * FPS) + 1);
    const step = pk.loop && n > 1 ? (to - from) / (n - 1) : 1 / FPS;
    const [world, posed] = [[] as V[][], [] as Posed['M'][][]];
    for (let f = 0; f < n; f++) {
      const u = (from + f * step) * src;
      const i0 = Math.min(frames.length - 1, legacy ? Math.round(u) : Math.floor(u));
      const share = legacy ? 0 : Math.min(1, u - i0);
      const a = pose(sk, frames[i0]);
      const b = share > 0 && i0 + 1 < frames.length ? pose(sk, frames[i0 + 1]) : null;
      const [pa, pb] = [pts(a), b && pts(b)];
      world.push(pb ? pa.map((p, i) => p.map((v, j) => v + (pb[i][j] - v) * share)) : pa);
      posed.push(b ? [a.M, b.M] : [a.M]);
      shares.push(share);
    }
    // face forward and start at the origin: turn the take about the vertical so the hips face the rig's forward at its
    // first frame (a loop: the way it travels, when it travels), and slide it so the root starts at 0
    const travel = sub(world[n - 1][I], world[0][I]);
    const far = Math.hypot(travel[0], travel[2]) > 0.2;
    const flat = [travel[0], 0, travel[2]];
    const ang = pk.loop && far ? Math.atan2(dot(flat, RIGHT), dot(flat, fwd0)) : heading(world[0]);
    const [c, s, o] = [Math.cos(ang), Math.sin(ang), world[0][I]];
    const spin = (p: V) => {
      const d = [p[0] - o[0], p[2] - o[2]];
      const [f, r] = [d[0] * fwd0[0] + d[1] * fwd0[2], d[0] * RIGHT[0] + d[1] * RIGHT[2]];
      const [f2, r2] = [f * c + r * s, -f * s + r * c];
      return [fwd0[0] * f2 + RIGHT[0] * r2, p[1], fwd0[2] * f2 + RIGHT[2] * r2];
    };
    const [data, move, Wn] = [new Float32Array(n * P * 3), new Float32Array(n * 2), world[n - 1].map(spin)];
    let moved = false;
    world.forEach((W, f) => {
      // the root: the hips (a loop: the straight line from its first frame's hips to its last's, so it plays in place)
      const [Wr, u] = [W.map(spin), n > 1 ? f / (n - 1) : 0];
      const root = pk.loop ? [Wn[I][0] * u, 0, Wn[I][2] * u] : Wr[I];
      const rl = local(root, [0, 0, 0]);
      [move[f * 2], move[f * 2 + 1]] = [rl[0] * MM, rl[1] * MM];
      if (!pk.loop && Math.abs(rl[0]) + Math.abs(rl[1]) > 0.01) moved = true;
      Wr.forEach((p, i) => {
        const q = local(p, root);
        data.set([q[0] * MM, q[1] * MM, q[2] * MM], (f * P + i) * 3);
      });
    });
    // a loop closes exactly: what its last frame still differs from its first is spread over the cycle, a little a
    // frame (the last frame is corrected last)
    if (pk.loop && n > 2) {
      const L = (n - 1) * P * 3;
      for (let f = 1; f < n; f++)
        for (let k = 0; k < P * 3; k++) data[f * P * 3 + k] -= ((data[L + k] - data[k]) * f) / (n - 1);
    }
    const take = `${pk.take} ${from.toFixed(2)}-${to.toFixed(2)}`;
    // the rig's axes in world coordinates, turned with the take: rows forward, right, up
    const axes = [...add(mul(fwd0, c), mul(RIGHT, s)), ...sub(mul(RIGHT, c), mul(fwd0, s)), 0, 1, 0];
    const rotations = rigTurns(sk.order, posed, shares, axes);
    clips[pk.name] = {
      name: pk.name,
      n,
      dur: (n - 1) / FPS,
      loop: !!pk.loop,
      fps: FPS,
      data,
      move: moved ? move : null,
      take,
    };
    Object.assign(
      clips[pk.name],
      { bones: sk.order, rotations },
      pk.loop ? { stride: Math.hypot(Wn[I][0], Wn[I][2]) * MM } : {},
    );
    if (pk.loop) {
      const at = `${from.toFixed(2)}-${to.toFixed(2)} s of ${pk.take}`;
      notes.push(
        `${pk.name}: a ${(to - from).toFixed(2)} s cycle at ${at} (its seam is off by ${Math.round(seam * MM)} mm)`,
      );
    }
  }
  clips._rest = restCapture(pts(rest), lows, low, local, FPS);
  return clips;
}

/** Where each body point sits on the skeleton, `points(posed, name)` in world metres. */
function cmuPoints(sk: Skeleton, fwd0: V) {
  const B = sk.bones;
  // points fixed on a bone: [bone, along (0 = its start, 1 = its end), offset at rest (metres, world)]
  const on = (b: string, t: number, off: V = [0, 0, 0]): [string, number, V] => [b, t, off];
  const F12 = mul(fwd0, 0.12);
  const across = (s: string) => {
    const [h, th] = [B[`${s}hand`].dir, B[`${s}thumb`].dir];
    return norm(sub(th, mul(h, dot(th, h)))); // toward the thumb, across the hand
  };
  const P: Record<string, [string, number, V]> = {
    ...{ pelvis: on('root', 1), spine1: on('lowerback', 1), spine2: on('upperback', 1), chest: on('thorax', 0.5) },
    ...{ neck: on('thorax', 1), head: on('upperneck', 1), headTop: on('head', 1), faceF: on('head', 0, F12) },
    ...{ chestF: on('thorax', 0.5, F12), pelvisF: on('root', 1, F12) },
  };
  for (const [S, s] of [
    ['L', 'l'],
    ['R', 'r'],
  ]) {
    Object.assign(P, {
      [`clav${S}`]: on(`${s}clavicle`, 0.15),
      [`sh${S}`]: on(`${s}clavicle`, 1),
      [`elbow${S}`]: on(`${s}humerus`, 1),
      [`wrist${S}`]: on(`${s}radius`, 1),
      [`knuck${S}`]: on(`${s}hand`, 1),
      [`index${S}`]: on(`${s}hand`, 1, mul(across(s), 0.035)),
      [`pinky${S}`]: on(`${s}hand`, 1, mul(across(s), -0.035)),
      [`fist${S}`]: on(`${s}fingers`, 0.5),
      [`hip${S}`]: on(`${s}hipjoint`, 1),
      [`knee${S}`]: on(`${s}femur`, 1),
      [`ankle${S}`]: on(`${s}tibia`, 1),
      [`ball${S}`]: on(`${s}foot`, 1),
      [`toe${S}`]: on(`${s}toes`, 1),
    });
  }
  return (ps: ReturnType<typeof pose>, name: string): V => {
    const [b, t, off] = P[name];
    if (b === 'root') return add(ps.end.root, mv(ps.M.root, off));
    return add(add(ps.start(b), mul(mv(ps.M[b], B[b].dir), B[b].len * sk.scale * t)), mv(ps.M[b], off));
  };
}

/** A take's frame as the cycle search compares it: its points seen from the hips, turned to face forward. */
function cycleFrame(sk: Skeleton, pts: (ps: ReturnType<typeof pose>) => V[], fwd0: V, RIGHT: V) {
  const J = POSE_POINTS.indexOf('pelvisF');
  return (frame: AmcFrame) => {
    const W = pts(pose(sk, frame));
    const h = sub(W[J], W[I]);
    const g = -Math.atan2(dot([h[0], 0, h[2]], RIGHT), dot([h[0], 0, h[2]], fwd0));
    const [c, s, o, v] = [Math.cos(g), Math.sin(g), W[I], new Float64Array(POINT_COUNT * 3)];
    W.forEach((p, i) => {
      const d = [p[0] - o[0], p[2] - o[2]];
      const [f, r] = [d[0] * fwd0[0] + d[1] * fwd0[2], d[0] * RIGHT[0] + d[1] * RIGHT[2]];
      v.set([f * c - r * s, f * s + r * c, p[1]], i * 3);
    });
    return v;
  };
}

/** The rest pose stood where the takes stand: its lowest toe on the floor most foot points keep (see the comment). */
function restCapture(
  R: V[],
  lows: number[],
  low: (W: V[]) => number,
  local: (p: V, o: V) => V,
  fps: number,
): CmuCapture {
  // the most common centimetre among the lower half of the frames, so a landing's dip or a climb's rungs do not move it
  let floor = 0;
  if (lows.length) {
    const half = lows.sort((a, b) => a - b).slice(0, Math.ceil(lows.length / 2));
    const bins = new Map<number, number>();
    for (const v of half) bins.set(Math.round(v * 100), (bins.get(Math.round(v * 100)) ?? 0) + 1);
    floor = [...bins].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] / 100;
  }
  const [rd, lift] = [new Float32Array(POINT_COUNT * 3), floor - low(R)];
  R.forEach((p, i) => {
    const q = local([p[0], p[1] + lift, p[2]], [R[I][0], 0, R[I][2]]);
    rd.set([q[0] * MM, q[1] * MM, q[2] * MM], i * 3);
  });
  return { name: '_rest', n: 1, dur: 0, loop: false, fps, data: rd, move: null };
}

/** A rotation matrix (row major) as a quaternion `[x, y, z, w]`. */
function quat(m: V): V {
  const t = m[0] + m[4] + m[8];
  const q =
    t > 0
      ? [m[7] - m[5], m[2] - m[6], m[3] - m[1], t + 1]
      : m[0] > m[4] && m[0] > m[8]
        ? [1 + m[0] - m[4] - m[8], m[1] + m[3], m[2] + m[6], m[7] - m[5]]
        : m[4] > m[8]
          ? [m[1] + m[3], 1 + m[4] - m[0] - m[8], m[5] + m[7], m[2] - m[6]]
          : [m[2] + m[6], m[5] + m[7], 1 + m[8] - m[0] - m[4], m[3] - m[1]];
  return mul4(q, 1 / Math.hypot(...q));
}
const mul4 = (q: V, k: number) => q.map((v) => v * k);
/**
 * Each bone's turn from rest, frame by frame, about the rig's axes (`axes`, row major: the world rotation M seen as
 * axes · M · axesᵀ, a proper rotation whatever the axes' handedness), in-betweened toward the next source frame by
 * the frame's share (normalized-linear, the short way): `frames × bones × [x, y, z, w]`.
 */
function rigTurns(bones: string[], posed: Record<string, V>[][], shares: number[], axes: V): Float32Array {
  const out = new Float32Array(posed.length * bones.length * 4);
  const rig = (M: V) => quat(mm(mm(axes, M), tr(axes)));
  posed.forEach(([a, b], f) =>
    bones.forEach((bone, k) => {
      let q = rig(a[bone]);
      if (b) {
        const qb = rig(b[bone]);
        const sign = q[0] * qb[0] + q[1] * qb[1] + q[2] * qb[2] + q[3] * qb[3] < 0 ? -1 : 1;
        const blend = q.map((v, i) => v + (qb[i] * sign - v) * shares[f]);
        q = mul4(blend, 1 / Math.hypot(...blend));
      }
      out.set(q, (f * bones.length + k) * 4);
    }),
  );
  return out;
}
