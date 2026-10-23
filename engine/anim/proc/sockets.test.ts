/**
 * @file Unit tests for extras on sockets (engine/anim/proc/sockets.ts, PLAN.md WP 10.1): an extra placed in its
 * joint's frame, turned and sized; on a point joint, the world's axes; all of a rig's extras by name; a socket on a
 * joint the pose lacks refused with the joints it has; points and directions along a polyline by its length.
 * @see engine/anim/proc/sockets.ts
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from '../../core/math';
import { along, alongDirection, placeExtras, socketMatrix } from './sockets';

const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // facing +X
const JOINTS = { hand: new Matrix4().compose(new Vector3(0.3, 1, 0), turned, new Vector3(1, 1, 1)), tail: new Vector3(0, 0.5, -0.4) }; // prettier-ignore
const at = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);

describe('extras on sockets', () => {
  it('places an extra in its joint’s frame, turned and sized, and on a point joint in the world’s axes', () => {
    const blade = socketMatrix(JOINTS, { on: 'hand', at: [0, 0, 0.1], turn: [0, 0, Math.PI / 2], scale: 2 });
    expect(at(blade).distanceTo(new Vector3(0.4, 1, 0))).toBeLessThan(1e-12); // 0.1 along the hand's +Z: world +X
    expect(new Vector3(0, 1, 0).transformDirection(blade).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-12); // its up rolled onto the hand's left
    expect(new Vector3().setFromMatrixScale(blade).x).toBeCloseTo(2, 12);
    const spike = socketMatrix(JOINTS, { on: 'tail', at: [0, 0.1, 0] });
    expect(at(spike).distanceTo(new Vector3(0, 0.6, -0.4))).toBeLessThan(1e-12);
    const all = placeExtras(JOINTS, { blade: { on: 'hand' }, spike: { on: 'tail' } });
    expect(Object.keys(all)).toEqual(['blade', 'spike']);
    expect(() => socketMatrix(JOINTS, { on: 'hnad' })).toThrow(
      /\[ANIM_SOCKET_JOINT\].*did you mean "hand".*it has hand, tail/,
    );
  });

  it('finds points and directions along a polyline by its length', () => {
    const back = [new Vector3(0, 0, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 1)];
    expect(along(back, 0).toArray()).toEqual([0, 0, 0]);
    expect(along(back, 0.25).toArray()).toEqual([0, 0, 0.5]);
    expect(along(back, 0.75).toArray()).toEqual([0.5, 0, 1]);
    expect(along(back, 2).toArray()).toEqual([1, 0, 1]); // clamped
    expect(alongDirection(back, 0.25).toArray()).toEqual([0, 0, 1]);
    expect(alongDirection(back, 0.8).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-12);
    expect(along([new Vector3(2, 3, 4)], 0.5).toArray()).toEqual([2, 3, 4]); // one point
  });
});
