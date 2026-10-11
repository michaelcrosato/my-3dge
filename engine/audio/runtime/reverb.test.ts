/**
 * @file Unit tests for the rooms (engine/audio/runtime/reverb.ts): each preset's impulse response decays 60 dB in its
 * `decay` (measured by Schroeder's backward integration, within 5%), starts after its `predelay`, carries unit energy
 * per channel, is darker the lower its `damping`, has uncorrelated channels, and is the same bits for the same seed;
 * a room without reverb has none; unknown names and bad numbers are refused with the fix.
 */
import { describe, expect, it } from 'vitest';
import { ROOMS, impulseResponse, roomSpec, type RoomName } from './reverb';

const RATE = 48000;

/** The RT60 of `ir` from its Schroeder decay curve between −5 and −25 dB (T20, times 3). */
function rt60(ir: Float32Array, rate: number): number {
  const edc = new Float64Array(ir.length);
  let sum = 0;
  for (let i = ir.length - 1; i >= 0; i--) edc[i] = sum += ir[i] * ir[i];
  const db = (i: number) => 10 * Math.log10(edc[i] / edc[0]);
  const at = (level: number) => {
    let i = 0;
    while (db(i) > level) i++;
    return i / rate;
  };
  return 3 * (at(-25) - at(-5));
}

/** How bright a signal is: the energy of its first difference over its energy. */
function brightness(x: Float32Array): number {
  let diff = 0;
  let energy = 0;
  for (let i = 1; i < x.length; i++) {
    diff += (x[i] - x[i - 1]) ** 2;
    energy += x[i] ** 2;
  }
  return diff / energy;
}

const REVERBERANT = (Object.keys(ROOMS) as RoomName[]).filter((name) => ROOMS[name].wet > 0);

describe('impulseResponse', () => {
  it.each(REVERBERANT)('%s decays 60 dB in its decay time, after its predelay, at unit energy', (name) => {
    const room = ROOMS[name];
    const [left, right] = impulseResponse(name, RATE) as [Float32Array, Float32Array];
    expect(left.length).toBe(Math.round(room.predelay * RATE) + Math.round(room.decay * RATE));
    for (const channel of [left, right]) {
      expect(rt60(channel, RATE)).toBeCloseTo(room.decay, 0);
      expect(Math.abs(rt60(channel, RATE) / room.decay - 1)).toBeLessThan(0.05);
      expect(channel.subarray(0, Math.round(room.predelay * RATE)).every((v) => v === 0)).toBe(true);
      expect(channel.reduce((sum, v) => sum + v * v, 0)).toBeCloseTo(1, 5);
    }
  });

  it('is darker the lower the damping, and its channels are uncorrelated', () => {
    const byDamping = [...REVERBERANT].sort((a, b) => ROOMS[a].damping - ROOMS[b].damping);
    const bright = byDamping.map((name) => brightness((impulseResponse(name, RATE) as Float32Array[])[0]));
    expect(bright).toEqual([...bright].sort((a, b) => a - b));
    const [left, right] = impulseResponse('hall', RATE) as Float32Array[];
    const correlation = left.reduce((sum, v, i) => sum + v * right[i], 0);
    expect(Math.abs(correlation)).toBeLessThan(0.05);
  });

  it('gives the same bits for the same seed, and others for another', () => {
    const a = impulseResponse('room', RATE, 7) as Float32Array[];
    const b = impulseResponse('room', RATE, 7) as Float32Array[];
    const c = impulseResponse('room', RATE, 8) as Float32Array[];
    expect(Buffer.from(a[0].buffer).equals(Buffer.from(b[0].buffer))).toBe(true);
    expect(Buffer.from(a[0].buffer).equals(Buffer.from(c[0].buffer))).toBe(false);
  });

  it('has none for a room without reverb, and takes a room as numbers', () => {
    expect(impulseResponse('none', RATE)).toBeNull();
    expect(impulseResponse({ decay: 1, predelay: 0, damping: 4000, wet: 0 }, RATE)).toBeNull();
    const custom = impulseResponse({ decay: 0.5, predelay: 0.01, damping: 4000, wet: 0.2 }, RATE) as Float32Array[];
    expect(rt60(custom[0], RATE)).toBeCloseTo(0.5, 1);
  });

  it('refuses an unknown name with the closest, and numbers out of range with the field', () => {
    expect(() => roomSpec('hal' as RoomName)).toThrow(
      /AUDIO_BAD_ROOM.*room hal is not a preset \(did you mean "hall"\?\)/,
    );
    expect(() => roomSpec({ decay: 20, predelay: 0, damping: 4000, wet: 0.2 })).toThrow(/decay 20 is not from 0 to 10/);
  });
});
