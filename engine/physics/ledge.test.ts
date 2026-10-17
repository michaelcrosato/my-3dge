/**
 * @file Unit tests for walls and ledges (engine/physics/ledge.ts), with `movement:apex`'s hull on a flat floor: a block
 * ahead is a wall, its normal out of it, and a ramp it walks up is none; a 1.5 m block is a ledge 1.5 m up, its lip
 * on the block's near face, its landing on the top, its rise column against the face and its drop the floor's; a block
 * past the reach, a step it walks up, a wall with no top in reach, a ceiling over the character and nothing ahead are
 * none; a top under a low roof takes only the crouched hull; the path goes to the wall, up past the lip, across and
 * down onto the landing.
 * @see engine/physics/ledge.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter } from './character';
import { findLedge, findWall, ledgePath } from './ledge';
import { createPhysics } from './world';

const apex = createCharacter({ movement: 'movement:apex' });
const SEARCH = { reach: 2.03, crouched: 1.1938 - 2 * apex.capsule.radius };

/** A box `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** The character at the origin on a floor, beside `extra` bodies, stepped once so the queries see them. */
function world(...extra: object[]) {
  const physics = createPhysics();
  physics.addBody(box([40, 1, 40], [0, -0.5, 0]));
  for (const body of extra) physics.addBody(body as ReturnType<typeof box>);
  const body = addCharacter(physics, apex, [0, 0, 0]);
  physics.step({ dt: 1 / 60, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } });
  return { physics, body };
}

/** The ledge east of the character, among `extra` boxes. */
function ledgeEast(...extra: ReturnType<typeof box>[]) {
  const { physics, body } = world(...extra);
  const wall = findWall(physics, body, apex, [1, 0], 0.61);
  return wall && findLedge(physics, body, apex, wall, SEARCH);
}

describe('walls and ledges', () => {
  it('find a wall ahead within the probe, its normal out of it, and no wall at a ramp it walks up', () => {
    const { physics, body } = world(box([2, 3, 4], [1.5, 1.5, 0])); // its near face at x = 0.5
    const wall = findWall(physics, body, apex, [1, 0], 0.61);
    expect(wall?.normal[0]).toBeCloseTo(-1, 6);
    expect(wall?.point[0]).toBeCloseTo(0.5, 2);
    expect(wall?.up).toBeCloseTo(0, 3); // the cast's normal, a float32
    expect(findWall(physics, body, apex, [1, 0], 0.05)).toBeNull(); // the probe ends short of it
    const slope = { type: 'fixed' as const, rotation: [0, 0, Math.sin(Math.PI / 16), Math.cos(Math.PI / 16)] as const, colliders: [{ shape: { type: 'box' as const, size: [4, 0.2, 4] as [number, number, number] } }], position: [1, 0, 0] as const }; // prettier-ignore
    const ramp = world(slope);
    expect(findWall(ramp.physics, ramp.body, apex, [1, 0], 0.61)).toBeNull(); // 22.5°: walkable
  });

  it('find a block ahead: its height, its lip on the near face, its landing on the top, its rise and its drop', () => {
    const ledge = ledgeEast(box([2, 1.5, 4], [1.5, 0.75, 0]));
    expect(ledge?.height).toBeCloseTo(1.495, 3); // the feet stand 5 mm up
    expect(ledge?.edge[0]).toBeCloseTo(0.5, 1);
    expect(ledge?.normal[0]).toBeCloseTo(-1, 6);
    expect(ledge?.landing[1]).toBeCloseTo(1.5, 2);
    expect(ledge?.landing[0]).toBeGreaterThan(0.5); // on the top, past the face
    expect(ledge?.rise[0]).toBeCloseTo(0.5 - apex.capsule.radius - apex.offset, 2); // the hull against the face
    expect(ledge?.drop).toBeCloseTo(1.5, 2); // the lip over the floor below
    expect(ledge?.crouched).toBe(false);
  });

  it('find none past the reach, at a step, at a wall with no top in reach, under a ceiling or with nothing ahead', () => {
    expect(ledgeEast(box([2, 2.1, 4], [1.5, 1.05, 0]))).toBeNull(); // 2.1 m: past the 2.03 asked
    expect(ledgeEast(box([2, 0.3, 4], [1.5, 0.15, 0]))).toBeNull(); // a step: walked up, not mantled
    expect(ledgeEast(box([2, 8, 4], [1.5, 4, 0]))).toBeNull();
    expect(ledgeEast(box([2, 1.5, 4], [1.5, 0.75, 0]), box([4, 0.2, 4], [0, 2.5, 0]))).toBeNull(); // a ceiling over it
    expect(ledgeEast()).toBeNull();
  });

  it('take a top only the crouched hull fits on, under a low roof', () => {
    const ledge = ledgeEast(box([4, 1, 4], [2.5, 0.5, 0]), box([4, 0.2, 4], [2.5, 2.5, 0])); // 1.4 m clear on the whole top
    expect(ledge?.crouched).toBe(true);
  });

  it('path the feet to the wall, up two skins past the lip, across over the landing and down onto it', () => {
    const path = ledgePath(apex, [0, 0, 0], [0.4, 0], [0.5, 1, 0], [0.9, 1, 0]);
    const top = 1 + apex.offset * 2;
    expect(path).toEqual([[0, 0, 0], [0.4, 0, 0], [0.4, top, 0], [0.9, top, 0], [0.9, 1, 0]]); // prettier-ignore
  });
});
