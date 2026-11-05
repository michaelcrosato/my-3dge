/**
 * @file Unit tests for labs/playground/ui/settings.ts (WP 13.38): the settings screen offers the block's time of day,
 * the day's length, the rain and the dust, each a setting the registry knows, the two clock rows reporting a slider
 * once let go; Time of day and Day length set the block's clock live through its recorded dev action `daytime` (the
 * hour and the rate the scene's own start reads from them), so the street's lamps follow at once and the run's replay
 * plays back to the same hash.
 * @see labs/playground/ui/settings.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { registry } from '../../../engine/core/registry';
import { playReplay } from '../../../engine/sim/replay';
import '../cast/player';
import { street } from '../scenes/site';
import '../weather';
import { clockAfter, SETTING_ROWS } from './settings';

/** The block's clock and the street's lamps in a headless run. */
type Live = Awaited<ReturnType<typeof createHeadless>>;
const hour = (live: Live) => (live.state('daytime').entities as unknown as { daytime: { hour: number; rate: number } }[])[0].daytime; // prettier-ignore
const lit = (live: Live) => {
  const lamps = (live.state('propLight').entities as unknown as { propLight: { group: string; on: boolean } }[]).filter((e) => e.propLight.group === 'street'); // prettier-ignore
  return lamps.length > 0 && lamps.every((e) => e.propLight.on);
};

describe('the playground’s settings screen', () => {
  it('offers the time of day, the day’s length, the rain and the dust, the clock reported once let go', () => {
    const rows = Object.fromEntries(SETTING_ROWS.map((row) => [row.id, row]));
    for (const path of ['playground.hour', 'playground.day', 'playground.rain', 'playground.dust']) {
      expect(rows[path]?.kind, path).toBe('setting');
      expect(registry.has('setting', path), path).toBe(true);
    }
    expect([rows['playground.hour'].release, rows['playground.day'].release, rows['playground.rain'].release]).toEqual([true, true, undefined]); // prettier-ignore
  });

  it('works out the block’s clock from Time of day and Day length, the row just changed first', () => {
    const settings = (hour: number, day: number) => (path: string) => ({ 'playground.hour': hour, 'playground.day': day })[path]; // prettier-ignore
    expect(clockAfter('playground.hour', 22, settings(12, 0))).toEqual({ hour: 22, rate: 0 });
    expect(clockAfter('playground.day', 20, settings(17, 0))).toEqual({ hour: 17, rate: 24 / 1200 });
    expect(clockAfter('playground.hour', 6, settings(12, 30))).toEqual({ hour: 6, rate: 24 / 1800 });
    expect(clockAfter('playground.rain', 1, settings(12, 0))).toBeNull();
  });

  it('sets the block’s clock live through the recorded dev action, the lamps following, the replay holding it', async () => {
    const live = await createHeadless({ scene: street });
    live.step(2);
    expect([hour(live).hour, lit(live)]).toEqual([12, false]);
    live.set('playground.hour', 22);
    (live.actions as { run(name: string, args: unknown): unknown }).run('daytime', clockAfter('playground.hour', 22, () => 0)); // prettier-ignore
    live.step(2);
    expect([hour(live).hour, lit(live)]).toEqual([22, true]);
    const replay = (live.input as { record(): Parameters<typeof playReplay>[0] }).record();
    expect(playReplay(replay).session.world.hash()).toBe(live.hash());
  }, 120_000);
});
