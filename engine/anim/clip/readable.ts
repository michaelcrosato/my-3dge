/**
 * @file Readable key poses, the stored clip format (PLAN.md §10.2, WP 8.2; ADR-0010): its types, format 1 and the
 * fields format 2 adds, and the decode that rebuilds 36 body points from a key pose on a measured rest body. Ported
 * from `my-3d2dge:src/mocap/readable.js` with no change in behaviour, on the standard `Math` the source uses: every
 * curated clip decodes within 0.001 mm of the source decoder (tools/anim/legacy-readable.ts, the oracle).
 *
 * A key names what an animator would: where the hips are, how the body, chest and head turn, lean and tilt, how the
 * shoulders reach and shrug, which way each limb points with its bend and twist, and how the feet point (lens.ts's
 * `LEGEND`). Limbs are a direction plus a bend, so the same clip fits any build and mirrors by swapping L and R.
 * Between keys every stored number is in-betweened linearly; loops wrap, one-shots hold their last pose (`keyAt`).
 *
 * Invariants: the decode reads format-1 fields only; format 2's key fields (hands, foot roll, root yaw, the spine
 * override, grips) are carried, in-betweened, mirrored and printed, and WP 8.8's importer, which first writes them,
 * adds their decode with their encode. The frame math and `torso` are frames.ts's, which the encode (encode.ts)
 * shares, as the source shares them. Points are millimetres in the rig frame: f forward, r right, z up. validate.ts
 * reads clips and sets in (and types the `RestBody` their sources measured); lens.ts prints them; mirror.ts mirrors
 * them.
 *
 * @example
 * import { REST, standing } from '../../../tests/unit/anim/clip-fixtures'; // a measured rest body, a standing key
 * const clip = { dur: 1, keys: [standing(0), { ...standing(1), hips: [0, 0, 80] }] };
 * keyAt(clip, 0.5).hips; // [0, 0, 90]: every number in-betweened
 * const points = samplePose(REST, clip, 0.5); // a Float32Array: 36 points × [f, r, z], mm
 * points[POINT_INDEX.pelvis * 3 + 2]; // 825.03: 90% of the standing pelvis height, REST.H0
 * @see engine/anim/clip/readable.test.ts
 */
import { add, cross, DG, dot, hintFor, len, limbEnd, mul, norm, reachOf, SG, sub, torso, wld, type V } from './frames';
import { KEY_ARRAYS, KEY_NUMBERS } from './lens';
import type { RestBody } from './validate';

/** Three numbers: a point or direction `[f, r, z]`, or `[turn, lean, tilt]` in degrees. */
export type Triple = [number, number, number];
/** A limb: `[forward, out, up]` as percentages (need not add up), then the bend and twist in degrees. */
export type LimbPose = [forward: number, out: number, up: number, bend: number, twist: number];

/** One key pose. Format 1's fields, then format 2's (all optional). Angles in degrees, distances in % of hip height. */
export interface ClipKey {
  /** Seconds from the clip's start. */
  t: number;
  /** The pelvis `[forward, right, up]`, % of standing hip height (100 = standing). */
  hips: Triple;
  /** The pelvis `[turn, lean, tilt]`: turn + toward the right, lean + forward, tilt + toward the right. */
  body: Triple;
  /** The chest, relative to the pelvis. */
  chest: Triple;
  /** The head, relative to the chest. */
  head: Triple;
  /** The shoulders `[reach, shrug]`: how far each swings forward and up from rest. */
  shL?: [reach: number, shrug: number];
  shR?: [reach: number, shrug: number];
  /** Shoulder to fist in chest space (out + away from the body); bend 0 = straight; twist swings the elbow round. */
  armL: LimbPose;
  armR: LimbPose;
  /** Hip to ankle in pelvis space; bend is the knee's; twist turns the knee from pointing forward. */
  legL: LimbPose;
  legR: LimbPose;
  /** The feet `[down, out, toes]`: each points down from standing, turns outward, and bends its toes up. */
  footL?: Triple;
  footR?: Triple;
  /** A blade held in the right fist: its direction in chest space. */
  blade?: Triple;
  /** How far a travelling clip has moved the body, `[forward, right]` in % of standing hip height. */
  root?: [forward: number, right: number];
  /** Format 2: the hands at the wrist, `[flex, side, roll]`: + toward the palm, toward the thumb, palm down. */
  handL?: Triple;
  handR?: Triple;
  /** Format 2: the feet's roll, + = the sole turning inward. */
  rollL?: number;
  rollR?: number;
  /** Format 2: the root's yaw, + = toward the right. */
  yaw?: number;
  /** Format 2: the middle of the spine relative to the pelvis, written only when the library's spine share misses. */
  spine?: Triple;
  /** Format 2: how closed each hand is, 0–100. */
  gripL?: number;
  gripR?: number;
}

/** The pose between keys, as `keyAt` in-betweens it: every field of the key before, without its time. */
export type KeyPose = Partial<Omit<ClipKey, 't'>>;

/** Format 2: a moment in a clip, such as `{ t: 0.42, name: 'land' }` or `{ t: 0.8, name: 'step', side: 'L' }`. */
export interface ClipEvent {
  t: number;
  name: string;
  side?: 'L' | 'R';
}

/** Format 2: when a foot or hand holds the ground or a surface, from `from` to `to` seconds (detected at import). */
export interface ClipContact {
  part: 'footL' | 'footR' | 'handL' | 'handR';
  from: number;
  to: number;
}

/** One clip: its header, then its keys in time order. */
export interface Clip {
  /** Its real name. */
  clip?: string;
  /** Which of its set's `sources` it was measured on. */
  src?: string;
  /** What it was made from: another set's clip, `SET/clip`. */
  orig?: string;
  /** A capture database's take and seconds, `13_29 2.30-3.42`. */
  take?: string;
  /** Its length in seconds. */
  dur: number;
  loop?: boolean;
  tags?: string[];
  desc?: string;
  /** Format 2: how fast a loop travels as captured, % of standing hip height a second (shardfall's). */
  speed?: number;
  /** Format 2: the source's frame rate. */
  fps?: number;
  /** Format 2: where this version came from. */
  via?: 'v1' | 'shardfall' | 'source';
  /** Format 2: the average and worst body-point error against its capture, mm. */
  fit?: [mean: number, worst: number];
  /** Format 2: named moments. */
  events?: ClipEvent[];
  /** Format 2: foot and hand contact intervals. */
  contacts?: ClipContact[];
  /** Format 2: props held, `<prop>:<hands>` such as `sword:R` or `box:LR`. */
  props?: string[];
  keys: ClipKey[];
}

/** The 36 body points a pose rebuilds, in order: three numbers each (f, r, z) in the decoded array. */
export const POSE_POINTS: readonly string[] = [
  ...['pelvis', 'spine1', 'spine2', 'chest', 'neck', 'head', 'headTop', 'faceF', 'chestF', 'pelvisF'],
  ...['L', 'R'].flatMap((side) =>
    ['clav', 'sh', 'elbow', 'wrist', 'index', 'knuck', 'pinky', 'fist', 'hip', 'knee', 'ankle', 'ball', 'toe'].map(
      (part) => part + side,
    ),
  ),
];
/** Each point's position in `POSE_POINTS`. */
export const POINT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(POSE_POINTS.map((p, i) => [p, i]));
/** The number of body points, 36. */
export const POINT_COUNT = POSE_POINTS.length;

/* ---- the decode's own limb math; the shared frame math and `torso` are frames.ts's ---- */
/** Two-bone IK (the engine's `E.ik3`): `[joint, end]`, the joint bending toward `hint`. */
function ik3(a: V, b: V, L1: number, L2: number, hint: V): [V, V] {
  let d = sub(b, a);
  let dist = len(d);
  const max = L1 + L2 - 0.01;
  if (dist > max) {
    d = mul(d, max / dist);
    b = add(a, d);
    dist = max;
  }
  dist = Math.max(dist, 0.01);
  const n = mul(d, 1 / dist);
  let h = sub(hint, mul(n, dot(hint, n)));
  const hl = len(h);
  h = hl < 1e-4 ? [n[1], -n[0], 0] : mul(h, 1 / hl);
  const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const y = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  return [add(add(a, mul(n, x)), mul(h, y)), b];
}
/** The hint `h` turned `deg` degrees round limb direction `d`: where the middle joint bends, given the twist. */
function poleHint(d: V, h: V, deg: number): V {
  const hn = norm(sub(h, mul(d, dot(h, d))));
  const a = deg * DG;
  return add(mul(hn, Math.cos(a)), mul(cross(d, hn), Math.sin(a)));
}

/** Writes the 36 body points of key pose `k`, rebuilt on rest body `R`, into `out` (mm, rig frame) and returns it. */
export function decodePose<T extends PointArray>(R: RestBody, k: KeyPose, out: T): T {
  const lower = R.fore + R.fist;
  const tq = torso(R, k);
  const set = (name: string, v: V) => {
    const i = POINT_INDEX[name] * 3;
    [out[i], out[i + 1], out[i + 2]] = [v[0], v[1], v[2]];
  };
  const { p, RP, RC, RH, neck, head } = tq;
  set('pelvis', p);
  set('pelvisF', add(p, mul(RP[0], 120)));
  set('spine1', tq.spine1);
  set('spine2', tq.spine2);
  set('chest', tq.chest);
  set('chestF', add(tq.chest, mul(RC[0], 120)));
  set('neck', neck);
  set('head', head);
  set('headTop', add(head, wld(RH, R.topH)));
  set('faceF', add(head, wld(RH, R.faceH)));
  const blade = k.blade ? norm(wld(RC, k.blade)) : null;
  for (const s of ['L', 'R'] as const) {
    const sh = tq.sh(s);
    const a = k[`arm${s}`] as V;
    const aN = norm(a);
    const fT = limbEnd(sh, RC, aN, s, reachOf(a[3] || 0, R.up, lower));
    const ad = norm(sub(fT, sh));
    const hint = poleHint(ad, hintFor('arm', SG[s], RC, [aN[0], aN[1] * SG[s], aN[2]]), a[4] || 0);
    const [el, fist] = ik3(sh, fT, R.up, lower, hint);
    const fd = norm(sub(fist, el));
    const wr = add(el, mul(fd, R.fore));
    set(`clav${s}`, add(neck, wld(RC, R.clav[s])));
    set(`sh${s}`, sh);
    set(`elbow${s}`, el);
    set(`wrist${s}`, wr);
    set(`knuck${s}`, add(wr, mul(fd, R.knuck)));
    set(`fist${s}`, fist);
    const acr = s === 'R' && blade ? blade : RC[1];
    set(`index${s}`, add(fist, mul(acr, 20)));
    set(`pinky${s}`, add(fist, mul(acr, -20)));
    const hip = tq.hip(s);
    const l = k[`leg${s}`] as V;
    const ln = norm(l);
    const aT = limbEnd(hip, RP, ln, s, reachOf(l[3] || 0, R.thigh, R.shin));
    const ld = norm(sub(aT, hip));
    const legHint = poleHint(ld, hintFor('leg', SG[s], RP, [ln[0], ln[1] * SG[s], ln[2]]), l[4] || 0);
    const [kn, an] = ik3(hip, aT, R.thigh, R.shin, legHint);
    set(`hip${s}`, hip);
    set(`knee${s}`, kn);
    set(`ankle${s}`, an);
    const ft = k[`foot${s}`] ?? [0, 0, 0];
    const [pa, pb, yw] = [(ft[0] + R.abPitch) * DG, (ft[0] + R.btPitch - (ft[2] || 0)) * DG, ft[1] * DG];
    const dir = (q: number) => wld(RP, [Math.cos(q) * Math.cos(yw), SG[s] * Math.cos(q) * Math.sin(yw), -Math.sin(q)]);
    const ball = add(an, mul(dir(pa), R.ab));
    set(`ball${s}`, ball);
    set(`toe${s}`, add(ball, mul(dir(pb), R.bt)));
  }
  return out;
}

/** The key pose at time `t` (seconds): every number in-betweened from the keys either side; loops wrap. */
export function keyAt(clip: Clip, t: number): KeyPose {
  const K = clip.keys;
  const dur = clip.dur || K[K.length - 1].t;
  const tt = clip.loop && dur > 0 ? ((t % dur) + dur) % dur : Math.min(Math.max(0, t), dur);
  let i = 0;
  while (i < K.length - 2 && K[i + 1].t <= tt) i++;
  const [a, b] = [K[i], K[Math.min(i + 1, K.length - 1)]];
  const u = b.t > a.t ? Math.min(1, Math.max(0, (tt - a.t) / (b.t - a.t))) : 0;
  const k: Record<string, number | number[]> = {};
  const [from, to] = [a as unknown as Record<string, number[]>, b as unknown as Record<string, number[]>];
  for (const f in KEY_ARRAYS) if (from[f]) k[f] = from[f].map((v, j) => v + ((to[f] || from[f])[j] - v) * u);
  const [n0, n1] = [a as unknown as Record<string, number>, b as unknown as Record<string, number>];
  for (const f in KEY_NUMBERS) if (n0[f] !== undefined) k[f] = n0[f] + ((n1[f] ?? n0[f]) - n0[f]) * u;
  return k as KeyPose;
}

/** A decoded pose: 36 points × `[f, r, z]` in mm, in `POSE_POINTS` order. */
export type PointArray = { [i: number]: number };

/**
 * The 36 body points at time `t` on rest body `R`, written into `out` (a new Float32Array, as the source's, unless
 * given; pass a Float64Array for full precision).
 */
export function samplePose<T extends PointArray = Float32Array>(R: RestBody, clip: Clip, t: number, out?: T): T {
  return decodePose(R, keyAt(clip, t), out ?? (new Float32Array(POINT_COUNT * 3) as unknown as T));
}

/** How far a travelling clip has carried the body at time `t`, `[forward, right]` in mm; null when it does not. */
export function moveAt(R: RestBody, clip: Clip, t: number): [number, number] | null {
  if (!clip.keys[0].root) return null;
  const root = keyAt(clip, t).root as V;
  return [(root[0] * R.H0) / 100, (root[1] * R.H0) / 100];
}
