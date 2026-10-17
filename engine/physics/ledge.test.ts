/**
 * @file Unit tests for ledges (engine/physics/ledge.ts), with `movement:apex`'s hull on a flat floor: a 1.5 m block
 * ahead is a ledge 1.5 m up, its edge on the block's near face, its normal out of the wall and its landing on the top;
 * a block past the reach, a step it walks up, a wall with no top in reach, a ceiling over the character and nothing
 * ahead are none; a top under a low roof takes only the crouched hull.
 * @see engine/physics/ledge.ts
 */
import { describe, expect, it } from 'vitest';
import { addCharacter, createCharacter } from './character';
import { findLedge } from './ledge';
import { createPhysics } from './world';

const apex = createCharacter({ movement: 'movement:apex' });
const SEARCH = { reach: 2.03, probe: 0.61, crouched: 1.1938 - 2 * apex.capsule.radius };

/** A box `size` big, its centre at `at`. */
const box = (size: [number, number, number], at: [number, number, number]) => ({ type: 'fixed' as const, colliders: [{ shape: { type: 'box' as const, size }, position: at }] }); // prettier-ignore

/** The character at the origin on a floor, beside `extra` boxes, looking for a ledge east. */
function ledgeEast(...extra: ReturnType<typeof box>[]) {
  const physics = createPhysics();
  physics.addBody(box([40, 1, 40], [0, -0.5, 0]));
  for (const body of extra) physics.addBody(body);
  const body = addCharacter(physics, apex, [0, 0, 0]);
  physics.step({ dt: 1 / 60, settings: { get: (path: string) => (path === 'physics.gravity' ? 9.81 : undefined) } }); // queries see the bodies once stepped
  return findLedge(physics, body, apex, [1, 0], SEARCH);
}

describe('ledges', () => {
  it('find a block ahead: its height, its edge on the near face, the wall’s normal and the landing on its top', () => {
    const ledge = ledgeEast(box([2, 1.5, 4], [1.5, 0.75, 0])); // its near face at x = 0.5
    expect(ledge?.height).toBeCloseTo(1.495, 3); // the feet stand 5 mm up
    expect(ledge?.edge[0]).toBeCloseTo(0.5, 1);
    expect(ledge?.normal[0]).toBeCloseTo(-1, 6);
    expect(ledge?.landing[1]).toBeCloseTo(1.5, 2);
    expect(ledge?.landing[0]).toBeGreaterThan(0.5); // on the top, past the edge
    expect(ledge?.crouched).toBe(false);
  });

  it('find none past the reach, at a step, at a wall with no top in reach, under a ceiling or with nothing ahead', () => {
    expect(ledgeEast(box([2, 2.1, 4], [1.5, 1.05, 0]))).toBeNull(); // 2.1 m: past Apex's 2.03
    expect(ledgeEast(box([2, 0.3, 4], [1.5, 0.15, 0]))).toBeNull(); // a step: walked up, not mantled
    expect(ledgeEast(box([2, 8, 4], [1.5, 4, 0]))).toBeNull();
    expect(ledgeEast(box([2, 1.5, 4], [1.5, 0.75, 0]), box([4, 0.2, 4], [0, 2.5, 0]))).toBeNull(); // a ceiling over it
    expect(ledgeEast()).toBeNull();
  });

  it('take a top only the crouched hull fits on, under a low roof', () => {
    const ledge = ledgeEast(box([4, 1, 4], [2.5, 0.5, 0]), box([4, 0.2, 4], [2.5, 2.5, 0])); // 1.4 m clear on the whole top
    expect(ledge?.crouched).toBe(true);
  });
});
