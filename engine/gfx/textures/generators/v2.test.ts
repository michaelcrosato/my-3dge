/**
 * @file Unit tests for the v2 generators (engine/gfx/textures/generators/{runes,moss,metal,plaster,dirt,grass,water}
 * .ts): every one tiles, WP 7.3's first Done-when (the `tex` QA family's checks pass on it: its worst seam at most 2%
 * of the value range for seeds 1 and 2 at its size and twice it, an exact period, values in range, whole mip chains,
 * a stable hash; and the seam within 2% for three more seeds), its bake is reproducible (the golden hash, the same
 * twice and under the sim's fdlibm swap), and it draws what its parameters say: the shares of patches, rust, fallen
 * plaster and moss, raised pebbles and rivets, smooth metal and rough rust, moss in the joints first, and the rune
 * circle's rings, spokes, runes and glow, centred in its cell.
 * @see engine/gfx/textures/generators/runes.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry, type Registry } from '../../../core/registry';
import { withSimMath } from '../../../core/simMath';
import { checkTextures } from '../../../../tools/qa/tex';
import { bakeTexture, type TextureBake, type TextureRef } from '../bake';
import { measureSeam, SEAM_LIMIT } from '../seams';
import { defineTexture, textureKind } from '../texture';
import type { TextureSpec } from '../types';
import { DIRT } from './dirt';
import { GRASS } from './grass';
import { METAL } from './metal';
import { MOSS } from './moss';
import { PLASTER } from './plaster';
import { runeCircle, RUNES } from './runes';
import { WATER, wave } from './water';

/** The v2 generators by id. */
const V2: Record<string, TextureSpec> = {
  'texture:dirt': DIRT as unknown as TextureSpec,
  'texture:grass': GRASS as unknown as TextureSpec,
  'texture:metal': METAL as unknown as TextureSpec,
  'texture:moss': MOSS as unknown as TextureSpec,
  'texture:plaster': PLASTER as unknown as TextureSpec,
  'texture:runes': RUNES as unknown as TextureSpec,
  'texture:water': WATER as unknown as TextureSpec,
};
const IDS = Object.keys(V2);

/** The golden hash of each v2 generator's default bake (seed 1, its own size). Change only with a written reason. */
const GOLDEN: Record<string, string> = {
  'texture:dirt': 'ad0c201c3eb04118',
  'texture:grass': '674ba260611d473f',
  'texture:metal': '44d88fe3d7098b2d',
  'texture:moss': '72a9bd823fc45818',
  'texture:plaster': '56b1b39003789b59',
  'texture:runes': '53e548c7b21a15aa',
  'texture:water': 'cfd97f901b9465f2',
};

/** A registry with the kind and every v2 generator (defined here unless the kind already brings it). */
function v2Registry(): Registry {
  const reg = createRegistry();
  textureKind(reg);
  for (const [id, spec] of Object.entries(V2)) if (!reg.has('texture', id)) defineTexture(id, spec, reg);
  return reg;
}
const reg = v2Registry();
const bake = (ref: TextureRef): TextureBake => bakeTexture(ref, reg);

/** The share of texels for which `test(t)` holds (t the texel index). */
function share(b: TextureBake, test: (t: number) => boolean): number {
  let n = 0;
  for (let t = 0; t < b.width * b.height; t++) if (test(t)) n++;
  return n / (b.width * b.height);
}
/** Whether texel t of `b`'s colour map is `hex`. */
const is = (b: TextureBake, t: number, hex: string) =>
  [1, 3, 5].every((k, c) => b.map[t * 4 + c] === parseInt(hex.slice(k, k + 2), 16));

describe('every v2 generator', () => {
  it('passes every check of the tex QA family (seeds 1 and 2, its size and twice it)', () => {
    expect(checkTextures(reg, IDS)).toEqual([]);
  });

  for (const id of IDS) {
    it(`${id} tiles over three more seeds, and bakes reproducibly`, () => {
      const [w, h] = reg.get('texture', id).size as number[];
      for (const seed of [3, 4, 5]) {
        const seam = measureSeam(bake({ texture: id, seed, size: [w, h] }));
        expect(seam.delta, `${id} seed ${seed}: ${JSON.stringify(seam)}`).toBeLessThanOrEqual(SEAM_LIMIT);
      }
      const hash = bake(id).hash;
      expect(bake(id).hash).toBe(hash);
      expect(withSimMath(() => bake(id).hash)).toBe(hash);
      expect(hash, id).toBe(GOLDEN[id]);
      expect(bake({ texture: id, seed: 2 }).hash).not.toBe(hash);
    });
  }
});

describe('the patterns', () => {
  it('dirt: dark and light patches near the share asked, pebbles raised with a lit top', () => {
    for (const patches of [0.15, 0.25, 0.4]) {
      const b = bake({ texture: 'texture:dirt', size: [256, 256], params: { patches } });
      expect(
        share(b, (t) => is(b, t, '#7d5838')),
        `${patches}`,
      ).toBeCloseTo(patches, 1);
    }
    const b = bake({ texture: 'texture:dirt', size: [256, 256] });
    const pebbles = share(b, (t) => is(b, t, '#c9a276'));
    expect(pebbles).toBeGreaterThan(0.01);
    // Each pebble's lit top stands above the ground around it (0.6 to 0.8 high).
    expect(share(b, (t) => is(b, t, '#c9a276') && b.heightMap[t] !== Math.fround(0.85))).toBe(0);
    const none = bake({ texture: 'texture:dirt', params: { pebbles: 0 } });
    expect(share(none, (t) => is(none, t, '#c9a276'))).toBe(0);
  });

  it('grass: blades and flowers stand above the turf; no flowers when asked for none', () => {
    const b = bake({ texture: 'texture:grass', size: [256, 256] });
    const flowers = share(b, (t) => is(b, t, '#f2f2f6') || is(b, t, '#f4e27a'));
    expect(flowers).toBeGreaterThan(0.002);
    expect(share(b, (t) => (is(b, t, '#f2f2f6') || is(b, t, '#f4e27a')) && b.heightMap[t] !== 1)).toBe(0);
    const bare = bake({ texture: 'texture:grass', params: { flowers: 0, blades: 0 } });
    expect(share(bare, (t) => is(bare, t, '#f2f2f6') || is(bare, t, '#f4e27a'))).toBe(0);
    expect(share(bare, (t) => bare.heightMap[t] >= 0.85)).toBe(0);
  });

  it('water: a smooth wave, crest lines dithered on about the share asked, smooth water', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map(wave)).toEqual([1, 0, -1, 0, 1]);
    const b = bake({ texture: 'texture:water', size: [256, 256] });
    const crests = share(b, (t) => is(b, t, '#9fe3ff'));
    // 12% of each ripple, half of it dithered away (a little back by the hash), less the breaks.
    expect(crests).toBeGreaterThan(0.03);
    expect(crests).toBeLessThan(0.08);
    expect(share(b, (t) => b.roughnessMap[t] > Math.fround(0.3))).toBe(0);
    const calm = bake({ texture: 'texture:water', params: { crests: 0 } });
    expect(share(calm, (t) => is(calm, t, '#9fe3ff'))).toBe(0);
  });

  it('plaster: fallen away near the share asked, the bricks set back behind its face', () => {
    for (const fallen of [0.1, 0.2, 0.35]) {
      const b = bake({ texture: 'texture:plaster', size: [256, 256], params: { fallen } });
      expect(
        share(b, (t) => b.heightMap[t] <= 0.5),
        `${fallen}`,
      ).toBeCloseTo(fallen, 1);
    }
    const b = bake({ texture: 'texture:plaster', size: [256, 256] });
    expect(share(b, (t) => b.heightMap[t] === Math.fround(0.15))).toBeGreaterThan(0.01);
    const whole = bake({ texture: 'texture:plaster', params: { fallen: 0, cracks: 0 } });
    expect(share(whole, (t) => whole.heightMap[t] < 0.85)).toBe(0);
  });

  it('metal: seams sunk, rivets raised and lit above, bare metal smooth and rust rough, rust near the share', () => {
    const b = bake({ texture: 'texture:metal', size: [256, 256], params: { corrosion: 0 } });
    // A one-texel seam along each 32-texel plate's left and 16-texel plate's bottom.
    expect(share(b, (t) => b.heightMap[t] === Math.fround(0.1))).toBeCloseTo(1 / 32 + 1 / 16 - 1 / 512, 3);
    // Four rivet heads of 2 × 2 along the top and the bottom of each 32 × 16 plate.
    expect(share(b, (t) => b.heightMap[t] === 1)).toBeCloseTo((2 * 4 * 2) / (32 * 16), 3);
    expect(share(b, (t) => b.roughnessMap[t] > 0.5 && b.heightMap[t] > Math.fround(0.1))).toBe(0);
    for (const corrosion of [0.1, 0.25]) {
      const rusty = bake({ texture: 'texture:metal', size: [256, 256], params: { corrosion } });
      const rust = share(rusty, (t) => rusty.roughnessMap[t] > 0.9 && rusty.heightMap[t] > Math.fround(0.1));
      expect(rust, `${corrosion}`).toBeGreaterThan(corrosion * 0.6);
      expect(rust, `${corrosion}`).toBeLessThan(corrosion * 1.6);
    }
  });

  it('moss: none at cover 0 (the flagstones as they are), the joints first, everything at 1', () => {
    const stones = bakeTexture('texture:flagstone', reg);
    expect(bake({ texture: 'texture:moss', params: { cover: 0 } }).map).toEqual(stones.map);
    const mossy = (b: TextureBake, t: number) => b.roughnessMap[t] === 1;
    const some = bake({ texture: 'texture:moss', size: [256, 256], params: { cover: 0.2 } });
    const base = bakeTexture({ texture: 'texture:flagstone', size: [256, 256] }, reg);
    const joint = (t: number) => base.heightMap[t] < 0.35;
    const inJoints = share(some, (t) => joint(t) && mossy(some, t)) / share(base, joint);
    const onStone = share(some, (t) => !joint(t) && mossy(some, t)) / share(base, (t) => !joint(t));
    expect(onStone).toBeCloseTo(0.2, 1);
    expect(inJoints).toBeGreaterThan(onStone * 1.5);
    const all = bake({ texture: 'texture:moss', params: { cover: 1 } });
    expect(share(all, (t) => mossy(all, t))).toBe(1);
  });

  it('runes: a circle centred in its cell, rings and spokes glowing faintly, runes and centre brightly', () => {
    const b = bake('texture:runes');
    expect([b.width, b.height]).toEqual([128, 128]);
    const glow = b.emissiveMap!;
    let [n, sx, sy] = [0, 0, 0];
    for (let t = 0; t < 128 * 128; t++) {
      if (!glow[t * 4] && !glow[t * 4 + 1] && !glow[t * 4 + 2]) continue;
      [n, sx, sy] = [n + 1, sx + (t % 128) + 0.5, sy + Math.floor(t / 128) + 0.5];
      // Every glowing texel is inlaid: below the stones and smoother.
      expect([b.heightMap[t], b.roughnessMap[t]]).toEqual([0.35, 0.45].map(Math.fround));
    }
    // Rings and spokes are symmetric about the centre; the runes differ by sector, so allow them a texel's pull.
    expect(Math.abs(sx / n - 64)).toBeLessThan(1);
    expect(Math.abs(sy / n - 64)).toBeLessThan(1);
    // The faint lines glow at 0.45 of the inlay (#2f7f82), the runes and centre at the full glow (#6fd6cc).
    const centre = (64 * 128 + 64) * 4;
    expect([...glow.slice(centre, centre + 3)]).toEqual([0x6f, 0xd6, 0xcc]);
    const ring = (64 * 128 + 64 + 53) * 4;
    expect([...glow.slice(ring, ring + 3)]).toEqual([0x2f, 0x7f, 0x82].map((v) => Math.round(v * 0.45)));
    const dark = bake({ texture: 'texture:runes', params: { lineGlow: 0 } }).emissiveMap!;
    expect([...dark.slice(ring, ring + 3)]).toEqual([0, 0, 0]);
  });

  it('runeCircle: rings at their radii, a spoke every 22.5°, a rune in every sector', () => {
    const mark = runeCircle({ radius: 54, inner: 43, spokes: 16 });
    // On the rings, along each axis (the texel centre 53.5 and 42.5 out).
    for (const [i, j] of [
      [53, 0],
      [-54, -1],
      [0, 53],
      [-1, -54],
      [42, 0],
      [-43, -1],
    ]) {
      expect(mark(i, j), `${i}, ${j}`).toBe(1);
    }
    // A spoke every 22.5°: the texel 48 out along each spoke's direction is a line, and the texels a little off it,
    // halfway to the next spoke, are not (a rune or nothing). Test-side trigonometry only places the probes.
    for (let k = 0; k < 16; k++) {
      const along = (k * Math.PI) / 8;
      const between = along + Math.PI / 16;
      // The four texels round the point r out at angle a (a spoke along a row of texel corners takes one side).
      const near = (r: number, a: number) => {
        const [i, j] = [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))];
        return [mark(i, j), mark(i - 1, j), mark(i, j - 1), mark(i - 1, j - 1)];
      };
      expect(near(47, along), `spoke ${k}`).toContain(1);
      expect(near(45, between), `between spokes ${k} and ${k + 1}`).not.toContain(1);
    }
    // A rune in every sector: some texel near the middle of the band, at the sector's middle, is bright.
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5) * Math.PI) / 8;
      const [ci, cj] = [Math.round(48.5 * Math.cos(a)), Math.round(48.5 * Math.sin(a))];
      let bright = 0;
      for (let j = cj - 3; j <= cj + 3; j++) for (let i = ci - 3; i <= ci + 3; i++) if (mark(i, j) === 2) bright++;
      expect(bright, `sector ${k}`).toBeGreaterThanOrEqual(5);
    }
    expect(() => runeCircle({ radius: 54, inner: 43, spokes: 12 })).toThrow(/4, 8, 16 or 32/);
  });
});
