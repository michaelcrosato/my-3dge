/**
 * @file Tests for the playground's weather (labs/playground/weather.ts): dry by default; the rain over the player
 * outdoors at its setting's share of its rate, the dust only indoors, nothing without a player; both emitters ask for
 * the GPU, the rain at full strength more drops than the CPU pool holds and fewer than the ring does; and the settings
 * are view settings from 0 to 1.
 * @see labs/playground/weather.ts
 */
import { describe, expect, it } from 'vitest';
import { getEmitter, type EngineFrame } from '../../engine';
import { PLAYGROUND_WEATHER_SETTINGS, runWeather, WEATHER } from './weather';

/** A frame with the player at (3, 1, 4) (or none), the settings `values`, recording what it emits. */
function frame(values: Record<string, number>, player = true) {
  const emitted: unknown[][] = [];
  const actors = player ? [{ actor: { player: true, x: 3, y: 1, z: 4 } }] : [];
  const shown = {
    world: { query: () => actors },
    setting: (key: string) => values[key] ?? 0,
    emit: (...args: unknown[]) => emitted.push(args),
  } as unknown as EngineFrame;
  return { shown, emitted };
}

describe("the playground's weather", () => {
  it('is dry by default, and rains over the player outdoors at its share of the rate', () => {
    const dry = frame({});
    runWeather(dry.shown, () => false);
    expect(dry.emitted).toEqual([]);
    const wet = frame({ 'playground.rain': 0.5, 'playground.dust': 1 });
    runWeather(wet.shown, () => false);
    expect(wet.emitted).toEqual([[WEATHER.rain.emitter, [3, 1, 4], 'playground:rain', 0.5]]);
  });

  it('stops the rain indoors and hangs the dust there, and does nothing without a player', () => {
    const inside = frame({ 'playground.rain': 1, 'playground.dust': 0.25 });
    runWeather(inside.shown, (at) => at.x === 3);
    expect(inside.emitted).toEqual([[WEATHER.dust.emitter, [3, 1, 4], 'playground:dust', 0.25]]);
    const nobody = frame({ 'playground.rain': 1 }, false);
    runWeather(nobody.shown, () => false);
    expect(nobody.emitted).toEqual([]);
  });

  it('asks the GPU for both, the rain at full more drops than the CPU pool holds and fewer than the ring', () => {
    const [rain, dust] = [getEmitter(WEATHER.rain.emitter), getEmitter(WEATHER.dust.emitter)];
    expect([rain.gpu, dust.gpu, rain.rate, dust.rate]).toEqual([true, true, WEATHER.rain.rate, WEATHER.dust.rate]);
    const live = rain.rate * ((rain.life[0] + rain.life[1]) / 2);
    expect([live > 4096, live < 65_536]).toEqual([true, true]);
  });

  it('reads two view settings from 0 to 1, dry and clear by default', () => {
    expect(PLAYGROUND_WEATHER_SETTINGS.map((entry) => entry.id)).toEqual(['playground.rain', 'playground.dust']);
    for (const entry of PLAYGROUND_WEATHER_SETTINGS) {
      expect(entry).toMatchObject({ view: true, minimum: 0, maximum: 1, default: 0 });
    }
  });
});
