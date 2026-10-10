/**
 * @file Unit tests for engine/core/noise.ts (T1): `hash2` and `noise2` bit for bit against my-3d2dge (the reference
 * vectors of tests/baselines/port/core.json), seed-0 value noise equal to `noise2`, each kind's range, exact tiling
 * on dyadic points, cell noise against a brute-force search (the feature points rebuilt from noise.ts's documented
 * hashing), seeds, fbm, option checks, independence from `withSimMath`, and the recorded digests of every kind in 2D
 * and 3D, plain, tiling and in fbm octaves (a changed bit changes every texture and every replay golden that reads it).
 * @see engine/core/noise.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Fnv64, mix32 } from './hash';
import { createNoise2D, createNoise3D, hash2, noise2, type NoiseKind } from './noise';
import { Rng } from './rng';
import { withSimMath } from './simMath';

const CORE = JSON.parse(readFileSync('tests/baselines/port/core.json', 'utf8')) as {
  hash2: [number, number, number][];
  noise2: [number, number, number][];
};

const KINDS: NoiseKind[] = ['value', 'gradient', 'cell'];

/** `n` random points in [-span, span)^dims. */
function points(n: number, dims: 2 | 3, span = 50, seed = 1): number[][] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => Array.from({ length: dims }, () => rng.range(-span, span)));
}

/** A 2D or 3D noise of `kind`, called with a point array. */
function sampler(kind: NoiseKind, dims: 2 | 3, options = {}): (p: number[]) => number {
  if (dims === 2) {
    const noise = createNoise2D(kind, options);
    return (p) => noise(p[0], p[1]);
  }
  const noise = createNoise3D(kind, options);
  return (p) => noise(p[0], p[1], p[2]);
}

describe("my-3d2dge's hash2 and noise2", () => {
  it('match the reference vectors bit for bit', () => {
    expect(CORE.hash2.length).toBe(55);
    expect(CORE.noise2.length).toBe(149);
    const misses = [
      ...CORE.hash2.filter(([x, y, want]) => !Object.is(hash2(x, y), want)).map((r) => ['hash2', ...r]),
      ...CORE.noise2.filter(([x, y, want]) => !Object.is(noise2(x, y), want)).map((r) => ['noise2', ...r]),
    ];
    expect(misses).toEqual([]);
  });

  it('are what one octave of seed-0 value noise gives, bit for bit', () => {
    const value = createNoise2D('value');
    const all = [...CORE.noise2.map(([x, y]) => [x, y]), ...points(5000, 2, 1e4)];
    expect(all.filter(([x, y]) => !Object.is(value(x, y), noise2(x, y)))).toEqual([]);
  });
});

describe('createNoise2D and createNoise3D', () => {
  it('keep each kind in its range: value [0, 1], gradient [-1, 1], cell [0, √dims)', () => {
    for (const dims of [2, 3] as const) {
      const pts = points(40_000, dims);
      const value = pts.map(sampler('value', dims, { seed: 3 }));
      const gradient = pts.map(sampler('gradient', dims, { seed: 3 }));
      const cell = pts.map(sampler('cell', dims, { seed: 3 }));
      expect(Math.min(...value)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...value)).toBeLessThanOrEqual(1);
      expect(Math.max(...gradient.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.max(...gradient.map(Math.abs))).toBeGreaterThan(0.75);
      expect(Math.min(...cell)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...cell)).toBeLessThan(Math.sqrt(dims));
    }
  });

  it('reach the gradient bound at its measured maximum, so the scale is tight', () => {
    // 2D: where the four corners' gradients all point at a cell's centre, the noise there is √2/2, scaled to 1.
    const noise = createNoise2D('gradient');
    let bound = 0;
    for (let i = 0; i < 400; i++) for (let j = 0; j < 400; j++) bound = Math.max(bound, noise(i + 0.5, j + 0.5));
    expect(bound).toBeCloseTo(1, 12);
  });

  it('tile with a period: exactly on dyadic points for one octave, to rounding for fbm (its octave offsets)', () => {
    const rng = new Rng(11);
    for (const kind of KINDS) {
      for (const dims of [2, 3] as const) {
        for (const options of [{ period: 4 }, { period: 3, octaves: 3, seed: 9 }]) {
          const noise = sampler(kind, dims, options);
          for (let n = 0; n < 200; n++) {
            const p = Array.from({ length: dims }, () => rng.int(-512, 512) / 64);
            for (const axis of [0, 1, dims - 1]) {
              for (const shift of [options.period, -2 * options.period]) {
                const q = [...p];
                q[axis] += shift;
                const where = `${kind} ${dims}D ${JSON.stringify(options)} at ${p}`;
                if (options.octaves) expect(noise(q), where).toBeCloseTo(noise(p), 12);
                else expect(noise(q), where).toBe(noise(p));
              }
            }
          }
        }
      }
    }
  });

  it('do not tile without a period', () => {
    for (const kind of KINDS) {
      const noise = createNoise2D(kind, { seed: 2 });
      const same = points(200, 2, 10).filter(([x, y]) => noise(x + 4, y) === noise(x, y));
      expect(same.length).toBeLessThan(5);
    }
  });

  it("find cell noise's exact nearest point, as a brute-force search over 7 cells a side does", () => {
    // The feature points as noise.ts places them: the lattice hash of the cell (xxHash primes, hash2's mixing)
    // gives the x offset, and murmur3's finaliser, applied again, the y and z offsets.
    const lattice = (x: number, y: number, z: number, seed: number) => {
      let h =
        (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 3266489917) + Math.imul(seed, 2246822519)) |
        0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return (h ^ (h >>> 16)) >>> 0;
    };
    const brute = (p: number[], seed: number, reach = 3) => {
      const cell = p.map(Math.floor);
      let best = Infinity;
      const span = Array.from({ length: 2 * reach + 1 }, (_, i) => i - reach);
      for (const dx of span) {
        for (const dy of span) {
          for (const dz of p.length === 2 ? [0] : span) {
            const [cx, cy, cz] = [cell[0] + dx, cell[1] + dy, (cell[2] ?? 0) + dz];
            const h1 = lattice(cx, cy, cz, seed);
            const h2 = mix32(h1);
            const ex = cx + h1 / 2 ** 32 - p[0];
            const ey = cy + h2 / 2 ** 32 - p[1];
            const ez = p.length === 2 ? 0 : cz + mix32(h2) / 2 ** 32 - p[2];
            best = Math.min(best, ex * ex + ey * ey + ez * ez);
          }
        }
      }
      return Math.sqrt(best);
    };
    for (const dims of [2, 3] as const) {
      const noise = sampler('cell', dims, { seed: 5 });
      const pts = points(dims === 2 ? 20_000 : 4000, dims, 100, dims);
      expect(pts.filter((p) => noise(p) !== brute(p, 5))).toEqual([]);
    }
    // Points where the nearest feature point is two cells away: a fixed 3×3 search finds a farther one (found by
    // scanning seed 5's field on a 1/64 grid; none turned up among the 20,000 random points above).
    const noise = createNoise2D('cell', { seed: 5 });
    for (const [x, y] of [
      [215.796875, -856.921875],
      [-372.046875, 217.890625],
      [-99.078125, 380.9375],
      [-982.890625, 412],
    ]) {
      expect(brute([x, y], 5, 1)).toBeGreaterThan(brute([x, y], 5));
      expect(noise(x, y)).toBe(brute([x, y], 5));
    }
  });

  it('give the same field for the same seed and a different one for another seed', () => {
    for (const kind of KINDS) {
      const pts = points(100, 3);
      const a = pts.map(sampler(kind, 3, { seed: 1 }));
      expect(pts.map(sampler(kind, 3, { seed: 1 }))).toEqual(a);
      const b = pts.map(sampler(kind, 3, { seed: 2 }));
      expect(a.filter((v, i) => v === b[i]).length).toBeLessThan(3);
    }
  });

  it('are continuous: gradient and value noise change little over a small step', () => {
    for (const kind of ['value', 'gradient'] as const) {
      const noise = createNoise3D(kind, { seed: 4, octaves: 4 });
      for (const [x, y, z] of points(2000, 3, 20)) {
        expect(Math.abs(noise(x + 1e-7, y, z) - noise(x, y, z))).toBeLessThan(1e-5);
      }
    }
  });

  it('keep fbm within the base range, its first octave weighing most', () => {
    const fbm = createNoise2D('value', { seed: 6, octaves: 6, gain: 0.5 });
    const base = createNoise2D('value', { seed: 6 });
    const pts = points(5000, 2);
    const values = pts.map(([x, y]) => fbm(x, y));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThanOrEqual(1);
    const near = pts.filter(([x, y]) => Math.abs(fbm(x, y) - base(x, y)) < 0.25).length;
    expect(near / pts.length).toBeGreaterThan(0.9);
  });

  it('give gradient fbm a value off the lattice points, where every octave of plain gradient noise is 0', () => {
    expect(createNoise2D('gradient', { seed: 1 })(3, 4)).toBe(0);
    expect(createNoise2D('gradient', { seed: 1, octaves: 4 })(3, 4)).not.toBe(0);
  });

  it('refuse bad options with CORE_BAD_NOISE when created', () => {
    const bad: [NoiseKind, object, RegExp][] = [
      ['value', { period: 2.5 }, /period must be a positive integer/],
      ['value', { period: -4 }, /period must be a positive integer/],
      ['value', { octaves: 0 }, /octaves must be an integer from 1 to 16/],
      ['value', { octaves: 17 }, /octaves/],
      ['value', { period: 4, octaves: 2, lacunarity: 2.5 }, /lacunarity must be an integer when period is set/],
      ['value', { lacunarity: 0 }, /lacunarity must be a positive number/],
      ['value', { gain: NaN }, /gain must be a finite number/],
      ['value', { seed: Infinity }, /seed must be a finite number/],
      ['perlin' as NoiseKind, {}, /kind must be value, gradient or cell/],
    ];
    for (const [kind, options, message] of bad) {
      expect(() => createNoise2D(kind, options)).toThrow(/^\[CORE_BAD_NOISE\]/);
      expect(() => createNoise3D(kind, options)).toThrow(message);
    }
  });

  it('give the same bits inside withSimMath, since no noise calls sin, cos or pow', () => {
    for (const kind of KINDS) {
      const pts = points(500, 3);
      const outside = pts.map(sampler(kind, 3, { seed: 8, octaves: 3, lacunarity: 2.2, gain: 0.6 }));
      const inside = withSimMath(() => pts.map(sampler(kind, 3, { seed: 8, octaves: 3, lacunarity: 2.2, gain: 0.6 })));
      expect(inside).toEqual(outside);
    }
  });
});

/** The digest of each kind × dimension × variant on 2,000 seeded points, recorded from the reviewed implementation. */
const DIGESTS: Record<string, string> = {
  'value 2D plain': '2b7a32b72f626662',
  'value 2D period 4': '9a0f63c09b96da17',
  'value 2D fbm': '9e54cf723dac183a',
  'value 3D plain': '57f4e029afd12896',
  'value 3D period 4': 'cdf849b1a768d11c',
  'value 3D fbm': 'a8bbd6a3382f37cf',
  'gradient 2D plain': '10dbb88bff1cee7c',
  'gradient 2D period 4': '03845f3d2375d525',
  'gradient 2D fbm': '367aa4772b41c01c',
  'gradient 3D plain': 'f0d164fd684c51d8',
  'gradient 3D period 4': 'ddc409f0fbca773a',
  'gradient 3D fbm': 'c6b2471ddc10f855',
  'cell 2D plain': '93d967dd396a7f78',
  'cell 2D period 4': 'c4f812407f625f55',
  'cell 2D fbm': 'd323054d2ec05542',
  'cell 3D plain': '427e8b43b2cbde85',
  'cell 3D period 4': 'fad15c96c17b43d7',
  'cell 3D fbm': '50cd146f1fe71990',
};

describe('the recorded outputs', () => {
  it('give the recorded digests for every kind in 2D and 3D: plain, period 4, and fbm (4 octaves, ×2.2, gain 0.6)', () => {
    const variants = { plain: {}, 'period 4': { period: 4 }, fbm: { octaves: 4, lacunarity: 2.2, gain: 0.6 } };
    const digests: Record<string, string> = {};
    for (const kind of KINDS) {
      for (const dims of [2, 3] as const) {
        const pts = points(2000, dims, 40, 0xd1 + dims);
        for (const [variant, options] of Object.entries(variants)) {
          const noise = sampler(kind, dims, { seed: 13, ...options });
          digests[`${kind} ${dims}D ${variant}`] = new Fnv64().numbers(pts.map(noise)).hex();
        }
      }
    }
    expect(digests).toEqual(DIGESTS);
  });
});
