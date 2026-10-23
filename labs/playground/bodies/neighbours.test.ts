/**
 * @file Unit tests for the neighbours' bodies (labs/playground/bodies/neighbours.ts, PLAN.md WP 13.21): each compiles
 * on build:adult wearing the player's slots, no two dressed alike, none in the player's accent, and the same seed
 * dresses them the same every time.
 * @see labs/playground/bodies/neighbours.ts
 */
import { describe, expect, it } from 'vitest';
import { compileBody } from '../../../engine/gfx/puppets/compile';
import { NEIGHBOUR_BODIES, neighbourBody } from './neighbours';
import { PLAYER_BODY } from './player';

describe('the neighbours’ bodies', () => {
  it('compile on build:adult, wearing the player’s slots in clothes of their own', () => {
    NEIGHBOUR_BODIES.forEach((body, k) => {
      const worn = [...new Set(compileBody(`body:neighbour${k}`, 'build:adult').pieces.map((piece) => piece.slot))];
      expect(worn.sort()).toEqual(Object.keys(PLAYER_BODY.slots!).sort());
      expect(body.slots!.accent).not.toBe(PLAYER_BODY.slots!.accent); // he stays the one marked
      expect([body.slots!.glove, body.slots!.cuff]).toEqual([body.slots!.skin, body.slots!.jacket]); // bare hands
    });
    const dress = (body: (typeof NEIGHBOUR_BODIES)[number]) => JSON.stringify([body.slots!.jacket, body.slots!.pants, body.slots!.accent]); // prettier-ignore
    expect(new Set(NEIGHBOUR_BODIES.map(dress)).size).toBe(NEIGHBOUR_BODIES.length);
  });

  it('dresses each the same from its seed every time', () => {
    expect(neighbourBody(2)).toEqual(NEIGHBOUR_BODIES[2]);
  });
});
