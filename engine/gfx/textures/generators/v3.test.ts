/**
 * @file Unit tests for the v3 generators, the building materials (engine/gfx/textures/generators/{asphalt,carpet,
 * concrete,glass,shingles,siding,tiles,wallpaper,wood}.ts; WP 13.17): every one tiles, the WP's first Done-when (the
 * `tex` QA family's checks pass on it: its worst seam at most 2% of the value range for seeds 1 and 2 at its size and
 * twice it, an exact period, values in range, whole mip chains, a stable hash; and the seam within 2% for three more
 * seeds), its bake is reproducible (the golden hash, the same twice and under the sim's fdlibm swap; another seed
 * another bake for those that draw from it), and it draws what its parameters say: the grout, slots, laps, stripes,
 * reflections and grain where their sizes put them, the specks, tufts and pores near the shares asked, glaze and glass
 * smooth, carpet matte, and its tones more than one of the pixel look's 24 shades apart.
 * @see engine/gfx/textures/v3.ts
 */
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../../../core/registry';
import { withSimMath } from '../../../core/simMath';
import { checkTextures } from '../../../../tools/qa/tex';
import { bakeTexture, type TextureBake, type TextureRef } from '../bake';
import { measureSeam, SEAM_LIMIT } from '../seams';
import { textureKind } from '../texture';
import { V3_TEXTURES } from '../v3';

const IDS = Object.keys(V3_TEXTURES);
/** The generators that draw nothing from their seed: one layout whatever it is. */
const SEEDLESS = ['texture:glass', 'texture:wallpaper'];

/** The golden hash of each v3 generator's default bake (seed 1, its own size). Change only with a written reason. */
const GOLDEN: Record<string, string> = {
  'texture:asphalt': '19578da1365aa9fa',
  'texture:carpet': '0960c7a6a4459490',
  'texture:concrete': 'fd0654884f221fae',
  'texture:glass': '34404fa8b2611c30',
  'texture:shingles': '0e530a1ff77ca0bc',
  'texture:siding': '9d8bdc8558541d91',
  'texture:tiles': '83ef85c01ba7c489',
  'texture:wallpaper': '02297f702eb8f6af',
  'texture:wood': '027295928c435252',
};

const reg = createRegistry();
textureKind(reg);
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
/** A hex colour's value (its largest channel), 0 to 1. */
const value = (hex: string) => Math.max(...[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))) / 255;

describe('every v3 generator', () => {
  it('is registered with the kind, after v1 and v2, and passes every check of the tex QA family', () => {
    expect(IDS.every((id) => reg.has('texture', id))).toBe(true);
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
      if (!SEEDLESS.includes(id)) expect(bake({ texture: id, seed: 2 }).hash).not.toBe(hash);
    });
  }

  it('keeps each palette’s tones more than one of the pixel look’s 24 shades apart in value (0.05)', () => {
    const steps = IDS.flatMap((id) => {
      const params = reg.get('texture', id).params as Record<string, { default: unknown }>;
      const tones = Object.values(params).flatMap((field) => (Array.isArray(field.default) ? field.default : [field.default])); // prettier-ignore
      const values = tones.filter((t): t is string => typeof t === 'string' && /^#[0-9a-f]{6}$/i.test(t)).map(value).sort(); // prettier-ignore
      return values.slice(1).map((v, k) => [id, +(v - values[k]).toFixed(3)] as const);
    });
    expect(steps.filter(([, step]) => step < 0.05)).toEqual([]);
  });
});

describe('the patterns', () => {
  it('tiles: grout a texel wide along each tile, glazed tops, the checker’s tones on every other tile', () => {
    const b = bake({ texture: 'texture:tiles', size: [64, 64] });
    expect(share(b, (t) => is(b, t, '#958e80'))).toBeCloseTo(15 / 64, 3); // 2 × 8 − 1 texels of every 64
    expect(share(b, (t) => is(b, t, '#f7f3e6'))).toBeCloseTo(7 / 64, 3);
    expect(share(b, (t) => is(b, t, '#f7f3e6') && b.roughnessMap[t] > 0.2)).toBe(0);
    const checker = bake({ texture: 'texture:tiles', params: { checker: ['#3a3a3e'] } });
    expect(share(checker, (t) => is(checker, t, '#3a3a3e'))).toBeCloseTo(0.5 * (42 / 64), 3); // half the tiles' faces
  });

  it('wood: grain lines about one in `spacing` columns, knots only where asked', () => {
    const b = bake({ texture: 'texture:wood', size: [128, 128], params: { knots: 0 } });
    expect(share(b, (t) => is(b, t, '#6f4524'))).toBeCloseTo(1 / 4, 1);
    expect(share(b, (t) => is(b, t, '#4e2f18'))).toBe(0);
    const knotty = bake({ texture: 'texture:wood', size: [128, 128], params: { knots: 1 } });
    expect(share(knotty, (t) => is(knotty, t, '#4e2f18'))).toBeGreaterThan(0.005);
  });

  it('carpet: tufts near the share asked, matte all over', () => {
    const b = bake({ texture: 'texture:carpet', size: [256, 256], params: { worn: 0 } });
    expect(share(b, (t) => is(b, t, '#682f2f'))).toBeCloseTo(0.15, 2);
    expect(share(b, (t) => b.roughnessMap[t] !== 1)).toBe(0);
  });

  it('wallpaper: a stripe of its width every repeat, a five-texel diamond in each band', () => {
    const b = bake({ texture: 'texture:wallpaper', size: [64, 64] });
    expect(share(b, (t) => is(b, t, '#c2b68e'))).toBeCloseTo(2 / 8, 5);
    expect(share(b, (t) => is(b, t, '#9b8b63'))).toBeCloseTo(5 / 64, 5);
  });

  it('shingles: a slot and a shadowed row a course, thickest at each butt', () => {
    const b = bake({ texture: 'texture:shingles', size: [64, 64] });
    expect(share(b, (t) => is(b, t, '#43291f'))).toBeCloseTo(1 / 8 + 1 / 4 - 1 / 32, 3);
    expect(share(b, (t) => b.heightMap[t] === 1)).toBeCloseTo((1 / 4) * (7 / 8), 3);
  });

  it('asphalt and concrete: chips, pits and pores near the shares asked, rough all over', () => {
    const road = bake({ texture: 'texture:asphalt', size: [256, 256] });
    expect(share(road, (t) => is(road, t, '#5e5f63'))).toBeCloseTo(0.16, 2);
    expect(share(road, (t) => is(road, t, '#2b2c2e'))).toBeCloseTo(0.06, 2);
    const path = bake({ texture: 'texture:concrete', size: [256, 256] });
    expect(share(path, (t) => is(path, t, '#6e6c67'))).toBeCloseTo(0.03, 2);
    expect(share(road, (t) => road.roughnessMap[t] < 0.9) + share(path, (t) => path.roughnessMap[t] < 0.85)).toBe(0);
  });

  it('siding: every column alike, a lit butt and a shadowed row a board', () => {
    const b = bake({ texture: 'texture:siding', size: [64, 64] });
    const column = (x: number) => Array.from({ length: 64 }, (_, y) => b.map[(y * 64 + x) * 4]);
    expect(column(17)).toEqual(column(0));
    expect([share(b, (t) => is(b, t, '#e2e9ed')), share(b, (t) => is(b, t, '#84909a'))]).toEqual([1 / 4, 1 / 4]);
  });

  it('glass: a broad and a narrow reflection every repeat, smooth all over', () => {
    const b = bake({ texture: 'texture:glass', size: [64, 64] });
    expect(share(b, (t) => is(b, t, '#c9e2ec'))).toBeCloseTo(4 / 16, 5); // three texels broad and one narrow of 16
    expect(share(b, (t) => b.roughnessMap[t] > 0.06)).toBe(0);
  });
});
