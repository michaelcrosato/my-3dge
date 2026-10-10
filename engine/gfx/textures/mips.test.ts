/**
 * @file Unit tests for the CPU mip chains (engine/gfx/textures/mips.ts): sizes halve down to 1 × 1 as WebGPU's do,
 * odd sizes included; colour levels average in linear light (black and white make the sRGB byte of 50% linear, 188,
 * not 128), keep the map's mean and encode by an exact inverse of the decoding table; normal levels are unit vectors;
 * linear maps average their bytes.
 * @see engine/gfx/textures/mips.ts
 */
import { describe, expect, it } from 'vitest';
import { bakeTexture } from './bake';
import { linearToSrgbByte, mipChain, mipCount, SRGB_TO_LINEAR } from './mips';
import { mipProblems } from './seams';

/** An RGBA map of `width` × `height` whose texel t has the grey `grey(t)`. */
const greys = (width: number, height: number, grey: (t: number) => number) =>
  Uint8Array.from({ length: width * height * 4 }, (_, i) => ((i & 3) === 3 ? 255 : grey(i >> 2)));

describe('mipChain', () => {
  it('halves the size down to 1 × 1, odd sizes rounding down', () => {
    const sizes = (w: number, h: number) =>
      mipChain(
        greys(w, h, () => 0),
        w,
        h,
        'srgb',
      ).map((level) => [level.width, level.height]);
    expect(sizes(4, 4)).toEqual([
      [4, 4],
      [2, 2],
      [1, 1],
    ]);
    expect(sizes(48, 16)).toEqual([
      [48, 16],
      [24, 8],
      [12, 4],
      [6, 2],
      [3, 1],
      [1, 1],
    ]);
    expect([mipCount(48, 16), mipCount(64, 64), mipCount(1, 1)]).toEqual([6, 7, 1]);
  });

  it('averages colour in linear light: black and white make 50% linear, sRGB byte 188', () => {
    const checker = greys(2, 2, (t) => (t === 0 || t === 3 ? 255 : 0));
    const [, top] = mipChain(checker, 2, 2, 'srgb');
    expect([...top.data]).toEqual([188, 188, 188, 255]);
    const [, linear] = mipChain(checker, 2, 2, 'linear');
    expect([...linear.data]).toEqual([128, 128, 128, 255]);
  });

  it("weights an odd row's texels by the area they cover", () => {
    // 3 texels to 1: each covers a third.
    const [, one] = mipChain(
      greys(3, 1, (t) => [0, 0, 255][t]),
      3,
      1,
      'linear',
    );
    expect(one.data[0]).toBe(85);
  });

  it('encodes by the exact inverse of the decoding table', () => {
    for (let b = 0; b < 256; b++) expect(linearToSrgbByte(SRGB_TO_LINEAR[b])).toBe(b);
    expect([linearToSrgbByte(-1), linearToSrgbByte(2)]).toEqual([0, 255]);
  });

  it("keeps every v1 texture's mean and unit normals down the chain", () => {
    for (const id of ['texture:brick', 'texture:staves', 'texture:flagstone']) {
      const bake = bakeTexture(id);
      expect(mipProblems(mipChain(bake.map, bake.width, bake.height, 'srgb'), 'srgb'), id).toEqual([]);
      expect(mipProblems(mipChain(bake.normalMap, bake.width, bake.height, 'normal'), 'normal'), id).toEqual([]);
    }
  });
});
