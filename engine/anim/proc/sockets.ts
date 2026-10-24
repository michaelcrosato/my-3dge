/**
 * @file Extras on sockets (PLAN.md WP 10.1, §5.6's joint-attached extras): what a rig hangs on its joints that is not
 * its body: horns, spikes, a blade in a hand, egg sacs, a lamp. A `Socket` names a joint of the rig's pose (a key of
 * its joints, each a world matrix or a point) and where on it the extra sits: `at` in the joint's frame, turned by
 * `turn` (Euler angles, rad, XYZ) and sized by `scale`. `socketMatrix(joints, socket)` is the extra's world matrix
 * (a point joint lends its position and the world's axes); `placeExtras(joints, sockets)` places them all by name.
 * `along(points, t)` is the point `t` of the way along a polyline by its length, and `alongDirection` the way it
 * runs there, for extras spread down a back or a tail (spines, plates, a crest).
 *
 * Invariants: pure; a socket on a joint the pose lacks throws `ANIM_SOCKET_JOINT`, naming the joints it has.
 *
 * Carried from `my-3d2dge:src/emberdeep/36-bosses.js:63-68, 612-631` (the bosses' extras placed from their rig's
 * joints: back spikes, stitches, boils) and shardfall@fa2dab6 `crates/pav_core/src/parts.rs:65-230` (`attach`, its
 * parts sampled along the back's polyline), as mechanisms; the sources' depth passes are the depth buffer's here.
 *
 * @example
 * import { Matrix4, Vector3 } from '../../core/math';
 * const joints = { hand: new Matrix4().makeTranslation(0.3, 1, 0), tail: new Vector3(0, 0.5, -0.4) };
 * const blade = socketMatrix(joints, { on: 'hand', at: [0, 0, 0.1] });
 * new Vector3().setFromMatrixPosition(blade).z; // 0.1: in the hand, ahead of its grip
 * along([new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 1)], 0.75).x; // 0.5: three quarters along
 * @see engine/anim/proc/sockets.test.ts
 */
import { codeError, defineCodes, didYouMean } from '../../core/log';
import { Euler, Matrix4, Quaternion, Vector3 } from '../../core/math';

/** The codes this module raises, with their fixes. */
export const SOCKET_CODES = defineCodes('anim', {
  ANIM_SOCKET_JOINT: {
    template: 'the socket names the joint {name}, which the rig’s pose lacks{suggestion}; it has {joints}',
    fix: 'name one of the pose’s joints in the socket’s `on`',
    doc: 'Raised by `socketMatrix` (engine/anim/proc/sockets.ts) for a socket on a joint the pose does not have.',
  },
});

/** Where an extra sits on a joint (see the file comment). */
export interface Socket {
  /** The joint it rides: a key of the pose's joints. */
  readonly on: string;
  /** Its place in the joint's frame, m. */
  readonly at?: readonly [number, number, number];
  /** Its turn in the joint's frame, Euler angles XYZ, rad. */
  readonly turn?: readonly [number, number, number];
  /** Its size: one number for all three axes, or each. */
  readonly scale?: number | readonly [number, number, number];
}

/** A rig's pose as sockets read it: each joint a world matrix or a point. */
export type SocketJoints = Readonly<Record<string, Matrix4 | Vector3>>;

const [position, size] = [new Vector3(), new Vector3()];
const [rotation, euler, local, placed] = [new Quaternion(), new Euler(), new Matrix4(), new Matrix4()];

/** The world matrix of the extra `socket` places on `joints` (see the file comment). */
export function socketMatrix(joints: SocketJoints, socket: Socket, out = new Matrix4()): Matrix4 {
  const joint = joints[socket.on];
  if (!joint) {
    const names = Object.keys(joints);
    throw codeError('ANIM_SOCKET_JOINT', { name: JSON.stringify(socket.on), suggestion: didYouMean(socket.on, names), joints: names.join(', ') }); // prettier-ignore
  }
  const at = socket.at ?? [0, 0, 0];
  const turn = socket.turn ?? [0, 0, 0];
  const scale = typeof socket.scale === 'number' ? [socket.scale, socket.scale, socket.scale] : (socket.scale ?? [1, 1, 1]); // prettier-ignore
  rotation.setFromEuler(euler.set(turn[0], turn[1], turn[2], 'XYZ'));
  local.compose(position.set(at[0], at[1], at[2]), rotation, size.set(scale[0], scale[1], scale[2]));
  if (joint instanceof Vector3) return out.multiplyMatrices(placed.makeTranslation(joint.x, joint.y, joint.z), local);
  return out.multiplyMatrices(joint, local);
}

/** Every extra of `sockets` placed on `joints`, by name. */
export function placeExtras<K extends string>(
  joints: SocketJoints,
  sockets: Readonly<Record<K, Socket>>,
): Record<K, Matrix4> {
  return Object.fromEntries(Object.entries<Socket>(sockets).map(([name, socket]) => [name, socketMatrix(joints, socket)])) as Record<K, Matrix4>; // prettier-ignore
}

/** The point `t` (0 to 1) of the way along the polyline `points` by its length, into `out`. */
export function along(points: readonly Vector3[], t: number, out = new Vector3()): Vector3 {
  if (points.length < 2) return out.copy(points[0] ?? out.set(0, 0, 0));
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  let want = Math.max(0, Math.min(1, t)) * lengths.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (want <= lengths[i] || i === lengths.length - 1) {
      return out.lerpVectors(points[i], points[i + 1], lengths[i] > 0 ? Math.min(1, want / lengths[i]) : 0);
    }
    want -= lengths[i];
  }
  return out.copy(points[points.length - 1]);
}

/** The way the polyline `points` runs `t` of the way along it (unit), into `out`. */
export function alongDirection(points: readonly Vector3[], t: number, out = new Vector3()): Vector3 {
  const [a, b] = [along(points, Math.max(0, t - 0.01), new Vector3()), along(points, Math.min(1, t + 0.01), new Vector3())]; // prettier-ignore
  return out.subVectors(b, a).normalize();
}
