/**
 * @file Unit tests for the scene's props as navigation blocks (engine/sim/propBlocks.ts, PLAN.md WP 13.21): a table's
 * box round where it stands, turned with it; a prop out of the physics world, no block; no props, none.
 * @see engine/sim/propBlocks.ts
 */
import { describe, expect, it } from 'vitest';
import { getProp } from '../world/props/prop';
import '../world/props/library';
import { propObstacles } from './propBlocks';

/** A world of one prop as `propObstacles` reads it. */
const one = (sceneProp: object) => ({ query: (name: string) => (name === 'sceneProp' ? [{ sceneProp }] : []) });

describe('the props as navigation blocks', () => {
  it('blocks a table’s box where it stands, turned with it, and nothing for a prop out of the world', () => {
    const body = getProp('prop:table').body;
    const [sx, sy, sz] = body.shape === 'box' ? body.size : [0, 0, 0];
    const square = { prop: 'prop:table', body: 3, x: 1, y: 0.5, z: 2, q: [0, 0, 0, 1] };
    expect(propObstacles(one(square))).toEqual([{ min: [1 - sx / 2, 0.5 - sy / 2, 2 - sz / 2], max: [1 + sx / 2, 0.5 + sy / 2, 2 + sz / 2] }]); // prettier-ignore
    const turned = propObstacles(one({ ...square, q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }))[0]; // a quarter turn about Y
    expect(turned.max[0] - turned.min[0]).toBeCloseTo(sz, 9);
    expect(turned.max[2] - turned.min[2]).toBeCloseTo(sx, 9);
    expect(propObstacles(one({ ...square, body: -1 }))).toEqual([]);
    expect(propObstacles({ query: () => [] })).toEqual([]);
  });
});
