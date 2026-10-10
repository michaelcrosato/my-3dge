/**
 * @file Unit tests for engine/core/rng.ts (T1): Mulberry32 bit for bit against my-3d2dge's `E.rng` (the reference
 * vectors of tests/baselines/port/core.json, every seed form included), state round trips, the helpers' ranges,
 * `derive`'s independence and its pinned values, and named streams that never depend on each other.
 * @see engine/core/rng.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { derive, Rng, RngStreams } from './rng';

const CORE = JSON.parse(readFileSync('tests/baselines/port/core.json', 'utf8')) as {
  rng: { seed: number; values: number[] }[];
};

describe('Rng', () => {
  it("matches my-3d2dge's E.rng bit for bit, for every seed form in the reference vectors", () => {
    expect(CORE.rng.length).toBe(11);
    const misses = CORE.rng.flatMap(({ seed, values }) => {
      const rng = new Rng(seed);
      return values.flatMap((want, i) => {
        const got = rng.next();
        return Object.is(got, want) ? [] : [{ seed, i, got, want }];
      });
    });
    expect(misses).toEqual([]);
  });

  it('resumes the exact sequence from its state, in itself or in a new stream', () => {
    const a = new Rng(1234);
    for (let i = 0; i < 10; i++) a.next();
    const state = a.state;
    const ahead = [a.next(), a.next(), a.next()];
    a.state = state;
    expect([a.next(), a.next(), a.next()]).toEqual(ahead);
    const b = new Rng(0);
    b.state = state;
    expect([b.next(), b.next(), b.next()]).toEqual(ahead);
    expect(Number.isInteger(state) && state === (state | 0)).toBe(true);
  });

  it('draws next() in [0, 1) with a mean near one half', () => {
    const rng = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = rng.next();
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / 100_000 - 0.5)).toBeLessThan(0.005);
  });

  it('keeps range, int, chance and pick within their bounds, and int reaches both ends', () => {
    const rng = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const r = rng.range(-2, 3);
      expect(r >= -2 && r < 3).toBe(true);
      const n = rng.int(1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
      seen.add(n);
      expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(rng.pick([])).toBeUndefined();
  });

  it('shuffles in place into a permutation, the same one for the same seed', () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    const shuffled = new Rng(5).shuffle([...list]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(list);
    expect(shuffled).not.toEqual(list);
    expect(new Rng(5).shuffle([...list])).toEqual(shuffled);
  });
});

describe('derive', () => {
  it('gives the pinned seeds (replay goldens depend on them)', () => {
    expect([derive(0), derive(1234, 'loot'), derive(1234, 'entity', 7, 'anim')]).toEqual([
      4284089001, 1709231095, 2190103645,
    ]);
  });

  it('gives unrelated unsigned 32-bit seeds for different seeds, keys and key orders', () => {
    const seeds = [
      derive(1, 'ai'),
      derive(2, 'ai'),
      derive(1, 'spawn'),
      derive(1, 'ai', 'x'),
      derive(1, 'x', 'ai'),
      derive(1, '1'),
      derive(1, 1),
      derive(1, 'ai1'),
      derive(1, 'a', 'i1'),
    ];
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const seed of seeds) expect(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(true);
  });

  it('spreads neighbouring keys over the whole range', () => {
    const highBits = new Set(Array.from({ length: 256 }, (_, i) => derive(0, i) >>> 28));
    expect(highBits.size).toBe(16);
  });
});

describe('RngStreams', () => {
  it('derives each stream from the seed and its keys, whatever order streams are first used in', () => {
    const a = new RngStreams(42);
    const b = new RngStreams(42);
    const ai = a.stream('ai').next();
    b.stream('spawn').next();
    b.stream('entity', 3, 'anim').next();
    expect(b.stream('ai').next()).toBe(ai);
    expect(a.stream('ai')).toBe(a.stream('ai'));
    expect(new Rng(derive(42, 'entity', 3, 'anim')).next()).toBe(new RngStreams(42).stream('entity', 3, 'anim').next());
  });

  it('lists every used stream with its state, keys sorted, and restores them exactly', () => {
    const streams = new RngStreams(9);
    streams.stream('spawn').next();
    streams.stream('ai').next();
    const saved = streams.state();
    expect(Object.keys(saved)).toEqual(['["ai"]', '["spawn"]']);
    const ahead = [streams.stream('ai').next(), streams.stream('spawn').next()];
    streams.setState(saved);
    expect([streams.stream('ai').next(), streams.stream('spawn').next()]).toEqual(ahead);
    const fresh = new RngStreams(9);
    fresh.setState(saved);
    expect([fresh.stream('ai').next(), fresh.stream('spawn').next()]).toEqual(ahead);
  });

  it('drops a stream the restored state lacks, so its next use starts from its derived seed', () => {
    const streams = new RngStreams(3);
    const saved = streams.state();
    const first = streams.stream('late').next();
    streams.stream('late').next();
    streams.setState(saved);
    expect(streams.state()).toEqual({});
    expect(streams.stream('late').next()).toBe(first);
  });
});
