/**
 * @file Unit tests for the hill (labs/playground/scenes/hill.ts, ground.ts): its terrain is the block's ground, its
 * hill in the east (docs/PLAYGROUND.md §2.2: x 72 to 96, rising to 10 m in slopes no steeper than 30°, most of its
 * flank 10° to 30°), the yards west of it only rolling, drawn in the playground's turf and rock; the player starts at
 * the hill's foot on the ground facing up it and runs up it.
 * @see labs/playground/scenes/hill.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { terrainGrade, terrainHeight } from '../../../engine/sim-api';
import { PLAYGROUND_GROUND } from '../ground';
import { HILL, HILL_START, hill } from './hill';

describe('the hill', () => {
  it('stands east of the yards, rising to 10 m in slopes no steeper than 30°, most of its flank 10° to 30°', () => {
    expect([HILL.bounds.min[0], HILL.bounds.max[0], HILL.bounds.min[2], HILL.bounds.max[2]]).toEqual([0, 96, 0, 96]);
    expect(HILL.bounds.max[1]).toBeGreaterThan(9.5);
    expect(HILL.bounds.max[1]).toBeLessThan(10.5);
    const grades: number[] = [];
    for (let x = 72.25; x < 96; x += 0.5) for (let z = 0.25; z < 96; z += 0.5) grades.push(terrainGrade(HILL, x, z)!);
    const degrees = grades.map((grade) => (Math.atan(grade) * 180) / Math.PI);
    expect(Math.max(...degrees)).toBeLessThan(30);
    const flank = degrees.filter((d) => d >= 5);
    expect(flank.filter((d) => d >= 10).length / flank.length).toBeGreaterThan(0.8);
    expect(HILL.materials).toEqual([...PLAYGROUND_GROUND]);
    let yards = 0; // west of the hill the ground only rolls
    for (let x = 0.25; x < 60; x += 0.5) for (let z = 0.25; z < 96; z += 0.5) yards = Math.max(yards, terrainGrade(HILL, x, z)!); // prettier-ignore
    expect((Math.atan(yards) * 180) / Math.PI).toBeLessThan(15);
  });

  it('starts the player at its foot, on the ground, and lets him run up it', async () => {
    expect(HILL_START[1]).toBe(terrainHeight(HILL, HILL_START[0], HILL_START[2]));
    const engine = await createHeadless({ scene: hill });
    const feet = () => (engine.state('actor').entities as unknown as { actor: { x: number; y: number; z: number } }[])[0].actor; // prettier-ignore
    engine.step(30, {});
    expect(feet().y - terrainHeight(HILL, feet().x, feet().z)!).toBeLessThan(0.05);
    engine.step(120, { move: [1, 0] });
    expect(feet().x).toBeGreaterThan(80);
    expect(feet().y).toBeGreaterThan(2);
    expect(Math.abs(feet().y - terrainHeight(HILL, feet().x, feet().z)!)).toBeLessThan(0.1);
  });
});
