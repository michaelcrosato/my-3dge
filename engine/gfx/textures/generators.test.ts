/**
 * @file Unit tests for the v1 generators (engine/gfx/textures/generators/): every generator tiles, the WP's first
 * Done-when (its worst seam delta at most 2% of the value range across five seeds, at its size and at twice it),
 * repeats exactly one period over, writes values in range, and draws its pattern: joints and gaps sunk below the
 * faces, more than one tone, the barrel's hoops smoother than its wood, and the parameters it is given.
 * @see engine/gfx/textures/v1.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '../../core/registry';
import { bakeTexture, textureSampler } from './bake';
import { measureSeam, periodMismatch, rangeProblems, SEAM_LIMIT } from './seams';
import './texture';
import { V1_TEXTURES } from './v1';

const IDS = Object.keys(V1_TEXTURES);

describe('every v1 generator', () => {
  it('is registered in the shared registry', () => {
    expect(registry.list('texture').map((entry) => entry.id)).toEqual(expect.arrayContaining(IDS));
    expect(IDS).toHaveLength(6);
  });

  for (const id of IDS) {
    it(`${id} tiles: seam at most 2% of the range over five seeds and two sizes, exact period, values in range`, () => {
      const [w, h] = registry.get('texture', id).size as number[];
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const size of [
          [w, h],
          [2 * w, 2 * h],
        ]) {
          const ref = { texture: id, seed, size };
          const seam = measureSeam(bakeTexture(ref));
          expect(seam.delta, `${id} seed ${seed} at ${size.join(' × ')}: ${JSON.stringify(seam)}`).toBeLessThanOrEqual(
            SEAM_LIMIT,
          );
          if (size[0] === w) {
            expect(periodMismatch(textureSampler(ref)), `${id} seed ${seed}`).toBe(0);
            expect(rangeProblems(textureSampler(ref)).count, `${id} seed ${seed}`).toBe(0);
          }
        }
      }
    });
  }
});

/** The share of texels of `id`'s bake whose height is at most `below`, and the distinct colours. */
function summary(ref: Parameters<typeof bakeTexture>[0]) {
  const bake = bakeTexture(ref);
  const colours = new Set<number>();
  for (let t = 0; t < bake.width * bake.height; t++) {
    colours.add((bake.map[t * 4] << 16) | (bake.map[t * 4 + 1] << 8) | bake.map[t * 4 + 2]);
  }
  const low = bake.heightMap.filter((v) => v <= 0.3).length / bake.heightMap.length;
  return { bake, colours: colours.size, low };
}

describe('the patterns', () => {
  it('sink the joints and gaps of the masonry and wood, in the share their layout gives', () => {
    // Brick: a one-texel joint along each 4-texel course and each 8-texel brick: 1/4 + 1/8 − 1/32 of the texels.
    expect(summary('texture:brick').low).toBeCloseTo(1 / 4 + 1 / 8 - 1 / 32, 2);
    // Flagstone: a joint along each 16-texel stone's left and top (crack texels are low too).
    expect(summary('texture:flagstone').low).toBeGreaterThanOrEqual(2 / 16 - 1 / 256);
    expect(summary('texture:stone').low).toBeCloseTo(1 / 8 + 1 / 16 - 1 / 128, 2);
    expect(summary('texture:planks').low).toBeCloseTo(1 / 8 + 1 / 32 - 1 / 256, 2);
    expect(summary('texture:checker').low).toBe(0);
  });

  it('give each cell a tone of its own and draw with more than the palette’s base colours', () => {
    for (const id of IDS) expect(summary(id).colours, id).toBeGreaterThan(id === 'texture:checker' ? 1 : 4);
    expect(summary('texture:checker').colours).toBe(2);
  });

  it("make the barrel's hoops smoother than its wood, and keep them where they are put", () => {
    const { bake } = summary({ texture: 'texture:staves', params: { hoops: [5], thickness: 3 } });
    const roughness = (y: number) => bake.roughnessMap[y * bake.width + 1];
    expect([4, 5, 6, 7, 8].map(roughness).map((r) => r < 0.5)).toEqual([false, true, true, true, false]);
  });

  it('follow their parameters: a bigger brick means fewer joints', () => {
    const small = summary('texture:brick').low;
    const big = summary({ texture: 'texture:brick', params: { width: 16, course: 8 } }).low;
    expect(big).toBeCloseTo(1 / 8 + 1 / 16 - 1 / 128, 2);
    expect(big).toBeLessThan(small);
  });
});
