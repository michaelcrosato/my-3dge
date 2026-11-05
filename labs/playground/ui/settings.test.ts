/**
 * @file Unit tests for labs/playground/ui/settings.ts (WP 13.38). The controls, over tests/unit/ui/fakeDom.ts and a
 * stand-in input: they show the keys of the device used last as the screen opens (a pad's buttons on a pad, the
 * keyboard's keys else), and a rebind listens on that device, says so, and puts what it hears on the action in every
 * camera's map, the pad's Start keeping the old one as Esc does. The rows: the screen offers the block's time of day,
 * the day's length, the rain and the dust, each a setting the registry knows, the two clock rows reporting a slider
 * once let go; Time of day and Day length set the block's clock live through its recorded dev action `daytime` (the
 * hour and the rate the scene's own start reads from them), so the street's lamps follow at once and the run's replay
 * plays back to the same hash. Applying a row's change is the front end's (tests/e2e/playground-ui.spec.ts).
 * @see labs/playground/ui/settings.ts
 */
import { describe, expect, it } from 'vitest';
import { createHeadless } from '../../../engine';
import { registry } from '../../../engine/core/registry';
import type { DeviceKind } from '../../../engine/input/codes';
import { playReplay } from '../../../engine/sim/replay';
import { fakePage, type FakeElement } from '../../../tests/unit/ui/fakeDom';
import '../cast/player';
import { PLAYGROUND_MAPS } from '../controls';
import { street } from '../scenes/site';
import '../weather';
import { clockAfter, CONTROL_ACTIONS, createSettings, SETTING_ROWS } from './settings';

/** The settings screen over a stand-in input whose device used last is `device`, the next code heard `heard`. */
function screenOn(device: DeviceKind, heard: string | null) {
  const { document } = fakePage({ left: 0, top: 0, width: 1280, height: 720 });
  const parent = document.createElement('div');
  const listened: string[] = [];
  const rebound: string[] = [];
  const input = {
    lastDevice: device,
    bindings: { label: (action: string, on: DeviceKind) => `${on}:${action}`, codes: () => [] },
    bindingsFor: (map: string) => ({
      map: { actions: { jump: [] } },
      actions: () => ['jump'],
      codes: () => [],
      rebind: (action: string, code: string) => (rebound.push(`${map} ${action} ${code}`), { ok: true }),
      reset: () => undefined,
    }),
    listen: (family: 'keyboard' | 'gamepad') => (listened.push(family), Promise.resolve(heard)),
  };
  createSettings(parent as unknown as HTMLElement, {
    values: {},
    schema: () => ({ type: 'number', minimum: 0, maximum: 1 }),
    input: input as never,
    onChange: () => undefined,
    onBack: () => undefined,
  });
  const key = (action: string) => parent.querySelector(`[data-ui=item][data-id=rebind:${action}]`) as FakeElement;
  return { key, listened, rebound };
}

describe('the settings screen’s controls', () => {
  it('show the keys of the device used last: a pad’s buttons on a pad, the keyboard’s else', () => {
    for (const [device, family] of [
      ['gamepad', 'gamepad'],
      ['keyboard', 'keyboard'],
      ['mouse', 'keyboard'],
    ] as const) {
      const { key } = screenOn(device, null);
      expect(
        Object.keys(CONTROL_ACTIONS).map((action) => key(action).textContent),
        device,
      ).toEqual(Object.keys(CONTROL_ACTIONS).map((action) => `${family}:${action}`));
    }
  });

  it('rebind on the device used last, in every camera’s map, Start keeping the old button as Esc keeps the key', async () => {
    const pad = screenOn('gamepad', 'PadNorth');
    pad.key('jump').click();
    expect([pad.key('jump').textContent, pad.listened]).toEqual(['Press a button… (Start: keep)', ['gamepad']]);
    await Promise.resolve();
    expect(pad.rebound).toEqual(Object.values(PLAYGROUND_MAPS).map((map) => `${map} jump PadNorth`));
    const kept = screenOn('gamepad', 'PadStart');
    kept.key('jump').click();
    await Promise.resolve();
    expect([kept.rebound, kept.key('jump').textContent]).toEqual([[], 'gamepad:jump']);
    const keys = screenOn('keyboard', 'KeyJ');
    keys.key('jump').click();
    expect([keys.key('jump').textContent, keys.listened]).toEqual(['Press a key… (Esc: keep)', ['keyboard']]);
  });
});

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
