/**
 * @file The baker (PLAN.md §10.4, WP 8.4; ADR-0010): a readable clip turned into rotation tracks on the humanoid
 * skeleton (engine/anim/skeleton.ts), 30 frames a second on format 1's key grid (`bakeTimes`): each frame holds the
 * 23 joints' local rotations, the pelvis's place and the root's travel. retarget.ts plays the tracks on any build (and
 * on the rest body's own skeleton, for parity) and makes them a three.js `AnimationClip`; layer.ts plays them in the
 * animator.
 *
 * The baker works from the key's parameters, as the decode (readable.ts) does, not from decoded points: the frames
 * of the pelvis, chest and head from their turn, lean and tilt; each limb from its direction, bend and twist through
 * the decode's own hint and two-bone solve (rewritten here to give frames, not points); the feet from down, out and
 * toes. So a straight arm keeps its twist (its pole comes from the hint, not from an elbow that no longer bends), and
 * the singular poses are handled: a limb with no direction keeps its parent's frame, a hint along the limb takes the
 * parent's pole, a limb folded so far that its middle joint falls behind its root still bends forward (an elbow past
 * ~130°), and a hand whose across direction nears the forearm's line eases back to the forearm's roll.
 *
 * What a rotation means (identity is the skeleton's T-pose, every frame the character's: +Y up, +Z forward, left +X):
 * - the pelvis turns from the T-pose to the key's pelvis frame; the spine, chest, neck and head take the decode's own
 *   shares of the pelvis-to-chest and chest-to-head turns, so at the library's rest stance every torso joint is
 *   unturned and the rest body's curve stays in its bones (retarget.ts `restSkeleton`); a collarbone swings by the
 *   key's reach and shrug;
 * - an upper arm takes its bone (+X left, −X right) to the shoulder-to-elbow direction and −Z to the elbow's pole; a
 *   thigh takes −Y to hip-to-knee and +Z to the knee's pole; elbows and knees turn about their hinges only (ik.ts
 *   `LIMBS`); a hand runs on along the forearm (the decode keeps it straight) and turns +Z (the weapon socket's
 *   blade side) to the decode's across direction (the blade, or the chest's right);
 * - a foot turns +Z to where the key points it, by the pelvis frame, its out and its down; a toe adds its bend.
 *
 * Invariants: rotations are unit quaternions, in Float32 as stored, each frame's sign kept on the side of the last.
 * Places are metres on the source body, engine axes, from the root on the ground. Every library's last spine share
 * (`spineW[3]`) is 1, so the chest carries the neck and collarbones rigidly. Pure: the same clip and rest body give
 * the same bits. FK parity against the decode: engine/anim/clip/bake.test.ts.
 *
 * @example
 * import { REST, standing, clipOf } from '../../../tests/unit/anim/clip-fixtures';
 * const baked = bakeClip(clipOf([standing(0), { ...standing(1), hips: [0, 0, 80] }]), REST);
 * baked.frames; // 31: 30 a second over 1 s, both ends
 * baked.hips[1]; // 0.9167: the pelvis at REST.H0, in metres
 * @see engine/anim/clip/bake.test.ts
 */
import { Matrix4, Quaternion, Vector3 } from '../../core/math';
import { JOINT_COUNT, JOINTS, PARENTS, type JointName } from '../skeleton';
import { keyAt, moveAt, type Clip, type ClipContact, type KeyPose } from './readable';
import type { RestBody } from './validate';

/** Frames a second of a baked clip. */
export const BAKE_FPS = 30;

/** A clip baked to rotation tracks (see the file comment). */
export interface BakedClip {
  /** The clip's name. */
  readonly name: string;
  /** Seconds. */
  readonly duration: number;
  readonly loop: boolean;
  /** How many frames: one every 1/30 s from 0 (format 1's key grid), one at `duration` (a loop's last is its first). */
  readonly frames: number;
  /** Each frame's time, seconds: frame i's is i/30, the last's `duration` (so the last step can be shorter). */
  readonly times: Float32Array;
  /** Each frame's local rotations: 23 × (x, y, z, w) in `JOINTS` order, the pelvis's relative to the root. */
  readonly rotations: Float32Array;
  /** Each frame's pelvis, metres, engine axes, on the source body, from the root on the ground. */
  readonly hips: Float32Array;
  /** Each frame's root travel `(x, z)`, metres on the source body; null for a clip that does not travel. */
  readonly root: Float32Array | null;
  /** Format 2's contact intervals (a mirrored bake's on the other side): retarget.ts plants the hands in them. */
  readonly contacts: readonly ClipContact[];
  /** The rest body it was baked on (retarget.ts measures the source's own places on it). */
  readonly rest: RestBody;
}

/* ---- rig space, as readable.ts writes it: [forward, right, up], mm; frames are [F, R, U] ---- */
type V = number[];
type Frame = V[];
type Side = 'L' | 'R';
const SG = { L: -1, R: 1 } as const;
const DG = Math.PI / 180;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => mul(a, 1 / (len(a) || 1));
const wld = (M: Frame, l: V): V => add(add(mul(M[0], l[0]), mul(M[1], l[1])), mul(M[2], l[2]));
const across = (h: V, d: V) => norm(sub(h, mul(d, dot(h, d))));
function fromEuler(a: V): Frame {
  const [y, p, r] = [a[0] * DG, a[1] * DG, -a[2] * DG];
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p), Math.cos(r), Math.sin(r)];
  const rot = ([x, yy, z]: V): V => {
    [yy, z] = [yy * cr - z * sr, yy * sr + z * cr];
    [x, z] = [x * cp + z * sp, -x * sp + z * cp];
    return [x * cy - yy * sy, x * sy + yy * cy, z];
  };
  return [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
}
const compose = (parent: Frame, relative: Frame): Frame => relative.map((axis) => wld(parent, axis));

/** The decode's limb model: the way a limb's middle joint bends at rest, and the rest direction it is carried from. */
const REST_DIR = { arm: (s: number): V => [0.5, s * 0.5, -0.7], leg: (): V => [0.3, 0, -1] };
const BEND = { arm: (s: number): V => [-1, s * 0.5, -0.3], leg: (s: number): V => [1, s * 0.1, 0] };
function hintFor(limb: 'arm' | 'leg', s: number, M: Frame, dLocal: V): V {
  const d = norm(dLocal);
  const r = norm(REST_DIR[limb](s));
  const n0 = across(norm(BEND[limb](s)), r);
  const ax = cross(r, d);
  const sn = len(ax);
  let n = n0;
  if (sn > 1e-9) {
    const k = mul(ax, 1 / sn);
    const a = Math.atan2(sn, dot(r, d));
    n = add(add(mul(n0, Math.cos(a)), mul(cross(k, n0), Math.sin(a))), mul(k, dot(k, n0) * (1 - Math.cos(a))));
  }
  return wld(M, across(n, d));
}
function poleHint(d: V, h: V, deg: number): V {
  const hn = norm(sub(h, mul(d, dot(h, d))));
  return add(mul(hn, Math.cos(deg * DG)), mul(cross(d, hn), Math.sin(deg * DG)));
}
const reachOf = (bend: number, L1: number, L2: number) =>
  Math.sqrt(Math.max(0, L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(bend * DG)));

/** A limb as the decode solves it (`ik3`): its upper and lower bone directions, and its pole. */
function solveLimb(M: Frame, s: Side, kind: 'arm' | 'leg', v: V, L1: number, L2: number) {
  const vn = norm(v);
  const local = [vn[0], vn[1] * SG[s], vn[2]];
  const d = wld(M, mul(local, reachOf(v[3] || 0, L1, L2)));
  const hint = poleHint(norm(d), hintFor(kind, SG[s], M, local), v[4] || 0);
  const [dl, max] = [len(d), L1 + L2 - 0.01];
  const dist = Math.max(Math.min(dl, max), 0.01);
  const n = mul(d, (dl > max ? max / dl : 1) / dist);
  const h0 = sub(hint, mul(n, dot(hint, n)));
  const h = len(h0) < 1e-4 ? [n[1], -n[0], 0] : norm(h0);
  const x = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
  const upper = add(mul(n, x), mul(h, Math.sqrt(Math.max(0, L1 * L1 - x * x))));
  return { d1: norm(upper), d2: norm(sub(mul(n, dist), upper)), h };
}

/* ---- engine space ---- */
/** A rig vector `[forward, right, up]` (times `scale`) in engine axes: x left, y up, z forward. */
export function rigToEngine(v: readonly number[], out = new Vector3(), scale = 1): Vector3 {
  return out.set(-v[1] * scale, v[2] * scale, v[0] * scale);
}
const basis = new Matrix4();
const [ex, ey, ez] = [new Vector3(), new Vector3(), new Vector3()];
/** A rig frame `[F, R, U]` as an engine rotation (identity for the character's own frame). */
export function frameQuaternion(M: readonly (readonly number[])[], out = new Quaternion()): Quaternion {
  basis.makeBasis(ex.set(M[1][1], -M[1][2], -M[1][0]), rigToEngine(M[2], ey), rigToEngine(M[0], ez));
  return out.setFromRotationMatrix(basis).normalize();
}
/** The rotation taking unit `a` to `b` and unit `pa` (⟂ a) to `pb` (⟂ b). */
function turnPair(a: Vector3, pa: Vector3, b: Vector3, pb: Vector3, out: Quaternion): Quaternion {
  basis.makeBasis(ex.copy(a), ey.copy(pa), ez.crossVectors(a, pa));
  const from = tq.setFromRotationMatrix(basis);
  basis.makeBasis(ex.copy(b), ey.copy(pb), ez.crossVectors(b, pb));
  return out.setFromRotationMatrix(basis).multiply(from.invert()).normalize();
}

/** Each limb's canonical bone and pole (engine), and its joints. */
const ARM = { L: new Vector3(1, 0, 0), R: new Vector3(-1, 0, 0), pole: new Vector3(0, 0, -1) };
const LEG = { bone: new Vector3(0, -1, 0), pole: new Vector3(0, 0, 1) };
const [X_AXIS, Y_AXIS, Z_AXIS] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const index = Object.fromEntries(JOINTS.map((name, j) => [name, j])) as Record<JointName, number>;
/** Scratch. */
const W = Array.from({ length: JOINT_COUNT }, () => new Quaternion());
const [qPr, qCr, qHr, qRP, qRC, qRH, qP, qC, qH, tq, tq2] = Array.from({ length: 11 }, () => new Quaternion());
const [va, vb, vc, vd, ve] = Array.from({ length: 5 }, () => new Vector3());

/** `out` = slerp(a, b, t) × rest. */
const shareOf = (a: Quaternion, b: Quaternion, t: number, rest: Quaternion, out: Quaternion) =>
  out.slerpQuaternions(a, b, t).multiply(rest);

/** The arm or leg of side `s`: its upper, middle and end joints' world rotations into `W`. */
function limbFrames(M: Frame, s: Side, kind: 'arm' | 'leg', v: V, R: RestBody, across?: V) {
  const [L1, L2] = kind === 'arm' ? [R.up, R.fore + R.fist] : [R.thigh, R.shin];
  const { d1, d2, h } = solveLimb(M, s, kind, v, L1, L2);
  const [upper, middle] = kind === 'arm' ? [`upperArm${s}`, `forearm${s}`] : [`thigh${s}`, `shin${s}`];
  const [bone, pole] = kind === 'arm' ? [ARM[s], ARM.pole] : [LEG.bone, LEG.pole];
  const parent = W[PARENTS[index[upper as JointName]]];
  // a limb with no direction (its bones fold onto its root) keeps its parent's frame
  if (rigToEngine(d1, va).lengthSq() < 1e-12) va.copy(bone).applyQuaternion(parent);
  rigToEngine(h, vb).addScaledVector(va, -vb.dot(va));
  // a hint along the limb (the decode's fallback): the parent's pole instead
  if (vb.lengthSq() < 1e-12) vb.copy(pole).applyQuaternion(parent).addScaledVector(va, -vb.dot(va));
  if (vb.lengthSq() < 1e-12) vb.crossVectors(va, Math.abs(va.y) < 0.9 ? Y_AXIS : X_AXIS);
  if (rigToEngine(d2, vd).lengthSq() < 1e-12) vd.copy(va);
  // the pole lies on the side the limb bends away from, so the middle joint turns by 0 to π about its hinge: the
  // hint, made square to the upper bone, turns to the other side once the elbow falls behind the shoulder along the
  // line to the hand (a forearm and fist longer than the upper arm, folded past ~130°), which would roll the upper
  // bone half a turn and bend the middle one backward, and contact IK on a build then swings it through
  if (vb.dot(vd) > 0) vb.negate();
  const wu = turnPair(bone, pole, va, vb.normalize(), W[index[upper as JointName]]);
  const axis = vc.crossVectors(va, vb);
  const angle = Math.atan2(ve.crossVectors(va, vd).dot(axis), va.dot(vd));
  const wm = W[index[middle as JointName]].setFromAxisAngle(axis, angle).multiply(wu);
  if (kind === 'leg' || !across) return;
  // the hand: the bone along the forearm, its blade side (+Z) toward `across`; as `across` nears the forearm's line
  // (within ~11.5°), it eases back to the forearm's own roll, so the hand never spins about a line it barely leaves
  const hand = W[index[`hand${s}`]].copy(wm);
  const off = rigToEngine(across, vb).addScaledVector(vd, -vb.dot(vd)).length();
  if (off > 1e-9)
    hand.slerp(turnPair(bone, Z_AXIS, vd, vb.normalize(), tq2), Math.min(1, Math.pow(off / HAND_EASE, 2)));
}

/** How far (the sine of its angle) the hand's across direction leaves the forearm's line before it sets the roll. */
const HAND_EASE = 0.2;

/** A foot or toe: the pelvis frame, turned out by `out` degrees, pitched down by `down`. */
function footFrame(s: Side, out: number, down: number, target: Quaternion) {
  tq2.setFromAxisAngle(Y_AXIS, -SG[s] * out * DG);
  return target
    .copy(qRP)
    .multiply(tq2)
    .multiply(tq.setFromAxisAngle(X_AXIS, down * DG));
}

/**
 * Writes key pose `k`'s joints, rebuilt on rest body `R`, into `rotations` (23 local rotations, from `offset`) and the
 * pelvis into `hips` (metres, engine axes). The frames follow the file comment.
 */
export function keyRotations(R: RestBody, k: KeyPose, rotations: Float32Array, offset = 0, hips = new Vector3()) {
  const RP = fromEuler(k.body as V);
  const RC = compose(RP, fromEuler(k.chest as V));
  const RH = compose(RC, fromEuler(k.head as V));
  frameQuaternion(R.Pr, qPr);
  frameQuaternion(R.Cr, qCr);
  frameQuaternion(R.Hr, qHr);
  qP.copy(frameQuaternion(RP, qRP)).multiply(tq.copy(qPr).invert());
  qC.copy(frameQuaternion(RC, qRC)).multiply(tq.copy(qCr).invert());
  qH.copy(frameQuaternion(RH, qRH)).multiply(tq.copy(qHr).invert());
  W[index.pelvis].copy(qRP);
  const spine = ['spine0', 'spine1', 'spine2', 'chest'] as const;
  spine.forEach((joint, i) => shareOf(qP, qC, R.spineW[i], qPr, W[index[joint]]));
  shareOf(qC, qH, R.neckW, qPr, W[index.neck]);
  W[index.head].copy(qH).multiply(qPr);
  const blade = k.blade ? norm(wld(RC, k.blade)) : null;
  for (const s of ['L', 'R'] as const) {
    // the collarbone: the rest collarbone swung by reach and shrug, in the chest frame
    const sh = k[`sh${s}`] ?? [0, 0];
    const v0 = R.cv[s];
    const L = len(v0);
    const az = Math.atan2(v0[0], v0[1] * SG[s]) + sh[0] * DG;
    const el = Math.asin(v0[2] / L) + sh[1] * DG;
    const swing = [Math.cos(el) * Math.sin(az), SG[s] * Math.cos(el) * Math.cos(az), Math.sin(el)];
    tq2.setFromUnitVectors(rigToEngine(v0, va).normalize(), rigToEngine(swing, vb).normalize());
    W[index[`clavicle${s}`]].copy(qRC).multiply(tq2).multiply(tq.copy(qCr).invert()).multiply(qPr);
    limbFrames(RC, s, 'arm', k[`arm${s}`] as V, R, s === 'R' && blade ? blade : RC[1]);
    limbFrames(RP, s, 'leg', k[`leg${s}`] as V, R);
    const ft = k[`foot${s}`] ?? [0, 0, 0];
    footFrame(s, ft[1], ft[0], W[index[`foot${s}`]]);
    footFrame(s, ft[1], ft[0] - (ft[2] || 0), W[index[`toe${s}`]]);
  }
  for (let j = 0; j < JOINT_COUNT; j++) {
    const local = PARENTS[j] < 0 ? tq.copy(W[j]) : tq.copy(W[PARENTS[j]]).invert().multiply(W[j]);
    local.normalize().toArray(rotations, offset + j * 4);
  }
  return rigToEngine(k.hips as V, hips, R.H0 / 100_000);
}

/**
 * The frame times of a clip `duration` seconds long: every 1/30 s from 0, format 1's key grid (a key's `t` is its
 * frame's time to the millisecond; v1 sampled its clips there too), and a last frame at `duration`, which a grid frame
 * less than a millisecond before it gives way to. So every key falls on a frame, even in a clip whose length is off
 * the grid (most of mesh2motion's), and three.js's keyframe tracks take the shorter last step as they come.
 */
export function bakeTimes(duration: number): Float32Array {
  const grid = Math.max(1, Math.ceil((duration - 1e-3) * BAKE_FPS));
  const times = new Float32Array(grid + 1);
  for (let i = 0; i < grid; i++) times[i] = i / BAKE_FPS;
  times[grid] = duration;
  return times;
}

/** Bakes `clip` on its source's rest body `R` (see the file comment). */
export function bakeClip(clip: Clip, R: RestBody, name = clip.clip ?? ''): BakedClip {
  const duration = clip.dur || clip.keys[clip.keys.length - 1].t;
  const times = bakeTimes(duration);
  const frames = times.length;
  const rotations = new Float32Array(frames * JOINT_COUNT * 4);
  const hips = new Float32Array(frames * 3);
  const travels = !!clip.keys[0].root;
  const root = travels ? new Float32Array(frames * 2) : null;
  const straight = { ...clip, loop: false }; // a loop's travel runs on to its end, never back to its start
  const pelvis = new Vector3();
  for (let i = 0; i < frames; i++) {
    const t = i < frames - 1 ? i / BAKE_FPS : duration;
    keyRotations(R, keyAt(clip, t), rotations, i * JOINT_COUNT * 4, pelvis).toArray(hips, i * 3);
    if (i > 0) keepSigns(rotations, i);
    const move = travels ? moveAt(R, straight, t) : null;
    if (move && root) [root[i * 2], root[i * 2 + 1]] = [-move[1] / 1000, move[0] / 1000];
  }
  const loop = !!clip.loop;
  return { name, duration, loop, frames, times, rotations, hips, root, contacts: clip.contacts ?? [], rest: R };
}

/** Turns frame `i`'s rotations to the same side of the sphere as frame `i − 1`'s, joint by joint. */
function keepSigns(rotations: Float32Array, i: number): void {
  const [a, b] = [(i - 1) * JOINT_COUNT * 4, i * JOINT_COUNT * 4];
  for (let j = 0; j < JOINT_COUNT * 4; j += 4) {
    const d = rotations[a + j] * rotations[b + j] + rotations[a + j + 1] * rotations[b + j + 1];
    if (d + rotations[a + j + 2] * rotations[b + j + 2] + rotations[a + j + 3] * rotations[b + j + 3] < 0) {
      for (let c = 0; c < 4; c++) rotations[b + j + c] = -rotations[b + j + c];
    }
  }
}

/**
 * Where time `t` falls in `baked`: the frame before, the share toward the next (loops wrap, one-shots hold), looked up
 * in `baked.times` as three.js's interpolants do, so the last, shorter step is timed as the mixer times it.
 */
export function frameAt(baked: BakedClip, t: number): [frame: number, share: number] {
  const { duration: d, times } = baked;
  const tt = baked.loop && d > 0 ? ((t % d) + d) % d : Math.min(Math.max(0, t), d);
  let [lo, hi] = [0, times.length - 1];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const step = times[hi] - times[lo];
  return [lo, step > 0 ? Math.min(1, Math.max(0, (tt - times[lo]) / step)) : 0];
}

/** The flat quaternion slerp three.js's mixer interpolates with (typed arrays, as its interpolants pass them). */
const slerpFlat = (
  Quaternion as unknown as {
    slerpFlat(
      d: Float32Array | Float64Array,
      o: number,
      a: Float32Array,
      ao: number,
      b: Float32Array,
      bo: number,
      t: number,
    ): void;
  }
).slerpFlat;

/**
 * Samples `baked` at `t` seconds: its 23 local rotations into `rotations` (slerped between frames, as three.js's
 * mixer does) and its pelvis into `hips` (lerped). Loops wrap; one-shots hold.
 */
export function sampleBaked(baked: BakedClip, t: number, rotations: Float32Array | Float64Array, hips: Vector3): void {
  const [i, u] = frameAt(baked, t);
  const [a, b] = [i * JOINT_COUNT * 4, (i + 1) * JOINT_COUNT * 4];
  for (let j = 0; j < JOINT_COUNT * 4; j += 4)
    slerpFlat(rotations, j, baked.rotations, a + j, baked.rotations, b + j, u);
  const lerp = (src: Float32Array, n: number, k: number) =>
    src[i * n + k] + (src[(i + 1) * n + k] - src[i * n + k]) * u;
  hips.set(lerp(baked.hips, 3, 0), lerp(baked.hips, 3, 1), lerp(baked.hips, 3, 2));
}

/** How far `baked` has carried the root by `t` seconds, `(x, z)` metres on the source body (a loop's laps added). */
export function travelAt(baked: BakedClip, t: number, out = new Vector3()): Vector3 {
  const root = baked.root;
  if (!root) return out.set(0, 0, 0);
  const n = baked.frames - 1;
  const laps = baked.loop && baked.duration > 0 ? Math.floor(t / baked.duration) : 0;
  const [i, u] = frameAt(baked, t);
  const at = (k: number) => root[i * 2 + k] + (root[(i + 1) * 2 + k] - root[i * 2 + k]) * u;
  return out.set(at(0) + laps * (root[n * 2] - root[0]), 0, at(1) + laps * (root[n * 2 + 1] - root[1]));
}
