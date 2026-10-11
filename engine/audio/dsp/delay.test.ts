/**
 * @file Unit tests for engine/audio/dsp/delay.ts (T1): the echo's repeats (spacing, mix, feedback), the tail it adds
 * and where that tail ends.
 * @see engine/audio/dsp/delay.ts
 */
import { describe, expect, it } from 'vitest';
import { ECHO_FLOOR, echo, echoCount, echoSpacing, MAX_ECHOES } from './delay';

describe('echo', () => {
  it("matches its file comment's example", () => {
    const wet = echo(new Float64Array([1]), { time: 0.001, feedback: 0.5, mix: 0.5 }, 1000);
    expect([wet[0], wet[1], wet[2]]).toEqual([1, 0.5, 0.25]);
  });

  it('repeats the dry signal every spacing, the first repeat at mix, each next one feedback times the last', () => {
    const dry = Float64Array.from([1, 0.5, -0.25]);
    const spec = { time: 0.01, feedback: 0.6, mix: 0.4 };
    const out = echo(dry, spec, 1000);
    const spacing = echoSpacing(spec, 1000);
    expect(spacing).toBe(10);
    expect(out.length).toBe(dry.length + spacing * echoCount(spec));
    expect(Array.from(out.subarray(0, 3))).toEqual([1, 0.5, -0.25]);
    expect(out[3]).toBe(0);
    for (let k = 1; k <= 4; k++) {
      for (let i = 0; i < dry.length; i++) {
        expect(out[k * spacing + i]).toBeCloseTo(dry[i] * 0.4 * Math.pow(0.6, k - 1), 12);
      }
    }
  });

  it('keeps repeats until one would fall below the floor, at most MAX_ECHOES', () => {
    const count = echoCount({ time: 0.1, feedback: 0.5, mix: 0.5 });
    expect(0.5 * Math.pow(0.5, count - 1)).toBeGreaterThanOrEqual(ECHO_FLOOR);
    expect(0.5 * Math.pow(0.5, count)).toBeLessThan(ECHO_FLOOR);
    expect(echoCount({ time: 0.1, feedback: 0, mix: 1 })).toBe(1);
    expect(echoCount({ time: 0.1, feedback: 0.95, mix: 1 })).toBeLessThanOrEqual(MAX_ECHOES);
    expect(echoSpacing({ time: 0.00001, feedback: 0, mix: 1 }, 44100)).toBe(1);
  });
});
