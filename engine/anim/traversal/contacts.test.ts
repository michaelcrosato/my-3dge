/**
 * @file Unit tests for the traversal contacts (engine/anim/traversal/contacts.ts, PLAN.md WP 13.11): the hands on a
 * lip and how long they hold it (a grab, a pull, a vault, a hurdle), a ladder's limbs on its rungs climbing two at a
 * move and never past the top, a wall-climb's cycle and its holds on the wall, the hands on a zipline's cable over the
 * feet, and the hull and ride read from plain components.
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from '../../core/math';
import {
  cableGrips,
  climbCycle,
  climbHoldHeight,
  hullOf,
  ladderLimb,
  lowPull,
  mantleGrips,
  mantleHold,
  mantleShare,
  rideOf,
  TRAVERSAL,
  wallPoint,
  type Limb,
} from './contacts';

const pair = (): [Vector3, Vector3] => [new Vector3(), new Vector3()];
const hull = { radius: 0.41, skin: 0.01, hang: 2.032, rung: 0.3 };
/** A 2 m lip at z 1, its wall's face toward −Z: the body faces +Z. */
const lip = { mode: 'mantle', lipX: 0, lipY: 2, lipZ: 1, wallX: 0, wallZ: -1 } as const;

describe('a mantle’s hands on the lip', () => {
  it('puts them the given width apart along the edge, a palm over its top, the right one on the body’s right', () => {
    const [left, right] = mantleGrips(lip, 0.4, pair());
    expect(right.toArray()).toEqual([-0.2, 2 + TRAVERSAL.palm, 1]); // facing +Z, the right is −X
    expect(left.toArray()).toEqual([0.2, 2 + TRAVERSAL.palm, 1]);
  });

  it('holds the whole grab and hang, lets go through the pull, vaults one-handed, hurdles a low one', () => {
    const at = (mantle: string, left: number, total: number, fromY: number) => ({ ...lip, mantle, mantleLeft: left, mantleTotal: total, fromY }); // prettier-ignore
    expect(mantleShare(at('grab', 27, 27, 0))).toBe(0);
    expect(mantleHold(at('grab', 10, 27, 0), false, 1.48)).toEqual([1, 1]);
    expect(mantleHold(at('hang', 10, 27, 0), false, 1.48)).toEqual([1, 1]);
    const pull = (left: number) => mantleHold(at('pull', left, 18, 2.02), false, 1.48);
    expect(pull(18)).toEqual([1, 1]); // the grab ended with the feet up on the lip: a pull after it
    expect(pull(9)[0]).toBeGreaterThan(0);
    expect(pull(9)[0]).toBeLessThan(1);
    expect(pull(0)).toEqual([0, 0]);
    const low = { ...lip, lipY: 1, mantle: 'pull', mantleLeft: 13, mantleTotal: 18, fromY: 0 };
    expect(lowPull(low)).toBe(true);
    expect(mantleHold(low, true, 1.48)).toEqual([1, 0]); // vaulted: the left hand alone
    expect(mantleHold(low, false, 1.48)).toEqual([1, 1]);
    expect(mantleHold({ ...low, lipY: 0.6 }, true, 1.48)).toEqual([0, 0]); // under half the shoulders: hurdled
  });
});

describe('a ladder’s limbs on its rungs', () => {
  const ladder = { foot: [2, 0, 5], top: 4, normal: [0, -1], width: 0.6 };
  const rungs = (y: number) => Math.round((y - ladder.foot[1]) / hull.rung);
  it('holds each limb on a rung, a hand’s grip on its line and a foot standing on it', () => {
    const out = new Vector3();
    for (const limb of [0, 1, 2, 3] as Limb[]) {
      for (let h = 0; h < 2.5; h += 0.05) {
        if (!ladderLimb(ladder, hull.rung, limb, new Vector3(2, h, 4.49), 1.48, out)) continue;
        if (limb >= 2 && out.y === 0) continue; // the ground under the body
        const lift = limb < 2 ? 0 : 0.02;
        expect(Math.abs(out.y - lift - rungs(out.y - lift) * hull.rung)).toBeLessThan(1e-9); // on rung k
        expect(Math.abs(out.x - ladder.foot[0])).toBeCloseTo(TRAVERSAL.ladderGrip[limb < 2 ? 0 : 1], 9);
      }
    }
  });

  it('moves the right hand with the left foot, each two rungs at a move, arcing out, the hands never past the top', () => {
    const [hand, foot, out] = [new Vector3(), new Vector3(), new Vector3()];
    const at = (h: number) => new Vector3(2, h, 4.49);
    for (let h = 0; h < 3; h += 0.01) expect(ladderLimb(ladder, hull.rung, 1, at(h), 1.48, hand)).toBe(ladderLimb(ladder, hull.rung, 2, at(h), 1.48, foot)); // prettier-ignore
    const held: number[] = [];
    for (let h = 0; h < 2.4; h += 0.01)
      if (ladderLimb(ladder, hull.rung, 2, at(h), 1.48, out)) held.push(rungs(out.y - 0.02));
    expect([...new Set(held)].slice(1, 4).map((r, i, all) => (i ? r - all[i - 1] : 2))).toEqual([2, 2, 2]);
    expect(ladderLimb(ladder, hull.rung, 0, at(0.42), 1.48, out)).toBe(false); // the left hand moving at 0.42 m
    expect(out.z).toBeLessThan(ladder.foot[2]); // out from the rungs, toward the climber (−Z)
    const top = Math.ceil((ladder.top - ladder.foot[1] + 0.2) / hull.rung) - 1;
    for (let h = 0; h < 6; h += 0.05) {
      ladderLimb(ladder, hull.rung, 1, at(h), 1.48, out);
      expect(rungs(out.y)).toBeLessThanOrEqual(top);
    }
  });
});

describe('a wall-climb', () => {
  it('moves each hand once a cycle, the holds a cycle apart, the right hand half a cycle after the left', () => {
    expect(climbCycle(1, 0)).toEqual({ n: 0, held: false, s: 0 }); // the right hand starts moving
    expect(climbCycle(0, 0).held).toBe(true); // the left holds
    expect(climbCycle(1, 0.5 * TRAVERSAL.climbStep)).toMatchObject({ n: 0, held: true, s: 1 });
    expect(climbHoldHeight(0, 1, 1.48) - climbHoldHeight(0, 0, 1.48)).toBeCloseTo(TRAVERSAL.climbStep, 9);
    expect(climbHoldHeight(1, 0, 1.48) - climbHoldHeight(0, 0, 1.48)).toBeCloseTo(-0.5 * TRAVERSAL.climbStep, 9);
  });

  it('puts a hold on the wall a skin off the hull’s front, out by a palm, to the limb’s side', () => {
    const feet = new Vector3(3, 1, 4);
    const right = wallPoint(feet, [0, -1], hull, 1, 2.5, new Vector3()); // the wall toward +Z
    expect(right.z).toBeCloseTo(4 + hull.radius + hull.skin - TRAVERSAL.palm, 9);
    expect(right.x).toBeCloseTo(3 - TRAVERSAL.climbGrip[0], 9);
    expect(right.y).toBe(2.5);
  });
});

describe('a zipline', () => {
  it('holds the cable over the feet, the right hand ahead along the ride and the left as far behind', () => {
    const ride = { zipline: { from: [0, 6, 0], to: [0, 6, 10] } };
    const [left, right] = cableGrips({ mode: 'zipline', rideDir: -1 }, ride, hull, new Vector3(0, 3.968, 4), pair());
    expect(right.toArray().map((x) => +x.toFixed(9))).toEqual([0, 6, 4 - TRAVERSAL.cable]); // riding toward `from`
    expect(left.z).toBeCloseTo(4 + TRAVERSAL.cable, 9);
  });

  it('reads the hull and the ride from plain components', () => {
    expect(hullOf({ capsule: { radius: 0.3 }, offset: 0.02, movement: { zipline: { hang: 1.9 } } }, 0.25)).toEqual({ radius: 0.3, skin: 0.02, hang: 1.9, rung: 0.25 }); // prettier-ignore
    expect(hullOf(undefined, 0.3)).toEqual(hull);
    expect(rideOf({ ladder: { foot: [0, 0, 0], top: 3, normal: [0, 1], width: 0.6 } })?.ladder?.top).toBe(3);
    expect(rideOf({ actor: {} })).toBeNull();
  });
});
