/**
 * @file Unit tests for engine/core/color.ts (T1): every colour helper bit for bit against my-3d2dge (the reference
 * vectors of tests/baselines/port/color.json), `CORE_BAD_COLOR` for what is not hex, and the linear conversions
 * equal to three.js's `Color`, round-tripping every byte colour.
 * @see engine/core/color.ts
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromLinear, hex, hsl, mix, ramp, shade, toHex, toHsl, toLinear, tones } from './color';
import { Color } from './math';
import { Rng } from './rng';

type Bytes = [number, number, number];
const COLOR = JSON.parse(readFileSync('tests/baselines/port/color.json', 'utf8')) as {
  colors: string[];
  hex: [string, Bytes][];
  toHex: [Bytes, string][];
  toHsl: [string, Bytes][];
  hsl: [number, number, number, string][];
  shade: [string, number, string][];
  mix: [string, string, number, string][];
  tones: [string, number, Record<string, string>][];
  ramp: [string, number, number, string[]][];
};

/** Deep equality with numbers compared by `Object.is` (bit for bit, -0 apart from 0) and keys in order. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const [ka, kb] = [Object.keys(a), Object.keys(b)];
    const at = (o: object, k: string) => (o as Record<string, unknown>)[k];
    return same(ka, kb) && ka.every((k) => same(at(a, k), at(b, k)));
  }
  return a === b;
}

describe("my-3d2dge's colour helpers", () => {
  it('match the reference vectors bit for bit', () => {
    const cases = [
      ...COLOR.hex.map(([c, want]) => ({ name: 'hex', args: [c], got: hex(c), want })),
      ...COLOR.toHex.map(([c, want]) => ({ name: 'toHex', args: [c], got: toHex(c), want })),
      ...COLOR.toHsl.map(([c, want]) => ({ name: 'toHsl', args: [c], got: toHsl(c), want })),
      ...COLOR.hsl.map(([h, s, l, want]) => ({ name: 'hsl', args: [h, s, l], got: hsl(h, s, l), want })),
      ...COLOR.shade.map(([c, a, want]) => ({ name: 'shade', args: [c, a], got: shade(c, a), want })),
      ...COLOR.mix.map(([a, b, t, want]) => ({ name: 'mix', args: [a, b, t], got: mix(a, b, t), want })),
      ...COLOR.tones.map(([c, k, want]) => ({ name: 'tones', args: [c, k], got: tones(c, k), want })),
      ...COLOR.ramp.map(([c, n, k, want]) => ({ name: 'ramp', args: [c, n, k], got: ramp(c, n, k), want })),
    ];
    expect(cases.length).toBe(49 + 5 + 49 + 264 + 343 + 196 + 147 + 196);
    expect(cases.filter(({ got, want }) => !same(got, want))).toEqual([]);
  });

  it('keep the input as tones().base, and default to strength 1 and five ramp steps', () => {
    expect(tones('#F0A').base).toBe('#F0A');
    expect(tones('#2f8f86')).toEqual(tones('#2f8f86', 1));
    expect(ramp('#2f8f86')).toEqual(ramp('#2f8f86', 5, 1));
  });

  it('take bytes wherever they take a hex string', () => {
    expect(hex([1, 2, 3, 4])).toEqual([1, 2, 3]);
    expect(shade([47, 143, 134], -0.3)).toBe(shade('#2f8f86', -0.3));
    expect(mix([0, 0, 0], '#ffffff', 0.5)).toBe('#808080');
  });

  it('refuse a colour that is not hex with CORE_BAD_COLOR', () => {
    for (const bad of ['red', '#12', '12345', '#12zz56', '', '#', 'rgb(1,2,3)', '#1234567']) {
      expect(() => hex(bad), bad).toThrow(/^\[CORE_BAD_COLOR\] color ".*" is not a hex color: write colours as hex/);
      expect(() => shade(bad, 0.1), bad).toThrow(/CORE_BAD_COLOR/);
    }
    expect(hex(' #ABCDEF80 ')).toEqual([0xab, 0xcd, 0xef]);
    expect(hex('abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });
});

describe('toLinear and fromLinear', () => {
  it("give what three.js's Color holds for the same hex", () => {
    const color = new Color();
    for (const c of COLOR.colors.filter((c) => c.length === 7)) {
      color.set(c);
      expect(toLinear(c)).toEqual([color.r, color.g, color.b]);
    }
    expect(toLinear('#808080')).toEqual([0.21586050010324417, 0.21586050010324417, 0.21586050010324417]);
    expect(toLinear('#000')).toEqual([0, 0, 0]);
    expect(toLinear('#fff')).toEqual([1, 1, 1]);
  });

  it('round-trip every reference colour and 2,000 random byte colours', () => {
    const rng = new Rng(16);
    const random = Array.from({ length: 2000 }, () => toHex([rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)]));
    for (const c of [...COLOR.colors, ...random]) expect(fromLinear(toLinear(c))).toBe(toHex(hex(c)));
  });

  it('clamp out-of-range linear values on the way out', () => {
    expect(fromLinear([-1, 0.5, 2])).toBe(`#00${fromLinear([0.5, 0.5, 0.5]).slice(3, 5)}ff`);
  });
});
