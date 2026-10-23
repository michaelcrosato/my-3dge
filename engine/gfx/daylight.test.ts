/**
 * @file Unit tests for the sky by the hour (engine/gfx/daylight.ts): each key sky at its hour, the light from the arc;
 * the sun rising in the east, highest in the south at noon, setting in the west, the moon through the night, both held
 * 7° up and dimmest where they swap; no jump from one minute to the next anywhere in the day but the swap's, made at
 * the light's dimmest; and every hour's light casting and lamps shining, so the cycle never changes a shader's key.
 * @see engine/gfx/daylight.ts
 */
import { Color } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../core/registry';
import { daylightAt, defineDaylight, DAYLIGHT, lightAt, SUN } from './daylight';
import type { SkyEntry } from './sky';

const registry = createRegistry();
defineDaylight(registry);

/** The light's direction (unit), from where it stands. */
const toward = (sun: { azimuth: number; elevation: number }) => {
  const flat = Math.cos(sun.elevation);
  return [Math.sin(sun.azimuth) * flat, Math.sin(sun.elevation), Math.cos(sun.azimuth) * flat];
};

/** How far apart two hex colours are, the largest channel's step (0 to 1). */
const apart = (a: string, b: string) => {
  const [x, y] = [new Color(a), new Color(b)];
  return Math.max(Math.abs(x.r - y.r), Math.abs(x.g - y.g), Math.abs(x.b - y.b));
};

describe('the sky by the hour', () => {
  it('shows each key sky at its hour, its light where the arc puts it', () => {
    for (const [hour, id] of DAYLIGHT) {
      const [entry, key] = [daylightAt(hour, registry), registry.get('sky', id) as SkyEntry];
      expect([hour, entry.ambient, entry.fog, entry.dome, entry.background]).toEqual([hour, key.ambient, key.fog, key.dome, key.background]); // prettier-ignore
      expect(entry.sun.intensity).toBeCloseTo(key.sun.intensity * lightAt(hour).strength, 9);
    }
    expect(daylightAt(12, registry).sun.intensity).toBeCloseTo(2.6, 9);
  });

  it('raises the sun in the east, puts it highest in the south at noon, sets it in the west; the moon has the night', () => {
    const [dawn, noon, dusk] = [lightAt(6.5), lightAt(12), lightAt(17.5)].map((light) => ({
      ...light,
      way: toward(light),
    }));
    expect([dawn.body, noon.body, dusk.body, lightAt(0).body, lightAt(23).body]).toEqual(['sun', 'sun', 'sun', 'moon', 'moon']); // prettier-ignore
    expect(dawn.way[0]).toBeGreaterThan(0.9); // east, +X
    expect(dusk.way[0]).toBeLessThan(-0.9); // west, −X
    expect([noon.azimuth, noon.elevation]).toEqual([0, SUN.height]); // south, +Z, at its height
    for (let minute = 0; minute < 24 * 60; minute++) expect(lightAt(minute / 60).elevation).toBeGreaterThanOrEqual(SUN.lowest); // prettier-ignore
    expect([lightAt(SUN.rise).strength, lightAt(SUN.set).strength]).toEqual([SUN.dimmest, SUN.dimmest]);
  });

  it('moves no more than a little from one minute to the next, but where the moon and sun swap, at their dimmest', () => {
    let worst = { colour: 0, ambient: 0, light: 0 };
    for (let minute = 1; minute <= 24 * 60; minute++) {
      const [a, b] = [daylightAt((minute - 1) / 60, registry), daylightAt(minute / 60, registry)];
      const turn = Math.acos(
        Math.min(
          1,
          toward(a.sun).reduce((sum, v, i) => sum + v * toward(b.sun)[i], 0),
        ),
      );
      const swap = [SUN.rise, SUN.set].some((hour) => Math.abs(minute / 60 - hour) < 1 / 120);
      worst = {
        colour: Math.max(worst.colour, apart(a.fog.color, b.fog.color), apart(a.ambient.sky, b.ambient.sky)),
        ambient: Math.max(worst.ambient, Math.abs(a.ambient.intensity - b.ambient.intensity)),
        light: swap ? worst.light : Math.max(worst.light, turn),
      };
      if (swap) expect(Math.min(a.sun.intensity, b.sun.intensity)).toBeLessThan(0.1);
    }
    expect(worst.colour).toBeLessThan(0.02);
    expect(worst.ambient).toBeLessThan(0.015);
    expect(worst.light).toBeLessThan(0.01); // radians a minute: about half a degree
  });

  it('casts and lights the lamps at every hour, so the day never changes a shader', () => {
    for (let quarter = 0; quarter < 96; quarter++) {
      const entry = daylightAt(quarter / 4, registry);
      expect([entry.sun.intensity > 0, entry.pointLights, entry.dome.show]).toEqual([true, 1, true]);
    }
    const [noon, night] = [daylightAt(12, registry), daylightAt(0, registry)];
    expect(night.ambient.intensity).toBeLessThan(noon.ambient.intensity / 2);
    expect(night.backdrop.tint).not.toBe(noon.backdrop.tint);
    expect(night.backdrop.layers).toEqual(noon.backdrop.layers); // one skyline all day: baked once
  });
});
