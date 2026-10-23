/**
 * @file Unit tests for the digitigrade leg (engine/anim/proc/digitigrade.ts, PLAN.md WP 10.1): its three bones keep
 * their lengths; the long foot stands its angle back from upright, the hock behind and above the toe, the knee bent
 * forward; a crouch's larger angle lowers the hock; out of reach the toe comes up with the hock; a turned frame turns
 * the solve with it.
 * @see engine/anim/proc/digitigrade.ts
 */
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from '../../core/math';
import { digitigrade } from './digitigrade';

const LEG = { thigh: 0.32, shin: 0.36, foot: 0.22 };
const FORWARD = new Vector3(0, 0, 1);
const HIP = new Vector3(0, 0.75, 0);

describe('the digitigrade leg', () => {
  it('keeps its bones, its long foot at its angle behind and above the toe, its knee bent forward', () => {
    const toe = new Vector3(0, 0, 0.1);
    const { knee, hock, toe: end } = digitigrade(HIP, toe, LEG, { forward: FORWARD }, 0.6);
    expect([knee.distanceTo(HIP), hock.distanceTo(knee), end.distanceTo(hock)]).toEqual([LEG.thigh, LEG.shin, LEG.foot].map((v) => expect.closeTo(v, 9))); // prettier-ignore
    expect(end.distanceTo(toe)).toBeLessThan(1e-12); // in reach: on the toe
    expect([hock.z, hock.y]).toEqual([expect.closeTo(0.1 - LEG.foot * Math.sin(0.6), 12), expect.closeTo(LEG.foot * Math.cos(0.6), 12)]); // prettier-ignore
    const mid = (HIP.z + hock.z) / 2;
    expect(knee.z).toBeGreaterThan(mid + 0.05); // forward of the hip–hock line: the hock bends back
    const low = digitigrade(HIP, toe, LEG, { forward: FORWARD }, 0.96); // a crouch's 55°
    expect(low.hock.y).toBeLessThan(hock.y);
  });

  it('lifts the toe with the hock out of reach, the long foot keeping its length', () => {
    const far = new Vector3(0, -0.5, 0.2); // below the floor of its reach
    const { hock, toe } = digitigrade(HIP, far, LEG, { forward: FORWARD }, 0.6);
    expect(hock.distanceTo(HIP)).toBeCloseTo(LEG.thigh + LEG.shin, 2); // straight
    expect(toe.distanceTo(hock)).toBeCloseTo(LEG.foot, 12);
    expect(toe.y).toBeGreaterThan(far.y + 0.05); // up off where it was sent
  });

  it('turns with its frame', () => {
    const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.1);
    const toe = new Vector3(0.05, 0, 0.12);
    const straight = digitigrade(HIP, toe, LEG, { forward: FORWARD }, 0.6);
    const knee = straight.knee.clone().applyQuaternion(turn);
    const turned = digitigrade(HIP.clone().applyQuaternion(turn), toe.clone().applyQuaternion(turn), LEG, { forward: FORWARD.clone().applyQuaternion(turn) }, 0.6); // prettier-ignore
    expect(turned.knee.distanceTo(knee)).toBeLessThan(1e-9);
  });
});
