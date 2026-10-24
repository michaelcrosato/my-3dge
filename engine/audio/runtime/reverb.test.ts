/**
 * @file Unit tests for the rooms (engine/audio/runtime/reverb.ts): each preset's impulse response decays 60 dB in its
 * `decay` (measured by Schroeder's backward integration, within 5%), starts after its `predelay`, carries unit energy
 * per channel, is darker the lower its `damping`, has uncorrelated channels, and is the same bits for the same seed;
 * a room without reverb has none; unknown names and bad numbers are refused with the fix; a level's room takes its
 * preset by its volume; a room's own numbers (WP 13.22) follow Sabine's formula: a soft floor rings shorter and darker
 * than a hard one, a bigger or a barer room longer, a longer one is sent in louder, and every one is a valid room.
 */
import { describe, expect, it } from 'vitest';
import { ROOMS, impulseResponse, roomAcoustics, roomReverb, roomSpec, type RoomName } from './reverb';

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

describe('roomReverb', () => {
  it('picks a level room’s preset by its volume: small under 30 m³, room under 200 m³, hall past (WP 13.15)', () => {
    const volumes = [
      [4, 2.7],
      [11, 2.7],
      [12, 2.5],
      [74, 2.7],
      [80, 2.5],
      [300, 6],
    ] as const; // 10.8, 29.7, 30, 199.8, 200, 1,800 m³
    expect(volumes.map(([area, height]) => roomReverb({ area }, height))).toEqual(['small', 'small', 'room', 'room', 'hall', 'hall']); // prettier-ignore
  });
});

describe('roomAcoustics', () => {
  const bedroom = { area: 16, height: 2.7, floor: 'carpet' } as const;
  it('rings shorter and darker on a soft floor than a hard one, longer when bigger or barer, louder the longer', () => {
    const [soft, hard] = [roomAcoustics(bedroom), roomAcoustics({ ...bedroom, floor: 'tile' })];
    expect(soft.decay).toBeLessThan(hard.decay);
    expect(soft.damping).toBeLessThan(hard.damping);
    expect(soft.wet).toBeLessThan(hard.wet);
    expect(roomAcoustics({ ...bedroom, area: 64 }).decay).toBeGreaterThan(soft.decay);
    expect(roomAcoustics({ ...bedroom, contents: 0.05 }).decay).toBeGreaterThan(soft.decay);
    expect(roomAcoustics({ ...bedroom, area: 64 }).predelay).toBeGreaterThan(soft.predelay); // a longer flight
  });

  it('follows Sabine’s RT60 = 0.161 V / A for a square room, and gives valid rooms from a closet to a hall', () => {
    const [a, h] = [16, 2.7];
    const absorbed = a * (0.35 + 0.06 + 0.25) + 4 * Math.sqrt(a) * h * 0.06; // carpet, plaster, contents; the walls
    expect(roomAcoustics(bedroom).decay).toBeCloseTo((0.161 * a * h) / absorbed, 9);
    for (const area of [0.1, 4, 16, 80, 400, 5000]) {
      for (const floor of ['carpet', 'concrete', 'grass']) {
        const room = roomAcoustics({ area, height: area > 100 ? 6 : 2.7, floor, contents: 0 });
        expect(roomSpec(room)).toBe(room);
      }
    }
  });
});
