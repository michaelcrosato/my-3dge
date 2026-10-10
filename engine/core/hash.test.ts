/**
 * @file Unit tests for engine/core/hash.ts (T1): FNV-1a 64 against its published vectors and a BigInt reference
 * implementation, numbers by their exact float64 bits (−0, NaN), the canonical form's ordering, tags and refusals,
 * and `serialize`'s round trip.
 * @see engine/core/hash.ts
 */
import { describe, expect, it } from 'vitest';
import { Vector3 } from './math';
import { Rng } from './rng';
import { deserialize, Fnv64, hashNumbers, hashValue, MAX_DEPTH, mix32, serialize, type Canonical } from './hash';

/** FNV-1a 64 in BigInt arithmetic, byte by byte: the reference the two-lane version must equal. */
function reference(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, '0');
}

/** The little-endian float64 bytes of `values`. */
function float64Bytes(values: number[]): Uint8Array {
  const view = new DataView(new ArrayBuffer(values.length * 8));
  values.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return new Uint8Array(view.buffer);
}

describe('Fnv64', () => {
  it('matches the published FNV-1a 64 vectors', () => {
    expect(new Fnv64().hex()).toBe('cbf29ce484222325');
    expect(new Fnv64().string('a').hex()).toBe('af63dc4c8601ec8c');
    expect(new Fnv64().string('foobar').hex()).toBe('85944171f73967e8');
  });

  it('equals a BigInt FNV-1a 64 on 2,000 random byte strings', () => {
    const rng = new Rng(64);
    for (let n = 0; n < 2000; n++) {
      const bytes = Uint8Array.from({ length: rng.int(0, 40) }, () => rng.int(0, 255));
      expect(new Fnv64().bytes(bytes).hex()).toBe(reference(bytes));
    }
  });

  it('feeds a number as its 8 float64 bytes, little-endian', () => {
    const rng = new Rng(8);
    const values = [
      0,
      1,
      -1,
      0.1,
      1e300,
      5e-324,
      Infinity,
      -Infinity,
      ...Array.from({ length: 500 }, () => rng.range(-1e6, 1e6)),
    ];
    expect(hashNumbers(values)).toBe(reference(float64Bytes(values)));
    expect(new Fnv64().uint32(0x04030201).hex()).toBe(reference(Uint8Array.of(1, 2, 3, 4)));
  });

  it('tells 0 from -0 and the last bit of every number, but every NaN is the same NaN', () => {
    expect(hashNumbers([0])).not.toBe(hashNumbers([-0]));
    expect(hashNumbers([1])).not.toBe(hashNumbers([1 + Number.EPSILON]));
    const other = new Float64Array(new BigUint64Array([0x7ff8000000000001n]).buffer)[0];
    expect(Number.isNaN(other)).toBe(true);
    expect(hashNumbers([other])).toBe(hashNumbers([NaN]));
    expect(hashNumbers([NaN])).toBe(reference(Uint8Array.of(0, 0, 0, 0, 0, 0, 0xf8, 0x7f)));
  });

  it('chains: hashNumbers is the numbers fed one by one, and typed arrays count as lists', () => {
    expect(hashNumbers([1, 2, 3])).toBe(new Fnv64().number(1).number(2).number(3).hex());
    expect(hashNumbers(Float64Array.of(1, 2, 3))).toBe(hashNumbers([1, 2, 3]));
  });
});

describe('mix32', () => {
  it("is murmur3's fmix32", () => {
    const fmix = (h: bigint) => {
      const m = (a: bigint, b: bigint) => (a * b) & 0xffffffffn;
      h = m(h ^ (h >> 16n), 0x85ebca6bn);
      h = m(h ^ (h >> 13n), 0xc2b2ae35n);
      return Number(h ^ (h >> 16n));
    };
    for (const h of [0, 1, 2, 0x7fffffff, 0x80000000, 0xffffffff, 123456789]) expect(mix32(h)).toBe(fmix(BigInt(h)));
  });
});

describe('the canonical form', () => {
  it('ignores the order of object keys', () => {
    expect(hashValue({ a: 1, b: { c: [1, 2], d: 'x' } })).toBe(hashValue({ b: { d: 'x', c: [1, 2] }, a: 1 }));
  });

  it('tells apart values that share their pieces', () => {
    const values: Canonical[] = [
      null,
      false,
      true,
      0,
      -0,
      1,
      '1',
      '',
      [],
      {},
      [1, [2]],
      [[1], 2],
      [1, 2],
      { a: [] },
      { a: {} },
      ['a', 'b'],
      ['ab'],
      { ab: '' },
      { a: 'b' },
    ];
    const hashes = values.map(hashValue);
    expect(new Set(hashes).size).toBe(values.length);
  });

  it('hashes typed arrays as lists and three.js math classes as their toArray()', () => {
    expect(hashValue({ p: Float32Array.of(0.5, 2) })).toBe(hashValue({ p: [0.5, 2] }));
    expect(hashValue({ p: new Vector3(1, 2, 3) })).toBe(hashValue({ p: [1, 2, 3] }));
  });

  it('refuses what it cannot hold with CORE_NOT_CANONICAL, naming where', () => {
    const bad: [unknown, RegExp][] = [
      [{ a: undefined }, /a is undefined/],
      [{ a: [1, () => 0] }, /a\[1\] is a function/],
      [{ m: new Map() }, /m is a Map/],
      [{ big: 1n }, /big is a bigint/],
      [{ d: new Date(0) }, /d is a Date/],
      [{ v: new BigInt64Array(1) }, /v is a BigInt64Array/],
      [Symbol('s'), /the value is a symbol/],
    ];
    for (const [value, message] of bad) {
      expect(() => hashValue(value as Canonical)).toThrow(/^\[CORE_NOT_CANONICAL\]/);
      expect(() => hashValue(value as Canonical)).toThrow(message);
      expect(() => serialize(value as Canonical)).toThrow(message);
    }
  });

  it('refuses a cycle instead of overflowing the stack', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => hashValue(loop as Canonical)).toThrow(new RegExp(`nested deeper than ${MAX_DEPTH} levels`));
  });
});

describe('serialize', () => {
  it('writes sorted, compact JSON with exact numbers and -0', () => {
    expect(serialize({ b: [1, -0, 0.1, 1e21], a: 'x', c: { z: null, y: true } })).toBe(
      '{"a":"x","b":[1,-0,0.1,1e+21],"c":{"y":true,"z":null}}',
    );
    expect(serialize([[], {}, [[1]], Float64Array.of(2), new Vector3(1, 2, 3)])).toBe('[[],{},[[1]],[2],[1,2,3]]');
  });

  it('round-trips through deserialize to the same hash, -0 included', () => {
    const rng = new Rng(3);
    const value = {
      pos: Float64Array.from({ length: 50 }, () => rng.range(-1e3, 1e3)),
      zero: -0,
      tag: 'é',
      n: [null, false],
    };
    const back = deserialize(serialize(value));
    expect(Object.is((back as { zero: number }).zero, -0)).toBe(true);
    expect(hashValue(back)).toBe(hashValue(value));
    expect(serialize(back)).toBe(serialize(value));
  });

  it('refuses NaN and infinities, which JSON cannot hold (the hash takes them)', () => {
    expect(() => serialize({ hp: [1, NaN] })).toThrow(/hp\[1\] is NaN/);
    expect(() => serialize(Infinity)).toThrow(/^\[CORE_NOT_CANONICAL\]/);
    expect(hashValue({ hp: [1, NaN] })).toMatch(/^[0-9a-f]{16}$/);
  });
});
