/**
 * @file The importer half of the readable codec (PLAN.md §10, WP 8.5; ADR-0010 amendment 1): a captured clip, 36
 * body points a frame, turned into readable key poses. `measure` reads a body's rest measurements from its own clips,
 * `encodePose` writes one key pose from body points, `encodeClip` a clip from chosen frames, `reduce` picks the frames
 * that matter (Ramer–Douglas–Peucker over whole poses), and `fitClip` adds keys until the decode stays within a
 * tolerance of the capture. The tools in tools/anim/ call it; readable.ts decodes what it writes.
 *
 * Ported from `my-3d2dge:src/mocap/readable.js` (`measure`, `encode`, `fit`, `capSample`, `reduce`) with no change in
 * behaviour, on the standard `Math` the source uses, so `x anim import --legacy` writes a set byte for byte as the
 * source's importer does (engine/anim/clip/encode.test.ts checks it against the source itself, the oracle).
 *
 * Invariants: every operation keeps the source's order, for its bits. The frame math and `torso` are the decode's
 * own (frames.ts), so a key encodes against exactly the torso its decode rebuilds and rounding never drifts. Points
 * are millimetres in the rig frame (f forward, r right, z up); a capture's `data` is Float32, as the source's.
 *
 * @example
 * import { REST, standing, clipOf } from '../../../tests/unit/anim/clip-fixtures';
 * import { samplePose } from './readable';
 * const data = new Float32Array([...samplePose(REST, clipOf([standing(0)]), 0), ...samplePose(REST, clipOf([standing(0)]), 0)]);
 * const capture = { name: 'Stand', n: 2, dur: 1, loop: false, fps: 1, data, move: null };
 * const { clip, mean } = fitClip(REST, capture, 30);
 * clip.keys.length; // 2: the first and last frames
 * mean < 1; // true: a standing pose re-encodes within a millimetre
 * @see engine/anim/clip/encode.test.ts
 */
import {
  add,
  compose,
  cross,
  DG,
  dot,
  fromEuler,
  hintFor,
  len,
  limbEnd,
  mul,
  norm,
  qFromTo,
  qrot,
  qslerp,
  reachOf,
  SG,
  sub,
  torso,
  type Frame,
  type V,
} from './frames';
import { encodeHand } from './hands';
import { armOf, POINT_COUNT, POINT_INDEX, samplePose, type Clip, type ClipKey, type KeyPose } from './readable';
import { poseError, poseMeanError, type RestBody } from './validate';

/** A captured clip, the importer's input: `n` frames at `fps` of the 36 body points (mm, rig frame). */
export interface Capture {
  name: string;
  /** Frames. */
  n: number;
  /** Seconds. */
  dur: number;
  loop: boolean;
  fps: number;
  /** `n` × 36 × `[f, r, z]`, mm. */
  data: Float32Array;
  /** The root's travel, `n` × `[f, r]` mm, or null when it stays put. */
  move: Float32Array | null;
  /** A capture database's take and seconds, `13_29 2.30-3.42`. */
  take?: string;
  /** A loop's travel over one cycle, mm (the importer turns it into the clip's `speed`). */
  stride?: number;
}

/** What `encodeClip` adds besides the keys: the catalog's words, and whether to aim a blade from the right fist. */
export interface EncodeExtra {
  tags?: string[];
  desc?: string;
  blade?: boolean;
  /** Format 2: write each hand's turn and grip (engine/anim/clip/hands.ts), the arm reaching a straight hand's fist. */
  hands?: boolean;
}

/* ---- the encode's own frame math, the inverses of frames.ts's (which it shares with the decode) ---- */
/** A frame `[F, R, U]` from a right and a forward direction (f × r = u). */
function frameFR(right: V, fwd: V): Frame {
  const R = norm(right);
  const F = norm(sub(fwd, mul(R, dot(fwd, R))));
  return [F, R, cross(F, R)];
}
/** A frame `[F, R, U]` from an up and a forward direction. */
function frameUF(up: V, fwd: V): Frame {
  const U = norm(up);
  const F = norm(sub(fwd, mul(U, dot(fwd, U))));
  return [F, cross(U, F), U];
}
const loc = (M: Frame, v: V): V => [dot(v, M[0]), dot(v, M[1]), dot(v, M[2])];
const rel = (parent: Frame, child: Frame): Frame => child.map((axis) => loc(parent, axis));
/** `[turn, lean, tilt]` degrees of a frame: yaw about up, then pitch about right (+ forward), then roll. */
function euler(M: Frame): V {
  const [F, , U] = M;
  const yaw = Math.atan2(F[1], F[0]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -F[2])));
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const u1 = [U[0] * cy + U[1] * sy, -U[0] * sy + U[1] * cy, U[2]];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  const u2 = [u1[0] * cp - u1[2] * sp, u1[1], u1[0] * sp + u1[2] * cp];
  return [yaw / DG, pitch / DG, -Math.atan2(-u2[1], u2[2]) / DG];
}
/** The bend at a two-bone limb's middle joint (degrees, 0 = straight) for a root-to-end distance (`reachOf` back). */
const bendOf = (dist: number, L1: number, L2: number) =>
  180 - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)))) / DG;
/** An angle moved by whole turns to continue from the one before (none: unchanged). */
const unwrap = (v: number, prev: number | undefined) =>
  prev === undefined ? v : v + 360 * Math.round((prev - v) / 360);
const r0 = Math.round;
/** The signed angle (degrees) round axis `d` from hint `h` to the bend direction `b`. */
function poleOf(d: V, h: V, b: V): number {
  const hn = norm(sub(h, mul(d, dot(h, d))));
  const bn = norm(sub(b, mul(d, dot(b, d))));
  return Math.atan2(dot(cross(hn, bn), d), dot(hn, bn)) / DG;
}
const pt = (X: ArrayLike<number>, name: string): V => {
  const i = POINT_INDEX[name] * 3;
  return [X[i], X[i + 1], X[i + 2]];
};
/** The pelvis, chest and head frames `[F, R, U]` of the body points `p` reads. */
const bodyFrames = (p: (name: string) => V): Frame[] => [
  frameFR(sub(p('hipR'), p('hipL')), sub(p('pelvisF'), p('pelvis'))),
  frameUF(sub(p('neck'), p('chest')), sub(p('chestF'), p('chest'))),
  frameUF(sub(p('headTop'), p('head')), sub(p('faceF'), p('head'))),
];

/* ---- captures ---- */
const SIZE = POINT_COUNT * 3;

/** The capture's 36 points at `t` seconds, in-betweened between its frames (loops wrap), written into `out`. */
export function capSample(c: Capture, t: number, out: Float32Array = new Float32Array(SIZE)): Float32Array {
  const u = Math.max(0, t) * c.fps;
  const f = c.loop ? u % Math.max(1, c.n - 1) : Math.min(u, c.n - 1);
  const i0 = Math.floor(f);
  const k = f - i0;
  const [a, b, D] = [i0 * SIZE, Math.min(c.n - 1, i0 + 1) * SIZE, c.data];
  for (let i = 0; i < SIZE; i++) out[i] = D[a + i] + (D[b + i] - D[a + i]) * k;
  return out;
}

/** The key frames (Ramer–Douglas–Peucker over whole poses): in-betweening the rest stays within `tol` mm. */
export function reduce(c: Capture, tol: number): number[] {
  const [D, n, keep, tmp] = [c.data, c.n, [0, c.n - 1], new Float32Array(SIZE)];
  const off = (a: number, b: number, i: number) => {
    const t = (i - a) / (b - a);
    for (let j = 0; j < SIZE; j++) tmp[j] = D[a * SIZE + j] + (D[b * SIZE + j] - D[a * SIZE + j]) * t;
    return poseError(tmp, D.subarray(i * SIZE, (i + 1) * SIZE));
  };
  const go = (a: number, b: number): void => {
    if (b - a < 2) return;
    let [wi, we] = [-1, 0];
    for (let i = a + 1; i < b; i++) {
      const e = off(a, b, i);
      if (e > we) [we, wi] = [e, i];
    }
    if (we > tol) {
      keep.push(wi);
      go(a, wi);
      go(wi, b);
    }
  };
  if (n > 1) go(0, n - 1);
  return [...new Set(keep)].sort((x, y) => x - y);
}

/* ---- a body's rest measurements ---- */
const rnd = <T>(v: T, k = 10): T =>
  (Array.isArray(v) ? v.map((x: unknown) => rnd(x, k)) : Math.round((v as number) * k) / k) as T;
type Turns = { X: Float32Array; qP: V; qC: V; qH: V };

/**
 * A body's rest measurements (plain, rounded data, saved in the set) from its own captures: proportions and rest
 * offsets from the T-pose clip `tposeName` (else the first clip's first frame), and how much of the hips-to-chest turn
 * each spine bone takes (and the neck of the chest-to-head turn), fitted from about six frames of every clip.
 */
export function measure(clips: Record<string, Capture>, tposeName = 'A_TPose'): RestBody {
  const list = Object.values(clips);
  const T = capSample(clips[tposeName] ?? list[0], 0);
  const q = (name: string) => pt(T, name);
  const d = (a: string, b: string) => len(sub(q(a), q(b)));
  const [Pr, Cr, Hr] = bodyFrames(q);
  const lr = (M: Frame, a: string, b: string) => ({
    L: loc(M, sub(q(`${a}L`), q(b))),
    R: loc(M, sub(q(`${a}R`), q(b))),
  });
  const R: Record<string, unknown> = {
    H0: q('pelvis')[2],
    hipZ: (q('hipL')[2] + q('hipR')[2]) / 2,
    ankleZ: q('ankleL')[2],
    ...{ Pr, Cr, Hr, hip: lr(Pr, 'hip', 'pelvis') },
    // the spine's four bones at rest; in motion each turns part of the way from the hips' rotation to the chest's
    spine: [
      sub(q('spine1'), q('pelvis')),
      sub(q('spine2'), q('spine1')),
      sub(q('chest'), q('spine2')),
      sub(q('neck'), q('chest')),
    ],
    neckSeg: sub(q('head'), q('neck')),
    clav: lr(Cr, 'clav', 'neck'),
    cv: { L: loc(Cr, sub(q('shL'), q('clavL'))), R: loc(Cr, sub(q('shR'), q('clavR'))) }, // collarbone to shoulder
    ...{ topH: loc(Hr, sub(q('headTop'), q('head'))), faceH: loc(Hr, sub(q('faceF'), q('head'))) },
    ...{ up: d('shL', 'elbowL'), fore: d('elbowL', 'wristL'), knuck: d('knuckL', 'wristL') },
    ...{ fist: d('fistL', 'wristL'), thigh: d('hipL', 'kneeL'), shin: d('kneeL', 'ankleL') },
    ...{ ab: d('ankleL', 'ballL'), bt: d('ballL', 'toeL') },
    abPitch: Math.asin((q('ankleL')[2] - q('ballL')[2]) / d('ankleL', 'ballL')) / DG,
    btPitch: Math.asin((q('ballL')[2] - q('toeL')[2]) / d('ballL', 'toeL')) / DG,
  };
  const frames: Turns[] = [];
  for (const c of list) {
    for (let f = 0; f < c.n; f += Math.max(1, Math.floor(c.n / 6))) {
      const X = capSample(c, f / c.fps);
      const [P, C, H] = bodyFrames((name) => pt(X, name));
      frames.push({ X, qP: qFromTo(Pr, P), qC: qFromTo(Cr, C), qH: qFromTo(Hr, H) });
    }
  }
  const fitW = (a: string, b: string, from: 'qP' | 'qC', to: 'qC' | 'qH', rest: V) => {
    let [best, be] = [0, Infinity];
    for (let w = 0; w <= 1.0001; w += 0.05) {
      let e = 0;
      for (const S of frames) e += len(sub(qrot(qslerp(S[from], S[to], w), rest), sub(pt(S.X, b), pt(S.X, a))));
      if (e < be) [be, best] = [e, w];
    }
    return Math.round(best * 100) / 100;
  };
  const spine = R.spine as V[];
  R.spineW = [
    fitW('pelvis', 'spine1', 'qP', 'qC', spine[0]),
    fitW('spine1', 'spine2', 'qP', 'qC', spine[1]),
    fitW('spine2', 'chest', 'qP', 'qC', spine[2]),
    1,
  ];
  R.neckW = fitW('neck', 'head', 'qC', 'qH', R.neckSeg as V);
  const lengths = ['H0', 'hipZ', 'ankleZ', 'up', 'fore', 'knuck', 'fist', 'thigh', 'shin', 'ab', 'bt'];
  for (const k of [...lengths, 'abPitch', 'btPitch']) R[k] = rnd(R[k], 100);
  for (const k of ['Pr', 'Cr', 'Hr']) R[k] = rnd(R[k], 1e5);
  for (const k of ['spine', 'neckSeg', 'topH', 'faceH']) R[k] = rnd(R[k]);
  for (const k of ['hip', 'clav', 'cv']) {
    const sides = R[k] as { L: V; R: V };
    R[k] = { L: rnd(sides.L), R: rnd(sides.R) };
  }
  return R as RestBody;
}

/* ---- key poses ---- */
type Key = Record<string, V>;

/** One key pose from captured body points `X`; `prev`, the key before, lets angles continue without jumps. */
export function encodePose(
  R: RestBody,
  X: ArrayLike<number>,
  prev?: KeyPose | null,
  opts: { hands?: boolean } = {},
): KeyPose {
  const [lower, p, k, pr] = [R.fore + R.fist, (name: string) => pt(X, name), {} as Key, (prev ?? {}) as Key];
  const uw = (a: V, b: V | undefined) => a.map((v, i) => r0(unwrap(v, b && b[i])));
  // a turn, lean and tilt has a second reading (turn + 180, 180 - lean, tilt + 180): take whichever continues from
  // the key before, so a body leaning past horizontal (a flip, a fall) keeps leaning instead of jumping round
  const ue = (e: V, b: V | undefined) => {
    const a1 = uw(e, b);
    if (!b) return a1;
    const a2 = uw([e[0] + 180, 180 - e[1], e[2] + 180], b);
    const dist = (a: V) => a.reduce((t, v, i) => t + Math.abs(v - b[i]), 0);
    return dist(a2) < dist(a1) ? a2 : a1;
  };
  k.hips = p('pelvis').map((v) => r0((v / R.H0) * 100));
  const [RPx, RCx, RHx] = bodyFrames(p);
  k.body = ue(euler(RPx), pr.body);
  k.chest = ue(euler(rel(fromEuler(k.body), RCx)), pr.chest);
  const RC = compose(fromEuler(k.body), fromEuler(k.chest));
  k.head = ue(euler(rel(RC, RHx)), pr.head);
  for (const s of ['L', 'R'] as const) {
    const [v, v0] = [loc(RC, sub(p(`sh${s}`), p(`clav${s}`))), R.cv[s]];
    const az = (a: V) => Math.atan2(a[0], a[1] * SG[s]) / DG;
    const el = (a: V) => Math.asin(Math.max(-1, Math.min(1, a[2] / len(a)))) / DG;
    k[`sh${s}`] = [r0(az(v) - az(v0)), r0(el(v) - el(v0))];
  }
  const tq = torso(R, k as KeyPose);
  for (const s of ['L', 'R'] as const) {
    const limbs = [
      ['arm', tq.sh(s), tq.RC, 'fist', 'elbow', R.up, lower],
      ['leg', tq.hip(s), tq.RP, 'ankle', 'knee', R.thigh, R.shin],
    ] as const;
    for (const [limb, root, M, end, mid, L1, L2] of limbs) {
      // with format 2's hands, the arm reaches the fist a straight hand would hold, on the forearm's line: the hand's
      // own turn is written apart, so the elbow and the wrist decode where they were
      const wrist = p(`wrist${s}`);
      const reach =
        limb === 'arm' && opts.hands ? add(wrist, mul(norm(sub(wrist, p(`elbow${s}`))), R.fist)) : p(end + s);
      let v = loc(M, sub(reach, root));
      // a fist curled in past the shoulder (a bent wrist, mid roll) is closer than a straight hand can fold: point the
      // fully bent limb away from the elbow instead, so the elbow, the bigger shape, stays where it was
      if (len(v) < Math.abs(L1 - L2) + 10) v = mul(norm(loc(M, sub(p(mid + s), root))), -Math.abs(L1 - L2));
      const dir = norm([v[0], v[1] * SG[s], v[2]]).map((x) => r0(x * 100));
      const bend = r0(bendOf(len(v), L1, L2));
      const dd = norm(sub(limbEnd(root, M, norm(dir), s, reachOf(bend, L1, L2)), root));
      const tw = poleOf(dd, hintFor(limb, SG[s], M, [dir[0], dir[1] * SG[s], dir[2]]), sub(p(mid + s), root));
      const before = pr[limb + s] as V | undefined;
      k[limb + s] = [...dir, bend, r0(unwrap(tw, before && before[4]))];
    }
    const fd = loc(tq.RP, norm(sub(p(`ball${s}`), p(`ankle${s}`))));
    const td = loc(tq.RP, norm(sub(p(`toe${s}`), p(`ball${s}`))));
    const [pf, down] = [pr[`foot${s}`] as V | undefined, Math.asin(Math.max(-1, Math.min(1, -fd[2]))) / DG];
    const toes = down - Math.asin(Math.max(-1, Math.min(1, -td[2]))) / DG - (R.abPitch - R.btPitch);
    k[`foot${s}`] = [r0(down - R.abPitch), r0(unwrap(Math.atan2(fd[1] * SG[s], fd[0]) / DG, pf && pf[1])), r0(toes)];
  }
  if (opts.hands) {
    for (const s of ['L', 'R'] as const) {
      const { wr, fd, hint } = armOf(R, tq, k as KeyPose, s);
      const points = { knuck: p(`knuck${s}`), fist: p(`fist${s}`), index: p(`index${s}`), pinky: p(`pinky${s}`) };
      const { hand, grip } = encodeHand(R, wr, fd, hint, s, points);
      k[`hand${s}`] = hand;
      (k as Record<string, unknown>)[`grip${s}`] = grip;
    }
  }
  return k as KeyPose;
}

/** A readable clip from a capture, keeping frames `kf` as its keys; `extra` adds the catalog's words and a blade. */
export function encodeClip(R: RestBody, cap: Capture, kf: readonly number[], extra: EncodeExtra = {}): Clip {
  const [keys, X] = [[] as ClipKey[], new Float32Array(SIZE)];
  let prev: ClipKey | null = null;
  for (const f of kf) {
    capSample(cap, f / cap.fps, X);
    // (to the millisecond: a key lands on its frame)
    const pose = encodePose(R, X, prev, { hands: extra.hands });
    const k = Object.assign({ t: Math.round((f / cap.fps) * 1000) / 1000 }, pose) as ClipKey;
    if (extra.blade) {
      const aim = loc(compose(fromEuler(k.body), fromEuler(k.chest)), norm(sub(pt(X, 'indexR'), pt(X, 'pinkyR'))));
      k.blade = aim.map((x) => r0(x * 100)) as ClipKey['blade'];
    }
    if (cap.move) k.root = [r0((cap.move[f * 2] / R.H0) * 100), r0((cap.move[f * 2 + 1] / R.H0) * 100)];
    keys.push(k);
    prev = k;
  }
  const words = { ...(extra.tags ? { tags: extra.tags } : {}), ...(extra.desc ? { desc: extra.desc } : {}) };
  return { clip: cap.name, dur: Math.round(cap.dur * 1000) / 1000, loop: cap.loop, ...words, keys };
}

/** A fitted clip, with its worst and average body-point error against the capture (mm, over every frame). */
export interface Fitted {
  clip: Clip;
  max: number;
  mean: number;
}

/**
 * A readable clip within `tol` mm of the capture: it starts from `reduce`'s key frames and adds the frame the
 * in-betweening misses most, until every frame is within `tol` of what the format can hold at all there (that frame
 * encoded as its own key): keys past the format's own limits are not worth their tokens.
 */
export function fitClip(R: RestBody, cap: Capture, tol: number, extra: EncodeExtra = {}): Fitted {
  const [kf, X, Y] = [reduce(cap, tol), new Float32Array(SIZE), new Float32Array(SIZE)];
  const t = (f: number) => f / cap.fps;
  const own = (f: number) => samplePose(R, encodeClip(R, cap, [f], extra), t(f), Y);
  const floor = Array.from({ length: cap.n }, (_, f) => poseError(capSample(cap, t(f), X), own(f)));
  for (let guard = 0; ; guard++) {
    const clip = encodeClip(R, cap, kf, extra);
    let [worst, wf, max, sum] = [0, -1, 0, 0];
    for (let f = 0; f < cap.n; f++) {
      capSample(cap, t(f), X);
      samplePose(R, clip, t(f), Y);
      const e = poseError(X, Y);
      max = Math.max(max, e);
      sum += poseMeanError(X, Y);
      if (e - floor[f] > worst) [worst, wf] = [e - floor[f], f];
    }
    if (worst <= tol || kf.includes(wf) || guard > cap.n) return { clip, max, mean: sum / cap.n };
    kf.push(wf);
    kf.sort((a, b) => a - b);
  }
}
