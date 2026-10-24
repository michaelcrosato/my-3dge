/**
 * @file Unit tests for the quadruped rig (engine/anim/quadruped.ts, PLAN.md WP 13.21): it trots on its diagonals, its
 * planted paws still and on the gait's feet from a walk to 6 m/s (within 6 mm as it starts); it sits, its rump on the
 * ground, its stifles forward, its tail along the ground and its paws where they stood, and stands again; it stands
 * from its first step even told it is aloft, then tucks its feet; its head turns toward what it looks at within its
 * bounds and looks about only while it stands; its tail wags only when told, its links keeping their length; and its
 * state, as plain data through JSON, poses and steps on alike.
 * @see engine/anim/quadruped.ts
 */
import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from '../core/math';
import { GAIT_FOOT } from './proc/gait';
import { Quadruped, QUADRUPED, QUADRUPED_LEGS, type QuadrupedInput } from './quadruped';

/**
 * Steps `dog` `steps` times at `speed` m/s along +Z (with `input`) from where it is, speeding up at `speedUp` m/s² (at
 * once by default), calling `each` after every step with its index.
 */
function trot(
  dog: Quadruped,
  speed: number,
  steps: number,
  input: QuadrupedInput = {},
  each = (_: number) => {},
  speedUp = Infinity,
) {
  // prettier-ignore
  for (let i = 0; i < steps; i++) {
    const velocity = new Vector3(0, 0, Math.min(speed, (i + 1) * dog.dt * speedUp));
    dog.step({ ...input, position: dog.position.clone().addScaledVector(velocity, dog.dt), velocity });
    each(i);
  }
}
const lengthOf = (bone: Matrix4) => new Vector3().setFromMatrixColumn(bone, 1).length();
const heightOf = (bone: Matrix4, end: number) => new Vector3(0, end, 0).applyMatrix4(bone).y;
const footOf = (dog: Quadruped, i: number) => new Vector3().fromArray(dog.state.gait.feet, i * GAIT_FOOT);
const tOf = (dog: Quadruped, i: number) => dog.state.gait.feet[i * GAIT_FOOT + 12];

describe('the quadruped', () => {
  it('trots on its diagonals, its planted paws still and on their feet from a walk to 6 m/s (within 6 mm as it starts)', () => {
    for (const speed of [1.2, 3, 6]) {
      const dog = new Quadruped();
      const was: (Vector3 | null)[] = [null, null, null, null];
      let [most, falls] = [0, 0];
      const each = (step: number) => {
        const up = QUADRUPED_LEGS.flatMap((leg, i) => (tOf(dog, i) >= 0 ? [leg.group] : []));
        expect(new Set(up).size).toBeLessThanOrEqual(1); // one diagonal in the air at a time
        most = Math.max(most, up.length);
        const J = dog.pose();
        for (let i = 0; i < 4; i++) {
          if (tOf(dog, i) >= 0) {
            was[i] = null;
            continue;
          }
          const reach = step < 40 ? 0.006 : 1e-9; // starting, a hind paw may lift 5 mm out of its leg’s reach
          expect(J.paws[i].distanceTo(footOf(dog, i))).toBeLessThan(reach); // in reach: the paw on its foot
          if (was[i])
            expect(J.paws[i].distanceTo(was[i]!)).toBeLessThan(reach); // still while planted
          else falls++;
          was[i] = J.paws[i].clone();
        }
      };
      trot(dog, speed, 180, {}, each, 15); // speeding up at 15 m/s²
      expect(most).toBe(2);
      expect(falls).toBeGreaterThan(8);
    }
  });

  it('sits, its rump on the ground, its stifles forward, its tail along the ground and its paws where they stood', () => {
    const dog = new Quadruped();
    trot(dog, 1.2, 60);
    trot(dog, 0, 60);
    const standing = dog.pose().paws.map((paw) => paw.clone());
    const rump = (d: Quadruped) => new Vector3().setFromMatrixPosition(d.pose().rump).y;
    const high = rump(dog);
    expect(high).toBeCloseTo(new Vector3(...QUADRUPED.rump.at).applyMatrix4(dog.pose().torso).y, 9); // on the torso
    trot(dog, 0, 45, { sit: true });
    expect(dog.state.sit).toBeGreaterThan(0.99);
    expect(rump(dog)).toBeCloseTo(QUADRUPED.rump.radius, 3); // resting on the ground
    const J = dog.pose();
    J.paws.forEach((paw, i) => expect(paw.distanceTo(standing[i])).toBeLessThan(1e-9));
    for (const leg of ['hl0', 'hl1', 'hl2', 'hr0', 'hr1', 'hr2'] as const) {
      expect(Math.min(heightOf(J[leg], -0.5), heightOf(J[leg], 0.5))).toBeGreaterThanOrEqual(0); // off the ground
    }
    for (const thigh of [J.hl0, J.hr0]) {
      const [hip, stifle] = [new Vector3(0, -0.5, 0).applyMatrix4(thigh), new Vector3(0, 0.5, 0).applyMatrix4(thigh)];
      expect(stifle.z - hip.z).toBeGreaterThan(0.05); // forward of the hip (it faces +Z), as a dog's
      expect(stifle.y).toBeGreaterThan(0.05); // a thigh's thickness off the ground
    }
    for (const link of [J.tail0, J.tail1, J.tail2]) expect(heightOf(link, 0.5)).toBeGreaterThanOrEqual(QUADRUPED.tail.rest - 1e-9); // prettier-ignore
    expect(heightOf(J.tail2, 0.5)).toBeCloseTo(QUADRUPED.tail.rest, 6); // lying along the ground behind it
    trot(dog, 0, 45);
    expect(dog.state.sit).toBeLessThan(0.01);
    expect(rump(dog)).toBeCloseTo(high, 2);
  });

  it('stands on its feet from its first step, told it is aloft or not; then aloft, it tucks them', () => {
    const dog = new Quadruped({ yaw: 1 });
    dog.step({ position: new Vector3(2, 0, 3), air: true }); // an actor's first tick: no ground under it yet
    expect(dog.state.gait.placed).toBe(true);
    dog.pose().paws.forEach((paw) => expect(paw.y).toBeCloseTo(0, 9));
    for (let i = 0; i < 20; i++) dog.step({ position: new Vector3(2, 0.5, 3), air: true });
    dog.pose().paws.forEach((paw) => expect(paw.y).toBeGreaterThan(0.5)); // under it, off the ground
  });

  it('turns its head toward what it looks at within its bounds, and looks about only while it stands', () => {
    const dog = new Quadruped();
    trot(dog, 0, 60, { look: new Vector3(3, 0.6, 3) }); // ahead and to its left, about its head's height
    expect(dog.state.headYaw).toBeCloseTo(Math.atan2(3, 3 - QUADRUPED.head.at[2]), 2); // from its head, ahead of it
    trot(dog, 0, 60, { look: new Vector3(0, 0.6, -3) }); // behind it: as far as its neck turns
    expect(Math.abs(dog.state.headYaw)).toBeCloseTo(QUADRUPED.look.yaw, 2);
    trot(dog, 0, 60, { look: new Vector3(0, 5, 0.5) }); // above it
    expect(dog.state.headPitch).toBeCloseTo(QUADRUPED.look.pitch, 2);
    const about = new Set<number>();
    trot(dog, 0, 120, {}, () => about.add(Math.round(dog.state.headYaw * 100)));
    expect(about.size).toBeGreaterThan(20); // looking about
    trot(dog, 2, 60);
    expect(Math.abs(dog.state.headYaw)).toBeLessThan(0.02); // a walk looks ahead
  });

  it('wags its tail only when told, its links keeping their length', () => {
    const dog = new Quadruped();
    const tip = () => new Vector3(0, 0.5, 0).applyMatrix4(dog.pose().tail2).x;
    const sway = (wag: number) => {
      let [low, high] = [Infinity, -Infinity];
      trot(dog, 0, 90, { wag }, () => ([low, high] = [Math.min(low, tip()), Math.max(high, tip())]));
      return high - low;
    };
    expect(sway(0)).toBeLessThan(0.005);
    expect(sway(1)).toBeGreaterThan(0.15);
    for (const link of ['tail0', 'tail1', 'tail2'] as const) {
      expect(lengthOf(dog.pose()[link])).toBeCloseTo(QUADRUPED.tail.length / QUADRUPED.tail.links, 9);
    }
  });

  it('keeps its state as plain data: loaded through JSON into another, it poses and steps on alike', () => {
    const dog = new Quadruped({ yaw: 0.4 });
    trot(dog, 2.5, 47, { wag: 0.6, look: new Vector3(2, 1, 4) });
    const copy = new Quadruped();
    copy.state = JSON.parse(JSON.stringify(dog.state));
    copy.position.copy(dog.position);
    const numbers = (d: Quadruped) => {
      const J = d.pose();
      return [J.torso, J.head, J.neck, J.fl1, J.hr2, J.tail2].flatMap((m) => [...m.elements]).concat(J.mouth.toArray());
    };
    expect(numbers(copy)).toEqual(numbers(dog));
    for (const d of [dog, copy]) trot(d, 1, 30, { sit: true });
    expect(copy.state).toEqual(dog.state);
    expect(numbers(copy)).toEqual(numbers(dog));
  });
});
