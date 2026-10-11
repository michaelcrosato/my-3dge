/**
 * @file Unit tests for socket trails (engine/gfx/fx/ribbons.ts), in Node: a ribbon spans its samples' bases and tips,
 * lit from nothing at the tail to 0.85 at the head (the base at half), folding its unused samples onto its newest;
 * its newest `samples` samples only; one mesh draws every ribbon, its range the ribbons of the frame; ribbons past
 * the capacity are counted; a frame uploads its own ribbons only.
 * @see engine/gfx/fx/ribbons.ts
 */
import type { BufferAttribute } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRibbons, type TrailSampleLike } from './ribbons';

/** A trail of `n` samples, the k-th base at (k, 1, 0) and tip at (k, 2, 0). */
const trailOf = (n: number, weight = 1): TrailSampleLike[] =>
  Array.from({ length: n }, (_, k) => ({ base: [k, 1, 0], tip: { x: k, y: 2, z: 0 }, weight }));

describe('ribbons', () => {
  it('span the bases and tips, lit toward the head, folding unused samples onto the newest', () => {
    const ribbons = createRibbons({ capacity: 4, samples: 6 });
    ribbons.begin();
    ribbons.add(trailOf(3, 0.5), [1, 0.5, 0.25]);
    ribbons.end();
    const positions = (ribbons.mesh.geometry.getAttribute('position') as BufferAttribute).array;
    const colours = (ribbons.mesh.geometry.getAttribute('color') as BufferAttribute).array;
    const vertex = (v: number) => Array.from(positions.slice(v * 3, v * 3 + 3));
    expect([vertex(0), vertex(1), vertex(4), vertex(5)]).toEqual([
      [0, 1, 0],
      [0, 2, 0],
      [2, 1, 0],
      [2, 2, 0],
    ]);
    expect([vertex(10), vertex(11)], 'the last sample folded onto the newest').toEqual([vertex(4), vertex(5)]);
    const lit = (k: number) => Math.pow((k + 1) / 3, 1.5) * 0.85 * 0.5;
    expect(colours[3]).toBeCloseTo(lit(0), 6); // the oldest tip's red
    expect(colours[0]).toBeCloseTo(lit(0) * 0.5, 6); // its base at half
    expect(colours[5 * 3 + 1]).toBeCloseTo(lit(2) * 0.5, 6); // the newest tip's green
    expect(colours[10 * 3]).toBe(0); // folded: unlit
    expect(ribbons.mesh.geometry.drawRange.count).toBe(5 * 6);
    expect(ribbons.mesh.visible).toBe(true);
  });

  it('draw only the newest samples, nothing for a trail of one, and count those past the capacity', () => {
    const ribbons = createRibbons({ capacity: 2, samples: 4 });
    ribbons.begin();
    ribbons.add(trailOf(10), [1, 1, 1]);
    ribbons.add(trailOf(1), [1, 1, 1]);
    ribbons.add(trailOf(2), [1, 1, 1]);
    ribbons.add(trailOf(2), [1, 1, 1]);
    ribbons.end();
    const positions = (ribbons.mesh.geometry.getAttribute('position') as BufferAttribute).array;
    expect(positions[0]).toBe(6); // samples 6 to 9 of 10
    expect([ribbons.count, ribbons.skipped]).toEqual([2, 1]);
    ribbons.begin();
    ribbons.end();
    expect(ribbons.mesh.visible).toBe(false);
  });

  it("upload the frame's ribbons only, in one range", () => {
    const ribbons = createRibbons({ capacity: 8 });
    const position = ribbons.mesh.geometry.getAttribute('position') as BufferAttribute;
    ribbons.begin();
    for (let i = 0; i < 3; i++) ribbons.add(trailOf(4), [1, 1, 1]);
    ribbons.end();
    expect(position.updateRanges).toEqual([{ start: 0, count: 3 * 12 * 2 * 3 }]);
    ribbons.begin();
    ribbons.add(trailOf(4), [1, 1, 1]);
    ribbons.end();
    expect(position.updateRanges).toEqual([{ start: 0, count: 72 }]);
  });
});
